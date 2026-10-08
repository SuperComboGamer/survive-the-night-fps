// The bestiary [J]: every kind of the dead (shared/bestiary.js), a card each with a portrait, the name and what it does.
// A kind never seen is a dark smudge of a portrait, "???" and a vague line; once seen (net/bestiary.js) the portrait
// clears and the card says how it fights and how to fight it. "Seen X of Y" in the head. Opened by its key and from the
// pause menu; the cross, its key, Esc or a click outside the frame closes it (the game sets onClose).
//
// The portraits are the game's own models (models/characters.js createZombie), drawn by a small WebGL renderer of its
// own the first time the book opens, kept as images, and the renderer let go of again (ui/portrait.js, which Dead
// Hand's cards draw their dead with too). A locked card is only given the smudge (made from the drawing in a canvas):
// no clear portrait of a kind not seen is put in the page.
import { BESTIARY, BESTIARY_GROUPS, SEEN_RANGE, bit, seenCount } from '../../shared/bestiary.js';
import { pics, drawPortraits } from './portrait.js';
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { bindLabel, liveText } from '../game/binds.js';
import { bestiaryView, onBestiary } from '../net/bestiary.js';

const GROUP_TAG = { horde: 'Horde', special: 'Special', boss: 'Boss' };

// ---------------------------------------------------------------- the book
export class Bestiary {
  constructor(ui, parent) {
    this.ui = ui;
    this.open = false;
    this.onClose = null; // the game's: the cross, the key, Esc, a click outside

    this.root = el('div', 'bstscr', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Bestiary');
    const bg = el('div', 'map-bg', this.root);
    const frame = el('div', 'bst-frame paper', this.root);
    const head = el('div', 'map-head', frame);
    el('span', 'map-title', head, 'Bestiary');
    this.count = el('span', 'map-coords', head, '');
    const close = (this.close = svgEl('button', 'set-close btn-icon map-close', head, glyph('xmark')));
    close.type = 'button';
    close.setAttribute('aria-label', 'Close bestiary');
    liveText(close, () => `Close (${bindLabel('bestiary')})`, 'title');
    close.addEventListener('click', () => this.onClose?.());
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      this.onClose?.();
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && (e.target === bg || e.target === this.root)) this.onClose?.();
    });

    el('p', 'bst-rule', frame, `A page fills in once you have seen one of them: within ${SEEN_RANGE} m, in plain sight.`);
    this.body = el('div', 'bst-body', frame);
    this.cards = new Map(); // ztype -> { card, img, name, text }
    this.groupNs = new Map(); // group -> its "n / m"
    for (const [g, title] of BESTIARY_GROUPS) {
      const list = BESTIARY.filter((e) => e.group === g);
      const sec = el('section', 'bst-group', this.body);
      const h = el('div', 'fr-h bst-group-h', sec);
      el('span', '', h, title);
      this.groupNs.set(g, [el('span', 'bst-group-n', h, ''), list]);
      const grid = el('div', 'bst-grid', sec);
      for (const e of list) {
        const card = el('article', 'bst-card locked', grid);
        const pic = el('div', 'bst-pic', card);
        const img = el('img', '', pic);
        img.alt = '';
        img.hidden = true;
        svgEl('i', 'bst-lock', pic, glyph('question'));
        const b = el('div', 'bst-card-b', card);
        const top = el('div', 'bst-card-top', b);
        const name = el('b', 'bst-name', top, '???');
        el('span', `bst-tag tag-${e.group}`, top, GROUP_TAG[e.group]);
        const text = el('p', 'bst-text', b, '');
        this.cards.set(e.t, { card, img, name, text });
      }
    }

    const foot = el('div', 'map-keys bst-keys', frame);
    for (const [k, t] of [
      [() => bindLabel('bestiary'), 'close'],
      ['Esc', 'close'],
    ]) {
      const s = el('span', 'gh', foot);
      if (typeof k === 'function') liveText(el('span', 'kbd sm', s), k);
      else el('span', 'kbd sm', s, k);
      el('span', '', s, t);
    }
    this.kept = el('span', 'bst-kept', foot, '');

    onBestiary(() => this.open && this.render());
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
    this.ui.root.classList.toggle('bestiary-open', open);
    if (open) {
      this.render();
      this.body.scrollTop = 0;
      this.returnFocus = document.activeElement;
      this.close.focus({ preventScroll: true });
      drawPortraits((t) => this.open && this.renderPic(t)).catch((err) => console.error('bestiary: portraits failed', err));
    } else if (this.returnFocus?.isConnected && !this.returnFocus.closest?.('[hidden]')) {
      this.returnFocus.focus({ preventScroll: true });
      this.returnFocus = null;
    }
  }

  render() {
    const v = (this.view = bestiaryView());
    this.count.textContent = v.loading ? 'Looking up your record…' : `Seen ${seenCount(v.mask)} of ${BESTIARY.length}`;
    this.kept.textContent = v.account ? 'Kept on your account' : 'Kept in this browser';
    for (const [g, [n, list]] of this.groupNs) n.textContent = `${list.filter((e) => v.mask & bit(e.t)).length} / ${list.length}`;
    for (const e of BESTIARY) {
      const c = this.cards.get(e.t);
      const seen = !!(v.mask & bit(e.t));
      c.card.classList.toggle('locked', !seen);
      c.card.classList.toggle('seen', seen);
      c.name.textContent = seen ? e.name : '???';
      c.text.textContent = seen ? e.tip : e.vague;
      this.renderPic(e.t);
    }
  }

  renderPic(t) {
    const c = this.cards.get(t);
    const seen = !!(this.view?.mask & bit(t));
    const src = pics.get(t)?.[seen ? 'clear' : 'dark'] || '';
    if (c.img.getAttribute('src') !== src) {
      if (src) c.img.src = src;
      else c.img.removeAttribute('src');
    }
    c.img.hidden = !src;
  }
}
