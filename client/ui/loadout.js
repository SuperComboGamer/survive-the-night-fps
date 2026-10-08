import { AMMO_NAMES, ITEM_DEFS, ZOMBIE_DEFS } from '../../shared/defs.js';
import { LOADOUT_RARITY, LOADOUT_RARITY_NAMES, LOADOUT_SLOTS, LOADOUT_TYPES, loadoutDef, loadoutTypeName } from '../../shared/loadout.js';
import { AUCTION, SKULLS, sellerProceeds } from '../../shared/economy.js';
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { Panel } from './games.js';
import { buyAuctionListing, cancelAuctionListing, fetchAuction, fetchLoadout, listAuctionItem, saveLoadout } from '../net/loadout.js';

const fmtGrant = (def) => {
  const g = def.grant || {};
  const out = [];
  if (g.item) out.push(`${g.count || 1}x ${ITEM_DEFS[g.item]?.name || 'item'}`);
  for (const [item, n] of g.items || []) out.push(`${n}x ${ITEM_DEFS[item]?.name || 'item'}`);
  for (const [cal, n] of g.ammo || []) out.push(`${n} ${AMMO_NAMES[cal] || 'rounds'}`);
  return out.join(' + ') || 'Passive bonus';
};
const pct = (v) => `${Math.round(Math.abs(v - 1) * 100)}%`;
const fmtMods = (mods = {}) =>
  Object.entries(mods)
    .map(([k, v]) => {
      if (k === 'hp') return `+${v} max health`;
      if (k === 'extraFind') return `+${Math.round(v * 100)}% extra find`;
      if (k === 'gather') return `+${Math.round(v * 100)}% bonus gather`;
      if (k === 'reviveHp') return `+${v} revive health`;
      if (k === 'killStamina') return `+${v} stamina on kill`;
      if (k === 'killHeal') return `+${v} health on kill`;
      if (k === 'reviveSelf') return `+${v} health after revive`;
      if (k === 'xp') return `+${Math.round((v - 1) * 100)}% XP`;
      if (v < 1) return `${pct(v)} better ${k}`;
      return `+${pct(v)} ${k}`;
    })
    .join(' · ');
const fmtCombat = (label, e = {}) => {
  const out = [];
  if (e.damage && e.damage !== 1) out.push(`+${pct(e.damage)} damage`);
  if (e.headshot && e.headshot !== 1) out.push(`+${pct(e.headshot)} headshots`);
  if (e.boss && e.boss !== 1) out.push(`+${pct(e.boss)} vs bosses/Tanks`);
  if (e.knock && e.knock !== 1) out.push(`+${pct(e.knock)} knockback`);
  if (e.pierce) out.push(`+${e.pierce} pierce`);
  if (e.ignite) out.push(`${Math.round(e.ignite * 100)}% ignite`);
  return out.length ? `${label}: ${out.join(', ')}` : '';
};
const fmtRewards = (label, e = {}) => {
  const out = [];
  if (e.heal) out.push(`+${e.heal} health`);
  if (e.stamina) out.push(`+${e.stamina} stamina`);
  for (const [cal, n] of e.ammo || []) out.push(`${n} ${AMMO_NAMES[cal] || 'rounds'}`);
  return out.length ? `${label}: ${out.join(', ')}` : '';
};
const fmtEffects = (def) =>
  [
    fmtCombat('Signature weapon', def.effects?.weapon),
    fmtCombat('Special ammo', def.effects?.ammo),
    fmtRewards('On kill', def.effects?.kill),
    fmtRewards('First kill each night', def.effects?.firstKill),
  ]
    .filter(Boolean)
    .join(' · ');
const fmtSource = (def) => {
  const s = def.source || {};
  if (s.kind === 'boss') return `${ZOMBIE_DEFS[s.boss]?.name || 'Boss'} drop`;
  return s.text || 'The valley';
};
const typeIcon = (def) =>
  def?.icon ||
  ({
    [LOADOUT_TYPES.WEAPON]: 'headshot',
    [LOADOUT_TYPES.ARMOR]: 'shield',
    [LOADOUT_TYPES.CLOTHING]: 'person',
    [LOADOUT_TYPES.TRINKET]: 'star',
    [LOADOUT_TYPES.AMMO]: 'bolt',
    [LOADOUT_TYPES.GEAR]: 'grid',
    [LOADOUT_TYPES.KIT]: 'container',
  }[def?.type] || 'star');
const cleanData = (v) => ({
  catalog: Array.isArray(v?.catalog) ? v.catalog : [],
  slotCount: v?.slotCount || LOADOUT_SLOTS,
  balance: Math.max(0, v?.balance | 0),
  items: Array.isArray(v?.items) ? v.items : [],
  slots: Array.isArray(v?.slots) ? v.slots.slice(0, LOADOUT_SLOTS) : Array(LOADOUT_SLOTS).fill(null),
});
const priceText = (n) => `${Math.max(0, n | 0).toLocaleString()} ${SKULLS.SHORT}`;
const listingTime = (ms) => {
  const left = Math.max(0, Math.ceil((ms - Date.now()) / 3600000));
  if (!left) return 'expires soon';
  if (left < 24) return `${left}h left`;
  return `${Math.ceil(left / 24)}d left`;
};

export class LoadoutPanel extends Panel {
  constructor(ui, parent) {
    super(ui, parent, 'lo-panel', 'Loadout');
    this.data = null;
    this.selected = '';
    this.typeFilter = 'all';
    this.rarityFilter = 0;
    this.sort = 'rarity';
    this.busy = false;
    this.err = '';
    this.root.classList.add('loadout-panel');
    this.sub.textContent = 'Three slots · any item in any slot';

    this.slotBox = el('div', 'lo-slots', this.body);
    this.balance = el('div', 'lo-balance', this.body);
    this.note = el('p', 'ac-note lo-note', this.body, 'Loadout items are permanent profile items. Equipped copies join you at the start of a run and never drop for other players.');
    this.controls = el('div', 'lo-controls', this.body);
    this.makeControls();
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
  makeControls() {
    const field = (label, select) => {
      const wrap = el('label', 'lo-filter', this.controls);
      el('span', '', wrap, label);
      wrap.appendChild(select);
    };
    this.typeSel = el('select', '', null);
    for (const [value, label] of [['all', 'All types'], ...Object.values(LOADOUT_TYPES).map((t) => [t, loadoutTypeName(t)])]) {
      const o = el('option', '', this.typeSel, label);
      o.value = value;
    }
    this.typeSel.addEventListener('change', () => {
      this.typeFilter = this.typeSel.value;
      this.render();
    });
    field('Type', this.typeSel);
    this.raritySel = el('select', '', null);
    for (const [value, label] of [[0, 'All rarities'], [LOADOUT_RARITY.COMMON, 'Common+'], [LOADOUT_RARITY.RARE, 'Rare+'], [LOADOUT_RARITY.EPIC, 'Epic+'], [LOADOUT_RARITY.LEGENDARY, 'Legendary']]) {
      const o = el('option', '', this.raritySel, label);
      o.value = value;
    }
    this.raritySel.addEventListener('change', () => {
      this.rarityFilter = +this.raritySel.value || 0;
      this.render();
    });
    field('Rarity', this.raritySel);
    this.sortSel = el('select', '', null);
    for (const [value, label] of [['rarity', 'Rarity'], ['type', 'Type'], ['newest', 'Newest']]) {
      const o = el('option', '', this.sortSel, label);
      o.value = value;
    }
    this.sortSel.addEventListener('change', () => {
      this.sort = this.sortSel.value;
      this.render();
    });
    field('Sort', this.sortSel);
    this.count = el('span', 'lo-count', this.controls);
  }
  visibleItems() {
    const items = (this.data?.items || []).filter((owned) => {
      const def = loadoutDef(owned.catalog);
      return def && (this.typeFilter === 'all' || def.type === this.typeFilter) && (!this.rarityFilter || def.rarity >= this.rarityFilter);
    });
    const cmp = {
      rarity: (a, b) => loadoutDef(b.catalog).rarity - loadoutDef(a.catalog).rarity || loadoutDef(a.catalog).type.localeCompare(loadoutDef(b.catalog).type) || loadoutDef(a.catalog).name.localeCompare(loadoutDef(b.catalog).name) || a.id.localeCompare(b.id),
      type: (a, b) => loadoutDef(a.catalog).type.localeCompare(loadoutDef(b.catalog).type) || loadoutDef(b.catalog).rarity - loadoutDef(a.catalog).rarity || loadoutDef(a.catalog).name.localeCompare(loadoutDef(b.catalog).name) || a.id.localeCompare(b.id),
      newest: (a, b) => (b.acquiredAt || 0) - (a.acquiredAt || 0) || b.id.localeCompare(a.id),
    }[this.sort];
    return items.sort(cmp);
  }
  renderSlots(byId = this.byId()) {
    this.slotBox.textContent = '';
    const slots = this.data?.slots || Array(LOADOUT_SLOTS).fill(null);
    for (let i = 0; i < LOADOUT_SLOTS; i++) {
      const owned = byId.get(slots[i]);
      const def = owned && loadoutDef(owned.catalog);
      const b = el('button', `lo-slot${this.selected && slots[i] === this.selected ? ' on' : ''}`, this.slotBox);
      b.type = 'button';
      svgEl('i', `lo-slot-ico${def ? ` r${def.rarity}` : ''}`, b, glyph(def ? typeIcon(def) : 'plus'));
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
    const all = this.data?.items || [];
    const items = this.visibleItems();
    if (this.count) this.count.textContent = all.length ? `${items.length} shown / ${all.length} owned` : '';
    if (!all.length) {
      el('p', 'gb-empty lo-empty', this.grid, this.busy ? 'Loading your collection...' : this.err || 'No loadout items yet. Bosses and strongboxes can unlock them.');
      return;
    }
    if (!items.length) {
      el('p', 'gb-empty lo-empty', this.grid, 'No items match these filters.');
      return;
    }
    for (const owned of items) {
      const def = loadoutDef(owned.catalog);
      if (!def) continue;
      const b = el('button', `lo-card r${def.rarity}${owned.id === this.selected ? ' on' : ''}`, this.grid);
      b.type = 'button';
      const top = el('span', 'lo-card-top', b);
      svgEl('i', 'lo-card-ico', top, glyph(typeIcon(def)));
      el('span', 'lo-card-r', top, LOADOUT_RARITY_NAMES[def.rarity]);
      el('b', '', b, def.name);
      el('small', '', b, `${loadoutTypeName(def.type)} · ${fmtGrant(def)}`);
      b.addEventListener('click', () => {
        this.selected = owned.id;
        this.render();
      });
    }
  }
  renderDetail(byId = this.byId()) {
    this.detail.textContent = '';
    this.balance.textContent = `${SKULLS.NAME}: ${priceText(this.data?.balance || 0)}`;
    if (this.err) el('p', 'ac-note bad', this.detail, this.err);
    const owned = byId.get(this.selected);
    const def = owned && loadoutDef(owned.catalog);
    if (!def) return;
    el('h3', '', this.detail, def.name);
    el('p', `lo-meta r${def.rarity}`, this.detail, `${LOADOUT_RARITY_NAMES[def.rarity]} ${loadoutTypeName(def.type)} · ${fmtSource(def)}`);
    el('p', 'lo-flavor', this.detail, def.flavor);
    el('p', 'lo-line', this.detail, `Run start: ${fmtGrant(def)}`);
    const mods = fmtMods(def.mods);
    if (mods) el('p', 'lo-line good', this.detail, mods);
    const effects = fmtEffects(def);
    if (effects) el('p', 'lo-line good', this.detail, effects);
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
    const visible = this.visibleItems();
    if (this.selected && visible.length && !visible.some((it) => it.id === this.selected)) this.selected = visible[0].id;
    if (this.selected && !visible.length && this.data?.items?.length) this.selected = '';
    this.root.classList.toggle('busy', this.busy);
    this.renderSlots(byId);
    this.renderGrid(byId);
    this.renderDetail(byId);
  }
}

export class AuctionPanel extends Panel {
  constructor(ui, parent) {
    super(ui, parent, 'ah-panel', 'Auction House');
    this.data = null;
    this.loadout = null;
    this.selected = '';
    this.busy = false;
    this.err = '';
    this.filter = { q: '', type: '', rarity: 0, max: 0 };
    this.root.classList.add('auction-panel');
    this.sub.textContent = 'Buy-now listings · account trading only';

    this.balance = el('div', 'ah-balance', this.body);
    this.note = el('p', 'ac-note ah-note', this.body, 'Earn Zombie Skulls by surviving nights, killing bosses, and escaping. Guests keep earnings, but buying and selling requires signing in.');
    const controls = el('div', 'ah-controls', this.body);
    this.search = el('input', 'ah-search', controls);
    this.search.type = 'search';
    this.search.placeholder = 'Search listings';
    this.search.addEventListener('input', () => {
      this.filter.q = this.search.value.trim().toLowerCase();
      this.renderListings();
    });
    this.type = el('select', 'ah-select', controls);
    this.type.append(new Option('All types', ''));
    for (const v of Object.values(LOADOUT_TYPES)) this.type.append(new Option(v[0].toUpperCase() + v.slice(1), v));
    this.type.addEventListener('change', () => {
      this.filter.type = this.type.value;
      this.renderListings();
    });
    this.rarity = el('select', 'ah-select', controls);
    this.rarity.append(new Option('All rarities', '0'));
    for (const [k, v] of Object.entries(LOADOUT_RARITY_NAMES)) this.rarity.append(new Option(v, k));
    this.rarity.addEventListener('change', () => {
      this.filter.rarity = this.rarity.value | 0;
      this.renderListings();
    });
    this.max = el('input', 'ah-price', controls);
    this.max.type = 'number';
    this.max.min = '0';
    this.max.placeholder = 'Max price';
    this.max.addEventListener('input', () => {
      this.filter.max = Math.max(0, this.max.value | 0);
      this.renderListings();
    });

    this.main = el('div', 'ah-main', this.body);
    this.listings = el('div', 'ah-listings', this.main);
    this.detail = el('div', 'ah-detail', this.main);
    this.sell = el('div', 'ah-sell', this.body);
    this.mine = el('div', 'ah-mine', this.body);

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
      const [auction, loadout] = await Promise.all([fetchAuction(), fetchLoadout()]);
      this.data = {
        balance: Math.max(0, auction?.balance | 0),
        canTrade: auction?.canTrade === true,
        listings: Array.isArray(auction?.listings) ? auction.listings : [],
        mine: Array.isArray(auction?.mine) ? auction.mine : [],
      };
      this.loadout = cleanData(loadout);
      if (!this.selected || !this.data.listings.some((l) => l.id === this.selected)) this.selected = this.data.listings[0]?.id || '';
    } catch (err) {
      this.err = err.message || 'Could not load the auction house';
    }
    this.busy = false;
    this.render();
  }
  visibleListings() {
    const q = this.filter.q;
    return (this.data?.listings || []).filter((l) => {
      const def = loadoutDef(l.catalog);
      if (!def) return false;
      if (q && !`${def.name} ${def.type} ${LOADOUT_RARITY_NAMES[def.rarity]}`.toLowerCase().includes(q)) return false;
      if (this.filter.type && def.type !== this.filter.type) return false;
      if (this.filter.rarity && def.rarity !== this.filter.rarity) return false;
      if (this.filter.max && l.price > this.filter.max) return false;
      return true;
    });
  }
  async buy(id) {
    if (this.busy) return;
    this.busy = true;
    this.err = '';
    this.render();
    try {
      await buyAuctionListing(id);
      await this.refresh();
    } catch (err) {
      this.err = err.message || 'That purchase failed';
      this.busy = false;
      this.render();
    }
  }
  async cancel(id) {
    if (this.busy) return;
    this.busy = true;
    this.err = '';
    this.render();
    try {
      await cancelAuctionListing(id);
      await this.refresh();
    } catch (err) {
      this.err = err.message || 'That cancellation failed';
      this.busy = false;
      this.render();
    }
  }
  async list(itemId, price) {
    if (this.busy) return;
    this.busy = true;
    this.err = '';
    this.render();
    try {
      await listAuctionItem(itemId, price);
      await this.refresh();
    } catch (err) {
      this.err = err.message || 'That listing failed';
      this.busy = false;
      this.render();
    }
  }
  renderListings() {
    this.listings.textContent = '';
    const rows = this.visibleListings();
    if (!rows.length) {
      el('p', 'gb-empty', this.listings, this.busy ? 'Loading listings...' : 'No listings match.');
      this.renderDetail();
      return;
    }
    const mineIds = new Set((this.data?.mine || []).filter((l) => l.status === 'active').map((l) => l.id));
    for (const l of rows) {
      const def = loadoutDef(l.catalog);
      const b = el('button', `ah-card r${def.rarity}${l.id === this.selected ? ' on' : ''}`, this.listings);
      b.type = 'button';
      el('span', 'ah-card-r', b, LOADOUT_RARITY_NAMES[def.rarity]);
      el('b', '', b, def.name);
      el('small', '', b, `${def.type} · ${priceText(l.price)} · ${listingTime(l.expiresAt)}${mineIds.has(l.id) ? ' · yours' : ''}`);
      b.addEventListener('click', () => {
        this.selected = l.id;
        this.renderDetail();
        this.renderListings();
      });
    }
    this.renderDetail();
  }
  renderDetail() {
    this.detail.textContent = '';
    if (this.err) el('p', 'ac-note bad', this.detail, this.err);
    const l = (this.data?.listings || []).find((x) => x.id === this.selected);
    const def = l && loadoutDef(l.catalog);
    if (!def) return;
    const mineIds = new Set((this.data?.mine || []).filter((x) => x.status === 'active').map((x) => x.id));
    el('h3', '', this.detail, def.name);
    el('p', 'lo-meta', this.detail, `${LOADOUT_RARITY_NAMES[def.rarity]} ${def.type}`);
    el('p', 'lo-flavor', this.detail, def.flavor);
    el('p', 'lo-line', this.detail, `Run start: ${fmtGrant(def)}`);
    const mods = fmtMods(def.mods);
    if (mods) el('p', 'lo-line good', this.detail, mods);
    el('p', 'ah-price-line', this.detail, `${priceText(l.price)} · seller receives ${priceText(sellerProceeds(l.price))}`);
    el('p', 'ac-note', this.detail, `Expires: ${listingTime(l.expiresAt)}`);
    const row = el('div', 'lo-actions', this.detail);
    if (mineIds.has(l.id)) {
      const c = el('button', 'btn btn-ghost', row, 'Cancel listing');
      c.type = 'button';
      c.disabled = this.busy;
      c.addEventListener('click', () => this.cancel(l.id));
    } else {
      const b = el('button', 'btn btn-blood', row, 'Buy now');
      b.type = 'button';
      b.disabled = this.busy || !this.data?.canTrade || (this.data?.balance || 0) < l.price;
      b.title = !this.data?.canTrade ? 'Sign in to buy' : (this.data?.balance || 0) < l.price ? 'Not enough Zombie Skulls' : '';
      b.addEventListener('click', () => this.buy(l.id));
    }
  }
  renderSell() {
    this.sell.textContent = '';
    el('h3', '', this.sell, 'Sell an item');
    if (!this.data?.canTrade) {
      el('p', 'ac-note', this.sell, 'Guests can earn Zombie Skulls and browse listings. Sign in to list or buy items.');
      return;
    }
    const items = this.loadout?.items || [];
    if (!items.length) {
      el('p', 'ac-note', this.sell, 'No unlisted loadout items available to sell.');
      return;
    }
    const form = el('form', 'ah-sell-form', this.sell);
    const pick = el('select', 'ah-select', form);
    for (const it of items) {
      const def = loadoutDef(it.catalog);
      if (def) pick.append(new Option(`${def.name} (${LOADOUT_RARITY_NAMES[def.rarity]})`, it.id));
    }
    const price = el('input', 'ah-price', form);
    price.type = 'number';
    price.min = String(AUCTION.PRICE_MIN);
    price.max = String(AUCTION.PRICE_MAX);
    price.value = '50';
    const b = el('button', 'btn btn-blood', form, 'List');
    b.type = 'submit';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.list(pick.value, price.value | 0);
    });
  }
  renderMine() {
    this.mine.textContent = '';
    el('h3', '', this.mine, 'Your listings');
    const mine = this.data?.mine || [];
    if (!mine.length) return void el('p', 'ac-note', this.mine, 'Nothing listed yet.');
    for (const l of mine.slice(0, 8)) {
      const def = loadoutDef(l.catalog);
      const r = el('div', 'ah-mine-row', this.mine);
      el('b', '', r, def?.name || 'Loadout item');
      el('span', '', r, `${priceText(l.price)} · ${l.status}${l.status === 'active' ? ` · ${listingTime(l.expiresAt)}` : ''}`);
      if (l.status === 'active') {
        const c = el('button', 'btn btn-ghost', r, 'Cancel');
        c.type = 'button';
        c.disabled = this.busy;
        c.addEventListener('click', () => this.cancel(l.id));
      }
    }
  }
  render() {
    this.root.classList.toggle('busy', this.busy);
    this.balance.textContent = `${SKULLS.NAME}: ${priceText(this.data?.balance || this.loadout?.balance || 0)}`;
    this.renderListings();
    this.renderSell();
    this.renderMine();
  }
}

