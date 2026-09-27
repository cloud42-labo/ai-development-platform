import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, fetchStub } from './support/gas-sandbox.mjs';

const SCRIPT_PROPS = {
  NOTION_TOKEN: 'test-notion-token',
  GITHUB_TOKEN: 'test-github-token',
  TASKS_DATA_SOURCE_ID: 'tasks-ds',
};

test('queryCreatedTasksForRange_ filters on the built-in Created (created_time) property, not a custom date property', () => {
  let capturedFilter;
  const routes = {
    'POST /v1/data_sources/tasks-ds/query': (body) => {
      capturedFilter = body.filter;
      return { results: [], has_more: false };
    },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  sandbox.queryCreatedTasksForRange_('2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

  const clauses = capturedFilter.and;
  assert.ok(clauses.every((c) => c.property === 'Created' && c.created_time));
  assert.deepEqual(clauses.map((c) => Object.keys(c.created_time)[0]).sort(), ['before', 'on_or_after']);
});

test('queryClosedTasksForRange_ filters on the custom Closed At date property, with no Status restriction', () => {
  let capturedFilter;
  const routes = {
    'POST /v1/data_sources/tasks-ds/query': (body) => {
      capturedFilter = body.filter;
      return { results: [], has_more: false };
    },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  sandbox.queryClosedTasksForRange_('2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

  const clauses = capturedFilter.and;
  assert.ok(clauses.every((c) => c.property === 'Closed At' && c.date));
  assert.ok(!clauses.some((c) => c.property === 'Status'), 'Task Close is unconditional on Status per Framework §3.1');
});

test('queryCurrentWipTasks_ matches Ready/In Progress/Review/Blocked only — excludes Backlog and terminal states', () => {
  let capturedFilter;
  const routes = {
    'POST /v1/data_sources/tasks-ds/query': (body) => {
      capturedFilter = body.filter;
      return { results: [], has_more: false };
    },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  sandbox.queryCurrentWipTasks_();

  const statuses = capturedFilter.or.map((c) => c.select.equals);
  assert.deepEqual(statuses.sort(), ['Blocked', 'In Progress', 'Ready', 'Review'].sort());
});

function task(type) {
  return { properties: { Type: { type: 'select', select: type ? { name: type } : null } } };
}

test('aggregateTaskFlow_ computes net, close/create ratio, WIP, and Type breakdown', () => {
  const created = [task('Technical Task'), task('Technical Task'), task('Bug'), task(null)];
  const closed = [task('Technical Task'), task('Bug')];
  const wip = [{}, {}, {}];

  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const result = sandbox.aggregateTaskFlow_(created, closed, wip);

  assert.equal(result.createdCount, 4);
  assert.equal(result.closedCount, 2);
  assert.equal(result.net, 2);
  assert.equal(result.closeCreateRatioPercent, sandbox.percentage_(2, 4));
  assert.equal(result.wipCount, 3);
  // Compared field-by-field rather than with assert.deepEqual: these objects
  // are constructed inside the vm sandbox, whose Object.prototype is not
  // reference-equal to this test file's realm, which trips strict deepEqual
  // even when every enumerable value matches (same pattern as the existing
  // aggregate-tasks.test.mjs suite).
  assert.equal(result.byTypeCreated['Technical Task'], 2);
  assert.equal(result.byTypeCreated.Bug, 1);
  assert.equal(result.byTypeCreated['Unknown/未分類'], 1);
  assert.equal(result.byTypeClosed['Technical Task'], 1);
  assert.equal(result.byTypeClosed.Bug, 1);
  assert.equal(result.byTypeClosed['Unknown/未分類'], undefined);
});

test('aggregateTaskFlow_ returns null ratio when nothing was created (no division by zero)', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const result = sandbox.aggregateTaskFlow_([], [], []);
  assert.equal(result.createdCount, 0);
  assert.equal(result.closeCreateRatioPercent, null);
});
