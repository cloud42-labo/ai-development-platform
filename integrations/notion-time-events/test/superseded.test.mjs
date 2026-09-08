import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, notionFetchStub } from './support/gas-sandbox.mjs';

// ADP-052-T05: Status=Superseded is a terminal outcome distinct from Done —
// it must stop timing (close any open Time Event) without ever routing
// through enforceDoneGate_'s completion evidence checks or its rollback.
// See Code.gs's enforceSupersededLifecycle_ and its call site's comment.

const TASKS_DS = 'fc5e770f-c68e-4799-afe7-ec4bff0dab59';
const EVENTS_DS = '544b9a17-2653-47aa-b62c-bb52425b3bf2';
const TASKS_QUERY = 'POST /v1/data_sources/' + TASKS_DS + '/query';
const EVENTS_QUERY = 'POST /v1/data_sources/' + EVENTS_DS + '/query';

function dateProp(iso) {
  return iso ? { type: 'date', date: { start: iso } } : { type: 'date', date: null };
}

function taskPage(id, { status, agent = null, lastEdited, startedAt = null, closedAt = null, title = 'T', type = null }) {
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
      'Started At': dateProp(startedAt),
      'Closed At': dateProp(closedAt),
      Result: { type: 'rich_text', rich_text: [] },
      'Completed At': { type: 'date', date: null },
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

function harness({ tasks = [], events = [], scriptProperties = {} } = {}) {
  const routes = {
    [TASKS_QUERY]: () => ({ results: tasks, has_more: false }),
    [EVENTS_QUERY]: () => ({ results: events, has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', ...scriptProperties },
    fetch: notionFetchStub(routes),
  });
}

function requestsTo(fetchLog, method, pathFragment) {
  return fetchLog.filter(
    (entry) =>
      String((entry.options && entry.options.method) || 'get').toUpperCase() === method &&
      entry.url.includes(pathFragment)
  );
}

test('a Superseded Task with an open event closes it at Closed At, not the poll\'s own edit time', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Superseded',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', // when this poll actually observes it
      startedAt: '2026-08-30T05:10:00.000Z',
      closedAt: '2026-08-30T06:00:00.000Z', // when it was actually superseded
    })],
    events: [
      eventPage('evt-claude', { actor: 'Claude', startedAt: '2026-08-30T05:10:00.000Z' }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^closed_superseded:evt-claude$/);
  const closes = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-claude');
  assert.equal(closes.length, 1);
  const body = JSON.parse(closes[0].options.payload);
  // Closed At, not last_edited_time.
  assert.equal(body.properties['Ended At'].date.start, '2026-08-30T06:00:00.000Z');
  const note = body.properties.Note.rich_text[0].text.content;
  assert.match(note, /Reason=task_superseded_split/);
  assert.match(note, /End Status=Superseded/);
});

test('a Superseded Task with multiple open events closes all of them', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Superseded',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
      closedAt: '2026-08-30T06:00:00.000Z',
    })],
    events: [
      eventPage('evt-claude', { actor: 'Claude', startedAt: '2026-08-30T05:10:00.000Z' }),
      eventPage('evt-chris', { actor: 'Chris', startedAt: '2026-08-30T05:20:00.000Z' }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /closed_superseded:evt-claude/);
  assert.match(summary.outcomes[0], /closed_superseded:evt-chris/);
  assert.equal(requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-').length, 2);
});

test('a Superseded Task observed before Closed At has been written falls back to the poll\'s edit time, same as an ordinary Review/Blocked close', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Superseded',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
      closedAt: null, // race: Status flipped before Closed At was recorded
    })],
    events: [
      eventPage('evt-claude', { actor: 'Claude', startedAt: '2026-08-30T05:10:00.000Z' }),
    ],
  });

  sandbox.pollTaskChanges();

  const closes = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-claude');
  const body = JSON.parse(closes[0].options.payload);
  assert.equal(body.properties['Ended At'].date.start, '2026-08-30T09:00:00.000Z');
});

test('a Superseded Task with nothing open makes no Notion mutation and is a free outcome', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Superseded',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
      closedAt: '2026-08-30T06:00:00.000Z',
    })],
    events: [],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'superseded_no_open_events');
  assert.equal(requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-').length, 0);
  assert.equal(sandbox.isFreeOutcome_('superseded_no_open_events'), true);
  assert.equal(sandbox.isFreeOutcome_('closed_superseded:evt-1'), false);
});

test('Superseded never routes through the Done gate: no rollback write, no completion-evidence checks, even with Result/Completed At missing', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    // No Result, no Completed At — would reject Done outright — but this
    // Task is Superseded, not Done, so none of that evidence should matter.
    tasks: [taskPage(taskId, {
      status: 'Superseded',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
      closedAt: '2026-08-30T06:00:00.000Z',
    })],
    events: [
      eventPage('evt-claude', { actor: 'Claude', startedAt: '2026-08-30T05:10:00.000Z' }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.doesNotMatch(summary.outcomes[0], /done_gate_rejected/);
  // The only write is the event close — no Status patch (a Done-gate
  // rollback would PATCH the Task page itself via updateTaskStatus_).
  assert.equal(requestsTo(fetchLog, 'PATCH', '/v1/pages/' + taskId).length, 0);
});

test('Superseded preserves prior Execution=/Task Origin= evidence already on the closed event, adding no Split-From inheritance of its own', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Superseded',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
      closedAt: '2026-08-30T06:00:00.000Z',
    })],
    events: [
      eventPage('evt-claude', {
        actor: 'Claude',
        startedAt: '2026-08-30T05:10:00.000Z',
        note: 'Execution=2026-08-30T05:10:00.000Z | Task Origin=Technical Task',
      }),
    ],
  });

  sandbox.pollTaskChanges();

  const closes = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-claude');
  const note = JSON.parse(closes[0].options.payload).properties.Note.rich_text[0].text.content;
  assert.match(note, /Execution=2026-08-30T05:10:00\.000Z/);
  assert.match(note, /Task Origin=Technical Task/);
  assert.match(note, /Reason=task_superseded_split/);
});

test('a Story reaching Superseded is still excluded the same way as any other Story Status (BUG-ADP-TTE-01), not routed through enforceSupersededLifecycle_', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    // See the equivalent In-Progress-Story archive test in poll.test.mjs for
    // why this flag is required for archiving (rather than skipping pending
    // the provenance backfill) to be the outcome here.
    scriptProperties: { TASK_ORIGIN_BACKFILL_COMPLETE: 'true' },
    tasks: [taskPage(taskId, {
      status: 'Superseded',
      lastEdited: '2026-08-30T09:00:00.000Z',
      type: 'Story',
    })],
    events: [
      eventPage('evt-stray', { actor: 'Claude', startedAt: '2026-08-30T05:10:00.000Z' }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  // reconcileStoryTask_'s own archive path (Reason=story_excluded), not a
  // task_superseded_split close — a Story never reaches
  // enforceSupersededLifecycle_ at all (see reconcileTaskPage_'s routing).
  assert.equal(summary.outcomes[0], 'archived_story_event:evt-stray');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-stray');
  assert.equal(patches.length, 1);
  const payload = JSON.parse(patches[0].options.payload);
  assert.equal(payload.archived, true); // archived, not closed
  assert.equal(payload.properties['Ended At'], undefined);
  const note = payload.properties.Note.rich_text[0].text.content;
  assert.match(note, /Reason=story_excluded/);
  assert.doesNotMatch(note, /task_superseded_split/);
});
