import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const encoder = new TextEncoder();

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
  const signature = await sign(body, token);
  return new Request('https://worker.example/notion', {
    method: 'POST',
    headers: {
      'X-Notion-Signature': signature,
      'content-type': 'application/json',
    },
    body,
  });
}

test('verification handshake is validated, stored, and forwarded', { concurrency: false }, async () => {
  const token = 'secret_test_verification';
  const kv = new MemoryKV();
  const originalFetch = globalThis.fetch;
  let forwarded = null;
  globalThis.fetch = async (_url, init) => {
    forwarded = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true, verification: true }), { status: 200 });
  };

  try {
    const res = await worker.fetch(await requestFor({ verification_token: token }, token), {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
    });
    assert.equal(res.status, 200);
    assert.equal(await kv.get('notion_webhook_verification_token'), token);
    assert.equal(JSON.parse(forwarded.rawBody).verification_token, token);
    assert.ok(forwarded.notionSignature.startsWith('sha256='));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid Notion signature is rejected before relay', { concurrency: false }, async () => {
  const kv = new MemoryKV({ notion_webhook_verification_token: 'real-token' });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{}');
  };

  try {
    const body = JSON.stringify({ type: 'page.properties_updated', id: 'evt-1' });
    const req = new Request('https://worker.example/notion', {
      method: 'POST',
      headers: { 'X-Notion-Signature': 'sha256=bad' },
      body,
    });
    const res = await worker.fetch(req, {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
    });
    assert.equal(res.status, 401);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normal signed delivery uses stored token', { concurrency: false }, async () => {
  const token = 'stored-token';
  const kv = new MemoryKV({ notion_webhook_verification_token: token });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ ok: true, outcome: 'opened' }), { status: 200 });
  };

  try {
    const payload = { type: 'page.properties_updated', id: 'evt-2', entity: { id: 'task' } };
    const res = await worker.fetch(await requestFor(payload, token), {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apps Script logical rejection becomes retryable 502', { concurrency: false }, async () => {
  const token = 'stored-token';
  const kv = new MemoryKV({ notion_webhook_verification_token: token });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ ok: false, error: 'notion_write_failed' }),
    { status: 200 }
  );

  try {
    const payload = { type: 'page.properties_updated', id: 'evt-3' };
    const res = await worker.fetch(await requestFor(payload, token), {
      WEBHOOK_STATE: kv,
      APPS_SCRIPT_URL: 'https://script.example/exec',
    });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'apps_script_rejected_delivery');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
