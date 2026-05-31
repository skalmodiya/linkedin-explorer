// drafts.js — Autosave drafts to local SQLite server
import * as db from './db.js';
import { isServerAvailable } from './db.js';

let _activeDraftId = null;
let _autosaveTimer = null;
let _serverOnline  = false;
let _getState      = null;

export async function initDrafts(getComposerState) {
  _getState = getComposerState;
  _serverOnline = await isServerAvailable();

  // Autosave on editor input
  document.getElementById('post-text')?.addEventListener('input', scheduleAutosave);
}

function scheduleAutosave() {
  if (!_serverOnline) return;
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => saveNow(), 3000);
}

// Force-save immediately (called after Generate so the draft exists before tab switch)
export async function saveNow() {
  if (!_serverOnline || !_getState) return;
  // Cancel any pending debounced save to prevent a duplicate write
  clearTimeout(_autosaveTimer);
  const state = _getState();
  if (!state.content || state.content.trim().length < 20) return;
  const saved = await db.saveDraft({ id: _activeDraftId, ...state });
  if (saved?.id) _activeDraftId = saved.id;
}

export function clearActiveDraft() {
  _activeDraftId = null;
}

export function getActiveDraftId() {
  return _activeDraftId;
}
