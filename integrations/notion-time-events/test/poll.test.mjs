import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, notionFetchStub } from './support/gas-sandbox.mjs';

const TASKS_DS = 'fc5e770f-c68e-4799-afe7-ec4bff0dab59';
const EVENTS_DS = '544b9a17-2653-47aa-b62c-bb52425b3bf2';
const TASKS_QUERY = 'POST /v1/data_sources/' + TASKS_DS + '/query';
const EVENTS_QUERY = 'POST /v1/data_sources/' + EVENTS_DS + '/query';

function taskPage(id, { status, agent, lastEdited, startedAt = null, title = 'T', pullRequest = null, type = null }) {
  return {
    object: 'page',
    id,
    url: 'https://www.notion.so/' + id.replace(/-/g, ''),
    last_edited_time: lastEdited,
    last_edited_by: { object: 'user', id: 'user-1' },
    parent: { type: 'data_source_id', data_source_id: TASKS_DS },
    properties: {
      Title: { type: 'title', title: [{ plain_text: title }] },
      // `Stories & Tasks`.Status is a `select` property in the real database
      // schema, not Notion's distinct `status` property type — this fixture
      // mirrors that so a regression back to the `status` shape in Code.gs
      // (see the "Status property schema contract" tests below) shows up
      // here rather than only against the live API.
      Status: { type: 'select', select: { name: status } },
      'Assigned Agent': { type: 'select', select: agent ? { name: agent } : null },
      'Started At': { type: 'date', date: startedAt ? { start: startedAt } : null },
      Result: { type: 'rich_text', rich_text: [] },
      'Completed At': { type: 'date', date: null },
      // `Stories & Tasks`.`Pull Request` is a `url` property in the real
      // schema, not rich_text — see propertyText_'s `url` branch (ADP-051).
      'Pull Request': { type: 'url', url: pullRequest },
      // `type` defaults to null (rendered as no Type at all) so every
      // existing fixture keeps reading as a normal executable Task/Subtask —
      // only tests that explicitly pass `type: 'Story'` exercise the
      // Story-exclusion path (BUG-ADP-TTE-01).
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

// A sandbox whose Notion stub answers with `tasks` for the Stories & Tasks
// query and `events` for the Task Time Events query, and accepts writes.
function harness({ tasks = [], events = [], scriptProperties = {}, lockHeld = false, now, noEventsForTaskIds = [] } = {}) {
  const routes = {
    [TASKS_QUERY]: () => ({ results: tasks, has_more: false }),
    // The mock can't actually scope `events` per Task (there's no Task
    // relation on the eventPage fixtures), so every task's query sees the
    // same configured `events` by default — relied on throughout. A few
    // tests need one specific Task to genuinely see no history (e.g. one
    // that was never In Progress), which noEventsForTaskIds carves out.
    [EVENTS_QUERY]: (body) => {
      const requestedTaskId = body && body.filter && body.filter.relation && body.filter.relation.contains;
      if (requestedTaskId && noEventsForTaskIds.indexOf(requestedTaskId) >= 0) return { results: [], has_more: false };
      return { results: events, has_more: false };
    },
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

test('leaving In Progress with nothing open retroactively stamps the last closed event as the execution boundary', () => {
  // The only event was already closed by an earlier reassignment (nothing
  // left open to close here), but the Task's execution still genuinely
  // ends at this moment — enforceDoneGate_ needs a marker to tell this
  // apart from a still-current reassignment-only execution.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Review',
      agent: 'Human',
      lastEdited: '2026-08-30T06:00:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
    })],
    events: [
      eventPage('evt-reassigned', {
        actor: 'Claude',
        startedAt: '2026-08-30T05:10:00.000Z',
        endedAt: '2026-08-30T05:30:00.000Z',
        note: 'Reason=reassignment',
      }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /boundary:evt-reassigned/);
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-reassigned');
  assert.equal(patches.length, 1);
  const note = JSON.parse(patches[0].options.payload).properties.Note.rich_text[0].text.content;
  assert.match(note, /Reason=reassignment/);
  assert.match(note, /Boundary=left_in_progress/);
  // The event predated Execution= (no marker on the fixture above). The
  // boundary stamp deliberately never backfills it — see the dedicated
  // tests below for why (an earlier version did, and why that was unsafe).
  assert.doesNotMatch(note, /Execution=/);
});

test('a Story In Progress opens no Time Event (BUG-ADP-TTE-01)', () => {
  // Type = Story is a rollup over its own child Subtasks/Tasks, not an
  // execution unit — before this exclusion, a Story sitting In Progress (its
  // ordinary state for as long as child work is in flight) opened its own
  // Active Time Event exactly like an executable Task, double-counting hours
  // already timed on its children.
  const taskId = '3b9fbd82-6f3b-81c6-988a-f5a92f93df28';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T05:10:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
      type: 'Story',
    })],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'story_excluded');
  assert.equal(requestsTo(fetchLog, 'POST', '/v1/pages').length, 0);
});

test('a Story\'s stray open Time Event from before the exclusion existed gets archived, not left to linger', () => {
  const taskId = '3b9fbd82-6f3b-81c6-988a-f5a92f93df28';
  const { sandbox, fetchLog } = harness({
    // TASK_ORIGIN_BACKFILL_COMPLETE: this event has no Task Origin= marker
    // (it predates that feature), and reconcileStoryTask_'s archive
    // fallback now gates on the provenance backfill having fully drained
    // at least once -- see its own comment (Codex-reported gap, round 19).
    // Simulates the operator having already run backfillTaskOriginProvenance_
    // to completion, per the documented upgrade order.
    scriptProperties: { TASK_ORIGIN_BACKFILL_COMPLETE: 'true' },
    tasks: [taskPage(taskId, {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T06:00:00.000Z',
      startedAt: '2026-08-12T12:42:00.000Z',
      type: 'Story',
    })],
    events: [
      eventPage('evt-story-stray', { actor: 'Claude', startedAt: '2026-08-12T12:42:00.000Z' }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'archived_story_event:evt-story-stray');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-story-stray');
  assert.equal(patches.length, 1);
  const payload = JSON.parse(patches[0].options.payload);
  // Archived, not closed: no Ended At, so no fictitious Duration (h) can
  // ever compute for this stray interval.
  assert.equal(payload.archived, true);
  assert.equal(payload.properties['Ended At'], undefined);
  const note = payload.properties.Note.rich_text[0].text.content;
  assert.match(note, /Reason=story_excluded/);
  // Never re-opened for the same still-In-Progress Story on this same call.
  assert.equal(requestsTo(fetchLog, 'POST', '/v1/pages').length, 0);
});

test('an ordinary poll also archives a Story\'s already-closed legacy Time Event, not only open ones', () => {
  // Codex-reported gap: reconcileStoryTask_ originally filtered to
  // openEvents only, so a Story that had already left In Progress under
  // the pre-fix reconciler — the ordinary case for most Stories, since a
  // Story sitting In Progress forever is the exception — kept its closed,
  // fictitiously-durationed legacy event untouched even when the Story
  // itself was later edited and picked up by a normal incremental poll.
  const taskId = '3b9fbd82-6f3b-81c6-988a-f5a92f93df28';
  const { sandbox, fetchLog } = harness({
    // See the previous test's comment on TASK_ORIGIN_BACKFILL_COMPLETE.
    scriptProperties: { TASK_ORIGIN_BACKFILL_COMPLETE: 'true' },
    tasks: [taskPage(taskId, {
      status: 'Review',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T06:00:00.000Z',
      startedAt: '2026-08-12T12:42:00.000Z',
      type: 'Story',
    })],
    events: [
      eventPage('evt-story-legacy-closed', {
        actor: 'Claude',
        startedAt: '2026-08-12T12:42:00.000Z',
        endedAt: '2026-08-20T09:00:00.000Z',
      }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'archived_story_event:evt-story-legacy-closed');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-story-legacy-closed');
  assert.equal(patches.length, 1);
  assert.equal(JSON.parse(patches[0].options.payload).archived, true);
});

test('a Story reaching Done needs no Time Event and is never rolled back by the Done gate', () => {
  const taskId = '3b9fbd82-6f3b-81c6-988a-f5a92f93df28';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Done',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T06:00:00.000Z',
      startedAt: '2026-08-12T12:42:00.000Z',
      type: 'Story',
      // Deliberately no Result / Completed At — a Story needs none of the
      // Done-gate evidence an executable Task does.
    })],
    noEventsForTaskIds: [taskId],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'story_excluded');
  // No rollback write to Status, unlike an executable Task's
  // done_gate_rejected path (enforceDoneGate_ -> updateTaskStatus_).
  const statusWrites = requestsTo(fetchLog, 'PATCH', '/v1/pages/' + taskId).filter((entry) =>
    JSON.parse(entry.options.payload).properties && JSON.parse(entry.options.payload).properties.Status
  );
  assert.equal(statusWrites.length, 0);
});

test('re-reading an unchanged Story in the overlap window makes no Notion mutation', () => {
  const taskId = '3b9fbd82-6f3b-81c6-988a-f5a92f93df28';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T05:10:00.000Z',
    startedAt: '2026-08-30T05:10:00.000Z',
    type: 'Story',
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

test('boundary-stamping a legacy event never backfills Execution=, even when it is this Task\'s own only execution', () => {
  // Codex-reported gap in an EARLIER version of this boundary-stamp: it used
  // to backfill Execution= from the Task's own CURRENT Started At whenever
  // the event had none yet, specifically to save this exact case (a legacy
  // event that is genuinely the Task's only, current execution) from being
  // wrongly excluded by the legacy Reason/Boundary heuristic. That backfill
  // was itself later found unsafe: this call site cannot tell this case
  // apart from a Task reopened and restarted entirely inside one poll
  // window (see the "stale Started At" test below), where the same backfill
  // would tag a genuinely STALE old event as belonging to a new execution it
  // has nothing to do with. The safe fix removed the backfill outright — the
  // Boundary= marker still gets stamped (still useful to the legacy
  // heuristic), but Execution= is deliberately left absent, reintroducing
  // this narrower, documented limitation (see README "Known limitations")
  // rather than risk the other, worse failure mode.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43daa05';
  const legacyEvent = eventPage('evt-legacy-only-execution', {
    actor: 'Claude',
    startedAt: '2026-08-30T05:00:00.000Z',
    endedAt: '2026-08-30T05:20:00.000Z',
    note: 'Reason=reassignment', // legacy: predates Execution=
  });
  const task = taskPage(taskId, {
    status: 'Review',
    agent: 'Human',
    lastEdited: '2026-08-30T05:30:00.000Z',
    startedAt: '2026-08-30T05:00:00.000Z', // this Task's one and only execution
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [legacyEvent] });

  const summary = sandbox.pollTaskChanges();
  assert.match(summary.outcomes[0], /boundary:evt-legacy-only-execution/);
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-legacy-only-execution');
  const note = JSON.parse(patches[0].options.payload).properties.Note.rich_text[0].text.content;
  assert.match(note, /Boundary=left_in_progress/);
  assert.doesNotMatch(note, /Execution=/, 'expected no Execution= backfill from this call site');

  // Simulate the stamp having landed, then attempt Done for this same
  // (only) execution: the accepted regression — this now falls back to the
  // legacy Reason/Boundary heuristic (no Execution= to short-circuit it)
  // and is rejected, exactly the pre-existing "Known limitations" gap this
  // fix intentionally reopened in exchange for closing the worse one.
  legacyEvent.properties.Note = {
    type: 'rich_text',
    rich_text: [{ plain_text: note }],
  };
  const doneTask = taskPage(taskId, {
    status: 'Done',
    agent: 'Human',
    lastEdited: '2026-08-30T05:35:00.000Z',
    startedAt: '2026-08-30T05:00:00.000Z',
  });
  doneTask.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
  doneTask.properties['Completed At'] = { type: 'date', date: { start: '2026-08-30T05:35:00.000Z' } };
  const outcome = sandbox.enforceDoneGate_(doneTask, [legacyEvent], []);

  assert.match(outcome, /^done_gate_rejected:/);
});

test('a Started At that predates a boundary-marked prior close is correctly rejected, not wrongly trusted from a backfilled Execution=', () => {
  // The failure mode the Execution= backfill removal above exists to
  // prevent. taskStartedAtTrusted (enforceDoneGate_) exists specifically to
  // catch a Started At that was not genuinely advanced past every
  // prior-execution event already on file — here, Started At (07:00) is
  // actually EARLIER than a boundary-marked prior close's own Started/Ended
  // At (07:50/08:00), the exact anomaly that check exists to catch. A
  // backfill that instead trusted this (unreliable) current Started At to
  // retroactively tag that same prior-execution event as Execution=07:00
  // would flip it from "prior" to "current" in enforceDoneGate_'s own
  // classification — silently erasing the one signal that would have
  // flagged Started At as stale, AND making that same event eligible as the
  // applicable closed event for Done (its own Started At, 07:50, is at or
  // after the now-"trusted" 07:00) — wrongly passing Done on an execution
  // that was never actually timed.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43daa06';
  const staleEvent = eventPage('evt-stale-old-execution', {
    actor: 'Claude',
    startedAt: '2026-08-30T07:50:00.000Z',
    endedAt: '2026-08-30T08:00:00.000Z',
    note: 'Reason=reassignment', // legacy: predates Execution=
  });
  const reopenedTask = taskPage(taskId, {
    status: 'Review',
    agent: 'Human',
    lastEdited: '2026-08-30T08:10:00.000Z',
    // Claims a fresh restart, but is actually EARLIER than evidence already
    // on file for what should be a finished prior execution.
    startedAt: '2026-08-30T07:00:00.000Z',
  });
  const { sandbox, fetchLog } = harness({ tasks: [reopenedTask], events: [staleEvent] });

  const summary = sandbox.pollTaskChanges();
  assert.match(summary.outcomes[0], /boundary:evt-stale-old-execution/);
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-stale-old-execution');
  const note = JSON.parse(patches[0].options.payload).properties.Note.rich_text[0].text.content;
  assert.doesNotMatch(note, /Execution=/, 'expected no Execution= backfilled from the Task\'s (unreliable) current Started At');

  // Simulate the stamp having landed, then attempt Done with an unchanged,
  // never-re-timed Result for the (invisible) new execution.
  staleEvent.properties.Note = {
    type: 'rich_text',
    rich_text: [{ plain_text: note }],
  };
  const doneTask = taskPage(taskId, {
    status: 'Done',
    agent: 'Human',
    lastEdited: '2026-08-30T08:15:00.000Z',
    startedAt: '2026-08-30T07:00:00.000Z',
  });
  doneTask.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
  doneTask.properties['Completed At'] = { type: 'date', date: { start: '2026-08-30T08:15:00.000Z' } };
  const outcome = sandbox.enforceDoneGate_(doneTask, [staleEvent], []);

  // Correctly rejected as stale — the prior-execution close's own timing
  // out-dates the claimed Started At, and must still be visible as prior
  // evidence rather than laundered into looking like current-execution
  // proof.
  assert.match(outcome, /^done_gate_rejected:stale_task_started_at/);
});

test('re-observing a Task already closed normally does not retroactively stamp its ordinary close as a boundary', () => {
  // Codex-reported gap in the boundary-stamping fix above: a Task that left
  // In Progress *normally* (its open event closed with the plain
  // 'left_in_progress' reason on an earlier poll) has zero open events on
  // every later re-observation too, e.g. because an unrelated property like
  // Result got edited while it sat in Review — that unrelated edit alone
  // reaches this same "nothing open" branch again. A plain 'left_in_progress'
  // close is already unambiguous prior-execution evidence by Reason alone
  // and never needed the marker; stamping it here anyway would make
  // enforceDoneGate_'s tie-seed wrongly exclude it even when it is the
  // genuinely CURRENT applicable event, rejecting a legitimate Done as
  // stale_task_started_at.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f04';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Review',
      agent: 'Human',
      // A later, unrelated re-observation — well after the close below.
      lastEdited: '2026-08-30T06:30:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
    })],
    events: [
      eventPage('evt-normally-closed', {
        actor: 'Claude',
        startedAt: '2026-08-30T05:10:00.000Z',
        endedAt: '2026-08-30T06:00:00.000Z', // already closed by an earlier, ordinary poll
        note: 'Reason=left_in_progress',
      }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'no_change:Review');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-normally-closed');
  assert.equal(patches.length, 0, 'expected no PATCH — the ordinary close needs no retroactive boundary marker');
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

test('a truncated active-Task bootstrap query keeps retrying (and resuming) on later runs instead of never running again', () => {
  // Regression: a deployment with more simultaneously In Progress Tasks than
  // the pagination safety limit used to have the bootstrap active-Task query
  // truncate on its first (and only) attempt, since it was gated on
  // `isBootstrap` (LAST_SYNC_CURSOR unset) — but the first run still sets
  // that cursor from the incremental query regardless, so every subsequent
  // run saw isBootstrap = false and never issued the active-Task query
  // again. Whatever active Task fell past the truncation point (and is old
  // enough to also never re-enter a future incremental window) would then
  // never receive its required open Time Event.
  const staleActiveA = taskPage('3cafbd82-6f3b-8158-9622-d795b43dg001', {
    status: 'In Progress', agent: 'Claude Opus',
    lastEdited: '2026-08-01T00:00:00.000Z', startedAt: '2026-08-01T00:00:00.000Z',
  });
  const staleActiveB = taskPage('3cafbd82-6f3b-8158-9622-d795b43dg002', {
    status: 'In Progress', agent: 'Claude Opus',
    lastEdited: '2026-08-01T00:01:00.000Z', startedAt: '2026-08-01T00:01:00.000Z',
  });
  // Force paginateNotionQuery_'s truncation on the first (un-resumed) active
  // query by claiming more exist for QUERY_PAGE_SAFETY_LIMIT (50) pages —
  // only the first page carries a Task, the rest are empty-but-more, so the
  // truncated result set ends up containing exactly staleActiveA, not 50
  // copies of it. The resumed (second) call returns staleActiveB directly.
  let firstAttemptPages = 0;
  let resumedCalls = 0;
  const routes = {
    [TASKS_QUERY]: (body) => {
      const isActiveStatusQuery = Boolean(
        (body.filter && body.filter.property === 'Status') ||
        (body.filter && body.filter.and && body.filter.and.some((f) => f.property === 'Status'))
      );
      if (!isActiveStatusQuery) return { results: [], has_more: false };
      const resumed = Boolean(body.filter.and);
      if (!resumed) {
        firstAttemptPages += 1;
        return {
          results: firstAttemptPages === 1 ? [staleActiveA] : [],
          has_more: true,
          next_cursor: 'c' + firstAttemptPages,
        };
      }
      resumedCalls += 1;
      return { results: [staleActiveB], has_more: false };
    },
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
  });

  const firstRun = sandbox.pollTaskChanges();
  assert.equal(firstRun.bootstrap, true);
  assert.equal(scriptProps.get('BOOTSTRAP_ACTIVE_DONE'), undefined); // not yet done: truncated
  assert.ok(scriptProps.get('BOOTSTRAP_ACTIVE_RESUME_CURSOR'), 'expected a resume cursor after the truncated bootstrap attempt');
  // Cursor still advanced from the (untruncated) incremental side — proving
  // this run alone would, under the old coupling, have permanently disabled
  // any future bootstrap attempt.
  assert.ok(scriptProps.get('LAST_SYNC_CURSOR'));

  const secondRun = sandbox.pollTaskChanges();
  assert.equal(secondRun.bootstrap, false); // LAST_SYNC_CURSOR is set now — this is the exact case the old code got wrong
  const openedB = secondRun.outcomes.some((o) => o === 'opened:evt-created');
  assert.ok(openedB, 'expected the second run to still retry the active-Task query and reach staleActiveB: ' + JSON.stringify(secondRun.outcomes));
  assert.equal(scriptProps.get('BOOTSTRAP_ACTIVE_DONE'), '1');
  assert.equal(scriptProps.get('BOOTSTRAP_ACTIVE_RESUME_CURSOR'), '');

  // A third run must not issue the active-Task query at all any more.
  const beforeThirdRun = resumedCalls;
  const firstAttemptPagesBefore = firstAttemptPages;
  sandbox.pollTaskChanges();
  assert.equal(resumedCalls, beforeThirdRun);
  assert.equal(firstAttemptPages, firstAttemptPagesBefore);
});

test('the resumed active-Task bootstrap query uses on_or_after and correctly resumes within a tied timestamp', () => {
  // Mirrors the backfill's tie-resume test: a strict `after` filter would
  // silently drop the remainder of a tied group of active Tasks once the
  // pagination limit lands inside one. Models a realistic boundary: 47
  // active Tasks with distinct timestamps, then a tied group of 8 sharing
  // one timestamp that straddles the truncation point.
  const distinctCount = 47;
  const tiedTimestamp = '2026-08-01T02:00:00.000Z';
  const allTasks = [];
  for (let i = 1; i <= distinctCount; i++) {
    allTasks.push(taskPage('3cafbd82-6f3b-8158-9622-d795b43dk' + String(i).padStart(3, '0'), {
      status: 'In Progress', agent: 'Claude Opus',
      lastEdited: '2026-08-01T00:' + String(i).padStart(2, '0') + ':00.000Z',
      startedAt: '2026-08-01T00:' + String(i).padStart(2, '0') + ':00.000Z',
    }));
  }
  for (let i = 1; i <= 8; i++) {
    allTasks.push(taskPage('3cafbd82-6f3b-8158-9622-d795b43dl' + String(i).padStart(3, '0'), {
      status: 'In Progress', agent: 'Claude Opus', lastEdited: tiedTimestamp, startedAt: tiedTimestamp,
    }));
  }

  const resumedFilters = [];
  const routes = {
    [TASKS_QUERY]: (body) => {
      const isActiveStatusQuery = Boolean(
        (body.filter && body.filter.property === 'Status') ||
        (body.filter && body.filter.and && body.filter.and.some((f) => f.property === 'Status'))
      );
      if (!isActiveStatusQuery) return { results: [], has_more: false };
      const resumed = Boolean(body.filter.and);
      if (resumed) resumedFilters.push(body.filter);
      const pageIndex = body.start_cursor ? Number(body.start_cursor) : (resumed ? distinctCount : 0);
      const task = allTasks[pageIndex];
      if (!task) return { results: [], has_more: false };
      return { results: [task], has_more: pageIndex + 1 < allTasks.length, next_cursor: String(pageIndex + 1) };
    },
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
  });

  const firstRun = sandbox.pollTaskChanges();
  assert.equal(firstRun.bootstrap, true);
  assert.equal(scriptProps.get('BOOTSTRAP_ACTIVE_RESUME_TIE_OFFSET'), '3'); // 3 of the 8 tied retrieved in the truncated batch

  const secondRun = sandbox.pollTaskChanges();

  const opened = secondRun.outcomes.filter((o) => /^opened:/.test(o));
  assert.equal(opened.length, 5, 'expected the 5 remaining tied active Tasks to be reached: ' + JSON.stringify(secondRun.outcomes));
  assert.equal(scriptProps.get('BOOTSTRAP_ACTIVE_DONE'), '1');
  const onOrAfterClause = resumedFilters[0].and.find((f) => f.timestamp === 'last_edited_time');
  assert.ok(onOrAfterClause.last_edited_time.on_or_after, 'expected an on_or_after (not after) clause');
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
    noEventsForTaskIds: [laterChangedTask.id],
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

test('a truncated query whose tie is entirely already covered by the resume offset does not jump the cursor past it', () => {
  // Regression: when a prior run's tie-skip already covers the FULL tied
  // prefix a truncated query returns, this run's while loop never executes
  // at all (iterated stays at startIndex === tasksToProcess.length), so
  // lastScannedEdit is never set. Falling through to `runStartedAt` in that
  // case would silently advance the cursor past whatever unretrieved data
  // caused the truncation — the exact same category of data loss the tie
  // offset mechanism exists to prevent, just triggered by a fully-consumed
  // truncated batch instead of a partially-consumed one.
  const cursor = '2026-08-30T05:59:00.000Z';
  let pageCalls = 0;
  const routes = {
    [TASKS_QUERY]: () => {
      pageCalls += 1;
      // Every page shares the exact cursor timestamp; force truncation via
      // QUERY_PAGE_SAFETY_LIMIT (50 pages) with only the first 10 carrying a
      // Task, so the truncated result set ends up with exactly 10 tied
      // items — all of which the pre-seeded tie offset below already covers.
      const task = pageCalls <= 10
        ? [taskPage('3cafbd82-6f3b-8158-9622-d795b43df' + String(pageCalls).padStart(3, '0'), {
            status: 'Ready',
            agent: 'Human',
            lastEdited: cursor,
          })]
        : [];
      return { results: task, has_more: true, next_cursor: 'c' + pageCalls };
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
      LAST_SYNC_CURSOR: cursor,
      // Already covers more than the entire truncated batch this query can
      // ever return (only 10 tied Tasks per call).
      LAST_SYNC_CURSOR_TIE_OFFSET: '1000000',
    },
    fetch: notionFetchStub(routes),
  });

  const summary = sandbox.pollTaskChanges();

  assert.deepEqual(plain(summary.outcomes), []); // nothing new was scanned this run
  assert.equal(summary.truncated, true);
  assert.equal(summary.capped, true);
  // The cursor and its tie offset must be left exactly as they were, not
  // advanced to "now" and not reset — the next run needs the same resume
  // state to keep trying (or for an operator to notice and intervene on
  // this extreme-scale case, per README "Known limitations").
  assert.equal(scriptProps.get('LAST_SYNC_CURSOR'), cursor);
  assert.equal(scriptProps.get('LAST_SYNC_CURSOR_TIE_OFFSET'), '1000000');
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
    noEventsForTaskIds: [laterChangedTask.id],
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
    noEventsForTaskIds: [laterChangedTask.id],
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

test('a mid-execution reassignment opens the replacement actor at the reassignment boundary, not the execution start', () => {
  // Regression: `allEvents` is fetched before this same call's own
  // otherActor.forEach closes the outgoing actor's event, so its in-memory
  // copy still shows no Ended At and latestEventTimestamp_ can't see the
  // reassignment. Without accounting for that, the unchanged Task-level
  // Started At (correctly representing the whole execution's true start)
  // looks "trusted" and the replacement actor's event opens there instead
  // of at the reassignment boundary — overlapping the outgoing actor's own
  // interval and double-counting effort.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43daa01';
  const outgoingOpenEvent = eventPage('evt-outgoing', {
    actor: 'Claude',
    startedAt: '2026-08-30T05:00:00.000Z', // matches the Task's own Started At below
    endedAt: null,
  });
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Human', // reassigned away from Claude
    lastEdited: '2026-08-30T05:20:00.000Z', // the reassignment moment
    startedAt: '2026-08-30T05:00:00.000Z', // the execution's true (unrelated, earlier) start
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [outgoingOpenEvent] });

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  assert.equal(creates[0].properties['Started At'].date.start, '2026-08-30T05:20:00.000Z');
});

test('a first-ever open event stamps Execution= with the interval\'s own computed start', () => {
  // Codex-reported gap: enforceDoneGate_'s execution-membership check needs
  // an explicit Execution= identifier (not inferred from timestamp ties or
  // Reason markers) to correctly disambiguate a coincidental Ended At tie
  // between two different executions' closes. reconcileAuthoritativeTime
  // Events_ must actually stamp it on every newly opened event for that to
  // work at all.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43daa02';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T05:10:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
    })],
  });

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  const note = creates[0].properties.Note.rich_text[0].text.content;
  assert.match(note, /Execution=2026-08-30T05:10:00\.000Z/);
});

test('a reassignment replacement inherits the outgoing event\'s own Execution= marker, not a fresh one', () => {
  // The execution identifier must stay identical across every event
  // belonging to one continuous execution: a reassignment never starts a
  // new execution, only leaving In Progress does. If the replacement event
  // got its OWN fresh Execution= (e.g. from the reassignment boundary
  // instead of the outgoing event's original value), a later Done check
  // would see two DIFFERENT Execution= values for what is actually one
  // execution's two closed events, wrongly treating one of them as prior
  // evidence against itself.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43daa03';
  const outgoingOpenEvent = eventPage('evt-outgoing', {
    actor: 'Claude',
    startedAt: '2026-08-30T05:00:00.000Z',
    endedAt: null,
    note: 'Execution=2026-08-30T05:00:00.000Z', // this execution's original identity
  });
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Human', // reassigned away from Claude
    lastEdited: '2026-08-30T05:20:00.000Z', // the reassignment moment
    startedAt: '2026-08-30T05:00:00.000Z',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [outgoingOpenEvent] });

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  const note = creates[0].properties.Note.rich_text[0].text.content;
  // Inherited from the outgoing event — NOT the reassignment boundary
  // (05:20) that this same replacement event's own Started At correctly is.
  assert.match(note, /Execution=2026-08-30T05:00:00\.000Z/);
  assert.equal(creates[0].properties['Started At'].date.start, '2026-08-30T05:20:00.000Z');
});

test('a reassignment replacing a legacy (pre-Execution=) outgoing event manufactures no Execution= marker at all, deferring to the legacy Reason heuristic', () => {
  // Model/Invariant Review I2/I3, scenario S19 (PR #17 Codex finding "Reject
  // ambiguous legacy handoffs instead of trusting Started At"): when the
  // outgoing event predates this field entirely (a live deployment upgraded
  // mid-execution), outgoingExecutionId is empty. An earlier version of this
  // fallback then backfilled the Task's raw Started At as the replacement's
  // identity — but nothing here verifies Started At still reflects this
  // exact, still-open execution rather than having drifted from an
  // unrelated edit (or the same invisible-reopen risk `startAt`'s own
  // fallback already guards against). A marker manufactured from an
  // unverified value is worse than no marker: enforceDoneGate_'s Execution=
  // pass authoritatively excludes a *mismatched* event even when the legacy
  // Reason-based heuristic would have correctly kept it in, turning a
  // self-inflicted mismatch into Done wrongly blocked later. So this
  // replacement must carry no Execution= marker at all, leaving membership
  // to the same Reason=reassignment heuristic that already, correctly,
  // covers the outgoing event it replaces (see the regression-guard test
  // below for confirmation Done still passes correctly this way).
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43daa04';
  const legacyOutgoingEvent = eventPage('evt-legacy-outgoing', {
    actor: 'Claude',
    startedAt: '2026-08-30T05:00:00.000Z',
    endedAt: null,
    // No Execution= at all: this event predates the field.
  });
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Human', // reassigned away from Claude
    lastEdited: '2026-08-30T05:20:00.000Z', // the reassignment moment
    startedAt: '2026-08-30T05:00:00.000Z', // the execution's true, unchanged start
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [legacyOutgoingEvent] });

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  const note = creates[0].properties.Note.rich_text[0].text.content;
  assert.doesNotMatch(note, /Execution=/);
  // The replacement's own Started At is still correctly the reassignment
  // boundary (05:20), independent of this identity question.
  assert.equal(creates[0].properties['Started At'].date.start, '2026-08-30T05:20:00.000Z');
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

test('setup creates the Time Events projection tab when the spreadsheet does not already have one', () => {
  // Regression for the Codex-reported gap: sheet_() throws on a missing tab
  // — correct for callers during normal reconciliation (a missing tab there
  // means setup was never run) — but ensureProjectionHeaders_ IS setup's own
  // initialization step, so on a genuinely brand-new spreadsheet with no
  // "Time Events" tab yet, that same strictness made setup() itself throw
  // before it ever got the chance to create one.
  const { sandbox, spreadsheet } = harness();
  spreadsheet.sheets.delete('Time Events');
  assert.equal(spreadsheet.getSheetByName('Time Events'), null);

  assert.doesNotThrow(function () {
    sandbox.setup();
  });

  const sheet = spreadsheet.getSheetByName('Time Events');
  assert.ok(sheet, 'expected setup() to create the Time Events tab');
  assert.equal(sheet.rows[0][0], 'Event ID');
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

test('backfillResultFingerprints_ resumes past what it already backfilled when truncated, instead of restarting the same prefix', () => {
  // Regression: a deployment with more Done Tasks than the pagination
  // safety limit (5000 rows / 50 pages) previously had this simply re-issue
  // the exact same unsorted query on every call — the same (truncated)
  // prefix every time, so the tail past the limit could never be reached no
  // matter how many times an operator re-ran it.
  let pageCalls = 0;
  const seenFilters = [];
  const routes = {
    [TASKS_QUERY]: (body) => {
      pageCalls += 1;
      seenFilters.push(body.filter);
      // Force paginateNotionQuery_'s own truncation (QUERY_PAGE_SAFETY_LIMIT
      // = 50 pages) by always claiming more exist, one Task per page —
      // cheap to synthesize, exercises the exact truncation path.
      const idx = pageCalls;
      const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43df' + String(idx).padStart(3, '0'), {
        status: 'Done',
        agent: 'Claude Opus',
        lastEdited: '2026-08-01T00:' + String(idx).padStart(2, '0') + ':00.000Z',
        startedAt: '2026-08-01T00:00:00.000Z',
      });
      task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
      task.properties['Completed At'] = { type: 'date', date: { start: '2026-08-01T00:30:00.000Z' } };
      return { results: [task], has_more: true, next_cursor: 'cursor-' + idx };
    },
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
  });

  const firstRun = sandbox.backfillResultFingerprints_();

  assert.equal(firstRun.truncated, true);
  assert.equal(firstRun.scanned, 50); // QUERY_PAGE_SAFETY_LIMIT
  assert.equal(seenFilters[0].property, 'Status'); // first call: no resume filter yet
  const resumeCursor = scriptProps.get('BACKFILL_RESUME_CURSOR');
  assert.ok(resumeCursor, 'expected a resume cursor to be persisted after a truncated backfill');

  sandbox.backfillResultFingerprints_();

  // The second call's query must be filtered to on-or-after the persisted
  // resume cursor — not the same bare Status filter as the first call, which
  // would just return the identical 50-page prefix again. on_or_after (not
  // a strict after) plus the local tie-offset skip is what correctly
  // resumes within a tied group instead of silently dropping its remainder
  // — see the dedicated tie test below.
  const secondCallFilter = seenFilters[seenFilters.length - 50];
  assert.ok(secondCallFilter.and, 'expected the resumed call to use a compound and-filter');
  const onOrAfterClause = secondCallFilter.and.find((f) => f.timestamp === 'last_edited_time');
  assert.equal(onOrAfterClause.last_edited_time.on_or_after, resumeCursor);
});

test('backfillResultFingerprints_ escalates past the reserved pagination budget when the persisted tie offset exceeds it, instead of deadlocking', () => {
  // Codex-reported gap in the pagination-deadline fix above: once a resumed
  // tied cohort's persisted BACKFILL_RESUME_TIE_OFFSET is at least as large
  // as what the reserved half-budget pagination phase can retrieve, EVERY
  // call re-issues the identical inclusive on_or_after query, fetches only
  // that already-consumed prefix, the local tie-offset skip consumes the
  // entire batch, and the "no progress" branch leaves persisted state
  // untouched — an exact repeat, forever, since nothing about the situation
  // changes between calls on its own. A merely-large (not pathologically
  // large) tied cohort must still make progress by escalating pagination
  // up to the full run budget when the half-budget fetch alone cannot get
  // past the offset it already has to skip.
  const tiedTimestamp = '2026-08-01T00:00:00.000Z';
  const totalRows = 60;
  const alreadyProcessed = 22; // more than the half-budget fetch below can retrieve
  const routes = {
    // One row per page (like real Notion pagination) so the wall-clock
    // deadline actually bounds how much of the tied group a single
    // pagination phase can retrieve — every member shares the identical
    // timestamp, mirroring genuine on_or_after semantics for an exact-match
    // tie: the resumed query returns the group from its own start again
    // every call, regardless of how much a prior call already consumed.
    [TASKS_QUERY]: (body) => {
      const cursor = body.start_cursor ? Number(body.start_cursor) : 0;
      if (cursor >= totalRows) return { results: [], has_more: false };
      const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43dp' + String(cursor + 1).padStart(3, '0'), {
        status: 'Done', agent: 'Claude Opus', lastEdited: tiedTimestamp, startedAt: tiedTimestamp,
      });
      task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
      task.properties['Completed At'] = { type: 'date', date: { start: tiedTimestamp } };
      return { results: [task], has_more: cursor + 1 < totalRows, next_cursor: String(cursor + 1) };
    },
    // Every row gets a matching, unstamped closing event so it genuinely
    // passes (and stays Done, visible to a later query) — this test is
    // about pagination/escalation mechanics, not the Done gate itself, and
    // a rejected Task would roll back to Review and drop out of every
    // future Status = Done query, which would make the tie-offset math this
    // test asserts on meaningless.
    [EVENTS_QUERY]: (body) => {
      const requestedTaskId = body && body.filter && body.filter.relation && body.filter.relation.contains;
      const endedAt = tiedTimestamp;
      return { results: [eventPage('evt-' + requestedTaskId, { actor: 'Claude', startedAt: tiedTimestamp, endedAt })], has_more: false };
    },
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  // 6 simulated seconds per Date() read: the reserved half-budget deadline
  // (120s) lands around page ~20 — comfortably short of alreadyProcessed
  // (22) — while the MIN_PROCESSING_RESERVE_MS-shortened extended deadline
  // (240s - 65s = 175s) still reaches past it.
  let ticks = 0;
  const now = () => {
    ticks += 1;
    return ticks * 6 * 1000;
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: {
      NOTION_TOKEN: 'test-token',
      SPREADSHEET_ID: 'test-sheet',
      BACKFILL_RESUME_CURSOR: tiedTimestamp,
      BACKFILL_RESUME_TIE_OFFSET: String(alreadyProcessed),
    },
    fetch: notionFetchStub(routes),
    now,
  });

  const summary = sandbox.backfillResultFingerprints_();

  assert.ok(summary.scanned > 0, 'expected the escalation to still make progress: got ' + summary.scanned);
  // The tie offset must have advanced past what was already processed —
  // proof this call did not just re-skip the identical prefix again.
  const newOffset = Number(scriptProps.get('BACKFILL_RESUME_TIE_OFFSET') || '0');
  assert.ok(newOffset > alreadyProcessed, 'expected the persisted tie offset to advance: got ' + newOffset);
});

test('backfillResultFingerprints_ bounds its own pagination phase, reserving budget to still process and checkpoint what it fetched', () => {
  // Codex-reported gap: paginateNotionQuery_ had no wall-clock bound of its
  // own, only QUERY_PAGE_SAFETY_LIMIT (50 pages) — so a large Done database
  // or a slow Notion response could spend this whole call's entire
  // MAX_RUN_DURATION_MS budget just fetching pages, leaving the processing
  // loop below no time to reconcile or checkpoint a single Task before an
  // uncaught Apps Script kill, which would lose everything (nothing gets
  // persisted mid-fetch) and repeat the identical pagination prefix forever.
  // Reserving half the budget for pagination and leaving the rest for
  // processing must still let a call fetched-but-cut-short make real,
  // checkpointed progress.
  let pageCalls = 0;
  const routes = {
    [TASKS_QUERY]: () => {
      pageCalls += 1;
      const idx = pageCalls;
      const ts = '2026-08-01T00:' + String(idx).padStart(2, '0') + ':00.000Z';
      const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43dn' + String(idx).padStart(3, '0'), {
        status: 'Done', agent: 'Claude Opus', lastEdited: ts, startedAt: ts,
      });
      task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
      task.properties['Completed At'] = { type: 'date', date: { start: ts } };
      // Far more pages available (20) than the fake clock below will let
      // pagination actually reach — proves the deadline, not exhaustion of
      // available data, is what stops it here.
      return { results: [task], has_more: idx < 20, next_cursor: 'cursor-' + idx };
    },
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  // 25 simulated seconds per Date() read. Pagination's own deadline check
  // (MAX_RUN_DURATION_MS / 2 = 120s past runStartedAt) lands partway
  // through the run, well before all 20 available pages are fetched and
  // well before MAX_RUN_DURATION_MS (240s) itself elapses — leaving real
  // budget behind for the processing loop.
  let ticks = 0;
  const now = () => {
    ticks += 1;
    return ticks * 25 * 1000;
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
    now,
  });

  const summary = sandbox.backfillResultFingerprints_();

  assert.equal(summary.truncated, true);
  assert.ok(pageCalls < 20, 'expected the deadline, not exhausting available pages, to stop pagination: fetched ' + pageCalls);
  // The real point of the fix: budget reserved for processing must not be
  // zero just because pagination itself got cut short.
  assert.ok(summary.scanned > 0, 'expected the processing loop to still make progress after a bounded pagination phase');
  const resumeCursor = scriptProps.get('BACKFILL_RESUME_CURSOR');
  assert.ok(resumeCursor, 'expected a resume checkpoint to be persisted');
});

test('backfillResultFingerprints_ resumes past a tied timestamp instead of dropping its remainder', () => {
  // Regression: a strict `after: resumeCursor` filter would exclude every
  // unretrieved Task still sharing that exact timestamp once the pagination
  // limit lands inside a tied group (last_edited_time is minute-granular,
  // so a handful of Done Tasks can plausibly share one value right at an
  // arbitrary 5000-row page boundary) — the backfill would silently give up
  // on the remainder of the tie forever. Models a realistic boundary: 47
  // Tasks with distinct timestamps, followed by a tied group of 8 sharing
  // one timestamp that straddles the truncation point (3 retrieved in the
  // first call, 5 left over) — not an entire history sharing one minute,
  // which the underlying `on_or_after` query itself has no way to further
  // paginate within (a separate, extreme-scale limitation — see README).
  const distinctCount = 47;
  const tiedTimestamp = '2026-08-01T02:00:00.000Z';
  const allTasks = [];
  for (let i = 1; i <= distinctCount; i++) {
    allTasks.push(taskPage('3cafbd82-6f3b-8158-9622-d795b43dh' + String(i).padStart(3, '0'), {
      status: 'Done', agent: 'Claude Opus',
      lastEdited: '2026-08-01T00:' + String(i).padStart(2, '0') + ':00.000Z',
      startedAt: '2026-08-01T00:' + String(i).padStart(2, '0') + ':00.000Z',
    }));
  }
  for (let i = 1; i <= 8; i++) {
    allTasks.push(taskPage('3cafbd82-6f3b-8158-9622-d795b43di' + String(i).padStart(3, '0'), {
      status: 'Done', agent: 'Claude Opus', lastEdited: tiedTimestamp, startedAt: tiedTimestamp,
    }));
  }
  allTasks.forEach(function (task) {
    task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
    task.properties['Completed At'] = { type: 'date', date: { start: task.last_edited_time } };
  });

  const routes = {
    [TASKS_QUERY]: (body) => {
      const resumed = Boolean(body.filter && body.filter.and);
      if (resumed) resumedFilters.push(body.filter);
      // A fresh (non-resumed) query starts at index 0; a resumed one starts
      // directly at the tied group — modeling that `on_or_after` genuinely
      // narrows the server-side result set rather than replaying everything.
      const pageIndex = body.start_cursor ? Number(body.start_cursor) : (resumed ? distinctCount : 0);
      const task = allTasks[pageIndex];
      if (!task) return { results: [], has_more: false };
      return { results: [task], has_more: pageIndex + 1 < allTasks.length, next_cursor: String(pageIndex + 1) };
    },
    // Every row gets a matching, unstamped closing event so it genuinely
    // passes and stays Done — a rejected Task would roll back to Review and
    // drop out of the resumed Status = Done query, which is not what this
    // test (pagination/resume mechanics, not the Done gate) is exercising.
    [EVENTS_QUERY]: (body) => {
      const requestedTaskId = body && body.filter && body.filter.relation && body.filter.relation.contains;
      const task = allTasks.find((t) => t.id === requestedTaskId);
      const startedAt = task ? task.last_edited_time : tiedTimestamp;
      const endedAt = startedAt;
      return { results: [eventPage('evt-' + requestedTaskId, { actor: 'Claude', startedAt, endedAt })], has_more: false };
    },
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const resumedFilters = [];
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
  });

  const firstRun = sandbox.backfillResultFingerprints_();
  assert.equal(firstRun.truncated, true);
  assert.equal(firstRun.scanned, 50); // 47 distinct + first 3 of the 8 tied
  assert.equal(scriptProps.get('BACKFILL_RESUME_TIE_OFFSET'), '3');

  const secondRun = sandbox.backfillResultFingerprints_();

  // The 5 remaining tied Tasks must still be reached — none silently
  // dropped just because they share the resume cursor's exact timestamp.
  assert.equal(secondRun.scanned, 5);
  assert.equal(secondRun.truncated, false);
  // The resumed query itself must use on_or_after (inclusive of the tied
  // boundary), not a strict after that would exclude same-timestamp
  // siblings at the source — the local tie-offset skip is what avoids
  // re-processing what on_or_after's inclusivity re-returns.
  const onOrAfterClause = resumedFilters[0].and.find((f) => f.timestamp === 'last_edited_time');
  assert.ok(onOrAfterClause.last_edited_time.on_or_after, 'expected an on_or_after (not after) clause');
});

test('a truncated backfill call whose tie is entirely already covered does not lose the resume point', () => {
  // Mirrors the pollTaskChanges "fully skipped tie" test: when a prior
  // call's tie offset already covers every Task a resumed, truncated query
  // returns, nothing new gets processed this call — the resume state must
  // be left exactly as it was rather than cleared or corrupted.
  const cursor = '2026-08-01T02:00:00.000Z';
  let pageCalls = 0;
  const routes = {
    [TASKS_QUERY]: () => {
      pageCalls += 1;
      // Every page shares the exact cursor timestamp; force truncation via
      // QUERY_PAGE_SAFETY_LIMIT with only the first 10 carrying a Task.
      const task = pageCalls <= 10
        ? [taskPage('3cafbd82-6f3b-8158-9622-d795b43dj' + String(pageCalls).padStart(3, '0'), {
            status: 'Done', agent: 'Claude Opus', lastEdited: cursor, startedAt: cursor,
          })]
        : [];
      return { results: task, has_more: true, next_cursor: 'c' + pageCalls };
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
      BACKFILL_RESUME_CURSOR: cursor,
      // Already covers more than the entire truncated batch this query can
      // ever return (only 10 tied Tasks per call).
      BACKFILL_RESUME_TIE_OFFSET: '1000000',
    },
    fetch: notionFetchStub(routes),
  });

  const summary = sandbox.backfillResultFingerprints_();

  assert.equal(summary.scanned, 0);
  assert.equal(summary.truncated, true);
  assert.equal(scriptProps.get('BACKFILL_RESUME_CURSOR'), cursor);
  assert.equal(scriptProps.get('BACKFILL_RESUME_TIE_OFFSET'), '1000000');
});

test('backfillResultFingerprints_ bails out on wall-clock time within a single pagination page and leaves a resumable checkpoint', () => {
  // Regression for the Codex-reported gap: a batch of Done Tasks well under
  // QUERY_PAGE_SAFETY_LIMIT can still make this run long enough to hit Apps
  // Script's own execution limit, since every Done Task costs a real Time
  // Events query/write (reconcileTaskPage_ always re-verifies Done) — a risk
  // the pagination-truncation-only checkpointing above does nothing to guard
  // against. MAX_RUN_DURATION_MS must stop the loop before that and persist
  // a resumable checkpoint, the same as it already does for pollTaskChanges'
  // own free-outcome scan.
  const taskCount = 8;
  const tasks = [];
  for (let i = 1; i <= taskCount; i++) {
    const ts = '2026-08-01T00:' + String(i).padStart(2, '0') + ':00.000Z';
    const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43dk' + String(i).padStart(3, '0'), {
      status: 'Done', agent: 'Claude Opus', lastEdited: ts, startedAt: ts,
    });
    task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
    task.properties['Completed At'] = { type: 'date', date: { start: ts } };
    tasks.push(task);
  }
  const routes = {
    // Mirrors real Notion `on_or_after` semantics (inclusive) so a resumed
    // second call genuinely sees a narrowed result set, exercising the same
    // tie-offset local skip the production code depends on — not just the
    // un-resumed first call's full list every time.
    [TASKS_QUERY]: (body) => {
      const onOrAfter = body.filter && body.filter.and &&
        body.filter.and.find((f) => f.timestamp === 'last_edited_time');
      const filtered = onOrAfter
        ? tasks.filter((t) => t.last_edited_time >= onOrAfter.last_edited_time.on_or_after)
        : tasks;
      return { results: filtered, has_more: false };
    },
    // Every row gets a matching, unstamped closing event so it genuinely
    // passes and stays Done — this test is about the wall-clock bail-out and
    // resume, not the Done gate, and a rejected Task would drop out of the
    // resumed Status = Done query and make the scanned-count assertions
    // below meaningless.
    [EVENTS_QUERY]: (body) => {
      const requestedTaskId = body && body.filter && body.filter.relation && body.filter.relation.contains;
      const task = tasks.find((t) => t.id === requestedTaskId);
      const startedAt = task ? task.last_edited_time : tasks[0].last_edited_time;
      const endedAt = startedAt;
      return { results: [eventPage('evt-' + requestedTaskId, { actor: 'Claude', startedAt, endedAt })], has_more: false };
    },
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  // A fake clock advancing 30 simulated seconds on every no-arg `new Date()`
  // / `Date.now()` call, so MAX_RUN_DURATION_MS (4 minutes) is crossed well
  // before all 8 Tasks are processed regardless of how many internal Date()
  // reads reconcileTaskPage_ itself makes per Task.
  let ticks = 0;
  const now = () => {
    ticks += 1;
    return ticks * 30 * 1000;
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
    now,
  });

  const summary = sandbox.backfillResultFingerprints_();

  assert.equal(summary.timedOut, true);
  assert.ok(summary.scanned > 0 && summary.scanned < taskCount, 'expected a partial scan: got ' + summary.scanned);
  assert.equal(summary.truncated, false); // pagination itself never truncated — only the wall clock did
  const resumeCursor = scriptProps.get('BACKFILL_RESUME_CURSOR');
  assert.ok(resumeCursor, 'expected a resume checkpoint to be persisted after a wall-clock bail-out');
  assert.equal(resumeCursor, tasks[summary.scanned - 1].last_edited_time);

  // A second, unstubbed-clock call must resume past exactly what the first
  // call already processed and drain the rest — never restart from scratch,
  // and never skip the tail.
  const secondRun = sandbox.backfillResultFingerprints_();
  assert.equal(secondRun.scanned, taskCount - summary.scanned);
  assert.equal(scriptProps.get('BACKFILL_RESUME_CURSOR'), '');
});

test('a wall-clock bail-out mid-tie accumulates onto the tie offset a prior call already persisted, instead of overwriting it', () => {
  // Codex-reported gap in the wall-clock bound above: when a same-timestamp
  // cohort needs more than one wall-clock-bounded call to drain, a resumed
  // call's own tie-offset arithmetic only counted what THAT call itself
  // processed, discarding the count earlier calls had already skipped past
  // (BACKFILL_RESUME_TIE_OFFSET, loaded at the top of this call as
  // `tieOffset`). Simulate the middle of such a sequence directly: an
  // earlier call already persisted a resume point 10 members into a tied
  // cohort, and this call — itself cut short by the wall clock, not
  // pagination — must persist the CUMULATIVE count (10 plus however many it
  // adds), not just its own contribution, or the next call resumes from the
  // wrong offset and re-walks (never past) the same middle slice forever.
  const tiedTimestamp = '2026-08-01T00:00:00.000Z';
  const alreadyProcessed = 10;
  const remainingCount = 70; // 10 already skipped + plenty left so the wall clock, not the list, ends this call
  const tasks = [];
  for (let i = 1; i <= remainingCount; i++) {
    const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43dm' + String(i).padStart(3, '0'), {
      status: 'Done', agent: 'Claude Opus', lastEdited: tiedTimestamp, startedAt: tiedTimestamp,
    });
    task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
    task.properties['Completed At'] = { type: 'date', date: { start: tiedTimestamp } };
    tasks.push(task);
  }
  const routes = {
    // The resumed on_or_after(tiedTimestamp) query returns the full tied
    // group again (every member shares the identical timestamp) — the local
    // tie-offset skip below is what's actually relied on to not re-process
    // the leading members a prior call already handled, mirroring genuine
    // Notion `on_or_after` semantics for an exact-match tie.
    [TASKS_QUERY]: () => ({ results: tasks, has_more: false }),
    // Every row gets a matching, unstamped closing event so it genuinely
    // passes and stays Done — this test is about the cumulative tie-offset
    // arithmetic across wall-clock-bounded calls, not the Done gate, and a
    // rejected Task would drop out of the resumed Status = Done query and
    // make the offset assertions below meaningless.
    [EVENTS_QUERY]: (body) => {
      const requestedTaskId = body && body.filter && body.filter.relation && body.filter.relation.contains;
      const endedAt = tiedTimestamp;
      return { results: [eventPage('evt-' + requestedTaskId, { actor: 'Claude', startedAt: tiedTimestamp, endedAt })], has_more: false };
    },
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  let ticks = 0;
  const now = () => {
    ticks += 1;
    return ticks * 30 * 1000;
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: {
      NOTION_TOKEN: 'test-token',
      SPREADSHEET_ID: 'test-sheet',
      BACKFILL_RESUME_CURSOR: tiedTimestamp,
      BACKFILL_RESUME_TIE_OFFSET: String(alreadyProcessed),
    },
    fetch: notionFetchStub(routes),
    now,
  });

  const summary = sandbox.backfillResultFingerprints_();

  assert.equal(summary.timedOut, true);
  assert.ok(summary.scanned > 0 && summary.scanned < remainingCount, 'expected a partial scan: got ' + summary.scanned);
  // Still the same tied timestamp — the cursor doesn't move within a tie.
  assert.equal(scriptProps.get('BACKFILL_RESUME_CURSOR'), tiedTimestamp);
  // The bug: this would be String(summary.scanned) alone, discarding the 10
  // a prior call already accounted for.
  assert.equal(scriptProps.get('BACKFILL_RESUME_TIE_OFFSET'), String(alreadyProcessed + summary.scanned));
});

test('backfillResultFingerprints_ does not count a rejected Task toward the tie offset it persists', () => {
  // Regression: a rejected Done ('done_gate_rejected:...') is rolled back to
  // Status = Review by enforceDoneGate_, which removes it from every FUTURE
  // call of this same Status = Done query — it can never come back. The old
  // newTieOffset loop counted any processed Task sharing the tail timestamp
  // regardless of outcome, so a rejected member of a tied cohort inflated
  // the persisted offset past what the resumed query's (now smaller) result
  // set actually contains, silently skipping a genuinely unprocessed valid
  // Task forever. Models 47 distinct Tasks (filling the pagination safety
  // limit up to the tie) followed by a 5-member tied group whose middle
  // member is rejected: pass, reject, pass | pass, pass — split by
  // truncation so the first call sees only the first three.
  const distinctCount = 47;
  const tiedTimestamp = '2026-08-01T02:00:00.000Z';

  function passingTask(id, lastEdited) {
    const t = taskPage(id, { status: 'Done', agent: 'Claude Opus', lastEdited, startedAt: lastEdited });
    t.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
    t.properties['Completed At'] = { type: 'date', date: { start: lastEdited } };
    return t;
  }

  const distinctTasks = [];
  for (let i = 1; i <= distinctCount; i++) {
    const ts = '2026-08-01T00:' + String(i).padStart(2, '0') + ':00.000Z';
    distinctTasks.push(passingTask('3cafbd82-6f3b-8158-9622-d795b43dk' + String(i).padStart(3, '0'), ts));
  }

  const tiePass1 = passingTask('3cafbd82-6f3b-8158-9622-d795b43dpass1', tiedTimestamp);
  const tieReject = passingTask('3cafbd82-6f3b-8158-9622-d795b43drej1', tiedTimestamp);
  const tiePass2 = passingTask('3cafbd82-6f3b-8158-9622-d795b43dpass2', tiedTimestamp);
  const tiePass3 = passingTask('3cafbd82-6f3b-8158-9622-d795b43dpass3', tiedTimestamp);
  const tiePass4 = passingTask('3cafbd82-6f3b-8158-9622-d795b43dpass4', tiedTimestamp);
  const tiedGroup = [tiePass1, tieReject, tiePass2, tiePass3, tiePass4];
  const allTasks = distinctTasks.concat(tiedGroup);

  // Every passing Task gets a matching, unstamped closing event (passes and
  // gets stamped on first sight, same as the legacy-backfill test above).
  // The rejected Task deliberately gets no event at all — the simplest
  // route to `missing_applicable_time_event`.
  const eventsByTaskId = {};
  allTasks.forEach(function (task) {
    if (task.id === tieReject.id) {
      eventsByTaskId[task.id] = [];
      return;
    }
    const startedAt = task.last_edited_time;
    const endedAt = startedAt;
    eventsByTaskId[task.id] = [eventPage('evt-' + task.id, { actor: 'Claude', startedAt, endedAt })];
  });

  const rejectedIds = new Set();
  const routes = {
    [TASKS_QUERY]: (body) => {
      const resumed = Boolean(body.filter && body.filter.and);
      const visible = allTasks.filter((t) => !rejectedIds.has(t.id));
      const pool = resumed ? visible.filter((t) => t.last_edited_time >= tiedTimestamp) : visible;
      const pageIndex = body.start_cursor ? Number(body.start_cursor) : 0;
      const task = pool[pageIndex];
      if (!task) return { results: [], has_more: false };
      return { results: [task], has_more: pageIndex + 1 < pool.length, next_cursor: String(pageIndex + 1) };
    },
    [EVENTS_QUERY]: (body) => {
      const requestedTaskId = body && body.filter && body.filter.relation && body.filter.relation.contains;
      return { results: eventsByTaskId[requestedTaskId] || [], has_more: false };
    },
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    ['PATCH /v1/pages/' + encodeURIComponent(tieReject.id)]: () => {
      rejectedIds.add(tieReject.id);
      return {};
    },
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };

  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
  });

  const firstRun = sandbox.backfillResultFingerprints_();
  // QUERY_PAGE_SAFETY_LIMIT (50) lands exactly after the 47 distinct Tasks
  // plus the first 3 tied ones: pass, reject, pass.
  assert.equal(firstRun.truncated, true);
  assert.equal(firstRun.scanned, 50);
  assert.ok(rejectedIds.has(tieReject.id), 'expected the reject Task to have been rolled back this run');
  // The fix: only the 2 passing members of the trailing tie (tiePass1,
  // tiePass2) count toward the resume offset — not the rejected one sitting
  // between them, which will never be returned by a future Status = Done
  // query again. The bug would persist '3' here instead.
  assert.equal(scriptProps.get('BACKFILL_RESUME_TIE_OFFSET'), '2');

  const secondRun = sandbox.backfillResultFingerprints_();

  // With the offset correctly at 2, the resumed query's own results —
  // tiePass1, tiePass2, tiePass3, tiePass4 (tieReject no longer visible) —
  // skip the first 2 (tiePass1, tiePass2, already reconciled last run) and
  // this call reaches the remaining 2 (tiePass3, tiePass4). The bug (offset
  // '3') would skip 3 of these 4 and silently drop tiePass3 forever,
  // scanning only 1 Task here instead of 2.
  assert.equal(secondRun.scanned, 2);
  assert.equal(secondRun.truncated, false);
  assert.equal(secondRun.timedOut, false);
  // Fully drained: no resume state left behind.
  assert.equal(scriptProps.get('BACKFILL_RESUME_CURSOR'), '');
  assert.equal(scriptProps.get('BACKFILL_RESUME_TIE_OFFSET'), '');
});

test('backfillResultFingerprints_ reserves processing time even while its pagination phase is escalating', () => {
  // Regression: the escalation above (past the half-budget deadline, while
  // a persisted tie offset still consumes everything fetched so far) used
  // to be bounded only by the full run budget — MAX_RUN_DURATION_MS itself,
  // with nothing held back for the processing loop that runs after it. A
  // persisted offset that pagination can only just barely fetch past, right
  // near that outer bound, would cross it (escaping the "no progress" check
  // and returning a non-empty toProcess) only after consuming the ENTIRE
  // budget doing so — leaving the processing loop's own MAX_RUN_DURATION_MS
  // check already tripped before it runs even once. The call would then
  // scan nothing (wasting every one of those fetches for nothing) and, per
  // the "no progress, don't touch persisted state" rule below, leave
  // BACKFILL_RESUME_TIE_OFFSET untouched — so the next call repeats the
  // identical expensive fetch-only round trip, forever. Modeled directly
  // against the real wall clock (one simulated tick per Date() read, same
  // convention as the escalation test above): a persisted offset (29) that
  // this exact tick cost model can only just cross on the 30th page fetch —
  // one page later than the reserved deadline alone would ever allow.
  const tiedTimestamp = '2026-08-01T00:00:00.000Z';
  const totalRows = 300;
  const alreadyProcessed = 29;
  const routes = {
    [TASKS_QUERY]: (body) => {
      const cursor = body.start_cursor ? Number(body.start_cursor) : 0;
      if (cursor >= totalRows) return { results: [], has_more: false };
      const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43dq' + String(cursor + 1).padStart(3, '0'), {
        status: 'Done', agent: 'Claude Opus', lastEdited: tiedTimestamp, startedAt: tiedTimestamp,
      });
      task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
      task.properties['Completed At'] = { type: 'date', date: { start: tiedTimestamp } };
      return { results: [task], has_more: cursor + 1 < totalRows, next_cursor: String(cursor + 1) };
    },
    [EVENTS_QUERY]: (body) => {
      const requestedTaskId = body && body.filter && body.filter.relation && body.filter.relation.contains;
      return { results: [eventPage('evt-' + requestedTaskId, { actor: 'Claude', startedAt: tiedTimestamp, endedAt: tiedTimestamp })], has_more: false };
    },
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  let ticks = 0;
  const now = () => {
    ticks += 1;
    return ticks * 6 * 1000;
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: {
      NOTION_TOKEN: 'test-token',
      SPREADSHEET_ID: 'test-sheet',
      BACKFILL_RESUME_CURSOR: tiedTimestamp,
      BACKFILL_RESUME_TIE_OFFSET: String(alreadyProcessed),
    },
    fetch: notionFetchStub(routes),
    now,
  });

  const summary = sandbox.backfillResultFingerprints_();

  // The bug's exact signature: pagination alone burns the whole run
  // (`timedOut === true`) with nothing scanned at all. The reserve must
  // make the processing loop's own deadline check unreachable — pagination
  // itself gives up first, on the safe (bounded, no-progress) side, never
  // handing the processing loop a batch it has no time left to touch.
  assert.equal(summary.timedOut, false, 'expected pagination to yield to the processing loop before the run\'s own deadline, not exhaust it first');
});

test('backfillResultFingerprints_ survives a single abnormally slow request, not just a uniformly slow one', () => {
  // Model/Invariant Review I10, scenario S12 (PR #17 Codex finding "Account
  // for the final request in the processing reserve"): the test above
  // models every Date() read costing an identical, small amount of time —
  // it never models a SINGLE request whose own duration, on its own, eats
  // deep into the reserve. paginateNotionQuery_'s deadline check only runs
  // BEFORE issuing a request, never accounting for how long that ONE
  // request, once in flight, actually takes to return — a request that is
  // permitted to start (still comfortably inside the deadline) can still,
  // by itself, consume most or all of the reserve by the time it resolves.
  // This fixture injects exactly that: one specific page fetch, positioned
  // right where escalation would only be reachable under a reserve too
  // small to cover its own duration, takes an extra 30 simulated seconds —
  // on top of the ordinary per-check tick cost every other request pays.
  const tiedTimestamp = '2026-08-01T00:00:00.000Z';
  const totalRows = 40; // well under QUERY_PAGE_SAFETY_LIMIT (50)
  const alreadyProcessed = 26;
  const slowAtCursor = 26; // the single page fetch that crosses the tie offset
  const slowExtraMs = 30 * 1000;
  let ticks = 0;
  let extraMs = 0;
  const now = () => {
    ticks += 1;
    return ticks * 6 * 1000 + extraMs;
  };
  const routes = {
    [TASKS_QUERY]: (body) => {
      const cursor = body.start_cursor ? Number(body.start_cursor) : 0;
      if (cursor >= totalRows) return { results: [], has_more: false };
      const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43dr' + String(cursor + 1).padStart(3, '0'), {
        status: 'Done', agent: 'Claude Opus', lastEdited: tiedTimestamp, startedAt: tiedTimestamp,
      });
      task.properties.Result = { type: 'rich_text', rich_text: [{ plain_text: 'shipped' }] };
      task.properties['Completed At'] = { type: 'date', date: { start: tiedTimestamp } };
      // Simulate this one request itself blocking for slowExtraMs beyond the
      // loop's own bookkeeping — not spread across many requests, exactly
      // one, at the position that finally makes escalation cross the tie
      // offset (results.length exceeding it for the first time).
      if (cursor === slowAtCursor) extraMs += slowExtraMs;
      return { results: [task], has_more: cursor + 1 < totalRows, next_cursor: String(cursor + 1) };
    },
    [EVENTS_QUERY]: (body) => {
      const requestedTaskId = body && body.filter && body.filter.relation && body.filter.relation.contains;
      return { results: [eventPage('evt-' + requestedTaskId, { actor: 'Claude', startedAt: tiedTimestamp, endedAt: tiedTimestamp })], has_more: false };
    },
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: {
      NOTION_TOKEN: 'test-token',
      SPREADSHEET_ID: 'test-sheet',
      BACKFILL_RESUME_CURSOR: tiedTimestamp,
      BACKFILL_RESUME_TIE_OFFSET: String(alreadyProcessed),
    },
    fetch: notionFetchStub(routes),
    now,
  });

  const summary = sandbox.backfillResultFingerprints_();

  // The bug's signature is identical to the test above (timedOut === true
  // with nothing scanned) but reached through a different mechanism: not
  // many ordinary requests slowly eating the reserve together, but ONE
  // request whose own duration alone exceeds what a too-small reserve
  // assumed no single request would ever take. MIN_PROCESSING_RESERVE_MS
  // must be sized to survive this — not just the uniform-cost case.
  assert.equal(summary.timedOut, false, 'expected the reserve to survive one abnormally slow request, not just uniformly slow ones');
});

// --- Status property schema contract ---------------------------------------
//
// `Stories & Tasks`.Status is a Notion `select` property in the real
// database schema — not the distinct `status` property type, which is an
// identically-named but incompatible filter/write shape
// ({ status: { equals / name } } vs { select: { equals / name } }). Sending
// the wrong one is rejected outright by the real Notion API as a
// validation_error; it does not silently match zero rows. This was an
// actual production regression (2026-08-31): every Status filter and the
// Status write predated DEFAULTS.STATUS_PROPERTY_TYPE and hardcoded
// `status`, so pollTaskChanges failed against the real database from the
// moment polling replaced the old webhook receiver, which never filtered by
// Status at all. The tests below assert the literal request bodies Code.gs
// sends, not just that a request was made, so a future reintroduction of the
// wrong property type — at any of the call sites, individually — fails here
// instead of only in production.
test('the Done-status backfill query (backfillResultFingerprints_) filters on select, not status', () => {
  const { sandbox, fetchLog } = harness();

  sandbox.backfillResultFingerprints_();

  const query = JSON.parse(requestsTo(fetchLog, 'POST', TASKS_DS)[0].options.payload);
  assert.deepEqual(query.filter, { property: 'Status', select: { equals: 'Done' } });
});

test('a resumed Done-status backfill query filters on select, not status', () => {
  const { sandbox, fetchLog } = harness({
    scriptProperties: { BACKFILL_RESUME_CURSOR: '2026-08-30T05:00:00.000Z' },
  });

  sandbox.backfillResultFingerprints_();

  const query = JSON.parse(requestsTo(fetchLog, 'POST', TASKS_DS)[0].options.payload);
  assert.deepEqual(query.filter.and[0], { property: 'Status', select: { equals: 'Done' } });
});

test('the In-Progress bootstrap query (queryActiveInProgressTasks_) filters on select, not status', () => {
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox, fetchLog } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' }, // no LAST_SYNC_CURSOR: fresh deploy bootstraps
    fetch: notionFetchStub(routes),
  });

  sandbox.pollTaskChanges();

  const bootstrapQuery = requestsTo(fetchLog, 'POST', TASKS_DS)
    .map((entry) => JSON.parse(entry.options.payload))
    .find((body) => body.filter && body.filter.property === 'Status');
  assert.ok(bootstrapQuery, 'expected a Status-filtered bootstrap query among the requests made');
  assert.deepEqual(bootstrapQuery.filter, { property: 'Status', select: { equals: 'In Progress' } });
});

test('a rejected Done rolls Status back with a select write, not a status write', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dee01';
  const doneTask = taskPage(taskId, {
    status: 'Done',
    agent: 'Human',
    lastEdited: '2026-08-30T09:00:00.000Z',
    startedAt: '2026-08-30T08:00:00.000Z',
  }); // Result and Completed At left empty — enforceDoneGate_ must reject and roll back.
  const { sandbox, fetchLog } = harness();

  const outcome = sandbox.enforceDoneGate_(doneTask, [], []);

  assert.match(outcome, /^done_gate_rejected:/);
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/' + taskId);
  assert.equal(patches.length, 1);
  const body = JSON.parse(patches[0].options.payload);
  assert.deepEqual(body.properties.Status, { select: { name: 'Review' } });
});


// --- ADP-051: Work Type / Review Source ------------------------------------
//
// Both fields are informational-only — nothing in reconcileTaskPage_'s
// control flow (Done gate, idempotency, cursor advancement) reads them back.
// These tests cover the classification rules and the GitHub best-effort
// lookup in isolation, plus one end-to-end pass through pollTaskChanges to
// confirm the wiring actually reaches the created Time Event's Note.

test('classifyReviewerLogin_ recognizes Codex, Claude, a plain human login, an unrelated bot, and blank', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.classifyReviewerLogin_('chatgpt-codex-connector'), 'Codex');
  assert.equal(sandbox.classifyReviewerLogin_('Claude-Review-Bot'), 'Claude');
  assert.equal(sandbox.classifyReviewerLogin_('komaba'), 'Human');
  assert.equal(sandbox.classifyReviewerLogin_('dependabot[bot]'), 'Other');
  assert.equal(sandbox.classifyReviewerLogin_(''), 'Other');
  assert.equal(sandbox.classifyReviewerLogin_(undefined), 'Other');
});

test('parseGithubPullRequestUrl_ extracts owner/repo/number and rejects anything else', () => {
  const { sandbox } = harness();
  assert.deepEqual(
    plain(sandbox.parseGithubPullRequestUrl_('https://github.com/cloud42-labo/ai-development-platform/pull/19')),
    { owner: 'cloud42-labo', repo: 'ai-development-platform', number: '19' }
  );
  assert.equal(sandbox.parseGithubPullRequestUrl_(''), null);
  assert.equal(sandbox.parseGithubPullRequestUrl_('https://github.com/cloud42-labo/repo/issues/3'), null);
  assert.equal(sandbox.parseGithubPullRequestUrl_(null), null);
});

test('classifyWorkType_ is Initial Work with no prior genuine close, and Review Fix only right after one that left the Task in Review', () => {
  const { sandbox } = harness();

  assert.equal(sandbox.classifyWorkType_([]), 'Initial Work');

  const closedFromBlocked = eventPage('evt-1', {
    actor: 'Claude', startedAt: '2026-08-30T05:00:00.000Z', endedAt: '2026-08-30T06:00:00.000Z',
    note: 'End Status=Blocked | Reason=left_in_progress',
  });
  assert.equal(sandbox.classifyWorkType_([closedFromBlocked]), 'Initial Work');

  const closedFromReview = eventPage('evt-2', {
    actor: 'Claude', startedAt: '2026-08-30T05:00:00.000Z', endedAt: '2026-08-30T06:00:00.000Z',
    note: 'End Status=Review | Reason=left_in_progress',
  });
  assert.equal(sandbox.classifyWorkType_([closedFromReview]), 'Review Fix');

  // A reassignment/duplicate close is same-execution churn, never a genuine
  // boundary — even though closeNotionTimeEvent_ always stamps its End
  // Status as the CURRENT status (here, coincidentally 'Review' would be
  // impossible for a reassignment since reassignment only fires while still
  // In Progress — the real risk this guards is a reassignment close being
  // mistaken for the genuine boundary at all).
  const reassigned = eventPage('evt-3', {
    actor: 'Claude', startedAt: '2026-08-30T05:00:00.000Z', endedAt: '2026-08-30T06:00:00.000Z',
    note: 'End Status=In Progress | Reason=reassignment',
  });
  assert.equal(sandbox.classifyWorkType_([reassigned]), 'Initial Work');

  // Ties: the most recent genuine close by Ended At wins, not array order.
  assert.equal(sandbox.classifyWorkType_([closedFromReview, closedFromBlocked].reverse()), 'Initial Work');

  // Codex-reported gap: a reassignment/duplicate close that WAS later
  // retroactively boundary-stamped (see stampExecutionBoundary_) is a
  // genuine execution boundary — but its End Status= was originally
  // recorded as 'In Progress' (a reassignment/duplicate close can only ever
  // fire while still In Progress; only the later boundary-stamp write
  // itself observes where the execution really ended). stampExecutionBoundary_
  // appends a fresh, corrected End Status= alongside Boundary=, and
  // noteField_ always reads the LAST occurrence of a key — so this must
  // read the corrected value, not the stale original one, or a genuine
  // Review Fix is silently misclassified as Initial Work.
  const reassignedThenBoundaryStamped = eventPage('evt-4', {
    actor: 'Claude', startedAt: '2026-08-30T05:00:00.000Z', endedAt: '2026-08-30T06:00:00.000Z',
    note: 'End Status=In Progress | Reason=reassignment | Boundary=left_in_progress | End Status=Review',
  });
  assert.equal(sandbox.classifyWorkType_([reassignedThenBoundaryStamped]), 'Review Fix');
});

test('stampExecutionBoundary_ records the status observed when the boundary is recognized, not the stale original End Status', () => {
  // End-to-end regression for the same Codex-reported gap: an assignee is
  // cleared while In Progress (closing via 'reassignment' with End
  // Status=In Progress — a reassignment/duplicate close only ever fires
  // while still In Progress), and the Task is next observed already in
  // Review with nothing open. The retroactive boundary stamp must capture
  // THIS status (Review), not repeat the stale one already on the event.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43df010';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Review',
      agent: 'Human', // no mapped actor left In Progress
      lastEdited: '2026-08-30T06:00:00.000Z',
      startedAt: '2026-08-30T05:00:00.000Z',
    })],
    events: [
      eventPage('evt-cleared', {
        actor: 'Claude',
        startedAt: '2026-08-30T05:00:00.000Z',
        endedAt: '2026-08-30T05:30:00.000Z',
        note: 'End Status=In Progress | Reason=reassignment',
      }),
    ],
  });

  sandbox.pollTaskChanges();

  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-cleared');
  assert.equal(patches.length, 1);
  const note = JSON.parse(patches[0].options.payload).properties.Note.rich_text[0].text.content;
  assert.match(note, /Boundary=left_in_progress/);
  // The corrected End Status=Review must be the LAST occurrence so
  // noteField_ (last-wins) resolves to it, not the original stale value.
  assert.equal(note.split(' | ').filter((s) => s.indexOf('End Status=') === 0).pop(), 'End Status=Review');
  assert.equal(sandbox.classifyWorkType_([{
    properties: {
      'Ended At': { type: 'date', date: { start: '2026-08-30T05:30:00.000Z' } },
      Note: { type: 'rich_text', rich_text: [{ plain_text: note }] },
    },
  }]), 'Review Fix');
});

test('stampExecutionBoundary_ refreshes Snapshot= to THIS poll\'s own snapshot, not the original close\'s stale one', () => {
  // Codex-reported gap (round 32): without this, mostRecentStatusEvidence_'s
  // tie-break (snapshotWasEverLogged_) would check whether the ORIGINAL
  // reassignment/duplicate_reconciliation close's snapshot was logged --
  // almost always true, since that earlier poll typically completed
  // normally -- instead of whether THIS boundary-recognizing poll's own
  // logSnapshot_ landed, silently defeating the round-31 interrupted-tie
  // fix for any event that went through a retroactive boundary stamp.
  // noteField_/parseNoteMeta_ read only the LAST occurrence of a key, so
  // appending a fresh Snapshot= must supersede the stale one already there.
  const { sandbox, fetchLog } = harness();
  const closedEvent = eventPage('evt-cleared', {
    actor: 'Claude', startedAt: '2026-08-30T05:00:00.000Z', endedAt: '2026-08-30T05:30:00.000Z',
    note: 'End Status=In Progress | Reason=reassignment | Snapshot=snap-old-reassignment',
  });

  sandbox.stampExecutionBoundary_(closedEvent, '', 'Review', 'snap-new-boundary-poll');

  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-cleared');
  assert.equal(patches.length, 1);
  const note = JSON.parse(patches[0].options.payload).properties.Note.rich_text[0].text.content;
  assert.equal(
    note.split(' | ').filter((s) => s.indexOf('Snapshot=') === 0).pop(), 'Snapshot=snap-new-boundary-poll',
    'expected the boundary poll\'s own snapshot to be the LAST (winning) Snapshot= occurrence'
  );
});

test('classifyWorkType_ resolves a tie correctly for a boundary-stamped event, using the boundary poll\'s own snapshot', () => {
  // End-to-end regression for the same gap, through the REAL
  // stampExecutionBoundary_ write (not a hand-crafted Note) and then
  // mostRecentStatusEvidence_'s tie-break: an assignee is cleared while In
  // Progress (closing via 'reassignment', whose OWN snapshot WAS logged --
  // that poll completed normally), and only a LATER poll -- interrupted
  // before its own logSnapshot_ -- recognizes the boundary into Review. If
  // stampExecutionBoundary_ didn't refresh Snapshot= (the round-32 gap),
  // the tie-break would still find the reassignment's OLD (logged)
  // snapshot on the event and wrongly trust Sync Log's stale row.
  const taskId = 'task-boundary-snapshot-tie';
  const { sandbox, fetchLog } = harness();
  // The reassignment's own poll completed normally: its snapshot IS logged.
  sandbox.logSnapshot_('snap-reassignment', 'notion_poll', taskId, 'In Progress', new Date('2026-08-30T05:00:00.000Z'), 'closed:evt-cleared');
  // The Sync Log's latest row for this task is still this stale, unrelated
  // observation -- the boundary poll's own logSnapshot_ never landed.
  sandbox.logSnapshot_('snap-stale-unrelated', 'notion_poll', taskId, 'Backlog', new Date('2026-08-30T04:00:00.000Z'), 'no_change:Backlog');

  const reassignedEvent = eventPage('evt-cleared', {
    actor: 'Claude', startedAt: '2026-08-30T03:30:00.000Z', endedAt: '2026-08-30T04:00:00.000Z',
    note: 'End Status=In Progress | Reason=reassignment | Snapshot=snap-reassignment',
  });
  // The boundary-recognizing poll's own snapshot was never logged (it was
  // interrupted before its own logSnapshot_ call) -- that is the ordering
  // signal this test exists to prove stampExecutionBoundary_ preserves.
  sandbox.stampExecutionBoundary_(reassignedEvent, '', 'Review', 'snap-boundary-never-logged');
  // Read back the REAL patched Note (through appendNote_/buildNote_, not a
  // hand-typed guess) and feed it into classifyWorkType_ as the event's
  // current state, the same way a subsequent poll's own query would see it.
  const patchedNote = JSON.parse(
    requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-cleared')[0].options.payload
  ).properties.Note.rich_text[0].text.content;
  const boundaryStampedEvent = eventPage('evt-cleared', {
    actor: 'Claude', startedAt: '2026-08-30T03:30:00.000Z', endedAt: '2026-08-30T04:00:00.000Z',
    note: patchedNote,
  });

  assert.equal(
    sandbox.classifyWorkType_([boundaryStampedEvent], taskId), 'Review Fix',
    'expected the boundary\'s own (never-logged) snapshot to win the tie, not the reassignment\'s (logged) one'
  );
});

test('classifyWorkType_ prefers Sync Log\'s complete status history over the Time-Event-only heuristic', () => {
  // Codex-reported gap: a Task closes into Review, is later observed in
  // Backlog (an ordinary re-observation — nothing opens or closes a Time
  // Event for Backlog/Ready/Review transitions with no open event to touch),
  // and only THEN reopens to In Progress. The Time-Event-only heuristic
  // still sees the OLD Review close (nothing else ever touched Time Events)
  // and would misclassify this as Review Fix — but the Task's real
  // immediately-preceding status was Backlog, not Review, so this must be
  // Initial Work. Sync Log has no such gap: logSnapshot_ runs for every
  // genuinely distinct snapshot regardless of Status.
  const taskId = 'task-sync-log-1';
  const { sandbox } = harness();
  sandbox.logSnapshot_('snap-1', 'notion_poll', taskId, 'Review', new Date('2026-08-30T05:00:00.000Z'), 'closed:evt-1');
  sandbox.logSnapshot_('snap-2', 'notion_poll', taskId, 'Backlog', new Date('2026-08-30T06:00:00.000Z'), 'no_change:Backlog');

  const closedFromReview = eventPage('evt-1', {
    actor: 'Claude', startedAt: '2026-08-30T04:00:00.000Z', endedAt: '2026-08-30T05:00:00.000Z',
    note: 'End Status=Review | Reason=left_in_progress',
  });

  // Without a taskId (no Sync Log lookup possible), the Time-Event-only
  // heuristic alone resolves to 'Review Fix' — the whole point of this test
  // is that supplying taskId, and thus consulting Sync Log, changes the
  // answer to the correct one.
  assert.equal(sandbox.classifyWorkType_([closedFromReview]), 'Review Fix');
  assert.equal(sandbox.classifyWorkType_([closedFromReview], taskId), 'Initial Work');
});

test('classifyWorkType_ prefers a genuine Time-Event close over a Sync Log row that predates it', () => {
  // Codex-reported gap (round 30): an earlier version trusted ANY Sync Log
  // answer unconditionally, never comparing its timestamp against a genuine
  // Time-Event close. If reconciliation closes an event into Review but is
  // interrupted before logSnapshot_ ever records that transition (the last
  // step of reconcileTaskPage_, after every Notion write), and the Task
  // reopens before a later poll gets a chance to log it, the Sync Log's
  // most recent row for this Task is now STALE (predates the close) — yet
  // it was still trusted outright, silently misclassifying the reopen as
  // Initial Work and skipping Review Source resolution despite the event's
  // own Note already proving otherwise.
  const taskId = 'task-sync-log-stale';
  const { sandbox } = harness();
  // The Sync Log's only row for this task predates the genuine close below
  // — exactly what an interrupted logSnapshot_ write for the Review
  // transition itself would leave behind (the log never caught up).
  sandbox.logSnapshot_('snap-1', 'notion_poll', taskId, 'Ready', new Date('2026-08-30T04:00:00.000Z'), 'no_change:Ready');

  const closedFromReview = eventPage('evt-1', {
    actor: 'Claude', startedAt: '2026-08-30T04:30:00.000Z', endedAt: '2026-08-30T06:00:00.000Z',
    note: 'End Status=Review | Reason=left_in_progress',
  });

  assert.equal(
    sandbox.classifyWorkType_([closedFromReview], taskId), 'Review Fix',
    'expected the newer genuine close to win over the stale Sync Log row'
  );
});

test('reviewFixSinceTimestamp_ prefers a genuine Time-Event close\'s own boundary over a stale Sync Log row', () => {
  // Companion to the classifyWorkType_ regression above: both functions
  // must resolve the SAME evidence (mostRecentStatusEvidence_) so they can
  // never disagree about which source won.
  const taskId = 'task-sync-log-stale-2';
  const { sandbox } = harness();
  sandbox.logSnapshot_('snap-1', 'notion_poll', taskId, 'Ready', new Date('2026-08-30T04:00:00.000Z'), 'no_change:Ready');

  const closedFromReview = eventPage('evt-1', {
    actor: 'Claude', startedAt: '2026-08-30T04:30:00.000Z', endedAt: '2026-08-30T06:00:00.000Z',
    note: 'End Status=Review | Reason=left_in_progress',
  });

  assert.equal(
    sandbox.reviewFixSinceTimestamp_([closedFromReview], taskId).toISOString(), '2026-08-30T06:00:00.000Z',
    'expected the genuine close\'s own Ended At, not something derived from the stale Sync Log row'
  );
});

test('classifyWorkType_ prefers a genuine close over a Sync Log row that TIES with it in the same minute, when the close was never logged', () => {
  // Codex-reported gap (round 31): Notion's minute-granular timestamps let
  // a genuinely stale Sync Log row TIE with a newer genuine close instead
  // of merely predating it (the round-30 scenario above). If `Backlog` is
  // logged, the task executes and closes into `Review` within that SAME
  // minute, and `logSnapshot_` for the poll that produced the close never
  // ran (interrupted, same as round 30), the prior `>=` tie-break still
  // picked the stale `Backlog` row unconditionally. The close's own
  // `Snapshot=` was never appended to the Sync Log at all here — proof its
  // poll's `logSnapshot_` step never landed — so `snapshotWasEverLogged_`
  // must be the deciding signal, not the tied timestamp.
  const taskId = 'task-sync-log-tie-stale';
  const { sandbox } = harness();
  sandbox.logSnapshot_('snap-stale', 'notion_poll', taskId, 'Backlog', new Date('2026-08-30T04:00:00.000Z'), 'no_change:Backlog');

  const closedFromReview = eventPage('evt-1', {
    actor: 'Claude', startedAt: '2026-08-30T03:00:00.000Z', endedAt: '2026-08-30T04:00:00.000Z',
    note: 'End Status=Review | Reason=left_in_progress | Snapshot=snap-interrupted',
  });

  assert.equal(
    sandbox.classifyWorkType_([closedFromReview], taskId), 'Review Fix',
    'expected the close to win the tie since its own snapshot was never logged (interrupted logSnapshot_)'
  );
});

test('classifyWorkType_ keeps preferring Sync Log when a tied close\'s own snapshot WAS logged (no over-correction)', () => {
  // Companion to the interrupted-tie regression above, in the other
  // direction: when the close's own Snapshot= DOES appear in the Sync Log,
  // that proves logSnapshot_ for its poll completed normally, so a tied
  // Sync Log row reflects a real, subsequent observation (e.g. the Task
  // was immediately moved again within the same minute) rather than a
  // stale one — the log must still win, exactly as before this fix.
  const taskId = 'task-sync-log-tie-fresh';
  const { sandbox } = harness();
  sandbox.logSnapshot_('snap-closed', 'notion_poll', taskId, 'Review', new Date('2026-08-30T04:00:00.000Z'), 'closed:evt-1');
  sandbox.logSnapshot_('snap-newer', 'notion_poll', taskId, 'Backlog', new Date('2026-08-30T04:00:00.000Z'), 'no_change:Backlog');

  const closedFromReview = eventPage('evt-1', {
    actor: 'Claude', startedAt: '2026-08-30T03:00:00.000Z', endedAt: '2026-08-30T04:00:00.000Z',
    note: 'End Status=Review | Reason=left_in_progress | Snapshot=snap-closed',
  });

  assert.equal(
    sandbox.classifyWorkType_([closedFromReview], taskId), 'Initial Work',
    'expected Sync Log\'s own subsequent Backlog observation to still win once the close is confirmed logged'
  );
});

test('reviewFixSinceTimestamp_ uses the current Review period\'s own start, not a stale Time Event close from an earlier one', () => {
  // Codex-reported gap: classifyWorkType_ was fixed to use Sync Log (the
  // Task's real status history) instead of the Time-Event-only heuristic,
  // but the Review Source "since" cutoff still used the old heuristic
  // (genuineCloseEndedAt_) even after that fix. A Task that closes into
  // Review, passes through Backlog/Ready (no Time Event touched), and
  // re-enters Review before finally reopening has its CURRENT Review
  // period begin later than whatever Time Event last closed from the
  // FIRST, superseded Review period — using that stale close as "since"
  // would let a review submitted during the first period attribute cost to
  // a reviewer who had nothing to do with this actual fix.
  const taskId = 'task-sync-log-4';
  const { sandbox } = harness();
  sandbox.logSnapshot_('s1', 'notion_poll', taskId, 'Review', new Date('2026-08-30T05:00:00.000Z'), 'closed:evt-old');
  sandbox.logSnapshot_('s2', 'notion_poll', taskId, 'Backlog', new Date('2026-08-30T06:00:00.000Z'), 'no_change:Backlog');
  sandbox.logSnapshot_('s3', 'notion_poll', taskId, 'Review', new Date('2026-08-30T07:00:00.000Z'), 'no_change:Review');

  const staleClose = eventPage('evt-old', {
    actor: 'Claude', startedAt: '2026-08-30T04:00:00.000Z', endedAt: '2026-08-30T05:00:00.000Z',
    note: 'End Status=Review | Reason=left_in_progress',
  });

  const since = sandbox.reviewFixSinceTimestamp_([staleClose], taskId);
  assert.equal(new Date(since).toISOString(), '2026-08-30T07:00:00.000Z', 'expected the CURRENT Review period\'s own start, not the stale 05:00 close');

  // Falls back to the Time-Event heuristic's own cutoff when Sync Log has
  // no Review entry for this Task at all (mirrors classifyWorkType_'s own
  // fallback exactly).
  const sinceNoLog = sandbox.reviewFixSinceTimestamp_([staleClose], 'never-seen-before');
  assert.equal(new Date(sinceNoLog).toISOString(), '2026-08-30T05:00:00.000Z');
});

test('reviewFixSinceTimestamp_ uses the START of the current Review period, not the last time it was merely re-observed', () => {
  // Codex-reported gap in the fix above: logSnapshot_ logs every genuinely
  // distinct edit even when Status itself hasn't changed (an unrelated
  // field — e.g. Result — edited while still in Review still produces a
  // new, distinct snapshot and its own Sync Log row). Taking the LAST
  // same-status row as "since" can land AFTER a GitHub review that was
  // submitted earlier in that same, still-ongoing Review period, wrongly
  // excluding it and misattributing the fix to 'Other' or a later reviewer.
  const taskId = 'task-sync-log-5';
  const { sandbox } = harness();
  sandbox.logSnapshot_('s1', 'notion_poll', taskId, 'Review', new Date('2026-08-30T05:00:00.000Z'), 'closed:evt-1');
  // An unrelated edit while STILL in Review — Status unchanged, but a
  // genuinely distinct, later snapshot still gets logged.
  sandbox.logSnapshot_('s2', 'notion_poll', taskId, 'Review', new Date('2026-08-30T05:30:00.000Z'), 'no_change:Review');

  assert.equal(sandbox.mostRecentLoggedStatus_(taskId), 'Review');
  const since = sandbox.reviewFixSinceTimestamp_([], taskId);
  assert.equal(new Date(since).toISOString(), '2026-08-30T05:00:00.000Z', 'expected the period\'s own start (05:00), not the later re-observation (05:30)');
});

test('mostRecentLoggedEntry_ treats In Progress as a period separator, not a value to drop before grouping', () => {
  // Codex-reported regression in round 11's own fix: filtering OUT every
  // In Progress row before grouping into consecutive runs let two Review
  // periods from two DIFFERENT executions (Review -> In Progress -> Review
  // -> In Progress) collapse into looking like one single consecutive run
  // once In Progress was dropped, walking the backward scan straight
  // through the intervening execution into a stale, unrelated earlier
  // Review period.
  const taskId = 'task-sync-log-6';
  const { sandbox } = harness();
  sandbox.logSnapshot_('s1', 'notion_poll', taskId, 'Review', new Date('2026-08-30T05:00:00.000Z'), 'closed:evt-old');
  sandbox.logSnapshot_('s2', 'notion_poll', taskId, 'In Progress', new Date('2026-08-30T06:00:00.000Z'), 'opened:evt-mid');
  sandbox.logSnapshot_('s3', 'notion_poll', taskId, 'Review', new Date('2026-08-30T07:00:00.000Z'), 'closed:evt-mid');

  assert.equal(sandbox.mostRecentLoggedStatus_(taskId), 'Review');
  const since = sandbox.reviewFixSinceTimestamp_([], taskId);
  assert.equal(new Date(since).toISOString(), '2026-08-30T07:00:00.000Z', 'expected the CURRENT (second) Review period\'s own start, not the first one from before the intervening execution');
});

test('syncLogRows_ caches the Sync Log for one execution; resetSyncLogRowsCache_ clears it', () => {
  // Codex-reported performance concern: without caching, classifyWorkType_
  // and reviewFixSinceTimestamp_ each re-read the entire (append-only, ever-
  // growing) Sync Log sheet from scratch for every single event opened in a
  // run. This test verifies the cache actually caches (a row appended
  // without a reset is NOT yet visible) and that the designated entry
  // points' reset call actually clears it (visible again afterward) —
  // not just that behavior is unchanged when reads always happen to be
  // fresh, which every other Sync Log test here already exercises.
  const taskId = 'task-sync-log-cache';
  const { sandbox } = harness();
  sandbox.logSnapshot_('s1', 'notion_poll', taskId, 'Review', new Date('2026-08-30T05:00:00.000Z'), 'closed:evt-1');
  assert.equal(sandbox.mostRecentLoggedStatus_(taskId), 'Review');

  sandbox.logSnapshot_('s2', 'notion_poll', taskId, 'Backlog', new Date('2026-08-30T06:00:00.000Z'), 'no_change:Backlog');
  assert.equal(sandbox.mostRecentLoggedStatus_(taskId), 'Review', 'expected the stale cached read, not the just-appended row');

  sandbox.resetSyncLogRowsCache_();
  assert.equal(sandbox.mostRecentLoggedStatus_(taskId), 'Backlog', 'expected the fresh row to be visible once the cache is reset');
});

test('classifyWorkType_ falls back to the Time-Event heuristic when Sync Log has nothing for this Task yet', () => {
  const { sandbox } = harness();
  const closedFromReview = eventPage('evt-2', {
    actor: 'Claude', startedAt: '2026-08-30T04:00:00.000Z', endedAt: '2026-08-30T05:00:00.000Z',
    note: 'End Status=Review | Reason=left_in_progress',
  });
  // A brand-new taskId with no Sync Log rows at all — mostRecentLoggedStatus_
  // returns '', and the caller must not treat that as "Initial Work by
  // definition"; it must fall back to the Time-Event heuristic instead.
  assert.equal(sandbox.classifyWorkType_([closedFromReview], 'never-seen-before'), 'Review Fix');
});

test('classifyWorkType_ looks past unassigned In Progress observations in Sync Log to the status that actually began the execution', () => {
  // Codex-reported gap: reconcileAuthoritativeTimeEvents_'s
  // 'in_progress_without_mapped_actor' outcome (an unmapped/cleared
  // Assigned Agent while Status is already In Progress) opens no Time
  // Event, but reconcileTaskPage_ still calls logSnapshot_ with
  // Status=In Progress regardless. Taking the literal last Sync Log row
  // blindly would then read "In Progress" as the status that PRECEDED this
  // reopen — meaningless, since In Progress is what the execution IS, not
  // what came before it — hiding the genuine Review that actually began it.
  const taskId = 'task-sync-log-2';
  const { sandbox } = harness();
  sandbox.logSnapshot_('s1', 'notion_poll', taskId, 'Review', new Date('2026-08-30T05:00:00.000Z'), 'closed:evt-1');
  sandbox.logSnapshot_('s2', 'notion_poll', taskId, 'In Progress', new Date('2026-08-30T05:30:00.000Z'), 'in_progress_without_mapped_actor');
  sandbox.logSnapshot_('s3', 'notion_poll', taskId, 'In Progress', new Date('2026-08-30T05:40:00.000Z'), 'in_progress_without_mapped_actor');

  assert.equal(sandbox.mostRecentLoggedStatus_(taskId), 'Review');
  assert.equal(sandbox.classifyWorkType_([], taskId), 'Review Fix');
});

test('mostRecentLoggedStatus_ breaks a Reconciled-At tie by preferring the later-appended row', () => {
  // Codex-reported gap: this integration explicitly expects Notion edit
  // times (the source of every Reconciled At here) to be minute-granular,
  // so two genuinely different, consecutive observations for the same Task
  // routinely tie. The strict `>` this used to use kept whichever row was
  // scanned first regardless of which was actually appended later.
  const taskId = 'task-sync-log-3';
  const { sandbox } = harness();
  const tiedAt = new Date('2026-08-30T05:00:00.000Z');
  sandbox.logSnapshot_('s1', 'notion_poll', taskId, 'Review', tiedAt, 'closed:evt-1');
  sandbox.logSnapshot_('s2', 'notion_poll', taskId, 'Backlog', tiedAt, 'no_change:Backlog');

  assert.equal(sandbox.mostRecentLoggedStatus_(taskId), 'Backlog');
});

test('mostRecentChurnEvent_ finds same-execution churn regardless of which poll closed it, but never a genuine boundary or a completed prior execution\'s own churn', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.mostRecentChurnEvent_([]), null);

  const churn = eventPage('evt-churn', {
    actor: 'Claude', startedAt: '2026-08-30T05:00:00.000Z', endedAt: '2026-08-30T05:30:00.000Z',
    note: 'End Status=In Progress | Reason=reassignment | Work Type=Review Fix | Review Source=Human',
  });
  assert.equal(sandbox.mostRecentChurnEvent_([churn]).id, 'evt-churn');

  // A genuine boundary from an EARLIER, already-completed execution,
  // followed by the CURRENT execution's own churn — the churn (after the
  // boundary) belongs to the current execution and must still be found.
  const priorGenuineClose = eventPage('evt-prior-close', {
    actor: 'Human', startedAt: '2026-08-29T05:00:00.000Z', endedAt: '2026-08-29T06:00:00.000Z',
    note: 'End Status=Review | Reason=left_in_progress',
  });
  assert.equal(sandbox.mostRecentChurnEvent_([priorGenuineClose, churn]).id, 'evt-churn');

  // Codex-reported gap: a churn event that belongs to an execution which
  // has SINCE genuinely closed (i.e. it closed BEFORE that later genuine
  // boundary, entirely inside the now-completed execution) must not be
  // picked up by a later, unrelated execution with no churn of its own
  // yet — it is stale prior-execution evidence, exactly like a genuine
  // boundary itself would be, even though nothing here marks it as one.
  const oldChurnInsideClosedExecution = eventPage('evt-old-churn', {
    actor: 'Human', startedAt: '2026-08-29T04:00:00.000Z', endedAt: '2026-08-29T04:30:00.000Z',
    note: 'End Status=In Progress | Reason=reassignment',
  });
  assert.equal(sandbox.mostRecentChurnEvent_([oldChurnInsideClosedExecution, priorGenuineClose]), null);
});

test('mostRecentChurnEvent_ excludes an ambiguous-provenance restart from its own history scan, not just the otherActor call site', () => {
  // Codex-reported gap (round 34): reconcileAuthoritativeTimeEvents_'s own
  // otherActor filtering excludes an `ambiguous_provenance_restart` close
  // from THIS poll, but mostRecentChurnEvent_'s separate history scan (used
  // when otherActor is empty, e.g. the reassignment happens a LATER poll
  // after this one) had no matching exclusion — it would still find and
  // inherit from a PAST poll's ambiguous restart, reintroducing the exact
  // same gap through this second call path.
  const { sandbox } = harness();
  const ambiguousRestart = eventPage('evt-ambiguous-restart-history', {
    actor: 'Claude', startedAt: '2026-08-30T05:00:00.000Z', endedAt: '2026-08-30T05:30:00.000Z',
    note: 'End Status=In Progress | Reason=ambiguous_provenance_restart | Work Type=Review Fix | Review Source=Human',
  });
  assert.equal(
    sandbox.mostRecentChurnEvent_([ambiguousRestart]), null,
    'expected an ambiguous_provenance_restart close to never be treated as legitimate same-execution churn'
  );
});

test('mostRecentChurnEvent_ still finds a churn that ties exactly with the prior genuine close\'s own Ended At', () => {
  // Codex-reported gap in the cutoff above: `Ended At` is minute-granular,
  // so a reopen whose assignee is cleared within the same Notion-reported
  // minute the PRIOR execution's genuine close landed in can tie exactly
  // with it. That churn still belongs to the CURRENT execution — a
  // strictly-before cutoff must not exclude it on a mere timestamp tie.
  const { sandbox } = harness();
  const tiedAt = '2026-08-30T06:00:00.000Z';
  const priorGenuineClose = eventPage('evt-prior-close-2', {
    actor: 'Human', startedAt: '2026-08-30T05:00:00.000Z', endedAt: tiedAt,
    note: 'End Status=Review | Reason=left_in_progress',
  });
  const tiedChurn = eventPage('evt-tied-churn', {
    actor: 'Claude', startedAt: tiedAt, endedAt: tiedAt,
    note: 'End Status=In Progress | Reason=reassignment | Work Type=Review Fix | Review Source=Codex',
  });
  assert.equal(sandbox.mostRecentChurnEvent_([priorGenuineClose, tiedChurn]).id, 'evt-tied-churn');
});

test('mostRecentChurnEvent_ excludes a tied churn that shares the cutoff\'s own Execution= (same, now-completed execution)', () => {
  // Codex-reported gap in the OPPOSITE direction from the test above: a
  // Task is reassigned (actor A's event closes via 'reassignment') and the
  // Task ALSO leaves for Review within that same Notion-reported minute
  // (actor B's own event then closes via 'left_in_progress') — actor A's
  // churn and actor B's genuine close can tie on Ended At, but they belong
  // to the SAME just-completed execution (both carry its Execution=), not
  // a not-yet-existing later one. Ended At alone cannot tell this apart
  // from the sibling test above — Execution= can.
  const { sandbox } = harness();
  const tiedAt = '2026-08-30T06:00:00.000Z';
  const executionId = '2026-08-30T05:00:00.000Z';
  const actorAChurn = eventPage('evt-actor-a-churn', {
    actor: 'Human', startedAt: executionId, endedAt: tiedAt,
    note: 'Execution=' + executionId + ' | End Status=In Progress | Reason=reassignment',
  });
  const actorBGenuineClose = eventPage('evt-actor-b-close', {
    actor: 'Claude', startedAt: tiedAt, endedAt: tiedAt,
    note: 'Execution=' + executionId + ' | End Status=Review | Reason=left_in_progress',
  });
  assert.equal(sandbox.mostRecentChurnEvent_([actorAChurn, actorBGenuineClose]), null);
});

test('Work Type/Review Source survive an assignee cleared in one poll and reassigned only in a later one', () => {
  // Codex-reported gap: closing an outgoing actor's event and opening the
  // replacement's, within the SAME poll call, is the only path the original
  // inheritance logic covered (via `otherActor`). Clearing the assignee
  // entirely for a while (still In Progress throughout — never touching the
  // "nothing open" boundary branch, since Status itself never changes) and
  // only reassigning in a LATER, separate poll call closes the outgoing
  // event with `otherActor` empty by the time the reassignment is observed
  // — nothing is left open to compare against in THAT call. Without
  // mostRecentChurnEvent_, this looks like a genuinely fresh execution:
  // Work Type gets reclassified from scratch and Review Source spends a
  // second, unnecessary GitHub call that can attribute the SAME continuous
  // fix to a different, newer reviewer.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43df020';
  const outgoingEvent = eventPage('evt-outgoing-2', {
    actor: 'Claude',
    startedAt: '2026-08-30T05:00:00.000Z',
    endedAt: null,
    note: 'Execution=2026-08-30T05:00:00.000Z | Work Type=Review Fix | Review Source=Codex',
  });
  const routes = {
    [TASKS_QUERY]: () => ({
      results: [taskPage(taskId, {
        status: 'In Progress',
        agent: null, // cleared
        lastEdited: '2026-08-30T05:30:00.000Z',
        startedAt: '2026-08-30T05:00:00.000Z',
      })],
      has_more: false,
    }),
    [EVENTS_QUERY]: () => ({ results: [outgoingEvent], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    // Simulate the write actually landing in Notion: mutate the in-memory
    // fixture so the NEXT poll call's query sees the closed state, exactly
    // like re-querying the real API after the first poll's PATCH would.
    'PATCH *': (body) => {
      if (body && body.properties && body.properties['Ended At']) {
        outgoingEvent.properties['Ended At'] = { type: 'date', date: body.properties['Ended At'].date };
      }
      if (body && body.properties && body.properties.Note) {
        outgoingEvent.properties.Note = {
          type: 'rich_text',
          rich_text: [{ plain_text: body.properties.Note.rich_text[0].text.content }],
        };
      }
      return {};
    },
  };
  const { sandbox, fetchLog } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
  });

  // Poll 1: the assignee is cleared. The outgoing event closes via
  // 'reassignment'; there is no mapped actor to open a new event for.
  const summary1 = sandbox.pollTaskChanges();
  assert.match(summary1.outcomes[0], /closed_reassigned:evt-outgoing-2/);
  assert.ok(outgoingEvent.properties['Ended At'].date, 'expected poll 1 to actually close the outgoing event');

  // Poll 2, a separate call: a new actor is assigned. `otherActor` is now
  // empty — the outgoing event was already closed by poll 1, not this one.
  routes[TASKS_QUERY] = () => ({
    results: [taskPage(taskId, {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T06:00:00.000Z',
      startedAt: '2026-08-30T05:00:00.000Z',
    })],
    has_more: false,
  });
  sandbox.pollTaskChanges();

  const created = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload)).pop();
  const note = created.properties.Note.rich_text[0].text.content;
  assert.match(note, /Work Type=Review Fix/, 'must inherit across the poll boundary, not reclassify fresh');
  assert.match(note, /Review Source=Codex/, 'must inherit across the poll boundary, not call GitHub again');
});

test('resolveReviewSource_ is Other with no Pull Request, and makes no GitHub call', () => {
  const { sandbox, fetchLog } = harness({ scriptProperties: { GITHUB_TOKEN: 'gh-token' } });
  const task = taskPage('t-1', { status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z' });

  assert.equal(sandbox.resolveReviewSource_(task, null), 'Other');
  assert.equal(fetchLog.filter((e) => e.url.includes('api.github.com')).length, 0);
});

test('resolveReviewSource_ is Other with a Pull Request but no GITHUB_TOKEN configured, and makes no GitHub call', () => {
  const { sandbox, fetchLog } = harness(); // no GITHUB_TOKEN
  const task = taskPage('t-2', {
    status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z',
    pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
  });

  assert.equal(sandbox.resolveReviewSource_(task, null), 'Other');
  assert.equal(fetchLog.filter((e) => e.url.includes('api.github.com')).length, 0);
});

test('resolveReviewSource_ picks the most recent qualifying review and ignores ones before the prior close', () => {
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=1': () => ([
      { user: { login: 'komaba' }, submitted_at: '2026-08-29T00:00:00.000Z' }, // before `since` — must be ignored
      { user: { login: 'chatgpt-codex-connector' }, submitted_at: '2026-08-31T00:00:00.000Z' },
      { user: { login: 'komaba' }, submitted_at: '2026-08-30T12:00:00.000Z' },
    ]),
  };
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      const method = String((options && options.method) || 'get').toUpperCase();
      const handler = routes[method + ' ' + url] || routes[method + ' *'];
      const body = handler ? handler(options) : {};
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });
  const task = taskPage('t-3', {
    status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z',
    pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
  });

  assert.equal(sandbox.resolveReviewSource_(task, new Date('2026-08-30T00:00:00.000Z')), 'Codex');
});

test('resolveReviewSource_ walks every page of Reviews instead of only the first', () => {
  // Regression for the Codex-reported gap: GitHub paginates /reviews (30 per
  // page by default) — the true latest reviewer can sit on a later page,
  // which a single unpaginated request would never see, misattributing
  // Review Source to whatever stale reviewer happens to be on page 1.
  const page1 = [];
  for (let i = 0; i < 100; i++) {
    page1.push({ user: { login: 'komaba' }, submitted_at: '2026-08-30T00:0' + (i % 10) + ':00.000Z' });
  }
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=1': () => page1,
    // The genuinely latest review sits on page 2, the only page short
    // enough to signal the end of pagination.
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=2': () => ([
      { user: { login: 'chatgpt-codex-connector' }, submitted_at: '2026-08-31T00:00:00.000Z' },
    ]),
  };
  const { sandbox, fetchLog } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      const method = String((options && options.method) || 'get').toUpperCase();
      const handler = routes[method + ' ' + url] || routes[method + ' *'];
      const body = handler ? handler(options) : {};
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });
  const task = taskPage('t-5', {
    status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z',
    pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
  });

  assert.equal(sandbox.resolveReviewSource_(task, new Date('2026-08-30T00:00:00.000Z')), 'Codex');
  assert.equal(fetchLog.filter((e) => e.url.includes('api.github.com')).length, 2, 'expected both pages to be fetched');
});

test('resolveReviewSource_ stops pagination as soon as a short page is returned, never fetching a needless next page', () => {
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=1': () => ([
      { user: { login: 'chatgpt-codex-connector' }, submitted_at: '2026-08-31T00:00:00.000Z' },
    ]),
  };
  const { sandbox, fetchLog } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      const method = String((options && options.method) || 'get').toUpperCase();
      const handler = routes[method + ' ' + url] || routes[method + ' *'];
      if (!handler) throw new Error('unexpected fetch: ' + url); // page 2 must never be requested
      const body = handler(options);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });
  const task = taskPage('t-6', {
    status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z',
    pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
  });

  assert.equal(sandbox.resolveReviewSource_(task, new Date('2026-08-30T00:00:00.000Z')), 'Codex');
  assert.equal(fetchLog.filter((e) => e.url.includes('api.github.com')).length, 1);
});

test('resolveReviewSource_ excludes reviews submitted after the fix itself began', () => {
  // Regression for the Codex-reported gap: polling runs on a delay, so a
  // review can land in the window between the actual Review -> In Progress
  // reopen and this code finally observing/reacting to it. Such a review
  // could not have triggered a fix that was already underway, so it must be
  // excluded even though it is otherwise the most recent qualifying review.
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=1': () => ([
      { user: { login: 'chatgpt-codex-connector' }, submitted_at: '2026-08-30T12:00:00.000Z' }, // before the reopen — eligible
      { user: { login: 'komaba' }, submitted_at: '2026-08-30T18:00:00.000Z' }, // after the reopen — must be excluded
    ]),
  };
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      const method = String((options && options.method) || 'get').toUpperCase();
      const handler = routes[method + ' ' + url] || routes[method + ' *'];
      const body = handler ? handler(options) : {};
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });
  const task = taskPage('t-7', {
    status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z',
    pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
  });

  assert.equal(
    sandbox.resolveReviewSource_(
      task,
      new Date('2026-08-30T00:00:00.000Z'),
      new Date('2026-08-30T15:00:00.000Z') // the reopen happened here, well before komaba's review
    ),
    'Codex',
    'expected the review after the reopen to be excluded, leaving the earlier Codex review as the qualifying one'
  );
});

test('resolveReviewSource_ still credits a review submitted later in the SAME rounded-down minute as untilFixStarted', () => {
  // Codex-reported gap (round 32): untilFixStarted is Notion's own
  // minute-granular timestamp (e.g. :00 seconds), but a review's
  // submitted_at carries full second precision. A review submitted at :30
  // within that same minute genuinely could have caused a reopen that
  // Notion only timestamps to :00 -- comparing the raw millisecond values
  // would wrongly discard it. A review in the NEXT minute must still be
  // excluded, proving the bound is "through the end of the minute", not
  // unbounded.
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=1': () => ([
      { user: { login: 'chatgpt-codex-connector' }, submitted_at: '2026-08-30T10:00:30.000Z' }, // same minute as untilFixStarted -- eligible
      { user: { login: 'komaba' }, submitted_at: '2026-08-30T10:01:00.000Z' }, // next minute -- must stay excluded
    ]),
  };
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      const method = String((options && options.method) || 'get').toUpperCase();
      const handler = routes[method + ' ' + url] || routes[method + ' *'];
      const body = handler ? handler(options) : {};
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });
  const task = taskPage('t-8', {
    status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z',
    pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
  });

  assert.equal(
    sandbox.resolveReviewSource_(
      task,
      new Date('2026-08-30T00:00:00.000Z'),
      new Date('2026-08-30T10:00:00.000Z') // rounded-down reopen minute
    ),
    'Codex',
    'expected the same-minute review at :30 to still qualify, and the next-minute review to stay excluded'
  );
});

test('resolveReviewSource_ uses a trusted, second-precise untilFixStarted VERBATIM, never rounding it up to the end of its minute', () => {
  // Codex-reported gap (round 34, superseding round 33's rounding-based
  // fix): when untilFixStarted is exact (trustedTaskStart, real seconds),
  // rounding up to the end of its own minute is itself wrong, not just
  // imprecise -- a fix genuinely known to have started at :00:30 cannot
  // have been caused by a review submitted afterwards, even within that
  // same displayed minute. Only a review AT OR BEFORE the exact instant
  // may qualify; untilFixStartedIsExact=true must use the timestamp as-is.
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=1': () => ([
      { user: { login: 'chatgpt-codex-connector' }, submitted_at: '2026-08-30T10:00:20.000Z' }, // before the exact start -- eligible
      { user: { login: 'komaba' }, submitted_at: '2026-08-30T10:00:45.000Z' }, // after the exact start, same minute -- must stay excluded
    ]),
  };
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      const method = String((options && options.method) || 'get').toUpperCase();
      const handler = routes[method + ' ' + url] || routes[method + ' *'];
      const body = handler ? handler(options) : {};
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });
  const task = taskPage('t-9', {
    status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z',
    pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
  });

  assert.equal(
    sandbox.resolveReviewSource_(
      task,
      new Date('2026-08-30T00:00:00.000Z'),
      new Date('2026-08-30T10:00:30.000Z'), // exact, second-precise trustedTaskStart
      true // untilFixStartedIsExact
    ),
    'Codex',
    'expected the pre-start review at :00:20 to qualify, and the post-start review at :00:45 to stay excluded despite sharing the same displayed minute'
  );
});

test('resolveReviewSource_ still rounds a NON-exact untilFixStarted up to the end of its minute, unaffected by the exact-mode fix', () => {
  // untilFixStartedIsExact defaults to falsy (every pre-round-34 call site
  // and test omits it) -- confirms the round-32 rounding behavior for the
  // minute-granular `when` fallback is untouched by round 34's new exact
  // branch, even when the raw timestamp happens to carry seconds.
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=1': () => ([
      { user: { login: 'chatgpt-codex-connector' }, submitted_at: '2026-08-30T10:00:45.000Z' }, // same minute -- still eligible when not exact
      { user: { login: 'komaba' }, submitted_at: '2026-08-30T10:01:00.000Z' }, // next minute -- excluded
    ]),
  };
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      const method = String((options && options.method) || 'get').toUpperCase();
      const handler = routes[method + ' ' + url] || routes[method + ' *'];
      const body = handler ? handler(options) : {};
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });
  const task = taskPage('t-10', {
    status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z',
    pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
  });

  assert.equal(
    sandbox.resolveReviewSource_(
      task,
      new Date('2026-08-30T00:00:00.000Z'),
      new Date('2026-08-30T10:00:30.000Z') // untilFixStartedIsExact omitted -- non-exact branch
    ),
    'Codex',
    'expected the same-minute review at :00:45 to still qualify when not marked exact, and the next-minute review to stay excluded'
  );
});

test('resolveReviewSource_ has no upper bound when untilFixStarted is omitted, matching every prior call site', () => {
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=1': () => ([
      { user: { login: 'chatgpt-codex-connector' }, submitted_at: '2026-08-30T12:00:00.000Z' },
      { user: { login: 'komaba' }, submitted_at: '2099-01-01T00:00:00.000Z' }, // far future, still no upper bound given
    ]),
  };
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      const method = String((options && options.method) || 'get').toUpperCase();
      const handler = routes[method + ' ' + url] || routes[method + ' *'];
      const body = handler ? handler(options) : {};
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });
  const task = taskPage('t-8', {
    status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z',
    pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
  });

  assert.equal(sandbox.resolveReviewSource_(task, new Date('2026-08-30T00:00:00.000Z')), 'Human');
});

test('resolveReviewSource_ degrades to Other, never throws, when the GitHub call itself fails', () => {
  const routes = {
    [TASKS_QUERY]: () => ({ results: [], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
  };
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      if (url.includes('api.github.com')) {
        return { getResponseCode: () => 500, getContentText: () => 'boom' };
      }
      const method = String((options && options.method) || 'get').toUpperCase();
      const handler = routes[method + ' ' + url] || routes[method + ' *'];
      const body = handler ? handler(options) : {};
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });
  const task = taskPage('t-4', {
    status: 'In Progress', agent: 'Claude Sonnet', lastEdited: '2026-08-30T06:00:00.000Z',
    pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
  });

  assert.doesNotThrow(function () {
    assert.equal(sandbox.resolveReviewSource_(task, null), 'Other');
  });
});

test('opening the first-ever event stamps Work Type=Initial Work and no Review Source', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('3cafbd82-6f3b-8158-9622-d795b43df001', {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T05:10:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
    })],
    events: [],
  });

  sandbox.pollTaskChanges();

  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  const note = created.properties.Note.rich_text[0].text.content;
  assert.match(note, /Work Type=Initial Work/);
  assert.doesNotMatch(note, /Review Source=/);
});

test('re-opening a Task whose most recent genuine close left it in Review stamps Work Type=Review Fix and resolves Review Source', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43df002';
  const routes = {
    [TASKS_QUERY]: () => ({
      results: [taskPage(taskId, {
        status: 'In Progress',
        agent: 'Claude Opus',
        lastEdited: '2026-08-30T09:00:00.000Z',
        startedAt: '2026-08-30T09:00:00.000Z',
        pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
      })],
      has_more: false,
    }),
    [EVENTS_QUERY]: () => ({
      results: [eventPage('evt-prior', {
        actor: 'Claude',
        startedAt: '2026-08-30T05:00:00.000Z',
        endedAt: '2026-08-30T06:00:00.000Z',
        note: 'End Status=Review | Reason=left_in_progress',
      })],
      has_more: false,
    }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=1': () => ([
      { user: { login: 'chatgpt-codex-connector' }, submitted_at: '2026-08-30T07:00:00.000Z' },
    ]),
  };
  const { sandbox, fetchLog } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      const method = String((options && options.method) || 'get').toUpperCase();
      const path = url.replace('https://api.notion.com', '');
      const handler = routes[method + ' ' + path] || routes[method + ' ' + url] || routes[method + ' *'];
      const body = handler ? handler(options ? JSON.parse(options.payload || '{}') : {}) : {};
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });

  sandbox.pollTaskChanges();

  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  const note = created.properties.Note.rich_text[0].text.content;
  assert.match(note, /Work Type=Review Fix/);
  assert.match(note, /Review Source=Codex/);
});

test('a reassignment replacement inherits Work Type and Review Source from the outgoing event without a fresh GitHub call', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43df003';
  const routes = {
    [TASKS_QUERY]: () => ({
      results: [taskPage(taskId, {
        status: 'In Progress',
        agent: 'Claude Sonnet', // different from the open event's own actor below
        lastEdited: '2026-08-30T09:10:00.000Z',
        startedAt: '2026-08-30T05:00:00.000Z', // unchanged since the original open — still the current execution
        pullRequest: 'https://github.com/cloud42-labo/ai-development-platform/pull/19',
      })],
      has_more: false,
    }),
    [EVENTS_QUERY]: () => ({
      results: [eventPage('evt-outgoing', {
        actor: 'Human', // the OLD actor — mismatches Assigned Agent above (maps to 'Claude'), triggering reassignment
        startedAt: '2026-08-30T05:00:00.000Z',
        note: 'Execution=2026-08-30T05:00:00.000Z | Work Type=Review Fix | Review Source=Human',
      })],
      has_more: false,
    }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET https://api.github.com/repos/cloud42-labo/ai-development-platform/pulls/19/reviews?per_page=100&page=1': () => ([
      { user: { login: 'chatgpt-codex-connector' }, submitted_at: '2026-08-30T07:00:00.000Z' },
    ]),
  };
  const { sandbox, fetchLog } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'gh-token' },
    fetch: (url, options) => {
      const method = String((options && options.method) || 'get').toUpperCase();
      const path = url.replace('https://api.notion.com', '');
      const handler = routes[method + ' ' + path] || routes[method + ' ' + url] || routes[method + ' *'];
      const body = handler ? handler(options ? JSON.parse(options.payload || '{}') : {}) : {};
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    },
  });

  sandbox.pollTaskChanges();

  const created = JSON.parse(requestsTo(fetchLog, 'POST', '/v1/pages')[0].options.payload);
  const note = created.properties.Note.rich_text[0].text.content;
  assert.match(note, /Work Type=Review Fix/);
  assert.match(note, /Review Source=Human/, 'expected the outgoing event\'s own Review Source, not a freshly resolved one');
  assert.equal(fetchLog.filter((e) => e.url.includes('api.github.com')).length, 0, 'inheriting must not call GitHub again');
});

test('upsertSheetProjection_ writes Work Type and Review Source into their own trailing columns', () => {
  const { sandbox, spreadsheet } = harness();
  const event = eventPage('evt-proj', {
    actor: 'Claude',
    startedAt: '2026-08-30T05:00:00.000Z',
    endedAt: '2026-08-30T06:00:00.000Z',
    note: 'End Status=Review | Reason=left_in_progress | Work Type=Review Fix | Review Source=Codex',
  });

  sandbox.setup(); // writes the header row, including the two new trailing columns
  sandbox.upsertSheetProjection_(event, 'task-1', 'My Task', 'https://notion.so/task-1', 'Review', 'user:1', 'snap-1');

  const sheet = spreadsheet.getSheetByName('Time Events');
  assert.deepEqual(plain(sheet.rows[0].slice(13, 15)), ['Work Type', 'Review Source']);
  assert.deepEqual(plain(sheet.rows[1].slice(13, 15)), ['Review Fix', 'Codex']);
});


test('Type is part of the reconciliation snapshot, so becoming a Story is never masked as a duplicate re-read', () => {
  // Codex-reported gap: authoritativeSnapshotId_ originally hashed only ID,
  // last_edited_time, Status and Assigned Agent — not Type. A page edited to
  // Type = Story without also changing Status/assignee in the same minute as
  // its previously processed snapshot would then hash identically to that
  // prior snapshot and be skipped as `duplicate:` before reconcileStoryTask_
  // ever ran, leaving a stray open event uncleaned until some unrelated
  // later edit happened to change the hash.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dee02';
  const sameMinute = '2026-08-30T05:10:00.000Z';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: sameMinute,
    startedAt: sameMinute,
  });
  const { sandbox, fetchLog } = harness({
    // See "a Story's stray open Time Event..." test above for why this is
    // needed: evt-pre-story has no Task Origin= marker.
    scriptProperties: { TASK_ORIGIN_BACKFILL_COMPLETE: 'true' },
    tasks: [task],
    events: [eventPage('evt-pre-story', { actor: 'Claude', startedAt: sameMinute })],
  });

  // First poll processes the page as an ordinary Task (Type absent).
  const first = sandbox.pollTaskChanges();
  assert.match(first.outcomes[0], /^already_open:/);

  // Type becomes Story with last_edited_time/Status/Assigned Agent all
  // unchanged, exactly as a same-minute edit looks through Notion's API.
  task.properties.Type = { type: 'select', select: { name: 'Story' } };

  const second = sandbox.pollTaskChanges();

  // Archived, not preserved: Type was never explicitly recorded as
  // anything but Story on this page — the first poll's own Sync Log row
  // carries an EMPTY Type column (Type was absent, propertyText_ reads
  // ''), which taskWasEverReconciledAsTask_ correctly refuses to count as
  // proof of genuine Task-era history (see its own comment — an unset
  // Type is exactly as ambiguous as a pre-upgrade row with no Type column
  // at all). Contrast with the "preserves genuine Task-era Time Events"
  // test below, whose fixture explicitly records `type: 'Task'`.
  assert.equal(second.outcomes[0], 'archived_story_event:evt-pre-story');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-pre-story');
  assert.equal(patches.length, 1);
  assert.equal(JSON.parse(patches[0].options.payload).archived, true);
});

test('reconciling back to an identical earlier snapshot within one minute is not masked as a duplicate re-read', () => {
  // Codex-reported gap (round 27): hasProcessedSnapshot_ originally matched
  // "was this exact snapshot ever logged, at any point in this page's
  // history" -- not only its most recent one. With Type now part of the
  // snapshot hash (see the previous test), a page observed as Task/In
  // Progress, reconciled once as Story (closing/archiving its open event
  // via reconcileStoryTask_), and then changed back to that identical
  // Task/In Progress state within the same last_edited_time minute
  // produces a snapshot byte-identical to the FIRST Task observation
  // already on file. Matching against "ever seen anywhere in history"
  // found that old row and skipped this final transition as `duplicate:`
  // before any reconciliation ran at all -- even though the Story pass in
  // between had genuinely archived the event, leaving the page stuck In
  // Progress with no open Time Event until some unrelated later edit
  // changed the hash.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dff01';
  const sameMinute = '2026-08-30T05:10:00.000Z';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: sameMinute,
    startedAt: sameMinute,
    type: 'Task',
  });
  const openEvent = eventPage('evt-round27', { actor: 'Claude', startedAt: sameMinute });
  const { sandbox, fetchLog } = harness({
    scriptProperties: { TASK_ORIGIN_BACKFILL_COMPLETE: 'true' },
    tasks: [task],
    events: [openEvent],
  });

  // First poll: an ordinary Task with an already-open event -- nothing to
  // do, but this is the exact observation the buggy dedup would later
  // collide with.
  const first = sandbox.pollTaskChanges();
  assert.match(first.outcomes[0], /^already_open:/);

  // Type becomes Story, last_edited_time/Status/Assigned Agent unchanged --
  // exactly as a same-minute edit looks through Notion's API.
  task.properties.Type = { type: 'select', select: { name: 'Story' } };
  const second = sandbox.pollTaskChanges();
  assert.equal(second.outcomes[0], 'archived_story_event:evt-round27');

  // Reverted back to Task, still the same minute -- Notion now reports the
  // exact same (id, last_edited_time, Status, Assigned Agent, Type) tuple
  // as the very first observation above.
  task.properties.Type = { type: 'select', select: { name: 'Task' } };
  const third = sandbox.pollTaskChanges();

  assert.doesNotMatch(
    third.outcomes[0], /^duplicate:/,
    'expected the Story detour in between to prevent this from being masked as a duplicate of the original Task observation'
  );
});

test('backfillStoryExclusion_ queries every Type=Story page regardless of Status, and archives stray open events', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dee03';
  const { sandbox, fetchLog } = harness({
    // See "a Story's stray open Time Event..." test above for why this is
    // needed.
    scriptProperties: { TASK_ORIGIN_BACKFILL_COMPLETE: 'true' },
    tasks: [taskPage(taskId, {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-12T12:42:00.000Z',
      startedAt: '2026-08-12T12:42:00.000Z',
      type: 'Story',
    })],
    events: [eventPage('evt-old-story', { actor: 'Claude', startedAt: '2026-08-12T12:42:00.000Z' })],
  });

  const summary = sandbox.backfillStoryExclusion_();

  const query = JSON.parse(requestsTo(fetchLog, 'POST', TASKS_DS)[0].options.payload);
  // Not scoped to Status = In Progress: most Stories on a live deployment
  // have already left In Progress with a closed, fictitiously-durationed
  // legacy event under the pre-fix reconciler, and only a Type-only filter
  // catches those too (see the function's own comment).
  assert.deepEqual(query.filter, { property: 'Type', select: { equals: 'Story' } });
  assert.equal(summary.scanned, 1);
  assert.equal(summary.processed, 1);
  assert.equal(summary.outcomes[0], 'archived_story_event:evt-old-story');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-old-story');
  assert.equal(patches.length, 1);
  assert.equal(JSON.parse(patches[0].options.payload).archived, true);
});

test('backfillStoryExclusion_ also archives an already-closed legacy Story event, not only open ones', () => {
  // Codex-reported gap: the reconciler only ever archived openEvents,
  // never events a Story already had closed under the pre-fix generic
  // path (real Ended At, a fictitious multi-day Duration (h) already
  // computed) — those would sit in the authoritative data forever,
  // uncorrected, since a Status = In Progress-scoped backfill query would
  // never even see that Story again either.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dee06';
  const { sandbox, fetchLog } = harness({
    // See "a Story's stray open Time Event..." test above for why this is
    // needed.
    scriptProperties: { TASK_ORIGIN_BACKFILL_COMPLETE: 'true' },
    tasks: [taskPage(taskId, {
      status: 'Done',
      agent: 'Claude Opus',
      lastEdited: '2026-08-20T10:00:00.000Z',
      startedAt: '2026-08-12T12:42:00.000Z',
      type: 'Story',
    })],
    events: [eventPage('evt-legacy-closed-story', {
      actor: 'Claude',
      startedAt: '2026-08-12T12:42:00.000Z',
      endedAt: '2026-08-19T09:00:00.000Z',
    })],
  });

  const summary = sandbox.backfillStoryExclusion_();

  assert.equal(summary.outcomes[0], 'archived_story_event:evt-legacy-closed-story');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-legacy-closed-story');
  assert.equal(patches.length, 1);
  assert.equal(JSON.parse(patches[0].options.payload).archived, true);
});

test('backfillStoryExclusion_ is a free re-scan once a Story has already been archived out', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dee04';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-12T12:42:00.000Z',
      startedAt: '2026-08-12T12:42:00.000Z',
      type: 'Story',
    })],
    events: [],
  });

  sandbox.backfillStoryExclusion_();
  const mutationsAfterFirst =
    requestsTo(fetchLog, 'POST', '/v1/pages').length + requestsTo(fetchLog, 'PATCH', '/v1/pages').length;

  const second = sandbox.backfillStoryExclusion_();

  // backfillStoryExclusion_ deliberately bypasses reconcileTaskPage_'s
  // ordinary snapshot dedup (round 23 — see its own call site comment: a
  // Time Event can be added directly to an already-reconciled Story
  // without the Story page's own snapshot ever changing, so relying on
  // dedup here would leave such an event's archival waiting on an
  // unrelated page edit that might never come). So the second call here
  // genuinely re-runs reconcileStoryTask_ rather than short-circuiting on
  // `duplicate:` — free either way, since there is nothing left to
  // archive: 'story_excluded' this time, not `duplicate:`.
  assert.equal(second.outcomes[0], 'story_excluded');
  const mutationsAfterSecond =
    requestsTo(fetchLog, 'POST', '/v1/pages').length + requestsTo(fetchLog, 'PATCH', '/v1/pages').length;
  assert.equal(mutationsAfterSecond, mutationsAfterFirst);
});

test('backfillStoryExclusion_ resumes past a truncated prefix instead of re-fetching it forever', () => {
  // Codex-reported gap: archiving a Story's Time Event does not remove the
  // Story itself from this query's own Type=Story result set (nothing
  // about its Type changed), so — before this fix — a truncated call's
  // unqualified re-run kept re-fetching the identical oldest 50-page
  // prefix forever, and a Story beyond it could never be reached despite
  // the "call again to continue" instruction.
  let pageCalls = 0;
  const seenFilters = [];
  const routes = {
    [TASKS_QUERY]: (body) => {
      pageCalls += 1;
      seenFilters.push(body.filter);
      // Force paginateNotionQuery_'s own truncation (QUERY_PAGE_SAFETY_LIMIT
      // = 50 pages) by always claiming more exist, one Story per page.
      const idx = pageCalls;
      const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43dg' + String(idx).padStart(3, '0'), {
        status: 'In Progress',
        agent: 'Claude Opus',
        lastEdited: '2026-08-01T00:' + String(idx).padStart(2, '0') + ':00.000Z',
        startedAt: '2026-08-01T00:00:00.000Z',
        type: 'Story',
      });
      return { results: [task], has_more: true, next_cursor: 'cursor-' + idx };
    },
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
  });

  const firstRun = sandbox.backfillStoryExclusion_();

  assert.equal(firstRun.truncated, true);
  assert.equal(firstRun.scanned, 50); // QUERY_PAGE_SAFETY_LIMIT
  assert.deepEqual(seenFilters[0], { property: 'Type', select: { equals: 'Story' } }); // first call: no resume clause yet
  const resumeCursor = scriptProps.get('STORY_EXCLUSION_RESUME_CURSOR');
  assert.ok(resumeCursor, 'expected a resume cursor to be persisted after a truncated backfill');

  sandbox.backfillStoryExclusion_();

  // The second call's query must be filtered to on-or-after the persisted
  // resume cursor — not the same bare single-clause filter as the first
  // call, which would just return the identical 50-page prefix again.
  const secondCallFilter = seenFilters[seenFilters.length - 50];
  assert.ok(secondCallFilter.and, 'expected the resumed call to use a compound and-filter');
  const onOrAfterClause = secondCallFilter.and.find((f) => f.timestamp === 'last_edited_time');
  assert.equal(onOrAfterClause.last_edited_time.on_or_after, resumeCursor);
});

test('backfillStoryExclusion_ bounds its own pagination phase, reserving budget to still process and checkpoint what it fetched', () => {
  // Codex-reported gap: the pagination call had no wall-clock bound of its
  // own, only QUERY_PAGE_SAFETY_LIMIT (50 pages) — so many matching Stories
  // or a slow Notion response could spend this whole call's entire
  // MAX_RUN_DURATION_MS budget just fetching pages, leaving the processing
  // loop below no time to reconcile or checkpoint a single Story. Nothing
  // processed means no `processed` item to derive a checkpoint from, so
  // every retry would repeat the identical fetch-only pass forever.
  let pageCalls = 0;
  const routes = {
    [TASKS_QUERY]: () => {
      pageCalls += 1;
      const idx = pageCalls;
      const ts = '2026-08-01T00:' + String(idx).padStart(2, '0') + ':00.000Z';
      const task = taskPage('3cafbd82-6f3b-8158-9622-d795b43dh' + String(idx).padStart(3, '0'), {
        status: 'In Progress', agent: 'Claude Opus', lastEdited: ts, startedAt: ts, type: 'Story',
      });
      // Far more pages available (20) than the fake clock below will let
      // pagination actually reach — proves the deadline, not exhaustion of
      // available data, is what stops it here.
      return { results: [task], has_more: idx < 20, next_cursor: 'cursor-' + idx };
    },
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  // 25 simulated seconds per Date() read. Pagination's own deadline check
  // (MAX_RUN_DURATION_MS / 2 = 120s past runStartedAt) lands partway
  // through the run, well before all 20 available pages are fetched and
  // well before MAX_RUN_DURATION_MS (240s) itself elapses — leaving real
  // budget behind for the processing loop.
  let ticks = 0;
  const now = () => {
    ticks += 1;
    return ticks * 25 * 1000;
  };
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
    now,
  });

  const summary = sandbox.backfillStoryExclusion_();

  assert.equal(summary.truncated, true);
  assert.ok(pageCalls < 20, 'expected the deadline, not exhausting available pages, to stop pagination: fetched ' + pageCalls);
  // The real point of the fix: budget reserved for processing must not be
  // zero just because pagination itself got cut short.
  assert.ok(summary.processed > 0, 'expected the processing loop to still make progress after a bounded pagination phase');
  const resumeCursor = scriptProps.get('STORY_EXCLUSION_RESUME_CURSOR');
  assert.ok(resumeCursor, 'expected a resume checkpoint to be persisted');
});

test('archiving a Story\'s Time Event also purges its Sheet projection row, not just Notion', () => {
  // Codex-reported gap: archiving removes the event from Notion's own
  // queries, so syncTaskProjection_'s ordinary re-sync (which runs right
  // after reconcileStoryTask_, inside reconcileTaskPage_) never revisits an
  // already-projected Sheet row to update or delete it. README documents
  // the Summary tab's own actor totals / open-event counts as derived from
  // this same projection, so a stale row (Duration (h) already computed,
  // for a closed legacy event) would keep feeding it the identical
  // double-counting this fix exists to stop, just moved from Notion to the
  // Sheet instead of eliminated.
  const taskId = '3b9fbd82-6f3b-81c6-988a-f5a92f93df28';
  const eventId = 'evt-story-projected';
  // A generic events-query stub can't model archival's effect on
  // subsequent queries (it doesn't track state), so this test needs its
  // own: real Notion excludes an archived page from later queries the
  // instant it's archived — including syncTaskProjection_'s own re-query
  // later in the same reconcileTaskPage_ call — and the test must exercise
  // that, not just check the archive PATCH was sent.
  let archived = false;
  const routes = {
    [TASKS_QUERY]: () => ({
      results: [taskPage(taskId, {
        status: 'Done',
        agent: 'Claude Opus',
        lastEdited: '2026-08-30T06:00:00.000Z',
        startedAt: '2026-08-12T12:42:00.000Z',
        type: 'Story',
      })],
      has_more: false,
    }),
    [EVENTS_QUERY]: () => ({
      results: archived ? [] : [eventPage(eventId, {
        actor: 'Claude',
        startedAt: '2026-08-12T12:42:00.000Z',
        endedAt: '2026-08-20T09:00:00.000Z',
      })],
      has_more: false,
    }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    ['PATCH /v1/pages/' + eventId]: () => { archived = true; return {}; },
    'GET *': () => ({}),
  };
  const { sandbox, spreadsheet } = loadCodeGsSandbox({
    // TASK_ORIGIN_BACKFILL_COMPLETE: see "a Story's stray open Time
    // Event..." test above for why this is needed -- this event has no
    // Task Origin= marker.
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', TASK_ORIGIN_BACKFILL_COMPLETE: 'true' },
    fetch: notionFetchStub(routes),
  });
  const sheet = spreadsheet.getSheetByName('Time Events');
  sheet.appendRow([
    'Event ID', 'Task ID', 'Task Title', 'Actor', 'Started At', 'Ended At',
    'Duration (h)', 'Start Status', 'End Status', 'Changed By', 'Notion URL',
    'Source Snapshot ID', 'Recorded At',
  ]);
  sheet.appendRow([
    eventId, taskId, 'T', 'Claude', '2026-08-12T12:42:00.000Z',
    '2026-08-20T09:00:00.000Z', 185, 'In Progress', 'Done', '', '', '', new Date(),
  ]);

  sandbox.pollTaskChanges();

  assert.equal(archived, true, 'expected the event to actually be archived');
  assert.equal(sheet.getLastRow(), 1, 'expected the stale Sheet row to be purged, leaving only the header');
});

test('archiveStoryTimeEvent_ purges the Sheet row before archiving in Notion, so a failed/interrupted archive still leaves it purged', () => {
  // Codex-reported gap on the purge fix itself: archiving in Notion and
  // purging the Sheet row are two separate remote writes, not one
  // transaction. If the archive happened first and then Apps Script died
  // (or the Sheet write simply failed) before the purge ran, a retry would
  // find nothing to do — the event is already excluded from
  // queryNotionTimeEventsForTask_'s results the instant it's archived, so
  // archiveStoryTimeEvent_ would never be called for it again, and the
  // stale row would linger forever. Purging first makes an interruption
  // between the two writes safe: this test simulates the Notion archive
  // itself failing (HTTP 500) and asserts the Sheet row was still purged
  // before that failure — proving the ordering, not just the outcome of a
  // fully successful run (already covered above).
  const eventId = 'evt-story-projected-2';
  let patchCalled = false;
  const fetchStub = (url, options) => {
    const method = String((options && options.method) || 'get').toUpperCase();
    if (method === 'PATCH') {
      patchCalled = true;
      return { getResponseCode: () => 500, getContentText: () => '{"message":"simulated failure"}' };
    }
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  };
  const { sandbox, spreadsheet } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: fetchStub,
  });
  const sheet = spreadsheet.getSheetByName('Time Events');
  sheet.appendRow([
    'Event ID', 'Task ID', 'Task Title', 'Actor', 'Started At', 'Ended At',
    'Duration (h)', 'Start Status', 'End Status', 'Changed By', 'Notion URL',
    'Source Snapshot ID', 'Recorded At',
  ]);
  sheet.appendRow([
    eventId, 'some-task-id', 'T', 'Claude', '2026-08-12T12:42:00.000Z',
    '2026-08-20T09:00:00.000Z', 185, 'In Progress', 'Done', '', '', '', new Date(),
  ]);

  assert.throws(() => {
    sandbox.archiveStoryTimeEvent_({ id: eventId, properties: { Note: { rich_text: [] } } }, 'user:1', 'snap-1');
  }, /Notion API failed/);

  assert.equal(patchCalled, true, 'expected the Notion archive PATCH to actually have been attempted');
  assert.equal(sheet.getLastRow(), 1, 'expected the Sheet row to already be purged even though the Notion archive failed');
});

test('a Task reclassified from Story does not trust its stale Story-era Started At', () => {
  // Codex-reported gap: a page that was Type=Story before being reclassified
  // as Task carries no Time Event history of its own by the time this call
  // sees it — reconcileStoryTask_ already archived every event the Story
  // ever accumulated, and an archived page never resurfaces in
  // queryNotionTimeEventsForTask_'s results. So the "first-ever event"
  // branch below finds allEvents empty exactly like it would for a
  // genuinely brand-new Task, and would otherwise unconditionally trust the
  // Task's own Started At — but here that Started At (2026-08-12, over
  // three weeks earlier) still reflects when this page first went In
  // Progress AS A STORY, not when its now-executable Task life began. The
  // fix (taskWasEverReconciledAsStory_) uses this script's own Sync Log —
  // the durable record reconcileStoryTask_ itself wrote every time this
  // exact page was reconciled as a Story — to detect that history and
  // refuse to trust Started At, falling back to the observed edit time of
  // this exact reclassification instead.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43d1f03';
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-09-04T05:00:00.000Z',
      startedAt: '2026-08-12T12:42:00.000Z',
      type: 'Task',
    })],
    // This Task's own event history is empty — its Story-era events were
    // already archived away and no longer surface in a query, exactly as a
    // live reclassification would look.
    noEventsForTaskIds: [taskId],
  });
  // Seed the Sync Log with the same Outcome marker reconcileStoryTask_
  // itself writes, proving this exact page was reconciled as a Story on a
  // prior poll.
  sandbox.logSnapshot_(
    'snap-story-1', 'notion_poll', taskId, 'In Progress',
    new Date('2026-08-30T00:00:00.000Z'), 'story_excluded'
  );

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.processed, 1);
  assert.match(summary.outcomes[0], /^opened:/);
  const creates = requestsTo(fetchLog, 'POST', '/v1/pages');
  assert.equal(creates.length, 1);
  const created = JSON.parse(creates[0].options.payload);
  assert.equal(
    created.properties['Started At'].date.start,
    '2026-09-04T05:00:00.000Z',
    'expected the event to start at the Story-to-Task reclassification edit, not the stale Story-era Started At'
  );
});

test('a Task that already completed one execution after its Story conversion trusts a fresh Started At on a later reopen', () => {
  // Codex-reported gap on the reclassification fix itself: a page that was
  // ever Type=Story keeps its Sync Log 'story_excluded' marker on file
  // forever (old rows are never deleted), so storyConversionHappenedWhileInProgress_
  // must not keep reporting Story risk long after the page's own first
  // post-conversion execution completed and closed a real Task-era event —
  // by then, later, non-Story Sync Log rows exist from the ordinary polls
  // that observed and closed that execution, and
  // storyConversionHappenedWhileInProgress_ only ever looks at the SINGLE
  // MOST RECENT row for this Task ID, which by now is one of those, not
  // the old Story marker. Without that, a LATER reopen of this same,
  // by-now-ordinary Task would keep being wrongly suppressed — falling
  // back to a later observed edit (`when`) instead of trusting the
  // reopen's own fresh Started At, exactly the "reopened Task" behavior
  // every other Task already gets (see 'a reopened Task starts its new
  // interval from the current Started At, not a later observed edit'
  // above). This is the same fixture shape as that test, plus the old
  // Story-history marker AND a later, ordinary Sync Log row from the
  // historical event's own real execution, proving a stale Story marker no
  // longer matters once a newer, non-Story observation is on file.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43daa02';
  const historicalTaskEraEvent = eventPage('evt-post-conversion', {
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
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [historicalTaskEraEvent] });
  sandbox.logSnapshot_(
    'snap-story-old', 'notion_poll', taskId, 'In Progress',
    new Date('2026-08-10T00:00:00.000Z'), 'story_excluded'
  );
  // The ordinary poll that closed the real Task-era event above -- exactly
  // what production would have logged at the time, and what makes this
  // page's most recent Sync Log observation NOT a Story one by the time of
  // the later reopen below.
  sandbox.logSnapshot_(
    'snap-task-era-closed', 'notion_poll', taskId, 'Review',
    new Date('2026-08-20T01:00:00.000Z'), 'closed:evt-post-conversion'
  );

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  assert.equal(
    creates[0].properties['Started At'].date.start,
    '2026-08-30T05:10:00.000Z',
    'expected the reopen\'s own fresh Started At to be trusted, not suppressed by the page\'s old Story history'
  );
});

test('a Task reclassified to Story preserves genuine Task-era Time Events instead of erasing them', () => {
  // Codex-reported gap (P1): reconcileStoryTask_ used to archive EVERY
  // event for a Story-typed page unconditionally, including real work
  // recorded while this exact page genuinely was an executable Task
  // before being reclassified. Type transitions go both ways (see
  // storyConversionHappenedWhileInProgress_ for the Story-to-Task mirror),
  // so this exercises Task-to-Story: a page with one still-open and one
  // already-closed genuine Task-era event should have the open one closed
  // at the conversion boundary (preserving its real duration) and the
  // closed one left completely untouched — neither archived away as
  // though it were pre-fix bogus stray data.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dbb01';
  // Each event's own Note carries the immutable Task Origin= marker
  // stamped at creation — eventWasTouchedDuringTaskExecution_ looks this
  // up directly on the event, not the page (and not the ordinary, mutable
  // Snapshot=, which reconcileStoryTask_'s own close would otherwise
  // overwrite — see its own comment), so the fixture must tie each event
  // to its own Sync Log row rather than merely seeding one for the Task ID.
  const openEvent = eventPage('evt-open-task-era', {
    actor: 'Claude',
    startedAt: '2026-08-28T00:00:00.000Z',
    note: 'Task Origin=snap-task-era-open',
  });
  const closedEvent = eventPage('evt-closed-task-era', {
    actor: 'Claude',
    startedAt: '2026-08-20T00:00:00.000Z',
    endedAt: '2026-08-20T02:00:00.000Z',
    note: 'Task Origin=snap-task-era-closed',
  });
  const conversionEdit = '2026-08-30T05:00:00.000Z';
  const task = taskPage(taskId, {
    status: 'Review',
    agent: 'Claude Opus',
    lastEdited: conversionEdit,
    startedAt: '2026-08-28T00:00:00.000Z',
    type: 'Story',
  });
  const { sandbox, fetchLog } = harness({
    tasks: [task],
    events: [openEvent, closedEvent],
  });
  // Seed proof each specific event was itself touched by the ordinary Task
  // path, with an explicit post-upgrade Type record — the same Outcome
  // shape (and Type column) reconcileTaskPage_ itself would have logged
  // via logSnapshot_, keyed by the exact Snapshot ID each event's own Note
  // carries above.
  sandbox.logSnapshot_(
    'snap-task-era-open', 'notion_poll', taskId, 'In Progress',
    new Date('2026-08-28T00:00:00.000Z'), 'opened:' + openEvent.id, 'Task'
  );
  sandbox.logSnapshot_(
    'snap-task-era-closed', 'notion_poll', taskId, 'In Progress',
    new Date('2026-08-20T00:00:00.000Z'), 'opened:' + closedEvent.id, 'Task'
  );

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.processed, 1);
  assert.equal(summary.outcomes[0], 'closed_task_era_at_story_conversion:evt-open-task-era');
  const openPatches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-open-task-era');
  assert.equal(openPatches.length, 1, 'expected the open Task-era event to be closed, not archived');
  const closePayload = JSON.parse(openPatches[0].options.payload);
  assert.equal(closePayload.archived, undefined);
  assert.equal(closePayload.properties['Ended At'].date.start, conversionEdit);
  const closedEventPatches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-closed-task-era');
  assert.equal(closedEventPatches.length, 0, 'expected the already-closed Task-era event to be left completely untouched');
});

test('a Story converted to Task while idle trusts the freshly recorded Started At of its later first execution', () => {
  // Codex-reported gap (P2) on the Story-to-Task Started-At-distrust fix:
  // restricting distrust to require the page's MOST RECENT Story
  // observation to have been In Progress — a page reclassified while
  // Ready/Backlog, whose actual first execution only starts in a LATER,
  // distinct poll, has a Started At freshly (re)recorded for that
  // execution and should be trusted normally, just like any other Task's
  // first open.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dcc01';
  const freshStart = '2026-08-30T05:10:00.000Z';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T05:15:00.000Z', // a later observed edit than the true restart
    startedAt: freshStart,
    type: 'Task',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], noEventsForTaskIds: [taskId] });
  // The page's last-known Story observation was while Ready, not In
  // Progress — proof the conversion happened while idle, and this
  // In-Progress spell is a later, distinct, genuinely fresh execution.
  sandbox.logSnapshot_(
    'snap-story-idle', 'notion_poll', taskId, 'Ready',
    new Date('2026-08-25T00:00:00.000Z'), 'story_excluded'
  );

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  assert.equal(
    creates[0].properties['Started At'].date.start,
    freshStart,
    'expected the fresh Started At to be trusted since the page was idle (Ready), not In Progress, at its last-known Story observation'
  );
});

test('an idle Task observation after a Story\'s In-Progress spell clears the stale Story carryover', () => {
  // Codex-reported gap (P2) on the idle-conversion fix itself: taking only
  // the last Story-marked row's Status ignored any LATER, non-Story row in
  // between. A Story last seen In Progress, reclassified to Task and left
  // idle (Status = Ready) in the same edit, reconciled once while idle,
  // and only later actually beginning In Progress must have that later
  // fresh Started At trusted — the intervening idle observation proves
  // Type had already changed and the page was NOT continuously In
  // Progress across the conversion.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dff01';
  const freshStart = '2026-08-30T05:10:00.000Z';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T05:15:00.000Z',
    startedAt: freshStart,
    type: 'Task',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], noEventsForTaskIds: [taskId] });
  // Oldest: last seen as Story, still In Progress.
  sandbox.logSnapshot_(
    'snap-story-inprogress', 'notion_poll', taskId, 'In Progress',
    new Date('2026-08-20T00:00:00.000Z'), 'story_excluded'
  );
  // Newer: reclassified to Task and observed idle (Ready) — this is the
  // row that must clear the carryover, even though it isn't itself a
  // Story marker.
  sandbox.logSnapshot_(
    'snap-idle-task', 'notion_poll', taskId, 'Ready',
    new Date('2026-08-25T00:00:00.000Z'), 'no_change:Ready', 'Task'
  );

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  assert.equal(
    creates[0].properties['Started At'].date.start,
    freshStart,
    'expected the fresh Started At to be trusted -- the intervening idle Task observation should have cleared the stale In-Progress Story carryover'
  );
});

test('closing a Task-era event via the Story conversion itself does not poison its own Task Origin= provenance', () => {
  // Codex-reported gap (P1): reconcileStoryTask_'s own close of a genuine
  // Task-era event (see the preservation test above) used to read the
  // ordinary, mutable Snapshot= field for provenance -- but that same
  // close also WRITES a new Snapshot= (this exact Story-typed poll's own
  // snapshot) into the event's Note. Any LATER re-observation of this
  // now-closed event (e.g. an unrelated later edit to the same Story)
  // would then misread its own most recent Snapshot= as Story-typed and
  // archive it after all, undoing the preservation this mechanism exists
  // for. Task Origin= is immune: stamped once at creation, never touched
  // by the conversion close, so it must still read as Task-era on the
  // later poll.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dhh01';
  const openEvent = eventPage('evt-survives-story-close', {
    actor: 'Claude',
    startedAt: '2026-08-28T00:00:00.000Z',
    // The exact value createNotionTimeEvent_ itself would have stamped
    // directly, back when this page genuinely was a Task.
    note: 'Task Origin=Task',
  });
  const task = taskPage(taskId, {
    status: 'Review',
    agent: 'Claude Opus',
    lastEdited: '2026-08-30T05:00:00.000Z',
    startedAt: '2026-08-28T00:00:00.000Z',
    type: 'Story',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [openEvent] });

  // First poll: the Story conversion closes the event, preserving its
  // duration -- and, along the way, stamps a NEW ordinary Snapshot= (this
  // exact poll's own, Story-typed snapshot) into the event's Note.
  const first = sandbox.pollTaskChanges();
  assert.equal(first.outcomes[0], 'closed_task_era_at_story_conversion:evt-survives-story-close');
  // Reflect that close back onto the in-memory fixture, exactly as Notion
  // itself would now show it, so the second poll below sees it.
  const firstClosePatch = JSON.parse(
    requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-survives-story-close')[0].options.payload
  );
  openEvent.properties['Ended At'] = { type: 'date', date: firstClosePatch.properties['Ended At'].date };
  openEvent.properties.Note = {
    type: 'rich_text',
    rich_text: [{ plain_text: firstClosePatch.properties.Note.rich_text[0].text.content }],
  };

  // A later, unrelated edit to the same Story (still Type = Story).
  task.properties['Assigned Agent'] = { type: 'select', select: { name: 'Claude Sonnet' } };
  task.last_edited_time = '2026-09-01T00:00:00.000Z';

  const second = sandbox.pollTaskChanges();

  assert.equal(
    second.outcomes[0],
    'story_excluded',
    'expected the now-closed Task-era event to be left untouched (no archive) on the later poll -- Task Origin= must survive the conversion close'
  );
  const laterPatches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-survives-story-close');
  assert.equal(laterPatches.length, 1, 'expected only the first poll\'s close PATCH -- no archive PATCH on the later poll');
});

test('backfillTaskOriginProvenance_ flags every pre-existing event as ambiguous, regardless of its page\'s current Type', () => {
  // Codex-reported gap (P1) across two rounds of this fix: a page's
  // CURRENT Type at backfill time never proves anything about a
  // pre-existing event's true history, in EITHER direction -- a page
  // could have flipped Type any number of times before this revision was
  // ever deployed, with no record of when. An earlier version of this
  // backfill trusted a currently-non-Story page's Type as confirmation;
  // this proves the corrected, unconditional behavior: every pre-existing
  // event without a marker gets the ambiguous sentinel, whatever Type its
  // page currently reads, and the query itself is no longer scoped by
  // Type at all (queries every page).
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dii01';
  const legacyEvent = eventPage('evt-legacy-task-era', {
    actor: 'Claude',
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T02:00:00.000Z',
    // No note at all -- exactly what a genuinely pre-upgrade event looks
    // like, since Task Origin= didn't exist yet when it was created.
  });
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'Done',
      agent: 'Claude Opus',
      lastEdited: '2026-08-01T00:05:00.000Z',
      startedAt: '2026-08-01T00:00:00.000Z',
      type: 'Task',
    })],
    events: [legacyEvent],
  });

  const summary = sandbox.backfillTaskOriginProvenance_();

  const query = JSON.parse(requestsTo(fetchLog, 'POST', TASKS_DS)[0].options.payload);
  assert.equal(query.filter, undefined, 'expected no Type restriction at all on the very first (unresumed) call');
  assert.equal(summary.scanned, 1);
  assert.equal(summary.processed, 1);
  assert.equal(summary.outcomes[0], 'flagged_ambiguous_provenance:evt-legacy-task-era');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-legacy-task-era');
  assert.equal(patches.length, 1);
  const noteContent = JSON.parse(patches[0].options.payload).properties.Note.rich_text[0].text.content;
  assert.equal(noteContent, 'Task Origin=ambiguous-pre-upgrade');
});

test('backfillTaskOriginProvenance_ is a free re-scan once an event already has Task Origin=', () => {
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dii02';
  const alreadyStamped = eventPage('evt-already-stamped', {
    actor: 'Claude',
    startedAt: '2026-08-01T00:00:00.000Z',
    note: 'Task Origin=snap-existing',
  });
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage(taskId, {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-01T00:05:00.000Z',
      startedAt: '2026-08-01T00:00:00.000Z',
      type: 'Task',
    })],
    events: [alreadyStamped],
  });

  const summary = sandbox.backfillTaskOriginProvenance_();

  assert.equal(summary.outcomes[0], 'no_backfill_needed:' + taskId);
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-already-stamped');
  assert.equal(patches.length, 0, 'expected an event that already has Task Origin= to be left completely untouched, not re-stamped');
});

test('after backfillTaskOriginProvenance_, a pre-upgrade Task-era event survives a later reclassification to Story', () => {
  // End-to-end proof: the backfill's own stamp is exactly what
  // eventWasTouchedDuringTaskExecution_ needs later, when the same page
  // is reclassified to Story.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dii03';
  const legacyEvent = eventPage('evt-legacy-survives', {
    actor: 'Claude',
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T02:00:00.000Z',
  });
  const task = taskPage(taskId, {
    status: 'Done',
    agent: 'Claude Opus',
    lastEdited: '2026-08-01T00:05:00.000Z',
    startedAt: '2026-08-01T00:00:00.000Z',
    type: 'Task',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [legacyEvent] });

  sandbox.backfillTaskOriginProvenance_();
  // Reflect the backfill's PATCH back onto the fixture, exactly as Notion
  // itself would now show it.
  const backfillPatch = JSON.parse(
    requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-legacy-survives')[0].options.payload
  );
  legacyEvent.properties.Note = {
    type: 'rich_text',
    rich_text: [{ plain_text: backfillPatch.properties.Note.rich_text[0].text.content }],
  };

  // Now reclassify the Task to Story.
  task.properties.Type = { type: 'select', select: { name: 'Story' } };
  task.last_edited_time = '2026-09-01T00:00:00.000Z';

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'skipped_ambiguous_pre_upgrade_provenance:evt-legacy-survives');
  const archivePatches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-legacy-survives');
  assert.equal(
    archivePatches.length, 1,
    'expected only the backfill\'s own PATCH -- no archive PATCH from the reclassification'
  );
});

test('backfillTaskOriginProvenance_ flags events on already-Story pages as ambiguous, and reconcileStoryTask_ skips them entirely', () => {
  // Codex-reported gap (P1): the earlier backfill excluded currently-Story
  // pages, so an event genuinely created while its page was still a Task
  // -- but the page was already reclassified to Story before this
  // revision was deployed -- would never get any Task Origin= marker at
  // all, and backfillStoryExclusion_ would archive it as though it were
  // bogus pre-fix Story stray data, permanently erasing real work. The
  // true origin is genuinely unrecoverable for such a page (its current
  // Type already reads Story either way), so this proves the fix: a
  // distinct 'ambiguous-pre-upgrade:' marker instead, and
  // reconcileStoryTask_ leaves it completely untouched rather than
  // guessing in either direction.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43djj01';
  const ambiguousEvent = eventPage('evt-ambiguous', {
    actor: 'Claude',
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T02:00:00.000Z',
  });
  const task = taskPage(taskId, {
    status: 'Done',
    agent: 'Claude Opus',
    lastEdited: '2026-08-01T00:05:00.000Z',
    startedAt: '2026-08-01T00:00:00.000Z',
    type: 'Story', // already Story at backfill time
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [ambiguousEvent] });

  const backfillSummary = sandbox.backfillTaskOriginProvenance_();
  assert.equal(backfillSummary.outcomes[0], 'flagged_ambiguous_provenance:evt-ambiguous');
  const backfillPatch = JSON.parse(
    requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-ambiguous')[0].options.payload
  );
  const noteContent = backfillPatch.properties.Note.rich_text[0].text.content;
  assert.equal(noteContent, 'Task Origin=ambiguous-pre-upgrade');
  ambiguousEvent.properties.Note = { type: 'rich_text', rich_text: [{ plain_text: noteContent }] };

  // A later poll re-observing the (still Story-typed) page must leave the
  // flagged event completely untouched -- no archive, no close.
  task.last_edited_time = '2026-09-01T00:00:00.000Z';
  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'skipped_ambiguous_pre_upgrade_provenance:evt-ambiguous');
  const laterPatches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-ambiguous');
  assert.equal(
    laterPatches.length, 1,
    'expected only the backfill\'s own PATCH -- no archive/close PATCH from the later poll'
  );
});

test('a failed backfillTaskOriginForTask_ patch leaves no partial state, so a retry cleanly re-attempts the same event', () => {
  // Codex-reported gap (P2) on an earlier, two-write version of this
  // backfill (a Notion patch plus a separate Sync Log append): if the
  // patch succeeded but the second write failed or was interrupted, the
  // event would permanently carry an unresolvable marker that the
  // backfill's own existingOrigin check would then skip forever. The
  // current design has only ONE write per event -- the event's own Note,
  // holding the Type value directly -- so there is nothing left to
  // desynchronize: this proves that a failed patch leaves existingOrigin
  // still empty, and a retry (the next backfill call) simply re-attempts
  // the same event from scratch.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dkk01';
  const baseStub = notionFetchStub({
    [TASKS_QUERY]: () => ({
      results: [taskPage(taskId, {
        status: 'Done', agent: 'Claude Opus',
        lastEdited: '2026-08-01T00:05:00.000Z', startedAt: '2026-08-01T00:00:00.000Z', type: 'Task',
      })],
      has_more: false,
    }),
    [EVENTS_QUERY]: () => ({
      results: [eventPage('evt-retry-safety', {
        actor: 'Claude', startedAt: '2026-08-01T00:00:00.000Z', endedAt: '2026-08-01T02:00:00.000Z',
      })],
      has_more: false,
    }),
    'GET *': () => ({}),
  });
  let patchAttempts = 0;
  let failNextPatch = true;
  const fetchStub = (url, options) => {
    const method = String((options && options.method) || 'get').toUpperCase();
    if (method === 'PATCH' && url.indexOf('/v1/pages/evt-retry-safety') >= 0) {
      patchAttempts++;
      if (failNextPatch) {
        return { getResponseCode: () => 500, getContentText: () => '{"message":"simulated failure"}' };
      }
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    }
    return baseStub(url, options);
  };
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: fetchStub,
  });

  assert.throws(() => sandbox.backfillTaskOriginProvenance_(), /Notion API failed/);
  assert.equal(patchAttempts, 1, 'expected the first attempt\'s patch to actually have been tried');

  failNextPatch = false;
  const retrySummary = sandbox.backfillTaskOriginProvenance_();

  assert.equal(patchAttempts, 2, 'expected the retry to re-attempt the same event, not skip it as already handled');
  assert.equal(retrySummary.outcomes[0], 'flagged_ambiguous_provenance:evt-retry-safety');
});

test('createNotionTimeEvent_ stamps NO_TYPE_MARKER (not a blank marker) when the Task page\'s Type is unset, so the event survives a later reclassification to Story', () => {
  // Codex-reported gap (P1, round 17): buildNote_'s `if (fields.taskOriginType)`
  // is a plain truthy check, so passing the Task's raw Type straight through
  // (createNotionTimeEvent_'s prior behavior) silently omitted `Task Origin=`
  // from the Note entirely whenever Type read blank (''), the ordinary case
  // for ANY page that has never had its Type select set at all -- making a
  // genuinely-new, directly-observed event indistinguishable from a
  // pre-existing event that never got a marker (eventProvenanceIsAmbiguous_
  // would find no marker either way), and vulnerable to being either archived
  // outright or, worse, permanently stuck "skipped" as ambiguous by a later
  // reclassification, despite this script having witnessed its creation on a
  // page it knows for certain was not Story at that exact moment.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dll01';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: '2026-08-28T00:00:00.000Z',
    startedAt: '2026-08-28T00:00:00.000Z',
    // type intentionally omitted (defaults to null / blank Type select).
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], noEventsForTaskIds: [taskId] });

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  const createdNote = creates[0].properties.Note.rich_text[0].text.content;
  assert.match(
    createdNote, /Task Origin=unset-type/,
    'expected a blank-Type page\'s newly created event to carry the NO_TYPE_MARKER sentinel, not an omitted Task Origin='
  );

  // Reflect the create back onto an in-memory event fixture, exactly as
  // Notion itself would now show it, then reclassify the page to Story.
  const createdEvent = eventPage('evt-created-blank-type', {
    actor: 'Claude',
    startedAt: '2026-08-28T00:00:00.000Z',
    note: createdNote,
  });
  const { sandbox: sandbox2, fetchLog: fetchLog2 } = harness({
    tasks: [(() => {
      const reclassified = taskPage(taskId, {
        status: 'Review',
        agent: 'Claude Opus',
        lastEdited: '2026-08-30T05:00:00.000Z',
        startedAt: '2026-08-28T00:00:00.000Z',
        type: 'Story',
      });
      return reclassified;
    })()],
    events: [createdEvent],
  });

  const summary = sandbox2.pollTaskChanges();

  // Must be preserved (closed at the conversion boundary, real duration
  // kept) like any other confirmed Task-era event -- NOT archived as bogus
  // Story stray data, and NOT left "skipped" as unprovable-ambiguous either.
  assert.equal(summary.outcomes[0], 'closed_task_era_at_story_conversion:evt-created-blank-type');
  const patches = requestsTo(fetchLog2, 'PATCH', '/v1/pages/evt-created-blank-type');
  assert.equal(patches.length, 1);
  const payload = JSON.parse(patches[0].options.payload);
  assert.equal(payload.archived, undefined, 'expected a close, not an archive');
  assert.ok(payload.properties['Ended At'], 'expected the open event to be closed with a real Ended At');
});

test('backfillStoryExclusion_ never resolves an ambiguous-marked event -- it stays skipped exactly like every other caller', () => {
  // Codex-reported gap (P1, round 18), reverting a round-17 attempt: that
  // attempt made backfillStoryExclusion_ archive an ambiguous-marked event
  // on the reasoning that this backfill only ever visits pages that ARE
  // Story right now. Codex correctly pointed out this repeats the exact
  // current-Type fallacy backfillTaskOriginProvenance_'s own design already
  // root-caused twice over: current Type never proves anything about
  // pre-revision event history, in either direction, no matter how the
  // caller scopes its own query -- so archiving here risked erasing
  // genuine pre-upgrade Task-era work exactly like the mistake this whole
  // marker exists to prevent. Reverted to the single, universal behavior:
  // no caller ever resolves this marker -- proven here directly against
  // backfillStoryExclusion_, and by the existing pollTaskChanges-based
  // tests above for the other callers.
  // Already closed — an OPEN ambiguous event is a distinct case (bounded,
  // not archived, since round 23: see the "closes ambiguous open events
  // in place" test below). This test's own purpose is narrower and
  // unaffected by that: an already-closed ambiguous event must never be
  // archived, by any caller.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dmm01';
  const ambiguousEvent = eventPage('evt-ambiguous-on-story', {
    actor: 'Claude',
    startedAt: '2026-08-01T00:00:00.000Z',
    endedAt: '2026-08-01T02:00:00.000Z',
    note: 'Task Origin=ambiguous-pre-upgrade',
  });
  const task = taskPage(taskId, {
    status: 'Done',
    agent: 'Claude Opus',
    lastEdited: '2026-08-20T10:00:00.000Z',
    startedAt: '2026-08-01T00:00:00.000Z',
    type: 'Story',
  });
  const { sandbox, fetchLog } = harness({
    tasks: [task],
    events: [ambiguousEvent],
  });

  const summary = sandbox.backfillStoryExclusion_();

  assert.equal(summary.outcomes[0], 'skipped_ambiguous_pre_upgrade_provenance:evt-ambiguous-on-story');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-ambiguous-on-story');
  assert.equal(patches.length, 0, 'expected no archive/patch of an already-closed ambiguous-marked event from this backfill');
});

test('reconcileStoryTask_ closes an ambiguous OPEN event in place, bounding its duration, without archiving it or touching its Task Origin= marker', () => {
  // Codex-reported gap (P1, round 23): leaving an ambiguous-marked OPEN
  // event exactly as found is correct while its page keeps reading
  // Type = Story (see this branch's own comment above) -- but "exactly as
  // found" must still mean CLOSING it if it is still open, or it keeps
  // accruing time indefinitely for as long as its page stays Story,
  // reintroducing the double-counting BUG-ADP-TTE-01 exists to stop.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43drr01';
  const ambiguousOpenEvent = eventPage('evt-ambiguous-open', {
    actor: 'Claude',
    startedAt: '2026-08-01T00:00:00.000Z',
    note: 'Task Origin=ambiguous-pre-upgrade',
  });
  const observedEdit = '2026-08-30T05:00:00.000Z';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: observedEdit,
    startedAt: '2026-08-01T00:00:00.000Z',
    type: 'Story',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [ambiguousOpenEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'closed_ambiguous_pre_upgrade_provenance:evt-ambiguous-open');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-ambiguous-open');
  assert.equal(patches.length, 1);
  const payload = JSON.parse(patches[0].options.payload);
  assert.equal(payload.archived, undefined, 'expected a close, not an archive');
  assert.equal(payload.properties['Ended At'].date.start, observedEdit);
  const noteContent = payload.properties.Note.rich_text[0].text.content;
  assert.match(noteContent, /Reason=ambiguous_provenance_bounded/);
  // Its own Task Origin= survives the close untouched (appendNote_ only
  // ever adds to a Note, never rewrites an existing field) -- still
  // available for an operator to review by hand later.
  assert.match(noteContent, /Task Origin=ambiguous-pre-upgrade/);

  // A later re-observation (page still Story, event now closed) leaves it
  // completely untouched from here on -- no re-close, no archive.
  ambiguousOpenEvent.properties['Ended At'] = { type: 'date', date: payload.properties['Ended At'].date };
  ambiguousOpenEvent.properties.Note = { type: 'rich_text', rich_text: [{ plain_text: noteContent }] };
  task.last_edited_time = '2026-09-01T00:00:00.000Z';
  const second = sandbox.pollTaskChanges();
  assert.equal(second.outcomes[0], 'skipped_ambiguous_pre_upgrade_provenance:evt-ambiguous-open');
  assert.equal(requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-ambiguous-open').length, 1, 'expected no further writes to the already-closed event');
});

test('an ordinary poll never archives a marker-less Story event before the provenance backfill has ever fully drained', () => {
  // Codex-reported gap (P1, round 19): on an EXISTING live deployment, the
  // already-installed pollTaskChanges trigger keeps running independently
  // the moment this revision's code is deployed -- it does not wait for an
  // operator to run backfillTaskOriginProvenance_() first, and that
  // backfill itself can take multiple wall-clock-bounded calls to drain on
  // a large workspace. A Story reached by an ordinary poll during that
  // window has a pre-existing event with no Task Origin= marker YET --
  // not because its origin is confirmed non-Task, simply because the
  // backfill hasn't reached it -- which is indistinguishable from
  // genuinely bogus pre-fix Story stray data from the event's own data
  // alone. Without TASK_ORIGIN_BACKFILL_COMPLETE unset (the default until
  // an operator runs the backfill to a full drain), reconcileStoryTask_
  // must treat a marker-less event the same as an ambiguous one: skipped,
  // not archived.
  const taskId = '3b9fbd82-6f3b-81c6-988a-f5a92f93df28';
  const { sandbox, fetchLog } = harness({
    // Deliberately NOT setting TASK_ORIGIN_BACKFILL_COMPLETE -- this is
    // the default, pre-backfill state on a freshly-deployed existing
    // installation.
    tasks: [taskPage(taskId, {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T06:00:00.000Z',
      startedAt: '2026-08-12T12:42:00.000Z',
      type: 'Story',
    })],
    events: [
      eventPage('evt-race-with-backfill', { actor: 'Claude', startedAt: '2026-08-12T12:42:00.000Z' }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'skipped_pending_provenance_backfill:evt-race-with-backfill');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-race-with-backfill');
  assert.equal(patches.length, 0, 'expected no archive of a marker-less event before the provenance backfill has ever fully drained');
});

test('backfillTaskOriginProvenance_ persists TASK_ORIGIN_BACKFILL_COMPLETE only once it fully drains, not on a truncated or timed-out call', () => {
  const taskId1 = '3cafbd82-6f3b-8158-9622-d795b43dnn01';
  const taskId2 = '3cafbd82-6f3b-8158-9622-d795b43dnn02';

  // First call: force truncation via QUERY_PAGE_SAFETY_LIMIT by returning
  // has_more: true (with an advancing next_cursor) forever, same pattern
  // the other resumable-backfill truncation tests in this file use.
  let pageCount = 0;
  const truncatedStub = notionFetchStub({
    [TASKS_QUERY]: () => {
      pageCount += 1;
      return {
        results: [taskPage(
          '3cafbd82-6f3b-8158-9622-d795b43dnn' + String(pageCount).padStart(2, '0'),
          { status: 'Done', agent: 'Claude Opus', lastEdited: '2026-08-01T00:00:00.000Z', startedAt: '2026-08-01T00:00:00.000Z', type: 'Task' }
        )],
        has_more: true,
        next_cursor: 'c' + pageCount,
      };
    },
    [EVENTS_QUERY]: () => ({ results: [], has_more: false }),
    'GET *': () => ({}),
  });
  const { sandbox: truncatedSandbox, scriptProps: truncatedProps } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: truncatedStub,
  });
  truncatedSandbox.backfillTaskOriginProvenance_();
  assert.equal(
    truncatedProps.get('TASK_ORIGIN_BACKFILL_COMPLETE'), undefined,
    'expected no completion flag from a truncated call'
  );

  // Second, independent sandbox: a small, fully-drained call.
  const { sandbox: fullSandbox, scriptProps: fullProps } = harness({
    tasks: [
      taskPage(taskId1, { status: 'Done', agent: 'Claude Opus', lastEdited: '2026-08-01T00:00:00.000Z', startedAt: '2026-08-01T00:00:00.000Z', type: 'Task' }),
      taskPage(taskId2, { status: 'Done', agent: 'Claude Opus', lastEdited: '2026-08-01T00:00:00.000Z', startedAt: '2026-08-01T00:00:00.000Z', type: 'Task' }),
    ],
    events: [],
  });
  const summary = fullSandbox.backfillTaskOriginProvenance_();
  assert.equal(summary.truncated, false);
  assert.equal(summary.timedOut, false);
  assert.equal(fullProps.get('TASK_ORIGIN_BACKFILL_COMPLETE'), 'true');
});

test('backfillTaskOriginProvenance_ still reaches a tied cohort member whose sibling was edited out of the tie before the resumed call', () => {
  // Codex-reported gap (P1, round 28): the persisted resume state for a
  // tied cohort split across two calls used to be a raw COUNT
  // (the old TASK_ORIGIN_BACKFILL_RESUME_TIE_OFFSET) of how many pages
  // shared the resume cursor's timestamp last time -- not which specific
  // pages. If an already-processed page in that tie is edited before the
  // next call (its own last_edited_time moving later, out of the tie), the
  // resumed on_or_after query returns a smaller tied cohort, and skipping
  // the old (now too-large) count from it silently drops whichever page
  // was never actually visited -- permanently, once this backfill fully
  // drains and TASK_ORIGIN_BACKFILL_COMPLETE lets reconcileStoryTask_'s
  // archive path treat its still-marker-less event as pre-fix Story stray
  // data, even though it may be genuine pre-upgrade Task-era history.
  const taskIdA = '3cafbd82-6f3b-8158-9622-d795b43dzz01';
  const taskIdB = '3cafbd82-6f3b-8158-9622-d795b43dzz02';
  const tiedTimestamp = '2026-08-01T02:00:00.000Z';
  const movedTimestamp = '2026-08-01T03:00:00.000Z'; // taskA edited after call 1, before call 2

  const taskA = taskPage(taskIdA, { status: 'Done', agent: 'Claude Opus', lastEdited: tiedTimestamp, startedAt: tiedTimestamp, type: 'Task' });
  const taskB = taskPage(taskIdB, { status: 'Done', agent: 'Claude Opus', lastEdited: tiedTimestamp, startedAt: tiedTimestamp, type: 'Task' });
  const eventA = eventPage('evt-tie-a', { actor: 'Claude', startedAt: '2026-07-01T00:00:00.000Z', endedAt: '2026-07-01T01:00:00.000Z' });
  const eventB = eventPage('evt-tie-b', { actor: 'Claude', startedAt: '2026-07-01T00:00:00.000Z', endedAt: '2026-07-01T01:00:00.000Z' });

  const eventsQueriedFor = [];
  const routes = {
    [TASKS_QUERY]: (body) => {
      const onOrAfter = body.filter && body.filter.timestamp === 'last_edited_time' && body.filter.last_edited_time.on_or_after;
      const all = [taskA, taskB];
      const filtered = onOrAfter ? all.filter((t) => t.last_edited_time >= onOrAfter) : all;
      return { results: filtered.slice().sort((x, y) => (x.last_edited_time < y.last_edited_time ? -1 : 1)), has_more: false };
    },
    [EVENTS_QUERY]: (body) => {
      const requestedTaskId = body && body.filter && body.filter.relation && body.filter.relation.contains;
      eventsQueriedFor.push(requestedTaskId);
      if (requestedTaskId === taskIdA) return { results: [eventA], has_more: false };
      if (requestedTaskId === taskIdB) return { results: [eventB], has_more: false };
      return { results: [], has_more: false };
    },
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };

  // Seeds exactly the state a real first call would have persisted after
  // processing ONLY taskA out of the {taskA, taskB} tie sharing
  // tiedTimestamp -- i.e. this test starts at the resumed second call.
  const { sandbox, scriptProps } = loadCodeGsSandbox({
    scriptProperties: {
      NOTION_TOKEN: 'test-token',
      SPREADSHEET_ID: 'test-sheet',
      TASK_ORIGIN_BACKFILL_RESUME_CURSOR: tiedTimestamp,
      TASK_ORIGIN_BACKFILL_RESUME_TIE_IDS: taskIdA,
    },
    fetch: notionFetchStub(routes),
  });

  // Between the two calls, taskA is edited for an unrelated reason -- its
  // own last_edited_time moves later, out of the tied cohort the resume
  // point remembers.
  taskA.last_edited_time = movedTimestamp;

  const summary = sandbox.backfillTaskOriginProvenance_();

  assert.ok(
    eventsQueriedFor.indexOf(taskIdB) !== -1,
    'expected taskB, the tie member never actually processed by the first call, to still be visited on resume'
  );
  assert.equal(summary.truncated, false);
  assert.equal(summary.timedOut, false);
  assert.equal(scriptProps.get('TASK_ORIGIN_BACKFILL_COMPLETE'), 'true');
});

test('an ambiguous open event does not silently keep accruing time once its Story page is reclassified to an executable Type with the same assignee', () => {
  // Codex-reported gap (P2, round 20): reconcileStoryTask_ leaves an
  // ambiguous-marked open event exactly as found -- correct while the page
  // stays Type = Story (see its own comment). But reconcileStoryTask_ never
  // runs again once the page is reclassified to an executable Type -- the
  // generic reconcileAuthoritativeTimeEvents_ path takes over, and its
  // ordinary "sameActor already open, just keep going" logic has no idea
  // this particular open event's provenance is unverifiable. Left alone,
  // its eventual Ended At would span from whenever it originally opened
  // (possibly long before this deploy) all the way through the new
  // execution -- reintroducing the exact double-counting this file exists
  // to stop, for precisely the population (ambiguous, not confirmed either
  // way) the generic path was never taught to recognize.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43doo01';
  const staleStart = '2026-07-01T00:00:00.000Z';
  const conversionEdit = '2026-08-30T05:00:00.000Z';
  const ambiguousEvent = eventPage('evt-ambiguous-restart', {
    actor: 'Claude',
    startedAt: staleStart,
    note: 'Task Origin=ambiguous-pre-upgrade',
  });
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: conversionEdit,
    // The Task's own Started At is unchanged from the same original moment
    // the ambiguous event itself opened -- the realistic case for a page
    // that never left In Progress across the Type change.
    startedAt: staleStart,
    type: 'Task',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [ambiguousEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^closed_ambiguous_provenance_restart:evt-ambiguous-restart,opened:/);

  // The old ambiguous event is closed AT THE CONVERSION BOUNDARY, not left
  // open -- its duration is now fixed instead of ever-growing.
  const closePatches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-ambiguous-restart');
  assert.equal(closePatches.length, 1);
  const closePayload = JSON.parse(closePatches[0].options.payload);
  assert.equal(closePayload.properties['Ended At'].date.start, conversionEdit);
  assert.match(closePayload.properties.Note.rich_text[0].text.content, /Reason=ambiguous_provenance_restart/);
  // Its own Task Origin= survives the close untouched (appendNote_ only
  // ever adds to a Note, never rewrites an existing field) -- still
  // available for an operator to review by hand later, exactly as
  // backfillTaskOriginProvenance_ left it.
  assert.match(closePayload.properties.Note.rich_text[0].text.content, /Task Origin=ambiguous-pre-upgrade/);

  // A genuinely new, confirmed event opens starting at the conversion
  // boundary (`when`) -- NOT at the stale original Started At, which would
  // silently re-create the exact interval the close above exists to stop
  // extending. This is the regression this test specifically guards: the
  // in-memory `allEvents` this call started with still shows the ambiguous
  // event as open (it was only just closed via PATCH, same call), so
  // latestEventTimestamp_ alone would see only its stale Started At --
  // matching the Task's own unchanged Started At and wrongly looking
  // "trusted" without the effectiveLatestHistoricalTimestamp fix.
  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  assert.equal(
    creates[0].properties['Started At'].date.start, conversionEdit,
    'expected the new event to start at the conversion boundary, not the stale pre-deploy Started At'
  );
});

test('an ambiguous open event under a DIFFERENT actor is restarted, not reassigned -- its Execution= is never inherited by the new actor\'s event', () => {
  // Codex-reported gap (P2, round 29): the ambiguity check above only ever
  // examined sameActor[0], so an ambiguous open event belonging to a
  // DIFFERENT actor than the newly desired one fell into the ordinary
  // otherActor reassignment-close path instead of being restarted -- and,
  // worse, its own Execution= marker (genuinely present when an event
  // predates Task Origin= tracking but postdates Execution= tracking --
  // appendNote_ preserves it untouched across the later ambiguous backfill)
  // would then be inherited by the brand-new event opened for the new
  // actor, via the ordinary reassignment executionId logic just below.
  // That silently tags current, genuinely valid work with an unverifiable
  // Story-era identity that will not match the Task's own freshly-recorded
  // Started At -- permanently excluding it from enforceDoneGate_'s Done
  // evidence the moment Started At is (correctly) refreshed.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dpp01';
  const conversionEdit = '2026-08-30T05:00:00.000Z';
  const ambiguousEvent = eventPage('evt-ambiguous-other-actor', {
    actor: 'Claude', // different from the Task's desiredActor below ('Human')
    startedAt: '2026-01-01T00:00:00.000Z',
    note: 'Execution=2026-01-01T00:00:00.000Z|Task Origin=ambiguous-pre-upgrade',
  });
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Human',
    lastEdited: conversionEdit,
    startedAt: conversionEdit,
    type: 'Task',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [ambiguousEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.match(
    summary.outcomes[0], /^closed_ambiguous_provenance_restart:evt-ambiguous-other-actor,opened:/,
    'expected the ambiguous event to be restarted, not treated as an ordinary reassignment'
  );

  const closePatches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-ambiguous-other-actor');
  assert.equal(closePatches.length, 1);
  assert.match(
    JSON.parse(closePatches[0].options.payload).properties.Note.rich_text[0].text.content,
    /Reason=ambiguous_provenance_restart/
  );

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  const createdNote = creates[0].properties.Note.rich_text[0].text.content;
  assert.doesNotMatch(
    createdNote, /Execution=2026-01-01/,
    'expected the new event to NOT inherit the ambiguous outgoing event\'s Story-era Execution= identity'
  );
});

test('an ambiguous-provenance restart does not inherit Work Type/Review Source (ADP-051) from the event it just restarted', () => {
  // Codex-reported gap (round 34): otherActor's churnEvents mapping used to
  // include EVERY otherActor event, `ambiguous_provenance_restart` closes
  // included, even though the restart already exists specifically because
  // this event's provenance is unverifiable -- the new event opened here is
  // deliberately a fresh, confirmed execution, never a continuation, and
  // must classify fresh rather than carrying forward an unverifiable
  // Story-era Work Type/Review Source.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dpp02';
  const conversionEdit = '2026-08-30T05:00:00.000Z';
  const ambiguousEvent = eventPage('evt-ambiguous-worktype', {
    actor: 'Claude', // different from the Task's desiredActor below ('Human')
    startedAt: '2026-01-01T00:00:00.000Z',
    note: 'Execution=2026-01-01T00:00:00.000Z | Task Origin=ambiguous-pre-upgrade | Work Type=Review Fix | Review Source=Human',
  });
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Human',
    lastEdited: conversionEdit,
    startedAt: conversionEdit,
    type: 'Task',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [ambiguousEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.match(
    summary.outcomes[0], /^closed_ambiguous_provenance_restart:evt-ambiguous-worktype,opened:/
  );

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  const createdNote = creates[0].properties.Note.rich_text[0].text.content;
  assert.doesNotMatch(
    createdNote, /Review Source=Human/,
    'expected the new event to NOT inherit the ambiguous outgoing event\'s Review Source'
  );
  assert.match(
    createdNote, /Work Type=Initial Work/,
    'expected the new event to classify fresh (no genuine close exists yet) instead of inheriting Review Fix'
  );
  assert.equal(
    fetchLog.filter((e) => e.url.includes('api.github.com')).length, 0,
    'Initial Work never resolves Review Source, so no GitHub call should happen either'
  );
});

test('a page with older, unrelated Task-era history still distrusts a stale Story-era Started At on a later Story-to-Task conversion', () => {
  // Codex-reported gap (P2, round 21): cameFromArchivedStoryHistory used to
  // gate the Sync Log lookup on allEvents.length === 0 -- correct for a
  // page's first-ever event, or one whose entire history was just archived
  // away, but wrong here: this page already has a genuinely older, unrelated
  // closed Task-era event from a completely separate, much earlier
  // execution, so allEvents is never empty, and the old gate skipped the
  // Sync Log check entirely regardless of what happened since. If this same
  // page is LATER used as a Story (In Progress) and then converted back to
  // an executable Type without ever leaving In Progress, the Story spell's
  // own freshly-recorded Started At can easily read newer than that old,
  // unrelated history -- wrongly looking "trusted" by the ordinary
  // freshness check alone, opening the new Task event at the Story's own
  // start instead of the actual conversion boundary and double-counting
  // the intervening Story period.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dpp01';
  const oldUnrelatedEvent = eventPage('evt-old-unrelated', {
    actor: 'Claude',
    startedAt: '2026-07-01T00:00:00.000Z',
    endedAt: '2026-07-01T01:00:00.000Z',
  });
  const storyStart = '2026-08-25T00:05:00.000Z';
  const conversionEdit = '2026-08-30T05:00:00.000Z';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: conversionEdit,
    // The Story spell's own Started At -- freshly recorded when the page
    // most recently went In Progress AS A STORY, well after the old
    // unrelated event closed, so it looks "fresh" by the ordinary check.
    startedAt: storyStart,
    type: 'Task',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [oldUnrelatedEvent] });
  // The page's single most recent Sync Log observation: Story, In Progress.
  sandbox.logSnapshot_(
    'snap-story-recent', 'notion_poll', taskId, 'In Progress',
    new Date(storyStart), 'story_excluded'
  );

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  assert.equal(
    creates[0].properties['Started At'].date.start, conversionEdit,
    'expected the conversion boundary to be trusted, not the Story spell\'s own stale Started At, despite older unrelated Task-era history existing'
  );
});

test('isFreeOutcome_ exempts Story outcomes that are entirely no-write skips, but still charges any outcome that also made a real write', () => {
  // Codex-reported gap (P2, round 21): after the mandatory provenance
  // backfill, skipped_ambiguous_pre_upgrade_provenance: and
  // skipped_pending_provenance_backfill: are now the common outcome for a
  // changed Story with pre-existing events -- neither makes a Notion
  // write, but neither was recognized as free, so 25 such Stories inside
  // one poll's overlap window could exhaust MAX_TASKS_PER_RUN on pure
  // re-skips and defer genuinely write-needing Tasks sorted behind them.
  const { sandbox } = harness();

  // Single no-write skip actions: free.
  assert.equal(sandbox.isFreeOutcome_('skipped_ambiguous_pre_upgrade_provenance:evt-1'), true);
  assert.equal(sandbox.isFreeOutcome_('skipped_pending_provenance_backfill:evt-1'), true);
  // A Story with multiple events, ALL no-write skips (comma-joined): free.
  assert.equal(
    sandbox.isFreeOutcome_('skipped_ambiguous_pre_upgrade_provenance:evt-1,skipped_pending_provenance_backfill:evt-2'),
    true
  );
  // A Story whose events are a MIX of a no-write skip and a real write
  // (archived or closed): still charged, exactly like a pure write would be.
  assert.equal(
    sandbox.isFreeOutcome_('skipped_ambiguous_pre_upgrade_provenance:evt-1,archived_story_event:evt-2'),
    false
  );
  assert.equal(
    sandbox.isFreeOutcome_('closed_task_era_at_story_conversion:evt-1,skipped_pending_provenance_backfill:evt-2'),
    false
  );
  // A pure write outcome: still charged, unaffected by this change.
  assert.equal(sandbox.isFreeOutcome_('archived_story_event:evt-1'), false);
  // Existing free outcomes: unaffected.
  assert.equal(sandbox.isFreeOutcome_('story_excluded'), true);
  assert.equal(sandbox.isFreeOutcome_('duplicate:page-1'), true);
  assert.equal(sandbox.isFreeOutcome_('done_gate_passed'), true);
});

test('storyConversionHappenedWhileInProgress_ recognizes a skipped-ambiguous or skipped-pending-backfill Sync Log row as a Story observation, not only story_excluded/archived_story_event:', () => {
  // Codex-reported gap (P2, round 22): the round-21 fix widened WHEN
  // storyConversionHappenedWhileInProgress_ gets called (whenever Started
  // At would otherwise look fresh, not only when allEvents is empty) --
  // but the function itself only ever recognized 'story_excluded' and
  // 'archived_story_event:' as proof a Sync Log row was logged while Type
  // read Story. Since round 19/20, a changed Story with pre-existing
  // events commonly logs skipped_ambiguous_pre_upgrade_provenance:/
  // skipped_pending_provenance_backfill: instead -- neither was
  // recognized, so a Story whose most recent row happened to be one of
  // those two was invisible to this check. Combined with the round-21 fix
  // (a page with older, unrelated Task-era history reused as Story and
  // converted back), this reintroduced the same double-counting the
  // round-21 fix was meant to close, just reached via a different Sync
  // Log outcome.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dqq01';
  const oldUnrelatedEvent = eventPage('evt-old-unrelated-2', {
    actor: 'Claude',
    startedAt: '2026-07-01T00:00:00.000Z',
    endedAt: '2026-07-01T01:00:00.000Z',
  });
  const storyStart = '2026-08-25T00:05:00.000Z';
  const conversionEdit = '2026-08-30T05:00:00.000Z';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: conversionEdit,
    startedAt: storyStart,
    type: 'Task',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [oldUnrelatedEvent] });
  // The page's single most recent Sync Log observation: Story, In
  // Progress, but with the now-common skipped_ambiguous_pre_upgrade_provenance:
  // outcome rather than story_excluded/archived_story_event:.
  sandbox.logSnapshot_(
    'snap-story-ambiguous-recent', 'notion_poll', taskId, 'In Progress',
    new Date(storyStart), 'skipped_ambiguous_pre_upgrade_provenance:evt-some-legacy'
  );

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  assert.equal(
    creates[0].properties['Started At'].date.start, conversionEdit,
    'expected the conversion boundary to be trusted, not the Story spell\'s own stale Started At, even though the most recent Sync Log row was a skipped_ambiguous_pre_upgrade_provenance: outcome rather than story_excluded'
  );
});

test('backfillStoryExclusion_ bypasses reconcileTaskPage_\'s ordinary snapshot dedup, so it still reaches a Time Event added directly to an already-reconciled Story', () => {
  // Codex-reported gap (P1, round 23): a Time Event added directly in
  // Notion (not through this script) attaches to the Story via its own
  // Task relation, not by editing the Story page itself -- so the Story
  // page's own snapshot (id | last_edited_time | Status | Assigned Agent |
  // Type) is completely unchanged. An ordinary reconcileTaskPage_ call
  // (no bypass) therefore reports `duplicate:` and never even calls
  // reconcileStoryTask_ again -- the new event would stay live until some
  // unrelated edit to the Story page happened to bump its snapshot, which
  // might never come. backfillStoryExclusion_ is the one caller that must
  // not depend on that: it bypasses dedup so its own advertised archive
  // path (see the E2E step above) is actually reachable on a repeated run.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dss01';
  const task = taskPage(taskId, {
    status: 'Done',
    agent: 'Claude Opus',
    lastEdited: '2026-08-20T10:00:00.000Z',
    startedAt: '2026-08-01T00:00:00.000Z',
    type: 'Story',
  });
  let strayEventAdded = false;
  const strayEvent = eventPage('evt-added-after-reconcile', {
    actor: 'Claude',
    startedAt: '2026-08-25T00:00:00.000Z',
    endedAt: '2026-08-25T01:00:00.000Z',
  });
  const routes = {
    [TASKS_QUERY]: () => ({ results: [task], has_more: false }),
    [EVENTS_QUERY]: () => ({ results: strayEventAdded ? [strayEvent] : [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox, fetchLog } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet', TASK_ORIGIN_BACKFILL_COMPLETE: 'true' },
    fetch: notionFetchStub(routes),
  });

  // Reconcile once with nothing to do -- records this exact snapshot as
  // already processed.
  const first = sandbox.reconcileTaskPage_(task);
  assert.equal(first, 'story_excluded');

  // A stray Time Event now exists, added directly (the Story page itself
  // never changed).
  strayEventAdded = true;

  // An ordinary re-reconcile (no bypass) still reports duplicate: -- it
  // never even sees the new event.
  const ordinary = sandbox.reconcileTaskPage_(task);
  assert.match(ordinary, /^duplicate:/);
  assert.equal(requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-added-after-reconcile').length, 0);

  // backfillStoryExclusion_ bypasses dedup and actually archives it.
  const summary = sandbox.backfillStoryExclusion_();
  assert.equal(summary.outcomes[0], 'archived_story_event:evt-added-after-reconcile');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-added-after-reconcile');
  assert.equal(patches.length, 1);
  assert.equal(JSON.parse(patches[0].options.payload).archived, true);
});

test('closing an ambiguous open event is clamped to never precede the event\'s own Started At', () => {
  // Codex-reported gap (P2, round 24): `when` passed into reconcileStoryTask_
  // is the STORY PAGE's own observed edit time (authoritativeEditTime_),
  // not this event's. A Time Event added directly in Notion (attached via
  // its own Task relation) never touches the Story page itself, so it can
  // easily have a Started At AFTER the page's own last real edit. Closing
  // at the unclamped `when` in that case would set Ended At before
  // Started At -- a negative duration in both Notion and the Sheet
  // projection.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dtt01';
  const pageLastEdited = '2026-08-20T10:00:00.000Z';
  const eventAddedAfter = '2026-08-25T00:00:00.000Z'; // after pageLastEdited
  const ambiguousOpenEvent = eventPage('evt-added-after-page-edit', {
    actor: 'Claude',
    startedAt: eventAddedAfter,
    note: 'Task Origin=ambiguous-pre-upgrade',
  });
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: pageLastEdited,
    startedAt: pageLastEdited,
    type: 'Story',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [ambiguousOpenEvent] });

  sandbox.pollTaskChanges();

  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-added-after-page-edit');
  assert.equal(patches.length, 1);
  const payload = JSON.parse(patches[0].options.payload);
  assert.equal(
    payload.properties['Ended At'].date.start, eventAddedAfter,
    'expected Ended At clamped to the event\'s own Started At, not the earlier Story page edit time'
  );
});

test('storyConversionHappenedWhileInProgress_ still finds a Task\'s Sync Log row when many unrelated rows sit closer to the end', () => {
  // Originally written for round 24's bounded-tail-chunk implementation
  // (fixing the round-23 attempt, which materialized the ENTIRE Sync Log via
  // one getRange(...).getValues() call regardless of where the match sat).
  // Round 26 replaced tail-chunking with a Range#createTextFinder search
  // (see that function's own comment) -- this test still matters under the
  // new implementation too: it proves the match is found correctly however
  // far it sits from the log's end, not only when it happens to be near it.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43duu01';
  const oldUnrelatedEvent = eventPage('evt-old-unrelated-3', {
    actor: 'Claude',
    startedAt: '2026-07-01T00:00:00.000Z',
    endedAt: '2026-07-01T01:00:00.000Z',
  });
  const storyStart = '2026-08-25T00:05:00.000Z';
  const conversionEdit = '2026-08-30T05:00:00.000Z';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: conversionEdit,
    startedAt: storyStart,
    type: 'Task',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [oldUnrelatedEvent] });

  // The target task's own Story observation, logged first (near the top of
  // the Sync Log).
  sandbox.logSnapshot_(
    'snap-story-old-position', 'notion_poll', taskId, 'In Progress',
    new Date(storyStart), 'story_excluded'
  );
  // More than one tail chunk's worth of unrelated rows for OTHER Task IDs,
  // pushing the target row well beyond the first chunk.
  for (let i = 0; i < 250; i++) {
    sandbox.logSnapshot_(
      'snap-filler-' + i, 'notion_poll', 'unrelated-task-' + i, 'Ready',
      new Date('2026-08-26T00:00:00.000Z'), 'no_change:Ready'
    );
  }

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  assert.equal(
    creates[0].properties['Started At'].date.start, conversionEdit,
    'expected the conversion boundary to be trusted, proving the Story observation beyond the first tail chunk was still found'
  );
});

test('storyConversionHappenedWhileInProgress_ makes no Sync Log row-data transfer for a Task that has never appeared in it', () => {
  // Codex-reported gap (P2, round 26), fixing the round-24 tail-chunk
  // implementation itself: the single most common caller of this function
  // is an ordinary Task's very first Time Event -- by definition a Task ID
  // with NO Sync Log row of its own yet. Bounded tail chunking only ever
  // paid off once a page already had a Story-marked row on file; for the
  // never-observed case, every chunk still had to be read, oldest included,
  // before concluding "no match" -- every first-ever Task open in the whole
  // deployment paid a cost proportional to the ENTIRE append-only log,
  // unboundedly growing over the deployment's life, with the runtime
  // deadline checked only outside this reconciliation (see poll's own
  // MAX_RUN_DURATION_MS comment). Round 26's fix (Range#createTextFinder's
  // findAll(), see the function's own comment) answers "does this Task ID
  // appear anywhere" via a server-side search returning match positions
  // only, so it transfers no row data at all when there is nothing to find.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dww01';
  const startedAt = '2026-08-30T05:00:00.000Z';
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: startedAt,
    startedAt,
    type: 'Task',
  });
  const { sandbox, fetchLog, spreadsheet } = harness({ tasks: [task], events: [] });

  // A large, entirely unrelated Sync Log history -- large enough that the
  // old tail-chunk implementation would have needed several chunk reads
  // (SYNC_LOG_TAIL_CHUNK_ROWS was 200) to walk all of it before giving up.
  for (let i = 0; i < 500; i++) {
    sandbox.logSnapshot_(
      'snap-filler-' + i, 'notion_poll', 'unrelated-task-' + i, 'Ready',
      new Date('2026-08-26T00:00:00.000Z'), 'no_change:Ready'
    );
  }

  const syncLogSheet = spreadsheet.getSheetByName('Sync Log');
  syncLogSheet.getValuesCallCount = 0; // reset the setup-time appendRow calls above

  sandbox.pollTaskChanges();

  // Exactly 1, not 0: since ADP-051 merged, opening a new Time Event also
  // classifies Work Type / Review Source, which reads the Sync Log once per
  // run via syncLogRows_() (cached — see its own comment) regardless of how
  // many Tasks a run touches. That single read is unrelated to this test's
  // own subject (storyConversionHappenedWhileInProgress_'s TextFinder
  // lookup, which still transfers zero row data on its own) — the
  // assertion that matters here is that the total stays at exactly the
  // Work Type feature's own fixed cost and does not grow with the log's
  // size, proving round 26's fix adds nothing further.
  assert.equal(
    syncLogSheet.getValuesCallCount, 1,
    'expected only the Work Type classification\'s own single cached Sync Log read (ADP-051), and no additional row-data transfer from storyConversionHappenedWhileInProgress_ for a Task ID that has never appeared in the log, however large the log has grown'
  );
  const creates = requestsTo(fetchLog, 'POST', '/v1/pages').map((entry) => JSON.parse(entry.options.payload));
  assert.equal(creates.length, 1);
  assert.equal(
    creates[0].properties['Started At'].date.start, startedAt,
    'expected the Task\'s own fresh Started At to still be trusted with no Story history on file at all'
  );
});

test('closing a confirmed Task-era event at a Story conversion is clamped to never precede the event\'s own Started At', () => {
  // Codex-reported gap (P2, round 25), the same class of gap as the
  // round-24 ambiguous-close clamp: `when` comes from the Task page's own
  // minute-granular last_edited_time, so an event whose Started At carries
  // seconds can, within that same observed minute, read as later than
  // `when` -- closing at the unclamped `when` would set Ended At before
  // Started At, a negative duration.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dvv01';
  const eventStartWithSeconds = '2026-08-30T05:00:30.000Z';
  const pageLastEdited = '2026-08-30T05:00:00.000Z'; // same minute, but "earlier" once truncated
  const openTaskEraEvent = eventPage('evt-task-era-seconds', {
    actor: 'Claude',
    startedAt: eventStartWithSeconds,
    note: 'Task Origin=Task',
  });
  const task = taskPage(taskId, {
    status: 'Review',
    agent: 'Claude Opus',
    lastEdited: pageLastEdited,
    startedAt: eventStartWithSeconds,
    type: 'Story',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [openTaskEraEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.outcomes[0], 'closed_task_era_at_story_conversion:evt-task-era-seconds');
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-task-era-seconds');
  assert.equal(patches.length, 1);
  assert.equal(
    JSON.parse(patches[0].options.payload).properties['Ended At'].date.start, eventStartWithSeconds,
    'expected Ended At clamped to the event\'s own Started At, not the earlier (truncated) page edit time'
  );
});

test('restarting an ambiguous open event across a Story-to-Task conversion is clamped to never precede the event\'s own Started At', () => {
  // Codex-reported gap (P2, round 25): the same class of gap as above,
  // for the round-20 ambiguous-provenance-restart close in
  // reconcileAuthoritativeTimeEvents_.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dww01';
  const eventStartWithSeconds = '2026-08-30T05:00:30.000Z';
  const pageLastEdited = '2026-08-30T05:00:00.000Z';
  const ambiguousOpenEvent = eventPage('evt-ambiguous-restart-seconds', {
    actor: 'Claude',
    startedAt: eventStartWithSeconds,
    note: 'Task Origin=ambiguous-pre-upgrade',
  });
  const task = taskPage(taskId, {
    status: 'In Progress',
    agent: 'Claude Opus',
    lastEdited: pageLastEdited,
    startedAt: eventStartWithSeconds,
    type: 'Task',
  });
  const { sandbox, fetchLog } = harness({ tasks: [task], events: [ambiguousOpenEvent] });

  const summary = sandbox.pollTaskChanges();

  assert.match(summary.outcomes[0], /^closed_ambiguous_provenance_restart:evt-ambiguous-restart-seconds,opened:/);
  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-ambiguous-restart-seconds');
  assert.equal(patches.length, 1);
  assert.equal(
    JSON.parse(patches[0].options.payload).properties['Ended At'].date.start, eventStartWithSeconds,
    'expected Ended At clamped to the event\'s own Started At, not the earlier (truncated) page edit time'
  );
});

test('running backfillTaskOriginProvenance_ once on a fresh deployment (nothing to scan) still unlocks backfillStoryExclusion_\'s archive path for a Time Event added later', () => {
  // Codex-reported gap (P2, round 25): the README used to say a fresh
  // deployment needs no backfillTaskOriginProvenance_ run at all, since
  // every event this script itself creates always gets a confirmed
  // Task Origin= marker. True as far as it goes, but backfillStoryExclusion_
  // also supports a marker-less Time Event added directly in Notion at any
  // later point -- and that archive path is gated on
  // TASK_ORIGIN_BACKFILL_COMPLETE, which stays permanently false if the
  // backfill is skipped as "not needed". Proves the fix: a zero-result run
  // (the genuine fresh-deployment case) still sets the completion flag, so
  // a stray event added afterward is archivable.
  const taskId = '3cafbd82-6f3b-8158-9622-d795b43dxx01';
  let strayEventAdded = false;
  const strayEvent = eventPage('evt-added-on-fresh-deploy', {
    actor: 'Claude',
    startedAt: '2026-08-25T00:00:00.000Z',
    endedAt: '2026-08-25T01:00:00.000Z',
  });
  const routes = {
    [TASKS_QUERY]: () => ({
      results: [taskPage(taskId, {
        status: 'Done', agent: 'Claude Opus',
        lastEdited: '2026-08-20T10:00:00.000Z', startedAt: '2026-08-01T00:00:00.000Z', type: 'Story',
      })],
      has_more: false,
    }),
    [EVENTS_QUERY]: () => ({ results: strayEventAdded ? [strayEvent] : [], has_more: false }),
    'POST /v1/pages': () => ({ id: 'evt-created' }),
    'PATCH *': () => ({}),
    'GET *': () => ({}),
  };
  const { sandbox, scriptProps, fetchLog } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-token', SPREADSHEET_ID: 'test-sheet' },
    fetch: notionFetchStub(routes),
  });

  // "Fresh deployment" step 6: run the backfill even though there is
  // nothing to flag yet (the Story page's own event doesn't exist until
  // later).
  const backfillSummary = sandbox.backfillTaskOriginProvenance_();
  assert.equal(backfillSummary.truncated, false);
  assert.equal(backfillSummary.timedOut, false);
  assert.equal(scriptProps.get('TASK_ORIGIN_BACKFILL_COMPLETE'), 'true');

  // Later, a stray Time Event is added directly in Notion.
  strayEventAdded = true;

  const summary = sandbox.backfillStoryExclusion_();
  assert.equal(summary.outcomes[0], 'archived_story_event:evt-added-on-fresh-deploy');
  const patches2 = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-added-on-fresh-deploy');
  assert.equal(patches2.length, 1);
  assert.equal(JSON.parse(patches2[0].options.payload).archived, true);
});
