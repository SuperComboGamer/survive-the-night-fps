// MV CHARON — 28 m harbour ferry, model (all geometry procedural). Frame origin = deck reference (midship centreline, main-deck top). +X starboard, +Y up, -Z bow.
// Steel hull (lofted), open car/cargo deck with a side ramp (raises as a gate) on the STARBOARD side, white saloon with lit interior, wheelhouse, funnel, mast+radar, life rings, rafts.
import * as THREE from 'three';
import { Builder } from '../../core/build.js';
import { std } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { HULL, halfWidth, keelY, sectionF } from './ferryPhys.js';
import { withLampRefl, Glows } from './shared.js';
import { fitTex } from './kit.js';
import { addFerryDetail } from './ferryDetail.js';
import { hullRivets } from './real.js';
import { boxesGeo } from './arch.js';

export const RAMP = { hx: 3.95, z0: 0.2, z1: 2.8, len: 2.7 };   // hinge x on the deck, ramp z range, ramp length
const P = Math.PI;

export function buildFerryModel(veh, ctx) {
  const B = new Builder({ synth: ctx.synth, group: veh.frame, seed: 991, cell: 200 }); B.batch.cellY = 200; B.inst.cell = 200;
  const parts = { B, animated: {} };
  // ---------------------------------------------------------------- materials
  const hullTop = B.m('hullTop', { pattern: 'plates', size: 512, tile: 3, colors: [0x36506c, 0x2a4160, 0x111c2a], rustColor: 0x3a2a24, params: { cols: 3, rows: 2, seam: 0.008, rivets: 8, brushed: 0.3, panelVar: 0.5 }, bump: 3, metal: 0.3, rough: [0.4, 0.75], layers: { rust: 0.1, grime: 0.5, streak: 0.7, edge: 0.3, scratch: 0.4 } }, { wet: true });
  const hullBot = B.m('hullBot', { pattern: 'plates', size: 512, tile: 3, colors: [0x6a1f16, 0x561811, 0x2b0d09], mossColor: 0x2c4a1e, params: { cols: 3, rows: 2, seam: 0.008, rivets: 4, brushed: 0.2, panelVar: 0.6 }, bump: 3, metal: 0.2, rough: [0.5, 0.85], layers: { moss: 0.5, rust: 0.15, grime: 0.6 } }, { wet: true });
  const deckM = B.m('deckPlate', { pattern: 'diamond', size: 512, tile: 1, colors: [0x76867b, 0x5f6e64], params: { n: 14, height: 1, wear: 0.6 }, bump: 5, metal: 0.2, rough: [0.42, 0.72], layers: { rust: 0.14, grime: 0.55, wet: 0.32, edge: 0.4, streak: 0.4, oil: 0.3 } }, { wet: true }); withLampRefl(deckM, { gain: 0.9, maxRough: 0.7, patchy: 0.5 });
  const white = B.m('whitePaint', { pattern: 'plates', size: 512, tile: 3, colors: [0xd9d6cb, 0xc8c5ba, 0x8f8b80], rustColor: 0x6a3d22, params: { cols: 4, rows: 2, seam: 0.005, rivets: 0, brushed: 0.1, panelVar: 0.3 }, bump: 2, metal: 0.2, rough: [0.45, 0.8], layers: { rust: 0.14, grime: 0.6, streak: 0.8, edge: 0.3, scratch: 0.2 } }, { wet: true });
  const teak = B.m('teak', { pattern: 'planks', size: 512, tile: 1.5, colors: [0x8a5a2c, 0x5a3818, 0x24160a], params: { rows: 10, gap: 0.006, grain: 8, knots: 0.15, cols: 1, vertical: 0, weather: 0.25, nails: 0 }, bump: 2, rough: [0.3, 0.55], layers: { grime: 0.25 } });
  const crateWood = B.m('crateWood', { pattern: 'planks', size: 512, tile: 1, colors: [0x9a7a4a, 0x6a4c2a, 0x2a1c0e], params: { rows: 6, gap: 0.012, grain: 8, knots: 0.25, cols: 1, vertical: 1, weather: 0.55, nails: 1 }, bump: 3, rough: [0.65, 0.9], layers: { grime: 0.45, streak: 0.4 } });
  const lino = B.m('lino', { pattern: 'tiles', size: 512, tile: 1.2, colors: [0x6c7a6a, 0x596653, 0x2a2e28], params: { n: 4, grout: 0.004, checker: 1, bevel: 0.002, wear: 0.5, gloss: 0.6, crackle: 0 }, bump: 1, rough: [0.3, 0.6], layers: { grime: 0.5, wet: 0.3 } });
  const rubber = B.m('rubber', { pattern: 'rubber', size: 256, tile: 0.5, colors: [0x141414, 0x1e1e1e], params: { scale: 8, tread: 0.6 }, bump: 1.5, rough: [0.8, 0.95], layers: { grime: 0.4, dust: 0.3 } });
  const rope = B.m('rope', { pattern: 'weave', size: 256, tile: 0.25, colors: [0x9c8a62, 0x6e6042], params: { threads: 24, twill: 1, variation: 0.6, fuzz: 0.5 }, bump: 2, rough: [0.85, 1], layers: { grime: 0.5 } });
  const paintRed = B.m('paintRed', std({ color: 0x9a1f1a, roughness: 0.5, metalness: 0.4 }));
  const paintBlack = B.m('paintBlack', std({ color: 0x0c0d0e, roughness: 0.55, metalness: 0.6 }));
  const steelDark = B.m('steelDark', { pattern: 'plates', size: 256, tile: 2, colors: [0x3a3f44, 0x2c3034, 0x15181a], params: { cols: 2, rows: 2, seam: 0.01, rivets: 6, brushed: 0.5, panelVar: 0.4 }, bump: 2, metal: 1, rough: [0.4, 0.7], layers: { rust: 0.3, grime: 0.5, scratch: 0.4, edge: 0.4 } });
  const brass = B.m('brass', std({ color: 0xb08a3c, roughness: 0.32, metalness: 1 }));
  const chrome = B.m('chrome', std({ color: 0xc9cdd0, roughness: 0.18, metalness: 1 }));
  const vinyl = B.m('vinyl', std({ color: 0x1f4a3a, roughness: 0.55, metalness: 0 }));
  const orange = B.m('orange', std({ color: 0xe0561a, roughness: 0.6, metalness: 0 }));
  const whitePlain = B.m('whitePlain', std({ color: 0xcfcdc4, roughness: 0.6, metalness: 0 }));
  const ceiling = B.m('ceiling', std({ color: 0xbdbab0, roughness: 0.8 }));
  const frameDark = B.m('frameDark', std({ color: 0x1a1d20, roughness: 0.5, metalness: 0.7 }));
  const glass = B.m('glass', std({ color: 0x000000, roughness: 0.04, metalness: 0, envMapIntensity: 2.2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const lampWarm = B.m('lampWarm', std({ color: 0x000000, emissive: 0xffc878, emissiveIntensity: 4, roughness: 0.5 }));
  const lampCold = B.m('lampCold', std({ color: 0x000000, emissive: 0xdfeaff, emissiveIntensity: 1.7, roughness: 0.5 }));
  const screenG = B.m('screenG', std({ color: 0x000000, emissive: 0x30ff90, emissiveIntensity: 3.2, roughness: 0.3 }));
  const screenB = B.m('screenB', std({ color: 0x000000, emissive: 0x3a9cff, emissiveIntensity: 2.6, roughness: 0.3 }));
  const screenA = B.m('screenA', std({ color: 0x000000, emissive: 0xffa030, emissiveIntensity: 2.6, roughness: 0.3 }));
  const navRedM = B.m('navRed', std({ color: 0x220000, emissive: 0xff1408, emissiveIntensity: 9 }));
  const navGreenM = B.m('navGreen', std({ color: 0x002210, emissive: 0x10ff50, emissiveIntensity: 9 }));
  const navWhiteM = B.m('navWhite', std({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 9 }));
  const nameBow = B.m('nameBow', std({ map: fitTex(canvasTexture(1024, 128, (c, w, h) => { c.fillStyle = 'rgba(0,0,0,0)'; c.clearRect(0, 0, w, h); c.fillStyle = '#e8e4d8'; c.font = 'bold 92px "Arial Black", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('MV  CHARON', w / 2, h / 2 + 4); }), 3.6, 0.36), transparent: true, alphaTest: 0.35, roughness: 0.6, key: 'nameBow' }));
  const sternName = B.m('sternName', std({ map: fitTex(canvasTexture(1024, 192, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#e8e4d8'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 96px "Arial Black", Impact, sans-serif'; c.fillText('CHARON', w / 2, h * 0.36); c.font = 'bold 54px Arial, sans-serif'; c.fillText('HARBOUR CITY', w / 2, h * 0.78); }), 4.6, 0.86), transparent: true, alphaTest: 0.35, roughness: 0.6, key: 'sternName' }));
  const boardSign = B.m('boardSign', std({ map: fitTex(canvasTexture(512, 128, (c, w, h) => { c.fillStyle = '#0e2a4a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#e8e4d8'; c.lineWidth = 5; c.strokeRect(6, 6, w - 12, h - 12); c.fillStyle = '#e8e4d8'; c.font = 'bold 60px "Arial Black", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('FERRY  ROUTE  4', w / 2, h / 2 + 3); }), 0.9, 0.7), roughness: 0.5, key: 'boardSign' }));
  const lifeRing = B.m('lifeRing', std({ color: 0xe8e6de, roughness: 0.6 }));
  const chainM = B.m('chainM', std({ color: 0x2a2a2c, roughness: 0.45, metalness: 1 }));
  const halos = new Glows(96); veh.frame.add(halos.mesh); parts.halos = halos;

  // ---------------------------------------------------------------- hull loft
  const SS = [0, 0.012, 0.03, 0.055, 0.09, 0.13, 0.18, 0.24, 0.31, 0.39, 0.47, 0.55, 0.63, 0.71, 0.78, 0.85, 0.91, 0.955, 0.985, 1.0], UU = [0, 0.05, 0.12, 0.22, 0.32, 0.42, 0.52, 0.64, 0.76, 0.88, 1.0];
  function hullMesh(u0i, u1i, mat) {
    const rows = SS.length, un = u1i - u0i + 1, cols = un * 2 - 1 + (u0i === 0 ? 0 : 1); const P_ = [], I_ = [], UV = [];
    // per row: port side (u1 -> u0), then starboard (u0 -> u1); at the keel u0=0 the two centre points coincide in x=+-0.08W (flat keel strip)
    const idx = [];
    for (let r = 0; r < rows; r++) {
      const z = -14 + SS[r] * 28, W = halfWidth(z), K = keelY(z); const row = [];
      const prof = []; for (let j = u1i; j >= u0i; j--) prof.push([-1, j]); for (let j = u0i; j <= u1i; j++) prof.push([1, j]);
      let arc = 0, last = null;
      for (const [sd, j] of prof) { const u = UU[j], x = sd * W * sectionF(u), y = K + u * (0 - K); if (last) arc += Math.hypot(x - last[0], y - last[1]); last = [x, y]; row.push(P_.length / 3); P_.push(x, y, z); UV.push(arc, z); }
      idx.push(row);
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < idx[r].length - 1; c++) { const a = idx[r][c], b = idx[r][c + 1], d = idx[r + 1][c], e = idx[r + 1][c + 1]; I_.push(a, b, d, b, e, d); }
    // transom cap
    const last = idx[rows - 1]; const cx = P_.length / 3; P_.push(0, 0, 14); UV.push(0, 14); for (let c = 0; c < last.length - 1; c++) I_.push(cx, last[c], last[c + 1]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P_, 3)); g.setIndex(I_);
    // make sure faces point outward: test one triangle (starboard midship)
    g.computeVertexNormals(); const n = g.attributes.normal; const raw = { p: new Float32Array(g.attributes.position.array), n: new Float32Array(n.array), u: new Float32Array(UV), i: new Uint32Array(g.index.array) };
    return raw;
  }
  const bot = hullMesh(0, 6, hullBot), top = hullMesh(6, 10, hullTop);
  // orientation check + flip if needed (normals should point away from the centreline at midship starboard)
  const fixWinding = (raw) => { let s = 0; for (let k = 0; k < raw.p.length / 3; k += 7) { const x = raw.p[k * 3]; s += Math.sign(x) * raw.n[k * 3]; } if (s < 0) { for (let k = 0; k < raw.n.length; k++) raw.n[k] *= -1; for (let k = 0; k < raw.i.length; k += 3) { const t = raw.i[k + 1]; raw.i[k + 1] = raw.i[k + 2]; raw.i[k + 2] = t; } } };
  fixWinding(bot); fixWinding(top);
  const I4 = new THREE.Matrix4(); B.addRaw(bot, I4, hullBot, { cast: true }); B.addRaw(top, I4, hullTop, { cast: true });
  parts.rivets = hullRivets(B, hullTop, { halfWidth, keelY, sectionF }, { rampZ0: RAMP.z0, rampZ1: RAMP.z1 });

  // ---------------------------------------------------------------- deck + bulwark
  const outline = []; for (let i = 0; i <= 26; i++) { const t = i / 26; const z = -14 + 28 * (Math.sin((t - 0.5) * P) * 0.5 + 0.5); outline.push(z); }
  const poly = []; for (const z of outline) poly.push([halfWidth(z) - 0.02, z]); for (let i = outline.length - 1; i >= 0; i--) poly.push([-(halfWidth(outline[i]) - 0.02), outline[i]]);
  B.extrude({ p: [0, -0.12, 0], poly, h: 0.12, mat: deckM, col: false, bevel: 0 });
  const sheer = (z) => 1.02 + 0.55 * Math.pow(Math.max(0, 1 - (z + 14) / 8.5), 2);        // bulwark height above deck (rises to the bow)
  const RA = RAMP; const inRamp = (za, zb) => zb > RA.z0 - 0.05 && za < RA.z1 + 0.05;
  for (const sd of [-1, 1]) for (let i = 0; i < outline.length - 1; i++) {
    const za = outline[i], zb = outline[i + 1], xa = sd * (halfWidth(za) - 0.09), xb = sd * (halfWidth(zb) - 0.09), h = (sheer(za) + sheer(zb)) / 2;
    if (sd === 1 && inRamp(za, zb)) continue;
    B.beam([xa, h / 2 - 0.02, za], [xb, h / 2 - 0.02, zb], 0.1, h, { mat: hullTop, bevel: 0, col: 'metal', walk: false });
    // inner stiffeners (flat bars) every ~1.4 m
    if (i % 2 === 0) B.beam([xa - sd * 0.06, h / 2, za], [xa - sd * 0.06, h / 2, za + 0.001], 0.05, h * 0.92, { mat: white, bevel: 0, cast: false });
  }
  // bulwark cap rail (teak) around the perimeter; rubbing strake (rubber) at deck level
  const capPts = (sd, zA, zB) => outline.filter((z) => z >= zA && z <= zB).map((z) => [sd * (halfWidth(z) - 0.09), sheer(z) + 0.03, z]);
  B.tube({ pts: capPts(-1, -14, 14), r: 0.05, mat: teak, seg: 6, segs: 60, cast: false }); B.tube({ pts: capPts(1, -14, RA.z0 - 0.05), r: 0.05, mat: teak, seg: 6, segs: 40, cast: false }); B.tube({ pts: capPts(1, RA.z1 + 0.05, 14), r: 0.05, mat: teak, seg: 6, segs: 40, cast: false });
  const strake = (sd, zA, zB) => outline.filter((z) => z >= zA && z <= zB).map((z) => [sd * (halfWidth(z) + 0.07), -0.14, z]);
  B.tube({ pts: strake(-1, -13.6, 14), r: 0.09, mat: rubber, seg: 8, segs: 60, cast: false }); B.tube({ pts: strake(1, -13.6, 14), r: 0.09, mat: rubber, seg: 8, segs: 60, cast: false });
  // freeing ports (dark slots) + name plates
  for (let z = -8.5; z <= 12; z += 2.6) for (const sd of [-1, 1]) { if (sd === 1 && z > RA.z0 - 0.6 && z < RA.z1 + 0.6) continue; B.box({ p: [sd * (halfWidth(z) - 0.03), 0.02, z], s: [0.12, 0.16, 0.5], mat: frameDark, bevel: 0, cast: false }); }
  // bow name on both sides (thin boxes standing off the topsides)
  for (const sd of [-1, 1]) { const z = -8.4, hw = halfWidth(z) * sectionF(0.67) + 0.012; B.box({ p: [sd * hw, -0.95, z], s: [0.02, 0.36, 3.6], mat: nameBow, yaw: 0, bevel: 0, cast: false, anchor: 'center', swap: false }); }
  // stern name plate on the transom
  B.box({ p: [0, -1.2, 14.02], s: [4.6, 0.86, 0.03], mat: sternName, bevel: 0, cast: false });
  // white sheer stripe along the topsides
  for (const sd of [-1, 1]) { const pts = outline.filter((z) => z > -13).map((z) => [sd * (halfWidth(z) + 0.02), -0.62, z]); B.tube({ pts, r: 0.04, mat: whitePlain, seg: 4, segs: 50, cast: false }); }

  // ---------------------------------------------------------------- fenders (hanging rubber cylinders) + tyre rings on the hull
  for (const sd of [-1, 1]) for (const z of [-8, -3.4, 8.5, 12.2]) { const x = sd * (halfWidth(z) + 0.22); B.cyl({ p: [x, -0.95, z], r: 0.16, h: 1.3, seg: 10, mat: rubber, cast: false }); B.cyl({ p: [x, 0.36, z], r: 0.05, h: 0.5, seg: 6, mat: rope, cast: false }); }
  // the two big fenders that meet the quay (starboard, next to the ramp)
  for (const z of [-0.9, 4.2]) B.cyl({ p: [halfWidth(z) + 0.2, -1.0, z], r: 0.2, h: 1.5, seg: 12, mat: rubber, cast: false });

  // ---------------------------------------------------------------- saloon (white) with window openings, enterable
  const SX = 1.9, Z0 = -5.6, Z1 = 5.8, SH = 2.4;
  const wall = (axis, fixed, a, b, openings, mat, thick = 0.14) => {
    // axis 'z': wall runs along z at x = fixed ; axis 'x': runs along x at z = fixed. openings: [a,b,y0,y1]
    let cur = a; const ops = openings.slice().sort((p, q) => p[0] - q[0]);
    const put = (s0, s1, y0, y1, m = mat, col = 'metal') => { if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return; if (axis === 'z') B.box({ p: [fixed, y0, (s0 + s1) / 2], s: [thick, y1 - y0, s1 - s0], mat: m, bevel: 0.01, col, walk: false }); else B.box({ p: [(s0 + s1) / 2, y0, fixed], s: [s1 - s0, y1 - y0, thick], mat: m, bevel: 0.01, col, walk: false }); };
    for (const [oa, ob, y0, y1] of ops) { put(cur, oa, 0, SH); put(oa, ob, 0, y0); put(oa, ob, y1, SH); cur = ob; }
    put(cur, b, 0, SH);
  };
  const win = (axis, fixed, a, b, y0, y1) => { // glass + slim frame
    const m = (a + b) / 2, L = b - a; const mk = (s, ss, y, hh, mat, th) => (axis === 'z' ? B.box({ p: [fixed, y, s], s: [th, hh, ss], mat, bevel: 0, cast: false }) : B.box({ p: [s, y, fixed], s: [ss, hh, th], mat, bevel: 0, cast: false }));
    mk(m, L - 0.02, y0 + 0.02, y1 - y0 - 0.04, glass, 0.02);
    mk(a + 0.03, 0.06, y0, y1 - y0, frameDark, 0.16); mk(b - 0.03, 0.06, y0, y1 - y0, frameDark, 0.16); mk(m, L, y0 - 0.02, 0.06, frameDark, 0.16); mk(m, L, y1 - 0.04, 0.06, frameDark, 0.16);
  };
  const WY0 = 1.05, WY1 = 2.0; const winZ = []; for (let i = 0; i < 6; i++) winZ.push([-4.85 + i * 1.85, -4.85 + i * 1.85 + 1.25]);
  wall('z', -SX, Z0, Z1, winZ.map(([a, b]) => [a, b, WY0, WY1]), white); winZ.forEach(([a, b]) => win('z', -SX, a, b, WY0, WY1));
  const doorS = [0.55, 1.65]; const sbWins = winZ.filter(([a, b]) => b < doorS[0] - 0.2 || a > doorS[1] + 0.2);
  wall('z', SX, Z0, Z1, [...sbWins.map(([a, b]) => [a, b, WY0, WY1]), [doorS[0], doorS[1], 0, 2.05]], white); sbWins.forEach(([a, b]) => win('z', SX, a, b, WY0, WY1));
  wall('x', Z0, -SX, SX, [[-1.4, -0.45, WY0, WY1], [-0.3, 0.3, WY0, WY1], [0.45, 1.4, WY0, WY1]], white); win('x', Z0, -1.4, -0.45, WY0, WY1); win('x', Z0, -0.3, 0.3, WY0, WY1); win('x', Z0, 0.45, 1.4, WY0, WY1);
  wall('x', Z1, -SX, SX, [[-1.75, -0.95, WY0, WY1], [-0.55, 0.55, 0, 2.05], [0.95, 1.75, WY0, WY1]], white); win('x', Z1, -1.75, -0.95, WY0, WY1); win('x', Z1, 0.95, 1.75, WY0, WY1);
  // roof slab (walkable roof deck) + coaming, ceiling inside
  B.box({ p: [0, SH, (Z0 + Z1) / 2], s: [SX * 2 + 0.3, 0.16, Z1 - Z0 + 0.3], mat: white, bevel: 0.02, col: 'metal', walk: true });
  B.box({ p: [0, SH - 0.01, (Z0 + Z1) / 2], s: [SX * 2 - 0.1, 0.02, Z1 - Z0 - 0.1], mat: ceiling, bevel: 0, cast: false });
  // door leaves (open, swung against the wall): starboard side door + aft door
  B.box({ p: [SX + 0.5, 0, doorS[1] - 0.02], s: [0.05, 2.02, 1.02], mat: white, bevel: 0.01, col: false, cast: false, yaw: 0 }); B.box({ p: [SX + 0.02, 1.0, doorS[0] + 0.5], s: [0.02, 0.5, 0.6], mat: glass, bevel: 0, cast: false });
  // interior: floor, benches, tables, counter, lights
  B.box({ p: [0, 0, (Z0 + Z1) / 2], s: [SX * 2 - 0.1, 0.05, Z1 - Z0 - 0.1], mat: lino, bevel: 0, cast: false, recv: true });
  const bench = (x, z0, z1, facing) => { B.box({ p: [x, 0.05, (z0 + z1) / 2], s: [0.5, 0.42, z1 - z0], mat: teak, bevel: 0.015, col: 'wood', walk: false }); B.box({ p: [x, 0.47, (z0 + z1) / 2], s: [0.5, 0.07, z1 - z0], mat: vinyl, bevel: 0.03, cast: false }); B.box({ p: [x + facing * -0.22, 0.54, (z0 + z1) / 2], s: [0.07, 0.55, z1 - z0], mat: vinyl, bevel: 0.03, cast: false }); };
  bench(-1.55, -4.6, -0.2, 1); bench(-1.55, 0.5, 4.6, 1); bench(1.55, -4.6, -0.6, -1); bench(1.55, 2.0, 4.6, -1);
  for (const z of [-3.2, 2.9]) { B.cyl({ p: [-0.15, 0.05, z], r: 0.04, h: 0.7, seg: 6, mat: chrome, cast: false }); B.box({ p: [-0.15, 0.75, z], s: [0.9, 0.05, 0.7], mat: teak, bevel: 0.01, col: 'wood', walk: false }); B.box({ p: [-0.15, 0.05, z], s: [0.5, 0.03, 0.4], mat: chrome, bevel: 0, cast: false }); }
  B.box({ p: [1.5, 0.05, -5.15], s: [0.6, 1.0, 0.7], mat: teak, bevel: 0.02, col: 'wood', walk: false }); B.box({ p: [1.5, 1.05, -5.15], s: [0.64, 0.05, 0.74], mat: whitePlain, bevel: 0.01, cast: false }); B.box({ p: [1.5, 1.1, -5.3], s: [0.34, 0.34, 0.3], mat: chrome, bevel: 0.02, cast: false }); // kiosk + coffee machine
  B.box({ p: [-0.15, 0.05, 5.6], s: [0.9, 0.05, 0.16], mat: teak, bevel: 0.01, cast: false });
  for (const [x, z] of [[-0.9, -3.0], [0.9, -3.0], [-0.9, 1.0], [0.9, 1.0], [-0.9, 4.3], [0.9, 4.3]]) { B.box({ p: [x, SH - 0.06, z], s: [0.14, 0.05, 0.9], mat: lampCold, bevel: 0, cast: false }); halos.add([x, SH - 0.25, z], 0xdfeaff, 0.16, 0.5, 0, { mist: 0.3 }); }
  // notice boards, lifejacket rack (orange), extinguisher, clock
  B.box({ p: [-SX + 0.09, 1.2, -2.6], s: [0.03, 0.7, 0.9], mat: boardSign, bevel: 0, cast: false }); B.box({ p: [-SX + 0.09, 1.3, 3.4], s: [0.04, 0.5, 1.0], mat: orange, bevel: 0.02, cast: false });
  for (let i = 0; i < 5; i++) B.box({ p: [-SX + 0.14, 1.4, 2.9 + i * 0.2], s: [0.14, 0.4, 0.14], mat: orange, bevel: 0.03, cast: false });
  B.cyl({ p: [SX - 0.16, 0.5, 5.25], r: 0.07, h: 0.5, seg: 8, mat: paintRed, cast: false }); B.cyl({ p: [-0.5, 2.05, Z1 - 0.08], r: 0.15, h: 0.03, seg: 16, mat: whitePlain, pitch: P / 2, anchor: 'center', cast: false });

  // ---------------------------------------------------------------- wheelhouse
  const WH0 = 2.55, WH1 = 4.7, WX = 1.75, WZ0 = -5.4, WZ1 = -1.3;
  B.box({ p: [0, WH0 - 0.02, (WZ0 + WZ1) / 2], s: [WX * 2, 0.06, WZ1 - WZ0], mat: lino, bevel: 0, cast: false });
  const whWall = (axis, fixed, a, b, sillH = 0.75) => {
    const len = b - a, n = Math.max(1, Math.round(len / 0.95)), step = len / n;
    const put = (ss0, ss1, y0, y1, m, th, col) => (axis === 'z' ? B.box({ p: [fixed, y0, (ss0 + ss1) / 2], s: [th, y1 - y0, ss1 - ss0], mat: m, bevel: 0, col, walk: false, cast: m !== glass }) : B.box({ p: [(ss0 + ss1) / 2, y0, fixed], s: [ss1 - ss0, y1 - y0, th], mat: m, bevel: 0, col, walk: false, cast: m !== glass }));
    for (let i = 0; i < n; i++) { const s0 = a + i * step, s1 = s0 + step; put(s0, s1, WH0, WH0 + sillH, white, 0.12, 'metal'); put(s0 + 0.04, s1 - 0.04, WH0 + sillH, WH1 - 0.28, glass, 0.02, false); put(s1 - 0.045, s1 + 0.045, WH0 + sillH, WH1 - 0.28, frameDark, 0.14, false); put(s0, s1, WH1 - 0.28, WH1, white, 0.14, false); }
    put(a - 0.045, a + 0.045, WH0 + sillH, WH1 - 0.28, frameDark, 0.14, false);
  };
  whWall('z', -WX, WZ0, WZ1); whWall('z', WX, WZ0, WZ1); whWall('x', WZ0, -WX, WX);
  // aft bulkhead with door slot (solid) + roof
  B.box({ p: [0, WH0, WZ1], s: [WX * 2, WH1 - WH0, 0.12], mat: white, bevel: 0.01, col: 'metal', walk: false });
  B.box({ p: [0, WH1, (WZ0 + WZ1) / 2 - 0.1], s: [WX * 2 + 0.7, 0.14, WZ1 - WZ0 + 0.5], mat: white, bevel: 0.03, col: 'metal', walk: false });
  // console, chairs, wheel, instruments (visible through the glass)
  B.box({ p: [0, WH0, WZ0 + 0.55], s: [3.0, 0.95, 0.65], mat: steelDark, bevel: 0.02, col: false }); B.box({ p: [0, WH0 + 0.95, WZ0 + 0.5], s: [3.0, 0.08, 0.9], mat: paintBlack, bevel: 0.02, cast: false });
  B.box({ p: [-0.85, WH0 + 1.03, WZ0 + 0.6], s: [0.5, 0.02, 0.36], mat: screenG, bevel: 0, cast: false }); B.box({ p: [0.0, WH0 + 1.03, WZ0 + 0.6], s: [0.5, 0.02, 0.36], mat: screenB, bevel: 0, cast: false }); B.box({ p: [0.9, WH0 + 1.03, WZ0 + 0.62], s: [0.4, 0.02, 0.3], mat: screenA, bevel: 0, cast: false });
  B.tube({ pts: (() => { const a = []; for (let i = 0; i <= 20; i++) { const t = i / 20 * P * 2; a.push([0.55 + Math.cos(t) * 0.24, WH0 + 1.28 + Math.sin(t) * 0.24, WZ0 + 1.05]); } return a; })(), r: 0.018, mat: teak, seg: 6, segs: 24, closed: true, cast: false });
  for (let i = 0; i < 4; i++) { const t = i * P / 2; B.beam([0.55, WH0 + 1.28, WZ0 + 1.05], [0.55 + Math.cos(t) * 0.24, WH0 + 1.28 + Math.sin(t) * 0.24, WZ0 + 1.05], 0.02, 0.02, { mat: teak, cast: false }); }
  B.cyl({ p: [0.55, WH0 + 0.95, WZ0 + 0.85], r: 0.03, h: 0.32, seg: 6, mat: chrome, cast: false, pitch: -0.7 });
  B.cyl({ p: [-0.6, WH0, WZ0 + 1.6], r: 0.05, h: 0.5, seg: 8, mat: chrome, cast: false }); B.cyl({ p: [-0.6, WH0 + 0.5, WZ0 + 1.6], r: 0.26, h: 0.06, seg: 12, mat: vinyl, cast: false }); B.box({ p: [-0.6, WH0 + 0.56, WZ0 + 1.85], s: [0.5, 0.5, 0.08], mat: vinyl, bevel: 0.03, cast: false });
  halos.add([0, WH1 - 0.3, -3.5], 0x9dffd0, 0.4, 0.35, 0, { mist: 0.4 }); B.box({ p: [0, WH1 - 0.12, -3.6], s: [1.2, 0.03, 0.2], mat: screenG, bevel: 0, cast: false });
  // bridge wings (open decks with rails) + nav lights
  for (const sd of [-1, 1]) {
    B.box({ p: [sd * 3.05, WH0 - 0.1, -3.3], s: [2.6, 0.1, 2.5], mat: white, bevel: 0.02, col: false }); for (const z of [-4.55, -2.05]) for (const x of [2.0, 4.3]) B.cyl({ p: [sd * x, WH0, z], r: 0.025, h: 1.0, seg: 5, mat: chrome, cast: false });
    for (const y of [0.5, 1.0]) { B.tube({ pts: [[sd * 4.3, WH0 + y, -4.55], [sd * 4.3, WH0 + y, -2.05], [sd * 2.0, WH0 + y, -2.05]], r: 0.018, mat: chrome, seg: 5, segs: 10, cast: false }); B.tube({ pts: [[sd * 2.0, WH0 + y, -4.55], [sd * 4.3, WH0 + y, -4.55], [sd * 4.3, WH0 + y, -2.05]], r: 0.018, mat: chrome, seg: 5, segs: 10, cast: false }); }
    B.beam([sd * 1.9, WH0 - 0.1, -2.6], [sd * 3.6, WH0 - 1.0, -2.6], 0.08, 0.16, { mat: white, cast: false, bevel: 0 }); B.box({ p: [sd * 4.3, WH0 + 0.45, -3.3], s: [0.16, 0.16, 0.16], mat: sd < 0 ? navRedM : navGreenM, bevel: 0.02, cast: false });
    halos.add([sd * 4.3, WH0 + 0.53, -3.3], sd < 0 ? 0xff1a10 : 0x10ff50, 0.22, 1.2, 0, { mist: 0.8 }); B.box({ p: [sd * 3.05, WH0, -3.5], s: [0.34, 0.9, 0.3], mat: steelDark, bevel: 0.02, cast: false });
  }
  // mast, radar (animated), searchlight, antennas, funnel
  B.cyl({ p: [0, WH1 + 0.07, -3.6], r: 0.07, h: 3.4, seg: 8, mat: white, col: false }); B.box({ p: [0, WH1 + 2.3, -3.6], s: [1.3, 0.05, 0.05], mat: white, bevel: 0, cast: false });
  B.sphere({ p: [0, WH1 + 3.5, -3.6], r: 0.1, mat: navWhiteM, seg: 10, cast: false }); halos.add([0, WH1 + 3.5, -3.6], 0xffffff, 0.3, 1.4, 0, { mist: 0.8 });
  B.sphere({ p: [0, WH1 + 2.45, -3.45], r: 0.075, mat: navWhiteM, seg: 8, cast: false }); halos.add([0, WH1 + 2.45, -3.45], 0xfff2d0, 0.2, 1.0, 0, { mist: 0.6 });
  for (const x of [-0.6, 0.6]) { B.cyl({ p: [x, WH1 + 2.3, -3.6], r: 0.012, h: 1.2, seg: 4, mat: chrome, cast: false }); }
  const radar = new THREE.Group(); radar.position.set(0, WH1 + 1.6, -3.6); const rbar = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.09, 0.05), steelDark); const rbase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 10), white); radar.add(rbar); veh.frame.add(radar); parts.animated.radar = radar; B.box({ p: [0, WH1 + 1.45, -3.6], s: [0.3, 0.16, 0.3], mat: white, bevel: 0.03, cast: false });
  B.box({ p: [1.2, WH1 + 0.1, -3.2], s: [0.4, 0.36, 0.34], mat: steelDark, bevel: 0.03, cast: false }); B.cyl({ p: [1.2, WH1 + 0.46, -3.2], r: 0.15, h: 0.16, seg: 10, mat: chrome, cast: false }); // searchlight
  // funnel (oval): black top, white band, red body
  const oval = (rx, rz, n = 20) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * P * 2) * rx, Math.sin(i / n * P * 2) * rz]);
  B.extrude({ p: [0, SH + 0.08, 2.6], poly: oval(0.95, 0.72), h: 1.6, mat: paintRed, col: 'metal', bevel: 0.02 }); B.extrude({ p: [0, SH + 1.68, 2.6], poly: oval(0.93, 0.7), h: 0.5, mat: white, col: false, bevel: 0.02 }); B.extrude({ p: [0, SH + 2.18, 2.6], poly: oval(0.9, 0.68), h: 0.7, mat: paintBlack, col: false, bevel: 0.02 });
  B.cyl({ p: [0, SH + 2.78, 2.6], r: [0.6, 0.6], h: 0.08, seg: 16, mat: steelDark, cast: false, open: false }); B.cyl({ p: [-0.3, SH + 2.88, 2.3], r: 0.05, h: 0.5, seg: 6, mat: chrome, cast: false }); B.cyl({ p: [0.5, SH + 2.88, 3.0], r: 0.045, h: 0.7, seg: 6, mat: chrome, cast: false });
  // whistle (steam horn) on the funnel
  B.cyl({ p: [0.0, SH + 2.5, 3.35], r: [0.06, 0.09], h: 0.4, seg: 8, mat: brass, cast: false }); B.cyl({ p: [0.0, SH + 2.5, 3.35], r: 0.02, h: 0.9, seg: 5, mat: brass, cast: false, roll: 0 });

  // ---------------------------------------------------------------- roof deck: rails, benches, raft canisters, dinghy davits; stairs
  const rail = (a, b, h = 1.0) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.round(L / 1.1)); for (let i = 0; i <= n; i++) { const t = i / n; B.cyl({ p: [a[0] + (b[0] - a[0]) * t, SH + 0.08, a[1] + (b[1] - a[1]) * t], r: 0.022, h, seg: 5, mat: chrome, cast: false }); } for (const y of [0.5, 1.0]) B.beam([a[0], SH + 0.08 + y, a[1]], [b[0], SH + 0.08 + y, b[1]], 0.035, 0.035, { mat: chrome, cast: false, bevel: 0 }); B.colliders.addBox({ x: (a[0] + b[0]) / 2, y: SH + 0.6, z: (a[1] + b[1]) / 2, hx: Math.max(0.05, Math.abs(b[0] - a[0]) / 2), hy: 0.6, hz: Math.max(0.05, Math.abs(b[1] - a[1]) / 2), surface: 'metal', walk: false }); };
  rail([-SX + 0.05, -1.3], [-SX + 0.05, 0.3]); rail([-SX + 0.05, 1.55], [-SX + 0.05, Z1]); rail([SX - 0.05, -1.3], [SX - 0.05, Z1]); rail([-SX + 0.05, Z1 - 0.02], [SX - 0.05, Z1 - 0.02]);
  for (const x of [-1.25, 1.25]) { B.cyl({ p: [x, SH + 0.08, 4.5], r: 0.24, h: 1.05, seg: 12, mat: whitePlain, pitch: P / 2, anchor: 'center', cast: true, col: false, yaw: 0 }); }
  B.box({ p: [0, SH + 0.08, 4.95], s: [1.6, 0.4, 0.45], mat: teak, bevel: 0.02, col: 'wood', walk: false }); B.box({ p: [0, SH + 0.5, 5.15], s: [1.6, 0.4, 0.06], mat: teak, bevel: 0.02, cast: false });
  // life-raft canisters (fibreglass, on the roof edge) and the port stairs to the roof
  for (const x of [-1.5, 1.5]) B.cyl({ p: [x, SH + 0.36, 0.9 + (x > 0 ? 1.2 : 0)], r: 0.28, h: 1.3, seg: 12, mat: whitePlain, pitch: P / 2, anchor: 'center', cast: true, col: false });
  const stairs = { x: -3.2, z0: 5.0, n: 14, rise: 0.182, run: 0.26 };
  for (let i = 0; i < stairs.n; i++) B.box({ p: [stairs.x, 0, stairs.z0 - stairs.run * (i + 0.5)], s: [1.0, stairs.rise * (i + 1), stairs.run], mat: deckM, bevel: 0.008, col: 'metal', walk: true });
  B.box({ p: [-2.7, SH, 0.9], s: [1.6, 0.1, 1.5], mat: deckM, bevel: 0.01, col: 'metal', walk: true }); B.box({ p: [-3.25, 0, 1.25], s: [0.9, SH, 0.9], mat: steelDark, bevel: 0.01, col: 'metal', walk: false, cast: false });
  for (const x of [-3.7, -2.7]) { B.beam([x, 0.95, 5.0], [x, SH + 0.95, 1.5], 0.04, 0.04, { mat: chrome, cast: false, bevel: 0 }); B.beam([x, 0.5, 5.0], [x, SH + 0.5, 1.5], 0.04, 0.04, { mat: chrome, cast: false, bevel: 0 }); }
  B.colliders.addBox({ x: -3.72, y: 1.4, z: 3.2, hx: 0.04, hy: 1.6, hz: 1.9, surface: 'metal', walk: false });

  // ---------------------------------------------------------------- deck fittings: bollards, cleats, fairleads, windlass, chain, rope coils, crates, barrels, life rings, extinguishers
  const bollard = (x, z, yaw = 0) => { B.cyl({ p: [x, 0, z], r: 0.14, h: 0.34, seg: 10, mat: steelDark, col: 'metal', cast: true }); B.cyl({ p: [x, 0.34, z], r: [0.14, 0.19], h: 0.08, seg: 10, mat: steelDark, cast: false }); };
  for (const z of [-11.4, -9.2, 4.2, 8.5, 11.6]) for (const sd of [-1, 1]) if (!(sd === 1 && z > RA.z0 - 1 && z < RA.z1 + 1)) bollard(sd * (halfWidth(z) - 0.42), z);
  for (const [x, z] of [[-1.0, -8.6], [1.0, -8.6]]) bollard(x, z);
  const cleat = (x, z, yaw) => { B.box({ p: [x, 0, z], s: [0.36, 0.08, 0.1], mat: steelDark, yaw, bevel: 0.01, cast: false }); B.box({ p: [x, 0.07, z], s: [0.26, 0.05, 0.05], mat: steelDark, yaw, bevel: 0.01, cast: false }); };
  for (const z of [-6.6, -1.8, 5.6, 9.8]) for (const sd of [-1, 1]) cleat(sd * (halfWidth(z) - 0.5), z, sd * 0.2);
  // windlass + chain locker + hawse pipe on the forecastle
  B.cyl({ p: [0, 0, -10.6], r: 0.28, h: 0.5, seg: 14, mat: steelDark, col: 'metal' }); B.cyl({ p: [0, 0.5, -10.6], r: [0.28, 0.22], h: 0.1, seg: 14, mat: steelDark, cast: false });
  B.cyl({ p: [0, 0.45, -10.6], r: 0.06, h: 0.7, seg: 8, mat: chrome, cast: false, roll: P / 2, anchor: 'center' }); B.cyl({ p: [-0.55, 0.55, -10.6], r: 0.22, h: 0.4, seg: 12, mat: paintBlack, roll: P / 2, cast: true, anchor: 'center' }); B.cyl({ p: [0.55, 0.55, -10.6], r: 0.22, h: 0.4, seg: 12, mat: paintBlack, roll: P / 2, cast: true, anchor: 'center' });
  B.box({ p: [0, 0, -12.2], s: [0.9, 0.25, 0.8], mat: steelDark, bevel: 0.02, col: 'metal' }); B.cyl({ p: [0, 0.02, -13.05], r: 0.13, h: 0.4, seg: 8, mat: paintBlack, cast: false });
  B.tube({ pts: [[0.0, 0.5, -10.1], [0.0, 0.1, -11.2], [0, 0.05, -12.4], [0, -0.1, -13.1]], r: 0.03, mat: chainM, seg: 6, segs: 12, cast: false });
  // fairleads (bow, stern, sides)
  for (const [x, z] of [[-1.1, -12.4], [1.1, -12.4], [-3.4, 12.7], [3.4, 12.7]]) B.box({ p: [x, 0.05, z], s: [0.4, 0.3, 0.16], mat: steelDark, bevel: 0.03, cast: false });
  // life rings on the bulwark and saloon walls
  // (rings on the saloon side walls: plane x=const => circle in y/z)
  const ringYZ = (x, y, z) => { const pts = Array.from({ length: 17 }, (_, i) => { const t = i / 16 * P * 2; return [x, y + Math.sin(t) * 0.3, z + Math.cos(t) * 0.3]; }); B.tube({ pts, r: 0.065, mat: lifeRing, seg: 8, segs: 24, closed: true, cast: false }); for (let i = 0; i < 4; i++) { const t0 = i * P / 2 + P / 4; B.box({ p: [x, y + Math.sin(t0) * 0.3 - 0.06, z + Math.cos(t0) * 0.3 - 0.05], s: [0.15, 0.12, 0.1], mat: paintRed, bevel: 0, cast: false, yaw: 0 }); } };
  // (life rings: real tori in ferryDetail.js)
  // rope coils (tube spirals) + stowed hawsers
  const coil = (x, z, r0, turns) => { const pts = []; for (let i = 0; i <= turns * 12; i++) { const t = i / 12 * P * 2; const rr = r0 * (1 - i / (turns * 12) * 0.3); pts.push([x + Math.cos(t) * rr, 0.06 + i / (turns * 12) * 0.13, z + Math.sin(t) * rr]); } B.tube({ pts, r: 0.035, mat: rope, seg: 6, segs: pts.length * 2, cast: false }); };
  coil(-3.4, -9.6, 0.42, 4); coil(3.35, -10.2, 0.36, 3); coil(-3.3, 10.9, 0.44, 4); coil(-3.6, 8.2, 0.34, 3);
  // cargo on the aft deck: crates + oil drums + lashings, tarp
  const crate = (x, z, w, h, d, yaw = 0) => { B.box({ p: [x, 0, z], s: [w, h, d], mat: crateWood, yaw, bevel: 0.015, col: 'wood', walk: false }); for (const sx of [-1, 1]) B.box({ p: [x + Math.cos(yaw) * sx * (w / 2 - 0.04), 0, z - Math.sin(yaw) * sx * (w / 2 - 0.04)], s: [0.06, h + 0.01, d + 0.01], mat: steelDark, yaw, bevel: 0, cast: false }); };
  crate(2.4, 9.6, 1.2, 0.9, 0.9, 0.08); crate(2.5, 11.0, 0.9, 0.7, 0.8, -0.1); crate(3.1, 8.6, 0.8, 0.6, 0.7, 0.2); B.box({ p: [2.45, 0.9, 9.6], s: [0.9, 0.5, 0.7], mat: crateWood, yaw: 0.2, bevel: 0.015, col: false });
  for (const [x, z] of [[-2.6, 6.6], [-2.05, 6.9], [-2.4, 7.5]]) B.cyl({ p: [x, 0, z], r: 0.29, h: 0.88, seg: 12, mat: paintBlack, col: 'metal', cast: true });
  B.tube({ pts: [[2.0, 0.85, 9.0], [2.7, 0.92, 9.3], [3.2, 0.5, 9.0]], r: 0.012, mat: rope, seg: 4, segs: 10, cast: false });
  // fire hose reel + extinguishers + first-aid on the saloon aft wall; deck lamp fixtures (under the saloon roof edge)
  B.cyl({ p: [1.2, 1.0, Z1 + 0.14], r: 0.26, h: 0.14, seg: 14, mat: paintRed, pitch: P / 2, anchor: 'center', cast: false }); B.cyl({ p: [1.2, 1.0, Z1 + 0.14], r: 0.05, h: 0.16, seg: 8, mat: steelDark, pitch: P / 2, anchor: 'center', cast: false });
  const deckLamps = [];
  for (const [x, z] of [[SX + 0.15, -4.4], [SX + 0.15, 1.2], [SX + 0.15, 5.0], [-SX - 0.15, -4.4], [-SX - 0.15, 4.3], [0, Z1 + 0.25], [0, Z0 - 0.25]]) { B.box({ p: [x, SH - 0.25, z], s: [0.16, 0.12, 0.28], mat: steelDark, bevel: 0.02, cast: false }); B.sphere({ p: [x, SH - 0.28, z], r: 0.07, mat: lampWarm, seg: 8, cast: false }); halos.add([x, SH - 0.3, z], 0xffd090, 0.18, 0.9, 0, { mist: 0.8 }); deckLamps.push([x, SH - 0.32, z]); }
  parts.deckLamps = deckLamps;
  // flag mast at the stern with the ensign (animated cloth)
  B.cyl({ p: [0, 0, 13.4], r: 0.03, h: 2.4, seg: 6, mat: white, cast: false }); B.sphere({ p: [0, 2.45, 13.4], r: 0.05, mat: brass, seg: 6, cast: false }); halos.add([0, 2.3, 13.4], 0xfff0d0, 0.12, 0.6, 0, { mist: 0.6 });
  const flagMat = std({ color: 0xb0261c, roughness: 0.85, side: THREE.DoubleSide, wind: { amp: 0.07, freq: 4.2, stiff: 'uv' }, key: 'flag' });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55, 8, 4), flagMat); flag.position.set(0, 1.95, 13.4 - 0.5); flag.rotation.y = P / 2; veh.frame.add(flag); parts.animated.flag = flag;
  // anchor light + jack staff
  B.cyl({ p: [0, 0, -13.3], r: 0.025, h: 1.4, seg: 5, mat: white, cast: false }); B.sphere({ p: [0, 1.4, -13.3], r: 0.06, mat: navWhiteM, seg: 8, cast: false }); halos.add([0, 1.42, -13.3], 0xffffff, 0.2, 0.9, 0, { mist: 0.7 });
  // stern/masthead white lights (stern light)
  B.sphere({ p: [0, 1.15, 13.9], r: 0.06, mat: navWhiteM, seg: 6, cast: false }); halos.add([0, 1.18, 13.85], 0xffffff, 0.18, 0.8, 0, { mist: 0.7 });

  // ---------------------------------------------------------------- ramp / gangway (hinged at the deck, raises to close the opening): animated group
  const rampG = new THREE.Group(); rampG.position.set(RA.hx, 0.02, (RA.z0 + RA.z1) / 2); veh.frame.add(rampG); parts.ramp = rampG;
  const rw = RA.z1 - RA.z0, mk = (geo, mat, x, y, z, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; rampG.add(m); return m; };
  const rampTop = std({ ...{}, color: 0x39443f, roughness: 0.4, metalness: 1, key: 'rampTop' });
  const rampPlate = B.m('rampPlate', { pattern: 'diamond', size: 512, tile: 1, colors: [0x55605a, 0x434c48], params: { n: 12, height: 1, wear: 0.7 }, bump: 6, metal: 0.4, rough: [0.3, 0.6], layers: { rust: 0.2, grime: 0.5, wet: 0.5, scratch: 0.5, edge: 0.5 } }, { wet: true });
  const rampGeo = new THREE.BoxGeometry(RA.len, 0.12, rw); const rg = rampGeo.attributes.uv; for (let i = 0; i < rg.count; i++) rg.setXY(i, rg.getX(i) * RA.len, rg.getY(i) * rw);
  mk(rampGeo, rampPlate, RA.len / 2, 0, 0); mk(new THREE.BoxGeometry(RA.len, 0.16, 0.08), white, RA.len / 2, 0.02, rw / 2 + 0.04); mk(new THREE.BoxGeometry(RA.len, 0.16, 0.08), white, RA.len / 2, 0.02, -rw / 2 - 0.04);
  mk(new THREE.BoxGeometry(0.1, 0.16, rw + 0.16), steelDark, RA.len - 0.03, 0.0, 0); mk(new THREE.BoxGeometry(0.2, 0.05, rw), hullTop, -0.06, 0.02, 0);
  for (let i = 0; i < 6; i++) mk(new THREE.BoxGeometry(0.04, 0.02, rw - 0.1), steelDark, 0.4 + i * 0.4, 0.075, 0, false); // anti-slip cleats
  for (const sd of [-1, 1]) { const z = sd * (rw / 2 + 0.05); for (let i = 0; i < 4; i++) mk(new THREE.CylinderGeometry(0.022, 0.022, 1.0, 6), chrome, 0.15 + i * 0.85, 0.6, z, false); for (const y of [0.45, 0.95]) mk(new THREE.BoxGeometry(RA.len - 0.1, 0.035, 0.035), chrome, RA.len / 2, y + 0.06, z, false); }
  // warning stripes at the tip + a small amber beacon on a post (blinks while the ramp is moving)
  const hazard = B.m('hazardM', { pattern: 'hazard', size: 256, tile: 0.5, colors: [0xe0b020, 0x181818, 0x403830], params: { n: 4, angle: 0, wear: 0.6 }, bump: 0.5, rough: [0.5, 0.85] });
  mk(new THREE.BoxGeometry(0.28, 0.02, rw), hazard, RA.len - 0.2, 0.075, 0, false);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), B.m('amber', std({ color: 0x221000, emissive: 0xffa020, emissiveIntensity: 1 }))); beacon.position.set(3.9, 2.2, RA.z0 - 0.3); veh.frame.add(beacon); parts.beacon = beacon; B.cyl({ p: [3.9, 0, RA.z0 - 0.3], r: 0.03, h: 2.15, seg: 6, mat: steelDark, cast: false });
  parts.beaconGlow = halos.add([3.9, 2.2, RA.z0 - 0.3], 0xffa020, 0.28, 0, 0, { mist: 1 });
  // hydraulic actuators (barrel fixed to the deck, rod to the ramp underside): meshes updated each frame
  parts.act = [];
  for (const sd of [-1, 1]) { const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8), steelDark), rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), chrome); barrel.castShadow = true; rod.castShadow = true; veh.frame.add(barrel, rod); parts.act.push({ barrel, rod, z: (RA.z0 + RA.z1) / 2 + sd * (rw / 2 - 0.25), base: new THREE.Vector3(3.0, 0.22, (RA.z0 + RA.z1) / 2 + sd * (rw / 2 - 0.25)) }); }
  parts.rampWidth = rw;
  { const bars = []; for (let i = 0; i < 27; i++) bars.push([RA.len / 2, 0.09, -rw / 2 + 0.06 + i * (rw - 0.12) / 26, RA.len - 0.3, 0.035, 0.028]); for (let i = 0; i < 8; i++) bars.push([0.25 + i * 0.35, 0.085, 0, 0.03, 0.03, rw - 0.1]); rampG.add(new THREE.Mesh(boxesGeo(bars), steelDark)); }   // ramp anti-slip grating: one merged mesh
  // opening blocker collider (solid while the ramp is raised) — toggled by the vehicle
  parts.blocker = B.colliders.addBox({ x: RA.hx + 0.1, y: 1.3, z: (RA.z0 + RA.z1) / 2, hx: 0.08, hy: 1.4, hz: rw / 2 + 0.1, surface: 'metal', walk: false, solid: true });
  parts.rampSteps = []; const NST = 12; for (let i = 0; i < NST; i++) parts.rampSteps.push(B.colliders.addBox({ x: RA.hx + (i + 0.5) * RA.len / NST, y: -0.1, z: (RA.z0 + RA.z1) / 2, hx: RA.len / NST / 2, hy: 0.05, hz: rw / 2, surface: 'metal', walk: true, solid: false }));
  parts.rampLanding = B.colliders.addBox({ x: RA.hx + RA.len + 0.9, y: -0.1, z: (RA.z0 + RA.z1) / 2, hx: 0.9, hy: 0.05, hz: rw / 2 + 0.3, surface: 'concrete', walk: true, solid: false });
  for (const sd of [-1, 1]) B.colliders.addBox({ x: RA.hx + RA.len / 2 + 0.6, y: 0.5, z: (RA.z0 + RA.z1) / 2 + sd * (rw / 2 + 0.12), hx: RA.len / 2 + 1.4, hy: 2.5, hz: 0.06, surface: 'metal', walk: false });
  // ---------------------------------------------------------------- detail pass (rings, panelling, portholes, funnel badge) then finish
  addFerryDetail(B, { teak, whitePlain, chrome, brass, steelDark, paintRed, lifeRing, lampCold, lampWarm, frameDark, orange, vinyl, rope, hullTop }, { SX, Z0, Z1, SH, halos, RA });
  B.finish(); veh.colliders = B.colliders; B.colliders.groundY = 0;
  // interior bounds / trigger volumes
  veh.bounds = { minX: -4.35, maxX: RA.hx + RA.len + 1.9, minZ: -12.4, maxZ: 13.0 };
  veh.boardBox = { min: new THREE.Vector3(-4.3, -1, -12.2), max: new THREE.Vector3(4.3, 6.0, 12.6) }; veh.floorY = 0;
  parts.hullMats = { hullTop, hullBot, deckM }; parts.ropeMat = rope;
  return parts;
}
