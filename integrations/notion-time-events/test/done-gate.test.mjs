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

function eventPage(id, { startedAt, endedAt }) {
  return {
    id,
    properties: {
      'Started At': dateProp(startedAt),
      'Ended At': dateProp(endedAt),
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

  assert.equal(outcome, 'done_gate_passed');
  assert.equal(fetchLog.length, 0); // no rollback mutation on the passing path
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

  assert.equal(outcome, 'done_gate_passed');
});
