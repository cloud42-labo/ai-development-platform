// ADP-051-B7: end-to-end wiring tests for resolveNewTimeEventWorkTypeSafely_
// inside reconcileAuthoritativeTimeEvents_'s open-Task branch, exercised
// through the real pollTaskChanges/createNotionTimeEvent_ path (not the
// resolver functions directly — see test/work-type-resolver.test.mjs for
// those). This file's job is narrower and specific to the wiring itself:
//
//   - a freshly-opened Time Event's created page actually carries a
//     `Work Type` property once the resolver confidently classifies it;
//   - an `unresolved` result leaves `Work Type` unset, not a placeholder;
//   - a resolver exception is non-blocking: Time Event creation, the Done
//     gate and ordinary polling idempotency must proceed exactly as before,
//     with only `Work Type` left unset (the Acceptance Criterion from
//     ADP-051-B7's own Task description);
//   - the poll-wide Sync Log projection loader (ADP-051-B5) is actually
//     threaded through reconcileTaskPage_/pollTaskChanges so multiple Tasks
//     in one run share one bulk Sync Log read, not one each;
//   - a same-call reassignment churn replacement inherits Work Type
//     end-to-end (through the real close + open in one reconciliation
//     call), not just at the pure-function level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, notionFetchStub } from './support/gas-sandbox.mjs';

const TASKS_DS = 'fc5e770f-c68e-4799-afe7-ec4bff0dab59';
const EVENTS_DS = '544b9a17-2653-47aa-b62c-bb52425b3bf2';
const TASKS_QUERY = 'POST /v1/data_sources/' + TASKS_DS + '/query';
const EVENTS_QUERY = 'POST /v1/data_sources/' + EVENTS_DS + '/query';

function taskPage(id, { status, agent, lastEdited, startedAt = null, title = 'T', type = null }) {
  return {
    object: 'page',
    id,
    url: 'https://www.notion.so/' + id.replace(/-/g, ''),
    last_edited_time: lastEdited,
    last_edited_by: { object: 'user', id: 'user-1' },
    parent: { type: 'data_source_id', data_source_id: TASKS_DS },
    properties: {
      Title: { type: 'title', title: [{ plain_text: title }] },
      Status: { type: 'select', select: { name: status } },
      'Assigned Agent': { type: 'select', select: agent ? { name: agent } : null },
      'Started At': { type: 'date', date: startedAt ? { start: startedAt } : null },
      Result: { type: 'rich_text', rich_text: [] },
      'Completed At': { type: 'date', date: null },
      'Closed At': { type: 'date', date: null },
      Type: { type: 'select', select: type ? { name: type } : null },
    },
  };
}

function eventPage(id, { actor, startedAt, endedAt = null, note = '' }) {
  return {
    object: 'page',
    id,
    properties: {
      Actor: { type: 'select', select: { name: actor } },
      'Started At': { type: 'date', date: { start: startedAt } },
      'Ended At': { type: 'date', date: endedAt ? { start: endedAt } : null },
      Note: { type: 'rich_text', rich_text: note ? [{ plain_text: note }] : [] },
    },
  };
}

function harness({ tasks = [], events = [], scriptProperties = {}, eventsByTaskId = null } = {}) {
  const routes = {
    [TASKS_QUERY]: () => ({ results: tasks, has_more: false }),
    [EVENTS_QUERY]: (body) => {
      if (eventsByTaskId) {
        const requestedTaskId = body && body.filter && body.filter.relation && body.filter.relation.contains;
        return { results: eventsByTaskId[requestedTaskId] || [], has_more: false };
      }
      return { results: events, has_more: false };
    },
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', ...scriptProperties },
    fetch: notionFetchStub(routes),
  });
}

// Values returned by Code.gs are created inside the vm realm, so their
// prototypes differ from Node's and assert's deep comparison rejects them
// on reference identity (same pattern as test/poll.test.mjs's own `plain`).
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function requestsTo(fetchLog, method, pathFragment) {
  return fetchLog.filter(
    (entry) =>
      String((entry.options && entry.options.method) || 'get').toUpperCase() === method &&
      entry.url.includes(pathFragment)
  );
}

function logRow(sandbox, { taskId, status, receivedAt, outcome = '', type = 'Task' }) {
  sandbox.logSnapshot_('snap-' + taskId + '-' + receivedAt, 'notion_poll', taskId, status, new Date(receivedAt), outcome, type);
}

test('a freshly-opened Time Event carries Work Type=Review Fix on the created Notion page when the resolver confidently classifies it', () => {
  const taskId = 'wiring-review-fix-01';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
    })],
    events: [],
  });
  logRow(sandbox, { taskId, status: 'Review', receivedAt: '2026-08-30T08:00:00.000Z' });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Review Fix');
});

test('a freshly-opened Time Event carries Work Type=Initial Work when there is no relevant boundary or Sync Log history at all', () => {
  const taskId = 'wiring-initial-work-01';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
    })],
    events: [],
  });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Initial Work');
});

test('an unresolved classification leaves Work Type unset on the created page — never a placeholder, and never blocks the create itself', () => {
  const taskId = 'wiring-unresolved-01';
  // A retroactively-stamped boundary (Reason=reassignment, later tagged
  // Boundary=left_in_progress) with no usable Sync Log evidence at all —
  // resolveWorkType_'s own §3 step 3 handling for this shape (failure #28).
  const retroactive = eventPage('evt-retro', {
    actor: 'Claude', startedAt: '2026-08-01T00:00:00.000Z', endedAt: '2026-08-01T05:00:00.000Z',
    note: 'End Status=In Progress | Reason=reassignment | Boundary=left_in_progress | Write=9999999999999',
  });
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
    })],
    events: [retroactive],
  });

  const summary = sandbox.pollTaskChanges();

  // Event creation must still happen exactly as before — the whole point
  // of the non-blocking wrapper.
  assert.match(summary.outcomes[0], /^opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'], undefined, 'expected Work Type to be left unset, not a placeholder value');
});

test('a resolver exception does not block Time Event creation, the Done gate, or ordinary polling idempotency — Work Type is simply left unset', () => {
  const taskId = 'wiring-resolver-throws-01';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
    })],
    events: [],
  });

  // Simulate a bug deep inside the resolver (e.g. a future regression in
  // one of the B4/B5/B6 helpers it composes) by making one of them throw.
  sandbox.mostRecentBoundaryCandidate_ = function () {
    throw new Error('simulated resolver crash');
  };

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^opened:/, 'expected Time Event creation to proceed despite the resolver throwing');
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'], undefined);

  // Idempotency: re-polling the identical, unchanged Task snapshot must
  // still dedup as a harmless free no-op (its usual `duplicate:` outcome),
  // exactly as it would with no resolver involved at all — the crash must
  // not have corrupted any persisted state (Sync Log row, Script
  // Properties cursor, hasProcessedSnapshot_'s own hash, ...) in a way that
  // forces a real re-reconciliation (e.g. a second Time Event) instead.
  const second = sandbox.pollTaskChanges();
  assert.deepEqual(plain(second.outcomes), ['duplicate:' + taskId]);
  assert.equal(second.processed, 0, 'a duplicate must not consume the reconciliation budget');
});

test('a same-call reassignment churn replacement inherits Work Type end-to-end through the real close+open', () => {
  const taskId = 'wiring-churn-same-call-01';
  const outgoing = eventPage('evt-outgoing', {
    actor: 'Codex', startedAt: '2026-08-30T05:00:00.000Z',
  });
  outgoing.properties['Work Type'] = { type: 'select', select: { name: 'Review Fix' } };
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus', // reassigned to Claude
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T05:00:00.000Z', // unchanged Started At: same execution
    })],
    events: [outgoing],
  });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /closed_reassigned:evt-outgoing/);
  assert.match(summary.outcomes[0], /opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(
    created.properties['Work Type'].select.name, 'Review Fix',
    'expected the new Actor\'s replacement event to inherit the outgoing churn close\'s own Work Type, never re-resolved via §3 fresh classification'
  );
});

test('the poll-wide Sync Log projection loader is shared across multiple Tasks reconciled in the same run — one bulk read, not one per Task', () => {
  const taskA = 'wiring-loader-a';
  const taskB = 'wiring-loader-b';
  const { sandbox, spreadsheet } = harness({
    tasks: [
      taskPage(taskA, { status: 'In Progress', agent: 'Claude Opus', lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z' }),
      taskPage(taskB, { status: 'In Progress', agent: 'Codex', lastEdited: '2026-08-30T09:01:00.000Z', startedAt: '2026-08-30T09:01:00.000Z' }),
    ],
    eventsByTaskId: { [taskA]: [], [taskB]: [] },
  });
  logRow(sandbox, { taskId: taskA, status: 'Review', receivedAt: '2026-08-30T08:00:00.000Z' });
  logRow(sandbox, { taskId: taskB, status: 'Blocked', receivedAt: '2026-08-30T08:00:00.000Z' });

  // The Sync Log sheet's plain getValuesCallCount also counts unrelated,
  // pre-existing single-row reads this run makes for other purposes
  // (hasProcessedSnapshot_'s dedup lookup, storyConversionHappenedWhileInProgress_'s
  // history check) — neither goes through loadSyncLogProjection_/the
  // poll-wide loader this test is actually about. Count only the full
  // 8-column PROJECTION reads (loadSyncLogProjection_'s own signature,
  // exactly like test/sync-log-projection.test.mjs's own Finding I test),
  // which is what ADP-051-B5's poll-wide loader is meant to bound to one.
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  let projectionReadCount = 0;
  const originalGetRange = syncLogSheet.getRange.bind(syncLogSheet);
  syncLogSheet.getRange = function (row, column, numRows, numColumns) {
    const range = originalGetRange(row, column, numRows, numColumns);
    if (row > 1 && column === 1 && numColumns === 8) {
      const originalGetValues = range.getValues.bind(range);
      range.getValues = function () {
        projectionReadCount++;
        return originalGetValues();
      };
    }
    return range;
  };

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes.filter((o) => /^opened:/.test(o)).length, 2);
  assert.equal(
    projectionReadCount, 1,
    'expected exactly ONE poll-wide Sync Log projection read shared by both Tasks\' Work Type resolution, not one per Task'
  );
});
