// BUG-ADP-STATUS-01: a Task can accumulate Done's own completion evidence
// (Closed At and/or Completed At, alongside Result and a closed Time Event)
// without Status ever being flipped to Done — a partial completion write,
// not a hypothetical one. Real Notion pages found stuck exactly this way and
// manually corrected on 2026-09-09: SPOT-03-S03 (+ two Subtasks),
// HUMAN-AOD-007-2 (+ its duplicate), HUMAN-AOD-008-1, HUMAN-AOD-03-S02-T04.
// These tests exercise `reconcileStaleCompletionEvidence_` — see its own
// comment in Code.gs, and `evaluateDoneEvidence_`/`enforceDoneGate_` for the
// evidence rules it deliberately reuses rather than duplicating.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, notionFetchStub } from './support/gas-sandbox.mjs';

const TASKS_DS = 'fc5e770f-c68e-4799-afe7-ec4bff0dab59';
const EVENTS_DS = '544b9a17-2653-47aa-b62c-bb52425b3bf2';
const TASKS_QUERY = 'POST /v1/data_sources/' + TASKS_DS + '/query';
const EVENTS_QUERY = 'POST /v1/data_sources/' + EVENTS_DS + '/query';

function taskPage(id, {
  status, agent, lastEdited, startedAt = null, title = 'T', type = null,
  result = '', completedAt = null, closedAt = null,
}) {
  return {
    object: 'page',
    id,
    url: 'https://www.notion.so/' + id.replace(/-/g, ''),
    last_edited_time: lastEdited,
    last_edited_by: { object: 'user', id: 'user-1' },
    parent: { type: 'data_source_id', data_source_id: TASKS_DS },
    properties: {
      Title: { type: 'title', title: [{ plain_text: title }] },
      Status: { type: 'select', select: { name: status } },
      'Assigned Agent': { type: 'select', select: agent ? { name: agent } : null },
      'Started At': { type: 'date', date: startedAt ? { start: startedAt } : null },
      Result: { type: 'rich_text', rich_text: result ? [{ plain_text: result }] : [] },
      'Completed At': { type: 'date', date: completedAt ? { start: completedAt } : null },
      'Closed At': { type: 'date', date: closedAt ? { start: closedAt } : null },
      Type: { type: 'select', select: type ? { name: type } : null },
    },
  };
}

function eventPage(id, { actor, startedAt, endedAt = null, note = '' }) {
  return {
    object: 'page',
    id,
    properties: {
      Actor: { type: 'select', select: { name: actor } },
      'Started At': { type: 'date', date: { start: startedAt } },
      'Ended At': { type: 'date', date: endedAt ? { start: endedAt } : null },
      Note: { type: 'rich_text', rich_text: note ? [{ plain_text: note }] : [] },
    },
  };
}

function harness({ tasks = [], events = [], scriptProperties = {}, now } = {}) {
  const routes = {
    [TASKS_QUERY]: () => ({ results: tasks, has_more: false }),
    [EVENTS_QUERY]: () => ({ results: events, has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', ...scriptProperties },
    fetch: notionFetchStub(routes),
    now,
  });
}

function requestsTo(fetchLog, method, pathFragment) {
  return fetchLog.filter(
    (entry) =>
      String((entry.options && entry.options.method) || 'get').toUpperCase() === method &&
      entry.url.includes(pathFragment)
  );
}

const TASK_ID = '3d5fbd82-6f3b-8138-833f-dbd841a2c3a1'; // BUG-ADP-STATUS-01's own page id, reused as a realistic fixture id

test('HUMAN-AOD-008-1 reproduction: Completed At present, no Closed At, Status stuck In Progress -> promoted to Done', () => {
  const task = taskPage(TASK_ID, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    result: 'published',
    completedAt: '2026-09-08T04:50:00.000Z',
    // closedAt intentionally omitted -- HUMAN-AOD-008-1's own repro had none.
  });
  const closedEvent = eventPage('evt-current', {
    actor: 'Claude',
    startedAt: '2026-09-08T04:31:00.000Z',
    endedAt: '2026-09-08T04:45:00.000Z',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [closedEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes.length, 1);
  assert.match(summary.outcomes[0], /^stale_status_promoted_to_done:evt-current$/);
  const statusWrite = requestsTo(fetchLog, 'PATCH', '/v1/pages/' + TASK_ID).find((entry) =>
    JSON.parse(entry.options.payload).properties.Status
  );
  assert.ok(statusWrite, 'expected a Status PATCH promoting the Task to Done');
  assert.equal(JSON.parse(statusWrite.options.payload).properties.Status.select.name, 'Done');
  // Promotion must also stamp the Result fingerprint on the applicable
  // event, the same as an ordinary done_gate_passed:stamped -- otherwise a
  // future reopen's stale-Result check has nothing to compare against.
  const eventWrite = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-current')[0];
  assert.match(JSON.parse(eventWrite.options.payload).properties.Note.rich_text[0].text.content, /Result Fingerprint=/);
});

test('Closed At present but Completed At missing is never guessed closed -- reported, not promoted (AC3)', () => {
  const task = taskPage(TASK_ID, {
    status: 'Review',
    agent: 'Claude Sonnet',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    result: 'published',
    closedAt: '2026-09-08T04:50:00.000Z',
    // completedAt intentionally omitted.
  });
  const closedEvent = eventPage('evt-current', {
    actor: 'Claude',
    startedAt: '2026-09-08T04:31:00.000Z',
    endedAt: '2026-09-08T04:45:00.000Z',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [closedEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^stale_completion_evidence_unresolved:/);
  assert.match(summary.outcomes[0], /missing_completed_at/);
  const statusWrites = requestsTo(fetchLog, 'PATCH', '/v1/pages/' + TASK_ID).filter((entry) =>
    JSON.parse(entry.options.payload).properties.Status
  );
  assert.equal(statusWrites.length, 0, 'an unresolved finding must never write Status');
});

test('a stale Completed At left over from a prior execution is reported, not silently accepted', () => {
  const task = taskPage(TASK_ID, {
    status: 'Review',
    agent: 'Claude Sonnet',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    result: 'published',
    // Completed At predates the Task's own current Started At -- exactly
    // the "Notion does not clear it on reopen" case enforceDoneGate_
    // already guards against for an explicit Done attempt.
    completedAt: '2026-09-07T00:00:00.000Z',
  });
  const closedEvent = eventPage('evt-current', {
    actor: 'Claude',
    startedAt: '2026-09-08T04:31:00.000Z',
    endedAt: '2026-09-08T04:45:00.000Z',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [closedEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^stale_completion_evidence_unresolved:/);
  assert.match(summary.outcomes[0], /stale_completed_at/);
  assert.equal(requestsTo(fetchLog, 'PATCH', '/v1/pages/' + TASK_ID).filter((entry) =>
    JSON.parse(entry.options.payload).properties.Status
  ).length, 0);
});

test('an open Time Event takes precedence over a stray Completed At -- ordinary In Progress handling is untouched', () => {
  const task = taskPage(TASK_ID, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    // A Completed At value is present, but real work is still being timed
    // right now (an open event for the same actor) -- must not be
    // force-completed out from under it.
    completedAt: '2026-09-07T00:00:00.000Z',
  });
  const openEvent = eventPage('evt-open', { actor: 'Claude', startedAt: '2026-09-08T04:31:00.000Z' });
  const { sandbox, fetchLog, scriptProps } = harness({ tasks: [task], events: [openEvent] });

  const summary = sandbox.pollTaskChanges();

  // The open event still takes precedence -- no write either way -- but
  // reconcileStaleCompletionEvidence_ now also reports its own defer
  // outcome (Codex, PR #43: this Task must be requeued for a later recheck
  // rather than silently dropped) alongside the ordinary In Progress
  // handling's own outcome.
  assert.match(summary.outcomes[0], /^stale_completion_evidence_deferred:open_time_event,already_open:evt-open$/);
  assert.equal(fetchLog.filter((entry) => (entry.options && entry.options.method) === 'patch').length, 0);
  assert.deepEqual(JSON.parse(scriptProps.get('STALE_COMPLETION_RETRY_IDS')), [TASK_ID]);
});

test('a Task with no completion evidence at all is unaffected (no false positive)', () => {
  const task = taskPage(TASK_ID, {
    status: 'Blocked',
    agent: 'Claude Sonnet',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
  });
  const { sandbox } = harness({ tasks: [task], events: [] });

  const summary = sandbox.pollTaskChanges();

  assert.doesNotMatch(summary.outcomes[0], /^stale_/);
});

test('Superseded Status is never promoted or flagged, however much completion evidence a stray value carries', () => {
  const task = taskPage(TASK_ID, {
    status: 'Superseded',
    agent: 'Claude Sonnet',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    completedAt: '2026-09-08T04:50:00.000Z',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [] });

  const summary = sandbox.pollTaskChanges();

  assert.doesNotMatch(summary.outcomes[0], /^stale_/);
  assert.equal(requestsTo(fetchLog, 'PATCH', '/v1/pages/' + TASK_ID).length, 0);
});

test('Type = Story is excluded from stale-completion detection the same as from Time Event generation (BUG-ADP-TTE-01)', () => {
  const task = taskPage(TASK_ID, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    type: 'Story',
    completedAt: '2026-09-08T04:50:00.000Z',
  });
  const { sandbox } = harness({ tasks: [task], events: [] });

  const summary = sandbox.pollTaskChanges();

  assert.doesNotMatch(summary.outcomes[0], /^stale_/);
});

test('an unresolved finding keeps surfacing every poll instead of deduping to duplicate: (AC9)', () => {
  const task = taskPage(TASK_ID, {
    status: 'Review',
    agent: 'Claude Sonnet',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    result: 'published',
    closedAt: '2026-09-08T04:50:00.000Z', // completedAt still missing
  });
  const closedEvent = eventPage('evt-current', {
    actor: 'Claude',
    startedAt: '2026-09-08T04:31:00.000Z',
    endedAt: '2026-09-08T04:45:00.000Z',
  });
  const { sandbox } = harness({ tasks: [task], events: [closedEvent] });

  const first = sandbox.pollTaskChanges();
  const second = sandbox.pollTaskChanges();

  assert.match(first.outcomes[0], /^stale_completion_evidence_unresolved:/);
  // Nothing about the page changed between polls (no write was made), yet
  // the second poll must re-report the same finding rather than skipping it
  // as a duplicate re-read of an already-processed snapshot.
  assert.match(second.outcomes[0], /^stale_completion_evidence_unresolved:/);
});

test('isFreeOutcome_: an unresolved finding is free (no write); a promotion is not (it writes Status=Done)', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.isFreeOutcome_('stale_completion_evidence_unresolved:missing_completed_at'), true);
  assert.equal(sandbox.isFreeOutcome_('stale_status_promoted_to_done:evt-1'), false);
  // A mixed outcome joining a real write with a free finding must still
  // count -- mirrors the existing Story mixed-outcome rule this reuses.
  assert.equal(sandbox.isFreeOutcome_('opened:evt-1,stale_completion_evidence_unresolved:missing_result'), false);
});

test('the mechanism is Type-agnostic aside from Story: Technical Task, Subtask, and Bug all promote identically', () => {
  ['Technical Task', 'Subtask', 'Bug'].forEach((type) => {
    const task = taskPage(TASK_ID, {
      status: 'In Progress',
      agent: 'Claude Sonnet',
      lastEdited: '2026-09-08T05:00:00.000Z',
      startedAt: '2026-09-08T04:31:00.000Z',
      type,
      result: 'done',
      completedAt: '2026-09-08T04:50:00.000Z',
    });
    const closedEvent = eventPage('evt-current', {
      actor: 'Claude',
      startedAt: '2026-09-08T04:31:00.000Z',
      endedAt: '2026-09-08T04:45:00.000Z',
    });
    const { sandbox } = harness({ tasks: [task], events: [closedEvent] });

    const summary = sandbox.pollTaskChanges();

    assert.match(summary.outcomes[0], /^stale_status_promoted_to_done:/, 'Type=' + type + ' should promote identically');
  });
});

test('a Human-assigned Task (Human Request) promotes identically to an AI-assigned one', () => {
  const task = taskPage(TASK_ID, {
    status: 'In Progress',
    agent: 'Human',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    type: 'Human Request',
    result: 'published',
    completedAt: '2026-09-08T04:50:00.000Z',
  });
  const closedEvent = eventPage('evt-current', {
    actor: 'Human',
    startedAt: '2026-09-08T04:31:00.000Z',
    endedAt: '2026-09-08T04:45:00.000Z',
  });
  const { sandbox } = harness({ tasks: [task], events: [closedEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^stale_status_promoted_to_done:/);
});

// --- Codex, PR #43 (P1): reopen guard ---------------------------------

test('reopen guard: a Task reopened to Ready with unchanged prior-Done evidence is not silently re-closed', () => {
  // The applicable closed event already carries a Result Fingerprint stamp
  // -- meaning this exact evidence already validated a Done once, either via
  // enforceDoneGate_'s ordinary re-verification while Status genuinely was
  // Done, or an earlier run of this very promotion. Status now reads Ready
  // (a human reopened it) while nothing else about the evidence has changed
  // -- Notion does not clear Completed At/Result/Started At on reopen -- so
  // evaluateDoneEvidence_ alone reads this as fully valid, current evidence
  // and would silently promote it straight back to Done, undoing the
  // reopen.
  const task = taskPage(TASK_ID, {
    status: 'Ready',
    agent: 'Claude Sonnet',
    lastEdited: '2026-09-08T06:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    result: 'published',
    completedAt: '2026-09-08T04:50:00.000Z',
  });
  const closedEvent = eventPage('evt-current', {
    actor: 'Claude',
    startedAt: '2026-09-08T04:31:00.000Z',
    endedAt: '2026-09-08T04:45:00.000Z',
    note: 'Result Fingerprint=already-validated-once',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [closedEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^stale_completion_evidence_unresolved:possible_reopen_after_done$/);
  const statusWrites = requestsTo(fetchLog, 'PATCH', '/v1/pages/' + TASK_ID).filter((entry) =>
    JSON.parse(entry.options.payload).properties.Status
  );
  assert.equal(statusWrites.length, 0, 'a reopened Task must never be silently re-closed to Done');
});

test('reopen guard does not block a genuinely fresh completion whose applicable event has never been stamped', () => {
  // Regression guard for the guard itself: the real HUMAN-AOD-008-1 pattern
  // -- an applicable event with no prior Result Fingerprint stamp at all --
  // still promotes exactly as before.
  const task = taskPage(TASK_ID, {
    status: 'Review',
    agent: 'Claude Sonnet',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    result: 'published',
    completedAt: '2026-09-08T04:50:00.000Z',
  });
  const closedEvent = eventPage('evt-current', {
    actor: 'Claude',
    startedAt: '2026-09-08T04:31:00.000Z',
    endedAt: '2026-09-08T04:45:00.000Z',
  });
  const { sandbox } = harness({ tasks: [task], events: [closedEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^stale_status_promoted_to_done:evt-current$/);
});

// --- Codex, PR #43 (P2): survive falling out of the incremental window ---

test('an unresolved finding is tracked in STALE_COMPLETION_RETRY_IDS', () => {
  const task = taskPage(TASK_ID, {
    status: 'Review',
    agent: 'Claude Sonnet',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    result: 'published',
    closedAt: '2026-09-08T04:50:00.000Z', // completedAt still missing -> unresolved
  });
  const closedEvent = eventPage('evt-current', {
    actor: 'Claude',
    startedAt: '2026-09-08T04:31:00.000Z',
    endedAt: '2026-09-08T04:45:00.000Z',
  });
  const { sandbox, scriptProps } = harness({ tasks: [task], events: [closedEvent] });

  sandbox.pollTaskChanges();

  assert.deepEqual(JSON.parse(scriptProps.get('STALE_COMPLETION_RETRY_IDS')), [TASK_ID]);
});

test('a retry-tracked Task is re-checked by direct fetch once it no longer appears in the incremental query, and drops out once resolved', () => {
  const baseProps = { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' };

  // First poll: seed the retry set with an unresolved finding.
  const stuckTask = taskPage(TASK_ID, {
    status: 'Review',
    agent: 'Claude Sonnet',
    lastEdited: '2026-09-08T05:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    result: 'published',
    closedAt: '2026-09-08T04:50:00.000Z', // completedAt still missing -> unresolved
  });
  const closedEvent = eventPage('evt-current', {
    actor: 'Claude',
    startedAt: '2026-09-08T04:31:00.000Z',
    endedAt: '2026-09-08T04:45:00.000Z',
  });
  const first = harness({ tasks: [stuckTask], events: [closedEvent], scriptProperties: baseProps });
  first.sandbox.pollTaskChanges();
  assert.deepEqual(JSON.parse(first.scriptProps.get('STALE_COMPLETION_RETRY_IDS')), [TASK_ID]);

  // Second poll: the incremental TASKS_QUERY route now returns nothing for
  // this Task at all -- simulating it aging out of the last_edited_time
  // window, since the unresolved finding itself never re-edits the page --
  // but Completed At has since been filled in directly on the page (a
  // human/agent fixed the evidence). Only a direct per-ID fetch of the
  // retry-tracked id can discover that.
  const resolvedTask = taskPage(TASK_ID, {
    status: 'Review',
    agent: 'Claude Sonnet',
    lastEdited: '2026-09-09T00:00:00.000Z',
    startedAt: '2026-09-08T04:31:00.000Z',
    result: 'published',
    closedAt: '2026-09-08T04:50:00.000Z',
    completedAt: '2026-09-08T04:50:00.000Z',
  });
  let getRequests = 0;
  const routes2 = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [closedEvent], has_more: false }),
    ['GET /v1/pages/' + TASK_ID]: () => {
      getRequests += 1;
      return resolvedTask;
    },
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const carriedProps = Object.assign({}, baseProps, {
    STALE_COMPLETION_RETRY_IDS: first.scriptProps.get('STALE_COMPLETION_RETRY_IDS'),
    LAST_SYNC_CURSOR: first.scriptProps.get('LAST_SYNC_CURSOR'),
    LAST_SYNC_CURSOR_TIE_OFFSET: first.scriptProps.get('LAST_SYNC_CURSOR_TIE_OFFSET') || '0',
    BOOTSTRAP_ACTIVE_DONE: first.scriptProps.get('BOOTSTRAP_ACTIVE_DONE') || '',
  });
  const second = loadCodeGsSandbox({ scriptProperties: carriedProps, fetch: notionFetchStub(routes2) });

  const summary2 = second.sandbox.pollTaskChanges();

  assert.equal(getRequests, 1, 'expected exactly one direct per-ID fetch of the retry-tracked Task');
  assert.ok(
    summary2.outcomes.some((o) => /^stale_status_promoted_to_done:/.test(o)),
    'expected the retry-fetched Task to be promoted: ' + JSON.stringify(summary2.outcomes)
  );
  assert.deepEqual(JSON.parse(second.scriptProps.get('STALE_COMPLETION_RETRY_IDS')), []);
});

// --- Codex, PR #43 (round 2): bound and correctly index retry-set work ---

test('retry-set reconciliation is bounded by its own wall-clock budget and rotates unattempted ids to the front for next run', () => {
  const baseProps = { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' };
  const idA = '3d5fbd82-6f3b-8138-833f-dbd841a2c3a1';
  const idB = '3d5fbd82-6f3b-8138-833f-dbd841a2c3a2';
  const idC = '3d5fbd82-6f3b-8138-833f-dbd841a2c3a3';

  function stuckTaskFor(id) {
    // closedAt present, completedAt missing -> always evaluates unresolved,
    // regardless of when it's checked, so this test can isolate the retry
    // loop's own bounding/rotation behavior from evidence evaluation.
    return taskPage(id, {
      status: 'Review',
      agent: 'Claude Sonnet',
      lastEdited: '2026-09-08T05:00:00.000Z',
      startedAt: '2026-09-08T04:31:00.000Z',
      result: 'published',
      closedAt: '2026-09-08T04:50:00.000Z',
    });
  }

  const getCalls = [];
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    ['GET /v1/pages/' + idA]: () => { getCalls.push('A'); return stuckTaskFor(idA); },
    ['GET /v1/pages/' + idB]: () => { getCalls.push('B'); return stuckTaskFor(idB); },
    ['GET /v1/pages/' + idC]: () => { getCalls.push('C'); return stuckTaskFor(idC); },
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };

  // The retry loop must always attempt at least its first id (runStartedAt
  // itself, captured on the very first Date access) regardless of the
  // clock; every access after that returns a moment 10 minutes later, far
  // past RETRY_RECONCILE_BUDGET_MS (60s) -- so id A is attempted, and the
  // loop must stop there rather than also attempting B or C.
  const BASE = Date.parse('2026-09-09T00:00:00.000Z');
  let dateCalls = 0;
  const now = () => {
    dateCalls += 1;
    return dateCalls === 1 ? BASE : BASE + 10 * 60 * 1000;
  };

  const { scriptProps, sandbox } = loadCodeGsSandbox({
    scriptProperties: Object.assign({}, baseProps, {
      STALE_COMPLETION_RETRY_IDS: JSON.stringify([idA, idB, idC]),
      LAST_SYNC_CURSOR: '2026-09-08T05:00:00.000Z',
      BOOTSTRAP_ACTIVE_DONE: '1',
    }),
    fetch: notionFetchStub(routes),
    now,
  });

  sandbox.pollTaskChanges();

  assert.deepEqual(getCalls, ['A'], 'only the first retry-set id should be fetched once the budget is exhausted');
  assert.deepEqual(
    JSON.parse(scriptProps.get('STALE_COMPLETION_RETRY_IDS')),
    [idB, idC, idA],
    'ids the budget never reached (B, C) rotate to the front; the attempted-but-still-unresolved id (A) moves to the back'
  );
});

test('outcomes are correctly aligned to a resumed slice of tasksToProcess when finalizing the retry set', () => {
  // Regression for Codex round 2: outcomes[] is 0-indexed from startIndex,
  // not from 0. A prior capped run leaves LAST_SYNC_CURSOR_TIE_OFFSET set,
  // which makes THIS run's startIndex > 0 -- the finalize step must read
  // outcomes[i - startIndex], not outcomes[i], or it associates the wrong
  // Task with the wrong outcome. Made observable here by giving the
  // resumed Task an *unresolved* (not promoted) outcome: the old,
  // misaligned code would read tasksToProcess[0]'s (idSkip's, never
  // actually reconciled) slot as outcomes[0] -- which is really
  // idResumed's unresolved outcome -- wrongly queuing idSkip, while
  // tasksToProcess[1] (idResumed itself) reads outcomes[1], out of bounds
  // (undefined), so the Task that IS genuinely unresolved never gets
  // queued at all.
  const tiedEdit = '2026-09-08T05:00:00.000Z';
  // idSkip shares the tied cursor timestamp and is the one member the tie
  // offset (1) already covers -- present in tasksToProcess but never
  // actually reconciled this run.
  const idSkip = '3d5fbd82-6f3b-8138-833f-dbd841a2c3a4';
  // idResumed is the Task this run actually reconciles, immediately after
  // the tie-skip. Completed At is deliberately missing, so its real
  // outcome is stale_completion_evidence_unresolved:, not a promotion.
  const idResumed = '3d5fbd82-6f3b-8138-833f-dbd841a2c3a5';

  const taskSkip = taskPage(idSkip, {
    status: 'Blocked',
    agent: 'Claude Sonnet',
    lastEdited: tiedEdit,
    startedAt: '2026-09-08T04:00:00.000Z',
  });
  const taskResumed = taskPage(idResumed, {
    status: 'Review',
    agent: 'Claude Sonnet',
    lastEdited: tiedEdit,
    startedAt: '2026-09-08T04:31:00.000Z',
    result: 'published',
    closedAt: '2026-09-08T04:50:00.000Z',
  });
  const closedEvent = eventPage('evt-resumed', {
    actor: 'Claude',
    startedAt: '2026-09-08T04:31:00.000Z',
    endedAt: '2026-09-08T04:45:00.000Z',
  });

  const routes = {
    [TASKS_QUERY]: () => ({ results: [taskSkip, taskResumed], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [closedEvent], has_more: false }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: {
      NOTION_TOKEN: 'test-token',
      SPREADSHEET_ID: 'test-sheet',
      LAST_SYNC_CURSOR: tiedEdit,
      LAST_SYNC_CURSOR_TIE_OFFSET: '1',
      BOOTSTRAP_ACTIVE_DONE: '1',
    },
    fetch: notionFetchStub(routes),
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes.length, 1, 'the tie-skipped Task must not be reconciled or reported at all: ' + JSON.stringify(summary.outcomes));
  assert.match(summary.outcomes[0], /^stale_completion_evidence_unresolved:missing_completed_at$/);
  assert.deepEqual(
    JSON.parse(scriptProps.get('STALE_COMPLETION_RETRY_IDS') || '[]'),
    [idResumed],
    'the genuinely unresolved Task (idResumed) must be queued -- and the never-reconciled idSkip must not be'
  );
});
