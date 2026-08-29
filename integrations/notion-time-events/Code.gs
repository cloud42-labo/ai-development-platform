const DEFAULTS = {
  TIME_EVENTS_SHEET: 'Time Events',
  WEBHOOK_LOG_SHEET: 'Webhook Log',
  TASKS_DATA_SOURCE_ID: 'fc5e770f-c68e-4799-afe7-ec4bff0dab59',
  TIME_EVENTS_DATA_SOURCE_ID: '544b9a17-2653-47aa-b62c-bb52425b3bf2',
  START_STATUS: 'In Progress',
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

  ensureWebhookLogSheet_();
  Logger.log('Setup complete.');
}

function showSetupInfo() {
  const props = PropertiesService.getScriptProperties();
  Logger.log(JSON.stringify({
    spreadsheetId: props.getProperty('SPREADSHEET_ID'),
    tasksDataSourceId: props.getProperty('TASKS_DATA_SOURCE_ID'),
    timeEventsDataSourceId: props.getProperty('TIME_EVENTS_DATA_SOURCE_ID'),
    notionTokenConfigured: Boolean(props.getProperty('NOTION_TOKEN')),
    webhookVerificationTokenConfigured: Boolean(props.getProperty('NOTION_WEBHOOK_VERIFICATION_TOKEN')),
  }, null, 2));
}

function showVerificationToken() {
  const token = PropertiesService.getScriptProperties().getProperty('NOTION_WEBHOOK_VERIFICATION_TOKEN');
  Logger.log(token || 'No verification token received yet.');
}

function resetVerificationToken() {
  PropertiesService.getScriptProperties().deleteProperty('NOTION_WEBHOOK_VERIFICATION_TOKEN');
  Logger.log('Stored Notion webhook verification token cleared.');
}

function doGet() {
  return json_({ ok: true, service: 'cloud42-notion-time-events-projection' });
}

function doPost(e) {
  const rawEnvelope = e && e.postData ? e.postData.contents : '';
  if (!rawEnvelope) return json_({ ok: false, error: 'empty_body' });

  let envelope;
  try {
    envelope = JSON.parse(rawEnvelope);
  } catch (err) {
    return json_({ ok: false, error: 'invalid_envelope_json' });
  }

  if (!envelope || typeof envelope.rawBody !== 'string' || typeof envelope.notionSignature !== 'string') {
    return json_({ ok: false, error: 'invalid_relay_envelope' });
  }

  let payload;
  try {
    payload = JSON.parse(envelope.rawBody);
  } catch (err) {
    return json_({ ok: false, error: 'invalid_notion_json' });
  }

  const props = PropertiesService.getScriptProperties();
  const storedVerificationToken = props.getProperty('NOTION_WEBHOOK_VERIFICATION_TOKEN') || '';
  const payloadVerificationToken = typeof payload.verification_token === 'string' ? payload.verification_token : '';
  const verificationToken = storedVerificationToken || payloadVerificationToken;

  if (!verificationToken) return json_({ ok: false, error: 'verification_token_missing' });
  if (!verifyNotionSignature_(envelope.rawBody, envelope.notionSignature, verificationToken)) {
    return json_({ ok: false, error: 'invalid_notion_signature' });
  }

  if (payloadVerificationToken) {
    if (storedVerificationToken && storedVerificationToken !== payloadVerificationToken) {
      return json_({ ok: false, error: 'verification_token_rotation_requires_reset' });
    }
    props.setProperty('NOTION_WEBHOOK_VERIFICATION_TOKEN', payloadVerificationToken);
    logWebhook_('', 'verification', '', '', new Date(), 'verification_token_stored');
    return json_({ ok: true, verification: true });
  }

  if (payload.type !== 'page.properties_updated') {
    return json_({ ok: true, ignored: 'event_type' });
  }

  return withLock_(function () {
    if (hasProcessedWebhook_(payload.id)) return json_({ ok: true, duplicate: true });

    const configuredDs = normalizeId_(props.getProperty('TASKS_DATA_SOURCE_ID') || DEFAULTS.TASKS_DATA_SOURCE_ID);
    const eventDs = normalizeId_(payload.data && payload.data.parent && payload.data.parent.data_source_id);
    const pageId = payload.entity && payload.entity.id;
    const when = parseTimestamp_(payload.timestamp);

    if (!pageId || !eventDs || eventDs !== configuredDs) {
      logWebhook_(payload.id, payload.type, pageId || '', '', when, 'ignored_data_source');
      return json_({ ok: true, ignored: 'data_source' });
    }

    const task = retrieveNotionPage_(pageId);
    const currentStatus = propertyText_(task.properties.Status);
    const assignedAgent = propertyText_(task.properties['Assigned Agent']);
    const desiredActor = mapActor_(assignedAgent);
    const title = propertyText_(task.properties.Title) || pageId;
    const changedBy = authorLabel_(payload.authors);

    const outcome = reconcileAuthoritativeTimeEvents_(
      task,
      currentStatus,
      desiredActor,
      changedBy,
      payload.id || '',
      when
    );

    syncTaskProjection_(pageId, title, task.url || '', currentStatus, changedBy, payload.id || '');
    logWebhook_(payload.id, payload.type, pageId, currentStatus, when, outcome);
    return json_({ ok: true, outcome: outcome });
  });
}

function reconcileAuthoritativeTimeEvents_(task, currentStatus, desiredActor, changedBy, webhookId, when) {
  const taskId = task.id;
  const taskTitle = propertyText_(task.properties.Title) || taskId;
  const openEvents = queryNotionTimeEventsForTask_(taskId, true);
  const actions = [];

  if (currentStatus === DEFAULTS.START_STATUS) {
    const sameActor = [];
    const otherActor = [];

    openEvents.forEach(function (eventPage) {
      const actor = propertyText_(eventPage.properties.Actor);
      if (desiredActor && actor === desiredActor) sameActor.push(eventPage);
      else otherActor.push(eventPage);
    });

    otherActor.forEach(function (eventPage) {
      closeNotionTimeEvent_(eventPage, currentStatus, changedBy, webhookId, when, 'reassignment');
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
        closeNotionTimeEvent_(sameActor[i], currentStatus, changedBy, webhookId, when, 'duplicate_reconciliation');
        actions.push('closed_duplicate:' + sameActor[i].id);
      }
      actions.push('already_open:' + sameActor[0].id);
    } else {
      const created = createNotionTimeEvent_(taskId, taskTitle, desiredActor, changedBy, webhookId, when);
      actions.push('opened:' + created.id);
    }
  } else {
    openEvents.forEach(function (eventPage) {
      closeNotionTimeEvent_(eventPage, currentStatus, changedBy, webhookId, when, 'left_in_progress');
      actions.push('closed:' + eventPage.id);
    });
  }

  return actions.length ? actions.join(',') : 'no_change:' + currentStatus;
}

function createNotionTimeEvent_(taskId, taskTitle, actor, changedBy, webhookId, when) {
  const note = buildNote_({
    source: 'notion_webhook',
    webhookId: webhookId,
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

function closeNotionTimeEvent_(eventPage, endStatus, changedBy, webhookId, when, reason) {
  const existingNote = propertyText_(eventPage.properties.Note);
  const closeMeta = buildNote_({
    endStatus: endStatus,
    reason: reason,
    webhookId: webhookId,
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

function queryNotionTimeEventsForTask_(taskId, onlyOpen) {
  const filters = [
    { property: 'Task', relation: { contains: taskId } },
  ];
  if (onlyOpen) filters.push({ property: 'Ended At', date: { is_empty: true } });

  let cursor = null;
  let pageCount = 0;
  const results = [];

  do {
    const body = {
      page_size: 100,
      filter: filters.length === 1 ? filters[0] : { and: filters },
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

function syncTaskProjection_(taskId, taskTitle, taskUrl, currentStatus, fallbackChangedBy, fallbackWebhookId) {
  const events = queryNotionTimeEventsForTask_(taskId, false);
  events.slice().reverse().forEach(function (eventPage) {
    upsertSheetProjection_(eventPage, taskId, taskTitle, taskUrl, currentStatus, fallbackChangedBy, fallbackWebhookId);
  });
}

function upsertSheetProjection_(eventPage, taskId, taskTitle, taskUrl, currentStatus, fallbackChangedBy, fallbackWebhookId) {
  const sheet = sheet_(DEFAULTS.TIME_EVENTS_SHEET);
  const row = findSheetEventRowByEventId_(sheet, eventPage.id) || (sheet.getLastRow() + 1);
  const actor = propertyText_(eventPage.properties.Actor);
  const startedAt = propertyDate_(eventPage.properties['Started At']);
  const endedAt = propertyDate_(eventPage.properties['Ended At']);
  const note = propertyText_(eventPage.properties.Note);
  const meta = parseNoteMeta_(note);
  const endStatus = endedAt ? (meta.endStatus || (currentStatus !== DEFAULTS.START_STATUS ? currentStatus : '')) : '';
  const changedBy = meta.changedBy || fallbackChangedBy || '';
  const webhookId = meta.webhookId || fallbackWebhookId || '';

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
    webhookId,
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

function timeEventsDataSourceId_() {
  return PropertiesService.getScriptProperties().getProperty('TIME_EVENTS_DATA_SOURCE_ID') || DEFAULTS.TIME_EVENTS_DATA_SOURCE_ID;
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
  if (fields.webhookId) parts.push('Webhook=' + fields.webhookId);
  if (fields.changedBy) parts.push('Changed By=' + fields.changedBy);
  return parts.join(' | ');
}

function parseNoteMeta_(note) {
  return {
    endStatus: noteField_(note, 'End Status'),
    webhookId: noteField_(note, 'Webhook'),
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

function authorLabel_(authors) {
  if (!authors || !authors.length) return '';
  return authors.map(function (a) {
    return (a.type || 'unknown') + ':' + (a.id || '');
  }).join(',');
}

function verifyNotionSignature_(rawBody, signature, verificationToken) {
  const bytes = Utilities.computeHmacSha256Signature(
    rawBody,
    verificationToken,
    Utilities.Charset.UTF_8
  );
  const hex = bytes.map(function (b) {
    const n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
  return constantTimeEqual_('sha256=' + hex, signature);
}

function constantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hasProcessedWebhook_(webhookId) {
  if (!webhookId) return false;
  const sheet = ensureWebhookLogSheet_();
  if (sheet.getLastRow() < 2) return false;
  return Boolean(sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(webhookId).matchEntireCell(true).findNext());
}

function logWebhook_(id, type, taskId, status, receivedAt, outcome) {
  const sheet = ensureWebhookLogSheet_();
  sheet.appendRow([id || '', type || '', taskId || '', status || '', receivedAt || new Date(), outcome || '']);
}

function ensureWebhookLogSheet_() {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(DEFAULTS.WEBHOOK_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DEFAULTS.WEBHOOK_LOG_SHEET);
    sheet.getRange(1, 1, 1, 6).setValues([['Webhook ID', 'Type', 'Task ID', 'Status', 'Received At', 'Outcome']]);
    sheet.hideSheet();
  }
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
