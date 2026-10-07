// Chat panel (lower-left). All user text goes through textContent - never innerHTML.
// Text chat reaches everyone in the game, wherever they are (only the voice is limited to earshot).
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';

const MAX_LINES = 60;
const FADE_MS = 10000;
const MAX_LEN = 140;

export class Chat {
  constructor(ui, parent) {
    this.ui = ui;
    this.root = el('div', 'chat', parent);
    this.log = el('div', 'chat-log', this.root);
    const bar = (this.bar = el('div', 'chat-input', this.root));
    el('span', 'chat-say', bar, 'Say');
    this.input = el('input', 'chat-field', bar);
    this.input.type = 'text';
    this.input.maxLength = MAX_LEN;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', 'Chat message');
    this.count = el('span', 'chat-count', bar, '');
    this.typing = false;

    // Keydown is consumed here so the game never sees keys while typing. Keyup is left to
    // propagate so the game can release any movement keys held when chat opened.
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.input.value.trim().slice(0, MAX_LEN);
        this.close();
        if (text) this.ui.cb.onChatSend(text);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
      }
    });
    this.input.addEventListener('input', () => {
      const n = this.input.value.length;
      this.count.textContent = n > MAX_LEN - 30 ? MAX_LEN - n + '' : '';
    });
    this.input.addEventListener('blur', () => {
      if (this.typing) setTimeout(() => this.typing && document.activeElement !== this.input && this.close(), 0);
    });
  }

  add(name, text, opts = {}) {
    const line = el('div', 'chat-line');
    if (opts.system) line.classList.add('sys');
    if (opts.zombie) line.classList.add('zed');
    if (opts.zombie) svgEl('i', 'chat-z', line, glyph('claw'));
    if (name && !opts.system) {
      const n = el('span', 'chat-name', line, String(name));
      if (opts.color && /^#[0-9a-f]{3,8}$/i.test(opts.color)) n.style.color = opts.color;
      el('span', 'chat-colon', line, ':');
    }
    el('span', 'chat-text', line, String(text ?? ''));
    this.log.appendChild(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => line.classList.add('old'), FADE_MS);
  }

  open() {
    if (this.typing) return;
    this.typing = true;
    this.root.classList.add('open');
    this.input.value = '';
    this.count.textContent = '';
    this.log.scrollTop = this.log.scrollHeight;
    // Focus on the next tick so the key that opened chat ("Y") is not typed into the field.
    setTimeout(() => {
      if (this.typing) this.input.focus({ preventScroll: true });
    }, 0);
  }

  close() {
    if (!this.typing) return;
    this.typing = false;
    this.root.classList.remove('open');
    this.input.value = '';
    this.input.blur();
    this.ui.cb.onChatClosed?.();
  }

  clear() {
    this.log.textContent = '';
  }
}
