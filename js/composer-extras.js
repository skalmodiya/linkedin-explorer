// composer-extras.js — Emoji picker, direct toolbar buttons

// ── Emoji data ────────────────────────────────────────────────
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
  const rect = anchorBtn.getBoundingClientRect();
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;
  let top    = rect.bottom + 6;
  let left   = rect.left;

  popover.style.visibility = 'hidden';
  popover.hidden = false;
  const pw = popover.offsetWidth;
  const ph = popover.offsetHeight;
  popover.hidden = true;
  popover.style.visibility = '';

  if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
  if (top + ph > vh - 8)  top  = rect.top - ph - 6;

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

document.addEventListener('mousedown', (e) => {
  if (_openPopover && !_openPopover.contains(e.target)) closeAllPopovers();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _openPopover) closeAllPopovers();
});

// ── Emoji Picker ──────────────────────────────────────────────

export function initEmojiPicker(getEditor) {
  const btn    = document.getElementById('btn-emoji');
  const picker = document.getElementById('emoji-picker');
  const grid   = document.getElementById('emoji-grid');
  const search = document.getElementById('emoji-search');
  if (!btn || !picker || !grid) return;

  function renderEmojis(filter = '') {
    const list = filter ? EMOJIS.filter(e => e.includes(filter)) : EMOJIS;
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
    const editor = getEditor();
    if (editor) {
      editor.focus();
      document.execCommand('insertText', false, emojiBtn.dataset.emoji);
      editor.dispatchEvent(new Event('input'));
    }
    closeAllPopovers();
  });
}

// ── Direct toolbar buttons ────────────────────────────────────

export function initMoreOptions(getEditor) {
  // Word & character count
  document.getElementById('btn-word-count')?.addEventListener('click', () => {
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
  document.getElementById('btn-copy-text')?.addEventListener('click', () => {
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

  // Paste as plain text
  document.getElementById('btn-paste-plain')?.addEventListener('click', async () => {
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

  // Clear editor
  document.getElementById('btn-clear-editor')?.addEventListener('click', () => {
    const editor = getEditor();
    if (!editor) return;
    if (editor.innerHTML === '' || editor.innerText.trim() === '') return;
    if (!confirm('Clear the editor? This cannot be undone.')) return;
    editor.innerHTML = '';
    editor.dispatchEvent(new Event('input'));
    editor.focus();
  });
}

// ── Stubs so app.js imports stay intact ──────────────────────

export function initTagPeople() {}
export function initCarousel() {}
export function initSchedulePost() {}

// ── Helper: plain text from contenteditable ───────────────────

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
