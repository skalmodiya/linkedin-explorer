// config.js — Edit these two values before deploying.
// CLIENT_ID is public (visible in browser). The secret lives only in the Cloudflare Worker.
export const CONFIG = {
  // From LinkedIn Developer Portal → Your App → Auth tab
  CLIENT_ID: '77hwnt06muw9wv',

  // The Cloudflare Worker URL you deployed (no trailing slash)
  WORKER_URL: 'https://linkedin-oauth-proxy.skk9210.workers.dev',

  // LinkedIn OAuth scopes — do not change unless you add extra products
  SCOPES: 'openid profile email w_member_social',
};
