// LAST FERRY — generic boat builder: lofted steel hull (2 materials split at the boot-top), deck, bulwark, superstructure blocks, masts, lights.
// Each boat is its own THREE.Group with its own Builder (merged geometry) so it can be moved/rocked by the sea every frame (moored trawlers, tugs, patrol boat, passing ships).
// Boat frame: origin = deck top at midship centreline, -Z bow, +X starboard, +Y up. Waterline at y = -free.
import * as THREE from 'three';
import { Builder } from '../../core/build.js';
import { std } from '../../core/mats.js';
import { Glows, getSea, lampReg } from './shared.js';

const P = Math.PI;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** hull raw geometry {p,n,u,i}. spec: L, HB (half beam at deck), free (freeboard), draft, bow (0 round .. 1 very sharp), stern (transom half-width fraction), bilge (section roundness), keelRise */
export function hullRaw(spec, part) {
  const { L, HB, free, draft } = spec, depth = free + draft; const bow = spec.bow ?? 0.6, sternK = spec.stern ?? 0.85, flare = spec.flare ?? 0.06;
  const tB = 0.16 + 0.22 * (1 - bow), tS = 0.86;
  const W = (t) => { if (t < tB) return HB * (1 - Math.pow(1 - t / tB, 1.6 + 1.1 * bow)); if (t > tS) return HB * (1 - (1 - sternK) * Math.pow((t - tS) / (1 - tS), 2)); return HB; };
  const K = (t) => { const k = -depth; if (t < 0.24) return k + (spec.keelRise ?? 0.9) * Math.pow(1 - t / 0.24, 2); if (t > 0.9) return k + 0.4 * Math.pow((t - 0.9) / 0.1, 2); return k; };
  const F = (u) => (u < 0.42 ? 0.08 + 0.85 * (1 - Math.pow(1 - u / 0.42, 2.2)) : 0.93 + 0.07 * (u - 0.42) / 0.58);
  const wl = (draft) / depth; // u of the waterline
  const SS = [0, 0.012, 0.03, 0.055, 0.09, 0.13, 0.18, 0.24, 0.31, 0.39, 0.47, 0.55, 0.63, 0.71, 0.78, 0.85, 0.91, 0.955, 0.985, 1.0];
  const UU = [0, 0.05, 0.12, 0.22, 0.32, 0.42, 0.52, 0.64, 0.76, 0.88, 1.0].map((u) => u); // relative to depth
  // split index at the boot-top: nearest u to draft/depth... waterline = free from top => u_wl = draft/depth
  const uwl = draft / depth; let split = 0; for (let i = 0; i < UU.length; i++) if (UU[i] <= uwl + 0.02) split = i; const range = part === 'bottom' ? [0, split] : [split, UU.length - 1];
  const P_ = [], I_ = [], UV = [], idx = [];
  for (let r = 0; r < SS.length; r++) {
    const t = SS[r], z = -L / 2 + t * L, w = W(t) * (1 + flare * (1 - t / 0.4 > 0 ? 1 - t / 0.4 : 0)), k = K(t); const row = []; let arc = 0, last = null;
    const prof = []; for (let j = range[1]; j >= range[0]; j--) prof.push([-1, j]); for (let j = range[0]; j <= range[1]; j++) prof.push([1, j]);
    for (const [sd, j] of prof) { const u = UU[j], x = sd * w * F(u) * (1 + (u > 0.6 ? flare * (u - 0.6) : 0)), y = k + u * (0 - k); if (last) arc += Math.hypot(x - last[0], y - last[1]); last = [x, y]; row.push(P_.length / 3); P_.push(x, y, z); UV.push(arc, z); }
    idx.push(row);
  }
  for (let r = 0; r < SS.length - 1; r++) for (let c = 0; c < idx[r].length - 1; c++) { const a = idx[r][c], b = idx[r][c + 1], d = idx[r + 1][c], e = idx[r + 1][c + 1]; I_.push(a, b, d, b, e, d); }
  const lastRow = idx[SS.length - 1]; const cx = P_.length / 3; P_.push(0, part === 'bottom' ? -depth : 0, L / 2); UV.push(0, L / 2); for (let c = 0; c < lastRow.length - 1; c++) I_.push(cx, lastRow[c], lastRow[c + 1]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P_, 3)); g.setIndex(I_); g.computeVertexNormals();
  const raw = { p: new Float32Array(g.attributes.position.array), n: new Float32Array(g.attributes.normal.array), u: new Float32Array(UV), i: new Uint32Array(g.index.array) };
  let s = 0; for (let k = 0; k < raw.p.length / 3; k += 7) s += Math.sign(raw.p[k * 3]) * raw.n[k * 3]; if (s < 0) { for (let k = 0; k < raw.n.length; k++) raw.n[k] *= -1; for (let k = 0; k < raw.i.length; k += 3) { const t = raw.i[k + 1]; raw.i[k + 1] = raw.i[k + 2]; raw.i[k + 2] = t; } }
  return { raw, W, K };
}

/** build a boat. spec: {L, HB, free, draft, bow, stern, mats:{top,bottom,deck,cabin,trim,dark,rope,rust,glass,lit}, seed, cabin:[{z0,z1,w,h,y}], name} ; returns {group, B, halos, W, update(t,x,z,yaw)} */
export function makeBoat(ctx, spec, custom) {
  const grp = new THREE.Group(); const B = new Builder({ synth: ctx.synth, group: grp, seed: spec.seed || 3, cell: 200 }); B.batch.cellY = 200; B.inst.cell = 200;
  const M = spec.mats; const I4 = new THREE.Matrix4(); const halos = new Glows(64); halos.sizeScale = 0.5; grp.add(halos.mesh);
  const bot = hullRaw(spec, 'bottom'), top = hullRaw(spec, 'top'); B.addRaw(bot.raw, I4, M.bottom, { cast: true }); B.addRaw(top.raw, I4, M.top, { cast: true });
  const { L, HB } = spec, W = top.W; const zAt = (t) => -L / 2 + t * L;
  // deck
  const zs = []; for (let i = 0; i <= 24; i++) zs.push(zAt(i / 24)); const poly = []; for (const z of zs) poly.push([W((z + L / 2) / L) - 0.03, z]); for (let i = zs.length - 1; i >= 0; i--) poly.push([-(W((zs[i] + L / 2) / L) - 0.03), zs[i]]);
  B.extrude({ p: [0, -0.1, 0], poly, h: 0.1, mat: M.deck, col: false, bevel: 0 });
  // bulwark
  const bh = spec.bulwark ?? 1.0, sheerK = spec.sheer ?? 0.5; const bhAt = (z) => bh + sheerK * Math.pow(Math.max(0, 1 - (z + L / 2) / (L * 0.3)), 2);
  for (const sd of [-1, 1]) for (let i = 0; i < zs.length - 1; i++) { const za = zs[i], zb = zs[i + 1], wa = W((za + L / 2) / L) - 0.08, wb = W((zb + L / 2) / L) - 0.08, h = (bhAt(za) + bhAt(zb)) / 2; if (wa < 0.05 && wb < 0.05) continue; B.beam([sd * wa, h / 2, za], [sd * wb, h / 2, zb], 0.09, h, { mat: M.top, bevel: 0, cast: true }); }
  B.tube({ pts: zs.map((z) => [W((z + L / 2) / L) - 0.08, bhAt(z) + 0.02, z]), r: 0.045, mat: M.trim, seg: 5, segs: 40, cast: false }); B.tube({ pts: zs.map((z) => [-(W((z + L / 2) / L) - 0.08), bhAt(z) + 0.02, z]), r: 0.045, mat: M.trim, seg: 5, segs: 40, cast: false });
  // cabin blocks
  for (const c of spec.cabin || []) { B.box({ p: [0, c.y ?? 0, (c.z0 + c.z1) / 2], s: [c.w, c.h, c.z1 - c.z0], mat: c.mat || M.cabin, bevel: 0.05, cast: true });
    if (c.windows !== false) for (const zz of [c.z0, c.z1]) B.box({ p: [0, (c.y ?? 0) + c.h * 0.55, zz + (zz === c.z0 ? -0.02 : 0.02)], s: [c.w - 0.5, 0.5, 0.03], mat: M.lit, bevel: 0, cast: false }); for (const sd of [-1, 1]) for (let z = c.z0 + 0.7; z < c.z1 - 0.5; z += 1.5) B.box({ p: [sd * (c.w / 2 + 0.01), (c.y ?? 0) + c.h * 0.55, z], s: [0.03, 0.5, 0.8], mat: M.lit, bevel: 0, cast: false }); B.box({ p: [0, (c.y ?? 0) + c.h, (c.z0 + c.z1) / 2], s: [c.w + 0.3, 0.1, c.z1 - c.z0 + 0.3], mat: M.trim, bevel: 0.02, cast: true }); }
  const ctxb = { B, grp, halos, M, W, L, HB, zAt, spec, bhAt };
  if (custom) custom(ctxb);
  B.finish(); grp.userData.boat = ctxb;
  const boat = { group: grp, B, halos, W, spec, lamps: [], sea: getSea(), _p: new THREE.Vector3(), _q: new THREE.Quaternion(), _e: new THREE.Euler(), base: { x: 0, z: 0, yaw: 0 },
    /** place in WORLD coordinates (group must be a child of world root or stop group with origin offset ox,oz) */
    setBase(x, z, yaw) { this.base.x = x; this.base.z = z; this.base.yaw = yaw; },
    update(t, ox = 0, oz = 0, k = 1) {
      // sample the sea at bow, stern, port, starboard (world) => heave/pitch/roll (soft: boats are moored/large, damped)
      const b = this.base, c = Math.cos(b.yaw), s = Math.sin(b.yaw); const at = (lx, lz) => this.sea.height(ox + b.x + lx * c + lz * s, oz + b.z - lx * s + lz * c, t);
      const hb = at(0, -L * 0.4), hs = at(0, L * 0.4), hp = at(-HB, 0), hst = at(HB, 0), hc = at(0, 0);
      const heave = (hb + hs + hp + hst + 2 * hc) / 6 * k, pitch = Math.atan2(hs - hb, L * 0.8) * 0.6 * k, roll = Math.atan2(hp - hst, HB * 2) * 0.5 * k;
      this._e.set(pitch, b.yaw, roll, 'YXZ'); grp.quaternion.setFromEuler(this._e); grp.position.set(b.x, heave + spec.free - (spec.sink ?? 0), b.z);
    } };
  return boat;
}
