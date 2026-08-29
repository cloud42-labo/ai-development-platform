const DEFAULTS = {
  TIME_EVENTS_SHEET: 'Time Events',
  WEBHOOK_LOG_SHEET: 'Webhook Log',
  TASKS_DATA_SOURCE_ID: 'fc5e770f-c68e-4799-afe7-ec4bff0dab59',
  TIME_EVENTS_DATA_SOURCE_ID: '544b9a17-2653-47aa-b62c-bb52425b3bf2',
  START_STATUS: 'In Progress',
  REVIEW_STATUS: 'Review',
  DONE_STATUS: 'Done',
  NOTION_VERSION: '2026-03-11',
};

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
  }, false);

  ensureProjectionHeaders_();
  ensureWebhookLogSheet_();
  Logger.log('Setup complete. No webhook signing secret is stored in Apps Script.');
}

function showSetupInfo() {
  const props = PropertiesService.getScriptProperties();
  Logger.log(JSON.stringify({
    spreadsheetId: props.getProperty('SPREADSHEET_ID'),
    tasksDataSourceId: props.getProperty('TASKS_DATA_SOURCE_ID'),
    timeEventsDataSourceId: props.getProperty('TIME_EVENTS_DATA_SOURCE_ID'),
    notionTokenConfigured: Boolean(props.getProperty('NOTION_TOKEN')),
  }, null, 2));
}

function doGet() {
  return json_({ ok: true, service: 'cloud42-notion-time-events-reconciler' });
}

function doPost(e) {
  const raw = e && e.postData ? e.postData.contents : '';
  if (!raw) return json_({ ok: false, error: 'empty_body' });

  let request;
  try {
    request = JSON.parse(raw);
  } catch (err) {
    return json_({ ok: false, error: 'invalid_json' });
  }

  const pageId = normalizeUuid_(request && request.pageId);
  if (!pageId) return json_({ ok: false, error: 'missing_or_invalid_page_id' });

  // pageId is deliberately treated as untrusted input. No status, actor,
  // timestamp, author, completion evidence or event fields are accepted from
  // the caller. The endpoint re-fetches the page using the private Notion token,
  // validates the authoritative parent data source, and derives every mutation
  // from that Notion state. A direct caller can therefore only request an
  // idempotent reconciliation of a Task that already exists in Notion.
  return withLock_(function () {
    const task = retrieveNotionPage_(pageId);
    if (!isConfiguredTask_(task)) {
      return json_({ ok: true, ignored: 'not_configured_task' });
    }

    const currentStatus = propertyText_(task.properties.Status);
    const assignedAgent = propertyText_(task.properties['Assigned Agent']);
    const desiredActor = mapActor_(assignedAgent);
    const title = propertyText_(task.properties.Title) || pageId;
    const when = authoritativeEditTime_(task);
    const changedBy = editorLabel_(task.last_edited_by);
    const snapshotId = authoritativeSnapshotId_(task, currentStatus, assignedAgent);

    if (hasProcessedSnapshot_(snapshotId)) {
      return json_({ ok: true, duplicate: true });
    }

    const outcome = reconcileAuthoritativeTimeEvents_(
      task,
      currentStatus,
      desiredActor,
      changedBy,
      snapshotId,
      when
    );

    syncTaskProjection_(pageId, title, task.url || '', currentStatus, changedBy, snapshotId);
    logSnapshot_(snapshotId, 'notion_reconcile', pageId, currentStatus, when, outcome);
    return json_({ ok: true, outcome: outcome });
  });
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
      const initialTaskStart = allEvents.length === 0
        ? propertyDate_(task.properties['Started At'])
        : null;
      const startAt = initialTaskStart || when;
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

  if (!allEvents || !allEvents.length) failures.push('missing_time_event');
  if (openEvents && openEvents.length) failures.push('open_time_event');
  if (!result) failures.push('missing_result');
  if (!completedAt) failures.push('missing_completed_at');

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
  let cursor = null;
  let pageCount = 0;
  const results = [];

  do {
    const body = {
      page_size: 100,
      filter: { property: 'Task', relation: { contains: taskId } },
      sorts: [{ property: 'Started At', direction: 'descending' }],
    };
    if (cursor) body.start_cursor = cursor;

    const response = notionRequest_(
      'post',
      '/v1/data_sources/' + encodeURIComponent(timeEventsDataSourceId_()) + '/query',
      body
    );

    (response.results || []).forEach(function (item) {
      if (item && item.object === 'page') results.push(item);
    });

    cursor = response.has_more ? response.next_cursor : null;
    pageCount++;
  } while (cursor && pageCount < 5);

  return results;
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

function isConfiguredTask_(page) {
  const configured = normalizeId_(PropertiesService.getScriptProperties().getProperty('TASKS_DATA_SOURCE_ID') || DEFAULTS.TASKS_DATA_SOURCE_ID);
  const actual = normalizeId_(page && page.parent && page.parent.data_source_id);
  return Boolean(actual && actual === configured);
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
  const sheet = ensureWebhookLogSheet_();
  if (sheet.getLastRow() < 2) return false;
  return Boolean(sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(snapshotId).matchEntireCell(true).findNext());
}

function logSnapshot_(id, type, taskId, status, receivedAt, outcome) {
  const sheet = ensureWebhookLogSheet_();
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

function ensureWebhookLogSheet_() {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(DEFAULTS.WEBHOOK_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DEFAULTS.WEBHOOK_LOG_SHEET);
    sheet.hideSheet();
  }
  sheet.getRange(1, 1, 1, 6).setValues([[
    'Snapshot ID', 'Type', 'Task ID', 'Status', 'Received At', 'Outcome'
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

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
