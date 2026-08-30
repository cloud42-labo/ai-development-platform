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
    // APPS_SCRIPT_RELAY_SECRET is required only for the privileged relay hop
    // to Apps Script, checked just before that hop below. It is deliberately
    // NOT required this early: the initial Notion verification handshake
    // (the pending-token branch) must succeed on a freshly deployed Worker
    // before an operator has provisioned any secret, or Notion's own
    // subscription verification can never get off the ground.

    const rawBody = await request.text();
    if (!rawBody) return response(400, { ok: false, error: 'empty_body' });

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return response(400, { ok: false, error: 'invalid_json' });
    }

    const payloadToken = typeof payload.verification_token === 'string' ? payload.verification_token : '';

    // The verification request establishes endpoint reachability but does not
    // authenticate the token carried in its own body. Keep it pending only. An
    // authenticated operator must prove it in Notion's verification UI before
    // promoting the same value to the active Worker secret.
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

    if (payload.type !== 'page.properties_updated') {
      return response(200, { ok: true, ignored: 'event_type' });
    }

    const pageId = payload.entity && payload.entity.id;
    if (!isUuidLike(pageId)) {
      return response(400, { ok: false, error: 'missing_or_invalid_page_id' });
    }

    // Only now, immediately before the privileged Worker -> Apps Script hop,
    // is the relay secret actually required.
    if (!env.APPS_SCRIPT_RELAY_SECRET) {
      return response(500, { ok: false, error: 'missing_apps_script_relay_secret' });
    }

    // Authenticate the Worker -> Apps Script hop separately from the Notion
    // webhook token. The shared relay secret is configured only in Cloudflare
    // and Apps Script Script Properties. Apps Script must verify this HMAC before
    // any privileged Notion reconciliation.
    const relayTimestamp = Date.now().toString();
    const relayMessage = pageId + '|' + relayTimestamp;
    const relaySignature = await rawHmac(relayMessage, env.APPS_SCRIPT_RELAY_SECRET);
    const relayBody = { pageId, relayTimestamp, relaySignature };

    const upstream = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(relayBody),
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
  return 'sha256=' + await rawHmac(body, verificationToken);
}

async function rawHmac(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return toHex(new Uint8Array(signed));
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(String(value || ''));
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
