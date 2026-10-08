// The perk tree (shared/progress.js PERKS), drawn as a timeline: the branches down the left, and across them the
// levels the tiers open at (2, 6, 12, then the combinations at 14 and the keystones at 20), so each branch reads like
// a sentence from left to right (Thick Skin -> Field Medic -> Hardened). Every card says what the perk does and, by
// a shape as well as its colour, whether it is yours (a tick), a point takes it now (a +) or it is out of reach (a
// padlock). The combinations sit between the two branches they need, wired to both.
//
// A click picks a perk out into the bar under the tree (PerkTree.bar, which the Perks panel puts in its foot): what it
// does, what it leads to, what it would change in your numbers (before and after, flagging a perk the 25% limit
// leaves with nothing to add), and the button to spend a point on it or take it back, saying why when it cannot.
//
// In a narrow window (browser zoom, a small screen) the timeline gives way to a list: one branch at a time behind
// tabs, a row a perk with its own Take / Take back, and the same before and after under the row picked out.
// The Perks panel (progress.js) owns one.
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { PERKS, PERK_BY_ID, PERK_GROUPS, BRANCHES, TIER, TIER_NAMES, TIER_LEVELS, PICK_LEVELS, PERK_POINTS, PERK_CAP, NO_PERKS, perkLock, perkDependents, perkMods, perkMask } from '../../shared/progress.js';

export const BRANCH_ICON = ['heart', 'headshot', 'search', 'cross', 'bolt', 'star', 'link'];
export const BRANCH_LINE = ['Hard to put down', 'Quicker and surer with a gun', 'More out of the valley', 'Keeping the team on its feet', 'Getting there, and not being seen'];
const names = (ids) => ids.map((id) => PERK_BY_ID[id].name);
export const andList = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
const orList = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} or ${a.at(-1)}`);
const CAP_PCT = Math.round(PERK_CAP * 100);

// What each perk does, in the few words a card has room for (the full sentence is PERKS' text)
export const PERK_SHORT = {
  0: '+10 max health',
  1: 'Sprint drain −15%',
  3: 'Heal 25% faster',
  2: 'Swim 15% faster',
  20: 'Damage taken −15%',
  4: 'Reload 15% faster',
  5: 'Recoil −20%',
  7: 'Kill drops +25%',
  6: 'Headshots +15%',
  21: '+5 health a kill',
  9: 'Search 25% faster',
  10: '1 in 4 extra scrap',
  8: '1 in 4 extra find',
  22: 'Melee +20%',
  23: 'Extra find 1 in 2',
  11: 'Revive 25% faster',
  13: 'Revive XP +50%',
  12: 'Revived +20 health',
  24: 'All XP +10%',
  25: '+20 health a revive',
  14: 'Sprint 8% faster',
  15: 'Noticed 15% closer',
  16: 'Stun −25%',
  26: 'Noticed 10% closer',
  27: 'Sprint drain −10%',
  28: 'Heal, revive 15% faster',
  29: 'Headshots +10%, quieter',
  30: 'Drops +15%, search faster',
  17: 'Bleed out 2× slower',
  18: '+10 stamina a kill',
  19: 'Survive a downing blow',
};
export const perkShort = (p) => PERK_SHORT[p.id] ?? p.text;

// ---------------------------------------------------------------- what a perk is to you
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

// Why a perk you have cannot be taken back ('' when it can): the perks that need it
export function takeBackWhy(owned, id) {
  const need = perkDependents(owned, id);
  return need.length ? `${andList(names(need))} need${need.length === 1 ? 's' : ''} it` : '';
}

// "Survivor · Tier 3 · after Field Medic", what a perk is and where it hangs
export function perkKind(p, { after = false } = {}) {
  if (p.keystone) return `Keystone · level ${p.level} · one per survivor`;
  if (p.tier === TIER.COMBO) return `Combination · level ${p.level}`;
  const head = `${PERK_GROUPS[p.group]} · ${TIER_NAMES[p.tier]} · level ${p.level}`;
  return after && p.req.length ? `${head} · after ${andList(names(p.req))}` : head;
}

// What taking a perk leads to, a phrase each: the next on its path, a combination it is half of, the keystones
export function perkLeadsTo(p) {
  const out = [];
  if (p.tier < TIER.COMBO) {
    const next = PERKS.find((q) => q.tier < TIER.COMBO && q.req.includes(p.id));
    if (next) out.push(`opens ${next.name} at level ${next.level}`);
    if (p.tier === 2) out.push(`opens a keystone at level ${TIER_LEVELS[TIER.KEYSTONE]}: ${orList(names(PERKS.filter((q) => q.keystone).map((q) => q.id)))}`);
    for (const c of PERKS.filter((q) => q.tier === TIER.COMBO && q.req.includes(p.id))) {
      const other = PERK_BY_ID[c.req.find((r) => r !== p.id)];
      out.push(`with ${other.name} (${PERK_GROUPS[other.group]}) opens ${c.name}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- before and after
// The numbers a perk moves, as a player reads them. mul: a multiplier (shown as a percentage off 1); else an amount.
const STATS = {
  hp: ['Max health', 'add'],
  staminaDrain: ['Sprint stamina drain', 'mul'],
  swim: ['Swim speed', 'mul'],
  swimDrain: ['Treading water drain', 'mul'],
  useTime: ['Healing, eating time', 'mul'],
  reload: ['Reload time', 'mul'],
  recoil: ['Recoil', 'mul'],
  headshot: ['Headshot damage', 'mul'],
  drops: ['Kill drop chance', 'mul'],
  extraFind: ['Extra find chance', 'chance'],
  search: ['Search time', 'mul'],
  gather: ['Extra sticks or scrap', 'chance'],
  revive: ['Revive time', 'mul'],
  reviveHp: ['Revived teammates get', 'hp'],
  reviveXp: ['XP for a revive', 'mul'],
  sprint: ['Sprint speed', 'mul'],
  notice: ['Distance the dead notice you', 'mul'],
  stun: ['Knockdown stun', 'mul'],
  bleed: ['Bleeding out', 'mul'],
  killStamina: ['Stamina back a kill', 'add'],
  secondChance: ['A downing blow, once a night', 'once'],
  hurt: ['Damage taken', 'mul'],
  melee: ['Melee damage', 'mul'],
  xp: ['XP earned', 'mul'],
  killHeal: ['Health back a kill', 'add'],
  reviveSelf: ['Health back a revive', 'add'],
};

export function fmtStat(k, v) {
  const kind = STATS[k]?.[1] ?? 'mul';
  if (v === NO_PERKS[k]) return '—';
  switch (kind) {
    case 'mul': {
      const pct = Math.round((v - 1) * 1000) / 10;
      const n = Math.abs(pct) % 1 ? Math.abs(pct).toFixed(1) : String(Math.abs(pct));
      return `${pct > 0 ? '+' : '−'}${n}%`;
    }
    case 'chance':
      return `${Math.round(v * 100)}%`;
    case 'hp':
      return `+${v} health`;
    case 'once':
      return 'leaves you on 1 health';
    default:
      return `+${v}`;
  }
}

// What taking (or, for one you have, taking back) a perk does to your numbers: { back, rows: [{ key, label, from, to,
// capped }], nothing }. capped: the 25% limit took some of what the perk says; nothing: it changes no number at all.
export function perkChange(owned, id) {
  const p = PERK_BY_ID[id];
  const back = owned.includes(id);
  const rest = owned.filter((o) => o !== id);
  const now = perkMods(perkMask(back ? owned : rest));
  const then = perkMods(perkMask(back ? rest : [...rest, id]));
  const rows = Object.entries(p.mods).map(([k, v]) => {
    const mul = NO_PERKS[k] === 1;
    const want = back ? (mul ? now[k] / v : now[k] - v) : mul ? now[k] * v : now[k] + v;
    return { key: k, label: STATS[k]?.[0] ?? k, from: fmtStat(k, now[k]), to: fmtStat(k, then[k]), capped: Math.abs(then[k] - want) > 1e-6, same: Math.abs(then[k] - now[k]) < 1e-9 };
  });
  return { back, rows, nothing: rows.every((r) => r.same) };
}

// Fill a before-and-after box (cleared first) for a perk
export function fillChange(box, owned, id) {
  box.textContent = '';
  const c = perkChange(owned, id);
  el('div', 'prk-fx-h', box, c.back ? 'Taking it back' : 'What it changes for you');
  const t = el('div', 'prk-fx-rows', box);
  for (const r of c.rows) {
    const row = el('div', 'prk-fx-row' + (r.same ? ' same' : ''), t);
    el('span', 'prk-fx-l', row, r.label);
    el('span', 'prk-fx-a', row, r.from);
    el('span', 'prk-fx-ar', row, '→');
    el('b', 'prk-fx-b', row, r.to);
  }
  box.classList.toggle('warn', c.nothing && !c.back);
  box.classList.toggle('back', c.back);
  if (c.nothing && !c.back) el('div', 'prk-fx-note', box, `Adds nothing for you: what you have already takes this to the ${CAP_PCT}% limit.`);
  else if (c.rows.some((r) => r.capped) && !c.back) el('div', 'prk-fx-note', box, `Part of it is lost to the ${CAP_PCT}% limit on bonuses.`);
  return c;
}

// ---------------------------------------------------------------- the tree
const ROW_ORDER = [0, 3, 4, 1, 2]; // the branches top to bottom: each combination between the two it needs
const STATE_GLYPH = { own: 'check', open: 'plus', full: 'plus', lock: 'lock' };
const STATE_WORD = { own: 'Taken', open: 'Open', full: 'No point', lock: 'Locked' };
const NARROW = 58; // rem: below this the timeline (the least it fits in, ux-perks.css .prk-grid) gives way to the list

export class PerkTree {
  // onPick(id), onUnpick(id): its buttons
  constructor(parent, { onPick = null, onUnpick = null } = {}) {
    this.onPick = onPick;
    this.onUnpick = onUnpick;
    this.owned = [];
    this.level = 1;
    this.sel = -1; // the perk picked out
    this.busy = false;
    this.tab = -1; // the list's tab: a branch, BRANCHES for the combinations, BRANCHES + 1 for the keystones
    this.narrow = false;
    this.cards = new Map(); // id -> { card, glyph, link }

    const root = (this.root = el('div', 'prk', parent));
    this._timeline(root);
    this._list(root);
    this._bar();

    root.addEventListener('click', (e) => {
      const n = e.target.closest?.('[data-id]');
      if (n && root.contains(n) && !e.target.closest('.prk-row-act')) this.select(+n.dataset.id);
    });
    this.ro = new ResizeObserver(() => this._layout());
    this.ro.observe(root);
    this._render();
  }

  // ---------------------------------------------------------------- building
  _timeline(root) {
    const tl = (this.tl = el('div', 'prk-tl', root));
    const grid = (this.grid = el('div', 'prk-grid', tl));
    this.wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.wires.setAttribute('class', 'prk-wires');
    this.wires.setAttribute('aria-hidden', 'true');
    grid.appendChild(this.wires);

    // the column heads: the level each opens at
    const corner = el('div', 'prk-colh prk-colh-br', grid, 'Branch');
    corner.style.gridArea = '1 / 1';
    this.colHeads = [];
    for (let t = 0; t <= TIER.KEYSTONE; t++) {
      const h = el('div', 'prk-colh', grid);
      h.style.gridArea = `1 / ${t + 2}`;
      el('b', '', h, `LV ${TIER_LEVELS[t]}`);
      el('span', '', h, TIER_NAMES[t]);
      this.colHeads.push({ h, away: el('em', '', h, '') });
    }

    // the branches: two chains each, the one a combination hangs off nearest to it
    const rowOf = new Map(); // perk id -> its grid row
    ROW_ORDER.forEach((g, i) => {
      const lean = (col) => {
        let s = 0;
        for (const p of PERKS.filter((q) => q.group === g && q.col === col))
          for (const c of PERKS.filter((q) => q.tier === TIER.COMBO && q.req.includes(p.id))) {
            const other = ROW_ORDER.indexOf(PERK_BY_ID[c.req.find((r) => r !== p.id)].group);
            s += other < i ? -1 : 1;
          }
        return s;
      };
      const cols = [0, 1].sort((a, b) => lean(a) - lean(b));
      const top = 2 + i * 2;
      const band = el('div', 'prk-band', grid);
      band.style.gridArea = `${top} / 1 / span 2 / 5`;
      const lab = el('div', 'prk-brh', grid);
      lab.style.gridArea = `${top} / 1 / span 2`;
      const name = el('div', 'prk-brh-n', lab);
      svgEl('i', 'prk-brh-ico', name, glyph(BRANCH_ICON[g]));
      el('span', '', name, PERK_GROUPS[g]);
      el('small', 'prk-brh-line', lab, BRANCH_LINE[g]);
      (this.brCount ??= [])[g] = el('b', 'prk-brh-c', lab, '');
      cols.forEach((col, j) => {
        for (const p of PERKS.filter((q) => q.group === g && q.col === col)) {
          rowOf.set(p.id, top + j);
          this._card(grid, p, `${top + j} / ${p.tier + 2}`);
        }
      });
    });
    // the combinations, between the branches they need
    for (const p of PERKS.filter((q) => q.tier === TIER.COMBO)) {
      const r = Math.min(...p.req.map((id) => rowOf.get(id)));
      this._card(grid, p, `${r} / ${TIER.COMBO + 2} / span 2`, 'prk-combo');
    }
    // the keystones: a column of their own, open to any tier 3
    const keys = el('div', 'prk-keys', grid);
    keys.style.gridArea = `2 / ${TIER.KEYSTONE + 2} / span ${ROW_ORDER.length * 2}`;
    const kn = el('p', 'prk-keys-n', keys);
    svgEl('i', 'prk-keys-ico', kn, glyph('link'));
    el('span', '', kn, 'Any tier 3 perk opens these. You can hold one.');
    for (const p of PERKS.filter((q) => q.keystone)) this._card(keys, p, '');
  }

  _card(parent, p, area, cls = '') {
    const base = `prk-card ${cls}` + (p.keystone ? ' key' : '');
    const card = el('button', base, parent);
    card.type = 'button';
    card.dataset.id = String(p.id);
    if (area) card.style.gridArea = area;
    const link = p.tier > 0 && p.tier < TIER.COMBO ? el('i', 'prk-in', card) : null;
    svgEl('i', 'prk-ico', card, glyph(p.icon));
    const t = el('span', 'prk-t', card);
    el('b', 'prk-name', t, p.name);
    el('small', 'prk-fx', t, perkShort(p));
    const g = svgEl('i', 'prk-st', card, '');
    this.cards.set(p.id, { card, base, glyph: g, link });
  }

  _list(root) {
    const ls = (this.ls = el('div', 'prk-ls', root));
    const tabs = (this.tabs = el('div', 'prk-tabs', ls));
    tabs.setAttribute('role', 'tablist');
    this.tabBtns = [];
    const labels = [...PERK_GROUPS.slice(0, BRANCHES), 'Combinations', 'Keystones'];
    const icons = [...BRANCH_ICON.slice(0, BRANCHES), 'link', 'star'];
    labels.forEach((name, i) => {
      const b = el('button', 'prk-tab', tabs);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      svgEl('i', 'prk-tab-ico', b, glyph(icons[i]));
      el('span', 'prk-tab-n', b, name);
      const badge = el('small', 'prk-tab-b', b, '');
      b.addEventListener('click', () => {
        this.tab = i;
        this._renderList();
      });
      this.tabBtns.push({ b, badge });
    });
    this.rows = el('div', 'prk-rows', ls);
  }

  // the bar under the tree: the perk picked out, its before and after, and its button
  _bar() {
    const bar = (this.bar = el('div', 'prk-bar empty'));
    this.barIco = svgEl('i', 'prk-bar-ico', bar, glyph('question'));
    const t = el('div', 'prk-bar-t', bar);
    this.barName = el('div', 'prk-bar-name', t, '');
    this.barKind = el('div', 'prk-bar-kind', t, '');
    this.barText = el('div', 'prk-bar-text', t, '');
    this.barThen = el('div', 'prk-bar-then', t, '');
    this.barFx = el('div', 'prk-fxbox', bar);
    const acts = el('div', 'prk-bar-acts', bar);
    this.takeBtn = el('button', 'btn btn-blood prk-take', acts, 'Spend 1 point');
    this.takeBtn.type = 'button';
    this.takeBtn.addEventListener('click', () => this.sel >= 0 && this.onPick?.(this.sel));
    this.backBtn = el('button', 'btn btn-ghost prk-back', acts, 'Take back');
    this.backBtn.type = 'button';
    this.backBtn.addEventListener('click', () => this.sel >= 0 && this.onUnpick?.(this.sel));
    this.barWhy = el('small', 'prk-bar-why', acts, '');
  }

  // ---------------------------------------------------------------- state
  // owned: the perk ids they have; level: theirs
  set(owned, level) {
    this.owned = owned.slice();
    this.level = level;
    this._render();
  }

  setBusy(busy) {
    this.busy = !!busy;
    this._renderBar();
    if (this.narrow) this._renderList();
  }

  select(id) {
    this.sel = this.sel === id ? -1 : id;
    const p = PERK_BY_ID[this.sel];
    if (p && this.narrow) this.tab = p.keystone ? BRANCHES + 1 : p.tier === TIER.COMBO ? BRANCHES : p.group;
    this._render();
  }

  _layout() {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const narrow = this.root.clientWidth > 0 && this.root.clientWidth < NARROW * rem;
    if (narrow !== this.narrow) {
      this.narrow = narrow;
      this._render();
    } else if (!narrow) this._wire();
  }

  _render() {
    this.root.classList.toggle('narrow', this.narrow);
    this.bar.hidden = this.narrow;
    const owned = this.owned;
    for (const [id, { card, base, glyph: g, link }] of this.cards) {
      const p = PERK_BY_ID[id];
      const st = perkStatus(id, owned, this.level);
      card.className = `${base} ${st.state}` + (id === this.sel ? ' sel' : '');
      g.innerHTML = glyph(STATE_GLYPH[st.state]);
      card.setAttribute('aria-label', `${p.name}: ${p.text}. ${st.line}`);
      card.setAttribute('aria-pressed', id === this.sel ? 'true' : 'false');
      if (link) link.classList.toggle('lit', p.req.every((r) => owned.includes(r)));
    }
    for (let g = 0; g < BRANCHES; g++) {
      const n = owned.filter((id) => PERK_BY_ID[id]?.group === g).length;
      const all = PERKS.filter((p) => p.group === g).length;
      this.brCount[g].textContent = n ? `${n} of ${all} taken` : '';
    }
    // the columns not open yet, and how far off the next is
    let first = true;
    TIER_LEVELS.forEach((lv, t) => {
      const { h, away } = this.colHeads[t];
      const shut = this.level < lv;
      h.classList.toggle('shut', shut);
      away.textContent = shut && first ? `${lv - this.level} level${lv - this.level === 1 ? '' : 's'} away` : '';
      if (shut) first = false;
    });
    this._renderBar();
    if (this.narrow) this._renderList();
    else requestAnimationFrame(() => this._wire());
  }

  // the wires from a combination to the two perks it needs: down (or up) out of each to the line between the branches,
  // then along it into the combination; lit once that perk is yours
  _wire() {
    const svg = this.wires;
    if (this.narrow || !this.grid.offsetWidth) return;
    const g = this.grid.getBoundingClientRect();
    svg.setAttribute('width', String(this.grid.scrollWidth));
    svg.setAttribute('height', String(this.grid.scrollHeight));
    let d = '';
    let lit = '';
    for (const p of PERKS.filter((q) => q.tier === TIER.COMBO)) {
      const c = this.cards.get(p.id).card.getBoundingClientRect();
      const cy = c.top + c.height / 2 - g.top;
      for (const r of p.req) {
        const n = this.cards.get(r).card.getBoundingClientRect();
        const x = n.right - g.left - Math.min(28, n.width * 0.2);
        const y0 = n.top + n.height / 2 < c.top + c.height / 2 ? n.bottom - g.top : n.top - g.top;
        const seg = `M${x.toFixed(1)} ${y0.toFixed(1)}V${cy.toFixed(1)}H${(c.left - g.left).toFixed(1)}`;
        if (this.owned.includes(r)) lit += seg;
        else d += seg;
      }
    }
    svg.innerHTML = `<path class="prk-wire" d="${d}"/><path class="prk-wire lit" d="${lit}"/>`;
  }

  // ---------------------------------------------------------------- the bar
  _renderBar() {
    const id = this.sel;
    const p = PERK_BY_ID[id];
    this.takeBtn.hidden = this.backBtn.hidden = true;
    this.barWhy.textContent = '';
    if (!p) {
      this.bar.className = 'prk-bar empty';
      this.barIco.innerHTML = glyph('question');
      this.barName.textContent = 'Pick a perk out';
      this.barKind.textContent = 'Click any card';
      this.barText.textContent = `Levels up to 30 earn ${PERK_POINTS} perk points in all. Spend them down a branch to open its next tier, on two branches for a combination; any tier 3 perk opens a keystone.`;
      this.barThen.textContent = '';
      this.barFx.hidden = true;
      return;
    }
    const st = perkStatus(id, this.owned, this.level);
    this.bar.className = 'prk-bar ' + st.state + (p.keystone ? ' key' : '');
    this.barIco.innerHTML = glyph(p.icon);
    this.barName.textContent = p.name;
    this.barKind.textContent = `${perkKind(p)} · ${STATE_WORD[st.state]}`;
    this.barText.textContent = p.text;
    const then = perkLeadsTo(p);
    const needs = p.tier === TIER.COMBO ? `Needs ${andList(p.req.map((r) => `${PERK_BY_ID[r].name} (${PERK_GROUPS[PERK_BY_ID[r].group]})`))}` : '';
    this.barThen.textContent = st.state === 'lock' ? st.line : then.length ? `Then: ${then.join(' · ')}` : needs;
    this.barThen.classList.toggle('bad', st.state === 'lock');
    this.barFx.hidden = false;
    fillChange(this.barFx, this.owned, id);
    if (this.onPick && st.state !== 'own') {
      this.takeBtn.hidden = false;
      this.takeBtn.disabled = this.busy || st.state !== 'open';
      if (st.state === 'full') this.barWhy.textContent = st.line;
      else if (st.state === 'open') this.barWhy.textContent = 'Taken at night, it works from dawn';
    }
    if (st.state === 'own' && this.onUnpick) {
      const why = takeBackWhy(this.owned, id);
      this.backBtn.hidden = false;
      this.backBtn.disabled = this.busy || !!why;
      this.barWhy.textContent = why ? `${why}: take that back first` : 'The point comes back to spend again';
      this.barWhy.classList.toggle('bad', !!why);
    } else this.barWhy.classList.remove('bad');
  }

  // ---------------------------------------------------------------- the list (narrow windows)
  _tabPerks(i) {
    if (i === BRANCHES) return PERKS.filter((p) => p.tier === TIER.COMBO);
    if (i === BRANCHES + 1) return PERKS.filter((p) => p.keystone);
    return PERKS.filter((p) => p.group === i).sort((a, b) => a.tier - b.tier || a.col - b.col);
  }

  _renderList() {
    const owned = this.owned;
    const open = (i) => this._tabPerks(i).filter((p) => perkStatus(p.id, owned, this.level).state === 'open').length;
    if (this.tab < 0) {
      this.tab = 0;
      for (let i = 0; i < BRANCHES + 2; i++)
        if (open(i)) {
          this.tab = i;
          break;
        }
    }
    this.tabBtns.forEach(({ b, badge }, i) => {
      const on = i === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      const n = open(i);
      const mine = this._tabPerks(i).filter((p) => owned.includes(p.id)).length;
      badge.textContent = n ? `${n} open` : mine ? `${mine} taken` : '';
      badge.className = 'prk-tab-b' + (n ? ' lit' : '');
    });
    const rows = this.rows;
    rows.textContent = '';
    let tier = -1;
    for (const p of this._tabPerks(this.tab)) {
      if (p.tier !== tier) {
        tier = p.tier;
        const h = el('div', 'prk-rows-h', rows);
        el('b', '', h, TIER_NAMES[tier]);
        el('span', '', h, `open from level ${TIER_LEVELS[tier]}`);
        if (tier === TIER.KEYSTONE) el('span', 'prk-rows-hr', h, 'any tier 3 perk opens them · one only');
        else if (tier === TIER.COMBO) el('span', 'prk-rows-hr', h, 'a tier 2 perk from two branches');
        else if (tier > 0) el('span', 'prk-rows-hr', h, 'each needs the one before it');
      }
      this._row(rows, p);
    }
  }

  _row(parent, p) {
    const st = perkStatus(p.id, this.owned, this.level);
    const row = el('div', `prk-row ${st.state}` + (p.keystone ? ' key' : '') + (p.id === this.sel ? ' sel' : ''), parent);
    const main = el('button', 'prk-row-main', row);
    main.type = 'button';
    main.dataset.id = String(p.id);
    main.setAttribute('aria-expanded', p.id === this.sel ? 'true' : 'false');
    svgEl('i', 'prk-ico', main, glyph(p.icon));
    const t = el('span', 'prk-t', main);
    el('b', 'prk-name', t, p.name);
    el('span', 'prk-row-text', t, p.text);
    const sub = [];
    if (p.req.length && p.tier < TIER.COMBO) sub.push(`after ${andList(names(p.req))}`);
    if (p.tier === TIER.COMBO) sub.push(`needs ${andList(p.req.map((r) => `${PERK_BY_ID[r].name} (${PERK_GROUPS[PERK_BY_ID[r].group]})`))}`);
    sub.push(...perkLeadsTo(p).filter((s) => !s.startsWith('opens ') || s.includes('keystone')));
    if (sub.length) el('small', 'prk-row-sub', t, sub.join(' · '));

    const act = el('div', 'prk-row-act', row);
    const word = el('span', 'prk-row-st', act);
    svgEl('i', 'prk-st', word, glyph(STATE_GLYPH[st.state]));
    el('span', '', word, st.state === 'lock' ? (perkLock(this.owned, p.id, this.level) === 'level' ? `Level ${p.level}` : 'Locked') : STATE_WORD[st.state]);
    if (st.state === 'own' && this.onUnpick) {
      const why = takeBackWhy(this.owned, p.id);
      const b = el('button', 'btn btn-ghost prk-row-btn', act, 'Take back');
      b.type = 'button';
      b.disabled = this.busy || !!why;
      b.addEventListener('click', () => this.onUnpick(p.id));
      if (why) el('small', 'prk-row-why', act, why);
    } else if ((st.state === 'open' || st.state === 'full') && this.onPick) {
      const b = el('button', 'btn prk-row-btn prk-row-take', act, '+ Take');
      b.type = 'button';
      b.disabled = this.busy || st.state !== 'open';
      b.addEventListener('click', () => this.onPick(p.id));
    }
    if (st.state === 'lock' || st.state === 'full') el('small', 'prk-row-why', act, st.line);
    if (p.id === this.sel) fillChange(el('div', 'prk-fxbox prk-row-fx', row), this.owned, p.id);
  }
}
