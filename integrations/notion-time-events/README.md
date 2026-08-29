# Notion Status → Task Time Events → Google Sheets projection

## Purpose

Automate Task-level effort recording without creating a second operational source of truth.

**Authoritative operational records remain in Notion:**

- `Stories & Tasks` is authoritative for Task state, assignment, completion evidence, and completion status.
- `Task Time Events` is authoritative for Actor start/end intervals.
- Google Sheets is a **derived projection for aggregation and analysis only**. It is never a completion gate or an authoritative effort ledger.

Flow:

`Notion Stories & Tasks change` → `Notion webhook` → `Cloudflare Worker (signature validation)` → `Apps Script` → `Notion Task Time Events (authoritative write)` → `Google Sheets projection`

## Behavior

- `Status = In Progress` ensures exactly one authoritative open Task Time Event for the currently mapped `Assigned Agent`.
- Moving from `In Progress` to `Review`, `Blocked`, `Ready`, or `Backlog` closes every authoritative open event for the Task, regardless of current assignee.
- Changing or clearing `Assigned Agent` while the Task remains `In Progress` closes the old Actor event and opens the new Actor event when the new assignment maps to a supported Actor.
- Duplicate open events for the same Task/Actor are reconciled to one open event.
- `Done` is a **completion gate, not a stop trigger**. The integration never uses a Done webhook to close a Task Time Event after completion.
- A Done transition with any open Task Time Event is rejected by restoring `In Progress`; a Done transition with closed timing but missing `Result` or `Completed At` is rejected by restoring `Review`.
- The valid completion path is therefore: finish work → `Review` (time event closes) → record `Result` + `Completed At` → `Done`.
- Webhook retries are idempotent: authoritative Notion state is queried before writes, and webhook IDs are additionally deduplicated in the projection log.
- After each authoritative reconciliation, the Task's Notion Time Events are upserted into Google Sheets by Notion event page ID.

Actor mapping:

- `ChatGPT` → `Chris`
- `Claude Opus / Sonnet / Haiku` → `Claude`
- `Codex` → `Codex`
- `Human` → `Human`

Normal conversation and non-Task activity are outside this integration because no managed Task Status/assignment event is involved.

## Security model

The Notion subscription URL contains **no bearer key or credential**.

Normal webhook deliveries are accepted only after an authenticated operator has promoted the Notion subscription's verification token into approved secret stores:

- Cloudflare Worker secret: `NOTION_WEBHOOK_VERIFICATION_TOKEN`
- Apps Script Script Property: `NOTION_WEBHOOK_VERIFICATION_TOKEN`

The Cloudflare Worker validates `X-Notion-Signature` using HMAC-SHA256 over the exact raw request body before forwarding anything. Apps Script independently validates the same original Notion signature before reading or writing operational state.

### Enrollment trust boundary

The initial Notion verification request is **not treated as proof of Notion identity**, because its body contains the future HMAC secret. The Worker therefore handles enrollment in two phases:

1. the handshake token is stored only as `notion_webhook_pending_token` in the `WEBHOOK_STATE` KV namespace and is **not** relayed to Apps Script or accepted as an active signing credential;
2. an authenticated operator reads that pending value from Cloudflare, pastes it into Notion's verification UI, and promotes it to the active Worker/App Script secret **only after Notion accepts the token**.

A forged handshake can at most replace the pending candidate; it cannot authenticate normal deliveries. If Notion rejects the pending token, do not promote it; repeat the handshake and retrieve the new candidate.

The verification token must never be written to GitHub, Sheets, URLs, comments, prompts, or execution logs. In particular, there is no helper that logs or prints the active token.

## Google Sheet

PoC spreadsheet:

https://docs.google.com/spreadsheets/d/1tjzjNqHEnPkzQGqB_ydxdWSKsdth27IUJaRrm_5xGks/edit

Tabs:

- `Time Events` — derived projection of Notion Task Time Events.
- `Summary` — Actor totals and open-event counts derived from the projection.
- `Config` — non-secret configuration reference.
- `Webhook Log` — hidden delivery/idempotency diagnostics; contains IDs/status/outcomes, never tokens.

Spreadsheet timezone must remain `Asia/Tokyo`.

The `Event ID` in projected rows is the authoritative Notion Task Time Event page ID, so touched Tasks can be deterministically reconciled from Notion records.

## Notion connection requirements

The Notion connection used by Apps Script must have access to both `Stories & Tasks` and `Task Time Events`, with capabilities sufficient to:

- read Task state, assignment, `Result`, and `Completed At`;
- update Task `Status` when the Done gate must reject an invalid transition;
- query Task Time Events;
- create Task Time Events; and
- update `Ended At` / `Note` on Task Time Events.

Creating Task Time Events through the Notion API requires **Insert Content** capability. Do not continue to secure E2E if the connection is read/update-only.

`NOTION_TOKEN` remains in Apps Script Script Properties; never put it in source code, GitHub, the Sheet, a URL, or logs.

## Apps Script setup

1. Open the PoC Google Sheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with the current version from this directory.
3. Run `setup()` once. Existing `NOTION_TOKEN` is preserved.
4. Redeploy the Web App as a new version. Execute as yourself and allow the Cloudflare Worker to POST without Google sign-in.
5. Keep the `/exec` URL out of public documentation. It is not the authentication credential, but it is only an internal relay target.
6. Do **not** configure `NOTION_WEBHOOK_VERIFICATION_TOKEN` yet; it is promoted only after Notion accepts the pending enrollment token.

The Apps Script endpoint is **not** registered directly with Notion.

## Cloudflare Worker setup

Worker source is under `worker/`.

1. Create/bind a Workers KV namespace named `WEBHOOK_STATE`. With current Wrangler, `npx wrangler kv namespace create WEBHOOK_STATE --update-config` can add the binding to `wrangler.jsonc`.
2. Configure `APPS_SCRIPT_URL` in Cloudflare's environment/secret storage with the Apps Script `/exec` URL. Do not commit the value.
3. Deploy the Worker **without** an active `NOTION_WEBHOOK_VERIFICATION_TOKEN` secret for the enrollment phase.
4. Use only the Worker's public HTTPS URL as the Notion webhook URL. Do not append authentication query parameters.

The Worker requires no Notion API token.

## Trusted subscription enrollment

1. Keep the old direct-to-Apps-Script subscription paused while migrating.
2. Create a new Notion subscription whose URL is the Cloudflare Worker URL and event is `page.properties_updated`.
3. Notion sends the verification request. The Worker stores its token only as KV key `notion_webhook_pending_token` and returns success; it does not relay or activate it.
4. Using an authenticated Cloudflare session, read the pending value from the KV namespace. Prefer the Cloudflare dashboard. Wrangler can also read it with `npx wrangler kv key get notion_webhook_pending_token --binding WEBHOOK_STATE --remote`. Do not paste the value into chat or logs.
5. Paste the pending token into Notion's verification UI.
6. **Only after Notion reports the subscription verified**, promote the accepted token:
   - Cloudflare: run `npx wrangler secret put NOTION_WEBHOOK_VERIFICATION_TOKEN` and enter the value at the interactive secret prompt (or use the equivalent authenticated dashboard secret UI).
   - Apps Script: add/update Script Property `NOTION_WEBHOOK_VERIFICATION_TOKEN` directly in Project Settings. Do not create a function that logs it.
7. Delete the pending KV key after promotion.
8. Normal webhook events can now pass signature validation at both the Worker and Apps Script.
9. After secure E2E passes, delete the old paused direct subscription.

For token rotation, remove/replace the active Cloudflare secret and Apps Script Script Property only through their authenticated secret-management interfaces, then repeat the pending → Notion verification → active promotion flow.

## E2E tests

Use non-production test Tasks.

### Status start/stop

1. `Ready → In Progress`.
2. Confirm an authoritative Notion `Task Time Events` row is created with Task, Actor, and `Started At`.
3. Confirm the same Notion Event ID appears in the Sheet projection.
4. `In Progress → Review`.
5. Confirm the Notion Time Event receives `Ended At`, then the Sheet row reflects the same end time.

### Done gate

1. While a Task still has an open Time Event, attempt `In Progress → Done`.
2. Confirm the integration restores `In Progress` and leaves the time event open; Done is not allowed to persist.
3. Move `In Progress → Review` and confirm the Time Event closes.
4. Attempt Done without `Result` or `Completed At`; confirm the Task is restored to `Review`.
5. Set completion evidence and then move to Done; confirm the Done state persists with no open Time Event.

### Reassignment

1. Start a Task with one mapped Actor.
2. While it remains `In Progress`, change `Assigned Agent` to another mapped Actor.
3. Confirm the original Actor's Notion Time Event closes and the new Actor receives a new open Time Event.
4. Clear the assignment while still `In Progress`; confirm any remaining open event closes rather than becoming orphaned.

### Retry/idempotency

Replay or cause a webhook retry and confirm no duplicate authoritative Task Time Event is created.

### Enrollment attack

1. With no active Worker secret configured, submit a self-signed fake handshake token.
2. Confirm it is only stored as pending.
3. Submit a normal event signed with that fake pending token and confirm the Worker rejects it because no operator-promoted active credential exists.

## Known limitation: aggregated delivery

Notion may aggregate `page.properties_updated` deliveries. The reconciler uses the Task's current authoritative state, which prevents orphan events and duplicate events, but extremely rapid intermediate Status/Actor transitions may be collapsed before delivery. The PoC must therefore evaluate whether those intermediate transitions matter at real Cloud42 task timescales.

The Done gate is reactive because Notion webhooks are post-change notifications. An invalid Done may exist briefly before the receiver rolls it back, but it cannot remain Done once the webhook is processed. Durable completion still requires closed timing and completion evidence first.

## Success criteria

- Notion remains authoritative for Task state and Task Time Events.
- Sheet rows are reproducible projections of Notion events for touched Tasks.
- No bearer credential appears in the webhook URL.
- Handshake tokens remain pending until an authenticated operator verifies them in Notion and explicitly promotes them.
- Active webhook signing tokens never appear in execution logs.
- Human / Chris / Claude / Codex Task activity uses the same state-driven mechanism.
- In-progress reassignment/clearing cannot leave the original Actor event open indefinitely.
- Done cannot persist while a Task Time Event is open or required completion evidence is missing.
- Duplicate webhook retries do not duplicate authoritative events.
- Normal conversation and non-Task activity create no event.
