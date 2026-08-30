import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadCodeGsSandbox, readJson } from './support/gas-sandbox.mjs';

const SECRET = 'apps-script-relay-secret-test';
const PAGE_ID = '3cafbd82-6f3b-8158-9622-d795b43d1f03';

function hexHmac(message, secret) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function signedEnvelope(pageId, secret, { timestamp } = {}) {
  const relayTimestamp = timestamp || Date.now().toString();
  const relaySignature = hexHmac(pageId + '|' + relayTimestamp, secret);
  return { pageId, relayTimestamp, relaySignature };
}

test('valid relay HMAC within the timestamp window is accepted', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: { APPS_SCRIPT_RELAY_SECRET: SECRET } });
  const result = sandbox.verifyRelayRequest_(signedEnvelope(PAGE_ID, SECRET));
  assert.equal(result.ok, true);
  assert.equal(result.pageId, PAGE_ID);
});

test('an invalid relay signature is rejected', () => {
  const { sandbox, fetchLog } = loadCodeGsSandbox({ scriptProperties: { APPS_SCRIPT_RELAY_SECRET: SECRET } });
  const envelope = signedEnvelope(PAGE_ID, 'attacker-controlled-secret');
  const result = sandbox.verifyRelayRequest_(envelope);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_relay_signature');
  assert.equal(fetchLog.length, 0);
});

test('an expired relay timestamp is rejected even with a correct signature', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: { APPS_SCRIPT_RELAY_SECRET: SECRET } });
  const staleTimestamp = (Date.now() - 10 * 60 * 1000).toString(); // 10 minutes old, window is 5
  const envelope = signedEnvelope(PAGE_ID, SECRET, { timestamp: staleTimestamp });
  const result = sandbox.verifyRelayRequest_(envelope);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'relay_timestamp_out_of_window');
});

test('a future relay timestamp beyond the window is also rejected', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: { APPS_SCRIPT_RELAY_SECRET: SECRET } });
  const futureTimestamp = (Date.now() + 10 * 60 * 1000).toString();
  const envelope = signedEnvelope(PAGE_ID, SECRET, { timestamp: futureTimestamp });
  const result = sandbox.verifyRelayRequest_(envelope);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'relay_timestamp_out_of_window');
});

test('replaying a previously accepted envelope is rejected', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: { APPS_SCRIPT_RELAY_SECRET: SECRET } });
  const envelope = signedEnvelope(PAGE_ID, SECRET);

  const first = sandbox.verifyRelayRequest_(envelope);
  assert.equal(first.ok, true);

  const replay = sandbox.verifyRelayRequest_(envelope);
  assert.equal(replay.ok, false);
  assert.equal(replay.error, 'relay_replay_detected');
});

test('a different envelope for the same page is still accepted after a prior replay rejection', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: { APPS_SCRIPT_RELAY_SECRET: SECRET } });
  const first = signedEnvelope(PAGE_ID, SECRET, { timestamp: Date.now().toString() });
  assert.equal(sandbox.verifyRelayRequest_(first).ok, true);
  assert.equal(sandbox.verifyRelayRequest_(first).ok, false); // replay of the same envelope

  const second = signedEnvelope(PAGE_ID, SECRET, { timestamp: (Date.now() + 1000).toString() });
  assert.equal(sandbox.verifyRelayRequest_(second).ok, true);
});

test('a missing relay secret fails safely and never reaches Notion', () => {
  const { sandbox, fetchLog } = loadCodeGsSandbox({ scriptProperties: {} }); // APPS_SCRIPT_RELAY_SECRET unset
  const envelope = signedEnvelope(PAGE_ID, SECRET);
  const result = sandbox.verifyRelayRequest_(envelope);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'relay_secret_not_configured');
  assert.equal(fetchLog.length, 0);
});

test('doPost never fetches Notion when the relay envelope fails verification', () => {
  const { sandbox, fetchLog } = loadCodeGsSandbox({ scriptProperties: { APPS_SCRIPT_RELAY_SECRET: SECRET } });
  const body = JSON.stringify({ pageId: PAGE_ID, relayTimestamp: 'not-a-number', relaySignature: 'bad' });
  const parsed = readJson(sandbox.doPost({ postData: { contents: body } }));
  assert.equal(parsed.ok, false);
  assert.equal(fetchLog.length, 0);
});

test('{pageId} alone, with no relay envelope, cannot trigger reconciliation', () => {
  const { sandbox, fetchLog } = loadCodeGsSandbox({ scriptProperties: { APPS_SCRIPT_RELAY_SECRET: SECRET } });
  const body = JSON.stringify({ pageId: PAGE_ID });
  const parsed = readJson(sandbox.doPost({ postData: { contents: body } }));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /relay/);
  assert.equal(fetchLog.length, 0);
});

test('doPost rejects a stale-but-correctly-signed relay envelope without any Notion access', () => {
  const { sandbox, fetchLog } = loadCodeGsSandbox({ scriptProperties: { APPS_SCRIPT_RELAY_SECRET: SECRET } });
  const staleTimestamp = (Date.now() - 10 * 60 * 1000).toString();
  const envelope = signedEnvelope(PAGE_ID, SECRET, { timestamp: staleTimestamp });
  const parsed = readJson(sandbox.doPost({ postData: { contents: JSON.stringify(envelope) } }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'relay_timestamp_out_of_window');
  assert.equal(fetchLog.length, 0);
});
