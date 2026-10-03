// Map-signature runtime effects, generic so map workers only declare them in a variant:
//   lamp    — working helmet lamp: lens emissive + halo (one HaloBatch draw for all), volumetric beam (glow.js makeBeam) whose length
//             is limited by a world raycast (so the beam lights the tunnel wall before the zombie turns the corner), and the two
//             nearest lamps get a real pooled SpotLight (nearest one casts shadows).
//   breath  — frosty breath puffs from the mouth (cold maps).
//   drips   — water dripping from chin, fingers, hems + wet footprints (harbour dead).
//   balloon — helium balloon on a Verlet string tied to a wrist; hittable (pops).
//   embers  — sparks rising from magma-cracked bodies; crystal glints.
import * as THREE from 'three';
import { makeBeam, HaloBatch } from '../../core/glow.js';
import { std } from '../../core/mats.js';
import { DECAL } from '../../core/fx.js';
import { BI } from './rig.js';

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _q = new THREE.Quaternion(), _hit = { t: 0, nx: 0, ny: 0, nz: 0, surface: null };

export class Signature {
  constructor(mgr, maxZ = 32) {
    const { gfx, fx } = mgr; this.m = mgr; this.gfx = gfx; this.fx = fx;
    this.group = new THREE.Group(); this.group.name = 'zombie-signature'; gfx.scene.add(this.group);
    // ---- lamps (beam near = 1 m: the cone fades within ~1-3 m of the camera, so a lamp passing the camera is no white wall)
    this.halos = new HaloBatch(maxZ * 2); for (let i = 0; i < maxZ * 2; i++) this.halos.add([0, -1000, 0], 0xffe0b0, 0.3, 0, 0); this.group.add(this.halos.mesh);
    this.beams = []; for (let i = 0; i < maxZ; i++) { const b = makeBeam({ length: 14, r0: 0.03, r1: 1.35, color: 0xffe6c0, intensity: 0.28, dust: 1.2, seg: 18, near: 1.0 }); b.visible = false; this.group.add(b); this.beams.push(b); }
    this.spots = [0, 1].map((i) => gfx.addLight({ kind: 'spot', pos: new V3(), dir: new V3(0, 0, -1), color: new THREE.Color(0xffe8c8), intensity: 0, distance: 24, decay: 2, angle: 0.36, penumbra: 0.55, priority: 5, shadow: i === 0, enabled: false }));
    this._near = [null, null];
    // ---- balloons
    const bg = balloonGeometry(); this.balloonMat = std({ physical: true, color: 0xffffff, roughness: 0.28, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.15, key: 'zballoon' });
    this.balloons = new THREE.InstancedMesh(bg, this.balloonMat, maxZ); this.balloons.count = maxZ; this.balloons.frustumCulled = false; this.balloons.castShadow = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < maxZ; i++) { this.balloons.setMatrixAt(i, zero); this.balloons.setColorAt(i, new THREE.Color(0xffffff)); }
    this.group.add(this.balloons);
    const NS = 6; this.NS = NS; const sp = new Float32Array(maxZ * NS * 2 * 3); this.strGeo = new THREE.BufferGeometry(); this.strGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
    this.strings = new THREE.LineSegments(this.strGeo, new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.8 })); this.strings.frustumCulled = false; this.group.add(this.strings);
    this._m4 = new THREE.Matrix4(); this._s = new V3(); this._col = new THREE.Color();
    this.t = 0;
  }
  // ---------------------------------------------------------------- per-zombie setup
  attach(z) {
    const d = z.def; const sig = z.sig || (z.sig = { lamp: null, balloon: null, breathT: Math.random() * 2, dripT: Math.random(), emberT: Math.random() });
    sig.lamp = null; sig.balloon = null;
    if (d.lamp && !z.hatOff) { const L = d.lamp === true ? {} : d.lamp; const gi = z.geo && z.geo.info && z.geo.info.lamp; sig.lamp = { bone: BI[L.bone || (gi && gi.bone) || 'head'], p: new V3(...(L.pos || (gi && gi.pos) || [0, 1.737, -0.123])), d: new V3(...(L.dir || (gi && gi.dir) || [0, -0.2, -1])).normalize(), color: new THREE.Color(L.color ?? 0xffe6c0), intensity: L.intensity ?? 55, range: L.range ?? 16, len: 0.01, rayT: Math.random() * 0.1, on: 1, flick: 0, wp: new V3(), wd: new V3(), beam: this.beams[z.slot], halo: z.slot, dying: 0 }; }
    if (d.balloon) { const B = d.balloon; const n = this.NS; sig.balloon = { hand: BI['hand.' + (B.hand || 'L')], len: B.length ?? 1.15, color: new THREE.Color(B.color ?? 0xd02020), x: new Float32Array(n * 3), px: new Float32Array(n * 3), popped: false, r: B.r ?? 0.17, slot: z.slot, free: 0 };
      z.anim.pose.P[sig.balloon.hand] && this._initBalloon(z); }
  }
  detach(z) { const sig = z.sig; if (!sig) return; if (sig.lamp) { sig.lamp.beam.visible = false; this._halo(sig.lamp.halo, null); } if (sig.balloon) { this.balloons.setMatrixAt(sig.balloon.slot, this._m4.makeScale(0, 0, 0)); this.balloons.instanceMatrix.needsUpdate = true; this._clearString(sig.balloon.slot); } sig.lamp = null; sig.balloon = null; }
  _halo(i, pos, color, size, intensity) { const hb = this.halos; if (!pos) { hb.pos.setXYZ(i, 0, -1000, 0); hb.col.setW(i, 0); } else { hb.pos.setXYZ(i, pos.x, pos.y, pos.z); hb.col.setXYZW(i, color.r, color.g, color.b, intensity); hb.par.setX(i, size); } hb.pos.needsUpdate = true; hb.col.needsUpdate = true; hb.par.needsUpdate = true; }

  // ---------------------------------------------------------------- frame update
  update(dt, t, zombies, camPos, world) {
    this.t = t; let n0 = null, n1 = null, d0 = 1e9, d1 = 1e9;
    // volumetric beams / glare are only visible against darkness: scale by the ambient level of the current atmosphere
    const at = this.gfx.atmo; const amb = at ? Math.min(1.5, (at.sun?.intensity || 0) / 3.5 + (at.env?.intensity || 0) * 0.9) : 0.3;
    const beamK = Math.max(0.04, Math.min(1, 1.15 - amb * 1.1)); this.beamK = beamK;
    for (const z of zombies) {
      const sig = z.sig; if (!sig) continue; const P = z.pose;
      // ---- lamp
      const L = sig.lamp;
      if (L) {
        const headGone = z.lost && z.lost.head; if (headGone) L.on = 0;
        if (z.dead) L.dying += dt; const fade = z.dead ? Math.max(0, 1 - Math.max(0, L.dying - 5) / 3) : 1;
        L.flick = Math.max(0, L.flick - dt); const fl = L.flick > 0 ? (Math.random() < 0.5 ? 0.15 : 1) : (0.97 + 0.03 * Math.sin(t * 23 + z.slot));
        const on = L.on * fade * fl;
        z.body.u.uEmis.value.w = 0.25 + on * 0.75;
        P.pointOn(L.bone, L.p.x, L.p.y, L.p.z, L.wp); L.wd.copy(L.d).applyQuaternion(P.Q[L.bone]);
        // beam length from a staggered world raycast (limits the cone at walls/floor)
        L.rayT -= dt; if (L.rayT <= 0) { L.rayT = 0.1; L.len = world && world.raycast(L.wp.x, L.wp.y, L.wp.z, L.wd.x, L.wd.y, L.wd.z, L.range, _hit) ? Math.max(0.3, _hit.t) : L.range; }
        const bm = L.beam; bm.visible = on > 0.02 && z.body.mesh.visible !== false; bm.position.copy(L.wp); _a.copy(L.wp).add(L.wd); bm.lookAt(_a); bm.setLength(Math.max(0.4, L.len)); bm.material.uniforms.uFlick.value = on * beamK * (z.dead ? 0.6 : 1); bm.material.uniforms.uFar.value = Math.max(2, L.len * 1.6);
        // halo: glare strongest when the lamp faces the camera
        _b.subVectors(camPos, L.wp); const dist = _b.length(); _b.divideScalar(dist || 1); const facing = Math.max(0, L.wd.dot(_b)); const glare = (0.08 + 0.9 * facing * facing * facing) * on * Math.min(1, dist / 2.5) * (0.3 + 0.7 * beamK);
        this._halo(L.halo, L.wp, L.color, 0.07 + 0.12 * facing, glare);
        if (on > 0.2 && !z.dead) { if (dist < d0) { d1 = d0; n1 = n0; d0 = dist; n0 = z; } else if (dist < d1) { d1 = dist; n1 = z; } }
      }
      if (z.dead && z.deadT > 9) continue;
      const distCam = z.distCam;
      // ---- breath (frost)
      if (z.def.breath && !z.dead && distCam < 22 && !(z.lost && z.lost.head)) {
        sig.breathT -= dt; if (sig.breathT <= 0) { sig.breathT = 1.5 + Math.random() * 1.1 - (z.speedClass === 'sprint' ? 0.7 : 0);
          P.pointOn(BI.head, 0, 1.575, -0.105, _a); _b.set(0, -0.15, -1).applyQuaternion(P.Q[BI.head]);
          this.fx.puff(_a, _b, 3, { speed: 0.35, size: [0.04, 0.32], life: 1.5, color: [0.92, 0.95, 1.0, 0.16], cell: 1, rise: 0.12, drag: 1.4, spread: 0.08 }); }
      }
      // ---- drips (wet)
      if ((z.def.wet || z.wetT > 0) && distCam < 16) {
        sig.dripT -= dt; if (sig.dripT <= 0) { sig.dripT = 0.07 + Math.random() * 0.12; const pts = DRIP_PTS; const k = (Math.random() * pts.length) | 0; const dp = pts[k]; P.pointOn(BI[dp[0]], dp[1], dp[2], dp[3], _a);
          this.fx.alpha.emit({ p: _a, v: [(Math.random() - 0.5) * 0.1, -0.3, (Math.random() - 0.5) * 0.1], life: 0.9, size: [0.012, 0.01], c0: [0.7, 0.8, 0.85, 0.8], c1: [0.7, 0.8, 0.85, 0.5], gravity: 1, cell: 7, stretch: 0.02 }, this.fx.time); }
      }
      // ---- embers (magma-cracked)
      if (z.def.embers && distCam < 25) {
        sig.emberT -= dt; if (sig.emberT <= 0) { sig.emberT = 0.1 + Math.random() * 0.25; const pts = EMBER_PTS; const k = (Math.random() * pts.length) | 0; P.pointOn(BI[pts[k][0]], pts[k][1], pts[k][2], pts[k][3], _a);
          this.fx.add.emit({ p: _a, v: [(Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4], life: 0.9 + Math.random() * 0.8, size: [0.018, 0.006], c0: [4, 1.4, 0.25, 1], c1: [1.2, 0.2, 0.02, 0], gravity: -0.05, drag: 0.6, cell: 0 }, this.fx.time); }
      }
      // ---- balloon
      if (sig.balloon) this._balloon(dt, z, sig.balloon);
    }
    // ---- pooled spot lights on the two nearest lamps
    const near = [n0, n1];
    for (let i = 0; i < 2; i++) {
      const src = this.spots[i], z = near[i];
      if (!z || !z.sig || !z.sig.lamp) { src.enabled = false; src.intensity = 0; continue; }
      const L = z.sig.lamp; src.enabled = true; src.pos.copy(L.wp).addScaledVector(L.wd, 0.05); src.dir.copy(L.wd); src.color.copy(L.color); src.intensity = L.intensity * (L.flick > 0 ? 0.3 : 1); src.distance = L.range * 1.5;
    }
    this.halos.pos.needsUpdate = true;
    if (this._balloonDirty) { this.balloons.instanceMatrix.needsUpdate = true; this.strGeo.attributes.position.needsUpdate = true; this._balloonDirty = false; }
  }
  /** lamp flickers after a hit (bulb jostle) */
  jostle(z, dur = 0.35) { if (z.sig && z.sig.lamp) z.sig.lamp.flick = dur; }

  // ---------------------------------------------------------------- balloons
  _initBalloon(z) {
    const B = z.sig.balloon, n = this.NS; const h = z.pose.P[B.hand]; this.balloons.setColorAt(B.slot, B.color); this.balloons.instanceColor.needsUpdate = true;
    for (let i = 0; i < n; i++) { const y = h.y + (i / (n - 1)) * B.len; B.x[i * 3] = h.x; B.x[i * 3 + 1] = y; B.x[i * 3 + 2] = h.z; B.px[i * 3] = h.x; B.px[i * 3 + 1] = y; B.px[i * 3 + 2] = h.z; }
    B.popped = false; B.free = 0;
  }
  _balloon(dt, z, B) {
    const n = this.NS, X = B.x, PX = B.px; const h = z.pose.P[B.hand]; const seg = B.len / (n - 1); const wind = this.m.windVec;
    const attached = !B.popped && B.free <= 0 && !(z.lost && (z.lost['arm' + (B.hand === BI['hand.L'] ? 'L' : 'R')]));
    if (!attached) B.free += dt;
    const dt2 = Math.min(dt, 0.033) ** 2;
    for (let i = attached ? 1 : 0; i < n; i++) {
      const o = i * 3; const buoy = B.popped ? -9.81 : (i === n - 1 ? 3.2 : -0.6);
      const vx = (X[o] - PX[o]) * 0.97, vy = (X[o + 1] - PX[o + 1]) * 0.97, vz = (X[o + 2] - PX[o + 2]) * 0.97; PX[o] = X[o]; PX[o + 1] = X[o + 1]; PX[o + 2] = X[o + 2];
      X[o] += vx + (wind.x * 0.4 + Math.sin(this.t * 1.3 + i + B.slot) * 0.15) * dt2; X[o + 1] += vy + buoy * dt2; X[o + 2] += vz + (wind.z * 0.4 + Math.cos(this.t * 1.1 + i * 1.7 + B.slot) * 0.15) * dt2;
    }
    if (attached) { X[0] = h.x; X[1] = h.y; X[2] = h.z; }
    for (let it = 0; it < 4; it++) for (let i = 0; i < n - 1; i++) {
      const a = i * 3, b = a + 3; const dx = X[b] - X[a], dy = X[b + 1] - X[a + 1], dz = X[b + 2] - X[a + 2]; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6; const diff = (d - seg) / d;
      if (i === 0 && attached) { X[b] -= dx * diff; X[b + 1] -= dy * diff; X[b + 2] -= dz * diff; } else { X[a] += dx * diff * 0.5; X[a + 1] += dy * diff * 0.5; X[a + 2] += dz * diff * 0.5; X[b] -= dx * diff * 0.5; X[b + 1] -= dy * diff * 0.5; X[b + 2] -= dz * diff * 0.5; }
    }
    // render
    const top = (n - 1) * 3; _a.set(X[top], X[top + 1], X[top + 2]); _b.set(X[top] - X[top - 3], X[top + 1] - X[top - 2], X[top + 2] - X[top - 1]).normalize();
    _q.setFromUnitVectors(_c.set(0, 1, 0), _b); const sc = B.popped ? 0 : B.r / 0.17; this._s.set(sc, sc, sc); this._m4.compose(_a, _q, this._s); this.balloons.setMatrixAt(B.slot, this._m4);
    const arr = this.strGeo.attributes.position.array; let o = B.slot * n * 6;
    for (let i = 0; i < n - 1; i++) { arr[o++] = X[i * 3]; arr[o++] = X[i * 3 + 1]; arr[o++] = X[i * 3 + 2]; arr[o++] = X[i * 3 + 3]; arr[o++] = X[i * 3 + 4] - (i === n - 2 ? B.r * 0.95 * (B.popped ? 0 : 1) : 0); arr[o++] = X[i * 3 + 5]; }
    this._balloonDirty = true;
    if (B.free > 12) { this.balloons.setMatrixAt(B.slot, this._m4.makeScale(0, 0, 0)); this._clearString(B.slot); z.sig.balloon = null; }
  }
  _clearString(slot) { const arr = this.strGeo.attributes.position.array; arr.fill(0, slot * this.NS * 6, (slot + 1) * this.NS * 6); this.strGeo.attributes.position.needsUpdate = true; }
  /** ray vs balloons; returns {z, t} of the nearest or null */
  raycastBalloon(o, d, maxT, zombies, out) {
    let best = maxT, hz = null;
    for (const z of zombies) { const B = z.sig && z.sig.balloon; if (!B || B.popped) continue; const k = (this.NS - 1) * 3; const cx = B.x[k], cy = B.x[k + 1] + B.r * 0.1, cz = B.x[k + 2]; const lx = o.x - cx, ly = o.y - cy, lz = o.z - cz; const bb = lx * d.x + ly * d.y + lz * d.z, c = lx * lx + ly * ly + lz * lz - B.r * B.r; const disc = bb * bb - c; if (disc < 0) continue; const t = -bb - Math.sqrt(disc); if (t > 0 && t < best) { best = t; hz = z; } }
    if (!hz) return false; out.zombie = hz; out.t = best; return true;
  }
  pop(z) {
    const B = z.sig && z.sig.balloon; if (!B || B.popped) return; B.popped = true; const k = (this.NS - 1) * 3; _a.set(B.x[k], B.x[k + 1], B.x[k + 2]);
    for (let i = 0; i < 10; i++) this.fx.alpha.emit({ p: _a, v: [(Math.random() - 0.5) * 3, (Math.random() - 0.2) * 3, (Math.random() - 0.5) * 3], life: 1.2, size: [0.03, 0.03], c0: [B.color.r, B.color.g, B.color.b, 1], c1: [B.color.r, B.color.g, B.color.b, 1], gravity: 0.6, drag: 1.5, rotVel: (Math.random() - 0.5) * 20, cell: 6 }, this.fx.time);
    this.m.audio?.play?.('balloon.pop', { pos: _a, vol: 0.8 }); this.balloons.setMatrixAt(B.slot, this._m4.makeScale(0, 0, 0)); this._balloonDirty = true;
  }
}
// drip / ember emission points (rest space): [bone, x, y, z]
const DRIP_PTS = [['head', 0, 1.53, -0.075], ['hand.L', -0.62, 0.87, -0.08], ['hand.R', 0.62, 0.87, -0.08], ['pelvis', 0.12, 0.82, -0.08], ['pelvis', -0.14, 0.8, 0.06], ['calf.L', -0.1, 0.46, -0.06], ['calf.R', 0.1, 0.46, -0.06], ['forearm.L', -0.5, 1.02, -0.04], ['forearm.R', 0.5, 1.02, -0.04], ['head', 0.07, 1.6, 0.0]];
const EMBER_PTS = [['chest', 0.08, 1.35, -0.1], ['chest', -0.1, 1.3, 0.09], ['spine1', 0.1, 1.1, -0.08], ['upperarm.L', -0.27, 1.3, 0], ['upperarm.R', 0.27, 1.3, 0], ['head', 0.04, 1.7, 0.02], ['thigh.L', -0.1, 0.7, -0.06], ['forearm.R', 0.47, 1.05, -0.05]];

function balloonGeometry() { // latex teardrop + knot, 0.34 m tall, origin at the knot (string attachment)
  const pts = []; const H = 0.34;
  for (let i = 0; i <= 20; i++) { const t = i / 20; const y = t * H; const r = t < 0.06 ? 0.006 + t * 0.2 : 0.17 * Math.sin(Math.PI * Math.pow((t - 0.04) / 0.96, 0.75)) * (1 - 0.1 * t); pts.push(new THREE.Vector2(Math.max(0.004, r), y)); }
  const g = new THREE.LatheGeometry(pts, 20); g.computeVertexNormals(); return g;
}
