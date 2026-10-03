// Wind-driven cloth: flags, pennants, hazard tape. The geometry is baked into the batch like everything else; the flutter is a vertex shader
// (uv.x = distance from the hoist 0..1) driven by the atmosphere wind, so every flag streams downwind and snaps in the gusts without any CPU work.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';

const FLAP = /* glsl */`
{ float L = uv.x; vec2 wd = length(uWind.xz) > 0.05 ? normalize(uWind.xz) : vec2(0.35, 0.94); vec2 pp = vec2(-wd.y, wd.x); float ws = length(uWind.xz);
  float k = L * L * (0.55 + 0.045 * ws); float ph = uTime * (7.0 + ws * 0.42) - L * 8.0 + position.x * 0.31 + position.z * 0.27;
  float gust = 0.75 + 0.25 * sin(uTime * 0.9 + position.x * 0.2);
  transformed.xz += pp * sin(ph) * 0.2 * k * gust; transformed.xz += wd * (0.5 + 0.5 * sin(ph * 0.5)) * 0.04 * k;
  transformed.y += cos(ph * 1.27 + uv.y * 3.0) * 0.07 * k * gust; }`;

/** cloth material. o: {color, map, emissive, side...} */
export function clothMaterial(B, name, o = {}) {
  return B.m(name, std({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, vertex: FLAP, ...o }));
}
export function stripedTexture(cols, { w = 128, h = 64, n = 6, angle = 0.0, worn = 0.4 } = {}) {
  return canvasTexture(w, h, (c) => { for (let i = 0; i < n; i++) { c.fillStyle = cols[i % cols.length]; if (angle) { c.save(); c.translate(0, 0); c.beginPath(); const s = w / n; c.moveTo(i * s, 0); c.lineTo(i * s + s, 0); c.lineTo(i * s + s - h * angle, h); c.lineTo(i * s - h * angle, h); c.fill(); c.restore(); } else c.fillRect(i * w / n, 0, w / n + 1, h); }
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(20,20,20,${Math.random() * worn * 0.35})`; c.fillRect(Math.random() * w, Math.random() * h, Math.random() * 12 + 1, 1); } });
}
/** A flag / tape / pennant from hoist point p (world/stop-local), streaming along direction angle `ang` (radians in the xz plane, atan2(z,x)); len x hgt m, hanging from p */
export function addFlag(B, mat, p, ang, len, hgt, { segs = 10, rows = 2, tail = 0 } = {}) {
  const P = [], N = [], U = [], I = []; const ax = Math.cos(ang), az = Math.sin(ang);
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= segs; i++) {
    const L = i / segs, v = j / rows; const h = hgt * (1 - tail * L);                 // tail > 0: pennant tapering to a point
    P.push(p[0] + ax * len * L, p[1] - h * v - (tail ? 0 : 0), p[2] + az * len * L); N.push(-az, 0, ax); U.push(L, v);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < segs; i++) { const a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1; I.push(a, c, b, b, c, d); }
  B.addRaw({ p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) }, new THREE.Matrix4(), mat, { cast: false, recv: false });
}
/** a pole with a flag at the top */
export function flagPole(B, M, mat, x, y, z, h, ang, { len = 1.5, hgt = 0.9, tail = 0 } = {}) {
  B.cyl({ p: [x, y, z], r: [0.055, 0.035], h, seg: 8, mat: M.steel, col: false }); B.cyl({ p: [x, y + h, z], r: 0.05, h: 0.06, seg: 8, mat: M.steel, col: false, cast: false });
  addFlag(B, mat, [x, y + h - 0.08, z], ang, len, hgt, { tail });
}
