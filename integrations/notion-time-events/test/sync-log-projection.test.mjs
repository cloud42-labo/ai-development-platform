// ADP-051-B5: regression tests for the isolated Sync Log projection I/O —
// docs/review-fix-state-model.md §3 step 2 (Sync Log evidence gathering).
//
// These functions were extracted from PR #50 (ADP-051-B2/B3), which
// reached the 9-round review hard cap and was Split (docs/regulations/
// R06-project-management-regulation.md §11). Round 3 (Finding D) and
// round 6 (Finding I) findings are ported here as regression tests against
// the same failure-matrix rows PR #50 already covered for these specific
// functions. Boundary/cutoff/tie semantics (ADP-051-B4), churn inheritance
// (ADP-051-B6) and wiring into the live poll path (ADP-051-B7) are out of
// scope — nothing here is called from the live poll path yet, and no test
// below goes through resolveSyncLogCandidate_/resolveWorkType_ (neither
// exists until a later Task assembles them from B4+B5+B6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

const TASK_ID = 'sync-log-projection-task';
const SYNC_LOG_PROJECTION_WINDOW_ROWS = 5000; // mirrors Code.gs's own constant

function harness() {
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-notion-token', SPREADSHEET_ID: 'test-sheet' },
    fetch() {
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    },
  });
}

function logRow(sandbox, { taskId = TASK_ID, status, receivedAt, outcome = '', type = 'Task' } = {}) {
  sandbox.logSnapshot_('snap', 'test', taskId, status, new Date(receivedAt), outcome, type);
}

// ---------------------------------------------------------------------------
// effectiveSyncLogStatus_ (docs/review-fix-state-model.md §3 step 2)
// ---------------------------------------------------------------------------

test('effectiveSyncLogStatus_: an ordinary row with no rollback outcome reads its raw Status', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.effectiveSyncLogStatus_({ rawStatus: 'Review', outcome: '' }), 'Review');
});

test('failure #46: a done_gate_rejected:...:rollback=<Status> row is read by its parsed rollback status, never the raw logged Status=Done column', () => {
  const { sandbox } = harness();
  const row = { rawStatus: 'Done', outcome: 'done_gate_rejected:missing_result:rollback=Review' };
  assert.equal(sandbox.effectiveSyncLogStatus_(row), 'Review');
});

test('Finding C (ADP-051-B2/B3 fixup round 2): a done_gate_rejected:...:rollback=In Progress row is read by its FULL multi-word rollback status, never truncated at the first space', () => {
  const { sandbox } = harness();
  const row = { rawStatus: 'Done', outcome: 'done_gate_rejected:missing_result:rollback=In Progress' };
  assert.equal(sandbox.effectiveSyncLogStatus_(row), 'In Progress');
});

// ---------------------------------------------------------------------------
// readSyncLogRowsForTask_ / loadSyncLogProjection_ — service-call bounding
// (Finding D, ADP-051-B2/B3 fixup round 3)
// ---------------------------------------------------------------------------

test('failure #16 / Finding D: reading a Task\'s Sync Log rows costs exactly ONE bulk row-data transfer for the whole sheet, regardless of this Task\'s own match count, and a never-seen Task ID costs the identical one transfer', () => {
  const { sandbox, spreadsheet } = harness();
  for (let i = 0; i < 50; i++) {
    logRow(sandbox, { taskId: 'unrelated-task-' + i, status: 'Review', receivedAt: '2026-08-01T00:00:00.000Z' });
  }
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:30:00.000Z' });

  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0;

  const rows = sandbox.readSyncLogRowsForTask_(TASK_ID);
  assert.equal(rows.length, 2);
  assert.equal(syncLogSheet.getValuesCallCount, 1, 'expected exactly ONE bulk row-data transfer for the whole Sync Log sheet, not one per matched row');

  syncLogSheet.getValuesCallCount = 0;
  const noneRows = sandbox.readSyncLogRowsForTask_('task-never-seen');
  assert.equal(noneRows.length, 0);
  assert.equal(
    syncLogSheet.getValuesCallCount, 1,
    'a Task ID that has never appeared in the log still costs exactly one bulk transfer under the poll-wide-projection architecture — but never more than one'
  );
});

test('Finding D: a mature Task with hundreds of matched Sync Log observations still costs exactly ONE row-data transfer, never one per matched row', () => {
  const { sandbox, spreadsheet } = harness();
  const ROW_COUNT = 500;
  for (let i = 0; i < ROW_COUNT; i++) {
    const minute = i % 2 === 0 ? '08' : '09';
    logRow(sandbox, {
      status: i % 2 === 0 ? 'Review' : 'In Progress',
      receivedAt: '2026-08-01T' + minute + ':' + String(i % 60).padStart(2, '0') + ':00.000Z',
    });
  }

  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0;

  const rows = sandbox.readSyncLogRowsForTask_(TASK_ID);
  assert.equal(rows.length, ROW_COUNT);
  assert.equal(syncLogSheet.getValuesCallCount, 1);
});

test('Finding D (THE actual Codex reproduction): 500 rows alternating between this Task and an unrelated Task — every one of this Task\'s 250 matches its own isolated, non-contiguous run — still costs exactly ONE getValues() call', () => {
  const { sandbox, spreadsheet } = harness();
  const ROW_COUNT = 500;

  for (let i = 0; i < ROW_COUNT; i++) {
    const minute = String(Math.floor(i / 60)).padStart(2, '0');
    const second = String(i % 60).padStart(2, '0');
    const receivedAt = '2026-08-01T00:' + minute + ':' + second + '.000Z';
    if (i % 2 === 0) {
      logRow(sandbox, { status: i % 4 === 0 ? 'Review' : 'In Progress', receivedAt: receivedAt });
    } else {
      logRow(sandbox, { taskId: 'unrelated-task', status: 'Review', receivedAt: receivedAt });
    }
  }

  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0;

  const rows = sandbox.readSyncLogRowsForTask_(TASK_ID);
  assert.equal(rows.length, ROW_COUNT / 2, 'every one of this Task\'s alternating matches must still be returned');
  assert.equal(
    syncLogSheet.getValuesCallCount, 1,
    'expected exactly ONE getValues() call regardless of 250 scattered, non-contiguous matches'
  );
});

test('Finding D: a poll-wide loader (makeSyncLogProjectionLoader_) memoizes the bulk read — a second, third, ... Task resolved against the SAME loader costs ZERO additional Sync Log transfers', () => {
  const { sandbox, spreadsheet } = harness();
  for (let i = 0; i < 500; i++) {
    logRow(sandbox, {
      taskId: i % 3 === 0 ? TASK_ID : (i % 3 === 1 ? 'task-b' : 'task-c'),
      status: i % 2 === 0 ? 'Review' : 'In Progress',
      receivedAt: '2026-08-01T00:' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + '.000Z',
    });
  }

  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0;
  const loader = sandbox.makeSyncLogProjectionLoader_();

  const first = sandbox.readSyncLogRowsForTask_(TASK_ID, loader);
  const second = sandbox.readSyncLogRowsForTask_('task-b', loader);
  const third = sandbox.readSyncLogRowsForTask_('task-c', loader);
  const fourth = sandbox.readSyncLogRowsForTask_('task-never-seen', loader);

  assert.ok(first.length > 0);
  assert.ok(second.length > 0);
  assert.ok(third.length > 0);
  assert.equal(fourth.length, 0);
  assert.equal(
    syncLogSheet.getValuesCallCount, 1,
    'four Tasks resolved against the SAME poll-wide loader must share exactly ONE underlying Sync Log transfer, not one each'
  );
});

test('a caller with no loader (isolated single-Task resolution) still costs exactly one unmemoized read for that call', () => {
  const { sandbox, spreadsheet } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' });
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0;
  const rows = sandbox.readSyncLogRowsForTask_(TASK_ID);
  assert.equal(rows.length, 1);
  assert.equal(syncLogSheet.getValuesCallCount, 1);
});

// ---------------------------------------------------------------------------
// loadSyncLogProjection_ — bounded tail window (Finding I, round 6)
// ---------------------------------------------------------------------------

test('Finding I: loadSyncLogProjection_ reads a BOUNDED tail window of the sheet — never the full 2..lastRow range — and marks the result truncated when older history was left unread', () => {
  const { sandbox, spreadsheet } = harness();
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  sandbox.ensureSyncLogSheet_(); // writes the header at row 1 before pushing raw data rows below
  const TOTAL_ROWS = 20000; // far more than the window

  for (let i = 0; i < TOTAL_ROWS; i++) {
    syncLogSheet.rows.push([
      'snap-' + i, 'test', 'unrelated-task-' + i, 'Review',
      '2026-01-01T00:00:00.000Z', '', 'Task', String(1000 + i),
    ]);
  }

  const originalGetRange = syncLogSheet.getRange.bind(syncLogSheet);
  let capturedNumRows = null;
  syncLogSheet.getRange = function (row, column, numRows, numColumns) {
    if (row > 1 && column === 1 && numColumns === 8) capturedNumRows = numRows;
    return originalGetRange(row, column, numRows, numColumns);
  };

  const rows = sandbox.loadSyncLogProjection_();

  assert.ok(capturedNumRows !== null, 'expected the 8-column projection range to be read');
  assert.equal(
    capturedNumRows, SYNC_LOG_PROJECTION_WINDOW_ROWS,
    'the read range height must be capped at the fixed window constant, never lastRow-1 (' + TOTAL_ROWS + ')'
  );
  assert.equal(rows.length, SYNC_LOG_PROJECTION_WINDOW_ROWS);
  assert.equal(rows.truncated, true, 'older history beyond the window exists and must be flagged');
  assert.equal(rows[rows.length - 1].taskId, 'unrelated-task-' + (TOTAL_ROWS - 1), 'the window must be the TAIL of the sheet (most recent rows), not an arbitrary slice');
});

test('Finding I: loadSyncLogProjection_ is NOT truncated when the whole Sync Log fits within the window', () => {
  const { sandbox } = harness();
  logRow(sandbox, { status: 'Review', receivedAt: '2026-08-01T09:00:00.000Z' });
  logRow(sandbox, { status: 'In Progress', receivedAt: '2026-08-01T09:30:00.000Z' });

  const rows = sandbox.loadSyncLogProjection_();
  assert.equal(rows.length, 2);
  assert.equal(rows.truncated, false);
});

test('loadSyncLogProjection_: an empty Sync Log sheet (header row only, or no rows at all) returns an empty, non-truncated projection', () => {
  const { sandbox } = harness();
  const rows = sandbox.loadSyncLogProjection_();
  assert.equal(rows.length, 0);
  assert.equal(rows.truncated, false);
});

test('Finding I: readSyncLogRowsForTask_ propagates .truncated through its own per-task filter — a filtered array is a new array and must not silently lose the flag', () => {
  const { sandbox, spreadsheet } = harness();
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  sandbox.ensureSyncLogSheet_();
  for (let i = 0; i < SYNC_LOG_PROJECTION_WINDOW_ROWS + 100; i++) {
    syncLogSheet.rows.push(['snap-' + i, 'test', 'unrelated-task', 'Review', '2026-01-01T00:00:00.000Z', '', 'Task', String(1000 + i)]);
  }
  // This Task never appears at all — its filtered result is empty, but the
  // sheet-wide truncation must still be visible to the caller.
  const rows = sandbox.readSyncLogRowsForTask_(TASK_ID);
  assert.equal(rows.length, 0);
  assert.equal(rows.truncated, true);
});

test('readSyncLogRowsForTask_: an empty/falsy taskId never reads the sheet at all and is never truncated', () => {
  const { sandbox, spreadsheet } = harness();
  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0;
  const rows = sandbox.readSyncLogRowsForTask_('');
  assert.equal(rows.length, 0);
  assert.equal(rows.truncated, false);
  assert.equal(syncLogSheet.getValuesCallCount, 0);
});
