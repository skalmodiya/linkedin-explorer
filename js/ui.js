// ui.js — DOM helpers, toast notifications, profile rendering, theme
import { getPostUrl } from './api.js';

// ── Theme ──────────────────────────────────────────────────

export function initTheme() {
  const saved = localStorage.getItem('li_theme') || 'dark';
  applyTheme(saved);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('li_theme', next);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  document.querySelectorAll('[id^="theme-icon"]').forEach(el => {
    el.className = isDark ? 'ph ph-moon' : 'ph ph-sun';
  });
}

// ── Screen router ───────────────────────────────────────────

export function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');

  const header = document.getElementById('app-header');
  const floatingBtn = document.getElementById('btn-theme-login');
  const isLoginOrLoading = screenId === 'screen-login' || screenId === 'screen-loading';

  if (header)      header.hidden = isLoginOrLoading;
  if (floatingBtn) floatingBtn.style.display = isLoginOrLoading ? '' : 'none';
}

export function setLoadingMessage(msg) {
  const el = document.getElementById('loading-message');
  if (el) el.textContent = msg;
}

// ── Profile rendering ───────────────────────────────────────

export function renderProfile(userInfo) {
  const { name, given_name, family_name, picture, email, email_verified, locale } = userInfo;

  // Header avatar
  const avatar    = document.getElementById('profile-avatar');
  const fallback  = document.getElementById('profile-avatar-fallback');
  const initials  = buildInitials(given_name, family_name, name);

  if (picture) {
    avatar.src = picture;
    avatar.alt = name || 'Profile photo';
    avatar.hidden = false;
    if (fallback) fallback.hidden = true;
    avatar.onerror = () => {
      avatar.hidden = true;
      if (fallback) { fallback.textContent = initials; fallback.hidden = false; }
    };
  } else {
    avatar.hidden = true;
    if (fallback) { fallback.textContent = initials; fallback.hidden = false; }
  }

  // Composer avatar
  const compAvatar = document.getElementById('composer-avatar');
  if (compAvatar) {
    if (picture) {
      compAvatar.src = picture;
      compAvatar.alt = name || '';
      compAvatar.onerror = () => { compAvatar.src = buildAvatarSvg(initials); };
    } else {
      compAvatar.src = buildAvatarSvg(initials);
    }
  }

  setTextContent('profile-name',    name || `${given_name || ''} ${family_name || ''}`.trim());
  setTextContent('composer-name',   name || `${given_name || ''} ${family_name || ''}`.trim());
  setTextContent('profile-email',   email || '');

  // locale can be a string ("en_US") or object ({language:"en", country:"IN"})
  let localeStr = '';
  if (locale) {
    if (typeof locale === 'object') {
      localeStr = [locale.language, locale.country].filter(Boolean).join('-').toUpperCase();
    } else {
      localeStr = String(locale);
    }
  }
  setTextContent('profile-locale', localeStr ? `🌐 ${localeStr}` : '');

  // Verified badge
  const badge = document.getElementById('badge-verified');
  if (badge) badge.hidden = !email_verified;

  // Token info tab
  const expEl = document.getElementById('token-expiry');
  if (expEl) {
    const { getExpiryDate } = window.__liAuth || {};
    if (getExpiryDate) {
      const d = getExpiryDate();
      expEl.textContent = d ? d.toLocaleString() : '—';
    }
  }
  updateTokenPreview();
}

export function updateTokenPreview() {
  const tok = sessionStorage.getItem('li_access_token') || '';
  const el  = document.getElementById('token-preview');
  if (el && tok) {
    el.textContent = tok.slice(0, 8) + '••••••••••••••••' + tok.slice(-4);
  }
}

// ── Toast notifications ─────────────────────────────────────

const TOAST_ICONS = {
  success: 'ph-check-circle',
  error:   'ph-x-circle',
  warning: 'ph-warning',
  info:    'ph-info',
};

export function showToast(message, type = 'info', duration = 4500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');

  const icon = TOAST_ICONS[type] || TOAST_ICONS.info;
  toast.innerHTML = `
    <i class="ph ${icon}" aria-hidden="true"></i>
    <div class="toast-body"><span class="toast-msg">${escapeHtml(message)}</span></div>
  `;

  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  setTimeout(remove, duration);
  toast.addEventListener('click', remove);
}

// ── Button loading state ────────────────────────────────────

export function setLoading(btn, isLoading, loadingText = '') {
  if (!btn) return;
  btn.dataset.loading = isLoading ? 'true' : 'false';
  btn.disabled = isLoading;
  if (isLoading && loadingText) {
    btn._originalHTML = btn.innerHTML;
    btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span>${escapeHtml(loadingText)}`;
  } else if (!isLoading && btn._originalHTML) {
    btn.innerHTML = btn._originalHTML;
    delete btn._originalHTML;
  }
}

// ── Character counter ───────────────────────────────────────

export function initCharCounter(textareaId, counterId, max = 3000) {
  const textarea = document.getElementById(textareaId);
  const counter  = document.getElementById(counterId);
  const postBtn  = document.getElementById('btn-post');
  if (!textarea || !counter) return;

  const update = () => {
    const len = textarea.value.length;
    counter.textContent = String(len);
    counter.parentElement.classList.remove('warn', 'danger');
    if (len >= max * 0.95) counter.parentElement.classList.add('danger');
    else if (len >= max * 0.9) counter.parentElement.classList.add('warn');
    if (postBtn) postBtn.disabled = len === 0 || len > max;
  };

  textarea.addEventListener('input', update);
  update();
}
// ── Tabs ────────────────────────────────────────────────────

export function initTabs() {
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    tab.addEventListener('click', () => {
      const panelId = tab.dataset.tab;

      document.querySelectorAll('[role="tab"]').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const panel = document.querySelector(`[data-panel="${panelId}"]`);
      if (panel) panel.classList.add('active');
    });
  });
}

// ── Post result ─────────────────────────────────────────────

export function showPostResult(postUrn) {
  const el  = document.getElementById('post-result');
  const urnEl = document.getElementById('post-result-urn');
  const copyBtn = document.getElementById('btn-copy-link');

  if (el)  el.hidden = false;
  if (urnEl) urnEl.textContent = postUrn || '';

  if (copyBtn && postUrn) {
    const url = getPostUrl(postUrn);
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(url).then(
        () => showToast('Post link copied to clipboard!', 'success'),
        () => showToast('Could not copy — link: ' + url, 'info', 8000),
      );
    };
  }
}

export function hidePostResult() {
  const el = document.getElementById('post-result');
  if (el) el.hidden = true;
}

// ── API Explorer response rendering ─────────────────────────

export function renderApiResponse(data, status) {
  const pre  = document.getElementById('api-response');
  const stat = document.getElementById('api-response-status');
  const copy = document.getElementById('btn-copy-response');

  if (pre) pre.textContent = JSON.stringify(data, null, 2);
  if (stat) {
    stat.textContent = `${status}`;
    stat.className = 'api-response-status ' + (status >= 200 && status < 300 ? 'ok' : 'err');
  }
  if (copy) {
    copy.hidden = false;
    copy.onclick = () => {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(
        () => showToast('Copied!', 'success', 2000),
        () => {},
      );
    };
  }
}

// ── Error screen ─────────────────────────────────────────────

export function showError(message) {
  const el = document.getElementById('error-message');
  if (el) el.textContent = message || 'An unexpected error occurred.';
  showScreen('screen-error');
}

// ── Utilities ────────────────────────────────────────────────

function setTextContent(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function buildInitials(given, family, fallback) {
  if (given && family) return (given[0] + family[0]).toUpperCase();
  if (given) return given[0].toUpperCase();
  if (fallback) return fallback.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return 'LI';
}

function buildAvatarSvg(initials) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#0a66c2"/><text x="20" y="26" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="white">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
