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

test('Finding C (P2, ADP-051-B2/B3 fixup round 2): a done_gate_rejected:...:rollback=In Progress row is read by its FULL multi-word rollback status, never truncated at the first space (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox } = harness();
  // An older, genuine Review row this rollback row must not mask.
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T08:00:00.000Z' });
  // enforceDoneGate_ rejects an invalid Done attempt with an open Time
  // Event and rolls back to DEFAULTS.START_STATUS ('In Progress') — a real,
  // reachable multi-word rollback value, not a hypothetical.
  logRow(sandbox, { status: 'Done', receivedAt: '2026-08-01T09:00:00.000Z', outcome: 'done_gate_rejected:missing_result:rollback=In Progress' });

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);

  // A `/rollback=(\S+)/` capture would have extracted only 'In', which
  // matches neither DEFAULTS.START_STATUS ('In Progress', so the row is
  // never skipped as an In-Progress row) nor any real status — the buggy
  // regressed behavior returns 'In' itself as the (nonsense) candidate
  // status. The fix must recognize the row as the full 'In Progress'
  // rollback, skip it as an In-Progress row, and continue the scan back to
  // the real preceding Review row instead.
  assert.ok(candidate);
  assert.equal(candidate.status, 'Review', 'the rollback=In Progress row must be recognized (and skipped) as In Progress IN FULL, letting the scan continue to the actual preceding Review row rather than stopping on a truncated "In"');
  assert.equal(candidate.timestamp.toISOString(), '2026-08-01T08:00:00.000Z');
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
  const result = sandbox.resolveNewTimeEventWorkTypeSafely_(TASK_ID, [oldExecution], []);

  assert.equal(result.workType, 'Review Fix', 'must be freshly resolved from oldExecution\'s own End Status=Review via §3, never its unrelated stored Work Type=Initial Work property');
  assert.equal(result.inheritedExecutionId, '', 'Finding J (round 6): no inheritance happened here (a fresh §3 classification), so there must be no identity to adopt — the call site keeps its own freshly-computed executionId');
  assert.equal(result.inherited, false, 'Finding K (round 7): this empty inheritedExecutionId means "no inheritance happened at all" — the call site must tell this apart from an inherited-but-legacy-identity-free candidate, which also has an empty inheritedExecutionId but a DIFFERENT correct call-site behavior');
});

// ---------------------------------------------------------------------------
// Finding K (ADP-051-B2/B3 fixup round 7): resolveNewTimeEventWorkTypeSafely_
// must return a THIRD signal (`inherited`) distinguishing "inherited from a
// legacy no-Execution= candidate" (inheritedExecutionId === '', inherited ===
// true) from "no inheritance happened at all" (inheritedExecutionId === '',
// inherited === false) — round 6's `inheritedExecutionId || executionId`
// fallback at the call site could not tell these apart and wrongly
// manufactured an identity for the former (docs/review-fix-state-model.md
// §6, L566-570).
// ---------------------------------------------------------------------------

test('Finding K (P1, ADP-051-B2/B3 fixup round 7, case a — no regression): resolveNewTimeEventWorkTypeSafely_ returns inherited:true with the REAL Execution= identity when a same-call reassignment genuinely inherits from a modern candidate that has one (docs/review-fix-state-model.md §6)', () => {
  const { sandbox } = harness();
  const outgoing = eventPage('evt-k-real-identity', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T05:00:00.000Z',
    note: 'Reason=reassignment | Execution=2026-08-01T00:00:00.000Z',
    workType: 'Review Fix',
  });

  const result = sandbox.resolveNewTimeEventWorkTypeSafely_(
    TASK_ID, [outgoing], [{ event: outgoing, closeReason: 'reassignment' }]
  );

  assert.equal(result.workType, 'Review Fix');
  assert.equal(result.inherited, true, 'inheritance genuinely happened via the same-call reassignment step (step 2)');
  assert.equal(result.inheritedExecutionId, '2026-08-01T00:00:00.000Z', 'must hand back the winning candidate\'s own real Execution= identity — this is Finding J\'s case, must not regress');
});

test('Finding K (P1, ADP-051-B2/B3 fixup round 7, case b — the actual bug): resolveNewTimeEventWorkTypeSafely_ returns inherited:true but an EMPTY inheritedExecutionId when the winning churn candidate is a legacy event with no Execution= marker at all — this must be told apart from "no inheritance happened" so the call site never falls back to a manufactured identity (docs/review-fix-state-model.md §6, L566-570)', () => {
  const { sandbox } = harness();
  const legacyOutgoing = eventPage('evt-k-legacy-identity-free', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T05:00:00.000Z',
    note: 'Reason=duplicate_reconciliation', // no Execution= at all — legacy data
    workType: 'Initial Work',
  });

  const result = sandbox.resolveNewTimeEventWorkTypeSafely_(
    TASK_ID, [legacyOutgoing], [{ event: legacyOutgoing, closeReason: 'duplicate_reconciliation' }]
  );

  assert.equal(result.workType, 'Initial Work');
  assert.equal(result.inherited, true, 'genuine churn inheritance happened via the legacy Reason/Boundary heuristic (§6 L566-570) — this must NOT collapse into "no inheritance at all" just because there is no identity to report');
  assert.equal(result.inheritedExecutionId, '', 'the legacy candidate has no Execution= to give — L566-570 requires the replacement stay identity-free, never manufacture one at the call site');
});

test('Finding K (P1, ADP-051-B2/B3 fixup round 7, case c — no regression): resolveNewTimeEventWorkTypeSafely_ returns inherited:false for a genuinely new execution with no churn candidate at all, so its own empty inheritedExecutionId is never mistaken for case b\'s (docs/review-fix-state-model.md §6)', () => {
  const { sandbox } = harness();

  const result = sandbox.resolveNewTimeEventWorkTypeSafely_(TASK_ID, [], []);

  assert.equal(result.workType, 'Initial Work', 'no boundary and no Sync Log history at all — §3 step 4\'s confident default');
  assert.equal(result.inherited, false, 'no churn candidate matched at all (step 4) — the call site must keep computing its own fresh executionId');
  assert.equal(result.inheritedExecutionId, '');
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
// Finding M (ADP-051-B2/B3 fixup round 7): mostRecentBoundaryCandidate_'s own
// tie-handling. `compareInstants_` returning `0` for two same-minute
// boundary candidates lacking `Write=` means "unknowable ordering"
// (docs/review-fix-state-model.md L320-327), not "keep whichever the query
// happened to return first". A conflicting tie (disagreeing End Status=)
// must surface as an explicit ambiguous sentinel; a tie that happens to
// agree on End Status= has no real disagreement to hide and must still
// classify normally.
// ---------------------------------------------------------------------------

test('Finding M (P2, ADP-051-B2/B3 fixup round 7): two boundary candidates tied at the same Notion minute with DIFFERING End Status= and no Write= to break the tie surface an explicit ambiguous outcome, never a silent pick of whichever the query returned first (docs/review-fix-state-model.md §4, L320-327)', () => {
  const { sandbox } = harness();
  const boundaryA = eventPage('evt-m-a', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T08:00:00.000Z',
    note: note('Reason=left_in_progress', 'End Status=Review'),
  });
  const boundaryB = eventPage('evt-m-b', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T08:00:30.000Z', // same Notion minute as A; neither side carries Write=
    note: note('Reason=left_in_progress', 'End Status=Backlog'),
  });

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryA, boundaryB]);

  assert.equal(result.unresolved, true, 'a genuine same-minute tie with disagreeing End Status= is not resolvable from Notion\'s own data (§4) — must never silently keep query order');
  assert.equal(result.classification, null);
  assert.equal(result.reasonCode, 'boundary_conflicting_tie_ambiguous');

  // Order independence: swapping which event the (fake) query returns first
  // must not change the outcome — a query-order-dependent result IS the bug
  // Finding M reports.
  const swapped = sandbox.resolveWorkType_(TASK_ID, [boundaryB, boundaryA]);
  assert.equal(swapped.unresolved, true);
  assert.equal(swapped.classification, null);
  assert.equal(swapped.reasonCode, 'boundary_conflicting_tie_ambiguous');
});

test('Finding M (P2, ADP-051-B2/B3 fixup round 7, companion — no false positive): two boundary candidates tied at the same Notion minute with the SAME End Status= still classify normally — both possible orderings agree, so there is no actual ambiguity to surface (docs/review-fix-state-model.md §4, L320-327)', () => {
  const { sandbox } = harness();
  const boundaryA = eventPage('evt-m-same-a', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T08:00:00.000Z',
    note: note('Reason=left_in_progress', 'End Status=Review'),
  });
  const boundaryB = eventPage('evt-m-same-b', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T08:00:30.000Z', // same Notion minute, no Write=, SAME End Status
    note: note('Reason=left_in_progress', 'End Status=Review'),
  });

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryA, boundaryB]);

  assert.equal(result.unresolved, false, 'both tied candidates agree on End Status=Review — no actual disagreement in the answer, so this must not be flagged as ambiguous');
  assert.equal(result.classification, 'Review Fix');
  assert.equal(result.reasonCode, 'genuine_boundary_only');
});

test('Finding M (P2, ADP-051-B2/B3 fixup round 7, no-regression check): Write= still breaks an otherwise-tied boundary pair with differing End Status= — the conflicting-tie sentinel must only fire when Write= is genuinely unable to order them (docs/review-fix-state-model.md §4)', () => {
  const { sandbox } = harness();
  const boundaryA = eventPage('evt-m-write-a', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T08:00:00.000Z',
    note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000'),
  });
  const boundaryB = eventPage('evt-m-write-b', {
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T08:00:30.000Z', // same Notion minute as A, but Write= breaks the tie
    note: note('Reason=left_in_progress', 'End Status=Backlog', 'Write=2000'),
  });

  const result = sandbox.resolveWorkType_(TASK_ID, [boundaryA, boundaryB]);

  assert.equal(result.unresolved, false, 'Write=2000 unambiguously outranks Write=1000 within the same Notion minute — this is a resolvable order, not a conflicting tie');
  assert.equal(result.classification, 'Initial Work', 'the later-Write= candidate (End Status=Backlog) must win outright');
  assert.equal(result.reasonCode, 'genuine_boundary_only');
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

test('Finding B (P2, ADP-051-B2/B3 fixup round 2): a cutoff tie stays ambiguous even when every row that survives the tie-exclusion is itself In Progress and gets skipped by the loop below it — the ambiguous-cutoff-tie sentinel must propagate through this all-In-Progress fall-through too, not collapse to a confident Initial Work default (docs/review-fix-state-model.md §3 step 2, §4, failure #28 principle)', () => {
  let fakeNow = 5000;
  const { sandbox } = harness({ now: () => fakeNow });

  // The Story cutoff.
  fakeNow = 5000;
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:10.000Z', type: 'Story' });

  // Ties with the cutoff at the same Notion minute AND the same Write= —
  // compareInstants_ returns a genuine, unresolvable 0. Excluded from
  // `eligible` by the tie check, but sets cutoffTieExists = true.
  fakeNow = 5000;
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:10.000Z', type: 'Task' });

  // Definitely AFTER the cutoff (later Notion minute, later Write=), so it
  // IS eligible — but it is itself `In Progress`, so the backward scan for
  // "the first non-In-Progress status" skips it, runs out of eligible rows,
  // and falls through to the `i < 0` branch this finding fixes. Before the
  // fix, that branch returned plain `null` here, discarding the fact that
  // an unresolvable tie exists earlier in this same history.
  fakeNow = 9000;
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:05:00.000Z', type: 'Task' });

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);
  assert.ok(candidate, 'the all-In-Progress fall-through must not collapse an unresolvable cutoff tie into "no candidate at all" (null)');
  assert.equal(candidate.ambiguousCutoffTie, true);

  const result = sandbox.resolveWorkType_(TASK_ID, []);
  assert.equal(result.unresolved, true, 'a newer In Progress row must not let a genuinely unresolvable cutoff tie default to a confident Initial Work classification');
  assert.equal(result.classification, null);
  assert.equal(result.reasonCode, 'synclog_candidate_cutoff_tie_ambiguous');
});

// ---------------------------------------------------------------------------
// Performance (failure #16, and Finding D — ADP-051-B2/B3 fixup round 3)
// ---------------------------------------------------------------------------
//
// Rounds 1 and 2's fixes (a single min..max bulk range, then getRangeList
// grouped by contiguous matched-row runs) both bounded cost by trying to
// read only THIS TASK's own rows, cheaply. Round 3's Codex finding proved
// that strategy can never be bounded in the worst case: `Range#getValues()`
// is one HTTP round-trip PER Range object, even when the Ranges came from
// one `getRangeList()` call, so a Task whose matches are sparse/scattered
// (every match its own isolated, non-contiguous run — e.g. one poll
// interleaved with many other Tasks, repeated over hundreds of polls)
// still cost one service call PER MATCHED ROW under round 2's fix. The
// tests below regression-test round 3's actual fix instead: a poll-wide,
// memoized, lazy Sync Log projection read AT MOST ONCE per poll,
// regardless of match count, contiguity, or sparsity — the tests that used
// to prove round 2's per-run bound (grouping into contiguous runs, and
// "zero cost for a Task ID never seen") are retired here, since neither
// claim is either meaningful or true under this architecture: there is no
// more "run" to group (the whole sheet is read in one call, once), and
// determining "this Task ID has no rows at all" now requires having read
// the sheet at least once, exactly like determining anything else about
// it — the fix trades that one-time, poll-wide cost for an unconditional,
// never-worse-than-one bound against every match pattern, contiguous or
// not.

test('failure #16 / Finding D (ADP-051-B2/B3 fixup round 3): a single resolveSyncLogCandidate_ call costs exactly ONE bulk row-data transfer for the whole Sync Log sheet, regardless of this Task\'s own match count, and a Task ID that has never appeared costs the identical one transfer — not zero, but never more than one either (docs/review-fix-state-model.md §3 step 2, performance)', () => {
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
  assert.equal(syncLogSheet.getValuesCallCount, 1, 'expected exactly ONE bulk row-data transfer for the whole Sync Log sheet, not one per matched row');

  syncLogSheet.getValuesCallCount = 0;
  const noneCandidate = sandbox.resolveSyncLogCandidate_('task-never-seen', []);
  assert.equal(noneCandidate, null);
  assert.equal(
    syncLogSheet.getValuesCallCount, 1,
    'a Task ID that has never appeared in the log still costs exactly one bulk transfer under the poll-wide-projection architecture (never determinable without reading the sheet at least once) — but never more than one, unlike per-match reads'
  );
});

test('Finding D (P1, ADP-051-B2/B3 fixup round 3): a mature Task with hundreds of matched Sync Log observations still costs exactly ONE row-data transfer, never one per matched row (docs/review-fix-state-model.md §3 step 2)', () => {
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
  assert.equal(syncLogSheet.getValuesCallCount, 1, 'a mature Task\'s ' + ROW_COUNT + ' matched rows must cost exactly one bulk row-data transfer, never one per matched row');
});

test('Finding D (P1, ADP-051-B2/B3 fixup round 3, THE actual Codex reproduction): 500 rows alternating between this Task and an unrelated Task — every one of this Task\'s 250 matches its own isolated, non-contiguous run — still costs exactly ONE getValues() call for the whole task resolution, never one per matched row/run the way round 2\'s getRangeList fix did (docs/review-fix-state-model.md §3 step 2, performance)', () => {
  const { sandbox, spreadsheet } = harness();
  const ROW_COUNT = 500;

  // Sparse, adversarial interleaving: THIS Task and an UNRELATED Task
  // alternate row-for-row, so under round 2's contiguous-run grouping every
  // single matched row for THIS Task is its own isolated run (no two
  // adjacent rows share this Task's ID) — exactly Codex's own reproduction
  // ("500 alternating matched/unrelated rows -> 500 value-fetch calls").
  for (let i = 0; i < ROW_COUNT; i++) {
    const minute = String(Math.floor(i / 60)).padStart(2, '0');
    const second = String(i % 60).padStart(2, '0');
    const receivedAt = '2026-08-01T00:' + minute + ':' + second + '.000Z';
    if (i % 2 === 0) {
      logRow(sandbox, { status: i % 4 === 0 ? 'Review' : 'In Progress', receivedAt: receivedAt });
    } else {
      logRow(sandbox, { taskId: 'unrelated-task', status: 'Review', receivedAt: receivedAt });
    }
  }

  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0;

  const rows = sandbox.readSyncLogRowsForTask_(TASK_ID);
  assert.equal(rows.length, ROW_COUNT / 2, 'every one of this Task\'s alternating matches must still be returned');
  assert.equal(
    syncLogSheet.getValuesCallCount, 1,
    'expected exactly ONE getValues() call for the whole task resolution regardless of 250 scattered, non-contiguous matches — round 2\'s getRangeList fix would have cost one call PER matched row/run here'
  );

  // The same bound holds going through the full resolver chain, not only
  // the raw row read — this is what actually runs during reconciliation.
  syncLogSheet.getValuesCallCount = 0;
  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);
  assert.ok(candidate);
  assert.equal(syncLogSheet.getValuesCallCount, 1, 'resolveSyncLogCandidate_ itself must cost exactly one getValues() call against this sparse/alternating pattern');
});

test('Finding D (ADP-051-B2/B3 fixup round 3): a poll-wide loader (makeSyncLogProjectionLoader_) memoizes the bulk read — a second, third, ... Task resolved against the SAME loader within one poll costs ZERO additional Sync Log transfers', () => {
  const { sandbox, spreadsheet } = harness();
  for (let i = 0; i < 500; i++) {
    logRow(sandbox, {
      taskId: i % 3 === 0 ? TASK_ID : (i % 3 === 1 ? 'task-b' : 'task-c'),
      status: i % 2 === 0 ? 'Review' : 'In Progress',
      receivedAt: '2026-08-01T00:' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + '.000Z',
    });
  }

  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0;
  const loader = sandbox.makeSyncLogProjectionLoader_();

  const first = sandbox.resolveSyncLogCandidate_(TASK_ID, [], loader);
  const second = sandbox.resolveSyncLogCandidate_('task-b', [], loader);
  const third = sandbox.resolveSyncLogCandidate_('task-c', [], loader);
  const fourth = sandbox.resolveSyncLogCandidate_('task-never-seen', [], loader);

  assert.ok(first);
  assert.ok(second);
  assert.ok(third);
  assert.equal(fourth, null);
  assert.equal(
    syncLogSheet.getValuesCallCount, 1,
    'four Tasks resolved against the SAME poll-wide loader must share exactly ONE underlying Sync Log transfer, not one each'
  );
});

// ---------------------------------------------------------------------------
// Boundedness (Finding I — ADP-051-B2/B3 fixup round 6, the SIXTH review
// round on this exact performance area)
// ---------------------------------------------------------------------------
//
// Round 3's fix above (Finding D) bounded SERVICE-CALL COUNT to exactly one
// bulk read per poll, but a single `getRange(2, 1, lastRow-1, 8)` over an
// ever-growing, append-only sheet still transfers/holds an UNBOUNDED amount
// of DATA as the log matures — call count and data size are different
// things, and bounding one says nothing about the other. The tests below
// regression-test round 6's actual fix: a bounded tail window
// (`SYNC_LOG_PROJECTION_WINDOW_ROWS`), independent of total sheet size, with
// an explicit `unresolved` outcome — never a silent guess — whenever a
// Task's relevant history falls entirely outside that window.

const SYNC_LOG_PROJECTION_WINDOW_ROWS = 5000; // mirrors Code.gs's own constant

test('Finding I (P1, ADP-051-B2/B3 fixup round 6): loadSyncLogProjection_ reads a BOUNDED tail window of the Sync Log sheet — never the full 2..lastRow range — regardless of total sheet size, and marks the result truncated when older history was left unread (docs/review-fix-state-model.md §3 step 2, performance)', () => {
  const { sandbox, spreadsheet } = harness();
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  sandbox.ensureSyncLogSheet_(); // writes the header at row 1 before we push raw data rows below
  const TOTAL_ROWS = 20000; // far more than the window, and more than round 3's own largest test

  for (let i = 0; i < TOTAL_ROWS; i++) {
    syncLogSheet.rows.push([
      'snap-' + i, 'test', 'unrelated-task-' + i, 'Review',
      '2026-01-01T00:00:00.000Z', '', 'Task', String(1000 + i),
    ]);
  }

  const originalGetRange = syncLogSheet.getRange.bind(syncLogSheet);
  let capturedNumRows = null;
  syncLogSheet.getRange = function (row, column, numRows, numColumns) {
    // Distinguish the projection read from ensureSyncLogSheet_'s own
    // header write (also column 1, 8 columns, but always row 1/numRows 1).
    if (row > 1 && column === 1 && numColumns === 8) capturedNumRows = numRows;
    return originalGetRange(row, column, numRows, numColumns);
  };

  const rows = sandbox.loadSyncLogProjection_();

  assert.ok(capturedNumRows !== null, 'expected the 8-column projection range to be read');
  assert.equal(
    capturedNumRows, SYNC_LOG_PROJECTION_WINDOW_ROWS,
    'the read range height must be capped at the fixed window constant (' + SYNC_LOG_PROJECTION_WINDOW_ROWS + '), never lastRow-1 (' + TOTAL_ROWS + ') — a mature log must not make the read grow with total sheet size'
  );
  assert.equal(rows.length, SYNC_LOG_PROJECTION_WINDOW_ROWS);
  assert.equal(rows.truncated, true, 'older history beyond the window exists and must be flagged, so callers never mistake "not read" for "does not exist"');
  // Sanity: the window is the TAIL of the sheet (most recent rows), not an
  // arbitrary slice — the last row loaded must be the sheet's actual last
  // row.
  assert.equal(rows[rows.length - 1].taskId, 'unrelated-task-' + (TOTAL_ROWS - 1));
});

test('Finding I (P1, ADP-051-B2/B3 fixup round 6): loadSyncLogProjection_ is NOT truncated when the whole Sync Log fits within the window (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:30:00.000Z' });

  const rows = sandbox.loadSyncLogProjection_();

  assert.equal(rows.length, 2);
  assert.equal(rows.truncated, false);
});

test('Finding I (P1, ADP-051-B2/B3 fixup round 6): a Task whose ONLY Sync Log history falls entirely OUTSIDE the bounded window surfaces resolveSyncLogCandidate_\'s distinct ambiguous sentinel, never plain null ("no history at all") (docs/review-fix-state-model.md §3 step 2, failure #28 principle)', () => {
  const { sandbox, spreadsheet } = harness();
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  sandbox.ensureSyncLogSheet_();

  // Row 2: this Task's ONLY Sync Log observation ever — a genuine Review
  // row that, if seen, would classify the next execution as Review Fix.
  syncLogSheet.rows.push(['snap-target', 'test', TASK_ID, 'Review', '2026-01-01T00:00:00.000Z', '', 'Task', '500']);
  // Exactly WINDOW more (unrelated) rows push the bounded tail window to
  // start strictly after row 2, excluding the target Task's only row.
  for (let i = 0; i < SYNC_LOG_PROJECTION_WINDOW_ROWS; i++) {
    syncLogSheet.rows.push(['snap-' + i, 'test', 'unrelated-task', 'Review', '2026-06-01T00:00:00.000Z', '', 'Task', String(1000 + i)]);
  }

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);
  assert.ok(candidate, 'a Task whose only history fell outside the bounded window must surface a distinct ambiguous sentinel, never plain null ("no history at all")');
  assert.equal(candidate.windowTruncatedAmbiguous, true);

  const result = sandbox.resolveWorkType_(TASK_ID, []);
  assert.equal(result.unresolved, true, 'must never silently guess Initial Work when older history existed outside the bounded window and may have been Review');
  assert.equal(result.classification, null);
  assert.equal(result.reasonCode, 'synclog_candidate_window_truncated_ambiguous');
});

test('Finding I (P1, ADP-051-B2/B3 fixup round 6): a Task whose OWN eligible history sits fully INSIDE the bounded window still classifies normally, even though the sheet as a whole is truncated — truncation only matters for evidence this Task\'s classification actually needed but could not see (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox, spreadsheet } = harness();
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  sandbox.ensureSyncLogSheet_();

  // Old, unrelated rows entirely outside the eventual window — proves the
  // sheet really is truncated, not merely that it happens to fit.
  const OLD_UNRELATED_ROWS = 3000;
  for (let i = 0; i < OLD_UNRELATED_ROWS; i++) {
    syncLogSheet.rows.push(['snap-old-' + i, 'test', 'unrelated-task', 'Backlog', '2026-01-01T00:00:00.000Z', '', 'Task', String(i)]);
  }
  // More recent, still-unrelated filler, so the target Task's own rows land
  // as the SHEET'S LAST TWO rows — deep inside the bounded window.
  for (let i = 0; i < SYNC_LOG_PROJECTION_WINDOW_ROWS - 2; i++) {
    syncLogSheet.rows.push(['snap-recent-' + i, 'test', 'unrelated-task', 'Review', '2026-06-01T00:00:00.000Z', '', 'Task', String(9000000 + i)]);
  }
  // Within the window: this Task's own real history.
  syncLogSheet.rows.push(['snap-target-review', 'test', TASK_ID, 'Review', '2026-08-01T09:00:00.000Z', '', 'Task', '900000000']);
  syncLogSheet.rows.push(['snap-target-inprog', 'test', TASK_ID, 'In Progress', '2026-08-01T09:30:00.000Z', '', 'Task', '900000001']);

  const projection = sandbox.loadSyncLogProjection_();
  assert.equal(projection.truncated, true, 'sanity check: the sheet as a whole really is larger than the window');

  const result = sandbox.resolveWorkType_(TASK_ID, []);

  assert.equal(result.unresolved, false, 'a bounded read must not manufacture ambiguity for a Task whose own evidence is fully visible within the window');
  assert.equal(result.classification, 'Review Fix');
});

// ---------------------------------------------------------------------------
// Finding L (ADP-051-B2/B3 fixup round 7): round 6 (Finding I) above already
// covers the case where a Task's ONLY evidence falls entirely OUTSIDE the
// bounded window (`eligible` ends up empty -> windowTruncatedAmbiguous
// directly). This is a DIFFERENT case: `eligible` DOES have a candidate
// (some of this Task's history IS inside the window), but the backward
// same-status RUN-EXTENSION scan (resolveSyncLogCandidate_'s
// `runStart`/`j` loop) walks all the way back to the earliest row this
// resolver can see without ever finding the prior different-status row that
// would genuinely establish where the run began — i.e. the visible run is a
// RE-OBSERVATION of a run that may have started even earlier, before the
// window.
// ---------------------------------------------------------------------------

test('Finding L (P1, ADP-051-B2/B3 fixup round 7): a same-status run whose visible portion is a RE-OBSERVATION reaching the truncated window\'s edge (no prior different-status row found) surfaces resolveSyncLogCandidate_\'s ambiguous sentinel, never a confident run-start timestamp (docs/review-fix-state-model.md §3 step 2, failure #28 principle)', () => {
  const { sandbox, spreadsheet } = harness();
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  sandbox.ensureSyncLogSheet_();

  // Old, unrelated rows entirely outside the eventual window — proves the
  // sheet really is truncated, not merely that it happens to fit (same
  // setup as the Finding I "own eligible history" test above).
  const OLD_UNRELATED_ROWS = 3000;
  for (let i = 0; i < OLD_UNRELATED_ROWS; i++) {
    syncLogSheet.rows.push(['snap-old-' + i, 'test', 'unrelated-task', 'Backlog', '2026-01-01T00:00:00.000Z', '', 'Task', String(i)]);
  }
  // More recent, still-unrelated filler, so the target Task's own rows land
  // deep inside the bounded window, not at its literal physical edge.
  for (let i = 0; i < SYNC_LOG_PROJECTION_WINDOW_ROWS - 2; i++) {
    syncLogSheet.rows.push(['snap-recent-' + i, 'test', 'unrelated-task', 'Backlog', '2026-06-01T00:00:00.000Z', '', 'Task', String(9000000 + i)]);
  }
  // Within the window: this Task has TWO `Review` observations — a genuine
  // re-observation (the page stayed in Review across two separate polls,
  // each logging its own Sync Log row) — with NO earlier row for this Task
  // anywhere in the visible window to prove where the Review run actually
  // began. The true start could be exactly here, or could be long before
  // the window — this data cannot tell the two apart.
  syncLogSheet.rows.push(['snap-target-review-1', 'test', TASK_ID, 'Review', '2026-08-01T09:00:00.000Z', '', 'Task', '900000000']);
  syncLogSheet.rows.push(['snap-target-review-2', 'test', TASK_ID, 'Review', '2026-08-15T09:00:00.000Z', '', 'Task', '900000001']);

  const projection = sandbox.loadSyncLogProjection_();
  assert.equal(projection.truncated, true, 'sanity check: the sheet as a whole really is larger than the window');

  const candidate = sandbox.resolveSyncLogCandidate_(TASK_ID, []);
  assert.ok(candidate, 'must not be plain null — this is unresolvable, not "no history at all"');
  assert.equal(candidate.windowTruncatedAmbiguous, true, 'the backward run-extension scan reached the visible window\'s edge without ever finding a prior different-status/In-Progress row to establish the run\'s true start');

  const result = sandbox.resolveWorkType_(TASK_ID, []);
  assert.equal(result.unresolved, true, 'must never trust the earliest VISIBLE row of a same-status run as its confident true start when older history beyond the window could extend (or terminate) that run');
  assert.equal(result.classification, null);
  assert.equal(result.reasonCode, 'synclog_candidate_window_truncated_ambiguous');
});

test('Finding L (P1, ADP-051-B2/B3 fixup round 7, companion — no false positive): a same-status run whose PRIOR different-status row is ALSO visible inside the truncated window classifies normally — the run boundary is genuinely established from visible data, not an artifact of the window\'s edge (docs/review-fix-state-model.md §3 step 2)', () => {
  const { sandbox, spreadsheet } = harness();
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  sandbox.ensureSyncLogSheet_();

  const OLD_UNRELATED_ROWS = 3000;
  for (let i = 0; i < OLD_UNRELATED_ROWS; i++) {
    syncLogSheet.rows.push(['snap-old-' + i, 'test', 'unrelated-task', 'Backlog', '2026-01-01T00:00:00.000Z', '', 'Task', String(i)]);
  }
  for (let i = 0; i < SYNC_LOG_PROJECTION_WINDOW_ROWS - 3; i++) {
    syncLogSheet.rows.push(['snap-recent-' + i, 'test', 'unrelated-task', 'Backlog', '2026-06-01T00:00:00.000Z', '', 'Task', String(9000000 + i)]);
  }
  // This Task's own history, fully inside the window: a genuine `Backlog`
  // row PRECEDES the two `Review` re-observations — the run's true start
  // (the first Review row) is confidently established because something
  // OTHER than Review is visibly there right before it, not because the
  // window happened to end.
  syncLogSheet.rows.push(['snap-target-backlog', 'test', TASK_ID, 'Backlog', '2026-07-01T09:00:00.000Z', '', 'Task', '899999999']);
  syncLogSheet.rows.push(['snap-target-review-1', 'test', TASK_ID, 'Review', '2026-08-01T09:00:00.000Z', '', 'Task', '900000000']);
  syncLogSheet.rows.push(['snap-target-review-2', 'test', TASK_ID, 'Review', '2026-08-15T09:00:00.000Z', '', 'Task', '900000001']);

  const projection = sandbox.loadSyncLogProjection_();
  assert.equal(projection.truncated, true, 'sanity check: the sheet as a whole really is larger than the window');

  const result = sandbox.resolveWorkType_(TASK_ID, []);
  assert.equal(result.unresolved, false, 'the run\'s true start is genuinely visible (a differing-status row precedes it) — window truncation elsewhere in the sheet must not manufacture ambiguity here');
  assert.equal(result.classification, 'Review Fix');
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
