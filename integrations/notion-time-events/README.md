# Notion Status → Task Time Events → Google Sheets projection

## Purpose

Automate Task-level effort recording without creating a second operational source of truth.

**Authoritative operational records remain in Notion:**

- `Stories & Tasks` is authoritative for Task state, assignment, completion evidence, and completion status.
- `Task Time Events` is authoritative for Actor start/end intervals.
- Google Sheets is a **derived projection for aggregation and analysis only**. It is never a completion gate or an authoritative effort ledger.

Flow:

`Notion Stories & Tasks change` → `Notion webhook` → `Cloudflare Worker (signature validation)` → `Apps Script zero-trust reconcile trigger` → `Notion Task Time Events (authoritative)` → `Google Sheets projection`

## Behavior

- `Status = In Progress` ensures exactly one authoritative open Task Time Event for the currently mapped `Assigned Agent`.
- Moving from `In Progress` to `Review`, `Blocked`, `Ready`, or `Backlog` closes every authoritative open event for the Task, regardless of current assignee.
- Changing or clearing `Assigned Agent` while the Task remains `In Progress` closes the old Actor event and opens the new Actor event when the new assignment maps to a supported Actor.
- Duplicate open events for the same Task/Actor are reconciled to one open event.
- `Done` is a **completion gate, not a stop trigger**. A Done webhook never closes a Time Event after completion.
- Done with an open Time Event is rejected by restoring `In Progress`; Done with closed timing but missing an applicable Time Event, `Result`, or `Completed At` is rejected by restoring `Review`.
- Valid completion order is: finish work → `Review` (time event closes) → record `Result` + `Completed At` → `Done`.
- Reconciliation snapshots are derived from the authoritative Notion page (`last_edited_time`, Status, Assigned Agent), not webhook-supplied status/actor/timestamp values.
- Sheet rows are upserted by the authoritative Notion Task Time Event page ID.

Actor mapping:

- `ChatGPT` → `Chris`
- `Claude Opus / Sonnet / Haiku` → `Claude`
- `Codex` → `Codex`
- `Human` → `Human`

Normal conversation and non-Task activity are outside this integration because no managed Task state is reconciled.

## Security model

### Notion → Worker

The Notion subscription URL contains **no bearer key or credential**. Normal webhook deliveries are accepted by the Worker only after `X-Notion-Signature` validates against the exact raw request body with the operator-promoted Worker secret `NOTION_WEBHOOK_VERIFICATION_TOKEN`.

The initial verification request is not treated as authenticated identity because its body carries the future HMAC token. The Worker stores that value only as `notion_webhook_pending_token` in the `WEBHOOK_STATE` KV namespace. It is not active and is not forwarded downstream. An authenticated operator must first paste the pending token into Notion's verification UI and see Notion accept it; only then is the same value promoted to the Worker secret.

A forged handshake can at most replace the pending candidate. Without operator promotion it cannot authenticate normal events.

### Worker → Apps Script

The Worker relays **only `{pageId}`**. It does not forward webhook status, actor, author, event timestamp, property values, verification token, or Notion signature.

Apps Script deliberately treats `pageId` as untrusted input and possesses **no webhook signing secret**. It immediately:

1. fetches that page from Notion using the existing private `NOTION_TOKEN`;
2. verifies the page belongs to the configured `Stories & Tasks` data source;
3. derives Status, Assigned Agent, editor and timing from the authoritative Notion page;
4. performs an idempotent reconciliation that can only move Task Time Events toward the state already represented in Notion.

This means even a direct caller that somehow knows the Apps Script URL cannot submit an arbitrary actor/status/timestamp or forge operational evidence. It can only request reconciliation of an existing configured Task. The Apps Script URL should still be kept out of public documentation to reduce nuisance traffic, but it is **not an authorization credential**.

The Notion webhook verification token is never copied into Apps Script. This avoids cross-system secret duplication and removes the prior token-logging risk entirely.

## Google Sheet

PoC spreadsheet:

https://docs.google.com/spreadsheets/d/1tjzjNqHEnPkzQGqB_ydxdWSKsdth27IUJaRrm_5xGks/edit

Tabs:

- `Time Events` — derived projection of Notion Task Time Events.
- `Summary` — Actor totals and open-event counts derived from the projection.
- `Config` — non-secret configuration reference.
- `Webhook Log` — hidden reconciliation snapshot diagnostics; contains no secrets.

Spreadsheet timezone must remain `Asia/Tokyo`.

`Event ID` is the authoritative Notion Task Time Event page ID. `Source Snapshot ID` is a hash of authoritative Task state used only for idempotency/projection diagnostics.

## Notion connection requirements

The Notion connection used by Apps Script must have access to both `Stories & Tasks` and `Task Time Events`, with capabilities sufficient to:

- read Task state, assignment, `Result`, `Started At`, and `Completed At`;
- update Task `Status` when the Done gate rejects an invalid transition;
- query Task Time Events;
- create Task Time Events; and
- update `Ended At` / `Note` on Task Time Events.

Creating Task Time Events through the Notion API requires **Insert Content** capability. Do not continue to secure E2E if the connection is read/update-only.

`NOTION_TOKEN` remains only in Apps Script Script Properties; never put it in source code, GitHub, the Sheet, a URL, or logs.

## Apps Script setup

1. Open the PoC Google Sheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with the current version from this directory.
3. Run `setup()` once. Existing `NOTION_TOKEN` is preserved; no webhook secret is added.
4. Redeploy the Web App as a new version. Execute as yourself and permit the Cloudflare Worker to POST without Google sign-in.
5. Keep the `/exec` URL private and configure it only as Cloudflare `APPS_SCRIPT_URL`.

The Apps Script endpoint is **not** the Notion subscription URL.

## Cloudflare Worker setup

Worker source is under `worker/`.

1. Create/bind a Workers KV namespace named `WEBHOOK_STATE`. With current Wrangler, `npx wrangler kv namespace create WEBHOOK_STATE --update-config` can add the binding to `wrangler.jsonc`.
2. Configure `APPS_SCRIPT_URL` in Cloudflare environment/secret storage with the Apps Script `/exec` URL. Do not commit it.
3. Deploy the Worker without an active `NOTION_WEBHOOK_VERIFICATION_TOKEN` for the enrollment phase.
4. Use only the Worker's public HTTPS URL as the Notion webhook URL. Do not append authentication query parameters.

The Worker requires no Notion API token.

## Trusted subscription enrollment

1. Keep the old direct-to-Apps-Script subscription paused while migrating.
2. Create a new Notion subscription whose URL is the Cloudflare Worker URL and event is `page.properties_updated`.
3. Notion sends the verification request. The Worker stores its token only as KV key `notion_webhook_pending_token` and does not relay or activate it.
4. In an authenticated Cloudflare dashboard session, read the pending KV value. Do not place it in chat, screenshots, GitHub, Sheets, URLs, or logs.
5. Paste that pending value directly into Notion's verification UI.
6. **Only after Notion reports the subscription verified**, promote the accepted value into Cloudflare secret `NOTION_WEBHOOK_VERIFICATION_TOKEN` using the authenticated dashboard or Wrangler's interactive secret prompt (`npx wrangler secret put NOTION_WEBHOOK_VERIFICATION_TOKEN`).
7. Delete the pending KV key after promotion.
8. Normal signed events now validate at the Worker and produce page-ID-only reconciliation requests to Apps Script.
9. After secure E2E passes, delete the old paused direct subscription.

The token is not configured in Apps Script at any point.

## Secure E2E

Use non-production test Tasks.

### Status start/stop

1. `Ready → In Progress`.
2. Confirm an authoritative Notion `Task Time Events` row is created with Task, Actor, and `Started At`.
3. Confirm the same Notion Event ID appears in the Sheet projection.
4. `In Progress → Review`.
5. Confirm the Notion Time Event receives `Ended At`, then the Sheet row reflects the same end time.

### Done gate

1. While a Task still has an open Time Event, attempt `In Progress → Done`.
2. Confirm the integration restores `In Progress` and leaves the Time Event open; Done is not allowed to persist.
3. Move `In Progress → Review` and confirm the Time Event closes.
4. Attempt Done without a prior Time Event, `Result`, or `Completed At`; confirm the Task is restored to `Review`.
5. Provide required evidence and then move to Done; confirm Done persists with an existing closed Time Event.

### Reassignment

1. Start a Task with one mapped Actor.
2. While it remains `In Progress`, change `Assigned Agent` to another mapped Actor.
3. Confirm the original Actor's Notion Time Event closes and the new Actor receives a new open Time Event.
4. Clear the assignment while still `In Progress`; confirm any remaining open event closes rather than becoming orphaned.

### Retry/idempotency

Cause/replay a webhook retry and confirm no duplicate authoritative Task Time Event is created. Repeat the same `{pageId}` reconciliation request directly and confirm it produces no extra operational mutation.

### Enrollment attack

1. With no active Worker secret configured, submit a self-signed fake handshake token.
2. Confirm it is stored only as pending.
3. Submit a normal event signed with that fake pending token and confirm the Worker rejects it because no operator-promoted active credential exists.

## Known limitations

Notion may aggregate `page.properties_updated` deliveries. The reconciler intentionally uses the Task's **current authoritative state** rather than intermediate webhook property claims. This prevents orphan/duplicate intervals but means extremely rapid intermediate Status/Actor transitions may be collapsed before reconciliation. The PoC must evaluate whether those transitions matter at real Cloud42 task timescales.

The Done gate is reactive because Notion webhooks are post-change notifications. An invalid Done may exist briefly before the receiver rolls it back, but it cannot remain Done once the event is processed. Durable completion still requires the Time Event and completion evidence first.

## Success criteria

- Notion remains authoritative for Task state and Task Time Events.
- Sheet rows are reproducible projections of Notion events for touched Tasks.
- No bearer credential appears in the webhook URL.
- Handshake tokens remain pending until an authenticated operator verifies them in Notion and explicitly promotes them in Cloudflare.
- The webhook signing secret exists only in Cloudflare and never appears in Apps Script or execution logs.
- Apps Script accepts no externally supplied operational claims beyond an untrusted page ID and re-fetches all authority from Notion.
- Human / Chris / Claude / Codex Task activity uses the same state-driven mechanism.
- In-progress reassignment/clearing cannot leave the original Actor event open indefinitely.
- Done cannot persist without an existing closed Time Event, `Result`, and `Completed At`.
- Duplicate webhook retries/reconciliation triggers do not duplicate authoritative events.
- Normal conversation and non-Task activity create no event.
