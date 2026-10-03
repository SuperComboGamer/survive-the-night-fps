// LAST FERRY — real-construction builders (round 3). Everything is built into the stop's / ferry's Builder (StaticBatch / Instancer: no extra draws, no new materials).
//   crateReal      : slatted shipping crate (150 mm planks with 8 mm gaps, corner posts, diagonal braces, lid boards). Reference: 1950s export crate, plank 18-22 mm.
//   containerReal  : ISO 20' container 6.05 x 2.44 x 2.59 m: real corrugation (76 mm pitch, 36 mm deep) extruded per wall, 8 corner castings, top/bottom rails, door leaves
//                    with 4 locking rods + cam keepers + hinge blocks + gasket lines, forklift pockets.
//   latticeLeg     : square lattice tower leg (4 chords + zig-zag diagonals + horizontal ties) for the portal crane.
//   bollardExtras / lampExtras : base plate + bolts, lamp cages, caps, braces, junction boxes.
//   hullRivets     : ~1500 round-head rivets on the ferry topsides (instanced) along frame and strake seams.
import * as THREE from 'three';
import { toRaw } from '../../core/build.js';
const P = Math.PI;
const rot = (x, z, yaw) => [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];   // local (x,z) -> world offset for three's yaw (local +x -> (cos, -sin))
const hash = (a, b, c) => { const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return v - Math.floor(v); };

export function crateReal(B, x, y, z, w, h, d, mat, o = {}) {
  const yaw = o.yaw || 0, bat = o.batten || mat;
  const put = (lx, ly, lz, sx, sy, sz, m = mat, bev = 0) => { const [ox, oz] = rot(lx, lz, yaw); B.box({ p: [x + ox, y + ly, z + oz], s: [sx, sy, sz], yaw, mat: m, bevel: bev, col: false, cast: true }); };
  B.box({ p: [x, y, z], s: [w - 0.03, h - 0.03, d - 0.03], yaw, mat, bevel: 0.008, col: o.col ?? 'wood', walk: o.walk ?? false });                  // solid core / collider
  const rows = Math.max(3, Math.round(h / 0.22)), gap = 0.01, ph = (h - 0.02 - (rows - 1) * gap) / rows;
  for (let r = 0; r < rows; r++) { const ly = 0.01 + r * (ph + gap), t = 0.016 + 0.008 * hash(x, z + r, 1);
    for (const s of [-1, 1]) { put(0, ly, s * (d / 2 - 0.002), w - 0.1 - 0.02 * hash(x, r, s), ph, t, mat); put(s * (w / 2 - 0.002), ly, 0, t, ph, d - 0.1 - 0.02 * hash(z, r, s), mat); } }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(sx * (w / 2 - 0.028), 0, sz * (d / 2 - 0.028), 0.058, h, 0.058, bat, 0.006);           // corner posts
  if (h > 0.8) for (const s of [-1, 1]) { const [a0, a1] = rot(-w / 2 + 0.06, s * (d / 2 + 0.012), yaw), [b0, b1] = rot(w / 2 - 0.06, s * (d / 2 + 0.012), yaw); B.beam([x + a0, y + 0.05, z + a1], [x + b0, y + h - 0.05, z + b1], 0.05, 0.02, { mat: bat, bevel: 0, cast: false });
    const [c0, c1] = rot(s * (w / 2 + 0.012), -d / 2 + 0.06, yaw), [e0, e1] = rot(s * (w / 2 + 0.012), d / 2 - 0.06, yaw); if (h > 0.6) B.beam([x + c0, y + 0.05, z + c1], [x + e0, y + h - 0.05, z + e1], 0.05, 0.02, { mat: bat, bevel: 0, cast: false }); }
  if (h > 0.6) for (let i = 0; i < 3; i++) put(0, h - 0.018, (i - 1) * (d / 3), w - 0.02, 0.022, d / 3 - 0.012, mat);                                    // lid boards
}

/** ISO 20' container. alongX: long axis along x. mat = painted corrugated material (also used for the panels), o.frame = casting/rail material */
const CORR = new Map();
export function containerReal(K, x, y, z, alongX, mat, o = {}) {
  const B = K.B, L = o.len ?? 6.05, W = 2.44, H = 2.59, pitch = 0.076, depth = 0.034, fm = o.frame || mat;
  const sx = alongX ? L : W, sz = alongX ? W : L;
  if (Math.hypot(x - K.st.stationLocal[0], z - K.st.stationLocal[2]) > 60) {   // far containers: a textured box + corner posts (ribs are unresolvable at 60 m; every vertex costs sky-visibility bake time)
    B.box({ p: [x, y, z], s: [sx, H, sz], mat, bevel: 0.03, col: o.col ?? 'metal', walk: o.walk ?? false, cast: true });
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) B.box({ p: [x + cx * (sx / 2 - 0.08), y, z + cz * (sz / 2 - 0.08)], s: [0.16, H + 0.02, 0.16], mat: fm, bevel: 0.01, cast: false }); return; }
  B.box({ p: [x, y + 0.06, z], s: [sx - 0.12, H - 0.12, sz - 0.12], mat: fm, bevel: 0.02, col: o.col ?? 'metal', walk: o.walk ?? false, cast: true });      // core + collider
  const wallPanel = (px, pz, yaw, len, h0, h) => { const key = `${len.toFixed(2)}|${h.toFixed(2)}`; let raw = CORR.get(key);
    if (!raw) { const n = Math.max(2, Math.round(len / 0.13)), pts = []; for (let i = 0; i < n; i++) { const u0 = -len / 2 + i * len / n, du = len / n; pts.push(new THREE.Vector2(u0, 0), new THREE.Vector2(u0 + du * 0.5, depth)); }
      pts.push(new THREE.Vector2(len / 2, 0), new THREE.Vector2(len / 2, -0.014), new THREE.Vector2(-len / 2, -0.014)); const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: h, bevelEnabled: false, curveSegments: 1 }); g.rotateX(-Math.PI / 2); g.computeVertexNormals(); raw = toRaw(g, 'box'); g.dispose(); CORR.set(key, raw); }
    B.addRaw(raw, new THREE.Matrix4().compose(new THREE.Vector3(px, y + h0, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)), mat, { cast: true }); };
  const far = Math.hypot(x - K.st.stationLocal[0], z - K.st.stationLocal[2]) > 60, h0 = 0.09, hh = H - 0.2, ex = sx / 2 - 0.005, ez = sz / 2 - 0.005;
  // side walls (long) and end walls; the panel's local +z points outward for yaw 0 (+z face), pi (-z), pi/2 (+x), -pi/2 (-x)
  const longSides = alongX ? [[0, ez, 0], [0, -ez, P]] : [[ex, 0, P / 2], [-ex, 0, -P / 2]], lenLong = L - 0.36;
  for (const [ox, oz, yw] of longSides) wallPanel(x + ox, z + oz, yw, lenLong, h0, hh);
  const ends = alongX ? [[ex, 0, P / 2, 1], [-ex, 0, -P / 2, -1]] : [[0, ez, 0, 1], [0, -ez, P, -1]];        // [offset x, offset z, yaw, sign]; sign +1 = door end
  ends.forEach(([ox, oz, yw, sg], k) => { const wlen = W - 0.36;
    if (sg > 0 && !far) { for (const s of [-1, 1]) { const lx = s * (wlen / 4 + 0.005), [dx, dz] = rot(lx, 0, yw); wallPanel(x + ox + dx, z + oz + dz, yw, wlen / 2 - 0.02, h0, hh); }
      // door hardware: 4 locking rods with cams, hinge blocks, gasket lines, handles
      for (let i = 0; i < 4; i++) { const u = (i - 1.5) * (wlen / 4.3), [dx, dz] = rot(u, 0.06, yw); B.cyl({ p: [x + ox + dx, y + 0.22, z + oz + dz], r: 0.016, h: H - 0.5, seg: 6, mat: fm, cast: false });
        for (const yy of [0.28, H - 0.34]) B.box({ p: [x + ox + dx, y + yy, z + oz + dz], s: [0.075, 0.06, 0.05], yaw: yw, mat: fm, bevel: 0.006, cast: false }); if (i === 1 || i === 2) B.box({ p: [x + ox + dx, y + 1.05, z + oz + dz], s: [0.03, 0.4, 0.06], yaw: yw, mat: fm, bevel: 0.006, cast: false }); }
      for (const s of [-1, 1]) for (const yy of [0.35, 1.25, H - 0.6]) { const [dx, dz] = rot(s * (W / 2 - 0.2), 0.045, yw); B.box({ p: [x + ox + dx, y + yy, z + oz + dz], s: [0.1, 0.16, 0.05], yaw: yw, mat: fm, bevel: 0.008, cast: false }); }
    } else wallPanel(x + ox, z + oz, yw, wlen, h0, hh); });
  // corner castings (8), top/bottom side rails (8 boxes), roof (ribbed across the width), forklift pockets
  for (const cx of [-1, 1]) for (const cz of [-1, 1]) for (const cy of [0, 1]) B.box({ p: [x + cx * (sx / 2 - 0.09), y + (cy ? H - 0.16 : 0), z + cz * (sz / 2 - 0.09)], s: [0.18, 0.16, 0.18], mat: fm, bevel: 0.015, cast: true });
  for (const cy of [0.02, H - 0.1]) for (const s of [-1, 1]) { B.box({ p: [x, y + cy, z + s * (sz / 2 - 0.05)], s: [alongX ? sx - 0.36 : 0.09, 0.09, alongX ? 0.09 : sz - 0.36], mat: fm, bevel: 0.01, cast: false }); B.box({ p: [x + s * (sx / 2 - 0.05), y + cy, z], s: [alongX ? 0.09 : sx - 0.36, 0.09, alongX ? sz - 0.36 : 0.09], mat: fm, bevel: 0.01, cast: false }); }
  B.box({ p: [x, y + H - 0.07, z], s: [sx - 0.3, 0.07, sz - 0.3], mat, bevel: 0.01, cast: true });
  for (const s of [-1, 1]) for (const t of [-1, 1]) B.box({ p: [x + (alongX ? t * 1.0 : s * (W / 2 - 0.02)), y + 0.1, z + (alongX ? s * (W / 2 - 0.02) : t * 1.0)], s: alongX ? [0.36, 0.11, 0.05] : [0.05, 0.11, 0.36], mat: fm, bevel: 0.01, cast: false });
}

/** lattice tower leg: 4 chords + zig-zag diagonals + ties. (px,pz) centre, py base, h height, w cross-section */
export function latticeLeg(B, px, py, pz, h, w, mat, o = {}) {
  const c = [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]], n = Math.max(2, Math.round(h / (o.bay ?? 0.85)));
  for (const [dx, dz] of c) B.cyl({ p: [px + dx, py, pz + dz], r: o.chord ?? 0.055, h, seg: 6, mat, cast: true });
  for (let i = 0; i < n; i++) { const y0 = py + i * h / n, y1 = py + (i + 1) * h / n; for (let s = 0; s < 4; s++) { const a = c[s], b = c[(s + 1) % 4], up = (i + s) % 2 === 0; B.beam([px + a[0], up ? y0 : y1, pz + a[1]], [px + b[0], up ? y1 : y0, pz + b[1]], 0.04, 0.04, { mat, bevel: 0, cast: false }); }
    if (i > 0) B.box({ p: [px, y0 - 0.02, pz], s: [w, 0.04, w], mat, bevel: 0, cast: false }); }
  if (!o.noCol) B.colliders.addBox({ x: px, y: py + h / 2, z: pz, hx: w / 2, hy: h / 2, hz: w / 2, surface: 'metal', walk: false });
}

export function bollardExtras(B, x, y, z, r, mat) {
  B.box({ p: [x, y, z], s: [r * 3.6, 0.03, r * 3.6], mat, bevel: 0.008, cast: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl({ p: [x + sx * r * 1.45, y + 0.03, z + sz * r * 1.45], r: 0.026, h: 0.035, seg: 6, mat, cast: false });
}

/** lamp head details. (ax,ay,az) = shade centre; y0/h/x/z = pole */
export function lampExtras(B, x, z, y0, h, ax, az, mat) {
  const top = y0 + h;
  B.cyl({ p: [ax, top - 0.13, az], r: [0.33, 0.31], h: 0.035, seg: 12, mat, cast: false });                                                    // shade lip
  B.sphere({ p: [ax, top + 0.06, az], r: 0.05, mat, seg: 6, cast: false }); B.cyl({ p: [ax, top + 0.02, az], r: 0.03, h: 0.07, seg: 6, mat, cast: false });   // cap + finial
  for (let i = 0; i < 6; i++) { const a = i * P / 3; B.cyl({ p: [ax + Math.cos(a) * 0.15, top - 0.36, az + Math.sin(a) * 0.15], r: 0.007, h: 0.24, seg: 4, mat, cast: false }); }     // guard cage rods
  B.tube({ pts: Array.from({ length: 10 }, (_, i) => [ax + Math.cos(i / 10 * P * 2) * 0.15, top - 0.36, az + Math.sin(i / 10 * P * 2) * 0.15]), r: 0.008, mat, seg: 4, segs: 20, closed: true, cast: false });
  B.beam([x, y0 + h - 1.1, z], [(x + ax) / 2, y0 + h - 0.28, (z + az) / 2], 0.045, 0.045, { mat, bevel: 0, cast: false });                     // arm brace
  B.box({ p: [x + 0.13, y0 + 1.45, z], s: [0.1, 0.26, 0.16], mat, bevel: 0.01, cast: false });                                                  // junction box
  for (const yy of [0.35, 0.42, y0 + h * 0.5 - y0]) B.cyl({ p: [x, y0 + yy, z], r: 0.15, h: 0.03, seg: 10, mat, cast: false });                 // collar rings
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl({ p: [x + sx * 0.14, y0 + 0.35, z + sz * 0.14], r: 0.02, h: 0.03, seg: 6, mat, cast: false });
}

/** round-head rivets on the topsides: horizontal strake seams + vertical frame seams, both sides. hull = {halfWidth, keelY, sectionF} from ferryPhys */
export function hullRivets(B, mat, hull, opt = {}) {
  const geo = new THREE.IcosahedronGeometry(0.017, 0); let n = 0;
  const skip = (sd, z, y) => (Math.abs(y + 0.38) < 0.17 && Math.abs(z - (Math.round((z + 9.6) / 1.9) * 1.9 - 9.6)) < 0.18) || (z < -6.4 && z > -10.4 && y > -1.05 && y < -0.5) || (sd === 1 && z > (opt.rampZ0 ?? 0.2) - 0.5 && z < (opt.rampZ1 ?? 2.8) + 0.5 && y > -0.35);
  const put = (sd, z, u) => { const W = hull.halfWidth(z), K = hull.keelY(z), y = K + u * (0 - K); if (y > -0.12 || skip(sd, z, y)) return; B.instance('rivet', geo, mat, new THREE.Matrix4().makeTranslation(sd * (W * hull.sectionF(u) + 0.007), y, z), 0xffffff, { cast: false }); n++; };
  for (const sd of [-1, 1]) {
    for (const u of [0.6, 0.72, 0.84, 0.94]) for (let z = -13.3; z <= 13.5; z += 0.15) put(sd, z, u);
    for (let zf = -12.6; zf <= 13; zf += 1.4) for (let u = 0.55; u <= 0.98; u += 0.06) { put(sd, zf - 0.05, u); put(sd, zf + 0.05, u); }
  }
  return n;
}

/** corrugated iron underside: 76 mm pitch / 34 mm deep ribs running down the slope, hung just below a flat roof slab (visible from below). slope = dy/dz (+ = high at +z) */
export function ribbedUnder(B, mat, cx, cz, L, D, y, slope, o = {}) {
  const pitch = o.pitch ?? 0.076, depth = o.depth ?? 0.034, n = Math.round(L / pitch), x0 = cx - L / 2, z0 = cz - D / 2, z1 = cz + D / 2, prof = [[0, 0], [0.22, -depth], [0.5, -depth], [0.72, 0]];
  const P = [], U = [], I = []; const add = (x, h) => { const a = P.length / 3; P.push(x, y + (z0 - cz) * slope + h, z0, x, y + (z1 - cz) * slope + h, z1); U.push(x, 0, x, D); return a; };
  const idx = []; for (let i = 0; i < n; i++) for (const [f, h] of prof) idx.push(add(x0 + (i + f) * pitch, h)); idx.push(add(x0 + n * pitch, 0));
  for (let k = 0; k < idx.length - 1; k++) { const a = idx[k], b = idx[k + 1]; I.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
  const N = g.attributes.normal.array, ind = g.index.array; let s = 0; for (let k = 1; k < N.length; k += 3 * 7) s += N[k]; if (s > 0) { for (let k = 0; k < N.length; k++) N[k] *= -1; for (let k = 0; k < ind.length; k += 3) { const t = ind[k + 1]; ind[k + 1] = ind[k + 2]; ind[k + 2] = t; } }
  B.addRaw({ p: new Float32Array(g.attributes.position.array), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(ind) }, new THREE.Matrix4(), mat, { cast: true });
}
