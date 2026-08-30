import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

const TASK_ID = '3cafbd82-6f3b-8158-9622-d795b43d1f03';

function dateProp(iso) {
  return iso ? { type: 'date', date: { start: iso } } : { type: 'date', date: null };
}

function textProp(value) {
  return { type: 'rich_text', rich_text: value ? [{ plain_text: value }] : [] };
}

function eventPage(id, { startedAt, endedAt, note = '' }) {
  return {
    id,
    properties: {
      'Started At': dateProp(startedAt),
      'Ended At': dateProp(endedAt),
      Note: textProp(note),
    },
  };
}

function taskPage({ startedAt, result, completedAt }) {
  return {
    id: TASK_ID,
    properties: {
      Result: textProp(result),
      'Completed At': dateProp(completedAt),
      'Started At': dateProp(startedAt),
    },
  };
}

function harnessWithNotionStub() {
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-notion-token' },
    fetch() {
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    },
  });
}

test('Done is rejected when only a past execution left a closed Time Event', () => {
  const { sandbox, fetchLog } = harnessWithNotionStub();
  // The Task was reopened and restarted at 03:00, but per README "Known
  // limitations" the restart's own In Progress spell was never observed by a
  // poll, so no new event opened for this execution. The only closed event on
  // file is from the *previous*, already-completed run.
  const task = taskPage({
    startedAt: '2026-08-29T03:00:00.000Z',
    result: 'shipped',
    completedAt: '2026-08-29T04:00:00.000Z',
  });
  const staleEvent = eventPage('evt-old-execution', {
    startedAt: '2026-08-28T10:00:00.000Z',
    endedAt: '2026-08-28T11:00:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [staleEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /missing_applicable_time_event/);
  // Rejecting Done must also roll the Task back rather than leaving Done set.
  assert.equal(fetchLog.length, 1);
  const rollbackBody = JSON.parse(fetchLog[0].options.payload);
  assert.equal(rollbackBody.properties.Status.status.name, 'Review');
});

test('Done passes with a closed Time Event that belongs to the current execution', () => {
  const { sandbox, fetchLog } = harnessWithNotionStub();
  const task = taskPage({
    startedAt: '2026-08-29T03:00:00.000Z',
    result: 'shipped',
    completedAt: '2026-08-29T04:00:00.000Z',
  });
  const currentEvent = eventPage('evt-current-execution', {
    startedAt: '2026-08-29T03:00:00.000Z',
    endedAt: '2026-08-29T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [currentEvent], []);

  assert.equal(outcome, 'done_gate_passed:stamped');
  // The only mutation on the passing path is stamping the applicable event
  // with a fingerprint of the validated Result, for future reopen detection.
  assert.equal(fetchLog.length, 1);
  const stampBody = JSON.parse(fetchLog[0].options.payload);
  assert.match(stampBody.properties.Note.rich_text[0].text.content, /Result Fingerprint=/);
});

test('Done is rejected when Result was never refreshed after a reopen (reused from a prior execution)', () => {
  const { sandbox } = harnessWithNotionStub();
  const resultText = 'shipped v1';
  const priorFingerprint = sandbox.resultFingerprint_(resultText);
  const task = taskPage({
    startedAt: '2026-08-30T03:00:00.000Z',
    result: resultText, // unchanged since the prior execution validated it
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const priorEvent = eventPage('evt-prior-execution', {
    startedAt: '2026-08-28T10:00:00.000Z',
    endedAt: '2026-08-28T11:00:00.000Z',
    note: 'Result Fingerprint=' + priorFingerprint, // stamped when Done passed for the prior execution
  });
  const currentEvent = eventPage('evt-current-execution', {
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: '2026-08-30T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [priorEvent, currentEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /stale_result/);
});

test('Done is rejected on reopen even when the reused Result is not the LAST fingerprint the prior event recorded', () => {
  const { sandbox } = harnessWithNotionStub();
  // The prior execution's Result was edited more than once while the Task
  // stayed Done on that one event (each edit adds its own stamp rather than
  // replacing the last) — 'shipped v1' first, then 'shipped v1.1'. A reopen
  // that reuses the EARLIER of the two must still be caught, even though it
  // is not the most recent stamp on that event's Note.
  const v1Fingerprint = sandbox.resultFingerprint_('shipped v1');
  const v1_1Fingerprint = sandbox.resultFingerprint_('shipped v1.1');
  const task = taskPage({
    startedAt: '2026-08-30T03:00:00.000Z',
    result: 'shipped v1', // reused: identical to the prior execution's FIRST validated value, not its last
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const priorEvent = eventPage('evt-prior-execution', {
    startedAt: '2026-08-28T10:00:00.000Z',
    endedAt: '2026-08-28T11:00:00.000Z',
    note: 'Result Fingerprint=' + v1Fingerprint + ' | Result Fingerprint=' + v1_1Fingerprint,
  });
  const currentEvent = eventPage('evt-current-execution', {
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: '2026-08-30T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [priorEvent, currentEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /stale_result/);
});

test('Done passes when Result was refreshed for the new execution', () => {
  const { sandbox } = harnessWithNotionStub();
  const priorFingerprint = sandbox.resultFingerprint_('shipped v1');
  const task = taskPage({
    startedAt: '2026-08-30T03:00:00.000Z',
    result: 'shipped v2', // refreshed for this execution
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const priorEvent = eventPage('evt-prior-execution', {
    startedAt: '2026-08-28T10:00:00.000Z',
    endedAt: '2026-08-28T11:00:00.000Z',
    note: 'Result Fingerprint=' + priorFingerprint,
  });
  const currentEvent = eventPage('evt-current-execution', {
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: '2026-08-30T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [priorEvent, currentEvent], []);

  assert.equal(outcome, 'done_gate_passed:stamped');
});

test('re-verifying an already-validated, unchanged Done Task does not falsely flag stale Result or write again', () => {
  const { sandbox, fetchLog } = harnessWithNotionStub();
  const task = taskPage({
    startedAt: '2026-08-30T03:00:00.000Z',
    result: 'shipped',
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const currentEvent = eventPage('evt-current-execution', {
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: '2026-08-30T03:45:00.000Z',
  });

  const first = sandbox.enforceDoneGate_(task, [currentEvent], []);
  assert.equal(first, 'done_gate_passed:stamped');
  assert.equal(fetchLog.length, 1); // the stamp write

  // Simulate the stamp having landed on the event (as the real PATCH would),
  // then re-verify — Done is always re-verified (reconcileTaskPage_), so
  // this must recur without incident on every subsequent poll.
  currentEvent.properties.Note = textProp('Result Fingerprint=' + sandbox.resultFingerprint_('shipped'));
  const second = sandbox.enforceDoneGate_(task, [currentEvent], []);

  assert.equal(second, 'done_gate_passed');
  assert.equal(fetchLog.length, 1); // no additional write: the stamp already matched
});

test('Done is rejected with an open Time Event even if a current-execution closed one also exists', () => {
  const { sandbox, fetchLog } = harnessWithNotionStub();
  const task = taskPage({
    startedAt: '2026-08-29T03:00:00.000Z',
    result: 'shipped',
    completedAt: '2026-08-29T04:00:00.000Z',
  });
  const currentClosed = eventPage('evt-closed', {
    startedAt: '2026-08-29T03:00:00.000Z',
    endedAt: '2026-08-29T03:20:00.000Z',
  });
  const stillOpen = eventPage('evt-open', { startedAt: '2026-08-29T03:20:00.000Z', endedAt: null });

  const outcome = sandbox.enforceDoneGate_(task, [currentClosed, stillOpen], [stillOpen]);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /open_time_event/);
  const rollbackBody = JSON.parse(fetchLog[0].options.payload);
  assert.equal(rollbackBody.properties.Status.status.name, 'In Progress');
});

test('Done is rejected when the Task has never recorded a Started At', () => {
  const { sandbox } = harnessWithNotionStub();
  const task = taskPage({ startedAt: null, result: 'shipped', completedAt: '2026-08-29T04:00:00.000Z' });
  const someEvent = eventPage('evt-x', { startedAt: '2026-08-28T10:00:00.000Z', endedAt: '2026-08-28T11:00:00.000Z' });

  const outcome = sandbox.enforceDoneGate_(task, [someEvent], []);

  assert.match(outcome, /missing_task_started_at/);
});

test('Done is rejected when Started At was never refreshed after a reopen, even though a later event exists', () => {
  const { sandbox } = harnessWithNotionStub();
  // The Task completed once (oldEvent, ended Aug 28 11:00). Reopened, but
  // the actor never updated Started At — it still shows the OLD value from
  // the prior execution. A new event nonetheless opened later (e.g. at the
  // observed edit time, per the opening-logic fallback for an untrustworthy
  // Started At) and has since closed with a fresh Completed At — but
  // Started At itself was never refreshed to mark this as a genuinely new,
  // governance-compliant execution, so no event can be reliably attributed
  // to "the current execution" using it.
  const task = taskPage({
    startedAt: '2026-08-28T10:00:00.000Z', // stale: identical to the PRIOR execution's own start
    result: 'shipped again',
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const oldEvent = eventPage('evt-old-execution', {
    startedAt: '2026-08-28T10:00:00.000Z',
    endedAt: '2026-08-28T11:00:00.000Z',
  });
  const newEvent = eventPage('evt-new-execution', {
    startedAt: '2026-08-30T03:00:00.000Z', // opened later than Started At, but not governance-marked as "current"
    endedAt: '2026-08-30T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [oldEvent, newEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /stale_task_started_at/);
});

test('Done passes when Started At was properly refreshed for the new execution', () => {
  const { sandbox } = harnessWithNotionStub();
  const task = taskPage({
    startedAt: '2026-08-30T03:00:00.000Z', // freshly recorded, after the prior execution's own close
    result: 'shipped again',
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const oldEvent = eventPage('evt-old-execution', {
    startedAt: '2026-08-28T10:00:00.000Z',
    endedAt: '2026-08-28T11:00:00.000Z',
  });
  const newEvent = eventPage('evt-new-execution', {
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: '2026-08-30T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [oldEvent, newEvent], []);

  assert.equal(outcome, 'done_gate_passed:stamped');
});

test('Done passes when the current execution produced two closed events via an in-progress reassignment', () => {
  const { sandbox } = harnessWithNotionStub();
  // Actor A works the Task, then it is reassigned to Actor B mid-execution:
  // reconcileAuthoritativeTimeEvents_ closes A's event and opens B's at the
  // identical timestamp (03:20), so they touch with zero gap. Both belong to
  // this one execution and must not count as "prior evidence" against the
  // Task's own (correctly fresh) Started At.
  const task = taskPage({
    startedAt: '2026-08-29T03:00:00.000Z',
    result: 'shipped',
    completedAt: '2026-08-29T04:00:00.000Z',
  });
  const actorAEvent = eventPage('evt-actor-a', {
    startedAt: '2026-08-29T03:00:00.000Z',
    endedAt: '2026-08-29T03:20:00.000Z', // closed by the reassignment
    note: 'Reason=reassignment', // exactly what closeNotionTimeEvent_ stamps for this cleanup
  });
  const actorBEvent = eventPage('evt-actor-b', {
    startedAt: '2026-08-29T03:20:00.000Z', // opened at the exact moment A's closed
    endedAt: '2026-08-29T03:45:00.000Z', // closed later, e.g. by the move to Review
  });

  const outcome = sandbox.enforceDoneGate_(task, [actorAEvent, actorBEvent], []);

  assert.equal(outcome, 'done_gate_passed:stamped');
});

test('Done is rejected when a genuinely prior execution\'s closing event coincidentally touches the new one\'s Started At', () => {
  const { sandbox } = harnessWithNotionStub();
  // A real prior, separate execution closed via 'left_in_progress' (the
  // Task actually left In Progress there) whose Ended At happens to
  // coincide exactly with the new execution's Started At — e.g. both land
  // in the same Notion minute. Timestamp adjacency alone must not treat
  // this as a same-execution reassignment: 'left_in_progress' is exactly
  // the boundary a genuinely separate execution looks like. The Task's own
  // Started At was never actually refreshed for this "new" execution here
  // (it's identical to the prior one's own start), so it must still be
  // caught as stale.
  const task = taskPage({
    startedAt: '2026-08-28T10:00:00.000Z', // stale: unchanged since the OLD execution
    result: 'shipped again',
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const priorEvent = eventPage('evt-prior-execution', {
    startedAt: '2026-08-28T10:00:00.000Z',
    endedAt: '2026-08-30T03:00:00.000Z', // coincidentally touches newEvent's Started At below
    note: 'Reason=left_in_progress',
  });
  const newEvent = eventPage('evt-new-execution', {
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: '2026-08-30T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [priorEvent, newEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /stale_task_started_at/);
});

test('Done passes when an assignment was cleared and only later reassigned, leaving a real gap between events', () => {
  const { sandbox } = harnessWithNotionStub();
  // Actor A works the Task, the assignment is cleared while still In
  // Progress (closing A's event via 'reassignment' per
  // reconcileAuthoritativeTimeEvents_'s otherActor cleanup, with no
  // replacement opened since desiredActor is empty), and only later is
  // Actor B assigned — opening a new event at THAT later moment, not
  // touching A's own Ended At. This is still one unbroken execution (the
  // Task never left In Progress), so the gap must not make A look like
  // prior-execution evidence against the Task's own (correctly fresh)
  // Started At.
  const task = taskPage({
    startedAt: '2026-08-29T03:00:00.000Z',
    result: 'shipped',
    completedAt: '2026-08-29T05:00:00.000Z',
  });
  const actorAEvent = eventPage('evt-actor-a', {
    startedAt: '2026-08-29T03:00:00.000Z',
    endedAt: '2026-08-29T03:20:00.000Z', // closed when the assignment was cleared
    note: 'Reason=reassignment',
  });
  const actorBEvent = eventPage('evt-actor-b', {
    startedAt: '2026-08-29T04:00:00.000Z', // opened much later — a real gap, not touching A's Ended At
    endedAt: '2026-08-29T04:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [actorAEvent, actorBEvent], []);

  assert.equal(outcome, 'done_gate_passed:stamped');
});

test('Done is still rejected for a genuinely prior execution even when the current one has two chained events', () => {
  const { sandbox } = harnessWithNotionStub();
  // A real prior, separate execution (oldEvent) sits before a reassignment
  // pair (actorAEvent -> actorBEvent) that belongs to the current one. The
  // chain-walk must stop at the gap between oldEvent and actorAEvent rather
  // than treating oldEvent as part of the current execution too.
  const task = taskPage({
    startedAt: '2026-08-28T10:00:00.000Z', // stale: unchanged since the OLD execution
    result: 'shipped again',
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const oldEvent = eventPage('evt-old-execution', {
    startedAt: '2026-08-28T10:00:00.000Z',
    endedAt: '2026-08-28T11:00:00.000Z',
  });
  const actorAEvent = eventPage('evt-actor-a', {
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: '2026-08-30T03:20:00.000Z',
    note: 'Reason=reassignment',
  });
  const actorBEvent = eventPage('evt-actor-b', {
    startedAt: '2026-08-30T03:20:00.000Z',
    endedAt: '2026-08-30T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [oldEvent, actorAEvent, actorBEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /stale_task_started_at/);
});

test('Done passes when a duplicate open event was closed mid-execution, even though its Ended At does not touch the surviving event', () => {
  const { sandbox } = harnessWithNotionStub();
  // reconcileAuthoritativeTimeEvents_'s duplicate_reconciliation cleanup
  // closes a stray second open event for the same actor at whatever moment
  // the reconciler happens to notice it — not at the surviving event's own
  // Started At, so the exact-adjacency chain-walk alone would not link it to
  // the current execution. It must still not count as prior-execution
  // evidence: it is Reason=duplicate_reconciliation, an artifact of THIS
  // execution, not a separate earlier one.
  const task = taskPage({
    startedAt: '2026-08-29T03:00:00.000Z', // correctly fresh for this execution
    result: 'shipped',
    completedAt: '2026-08-29T04:00:00.000Z',
  });
  const duplicateEvent = eventPage('evt-duplicate', {
    startedAt: '2026-08-29T03:00:00.000Z',
    // Closed well after the surviving event opened, and its Ended At does
    // NOT match any other event's Started At — no adjacency to chain from.
    endedAt: '2026-08-29T03:30:00.000Z',
    note: 'Reason=duplicate_reconciliation',
  });
  const survivingEvent = eventPage('evt-surviving', {
    startedAt: '2026-08-29T03:00:00.000Z',
    endedAt: '2026-08-29T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [duplicateEvent, survivingEvent], []);

  assert.equal(outcome, 'done_gate_passed:stamped');
});

test('Done is rejected when Completed At predates the current execution entirely (stale from a prior completion)', () => {
  const { sandbox } = harnessWithNotionStub();
  const task = taskPage({
    startedAt: '2026-08-29T03:00:00.000Z',
    result: 'shipped',
    // Left over from the Task's previous, already-finished execution;
    // Notion does not clear this on reopen.
    completedAt: '2026-08-28T04:00:00.000Z',
  });
  const currentEvent = eventPage('evt-current-execution', {
    startedAt: '2026-08-29T03:00:00.000Z',
    endedAt: '2026-08-29T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [currentEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /stale_completed_at/);
});

test('Done is rejected when Completed At was recorded before the applicable interval actually closed', () => {
  const { sandbox } = harnessWithNotionStub();
  const task = taskPage({
    startedAt: '2026-08-29T03:00:00.000Z',
    result: 'shipped',
    // After Started At, but before the event's own Ended At (03:45) — the
    // completion post-flight could not genuinely have happened yet.
    completedAt: '2026-08-29T03:30:00.000Z',
  });
  const currentEvent = eventPage('evt-current-execution', {
    startedAt: '2026-08-29T03:00:00.000Z',
    endedAt: '2026-08-29T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [currentEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /stale_completed_at/);
});

test('Done passes when Completed At follows both Started At and the applicable event Ended At', () => {
  const { sandbox } = harnessWithNotionStub();
  const task = taskPage({
    startedAt: '2026-08-29T03:00:00.000Z',
    result: 'shipped',
    completedAt: '2026-08-29T03:50:00.000Z', // after Ended At (03:45)
  });
  const currentEvent = eventPage('evt-current-execution', {
    startedAt: '2026-08-29T03:00:00.000Z',
    endedAt: '2026-08-29T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [currentEvent], []);

  assert.equal(outcome, 'done_gate_passed:stamped');
});

test('appendNote_ never truncates the freshly written marker, dropping old history instead', () => {
  const { sandbox } = harnessWithNotionStub();
  const longExistingNote = 'Old=' + 'x'.repeat(1790); // already right at the 1800-char limit
  const marker = 'Result Fingerprint=' + sandbox.resultFingerprint_('shipped');

  const combined = sandbox.appendNote_(longExistingNote, marker, 1800);

  assert.ok(combined.length <= 1800, 'combined note must respect the 1800-char limit');
  assert.ok(combined.endsWith(marker), 'the marker just written must survive intact, not be clipped');
  assert.equal(sandbox.parseNoteMeta_(combined).resultFingerprint, sandbox.resultFingerprint_('shipped'));
});

test('appendNote_ fits the marker alone even when it alone exceeds maxLength budget after the existing note', () => {
  const { sandbox } = harnessWithNotionStub();
  const existingNote = 'Reason=left_in_progress | Snapshot=abc123';
  const marker = 'Result Fingerprint=' + sandbox.resultFingerprint_('shipped');

  // A maxLength barely larger than the marker itself forces every existing
  // segment to be dropped.
  const combined = sandbox.appendNote_(existingNote, marker, marker.length + 2);

  assert.equal(combined, marker);
});

test('appendNote_ evicts non-fingerprint segments before ever touching an older Result Fingerprint', () => {
  const { sandbox } = harnessWithNotionStub();
  const oldFingerprint = 'Result Fingerprint=' + sandbox.resultFingerprint_('shipped v1');
  // The older fingerprint stamp is the OLDEST segment (would be the first
  // dropped by a naive "oldest segment first" rule), with a long,
  // easily-droppable non-fingerprint segment recorded more recently. When
  // space is needed for the newly written marker, the non-fingerprint
  // segment must go first regardless of recency — stale-Result detection
  // needs every fingerprint an event ever recorded to survive as long as
  // possible.
  const existingNote = oldFingerprint + ' | Snapshot=' + 'x'.repeat(1700);
  const newMarker = 'Result Fingerprint=' + sandbox.resultFingerprint_('shipped v2');

  const combined = sandbox.appendNote_(existingNote, newMarker, 1800);

  assert.ok(combined.length <= 1800);
  assert.ok(combined.indexOf(oldFingerprint) >= 0, 'the older fingerprint must survive the eviction');
  assert.ok(combined.endsWith(newMarker), 'the freshly written marker must survive intact');
  assert.equal(combined.indexOf('Snapshot='), -1, 'the non-fingerprint segment should have been dropped instead');
});

test('Done passes when multiple events close simultaneously on first observing the Task leaving In Progress', () => {
  const { sandbox } = harnessWithNotionStub();
  // A Task with two open events (e.g. an unresolved duplicate) is first
  // observed after leaving In Progress: reconcileAuthoritativeTimeEvents_
  // closes ALL of them at the identical `when`, with Reason=left_in_progress.
  // Both are equally "now" and must both count as current-execution
  // evidence — picking only one arbitrarily would leave its identically
  // recent sibling looking like a separate, prior execution.
  const task = taskPage({
    startedAt: '2026-08-29T03:00:00.000Z',
    result: 'shipped',
    completedAt: '2026-08-29T04:00:00.000Z',
  });
  const eventA = eventPage('evt-a', {
    startedAt: '2026-08-29T03:00:00.000Z',
    endedAt: '2026-08-29T03:45:00.000Z',
    note: 'Reason=left_in_progress',
  });
  const eventB = eventPage('evt-b', {
    startedAt: '2026-08-29T03:00:00.000Z',
    endedAt: '2026-08-29T03:45:00.000Z', // identical Ended At — simultaneously closed
    note: 'Reason=left_in_progress',
  });

  const outcome = sandbox.enforceDoneGate_(task, [eventA, eventB], []);

  assert.equal(outcome, 'done_gate_passed:stamped');
});

test('Done is rejected when a reassignment-only execution is retroactively marked as an execution boundary', () => {
  const { sandbox } = harnessWithNotionStub();
  // A past execution's only recorded artifact is a reassignment close (the
  // assignee was cleared, and the Task then left In Progress with nothing
  // open — reconcileAuthoritativeTimeEvents_'s no-open-events branch
  // retroactively stamps Boundary=left_in_progress onto it, since its own
  // Reason=reassignment never signals an execution end on its own). A
  // reopen whose Task-level Started At was never actually refreshed (still
  // pointing at the old execution) must still be caught as stale, even
  // though the historical event's Reason alone would normally count as
  // current-execution evidence.
  const task = taskPage({
    startedAt: '2026-08-28T10:00:00.000Z', // stale: unchanged since the OLD execution
    result: 'shipped again',
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const priorEvent = eventPage('evt-prior-execution', {
    startedAt: '2026-08-28T10:00:00.000Z',
    endedAt: '2026-08-28T11:00:00.000Z',
    note: 'Reason=reassignment | Boundary=left_in_progress',
  });
  const newEvent = eventPage('evt-new-execution', {
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: '2026-08-30T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [priorEvent, newEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /stale_task_started_at/);
});

test('Done passes when a reassignment-only execution is NOT boundary-marked (still genuinely current)', () => {
  const { sandbox } = harnessWithNotionStub();
  // Sanity check for the previous test: without the retroactive Boundary
  // marker (e.g. because the Task never actually left In Progress — an
  // in-progress reassignment gap, not a real execution end), the same
  // reassignment-reason event must still count as current-execution
  // evidence, exactly as before this fix.
  const task = taskPage({
    startedAt: '2026-08-30T03:00:00.000Z', // correctly fresh
    result: 'shipped',
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const gappedEvent = eventPage('evt-gapped', {
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: '2026-08-30T03:20:00.000Z',
    note: 'Reason=reassignment', // no Boundary marker
  });
  const seedEvent = eventPage('evt-seed', {
    startedAt: '2026-08-30T03:40:00.000Z', // a real gap from gappedEvent's Ended At
    endedAt: '2026-08-30T03:45:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [gappedEvent, seedEvent], []);

  assert.equal(outcome, 'done_gate_passed:stamped');
});

test('Done is rejected when a prior execution boundary event ties the current close on Ended At', () => {
  const { sandbox } = harnessWithNotionStub();
  // Codex-reported gap in the seed-set fix above: last_edited_time is
  // minute-granular (see README Known limitations), so a genuinely PRIOR
  // execution's own retroactively-marked boundary close and the CURRENT
  // execution's fresh close can coincidentally land on the exact same
  // recorded Ended At — not just a true simultaneous multi-event close
  // (the case the tie-seed rule exists for). The tie-seed loop must not
  // sweep an explicitly Boundary=left_in_progress-marked event into the
  // current-execution seed just because it ties on timestamp: doing so
  // drops it from priorTimestamp entirely, letting a stale, never-
  // refreshed Task Started At slip through undetected.
  const task = taskPage({
    startedAt: '2026-08-28T10:00:00.000Z', // stale: unchanged since the OLD execution
    result: 'shipped again',
    completedAt: '2026-08-30T04:00:00.000Z',
  });
  const tiedEndedAt = '2026-08-30T04:00:00.000Z';
  const priorBoundaryEvent = eventPage('evt-prior-boundary', {
    startedAt: '2026-08-28T10:00:00.000Z',
    endedAt: tiedEndedAt, // coincidentally identical to the new event's Ended At
    note: 'Reason=reassignment | Boundary=left_in_progress',
  });
  const newEvent = eventPage('evt-new-execution', {
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: tiedEndedAt,
  });

  const outcome = sandbox.enforceDoneGate_(task, [priorBoundaryEvent, newEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /stale_task_started_at/);
});
