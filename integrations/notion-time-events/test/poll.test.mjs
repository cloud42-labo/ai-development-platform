import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, notionFetchStub } from './support/gas-sandbox.mjs';

const TASKS_DS = 'fc5e770f-c68e-4799-afe7-ec4bff0dab59';
const EVENTS_DS = '544b9a17-2653-47aa-b62c-bb52425b3bf2';
const TASKS_QUERY = 'POST /v1/data_sources/' + TASKS_DS + '/query';
const EVENTS_QUERY = 'POST /v1/data_sources/' + EVENTS_DS + '/query';

function taskPage(id, { status, agent, lastEdited, startedAt = null, title = 'T' }) {
  return {
    object: 'page',
    id,
    url: 'https://www.notion.so/' + id.replace(/-/g, ''),
    last_edited_time: lastEdited,
    last_edited_by: { object: 'user', id: 'user-1' },
    parent: { type: 'data_source_id', data_source_id: TASKS_DS },
    properties: {
      Title: { type: 'title', title: [{ plain_text: title }] },
      Status: { type: 'status', status: { name: status } },
      'Assigned Agent': { type: 'select', select: agent ? { name: agent } : null },
      'Started At': { type: 'date', date: startedAt ? { start: startedAt } : null },
      Result: { type: 'rich_text', rich_text: [] },
      'Completed At': { type: 'date', date: null },
    },
  };
}

function eventPage(id, { actor, startedAt, endedAt = null }) {
  return {
    object: 'page',
    id,
    properties: {
      Actor: { type: 'select', select: { name: actor } },
      'Started At': { type: 'date', date: { start: startedAt } },
      'Ended At': { type: 'date', date: endedAt ? { start: endedAt } : null },
      Note: { type: 'rich_text', rich_text: [] },
    },
  };
}

// A sandbox whose Notion stub answers with `tasks` for the Stories & Tasks
// query and `events` for the Task Time Events query, and accepts writes.
function harness({ tasks = [], events = [], scriptProperties = {}, lockHeld = false } = {}) {
  const routes = {
    [TASKS_QUERY]: () => ({ results: tasks, has_more: false }),
    [EVENTS_QUERY]: () => ({ results: events, has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', ...scriptProperties },
    lockHeld,
    fetch: notionFetchStub(routes),
  });
}

// Values returned by Code.gs are created inside the vm realm, so their
// prototypes differ from Node's and assert's deep comparison rejects them on
// reference identity. Round-tripping through JSON compares them by structure.
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

test('the first poll looks back an hour and filters on last_edited_time', () => {
  const { sandbox, fetchLog, scriptProps } = harness();

  const before = Date.now();
  const summary = sandbox.pollTaskChanges();

  assert.deepEqual(plain(summary.outcomes), []);
  const query = JSON.parse(requestsTo(fetchLog, 'POST', TASKS_DS)[0].options.payload);
  assert.equal(query.filter.timestamp, 'last_edited_time');
  assert.equal(query.sorts[0].direction, 'ascending');

  // Initial window is one hour plus the overlap, and never a bare `now`.
  const since = new Date(query.filter.last_edited_time.on_or_after).getTime();
  const expected = before - 60 * 60 * 1000 - 2 * 60 * 1000;
  assert.ok(Math.abs(since - expected) < 5000, 'unexpected initial lookback: ' + query.filter.last_edited_time.on_or_after);

  // A completed run advances the cursor so the next poll starts from here.
  assert.ok(new Date(scriptProps.get('LAST_SYNC_CURSOR')).getTime() >= before);
});

test('a stored cursor is re-read with the overlap applied', () => {
  const { sandbox, fetchLog } = harness({
    scriptProperties: { LAST_SYNC_CURSOR: '2026-08-30T05:00:00.000Z' },
  });

  sandbox.pollTaskChanges();

  const query = JSON.parse(requestsTo(fetchLog, 'POST', TASKS_DS)[0].options.payload);
  assert.equal(query.filter.last_edited_time.on_or_after, '2026-08-30T04:58:00.000Z');
});

test('an In Progress Task with no open event opens exactly one Time Event', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f03', {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T05:10:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
    })],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.processed, 1);
  assert.match(summary.outcomes[0], /^opened:/);
  const creates = requestsTo(fetchLog, 'POST', '/v1/pages');
  assert.equal(creates.length, 1);
  const created = JSON.parse(creates[0].options.payload);
  assert.equal(created.parent.data_source_id, EVENTS_DS);
  assert.equal(created.properties.Actor.select.name, 'Claude');
});

test('re-reading an unchanged Task in the overlap window makes no Notion mutation', () => {
  const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f03', {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T05:10:00.000Z',
    startedAt: '2026-08-30T05:10:00.000Z',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task] });

  sandbox.pollTaskChanges();
  const mutationsAfterFirst =
    requestsTo(fetchLog, 'POST', '/v1/pages').length + requestsTo(fetchLog, 'PATCH', '/v1/pages').length;

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^duplicate:/);
  const mutationsAfterSecond =
    requestsTo(fetchLog, 'POST', '/v1/pages').length + requestsTo(fetchLog, 'PATCH', '/v1/pages').length;
  assert.equal(mutationsAfterSecond, mutationsAfterFirst);
});

test('leaving In Progress closes every open event for the Task', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Review',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T06:00:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
    })],
    events: [
      eventPage('evt-claude', { actor: 'Claude', startedAt: '2026-08-30T05:10:00.000Z' }),
      eventPage('evt-chris', { actor: 'Chris', startedAt: '2026-08-30T05:20:00.000Z' }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /closed:evt-claude/);
  assert.match(summary.outcomes[0], /closed:evt-chris/);
  const closes = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-');
  assert.equal(closes.length, 2);
  closes.forEach((entry) => {
    assert.ok(JSON.parse(entry.options.payload).properties['Ended At'].date.start);
  });
});

test('a capped batch leaves the cursor on the last Task it actually reconciled', () => {
  const tasks = [];
  for (let i = 0; i < 30; i++) {
    tasks.push(taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f' + String(i).padStart(3, '0'), {
      status: 'Ready',
      agent: 'Human',
      lastEdited: '2026-08-30T05:' + String(i).padStart(2, '0') + ':00.000Z',
    }));
  }
  const { sandbox, scriptProps } = harness({ tasks });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.scanned, 30);
  assert.equal(summary.processed, 25);
  assert.equal(summary.capped, true);
  // Cursor must not jump past the 5 Tasks this run never touched.
  assert.equal(scriptProps.get('LAST_SYNC_CURSOR'), '2026-08-30T05:24:00.000Z');
});

test('a poll that is already running is skipped without advancing the cursor', () => {
  const { sandbox, fetchLog, scriptProps } = harness({
    lockHeld: true,
    scriptProperties: { LAST_SYNC_CURSOR: '2026-08-30T05:00:00.000Z' },
  });

  assert.deepEqual(plain(sandbox.pollTaskChanges()), { skipped: 'poll_already_running' });
  assert.equal(fetchLog.length, 0);
  assert.equal(scriptProps.get('LAST_SYNC_CURSOR'), '2026-08-30T05:00:00.000Z');
});

test('a page from another data source is ignored rather than reconciled', () => {
  const foreign = taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f03', {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T05:10:00.000Z',
  });
  foreign.parent.data_source_id = '00000000-0000-0000-0000-000000000000';
  const { sandbox, fetchLog } = harness({ tasks: [foreign] });

  const summary = sandbox.pollTaskChanges();

  assert.deepEqual(plain(summary.outcomes), ['ignored:not_configured_task']);
  assert.equal(requestsTo(fetchLog, 'POST', '/v1/pages').length, 0);
});

test('setup installs exactly one poll trigger and reinstalling does not duplicate it', () => {
  const { sandbox, triggers } = harness();

  sandbox.setup();
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].getHandlerFunction(), 'pollTaskChanges');
  assert.equal(triggers[0].minutes, 5);

  sandbox.installSyncTrigger();
  assert.equal(triggers.length, 1);
});

test('an out-of-range poll interval falls back to the default', () => {
  const { sandbox, triggers } = harness({ scriptProperties: { POLL_INTERVAL_MINUTES: '3' } });

  sandbox.installSyncTrigger();

  assert.equal(triggers[0].minutes, 5);
});
