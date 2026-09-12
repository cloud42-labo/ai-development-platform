// Minimal Google Apps Script runtime shim so Code.gs can run under
// `node --test` without a real Apps Script environment. Mirrors
// integrations/notion-time-events/test/support/gas-sandbox.mjs, trimmed to
// what this standalone (non-Spreadsheet-bound) project actually calls.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODE_GS_PATH = path.join(__dirname, '..', '..', 'Code.gs');

export function loadCodeGsSandbox(overrides = {}) {
  const source = readFileSync(CODE_GS_PATH, 'utf8');

  const scriptProps = new Map(Object.entries(overrides.scriptProperties || {}));
  const fetchLog = [];
  const fetchImpl = overrides.fetch || (() => {
    throw new Error('UrlFetchApp.fetch was called without a fetch stub configured for this test');
  });

  const triggers = [];
  let lockHeld = Boolean(overrides.lockHeld);

  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(key) {
          return scriptProps.has(key) ? scriptProps.get(key) : null;
        },
        setProperty(key, value) {
          scriptProps.set(key, value);
        },
        setProperties(obj, deleteOthers) {
          if (deleteOthers) scriptProps.clear();
          Object.entries(obj || {}).forEach(([key, value]) => scriptProps.set(key, value));
        },
      };
    },
  };

  const LockService = {
    getScriptLock() {
      return {
        tryLock() {
          if (lockHeld) return false;
          lockHeld = true;
          return true;
        },
        releaseLock() {
          lockHeld = false;
        },
      };
    },
  };

  const ScriptApp = {
    getProjectTriggers() {
      return triggers.slice();
    },
    deleteTrigger(trigger) {
      const index = triggers.indexOf(trigger);
      if (index >= 0) triggers.splice(index, 1);
    },
    newTrigger(handler) {
      const spec = { handler };
      const builder = {
        timeBased() {
          return {
            onMonthDay(day) {
              spec.day = day;
              return this;
            },
            atHour(hour) {
              spec.hour = hour;
              return this;
            },
            inTimezone(tz) {
              spec.timezone = tz;
              return this;
            },
            create() {
              const trigger = {
                getHandlerFunction: () => handler,
                spec: Object.assign({}, spec),
              };
              triggers.push(trigger);
              return trigger;
            },
          };
        },
      };
      return builder;
    },
  };

  const UrlFetchApp = {
    fetch(url, options) {
      fetchLog.push({ url, options });
      return fetchImpl(url, options);
    },
  };

  const Logger = { log() {} };

  const context = {
    PropertiesService,
    LockService,
    ScriptApp,
    UrlFetchApp,
    Logger,
  };

  if (typeof overrides.now === 'function') {
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(overrides.now());
        else super(...args);
      }
      static now() {
        return overrides.now();
      }
    }
    context.Date = FakeDate;
  }

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'Code.gs' });

  return { sandbox: context, scriptProps, fetchLog, triggers };
}

// Builds a UrlFetchApp stub that answers Notion + GitHub calls from a routing
// table keyed by "METHOD path" (Notion: path only, e.g. "POST
// /v1/pages/xyz"; GitHub: full path+query, e.g. "GET /search/issues?q=..."
// is matched by prefix before '?'). Each handler receives the parsed JSON
// body (or {} for GET) and returns the JSON-able response object.
export function fetchStub(routes) {
  return (url, options) => {
    const method = String((options && options.method) || 'get').toUpperCase();
    let path;
    let base;
    if (url.indexOf('https://api.notion.com') === 0) {
      base = 'https://api.notion.com';
    } else if (url.indexOf('https://api.github.com') === 0) {
      base = 'https://api.github.com';
    } else {
      throw new Error('fetchStub: unexpected host in ' + url);
    }
    path = url.slice(base.length);
    const pathNoQuery = path.split('?')[0];
    const handler = routes[method + ' ' + path] || routes[method + ' ' + pathNoQuery] || routes[method + ' *'];
    if (!handler) {
      throw new Error('fetchStub: no route for ' + method + ' ' + path);
    }
    const body = handler(options && options.payload ? JSON.parse(options.payload) : {}, path);
    return {
      getResponseCode: () => (body && body.__status) || 200,
      getContentText: () => JSON.stringify(body && body.__status ? body.body : body),
      getHeaders: () => (body && body.__headers) || {},
    };
  };
}
