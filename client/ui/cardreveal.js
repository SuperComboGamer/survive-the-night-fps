// A card pack opened (a view of ui/cards.js): the three cards it held, face down, turned over one after another, the
// rare and legendary ones lit up, "new" on a card the player did not have before. One pack at a time, in the order they
// were picked up (game/cards.js keeps them waiting); Take them (or Enter, Space) goes on to the next, then back.
import { cardDef, RAR, STARTER } from '../../shared/cards.js';
import { ITEM, ITEM_DEFS } from '../../shared/defs.js';
import { el } from './dom.js';
import { cardFace, cardBack } from './cardface.js';

const STAGGER = 420; // ms between two cards turning over

export class RevealView {
  constructor(screen, parent) {
    this.sc = screen;
    this.root = el('div', 'cd-view cd-reveal', parent);
    this.head = el('div', 'cd-reveal-h', this.root);
    this.sub = el('p', 'cd-hint', this.root, '');
    this.row = el('div', 'cd-reveal-row', this.root);
    const acts = el('div', 'cd-over-acts', this.root);
    this.take = el('button', 'btn btn-blood', acts, 'Take them');
    this.take.type = 'button';
    this.take.addEventListener('click', () => this.next());
    this.shown = null;
    this.timers = [];
  }

  get c() {
    return this.sc.c;
  }

  render() {
    const p = this.c?.s.reveals[0];
    if (!p) {
      this.shown = null;
      this.head.textContent = 'No packs to open';
      this.sub.textContent = 'Card packs turn up in duffel bags, lockers, trunks and cabinets, and the bosses carry sealed ones.';
      this.row.textContent = '';
      this.take.textContent = 'Back';
      return;
    }
    if (this.shown === p) return;
    this.shown = p;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const sealed = p.item === ITEM.SEALED_PACK;
    this.head.textContent = `${ITEM_DEFS[p.item]?.name || 'A card pack'}${this.c.s.reveals.length > 1 ? ` (1 of ${this.c.s.reveals.length})` : ''}`;
    this.sub.textContent = p.kept ? 'Yours to keep, from game to game.' : 'Yours for as long as this browser keeps them: sign in to keep them for good.';
    this.take.textContent = this.c.s.reveals.length > 1 ? 'Next pack' : 'Take them';
    this.row.textContent = '';
    this.row.classList.toggle('sealed', sealed);
    const found = this.c.s.found;
    const counted = {};
    p.cards.forEach((id, i) => {
      const c = cardDef(id);
      if (!c) return;
      const slot = el('div', 'cd-flip', this.row);
      const inner = el('div', 'cd-flip-in', slot);
      inner.appendChild(cardBack({ cls: 'cd-flip-back' }));
      const face = cardFace(c, { cls: 'cd-flip-face' });
      inner.appendChild(face);
      // new: none of it before this pack (owned now, less what this pack brought)
      counted[id] = (counted[id] || 0) + 1;
      const before = (STARTER[id] || 0) + (found[id] || 0) - p.cards.filter((x) => x === id).length;
      if (before <= 0 && counted[id] === 1) el('b', 'cd-new', slot, 'new');
      if (c.r >= RAR.R) slot.classList.add(c.r === RAR.L ? 'leg' : 'rare');
      this.timers.push(
        setTimeout(
          () => {
            slot.classList.add('up');
            this.c.g.audio?.playLocal?.('card_flip', { volume: 0.6 });
          },
          250 + i * STAGGER,
        ),
      );
    });
  }

  // the next pack, or back to where the player was
  next() {
    const s = this.c.s;
    if (s.reveals.length) s.reveals.shift();
    this.shown = null;
    if (s.reveals.length) this.render();
    else this.sc.show(s.match ? 'table' : s.trade ? 'trade' : 'table');
  }
}
