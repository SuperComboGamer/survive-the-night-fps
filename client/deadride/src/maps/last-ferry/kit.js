// LAST FERRY — kit: shared prop/structure builders used by all four stops (lamps with reflections+glare, ladders with zombie climb paths, ropes, bollards,
// fenders, crates, barrels, signs (neon + painted), chain-link fences, barbed wire, piles, quay foam, rain-rippled puddles).
import * as THREE from 'three';
import { cleatAt, boltAt } from './detail3.js';
import { std } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { makeRng } from '../../core/util.js';
import { toRaw } from '../../core/build.js';
import { crateReal, bollardExtras, lampExtras } from './real.js';
import { chainLinks } from './arch.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STOPS, BEAM_HALF, FENDER } from './layout.js';
import { Glows, Spills, lampReg, buildFoamStrips, ringStrip, getSea, withLampRefl } from './shared.js';
import { visVariant } from '../../core/mats.js';

const P = Math.PI;
/** fit a canvas texture to a box face of w x h metres (Builder boxes use metre UVs centred on the box) */
export function fitTex(tex, w, h) { tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.repeat.set(1 / w, 1 / h); tex.offset.set(0.5, 0.5); return tex; }

/** grass tuft assets (3 crossed quads, blade alpha texture, wind sway; instanced). Shared by all stops. */
let _grass = null;
export function grassAssets() {
  if (_grass) return _grass;
  const tex = canvasTexture(128, 128, (c, w, h) => { c.clearRect(0, 0, w, h); const r = makeRng(5); for (let i = 0; i < 26; i++) { const x0 = 8 + r() * 112, lean = (r() - 0.5) * 46, hh = 58 + r() * 66, wd = 2.5 + r() * 4; c.fillStyle = `rgb(${66 + (r() * 26 | 0)},${88 + (r() * 40 | 0)},${38 + (r() * 20 | 0)})`; c.beginPath(); c.moveTo(x0 - wd, h); c.quadraticCurveTo(x0 + lean * 0.3 - wd * 0.4, h - hh * 0.55, x0 + lean, h - hh); c.quadraticCurveTo(x0 + lean * 0.3 + wd * 0.6, h - hh * 0.5, x0 + wd, h); c.closePath(); c.fill(); } });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.repeat.set(1, 1);
  const parts = [0, 1, 2].map((i) => { const g = new THREE.PlaneGeometry(0.5, 0.46); g.translate(0, 0.23, 0); g.rotateY(i * P / 3); return g.toNonIndexed(); });
  const geo = mergeGeometries(parts); const n = geo.attributes.position.count; const nn = new Float32Array(n * 3); for (let i = 0; i < n; i++) nn[i * 3 + 1] = 1; geo.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  const mat = std({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, wind: { amp: 0.2, freq: 2.4, stiff: 'uv' }, key: 'grassTuft' });
  return (_grass = { geo, mat });
}

/** scale direct+indirect specular by `tbSpec` (declared by terrainFrag) on a material AND its StaticBatch vis variant: kills the backlit-glare sheen on rough grass/gravel */
export function terrainSpec(mat) {
  const wrap = (m) => { const prev = m.onBeforeCompile, k0 = m.customProgramCacheKey ? m.customProgramCacheKey() : ''; m.onBeforeCompile = (shader, r) => { if (prev) prev(shader, r); shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.directSpecular *= tbSpec; reflectedLight.indirectSpecular *= tbSpec;'); }; m.customProgramCacheKey = () => k0 + 'TS'; m.needsUpdate = true; };
  wrap(mat); const v = visVariant(mat); if (v && v !== mat) wrap(v); return mat;
}

/** GLSL for patch({frag}) on a triplanar rock terrain: grass on upper gentle slopes, shingle near the tide line, gravel paths (polylines in WORLD xz). Height/slope/noise driven (no extra meshes). */
export function terrainFrag(o = {}) {
  const g = { lo: 3.0, hi: 5.2, c0: 0x1a2614, c1: 0x33421f, ...(o.grass || {}) }, b = { hi: 1.9, c: 0x5a5852, ...(o.beach || {}) }, pth = { w: 1.5, c: 0x6a665c, lines: [], ...(o.path || {}) };
  const v3 = (c) => { const k = new THREE.Color(c); return `vec3(${k.r.toFixed(4)}, ${k.g.toFixed(4)}, ${k.b.toFixed(4)})`; };
  let seg = ''; for (const pl of pth.lines) for (let i = 0; i < pl.length - 1; i++) seg += `{ vec2 a = vec2(${pl[i][0].toFixed(2)}, ${pl[i][1].toFixed(2)}), b = vec2(${pl[i + 1][0].toFixed(2)}, ${pl[i + 1][1].toFixed(2)}), ab = b - a; float t = clamp(dot(tp - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0); pdist = min(pdist, length(tp - a - ab * t)); }\n`;
  return `float tbSpec = 1.0; { vec3 tW = normalize(vWN); vec2 tp = vWPos.xz; float tn1 = zfbm3(vWPos * 0.07), tn2 = zvn3(vWPos * vec3(0.8, 0.4, 0.8)), tn3 = zvn3(vWPos * 12.0);
    float gm = smoothstep(${g.lo.toFixed(2)}, ${g.hi.toFixed(2)}, vWPos.y + (tn1 - 0.5) * 5.0) * smoothstep(0.66, 0.86, tW.y + (tn2 - 0.5) * 0.22);
    float bm = (1.0 - smoothstep(${(b.hi * 0.45).toFixed(2)}, ${b.hi.toFixed(2)}, vWPos.y + (tn1 - 0.5) * 1.4)) * smoothstep(0.78, 0.92, tW.y) * (1.0 - gm);
    float pdist = 1e9; ${seg}
    float pm = (1.0 - smoothstep(${(pth.w * 0.55).toFixed(2)}, ${pth.w.toFixed(2)}, pdist + (tn2 - 0.5) * 1.1)) * smoothstep(0.72, 0.88, tW.y);
    vec3 ga = mix(${v3(g.c0)}, ${v3(g.c1)}, clamp(smoothstep(0.3, 0.75, tn1) * 0.7 + tn2 * 0.3, 0.0, 1.0)) * (0.7 + 0.6 * tn3) * mix(1.0, 0.72, uWet);
    vec3 ba = ${v3(b.c)} * (0.55 + 0.9 * tn3) * (0.75 + 0.5 * step(0.6, zvn3(vWPos * 23.0))) * mix(1.0, 0.7, uWet);
    vec3 pa = ${v3(pth.c)} * (0.65 + 0.7 * tn3) * mix(1.0, 0.75, uWet);
    diffuseColor.rgb = mix(diffuseColor.rgb, ga, gm); diffuseColor.rgb = mix(diffuseColor.rgb, ba, bm); diffuseColor.rgb = mix(diffuseColor.rgb, pa, pm);
    float gp = clamp(gm * (1.0 - pm), 0.0, 1.0);
    roughnessFactor = mix(roughnessFactor, mix(0.96, 0.88, uWet), gp); roughnessFactor = mix(roughnessFactor, 0.5, bm); roughnessFactor = mix(roughnessFactor, mix(0.95, 0.85, uWet), pm);
    metalnessFactor = mix(metalnessFactor, 0.0, max(gp, pm));
    vec3 wn0 = normalize((viewMatrix * vec4(tW, 0.0)).xyz); normal = normalize(mix(normal, wn0, clamp(gp * 0.9 + pm * 0.6 + bm * 0.3, 0.0, 0.92)));
    tbSpec = 1.0 - 0.86 * max(gp, pm * 0.8); }`;
}

/** Office/residential tower facade (emissive night windows): 8 columns x 13 floors per tile = 24 m x 46.8 m (metre UVs). lit = base probability of a lit window; warm = warm/white tint bias. */
export function towerTexture(seed = 9, lit = 0.24, warm = 1) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 1040; const g = c.getContext('2d'); const r = makeRng(seed);
  g.fillStyle = '#0b0d11'; g.fillRect(0, 0, 512, 1040);
  for (let y = 0; y < 13; y++) {
    const floorLit = r() < 0.16 ? 0.85 : r() < 0.35 ? lit * 0.35 : lit * 1.2; // some floors are fully lit offices, some empty
    for (let x = 0; x < 8; x++) {
      const X = x * 64, Y = y * 80; g.fillStyle = '#12151a'; g.fillRect(X + 4, Y + 10, 56, 60);              // recessed glass panel
      g.fillStyle = 'rgba(46,62,84,0.55)'; g.fillRect(X + 8, Y + 14, 48, 50);                                 // dark glass (faint sky sheen)
      if (r() < floorLit) { const k = r(); g.fillStyle = k < 0.55 * warm ? '#ffb45a' : k < 0.78 * warm + 0.1 ? '#ffd9a0' : k < 0.93 ? '#e8f2ff' : k < 0.97 ? '#9fd0ff' : '#ff9ac0'; g.globalAlpha = 0.38 + r() * 0.55; g.fillRect(X + 8, Y + 14, 48, 50); g.globalAlpha = 1; if (r() < 0.4) { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(X + 8, Y + 14 + (r() * 20 | 0), 48, 6 + (r() * 16 | 0)); } } // blinds
      g.fillStyle = '#0a0b0e'; g.fillRect(X + 30, Y + 14, 3, 50);                                              // mullion
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.repeat.set(1 / 24, 1 / 46.8); return t;
}

export function makeKit(ctx, idx) {
  const { B } = ctx; const st = STOPS[idx], O = st.origin; const glows = new Glows(700); B.group.add(glows.mesh); const spills = new Spills(320); B.group.add(spills.mesh);
  B.batch.cell = 46; B.batch.cellY = 120; B.inst.cell = 46;
  const spawns = []; const foamStrips = []; const rng = makeRng(idx * 7717 + 5);
  const K = { ctx, B, st, idx, O, glows, spills, spawns, foamStrips, rng, lamps: [] };

  // ---------------------------------------------------------------- lamps: real pooled light + fog-aware glare + reflection registry entry
  K.lamp = (p, o = {}) => {
    const color = o.color ?? 0xffaa55; const src = o.light === false ? null : ctx.light({ pos: p, color, intensity: o.cd ?? 25, distance: o.dist ?? 24, decay: 2, flicker: o.flick ?? 0, flickerSpeed: o.flickSpeed ?? 8, kind: 'point' });
    glows.add(p, color, o.size ?? 0.5, o.k ?? 1, o.flick ? 6 : 0, { mist: o.mist ?? 1, blink: o.blink });
    if (o.spill) { const gy = o.gy ?? st.quayY, h = Math.max(1.5, p[1] - gy); spills.ground(p[0], gy, p[2], o.spillR ?? Math.min(o.dist ?? 24, 1.7 * h + 1.5), color, o.spillK ?? Math.min(0.4, Math.max(0.05, (o.cd ?? 25) * 0.008))); }
    if (o.wall) { const rr = o.wallR ?? 3.4; spills.wall(p[0] + o.wall[0] * 0.04, p[1] - rr * 0.4, p[2] + o.wall[1] * 0.04, o.wall[0], o.wall[1], rr * 1.15, rr, color, o.wallK ?? Math.min(0.45, Math.max(0.05, (o.cd ?? 25) * 0.01))); }
    const e = lampReg.add(O[0] + p[0], O[1] + p[1], O[2] + p[2], color, o.refl ?? 3, o.size ?? 0.4, idx); K.lamps.push(e); return { src, e };
  };
  /** small bracket lamp over a wall-buy plate (plate centre x,y,z; normal nx,nz pointing into the play space): fixture + pooled light + soft wash on the wall so the plate is always readable */
  K.wallLamp = (x, y, z, nx, nz, o = {}) => {
    const c = o.color ?? 0xffc888, m = o.mat, lx = x + nx * 0.55, lz = z + nz * 0.55, ly = y + (o.h ?? 0.95);
    if (m) { B.beam([x + nx * 0.04, ly + 0.02, z + nz * 0.04], [lx, ly + 0.06, lz], 0.05, 0.05, { mat: m, bevel: 0, cast: false }); B.cyl({ p: [lx, ly - 0.1, lz], r: [0.14, 0.05], h: 0.15, seg: 10, mat: m, cast: false }); }
    K.lamp([lx, ly - 0.14, lz], { color: c, cd: o.cd ?? 14, dist: o.dist ?? 9, size: 0.2, k: 0.55, refl: 1.0, mist: 0.4 });
    spills.wall(x + nx * 0.02, y, z + nz * 0.02, nx, nz, 1.6, 1.3, c, o.wash ?? 0.16);
  };
  /** emitter with no real light (windows, neon tubes, signal lamps): glare + reflection */
  K.glare = (p, color, size, k = 1, o = {}) => { glows.add(p, color, size, k, o.flick ? 6 : 0, { mist: o.mist ?? 0.8, blink: o.blink }); if (o.refl !== 0) K.lamps.push(lampReg.add(O[0] + p[0], O[1] + p[1], O[2] + p[2], color, o.refl ?? 1.6, size, idx)); };

  // ---------------------------------------------------------------- oriented helpers (axis-aligned colliders only: yaw multiples of 90 deg are safe)
  /** invisible collider box between two points (axis-aligned), y0..y1 */
  // ferry landing gate: edge walls that cross the berth are split so the piece in front of the ramp (along-quay a in [-3.2, +0.2]) is a separate collider tagged 'berthGate';
  // the ferry makes it non-solid while docked with the ramp down and solid again after casting off (see vehicle.js _gates)
  const GATE = (() => { const p0 = st.toLocal(-3.2, BEAM_HALF + FENDER + 0.3), p1 = st.toLocal(0.2, BEAM_HALF + FENDER + 0.3); return { x0: Math.min(p0[0], p1[0]) - 0.3, x1: Math.max(p0[0], p1[0]) + 0.3, z0: Math.min(p0[1], p1[1]) - 0.3, z1: Math.max(p0[1], p1[1]) + 0.3 }; })();
  const addWall = (x0, y0, z0, x1, y1, z1, surface, tag) => { if (x1 - x0 < 0.02 || z1 - z0 < 0.02) return; B.colliders.addBox({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: (z1 - z0) / 2, surface, walk: false, tag }); };
  K.wallCol = (a, b, y0, y1, t = 0.3, surface = 'metal') => {
    const x0 = Math.min(a[0], b[0]) - t / 2, x1 = Math.max(a[0], b[0]) + t / 2, z0 = Math.min(a[1], b[1]) - t / 2, z1 = Math.max(a[1], b[1]) + t / 2;
    const ov = x0 < GATE.x1 && x1 > GATE.x0 && z0 < GATE.z1 && z1 > GATE.z0 && Math.abs(y0 - st.quayY) < 0.3;
    if (!ov) { addWall(x0, y0, z0, x1, y1, z1, surface); return; }
    if (x1 - x0 >= z1 - z0) { addWall(x0, y0, z0, GATE.x0, y1, z1, surface); addWall(GATE.x1, y0, z0, x1, y1, z1, surface); addWall(Math.max(x0, GATE.x0), y0, z0, Math.min(x1, GATE.x1), y1, z1, surface, 'berthGate'); }
    else { addWall(x0, y0, z0, x1, y1, GATE.z0, surface); addWall(x0, y0, GATE.z1, x1, y1, z1, surface); addWall(x0, y0, Math.max(z0, GATE.z0), x1, y1, Math.min(z1, GATE.z1), surface, 'berthGate'); }
  };
  /** axis-aligned box from min/max corners (visual + collider) */
  K.slab = (x0, y0, z0, x1, y1, z1, mat, o = {}) => B.box({ p: [(x0 + x1) / 2, y0, (z0 + z1) / 2], s: [x1 - x0, y1 - y0, z1 - z0], mat, ...o });

  /** extrude a 2D profile (x,y pairs) along z from z0..z1 (optionally rotated about Y by o.rotY around (o.cx,o.cz)) — sawtooth roofs, gable/arch profiles */
  K.extrudeXY = (pts, z0, z1, mat, o = {}) => { const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))); const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 4 }); g.translate(0, 0, z0); const raw = toRaw(g, 'box'); g.dispose(); const m = new THREE.Matrix4(); if (o.rotY) { m.makeRotationY(o.rotY); m.setPosition(o.cx ?? 0, o.y ?? 0, o.cz ?? 0); } else m.makeTranslation(o.cx ?? 0, o.y ?? 0, o.cz ?? 0); B.addRaw(raw, m, mat, { cast: o.cast ?? true }); };
  // ---------------------------------------------------------------- bollard (cast iron mushroom), tyre fender, rope coil, mooring post
  K.bollard = (x, y, z, mat, o = {}) => { const h = o.h ?? 0.55, r = o.r ?? 0.17; B.lathe({ p: [x, y, z], profile: [[0, 0], [r * 1.6, 0], [r * 1.5, 0.06], [r * 1.05, 0.14], [r, h * 0.5], [r * 0.95, h * 0.72], [r * 1.35, h * 0.86], [r * 1.35, h], [r * 0.9, h + 0.03], [0, h + 0.04]], seg: 12, mat, col: 'metal' }); bollardExtras(B, x, y, z, r, mat); if (o.cleats !== false && K.st && K.st.out) { const t = [-K.st.out[1], K.st.out[0]], yw = Math.atan2(-t[1], t[0]); for (const sd of [-1, 1]) cleatAt(B, mat, x + t[0] * sd * 2.7, y, z + t[1] * sd * 2.7, yw); } };
  K.tyre = (x, y, z, mat, o = {}) => { const r = o.r ?? 0.42, t = o.t ?? 0.16; const yaw = o.yaw ?? 0, pts = []; for (let i = 0; i <= 16; i++) { const a = i / 16 * P * 2; const c = Math.cos(a) * r, s = Math.sin(a) * r; pts.push(o.axis === 'x' ? [x, y + s, z + c] : o.axis === 'z' ? [x + c, y + s, z] : [x + c, y, z + s]); } B.tube({ pts, r: t, mat, seg: 8, segs: 20, closed: true, cast: false });  if (o.chain !== false && y < K.st.quayY - 0.6 && (o.axis === 'x' || o.axis === 'z')) { const out = K.st.out, r0 = o.r ?? 0.42; chainLinks(B, B.m('chainLink', std({ color: 0x2a2c2e, roughness: 0.4, metalness: 1 })), [x, y + r0 * 0.97, z], [x + out[0] * 0.7, K.st.quayY - 0.03, z + out[1] * 0.7]); } };
  K.coil = (x, y, z, mat, o = {}) => { const r0 = o.r ?? 0.42, turns = o.turns ?? 4, w = o.w ?? 0.035, pts = []; for (let i = 0; i <= turns * 12; i++) { const t = i / 12 * P * 2, rr = r0 * (1 - i / (turns * 12) * 0.32); pts.push([x + Math.cos(t) * rr, y + 0.04 + i / (turns * 12) * (o.h ?? 0.16), z + Math.sin(t) * rr]); } B.tube({ pts, r: w, mat, seg: 6, segs: pts.length * 2, cast: false }); };
  K.barrel = (x, y, z, mat, o = {}) => { const r = 0.29, h = 0.88; B.lathe({ p: [x, y, z], profile: [[0, 0], [r - 0.02, 0], [r, 0.02], [r, 0.09], [r - 0.012, 0.11], [r - 0.012, h * 0.3], [r, h * 0.33], [r - 0.012, h * 0.36], [r - 0.012, h * 0.62], [r, h * 0.65], [r - 0.012, h * 0.68], [r - 0.012, h - 0.11], [r, h - 0.09], [r, h - 0.02], [r - 0.02, h], [0, h]], seg: 14, mat, col: 'metal' }); };
  K.crate = (x, y, z, w, h, d, mat, o = {}) => { B.box({ p: [x, y, z], s: [w, h, d], mat, yaw: o.yaw || 0, bevel: 0.012, col: o.col ?? 'wood', walk: o.walk ?? false }); if (o.slats !== false) { const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0), t = 0.05; for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box({ p: [x + (sx * (w / 2 - t / 2)) * c + (sz * (d / 2 + 0.006)) * s, y, z - (sx * (w / 2 - t / 2)) * s + (sz * (d / 2 + 0.006)) * c], s: [t, h + 0.006, 0.014], yaw: o.yaw || 0, mat: o.batten || mat, bevel: 0, cast: false }); } };
  { const simple = K.crate; K.crate = (x, y, z, w, h, d, mat, o = {}) => (o.slats === false || h < 0.5 || w < 0.7 || Math.hypot(x - K.st.stationLocal[0], z - K.st.stationLocal[2]) > 62 ? simple(x, y, z, w, h, d, mat, o) : crateReal(B, x, y, z, w, h, d, mat, o)); }
  K.pile = (x, y0, y1, z, r, mat, o = {}) => {
    B.cyl({ p: [x, y0, z], r: [r, r * 0.95], h: y1 - y0, seg: o.seg ?? 11, mat, cast: o.cast ?? true, col: o.col ? 'wood' : false });
    { const sl = K.st.stationLocal; if (o.detail === false || y1 < 0.6 || Math.hypot(x - sl[0], z - sl[2]) > 44) return; }
    // real timber pile: steel strapping bands near the head, a fat weed/barnacle collar at the tide line with individual barnacles, a chafed rope groove
    const band = B.m('pileBand', std({ color: 0x24272a, roughness: 0.5, metalness: 0.9 })), barn = B.m('pileBarnacle', std({ color: 0x9a978a, roughness: 0.95 }));
    for (const dy of [0.3, 1.05]) B.cyl({ p: [x, y1 - dy, z], r: r * 0.97 + 0.012, h: 0.045, seg: 11, mat: band, cast: false });
    B.cyl({ p: [x, -0.22, z], r: r * 0.98 + 0.018, h: 0.62, seg: 9, mat, cast: false });
    K._barnGeo = K._barnGeo || new THREE.IcosahedronGeometry(0.028, 0);
    for (let i = 0; i < 9; i++) { const a = ((x * 7.13 + z * 3.7 + i * 2.399) % 6.2832 + 6.2832) % 6.2832, yy = -0.32 + ((i * 0.618 + x * 0.31) % 1) * 0.85, rr = r * 0.99 + 0.022; B.instance('barnacle', K._barnGeo, barn, new THREE.Matrix4().makeTranslation(x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr), 0xffffff, { cast: false }); }
  };

  // ---------------------------------------------------------------- ladders (steel rungs 0.3 m apart, 0.45 m wide, fixed to the quay face) + zombie climb spawn
  /** edge: point on the wall face {x,z}, n: outward unit normal (toward the water), deckY: deck height, mats {steel}, opts {below: bottom of ladder y, cageHeight} */
  K.ladder = (edge, n, deckY, mat, o = {}) => {
    const tx = -n[1], tz = n[0]; const alongX = Math.abs(tx) > 0.5; const below = o.below ?? -1.6, top = deckY + (o.above ?? 0.95); const off = 0.17, half = 0.225;
    const pt = (u, v, y) => [edge[0] + tx * u + n[0] * v, y, edge[1] + tz * u + n[1] * v];
    // stringers (flat bars 50x12 mm) + rungs (25 mm) every 0.3 m + wall brackets
    for (const sd of [-1, 1]) { const q = pt(sd * half, off, (below + top) / 2); B.box({ p: [q[0], below, q[2]], s: alongX ? [0.05, top - below, 0.02] : [0.02, top - below, 0.05], mat, bevel: 0, cast: false });
      for (let y = below + 0.4; y < deckY; y += 1.2) { const b0 = pt(sd * half, 0.02, y), b1 = pt(sd * half, off, y); B.beam(b0, b1, 0.03, 0.05, { mat, bevel: 0, cast: false }); } }
    const first = Math.ceil((below + 0.2) / 0.3) * 0.3; for (let y = first; y <= deckY + 0.02; y += 0.3) { const a = pt(-half, off, y), b = pt(half, off, y); B.beam(a, b, 0.025, 0.025, { mat, bevel: 0, cast: false }); }
    for (const sd of [-1, 1]) { for (let y = first; y <= deckY + 0.02; y += 0.3) boltAt(B, mat, pt(sd * half, off + 0.012, y), [n[0], 0, n[1]], 0.6); for (let y = below + 0.4; y < deckY; y += 1.2) boltAt(B, mat, pt(sd * half, off + 0.012, y + 0.12), [n[0], 0, n[1]], 0.8); }
    // collider only above the deck: two stringers block the player from stepping off (0.45 m gap < body width)
    for (const sd of [-1, 1]) { const q = pt(sd * half, 0.1, deckY); B.colliders.addBox({ x: q[0], y: deckY + 0.5, z: q[2], hx: alongX ? 0.05 : 0.14, hy: 0.55, hz: alongX ? 0.14 : 0.05, surface: 'metal', walk: false }); }
    // zombie ladder contract (docs/API.md 7, zombies README 5.3): path = [ladder bottom (under water), top rung] ON THE RUNG PLANE, ladderTop = where the climber steps onto the deck, rung = spacing.
    // rungs sit at multiples of 0.3 m (see above) and the script places hands/feet at bot.y + k * rung, so the bottom is -0.9 (a multiple of 0.3) and the last rung (1.8 for a 1.9 m deck) is reached by k = 9.
    const wp = (u, v, y) => { const q = pt(u, v, y); return [+q[0].toFixed(3), +y.toFixed(3), +q[2].toFixed(3)]; };
    const foot = pt(0, 1.7, 0); const yaw = Math.atan2(n[0], n[1]);
    const sp = { kind: 'ladder', pos: [+foot[0].toFixed(2), 0, +foot[2].toFixed(2)], yaw, path: [wp(0, off, -0.9), wp(0, off, deckY)], ladderTop: wp(0, -0.9, deckY), ladderBase: wp(0, off, 0), rung: 0.3 }; K.spawns.push(sp);
    if (o.foam !== false) K.foamStrips.push(...[{ pts: [pt(-0.9, 0.05, 0), pt(0.9, 0.05, 0)].map((q) => [q[0], q[2]]), width: 0.9, alpha: 0.8, side: 1, seed: idx * 3 + (edge[0] * 0.13) }]);
    return sp;
  };

  // ---------------------------------------------------------------- foam along a polyline at the quay face (local x,z; n = outward normal side)
  K.quayFoam = (a, b, width = 1.1, alpha = 0.7, seed = 1) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(L / 3)); const pts = []; for (let i = 0; i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); K.foamStrips.push({ pts, width, alpha, side: 1, seed }); };
  K.pileFoam = (x, z, r = 0.3, w = 0.9) => K.foamStrips.push(ringStrip(x, z, r * 0.9, w, 0.85, x * 0.37 + z * 0.11, 12));
  K.finishFoam = () => { if (K.foamStrips.length) { const m = buildFoamStrips(K.foamStrips); B.group.add(m); K.foamMesh = m; } };

  // ---------------------------------------------------------------- signs
  /** painted sign board (canvas): lines[], bg/fg colours, weather. p = base centre. */
  K.sign = (lines, p, s, o = {}) => {
    const hz = o.face === 'x' ? s[2] : s[0]; const w = o.w ?? 512, h = o.h ?? Math.round(w * s[1] / hz); const tex = canvasTexture(w, h, (c) => {
      c.fillStyle = o.bg || '#20262a'; c.fillRect(0, 0, w, h); if (o.border !== false) { c.strokeStyle = o.fg || '#e8e0c8'; c.lineWidth = Math.max(3, h * 0.03); c.strokeRect(c.lineWidth * 1.4, c.lineWidth * 1.4, w - c.lineWidth * 2.8, h - c.lineWidth * 2.8); }
      const n = lines.length, fs = o.fontSize || Math.floor(Math.min(h / (n + 0.7), w / (Math.max(...lines.map((l) => l.length)) * 0.6))); c.fillStyle = o.fg || '#e8e0c8'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `${o.weight || '700'} ${fs}px ${o.font || 'Impact, "Arial Narrow", Arial, sans-serif'}`; lines.forEach((l, i) => c.fillText(l, w / 2, h / 2 + (i - (n - 1) / 2) * fs * 1.08));
      if (o.weather ?? 0.5) { const r = Math.random, wa = o.weather ?? 0.5; c.globalAlpha = 0.55 * wa; for (let i = 0; i < 200; i++) { c.fillStyle = `rgba(15,12,8,${r() * 0.6})`; c.fillRect(r() * w, r() * h, r() * 4 + 1, r() * 28 + 2); } c.globalAlpha = 0.5 * wa; for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(${110 + r() * 60},${50 + r() * 30},20,${r() * 0.5})`; c.beginPath(); c.arc(r() * w, r() * h, r() * 8 + 2, 0, 7); c.fill(); } c.globalAlpha = 1; }
    });
    fitTex(tex, o.face === 'x' ? s[2] : s[0], s[1]); const m = std({ map: tex, roughness: o.rough ?? 0.55, metalness: o.metal ?? 0.15 }); B.box({ p, s, yaw: o.yaw || 0, mat: m, bevel: 0.012, col: false, cast: o.cast ?? false }); return m;
  };
  /** neon sign: tube-outline lettering on a dark panel, emissive. colors: text colour(s). Returns the material. */
  K.neon = (lines, p, s, o = {}) => {
    const hz = o.face === 'x' ? s[2] : s[0]; const w = o.w ?? 1024, h = o.h ?? Math.round(w * s[1] / hz); const cols = o.colors || ['#ff3aa8']; const tex = canvasTexture(w, h, (c) => {
      c.fillStyle = o.bg || '#07080d'; c.fillRect(0, 0, w, h); const n = lines.length; const fs = o.fontSize || Math.floor(Math.min(h / (n + 0.5), w / (Math.max(...lines.map((l) => l.length)) * 0.62)));
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `${o.weight || '900'} ${fs}px ${o.font || '"Arial Black", Impact, sans-serif'}`; c.lineJoin = 'round'; c.lineCap = 'round';
      lines.forEach((l, i) => { const col = cols[i % cols.length], y = h / 2 + (i - (n - 1) / 2) * fs * 1.12; c.shadowColor = col; c.shadowBlur = fs * 0.28; c.strokeStyle = col; c.lineWidth = Math.max(4, fs * 0.075); c.strokeText(l, w / 2, y); c.shadowBlur = fs * 0.1; c.strokeStyle = '#fff'; c.globalAlpha = 0.55; c.lineWidth = Math.max(1.5, fs * 0.022); c.strokeText(l, w / 2, y); c.globalAlpha = 1; c.shadowBlur = 0; });
      if (o.frame) { c.strokeStyle = o.frame; c.shadowColor = o.frame; c.shadowBlur = 16; c.lineWidth = 7; c.strokeRect(14, 14, w - 28, h - 28); c.shadowBlur = 0; }
    });
    fitTex(tex, o.face === 'x' ? s[2] : s[0], s[1]); const m = std({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: o.glow ?? 4.5, roughness: 0.6, metalness: 0.1 }); B.box({ p, s, yaw: o.yaw || 0, mat: m, bevel: 0.01, col: false, cast: false }); return m;
  };
  /** painted lettering on the ground / wall as a transparent decal plane (canvas). p = centre. Horizontal (ground) if o.wall is falsy. */
  K.decal = (text, p, s, o = {}) => {
    const w = o.w ?? 512, h = Math.round(w * s[1] / s[0]); const tex = canvasTexture(w, h, (c) => { c.clearRect(0, 0, w, h); if (!o.wall && o.flip !== false) { c.translate(0, h); c.scale(1, -1); } c.fillStyle = o.fg || '#e0c020'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `${o.weight || '900'} ${Math.floor(h * (o.scale ?? 0.8))}px ${o.font || 'Impact, "Arial Narrow", sans-serif'}`; c.fillText(text, w / 2, h / 2); if (o.border) { c.strokeStyle = o.fg || '#e0c020'; c.lineWidth = h * 0.06; c.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h * 0.9); }
      // wear: scratch out random bits
      c.globalCompositeOperation = 'destination-out'; const r = Math.random; for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(0,0,0,${r() * 0.9})`; c.fillRect(r() * w, r() * h, r() * 6 + 1, r() * 4 + 1); } });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.repeat.set(1 / s[0], 1 / s[1]);
    const m = std({ map: tex, transparent: true, alphaTest: 0.02, depthWrite: false, roughness: o.rough ?? 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    if (o.wall) B.box({ p: [p[0], p[1] - s[1] / 2, p[2]], s: o.wallAxis === 'z' ? [0.01, s[1], s[0]] : [s[0], s[1], 0.01], mat: m, bevel: 0, cast: false, col: false }); else B.plane({ p, s, yaw: o.from ? Math.atan2(o.from[0], o.from[1]) : (o.yaw || 0), mat: m, cast: false }); return m;
  };

  // ---------------------------------------------------------------- chain-link fence (alpha-tested diamond mesh) + barbed wire + posts
  K.fenceMat = () => B.mats.get('fenceMesh') || B.m('fenceMesh', (() => { const tex = canvasTexture(128, 128, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(150,158,162,1)'; c.lineWidth = 3; for (let i = -2; i < 6; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32 + 128, 128); c.stroke(); c.beginPath(); c.moveTo(i * 32 + 128, 0); c.lineTo(i * 32, 128); c.stroke(); } }, { repeat: true }); tex.repeat.set(1 / 0.6, 1 / 0.6); return std({ map: tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.9 }); })());
  K.fence = (a, b, h, postMat, o = {}) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]); const mat = K.fenceMat();
    const n = Math.max(1, Math.round(L / 2.5)); for (let i = 0; i <= n; i++) { const t = i / n; B.box({ p: [a[0] + (b[0] - a[0]) * t, o.y0 ?? 0, a[1] + (b[1] - a[1]) * t], s: [0.08, h + 0.25, 0.08], mat: postMat, bevel: 0, col: false, cast: false }); }
    B.box({ p: [(a[0] + b[0]) / 2, (o.y0 ?? 0) + h * 0.5, (a[1] + b[1]) / 2], s: alongX ? [L, h, 0.02] : [0.02, h, L], mat, bevel: 0, col: false, cast: false });
    for (const y of [0.05, h - 0.02]) B.box({ p: [(a[0] + b[0]) / 2, (o.y0 ?? 0) + y, (a[1] + b[1]) / 2], s: alongX ? [L, 0.03, 0.04] : [0.04, 0.03, L], mat: postMat, bevel: 0, col: false, cast: false });
    if (o.col !== false) K.wallCol(a, b, o.y0 ?? 0, (o.y0 ?? 0) + h, 0.12);
    if (o.wire) K.razor([a[0], (o.y0 ?? 0) + h + 0.28, a[1]], [b[0], (o.y0 ?? 0) + h + 0.28, b[1]], o.wireMat || postMat);
  };
  /** razor/barbed wire coil along a→b (helix tube) */
  K.razor = (a, b, mat) => { const len = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(6, Math.round(len / 0.32)), alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[2] - a[2]), pts = []; for (let i = 0; i <= n; i++) { const t = i / n, ang = i * 1.9; const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t; pts.push([x + (alongX ? 0 : Math.cos(ang) * 0.14), a[1] + Math.sin(ang) * 0.14, z + (alongX ? Math.cos(ang) * 0.14 : 0)]); } B.tube({ pts, r: 0.008, mat, seg: 4, segs: pts.length * 2, cast: false }); };

  // ---------------------------------------------------------------- lamp posts (geometry only; K.lamp adds light/glare). Returns head position.
  K.lampPost = (x, z, y0, o = {}) => {
    const h = o.h ?? 6.2, mat = o.mat, dir = o.dir || [0, 1]; const ax = x + dir[0] * (o.arm ?? 0.9), az = z + dir[1] * (o.arm ?? 0.9);
    B.cyl({ p: [x, y0, z], r: [0.13, 0.085], h, seg: 10, mat, col: 'metal' }); B.cyl({ p: [x, y0, z], r: 0.19, h: 0.35, seg: 10, mat, cast: false });
    B.beam([x, y0 + h - 0.25, z], [ax, y0 + h + 0.12, az], 0.07, 0.07, { mat, bevel: 0, cast: false });
    B.cyl({ p: [ax, y0 + h - 0.1, az], r: [0.3, 0.07], h: 0.18, seg: 12, mat, cast: false }); if (o.glass !== false) B.sphere({ p: [ax, y0 + h - 0.14, az], r: 0.1, mat: o.glowMat, seg: 8, cast: false });
    lampExtras(B, x, z, y0, h, ax, az, mat);
    return [ax, y0 + h - 0.22, az];
  };
  /** soft-edged irregular puddle: fan disc with normalised UVs (the material shapes + feathers the edge from noise) */
  K.puddle = (mat, x, y, z, rx, rz, yaw = 0) => {
    const n = 20, p = [0, 0, 0], u = [0, 0], nn = [0, 1, 0], idx = [];
    for (let k = 0; k < n; k++) { const a = k / n * P * 2; p.push(Math.cos(a) * rx * 1.18, 0, Math.sin(a) * rz * 1.18); nn.push(0, 1, 0); u.push(Math.cos(a) * 1.18, Math.sin(a) * 1.18); }
    for (let k = 0; k < n; k++) idx.push(0, 1 + (k + 1) % n, 1 + k);
    const raw = { p: new Float32Array(p), n: new Float32Array(nn), u: new Float32Array(u), i: new Uint32Array(idx) };
    const m = new THREE.Matrix4().makeRotationY(yaw); m.setPosition(x, y, z); B.addRaw(raw, m, mat, { cast: false });
  };
  /** scatter n grass tufts inside region [x0,z0,x1,z1] where accept(x,z) is true; H(x,z) = ground height. */
  K.grass = (n, region, H, accept, o = {}) => { const { geo, mat } = grassAssets(); const tints = o.tints || [0xc8d0b0, 0xb0c098, 0x98a880, 0xd0d0a0, 0x889870]; let placed = 0, tries = 0; while (placed < n && tries++ < n * 40) { const x = region[0] + rng() * (region[2] - region[0]), z = region[1] + rng() * (region[3] - region[1]); if (!accept(x, z)) continue; const y = H(x, z), s = (o.s0 ?? 0.7) + rng() * (o.s1 ?? 0.8); B.instance(o.key || 'grass', geo, mat, B.matrix([x, y - 0.02, z], rng() * 6.28, [s, s * (0.75 + rng() * 0.7), s]), tints[(rng() * tints.length) | 0], { cast: false }); placed++; } return placed; };
  return K;
}

// ---------------------------------------------------------------------------------------------------------- materials common to all stops (parametrised => distinct palettes)
/** wet puddle material with rain ripples (animated normal) + lamp reflections */
export function puddleMaterial(B, name = 'puddle', color = 0x06080a, sky = 0x101820) {
  let m = B.mats.get(name); if (m) return m;
  m = std({ color, emissive: sky, emissiveIntensity: 0.1, roughness: 0.035, metalness: 0, envMapIntensity: 1.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 + sky });
  const wrap = (mm) => {   // applied to the material AND its StaticBatch vis variant
    const base = mm.onBeforeCompile, k0 = mm.customProgramCacheKey();
    mm.onBeforeCompile = (shader, r) => {
      base(shader, r);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPud;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPud = uv;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vPud; float pHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float pNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), f.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), f.x), f.y); }
      vec2 rippleG(vec2 p, float t){ vec2 g = vec2(0.0); for (int j = 0; j < 2; j++) { vec2 q = p * (1.9 + float(j) * 1.1) + float(j) * 7.3; vec2 id = floor(q); vec2 f = fract(q) - 0.5; float h = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5);
        float ph = fract(t * (0.55 + h * 0.6) + h * 9.0); vec2 c = (vec2(fract(h * 17.0), fract(h * 31.0)) - 0.5) * 0.5; vec2 d = f - c; float r = length(d); float ring = ph * 0.5; float e = exp(-pow((r - ring) / 0.05, 2.0)) * (1.0 - ph) * (1.0 - ph);
        g += normalize(d + vec2(1e-4)) * e * cos((r - ring) * 46.0); } return g; }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
      { float pr = length(vPud) / 1.18; float pn = pNoise(vWPos.xz * 1.7) * 0.55 + pNoise(vWPos.xz * 4.1 + 3.0) * 0.3; float pe = 0.55 + pn * 0.52; diffuseColor.a *= (1.0 - smoothstep(pe - 0.34, pe, pr)) * 0.93; }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec2 rg = rippleG(vWPos.xz, uTime) * (0.25 + uWet * 0.75) * 0.5; vec3 wn = normalize(vec3(-rg.x, 1.0, -rg.y)); normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`)
        .replace('#include <lights_physical_fragment>', `{ float pnv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0); float pF = 0.04 + 0.96 * pow(1.0 - pnv, 4.0); totalEmissiveRadiance += (uFogColor * 0.6 + uFogScatter * 0.9) * pF * 0.7; }
      #include <lights_physical_fragment>`);
    };
    mm.customProgramCacheKey = () => k0 + 'PR'; mm.needsUpdate = true;
  };
  wrap(m); const v = visVariant(m); if (v !== m) wrap(v);
  withLampRefl(m, { gain: 1.4, maxRough: 0.9 }); B.m(name, m); return m;
}
