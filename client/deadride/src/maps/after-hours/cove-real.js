// AFTER HOURS — Pirate Cove: real ship construction + beach dressing as geometry.
// References: carvel-planked galleon hull, plank strake width ~0.28 m (here raised half-round seams every 0.3 m of hull height), wales 0.2 m, barrel hoops 4 per barrel,
// bamboo nodes every 0.45 m, pebbles 2-8 cm, cockle shells 3-6 cm.
import * as THREE from 'three';
import { pipe, torus, TAU, PI } from './common.js';

/** raised strake seams along the lofted hull on both sides. fns are the hull's own ring functions so the seams sit exactly on the surface. */
export function hullStrakes(B, { SX, SZ, HL, XF, yV, vD, mat, levels = 12, stations = 40 }) {
  const zs = []; for (let i = 0; i <= stations; i++) zs.push(-HL + 2 * HL * i / stations);
  for (const sgn of [-1, 1]) for (let l = 1; l <= levels; l++) { const q = l / (levels + 1); let prev = null;
    for (const z of zs) { const v0 = vD(z), v = v0 + (1 - v0) * q, p = [SX + sgn * XF(z, v) * 1.006, yV(z, v), SZ + z]; if (prev && (Math.abs(prev[1] - p[1]) < 1.5)) pipe(B, prev, p, 0.038, mat, { seg: 4, cast: false }); prev = p; } }
}

/** barrel hoops (4 iron bands) for a lathe barrel of scale sc (profile radii: 0.28 at ends, 0.37 belly) */
export function hoops(B, iron, x, y, z, sc = 1) {
  const rAt = (h) => { const t = h / 1.05; return 0.28 + 0.09 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 1.0; };
  for (const h of [0.1, 0.36, 0.7, 0.95]) torus(B, { p: [x, y + h * sc, z], R: rAt(h) * sc * 1.012, r: 0.016 * sc, seg: 4, tube: 16, mat: iron, cast: false });
}

/** ring-scarred palm trunk radii (12-sided rings every 0.22 m with alternating ridges and a flared root) */
export const palmRad = (t, i) => (0.27 - 0.13 * t) * (1 + (i % 2 ? 0.07 : -0.03)) * (1 + 0.55 * Math.max(0, 0.07 - t) / 0.07);

/** beach dressing: clusters of pebbles and shells around rocks, driftwood and the waterline; returns nothing (instanced groups share ONE small material) */
export function beachClutter(B, K, rng, n) {
  const { geo, mat, height } = K, peb = geo('pebble', () => { const g = new THREE.IcosahedronGeometry(0.05, 0); return g; }), weed = geo('weed', () => { const g = new THREE.ConeGeometry(0.05, 0.34, 4); g.translate(0, 0.17, 0); return g; });
  for (let i = 0; i < n; i++) { const x = -20 + rng() * 60, z = -55 + rng() * 110, h = height(x, z); if (h < -0.4 || h > 1.6) continue; const cluster = 1 + Math.floor(rng() * 5);
    for (let k = 0; k < cluster; k++) { const px = x + (rng() - 0.5) * 1.6, pz = z + (rng() - 0.5) * 1.6, ph = height(px, pz); if (ph < -0.4) continue; const sc = 0.5 + rng() * 1.6; B.instance('pebble', peb, mat, B.matrix([px, ph + 0.012 * sc, pz], rng() * TAU, sc, rng() * 3, rng() * 3), [0x8a8a86, 0x6e6c66, 0xa09a8c, 0x585650][Math.floor(rng() * 4)], { cast: false }); }
    if (rng() < 0.25) for (let k = 0; k < 4; k++) { const px = x + (rng() - 0.5) * 0.6, pz = z + (rng() - 0.5) * 0.6, ph = height(px, pz); B.instance('weed', weed, mat, B.matrix([px, ph, pz], rng() * TAU, 0.5 + rng() * 0.8, (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9), [0x2a3a1c, 0x3a4a22, 0x4a3a20][Math.floor(rng() * 3)], { cast: false }); } }
}

/** Real straw thatch: overlapping bundles (thin tapered cards, slightly lifted at the tip) laid course by course over a gable roof.
 *  Hut-local frame via `Lw(lx, y, lz) -> [x, y, z]`; the roof profile is y = gy + 2.9 + 1.8 (1 - |2 z / D|) with D = d + 1.2; the slabs underneath are 0.16 m thick. */
const K_ROPE_FALLBACK = null;
export function thatchCards(B, mat, rng, Lw, { w, d, gy, cols = 0.17, rows = 8 }) {
  const D = d + 1.2, W = w + 1.6, P = [], N = [], U = [], I = [];
  const yAt = (z) => gy + 2.9 + 1.8 * (1 - Math.abs(2 * z / D)) + 0.115;
  for (const sgn of [-1, 1]) for (let k = 0; k < rows; k++) { const z0 = sgn * (D / 2) * (1 - k / rows), z1 = sgn * (D / 2) * (1 - (k + 1.6) / rows), y0 = yAt(z0), y1 = yAt(Math.abs(z1) < 0.001 ? 0 : z1);
    for (let x = -W / 2 + 0.08; x < W / 2 - 0.05; x += cols * (0.85 + rng() * 0.3)) { const cw = 0.17 + rng() * 0.07, lift = 0.02 + rng() * 0.05, dz = (z0 - z1) * (0.9 + rng() * 0.25), dy = (y0 - y1) * (0.9 + rng() * 0.25), jx = (rng() - 0.5) * 0.05, base = P.length / 3;
      const tl = Lw(x - cw / 2, y0 + lift, z0), tr = Lw(x + cw / 2 + jx, y0 + lift, z0);   // bundle top edge; the lower edge is split into 3 blade columns with ragged ends
      const bot = []; for (let c = 0; c <= 3; c++) { const f = c / 3, extra = (c % 2 ? 0.05 + rng() * 0.05 : rng() * 0.04); bot.push(Lw(x - cw / 2 + (cw + jx) * f + jx * 0.4, y0 - dy - extra * 0.6 + lift * 2.4, z0 - dz - extra)); }
      for (let c = 0; c <= 3; c++) { const f = c / 3, t = [tl[0] + (tr[0] - tl[0]) * f, tl[1] + (tr[1] - tl[1]) * f, tl[2] + (tr[2] - tl[2]) * f]; P.push(...t); U.push(x - cw / 2 + cw * f, k * 0.6 + rng() * 0.3); }
      for (let c = 0; c <= 3; c++) { P.push(...bot[c]); U.push(x - cw / 2 + cw * c / 3, k * 0.6 + 0.5); }
      const e1 = [tr[0] - tl[0], tr[1] - tl[1], tr[2] - tl[2]], e2 = [bot[0][0] - tl[0], bot[0][1] - tl[1], bot[0][2] - tl[2]]; let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (let q2 = 0; q2 < 8; q2++) N.push(nx, ny, nz);
      for (let c = 0; c < 3; c++) I.push(base + c, base + 4 + c, base + c + 1, base + c + 1, base + 4 + c, base + 5 + c); } }
  B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, B.matrix([0, 0, 0]), mat, { cast: false });
  for (const sgn of [-1, 1]) for (let x = -W / 2; x < W / 2; x += 0.1) { const p = Lw(x, yAt(sgn * D / 2) - 0.02, sgn * D / 2); pipe(B, [p[0], p[1], p[2]], [p[0], p[1] - 0.25 - rng() * 0.2, p[2] + sgn * (0.03 + rng() * 0.06)], 0.009, mat, { seg: 3, cast: false }); }   // loose straw ends along both eaves
  const r0 = Lw(-W / 2 - 0.05, yAt(0) + 0.02, 0), r1 = Lw(W / 2 + 0.05, yAt(0) + 0.02, 0); pipe(B, r0, r1, 0.2, mat, { seg: 8, cast: false }); for (let x = -W / 2 + 0.4; x < W / 2; x += 0.9) { const c = Lw(x, yAt(0) + 0.02, 0), c2 = Lw(x + 0.06, yAt(0) + 0.02, 0); pipe(B, c, c2, 0.215, K_ROPE_FALLBACK || mat, { seg: 8, cast: false }); }   // ridge roll with binding bands
}

// ------------------------------------------------------------------ fractured rock: sphere -> planar cuts (flat facets, sharp edges) -> strata ledges -> squash; flat-shaded
import { makeRng as mkRng } from '../../core/util.js';
import { toRaw as toRawR } from '../../core/build.js';
import { mergeVertices as mv } from 'three/addons/utils/BufferGeometryUtils.js';
const ROCKS = new Map();
function fracGeo(seed, detail, cuts, sq, r) {
  const key = `${seed}|${detail}|${cuts}|${sq.join(',')}|${r.toFixed(2)}`; let raw = ROCKS.get(key); if (raw) return raw;
  const rng = mkRng(Math.floor(seed * 100) * 7919 + 13); let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mv(g);   // shared vertices keep the surface watertight while displacing
  const pa = g.attributes.position, planes = []; for (let k = 0; k < cuts; k++) { const a = rng() * TAU, n = new THREE.Vector3(Math.cos(a), (rng() - 0.3) * 1.5, Math.sin(a)).normalize(); planes.push([n, 0.58 + rng() * 0.24]); }
  const v = new THREE.Vector3(), ph = rng() * 6.28;
  for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).normalize(); v.multiplyScalar(1 + 0.15 * Math.sin(v.x * 3.1 + ph) * Math.sin(v.y * 2.7 + ph * 1.3) * Math.sin(v.z * 3.3 - ph) + 0.035 * Math.sin(v.x * 11 + v.z * 9 + ph));
    for (const [n, d] of planes) { const t = v.dot(n) - d; if (t > 0) v.addScaledVector(n, -t); }                                   // fracture planes
    v.y += 0.05 * Math.sin(v.y * 13 + ph) * (1 - Math.min(1, Math.abs(v.y)));                                                   // strata ledges
    pa.setXYZ(i, v.x * sq[0] * r, v.y * sq[1] * r, v.z * sq[2] * r); }
  g = g.toNonIndexed(); g.computeVertexNormals(); raw = toRawR(g, 'box'); ROCKS.set(key, raw); return raw;
}
/** replace B.rock (lumpy noise sphere) with fractured rock, same signature and collider behaviour */
export function installFracRocks(B) {
  B.rock = (o) => { const sq = o.squash || [1, 1, 1], detail = o.r < 0.9 ? 1 : o.r < 5 ? 2 : 3; B.addRaw(fracGeo(o.seed || 1, detail, o.r < 0.9 ? 4 : 9, sq, o.r), B.matrix(o.p, o.yaw || 0, 1, o.pitch || 0, o.roll || 0), o.mat, o);
    if (o.col) B.colliders.addCyl({ x: o.p[0], z: o.p[2], r: o.r * Math.max(sq[0], sq[2]) * 0.85, y0: o.p[1] - o.r * sq[1] * 0.8, y1: o.p[1] + o.r * sq[1] * 0.75, surface: typeof o.col === 'string' ? o.col : 'rock', walk: o.walk === true }); };
}

/** palm crown with real leaflets: pinnate fronds (rachis ribbon + 2 x N drooping tapered leaflets). uv.y = wind sway weight (0 rooted .. 1 free tip; the wind patch multiplies displacement by uv.y squared) */
export function palmCrown(rng, top, fronds = 10, NL = 10) {
  const P = [], U = [], I = [], push = (x, y, z, v) => { P.push(x, y, z); U.push(0.5, v); return P.length / 3 - 1; };
  for (let f = 0; f < fronds; f++) {
    const a = f / fronds * TAU + rng() * 0.35, L = 2.6 + rng() * 1.0, dr = 1.3 + rng() * 1.1, up = 0.5 + rng() * 0.4, S = 8, ca = Math.cos(a), sa = Math.sin(a), pts = [];
    for (let i = 0; i <= S; i++) { const s = i / S; pts.push([top[0] + ca * L * s, top[1] + up * Math.sin(s * 2.0) * 1.4 - dr * s * s * 1.1, top[2] + sa * L * s]); }
    for (let i = 0; i < S; i++) { const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1], w = 0.035 * (1 - i / S * 0.7), b = P.length / 3; push(x0 - sa * w, y0, z0 + ca * w, i / S); push(x0 + sa * w, y0, z0 - ca * w, i / S); push(x1 - sa * w, y1, z1 + ca * w, (i + 1) / S); push(x1 + sa * w, y1, z1 - ca * w, (i + 1) / S); I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    for (let i = 2; i < NL; i++) { const s = i / NL, fs = s * S, k = Math.min(S - 1, Math.floor(fs)), u = fs - k, p0 = pts[k], p1 = pts[k + 1], bx = p0[0] + (p1[0] - p0[0]) * u, by = p0[1] + (p1[1] - p0[1]) * u, bz = p0[2] + (p1[2] - p0[2]) * u;
      const tx = p1[0] - p0[0], ty = p1[1] - p0[1], tz = p1[2] - p0[2], tl = Math.hypot(tx, ty, tz) || 1, T = [tx / tl, ty / tl, tz / tl], len = (0.85 + 0.35 * Math.sin(Math.PI * (0.1 + 0.9 * s))) * (1 - 0.3 * s) * (0.9 + rng() * 0.2), wd = 0.05;
      for (const side of [-1, 1]) { const D = [-sa * side * 0.85 + T[0] * 0.5, -0.55 + T[1] * 0.5, ca * side * 0.85 + T[2] * 0.5], dl = Math.hypot(D[0], D[1], D[2]), d = [D[0] / dl, D[1] / dl, D[2] / dl];
        const mx = bx + d[0] * len * 0.5, my = by + d[1] * len * 0.5, mz = bz + d[2] * len * 0.5, tipx = bx + d[0] * len, tipy = by + d[1] * len - 0.09 * len, tipz = bz + d[2] * len, sv = s, sm = s + (1 - s) * 0.55;
        const a0 = push(bx - T[0] * wd, by - T[1] * wd, bz - T[2] * wd, sv), a1 = push(bx + T[0] * wd, by + T[1] * wd, bz + T[2] * wd, sv), m0 = push(mx - T[0] * wd * 0.85, my - T[1] * wd * 0.85, mz - T[2] * wd * 0.85, sm), m1 = push(mx + T[0] * wd * 0.85, my + T[1] * wd * 0.85, mz + T[2] * wd * 0.85, sm), t0 = push(tipx, tipy, tipz, 1.0);
        I.push(a0, a1, m0, a1, m1, m0, m0, m1, t0); } } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals(); return g;
}

/** complete the galleon's running and standing rigging: deadeyes + lanyards at every shroud, ratlines on both sides, yard-arm blocks with halyards */
export function shipRiggingExtras(B, K) {
  const { SX, SZ, D, hwF, rope, wood, iron } = K;
  for (const [mz, hy] of [[-2, 16], [-11, 13], [8, 11]]) for (const sign of [-1, 1]) for (const dz of [-1.4, 0, 1.4]) { const bx = SX + sign * (hwF(mz + dz) * 0.88), by = D + 1.1, bz = SZ + mz + dz;
    B.box({ p: [bx, by - 0.12, bz], s: [0.03, 0.55, 0.16], mat: iron, anchor: 'center', bevel: 0, cast: false });                                                // chainplate strap
    for (const dy of [0.02, 0.4]) B.sphere({ p: [bx, by + dy, bz], r: 0.1, seg: 8, scale: [0.55, 1, 1], mat: wood, cast: false });                              // deadeyes
    for (let k = 0; k < 3; k++) pipe(B, [bx + sign * 0.03, by + 0.05, bz + (k % 2 ? 0.05 : -0.05)], [bx + sign * 0.03, by + 0.38, bz + (k % 2 ? -0.05 : 0.05)], 0.009, rope, { seg: 3, cast: false });   // lanyard turns
  }
  const yardBlocks = (mz, y, len) => { for (const e of [-1, 1]) { const x = SX + e * len / 2; B.box({ p: [x - e * 0.15, D + y - 0.3, SZ + mz], s: [0.14, 0.3, 0.12], mat: wood, anchor: 'center', bevel: 0, cast: false }); torus(B, { p: [x - e * 0.15, D + y - 0.5, SZ + mz], R: 0.06, r: 0.012, seg: 4, tube: 8, yaw: PI / 2, mat: iron, cast: false }); pipe(B, [x - e * 0.15, D + y - 0.5, SZ + mz], [x - e * 1.4, D + 2.2, SZ + mz + 0.25], 0.017, rope, { seg: 3, cast: false }); } };
  yardBlocks(-2, 9.6, 12.6); yardBlocks(-2, 16.4, 9.4); yardBlocks(-11, 8.4, 10.4); yardBlocks(-11, 14.6, 7.6);
}

/** wrack line + sand ripples: weed / shell clumps strung along the high-tide mark (instanced, one material), shoreX(z) gives the water line */
export function wrackLine(B, K, rng) {
  const { geo, mat, shoreX, height } = K, weed = geo('weed2', () => { const g = new THREE.ConeGeometry(0.06, 0.38, 4); g.translate(0, 0.19, 0); return g; }), shell = geo('shell2', () => new THREE.IcosahedronGeometry(0.045, 0));
  for (let i = 0; i < 700; i++) { const z = -75 + rng() * 150, x = shoreX(z) + 1.4 + rng() * 2.2 + Math.sin(z * 0.4) * 0.5, h = height(x, z); if (h < -0.3) continue;
    if (rng() < 0.6) B.instance('weed2', weed, mat, B.matrix([x, h - 0.01, z], rng() * TAU, 0.6 + rng() * 1.3, (rng() - 0.5) * 1.3, (rng() - 0.5) * 1.3), [0x2a3a1c, 0x3a4a22, 0x4a3a20, 0x35301c][Math.floor(rng() * 4)], { cast: false });
    else B.instance('shell2', shell, mat, B.matrix([x, h + 0.01, z], rng() * TAU, 0.7 + rng() * 1.6, rng() * 3, rng() * 3), [0xf0e0d0, 0xe8b8a0, 0xd0c8b0, 0xf8f0e0][Math.floor(rng() * 4)], { cast: false }); }
}


/** ripple / footprint decal painters (alpha, drawn in a 128 px atlas cell) */
export const SAND_PAINT = {
  ripple: (c, w, h, r) => { c.lineCap = 'round'; for (let y = 6; y < h - 4; y += 4 + r() * 2) { const ph = r() * 6, amp = 1.2 + r() * 2.2; c.strokeStyle = 'rgba(255,238,208,0.15)'; c.lineWidth = 1.5; c.beginPath(); for (let x = 4; x < w - 4; x += 4) { const yy = y + Math.sin(x * 0.11 + ph) * amp; if (x === 4) c.moveTo(x, yy); else c.lineTo(x, yy); } c.stroke(); c.strokeStyle = 'rgba(40,28,18,0.26)'; c.lineWidth = 1.3; c.beginPath(); for (let x = 4; x < w - 4; x += 4) { const yy = y + 2.2 + Math.sin(x * 0.11 + ph) * amp; if (x === 4) c.moveTo(x, yy); else c.lineTo(x, yy); } c.stroke(); }
    c.globalCompositeOperation = 'destination-in'; const g = c.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w * 0.5); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'source-over'; },
  prints: (c, w, h, r) => { for (let i = 0; i < 4; i++) { const x = w * (0.25 + (i % 2) * 0.5), y = h * (0.15 + i * 0.22); c.save(); c.translate(x, y); c.rotate((r() - 0.5) * 0.3); c.fillStyle = 'rgba(30,22,14,0.55)'; c.beginPath(); c.ellipse(0, 0, 8, 15, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(30,22,14,0.55)'; c.beginPath(); c.ellipse(0, -18, 7, 6, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(255,238,208,0.25)'; c.beginPath(); c.ellipse(1.5, 1.5, 7, 13, 0, 0, Math.PI * 2); c.fill(); c.restore(); } },
};
