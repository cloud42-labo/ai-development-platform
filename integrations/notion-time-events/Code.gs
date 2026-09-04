const DEFAULTS = {
  TIME_EVENTS_SHEET: 'Time Events',
  SYNC_LOG_SHEET: 'Sync Log',
  TASKS_DATA_SOURCE_ID: 'fc5e770f-c68e-4799-afe7-ec4bff0dab59',
  TIME_EVENTS_DATA_SOURCE_ID: '544b9a17-2653-47aa-b62c-bb52425b3bf2',
  START_STATUS: 'In Progress',
  REVIEW_STATUS: 'Review',
  DONE_STATUS: 'Done',
  // `Stories & Tasks`.Status is a `select` property in the real database
  // schema, not Notion's distinct `status` property type — the two use
  // different filter and page-property-write shapes ({ select: { equals /
  // name } } vs { status: { equals / name } }), and sending the wrong one is
  // rejected outright by the Notion API rather than silently matching zero
  // rows. Every Status filter and write is built from this single constant
  // instead of hardcoding the type at each call site, so a real schema
  // change only needs updating here. See the "Status property schema
  // contract" tests in test/poll.test.mjs and test/done-gate.test.mjs, which
  // pin every call site's request body against the real data source schema.
  STATUS_PROPERTY_TYPE: 'select',
  NOTION_VERSION: '2026-03-11',
  POLL_INTERVAL_MINUTES: 5,
};

// Apps Script time-driven triggers only accept these minute intervals.
const ALLOWED_POLL_INTERVALS = [1, 5, 10, 15, 30];

// Every poll re-reads a little further back than the last cursor. Notion
// reports `last_edited_time` at minute granularity and a page can be indexed
// fractionally after it is written, so a strict `> cursor` window can skip an
// edit that landed in the same minute the previous run finished. Re-reading is
// free: hasProcessedSnapshot_ drops anything already reconciled.
const SYNC_OVERLAP_MS = 2 * 60 * 1000;

// How far back the very first poll looks when no cursor exists yet.
const INITIAL_LOOKBACK_MS = 60 * 60 * 1000;

// Upper bound on *genuine* reconciliations (an outcome that made a real
// Notion write) performed in one trigger run, so a large backlog of real
// work can never push a single execution past the Apps Script runtime limit.
// Anything left over is picked up by the next run from the un-advanced
// cursor. A free outcome (duplicate/ignored re-read, or an already-valid
// Done needing no change) does not count against this — see isFreeOutcome_.
//
// There is deliberately no separate, smaller cap on free outcomes. An
// earlier version added one (to bound total scanned Tasks regardless of
// write cost) and it reintroduced exactly the stall this design exists to
// prevent, just for free outcomes instead of writes: a cohort larger than
// that cap sharing one last_edited_time — duplicates, or Tasks that are
// legitimately already Done and get re-verified every poll — would hit it
// before reaching the unprocessed tail, on every run, forever. The only
// remaining bound on a free-outcome scan is tasksToProcess.length itself,
// which pagination already caps (QUERY_PAGE_SAFETY_LIMIT, with truncation
// correctly signaled — see queryChangedTasks_). A pathologically large
// simultaneous free-outcome cohort can make one run slow; it cannot make a
// run permanently unable to progress. Narrowing POLL_INTERVAL_MINUTES
// bounds how large such a cohort can accumulate between runs.
const MAX_TASKS_PER_RUN = 25;

// Wall-clock safety margin for a single trigger execution. Apps Script kills
// a run outright at its own per-execution limit (6 minutes on a consumer
// account, 30 on Workspace) — an uncaught termination there does not reach
// the cursor-persist step at the end of pollTaskChanges, so a run killed
// mid-scan would lose all progress and re-scan the identical prefix on the
// next trigger. This matters because neither MAX_TASKS_PER_RUN nor pagination
// bounds a free-outcome scan (duplicates, or a large already-Done cohort):
// each one still costs a real Time Events query, so a cohort large enough can
// still make the run itself run long even though it makes no write. Checked
// against the same wall clock as runStartedAt, on the safe (shorter) side of
// both platform limits, so behavior is correct regardless of account type.
// Crossing it stops the scan early and persists the cursor at the last Task
// actually reconciled — same graceful "capped" behavior MAX_TASKS_PER_RUN
// already produces — rather than risking an unrecoverable mid-scan kill.
const MAX_RUN_DURATION_MS = 4 * 60 * 1000;

// How much of MAX_RUN_DURATION_MS backfillResultFingerprints_ always reserves
// for actually processing and checkpointing whatever pagination retrieved,
// even while its pagination phase is escalating past the primary half-budget
// deadline to make progress against a large persisted tie offset (see the
// comment on that escalation below). Without this, escalation's own outer
// bound was the full run budget, so a call that only manages to fetch enough
// to clear the tie offset right near that bound would exit pagination with
// effectively zero wall-clock time left, process nothing, and — since a call
// that processes nothing leaves persisted state untouched — repeat the exact
// same expensive fetch-only round trip indefinitely.
//
// This must cover more than "some processing time": paginateNotionQuery_'s
// deadline check only runs BEFORE issuing a page's request (see the comment
// there), never while one is in flight — it bounds when a new request is
// allowed to START, not how long the run's wall clock has actually advanced
// once that request RETURNS. A single Notion request that itself blocks
// longer than this reserve can still land after the full run deadline,
// leaving the processing loop with zero usable time regardless of how early
// pagination's own checks ran. For the reserve to actually guarantee
// processing time (not just usually leave some), it must be at least as
// large as the worst-case duration of one single UrlFetchApp.fetch call —
// Apps Script does not expose a configurable fetch timeout, so this is an
// assumption about platform behavior (commonly observed to cap around a
// minute), not a documented guarantee; see README "Known limitations".
// Still kept well under half of MAX_RUN_DURATION_MS so it never itself
// starves the primary pagination phase down to nothing.
const MIN_PROCESSING_RESERVE_MS = 65 * 1000;

function setup() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Run setup() from the bound Apps Script project of Cloud42 Time Events PoC.');
  }

  props.setProperties({
    SPREADSHEET_ID: spreadsheet.getId(),
    TASKS_DATA_SOURCE_ID: props.getProperty('TASKS_DATA_SOURCE_ID') || DEFAULTS.TASKS_DATA_SOURCE_ID,
    TIME_EVENTS_DATA_SOURCE_ID: props.getProperty('TIME_EVENTS_DATA_SOURCE_ID') || DEFAULTS.TIME_EVENTS_DATA_SOURCE_ID,
    POLL_INTERVAL_MINUTES: props.getProperty('POLL_INTERVAL_MINUTES') || String(DEFAULTS.POLL_INTERVAL_MINUTES),
  }, false);

  ensureProjectionHeaders_();
  ensureSyncLogSheet_();
  installSyncTrigger();
  Logger.log('Setup complete. This project has no public endpoint and stores only NOTION_TOKEN.');
}

function showSetupInfo() {
  const props = PropertiesService.getScriptProperties();
  Logger.log(JSON.stringify({
    spreadsheetId: props.getProperty('SPREADSHEET_ID'),
    tasksDataSourceId: tasksDataSourceId_(),
    timeEventsDataSourceId: timeEventsDataSourceId_(),
    // Presence only. The token value is never logged.
    notionTokenConfigured: Boolean(props.getProperty('NOTION_TOKEN')),
    pollIntervalMinutes: pollIntervalMinutes_(),
    syncTriggersInstalled: syncTriggers_().length,
    lastSyncCursor: props.getProperty('LAST_SYNC_CURSOR') || '(never run)',
  }, null, 2));
}

// Installs (or reinstalls) the time-driven trigger that drives reconciliation.
// This project deliberately exposes no doGet/doPost Web App endpoint: the only
// caller of the reconciler is this trigger, running as the project owner, so
// there is no inbound request to authenticate and no receiver credential to
// store, rotate, or leak.
function installSyncTrigger() {
  removeSyncTriggers();
  const minutes = pollIntervalMinutes_();
  ScriptApp.newTrigger('pollTaskChanges').timeBased().everyMinutes(minutes).create();
  Logger.log('Installed pollTaskChanges trigger: every ' + minutes + ' minute(s).');
}

function removeSyncTriggers() {
  syncTriggers_().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
}

function syncTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'pollTaskChanges';
  });
}

function pollIntervalMinutes_() {
  const raw = Number(PropertiesService.getScriptProperties().getProperty('POLL_INTERVAL_MINUTES'));
  return ALLOWED_POLL_INTERVALS.indexOf(raw) >= 0 ? raw : DEFAULTS.POLL_INTERVAL_MINUTES;
}

// Trigger entry point. Asks Notion which Tasks changed since the last cursor
// and reconciles each one against authoritative Notion state. Nothing outside
// this project can invoke it, and no request payload is involved at all: the
// Task list and every field driving a mutation come from Notion over an
// authenticated API call using the private NOTION_TOKEN.
function pollTaskChanges() {
  return withPollLock_(function () {
    const props = PropertiesService.getScriptProperties();
    const runStartedAt = new Date();
    const cursor = props.getProperty('LAST_SYNC_CURSOR');
    const isBootstrap = !cursor;
    const sinceMs = (cursor ? parseTimestamp_(cursor).getTime() : runStartedAt.getTime() - INITIAL_LOOKBACK_MS)
      - SYNC_OVERLAP_MS;

    const changedResult = queryChangedTasks_(new Date(sinceMs));

    // On a fresh deploy, a Task that has been sitting In Progress since
    // before the initial lookback window would never surface through the
    // time-window query above, so it would never receive an open Time Event
    // — and would then permanently fail the Done gate for lack of any
    // applicable interval once it eventually moves. Bootstrap by also
    // pulling every currently In Progress Task directly by Status,
    // independent of last_edited_time, until that has genuinely finished —
    // tracked by its OWN flag (BOOTSTRAP_ACTIVE_DONE), not by whether
    // LAST_SYNC_CURSOR happens to be set. If that were coupled to the
    // cursor, an active-Task set wide enough to truncate (more than
    // QUERY_PAGE_SAFETY_LIMIT pages) would still let the very first run set
    // a cursor, and every subsequent run would see isBootstrap = false and
    // never issue this query again — permanently stranding whatever of the
    // active set wasn't retrieved the first time, since it may be too old to
    // ever fall inside a future incremental window either.
    const activeBootstrapDone = Boolean(props.getProperty('BOOTSTRAP_ACTIVE_DONE'));
    const activeResult = activeBootstrapDone ? null : queryActiveInProgressTasks_();
    const tasksToProcess = activeResult
      ? mergeTasksById_(changedResult.results, activeResult.results)
      : changedResult.results;
    // Either query hitting its own pagination safety limit (an incremental
    // window, or the active-Task set, wider than QUERY_PAGE_SAFETY_LIMIT
    // pages) means tasksToProcess is not actually the complete set for this
    // run, even once every element in it has been scanned. The cursor must
    // not advance past data that was never retrieved.
    const sourceTruncated = changedResult.truncated || Boolean(activeResult && activeResult.truncated);

    // A capped run (MAX_TASKS_PER_RUN or MAX_RUN_DURATION_MS) can stop
    // partway through a group of Tasks that all share the exact same
    // last_edited_time (a bulk edit, or many Done Tasks re-verified in the
    // same poll minute) — ascending sort keeps such a group contiguous. The
    // cursor alone cannot express "partway through a tie": the next run's
    // `on_or_after: cursor - overlap` query returns the *entire* tied group
    // again from its start. For most outcomes that is harmless (re-reading
    // an already-processed Task is a free `duplicate:`), but a Done Task is
    // never dedup-skipped (mustReverify) and always costs a real Time Events
    // query to re-verify — so a tied cohort of valid Done Tasks larger than
    // one run's budget would otherwise be re-scanned from its own start on
    // every subsequent run, never draining. LAST_SYNC_CURSOR_TIE_OFFSET
    // records how many leading members of the tied-at-cursor group were
    // already reconciled, so this run can skip exactly that many and resume
    // where the previous one actually stopped.
    const tieOffset = isBootstrap ? 0 : Number(props.getProperty('LAST_SYNC_CURSOR_TIE_OFFSET') || '0');
    let startIndex = 0;
    if (tieOffset > 0 && cursor) {
      let tieStart = -1;
      for (let i = 0; i < tasksToProcess.length; i++) {
        if (String(tasksToProcess[i].last_edited_time || '') === cursor) {
          tieStart = i;
          break;
        }
      }
      if (tieStart >= 0) {
        let skipped = 0;
        let i = tieStart;
        while (i < tasksToProcess.length && skipped < tieOffset && String(tasksToProcess[i].last_edited_time || '') === cursor) {
          skipped++;
          i++;
        }
        startIndex = i;
      }
    }

    const outcomes = [];
    let reconciledCount = 0;
    let iterated = startIndex;
    let lastScannedEdit = '';

    while (
      iterated < tasksToProcess.length &&
      reconciledCount < MAX_TASKS_PER_RUN &&
      (Date.now() - runStartedAt.getTime()) < MAX_RUN_DURATION_MS
    ) {
      const task = tasksToProcess[iterated];
      const outcome = reconcileTaskPage_(task);
      outcomes.push(outcome);
      lastScannedEdit = String(task.last_edited_time || '');
      iterated++;
      // A free outcome (duplicate/ignored re-read, or an already-valid Done
      // needing no change) made no Notion write, so it must not consume the
      // reconciliation budget — see the comment on MAX_TASKS_PER_RUN for why
      // this must have no separate, smaller cap of its own either. A dense
      // cluster of such outcomes larger than MAX_TASKS_PER_RUN — duplicates
      // from the overlap window, or 25+ Tasks that are legitimately already
      // Done — is instead scanned in full every run, bounded only by
      // tasksToProcess.length.
      if (!isFreeOutcome_(outcome)) reconciledCount++;
    }

    // If the run did not reach the end of tasksToProcess, OR tasksToProcess
    // itself was not the complete set (sourceTruncated), the cursor must
    // stay at the last Task actually scanned rather than jumping to now —
    // otherwise the untouched (or unretrieved) tail of this window would be
    // skipped permanently. A run that reached a genuinely complete end
    // advances to the moment the query was issued, so edits made while it
    // ran are still inside the next run's overlap.
    const capped = iterated < tasksToProcess.length || sourceTruncated;
    // A capped run that scanned nothing new at all (every Task the query
    // returned was already covered by startIndex's tie-skip — e.g. a tied
    // group wide enough to fill the entire truncated result set) has no
    // `lastScannedEdit` to persist. Falling through to `runStartedAt` in
    // that case would silently jump the cursor past whatever unretrieved
    // data caused the truncation in the first place. Leave both
    // LAST_SYNC_CURSOR and its tie offset untouched instead — the same
    // "failed or skipped run leaves the cursor alone" behavior already
    // documented for a lock-contended run — so the next run retries with
    // the exact same resume state rather than losing data. (A single tie
    // wide enough to itself exceed the pagination safety limit is a
    // separate, extreme-scale limitation this cannot fully resolve — see
    // README "Known limitations".)
    const madeProgress = iterated > startIndex;
    if (madeProgress || !capped) {
      props.setProperty(
        'LAST_SYNC_CURSOR',
        capped && lastScannedEdit ? lastScannedEdit : runStartedAt.toISOString()
      );

      // Recompute the tie offset from scratch for whatever was just
      // persisted as the cursor: the count of items sharing that exact
      // timestamp, contiguously ending at the last Task actually
      // reconciled (ascending sort keeps a tie contiguous, so a simple
      // trailing count is correct whether it's a tie this run just started
      // or one carried in via startIndex above). Zero for a run that
      // reached a genuinely complete end — there is nothing left to resume
      // mid-tie.
      let newTieOffset = 0;
      if (capped && lastScannedEdit) {
        for (let i = 0; i < iterated; i++) {
          newTieOffset = String(tasksToProcess[i].last_edited_time || '') === lastScannedEdit ? newTieOffset + 1 : 0;
        }
      }
      props.setProperty('LAST_SYNC_CURSOR_TIE_OFFSET', String(newTieOffset));
    }

    if (activeResult) {
      if (activeResult.truncated) {
        // Not done: leave BOOTSTRAP_ACTIVE_DONE unset so the next run tries
        // again, and persist how far this call got so that retry resumes
        // past it instead of re-querying the identical prefix. If nothing
        // new was retrieved this call (the whole batch was already covered
        // by the tie-offset skip), leave the resume state untouched rather
        // than losing it — same rule pollTaskChanges' own cursor applies.
        if (activeResult.results.length) {
          const lastActiveSeen = String(activeResult.results[activeResult.results.length - 1].last_edited_time || '');
          if (lastActiveSeen) {
            props.setProperty('BOOTSTRAP_ACTIVE_RESUME_CURSOR', lastActiveSeen);
            let newActiveTieOffset = 0;
            for (let i = 0; i < activeResult.results.length; i++) {
              newActiveTieOffset = String(activeResult.results[i].last_edited_time || '') === lastActiveSeen ? newActiveTieOffset + 1 : 0;
            }
            props.setProperty('BOOTSTRAP_ACTIVE_RESUME_TIE_OFFSET', String(newActiveTieOffset));
          }
        }
      } else {
        props.setProperty('BOOTSTRAP_ACTIVE_DONE', '1');
        props.setProperty('BOOTSTRAP_ACTIVE_RESUME_CURSOR', '');
        props.setProperty('BOOTSTRAP_ACTIVE_RESUME_TIE_OFFSET', '');
      }
    }

    return {
      scanned: tasksToProcess.length,
      processed: reconciledCount,
      capped: capped,
      truncated: sourceTruncated,
      bootstrap: isBootstrap,
      outcomes: outcomes,
    };
  });
}

// Operator escape hatch for E2E and debugging: reconcile one Task on demand.
// Runs only from the Apps Script editor, as the project owner.
function reconcileTaskById(pageId) {
  const normalized = normalizeUuid_(pageId);
  if (!normalized) throw new Error('reconcileTaskById requires a Notion page ID.');
  return withPollLock_(function () {
    return reconcileTaskPage_(retrieveNotionPage_(normalized));
  });
}

// Operator escape hatch for a version upgrade that adds Result-fingerprint
// stamping (see enforceDoneGate_) to a Task that already reached Done under
// an older Code.gs revision without it: reused unchanged after a later
// reopen, that Task's stale Result would otherwise go undetected, since the
// check can only catch a reuse against an event it once stamped. Forces the
// exact same re-verification a normal poll already performs for a Done Task
// (Done is always re-verified — reconcileTaskPage_) across *every* currently
// Done Task regardless of last_edited_time, so ones outside the current poll
// window get their applicable event stamped promptly instead of waiting on
// some unrelated future edit to pull them back into view. Idempotent and
// safe to run more than once (already-stamped events are left untouched, and
// a Task that genuinely fails the gate is rolled back exactly as it would be
// by the next ordinary poll to reach it). Run once from the editor
// immediately after deploying this revision, before any already-Done Task is
// reopened — see README "Known limitations". Not needed on a fresh deploy
// with no pre-existing Done history.
function backfillResultFingerprints_() {
  return withPollLock_(function () {
    const runStartedAt = new Date();
    const props = PropertiesService.getScriptProperties();
    const resumeCursor = props.getProperty('BACKFILL_RESUME_CURSOR');
    // Sorted ascending and, on a resumed call, filtered to on-or-after the
    // last Task this backfill actually looked at, so a deployment with more
    // Done Tasks than the pagination safety limit (QUERY_PAGE_SAFETY_LIMIT,
    // 5000 rows) can be drained by calling this repeatedly instead of the
    // exact same unsorted, un-resumed prefix being returned every time it is
    // re-run, leaving the tail unreachable. `on_or_after` (not `after`) plus
    // a local tie-offset skip below — same pattern as LAST_SYNC_CURSOR_TIE_
    // OFFSET in pollTaskChanges — instead of a strict `after` filter, which
    // would silently drop the remainder of a tied group if the pagination
    // limit had landed inside one (`last_edited_time` is minute-granular, so
    // many Done Tasks can plausibly share one value).
    const tieOffset = resumeCursor ? Number(props.getProperty('BACKFILL_RESUME_TIE_OFFSET') || '0') : 0;
    const filter = resumeCursor
      ? { and: [
          { property: 'Status', [DEFAULTS.STATUS_PROPERTY_TYPE]: { equals: DEFAULTS.DONE_STATUS } },
          { timestamp: 'last_edited_time', last_edited_time: { on_or_after: resumeCursor } },
        ] }
      : { property: 'Status', [DEFAULTS.STATUS_PROPERTY_TYPE]: { equals: DEFAULTS.DONE_STATUS } };
    const queryPath = '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query';
    const queryBody = {
      page_size: 100,
      filter: filter,
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
    };
    function tieOffsetStartIndex_(results) {
      let index = 0;
      if (resumeCursor && tieOffset > 0) {
        let skipped = 0;
        while (
          index < results.length &&
          skipped < tieOffset &&
          String(results[index].last_edited_time || '') === resumeCursor
        ) {
          skipped++;
          index++;
        }
      }
      return index;
    }

    // Reserve half of MAX_RUN_DURATION_MS for pagination and leave the
    // other half for actually processing and checkpointing whatever was
    // retrieved — a large Done database or a slow Notion response can
    // otherwise spend the entire wall-clock budget just fetching pages (up
    // to QUERY_PAGE_SAFETY_LIMIT of them, each its own round trip) before
    // the processing loop below ever runs its own MAX_RUN_DURATION_MS
    // check, risking an uncaught Apps Script kill with nothing reconciled
    // or checkpointed at all. But a resumed cohort whose persisted tie
    // offset already exceeds what the half-budget alone can fetch would
    // otherwise deadlock forever: every call re-fetches the identical
    // already-consumed prefix (on_or_after is inclusive and always
    // restarts from its own beginning) and stops with zero net progress,
    // and nothing about that changes between calls on its own. Rather than
    // starting a SECOND, independent pagination pass past the half-budget
    // deadline (which would only re-fetch from page 1 again, wasting the
    // time the first pass already spent, and could never net out ahead —
    // both passes share the same wall clock), extend this SAME continuous
    // pass past the half-budget deadline specifically while the tie-offset
    // skip would still consume everything fetched so far — but bounded by
    // MIN_PROCESSING_RESERVE_MS short of the full run budget, not the full
    // budget itself. Escalating all the way to the outer bound would let a
    // call that only just manages to fetch past the tie offset right near
    // that bound exit pagination with nothing left to actually process or
    // checkpoint with — see MIN_PROCESSING_RESERVE_MS.
    const doneTasks = paginateNotionQuery_(
      queryPath,
      queryBody,
      runStartedAt.getTime() + MAX_RUN_DURATION_MS / 2,
      runStartedAt.getTime() + MAX_RUN_DURATION_MS - MIN_PROCESSING_RESERVE_MS,
      function (results) { return tieOffsetStartIndex_(results) < results.length; }
    );
    const startIndex = tieOffsetStartIndex_(doneTasks.results);
    const toProcess = doneTasks.results.slice(startIndex);

    // Bounded by wall-clock time as well as the pagination safety limit
    // above — a batch of Done Tasks well under QUERY_PAGE_SAFETY_LIMIT can
    // still exceed Apps Script's own execution limit once each one costs a
    // real Time Events query/write (reconcileTaskPage_ always re-verifies
    // Done, the same as pollTaskChanges' free-outcome scan). Same
    // MAX_RUN_DURATION_MS pattern: stop before the platform kills the run —
    // which would lose all progress and re-scan the identical prefix next
    // time — and checkpoint however far this call actually got instead of
    // however far the fetched batch goes.
    const outcomes = [];
    let iterated = 0;
    while (
      iterated < toProcess.length &&
      (Date.now() - runStartedAt.getTime()) < MAX_RUN_DURATION_MS
    ) {
      outcomes.push(reconcileTaskPage_(toProcess[iterated]));
      iterated++;
    }
    const timedOut = iterated < toProcess.length;
    const processed = toProcess.slice(0, iterated);

    if ((doneTasks.truncated || timedOut) && processed.length) {
      const lastSeen = String(processed[processed.length - 1].last_edited_time || '');
      if (lastSeen) {
        props.setProperty('BACKFILL_RESUME_CURSOR', lastSeen);
        // The offset must count only members of the tie that will still be
        // returned by a FUTURE resumed query — i.e. still `Status = Done`.
        // A `done_gate_rejected:*` outcome rolls the Task back to `Review`
        // (updateTaskStatus_ above), which removes it from this query's own
        // `Status = Done` filter from that point on: it will never appear in
        // any later call's results again. Counting it toward the skip would
        // inflate the offset past what the (now smaller) future result set
        // actually contains for this tie, silently skipping a genuinely
        // unprocessed valid Task forever — the same failure mode the
        // cumulative carry-over below exists to avoid, just introduced from
        // the other direction. A rejected member is therefore skipped over
        // (it needs no further visit — reconcileTaskPage_ already ran it and
        // Notion no longer considers it Done) without incrementing the
        // count, but without resetting the count either: it does not break
        // the contiguous tie the way a genuinely different timestamp does.
        let newTieOffset = 0;
        for (let i = 0; i < processed.length; i++) {
          if (String(processed[i].last_edited_time || '') !== lastSeen) {
            newTieOffset = 0;
            continue;
          }
          if (outcomes[i].indexOf('done_gate_rejected:') === 0) continue;
          newTieOffset++;
        }
        // If this call's own tail is still the exact same tied timestamp the
        // resume cursor already pointed at when this call started, the
        // members that resume's own tieOffset already skipped (processed by
        // an earlier call, not present in `processed` at all — startIndex
        // skipped them via the query result, not this loop) belong to that
        // same tie and must be counted cumulatively. Otherwise each further
        // call spanning the same cohort overwrites the stored offset with
        // only what THAT call processed, so every subsequent call re-skips
        // to the same fixed count and re-walks (never past) the same middle
        // slice forever instead of ever draining the tail. A tail that moved
        // to a genuinely new timestamp (lastSeen !== resumeCursor) has no
        // such carry-over — that offset belonged to a now-fully-drained tie.
        const cumulativeTieOffset = (lastSeen === resumeCursor ? tieOffset : 0) + newTieOffset;
        props.setProperty('BACKFILL_RESUME_TIE_OFFSET', String(cumulativeTieOffset));
      }
      Logger.log('backfillResultFingerprints_: stopped at the ' + (timedOut ? 'wall-clock bound' : 'pagination safety limit') + ' — call again to resume from ' + lastSeen + '.');
    } else if (doneTasks.truncated || timedOut) {
      // Stopped (by either bound) with nothing new processed this call (the
      // whole returned batch was already covered by the tie-offset skip):
      // leave BACKFILL_RESUME_CURSOR/TIE_OFFSET exactly as they were rather
      // than losing the resume point — same "no progress, don't touch
      // persisted state" rule pollTaskChanges applies for the identical
      // scenario.
    } else {
      // Fully drained (or nothing left to see): clear any stale resume point
      // so a future call starts a fresh full pass rather than silently
      // skipping Tasks edited before wherever a prior backfill happened to
      // stop.
      props.setProperty('BACKFILL_RESUME_CURSOR', '');
      props.setProperty('BACKFILL_RESUME_TIE_OFFSET', '');
    }
    return { scanned: outcomes.length, truncated: doneTasks.truncated, timedOut: timedOut, outcomes: outcomes };
  });
}

// Reconciles a single authoritative Notion Task page. Status, assignment,
// timing and completion evidence are read from the page Notion returned; the
// reconciler only ever moves Task Time Events toward the state Notion already
// holds, so a repeated pass over the same page is a no-op.
function reconcileTaskPage_(task) {
  if (!isConfiguredTask_(task)) return 'ignored:not_configured_task';

  const pageId = task.id;
  const currentStatus = propertyText_(task.properties.Status);
  const assignedAgent = propertyText_(task.properties['Assigned Agent']);
  const desiredActor = mapActor_(assignedAgent);
  const title = propertyText_(task.properties.Title) || pageId;
  const when = authoritativeEditTime_(task);
  const changedBy = editorLabel_(task.last_edited_by);
  const taskType = propertyText_(task.properties.Type);
  const snapshotId = authoritativeSnapshotId_(task, currentStatus, assignedAgent, taskType);

  // Type = Story is a rollup/container over its own child Subtasks/Tasks, not
  // an execution unit — real effort is timed on the children, never on the
  // Story page itself. Before this check, a Story sitting In Progress (its
  // ordinary state for as long as child work is in flight, routinely days)
  // opened and accumulated its own Active Time Event exactly like an
  // executable Task, double-counting hours already timed on its children and
  // inflating daily-report/KPI Active totals (BUG-ADP-TTE-01). A Story's own
  // Done transition also needs no Time Event evidence — only its children's —
  // so it must never reach the Done gate below either. See
  // reconcileStoryTask_ for the reduced handling this gets instead: never
  // open a new event regardless of Status, but still archive away (and log)
  // any event a Story already accumulated under the pre-fix behavior.
  const isStory = taskType === 'Story';

  // Done is a completion gate that must be re-verified on every poll that
  // observes it — never short-circuited by the snapshot hash. Notion reports
  // last_edited_time at only minute granularity, so a Done that gets rolled
  // back and retried within the same minute (still missing its required
  // evidence) can hash identically to the first, already-processed attempt.
  // Skipping re-verification on that collision would let an invalid Done
  // persist indefinitely, since no further edit would ever change the hash.
  // Every other status is fine to dedup: skipping a re-read there just means
  // no new mutation was needed, not that an invalid state goes unchecked.
  // A Story is exempt regardless of Status — see isStory above, and
  // reconcileStoryTask_ never enforces the Done gate at all.
  const mustReverify = currentStatus === DEFAULTS.DONE_STATUS && !isStory;
  if (!mustReverify && hasProcessedSnapshot_(snapshotId)) return 'duplicate:' + pageId;

  const outcome = isStory
    ? reconcileStoryTask_(task.id, currentStatus, changedBy, snapshotId, when)
    : reconcileAuthoritativeTimeEvents_(
        task,
        currentStatus,
        desiredActor,
        changedBy,
        snapshotId,
        when
      );

  syncTaskProjection_(pageId, title, task.url || '', currentStatus, changedBy, snapshotId);
  logSnapshot_(snapshotId, 'notion_poll', pageId, currentStatus, when, outcome, taskType);
  return outcome;
}

// Reduced reconciliation for Type = Story pages (see reconcileTaskPage_):
// never opens a new Time Event no matter what Status reads, and never runs
// the Done gate — a Story is a rollup, not an execution unit, so its own
// completion needs no Time Event evidence. Its only remaining job is
// cleanup: remove every Time Event a Story accumulated before this
// exclusion existed, so pre-fix intervals do not linger forever
// (BUG-ADP-TTE-01) — ALL of them, not only ones still open. A closed
// legacy event is just as invalid as an open one: a Story that already
// left `In Progress` under the pre-fix reconciler (the ordinary case for
// most Stories — see `backfillStoryExclusion_` below for why this matters
// on an existing deployment) had its bogus event closed through the
// generic path with a real `Ended At`, computing a fictitious multi-day
// Duration (h) exactly like the still-open case archiveStoryTimeEvent_
// exists to prevent — filtering to only `openEvents` would leave every
// already-closed legacy interval sitting in the authoritative data
// forever, uncorrected.
//
// Archives every one of them rather than closing/leaving them — see
// archiveStoryTimeEvent_ for why closing was rejected: it would give an
// event a real `Ended At` and let Duration (h) compute over however long
// it was open, still inflating every historical Active-hour aggregation
// this reconciler does not directly control (the Sheet's own Duration (h)
// formula, and any downstream KPI aggregation reading Task Time Events).
// Nothing about any of these events was ever real work to time, so
// removing them — not recording or preserving a fictitious duration for
// them — matches what actually happened. Archiving (rather than a hard
// delete) also means Notion's own database/data-source queries exclude
// them going forward by default, so none of them can ever resurface as
// `openEvents` or in a future aggregation without this function needing to
// track that itself, and every row remains recoverable from Notion's
// trash if ever needed. archiveStoryTimeEvent_ also purges the event's row
// from the Google Sheet projection outright — Codex-reported gap in an
// earlier version of this fix: archiving removes the event from Notion's
// own queries, so syncTaskProjection_'s ordinary re-sync never revisits an
// already-projected row to update or delete it, and README documents the
// Summary tab's actor totals and open-event counts as derived from this
// same projection — a stale row (Duration (h) already computed, for a
// closed legacy event) would keep feeding that aggregation the identical
// double-counting this fix exists to stop, just moved from Notion to the
// Sheet instead of eliminated.
//
// BUT this "archive everything" behavior must never touch an event that
// represents genuine Task-era work — Codex-reported gap: Type transitions
// are supported symmetrically (see storyConversionHappenedWhileInProgress_ for the
// mirror-image Story-to-Task case), so a page can just as well go the
// other way, FROM a real executable Task WITH legitimate Time Events TO
// Type = Story. An event genuinely created (or touched) by the ordinary
// reconcileAuthoritativeTimeEvents_ path while this exact page really was
// a Task — real, completed or in-flight work — must never be archived
// outright the moment someone reclassifies the page.
// eventWasTouchedDuringTaskExecution_ decides this per EVENT, not per
// page — Codex-reported gap on an earlier, page-level version of this
// same fix: a page can be observed as an idle Task (Type = Task, e.g.
// Status = Ready) WITHOUT that observation ever touching a specific
// PRE-EXISTING event's own Note at all (nothing open to close, nothing
// new to open) — proving the PAGE was once seen as Task proves nothing
// about whether THIS event specifically was created or touched during
// that window, vs. being a pre-upgrade legacy Story event that merely
// happens to still be attached to a page that later, briefly, looked
// like a Task.
function reconcileStoryTask_(taskId, currentStatus, changedBy, snapshotId, when) {
  const events = queryNotionTimeEventsForTask_(taskId);
  if (!events.length) return 'story_excluded';

  const actions = [];
  events.forEach(function (eventPage) {
    if (eventWasTouchedDuringTaskExecution_(eventPage)) {
      // Preserve, never erase: an open Task-era interval is closed at the
      // conversion boundary exactly like any other Task leaving `In
      // Progress` (real work, real duration, correctly stopped from
      // accruing further now that this page routes through the Story path
      // going forward) — a completed one needs no action at all, since it
      // is already a legitimate closed interval that predates the
      // conversion and was never part of the bug this exclusion exists to
      // fix in the first place.
      if (!propertyDate_(eventPage.properties['Ended At'])) {
        closeNotionTimeEvent_(eventPage, currentStatus, changedBy, snapshotId, when, 'left_in_progress');
        actions.push('closed_task_era_at_story_conversion:' + eventPage.id);
      }
      return;
    }
    archiveStoryTimeEvent_(eventPage, changedBy, snapshotId);
    actions.push('archived_story_event:' + eventPage.id);
  });
  return actions.length ? actions.join(',') : 'story_excluded';
}

// Archives (see reconcileStoryTask_ for why) one of a Story's stray Time
// Events, open or already closed, stamping the same Reason=story_excluded
// marker used elsewhere in this file in the same request, so the record
// still explains itself if ever restored from Notion's trash. Also purges
// the event's row from the Sheet projection outright (see
// reconcileStoryTask_'s comment for why a stale row there matters, not
// just a cosmetic leftover).
//
// Purges the Sheet row BEFORE archiving in Notion, not after — Codex-
// reported gap in an earlier version of this fix: this whole operation is
// two separate remote writes, not one transaction, so Apps Script can be
// terminated (or the Sheet write can simply fail) between them. Archiving
// first would leave a retry with nothing to recover from: the event is
// already excluded from queryNotionTimeEventsForTask_'s results the moment
// it is archived (see reconcileStoryTask_'s comment), so a subsequent poll
// would never call this function for it again, and the stale Sheet row
// would linger forever, permanently inflating the Summary tab totals this
// fix exists to protect. Purging first makes the interruption safe instead:
// purgeSheetProjectionRow_ is already a no-op when the row is absent, so a
// retry that reaches this function again for the same still-unarchived
// event (still visible in queryNotionTimeEventsForTask_) simply re-attempts
// the purge (harmless) and then the archive — converging either way.
function archiveStoryTimeEvent_(eventPage, changedBy, snapshotId) {
  purgeSheetProjectionRow_(eventPage.id);
  const existingNote = propertyText_(eventPage.properties.Note);
  const marker = buildNote_({ reason: 'story_excluded', snapshotId: snapshotId, changedBy: changedBy });
  notionRequest_('patch', '/v1/pages/' + encodeURIComponent(eventPage.id), {
    archived: true,
    properties: {
      Note: { rich_text: [{ type: 'text', text: { content: appendNote_(existingNote, marker, 1800) } }] },
    },
  });
}

// Operator escape hatch for an EXISTING live deployment being upgraded to
// add the Type = Story exclusion (see reconcileStoryTask_): queries every
// Type = Story page directly, regardless of Status — independent of
// last_edited_time or the cursor — and reconciles each through the
// ordinary reconcileTaskPage_ entry point, which archives every Time Event
// a Story has via reconcileStoryTask_, open or already closed.
//
// Deliberately not scoped to Status = In Progress, for two independent
// reasons a narrower query would miss:
// 1. On such a deployment BOOTSTRAP_ACTIVE_DONE is already set from
//    before, so the ordinary pollTaskChanges bootstrap — which only ever
//    runs once, before that flag is set — never revisits a Story that has
//    already been sitting In Progress since before this revision was
//    deployed. Its pre-fix open Time Event would otherwise stay Active and
//    keep inflating Active-hour totals indefinitely, until some unrelated
//    future edit happens to touch that exact Story.
// 2. Most Stories on a live deployment have already LEFT In Progress under
//    the pre-fix reconciler by the time this runs — Codex-reported gap in
//    an earlier version of this backfill, which queried only
//    Status = In Progress: a Story that already left In Progress had its
//    bogus event closed through the ordinary generic path, with a real
//    Ended At and a fictitious multi-day Duration (h) computed over it —
//    exactly the double-counting this exclusion exists to stop, just
//    already recorded rather than still accruing, and a Status = In
//    Progress filter would never even see that Story again to correct it.
//    Every Type = Story page, regardless of current Status, needs a single
//    pass through reconcileStoryTask_ to archive whatever it has.
// A fresh deploy has no pre-existing Story Time Events at all and needs no
// backfill: the exclusion applies to every poll from day one. Run once
// from the editor immediately after deploying this revision.
//
// Resumable the same way backfillResultFingerprints_ is, and for the same
// reason: archiving a Story's Time Event does not remove the Story itself
// from this query's own Type=Story result set (nothing about its Type
// changed), so a truncated call's unqualified
// re-run would keep re-fetching the identical oldest prefix forever —
// reconciling it again is a free re-scan, but Story pages *beyond* that
// prefix would never be reached despite the "call again to continue"
// instruction below. STORY_EXCLUSION_RESUME_CURSOR (queried with
// on_or_after, plus a local STORY_EXCLUSION_RESUME_TIE_OFFSET skip so a
// tied last_edited_time at the truncation boundary resumes correctly
// rather than silently dropping its remainder) tracks how far a prior call
// actually got. Same accepted, extreme-scale limitation as
// LAST_SYNC_CURSOR_TIE_OFFSET / BACKFILL_RESUME_TIE_OFFSET elsewhere in
// this file: a single tied last_edited_time group wide enough to itself
// exceed QUERY_PAGE_SAFETY_LIMIT (thousands of Stories sharing one exact
// minute) cannot be fully resolved this way, since Notion's public API
// offers no secondary sort key to page within an exact-timestamp tie — see
// README "Known limitations".
//
// Also bounds its own pagination phase the same way backfillResultFingerprints_
// does, and for the same reason: an unbounded fetch (up to
// QUERY_PAGE_SAFETY_LIMIT round trips) could otherwise spend the entire
// MAX_RUN_DURATION_MS budget just fetching pages before the processing loop
// below ever runs its own deadline check — leaving nothing processed, and
// therefore no checkpoint to persist, so every retry would repeat the
// identical fetch-only pass forever instead of ever making progress.
function backfillStoryExclusion_() {
  return withPollLock_(function () {
    const runStartedAt = new Date();
    const props = PropertiesService.getScriptProperties();
    const resumeCursor = props.getProperty('STORY_EXCLUSION_RESUME_CURSOR');
    const tieOffset = resumeCursor ? Number(props.getProperty('STORY_EXCLUSION_RESUME_TIE_OFFSET') || '0') : 0;
    const filter = resumeCursor
      ? { and: [
          { property: 'Type', select: { equals: 'Story' } },
          { timestamp: 'last_edited_time', last_edited_time: { on_or_after: resumeCursor } },
        ] }
      : { property: 'Type', select: { equals: 'Story' } };
    function tieOffsetStartIndex_(results) {
      let index = 0;
      if (resumeCursor && tieOffset > 0) {
        let skipped = 0;
        while (
          index < results.length &&
          skipped < tieOffset &&
          String(results[index].last_edited_time || '') === resumeCursor
        ) {
          skipped++;
          index++;
        }
      }
      return index;
    }
    // Reserve half the run budget for pagination, leaving the rest
    // (MIN_PROCESSING_RESERVE_MS short of the full budget) for actually
    // processing and checkpointing whatever got retrieved. A resumed call
    // whose persisted tie offset already exceeds what the half-budget alone
    // can fetch is allowed to keep fetching past that primary deadline —
    // hasProgress below reports whether the current fetch already has
    // something past the tie-offset skip to work with — same escalation
    // pattern as backfillResultFingerprints_, for the identical reason: a
    // second, independent pagination pass starting over would only re-fetch
    // from page 1 again and waste the time this one already spent.
    const result = paginateNotionQuery_(
      '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
      {
        page_size: 100,
        filter: filter,
        sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
      },
      runStartedAt.getTime() + MAX_RUN_DURATION_MS / 2,
      runStartedAt.getTime() + MAX_RUN_DURATION_MS - MIN_PROCESSING_RESERVE_MS,
      function (results) { return tieOffsetStartIndex_(results) < results.length; }
    );
    const startIndex = tieOffsetStartIndex_(result.results);
    const toProcess = result.results.slice(startIndex);

    const outcomes = [];
    let iterated = 0;
    while (
      iterated < toProcess.length &&
      (Date.now() - runStartedAt.getTime()) < MAX_RUN_DURATION_MS
    ) {
      outcomes.push(reconcileTaskPage_(toProcess[iterated]));
      iterated++;
    }
    const timedOut = iterated < toProcess.length;
    const processed = toProcess.slice(0, iterated);

    if ((result.truncated || timedOut) && processed.length) {
      const lastSeen = String(processed[processed.length - 1].last_edited_time || '');
      if (lastSeen) {
        props.setProperty('STORY_EXCLUSION_RESUME_CURSOR', lastSeen);
        // Same carry-over rule as backfillResultFingerprints_: if this
        // call's own tail is still the exact same tied timestamp the
        // resume cursor already pointed at, the members that resume's own
        // tieOffset already skipped (processed by an earlier call, not
        // present in `processed` at all) belong to the same tie and must
        // be counted cumulatively — otherwise every further call spanning
        // the same cohort re-skips to only what THAT call processed and
        // re-walks the same middle slice forever.
        let newTieOffset = 0;
        for (let i = 0; i < processed.length; i++) {
          newTieOffset = String(processed[i].last_edited_time || '') === lastSeen ? newTieOffset + 1 : 0;
        }
        const cumulativeTieOffset = (lastSeen === resumeCursor ? tieOffset : 0) + newTieOffset;
        props.setProperty('STORY_EXCLUSION_RESUME_TIE_OFFSET', String(cumulativeTieOffset));
      }
      Logger.log(
        'backfillStoryExclusion_: stopped at the ' +
        (timedOut ? 'wall-clock bound' : 'pagination safety limit') +
        ' after reconciling ' + iterated + ' of ' + result.results.length +
        ' Story page(s) still In Progress this call — call again to resume' +
        (processed.length ? ' from ' + processed[processed.length - 1].last_edited_time : '') + '.'
      );
    } else if (result.truncated || timedOut) {
      // Stopped with nothing new processed this call (the whole returned
      // batch was already covered by the tie-offset skip): leave the
      // resume state exactly as it was rather than losing the resume
      // point — same rule pollTaskChanges/backfillResultFingerprints_
      // apply for the identical scenario.
    } else {
      // Fully drained: clear any stale resume point so a future call
      // starts a fresh full pass.
      props.setProperty('STORY_EXCLUSION_RESUME_CURSOR', '');
      props.setProperty('STORY_EXCLUSION_RESUME_TIE_OFFSET', '');
    }

    return {
      scanned: result.results.length,
      processed: iterated,
      truncated: result.truncated,
      timedOut: timedOut,
      outcomes: outcomes,
    };
  });
}

// Tasks whose last_edited_time is at or after `since`, oldest first, so a
// capped run leaves a contiguous unprocessed tail behind the cursor. Returns
// { results, truncated } — see paginateNotionQuery_.
function queryChangedTasks_(since) {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    {
      page_size: 100,
      filter: {
        timestamp: 'last_edited_time',
        last_edited_time: { on_or_after: since.toISOString() },
      },
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
    }
  );
}

// Bootstrap-only query: every Task currently Status = In Progress, regardless
// of last_edited_time. Used exactly once per fresh deploy (or cursor reset),
// so a Task that has been active since before the initial lookback window
// still gets an open Time Event instead of never receiving one. Returns
// { results, truncated } — see paginateNotionQuery_.
// Sorted ascending and, once a prior call truncated, filtered to strictly
// after the last Task it actually retrieved — BOOTSTRAP_ACTIVE_RESUME_CURSOR,
// managed by the caller (pollTaskChanges) — so a deployment with more than
// QUERY_PAGE_SAFETY_LIMIT pages' worth of simultaneously In Progress Tasks
// can be drained across repeated bootstrap runs instead of the exact same
// unsorted, un-resumed prefix being returned every time.
function queryActiveInProgressTasks_() {
  const props = PropertiesService.getScriptProperties();
  const resumeCursor = props.getProperty('BOOTSTRAP_ACTIVE_RESUME_CURSOR');
  // on_or_after (not a strict after) plus a local tie-offset skip — same
  // pattern as backfillResultFingerprints_ and LAST_SYNC_CURSOR_TIE_OFFSET —
  // so a resumed call is not silently missing whatever unretrieved active
  // Tasks still share the exact resume timestamp (last_edited_time is
  // minute-granular).
  const tieOffset = resumeCursor ? Number(props.getProperty('BOOTSTRAP_ACTIVE_RESUME_TIE_OFFSET') || '0') : 0;
  const filter = resumeCursor
    ? { and: [
        { property: 'Status', [DEFAULTS.STATUS_PROPERTY_TYPE]: { equals: DEFAULTS.START_STATUS } },
        { timestamp: 'last_edited_time', last_edited_time: { on_or_after: resumeCursor } },
      ] }
    : { property: 'Status', [DEFAULTS.STATUS_PROPERTY_TYPE]: { equals: DEFAULTS.START_STATUS } };
  const result = paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    {
      page_size: 100,
      filter: filter,
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
    }
  );
  let startIndex = 0;
  if (resumeCursor && tieOffset > 0) {
    let skipped = 0;
    while (
      startIndex < result.results.length &&
      skipped < tieOffset &&
      String(result.results[startIndex].last_edited_time || '') === resumeCursor
    ) {
      skipped++;
      startIndex++;
    }
  }
  return { results: result.results.slice(startIndex), truncated: result.truncated };
}

// Dedups two Task-page lists by page ID (first occurrence wins) and returns
// them sorted ascending by last_edited_time, so the poll loop's cursor-
// advancement math stays correct regardless of which source list a given
// Task came from.
function mergeTasksById_(primary, secondary) {
  const seen = {};
  const merged = [];
  [primary, secondary].forEach(function (list) {
    (list || []).forEach(function (task) {
      const id = task && task.id;
      if (!id || seen[id]) return;
      seen[id] = true;
      merged.push(task);
    });
  });
  merged.sort(function (a, b) {
    return String(a.last_edited_time || '').localeCompare(String(b.last_edited_time || ''));
  });
  return merged;
}

// Outcomes that made no Notion write, and are therefore free to re-skip
// without charging the per-run reconciliation budget (MAX_TASKS_PER_RUN).
function isFreeOutcome_(outcome) {
  // 'done_gate_passed' makes no Notion write (a Done Task that already meets
  // every requirement is left exactly as it is), so it is free to re-verify
  // on every poll just like a duplicate or ignored outcome. Without this,
  // always re-verifying Done (see reconcileTaskPage_) would let a run of 25+
  // already-valid Done Tasks inside the overlap window exhaust the
  // reconciliation budget on themselves every single run, permanently
  // starving whatever changed Task sorts behind them — the same stall this
  // budget exists to prevent, just triggered by successes instead of
  // duplicates. A rejected Done ('done_gate_rejected:...') still counts: it
  // made a real write (the rollback) and is exactly the case the always-
  // reverify rule exists to keep catching.
  // 'story_excluded' makes no Notion write either (a Type = Story page with
  // nothing open to archive away — see reconcileStoryTask_) — free to
  // re-scan on every poll just like a duplicate or ignored outcome. A Story
  // that DID have a stray open event archived reports
  // 'archived_story_event:...' instead, which is a real write and does
  // count, the same as any other write.
  return outcome === 'ignored:not_configured_task' ||
    outcome === 'done_gate_passed' ||
    outcome === 'story_excluded' ||
    /^duplicate:/.test(String(outcome));
}

function reconcileAuthoritativeTimeEvents_(task, currentStatus, desiredActor, changedBy, snapshotId, when) {
  const taskId = task.id;
  const taskTitle = propertyText_(task.properties.Title) || taskId;
  const allEvents = queryNotionTimeEventsForTask_(taskId);
  const openEvents = allEvents.filter(function (eventPage) {
    return !propertyDate_(eventPage.properties['Ended At']);
  });
  const actions = [];

  // Done is a completion gate, not a stop trigger. The Time Event and required
  // completion evidence must already exist before Done is allowed to persist.
  if (currentStatus === DEFAULTS.DONE_STATUS) {
    return enforceDoneGate_(task, allEvents, openEvents);
  }

  if (currentStatus === DEFAULTS.START_STATUS) {
    const sameActor = [];
    const otherActor = [];

    openEvents.forEach(function (eventPage) {
      const actor = propertyText_(eventPage.properties.Actor);
      if (desiredActor && actor === desiredActor) sameActor.push(eventPage);
      else otherActor.push(eventPage);
    });

    otherActor.forEach(function (eventPage) {
      closeNotionTimeEvent_(eventPage, currentStatus, changedBy, snapshotId, when, 'reassignment');
      actions.push('closed_reassigned:' + eventPage.id);
    });

    if (!desiredActor) {
      return actions.length ? actions.join(',') : 'in_progress_without_mapped_actor';
    }

    sameActor.sort(function (a, b) {
      return eventStartedAt_(b).getTime() - eventStartedAt_(a).getTime();
    });

    if (sameActor.length) {
      for (let i = 1; i < sameActor.length; i++) {
        closeNotionTimeEvent_(sameActor[i], currentStatus, changedBy, snapshotId, when, 'duplicate_reconciliation');
        actions.push('closed_duplicate:' + sameActor[i].id);
      }
      actions.push('already_open:' + sameActor[0].id);
    } else {
      // Prefer the Task's own current Started At over `when` (the observed
      // edit time) whenever it looks like the true start of *this*
      // execution rather than a stale leftover from history — i.e. it is at
      // or after every timestamp already on file for this Task. This covers
      // both the first-ever event (no history yet, so any Started At
      // qualifies) and a reopened Task, where governance requires Started At
      // to be freshly recorded for the new execution. Without this, a
      // reopened Task whose next poll observes a *later* edit (e.g. an
      // assignment change made moments after the restart, still within the
      // same interval) would open its new event at that later edit instead
      // of the execution's real start, silently dropping the time between.
      // `allEvents` was fetched at the top of this call, before the
      // otherActor.forEach above closed anything — so if a reassignment just
      // happened this same call, allEvents' in-memory copy of that outgoing
      // event still shows no Ended At, and latestEventTimestamp_ can't see
      // it. Without accounting for that, an unchanged Task-level Started At
      // (correctly representing the whole execution's true start) looks
      // "trusted" and the replacement actor's event opens there instead of
      // at the reassignment boundary — overlapping the outgoing actor's own
      // interval and double-counting effort. `when` (this observed edit,
      // i.e. the reassignment itself) must count as part of history
      // whenever we just closed something this call.
      const latestHistoricalTimestamp = latestEventTimestamp_(allEvents);
      const effectiveLatestHistoricalTimestamp = otherActor.length
        ? (latestHistoricalTimestamp && latestHistoricalTimestamp.getTime() > when.getTime() ? latestHistoricalTimestamp : when)
        : latestHistoricalTimestamp;
      const taskStartedAt = propertyDate_(task.properties['Started At']);
      // A page most recently seen as Type=Story WHILE ALREADY In Progress
      // (see storyConversionHappenedWhileInProgress_) must never have its
      // Started At trusted here, however fresh it looks against allEvents
      // — when allEvents is empty for it, that emptiness is precisely
      // because its real history was archived away, not because Started
      // At is reliable, and a page that never left In Progress across the
      // Type change still carries the STORY's own original Started At
      // unchanged, not a freshly recorded one. Fall through to `when`
      // (this observed edit, i.e. the Story-to-Task reclassification
      // itself) as the execution's start instead, exactly as Codex's
      // finding suggested: the type-change edit is what actually begins
      // this Task's own executable life, not whatever Started At happened
      // to read from its time as a Story.
      //
      // Gated on allEvents.length === 0, not called unconditionally —
      // Codex-reported gap in an earlier version of this fix, on two
      // counts. Performance: every ordinary Task open (the vast majority
      // of which were never a Story) would otherwise re-scan this script's
      // entire, unboundedly-growing Sync Log on every single poll, just to
      // learn "no" every time. Correctness: a page's Story history never
      // expires on its own, even long after its own first post-conversion
      // execution completed and closed a real Task-era event — an
      // unconditional call would keep discarding a perfectly legitimate
      // fresh Started At on every later reopen of that same now-ordinary
      // Task, silently losing whatever work happened between the reopen
      // and the next observed edit. allEvents.length === 0 is exactly the
      // condition that actually needs this exception: it is only true for
      // a page's first-ever event (nothing to distrust yet) or a page
      // whose only "history" was just archived out from under it (the
      // Story case this exists to catch) — the moment any real Task-era
      // event exists, on any later reopen, the ordinary
      // effectiveLatestHistoricalTimestamp freshness check below already
      // does the right thing on its own, with no Story-specific override
      // needed at all.
      //
      // Further narrowed to "most recent Story observation was itself In
      // Progress" rather than "was ever Story, regardless of what it was
      // doing then" — Codex-reported gap: a page reclassified while idle
      // (Ready/Backlog) and only later beginning its actual first
      // execution has a Started At that was freshly (re)recorded for THAT
      // execution, same governance as any ordinary Task's first open, and
      // has nothing to do with old Story history. Only a page still In
      // Progress at its last-known Story observation carries real risk:
      // nothing about staying continuously In Progress across a Type
      // change would ever prompt Started At to be refreshed.
      const cameFromArchivedStoryHistory = allEvents.length === 0 && storyConversionHappenedWhileInProgress_(taskId);
      const trustedTaskStart = taskStartedAt
        && !cameFromArchivedStoryHistory
        && (!effectiveLatestHistoricalTimestamp || taskStartedAt.getTime() >= effectiveLatestHistoricalTimestamp.getTime())
        ? taskStartedAt
        : null;
      const startAt = trustedTaskStart || when;
      // The execution identifier must stay identical across every event
      // belonging to one continuous execution — the first-ever event AND
      // any reassignment replacement within it — so enforceDoneGate_ can
      // recognize them as the same execution without inferring it from
      // timestamp ties. The Task's raw Started At is NOT safe to use
      // directly for this: if governance was violated and Started At was
      // never actually refreshed at a genuine reopen, the newly (re)opened
      // event would inherit the *stale* old value indistinguishably from
      // the prior execution's own events, defeating the whole point. A
      // reassignment replacement instead inherits the outgoing event's own
      // Execution= marker directly (whatever it already was, correct or
      // not) — reassigning never changes which execution is running. The
      // first-ever event of a genuinely new execution gets `startAt` itself:
      // exactly the value already computed above to correctly fall back to
      // `when` instead of a stale Started At, so a governance violation
      // still gets a fresh, distinguishing identity rather than reusing the
      // old one.
      const outgoingExecutionId = otherActor.length
        ? (otherActor.map(function (eventPage) {
            return parseNoteMeta_(propertyText_(eventPage.properties.Note)).execution;
          }).find(Boolean) || '')
        : '';
      // A reassignment (otherActor.length) replacing a *legacy* outgoing
      // event — one that predates this field and so has no Execution= to
      // inherit — must NOT fall back to `startAt` here: `startAt` is
      // deliberately the reassignment boundary in this exact branch (see
      // above and Finding 1), not the execution's true start, so stamping
      // it as the identity would tag the replacement with a value that will
      // almost never match the Task's own (unchanged, still-correct)
      // Started At once this closes — permanently misclassifying a
      // genuinely current event as prior and blocking Done forever after
      // an upgrade mid-execution.
      //
      // An earlier version of this fallback used the Task's raw Started At
      // instead — reasoning that, unlike the first-ever-open case, this Task
      // is already open, so its Started At already identifies the ongoing
      // execution. Codex found the gap: nothing here verifies that. The
      // outgoing event carries no Execution= of its own precisely because it
      // predates the field, so there is no independently-verified value to
      // compare Started At against — it is trusted outright, unconditionally,
      // with none of the freshness checks used everywhere else this file
      // trusts Started At (`trustedTaskStart` just above, `taskStartedAtTrusted`
      // in enforceDoneGate_). If Started At was ever edited independently of
      // this event's true start — a data-entry correction, a bulk edit, or
      // truly the same governance-violating invisible-reopen risk `startAt`'s
      // own fallback above already guards against — the replacement would
      // carry a manufactured identity that happens not to match whatever
      // Started At reads at Done-check time. That is *worse* than carrying no
      // marker at all: enforceDoneGate_'s Execution= pass authoritatively
      // DELETES a mismatched event from current-execution membership even
      // when the legacy Reason-based heuristic would have correctly kept it
      // in, turning a self-inflicted, unverifiable mismatch into Done being
      // wrongly blocked for an execution that never actually reopened.
      //
      // There is no available signal here to tell "Started At is still this
      // event's true start" apart from "it drifted" — this call site cannot
      // see anything past what a `Reason=reassignment` marker on the
      // outgoing event already tells the legacy heuristic. So, exactly like
      // stampExecutionBoundary_'s own identical dilemma (see its comment),
      // the safe choice is to manufacture nothing: leave the replacement
      // unmarked and let the same legacy Reason/Boundary/tie heuristic that
      // already, correctly, carried the outgoing event decide the
      // replacement's membership too. Only the true first-ever-open case (no
      // otherActor at all) still needs `startAt`'s own stale-Started-At
      // fallback behavior — there, no outgoing event's Reason marker exists
      // to fall back on, so `startAt` (already gated by `trustedTaskStart`
      // above) is the only signal available at all.
      const executionId = otherActor.length
        ? outgoingExecutionId
        : startAt.toISOString();
      const created = createNotionTimeEvent_(taskId, taskTitle, desiredActor, changedBy, snapshotId, startAt, executionId);
      actions.push('opened:' + created.id);
    }
  } else if (openEvents.length) {
    // Review / Blocked / Ready / Backlog are non-active Task states and may close
    // intervals. Done is intentionally handled above and never closes timing.
    openEvents.forEach(function (eventPage) {
      closeNotionTimeEvent_(eventPage, currentStatus, changedBy, snapshotId, when, 'left_in_progress');
      actions.push('closed:' + eventPage.id);
    });
  } else {
    // Nothing was open — either the assignee had already been cleared
    // (closing its event via 'reassignment') before the Task left In
    // Progress, so there is no event to close here at all, OR this Task was
    // already correctly closed by a *prior* poll (its open event closed then
    // with the ordinary 'left_in_progress' reason) and this call is simply
    // re-observing it later, still out of In Progress, for an unrelated
    // reason (e.g. Result being edited). Only the first case needs a
    // retroactive marker: a 'reassignment'/'duplicate_reconciliation' close
    // never marks an execution boundary on its own (see the Reason-based
    // membership rule in enforceDoneGate_), so without one, this transition
    // would otherwise leave none, letting a real prior execution's
    // reassignment-only close go on looking "current" forever. A plain
    // 'left_in_progress' close is already unambiguous prior-execution
    // evidence by Reason alone — it needs no marker, and re-stamping it here
    // on every later re-observation would wrongly exclude it from the Done
    // gate's tie-seed (see enforceDoneGate_) even when it is the genuinely
    // CURRENT applicable event, rejecting a legitimate Done as
    // stale_task_started_at. Stamp the most-recently-closed event only when
    // its own Reason is exactly the case this marker exists for — not a
    // phantom zero-duration Time Event, since nothing was actually open.
    let mostRecentClosed = null;
    (allEvents || []).forEach(function (eventPage) {
      const endedAt = propertyDate_(eventPage.properties['Ended At']);
      if (!endedAt) return;
      if (!mostRecentClosed || endedAt.getTime() > propertyDate_(mostRecentClosed.properties['Ended At']).getTime()) {
        mostRecentClosed = eventPage;
      }
    });
    if (mostRecentClosed) {
      const mostRecentClosedMeta = parseNoteMeta_(propertyText_(mostRecentClosed.properties.Note));
      const needsBoundary = mostRecentClosedMeta.reason === 'reassignment' || mostRecentClosedMeta.reason === 'duplicate_reconciliation';
      if (needsBoundary && mostRecentClosedMeta.boundary !== 'left_in_progress') {
        // Deliberately never backfills Execution= here, even for a legacy
        // event with none yet. An earlier version did — filling it in from
        // the Task's own CURRENT Started At — to save exactly the case this
        // whole branch exists for: a legacy event that is genuinely this
        // Task's only (and therefore current) execution, which would
        // otherwise fall back to the legacy Reason/Boundary heuristic and be
        // wrongly excluded from current-execution membership. But this call
        // site cannot tell that case apart from the one right next to it in
        // the README's "Known limitations": a Task reopened and restarted
        // entirely inside one poll window, whose new In Progress spell was
        // never itself observed. There, by the time this branch runs, the
        // Task's current Started At already reflects the NEW (invisible)
        // execution, while `mostRecentClosed` is still evidence from the
        // OLD one — backfilling Execution= from the Task's current Started
        // At would tag that stale old event as belonging to the new
        // execution it has nothing to do with, letting a Done with no valid
        // Time Event for the new execution pass anyway. Both cases reach
        // this exact branch with the exact same information available
        // (a Reason-eligible closed event, no Execution= yet, and the
        // Task's own current Started At); there is no way from here to know
        // which one this is. Leaving Execution= unstamped reintroduces the
        // narrower, already-documented self-poisoning gap for the first
        // case (see README "Known limitations") rather than risk silently
        // accepting a stale-Result reopen for the second — the Boundary=
        // stamp alone (still applied below) is enough for the legacy
        // heuristic to keep working for both.
        stampExecutionBoundary_(mostRecentClosed, '');
        actions.push('boundary:' + mostRecentClosed.id);
      }
    }
  }

  return actions.length ? actions.join(',') : 'no_change:' + currentStatus;
}

function enforceDoneGate_(task, allEvents, openEvents) {
  const failures = [];
  const result = propertyText_(task.properties.Result).trim();
  const completedAt = propertyDate_(task.properties['Completed At']);

  // A closed Time Event must apply to the *current* execution, not merely
  // exist somewhere in the Task's history. Reopen -> restart cases can leave
  // an old closed event on the Task while the restart's own In Progress spell
  // never surfaces to the reconciler — a Task edited into and back out of
  // In Progress inside one poll window is only ever observed in its final
  // state (see README "Known limitations"). Counting any historical closed
  // event would then let a stale interval from a previous completed execution
  // satisfy Done for work that was never timed. `Started At` on the Task
  // itself is the current-execution marker:
  // governance requires it to be (re)recorded whenever a fresh execution
  // begins. A closed event only counts if it started at or after that
  // marker.
  const taskStartedAt = propertyDate_(task.properties['Started At']);
  const taskStartedAtIso = taskStartedAt ? taskStartedAt.toISOString() : null;

  // Started At itself must look fresh before it can be trusted to identify
  // "the current execution" at all — otherwise the applicability check below
  // is a tautology. If a Task is reopened without replacing Started At, a
  // new closed event naturally still starts *after* that stale marker (time
  // only moves forward), so "event started at/after Started At" would treat
  // it as applicable even though Started At was never actually refreshed
  // for this execution — governance requires it to be. Detect this the same
  // way reconcileAuthoritativeTimeEvents_ decides whether to trust it when
  // opening a new event: Started At must be at or after every event already
  // on file for this Task that is NOT part of the current execution.
  //
  // A single execution can produce more than one closed event — an
  // in-progress reassignment (including an assignee being cleared and only
  // later reassigned, which can leave a real time gap with no open event in
  // between) closes the outgoing actor's event via
  // reconcileAuthoritativeTimeEvents_'s 'reassignment' cleanup, and a
  // duplicate open event is closed via its 'duplicate_reconciliation'
  // cleanup — neither ever ends an execution, only 'left_in_progress' does.
  // So membership is decided by that Reason marker, not by timestamp
  // adjacency: an event closed 'reassignment' or 'duplicate_reconciliation'
  // is part of whatever execution is current, however far its own Ended At
  // sits from anything else (an assignment gap, or a duplicate detected
  // well after the fact, are exactly this) — UNLESS it also carries a
  // 'Boundary=left_in_progress' marker (see reconcileAuthoritativeTime
  // Events_'s no-open-events branch): a reassignment/clear can end up being
  // the last thing ever recorded for an execution that reassigned its only
  // actor away and then left In Progress with nothing open to close, and
  // reconcileAuthoritativeTimeEvents_ retroactively stamps that boundary
  // onto the most-recently-closed event precisely so this check can still
  // tell that execution actually ended there. Without it, every historical
  // reassignment marker would look like "still current," no matter how long
  // ago its execution really finished.
  //
  // The seed (never evidence against itself, since it's the candidate
  // applicable event this whole check exists to validate) is every event
  // sharing the single latest Ended At, not just one arbitrarily chosen
  // among ties: a Task first observed after leaving In Progress with
  // multiple open events closes all of them at the identical timestamp, and
  // each is equally "now" — picking only one would leave its equally recent
  // siblings looking like prior-execution evidence. Anything else — a
  // genuine 'left_in_progress' close (the Task actually left In Progress
  // there), a boundary-marked reassignment/duplicate, or no reason at all
  // (legacy data) — is a real execution boundary and stays prior-execution
  // evidence even if it happens to coincide in time with something in the
  // current one (e.g. both landing in the same Notion minute).
  const closedEvents = (allEvents || []).filter(function (eventPage) {
    return Boolean(propertyDate_(eventPage.properties['Ended At']));
  });
  let latestEndedAt = null;
  closedEvents.forEach(function (eventPage) {
    const endedAt = propertyDate_(eventPage.properties['Ended At']);
    if (!latestEndedAt || endedAt.getTime() > latestEndedAt.getTime()) latestEndedAt = endedAt;
  });
  const currentExecutionEventIds = {};
  closedEvents.forEach(function (eventPage) {
    const endedAt = propertyDate_(eventPage.properties['Ended At']);
    if (!latestEndedAt || endedAt.getTime() !== latestEndedAt.getTime()) return;
    // last_edited_time is minute-granular (see README Known limitations), so
    // a genuinely prior execution's own boundary close and the current
    // execution's close CAN land on the identical recorded Ended At by pure
    // coincidence, not just a true simultaneous multi-event close. An event
    // explicitly, retroactively marked Boundary=left_in_progress carries a
    // much stronger claim than a plain Reason=left_in_progress ever does —
    // it was deliberately stamped specifically to say "this is where a past
    // execution genuinely ended" — so it must never be swept into the seed
    // by a mere timestamp tie. A plain Reason=left_in_progress event with no
    // such marker stays tie-seedable: that is the ambiguous, ordinary case
    // (e.g. a Task first observed after leaving In Progress with multiple
    // open events, all genuinely closed together this same call) the tie
    // rule exists to handle, and Boundary is never stamped on it.
    if (parseNoteMeta_(propertyText_(eventPage.properties.Note)).boundary === 'left_in_progress') return;
    currentExecutionEventIds[eventPage.id] = true;
  });
  closedEvents.forEach(function (eventPage) {
    const meta = parseNoteMeta_(propertyText_(eventPage.properties.Note));
    const isExecutionBoundary = meta.reason === 'left_in_progress' || meta.boundary === 'left_in_progress';
    if (!isExecutionBoundary && (meta.reason === 'reassignment' || meta.reason === 'duplicate_reconciliation')) {
      currentExecutionEventIds[eventPage.id] = true;
    }
  });
  // Everything above is a heuristic inferring membership from timestamp ties
  // and Reason/Boundary markers — necessarily so for data that predates the
  // Execution= field, but vulnerable to exactly the class of coincidental-tie
  // ambiguity Codex kept finding new cases of: last_edited_time's minute
  // granularity means two genuinely DIFFERENT executions' closes can land on
  // the identical Ended At, and no combination of Reason/Boundary/tie rules
  // can fully tell them apart without literally identifying which execution
  // each one belongs to. An event stamped with an explicit Execution= marker
  // (see createNotionTimeEvent_) doesn't need inference at all: it is
  // current if and only if that marker exactly equals the Task's own
  // current Started At (Started At does not change across a mid-execution
  // reassignment, so every event opened during one continuous execution —
  // the original open and any reassignment replacement within it — carries
  // the identical value). This authoritatively overrides whatever the
  // heuristic above concluded for such an event; only an event with no
  // Execution= marker at all (created before this field existed) is left to
  // that heuristic.
  closedEvents.forEach(function (eventPage) {
    const meta = parseNoteMeta_(propertyText_(eventPage.properties.Note));
    if (!meta.execution) return;
    if (taskStartedAtIso && meta.execution === taskStartedAtIso) {
      currentExecutionEventIds[eventPage.id] = true;
    } else {
      delete currentExecutionEventIds[eventPage.id];
    }
  });
  const priorTimestamp = latestEventTimestamp_((allEvents || []).filter(function (eventPage) {
    return !currentExecutionEventIds[eventPage.id];
  }));
  const taskStartedAtTrusted = Boolean(taskStartedAt) && (!priorTimestamp || taskStartedAt.getTime() >= priorTimestamp.getTime());

  let applicableClosedEvent = null;
  if (!taskStartedAt) {
    failures.push('missing_task_started_at');
  } else if (!taskStartedAtTrusted) {
    failures.push('stale_task_started_at');
  } else {
    (allEvents || []).forEach(function (eventPage) {
      const endedAt = propertyDate_(eventPage.properties['Ended At']);
      if (!endedAt) return;
      // Applicability must go through the SAME current-execution
      // classification `currentExecutionEventIds` above already computed —
      // never re-derive it from a separate, parallel timestamp check. An
      // event a prior execution's reassignment replacement whose own
      // `Started At`/`Ended At` happen to land in the same minute as the
      // current (later, possibly never-observed-reopen) `Started At` can
      // satisfy `eventStartedAt_ >= taskStartedAt` on timestamps alone even
      // though its `Execution=` marker (or the legacy heuristic) has
      // already, correctly, excluded it as prior evidence. Without this
      // check, such an event could be selected as applicable and let Done
      // pass for an execution that produced no real Time Event of its own.
      if (!currentExecutionEventIds[eventPage.id]) return;
      if (eventStartedAt_(eventPage).getTime() < taskStartedAt.getTime()) return;
      // Prefer the most-recently-closed applicable event, so a stale
      // Completed At is checked against the freshest legitimate close below.
      if (!applicableClosedEvent || endedAt.getTime() > propertyDate_(applicableClosedEvent.properties['Ended At']).getTime()) {
        applicableClosedEvent = eventPage;
      }
    });
    if (!applicableClosedEvent) failures.push('missing_applicable_time_event');
  }

  if (openEvents && openEvents.length) failures.push('open_time_event');

  // Result must not just be *present* either — Notion does not clear it on
  // reopen, so a reopened Task can retain the Result text written for its
  // prior, already-finished execution. Unlike Completed At, Result carries
  // no timestamp of its own to check freshness against, so instead: mark
  // each closed event with a fingerprint of the Result value that validated
  // Done against it (markResultValidated_, below), and reject if that exact
  // fingerprint is already recorded on a *different*, earlier closed event
  // for this Task — i.e. this text already served as evidence for a prior
  // execution and was never actually refreshed for this one. A match on the
  // *current* applicable event's own fingerprint is fine and expected: Done
  // is always re-verified (reconcileTaskPage_), so an unchanged, already-
  // validated Result recurs on every re-check of a still-Done Task.
  if (!result) {
    failures.push('missing_result');
  } else if (applicableClosedEvent) {
    const currentFingerprint = resultFingerprint_(result);
    const reusedFromEarlierExecution = (allEvents || []).some(function (eventPage) {
      if (eventPage.id === applicableClosedEvent.id) return false;
      const meta = parseNoteMeta_(propertyText_(eventPage.properties.Note));
      // Check every fingerprint that event ever validated, not just the
      // most recent — Result can be edited more than once while a Task
      // stays Done on the same applicable event, each edit adding its own
      // stamp rather than replacing the last.
      return meta.resultFingerprints.indexOf(currentFingerprint) >= 0;
    });
    if (reusedFromEarlierExecution) failures.push('stale_result');
  }

  // Completed At must not just be *present* — a reopened Task can retain an
  // old Completed At from its prior, already-finished execution, and Notion
  // does not clear it on reopen. Presence alone would let that stale value
  // wave through a new execution's Done without the current interval's own
  // post-flight ever having actually happened. Require it to be no earlier
  // than the current Started At, and no earlier than the applicable closed
  // event's own Ended At when one was found above.
  if (!completedAt) {
    failures.push('missing_completed_at');
  } else if (taskStartedAt && completedAt.getTime() < taskStartedAt.getTime()) {
    failures.push('stale_completed_at');
  } else if (applicableClosedEvent) {
    const appliedEndedAt = propertyDate_(applicableClosedEvent.properties['Ended At']);
    if (completedAt.getTime() < appliedEndedAt.getTime()) failures.push('stale_completed_at');
  }

  if (!failures.length) {
    // Stamp the applicable event with the Result fingerprint that just
    // validated it, so a *future* reopen can tell whether Result was ever
    // actually refreshed. Idempotent: a matching stamp already present (a
    // routine Done re-verification) costs no extra write. When this DOES
    // perform a write (first-ever validation of this event, or a legacy
    // event with no prior stamp), report a distinct outcome so the caller
    // charges it against the reconciliation write budget like any other
    // write — see isFreeOutcome_.
    const stamped = markResultValidated_(applicableClosedEvent, result);
    return stamped ? 'done_gate_passed:stamped' : 'done_gate_passed';
  }

  // If work is still timed, restore In Progress and deliberately leave the
  // interval open so the normal In Progress → Review transition closes it.
  // Otherwise return to Review to collect missing completion evidence.
  const rollbackStatus = openEvents && openEvents.length
    ? DEFAULTS.START_STATUS
    : DEFAULTS.REVIEW_STATUS;
  updateTaskStatus_(task.id, rollbackStatus);
  return 'done_gate_rejected:' + failures.join('+') + ':rollback=' + rollbackStatus;
}

function resultFingerprint_(resultText) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(resultText || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

// Returns true if it made a Notion write (a new stamp), false if the event
// was already correctly stamped (no write needed). The caller uses this to
// report a distinct outcome for the write-producing case, so it is charged
// against the reconciliation budget like any other write — see
// enforceDoneGate_.
function markResultValidated_(eventPage, result) {
  const fingerprint = resultFingerprint_(result);
  const existingNote = propertyText_(eventPage.properties.Note);
  // Already stamped with this exact fingerprint at some point in this
  // event's history (not just as the most recent stamp) — e.g. Result was
  // edited away and back while the Task stayed Done. No new write needed.
  if (parseNoteMeta_(existingNote).resultFingerprints.indexOf(fingerprint) >= 0) return false;
  const marker = buildNote_({ resultFingerprint: fingerprint });
  notionRequest_('patch', '/v1/pages/' + encodeURIComponent(eventPage.id), {
    properties: {
      Note: { rich_text: [{ type: 'text', text: { content: appendNote_(existingNote, marker, 1800) } }] },
    },
  });
  return true;
}

// Retroactively marks a closed event as the point an execution genuinely
// ended, for a Task that left In Progress with nothing open to close (see
// reconcileAuthoritativeTimeEvents_'s no-open-events branch) — the event's
// own Reason (e.g. 'reassignment') never signals that on its own. Does not
// touch the original Reason: both facts (why it closed, and that this is
// also where its execution ended) are preserved side by side.
//
// `executionId`, when non-empty, also backfills Execution= at the same
// time — but the only call site deliberately always passes '' (see the
// comment there for why: it cannot safely distinguish the one legacy-data
// case backfilling would help from a stale-Started-At case it would
// silently break). Kept as a parameter rather than dropped so a future,
// genuinely safe backfill path (one with enough information to tell the
// two cases apart) has an existing, tested hook to call into.
function stampExecutionBoundary_(eventPage, executionId) {
  const existingNote = propertyText_(eventPage.properties.Note);
  const marker = buildNote_({ boundary: 'left_in_progress', execution: executionId });
  notionRequest_('patch', '/v1/pages/' + encodeURIComponent(eventPage.id), {
    properties: {
      Note: { rich_text: [{ type: 'text', text: { content: appendNote_(existingNote, marker, 1800) } }] },
    },
  });
}

function updateTaskStatus_(taskId, statusName) {
  notionRequest_('patch', '/v1/pages/' + encodeURIComponent(taskId), {
    properties: {
      Status: { [DEFAULTS.STATUS_PROPERTY_TYPE]: { name: statusName } },
    },
  });
}

function createNotionTimeEvent_(taskId, taskTitle, actor, changedBy, snapshotId, when, executionId) {
  const note = buildNote_({
    source: 'notion_reconcile',
    execution: executionId,
    snapshotId: snapshotId,
    changedBy: changedBy,
  });

  return notionRequest_('post', '/v1/pages', {
    parent: {
      type: 'data_source_id',
      data_source_id: timeEventsDataSourceId_(),
    },
    properties: {
      Event: {
        title: [{ type: 'text', text: { content: clip_(actor + '｜' + taskTitle, 300) } }],
      },
      Actor: { select: { name: actor } },
      State: { select: { name: 'Active' } },
      'Started At': { date: { start: when.toISOString() } },
      Task: { relation: [{ id: taskId }] },
      Note: {
        rich_text: [{ type: 'text', text: { content: clip_(note, 1800) } }],
      },
    },
  });
}

function closeNotionTimeEvent_(eventPage, endStatus, changedBy, snapshotId, when, reason) {
  const existingNote = propertyText_(eventPage.properties.Note);
  const closeMeta = buildNote_({
    endStatus: endStatus,
    reason: reason,
    snapshotId: snapshotId,
    changedBy: changedBy,
  });

  notionRequest_('patch', '/v1/pages/' + encodeURIComponent(eventPage.id), {
    properties: {
      'Ended At': { date: { start: when.toISOString() } },
      Note: {
        rich_text: [{ type: 'text', text: { content: appendNote_(existingNote, closeMeta, 1800) } }],
      },
    },
  });
}

function queryNotionTimeEventsForTask_(taskId) {
  const result = paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(timeEventsDataSourceId_()) + '/query',
    {
      page_size: 100,
      filter: { property: 'Task', relation: { contains: taskId } },
      sorts: [{ property: 'Started At', direction: 'descending' }],
    }
  );
  // A single Task accumulating more Time Events than the safety limit is not
  // expected in normal operation. Fail loudly rather than silently
  // reconciling (including a Done gate decision) against a truncated,
  // possibly-incomplete event history.
  if (result.truncated) {
    throw new Error(
      'queryNotionTimeEventsForTask_ hit the pagination safety limit for Task ' +
      taskId + ' — more Time Events exist than were retrieved. Investigate before continuing.'
    );
  }
  return result.results;
}

function syncTaskProjection_(taskId, taskTitle, taskUrl, currentStatus, fallbackChangedBy, fallbackSnapshotId) {
  const events = queryNotionTimeEventsForTask_(taskId);
  events.slice().reverse().forEach(function (eventPage) {
    upsertSheetProjection_(eventPage, taskId, taskTitle, taskUrl, currentStatus, fallbackChangedBy, fallbackSnapshotId);
  });
}

function upsertSheetProjection_(eventPage, taskId, taskTitle, taskUrl, currentStatus, fallbackChangedBy, fallbackSnapshotId) {
  const sheet = sheet_(DEFAULTS.TIME_EVENTS_SHEET);
  const row = findSheetEventRowByEventId_(sheet, eventPage.id) || (sheet.getLastRow() + 1);
  const actor = propertyText_(eventPage.properties.Actor);
  const startedAt = propertyDate_(eventPage.properties['Started At']);
  const endedAt = propertyDate_(eventPage.properties['Ended At']);
  const note = propertyText_(eventPage.properties.Note);
  const meta = parseNoteMeta_(note);
  const endStatus = endedAt ? (meta.endStatus || (currentStatus !== DEFAULTS.START_STATUS ? currentStatus : '')) : '';
  const changedBy = meta.changedBy || fallbackChangedBy || '';
  const sourceSnapshotId = meta.snapshotId || fallbackSnapshotId || '';

  sheet.getRange(row, 1, 1, 13).setValues([[
    eventPage.id,
    taskId,
    taskTitle,
    actor,
    startedAt || '',
    endedAt || '',
    '',
    DEFAULTS.START_STATUS,
    endStatus,
    changedBy,
    taskUrl || ('https://www.notion.so/' + taskId.replace(/-/g, '')),
    sourceSnapshotId,
    new Date(),
  ]]);
  sheet.getRange(row, 7).setFormula('=IF(OR(E' + row + '="",F' + row + '=""),"",24*(F' + row + '-E' + row + '))');
}

function findSheetEventRowByEventId_(sheet, eventId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const finder = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(String(eventId))
    .matchEntireCell(true)
    .findNext();
  return finder ? finder.getRow() : 0;
}

// Removes a Time Event's row from the Sheet projection outright, for an
// event archiveStoryTimeEvent_ just archived rather than closed — see its
// comment and reconcileStoryTask_'s for why a stale row here is not merely
// cosmetic (it keeps feeding the Summary tab's own aggregation). A no-op
// if the event was never projected in the first place.
function purgeSheetProjectionRow_(eventId) {
  const sheet = sheet_(DEFAULTS.TIME_EVENTS_SHEET);
  const row = findSheetEventRowByEventId_(sheet, eventId);
  if (row) sheet.deleteRow(row);
}

function retrieveNotionPage_(pageId) {
  return notionRequest_('get', '/v1/pages/' + encodeURIComponent(pageId));
}

function notionRequest_(method, path, body) {
  const token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('NOTION_TOKEN is not configured in Apps Script Script Properties.');

  const options = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': DEFAULTS.NOTION_VERSION,
    },
    muteHttpExceptions: true,
  };

  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch('https://api.notion.com' + path, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Notion API failed: ' + method.toUpperCase() + ' ' + path + ' HTTP ' + code + ' ' + text);
  }
  return text ? JSON.parse(text) : {};
}

// Generous safety valve on paginated Notion data-source queries. High enough
// that hitting it means something structurally unusual is going on (a huge
// workspace, or a runaway result set) rather than normal operation — the
// prior 5-page (500-row) cap was low enough to silently truncate a single
// ordinary incremental poll window during a bulk edit. If this limit is hit,
// `truncated: true` is returned so a caller (pollTaskChanges) never mistakes
// a partial result for the complete set and advances its cursor past
// unretrieved data.
const QUERY_PAGE_SAFETY_LIMIT = 50;

function paginateNotionQuery_(path, baseBody, deadlineMs, extendedDeadlineMs, hasProgress) {
  let cursor = null;
  let pageCount = 0;
  const results = [];
  let truncated = false;

  do {
    // An optional wall-clock deadline (e.g. from backfillResultFingerprints_,
    // which needs to reserve time to actually process and checkpoint
    // whatever gets retrieved, not just spend its whole run fetching pages)
    // stops pagination early rather than letting it run unbounded up to
    // QUERY_PAGE_SAFETY_LIMIT — treated exactly like hitting that page-count
    // limit: truncated, resumable via on_or_after next call. Never cuts off
    // before the very first page: a caller needs at least one page's worth
    // of results to make any progress at all this call.
    if (typeof deadlineMs === 'number' && pageCount > 0 && Date.now() >= deadlineMs) {
      // A resumed call whose persisted skip (e.g. BACKFILL_RESUME_TIE_
      // OFFSET, for a tied cohort spanning more than one call) already
      // covers everything fetchable before `deadlineMs` would stop here
      // with zero net progress — and since the resumed query is inclusive
      // (on_or_after) and always restarts from its own beginning, the next
      // call faces the identical situation: an exact repeat, forever,
      // since nothing changes between calls on its own. `extendedDeadlineMs`
      // + `hasProgress` let a caller in exactly that situation keep this
      // SAME continuous fetch going (not restart a second one, which would
      // only waste the time already spent and could never net out ahead)
      // until real progress exists or the caller's own outer wall-clock
      // bound is reached — never past it, so this still cannot blow the
      // run's total budget.
      const keepGoing = typeof extendedDeadlineMs === 'number'
        && typeof hasProgress === 'function'
        && !hasProgress(results)
        && Date.now() < extendedDeadlineMs;
      if (!keepGoing) {
        truncated = true;
        break;
      }
    }
    const body = Object.assign({}, baseBody);
    if (cursor) body.start_cursor = cursor;

    const response = notionRequest_('post', path, body);

    (response.results || []).forEach(function (item) {
      if (item && item.object === 'page') results.push(item);
    });

    cursor = response.has_more ? response.next_cursor : null;
    pageCount++;
    if (cursor && pageCount >= QUERY_PAGE_SAFETY_LIMIT) {
      truncated = true;
      cursor = null;
    }
  } while (cursor);

  return { results: results, truncated: truncated };
}

function isConfiguredTask_(page) {
  const configured = normalizeId_(tasksDataSourceId_());
  const actual = normalizeId_(page && page.parent && page.parent.data_source_id);
  return Boolean(actual && actual === configured);
}

function tasksDataSourceId_() {
  return PropertiesService.getScriptProperties().getProperty('TASKS_DATA_SOURCE_ID') || DEFAULTS.TASKS_DATA_SOURCE_ID;
}

function timeEventsDataSourceId_() {
  return PropertiesService.getScriptProperties().getProperty('TIME_EVENTS_DATA_SOURCE_ID') || DEFAULTS.TIME_EVENTS_DATA_SOURCE_ID;
}

function authoritativeEditTime_(task) {
  return parseTimestamp_(task && task.last_edited_time);
}

function authoritativeSnapshotId_(task, status, assignedAgent, type) {
  const seed = [
    normalizeId_(task && task.id),
    String(task && task.last_edited_time || ''),
    String(status || ''),
    String(assignedAgent || ''),
    // Type now controls reconciliation behavior (Type = Story is excluded
    // from event generation entirely — see reconcileTaskPage_). Without it
    // here, a page edited to Type = Story in the same last_edited_time
    // minute as its last-processed snapshot (Status/assignee unchanged)
    // would hash identically to that prior snapshot and be skipped as
    // `duplicate:` before reconcileStoryTask_ ever ran — leaving a stray
    // open event uncleaned until some unrelated later edit changed the
    // hash.
    String(type || ''),
  ].join('|');
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    seed,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function eventStartedAt_(eventPage) {
  return propertyDate_(eventPage && eventPage.properties && eventPage.properties['Started At']) || new Date(0);
}

// Latest Started At / Ended At timestamp across a list of Time Event pages,
// or null if the list is empty or carries no dates at all.
function latestEventTimestamp_(events) {
  let latest = null;
  (events || []).forEach(function (eventPage) {
    [
      propertyDate_(eventPage && eventPage.properties && eventPage.properties['Started At']),
      propertyDate_(eventPage && eventPage.properties && eventPage.properties['Ended At']),
    ].forEach(function (ts) {
      if (ts && (!latest || ts.getTime() > latest.getTime())) latest = ts;
    });
  });
  return latest;
}

function propertyDate_(property) {
  if (!property || property.type !== 'date' || !property.date || !property.date.start) return null;
  return parseTimestamp_(property.date.start);
}

function propertyText_(property) {
  if (!property) return '';
  if (property.type === 'select') return property.select ? property.select.name : '';
  if (property.type === 'status') return property.status ? property.status.name : '';
  if (property.type === 'title') return (property.title || []).map(function (x) { return x.plain_text || ''; }).join('');
  if (property.type === 'rich_text') return (property.rich_text || []).map(function (x) { return x.plain_text || ''; }).join('');
  return '';
}

function mapActor_(assignedAgent) {
  if (assignedAgent === 'ChatGPT') return 'Chris';
  if (assignedAgent === 'Codex') return 'Codex';
  if (assignedAgent === 'Human') return 'Human';
  if (/^Claude\s/.test(assignedAgent || '')) return 'Claude';
  return '';
}

function buildNote_(fields) {
  const parts = [];
  if (fields.source) parts.push('Source=' + fields.source);
  if (fields.endStatus) parts.push('End Status=' + fields.endStatus);
  if (fields.reason) parts.push('Reason=' + fields.reason);
  if (fields.boundary) parts.push('Boundary=' + fields.boundary);
  if (fields.execution) parts.push('Execution=' + fields.execution);
  if (fields.snapshotId) parts.push('Snapshot=' + fields.snapshotId);
  if (fields.changedBy) parts.push('Changed By=' + fields.changedBy);
  if (fields.resultFingerprint) parts.push('Result Fingerprint=' + fields.resultFingerprint);
  return parts.join(' | ');
}

function parseNoteMeta_(note) {
  return {
    endStatus: noteField_(note, 'End Status'),
    reason: noteField_(note, 'Reason'),
    // Retroactively stamped onto the most-recently-closed event when the
    // Task leaves In Progress with nothing open to close (see
    // reconcileAuthoritativeTimeEvents_) — marks that an execution actually
    // ended there even though the event's own Reason (e.g. 'reassignment')
    // never does. See enforceDoneGate_'s execution-membership check.
    boundary: noteField_(note, 'Boundary'),
    // Stamped once, at creation — the execution this event belongs to,
    // identified directly rather than inferred from timestamp ties or
    // Reason markers. A reassignment replacement inherits the OUTGOING
    // event's own Execution= marker unchanged (reassigning never starts a
    // new execution); the first-ever event of a genuinely new execution
    // gets the interval's own computed start (see reconcileAuthoritative
    // TimeEvents_'s opening logic) rather than the Task's raw Started At
    // directly — that already correctly falls back to the observed edit
    // time instead of a stale, never-refreshed Started At, so a governance
    // violation still gets a fresh, distinguishing identity instead of
    // silently reusing the old one. See enforceDoneGate_'s execution-
    // membership check, which prefers this direct equality test over the
    // legacy Reason/Boundary/tie heuristic whenever it's present (absent
    // only on data from before this field existed).
    execution: noteField_(note, 'Execution'),
    snapshotId: noteField_(note, 'Snapshot'),
    changedBy: noteField_(note, 'Changed By'),
    // The *last* recorded value only — fine for every other field (only the
    // newest close/reassignment metadata ever matters), but NOT enough on
    // its own for Result Fingerprint: see resultFingerprints below.
    resultFingerprint: noteField_(note, 'Result Fingerprint'),
    // Every fingerprint ever stamped onto this event, oldest first. A single
    // event can validate more than one distinct Result value over its
    // lifetime — Done is always re-verified, and Result can be edited more
    // than once while the Task remains Done, each edit adding its own
    // 'Result Fingerprint=' segment rather than replacing the last. A later
    // reopen's stale-Result check must catch reuse against ANY value this
    // event once validated, not just the most recent — otherwise editing
    // Result back to an earlier, already-validated value would leave a
    // fingerprint match that noteField_'s last-occurrence-only view can't
    // see, since it's no longer the last "Result Fingerprint=" segment.
    resultFingerprints: noteFieldAll_(note, 'Result Fingerprint'),
  };
}

function noteField_(note, key) {
  const parts = String(note || '').split('|');
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].trim();
    if (part.indexOf(key + '=') === 0) return part.substring(key.length + 1).trim();
  }
  return '';
}

// Like noteField_, but returns every occurrence of `key=`, oldest first,
// instead of only the last — see resultFingerprints above.
function noteFieldAll_(note, key) {
  const values = [];
  String(note || '').split('|').forEach(function (part) {
    const trimmed = part.trim();
    if (trimmed.indexOf(key + '=') === 0) values.push(trimmed.substring(key.length + 1).trim());
  });
  return values;
}

function editorLabel_(user) {
  if (!user || !user.id) return '';
  return (user.object || user.type || 'user') + ':' + user.id;
}

function hasProcessedSnapshot_(snapshotId) {
  if (!snapshotId) return false;
  const sheet = ensureSyncLogSheet_();
  if (sheet.getLastRow() < 2) return false;
  return Boolean(sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(snapshotId).matchEntireCell(true).findNext());
}

// `source` is what triggered this reconciliation (e.g. 'notion_poll'), not
// the Notion page's own Type property — kept as a separate, later
// `taskType` argument (optional; the Sync Log's 7th column) to avoid that
// exact confusion. eventWasTouchedDuringTaskExecution_ depends on this
// column only ever being populated with a genuine, current Type observation.
function logSnapshot_(id, source, taskId, status, receivedAt, outcome, taskType) {
  const sheet = ensureSyncLogSheet_();
  sheet.appendRow([id || '', source || '', taskId || '', status || '', receivedAt || new Date(), outcome || '', taskType || '']);
}

// True if this Task page's MOST RECENT Sync Log observation as Type=Story
// (see reconcileStoryTask_) also recorded Status = In Progress at that same
// poll — i.e. the page was still actively running as a Story right up to
// (or past) the last time this script saw it that way, so any Started At
// still on file almost certainly reflects the Story's own execution start,
// never refreshed since. Called from reconcileAuthoritativeTimeEvents_'s
// "first-ever event" branch (see its own comment for why allEvents is
// empty either way) to decide whether to distrust the Task's Started At —
// Codex-reported gap on BUG-ADP-TTE-01's own fix: a Story carries no Time
// Event history of its own once reclassified as an executable Task
// (reconcileStoryTask_ archives every event a Story ever accumulates, and
// an archived page never resurfaces in a query), so that branch would
// otherwise unconditionally trust the Task's own Started At the moment its
// first event opens.
//
// Narrower than simply "was this page ever Type=Story" — Codex-reported
// gap on an earlier version of this same fix: a page reclassified while
// idle (`Ready`/`Backlog`) and only later beginning its actual first
// execution has a Started At that was freshly (re)recorded for that
// execution, per the same governance every ordinary Task's first open
// already relies on — it has nothing to do with old Story history, and
// distrusting it anyway would silently lose whatever work happened before
// the next observed edit. Only a page still In Progress at its *last*
// Story observation carries the real risk this function exists to catch:
// nothing about remaining continuously In Progress across a Type change
// would ever prompt Started At to be refreshed.
//
// Looks at this Task's single MOST RECENT Sync Log row overall — Story-
// marked or not — rather than the most recent Story-marked row specifically
// — Codex-reported gap on an earlier version of this same fix: taking the
// last Story-marked row's own Status ignores any LATER, non-Story row in
// between, e.g. a Story last seen In Progress that gets reclassified to
// Task and left idle (`Status = Ready`) in the same edit, reconciled once
// while idle, and only later actually begins In Progress — the old logic
// would still find that stale In-Progress Story row as the "last" Story
// observation and wrongly distrust the later poll's genuinely fresh
// Started At, since no NEWER Story-marked row ever gets written to clear
// it. Taking the single most recent row overall self-corrects: once any
// later poll observes the page through the ordinary Task path (any Status,
// even idle), that row becomes the most recent one and the carryover is
// gone — only a page whose most recent observation, period, is itself a
// Story-marked one with Status = In Progress still carries the risk. The
// Sync Log rows are scanned in their natural append-only chronological
// order, so the last matching row encountered is, by construction, the
// most recent one.
//
// Scans the Sync Log's full, unboundedly-growing history on every call —
// callers must gate this behind allEvents.length === 0 (see the one call
// site), never call it unconditionally on every ordinary Task open.
function storyConversionHappenedWhileInProgress_(taskId) {
  if (!taskId) return false;
  const sheet = ensureSyncLogSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  let mostRecentRow = null;
  rows.forEach(function (row) {
    if (row[2] !== taskId) return;
    mostRecentRow = row;
  });
  if (!mostRecentRow) return false;
  const outcome = String(mostRecentRow[5] || '');
  const wasStoryObservation = outcome === 'story_excluded' || outcome.indexOf('archived_story_event:') === 0;
  return wasStoryObservation && mostRecentRow[3] === DEFAULTS.START_STATUS;
}

// True if THIS SPECIFIC event's own most recent `Snapshot=` marker (see
// parseNoteMeta_ — stamped by whichever poll most recently actually wrote
// to this event's Note: its creation, or a later close/re-close) maps to
// a Sync Log row with an explicit, POST-UPGRADE, non-Story `Type`
// recorded. Used by reconcileStoryTask_ to tell genuine Task-era Time
// Events (created or touched while this exact page really was a Task,
// now attached to a page reclassified TO Story) apart from pre-fix
// legacy stray data.
//
// Deliberately PER EVENT, not per Task page — Codex-reported gap on an
// earlier, page-level version of this same fix (then named
// taskWasEverReconciledAsTask_): a page can be observed as an idle Task
// (Type = Task, e.g. Status = Ready) WITHOUT that observation ever
// touching a specific pre-existing event's own Note at all — nothing open
// to close, nothing new to open, so nothing about that poll gets written
// to the event itself. Proving the PAGE was once seen as Task proved
// nothing about whether THIS event specifically was created or touched
// during that window; the page-level version would preserve a pre-upgrade
// legacy Story event forever, the instant its page was ever glimpsed as
// Task even in passing, defeating the whole exclusion.
//
// Also deliberately NOT inferred from the absence of a Story-path Outcome
// marker alone — Codex-reported gap in an even earlier version: on an
// EXISTING LIVE DEPLOYMENT being upgraded to this whole BUG-ADP-TTE-01
// revision, the OLD reconciler had no Type awareness at all, so it ran
// EVERY page — including genuine Stories — through
// reconcileAuthoritativeTimeEvents_ and logged perfectly ordinary Task-path
// Outcomes (`opened:`, `closed:`, `no_change:`, ...) for them. Those old
// rows are exactly the ones proving nothing: they predate Type-based
// routing entirely, so "not a Story-path Outcome" was never actually
// evidence the page wasn't a Story — it only meant Type wasn't checked
// yet. logSnapshot_'s Type column (added by this fix) is only ever
// populated by THIS revision's own reconcileTaskPage_, so its mere
// presence already proves the row is post-upgrade — a pre-upgrade row (or
// one appended by the old six-argument logSnapshot_) reads back as `''`
// for this column exactly like any other cell beyond what was written,
// correctly failing the check below rather than being misread as `Story`
// or anything else specific.
function eventWasTouchedDuringTaskExecution_(eventPage) {
  const snapshotId = parseNoteMeta_(propertyText_(eventPage.properties.Note)).snapshotId;
  if (!snapshotId) return false;
  const sheet = ensureSyncLogSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const match = rows.find(function (row) {
    return row[0] === snapshotId;
  });
  if (!match) return false;
  const recordedType = String(match[6] || '');
  return Boolean(recordedType) && recordedType !== 'Story';
}

function ensureProjectionHeaders_() {
  // sheet_() throws when the tab is missing — correct for callers during
  // normal reconciliation, where its absence means setup was never run. But
  // this function IS setup's own initialization step: on a brand-new
  // spreadsheet with no "Time Events" tab yet, that same strictness would
  // make setup() itself throw before it ever gets the chance to create one.
  // Mirror ensureSyncLogSheet_'s create-if-absent pattern instead.
  const ss = spreadsheet_();
  const sheet = ss.getSheetByName(DEFAULTS.TIME_EVENTS_SHEET) || ss.insertSheet(DEFAULTS.TIME_EVENTS_SHEET);
  const headers = [
    'Event ID', 'Task ID', 'Task Title', 'Actor', 'Started At', 'Ended At',
    'Duration (h)', 'Start Status', 'End Status', 'Changed By', 'Notion URL',
    'Source Snapshot ID', 'Recorded At'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function ensureSyncLogSheet_() {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(DEFAULTS.SYNC_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DEFAULTS.SYNC_LOG_SHEET);
    sheet.hideSheet();
  }
  sheet.getRange(1, 1, 1, 7).setValues([[
    'Snapshot ID', 'Source', 'Task ID', 'Status', 'Reconciled At', 'Outcome', 'Type'
  ]]);
  return sheet;
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setup() first.');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name);
  return sheet;
}

function normalizeUuid_(value) {
  const raw = String(value || '').trim();
  if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(raw)) return '';
  const hex = raw.replace(/-/g, '').toLowerCase();
  return [
    hex.substring(0, 8), hex.substring(8, 12), hex.substring(12, 16),
    hex.substring(16, 20), hex.substring(20, 32)
  ].join('-');
}

function parseTimestamp_(value) {
  const d = value ? new Date(value) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

function normalizeId_(value) {
  return String(value || '').replace(/-/g, '').toLowerCase();
}

function clip_(value, maxLength) {
  value = String(value || '');
  return value.length <= maxLength ? value : value.substring(0, maxLength);
}

// Appends a freshly built structured `marker` (Reason=/Result Fingerprint=/
// etc., from buildNote_) onto `existingNote`, keeping the combined text
// within maxLength. Unlike clipping the combined string from the end, this
// never risks truncating the marker being written *right now*: if the note
// would overflow, whole ' | '-delimited segments of existingNote are dropped
// to make room instead. Which ones: oldest non-fingerprint segments first —
// parseNoteMeta_/noteField_ already prefer the last occurrence of a key for
// Reason=/Snapshot=/Changed By=/End Status=, so only the newest of those
// ever matters and losing old ones is harmless — and only once none of
// those remain does it fall back to dropping the oldest 'Result
// Fingerprint=' segment(s). Stale-Result detection (enforceDoneGate_) needs
// EVERY fingerprint an event ever recorded to survive as long as possible,
// not just the newest, so those are the last thing evicted, not the first.
// Silently corrupting the marker just written (e.g. truncating mid-hash, or
// cutting a rollback Reason mid-word) is never acceptable either way: it
// would defeat the very check the marker exists for.
function appendNote_(existingNote, marker, maxLength) {
  const clippedMarker = clip_(marker, maxLength);
  if (!existingNote) return clippedMarker;
  const separator = ' | ';
  const isFingerprintSegment = function (segment) {
    return segment.trim().indexOf('Result Fingerprint=') === 0;
  };
  // Execution=/Boundary= identify which execution an event belongs to and
  // whether it marks a genuine execution boundary — enforceDoneGate_'s
  // current-execution classification (and thus taskStartedAtTrusted) reads
  // them directly. Losing one is a materially worse failure than losing one
  // old Result Fingerprint=: a fingerprint only narrows the already-bounded
  // stale-Result detection window (see README "Known limitations"), while
  // losing Execution=/Boundary= can flip an event's own current/prior
  // classification outright. Protected even more than fingerprints:
  // evicted only once every fingerprint segment is already gone.
  const isExecutionOrBoundarySegment = function (segment) {
    const trimmed = segment.trim();
    return trimmed.indexOf('Execution=') === 0 || trimmed.indexOf('Boundary=') === 0;
  };
  const segments = existingNote.split(separator);
  let combined = segments.concat([clippedMarker]).join(separator);
  while (segments.length && combined.length > maxLength) {
    let dropIndex = segments.findIndex(function (segment) {
      return !isFingerprintSegment(segment) && !isExecutionOrBoundarySegment(segment);
    });
    if (dropIndex < 0) dropIndex = segments.findIndex(isFingerprintSegment);
    if (dropIndex < 0) dropIndex = 0;
    segments.splice(dropIndex, 1);
    combined = segments.length ? segments.concat([clippedMarker]).join(separator) : clippedMarker;
  }
  return combined;
}

// A poll that is still running keeps the lock; the next trigger tick simply
// steps aside rather than queueing up behind it. Skipping is safe because the
// cursor is only advanced by a run that completes, so the skipped window is
// re-read by the following tick.
function withPollLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { skipped: 'poll_already_running' };
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
