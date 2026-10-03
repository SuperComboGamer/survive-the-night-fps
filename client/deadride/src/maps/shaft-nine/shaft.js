// Shaft lining + hardware shared by the route (between stops) and each stop's shaft stub. Coordinates are the same in both:
// the shaft interior is x in [-2.1, 2.1], z in [-1.5, 1.5]; the landing/front wall is +z. Guides run on steel buntons at the side walls.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { signMaterial } from '../../core/canvas2d.js';
import { makeRng } from '../../core/util.js';
import { SHAFT, OPEN, PI, cylBetween, lin, at, lightPool, signQuad } from './kit.js';

export const RAIL_X = 1.89;
const T = 0.3; // lining thickness

/** materials for a lining style: 'timber' | 'concrete' | 'rock' | 'hot' (created on the Builder, cached by name) */
export function shaftMats(B, style) {
  const M = {};
  M.steel = B.m('shSteel', { pattern: 'plates', size: 512, tile: 2, colors: [0x3d3f42, 0x2f3134, 0x151617], params: { cols: 1, rows: 1, seam: 0.01, rivets: 0, brushed: 0.6 }, bump: 2, metal: 1, rough: [0.35, 0.7], layers: { rust: 0.15, grime: 0.5, scratch: 0.4, streak: 0.4 }, rustColor: 0x4a2a16 });
  M.rail = B.m('shRail', std({ color: 0x5a5d61, metalness: 1, roughness: 0.32, key: 'shRail' }));
  M.void = B.m('shVoid', std({ color: 0x010101, roughness: 1, key: 'shVoid' }));
  M.lampGlow = B.m('shLampGlow', std({ color: 0x000000, emissive: 0xffa850, emissiveIntensity: 11, key: 'shLampGlow' }));
  M.signalR = B.m('shSigR', std({ color: 0x000000, emissive: 0xff2a10, emissiveIntensity: 9, key: 'shSigR' }));
  M.signalG = B.m('shSigG', std({ color: 0x000000, emissive: 0x30ff60, emissiveIntensity: 7, key: 'shSigG' }));
  if (style === 'timber') {
    M.wall = B.m('shTimberWall', { pattern: 'planks', size: 512, tile: 2, colors: [0x4a3a29, 0x2a2016, 0x0c0906], params: { rows: 9, gap: 0.006, grain: 8, knots: 0.3, cols: 1, vertical: 1, weather: 0.9, nails: 1 }, bump: 5, rough: [0.7, 0.95], layers: { grime: 0.6, streak: 0.5, moss: 0.1 } }, { breakup: 0.5, wet: true });
    M.frame = B.m('shTimberFrame', { pattern: 'wood', size: 512, tile: 1.5, colors: [0x5d4930, 0x2d2216], params: { scale: 14, rings: 9, knots: 0.5, weather: 0.7, vertical: 0 }, bump: 5, rough: [0.7, 0.95], layers: { grime: 0.5, moss: 0.12 } }, { wet: true });
  } else if (style === 'concrete') {
    M.wall = B.m('shConcrete', { pattern: 'noise', size: 1024, tile: 3, colors: [0x4c4c4a, 0x3c3c3a, 0x1e1e1d, 0x6a6a66], params: { scale: 5, contrast: 3, fine: 96, speckle: 0.04, pores: 0.6, panels: 3, panelWidth: 0.004 }, bump: 3, rough: [0.7, 0.95], layers: { grime: 0.7, cracks: 0.5, streak: 0.75, moss: 0.2, rust: 0.12 }, rustColor: 0x4a2c16 }, { breakup: 0.6, wet: true });
    M.frame = M.wall;
  } else if (style === 'rock') {
    M.wall = B.m('shRock', { pattern: 'rock', size: 512, tile: 4, colors: [0x1d1b20, 0x2e2b33, 0x413c48, 0x5c566a], params: { scale: 5, strata: 6, cracks: 0.9, roughness: 0.85, tone: 0.5, moisture: 0.5 }, bump: 90, rough: [0.55, 0.9], layers: { grime: 0.3, moss: 0.15 } }, { triplanar: 1 / 4, breakup: 0.5, wet: true });
    M.frame = M.wall; M.mesh = B.m('shMesh', std({ color: 0x777c80, metalness: 1, roughness: 0.5, key: 'shMeshFallback' }));
  } else {
    M.wall = B.m('shHot', { pattern: 'lava', size: 512, tile: 3, colors: [0x0d0b0b, 0x1b1615, 0xff4a0c, 0xffb040], params: { scale: 3, crackWidth: 0.03, glow: 1.6, crust: 0.8 }, bump: 60, rough: [0.6, 0.95] }, { triplanar: 1 / 3, emissiveIntensity: 0.07 });
    M.frame = M.wall;
  }
  return M;
}

/**
 * Build shaft lining + hardware between absolute (or stop-local) heights y0..y1.
 * cfg: {style, front:[{y0,y1}]  openings in the +z wall, lamps:{halos,every,color}, buntonEvery, collide, seed, ribs}
 */
export function shaftLining(B, M, cfg) {
  const { y0, y1, style, front = [], lamps = null, buntonEvery = 4, collide = false, seed = 1 } = cfg; const r = makeRng(seed * 131 + 5); const H = y1 - y0; const col = collide ? (style === 'timber' ? 'wood' : 'concrete') : false;
  const hx = SHAFT.hx, hz = SHAFT.hz;
  // ---- walls (front wall is split around the landing openings)
  const wall = (x, z, sx, sz, ya, yb, mat = M.wall, o = {}) => { if (yb - ya < 0.01) return; B.box({ p: [x, ya, z], s: [sx, yb - ya, sz], mat, bevel: 0, col, cast: false, ...o }); };
  wall(-(hx + T / 2), 0, T, 2 * hz, y0, y1); wall(hx + T / 2, 0, T, 2 * hz, y0, y1); wall(0, -(hz + T / 2), 2 * (hx + T), T, y0, y1);
  const fz = hz + T / 2, fw = 2 * (hx + T); let y = y0; const ops = [...front].sort((a, b) => a.y0 - b.y0);
  for (const o of ops) { wall(0, fz, fw, T, y, o.y0); wall(-(OPEN.hw + (hx + T - OPEN.hw) / 2), fz, hx + T - OPEN.hw, T, o.y0, o.y1); wall(OPEN.hw + (hx + T - OPEN.hw) / 2, fz, hx + T - OPEN.hw, T, o.y0, o.y1); y = o.y1; }
  wall(0, fz, fw, T, y, y1);
  // ---- style detail: bands / frames / bolts
  if (style === 'concrete') for (let yy = y0 + 1.5; yy < y1; yy += 3) for (const s of [-1, 1]) { B.box({ p: [s * (hx - 0.012), yy, 0], s: [0.03, 0.16, 2 * hz - 0.02], mat: M.wall, bevel: 0.006, cast: false }); B.box({ p: [0, yy, -(hz - 0.012)], s: [2 * hx - 0.02, 0.16, 0.03], mat: M.wall, bevel: 0.006, cast: false }); }
  if (style === 'timber') for (let yy = y0 + 0.2; yy < y1 - 0.2; yy += 1.5) {
    const c = (a, b) => { B.box({ p: [a[0], yy, a[1]], s: [b[0], 0.24, b[1]], mat: M.frame, bevel: 0.012, cast: false }); };
    c([-(hx - 0.06), 0], [0.12, 2 * hz]); c([hx - 0.06, 0], [0.12, 2 * hz]); c([0, -(hz - 0.06)], [2 * hx - 0.24, 0.12]);
    if (!ops.some((o) => yy + 0.24 > o.y0 - 0.1 && yy < o.y1 + 0.1)) c([0, hz - 0.06], [2 * hx - 0.24, 0.12]);
  }
  if (style === 'rock' || style === 'hot') for (let yy = y0 + 1; yy < y1; yy += 2.2) for (let xx = -1.6; xx <= 1.61; xx += 1.07) { const yj = yy + (Math.round(xx * 10) % 2) * 1.1; if (yj > y1) continue; B.box({ p: [xx, yj, -(hz - 0.01)], s: [0.16, 0.16, 0.025], mat: M.steel, bevel: 0.01, cast: false }); B.box({ p: [(xx > 0 ? 1 : -1) * (hx - 0.01) * 1, yj, (xx * 0.7)], s: [0.025, 0.16, 0.16], mat: M.steel, bevel: 0.01, cast: false }); }
  // ---- guide rails + buntons (steel channels across the depth at the side walls)
  for (const s of [-1, 1]) {
    B.box({ p: [s * RAIL_X, y0, 0], s: [0.09, H, 0.14], mat: M.rail, bevel: 0.004, col: false, cast: false });                 // continuous rail (joint plates below)
    for (let yy = y0 + 4.57; yy < y1; yy += 9.14) B.box({ p: [s * (RAIL_X - 0.045), yy - 0.15, 0], s: [0.02, 0.5, 0.2], mat: M.steel, bevel: 0.004, cast: false });
    for (let yy = y0 + 1; yy < y1; yy += buntonEvery) { B.box({ p: [s * (hx - 0.1), yy, 0], s: [0.16, 0.22, 2 * hz - 0.02], mat: M.steel, bevel: 0.01, cast: false }); B.box({ p: [s * (RAIL_X - 0.02), yy + 0.04, 0], s: [0.05, 0.14, 0.3], mat: M.steel, bevel: 0.006, cast: false }); }
  }
  // ---- rear pipe, cable tray, bell wire (rear wall)
  B.box({ p: [-1.62, y0, -(hz - 0.1)], s: [0.2, H, 0.2], mat: M.steel, bevel: 0.05, cast: false, swap: true });
  for (let yy = y0 + 2; yy < y1; yy += 4) B.box({ p: [-1.62, yy, -(hz - 0.1)], s: [0.27, 0.08, 0.27], mat: M.steel, bevel: 0.01, cast: false });
  B.box({ p: [1.3, y0, -(hz - 0.03)], s: [0.32, H, 0.04], mat: M.steel, bevel: 0.006, cast: false }); for (let k = 0; k < 3; k++) B.box({ p: [1.2 + k * 0.1, y0, -(hz - 0.075)], s: [0.028, H, 0.028], mat: M.void, bevel: 0.006, cast: false });
  B.box({ p: [0.55, y0, -(hz - 0.05)], s: [0.012, H, 0.012], mat: M.rail, bevel: 0, cast: false });
  // ---- wall lamps on the rear wall (absolute grid: lamp k at y = 2 + 8k, alternating sides; the cage's strobe light follows the same grid)
  if (lamps) {
    const { halos, every = 8, color = 0xffa850 } = lamps; for (let k = Math.ceil((y0 + 1 - 2) / every); 2 + k * every < y1 - 1; k++) {
      const yy = 2 + k * every, x = (k & 1 ? 1 : -1) * 0.75; B.box({ p: [x, yy - 0.09, -(hz - 0.09)], s: [0.34, 0.18, 0.16], mat: M.steel, bevel: 0.02, cast: false }); B.box({ p: [x, yy - 0.06, -(hz - 0.17)], s: [0.24, 0.12, 0.03], mat: M.lampGlow, bevel: 0.01, cast: false });
      for (let q = -1; q <= 1; q++) B.box({ p: [x + q * 0.1, yy - 0.09, -(hz - 0.2)], s: [0.008, 0.18, 0.008], mat: M.steel, bevel: 0, cast: false });
      halos.add([x, yy - 0.02, -(hz - 0.28)], color, 1.15, 0.85, 0);
    }
  }
}

/** a side adit / level station in the front wall of the shaft at floor height yf: portal frame, a short dark drift with a lamp, rails, sign. */
export function levelStation(B, M, { yf, name, style, halos, seed = 1, lampColor = 0xffa850, wet = true }) {
  const r = makeRng(seed * 91 + 3); const hz = SHAFT.hz; const zf = hz + T; const w = OPEN.hw, h = OPEN.h;
  // portal frame (jambs + lintel), sill plate
  const fm = M.frame;
  for (const s of [-1, 1]) B.box({ p: [s * (w + 0.12), yf, zf + 0.05], s: [0.24, h + 0.25, 0.4], mat: fm, bevel: 0.02, cast: false });
  B.box({ p: [0, yf + h, zf + 0.05], s: [2 * w + 0.6, 0.28, 0.4], mat: fm, bevel: 0.02, cast: false }); B.box({ p: [0, yf - 0.02, zf - 0.02], s: [2 * w, 0.05, 0.6], mat: M.steel, bevel: 0.006, cast: false });
  // the drift behind: floor, walls, ceiling, void end
  const L = 9; const dark = M.void;
  B.box({ p: [0, yf - 0.4, zf + L / 2], s: [2 * w + 0.2, 0.4, L], mat: M.frame, bevel: 0, cast: false });
  for (const s of [-1, 1]) B.box({ p: [s * (w + 0.1), yf, zf + L / 2], s: [0.2, h + 0.1, L], mat: M.wall, bevel: 0, cast: false });
  B.box({ p: [0, yf + h, zf + L / 2], s: [2 * w + 0.4, 0.5, L], mat: M.wall, bevel: 0, cast: false }); B.box({ p: [0, yf, zf + L], s: [2 * w + 0.2, h + 0.3, 0.3], mat: dark, bevel: 0, cast: false });
  for (const s of [-1, 1]) B.box({ p: [s * 0.3, yf + 0.0, zf + L / 2], s: [0.06, 0.09, L], mat: M.rail, bevel: 0.006, cast: false });
  for (let z = 0.4; z < L; z += 0.9) B.box({ p: [0, yf - 0.01, zf + z], s: [1.1, 0.07, 0.12], mat: M.frame, bevel: 0.01, cast: false });
  // timber sets inside
  for (let z = 1.4; z < L; z += 2.6) { for (const s of [-1, 1]) B.box({ p: [s * (w - 0.25), yf, zf + z], s: [0.24, h - 0.1, 0.24], mat: fm, bevel: 0.012, cast: false }); B.box({ p: [0, yf + h - 0.3, zf + z], s: [2 * w, 0.24, 0.26], mat: fm, bevel: 0.012, cast: false }); }
  // lamp inside + halos
  B.sphere({ p: [0.8, yf + h - 0.35, zf + 3.2], r: 0.06, seg: 8, mat: M.lampGlow, cast: false }); halos.add([0.8, yf + h - 0.35, zf + 3.2], lampColor, 1.0, 0.9, 5);
  lightPool(B, [0.6, yf + 0.03, zf + 3.2], 1.9, 0.7, lampColor);
  // signals + sign
  B.box({ p: [w + 0.55, yf + h - 0.65, zf + 0.26], s: [0.14, 0.14, 0.05], mat: r() < 0.5 ? M.signalR : M.signalG, bevel: 0.02, cast: false }); halos.add([w + 0.55, yf + h - 0.58, zf + 0.34], r() < 0.5 ? 0xff3010 : 0x30ff60, 0.5, 0.8, 0);
  signQuad(B, signMaterial({ lines: [name, 'LEVEL'], bg: '#1d1d1b', fg: '#e9dcae', w: 512, h: 256, weather: 0.9 }), [-w - 0.55, yf + h - 0.7, zf + 0.32], 0.9, 0.45, 0);
}
