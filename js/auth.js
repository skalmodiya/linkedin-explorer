// auth.js — LinkedIn OAuth 2.0 flow with popup/redirect fallback
import { CONFIG } from '../config.js';

const SESSION_KEYS = {
  TOKEN:   'li_access_token',
  EXPIRY:  'li_token_expiry',
  STATE:   'li_oauth_state',
  STATE_TS:'li_oauth_state_ts',
  METHOD:  'li_auth_method',
  SUB:     'li_user_sub',
};

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Public API ─────────────────────────────────────────────

export function getToken() {
  const token  = sessionStorage.getItem(SESSION_KEYS.TOKEN);
  const expiry = parseInt(sessionStorage.getItem(SESSION_KEYS.EXPIRY) || '0', 10);
  if (!token || !expiry) return null;
  if (Date.now() >= expiry) {
    clearSession();
    return null;
  }
  return token;
}

export function getExpiryDate() {
  const ts = parseInt(sessionStorage.getItem(SESSION_KEYS.EXPIRY) || '0', 10);
  return ts ? new Date(ts) : null;
}

export function getUserSub() {
  return sessionStorage.getItem(SESSION_KEYS.SUB);
}

export function setUserSub(sub) {
  sessionStorage.setItem(SESSION_KEYS.SUB, sub);
}

export function logout() {
  clearSession();
  window.dispatchEvent(new CustomEvent('li:logout'));
}

// startLogin — generates state, opens popup or redirects
export function startLogin() {
  const state = generateState();
  sessionStorage.setItem(SESSION_KEYS.STATE, state);
  sessionStorage.setItem(SESSION_KEYS.STATE_TS, String(Date.now()));

  const authUrl = buildAuthUrl(state);

  // Try popup first
  const popup = window.open(authUrl, 'li_oauth', 'width=600,height=700,left=300,top=100');
  if (popup && !popup.closed) {
    sessionStorage.setItem(SESSION_KEYS.METHOD, 'popup');
    // Listen for message from popup
    window.addEventListener('message', handlePopupMessage, { once: false });
  } else {
    // Popup blocked — full-page redirect
    sessionStorage.setItem(SESSION_KEYS.METHOD, 'redirect');
    window.location.href = authUrl;
  }
}

// handleCallback — called on page load to check for OAuth return
// Returns 'success' | 'error' | 'none'
export function handleCallback() {
  const hash = window.location.hash.slice(1);
  if (!hash) return 'none';

  const params = new URLSearchParams(hash);

  // Error from LinkedIn or Worker
  if (params.has('error')) {
    clearFragment();
    const desc = params.get('error_description') || params.get('error');
    window.dispatchEvent(new CustomEvent('li:auth-error', { detail: { message: decodeURIComponent(desc) } }));
    return 'error';
  }

  const token    = params.get('token');
  const state    = params.get('state');
  const expiresIn = parseInt(params.get('expires_in') || '0', 10);

  if (!token || !state) return 'none';

  // Validate state nonce
  if (!validateState(state)) {
    clearFragment();
    clearSession();
    window.dispatchEvent(new CustomEvent('li:auth-error', { detail: { message: 'Security check failed (state mismatch). Please try logging in again.' } }));
    return 'error';
  }

  storeToken(token, expiresIn);
  clearFragment();
  window.dispatchEvent(new CustomEvent('li:auth-success'));
  return 'success';
}

// ── Internal helpers ────────────────────────────────────────

function generateState() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildAuthUrl(state) {
  const workerCallback = `${CONFIG.WORKER_URL}/callback`;
  // Embed the current origin into state so the Worker redirects back here
  // Format: "<nonce>|<origin>"  e.g. "a1b2c3...|http://localhost:3000"
  const stateWithOrigin = `${state}|${window.location.origin}`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     CONFIG.CLIENT_ID,
    redirect_uri:  workerCallback,
    state:         stateWithOrigin,
    scope:         CONFIG.SCOPES,
  });
  return `${LINKEDIN_AUTH_URL}?${params}`;
}

function validateState(returnedState) {
  const stored   = sessionStorage.getItem(SESSION_KEYS.STATE);
  const storedTs = parseInt(sessionStorage.getItem(SESSION_KEYS.STATE_TS) || '0', 10);

  sessionStorage.removeItem(SESSION_KEYS.STATE);
  sessionStorage.removeItem(SESSION_KEYS.STATE_TS);
  sessionStorage.removeItem(SESSION_KEYS.METHOD);

  // returnedState is the raw nonce (Worker strips the "|origin" part before redirecting)
  if (!stored || stored !== returnedState) return false;
  if (Date.now() - storedTs > STATE_TTL_MS) return false;
  return true;
}

function storeToken(token, expiresIn) {
  const expiry = expiresIn > 0
    ? Date.now() + expiresIn * 1000
    : Date.now() + 60 * 24 * 60 * 60 * 1000; // fallback: 60 days
  sessionStorage.setItem(SESSION_KEYS.TOKEN, token);
  sessionStorage.setItem(SESSION_KEYS.EXPIRY, String(expiry));
}

function clearFragment() {
  if (window.history && window.history.replaceState) {
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', clean);
  }
}

function clearSession() {
  Object.values(SESSION_KEYS).forEach(k => sessionStorage.removeItem(k));
}

function handlePopupMessage(event) {
  // Only accept messages from our own origin
  if (event.origin !== window.location.origin) return;
  if (!event.data || !event.data.type) return;
  if (!['LI_AUTH_SUCCESS', 'LI_AUTH_ERROR'].includes(event.data.type)) return;

  window.removeEventListener('message', handlePopupMessage);

  if (event.data.type === 'LI_AUTH_ERROR') {
    clearSession();
    window.dispatchEvent(new CustomEvent('li:auth-error', { detail: { message: event.data.error || 'Authentication failed.' } }));
    return;
  }

  const { token, state, expires_in } = event.data;
  if (!token || !state) return;

  if (!validateState(state)) {
    clearSession();
    window.dispatchEvent(new CustomEvent('li:auth-error', { detail: { message: 'Security check failed (state mismatch from popup).' } }));
    return;
  }

  storeToken(token, expires_in || 0);
  window.dispatchEvent(new CustomEvent('li:auth-success'));
}
