import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

const SCRIPT_PROPS = {
  NOTION_TOKEN: 'test-notion-token',
  GITHUB_TOKEN: 'test-github-token',
  TASKS_DATA_SOURCE_ID: 'tasks-ds',
};

test('notionRequest_ retries on 429 honoring Retry-After instead of aborting the run', () => {
  let calls = 0;
  const sleeps = [];
  const fetch = () => {
    calls += 1;
    if (calls === 1) {
      return {
        getResponseCode: () => 429,
        getContentText: () => JSON.stringify({ message: 'rate limited' }),
        getHeaders: () => ({ 'Retry-After': '2' }),
      };
    }
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ ok: true }),
      getHeaders: () => ({}),
    };
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch });
  // Utilities.sleep isn't part of the sandbox shim (no real timers needed
  // in tests) — stub it and record what notionRequest_ asked to wait.
  sandbox.Utilities = { sleep: (ms) => sleeps.push(ms) };

  const result = sandbox.notionRequest_('get', '/v1/pages/x');

  assert.equal(result.ok, true);
  assert.equal(calls, 2, 'should retry once after the 429 instead of throwing immediately');
  assert.deepEqual(sleeps, [2000], 'should honor the Retry-After header (seconds -> ms)');
});

test('notionRequest_ falls back to exponential backoff when Retry-After is absent', () => {
  let calls = 0;
  const sleeps = [];
  const fetch = () => {
    calls += 1;
    if (calls <= 2) {
      return { getResponseCode: () => 429, getContentText: () => '{}', getHeaders: () => ({}) };
    }
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true }), getHeaders: () => ({}) };
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch });
  sandbox.Utilities = { sleep: (ms) => sleeps.push(ms) };

  const result = sandbox.notionRequest_('post', '/v1/pages/x', { a: 1 });

  assert.equal(result.ok, true);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1000, 2000], 'attempt 0 waits 2^0s, attempt 1 waits 2^1s');
});

test('notionRequest_ still throws once retries are exhausted, rather than retrying forever', () => {
  let calls = 0;
  const fetch = () => {
    calls += 1;
    return { getResponseCode: () => 429, getContentText: () => '{}', getHeaders: () => ({}) };
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch });
  sandbox.Utilities = { sleep: () => {} };

  assert.throws(() => sandbox.notionRequest_('get', '/v1/pages/x'), /429/);
  // NOTION_RATE_LIMIT_MAX_RETRIES is a top-level `const` in Code.gs, so — like
  // other top-level consts in this codebase — it isn't exposed as a property
  // on the vm sandbox context (only function/var declarations are); the
  // retry cap is asserted directly here instead of read off `sandbox`.
  assert.equal(calls, 6, '1 initial attempt + 5 retries');
});

test('notionRequest_ still throws immediately (no retry) on a non-429 error', () => {
  let calls = 0;
  const fetch = () => {
    calls += 1;
    return { getResponseCode: () => 500, getContentText: () => 'boom', getHeaders: () => ({}) };
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch });
  sandbox.Utilities = { sleep: () => { throw new Error('should not sleep/retry on a non-429 error'); } };

  assert.throws(() => sandbox.notionRequest_('get', '/v1/pages/x'), /HTTP 500/);
  assert.equal(calls, 1);
});
