import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, fetchStub } from './support/gas-sandbox.mjs';

const SCRIPT_PROPS = { NOTION_TOKEN: 't', GITHUB_TOKEN: 't' };

function doneTask({ valueType, assignedAgent } = {}) {
  return {
    properties: {
      'Value Type': { type: 'select', select: valueType ? { name: valueType } : null },
      'Assigned Agent': { type: 'select', select: assignedAgent ? { name: assignedAgent } : null },
    },
  };
}

test('aggregateValueTypeCoverage_ counts only Tasks with a Value Type set, and buckets by name', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const tasks = [
    doneTask({ valueType: 'Platform Capability' }),
    doneTask({ valueType: 'Platform Capability' }),
    doneTask({ valueType: 'Application Delivery' }),
    doneTask({}),
    doneTask({}),
  ];

  const result = sandbox.aggregateValueTypeCoverage_(tasks);

  assert.equal(result.total, 5);
  assert.equal(result.withValueType, 3);
  assert.equal(result.coveragePercent, sandbox.percentage_(3, 5));
  assert.equal(result.byValueType['Platform Capability'], 2);
  assert.equal(result.byValueType['Application Delivery'], 1);
});

test('aggregateValueTypeCoverage_ handles zero completed Tasks without dividing by zero', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const result = sandbox.aggregateValueTypeCoverage_([]);
  assert.equal(result.total, 0);
  assert.equal(result.coveragePercent, null);
});

test('aggregateAiAutonomy_ treats any non-empty, non-"Human" Assigned Agent as AI, and excludes unset from the denominator', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const tasks = [
    doneTask({ assignedAgent: 'Claude Sonnet' }),
    doneTask({ assignedAgent: 'Codex' }),
    doneTask({ assignedAgent: 'Human' }),
    doneTask({}), // Assigned Agent never recorded — must not be guessed either way
  ];

  const result = sandbox.aggregateAiAutonomy_(tasks);

  assert.equal(result.total, 4);
  assert.equal(result.unknown, 1);
  assert.equal(result.known, 3);
  assert.equal(result.aiCompleted, 2);
  assert.equal(result.humanCompleted, 1);
  assert.equal(result.aiAutonomyPercent, sandbox.percentage_(2, 3));
  assert.equal(result.humanDependencyPercent, sandbox.percentage_(1, 3));
});

test('aggregateAiAutonomy_ returns null percentages when no Task has Assigned Agent recorded', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const result = sandbox.aggregateAiAutonomy_([doneTask({}), doneTask({})]);
  assert.equal(result.known, 0);
  assert.equal(result.aiAutonomyPercent, null);
  assert.equal(result.humanDependencyPercent, null);
});
