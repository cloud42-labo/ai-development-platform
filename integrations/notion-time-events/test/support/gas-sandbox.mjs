// Minimal Google Apps Script runtime shim so Code.gs can run under
// `node --test` without a real Apps Script environment. Only the GAS surface
// Code.gs actually calls is implemented; anything else throws loudly rather
// than silently no-op'ing, so a test that exercises an unstubbed path fails
// clearly instead of lying.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODE_GS_PATH = path.join(__dirname, '..', '..', 'Code.gs');

function toSignedBytes(buffer) {
  // Apps Script's Utilities.compute*Signature/computeDigest return Java-style
  // signed bytes (-128..127), not the 0..255 Node normally works with, and
  // Code.gs's snapshot hashing depends on that representation.
  return Array.from(buffer, (b) => (b > 127 ? b - 256 : b));
}

// In-memory stand-in for a single Sheets tab. Backed by a sparse row array so
// getLastRow/appendRow/getRange behave the way Code.gs's projection and log
// writers expect.
class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.hidden = false;
  }

  hideSheet() {
    this.hidden = true;
    return this;
  }

  getLastRow() {
    return this.rows.length;
  }

  appendRow(values) {
    this.rows.push(values.slice());
    return this;
  }

  _cell(row, column) {
    while (this.rows.length < row) this.rows.push([]);
    const target = this.rows[row - 1];
    while (target.length < column) target.push('');
    return target;
  }

  getRange(row, column, numRows = 1, numColumns = 1) {
    const sheet = this;
    return {
      setValues(values) {
        values.forEach((rowValues, rowOffset) => {
          const target = sheet._cell(row + rowOffset, column + rowValues.length - 1);
          rowValues.forEach((value, columnOffset) => {
            target[column - 1 + columnOffset] = value;
          });
        });
        return this;
      },
      setFormula(formula) {
        sheet._cell(row, column)[column - 1] = formula;
        return this;
      },
      createTextFinder(text) {
        return {
          matchEntireCell() {
            return this;
          },
          findNext() {
            for (let offset = 0; offset < numRows; offset++) {
              const candidate = (sheet.rows[row - 1 + offset] || [])[column - 1];
              if (String(candidate) === String(text)) {
                const matchedRow = row + offset;
                return { getRow: () => matchedRow };
              }
            }
            return null;
          },
        };
      },
    };
  }
}

class FakeSpreadsheet {
  constructor(id) {
    this.id = id;
    this.sheets = new Map();
  }

  getId() {
    return this.id;
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

export function loadCodeGsSandbox(overrides = {}) {
  const source = readFileSync(CODE_GS_PATH, 'utf8');

  const scriptProps = new Map(Object.entries(overrides.scriptProperties || {}));
  const fetchLog = [];
  const fetchImpl = overrides.fetch || (() => {
    throw new Error('UrlFetchApp.fetch was called without a fetch stub configured for this test');
  });

  const spreadsheet = new FakeSpreadsheet(scriptProps.get('SPREADSHEET_ID') || 'test-spreadsheet');
  ['Time Events', 'Sync Log'].forEach((name) => spreadsheet.insertSheet(name));

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

  const Utilities = {
    Charset: { UTF_8: 'UTF_8' },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest(_algorithm, value) {
      const digest = crypto.createHash('sha256').update(Buffer.from(String(value), 'utf8')).digest();
      return toSignedBytes(digest);
    },
    base64EncodeWebSafe(bytes) {
      const buf = Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b)));
      return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    },
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet() {
      return spreadsheet;
    },
    openById() {
      return spreadsheet;
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
      const builder = {
        timeBased() {
          return {
            everyMinutes(minutes) {
              return {
                create() {
                  const trigger = {
                    getHandlerFunction: () => handler,
                    minutes,
                  };
                  triggers.push(trigger);
                  return trigger;
                },
              };
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
    Utilities,
    SpreadsheetApp,
    ScriptApp,
    UrlFetchApp,
    Logger,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'Code.gs' });

  return { sandbox: context, scriptProps, fetchLog, spreadsheet, triggers };
}

// Builds a UrlFetchApp stub that answers Notion calls from a routing table
// keyed by "METHOD /path", and records every request for assertions.
export function notionFetchStub(routes) {
  return (url, options) => {
    const method = String((options && options.method) || 'get').toUpperCase();
    const path = url.replace('https://api.notion.com', '');
    const handler = routes[method + ' ' + path] || routes[method + ' *'];
    const body = handler ? handler(options ? JSON.parse(options.payload || '{}') : {}) : {};
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify(body),
    };
  };
}
