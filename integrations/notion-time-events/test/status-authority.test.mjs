import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

const TASK_ID = 'status-authority-regression-task';

function dateProp(iso) {
  return iso ? { type: 'date', date: { start: iso } } : { type: 'date', date: null };
}

function textProp(value) {
  return { type: 'rich_text', rich_text: value ? [{ plain_text: value }] : [] };
}

function selectProp(value) {
  return { type: 'select', select: value ? { name: value } : null };
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

function doneTask({ startedAt = null, result = 'completed', completedAt = '2026-09-10T10:00:00.000Z', closedAt = '2026-09-10T10:00:00.000Z', closureReason = 'Done' } = {}) {
  return {
    id: TASK_ID,
    properties: {
      Result: textProp(result),
      'Completed At': dateProp(completedAt),
      'Closed At': dateProp(closedAt),
      'Started At': dateProp(startedAt),
      'Closure Reason': selectProp(closureReason),
    },
  };
}

function harness() {
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-notion-token' },
    fetch() {
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    },
  });
}

test('authoritative Done closure is preserved when Started At is missing', () => {
  const { sandbox, fetchLog } = harness();
  const task = doneTask({ startedAt: null });

  const outcome = sandbox.enforceDoneGate_(task, [], []);

  assert.equal(outcome, 'done_gate_warning:telemetry_gap:missing_task_started_at');
  assert.equal(fetchLog.length, 0, 'telemetry gaps must not mutate authoritative Task Status');
});

test('authoritative Done closure is preserved when only a stale execution event exists', () => {
  const { sandbox, fetchLog } = harness();
  const task = doneTask({
    startedAt: '2026-09-10T09:00:00.000Z',
    completedAt: '2026-09-10T10:00:00.000Z',
    closedAt: '2026-09-10T10:00:00.000Z',
  });
  const staleEvent = eventPage('old-event', {
    startedAt: '2026-09-09T09:00:00.000Z',
    endedAt: '2026-09-09T10:00:00.000Z',
  });

  const outcome = sandbox.enforceDoneGate_(task, [staleEvent], []);

  assert.match(outcome, /^done_gate_warning:telemetry_gap:/);
  assert.match(outcome, /missing_applicable_time_event|stale_task_started_at/);
  assert.equal(fetchLog.length, 0);
});

test('missing Result remains a hard completion failure', () => {
  const { sandbox, fetchLog } = harness();
  const task = doneTask({ result: '' });

  const outcome = sandbox.enforceDoneGate_(task, [], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /missing_result/);
  assert.equal(fetchLog.length, 1);
  const rollbackBody = JSON.parse(fetchLog[0].options.payload);
  assert.equal(rollbackBody.properties.Status.select.name, 'Review');
});

test('an open Time Event remains a hard completion failure', () => {
  const { sandbox, fetchLog } = harness();
  const task = doneTask({ startedAt: '2026-09-10T09:00:00.000Z' });
  const openEvent = eventPage('open-event', {
    startedAt: '2026-09-10T09:00:00.000Z',
    endedAt: null,
  });

  const outcome = sandbox.enforceDoneGate_(task, [openEvent], [openEvent]);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /open_time_event/);
  assert.equal(fetchLog.length, 1);
  const rollbackBody = JSON.parse(fetchLog[0].options.payload);
  assert.equal(rollbackBody.properties.Status.select.name, 'In Progress');
});

test('non-Done stale-completion promotion stays strict', () => {
  const { sandbox, fetchLog } = harness();
  const task = doneTask({ startedAt: null });

  const result = sandbox.reconcileStaleCompletionEvidence_(task, [], []);

  assert.equal(result.promoted, false);
  assert.match(result.outcome, /^stale_completion_evidence_unresolved:/);
  assert.equal(fetchLog.length, 0);
});
