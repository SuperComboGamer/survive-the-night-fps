// Chat panel (lower-left). All user text goes through textContent - never innerHTML.
// Chat only carries as far as a voice does: lines from the edge of earshot come in faint, lines from further
// away arrive over the walkie-talkie (if you both carry one), and your own line says so when nobody heard it.
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
    this.say = el('span', 'chat-say', bar, 'Say');
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
    if (opts.radio) {
      line.classList.add('radio');
      svgEl('i', 'chat-r', line, glyph('radio'));
    }
    if (opts.faint) line.classList.add('faint');
    if (name && !opts.system) {
      const n = el('span', 'chat-name', line, String(name));
      if (opts.color && /^#[0-9a-f]{3,8}$/i.test(opts.color)) n.style.color = opts.color;
      el('span', 'chat-colon', line, ':');
    }
    el('span', 'chat-text', line, String(text ?? ''));
    if (opts.unheard) {
      line.classList.add('unheard');
      el('span', 'chat-note', line, 'nobody in earshot');
    }
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
    // Focus on the next tick so the key that opened chat (e.g. "T") is not typed into the field.
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

  // with a walkie-talkie the message goes out over the radio as well
  setRadio(on) {
    this.root.classList.toggle('on-radio', on);
    this.say.textContent = on ? 'Radio' : 'Say';
  }

  clear() {
    this.log.textContent = '';
  }
}
