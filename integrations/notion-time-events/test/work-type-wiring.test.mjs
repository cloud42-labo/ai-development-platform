// ADP-051-B3: regression tests for wiring the ADP-051-B2 Work Type resolver
// into the "open a new Time Event" call site inside
// reconcileAuthoritativeTimeEvents_ (createNotionTimeEvent_'s new `workType`
// parameter). See test/work-type-resolver.test.mjs for the resolver's own
// pure-function regression tests (docs/review-fix-state-model.md §7) — this
// file only covers the production wiring: that classification happens at
// all, that it is non-blocking, and that it does not disturb the Done gate
// or polling idempotency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, notionFetchStub } from './support/gas-sandbox.mjs';

const TASKS_DS = 'fc5e770f-c68e-4799-afe7-ec4bff0dab59';
const EVENTS_DS = '544b9a17-2653-47aa-b62c-bb52425b3bf2';
const TASKS_QUERY = 'POST /v1/data_sources/' + TASKS_DS + '/query';
const EVENTS_QUERY = 'POST /v1/data_sources/' + EVENTS_DS + '/query';

function taskPage(id, {
  status, agent, lastEdited, startedAt = null, title = 'T', type = null,
} = {}) {
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
      Result: { type: 'rich_text', rich_text: [] },
      'Completed At': { type: 'date', date: null },
      'Closed At': { type: 'date', date: null },
      Type: { type: 'select', select: type ? { name: type } : null },
    },
  };
}

function eventPage(id, { actor, startedAt, endedAt = null, note = '', workType } = {}) {
  const properties = {
    Actor: { type: 'select', select: { name: actor } },
    'Started At': { type: 'date', date: { start: startedAt } },
    'Ended At': { type: 'date', date: endedAt ? { start: endedAt } : null },
    Note: { type: 'rich_text', rich_text: note ? [{ plain_text: note }] : [] },
  };
  if (workType !== undefined) {
    properties['Work Type'] = { type: 'select', select: workType ? { name: workType } : null };
  }
  return {
    object: 'page',
    id,
    properties,
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

test('(a) a newly opened Time Event with no prior history is classified Initial Work at creation time (docs/review-fix-state-model.md §3 step 4, ADP-051-B3 wiring)', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('task-b3-a', {
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
  assert.equal(created.properties['Work Type'].select.name, 'Initial Work');
});

test('(a) a newly opened Time Event is classified Review Fix when the most recent evidence is a genuine close to Review (docs/review-fix-state-model.md §3 step 1, ADP-051-B3 wiring)', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('task-b3-review-fix', {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T09:00:00.000Z',
      startedAt: '2026-08-30T09:00:00.000Z',
    })],
    events: [eventPage('evt-prior-review', {
      actor: 'Claude',
      startedAt: '2026-08-29T03:00:00.000Z',
      endedAt: '2026-08-29T04:00:00.000Z',
      note: 'Reason=left_in_progress | End Status=Review | Write=1000',
    })],
  });

  sandbox.pollTaskChanges();

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages');
  assert.equal(creates.length, 1);
  const created = JSON.parse(creates[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Review Fix');
});

test('(b) the Time Event is still opened, unclassified, when resolveWorkType_ throws — a resolver failure never blocks or delays event creation (ADP-051-B3 non-blocking wiring)', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('task-b3-throws', {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T05:10:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
    })],
  });
  // Simulate a resolver-side failure (e.g. an unexpected Sync Log shape) —
  // resolveNewTimeEventWorkTypeSafely_ must swallow this, not let it escape
  // reconcileAuthoritativeTimeEvents_/pollTaskChanges.
  sandbox.resolveWorkType_ = function () {
    throw new Error('simulated resolver failure');
  };

  assert.doesNotThrow(() => {
    const summary = sandbox.pollTaskChanges();
    assert.equal(summary.processed, 1);
    assert.match(summary.outcomes[0], /^opened:/, 'the Task must still be reconciled and its Time Event opened normally');
  });

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages');
  assert.equal(creates.length, 1);
  const created = JSON.parse(creates[0].options.payload);
  assert.equal(created.properties['Work Type'], undefined, 'no Work Type must be written when classification failed — the event stays unclassified, never guessed');
});

test('(b) the Time Event is still opened, unclassified, when the resolver returns an explicit unresolved outcome (ADP-051-B3 non-blocking wiring, docs/review-fix-state-model.md failure #28)', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('task-b3-unresolved', {
      status: 'In Progress',
      agent: 'Claude Opus',
      lastEdited: '2026-08-30T05:10:00.000Z',
      startedAt: '2026-08-30T05:10:00.000Z',
    })],
    // A retroactively-stamped boundary with no Sync Log candidate at all —
    // resolveWorkType_ returns { unresolved: true } for this (see
    // work-type-resolver.test.mjs, failure #28).
    events: [eventPage('evt-retro', {
      actor: 'Claude',
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-01T09:00:00.000Z',
      note: 'Reason=reassignment | End Status=In Progress | Write=1000 | Boundary=left_in_progress | Write=5000',
    })],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.processed, 1);
  assert.match(summary.outcomes[0], /^opened:/);
  const creates = requestsTo(fetchLog, 'POST', '/v1/pages');
  assert.equal(creates.length, 1);
  const created = JSON.parse(creates[0].options.payload);
  assert.equal(created.properties['Work Type'], undefined, 'an unresolved classification must leave the event unclassified, never guess Initial Work or Review Fix');
});

test('(c) Done-gate rollback behavior is unaffected by Work Type wiring — an invalid Done attempt is still rejected exactly as before', () => {
  const { sandbox, fetchLog } = harness();
  const task = {
    id: 'task-b3-done-gate',
    properties: {
      Result: { type: 'rich_text', rich_text: [] }, // missing Result
      'Completed At': { type: 'date', date: null },
      'Started At': { type: 'date', date: { start: '2026-08-30T05:00:00.000Z' } },
    },
  };

  const outcome = sandbox.enforceDoneGate_(task, [], []);

  assert.match(outcome, /^done_gate_rejected:/);
  assert.match(outcome, /missing_result/);
  assert.equal(fetchLog.length, 1);
  const rollbackBody = JSON.parse(fetchLog[0].options.payload);
  assert.equal(rollbackBody.properties.Status.select.name, 'Review');
});

test('(c) polling idempotency is unaffected by Work Type wiring — a leaving-In-Progress same-actor duplicate is still collapsed to one interval', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('task-b3-dedup', {
      status: 'Review',
      agent: null,
      lastEdited: '2026-08-30T06:00:00.000Z',
    })],
    events: [
      eventPage('evt-open-1', { actor: 'Claude', startedAt: '2026-08-30T05:00:00.000Z' }),
      eventPage('evt-open-2', { actor: 'Claude', startedAt: '2026-08-30T05:30:00.000Z' }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.processed, 1);
  // Exactly one PATCH close for the duplicate, one for the kept event — no
  // new Time Event page is created by a Review transition at all.
  const creates = requestsTo(fetchLog, 'POST', '/v1/pages');
  assert.equal(creates.length, 0, 'leaving In Progress must never create a new Time Event, Work Type wiring included');
  assert.match(summary.outcomes[0], /closed_duplicate:/);
});

test('Finding 1a (ADP-051-B2/B3 fixup, P1): churn inheritance reaches across polls — an assignee cleared in one poll and reassigned only in a LATER poll still inherits Work Type from the already-closed outgoing event (docs/review-fix-state-model.md §6, failure #6)', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('task-cross-poll-churn', {
      status: 'In Progress',
      agent: 'Claude Opus', // newly (re)assigned THIS poll
      lastEdited: '2026-08-30T10:00:00.000Z',
      startedAt: '2026-08-01T00:00:00.000Z', // stale/original — must not be trusted as this reopen's own start
    })],
    events: [eventPage('evt-cross-poll-outgoing', {
      actor: 'Chris',
      startedAt: '2026-08-01T00:00:00.000Z',
      // Already closed — by an EARLIER poll, when the assignee was cleared
      // (`otherActor` was non-empty THEN; it is empty THIS poll, since
      // there is nothing left open to close).
      endedAt: '2026-08-30T09:00:00.000Z',
      note: 'Reason=reassignment | End Status=In Progress | Write=1000',
      workType: 'Review Fix',
    })],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.processed, 1);
  assert.match(summary.outcomes[0], /^opened:/);
  const creates = requestsTo(fetchLog, 'POST', '/v1/pages');
  assert.equal(creates.length, 1);
  const created = JSON.parse(creates[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Review Fix', 'must inherit from the outgoing event closed by an EARLIER poll — otherActorEvents is empty this poll, so this only works when the resolver also consults allEvents\' own most recently closed event');
});

test('Finding 1b (ADP-051-B2/B3 fixup, P1): a same-poll reassignment inherits Work Type from the outgoing event even though closeNotionTimeEvent_ never mutates the in-memory event object before classification runs (docs/review-fix-state-model.md §6)', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('task-same-poll-churn', {
      status: 'In Progress',
      agent: 'Claude Opus', // reassigned TO this actor, THIS SAME poll
      lastEdited: '2026-08-30T10:00:00.000Z',
      startedAt: '2026-08-01T00:00:00.000Z',
    })],
    events: [eventPage('evt-same-poll-outgoing', {
      actor: 'Chris', // the OUTGOING actor — still open when this poll starts
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: null, // this poll is what closes it, via reassignment
      note: '', // no Reason= yet — that only gets written BY this poll's own close
      workType: 'Review Fix', // this execution's already-established classification
    })],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.processed, 1);
  assert.match(summary.outcomes[0], /closed_reassigned:evt-same-poll-outgoing/);
  assert.match(summary.outcomes[0], /opened:/);

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages');
  assert.equal(creates.length, 1);
  const created = JSON.parse(creates[0].options.payload);
  assert.equal(created.properties['Work Type'].select.name, 'Review Fix', 'must inherit from the outgoing event this same poll is reassigning away from, even though its in-memory Note is stale until the close PATCH is separately applied');

  const patches = requestsTo(fetchLog, 'PATCH', '/v1/pages/evt-same-poll-outgoing');
  assert.equal(patches.length, 1);
  assert.match(
    JSON.parse(patches[0].options.payload).properties.Note.rich_text[0].text.content,
    /Reason=reassignment/,
    'sanity check: the outgoing event really was closed with Reason=reassignment this same poll'
  );
});

test('Finding 1 adversarial follow-up (ADP-051-B2/B3 fixup): a same-poll ambiguous_provenance_restart close must ALSO block the cross-poll churn fallback — it is its own hard cutoff (§6) and must never let an unrelated, older reassignment close from before it get inherited instead (docs/review-fix-state-model.md §6, failure #26/#27 principle)', () => {
  const { sandbox, fetchLog } = harness({
    tasks: [taskPage('task-ambiguous-restart-cutoff', {
      status: 'In Progress',
      agent: 'Claude Opus', // maps to 'Claude' — the SAME actor as the ambiguous open event below
      lastEdited: '2026-08-30T10:00:00.000Z',
    })],
    events: [
      // An older, already-finished, UNRELATED execution's own internal
      // churn — its Work Type must never be reachable from the other side
      // of the restart cutoff below.
      eventPage('evt-old-unrelated-reassignment', {
        actor: 'Chris',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T05:00:00.000Z',
        note: 'Reason=reassignment | End Status=In Progress | Write=1000',
        workType: 'Review Fix',
      }),
      // The current, still-open, ambiguous-provenance event for the SAME
      // actor as this poll's own Assigned Agent — triggers the
      // ambiguousOpenEvent restart path (self-restart, not a reassignment).
      eventPage('evt-ambiguous-open', {
        actor: 'Claude',
        startedAt: '2026-08-01T00:00:00.000Z',
        endedAt: null,
        note: 'Task Origin=ambiguous-pre-upgrade',
      }),
    ],
  });

  const summary = sandbox.pollTaskChanges();

  assert.equal(summary.processed, 1);
  assert.match(summary.outcomes[0], /closed_ambiguous_provenance_restart:evt-ambiguous-open/);
  assert.match(summary.outcomes[0], /opened:/);

  const creates = requestsTo(fetchLog, 'POST', '/v1/pages');
  assert.equal(creates.length, 1);
  const created = JSON.parse(creates[0].options.payload);
  assert.notEqual(
    created.properties['Work Type'] && created.properties['Work Type'].select.name,
    'Review Fix',
    'must never inherit the older, unrelated execution\'s Work Type past this same-poll ambiguous_provenance_restart cutoff'
  );
  assert.equal(created.properties['Work Type'].select.name, 'Initial Work', 'with no genuine boundary and no Sync Log history on the near side of the restart, this is a fresh, unclassified-history execution');
});
