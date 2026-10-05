// The minimap: the field map in a disc in the top-left corner,
// turned with you so the way you face is always up, with the field map's markers on it. What matters wherever it is
// (the car, waypoints, the team, pings, supply drops) waits on the rim, in its direction, while it is out of range;
// the places a car supply or a schematic is rumoured to be in only show once they are in range.
// Enemies in range are red dots on a canvas of their own, redrawn every frame (a horde is too many to be DOM markers).
// The car supplies shrink to a row of icons under it (Objective's slim mode).
import { SUPPLIES, SUPPLY_NEED, ZONE_NAMES, schematicRumours } from '../../shared/defs.js';
import { MAP_SIZE } from '../../shared/constants.js';
import { el, svgEl } from './dom.js';
import { itemIcon, glyph } from './icons.js';
import { MAP_PX, mapX, mapY } from './mapcanvas.js';

const RANGE = 70; // m from you to the rim
const MAP_PPM = MAP_PX / MAP_SIZE; // the baked map's pixels per metre
const RIM = 9; // px: a pinned marker sits this far inside the rim
const LABEL_IN = 0.82; // a place's name shows while it is inside this much of the radius

export class Minimap {
  constructor(parent) {
    this.root = el('div', 'mmap', parent);
    this.root.hidden = true;
    this.cv = el('canvas', 'mmap-cv', this.root);
    this.g = this.cv.getContext('2d', { alpha: false });
    el('i', 'mmap-fov', this.root); // a faint wedge: what is in front of you
    this.en = el('canvas', 'mmap-en', this.root);
    this.eg = this.en.getContext('2d');
    this.enN = 0; // dots drawn last frame, so an empty disc is not cleared every frame
    this.labels = el('div', 'mmap-labs', this.root);
    this.marks = el('div', 'mmap-mks', this.root);
    svgEl('i', 'mmap-you', this.root, glyph('arrowUp'));
    this.north = el('b', 'mmap-n', this.root, 'N');
    this.pool = [];
    this.labPool = [];
    this.size = 0; // css px across, kept by the observer (reading it every frame would force a layout)
    this.drawn = ''; // what the canvas shows, so a frame standing still draws nothing
    new ResizeObserver(() => this._resize()).observe(this.root);
  }

  _resize() {
    const s = this.root.clientWidth;
    if (!s) return;
    this.size = s;
    const n = Math.round(s * Math.min(2, window.devicePixelRatio || 1));
    if (this.cv.width !== n) this.cv.width = this.cv.height = n;
    if (this.en.width !== n) this.en.width = this.en.height = n;
    this.enN = -1;
    this.drawn = '';
  }

  setVisible(v) {
    if (this.root.hidden === !v) return;
    this.root.hidden = !v;
    this.drawn = '';
  }

  // screen: the field map (MapScreen: its world and baked map). d: what it shows (Game.mapData())
  update(screen, d) {
    if (this.root.hidden || !this.size) return;
    const map = screen.baked();
    const world = screen.world;
    if (!map) return;
    const { x, z, yaw } = d.self;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const n = this.cv.width;
    const key = `${x.toFixed(2)},${z.toFixed(2)},${yaw.toFixed(4)},${n}`;
    if (key !== this.drawn) {
      this.drawn = key;
      const g = this.g;
      const k = n / (2 * RANGE) / MAP_PPM;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#3a2f22'; // past the edge of the survey
      g.fillRect(0, 0, n, n);
      // turned so your facing is up: the same turn as the field map's "facing up" (rotate by your yaw)
      g.setTransform(k * c, k * s, -k * s, k * c, n / 2, n / 2);
      g.drawImage(map, -mapX(x), -mapY(z));
    }

    // world -> px from the middle of the disc
    const ppm = this.size / (2 * RANGE);
    const r = this.size / 2;
    const at = (wx, wz) => {
      const dx = wx - x;
      const dz = wz - z;
      return [(dx * c - dz * s) * ppm, (dx * s + dz * c) * ppm];
    };
    const tf = (px, py) => `translate(${px.toFixed(1)}px,${py.toFixed(1)}px)`;

    // north on the rim
    const nt = tf(s * (r - RIM), -c * (r - RIM));
    if (this.nTf !== nt) this.north.style.transform = this.nTf = nt;

    // names of the places you have found, while they are well inside the disc
    let li = 0;
    for (const zn of world.zones) {
      if (!d.discovered.has(zn.id)) continue;
      const [px, py] = at(zn.x, zn.z);
      if (Math.hypot(px, py) > r * LABEL_IN) continue;
      let l = this.labPool[li];
      if (!l) l = this.labPool[li] = { e: el('span', 'mmap-lab', this.labels), t: '', tf: '' };
      li++;
      const t = ZONE_NAMES[zn.id];
      if (l.t !== t) l.e.textContent = l.t = t;
      const lt = tf(px, py) + ' translate(-50%,-50%)';
      if (l.tf !== lt) l.e.style.transform = l.tf = lt;
      if (l.e.hidden) l.e.hidden = false;
    }
    for (let i = li; i < this.labPool.length; i++) if (!this.labPool[i].e.hidden) this.labPool[i].e.hidden = true;

    // enemies in range: red dots, a Tank's or a boss's bigger
    const eg = this.eg;
    const sc = n / this.size;
    const dot = this.size * 0.018 * sc;
    let en = 0;
    if (this.enN) eg.clearRect(0, 0, n, n);
    for (const e of d.enemies || []) {
      const [px, py] = at(e.x, e.z);
      if (px * px + py * py > (r - 2) * (r - 2)) continue;
      if (!en++) {
        eg.fillStyle = '#c41414';
        eg.strokeStyle = 'rgba(232, 220, 192, 0.9)';
        eg.lineWidth = Math.max(1, 1.2 * sc);
      }
      eg.beginPath();
      eg.arc((px + r) * sc, (py + r) * sc, e.big ? dot * 1.7 : dot, 0, Math.PI * 2);
      eg.fill();
      eg.stroke();
    }
    this.enN = en;

    let mi = 0;
    // pin: out of range it waits on the rim, in its direction; otherwise it is only shown in range
    const put = (wx, wz, cls, icon, pin) => {
      let [px, py] = at(wx, wz);
      const dist = Math.hypot(px, py);
      let edge = false;
      if (dist > r - RIM) {
        if (!pin) return;
        px *= (r - RIM) / dist;
        py *= (r - RIM) / dist;
        edge = true;
      }
      let m = this.pool[mi];
      if (!m) m = this.pool[mi] = { e: svgEl('i', 'mmap-mk', this.marks, ''), c: '', k: '', tf: '' };
      mi++;
      const cl = 'mmap-mk ' + cls + (edge ? ' edge' : '');
      if (m.c !== cl) m.e.className = m.c = cl;
      if (m.k !== icon) m.e.innerHTML = m.k = icon;
      const mt = tf(px, py);
      if (m.tf !== mt) m.e.style.transform = m.tf = mt;
      if (m.e.hidden) m.e.hidden = false;
    };
    // drawn in this order, so the later ones are on top
    const taken = (i) => !!(d.found & (1 << i));
    const seen = new Set();
    d.hints.forEach((zid, i) => {
      if (zid === 255 || taken(i)) return;
      const si = Math.min(i, 4);
      if (d.supplies[si] >= SUPPLY_NEED[si] || seen.has(zid + ':' + si)) return;
      seen.add(zid + ':' + si);
      const zn = world.zoneById[zid];
      if (zn) put(zn.x, zn.z, 'hint', itemIcon(SUPPLIES[si]), false);
    });
    // rumoured schematics, beside a supply rumoured to the same place and side by side with each other
    const perPlace = new Map();
    for (const rm of schematicRumours(d.schemHints, d.unlocked)) {
      const zn = world.zoneById[rm.zone];
      if (!zn) continue;
      const n = perPlace.get(rm.zone) || 0;
      perPlace.set(rm.zone, n + 1);
      put(zn.x + 8 + n * 6, zn.z + 4, 'schem', itemIcon(rm.item), false);
    }
    for (const b of d.benches) put(b.x, b.z, 'bench', glyph('wrench'), false);
    for (const t of d.teamWays) put(t.x, t.z, 'teamway', glyph('flag'), true);
    if (d.waypoint) put(d.waypoint.x, d.waypoint.z, 'way', glyph('flag'), true);
    for (const cr of d.crates) put(cr.x, cr.z, 'crate', glyph('hazard'), true);
    for (const p of d.pings) put(p.x, p.z, 'ping k' + p.kind, glyph('ping'), true);
    put(d.car.x, d.car.z, 'car', glyph('car'), true);
    for (const m of d.mates) put(m.x, m.z, 'mate ' + m.status, glyph(m.status === 'downed' ? 'downed' : 'person'), true);
    for (let i = mi; i < this.pool.length; i++) if (!this.pool[i].e.hidden) this.pool[i].e.hidden = true;
  }
}
