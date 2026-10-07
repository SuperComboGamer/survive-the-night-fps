// What a blow or a bullet does to the world it lands on. One place for all of it: a melee swing that struck something
// (EVT.STRIKE), a bullet stopped by something (ours as it is fired, anyone else's from their EVT.SHOT), a blast
// (EVT.EXPLOSION), and the wrecks the server keeps a record of (EVT.WRECK, EVT.WRECK_ALARM).
//
// For each: what was struck (the collider's tag, or for a prop the very triangle of its model: shared/surfaces.js),
// then the mark it leaves (render/marks.js), the bits and dust that fly (render/strikefx.js), the sound, and what
// the thing itself does - a wreck rocks on its springs and comes apart, a barrel wobbles, a window that has been
// shot enough falls out (render/wrecks.js). None of it but the wrecks' records is anybody's state: marks fade, and
// a client that joins later sees a clean wall.
import * as THREE from 'three';
import { raycastWorld, COL, BOX } from '../../shared/collision.js';
import { SOUND, CONT } from '../../shared/defs.js';
import { PROPS } from '../../shared/props.js';
import { SURF, BLOW, MARK, LIGHT_PROPS, surfaceOf, surfaceOfMat, surfaceOfProp, markFor, shotMark, shotScale, soundFor, blowForce, PIT_MARK } from '../../shared/surfaces.js';
import { WRECKF, WRECK_HITS_MAX, wreckOf, wreckColAt } from '../../shared/wrecks.js';
import { trunkCar, hasBootLid } from '../../shared/trunk.js';
import { dqpos } from '../../shared/protocol.js';
import { Marks, markCorners } from '../render/marks.js';
import { StrikeFx } from '../render/strikefx.js';
import { Wrecks, strokeCorners, roomAt } from '../render/wrecks.js';
import { TEX } from '../render/effects.js';

const PANE_HALF = 0.022; // half the thickness a pane is drawn with (StaticWorld: 0.04), and a hair
export const PANE_SHOTS = 4; // bullets a window pane takes before it falls out (a shotgun's pattern is that many)
const _ray = { t: -1, col: null, terrain: false };
const _tri = { t: -1, piece: 0, vert: 0, name: '', nx: 0, ny: 0, nz: 0 };
const _hit = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, surf: 0, owner: null, prop: null, fit: 9, bare: false };
const _v = new THREE.Vector3();
const hash = (x, y, z) => {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
};

export class Impacts {
  constructor(g) {
    this.g = g;
    this.marks = new Marks(g.scene);
    this.fx = new StrikeFx(g.effects, g.scene, g.world);
    this.wrecks = new Wrecks(g.scene, {
      sound: (name, x, y, z, vol) => this.sound(name, x, y, z, vol),
      shatter: (q, nx, ny, nz, dx, dy, dz, n) => this.fx.shatter(q, nx, ny, nz, dx, dy, dz, n),
      puff: (x, y, z) => g.effects.alpha.emit(x, y + 0.05, z, 0, 0.4, 0, 0.9, 0.25, 0.9, 0.36, 0.33, 0.29, 0.4, 0.36, 0.33, 0.29, 0, 0, 2, TEX.SMOKE),
      scrap: (x, y, z, nx, ny, nz) => this.fx.scrap(x, y, z, nx, ny, nz, 2, 1, g.time - this.mineT < 0.4 ? g.camera.position : null),
      flash: (x, y, z, k) => {
        // a hazard lamp's blink: an amber glow round a hot middle
        g.effects.add.emit(x, y, z, 0, 0, 0, 0.2, 1.7 * k, 1.1 * k, 1, 0.5, 0.08, 1, 1, 0.35, 0.03, 0, 0, 0, TEX.GLOW);
        g.effects.add.emit(x, y, z, 0, 0, 0, 0.2, 0.5 * k, 0.4 * k, 1, 0.85, 0.55, 1, 1, 0.6, 0.2, 0, 0, 0, TEX.GLOW);
        if (Math.hypot(x - g.camera.position.x, z - g.camera.position.z) < 40) g.lights.flashMuzzle(_v.set(x, y, z), 0.35 * k, 0.12);
      },
    });
    this.panes = [];
    this.trunkT = 0;
    // a ray against the world for roomAt: how far, and (near enough for a flat face) the normal it was asked along
    this.worldRay = (ox, oy, oz, dx, dy, dz, maxT, out) => {
      raycastWorld(g.world, ox, oy, oz, dx, dy, dz, maxT, _ray);
      out.t = _ray.t;
      out.nx = -dx;
      out.ny = -dy;
      out.nz = -dz;
      return out;
    };
    this.mineT = -9;
    this.soundT = 0;
    this.told = false;
    this.setWorld();
  }

  // a new valley (or the mainland): nothing of the old one is left
  setWorld() {
    const g = this.g;
    this.marks.pool.clear();
    this.fx.setWorld(g.world);
    this.wrecks.setWorld(g.world, g.staticWorld, this.marks);
    this.wrecks.setShadows(!!g.renderer.q.shadows);
    // the window panes: glass has no collider (a bullet goes through it), so what a shot crosses is asked of these
    this.panes = [];
    for (const part of g.world.parts) {
      if (part.mat !== 'glass' || part.shape !== 'box' || part.rx || part.rz || part.hidden) continue;
      this.panes.push({ part, x: part.x, y: part.y, z: part.z, hw: part.sx / 2, hh: part.sy / 2, nx: Math.sin(part.ry), nz: Math.cos(part.ry), r: Math.hypot(part.sx, part.sy) / 2, shots: 0, out: false });
    }
  }
  // dawn (EVT.REGROWN): the wrecks are whole and the windows are in again; what was scratched on the walls stays
  regrown() {
    this.wrecks.reset();
    for (const p of this.panes) {
      if (p.out) this.g.staticWorld.drop(p.part);
      p.out = false;
      p.shots = 0;
    }
  }
  // a structure torn down, a tree felled: its marks go with it
  gone(owner) {
    if (owner) this.marks.pool.removeOwner(owner);
  }
  update(dt) {
    const g = this.g;
    this.wrecks.update(dt, g.time, g.camera.position);
    if ((this.trunkT -= dt) <= 0) this.trunks();
    this.fx.update(dt);
    this.marks.update(g.time);
  }

  // ---------------------------------------------------------------- boots forced open
  // The car a boot's container belongs to, when that car has a lid to force (shared/trunk.js), or null. e: the
  // container's entity.
  bootOf(e) {
    if (e.car === undefined) {
      const car = trunkCar(this.g.world, { ctype: e.ctype, x: dqpos(e.q[0]), z: dqpos(e.q[2]) });
      e.car = hasBootLid(car) && this.g.staticWorld.lifts.has(car) ? car : null;
    }
    return e.car;
  }
  // Every boot we know of: its lid up while its container is searched, a few times a second. One that is searched
  // as we watch (it was not, the last time we looked) is seen and heard going up; one that comes into view already
  // searched just stands open - so who joins late, or walks up later, finds it as the others left it.
  trunks() {
    this.trunkT = 0.2;
    const g = this.g;
    const eye = g.camera.position;
    for (const e of g.entities?.caches || []) {
      if (e.ctype !== CONT.TRUNK || !e.q) continue;
      const car = this.bootOf(e);
      if (!car || Math.hypot(car.x - eye.x, car.z - eye.z) > 170) continue;
      const open = e.q[3] !== 0;
      const live = open && e.bootSeen === false;
      e.bootSeen = open;
      this.wrecks.pry(car, open, live);
    }
  }

  sound(name, x, y, z, vol = 1) {
    if (name === 'glass_break') return this.g.audio.play(SOUND.GLASS_BREAK, { x, y, z, volume: vol });
    this.g.audio.strike?.(name, { x, y, z, volume: vol });
  }

  // ---------------------------------------------------------------- what was struck
  /**
   * What a ray from o along d (unit) stops on within maxT, as _hit: where, the surface's normal there, what it is
   * made of, who owns a mark on it, how far it is to the edge of that face. col / terrain: the answer when the
   * caller has traced the world already (t: how far along). Returns null when it stops on nothing.
   */
  resolve(ox, oy, oz, dx, dy, dz, maxT, traced = null) {
    const g = this.g, world = g.world;
    let t, col, terrain;
    if (traced) ({ t, col, terrain } = traced);
    else {
      raycastWorld(world, ox, oy, oz, dx, dy, dz, maxT, _ray);
      ({ t, col, terrain } = _ray);
    }
    if (t < 0) return null;
    const h = _hit;
    h.x = ox + dx * t;
    h.y = oy + dy * t;
    h.z = oz + dz * t;
    h.owner = null;
    h.prop = null;
    h.fit = 9;
    h.bare = false;
    if (terrain || !col) {
      const e = 0.3;
      const sx = world.heightAt(h.x + e, h.z) - world.heightAt(h.x - e, h.z), sz = world.heightAt(h.x, h.z + e) - world.heightAt(h.x, h.z - e);
      const l = Math.hypot(sx, 2 * e, sz);
      h.nx = -sx / l;
      h.ny = (2 * e) / l;
      h.nz = -sz / l;
      h.surf = surfaceOf(null, true, g.surfaceAt(h.x, h.y, h.z));
      return h;
    }
    const tag = col.tag;
    const prop = tag && typeof tag === 'object' && !tag.bare ? tag : null;
    if (prop && !(col.flags & (COL.TREE | COL.STRUCT))) {
      // a prop: the triangle of its model the ray strikes (the collider is only a box round it)
      const back = Math.min(t, 0.6);
      const r = this.wrecks.ray(prop, h.x - dx * back, h.y - dy * back, h.z - dz * back, dx, dy, dz, back + 2.2, _tri);
      h.prop = prop;
      h.owner = prop;
      if (r.t >= 0) {
        h.x += dx * (r.t - back);
        h.y += dy * (r.t - back);
        h.z += dz * (r.t - back);
        h.nx = r.nx;
        h.ny = r.ny;
        h.nz = r.nz;
        h.surf = surfaceOfMat(r.name);
        h.fit = 0.5;
        return h;
      }
      // through its box and past the model (between the legs of a chair): nothing to mark
      h.surf = surfaceOfProp(prop.type);
      h.bare = true;
      h.nx = -dx;
      h.ny = -dy;
      h.nz = -dz;
      return h;
    }
    // a wall, a tree, something built: the face of the collider's box (or the round of its cylinder)
    h.surf = surfaceOf(col, false, '', (id) => g.entities.ents.get(id)?.stype);
    if (col.flags & (COL.TREE | COL.STRUCT)) h.owner = col;
    const top = col.y1 - h.y, bot = h.y - col.y0;
    if (col.type === BOX) {
      const rx = h.x - col.x, rz = h.z - col.z;
      const lx = col.c * rx - col.s * rz, lz = col.s * rx + col.c * rz;
      const ex = col.hx - Math.abs(lx), ez = col.hz - Math.abs(lz);
      const m = Math.min(ex, ez, top, bot);
      if (m === top || m === bot) {
        h.nx = 0;
        h.ny = m === top ? 1 : -1;
        h.nz = 0;
        h.fit = Math.min(ex, ez);
      } else if (m === ex) {
        const s = lx < 0 ? -1 : 1;
        h.nx = col.c * s;
        h.ny = 0;
        h.nz = -col.s * s;
        h.fit = Math.min(ez, top, bot);
      } else {
        const s = lz < 0 ? -1 : 1;
        h.nx = col.s * s;
        h.ny = 0;
        h.nz = col.c * s;
        h.fit = Math.min(ex, top, bot);
      }
    } else {
      const rx = h.x - col.x, rz = h.z - col.z;
      const d = Math.hypot(rx, rz);
      if (top < col.r - d && top < bot) {
        h.nx = 0;
        h.ny = 1;
        h.nz = 0;
        h.fit = col.r - d;
      } else {
        h.nx = rx / (d || 1);
        h.ny = 0;
        h.nz = rz / (d || 1);
        h.fit = Math.min(top, bot, col.r * 0.6);
      }
    }
    return h;
  }

  // A mark on what resolve() found: `m` ({ cell, w, h, along }), its long side along the stroke d when it has one.
  // It is made no bigger than the face has room for, so that it does not hang off an edge or fold round a corner.
  mark(h, m, dx, dy, dz, r, stroke = false, life) {
    if (h.bare) return;
    // (on a prop's model: no bigger than the face it struck - a pillar, a chair's leg, the rim of a barrel. On a
    // wall: a wall is often several boxes laid flush - courses of stone, the planks either side of a window - and
    // the room a big mark has is the flat round where it landed, not the one box it happened to strike)
    const half = Math.max(m.w, m.h) / 2;
    if (h.prop && half > 0.08) h.fit = roomAt((...a) => this.wrecks.ray(h.prop, ...a), h.x, h.y, h.z, h.nx, h.ny, h.nz, half);
    else if (!h.prop && half > 0.1 && h.fit < half) h.fit = Math.max(h.fit, roomAt(this.worldRay, h.x, h.y, h.z, h.nx, h.ny, h.nz, half));
    const room = Math.max(0.04, h.fit) * 2 + 0.03;
    const k = Math.min(1, room / Math.max(m.w, m.h));
    if (k < 0.3) {
      // no room for it - the rail of a fence, the leg of a chair: a nick the size of a bullet's hole instead
      if (m.w <= 0.14 || h.surf === SURF.GLASS) return;
      const nick = shotMark(h.surf, 0, 1, r);
      nick.w = nick.h = Math.min(nick.h, 0.11, Math.max(0.05, room));
      nick.along = false;
      h.fit = 9;
      return this.mark(h, nick, dx, dy, dz, r, false, life);
    }
    const w = m.w * k, hh = m.h * k;
    const c = !m.along ? markCorners(h.x, h.y, h.z, h.nx, h.ny, h.nz, w, hh, null, 0, 0, r * 6.283) : stroke ? strokeCorners(h.x, h.y, h.z, h.nx, h.ny, h.nz, w, hh, dx, dy, dz, r) : markCorners(h.x, h.y, h.z, h.nx, h.ny, h.nz, w, hh, dx, dy, dz);
    // (cracks in glass catch the light: brighter than the pane they are in)
    const shade = h.surf === SURF.GLASS ? 1.6 : 0.85 + 0.15 * r;
    this.marks.pool.add(c, h.nx, h.ny, h.nz, m.cell, shade, shade, shade, 1, h.owner, this.g.time, life);
  }

  // ---------------------------------------------------------------- windows
  // The pane a ray from o along d crosses within maxT (nearest first), or null; _hit says where.
  paneAt(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT, found = null;
    for (const p of this.panes) {
      if (p.out) continue;
      const rx = p.x - ox, ry = p.y - oy, rz = p.z - oz;
      const along = rx * dx + ry * dy + rz * dz;
      if (along < -p.r || along > best + p.r) continue;
      const dn = dx * p.nx + dz * p.nz;
      if (Math.abs(dn) < 0.02) continue;
      const t = (rx * p.nx + rz * p.nz) / dn;
      if (t < 0 || t >= best) continue;
      const hx = ox + dx * t - p.x, hy = oy + dy * t - p.y, hz = oz + dz * t - p.z;
      if (Math.abs(hy) > p.hh || Math.abs(hx * p.nz - hz * p.nx) > p.hw) continue;
      best = t;
      found = p;
    }
    if (!found) return null;
    const h = _hit, p = found;
    const s = dx * p.nx + dz * p.nz > 0 ? -1 : 1;
    // (on the face of the glass towards the shot: the pane is drawn 4 cm thick about the part's middle)
    h.x = ox + dx * best + p.nx * s * PANE_HALF;
    h.y = oy + dy * best;
    h.z = oz + dz * best + p.nz * s * PANE_HALF;
    h.nx = p.nx * s;
    h.ny = 0;
    h.nz = p.nz * s;
    h.surf = SURF.GLASS;
    h.owner = p.part;
    h.prop = null;
    h.bare = false;
    const u = (h.x - p.x) * p.nz - (h.z - p.z) * p.nx;
    h.fit = Math.max(0.12, Math.min(p.hw - Math.abs(u), p.hh - Math.abs(h.y - p.y)));
    h.t = best;
    return p;
  }
  // a pane struck: starred, and after enough of it, out
  paneHit(p, m, n, dx, dy, dz) {
    const h = _hit;
    p.shots += n;
    if (p.shots < PANE_SHOTS) {
      h.fit = 9; // (a star may run to the frame and past it: the casing hides the ends)
      this.mark(h, m, dx, dy, dz, hash(h.x, h.y, h.z));
      this.sound('glass_tick', h.x, h.y, h.z, 0.8);
      return;
    }
    p.out = true;
    this.g.staticWorld.lift(p.part);
    this.marks.pool.removeOwner(p.part);
    const ux = p.nz, uz = -p.nx;
    const q = [p.x - ux * p.hw, p.y - p.hh, p.z - uz * p.hw, p.x + ux * p.hw, p.y - p.hh, p.z + uz * p.hw, p.x + ux * p.hw, p.y + p.hh, p.z + uz * p.hw, p.x - ux * p.hw, p.y + p.hh, p.z - uz * p.hw];
    this.fx.shatter(q, p.nx, 0, p.nz, dx, dy, dz, 28);
    this.sound('glass_break', p.x, p.y, p.z, 1);
    // what is left of it on the ground on the far side
    const gx = p.x + dx * 0.5, gz = p.z + dz * 0.5;
    const gy = this.g.world.floorAt ? this.g.world.floorAt(gx, gz, p.y) : this.g.world.heightAt(gx, gz);
    this.marks.pool.add(markCorners(gx, gy, gz, 0, 1, 0, 1, 1, null, 0, 0, hash(gx, gy, gz) * 6), 0, 1, 0, MARK.SHARDS, 1, 1, 1, 0.9, null, this.g.time);
  }

  // ---------------------------------------------------------------- a melee swing that struck the world
  strike(id, blow, heavy, x, y, z, dx, dy, dz) {
    const g = this.g;
    const mine = id === g.myId;
    const force = blowForce(blow, heavy);
    if (mine) {
      this.mineT = g.time;
      g.camShake = Math.min(1, (g.camShake || 0) + 0.04 + 0.22 * force);
    }
    // a window on the way to it: glass stops nothing, so the swing went through the pane
    const pane = this.paneAt(x - dx * 2.4, y - dy * 2.4, z - dz * 2.4, dx, dy, dz, 2.5);
    if (pane) {
      this.fx.strike(SURF.GLASS, blow, _hit.x, _hit.y, _hit.z, _hit.nx, _hit.ny, _hit.nz, dx, dy, dz, force);
      this.paneHit(pane, markFor(SURF.GLASS, blow), blow === BLOW.SLASH ? 2 : PANE_SHOTS, dx, dy, dz);
    }
    const h = this.resolve(x - dx * 0.5, y - dy * 0.5, z - dz * 0.5, dx, dy, dz, 1.3);
    if (!h) return;
    const r = hash(x, y, z);
    const prop = h.prop;
    const wreck = prop && PROPS[prop.type].salvage ? this.wreckRecord(prop) : null;
    // (a wreck keeps the marks of the blows on its record itself: here only the ones past what it remembers)
    if (!(prop && PROPS[prop.type].salvage && g.staticWorld.lifts.has(prop)) || (wreck && wreck.hits.length >= WRECK_HITS_MAX)) this.mark(h, markFor(h.surf, blow), dx, dy, dz, r, true);
    this.fx.strike(h.surf, blow, h.x, h.y, h.z, h.nx, h.ny, h.nz, dx, dy, dz, force, null);
    this.sound(soundFor(h.surf, blow), h.x, h.y, h.z, 0.55 + 0.6 * force);
    if (!prop || !g.staticWorld.lifts.has(prop)) return;
    if (PROPS[prop.type].salvage) {
      // on its springs: heavier weapons rock it more, a knife barely
      const w = this.wrecks.wreck(prop);
      if (w) w.push(h.x, h.y, h.z, dx, dy, dz, force);
    } else if (LIGHT_PROPS[prop.type]) this.wrecks.push(prop, h.x, h.y, h.z, dx, dy, dz, force);
  }
  wreckRecord(prop) {
    for (const r of this.wrecks.records.values()) if (r.prop === prop) return r;
    return null;
  }

  // ---------------------------------------------------------------- a bullet stopped by the world
  /**
   * One pellet from o along d that no body stopped. t: where the world stops it (-1: nothing within range), col /
   * terrain: what did (raycastWorld's answer). The hole, the kick of dust, the tick of it - and a window it went
   * through on the way.
   */
  shot(weapon, ox, oy, oz, dx, dy, dz, t, col, terrain, range) {
    const g = this.g;
    const end = t >= 0 ? t : Math.min(range, 120);
    const pane = this.paneAt(ox, oy, oz, dx, dy, dz, end);
    if (pane) {
      const px = _hit.x, py = _hit.y, pz = _hit.z;
      this.paneHit(pane, shotMark(SURF.GLASS, weapon, 1, hash(px, py, pz)), shotScale(weapon) >= 2.5 ? PANE_SHOTS : 1, dx, dy, dz);
    }
    if (t < 0) return;
    const h = this.resolve(ox, oy, oz, dx, dy, dz, t, { t, col, terrain });
    if (!h) return;
    const r = hash(h.x, h.y, h.z);
    const cos = Math.abs(dx * h.nx + dy * h.ny + dz * h.nz);
    this.mark(h, shotMark(h.surf, weapon, cos, r), dx, dy, dz, r);
    this.fx.strike(h.surf, BLOW.SHOT, h.x, h.y, h.z, h.nx, h.ny, h.nz, dx, dy, dz, 0.2 * shotScale(weapon));
    // (not every round of a burst is heard landing)
    if (g.time - this.soundT > 0.07) {
      this.soundT = g.time;
      this.sound(soundFor(h.surf, BLOW.SHOT), h.x, h.y, h.z, 0.4);
    }
    const prop = h.prop;
    if (prop && g.staticWorld.lifts.has(prop) && !h.bare) {
      const k = 0.05 * shotScale(weapon);
      if (this.wrecks.get(prop)) this.wrecks.get(prop).push(h.x, h.y, h.z, dx, dy, dz, k);
      else if (LIGHT_PROPS[prop.type]) this.wrecks.push(prop, h.x, h.y, h.z, dx, dy, dz, k * 2);
    }
  }

  // ---------------------------------------------------------------- a blast
  // Scorch and pitting on what stands round it (the ground under it has its own: Effects.explosion), and what is
  // light enough is thrown about on its base.
  blast(x, y, z, radius) {
    const g = this.g;
    const reach = Math.min(8, radius * 0.9);
    let n = 0;
    for (let i = 0; i < 12 && n < 7; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.3;
      const dy = i % 3 === 0 ? 0.35 : i % 3 === 1 ? -0.1 : 0.05;
      const l = Math.hypot(1, dy);
      const dx = Math.cos(a) / l, dz = Math.sin(a) / l;
      raycastWorld(g.world, x, y + 0.2, z, dx, dy / l, dz, reach, _ray);
      if (_ray.t < 0 || _ray.terrain) continue;
      const h = this.resolve(x, y + 0.2, z, dx, dy / l, dz, _ray.t, _ray);
      if (!h || h.bare) continue;
      n++;
      const k = 1 - _ray.t / (reach * 1.3);
      const m = markFor(h.surf, BLOW.BLAST);
      this.mark(h, { cell: m.cell, w: m.w * k, h: m.h * k, along: false }, dx, dy, dz, hash(h.x, h.y, h.z));
      if (h.surf !== SURF.GLASS && h.surf !== SURF.CLOTH) {
        const o = 0.25 * k;
        h.x += h.nz * o;
        h.z -= h.nx * o;
        this.mark(h, PIT_MARK, dx, dy, dz, hash(h.z, h.y, h.x));
      }
    }
    // what is light rocks
    for (const col of g.world.staticGrid.query(x, z, reach, [])) {
      const prop = col.tag && typeof col.tag === 'object' && !col.tag.bare ? col.tag : null;
      if (!prop || !LIGHT_PROPS[prop.type] || !g.staticWorld.lifts.has(prop)) continue;
      const d = Math.hypot(prop.x - x, prop.z - z);
      if (d > reach || d < 0.01) continue;
      this.wrecks.push(prop, prop.x, prop.y + 0.8, prop.z, (prop.x - x) / d, 0.1, (prop.z - z) / d, 1.2 * (1 - d / (reach * 1.2)));
    }
    // (windows in reach go)
    for (const p of this.panes) {
      if (p.out || Math.hypot(p.x - x, p.y - y, p.z - z) > reach * 0.8) continue;
      const d = Math.hypot(p.x - x, p.z - z) || 1;
      _hit.x = p.x;
      _hit.y = p.y;
      _hit.z = p.z;
      this.paneHit(p, markFor(SURF.GLASS, BLOW.BLAST), PANE_SHOTS, (p.x - x) / d, 0, (p.z - z) / d);
    }
  }

  // ---------------------------------------------------------------- wrecks on record
  wreck(flags, qx, qy, qz, left, hits) {
    const col = wreckColAt(this.g.world, qx, qy, qz);
    if (col) this.wrecks.record(col, left, hits, !!(flags & WRECKF.REPLAY), this.g.camera.position);
  }
  wreckAlarm(qx, qy, qz, say, secs) {
    const g = this.g;
    const col = wreckColAt(g.world, qx, qy, qz);
    if (!col) return;
    this.wrecks.alarm(col, say, secs);
    const near = Math.hypot(col.x - g.renderPos.x, col.z - g.renderPos.z) < 45;
    if (say === 2 && near) g.ui.notify('CAR ALARM! Smash its bonnet to kill it', 'danger', 4);
    else if (say === 1 && near && !this.told) {
      this.told = true;
      g.ui.notify('That alarm still has life in it. Another hard hit may set it off: a knife is quiet.', 'toast', 6);
    }
  }
  // the prompt for a wreck whose alarm is going (Game.updateLookTarget), or null. col: what the swing would land on
  alarmPrompt(col) {
    const prop = wreckOf(col);
    return prop && this.wrecks.ringing(prop) ? 'Alarm ringing · hit the bonnet to kill it' : null;
  }

  dispose() {
    this.wrecks.dispose();
    this.marks.dispose();
  }
}
