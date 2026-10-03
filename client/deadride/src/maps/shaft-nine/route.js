// SHAFT NINE route scenery: the shaft between the stops, in ABSOLUTE world coordinates (x = z = 0 column). Lining changes with depth
// (old timber -> poured concrete -> bolted rock -> hot basalt), guide rails on buntons, pipes, cable trays, wall lamps every 8 m that the
// cage's strobe light follows, and dark side adits (level stations) glimpsed while passing.
import { std } from '../../core/mats.js';
import { OPEN, SHAFT, STOP_Y, makeHalos, unifyPrograms, steelLadder, lin } from './kit.js';
import { makeRng } from '../../core/util.js';
const PI = Math.PI;
import { shaftMats, shaftLining, levelStation } from './shaft.js';

// gaps between the stop stubs (each stop's own stub covers [Y-8, Y+7])
const GAPS = [
  { y0: STOP_Y[1] + 7, y1: STOP_Y[0] - 8, style: 'timber', lampColor: 0xffa850, st: [{ y: -30, n: '30' }, { y: -60, n: '60' }] },
  { y0: STOP_Y[2] + 7, y1: STOP_Y[1] - 8, style: 'concrete', lampColor: 0xd8f0ff, st: [{ y: -124, n: '124' }, { y: -152, n: '152' }] },
  { y0: STOP_Y[3] + 7, y1: STOP_Y[2] - 8, style: 'rock', lampColor: 0xc9b0ff, st: [{ y: -214, n: '214' }, { y: -246, n: '246' }] },
  { y0: STOP_Y[4] + 7, y1: STOP_Y[3] - 8, style: 'hot', lampColor: 0xff8a40, st: [{ y: -322, n: '322' }, { y: -352, n: '352' }, { y: -376, n: '376' }] },
];

/** per-gap details that change with depth so the ride never repeats: painted depth bands, junction boxes with signal lamps, valve wheels, side cable trays, escape ladders,
 *  and style-specific features (rock: mineral veins; hot: glowing cracks + heat pipes) */
function features(B, M, g, seed, halos) {
  const r = makeRng(seed * 7919 + 13), hx = SHAFT.hx, hz = SHAFT.hz; const band = B.m('rBand', { pattern: 'hazard', size: 256, tile: 0.5, colors: [0xc8a020, 0x171717, 0x40382a], params: { n: 4, angle: 0, wear: 0.8 }, bump: 1, rough: [0.5, 0.9], layers: { grime: 0.5 } });
  const wheel = B.m('rWheel', std({ color: 0x8a1c14, metalness: 0.4, roughness: 0.5 })); const vein = B.m('rVein', std({ color: 0x000000, emissive: g.style === 'hot' ? 0xff5a18 : 0x8a5cff, emissiveIntensity: g.style === 'hot' ? 5 : 2.5 }));
  for (let y = Math.ceil((g.y0 + 2) / 10) * 10; y < g.y1 - 2; y += 10) { const big = y % 50 === 0; for (const s of [-1, 1]) B.box({ p: [s * (hx - 0.012), y, 0], s: [0.02, big ? 0.3 : 0.12, 2 * hz - 0.5], mat: band, bevel: 0, cast: false }); }
  for (let y = g.y0 + 6 + r() * 6; y < g.y1 - 4; y += 12 + r() * 9) { const s = r() < 0.5 ? -1 : 1, z = -0.6 + r() * 1.2; B.box({ p: [s * (hx - 0.06), y, z], s: [0.1, 0.32, 0.26], mat: M.steel, bevel: 0.01, cast: false }); const sig = r() < 0.5 ? M.signalR : M.signalG; B.box({ p: [s * (hx - 0.115), y + 0.08, z - 0.06], s: [0.03, 0.06, 0.06], mat: sig, bevel: 0, cast: false }); B.box({ p: [s * (hx - 0.115), y - 0.05, z + 0.06], s: [0.03, 0.06, 0.06], mat: r() < 0.5 ? M.signalG : M.signalR, bevel: 0, cast: false }); halos.add([s * (hx - 0.14), y + 0.08, z - 0.06], sig === M.signalR ? 0xff3010 : 0x30ff60, 0.4, 0.7, 0); }
  for (let y = g.y0 + 9 + r() * 10; y < g.y1 - 5; y += 26 + r() * 14) { B.cyl({ p: [-1.62 + 0.0, y, -(hz - 0.32)], r: 0.13, h: 0.035, seg: 14, mat: wheel, pitch: PI / 2, anchor: 'center', cast: false }); B.box({ p: [-1.62, y, -(hz - 0.2)], s: [0.04, 0.04, 0.18], mat: M.steel, cast: false }); }
  { const a = g.y0 + 10 + r() * 20, len = 22 + r() * 24, s = r() < 0.5 ? -1 : 1; B.box({ p: [s * (hx - 0.05), a, 0.55], s: [0.05, len, 0.3], mat: M.steel, bevel: 0.006, cast: false }); for (let k = 0; k < 3; k++) B.box({ p: [s * (hx - 0.09), a, 0.45 + k * 0.09], s: [0.025, len, 0.03], mat: M.void, bevel: 0.004, cast: false }); }
  if (g.style === 'concrete' || g.style === 'timber') steelLadder(B, M.steel, [0.2, g.y0 + 14 + r() * 40, -(hz - 0.05)], 11 + r() * 6, 0, { width: 0.44 });
  if (g.style === 'rock' || g.style === 'hot') for (let i = 0; i < (g.style === 'hot' ? 26 : 16); i++) { const y = g.y0 + r() * (g.y1 - g.y0), side = r() < 0.5 ? -1 : 1, len = 0.6 + r() * 2.4, sk = r() < 0.4; if (sk) B.box({ p: [side * (hx - 0.02), y, -0.9 + r() * 1.8], s: [0.02, 0.03 + r() * 0.03, len], mat: vein, bevel: 0, cast: false }); else B.box({ p: [-1.2 + r() * 2.4, y, -(hz - 0.02)], s: [len, 0.03 + r() * 0.03, 0.02], mat: vein, bevel: 0, cast: false }); }
  if (g.style === 'hot') for (let y = g.y0 + 8; y < g.y1 - 8; y += 30 + r() * 12) { B.cyl({ p: [1.55, y, -(hz - 0.18)], r: 0.09, h: 10, seg: 10, mat: M.steel, cast: false }); halos.add([1.55, y + 6.5, -(hz - 0.3)], 0xff6a20, 0.7, 0.6, 0); }
}

export async function buildRoute(ctx) {
  const B = ctx.B; const halos = makeHalos(B, 160); let seed = 1;
  const fin = B.finish.bind(B); B.finish = () => { fin(); unifyPrograms(B.group); };      // shared programs / program-sorted draws for the whole shaft column
  for (const g of GAPS) {
    const M = shaftMats(B, g.style);
    const front = g.st.map((s) => ({ y0: s.y, y1: s.y + OPEN.h }));
    shaftLining(B, M, { y0: g.y0, y1: g.y1, style: g.style, front, lamps: { halos, every: 8, color: g.lampColor }, buntonEvery: 4, seed: seed++ });
    features(B, M, g, seed, halos);
    for (const s of g.st) levelStation(B, M, { yf: s.y, name: s.n, style: g.style, halos, seed: seed++, lampColor: g.lampColor });
  }
  return { gaps: GAPS };
}
