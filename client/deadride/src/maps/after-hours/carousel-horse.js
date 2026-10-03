// AFTER HOURS — a real carousel horse (Dentzel / Herschell style, ~1.7 m nose to tail): barrel + chest + rump, arched neck and head lofted along a spine, ears, flowing mane, tail,
// galloping legs with hooves, saddle with cantle and pommel, stirrups, bridle rings. Local frame: faces +x, y up, origin = body centre, hooves at y ~ -0.85.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = THREE.Vector3;
/** loft an elliptical tube along a 2D spine [[x,y]..] (x-y plane); ry = radius in-plane, rz = radius along z; returns a non-indexed geometry with normals */
function spineLoft(pts, ry, rz, sides = 8, steps = 8) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new V(x, y, 0))), P = [], I = [], rings = [];
  for (let i = 0; i <= steps; i++) { const t = i / steps, c = curve.getPoint(t), tg = curve.getTangent(t), nrm = new V(-tg.y, tg.x, 0).normalize(), f = t * (ry.length - 1), k = Math.min(ry.length - 2, Math.floor(f)), u = f - k, a = ry[k] + (ry[k + 1] - ry[k]) * u, b = rz[k] + (rz[k + 1] - rz[k]) * u, ring = [];
    for (let j = 0; j < sides; j++) { const th = j / sides * Math.PI * 2; ring.push(new V().copy(c).addScaledVector(nrm, Math.cos(th) * a).addScaledVector(new V(0, 0, 1), Math.sin(th) * b)); } rings.push(ring); }
  for (const r of rings) for (const p of r) P.push(p.x, p.y, p.z);
  for (let i = 0; i < steps; i++) for (let j = 0; j < sides; j++) { const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides; I.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g.toNonIndexed();
}
const limb = (a, b, r0, r1, seg = 5) => { const A = new V(...a), Bv = new V(...b), d = new V().subVectors(Bv, A), L = d.length(), g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, false); g.translate(0, L / 2, 0); const q = new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize()); g.applyQuaternion(q); g.translate(A.x, A.y, A.z); return g; };
const ell = (r, sx, sy, sz, x, y, z, ws = 12, hs = 9) => { const g = new THREE.SphereGeometry(r, ws, hs); g.scale(sx, sy, sz); g.translate(x, y, z); return g; };

export function horseGeometry() {
  const parts = [];
  parts.push(ell(0.42, 1.5, 0.78, 0.66, 0, 0, 0, 12, 8), ell(0.34, 1.0, 1.18, 0.98, 0.5, 0.06, 0, 8, 6), ell(0.36, 1.0, 1.12, 1.0, -0.5, 0.07, 0, 8, 6));   // barrel, chest, rump
  parts.push(spineLoft([[0.5, 0.2], [0.66, 0.45], [0.8, 0.72], [0.9, 0.95]], [0.23, 0.2, 0.16, 0.13], [0.18, 0.15, 0.12, 0.1], 7, 5));                         // arched neck
  parts.push(spineLoft([[0.9, 0.95], [1.06, 0.86], [1.2, 0.74], [1.33, 0.66]], [0.14, 0.12, 0.085, 0.066], [0.1, 0.095, 0.07, 0.056], 7, 4));                 // head
  for (const sz of [-1, 1]) { const e = new THREE.ConeGeometry(0.035, 0.13, 4); e.rotateZ(-0.35); e.translate(0.89, 1.08, sz * 0.065); parts.push(e); parts.push(ell(0.022, 1, 1, 0.6, 1.09, 0.88, sz * 0.09, 4, 3)); parts.push(ell(0.028, 1, 0.7, 0.7, 1.335, 0.64, sz * 0.03, 4, 3)); }   // ears, eyes, nostrils
  for (let i = 0; i < 6; i++) { const t = i / 5, x = 0.55 + t * 0.36, y = 0.42 + t * 0.6, m = new THREE.ConeGeometry(0.05, 0.3 - t * 0.07, 3); m.scale(0.6, 1, 2.2); m.rotateZ(0.9 + t * 0.2 + Math.sin(i * 2.1) * 0.12); m.translate(x - 0.05, y + 0.05, Math.sin(i * 1.7) * 0.03); parts.push(m); }   // mane locks
  parts.push(spineLoft([[-0.82, 0.18], [-1.02, 0.12], [-1.18, -0.1], [-1.24, -0.5]], [0.08, 0.12, 0.1, 0.03], [0.07, 0.1, 0.09, 0.03], 5, 4));                 // tail
  const sad = new THREE.BoxGeometry(0.5, 0.06, 0.4); sad.translate(0.05, 0.38, 0); parts.push(sad); const can = new THREE.BoxGeometry(0.07, 0.17, 0.4); can.rotateZ(0.25); can.translate(-0.24, 0.47, 0); parts.push(can); parts.push(ell(0.06, 1, 1.2, 1.4, 0.3, 0.44, 0, 5, 4));   // saddle, cantle, pommel
  for (const sz of [-1, 1]) { const t = new THREE.TorusGeometry(0.06, 0.009, 3, 8); t.translate(0.08, -0.18, sz * 0.36); parts.push(t); parts.push(limb([0.08, 0.34, sz * 0.32], [0.08, -0.12, sz * 0.36], 0.012, 0.012, 4)); }   // stirrups + leathers
  for (const [rx, rz, front] of [[0.5, 0.18, 1], [0.5, -0.18, 1], [-0.5, 0.18, 0], [-0.5, -0.18, 0]]) {
    const top = [rx, -0.18, rz], knee = front ? [rx + 0.34, -0.3, rz] : [rx - 0.16, -0.38, rz], fet = front ? [rx + 0.5, -0.66, rz] : [rx - 0.1, -0.74, rz], hoof = front ? [rx + 0.55, -0.83, rz] : [rx - 0.06, -0.9, rz];
    parts.push(limb(top, knee, 0.12, 0.075, 6), limb(knee, fet, 0.07, 0.05, 5)); parts.push(ell(0.06, 1, 0.9, 1, knee[0], knee[1], knee[2], 5, 3)); const h = limb(fet, hoof, 0.052, 0.062, 5); parts.push(h); }   // legs: upper, lower, knee, hoof
  const br = new THREE.TorusGeometry(0.072, 0.008, 3, 8); br.rotateY(Math.PI / 2); br.rotateZ(-0.5); br.translate(1.24, 0.71, 0); parts.push(br); for (const sz of [-1, 1]) parts.push(limb([1.24, 0.71, sz * 0.055], [0.97, 0.86, sz * 0.1], 0.006, 0.006, 3), limb([0.97, 0.86, sz * 0.1], [0.9, 1.0, sz * 0.09], 0.006, 0.006, 3));   // bridle
  const g = mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k); if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); return q; }));
  g.scale(1.12, 1.12, 1.12); return g;
}
