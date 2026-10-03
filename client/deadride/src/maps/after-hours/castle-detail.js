// AFTER HOURS — Haunted Castle: architectural relief and courtyard props layered on top of castle.js (kept separate to stay well under the file-size budget).
// Real castles get their character from relief: string courses, stepped buttresses, corbel tables (machicolation), archivolts around portals, steep slate roofs with
// dormers and chimneys, ivy on the north walls, ravens on every ledge. Everything here is StaticBatch geometry or instanced (a handful of draw calls).
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { makeRng } from '../../core/util.js';
import { makeBeam } from '../../core/glow.js';
import { extrudeXY, quad, pipe, torus, geo, TAU, PI } from './common.js';

export function castleDetail(K) {
  const { B, ctx, RC, halos, flames, stone, stoneD, slate, iron, wood, glowO, winG, winP, winO, archPts, lancet } = K;
  const V = THREE.Vector3;

  // ---------------------------------------------------------------- string courses (projecting horizontal bands) around the keep and the side halls
  for (const y of [11.2, 21.8, 31.6]) {
    B.box({ p: [0, y, -8.86], s: [28.7, 0.55, 0.42], mat: stoneD, bevel: 0.06, cast: false }); B.box({ p: [0, y, -31.14], s: [28.7, 0.55, 0.42], mat: stoneD, bevel: 0.06, cast: false });
    for (const sx of [-1, 1]) B.box({ p: [sx * 14.14, y, -20], s: [0.42, 0.55, 22.5], mat: stoneD, bevel: 0.06, cast: false });
  }
  for (const sx of [-1, 1]) { B.box({ p: [sx * 22.5, 9.2, -7.86], s: [16.6, 0.5, 0.42], mat: stoneD, bevel: 0.06, cast: false }); B.box({ p: [sx * 22.5, 17.2, -7.86], s: [16.6, 0.5, 0.42], mat: stoneD, bevel: 0.06, cast: false }); }

  // ---------------------------------------------------------------- stepped buttresses with sloped caps (side halls' front + keep corners)
  const buttress = (x, z, yaw = 0, h = 17) => {
    const tiers = [[1.25, 1.0, 0, h * 0.55], [0.95, 0.68, h * 0.55, h * 0.8], [0.68, 0.4, h * 0.8, h]];   // [width, projection, y0, y1]
    for (const [w, d, y0, y1] of tiers) B.box({ p: [x + Math.sin(yaw) * d / 2, y0, z + Math.cos(yaw) * d / 2], s: [w, y1 - y0, d], yaw, mat: stone, bevel: 0.05, col: y0 === 0 ? 'rock' : false, cast: true });
    B.prism({ p: [x + Math.sin(yaw) * 0.2, h, z + Math.cos(yaw) * 0.2], s: [0.8, 0.6, 0.6], yaw, mat: stoneD });
  };
  for (const sx of [-1, 1]) for (const x of [16.4, 20.5, 24.5, 28.6]) buttress(sx * x, -7.99, 0, 17.4);   // side halls (front face z = -8)
  for (const sx of [-1, 1]) for (const z of [-26.5, -29.5]) buttress(sx * 14.02, z, sx * PI / 2, 33);      // keep flanks beyond the side halls
  for (const x of [-11, -5.5, 0, 5.5, 11]) buttress(x, -31.02, PI, 33);                                      // keep back wall

  // ---------------------------------------------------------------- corbel table (machicolation) under the keep parapet: instanced corbels + a projecting band
  {
    const cg = geo('corbel', () => { const a = new THREE.BoxGeometry(0.5, 0.55, 0.62); a.translate(0, 0.28, 0.31); const b = new THREE.BoxGeometry(0.34, 0.5, 0.42); b.translate(0, -0.22, 0.21); const g = new THREE.BufferGeometry(); const A = a.toNonIndexed(), Bg = b.toNonIndexed(); const pos = new Float32Array([...A.attributes.position.array, ...Bg.attributes.position.array]), nor = new Float32Array([...A.attributes.normal.array, ...Bg.attributes.normal.array]), uv = new Float32Array([...A.attributes.uv.array, ...Bg.attributes.uv.array]); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g; });
    const put = (x, y, z, yaw) => B.instance('corbel', cg, stoneD, B.matrix([x, y, z], yaw), 0xffffff, { cast: false });
    for (let x = -13.4; x <= 13.4; x += 1.15) { put(x, 32.15, -8.86, 0); put(x, 32.15, -31.14, PI); }
    for (let z = -30; z <= -10; z += 1.15) { put(-14.14, 32.15, z, -PI / 2); put(14.14, 32.15, z, PI / 2); }
    B.box({ p: [0, 33.35, -8.5], s: [29, 0.5, 1.05], mat: stoneD, bevel: 0.05, cast: false });
  }

  // ---------------------------------------------------------------- steep slate hip roof rising behind the parapet, with ridge cap, dormers and chimneys
  {
    B.prism({ p: [0, 34.4, -21], s: [24.6, 9.2, 19.2], mat: slate }); B.box({ p: [0, 43.55, -21], s: [24.6, 0.3, 0.35], mat: stoneD, cast: false, bevel: 0.03 });
    for (const sx of [-1, 1]) { B.sphere({ p: [sx * 12.4, 43.65, -21], r: 0.32, seg: 8, mat: iron }); pipe(B, [sx * 12.4, 43.8, -21], [sx * 12.4, 46.6, -21], 0.05, iron, { seg: 5 }); }
    for (const x of [-8.5, -2.8, 2.8, 8.5]) {   // dormers on the front slope
      const zf = -13.4, y0 = 36.0; B.box({ p: [x, y0, zf], s: [2.0, 2.3, 1.7], mat: stone, bevel: 0.05, cast: true }); B.prism({ p: [x, y0 + 2.3, zf], s: [2.5, 1.35, 2.2], yaw: 0, mat: slate });
      lancet(x, y0 + 0.3, zf + 0.9, 1.05, 1.7, 0, x > 0 ? winP : winG, false);
    }
    for (const sx of [-1, 1]) { const x = sx * 8.5, z = -27; B.box({ p: [x, 36.5, z], s: [1.7, 7.2, 1.7], mat: stone, bevel: 0.05, cast: true }); B.box({ p: [x, 43.6, z], s: [2.1, 0.35, 2.1], mat: stoneD, cast: false }); for (const dx of [-0.35, 0.35]) B.box({ p: [x + dx, 43.9, z], s: [0.42, 0.2, 0.9], mat: iron, cast: false }); halos.add([x, 44.1, z], 0xff8a2a, 0.5, 0.3, 0); }
  }

  // ---------------------------------------------------------------- gatehouse: nested archivolts around the tunnel mouth, jamb shafts, hood mould
  {
    const ring = (w0, h0, w1, h1, z, depth, mat) => extrudeXY(B, { p: [0, 0, z], pts: archPts(w0, h0), holes: [archPts(w1, h1).reverse()], depth, mat, cast: true });
    ring(5.5, 7.6, 4.62, 6.86, 2.16, 0.32, stoneD); ring(6.5, 8.4, 5.5, 7.6, 2.16, 0.22, stone); ring(7.4, 9.2, 6.5, 8.4, 2.16, 0.14, stoneD);
    for (const sx of [-1, 1]) for (const [r, h] of [[0.28, 5.4], [0.2, 5.6]]) { B.cyl({ p: [sx * (2.6 + (r > 0.25 ? 0 : 0.5)), 0, 2.3], r, h, seg: 10, mat: stoneD, cast: false }); B.sphere({ p: [sx * (2.6 + (r > 0.25 ? 0 : 0.5)), h + 0.05, 2.3], r: r * 1.35, seg: 8, mat: stone, cast: false }); }
    for (const sx of [-1, 1]) buttress(sx * 8.35, 2.0, 0, 13.2);
    // arrow slits in the gatehouse faces + the guardroom windows
    for (const sx of [-1, 1]) for (const y of [4.2, 9.4]) B.box({ p: [sx * 6.6, y, 2.13], s: [0.16, 1.5, 0.12], mat: K.voidM, cast: false });
    for (const sx of [-1, 1]) lancet(sx * 6.2, 6.2, 2.16, 1.0, 2.2, 0, sx > 0 ? winO : winG, true);
  }

  // ---------------------------------------------------------------- tower bands + machicolated crowns on the two big keep towers
  for (const sx of [-1, 1]) { const x = sx * 14.6, z = -8.6;
    for (const y of [12, 24, 36]) B.cyl({ p: [x, y, z], r: 3.62, h: 0.45, seg: 24, mat: stoneD, cast: false });
    B.lathe({ p: [x, 38.4, z], profile: [[3.4, 0], [3.65, 0.3], [4.05, 0.8], [4.05, 1.4], [3.7, 1.4]], seg: 28, mat: stone, cast: true });   // corbelled crown under the roof
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; B.box({ p: [x + Math.cos(a) * 3.85, 38.1, z + Math.sin(a) * 3.85], s: [0.38, 0.55, 0.5], yaw: -a, mat: stoneD, cast: false }); }
    for (const [y, m] of [[15.5, winG], [30.5, winP]]) lancet(x + Math.cos(sx > 0 ? PI / 2 + 0.55 : PI / 2 - 0.55) * 3.42, y, z + 3.42 * Math.sin(sx > 0 ? PI / 2 + 0.55 : PI / 2 - 0.55), 0.9, 2.6, 0, m, false);
  }

  // ---------------------------------------------------------------- curtain walls: pilasters, arrow slits, drip-stone sills, wall torches
  for (const sx of [-1, 1]) for (const x of [18, 25, 32]) {
    B.box({ p: [sx * x, 0, 2.28], s: [1.0, 8.6, 0.55], mat: stone, bevel: 0.05, cast: true }); B.box({ p: [sx * x, 8.6, 2.34], s: [1.3, 0.35, 0.7], mat: stoneD, bevel: 0.03, cast: false });
    B.box({ p: [sx * (x + 3.4), 5.6, 2.16], s: [0.14, 1.4, 0.1], mat: K.voidM, cast: false });
  }
  for (const [x, z] of [[-3.6, 2.6], [3.6, 2.6]]) { const y = 4.6; const sg = Math.sign(x);
    B.box({ p: [x, y + 0.55, z - 0.42], s: [0.34, 0.5, 0.05], mat: iron, anchor: 'center', bevel: 0.006, cast: false }); for (const [dy, dz] of [[0.0, 0.0], [0.2, 0.0]]) B.box({ p: [x, y + 0.42 + dy, z - 0.24], s: [0.05, 0.05, 0.4], mat: iron, anchor: 'center', cast: false });   // wall plate + brackets
    torus(B, { p: [x, y + 0.36, z - 0.05], R: 0.11, r: 0.014, seg: 4, tube: 14, mat: iron, cast: false }); pipe(B, [x, y + 0.42, z - 0.24], [x, y + 0.48, z - 0.02], 0.016, iron, { seg: 4, cast: false });   // holder ring
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; pipe(B, [x + Math.cos(a) * 0.09, y + 0.98, z + Math.sin(a) * 0.09], [x + Math.cos(a) * 0.19, y + 1.28, z + Math.sin(a) * 0.19], 0.011, iron, { seg: 3, cast: false }); }   // cresset basket bars
    torus(B, { p: [x, y + 1.28, z], R: 0.19, r: 0.014, seg: 4, tube: 16, mat: iron, cast: false }); torus(B, { p: [x, y + 1.05, z], R: 0.13, r: 0.012, seg: 4, tube: 14, mat: iron, cast: false }); B.cyl({ p: [x, y + 0.94, z], r: [0.05, 0.09], h: 0.1, seg: 8, mat: iron, cast: false });
    pipe(B, [x, y, z], [x, y + 0.9, z], 0.05, iron, { seg: 6 }); for (const yy of [0.12, 0.3, 0.5, 0.7]) torus(B, { p: [x, y + yy, z], R: 0.055, r: 0.011, seg: 4, tube: 10, mat: wood, cast: false });   // pole with wrapping
    B.cyl({ p: [x, y + 0.9, z], r: [0.13, 0.2], h: 0.24, seg: 8, mat: iron, cast: false }); B.sphere({ p: [x, y + 1.2, z], r: 0.22, seg: 8, mat: glowO, cast: false, scale: [1, 1.4, 1] }); flames.push([x, y + 1.25, z, 3, 1.3, 0.35]); ctx.light({ pos: [x, y + 1.5, z + 0.6], color: 0xff7a24, intensity: 30, distance: 15, decay: 2, flicker: 0.4, flickerSpeed: 11 }); halos.add([x, y + 1.3, z], 0xff8a2a, 0.9, 0.5, 9); }

  // ---------------------------------------------------------------- courtyard props: hay cart, barrels, stocks, gallows, crates
  {
    const barrelG = geo('cbarrel', () => { const g = new THREE.LatheGeometry([[0.0, 0], [0.3, 0], [0.37, 0.3], [0.4, 0.55], [0.37, 0.82], [0.3, 1.05], [0.0, 1.05]].map(([r, y]) => new THREE.Vector2(r, y)), 12); return g; });
    const brl = (x, z, s = 1, yaw = 0) => { B.instance('cbarrel', barrelG, wood, B.matrix([x, 0, z], yaw, s), 0xffffff, { cast: true }); B.colliders.addCyl({ x, z, r: 0.4 * s, y0: 0, y1: 1.0 * s, surface: 'wood', walk: false }); for (const y of [0.22, 0.85]) B.instance('cbarrelHoop', geo('cbarrelHoop', () => new THREE.TorusGeometry(0.36, 0.02, 4, 12).rotateX(PI / 2)), iron, B.matrix([x, y * s, z], yaw, s), 0xffffff, { cast: false }); };
    [[10.5, 34.6], [11.6, 35.3], [10.8, 36.4], [12.8, 34.2], [-30.5, 34.8], [-31.6, 35.6], [21, 36.6], [22.2, 36.9]].forEach(([x, z], i) => brl(x, z, 0.9 + (i % 3) * 0.12, i));
    for (const [x, z, s] of [[-9.5, 36.5, 0.9], [-9.4, 36.5, 0.7], [-10.5, 37.3, 0.8]]) { B.box({ p: [x, 0, z], s: [s, s, s], mat: wood, bevel: 0.03, col: 'wood', yaw: x }); }
    // hay cart: bed, side rails, two spoked wheels, shafts, hay heap
    { const cx = -16, cz = 35.5, yaw = 0.35; const c = Math.cos(yaw), sn = Math.sin(yaw); const L = (lx, y, lz) => [cx + lx * c + lz * sn, y, cz - lx * sn + lz * c];
      B.box({ p: L(0, 0.75, 0), s: [2.8, 0.14, 1.5], yaw, mat: wood, bevel: 0.03, col: 'wood' }); for (const sz of [-0.72, 0.72]) B.box({ p: L(0, 0.9, sz), s: [2.8, 0.5, 0.08], yaw, mat: wood, bevel: 0.02, cast: false }); B.box({ p: L(-1.35, 0.9, 0), s: [0.08, 0.5, 1.5], yaw, mat: wood, cast: false });
      for (const sz of [-0.86, 0.86]) { const wp = L(0.1, 0.55, sz); torus(B, { p: wp, R: 0.52, r: 0.05, seg: 6, tube: 20, yaw, pitch: 0, roll: 0, mat: iron, cast: true }); for (let k = 0; k < 8; k++) { const a = k / 8 * PI; pipe(B, [wp[0] + Math.cos(a) * Math.cos(yaw) * 0.5, wp[1] + Math.sin(a) * 0.5, wp[2] - Math.cos(a) * Math.sin(yaw) * 0.5], [wp[0] - Math.cos(a) * Math.cos(yaw) * 0.5, wp[1] - Math.sin(a) * 0.5, wp[2] + Math.cos(a) * Math.sin(yaw) * 0.5], 0.028, wood, { seg: 4, cast: false }); } }
      for (const sz of [-0.5, 0.5]) pipe(B, L(1.3, 0.8, sz), L(3.0, 0.5, sz * 0.6), 0.05, wood, { seg: 5 });
      B.sphere({ p: L(0, 1.15, 0), r: 1, seg: 12, scale: [1.3, 0.45, 0.68], yaw, mat: B.m('hay', std({ color: 0x8a7a3a, roughness: 1 })), cast: true }); B.colliders.addBox({ x: cx, y: 0.6, z: cz, hx: 1.5, hy: 0.6, hz: 0.9, yaw, surface: 'wood', walk: false }); }
    // gallows with a noose and a lantern
    { const gx = -25, gz = 34.5; B.box({ p: [gx, 0, gz], s: [3.0, 0.3, 2.0], mat: wood, bevel: 0.03, col: 'wood' }); pipe(B, [gx - 1.2, 0.3, gz], [gx - 1.2, 4.6, gz], 0.13, wood, { seg: 6 }); pipe(B, [gx - 1.2, 4.5, gz], [gx + 1.5, 4.5, gz], 0.1, wood, { seg: 6 }); pipe(B, [gx - 1.2, 3.4, gz], [gx - 0.2, 4.45, gz], 0.06, wood, { seg: 5, cast: false });
      const ny = 4.5; B.cable([gx + 1.0, ny, gz], [gx + 1.0, ny - 1.55, gz], 0.0, 0.028, K.rope || iron, { n: 6, seg: 4, cast: false }); torus(B, { p: [gx + 1.0, ny - 1.7, gz], R: 0.17, r: 0.03, seg: 6, tube: 14, pitch: PI / 2, yaw: 0, mat: K.rope || iron, cast: false });
      B.colliders.addBox({ x: gx, y: 0.2, z: gz, hx: 1.5, hy: 0.2, hz: 1.0, surface: 'wood', walk: false }); B.colliders.addCyl({ x: gx - 1.2, z: gz, r: 0.18, y0: 0, y1: 4.5, surface: 'wood', walk: false }); }
    // pillory / stocks
    { const px = 7.5, pz = 37.5; for (const sx of [-1, 1]) B.box({ p: [px + sx * 0.75, 0, pz], s: [0.14, 1.5, 0.3], mat: wood, bevel: 0.02, col: 'wood' }); B.box({ p: [px, 0.95, pz], s: [1.7, 0.12, 0.28], mat: wood, bevel: 0.02, cast: false }); B.box({ p: [px, 1.15, pz], s: [1.7, 0.12, 0.28], mat: wood, bevel: 0.02, cast: false }); for (const dx of [-0.38, 0.38]) B.cyl({ p: [px + dx, 1.07, pz - 0.01], r: 0.09, h: 0.14, seg: 8, mat: K.voidM, cast: false, pitch: 0 }); }
  }

  // ---------------------------------------------------------------- ivy on the shadowed walls (alpha cards), ravens perched on ledges, tombstones and fence posts
  {
    const ivyTex = canvasTexture(256, 512, (c, w, h) => { const r = makeRng(31); c.clearRect(0, 0, w, h); c.strokeStyle = '#1e2a12'; c.lineWidth = 3; for (let k = 0; k < 4; k++) { c.beginPath(); let x = 30 + r() * (w - 60), y = h; c.moveTo(x, y); while (y > 10) { y -= 20 + r() * 20; x += (r() - 0.5) * 34; c.lineTo(x, y); } c.stroke(); }
      for (let i = 0; i < 230; i++) { const x = r() * w, y = r() * h * (0.25 + 0.75 * Math.pow(r(), 0.6)) + h * 0.2; c.save(); c.translate(x, Math.min(h - 4, y)); c.rotate((r() - 0.5) * 2.4); c.fillStyle = ['#284a1c', '#2f5a22', '#1c3a14', '#3a6a28'][Math.floor(r() * 4)]; c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(-9, -6, -7, -18, 0, -14); c.bezierCurveTo(7, -18, 9, -6, 0, 0); c.fill(); c.restore(); } }, { srgb: true, aniso: 4 });
    const ivyM = std({ map: ivyTex, roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true, key: 'ivyW', wind: { amp: 0.05, freq: 1.3, stiff: 'uv' } });
    for (const [x, y, z, w, h, yaw] of [[-9.2, 5.0, 2.32, 2.6, 5.4, 0], [12.4, 4.3, 2.3, 2.2, 4.6, 0], [-27, 4.6, 2.32, 3.2, 5.0, 0], [-14.25, 9, -14, 3.6, 8, PI / 2], [-14.25, 7, -25, 3.2, 6.5, PI / 2], [14.25, 8, -19, 3.4, 7, -PI / 2], [-6.6, 8.5, -8.75, 2.6, 8.6, 0], [30, 5, 2.3, 2.6, 4.8, 0], [-22.5, 8, -7.75, 2.8, 8.4, 0], [22.5, 7, -7.75, 2.8, 7.6, 0]]) quad(B, { p: [x, y, z], w, h, yaw, mat: ivyM });
    const rg = geo('raven', () => { const parts = []; const body = new THREE.SphereGeometry(0.11, 8, 6); body.scale(1, 0.9, 1.9); parts.push(body); const head = new THREE.SphereGeometry(0.075, 7, 5); head.translate(0, 0.09, -0.19); parts.push(head); const beak = new THREE.ConeGeometry(0.03, 0.13, 5); beak.rotateX(-PI / 2); beak.translate(0, 0.085, -0.3); parts.push(beak); const tail = new THREE.BoxGeometry(0.11, 0.015, 0.24); tail.rotateX(-0.25); tail.translate(0, -0.01, 0.34); parts.push(tail); for (const s of [-1, 1]) { const wing = new THREE.SphereGeometry(0.1, 6, 4); wing.scale(0.35, 0.7, 1.6); wing.translate(s * 0.1, 0.01, 0.06); parts.push(wing); }
      const pos = [], nor = [], uv = []; for (const p of parts) { const q = p.index ? p.toNonIndexed() : p; pos.push(...q.attributes.position.array); nor.push(...q.attributes.normal.array); uv.push(...q.attributes.uv.array); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return g; });
    const ravenM = std({ color: 0x0c0c12, roughness: 0.45, metalness: 0.15 });
    const perches = [[-9.6, 33.6, -8.5], [9.6, 33.6, -8.5], [-3, 34.55, -8.6], [-16, 34.4, -9.2], [16, 34.4, -9.2], [-9.4, 0.98, 2.4], [-30, 8.9, 2.4], [30, 8.9, 2.4], [-12.6, 3.95, 19.0], [-12.6, 3.95, 25.0], [-46.9, 1.75, 21], [-29, 4.1, 21], [-24, 0.95, 18.2], [-34, 0.9, 24.4], [-19, 0.85, 20.6], [-38, 1.0, 26.3], [-16.6, 0.9, 27.4], [3.5, 0.95, 13.6], [-3.5, 0.95, 13.6], [36, 12.5, 15.5]];
    perches.forEach(([x, y, z], i) => { const yaw = RC() * TAU; B.instance('raven', rg, ravenM, B.matrix([x, y + 0.08, z], yaw, 0.85 + RC() * 0.3), 0xffffff, { cast: false }); });
  }

  // ---------------------------------------------------------------- facade up-lighting: six ground fixtures wash the walls with green / violet light (additive beams + a few real pooled lights)
  {
    const fixtures = [[-11.4, 3.6, 0x50ff90], [-6.2, 3.6, 0xa860ff], [6.2, 3.6, 0xa860ff], [11.4, 3.6, 0x50ff90], [-25, 3.2, 0xa860ff], [25, 3.2, 0x50ff90]];
    fixtures.forEach(([x, z, col], i) => {
      B.cyl({ p: [x, 0, z], r: [0.32, 0.26], h: 0.32, seg: 10, mat: iron, cast: false }); B.cyl({ p: [x, 0.32, z], r: 0.19, h: 0.05, seg: 10, mat: col === 0x50ff90 ? K.glowG : K.glowP, cast: false });
      const bm = makeBeam({ length: 17, r0: 0.25, r1: 2.6, color: col, intensity: 0.055, dust: 1, near: 1.0 }); bm.position.set(x, 0.4, z - 0.25 + (i < 4 ? -0.4 : -1.6)); bm.lookAt(x * 0.985, 17, i < 4 ? 2.05 : -7.6); B.group.add(bm);
      halos.add([x, 0.5, z], col, 0.5, 0.35, 0);
      if (i < 4) ctx.light({ pos: [x, 2.0, z + 0.4], color: col === 0x50ff90 ? 0xb0e8c8 : 0xc8b4f8, intensity: 24, distance: 15, decay: 2, flicker: 0.05 });
    });
  }
}
