// ADP-051-C: end-to-end wiring tests for
// resolveNewTimeEventReviewSourceSafely_ inside
// reconcileAuthoritativeTimeEvents_'s open-Task branch, exercised through
// the real pollTaskChanges/createNotionTimeEvent_ path (not the resolver
// functions directly — see test/review-source-resolver.test.mjs for those).
// Mirrors test/work-type-wiring.test.mjs's own structure and scope.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, notionFetchStub } from './support/gas-sandbox.mjs';

const TASKS_DS = 'fc5e770f-c68e-4799-afe7-ec4bff0dab59';
const EVENTS_DS = '544b9a17-2653-47aa-b62c-bb52425b3bf2';
const TASKS_QUERY = 'POST /v1/data_sources/' + TASKS_DS + '/query';
const EVENTS_QUERY = 'POST /v1/data_sources/' + EVENTS_DS + '/query';

function taskPage(id, { status, agent, lastEdited, startedAt = null, title = 'T', type = null, pullRequestUrl = null }) {
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
      'Pull Request': { type: 'url', url: pullRequestUrl },
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

function harness({ tasks = [], events = [], scriptProperties = {}, eventsByTaskId = null, githubFetch = null } = {}) {
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
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'test-gh-token', ...scriptProperties },
    fetch(url, options) {
      if (url.indexOf('https://api.github.com') === 0) {
        return (githubFetch || (() => ({ getResponseCode: () => 200, getContentText: () => '[]' })))(url, options);
      }
      return notionFetchStub(routes)(url, options);
    },
  });
}

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

function reviewJson(login, submittedAtIso) {
  return { user: { login }, submitted_at: submittedAtIso, state: 'COMMENTED' };
}

test('a freshly-opened Review Fix Time Event carries Review Source on the created Notion page when the resolver confidently classifies it', () => {
  const taskId = 'wiring-review-source-01';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
      pullRequestUrl: 'https://github.com/cloud42-labo/widgets/pull/42',
    })],
    events: [],
    githubFetch: () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify([reviewJson('chatgpt-codex-connector[bot]', '2026-08-30T08:30:00.000Z')]),
    }),
  });
  logRow(sandbox, { taskId, status: 'Review', receivedAt: '2026-08-30T08:00:00.000Z' });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Review Fix');
  assert.equal(created.properties['Review Source'].select.name, 'Codex');
});

test('Review Source is left unset (never a placeholder) when Work Type resolves to Initial Work', () => {
  const taskId = 'wiring-review-source-initial-work';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
      pullRequestUrl: 'https://github.com/cloud42-labo/widgets/pull/42',
    })],
    events: [],
  });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Initial Work');
  assert.equal(created.properties['Review Source'], undefined);
  assert.equal(requestsTo(fetchLog, 'GET', 'api.github.com').length, 0, 'expected no GitHub call at all for an Initial Work execution');
});

test('Review Source degrades to Other (a real, written classification — never a throw, never blocking creation) when the Task has no Pull Request URL', () => {
  const taskId = 'wiring-review-source-no-pr';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
      pullRequestUrl: null,
    })],
    events: [],
  });
  logRow(sandbox, { taskId, status: 'Review', receivedAt: '2026-08-30T08:00:00.000Z' });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Review Fix');
  assert.equal(created.properties['Review Source'].select.name, 'Other');
});

test('Review Source degrades to Other, never blocking Time Event creation, on a GitHub API failure', () => {
  const taskId = 'wiring-review-source-gh-failure';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
      pullRequestUrl: 'https://github.com/cloud42-labo/widgets/pull/42',
    })],
    events: [],
    githubFetch: () => ({ getResponseCode: () => 503, getContentText: () => 'unavailable' }),
  });
  logRow(sandbox, { taskId, status: 'Review', receivedAt: '2026-08-30T08:00:00.000Z' });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^opened:/, 'Time Event creation must proceed despite the GitHub API failing');
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Review Fix');
  assert.equal(created.properties['Review Source'].select.name, 'Other');
});

test('Review Source degrades to Other when GITHUB_TOKEN is not configured, never blocking Time Event creation or Work Type', () => {
  const taskId = 'wiring-review-source-no-token';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
      pullRequestUrl: 'https://github.com/cloud42-labo/widgets/pull/42',
    })],
    events: [],
    scriptProperties: { GITHUB_TOKEN: '' },
  });
  logRow(sandbox, { taskId, status: 'Review', receivedAt: '2026-08-30T08:00:00.000Z' });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Review Fix');
  assert.equal(created.properties['Review Source'].select.name, 'Other');
});

test('a resolver exception in Review Source resolution does not block Time Event creation, Work Type, or ordinary polling idempotency', () => {
  const taskId = 'wiring-review-source-resolver-throws';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
      pullRequestUrl: 'https://github.com/cloud42-labo/widgets/pull/42',
    })],
    events: [],
  });
  logRow(sandbox, { taskId, status: 'Review', receivedAt: '2026-08-30T08:00:00.000Z' });

  sandbox.classifyReviewSourceFromReviews_ = function () {
    throw new Error('simulated resolver crash');
  };

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Review Fix');
  assert.equal(created.properties['Review Source'], undefined);

  const second = sandbox.pollTaskChanges();
  assert.deepEqual(plain(second.outcomes), ['duplicate:' + taskId]);
  assert.equal(second.processed, 0, 'a duplicate must not consume the reconciliation budget');
});

test('a same-call reassignment churn replacement inherits Review Source end-to-end through the real close+open', () => {
  const taskId = 'wiring-review-source-churn-same-call';
  const outgoing = eventPage('evt-outgoing', {
    actor: 'Codex', startedAt: '2026-08-30T05:00:00.000Z',
  });
  outgoing.properties['Work Type'] = { type: 'select', select: { name: 'Review Fix' } };
  outgoing.properties['Review Source'] = { type: 'select', select: { name: 'Human' } };
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus', // reassigned to Claude
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T05:00:00.000Z', // unchanged Started At: same execution
      pullRequestUrl: 'https://github.com/cloud42-labo/widgets/pull/42',
    })],
    events: [outgoing],
  });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /closed_reassigned:evt-outgoing/);
  assert.match(summary.outcomes[0], /opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Review Fix');
  assert.equal(
    created.properties['Review Source'].select.name, 'Human',
    'expected the new Actor\'s replacement event to inherit the outgoing churn close\'s own Review Source, never re-resolved via a fresh GitHub call'
  );
  assert.equal(requestsTo(fetchLog, 'GET', 'api.github.com').length, 0, 'expected no GitHub call at all when Review Source is inherited via churn');
});

test('failure #1 (pagination) end-to-end: the true latest reviewer sits on a second GitHub Reviews API page', () => {
  const taskId = 'wiring-review-source-pagination';
  const firstPage = Array.from({ length: 100 }, (_, i) => reviewJson('human-' + i, '2026-08-30T08:0' + (i % 6) + ':00.000Z'));
  const secondPage = [reviewJson('claude[bot]', '2026-08-30T08:59:00.000Z')];
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z', startedAt: '2026-08-30T09:00:00.000Z',
      pullRequestUrl: 'https://github.com/cloud42-labo/widgets/pull/42',
    })],
    events: [],
    githubFetch: (url) => {
      const pageMatch = /[?&]page=(\d+)/.exec(url);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(page === 1 ? firstPage : secondPage) };
    },
  });
  logRow(sandbox, { taskId, status: 'Review', receivedAt: '2026-08-30T08:00:00.000Z' });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^opened:/);
  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  assert.equal(created.properties['Review Source'].select.name, 'Claude');
  assert.equal(requestsTo(fetchLog, 'GET', 'api.github.com').length, 2, 'expected pagination to walk both pages');
});
