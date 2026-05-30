// app.js — Main entry point, event wiring, screen routing
import { CONFIG } from '../config.js';
import * as auth from './auth.js';
import * as api  from './api.js';
import * as ui   from './ui.js';
import * as llm  from './llm.js';

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

// ── Composer ────────────────────────────────────────────────

function initComposer(authorSub) {
  ui.initCharCounter('post-text', 'char-count');
  ui.hidePostResult();

  const postBtn  = document.getElementById('btn-post');
  const textarea = document.getElementById('post-text');

  postBtn?.addEventListener('click', async () => {
    const text = textarea?.value?.trim();
    if (!text) return;

    postBtn.disabled = true;
    postBtn.dataset.loading = 'true';
    postBtn.textContent = 'Posting…';

    try {
      const { postUrn } = await api.createTextPost(text, authorSub);
      ui.showPostResult(postUrn);
      ui.showToast('Post published successfully!', 'success');
      if (textarea) textarea.value = '';
      document.getElementById('char-count').textContent = '0';
      document.getElementById('char-counter')?.classList.remove('warn', 'danger');
      postBtn.disabled = true;
      // Hide regen bar after successful post
      document.getElementById('ai-regen-bar').hidden = true;
    } catch (err) {
      ui.showToast(err.message, 'error', 7000);
    } finally {
      postBtn.dataset.loading = 'false';
      postBtn.textContent = 'Post';
      // Re-enable only if textarea has content
      postBtn.disabled = !(textarea?.value?.trim());
    }
  });

  // Wire AI settings modal + generation panel
  initAiSettings();
  initAiPanel();
}

// ── AI Settings Modal ────────────────────────────────────────

function initAiSettings() {
  const modal          = document.getElementById('modal-ai-settings');
  const providerSelect = document.getElementById('ai-provider-select');
  const modelSelect    = document.getElementById('ai-model-select');
  const keyInput       = document.getElementById('ai-apikey-input');
  const eyeIcon        = document.getElementById('apikey-eye-icon');
  const statusEl       = document.getElementById('ai-status');

  // Populate provider dropdown
  ui.populateSelect(
    providerSelect,
    llm.getProviderList().map(p => ({ value: p.id, label: p.label })),
    llm.getConfig().provider
  );

  function syncModelDropdown(provider) {
    const models = llm.getModelsForProvider(provider);
    const { model } = llm.getConfig();
    ui.populateSelect(
      modelSelect,
      models.map(m => ({ value: m, label: m })),
      model
    );
  }

  function prefillForProvider(provider) {
    syncModelDropdown(provider);
    keyInput.value = llm.getKeyForProvider(provider);
    if (statusEl) statusEl.hidden = true;
  }

  // Open modal from toolbar AI button
  ['btn-ai-toolbar', 'btn-ai-settings-open', 'btn-ai-setup-link'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      const { provider } = llm.getConfig();
      prefillForProvider(provider);
      providerSelect.value = provider;
      ui.openModal('modal-ai-settings');
    });
  });

  // Provider change → refresh model list + prefill key
  providerSelect?.addEventListener('change', () => {
    prefillForProvider(providerSelect.value);
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
      if (statusEl) {
        statusEl.textContent = 'Please enter an API key.';
        statusEl.className   = 'ai-status ai-status--error';
        statusEl.hidden      = false;
      }
      keyInput.focus();
      return;
    }

    llm.saveConfig(provider, model, key);
    ui.closeModal('modal-ai-settings');
    ui.showToast(`AI configured: ${provider} / ${model}`, 'success');
    showAiPanel(true);
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
}

function initAiPanel() {
  // Show correct state on init
  showAiPanel(llm.isConfigured());

  const topicInput = document.getElementById('ai-topic');
  const genBtn     = document.getElementById('btn-ai-generate');
  const textarea   = document.getElementById('post-text');

  // Enable Generate only when topic is non-empty
  topicInput?.addEventListener('input', () => {
    if (genBtn) genBtn.disabled = !topicInput.value.trim();
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
    } catch (err) {
      ui.showToast(err.message, 'error', 7000);
    } finally {
      ui.setLoading(regenBtn, false);
    }
  });
}

function applyGeneratedContent(content) {
  const textarea = document.getElementById('post-text');
  if (!textarea) return;
  textarea.value = content;
  // Trigger input event so char counter + Post button update
  textarea.dispatchEvent(new Event('input'));
  textarea.focus();
  ui.hidePostResult();
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
