import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, fetchStub } from './support/gas-sandbox.mjs';

const SCRIPT_PROPS = { NOTION_TOKEN: 't', GITHUB_TOKEN: 't' };

test('previousMonthLabel_ steps back one JST calendar month, including a year boundary', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const sep = sandbox.targetMonthFromYearMonth_(2026, 9);
  assert.equal(sandbox.previousMonthLabel_(sep), '2026-08');
  const jan = sandbox.targetMonthFromYearMonth_(2026, 1);
  assert.equal(sandbox.previousMonthLabel_(jan), '2025-12');
});

test('buildRawMetricsBlock_ + fetchPreviousMonthRawMetrics_ round-trip the same metrics object through a code block', () => {
  const metrics = { label: '2026-08', createdCount: 10, closedCount: 8, aiAutonomyPercent: 81.4 };

  const routes = {
    'GET /v1/blocks/framework-page-id/children': () => ({
      results: [{ id: 'aug-page', type: 'child_page', child_page: { title: 'AI Organization KPI / KMI｜2026-08' } }],
      has_more: false,
    }),
    'GET /v1/blocks/aug-page/children': () => {
      const { sandbox: inner } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
      const codeBlock = inner.buildRawMetricsBlock_(metrics);
      return { results: [{ id: 'blk-1', type: 'paragraph', paragraph: { rich_text: [] } }, Object.assign({ id: 'blk-2' }, codeBlock)], has_more: false };
    },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  const result = sandbox.fetchPreviousMonthRawMetrics_('framework-page-id', '2026-08');

  // Field-by-field: `result` is JSON.parse'd inside the vm sandbox, so its
  // Object.prototype is not reference-equal to this file's realm and trips
  // assert.deepEqual's strict prototype check even when every value matches.
  Object.keys(metrics).forEach((key) => {
    assert.equal(result[key], metrics[key]);
  });
});

test('fetchPreviousMonthRawMetrics_ returns null (not a throw) when no report page exists yet for that month', () => {
  const routes = {
    'GET /v1/blocks/framework-page-id/children': () => ({ results: [], has_more: false }),
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  assert.equal(sandbox.fetchPreviousMonthRawMetrics_('framework-page-id', '2026-08'), null);
});

test('fetchPreviousMonthRawMetrics_ returns null when the page exists but carries no tagged raw-metrics block', () => {
  const routes = {
    'GET /v1/blocks/framework-page-id/children': () => ({
      results: [{ id: 'aug-page', type: 'child_page', child_page: { title: 'AI Organization KPI / KMI｜2026-08' } }],
      has_more: false,
    }),
    'GET /v1/blocks/aug-page/children': () => ({
      results: [{ id: 'blk-1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'hello' }] } }],
      has_more: false,
    }),
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  assert.equal(sandbox.fetchPreviousMonthRawMetrics_('framework-page-id', '2026-08'), null);
});

test('formatDelta_ signs positive deltas explicitly and returns N/A when either side is missing', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  assert.equal(sandbox.formatDelta_(10, 7), '+3');
  assert.equal(sandbox.formatDelta_(7, 10), '-3');
  assert.equal(sandbox.formatDelta_(7, 7), '0');
  assert.equal(sandbox.formatDelta_(7, null), 'N/A');
  assert.equal(sandbox.formatDelta_(null, 7), 'N/A');
});
