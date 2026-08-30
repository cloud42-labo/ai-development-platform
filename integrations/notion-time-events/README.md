# Notion Status → Task Time Events → Google Sheets projection

## Purpose

Automate Task-level effort recording without creating a second operational source of truth.

**Authoritative operational records remain in Notion:**

- `Stories & Tasks` is authoritative for Task state, assignment, completion evidence, and completion status.
- `Task Time Events` is authoritative for Actor start/end intervals.
- Google Sheets is a **derived projection for aggregation and analysis only**. It is never a completion gate or an authoritative effort ledger.

Flow:

`Notion Stories & Tasks change` → `Apps Script time-driven poll (last_edited_time cursor)` → `Notion Task Time Events (authoritative)` → `Google Sheets projection`

There is **no webhook, no public endpoint, and no receiver credential** anywhere in this integration. The reconciler is driven by a time-based trigger inside the bound Apps Script project and reads Notion over the authenticated API. See **Why there is no webhook receiver** below for the reasoning and the constraint it comes from.

## Behavior

- Each run asks Notion for `Stories & Tasks` pages whose `last_edited_time` is at or after the stored cursor (minus a fixed overlap), oldest first, and reconciles each one. The very first run (no cursor yet) additionally bootstraps every currently `Status = In Progress` Task directly, regardless of `last_edited_time` — see **Behavior of the cursor** below.
- `Status = In Progress` ensures exactly one authoritative open Task Time Event for the currently mapped `Assigned Agent`.
- Moving from `In Progress` to `Review`, `Blocked`, `Ready`, or `Backlog` closes every authoritative open event for the Task, regardless of current assignee.
- Changing or clearing `Assigned Agent` while the Task remains `In Progress` closes the old Actor event and opens the new Actor event when the new assignment maps to a supported Actor.
- Duplicate open events for the same Task/Actor are reconciled to one open event.
- `Done` is a **completion gate, not a stop trigger**. Reconciling a Done Task never closes a Time Event after completion.
- Done with an open Time Event is rejected by restoring `In Progress`; Done with closed timing but missing an applicable Time Event, `Result`, or `Completed At` is rejected by restoring `Review`. "Applicable" means a closed Time Event whose `Started At` is at or after the Task's current `Started At` — a closed event left over from a prior, already-completed execution does not, by itself, satisfy Done for a later reopen.
- `Completed At` must not just be present: it must be at or after the Task's current `Started At` and at or after the applicable closed event's `Ended At`. A `Completed At` left over from a prior, already-finished execution (Notion does not clear it on reopen) does not satisfy Done for a later reopen either.
- A Task observed as `Done` is **always** re-verified by the gate, even if its reconciliation snapshot happens to hash identically to one already processed (Notion reports `last_edited_time` at only minute granularity, so a same-minute rollback-and-retry can collide) — an invalid Done is never silently left in place because of a hash collision.
- A newly opened Time Event starts from the Task's current `Started At` whenever that is at or after every timestamp already on file for the Task — covering both a first-ever event and a reopened Task — rather than from whatever moment the poll happened to observe the edit, so a later same-window edit (e.g. a reassignment moments after restart) cannot silently drop the time before it.
- Valid completion order is: finish work → `Review` (time event closes) → record `Result` + `Completed At` → `Done`.
- Reconciliation snapshots are derived from the authoritative Notion page (`last_edited_time`, Status, Assigned Agent). Recorded interval timestamps come from `last_edited_time` on the Task, **not** from when the poll happened, so a poll interval does not distort recorded effort.
- Sheet rows are upserted by the authoritative Notion Task Time Event page ID.

Actor mapping:

- `ChatGPT` → `Chris`
- `Claude Opus / Sonnet / Haiku` → `Claude`
- `Codex` → `Codex`
- `Human` → `Human`

Normal conversation and non-Task activity are outside this integration because no managed Task state is reconciled.

## Why there is no webhook receiver

The earlier design in this directory used a Notion webhook subscription. Notion proves a webhook delivery's authenticity **only** through the `X-Notion-Signature` request header, computed as HMAC-SHA256 of the raw body under the subscription's verification token.

A Google Apps Script Web App **cannot read request headers**. `doPost(e)` exposes the body, query parameters, and content type; the request headers are not in the event object, and Google has stated this will not be added. Consequently:

- Apps Script can never verify a Notion signature itself.
- The only credential an Apps Script endpoint can check is one placed in the URL or the body — a static bearer secret, which is exactly what Codex flagged as a P1 (the URL becomes a bearer credential retained in Notion configuration and browser history).
- Keeping webhooks therefore requires a **separate relay service** that can read headers, plus a second shared secret to authenticate the relay's own hop into Apps Script.

The relay was real work solving a real constraint, but the constraint only exists because of the webhook. This integration's reconciler never trusted webhook content in the first place: the delivery was reduced to a page ID, and every field driving a mutation was re-fetched from Notion. A delivery was only ever a "something changed, go look" ping — and Apps Script can generate that ping locally from a time-driven trigger over `last_edited_time`.

Removing the webhook removes the header problem, the relay, the relay secret, the verification-token enrollment dance, and the public endpoint, without changing what gets recorded.

Trade-off, stated plainly: reconciliation is no longer near-instant. A change is picked up within one poll interval (5 minutes by default, tunable to 1). This delays a Done-gate rollback by up to that interval; it does **not** shift recorded `Started At` / `Ended At` values, which are read from Notion's own `last_edited_time`.

## Security model

The integration has no inbound attack surface: nothing outside the Apps Script project can invoke the reconciler, so there is no request to authenticate.

- **One secret, one place.** `NOTION_TOKEN` lives only in Apps Script Script Properties. There is no webhook verification token and no relay secret to generate, duplicate across systems, rotate in lockstep, or leak. Never put the token in source code, GitHub, the Sheet, a URL, or logs.
- **No public endpoint.** The project defines no `doGet` / `doPost`, and the Web App deployment is removed. An attacker who learns the script ID has nothing to call.
- **No credential in any URL.** Satisfied by construction rather than by mitigation — there is no receiver URL.
- **Notion remains the only source of operational truth.** Every mutation is derived from a page Notion returned over an authenticated call; the reconciler can only move Task Time Events toward the state Notion already holds, and repeating a pass over the same page is a no-op.
- **Least privilege on the Notion side.** The connection needs access to `Stories & Tasks` and `Task Time Events` only.

`reconcileTaskById(pageId)` exists as an operator escape hatch for E2E and debugging. It runs only from the Apps Script editor, as the project owner, and is not reachable from outside.

## Google Sheet

PoC spreadsheet:

https://docs.google.com/spreadsheets/d/1tjzjNqHEnPkzQGqB_ydxdWSKsdth27IUJaRrm_5xGks/edit

Tabs:

- `Time Events` — derived projection of Notion Task Time Events.
- `Summary` — Actor totals and open-event counts derived from the projection.
- `Config` — non-secret configuration reference.
- `Sync Log` — hidden reconciliation snapshot diagnostics; contains no secrets.

Spreadsheet timezone must remain `Asia/Tokyo`.

`Event ID` is the authoritative Notion Task Time Event page ID. `Source Snapshot ID` is a hash of authoritative Task state used only for idempotency/projection diagnostics.

## Notion connection requirements

The Notion connection used by Apps Script must have access to both `Stories & Tasks` and `Task Time Events`, with capabilities sufficient to:

- read Task state, assignment, `Result`, `Started At`, and `Completed At`;
- update Task `Status` when the Done gate rejects an invalid transition;
- query Task Time Events;
- create Task Time Events; and
- update `Ended At` / `Note` on Task Time Events.

Creating Task Time Events through the Notion API requires **Insert Content** capability. Do not continue to E2E if the connection is read/update-only.

## Setup

1. Open the PoC Google Sheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with the current version from this directory.
3. Confirm `NOTION_TOKEN` is present under **Project Settings → Script Properties**. Add it there through the editor UI if it is missing; never set it from committed code.
4. Run `setup()` once. It records the spreadsheet/data-source IDs, ensures the `Time Events` and `Sync Log` tabs, and installs the `pollTaskChanges` time-driven trigger. Authorize the script when prompted.
5. Run `showSetupInfo()` and confirm `notionTokenConfigured: true`, `syncTriggersInstalled: 1`, and the expected `pollIntervalMinutes`.

There is nothing to deploy: the project is not a Web App. If a Web App deployment from the earlier webhook design still exists, archive it (**Deploy → Manage deployments → Archive**) so no public endpoint remains.

### Poll interval

`POLL_INTERVAL_MINUTES` (Script Property) accepts `1`, `5`, `10`, `15`, or `30`; anything else falls back to `5`. Change it and re-run `installSyncTrigger()` to apply.

`5` is the default because Apps Script caps total trigger runtime per day (90 minutes on a consumer account, 6 hours on Workspace) and a 1-minute trigger burns roughly five times the budget for reconciliation that is measured in hours. Use `1` only on a Workspace account, or after confirming headroom in the Apps Script execution dashboard.

## Behavior of the cursor

`LAST_SYNC_CURSOR` (Script Property) holds the timestamp the next poll starts from. Each run:

- queries from `cursor - 2 minutes`, because Notion reports `last_edited_time` at minute granularity and a page can be indexed fractionally after it is written;
- **bootstraps once** when no cursor exists yet (a fresh deploy, or after clearing `LAST_SYNC_CURSOR`): in addition to the time-window query, it separately queries every Task currently `Status = In Progress` by Status, independent of `last_edited_time`, and merges the two lists by page ID. Without this, a Task that had already been `In Progress` for longer than the one-hour initial lookback would never receive an open Time Event, and would then permanently fail the Done gate for lack of any applicable interval once it eventually moved;
- re-reads are free — the reconciler's snapshot hash (`page id | last_edited_time | Status | Assigned Agent`) drops anything already processed, reported as a `duplicate:` outcome. **Except a Task observed as `Done`**: that hash is never trusted to skip a Done re-read, because Notion's minute-granular `last_edited_time` means a same-minute rollback-and-retry can hash identically to an already-processed attempt — Done is always re-verified by the gate;
- reconciles at most 25 Tasks **that actually do something** per run, so a large backlog of real work cannot exceed the Apps Script runtime limit. An outcome that made no Notion write does **not** count against that limit — it is skipped for free: a `duplicate:`/`ignored:` re-read, and also `done_gate_passed` (an already-valid Done left exactly as it is, which the point above requires re-checking on every poll regardless). This matters because the 2-minute overlap always re-includes Tasks from the previous run, and a Done Task always gets re-verified: if a dense cluster of either — duplicates, or 25+ Tasks that are legitimately already Done — were charged against the same cap as new work, that cluster (sorted first, being oldest) would be re-selected and re-processed every run, and Tasks behind it would never be reached. A rejected Done (`done_gate_rejected:...`) still counts — it made a real write (the rollback) and is exactly the case always-reverifying Done exists to keep catching. A safety bound (`MAX_TASKS_SCANNED_PER_RUN`, 500) still limits how many Tasks a single run will even look at, independent of how many turn out to be free re-skips;
- advances the cursor to the moment the query was issued, but only for a run that gets through its entire batch. A run that stops early (either bound above) leaves the cursor on the last Task it actually looked at, and the next run continues from there. A failed or skipped run leaves the cursor alone entirely, so the window is retried.

To re-run a window deliberately, clear `LAST_SYNC_CURSOR` (the next poll then bootstraps again and looks back one hour) or call `reconcileTaskById(pageId)` for a single Task.

## E2E

Use non-production test Tasks. Allow up to one poll interval for each step, or call `reconcileTaskById(pageId)` from the editor to reconcile immediately.

### Status start/stop

1. `Ready → In Progress`.
2. Confirm an authoritative Notion `Task Time Events` row is created with Task, Actor, and `Started At`.
3. Confirm the same Notion Event ID appears in the Sheet projection.
4. `In Progress → Review`.
5. Confirm the Notion Time Event receives `Ended At`, then the Sheet row reflects the same end time.

### Done gate

1. While a Task still has an open Time Event, set it to `Done`.
2. Confirm the integration restores `In Progress` and leaves the Time Event open; Done is not allowed to persist.
3. Move `In Progress → Review` and confirm the Time Event closes.
4. Set Done without a prior Time Event, `Result`, or `Completed At`; confirm the Task is restored to `Review`.
5. Provide required evidence and then move to Done; confirm Done persists with an existing closed Time Event.
6. **Reopen correlation**: complete a Task through Done once (closed Time Event, `Result`, `Completed At` all present). Reopen it (`Done → Backlog` or `Ready`), then move it back to `In Progress` and immediately to `Done` again within a single poll interval, so no new Time Event opens for this second execution. Confirm Done is rejected and the Task is restored to `Review`/`In Progress` — the old, pre-reopen closed event must not satisfy the gate for the new execution. Then run the normal start/stop flow for the new execution and confirm Done then persists.
7. **Stale Completed At on reopen**: after step 6's reopen, leave the Task's old `Completed At` in place (do not clear it) and run the new execution's own start/stop flow so it gets its own closed, applicable Time Event and fresh `Result`. Attempt Done without updating `Completed At`. Confirm Done is rejected (the stale, pre-reopen `Completed At` does not satisfy the gate). Update `Completed At` to a time at or after the new event's `Ended At` and confirm Done then persists.
8. **Same-minute retry**: set Done on a Task missing required evidence, confirm the rollback, then — within the same minute — set Done again, still missing evidence. Confirm the second attempt is also rejected (not silently accepted through a snapshot-hash collision).

### Reassignment

1. Start a Task with one mapped Actor.
2. While it remains `In Progress`, change `Assigned Agent` to another mapped Actor.
3. Confirm the original Actor's Notion Time Event closes and the new Actor receives a new open Time Event.
4. Clear the assignment while still `In Progress`; confirm any remaining open event closes rather than becoming orphaned.

### Idempotency

1. Call `reconcileTaskById(pageId)` twice in a row for an unchanged Task and confirm the second call reports `duplicate:` and makes no Notion mutation.
2. Confirm the overlapping poll window (a Task edited within the last 2 minutes is re-read on the next run) creates no duplicate authoritative Time Event.
3. **Fresh-deploy bootstrap**: with a test Task already `Status = In Progress` and edited more than an hour ago, clear `LAST_SYNC_CURSOR` and run `pollTaskChanges()` (or wait for the trigger). Confirm the Task receives an open Time Event even though its `last_edited_time` predates the initial lookback window.

### No public endpoint

1. Confirm **Deploy → Manage deployments** lists no active Web App deployment for this project.
2. Confirm `Code.gs` defines no `doGet` / `doPost`.

## Known limitations

The reconciler intentionally uses the Task's **current authoritative state** rather than a change history. A Task edited into and back out of `In Progress` inside a single poll interval is only ever observed in its final state, so that intermediate spell is not recorded. This is the same property the webhook design had — Notion aggregates `page.properties_updated` deliveries — and the PoC must evaluate whether those transitions matter at real Cloud42 task timescales.

The Done gate is reactive: it observes a Status that has already been set. An invalid Done may exist for up to one poll interval before the reconciler rolls it back, but it cannot remain Done once the Task is reconciled. Durable completion still requires the Time Event and completion evidence first.

`last_edited_time` is minute-granular, so two distinct edits to the same Task within one minute produce the same reconciliation snapshot and are reconciled once, against the later state.

## Success criteria

- Notion remains authoritative for Task state and Task Time Events.
- Sheet rows are reproducible projections of Notion events for touched Tasks.
- No credential appears in any URL, and no public endpoint exists to hold one.
- `NOTION_TOKEN` is the only secret, held only in Apps Script Script Properties, and never logged.
- The reconciler is reachable only from inside the Apps Script project (time-driven trigger, or an operator running `reconcileTaskById` from the editor).
- Beyond the Notion API responses it fetches itself, the reconciler accepts no externally supplied operational claims.
- Human / Chris / Claude / Codex Task activity uses the same state-driven mechanism.
- In-progress reassignment/clearing cannot leave the original Actor event open indefinitely.
- Done cannot persist without a closed Time Event **applicable to the current execution** (started at or after the Task's current `Started At`), a `Completed At` that is itself no earlier than that Started At or the applicable event's own Ended At, `Result`, and `Completed At`. A closed event or a `Completed At` left over from a prior, already-completed execution does not satisfy a later reopen's Done gate.
- An invalid Done cannot escape re-verification through a minute-granularity snapshot-hash collision; Done is always re-checked.
- Repeated reconciliation of an unchanged Task does not duplicate authoritative events.
- A Task already `In Progress` before the first-ever poll still receives an open Time Event, via the fresh-deploy bootstrap.
- A dense cluster of already-reconciled Tasks inside the overlap window cannot permanently stall reconciliation of Tasks behind it.
- A reopened Task's new interval starts from its current `Started At`, not from a later edit the poll happens to observe first.
- Normal conversation and non-Task activity create no event.

## Tests

`node --test test/*.test.mjs` from this directory. `test/support/gas-sandbox.mjs` runs `Code.gs` under a Node `vm` with a minimal Apps Script shim (Properties, Lock, Utilities, Spreadsheet, ScriptApp, UrlFetch), so the polling cursor, batching, trigger installation, reconciliation and Done gate are all covered without a live Apps Script project. CI runs the same command (`.github/workflows/notion-time-events.yml`).
