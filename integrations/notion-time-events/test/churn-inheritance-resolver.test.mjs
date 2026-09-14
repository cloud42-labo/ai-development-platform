// ADP-051-B6: regression tests for the isolated churn inheritance /
// Execution identity continuity resolver — docs/review-fix-state-model.md
// §6.
//
// These functions were extracted from PR #50 (ADP-051-B2/B3), which
// reached the 9-round review hard cap and was Split (docs/regulations/
// R06-project-management-regulation.md §11). Round 1 (failure #6/#7),
// round 4 (Finding G, via churnCandidateExecutionMatches_) and round 8
// (Finding O) findings are ported here as regression tests against the
// same failure-matrix rows PR #50 already covered for these specific
// functions, adapted to call resolveChurnInheritedWorkType_,
// mostRecentlyClosedEvent_ and churnCandidateExecutionMatches_ directly
// rather than through resolveNewTimeEventWorkTypeSafely_ (that
// combining/wiring function is ADP-051-B7's scope — it also threads in
// resolveWorkType_'s ordinary §3 classification, which does not exist
// until B4+B5+B6 are assembled). Sync Log I/O is ADP-051-B5's; nothing
// here is called from the live poll path yet.
//
// This file depends on ADP-051-B4's isExecutionBoundary_/compareInstants_
// (resolveChurnInheritedWorkType_ and mostRecentlyClosedEvent_ both call
// them directly) — it is built on top of that branch rather than on a
// bare `main` that does not yet have them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

function dateProp(iso) {
  return iso ? { type: 'date', date: { start: iso } } : { type: 'date', date: null };
}

function textProp(value) {
  return { type: 'rich_text', rich_text: value ? [{ plain_text: value }] : [] };
}

function selectProp(value) {
  return { type: 'select', select: value ? { name: value } : null };
}

function note(...segments) {
  return segments.join(' | ');
}

function eventPage(id, { endedAt, note: noteText = '', workType } = {}) {
  const properties = {
    'Ended At': dateProp(endedAt),
    Note: textProp(noteText),
  };
  if (workType !== undefined) properties['Work Type'] = selectProp(workType);
  return { id, properties };
}

function harness() {
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-notion-token', SPREADSHEET_ID: 'test-sheet' },
    fetch() {
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    },
  });
}

// ---------------------------------------------------------------------------
// resolveChurnInheritedWorkType_ (docs/review-fix-state-model.md §6)
// ---------------------------------------------------------------------------

test('resolveChurnInheritedWorkType_: no outgoing event at all does not inherit', () => {
  const { sandbox } = harness();
  const result = sandbox.resolveChurnInheritedWorkType_(null);
  assert.equal(result.inherits, false);
  assert.equal(result.reasonCode, 'no_outgoing_event');
});

test('failure #6: churn inheritance recognizes a reassignment close regardless of which poll cleared the assignee vs which poll reassigned it', () => {
  const { sandbox } = harness();
  const outgoing = eventPage('evt-6', { endedAt: '2026-08-01T05:00:00.000Z', note: 'Reason=reassignment', workType: 'Review Fix' });
  const result = sandbox.resolveChurnInheritedWorkType_(outgoing);
  assert.equal(result.inherits, true);
  assert.equal(result.workType, 'Review Fix');
});

test('failure #7: a genuine execution-boundary close is never itself treated as an inheritable churn source', () => {
  const { sandbox } = harness();
  const pastGenuineClose = eventPage('evt-7', { endedAt: '2026-07-01T05:00:00.000Z', note: 'Reason=left_in_progress | End Status=Review', workType: 'Review Fix' });
  const result = sandbox.resolveChurnInheritedWorkType_(pastGenuineClose);
  assert.equal(result.inherits, false);
  assert.equal(result.reasonCode, 'outgoing_event_is_execution_boundary');
});

test('failure #26: an ambiguous_provenance_restart close is never treated as ordinary churn', () => {
  const { sandbox } = harness();
  const restart = eventPage('evt-26', { endedAt: '2026-08-01T05:00:00.000Z', note: 'Reason=ambiguous_provenance_restart', workType: 'Review Fix' });
  const result = sandbox.resolveChurnInheritedWorkType_(restart);
  assert.equal(result.inherits, false);
  assert.equal(result.reasonCode, 'ambiguous_provenance_restart_never_inherits');
});

test('failure #33: a legacy outgoing event with no Execution= marker at all still inherits via the Reason/Boundary legacy heuristic', () => {
  const { sandbox } = harness();
  const legacyOutgoing = eventPage('evt-33', { endedAt: '2026-08-01T05:00:00.000Z', note: 'Reason=duplicate_reconciliation', workType: 'Initial Work' });
  const result = sandbox.resolveChurnInheritedWorkType_(legacyOutgoing);
  assert.equal(result.inherits, true);
  assert.equal(result.workType, 'Initial Work');
});

test('failure #12: a Reason=reassignment close that ALSO carries a retroactive Boundary=left_in_progress still stops churn inheritance', () => {
  const { sandbox } = harness();
  const outgoing = eventPage('evt-12', { endedAt: '2026-08-01T05:00:00.000Z', note: 'Reason=reassignment | Boundary=left_in_progress', workType: 'Review Fix' });
  const result = sandbox.resolveChurnInheritedWorkType_(outgoing);
  assert.equal(result.inherits, false);
  assert.equal(result.reasonCode, 'outgoing_event_is_execution_boundary');
});

test('resolveChurnInheritedWorkType_: an event whose Reason is neither reassignment/duplicate_reconciliation nor a boundary/restart is not a churn close at all', () => {
  const { sandbox } = harness();
  const outgoing = eventPage('evt-other', { endedAt: '2026-08-01T05:00:00.000Z', note: 'Reason=story_conversion', workType: 'Review Fix' });
  const result = sandbox.resolveChurnInheritedWorkType_(outgoing);
  assert.equal(result.inherits, false);
  assert.equal(result.reasonCode, 'outgoing_event_not_a_churn_close');
});

test('resolveChurnInheritedWorkType_: options.closeReason overrides the stale in-memory Note for an event this same call just closed', () => {
  const { sandbox } = harness();
  // The in-memory object still shows no Reason= at all (pre-close state) —
  // closeNotionTimeEvent_ only ever PATCHes Notion, never mutates the
  // object it was given.
  const justClosed = eventPage('evt-just-closed', { endedAt: '2026-08-01T05:00:00.000Z', note: '', workType: '' });
  const result = sandbox.resolveChurnInheritedWorkType_(justClosed, { closeReason: 'reassignment' });
  assert.equal(result.inherits, true);
});

// ---------------------------------------------------------------------------
// churnCandidateExecutionMatches_ (docs/review-fix-state-model.md §6,
// Finding G, ADP-051-B2/B3 fixup round 4)
// ---------------------------------------------------------------------------

test('churnCandidateExecutionMatches_: no expectedExecutionId given (unverified caller identity) always matches', () => {
  const { sandbox } = harness();
  const outgoing = eventPage('evt-x', { endedAt: '2026-08-01T05:00:00.000Z', note: 'Reason=reassignment | Execution=2026-08-01T00:00:00.000Z' });
  assert.equal(sandbox.churnCandidateExecutionMatches_(outgoing, undefined), true);
  assert.equal(sandbox.churnCandidateExecutionMatches_(outgoing, ''), true);
});

test('Finding G: an outgoing event with an explicit Execution= that does NOT equal the expected identity is rejected outright', () => {
  const { sandbox } = harness();
  const outgoing = eventPage('evt-g-mismatch', { endedAt: '2026-08-01T05:00:00.000Z', note: 'Reason=reassignment | Execution=2026-08-01T00:00:00.000Z' });
  assert.equal(sandbox.churnCandidateExecutionMatches_(outgoing, '2026-09-01T00:00:00.000Z'), false);
});

test('churnCandidateExecutionMatches_: an outgoing event whose Execution= exactly equals the expected identity matches', () => {
  const { sandbox } = harness();
  const outgoing = eventPage('evt-match', { endedAt: '2026-08-01T05:00:00.000Z', note: 'Reason=reassignment | Execution=2026-08-01T00:00:00.000Z' });
  assert.equal(sandbox.churnCandidateExecutionMatches_(outgoing, '2026-08-01T00:00:00.000Z'), true);
});

test('failure #33 (identity gate variant): a legacy candidate with NO Execution= at all matches regardless of expectedExecutionId — no identity to check, so the legacy heuristic stands unguarded', () => {
  const { sandbox } = harness();
  const legacyOutgoing = eventPage('evt-legacy', { endedAt: '2026-08-01T05:00:00.000Z', note: 'Reason=duplicate_reconciliation' });
  assert.equal(sandbox.churnCandidateExecutionMatches_(legacyOutgoing, '2026-09-01T00:00:00.000Z'), true);
});

// ---------------------------------------------------------------------------
// mostRecentlyClosedEvent_ (docs/review-fix-state-model.md §6, Finding 1
// round 3, Finding O round 8)
// ---------------------------------------------------------------------------

test('mostRecentlyClosedEvent_: no closed event at all returns null', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.mostRecentlyClosedEvent_([]), null);
});

test('mostRecentlyClosedEvent_: the single most recently closed event wins, regardless of Reason', () => {
  const { sandbox } = harness();
  const events = [
    eventPage('older', { endedAt: '2026-01-01T00:00:00.000Z', note: note('Reason=reassignment') }),
    eventPage('newer', { endedAt: '2026-08-01T00:00:00.000Z', note: note('Reason=reassignment') }),
  ];
  assert.equal(sandbox.mostRecentlyClosedEvent_(events).id, 'newer');
});

test('Finding O: an ambiguous_provenance_restart close tied at the same Notion minute against an ordinary reassignment close (no Write= on either side) — the blocking candidate wins outright, never query order', () => {
  const { sandbox } = harness();
  const restartClose = eventPage('evt-o-restart', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=ambiguous_provenance_restart') });
  const reassignmentClose = eventPage('evt-o-reassignment', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=reassignment') });

  assert.equal(sandbox.mostRecentlyClosedEvent_([restartClose, reassignmentClose]).id, 'evt-o-restart');
  // Order independence — this ordering exposed the pre-fix bug: the
  // pre-fix `> 0`-only scan kept whichever candidate came first on an
  // unresolvable tie, so listing the reassignment first used to let it
  // silently win.
  assert.equal(sandbox.mostRecentlyClosedEvent_([reassignmentClose, restartClose]).id, 'evt-o-restart');
});

test('Finding O (execution-boundary variant): a genuine execution-boundary close (Reason=left_in_progress) tied at the same Notion minute against an ordinary reassignment close also wins — the blocking check covers isExecutionBoundary_, not only ambiguous_provenance_restart', () => {
  const { sandbox } = harness();
  const boundaryClose = eventPage('evt-o-boundary', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review') });
  const reassignmentClose = eventPage('evt-o-boundary-reassignment', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=reassignment') });

  assert.equal(sandbox.mostRecentlyClosedEvent_([boundaryClose, reassignmentClose]).id, 'evt-o-boundary');
  assert.equal(sandbox.mostRecentlyClosedEvent_([reassignmentClose, boundaryClose]).id, 'evt-o-boundary');
});

test('Finding O companion (no false positive): two ordinary reassignment closes tied at the same Notion minute (no Write=) — neither blocks, so whichever the tie-scan reaches stays picked, and both orderings agree since neither is a functional difference for a non-blocking tie', () => {
  const { sandbox } = harness();
  const reassignmentA = eventPage('evt-o-same-a', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=reassignment') });
  const reassignmentB = eventPage('evt-o-same-b', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=reassignment') });

  const forward = sandbox.mostRecentlyClosedEvent_([reassignmentA, reassignmentB]);
  const backward = sandbox.mostRecentlyClosedEvent_([reassignmentB, reassignmentA]);
  // Neither candidate blocks, so Finding O's new check must not fire —
  // resolveChurnInheritedWorkType_ would treat either winner identically
  // (both are ordinary reassignment closes eligible to inherit).
  assert.equal(sandbox.resolveChurnInheritedWorkType_(forward).inherits, true);
  assert.equal(sandbox.resolveChurnInheritedWorkType_(backward).inherits, true);
});

test('mostRecentlyClosedEvent_: a genuine minute difference (not a tie) always picks the later event even when it does not block', () => {
  const { sandbox } = harness();
  const boundaryClose = eventPage('evt-old-boundary', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review') });
  const laterReassignment = eventPage('evt-later-reassignment', { endedAt: '2026-08-01T09:00:00.000Z', note: note('Reason=reassignment') });
  assert.equal(sandbox.mostRecentlyClosedEvent_([boundaryClose, laterReassignment]).id, 'evt-later-reassignment');
});

// ---------------------------------------------------------------------------
// Codex Review (PR #57): identity-aware tiebreak for mostRecentlyClosedEvent_
// ---------------------------------------------------------------------------

test('Codex Review (PR #57): two non-blocking closes tied at the same Notion minute (no Write=) from DIFFERENT executions — the candidate whose Execution= actually matches the expected identity wins, regardless of query order', () => {
  const { sandbox } = harness();
  const wrongExecution = eventPage('evt-wrong-execution', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=reassignment', 'Execution=2026-01-01T00:00:00.000Z') });
  const rightExecution = eventPage('evt-right-execution', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=reassignment', 'Execution=2026-08-01T00:00:00.000Z') });
  const expected = '2026-08-01T00:00:00.000Z';

  assert.equal(sandbox.mostRecentlyClosedEvent_([wrongExecution, rightExecution], expected).id, 'evt-right-execution');
  // Order independence — without the fix, listing wrongExecution first let
  // it silently win the tie (the pre-fix `> 0`-only scan never looked past
  // the first candidate reached on an unresolvable tie).
  assert.equal(sandbox.mostRecentlyClosedEvent_([rightExecution, wrongExecution], expected).id, 'evt-right-execution');
});

test('Codex Review (PR #57) no-regression: with no expectedExecutionId given (caller identity unverified), the identity gate does not apply — same behavior as before the fix', () => {
  const { sandbox } = harness();
  const a = eventPage('evt-a', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=reassignment', 'Execution=2026-01-01T00:00:00.000Z') });
  const b = eventPage('evt-b', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=reassignment', 'Execution=2026-08-01T00:00:00.000Z') });
  assert.equal(sandbox.mostRecentlyClosedEvent_([a, b]).id, 'evt-a');
  assert.equal(sandbox.mostRecentlyClosedEvent_([b, a]).id, 'evt-b');
});

test('Codex Review (PR #57) no-regression: a blocking candidate still wins outright even when a tied non-blocking candidate matches the expected identity', () => {
  const { sandbox } = harness();
  const restartClose = eventPage('evt-restart', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=ambiguous_provenance_restart') });
  const matchingReassignment = eventPage('evt-matching-reassignment', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=reassignment', 'Execution=2026-08-01T00:00:00.000Z') });
  const expected = '2026-08-01T00:00:00.000Z';
  assert.equal(sandbox.mostRecentlyClosedEvent_([restartClose, matchingReassignment], expected).id, 'evt-restart');
  assert.equal(sandbox.mostRecentlyClosedEvent_([matchingReassignment, restartClose], expected).id, 'evt-restart');
});

test('Codex Review (PR #57) no-regression: when NEITHER tied candidate matches the expected identity, the identity gate does not swap anything (both remain equally ineligible downstream)', () => {
  const { sandbox } = harness();
  const a = eventPage('evt-neither-a', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=reassignment', 'Execution=2026-01-01T00:00:00.000Z') });
  const b = eventPage('evt-neither-b', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=reassignment', 'Execution=2026-02-01T00:00:00.000Z') });
  const expected = '2026-08-01T00:00:00.000Z';
  const forward = sandbox.mostRecentlyClosedEvent_([a, b], expected);
  const backward = sandbox.mostRecentlyClosedEvent_([b, a], expected);
  assert.equal(sandbox.churnCandidateExecutionMatches_(forward, expected), false);
  assert.equal(sandbox.churnCandidateExecutionMatches_(backward, expected), false);
});
