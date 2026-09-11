import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, fetchStub } from './support/gas-sandbox.mjs';

const SCRIPT_PROPS = {
  NOTION_TOKEN: 'test-notion-token',
  GITHUB_TOKEN: 'test-github-token',
  TASKS_DATA_SOURCE_ID: 'tasks-ds',
};

// Regression for a Codex finding on PR #48: the query used to filter by
// Type=Human Request (including Backlog), instead of the governed Actionable
// Human Queue definition in governance/ai-execution-constraints.md
// ("Human Queue WIP constraint" — Assigned Agent=Human, Status in
// Ready/In Progress/Review, matching the Notion "Human Queue｜Actionable"
// view). That mismatch let Backlog Human Requests inflate the KPI while
// Human-assigned non-"Human Request" work (e.g. a Bug) was omitted.
test('queryCurrentOpenHumanRequests_ filters by Assigned Agent=Human and Status in Ready/In Progress/Review only', () => {
  let capturedFilter;
  const routes = {
    'POST /v1/data_sources/tasks-ds/query': (body) => {
      capturedFilter = body.filter;
      return { results: [], has_more: false };
    },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  sandbox.queryCurrentOpenHumanRequests_();

  assert.ok(capturedFilter, 'expected a filter to be sent');
  const clauses = capturedFilter.and;
  assert.ok(
    clauses.some((c) => c.property === 'Assigned Agent' && c.select && c.select.equals === 'Human'),
    'must filter on Assigned Agent=Human, not Type=Human Request'
  );
  assert.ok(
    !clauses.some((c) => c.property === 'Type'),
    'must not filter on Type — a Human-assigned Bug/Task counts toward the Actionable Queue too'
  );
  const statusClause = clauses.find((c) => c.or);
  const statuses = statusClause.or.map((c) => c.select.equals);
  assert.deepEqual(
    statuses.sort(),
    ['In Progress', 'Ready', 'Review'].sort(),
    'must match Ready/In Progress/Review only — Backlog is not yet Actionable'
  );
});
