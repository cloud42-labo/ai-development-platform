import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, fetchStub } from './support/gas-sandbox.mjs';

// Regression (Codex review, PR #74): ADP-055-KMI renamed the report page
// title going forward (REPORT_TITLE_PREFIX), but generateMonthlyKpiReportFor
// explicitly supports backfilling/rerunning ANY past month — one whose page
// was created under the pre-rename title and never manually migrated must
// still be found and updated, not duplicated under the new title.

const SCRIPT_PROPS = { NOTION_TOKEN: 't', GITHUB_TOKEN: 't' };

test('findExistingReportPageWithFallback_ prefers the current-title match when both exist', () => {
  const routes = {
    'GET /v1/blocks/framework-page-id/children': () => ({
      results: [
        { id: 'legacy-page', type: 'child_page', child_page: { title: 'AI Organization KPI｜2026-09' } },
        { id: 'current-page', type: 'child_page', child_page: { title: 'AI Organization KPI / KMI｜2026-09' } },
      ],
      has_more: false,
    }),
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  const result = sandbox.findExistingReportPageWithFallback_('framework-page-id', '2026-09');

  assert.equal(result.pageId, 'current-page');
  assert.equal(result.legacyTitle, false);
});

test('findExistingReportPageWithFallback_ falls back to the legacy title when only that one exists', () => {
  const routes = {
    'GET /v1/blocks/framework-page-id/children': () => ({
      results: [{ id: 'legacy-page', type: 'child_page', child_page: { title: 'AI Organization KPI｜2026-06' } }],
      has_more: false,
    }),
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  const result = sandbox.findExistingReportPageWithFallback_('framework-page-id', '2026-06');

  assert.equal(result.pageId, 'legacy-page');
  assert.equal(result.legacyTitle, true);
});

test('findExistingReportPageWithFallback_ returns a null pageId when neither title matches (genuinely new month)', () => {
  const routes = {
    'GET /v1/blocks/framework-page-id/children': () => ({ results: [], has_more: false }),
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  const result = sandbox.findExistingReportPageWithFallback_('framework-page-id', '2026-12');

  assert.equal(result.pageId, null);
  assert.equal(result.legacyTitle, false);
});

test('end-to-end: generateMonthlyKpiReportFor finds a legacy-titled page, migrates its title, and updates it in place (no duplicate)', () => {
  let renamedTitle = null;
  let created = 0;
  let patchedContentCalls = 0;
  const routes = {
    'POST /v1/data_sources/tasks-ds/query': () => ({ results: [], has_more: false }),
    'POST /v1/data_sources/events-ds/query': () => ({ results: [], has_more: false }),
    'POST /v1/data_sources/products-ds/query': () => ({ results: [], has_more: false }),
    'GET /search/issues': () => ({ total_count: 0, items: [] }),
    'GET /v1/blocks/framework-page-id/children': () => ({
      results: [{ id: 'legacy-page-id', type: 'child_page', child_page: { title: 'AI Organization KPI｜2026-06' } }],
      has_more: false,
    }),
    'GET /v1/blocks/legacy-page-id/children': () => ({ results: [], has_more: false }),
    'PATCH /v1/pages/legacy-page-id': (body) => {
      renamedTitle = body.properties.title.title[0].text.content;
      return { id: 'legacy-page-id' };
    },
    'DELETE *': () => ({}),
    'PATCH /v1/blocks/legacy-page-id/children': () => {
      patchedContentCalls += 1;
      return {};
    },
    'POST /v1/pages': () => {
      created += 1;
      return { id: 'should-not-be-created' };
    },
  };

  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: Object.assign({}, SCRIPT_PROPS, {
      TASKS_DATA_SOURCE_ID: 'tasks-ds',
      TIME_EVENTS_DATA_SOURCE_ID: 'events-ds',
      PRODUCTS_DATA_SOURCE_ID: 'products-ds',
      KPI_FRAMEWORK_PAGE_ID: 'framework-page-id',
      GITHUB_REPOS: JSON.stringify(['acme/widgets']),
    }),
    fetch: fetchStub(routes),
  });

  const result = sandbox.generateMonthlyKpiReportFor('2026-06');

  assert.equal(result.action, 'updated');
  assert.equal(result.pageId, 'legacy-page-id');
  assert.equal(result.migratedFromLegacyTitle, true);
  assert.equal(created, 0, 'must never create a second page when a legacy-titled one already exists');
  assert.equal(renamedTitle, 'AI Organization KPI / KMI｜2026-06');
  assert.equal(patchedContentCalls, 1);
});

test('end-to-end: generateMonthlyKpiReportFor does NOT rename or touch title when the current-title page already exists', () => {
  let renameCalled = false;
  const routes = {
    'POST /v1/data_sources/tasks-ds/query': () => ({ results: [], has_more: false }),
    'POST /v1/data_sources/events-ds/query': () => ({ results: [], has_more: false }),
    'POST /v1/data_sources/products-ds/query': () => ({ results: [], has_more: false }),
    'GET /search/issues': () => ({ total_count: 0, items: [] }),
    'GET /v1/blocks/framework-page-id/children': () => ({
      results: [{ id: 'current-page-id', type: 'child_page', child_page: { title: 'AI Organization KPI / KMI｜2026-09' } }],
      has_more: false,
    }),
    'GET /v1/blocks/current-page-id/children': () => ({ results: [], has_more: false }),
    'PATCH /v1/pages/current-page-id': () => { renameCalled = true; return {}; },
    'DELETE *': () => ({}),
    'PATCH /v1/blocks/current-page-id/children': () => ({}),
  };

  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: Object.assign({}, SCRIPT_PROPS, {
      TASKS_DATA_SOURCE_ID: 'tasks-ds',
      TIME_EVENTS_DATA_SOURCE_ID: 'events-ds',
      PRODUCTS_DATA_SOURCE_ID: 'products-ds',
      KPI_FRAMEWORK_PAGE_ID: 'framework-page-id',
      GITHUB_REPOS: JSON.stringify(['acme/widgets']),
    }),
    fetch: fetchStub(routes),
  });

  const result = sandbox.generateMonthlyKpiReportFor('2026-09');

  assert.equal(result.action, 'updated');
  assert.equal(result.migratedFromLegacyTitle, false);
  assert.equal(renameCalled, false, 'must not PATCH the title when the page is already under the current title');
});
