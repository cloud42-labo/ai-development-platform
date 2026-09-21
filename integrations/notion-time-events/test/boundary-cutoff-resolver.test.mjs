// ADP-051-B4: regression tests for the isolated boundary-candidate / cutoff
// / tie-order pure resolver — docs/review-fix-state-model.md §3 step 1
// (boundary candidate), §3 step 2 (Sync Log scan cutoff) and §4 (evidence
// priority & timestamp-tie resolution).
//
// These functions were extracted from PR #50 (ADP-051-B2/B3), which
// reached the 9-round review hard cap and was Split (docs/regulations/
// R06-project-management-regulation.md §11) before two findings from round
// 9 could be fixed. Round 1-8 findings (A-O) are ported here as regression
// tests against the same failure-matrix rows PR #50 already covered for
// these specific functions; the two open round-9 findings are fixed here
// and each gets its own named test below ("Finding P4-1" / "Finding
// P4-2"). Sync Log I/O (ADP-051-B5), churn inheritance (ADP-051-B6) and
// wiring into the live poll path (ADP-051-B7) are out of scope — nothing
// here is called from the live poll path yet.
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
// (last-occurrence-wins, per noteField_/parseNoteMeta_).
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

function syncLogRow({ type = 'Task', receivedAt, write = '' } = {}) {
  return { type: type, receivedAt: new Date(receivedAt), write: write };
}

// ---------------------------------------------------------------------------
// isExecutionBoundary_
// ---------------------------------------------------------------------------

test('isExecutionBoundary_: Reason=left_in_progress is a boundary', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.isExecutionBoundary_({ reason: 'left_in_progress', boundary: '' }), true);
});

test('isExecutionBoundary_: retroactively-stamped Boundary=left_in_progress is a boundary even with a different Reason', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.isExecutionBoundary_({ reason: 'reassignment', boundary: 'left_in_progress' }), true);
});

test('isExecutionBoundary_: neither Reason nor Boundary marking left_in_progress is not a boundary', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.isExecutionBoundary_({ reason: 'reassignment', boundary: '' }), false);
});

// ---------------------------------------------------------------------------
// compareInstants_ (docs/review-fix-state-model.md §4)
// ---------------------------------------------------------------------------

test('failure #9: two same-minute candidates are ordered by Write=, never left at a naive tie', () => {
  const { sandbox } = harness();
  const a = { timestamp: new Date('2026-08-01T08:00:00.000Z'), write: '1000' };
  const b = { timestamp: new Date('2026-08-01T08:00:30.000Z'), write: '2000' };
  assert.equal(sandbox.compareInstants_(a, b), -1);
  assert.equal(sandbox.compareInstants_(b, a), 1);
});

test('failure #10: a genuine simultaneous tie (identical minute AND identical Write=) is a true, unbiased tie', () => {
  const { sandbox } = harness();
  const a = { timestamp: new Date('2026-08-01T08:00:00.000Z'), write: '1000' };
  const b = { timestamp: new Date('2026-08-01T08:00:30.000Z'), write: '1000' };
  assert.equal(sandbox.compareInstants_(a, b), 0);
});

test('failure #38/#41: a real difference in Notion minute always wins, regardless of Write=', () => {
  const { sandbox } = harness();
  const earlier = { timestamp: new Date('2026-08-01T08:00:00.000Z'), write: '999999' };
  const later = { timestamp: new Date('2026-08-01T08:01:00.000Z'), write: '1' };
  assert.equal(sandbox.compareInstants_(earlier, later), -1);
  assert.equal(sandbox.compareInstants_(later, earlier), 1);
});

test('minute-tie with Write= missing on one or both sides is an unresolved tie (0), never guessed', () => {
  const { sandbox } = harness();
  const withWrite = { timestamp: new Date('2026-08-01T08:00:00.000Z'), write: '1000' };
  const withoutWrite = { timestamp: new Date('2026-08-01T08:00:30.000Z'), write: '' };
  assert.equal(sandbox.compareInstants_(withWrite, withoutWrite), 0);
  assert.equal(sandbox.compareInstants_(withoutWrite, withWrite), 0);
  const bothMissing = { timestamp: new Date('2026-08-01T08:00:45.000Z'), write: '' };
  assert.equal(sandbox.compareInstants_(withoutWrite, bothMissing), 0);
});

// ---------------------------------------------------------------------------
// compareWriteOnly_ (docs/review-fix-state-model.md §3 step 3)
// ---------------------------------------------------------------------------

test('compareWriteOnly_: orders strictly by Write=, ignoring Notion minute entirely', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.compareWriteOnly_('2000', '1000'), 1);
  assert.equal(sandbox.compareWriteOnly_('1000', '2000'), -1);
  assert.equal(sandbox.compareWriteOnly_('1000', '1000'), 0);
});

test('compareWriteOnly_: returns null (not a false/0 answer) when either side has no Write=', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.compareWriteOnly_('', '1000'), null);
  assert.equal(sandbox.compareWriteOnly_('1000', ''), null);
  assert.equal(sandbox.compareWriteOnly_('', ''), null);
});

// ---------------------------------------------------------------------------
// mostRecentBoundaryCandidate_ (docs/review-fix-state-model.md §3 step 1, §4)
// ---------------------------------------------------------------------------

test('mostRecentBoundaryCandidate_: no boundary-tagged event at all returns null', () => {
  const { sandbox } = harness();
  const events = [eventPage('e1', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=reassignment') })];
  assert.equal(sandbox.mostRecentBoundaryCandidate_(events), null);
});

test('mostRecentBoundaryCandidate_: a single genuine boundary is returned directly', () => {
  const { sandbox } = harness();
  const events = [eventPage('e1', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000') })];
  const result = sandbox.mostRecentBoundaryCandidate_(events);
  assert.equal(result.kind, 'genuine');
  assert.equal(result.endStatus, 'Review');
});

test('failure #18: a genuine fresh boundary outranks a stale, older boundary', () => {
  const { sandbox } = harness();
  const events = [
    eventPage('stale', { endedAt: '2026-01-01T00:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Backlog') }),
    eventPage('fresh', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review') }),
  ];
  const result = sandbox.mostRecentBoundaryCandidate_(events);
  assert.equal(result.event.id, 'fresh');
});

test('Finding M: two boundary candidates tied at the same Notion minute with DIFFERING End Status= and no Write= surface conflictingTie, never an arbitrary pick', () => {
  const { sandbox } = harness();
  const events = [
    eventPage('a', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review') }),
    eventPage('b', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=left_in_progress', 'End Status=Backlog') }),
  ];
  assert.equal(sandbox.mostRecentBoundaryCandidate_(events).conflictingTie, true);
  // Query order must not matter.
  assert.equal(sandbox.mostRecentBoundaryCandidate_(events.slice().reverse()).conflictingTie, true);
});

test('Finding M companion (no false positive): two candidates tied at the same minute with the SAME End Status= still classify normally', () => {
  const { sandbox } = harness();
  const events = [
    eventPage('a', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review') }),
    eventPage('b', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=left_in_progress', 'End Status=Review') }),
  ];
  const result = sandbox.mostRecentBoundaryCandidate_(events);
  assert.equal(result.conflictingTie, undefined);
  assert.equal(result.endStatus, 'Review');
});

test('Finding M no-regression: Write= still breaks an otherwise-tied GENUINE/GENUINE pair with differing End Status=', () => {
  const { sandbox } = harness();
  const events = [
    eventPage('a', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000') }),
    eventPage('b', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=left_in_progress', 'End Status=Backlog', 'Write=2000') }),
  ];
  const result = sandbox.mostRecentBoundaryCandidate_(events);
  assert.equal(result.conflictingTie, undefined);
  assert.equal(result.event.id, 'b');
  assert.equal(result.endStatus, 'Backlog');
});

test('Finding N: a GENUINE boundary tied with a RETROACTIVE boundary at the same minute — SAME End Status=, no Write= — still surfaces conflictingTie', () => {
  const { sandbox } = harness();
  const events = [
    eventPage('genuine', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review') }),
    eventPage('retro', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=reassignment', 'Boundary=left_in_progress', 'End Status=Review') }),
  ];
  assert.equal(sandbox.mostRecentBoundaryCandidate_(events).conflictingTie, true);
});

test('Finding N companion (no false positive): two candidates of the SAME kind and SAME End Status= tied at the same minute still classify normally', () => {
  const { sandbox } = harness();
  const events = [
    eventPage('retro-a', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=reassignment', 'Boundary=left_in_progress', 'End Status=Review') }),
    eventPage('retro-b', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=duplicate_reconciliation', 'Boundary=left_in_progress', 'End Status=Review') }),
  ];
  const result = sandbox.mostRecentBoundaryCandidate_(events);
  assert.equal(result.conflictingTie, undefined);
});

test('Finding P4-2 (ADP-051-B4 round 9, item 2): a RETROACTIVE candidate tied at the same Notion minute against a GENUINE candidate, with DIFFERING (non-equal, both present) Write=, still surfaces conflictingTie — a retroactive Write= is a discovery-time stamp, not real event-time evidence, so compareInstants_ resolving the pair is not proof of a real order', () => {
  const { sandbox } = harness();
  const events = [
    eventPage('genuine', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000') }),
    eventPage('retro', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=reassignment', 'Boundary=left_in_progress', 'End Status=Backlog', 'Write=999999') }),
  ];
  // Without the P4-2 fix, compareInstants_ would confidently rank `retro`
  // above `genuine` (same Notion minute, Write=999999 > Write=1000) and
  // mostRecentBoundaryCandidate_ would never even reach the conflict
  // check, since it only ran when compareInstants_ returned an unbroken
  // tie (0).
  assert.equal(sandbox.mostRecentBoundaryCandidate_(events).conflictingTie, true);
  assert.equal(sandbox.mostRecentBoundaryCandidate_(events.slice().reverse()).conflictingTie, true);
});

test('Finding P4-2 (no-regression check): a genuine minute DIFFERENCE (not a same-minute tie) between a genuine and a retroactive candidate still resolves normally — the fix only affects same-minute pairs', () => {
  const { sandbox } = harness();
  const events = [
    eventPage('genuine', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000') }),
    eventPage('retro', { endedAt: '2026-08-01T09:00:00.000Z', note: note('Reason=reassignment', 'Boundary=left_in_progress', 'End Status=Backlog', 'Write=999999') }),
  ];
  const result = sandbox.mostRecentBoundaryCandidate_(events);
  assert.equal(result.conflictingTie, undefined);
  assert.equal(result.event.id, 'retro');
});

test('Finding P4-2 companion (no false positive): a RETROACTIVE candidate tied at the same minute against a GENUINE candidate with DIFFERING Write= but the SAME End Status= and kind-irrelevant agreement still classifies normally when kind matches', () => {
  const { sandbox } = harness();
  // Two RETROACTIVE candidates (same kind), same End Status=, differing
  // Write= (both are discovery-time stamps from two separate
  // stampExecutionBoundary_ calls) — kind matches and End Status= matches,
  // so this must not be flagged even though Write= differs.
  const events = [
    eventPage('retro-a', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=reassignment', 'Boundary=left_in_progress', 'End Status=Review', 'Write=1000') }),
    eventPage('retro-b', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=duplicate_reconciliation', 'Boundary=left_in_progress', 'End Status=Review', 'Write=999999') }),
  ];
  const result = sandbox.mostRecentBoundaryCandidate_(events);
  assert.equal(result.conflictingTie, undefined);
  assert.equal(result.endStatus, 'Review');
});

// ---------------------------------------------------------------------------
// syncLogScanCutoff_ (docs/review-fix-state-model.md §3 step 2)
// ---------------------------------------------------------------------------

test('syncLogScanCutoff_: no Type=Story rows, no restart event, no override returns null', () => {
  const { sandbox } = harness();
  const rows = [syncLogRow({ type: 'Task', receivedAt: '2026-08-01T08:00:00.000Z' })];
  assert.equal(sandbox.syncLogScanCutoff_(rows, [], null), null);
});

test('syncLogScanCutoff_: the most recent Type=Story row wins among several', () => {
  const { sandbox } = harness();
  const rows = [
    syncLogRow({ type: 'Story', receivedAt: '2026-01-01T00:00:00.000Z' }),
    syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:00.000Z' }),
    syncLogRow({ type: 'Task', receivedAt: '2026-09-01T00:00:00.000Z' }),
  ];
  const cutoff = sandbox.syncLogScanCutoff_(rows, [], null);
  assert.equal(cutoff.timestamp.toISOString(), '2026-08-01T08:00:00.000Z');
});

test('failure #51: an ambiguous_provenance_restart close is a hard cutoff candidate too', () => {
  const { sandbox } = harness();
  const events = [eventPage('restart', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=ambiguous_provenance_restart', 'Write=1000') })];
  const cutoff = sandbox.syncLogScanCutoff_([], events, null);
  assert.equal(cutoff.timestamp.toISOString(), '2026-08-01T08:00:00.000Z');
});

test('syncLogScanCutoff_: an explicit restartCutoffOverride wins when it is the most recent candidate', () => {
  const { sandbox } = harness();
  const rows = [syncLogRow({ type: 'Story', receivedAt: '2026-01-01T00:00:00.000Z' })];
  const override = { timestamp: new Date('2026-08-01T08:00:00.000Z'), write: String(Date.now()) };
  const cutoff = sandbox.syncLogScanCutoff_(rows, [], override);
  assert.equal(cutoff, override);
});

test('Finding P4-1 (ADP-051-B4 round 9, item 1): two Type=Story rows tied at the same Notion minute with Write= missing on one side surface ambiguousCutoffTie, never a query-order pick', () => {
  const { sandbox } = harness();
  const rows = [
    syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:00.000Z', write: '1000' }),
    syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:30.000Z', write: '' }),
  ];
  assert.equal(sandbox.syncLogScanCutoff_(rows, [], null).ambiguousCutoffTie, true);
  assert.equal(sandbox.syncLogScanCutoff_(rows.slice().reverse(), [], null).ambiguousCutoffTie, true);
});

test('Finding P4-1: a Type=Story row tied at the same minute against an ambiguous_provenance_restart close, both missing Write=, surfaces ambiguousCutoffTie', () => {
  const { sandbox } = harness();
  const rows = [syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:00.000Z', write: '' })];
  const events = [eventPage('restart', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=ambiguous_provenance_restart') })];
  assert.equal(sandbox.syncLogScanCutoff_(rows, events, null).ambiguousCutoffTie, true);
});

test('Finding P4-1 companion (no false positive): two Type=Story rows at the same minute with EQUAL Write= are a genuine (non-ambiguous) tie, either serving as cutoff', () => {
  const { sandbox } = harness();
  const rows = [
    syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:00.000Z', write: '1000' }),
    syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:30.000Z', write: '1000' }),
  ];
  const cutoff = sandbox.syncLogScanCutoff_(rows, [], null);
  assert.equal(cutoff.ambiguousCutoffTie, undefined);
});

test('Finding P4-1 companion (no false positive): a Type=Story row clearly earlier than the restart cutoff does not create an ambiguous tie', () => {
  const { sandbox } = harness();
  const rows = [syncLogRow({ type: 'Story', receivedAt: '2026-01-01T00:00:00.000Z' })];
  const events = [eventPage('restart', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=ambiguous_provenance_restart', 'Write=1000') })];
  const cutoff = sandbox.syncLogScanCutoff_(rows, events, null);
  assert.equal(cutoff.ambiguousCutoffTie, undefined);
  assert.equal(cutoff.timestamp.toISOString(), '2026-08-01T08:00:00.000Z');
});

test('query order independence: syncLogScanCutoff_ returns the identical result regardless of Sync Log row array order', () => {
  const { sandbox } = harness();
  const rows = [
    syncLogRow({ type: 'Story', receivedAt: '2026-01-01T00:00:00.000Z', write: '1' }),
    syncLogRow({ type: 'Story', receivedAt: '2026-06-01T00:00:00.000Z', write: '2' }),
    syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:00.000Z', write: '3' }),
  ];
  const forward = sandbox.syncLogScanCutoff_(rows, [], null);
  const backward = sandbox.syncLogScanCutoff_(rows.slice().reverse(), [], null);
  assert.equal(forward.timestamp.toISOString(), backward.timestamp.toISOString());
  assert.equal(forward.write, backward.write);
});

test('query order independence: mostRecentBoundaryCandidate_ returns the identical result regardless of event array order (clear winner, no tie)', () => {
  const { sandbox } = harness();
  const events = [
    eventPage('stale', { endedAt: '2026-01-01T00:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Backlog') }),
    eventPage('fresh', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review') }),
    eventPage('mid', { endedAt: '2026-04-01T00:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Ready') }),
  ];
  const forward = sandbox.mostRecentBoundaryCandidate_(events);
  const backward = sandbox.mostRecentBoundaryCandidate_(events.slice().reverse());
  assert.equal(forward.event.id, 'fresh');
  assert.equal(backward.event.id, 'fresh');
});

test('Codex Review (PR #55): a harmless tie (same endStatus/kind, no conflictingTie) between one candidate WITH a Write= and one WITHOUT canonically prefers the one with Write=, regardless of query order — a future caller reading .write directly must not get a query-order-dependent answer', () => {
  const { sandbox } = harness();
  const withWrite = eventPage('with-write', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000') });
  const withoutWrite = eventPage('without-write', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=left_in_progress', 'End Status=Review') });

  const forward = sandbox.mostRecentBoundaryCandidate_([withWrite, withoutWrite]);
  const backward = sandbox.mostRecentBoundaryCandidate_([withoutWrite, withWrite]);
  assert.equal(forward.conflictingTie, undefined);
  assert.equal(backward.conflictingTie, undefined);
  assert.equal(forward.event.id, 'with-write');
  assert.equal(backward.event.id, 'with-write');
  assert.equal(forward.write, '1000');
  assert.equal(backward.write, '1000');
});

test('Codex Review (PR #55 follow-up): a harmless tie where BOTH candidates carry an equal Write= still canonicalizes to a fixed representative regardless of query order, since same-Notion-minute raw `Ended At` values need not be byte-identical', () => {
  const { sandbox } = harness();
  const earlier = eventPage('earlier', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000') });
  const later = eventPage('later', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000') });

  const forward = sandbox.mostRecentBoundaryCandidate_([earlier, later]);
  const backward = sandbox.mostRecentBoundaryCandidate_([later, earlier]);
  assert.equal(forward.conflictingTie, undefined);
  assert.equal(backward.conflictingTie, undefined);
  assert.equal(forward.event.id, backward.event.id);
  assert.equal(forward.endedAt.getTime(), backward.endedAt.getTime());
});

test('Codex Review (PR #55, second follow-up): two genuine boundaries sharing a Notion minute/endStatus/kind but with DIFFERENT present Write= values are NOT a harmless tie — compareInstants_ already ordered them, and the newer one (higher Write=) must win, not be discarded by the earliest-endedAt canonicalization', () => {
  const { sandbox } = harness();
  const older = eventPage('older', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=1000') });
  const newer = eventPage('newer', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=2000') });

  const forward = sandbox.mostRecentBoundaryCandidate_([older, newer]);
  const backward = sandbox.mostRecentBoundaryCandidate_([newer, older]);
  assert.equal(forward.conflictingTie, undefined);
  assert.equal(backward.conflictingTie, undefined);
  assert.equal(forward.event.id, 'newer');
  assert.equal(backward.event.id, 'newer');
  assert.equal(forward.write, '2000');
  assert.equal(backward.write, '2000');
});

test('Codex Review (PR #55 follow-up): a harmless tie where NEITHER candidate carries a Write= still canonicalizes to a fixed representative regardless of query order', () => {
  const { sandbox } = harness();
  const earlier = eventPage('earlier', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review') });
  const later = eventPage('later', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=left_in_progress', 'End Status=Review') });

  const forward = sandbox.mostRecentBoundaryCandidate_([earlier, later]);
  const backward = sandbox.mostRecentBoundaryCandidate_([later, earlier]);
  assert.equal(forward.conflictingTie, undefined);
  assert.equal(backward.conflictingTie, undefined);
  assert.equal(forward.event.id, backward.event.id);
  assert.equal(forward.endedAt.getTime(), backward.endedAt.getTime());
});

test('Codex Review (PR #55, redesign): a Write=-missing candidate must not act as a non-transitive bridge between two Write=-bearing candidates that are themselves definitively ordered — with three same-minute genuine candidates sharing endStatus/kind (Write=2000 at :00, no Write= at :15, Write=3000 at :30), the highest-Write candidate always wins, regardless of query order', () => {
  const { sandbox } = harness();
  const low = eventPage('low', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=2000') });
  const missing = eventPage('missing', { endedAt: '2026-08-01T08:00:15.000Z', note: note('Reason=left_in_progress', 'End Status=Review') });
  const high = eventPage('high', { endedAt: '2026-08-01T08:00:30.000Z', note: note('Reason=left_in_progress', 'End Status=Review', 'Write=3000') });

  const orderings = [
    [low, missing, high],
    [missing, high, low],
    [high, low, missing],
    [missing, low, high],
  ];
  orderings.forEach(function (events) {
    const result = sandbox.mostRecentBoundaryCandidate_(events);
    assert.equal(result.conflictingTie, undefined);
    assert.equal(result.event.id, 'high');
    assert.equal(result.write, '3000');
  });
});

test('Codex Review (PR #55, cutoff redesign): syncLogScanCutoff_ canonicalizes equal-present-Write= ties to the earliest raw timestamp, regardless of row order', () => {
  const { sandbox } = harness();
  const rows = [
    syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:00.000Z', write: '1000' }),
    syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:30.000Z', write: '1000' }),
  ];
  const forward = sandbox.syncLogScanCutoff_(rows, [], null);
  const backward = sandbox.syncLogScanCutoff_(rows.slice().reverse(), [], null);
  assert.equal(forward.ambiguousCutoffTie, undefined);
  assert.equal(backward.ambiguousCutoffTie, undefined);
  assert.equal(forward.timestamp.toISOString(), backward.timestamp.toISOString());
});

test('Codex Review (PR #55, cutoff redesign): a Write=-missing row at the same Notion minute as two definitively-ordered Write=-bearing rows correctly remains ambiguousCutoffTie in EVERY row order — the missing row genuinely cannot be proven earlier or later than the higher-Write row, so this is real ambiguity, not an order-dependent bridging artifact (a naive best-then-tie scan can make `best` land on any of the three depending on order; the redesign\'s undominated-set computation must reach the same ambiguous verdict regardless)', () => {
  const { sandbox } = harness();
  const low = syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:00.000Z', write: '1000' });
  const missing = syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:15.000Z', write: '' });
  const high = syncLogRow({ type: 'Story', receivedAt: '2026-08-01T08:00:30.000Z', write: '2000' });

  [
    [low, missing, high],
    [missing, high, low],
    [high, low, missing],
    [missing, low, high],
  ].forEach(function (rows) {
    const cutoff = sandbox.syncLogScanCutoff_(rows, [], null);
    assert.equal(cutoff.ambiguousCutoffTie, true);
  });
});

test('Codex Review (PR #55, round 5 / Owner-classified fix): two undominated candidates sharing a BYTE-IDENTICAL Ended At but different present Write= values (a genuine possibility for retroactive boundaries treated as tied by boundaryCompare_) are resolved by a stable final discriminator (event id), not by whichever the array happened to place first', () => {
  const { sandbox } = harness();
  // Both retroactive, same exact instant, same endStatus/kind (so no
  // conflictingTie) — boundaryCompare_ treats this same-minute
  // retroactive-involving pair as tied (0) regardless of differing Write=.
  const a = eventPage('evt-a-retro', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=reassignment', 'Boundary=left_in_progress', 'End Status=Review', 'Write=1000') });
  const b = eventPage('evt-b-retro', { endedAt: '2026-08-01T08:00:00.000Z', note: note('Reason=duplicate_reconciliation', 'Boundary=left_in_progress', 'End Status=Review', 'Write=2000') });

  const forward = sandbox.mostRecentBoundaryCandidate_([a, b]);
  const backward = sandbox.mostRecentBoundaryCandidate_([b, a]);
  assert.equal(forward.conflictingTie, undefined);
  assert.equal(backward.conflictingTie, undefined);
  assert.equal(forward.event.id, backward.event.id);
  assert.equal(forward.event.id, 'evt-a-retro');
});
