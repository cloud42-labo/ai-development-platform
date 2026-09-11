import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

function event({ active = 0, waiting = 0, actor = 'Claude', workType = 'Initial Work', taskIds = ['task-1'] }) {
  return {
    properties: {
      'Active Hours': { type: 'formula', formula: { type: 'number', number: active } },
      'Waiting Hours': { type: 'formula', formula: { type: 'number', number: waiting } },
      Actor: actor ? { type: 'select', select: { name: actor } } : { type: 'select', select: null },
      'Work Type': workType ? { type: 'select', select: { name: workType } } : { type: 'select', select: null },
      Task: { type: 'relation', relation: taskIds.map((id) => ({ id })) },
    },
  };
}

test('aggregateTimeEvents_ sums Active/Waiting hours and computes Flow Efficiency + Review Fix Ratio', () => {
  const { sandbox } = loadCodeGsSandbox();
  const events = [
    event({ active: 10, waiting: 2, actor: 'Claude', workType: 'Initial Work' }),
    event({ active: 4, waiting: 1, actor: 'Claude', workType: 'Review Fix' }),
    event({ active: 6, waiting: 0, actor: 'Codex', workType: 'Initial Work' }),
  ];

  const agg = sandbox.aggregateTimeEvents_(events);

  assert.equal(agg.totalActive, 20);
  assert.equal(agg.totalWaiting, 3);
  assert.equal(agg.flowEfficiency, sandbox.percentage_(20, 23));
  assert.equal(agg.reviewFixRatio, sandbox.percentage_(4, 20));
  // Objects returned from the vm sandbox live in a different realm, so
  // compare fields individually rather than via assert.deepEqual (which
  // would fail as "not reference-equal" on prototype identity alone).
  assert.equal(agg.byActor.Claude.active, 14);
  assert.equal(agg.byActor.Claude.waiting, 3);
  assert.equal(agg.byActor.Codex.active, 6);
  assert.equal(agg.byActor.Codex.waiting, 0);
  assert.equal(agg.byWorkType['Initial Work'], 16);
  assert.equal(agg.byWorkType['Review Fix'], 4);
});

test('aggregateTimeEvents_ buckets a blank Actor/Work Type under Unknown/未分類, never guessing', () => {
  const { sandbox } = loadCodeGsSandbox();
  const events = [event({ active: 5, actor: null, workType: null })];
  const agg = sandbox.aggregateTimeEvents_(events);
  // UNKNOWN_LABEL is a top-level `const` in Code.gs, not visible as a vm
  // context property (only function/var declarations are) — assert against
  // its literal value instead of the (inaccessible) binding.
  assert.equal(agg.byActor['Unknown/未分類'].active, 5);
  assert.equal(agg.byWorkType['Unknown/未分類'], 5);
});

test('percentage_ returns null (never a fabricated number) for a zero denominator', () => {
  const { sandbox } = loadCodeGsSandbox();
  assert.equal(sandbox.percentage_(5, 0), null);
  assert.equal(sandbox.formatPercent_(null), 'N/A');
  assert.equal(sandbox.percentage_(1, 3), 33.3);
});

test('aggregateTimeEventsByProduct_ resolves Task -> Product via a page-fetch cache and splits shared events evenly', () => {
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-notion-token' },
    fetch: (url) => {
      const body = url.includes('task-1')
        ? { id: 'task-1', properties: { Product: { type: 'relation', relation: [{ id: 'prod-A' }] } } }
        : { id: 'task-2', properties: { Product: { type: 'relation', relation: [] } } };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });

  const productMap = { 'prod-A': 'Serendipity Spot' };
  const cache = {};
  const events = [
    event({ active: 10, waiting: 2, taskIds: ['task-1'] }),
    event({ active: 10, waiting: 2, taskIds: ['task-1'] }), // same Task -> cache hit, no 2nd fetch
    event({ active: 6, taskIds: ['task-2'] }), // Product unset -> Unknown
    event({ active: 4, taskIds: [] }), // no Task relation at all -> Unknown
  ];

  const byProduct = sandbox.aggregateTimeEventsByProduct_(events, productMap, cache);

  assert.equal(byProduct['Serendipity Spot'].active, 20);
  assert.equal(byProduct['Unknown/未分類'].active, 10);
  assert.equal(Object.keys(cache).length, 2);
});
