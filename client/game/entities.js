// Client entity store: decodes into records, keeps per-entity interpolation sample rings, and owns
// the three.js views (zombies, remote survivors, the cat, items, structures, projectiles, crates, areas).
import * as THREE from 'three';
import { ENT, PFLAG, ZSTATUS, dqpos, dqangle16, dqangle8, dqpitch } from '../../shared/protocol.js';
import { ZTYPE, ZANIM, CANIM, ZOMBIE_DEFS, STRUCT, STRUCT_DEFS, PROJ, AREA, SOUND, WEAPONS, ITEM, ITEM_DEFS, structPickRadius } from '../../shared/defs.js';
import { makeBox, COL, canReach } from '../../shared/collision.js';
import { SERVER_TICK_RATE, PICK_RADIUS } from '../../shared/constants.js';
import { createZombie, createSurvivor, setZombieViewer } from '../render/models/characters.js';
import { createCat } from '../render/models/cat.js';
import { createPickup } from '../render/models/pickups.js';
import { createStructure, setStructureDamage } from '../render/models/structures.js';
import { createSupplyCrate, createProjectile } from '../render/models/misc.js';
import { getTexture } from '../render/textures.js';

const RING = 10;
const TAU = Math.PI * 2;
const MAX_GLINTS = 96;
const ITEM_GLINT_RANGE = 13; // a loose item glints inside this distance (m), fading in over the last 3
const ITEM_GLINT_GAIN = 0.9; // ...at up to this brightness by day, against 1 for a container or a car supply
const ITEM_GLINT_SPACING = 0.75; // ...and no closer than this (m) to the next one
const HEAVY_STEP_SHAKE = 14; // a tank's footfall jolts the camera inside this distance (m)

// soft star-shaped sparkle for unsearched containers ("loot glint")
function glintTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,244,210,1)');
  grd.addColorStop(0.18, 'rgba(255,214,140,0.65)');
  grd.addColorStop(0.5, 'rgba(255,190,110,0.12)');
  grd.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[30, 2.4], [2.4, 30]]) {
    const lg = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    lg.addColorStop(0, 'rgba(255,240,200,0.9)');
    lg.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = lg;
    g.fillRect(32 - w, 32 - h, w * 2, h * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

class Samples {
  constructor() {
    this.buf = new Float64Array(RING * 6);
    this.n = 0;
    this.head = 0; // index of oldest
  }
  last() {
    if (!this.n) return -1;
    return (this.head + this.n - 1) % RING;
  }
  push(t, x, y, z, yaw, pitch) {
    const li = this.last();
    if (li >= 0) {
      const lt = this.buf[li * 6];
      if (t <= lt) {
        // same tick: overwrite
        const o = li * 6;
        this.buf[o + 1] = x;
        this.buf[o + 2] = y;
        this.buf[o + 3] = z;
        this.buf[o + 4] = yaw;
        this.buf[o + 5] = pitch;
        return;
      }
      // entity was idle (or LOD-skipped) for a while: insert a hold sample so it doesn't slide
      if (t - lt > 2) {
        const o = li * 6;
        this._raw(t - 2, this.buf[o + 1], this.buf[o + 2], this.buf[o + 3], this.buf[o + 4], this.buf[o + 5]);
      }
    }
    this._raw(t, x, y, z, yaw, pitch);
  }
  _raw(t, x, y, z, yaw, pitch) {
    let idx;
    if (this.n < RING) {
      idx = (this.head + this.n) % RING;
      this.n++;
    } else {
      idx = this.head;
      this.head = (this.head + 1) % RING;
    }
    const o = idx * 6;
    this.buf[o] = t;
    this.buf[o + 1] = x;
    this.buf[o + 2] = y;
    this.buf[o + 3] = z;
    this.buf[o + 4] = yaw;
    this.buf[o + 5] = pitch;
  }
  // writes interpolated state at time t into out {x,y,z,yaw,pitch}
  sample(t, out) {
    const b = this.buf;
    if (!this.n) return out;
    let prev = -1;
    for (let k = 0; k < this.n; k++) {
      const i = (this.head + k) % RING;
      if (b[i * 6] <= t) prev = i;
      else {
        if (prev < 0) {
          prev = i;
          break;
        }
        const p = prev * 6;
        const q = i * 6;
        const f = (t - b[p]) / Math.max(1e-6, b[q] - b[p]);
        out.x = b[p + 1] + (b[q + 1] - b[p + 1]) * f;
        out.y = b[p + 2] + (b[q + 2] - b[p + 2]) * f;
        out.z = b[p + 3] + (b[q + 3] - b[p + 3]) * f;
        out.yaw = lerpAngle(b[p + 4], b[q + 4], f);
        out.pitch = b[p + 5] + (b[q + 5] - b[p + 5]) * f;
        return out;
      }
    }
    const p = (prev < 0 ? this.last() : prev) * 6;
    out.x = b[p + 1];
    out.y = b[p + 2];
    out.z = b[p + 3];
    out.yaw = b[p + 4];
    out.pitch = b[p + 5];
    return out;
  }
  // Like sample(), but the position follows a cubic Hermite curve through the samples (Catmull-Rom
  // tangents, clamped per axis so it never overshoots a sample), so velocity doesn't kink at every
  // tick. Also writes that velocity (per tick) to out.vx/vy/vz. Past the newest sample it coasts along
  // the last segment for up to `coast` ticks (a late packet), then holds there.
  sampleSmooth(t, out, coast) {
    const b = this.buf;
    const n = this.n;
    out.vx = out.vy = out.vz = 0;
    if (!n) return out;
    let k = -1;
    for (let j = 0; j < n; j++) {
      if (b[((this.head + j) % RING) * 6] <= t) k = j;
      else break;
    }
    if (k < 0 || k === n - 1) {
      const p = ((this.head + Math.max(k, 0)) % RING) * 6;
      out.x = b[p + 1];
      out.y = b[p + 2];
      out.z = b[p + 3];
      out.yaw = b[p + 4];
      out.pitch = b[p + 5];
      if (k > 0 && coast > 0) {
        const q = ((this.head + k - 1) % RING) * 6;
        const span = b[p] - b[q];
        if (span <= 2) {
          const dt = Math.min(t - b[p], coast);
          const vx = (b[p + 1] - b[q + 1]) / span;
          const vy = (b[p + 2] - b[q + 2]) / span;
          const vz = (b[p + 3] - b[q + 3]) / span;
          out.x += vx * dt;
          out.y += vy * dt;
          out.z += vz * dt;
          if (t - b[p] < coast) {
            out.vx = vx;
            out.vy = vy;
            out.vz = vz;
          }
        }
      }
      return out;
    }
    const p = ((this.head + k) % RING) * 6;
    const q = ((this.head + k + 1) % RING) * 6;
    const pp = k > 0 ? ((this.head + k - 1) % RING) * 6 : -1;
    const qq = k + 2 < n ? ((this.head + k + 2) % RING) * 6 : -1;
    const t0 = b[p];
    const h = Math.max(1e-6, b[q] - t0);
    const s = (t - t0) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = 3 * s2 - 2 * s3;
    const h11 = s3 - s2;
    for (let a = 1; a <= 3; a++) {
      const P0 = b[p + a];
      const P1 = b[q + a];
      const d = (P1 - P0) / h;
      let m0 = d;
      let m1 = d;
      if (Math.abs(d) < 1e-7) m0 = m1 = 0;
      else {
        if (pp >= 0) m0 = (P1 - b[pp + a]) / (b[q] - b[pp]);
        if (qq >= 0) m1 = (b[qq + a] - P0) / (b[qq] - t0);
        m0 = d > 0 ? clampRange(m0, 0, 3 * d) : clampRange(m0, 3 * d, 0);
        m1 = d > 0 ? clampRange(m1, 0, 3 * d) : clampRange(m1, 3 * d, 0);
      }
      const v = h00 * P0 + h10 * h * m0 + h01 * P1 + h11 * h * m1;
      const dv = ((6 * s2 - 6 * s) * (P0 - P1)) / h + (3 * s2 - 4 * s + 1) * m0 + (3 * s2 - 2 * s) * m1;
      if (a === 1) {
        out.x = v;
        out.vx = dv;
      } else if (a === 2) {
        out.y = v;
        out.vy = dv;
      } else {
        out.z = v;
        out.vz = dv;
      }
    }
    out.yaw = lerpAngle(b[p + 4], b[q + 4], s);
    out.pitch = b[p + 5] + (b[q + 5] - b[p + 5]) * s;
    return out;
  }
  lastTick() {
    const li = this.last();
    return li < 0 ? -Infinity : this.buf[li * 6];
  }
}

function clampRange(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sph = new THREE.Sphere();
const _up = new THREE.Vector3(0, 1, 0);

function setShadowFlags(obj, cast, receive) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = cast;
    o.receiveShadow = receive;
  });
}

export class Entities {
  constructor(game) {
    this.g = game;
    this.ents = new Map();
    this.charShadows = !!game.renderer?.q?.charShadows;
    this.corpses = [];
    this.zombieCount = 0;
    this.store = {
      ents: this.ents,
      onCreate: (e, t) => this.onCreate(e, t),
      onRemove: (e, t) => this.onRemove(e, t),
      onUpdate: (e, m, t) => this.onUpdate(e, m, t),
    };
    // flashlight cone for remote players
    const coneGeo = new THREE.ConeGeometry(4.2, 16, 20, 1, true);
    coneGeo.translate(0, -8, 0);
    coneGeo.rotateX(-Math.PI / 2);
    let coneTex = null;
    try {
      coneTex = getTexture('fx_cone');
    } catch {
      coneTex = null;
    }
    this.coneGeo = coneGeo;
    this.coneMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, map: coneTex, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
    // rope / tongue
    this.ropeGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true);
    this.ropeGeo.translate(0, 0.5, 0);
    this.ropeGeo.rotateX(Math.PI / 2);
    this.ropeMat = new THREE.MeshLambertMaterial({ color: 0x6b2a2a });
    this.ropes = [];
    this.remoteFlash = [];
    this.fireSources = [];
    this.tmp = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.bossEnt = null;
    // loot glints (one Points draw call for every unsearched container and loose item nearby)
    const gg = new THREE.BufferGeometry();
    this.glintPos = new Float32Array(MAX_GLINTS * 3);
    this.glintSize = new Float32Array(MAX_GLINTS);
    this.glintGain = new Float32Array(MAX_GLINTS); // brightness: the sprite is additive, so this is also how it fades
    gg.setAttribute('position', new THREE.BufferAttribute(this.glintPos, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('aSize', new THREE.BufferAttribute(this.glintSize, 1).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('aGain', new THREE.BufferAttribute(this.glintGain, 1).setUsage(THREE.DynamicDrawUsage));
    gg.setDrawRange(0, 0);
    const gm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { map: { value: glintTexture() }, uScale: { value: 400 } },
      vertexShader: 'attribute float aSize; attribute float aGain; uniform float uScale; varying float vGain; void main(){ vGain = aGain; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying float vGain; void main(){ vec4 c = texture2D(map, gl_PointCoord); gl_FragColor = vec4(c.rgb * c.a * vGain, c.a); }',
    });
    this.glints = new THREE.Points(gg, gm);
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 7;
    this.caches = new Set();
    this.loose = new Set(); // every other item on the ground: a small glint up close (see update)
    this.stations = []; // built campfires / workbenches (crafting)
  }

  get scene() {
    return this.g.renderer.scene;
  }

  clear() {
    for (const e of this.ents.values()) this.destroyView(e, true);
    this.ents.clear();
    this.caches.clear();
    this.loose.clear();
    this.stations.length = 0;
    for (const c of this.corpses) this.disposeZombieView(c.view);
    this.corpses.length = 0;
    for (const r of this.ropes) this.scene.remove(r);
    this.ropes.length = 0;
  }

  pushSample(e, t) {
    const q = e.q;
    let yaw = 0;
    let pitch = 0;
    if (e.kind === ENT.PLAYER) {
      yaw = dqangle16(q[3]);
      pitch = dqpitch(q[4]);
    } else if (e.kind === ENT.ZOMBIE || e.kind === ENT.CAT) yaw = dqangle8(q[3]);
    e.samples.push(t, dqpos(q[0]), dqpos(q[1]), dqpos(q[2]), yaw, pitch);
  }

  // ---------------------------------------------------------------- lifecycle
  setCharShadows(on) {
    if (on === this.charShadows) return;
    this.charShadows = on;
    for (const e of this.ents.values()) if (e.view && (e.kind === ENT.ZOMBIE || e.kind === ENT.PLAYER)) setShadowFlags(e.view.object, on, false);
  }

  onCreate(e, t) {
    e.samples = new Samples();
    this.pushSample(e, t);
    e.rx = dqpos(e.q[0]);
    e.ry = dqpos(e.q[1]);
    e.rz = dqpos(e.q[2]);
    e.ryaw = e.samples.sample(t, this.tmp).yaw; // spawn facing (zombies then ease toward new yaws)
    e.speed = 0;
    const g = this.g;
    if (!this.glints.parent) this.scene.add(this.glints);
    try {
      switch (e.kind) {
        case ENT.CACHE:
          this.caches.add(e);
          break;
        case ENT.ZOMBIE: {
          e.vx = e.vy = e.vz = 0; // rendered velocity (m/s) and fading correction offset
          e.ex = e.ey = e.ez = 0;
          e.sx = e.rx; // where its path was sampled last frame (the drawn position is this + the offset)
          e.sy = e.ry;
          e.sz = e.rz;
          const v = createZombie(e.ztype, e.variant * 7 + e.id);
          e.view = v;
          setShadowFlags(v.object, this.charShadows, false);
          this.scene.add(v.object);
          e.growlT = e.ztype === ZTYPE.SHADE ? 0.5 + Math.random() * 2 : 2 + Math.random() * 8;
          e.voice = 0.92 + ((((e.id * 2654435761) >>> 0) % 997) / 997) * 0.2; // its own throat: everything it utters is pitched by this
          e.stepT = Math.random();
          e.lastHp = e.q[5];
          e.dead = e.q[4] === ZANIM.DEAD;
          if (ZOMBIE_DEFS[e.ztype].boss) this.bossEnt = e;
          if (e.ztype === ZTYPE.BOSS_ABOMINATION || e.ztype === ZTYPE.BOSS_HIVEQUEEN) e.loop = g.audio.createLoop?.('boss_breath', e.rx, e.ry + 2, e.rz);
          // the wet, rattling breath of the dead: only the nearest few are ever heard (the audio engine caps the loop)
          else if (!e.dead && !ZOMBIE_DEFS[e.ztype].flying && e.ztype !== ZTYPE.DOG && e.ztype !== ZTYPE.SHADE) e.loop = g.audio.createLoop?.('zombie_idle', e.rx, e.ry + 1.5, e.rz);
          this.zombieCount++;
          break;
        }
        case ENT.PLAYER: {
          const v = createSurvivor(e.id * 31 + 7);
          e.view = v;
          setShadowFlags(v.object, this.charShadows, false);
          this.scene.add(v.object);
          e.weapon = -1;
          e.zombieForm = null;
          e.fireCount = e.q[8];
          const cone = new THREE.Mesh(this.coneGeo, this.coneMat);
          cone.visible = false;
          cone.renderOrder = 6;
          this.scene.add(cone);
          e.cone = cone;
          e.stepT = 0;
          break;
        }
        case ENT.CAT: {
          const v = createCat(e.variant, e.id);
          e.view = v;
          this.scene.add(v.object);
          e.meowT = 4 + Math.random() * 10;
          break;
        }
        case ENT.ITEM: {
          const cat = ITEM_DEFS[e.item]?.cat;
          if (cat === 'part' || cat === 'schem') this.caches.add(e); // car supplies & schematics glint from afar
          else this.loose.add(e); // a dropped gun, a death pile, zombie loot: lost in the grass without one
          const v = createPickup(e.item);
          v.position.set(e.rx, e.ry, e.rz);
          v.rotation.y = ((e.id * 2654435761) % 1000) / 159;
          this.scene.add(v);
          e.obj = v;
          break;
        }
        case ENT.STRUCTURE: {
          const def = STRUCT_DEFS[e.stype];
          const yaw = (e.rot8 / 256) * TAU;
          const v = createStructure(e.stype);
          v.position.set(e.rx, e.ry, e.rz);
          v.rotation.y = yaw;
          setShadowFlags(v, true, true);
          this.scene.add(v);
          e.obj = v;
          e.hpFrac = e.q[3] / 255;
          setStructureDamage(v, e.hpFrac);
          let flags = COL.STRUCT;
          if (!def.block) flags |= COL.NOBLOCK;
          if (def.humanPass) flags |= COL.HUMANPASS;
          e.col = makeBox(e.rx, e.rz, e.ry - 0.3, e.ry + def.sy, def.sx, def.sz, yaw, flags, e.id);
          g.world.structGrid.add(e.col);
          if (e.stype === STRUCT.TORCH || e.stype === STRUCT.CAMPFIRE) {
            const camp = e.stype === STRUCT.CAMPFIRE;
            const a = v.userData.flameAnchor;
            if (a) {
              v.updateMatrixWorld(true);
              a.getWorldPosition(_v);
            } else _v.set(e.rx, e.ry + (camp ? 0.15 : 1.7), e.rz);
            e.emitter = g.effects.createEmitter(camp ? 'campfire' : 'torch', _v.x, _v.y, _v.z, { intensity: 1 });
            e.fire = camp ? { x: _v.x, y: _v.y, z: _v.z, intensity: 1, big: true } : { x: _v.x, y: _v.y - 1.2, z: _v.z, intensity: 0.8 };
            e.loop = g.audio.createLoop?.(camp ? 'campfire' : 'torch', _v.x, _v.y + 0.3, _v.z);
            this.applyTorchState(e);
          }
          if (def.station) this.stations.push(e);
          break;
        }
        case ENT.PROJECTILE: {
          if (e.ptype !== PROJ.ROPE) {
            const v = createProjectile(e.ptype);
            v.position.set(e.rx, e.ry, e.rz);
            this.scene.add(v);
            e.obj = v;
            if (e.ptype === PROJ.MOLOTOV) e.emitter = g.effects.createEmitter('torch', e.rx, e.ry, e.rz);
            if (e.ptype === PROJ.FLARE) {
              e.emitter = g.effects.createEmitter('flare', e.rx, e.ry, e.rz);
              e.fire = { x: e.rx, y: e.ry, z: e.rz, intensity: 1.25, color: 0xff3d22 };
              e.loop = g.audio.createLoop?.('torch', e.rx, e.ry, e.rz);
            }
          }
          break;
        }
        case ENT.CRATE: {
          const v = createSupplyCrate();
          v.position.set(e.rx, e.ry, e.rz);
          this.scene.add(v);
          e.obj = v;
          e.state = -1;
          this.applyCrateState(e);
          break;
        }
        case ENT.AREA: {
          if (e.atype === AREA.FIRE) {
            e.emitter = g.effects.createEmitter('fire', e.rx, e.ry, e.rz, { radius: e.radius });
            e.fire = { x: e.rx, y: e.ry, z: e.rz, intensity: 1.6 };
            e.loop = g.audio.createLoop?.('fire', e.rx, e.ry + 0.5, e.rz);
          } else {
            e.emitter = g.effects.createEmitter('acid', e.rx, e.ry, e.rz, { radius: e.radius });
            e.loop = g.audio.createLoop?.('acid', e.rx, e.ry + 0.2, e.rz);
          }
          break;
        }
      }
    } catch (err) {
      console.error('entity view failed', e.kind, err);
    }
    this.onUpdate(e, 0xff, t, true);
  }

  onUpdate(e, mask, t, initial = false) {
    const g = this.g;
    switch (e.kind) {
      case ENT.ZOMBIE:
        if (!initial && mask & 0b11) this.pushSample(e, t);
        if (mask & 0b1000) {
          if (e.q[5] < e.lastHp) {
            e.view?.flash(1);
            e.view?.hurt();
            e.hurtT = 0.2;
          }
          e.lastHp = e.q[5];
        }
        if (mask & 0b100) {
          const anim = e.q[4];
          if (anim === ZANIM.DEAD && !e.dead) e.dead = true;
          if (anim === ZANIM.SPECIAL && !initial) this.zombieSpecialSound(e);
        }
        break;
      case ENT.PLAYER:
        if (!initial && mask & 0b11) this.pushSample(e, t);
        if (mask & 0b100000 && !initial) {
          // fireCount changed -> third person anim
          if (e.q[8] !== e.fireCount) {
            e.fireCount = e.q[8];
            const w = e.q[6];
            const def = WEAPONS[w];
            if (e.q[5] & PFLAG.ZOMBIE) e.view?.melee();
            else if (def && def.melee) e.view?.melee();
            else if (w === ITEM.MOLOTOV || w === ITEM.PIPEBOMB) e.view?.throwAnim();
            else e.view?.fire();
          }
        }
        break;
      case ENT.CAT:
        if (!initial && mask & 0b11) this.pushSample(e, t);
        break;
      case ENT.ITEM:
        if (!initial && mask & 1) {
          this.pushSample(e, t);
          e.obj?.position.set(dqpos(e.q[0]), dqpos(e.q[1]), dqpos(e.q[2]));
        }
        break;
      case ENT.STRUCTURE:
        if (mask & 0b10 && e.obj) {
          const f = e.q[3] / 255;
          if (!initial && f < e.hpFrac - 0.001) e.shakeT = 0.25;
          e.hpFrac = f;
          setStructureDamage(e.obj, f);
        }
        if (mask & 0b100 && (e.stype === STRUCT.TORCH || e.stype === STRUCT.CAMPFIRE)) this.applyTorchState(e);
        break;
      case ENT.PROJECTILE:
        if (!initial && mask & 1) this.pushSample(e, t);
        break;
      case ENT.CRATE:
        if (!initial && mask & 1) this.pushSample(e, t);
        if (mask & 0b10) this.applyCrateState(e);
        break;
    }
  }

  // stations the local player can craft at: { fire, bench }
  stationsNear(x, z, r) {
    const out = { fire: false, bench: false };
    for (const e of this.stations) {
      if (Math.hypot(e.rx - x, e.rz - z) > r) continue;
      const def = STRUCT_DEFS[e.stype];
      if (def.station === 'fire' && e.q[4] === 1) out.fire = true;
      if (def.station === 'bench') out.bench = true;
    }
    return out;
  }

  applyTorchState(e) {
    const lit = e.q[4] === 1;
    if (e.emitter) e.emitter.active = lit;
    if (e.fire) e.fire.intensity = lit ? (e.stype === STRUCT.CAMPFIRE ? 1 : 0.85) : 0;
    e.loop?.setVolume?.(lit ? 1 : 0);
    e.obj?.userData.setLit?.(lit);
  }

  // crate states: 3 tumbling off the plane's ramp, 0 under the canopy, 1 landed, 2 opened
  applyCrateState(e) {
    const st = e.q[3];
    if (st === e.state) return;
    const prev = e.state;
    e.state = st;
    const para = e.obj?.userData.parachute;
    if (para) {
      para.visible = st === 0;
      if (st === 0 && prev === 3) e.chuteT = 0; // the canopy blooms open
    }
    if (st === 1 && !e.emitter) e.emitter = this.g.effects.createEmitter('smoke_red', e.rx, e.ry, e.rz);
    if (st === 2 && e.emitter) {
      this.g.effects.removeEmitter(e.emitter);
      e.emitter = null;
    }
  }

  zombieSpecialSound(e) {
    // server sends the important ones; nothing extra needed
  }

  onRemove(e) {
    if (e.kind === ENT.ZOMBIE && e.dead && e.view) {
      // keep the corpse around for a while
      this.corpses.push({ view: e.view, t: 0, x: e.rx, y: e.ry, z: e.rz, yaw: e.ryaw, burning: e.burning });
      e.view = null;
      this.zombieCount--;
      if (e.loop) e.loop.stop();
      if (e.burnLoop) e.burnLoop.stop();
      if (this.bossEnt === e) this.bossEnt = null;
      return;
    }
    this.destroyView(e, false);
  }

  disposeZombieView(v) {
    if (!v) return;
    this.scene.remove(v.object);
    v.dispose?.();
  }

  destroyView(e) {
    const g = this.g;
    if (e.kind === ENT.CACHE || e.kind === ENT.ITEM) this.caches.delete(e);
    if (e.kind === ENT.ITEM) this.loose.delete(e);
    if (e.kind === ENT.STRUCTURE) {
      const i = this.stations.indexOf(e);
      if (i >= 0) this.stations.splice(i, 1);
    }
    if (e.kind === ENT.ZOMBIE) {
      this.zombieCount--;
      this.disposeZombieView(e.view);
      if (this.bossEnt === e) this.bossEnt = null;
    } else if (e.kind === ENT.PLAYER || e.kind === ENT.CAT) {
      if (e.view) {
        this.scene.remove(e.view.object);
        e.view.dispose?.();
      }
      if (e.cone) this.scene.remove(e.cone);
    } else if (e.obj) {
      this.scene.remove(e.obj);
    }
    if (e.col) g.world.structGrid.remove(e.col);
    if (e.emitter) g.effects.removeEmitter(e.emitter);
    if (e.loop) e.loop.stop();
    if (e.burnLoop) e.burnLoop.stop();
    e.view = null;
    e.obj = null;
  }

  // a zombie that is alight (ZSTATUS.BURNING): flames up its body, its fire lights the dark around it, it crackles
  updateBurning(e, dt, distC) {
    if (e.dead || !(e.q[8] & ZSTATUS.BURNING)) {
      if (e.burnLoop) {
        e.burnLoop.stop();
        e.burnLoop = null;
      }
      return;
    }
    const g = this.g;
    const def = ZOMBIE_DEFS[e.ztype];
    if (distC < 70 * 70 && Math.random() < dt * 16) g.effects.burnPuff(e.rx, e.ry, e.rz, def.height * 0.9, def.radius);
    const f = e.burnLight || (e.burnLight = { x: 0, y: 0, z: 0, intensity: 0.4 });
    f.x = e.rx;
    f.y = e.ry + def.height - 0.6; // (the light pool lifts a fire's light 1.2 m: this one sits over its head)
    f.z = e.rz;
    this.fireSources.push(f);
    if (!e.burnLoop) e.burnLoop = g.audio.createLoop?.('burning', e.rx, e.ry + 1, e.rz) || null;
    e.burnLoop?.setPosition(e.rx, e.ry + 1, e.rz);
  }

  // ---------------------------------------------------------------- events from server
  zombieDie(id, yaw, flags) {
    const e = this.ents.get(id);
    if (!e) return;
    e.dead = true;
    if (e.loop) {
      e.loop.stop(); // its breathing stops with it
      e.loop = null;
    }
    const g = this.g;
    const def = ZOMBIE_DEFS[e.ztype];
    const green = e.ztype === ZTYPE.SPITTER || e.ztype === ZTYPE.BOOMER || e.ztype === ZTYPE.BOSS_HIVEQUEEN;
    if (flags & 8) {
      // overkill: the body is blown apart along the blow (yaw), nothing is left to fall over
      const biped = !def.flying && !def.headFwd;
      g.effects.gibBody(e.rx, e.ry, e.rz, def.height, def.radius, -Math.sin(yaw), -Math.cos(yaw), { green, head: biped && !(flags & 1), limbs: !def.flying, fur: !biped });
      g.audio.play(SOUND.HEADSHOT, { x: e.rx, y: e.ry + def.height * 0.5, z: e.rz, volume: 1.3, rate: 0.8 });
      g.audio.play(SOUND.MELEE_HIT, { x: e.rx, y: e.ry + def.height * 0.5, z: e.rz, rate: 0.7 });
      this.disposeZombieView(e.view);
      e.view = null;
      return;
    }
    if (flags & 1) {
      e.view?.setHeadless(true);
      const f = def.headFwd || 0; // quadrupeds carry the head ahead of the body
      g.effects.gib(e.rx - Math.sin(e.ryaw) * f, e.ry + def.headY, e.rz - Math.cos(e.ryaw) * f, green);
    }
    if (flags & 2) e.burning = 3;
    // the body hits the ground a moment after the kill: a thud, heavier for the big ones, a light flop for a dog
    if (!def.flying) {
      const big = def.height > 2.5;
      g.audio.play(SOUND.BODY_FALL, { x: e.rx, y: e.ry + 0.2, z: e.rz, delay: big ? 0.8 : 0.5, volume: big ? 1.5 : def.headFwd ? 0.55 : 1, rate: big ? 0.72 : def.headFwd ? 1.25 : 1 });
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, renderTick, time, camPos) {
    const g = this.g;
    const tmp = this.tmp;
    this.remoteFlash.length = 0;
    this.fireSources.length = 0;
    const flashCands = [];
    const cam = g.camera;
    setZombieViewer(cam.position.x, cam.position.y, cam.position.z);
    // this frame's view frustum: a zombie turning into view is posed now, not one frame late (with a stale pose)
    cam.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const e of this.ents.values()) {
      switch (e.kind) {
        case ENT.ZOMBIE: {
          // coast through a late packet only if this zombie was still moving in the newest snapshot
          // (one that is missing from a snapshot that did arrive simply didn't move)
          e.samples.sampleSmooth(renderTick, tmp, e.samples.lastTick() >= g.latestTick - 1 ? 2 : 0);
          const sp = Math.hypot(tmp.vx, tmp.vz) * SERVER_TICK_RATE;
          e.speed += (Math.min(sp, 14) - e.speed) * Math.min(1, dt * 6);
          // when a late packet makes the sampled path jump, carry the jump as an offset that fades out: the body
          // glides onto the corrected path instead of popping (a real teleport still snaps). The jump is measured
          // on the path itself, not on the drawn position: there the offset's own fading reads as a jump and gets
          // put straight back, and the body stays beside its hitbox for good
          const fade = Math.exp(-dt * 8);
          e.ex *= fade;
          e.ey *= fade;
          e.ez *= fade;
          const jx = tmp.x - (e.sx + e.vx * dt);
          const jy = tmp.y - (e.sy + e.vy * dt);
          const jz = tmp.z - (e.sz + e.vz * dt);
          e.sx = tmp.x;
          e.sy = tmp.y;
          e.sz = tmp.z;
          const jump = Math.hypot(jx, jy, jz);
          if (jump > 3) e.ex = e.ey = e.ez = 0;
          else if (jump > 0.02 + 40 * dt * dt) {
            e.ex -= jx;
            e.ey -= jy;
            e.ez -= jz;
          }
          e.vx = tmp.vx * SERVER_TICK_RATE;
          e.vy = tmp.vy * SERVER_TICK_RATE;
          e.vz = tmp.vz * SERVER_TICK_RATE;
          e.rx = tmp.x + e.ex;
          e.ry = tmp.y + e.ey;
          e.rz = tmp.z + e.ez;
          // ease the facing toward the (8-bit, 20 Hz) server yaw so turns don't step
          e.ryaw += wrapAngle(tmp.yaw - e.ryaw) * Math.min(1, dt * 12);
          const v = e.view;
          if (!v) break;
          const distC = (e.rx - camPos.x) ** 2 + (e.rz - camPos.z) ** 2;
          v.object.position.set(e.rx, e.ry, e.rz);
          v.object.rotation.y = e.ryaw;
          // skip animation work for far zombies on alternate frames
          if (distC < 60 * 60 || ((g.frame + e.id) & 1) === 0) {
            const def = ZOMBIE_DEFS[e.ztype];
            _sph.center.set(e.rx, e.ry + def.height * 0.5, e.rz);
            _sph.radius = def.height * 0.75 + 0.4;
            v.update(distC < 60 * 60 ? dt : dt * 2, e.q[4], e.speed, time, _frustum.intersectsSphere(_sph));
          }
          if (e.burning > 0) {
            e.burning -= dt;
            if (Math.random() < dt * 20) g.effects.burnPuff(e.rx, e.ry, e.rz);
          }
          this.updateBurning(e, dt, distC);
          if (e.loop) {
            if (e.dead) {
              e.loop.stop();
              e.loop = null;
            } else e.loop.setPosition(e.rx, e.ry + 2, e.rz);
          }
          // ambient vocalizations + footsteps (client-side, no bandwidth)
          if (!e.dead && distC < 45 * 45) {
            const shade = e.ztype === ZTYPE.SHADE;
            if (shade) {
              // the sounds to listen for: light catching it, and light letting it go. Pinned, it is silent.
              const frozen = e.q[4] === ZANIM.FROZEN;
              if (frozen !== e.frozen) {
                if (e.frozen !== undefined && time - (e.thawT || 0) > 0.5) {
                  e.thawT = time;
                  g.audio.play(frozen ? SOUND.SHADE_FREEZE : SOUND.SHADE_SHRIEK, { x: e.rx, y: e.ry + 1.6, z: e.rz });
                  if (!frozen) v.vocalize?.(1);
                }
                e.frozen = frozen;
              }
              if (frozen) e.growlT = Math.max(e.growlT, 1.5);
            }
            e.growlT -= dt;
            if (e.growlT <= 0) {
              e.growlT = shade ? 1.8 + Math.random() * 2.2 : 4 + Math.random() * 9;
              const dog = e.ztype === ZTYPE.DOG;
              const snd = shade ? SOUND.SHADE_WHISPER : dog ? (e.speed > 3 && Math.random() < 0.6 ? SOUND.DOG_BARK : SOUND.DOG_SNARL) : e.ztype === ZTYPE.BAT ? SOUND.BAT_SCREECH : e.ztype === ZTYPE.BOOMER ? SOUND.BOOMER_GURGLE : e.ztype === ZTYPE.TANK ? SOUND.TANK_ROAR : e.ztype === ZTYPE.RUNNER && e.speed > 3 ? SOUND.RUNNER_SCREAM : ZOMBIE_DEFS[e.ztype].boss ? SOUND.BOSS_ROAR : e.speed < 1.2 && distC > 14 * 14 && e.q[4] !== ZANIM.ATTACK ? SOUND.ZOMBIE_MOAN : SOUND.ZOMBIE_GROWL; // shambling about somewhere off in the trees, it moans; on the hunt or on top of you, it growls
              if (e.ztype === ZTYPE.TANK && Math.random() < 0.6) e.growlT += 4;
              if (dog) e.growlT *= 0.6;
              g.audio.play(snd, { x: e.rx, y: e.ry + (dog ? 0.6 : 1.5), z: e.rz, volume: e.ztype === ZTYPE.BAT ? 0.6 : 0.9, rate: e.voice });
              v.vocalize?.(snd === SOUND.RUNNER_SCREAM || snd === SOUND.DOG_BARK ? 1 : snd === SOUND.TANK_ROAR || snd === SOUND.BOSS_ROAR ? 2 : 0);
            }
            // a tank's (or a boss's) footfalls thump: they carry as far as its voice, and close by they shake the ground
            const heavy = e.ztype === ZTYPE.TANK || !!ZOMBIE_DEFS[e.ztype].boss;
            if (e.speed > 0.4 && !ZOMBIE_DEFS[e.ztype].flying && (heavy || distC < 22 * 22)) {
              // a visible planted-foot gait sounds its steps as the feet land; otherwise keep a cadence timer
              const dog = e.ztype === ZTYPE.DOG;
              const stepVol = heavy ? 1 : dog ? 0.25 : shade ? 0.2 : 0.45;
              const falls = v.footfalls ? v.footfalls() : -1;
              let stepped = false;
              if (falls >= 0) {
                stepped = e.falls !== undefined && falls !== e.falls;
                e.falls = falls;
                e.stepT = 1;
              } else {
                e.falls = undefined;
                e.stepT -= dt * (0.8 + e.speed * 0.45) * (dog ? 1.8 : 1); // four paws: a quick, light patter
                if (e.stepT <= 0) {
                  e.stepT = 1;
                  stepped = true;
                }
              }
              if (stepped) {
                g.audio.footstep(g.surfaceAt(e.rx, e.ry, e.rz), e.rx, e.ry, e.rz, stepVol, { heavy });
                if (heavy && distC < HEAVY_STEP_SHAKE * HEAVY_STEP_SHAKE) g.camShake = Math.min(1, (g.camShake || 0) + 0.3 * (1 - Math.sqrt(distC) / HEAVY_STEP_SHAKE));
              }
            }
          }
          // roper rope
          if (e.ztype === ZTYPE.ROPER && e.q[6]) this.drawRope(e, e.q[6]);
          break;
        }
        case ENT.PLAYER: {
          e.samples.sample(renderTick, tmp);
          const dx = tmp.x - e.rx;
          const dy = tmp.y - e.ry;
          const dz = tmp.z - e.rz;
          const sp = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
          e.speed += (Math.min(sp, 14) - e.speed) * Math.min(1, dt * 10);
          e.vy = dy / Math.max(dt, 1e-3);
          e.rx = tmp.x;
          e.ry = tmp.y;
          e.rz = tmp.z;
          e.ryaw = tmp.yaw;
          e.rpitch = tmp.pitch;
          const v = e.view;
          if (!v) break;
          const flags = e.q[5];
          const zombie = !!(flags & PFLAG.ZOMBIE);
          const dead = !!(flags & PFLAG.DEAD);
          if (zombie !== e.zombieForm) {
            e.zombieForm = zombie;
            v.setZombie(zombie);
            e.weapon = -1;
          }
          const weapon = zombie ? 0 : e.q[6];
          if (weapon !== e.weapon) {
            e.weapon = weapon;
            v.setWeapon(weapon);
          }
          const downed = !!(flags & PFLAG.DOWNED) && !dead;
          e.downed = downed;
          e.beingRevived = !!(flags & PFLAG.REVIVING);
          e.downK = (e.downK || 0) + ((downed ? 1 : 0) - (e.downK || 0)) * Math.min(1, dt * 6);
          v.object.position.set(e.rx, e.ry + e.downK * 0.18, e.rz);
          v.object.rotation.order = 'YXZ';
          v.object.rotation.y = e.ryaw;
          v.object.rotation.x = -1.3 * e.downK;
          v.update(dt, { speed: downed ? e.speed * 0.4 : e.speed, sprint: !!(flags & PFLAG.SPRINT), crouch: !!(flags & PFLAG.CROUCH) || downed, pitch: downed ? 0.9 : e.rpitch, onGround: Math.abs(e.vy) < 1.5, reloading: !!(flags & PFLAG.RELOADING), dead, time });
          v.object.visible = !(dead && zombie);
          // flashlight
          const flashOn = !!(flags & PFLAG.FLASHLIGHT) && !dead;
          e.cone.visible = flashOn;
          if (flashOn) {
            const a = v.flashlightAnchor;
            if (a) a.getWorldPosition(_v);
            else _v.set(e.rx, e.ry + 1.4, e.rz);
            const cp = Math.cos(e.rpitch);
            _v2.set(-Math.sin(e.ryaw) * cp, Math.sin(e.rpitch), -Math.cos(e.ryaw) * cp);
            e.cone.position.copy(_v);
            e.cone.lookAt(_v.x + _v2.x, _v.y + _v2.y, _v.z + _v2.z);
            flashCands.push({ pos: _v.clone(), dir: _v2.clone(), d: (e.rx - camPos.x) ** 2 + (e.rz - camPos.z) ** 2 });
          }
          // footsteps
          if (!dead && e.speed > 1 && Math.abs(e.vy) < 1.5) {
            e.stepT -= dt * (e.speed * 0.55);
            if (e.stepT <= 0) {
              e.stepT = 1;
              g.audio.footstep(g.surfaceAt(e.rx, e.ry, e.rz), e.rx, e.ry, e.rz, flags & PFLAG.CROUCH ? 0.3 : flags & PFLAG.SPRINT ? 1 : 0.65);
            }
          }
          g.voice?.setPeerPosition(e.id, e.rx, e.ry + 1.6, e.rz, zombie);
          break;
        }
        case ENT.CAT: {
          e.samples.sample(renderTick, tmp);
          const sp = Math.hypot(tmp.x - e.rx, tmp.z - e.rz) / Math.max(dt, 1e-3);
          e.speed += (Math.min(sp, 8) - e.speed) * Math.min(1, dt * 8);
          e.rx = tmp.x;
          e.ry = tmp.y;
          e.rz = tmp.z;
          e.ryaw = tmp.yaw;
          const v = e.view;
          if (!v) break;
          v.object.position.set(e.rx, e.ry, e.rz);
          v.object.rotation.y = e.ryaw;
          const distC = (e.rx - camPos.x) ** 2 + (e.rz - camPos.z) ** 2;
          if (distC < 60 * 60 || ((g.frame + e.id) & 1) === 0) v.update(distC < 60 * 60 ? dt : dt * 2, e.q[4], e.speed, time);
          // meows now and then when someone is close enough to hear (client-side, no bandwidth)
          e.meowT -= dt;
          if (e.meowT <= 0) {
            e.meowT = 9 + Math.random() * 16;
            if (distC < 20 * 20 && e.q[4] !== CANIM.RUN) g.audio.play(SOUND.CAT_MEOW, { x: e.rx, y: e.ry + 0.3, z: e.rz });
          }
          break;
        }
        case ENT.PROJECTILE: {
          e.samples.sample(renderTick, tmp);
          const moved = Math.hypot(tmp.x - e.rx, tmp.y - e.ry, tmp.z - e.rz) > 1e-3;
          e.rx = tmp.x;
          e.ry = tmp.y;
          e.rz = tmp.z;
          if (e.obj) {
            e.obj.position.set(e.rx, e.ry, e.rz);
            if (moved) {
              e.obj.rotation.x += dt * 9;
              e.obj.rotation.z += dt * 5;
            } else if (e.ptype === PROJ.FLARE) {
              e.obj.rotation.set(0, e.obj.rotation.y, 0);
            }
          }
          if (e.emitter) {
            e.emitter.x = e.rx;
            e.emitter.y = e.ry + (e.ptype === PROJ.FLARE ? 0.02 : 0.15);
            e.emitter.z = e.rz;
          }
          if (e.fire) {
            e.fire.x = e.rx;
            e.fire.y = e.ry - 0.6;
            e.fire.z = e.rz;
            this.fireSources.push(e.fire);
          }
          if (e.loop) e.loop.setPosition(e.rx, e.ry, e.rz);
          if (e.ptype === PROJ.ROPE) {
            const owner = this.ents.get(e.owner);
            if (owner && owner.view) this.drawRopeTo(owner, e.rx, e.ry, e.rz);
          }
          break;
        }
        case ENT.CRATE: {
          e.samples.sample(renderTick, tmp);
          e.rx = tmp.x;
          e.ry = tmp.y;
          e.rz = tmp.z;
          if (e.obj) {
            e.obj.position.set(e.rx, e.ry, e.rz);
            if (e.state === 0) e.obj.rotation.y += dt * 0.3;
            if (e.chuteT !== undefined) {
              // streamer -> canopy: narrow and long, then it snaps open with a little overshoot
              const k = (e.chuteT = Math.min(1, e.chuteT + dt / 0.9));
              const b = k - 1;
              const w = 0.1 + 0.9 * (1 + 2.70158 * b * b * b + 1.70158 * b * b);
              e.obj.userData.parachute.scale.set(w, 1.3 - 0.3 * k, w);
              if (k >= 1) e.chuteT = undefined;
            }
          }
          if (e.emitter) {
            e.emitter.x = e.rx;
            e.emitter.y = e.ry;
            e.emitter.z = e.rz;
          }
          break;
        }
        case ENT.STRUCTURE: {
          if (e.shakeT > 0 && e.obj) {
            e.shakeT -= dt;
            const s = e.shakeT * 0.2;
            e.obj.position.set(e.rx + (Math.random() - 0.5) * s, e.ry, e.rz + (Math.random() - 0.5) * s);
            if (e.shakeT <= 0) e.obj.position.set(e.rx, e.ry, e.rz);
          }
          if (e.fire && e.fire.intensity > 0) this.fireSources.push(e.fire);
          break;
        }
        case ENT.AREA:
          if (e.fire) this.fireSources.push(e.fire);
          break;
      }
    }
    flashCands.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(2, flashCands.length); i++) this.remoteFlash.push(flashCands[i]);
    // corpses
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.t += dt;
      c.view.update(dt, ZANIM.DEAD, 0, time);
      if (c.burning > 0) {
        c.burning -= dt;
        if (Math.random() < dt * 15) g.effects.burnPuff(c.x, c.y, c.z);
      }
      if (c.t > 7) {
        c.view.object.position.y = c.y - (c.t - 7) * 0.5;
        if (c.t > 9) {
          this.disposeZombieView(c.view);
          this.corpses.splice(i, 1);
        }
      }
    }
    if (this.corpses.length > 40) {
      const c = this.corpses.shift();
      this.disposeZombieView(c.view);
    }
    // hide unused ropes
    for (let i = this.ropeUsed || 0; i < this.ropes.length; i++) this.ropes[i].visible = false;
    this.ropeUsed = 0;
    // loot glints on unsearched containers nearby
    let n = 0;
    for (const e of this.caches) {
      if (n >= MAX_GLINTS) break;
      const supply = e.kind === ENT.ITEM;
      if (!supply && e.q[3] !== 0) continue;
      const x = dqpos(e.q[0]);
      const y = dqpos(e.q[1]);
      const z = dqpos(e.q[2]);
      const d = Math.hypot(x - camPos.x, z - camPos.z);
      const range = supply ? 48 : 26;
      if (d > range) continue;
      this.glintPos[n * 3] = x;
      this.glintPos[n * 3 + 1] = y + (supply ? 0.45 : 0.12);
      this.glintPos[n * 3 + 2] = z;
      const pulse = 0.55 + 0.45 * Math.sin(time * (supply ? 4 : 2.6) + e.id * 1.7);
      this.glintSize[n] = (supply ? 0.3 + 0.22 * pulse : 0.14 + 0.1 * pulse) * Math.min(1, (range - d) / 6) * (d < 3 ? 0.6 : 1);
      this.glintGain[n] = 1;
      n++;
    }
    // ...and a small, quiet one on every other loose item close by, each flaring on its own beat. Dimmer at night:
    // the night's exposure would turn it into a lamp, and it lights nothing
    const gain = ITEM_GLINT_GAIN * (1 - 0.6 * g.env.night);
    const pos = this.glintPos;
    const first = n * 3;
    for (const e of this.loose) {
      if (n >= MAX_GLINTS) break;
      const x = dqpos(e.q[0]);
      const z = dqpos(e.q[2]);
      const d2 = (x - camPos.x) * (x - camPos.x) + (z - camPos.z) * (z - camPos.z);
      if (d2 > ITEM_GLINT_RANGE * ITEM_GLINT_RANGE) continue; // too far to glint: nothing more is done for it
      const y = dqpos(e.q[1]) + 0.35; // up among the grass tips: the model lies under them
      // a heap gets one glint, not one per item: an item beside one that already glints goes without
      // (looking at the latest first: what fell together is listed together)
      let j = n * 3 - 3;
      for (; j >= first; j -= 3) {
        const dx = pos[j] - x;
        const dy = pos[j + 1] - y;
        const dz = pos[j + 2] - z;
        if (dx * dx + dy * dy + dz * dz < ITEM_GLINT_SPACING * ITEM_GLINT_SPACING) break;
      }
      if (j >= first) continue;
      const d = Math.sqrt(d2);
      let flare = 0.5 + 0.5 * Math.sin(time * 1.9 + e.id * 1.7);
      flare *= flare;
      const near = Math.min(1, 0.3 + d * 0.175); // underfoot the model is plain to see: full size from 4 m out
      pos[n * 3] = x;
      pos[n * 3 + 1] = y;
      pos[n * 3 + 2] = z;
      // past 6.5 m it holds its size on screen (it would be a pixel or two at 10 m) and only fades
      this.glintSize[n] = (0.2 + 0.07 * flare) * near * Math.max(1, d / 6.5);
      this.glintGain[n] = gain * (0.7 + 0.3 * flare) * near * Math.min(1, (ITEM_GLINT_RANGE - d) / 3);
      n++;
    }
    const gg = this.glints.geometry;
    gg.setDrawRange(0, n);
    if (n) {
      gg.attributes.position.needsUpdate = true;
      gg.attributes.aSize.needsUpdate = true;
      gg.attributes.aGain.needsUpdate = true;
    }
    this.glints.material.uniforms.uScale.value = (g.renderer.renderer.domElement.height * 0.5) / Math.tan((g.camera.fov * Math.PI) / 360);
  }

  _rope() {
    let r = this.ropes[this.ropeUsed];
    if (!r) {
      r = new THREE.Mesh(this.ropeGeo, this.ropeMat);
      r.frustumCulled = false;
      this.scene.add(r);
      this.ropes.push(r);
    }
    this.ropeUsed++;
    r.visible = true;
    return r;
  }

  mouthPos(z, out) {
    const m = z.view?.object.userData.mouth;
    if (m) z.view.anchorWorld(m, out);
    else out.set(z.rx, z.ry + ZOMBIE_DEFS[z.ztype].headY - 0.1, z.rz);
    return out;
  }

  drawRopeTo(z, x, y, zz) {
    const r = this._rope();
    this.mouthPos(z, _v);
    r.position.copy(_v);
    const len = Math.hypot(x - _v.x, y - _v.y, zz - _v.z);
    r.lookAt(x, y, zz);
    r.scale.set(1, 1, len);
  }

  drawRope(z, playerId) {
    const g = this.g;
    let x;
    let y;
    let zz;
    if (playerId === g.myId) {
      const p = g.renderPos;
      x = p.x;
      y = p.y + 1.1;
      zz = p.z;
    } else {
      const p = this.ents.get(playerId);
      if (!p) return;
      x = p.rx;
      y = p.ry + 1.1;
      zz = p.rz;
    }
    this.drawRopeTo(z, x, y, zz);
  }

  // closest interactable along the view ray; with reachTop, only ones not behind a wall (see canReach). The radii
  // are shared with the server, which works out from them how far away an interaction can come from (Game.reachOf)
  pick(ox, oy, oz, dx, dy, dz, maxDist, reachTop) {
    let best = null;
    let bestT = maxDist;
    for (const e of this.ents.values()) {
      let cx;
      let cy;
      let cz;
      let r;
      if (e.kind === ENT.ITEM) {
        cx = e.rx;
        cy = e.ry + 0.15;
        cz = e.rz;
        r = PICK_RADIUS.ITEM;
      } else if (e.kind === ENT.CRATE && e.state === 1) {
        cx = e.rx;
        cy = e.ry + 0.6;
        cz = e.rz;
        r = PICK_RADIUS.CRATE;
      } else if (e.kind === ENT.STRUCTURE) {
        cx = e.rx;
        cy = e.ry + Math.min(1, STRUCT_DEFS[e.stype].sy * 0.5);
        cz = e.rz;
        r = structPickRadius(e.stype);
      } else if (e.kind === ENT.CACHE) {
        cx = dqpos(e.q[0]);
        cy = dqpos(e.q[1]);
        cz = dqpos(e.q[2]);
        r = PICK_RADIUS.CACHE;
      } else if (e.kind === ENT.PLAYER && e.downed) {
        cx = e.rx;
        cy = e.ry + 0.3;
        cz = e.rz;
        r = PICK_RADIUS.DOWNED;
      } else continue;
      const rx = cx - ox;
      const ry = cy - oy;
      const rz = cz - oz;
      const t = rx * dx + ry * dy + rz * dz;
      if (t < 0 || t > bestT + r) continue;
      const px = rx - dx * t;
      const py = ry - dy * t;
      const pz = rz - dz * t;
      if (px * px + py * py + pz * pz > r * r) continue;
      const adj = e.kind === ENT.STRUCTURE ? t + 0.6 : e.kind === ENT.CACHE ? t + 0.15 : t; // prefer items over containers over structures
      if (adj < bestT && (reachTop === undefined || canReach(this.g.world, ox, oy, oz, cx, cy, cz, reachTop))) {
        bestT = adj;
        best = e;
      }
    }
    return best;
  }
}
