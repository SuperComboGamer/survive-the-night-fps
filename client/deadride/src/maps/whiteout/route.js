// WHITEOUT ride scenery (absolute world coordinates): the mountain between the stops, the two ropes of every leg with catenary sag,
// sheave-train towers, a dark pine forest (instanced, chunked), floodlit ski runs with piste lights, rock outcrops.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { makeRng, fbm2, noise2, clamp, lerp, smoothstep } from '../../core/util.js';
import { LAND, getLine } from './line.js';
import { ROPE_GAP, sampleS } from './line.js';
import { Frame, terrainPatch, terrainMaterial, pineGeometry, pineMaterial, FarLights, timer, unifyPrograms, heightGrid } from './common.js';
import { Forest } from './forest.js';
import { forestSet } from './trees.js';
import { buildValley } from './valley.js';

const L = LAND;

export async function buildRoute(ctx) {
  const T0 = timer('route'); const { B, synth } = ctx; B.batch.cell = 340; B.batch.cellY = Infinity; B.inst.cell = 340; { const a0 = B.batch.add.bind(B.batch); B.batch.add = (raw, m, mat, o = {}) => a0(raw, m, mat, { ...o, recv: true }); } const line = getLine(); const rng = makeRng(2024);
  // ------------------------------------------------------------ materials
  const terrain = terrainMaterial(B, { name: 'rTerrain', frag: { rock: [0.11, 0.12, 0.15], rock2: [0.2, 0.21, 0.23], tint: [0.9, 0.96, 1.08], ice: 0.6, snowFx: { sss: [0.02, 0.035, 0.07], bump: 0.9, scale: 0.8, macro: 1.6 } } });
  const steelPaint = B.m('tPaint', { pattern: 'plates', size: 512, tile: 2, colors: [0x8d979f, 0x7b858d, 0x30363b], params: { cols: 1, rows: 2, seam: 0.006, rivets: 8, brushed: 0.3, panelVar: 0.3 }, bump: 2, metal: 0.8, rough: [0.4, 0.7], layers: { rust: 0.18, grime: 0.5, edge: 0.3, streak: 0.5, frost: 0.28 } }, { snow: 1.2, breakup: 0.4 });
  const redPaint = B.m('tRed', { pattern: 'plates', size: 256, tile: 2, colors: [0xa8221f, 0x8c1b19, 0x30110f], params: { cols: 1, rows: 1, seam: 0, rivets: 0, brushed: 0.2 }, bump: 1, metal: 0.6, rough: [0.4, 0.65], layers: { grime: 0.4, frost: 0.2 } }, { snow: 1 });
  const concrete = B.m('tConcrete', { pattern: 'noise', size: 512, tile: 3, colors: [0x6a6a68, 0x57575a, 0x303033, 0x8b8a86], params: { scale: 5, contrast: 1.4, fine: 96, speckle: 0.03, pores: 0.4 }, bump: 3, rough: [0.8, 0.98], layers: { grime: 0.6, cracks: 0.3 } }, { snow: 1.5, breakup: 0.5 });
  const wire = B.m('rope', std({ color: 0x2a2d31, metalness: 0.9, roughness: 0.42 }));
  const rockM = B.m('rRock', { pattern: 'rock', size: 512, tile: 4, colors: [0x22252a, 0x353a41, 0x4b5058, 0x69707a], params: { scale: 5, strata: 8, cracks: 0.9, roughness: 0.8, tone: 0.5, moisture: 0.2 }, bump: 90, rough: [0.65, 0.95], layers: { frost: 0.15 } }, { triplanar: 1 / 4, snow: 1.0 });
  const pisteM = B.m('piste', { pattern: 'snow', size: 512, tile: 4, colors: [0xe9f0fa, 0xfafcff, 0xc3d2e6], params: { scale: 6, ripples: 1.0, sparkle: 1, direction: 0, crust: 0.2 }, bump: 8, rough: [0.4, 0.6] }, { triplanar: 1 / 4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const poleM = B.m('pistePole', std({ color: 0x3a3d42, metalness: 0.7, roughness: 0.5 }));
  const far = new FarLights(2000, 0.72); B.group.add(far.mesh);

  // ------------------------------------------------------------ terrain: world mesh with holes where the stops own finer patches
  const minX = -304, maxX = 704, minZ = -336, maxZ = 336;
  // (no holes: under a stop's own patch the world mesh is sunk 3 m, so a hidden stop never leaves a void)
  const Hr = (x, z) => L.H(x, z) - (L.insideStopRect(x, z) ? 3 : 0);
  { const Hgr = heightGrid(Hr, minX, maxX, minZ, maxZ, 5); terrainPatch(B, { minX, maxX, minZ, maxZ, cell: 5, chunk: 85, H: Hgr, mat: terrain, skirt: 0, cast: false }); }

  T0('terrain');
  // ------------------------------------------------------------ ropes + towers
  const towersOut = [];
  for (const P of line.paths) {
    const leg = L.LEGS[P.leg]; const dx = leg.dir[0], dz = leg.dir[1], lx = dz, lz = -dx;           // left of travel
    for (const side of [0, 1]) {                                                                     // 0 = our rope, 1 = oncoming rope (left)
      const pts = []; for (let s = P.gateOutS - 3; s <= P.gateInS + 3; s += 3.5) { const T = sampleS(P, s); pts.push([T.x + lx * ROPE_GAP * side, T.y, T.z + lz * ROPE_GAP * side]); }
      B.tube({ pts, r: 0.03, mat: wire, seg: 5, segs: pts.length * 2, cast: true });
    }
    // towers: tapered tube column, crossarm, two sheave trains (6 wheels each), red/white marking, beacon
    const yaw = Math.atan2(-dx, -dz);
    for (const t of P.towers) {
      const T = sampleS(P, t.s); const cx = t.x + lx * ROPE_GAP / 2, cz = t.z + lz * ROPE_GAP / 2; const F = new Frame(B, cx, cz, yaw, 0); const top = T.y, base = t.ground;
      const fy = (y) => y - 0;   // frame y0 = 0 => absolute world y
      B.box({ p: [cx, base - 1.4, cz], s: [3.2, 1.9, 3.2], yaw, mat: concrete, bevel: 0.05, cast: false });
      B.cyl({ p: [cx, base + 0.4, cz], r: [0.66, 0.34], h: top - base - 2.6, seg: 14, mat: steelPaint, cast: true });
      B.cyl({ p: [cx, top - 2.3, cz], r: [0.34, 0.5], h: 0.3, seg: 14, mat: steelPaint, cast: true });
      F.box({ p: [0, top - 2.35, 0], s: [ROPE_GAP + 3.8, 0.55, 0.75], mat: steelPaint, bevel: 0.05 });
      for (const su of [-1, 1]) {
        const u = su * ROPE_GAP / 2; F.box({ p: [u, top - 1.85, 0], s: [0.4, 0.5, 0.5], mat: steelPaint, bevel: 0.03 });
        F.box({ p: [u, top - 1.02, 0], s: [0.22, 0.24, 4.3], mat: steelPaint, bevel: 0.03 });                            // balance beam
        for (let i = 0; i < 6; i++) F.cyl({ p: [u, top - 0.3, -1.7 + i * 0.68], r: 0.27, h: 0.13, seg: 12, mat: redPaint, roll: Math.PI / 2, anchor: 'center', cast: false });
        for (const dz2 of [-1, 1]) F.box({ p: [u, top - 0.85, dz2 * 1.5], s: [0.06, 0.55, 0.08], mat: steelPaint, cast: false });
      }
      for (let k = 0; k < 4; k++) B.cyl({ p: [cx, top - 8 - k * 2.4, cz], r: [0.42 - k * 0.0, 0.42], h: 0.9, seg: 14, mat: k % 2 ? steelPaint : redPaint, cast: false });
      F.box({ p: [ROPE_GAP / 2 + 2.3, top - 2.1, 0], s: [0.05, 0.9, 0.05], mat: steelPaint, cast: false });
      B.sphere({ p: [cx, top - 2.75, cz], r: 0.18, mat: redPaint, seg: 8, cast: false }); far.add([cx, top - 2.75, cz], 0xff3018, 1.1, 1.1, 2.2);
      towersOut.push({ x: cx, z: cz, top, base });
    }
  }
  T0('towers');
  // ------------------------------------------------------------ ski runs: follow the fall line from a start, cleared of trees, lit
  const runs = [];
  const startPts = [[300, 40], [124, -34], [330, 222]];
  for (const [sx, sz] of startPts) {
    let x = sx, z = sz, vx = 0, vz = 0; const pts = [[x, L.H(x, z), z]];
    for (let i = 0; i < 300 && pts.length < 90; i++) {
      const e = 3, gx = (L.H(x + e, z) - L.H(x - e, z)) / (2 * e), gz = (L.H(x, z + e) - L.H(x, z - e)) / (2 * e); const gl = Math.hypot(gx, gz) || 1;
      vx = vx * 0.86 - gx / gl * 0.14; vz = vz * 0.86 - gz / gl * 0.14; const vl = Math.hypot(vx, vz) || 1; x += vx / vl * 6; z += vz / vl * 6;
      if (x < minX + 20 || x > maxX - 20 || z < minZ + 20 || z > maxZ - 20 || L.H(x, z) < 6 || L.insideStopRect(x, z)) break;
      pts.push([x, L.H(x, z), z]);
    }
    if (pts.length > 12) runs.push(pts);
  }
  const buildRun = (pts, W = 20) => {
    // smooth the polyline, then a draped ribbon (4 columns across) + piste lights on both sides
    const sm = pts.map((p, i) => { const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)]; return [(a[0] + p[0] + b[0]) / 3, 0, (a[2] + p[2] + b[2]) / 3]; });
    const P = [], N = [], U = [], I = []; const C = 4;
    for (let i = 0; i < sm.length; i++) {
      const a = sm[Math.max(0, i - 1)], b = sm[Math.min(sm.length - 1, i + 1)]; let tx = b[0] - a[0], tz = b[2] - a[2]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl; const nx = -tz, nz = tx;
      for (let c = 0; c <= C; c++) { const u = (c / C - 0.5) * W; const x = sm[i][0] + nx * u, z = sm[i][2] + nz * u, y = L.H(x, z) + 0.2; P.push(x, y, z); const e = 1.5; const gx = L.H(x - e, z) - L.H(x + e, z), gz = L.H(x, z - e) - L.H(x, z + e), gl = Math.hypot(gx, 2 * e, gz); N.push(gx / gl, 2 * e / gl, gz / gl); U.push(x, z); }
    }
    for (let i = 0; i < sm.length - 1; i++) for (let c = 0; c < C; c++) { const a = i * (C + 1) + c, b = a + 1, d = a + (C + 1), e2 = d + 1; I.push(a, d, b, b, d, e2); }
    B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, new THREE.Matrix4(), pisteM, { cast: false, recv: true });
    for (let i = 3; i < sm.length - 1; i += 6) { const a = sm[i - 1], b = sm[i + 1]; let tx = b[0] - a[0], tz = b[2] - a[2]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      for (const sd of [-1, 1]) { const x = sm[i][0] + -tz * sd * (W / 2 + 2), z = sm[i][2] + tx * sd * (W / 2 + 2), y = L.H(x, z); B.cyl({ p: [x, y, z], r: 0.07, h: 6.2, seg: 6, mat: poleM, cast: false }); far.add([x, y + 6.3, z], 0xffe6b8, 1.6, 1.5, 0); } }
  };
  for (const r of runs) buildRun(r);
  const nearRun = (x, z) => { let m = 1e9; for (const r of runs) for (let i = 0; i < r.length; i += 2) { const d = Math.hypot(r[i][0] - x, r[i][2] - z); if (d < m) m = d; } return m; };

  T0('runs');
  const valley = buildValley(B, far, line, minX, maxX, minZ, maxZ); T0('valley'); console.log('[whiteout] valley: houses', valley.houses, 'window lights', valley.lights, 'road lamps', valley.roadLamps, 'lift towers', valley.lifts);
  // ------------------------------------------------------------ pine forest: 3-level LOD instanced system (forest.js), 4 species
  const fs = forestSet(); const heights = { near: [...fs.heights.near, 9, 11], mid: 11 };
  const forest = new Forest(B.group, { cell: 128, mat: pineMaterial(), heights, R0: 34, R1: 100, geos: { near: [...fs.near, ...fs.snags], mid: fs.mid, far: fs.far } });
  let treeCount = 0; const SP = [[1, 1], [1, 1], [1.05, 1], [0.66, 1.12], [1, 1], [1, 1]];        // per-species (width, height) multiplier: the fourth is a tall narrow spruce
  for (let x = minX + 4; x < maxX; x += 6.5) for (let z = minZ + 4; z < maxZ; z += 6.5) {
    const jx = x + (rng() - 0.5) * 6, jz = z + (rng() - 0.5) * 6; const alt = L.H(jx, jz); if (alt > 235 || alt < -66) continue;
    let dens = smoothstep(0.02, 0.32, fbm2(jx * 0.011 + 5, jz * 0.011 - 2, 3) * 1.6 + 0.42) * (1 - smoothstep(175, 255, alt)); if (rng() > dens * 1.05) continue;
    if (L.slopeDeg(jx, jz, 3) > 33) continue; let plate = 0; for (let i = 0; i < 3; i++) plate = Math.max(plate, L.plateauMask(i, jx, jz)); if (plate > 0.02) continue;
    const hgt = (0.65 + rng() * 0.85) * (1 - 0.35 * smoothstep(90, 235, alt)); const treeTop = alt + 11 * hgt;
    let blocked = false; for (const leg of L.LEGS) { const a = L.legAt(leg, jx, jz); if (a.u > -20 && a.u < leg.len + 20 && a.d > -ROPE_GAP - 24 && a.d < 24 && treeTop > a.y - 7) { blocked = true; break; } } if (blocked) continue;
    if (nearRun(jx, jz) < 15) continue;
    const r4 = rng(); const sp = r4 < 0.28 ? 0 : r4 < 0.5 ? 1 : r4 < 0.7 ? 2 : r4 < 0.92 ? 3 : r4 < 0.96 ? 4 : 5; const [kw, kh] = SP[sp]; const tint = 0.75 + rng() * 0.5;
    forest.add(jx, alt - 0.3, jz, rng() * 6.28, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08, hgt * kw * (0.85 + rng() * 0.3), hgt * kh, hgt * kw * (0.85 + rng() * 0.3), tint, sp); treeCount++;
  }
  forest.finish();
  T0('forest');
  // ------------------------------------------------------------ rock outcrops on the steep flanks (snow-capped)
  for (let i = 0; i < 70; i++) {
    const x = minX + 30 + rng() * (maxX - minX - 60), z = minZ + 30 + rng() * (maxZ - minZ - 60); if (L.insideStopRect(x, z)) continue; const sl = L.slopeDeg(x, z, 4); if (sl < 26) continue;
    const r = 3 + rng() * 7; B.rock({ p: [x, L.H(x, z) - r * 0.25, z], r, squash: [1.3, 0.8 + rng() * 0.5, 1.0], amp: 0.5, seed: 30 + i % 6, detail: 3, mat: rockM, yaw: rng() * 6, pitch: (rng() - 0.5) * 0.5, roll: (rng() - 0.5) * 0.5, cast: false });
  }
  T0('rocks');
  console.log('[whiteout] route: trees', treeCount, 'forest trees', forest.n, 'runs', runs.length, 'towers', towersOut.length);
  unifyPrograms(B);
  return { towers: towersOut, runs, far, forest };
}
