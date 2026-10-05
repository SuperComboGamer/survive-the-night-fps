// Build menu strip (bottom-centre) shown while holding the hammer.
import { STRUCT_DEFS, STRUCT_ORDER, ITEM_DEFS, SCHEM_BIT } from '../../shared/defs.js';
import { planCost } from '../../shared/autocraft.js';
import { el, svgEl } from './dom.js';
import { structIcon, itemIcon, glyph } from './icons.js';
import { liveText, bindLabel, bindPair } from '../game/binds.js';

export class BuildMenu {
  constructor(ui, parent) {
    this.ui = ui;
    this.root = el('div', 'build', parent);
    this.root.hidden = true;
    const head = el('div', 'build-head', this.root);
    liveText(el('span', 'kbd sm bh-step', head), () => bindLabel('buildPrev'));
    el('span', 'bh-tag', head, 'Build');
    this.hName = el('span', 'bh-name', head, '');
    this.hRot = el('span', 'bh-rot', head, '');
    liveText(el('span', 'kbd sm bh-step', head), () => bindLabel('buildNext'));
    this.hBad = el('span', 'bh-bad', head, "Can't place here");
    this.hDesc = el('div', 'build-desc', this.root, '');
    const cards = el('div', 'build-cards', this.root);
    this.cards = STRUCT_ORDER.map((type, i) => {
      const d = STRUCT_DEFS[type];
      const c = el('div', 'bc', cards);
      c.dataset.type = type;
      svgEl('i', 'bc-ico', c, structIcon(type));
      el('span', 'bc-name', c, d.name);
      const lock = d.schem ? svgEl('i', 'bc-lock', c, glyph('lock')) : null;
      const cost = el('div', 'bc-cost', c);
      const ings = Object.entries(d.cost).map(([id, need]) => {
        const chip = el('span', 'ing', cost);
        svgEl('i', 'ing-ico', chip, itemIcon(+id));
        el('span', 'ing-t', chip, String(need));
        chip.title = ITEM_DEFS[id]?.name || '';
        return { id: +id, need, chip };
      });
      c.addEventListener('click', () => {
        this.ui.sound('ui_click');
        this.ui.cb.onSelectStructure(type);
      });
      return { type, c, ings, lock, schem: d.schem };
    });
    const hint = el('div', 'build-hint', this.root);
    // (the keybinds of now: game/binds.js)
    for (const [k, t] of [
      [() => `${bindLabel('buildPrev')} / ${bindLabel('buildNext')}`, 'select'],
      [() => bindPair('fire'), 'place'],
      [() => bindPair('aim'), 'rotate'],
      [() => bindPair('demolish'), 'demolish'],
    ]) {
      const s = el('span', 'bh', hint);
      liveText(el('span', 'kbd sm', s), k);
      el('span', '', s, t);
    }
    this.key = '';
  }

  set(state) {
    if (!state) {
      if (!this.root.hidden) {
        this.root.hidden = true;
        this.ui.root.classList.remove('build-open');
      }
      this.key = '';
      return;
    }
    const counts = state.counts || {};
    const ctx = state.ctx;
    const key = [state.selected, state.rotate | 0, state.valid ? 1 : 0, state.reason || '', state.unlocked | 0, JSON.stringify(counts), ctx?.fire ? 1 : 0, ctx?.bench ? 1 : 0].join('|');
    if (this.root.hidden) {
      this.root.hidden = false;
      this.ui.root.classList.add('build-open');
    }
    if (key === this.key) return;
    this.key = key;
    for (const card of this.cards) {
      // (what is short but made on the way from what is carried, shared/autocraft.js, is not lacking)
      const plan = planCost(counts, STRUCT_DEFS[card.type].cost, ctx);
      const afford = !!plan;
      for (const ing of card.ings) {
        const have = (counts[ing.id] || 0) >= ing.need;
        ing.chip.classList.toggle('lack', !have && !afford);
        ing.chip.classList.toggle('auto', !have && afford);
        ing.chip.title = (ITEM_DEFS[ing.id]?.name || '') + (!have && afford ? ' · made from what you carry' : '');
      }
      const locked = !!card.schem && !((state.unlocked | 0) & (1 << SCHEM_BIT[card.schem]));
      card.c.classList.toggle('sel', card.type === state.selected);
      card.c.classList.toggle('poor', !afford);
      card.c.classList.toggle('locked', locked);
      if (card.lock) card.lock.hidden = !locked;
    }
    const d = STRUCT_DEFS[state.selected];
    this.hName.textContent = d ? d.name : '';
    this.hDesc.textContent = d ? d.desc : '';
    this.hBad.textContent = state.reason || "Can't place here";
    this.hRot.textContent = ((((state.rotate | 0) % 360) + 360) % 360) + '°';
    this.root.classList.toggle('invalid', !state.valid);
  }
}
