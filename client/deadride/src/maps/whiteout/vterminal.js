// BASE VILLAGE LANDMARK: the gondola base terminal -- a big steel-and-timber lift hall with a glazed front, the illuminated WHITEOUT RESORT
// sign, the horizontal bullwheel, two rope portals (out to the mid station / in from the summit), loading platform, turnstiles, cabin garage.
import * as THREE from 'three';
import { Frame, spillMaterial, spill, quad } from './common.js';
import { skyOccluder, windowQuad } from './snowkit.js';
import { wall } from './chalets.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { std } from '../../core/mats.js';
import { makeBullwheel } from './wheel.js';
import { stationRope, LAND } from './line.js';
import { getLine } from './line.js';

const L = LAND;
export const HALL = { x0: -13, x1: 33, z0: -15, z1: 23, eave: 6.8, ridge: 11.2 };

function signTextures(w, h) {
  const draw = (emissive) => canvasTexture(w, h, (c) => {
    const bg = emissive ? '#000' : '#0d1a2c'; c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.lineWidth = 14; c.strokeStyle = emissive ? '#ffd9a0' : '#c9d3df'; c.strokeRect(20, 20, w - 40, h - 40);
    if (!emissive) { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.25)'); c.fillStyle = g; c.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(230,240,255,${Math.random() * 0.06})`; c.fillRect(Math.random() * w, Math.random() * h, Math.random() * 40 + 2, 2); } }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `italic 900 ${Math.round(h * 0.54)}px Impact, "Arial Black", sans-serif`; const cx = w / 2 + 40;
    c.fillStyle = emissive ? '#ff3b2a' : '#7a1210'; c.fillText('WHITEOUT', cx + 8, h * 0.44 + 8); c.fillStyle = emissive ? '#ffffff' : '#eef3f8'; c.fillText('WHITEOUT', cx, h * 0.44);
    c.font = `700 ${Math.round(h * 0.2)}px "Arial Narrow", Arial, sans-serif`; c.fillStyle = emissive ? '#ffb070' : '#d9a06a'; if ('letterSpacing' in c) c.letterSpacing = `${Math.round(h * 0.06)}px`; c.fillText('R E S O R T   ·   G O N D O L A', cx, h * 0.84);
    // snowflake / peak glyph
    c.save(); c.translate(w * 0.09, h * 0.5); c.strokeStyle = emissive ? '#bfe4ff' : '#9fc4e0'; c.lineWidth = 10; for (let i = 0; i < 6; i++) { c.rotate(Math.PI / 3); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -h * 0.3); c.moveTo(0, -h * 0.17); c.lineTo(h * 0.07, -h * 0.25); c.moveTo(0, -h * 0.17); c.lineTo(-h * 0.07, -h * 0.25); c.stroke(); } c.restore();
  });
  return { map: draw(false), emi: draw(true) };
}

export function buildTerminal(ctx, B, M, halos, st) {
  const { x0, x1, z0, z1, eave, ridge } = HALL; const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; const F0 = new Frame(B, 0, 0, 0, 0);
  const spillM = spillMaterial(); const glassM = B.m('hallGlass', std({ color: 0x9fb4c4, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  const out = { windows: [], wheel: null };
  // ---- slab (top at y = 0, flush with the cabin floor and the plaza)
  B.box({ p: [cx, -0.7, cz], s: [W + 1.2, 0.7, D + 1.2], mat: M.concrete, bevel: 0.03, col: 'concrete' });
  B.box({ p: [cx, 0.0, cz], s: [W - 0.4, 0.015, D - 0.4], mat: M.floor, bevel: 0.002, col: false, cast: false });
  // ---- perimeter: concrete plinth + timber cladding; north/south with a lit window band; east with two rope portals; west = glazed front
  const portalE = { c: -12.2, w: 8.4 }, portalI = { c: 18.0, w: 8.4 };
  const t = 0.5, winX = [-8, -1.5, 5, 11.5, 18, 24.5, 31]; const winOps = (extra = []) => [...winX.map((c) => ({ c, w: 2.4, y0: 3.0, y1: 5.5 })), ...extra];
  wall(F0, 'u', z0 + t / 2, x0, x1, 0, eave, t, M.timber, winOps().filter((o) => o.c > x0 + 1.5 && o.c < x1 - 1.5), 'wood');
  wall(F0, 'u', z1 - t / 2, x0, x1, 0, eave, t, M.timber, winOps().filter((o) => o.c > x0 + 1.5 && o.c < x1 - 1.5), 'wood');
  wall(F0, 'v', x1 - t / 2, z0, z1, 0, eave, t, M.timber, [{ c: portalE.c, w: portalE.w, y0: 0, y1: 5.7 }, { c: portalI.c, w: portalI.w, y0: 0, y1: 5.7 }], 'wood');
  for (const [wl, zz, sg] of [['n', z0, -1], ['s', z1, 1]]) {
    wall(F0, 'u', zz - sg * 0.02, x0, x1, 0, 1.15, t + 0.08, M.concrete, [], false);
    for (const cxw of winX.filter((c) => c > x0 + 1.5 && c < x1 - 1.5)) {
      windowQuad(B, M.winHall, [cxw, 4.25, zz - sg * 0.05], [0, sg], 2.4, 2.5, Math.abs(Math.round(cxw * 3)) % 4); F0.box({ p: [cxw, 3.0, zz - sg * (t / 2)], s: [2.4, 2.5, 0.03], mat: glassM, bevel: 0.004, col: false, cast: false, recv: false }); F0.box({ p: [cxw, 3.0, zz - sg * (t / 2 - 0.04)], s: [0.06, 2.5, 0.08], mat: M.beam, col: false, cast: false }); F0.box({ p: [cxw, 4.2, zz - sg * (t / 2 - 0.04)], s: [2.4, 0.06, 0.08], mat: M.beam, col: false, cast: false });
      F0.box({ p: [cxw, 2.85, zz + sg * 0.3], s: [2.7, 0.12, 0.4], mat: M.beam, bevel: 0.02, col: false, cast: false });
      halos.add([cxw, 4.3, zz + sg * 0.6], 0xffe8c8, 0.9, 0.1, 0); spill(B, spillM, cxw, 0.03, zz + sg * 3.2, 4.2, 5.0, 0, 0xffd8a8); out.windows.push({ x: cxw, y: 4.3, z: zz });
    }
  }
  // ---- west facade: glulam posts + glass curtain wall (transparent, so the lit hall shows through) + entrance canopy
  const posts = 10; for (let i = 0; i <= posts; i++) { const z = z0 + i * D / posts; F0.box({ p: [x0, 0, z], s: [0.5, eave + 2.2, 0.5], mat: M.beam, bevel: 0.04, col: 'wood' }); }
  for (let i = 0; i < posts; i++) { const z = z0 + (i + 0.5) * D / posts; F0.box({ p: [x0 + 0.05, 0.9, z], s: [0.08, 5.6, D / posts - 0.5], mat: glassM, col: false, cast: false, recv: false }); F0.box({ p: [x0 + 0.05, 3.7, z], s: [0.1, 0.08, D / posts - 0.5], mat: M.iron, col: false, cast: false }); }
  F0.box({ p: [x0, 0, cz], s: [0.6, 0.9, D], mat: M.concrete, bevel: 0.03, col: false }); F0.box({ p: [x0 - 0.05, eave, cz], s: [0.4, 0.6, D + 0.6], mat: M.beam, bevel: 0.04, col: false });
  // entrance: 2 door leaves (glass, open), red steel canopy on rods
  for (const zz of [-6.6, -4.4]) { F0.box({ p: [x0 - 0.15, 0, zz], s: [0.08, 2.4, 1.05], mat: M.winHall, bevel: 0.01, col: false, cast: false }); F0.box({ p: [x0 - 0.15, 2.4, zz], s: [0.1, 0.1, 1.1], mat: M.iron, col: false, cast: false }); }
  F0.box({ p: [x0 - 2.6, 3.65, -5.5], s: [5.2, 0.35, 8.6], mat: M.steelRed, bevel: 0.05, col: false }); F0.box({ p: [x0 - 2.6, 4.05, -5.5], s: [5.3, 0.4, 8.8], mat: M.snow, bevel: 0.16, col: false, cast: false });
  for (const zz of [-9.3, -1.7]) F0.cyl({ p: [x0 - 4.9, 0, zz], r: 0.09, h: 3.7, seg: 8, mat: M.steelRed, col: 'metal' });
  halos.add([x0 - 1.0, 3.4, -5.5], 0xffe4b8, 1.1, 0.14, 0); spill(B, spillM, x0 - 4.0, 0.03, -5.5, 8, 9, 0, 0xffd8a8);
  // ---- roof: gable along x, ridge at cz; two skins with a heavy snow load; glulam frames every 5.75 m; corrugated underside
  skyOccluder(B, F0, x0 - 1.5, x1 + 1.5, z0 - 1.5, z1 + 1.5, eave, ridge);
  const half = D / 2, ov = 1.8, slope = Math.atan2(ridge - eave, half), len = (half + ov) / Math.cos(slope);
  const corr = B.m('hallRoof', { pattern: 'corrugated', size: 512, tile: 2, colors: [0x3a4149, 0x2c3238], params: { ribs: 12, depth: 1, vertical: 1, dents: 0.4 }, bump: 14, metal: 1, rough: [0.4, 0.7], layers: { rust: 0.1, grime: 0.5, frost: 0.4, streak: 0.5 } }, { snow: 1.0 });
  corr.emissive = new THREE.Color(0x3a2a1c); corr.emissiveIntensity = 0.35;
  for (const sv of [-1, 1]) {
    F0.box({ p: [cx, eave + (ridge - eave) / 2 - 0.12 - Math.abs(sv) * 0, cz + sv * half / 2], s: [W + 2 * ov, 0.28, len - (ov / Math.cos(slope)) * 0.0], pitch: sv * slope, mat: corr, bevel: 0.03, col: false });
    F0.box({ p: [cx, eave + (ridge - eave) / 2 + 0.28, cz + sv * half / 2], s: [W + 2 * ov + 0.6, 0.62, len + 0.4], pitch: sv * slope, mat: M.snow, bevel: 0.26, col: false, cast: true });
  }
  F0.box({ p: [cx, ridge + 0.05, cz], s: [W + 2 * ov + 0.8, 0.6, 1.1], mat: M.snow, bevel: 0.25, col: false, cast: false });
  for (let i = 0; i <= 8; i++) { const x = x0 + 1.2 + i * (W - 2.4) / 8; F0.beam([x, eave - 0.1, z0 + 0.2], [x, ridge - 0.3, cz], 0.34, 0.6, { mat: M.beam }); F0.beam([x, ridge - 0.3, cz], [x, eave - 0.1, z1 - 0.2], 0.34, 0.6, { mat: M.beam });
    F0.beam([x, eave + 0.05, z0 + 6], [x, eave + 1.15, cz - 1.5], 0.08, 0.08, { mat: M.iron }); F0.beam([x, eave + 0.05, z1 - 6], [x, eave + 1.15, cz + 1.5], 0.08, 0.08, { mat: M.iron });
    F0.box({ p: [x, 6.6, cz], s: [0.25, 0.25, 0.25], mat: M.iron, col: false, cast: false });                                                            // tie-rod node
    if (i < 8) { const xm = x + (W - 2.4) / 16; F0.box({ p: [xm, 6.85 + 1.5, cz - 0.0], s: [(W - 2.4) / 8 - 0.4, 0.06, 0.5], mat: M.glowWhite, col: false, cast: false }); }   // ridge light strips
  }
  for (const sv of [-1, 1]) for (let k = 0; k < 4; k++) F0.beam([x0, eave + 0.3 + (ridge - eave) * (k + 1) / 5, cz + sv * half * (1 - (k + 1) / 5)], [x1, eave + 0.3 + (ridge - eave) * (k + 1) / 5, cz + sv * half * (1 - (k + 1) / 5)], 0.16, 0.3, { mat: M.beam });   // purlins
  // gable ends (timber above the eave) + roof edge boards
  for (const [xx, mat] of [[x0 + 0.1, M.timberV], [x1 - 0.1, M.timberV]]) { const g = new THREE.Shape(); g.moveTo(-half, 0); g.lineTo(half, 0); g.lineTo(0, ridge - eave); g.lineTo(-half, 0); const geo = new THREE.ExtrudeGeometry(g, { depth: 0.4, bevelEnabled: false }); geo.rotateY(Math.PI / 2); geo.translate(xx - 0.2, eave, cz); B.group.add(new THREE.Mesh(geo, mat)); }
  // ---- interior platform, rails, columns, machinery
  const P = new Frame(B, 0, 0, st.yaw, 0);                                                                                     // platform frame (u right, v back, forward = -v)
  P.box({ p: [-3.85, -0.35, -9.0], s: [5.4, 0.35, 34], mat: M.concrete, bevel: 0.01, col: 'concrete' });                          // loading platform LEFT of the exit arm, top at 0
  P.box({ p: [-1.28, 0.0, -9.0], s: [0.3, 0.012, 34], mat: M.paintRed, bevel: 0.002, col: false, cast: false });                  // yellow-red safety strip at the edge (painted)
  for (let i = 0; i < 9; i++) P.box({ p: [-1.28, 0.012, -22 + i * 3.6], s: [0.32, 0.01, 0.9], mat: M.glowWhite, col: false, cast: false });
  P.box({ p: [-6.7, 0.0, -9.0], s: [0.16, 1.1, 34], mat: M.steel, bevel: 0.02, col: 'metal' });                                     // back rail
  for (const [u, v, w2, d2] of [[-4, 6.5, 2.4, 1.2], [-4, -19.5, 1.6, 0.9]]) P.box({ p: [u, 0, v], s: [w2, 1.05, d2], mat: M.timberV, bevel: 0.03, col: 'wood' });
  for (let i = 0; i < 4; i++) { P.box({ p: [-3.2, 0, -4 - i * 4.2], s: [0.14, 1.0, 0.7], mat: M.steel, bevel: 0.02, col: 'metal' }); P.box({ p: [-3.2, 0.95, -4 - i * 4.2], s: [0.2, 0.06, 0.2], mat: M.glowWhite, col: false, cast: false }); }   // turnstile posts
  // safety nets at the wheel + wheel pit
  const C = st.C; B.cyl({ p: [C[0], 0, C[1]], r: 4.4, h: 0.85, seg: 36, mat: M.concrete, col: 'concrete' }); B.cyl({ p: [C[0], 0.85, C[1]], r: 3.9, h: 0.06, seg: 36, mat: M.steel, col: false, cast: false });
  for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283; B.cyl({ p: [C[0] + Math.cos(a) * 4.3, 0.85, C[1] + Math.sin(a) * 4.3], r: 0.03, h: 1.0, seg: 5, mat: M.steel, col: false, cast: false }); }
  // bullwheel (rotating group) at rope height; drive gearbox beside it
  const wheel = makeBullwheel(ctx, { R: L.RAIL_R, mats: { steel: M.steel, steelRed: M.steelRed, iron: M.iron }, spokes: 12 }); wheel.position.set(C[0], L.PIVOT_H, C[1]); B.group.add(wheel); out.wheel = wheel;
  B.box({ p: [C[0] - 5.2, 0, C[1] - 1], s: [2.0, 2.2, 2.6], mat: M.steelRed, bevel: 0.06, col: 'metal', walk: false }); B.cyl({ p: [C[0] - 5.2, 2.2, C[1] - 1], r: 0.55, h: 0.5, seg: 14, mat: M.steel, col: false });
  // haul rope through the hall + the carrier rail above it, on roof hangers
  const rp = stationRope(0).map((p) => [p[0] - 0, p[1], p[2]]); const ropeM = B.m('hallRope', std({ color: 0x1e2226, metalness: 0.9, roughness: 0.45 }));
  B.tube({ pts: rp, r: 0.03, mat: ropeM, seg: 5, segs: rp.length * 2 });
  const rail = rp.map((p) => [p[0], p[1] + 0.34, p[2]]); B.tube({ pts: rail.filter((_, i) => i % 2 === 0), r: 0.06, mat: M.steel, seg: 6, segs: rail.length, cast: true });
  for (let i = 0; i < rp.length; i += 9) B.beam([rp[i][0], rp[i][1] + 0.34, rp[i][2]], [rp[i][0], eave + 2.4, rp[i][2]], 0.06, 0.06, { mat: M.iron, cast: false });
  // interior lights: pooled real lights + halos on the lamp rows
  for (const [x, z] of [[2, 6], [18, 4], [26, -6]]) ctx.light({ pos: [x, 5.5, z], color: 0xffd9a8, intensity: 16, distance: 18, decay: 2, flicker: 0.02, flickerSpeed: 3 });
  // ---- illuminated sign (billboard above the west gable) -- WHITEOUT RESORT
  const tex = signTextures(2048, 420); const signMat = B.m('resortSign', std({ map: tex.map, emissiveMap: tex.emi, emissive: 0xffffff, emissiveIntensity: 2.6, roughness: 0.5, metalness: 0.1 }));
  const SW = 17, SH = 3.4, sy = 8.1, sz = cz - 0.5, sx = x0 - 3.1;
  F0.box({ p: [sx + 0.12, sy - 0.15, sz], s: [0.3, SH + 0.3, SW + 0.3], mat: M.steel, bevel: 0.04, col: false, cast: false }); quad(B, signMat, [sx - 0.06, sy + SH / 2, sz], SW - 0.1, SH - 0.1, -Math.PI / 2);
  F0.box({ p: [sx - 0.02, sy + SH + 0.12, sz], s: [0.36, 0.16, SW + 0.5], mat: M.snow, bevel: 0.07, col: false, cast: false });
  for (let i = 0; i < 5; i++) { const zz = sz - SW / 2 + 0.8 + i * (SW - 1.6) / 4; F0.beam([x0 - 0.9, eave + 1.4, zz], [sx + 0.2, sy + 0.3, zz], 0.14, 0.14, { mat: M.steel }); F0.beam([x0 - 0.9, eave + 0.2, zz], [sx + 0.2, sy - 0.15, zz], 0.1, 0.1, { mat: M.steel }); }
  for (let i = 0; i < 7; i++) { const zz = sz - SW / 2 + 1.2 + i * (SW - 2.4) / 6; F0.box({ p: [sx - 0.25, sy + SH + 0.3, zz], s: [0.36, 0.2, 0.2], mat: M.glowWhite, col: false, cast: false }); F0.beam([sx - 0.15, sy + SH + 0.28, zz], [sx + 0.1, sy + SH - 0.2, zz], 0.04, 0.04, { mat: M.iron }); halos.add([sx - 0.35, sy + SH + 0.4, zz], 0xfff0d8, 0.9, 0.4, 0); }
  halos.add([sx - 0.4, sy + SH / 2, sz], 0xffd9b0, 5.0, 0.14, 0);
  out.signPos = [sx, sy + SH / 2, sz]; out.sign = signMat;
  return out;
}
