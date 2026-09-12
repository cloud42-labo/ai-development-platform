import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

function task({ productIds = [], leadTime = null, type = 'Technical Task' }) {
  const props = {
    Product: { type: 'relation', relation: productIds.map((id) => ({ id })) },
    Type: { type: 'select', select: type ? { name: type } : null },
  };
  props['Lead Time (h)'] = leadTime === null
    ? { type: 'formula', formula: { type: 'number' } } // Notion omits `number` when not computable
    : { type: 'formula', formula: { type: 'number', number: leadTime } };
  return { properties: props };
}

test('aggregateTasksByProduct_ counts completed Tasks and averages Lead Time per Product', () => {
  const { sandbox } = loadCodeGsSandbox();
  const productMap = { 'prod-A': 'ADP', 'prod-B': 'AOD' };
  const tasks = [
    task({ productIds: ['prod-A'], leadTime: 10 }),
    task({ productIds: ['prod-A'], leadTime: 20 }),
    task({ productIds: ['prod-B'], leadTime: 5 }),
    task({ productIds: [] }), // no Product -> Unknown, no Lead Time
  ];

  const byProduct = sandbox.aggregateTasksByProduct_(tasks, productMap);

  assert.equal(byProduct.ADP.completedCount, 2);
  assert.equal(byProduct.ADP.avgLeadTimeH, 15);
  assert.equal(byProduct.AOD.completedCount, 1);
  assert.equal(byProduct.AOD.avgLeadTimeH, 5);
  assert.equal(byProduct['Unknown/未分類'].completedCount, 1);
  assert.equal(byProduct['Unknown/未分類'].avgLeadTimeH, null);
});

test('aggregateTasksByProduct_ splits a Task related to multiple Products instead of double-counting', () => {
  const { sandbox } = loadCodeGsSandbox();
  const productMap = { 'prod-A': 'ADP', 'prod-B': 'AOD' };
  const tasks = [task({ productIds: ['prod-A', 'prod-B'], leadTime: 10 })];

  const byProduct = sandbox.aggregateTasksByProduct_(tasks, productMap);

  assert.equal(byProduct.ADP.completedCount, 0.5);
  assert.equal(byProduct.AOD.completedCount, 0.5);
});

test('aggregateHumanCompletedInMonth_ only counts Type = Human Request', () => {
  const { sandbox } = loadCodeGsSandbox();
  const productMap = { 'prod-A': 'ADP' };
  const tasks = [
    task({ productIds: ['prod-A'], type: 'Human Request' }),
    task({ productIds: ['prod-A'], type: 'Technical Task' }),
  ];

  const result = sandbox.aggregateHumanCompletedInMonth_(tasks, productMap);
  assert.equal(result.total, 1);
  assert.equal(result.byProduct.ADP, 1);
});

test('pageTitle_ reads the title property regardless of its property key name', () => {
  const { sandbox } = loadCodeGsSandbox();
  const page = { properties: { Name: { type: 'title', title: [{ plain_text: 'Serendipity Spot' }] } } };
  assert.equal(sandbox.pageTitle_(page), 'Serendipity Spot');
});
