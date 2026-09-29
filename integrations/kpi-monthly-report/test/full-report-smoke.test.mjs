import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, fetchStub } from './support/gas-sandbox.mjs';

// End-to-end smoke test with non-trivial data on every query path, to catch
// runtime errors (undefined property access, division by zero, etc.) in the
// new §1 "9 Management Points" / Task Flow / Open PR sections that the
// empty-data idempotency test cannot exercise, since every aggregate there
// is zero/empty by construction.

const SCRIPT_PROPS = {
  NOTION_TOKEN: 't',
  GITHUB_TOKEN: 't',
  TASKS_DATA_SOURCE_ID: 'tasks-ds',
  TIME_EVENTS_DATA_SOURCE_ID: 'events-ds',
  PRODUCTS_DATA_SOURCE_ID: 'products-ds',
  KPI_FRAMEWORK_PAGE_ID: 'framework-page-id',
  GITHUB_REPOS: JSON.stringify(['acme/widgets']),
};

function doneTask(overrides) {
  return Object.assign({
    properties: {
      Status: { type: 'select', select: { name: 'Done' } },
      Type: { type: 'select', select: { name: 'Technical Task' } },
      'Assigned Agent': { type: 'select', select: { name: 'Claude Sonnet' } },
      'Value Type': { type: 'select', select: { name: 'Platform Capability' } },
      Product: { type: 'relation', relation: [{ id: 'prod-A' }] },
      'Lead Time (h)': { type: 'formula', formula: { type: 'number', number: 12.5 } },
    },
  }, overrides);
}

function timeEvent(overrides) {
  return Object.assign({
    properties: {
      'Active Hours': { type: 'formula', formula: { type: 'number', number: 3 } },
      'Waiting Hours': { type: 'formula', formula: { type: 'number', number: 1 } },
      Actor: { type: 'select', select: { name: 'Claude' } },
      'Work Type': { type: 'select', select: { name: 'Initial Work' } },
      Task: { type: 'relation', relation: [{ id: 'task-1' }] },
    },
  }, overrides);
}

test('generateMonthlyKpiReportFor renders a full report end-to-end without throwing, over realistic non-empty data', () => {
  let createdBody = null;
  const routes = {
    'POST /v1/data_sources/events-ds/query': () => ({
      results: [
        timeEvent({}),
        timeEvent({ properties: Object.assign({}, timeEvent({}).properties, { Actor: { type: 'select', select: { name: 'Human' } } }) }),
      ],
      has_more: false,
    }),
    'POST /v1/data_sources/products-ds/query': () => ({
      results: [{ id: 'prod-A', properties: { Name: { type: 'title', title: [{ plain_text: 'ADP' }] } } }],
      has_more: false,
    }),
    'GET /v1/pages/task-1': () => ({ properties: { Product: { type: 'relation', relation: [{ id: 'prod-A' }] } } }),
    'POST /v1/data_sources/tasks-ds/query': (body) => {
      const filter = JSON.stringify(body.filter || {});
      if (filter.indexOf('Completed At') !== -1) {
        return { results: [doneTask({}), doneTask({ properties: Object.assign({}, doneTask({}).properties, { 'Assigned Agent': { type: 'select', select: { name: 'Human' } } }) })], has_more: false };
      }
      if (filter.indexOf('Blocked') !== -1) {
        return { results: [{ properties: { Product: { type: 'relation', relation: [{ id: 'prod-A' }] } } }], has_more: false };
      }
      if (filter.indexOf('created_time') !== -1) {
        return { results: [doneTask({}), doneTask({})], has_more: false }; // 2 created
      }
      if (filter.indexOf('Closed At') !== -1) {
        return { results: [doneTask({})], has_more: false }; // 1 closed
      }
      if (filter.indexOf('Pull Request') !== -1) {
        const needle = body.filter.url.contains;
        if (needle === 'acme/widgets/pull/1') {
          return {
            results: [{ properties: { 'Pull Request': { url: 'https://github.com/acme/widgets/pull/1' }, Product: { type: 'relation', relation: [{ id: 'prod-A' }] } } }],
            has_more: false,
          };
        }
        return { results: [], has_more: false };
      }
      // Human Queue / WIP snapshot and any other Status-only filter.
      return { results: [{ properties: { Product: { type: 'relation', relation: [{ id: 'prod-A' }] } } }], has_more: false };
    },
    'GET /search/issues': (body, path) => {
      const q = decodeURIComponent(path.split('q=')[1].split('&')[0]);
      if (q.indexOf('is:open') !== -1) {
        return { total_count: 1, items: [{ number: 1, created_at: '2026-09-20T00:00:00.000Z' }] };
      }
      if (q.indexOf('is:merged') !== -1) {
        return { total_count: 1, items: [{ number: 1 }] };
      }
      return { total_count: 1, items: [{ number: 1 }] }; // created
    },
    'GET /v1/blocks/framework-page-id/children': () => ({ results: [], has_more: false }), // no existing page, no prior month
    'POST /v1/pages': (body) => {
      createdBody = body;
      return { id: 'new-page-id' };
    },
  };

  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: SCRIPT_PROPS,
    fetch: fetchStub(routes),
    now: () => new Date('2026-10-01T00:05:00.000Z').getTime(),
  });

  const result = sandbox.generateMonthlyKpiReportFor('2026-09');

  assert.equal(result.action, 'created');
  assert.ok(createdBody, 'expected a page create call');
  const blocks = createdBody.children;
  assert.ok(Array.isArray(blocks) && blocks.length > 10);

  const headings = blocks
    .filter((b) => b.type && b.type.indexOf('heading') === 0)
    .map((b) => b[b.type].rich_text[0].text.content);

  assert.ok(headings.some((h) => h.indexOf('9 Management Points') !== -1));
  assert.ok(headings.some((h) => h.indexOf('Task Flow') !== -1));
  assert.ok(headings.some((h) => h.indexOf('Delivery Flow') !== -1));
  assert.ok(headings.some((h) => h.indexOf('Value Conversion') !== -1));
  assert.ok(headings.some((h) => h === '5. 構造的問題'));
  assert.ok(headings.some((h) => h === '6. 対策・Backlog / Sprint / 正本更新'));

  // The raw-metrics code block must be present and parse back to a plain object.
  const codeBlock = blocks.find((b) => b.type === 'code');
  assert.ok(codeBlock, 'expected a machine-readable raw-metrics code block');
  const text = codeBlock.code.rich_text[0].text.content;
  assert.equal(text.indexOf('ai-organization-kpi-raw-metrics-v1'), 0);
  const parsed = JSON.parse(text.slice(text.indexOf('\n') + 1));
  assert.equal(parsed.label, '2026-09');
});
