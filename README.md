# LinkedIn API Explorer

A browser-based tool to log in with your LinkedIn account, compose and publish posts with full rich-text editing, and explore everything LinkedIn's free API allows — all from a clean, responsive UI.

**Live App:** https://skalmodiya.github.io/linkedin-explorer/

---

## Features

### Composer
- **Rich text editor** — Bold, Italic, Underline, Bullet lists, Headings, inline Links via `contenteditable` + `execCommand`
- **Bottom toolbar** with labeled icons — all actions directly accessible, no hidden menus:
  - **Emoji** — searchable grid of 150+ emojis, inserted at cursor position
  - **Count** — word, character and line count toast
  - **Copy** — copy post text to clipboard
  - **Paste** — paste clipboard content as plain text
  - **Clear** — clear the editor (with confirmation)
- **Character counter** — live 0 / 3000 with warn/danger states
- **Autosave drafts** — editor content auto-saved every 3 seconds to local SQLite via Node server; force-saved instantly on Generate to avoid duplicates

### Drafts
- Saved automatically while typing (3 s debounce); also force-saved immediately when AI generates content
- Visible in the **Drafts tab** directly below the composer — no drawer needed
- Click **Edit** on any draft card to load it back into the editor (restores category, tone and topic too)
- **Delete individual drafts** or **Delete all** with confirmation
- Drafts that have been posted show a green **Posted** badge
- Auto-switches to Drafts tab when AI generates content; switches to My Posts tab after a successful post

### AI Post Generation (optional — requires local LLM proxy)
- **Multi-provider** — Anthropic Claude, OpenAI GPT, Google Gemini, LiteLLM
- **Live model loading** — fetches available models from the proxy at runtime; falls back to static list
- **AI Settings modal** — API Key → Provider → Model flow; provider unlocks once key is entered
- **Active config badge** — selected provider and model shown in the panel header
- **15 categories** — Thought Leadership, Job/Career Update, Hot Take/Opinion, Case Study, Hiring, Gratitude, and more
- **12 tones** — Professional, Storytelling, Bold & Direct, Data-driven, Motivational, and more
- **Reset button** — clears Category, Tone and Topic back to defaults in one click
- **Topic suggestions popup** — click ✨ Suggest to get 5 AI-generated topic ideas based on Category + Tone; optionally seed with your own free-text idea; draggable and resizable. Click **More ideas** to load 5 additional unique ideas (previously shown ideas are passed to the LLM so it never repeats); the list grows and is scrollable
- **Regenerate with feedback** — provide notes and regenerate without losing the original

### My Posts (inline feed)
- Published posts appear **directly below the Create Post box**, styled like a LinkedIn feed — no tab switching needed
- Auto-refreshes immediately after every publish
- Each card shows timestamp, category/tone badges, post preview with expand/collapse, **Edit & repost** (loads back into the editor), and **View on LinkedIn**
- Only posts published via the Post button appear here — drafts are excluded

### Post History
- Every post published from the app is stored locally and shown in the **History** tab
- **Expand/collapse** long posts (preview truncated at 200 characters)
- **Edit & repost** — loads the post back into the composer and switches to the Compose tab
- **Copy** — copies the post text to clipboard
- **View on LinkedIn** — opens the post directly on LinkedIn

### API Explorer
- `GET /v2/userinfo` — name, email, picture, locale, sub (OpenID Connect)
- `GET /.well-known/openid-configuration` — OIDC discovery document
- `GET /oauth/openid/jwks` — LinkedIn's public signing keys

### General
- **Dark / Light theme** — toggle anytime, preference saved locally
- **Prompt templates** — save and reuse Category + Tone + Topic combinations
- **AI generation history** — browse past generations, reload any into editor
- **Fully responsive** — adapts from wide desktop to narrow mobile

---

## Architecture

```
Browser
  │  1. Click "Sign in with LinkedIn"
  │  2. Opens OAuth popup
  │                                    LinkedIn OAuth Server
  │  3. LinkedIn redirects to ──────►  Cloudflare Worker (/callback)
  │                                      • exchanges code for token
  │                                      • client secret stays here only
  │  4. Worker redirects back ◄────────  with token in URL fragment (#)
  │
  │  5. App reads token from fragment, validates state nonce, clears URL
  │  6. LinkedIn API calls ───────────► Cloudflare Worker (/api/*)
  │                                        • proxies to api.linkedin.com
  │                                        • adds CORS headers
  │  7. LinkedIn API response ◄──────────  returned to browser
  │
  │  8. LLM API calls ─────────────────► Node local server (/llm/*)
  │                                        • CORS proxy to port 6655
  │                                        • key never sent to Cloudflare
  │  9. Drafts / History / Templates ──► Node local server (/api/*)
  │                                        • SQLite via sql.js (no native deps)
```

- **Client Secret** lives only in Cloudflare Worker's encrypted environment variables — never in any file or commit
- **Token** stored in `sessionStorage` only — cleared when tab closes
- **LLM API keys** stored in `localStorage` only — never sent to Cloudflare or any remote server

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Pure HTML, CSS, Vanilla JS (ES Modules) — no build step |
| Icons | Phosphor Icons via jsDelivr CDN |
| OAuth Proxy | Cloudflare Worker (free tier) |
| Local Server | Node.js (stdlib only) — CORS proxy + SQLite REST API |
| Local DB | sql.js (pure-WASM SQLite, no native compilation) |
| LLM Proxy | Any OpenAI-compatible proxy on `localhost:6655` |
| Hosting | GitHub Pages (auto-deploy via GitHub Actions) |

---

## Project Structure

```
├── index.html                   # Single-page app
├── config.js                    # CLIENT_ID + WORKER_URL (edit this)
├── server.js                    # Local dev server: static files + LLM proxy + SQLite API
├── css/
│   └── style.css                # Dark/light theme, responsive layout
├── js/
│   ├── app.js                   # Main logic, routing, event wiring
│   ├── auth.js                  # OAuth 2.0 flow, state nonce, token lifecycle
│   ├── api.js                   # LinkedIn API calls via Worker proxy
│   ├── llm.js                   # LLM provider abstraction (Anthropic/OpenAI/Gemini/LiteLLM)
│   ├── db.js                    # REST client for local SQLite server
│   ├── drafts.js                # Autosave drafts to local SQLite server
│   ├── composer-extras.js       # Emoji picker, toolbar button handlers
│   └── ui.js                    # Toast, theme, modal helpers
├── worker/
│   ├── index.js                 # Cloudflare Worker — OAuth + LinkedIn API + OIDC proxy
│   └── wrangler.toml            # Worker configuration
└── .github/workflows/
    └── deploy.yml               # Auto-deploy to GitHub Pages on push to main
```

---

## Local Development

### Prerequisites

- [Git](https://git-scm.com/)
- [Node.js 18+](https://nodejs.org/)
- An LLM proxy running on `localhost:6655` (e.g. LiteLLM, Local Hai, Ollama with OpenAI-compatible API) — only needed for AI features

### Clone the repository

```bash
git clone https://github.com/skalmodiya/linkedin-explorer.git
cd linkedin-explorer
```

### Install dependencies

```bash
npm install
```

> This installs `sql.js` (pure-WASM SQLite — no native compilation needed). There are no other runtime dependencies.

### Start the local server

```bash
node server.js
```

You should see:

```
  LinkedIn Explorer  →  http://localhost:5173

  LLM proxy   /llm/* → http://localhost:6655/*
  SQLite API  /api/*
  Database    /path/to/linkedin_local.db
```

Open **http://localhost:5173** in your browser.

> ⚠️ Do **not** open `index.html` directly — it must be served via `localhost:5173` for OAuth redirects and the LLM proxy to work.

The local server handles:
- Static file serving for the app
- LLM CORS proxy (`/llm/*` → `localhost:6655/*`) — bridges browser requests to your local LLM proxy
- REST API for drafts, AI history, templates, and post history (`/api/*`)
- All data stored locally in `linkedin_local.db` in the project root

### AI Setup (in-app)

1. Make sure your LLM proxy is running on `localhost:6655`
2. Open the app at **http://localhost:5173** and sign in
3. Click **⚙ Settings** in the Generate with AI panel
4. Paste your API key — the Provider dropdown unlocks automatically
5. Select a Provider — the Model list loads live from your proxy
6. Pick a model and click **Save & Use**

---

## Setting Up Your Own Instance

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
cd worker
npm install
npx wrangler login
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
npx wrangler secret put LINKEDIN_CLIENT_SECRET
# paste your LinkedIn Client Secret when prompted
```

Deploy:
```bash
npx wrangler deploy
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
git add .
git commit -m "Configure for my instance"
git push
```

Then in your GitHub repo → **Settings → Pages → Source → GitHub Actions**.

Your app will be live at `https://YOUR_USERNAME.github.io/linkedin-explorer/`

---

## Security

| Concern | How it's handled |
|---|---|
| Client Secret | Encrypted in Cloudflare Worker env vars — never in any file or commit |
| CSRF | 128-bit random state nonce validated before token is accepted |
| Token in URL | In URL fragment (`#`) only — never sent to any server; cleared immediately |
| Token storage | `sessionStorage` — cleared when tab closes |
| Cross-origin messages | `postMessage` origin-pinned and type-checked |
| LinkedIn API calls | Proxied through Cloudflare Worker — never called directly from browser |
| LLM API keys | `localStorage` only — never sent to Cloudflare or any remote server |

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

**AI Generate button does nothing / 400 error**
→ Open AI Settings, re-enter your API key — the model list will reload from the proxy. Check the browser console or Node server terminal for the specific error from the proxy.

**`ERR_CONNECTION_REFUSED` on `/llm/*` calls**
→ The local Node server is not running. Start it with `node server.js` — the app must be opened via `http://localhost:5173`, not by opening `index.html` directly. The LLM proxy on port 6655 must also be running separately.

**Drafts not saving / not loading**
→ The local Node server must be running (`node server.js`). Drafts are stored in `linkedin_local.db` in the project root.

**Post history empty**
→ History is stored locally — only posts published through this app appear here. LinkedIn's API does not allow fetching your existing posts without Partner Program access.

---

## License

MIT — free to use for learning, personal projects, or as a starting point.
