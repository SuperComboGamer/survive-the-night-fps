// A trade between two teammates (a view of ui/cards.js): what each puts on the table, side by side - found cards (the
// starter set is everyone's and stays put) and what is in the backpack. My side is built here and sent whole each
// time it changes (OFFER); theirs is the server's word on it. Both say Ready, then both Confirm, and only then does
// anything change hands (all of it or none: server/cards.js); a change to either side takes both back to not ready.
// Walking off calls it off (the server's TRADE_BREAK).
import { ITEM_DEFS } from '../../shared/defs.js';
import { cardDef } from '../../shared/cards.js';
import { el, svgEl } from './dom.js';
import { itemIcon } from './icons.js';
import { cardFace } from './cardface.js';

const SEND_AFTER = 180; // ms of quiet before an offer changed goes out

export class TradeView {
  constructor(screen, parent) {
    this.sc = screen;
    this.root = el('div', 'cd-view cd-trade', parent);
    this.offer = null; // { cards: { id: n }, items: { item: n } } as built here
    this.with = 0;
    const cols = el('div', 'cd-trade-cols', this.root);
    const mine = el('div', 'cd-trade-side mine paper', cols);
    this.mineH = el('div', 'cd-trade-h', mine, 'You give');
    this.mineList = el('div', 'cd-offer', mine);
    el('div', 'cd-label', mine, 'Your found cards');
    this.cardsBox = el('div', 'cd-trade-pool', mine);
    el('div', 'cd-label', mine, 'Your backpack');
    this.itemsBox = el('div', 'cd-trade-items', mine);
    const theirs = el('div', 'cd-trade-side theirs paper', cols);
    this.theirsH = el('div', 'cd-trade-h', theirs, '');
    this.theirsList = el('div', 'cd-offer', theirs);
    this.theirsNote = el('p', 'cd-hint', theirs, '');
    const foot = el('div', 'cd-trade-foot', this.root);
    this.status = el('div', 'cd-trade-status', foot);
    this.readyB = el('button', 'btn', foot, 'Ready');
    this.readyB.type = 'button';
    this.readyB.addEventListener('click', () => this.c.ready(!this.c.s.trade?.ready[0]));
    this.confirmB = el('button', 'btn btn-blood', foot, 'Confirm');
    this.confirmB.type = 'button';
    this.confirmB.addEventListener('click', () => this.c.confirm());
    this.closeB = el('button', 'btn btn-ghost btn-danger', foot, 'Call it off');
    this.closeB.type = 'button';
    this.closeB.addEventListener('click', () => this.c.closeTrade());
  }

  get c() {
    return this.sc.c;
  }

  // what is in the backpack, by item: { item: n }
  backpack() {
    const out = {};
    for (const s of this.c.g.inventory?.slots || []) if (s && s.item && ITEM_DEFS[s.item]) out[s.item] = (out[s.item] || 0) + s.count;
    return out;
  }

  render() {
    const t = this.c?.s.trade;
    if (!t) return;
    if (t.with !== this.with || !this.offer) {
      this.with = t.with;
      this.offer = { cards: { ...t.mine.cards }, items: Object.fromEntries(t.mine.items) };
    }
    const who = this.c.name(t.with);
    this.theirsH.textContent = `${who} gives`;
    // my side
    this.renderOffer(this.mineList, this.offer.cards, Object.entries(this.offer.items).map(([i, n]) => [+i, n]), true);
    const found = this.c.s.found;
    this.cardsBox.textContent = '';
    const ids = Object.keys(found)
      .map(Number)
      .filter((id) => found[id] - (this.offer.cards[id] || 0) > 0 && cardDef(id));
    for (const id of ids) {
      const f = cardFace(id, { mini: true });
      f.classList.add('pickable');
      el('b', 'cd-n', f, `×${found[id] - (this.offer.cards[id] || 0)}`);
      f.title = `Put a ${cardDef(id).name} in`;
      f.addEventListener('click', () => this.change('cards', id, 1));
      this.cardsBox.appendChild(f);
    }
    if (!ids.length) el('p', 'cd-none', this.cardsBox, Object.keys(found).length ? 'All of them are in.' : 'No found cards yet: the starter set is not traded.');
    const pack = this.backpack();
    this.itemsBox.textContent = '';
    const items = Object.keys(pack)
      .map(Number)
      .filter((i) => pack[i] - (this.offer.items[i] || 0) > 0);
    for (const i of items) {
      const b = svgEl('button', 'cd-item', this.itemsBox, itemIcon(i));
      b.type = 'button';
      el('b', 'cd-n', b, `×${pack[i] - (this.offer.items[i] || 0)}`);
      b.title = `${ITEM_DEFS[i].name}: click for one, shift-click for all`;
      b.addEventListener('click', (e) => this.change('items', i, e.shiftKey ? pack[i] - (this.offer.items[i] || 0) : 1));
    }
    if (!items.length) el('p', 'cd-none', this.itemsBox, 'Nothing left in your backpack.');
    // theirs
    this.renderOffer(this.theirsList, t.theirs.cards, t.theirs.items, false);
    this.theirsNote.textContent = t.ready[1] ? `${who} is ready.` : `${who} is still choosing.`;
    // where it stands
    const both = t.ready[0] && t.ready[1];
    this.readyB.textContent = t.ready[0] ? 'Not ready' : 'Ready';
    this.readyB.classList.toggle('on', t.ready[0]);
    this.confirmB.disabled = !both || t.ok[0] || t.committing;
    this.confirmB.textContent = t.ok[0] ? 'Confirmed' : 'Confirm';
    this.status.textContent = t.committing ? 'Striking the deal…' : both ? (t.ok[0] ? `Waiting for ${who} to confirm` : t.ok[1] ? `${who} confirmed: your turn` : 'Both ready: confirm to swap') : t.ready[0] ? `Waiting for ${who} to be ready` : 'Put in what you will give, then say Ready';
    this.status.classList.toggle('good', both);
  }

  renderOffer(box, cards, items, mine) {
    box.textContent = '';
    let any = false;
    for (const [id, n] of Object.entries(cards)) {
      if (!(n > 0) || !cardDef(+id)) continue;
      any = true;
      const f = cardFace(+id, { mini: true });
      el('b', 'cd-n', f, `×${n}`);
      if (mine) {
        f.classList.add('pickable');
        f.title = 'Take one back';
        f.addEventListener('click', () => this.change('cards', +id, -1));
      }
      box.appendChild(f);
    }
    for (const [i, n] of items) {
      if (!(n > 0) || !ITEM_DEFS[i]) continue;
      any = true;
      const b = svgEl(mine ? 'button' : 'div', 'cd-item', box, itemIcon(i));
      if (mine) b.type = 'button';
      el('b', 'cd-n', b, `×${n}`);
      b.title = ITEM_DEFS[i].name + (mine ? ': click to take one back' : '');
      if (mine) b.addEventListener('click', () => this.change('items', i, -1));
    }
    if (!any) el('p', 'cd-none', box, mine ? 'Nothing yet: click cards and items below.' : 'Nothing yet.');
  }

  change(kind, id, d) {
    const o = this.offer[kind];
    const n = Math.max(0, (o[id] || 0) + d);
    if (n) o[id] = n;
    else delete o[id];
    this.render();
    clearTimeout(this.sendT);
    this.sendT = setTimeout(() => this.send(), SEND_AFTER);
  }

  send() {
    const items = Object.entries(this.offer.items).map(([i, n]) => [+i, n]);
    this.c.offer({ ...this.offer.cards }, items);
  }

  leave() {
    if (this.sendT) {
      clearTimeout(this.sendT);
      this.sendT = 0;
      if (this.c?.s.trade) this.send();
    }
  }
}

