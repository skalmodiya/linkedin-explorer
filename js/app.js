// app.js — Main entry point, event wiring, screen routing
import { CONFIG } from '../config.js';
import * as auth   from './auth.js';
import * as api    from './api.js';
import * as ui     from './ui.js';
import * as llm    from './llm.js';
import * as db     from './db.js';
import { initDrafts, clearActiveDraft, getActiveDraftId } from './drafts.js';
import { initEmojiPicker, initTagPeople, initMoreOptions, initCarousel, initSchedulePost } from './composer-extras.js';

// Expose auth helpers for ui.js (avoids circular imports)
window.__liAuth = { getExpiryDate: auth.getExpiryDate };

// If this page is running inside the OAuth popup, send the token
// to the opener and close — don't run the full app.
(function handlePopupReturn() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const token = params.get('token');
  const state = params.get('state');
  const error = params.get('error');

  // Only act if we're actually in a popup with an opener
  if (!window.opener || window.opener === window) return;

  if (token && state) {
    window.opener.postMessage({
      type:       'LI_AUTH_SUCCESS',
      token,
      state,
      expires_in: parseInt(params.get('expires_in') || '0', 10),
    }, window.location.origin);
  } else if (error) {
    window.opener.postMessage({
      type:  'LI_AUTH_ERROR',
      error: params.get('error_description') || error,
    }, window.location.origin);
  }

  // Close popup after posting message
  setTimeout(() => window.close(), 300);
})();

document.addEventListener('DOMContentLoaded', () => {
  // ── Init theme + UI ──────────────────────────────────────
  ui.initTheme();
  ui.initTabs();

  // ── Theme toggles (header + floating) ────────────────────
  ['btn-theme', 'btn-theme-login'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', ui.toggleTheme);
  });

  // ── Error screen buttons ──────────────────────────────────
  document.getElementById('btn-retry')?.addEventListener('click', () => {
    ui.showScreen('screen-login');
  });
  document.getElementById('btn-back-login')?.addEventListener('click', () => {
    auth.logout();
    ui.showScreen('screen-login');
  });

  // ── Config guard ─────────────────────────────────────────
  if (
    CONFIG.CLIENT_ID === 'YOUR_LINKEDIN_CLIENT_ID' ||
    CONFIG.WORKER_URL === 'https://your-worker-name.your-subdomain.workers.dev'
  ) {
    ui.showScreen('screen-error');
    document.getElementById('error-message').innerHTML =
      'App not configured yet.<br><br>' +
      'Edit <code>config.js</code> and set your LinkedIn <code>CLIENT_ID</code> and Cloudflare Worker URL.<br><br>' +
      'See <strong>README.md</strong> for setup instructions.';
    document.getElementById('btn-retry').style.display = 'none';
    return;
  }

  // ── Global auth event listeners ───────────────────────────
  window.addEventListener('li:auth-success', () => {
    ui.setLoadingMessage('Loading your profile…');
    ui.showScreen('screen-loading');
    loadProfile();
  });

  window.addEventListener('li:auth-error', (e) => {
    ui.showError(e.detail?.message || 'Authentication failed.');
  });

  window.addEventListener('li:token-expired', () => {
    auth.logout();
    ui.showScreen('screen-login');
    ui.showToast('Your session expired. Please sign in again.', 'warning');
  });

  // ── Check for OAuth callback in URL fragment ──────────────
  const callbackResult = auth.handleCallback();
  if (callbackResult === 'success') {
    ui.setLoadingMessage('Loading your profile…');
    ui.showScreen('screen-loading');
    loadProfile();
    return;
  }
  if (callbackResult === 'error') {
    // li:auth-error event was fired by auth.js
    return;
  }

  // ── Check for existing valid session ──────────────────────
  if (auth.getToken()) {
    ui.setLoadingMessage('Loading your profile…');
    ui.showScreen('screen-loading');
    loadProfile();
    return;
  }

  // ── Default: show login ───────────────────────────────────
  ui.showScreen('screen-login');

  document.getElementById('btn-login')?.addEventListener('click', () => {
    ui.setLoadingMessage('Connecting to LinkedIn…');
    ui.showScreen('screen-loading');
    auth.startLogin();
  });
});

// ── Load profile and render dashboard ──────────────────────

async function loadProfile() {
  try {
    const userInfo = await api.getUserInfo();
    auth.setUserSub(userInfo.sub);
    ui.renderProfile(userInfo);
    ui.showScreen('screen-profile');

    // Show header logout button
    document.getElementById('btn-logout')?.removeAttribute('hidden');

    // Wire up post composer
    initComposer(userInfo.sub);

    // Wire up API explorer
    initApiExplorer();

    // Wire up post history tab
    initPostHistory();

    // Wire up AI history + templates modals
    initAiHistoryModal();
    initTemplatesModal();

    // Wire up logout buttons
    ['btn-logout', 'btn-revoke'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', handleLogout);
    });

    // Token info tab
    const expEl = document.getElementById('token-expiry');
    if (expEl) {
      const d = auth.getExpiryDate();
      expEl.textContent = d ? d.toLocaleString() : '—';
    }
    ui.updateTokenPreview();

  } catch (err) {
    if (err.name === 'AuthError') {
      ui.showScreen('screen-login');
      ui.showToast(err.message, 'error');
    } else {
      ui.showError(err.message);
    }
  }
}

// ── Plain-text extractor for contenteditable ────────────────
// Walks the DOM tree and converts HTML structure to plain text:
// <br> → newline, block-level elements get a leading newline, text nodes pass through.

function getPlainText(el) {
  const BLOCK_TAGS = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','PRE','TR']);
  let result = '';
  let lastWasBlock = false;

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent;
      lastWasBlock = false;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toUpperCase();

    if (tag === 'BR') {
      result += '\n';
      lastWasBlock = true;
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && result.length > 0 && !lastWasBlock) {
      result += '\n';
    }

    for (const child of node.childNodes) {
      walk(child);
    }

    if (isBlock && !lastWasBlock) {
      result += '\n';
      lastWasBlock = true;
    }
  }

  walk(el);
  // Trim trailing newline added by the outermost block
  return result.replace(/\n+$/, '');
}

// ── Selection save/restore (for link popover) ────────────────

let _savedRange = null;

function saveSelectionRange() {
  const sel = window.getSelection();
  _savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
}

function restoreSelectionRange() {
  if (!_savedRange) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(_savedRange);
}

// ── Composer ────────────────────────────────────────────────

function initComposer(authorSub) {
  const editor  = document.getElementById('post-text');
  const postBtn = document.getElementById('btn-post');

  // Char counter: contenteditable fires 'input' events just like textarea
  // ui.initCharCounter expects an element with .value; we swap in a custom approach
  initEditorCharCounter(editor);

  ui.hidePostResult();

  postBtn?.addEventListener('click', async () => {
    const text = getPlainText(editor).trim();
    if (!text) return;

    postBtn.disabled = true;
    postBtn.dataset.loading = 'true';
    postBtn.textContent = 'Posting…';

    try {
      let postUrn;
      const result = await api.createTextPost(text, authorSub);
      postUrn = result.postUrn;

      ui.showPostResult(postUrn);
      ui.showToast('Post published successfully!', 'success');

      // Save to post history
      db.savePostHistory({
        postUrn,
        content:  text,
        topic:    _lastGenTopic,
        category: _lastGenCategory,
        tone:     _lastGenTone,
      });

      // Mark the source draft as posted (if one was active)
      const draftId = getActiveDraftId();
      if (draftId) db.markDraftPosted(draftId);

      // Clear editor
      editor.innerHTML = '';
      editor.dispatchEvent(new Event('input'));
      document.getElementById('char-counter')?.classList.remove('warn', 'danger');
      postBtn.disabled = true;
      document.getElementById('ai-regen-bar').hidden = true;
      clearActiveDraft();

      // Refresh history tab + inline feed, switch to My Posts tab
      initPostHistory();
      await renderMyPostsFeed();
      switchToPostsTab();
    } catch (err) {
      ui.showToast(err.message, 'error', 7000);
    } finally {
      postBtn.dataset.loading = 'false';
      postBtn.textContent = 'Post';
      postBtn.disabled = !getPlainText(editor).trim();
    }
  });

  // Drafts integration
  const getComposerState = () => ({
    content:  getPlainText(editor),
    topic:    document.getElementById('ai-topic')?.value    || '',
    category: document.getElementById('ai-category')?.value || '',
    tone:     document.getElementById('ai-tone')?.value     || '',
  });

  const setComposerState = ({ content, topic, category, tone }) => {
    if (editor) {
      editor.innerHTML = escHtml(content).replace(/\n/g, '<br>');
      editor.dispatchEvent(new Event('input'));
      editor.focus();
    }
    const topicEl    = document.getElementById('ai-topic');
    const categoryEl = document.getElementById('ai-category');
    const toneEl     = document.getElementById('ai-tone');
    if (topicEl    && topic)    topicEl.value    = topic;
    if (categoryEl && category) categoryEl.value = category;
    if (toneEl     && tone)     toneEl.value     = tone;
    const genBtn = document.getElementById('btn-ai-generate');
    if (genBtn) genBtn.disabled = !topicEl?.value?.trim();
    ui.hidePostResult();
    document.getElementById('ai-regen-bar').hidden = true;
  };

  initDrafts(getComposerState);
  initFormattingToolbar(editor);

  // Composer extras
  const getEditor = () => document.getElementById('post-text');
  initEmojiPicker(getEditor);
  initTagPeople(getEditor);
  initMoreOptions(getEditor);
  initCarousel();
  initSchedulePost();

  // Wire AI settings modal + generation panel
  initAiSettings();
  initAiPanel();

  // Render inline post feed below composer
  renderMyPostsFeed();
}

// ── Editor char counter ───────────────────────────────────────
// Replaces ui.initCharCounter (which was written for <textarea>)

function initEditorCharCounter(editor) {
  if (!editor) return;
  const MAX = 3000;

  function update() {
    const len    = getPlainText(editor).length;
    const count  = document.getElementById('char-count');
    const counter = document.getElementById('char-counter');
    const postBtn = document.getElementById('btn-post');

    if (count)  count.textContent = len;
    if (counter) {
      counter.classList.toggle('warn',   len > 2700 && len <= MAX);
      counter.classList.toggle('danger', len > MAX);
    }
    if (postBtn) postBtn.disabled = len === 0 || len > MAX;
  }

  editor.addEventListener('input', update);
  update();
}

// ── Formatting toolbar ────────────────────────────────────────

function initFormattingToolbar(editor) {
  const toolbar    = document.getElementById('composer-format-toolbar');
  const linkPopover = document.getElementById('link-popover');
  if (!toolbar) return;

  toolbar.addEventListener('mousedown', (e) => {
    // Prevent toolbar clicks from blurring the editor
    e.preventDefault();
  });

  toolbar.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      editor.focus();

      if (cmd === 'heading') {
        // Toggle between h3 and normal paragraph
        const current = document.queryCommandValue('formatBlock');
        document.execCommand('formatBlock', false, current === 'h3' ? 'p' : 'h3');
      } else if (cmd === 'link') {
        saveSelectionRange();
        showLinkPopover(editor);
        return;
      } else {
        document.execCommand(cmd, false, null);
      }

      editor.dispatchEvent(new Event('input'));
      updateToolbarState();
    });
  });

  // Update active states when selection changes
  document.addEventListener('selectionchange', updateToolbarState);

  function updateToolbarState() {
    toolbar.querySelectorAll('.fmt-btn').forEach(btn => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'heading') {
        btn.classList.toggle('active', document.queryCommandValue('formatBlock') === 'h3');
      } else if (cmd === 'link') {
        // no active state for link
      } else {
        try {
          btn.classList.toggle('active', document.queryCommandState(cmd));
        } catch (_) { /* some commands throw when no selection */ }
      }
    });
  }

  // ── Link popover ──────────────────────────────────────────

  function showLinkPopover(editor) {
    if (!linkPopover) return;
    const input     = document.getElementById('link-popover-url');
    const insertBtn = document.getElementById('btn-link-insert');
    const cancelBtn = document.getElementById('btn-link-cancel');

    if (input) input.value = '';
    linkPopover.hidden = false;
    input?.focus();

    function doInsert() {
      const url = input?.value?.trim();
      if (url) {
        restoreSelectionRange();
        editor.focus();
        document.execCommand('createLink', false, url);
        // Make link open in new tab: find the newly created <a>
        editor.querySelectorAll('a').forEach(a => {
          if (!a.target) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        });
        editor.dispatchEvent(new Event('input'));
      }
      linkPopover.hidden = true;
      cleanup();
    }

    function doCancel() {
      linkPopover.hidden = true;
      cleanup();
    }

    function onKeydown(e) {
      if (e.key === 'Enter') { e.preventDefault(); doInsert(); }
      if (e.key === 'Escape') doCancel();
    }

    function cleanup() {
      insertBtn?.removeEventListener('click', doInsert);
      cancelBtn?.removeEventListener('click', doCancel);
      input?.removeEventListener('keydown', onKeydown);
    }

    insertBtn?.addEventListener('click', doInsert);
    cancelBtn?.addEventListener('click', doCancel);
    input?.addEventListener('keydown', onKeydown);
  }
}

// ── AI Settings Modal ────────────────────────────────────────

function initAiSettings() {
  const modal          = document.getElementById('modal-ai-settings');
  const providerSelect = document.getElementById('ai-provider-select');
  const modelSelect    = document.getElementById('ai-model-select');
  const keyInput       = document.getElementById('ai-apikey-input');
  const eyeIcon        = document.getElementById('apikey-eye-icon');
  const statusEl       = document.getElementById('ai-status');
  const modelLoading   = document.getElementById('model-loading');
  const modelHint      = document.getElementById('model-hint');
  const providerHint   = document.getElementById('provider-hint');

  // Populate provider dropdown (always all options, but starts disabled)
  ui.populateSelect(
    providerSelect,
    llm.getProviderList().map(p => ({ value: p.id, label: p.label })),
    llm.getConfig().provider
  );

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className   = `ai-status ai-status--${isError ? 'error' : 'info'}`;
    statusEl.hidden      = !msg;
  }

  async function loadModels(provider, apiKey) {
    modelSelect.disabled = true;
    modelSelect.innerHTML = '<option>Loading…</option>';
    if (modelLoading) modelLoading.hidden = false;
    if (modelHint)    modelHint.hidden    = true;
    setStatus('');

    const models = await llm.fetchLiveModels(provider, apiKey);

    if (modelLoading) modelLoading.hidden = true;
    if (modelHint)    modelHint.hidden    = false;

    const savedModel = llm.getConfig().provider === provider ? llm.getConfig().model : '';
    ui.populateSelect(
      modelSelect,
      models.map(m => ({ value: m, label: m })),
      savedModel || models[0] || ''
    );
    modelSelect.disabled = models.length === 0;
    if (models.length === 0) {
      setStatus('Could not load models — check your API key.', true);
    }
  }

  function prefillForProvider(provider) {
    keyInput.value = llm.getKeyForProvider(provider);
    const key = keyInput.value.trim();
    if (key) {
      loadModels(provider, key);
    } else {
      modelSelect.disabled = true;
      modelSelect.innerHTML = '<option value="">— choose a provider first —</option>';
    }
    setStatus('');
  }

  // When key input changes: unlock provider if key is non-empty
  keyInput?.addEventListener('input', () => {
    const hasKey = keyInput.value.trim().length > 0;
    providerSelect.disabled = !hasKey;
    if (providerHint) providerHint.hidden = hasKey;
    if (hasKey) {
      loadModels(providerSelect.value, keyInput.value.trim());
    } else {
      modelSelect.disabled = true;
      modelSelect.innerHTML = '<option value="">— enter API key first —</option>';
    }
    setStatus('');
  });

  // Open modal from toolbar AI button
  ['btn-ai-settings-open', 'btn-ai-setup-link'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      const { provider } = llm.getConfig();
      providerSelect.value = provider;
      prefillForProvider(provider);
      // If key already set, provider is unlocked immediately
      const hasKey = keyInput.value.trim().length > 0;
      providerSelect.disabled = !hasKey;
      if (providerHint) providerHint.hidden = hasKey;
      ui.openModal('modal-ai-settings');
    });
  });

  // Provider change → reload models
  providerSelect?.addEventListener('change', () => {
    const key = keyInput.value.trim();
    if (key) {
      loadModels(providerSelect.value, key);
    }
  });

  // Show/hide API key
  document.getElementById('btn-apikey-toggle')?.addEventListener('click', () => {
    const isPassword = keyInput.type === 'password';
    keyInput.type = isPassword ? 'text' : 'password';
    eyeIcon.className = isPassword ? 'ph ph-eye-slash' : 'ph ph-eye';
  });

  // Close buttons
  ['btn-modal-close', 'btn-modal-cancel'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => ui.closeModal('modal-ai-settings'));
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) ui.closeModal('modal-ai-settings');
  });

  // Save
  document.getElementById('btn-modal-save')?.addEventListener('click', () => {
    const provider = providerSelect.value;
    const model    = modelSelect.value;
    const key      = keyInput.value.trim();

    if (!key) {
      setStatus('Please enter an API key.', true);
      keyInput.focus();
      return;
    }
    if (!model) {
      setStatus('Please select a model.', true);
      return;
    }

    llm.saveConfig(provider, model, key);
    ui.closeModal('modal-ai-settings');
    ui.showToast(`AI configured: ${provider} / ${model}`, 'success');
    showAiPanel(true);
  });
}

function updateAiProviderBadge() {
  const { provider, model } = llm.getConfig();
  const configEl    = document.getElementById('ai-active-config');
  const providerEl  = document.getElementById('ai-config-provider');
  const modelEl     = document.getElementById('ai-config-model');
  if (!configEl) return;
  const configured = !!(provider && model && llm.isConfigured());
  configEl.hidden = !configured;
  if (configured) {
    const label = llm.getProviderList().find(p => p.id === provider)?.label || provider;
    if (providerEl) providerEl.textContent = label;
    if (modelEl)    modelEl.textContent    = model;
  }
}

// ── Topic suggestions popup ───────────────────────────────────

function initTopicSuggestions() {
  const popup      = document.getElementById('topic-suggestions-popup');
  const suggestBtn = document.getElementById('btn-suggest-topics');
  const closeBtn   = document.getElementById('btn-suggestions-close');
  const refreshBtn = document.getElementById('btn-suggestions-refresh');
  const seedGo     = document.getElementById('btn-seed-suggest');
  const seedInput  = document.getElementById('topic-seed-input');
  const list       = document.getElementById('topic-suggestions-list');
  const hint       = document.getElementById('topic-suggestions-hint');
  const topicInput = document.getElementById('ai-topic');
  const genBtn     = document.getElementById('btn-ai-generate');
  if (!popup || !suggestBtn) return;

  // ── Drag to move ──────────────────────────────────────────
  const header = popup.querySelector('.topic-suggestions-header');
  let dragging = false, dragOffsetX = 0, dragOffsetY = 0;

  header?.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    const rect = popup.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    header.classList.add('topic-suggestions-header--dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = popup.offsetWidth,  ph = popup.offsetHeight;
    let left = Math.max(8, Math.min(e.clientX - dragOffsetX, vw - pw - 8));
    let top  = Math.max(8, Math.min(e.clientY - dragOffsetY, vh - ph - 8));
    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    header?.classList.remove('topic-suggestions-header--dragging');
  });

  // ── Helpers ───────────────────────────────────────────────
  let _allSuggestions = []; // accumulates across More Ideas clicks

  function getSelections() {
    return {
      category: document.getElementById('ai-category')?.value || 'Thought Leadership',
      tone:     document.getElementById('ai-tone')?.value     || 'Professional',
      freeText: seedInput?.value?.trim() || '',
    };
  }

  function positionPopup() {
    const anchor = suggestBtn.getBoundingClientRect();
    const vw = window.innerWidth;
    const popupWidth = Math.min(340, vw - 24);
    let left = anchor.right - popupWidth;
    if (left < 12) left = 12;
    popup.style.width = popupWidth + 'px';
    popup.style.left  = left + 'px';
    popup.style.top   = (anchor.bottom + 6) + 'px';
  }

  function openPopup() {
    popup.hidden = false;
    positionPopup();
    _allSuggestions = [];
    list.innerHTML = '';
    fetchSuggestions();
  }

  function closePopup() {
    popup.hidden = true;
  }

  async function fetchSuggestions() {
    const { category, tone, freeText } = getSelections();
    const isMore = _allSuggestions.length > 0;
    const label = freeText
      ? `Generating ideas based on your input…`
      : `Finding ${category} ideas with a ${tone} tone…`;
    hint.textContent = label;
    hint.hidden = false;
    if (refreshBtn) refreshBtn.disabled = true;
    if (seedGo)     seedGo.disabled     = true;

    if (!llm.isConfigured()) {
      hint.textContent = 'Set up your AI first (click Settings above).';
      if (refreshBtn) refreshBtn.disabled = false;
      if (seedGo)     seedGo.disabled     = false;
      return;
    }

    try {
      const topics = await llm.suggestTopics(category, tone, freeText, _allSuggestions);
      hint.hidden = true;

      // Append new items; don't clear existing ones
      const startIndex = _allSuggestions.length;
      topics.forEach((t, i) => {
        _allSuggestions.push(t);
        const li = document.createElement('li');
        li.className = 'topic-suggestion-item';
        if (i === 0 && isMore) li.classList.add('topic-suggestion-item--new');
        li.innerHTML = `<button class="topic-suggestion-btn" type="button">${escHtml(t)}</button>`;
        li.querySelector('button').addEventListener('click', () => {
          if (topicInput) {
            topicInput.value = t;
            topicInput.dispatchEvent(new Event('input'));
            topicInput.focus();
          }
          if (genBtn) genBtn.disabled = !t.trim();
          closePopup();
        });
        list.appendChild(li);
      });

      // Scroll the first new item into view when loading more
      if (isMore) {
        const newFirst = list.children[startIndex];
        if (newFirst) newFirst.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (err) {
      hint.textContent = `Error: ${err.message}`;
      hint.hidden = false;
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
      if (seedGo)     seedGo.disabled     = false;
    }
  }

  // ── Event wiring ──────────────────────────────────────────
  suggestBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!popup.hidden) { closePopup(); return; }
    openPopup();
  });

  closeBtn?.addEventListener('click', closePopup);
  refreshBtn?.addEventListener('click', fetchSuggestions);
  seedGo?.addEventListener('click', () => {
    // New seed = fresh context, start over
    _allSuggestions = [];
    list.innerHTML = '';
    fetchSuggestions();
  });

  // Ctrl+Enter / Enter (without shift) in seed input triggers fresh fetch
  seedInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _allSuggestions = [];
      list.innerHTML = '';
      fetchSuggestions();
    }
  });

  // Close on outside click (but not the seed input — it's inside the popup)
  document.addEventListener('click', (e) => {
    if (!popup.hidden && !popup.contains(e.target) && e.target !== suggestBtn) {
      closePopup();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popup.hidden) closePopup();
  });

  window.addEventListener('resize', () => {
    if (!popup.hidden) positionPopup();
  });
}

// ── AI Generation Panel ───────────────────────────────────────

// Tracks state for regeneration
let _lastGenTopic    = '';
let _lastGenCategory = '';
let _lastGenTone     = '';
let _lastGenContent  = '';

function showAiPanel(configured) {
  document.getElementById('ai-gen-panel').hidden    = !configured;
  document.getElementById('ai-setup-prompt').hidden = configured;
  updateAiProviderBadge();
}

function initAiPanel() {
  // Show correct state on init
  showAiPanel(llm.isConfigured());
  updateAiProviderBadge();

  const topicInput = document.getElementById('ai-topic');
  const genBtn     = document.getElementById('btn-ai-generate');

  // Enable Generate only when topic is non-empty
  topicInput?.addEventListener('input', () => {
    if (genBtn) genBtn.disabled = !topicInput.value.trim();
  });

  initTopicSuggestions();

  // Reset Category, Tone & Topic
  document.getElementById('btn-reset-ai-fields')?.addEventListener('click', () => {
    const categoryEl = document.getElementById('ai-category');
    const toneEl     = document.getElementById('ai-tone');
    if (categoryEl) categoryEl.selectedIndex = 0;
    if (toneEl)     toneEl.selectedIndex     = 0;
    if (topicInput) { topicInput.value = ''; topicInput.dispatchEvent(new Event('input')); }
  });

  // Generate button
  genBtn?.addEventListener('click', async () => {
    const topic    = topicInput?.value?.trim();
    const category = document.getElementById('ai-category')?.value || 'Thought Leadership';
    const tone     = document.getElementById('ai-tone')?.value    || 'Professional';

    if (!topic) return;

    ui.setLoading(genBtn, true, 'Generating…');
    try {
      const content = await llm.generatePost({ topic, category, tone });
      applyGeneratedContent(content);
      _lastGenTopic    = topic;
      _lastGenCategory = category;
      _lastGenTone     = tone;
      _lastGenContent  = content;
      document.getElementById('ai-regen-bar').hidden = false;
      document.getElementById('ai-regen-feedback').value = '';

      // Save to AI history
      const { provider, model } = llm.getConfig();
      db.saveAiHistory({ topic, category, tone, provider, model, feedback: '', content });

    } catch (err) {
      ui.showToast(err.message, 'error', 7000);
    } finally {
      ui.setLoading(genBtn, false);
    }
  });

  // Regenerate button
  document.getElementById('btn-ai-regen')?.addEventListener('click', async () => {
    const regenBtn = document.getElementById('btn-ai-regen');
    const feedback = document.getElementById('ai-regen-feedback')?.value?.trim() || '';

    ui.setLoading(regenBtn, true, 'Regenerating…');
    try {
      const content = await llm.generatePost({
        topic:       _lastGenTopic,
        category:    _lastGenCategory,
        tone:        _lastGenTone,
        prevContent: _lastGenContent,
        feedback,
      });
      applyGeneratedContent(content);
      _lastGenContent = content;
      document.getElementById('ai-regen-feedback').value = '';
      ui.showToast('Content regenerated!', 'success', 3000);

      // Save regeneration to AI history
      const { provider, model } = llm.getConfig();
      db.saveAiHistory({ topic: _lastGenTopic, category: _lastGenCategory, tone: _lastGenTone, provider, model, feedback, content });
    } catch (err) {
      ui.showToast(err.message, 'error', 7000);
    } finally {
      ui.setLoading(regenBtn, false);
    }
  });
}

function applyGeneratedContent(content) {
  const editor = document.getElementById('post-text');
  if (!editor) return;
  editor.innerHTML = escHtml(content).replace(/\n/g, '<br>');
  editor.dispatchEvent(new Event('input'));
  editor.focus();
  ui.hidePostResult();

  // Autosave will fire in 3 s — switch to Drafts tab now so it's visible
  renderMyPostsFeed().then(() => switchToDraftsTab());
}

// ── Inline My Posts Feed + Drafts tabs (below composer) ──────

let _feedTabsWired = false;

function wireFeedTabs() {
  if (_feedTabsWired) return;
  _feedTabsWired = true;
  document.getElementById('feed-tab-posts')?.addEventListener('click', switchToPostsTab);
  document.getElementById('feed-tab-drafts')?.addEventListener('click', switchToDraftsTab);
}

function switchToDraftsTab() {
  document.getElementById('feed-tab-drafts')?.classList.add('feed-tab--active');
  document.getElementById('feed-tab-posts')?.classList.remove('feed-tab--active');
  document.getElementById('my-posts-feed-list').hidden  = true;
  document.getElementById('my-drafts-feed-list').hidden = false;
  renderMyDraftsFeed();
}

function switchToPostsTab() {
  document.getElementById('feed-tab-posts')?.classList.add('feed-tab--active');
  document.getElementById('feed-tab-drafts')?.classList.remove('feed-tab--active');
  document.getElementById('my-posts-feed-list').hidden  = false;
  document.getElementById('my-drafts-feed-list').hidden = true;
}

function buildFeedCards(items, { dateField, contentField, getViewUrl, getActions, labelPosted }) {
  return items.map(item => {
    const full    = item[contentField] || '';
    const rawDate = item[dateField];
    const date    = rawDate ? new Date(rawDate + 'Z').toLocaleString() : '—';
    const hasMore = full.length > 200;
    const preview = full.slice(0, 200) + (hasMore ? '…' : '');
    const viewUrl = getViewUrl ? getViewUrl(item) : null;
    const postedBadge = labelPosted && item.posted_at
      ? `<span class="feed-posted-badge"><i class="ph ph-check-circle"></i> Posted</span>` : '';
    return `
      <div class="feed-card" data-id="${item.id}">
        <div class="feed-card-meta">
          <span class="feed-card-date"><i class="ph ph-clock"></i> ${date}</span>
          <div class="feed-card-badges">
            ${item.category ? `<span class="feed-badge">${escHtml(item.category)}</span>` : ''}
            ${item.tone     ? `<span class="feed-badge feed-badge--tone">${escHtml(item.tone)}</span>` : ''}
            ${postedBadge}
          </div>
        </div>
        <p class="feed-card-text" data-full="${escAttr(full)}" data-expanded="false">${escHtml(preview)}</p>
        ${hasMore ? `<button class="feed-card-expand btn-link" type="button">Show more</button>` : ''}
        <div class="feed-card-actions">
          ${getActions(item, full, viewUrl)}
        </div>
      </div>`;
  }).join('');
}

function wireExpandCollapse(container) {
  container.querySelectorAll('.feed-card-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const textEl  = btn.closest('.feed-card').querySelector('.feed-card-text');
      const expanded = textEl.dataset.expanded === 'true';
      textEl.textContent = expanded ? textEl.dataset.full.slice(0, 200) + '…' : textEl.dataset.full;
      textEl.dataset.expanded = expanded ? 'false' : 'true';
      btn.textContent = expanded ? 'Show more' : 'Show less';
    });
  });
}

function wireLoadIntoEditor(container) {
  container.querySelectorAll('.feed-card-load').forEach(btn => {
    btn.addEventListener('click', () => {
      const editor = document.getElementById('post-text');
      if (editor) {
        editor.innerHTML = escHtml(btn.dataset.content).replace(/\n/g, '<br>');
        editor.dispatchEvent(new Event('input'));
        editor.focus();
        editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      ui.showToast('Loaded into editor', 'success', 2000);
    });
  });
}

async function renderMyPostsFeed() {
  const feed   = document.getElementById('my-posts-feed');
  const listEl = document.getElementById('my-posts-feed-list');
  if (!feed || !listEl) return;

  const posts = await db.getPostHistory();
  const drafts = await db.getDrafts();
  const hasContent = posts.length > 0 || drafts.length > 0;

  if (!hasContent) { feed.hidden = true; return; }
  feed.hidden = false;
  wireFeedTabs();

  // Update Drafts tab badge count (unposted only)
  const unposted = drafts.filter(d => !d.posted_at).length;
  const draftsTab = document.getElementById('feed-tab-drafts');
  if (draftsTab) {
    draftsTab.innerHTML = `<i class="ph ph-file-text"></i> Drafts${unposted > 0 ? ` <span class="feed-tab-count">${unposted}</span>` : ''}`;
  }

  if (!posts.length) {
    listEl.innerHTML = `<p class="feed-empty">No posts yet — published posts will appear here.</p>`;
    return;
  }

  listEl.innerHTML = buildFeedCards(posts, {
    dateField:    'posted_at',
    contentField: 'content',
    getViewUrl:   p => p.post_urn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(p.post_urn)}/` : null,
    getActions:   (p, full, viewUrl) => `
      <button class="btn btn--ghost btn--xs feed-card-load" data-content="${escAttr(full)}" title="Load into editor">
        <i class="ph ph-pencil-simple"></i> Edit &amp; repost
      </button>
      ${viewUrl ? `<a class="btn btn--ghost btn--xs" href="${viewUrl}" target="_blank" rel="noopener">
        <i class="ph ph-arrow-square-out"></i> View on LinkedIn
      </a>` : ''}`,
  });
  wireExpandCollapse(listEl);
  wireLoadIntoEditor(listEl);
}

async function renderMyDraftsFeed() {
  const listEl = document.getElementById('my-drafts-feed-list');
  if (!listEl) return;

  const drafts = await db.getDrafts();

  if (!drafts.length) {
    listEl.innerHTML = `<p class="feed-empty">No drafts yet.</p>`;
    // Update tab badge
    const draftsTab = document.getElementById('feed-tab-drafts');
    if (draftsTab) draftsTab.innerHTML = `<i class="ph ph-file-text"></i> Drafts`;
    return;
  }

  // Delete All button header
  const deleteAllHtml = `
    <div class="feed-drafts-toolbar">
      <span class="feed-drafts-count">${drafts.length} draft${drafts.length !== 1 ? 's' : ''}</span>
      <button class="btn btn--ghost btn--xs btn--danger-ghost" id="feed-btn-delete-all-drafts">
        <i class="ph ph-trash"></i> Delete all
      </button>
    </div>`;

  listEl.innerHTML = deleteAllHtml + buildFeedCards(drafts, {
    dateField:    'updated_at',
    contentField: 'title',
    labelPosted:  true,
    getActions:   (d) => `
      <button class="btn btn--ghost btn--xs feed-draft-load" data-draft-id="${d.id}" title="Load into editor">
        <i class="ph ph-pencil-simple"></i> Edit
      </button>
      ${d.posted_at ? `<span class="feed-posted-label"><i class="ph ph-check-circle"></i> Already posted</span>` : ''}
      <button class="btn btn--ghost btn--xs btn--danger-ghost feed-draft-delete" data-draft-id="${d.id}" title="Delete draft" style="margin-left:auto">
        <i class="ph ph-trash"></i>
      </button>`,
  });

  wireExpandCollapse(listEl);

  // Delete individual draft
  listEl.querySelectorAll('.feed-draft-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.draftId, 10);
      await db.deleteDraft(id);
      await renderMyDraftsFeed();
      await renderMyPostsFeed(); // refresh tab badge count
    });
  });

  // Delete all drafts
  document.getElementById('feed-btn-delete-all-drafts')?.addEventListener('click', async () => {
    const count = drafts.length;
    if (!confirm(`Delete all ${count} draft${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    await db.deleteAllDrafts();
    await renderMyDraftsFeed();
    await renderMyPostsFeed();
  });

  // Load draft into editor on Edit click (fetches full content)
  listEl.querySelectorAll('.feed-draft-load').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id    = parseInt(btn.dataset.draftId, 10);
      const draft = await db.getDraft(id);
      if (!draft) return;
      const editor = document.getElementById('post-text');
      if (editor) {
        editor.innerHTML = escHtml(draft.content || '').replace(/\n/g, '<br>');
        editor.dispatchEvent(new Event('input'));
        editor.focus();
        editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      const catEl   = document.getElementById('ai-category');
      const toneEl  = document.getElementById('ai-tone');
      const topicEl = document.getElementById('ai-topic');
      if (catEl && draft.category)  catEl.value  = draft.category;
      if (toneEl && draft.tone)     toneEl.value  = draft.tone;
      if (topicEl && draft.topic) { topicEl.value = draft.topic; topicEl.dispatchEvent(new Event('input')); }
      ui.showToast('Draft loaded into editor', 'success', 2000);
    });
  });
}

// ── Post History Tab ──────────────────────────────────────────

async function initPostHistory() {
  const container = document.getElementById('post-history-list');
  if (!container) return;

  const posts = await db.getPostHistory();

  if (!posts.length) {
    container.innerHTML = `<p class="history-empty">No posts yet. Published posts will appear here.</p>`;
    return;
  }

  container.innerHTML = posts.map(p => {
    const full    = p.content || '';
    const preview = full.slice(0, 200) + (full.length > 200 ? '…' : '');
    const date    = p.posted_at ? new Date(p.posted_at + 'Z').toLocaleString() : '—';
    const viewUrl = p.post_urn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(p.post_urn)}/` : null;
    const hasMore = full.length > 200;
    return `
      <div class="post-history-card" data-id="${p.id}">
        <div class="post-history-header">
          <span class="post-history-date"><i class="ph ph-calendar-blank"></i> ${date}</span>
          <div class="post-history-badges">
            ${p.category ? `<span class="post-history-badge">${escHtml(p.category)}</span>` : ''}
            ${p.tone     ? `<span class="post-history-badge post-history-badge--tone">${escHtml(p.tone)}</span>` : ''}
          </div>
        </div>
        <p class="post-history-preview" data-full="${escAttr(full)}" data-expanded="false">${escHtml(preview)}</p>
        ${hasMore ? `<button class="btn-link post-history-expand" type="button">Show more</button>` : ''}
        <div class="post-history-actions">
          <button class="btn btn--ghost btn--xs post-history-load" data-content="${escAttr(full)}" title="Load into composer to edit and repost">
            <i class="ph ph-pencil-simple"></i> Edit &amp; repost
          </button>
          <button class="btn btn--ghost btn--xs post-history-copy" data-content="${escAttr(full)}" title="Copy post text">
            <i class="ph ph-copy"></i> Copy
          </button>
          ${viewUrl ? `<a class="btn btn--ghost btn--xs" href="${viewUrl}" target="_blank" rel="noopener" title="View on LinkedIn">
            <i class="ph ph-arrow-square-out"></i> View on LinkedIn
          </a>` : ''}
        </div>
      </div>`;
  }).join('');

  // Show more / show less
  container.querySelectorAll('.post-history-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const card    = btn.closest('.post-history-card');
      const preview = card.querySelector('.post-history-preview');
      const expanded = preview.dataset.expanded === 'true';
      if (expanded) {
        preview.textContent = preview.dataset.full.slice(0, 200) + '…';
        preview.dataset.expanded = 'false';
        btn.textContent = 'Show more';
      } else {
        preview.textContent = preview.dataset.full;
        preview.dataset.expanded = 'true';
        btn.textContent = 'Show less';
      }
    });
  });

  // Load into composer
  container.querySelectorAll('.post-history-load').forEach(btn => {
    btn.addEventListener('click', () => {
      const editor = document.getElementById('post-text');
      if (editor) {
        editor.innerHTML = escHtml(btn.dataset.content).replace(/\n/g, '<br>');
        editor.dispatchEvent(new Event('input'));
        editor.focus();
      }
      // Switch to Compose tab
      document.querySelector('[data-tab="compose"]')?.click();
      ui.showToast('Post loaded into composer', 'success', 2500);
    });
  });

  // Copy
  container.querySelectorAll('.post-history-copy').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.content);
        ui.showToast('Post text copied!', 'success', 2000);
      } catch (_) {
        ui.showToast('Copy failed — try selecting text manually.', 'error');
      }
    });
  });
}

// ── AI History Modal ──────────────────────────────────────────

async function initAiHistoryModal() {
  document.getElementById('btn-ai-history-open')?.addEventListener('click', async () => {
    const container = document.getElementById('ai-history-list');
    if (container) {
      const items = await db.getAiHistory();
      if (!items.length) {
        container.innerHTML = `<p class="history-empty">No generations yet.</p>`;
      } else {
        container.innerHTML = items.map(h => {
          const preview = (h.content || '').slice(0, 120) + '…';
          const date    = h.created_at ? new Date(h.created_at + 'Z').toLocaleString() : '—';
          return `
            <div class="history-item">
              <div class="history-item-meta">
                <span class="history-topic">${escHtml(h.topic || '—')}</span>
                <span class="history-badges">
                  ${h.tone     ? `<span class="tag">${escHtml(h.tone)}</span>`     : ''}
                  ${h.provider ? `<span class="tag tag--provider">${escHtml(h.provider)}</span>` : ''}
                </span>
                <span class="history-date">${date}</span>
              </div>
              <p class="history-preview">${escHtml(preview)}</p>
              <button class="btn btn--ghost btn--xs history-load-btn" data-content="${escAttr(h.content)}">
                <i class="ph ph-pencil-simple"></i> Load into composer
              </button>
            </div>`;
        }).join('');

        container.querySelectorAll('.history-load-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            applyGeneratedContent(btn.dataset.content);
            ui.closeModal('modal-ai-history');
          });
        });
      }
    }
    ui.openModal('modal-ai-history');
  });

  ['btn-ai-history-close', 'btn-ai-history-cancel'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => ui.closeModal('modal-ai-history'));
  });
  document.getElementById('modal-ai-history')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-ai-history') ui.closeModal('modal-ai-history');
  });
}

// ── Templates Modal ───────────────────────────────────────────

async function initTemplatesModal() {
  document.getElementById('btn-templates-open')?.addEventListener('click', async () => {
    await renderTemplatesList();
    ui.openModal('modal-templates');
  });

  ['btn-templates-close', 'btn-templates-cancel'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => ui.closeModal('modal-templates'));
  });
  document.getElementById('modal-templates')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-templates') ui.closeModal('modal-templates');
  });

  // Save current AI params as template
  document.getElementById('btn-save-template')?.addEventListener('click', async () => {
    const topic    = document.getElementById('ai-topic')?.value?.trim()    || '';
    const category = document.getElementById('ai-category')?.value         || '';
    const tone     = document.getElementById('ai-tone')?.value             || '';
    const name     = prompt('Template name:', topic || 'My template');
    if (!name) return;
    await db.saveTemplate({ name, topic, category, tone });
    await renderTemplatesList();
    ui.openModal('modal-templates');
    ui.showToast('Template saved!', 'success', 2500);
  });
}

async function renderTemplatesList() {
  const container = document.getElementById('templates-list');
  if (!container) return;

  const templates = await db.getTemplates();
  if (!templates.length) {
    container.innerHTML = `<p class="history-empty">No templates yet. Fill in the AI panel and click "Save template".</p>`;
    return;
  }

  container.innerHTML = templates.map(t => `
    <div class="history-item">
      <div class="history-item-meta">
        <span class="history-topic">${escHtml(t.name)}</span>
        <span class="history-badges">
          ${t.category ? `<span class="tag">${escHtml(t.category)}</span>` : ''}
          ${t.tone     ? `<span class="tag">${escHtml(t.tone)}</span>`     : ''}
        </span>
      </div>
      ${t.topic ? `<p class="history-preview">${escHtml(t.topic)}</p>` : ''}
      <div class="history-item-actions">
        <button class="btn btn--ghost btn--xs tpl-load-btn" data-topic="${escAttr(t.topic||'')}" data-category="${escAttr(t.category||'')}" data-tone="${escAttr(t.tone||'')}">
          <i class="ph ph-download-simple"></i> Load
        </button>
        <button class="btn btn--ghost btn--xs tpl-delete-btn" data-id="${t.id}">
          <i class="ph ph-trash"></i>
        </button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.tpl-load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const topicEl    = document.getElementById('ai-topic');
      const categoryEl = document.getElementById('ai-category');
      const toneEl     = document.getElementById('ai-tone');
      if (topicEl)    topicEl.value    = btn.dataset.topic;
      if (categoryEl) categoryEl.value = btn.dataset.category;
      if (toneEl)     toneEl.value     = btn.dataset.tone;
      const genBtn = document.getElementById('btn-ai-generate');
      if (genBtn) genBtn.disabled = !topicEl?.value?.trim();
      ui.closeModal('modal-templates');
      ui.showToast('Template loaded into AI panel', 'success', 2500);
    });
  });

  container.querySelectorAll('.tpl-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await db.deleteTemplate(parseInt(btn.dataset.id, 10));
      await renderTemplatesList();
    });
  });
}

// ── Shared utils ──────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── API Explorer ─────────────────────────────────────────────

function initApiExplorer() {
  document.querySelectorAll('[data-api-call]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const call = btn.dataset.apiCall;
      ui.setLoading(btn, true, 'Running…');

      try {
        let data, status;

        if (call === 'userinfo') {
          data = await api.getUserInfo();
          status = 200;
        } else if (call === 'oidc-discovery') {
          data = await api.getOidcDiscovery();
          status = 200;
        } else if (call === 'jwks') {
          data = await api.getJwks();
          status = 200;
        } else {
          data = { error: 'Unknown endpoint' };
          status = 400;
        }

        ui.renderApiResponse(data, status);
      } catch (err) {
        ui.renderApiResponse({ error: err.name, message: err.message }, err.status || 0);
        ui.showToast(err.message, 'error');
      } finally {
        ui.setLoading(btn, false);
      }
    });
  });
}

// ── Logout ───────────────────────────────────────────────────

function handleLogout() {
  auth.logout();
  document.getElementById('btn-logout')?.setAttribute('hidden', '');
  ui.showScreen('screen-login');
  ui.showToast('You have been signed out.', 'info');

  // Re-wire login button (it was set up before, but re-attach cleanly)
  const loginBtn = document.getElementById('btn-login');
  if (loginBtn) {
    const newBtn = loginBtn.cloneNode(true);
    loginBtn.replaceWith(newBtn);
    newBtn.addEventListener('click', () => {
      ui.setLoadingMessage('Connecting to LinkedIn…');
      ui.showScreen('screen-loading');
      auth.startLogin();
    });
  }
}
