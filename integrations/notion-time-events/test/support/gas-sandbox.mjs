// Minimal Google Apps Script runtime shim so Code.gs's pure/testable logic
// (relay verification, the Done gate) can run under `node --test` without a
// real Apps Script environment. Only the GAS surface Code.gs actually calls
// is implemented; anything else throws loudly rather than silently no-op'ing,
// so a test that exercises an unstubbed path fails clearly instead of lying.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODE_GS_PATH = path.join(__dirname, '..', '..', 'Code.gs');

function toSignedBytes(buffer) {
  // Apps Script's Utilities.compute*Signature methods return Java-style
  // signed bytes (-128..127), not the 0..255 Node normally works with.
  // Code.gs's computeRelayHmacHex_ un-signs them back to a hex digest, so
  // this round-trip must be faithful for the two implementations to agree.
  return Array.from(buffer, (b) => (b > 127 ? b - 256 : b));
}

export function loadCodeGsSandbox(overrides = {}) {
  const source = readFileSync(CODE_GS_PATH, 'utf8');

  const scriptProps = new Map(Object.entries(overrides.scriptProperties || {}));
  const cacheStore = new Map();
  const fetchLog = [];
  const fetchImpl = overrides.fetch || (() => {
    throw new Error('UrlFetchApp.fetch was called without a fetch stub configured for this test');
  });

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

  const CacheService = {
    getScriptCache() {
      return {
        get(key) {
          const entry = cacheStore.get(key);
          if (!entry) return null;
          if (entry.expiresAt <= Date.now()) {
            cacheStore.delete(key);
            return null;
          }
          return entry.value;
        },
        put(key, value, expirationSeconds) {
          cacheStore.set(key, { value, expiresAt: Date.now() + expirationSeconds * 1000 });
        },
      };
    },
  };

  const LockService = {
    getScriptLock() {
      return { waitLock() {}, releaseLock() {} };
    },
  };

  const Utilities = {
    Charset: { UTF_8: 'UTF_8' },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeHmacSha256Signature(value, key) {
      const digest = crypto
        .createHmac('sha256', Buffer.from(String(key), 'utf8'))
        .update(Buffer.from(String(value), 'utf8'))
        .digest();
      return toSignedBytes(digest);
    },
    computeDigest(_algorithm, value) {
      const digest = crypto.createHash('sha256').update(Buffer.from(String(value), 'utf8')).digest();
      return toSignedBytes(digest);
    },
    base64EncodeWebSafe(bytes) {
      const buf = Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b)));
      return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    },
  };

  const ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput(text) {
      return {
        _text: text,
        setMimeType() {
          return this;
        },
      };
    },
  };

  const UrlFetchApp = {
    fetch(url, options) {
      fetchLog.push({ url, options });
      return fetchImpl(url, options);
    },
  };

  const Logger = { log() {} };

  const context = { PropertiesService, CacheService, LockService, Utilities, ContentService, UrlFetchApp, Logger };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'Code.gs' });

  return { sandbox: context, scriptProps, cacheStore, fetchLog };
}

export function readJson(contentServiceOutput) {
  return JSON.parse(contentServiceOutput._text);
}
