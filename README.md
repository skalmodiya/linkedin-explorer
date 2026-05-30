# LinkedIn API Explorer

A pure client-side web app that lets you log in with your LinkedIn account and explore everything LinkedIn's **free API** allows — view your profile, create posts, and inspect live API responses.

- No server, no database, no registration
- Your access token lives only in your browser's `sessionStorage` (cleared when you close the tab)
- Runs locally **and** on GitHub Pages
- Modern dark/light responsive UI

---

## What you can do with the free LinkedIn API

| Feature | LinkedIn API | Scope |
|---|---|---|
| Sign in with LinkedIn | OAuth 2.0 + OpenID Connect | `openid` |
| View profile (name, photo, email) | `GET /v2/userinfo` | `profile`, `email` |
| Create a text post | `POST /v2/ugcPosts` | `w_member_social` |
| Live API explorer | All of the above | — |

---

## Prerequisites

You need accounts on three free services:

1. **LinkedIn** — to create a Developer App
2. **Cloudflare** — to deploy the OAuth proxy Worker (free tier, 100k req/day)
3. **GitHub** — to host the app on GitHub Pages

---

## Step 1 — Create a LinkedIn Developer App

1. Go to **[linkedin.com/developers/apps/new](https://www.linkedin.com/developers/apps/new)**
2. Fill in:
   - **App name**: e.g. "LinkedIn API Explorer"
   - **LinkedIn Page**: associate with your personal or company page (required)
   - **App logo**: upload any square image (required)
   - **Legal agreement**: tick the checkbox
3. Click **Create app**

4. Open the **Products** tab on your new app:
   - Click **Request access** on **Sign In with LinkedIn using OpenID Connect** → approve
   - Click **Request access** on **Share on LinkedIn** → approve
   - Both should become "Added" within a few seconds (no review required)

5. Open the **Auth** tab:
   - Note your **Client ID** (public — you'll put this in `config.js`)
   - Note your **Client Secret** (private — you'll put this in the Cloudflare Worker only)
   - Under **OAuth 2.0 Redirect URLs**, click the pencil icon and add:
     ```
     https://YOUR_WORKER_NAME.YOUR_SUBDOMAIN.workers.dev/callback
     ```
     *(You'll fill in the real URL after Step 2. Come back here.)*

---

## Step 2 — Deploy the Cloudflare Worker (OAuth proxy)

The Cloudflare Worker exchanges the authorization code for an access token server-side, keeping your Client Secret out of the browser.

### 2a — Install Wrangler CLI

```bash
npm install -g wrangler
```

*(Requires Node.js 18+. If you don't have Node, download it from [nodejs.org](https://nodejs.org).)*

### 2b — Log in to Cloudflare

```bash
wrangler login
```

A browser tab opens — sign in or create a free account.

### 2c — Edit `worker/wrangler.toml`

Open `worker/wrangler.toml` in a text editor and replace the placeholder values:

```toml
[vars]
LINKEDIN_CLIENT_ID = "YOUR_ACTUAL_CLIENT_ID"      # from LinkedIn Auth tab
APP_ORIGIN         = "https://yourname.github.io" # your GitHub Pages root URL
APP_PATH           = "linkedin-explorer"          # your repo name (or "" if root Pages)
WORKER_CALLBACK_URL = "https://linkedin-oauth-proxy.yoursubdomain.workers.dev/callback"
```

> **How to find `APP_PATH`:** If your app will live at `https://alice.github.io/linkedin-explorer/`, then `APP_PATH = "linkedin-explorer"`.  
> If it lives at `https://alice.github.io/` (your `alice.github.io` repo), then `APP_PATH = ""`.

> **How to find `WORKER_CALLBACK_URL`:** After you run `wrangler deploy` (step 2e) for the first time, Cloudflare prints the Worker URL. It will look like `https://linkedin-oauth-proxy.alice.workers.dev`. The callback URL is that URL + `/callback`.  
> For the **first** deploy, put a placeholder — then update it and redeploy.

### 2d — Set the Client Secret (encrypted, never in files)

```bash
cd worker
wrangler secret put LINKEDIN_CLIENT_SECRET
```

Paste your LinkedIn **Client Secret** when prompted. It is encrypted and stored in Cloudflare — it is never written to disk.

### 2e — Deploy the Worker

```bash
cd worker
wrangler deploy
```

Cloudflare prints a URL like:
```
https://linkedin-oauth-proxy.alice.workers.dev
```

**Copy this URL.**

### 2f — Update `wrangler.toml` with the real Worker URL

Now that you have the Worker URL, go back to `worker/wrangler.toml` and set:

```toml
WORKER_CALLBACK_URL = "https://linkedin-oauth-proxy.alice.workers.dev/callback"
```

Run `wrangler deploy` again.

### 2g — Add the callback URL to LinkedIn

Go back to your LinkedIn Developer App → **Auth** tab → **OAuth 2.0 Redirect URLs** and add:
```
https://linkedin-oauth-proxy.alice.workers.dev/callback
```

Save.

---

## Step 3 — Configure the frontend

Edit **`config.js`** in the project root:

```js
export const CONFIG = {
  CLIENT_ID:  'YOUR_ACTUAL_CLIENT_ID',                                      // LinkedIn Auth tab
  WORKER_URL: 'https://linkedin-oauth-proxy.alice.workers.dev',             // no /callback at end
  SCOPES:     'openid profile email w_member_social',
};
```

---

## Step 4 — Deploy to GitHub Pages

### 4a — Create a GitHub repository

1. Go to **[github.com/new](https://github.com/new)**
2. Name it `linkedin-explorer` (or whatever you prefer)
3. Set it to **Public**
4. Do **not** initialize with a README (you already have files)

### 4b — Push your code

```bash
cd /path/to/LinkedIn
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/linkedin-explorer.git
git push -u origin main
```

### 4c — Enable GitHub Pages

1. Go to your repo on GitHub
2. Click **Settings** → **Pages** (left sidebar)
3. Under **Source**, select **GitHub Actions**
4. That's it — the workflow in `.github/workflows/deploy.yml` runs automatically on every push

Your app will be live at:
```
https://YOUR_USERNAME.github.io/linkedin-explorer/
```

*(The first deployment takes ~1-2 minutes.)*

---

## Step 5 — Add GitHub Pages URL to LinkedIn (optional but recommended)

For completeness, you can also add your GitHub Pages URL to the LinkedIn App's **OAuth 2.0 Redirect URLs** list — but only the Worker's `/callback` URL actually receives the OAuth redirect. The GitHub Pages URL receives the redirect *from the Worker*, not from LinkedIn.

---

## Local Development

You can open `index.html` directly in your browser:

```bash
# Simple: just open in browser
open index.html        # macOS
start index.html       # Windows
xdg-open index.html    # Linux
```

> **Note:** The OAuth flow will only work if you have configured `config.js` and deployed the Cloudflare Worker. LinkedIn requires HTTPS redirect URIs, so you can't test the full login flow from `file://` — you'd need a local HTTPS server (e.g., `npx serve .` with an ngrok tunnel).

---

## Security Notes

| Concern | How it's handled |
|---|---|
| Client Secret exposure | Lives only in Cloudflare Worker's encrypted env vars |
| CSRF attacks | 128-bit random state nonce validated before token is accepted |
| Token in URL | Placed in the URL **fragment** (`#`), never sent to any server; cleared immediately from address bar |
| Token persistence | `sessionStorage` only — cleared when you close the tab |
| Cross-origin messages | `postMessage` is origin-pinned and type-checked |
| Token logging | Worker strips `refresh_token`; never logs access tokens |

---

## Troubleshooting

**"App not configured yet" error**  
→ Edit `config.js` and set your real `CLIENT_ID` and `WORKER_URL`.

**"Redirect URI mismatch" from LinkedIn**  
→ Make sure the Worker's `/callback` URL is registered under OAuth 2.0 Redirect URLs in the LinkedIn Developer Portal. The URL must exactly match, including the path.

**"token_exchange_failed" error**  
→ Check that `LINKEDIN_CLIENT_SECRET` was set correctly (`wrangler secret put LINKEDIN_CLIENT_SECRET`).  
→ Check that `WORKER_CALLBACK_URL` in `wrangler.toml` exactly matches the redirect URI registered in LinkedIn.

**Profile photo not loading**  
→ LinkedIn CDN images may be blocked by some content blockers. The app falls back to an initial-based avatar automatically.

**Post fails with 403**  
→ Make sure your LinkedIn app has the **Share on LinkedIn** product added and approved in the Products tab.

**Post fails with "Not enough permissions"**  
→ The user's LinkedIn account must have the `w_member_social` scope granted. Try logging out and logging in again to re-authorize.

---

## Project Structure

```
├── index.html                  # Single-page app shell
├── config.js                   # Your CLIENT_ID and WORKER_URL (edit this)
├── css/
│   └── style.css               # All styles — dark/light theme, responsive
├── js/
│   ├── app.js                  # Main logic, routing, event wiring
│   ├── auth.js                 # OAuth flow, state nonce, token lifecycle
│   ├── api.js                  # LinkedIn API calls
│   └── ui.js                   # DOM helpers, toasts, profile rendering
├── worker/
│   ├── index.js                # Cloudflare Worker (token exchange proxy)
│   └── wrangler.toml           # Worker configuration
└── .github/workflows/
    └── deploy.yml              # Auto-deploy to GitHub Pages
```

---

## LinkedIn API Free Tier Reference

### Scopes

| Scope | What it allows |
|---|---|
| `openid` | Required for OpenID Connect |
| `profile` | Name, photo |
| `email` | Primary email address |
| `w_member_social` | Create posts, comments, reactions |

### Endpoints Used

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `https://api.linkedin.com/v2/userinfo` | Profile: name, photo, email |
| `POST` | `https://api.linkedin.com/v2/ugcPosts` | Create a text post |

---

## License

MIT — use freely for learning, personal projects, or as a starting point.
