# LinkedIn API Explorer

A pure client-side web app that lets you log in with your LinkedIn account and explore everything LinkedIn's **free API** allows — view your profile, create posts, and inspect live API responses.

**Live App:** https://skalmodiya.github.io/linkedin-explorer/

---

## Features

- **Sign in with LinkedIn** — OAuth 2.0, no passwords stored
- **Profile card** — name, avatar, email, verified badge, locale
- **Post composer** — create text posts up to 3000 characters
- **Live API Explorer** — run real LinkedIn API calls and see raw JSON responses
- **Token Info** — inspect your session token details
- **Dark / Light theme** — toggle anytime, preference saved locally
- **Fully responsive** — works on desktop and mobile
- **No data stored** — token lives in `sessionStorage` only, cleared when tab closes

---

## What the free LinkedIn API allows

| Feature | Endpoint | Scope |
|---|---|---|
| Sign in with LinkedIn | OAuth 2.0 + OpenID Connect | `openid` |
| Profile (name, photo, email) | `GET /v2/userinfo` | `profile`, `email` |
| Create a text post | `POST /v2/ugcPosts` | `w_member_social` |

---

## Architecture

```
Browser  ──────────────────────────────────────────────────────────────
  │  1. Click "Sign in with LinkedIn"
  │  2. Redirect to LinkedIn OAuth
  │                                    LinkedIn OAuth Server
  │  3. LinkedIn redirects to ──────►  Cloudflare Worker (/callback)
  │                                      • exchanges code for token
  │                                      • client secret stays here only
  │  4. Worker redirects back ◄────────  with token in URL fragment (#)
  │
  │  5. App reads token from fragment, validates state nonce, clears URL
  │  6. All API calls go via ──────────► Cloudflare Worker (/api/*)
  │                                        • proxies to api.linkedin.com
  │                                        • adds CORS headers
  │  7. LinkedIn API response ◄──────────  returned to browser
```

- **Client Secret** lives only in Cloudflare Worker's encrypted environment variables — never in any file or commit
- **Token** stored in `sessionStorage` only — cleared when tab closes, never sent to any server except the Worker proxy

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Pure HTML, CSS, Vanilla JS (ES Modules) — no build tools |
| Icons | Phosphor Icons via jsDelivr CDN |
| OAuth Proxy | Cloudflare Worker (free tier) |
| Hosting | GitHub Pages (auto-deploy via GitHub Actions) |

---

## Project Structure

```
├── index.html                   # Single-page app — 4 screens
├── config.js                    # YOUR CLIENT_ID + WORKER_URL (edit this)
├── css/
│   └── style.css                # Dark/light theme, responsive layout
├── js/
│   ├── app.js                   # Main logic, routing, event wiring
│   ├── auth.js                  # OAuth 2.0 flow, state nonce, token lifecycle
│   ├── api.js                   # LinkedIn API calls via Worker proxy
│   └── ui.js                    # Toast notifications, profile rendering, theme
├── worker/
│   ├── index.js                 # Cloudflare Worker — OAuth + API proxy
│   └── wrangler.toml            # Worker configuration
└── .github/workflows/
    └── deploy.yml               # Auto-deploy to GitHub Pages on push to main
```

---

## Setting Up Your Own Instance

Want to run this with your own LinkedIn app? Follow these steps.

### Prerequisites

- [LinkedIn account](https://linkedin.com)
- [Cloudflare account](https://cloudflare.com) (free)
- [GitHub account](https://github.com)
- Node.js 18+ (for Wrangler CLI)

---

### Step 1 — Create a LinkedIn Developer App

1. Go to **https://www.linkedin.com/developers/apps/new**
2. Fill in App name, LinkedIn Page, logo, and accept the agreement
3. Open the **Products** tab and request access to:
   - **Sign In with LinkedIn using OpenID Connect**
   - **Share on LinkedIn**
4. Open the **Auth** tab and note your **Client ID** and **Client Secret**

---

### Step 2 — Deploy the Cloudflare Worker

```bash
npm install -g wrangler
cd worker
wrangler login
```

Edit `worker/wrangler.toml`:
```toml
LINKEDIN_CLIENT_ID  = "your_client_id"
APP_ORIGIN          = "https://YOUR_GITHUB_USERNAME.github.io"
APP_PATH            = "linkedin-explorer"
WORKER_CALLBACK_URL = "https://YOUR_WORKER.workers.dev/callback"
```

Store the secret (never in any file):
```bash
wrangler secret put LINKEDIN_CLIENT_SECRET
# paste your LinkedIn Client Secret when prompted
```

Deploy:
```bash
wrangler deploy
# note the Worker URL it prints
```

---

### Step 3 — Register the Callback URL in LinkedIn

In LinkedIn Developer Portal → your app → **Auth** tab → **OAuth 2.0 Redirect URLs**, add:
```
https://YOUR_WORKER.workers.dev/callback
```

---

### Step 4 — Configure the Frontend

Edit `config.js`:
```js
export const CONFIG = {
  CLIENT_ID:  'your_linkedin_client_id',
  WORKER_URL: 'https://your-worker.workers.dev',
  SCOPES:     'openid profile email w_member_social',
};
```

---

### Step 5 — Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/linkedin-explorer.git
git push -u origin main
```

Then in your GitHub repo → **Settings → Pages → Source → GitHub Actions**.

Your app will be live at `https://YOUR_USERNAME.github.io/linkedin-explorer/`

---

## Security

| Concern | How it's handled |
|---|---|
| Client Secret | Encrypted in Cloudflare Worker env vars — never in any file |
| CSRF | 128-bit random state nonce validated before token is accepted |
| Token in URL | In URL fragment (`#`) only — never sent to any server; cleared immediately |
| Token storage | `sessionStorage` — cleared when tab closes |
| Cross-origin messages | `postMessage` origin-pinned, type-checked |
| API calls | Proxied through Worker — LinkedIn API never called directly from browser |

---

## Troubleshooting

**"App not configured yet"**
→ Edit `config.js` with your real `CLIENT_ID` and `WORKER_URL`

**"Redirect URI mismatch" from LinkedIn**
→ Add `https://YOUR_WORKER.workers.dev/callback` to LinkedIn App → Auth → OAuth 2.0 Redirect URLs

**"token_exchange_failed"**
→ Re-run `wrangler secret put LINKEDIN_CLIENT_SECRET` and verify `WORKER_CALLBACK_URL` in `wrangler.toml` exactly matches the LinkedIn redirect URI

**Post fails with 403**
→ Ensure **Share on LinkedIn** product is added and approved in LinkedIn Developer Portal → Products tab

---

## License

MIT — free to use for learning, personal projects, or as a starting point.
