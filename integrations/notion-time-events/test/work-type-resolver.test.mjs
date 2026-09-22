// ADP-051-B7: regression tests for the assembled Work Type resolver —
// docs/review-fix-state-model.md §3 (fresh classification) + §6 (churn
// inheritance, via the already-tested ADP-051-B6 helpers) + §4 (evidence
// priority/tie resolution, via the already-tested ADP-051-B4 helpers).
//
// This is the first Task wiring resolveWorkType_/resolveSyncLogCandidate_/
// resolveNewTimeEventWorkTypeSafely_ together and into the live poll path
// (see test/work-type-wiring.test.mjs for the end-to-end
// reconcileAuthoritativeTimeEvents_/pollTaskChanges wiring tests — this
// file tests the resolver functions directly, in isolation, the same way
// test/boundary-cutoff-resolver.test.mjs, test/churn-inheritance-resolver.test.mjs
// and test/sync-log-projection.test.mjs already test ADP-051-B4/B5/B6).
//
// Every test below is named after the failure-matrix row it regression-
// tests, from docs/review-fix-state-model.md §7 (Notion ADP-051-B7's
// in-scope subset — Review Source / §5-only rows are out of scope, per
// ADP-051-C).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

function dateProp(iso) {
  return iso ? { type: 'date', date: { start: iso } } : { type: 'date', date: null };
}

function textProp(value) {
  return { type: 'rich_text', rich_text: value ? [{ plain_text: value }] : [] };
}

// Joins raw `Key=Value` segments verbatim, in the order given — allows
// constructing exactly what a real close followed by a later
// stampExecutionBoundary_ retroactive stamp would leave behind
// (last-occurrence-wins, per noteField_/parseNoteMeta_ — a later `Write=`
// segment is what a reader gets back, exactly like a real retroactive stamp
// overwriting the original close's `Write=`).
function note(...segments) {
  return segments.join(' | ');
}

function eventPage(id, { endedAt, note: noteText = '' } = {}) {
  return {
    id,
    properties: {
      'Ended At': dateProp(endedAt),
      Note: textProp(noteText),
    },
  };
}

function harness() {
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-notion-token', SPREADSHEET_ID: 'test-sheet' },
    fetch() {
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    },
  });
}

const TASK_ID = 'work-type-resolver-task';

// Populates the Sync Log sheet via the real logSnapshot_ write path (same
// pattern as test/sync-log-projection.test.mjs's own `logRow` helper), so
// resolveSyncLogCandidate_ reads through the real readSyncLogRowsForTask_/
// loadSyncLogProjection_ machinery rather than a hand-built rows array.
function logRow(sandbox, { taskId = TASK_ID, status, receivedAt, outcome = '', type = 'Task', snapshotId } = {}) {
  sandbox.logSnapshot_(snapshotId || ('snap-' + receivedAt + '-' + status), 'notion_poll', taskId, status, new Date(receivedAt), outcome, type);
}

// ---------------------------------------------------------------------------
// resolveSyncLogCandidate_ (docs/review-fix-state-model.md §3 step 2)
// ---------------------------------------------------------------------------

test('resolveSyncLogCandidate_: no rows at all returns null', () => {
  const { sandbox } = harness();
  const result = sandbox.resolveSyncLogCandidate_(TASK_ID, [], null, null);
  assert.equal(result, null);
});

test('failure #8: an unmapped/empty-actor In Progress row observed before a mapped actor is assigned is skipped explicitly, not treated as "the previous row"', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:00:00.000Z' }); // unmapped-actor spell, opens no Time Event
  const result = sandbox.resolveSyncLogCandidate_(TASK_ID, [], null, null);
  assert.equal(result.status, 'Review');
  assert.equal(result.timestamp.toISOString(), '2026-08-01T08:00:00.000Z');
});

test('failure #15: Review -> In Progress -> Review -> In Progress must not fold the two Review periods into one', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z' }); // first Review period
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:00:00.000Z' });
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T10:00:00.000Z' }); // second, distinct Review period
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T11:00:00.000Z' });
  const result = sandbox.resolveSyncLogCandidate_(TASK_ID, [], null, null);
  assert.equal(result.status, 'Review');
  assert.equal(
    result.timestamp.toISOString(), '2026-08-01T10:00:00.000Z',
    'expected the SECOND Review period\'s own start, not the first (folded) one'
  );
});

test('failure #45: a Type=Story Review row is never eligible, and is a hard cutoff for the scan — a Task\'s first executable interval must not read it as Review Fix', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z', type: 'Story' });
  const result = sandbox.resolveSyncLogCandidate_(TASK_ID, [], null, null);
  assert.equal(result, null, 'expected no eligible Sync Log candidate at all, not the Story-era Review row');
});

test('failure #48: Task,Review -> Story -> Task,In Progress must not cross the Story cutoff even by continuing past it to the older pre-Story Review row', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T07:00:00.000Z', type: 'Task' }); // pre-Story, older Review
  logRow(sandbox, { status: 'Ready', receivedAt: '2026-08-01T08:00:00.000Z', type: 'Story' }); // Story spell (the cutoff)
  const result = sandbox.resolveSyncLogCandidate_(TASK_ID, [], null, null);
  assert.equal(result, null, 'expected the scan to stop at the Story cutoff, never reaching the older pre-Story Review row');
});

test('failure #51: an ambiguous_provenance_restart close (Time-Event side) is a hard cutoff for this scan too, not only for §6\'s churn-inheritance cutoff', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T07:00:00.000Z' }); // older, pre-restart Review row
  const restartEvent = eventPage('evt-restart', {
    endedAt: '2026-08-01T08:00:00.000Z',
    note: note('Reason=ambiguous_provenance_restart'),
  });
  const result = sandbox.resolveSyncLogCandidate_(TASK_ID, [restartEvent], null, null);
  assert.equal(result, null, 'expected the restart to block reaching the older pre-restart Review row');
});

test('failure #46: a done_gate_rejected:...:rollback=Review row is read by its rollback status, never the raw Status=Done column', () => {
  const { sandbox } = harness();
  logRow(sandbox, {
    status: 'Done', receivedAt: '2026-08-01T08:00:00.000Z',
    outcome: 'done_gate_rejected:missing_result:rollback=Review',
  });
  const result = sandbox.resolveSyncLogCandidate_(TASK_ID, [], null, null);
  assert.equal(result.status, 'Review');
});

test('failure #35 (Sync-Log-side half): the genuine close\'s own paired logSnapshot_ crashes (no row at t1); a later edit while still Review at t2 DOES get logged — step 2 must return t2 as the run\'s earliest AVAILABLE row, not null and not some other value', () => {
  const { sandbox } = harness();
  // t1 (matching the genuine Time-Event close) is deliberately never logged
  // here, simulating the crash — only t2 exists.
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' }); // t2
  const result = sandbox.resolveSyncLogCandidate_(TASK_ID, [], null, null);
  assert.equal(result.status, 'Review');
  assert.equal(result.timestamp.toISOString(), '2026-08-01T09:00:00.000Z');
});

test('resolveSyncLogCandidate_ (Codex round 1): no eligible row found WITHIN a truncated window returns { truncated: true }, never null — the omission is not evidence of anything', () => {
  const { sandbox, spreadsheet } = harness();
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  sandbox.ensureSyncLogSheet_();
  const SYNC_LOG_PROJECTION_WINDOW_ROWS = 5000; // mirrors Code.gs's own constant
  for (let i = 0; i < SYNC_LOG_PROJECTION_WINDOW_ROWS + 100; i++) {
    // This Task's own history, if any, sits entirely before this window —
    // every row visible to the bounded tail read belongs to another Task.
    syncLogSheet.rows.push(['snap-' + i, 'test', 'unrelated-task', 'Review', '2026-01-01T00:00:00.000Z', '', 'Task', String(1000 + i)]);
  }
  const result = sandbox.resolveSyncLogCandidate_(TASK_ID, [], null, null);
  assert.notEqual(result, null);
  assert.equal(result.truncated, true);
});

test('resolveSyncLogCandidate_: no eligible row AND the window is NOT truncated still returns plain null (non-regression)', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z', type: 'Story' }); // ineligible, but the whole log fits in the window
  const result = sandbox.resolveSyncLogCandidate_(TASK_ID, [], null, null);
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// resolveWorkType_ — §3 fresh classification (steps 1/3/4/5)
// ---------------------------------------------------------------------------

test('resolveWorkType_: no boundary and no Sync Log candidate at all defaults to Initial Work', () => {
  const { sandbox } = harness();
  const result = sandbox.resolveWorkType_({ taskId: 'never-seen-task', allEvents: [] });
  assert.equal(result.unresolved, false);
  assert.equal(result.workType, 'Initial Work');
});

test('resolveWorkType_ (Codex round 1): no boundary and a TRUNCATED Sync Log window with no candidate must surface unresolved, never default to Initial Work', () => {
  const { sandbox, spreadsheet } = harness();
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  sandbox.ensureSyncLogSheet_();
  const SYNC_LOG_PROJECTION_WINDOW_ROWS = 5000;
  for (let i = 0; i < SYNC_LOG_PROJECTION_WINDOW_ROWS + 100; i++) {
    syncLogSheet.rows.push(['snap-' + i, 'test', 'unrelated-task', 'Review', '2026-01-01T00:00:00.000Z', '', 'Task', String(1000 + i)]);
  }
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [] });
  assert.equal(result.unresolved, true, 'expected an explicit unresolved result — the truncated window cannot rule out hidden history ending in Review');
  assert.notEqual(result.workType, 'Initial Work');
});

test('resolveWorkType_ (Codex round 1, failure #5 via truncation): a genuine Review boundary with a TRUNCATED, candidate-less Sync Log window must not fall back to the boundary\'s own stale status — hidden Backlog/Ready history could have followed it', () => {
  const { sandbox, spreadsheet } = harness();
  const genuineOldReviewClose = eventPage('evt-trunc', {
    endedAt: '2026-08-01T05:00:00.000Z',
    note: note('End Status=Review', 'Reason=left_in_progress'),
  });
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  sandbox.ensureSyncLogSheet_();
  const SYNC_LOG_PROJECTION_WINDOW_ROWS = 5000;
  for (let i = 0; i < SYNC_LOG_PROJECTION_WINDOW_ROWS + 100; i++) {
    // A real Backlog/Ready row for this Task, logged after the genuine
    // close, could exist here — it is simply outside the visible window.
    syncLogSheet.rows.push(['snap-' + i, 'test', 'unrelated-task', 'Review', '2026-01-01T00:00:00.000Z', '', 'Task', String(1000 + i)]);
  }
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [genuineOldReviewClose] });
  assert.equal(result.unresolved, true, 'expected unresolved, never a confident Review Fix read off the stale genuine boundary alone');
  assert.notEqual(result.workType, 'Review Fix');
});

test('failure #2: assignee cleared mid-In Progress, boundary stamped retroactively with no open events, and no Sync Log row at all — must surface unresolved, never read the stale End Status=In Progress as Initial Work', () => {
  const { sandbox } = harness();
  // A reassignment close (End Status=In Progress is stale — that's the
  // ordinary status at the moment the assignee was cleared, not the
  // Task's real later destination), later retroactively tagged
  // Boundary=left_in_progress by stampExecutionBoundary_ with its own
  // fresh Write=.
  const retroactive = eventPage('evt-2', {
    endedAt: '2026-08-01T05:00:00.000Z', // stale — the original reassignment's own timestamp
    note: note('End Status=In Progress', 'Reason=reassignment', 'Write=100', 'Boundary=left_in_progress', 'Write=9999'),
  });
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [retroactive] });
  assert.equal(result.unresolved, true, 'expected an explicit unresolved result, never a silent Initial Work default');
  assert.notEqual(result.workType, 'Initial Work');
});

test('failure #5: Review -> Backlog/Ready -> (time) -> In Progress must consult the Sync Log, not reuse a stale Time-Event-side Review close', () => {
  const { sandbox } = harness();
  const genuineOldReviewClose = eventPage('evt-5', {
    endedAt: '2026-08-01T05:00:00.000Z',
    note: note('End Status=Review', 'Reason=left_in_progress'),
  });
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T06:00:00.000Z' }); // later than the stale Review close
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [genuineOldReviewClose] });
  assert.equal(result.unresolved, false);
  assert.equal(result.workType, 'Initial Work', 'expected the later Backlog Sync Log row to win, not the stale Review close');
});

test('failure #13 (§3.5 half): Work Type resolves via the Sync Log candidate — the winning timestamp is exposed on `resolvedAt` for a future caller to reuse, not re-derived', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' });
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [] });
  assert.equal(result.unresolved, false);
  assert.equal(result.workType, 'Review Fix');
  assert.ok(result.resolvedAt, 'expected resolvedAt to be populated');
  assert.equal(result.resolvedAt.timestamp.toISOString(), '2026-08-01T09:00:00.000Z');
});

test('failure #18: execution closes to Review but crashes before logSnapshot_; a stale, unrelated, OLDER Sync Log row must not win unconditionally', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T04:00:00.000Z' }); // stale, unrelated, older
  const genuineClose = eventPage('evt-18', {
    endedAt: '2026-08-01T09:00:00.000Z', // later, real transition
    note: note('End Status=Review', 'Reason=left_in_progress'),
  });
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [genuineClose] });
  assert.equal(result.unresolved, false);
  assert.equal(result.workType, 'Review Fix', 'expected the later genuine close to win, not the stale Sync Log row');
});

test('failure #19: same as #18, but the two candidates tie at the same Notion minute with no Write= on either side — must not always favor the (stale) Sync Log row; a genuine tie between different statuses is unresolved, not defaulted', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T09:00:00.000Z' }); // same minute, no Write=
  const genuineClose = eventPage('evt-19', {
    endedAt: '2026-08-01T09:00:30.000Z', // same Notion minute, no Write=
    note: note('End Status=Review', 'Reason=left_in_progress'),
  });
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [genuineClose] });
  assert.equal(result.unresolved, true, 'expected an unresolvable tie, not an unconditional Sync-Log-row win');
});

test('failure #19 (tie-break variant): the identical same-minute tie resolves correctly once Write= is present on both sides — proving a real Write= tie-break, not a hardcoded default, is what settles it', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T09:00:00.000Z' });
  const genuineClose = eventPage('evt-19b', {
    endedAt: '2026-08-01T09:00:30.000Z',
    // Larger than any real Date.now() logSnapshot_ will stamp on the row
    // above, so this Write= is genuinely, unambiguously the later write.
    note: note('End Status=Review', 'Reason=left_in_progress', 'Write=9999999999999'),
  });
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [genuineClose] });
  assert.equal(result.unresolved, false);
  assert.equal(result.workType, 'Review Fix', 'expected the genuine close\'s later Write= to break the Notion-minute tie');
});

test('failure #22: a genuinely later, correct Sync Log row logged in the same minute as an interrupted close (whose own Snapshot/Write never lands) must win — "never logged first ⇒ older" is not a rule this resolver applies', () => {
  const { sandbox } = harness();
  const interruptedClose = eventPage('evt-22', {
    endedAt: '2026-08-01T09:00:00.000Z',
    note: note('End Status=Review', 'Reason=left_in_progress', 'Write=100'),
  });
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T09:00:30.000Z' }); // same minute, wrote LATER
  // Directly stamp a Write= onto this row by re-reading and rewriting via
  // the Sync Log sheet is unnecessary here — logSnapshot_ already stamps
  // its own Date.now() as column 8, which is guaranteed to be far larger
  // than the hand-authored Write=100 above (real wall-clock ms).
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [interruptedClose] });
  assert.equal(result.unresolved, false);
  assert.equal(result.workType, 'Initial Work', 'expected the genuinely-later Sync Log row (by Write=) to win');
});

test('failure #24: symmetric Write= tie-break — whichever of {close, log row} genuinely wrote later wins, in both directions', () => {
  const { sandbox } = harness();

  // Direction A: the close wrote later.
  {
    const { sandbox: s } = harness();
    logRow(s, { status: 'Backlog', receivedAt: '2026-08-01T09:00:00.000Z' });
    const laterWriteClose = eventPage('evt-24a', {
      endedAt: '2026-08-01T09:00:00.000Z',
      // Larger than any real Date.now() logSnapshot_ will ever stamp on
      // the Sync Log row below (13-digit epoch ms, ~year 2026), so this
      // Write= is genuinely later.
      note: note('End Status=Review', 'Reason=left_in_progress', 'Write=9999999999999'),
    });
    const result = s.resolveWorkType_({ taskId: TASK_ID, allEvents: [laterWriteClose] });
    assert.equal(result.workType, 'Review Fix', 'direction A: the close wrote later and must win');
  }

  // Direction B: the log row wrote later (real Date.now(), always later
  // than a small hand-authored Write= on the close).
  {
    const earlyWriteClose = eventPage('evt-24b', {
      endedAt: '2026-08-01T09:00:00.000Z',
      note: note('End Status=Review', 'Reason=left_in_progress', 'Write=1'),
    });
    logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T09:00:00.000Z' });
    const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [earlyWriteClose] });
    assert.equal(result.workType, 'Initial Work', 'direction B: the Sync Log row wrote later and must win');
  }
});

test('failure #28: a retroactive boundary with only a stale, unrelated, OLDER Sync Log row available (predating the boundary\'s own discovery Write=) surfaces unresolved, never Initial Work', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T01:00:00.000Z' }); // ancient, unrelated
  const retroactive = eventPage('evt-28', {
    endedAt: '2026-08-01T05:00:00.000Z',
    // Larger than any real Date.now() logSnapshot_ stamps on the row
    // above, so the Sync Log row is genuinely older than this discovery.
    note: note('End Status=In Progress', 'Reason=reassignment', 'Boundary=left_in_progress', 'Write=9999999999999'),
  });
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [retroactive] });
  assert.equal(result.unresolved, true);
});

test('failure #31: the retroactive candidate\'s comparison timestamp is the FRESH discovery Write= (stampExecutionBoundary_\'s own stamp), never the stale original reassignment close\'s Write=', () => {
  const { sandbox } = harness();
  // The Sync Log row's Write= (a real Date.now(), ~13-digit epoch ms) sits
  // BETWEEN the original (stale) close's tiny Write=100 and the fresh
  // retroactive discovery Write=9999999999999 — if the resolver wrongly
  // used the stale original Write=100, this row would look "postdating"
  // (real Date.now() >> 100) and be wrongly trusted; using the correct
  // fresh discovery Write=, it must be rejected as stale.
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T05:05:00.000Z' });
  const retroactive = eventPage('evt-31', {
    endedAt: '2026-08-01T05:00:00.000Z',
    // Write=100 is the ORIGINAL reassignment close's own write time;
    // Write=9999999999999 is stampExecutionBoundary_'s later, overwriting
    // stamp — noteField_'s last-occurrence lookup means the LATER value is
    // what mostRecentBoundaryCandidate_ reports as this candidate's
    // `write`.
    note: note('End Status=In Progress', 'Reason=reassignment', 'Write=100', 'Boundary=left_in_progress', 'Write=9999999999999'),
  });
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [retroactive] });
  assert.equal(
    result.unresolved, true,
    'expected the Sync Log row (a real Date.now(), far smaller than the fresh 9999999999999 discovery Write=) to be judged stale, proving the stale original Write=100 was not what was actually compared against (100 would have wrongly made the row look "postdating")'
  );
});

test('failure #32: an old, unrelated Review run must not win merely because it exists — the Write=-to-Write= staleness check rejects it as stale relative to the boundary\'s discovery', () => {
  const { sandbox } = harness();
  // Sync Log logs Review, then several In Progress rows (all logged
  // normally) — the LATEST non-In-Progress run found by step 2 is this old
  // Review row, since nothing else non-In-Progress was ever logged after
  // it (the later Backlog transition crashed before logSnapshot_).
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T01:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T02:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T03:00:00.000Z' });
  const retroactive = eventPage('evt-32', {
    endedAt: '2026-08-01T05:00:00.000Z',
    // Larger than any real Date.now() logSnapshot_ stamped on the rows
    // above, so the old Review run is genuinely older than this discovery.
    note: note('End Status=In Progress', 'Reason=reassignment', 'Boundary=left_in_progress', 'Write=9999999999999'),
  });
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [retroactive] });
  assert.equal(result.unresolved, true, 'expected the old Review run to be rejected as stale, not reported as Review Fix');
});

test('failure #42: a same-cycle retroactive boundary discovery and its paired (logically earlier) Sync Log row must NOT be rejected as "predating discovery" — the check is Write=-to-Write=, never routed through the general Notion-minute-first hierarchy', () => {
  const { sandbox } = harness();
  // The Sync Log row's own Notion-side timestamp (12:00) is well BEFORE
  // the boundary's Ended At/discovery moment (12:15) — if this comparison
  // were mediated through compareInstants_'s general "Notion timestamp
  // first" hierarchy, it would look like it predates the boundary. The
  // Write=-to-Write= comparison must instead see that both were written in
  // the same reconciliation pass (this row's Write= postdates the
  // boundary's discovery Write=) and accept it.
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T12:00:00.000Z' });
  const retroactive = eventPage('evt-42', {
    endedAt: '2026-08-01T05:00:00.000Z', // unrelated stale original close time
    note: note('End Status=In Progress', 'Reason=reassignment', 'Write=1', 'Boundary=left_in_progress', 'Write=1'),
  });
  // logSnapshot_'s own Write= (real Date.now(), always >> 1) postdates the
  // boundary's Write=1 discovery stamp — same reconciliation pass, later
  // write, despite the EARLIER logical/Notion timestamp above.
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [retroactive] });
  assert.equal(result.unresolved, false, 'expected the same-cycle Sync Log row to be trusted, not rejected as predating discovery');
  assert.equal(result.workType, 'Initial Work');
});

test('failure #36: an intervening, differently-labeled Sync Log row between a genuine close and a later same-status run proves two distinct periods — ordinary "more recent wins" applies', () => {
  const { sandbox } = harness();
  const genuineClose = eventPage('evt-36', {
    endedAt: '2026-08-01T08:00:00.000Z', // t1
    note: note('End Status=Review', 'Reason=left_in_progress'),
  });
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z' }); // matches t1
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T08:30:00.000Z' }); // unmapped-actor spell, DOES get logged
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' }); // t2 — a distinct, later Review period
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [genuineClose] });
  assert.equal(result.unresolved, false, 'expected this to resolve — the intervening row proves two distinct periods');
  assert.equal(result.workType, 'Review Fix');
  assert.equal(
    result.resolvedAt.timestamp.toISOString(), '2026-08-01T09:00:00.000Z',
    'expected the NEWER Sync Log run (t2) to win, not the older genuine close (t1)'
  );
});

test('failure #39: the SAME shape as #36, but with NO intervening Sync Log row at all — genuinely unresolvable (polling can silently skip an intervening transition); must not confidently pick either timestamp', () => {
  const { sandbox } = harness();
  const genuineClose = eventPage('evt-39', {
    endedAt: '2026-08-01T08:00:00.000Z', // t1 — never logged to Sync Log (crash)
    note: note('End Status=Review', 'Reason=left_in_progress'),
  });
  // Only a LATER Review row exists; nothing at t1, and nothing of any
  // other status in between — the absence of an intervening row cannot
  // prove "t1/t2 are the same transition re-observed" over "an unobserved
  // Review -> other -> Review round-trip happened between them".
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' }); // t2
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [genuineClose] });
  assert.equal(result.unresolved, true, 'expected this specific no-intervening-row sub-case to be genuinely unresolvable');
});

test('failure #40: same superficial shape as #39 (same status, different timestamp) but WITH an intervening differently-labeled row — must NOT be treated as ambiguous merely by resemblance to #39; §4\'s ordinary comparison resolves it', () => {
  const { sandbox } = harness();
  const genuineClose = eventPage('evt-40', {
    endedAt: '2026-08-01T08:00:00.000Z', // t1
    note: note('End Status=Review', 'Reason=left_in_progress'),
  });
  logRow(sandbox, { status: 'Blocked', receivedAt: '2026-08-01T08:15:00.000Z' }); // positively observed, differently-labeled row
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' }); // t2
  const result = sandbox.resolveWorkType_({ taskId: TASK_ID, allEvents: [genuineClose] });
  assert.equal(result.unresolved, false, 'expected the #39 fix to not overcorrect into blanket same-status ambiguity');
  assert.equal(result.workType, 'Review Fix');
  assert.equal(result.resolvedAt.timestamp.toISOString(), '2026-08-01T09:00:00.000Z');
});

// ---------------------------------------------------------------------------
// resolveWorkType_ — §6 churn inheritance takes priority over §3
// ---------------------------------------------------------------------------

test('resolveWorkType_: a same-call reassignment churn close inherits directly, never re-resolved via §3 fresh classification', () => {
  const { sandbox } = harness();
  const outgoing = eventPage('evt-churn-same-call', {
    endedAt: '2026-08-01T05:00:00.000Z',
    note: note('Reason=reassignment'),
  });
  outgoing.properties['Work Type'] = { type: 'select', select: { name: 'Review Fix' } };
  // Even though §3 fresh classification would say Initial Work here (no
  // boundary, no Sync Log row at all), churn inheritance must win outright.
  const result = sandbox.resolveWorkType_({
    taskId: TASK_ID,
    allEvents: [],
    expectedExecutionId: 'exec-1',
    sameCallOutgoingChurnEvents: [{ event: outgoing, closeReason: 'reassignment' }],
  });
  assert.equal(result.unresolved, false);
  assert.equal(result.workType, 'Review Fix');
  assert.equal(result.source, 'churn_same_call');
});

test('resolveWorkType_ (Finding H): an unverified expectedExecutionId lets a legitimate cross-poll churn continuation inherit from a legacy (no-Execution=) closed event elsewhere in allEvents', () => {
  const { sandbox } = harness();
  const legacyOutgoing = eventPage('evt-churn-cross-poll', {
    endedAt: '2026-08-01T05:00:00.000Z',
    note: note('Reason=duplicate_reconciliation'),
  });
  legacyOutgoing.properties['Work Type'] = { type: 'select', select: { name: 'Initial Work' } };
  const result = sandbox.resolveWorkType_({
    taskId: TASK_ID,
    allEvents: [legacyOutgoing],
    expectedExecutionId: '', // unverified — nothing closed THIS call, Started At still stale
  });
  assert.equal(result.unresolved, false);
  assert.equal(result.workType, 'Initial Work');
  assert.equal(result.source, 'churn_cross_poll');
});

test('resolveWorkType_ (Finding G): a VERIFIED expectedExecutionId that does not match an explicit Execution= on the candidate rejects churn outright, falling through to §3', () => {
  const { sandbox } = harness();
  const mismatched = eventPage('evt-churn-mismatch', {
    endedAt: '2026-08-01T05:00:00.000Z',
    note: note('Reason=reassignment', 'Execution=2026-01-01T00:00:00.000Z'),
  });
  mismatched.properties['Work Type'] = { type: 'select', select: { name: 'Review Fix' } };
  const result = sandbox.resolveWorkType_({
    taskId: 'never-seen-task-g',
    allEvents: [mismatched],
    expectedExecutionId: '2026-09-01T00:00:00.000Z', // verified fresh, genuinely different execution
  });
  assert.equal(result.unresolved, false);
  assert.equal(result.workType, 'Initial Work', 'expected §3\'s no-candidate-at-all default, not the mismatched candidate\'s inherited Review Fix');
  assert.notEqual(result.source, 'churn_cross_poll');
});

// ---------------------------------------------------------------------------
// resolveNewTimeEventWorkTypeSafely_ — non-blocking wrapper
// ---------------------------------------------------------------------------

test('resolveNewTimeEventWorkTypeSafely_: an unresolved resolveWorkType_ result passes through unchanged', () => {
  const { sandbox } = harness();
  const retroactive = eventPage('evt-safe-1', {
    endedAt: '2026-08-01T05:00:00.000Z',
    note: note('End Status=In Progress', 'Reason=reassignment', 'Boundary=left_in_progress', 'Write=9999'),
  });
  const result = sandbox.resolveNewTimeEventWorkTypeSafely_({ taskId: 'never-seen-task-safe-1', allEvents: [retroactive] });
  assert.equal(result.unresolved, true);
});

test('resolveNewTimeEventWorkTypeSafely_: an exception thrown anywhere inside resolution is swallowed and reported as unresolved, never propagated', () => {
  const { sandbox } = harness();
  const originalBoundaryResolver = sandbox.mostRecentBoundaryCandidate_;
  sandbox.mostRecentBoundaryCandidate_ = function () {
    throw new Error('simulated resolver failure');
  };
  try {
    const result = sandbox.resolveNewTimeEventWorkTypeSafely_({ taskId: TASK_ID, allEvents: [] });
    assert.equal(result.unresolved, true);
    assert.equal(result.workType, '');
    assert.match(result.reasonCode, /simulated resolver failure/);
  } finally {
    sandbox.mostRecentBoundaryCandidate_ = originalBoundaryResolver;
  }
});
