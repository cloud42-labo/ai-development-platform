import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const encoder = new TextEncoder();
const TASK_ID = '3cafbd82-6f3b-8158-9622-d795b43d1f03';

class MemoryKV {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }
  async get(key) {
    return this.values.get(key) || null;
  }
  async put(key, value) {
    this.values.set(key, value);
  }
  async delete(key) {
    this.values.delete(key);
  }
}

async function sign(body, token) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return 'sha256=' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function requestFor(payload, token) {
  const body = JSON.stringify(payload);
  const headers = { 'content-type': 'application/json' };
  if (token) headers['X-Notion-Signature'] = await sign(body, token);
  return new Request('https://worker.example/notion', {
    method: 'POST',
    headers,
    body,
  });
}

test('verification handshake is only stored as pending and is not relayed', { concurrency: false }, async () => {
  const token = 'secret_test_verification';
  const kv = new MemoryKV();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}');
  };

  try {
    const res = await worker.fetch(await requestFor({ verification_token: token }, token), {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).verificationPending, true);
    assert.equal(await kv.get('notion_webhook_pending_token'), token);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a forged pending token cannot become an active signing credential', { concurrency: false }, async () => {
  const attackerToken = 'attacker-controlled';
  const kv = new MemoryKV();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}');
  };

  try {
    await worker.fetch(await requestFor({ verification_token: attackerToken }, attackerToken), {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
    });

    const event = {
      type: 'page.properties_updated',
      id: 'evt-forged',
      entity: { id: TASK_ID },
    };
    const res = await worker.fetch(await requestFor(event, attackerToken), {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'active_verification_token_not_configured');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid Notion signature is rejected before relay', { concurrency: false }, async () => {
  const kv = new MemoryKV();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}');
  };

  try {
    const body = JSON.stringify({
      type: 'page.properties_updated',
      id: 'evt-1',
      entity: { id: TASK_ID },
    });
    const req = new Request('https://worker.example/notion', {
      method: 'POST',
      headers: { 'X-Notion-Signature': 'sha256=bad' },
      body,
    });
    const res = await worker.fetch(req, {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
      NOTION_WEBHOOK_VERIFICATION_TOKEN: 'real-token',
    });
    assert.equal(res.status, 401);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normal signed delivery relays only the page id', { concurrency: false }, async () => {
  const token = 'operator-promoted-token';
  const kv = new MemoryKV({ notion_webhook_pending_token: 'untrusted-other-token' });
  const originalFetch = globalThis.fetch;
  let relayBody = null;
  globalThis.fetch = async (_url, init) => {
    relayBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true, outcome: 'opened' }), { status: 200 });
  };

  try {
    const payload = {
      type: 'page.properties_updated',
      id: 'evt-2',
      timestamp: '2000-01-01T00:00:00.000Z',
      authors: [{ id: 'untrusted-author' }],
      entity: { id: TASK_ID },
      data: { updated_properties: ['untrusted'] },
    };
    const res = await worker.fetch(await requestFor(payload, token), {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
      NOTION_WEBHOOK_VERIFICATION_TOKEN: token,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(relayBody, { pageId: TASK_ID });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('signed delivery with invalid page id is not relayed', { concurrency: false }, async () => {
  const token = 'operator-promoted-token';
  const kv = new MemoryKV();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}');
  };

  try {
    const payload = {
      type: 'page.properties_updated',
      id: 'evt-bad-page',
      entity: { id: 'not-a-page-id' },
    };
    const res = await worker.fetch(await requestFor(payload, token), {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
      NOTION_WEBHOOK_VERIFICATION_TOKEN: token,
    });
    assert.equal(res.status, 400);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apps Script logical rejection becomes retryable 502', { concurrency: false }, async () => {
  const token = 'operator-promoted-token';
  const kv = new MemoryKV();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ ok: false, error: 'notion_write_failed' }),
    { status: 200 }
  );

  try {
    const payload = {
      type: 'page.properties_updated',
      id: 'evt-3',
      entity: { id: TASK_ID },
    };
    const res = await worker.fetch(await requestFor(payload, token), {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
      NOTION_WEBHOOK_VERIFICATION_TOKEN: token,
    });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'apps_script_rejected_delivery');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
