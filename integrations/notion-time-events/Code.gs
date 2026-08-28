const DEFAULTS = {
  TIME_EVENTS_SHEET: 'Time Events',
  WEBHOOK_LOG_SHEET: 'Webhook Log',
  NOTION_DATA_SOURCE_ID: 'fc5e770f-c68e-4799-afe7-ec4bff0dab59',
  STATUS_PROPERTY_ID: 'RWN3TQ',
  START_STATUS: 'In Progress',
  STOP_STATUSES: ['Review', 'Done', 'Blocked'],
  NOTION_VERSION: '2026-03-11',
};

function setup() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Run setup() from the bound Apps Script project of Cloud42 Time Events PoC.');

  const values = {
    SPREADSHEET_ID: spreadsheet.getId(),
    NOTION_DATA_SOURCE_ID: props.getProperty('NOTION_DATA_SOURCE_ID') || DEFAULTS.NOTION_DATA_SOURCE_ID,
    STATUS_PROPERTY_ID: props.getProperty('STATUS_PROPERTY_ID') || DEFAULTS.STATUS_PROPERTY_ID,
    WEBHOOK_KEY: props.getProperty('WEBHOOK_KEY') || Utilities.getUuid() + Utilities.getUuid(),
  };
  props.setProperties(values, false);
  ensureWebhookLogSheet_();
  Logger.log('Setup complete. Run showSetupInfo() next.');
}

function showSetupInfo() {
  const props = PropertiesService.getScriptProperties();
  Logger.log(JSON.stringify({
    spreadsheetId: props.getProperty('SPREADSHEET_ID'),
    webhookKey: props.getProperty('WEBHOOK_KEY'),
    notionDataSourceId: props.getProperty('NOTION_DATA_SOURCE_ID'),
    statusPropertyId: props.getProperty('STATUS_PROPERTY_ID'),
    notionTokenConfigured: Boolean(props.getProperty('NOTION_TOKEN')),
  }, null, 2));
}

function showVerificationToken() {
  const token = PropertiesService.getScriptProperties().getProperty('NOTION_WEBHOOK_VERIFICATION_TOKEN');
  Logger.log(token || 'No verification token received yet.');
}

function doGet(e) {
  if (!isAuthorized_(e)) return json_({ ok: false, error: 'unauthorized' });
  const action = (e && e.parameter && e.parameter.action) || 'health';
  if (action === 'verification-token') {
    return json_({
      ok: true,
      verification_token: PropertiesService.getScriptProperties().getProperty('NOTION_WEBHOOK_VERIFICATION_TOKEN') || null,
    });
  }
  return json_({ ok: true, service: 'cloud42-notion-time-events', now: new Date().toISOString() });
}

function doPost(e) {
  if (!isAuthorized_(e)) return json_({ ok: false, error: 'unauthorized' });
  const raw = e && e.postData ? e.postData.contents : '';
  if (!raw) return json_({ ok: false, error: 'empty_body' });

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    return json_({ ok: false, error: 'invalid_json' });
  }

  if (payload.verification_token) {
    PropertiesService.getScriptProperties().setProperty(
      'NOTION_WEBHOOK_VERIFICATION_TOKEN',
      payload.verification_token
    );
    logWebhook_('', 'verification', '', '', new Date(), 'verification_token_stored');
    return json_({ ok: true });
  }

  if (payload.type !== 'page.properties_updated') {
    return json_({ ok: true, ignored: 'event_type' });
  }

  return withLock_(function () {
    if (hasProcessedWebhook_(payload.id)) return json_({ ok: true, duplicate: true });

    const configuredDs = normalizeId_(PropertiesService.getScriptProperties().getProperty('NOTION_DATA_SOURCE_ID'));
    const eventDs = normalizeId_(payload.data && payload.data.parent && payload.data.parent.data_source_id);
    if (!eventDs || eventDs !== configuredDs) {
      logWebhook_(payload.id, payload.type, payload.entity && payload.entity.id, '', parseTimestamp_(payload.timestamp), 'ignored_data_source');
      return json_({ ok: true, ignored: 'data_source' });
    }

    // Do not trust payload.data.updated_properties to identify Status changes.
    // Notion can return encoded/aggregated property identifiers that differ from
    // the configured schema ID. Instead, retrieve the current Task and make the
    // operation idempotent from its current Status + existing open Time Event.
    const pageId = payload.entity.id;
    const page = retrieveNotionPage_(pageId);
    const currentStatus = propertyText_(page.properties.Status);
    const assignedAgent = propertyText_(page.properties['Assigned Agent']);
    const actor = mapActor_(assignedAgent);
    const title = propertyText_(page.properties.Title) || pageId;
    const when = parseTimestamp_(payload.timestamp);
    const changedBy = authorLabel_(payload.authors);

    if (!actor) {
      logWebhook_(payload.id, payload.type, pageId, currentStatus, when, 'ignored_unmapped_actor:' + assignedAgent);
      return json_({ ok: true, ignored: 'unmapped_actor' });
    }

    let outcome = 'ignored_status:' + currentStatus;
    if (currentStatus === DEFAULTS.START_STATUS) {
      outcome = openTimeEvent_(pageId, title, actor, currentStatus, changedBy, payload.id, when, page.url);
    } else if (DEFAULTS.STOP_STATUSES.indexOf(currentStatus) !== -1) {
      outcome = closeTimeEvent_(pageId, actor, currentStatus, changedBy, when);
    }

    logWebhook_(payload.id, payload.type, pageId, currentStatus, when, outcome);
    return json_({ ok: true, outcome: outcome });
  });
}

function retrieveNotionPage_(pageId) {
  const token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('Set NOTION_TOKEN in Apps Script Script Properties.');

  const response = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + encodeURIComponent(pageId), {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': DEFAULTS.NOTION_VERSION,
    },
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Notion retrieve page failed: HTTP ' + code + ' ' + response.getContentText());
  }
  return JSON.parse(response.getContentText());
}

function openTimeEvent_(taskId, taskTitle, actor, status, changedBy, webhookId, when, notionUrl) {
  const sheet = sheet_(DEFAULTS.TIME_EVENTS_SHEET);
  const openRow = findOpenEventRow_(sheet, taskId, actor);
  if (openRow) return 'already_open_row:' + openRow;

  const row = sheet.getLastRow() + 1;
  const eventId = Utilities.getUuid();
  sheet.getRange(row, 1, 1, 13).setValues([[
    eventId,
    taskId,
    taskTitle,
    actor,
    when,
    '',
    '',
    status,
    '',
    changedBy,
    notionUrl || ('https://www.notion.so/' + taskId.replace(/-/g, '')),
    webhookId,
    new Date(),
  ]]);
  sheet.getRange(row, 7).setFormula('=IF(OR(E' + row + '="",F' + row + '=""),"",24*(F' + row + '-E' + row + '))');
  return 'opened_row:' + row;
}

function closeTimeEvent_(taskId, actor, endStatus, changedBy, when) {
  const sheet = sheet_(DEFAULTS.TIME_EVENTS_SHEET);
  const row = findOpenEventRow_(sheet, taskId, actor);
  if (!row) return 'stop_without_open';

  sheet.getRange(row, 6).setValue(when);
  sheet.getRange(row, 9).setValue(endStatus);
  sheet.getRange(row, 10).setValue(changedBy);
  return 'closed_row:' + row;
}

function findOpenEventRow_(sheet, taskId, actor) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (String(row[1]) === String(taskId) && String(row[3]) === String(actor) && row[4] && !row[5]) {
      return i + 2;
    }
  }
  return 0;
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

function authorLabel_(authors) {
  if (!authors || !authors.length) return '';
  return authors.map(function (a) { return (a.type || 'unknown') + ':' + (a.id || ''); }).join(',');
}

function parseTimestamp_(value) {
  const d = value ? new Date(value) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

function normalizeId_(value) {
  return String(value || '').replace(/-/g, '').toLowerCase();
}

function isAuthorized_(e) {
  const expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_KEY');
  const actual = e && e.parameter ? e.parameter.hookKey : '';
  return Boolean(expected && actual && expected === actual);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
