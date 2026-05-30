// api.js — LinkedIn API calls routed through Cloudflare Worker proxy
// The Worker adds CORS headers and forwards to api.linkedin.com server-side.
import { CONFIG } from '../config.js';
import { getToken } from './auth.js';

const PROXY_BASE      = CONFIG.WORKER_URL + '/api';
const OIDC_PROXY_BASE = CONFIG.WORKER_URL + '/oidc';

// ── Custom error types ────────────────────────────────────

export class AuthError extends Error {
  constructor(msg) { super(msg); this.name = 'AuthError'; }
}
export class ApiError extends Error {
  constructor(status, msg) { super(msg); this.name = 'ApiError'; this.status = status; }
}

// ── Core fetch wrapper ────────────────────────────────────

async function apiFetch(url, options = {}) {
  const token = getToken();
  if (!token) throw new AuthError('Not authenticated. Please log in.');

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization:               `Bearer ${token}`,
      'Content-Type':              'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('li:token-expired'));
    throw new AuthError('Your session has expired. Please log in again.');
  }

  if (!response.ok) {
    let msg = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      msg = body.message || body.error_description || msg;
    } catch (_) { /* ignore */ }
    throw new ApiError(response.status, msg);
  }

  return response;
}

// ── LinkedIn API endpoints ────────────────────────────────

/**
 * GET /v2/userinfo (via Worker proxy)
 * Returns: { sub, name, given_name, family_name, picture, email, email_verified, locale }
 */
export async function getUserInfo() {
  const res = await apiFetch(`${PROXY_BASE}/userinfo`);
  return res.json();
}

/**
 * GET LinkedIn OIDC discovery document (via Worker proxy — public, no token required)
 * Returns the OpenID Connect configuration metadata
 */
export async function getOidcDiscovery() {
  const res = await fetch(`${OIDC_PROXY_BASE}/.well-known/openid-configuration`);
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return res.json();
}

/**
 * GET LinkedIn JWKS — public signing keys (via Worker proxy — no token required)
 */
export async function getJwks() {
  const res = await fetch(`${OIDC_PROXY_BASE}/openid/jwks`);
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return res.json();
}

/**
 * POST /v2/ugcPosts (via Worker proxy)
 * @param {string} text       — Post body (max 3000 chars)
 * @param {string} authorSub  — LinkedIn member sub from userinfo
 */
export async function createTextPost(text, authorSub) {
  const body = {
    author:         `urn:li:person:${authorSub}`,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary:    { text: text.trim() },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const res = await apiFetch(`${PROXY_BASE}/ugcPosts`, {
    method: 'POST',
    body:   JSON.stringify(body),
  });

  const postUrn = res.headers.get('X-RestLi-Id') || res.headers.get('x-restli-id') || '';
  return { postUrn };
}

/**
 * Build a shareable LinkedIn post URL from a ugcPost URN.
 */
export function getPostUrl(postUrn) {
  if (!postUrn) return 'https://www.linkedin.com/feed/';
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`;
}

// ── Image upload flow ─────────────────────────────────────

/**
 * Step 1: Register an image upload with LinkedIn.
 * Returns { uploadUrl, assetUrn }
 */
export async function registerUpload(authorSub) {
  const res = await apiFetch(`${PROXY_BASE}/assets?action=registerUpload`, {
    method: 'POST',
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner:   `urn:li:person:${authorSub}`,
        serviceRelationships: [{
          relationshipType: 'OWNER',
          identifier:       'urn:li:userGeneratedContent',
        }],
      },
    }),
  });
  const data = await res.json();
  const mechanism = data?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'];
  const uploadUrl = mechanism?.uploadUrl;
  const assetUrn  = data?.value?.asset;
  if (!uploadUrl || !assetUrn) throw new ApiError(500, 'Invalid registerUpload response from LinkedIn.');
  return { uploadUrl, assetUrn };
}

/**
 * Step 2: Upload image binary directly to LinkedIn's CDN upload URL.
 * The upload URL is returned by registerUpload and goes directly to LinkedIn's
 * storage — no Worker proxy needed.
 */
export async function uploadImageBinary(uploadUrl, blob) {
  const token = getToken();
  if (!token) throw new AuthError('Not authenticated.');
  const res = await fetch(uploadUrl, {
    method:  'POST',
    headers: {
      'Authorization':             `Bearer ${token}`,
      'Content-Type':              blob.type || 'application/octet-stream',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: blob,
  });
  if (!res.ok) {
    let msg = `Image upload failed: HTTP ${res.status}`;
    try { const b = await res.json(); msg = b.message || msg; } catch (_) { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  return true;
}

/**
 * Step 3: Create a LinkedIn post with one or more image asset URNs.
 */
export async function createImagePost(text, authorSub, assetUrns) {
  const media = assetUrns.map(urn => ({
    status: 'READY',
    media:  urn,
    title:  { text: '' },
  }));

  const body = {
    author:         `urn:li:person:${authorSub}`,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary:    { text: text.trim() },
        shareMediaCategory: 'IMAGE',
        media,
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const res = await apiFetch(`${PROXY_BASE}/ugcPosts`, {
    method: 'POST',
    body:   JSON.stringify(body),
  });

  const postUrn = res.headers.get('X-RestLi-Id') || res.headers.get('x-restli-id') || '';
  return { postUrn };
}
