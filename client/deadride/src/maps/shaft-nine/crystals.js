// Crystal generator for the Crystal Cavern: faceted hexagonal prisms with pointed terminations (per-face normals), clusters that radiate from a
// base, and a refractive-looking fresnel material (dark glassy body, facet-dependent inner glow, striations, bright rims).
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { makeRng, TAU } from '../../core/util.js';

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);

/** one hex crystal raw geometry (base at y=0, points +y). r = base radius, h = body length, tip = termination height factor (x r) */
export function hexCrystalRaw(r, h, seed = 1, { sides = 6, tip = 1.5, taper = 0.9, jitter = 0.07 } = {}) {
  const rnd = makeRng(seed * 131 + 7); const P = [], N = [], U = [], I = [];
  const a0 = rnd() * TAU; const bands = Math.max(3, Math.min(12, Math.round(h / (0.2 + r * 0.9)))); const rings = []; const base = [], tp = [];
  for (let i = 0; i < sides; i++) { const a = a0 + i * TAU / sides + (rnd() - 0.5) * 0.12; base.push([a, 1 + (rnd() - 0.5) * 2 * jitter, 1 + (rnd() - 0.5) * 2 * jitter]); }
  let step = 0; for (let j = 0; j <= bands; j++) { const t = j / bands; step += (rnd() - 0.5) * 0.05; const s = r * (1 + (taper - 1) * t) * (1 + step * 0.5), ring = []; const drift = (rnd() - 0.5) * 0.004; for (let i = 0; i < sides; i++) { const b = base[i], rr = s * (b[1] + (b[2] - b[1]) * t) * (1 + (rnd() - 0.5) * 0.012); ring.push([Math.cos(b[0]) * rr + drift, h * t, Math.sin(b[0]) * rr]); } rings.push(ring); }
  const topR = rings[bands], shoulder = topR.map((q) => [q[0] * 0.66, h + r * tip * 0.34, q[2] * 0.66]), apex = [(rnd() - 0.5) * r * 0.3, h + r * tip * (0.9 + rnd() * 0.25), (rnd() - 0.5) * r * 0.3];
  const tri = (a, b, c, uv) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; const b0 = P.length / 3; for (const q of [a, b, c]) { P.push(q[0], q[1], q[2]); N.push(nx, ny, nz); } U.push(...uv); I.push(b0, b0 + 1, b0 + 2); };
  for (let i = 0; i < sides; i++) {
    const k = (i + 1) % sides; for (let j = 0; j < bands; j++) { const a = rings[j][i], b = rings[j][k], c = rings[j + 1][k], d = rings[j + 1][i], w = Math.hypot(b[0] - a[0], b[2] - a[2]), y0 = a[1], y1 = c[1]; tri(a, b, c, [0, y0, w, y0, w, y1]); tri(a, c, d, [0, y0, w, y1, 0, y1]); }
    const tA = topR[i], tB = topR[k], sA = shoulder[i], sB = shoulder[k], w2 = Math.hypot(tB[0] - tA[0], tB[2] - tA[2]); tri(tA, tB, sB, [0, h, w2, h, w2 * 0.66, h + r * 0.4]); tri(tA, sB, sA, [0, h, w2 * 0.66, h + r * 0.4, 0, h + r * 0.4]); tri(sA, sB, apex, [0, h + r * 0.4, w2 * 0.66, h + r * 0.4, w2 * 0.33, h + r * tip]);
  }
  return { p: new Float32Array(P), n: new Float32Array(N), u: new Float32Array(U), i: new Uint32Array(I) };
}

/**
 * Cluster of crystals radiating from base p (stop-local). dir = mean growth direction. Returns list of {p, h, r, dir} for lights/colliders.
 * mats: array of materials (chosen per crystal by weight), n crystals, h max length, spread (rad) tilt from dir.
 */
export function crystalCluster(B, mats, { p, dir = [0, 1, 0], n = 12, h = 4, spread = 0.55, seed = 1, rMul = 0.17, minH = 0.3, mirror = null, colRadius = 0, sink = 0.4 }) {
  const rnd = makeRng(seed * 977 + 3); const d0 = new THREE.Vector3(...dir).normalize(); const out = [];
  // orthonormal basis around dir for tilt directions
  const t1 = new THREE.Vector3(1, 0, 0); if (Math.abs(d0.dot(t1)) > 0.9) t1.set(0, 0, 1); t1.cross(d0).normalize(); const t2 = new THREE.Vector3().crossVectors(d0, t1);
  for (let i = 0; i < n; i++) {
    const big = i === 0 ? 1 : 0.28 + rnd() * 0.72; const len = Math.max(minH, h * big), r = Math.max(0.05, len * rMul * (0.8 + rnd() * 0.5)); const ang = i === 0 ? 0 : spread * (0.25 + rnd() * 0.75), az = rnd() * TAU;
    const d = d0.clone().multiplyScalar(Math.cos(ang)).addScaledVector(t1, Math.sin(ang) * Math.cos(az)).addScaledVector(t2, Math.sin(ang) * Math.sin(az)).normalize();
    const off = i === 0 ? 0 : (0.15 + rnd() * 0.9) * h * 0.16; const bp = [p[0] + (t1.x * Math.cos(az) + t2.x * Math.sin(az)) * off, p[1] + (t1.y * Math.cos(az) + t2.y * Math.sin(az)) * off, p[2] + (t1.z * Math.cos(az) + t2.z * Math.sin(az)) * off];
    const raw = hexCrystalRaw(r, len, seed * 53 + i, { tip: 1.2 + rnd() * 0.7 }); Q.setFromUnitVectors(UP, d); const tw = new THREE.Quaternion().setFromAxisAngle(d, rnd() * TAU); Q.premultiply(tw);
    M4.compose(V.set(bp[0] - d.x * sink * len * 0.5, bp[1] - d.y * sink * len * 0.5, bp[2] - d.z * sink * len * 0.5), Q, S1); const m = mats[(rnd() * mats.length) | 0];
    B.addRaw(raw, M4.clone(), m, { cast: true, recv: true, bake: false });
    if (mirror) mirror(raw, M4.clone(), i);
    out.push({ p: bp, h: len, r, dir: d.toArray() });
  }
  if (h > 2.4) for (let i = 0; i < Math.min(46, Math.round(h * 9)); i++) { const az = rnd() * TAU, rad = h * 0.02 + (0.1 + rnd() * 0.75) * h * 0.2, len = 0.05 + rnd() * 0.16 * Math.min(1.5, h * 0.3), r = Math.max(0.012, len * 0.16), d = d0.clone().multiplyScalar(0.6).addScaledVector(t1, Math.cos(az) * 0.6 + (rnd() - 0.5) * 0.7).addScaledVector(t2, Math.sin(az) * 0.6 + (rnd() - 0.5) * 0.7).normalize(); const bp = [p[0] + (t1.x * Math.cos(az) + t2.x * Math.sin(az)) * rad, p[1] + (t1.y * Math.cos(az) + t2.y * Math.sin(az)) * rad, p[2] + (t1.z * Math.cos(az) + t2.z * Math.sin(az)) * rad]; const raw = hexCrystalRaw(r, len, seed * 71 + i, { tip: 1.1 + rnd() * 0.6 }); Q.setFromUnitVectors(UP, d); M4.compose(V.set(bp[0], bp[1], bp[2]), Q, S1); B.addRaw(raw, M4.clone(), mats[(rnd() * mats.length) | 0], { cast: false, recv: true, bake: false }); }
  if (colRadius > 0) B.colliders.addCyl({ x: p[0], z: p[2], r: colRadius, y0: p[1] - 1, y1: p[1] + h * 0.6, surface: 'crystal', walk: false });
  return out;
}

/**
 * Crystal material: a dark glassy body, facets that catch environment/lamp light, a fresnel rim, and *inclusions* seen through the surface: procedural
 * 3D noise sampled along the refracted view ray (parallax => the crystal looks deep, milky bands and feathers drift as you move), plus a brighter core
 * toward the base of each prism. glow/glow2 are the two body hues, rim the edge colour (linear rgb).
 */
export function crystalMaterial({ base = 0x160a3c, glow = [0.5, 0.2, 1.0], glow2 = [0.2, 0.8, 1.0], rim = [0.85, 0.55, 1.6], k = 1.0, key = 'amethyst', rough = 0.07, ior = 0.72 } = {}) {
  const v3 = (a) => `vec3(${a[0].toFixed(3)}, ${a[1].toFixed(3)}, ${a[2].toFixed(3)})`;
  return std({ color: base, roughness: rough, metalness: 0.0, physical: true, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.2, key: 'crys2' + key, frag: `
    { vec3 wn = normalize(vWN); vec3 Vv = normalize(cameraPosition - vWPos); float ndv = clamp(abs(dot(wn, Vv)), 0.0, 1.0); float fres = pow(1.0 - ndv, 2.6);
      vec3 rr = refract(-Vv, wn * sign(dot(wn, Vv)), ${ior.toFixed(2)});
      vec3 p0 = vWPos + rr * 0.35; vec3 p1 = vWPos + rr * 0.9;
      float band = smoothstep(0.35, 0.75, zfbm3(p0 * vec3(1.6, 5.5, 1.6) + 2.0));
      float fea = smoothstep(0.55, 0.85, zfbm3(p1 * vec3(3.4, 1.2, 3.4) + 7.0));
      float mist = zfbm3(p1 * 1.1 + 4.0);
      float facet = smoothstep(-0.7, 0.8, wn.x * 0.7 + wn.z * 0.5 + wn.y * 0.5);
      vec3 body = mix(${v3(glow)}, ${v3(glow2)}, facet);
      float depthK = pow(ndv, 0.9);
      vec3 e = body * (0.06 + 0.5 * depthK * (0.35 + 0.65 * mist)) + body * (band * 0.55 + fea * 0.9) * (0.4 + 0.6 * depthK) + ${v3(rim)} * fres * 1.3;
      totalEmissiveRadiance += e * ${k.toFixed(3)}; roughnessFactor = mix(0.04, 0.22, band * 0.5); }` });
}
