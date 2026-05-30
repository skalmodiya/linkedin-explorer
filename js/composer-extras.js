// composer-extras.js — Emoji picker, Tag people, More options, Schedule post, Carousel notice

// ── Emoji data ────────────────────────────────────────────────
// Curated set grouped loosely by category
const EMOJIS = [
  // Smileys & people
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','😎',
  '🤓','🧐','🤔','😐','😑','🙄','😏','😒','😞','😔','😟','😕','☹️','😣',
  '😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤯','😳','🥵','🥶','😱',
  '😨','😰','😥','😓','🤗','🤭','🤫','🤥','😶','🫡','🤐','🥴','😵','🤑',
  '🤠','😈','💀','💩','🤡','👻','👽','🤖','😺','😸','😹','😻','😼','😽',
  // Hand gestures & body
  '👍','👎','👌','✌️','🤞','🤙','💪','🙌','👏','🤝','🙏','✋','🤚','👋',
  '👈','👉','👆','👇','☝️','👊','✊','🤛','🤜','🤘','🤟','💅','🦾',
  // Hearts & emotions
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓',
  '💗','💖','💘','💝','💟','☮️','✝️','☯️','🕊️','💯','✅','❌','❓','❗',
  // Objects & symbols
  '🎉','🎊','🎈','🎁','🏆','🥇','🎯','🔥','⚡','💥','✨','🌟','⭐','💫',
  '🌈','☀️','🌙','⛅','🌊','🌸','🌺','🍀','🌍','🚀','💡','🔑','🛡️','⚙️',
  '📊','📈','📉','💼','📝','📌','📎','🔗','📣','📢','💬','💭','🗣️','👀',
  // Work & tech
  '💻','📱','🖥️','⌨️','🖱️','📡','🔭','🔬','📚','🎓','🏫','🏢','🏗️','🌐',
  '📧','📨','📩','📤','📥','🗂️','📋','🗒️','📅','⏰','⏳','⌛','🔔','🔕',
];

// ── Shared popover utilities ──────────────────────────────────

let _openPopover = null;

function positionPopover(popover, anchorBtn) {
  const rect  = anchorBtn.getBoundingClientRect();
  const vw    = window.innerWidth;
  const vh    = window.innerHeight;

  // Start below the button
  let top  = rect.bottom + 6;
  let left = rect.left;

  // Temporarily show off-screen to measure
  popover.style.visibility = 'hidden';
  popover.hidden = false;
  const pw = popover.offsetWidth;
  const ph = popover.offsetHeight;
  popover.hidden = true;
  popover.style.visibility = '';

  // Flip left if overflows right
  if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
  // Flip above if overflows bottom
  if (top + ph > vh - 8) top = rect.top - ph - 6;

  popover.style.left = `${left}px`;
  popover.style.top  = `${top}px`;
}

function openPopover(popover, anchorBtn) {
  if (_openPopover && _openPopover !== popover) closeAllPopovers();
  positionPopover(popover, anchorBtn);
  popover.hidden = false;
  _openPopover = popover;
}

function closeAllPopovers() {
  document.querySelectorAll('.composer-popover').forEach(p => { p.hidden = true; });
  _openPopover = null;
}

// Close on outside click
document.addEventListener('mousedown', (e) => {
  if (_openPopover && !_openPopover.contains(e.target)) {
    // Don't close if clicking the trigger button itself (let toggle handle it)
    closeAllPopovers();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _openPopover) closeAllPopovers();
});

// ── Emoji Picker ──────────────────────────────────────────────

export function initEmojiPicker(getEditor) {
  const btn     = document.getElementById('btn-emoji');
  const picker  = document.getElementById('emoji-picker');
  const grid    = document.getElementById('emoji-grid');
  const search  = document.getElementById('emoji-search');
  if (!btn || !picker || !grid) return;

  function renderEmojis(filter = '') {
    const list = filter
      ? EMOJIS.filter(e => e.includes(filter))
      : EMOJIS;
    grid.innerHTML = list.map(e =>
      `<button class="emoji-btn" type="button" data-emoji="${e}">${e}</button>`
    ).join('');
  }

  renderEmojis();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!picker.hidden) { closeAllPopovers(); return; }
    openPopover(picker, btn);
    search.value = '';
    renderEmojis();
    search.focus();
  });

  search.addEventListener('input', () => renderEmojis(search.value));

  grid.addEventListener('click', (e) => {
    const emojiBtn = e.target.closest('.emoji-btn');
    if (!emojiBtn) return;
    const emoji = emojiBtn.dataset.emoji;
    const editor = getEditor();
    if (editor) {
      editor.focus();
      document.execCommand('insertText', false, emoji);
      editor.dispatchEvent(new Event('input'));
    }
    closeAllPopovers();
  });
}

// ── Tag People ────────────────────────────────────────────────

export function initTagPeople(getEditor) {
  const btn     = document.getElementById('btn-tag-people');
  const popover = document.getElementById('tag-people-popover');
  const input   = document.getElementById('tag-name-input');
  const insert  = document.getElementById('btn-tag-insert');
  if (!btn || !popover) return;

  function doInsert() {
    const name = input?.value?.trim();
    if (!name) return;
    const editor = getEditor();
    if (editor) {
      editor.focus();
      document.execCommand('insertText', false, `@${name} `);
      editor.dispatchEvent(new Event('input'));
    }
    if (input) input.value = '';
    closeAllPopovers();
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!popover.hidden) { closeAllPopovers(); return; }
    openPopover(popover, btn);
    input?.focus();
  });

  insert?.addEventListener('click', doInsert);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doInsert(); }
    if (e.key === 'Escape') closeAllPopovers();
  });
}

// ── More Options ──────────────────────────────────────────────

export function initMoreOptions(getEditor) {
  const btn     = document.getElementById('btn-more-options');
  const popover = document.getElementById('more-options-popover');
  if (!btn || !popover) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!popover.hidden) { closeAllPopovers(); return; }
    openPopover(popover, btn);
  });

  // Word & character count
  document.getElementById('opt-word-count')?.addEventListener('click', () => {
    closeAllPopovers();
    const editor = getEditor();
    const text   = editor ? getEditorPlainText(editor) : '';
    const chars  = text.length;
    const words  = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines  = text ? text.split('\n').length : 0;
    import('./ui.js').then(ui => {
      ui.showToast(`${chars} characters · ${words} words · ${lines} line${lines !== 1 ? 's' : ''}`, 'info', 4000);
    });
  });

  // Copy post text
  document.getElementById('opt-copy-text')?.addEventListener('click', () => {
    closeAllPopovers();
    const editor = getEditor();
    const text   = editor ? getEditorPlainText(editor) : '';
    if (!text) {
      import('./ui.js').then(ui => ui.showToast('Nothing to copy — editor is empty.', 'warning'));
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      import('./ui.js').then(ui => ui.showToast('Post text copied to clipboard!', 'success', 2500));
    });
  });

  // Clear editor
  document.getElementById('opt-clear-editor')?.addEventListener('click', () => {
    closeAllPopovers();
    const editor = getEditor();
    if (!editor) return;
    if (editor.innerHTML === '' || editor.innerText.trim() === '') return;
    if (!confirm('Clear the editor? This cannot be undone.')) return;
    editor.innerHTML = '';
    editor.dispatchEvent(new Event('input'));
    editor.focus();
  });

  // Paste as plain text
  document.getElementById('opt-paste-plain')?.addEventListener('click', async () => {
    closeAllPopovers();
    const editor = getEditor();
    if (!editor) return;
    try {
      const text = await navigator.clipboard.readText();
      editor.focus();
      document.execCommand('insertText', false, text);
      editor.dispatchEvent(new Event('input'));
    } catch (_) {
      import('./ui.js').then(ui => ui.showToast('Could not read clipboard. Use Ctrl+V to paste.', 'warning', 4000));
    }
  });
}

// ── Carousel notice ───────────────────────────────────────────

export function initCarousel() {
  document.getElementById('btn-carousel')?.addEventListener('click', () => {
    import('./ui.js').then(ui => {
      ui.showToast(
        'Carousel posts require PDF upload via LinkedIn’s Partner API (not available on free access). Use image attachments instead.',
        'info',
        6000
      );
    });
  });
}

// ── Schedule Post ─────────────────────────────────────────────

let _scheduledAt = null;

export function initSchedulePost() {
  const btnOpen     = document.getElementById('btn-schedule');
  const modal       = document.getElementById('modal-schedule');
  const dateInput   = document.getElementById('schedule-date');
  const timeInput   = document.getElementById('schedule-time');
  const preview     = document.getElementById('schedule-preview');
  const previewText = document.getElementById('schedule-preview-text');
  const indicator   = document.getElementById('schedule-indicator');
  const indicatorTxt= document.getElementById('schedule-indicator-text');
  const btnSave     = document.getElementById('btn-schedule-save');
  const btnCancel   = document.getElementById('btn-schedule-cancel');
  const btnClose    = document.getElementById('btn-schedule-close');
  const btnClear    = document.getElementById('btn-schedule-clear');

  if (!modal) return;

  function formatDateTime(date) {
    return date.toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function updatePreview() {
    const d = dateInput?.value;
    const t = timeInput?.value || '09:00';
    if (!d) { if (preview) preview.hidden = true; return; }
    const dt = new Date(`${d}T${t}`);
    if (isNaN(dt.getTime())) return;
    if (previewText) previewText.textContent = `Reminder set for ${formatDateTime(dt)}`;
    if (preview) preview.hidden = false;
  }

  dateInput?.addEventListener('input', updatePreview);
  timeInput?.addEventListener('input', updatePreview);

  // Set default date/time to tomorrow 9am
  function prefillDefaults() {
    if (_scheduledAt) {
      const d = _scheduledAt;
      if (dateInput) dateInput.value = d.toISOString().slice(0, 10);
      if (timeInput) timeInput.value = d.toTimeString().slice(0, 5);
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      if (dateInput) dateInput.value = tomorrow.toISOString().slice(0, 10);
      if (timeInput) timeInput.value = '09:00';
    }
    updatePreview();
  }

  btnOpen?.addEventListener('click', () => {
    prefillDefaults();
    import('./ui.js').then(ui => ui.openModal('modal-schedule'));
  });

  // Also clicking indicator reopens modal
  indicator?.addEventListener('click', () => {
    prefillDefaults();
    import('./ui.js').then(ui => ui.openModal('modal-schedule'));
  });

  function closeModal() {
    import('./ui.js').then(ui => ui.closeModal('modal-schedule'));
  }

  btnClose?.addEventListener('click', closeModal);
  btnCancel?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  btnSave?.addEventListener('click', () => {
    const d = dateInput?.value;
    const t = timeInput?.value || '09:00';
    if (!d) {
      import('./ui.js').then(ui => ui.showToast('Please pick a date.', 'warning'));
      return;
    }
    const dt = new Date(`${d}T${t}`);
    if (isNaN(dt.getTime()) || dt <= new Date()) {
      import('./ui.js').then(ui => ui.showToast('Please choose a future date and time.', 'warning'));
      return;
    }
    _scheduledAt = dt;
    if (indicator) indicator.hidden = false;
    if (indicatorTxt) indicatorTxt.textContent = formatDateTime(dt);
    closeModal();
    import('./ui.js').then(ui => {
      ui.showToast(`Reminder set for ${formatDateTime(dt)}`, 'success', 4000);
    });
  });

  btnClear?.addEventListener('click', () => {
    _scheduledAt = null;
    if (indicator) indicator.hidden = true;
    if (preview) preview.hidden = true;
    closeModal();
  });
}

// ── Helper: plain text from contenteditable (mirrors app.js) ─

function getEditorPlainText(el) {
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
    if (tag === 'BR') { result += '\n'; lastWasBlock = true; return; }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && result.length > 0 && !lastWasBlock) result += '\n';
    for (const child of node.childNodes) walk(child);
    if (isBlock && !lastWasBlock) { result += '\n'; lastWasBlock = true; }
  }

  walk(el);
  return result.replace(/\n+$/, '');
}
