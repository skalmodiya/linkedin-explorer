// Cloudflare Worker — LinkedIn OAuth proxy + API proxy
// Routes:
//   GET  /callback       — OAuth token exchange (LinkedIn redirects here)
//   GET  /api/userinfo   — proxies GET https://api.linkedin.com/v2/userinfo
//   POST /api/ugcPosts   — proxies POST https://api.linkedin.com/v2/ugcPosts
//   GET  /health         — health check

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env.APP_ORIGIN) });
    }

    if (url.pathname === '/callback') {
      return handleCallback(url, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApiProxy(request, url, env);
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env.APP_ORIGIN) },
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

  const appOrigin = (env.APP_ORIGIN || '').replace(/\/$/, '');
  const appPath   = env.APP_PATH ? '/' + env.APP_PATH.replace(/^\//, '').replace(/\/$/, '') : '';
  const appBase   = appOrigin + appPath + '/';

  const redirectError = (errCode, description) => {
    const dest = new URL(appBase);
    dest.hash = `error=${encodeURIComponent(errCode)}&error_description=${encodeURIComponent(description)}`;
    return Response.redirect(dest.toString(), 302);
  };

  if (error) return redirectError(error, errorDescription);
  if (!code || !state) return redirectError('invalid_callback', 'Missing code or state parameter.');
  if (!/^[0-9a-f]{32,64}$/.test(state)) return redirectError('invalid_state', 'Malformed state parameter.');

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
    `state=${encodeURIComponent(state)}`,
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
// Forwards authenticated requests to LinkedIn API server-side,
// avoiding CORS restrictions in the browser.

async function handleApiProxy(request, url, env) {
  // Extract Bearer token from Authorization header
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'missing_token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(env.APP_ORIGIN) },
    });
  }

  // Map /api/* → https://api.linkedin.com/v2/*
  const liPath = url.pathname.replace(/^\/api\//, '/v2/') + url.search;
  const liUrl  = `https://api.linkedin.com${liPath}`;

  // Forward the request to LinkedIn
  const liResponse = await fetch(liUrl, {
    method:  request.method,
    headers: {
      'Authorization':              authHeader,
      'Content-Type':               request.headers.get('Content-Type') || 'application/json',
      'X-Restli-Protocol-Version':  '2.0.0',
    },
    body: request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.text()
      : undefined,
  });

  // Stream response back with CORS headers added
  const responseBody = await liResponse.text();
  return new Response(responseBody, {
    status:  liResponse.status,
    headers: {
      'Content-Type': liResponse.headers.get('Content-Type') || 'application/json',
      'X-RestLi-Id':  liResponse.headers.get('X-RestLi-Id') || '',
      ...corsHeaders(env.APP_ORIGIN),
    },
  });
}

// ── CORS headers ──────────────────────────────────────────────

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Restli-Protocol-Version',
    'Access-Control-Expose-Headers':'X-RestLi-Id',
    'Access-Control-Max-Age':       '86400',
  };
}
