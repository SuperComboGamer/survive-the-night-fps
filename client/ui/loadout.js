import { ITEM_DEFS, AMMO_NAMES } from '../../shared/defs.js';
import { LOADOUT_RARITY_NAMES, LOADOUT_SLOTS, loadoutDef } from '../../shared/loadout.js';
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { Panel } from './games.js';
import { fetchLoadout, saveLoadout } from '../net/loadout.js';

const fmtGrant = (def) => {
  const g = def.grant || {};
  const out = [];
  if (g.item) out.push(`${g.count || 1}x ${ITEM_DEFS[g.item]?.name || 'item'}`);
  for (const [cal, n] of g.ammo || []) out.push(`${n} ${AMMO_NAMES[cal] || 'rounds'}`);
  return out.join(' + ') || 'Passive bonus';
};
const fmtMods = (mods = {}) =>
  Object.entries(mods)
    .map(([k, v]) => {
      if (k === 'hp') return `+${v} max health`;
      if (k === 'extraFind') return `+${Math.round(v * 100)}% extra find`;
      if (k === 'xp') return `+${Math.round((v - 1) * 100)}% XP`;
      if (v < 1) return `${Math.round((1 - v) * 100)}% better ${k}`;
      return `+${Math.round((v - 1) * 100)}% ${k}`;
    })
    .join(' · ');
const cleanData = (v) => ({
  catalog: Array.isArray(v?.catalog) ? v.catalog : [],
  slotCount: v?.slotCount || LOADOUT_SLOTS,
  items: Array.isArray(v?.items) ? v.items : [],
  slots: Array.isArray(v?.slots) ? v.slots.slice(0, LOADOUT_SLOTS) : Array(LOADOUT_SLOTS).fill(null),
});

export class LoadoutPanel extends Panel {
  constructor(ui, parent) {
    super(ui, parent, 'lo-panel', 'Loadout');
    this.data = null;
    this.selected = '';
    this.busy = false;
    this.err = '';
    this.root.classList.add('loadout-panel');
    this.sub.textContent = 'Three slots · any item in any slot';

    this.slotBox = el('div', 'lo-slots', this.body);
    this.note = el('p', 'ac-note lo-note', this.body, 'Loadout items are permanent profile items. Equipped copies join you at the start of a run and never drop for other players.');
    this.grid = el('div', 'lo-grid', this.body);
    this.detail = el('div', 'lo-detail', this.body);

    this.refreshB = el('button', 'btn btn-ghost', this.foot, 'Refresh');
    this.refreshB.type = 'button';
    this.refreshB.addEventListener('click', () => this.refresh());
    el('span', 'gb-gap', this.foot);
    this.closeB = el('button', 'btn btn-ghost', this.foot, 'Close');
    this.closeB.type = 'button';
    this.closeB.addEventListener('click', () => this.hide());
  }
  show() {
    super.show();
    this.render();
    this.refresh();
  }
  async refresh() {
    if (this.busy) return;
    this.busy = true;
    this.err = '';
    this.render();
    try {
      this.data = cleanData(await fetchLoadout());
      if (!this.selected || !this.data.items.some((it) => it.id === this.selected)) this.selected = this.data.items[0]?.id || '';
    } catch (err) {
      this.err = err.message || 'Could not load your collection';
    }
    this.busy = false;
    this.render();
  }
  async save(slots) {
    if (this.busy) return;
    this.busy = true;
    this.err = '';
    this.render();
    try {
      this.data = cleanData(await saveLoadout(slots));
    } catch (err) {
      this.err = err.message || 'That did not save';
      await this.refresh();
    }
    this.busy = false;
    this.render();
  }
  byId() {
    return new Map((this.data?.items || []).map((it) => [it.id, it]));
  }
  renderSlots(byId = this.byId()) {
    this.slotBox.textContent = '';
    const slots = this.data?.slots || Array(LOADOUT_SLOTS).fill(null);
    for (let i = 0; i < LOADOUT_SLOTS; i++) {
      const owned = byId.get(slots[i]);
      const def = owned && loadoutDef(owned.catalog);
      const b = el('button', `lo-slot${this.selected && slots[i] === this.selected ? ' on' : ''}`, this.slotBox);
      b.type = 'button';
      svgEl('i', 'lo-slot-ico', b, glyph(def ? (def.type === 'weapon' ? 'headshot' : def.type === 'armor' ? 'shield' : 'star') : 'plus'));
      const t = el('span', 'lo-slot-t', b);
      el('b', '', t, def ? def.name : `Slot ${i + 1}`);
      el('small', '', t, def ? `${def.type} · ${LOADOUT_RARITY_NAMES[def.rarity]}` : 'Empty');
      b.addEventListener('click', () => {
        if (slots[i]) this.selected = slots[i];
        this.render();
      });
      if (def) {
        const x = svgEl('button', 'btn-icon lo-slot-x', b, glyph('xmark'));
        x.type = 'button';
        x.title = 'Unequip';
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = slots.slice();
          next[i] = null;
          this.save(next);
        });
      }
    }
  }
  renderGrid(byId = this.byId()) {
    this.grid.textContent = '';
    const items = this.data?.items || [];
    if (!items.length) {
      el('p', 'gb-empty lo-empty', this.grid, this.busy ? 'Loading your collection...' : this.err || 'No loadout items yet. Bosses and strongboxes can unlock them.');
      return;
    }
    for (const owned of items) {
      const def = loadoutDef(owned.catalog);
      if (!def) continue;
      const b = el('button', `lo-card r${def.rarity}${owned.id === this.selected ? ' on' : ''}`, this.grid);
      b.type = 'button';
      el('span', 'lo-card-r', b, LOADOUT_RARITY_NAMES[def.rarity]);
      el('b', '', b, def.name);
      el('small', '', b, `${def.type} · ${fmtGrant(def)}`);
      b.addEventListener('click', () => {
        this.selected = owned.id;
        this.render();
      });
    }
  }
  renderDetail(byId = this.byId()) {
    this.detail.textContent = '';
    if (this.err) el('p', 'ac-note bad', this.detail, this.err);
    const owned = byId.get(this.selected);
    const def = owned && loadoutDef(owned.catalog);
    if (!def) return;
    el('h3', '', this.detail, def.name);
    el('p', 'lo-meta', this.detail, `${LOADOUT_RARITY_NAMES[def.rarity]} ${def.type}`);
    el('p', 'lo-flavor', this.detail, def.flavor);
    el('p', 'lo-line', this.detail, `Run start: ${fmtGrant(def)}`);
    const mods = fmtMods(def.mods);
    if (mods) el('p', 'lo-line good', this.detail, mods);
    const slots = this.data?.slots || Array(LOADOUT_SLOTS).fill(null);
    const equipped = slots.indexOf(owned.id);
    const row = el('div', 'lo-actions', this.detail);
    if (equipped >= 0) {
      const b = el('button', 'btn btn-ghost', row, `Unequip from slot ${equipped + 1}`);
      b.type = 'button';
      b.disabled = this.busy;
      b.addEventListener('click', () => {
        const next = slots.slice();
        next[equipped] = null;
        this.save(next);
      });
    } else {
      for (let i = 0; i < LOADOUT_SLOTS; i++) {
        const b = el('button', i === 0 ? 'btn btn-blood' : 'btn btn-ghost', row, `Equip ${i + 1}`);
        b.type = 'button';
        b.disabled = this.busy;
        b.addEventListener('click', () => {
          const next = slots.map((id) => (id === owned.id ? null : id));
          next[i] = owned.id;
          this.save(next);
        });
      }
    }
  }
  render() {
    const byId = this.byId();
    this.root.classList.toggle('busy', this.busy);
    this.renderSlots(byId);
    this.renderGrid(byId);
    this.renderDetail(byId);
  }
}

