// ADP-051-B2: regression tests for the isolated Work Type (Initial Work /
// Review Fix) resolver — docs/review-fix-state-model.md §3 (decision
// procedure), §4 (evidence priority & timestamp-tie resolution) and §6
// (reassignment/churn inheritance). Each test below is named after the
// specific §7 failure-matrix row(s) it regression-tests.
//
// Review Source (§5) and any GitHub API integration are explicitly out of
// scope for ADP-051-B — see this file's own header note near the bottom for
// exactly which §7 rows are Review-Source-only (or otherwise out of scope)
// and therefore have no test here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

const TASK_ID = 'work-type-resolver-task';

function dateProp(iso) {
  return iso ? { type: 'date', date: { start: iso } } : { type: 'date', date: null };
}

function textProp(value) {
  return { type: 'rich_text', rich_text: value ? [{ plain_text: value }] : [] };
}

function selectProp(value) {
  return { type: 'select', select: value ? { name: value } : null };
}

// Joins raw `Key=Value` segments verbatim, in the order given — unlike
// buildNote_, this deliberately allows duplicate keys (e.g. two `Write=`
// segments) so a test can construct exactly what a real close followed by a
// later stampExecutionBoundary_ retroactive stamp would leave behind
// (last-occurrence-wins, per noteField_).
function note(...segments) {
  return segments.join(' | ');
}

function eventPage(id, { startedAt, endedAt, note: noteText = '', workType } = {}) {
  const properties = {
    'Started At': dateProp(startedAt),
    'Ended At': dateProp(endedAt),
    Note: textProp(noteText),
  };
  if (workType !== undefined) properties['Work Type'] = selectProp(workType);
  return { id, properties };
}

function harness(overrides = {}) {
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-notion-token', SPREADSHEET_ID: 'test-sheet' },
    fetch() {
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    },
    ...overrides,
  });
}

function logRow(sandbox, { taskId = TASK_ID, status, receivedAt, outcome = '', type = 'Task' } = {}) {
  sandbox.logSnapshot_('snap', 'test', taskId, status, new Date(receivedAt), outcome, type);
}

// ---------------------------------------------------------------------------
// Baseline (§3 step 4)
// ---------------------------------------------------------------------------

test('resolveWorkType_ classifies a Task\'s first-ever execution as Initial Work when there is no boundary and no Sync Log history at all (docs/review-fix-state-model.md §3 step 4)', () => {
  const { sandbox } = harness();

  const result = sandbox.resolveWorkType_(TASK_ID, []);

  assert.equal(result.unresolved, false);
  assert.equal(result.classification, 'Initial Work');
  assert.equal(result.reasonCode, 'no_candidate');
});

// ---------------------------------------------------------------------------
// §3 step 1 / step 3: the boundary candidate, genuine vs. retroactive
// ---------------------------------------------------------------------------

test('failure #28: a retroactively-stamped boundary with no Sync Log candidate at all surfaces unresolved, never a silent Initial Work default (docs/review-fix-state-model.md §3 step 1/3)', () => {
  const { sandbox } = harness();
  const event = eventPage('evt-28', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T09:00:00.000Z',
    note: note('Reason=reassignment', 'End Status=In Progress', 'Write=1000', 'Boundary=left_in_progress', 'Write=5000'),
  });

  const result = sandbox.resolveWorkType_(TASK_ID, [event]);

  assert.equal(result.unresolved, true);
  assert.equal(result.classification, null);
  assert.equal(result.reasonCode, 'retroactive_boundary_no_synclog_candidate');
});

test('failure #2: a retroactive boundary\'s own stale End Status is never used once a fresher Sync Log candidate exists — it must supply the real status (docs/review-fix-state-model.md §3 step 1, §6)', () => {
  let fakeNow = 9000000000000; // well after the boundary's own discovery Write=5000
  const { sandbox } = harness({ now: () => fakeNow });
  const boundaryEvent = eventPage('evt-2', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T09:00:00.000Z',
    note: note('Reason=reassignment', 'End Status=In Progress', 'Write=1000', 'Boundary=left_in_progress', 'Write=5000'),
  });
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:05:00.000Z' });

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryEvent]);

  assert.equal(result.unresolved, false);
  assert.equal(result.classification, 'Review Fix', 'must use the Sync Log\'s real Review status, never the stale End Status=In Progress the original reassignment close left behind');
  assert.equal(result.reasonCode, 'retroactive_boundary_fallback_to_synclog');
});

test('failure #31: a retroactive boundary\'s effective Write= for §3 step 3 comparisons is the boundary discovery\'s own (later) stamp, never the stale original close\'s Write= (docs/review-fix-state-model.md §3 step 1/3)', () => {
  let fakeNow = 4000; // between the two competing Write= values below
  const { sandbox } = harness({ now: () => fakeNow });
  const boundaryEvent = eventPage('evt-31', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T09:00:00.000Z',
    // The ORIGINAL reassignment close wrote Write=1000; the LATER retroactive
    // stampExecutionBoundary_ call overwrote it (last-occurrence-wins) with
    // Write=5000, its own discovery time.
    note: note('Reason=reassignment', 'End Status=In Progress', 'Write=1000', 'Boundary=left_in_progress', 'Write=5000'),
  });
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:05:00.000Z' });

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryEvent]);

  assert.equal(result.unresolved, true, 'using the stale original Write=1000 instead of the fresh Write=5000 would have wrongly accepted this Sync Log row (Write=4000) as postdating discovery');
  assert.equal(result.reasonCode, 'synclog_candidate_predates_boundary_discovery');
});

test('failure #32: a stale Sync Log run left over from before a retroactively-stamped boundary is rejected the same as no Sync Log data at all (docs/review-fix-state-model.md §3 step 3)', () => {
  let fakeNow = 1000000000000; // an old cycle, long before the boundary below
  const { sandbox } = harness({ now: () => fakeNow });
  logRow(sandbox, { status: 'Review', receivedAt: '2026-07-01T00:00:00.000Z' });

  const boundaryEvent = eventPage('evt-32', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T09:00:00.000Z',
    note: note('Reason=reassignment', 'End Status=In Progress', 'Boundary=left_in_progress', 'Write=9000000000000'),
  });

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryEvent]);

  assert.equal(result.unresolved, true);
  assert.equal(result.reasonCode, 'synclog_candidate_predates_boundary_discovery');
});

test('failure #42: a same-cycle Sync Log row is accepted by its Write= postdating boundary discovery, even though its own (logical, minute-granular) timestamp predates that discovery — never rejected via the general Notion-minute-first hierarchy (docs/review-fix-state-model.md §3 step 3)', () => {
  const fakeNow = 1000000900000; // this reconciliation pass's own write time
  const { sandbox } = harness({ now: () => fakeNow });
  // The delayed transition's own logical/Notion timestamp (~12:00, well
  // before this pass actually ran and discovered the boundary).
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T12:00:00.000Z' });

  const boundaryEvent = eventPage('evt-42', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T09:00:00.000Z',
    note: note('Reason=reassignment', 'End Status=In Progress', 'Boundary=left_in_progress', 'Write=' + fakeNow),
  });

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryEvent]);

  assert.equal(result.unresolved, false);
  assert.equal(result.classification, 'Initial Work');
  assert.equal(result.reasonCode, 'retroactive_boundary_fallback_to_synclog');
});

// ---------------------------------------------------------------------------
// §3 step 2: the Sync Log candidate scan
// ---------------------------------------------------------------------------

test('failure #45: a Story-era Sync Log row is never reused as the Task\'s Sync Log candidate after reclassification to an executable Type (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z', type: 'Story' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:05:00.000Z', type: 'Task' });

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);

  assert.equal(candidate, null, 'the Story-era Review row must never surface as a candidate for the Task\'s first executable interval');
});

test('failure #48: the Type=Story hard cutoff also stops the scan from crossing an OLDER pre-Story executable Review row, not just Story-era rows themselves (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z', type: 'Task' }); // pre-Story, executable
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z', type: 'Story' }); // Story spell
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:05:00.000Z', type: 'Task' }); // back to Task

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);

  assert.equal(candidate, null, 'the scan must not reach past the Story spell to the older pre-Story Review row');
});

test('failure #51: an ambiguous_provenance_restart close is a hard cutoff for the Sync Log scan too, not only for churn inheritance (docs/review-fix-state-model.md §3 step 2, §6)', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z', type: 'Task' }); // pre-restart
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:05:00.000Z', type: 'Task' }); // the fresh reopen after the restart

  const restartEvent = eventPage('evt-restart-51', {
    startedAt: '2026-08-01T08:30:00.000Z',
    endedAt: '2026-08-01T09:00:00.000Z',
    note: 'Reason=ambiguous_provenance_restart',
  });

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, [restartEvent]);

  assert.equal(candidate, null, 'the scan must not reach past the restart to the older pre-restart Review row');
});

test('failure #46: a done_gate_rejected:...:rollback=<Status> row is read by its parsed rollback status, never the raw logged Status=Done column (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Done', receivedAt: '2026-08-01T09:00:00.000Z', outcome: 'done_gate_rejected:missing_result:rollback=Review' });

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);

  assert.ok(candidate);
  assert.equal(candidate.status, 'Review', 'must read the parsed rollback status, not the raw Status=Done the row was logged with');
});

test('failure #8: an intermediate unmapped-actor In Progress row is explicitly skipped, never misread as "the" preceding status (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T08:30:00.000Z' }); // unmapped actor spell

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);

  assert.equal(candidate.status, 'Review');
  assert.equal(candidate.timestamp.toISOString(), '2026-08-01T08:00:00.000Z');
});

test('failure #14: the run\'s earliest row (interval start) is used, never the most recently re-observed row of an unchanged status (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z' });
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:10:00.000Z' }); // re-observed, no real transition

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);

  assert.equal(candidate.timestamp.toISOString(), '2026-08-01T08:00:00.000Z');
});

test('failure #15: Review → In Progress → Review → In Progress is recognized as two distinct Review periods, never folded into one (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T08:30:00.000Z' });
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:30:00.000Z' });

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);

  assert.equal(candidate.status, 'Review');
  assert.equal(candidate.timestamp.toISOString(), '2026-08-01T09:00:00.000Z', 'must be the SECOND Review period\'s own start, not folded together with the first');
});

test('failure #5: a later Sync Log run (e.g. Backlog) outranks a stale genuine Time-Event close (e.g. Review) — the Sync Log must be consulted, not the Time Event side alone (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox } = harness();
  const boundaryEvent = eventPage('evt-5', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T08:00:00.000Z',
    note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000'),
  });
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T09:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:30:00.000Z' });

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryEvent]);

  assert.equal(result.unresolved, false);
  assert.equal(result.classification, 'Initial Work', 'a Time-Event-only heuristic would wrongly reuse the stale genuine Review close and report Review Fix');
  assert.equal(result.reasonCode, 'more_recent_wins_different_status');
});

// ---------------------------------------------------------------------------
// §6: reassignment / churn inheritance
// ---------------------------------------------------------------------------

test('failure #6: churn inheritance recognizes a reassignment close regardless of which poll cleared the assignee vs which poll reassigned it — no same-poll requirement (docs/review-fix-state-model.md §6)', () => {
  const { sandbox } = harness();
  const outgoing = eventPage('evt-6', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T05:00:00.000Z',
    note: 'Reason=reassignment',
    workType: 'Review Fix',
  });

  const result = sandbox.resolveChurnInheritedWorkType_(outgoing);

  assert.equal(result.inherits, true);
  assert.equal(result.workType, 'Review Fix');
});

test('failure #7: a genuine execution-boundary close is never itself treated as an inheritable churn source, so an unrelated later Review Fix can never wrongly adopt a past, already-finished execution\'s churn (docs/review-fix-state-model.md §6)', () => {
  const { sandbox } = harness();
  const pastGenuineClose = eventPage('evt-7', {
    startedAt: '2026-07-01T00:00:00.000Z',
    endedAt: '2026-07-01T05:00:00.000Z',
    note: 'Reason=left_in_progress | End Status=Review',
    workType: 'Review Fix',
  });

  const result = sandbox.resolveChurnInheritedWorkType_(pastGenuineClose);

  assert.equal(result.inherits, false);
  assert.equal(result.reasonCode, 'outgoing_event_is_execution_boundary');
});

test('failure #26: an ambiguous_provenance_restart close is never treated as ordinary churn — it starts a fresh, unclassified execution instead of inheriting (docs/review-fix-state-model.md §6)', () => {
  const { sandbox } = harness();
  const restart = eventPage('evt-26', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T05:00:00.000Z',
    note: 'Reason=ambiguous_provenance_restart',
    workType: 'Review Fix',
  });

  const result = sandbox.resolveChurnInheritedWorkType_(restart);

  assert.equal(result.inherits, false);
  assert.equal(result.reasonCode, 'ambiguous_provenance_restart_never_inherits');
});

test('failure #27 (required regression test): an empty churn candidate set after an ambiguous_provenance_restart never falls back to scanning further history for a Work Type to adopt (docs/review-fix-state-model.md §6)', () => {
  const { sandbox } = harness();
  // An older, unrelated, already-finished execution — its OWN Work Type
  // property is deliberately the WRONG answer ('Initial Work') for what
  // this test expects, so the assertion below can only pass if that stored
  // value was never consulted.
  const oldExecution = eventPage('evt-27-old', {
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T05:00:00.000Z',
    note: 'Reason=left_in_progress | End Status=Review',
    workType: 'Initial Work',
  });

  // No live reassignment continues into the current execution (the near
  // side of the restart is empty) — resolveNewTimeEventWorkTypeSafely_ must
  // fall through to a genuinely fresh §3 classification, never reach past
  // the restart to `oldExecution`'s own stored Work Type.
  const workType = sandbox.resolveNewTimeEventWorkTypeSafely_(TASK_ID, [oldExecution], []);

  assert.equal(workType, 'Review Fix', 'must be freshly resolved from oldExecution\'s own End Status=Review via §3, never its unrelated stored Work Type=Initial Work property');
});

test('failure #33: a legacy outgoing event with no Execution= marker at all still inherits via the Reason/Boundary legacy heuristic (docs/review-fix-state-model.md §6)', () => {
  const { sandbox } = harness();
  const legacyOutgoing = eventPage('evt-33', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T05:00:00.000Z',
    note: 'Reason=duplicate_reconciliation', // no Execution= at all
    workType: 'Initial Work',
  });

  const result = sandbox.resolveChurnInheritedWorkType_(legacyOutgoing);

  assert.equal(result.inherits, true);
  assert.equal(result.workType, 'Initial Work');
});

test('failure #12: a Reason=reassignment close that ALSO carries a retroactive Boundary=left_in_progress still stops churn inheritance — both forms of boundary count, not only Reason= alone (docs/review-fix-state-model.md §6)', () => {
  const { sandbox } = harness();
  const outgoing = eventPage('evt-12', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T05:00:00.000Z',
    note: 'Reason=reassignment | Boundary=left_in_progress',
    workType: 'Review Fix',
  });

  const result = sandbox.resolveChurnInheritedWorkType_(outgoing);

  assert.equal(result.inherits, false);
  assert.equal(result.reasonCode, 'outgoing_event_is_execution_boundary');
});

// ---------------------------------------------------------------------------
// §4: evidence priority & timestamp-tie resolution (compareInstants_ itself)
// ---------------------------------------------------------------------------

test('failure #9: two same-minute candidates are ordered by Write=, never by a naive `>` on the stale one (docs/review-fix-state-model.md §4)', () => {
  const { sandbox } = harness();
  const a = { timestamp: new Date('2026-08-01T09:00:10.000Z'), write: '2000' };
  const b = { timestamp: new Date('2026-08-01T09:00:40.000Z'), write: '1000' };

  assert.equal(sandbox.compareInstants_(a, b), 1, 'a wrote later (Write=2000) and must win despite its earlier-looking raw timestamp within the same minute');
  assert.equal(sandbox.compareInstants_(b, a), -1);
});

test('failure #10: a genuine simultaneous tie (identical minute AND identical Write=) is a true, unbiased tie — never favoring one side via `<=`/`<` (docs/review-fix-state-model.md §4, §6)', () => {
  const { sandbox } = harness();
  const a = { timestamp: new Date('2026-08-01T09:00:10.000Z'), write: '1000' };
  const b = { timestamp: new Date('2026-08-01T09:00:40.000Z'), write: '1000' };

  assert.equal(sandbox.compareInstants_(a, b), 0);
  assert.equal(sandbox.compareInstants_(b, a), 0);
});

test('failure #18: a genuine fresh boundary close outranks a stale, older Sync Log run left over from before a crash — never "stale Sync Log wins unconditionally" (docs/review-fix-state-model.md §4)', () => {
  const { sandbox } = harness();
  const boundaryEvent = eventPage('evt-18', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T10:00:00.000Z',
    note: note('Reason=left_in_progress', 'End Status=Review', 'Write=2000'),
  });
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T08:00:00.000Z' }); // stale, from before the crash

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryEvent]);

  assert.equal(result.classification, 'Review Fix');
  assert.equal(result.reasonCode, 'more_recent_wins_different_status');
});

test('failure #19: a same-minute tie between a genuine fresh boundary and a stale Sync Log row is broken toward whichever genuinely wrote later, not `>=` always favoring the Sync Log row (docs/review-fix-state-model.md §4)', () => {
  let fakeNow = 1000; // wrote earlier than the boundary's own close below
  const { sandbox } = harness({ now: () => fakeNow });
  logRow(sandbox, { status: 'Backlog', receivedAt: '2026-08-01T10:00:05.000Z' }); // same minute as the boundary close, but wrote EARLIER

  const boundaryEvent = eventPage('evt-19', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T10:00:30.000Z',
    note: note('Reason=left_in_progress', 'End Status=Review', 'Write=5000'), // wrote LATER
  });

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryEvent]);

  assert.equal(result.classification, 'Review Fix', 'the genuine close wrote later (Write=5000 > 1000) and must win the same-minute tie, not the Sync Log row merely because it exists');
  assert.equal(result.reasonCode, 'more_recent_wins_different_status');
});

test('failure #24: the Write= comparison is symmetric — whichever side genuinely wrote later wins, in both directions (docs/review-fix-state-model.md §4)', () => {
  const { sandbox } = harness();
  const sameMinuteEarlierWrite = { timestamp: new Date('2026-08-01T10:00:05.000Z'), write: '1000' };
  const sameMinuteLaterWrite = { timestamp: new Date('2026-08-01T10:00:40.000Z'), write: '9000' };

  assert.equal(sandbox.compareInstants_(sameMinuteEarlierWrite, sameMinuteLaterWrite), -1, 'the side with the smaller Write= must lose regardless of which argument position it is passed in');
  assert.equal(sandbox.compareInstants_(sameMinuteLaterWrite, sameMinuteEarlierWrite), 1, 'and the side with the larger Write= must win from either position');
});

test('failure #38: a genuine close\'s Ended At is treated as minute-granular, best-effort evidence — two instants within the same recorded minute are a tie unless Write= breaks it, never ordered by raw sub-minute seconds (docs/review-fix-state-model.md §3 step 1)', () => {
  const { sandbox } = harness();
  const earlierSecondSameMinute = { timestamp: new Date('2026-08-01T03:00:10.000Z'), write: '' };
  const laterSecondSameMinute = { timestamp: new Date('2026-08-01T03:00:50.000Z'), write: '' };

  assert.equal(sandbox.compareInstants_(earlierSecondSameMinute, laterSecondSameMinute), 0, 'both round to the same Notion minute and carry no Write=, so raw sub-minute seconds must never be trusted to order them');
});

test('failure #41: Write= never overrides a real difference in Notion minute — it only breaks a tie WITHIN the same minute, never substitutes for the transition-boundary timestamp itself (docs/review-fix-state-model.md §3 step 1)', () => {
  const { sandbox } = harness();
  const earlierMinuteHugeWrite = { timestamp: new Date('2026-08-01T03:00:00.000Z'), write: '9999999999999' };
  const laterMinuteTinyWrite = { timestamp: new Date('2026-08-01T03:05:00.000Z'), write: '1' };

  assert.equal(sandbox.compareInstants_(earlierMinuteHugeWrite, laterMinuteTinyWrite), -1, 'the earlier Notion minute must still lose despite an enormous Write=, and the later minute must still win despite a tiny one');
});

// ---------------------------------------------------------------------------
// §3 step 3: same-status, disagreeing-timestamp sub-cases
// ---------------------------------------------------------------------------

test('failures #35/#39: a genuine close and a later Sync Log run reporting the SAME status with no intervening different-status row are surfaced as unresolved — never coalesced to either timestamp by guessing (docs/review-fix-state-model.md §3 step 3)', () => {
  const { sandbox } = harness();
  const boundaryEvent = eventPage('evt-35-39', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T10:00:00.000Z',
    note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000'),
  });
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T10:10:00.000Z' }); // same status, later — but no evidence of what happened in between

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryEvent]);

  assert.equal(result.unresolved, true);
  assert.equal(result.reasonCode, 'same_status_different_timestamp_no_intervening_row');
});

test('failures #36/#40: an actually-observed intervening row with a DIFFERENT status is positive evidence of two distinct same-status periods — resolved by ordinary "more recent wins", not blanket ambiguity (docs/review-fix-state-model.md §3 step 3)', () => {
  const { sandbox } = harness();
  const boundaryEvent = eventPage('evt-36-40', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T10:00:00.000Z',
    note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000'),
  });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T10:10:00.000Z' }); // unmapped-actor spell, actually observed
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T10:20:00.000Z' }); // the second, genuinely distinct Review period

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryEvent]);

  assert.equal(result.unresolved, false);
  assert.equal(result.classification, 'Review Fix');
  assert.equal(result.reasonCode, 'same_status_intervening_row_confirms_distinct_periods');
});

test('Finding 4 (ADP-051-B2/B3 fixup, P2): an intervening different-status row is detected via the same timestamp+Write= ordering §4 uses everywhere else, not raw receivedAt milliseconds — a boundary, the intervening row, and the later same-status run all tied within one Notion minute must still be recognized (docs/review-fix-state-model.md §3 step 3, §4)', () => {
  let fakeNow = 1000;
  const { sandbox } = harness({ now: () => fakeNow });

  // All three timestamps below round to the SAME Notion minute (10:00) —
  // only their Write= values (in the order the test writes them) establish
  // the true sequence: boundary close, then the intervening In Progress
  // row, then the second Review period's own start.
  const boundaryEvent = eventPage('evt-finding4', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T10:00:50.000Z',
    note: note('Reason=left_in_progress', 'End Status=Review', 'Write=' + fakeNow),
  });

  fakeNow = 2000;
  // Raw receivedAt (10:00:05) is EARLIER than the Sync Log run's own start
  // below (10:00:10) and earlier than the boundary's Ended At (10:00:50) —
  // a raw-millisecond comparison would wrongly exclude this row as outside
  // the [boundary, syncLog] span. Its Write=2000 correctly places it AFTER
  // the boundary's Write=1000.
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T10:00:05.000Z' });

  fakeNow = 3000;
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T10:00:10.000Z' });

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryEvent]);

  assert.equal(result.unresolved, false, 'the intervening row must be recognized despite all three timestamps sharing one Notion minute — a raw-millisecond comparison loses it and wrongly reports this unresolved');
  assert.equal(result.classification, 'Review Fix');
  assert.equal(result.reasonCode, 'same_status_intervening_row_confirms_distinct_periods');
});

test('Finding 3 (ADP-051-B2/B3 fixup, P2): a Sync Log row that ties with the Type=Story cutoff at the same Notion minute, with no way to break the tie, is surfaced as unresolved — never silently discarded into a confident Initial Work default (docs/review-fix-state-model.md §3 step 2, §4, failure #28 principle)', () => {
  const fakeNow = 5000;
  const { sandbox } = harness({ now: () => fakeNow });
  // The Story cutoff and the only otherwise-eligible row land in the same
  // Notion minute (09:00) AND carry the identical Write= (both logged
  // under this test's fixed fake clock) — compareInstants_ returns a
  // genuine, unresolvable 0, not proof this row is on either side of the
  // cutoff.
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:10.000Z', type: 'Story' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:00:45.000Z', type: 'Task' });

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);
  assert.ok(candidate, 'an unresolvable cutoff tie must be surfaced distinctly from "no eligible row at all" (null)');
  assert.equal(candidate.ambiguousCutoffTie, true);

  const result = sandbox.resolveWorkType_(TASK_ID, []);
  assert.equal(result.unresolved, true, 'must never silently fall through to a confident Initial Work default when the only candidate\'s order relative to the cutoff is genuinely unknowable');
  assert.equal(result.classification, null);
  assert.equal(result.reasonCode, 'synclog_candidate_cutoff_tie_ambiguous');
});

// ---------------------------------------------------------------------------
// Performance (failure #16)
// ---------------------------------------------------------------------------

test('failure #16 / Finding 2 (ADP-051-B2/B3 fixup): Sync Log candidate resolution costs exactly ONE bulk row-data transfer for this Task\'s matched rows, never one getValues() call per matched row, and nothing at all for a Task with no rows on file (docs/review-fix-state-model.md §3 step 2, performance)', () => {
  const { sandbox, spreadsheet } = harness();
  for (let i = 0; i < 50; i++) {
    logRow(sandbox, { taskId: 'unrelated-task-' + i, status: 'Review', receivedAt: '2026-08-01T00:00:00.000Z' });
  }
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:30:00.000Z' });

  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0;

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);

  assert.ok(candidate);
  assert.equal(syncLogSheet.getValuesCallCount, 1, 'expected exactly ONE bulk row-data transfer spanning this Task\'s matched rows, never one getValues() call per matched row');

  syncLogSheet.getValuesCallCount = 0;
  const noneCandidate = sandbox.resolveSyncLogCandidate_('task-never-seen', []);
  assert.equal(noneCandidate, null);
  assert.equal(syncLogSheet.getValuesCallCount, 0, 'a Task ID that has never appeared in the log must cost zero row-data transfers, however large the log has grown');
});

test('Finding 2 (P1, ADP-051-B2/B3 fixup): a mature Task with hundreds of matched Sync Log observations still costs exactly ONE row-data transfer, never one per matched row — the exact cost shape Codex flagged as able to exhaust the Apps Script execution window before the event is ever opened (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox, spreadsheet } = harness();
  const ROW_COUNT = 500;
  for (let i = 0; i < ROW_COUNT; i++) {
    const minute = i % 2 === 0 ? '08' : '09';
    logRow(sandbox, {
      status: i % 2 === 0 ? 'Review' : 'In Progress',
      receivedAt: '2026-08-01T' + minute + ':' + String(i % 60).padStart(2, '0') + ':00.000Z',
    });
  }

  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0;

  const rows = sandbox.readSyncLogRowsForTask_(TASK_ID);

  assert.equal(rows.length, ROW_COUNT, 'every matched row for this Task must still be returned');
  assert.equal(syncLogSheet.getValuesCallCount, 1, 'a mature Task\'s ' + ROW_COUNT + ' matched rows must cost exactly one bulk row-data transfer, never one per matched row (Codex P1: hundreds/thousands of rows must not risk a platform hard timeout before the event is opened)');
});

// ---------------------------------------------------------------------------
// §7 rows deliberately NOT implemented here — out of scope for ADP-051-B2.
//
// Review Source (§5) only, no Work Type mechanics of its own to test in
// isolation: #1, #13, #17, #21, #23, #25, #30, #34, #37, #43, #44, #47, #49,
// #50, #52, #53.
//
// Explicitly out of scope by this task's own AC / non-goals: #11 (Review
// Round counting via interval/row count — §9 non-goal, deferred to
// ADP-051-E).
//
// Docs-hygiene / non-code: #4 (GITHUB_TOKEN Security Model inventory — that
// update belongs to ADP-051-C, which actually introduces GITHUB_TOKEN).
//
// Legacy pre-`Write=` heuristic, not reimplemented by this pure resolver
// (see resolveWorkType_'s own header comment for why, and #28's failure
// test above for the safe "surface unresolved" fallback this resolver
// takes instead): #20, #22.
//
// Storage-mechanism note (not a gap): #3 ("Work Type=/Review Source= notes
// survive many appendNote_ compactions") does not apply to this
// implementation — Work Type is stored as a native Notion `select`
// property on the Time Event page (see ADP-051-B3's wiring), not embedded
// in the Note field, so appendNote_'s eviction policy never touches it.
// ---------------------------------------------------------------------------
