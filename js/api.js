// api.js — LinkedIn API calls
import { getToken } from './auth.js';

const API_BASE = 'https://api.linkedin.com/v2';

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
      Authorization:              `Bearer ${token}`,
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
      msg = body.message || body.error_description || body.serviceErrorCode
           ? `${body.message || body.error_description} (code ${body.serviceErrorCode || response.status})`
           : msg;
    } catch (_) { /* ignore JSON parse error */ }
    throw new ApiError(response.status, msg);
  }

  return response;
}

// ── LinkedIn API endpoints ────────────────────────────────

/**
 * GET /v2/userinfo — OpenID Connect profile
 * Returns: { sub, name, given_name, family_name, picture, email, email_verified, locale }
 */
export async function getUserInfo() {
  const res = await apiFetch(`${API_BASE}/userinfo`);
  return res.json();
}

/**
 * POST /v2/ugcPosts — Create a text post
 * @param {string} text  — Post body (max 3000 chars)
 * @param {string} authorSub — LinkedIn member sub (from userinfo.sub)
 * Returns: { postUrn } — The URN of the created post
 */
export async function createTextPost(text, authorSub) {
  const body = {
    author:         `urn:li:person:${authorSub}`,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: text.trim() },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const res = await apiFetch(`${API_BASE}/ugcPosts`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  // LinkedIn returns 201 with X-RestLi-Id header containing the post URN
  const postUrn = res.headers.get('X-RestLi-Id') || res.headers.get('x-restli-id') || '';
  return { postUrn };
}

/**
 * Derive a shareable LinkedIn URL from a ugcPost URN.
 * e.g. "urn:li:ugcPost:1234567890" → "https://www.linkedin.com/feed/update/urn:li:ugcPost:1234567890/"
 */
export function getPostUrl(postUrn) {
  if (!postUrn) return 'https://www.linkedin.com/feed/';
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`;
}
