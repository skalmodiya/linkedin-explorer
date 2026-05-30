// Cloudflare Worker — LinkedIn OAuth token exchange proxy
// Handles: GET /callback (LinkedIn redirects here after user authorizes)
// Secrets (set via `wrangler secret put`):
//   LINKEDIN_CLIENT_SECRET — never in any file
// Vars (in wrangler.toml):
//   LINKEDIN_CLIENT_ID, APP_ORIGIN, APP_PATH, WORKER_CALLBACK_URL

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

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env.APP_ORIGIN) },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleCallback(url, env) {
  const code             = url.searchParams.get('code');
  const state            = url.searchParams.get('state');
  const error            = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description') || '';

  // Build the base URL of the frontend app
  const appOrigin = (env.APP_ORIGIN || '').replace(/\/$/, '');
  const appPath   = env.APP_PATH ? '/' + env.APP_PATH.replace(/^\//, '').replace(/\/$/, '') : '';
  const appBase   = appOrigin + appPath + '/';

  // Helper: redirect to app with error in fragment
  const redirectError = (errCode, description) => {
    const dest = new URL(appBase);
    dest.hash = `error=${encodeURIComponent(errCode)}&error_description=${encodeURIComponent(description)}`;
    return Response.redirect(dest.toString(), 302);
  };

  // User denied or LinkedIn returned an error
  if (error) {
    return redirectError(error, errorDescription);
  }

  // Missing required params
  if (!code || !state) {
    return redirectError('invalid_callback', 'Missing code or state parameter.');
  }

  // Basic state sanity check — must be 32 hex chars (our 16-byte nonce)
  if (!/^[0-9a-f]{32,64}$/.test(state)) {
    return redirectError('invalid_state', 'Malformed state parameter.');
  }

  // Exchange authorization code for access token
  let tokenData;
  try {
    tokenData = await exchangeCode(code, env);
  } catch (err) {
    return redirectError('token_exchange_failed', err.message);
  }

  // Redirect back to frontend with token in URL fragment
  // Fragment is never sent to the GitHub Pages server — it stays in the browser
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
    grant_type:   'authorization_code',
    code,
    client_id:    env.LINKEDIN_CLIENT_ID,
    client_secret: env.LINKEDIN_CLIENT_SECRET,
    redirect_uri: env.WORKER_CALLBACK_URL,
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
  if (!data.access_token) {
    throw new Error('No access_token in LinkedIn response.');
  }

  // Return only what the frontend needs — strip refresh_token
  return {
    access_token: data.access_token,
    expires_in:   data.expires_in || 0,
  };
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}
