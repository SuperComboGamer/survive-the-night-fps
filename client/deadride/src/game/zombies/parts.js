// OUTFIT API. A variant's build(o, rng) calls these helpers; the Outfit records body/garment settings, then (per LOD) builds the
// subdivided body, garment shells, head and all accessory geometry into one GeoBuf. Coordinates are REST MODEL SPACE (metres,
// character 1.75 m tall standing at the origin, facing −Z, +X = character's right). Bones are named as in rig.js
// ('head', 'chest', 'hand.R', 'upperarm.L', ...). Material specs: { mat:'cloth'|'leather'|'rubber'|'metal'|'paint'|'plastic'|
// 'glass'|'emissive'|'fur'|'crystal'|'rope'|'hair'|'skin'|..., color:0xRRGGBB, rough, metal, wear, dirt, pattern, emissive, sway }.
import * as THREE from 'three';
import { BI, NB, RIG, restPos, restTail, restAt, HEAD_CENTER } from './rig.js';
import { GeoBuf, Cage, matSpec, MID, PAT, REG, PointIndex, bridge } from './mesh.js';
import { buildBodyCage, bakeCageAO, sculptSkin } from './body.js';
import { buildHead, faceParams, EYE } from './head.js';
import { buildHair } from './hair.js';
import { cachedBuild } from './mouth.js';
import { makeRng, strHash } from '../../core/util.js';
import { sculptHands, buildNails, buildToes } from './hand.js';
import { applyWounds, buildCaps } from './flesh.js';
import { clothSim, clothShape, finishLayer, classify, fitParams, PROF } from './cloth.js';
import { garmentColor, makeWear } from './wear.js';
import { addHems as addRolledHems, decorate, cullSims } from './stitch.js';

const V = THREE.Vector3;
const TAU = Math.PI * 2;
const SUBDIV = [2, 1, 0]; // Catmull-Clark levels per LOD
const SUBDIV_SKIN = [2, 1, 0]; // bare-skin levels per LOD (mesh.js supports 3; measured +5..+45k LOD0 tris per look, over the LOD0 budget)

// ------------------------------------------------------------------ garment presets: face selectors over body-cage tags
const T = (t) => t.part;
export const GARMENTS = {
  // neckline: seg 8 (shoulder tops) is covered except the two faces flanking the front midline (cols 11, 0) → open front neck
  shirt: { sel: (t, o) => (T(t) === 'torso' && t.seg >= 2 && t.seg <= 7) || (T(t) === 'torso' && t.seg === 8 && !(t.col === 11 || t.col === 0)) || T(t) === 'upperarm' || (T(t) === 'forearm' && t.seg <= (o.sleeve ?? 6)), offset: 0.008, loose: 0.006, mat: { mat: 'cloth', pattern: 'weave' }, collar: 'fold', vneck: 0.06, detail: 7 },
  tshirt: { sel: (t) => (T(t) === 'torso' && t.seg >= 2 && t.seg <= 7) || (T(t) === 'torso' && t.seg === 8 && t.zone !== 'front') || (T(t) === 'upperarm' && t.seg <= 1), offset: 0.007, loose: 0.005, mat: { mat: 'cloth', pattern: 'knit' }, detail: 4 },
  singlet: { fit: 'tight', sel: (t) => T(t) === 'torso' && t.seg >= 2 && t.seg <= 6 && !(t.seg >= 5 && t.zone === 'side'), offset: 0.005, loose: 0.003, mat: { mat: 'cloth', pattern: 'knit' } },
  pants: { sel: (t, o) => (T(t) === 'torso' && t.seg <= 2) || T(t) === 'thigh' || (T(t) === 'shin' && t.seg <= (o.hem ?? 8)), offset: 0.01, loose: 0.012, mat: { mat: 'cloth', pattern: 'denim' }, detail: 8 },
  shorts: { sel: (t) => (T(t) === 'torso' && t.seg <= 2) || (T(t) === 'thigh' && t.seg <= 2), offset: 0.01, loose: 0.01, mat: { mat: 'cloth', pattern: 'weave' } },
  coveralls: { fit: 'loose', sel: (t, o) => (T(t) === 'torso' && t.seg <= 7) || (T(t) === 'torso' && t.seg === 8 && !(t.col === 11 || t.col === 0)) || T(t) === 'upperarm' || (T(t) === 'forearm' && t.seg <= (o.sleeve ?? 6)) || T(t) === 'thigh' || (T(t) === 'shin' && t.seg <= (o.hem ?? 8)), offset: 0.012, loose: 0.014, mat: { mat: 'cloth', pattern: 'canvas' }, collar: 'fold', vneck: 0.07, detail: 15 },
  overalls: { fit: 'loose', sel: (t, o) => (T(t) === 'torso' && t.seg <= 2) || (T(t) === 'torso' && t.seg <= 5 && t.zone === 'front') || (T(t) === 'torso' && t.seg <= 3 && t.zone === 'back') || T(t) === 'thigh' || (T(t) === 'shin' && t.seg <= (o.hem ?? 8)), offset: 0.014, loose: 0.014, mat: { mat: 'cloth', pattern: 'denim' }, detail: 8 },
  jacket: { sel: (t, o) => (T(t) === 'torso' && t.seg >= 1 && t.seg <= 7) || (T(t) === 'torso' && t.seg === 8 && !(t.col === 11 || t.col === 0)) || T(t) === 'upperarm' || (T(t) === 'forearm' && t.seg <= (o.sleeve ?? 6)), offset: 0.013, loose: 0.01, mat: { mat: 'cloth', pattern: 'canvas' }, collar: 'fold', vneck: 0.11, detail: 7 },
  vest: { sel: (t) => T(t) === 'torso' && t.seg >= 2 && t.seg <= 8 && !(t.seg >= 5 && (t.col === 11 || t.col === 0)), offset: 0.012, loose: 0.006, mat: { mat: 'cloth', pattern: 'weave' }, vneck: { ring: 5, depth: 0, pull: 0.2 }, detail: 1 },
  gloves: { fit: 'tight', sel: (t) => T(t) === 'hand' || T(t) === 'finger' || T(t) === 'thumb' || (T(t) === 'forearm' && t.seg >= 7), offset: 0.0035, loose: 0.001, mat: { mat: 'leather' } },
  mittens: { sel: (t) => T(t) === 'hand' || T(t) === 'finger' || T(t) === 'thumb' || (T(t) === 'forearm' && t.seg >= 6), offset: 0.012, loose: 0.006, mat: { mat: 'cloth', pattern: 'knit' } },
  boots: { fit: 'tight', sel: (t, o) => T(t) === 'foot' || (T(t) === 'shin' && t.seg >= (o.height ?? 6)), offset: 0.011, loose: 0.006, mat: { mat: 'leather' }, boot: true },
  wellies: { fit: 'loose', sel: (t) => T(t) === 'foot' || (T(t) === 'shin' && t.seg >= 4), offset: 0.014, loose: 0.016, mat: { mat: 'rubber' }, boot: true },
  socks: { fit: 'tight', sel: (t) => T(t) === 'foot' || (T(t) === 'shin' && t.seg >= 7), offset: 0.002, loose: 0, mat: { mat: 'cloth', pattern: 'knit' } },
  hood: { sel: (t) => T(t) === 'neck', offset: 0.03, loose: 0.01, mat: { mat: 'cloth' } },
};

// ------------------------------------------------------------------ helpers
const toV = (p) => (p instanceof V ? p.clone() : new V(p[0], p[1], p[2]));
function frameFromDir(d) { const up = Math.abs(d.y) < 0.95 ? new V(0, 1, 0) : new V(1, 0, 0); const x = new V().crossVectors(up, d).normalize(); const y = new V().crossVectors(d, x).normalize(); return { x, y, z: d.clone() }; }
function eulerQ(rot) { if (!rot) return new THREE.Quaternion(); if (rot.isQuaternion) return rot; return new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0, 'YXZ')); }
function wOf(w) { if (!w) return null; if (typeof w === 'string') return [[BI[w], 1]]; if (Array.isArray(w)) return w.map(([b, v]) => [typeof b === 'string' ? BI[b] : b, v]); return Object.entries(w).map(([b, v]) => [BI[b], v]); }

export class Outfit {
  /** lod 0..2, rng seeded identically for every LOD of one look */
  constructor(lod, rng, variant) {
    this.lod = lod; this.rng = rng; this.variant = variant; this.buf = new GeoBuf(); this._layers = []; this._pending = []; this._layerH = null;
    this._body = { skin: 0x9aa08a, girth: 1, belly: 0, muscle: 0.4, gaunt: 0.4, nails: 0x6a6450 };
    this._garments = []; this._acc = []; this._face = null; this._head = {}; this.info = { lamp: null, balloon: null, tools: [], mascot: null, emissive: [] };
    const self = this;
    // low-level primitives (bound to bones). Call inside build(); they run after body/garments exist.
    this.parts = {
      capsuleBetween: (a, b, r0, r1, m, opt) => self._later(() => self._capsule(a, b, r0, r1, m, opt)),
      tube: (pts, radii, m, opt) => self._later(() => self._tube(pts, radii, m, opt)),
      box: (o) => self._later(() => self._box(o)),
      sphere: (o) => self._later(() => self._sphere(o)),
      lathe: (o) => self._later(() => self._lathe(o)),
      torusRing: (o) => self._later(() => self._torus(o)),
      extrudeOutline: (o) => self._later(() => self._extrude(o)),
      strap: (pts, width, thick, m, opt) => self._later(() => self._strap(pts, width, thick, m, opt)),
      puffy: (chain, segments, m, opt) => self._later(() => self._puffy(chain, segments, m, opt)),
      band: (o) => self._later(() => self._band(o)),
      custom: (fn) => self._later(() => fn(self)),
    };
  }
  // ---------------------------------------------------------------- recorders
  /** body: {skin, girth, belly, muscle, gaunt, nails, face:{...faceParams overrides}} */
  body(o = {}) { Object.assign(this._body, o); if (o.face) this._face = o.face; return this; }
  /** garment(kind | {sel, offset, loose, mat}, opts: {color, mat, pattern, wear, dirt, sleeve, hem, height, puff:{period,depth}, layer, folds, open}) */
  garment(kind, opts = {}) { const g = typeof kind === 'string' ? GARMENTS[kind] : kind; if (!g) throw new Error('unknown garment ' + kind); this._garments.push({ kind, g, o: opts }); return this; }
  /** register a closure to run after body+garments are built (accessories) */
  _later(fn) { this._acc.push(fn); return this; }
  seg(n) { return Math.max(3, Math.round(n / [1, 2, 3.5][this.lod])); }
  /** point along a bone at rest (t = 0 pivot … 1 tail) */
  at(bone, t = 0) { return restAt(bone, t); }
  /** outermost built surface point from `origin` along `dir` (after body + garments). Returns Vector3 or origin+dir*fallback */
  snap(origin, dir, fallback = 0.1, rad = 0.02, window = 0.06) { const o = toV(origin), d = toV(dir).normalize(); const h = this._pi ? this._pi.cast(o, d, rad * [1, 1.7, 3][this.lod], 0.6, window) : null; return h ? o.clone().addScaledVector(d, h.t) : o.clone().addScaledVector(d, fallback); } // coarser LODs have sparser surface points → wider ray
  /** skin weights of the nearest built surface point (auto binding) */
  weightsAt(p) { const n = this._pi && this._pi.nearest(p.x, p.y, p.z, 0.25); return n ? n.data : [[BI.chest, 1]]; }

  // ---------------------------------------------------------------- build (called by the variant system per LOD)
  _build() {
    const lod = this.lod, rng = this.rng, bd = this._body;
    // 1. body cage (cached across LODs by the caller through _cageCache)
    const body = this._cageCache || buildBodyCage({ girth: bd.girth, belly: bd.belly, muscle: bd.muscle, gaunt: bd.gaunt, fat: bd.fat, sex: bd.sex, age: bd.age, rng });
    this.bodyCage = body; const cage = body.cage; const N0 = cage.normals();
    this._pi = new PointIndex(0.03);
    const covered = new Set();
    // 2. garments (inner → outer)
    this._garmentSig = this._garments.map((g) => (typeof g.kind === 'string' ? g.kind : 'c') + JSON.stringify([g.o.offset, g.o.loose, g.o.sleeve, g.o.hem, g.o.height, g.o.layer, g.o.puff, g.o.opaque, g.o.collar, g.o.collarHeight, g.o.fit, g.o.stiff, g.o.weight, g.o.flare, g.o.blouse, g.o.ease, g.o.sim, g.o.cuff, g.o.stack, g.o.sag, g.o.wet, g.o.cloth])).join('|');
    const sorted = this._garments.map((g, i) => ({ ...g, i })).sort((a, b) => (a.o.layer ?? a.g.offset) - (b.o.layer ?? b.g.offset));
    let collarN = 0; const outer = new Float32Array(cage.nv); // current outermost offset per cage vertex (layering)
    const wseed = rng() * 10; this._wseed = wseed;
    // faces an opaque garment fully hides (not touching its own boundary): inner layers drop them (no hidden triangles)
    const interior = sorted.map((G) => {
      if (G.o.opaque === false) return null; const fs = []; cage.T.forEach((t, fi) => { if (G.g.sel(t, G.o)) fs.push(fi); });
      const ec = new Map(); for (const fi of fs) { const f = cage.F[fi]; for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length], key = a < b ? a * 1e6 + b : b * 1e6 + a; ec.set(key, (ec.get(key) || 0) + 1); } }
      const bv = new Set(); for (const [key, c] of ec) if (c === 1) { bv.add(Math.floor(key / 1e6)); bv.add(key % 1e6); }
      const set = new Set(); for (const fi of fs) if (!cage.F[fi].some((v) => bv.has(v))) set.add(fi); return set;
    });
    // skin hidden under clothing: faces inside the union of all opaque garments (the ring under every hem / cuff stays)
    { const U = new Set(); for (const G of sorted) { if (G.o.opaque === false) continue; cage.T.forEach((t, fi) => { if (G.g.sel(t, G.o)) U.add(fi); }); }
      const ec = new Map(); for (const fi of U) { const f = cage.F[fi]; for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length], key = a < b ? a * 1e6 + b : b * 1e6 + a; ec.set(key, (ec.get(key) || 0) + 1); } }
      const bv = new Set(); for (const [key, c] of ec) if (c === 1) { bv.add(Math.floor(key / 1e6)); bv.add(key % 1e6); }
      for (const fi of U) if (!cage.F[fi].some((v) => bv.has(v))) covered.add(fi); }
    for (let gi = 0; gi < sorted.length; gi++) {
      const G = sorted[gi];
      const hiddenByOuter = (fi) => { for (let j = gi + 1; j < sorted.length; j++) if (interior[j] && interior[j].has(fi)) return true; return false; };
      const sel = (t, fi) => G.g.sel(t, G.o) && !hiddenByOuter(fi);
      const faces = []; cage.T.forEach((t, fi) => { if (sel(t, fi)) faces.push(fi); });
      if (!faces.length) continue;
      const sub = cage.select((t, fi) => sel(t, fi));
      // offset shell: along the full-body cage normals
      const base = (G.o.offset ?? G.g.offset), loose = G.o.loose ?? G.g.loose;
      for (const [src, dst] of sub.srcMap) {
        const r = sub.R[dst], n = [N0[src * 3], N0[src * 3 + 1], N0[src * 3 + 2]];
        const wob = loose * (0.5 + 0.5 * Math.sin(r[0] * 31 + r[1] * 17 + r[2] * 23)); const capped = !globalThis.__ZCLOTH_OFF; // shells are capped to real garment thickness (a parka adds ~3-4 cm, not 6): shoulders stay ~46 cm
        let off = Math.max(capped ? Math.min(base, G.o.maxOffset ?? 0.032) : base, outer[src] > 0 ? outer[src] + 0.006 : 0) + (capped ? Math.min(wob, 0.008) : wob);
        if (G.g.boot && n[1] < -0.55) off = 0.0035; // soles stay on the ground (the sole slab adds the thickness)
        if (G.o.puff && lod > 1) off += Math.min(G.o.puff.depth ?? 0.03, 0.02);
        r[0] += n[0] * off; r[1] += n[1] * off; r[2] += n[2] * off; if (!G.g.boot) outer[src] = Math.max(outer[src], off);
      }
      // V-neck: when the two faces flanking the front midline of seg 8 are open, pull the neckline corners in and drop the
      // midline point so the opening is a V under the collar (opts.vneck = depth in metres, 0 = keep the square opening)
      let vn = G.o.vneck ?? G.g.vneck ?? 0; if (typeof vn === 'number') vn = { ring: 8, depth: vn, pull: 0.42 }; const N0r = body.torso[9];
      if (vn && (vn.depth > 0 || vn.pull < 1) && faces.some((fi) => { const t = cage.T[fi]; return t.part === 'torso' && t.seg === 8; })) {
        const Rr = body.torso[vn.ring]; const m0 = sub.srcMap.get(Rr[0]), m1 = sub.srcMap.get(Rr[1]), m11 = sub.srcMap.get(Rr[11]);
        // corners slide toward the midline vertex along the chord (x and z), pushed 4 mm out so the shell stays outside the layers below
        const pull = vn.pull ?? 0.42; if (m0 !== undefined) for (const m of [m1, m11]) if (m !== undefined) { const r = sub.R[m], r0 = sub.R[m0]; r[0] = r0[0] + (r[0] - r0[0]) * pull; r[2] = r0[2] + (r[2] - r0[2]) * pull - 0.004; r[1] += vn.depth > 0 ? 0.012 : 0; }
        if (m0 !== undefined && vn.depth > 0) { sub.R[m0][1] -= vn.depth * 0.35; sub.R[m0][2] -= 0.004; }
      }
      // collar on the neckline (shirts / jackets / coveralls by default; opts.collar: 'fold' | 'stand' | false)
      const collar = G.o.collar ?? G.g.collar; if (collar) { const top = new Set(); for (const v of N0r) { const m = sub.srcMap.get(v); if (m !== undefined) top.add(m); } addCollar(sub, collar, G.o, body, collarN, top); collarN++; }
      // LOD 0 / 1: real cloth (relaxation drape + folds + rolled hems, see cloth.js); LOD 2 keeps the cheap shell below
      if (lod <= 1 && G.o.cloth !== false && !globalThis.__ZCLOTH_OFF) {
        const det0 = G.o.detail ?? G.g.detail ?? 0; const cl0 = classify(sub); // LOD0: seams / placket / pockets / zips are real geometry (stitch.js) — only the trouser + knee details of one-piece suits stay painted
        const cspec = matSpec({ ...G.g.mat, ...G.o, color: garmentColor(G), param: (lod === 0 ? ((cl0.sh && cl0.legs) ? (det0 & 24) : 0) : det0) / 255 });
        const layer = clothSim(this, G, sub, cspec, { bodyCage: cage, wseed }); layer.sub = sub; layer.cspec = cspec; this._pending.push(layer); // shaped + emitted after the loop (hidden inner faces are culled first)
        G.built = layer.m; continue;
      }
      // rolled hems: fold each boundary edge inward (thickness), CC rounds them
      addHems(sub, N0, G.o.hemThick ?? 0.006); let sc = sub.subdivCached(SUBDIV[lod], this._cc, 'g' + G.i + '|' + this._garmentSig);
      // post: wrinkles / baffles / folds
      const spec = matSpec({ ...G.g.mat, param: (G.o.detail ?? G.g.detail ?? 0) / 255, ...G.o, color: garmentColor(G) });
      displaceGarment(sc, G, lod, rng, wseed);
      const N = sc.normals();
      const cl2 = classify(sub), wf = makeWear(this, G, fitParams(this, G, cl2), cl2, [], (this._garmentSig || '') + '|' + G.i + '|' + wseed);
      sc.emit(this.buf, () => spec, { normals: N, colFn: (sp, pc, r) => { const c = [Math.min(255, sp.col[0] * pc[0]), Math.min(255, sp.col[1] * pc[1]), Math.min(255, sp.col[2] * pc[2])]; const nn = Math.hypot(r[0], r[2] - 0.02) || 1; wf(r[0], r[1], r[2], r[0] / nn, 0.25, (r[2] - 0.02) / nn, c); return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]; } });
      for (let v = 0; v < sc.nv; v++) { const r = sc.R[v]; this._pi.add(r[0], r[1], r[2], weightsFromRec(r)); }
      if (G.g.boot) this._sole(sub, G, spec);
      G.built = sc;
    }
    if (this._pending.length) { const tc = performance.now(); cullSims(this, this._pending); for (const p0 of this._pending) { const layer = clothShape(this, p0); layer.sub = p0.sub; layer.cspec = p0.cspec; finishLayer(this, layer); const th0 = performance.now(); addRolledHems(this, layer); PROF.hem += performance.now() - th0; if (layer.G.g.boot && lod > 0) this._sole(layer.sub, layer.G, layer.cspec); } this._pending = []; PROF.cull += performance.now() - tc; this.buf.wear = null; }
    const _tg = [this.buf.triCount];
    // 2b. construction geometry (LOD0): seams, stitching, pockets, zips, buttons, waistbands … placed on the finished cloth layers
    if (lod === 0 && !globalThis.__ZCLOTH_OFF) { const t0 = performance.now(); if (PROF.trace) this._tal = []; for (let li = 0; li < this._layers.length; li++) { this.buf.wear = this._layers[li].wearFn; this.buf.wearSpec = this._layers[li].spec; decorate(this, this._layers, li); } this.buf.wear = null; PROF.detail += performance.now() - t0; if (this._tal) { PROF.log.push('D ' + this._tal.join(' ')); this._tal = null; } }
    _tg.push(this.buf.triCount);
    // skin stays visible under torn cloth: cage faces near a tear site are not "covered"
    let tearKey = ''; if (this._tearSites && this._tearSites.length) { const fc = (f) => { let x = 0, y = 0, z = 0; for (const v of f) { const r = cage.R[v]; x += r[0]; y += r[1]; z += r[2]; } return [x / f.length, y / f.length, z / f.length]; }; for (const fi of [...covered]) { const q = fc(cage.F[fi]); for (const t of this._tearSites) { if (Math.hypot(q[0] - t.c[0], q[1] - t.c[1], q[2] - t.c[2]) < t.r * 1.5 + 0.055) { covered.delete(fi); break; } } } tearKey = '|t' + this._tearSites.length + ':' + this._tearSites.map((t) => Math.round(t.c[1] * 100)).join(','); }
    // 3. body skin (covered faces removed except the ring under each hem)
    const vis = cage.select((t, fi) => !covered.has(fi));
    const sb = vis.subdivCached(SUBDIV_SKIN[lod], this._cc, 'body:' + this._garmentSig + tearKey);
    if (this._tearSites && this._tearSites.length) for (let v = 0; v < sb.nv; v++) { const r = sb.R[v]; let k = 0; for (const t of this._tearSites) { const d = Math.hypot(r[0] - t.c[0], r[1] - t.c[1], r[2] - t.c[2]); if (d < t.r * 1.9) k = Math.max(k, 1 - d / (t.r * 1.9)); } if (k > 0) { const f = 1 - 0.62 * Math.min(1, k * 1.6); r[3 + NB] *= f; r[4 + NB] *= f; r[5 + NB] *= f; r[6 + NB] *= 1 - 0.5 * Math.min(1, k * 1.6); } } // skin under torn cloth is in shadow + grubby
    if (lod < 2) sculptSkin(sb, body.build || bd); // anatomy as geometry (body.js)
    sculptHands(sb, bd.gaunt ?? 0.4, lod); // tendons, knuckles, pads, finger joints (hand.js)
    const skinSpec = matSpec({ mat: 'skin', color: bd.skin, rough: 0.6, wear: bd.decay ?? 0.5, dirt: bd.dirt ?? 0.4 });
    const nailSpec = matSpec({ mat: 'nail', color: bd.nails, rough: 0.4 });
    sb.emit(this.buf, () => skinSpec);
    for (let v = 0; v < sb.nv; v++) { const r = sb.R[v]; this._pi.add(r[0], r[1], r[2], weightsFromRec(r)); }
    // nails (skipped under gloves)
    const gloved = this._garments.some((g) => g.kind === 'gloves' || g.kind === 'mittens');
    if (!gloved && lod <= 1) buildNails(this, bd.nails);
    // (bare feet: toe separation + toenails are painted in the skin shader; the cage foot fuses the toes, see skinshade.js)
    _tg.push(this.buf.triCount);
    // 4. head
    const fp = faceParams(makeRng(strHash(this.variant?.id || 'x') ^ 0x5bd1e995), this._face || {}); // face identity is per VARIANT (both looks are the same person: head + hair geometry is built once per variant / LOD and replayed)
    this.face = fp;
    const indexNew = (n0) => { const B = this.buf; for (let i = n0; i < B.n; i++) { const si = B.SI, sw = B.SW; const w = []; for (let k = 0; k < 4; k++) if (sw[i * 4 + k] > 0) w.push([si[i * 4 + k], sw[i * 4 + k] / 255]); this._pi.add(B.P[i * 3], B.P[i * 3 + 1], B.P[i * 3 + 2], w); } };
    if (!this._noHead) {
      const h0 = this.buf.n; const hk = (this.variant?.id || 'x') + '|' + lod + '|' + JSON.stringify(this._face || {}) + '|' + skinSpec.col.join(',') + skinSpec.mat2.join(',');
      const hi = cachedBuild(this.buf, 'head|' + hk, () => buildHead(this.buf, fp, { lod, skin: skinSpec })); this.headInfo = hi; indexNew(h0);
      cachedBuild(this.buf, 'hair|' + hk + '|' + JSON.stringify({ ...(this.variant?.hair || {}), ...(this._hairStyle || {}) }) + JSON.stringify(this.variant?.facial || {}) + (this.variant?.layers?.wet ?? 0), () => buildHair(this, hi, fp)); /* strands are NOT indexed: helmets / hats snap to the skull, not to the hair volume */
    }
    // 5. accessories (each one is indexed so later gear can hug it: goggles on a helmet, straps over a pack, ...)
    for (const fn of this._acc) { const n0 = this.buf.n; fn(); indexNew(n0); }
    _tg.push(this.buf.triCount);
    // 6. dismemberment caps
    applyWounds(this); // story wounds as geometry (flesh.js), cut out of every layer at the spot
    buildCaps(this, skinSpec); // dismemberment stumps (flesh.js)
    if (PROF.trace && lod === 0) PROF.log.push('T shells=' + _tg[0] + ' details=' + (_tg[1] - _tg[0]) + ' skin=' + (_tg[2] - _tg[1]) + ' head=' + (_tg[3] - _tg[2]) + ' gear=' + (_tg[4] - _tg[3]) + ' wounds+caps=' + (this.buf.triCount - _tg[4]));
    return this.buf;
  }

  // ---------------------------------------------------------------- nails / caps / soles
  _nails(spec) {
    for (const side of ['L', 'R']) for (const fn of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
      const F = RIG.arm[side].fingers[fn]; const a = new V(...F.pts[2]), b = new V(...F.pts[3]); const d = new V().subVectors(b, a).normalize(); const fa = new V(...F.flexAxis);
      const dorsal = new V().crossVectors(d, fa).normalize(); const lat = new V().crossVectors(d, dorsal).normalize();
      const tipR = F.rad * (fn === 'thumb' ? 0.78 : 0.72);
      const c = new V().copy(a).lerp(b, 0.66).addScaledVector(dorsal, tipR * 0.93);
      const L = 0.0095 * (fn === 'thumb' ? 1.25 : fn === 'pinky' ? 0.8 : 1), Wd = tipR * 0.78;
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => new V().copy(c).addScaledVector(d, u * L * 0.5).addScaledVector(lat, v * Wd).addScaledVector(dorsal, -Math.abs(v) * tipR * 0.28));
      const ids = pts.map((q) => this.buf.vert(q, dorsal, fn + '3.' + side, spec, 1));
      this.buf.quad(ids[0], ids[1], ids[2], ids[3]); this.buf.quad(ids[0], ids[3], ids[2], ids[1]);
    }
  }
  _caps(skinSpec) {
    // stump caps (on the body side) + gib caps (on the severed part). Hidden unless the matching region is cut.
    const flesh = matSpec({ mat: 'flesh', color: 0x5a0c0c, rough: 0.25 }), bone = matSpec({ mat: 'bone', color: 0xd8cdb0, rough: 0.6 });
    const n = [14, 9, 6][this.lod];
    const cap = (bone0, t, dir, r, region, bindBone) => {
      const c = restAt(bone0, t); const d = toV(dir).normalize(); const f = frameFromDir(d);
      const rings = [[1.0, 0, skinSpec], [0.92, 0.004, flesh], [0.55, 0.01, flesh], [0.3, 0.008, bone], [0.0, 0.012, bone]];
      let prev = null;
      for (const [k, h, sp] of rings) {
        const ring = [];
        for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const jag = k > 0.9 ? 1 + 0.12 * Math.sin(a * 5 + region) : 1; const p = new V().copy(c).addScaledVector(f.x, Math.cos(a) * r * k * jag).addScaledVector(f.y, Math.sin(a) * r * k * jag).addScaledVector(d, h + (k > 0.95 ? -0.006 : 0)); ring.push(this.buf.vert(p, d, bindBone, sp, 0.9, region)); }
        if (prev) for (let i = 0; i < n; i++) { const i1 = (i + 1) % n; this.buf.quad(prev[i], prev[i1], ring[i1], ring[i]); }
        prev = ring;
      }
    };
    for (const s of ['L', 'R']) {
      const up = 'upperarm.' + s, fo = 'forearm.' + s, th = 'thigh.' + s, ca = 'calf.' + s;
      const uaDir = new V().subVectors(restTail(up), restPos(up)).normalize(), faDir = new V().subVectors(restTail(fo), restPos(fo)).normalize();
      const thDir = new V().subVectors(restTail(th), restPos(th)).normalize(), caDir = new V().subVectors(restTail(ca), restPos(ca)).normalize();
      const g = this._body.girth;
      cap(up, 0.06, uaDir.clone().negate(), 0.06 * g, REG['capShoulder' + s], 'clavicle.' + s);     // shoulder stump (faces out along −arm? cap faces away from torso)
      cap(up, 0.94, uaDir, 0.045 * g, REG['capElbow' + s], up);                                      // elbow stump on the upper arm
      cap(th, 0.1, thDir.clone().negate(), 0.085 * g, REG['capHip' + s], 'pelvis');
      cap(th, 0.95, thDir, 0.056 * g, REG['capKnee' + s], th);
      // gib caps (the severed piece's open end)
      cap(up, 0.07, uaDir.clone().negate(), 0.06 * g, REG['gibUarm' + s], up);
      cap(fo, 0.02, faDir.clone().negate(), 0.043 * g, REG['gibLarm' + s], fo);
      cap(th, 0.11, thDir.clone().negate(), 0.085 * g, REG['gibThigh' + s], th);
      cap(ca, 0.02, caDir.clone().negate(), 0.054 * g, REG['gibLleg' + s], ca);
    }
    cap('neck', 0.62, new V(0, 1, 0.1), 0.056, REG.capNeck, 'neck');
    // fix: stump caps must face OUT of the remaining body — shoulder stump faces along +arm, hip along +leg
  }
  _sole(sub, G, spec) {
    // flat rubber/leather sole + heel under each boot: outline from the foot cage bottom
    for (const s of ['L', 'R']) {
      const L = RIG.leg[s]; const sx = L.sx; const ax = L.ankle[0];
      const sole = matSpec({ mat: G.o.soleMat || 'rubber', color: G.o.soleColor ?? 0x1a1816, rough: 0.85, wear: 0.6, dirt: 0.7 });
      const outline = [];
      const N = [18, 12, 8][this.lod];
      for (let i = 0; i < N; i++) { const a = (i / N) * TAU; const ca = Math.cos(a), sa = Math.sin(a); const zc = L.ankle[2] - 0.058; const rz = ca > 0 ? 0.158 : 0.148; const rx = (0.052 + 0.006 * (ca > 0 ? -ca : 0)) * (sa * sx > 0 ? 1.05 : 1); outline.push([ax + sa * rx + sx * 0.004 * ca, zc - ca * rz]); }
      const h0 = -0.003, h1 = 0.024;
      const top = outline.map(([x, z]) => this.buf.vert([x, h1, z], [0, 1, 0], 'foot.' + s, sole, 0.6));
      const bot = outline.map(([x, z]) => this.buf.vert([x, h0, z], [0, -1, 0], z < L.ankle[2] - 0.1 ? 'toe.' + s : 'foot.' + s, sole, 1));
      const sideT = outline.map(([x, z], i) => { const a = (i / N) * TAU; return this.buf.vert([x, h1, z], [Math.sin(a), 0, -Math.cos(a)], z < L.ankle[2] - 0.1 ? 'toe.' + s : 'foot.' + s, sole, 0.9); });
      const sideB = outline.map(([x, z], i) => { const a = (i / N) * TAU; return this.buf.vert([x, h0, z], [Math.sin(a), 0, -Math.cos(a)], z < L.ankle[2] - 0.1 ? 'toe.' + s : 'foot.' + s, sole, 0.9); });
      for (let i = 0; i < N; i++) { const i1 = (i + 1) % N; if (sx > 0) this.buf.quad(sideB[i], sideB[i1], sideT[i1], sideT[i]); else this.buf.quad(sideB[i], sideT[i], sideT[i1], sideB[i1]); }
      for (let i = 1; i < N - 1; i++) { if (sx > 0) { this.buf.tri(bot[0], bot[i + 1], bot[i]); } else { this.buf.tri(bot[0], bot[i], bot[i + 1]); } }
      void top; void sub;
    }
  }

  // ---------------------------------------------------------------- primitive implementations
  _spec(m) { return matSpec(m || {}); }
  _bindAt(opt, p, fallbackBone) { if (opt && (opt.weights === 'auto' || opt.bind === 'auto')) return this.weightsAt(p); return wOf(opt && (opt.weights || opt.bone)) || wOf(fallbackBone) || [[BI.chest, 1]]; }
  /** capsule/tapered tube between two bones' pivots (or explicit points). opt: {seg, rings, rigid, weights, from:t0, to:t1, caps:true} */
  _capsule(a, b, r0, r1, m, opt = {}) {
    const A = typeof a === 'string' ? restAt(a, opt.from ?? 0) : toV(a), Bp = typeof b === 'string' ? restAt(b, opt.to ?? 0) : toV(b);
    const wa = typeof a === 'string' ? a : opt.bone, wb = typeof b === 'string' ? b : opt.bone;
    const bindFn = (t) => opt.rigid || !wa || !wb ? wOf(opt.weights || wa || opt.bone || 'chest') : [[BI[wa], 1 - t], [BI[wb], t]];
    this._tubeRaw([A, Bp], [r0, r1], this._spec(m), { ...opt, bindFn });
  }
  _tube(pts, radii, m, opt = {}) { this._tubeRaw(pts.map(toV), Array.isArray(radii) ? radii : pts.map(() => radii), this._spec(m), opt); }
  /** generic tube along a polyline; radii per point; opt: {seg, caps, bindFn(t,i)|weights|bone, auto, flat:ratio, twist} */
  _tubeRaw(pts, radii, spec, opt = {}) {
    const n = this.seg(opt.seg ?? 10), buf = this.buf; const sub = opt.sub ?? (pts.length === 2 ? Math.max(1, Math.round((opt.rings ?? 4) / [1, 1.5, 3][this.lod])) : 1);
    // resample
    const P = [], R = [], Tt = [];
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < sub; k++) { const t = k / sub; P.push(new V().copy(pts[i]).lerp(pts[i + 1], t)); R.push(radii[i] + (radii[i + 1] - radii[i]) * t); Tt.push((i + t) / (pts.length - 1)); }
    P.push(pts[pts.length - 1].clone()); R.push(radii[radii.length - 1]); Tt.push(1);
    let prevX = null; const rings = [];
    for (let i = 0; i < P.length; i++) {
      const d = new V().subVectors(P[Math.min(i + 1, P.length - 1)], P[Math.max(i - 1, 0)]).normalize();
      let x; if (prevX) { x = prevX.clone().addScaledVector(d, -prevX.dot(d)).normalize(); } else x = frameFromDir(d).x; prevX = x; const y = new V().crossVectors(d, x);
      const w = opt.bindFn ? opt.bindFn(Tt[i], i) : opt.auto ? this.weightsAt(P[i]) : wOf(opt.weights || opt.bone || 'chest');
      const ring = [];
      for (let k = 0; k < n; k++) { const a = (k / n) * TAU; const cx = Math.cos(a), cy = Math.sin(a) * (opt.flat ?? 1); const nn = new V().copy(x).multiplyScalar(cx).addScaledVector(y, cy).normalize(); const p = new V().copy(P[i]).addScaledVector(x, cx * R[i]).addScaledVector(y, cy * R[i]); ring.push(buf.vert(p, nn, w, spec, opt.ao ?? 1)); }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; buf.quad(rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]); }
    if (opt.caps !== false) for (const [end, sgn] of [[0, -1], [rings.length - 1, 1]]) {
      const i = end, d = new V().subVectors(P[Math.min(i + 1, P.length - 1)], P[Math.max(i - 1, 0)]).normalize().multiplyScalar(sgn);
      const w = opt.bindFn ? opt.bindFn(Tt[i], i) : opt.auto ? this.weightsAt(P[i]) : wOf(opt.weights || opt.bone || 'chest');
      const c = buf.vert(new V().copy(P[i]).addScaledVector(d, R[i] * (opt.capBulge ?? 0.4)), d, w, spec, opt.ao ?? 1);
      for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; if (sgn > 0) buf.tri(rings[i][k], rings[i][k1], c); else buf.tri(rings[i][k1], rings[i][k], c); }
    }
  }
  /** box: {bone|weights|bind:'auto', p:[x,y,z] centre (model space), s:[w,h,d], rot:[x,y,z] euler | quaternion, bevel, mat...} */
  _box(o) {
    const q = eulerQ(o.rot), c = toV(o.p), [w, h, d] = o.s, b = Math.min(o.bevel ?? 0.004, w * 0.3, h * 0.3, d * 0.3); const spec = this._spec(o);
    const wts = this._bindAt(o, c, o.bone);
    // chamfered box: 8 corner-ish vertices per face with bevel = simple approach: build 6 faces inset + bevel quads using a rounded cube param
    const seg = b > 0 && this.lod < 2 ? 2 : 1;
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const faces = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]]; // [axisU, axisV, axisN, sign]
    const half = [hx, hy, hz];
    for (const [au, av, an, sg] of faces) {
      const N = seg === 2 ? 3 : 1; const grid = [];
      for (let i = 0; i <= N; i++) { const row = []; for (let j = 0; j <= N; j++) {
        const u = N === 1 ? (i ? 1 : -1) : [-1, -1 + 2 * (b / half[au]), 1 - 2 * (b / half[au]), 1][i] ?? 1, v = N === 1 ? (j ? 1 : -1) : [-1, -1 + 2 * (b / half[av]), 1 - 2 * (b / half[av]), 1][j] ?? 1;
        const pl = [0, 0, 0]; pl[au] = u * half[au]; pl[av] = v * half[av]; pl[an] = sg * half[an];
        // rounded edge: pull edge vertices inward along the normal (bevel)
        const eu = N === 3 && (i === 0 || i === 3), ev = N === 3 && (j === 0 || j === 3); if (eu || ev) pl[an] -= sg * b * (eu && ev ? 1 : 0.7);
        const nl = [0, 0, 0]; nl[an] = sg; if (eu) nl[au] = u * 0.7; if (ev) nl[av] = v * 0.7;
        const p = new V(pl[0], pl[1], pl[2]).applyQuaternion(q).add(c); const nn = new V(nl[0], nl[1], nl[2]).normalize().applyQuaternion(q);
        row.push(this.buf.vert(p, nn, wts, spec, o.ao ?? 1));
      } grid.push(row); }
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = grid[i][j], bb = grid[i + 1][j], cc = grid[i + 1][j + 1], dd = grid[i][j + 1]; if ((sg > 0) === ((au + 1) % 3 === av)) this.buf.quad(a, bb, cc, dd); else this.buf.quad(a, dd, cc, bb); }
    }
  }
  /** sphere/ellipsoid: {p, r | scale:[x,y,z], rot, seg, bone|weights, hemi:true (upper half only)} */
  _sphere(o) {
    const q = eulerQ(o.rot), c = toV(o.p), sc = o.scale ? toV(o.scale) : new V(1, 1, 1).multiplyScalar(o.r ?? 0.05); const n = this.seg(o.seg ?? 12), m = Math.max(2, Math.round(n / 2)); const spec = this._spec(o); const wts = this._bindAt(o, c, o.bone);
    const rows = [];
    for (let i = 0; i <= m; i++) { const ph = (o.hemi ? 0.5 : 0) * Math.PI / 2 * 0 + (o.hemi ? (i / m) * Math.PI / 2 : -Math.PI / 2 + (i / m) * Math.PI); const row = []; for (let k = 0; k < n; k++) { const a = (k / n) * TAU; const l = new V(Math.cos(ph) * Math.cos(a), Math.sin(ph), Math.cos(ph) * Math.sin(a)); const p = new V(l.x * sc.x, l.y * sc.y, l.z * sc.z).applyQuaternion(q).add(c); const nn = new V(l.x / sc.x, l.y / sc.y, l.z / sc.z).normalize().applyQuaternion(q); row.push(this.buf.vert(p, nn, wts, spec, o.ao ?? 1)); } rows.push(row); }
    for (let i = 0; i < m; i++) for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; this.buf.quad(rows[i][k], rows[i + 1][k], rows[i + 1][k1], rows[i][k1]); }
  }
  /** lathe: {p (base centre), profile:[[r,y],...] listed bottom → top (outward-facing; reverse the list for an inward-facing
   *  surface), rot (axis = local +Y), seg, bone|weights, scale:[sx,sz] (ellipse), arc, arc0, double (both sides)} */
  _lathe(o) {
    const q = eulerQ(o.rot), c = toV(o.p), n = this.seg(o.seg ?? 16), spec = this._spec(o); const pr = o.profile; const sx = o.scale?.[0] ?? 1, sz = o.scale?.[1] ?? 1;
    const arc = o.arc ?? TAU, closed = arc >= TAU - 1e-6; const cols = closed ? n : n + 1;
    const rows = pr.map(([r, y], i) => {
      const dr = (pr[Math.min(i + 1, pr.length - 1)][0] - pr[Math.max(i - 1, 0)][0]), dy = (pr[Math.min(i + 1, pr.length - 1)][1] - pr[Math.max(i - 1, 0)][1]);
      const ln = Math.hypot(dr, dy) || 1; const nr = dy / ln, ny = -dr / ln;
      const row = []; for (let k = 0; k < cols; k++) { const a = (o.arc0 ?? 0) + (k / n) * arc; const cx = Math.cos(a) * sx, cz = Math.sin(a) * sz; const p = new V(cx * r, y, cz * r).applyQuaternion(q).add(c); const nn = new V(Math.cos(a) * nr / sx, ny, Math.sin(a) * nr / sz).normalize().applyQuaternion(q); row.push(this.buf.vert(p, nn, this._bindAt(o, p, o.bone), spec, (o.aoFn ? o.aoFn(i / (pr.length - 1)) : o.ao ?? 1))); }
      return row;
    });
    // winding matches the profile normals: a profile listed bottom → top (three.js LatheGeometry convention) faces outward
    for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < n; k++) { const k1 = closed ? (k + 1) % n : k + 1; this.buf.quad(rows[i][k], rows[i + 1][k], rows[i + 1][k1], rows[i][k1]); if (o.double) this.buf.quad(rows[i][k], rows[i][k1], rows[i + 1][k1], rows[i + 1][k]); }
  }
  /** torus ring: {p, R (ring radius), r (tube radius), rot (ring axis = local Y), seg, tseg, arc, arc0, flat (tube squash), bone|weights} */
  _torus(o) {
    const q = eulerQ(o.rot), c = toV(o.p), n = this.seg(o.seg ?? 16), m = Math.max(3, this.seg(o.tseg ?? 6)), spec = this._spec(o); const arc = o.arc ?? TAU, closed = arc >= TAU - 1e-6; const cols = closed ? n : n + 1;
    const rows = [];
    for (let k = 0; k < cols; k++) { const a = (o.arc0 ?? 0) + (k / n) * arc; const row = []; for (let j = 0; j < m; j++) { const b = (j / m) * TAU; const nl = new V(Math.cos(a) * Math.cos(b), Math.sin(b) * (o.flat ?? 1), Math.sin(a) * Math.cos(b)); const p = new V(Math.cos(a) * (o.R + o.r * Math.cos(b)), o.r * Math.sin(b) * (o.flat ?? 1), Math.sin(a) * (o.R + o.r * Math.cos(b))).applyQuaternion(q).add(c); row.push(this.buf.vert(p, nl.normalize().applyQuaternion(q), this._bindAt(o, p, o.bone), spec, o.ao ?? 1)); } rows.push(row); }
    for (let k = 0; k < (closed ? n : n); k++) { const k1 = closed ? (k + 1) % n : k + 1; for (let j = 0; j < m; j++) { const j1 = (j + 1) % m; this.buf.quad(rows[k][j], rows[k][j1], rows[k1][j1], rows[k1][j]); } }
  }
  /** extrude a 2D outline: {p, outline:[[x,y],...] (CCW), depth, rot (outline in local XY, extrusion along local +Z), bevel, bone} */
  _extrude(o) {
    const q = eulerQ(o.rot), c = toV(o.p), spec = this._spec(o), ol = o.outline, n = ol.length, dz = o.depth ?? 0.01; const wts = (p) => this._bindAt(o, p, o.bone);
    const P = (x, y, z) => new V(x, y, z).applyQuaternion(q).add(c);
    const front = [], back = [], sideF = [], sideB = [];
    const nz = new V(0, 0, 1).applyQuaternion(q), nzb = nz.clone().negate();
    for (let i = 0; i < n; i++) { const [x, y] = ol[i]; const pf = P(x, y, dz / 2), pb = P(x, y, -dz / 2); front.push(this.buf.vert(pf, nz, wts(pf), spec, o.ao ?? 1)); back.push(this.buf.vert(pb, nzb, wts(pb), spec, o.ao ?? 1)); const [x0, y0] = ol[(i + n - 1) % n], [x1, y1] = ol[(i + 1) % n]; const nn = new V(y1 - y0, -(x1 - x0), 0).normalize().applyQuaternion(q); sideF.push(this.buf.vert(pf, nn, wts(pf), spec, o.ao ?? 1)); sideB.push(this.buf.vert(pb, nn, wts(pb), spec, o.ao ?? 1)); }
    // caps: ear-clipping-free fan (outline assumed star-shaped w.r.t. its centroid)
    const cx = ol.reduce((a, p) => a + p[0], 0) / n, cy = ol.reduce((a, p) => a + p[1], 0) / n; const cf = this.buf.vert(P(cx, cy, dz / 2), nz, wts(c), spec, o.ao ?? 1), cb = this.buf.vert(P(cx, cy, -dz / 2), nzb, wts(c), spec, o.ao ?? 1);
    for (let i = 0; i < n; i++) { const i1 = (i + 1) % n; this.buf.tri(front[i], front[i1], cf); this.buf.tri(back[i1], back[i], cb); this.buf.quad(sideB[i], sideB[i1], sideF[i1], sideF[i]); }
  }
  /** strap: flat band through points (model space) hugging the built surface; {auto binding}; opt: {snap:true, lift, bind} */
  _strap(pts, width, thick, m, opt = {}) {
    const spec = this._spec(m); const P = pts.map(toV); const out = [];
    // densify
    for (let i = 0; i < P.length - 1; i++) { const L = P[i].distanceTo(P[i + 1]); const k = Math.max(1, Math.ceil(L / (0.03 * [1, 1.6, 3][this.lod]))); for (let j = 0; j < k; j++) out.push(new V().copy(P[i]).lerp(P[i + 1], j / k)); }
    out.push(P[P.length - 1].clone());
    // snap each point outward from the body core (x=0 axis at its height, or the nearest limb axis) to the surface + lift
    const lift = opt.lift ?? 0.004; const S = out.map((p) => { if (opt.snap === false) return p; const core = opt.coreFn ? opt.coreFn(p) : new V(opt.coreX ?? 0, p.y, opt.coreZ ?? 0.02); const dir = new V().subVectors(p, core); if (dir.lengthSq() < 1e-6) return p; dir.normalize(); const s = this.snap(core, dir, p.distanceTo(core), 0.018); return s.addScaledVector(dir, lift + thick * 0.5); });
    const L = [], R = [], LB = [], RB = [];
    for (let i = 0; i < S.length; i++) {
      const t = new V().subVectors(S[Math.min(i + 1, S.length - 1)], S[Math.max(i - 1, 0)]).normalize();
      const core = opt.coreFn ? opt.coreFn(S[i]) : new V(opt.coreX ?? 0, S[i].y, opt.coreZ ?? 0.02); const nOut = new V().subVectors(S[i], core); nOut.addScaledVector(t, -nOut.dot(t)).normalize();
      const side = new V().crossVectors(t, nOut).normalize();
      const w = opt.bindFn ? opt.bindFn(i / (S.length - 1)) : this.weightsAt(S[i]);
      const a = new V().copy(S[i]).addScaledVector(side, width / 2), b = new V().copy(S[i]).addScaledVector(side, -width / 2);
      L.push(this.buf.vert(a, nOut, w, spec, 0.9)); R.push(this.buf.vert(b, nOut, w, spec, 0.9));
      LB.push(this.buf.vert(a.clone().addScaledVector(nOut, -thick), side, w, spec, 0.7)); RB.push(this.buf.vert(b.clone().addScaledVector(nOut, -thick), side.clone().negate(), w, spec, 0.7));
      if (i > 0) { this.buf.quad(L[i - 1], R[i - 1], R[i], L[i]); this.buf.quad(LB[i - 1], L[i - 1], L[i], LB[i]); this.buf.quad(R[i - 1], RB[i - 1], RB[i], R[i]); }
    }
    return S;
  }
  /** band around the torso/limb at height y hugging the surface: {y, height, thick, mat, center:[x,z], tilt, lift,
   *  window (how far past the first surface hit to look for outer layers; small = hug the innermost layer)} */
  _band(o) {
    const n = this.seg(o.seg ?? 28), spec = this._spec(o), cx = o.center?.[0] ?? 0, cz = o.center?.[1] ?? 0.02; const hgt = o.height ?? 0.04, th = o.thick ?? 0.006;
    const rowsTop = [], rowsBot = [], rowsTopO = [], rowsBotO = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU; const dir = new V(Math.sin(a), 0, -Math.cos(a)); const y = o.y + (o.tilt ?? 0) * Math.cos(a);
      const core = new V(cx, y, cz); const s = this.snap(core, dir, 0.15, 0.02, o.window ?? 0.06).addScaledVector(dir, (o.lift ?? 0.003)); const p0 = s.clone(); const wts = this.weightsAt(p0);
      const top = p0.clone().setY(y + hgt / 2), bot = p0.clone().setY(y - hgt / 2);
      rowsTopO.push(this.buf.vert(top.clone().addScaledVector(dir, th), dir, wts, spec, 1)); rowsBotO.push(this.buf.vert(bot.clone().addScaledVector(dir, th), dir, wts, spec, 1));
      rowsTop.push(this.buf.vert(top, new V(0, 1, 0), wts, spec, 0.8)); rowsBot.push(this.buf.vert(bot, new V(0, -1, 0), wts, spec, 0.8));
    }
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; this.buf.quad(rowsBotO[k], rowsBotO[k1], rowsTopO[k1], rowsTopO[k]); this.buf.quad(rowsTop[k], rowsTopO[k], rowsTopO[k1], rowsTop[k1]); this.buf.quad(rowsBot[k], rowsBot[k1], rowsBotO[k1], rowsBotO[k]); }
    return { y: o.y };
  }
  /** puffy tube along a bone chain (parka sleeves etc): chain ['upperarm.L','forearm.L'], segments per bone; opt {r:[r0,r1], baffle, depth} */
  _puffy(chain, segments = 4, m, opt = {}) {
    const pts = [], radii = []; const r0 = opt.r?.[0] ?? 0.075, r1 = opt.r?.[1] ?? 0.06;
    chain.forEach((b, ci) => { for (let k = 0; k < segments; k++) { const t = k / segments; pts.push(restAt(b, t)); radii.push(r0 + (r1 - r0) * ((ci + t) / chain.length)); } });
    pts.push(restTail(chain[chain.length - 1])); radii.push(r1);
    const bind = (t) => { const f = t * chain.length; const i = Math.min(chain.length - 1, Math.floor(f)); const u = f - i; const w = [[BI[chain[i]], 1 - u * 0.5]]; if (i + 1 < chain.length) w.push([BI[chain[i + 1]], u * 0.5]); return w; };
    // radius modulation per point (baffles): alternate fat / thin rings
    const R2 = radii.map((r, i) => r * (i % 2 === 0 ? 1 : 1 - (opt.depth ?? 0.12)));
    this._tubeRaw(pts, R2, this._spec(m), { seg: opt.seg ?? 14, bindFn: bind, sub: 1, caps: false });
  }
}
function weightsFromRec(r) { const out = []; for (let b = 0; b < NB; b++) { const w = r[3 + b]; if (w > 0.02) out.push([b, w]); } return out; }

// collar: extra cage rows on the neckline boundary (the top edge of the garment around the back/sides of the neck).
//  'stand': two rows rising and leaning in against the neck (parka / work-jacket stand collar);
//  'fold' : a low stand + a turned-down flap lying over the shoulders, with pointed collar tips at the front.
// The flap faces are wound reversed so their front side faces outward (a folded sheet, single-sided rendering).
function addCollar(sub, kind, o, body, layer = 0, top = null) {
  const key = (a, b) => (a < b ? a * 1e6 + b : b * 1e6 + a); const ec = new Map();
  for (const f of sub.F) for (let k = 0; k < f.length; k++) { const kk = key(f[k], f[(k + 1) % f.length]); ec.set(kk, (ec.get(kk) || 0) + 1); }
  // neck axis + radius from the body cage's N1 ring (y ≈ 1.53)
  const ring = body.torso[10], CR = body.cage.R; let cx = 0, cz = 0; for (const v of ring) { cx += CR[v][0]; cz += CR[v][2]; } cx /= ring.length; cz /= ring.length;
  const neckR = (dx, dz) => { let best = 0.06, bd = -2; for (const v of ring) { const vx = CR[v][0] - cx, vz = CR[v][2] - cz, l = Math.hypot(vx, vz) || 1; const d = (vx * dx + vz * dz) / l; if (d > bd) { bd = d; best = l; } } return best; };
  // collar edges: boundary edges along the garment's top ring (vertices that came from the body's N0 ring)
  const near = (v) => top ? top.has(v) : sub.R[v][1] > 1.46 && Math.hypot(sub.R[v][0] - cx, sub.R[v][2] - cz) < 0.19;
  const edges = [];
  for (const f of sub.F) for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; if (ec.get(key(a, b)) === 1 && near(a) && near(b)) edges.push([a, b]); }
  if (!edges.length) return;
  const use = new Map(); for (const [a, b] of edges) { use.set(a, (use.get(a) || 0) + 1); use.set(b, (use.get(b) || 0) + 1); }
  // outer garments' collars sit further out and a little higher so they cover the collars underneath
  const H = (o.collarHeight ?? (kind === 'stand' ? 0.055 : 0.032)) + layer * 0.006, gap = (o.collarGap ?? 0.013) + layer * 0.009; const made = new Map();
  const cv = (v, lvl) => {
    const kk = v * 4 + lvl; let id = made.get(kk); if (id !== undefined) return id;
    const r = sub.R[v]; let dx = r[0] - cx, dz = r[2] - cz; const dist = Math.hypot(dx, dz) || 1; dx /= dist; dz /= dist; const rn = neckR(dx, dz) + gap; const end = use.get(v) === 1;
    let rad, y, wk;
    if (kind === 'stand') { if (lvl === 1) { rad = dist + (rn - dist) * 0.7; y = r[1] + H * 0.55; wk = 0.15; } else { rad = rn; y = r[1] + H; wk = 0.3; } }
    else if (lvl === 1) { rad = rn; y = r[1] + H; wk = 0.25; }
    else { rad = Math.max(rn + 0.022, dist + 0.008); y = r[1] + 0.003 - (end ? 0.028 : 0); wk = 0; }
    const p = [cx + dx * rad, y, cz + dz * rad]; if (end && kind === 'fold' && lvl === 2) { p[2] -= 0.018; }
    const w = new Float64Array(NB); for (let b = 0; b < NB; b++) w[b] = r[3 + b] * (1 - wk); w[BI.neck] += wk;
    id = sub.v(p, w, [r[3 + NB], r[4 + NB], r[5 + NB], lvl === 2 && kind === 'fold' ? 0.8 : 0.92, r[7 + NB]]); made.set(kk, id); return id;
  };
  for (const [a, b] of edges) {
    sub.f([b, a, cv(a, 1), cv(b, 1)], { part: 'collar' });
    if (kind === 'stand') sub.f([cv(b, 1), cv(a, 1), cv(a, 2), cv(b, 2)], { part: 'collar' });
    else sub.f([cv(b, 2), cv(a, 2), cv(a, 1), cv(b, 1)], { part: 'collar', flap: true }); // reversed: outer side of the turned-down flap
  }
}
// rolled hem: for every boundary edge of the (sub-)cage, add an inward fold face
function addHems(sub, N0, thick) {
  const ec = new Map(); const key = (a, b) => (a < b ? a * 1e6 + b : b * 1e6 + a);
  sub.F.forEach((f) => { for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; const kk = key(a, b); const e = ec.get(kk); if (e) e.c++; else ec.set(kk, { a, b, c: 1 }); } });
  // directed boundary edges (keep face winding direction)
  const inner = new Map();
  const nrm = sub.normals();
  const inV = (v) => { let i = inner.get(v); if (i === undefined) { const r = sub.R[v]; const p = [r[0] - nrm[v * 3] * thick, r[1] - nrm[v * 3 + 1] * thick, r[2] - nrm[v * 3 + 2] * thick]; const w = new Float64Array(NB); for (let b = 0; b < NB; b++) w[b] = r[3 + b]; i = sub.v(p, w, [0.9, 0.9, 0.9, 0.6, 1]); inner.set(v, i); } return i; };
  const faces = sub.F.slice();
  for (const f of faces) for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; if (ec.get(key(a, b)).c !== 1) continue; sub.f([b, a, inV(a), inV(b)], { part: 'hem' }); }
  void N0;
}
// wrinkles, fabric sag, joint folds, puffy baffles (post-subdivision, along normals)
function displaceGarment(sc, G, lod, rng, seed) {
  // one wrinkle field per look (seed shared by all garments) so stacked layers wrinkle coherently and never cross
  if (lod === 2) return; const N = sc.normals(); const amp = (G.o.wrinkle ?? 1) * 0.0022; const puff = G.o.puff;
  for (let v = 0; v < sc.nv; v++) {
    const r = sc.R[v]; const x = r[0], y = r[1], z = r[2];
    let d = (Math.sin(x * 61 + seed) * Math.sin(y * 47 + z * 29) + Math.sin(y * 23 - x * 17 + seed * 2) * 0.6) * amp;
    // joint folds: bunching near elbows / knees / waist
    const nearElbow = Math.max(jointK(r, 'forearm.L'), jointK(r, 'forearm.R')), nearKnee = Math.max(jointK(r, 'calf.L'), jointK(r, 'calf.R'));
    d += (nearElbow + nearKnee) * Math.sin(y * 150 + x * 40) * 0.0035;
    if (puff) { const per = puff.period ?? 0.11; const ph = (y / per) * TAU; d += (Math.pow(0.5 + 0.5 * Math.cos(ph), 0.6) - 0.6) * (puff.bulge ?? 0.018); }
    r[0] += N[v * 3] * d; r[1] += N[v * 3 + 1] * d; r[2] += N[v * 3 + 2] * d;
  }
}
function jointK(r, bone) { const b = BI[bone]; const w = r[3 + b], wp = r[3 + RIG.bones[b].parent]; return Math.min(w, wp) * 2; }
export { HEAD_CENTER, EYE, PAT, MID, REG, restAt, restPos, restTail };
