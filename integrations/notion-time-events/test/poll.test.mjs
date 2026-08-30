import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, notionFetchStub } from './support/gas-sandbox.mjs';

const TASKS_DS = 'fc5e770f-c68e-4799-afe7-ec4bff0dab59';
const EVENTS_DS = '544b9a17-2653-47aa-b62c-bb52425b3bf2';
const TASKS_QUERY = 'POST /v1/data_sources/' + TASKS_DS + '/query';
const EVENTS_QUERY = 'POST /v1/data_sources/' + EVENTS_DS + '/query';

function taskPage(id, { status, agent, lastEdited, startedAt = null, title = 'T' }) {
  return {
    object: 'page',
    id,
    url: 'https://www.notion.so/' + id.replace(/-/g, ''),
    last_edited_time: lastEdited,
    last_edited_by: { object: 'user', id: 'user-1' },
    parent: { type: 'data_source_id', data_source_id: TASKS_DS },
    properties: {
      Title: { type: 'title', title: [{ plain_text: title }] },
      Status: { type: 'status', status: { name: status } },
      'Assigned Agent': { type: 'select', select: agent ? { name: agent } : null },
      'Started At': { type: 'date', date: startedAt ? { start: startedAt } : null },
      Result: { type: 'rich_text', rich_text: [] },
      'Completed At': { type: 'date', date: null },
    },
  };
}

function eventPage(id, { actor, startedAt, endedAt = null }) {
  return {
    object: 'page',
    id,
    properties: {
      Actor: { type: 'select', select: { name: actor } },
      'Started At': { type: 'date', date: { start: startedAt } },
      'Ended At': { type: 'date', date: endedAt ? { start: endedAt } : null },
      Note: { type: 'rich_text', rich_text: [] },
    },
  };
}

// A sandbox whose Notion stub answers with `tasks` for the Stories & Tasks
// query and `events` for the Task Time Events query, and accepts writes.
function harness({ tasks = [], events = [], scriptProperties = {}, lockHeld = false, now } = {}) {
  const routes = {
    [TASKS_QUERY]: () => ({ results: tasks, has_more: false }),
    [EVENTS_QUERY]: () => ({ results: events, has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', ...scriptProperties },
    lockHeld,
    fetch: notionFetchStub(routes),
    now,
  });
}

// Values returned by Code.gs are created inside the vm realm, so their
// prototypes differ from Node's and assert's deep comparison rejects them on
// reference identity. Round-tripping through JSON compares them by structure.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function requestsTo(fetchLog, method, pathFragment) {
  return fetchLog.filter(
    (entry) =>
      String((entry.options && entry.options.method) || 'get').toUpperCase() === method &&
      entry.url.includes(pathFragment)
  );
}

test('the first poll looks back an hour and filters on last_edited_time', () => {
  const { sandbox, fetchLog, scriptProps } = harness();

  const before = Date.now();
  const summary = sandbox.pollTaskChanges();

  assert.deepEqual(plain(summary.outcomes), []);
  const query = JSON.parse(requestsTo(fetchLog, 'POST', TASKS_DS)[0].options.payload);
  assert.equal(query.filter.timestamp, 'last_edited_time');
  assert.equal(query.sorts[0].direction, 'ascending');

  // Initial window is one hour plus the overlap, and never a bare `now`.
  const since = new Date(query.filter.last_edited_time.on_or_after).getTime();
  const expected = before - 60 * 60 * 1000 - 2 * 60 * 1000;
  assert.ok(Math.abs(since - expected) < 5000, 'unexpected initial lookback: ' + query.filter.last_edited_time.on_or_after);

  // A completed run advances the cursor so the next poll starts from here.
  assert.ok(new Date(scriptProps.get('LAST_SYNC_CURSOR')).getTime() >= before);
});

test('a stored cursor is re-read with the overlap applied', () => {
  const { sandbox, fetchLog } = harness({
    scriptProperties: { LAST_SYNC_CURSOR: '2026-08-30T05:00:00.000Z' },
  });

  sandbox.pollTaskChanges();

  const query = JSON.parse(requestsTo(fetchLog, 'POST', TASKS_DS)[0].options.payload);
  assert.equal(query.filter.last_edited_time.on_or_after, '2026-08-30T04:58:00.000Z');
});

test('an In Progress Task with no open event opens exactly one Time Event', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f03', {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T05:10:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
    })],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.processed, 1);
  assert.match(summary.outcomes[0], /^opened:/);
  const creates = requestsTo(fetchLog, 'POST', '/v1/pages');
  assert.equal(creates.length, 1);
  const created = JSON.parse(creates[0].options.payload);
  assert.equal(created.parent.data_source_id, EVENTS_DS);
  assert.equal(created.properties.Actor.select.name, 'Claude');
});

test('re-reading an unchanged Task in the overlap window makes no Notion mutation', () => {
  const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f03', {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T05:10:00.000Z',
    startedAt: '2026-08-30T05:10:00.000Z',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task] });

  sandbox.pollTaskChanges();
  const mutationsAfterFirst =
    requestsTo(fetchLog, 'POST', '/v1/pages').length + requestsTo(fetchLog, 'PATCH', '/v1/pages').length;

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^duplicate:/);
  const mutationsAfterSecond =
    requestsTo(fetchLog, 'POST', '/v1/pages').length + requestsTo(fetchLog, 'PATCH', '/v1/pages').length;
  assert.equal(mutationsAfterSecond, mutationsAfterFirst);
});

test('leaving In Progress closes every open event for the Task', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Review',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T06:00:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
    })],
    events: [
      eventPage('evt-claude', { actor: 'Claude', startedAt: '2026-08-30T05:10:00.000Z' }),
      eventPage('evt-chris', { actor: 'Chris', startedAt: '2026-08-30T05:20:00.000Z' }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /closed:evt-claude/);
  assert.match(summary.outcomes[0], /closed:evt-chris/);
  const closes = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-');
  assert.equal(closes.length, 2);
  closes.forEach((entry) => {
    assert.ok(JSON.parse(entry.options.payload).properties['Ended At'].date.start);
  });
});

test('a capped batch leaves the cursor on the last Task it actually reconciled', () => {
  const tasks = [];
  for (let i = 0; i < 30; i++) {
    tasks.push(taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f' + String(i).padStart(3, '0'), {
      status: 'Ready',
      agent: 'Human',
      lastEdited: '2026-08-30T05:' + String(i).padStart(2, '0') + ':00.000Z',
    }));
  }
  const { sandbox, scriptProps } = harness({ tasks });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.scanned, 30);
  assert.equal(summary.processed, 25);
  assert.equal(summary.capped, true);
  // Cursor must not jump past the 5 Tasks this run never touched.
  assert.equal(scriptProps.get('LAST_SYNC_CURSOR'), '2026-08-30T05:24:00.000Z');
});

test('a fresh deploy bootstraps every currently In Progress Task even if it predates the initial lookback window', () => {
  const staleActiveTask = taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f99', {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-08-28T00:00:00.000Z', // well outside the 1h initial lookback
    startedAt: '2026-08-28T00:00:00.000Z',
  });
  const recentTask = taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f98', {
    status: 'Ready',
    agent: 'Human',
    lastEdited: '2026-08-30T05:59:00.000Z', // inside the lookback window
  });

  // A payload-aware stub: the time-window query and the bootstrap
  // Status=In Progress query must be answered differently, or this test
  // could not tell a real bootstrap query from a coincidence.
  const routes = {
    [TASKS_QUERY]: (body) => {
      const isBootstrapStatusQuery = Boolean(body.filter && body.filter.property === 'Status');
      return { results: isBootstrapStatusQuery ? [staleActiveTask] : [recentTask], has_more: false };
    },
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox, fetchLog } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' }, // no LAST_SYNC_CURSOR: fresh deploy
    fetch: notionFetchStub(routes),
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.bootstrap, true);
  const openedOutcome = summary.outcomes.find((o) => /^opened:/.test(o));
  assert.ok(openedOutcome, 'expected the stale In Progress Task to get an opened Time Event: ' + JSON.stringify(summary.outcomes));
  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.ok(creates.some((body) => body.properties.Task.relation[0].id === staleActiveTask.id));
});

test('overlap duplicates are skipped for free, so a dense duplicate cluster does not stall the unprocessed tail', () => {
  const cursor = '2026-08-30T06:00:00.000Z';
  const oldTasks = [];
  for (let i = 0; i < 20; i++) {
    oldTasks.push(taskPage('3cafbd82-6f3b-8158-9622-d795b43d1' + String(i).padStart(3, '0'), {
      status: 'Ready',
      agent: 'Human',
      lastEdited: '2026-08-30T05:59:' + String(i).padStart(2, '0') + '.000Z', // inside the overlap window
    }));
  }
  const newTasks = [];
  for (let i = 0; i < 10; i++) {
    newTasks.push(taskPage('3cafbd82-6f3b-8158-9622-d795b43d2' + String(i).padStart(3, '0'), {
      status: 'Ready',
      agent: 'Human',
      lastEdited: '2026-08-30T06:00:' + String(10 + i).padStart(2, '0') + '.000Z', // after the cursor
    }));
  }

  const { sandbox, scriptProps } = harness({
    tasks: oldTasks.concat(newTasks),
    scriptProperties: { LAST_SYNC_CURSOR: cursor },
  });

  // Simulate that the 20 old Tasks were already reconciled by an earlier
  // run, so this run's re-read of them inside the overlap window is a free
  // duplicate rather than new work.
  oldTasks.forEach((task) => sandbox.reconcileTaskPage_(task));

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.scanned, 30);
  // Only the 10 genuinely new Tasks are charged against the reconciliation
  // budget; the 20 duplicates were skipped for free instead of exhausting it.
  assert.equal(summary.processed, 10);
  assert.equal(summary.capped, false); // the whole batch was reached in one run
  // The cursor advanced past the entire batch instead of staying pinned
  // inside the old duplicate cluster (which would repeat the same stall on
  // every subsequent run).
  assert.ok(new Date(scriptProps.get('LAST_SYNC_CURSOR')).getTime() >= new Date('2026-08-30T06:00:19.000Z').getTime());
});

test('a duplicate cohort larger than the scan cap does not stall reconciliation forever', () => {
  // Regression for the Codex-reported 501-Task repro: a cohort sharing one
  // last_edited_time (e.g. a bulk edit landing in the same minute) larger
  // than the old MAX_TASKS_SCANNED_PER_RUN(500) used to get permanently
  // stuck, because free `duplicate:` outcomes still consumed that cap.
  const sharedLastEdited = '2026-08-30T05:59:00.000Z';
  const cursor = '2026-08-30T06:00:00.000Z';
  const oldTasks = [];
  for (let i = 0; i < 520; i++) {
    oldTasks.push(taskPage('3cafbd82-6f3b-8158-9622-d795b43d3' + String(i).padStart(3, '0'), {
      status: 'Ready',
      agent: 'Human',
      lastEdited: sharedLastEdited, // every Task shares the exact same timestamp
    }));
  }
  const laterTask = taskPage('3cafbd82-6f3b-8158-9622-d795b43d4999', {
    status: 'Ready',
    agent: 'Human',
    lastEdited: '2026-08-30T06:00:30.000Z',
  });

  const { sandbox, scriptProps } = harness({
    tasks: oldTasks.concat([laterTask]),
    scriptProperties: { LAST_SYNC_CURSOR: cursor },
  });

  // Pre-seed all 520 as already reconciled, so this run's re-read of each is
  // a free `duplicate:` outcome — a cohort larger than the old scan cap.
  oldTasks.forEach((task) => sandbox.reconcileTaskPage_(task));

  const summary = sandbox.pollTaskChanges();

  const duplicateOutcomes = summary.outcomes.filter((o) => /^duplicate:/.test(o));
  assert.equal(duplicateOutcomes.length, 520); // the whole cohort was scanned, not just the first 500
  // The Task sorted after the entire 520-strong cohort was still reached
  // and reconciled in the same run, rather than being left behind a scan
  // cap that stops before ever getting past a static, unchanging timestamp.
  assert.equal(summary.outcomes[summary.outcomes.length - 1], 'no_change:Ready');
  assert.equal(summary.capped, false);
  assert.ok(new Date(scriptProps.get('LAST_SYNC_CURSOR')).getTime() > new Date(sharedLastEdited).getTime());
});

test('a long-running free-outcome scan bails out on wall-clock time and leaves a resumable cursor', () => {
  // Regression for the Codex-reported gap: neither MAX_TASKS_PER_RUN nor
  // pagination bounds a free-outcome (duplicate:/done_gate_passed) scan, and
  // each one still costs a real Time Events query — so a large-enough free
  // cohort can make the run itself run long even though it makes no write,
  // risking an uncaught Apps Script execution-limit kill that never reaches
  // the cursor-persist step (losing all progress and re-scanning the exact
  // same prefix on every subsequent trigger, forever). MAX_RUN_DURATION_MS
  // must stop the scan before that happens and persist a resumable cursor,
  // the same graceful "capped" behavior MAX_TASKS_PER_RUN already produces.
  const sharedLastEdited = '2026-08-30T05:59:00.000Z';
  const cursor = '2026-08-30T06:00:00.000Z';
  const oldTasks = [];
  for (let i = 0; i < 10; i++) {
    oldTasks.push(taskPage('3cafbd82-6f3b-8158-9622-d795b43d9' + String(i).padStart(3, '0'), {
      status: 'Ready',
      agent: 'Human',
      lastEdited: sharedLastEdited,
    }));
  }
  const laterTask = taskPage('3cafbd82-6f3b-8158-9622-d795b43daaa9', {
    status: 'Ready',
    agent: 'Human',
    lastEdited: '2026-08-30T06:00:30.000Z',
  });

  // A fake clock advancing 1 simulated minute on every no-arg `new Date()` /
  // `Date.now()` call. The while loop reads it once per iteration (plus once
  // for runStartedAt), so processing the 4th duplicate pushes elapsed time to
  // MAX_RUN_DURATION_MS (4 minutes) and the loop must stop before a 5th.
  let ticks = 0;
  const now = () => {
    ticks += 1;
    return ticks * 60 * 1000;
  };

  const { sandbox, scriptProps } = harness({
    tasks: oldTasks.concat([laterTask]),
    scriptProperties: { LAST_SYNC_CURSOR: cursor },
    now,
  });

  // Pre-seed all 10 as already reconciled — a free `duplicate:` outcome on
  // this run — using the real (unstubbed at this point) clock, since `now`
  // only takes effect for calls made after the sandbox is constructed.
  oldTasks.forEach((task) => sandbox.reconcileTaskPage_(task));

  const summary = sandbox.pollTaskChanges();

  const duplicateOutcomes = summary.outcomes.filter((o) => /^duplicate:/.test(o));
  // Stopped by the wall-clock budget partway through the free-outcome cohort
  // — not all 10, and nowhere near MAX_TASKS_PER_RUN (which duplicates never
  // even count against).
  assert.ok(duplicateOutcomes.length > 0 && duplicateOutcomes.length < 10, 'expected a partial scan: got ' + duplicateOutcomes.length);
  assert.ok(!summary.outcomes.includes('no_change:Ready')); // laterTask was never reached this run
  assert.equal(summary.capped, true);
  // The cursor is pinned at the last Task actually scanned (still inside the
  // shared-timestamp cohort), not advanced to "now" or lost entirely — the
  // next trigger resumes the scan instead of restarting blind.
  assert.equal(scriptProps.get('LAST_SYNC_CURSOR'), sharedLastEdited);
});

test('a wall-clock cutoff landing inside a tied-timestamp Done cohort resumes past what it already scanned, across repeated runs', () => {
  // Regression for the Codex-reported gap in the wall-clock fix above: a
  // capped run pins the cursor at the shared, tied last_edited_time of the
  // cohort it stopped inside — but the cursor alone cannot express "partway
  // through a tie", so the next run's `on_or_after` query returns the exact
  // same tied group from its own start again. For a Done cohort (always
  // re-verified, never dedup-skipped) that would mean re-querying the same
  // leading members forever without ever draining the tie or reaching the
  // Task behind it. LAST_SYNC_CURSOR_TIE_OFFSET must let each run resume
  // exactly where the previous one left off.
  const sharedEvent = eventPage('evt-shared', {
    actor: 'Claude',
    startedAt: '2026-08-30T05:00:00.000Z',
    endedAt: '2026-08-30T05:05:00.000Z',
  });

  const sharedLastEdited = '2026-08-30T05:20:00.000Z';
  const doneTasks = [];
  for (let i = 0; i < 10; i++) {
    const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43de' + String(i).padStart(3, '0'), {
      status: 'Done',
      agent: 'Claude Opus',
      lastEdited: sharedLastEdited, // every Done Task shares the exact same timestamp
      startedAt: '2026-08-30T05:00:00.000Z',
    });
    task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
    task.properties['Completed At'] = { type: 'date', date: { start: '2026-08-30T05:10:00.000Z' } };
    doneTasks.push(task);
  }
  const laterChangedTask = taskPage('3cafbd82-6f3b-8158-9622-d795b43def99', {
    status: 'Ready',
    agent: 'Human',
    lastEdited: '2026-08-30T06:00:00.000Z',
  });

  // A fake clock advancing 1 simulated minute per no-arg Date call, shared
  // across every pollTaskChanges() call below (not reset between them) —
  // each run's own runStartedAt is whatever the clock reads when that run
  // begins, so every run independently gets ~3 Tasks in before its own
  // MAX_RUN_DURATION_MS (4 minutes) elapses.
  let ticks = 0;
  const now = () => {
    ticks += 1;
    return ticks * 60 * 1000;
  };

  const { sandbox, fetchLog } = harness({
    tasks: doneTasks.concat([laterChangedTask]),
    events: [sharedEvent],
    now,
  });
  sharedEvent.properties.Note = {
    type: 'rich_text',
    rich_text: [{ plain_text: 'Result Fingerprint=' + sandbox.resultFingerprint_('shipped') }],
  };

  let reachedTail = false;
  for (let run = 0; run < 6 && !reachedTail; run++) {
    const summary = sandbox.pollTaskChanges();
    if (summary.outcomes.includes('no_change:Ready')) reachedTail = true;
  }

  assert.ok(reachedTail, 'expected the Task behind the tied cohort to be reached within a bounded number of runs');
  // Exactly two Time Events queries per Task actually reconciled (one from
  // reconcileAuthoritativeTimeEvents_, one from the Sheet projection sync)
  // — 11 Tasks (10 Done + the tail) means 22. Anything more means some Task
  // inside the tie was scanned more than once, i.e. the tie was not
  // correctly resumed.
  assert.equal(requestsTo(fetchLog, 'POST', EVENTS_DS).length, 22);
});

test('25+ already-valid Done Tasks inside the overlap do not exhaust the batch and starve a later changed Task', () => {
  // A single shared closed Time Event that satisfies every Done Task below
  // (all share the same Started At, so it counts as "applicable" for each).
  const sharedEvent = eventPage('evt-shared', {
    actor: 'Claude',
    startedAt: '2026-08-30T05:00:00.000Z',
    endedAt: '2026-08-30T05:05:00.000Z',
  });

  const doneTasks = [];
  for (let i = 0; i < 26; i++) {
    const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43d3' + String(i).padStart(3, '0'), {
      status: 'Done',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T05:20:' + String(i).padStart(2, '0') + '.000Z',
      startedAt: '2026-08-30T05:00:00.000Z',
    });
    task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
    task.properties['Completed At'] = { type: 'date', date: { start: '2026-08-30T05:10:00.000Z' } };
    doneTasks.push(task);
  }

  const laterChangedTask = taskPage('3cafbd82-6f3b-8158-9622-d795b43d4001', {
    status: 'Ready',
    agent: 'Human',
    lastEdited: '2026-08-30T06:00:00.000Z',
  });

  const { sandbox } = harness({
    tasks: doneTasks.concat([laterChangedTask]),
    events: [sharedEvent],
  });

  // Pre-stamp the shared event as already validated for this exact Result, so
  // every Done re-verification below is the free, no-write steady-state path
  // (`done_gate_passed`) rather than a first-time stamp (`done_gate_passed:
  // stamped`, which now correctly costs a write against the batch — that
  // scenario is covered separately by the write-budget test below).
  sharedEvent.properties.Note = {
    type: 'rich_text',
    rich_text: [{ plain_text: 'Result Fingerprint=' + sandbox.resultFingerprint_('shipped') }],
  };

  const summary = sandbox.pollTaskChanges();

  const passingDoneOutcomes = summary.outcomes.filter((outcome) => outcome === 'done_gate_passed');
  assert.equal(passingDoneOutcomes.length, 26);
  // The Task sorted after all 26 valid Done outcomes still got reconciled in
  // the same run, rather than being left behind an exhausted budget.
  assert.equal(summary.outcomes[summary.outcomes.length - 1], 'no_change:Ready');
  assert.equal(summary.capped, false);
});

test('a Done cohort larger than the old scan cap does not stall reconciliation forever', () => {
  // Regression for the Codex-reported analogous repro: done_gate_passed
  // costs a Time Events read even though it makes no write, and — unlike
  // duplicate: — is never exempted from re-scanning, since Done always
  // bypasses snapshot dedup. A prior fix that capped free outcomes at a
  // fixed scan count (rather than not capping them at all) reintroduced the
  // exact same stall for a large valid-Done cohort.
  const sharedEvent = eventPage('evt-shared', {
    actor: 'Claude',
    startedAt: '2026-08-30T05:00:00.000Z',
    endedAt: '2026-08-30T05:05:00.000Z',
  });

  const doneTasks = [];
  for (let i = 0; i < 520; i++) {
    const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43d5' + String(i).padStart(3, '0'), {
      status: 'Done',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T05:59:00.000Z', // every Task shares the exact same timestamp
      startedAt: '2026-08-30T05:00:00.000Z',
    });
    task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
    task.properties['Completed At'] = { type: 'date', date: { start: '2026-08-30T05:10:00.000Z' } };
    doneTasks.push(task);
  }

  const laterChangedTask = taskPage('3cafbd82-6f3b-8158-9622-d795b43d6999', {
    status: 'Ready',
    agent: 'Human',
    lastEdited: '2026-08-30T06:00:30.000Z',
  });

  const { sandbox } = harness({
    tasks: doneTasks.concat([laterChangedTask]),
    events: [sharedEvent],
    scriptProperties: { LAST_SYNC_CURSOR: '2026-08-30T06:00:00.000Z' },
  });

  // Pre-stamp, as above: this test is about the scan not stalling on a large
  // steady-state Done cohort, not about first-time stamp writes.
  sharedEvent.properties.Note = {
    type: 'rich_text',
    rich_text: [{ plain_text: 'Result Fingerprint=' + sandbox.resultFingerprint_('shipped') }],
  };

  const summary = sandbox.pollTaskChanges();

  const passingDoneOutcomes = summary.outcomes.filter((outcome) => outcome === 'done_gate_passed');
  assert.equal(passingDoneOutcomes.length, 520); // the whole cohort was scanned, not just a fixed prefix
  assert.equal(summary.outcomes[summary.outcomes.length - 1], 'no_change:Ready');
  assert.equal(summary.capped, false);
});

test('a cohort of first-time Done stamp writes is bounded by the reconciliation write budget', () => {
  // Regression for the Codex-reported gap: markResultValidated_ performs a
  // real PATCH the first time an event is stamped, but until this fix
  // enforceDoneGate_ always returned the bare `done_gate_passed` outcome, and
  // isFreeOutcome_ treated that as free — so a cohort of MORE than
  // MAX_TASKS_PER_RUN Tasks each passing Done for the very first time would
  // never stop at the write budget, risking a runaway batch of real writes in
  // a single execution. Each Done Task below shares one *unstamped* event, so
  // every validation is a genuine first-time write (`done_gate_passed:
  // stamped`), unlike the steady-state tests above which pre-stamp it.
  const sharedEvent = eventPage('evt-shared-unstamped', {
    actor: 'Claude',
    startedAt: '2026-08-30T05:00:00.000Z',
    endedAt: '2026-08-30T05:05:00.000Z',
  });

  const doneTasks = [];
  for (let i = 0; i < 30; i++) {
    const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43d7' + String(i).padStart(3, '0'), {
      status: 'Done',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T05:20:' + String(i).padStart(2, '0') + '.000Z',
      startedAt: '2026-08-30T05:00:00.000Z',
    });
    task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
    task.properties['Completed At'] = { type: 'date', date: { start: '2026-08-30T05:10:00.000Z' } };
    doneTasks.push(task);
  }

  const laterChangedTask = taskPage('3cafbd82-6f3b-8158-9622-d795b43d8999', {
    status: 'Ready',
    agent: 'Human',
    lastEdited: '2026-08-30T06:00:00.000Z',
  });

  const { sandbox } = harness({
    tasks: doneTasks.concat([laterChangedTask]),
    events: [sharedEvent],
  });

  const summary = sandbox.pollTaskChanges();

  const stampedOutcomes = summary.outcomes.filter((outcome) => outcome === 'done_gate_passed:stamped');
  // Each first-time stamp write is charged against MAX_TASKS_PER_RUN (25), so
  // the run stops there instead of writing all 30.
  assert.equal(stampedOutcomes.length, 25);
  assert.equal(summary.processed, 25);
  assert.equal(summary.capped, true);
  // The Task after the cohort was never reached in this run — it's left for
  // the next poll, not silently starved forever (see the pre-stamped tests
  // above proving the *steady-state* re-verification case does not stall).
  assert.ok(!summary.outcomes.includes('no_change:Ready'));
});

test('a Done state is always re-verified by the gate, even if its snapshot hash collides with an already-processed one', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f77';
  const task = taskPage(taskId, {
    status: 'Done',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T05:10:00.000Z', // identical on both calls: simulates a minute-granularity hash collision
  });
  const { sandbox, fetchLog } = harness({ tasks: [task] });

  const firstOutcome = sandbox.reconcileTaskPage_(task);
  assert.match(firstOutcome, /^done_gate_rejected:/);

  // Same task object, same snapshot hash — must still re-run the Done gate
  // rather than being treated as an already-processed duplicate, or an
  // invalid Done retried within the same minute could persist forever.
  const secondOutcome = sandbox.reconcileTaskPage_(task);
  assert.match(secondOutcome, /^done_gate_rejected:/);

  // Two genuine gate re-evaluations, each rolling the Task back.
  const rollbacks = requestsTo(fetchLog, 'PATCH', '/v1/pages/' + taskId);
  assert.equal(rollbacks.length, 2);
});

test('a reopened Task starts its new interval from the current Started At, not a later observed edit', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f77';
  const historicalEvent = eventPage('evt-old', {
    actor: 'Claude',
    startedAt: '2026-08-20T00:00:00.000Z',
    endedAt: '2026-08-20T01:00:00.000Z',
  });
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T05:15:00.000Z', // a later edit than Started At, e.g. a reassignment moments after restart
    startedAt: '2026-08-30T05:10:00.000Z', // the true restart time
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [historicalEvent] });

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  assert.equal(creates[0].properties['Started At'].date.start, '2026-08-30T05:10:00.000Z');
});

test('a query that hits the pagination safety limit does not let the cursor advance past unretrieved data', () => {
  const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f01', {
    status: 'Ready',
    agent: 'Human',
    lastEdited: '2026-08-30T05:00:00.000Z',
  });

  let calls = 0;
  const routes = {
    [TASKS_QUERY]: () => {
      calls++;
      // Always claims there is more, so pagination never terminates
      // naturally — only the safety limit (50 pages) stops it.
      return { results: [task], has_more: true, next_cursor: 'cursor-' + calls };
    },
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: {
      NOTION_TOKEN: 'test-token',
      SPREADSHEET_ID: 'test-sheet',
      LAST_SYNC_CURSOR: '2026-08-30T04:00:00.000Z', // not a bootstrap run
    },
    fetch: notionFetchStub(routes),
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.truncated, true);
  assert.equal(summary.capped, true);
  // The cursor must hold at the last Task actually scanned, not jump ahead
  // to "now" — there is unretrieved data beyond the 50-page safety limit
  // that this run never saw.
  assert.equal(scriptProps.get('LAST_SYNC_CURSOR'), '2026-08-30T05:00:00.000Z');
});

test('a poll that is already running is skipped without advancing the cursor', () => {
  const { sandbox, fetchLog, scriptProps } = harness({
    lockHeld: true,
    scriptProperties: { LAST_SYNC_CURSOR: '2026-08-30T05:00:00.000Z' },
  });

  assert.deepEqual(plain(sandbox.pollTaskChanges()), { skipped: 'poll_already_running' });
  assert.equal(fetchLog.length, 0);
  assert.equal(scriptProps.get('LAST_SYNC_CURSOR'), '2026-08-30T05:00:00.000Z');
});

test('a page from another data source is ignored rather than reconciled', () => {
  const foreign = taskPage('3cafbd82-6f3b-8158-9622-d795b43d1f03', {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T05:10:00.000Z',
  });
  foreign.parent.data_source_id = '00000000-0000-0000-0000-000000000000';
  const { sandbox, fetchLog } = harness({ tasks: [foreign] });

  const summary = sandbox.pollTaskChanges();

  assert.deepEqual(plain(summary.outcomes), ['ignored:not_configured_task']);
  assert.equal(requestsTo(fetchLog, 'POST', '/v1/pages').length, 0);
});

test('setup installs exactly one poll trigger and reinstalling does not duplicate it', () => {
  const { sandbox, triggers } = harness();

  sandbox.setup();
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].getHandlerFunction(), 'pollTaskChanges');
  assert.equal(triggers[0].minutes, 5);

  sandbox.installSyncTrigger();
  assert.equal(triggers.length, 1);
});

test('an out-of-range poll interval falls back to the default', () => {
  const { sandbox, triggers } = harness({ scriptProperties: { POLL_INTERVAL_MINUTES: '3' } });

  sandbox.installSyncTrigger();

  assert.equal(triggers[0].minutes, 5);
});

test('backfillResultFingerprints_ stamps a legacy Done Task and the stamp then genuinely protects against a later stale-Result reopen', () => {
  // Regression for the Codex-reported migration gap: a Task that reached
  // Done under an OLDER Code.gs revision (before Result-fingerprint
  // stamping existed) has an applicable closed event with no stamp. The
  // reuse check can only catch a later reopen's stale, unchanged Result
  // against an event it once stamped — so an unstamped legacy event is
  // invisible to it. backfillResultFingerprints_ closes that gap by forcing
  // the normal Done re-verification (which stamps on first pass) across
  // every currently Done Task regardless of last_edited_time.
  const legacyTask = taskPage('3cafbd82-6f3b-8158-9622-d795b43dc001', {
    status: 'Done',
    agent: 'Claude Opus',
    lastEdited: '2026-08-25T10:00:00.000Z', // old — outside any normal poll window
    startedAt: '2026-08-25T09:00:00.000Z',
  });
  legacyTask.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped v1' }] };
  legacyTask.properties['Completed At'] = { type: 'date', date: { start: '2026-08-25T09:45:00.000Z' } };
  const legacyEvent = eventPage('evt-legacy', {
    actor: 'Claude',
    startedAt: '2026-08-25T09:00:00.000Z',
    endedAt: '2026-08-25T09:30:00.000Z',
    // No Note/fingerprint: this event predates the stamping feature.
  });

  const { sandbox, fetchLog } = harness({
    tasks: [legacyTask],
    events: [legacyEvent],
  });

  const summary = sandbox.backfillResultFingerprints_();

  assert.equal(summary.scanned, 1);
  assert.deepEqual(Array.from(summary.outcomes), ['done_gate_passed:stamped']);
  const stampWrite = fetchLog.find((entry) => (entry.options.method || '').toUpperCase() === 'PATCH');
  assert.ok(stampWrite, 'expected the backfill to PATCH-stamp the legacy event');

  // Simulate the stamp having landed (as the real PATCH would), then verify
  // the gap the finding described is now actually closed: reopen the Task
  // with an unchanged Result and only Completed At refreshed for the new
  // execution — this must now be rejected as stale, where before the
  // backfill it would have silently passed.
  legacyEvent.properties.Note = {
    type: 'rich_text',
    rich_text: [{ plain_text: 'Result Fingerprint=' + sandbox.resultFingerprint_('shipped v1') }],
  };
  const reopenedTask = taskPage('3cafbd82-6f3b-8158-9622-d795b43dc001', {
    status: 'Done',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T03:00:00.000Z',
    startedAt: '2026-08-30T03:00:00.000Z', // properly refreshed for the new execution
  });
  reopenedTask.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped v1' }] }; // unchanged
  reopenedTask.properties['Completed At'] = { type: 'date', date: { start: '2026-08-30T03:45:00.000Z' } };
  const newEvent = eventPage('evt-new-execution', {
    actor: 'Claude',
    startedAt: '2026-08-30T03:00:00.000Z',
    endedAt: '2026-08-30T03:30:00.000Z',
  });

  const reopenOutcome = sandbox.enforceDoneGate_(reopenedTask, [legacyEvent, newEvent], []);

  assert.match(reopenOutcome, /^done_gate_rejected:/);
  assert.match(reopenOutcome, /stale_result/);
});
