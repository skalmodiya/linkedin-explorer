// db.js — Browser REST client for local server SQLite API
// All calls silently return null / [] when server is unavailable (GitHub Pages mode)

const SERVER = 'http://localhost:5173';

async function apiFetch(method, path, body) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${SERVER}${path}`, opts);
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

export async function isServerAvailable() {
  try {
    const res = await fetch(`${SERVER}/api/drafts`, { method: 'GET', signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch (_) {
    return false;
  }
}

// ── Drafts ────────────────────────────────────────────────────

export async function getDrafts() {
  return await apiFetch('GET', '/api/drafts') || [];
}

export async function getDraft(id) {
  return await apiFetch('GET', `/api/drafts/${id}`);
}

export async function saveDraft({ id, content, topic, category, tone }) {
  if (id) {
    return await apiFetch('PUT', `/api/drafts/${id}`, { content, topic, category, tone });
  }
  return await apiFetch('POST', '/api/drafts', { content, topic, category, tone });
}

export async function deleteDraft(id) {
  return await apiFetch('DELETE', `/api/drafts/${id}`);
}

export async function markDraftPosted(id) {
  return await apiFetch('PATCH', `/api/drafts/${id}/posted`);
}

export async function deleteAllDrafts() {
  const drafts = await getDrafts();
  await Promise.all(drafts.map(d => apiFetch('DELETE', `/api/drafts/${d.id}`)));
}

// ── AI Generation History ─────────────────────────────────────

export async function saveAiHistory({ topic, category, tone, provider, model, feedback, content }) {
  return await apiFetch('POST', '/api/history', { topic, category, tone, provider, model, feedback, content });
}

export async function getAiHistory() {
  return await apiFetch('GET', '/api/history') || [];
}

// ── Prompt Templates ──────────────────────────────────────────

export async function saveTemplate({ name, topic, category, tone }) {
  return await apiFetch('POST', '/api/templates', { name, topic, category, tone });
}

export async function getTemplates() {
  return await apiFetch('GET', '/api/templates') || [];
}

export async function deleteTemplate(id) {
  return await apiFetch('DELETE', `/api/templates/${id}`);
}

// ── Post History ──────────────────────────────────────────────

export async function savePostHistory({ postUrn, content, topic, category, tone }) {
  return await apiFetch('POST', '/api/posts', { postUrn, content, topic, category, tone });
}

export async function getPostHistory() {
  return await apiFetch('GET', '/api/posts') || [];
}
