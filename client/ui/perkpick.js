// The Perks panel's front page while a point is waiting (progress.js): only what the point can buy now, each card
// saying where it leads - "keep going" (the next step on a path already started, a combination, a keystone) and "start
// something new" (a branch's first perks) - one click to pick a card out, one button (PerkPick.take, which the panel
// puts in its foot) to take it. Your perks are chips along the bottom, each with its own take back (or a padlock and
// why not), and the whole tree is a link away.
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { PERKS, PERK_BY_ID, PERK_GROUPS, TIER, TIER_NAMES, TIER_LEVELS } from '../../shared/progress.js';
import { perkStatus, perkShort, perkLeadsTo, takeBackWhy, BRANCH_ICON, andList } from './perktree.js';

export class PerkPick {
  // onPick(id), onUnpick(id), onTree(): the whole tree
  constructor(parent, { onPick = null, onUnpick = null, onTree = null } = {}) {
    this.onPick = onPick;
    this.onUnpick = onUnpick;
    this.owned = [];
    this.level = 1;
    this.sel = -1;
    this.busy = false;

    const root = (this.root = el('div', 'prk-q', parent));
    const h1 = el('div', 'prk-q-h', root);
    el('b', '', h1, 'Keep going');
    el('span', '', h1, 'the next step on paths you started');
    this.going = el('div', 'prk-q-going', root);
    this.goingNone = el('p', 'prk-q-none', root, '');
    const h2 = el('div', 'prk-q-h', root);
    el('b', '', h2, 'Start something new');
    el('span', '', h2, 'first steps you can take now');
    this.fresh = el('div', 'prk-q-new', root);
    this.freshNone = el('p', 'prk-q-none', root, '');

    const mine = el('div', 'prk-q-mine', root);
    el('span', 'prk-q-mine-h', mine, 'Yours');
    this.chips = el('div', 'prk-q-chips', mine);
    this.chipWhy = el('small', 'prk-q-why', mine, '');
    const tree = el('button', 'prk-q-tree', mine);
    tree.type = 'button';
    svgEl('i', '', tree, glyph('grid'));
    el('span', '', tree, 'Whole tree');
    tree.addEventListener('click', () => onTree?.());

    // the button to take the one picked out, and what to know before (the panel puts these in its foot)
    this.take = el('div', 'prk-q-take');
    this.takeBtn = el('button', 'btn btn-blood', this.take, 'Pick a perk');
    this.takeBtn.type = 'button';
    this.takeBtn.addEventListener('click', () => this.sel >= 0 && this.onPick?.(this.sel));
    el('small', 'prk-q-take-note', this.take, 'Change your mind whenever you like: take a perk back, or start over, for free. One taken during a night works from dawn.');

    root.addEventListener('click', (e) => {
      const n = e.target.closest?.('.prk-qc');
      if (n) {
        this.sel = this.sel === +n.dataset.id ? -1 : +n.dataset.id;
        this._render();
      }
    });
  }

  set(owned, level) {
    this.owned = owned.slice();
    this.level = level;
    if (this.sel >= 0 && perkStatus(this.sel, this.owned, level).state !== 'open') this.sel = -1;
    this._render();
  }

  setBusy(busy) {
    this.busy = !!busy;
    this._render();
  }

  _render() {
    const open = PERKS.filter((p) => perkStatus(p.id, this.owned, this.level).state === 'open');
    const going = open.filter((p) => p.tier > 0).sort((a, b) => b.tier - a.tier);
    const fresh = open.filter((p) => p.tier === 0);
    this.going.textContent = '';
    for (const p of going) this._big(this.going, p);
    this.goingNone.hidden = going.length > 0;
    const next = TIER_LEVELS.find((l) => l > this.level);
    this.goingNone.textContent = this.owned.length ? `Nothing further is open yet${next ? `: the next tier opens at level ${next}` : ''}.` : 'Nothing started yet: take a first step below.';
    this.fresh.textContent = '';
    for (const p of fresh) this._small(this.fresh, p);
    this.freshNone.hidden = fresh.length > 0;
    this.freshNone.textContent = 'Every first step is yours.';

    // your perks: chips, each with its own take back
    this.chips.textContent = '';
    for (const id of this.owned) {
      const p = PERK_BY_ID[id];
      const why = takeBackWhy(this.owned, id);
      const c = el('button', 'prk-chip' + (p.keystone ? ' key' : ''), this.chips);
      c.type = 'button';
      svgEl('i', 'prk-chip-ico', c, glyph(p.icon));
      el('span', '', c, p.name);
      svgEl('i', 'prk-chip-x', c, glyph(why ? 'lock' : 'xmark'));
      c.title = why ? `${why}: take that back first` : `Take ${p.name} back: the point comes back to spend`;
      c.setAttribute('aria-label', c.title);
      c.disabled = this.busy;
      c.classList.toggle('held', !!why);
      c.addEventListener('click', () => {
        if (why) this.chipWhy.textContent = `${p.name}: ${why}`;
        else this.onUnpick?.(id);
      });
      c.addEventListener('pointerenter', () => (this.chipWhy.textContent = why ? `${p.name}: ${why}` : ''));
    }
    if (!this.owned.length) el('span', 'prk-q-none', this.chips, 'No perks yet');

    const p = PERK_BY_ID[this.sel];
    this.takeBtn.textContent = p ? `Take ${p.name}` : 'Pick a perk';
    this.takeBtn.disabled = !p || this.busy;
  }

  _big(parent, p) {
    const c = el('button', 'prk-qc prk-qc-big' + (p.id === this.sel ? ' sel' : '') + (p.keystone ? ' key' : ''), parent);
    c.type = 'button';
    c.dataset.id = String(p.id);
    c.setAttribute('aria-pressed', p.id === this.sel ? 'true' : 'false');
    svgEl('i', 'prk-ico', c, glyph(p.icon));
    const t = el('span', 'prk-t', c);
    const kind = p.keystone ? 'Keystone · one per survivor' : p.tier === TIER.COMBO ? `Combination · ${andList(p.req.map((r) => PERK_BY_ID[r].name))}` : `${PERK_GROUPS[p.group]} · ${TIER_NAMES[p.tier]} · after ${andList(p.req.map((r) => PERK_BY_ID[r].name))}`;
    el('small', 'prk-qc-kind', t, kind);
    el('b', 'prk-name', t, p.name);
    el('span', 'prk-qc-text', t, p.text);
    const leads = perkLeadsTo(p);
    el('small', 'prk-qc-then' + (leads.length ? ' lit' : ''), t, leads.length ? `Then: ${leads.join(' · ')}` : p.tier < TIER.COMBO ? 'Last on its path' : '');
    if (p.id === this.sel) svgEl('i', 'prk-qc-tick', c, glyph('check'));
  }

  _small(parent, p) {
    const c = el('button', 'prk-qc prk-qc-small' + (p.id === this.sel ? ' sel' : ''), parent);
    c.type = 'button';
    c.dataset.id = String(p.id);
    c.setAttribute('aria-pressed', p.id === this.sel ? 'true' : 'false');
    c.title = p.text;
    svgEl('i', 'prk-ico', c, glyph(p.icon));
    const t = el('span', 'prk-t', c);
    el('b', 'prk-name', t, p.name);
    el('span', 'prk-qc-text', t, perkShort(p));
    // the path it starts: the branch, then what each step opens
    const path = [PERK_GROUPS[p.group]];
    for (let q = p; (q = PERKS.find((r) => r.tier < TIER.COMBO && r.req.includes(q.id))); ) path.push(q.name);
    const pt = el('small', 'prk-qc-path', t);
    svgEl('i', '', pt, glyph(BRANCH_ICON[p.group]));
    el('span', '', pt, path.join(' → '));
    if (p.id === this.sel) svgEl('i', 'prk-qc-tick', c, glyph('check'));
  }
}
