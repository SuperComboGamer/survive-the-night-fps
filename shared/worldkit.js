// What a world is built with: the collider grids, the lists a world hands on (parts, props, containers, loot and
// supply spots, doorways, roofs...) and the Builder that fills them in a place's own frame. world.js builds the island
// with one, mainland.js the mainland: the same walls, rooms, roofs, props and placement rules in both.
import { ZONE, CONT } from './defs.js';
import { PROPS } from './props.js';
import { ColliderGrid, makeBox, makeCyl, COL } from './collision.js';

const PI = Math.PI;

// rng: the world's seeded stream (a prop without a seed of its own draws one from it). heightAt(x, z): the terrain,
// read as it is when something is put down. half: half the side of the map (m).
export function createKit({ rng, heightAt, half }) {
  const staticGrid = new ColliderGrid(half + 20, 8);
  const structGrid = new ColliderGrid(half + 20, 8);
  const parts = []; // visual primitives {shape, x,y,z, sx,sy,sz, rx,ry,rz, mat, sides}
  const props = []; // {type, x,y,z, ry, seed}
  const lootSpawns = []; // floor items {x,y,z, zone}
  const containers = []; // searchable containers {x,y,z, ry, ctype, zone}
  const partSpots = []; // hidden car-supply spots {x,y,z, zone}
  const openings = []; // doorways structures snap into {x,y,z, ry, w, h}
  const extraTrees = []; // [x,z,variant,scale]
  const lights = []; // decorative static light spots (client may use): {x,y,z,kind}
  const roofs = []; // roof footprints (client keeps rain out): {x,z, c,s (local->world like Builder), hx,hz, y (eaves), rise (+ ridge along local z, - along local x)}
  const clears = []; // [x, z, r] keep vegetation out

  // prop: the entry of `props` these are the solids of (a collider's tag: what a blow or a bullet struck, and which
  // wreck is being taken apart - shared/surfaces.js, shared/wrecks.js); a prop put down without one is named by type
  const bare = {};
  const addPropColliders = (type, x, y, z, ry, prop = null) => {
    const def = PROPS[type];
    if (!def) return;
    const tag = prop || (bare[type] ||= { type, bare: true });
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const flags = COL.STATIC | (def.salvage ? COL.SALVAGE : 0);
    if (def.boxes) {
      for (const b of def.boxes) {
        const [lx, ly, lz, sx, sy, sz] = b;
        const wx = x + c * lx + s * lz;
        const wz = z - s * lx + c * lz;
        const col = makeBox(wx, wz, y + ly - sy / 2, y + ly + sy / 2, sx, sz, ry, flags);
        col.tag = tag;
        staticGrid.add(col);
      }
    }
    if (def.cyls) {
      for (const cy of def.cyls) {
        const [lx, lz, r, h] = cy;
        const wx = x + c * lx + s * lz;
        const wz = z - s * lx + c * lz;
        const col = makeCyl(wx, wz, y, y + h, r, flags);
        col.tag = tag;
        staticGrid.add(col);
      }
    }
  };

  // Where a prop touches the ground, [x0, x1, z0, z1] in its own frame: the collision boxes that reach down to its
  // base and its cylinders. null for things that only lie there (a corpse, a duffel bag: no collider).
  const FOOT = {};
  const footprint = (type) => {
    if (type in FOOT) return FOOT[type];
    const def = PROPS[type] || {};
    let f = null;
    const grow = (x0, x1, z0, z1) => {
      f = f ? [Math.min(f[0], x0), Math.max(f[1], x1), Math.min(f[2], z0), Math.max(f[3], z1)] : [x0, x1, z0, z1];
    };
    for (const [lx, ly, lz, sx, sy, sz] of def.boxes || []) if (ly - sy / 2 < 0.3) grow(lx - sx / 2, lx + sx / 2, lz - sz / 2, lz + sz / 2);
    for (const [lx, lz, r] of def.cyls || []) grow(lx - r, lx + r, lz - r, lz + r);
    return (FOOT[type] = f);
  };
  // Base height of a prop standing on open ground. Props are always upright (colliders only turn about Y), so on a
  // slope it is the ground under the lowest corner of the footprint: the uphill side digs in, nothing hangs in the air.
  const seatY = (type, x, z, ry) => {
    const f = footprint(type);
    if (!f) return heightAt(x, z);
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    let y = Infinity;
    for (const lx of [f[0], f[1]]) for (const lz of [f[2], f[3]]) y = Math.min(y, heightAt(x + c * lx + s * lz, z - s * lx + c * lz));
    return y;
  };

  // Does a prop of this type at (x, z, ry) stand in a solid prop already placed (their colliders, seen from above)?
  // For what is scattered along the roads after the places and the sites are built: a power pole or a sign that
  // would come up through a wreck, a crate or a shed is left out.
  const solidsOf = (type, x, z, ry) => {
    const def = PROPS[type];
    if (!def) return [];
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const out = [];
    for (const [lx, , lz, sx, , sz] of def.boxes || []) out.push({ x: x + c * lx + s * lz, z: z - s * lx + c * lz, hx: sx / 2, hz: sz / 2, c, s, r: 0 });
    for (const [lx, lz, r] of def.cyls || []) out.push({ x: x + c * lx + s * lz, z: z - s * lx + c * lz, hx: 0, hz: 0, c: 1, s: 0, r });
    return out;
  };
  // separating axes for two boxes swept by a radius each (a cylinder is a box of no size and a radius)
  const solidsMeet = (a, b) => {
    for (const o of [a, b]) {
      for (const [ax, az] of [[o.c, -o.s], [o.s, o.c]]) {
        const ext = (q) => q.hx * Math.abs(q.c * ax - q.s * az) + q.hz * Math.abs(q.s * ax + q.c * az) + q.r;
        if (Math.abs((a.x - b.x) * ax + (a.z - b.z) * az) >= ext(a) + ext(b)) return false;
      }
    }
    // two cylinders: the axes above are only X and Z, measure them centre to centre
    if (!a.hx && !b.hx) return Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r;
    return true;
  };
  const propBlocked = (type, x, z, ry) => {
    const mine = solidsOf(type, x, z, ry);
    for (const p of props) {
      if (Math.abs(p.x - x) > 12 || Math.abs(p.z - z) > 12) continue;
      for (const b of solidsOf(p.type, p.x, p.z, p.ry)) for (const a of mine) if (solidsMeet(a, b)) return true;
    }
    return false;
  };

  class Builder {
    constructor(ox, oz, ry, y0) {
      this.ox = ox;
      this.oz = oz;
      this.ry = ry;
      this.y0 = y0;
      this.c = Math.cos(ry);
      this.s = Math.sin(ry);
      this.zone = ZONE.FOREST;
      this.ground = false; // props follow the terrain (roadside sites)
      this.yard = null; // the place being built: its props follow the terrain beyond the levelled radius (yard.flat)
    }
    wx(lx, lz) {
      return this.ox + this.c * lx + this.s * lz;
    }
    wz(lx, lz) {
      return this.oz - this.s * lx + this.c * lz;
    }
    sub(lx, lz, ry = 0, ly = 0) {
      const b = new Builder(this.wx(lx, lz), this.wz(lx, lz), this.ry + ry, this.y0 + ly);
      b.zone = this.zone;
      b.ground = this.ground;
      b.yard = this.yard;
      return b;
    }
    // ly = bottom of box (relative to builder base height)
    box(lx, ly, lz, sx, sy, sz, mat, o = {}) {
      const x = this.wx(lx, lz);
      const z = this.wz(lx, lz);
      const y = this.y0 + ly;
      const ry = this.ry + (o.ry || 0);
      parts.push({ shape: 'box', x, y: y + sy / 2, z, sx, sy, sz, rx: o.rx || 0, ry, rz: o.rz || 0, mat });
      if (o.collide !== false && !o.rx && !o.rz) {
        const col = makeBox(x, z, y, y + sy, sx, sz, ry, o.flags || COL.STATIC);
        col.tag = mat;
        staticGrid.add(col);
      }
    }
    cyl(lx, ly, lz, r, h, mat, o = {}) {
      const x = this.wx(lx, lz);
      const z = this.wz(lx, lz);
      const y = this.y0 + ly;
      parts.push({ shape: 'cyl', x, y: y + h / 2, z, sx: r * 2, sy: h, sz: r * 2, rx: o.rx || 0, ry: this.ry + (o.ry || 0), rz: o.rz || 0, mat, sides: o.sides || 14 });
      if (o.collide !== false && !o.rx && !o.rz) {
        const col = makeCyl(x, z, y, y + h, r, COL.STATIC);
        col.tag = mat;
        staticGrid.add(col);
      }
    }
    cone(lx, ly, lz, r, h, mat, sides = 4, o = {}) {
      const x = this.wx(lx, lz);
      const z = this.wz(lx, lz);
      parts.push({ shape: 'cone', x, y: this.y0 + ly + h / 2, z, sx: r * 2, sy: h, sz: r * 2, rx: 0, ry: this.ry + (o.ry ?? PI / 4), rz: 0, mat, sides });
    }
    // triangular prism: triangle in local XY (width sx, height sy), extruded along Z (sz)
    prism(lx, ly, lz, sx, sy, sz, mat, o = {}) {
      const x = this.wx(lx, lz);
      const z = this.wz(lx, lz);
      parts.push({ shape: 'prism', x, y: this.y0 + ly + sy / 2, z, sx, sy, sz, rx: 0, ry: this.ry + (o.ry || 0), rz: 0, mat });
    }
    // is (x,z) off this builder's levelled base? (a roadside site: everywhere; a place: outside its yard, where the
    // ground is whatever the hills are - a field or a traffic queue that runs on past the yard must not keep its height)
    open(x, z) {
      return this.ground || (this.yard !== null && Math.hypot(x - this.yard.x, z - this.yard.z) > this.yard.flat);
    }
    baseY(type, x, z, ry, o) {
      if (o.y !== undefined) return o.y;
      if (o.ly !== undefined) return this.y0 + o.ly;
      return o.ground || (o.ground !== false && this.open(x, z)) ? seatY(type, x, z, ry) : this.y0;
    }
    prop(type, lx, lz, ry = 0, o = {}) {
      const x = this.wx(lx, lz);
      const z = this.wz(lx, lz);
      const wry = this.ry + ry;
      const y = this.baseY(type, x, z, wry, o);
      const pr = { type, x, y, z, ry: wry, seed: o.seed ?? rng.int(0, 9999) };
      props.push(pr);
      if (!o.nocollide) addPropColliders(type, x, y, z, wry, pr);
      return { x, y, z, ry: wry };
    }
    loot(lx, lz, ly = 0.02) {
      const x = this.wx(lx, lz);
      const z = this.wz(lx, lz);
      const y = this.ground ? heightAt(x, z) + ly : this.y0 + ly;
      lootSpawns.push({ x, y, z, zone: this.zone });
    }
    // searchable container, optionally with its prop. h = interaction point height above the base.
    cont(ctype, lx, lz, o = {}) {
      const x = this.wx(lx, lz);
      const z = this.wz(lx, lz);
      const y = this.baseY(o.prop, x, z, this.ry + (o.ry || 0), o);
      if (o.prop) this.prop(o.prop, lx, lz, o.ry || 0, { y, seed: o.seed, nocollide: o.nocollide });
      containers.push({ x, y: y + (o.h ?? CONT_H[ctype] ?? 0.5), z, ry: this.ry + (o.ry || 0), ctype, zone: o.zone ?? this.zone });
    }
    // container attached to a prop point (e.g. the trunk of a wreck)
    contAt(ctype, x, y, z, ry, zone) {
      containers.push({ x, y, z, ry, ctype, zone: zone ?? this.zone });
    }
    partSpot(lx, lz, ly = 0.02) {
      const x = this.wx(lx, lz);
      const z = this.wz(lx, lz);
      partSpots.push({ x, y: (this.ground ? heightAt(x, z) : this.y0) + ly, z, zone: this.zone });
    }
    tree(lx, lz, variant, scale = 1) {
      extraTrees.push([this.wx(lx, lz), this.wz(lx, lz), variant, scale]);
    }
    clear(lx, lz, r) {
      clears.push([this.wx(lx, lz), this.wz(lx, lz), r]);
    }
    light(lx, ly, lz, kind) {
      lights.push({ x: this.wx(lx, lz), y: this.y0 + ly, z: this.wz(lx, lz), kind });
    }
    // a wreck with a searchable trunk
    wreck(type, lx, lz, ry, o = {}) {
      const p = this.prop(type, lx, lz, ry, o);
      if (o.trunk === false) return p;
      const back = type === 'pickup_truck' ? 2.9 : type === 'camper' ? 3.5 : 2.45;
      const tx = p.x + Math.sin(p.ry) * back;
      const tz = p.z + Math.cos(p.ry) * back;
      this.contAt(CONT.TRUNK, tx, p.y + 0.8, tz, p.ry, o.zone ?? (this.zone === ZONE.FOREST ? ZONE.ROADSIDE : this.zone));
      return p;
    }
    // wall from (x0,z0) to (x1,z1) local; openings: [{at, w, y0, y1, glass}]
    wall(x0, z0, x1, z1, h, t, mat, openings_ = [], ly = 0) {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const L = Math.hypot(dx, dz);
      const ux = dx / L;
      const uz = dz / L;
      const wry = Math.atan2(-dz, dx);
      const seg = (s0, s1, y0, y1, m = mat, collide = true) => {
        if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
        const sc = (s0 + s1) / 2;
        this.box(x0 + ux * sc, ly + y0, z0 + uz * sc, s1 - s0, y1 - y0, t, m, { ry: wry, collide });
      };
      const ops = openings_.slice().sort((a, b) => a.at - b.at);
      let cur = 0;
      for (const o of ops) {
        const a = o.at - o.w / 2;
        const b = o.at + o.w / 2;
        seg(cur, a, 0, h);
        if (o.y0 > 0) seg(a, b, 0, o.y0);
        if (o.y1 < h) seg(a, b, o.y1, h);
        if (o.glass) seg(a, b, o.y0, o.y1, 'glass', false);
        cur = b;
        // doorways: door boards snap into these
        if (o.y0 === 0 && !o.glass && o.w <= 1.75) {
          const lx = x0 + ux * o.at;
          const lz = z0 + uz * o.at;
          openings.push({ x: this.wx(lx, lz), y: this.y0 + ly, z: this.wz(lx, lz), ry: this.ry + wry, w: o.w, h: Math.min(o.y1, h) });
        }
      }
      seg(cur, L, 0, h);
    }
    // rectangular building shell centered at (cx,cz) local, w along X, d along Z, doors/windows per side
    // sides: n (-Z front), s (+Z back), w (-X), e (+X): arrays of openings with `at` measured from the side's start corner
    room(cx, cz, w, d, h, mat, sides = {}, o = {}) {
      const t = o.t || 0.25;
      const x0 = cx - w / 2;
      const x1 = cx + w / 2;
      const z0 = cz - d / 2;
      const z1 = cz + d / 2;
      this.wall(x0, z0, x1, z0, h, t, mat, sides.n || []);
      this.wall(x1, z1, x0, z1, h, t, mat, sides.s || []);
      this.wall(x0, z1, x0, z0, h, t, mat, sides.w || []);
      this.wall(x1, z0, x1, z1, h, t, mat, sides.e || []);
      if (o.floor !== false) this.box(cx, 0, cz, w, 0.12, d, o.floorMat || 'planks', { collide: true });
      this.roof(cx, cz, w, d, h, mat, o);
      this.clear(cx, cz, Math.hypot(w, d) / 2 + 1.5);
    }
    roofSpan(cx, cz, hx, hz, h, rise = 0) {
      roofs.push({ x: this.wx(cx, cz), z: this.wz(cx, cz), c: this.c, s: this.s, hx, hz, y: this.y0 + h, rise });
    }
    roof(cx, cz, w, d, h, mat, o) {
      if (o.roof === 'gable') this.roofSpan(cx, cz, w / 2 + 0.35, d / 2 + 0.45, h, o.roofH || w * 0.35);
      else if (o.roof === 'gableZ') this.roofSpan(cx, cz, w / 2 + 0.45, d / 2 + 0.35, h, -(o.roofH || d * 0.35));
      else if (o.roof === 'flat') this.roofSpan(cx, cz, w / 2 + 0.3, d / 2 + 0.3, h, 0.3);
      if (o.roof === 'gable') {
        const rh = o.roofH || w * 0.35;
        this.prism(cx, h, cz, w + 0.1, rh, d + 0.1, mat);
        const ang = Math.atan2(rh, w / 2);
        const slab = Math.hypot(w / 2, rh) + 0.45;
        const off = (Math.hypot(w / 2, rh) + 0.45) / 2 - 0.2;
        const rmat = o.roofMat || 'shingles';
        // two slopes (rotate about local Z)
        this.box(cx - Math.cos(ang) * off, h + rh - Math.sin(ang) * off - 0.05, cz, slab, 0.14, d + 0.9, rmat, { rz: ang, collide: false });
        this.box(cx + Math.cos(ang) * off, h + rh - Math.sin(ang) * off - 0.05, cz, slab, 0.14, d + 0.9, rmat, { rz: -ang, collide: false });
      } else if (o.roof === 'gableZ') {
        // ridge along X: build prism rotated 90deg
        const rh = o.roofH || d * 0.35;
        this.prism(cx, h, cz, d + 0.1, rh, w + 0.1, mat, { ry: PI / 2 });
        const ang = Math.atan2(rh, d / 2);
        const slab = Math.hypot(d / 2, rh) + 0.45;
        const off = slab / 2 - 0.2;
        const rmat = o.roofMat || 'shingles';
        this.box(cx, h + rh - Math.sin(ang) * off - 0.05, cz - Math.cos(ang) * off, slab, 0.14, w + 0.9, rmat, { ry: PI / 2, rz: -ang, collide: false });
        this.box(cx, h + rh - Math.sin(ang) * off - 0.05, cz + Math.cos(ang) * off, slab, 0.14, w + 0.9, rmat, { ry: PI / 2, rz: ang, collide: false });
      } else if (o.roof === 'flat') {
        this.box(cx, h, cz, w + 0.6, 0.3, d + 0.6, o.roofMat || 'concrete', { collide: true });
      }
    }
    // open-sided shelter: posts + roof slab
    shelter(cx, cz, w, d, h, roofMat = 'tin', postMat = 'planks') {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.cyl(cx + sx * (w / 2 - 0.2), 0, cz + sz * (d / 2 - 0.2), 0.11, h, postMat, { sides: 6 });
      this.box(cx, h, cz, w + 0.5, 0.14, d + 0.5, roofMat, { collide: false });
      this.roofSpan(cx, cz, w / 2 + 0.25, d / 2 + 0.25, h, 0.14);
    }
  }

  const door = (at, w = 1.3) => ({ at, w, y0: 0, y1: 2.2 });
  const win = (at, w = 1.2, y0 = 1.05, y1 = 2.0) => ({ at, w, y0, y1, glass: true });
  const gap = (at, w, y1) => ({ at, w, y0: 0, y1 });

  return { staticGrid, structGrid, parts, props, lootSpawns, containers, partSpots, openings, extraTrees, lights, roofs, clears, addPropColliders, footprint, seatY, solidsOf, solidsMeet, propBlocked, Builder, door, win, gap };
}

// interaction point height of each container kind (above its base)
const CONT_H = {
  [CONT.CRATE]: 0.6,
  [CONT.AMMO_BOX]: 0.45,
  [CONT.TRUNK]: 0.8,
  [CONT.DUFFEL]: 0.22,
  [CONT.LOCKER]: 1.0,
  [CONT.CABINET]: 0.6,
  [CONT.TOOLBOX]: 0.2,
  [CONT.SHELF]: 1.0,
  [CONT.DUMPSTER]: 0.9,
  [CONT.LOGPILE]: 0.8,
  [CONT.FRIDGE]: 1.0,
  [CONT.STRONGBOX]: 0.5,
};
