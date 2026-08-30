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
- The Task's `Started At` must itself look fresh before it can identify "the current execution" at all: it must be at or after every event already on file for the Task that does not belong to the current execution. A reopened Task whose `Started At` was never actually updated (Notion does not clear it, and a later event naturally still starts *after* that stale marker regardless) is rejected as `stale_task_started_at`, rather than letting an untouched marker rubber-stamp whatever event happens to close next. A single execution can produce more than one closed event — an in-progress reassignment (including an assignee being cleared and only later reassigned, which can leave a real time gap with no open event in between) closes the outgoing actor's event, and a duplicate open event is closed by the reconciler's own duplicate-cleanup — neither ever ends an execution, only leaving `In Progress` does. So membership is decided by each closed event's own `Note` markers, not by timestamp adjacency: the seed is every closed event sharing the single latest `Ended At` on the Task (a tie — more than one event can close at the exact same observed moment, e.g. a simultaneous reassignment — and every member of that tie is exempt from counting as prior evidence, never just one arbitrarily chosen "most recent" one; it is the candidate applicable evidence this whole check exists to validate, never evidence against itself) **except an event explicitly, retroactively marked `Boundary=left_in_progress`** (see below) — `last_edited_time` is minute-granular, so a genuinely prior execution's own boundary close and the current execution's fresh close can coincidentally land on the exact identical recorded `Ended At` by pure chance, not just a true simultaneous multi-event close, and that marker's entire purpose is a strong, deliberate claim ("this is confirmed to be where a past execution genuinely ended") that a mere timestamp tie must never override. A plain `left_in_progress` close with no such marker stays tie-seedable regardless: that is the ordinary, ambiguous case (e.g. a Task first observed after leaving `In Progress` with multiple open events, all genuinely closed together in this same call) the tie rule exists to handle in the first place, and `Boundary=` is never stamped on it. Beyond the seed, an event closed `reassignment` or `duplicate_reconciliation` is *also* part of the current execution — unconditionally, however far its own `Ended At` sits from the seed (an assignment gap, or a duplicate detected well after the fact, are exactly this; timestamp adjacency alone is not a sufficient signal, since a genuinely prior execution's own closing event *can* coincidentally touch a later, separate execution's opening `Started At`, which a purely adjacency-based chain would wrongly absorb) — **unless that same event also carries a retroactive `Boundary=left_in_progress` marker**, in which case it is prior-execution evidence despite its `Reason=`. That marker exists because a `reassignment`/`duplicate_reconciliation` close never by itself signals that an execution ended (only leaving `In Progress` does) — so a Task that left `In Progress` with nothing open to close (the only open event having already been closed earlier that same poll by a reassignment, say) would otherwise leave no signal at all that the execution genuinely ended there, letting a real prior execution's reassignment-only closed event go on looking "current" forever, including across a later reopen. `reconcileAuthoritativeTimeEvents_` stamps this marker itself, retroactively, on the most-recently-closed event whenever it observes exactly that situation (Task leaving `In Progress`, zero open events) — a side-by-side addition to the event's existing `Reason=`, never overwriting it, since both facts (why it closed, and that this is also where its execution ended) need to survive together. Anything else — a genuine `left_in_progress` close outside the seed, or no reason at all (legacy data) — stays prior-execution evidence even if it happens to coincide in time with something in the current execution.
- `Completed At` must not just be present: it must be at or after the Task's current `Started At` and at or after the applicable closed event's `Ended At`. A `Completed At` left over from a prior, already-finished execution (Notion does not clear it on reopen) does not satisfy Done for a later reopen either.
- `Result` must not just be present either — it carries no timestamp of its own to check freshness against, so instead each closed event is stamped with a fingerprint of the `Result` text that validated Done against it. If that exact text already validated a *different*, earlier closed event for the same Task, Done is rejected as stale: the text was never actually refreshed for this execution. A stamp matching the *current* applicable event is expected and fine — Done is always re-verified (see below), so an unchanged, already-validated `Result` recurs on every re-check of a still-Done Task. An event's Note can carry more than one fingerprint over its lifetime — Result can be edited more than once while a Task stays Done on the same applicable event, each edit adding its own `Result Fingerprint=` stamp rather than replacing the last — so the reuse check is against every fingerprint that event ever recorded, not only the most recent one. This check can only catch a reuse against an event it once stamped, so a Task that reached Done under an *older* Code.gs revision without this stamping feature has an unstamped applicable event, and its stale Result would go undetected by exactly one reopen. `backfillResultFingerprints_()` (an operator escape hatch, see "Behavior of the cursor") closes this for an existing live deployment being upgraded to this revision — run it once, immediately after deploying, before any already-Done Task is reopened. A fresh deploy has no pre-existing Done history and needs no backfill: every event is stamped on its own first Done pass from day one. Every write to a Time Event's `Note` field (a fingerprint stamp, or a close's `Reason=`/`End Status=` metadata) goes through a shared `appendNote_` helper that keeps the combined text within Notion's per-field limit by dropping prior metadata first, never by truncating from the end — which would risk cutting off the marker being written right now (e.g. silently corrupting a fresh Result Fingerprint stamp) rather than just losing old history. Which metadata goes first: oldest *non-fingerprint* segments (`Reason=`/`Snapshot=`/`Changed By=`/`End Status=` — only the newest of each ever matters, so losing old ones is harmless) before ever touching a `Result Fingerprint=` segment, and only the oldest fingerprint once no non-fingerprint segments remain — stale-Result detection needs every fingerprint an event ever recorded to survive as long as possible, so those are evicted last, not first.
- A Task observed as `Done` is **always** re-verified by the gate, even if its reconciliation snapshot happens to hash identically to one already processed (Notion reports `last_edited_time` at only minute granularity, so a same-minute rollback-and-retry can collide) — an invalid Done is never silently left in place because of a hash collision.
- A newly opened Time Event starts from the Task's current `Started At` whenever that is at or after every timestamp already on file for the Task — covering both a first-ever event and a reopened Task — rather than from whatever moment the poll happened to observe the edit, so a later same-window edit (e.g. a reassignment moments after restart) cannot silently drop the time before it. When the new Actor's event opens because a reassignment *just* closed the outgoing Actor's event this same call, "every timestamp already on file" also counts that reassignment's own moment even though the in-memory Task/event snapshot this call started with doesn't yet reflect the close it itself just made — otherwise an unrelated, unchanged `Started At` from *before* the reassignment would look "fresh" by comparison to a now-stale in-memory view, and the replacement Actor's event would open at the wrong, earlier moment, overlapping the outgoing Actor's own interval and double-counting effort.
- Valid completion order is: finish work → `Review` (time event closes) → record `Result` + `Completed At` → `Done`.
- Reconciliation snapshots are derived from the authoritative Notion page (`last_edited_time`, Status, Assigned Agent). Recorded interval timestamps come from `last_edited_time` on the Task, not from when the poll happened to run — this avoids polling-frequency itself distorting recorded effort, though `last_edited_time` carries its own bounded imprecision; see **Known limitations**.
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

Trade-off, stated plainly: reconciliation is no longer near-instant. A change is picked up within one poll interval (5 minutes by default, tunable to 1) under normal load, more under a large write-producing backlog. This delays a Done-gate rollback correspondingly, and — see **Known limitations** — the same page-level `last_edited_time` used for both detection and recorded `Ended At`/boundary timestamps carries an imprecision of its own, for a distinct reason: Notion's public API exposes no per-property change history, only one edit time for the whole page.

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
- **bootstraps** by additionally querying every Task currently `Status = In Progress` by Status, independent of `last_edited_time`, and merging the two lists by page ID — until that has genuinely finished, tracked by its own `BOOTSTRAP_ACTIVE_DONE` flag rather than by whether `LAST_SYNC_CURSOR` is set. Without the active-Task query at all, a Task that had already been `In Progress` for longer than the one-hour initial lookback would never receive an open Time Event, and would then permanently fail the Done gate for lack of any applicable interval once it eventually moved. Tracking completion separately from the cursor matters because the very first run sets `LAST_SYNC_CURSOR` from the incremental side regardless of whether the active-Task query itself was complete — if that query is wide enough to hit `QUERY_PAGE_SAFETY_LIMIT` and truncate, `BOOTSTRAP_ACTIVE_DONE` stays unset (and a `BOOTSTRAP_ACTIVE_RESUME_CURSOR`, sorted ascending, records how far it got) so the *next* run resumes it, instead of a cursor-coupled flag disabling the active-Task query forever after one incomplete attempt. The resumed query itself uses `on_or_after` (not a strict `after`) plus a local tie-offset skip — the same pattern as `LAST_SYNC_CURSOR_TIE_OFFSET`, tracked separately as `BOOTSTRAP_ACTIVE_RESUME_TIE_OFFSET` — so it correctly resumes within a tied timestamp instead of silently dropping the remainder of one;
- re-reads are free — the reconciler's snapshot hash (`page id | last_edited_time | Status | Assigned Agent`) drops anything already processed, reported as a `duplicate:` outcome. **Except a Task observed as `Done`**: that hash is never trusted to skip a Done re-read, because Notion's minute-granular `last_edited_time` means a same-minute rollback-and-retry can hash identically to an already-processed attempt — Done is always re-verified by the gate;
- reconciles at most 25 Tasks **that actually do something** per run, so a large backlog of real work cannot exceed the Apps Script runtime limit. An outcome that made no Notion write does **not** count against that limit — it is skipped for free: a `duplicate:`/`ignored:` re-read, and also a *steady-state* `done_gate_passed` (an already-valid Done left exactly as it is, which the point above requires re-checking on every poll regardless). This matters because the 2-minute overlap always re-includes Tasks from the previous run, and a Done Task always gets re-verified: if a dense cluster of either — duplicates, or 25+ Tasks that are legitimately already Done — were charged against the same cap as new work, that cluster (sorted first, being oldest) would be re-selected and re-processed every run, and Tasks behind it would never be reached. The *first* time an already-valid Done event is verified (nothing has stamped it with its Result's fingerprint yet — a brand-new completion, or a legacy event from before this fingerprinting existed), the gate reports the distinct outcome `done_gate_passed:stamped` and it **does** count against the cap: it makes a real write (stamping the Result fingerprint onto the Time Event, for future reopen-staleness detection), so a cohort larger than 25 first-time stamps stops at the cap like any other write-cohort rather than writing all of them in one run. A rejected Done (`done_gate_rejected:...`) also still counts — it made a real write (the rollback) and is exactly the case always-reverifying Done exists to keep catching. **There is deliberately no separate, smaller cap on free outcomes either** — an earlier version added one and it reintroduced the identical stall for a large free-outcome cohort instead of a large write-cohort. A free-outcome scan is bounded only by how many Tasks the run's own query returned, which pagination already caps at 5000 (below); a pathologically large simultaneous free-outcome cohort (a bulk edit, or hundreds of Tasks that are all legitimately Done and already stamped, sharing one timestamp) still costs a real Time Events query each, so it can make a single run slow, not just cheap — see the wall-clock bound below for why that cannot strand the cursor;
- also stops — regardless of `MAX_TASKS_PER_RUN` or how many Tasks remain — once a run has been going for `MAX_RUN_DURATION_MS` (4 minutes). Apps Script kills a run outright at its own per-execution limit (6 minutes on a consumer account, 30 on Workspace); an uncaught kill there never reaches the cursor-persist step, so a run that ran the platform out of time would lose all progress and re-scan the identical prefix on the next trigger, forever — the same indefinite stall a missing per-run cap causes, just via wall clock instead of a task count. Crossing the budget instead stops the scan early and persists the cursor at the last Task actually reconciled, exactly like hitting `MAX_TASKS_PER_RUN` does;
- each underlying Notion query (the time-window query, the bootstrap active-Task query, and the per-Task Time Events query) is itself paginated up to `QUERY_PAGE_SAFETY_LIMIT` (50 pages, 5000 rows) via a shared `paginateNotionQuery_` helper. Hitting that limit sets `truncated: true` rather than silently dropping the remainder — `pollTaskChanges` folds this into the same cursor-hold behavior as an early-stopped scan (below), so a single incremental window matching more than 5000 changed Tasks cannot cause the cursor to skip past whatever wasn't retrieved;
- advances the cursor to the moment the query was issued, but only for a run that gets through its entire batch *and* whose source query(ies) were not truncated. A run that stops early, or was truncated at the source, leaves the cursor on the last Task it actually looked at, and the next run continues from there. A failed or skipped run leaves the cursor alone entirely, so the window is retried.
- **resumes correctly when a stop lands inside a tied timestamp.** `LAST_SYNC_CURSOR` alone can only express a moment in time, not "partway through the Tasks that share that exact moment" — and Notion's `last_edited_time` is minute-granular, so a bulk edit (or many Done Tasks re-verified in the same poll minute) commonly produces a group of Tasks sharing one identical value. If a capped run (`MAX_TASKS_PER_RUN` or `MAX_RUN_DURATION_MS`) stops in the middle of such a group, the next run's `on_or_after: cursor - overlap` query returns the *entire* group again from its own start — harmless for most outcomes (an already-processed Task is a free `duplicate:`), but a Done Task is never dedup-skipped and always costs a real Time Events query to re-verify, so a tied Done cohort larger than one run's budget would otherwise be rescanned from its own start forever, never draining and never reaching whatever sorts behind it. `LAST_SYNC_CURSOR_TIE_OFFSET` (Script Property, an integer) records how many leading members of the tied-at-cursor group this run actually finished, so the next run skips exactly that many and resumes where the previous one stopped instead of restarting the tie. It resets to `0` on any run that reaches a genuinely complete end (nothing left to resume mid-tie). If a capped, truncated run's tie-offset skip covers the *entire* batch that call retrieved (nothing new to scan at all), `LAST_SYNC_CURSOR` and its tie offset are left completely untouched rather than falling through to "advance to now" — which would otherwise silently jump the cursor past whatever unretrieved data caused the truncation. (A single tied group wide enough to itself exceed the pagination safety limit — thousands of Tasks sharing one exact minute — is a separate, extreme-scale limitation this cannot fully resolve, since Notion's public API offers no secondary sort key to page within an exact-timestamp tie.)

To re-run a window deliberately, clear `LAST_SYNC_CURSOR` (the next poll then bootstraps again and looks back one hour, and any stale `LAST_SYNC_CURSOR_TIE_OFFSET` is ignored on that bootstrap run and freshly recomputed) or call `reconcileTaskById(pageId)` for a single Task. To backfill Result-fingerprint stamps onto Done Tasks that predate that feature (a live-deployment upgrade only — see the Done gate section above), call `backfillResultFingerprints_()` once from the editor; if the deployment has more Done Tasks than the pagination safety limit, it is itself resumable the same way — a truncated call persists `BACKFILL_RESUME_CURSOR` (queried with `on_or_after`, plus a local `BACKFILL_RESUME_TIE_OFFSET` skip, so a tied timestamp at the truncation boundary resumes correctly rather than silently dropping its remainder) and calling it again continues past what was already stamped instead of re-scanning the same prefix. It is also bounded by `MAX_RUN_DURATION_MS`, the same wall-clock budget `pollTaskChanges` uses: even a batch of Done Tasks well under the pagination safety limit can still run long enough to risk an uncaught Apps Script kill, since every Done Task costs a real Time Events query/write (Done is always re-verified). Hitting that bound checkpoints `BACKFILL_RESUME_CURSOR`/`BACKFILL_RESUME_TIE_OFFSET` at exactly however many Tasks this call actually got through — not however many the fetched page contained — so a call stopped by the wall clock resumes correctly on the next call, the same as one stopped by pagination truncation. When a tied cohort itself needs more than one wall-clock-bounded call to drain, the stored tie offset accumulates across calls (the count a prior call already persisted, plus however many this call newly processed while still inside that same tied timestamp) rather than each call overwriting it with only its own contribution — the latter would make every further call re-skip to the same fixed count and re-walk (never past) the same middle slice forever. For a very large Done backlog beyond a single pagination page, expect to call it repeatedly (from a time-driven trigger, or by hand) until its returned summary shows `truncated: false` and `timedOut: false`.

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
8. **Stale Result on reopen**: complete a Task through Done once and confirm the applicable Time Event's `Note` gets stamped with a `Result Fingerprint=` marker. Reopen it, run the new execution's own start/stop flow, update `Completed At` but leave `Result` exactly as it was. Attempt Done; confirm it is rejected (`stale_result`) even though `Result` is non-empty and `Completed At` is fresh. Update `Result` to genuinely different text and confirm Done then persists.
9. **Stale Started At on reopen**: complete a Task through Done once. Reopen it and move it back through `In Progress → Review` (opening and closing a new Time Event) *without* updating `Started At`. Update `Result` and `Completed At` for the new execution. Attempt Done; confirm it is rejected (`stale_task_started_at`) even though a closed event, fresh `Result`, and fresh `Completed At` all exist. Update `Started At` to the new execution's actual start and confirm Done then persists.
8. **Same-minute retry**: set Done on a Task missing required evidence, confirm the rollback, then — within the same minute — set Done again, still missing evidence. Confirm the second attempt is also rejected (not silently accepted through a snapshot-hash collision).
10. **Reassignment mid-execution then Done**: start a Task, reassign it to another mapped Actor while still `In Progress` (see "Reassignment" below), then move it to `Review` and provide `Result`/`Completed At`. Confirm Done persists — the current execution's two closed events (one per Actor) must not falsely count each other as stale prior-execution evidence.
11. **Legacy backfill**: only relevant when upgrading a *live* deployment that already has Done Task history from before Result-fingerprint stamping existed (a fresh deploy has none). Run `backfillResultFingerprints_()` once from the editor immediately after deploying. Confirm its returned summary reports one `done_gate_passed:stamped` outcome per pre-existing Done Task with a valid applicable event. Then repeat step 8's stale-Result scenario against one of the backfilled Tasks and confirm it is now correctly rejected — before the backfill, that same Task's stale Result would have gone undetected on reopen.

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

**Recorded boundary timestamps carry a backlog-dependent imprecision, for a structural reason.** `Ended At` (and a reassignment's actor-boundary timestamp) is set from `task.last_edited_time` at the moment the reconciler observes the Task leaving `In Progress` — but that field is the *page's* last edit time, not a per-property change time, because Notion's public API does not expose one. If an unrelated property (e.g. `Result`) is edited after the actual status transition but before any poll observes the page in between, `last_edited_time` reflects that later, unrelated edit, and the recorded `Ended At` is inflated by the gap. This is only possible when **no poll ever observed the Task at its true transition instant** — which requires either (a) both edits landing within the same poll interval, or (b) the transition's own reconciliation being deferred by a run that hit `MAX_TASKS_PER_RUN` (25 write-producing Tasks per run) before reaching it. `pollTaskChanges` never defers indefinitely — every run either reconciles a Task or holds the cursor at the exact point it stopped, and a zero-Notion-call re-read (`duplicate:`/`ignored:`) never counts against either cap, so a cohort sharing one timestamp cannot itself cause an unbounded stall (see the fix for "Continue scanning beyond a duplicate timestamp cohort" — a large *write-producing* backlog is a distinct case, covered next). But case (b)'s delay is **not** capped at one extra poll cycle: if more than 25 write-producing Tasks sort ahead of the target inside the same incremental window, the target can be deferred by up to `ceil(backlog / 25)` poll cycles, and if a further unrelated edit lands on the target during that backlog, the inflation spans that many intervals, not just one. There is no page-history or property-level-timestamp endpoint in Notion's public API to close the underlying gap outright; narrowing `POLL_INTERVAL_MINUTES` narrows same-interval exposure (case (a)), and keeping `MAX_TASKS_PER_RUN` write-backlogs short in practice bounds case (b). This is a known, bounded-but-backlog-dependent limitation of polling `last_edited_time`, not a bug with an available fix — do not treat recorded boundary timestamps as accurate to the second, or even reliably to one poll interval under a sustained large backlog.

**`Note`'s Result-fingerprint history is bounded, not unbounded, for a structural reason.** `enforceDoneGate_`'s stale-Result check needs *every* fingerprint an event has ever been stamped with, not just the latest (`noteFieldAll_`), since a reopen can restore an old, already-seen `Result` value rather than a genuinely new one. `Note` is a single Notion rich-text field with a practical size ceiling, so `appendNote_` caps combined length at 1800 characters and, when a new marker would exceed it, evicts the oldest segment first — but only a non-fingerprint one (`Reason=`, `Snapshot=`, `Changed By=`, `End Status=`; only the newest of each ever matters, so losing older copies is harmless). Only once *none* of those remain does it fall back to dropping the oldest `Result Fingerprint=` segment, the last thing it will ever evict. At roughly 65 characters per stamped fingerprint (`Result Fingerprint=` plus a 43-character SHA-256 digest), that leaves room for on the order of 25–27 executions' worth of stamps on one event before the oldest is ever evicted — an event would need to be reopened and re-stamped with a distinct `Result` value that many times before eviction can even begin. Once it does, the oldest fingerprint's protection is genuinely lost: a Result value that happens to match one of the evicted (rather than still-retained) old values would no longer be caught as stale. Closing this outright would require either splitting fingerprint history across multiple Notion rich-text segments/properties or a dedicated schema change, both beyond this PoC's scope; this is a known, bounded-but-not-eliminated limitation of storing unbounded history in one bounded field, not a bug with an available fix at this size.

## Success criteria

- Notion remains authoritative for Task state and Task Time Events.
- Sheet rows are reproducible projections of Notion events for touched Tasks.
- No credential appears in any URL, and no public endpoint exists to hold one.
- `NOTION_TOKEN` is the only secret, held only in Apps Script Script Properties, and never logged.
- The reconciler is reachable only from inside the Apps Script project (time-driven trigger, or an operator running `reconcileTaskById` from the editor).
- Beyond the Notion API responses it fetches itself, the reconciler accepts no externally supplied operational claims.
- Human / Chris / Claude / Codex Task activity uses the same state-driven mechanism.
- In-progress reassignment/clearing cannot leave the original Actor event open indefinitely.
- Done cannot persist without a closed Time Event **applicable to the current execution** (started at or after the Task's current `Started At`, itself required to look fresh relative to the Task's own event history), a `Completed At` that is itself no earlier than that Started At or the applicable event's own Ended At, and a `Result` that was actually validated for this execution (not merely present). A closed event, `Started At`, `Completed At`, or `Result` left over from a prior, already-completed execution does not satisfy a later reopen's Done gate.
- An invalid Done cannot escape re-verification through a minute-granularity snapshot-hash collision; Done is always re-checked.
- Repeated reconciliation of an unchanged Task does not duplicate authoritative events.
- A Task already `In Progress` before the first-ever poll still receives an open Time Event, via the fresh-deploy bootstrap.
- A dense cluster of already-reconciled Tasks inside the overlap window cannot permanently stall reconciliation of Tasks behind it.
- A reopened Task's new interval starts from its current `Started At`, not from a later edit the poll happens to observe first.
- A current execution that produced more than one closed event (e.g. an in-progress reassignment, including one that leaves a real time gap such as an assignment being cleared and only later reassigned) is not mistaken for stale prior-execution evidence — and a genuinely prior execution's closing event isn't mistaken for current-execution evidence just because it happens to coincide in time with something in the new one.
- A large free-outcome scan (duplicates, or a large already-Done cohort) cannot run long enough to risk an uncaught Apps Script execution-limit kill; it stops and persists a resumable cursor first.
- A capped run that stops inside a group of Tasks sharing one identical `last_edited_time` resumes past exactly what it already reconciled on the next run, rather than rescanning the same tied prefix forever.
- Normal conversation and non-Task activity create no event.

## Tests

`node --test test/*.test.mjs` from this directory. `test/support/gas-sandbox.mjs` runs `Code.gs` under a Node `vm` with a minimal Apps Script shim (Properties, Lock, Utilities, Spreadsheet, ScriptApp, UrlFetch), so the polling cursor, batching, trigger installation, reconciliation and Done gate are all covered without a live Apps Script project. CI runs the same command (`.github/workflows/notion-time-events.yml`).
