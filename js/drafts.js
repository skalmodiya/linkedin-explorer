// drafts.js — Drafts drawer: list, autosave, load, delete
import * as db from './db.js';
import { isServerAvailable } from './db.js';

let _activeDraftId  = null;
let _autosaveTimer  = null;
let _serverOnline   = false;
let _getState       = null;
let _setState       = null;

// ── Public init ───────────────────────────────────────────────

export async function initDrafts(getComposerState, setComposerState) {
  _getState = getComposerState;
  _setState = setComposerState;

  _serverOnline = await isServerAvailable();

  // Open drawer
  document.getElementById('btn-open-drafts')?.addEventListener('click', openDrawer);
  document.getElementById('btn-drafts-close')?.addEventListener('click', closeDrawer);
  document.getElementById('drawer-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'drawer-overlay') closeDrawer();
  });

  // Manual save
  document.getElementById('btn-save-draft')?.addEventListener('click', async () => {
    if (!_serverOnline) return;
    const state = _getState();
    if (!state.content.trim()) return;
    const saved = await db.saveDraft({ id: _activeDraftId, ...state });
    if (saved?.id) _activeDraftId = saved.id;
    renderDraftsList();
  });

  // Delete all drafts
  document.getElementById('btn-delete-all-drafts')?.addEventListener('click', async () => {
    if (!_serverOnline) return;
    const drafts = await db.getDrafts();
    if (!drafts.length) return;
    if (!confirm(`Delete all ${drafts.length} draft${drafts.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    await db.deleteAllDrafts();
    _activeDraftId = null;
    renderDraftsList();
  });

  // Autosave on textarea input
  document.getElementById('post-text')?.addEventListener('input', scheduleAutosave);
}

function scheduleAutosave() {
  if (!_serverOnline) return;
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(async () => {
    const state = _getState();
    if (!state.content || state.content.trim().length < 20) return;
    const saved = await db.saveDraft({ id: _activeDraftId, ...state });
    if (saved?.id && !_activeDraftId) {
      _activeDraftId = saved.id;
      renderDraftsList();
    }
  }, 3000);
}

// Reset active draft ID when a post is published
export function clearActiveDraft() {
  _activeDraftId = null;
}

export function getActiveDraftId() {
  return _activeDraftId;
}

// ── Drawer open/close ─────────────────────────────────────────

function openDrawer() {
  const el = document.getElementById('drawer-overlay');
  if (el) {
    el.hidden = false;
    renderDraftsList();
  }
}

function closeDrawer() {
  const el = document.getElementById('drawer-overlay');
  if (el) el.hidden = true;
}

// ── Render list ───────────────────────────────────────────────

async function renderDraftsList() {
  const container = document.getElementById('drafts-list');
  if (!container) return;

  if (!_serverOnline) {
    container.innerHTML = `
      <div class="server-offline-notice">
        <i class="ph ph-plug"></i>
        Local server not running.<br>
        Start with <code>node server.js</code> to enable drafts.
      </div>`;
    return;
  }

  const drafts = await db.getDrafts();

  const deleteAllBtn = document.getElementById('btn-delete-all-drafts');
  if (deleteAllBtn) deleteAllBtn.hidden = drafts.length === 0;

  if (!drafts.length) {
    container.innerHTML = `<p class="drafts-empty">No drafts yet. Start typing to auto-save.</p>`;
    return;
  }

  container.innerHTML = drafts.map(d => `
    <div class="draft-card ${d.id === _activeDraftId ? 'draft-card--active' : ''}" data-id="${d.id}">
      <div class="draft-card-body">
        <div class="draft-card-title-row">
          <span class="draft-title">${escHtml(d.title || '(untitled)')}</span>
          ${d.posted_at ? `<span class="draft-posted-badge"><i class="ph ph-check-circle"></i> Posted</span>` : ''}
        </div>
        <span class="draft-meta">${relativeTime(d.updated_at)}</span>
      </div>
      <button class="btn-icon draft-delete" data-id="${d.id}" title="Delete draft" aria-label="Delete draft">
        <i class="ph ph-trash"></i>
      </button>
    </div>
  `).join('');

  // Load on card click
  container.querySelectorAll('.draft-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.draft-delete')) return;
      const id = parseInt(card.dataset.id, 10);
      await loadDraft(id);
      closeDrawer();
    });
  });

  // Delete buttons
  container.querySelectorAll('.draft-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id, 10);
      await db.deleteDraft(id);
      if (_activeDraftId === id) _activeDraftId = null;
      renderDraftsList();
    });
  });
}

async function loadDraft(id) {
  const draft = await db.getDraft(id);
  if (!draft) return;

  _activeDraftId = id;
  _setState({
    content:  draft.content  || '',
    topic:    draft.topic    || '',
    category: draft.category || '',
    tone:     draft.tone     || '',
  });

  // Switch to Compose tab
  document.querySelector('[role="tab"][data-tab="compose"]')?.click();
}

// ── Utilities ─────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relativeTime(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString + 'Z').getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
