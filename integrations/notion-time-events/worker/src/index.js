const TOKEN_KEY = 'notion_webhook_verification_token';
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return response(405, { ok: false, error: 'method_not_allowed' });
    }
    if (!env.WEBHOOK_STATE) {
      return response(500, { ok: false, error: 'missing_kv_binding' });
    }
    if (!env.APPS_SCRIPT_URL) {
      return response(500, { ok: false, error: 'missing_apps_script_url' });
    }

    const rawBody = await request.text();
    if (!rawBody) return response(400, { ok: false, error: 'empty_body' });

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return response(400, { ok: false, error: 'invalid_json' });
    }

    const signature = request.headers.get('X-Notion-Signature') || '';
    const storedToken = (await env.WEBHOOK_STATE.get(TOKEN_KEY)) || '';
    const payloadToken = typeof payload.verification_token === 'string' ? payload.verification_token : '';
    const verificationToken = storedToken || payloadToken;

    if (!verificationToken) {
      return response(503, { ok: false, error: 'verification_token_missing' });
    }

    const expected = await notionSignature(rawBody, verificationToken);
    if (!signature || !constantTimeEqual(expected, signature)) {
      return response(401, { ok: false, error: 'invalid_notion_signature' });
    }

    if (payloadToken) {
      if (storedToken && storedToken !== payloadToken) {
        return response(409, { ok: false, error: 'verification_token_rotation_requires_reset' });
      }
      if (!storedToken) await env.WEBHOOK_STATE.put(TOKEN_KEY, payloadToken);
    }

    const upstream = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawBody, notionSignature: signature }),
      redirect: 'follow',
    });

    const upstreamText = await upstream.text();
    if (!upstream.ok) {
      return response(502, {
        ok: false,
        error: 'apps_script_upstream_failed',
        upstreamStatus: upstream.status,
      });
    }

    return new Response(upstreamText || JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};

async function notionSignature(body, verificationToken) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(verificationToken),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return 'sha256=' + toHex(new Uint8Array(signed));
}

function toHex(bytes) {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function constantTimeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
