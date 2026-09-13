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

// A-Z-only column-letter -> 1-based index (e.g. 'A' -> 1, 'H' -> 8). Code.gs
// only ever builds single-letter columns for the Sync Log's 8 columns, so
// multi-letter (>26 column) support is deliberately not implemented here.
function columnLetterToIndex_(letters) {
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index;
}

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
    // Counts real Sheets-transfer calls a test can assert against, to prove
    // a fix's *cost* characteristic (e.g. "does not scale with log size"),
    // not only its correctness. getValues() stands in for a genuine
    // row-data transfer; findAll()/findNext() are deliberately not counted
    // here since they represent a server-side TextFinder search returning
    // only match positions, the cheaper operation these counts exist to
    // distinguish from.
    this.getValuesCallCount = 0;
    // Finding A (ADP-051-B2/B3 fixup round 2): total ROWS actually
    // transferred across every getValues() call, not just the call count —
    // a bounded call count alone doesn't prove a fix stopped materializing
    // unrelated rows if any one of those calls still spans the whole sheet.
    // A test proving getRangeList's per-run bounding must assert on this,
    // not only on getValuesCallCount.
    this.getValuesRowCount = 0;
  }

  hideSheet() {
    this.hidden = true;
    return this;
  }

  getLastRow() {
    return this.rows.length;
  }

  deleteRow(rowPosition) {
    this.rows.splice(rowPosition - 1, 1);
    return this;
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

  // Finding A (ADP-051-B2/B3 fixup round 2): stand-in for
  // `Sheet#getRangeList(a1Notations)` — Code.gs's readSyncLogRowsForTask_
  // uses this to fetch several discontiguous, bounded row runs in a few
  // service calls without ever transferring the unrelated rows between
  // them. Only the plain `A5:H7` column-letter/row-number form is
  // supported, since that's the only shape Code.gs ever builds.
  getRangeList(a1Notations) {
    const sheet = this;
    const ranges = a1Notations.map(function (a1) {
      const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a1);
      if (!match) throw new Error('FakeSheet.getRangeList: unsupported A1 notation "' + a1 + '"');
      const startCol = columnLetterToIndex_(match[1]);
      const startRow = parseInt(match[2], 10);
      const endCol = columnLetterToIndex_(match[3]);
      const endRow = parseInt(match[4], 10);
      return sheet.getRange(startRow, startCol, endRow - startRow + 1, endCol - startCol + 1);
    });
    return {
      getRanges() {
        return ranges;
      },
    };
  }

  getRange(row, column, numRows = 1, numColumns = 1) {
    const sheet = this;
    return {
      getValues() {
        sheet.getValuesCallCount++;
        sheet.getValuesRowCount += numRows;
        const result = [];
        for (let rowOffset = 0; rowOffset < numRows; rowOffset++) {
          const source = sheet.rows[row - 1 + rowOffset] || [];
          const line = [];
          for (let columnOffset = 0; columnOffset < numColumns; columnOffset++) {
            line.push(source[column - 1 + columnOffset] !== undefined ? source[column - 1 + columnOffset] : '');
          }
          result.push(line);
        }
        return result;
      },
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
          // Real TextFinder#findAll returns every match within the searched
          // range, in the order encountered scanning forward from the range's
          // own start -- i.e. ascending row order for a column range, since
          // this codebase's sheets are only ever appended to. Code.gs relies
          // on that ordering (the last element is the most recent match).
          findAll() {
            const matches = [];
            for (let offset = 0; offset < numRows; offset++) {
              const candidate = (sheet.rows[row - 1 + offset] || [])[column - 1];
              if (String(candidate) === String(text)) {
                const matchedRow = row + offset;
                matches.push({ getRow: () => matchedRow });
              }
            }
            return matches;
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

  // Optional deterministic clock for tests exercising wall-clock behavior
  // (e.g. pollTaskChanges' MAX_RUN_DURATION_MS bail-out) without actually
  // waiting real minutes. `overrides.now` is a () => ms function; when given,
  // `new Date()` (no args) and `Date.now()` inside the sandbox both resolve
  // through it, while every other Date usage (parsing, arithmetic) is
  // untouched via real subclassing.
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
