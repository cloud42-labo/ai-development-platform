import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

test('computeTargetMonth_ targets the prior JST month regardless of run time-of-day', () => {
  const { sandbox } = loadCodeGsSandbox();

  // 2026-10-01 07:00 JST == 2026-09-30 22:00Z
  const target = sandbox.computeTargetMonth_(new Date('2026-09-30T22:00:00.000Z'));
  assert.equal(target.label, '2026-09');
  assert.equal(target.year, 2026);
  assert.equal(target.month, 9);
  assert.equal(target.startIso, '2026-08-31T15:00:00.000Z'); // 2026-09-01 00:00 JST
  assert.equal(target.endIsoExclusive, '2026-09-30T15:00:00.000Z'); // 2026-10-01 00:00 JST
});

test('computeTargetMonth_ crosses the year boundary correctly', () => {
  const { sandbox } = loadCodeGsSandbox();

  // 2027-01-01 07:00 JST -> targets December 2026
  const target = sandbox.computeTargetMonth_(new Date('2026-12-31T22:00:00.000Z'));
  assert.equal(target.label, '2026-12');
  assert.equal(target.year, 2026);
  assert.equal(target.month, 12);
});

test('computeTargetMonth_ is driven by the JST calendar date, not the UTC one', () => {
  const { sandbox } = loadCodeGsSandbox();

  // 2026-10-01 00:30 UTC is already 2026-10-01 09:30 JST: still October in
  // JST, so the target month is still September.
  const target = sandbox.computeTargetMonth_(new Date('2026-10-01T00:30:00.000Z'));
  assert.equal(target.label, '2026-09');

  // 2026-09-30 16:00 UTC is 2026-10-01 01:00 JST: JST has already rolled
  // over to October even though UTC has not, so this must ALSO target
  // September, not August.
  const target2 = sandbox.computeTargetMonth_(new Date('2026-09-30T16:00:00.000Z'));
  assert.equal(target2.label, '2026-09');
});

test('targetMonthFromYearMonth_ produces a half-open [start, end) range spanning exactly the month', () => {
  const { sandbox } = loadCodeGsSandbox();
  const feb = sandbox.targetMonthFromYearMonth_(2028, 2); // leap year
  assert.equal(feb.startIso, '2028-01-31T15:00:00.000Z');
  assert.equal(feb.endIsoExclusive, '2028-02-29T15:00:00.000Z'); // 2028-03-01 00:00 JST
});

test('generateMonthlyKpiReportFor rejects a malformed label instead of guessing', () => {
  const { sandbox } = loadCodeGsSandbox();
  assert.throws(() => sandbox.generateMonthlyKpiReportFor('2026-9'), /YYYY-MM/);
  assert.throws(() => sandbox.generateMonthlyKpiReportFor('not-a-month'), /YYYY-MM/);
});

// Regression: the shape check `\d{2}` alone accepts an out-of-range month
// (e.g. "00" or "13"); Date then silently normalizes it into the adjacent
// December/January while the report keeps the typo'd label as its title —
// a backfill typo would create/overwrite a misleadingly named report.
test('generateMonthlyKpiReportFor rejects an out-of-range month instead of letting Date normalize it', () => {
  const { sandbox } = loadCodeGsSandbox();
  assert.throws(() => sandbox.generateMonthlyKpiReportFor('2026-00'), /01-12/);
  assert.throws(() => sandbox.generateMonthlyKpiReportFor('2026-13'), /01-12/);
  // in-range boundaries must still be accepted (fail later, on the missing
  // NOTION_TOKEN script property, not on the month check itself)
  assert.throws(() => sandbox.generateMonthlyKpiReportFor('2026-01'), /NOTION_TOKEN/);
  assert.throws(() => sandbox.generateMonthlyKpiReportFor('2026-12'), /NOTION_TOKEN/);
});
