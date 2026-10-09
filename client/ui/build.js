// Build mode's HUD while holding the hammer: the radial menu of structures (a click with the hammer out opens it, the
// mouse points at a structure, a click picks it), and the strip at the bottom with the picked piece being placed.
import { STRUCT_DEFS, STRUCT_ORDER, ITEM_DEFS, SCHEM_BIT } from '../../shared/defs.js';
import { planCost } from '../../shared/autocraft.js';
import { el, svgEl } from './dom.js';
import { structIcon, itemIcon, glyph } from './icons.js';
import { liveText, bindLabel, bindPair, hasBind } from '../game/binds.js';

// the segment of the ring a pointer offset (screen px from the centre, y down) points at: 0 straight up, clockwise
export function radialIndex(x, y, n = STRUCT_ORDER.length) {
  const a = Math.atan2(x, -y);
  return (Math.round(a / ((Math.PI * 2) / n)) + n) % n;
}

const isLocked = (type, unlocked) => {
  const s = STRUCT_DEFS[type].schem;
  return !!s && !((unlocked | 0) & (1 << SCHEM_BIT[s]));
};

function costChips(parent, cost) {
  return Object.entries(cost).map(([id, need]) => {
    const chip = el('span', 'ing', parent);
    svgEl('i', 'ing-ico', chip, itemIcon(+id));
    el('span', 'ing-t', chip, String(need));
    chip.title = ITEM_DEFS[id]?.name || '';
    return { id: +id, need, chip };
  });
}

// (what is short but made on the way from what is carried, shared/autocraft.js, is not lacking)
function markChips(ings, counts, afford) {
  for (const ing of ings) {
    const have = (counts[ing.id] || 0) >= ing.need;
    ing.chip.classList.toggle('lack', !have && !afford);
    ing.chip.classList.toggle('auto', !have && afford);
    ing.chip.title = (ITEM_DEFS[ing.id]?.name || '') + (!have && afford ? ' · made from what you carry' : '');
  }
}

export class BuildMenu {
  constructor(ui, parent) {
    this.ui = ui;

    // ---- the strip: what is being placed, or how to open the menu
    this.root = el('div', 'build', parent);
    this.root.hidden = true;
    const head = el('div', 'build-head', this.root);
    el('span', 'bh-tag', head, 'Build');
    this.hName = el('span', 'bh-name', head, '');
    this.hRot = el('span', 'bh-rot', head, '');
    this.hBad = el('span', 'bh-bad', head, "Can't place here");
    this.hDesc = el('div', 'build-desc', this.root, '');
    this.hCost = el('div', 'build-cost', this.root);
    this.costType = -1;
    this.costIngs = [];
    const hint = (pairs) => {
      const row = el('div', 'build-hint', this.root);
      for (const [k, t] of pairs) {
        const s = el('span', 'bh', row);
        liveText(el('span', 'kbd sm', s), k);
        el('span', '', s, t);
      }
      return row;
    };
    this.hintIdle = hint([
      [() => bindPair('fire'), 'build menu'],
      [() => bindPair('demolish'), 'demolish'],
    ]);
    this.hintPlace = hint([
      [() => bindPair('fire'), 'place'],
      [() => bindPair('aim'), 'rotate'],
      [() => bindLabel('slot5'), 'build menu'],
      [() => bindPair('demolish'), 'demolish'],
      [() => 'Esc', 'cancel'],
    ]);
    // held, the piece turns in small steps: the wheel turns it, a right click 15° (Game: buildFine)
    this.hintFine = el('div', 'build-hint', this.root);
    const fine = el('span', 'bh', this.hintFine);
    el('span', '', fine, 'Hold');
    liveText(el('span', 'kbd sm', fine), () => bindLabel('buildFine'));
    el('span', '', fine, 'fine rotate (turn with the wheel)');

    // ---- the ring, in the middle of the screen
    this.radial = el('div', 'bradial', parent);
    this.radial.hidden = true;
    el('div', 'br-ring', this.radial);
    this.wedge = el('div', 'br-wedge', this.radial);
    const n = STRUCT_ORDER.length;
    this.radial.style.setProperty('--n', n);
    this.segs = STRUCT_ORDER.map((type, i) => {
      const d = STRUCT_DEFS[type];
      const seg = el('div', 'br-seg', this.radial);
      seg.dataset.type = type;
      seg.style.setProperty('--a', `${(i * 360) / n}deg`);
      const inner = el('div', 'br-seg-in', seg);
      svgEl('i', 'br-ico', inner, structIcon(type));
      el('span', 'br-name', inner, d.name);
      const lock = d.schem ? svgEl('i', 'br-lock', inner, glyph('lock')) : null;
      // (the pointer is free in the sandbox and off pointer lock: the ring takes a real mouse too)
      seg.addEventListener('pointerenter', () => this.ui.cb.onHoverStructure(type));
      seg.addEventListener('click', () => this.ui.cb.onSelectStructure(type));
      return { type, seg, lock, cost: d.cost };
    });
    const mid = el('div', 'br-mid', this.radial);
    this.mIco = svgEl('i', 'br-mid-ico', mid, '');
    this.mName = el('div', 'br-mid-name', mid, '');
    this.mCost = el('div', 'br-mid-cost', mid);
    this.mState = el('div', 'br-mid-state', mid, '');
    this.mType = -1;
    this.mIngs = [];
    this.dot = el('div', 'br-dot', this.radial);
    const foot = el('div', 'br-foot', this.radial);
    this.mDesc = el('div', 'br-desc', foot, '');
    const legend = el('div', 'br-legend', foot);
    for (const [k, t] of [
      [() => bindPair('fire'), 'pick'],
      [() => bindPair('aim') + ' / Esc', 'close'],
    ]) {
      const s = el('span', 'bh', legend);
      liveText(el('span', 'kbd sm', s), k);
      el('span', '', s, t);
    }
    this.key = '';
  }

  // state: null with the hammer away, else { picked, selected, rotate, valid, reason, counts, unlocked, menu } where
  // menu is null or { hover, x, y } (x, y: the pointer, 0..1 of the way out to the ring)
  set(state) {
    if (!state) {
      if (!this.root.hidden) {
        this.root.hidden = true;
        this.ui.root.classList.remove('build-open');
      }
      this.setRadial(null);
      this.key = '';
      return;
    }
    if (this.root.hidden) {
      this.root.hidden = false;
      this.ui.root.classList.add('build-open');
    }
    const counts = state.counts || {};
    const ctx = state.ctx;
    const unlocked = state.unlocked | 0;
    const menu = state.menu || null;
    this.setRadial(menu, counts, unlocked, ctx);
    const picked = !!state.picked;
    const fineOn = picked && !!state.fine;
    const key = [picked ? 1 : 0, state.selected, state.rotate | 0, fineOn ? 1 : 0, bindLabel('buildFine'), state.valid ? 1 : 0, state.reason || '', unlocked, JSON.stringify(counts), ctx?.fire ? 1 : 0, ctx?.bench ? 1 : 0].join('|');
    if (key === this.key) return;
    this.key = key;
    this.root.classList.toggle('idle', !picked);
    this.hintIdle.hidden = picked;
    this.hintPlace.hidden = !picked;
    this.hintFine.hidden = !picked || !hasBind('buildFine'); // (no key for it: nothing to tell)
    this.root.classList.toggle('fine', fineOn);
    const d = picked ? STRUCT_DEFS[state.selected] : null;
    this.hName.textContent = d ? d.name : '';
    this.hDesc.textContent = d ? d.desc : '';
    this.hRot.textContent = d ? ((((state.rotate | 0) % 360) + 360) % 360) + '°' : '';
    this.hBad.textContent = state.reason || "Can't place here";
    this.root.classList.toggle('invalid', picked && !state.valid);
    if (d && state.selected !== this.costType) {
      this.costType = state.selected;
      this.hCost.textContent = '';
      this.costIngs = costChips(this.hCost, d.cost);
    }
    this.hCost.hidden = !d;
    if (d) markChips(this.costIngs, counts, !!planCost(counts, d.cost, ctx));
  }

  setRadial(menu, counts = {}, unlocked = 0, ctx) {
    const open = !!menu;
    if (open !== !this.radial.hidden) {
      this.radial.hidden = !open;
      this.ui.root.classList.toggle('radial-open', open);
      this.rkey = '';
    }
    if (!open) return;
    this.dot.style.transform = `translate(calc(${menu.x} * var(--br-in)), calc(${menu.y} * var(--br-in)))`;
    const rkey = [menu.hover, unlocked, JSON.stringify(counts), ctx?.fire ? 1 : 0, ctx?.bench ? 1 : 0].join('|');
    if (rkey === this.rkey) return;
    this.rkey = rkey;
    const hi = STRUCT_ORDER.indexOf(menu.hover);
    this.wedge.style.setProperty('--a', `${(hi * 360) / STRUCT_ORDER.length}deg`);
    for (const s of this.segs) {
      const afford = !!planCost(counts, s.cost, ctx);
      const locked = isLocked(s.type, unlocked);
      s.seg.classList.toggle('sel', s.type === menu.hover);
      s.seg.classList.toggle('poor', !afford);
      s.seg.classList.toggle('locked', locked);
      if (s.lock) s.lock.hidden = !locked;
    }
    const d = STRUCT_DEFS[menu.hover];
    if (!d) return;
    if (menu.hover !== this.mType) {
      this.mType = menu.hover;
      this.mIco.innerHTML = structIcon(menu.hover);
      this.mName.textContent = d.name;
      this.mDesc.textContent = d.desc;
      this.mCost.textContent = '';
      this.mIngs = costChips(this.mCost, d.cost);
    }
    const afford = !!planCost(counts, d.cost, ctx);
    markChips(this.mIngs, counts, afford);
    const locked = isLocked(menu.hover, unlocked);
    this.mState.textContent = locked ? `Locked · find the ${ITEM_DEFS[d.schem].name}` : afford ? '' : 'Not enough materials';
    this.radial.classList.toggle('locked', locked);
  }
}
