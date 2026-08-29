# Notion Status → Task Time Events → Google Sheets projection

## Purpose

Automate Task-level effort recording without creating a second operational source of truth.

**Authoritative operational records remain in Notion:**

- `Stories & Tasks` is authoritative for Task state and assignment.
- `Task Time Events` is authoritative for Actor start/end intervals.
- Google Sheets is a **derived projection for aggregation and analysis only**. It is never a completion gate or an authoritative effort ledger.

Flow:

`Notion Stories & Tasks change` → `Notion webhook` → `Cloudflare Worker (signature validation)` → `Apps Script` → `Notion Task Time Events (authoritative write)` → `Google Sheets projection`

## Behavior

- `Status = In Progress` ensures exactly one authoritative open Task Time Event for the currently mapped `Assigned Agent`.
- Leaving `In Progress` closes every authoritative open event for the Task, regardless of the Task's current assignee.
- Changing or clearing `Assigned Agent` while the Task remains `In Progress` closes the old Actor event and opens the new Actor event when the new assignment maps to a supported Actor.
- Duplicate open events for the same Task/Actor are reconciled to one open event.
- Webhook retries are idempotent: authoritative Notion state is queried before writes, and webhook IDs are additionally deduplicated in the projection log.
- After each authoritative reconciliation, the Task's Notion Time Events are projected into Google Sheets. The Sheet can therefore be rebuilt from Notion records.

Actor mapping:

- `ChatGPT` → `Chris`
- `Claude Opus / Sonnet / Haiku` → `Claude`
- `Codex` → `Codex`
- `Human` → `Human`

Normal conversation and non-Task activity are outside this integration because no managed Task Status/assignment event is involved.

## Security model

The Notion subscription URL contains **no bearer key or credential**.

Notion signs webhook deliveries with `X-Notion-Signature` using HMAC-SHA256 and the subscription verification token. The Cloudflare Worker validates the signature over the exact raw body before forwarding anything. The Worker stores the verification token in a `WEBHOOK_STATE` KV binding after the initial verification handshake.

Apps Script independently verifies the original Notion signature again. The Worker forwards only:

- the exact raw Notion request body; and
- the original `X-Notion-Signature` value.

No relay secret is required, and no credential is placed in a URL. Replayed deliveries remain safe because webhook IDs and authoritative Notion Time Event state are idempotent.

## Google Sheet

PoC spreadsheet:

https://docs.google.com/spreadsheets/d/1tjzjNqHEnPkzQGqB_ydxdWSKsdth27IUJaRrm_5xGks/edit

Tabs:

- `Time Events` — derived projection of Notion Task Time Events.
- `Summary` — Actor totals and open-event counts derived from the projection.
- `Config` — non-secret configuration reference.
- `Webhook Log` — hidden delivery/idempotency diagnostics.

Spreadsheet timezone must remain `Asia/Tokyo`.

The `Event ID` in projected rows is the authoritative Notion Task Time Event page ID, so the projection can be reconciled deterministically.

## Notion connection requirements

The Notion connection used by Apps Script must have access to both `Stories & Tasks` and `Task Time Events`, with capabilities sufficient to:

- read Task state and assignment;
- query Task Time Events;
- create Task Time Events; and
- update `Ended At` / `Note` on Task Time Events.

Creating Task Time Events through the Notion API requires **Insert Content** capability. Do not continue to production E2E if the connection is read/update-only.

`NOTION_TOKEN` remains in Apps Script Script Properties; never put it in source code, GitHub, the Sheet, a URL, or logs.

## Apps Script setup

1. Open the PoC Google Sheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with the current version from this directory.
3. Run `setup()` once. Existing `NOTION_TOKEN` is preserved.
4. Before registering a replacement Notion subscription, run `resetVerificationToken()` once. This prevents a previous subscription token from being accepted for a new subscription.
5. Redeploy the Web App as a new version. Execute as yourself and allow the Cloudflare Worker to POST without Google sign-in.
6. Keep the `/exec` URL private from documentation. It is not an authentication credential, but it is only an internal relay target.

The Apps Script endpoint is **not** registered directly with Notion.

## Cloudflare Worker setup

Worker source is under `worker/`.

1. Create/bind a Workers KV namespace named `WEBHOOK_STATE`. With current Wrangler, `npx wrangler kv namespace create WEBHOOK_STATE --update-config` can add the binding to `wrangler.jsonc`.
2. Configure `APPS_SCRIPT_URL` in Cloudflare's secret/environment storage with the Apps Script `/exec` URL. Do not commit the value.
3. Deploy the Worker.
4. If replacing a prior Notion subscription, clear the KV key `notion_webhook_verification_token` before registering the new subscription.
5. Use only the Worker's public HTTPS URL as the Notion webhook URL. Do not append authentication query parameters.

The Worker requires no Notion API token. It receives the subscription verification token from Notion's handshake and stores it in KV for validating later deliveries.

## Create the Notion webhook subscription

1. Keep the old direct-to-Apps-Script subscription paused while migrating.
2. Create a new subscription whose URL is the Cloudflare Worker URL.
3. Subscribe to `page.properties_updated`.
4. The Worker validates and forwards the initial verification request; Apps Script stores the same verification token after independently validating the signature.
5. Run `showVerificationToken()` in Apps Script and paste that value into Notion's verification UI.
6. After the Worker-based subscription is active and E2E has passed, delete the old direct subscription.

If a subscription is recreated/rotated, clear both the Worker's KV token and Apps Script's stored verification token first; a mismatched new verification token is intentionally rejected.

## E2E tests

Use non-production test Tasks.

### Status start/stop

1. `Ready → In Progress`.
2. Confirm an authoritative Notion `Task Time Events` row is created with Task, Actor, and `Started At`.
3. Confirm the same Event ID appears in the Sheet projection.
4. `In Progress → Review`.
5. Confirm the Notion Time Event receives `Ended At` first, then the Sheet row reflects the same end time.

### Reassignment

1. Start a Task with one mapped Actor.
2. While it remains `In Progress`, change `Assigned Agent` to another mapped Actor.
3. Confirm the original Actor's Notion Time Event closes and the new Actor receives a new open Time Event.
4. Clear the assignment while still `In Progress`; confirm any remaining open event closes rather than becoming orphaned.

### Retry/idempotency

Replay or cause a webhook retry and confirm no duplicate authoritative Task Time Event is created.

## Known limitation: aggregated delivery

Notion may aggregate `page.properties_updated` deliveries. The reconciler uses the Task's current authoritative state, which prevents orphan events and duplicate events, but extremely rapid intermediate Status/Actor transitions may be collapsed before delivery. The PoC must therefore evaluate whether those intermediate transitions matter at real Cloud42 task timescales.

## Success criteria

- Notion remains authoritative for Task state and Task Time Events.
- Sheet rows are reproducible projections of Notion events.
- Notion webhook signatures are validated before processing; no bearer credential appears in the webhook URL.
- Human / Chris / Claude / Codex Task activity uses the same state-driven mechanism.
- In-progress reassignment/clearing cannot leave the original Actor event open indefinitely.
- Duplicate webhook retries do not duplicate authoritative events.
- Normal conversation and non-Task activity create no event.
