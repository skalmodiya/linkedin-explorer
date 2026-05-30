// Cloudflare Worker — LinkedIn OAuth proxy + API proxy
// Routes:
//   GET  /callback       — OAuth token exchange (LinkedIn redirects here)
//   GET  /api/userinfo   — proxies GET https://api.linkedin.com/v2/userinfo
//   POST /api/ugcPosts   — proxies POST https://api.linkedin.com/v2/ugcPosts
//   GET  /oidc/*         — proxies GET https://www.linkedin.com/oauth/* (public OIDC endpoints)
//   GET  /health         — health check

// Allowed frontend origins — both GitHub Pages and localhost
const ALLOWED_ORIGINS = [
  'https://skalmodiya.github.io',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
];

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const origin = getRequestOrigin(request);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/callback') {
      return handleCallback(url, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApiProxy(request, url, origin);
    }

    if (url.pathname.startsWith('/oidc/')) {
      return handleOidcProxy(url, origin);
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ── OAuth callback ────────────────────────────────────────────

async function handleCallback(url, env) {
  const code             = url.searchParams.get('code');
  const state            = url.searchParams.get('state');
  const error            = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description') || '';

  // The state param encodes the return origin: "<nonce>|<origin>"
  // e.g. "a1b2c3d4...|http://localhost:3000"
  // Fall back to the default APP_ORIGIN if no origin is encoded
  let returnOrigin = env.APP_ORIGIN || 'https://skalmodiya.github.io';
  let nonce = state || '';

  if (state && state.includes('|')) {
    const parts = state.split('|');
    nonce        = parts[0];
    const encodedOrigin = parts[1];
    // Only allow whitelisted origins
    if (ALLOWED_ORIGINS.includes(encodedOrigin)) {
      returnOrigin = encodedOrigin;
    }
  }

  const appPath = env.APP_PATH ? '/' + env.APP_PATH.replace(/^\//, '').replace(/\/$/, '') : '';
  // localhost has no sub-path
  const isLocalhost = returnOrigin.startsWith('http://localhost') || returnOrigin.startsWith('http://127');
  const appBase = returnOrigin + (isLocalhost ? '/' : appPath + '/');

  const redirectError = (errCode, description) => {
    const dest = new URL(appBase);
    dest.hash = `error=${encodeURIComponent(errCode)}&error_description=${encodeURIComponent(description)}`;
    return Response.redirect(dest.toString(), 302);
  };

  if (error) return redirectError(error, errorDescription);
  if (!code || !nonce) return redirectError('invalid_callback', 'Missing code or state parameter.');
  if (!/^[0-9a-f]{32,64}$/.test(nonce)) return redirectError('invalid_state', 'Malformed state parameter.');

  let tokenData;
  try {
    tokenData = await exchangeCode(code, env);
  } catch (err) {
    return redirectError('token_exchange_failed', err.message);
  }

  const dest = new URL(appBase);
  dest.hash = [
    `token=${encodeURIComponent(tokenData.access_token)}`,
    `expires_in=${tokenData.expires_in || 0}`,
    `state=${encodeURIComponent(nonce)}`,
  ].join('&');

  return Response.redirect(dest.toString(), 302);
}

async function exchangeCode(code, env) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    client_id:     env.LINKEDIN_CLIENT_ID,
    client_secret: env.LINKEDIN_CLIENT_SECRET,
    redirect_uri:  env.WORKER_CALLBACK_URL,
  });

  const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!response.ok) {
    let msg = `LinkedIn returned ${response.status}`;
    try {
      const errBody = await response.json();
      msg = errBody.error_description || errBody.error || msg;
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }

  const data = await response.json();
  if (!data.access_token) throw new Error('No access_token in LinkedIn response.');

  return { access_token: data.access_token, expires_in: data.expires_in || 0 };
}

// ── API proxy ─────────────────────────────────────────────────

async function handleApiProxy(request, url, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'missing_token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  }

  const liPath = url.pathname.replace(/^\/api\//, '/v2/') + url.search;
  const liUrl  = `https://api.linkedin.com${liPath}`;

  const liResponse = await fetch(liUrl, {
    method:  request.method,
    headers: {
      'Authorization':             authHeader,
      'Content-Type':              request.headers.get('Content-Type') || 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.text()
      : undefined,
  });

  const responseBody = await liResponse.text();
  return new Response(responseBody, {
    status:  liResponse.status,
    headers: {
      'Content-Type': liResponse.headers.get('Content-Type') || 'application/json',
      'X-RestLi-Id':  liResponse.headers.get('X-RestLi-Id') || '',
      ...corsHeaders(origin),
    },
  });
}

// ── OIDC proxy (public LinkedIn OAuth endpoints) ──────────────
// Maps /oidc/<path> → https://www.linkedin.com/oauth/<path>
// No auth required — these are public endpoints.

async function handleOidcProxy(url, origin) {
  const liPath = url.pathname.replace(/^\/oidc\//, '/oauth/') + url.search;
  const liUrl  = `https://www.linkedin.com${liPath}`;

  const liResponse = await fetch(liUrl, { method: 'GET' });
  const body = await liResponse.text();

  return new Response(body, {
    status: liResponse.status,
    headers: {
      'Content-Type': liResponse.headers.get('Content-Type') || 'application/json',
      ...corsHeaders(origin),
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────

function getRequestOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':   origin || ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods':  'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':  'Authorization, Content-Type, X-Restli-Protocol-Version',
    'Access-Control-Expose-Headers': 'X-RestLi-Id, X-Asset-Id, Location',
    'Access-Control-Max-Age':        '86400',
  };
}
