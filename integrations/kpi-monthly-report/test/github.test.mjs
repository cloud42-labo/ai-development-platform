import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, fetchStub } from './support/gas-sandbox.mjs';

const SCRIPT_PROPS = {
  NOTION_TOKEN: 'test-notion-token',
  GITHUB_TOKEN: 'test-github-token',
  TASKS_DATA_SOURCE_ID: 'tasks-ds',
};

test('githubSearchPRs_ stops paginating once a short page is returned, and reports no truncation', () => {
  const routes = {
    'GET /search/issues': (body, path) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      if (page === 1) return { total_count: 3, items: [{ number: 1 }, { number: 2 }, { number: 3 }] };
      throw new Error('should not request a second page when the first page was short');
    },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  const target = sandbox.targetMonthFromYearMonth_(2026, 9);

  const result = sandbox.githubSearchPRs_('acme/widgets', 'merged', target);

  assert.equal(result.totalCount, 3);
  assert.equal(result.items.length, 3);
  assert.equal(result.truncated, false);
});

test('githubSearchPRs_ marks the result truncated when more PRs exist than GITHUB_SEARCH_MAX_PAGES can retrieve', () => {
  const routes = {
    'GET /search/issues': (body, path) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      const items = Array.from({ length: 100 }, (_, i) => ({ number: (page - 1) * 100 + i + 1 }));
      return { total_count: 350, items };
    },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  const target = sandbox.targetMonthFromYearMonth_(2026, 9);

  const result = sandbox.githubSearchPRs_('acme/widgets', 'created', target);

  assert.equal(result.totalCount, 350);
  assert.equal(result.items.length, 300); // 3 pages * 100, capped by GITHUB_SEARCH_MAX_PAGES
  assert.equal(result.truncated, true);
});

test('githubSearchPRs_ builds the merged-PR query with is:merged and the JST month expressed as inclusive UTC calendar dates', () => {
  let capturedPath;
  const routes = {
    'GET /search/issues': (body, path) => {
      capturedPath = path;
      return { total_count: 0, items: [] };
    },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  const target = sandbox.targetMonthFromYearMonth_(2026, 9);

  sandbox.githubSearchPRs_('acme/widgets', 'merged', target);

  const q = decodeURIComponent(capturedPath.split('q=')[1].split('&')[0]);
  assert.match(q, /repo:acme\/widgets/);
  assert.match(q, /is:merged merged:2026-09-01T00:00:00\+09:00\.\.2026-09-30T23:59:59\+09:00/);
});

test('lookupProductForPr_ attributes a PR to its matching Task\'s single Product, and null (never guessed) otherwise', () => {
  const routes = {
    'POST /v1/data_sources/tasks-ds/query': (body) => {
      const needle = body.filter.property === 'Pull Request' ? body.filter.url.contains : null;
      if (needle === 'acme/widgets/pull/42') {
        return {
          results: [{
            properties: {
              'Pull Request': { url: 'https://github.com/acme/widgets/pull/42' },
              Product: { type: 'relation', relation: [{ id: 'prod-A' }] },
            },
          }],
          has_more: false,
        };
      }
      return { results: [], has_more: false }; // e.g. pull/99 has no matching Task
    },
    'GET /v1/pages/prod-A': () => ({ properties: { Name: { type: 'title', title: [{ plain_text: 'ADP' }] } } }),
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });

  assert.equal(sandbox.lookupProductForPr_('acme/widgets', 42), 'ADP');
  assert.equal(sandbox.lookupProductForPr_('acme/widgets', 99), null);
});

test('lookupProductForPr_ does not attribute PR #4 to a Task whose URL is actually for PR #42 (numeric-prefix collision)', () => {
  const routes = {
    // Notion's `contains` filter is a coarse substring pre-filter: querying
    // for PR #4 (needle "acme/widgets/pull/4") also surfaces this Task,
    // whose Pull Request is really #42. The exact/boundary check inside
    // lookupProductForPr_ must reject it rather than misattribute Product.
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

  assert.equal(
    sandbox.lookupProductForPr_('acme/widgets', 4),
    null,
    'PR #4 must not be attributed via a Task that actually references PR #42'
  );
});

test('pullRequestUrlMatches_ requires a path boundary right after the PR number', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const needle = 'acme/widgets/pull/4';

  assert.equal(sandbox.pullRequestUrlMatches_('https://github.com/acme/widgets/pull/4', needle), true);
  assert.equal(sandbox.pullRequestUrlMatches_('https://github.com/acme/widgets/pull/42', needle), false);
  assert.equal(sandbox.pullRequestUrlMatches_('https://github.com/acme/widgets/pull/423', needle), false);
  assert.equal(sandbox.pullRequestUrlMatches_('https://github.com/acme/widgets/pull/4/files', needle), true);
  assert.equal(sandbox.pullRequestUrlMatches_(null, needle), false);
});
