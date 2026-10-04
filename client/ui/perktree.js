// The perk tree (shared/progress.js PERKS), all of it at once: the five branches side by side, each three tiers deep
// with a line down from what a perk needs, and under them the combinations and the keystones. Every perk is on it
// whether it can be had or not: yours lit, the ones you could take now bright, the rest greyed out with a lock.
// Hovering one says what it does and what opens it; a click picks it out into the box beside the keystones, which
// has the button to spend a point on it (or take the point back). The Perks panel (progress.js) owns one.
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { PERKS, PERK_BY_ID, PERK_GROUPS, BRANCHES, TIER, TIER_NAMES, PICK_LEVELS, PERK_POINTS, perkLock, perkDependents } from '../../shared/progress.js';

export const BRANCH_ICON = ['heart', 'headshot', 'search', 'cross', 'bolt', 'star', 'link'];
const names = (ids) => ids.map((id) => PERK_BY_ID[id].name);
const andList = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

// What a perk is to someone with `owned` at `level`: { state: 'own' | 'open' | 'full' | 'lock', line }, the line
// saying why in a few words
export function perkStatus(id, owned, level) {
  const p = PERK_BY_ID[id];
  const why = perkLock(owned, id, level);
  const needs = p.keystone ? 'Needs any tier 3 perk' : p.req.length ? `Needs ${andList(names(p.req))}` : '';
  switch (why) {
    case 'owned':
      return { state: 'own', line: 'Yours' };
    case '':
      return { state: 'open', line: 'Open: a point takes it' };
    case 'level':
      return { state: 'lock', line: `Unlocks at level ${p.level}${needs ? ` · ${needs.toLowerCase()}` : ''}` };
    case 'needs':
      return { state: 'lock', line: needs };
    case 'keystone':
      return { state: 'lock', line: `One keystone per survivor: you have ${names(owned.filter((o) => PERK_BY_ID[o].keystone))[0]}` };
    case 'points': {
      const next = PICK_LEVELS.find((l) => l > level);
      return { state: 'full', line: next ? `No point to spend: the next comes at level ${next}` : 'Every point is spent' };
    }
  }
  return { state: 'lock', line: '' };
}

export class PerkTree {
  // onPick(id), onUnpick(id): the box's buttons
  constructor(parent, { onPick = null, onUnpick = null } = {}) {
    this.onPick = onPick;
    this.onUnpick = onUnpick;
    this.owned = [];
    this.level = 1;
    this.sel = -1; // the perk picked out into the box
    this.busy = false;
    this.nodes = new Map(); // id -> { node, link }

    const root = (this.root = el('div', 'pt', parent));
    const branches = el('div', 'pt-branches', root);
    this.branchHeads = [];
    for (let g = 0; g < BRANCHES; g++) {
      const br = el('div', 'pt-br', branches);
      const h = el('div', 'pt-br-h', br);
      svgEl('i', 'pt-br-ico', h, glyph(BRANCH_ICON[g]));
      el('span', 'pt-br-name', h, PERK_GROUPS[g]);
      this.branchHeads.push(el('b', 'pt-br-n', h, ''));
      const grid = el('div', 'pt-grid', br);
      for (const p of PERKS.filter((q) => q.group === g)) this._node(grid, p, p.tier + 1, p.col + 1);
    }
    const foot = el('div', 'pt-foot', root);
    for (const [tier, label, sub] of [
      [TIER.COMBO, 'Combinations', 'a tier 2 perk from two branches'],
      [TIER.KEYSTONE, 'Keystones', 'one per survivor'],
    ]) {
      const row = el('div', 'pt-row', foot);
      const h = el('div', 'pt-row-h', row);
      el('span', 'pt-br-name', h, label);
      el('small', '', h, sub);
      const grid = el('div', 'pt-grid pt-grid-row', row);
      for (const p of PERKS.filter((q) => q.tier === tier)) this._node(grid, p, 1, p.col + 1);
    }

    // the box: the perk picked out, or what the tree is
    const box = (this.box = el('div', 'pt-box', foot));
    this.boxHead = el('div', 'pt-box-h', box);
    this.boxIco = svgEl('i', 'pt-box-ico', this.boxHead, '');
    const bt = el('div', 'pt-box-t', this.boxHead);
    this.boxName = el('div', 'pt-box-name', bt, '');
    this.boxKind = el('div', 'pt-box-kind', bt, '');
    this.boxText = el('div', 'pt-box-text', box, '');
    this.boxLine = el('div', 'pt-box-line', box, '');
    const acts = el('div', 'pt-box-acts', box);
    this.takeBtn = el('button', 'btn btn-blood pt-take', acts, 'Spend a point');
    this.takeBtn.type = 'button';
    this.takeBtn.addEventListener('click', () => this.sel >= 0 && this.onPick?.(this.sel));
    this.backBtn = el('button', 'btn btn-ghost pt-back', acts, 'Take the point back');
    this.backBtn.type = 'button';
    this.backBtn.addEventListener('click', () => this.sel >= 0 && this.onUnpick?.(this.sel));

    // the tooltip over a hovered perk
    this.tip = el('div', 'pt-tip', root);
    this.tip.hidden = true;
    this.tipName = el('div', 'pt-tip-name', this.tip, '');
    this.tipKind = el('div', 'pt-tip-kind', this.tip, '');
    this.tipText = el('div', 'pt-tip-text', this.tip, '');
    this.tipLine = el('div', 'pt-tip-line', this.tip, '');
    root.addEventListener('pointerover', (e) => {
      const n = e.target.closest?.('.pt-node');
      if (n) this._tip(+n.dataset.id, n);
    });
    root.addEventListener('pointerout', (e) => {
      const n = e.target.closest?.('.pt-node');
      if (n && !n.contains(e.relatedTarget)) this.tip.hidden = true;
    });
    root.addEventListener('click', (e) => {
      const n = e.target.closest?.('.pt-node');
      if (n) this.select(+n.dataset.id);
    });
    this._render();
  }

  _node(grid, p, row, col) {
    const node = el('button', 'pt-node' + (p.keystone ? ' key' : '') + (p.tier === TIER.COMBO ? ' combo' : ''), grid);
    node.type = 'button';
    node.dataset.id = String(p.id);
    node.style.gridRow = String(row);
    node.style.gridColumn = String(col);
    const link = p.tier > 0 && p.tier < TIER.COMBO ? el('i', 'pt-link', node) : null;
    const tile = el('span', 'pt-tile', node);
    svgEl('i', 'pt-ico', tile, glyph(p.icon));
    svgEl('i', 'pt-lock', tile, glyph('lock'));
    el('span', 'pt-name', node, p.name);
    this.nodes.set(p.id, { node, link });
  }

  // owned: the perk ids they have; level: theirs
  set(owned, level) {
    this.owned = owned.slice();
    this.level = level;
    this._render();
  }

  setBusy(busy) {
    this.busy = !!busy;
    this._renderBox();
  }

  select(id) {
    this.sel = this.sel === id ? -1 : id;
    this._render();
  }

  _kind(p) {
    if (p.tier >= TIER.COMBO) return `${TIER_NAMES[p.tier]} · level ${p.level}`;
    return `${PERK_GROUPS[p.group]} · ${TIER_NAMES[p.tier]} · level ${p.level}`;
  }

  _tip(id, node) {
    const p = PERK_BY_ID[id];
    const st = perkStatus(id, this.owned, this.level);
    this.tipName.textContent = p.name;
    this.tipKind.textContent = this._kind(p);
    this.tipText.textContent = p.text;
    this.tipLine.textContent = st.line;
    this.tip.className = 'pt-tip ' + st.state;
    this.tip.hidden = false;
    // over the perk, kept inside the tree
    const r = this.root.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    const w = this.tip.offsetWidth;
    const x = Math.max(0, Math.min(r.width - w, n.left - r.left + n.width / 2 - w / 2));
    const above = n.top - r.top - this.tip.offsetHeight - 6;
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${above >= 0 ? above : n.bottom - r.top + 6}px`;
  }

  _render() {
    const owned = this.owned;
    for (const [id, { node, link }] of this.nodes) {
      const p = PERK_BY_ID[id];
      const st = perkStatus(id, owned, this.level);
      node.className = `pt-node ${st.state}` + (p.keystone ? ' key' : '') + (p.tier === TIER.COMBO ? ' combo' : '') + (id === this.sel ? ' sel' : '');
      node.setAttribute('aria-label', `${p.name}: ${p.text}. ${st.line}`);
      node.setAttribute('aria-pressed', id === this.sel ? 'true' : 'false');
      if (link) link.classList.toggle('lit', p.req.every((r) => owned.includes(r)));
    }
    for (let g = 0; g < BRANCHES; g++) {
      const n = owned.filter((id) => PERK_BY_ID[id]?.group === g).length;
      this.branchHeads[g].textContent = n ? String(n) : '';
    }
    this._renderBox();
  }

  _renderBox() {
    const id = this.sel;
    const p = PERK_BY_ID[id];
    this.takeBtn.hidden = this.backBtn.hidden = true;
    if (!p) {
      this.boxIco.innerHTML = glyph('question');
      this.boxName.textContent = 'Pick a perk out';
      this.boxKind.textContent = 'Hover for what it does, click to choose';
      this.boxText.textContent = `Levels up to 30 earn ${PERK_POINTS} perk points in all, so choose: spend them down a branch to open its next tier, on two branches for a combination, and a tier 3 perk opens a keystone.`;
      this.boxLine.textContent = '';
      this.box.className = 'pt-box empty';
      return;
    }
    const st = perkStatus(id, this.owned, this.level);
    this.box.className = 'pt-box ' + st.state;
    this.boxIco.innerHTML = glyph(p.icon);
    this.boxName.textContent = p.name;
    this.boxKind.textContent = this._kind(p);
    this.boxText.textContent = p.text;
    this.boxLine.textContent = st.line;
    if (st.state === 'open' && this.onPick) {
      this.takeBtn.hidden = false;
      this.takeBtn.disabled = this.busy;
    }
    if (st.state === 'own' && this.onUnpick) {
      const need = perkDependents(this.owned, id);
      this.backBtn.hidden = false;
      this.backBtn.disabled = this.busy || need.length > 0;
      this.backBtn.title = need.length ? `${andList(names(need))} need${need.length === 1 ? 's' : ''} it: take ${need.length === 1 ? 'that' : 'those'} back first` : 'The point goes back to be spent again';
      if (need.length) this.boxLine.textContent = `Yours · ${andList(names(need))} need${need.length === 1 ? 's' : ''} it`;
    }
  }
}
