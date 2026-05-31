// server.js — Local dev server: static files + LLM CORS proxy + SQLite REST API
// Usage:  node server.js          (default port 5173)
//         PORT=8080 node server.js

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT     = parseInt(process.env.PORT  || '5173', 10);
const LLM_HOST = process.env.LLM_HOST || 'localhost';
const LLM_PORT = parseInt(process.env.LLM_PORT || '6655', 10);
const DB_FILE  = path.join(__dirname, 'linkedin_local.db');

// ── sql.js (pure-WASM SQLite, no native compilation needed) ──

let db  = null;
let SQL = null;

async function initDb() {
  try {
    SQL = await require('sql.js')();
    if (fs.existsSync(DB_FILE)) {
      const buf = fs.readFileSync(DB_FILE);
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS drafts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT,
        content    TEXT NOT NULL,
        topic      TEXT,
        category   TEXT,
        tone       TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        posted_at  TEXT DEFAULT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        topic      TEXT,
        category   TEXT,
        tone       TEXT,
        provider   TEXT,
        model      TEXT,
        feedback   TEXT,
        content    TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS templates (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        topic      TEXT,
        category   TEXT,
        tone       TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS post_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        post_urn   TEXT,
        content    TEXT NOT NULL,
        topic      TEXT,
        category   TEXT,
        tone       TEXT,
        posted_at  TEXT DEFAULT (datetime('now'))
      );
    `);
    // Migrate existing DBs that pre-date posted_at column
    try { db.run('ALTER TABLE drafts ADD COLUMN posted_at TEXT DEFAULT NULL'); } catch (_) {}
    persist();
    console.log(`SQLite ready: ${DB_FILE}`);
  } catch (e) {
    console.warn('sql.js init failed:', e.message, '\nRun: npm install');
    db = null;
  }
}

function persist() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
  } catch (e) {
    console.warn('DB persist failed:', e.message);
  }
}

// Run a SELECT and return array of plain objects
function dbAll(sql, params = []) {
  if (!db) return [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Run an INSERT/UPDATE/DELETE, persist, return last insert rowid
function dbRun(sql, params = []) {
  if (!db) return null;
  db.run(sql, params);
  persist();
  const r = db.exec('SELECT last_insert_rowid() as id');
  return r[0]?.values?.[0]?.[0] ?? null;
}

// ── CORS headers ──────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta',
};

function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

// ── Helpers ───────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function jsonResp(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(body);
}

function draftTitle(content) {
  const s = (content || '').trim();
  return s.slice(0, 60) + (s.length > 60 ? '…' : '');
}

// ── Static file serving ───────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

function serveStatic(req, res, filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

function resolveStatic(pathname) {
  const rel  = decodeURIComponent(pathname.replace(/^\/+/, ''));
  const full = path.join(__dirname, rel);
  if (!full.startsWith(__dirname)) return null;
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    return path.join(full, 'index.html');
  }
  return fs.existsSync(full) ? full : null;
}

// ── LLM CORS proxy ────────────────────────────────────────────

function proxyLlm(req, res, targetPath, body) {
  const options = {
    hostname: LLM_HOST,
    port:     LLM_PORT,
    path:     targetPath,
    method:   req.method,
    headers: {
      'Content-Type':      req.headers['content-type']     || 'application/json',
      'Authorization':     req.headers['authorization']     || '',
      'x-api-key':         req.headers['x-api-key']         || '',
      'anthropic-version': req.headers['anthropic-version'] || '',
      'anthropic-beta':    req.headers['anthropic-beta']    || '',
      'Content-Length':    Buffer.byteLength(body),
    },
  };

  console.log(`[LLM proxy] ${req.method} ${targetPath} → ${LLM_HOST}:${LLM_PORT}`);

  const proxy = http.request(options, (upstream) => {
    const chunks = [];
    upstream.on('data', c => chunks.push(c));
    upstream.on('end', () => {
      const responseBody = Buffer.concat(chunks);
      if (upstream.statusCode >= 400) {
        console.log(`[LLM proxy] ← ${upstream.statusCode}: ${responseBody.toString().slice(0, 500)}`);
      }
      res.writeHead(upstream.statusCode, {
        'Content-Type': upstream.headers['content-type'] || 'application/json',
        ...CORS_HEADERS,
      });
      res.end(responseBody);
    });
  });

  proxy.on('error', (err) => {
    console.log(`[LLM proxy] connection error: ${err.message}`);
    jsonResp(res, 502, { error: 'LLM proxy error', message: err.message });
  });

  proxy.write(body);
  proxy.end();
}

function proxyLlmGet(req, res, targetPath) {
  const options = {
    hostname: LLM_HOST,
    port:     LLM_PORT,
    path:     targetPath,
    method:   'GET',
    headers: {
      'Authorization': req.headers['authorization'] || '',
      'x-api-key':     req.headers['x-api-key']     || '',
    },
  };

  console.log(`[LLM proxy GET] ${targetPath} → ${LLM_HOST}:${LLM_PORT}`);

  const proxy = http.request(options, (upstream) => {
    const chunks = [];
    upstream.on('data', c => chunks.push(c));
    upstream.on('end', () => {
      const responseBody = Buffer.concat(chunks);
      if (upstream.statusCode >= 400) {
        console.log(`[LLM proxy GET] ← ${upstream.statusCode}: ${responseBody.toString().slice(0, 300)}`);
      }
      res.writeHead(upstream.statusCode, {
        'Content-Type': upstream.headers['content-type'] || 'application/json',
        ...CORS_HEADERS,
      });
      res.end(responseBody);
    });
  });

  proxy.on('error', (err) => {
    console.log(`[LLM proxy GET] connection error: ${err.message}`);
    jsonResp(res, 502, { error: 'LLM proxy error', message: err.message });
  });

  proxy.end();
}

function handleApi(req, res, method, pathname, body) {
  if (!db) {
    jsonResp(res, 503, { error: 'Database not available. Run npm install.' });
    return;
  }

  let parsed = {};
  if (body.length) {
    try { parsed = JSON.parse(body.toString()); } catch (_) { /* ignore */ }
  }

  // ── Drafts ──────────────────────────────────────
  if (pathname === '/api/drafts' && method === 'GET') {
    jsonResp(res, 200, dbAll('SELECT id, title, topic, category, tone, created_at, updated_at, posted_at FROM drafts ORDER BY updated_at DESC'));
    return;
  }
  if (pathname === '/api/drafts' && method === 'POST') {
    const { content, topic, category, tone } = parsed;
    if (!content) { jsonResp(res, 400, { error: 'content required' }); return; }
    const title = draftTitle(content);
    const id = dbRun(
      "INSERT INTO drafts (title, content, topic, category, tone) VALUES (?, ?, ?, ?, ?)",
      [title, content, topic ?? null, category ?? null, tone ?? null]
    );
    jsonResp(res, 201, { id, title, content, topic, category, tone });
    return;
  }
  const draftM = pathname.match(/^\/api\/drafts\/(\d+)$/);
  if (draftM) {
    const id = parseInt(draftM[1], 10);
    if (method === 'GET') {
      const rows = dbAll('SELECT * FROM drafts WHERE id=?', [id]);
      if (!rows.length) { jsonResp(res, 404, { error: 'not found' }); return; }
      jsonResp(res, 200, rows[0]);
      return;
    }
    if (method === 'PUT') {
      const { content, topic, category, tone } = parsed;
      if (!content) { jsonResp(res, 400, { error: 'content required' }); return; }
      const title = draftTitle(content);
      dbRun("UPDATE drafts SET title=?, content=?, topic=?, category=?, tone=?, updated_at=datetime('now') WHERE id=?",
        [title, content, topic ?? null, category ?? null, tone ?? null, id]);
      jsonResp(res, 200, { id, title, content, topic, category, tone });
      return;
    }
    if (method === 'DELETE') {
      dbRun('DELETE FROM drafts WHERE id=?', [id]);
      jsonResp(res, 200, { deleted: id });
      return;
    }
  }
  const draftPostedM = pathname.match(/^\/api\/drafts\/(\d+)\/posted$/);
  if (draftPostedM && method === 'PATCH') {
    const id = parseInt(draftPostedM[1], 10);
    dbRun("UPDATE drafts SET posted_at=datetime('now') WHERE id=?", [id]);
    jsonResp(res, 200, { id, posted: true });
    return;
  }

  // ── AI History ──────────────────────────────────
  if (pathname === '/api/history' && method === 'GET') {
    jsonResp(res, 200, dbAll('SELECT * FROM ai_history ORDER BY created_at DESC LIMIT 50'));
    return;
  }
  if (pathname === '/api/history' && method === 'POST') {
    const { topic, category, tone, provider, model, feedback, content } = parsed;
    if (!content) { jsonResp(res, 400, { error: 'content required' }); return; }
    const id = dbRun(
      'INSERT INTO ai_history (topic, category, tone, provider, model, feedback, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [topic ?? null, category ?? null, tone ?? null, provider ?? null, model ?? null, feedback ?? null, content]
    );
    jsonResp(res, 201, { id });
    return;
  }

  // ── Templates ───────────────────────────────────
  if (pathname === '/api/templates' && method === 'GET') {
    jsonResp(res, 200, dbAll('SELECT * FROM templates ORDER BY created_at DESC'));
    return;
  }
  if (pathname === '/api/templates' && method === 'POST') {
    const { name, topic, category, tone } = parsed;
    if (!name) { jsonResp(res, 400, { error: 'name required' }); return; }
    const id = dbRun(
      'INSERT INTO templates (name, topic, category, tone) VALUES (?, ?, ?, ?)',
      [name, topic ?? null, category ?? null, tone ?? null]
    );
    jsonResp(res, 201, { id, name, topic, category, tone });
    return;
  }
  const tplM = pathname.match(/^\/api\/templates\/(\d+)$/);
  if (tplM && method === 'DELETE') {
    dbRun('DELETE FROM templates WHERE id=?', [parseInt(tplM[1], 10)]);
    jsonResp(res, 200, { deleted: parseInt(tplM[1], 10) });
    return;
  }

  // ── Post History ─────────────────────────────────
  if (pathname === '/api/posts' && method === 'GET') {
    jsonResp(res, 200, dbAll('SELECT * FROM post_history ORDER BY posted_at DESC LIMIT 100'));
    return;
  }
  if (pathname === '/api/posts' && method === 'POST') {
    const { postUrn, content, topic, category, tone } = parsed;
    if (!content) { jsonResp(res, 400, { error: 'content required' }); return; }
    const id = dbRun(
      'INSERT INTO post_history (post_urn, content, topic, category, tone) VALUES (?, ?, ?, ?, ?)',
      [postUrn ?? null, content, topic ?? null, category ?? null, tone ?? null]
    );
    jsonResp(res, 201, { id });
    return;
  }

  jsonResp(res, 404, { error: 'Unknown API route' });
}

// ── Main request handler ──────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsed   = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const method   = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // LLM proxy: /llm/* → strip /llm, forward to localhost:6655
  if (pathname.startsWith('/llm/')) {
    const targetPath = pathname.slice(4) + (parsed.search ? parsed.search : '');
    const body = await readBody(req);
    if (method === 'GET') {
      proxyLlmGet(req, res, targetPath);
    } else {
      proxyLlm(req, res, targetPath, body);
    }
    return;
  }

  // REST API
  if (pathname.startsWith('/api/')) {
    const body = await readBody(req);
    handleApi(req, res, method, pathname, body);
    return;
  }

  // Static files / SPA fallback
  const filePath = resolveStatic(pathname === '/' ? '/index.html' : pathname);
  if (filePath) {
    serveStatic(req, res, filePath);
  } else {
    serveStatic(req, res, path.join(__dirname, 'index.html'));
  }
});

initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`\n  LinkedIn Explorer  →  http://localhost:${PORT}\n`);
    console.log(`  LLM proxy   /llm/* → http://${LLM_HOST}:${LLM_PORT}/*`);
    console.log(`  SQLite API  /api/*`);
    console.log(`  Database    ${DB_FILE}\n`);
  });
});
