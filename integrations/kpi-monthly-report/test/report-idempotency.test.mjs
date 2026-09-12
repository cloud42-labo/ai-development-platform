import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, fetchStub } from './support/gas-sandbox.mjs';

const SCRIPT_PROPS = {
  NOTION_TOKEN: 'test-notion-token',
  GITHUB_TOKEN: 'test-github-token',
  TASKS_DATA_SOURCE_ID: 'tasks-ds',
  TIME_EVENTS_DATA_SOURCE_ID: 'events-ds',
  PRODUCTS_DATA_SOURCE_ID: 'products-ds',
  KPI_FRAMEWORK_PAGE_ID: 'framework-page-id',
  GITHUB_REPOS: JSON.stringify(['acme/widgets']),
};

function emptyDbRoutes() {
  return {
    'POST /v1/data_sources/tasks-ds/query': () => ({ results: [], has_more: false }),
    'POST /v1/data_sources/events-ds/query': () => ({ results: [], has_more: false }),
    'POST /v1/data_sources/products-ds/query': () => ({
      results: [{ id: 'prod-A', properties: { Name: { type: 'title', title: [{ plain_text: 'ADP' }] } } }],
      has_more: false,
    }),
    'GET /search/issues': () => ({ total_count: 0, items: [] }),
  };
}

test('generateMonthlyKpiReportFor CREATES a new page when none exists yet for the month', () => {
  const calls = [];
  const routes = Object.assign({}, emptyDbRoutes(), {
    'GET /v1/blocks/framework-page-id/children': () => ({ results: [], has_more: false }),
    'POST /v1/pages': (body) => {
      calls.push({ type: 'create', body });
      return { id: 'new-page-id' };
    },
  });

  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  const result = sandbox.generateMonthlyKpiReportFor('2026-09');

  assert.equal(result.action, 'created');
  assert.equal(result.pageId, 'new-page-id');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.properties.title.title[0].text.content, 'AI Organization KPI｜2026-09');
  assert.equal(calls[0].body.parent.page_id, 'framework-page-id');
  assert.ok(Array.isArray(calls[0].body.children) && calls[0].body.children.length > 0);
});

test('generateMonthlyKpiReportFor UPDATES the existing page in place on a re-run — no duplicate is created', () => {
  const deleted = [];
  const patched = [];
  const created = [];
  const routes = Object.assign({}, emptyDbRoutes(), {
    'GET /v1/blocks/framework-page-id/children': () => ({
      results: [{ id: 'existing-page-id', type: 'child_page', child_page: { title: 'AI Organization KPI｜2026-09' } }],
      has_more: false,
    }),
    'GET /v1/blocks/existing-page-id/children': () => ({
      results: [{ id: 'old-block-1' }, { id: 'old-block-2' }],
      has_more: false,
    }),
    'DELETE *': (body, path) => {
      deleted.push(path);
      return {};
    },
    'PATCH /v1/blocks/existing-page-id/children': (body) => {
      patched.push(body);
      return {};
    },
    'POST /v1/pages': (body) => {
      created.push(body);
      return { id: 'should-not-be-created' };
    },
  });

  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  const result = sandbox.generateMonthlyKpiReportFor('2026-09');

  assert.equal(result.action, 'updated');
  assert.equal(result.pageId, 'existing-page-id');
  assert.equal(created.length, 0, 'a re-run must never call page creation');
  assert.deepEqual(deleted.sort(), ['/v1/blocks/old-block-1', '/v1/blocks/old-block-2']);
  assert.equal(patched.length, 1);
  assert.ok(patched[0].children.length > 0);
});

test('findExistingReportPage_ only matches a child_page whose title is the exact report title (no prefix confusion between months)', () => {
  const routes = {
    'GET /v1/blocks/framework-page-id/children': () => ({
      results: [
        { id: 'aug-page', type: 'child_page', child_page: { title: 'AI Organization KPI｜2026-08' } },
        { id: 'sep-page', type: 'child_page', child_page: { title: 'AI Organization KPI｜2026-09' } },
      ],
      has_more: false,
    }),
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  assert.equal(sandbox.findExistingReportPage_('framework-page-id', 'AI Organization KPI｜2026-09'), 'sep-page');
  assert.equal(sandbox.findExistingReportPage_('framework-page-id', 'AI Organization KPI｜2026-10'), null);
});
