// FISH-MARKET WHARF props: covered market stalls, fish (instanced), drying racks with nets, the rusty trawler, gulls (instanced, flapping).
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { toRaw } from '../../core/build.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { makeBoat } from './boats.js';
import { getSea } from './shared.js';

const P = Math.PI;

/** fish geometry (ellipsoid body + tail + fin) — one merged buffer geometry, instanced with colour. Length ~0.42 along +x. */
export function fishGeo() {
  const body = new THREE.SphereGeometry(0.5, 10, 7); body.scale(0.42, 0.11, 0.1); const tail = new THREE.ConeGeometry(0.11, 0.2, 4); tail.rotateZ(P / 2); tail.scale(1, 1, 0.3); tail.translate(-0.24, 0, 0);
  const fin = new THREE.BoxGeometry(0.16, 0.09, 0.008); fin.translate(0.02, 0.1, 0); const head = new THREE.SphereGeometry(0.5, 8, 6); head.scale(0.1, 0.09, 0.085); head.translate(0.18, 0.005, 0);
  const g = mergeGeometries([body, tail, fin, head].map((x) => { x.deleteAttribute('uv'); return x.toNonIndexed(); })); g.computeVertexNormals(); const n = g.attributes.position.count; g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); return g;
}
export function gullGeo() {
  const body = new THREE.SphereGeometry(0.5, 8, 6); body.scale(0.34, 0.12, 0.11); const head = new THREE.SphereGeometry(0.5, 6, 5); head.scale(0.09, 0.09, 0.08); head.translate(0.2, 0.05, 0);
  const wing = new THREE.BoxGeometry(0.16, 0.012, 0.5, 1, 1, 6); const wp = wing.attributes.position; for (let i = 0; i < wp.count; i++) { const z = wp.getZ(i); wp.setX(i, wp.getX(i) - Math.abs(z) * 0.32); }
  const beak = new THREE.ConeGeometry(0.02, 0.08, 4); beak.rotateZ(-P / 2); beak.translate(0.29, 0.045, 0); const tail = new THREE.BoxGeometry(0.16, 0.01, 0.13); tail.translate(-0.27, 0.01, 0);
  const g = mergeGeometries([body, head, wing, beak, tail].map((x) => { x.deleteAttribute('uv'); return x.toNonIndexed(); })); g.computeVertexNormals(); const n = g.attributes.position.count; g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); return g;
}

/** striped canvas awning material (2 colours), UV in metres (stripe width 0.24 m) */
export function stripeMat(c1, c2, key) {
  const tex = canvasTexture(128, 128, (c, w, h) => { for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? c2 : c1; c.fillRect(i * 32, 0, 32, h); } const r = Math.random; c.globalAlpha = 0.25; for (let i = 0; i < 90; i++) { c.fillStyle = r() < 0.5 ? '#000' : '#fff'; c.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 5); } c.globalAlpha = 1; }, { repeat: true });
  tex.repeat.set(1 / 0.96, 1 / 0.96); return std({ map: tex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, key });
}

/** market stall: timber posts + iron/tile roof + striped awning + counter + ice + fish + lamps + neon icon. Front faces `face` ('e'|'w'|'n'|'s'). o.pal: {wood, roof, awn, crate, neon:'#hex', text} */
export function stall(K, M, o) {
  const B = K.B, { x, z, w = 5, d = 3.4, face = 'e', y = 1.35, pal } = o; const sx = face === 'e' ? 1 : face === 'w' ? -1 : 0, sz = face === 's' ? 1 : face === 'n' ? -1 : 0; const alongX = sz !== 0;
  const W = alongX ? w : d, D = alongX ? d : w; // footprint in x,z
  const P_ = (u, v, h) => [x + (alongX ? u : v * sx), y + h, z + (alongX ? v * sz : u)];  // u along the front, v toward the front (+ = out)
  const box = (u0, u1, v0, v1, h0, h1, mat, bevel = 0.02, col = false) => { const a = P_((u0 + u1) / 2, (v0 + v1) / 2, h0); B.box({ p: a, s: alongX ? [Math.abs(u1 - u0), h1 - h0, Math.abs(v1 - v0)] : [Math.abs(v1 - v0), h1 - h0, Math.abs(u1 - u0)], mat, bevel, col, cast: true, walk: false }); };
  // corner posts
  for (const u of [-w / 2 + 0.06, w / 2 - 0.06]) for (const v of [-d / 2 + 0.06, d / 2 - 0.06]) box(u - 0.06, u + 0.06, v - 0.06, v + 0.06, 0, 3.0, pal.wood, 0.01);
  // back wall (boards) + side rails
  box(-w / 2, w / 2, -d / 2, -d / 2 + 0.08, 0, 2.6, pal.wood, 0.01, 'wood'); for (const u of [-w / 2, w / 2 - 0.08]) box(u, u + 0.08, -d / 2, d / 2, 0, 1.05, pal.wood, 0.01);
  // roof (sloping corrugated) + front beam + awning (striped, hangs over the front)
  const a = P_(0, 0, 3.05); B.box({ p: a, s: alongX ? [w + 0.4, 0.07, d + 0.5] : [d + 0.5, 0.07, w + 0.4], mat: pal.roof, bevel: 0, col: false, cast: true, pitch: alongX ? -sz * 0.09 : 0, roll: alongX ? 0 : sx * 0.09 });
  { const b = P_(0, d / 2 + 0.55, 2.62); B.box({ p: b, s: alongX ? [w + 0.3, 0.05, 1.4] : [1.4, 0.05, w + 0.3], mat: pal.awn, bevel: 0, col: false, cast: true, pitch: alongX ? sz * 0.5 : 0, roll: alongX ? 0 : -sx * 0.5 }); }
  box(-w / 2 - 0.1, w / 2 + 0.1, d / 2 - 0.05, d / 2 + 0.05, 2.9, 3.0, pal.wood, 0.01);
  // counter (tiled/marble top on a painted base) with an ice bed and a stainless tray
  box(-w / 2 + 0.3, w / 2 - 0.3, d / 2 - 1.05, d / 2 - 0.25, 0, 0.9, pal.wood, 0.02, 'wood'); box(-w / 2 + 0.25, w / 2 - 0.25, d / 2 - 1.1, d / 2 - 0.2, 0.9, 0.96, M.marble, 0.01);
  box(-w / 2 + 0.55, w / 2 - 0.55, d / 2 - 0.95, d / 2 - 0.4, 0.96, 1.02, M.ice, 0.02);
  // display shelf at the back with crates (blue/white/orange) and fish boxes
  box(-w / 2 + 0.2, w / 2 - 0.2, -d / 2 + 0.1, -d / 2 + 0.6, 0.9, 0.96, M.steel, 0.01, 'metal'); const cols = [M.crateBlue, M.crateWhite, M.crateOrange]; let ci = 0;
  for (let u = -w / 2 + 0.55; u < w / 2 - 0.4; u += 0.62) { box(u - 0.28, u + 0.28, -d / 2 + 0.12, -d / 2 + 0.52, 0.96, 1.2, cols[(ci++) % 3], 0.03); }
  // hanging scale + bulbs + neon
  { const b = P_(w * 0.28, d / 2 - 0.15, 2.55); B.cyl({ p: [b[0], b[1] - 0.05, b[2]], r: 0.012, h: 0.6, seg: 4, mat: M.steel, cast: false }); B.cyl({ p: [b[0], b[1] - 0.72, b[2]], r: 0.12, h: 0.03, seg: 10, mat: M.steel, cast: false, pitch: P / 2, anchor: 'center' }); }
  for (let i = -1; i <= 1; i++) { const b = P_(i * w * 0.32, d / 2 - 0.2, 2.72); B.sphere({ p: b, r: 0.06, mat: M.bulb, seg: 6, cast: false }); K.glare([b[0], b[1] - 0.02, b[2]], 0xffcf8a, 0.16, 0.9, { refl: 1.2, mist: 0.9 }); }
  if (o.light) { const b = P_(0, d / 2 - 0.4, 2.5); K.lamp([b[0], b[1], b[2]], { color: 0xffc880, cd: 16, dist: 12, size: 0.2, k: 0, refl: 1.5, mist: 0 }); }
  if (o.sign) { const b = P_(0, d / 2 + 0.05, 3.55); K.neon(o.sign.lines, [b[0], b[1], b[2] - 0.0 + (alongX ? 0 : 0)], alongX ? [w * 0.85, 0.8, 0.05] : [0.05, 0.8, w * 0.85], { colors: [pal.neon], glow: 4.2, w: 512, face: alongX ? 'z' : 'x' }); K.glare([b[0] + sx * 0.4, b[1] + 0.4, b[2] + sz * 0.4], parseInt(pal.neon.slice(1), 16), 1.0, 0.55, { refl: 3, mist: 1.4 }); }
  // collider: counter + back wall as one solid block (walk false)
  const c0 = P_(0, 0, 0); B.colliders.addBox({ x: c0[0], y: y + 1.0, z: c0[2], hx: alongX ? w / 2 : d / 2 - 0.2, hy: 1.0, hz: alongX ? d / 2 - 0.2 : w / 2, surface: 'wood', walk: false });
  return { P_ };
}

/** the rusty trawler (hero boat). Returns boat (group child of stop group). */
export function trawler(ctx, K, M, x, z) {
  const boat = makeBoat(ctx, { L: 26, HB: 3.3, free: 1.75, draft: 2.5, bow: 0.85, stern: 0.72, flare: 0.1, bulwark: 1.05, sheer: 0.7, keelRise: 1.1, seed: 21, mats: { top: M.trawlHull, bottom: M.trawlBottom, deck: M.trawlDeck, cabin: M.trawlCabin, trim: M.trawlTrim, lit: M.litDim, dark: M.dark, trawlHull: M.trawlHull, trawlTrim: M.trawlTrim, net: M.net, nameBoard: M.nameBoard, rope: M.rope, bulb: M.bulb } }, ({ B, halos, W, M: MM, zAt }) => {
    // forecastle deck (raised), wheelhouse, mast, funnel, aft gantry (A-frame), net drum, trawl doors, nets, fish boxes, lamps
    const fc = []; for (let i = 0; i <= 8; i++) { const zz = -13 + i * (7 / 8); fc.push([W((zz + 13) / 26) - 0.12, zz]); } for (let i = 8; i >= 0; i--) { const zz = -13 + i * (7 / 8); fc.push([-(W((zz + 13) / 26) - 0.12), zz]); }
    B.extrude({ p: [0, 0, 0], poly: fc, h: 0.95, mat: MM.deck, col: false, bevel: 0 }); B.box({ p: [0, 0.95, -5.6], s: [5.6, 0.12, 0.2], mat: MM.trim, bevel: 0.01, cast: false });
    const wh = { z0: -9.6, z1: -5.4, w: 3.9, y: 0.95, h: 2.7 }; B.box({ p: [0, wh.y, (wh.z0 + wh.z1) / 2], s: [wh.w, wh.h, wh.z1 - wh.z0], mat: MM.cabin, bevel: 0.06, cast: true }); B.box({ p: [0, wh.y + wh.h, (wh.z0 + wh.z1) / 2 - 0.1], s: [wh.w + 0.5, 0.12, wh.z1 - wh.z0 + 0.5], mat: MM.trim, bevel: 0.02, cast: true });
    for (const sd of [-1, 1]) B.box({ p: [sd * (wh.w / 2 + 0.02), wh.y + 1.35, (wh.z0 + wh.z1) / 2], s: [0.03, 0.75, wh.z1 - wh.z0 - 0.5], mat: MM.lit, bevel: 0, cast: false }); B.box({ p: [0, wh.y + 1.35, wh.z0 - 0.02], s: [wh.w - 0.4, 0.85, 0.03], mat: MM.lit, bevel: 0, cast: false });
    B.box({ p: [0, wh.y + wh.h + 0.12, -8.2], s: [1.6, 0.9, 1.6], mat: MM.cabin, bevel: 0.04, cast: true }); B.cyl({ p: [0, wh.y + wh.h + 1.0, -8.2], r: 0.06, h: 3.3, seg: 6, mat: MM.trim, cast: true });
    B.tube({ pts: [[-1.3, wh.y + wh.h + 0.2, -8.2], [-1.3, wh.y + wh.h + 2.6, -8.2], [1.3, wh.y + wh.h + 2.6, -8.2], [1.3, wh.y + wh.h + 0.2, -8.2]], r: 0.05, mat: MM.trim, seg: 5, segs: 12, cast: false });
    B.box({ p: [0.7, wh.y + wh.h + 4.2, -8.2], s: [1.1, 0.06, 0.05], mat: MM.trim, bevel: 0, cast: false }); halos.add([0, wh.y + wh.h + 4.35, -8.2], 0xffffff, 0.3, 1.0, 0, { mist: 0.8 });
    // funnel (rust-red with black band)
    B.cyl({ p: [0, 0.95, -3.9], r: [0.75, 0.6], h: 3.2, seg: 12, mat: MM.trawlHull, cast: true }); B.cyl({ p: [0, 4.05, -3.9], r: 0.6, h: 0.5, seg: 12, mat: M.black, cast: false });
    // aft: A-frame gantry with blocks, net drum, trawl doors, nets, fish boxes
    for (const sd of [-1, 1]) { B.beam([sd * 2.9, 0.0, 10.2], [sd * 0.8, 7.2, 8.6], 0.2, 0.26, { mat: MM.trawlHull, bevel: 0, cast: true }); B.beam([sd * 2.9, 0.0, 6.0], [sd * 0.8, 7.2, 8.6], 0.16, 0.2, { mat: MM.trawlHull, bevel: 0, cast: true }); }
    B.beam([-0.9, 7.2, 8.6], [0.9, 7.2, 8.6], 0.26, 0.26, { mat: MM.trawlHull, bevel: 0, cast: true }); for (const sd of [-1, 1]) B.cyl({ p: [sd * 0.5, 6.95, 8.6], r: 0.25, h: 0.12, seg: 10, mat: M.black, roll: P / 2, anchor: 'center', cast: false });
    for (const sd of [-1, 1]) { B.box({ p: [sd * 2.55, 0.05, 5.1], s: [0.12, 2.3, 1.6], mat: MM.trawlHull, yaw: 0, bevel: 0.02, cast: true }); B.tube({ pts: [[sd * 0.5, 6.8, 8.6], [sd * 1.6, 4.5, 7.0], [sd * 2.55, 2.4, 5.4]], r: 0.03, mat: MM.rope, seg: 4, segs: 10, cast: false }); }
    B.cyl({ p: [0, 0.5, 1.6], r: 0.9, h: 2.4, seg: 14, mat: MM.trawlTrim, roll: P / 2, anchor: 'center', cast: true }); for (const sx of [-1, 1]) B.cyl({ p: [sx * 1.25, 0.5, 1.6], r: 1.25, h: 0.12, seg: 16, mat: MM.trawlHull, roll: P / 2, anchor: 'center', cast: true }); B.box({ p: [0, 0.5, 1.6], s: [2.2, 1.7, 0.02], mat: MM.net, bevel: 0, cast: false });
    B.box({ p: [0, 0, 5.6], s: [3.4, 0.6, 2.4], mat: MM.net, bevel: 0.25, cast: true }); B.box({ p: [0.3, 0.55, 4.4], s: [2.6, 0.4, 1.6], mat: MM.net, bevel: 0.2, cast: true });
    for (let i = 0; i < 8; i++) B.box({ p: [-2.2 + (i % 4) * 0.75, 0, 11.3 - Math.floor(i / 4) * 0.55], s: [0.7, 0.36, 0.5], mat: [M.crateBlue, M.crateWhite, M.crateOrange][i % 3], bevel: 0.03, cast: false });
    // deck lamps (cool white work lights) + nav lights
    for (const [lx, ly, lz, col] of [[0, 3.3, -3.0, 0xdff8ff], [0, 6.3, 8.6, 0xdff8ff], [2.5, 2.2, 3.0, 0xdff8ff], [-2.5, 2.2, 3.0, 0xdff8ff]]) { B.sphere({ p: [lx, ly, lz], r: 0.09, mat: MM.bulb, seg: 6, cast: false }); halos.add([lx, ly, lz], col, 0.3, 1.0, 0, { mist: 1.2 }); }
    halos.add([-3.1, 2.4, -6.6], 0xff2010, 0.18, 1.1, 0, { mist: 0.8 }); halos.add([3.1, 2.4, -6.6], 0x20ff50, 0.18, 1.1, 0, { mist: 0.8 });
    // tyre fenders along the port side (facing the quay) + name boards
    for (const zz of [-8, -3, 2, 7, 11]) { const pts = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * P * 2; pts.push([(W((zz + 13) / 26) + 0.12), -0.6 + Math.sin(a) * 0.36, zz + Math.cos(a) * 0.36]); } B.tube({ pts, r: 0.13, mat: M.tyre, seg: 6, segs: 16, closed: true, cast: false }); }
    for (const sd of [-1, 1]) B.box({ p: [sd * 3.0, -0.8, -6.5], s: [0.03, 0.5, 4.2], mat: MM.nameBoard, bevel: 0, cast: false });
  });
  boat.setBase(x, z, 0); return boat;
}

/** flying + perched gulls (one InstancedMesh, flap in the vertex shader). Call update(t) each frame. */
export function makeGulls(B, n, opts = {}) {
  const geo = gullGeo(); const mat = std({ color: 0xc8ccd0, roughness: 0.85, metalness: 0, key: 'gull', vertex: `{ float ph = instanceColor.r * 6.2831; float fl = instanceColor.g; transformed.y += sin(uTime * 8.0 + ph) * abs(transformed.z) * 1.9 * fl; }` });
  const im = new THREE.InstancedMesh(geo, mat, n); const col = new THREE.Color(); const gulls = []; const rng = opts.rng || Math.random;
  for (let i = 0; i < n; i++) { const perched = i < (opts.perched ?? 0); const g = { perched, cx: opts.cx + (rng() - 0.5) * (opts.rx ?? 60), cz: opts.cz + (rng() - 0.5) * (opts.rz ?? 60), r: 8 + rng() * 22, h: 8 + rng() * 14, w: (0.15 + rng() * 0.2) * (rng() < 0.5 ? 1 : -1), ph: rng() * 6.28, y: 0, yaw: rng() * 6.28, px: 0, pz: 0 }; if (perched && opts.spots) { const s = opts.spots[i % opts.spots.length]; g.px = s[0]; g.py = s[1]; g.pz = s[2]; g.yaw = rng() * 6.28; } gulls.push(g); col.setRGB((g.ph / 6.28), perched ? 0 : 1, 0); im.setColorAt(i, col); }
  im.frustumCulled = false; im.castShadow = false; B.group.add(im); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  return { mesh: im, update(t) { for (let i = 0; i < gulls.length; i++) { const g = gulls[i]; if (g.perched) { p.set(g.px, g.py, g.pz); e.set(0, g.yaw, 0); } else { const a = g.ph + t * g.w; p.set(g.cx + Math.cos(a) * g.r, g.h + Math.sin(t * 0.7 + g.ph) * 1.2, g.cz + Math.sin(a) * g.r * 0.7); e.set(0.0, -a - Math.sign(g.w) * P / 2, Math.sign(g.w) * -0.35); } q.setFromEuler(e); s.setScalar(perched(g) ? 1 : 1.1); m.compose(p, q, s); im.setMatrixAt(i, m); } im.instanceMatrix.needsUpdate = true; } };
  function perched(g) { return g.perched; }
}
