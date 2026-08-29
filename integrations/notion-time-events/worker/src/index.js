const PENDING_TOKEN_KEY = 'notion_webhook_pending_token';
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

    const payloadToken = typeof payload.verification_token === 'string' ? payload.verification_token : '';

    // Enrollment is intentionally NOT trusted automatically. The verification
    // request proves reachability, not Notion identity, because the request body
    // itself contains the future HMAC secret. Store it only as a pending
    // candidate. An authenticated operator must paste it into Notion, observe
    // Notion accepting it, and then promote the same value into the Worker
    // secret NOTION_WEBHOOK_VERIFICATION_TOKEN and Apps Script Script Properties.
    if (payloadToken) {
      await env.WEBHOOK_STATE.put(PENDING_TOKEN_KEY, payloadToken);
      return response(200, { ok: true, verificationPending: true });
    }

    const activeToken = env.NOTION_WEBHOOK_VERIFICATION_TOKEN || '';
    if (!activeToken) {
      return response(503, { ok: false, error: 'active_verification_token_not_configured' });
    }

    const signature = request.headers.get('X-Notion-Signature') || '';
    const expected = await notionSignature(rawBody, activeToken);
    if (!signature || !constantTimeEqual(expected, signature)) {
      return response(401, { ok: false, error: 'invalid_notion_signature' });
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

    let upstreamJson = null;
    try {
      upstreamJson = upstreamText ? JSON.parse(upstreamText) : null;
    } catch {
      // Treat a non-JSON Apps Script response as an upstream failure so Notion can retry.
    }
    if (!upstreamJson || upstreamJson.ok !== true) {
      return response(502, {
        ok: false,
        error: 'apps_script_rejected_delivery',
        upstreamError: upstreamJson && upstreamJson.error ? upstreamJson.error : 'invalid_response',
      });
    }

    return new Response(upstreamText, {
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
