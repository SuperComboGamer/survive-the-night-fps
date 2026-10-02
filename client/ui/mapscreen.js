// Field map overlay [M]: the baked survey map of the valley with live markers - you, your team, the
// car, pings, where the car supplies are rumoured to be, and the places you have discovered.
import { ZONE_NAMES, SUPPLIES, SUPPLY_NEED, ITEM_DEFS } from '../../shared/defs.js';
import { MAP_HALF, MAP_SIZE } from '../../shared/constants.js';
import { el, svgEl } from './dom.js';
import { itemIcon, glyph } from './icons.js';
import { renderMapCanvas, MAP_PX } from './mapcanvas.js';

export class MapScreen {
  constructor(ui, parent) {
    this.ui = ui;
    this.open = false;
    this.root = el('div', 'mapscr', parent);
    this.root.hidden = true;
    el('div', 'map-bg', this.root);
    const frame = (this.frame = el('div', 'map-frame paper', this.root));
    const head = el('div', 'map-head', frame);
    el('span', 'map-title', head, 'Field map · Harlan Valley');
    this.coords = el('span', 'map-coords', head, '');
    const body = el('div', 'map-body', frame);
    this.view = el('div', 'map-view', body);
    this.canvasWrap = el('div', 'map-canvas', this.view);
    this.labels = el('div', 'map-labels', this.view);
    this.markers = el('div', 'map-markers', this.view);
    const side = el('div', 'map-side', body);
    el('h3', 'inv-h', side).appendChild(el('span', 'inv-h-t', null, 'Car supplies'));
    this.supList = el('div', 'map-sup', side);
    el('h3', 'inv-h', side).appendChild(el('span', 'inv-h-t', null, 'Legend'));
    const lg = el('div', 'map-legend', side);
    for (const [cls, ico, t] of [
      ['you', 'arrowUp', 'You'],
      ['mate', 'person', 'Survivor'],
      ['car', 'car', 'Your car'],
      ['hint', 'fuel', 'Rumoured supply'],
      ['ping', 'ping', 'Ping'],
      ['crate', 'hazard', 'Supply drop'],
      ['bench', 'wrench', 'Workbench'],
    ]) {
      const r = el('div', 'lg ' + cls, lg);
      svgEl('i', 'lg-ico', r, glyph(ico));
      el('span', '', r, t);
    }
    const keys = el('div', 'map-keys', side);
    for (const [k, t] of [
      ['M', 'close'],
      ['Z', 'ping (in game)'],
    ]) {
      const s = el('span', 'gh', keys);
      el('span', 'kbd sm', s, k);
      el('span', '', s, t);
    }
    this.world = null;
    this.labelEls = [];
    this.pool = [];
    this.supRows = [];
  }

  setWorld(world) {
    if (this.world === world) return;
    this.world = world;
    this.canvasWrap.textContent = '';
    this.canvas = null;
    this.labels.textContent = '';
    this.labelEls = world.zones.map((z) => {
      const l = el('div', 'map-lab', this.labels);
      l.style.left = ((z.x + MAP_HALF) / MAP_SIZE) * 100 + '%';
      l.style.top = ((z.z + MAP_HALF) / MAP_SIZE) * 100 + '%';
      l.dataset.zone = z.id;
      return l;
    });
  }

  _ensureCanvas() {
    if (this.canvas || !this.world) return;
    const t0 = performance.now();
    this.canvas = renderMapCanvas(this.world);
    this.canvas.className = 'map-cv';
    this.canvasWrap.appendChild(this.canvas);
    console.log(`[map] baked in ${(performance.now() - t0).toFixed(0)}ms (${MAP_PX}px)`);
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    if (open) this._ensureCanvas();
    this.root.hidden = !open;
    this.ui.root.classList.toggle('map-open', open);
  }

  _mk(i) {
    let m = this.pool[i];
    if (!m) {
      const e = el('div', 'mm', this.markers);
      const ico = el('i', 'mm-ico', e);
      const lab = el('span', 'mm-lab', e);
      m = { e, ico, lab, k: '', l: '', c: '' };
      this.pool[i] = m;
    }
    return m;
  }

  // d: { self:{x,z,yaw}, mates:[{x,z,name,status}], car:{x,z}, pings:[{x,z,kind,name}], crates:[{x,z}],
  //      benches:[{x,z}], discovered:Set, hints:[zone...], supplies:[n...], carried:{item:n} }
  update(d) {
    if (!this.open || !this.world) return;
    const pct = (v) => ((v + MAP_HALF) / MAP_SIZE) * 100;
    // place names: known once discovered
    this.labelEls.forEach((l, i) => {
      const z = this.world.zones[i];
      const known = d.discovered.has(z.id);
      const hinted = d.hints.includes(z.id);
      const txt = known ? ZONE_NAMES[z.id] : hinted ? ZONE_NAMES[z.id] + '?' : '?';
      if (l.textContent !== txt) l.textContent = txt;
      l.classList.toggle('unknown', !known);
      l.classList.toggle('hinted', hinted);
    });
    let n = 0;
    const put = (x, z, cls, icon, label = '', rot = null) => {
      const m = this._mk(n++);
      if (m.c !== cls) m.e.className = m.c = 'mm ' + cls;
      if (m.k !== icon) m.ico.innerHTML = m.k = icon;
      if (m.l !== label) m.lab.textContent = m.l = label;
      m.e.style.left = pct(x) + '%';
      m.e.style.top = pct(z) + '%';
      m.ico.style.transform = rot === null ? '' : `rotate(${rot}rad)`;
      if (m.e.hidden) m.e.hidden = false;
    };
    // rumoured supply places
    const seen = new Set();
    d.hints.forEach((zid, i) => {
      if (zid === 255) return;
      const si = Math.min(i, 4);
      if (d.supplies[si] >= SUPPLY_NEED[si]) return;
      const z = this.world.zoneById[zid];
      if (!z) return;
      const k = zid + ':' + si;
      if (seen.has(k)) return;
      seen.add(k);
      const off = seen.size % 3;
      put(z.x + (off - 1) * 6, z.z - 14, 'hint', itemIcon(SUPPLIES[si]));
    });
    for (const b of d.benches) put(b.x, b.z, 'bench', glyph('wrench'), 'bench');
    for (const c of d.crates) put(c.x, c.z, 'crate', glyph('hazard'), 'drop');
    for (const p of d.pings) put(p.x, p.z, 'ping k' + p.kind, glyph('ping'), p.name);
    put(d.car.x, d.car.z, 'car', glyph('car'), 'car');
    for (const m of d.mates) put(m.x, m.z, 'mate ' + m.status, glyph(m.status === 'downed' ? 'downed' : 'person'), m.name);
    put(d.self.x, d.self.z, 'you', glyph('arrowUp'), '', -d.self.yaw);
    for (let i = n; i < this.pool.length; i++) if (!this.pool[i].e.hidden) this.pool[i].e.hidden = true;
    this.coords.textContent = `${Math.round(d.self.x)} E · ${Math.round(-d.self.z)} N`;
    // supply checklist
    const key = JSON.stringify([d.supplies, d.hints, d.carried]);
    if (key !== this._supKey) {
      this._supKey = key;
      this.supList.textContent = '';
      SUPPLIES.forEach((item, i) => {
        const r = el('div', 'ms-row' + (d.supplies[i] >= SUPPLY_NEED[i] ? ' done' : d.carried[item] ? ' carried' : ''), this.supList);
        svgEl('i', 'ms-ico', r, itemIcon(item));
        const t = el('div', 'ms-t', r);
        el('b', '', t, ITEM_DEFS[item].name + (SUPPLY_NEED[i] > 1 ? ` ${d.supplies[i]}/${SUPPLY_NEED[i]}` : ''));
        const zs = i < 4 ? [d.hints[i]] : d.hints.slice(4);
        el('span', '', t, d.supplies[i] >= SUPPLY_NEED[i] ? 'installed' : zs.filter((z) => z !== 255).map((z) => ZONE_NAMES[z]).join(' · ') || 'unknown');
      });
    }
  }
}
