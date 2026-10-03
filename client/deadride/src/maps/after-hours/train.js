// AFTER HOURS — the MONORAIL train model: two 12 m Alweg-style cars (streamlined bullet noses, tumblehome bodies straddling the beam) + rubber gangway.
// Shell = one smooth lofted skin per car whose windows, door openings and windshield are real alpha-cut holes painted in a canvas livery (so the player sees the
// park through them); an inner liner, inset glass, sliding bi-parting pneumatic doors, benches, chrome poles, swinging hand-straps (pendulum physics),
// flickering fluorescent tubes, a dead PA speaker, route map, cab dashboard, bogies with spinning tyres. Frame origin = interior floor centre, forward = -z.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { Builder } from '../../core/build.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { trainReal } from './train-real.js';
import { glowMat, loftRaw, pipe, torus, geo, mergedMesh, neonText, TAU, PI } from './common.js';

const RH = [[0, -0.42], [0.56, -0.42], [0.56, -0.92], [1.10, -0.92], [1.17, -0.6], [1.22, -0.32], [1.29, 0.1], [1.32, 0.55], [1.32, 0.95], [1.31, 1.25], [1.29, 1.6], [1.26, 1.95], [1.18, 2.25], [1.02, 2.5], [0.78, 2.67], [0.45, 2.76], [0, 2.79]];
const OUT = [...RH, ...RH.slice(1, 16).reverse().map(([x, y]) => [-x, y])];       // 32 points, closed ring; 0 = belly centre, right side 1..16, left 17..31
const NR = OUT.length, CAR_L = 12, NOSE0 = 9, GAP = 0.6, SIDE_D = 1.32;
const uY = (y) => { for (let k = 4; k < 16; k++) { const a = RH[k][1], b = RH[k + 1][1]; if (y >= a && y <= b) return (k + (y - a) / (b - a)) / NR; } return y < -0.6 ? 4 / NR : 16 / NR; };
const WIN = { y0: 0.95, y1: 2.25 }, DOOR = { y0: 0.1, y1: 1.98 };
const WINDOWS = [[0.4, 2.2], [4.4, 6.65]], DOORS = [[2.6, 4.0], [7.0, 8.4]];        // s = distance from the inner (gangway) end
const noseF = (f) => { const wS = Math.pow(Math.max(0, 1 - Math.pow(f, 2.3)), 1 / 2.3), yT = 2.79 - 1.5 * Math.pow(f, 1.7), yB = -0.92 + 0.55 * Math.pow(f, 2.0); return { wS, yT, yB }; };
const ringAt = (s) => { if (s <= NOSE0) return OUT.map((p) => p.slice()); const f = Math.min(1, (s - NOSE0) / (CAR_L - NOSE0)), { wS, yT, yB } = noseF(f); return OUT.map(([x, y]) => [x * wS, yB + (y + 0.92) * (yT - yB) / 3.71]); };
const S_RINGS = [0, 8.999, 9.0, 9.35, 9.85, 10.4, 10.95, 11.4, 11.75, 11.95, 12];

/** paint the livery / liner. kind 'ext' | 'liner'. u across the ring, v along the car (0 = inner end). */
function paintShell(kind, car = 0, W = 1024, H = 2048) {
  return canvasTexture(W, H, (c) => {
    const bandU = (y0, y1, col) => { const a = uY(y0) * W, b = uY(y1) * W; c.fillStyle = col; c.fillRect(a, 0, b - a, H); c.fillRect(W - b, 0, b - a, H); };
    const sPx = (s) => s / CAR_L * H, uPx = (y) => uY(y) * W;
    const ext = kind === 'ext';
    c.fillStyle = ext ? '#e9ece7' : '#b9b29d'; c.fillRect(0, 0, W, H);
    if (ext) {
      bandU(-0.92, -0.6, '#33383d'); c.fillStyle = '#25292d'; c.fillRect(0, 0, uPx(-0.6), H); c.fillRect(W - uPx(-0.6), 0, uPx(-0.6), H);
      bandU(-0.6, 0.56, '#12978f'); bandU(0.56, 0.7, '#cb302b'); bandU(0.7, 0.755, '#f2ead6'); bandU(0.755, 0.95, '#e9ece7');
      const ur = uPx(1.95); c.fillStyle = '#c4cad0'; c.fillRect(ur, 0, W - 2 * ur, H); c.fillStyle = '#9aa2aa'; c.fillRect(W / 2 - 40, 0, 80, H);
      // swept teal/red chevrons toward the nose
      for (const [col, w, o] of [['#cb302b', 0.05, 0], ['#12978f', 0.06, 0.06]]) { c.fillStyle = col; for (const side of [1, -1]) { c.beginPath(); const x0 = side > 0 ? uPx(0.9) : W - uPx(0.9), x1 = side > 0 ? uPx(1.5) : W - uPx(1.5); c.moveTo(x0, sPx(7.6 + o * 12)); c.lineTo(x1, sPx(9.4 + o * 12)); c.lineTo(x1, sPx(9.4 + o * 12 + w * 12)); c.lineTo(x0, sPx(7.6 + o * 12 + w * 12)); c.fill(); } }
      // logo roundel + wordmark + car number: text is laid out per (car, side) so it reads left-to-right for a viewer standing outside that side
      const txt = (side, sMid, drawFn) => { const rd = (car === 0 ? 1 : -1) * (side > 0 ? 1 : -1), up = side > 0 ? 1 : -1; const cx = side > 0 ? (uPx(-0.5) + uPx(0.5)) / 2 : W - (uPx(-0.5) + uPx(0.5)) / 2; c.save(); c.setTransform(0, rd, -up, 0, cx, sPx(sMid)); drawFn(); c.restore(); };
      for (const side of [1, -1]) { txt(side, 6.4, () => { c.fillStyle = '#f5eedb'; c.font = 'italic 700 64px "Liberation Serif", serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('After Hours', 0, 0); c.font = '700 26px "Liberation Sans", sans-serif'; c.fillText('E X P R E S S', 0, 46); });
        const cx = side > 0 ? (uPx(-0.3) + uPx(0.4)) / 2 : W - (uPx(-0.3) + uPx(0.4)) / 2; c.fillStyle = '#1a1a1a'; for (const [dx, dy, r] of [[0, 0, 26], [-24, -22, 13], [24, -22, 13]]) { c.beginPath(); c.arc(cx + dx, sPx(1.2) + dy, r, 0, TAU); c.fill(); }
        const up = side > 0 ? 1 : -1, cx2 = side > 0 ? uPx(1.5) : W - uPx(1.5), rd = (car === 0 ? 1 : -1) * (side > 0 ? 1 : -1); c.save(); c.setTransform(0, rd, -up, 0, cx2, sPx(11.2)); c.fillStyle = '#c9302c'; c.font = '700 44px "Liberation Sans", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(car === 0 ? '01' : '02', 0, 0); c.restore(); }
      // grime streaks
      for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(30,25,20,${Math.random() * 0.06})`; c.fillRect(Math.random() * W, Math.random() * H * 0.9, 1 + Math.random() * 3, 20 + Math.random() * 160); }
    } else {
      bandU(-0.6, 0.98, '#1f6f6b'); bandU(0.98, 1.0, '#c9302c'); const ur = uPx(1.95); c.fillStyle = '#c4beab'; c.fillRect(ur, 0, W - 2 * ur, H); c.fillStyle = '#25292d'; c.fillRect(0, 0, uPx(-0.5), H); c.fillRect(W - uPx(-0.5), 0, uPx(-0.5), H);
      // route-map strip above the windows: line + 4 stations, then advert panels
      for (const side of [1, -1]) { const ua = uPx(2.36), ub = uPx(2.62); const ux = side > 0 ? ua : W - ub; c.fillStyle = '#1b1e22'; c.fillRect(ux, sPx(0.5), ub - ua, sPx(10.5) - sPx(0.5)); c.strokeStyle = '#ffc040'; c.lineWidth = 5; c.beginPath(); const mid = ux + (ub - ua) / 2; c.moveTo(mid, sPx(1.0)); c.lineTo(mid, sPx(10)); c.stroke(); for (let i = 0; i < 4; i++) { c.fillStyle = ['#ff7ab8', '#40e8ff', '#a060ff', '#ff9a30'][i]; c.beginPath(); c.arc(mid, sPx(1.4 + i * 2.7), 11, 0, TAU); c.fill(); } }
      for (let i = 0; i < 2; i++) for (const side of [1, -1]) { const ua = uPx(1.45), ub = uPx(1.85); const ux = side > 0 ? ua : W - ub; c.fillStyle = ['#30a0a0', '#c04040'][i]; c.fillRect(ux, sPx(4.65 + i * 4.0) , ub - ua, sPx(1.5)); c.fillStyle = '#f5f0e0'; c.font = '700 20px "Liberation Sans", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; const rd = (car === 0 ? 1 : -1) * (side > 0 ? -1 : 1), up = side > 0 ? 1 : -1; c.save(); c.setTransform(0, rd, -up, 0, ux + (ub - ua) / 2, sPx(5.4 + i * 4)); c.fillText(i ? 'HAVE YOU SEEN THE MASCOTS?' : 'STAND CLEAR OF THE DOORS', 0, 0); c.restore(); }
    }
    // ---- holes: window + door openings (alpha 0) with painted frames; the windshield sector on the nose
    const holeRect = (u0, u1, s0, s1, pad = 10) => { c.fillStyle = ext ? '#23272b' : '#33383c'; c.fillRect(u0 - pad, sPx(s0) - pad, u1 - u0 + 2 * pad, sPx(s1 - s0) + 2 * pad); };
    const clear = (u0, u1, s0, s1) => { c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fillRect(u0, sPx(s0), u1 - u0, sPx(s1 - s0)); c.restore(); };
    const sides = [[uPx(WIN.y0), uPx(WIN.y1)], [W - uPx(WIN.y1), W - uPx(WIN.y0)]], dsides = [[uPx(DOOR.y0), uPx(WIN.y1)], [W - uPx(WIN.y1), W - uPx(DOOR.y0)]];
    for (const [a, b] of sides) for (const [s0, s1] of WINDOWS) holeRect(a, b, s0, s1);
    { const [a, b] = dsides[0]; for (const [s0, s1] of DOORS) holeRect(a, b, s0, s1, 12); const [a2, b2] = dsides[1]; for (const [s0, s1] of DOORS) { c.strokeStyle = ext ? '#3a3f44' : '#444a4f'; c.lineWidth = 6; c.strokeRect(a2, sPx(s0), b2 - a2, sPx(s1 - s0)); c.beginPath(); c.moveTo((a2 + b2) / 2, sPx(s0)); c.lineTo((a2 + b2) / 2, sPx(s1)); c.stroke(); } }
    const wsU0 = 8 / NR * W, wsU1 = 24 / NR * W; holeRect(wsU0, wsU1, 9.3, 11.85, 14);
    for (const [a, b] of sides) for (const [s0, s1] of WINDOWS) clear(a, b, s0, s1);
    { const [a, b] = dsides[0]; for (const [s0, s1] of DOORS) clear(a, b, s0, s1); const [a2, b2] = sides[1]; for (const [s0, s1] of DOORS) clear(a2 + 10, b2 - 10, s0 + 0.28, s1 - 0.28); }
    clear(wsU0, wsU1, 9.3, 11.85);
  }, { srgb: true, aniso: 8 });
}

export async function buildTrainModel({ synth }) {
  const root = new THREE.Group(); root.name = 'monorail-model';
  const B = new Builder({ synth, group: root, seed: 5, cell: 200 });
  const M = (name, pattern, colors, params, o = {}, extra) => B.m(name, { pattern, size: o.size || 512, tile: o.tile || 1.5, colors, params, bump: o.bump ?? 2, rough: o.rough || [0.5, 0.9], metal: o.metal || 0, layers: o.layers || {} }, extra);
  const extTexA = paintShell('ext', 0), extTexB = paintShell('ext', 1), linTex = paintShell('liner');
  linTex.anisotropy = 8;
  const mkShell = (tex, k) => std({ map: tex, roughness: 0.26, metalness: 0.12, alphaTest: 0.5, alphaToCoverage: true, side: THREE.FrontSide + k, envMapIntensity: 1.5 });
  const shellA = mkShell(extTexA, 'A'), shellB = mkShell(extTexB, 'B'); const shellM = shellA;
  const linerM = std({ map: linTex, roughness: 0.72, metalness: 0.0, alphaTest: 0.5, alphaToCoverage: true, side: THREE.FrontSide, envMapIntensity: 0.12 });
  const glassM = std({ color: 0xa8d8e8, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2.0 });
  const windshM = std({ color: 0x0b1620, roughness: 0.04, metalness: 0.55, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2.2 });
  const chrome = std({ color: 0xdfe4e8, roughness: 0.1, metalness: 1, envMapIntensity: 1.2 });
  const rubber = M('trainRubber', 'rubber', [0x1a1a1c, 0x232326], { scale: 24, tread: 0.4 }, { tile: 1, bump: 3, rough: [0.8, 1] });
  const floorM = M('trainFloor', 'diamond', [0x3a3d42, 0x2c2f33], { n: 12, height: 0.7, wear: 0.4 }, { tile: 1.2, bump: 6, metal: 0.2, rough: [0.4, 0.8], layers: { grime: 0.5, dust: 0.2 } });
  const vinyl = M('trainVinyl', 'leather', [0x148a86, 0x0e6a67, 0x0a3f3d], { scale: 60, creases: 0.5, wear: 0.4 }, { tile: 1, bump: 3, rough: [0.35, 0.7], layers: { grime: 0.3, scratch: 0.15 } });
  const darkM = std({ color: 0x1a1d20, roughness: 0.6, metalness: 0.4 }); const paintW = std({ color: 0xe9ece7, roughness: 0.3, metalness: 0.1 }); const paintR = std({ color: 0xc02f2b, roughness: 0.3, metalness: 0.1 }); const paintT = std({ color: 0x12978f, roughness: 0.3, metalness: 0.1 });
  const lampW = glowMat(0xfff4dc, 7, { flicker: 0.0, cell: 100, seed: 1 }); const lampRed = glowMat(0xff2a1a, 9, { flicker: 0, cell: 100, seed: 2 }); const tubeM = glowMat(0xeef6ff, 1.7, { flicker: 0.16, cell: 100, dead: 0.0, seed: 6, rough: 0.5 }); const tubeM2 = glowMat(0xeef6ff, 1.7, { flicker: 0.05, cell: 100, seed: 8, rough: 0.5 });
  const ledM = glowMat(0xffa030, 8, { flicker: 0.04, cell: 100, seed: 3 });
  const cars = [], doorPanels = { fwd: [], back: [] }, colliders = [], lights = [], straps = [];
  // ---------------------------------------------------------------- shell + liner + glass per car
  const carRaw = (mirror) => {
    const rings = S_RINGS.map((s) => ringAt(s).map(([x, y]) => [x, y, mirror * (GAP + s)]));
    const raw = loftRaw(rings, { closed: true, flip: mirror > 0 }); const W1 = NR + 1;
    for (let j = 0; j < rings.length; j++) for (let i = 0; i < W1; i++) { const k = (j * W1 + i) * 2; raw.u[k] = i / NR; raw.u[k + 1] = 1 - S_RINGS[j] / CAR_L; }
    return raw;
  };
  const linerRaw = (mirror) => {
    const idx = []; for (let i = 5; i <= 27; i++) idx.push(i); const rings = S_RINGS.filter((s) => s < 11.7).map((s) => { const r = ringAt(s); return idx.map((i) => { const [x, y] = r[i]; const k = 0.955; const cy = 1.05; return [x * k, cy + (y - cy) * 0.97, mirror * (GAP + s + 0.02)]; }); });
    const raw = loftRaw(rings, { closed: false, flip: mirror < 0 }); const W1 = idx.length; const ss = S_RINGS.filter((s) => s < 11.7);
    for (let j = 0; j < rings.length; j++) for (let i = 0; i < W1; i++) { const k = (j * W1 + i) * 2; raw.u[k] = idx[i] / NR; raw.u[k + 1] = 1 - ss[j] / CAR_L; }
    return raw;
  };
  const glassRaws = (mirror) => {
    const out = []; const seg = (lo, hi, s0, s1, sideSel) => { const idx = []; for (let i = lo; i <= hi; i++) idx.push(i); const ss = [s0, (s0 + s1) / 2, s1]; const rings = ss.map((s) => { const r = ringAt(s); return idx.map((i) => { const [x, y] = r[i]; return [x * 0.985, y, mirror * (GAP + s)]; }); }); out.push(loftRaw(rings, { closed: false, flip: (mirror < 0) !== (sideSel < 0) })); };
    for (const [s0, s1] of WINDOWS) { seg(8, 12, s0 - 0.05, s1 + 0.05, 1); seg(20, 24, s0 - 0.05, s1 + 0.05, -1); }
    for (const [s0, s1] of DOORS) seg(21, 24, s0 + 0.2, s1 - 0.2, -1);
    const ss = [9.3, 9.85, 10.4, 10.95, 11.4, 11.85]; const idx = []; for (let i = 8; i <= 24; i++) idx.push(i); const rings = ss.map((s) => { const r = ringAt(s); return idx.map((i) => { const [x, y] = r[i]; return [x * 0.985, y - 0.01, mirror * (GAP + s + 0.02 * 0)]; }); }); const ws = loftRaw(rings, { closed: false, flip: mirror > 0 });
    return { win: out, ws };
  };
  for (const mirror of [-1, 1]) {
    B.addRaw(carRaw(mirror), B.matrix([0, 0, 0]), mirror < 0 ? shellA : shellB, { cast: true }); B.addRaw(linerRaw(mirror), B.matrix([0, 0, 0]), linerM, { cast: false });
    const g = glassRaws(mirror); for (const r of g.win) B.addRaw(r, B.matrix([0, 0, 0]), glassM, { cast: false }); B.addRaw(g.ws, B.matrix([0, 0, 0]), windshM, { cast: false });
  }

  // ---------------------------------------------------------------- per-car interior + fittings (car A = front, mirror -1; car B = rear, mirror +1)
  const doorZ = [], seatList = [];
  const doorTex = canvasTexture(256, 512, (c, w, h) => { c.fillStyle = '#e9ece7'; c.fillRect(0, 0, w, h); c.fillStyle = '#12978f'; c.fillRect(0, h * 0.64, w, h * 0.36); c.fillStyle = '#cb302b'; c.fillRect(0, h * 0.6, w, h * 0.04); c.fillStyle = '#15171a'; c.fillRect(0, 0, w * 0.06, h); c.fillRect(w * 0.94, 0, w * 0.06, h); c.fillStyle = '#23272b'; c.fillRect(w * 0.08, h * 0.04, w * 0.84, h * 0.5); c.fillStyle = '#c8ced2'; c.fillRect(w * 0.42, h * 0.56, w * 0.16, 6); c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fillRect(w * 0.13, h * 0.07, w * 0.74, h * 0.44); c.restore(); });
  const doorM = std({ map: doorTex, roughness: 0.3, metalness: 0.15, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, envMapIntensity: 1.3 });
  const panelG = new THREE.BoxGeometry(0.02, 1.98, 0.68); // x thin, y tall, z width -> UV: use a custom plane-ish mapping via box faces: face +x uses u along z, v along y
  const fwdParts = [], backParts = [];
  const mkPanel = (x, y, z, list) => { const g = new RoundedBoxGeometry(0.06, 1.98, 0.68, 2, 0.012); g.translate(x, y, z); list.push({ geo: g }); };
  const addBench = (xs, s0, s1, mirror, both = true) => {
    const zc = mirror * (GAP + (s0 + s1) / 2), L = s1 - s0, x = xs * 1.0, n = Math.max(1, Math.round(L / 0.62)), sw = L / n, ax = x - xs * 0.25;   // ax = aisle-side face of the seat box
    B.box({ p: [x, 0.0, zc], s: [0.5, 0.38, L], mat: darkM, bevel: 0.03, cast: true });
    for (let i = 0; i < n; i++) { const z = zc - L / 2 + sw * (i + 0.5);
      B.box({ p: [x, 0.36, z], s: [0.5, 0.15, sw - 0.035], mat: vinyl, bevel: 0.055, cast: true }); B.box({ p: [xs * 1.16, 0.55, z], s: [0.12, 0.62, sw - 0.035], mat: vinyl, bevel: 0.05, roll: xs * -0.14, cast: true });   // moulded seat + back cushion per passenger
      for (const dx of [-0.13, 0.13]) B.box({ p: [x + dx, 0.512, z], s: [0.008, 0.004, sw - 0.1], mat: darkM, bevel: 0, cast: false });   // stitched seam lines
      B.box({ p: [xs * 1.135, 0.72, z], s: [0.014, 0.004, sw - 0.12], mat: darkM, bevel: 0, cast: false, roll: xs * -0.14 }); }
    for (let k = 0; k < 6; k++) B.box({ p: [ax - xs * 0.004, 0.09 + k * 0.038, zc], s: [0.008, 0.016, L * 0.62], mat: darkM, bevel: 0, cast: false });   // heater grille slots
    for (const e of [-1, 1]) { const zz = zc + e * (L / 2 - 0.03); pipe(B, [x - xs * 0.05, 0.62, zz], [x - xs * 0.05, 0.85, zz], 0.02, chrome, { seg: 6, cast: false });
      pipe(B, [x - xs * 0.24, 0.42, zz], [x - xs * 0.24, 0.74, zz], 0.018, chrome, { seg: 6, cast: false }); pipe(B, [x - xs * 0.24, 0.74, zz], [x + xs * 0.12, 0.74, zz], 0.018, chrome, { seg: 6, cast: false });   // armrest loop
      pipe(B, [x - xs * 0.2, -0.16, zz], [x - xs * 0.2, 0.0, zz], 0.022, chrome, { seg: 6, cast: false }); }
    colliders.push({ x, y: 0.28, z: zc, hx: 0.27, hy: 0.28, hz: L / 2, yaw: 0, surface: 'fabric', walk: false }); };
  for (const mirror of [-1, 1]) {
    const Z = (s) => mirror * (GAP + s), zc = Z(6);
    B.box({ p: [0, -0.16, Z(6)], s: [2.34, 0.16, CAR_L], mat: floorM, cast: false, bevel: 0.01 });
    // seating: left wall continuous, right wall between/around the doors
    addBench(-1, 0.3, 4.4, mirror); addBench(-1, 4.9, 8.9, mirror); addBench(1, 0.3, 2.3, mirror); addBench(1, 4.3, 6.7, mirror);
    // inner end wall with a passage
    for (const sx of [-1, 1]) { B.box({ p: [sx * 0.86, 0, mirror * (GAP - 0.04)], s: [0.62, 2.62, 0.1], mat: paintW, bevel: 0.02, cast: true }); colliders.push({ x: sx * 0.86, y: 1.3, z: mirror * (GAP - 0.04), hx: 0.31, hy: 1.3, hz: 0.06, surface: 'metal', walk: false }); }
    B.box({ p: [0, 2.08, mirror * (GAP - 0.04)], s: [1.1, 0.56, 0.1], mat: paintW, bevel: 0.02, cast: false }); B.box({ p: [0, 2.16, mirror * (GAP - 0.09)], s: [0.5, 0.2, 0.03], mat: ledM, cast: false });
    // doors: two bi-parting leaves per opening on the +x (platform) side
    for (const [s0, s1] of DOORS) { const zd = Z((s0 + s1) / 2); doorZ.push([zd - 0.7, zd + 0.7]); mkPanel(1.27, 1.04, zd - 0.35, fwdParts); mkPanel(1.27, 1.04, zd + 0.35, backParts);
      for (const e of [-1, 1]) pipe(B, [0.9, 0, zd + e * 0.85], [0.9, 2.55, zd + e * 0.85], 0.022, chrome, { seg: 8, cast: false }); for (const e of [-1, 1]) colliders.push({ x: 0.9, y: 1.3, z: zd + e * 0.85, hx: 0.05, hy: 1.3, hz: 0.05, surface: 'metal', walk: false }); }
    // overhead rails, hanger rods, fluorescent fixtures, PA horn, roof equipment
    for (const rx of [-0.45, 0.45]) { pipe(B, [rx, 2.36, Z(0.4)], [rx, 2.36, Z(8.8)], 0.022, chrome, { seg: 6, cast: false }); for (const s of [1.2, 4.0, 6.8, 8.6]) pipe(B, [rx, 2.36, Z(s)], [rx, 2.6, Z(s)], 0.012, chrome, { seg: 4, cast: false }); }
    for (const s of [2.4, 6.4]) { B.box({ p: [0, 2.53, Z(s)], s: [0.62, 0.05, 1.8], mat: paintW, bevel: 0.015, cast: false }); for (const dx of [-0.2, 0.2]) B.box({ p: [dx, 2.48, Z(s)], s: [0.07, 0.05, 1.6], mat: (mirror < 0) === (dx < 0) ? tubeM : tubeM2, cast: false, bevel: 0.01 }); lights.push({ pos: [0, 2.3, Z(s)], color: 0xe4f0ff, intensity: 1.5, distance: 7, flicker: (mirror < 0) === (s < 4) ? 0.32 : 0.06 }); }
    B.box({ p: [0.0, 2.36, Z(9.8)], s: [0.3, 0.18, 0.22], mat: darkM, bevel: 0.03, cast: false }); B.box({ p: [0.12, 2.3, Z(9.68)], s: [0.04, 0.04, 0.03], mat: ledM, cast: false });
    for (const s of [1.6, 6.0]) { B.box({ p: [0, 2.79, Z(s)], s: [1.5, 0.3, 1.0], mat: paintW, bevel: 0.05, cast: true }); for (let i = -2; i <= 2; i++) B.box({ p: [i * 0.28, 3.06, Z(s)], s: [0.04, 0.03, 0.9], mat: darkM, cast: false }); }
    for (const rx of [-0.98, 0.98]) pipe(B, [rx, 2.6, Z(0.3)], [rx, 2.6, Z(8.9)], 0.02, chrome, { seg: 6, cast: false }); pipe(B, [0.4, 2.95, Z(8.0)], [0.4, 3.5, Z(8.0)], 0.012, chrome, { seg: 4, cast: false }); B.sphere({ p: [0.4, 3.52, Z(8.0)], r: 0.035, seg: 6, mat: chrome, cast: false });
    // cab end: console with gauges, seat; head/tail lamps on the nose
    { const gauges = neonPanel_(512, 256); B.box({ p: [0, 0, Z(10.5)], s: [1.7, 0.98, 0.5], mat: darkM, bevel: 0.05, cast: true }); B.box({ p: [0, 0.99, Z(10.35)], s: [1.5, 0.22, 0.34], mat: gauges, cast: false, pitch: mirror * 0.3 });
      colliders.push({ x: 0, y: 0.5, z: Z(10.5), hx: 0.85, hy: 0.5, hz: 0.25, surface: 'metal', walk: false });
      B.box({ p: [0, 0, Z(9.8)], s: [0.4, 0.5, 0.4], mat: vinyl, bevel: 0.08 }); B.box({ p: [0, 0.5, Z(9.6)], s: [0.4, 0.55, 0.1], mat: vinyl, bevel: 0.06 });
      for (const sx of [-1, 1]) { B.sphere({ p: [sx * 0.63, 0.5, mirror * (GAP + 11.78)], r: 0.14, seg: 10, mat: mirror < 0 ? lampW : lampRed, scale: [1, 1, 0.55], cast: false }); pipe(B, [sx * 0.66, 0.5, mirror * (GAP + 11.74)], [sx * 0.66, 0.5, mirror * (GAP + 11.84)], 0.19, chrome, { seg: 10, cast: false }); }
      B.box({ p: [0, -0.36, mirror * (GAP + 11.9)], s: [0.62, 0.16, 0.14], mat: chrome, bevel: 0.05, cast: false }); }
    // destination sign on the nose roof
    { const dm = neonPanel_(512, 96, 'AFTER HOURS  EXPRESS'); B.box({ p: [0, 2.12, mirror * (GAP + 10.05)], s: [1.3, 0.24, 0.05], mat: dm, cast: false, pitch: mirror * -0.5, bevel: 0.01 }); }
  }
  // beacon on the front roof + doors as two animated merged meshes (all forward-moving / backward-moving leaves)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), glowMat(0xff2a1a, 10, { flicker: 0, cell: 100 })); beacon.position.set(0, 2.62, -(GAP + 10.4)); root.add(beacon);
  const doorsF = mergedMesh(root, fwdParts, doorM, { cast: true }), doorsB = mergedMesh(root, backParts, doorM, { cast: true });
  // gangway bellows: pleated rubber tube between the cars + floor plates
  { const rings = []; const idx = []; for (let i = 5; i <= 27; i++) idx.push(i); for (let j = 0; j <= 16; j++) { const t = j / 16, z = -GAP + 2 * GAP * t, pl = 1 + 0.035 * Math.sin(t * PI * 8); rings.push(idx.map((i) => [OUT[i][0] * 0.97 * pl, 1.05 + (OUT[i][1] - 1.05) * 0.965 * pl, z])); }
    B.addRaw(loftRaw(rings, { closed: false }), B.matrix([0, 0, 0]), B.m('bellows', std({ color: 0x1b1c1e, roughness: 0.9, side: THREE.DoubleSide })), { cast: true }); B.box({ p: [0, -0.16, 0], s: [2.0, 0.16, 1.3], mat: floorM, cast: false });
    for (const sx of [-1, 1]) colliders.push({ x: sx * 1.2, y: 1.3, z: 0, hx: 0.08, hy: 1.3, hz: 0.7, surface: 'fabric', walk: false }); }
  trainReal(B, { chrome, rubber, darkM, paintW, lampW, lampRed, WINDOWS, DOORS, ringAt });   // exterior hardware: gaskets, door tracks, skirts, bogies, roof gear, wipers, coupler
  B.finish();
  // ---------------------------------------------------------------- hand-straps: pendulums driven by the train's acceleration (instanced, updated per frame)
  const strapG = (() => { const parts = [new THREE.BoxGeometry(0.03, 0.42, 0.006), new THREE.TorusGeometry(0.075, 0.012, 5, 12)]; parts[0].translate(0, -0.21, 0); parts[1].translate(0, -0.5, 0); const a = mergedMesh(new THREE.Group(), parts.map((g) => ({ geo: g })), darkM); return a.geometry; })();
  const NS = 16, strapMesh = new THREE.InstancedMesh(strapG, std({ color: 0x1c1f22, roughness: 0.6, metalness: 0.2 }), NS); strapMesh.frustumCulled = false; strapMesh.castShadow = false; root.add(strapMesh);
  const st = []; for (const mirror of [-1, 1]) for (const rx of [-0.45, 0.45]) for (const s of [1.7, 3.9, 6.3, 8.4]) st.push({ x: rx, y: 2.36, z: mirror * (GAP + s), ax: 0, az: 0, vx: 0, vz: 0, ph: Math.random() * 6 });
  const sm = new THREE.Matrix4(), sq = new THREE.Quaternion(), se = new THREE.Euler(), sp = new THREE.Vector3(), ss = new THREE.Vector3(1, 1, 1);
  let tPa = 8 + Math.random() * 10;
  return {
    root, colliders, doorZ: doorZ.sort((a, b) => a[0] - b[0]), lights, headlights: [{ pos: [0, 0.55, -12.5] }],
    setDoors(k) { const d = k * 0.68, out = 0.07 * Math.min(1, k * 7); doorsF.position.set(out, 0, -d); doorsB.position.set(out, 0, d); },
    update(dt, t, kin) {
      const g = 9.81, L = 0.55, w2 = g / L, c = 2.2, ax = -(kin?.acc?.x || 0) / g * 0.9, az = -(kin?.acc?.z || 0) / g * 0.9;
      for (let i = 0; i < NS; i++) { const s = st[i]; const tx = ax, tz = az; s.vx += (-(w2) * (s.ax - tx) - c * s.vx) * dt; s.vz += (-(w2) * (s.az - tz) - c * s.vz) * dt; s.ax += s.vx * dt; s.az += s.vz * dt; s.ax = Math.max(-0.9, Math.min(0.9, s.ax)); s.az = Math.max(-0.9, Math.min(0.9, s.az));
        se.set(-s.az, 0, s.ax, 'XYZ'); sq.setFromEuler(se); sp.set(s.x, s.y, s.z); sm.compose(sp, sq, ss); strapMesh.setMatrixAt(i, sm); } strapMesh.instanceMatrix.needsUpdate = true;
      beacon.visible = Math.sin(t * 5.1) > -0.2; tPa -= dt; if (tPa < 0) { tPa = 14 + Math.random() * 16; this.onPa?.(); }
    },
  };
}
function neonPanel_(w, h, text) {
  if (text) return canvasTextureEmissive(w, h, (c, e) => { c.fillStyle = '#080808'; c.fillRect(0, 0, w, h); for (let x = 4; x < w; x += 6) for (let y = 4; y < h; y += 6) { c.fillStyle = '#1a1208'; c.fillRect(x, y, 4, 4); } e.font = '700 46px "Liberation Sans", sans-serif'; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = '#ffa030'; e.fillText(text, w / 2, h / 2 + 2); }, 7, 'destLED');
  return canvasTextureEmissive(w, h, (c, e) => { c.fillStyle = '#101214'; c.fillRect(0, 0, w, h); e.fillStyle = '#000'; e.fillRect(0, 0, w, h); const g = (x, y, r, col) => { e.strokeStyle = col; e.lineWidth = 4; e.beginPath(); e.arc(x, y, r, PI * 0.8, PI * 2.2); e.stroke(); e.fillStyle = col; e.fillRect(x - 2, y - r + 6, 4, r * 0.7); }; g(120, 130, 90, '#40ff90'); g(300, 130, 60, '#ffb030'); g(430, 130, 40, '#ff4040'); for (let i = 0; i < 6; i++) { e.fillStyle = i % 2 ? '#ff5030' : '#40e8ff'; e.fillRect(40 + i * 30, 230, 18, 12); } }, 4, 'cabGauges');
}
function canvasTextureEmissive(w, h, draw, intensity, key) {
  const em = canvasTexture(w, h, (c) => { c.clearRect(0, 0, w, h); }); const ec = em.image.getContext('2d'); const base = canvasTexture(w, h, (c) => { draw(c, ec); });
  em.needsUpdate = true; base.needsUpdate = true; return std({ map: base, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.5, key });
}
