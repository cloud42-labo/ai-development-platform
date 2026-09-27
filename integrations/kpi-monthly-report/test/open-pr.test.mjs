import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, fetchStub } from './support/gas-sandbox.mjs';

const SCRIPT_PROPS = {
  NOTION_TOKEN: 'test-notion-token',
  GITHUB_TOKEN: 'test-github-token',
  TASKS_DATA_SOURCE_ID: 'tasks-ds',
};

test('githubSearchOpenPRs_ queries is:pr is:open for the repo, with no date qualifier', () => {
  let capturedPath;
  const routes = {
    'GET /search/issues': (body, path) => {
      capturedPath = path;
      return { total_count: 0, items: [] };
    },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  sandbox.githubSearchOpenPRs_('acme/widgets');

  const q = decodeURIComponent(capturedPath.split('q=')[1].split('&')[0]);
  assert.equal(q, 'repo:acme/widgets is:pr is:open');
});

test('githubSearchOpenPRs_ marks truncated once GITHUB_SEARCH_MAX_PAGES is exhausted with more remaining', () => {
  const routes = {
    'GET /search/issues': (body, path) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      const items = Array.from({ length: 100 }, (_, i) => ({ number: (page - 1) * 100 + i + 1, created_at: '2026-09-01T00:00:00Z' }));
      return { total_count: 500, items };
    },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  const result = sandbox.githubSearchOpenPRs_('acme/widgets');
  assert.equal(result.items.length, 300);
  assert.equal(result.truncated, true);
});

test('aggregateOpenPrs_ computes Age in hours from created_at vs. the supplied "now", and the 48h-over count/percent', () => {
  const now = new Date('2026-09-27T00:00:00.000Z').getTime();
  const routes = {
    'GET /search/issues': () => ({
      total_count: 3,
      items: [
        { number: 1, created_at: '2026-09-26T12:00:00.000Z' }, // 12h old
        { number: 2, created_at: '2026-09-24T00:00:00.000Z' }, // 72h old -> over 48h
        { number: 3, created_at: '2026-09-25T00:00:00.000Z' }, // 48h exactly -> NOT over (strictly greater than)
      ],
    }),
    'POST /v1/data_sources/tasks-ds/query': () => ({ results: [], has_more: false }), // no Task match -> Unknown
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  const result = sandbox.aggregateOpenPrs_(['acme/widgets'], now);

  assert.equal(result.total, 3);
  assert.equal(result.over48h, 1);
  assert.equal(result.over48hPercent, sandbox.percentage_(1, 3));
  assert.equal(result.byRepo['acme/widgets'].count, 3);
  assert.equal(result.byRepo['acme/widgets'].over48h, 1);
  assert.equal(result.byProduct['Unknown/未分類'].count, 3);
});

test('aggregateOpenPrs_ attributes Product via lookupProductForPr_, matching the created/merged aggregation', () => {
  const now = new Date('2026-09-27T00:00:00.000Z').getTime();
  const routes = {
    'GET /search/issues': () => ({
      total_count: 1,
      items: [{ number: 42, created_at: '2026-09-26T00:00:00.000Z' }],
    }),
    'POST /v1/data_sources/tasks-ds/query': () => ({
      results: [{
        properties: {
          'Pull Request': { url: 'https://github.com/acme/widgets/pull/42' },
          Product: { type: 'relation', relation: [{ id: 'prod-A' }] },
        },
      }],
      has_more: false,
    }),
    'GET /v1/pages/prod-A': () => ({ properties: { Name: { type: 'title', title: [{ plain_text: 'ADP' }] } } }),
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  const result = sandbox.aggregateOpenPrs_(['acme/widgets'], now);

  assert.equal(result.byProduct.ADP.count, 1);
  assert.equal(result.total, 1);
});

test('aggregateOpenPrs_ returns null averages (never 0/0) when there are no open PRs at all', () => {
  const routes = { 'GET /search/issues': () => ({ total_count: 0, items: [] }) };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  const result = sandbox.aggregateOpenPrs_(['acme/widgets'], Date.now());
  assert.equal(result.total, 0);
  assert.equal(result.avgAgeH, null);
  assert.equal(result.over48hPercent, null);
});
