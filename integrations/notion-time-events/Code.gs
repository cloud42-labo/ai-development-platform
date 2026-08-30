const DEFAULTS = {
  TIME_EVENTS_SHEET: 'Time Events',
  SYNC_LOG_SHEET: 'Sync Log',
  TASKS_DATA_SOURCE_ID: 'fc5e770f-c68e-4799-afe7-ec4bff0dab59',
  TIME_EVENTS_DATA_SOURCE_ID: '544b9a17-2653-47aa-b62c-bb52425b3bf2',
  START_STATUS: 'In Progress',
  REVIEW_STATUS: 'Review',
  DONE_STATUS: 'Done',
  NOTION_VERSION: '2026-03-11',
  POLL_INTERVAL_MINUTES: 5,
};

// Apps Script time-driven triggers only accept these minute intervals.
const ALLOWED_POLL_INTERVALS = [1, 5, 10, 15, 30];

// Every poll re-reads a little further back than the last cursor. Notion
// reports `last_edited_time` at minute granularity and a page can be indexed
// fractionally after it is written, so a strict `> cursor` window can skip an
// edit that landed in the same minute the previous run finished. Re-reading is
// free: hasProcessedSnapshot_ drops anything already reconciled.
const SYNC_OVERLAP_MS = 2 * 60 * 1000;

// How far back the very first poll looks when no cursor exists yet.
const INITIAL_LOOKBACK_MS = 60 * 60 * 1000;

// Upper bound on *genuine* reconciliations (an outcome that made a real
// Notion write) performed in one trigger run, so a large backlog of real
// work can never push a single execution past the Apps Script runtime limit.
// Anything left over is picked up by the next run from the un-advanced
// cursor. A free outcome (duplicate/ignored re-read, or an already-valid
// Done needing no change) does not count against this — see isFreeOutcome_.
const MAX_TASKS_PER_RUN = 25;

// Separate, much larger bound on how many Tasks a single run will even look
// at (scan), independent of how many of those turn out to be free re-skips.
// This exists only as a runtime safety valve for a pathological overlap
// cluster; MAX_TASKS_PER_RUN is the bound that matters in normal operation.
const MAX_TASKS_SCANNED_PER_RUN = 500;

function setup() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Run setup() from the bound Apps Script project of Cloud42 Time Events PoC.');
  }

  props.setProperties({
    SPREADSHEET_ID: spreadsheet.getId(),
    TASKS_DATA_SOURCE_ID: props.getProperty('TASKS_DATA_SOURCE_ID') || DEFAULTS.TASKS_DATA_SOURCE_ID,
    TIME_EVENTS_DATA_SOURCE_ID: props.getProperty('TIME_EVENTS_DATA_SOURCE_ID') || DEFAULTS.TIME_EVENTS_DATA_SOURCE_ID,
    POLL_INTERVAL_MINUTES: props.getProperty('POLL_INTERVAL_MINUTES') || String(DEFAULTS.POLL_INTERVAL_MINUTES),
  }, false);

  ensureProjectionHeaders_();
  ensureSyncLogSheet_();
  installSyncTrigger();
  Logger.log('Setup complete. This project has no public endpoint and stores only NOTION_TOKEN.');
}

function showSetupInfo() {
  const props = PropertiesService.getScriptProperties();
  Logger.log(JSON.stringify({
    spreadsheetId: props.getProperty('SPREADSHEET_ID'),
    tasksDataSourceId: tasksDataSourceId_(),
    timeEventsDataSourceId: timeEventsDataSourceId_(),
    // Presence only. The token value is never logged.
    notionTokenConfigured: Boolean(props.getProperty('NOTION_TOKEN')),
    pollIntervalMinutes: pollIntervalMinutes_(),
    syncTriggersInstalled: syncTriggers_().length,
    lastSyncCursor: props.getProperty('LAST_SYNC_CURSOR') || '(never run)',
  }, null, 2));
}

// Installs (or reinstalls) the time-driven trigger that drives reconciliation.
// This project deliberately exposes no doGet/doPost Web App endpoint: the only
// caller of the reconciler is this trigger, running as the project owner, so
// there is no inbound request to authenticate and no receiver credential to
// store, rotate, or leak.
function installSyncTrigger() {
  removeSyncTriggers();
  const minutes = pollIntervalMinutes_();
  ScriptApp.newTrigger('pollTaskChanges').timeBased().everyMinutes(minutes).create();
  Logger.log('Installed pollTaskChanges trigger: every ' + minutes + ' minute(s).');
}

function removeSyncTriggers() {
  syncTriggers_().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
}

function syncTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'pollTaskChanges';
  });
}

function pollIntervalMinutes_() {
  const raw = Number(PropertiesService.getScriptProperties().getProperty('POLL_INTERVAL_MINUTES'));
  return ALLOWED_POLL_INTERVALS.indexOf(raw) >= 0 ? raw : DEFAULTS.POLL_INTERVAL_MINUTES;
}

// Trigger entry point. Asks Notion which Tasks changed since the last cursor
// and reconciles each one against authoritative Notion state. Nothing outside
// this project can invoke it, and no request payload is involved at all: the
// Task list and every field driving a mutation come from Notion over an
// authenticated API call using the private NOTION_TOKEN.
function pollTaskChanges() {
  return withPollLock_(function () {
    const props = PropertiesService.getScriptProperties();
    const runStartedAt = new Date();
    const cursor = props.getProperty('LAST_SYNC_CURSOR');
    const isBootstrap = !cursor;
    const sinceMs = (cursor ? parseTimestamp_(cursor).getTime() : runStartedAt.getTime() - INITIAL_LOOKBACK_MS)
      - SYNC_OVERLAP_MS;

    const changedResult = queryChangedTasks_(new Date(sinceMs));

    // On a fresh deploy (no cursor yet), a Task that has been sitting In
    // Progress since before the initial lookback window would never surface
    // through the time-window query above, so it would never receive an open
    // Time Event — and would then permanently fail the Done gate for lack of
    // any applicable interval once it eventually moves. Bootstrap once, only
    // when there is no cursor, by also pulling every currently In Progress
    // Task directly by Status, independent of last_edited_time.
    const activeResult = isBootstrap ? queryActiveInProgressTasks_() : null;
    const tasksToProcess = isBootstrap
      ? mergeTasksById_(changedResult.results, activeResult.results)
      : changedResult.results;
    // Either query hitting its own pagination safety limit (an incremental
    // window, or the active-Task set, wider than QUERY_PAGE_SAFETY_LIMIT
    // pages) means tasksToProcess is not actually the complete set for this
    // run, even once every element in it has been scanned. The cursor must
    // not advance past data that was never retrieved.
    const sourceTruncated = changedResult.truncated || Boolean(activeResult && activeResult.truncated);

    const outcomes = [];
    let reconciledCount = 0;
    let iterated = 0;
    let lastScannedEdit = '';

    while (
      iterated < tasksToProcess.length &&
      iterated < MAX_TASKS_SCANNED_PER_RUN &&
      reconciledCount < MAX_TASKS_PER_RUN
    ) {
      const task = tasksToProcess[iterated];
      const outcome = reconcileTaskPage_(task);
      outcomes.push(outcome);
      lastScannedEdit = String(task.last_edited_time || '');
      iterated++;
      // A free outcome (duplicate/ignored re-read, or an already-valid Done
      // needing no change) made no Notion write, so it must not consume the
      // reconciliation budget. Otherwise a dense cluster of such outcomes
      // larger than MAX_TASKS_PER_RUN — duplicates from the overlap window,
      // or 25+ Tasks that are legitimately already Done — would have its
      // leading Tasks re-selected and re-skipped every run, exhausting the
      // cap on repeats of itself and never reaching the unprocessed tail
      // behind it.
      if (!isFreeOutcome_(outcome)) reconciledCount++;
    }

    // If the run did not reach the end of tasksToProcess, OR tasksToProcess
    // itself was not the complete set (sourceTruncated), the cursor must
    // stay at the last Task actually scanned rather than jumping to now —
    // otherwise the untouched (or unretrieved) tail of this window would be
    // skipped permanently. A run that reached a genuinely complete end
    // advances to the moment the query was issued, so edits made while it
    // ran are still inside the next run's overlap.
    const capped = iterated < tasksToProcess.length || sourceTruncated;
    props.setProperty(
      'LAST_SYNC_CURSOR',
      capped && lastScannedEdit ? lastScannedEdit : runStartedAt.toISOString()
    );

    return {
      scanned: tasksToProcess.length,
      processed: reconciledCount,
      capped: capped,
      truncated: sourceTruncated,
      bootstrap: isBootstrap,
      outcomes: outcomes,
    };
  });
}

// Operator escape hatch for E2E and debugging: reconcile one Task on demand.
// Runs only from the Apps Script editor, as the project owner.
function reconcileTaskById(pageId) {
  const normalized = normalizeUuid_(pageId);
  if (!normalized) throw new Error('reconcileTaskById requires a Notion page ID.');
  return withPollLock_(function () {
    return reconcileTaskPage_(retrieveNotionPage_(normalized));
  });
}

// Reconciles a single authoritative Notion Task page. Status, assignment,
// timing and completion evidence are read from the page Notion returned; the
// reconciler only ever moves Task Time Events toward the state Notion already
// holds, so a repeated pass over the same page is a no-op.
function reconcileTaskPage_(task) {
  if (!isConfiguredTask_(task)) return 'ignored:not_configured_task';

  const pageId = task.id;
  const currentStatus = propertyText_(task.properties.Status);
  const assignedAgent = propertyText_(task.properties['Assigned Agent']);
  const desiredActor = mapActor_(assignedAgent);
  const title = propertyText_(task.properties.Title) || pageId;
  const when = authoritativeEditTime_(task);
  const changedBy = editorLabel_(task.last_edited_by);
  const snapshotId = authoritativeSnapshotId_(task, currentStatus, assignedAgent);

  // Done is a completion gate that must be re-verified on every poll that
  // observes it — never short-circuited by the snapshot hash. Notion reports
  // last_edited_time at only minute granularity, so a Done that gets rolled
  // back and retried within the same minute (still missing its required
  // evidence) can hash identically to the first, already-processed attempt.
  // Skipping re-verification on that collision would let an invalid Done
  // persist indefinitely, since no further edit would ever change the hash.
  // Every other status is fine to dedup: skipping a re-read there just means
  // no new mutation was needed, not that an invalid state goes unchecked.
  const mustReverify = currentStatus === DEFAULTS.DONE_STATUS;
  if (!mustReverify && hasProcessedSnapshot_(snapshotId)) return 'duplicate:' + pageId;

  const outcome = reconcileAuthoritativeTimeEvents_(
    task,
    currentStatus,
    desiredActor,
    changedBy,
    snapshotId,
    when
  );

  syncTaskProjection_(pageId, title, task.url || '', currentStatus, changedBy, snapshotId);
  logSnapshot_(snapshotId, 'notion_poll', pageId, currentStatus, when, outcome);
  return outcome;
}

// Tasks whose last_edited_time is at or after `since`, oldest first, so a
// capped run leaves a contiguous unprocessed tail behind the cursor. Returns
// { results, truncated } — see paginateNotionQuery_.
function queryChangedTasks_(since) {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    {
      page_size: 100,
      filter: {
        timestamp: 'last_edited_time',
        last_edited_time: { on_or_after: since.toISOString() },
      },
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
    }
  );
}

// Bootstrap-only query: every Task currently Status = In Progress, regardless
// of last_edited_time. Used exactly once per fresh deploy (or cursor reset),
// so a Task that has been active since before the initial lookback window
// still gets an open Time Event instead of never receiving one. Returns
// { results, truncated } — see paginateNotionQuery_.
function queryActiveInProgressTasks_() {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    {
      page_size: 100,
      filter: { property: 'Status', status: { equals: DEFAULTS.START_STATUS } },
    }
  );
}

// Dedups two Task-page lists by page ID (first occurrence wins) and returns
// them sorted ascending by last_edited_time, so the poll loop's cursor-
// advancement math stays correct regardless of which source list a given
// Task came from.
function mergeTasksById_(primary, secondary) {
  const seen = {};
  const merged = [];
  [primary, secondary].forEach(function (list) {
    (list || []).forEach(function (task) {
      const id = task && task.id;
      if (!id || seen[id]) return;
      seen[id] = true;
      merged.push(task);
    });
  });
  merged.sort(function (a, b) {
    return String(a.last_edited_time || '').localeCompare(String(b.last_edited_time || ''));
  });
  return merged;
}

// Outcomes that made no Notion write, and are therefore free to re-skip
// without charging the per-run reconciliation budget (MAX_TASKS_PER_RUN).
function isFreeOutcome_(outcome) {
  // 'done_gate_passed' makes no Notion write (a Done Task that already meets
  // every requirement is left exactly as it is), so it is free to re-verify
  // on every poll just like a duplicate or ignored outcome. Without this,
  // always re-verifying Done (see reconcileTaskPage_) would let a run of 25+
  // already-valid Done Tasks inside the overlap window exhaust the
  // reconciliation budget on themselves every single run, permanently
  // starving whatever changed Task sorts behind them — the same stall this
  // budget exists to prevent, just triggered by successes instead of
  // duplicates. A rejected Done ('done_gate_rejected:...') still counts: it
  // made a real write (the rollback) and is exactly the case the always-
  // reverify rule exists to keep catching.
  return outcome === 'ignored:not_configured_task' ||
    outcome === 'done_gate_passed' ||
    /^duplicate:/.test(String(outcome));
}

function reconcileAuthoritativeTimeEvents_(task, currentStatus, desiredActor, changedBy, snapshotId, when) {
  const taskId = task.id;
  const taskTitle = propertyText_(task.properties.Title) || taskId;
  const allEvents = queryNotionTimeEventsForTask_(taskId);
  const openEvents = allEvents.filter(function (eventPage) {
    return !propertyDate_(eventPage.properties['Ended At']);
  });
  const actions = [];

  // Done is a completion gate, not a stop trigger. The Time Event and required
  // completion evidence must already exist before Done is allowed to persist.
  if (currentStatus === DEFAULTS.DONE_STATUS) {
    return enforceDoneGate_(task, allEvents, openEvents);
  }

  if (currentStatus === DEFAULTS.START_STATUS) {
    const sameActor = [];
    const otherActor = [];

    openEvents.forEach(function (eventPage) {
      const actor = propertyText_(eventPage.properties.Actor);
      if (desiredActor && actor === desiredActor) sameActor.push(eventPage);
      else otherActor.push(eventPage);
    });

    otherActor.forEach(function (eventPage) {
      closeNotionTimeEvent_(eventPage, currentStatus, changedBy, snapshotId, when, 'reassignment');
      actions.push('closed_reassigned:' + eventPage.id);
    });

    if (!desiredActor) {
      return actions.length ? actions.join(',') : 'in_progress_without_mapped_actor';
    }

    sameActor.sort(function (a, b) {
      return eventStartedAt_(b).getTime() - eventStartedAt_(a).getTime();
    });

    if (sameActor.length) {
      for (let i = 1; i < sameActor.length; i++) {
        closeNotionTimeEvent_(sameActor[i], currentStatus, changedBy, snapshotId, when, 'duplicate_reconciliation');
        actions.push('closed_duplicate:' + sameActor[i].id);
      }
      actions.push('already_open:' + sameActor[0].id);
    } else {
      // Prefer the Task's own current Started At over `when` (the observed
      // edit time) whenever it looks like the true start of *this*
      // execution rather than a stale leftover from history — i.e. it is at
      // or after every timestamp already on file for this Task. This covers
      // both the first-ever event (no history yet, so any Started At
      // qualifies) and a reopened Task, where governance requires Started At
      // to be freshly recorded for the new execution. Without this, a
      // reopened Task whose next poll observes a *later* edit (e.g. an
      // assignment change made moments after the restart, still within the
      // same interval) would open its new event at that later edit instead
      // of the execution's real start, silently dropping the time between.
      const latestHistoricalTimestamp = latestEventTimestamp_(allEvents);
      const taskStartedAt = propertyDate_(task.properties['Started At']);
      const trustedTaskStart = taskStartedAt && (!latestHistoricalTimestamp || taskStartedAt.getTime() >= latestHistoricalTimestamp.getTime())
        ? taskStartedAt
        : null;
      const startAt = trustedTaskStart || when;
      const created = createNotionTimeEvent_(taskId, taskTitle, desiredActor, changedBy, snapshotId, startAt);
      actions.push('opened:' + created.id);
    }
  } else {
    // Review / Blocked / Ready / Backlog are non-active Task states and may close
    // intervals. Done is intentionally handled above and never closes timing.
    openEvents.forEach(function (eventPage) {
      closeNotionTimeEvent_(eventPage, currentStatus, changedBy, snapshotId, when, 'left_in_progress');
      actions.push('closed:' + eventPage.id);
    });
  }

  return actions.length ? actions.join(',') : 'no_change:' + currentStatus;
}

function enforceDoneGate_(task, allEvents, openEvents) {
  const failures = [];
  const result = propertyText_(task.properties.Result).trim();
  const completedAt = propertyDate_(task.properties['Completed At']);

  // A closed Time Event must apply to the *current* execution, not merely
  // exist somewhere in the Task's history. Reopen -> restart cases can leave
  // an old closed event on the Task while the restart's own In Progress spell
  // never surfaces to the reconciler — a Task edited into and back out of
  // In Progress inside one poll window is only ever observed in its final
  // state (see README "Known limitations"). Counting any historical closed
  // event would then let a stale interval from a previous completed execution
  // satisfy Done for work that was never timed. `Started At` on the Task
  // itself is the current-execution marker:
  // governance requires it to be (re)recorded whenever a fresh execution
  // begins. A closed event only counts if it started at or after that
  // marker.
  const taskStartedAt = propertyDate_(task.properties['Started At']);
  let applicableClosedEvent = null;
  if (!taskStartedAt) {
    failures.push('missing_task_started_at');
  } else {
    (allEvents || []).forEach(function (eventPage) {
      const endedAt = propertyDate_(eventPage.properties['Ended At']);
      if (!endedAt) return;
      if (eventStartedAt_(eventPage).getTime() < taskStartedAt.getTime()) return;
      // Prefer the most-recently-closed applicable event, so a stale
      // Completed At is checked against the freshest legitimate close below.
      if (!applicableClosedEvent || endedAt.getTime() > propertyDate_(applicableClosedEvent.properties['Ended At']).getTime()) {
        applicableClosedEvent = eventPage;
      }
    });
    if (!applicableClosedEvent) failures.push('missing_applicable_time_event');
  }

  if (openEvents && openEvents.length) failures.push('open_time_event');
  if (!result) failures.push('missing_result');

  // Completed At must not just be *present* — a reopened Task can retain an
  // old Completed At from its prior, already-finished execution, and Notion
  // does not clear it on reopen. Presence alone would let that stale value
  // wave through a new execution's Done without the current interval's own
  // post-flight ever having actually happened. Require it to be no earlier
  // than the current Started At, and no earlier than the applicable closed
  // event's own Ended At when one was found above.
  if (!completedAt) {
    failures.push('missing_completed_at');
  } else if (taskStartedAt && completedAt.getTime() < taskStartedAt.getTime()) {
    failures.push('stale_completed_at');
  } else if (applicableClosedEvent) {
    const appliedEndedAt = propertyDate_(applicableClosedEvent.properties['Ended At']);
    if (completedAt.getTime() < appliedEndedAt.getTime()) failures.push('stale_completed_at');
  }

  if (!failures.length) return 'done_gate_passed';

  // If work is still timed, restore In Progress and deliberately leave the
  // interval open so the normal In Progress → Review transition closes it.
  // Otherwise return to Review to collect missing completion evidence.
  const rollbackStatus = openEvents && openEvents.length
    ? DEFAULTS.START_STATUS
    : DEFAULTS.REVIEW_STATUS;
  updateTaskStatus_(task.id, rollbackStatus);
  return 'done_gate_rejected:' + failures.join('+') + ':rollback=' + rollbackStatus;
}

function updateTaskStatus_(taskId, statusName) {
  notionRequest_('patch', '/v1/pages/' + encodeURIComponent(taskId), {
    properties: {
      Status: { status: { name: statusName } },
    },
  });
}

function createNotionTimeEvent_(taskId, taskTitle, actor, changedBy, snapshotId, when) {
  const note = buildNote_({
    source: 'notion_reconcile',
    snapshotId: snapshotId,
    changedBy: changedBy,
  });

  return notionRequest_('post', '/v1/pages', {
    parent: {
      type: 'data_source_id',
      data_source_id: timeEventsDataSourceId_(),
    },
    properties: {
      Event: {
        title: [{ type: 'text', text: { content: clip_(actor + '｜' + taskTitle, 300) } }],
      },
      Actor: { select: { name: actor } },
      State: { select: { name: 'Active' } },
      'Started At': { date: { start: when.toISOString() } },
      Task: { relation: [{ id: taskId }] },
      Note: {
        rich_text: [{ type: 'text', text: { content: clip_(note, 1800) } }],
      },
    },
  });
}

function closeNotionTimeEvent_(eventPage, endStatus, changedBy, snapshotId, when, reason) {
  const existingNote = propertyText_(eventPage.properties.Note);
  const closeMeta = buildNote_({
    endStatus: endStatus,
    reason: reason,
    snapshotId: snapshotId,
    changedBy: changedBy,
  });
  const note = existingNote ? existingNote + ' | ' + closeMeta : closeMeta;

  notionRequest_('patch', '/v1/pages/' + encodeURIComponent(eventPage.id), {
    properties: {
      'Ended At': { date: { start: when.toISOString() } },
      Note: {
        rich_text: [{ type: 'text', text: { content: clip_(note, 1800) } }],
      },
    },
  });
}

function queryNotionTimeEventsForTask_(taskId) {
  const result = paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(timeEventsDataSourceId_()) + '/query',
    {
      page_size: 100,
      filter: { property: 'Task', relation: { contains: taskId } },
      sorts: [{ property: 'Started At', direction: 'descending' }],
    }
  );
  // A single Task accumulating more Time Events than the safety limit is not
  // expected in normal operation. Fail loudly rather than silently
  // reconciling (including a Done gate decision) against a truncated,
  // possibly-incomplete event history.
  if (result.truncated) {
    throw new Error(
      'queryNotionTimeEventsForTask_ hit the pagination safety limit for Task ' +
      taskId + ' — more Time Events exist than were retrieved. Investigate before continuing.'
    );
  }
  return result.results;
}

function syncTaskProjection_(taskId, taskTitle, taskUrl, currentStatus, fallbackChangedBy, fallbackSnapshotId) {
  const events = queryNotionTimeEventsForTask_(taskId);
  events.slice().reverse().forEach(function (eventPage) {
    upsertSheetProjection_(eventPage, taskId, taskTitle, taskUrl, currentStatus, fallbackChangedBy, fallbackSnapshotId);
  });
}

function upsertSheetProjection_(eventPage, taskId, taskTitle, taskUrl, currentStatus, fallbackChangedBy, fallbackSnapshotId) {
  const sheet = sheet_(DEFAULTS.TIME_EVENTS_SHEET);
  const row = findSheetEventRowByEventId_(sheet, eventPage.id) || (sheet.getLastRow() + 1);
  const actor = propertyText_(eventPage.properties.Actor);
  const startedAt = propertyDate_(eventPage.properties['Started At']);
  const endedAt = propertyDate_(eventPage.properties['Ended At']);
  const note = propertyText_(eventPage.properties.Note);
  const meta = parseNoteMeta_(note);
  const endStatus = endedAt ? (meta.endStatus || (currentStatus !== DEFAULTS.START_STATUS ? currentStatus : '')) : '';
  const changedBy = meta.changedBy || fallbackChangedBy || '';
  const sourceSnapshotId = meta.snapshotId || fallbackSnapshotId || '';

  sheet.getRange(row, 1, 1, 13).setValues([[
    eventPage.id,
    taskId,
    taskTitle,
    actor,
    startedAt || '',
    endedAt || '',
    '',
    DEFAULTS.START_STATUS,
    endStatus,
    changedBy,
    taskUrl || ('https://www.notion.so/' + taskId.replace(/-/g, '')),
    sourceSnapshotId,
    new Date(),
  ]]);
  sheet.getRange(row, 7).setFormula('=IF(OR(E' + row + '="",F' + row + '=""),"",24*(F' + row + '-E' + row + '))');
}

function findSheetEventRowByEventId_(sheet, eventId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const finder = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(String(eventId))
    .matchEntireCell(true)
    .findNext();
  return finder ? finder.getRow() : 0;
}

function retrieveNotionPage_(pageId) {
  return notionRequest_('get', '/v1/pages/' + encodeURIComponent(pageId));
}

function notionRequest_(method, path, body) {
  const token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('NOTION_TOKEN is not configured in Apps Script Script Properties.');

  const options = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': DEFAULTS.NOTION_VERSION,
    },
    muteHttpExceptions: true,
  };

  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch('https://api.notion.com' + path, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Notion API failed: ' + method.toUpperCase() + ' ' + path + ' HTTP ' + code + ' ' + text);
  }
  return text ? JSON.parse(text) : {};
}

// Generous safety valve on paginated Notion data-source queries. High enough
// that hitting it means something structurally unusual is going on (a huge
// workspace, or a runaway result set) rather than normal operation — the
// prior 5-page (500-row) cap was low enough to silently truncate a single
// ordinary incremental poll window during a bulk edit. If this limit is hit,
// `truncated: true` is returned so a caller (pollTaskChanges) never mistakes
// a partial result for the complete set and advances its cursor past
// unretrieved data.
const QUERY_PAGE_SAFETY_LIMIT = 50;

function paginateNotionQuery_(path, baseBody) {
  let cursor = null;
  let pageCount = 0;
  const results = [];
  let truncated = false;

  do {
    const body = Object.assign({}, baseBody);
    if (cursor) body.start_cursor = cursor;

    const response = notionRequest_('post', path, body);

    (response.results || []).forEach(function (item) {
      if (item && item.object === 'page') results.push(item);
    });

    cursor = response.has_more ? response.next_cursor : null;
    pageCount++;
    if (cursor && pageCount >= QUERY_PAGE_SAFETY_LIMIT) {
      truncated = true;
      cursor = null;
    }
  } while (cursor);

  return { results: results, truncated: truncated };
}

function isConfiguredTask_(page) {
  const configured = normalizeId_(tasksDataSourceId_());
  const actual = normalizeId_(page && page.parent && page.parent.data_source_id);
  return Boolean(actual && actual === configured);
}

function tasksDataSourceId_() {
  return PropertiesService.getScriptProperties().getProperty('TASKS_DATA_SOURCE_ID') || DEFAULTS.TASKS_DATA_SOURCE_ID;
}

function timeEventsDataSourceId_() {
  return PropertiesService.getScriptProperties().getProperty('TIME_EVENTS_DATA_SOURCE_ID') || DEFAULTS.TIME_EVENTS_DATA_SOURCE_ID;
}

function authoritativeEditTime_(task) {
  return parseTimestamp_(task && task.last_edited_time);
}

function authoritativeSnapshotId_(task, status, assignedAgent) {
  const seed = [
    normalizeId_(task && task.id),
    String(task && task.last_edited_time || ''),
    String(status || ''),
    String(assignedAgent || ''),
  ].join('|');
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    seed,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function eventStartedAt_(eventPage) {
  return propertyDate_(eventPage && eventPage.properties && eventPage.properties['Started At']) || new Date(0);
}

// Latest Started At / Ended At timestamp across a list of Time Event pages,
// or null if the list is empty or carries no dates at all.
function latestEventTimestamp_(events) {
  let latest = null;
  (events || []).forEach(function (eventPage) {
    [
      propertyDate_(eventPage && eventPage.properties && eventPage.properties['Started At']),
      propertyDate_(eventPage && eventPage.properties && eventPage.properties['Ended At']),
    ].forEach(function (ts) {
      if (ts && (!latest || ts.getTime() > latest.getTime())) latest = ts;
    });
  });
  return latest;
}

function propertyDate_(property) {
  if (!property || property.type !== 'date' || !property.date || !property.date.start) return null;
  return parseTimestamp_(property.date.start);
}

function propertyText_(property) {
  if (!property) return '';
  if (property.type === 'select') return property.select ? property.select.name : '';
  if (property.type === 'status') return property.status ? property.status.name : '';
  if (property.type === 'title') return (property.title || []).map(function (x) { return x.plain_text || ''; }).join('');
  if (property.type === 'rich_text') return (property.rich_text || []).map(function (x) { return x.plain_text || ''; }).join('');
  return '';
}

function mapActor_(assignedAgent) {
  if (assignedAgent === 'ChatGPT') return 'Chris';
  if (assignedAgent === 'Codex') return 'Codex';
  if (assignedAgent === 'Human') return 'Human';
  if (/^Claude\s/.test(assignedAgent || '')) return 'Claude';
  return '';
}

function buildNote_(fields) {
  const parts = [];
  if (fields.source) parts.push('Source=' + fields.source);
  if (fields.endStatus) parts.push('End Status=' + fields.endStatus);
  if (fields.reason) parts.push('Reason=' + fields.reason);
  if (fields.snapshotId) parts.push('Snapshot=' + fields.snapshotId);
  if (fields.changedBy) parts.push('Changed By=' + fields.changedBy);
  return parts.join(' | ');
}

function parseNoteMeta_(note) {
  return {
    endStatus: noteField_(note, 'End Status'),
    snapshotId: noteField_(note, 'Snapshot'),
    changedBy: noteField_(note, 'Changed By'),
  };
}

function noteField_(note, key) {
  const parts = String(note || '').split('|');
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].trim();
    if (part.indexOf(key + '=') === 0) return part.substring(key.length + 1).trim();
  }
  return '';
}

function editorLabel_(user) {
  if (!user || !user.id) return '';
  return (user.object || user.type || 'user') + ':' + user.id;
}

function hasProcessedSnapshot_(snapshotId) {
  if (!snapshotId) return false;
  const sheet = ensureSyncLogSheet_();
  if (sheet.getLastRow() < 2) return false;
  return Boolean(sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(snapshotId).matchEntireCell(true).findNext());
}

function logSnapshot_(id, type, taskId, status, receivedAt, outcome) {
  const sheet = ensureSyncLogSheet_();
  sheet.appendRow([id || '', type || '', taskId || '', status || '', receivedAt || new Date(), outcome || '']);
}

function ensureProjectionHeaders_() {
  const sheet = sheet_(DEFAULTS.TIME_EVENTS_SHEET);
  const headers = [
    'Event ID', 'Task ID', 'Task Title', 'Actor', 'Started At', 'Ended At',
    'Duration (h)', 'Start Status', 'End Status', 'Changed By', 'Notion URL',
    'Source Snapshot ID', 'Recorded At'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function ensureSyncLogSheet_() {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(DEFAULTS.SYNC_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DEFAULTS.SYNC_LOG_SHEET);
    sheet.hideSheet();
  }
  sheet.getRange(1, 1, 1, 6).setValues([[
    'Snapshot ID', 'Source', 'Task ID', 'Status', 'Reconciled At', 'Outcome'
  ]]);
  return sheet;
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setup() first.');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name);
  return sheet;
}

function normalizeUuid_(value) {
  const raw = String(value || '').trim();
  if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(raw)) return '';
  const hex = raw.replace(/-/g, '').toLowerCase();
  return [
    hex.substring(0, 8), hex.substring(8, 12), hex.substring(12, 16),
    hex.substring(16, 20), hex.substring(20, 32)
  ].join('-');
}

function parseTimestamp_(value) {
  const d = value ? new Date(value) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

function normalizeId_(value) {
  return String(value || '').replace(/-/g, '').toLowerCase();
}

function clip_(value, maxLength) {
  value = String(value || '');
  return value.length <= maxLength ? value : value.substring(0, maxLength);
}

// A poll that is still running keeps the lock; the next trigger tick simply
// steps aside rather than queueing up behind it. Skipping is safe because the
// cursor is only advanced by a run that completes, so the skipped window is
// re-read by the following tick.
function withPollLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { skipped: 'poll_already_running' };
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
