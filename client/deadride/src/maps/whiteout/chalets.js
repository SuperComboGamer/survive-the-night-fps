// Alpine chalets built the way they are actually built (reference: Tyrolean / Swiss "Blockbau" + Fachwerk farmhouses and pensions, ~1900-1970):
//  * ground floor: horizontal squared LOG courses 0.22 m high, corner joints with alternating 0.26 m log-end overhangs (Vorstoss), dark chinking between courses;
//  * upper floor: white stucco panels in a heavy half-timber frame (posts every ~1.35 m, sill / top rails, K-braces) above a projecting belt beam on log-end joists;
//  * 32-38 deg gable roof: stepped shingle courses, ridge board + ridge cap, carved double barge boards with dentils and a turned pendant, exposed rafter tails and purlin ends,
//    half-round zinc gutters + downpipes, snow-guard rows, a draped snow load with a rolled cornice at the eave, real tapered icicles;
//  * windows 1.2 x 1.3 m: casing, sill with drip, two-light sash with glazing bars, louvred shutters with stiles / rails / hinges / dogs, flower boxes on brackets, lit interior (interior-mapped);
//  * 4-panel plank doors with strap hinges, handle + escutcheon, threshold stone, pent hood on brackets, boot scraper, doormat; door / stair snow trampled;
//  * balcony with joist ends, individual deck planks, turned balusters, moulded rail, posts with knee braces;
//  * stone chimney in courses with corbelled cap, two flue pots, flashing and a lightning rod; woodpiles, tools, buckets, sled, ski rack, potted fir, wall lantern.
// Every part is Builder geometry (StaticBatch) -- the whole chalet is ~12-16 k triangles and adds no draw calls (same materials as before).
import * as THREE from 'three';
import { Frame, addIcicles, spill, quad } from './common.js';
import { windowQuad, roofSnow, skyOccluder } from './snowkit.js';
import { makeRng } from '../../core/util.js';
import { signMaterial } from '../../core/canvas2d.js';

/** wall along axis 'u' (fixed v) or 'v' (fixed u) from a to b with openings [{c,w,y0,y1}] (positions along the wall) */
export function wall(F, ax, fixed, a, b, y0, y1, t, mat, openings = [], col = 'wood') {
  const put = (from, to, ya, yb) => { if (to - from < 0.01 || yb - ya < 0.01) return; const c = (from + to) / 2, l = to - from;
    if (ax === 'u') F.box({ p: [c, ya, fixed], s: [l, yb - ya, t], mat, bevel: 0.015, col }); else F.box({ p: [fixed, ya, c], s: [t, yb - ya, l], mat, bevel: 0.015, col }); };
  const ops = [...openings].sort((p, q) => p.c - q.c); let cur = a;
  for (const o of ops) { const o0 = o.c - o.w / 2, o1 = o.c + o.w / 2; put(cur, o0, y0, y1); put(o0, o1, y0, o.y0); put(o0, o1, o.y1, y1); cur = o1; }
  put(cur, b, y0, y1);
}

/** horizontal log wall: courses of squared logs; ends overhang on alternate courses (parity swaps between perpendicular walls); openings are cut per course */
function logWall(F, M, ax, fixed, a, b, y0, y1, t, ops, rng, parity, ext = 0.26) {
  const n = Math.max(3, Math.round((y1 - y0) / 0.22)), ch = (y1 - y0) / n;
  for (let j = 0; j < n; j++) {
    const ya = y0 + j * ch, ym = ya + ch * 0.5, over = (j + parity) % 2 === 0 ? ext : 0.0; let segs = [[a - over, b + over]];
    for (const o of ops) if (ym >= o.y0 && ym <= o.y1) { const o0 = o.c - o.w / 2, o1 = o.c + o.w / 2, nx = []; for (const [s0, s1] of segs) { if (o1 <= s0 || o0 >= s1) nx.push([s0, s1]); else { if (o0 > s0 + 0.02) nx.push([s0, o0]); if (o1 < s1 - 0.02) nx.push([o1, s1]); } } segs = nx; }
    for (const [s0, s1] of segs) { const c = (s0 + s1) / 2, l = s1 - s0, tt = t * (0.97 + 0.06 * rng()), hh = ch * (0.93 + 0.04 * rng());
      if (ax === 'u') F.box({ p: [c, ya + (ch - hh) * 0.5, fixed], s: [l, hh, tt], mat: M.log, bevel: 0.03, col: false, cast: false }); else F.box({ p: [fixed, ya + (ch - hh) * 0.5, c], s: [tt, hh, l], mat: M.log, bevel: 0.03, col: false, cast: false }); }
  }
}

/** build one chalet. spec: {x,z,yaw,w,d,floors,h1,pitch,shutter,lit,hollow,openings:[{wall:'front|back|left|right', c, w, h, sill, kind:'door|window|barricade'}],balcony,chimney,seed,sign} */
export function chalet(B, M, ctx, spec) {
  const s = { floors: 1, h1: 2.9, h2: 2.6, pitch: 0.62, ov: 1.1, shutter: 'red', lit: true, hollow: false, openings: [], balcony: false, chimney: true, seed: 1, ...spec };
  const F = new Frame(B, s.x, s.z, s.yaw || 0, 0), rng = makeRng(s.seed * 17 + 3); const { w, d } = s; const hw = w / 2, hd = d / 2, t = 0.32;
  const Hh = s.h1 + (s.floors > 1 ? s.h2 : 0); const shut = { red: M.paintRed, green: M.paintGreen, blue: M.paintBlue }[s.shutter];
  const out = { windows: [], doors: [], lamps: [], eaveY: Hh, roofTop: 0, F };
  const wallOpenings = { front: [], back: [], left: [], right: [] };
  for (const o of s.openings) wallOpenings[o.wall].push({ c: o.c, w: o.w, y0: o.sill, y1: o.sill + o.h, kind: o.kind, floor: o.floor || 0 });
  const pos = (wl, c, y, off) => wl === 'front' ? [c, y, -hd - off] : wl === 'back' ? [c, y, hd + off] : wl === 'left' ? [-hw - off, y, c] : [hw + off, y, c];
  const sizeFor = (wl, a, b, c2) => (wl === 'front' || wl === 'back') ? [a, b, c2] : [c2, b, a];
  const nrm = (wl) => wl === 'front' ? [-Math.sin(F.yaw), -Math.cos(F.yaw)] : wl === 'back' ? [Math.sin(F.yaw), Math.cos(F.yaw)] : wl === 'left' ? [-F.c, F.s] : [F.c, -F.s];
  const box = (wl, c, y, a, b, c2, off, mat, o = {}) => F.box({ p: pos(wl, c, y, off), s: sizeFor(wl, a, b, c2), mat, bevel: o.bevel ?? 0.008, col: false, cast: false, ...(o.tilt ? (wl === 'front' || wl === 'back' ? { pitch: o.tilt } : { roll: o.tilt }) : {}) });
  // ---------------------------------------------------------------- foundation: stone plinth with quoins + drip ledge, interior floor
  F.box({ p: [0, -0.5, 0], s: [w + 0.34, 0.5, d + 0.34], mat: M.stone, bevel: 0.03, col: false, cast: false });
  if (s.hollow) F.box({ p: [0, 0, 0], s: [w - t, 0.05, d - t], mat: M.timberV, bevel: 0.005, col: false, cast: false });
  if (!s.hollow) B.colliders.addBox({ x: F.x, y: Hh / 2, z: F.z, hx: w / 2, hy: Hh / 2, hz: d / 2, yaw: F.yaw, surface: 'wood', walk: false });
  const wcol = s.hollow ? 'wood' : false;
  const layerOps = (wl, floor) => wallOpenings[wl].filter((o) => (o.floor || 0) === floor);
  const cfg = { front: ['u', -hd + t / 2, -hw, hw, 0], back: ['u', hd - t / 2, -hw, hw, 0], left: ['v', -hw + t / 2, -hd, hd, 1], right: ['v', hw - t / 2, -hd, hd, 1] };
  // ground floor: dark chinking core (also the collider walls of hollow chalets) + log courses in front of it
  for (const wl of ['front', 'back', 'left', 'right']) { const [ax, fixed, a, b, par] = cfg[wl]; const ops = layerOps(wl, 0).map((o) => ({ c: o.c, w: o.w, y0: o.y0, y1: o.y1 }));
    wall(F, ax, fixed, a, b, 0, s.h1, t * 0.7, M.dark, ops, wcol); logWall(F, M, ax, fixed + (wl === 'front' || wl === 'left' ? -1 : 1) * t * 0.14, a, b, 0, s.h1, t * 0.72, ops, rng, par); }
  // stone veneer skirt (0.9 m) in rough courses with quoins: door / barricade openings that reach the ground stay open
  for (const wl of ['front', 'back']) { const ops = layerOps(wl, 0).filter((o) => o.y0 < 0.9).map((o) => ({ c: o.c, w: o.w, y0: 0, y1: 0.9 })); wall(F, 'u', wl === 'front' ? -hd - 0.02 : hd + 0.02, -hw, hw, 0, 0.9, 0.09, M.stone, ops, false); }
  wall(F, 'v', -hw - 0.02, -hd, hd, 0, 0.9, 0.09, M.stone, [], false); wall(F, 'v', hw + 0.02, -hd, hd, 0, 0.9, 0.09, M.stone, [], false);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) for (let q = 0; q < 4; q++) F.box({ p: [su * (hw + 0.03), q * 0.225, sv * (hd + 0.03)], s: [q % 2 ? 0.34 : 0.5, 0.2, q % 2 ? 0.5 : 0.34], mat: M.stone, bevel: 0.03, col: false, cast: false });                    // quoins
  F.box({ p: [0, 0.9, 0], s: [w + 0.16, 0.06, d + 0.16], mat: M.stone, bevel: 0.02, col: false, cast: false });                                                                                 // plinth drip ledge
  // upper floor: stucco panels + half-timber frame; belt beam on projecting joist ends
  if (s.floors > 1) {
    F.box({ p: [0, s.h1 - 0.13, 0], s: [w + 0.06, 0.26, d + 0.06], mat: M.beam, bevel: 0.03, col: false, cast: false });
    for (const wl of ['front', 'back', 'left', 'right']) { const [ax, fixed, a, b] = cfg[wl]; const ops = layerOps(wl, 1).map((o) => ({ c: o.c, w: o.w, y0: o.y0, y1: o.y1 }));
      wall(F, ax, fixed, a, b, s.h1, Hh, t, M.plaster, ops, wcol);
      const nsgn = wl === 'front' || wl === 'left' ? -1 : 1, off = nsgn * (t / 2 + 0.03), len = b - a, np = Math.max(2, Math.round(len / 1.35)); const put = (c, y, l, hgt, mat, tilt = 0) => (ax === 'u' ? F.box({ p: [c, y, fixed + off], s: [l, hgt, 0.09], mat, bevel: 0.012, col: false, cast: false, roll: tilt }) : F.box({ p: [fixed + off, y, c], s: [0.09, hgt, l], mat, bevel: 0.012, col: false, cast: false, pitch: tilt }));
      put((a + b) / 2, s.h1 + 0.11, len + 0.1, 0.16, M.beam); put((a + b) / 2, Hh - 0.13, len + 0.1, 0.16, M.beam);                                                   // sill + top rails
      const clear = (c, half) => ops.every((o) => Math.abs(o.c - c) > o.w / 2 + half);
      for (let i = 0; i <= np; i++) { const c = a + len * i / np; if (i > 0 && i < np && !clear(c, 0.08)) continue; ax === 'u' ? F.box({ p: [c, s.h1 + 0.1, fixed + off], s: [0.14, Hh - s.h1 - 0.2, 0.1], mat: M.beam, bevel: 0.015, col: false, cast: false }) : F.box({ p: [fixed + off, s.h1 + 0.1, c], s: [0.1, Hh - s.h1 - 0.2, 0.14], mat: M.beam, bevel: 0.015, col: false, cast: false }); }
      for (let i = 0; i < np; i++) { const c0 = a + len * i / np, c1 = a + len * (i + 1) / np, cm = (c0 + c1) / 2; if (!clear(cm, (c1 - c0) * 0.42) || (i + (s.seed | 0)) % 3 === 0) continue; const y0 = s.h1 + 0.2, y1 = Hh - 0.22, dir = (i % 2 ? 1 : -1); const A = ax === 'u' ? [c0 + 0.1, y0, fixed + off] : [fixed + off, y0, c0 + 0.1], Bp = ax === 'u' ? [c1 - 0.1, y1, fixed + off] : [fixed + off, y1, c1 - 0.1]; void dir; F.beam(A, Bp, 0.09, 0.12, { mat: M.beam, col: false, cast: false }); }   // K / diagonal braces
    }
    for (const su of [-1, 1]) for (const sv of [-1, 1]) F.box({ p: [su * hw, s.h1, sv * hd], s: [0.24, Hh - s.h1 + 0.1, 0.24], mat: M.beam, bevel: 0.03, col: false, cast: false });               // corner posts
  }
  // eaves plate / wall plate
  F.box({ p: [0, Hh, 0], s: [w + 0.34, 0.24, d + 0.34], mat: M.beam, bevel: 0.03, col: false, cast: false });
  if (!s.hollow) F.box({ p: [0, 0, 0], s: [w - 0.3, Hh, d - 0.3], mat: M.dark, col: false, cast: false });
  // ---------------------------------------------------------------- openings: windows (casing, sash, sill, shutters, boxes), doors (frame, 4 panels, hinges, hood)
  const decorate = (wl, o) => {
    const hy = o.y0, hh = o.y1 - o.y0, cw = o.w, front = wl === 'front' || wl === 'back'; const nsgn = wl === 'front' || wl === 'left' ? -1 : 1; void nsgn;
    const trim = (c, y, a, b2) => box(wl, c, y, a, b2, 0.14, 0.05, M.beam, { bevel: 0.012 });
    trim(o.c - cw / 2 - 0.06, hy - 0.07, 0.12, hh + 0.16); trim(o.c + cw / 2 + 0.06, hy - 0.07, 0.12, hh + 0.16); trim(o.c, hy + hh + 0.02, cw + 0.34, 0.13); if (hy > 0.3) trim(o.c, hy - 0.13, cw + 0.4, 0.09);
    if (o.kind === 'window') {
      const n = nrm(wl); if (s.lit) windowQuad(B, M.win, F.p(...pos(wl, o.c, hy + hh / 2, -0.1)), n, cw, hh, (Math.abs(Math.round(o.c * 7 + s.seed * 3)) % 4)); else box(wl, o.c, hy, cw, hh, 0.04, -0.06, M.dark, { bevel: 0.004 });
      // sash: frame + glazing bars (the shader draws the same bars, these give real depth + shadow)
      const sw = 0.055, sp = -0.05; box(wl, o.c - cw / 2 + sw / 2, hy, sw, hh, 0.05, sp, M.beam); box(wl, o.c + cw / 2 - sw / 2, hy, sw, hh, 0.05, sp, M.beam); box(wl, o.c, hy, cw, sw, 0.05, sp, M.beam); box(wl, o.c, hy + hh - sw, cw, sw, 0.05, sp, M.beam);
      box(wl, o.c, hy, 0.035, hh, 0.04, sp - 0.005, M.beam); box(wl, o.c, hy + hh * 0.55, cw, 0.035, 0.04, sp - 0.005, M.beam);
      box(wl, o.c + 0.16, hy + hh * 0.5, 0.03, 0.12, 0.04, sp + 0.04, M.iron);                                                                                                                                  // sash handle
      // sill (projecting, sloped, drip groove) + flower box on brackets with snow and dead stems
      box(wl, o.c, hy - 0.05, cw + 0.3, 0.07, 0.22, 0.13, M.beam, { bevel: 0.015, tilt: front ? 0.08 : -0.08 });
      for (const sd of [-1, 1]) F.beam(F.p(...pos(wl, o.c + sd * cw * 0.36, hy - 0.06, 0.06)), F.p(...pos(wl, o.c + sd * cw * 0.36, hy - 0.5, 0.3)), 0.05, 0.05, { mat: M.beam, col: false, cast: false });
      box(wl, o.c, hy - 0.42, cw + 0.16, 0.28, 0.26, 0.24, M.timberV, { bevel: 0.015 }); box(wl, o.c, hy - 0.3, cw + 0.05, 0.05, 0.02, 0.36, M.beam);
      for (let k = 0; k < 7; k++) { const q = pos(wl, o.c - cw * 0.42 + k * cw * 0.14, hy - 0.26, 0.24 + (rng() - 0.5) * 0.07); F.beam(F.p(q[0], q[1], q[2]), F.p(q[0] + (rng() - 0.5) * 0.12, q[1] + 0.14 + rng() * 0.16, q[2] + (rng() - 0.5) * 0.06), 0.012, 0.012, { mat: M.iron, col: false, cast: false }); }
      F.rock({ p: pos(wl, o.c, hy - 0.2, 0.24), r: cw * 0.46, squash: front ? [1.2, 0.26, 0.5] : [0.5, 0.26, 1.2], amp: 0.32, seed: 3 + ((o.c * 3) | 0) % 5, detail: 1, mat: M.snow, cast: false });
      // louvred shutters (open, folded flat against the wall): stiles, rails, tilted slats, hinges, shutter dog
      if (wl === 'front' || (wl === 'left' && s.seed % 2)) for (const sd of [-1, 1]) {
        const sc = o.c + sd * (cw / 2 + 0.36), sh = hh + 0.05, sy = hy - 0.02, swid = 0.6; box(wl, sc - swid / 2 + 0.03, sy, 0.06, sh, 0.035, 0.06, shut); box(wl, sc + swid / 2 - 0.03, sy, 0.06, sh, 0.035, 0.06, shut);
        for (const ry of [0.04, sh * 0.5, sh - 0.04]) box(wl, sc, sy + ry, swid, 0.07, 0.035, 0.06, shut);
        const ns = Math.floor((sh - 0.2) / 0.075); for (let k = 0; k < ns; k++) box(wl, sc, sy + 0.1 + k * ((sh - 0.2) / ns), swid - 0.1, 0.055, 0.012, 0.085, shut, { bevel: 0.002, tilt: 0.55 });
        for (const hy2 of [0.18, sh - 0.18]) box(wl, sc - sd * (swid / 2) + sd * 0.0, sy + hy2, 0.1, 0.03, 0.012, 0.09, M.iron); box(wl, sc + sd * (swid / 2 - 0.04), sy + sh * 0.45, 0.03, 0.08, 0.02, 0.1, M.iron);
      } else for (const sd of [-1, 1]) box(wl, o.c + sd * (cw / 2 + 0.36), hy - 0.02, 0.62, hh + 0.04, 0.05, 0.06, shut);
      if (s.lit) { const [gx, gy, gz] = pos(wl, o.c, hy + hh / 2, 0.06); out.windows.push({ x: gx, y: gy, z: gz, wl, w: cw, h: hh, c: o.c, yaw: F.yaw, sgn: wl === 'front' ? -1 : wl === 'back' ? 1 : 0 }); }
    } else if (o.kind === 'door' || o.kind === 'barricade') {
      const dp = pos(wl, o.c, 0, -0.06); if (o.kind === 'door') {
        const lw = cw - 0.1, lh = hh - 0.06, sd = 0.11; box(wl, o.c, 0.0, lw, lh, 0.06, -0.05, M.timberV, { bevel: 0.01 });                                            // leaf
        box(wl, o.c - lw / 2 + sd / 2, 0, sd, lh, 0.075, -0.03, M.beam); box(wl, o.c + lw / 2 - sd / 2, 0, sd, lh, 0.075, -0.03, M.beam); for (const ry of [0, lh * 0.5 - 0.05, lh - 0.13]) box(wl, o.c, ry, lw, 0.13, 0.075, -0.03, M.beam);   // stiles + rails
        for (const [px0, py0, , ph] of [[-1, 0.13, 0.5, 0.5], [1, 0.13, 0.5, 0.5], [-1, lh * 0.5 + 0.08, 0.5, lh * 0.5 - 0.3], [1, lh * 0.5 + 0.08, 0.5, lh * 0.5 - 0.3]]) box(wl, o.c + px0 * (lw * 0.25), py0, lw * 0.5 - sd - 0.04, ph, 0.03, -0.005, M.timberV, { bevel: 0.01 });   // raised panels
        for (const yy of [0.28, lh - 0.36]) { box(wl, o.c - lw * 0.22, yy, lw * 0.55, 0.045, 0.02, 0.0, M.iron); box(wl, o.c - lw / 2 + 0.06, yy, 0.09, 0.09, 0.03, 0.0, M.iron); }   // strap hinges
        box(wl, o.c + lw / 2 - 0.2, lh * 0.5 - 0.05, 0.05, 0.28, 0.03, 0.02, M.iron); box(wl, o.c + lw / 2 - 0.2, lh * 0.5 + 0.06, 0.14, 0.03, 0.06, 0.05, M.iron);                     // escutcheon + lever handle
        box(wl, o.c, 0.0, lw + 0.02, 0.22, 0.02, 0.0, M.steel, { bevel: 0.004 });                                                                                                    // kick plate
        out.doors.push({ x: dp[0], z: dp[2], wl, c: o.c });
      }
      // threshold stone + step, pent hood on brackets with snow, boot scraper, mat
      box(wl, o.c, -0.12, cw + 0.55, 0.22, 1.15, 0.65, M.stone, { bevel: 0.04 }); box(wl, o.c, -0.02, cw + 0.15, 0.05, 0.16, 0.06, M.stone);
      if (o.kind === 'door') { box(wl, o.c, hy + hh + 0.16, cw + 0.9, 0.09, 1.1, 0.55, M.beam, { bevel: 0.02, tilt: front ? -0.16 : 0.16 }); box(wl, o.c, hy + hh + 0.25, cw + 0.8, 0.28, 1.0, 0.55, M.snow, { bevel: 0.1 }); for (const sd of [-1, 1]) F.beam(F.p(...pos(wl, o.c + sd * (cw / 2 + 0.28), hy + hh + 0.02, 0.06)), F.p(...pos(wl, o.c + sd * (cw / 2 + 0.28), hy + hh - 0.5, 0.95)), 0.08, 0.09, { mat: M.beam, col: false, cast: false });
        box(wl, o.c + cw * 0.7, 0.07, 0.3, 0.14, 0.04, 0.5, M.iron); box(wl, o.c - 0.05, 0.0, 0.85, 0.025, 0.55, 0.7, M.rubber, { bevel: 0.006 }); }
    }
    if (o.kind === 'door' || o.kind === 'barricade') {                                                                     // wall lantern beside the door: bracket, glass box, cap
      const lc = o.c + cw / 2 + 0.5, ly = 2.05; box(wl, lc, ly - 0.12, 0.05, 0.05, 0.16, 0.09, M.iron); box(wl, lc, ly - 0.05, 0.15, 0.26, 0.15, 0.2, M.lampGlow, { bevel: 0.02 }); box(wl, lc, ly + 0.21, 0.2, 0.04, 0.2, 0.2, M.iron);
      const q = pos(wl, lc, ly + 0.08, 0.3); const P0 = F.p(q[0], q[1], q[2]); out.lamps.push({ x: P0[0], y: P0[1], z: P0[2], wl });
    }
  };
  for (const wl of ['front', 'back', 'left', 'right']) for (const o of wallOpenings[wl]) decorate(wl, o);
  // ---------------------------------------------------------------- roof
  skyOccluder(B, F, -hw - s.ov, hw + s.ov, -hd - s.ov, hd + s.ov, Hh, Hh + 0.5);
  const ridgeH = hd * Math.tan(s.pitch), ov = s.ov, ry = Hh + 0.15, tp = Math.tan(s.pitch), RH = ridgeH + ov * tp - 0.05, hdr = hd + ov, pe = Math.atan2(RH, hdr), cpe = Math.cos(pe), spe = Math.sin(pe), lenS = hdr / cpe, ridgeY = ry + RH;
  F.prism({ p: [0, ry, 0], s: [w + 0.02, ridgeH - 0.05, d + 0.04], mat: M.timberV });                                                                            // gable-end infill
  F.prism({ p: [0, ry - 0.03, 0], s: [w + ov * 2 - 0.05, RH - 0.04, d + ov * 2 - 0.05], mat: M.timberV });                                                          // roof deck (dark boards under the shingles)
  { const W = w + ov * 1.9, nc = Math.max(8, Math.round(lenS / 0.27)), ch = lenS / nc, th = 0.032;
    for (const sv of [-1, 1]) { const Pp = [], Nn = [], Uu = [], Ii = []; const pt = (u, sv2, s0, off) => F.p(u, ridgeY - s0 * spe + off * cpe, sv2 * (s0 * cpe) + sv2 * off * spe);
      for (let k = 0; k < nc; k++) { const s0 = k * ch, s1 = (k + 1) * ch, j = (rng() - 0.5) * 0.3, a0 = pt(-W / 2, sv, s0, 0.004), b0 = pt(W / 2, sv, s0, 0.004), b1 = pt(W / 2, sv, s1, th), a1 = pt(-W / 2, sv, s1, th), base = Pp.length / 3;
        Pp.push(...a0, ...b0, ...b1, ...a1); const nz = [0, cpe, sv * spe]; for (let i = 0; i < 4; i++) Nn.push(...nz); Uu.push(-W / 2 + j, s0, W / 2 + j, s0, W / 2 + j, s1, -W / 2 + j, s1); if (sv > 0) Ii.push(base, base + 2, base + 1, base, base + 3, base + 2); else Ii.push(base, base + 1, base + 2, base, base + 2, base + 3);
        if (k < nc - 1) { const c0 = pt(-W / 2, sv, s1, th), c1 = pt(W / 2, sv, s1, th), c2 = pt(W / 2, sv, s1, 0.004), c3 = pt(-W / 2, sv, s1, 0.004), b2 = Pp.length / 3; Pp.push(...c0, ...c1, ...c2, ...c3); const nd = [0, -spe * 0.6, sv * cpe * 0.6 + 0]; for (let i = 0; i < 4; i++) Nn.push(...nd); Uu.push(0, 0, 1, 0, 1, 0.03, 0, 0.03); if (sv > 0) Ii.push(b2, b2 + 2, b2 + 1, b2, b2 + 3, b2 + 2); else Ii.push(b2, b2 + 1, b2 + 2, b2, b2 + 2, b2 + 3); } }
      B.addRaw({ p: new Float32Array(Pp), n: new Float32Array(Nn), u: new Float32Array(Uu), i: new Uint32Array(Ii) }, new THREE.Matrix4(), M.shingle, { cast: true, recv: true });
      // ridge cap, eave gutter + downpipes, snow guards, rafter tails, purlin ends
      const ev = sv * (hdr - 0.03), ey = ry - 0.02; B.tube({ pts: [F.p(-W / 2 + 0.05, ey - 0.03, ev + sv * 0.06), F.p(0, ey - 0.03 - 0.04, ev + sv * 0.06), F.p(W / 2 - 0.05, ey - 0.03, ev + sv * 0.06)], r: 0.055, mat: M.zinc, seg: 6, segs: 6, cast: false });
      for (const su of [-1, 1]) { const dx = su * (hw + ov * 0.55); F.cyl({ p: [dx, 0.12, sv * (hd + 0.14)], r: 0.038, h: ry - 0.35, seg: 6, mat: M.zinc, col: false, cast: false }); for (const yy of [0.6, 1.5, 2.4]) F.cyl({ p: [dx, yy, sv * (hd + 0.14)], r: 0.05, h: 0.05, seg: 6, mat: M.iron, col: false, cast: false }); F.beam([dx, ry - 0.3, sv * (hd + 0.14)], [dx, ry - 0.05, sv * (hdr - 0.05)], 0.06, 0.06, { mat: M.zinc, col: false, cast: false }); }
      for (let r2 = 0; r2 < 2; r2++) for (let u = -W / 2 + 0.4; u < W / 2 - 0.3; u += 0.55) { const s0 = lenS * (0.74 - r2 * 0.1), p = pt(u, sv, s0, 0.05); B.box({ p: [p[0], p[1], p[2]], s: [0.2, 0.09, 0.04], yaw: F.yaw, pitch: 0, mat: M.iron, col: false, cast: false, bevel: 0 }); }
      const nr = Math.floor((w + 2 * ov - 0.5) / 0.78); for (let i = 0; i <= nr; i++) { const u = -w / 2 - ov + 0.25 + i * ((w + 2 * ov - 0.5) / nr); F.beam([u, ry - 0.13, sv * (hdr - 0.4)], [u, ry - 0.02, sv * (hdr + 0.02)], 0.1, 0.16, { mat: M.beam, col: false, cast: false }); }
    } }
  F.box({ p: [0, ridgeY - 0.02, 0], s: [w + ov * 1.9, 0.07, 0.34], mat: M.timberV, bevel: 0.015, col: false, cast: false }); F.cyl({ p: [0, ridgeY + 0.08, 0], r: 0.07, h: w + ov * 1.9, seg: 8, mat: M.timberV, roll: Math.PI / 2, anchor: 'center', col: false, cast: false });   // ridge board + ridge roll
  for (const sd of [-1, 1]) {                                                                                                          // gable rakes: double barge boards with dentils, apex pendant, purlin ends
    const x = sd * (hw + ov - 0.03); for (const sv of [-1, 1]) { const A = [x, ry + 0.06, sv * hdr], Bp = [x, ridgeY + 0.05, 0]; F.beam(A, Bp, 0.06, 0.22, { mat: M.beam, col: false, cast: false }); F.beam([x + sd * 0.05, A[1] - 0.2, A[2] - sv * 0.14], [x + sd * 0.05, Bp[1] - 0.2, 0.0], 0.05, 0.13, { mat: M.timberV, col: false, cast: false });
      const nd = Math.floor(hdr / 0.34); for (let k = 1; k < nd; k++) { const q = k / nd, py = ry + 0.06 + (ridgeY - ry) * q - 0.12, pz = sv * hdr * (1 - q); F.box({ p: [x + sd * 0.02, py - 0.05, pz], s: [0.06, 0.08, 0.1], mat: M.beam, bevel: 0.006, col: false, cast: false }); } }
    F.lathe({ p: [x + sd * 0.03, ridgeY - 0.6, 0], profile: [[0.001, 0], [0.05, 0.02], [0.03, 0.08], [0.06, 0.16], [0.02, 0.26], [0.045, 0.36], [0.001, 0.5]], seg: 8, mat: M.beam, col: false, cast: false });
    for (const yy of [ry + (ridgeY - ry) * 0.34, ry + (ridgeY - ry) * 0.68]) F.cyl({ p: [x + sd * 0.12, yy, 0], r: 0.075, h: 0.34, seg: 8, mat: M.beam, roll: Math.PI / 2, anchor: 'center', col: false, cast: false });
  }
  { const RHs = RH, hdr2 = hd + ov; roofSnow(B, M.snow, F, { w, d, ridgeY, pitch: Math.atan2(RHs, hdr2), ov, seed: s.seed, depth: 0.38 }); }
  out.roofTop = ridgeY + 0.1;
  // real tapered icicles along both eaves (clumped, uneven) + drip stains below the gutters
  const ey2 = ry - 0.02, p0 = F.p(-hw - ov + 0.2, ey2, -hd - ov + 0.05), p1 = F.p(hw + ov - 0.2, ey2, -hd - ov + 0.05), q0 = F.p(-hw - ov + 0.2, ey2, hd + ov - 0.05), q1 = F.p(hw + ov - 0.2, ey2, hd + ov - 0.05);
  addIcicles(B, M.ice, [p0[0], p0[2]], [p1[0], p1[2]], { seed: s.seed, y: ey2 - 0.07, every: 0.2 }); addIcicles(B, M.ice, [q0[0], q0[2]], [q1[0], q1[2]], { seed: s.seed + 5, y: ey2 - 0.07, every: 0.2 });
  // lit attic windows in the gable ends with their own casing and shutters
  if (s.lit) for (const sd of [-1, 1]) { const y = ry + Math.min(ridgeH * 0.34, 1.3), n = sd < 0 ? [-F.c, F.s] : [F.c, -F.s], pc = F.p(sd * (hw + 0.04), y, 0);
    windowQuad(B, M.win, pc, n, 0.82, 0.95, (s.seed + (sd > 0 ? 1 : 3)) % 4); for (const dz of [-1, 1]) F.box({ p: [sd * (hw + 0.06), y - 0.52, dz * 0.5], s: [0.07, 1.08, 0.09], mat: M.beam, bevel: 0.01, col: false, cast: false }); F.box({ p: [sd * (hw + 0.06), y + 0.52, 0], s: [0.07, 0.09, 1.1], mat: M.beam, bevel: 0.01, col: false, cast: false }); F.box({ p: [sd * (hw + 0.06), y - 0.05, 0], s: [0.06, 0.03, 0.95], mat: M.beam, col: false, cast: false });
    for (const dz of [-1, 1]) F.box({ p: [sd * (hw + 0.08), y - 0.5, dz * 0.62], s: [0.03, 1.0, 0.44], mat: shut, col: false, cast: false });
    out.windows.push({ x: pc[0], y: pc[1], z: pc[2], wl: sd < 0 ? 'left' : 'right', w: 0.82, h: 0.95, c: 0, yaw: F.yaw, sgn: 0 }); }
  if (s.sign) { const g = s.sign; const sm = signMaterial({ lines: g.lines, bg: g.bg || '#2a1a10', fg: g.fg || '#f0d9a8', w: 512, h: 160, glow: 1.5, weather: 0.35, border: true }); B.m('chSign' + s.seed, sm); const gh = g.h || 0.6;
    F.box({ p: [g.c, g.y, -hd - 0.16], s: [g.w + 0.1, gh + 0.1, 0.06], mat: M.timber, bevel: 0.01, col: false, cast: false }); quad(B, sm, F.p(g.c, g.y + gh / 2 + 0.05, -hd - 0.195), g.w, gh, F.yaw + Math.PI);
    for (const sx of [-1, 1]) { F.box({ p: [g.c + sx * g.w * 0.4, g.y + gh + 0.05, -hd - 0.1], s: [0.04, 0.18, 0.14], mat: M.iron, col: false, cast: false }); F.beam([g.c + sx * g.w * 0.46, g.y + gh + 0.12, -hd - 0.06], [g.c + sx * g.w * 0.46, g.y + gh - 0.1, -hd - 0.5], 0.03, 0.03, { mat: M.iron, col: false, cast: false }); }
    const q = F.p(g.c, g.y + 0.25, -hd - 0.5); out.lamps.push({ x: q[0], y: q[1], z: q[2], wl: 'front', big: true }); }
  // ---------------------------------------------------------------- chimney: stone in courses, corbelled cap, two flue pots, flashing, lightning rod
  if (s.chimney) { const cx = w * 0.28, cz = 0, ch = ridgeH + 2.4; const top = Hh + ch; for (let k = 0; k < Math.floor(ch / 0.26); k++) { const y = Hh + k * 0.26; F.box({ p: [cx + (rng() - 0.5) * 0.02, y, cz + (rng() - 0.5) * 0.02], s: [0.9 + (k % 2) * 0.02, 0.245, 0.9], mat: M.stone, bevel: 0.03, col: false, cast: false }); }
    F.box({ p: [cx, top - 0.02, cz], s: [1.06, 0.1, 1.06], mat: M.concrete, bevel: 0.02, col: false, cast: false }); F.box({ p: [cx, top + 0.08, cz], s: [1.16, 0.14, 1.16], mat: M.concrete, bevel: 0.03, col: false, cast: false });
    for (const dz of [-0.2, 0.2]) { F.cyl({ p: [cx, top + 0.22, cz + dz], r: 0.13, h: 0.42, seg: 10, mat: M.stone, col: false, cast: false }); F.cyl({ p: [cx, top + 0.62, cz + dz], r: 0.16, h: 0.05, seg: 10, mat: M.concrete, col: false, cast: false }); }
    F.cyl({ p: [cx + 0.42, top + 0.1, cz + 0.42], r: 0.012, h: 1.0, seg: 5, mat: M.iron, col: false, cast: false }); F.box({ p: [cx, ridgeY - 0.1, cz], s: [1.25, 0.07, 1.25], mat: M.zinc, bevel: 0.01, col: false, cast: false });
    out.chimney = F.p(cx, top + 0.7, cz); }
  // ---------------------------------------------------------------- balcony on the front of two-floor chalets: joist ends, deck planks, turned balusters, moulded rail, knee-braced posts
  if (s.balcony && s.floors > 1) {
    const bw = w * 0.72, bz = -hd - 1.45, by = s.h1 + 0.02;
    for (let i = 0; i < 8; i++) F.box({ p: [(-0.5 + i / 7) * bw, by - 0.16, -hd - 0.75], s: [0.14, 0.16, 1.62], mat: M.log, bevel: 0.015, col: false, cast: false });                       // joists (log ends show on the wall)
    for (let i = 0; i < Math.floor(bw / 0.15); i++) F.box({ p: [-bw / 2 + 0.08 + i * 0.15, by, -hd - 0.75], s: [0.135, 0.04, 1.5], mat: M.timberV, bevel: 0.006, col: i === 0 ? 'wood' : false, cast: false });
    F.box({ p: [0, by - 0.02, -hd - 0.75], s: [bw, 0.05, 1.5], mat: M.dark, col: 'wood', walk: false, cast: false });
    F.box({ p: [0, by + 1.0, bz], s: [bw + 0.1, 0.075, 0.12], mat: M.beam, bevel: 0.03, col: false, cast: false }); F.box({ p: [0, by + 0.1, bz], s: [bw, 0.06, 0.08], mat: M.beam, bevel: 0.01, col: false, cast: false });
    for (const sx of [-1, 1]) F.box({ p: [sx * bw / 2, by, -hd - 0.75], s: [0.08, 1.0, 1.5], mat: M.beam, bevel: 0.01, col: false, cast: false });
    for (let i = 0; i <= Math.floor(bw / 0.18); i++) F.lathe({ p: [-bw / 2 + 0.05 + i * ((bw - 0.1) / Math.floor(bw / 0.18)), by + 0.1, bz], profile: [[0.001, 0], [0.028, 0.01], [0.024, 0.06], [0.036, 0.16], [0.02, 0.28], [0.034, 0.44], [0.02, 0.6], [0.032, 0.74], [0.024, 0.88], [0.001, 0.9]], seg: 7, mat: M.beam, col: false, cast: false });
    for (const su of [-1, 1]) { F.box({ p: [su * bw / 2, 0, bz], s: [0.2, s.h1 + 1.1, 0.2], mat: M.beam, bevel: 0.03, col: 'wood', walk: false }); F.beam([su * bw / 2, s.h1 - 0.75, bz], [su * bw / 2, s.h1 - 0.15, bz + 0.75], 0.09, 0.09, { mat: M.beam, col: false, cast: false }); }
    F.box({ p: [0, by + 1.08, bz], s: [bw + 0.05, 0.18, 0.4], mat: M.snow, bevel: 0.09, col: false, cast: false });
    for (let k = 0; k < 3; k++) F.box({ p: [-bw * 0.3 + k * bw * 0.3 + (rng() - 0.5) * 0.2, by + 0.04, bz + 0.25 + rng() * 0.3], s: [0.4 + rng() * 0.3, 0.06, 0.3 + rng() * 0.3], mat: M.snow, bevel: 0.03, col: false, cast: false });
  }
  // ---------------------------------------------------------------- yard clutter: woodpile + stump with axe under the eave, bucket, shovel, sled, skis, potted fir, doormat trampled snow
  { const side = s.seed % 2 ? 1 : -1;
    // firewood stack against the side wall: 7 rows of split logs (varied length / diameter), under a lean-to board
    { const lg = new THREE.CylinderGeometry(0.06, 0.06, 1, 7); lg.rotateZ(Math.PI / 2); const rows = 7, cols = 10;                              // logs lie perpendicular to the wall: cross-section grid in (v, y)
      for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols - (r % 2); c2++) { const rr = 0.046 + rng() * 0.028, len = 0.42 + rng() * 0.16; const p = F.p(side * (hw + 0.12 + len / 2), rr + r * 0.1, -hd * 0.3 + (c2 - cols / 2) * 0.125 + (r % 2) * 0.06 + (rng() - 0.5) * 0.01);
        B.instance('logend', lg, M.log, B.matrix([p[0], p[1], p[2]], F.yaw, [len, rr / 0.06, rr / 0.06]), 0xffffff, { cast: false }); }
      F.box({ p: [side * (hw + 0.42), 0.8, -hd * 0.3], s: [0.9, 0.05, 1.4], mat: M.timberV, roll: side * -0.1, bevel: 0.01, col: false, cast: false }); F.rock({ p: [side * (hw + 0.42), 0.92, -hd * 0.3], r: 0.6, squash: [0.9, 0.2, 1.3], amp: 0.3, seed: 6, detail: 1, mat: M.snow, cast: false }); }
    F.cyl({ p: [-side * (hw + 0.7), 0.0, -hd - 0.8], r: 0.22, h: 0.42, seg: 10, mat: M.log, col: false, cast: false }); F.box({ p: [-side * (hw + 0.7), 0.42, -hd - 0.8], s: [0.06, 0.07, 0.6], mat: M.iron, yaw: 0.4, bevel: 0, col: false, cast: false });       // chopping stump + axe
    F.cyl({ p: [-side * (hw - 0.6), 0, -hd - 1.9], r: [0.14, 0.17], h: 0.3, seg: 10, mat: M.zinc, col: false, cast: false }); F.rock({ p: [-side * (hw - 0.6), 0.3, -hd - 1.9], r: 0.16, squash: [1, 0.3, 1], amp: 0.3, seed: 4, detail: 1, mat: M.snow, cast: false });                                             // bucket
    F.beam([hw * 0.6 * side, 0.02, -hd - 0.3], [hw * 0.6 * side + 0.2, 1.3, -hd - 0.03], 0.04, 0.04, { mat: M.beam, col: false, cast: false }); F.box({ p: [hw * 0.6 * side + 0.22, 1.25, -hd - 0.03], s: [0.3, 0.04, 0.24], mat: M.zinc, bevel: 0.006, col: false, cast: false });                       // shovel against the wall
    for (let k = 0; k < 3; k++) F.beam([-hw * 0.55 + k * 0.1, 0.02, -hd - 0.18 - k * 0.02], [-hw * 0.55 + k * 0.1 + 0.16, 1.75 - k * 0.05, -hd - 0.03], 0.03, 0.012, { mat: [M.paintRed, M.paintBlue, M.iron][k], col: false, cast: false });                                                     // skis leaning
    { const pn = pineGeo(); if (pn) { const p = F.p(hw * 0.35 * side, 0.36, -hd - 0.75); F.cyl({ p: [hw * 0.35 * side, 0, -hd - 0.75], r: [0.22, 0.28], h: 0.36, seg: 10, mat: M.stone, col: false, cast: false }); B.instance('potfir', pn, M.pine, B.matrix([p[0], p[1], p[2]], rng() * 6, 0.16 + rng() * 0.05), 0xffffff, { cast: false }); } }
  }
  return out;
}
let _pine = null;
/** small potted fir geometry (shared): injected lazily from trees.js to avoid an import cycle at module load */
function pineGeo() { return _pine; }
export function setPotFir(g) { _pine = g; }
