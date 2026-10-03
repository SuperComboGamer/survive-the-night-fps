// High-level gear helpers built on the low-level outfit primitives (parts.js). Each is `o.<name>(opts)` inside a variant's
// build(o, rng). All positions are rest model space (1.75 m body, facing −Z). Dimensions follow real equipment.
import * as THREE from 'three';
import { Outfit } from './parts.js';
import { BI, RIG, HEAD_CENTER, restAt, restPos, restTail } from './rig.js';
import { REG } from './mesh.js';
import { installGearKit } from './gearkit.js';
// headwear geometry goes into the 'hat' region (variantDef.gearDrop.hat = chance a spawn has it knocked off)
const hatOn = (o) => { o.info.hasHat = true; o._later(() => { o.buf.forceRegion = REG.hat; }); }, hatOff = (o) => o._later(() => { o.buf.forceRegion = -1; });

const V = THREE.Vector3; const TAU = Math.PI * 2; const HC = HEAD_CENTER;
const P = Outfit.prototype;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- headwear
/** Miner's hard helmet (1930-60s): smooth dome, ridge along the crown, short all-round brim with a front peak, lamp bracket.
 *  opts: {color, mat:'paint'|'plastic'|'metal', wear, dirt, ridge:true, brim:0.035, peak:0.05, lamp:{...}|false} */
P.minerHelmet = function (opts = {}) {
  hatOn(this);
  const m = { mat: opts.mat || 'paint', color: opts.color ?? 0x2a2a28, rough: opts.rough ?? 0.4, wear: opts.wear ?? 0.55, dirt: opts.dirt ?? 0.55, param: opts.metalBase ? 1 : 0 };
  const c = [HC.x, HC.y + 0.012, HC.z + 0.012];
  // dome: lathe profile (r, y) from the rim up to the crown; elliptical footprint (narrower sideways)
  const prof = []; const N = 9; for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI / 2; prof.push([Math.max(0.002, Math.cos(a) * 0.113), Math.sin(a) * 0.118 - 0.01]); }
  this.parts.lathe({ bone: 'head', p: c, profile: prof, scale: [0.87, 1.06], seg: 28, ...m });
  // inner lip (thickness) + brim (flat, peak at the front)
  const brim = opts.brim ?? 0.03, peak = opts.peak ?? 0.05;
  this.parts.custom((o) => { const n = o.seg(32); const spec = o._spec(m); const buf = o.buf; const rings = [];
    const R = (a, k) => { const front = Math.max(0, -Math.cos(a)); const ex = brim + peak * Math.pow(front, 3); return [0.113 * (1 + k * ex / 0.113)]; };
    for (const [k, dy] of [[0, -0.01], [1, -0.022], [1, -0.03], [0, -0.019]]) { const ring = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const r = R(a, k)[0]; const x = Math.sin(a) * r * 0.87, z = -Math.cos(a) * r * 1.06; const p = new V(c[0] + x, c[1] + dy - (k ? Math.max(0, -Math.cos(a)) * 0.012 : 0), c[2] + z); ring.push(buf.vert(p, new V(0, dy < -0.02 ? -1 : 1, 0), 'head', spec, dy < -0.02 ? 0.5 : 0.9)); } rings.push(ring); }
    for (let r = 0; r < rings.length; r++) { const A = rings[r], B = rings[(r + 1) % rings.length]; for (let i = 0; i < n; i++) { const i1 = (i + 1) % n; buf.quad(A[i], A[i1], B[i1], B[i]); } } });
  if (opts.ridge !== false) { // raised comb along the crown, front to back, following the dome
    const pts = [], rad = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI * 0.42 + (i / 10) * Math.PI * 0.84; const y = Math.cos(a) * 0.118 - 0.01 + 0.006, z = Math.sin(a) * 0.113 * 1.06; pts.push(new V(c[0], c[1] + y, c[2] + z)); rad.push(0.009 * (1 - Math.abs(i - 5) / 12)); }
    this.parts.tube(pts, rad, m, { bone: 'head', seg: 6, flat: 0.55 }); }
  // lamp bracket plate at the front
  this.parts.box({ bone: 'head', p: [0, c[1] + 0.055, c[2] - 0.118], s: [0.05, 0.05, 0.012], rot: [-0.35, 0, 0], mat: 'metal', color: 0x4a4640, rough: 0.5, wear: 0.7, bevel: 0.003 });
  this.info.helmetY = HC.y + 0.035;
  if (opts.lamp !== false) this.capLamp({ ...(opts.lamp || {}) });
  hatOff(this); return this;
};
/** Cap lamp on the helmet front + cable + belt battery. Declares the runtime lamp (variantDef.lamp should match).
 *  opts: {color (light), housing, battery:true, cable:true} */
P.capLamp = function (opts = {}) {
  const lp = new V(0, HC.y + 0.075, HC.z - 0.127); const dir = new V(0, -0.2, -1).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), dir); const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  const house = { mat: 'metal', color: opts.housing ?? 0x3c3a36, rough: 0.35, wear: 0.6, dirt: 0.5 };
  // housing (cylinder along dir), bezel ring, lens + bulb (emissive)
  this.parts.lathe({ bone: 'head', p: lp.clone().addScaledVector(dir, -0.045), profile: [[0.012, 0], [0.027, 0.005], [0.031, 0.02], [0.034, 0.042], [0.036, 0.047]], rot: [e.x, e.y, e.z], seg: 18, ...house });
  this.parts.torusRing({ bone: 'head', p: lp.clone().addScaledVector(dir, 0.003), R: 0.033, r: 0.005, rot: [e.x, e.y, e.z], seg: 18, tseg: 5, mat: 'metal', color: 0x8a8476, rough: 0.3, wear: 0.5 });
  this.parts.lathe({ bone: 'head', p: lp.clone().addScaledVector(dir, 0.0), profile: [[0.031, 0], [0.018, 0.004], [0.0, 0.005]], rot: [e.x, e.y, e.z], seg: 18, mat: 'emissive', color: opts.lensColor ?? 0xfff0d0, emissive: opts.emissive ?? 9 });
  // cable: lamp back → over the helmet side → back of the neck → down the back → battery on the belt
  const cable = { mat: 'rubber', color: 0x161514, rough: 0.6 };
  if (opts.cable !== false) this.parts.custom((o) => {
    const pts = [lp.clone().addScaledVector(dir, -0.05), new V(0.03, HC.y + 0.06, HC.z - 0.1), new V(0.075, HC.y + 0.04, HC.z + 0.0), new V(0.07, HC.y + 0.015, HC.z + 0.09), new V(0.05, 1.56, 0.085), new V(0.07, 1.42, 0.12), new V(0.09, 1.25, 0.13), new V(0.1, 1.1, 0.13), new V(0.1, 1.02, 0.135)];
    // push the lower points onto the (clothed) back surface
    for (let i = 4; i < pts.length; i++) { const core = new V(0, pts[i].y, 0.02); const d = new V().subVectors(pts[i], core).normalize(); pts[i] = o.snap(core, d, 0.14).addScaledVector(d, 0.009); }
    const bones = ['head', 'head', 'head', 'head', 'neck', 'chest', 'spine2', 'spine1', 'pelvis'];
    o._tubeRaw(pts, pts.map(() => 0.0055), o._spec(cable), { seg: 6, sub: 3, bindFn: (t) => { const f = t * (bones.length - 1); const i = Math.floor(f), u = f - i; const a = BI[bones[i]], b = BI[bones[Math.min(bones.length - 1, i + 1)]]; return [[a, 1 - u], [b, u]]; } });
  });
  if (opts.battery !== false) this.parts.box({ bind: 'auto', p: [0.1, 1.0, 0.16], s: [0.14, 0.11, 0.05], rot: [0, 0.35, 0], mat: 'metal', color: 0x2e2c28, rough: 0.5, wear: 0.6, dirt: 0.7, bevel: 0.008 });
  this.info.lamp = { bone: 'head', pos: [lp.x, lp.y, lp.z], dir: [dir.x, dir.y, dir.z] };
  return this;
};
/** Modern full-brim hard hat (foreman). opts {color, lamp} */
P.hardHat = function (opts = {}) {
  hatOn(this);
  const m = { mat: 'plastic', color: opts.color ?? 0xe8e4d8, rough: 0.35, wear: opts.wear ?? 0.5, dirt: opts.dirt ?? 0.5, param: opts.cracked ?? 0 };
  const c = [HC.x, HC.y + 0.015, HC.z + 0.008];
  const prof = []; for (let i = 0; i <= 9; i++) { const a = (i / 9) * Math.PI / 2; prof.push([Math.max(0.002, Math.cos(a) * 0.112), Math.sin(a) * 0.125 - 0.008]); }
  this.parts.lathe({ bone: 'head', p: c, profile: prof, scale: [0.88, 1.08], seg: 28, ...m });
  this.parts.lathe({ bone: 'head', p: [c[0], c[1] - 0.012, c[2]], profile: [[0.11, -0.01], [0.148, -0.018], [0.152, -0.012], [0.14, -0.004], [0.112, 0.004]], scale: [0.86, 1.08], seg: 28, ...m });
  for (const x of [-0.034, 0, 0.034]) { const pts = [], rad = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI * 0.4 + (i / 10) * Math.PI * 0.8; const R = Math.sqrt(Math.max(0, 1 - (x / 0.1) ** 2)); pts.push(new V(c[0] + x, c[1] + Math.cos(a) * 0.125 * R - 0.008 + 0.005, c[2] + Math.sin(a) * 0.112 * 1.08 * R)); rad.push(0.0065 * (1 - Math.abs(i - 5) / 14)); } this.parts.tube(pts, rad, m, { bone: 'head', seg: 6, flat: 0.6 }); }
  this.info.helmetY = HC.y + 0.04; hatOff(this); return this;
};
/** knit beanie / wool cap. opts {color, fold:true, pompom} */
P.beanie = function (opts = {}) {
  hatOn(this);
  const m = { mat: 'cloth', pattern: 'knit', color: opts.color ?? 0x7a2a22, rough: 0.95, dirt: 0.3 };
  const c = [HC.x, HC.y + 0.0, HC.z + 0.01]; const prof = []; for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; prof.push([Math.max(0.002, Math.cos(a) * 0.098), Math.sin(a) * 0.105 + 0.012]); }
  this.parts.lathe({ bone: 'head', p: c, profile: prof, scale: [0.9, 1.08], seg: 24, ...m });
  if (opts.fold !== false) this.parts.torusRing({ bone: 'head', p: [c[0], c[1] + 0.018, c[2]], R: 0.1, r: 0.014, scale: [1, 1], rot: [0, 0, 0], seg: 24, tseg: 6, ...m, flat: 1.4 });
  if (opts.pompom) this.parts.sphere({ bone: 'head', p: [c[0], c[1] + 0.122, c[2]], r: 0.03, seg: 10, mat: 'fur', color: opts.pompom, rough: 1 });
  hatOff(this); return this;
};
/** sou'wester (oilskin rain hat): crown + wide sloping brim, longer at the back */
P.souwester = function (opts = {}) {
  hatOn(this);
  const m = { mat: 'cloth', pattern: 'oilskin', color: opts.color ?? 0xc8a020, rough: 0.35, dirt: 0.4, wear: 0.4 };
  const c = [HC.x, HC.y + 0.012, HC.z + 0.012];
  const prof = []; for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; prof.push([Math.max(0.002, Math.cos(a) * 0.114), Math.sin(a) * 0.108 - 0.004]); }
  this.parts.lathe({ bone: 'head', p: c, profile: prof, scale: [0.9, 1.06], seg: 26, ...m });
  this.parts.custom((o) => { const n = o.seg(32), spec = o._spec(m); const rings = [];
    for (const [k, dy] of [[0, -0.004], [1, -0.03], [1, -0.036], [0, -0.012]]) { const ring = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const back = Math.max(0, -Math.cos(a)); const w = 0.114 + k * (0.045 + back * 0.06); const p = new V(c[0] + Math.sin(a) * w * 0.9, c[1] + dy - k * back * 0.05, c[2] - Math.cos(a) * w * 1.06); ring.push(o.buf.vert(p, new V(0, 1, 0), 'head', spec, 0.8)); } rings.push(ring); }
    for (let r = 0; r < 4; r++) { const A = rings[r], B = rings[(r + 1) % 4]; for (let i = 0; i < n; i++) { const i1 = (i + 1) % n; o.buf.quad(A[i], A[i1], B[i1], B[i]); } } });
  hatOff(this); return this;
};
/** fur-trimmed hood (down on the shoulders or up around the face). opts {color, fur, up} */
P.hood = function (opts = {}) {
  const m = { mat: 'cloth', pattern: opts.pattern || 'ripstop', color: opts.color ?? 0x2a4a7a, rough: 0.7, dirt: 0.3 };
  if (opts.up) {
    const c = [HC.x, HC.y - 0.005, HC.z + 0.02]; const prof = []; for (let i = 0; i <= 9; i++) { const a = -0.55 + (i / 9) * (Math.PI / 2 + 0.55); prof.push([Math.max(0.002, Math.cos(a) * 0.132), Math.sin(a) * 0.13]); }
    this.parts.lathe({ bone: 'head', p: c, profile: prof, scale: [0.95, 1.1], seg: 26, arc: TAU * 0.7, arc0: Math.PI * 0.65 - Math.PI / 2 + 0.25, double: true, ...m });
    if (opts.fur !== false) this.parts.torusRing({ bone: 'head', p: [0, HC.y - 0.02, HC.z - 0.085], R: 0.1, r: 0.022, rot: [Math.PI / 2 - 0.25, 0, 0], scale: [1, 1], seg: 22, tseg: 7, mat: 'fur', color: opts.fur ?? 0x9a8a70, rough: 1 });
  } else {
    // hood down: bunched collar roll around the back of the neck
    this.parts.torusRing({ bone: 'chest', p: [0, 1.47, 0.045], R: 0.1, r: 0.04, rot: [0.25, 0, 0], arc: Math.PI * 1.25, arc0: -Math.PI * 0.12, seg: 20, tseg: 8, weights: { chest: 0.7, neck: 0.3 }, ...m, flat: 1.1 });
    if (opts.fur) this.parts.torusRing({ bone: 'chest', p: [0, 1.5, 0.06], R: 0.09, r: 0.022, rot: [0.25, 0, 0], arc: Math.PI * 1.2, arc0: -Math.PI * 0.1, seg: 20, tseg: 6, weights: { chest: 0.6, neck: 0.4 }, mat: 'fur', color: opts.fur, rough: 1 });
  }
  return this;
};
/** goggles: two lens cups + strap. opts {on:'forehead'|'eyes'|'helmet', lens, frame, strap} */
P.goggles = function (opts = {}) {
  const where = opts.on || 'forehead'; const dy = where === 'eyes' ? -0.02 : where === 'helmet' ? 0.048 : 0.032; const dz = where === 'eyes' ? -0.095 : where === 'helmet' ? -0.118 : -0.098;
  const up = where === 'eyes' ? 0 : -0.45; const frame = { mat: 'rubber', color: opts.frame ?? 0x1c1c1c, rough: 0.7 };
  for (const sx of [-1, 1]) {
    const p = [sx * 0.033, HC.y + dy, HC.z + dz];
    this.parts.lathe({ bone: 'head', p, profile: [[0.0, 0.0], [0.022, 0.0], [0.024, 0.014], [0.021, 0.02]], rot: [-Math.PI / 2 + up, sx * 0.18, 0], seg: 14, ...frame });
    this.parts.lathe({ bone: 'head', p: [p[0], p[1] + (where === 'eyes' ? 0 : 0.008), p[2] - 0.018], profile: [[0.0, 0.0], [0.019, 0.0], [0.0, 0.002]], rot: [-Math.PI / 2 + up, sx * 0.18, 0], seg: 14, mat: 'glass', color: opts.lens ?? 0x202830, wear: 0.4, dirt: 0.5 });
  }
  this.parts.box({ bone: 'head', p: [0, HC.y + dy + 0.004, HC.z + dz + 0.002], s: [0.02, 0.012, 0.012], mat: 'rubber', color: opts.frame ?? 0x1c1c1c });
  this.parts.band({ y: HC.y + dy + 0.005, height: 0.022, thick: 0.004, lift: where === 'helmet' ? 0.004 : 0.003, center: [0, HC.z + 0.01], seg: 26, mat: 'rubber', color: opts.strap ?? 0x2a2a2a, rough: 0.8, tilt: where === 'eyes' ? 0.0 : 0.01 });
  return this;
};
/** rubber half-mask respirator with filter canisters. opts {color, canisters: 1|2, filterColor} */
P.respirator = function (opts = {}) {
  const m = { mat: 'rubber', color: opts.color ?? 0x232322, rough: 0.72, dirt: 0.5 };
  const c = [0, HC.y - 0.078, HC.z - 0.095];
  this.parts.lathe({ bone: 'head', p: c, profile: [[0.044, -0.02], [0.047, -0.012], [0.043, 0.004], [0.034, 0.022], [0.018, 0.034], [0.0, 0.036]], rot: [-Math.PI / 2 + 0.25, 0, 0], scale: [1.08, 0.95], seg: 20, ...m });
  const n = opts.canisters ?? 2; const f = { mat: 'metal', color: opts.filterColor ?? 0x6a6240, rough: 0.45, wear: 0.6, dirt: 0.6 };
  if (n === 1) this.parts.lathe({ bone: 'head', p: [0, c[1] - 0.012, c[2] - 0.04], profile: [[0.0, 0], [0.034, 0], [0.036, 0.004], [0.036, 0.05], [0.03, 0.054], [0, 0.056]], rot: [-Math.PI / 2 - 0.25, 0, 0], seg: 18, ...f });
  else for (const sx of [-1, 1]) this.parts.lathe({ bone: 'head', p: [sx * 0.038, c[1] - 0.01, c[2] - 0.012], profile: [[0.0, 0], [0.028, 0], [0.03, 0.004], [0.03, 0.032], [0.024, 0.036], [0, 0.037]], rot: [-Math.PI / 2 - 0.2, sx * 0.9, 0], seg: 16, ...f });
  this.parts.band({ y: HC.y - 0.05, height: 0.018, thick: 0.003, center: [0, HC.z + 0.01], seg: 24, mat: 'rubber', color: 0x1e1e1e, tilt: -0.02 });
  this.parts.band({ y: HC.y + 0.025, height: 0.016, thick: 0.003, center: [0, HC.z + 0.01], seg: 24, mat: 'rubber', color: 0x1e1e1e, tilt: 0.045 });
  return this;
};

// ---------------------------------------------------------------- body gear
/** belt hugging the clothed waist. opts {y, color, buckle} */
P.belt = function (opts = {}) {
  const y = opts.y ?? 1.0; this.parts.band({ y, height: opts.height ?? 0.042, thick: 0.006, lift: 0.002, center: [0, 0.015], seg: 32, mat: 'leather', color: opts.color ?? 0x2e2016, rough: 0.55, wear: 0.6, dirt: 0.5 });
  if (opts.buckle !== false) this.parts.custom((o) => { const p = o.snap(new V(0, y, 0), new V(0, 0, -1), 0.12).add(new V(0, 0, -0.005)); o._torus({ bind: 'auto', p: [p.x, p.y, p.z], R: 0.024, r: 0.0045, seg: 4, tseg: 4, rot: [Math.PI / 2, Math.PI / 4, 0], mat: 'metal', color: 0x6a5a38, rough: 0.4, wear: 0.8, dirt: 0.5 }); o._box({ bind: 'auto', p: [p.x, p.y, p.z + 0.002], s: [0.004, 0.034, 0.004], mat: 'metal', color: 0x6a5a38, rough: 0.4 }); });
  return this;
};
/** braces / suspenders from the waistband over the shoulders */
P.braces = function (opts = {}) {
  const m = { mat: 'cloth', pattern: 'weave', color: opts.color ?? 0x3a2a20, rough: 0.8 };
  for (const sx of [-1, 1]) this.parts.strap([[sx * 0.09, 1.02, -0.15], [sx * 0.1, 1.2, -0.14], [sx * 0.105, 1.38, -0.1], [sx * 0.1, 1.46, 0.0], [sx * 0.09, 1.4, 0.1], [sx * 0.06, 1.2, 0.12], [sx * 0.05, 1.03, 0.12]], 0.032, 0.004, m, {});
  return this;
};
/** overall bib straps (for 'overalls'): front bib top to the back */
P.bibStraps = function (opts = {}) {
  const m = { mat: 'cloth', pattern: opts.pattern || 'denim', color: opts.color ?? 0x2c3a52, rough: 0.9, dirt: 0.5 };
  for (const sx of [-1, 1]) {
    this.parts.strap([[sx * 0.075, 1.28, -0.12], [sx * 0.095, 1.38, -0.1], [sx * 0.1, 1.46, -0.01], [sx * 0.085, 1.4, 0.1], [sx * 0.04, 1.2, 0.12]], 0.04, 0.004, m, {});
    this.parts.custom((o) => { const p = o.snap(new V(sx * 0.075, 1.28, 0), new V(0, 0, -1), 0.12); o._box({ bind: 'auto', p: [p.x, p.y, p.z - 0.004], s: [0.03, 0.03, 0.008], mat: 'metal', color: 0x7a7060, rough: 0.35, bevel: 0.003 }); });
  }
  return this;
};
/** knee pads (rubber/leather) */
P.kneePads = function (opts = {}) {
  for (const s of ['L', 'R']) { const k = restPos('calf.' + s); this.parts.custom((o) => { const p = o.snap(new V(k.x, k.y + 0.01, k.z + 0.02), new V(0, 0, -1), 0.1); o._sphere({ bind: 'auto', p: [p.x, p.y, p.z + 0.004], scale: [0.05, 0.065, 0.018], seg: 12, mat: opts.mat || 'rubber', color: opts.color ?? 0x2a2622, rough: 0.8, dirt: 0.7 }); }); }
  return this;
};
/** neckerchief / bandana around the neck */
P.neckerchief = function (opts = {}) {
  const m = { mat: 'cloth', pattern: 'weave', color: opts.color ?? 0x7a1e1a, rough: 0.9, dirt: 0.6, wear: 0.4 };
  // folded band around the neck just above the collar (hugs the neck, not the collar: small snap window)
  this.parts.band({ y: opts.y ?? 1.527, height: 0.036, thick: 0.006, lift: 0.006, center: [0, 0.026], seg: 22, window: 0.012, tilt: -0.014, ...m });
  // knot at the throat + a triangular tail hanging over the shirt opening
  this.parts.custom((o) => {
    const k = o.snap(new V(0, 1.508, 0.026), new V(0, -0.15, -1).normalize(), 0.07, 0.02, 0.012).add(new V(0, 0, -0.01));
    const nb = (t) => [[BI.neck, 0.45 * (1 - t)], [BI.chest, 0.55 + 0.45 * t]];
    o._sphere({ weights: { neck: 0.5, chest: 0.5 }, p: [k.x, k.y, k.z], scale: [0.02, 0.016, 0.014], seg: 10, ...m });
    const pts = [k.clone().add(new V(0, -0.005, 0.002)), k.clone().add(new V(0.003, -0.045, -0.006)), k.clone().add(new V(0.006, -0.085, 0.004))];
    o._tubeRaw(pts, [0.0035, 0.0055, 0.0008], o._spec(m), { seg: 8, flat: 5, bindFn: nb });
  });
  return this;
};
/** backpack / satchel on the back. opts {kind:'pack'|'satchel', color} */
P.backpack = function (opts = {}) {
  const m = { mat: 'cloth', pattern: 'canvas', color: opts.color ?? 0x4a4a32, rough: 0.9, dirt: 0.6, wear: 0.5 };
  this.parts.custom((o) => { const p = o.snap(new V(0, 1.22, 0.02), new V(0, 0, 1), 0.14); o._box({ bone: 'chest', weights: { chest: 0.6, spine2: 0.4 }, p: [p.x, p.y, p.z + 0.07], s: [0.3, 0.36, 0.14], mat: m.mat, pattern: m.pattern, color: m.color, rough: 0.9, dirt: 0.6, bevel: 0.03 });
    o._box({ bone: 'chest', p: [p.x, p.y + 0.1, p.z + 0.145], s: [0.26, 0.14, 0.02], mat: m.mat, pattern: m.pattern, color: m.color, bevel: 0.01 }); });
  for (const sx of [-1, 1]) this.parts.strap([[sx * 0.1, 1.4, 0.12], [sx * 0.11, 1.46, 0.0], [sx * 0.11, 1.36, -0.11], [sx * 0.12, 1.2, -0.1], [sx * 0.13, 1.1, 0.06]], 0.04, 0.005, { mat: 'leather', color: 0x3a2a1a, rough: 0.6 }, {});
  return this;
};
/** small cylinder on the belt (self-rescuer, canteen, snap tin) */
P.beltCanister = function (opts = {}) {
  const x = opts.x ?? -0.12, y = opts.y ?? 0.96; this.parts.custom((o) => { const p = o.snap(new V(x, y, 0.01), new V(x, 0, -0.05).normalize(), 0.15); o._lathe({ bind: 'auto', p: [p.x, p.y - 0.06, p.z - 0.03], profile: [[0, 0], [0.032, 0], [0.034, 0.004], [0.034, 0.11], [0.03, 0.115], [0.0, 0.116]], seg: 14, mat: 'metal', color: opts.color ?? 0x5a5a4a, rough: 0.45, wear: 0.7, dirt: 0.6 }); });
  return this;
};

// ---------------------------------------------------------------- tools (held in a hand, bound to the hand bone)
function gripFrame(side) { const A = RIG.arm[side]; const h = new V(...A.h), p = new V(...A.p), t = new V(...A.t); const w = new V(...A.wr); const c = w.clone().addScaledVector(h, 0.068).addScaledVector(p, 0.026); return { c, h, p, t }; }
/** pickaxe held in a hand: 0.9 m hickory handle, forged steel double pick. Held low on the handle, which runs between the knuckle
 *  line and the hand's long axis (so it hangs down-forward when the arm hangs, and leads with the head in the overhead swing). */
P.pickaxe = function (opts = {}) {
  const side = opts.hand || 'R'; const g = gripFrame(side); const hb = 'hand.' + side;
  const ax = g.h.clone().multiplyScalar(0.72).addScaledVector(g.t, 0.69).normalize();
  const bot = g.c.clone().addScaledVector(ax, -0.13), top = g.c.clone().addScaledVector(ax, 0.66);
  this.parts.capsuleBetween(bot, top, 0.016, 0.019, { mat: 'rope', color: opts.handle ?? 0x5a3e24, rough: 0.7, wear: 0.5, dirt: 0.5 }, { bone: hb, rigid: true, seg: 8, rings: 3 });
  // pick arms: perpendicular to the handle, in the plane of the handle and the forearm (the swing plane)
  const pd = g.h.clone().addScaledVector(ax, -g.h.dot(ax)); if (pd.lengthSq() < 1e-6) pd.copy(g.p); pd.normalize();
  const eye = top.clone().addScaledVector(ax, -0.02);
  this.parts.box({ bone: hb, p: [eye.x, eye.y, eye.z], s: [0.045, 0.075, 0.045], rot: new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), pd), mat: 'metal', color: 0x34302c, rough: 0.5, wear: 0.8, bevel: 0.005 });
  for (const sgn of [-1, 1]) { const tip = eye.clone().addScaledVector(pd, sgn * 0.27).addScaledVector(ax, -0.045); const mid = eye.clone().addScaledVector(pd, sgn * 0.14).addScaledVector(ax, -0.005); this.parts.tube([eye, mid, tip], [0.019, 0.013, 0.0025], { mat: 'metal', color: 0x3e3a35, rough: 0.45, wear: 0.9 }, { bone: hb, seg: 7, sub: 2 }); }
  this.info.tools.push({ kind: 'pickaxe', hand: side });
  return this;
};
/** cargo hook (docker's hand hook) */
P.cargoHook = function (opts = {}) {
  const side = opts.hand || 'R'; const g = gripFrame(side); const hb = 'hand.' + side;
  this.parts.capsuleBetween(g.c.clone().addScaledVector(g.t, -0.05), g.c.clone().addScaledVector(g.t, 0.06), 0.017, 0.017, { mat: 'rope', color: 0x5a4028, rough: 0.8 }, { bone: hb, rigid: true, seg: 8 });
  const base = g.c.clone().addScaledVector(g.p, 0.02); const pts = [base, base.clone().addScaledVector(g.h, 0.09), base.clone().addScaledVector(g.h, 0.16).addScaledVector(g.p, -0.02), base.clone().addScaledVector(g.h, 0.17).addScaledVector(g.p, -0.07), base.clone().addScaledVector(g.h, 0.13).addScaledVector(g.p, -0.1)];
  this.parts.tube(pts, [0.007, 0.007, 0.006, 0.005, 0.002], { mat: 'metal', color: 0x5a524a, rough: 0.5, wear: 0.9 }, { bone: hb, seg: 7, sub: 3 });
  return this;
};
/** pair of ski poles (hands) */
P.skiPoles = function (opts = {}) {
  // held at the grip, trailing down and backward (tips drag behind the zombie instead of stabbing the ground)
  for (const side of ['L', 'R']) { const g = gripFrame(side); const hb = 'hand.' + side; const ax = g.h.clone().multiplyScalar(0.62).addScaledVector(g.t, -0.78).normalize();
    this.parts.capsuleBetween(g.c.clone().addScaledVector(ax, -0.06), g.c.clone().addScaledVector(ax, 1.05), 0.008, 0.006, { mat: 'metal', color: opts.color ?? 0x9aa0a8, rough: 0.3 }, { bone: hb, rigid: true, seg: 6 });
    this.parts.capsuleBetween(g.c.clone().addScaledVector(ax, -0.07), g.c.clone().addScaledVector(ax, 0.06), 0.017, 0.015, { mat: 'rubber', color: 0x1a1a1a }, { bone: hb, rigid: true, seg: 8 });
    this.parts.torusRing({ bone: hb, p: g.c.clone().addScaledVector(ax, 0.95), R: 0.045, r: 0.005, rot: new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), ax), 'YXZ').toArray().slice(0, 3), seg: 12, tseg: 4, mat: 'plastic', color: 0x222222 }); }
  return this;
};

// ---------------------------------------------------------------- signature growths / details
/** glowing crystal clusters erupting from the body. opts {color, count, spots:[[bone,x,y,z,dirx,diry,dirz],...], emissive} */
P.crystals = function (opts = {}) {
  const spots = opts.spots || [['chest', 0.1, 1.36, 0.1, 0.3, 0.6, 0.7], ['upperarm.L', -0.26, 1.3, 0.03, -0.8, 0.5, 0.2], ['chest', -0.06, 1.3, 0.12, -0.2, 0.4, 0.9], ['forearm.R', 0.47, 1.06, -0.04, 0.6, 0.2, -0.7], ['head', 0.05, 1.73, 0.06, 0.4, 0.8, 0.3], ['spine1', 0.12, 1.1, 0.1, 0.5, 0.1, 0.8]];
  const rng = this.rng; const col = opts.color ?? 0x9a6aff;
  for (const [bone, x, y, z, dx, dy, dz] of spots) {
    const n = 2 + ((rng() * 3) | 0); const base = new V(x, y, z); const d0 = new V(dx, dy, dz).normalize();
    for (let i = 0; i < n; i++) {
      const d = d0.clone().add(new V(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.8)).normalize(); const L = 0.05 + rng() * 0.11, R = 0.012 + rng() * 0.016;
      this.parts.custom((o) => { const p0 = o.snap(new V(0, base.y, 0.01).lerp(base, 0.5), new V().subVectors(base, new V(0, base.y, 0.01)).normalize(), 0.12).addScaledVector(d, -0.015);
        const f = new V(); const up = Math.abs(d.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0); const ex = new V().crossVectors(up, d).normalize(), ey = new V().crossVectors(d, ex);
        const spec = o._spec({ mat: 'crystal', color: col, emissive: opts.emissive ?? 7 }); const k = 6; const ring0 = [], ring1 = []; void f;
        for (let j = 0; j < k; j++) { const a = (j / k) * TAU; const r0 = new V().copy(p0).addScaledVector(ex, Math.cos(a) * R).addScaledVector(ey, Math.sin(a) * R); const r1 = r0.clone().addScaledVector(d, L * 0.82).addScaledVector(ex, -Math.cos(a) * R * 0.12).addScaledVector(ey, -Math.sin(a) * R * 0.12); const nn = new V().copy(ex).multiplyScalar(Math.cos(a)).addScaledVector(ey, Math.sin(a)); ring0.push(o.buf.vert(r0, nn, bone, spec, 0.7)); ring1.push(o.buf.vert(r1, nn, bone, spec, 1)); }
        const tip = o.buf.vert(new V().copy(p0).addScaledVector(d, L), d, bone, spec, 1);
        for (let j = 0; j < k; j++) { const j1 = (j + 1) % k; o.buf.quad(ring0[j], ring0[j1], ring1[j1], ring1[j]); o.buf.tri(ring1[j], ring1[j1], tip); } });
    }
  }
  return this;
};
/** seaweed strands draped over shoulders / hanging from the belt (sway in the shader). opts {color, count} */
P.seaweed = function (opts = {}) {
  const col = opts.color ?? 0x2a3a1a; const rng = this.rng;
  const anchors = opts.anchors || [[0.12, 1.45, -0.05], [-0.14, 1.44, 0.02], [0.18, 1.02, -0.06], [-0.15, 1.0, 0.1], [0.05, 1.46, 0.08], [-0.3, 1.3, 0.0]];
  for (const a of anchors) this.parts.custom((o) => {
    const core = new V(0, a[1], 0.02); const dir = new V(a[0], 0, a[2] - 0.02).normalize(); const p0 = o.snap(core, dir, 0.15).addScaledVector(dir, 0.004);
    const L = 0.2 + rng() * 0.35, W = 0.018 + rng() * 0.02; const segs = o.seg(6); const spec = o._spec({ mat: 'cloth', color: col, rough: 0.3, sway: 1, dirt: 0.2, wear: 0.0 });
    const w0 = o.weightsAt(p0); let prevL = -1, prevR = -1;
    for (let i = 0; i <= segs; i++) { const t = i / segs; const p = p0.clone().addScaledVector(dir, 0.015 * Math.sin(t * 3)).add(new V(Math.sin(t * 5 + a[0] * 9) * 0.02, -t * L, 0)); const side = new V(-dir.z, 0, dir.x).multiplyScalar(W * (1 - t * 0.6)); const specI = t < 0.08 ? o._spec({ mat: 'cloth', color: col, rough: 0.3, sway: 0, wear: 0 }) : spec;
      const l = o.buf.vert(p.clone().add(side), dir, w0, specI, 0.8), r = o.buf.vert(p.clone().sub(side), dir, w0, specI, 0.8); if (prevL >= 0) { o.buf.quad(prevL, prevR, r, l); o.buf.quad(prevL, l, r, prevR); } prevL = l; prevR = r; }
  });
  return this;
};
/** icicles hanging from brims / hems. opts {points:[[bone,x,y,z],...], count} */
P.icicles = function (opts = {}) {
  const rng = this.rng; const pts = opts.points || [];
  for (const [bone, x, y, z] of pts) { const L = 0.02 + rng() * 0.05; this.parts.lathe({ bone, p: [x, y - L, z], profile: [[0.0, 0.0], [0.004, L * 0.4], [0.007, L * 0.9], [0.0, L]], seg: 6, mat: 'crystal', color: 0xcfe6ff, emissive: 0.0, rough: 0.05 }); }
  return this;
};
/** mascot head: oversized cartoon animal head shell (fibreglass/plush), cracked, with big eyes (one hanging loose) and ears.
 *  opts {kind:'bear'|'rabbit'|'cat', color, eye, cracked, snout} */
P.mascotHead = function (opts = {}) {
  const kind = opts.kind || 'bear'; const col = opts.color ?? 0x8a5a32; const shell = { mat: opts.plush ? 'fur' : 'plastic', color: col, rough: opts.plush ? 1 : 0.45, wear: 0.4, dirt: 0.5, param: opts.cracked ?? 0.35 };
  const c = new V(0, HC.y + 0.05, HC.z + 0.0); const R = opts.size ?? 0.26;
  const prof = []; for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + 0.55 + (i / 12) * (Math.PI - 0.55); prof.push([Math.max(0.002, Math.cos(a) * R), Math.sin(a) * R * 0.95]); }
  this.parts.lathe({ bone: 'head', p: c, profile: prof, scale: [1.05, 1.0], seg: 30, double: true, ...shell });
  // neck opening collar
  this.parts.torusRing({ bone: 'neck', p: [0, HC.y - 0.17, HC.z + 0.0], R: 0.13, r: 0.02, seg: 22, tseg: 6, weights: { neck: 0.5, head: 0.5 }, ...shell });
  // snout + nose
  this.parts.sphere({ bone: 'head', p: [0, c.y - 0.07, c.z - R * 0.9], scale: [0.11, 0.085, 0.09], seg: 16, mat: shell.mat, color: opts.snout ?? 0xd8c09a, rough: shell.rough, dirt: 0.5, param: shell.param });
  this.parts.sphere({ bone: 'head', p: [0, c.y - 0.04, c.z - R * 0.9 - 0.075], scale: [0.04, 0.03, 0.025], seg: 10, mat: 'plastic', color: 0x1a1414, rough: 0.3 });
  // mouth slot (dark) — the zombie face shows through
  this.parts.box({ bone: 'head', p: [0, c.y - 0.135, c.z - R * 0.86], s: [0.1, 0.022, 0.02], rot: [0.3, 0, 0], mat: 'mouth', color: 0x1a0808 });
  // eyes: big white domes with pupils; the left one hangs by a thread
  for (const sx of [-1, 1]) {
    const loose = opts.looseEye !== false && sx < 0; const ep = loose ? new V(sx * 0.1, c.y - 0.08, c.z - R * 0.95) : new V(sx * 0.085, c.y + 0.04, c.z - R * 0.86);
    this.parts.sphere({ bone: 'head', p: ep, scale: [0.055, 0.06, 0.03], seg: 14, mat: 'plastic', color: 0xe8e4d8, rough: 0.3, dirt: 0.3 });
    this.parts.sphere({ bone: 'head', p: ep.clone().add(new V(sx * -0.008, -0.004, -0.024)), scale: [0.022, 0.024, 0.012], seg: 10, mat: 'plastic', color: 0x101010, rough: 0.2 });
    if (loose) this.parts.tube([new V(sx * 0.085, c.y + 0.04, c.z - R * 0.86), new V(sx * 0.095, c.y - 0.02, c.z - R * 0.93), ep.clone().add(new V(0, 0.05, 0))], [0.003, 0.003, 0.003], { mat: 'rope', color: 0x3a3228 }, { bone: 'head', seg: 4 });
    if (loose) this.parts.sphere({ bone: 'head', p: new V(sx * 0.085, c.y + 0.04, c.z - R * 0.84), scale: [0.04, 0.045, 0.012], seg: 10, mat: 'mouth', color: 0x100a08 });
  }
  // ears
  for (const sx of [-1, 1]) {
    if (kind === 'rabbit') this.parts.sphere({ bone: 'head', p: [sx * 0.09, c.y + R + 0.12, c.z + 0.02], scale: [0.05, 0.16, 0.03], rot: [0, 0, sx * -0.25], seg: 12, ...shell });
    else this.parts.sphere({ bone: 'head', p: [sx * R * 0.72, c.y + R * 0.72, c.z + 0.01], scale: [0.075, 0.075, 0.035], seg: 14, ...shell });
  }
  this.info.mascot = { r: R, c: [c.x, c.y, c.z] };
  return this;
};
/** hair shell: a messy cap of hair over the scalp (visible when the headwear is knocked off, or on bare-headed variants).
 *  opts {color, length (m of volume), hairline (0 high … 1 low), messy}. Uses the 'hair' material + strand shading; ~150 tris. */
P.hairShell = function (opts = {}) { // hair is now strand geometry built automatically from variantDef.hair (hair.js); this call only sets style hints
  this._hairStyle = { ...(this._hairStyle || {}), ...(opts.color != null ? { color: opts.color } : {}), ...(opts.length != null ? { length: Math.max(0.02, opts.length * 2.4) } : {}), ...(opts.hairline != null ? { hairline: opts.hairline } : {}), ...(opts.style ? { style: opts.style } : {}) };
  return this;
};
/** tatters: torn strips of cloth hanging from a hem (swaying in the shader). opts {color, pattern, y (hem height), count, length, width, side:'front'|'back'|'all'} */
P.tatters = function (opts = {}) {
  const rng = this.rng, m = { mat: 'cloth', pattern: opts.pattern || 'canvas', color: opts.color ?? 0x2a2a28, rough: 0.9, dirt: 0.7, wear: 0.6 };
  const y0 = opts.y ?? 0.93, n = opts.count ?? 5;
  for (let i = 0; i < n; i++) {
    const a = opts.side === 'back' ? Math.PI * (0.6 + rng() * 0.8) : opts.side === 'front' ? Math.PI * (-0.35 + rng() * 0.7) : rng() * TAU; const L = (opts.length ?? 0.12) * (0.6 + rng() * 0.8), W = (opts.width ?? 0.035) * (0.7 + rng() * 0.6);
    this.parts.custom((o) => {
      const dir = new V(Math.sin(a), 0, -Math.cos(a)); const top = o.snap(new V(0, y0, 0.015), dir, 0.18, 0.02).addScaledVector(dir, 0.002); const w0 = o.weightsAt(top);
      const side = new V(-dir.z, 0, dir.x); const segs = o.seg(4); let pl = -1, pr = -1;
      for (let k = 0; k <= segs; k++) { const t = k / segs; const p = top.clone().add(new V(0, -t * L, 0)).addScaledVector(dir, t * 0.012 + Math.sin(t * 3 + a) * 0.006); const hw = W * 0.5 * (1 - t * 0.7);
        const spec = o._spec({ ...m, sway: t * 0.9 }); const l = o.buf.vert(p.clone().addScaledVector(side, hw), dir, w0, spec, 0.8), r = o.buf.vert(p.clone().addScaledVector(side, -hw), dir, w0, spec, 0.8);
        if (pl >= 0) { o.buf.quad(pl, pr, r, l); o.buf.quad(pl, l, r, pr); } pl = l; pr = r; }
    });
  }
  return this;
};
installGearKit(P); // detailed helmets / lamp / belt / pack / tools / tatters (gearkit.js) replace the simple versions above
export { Outfit };
