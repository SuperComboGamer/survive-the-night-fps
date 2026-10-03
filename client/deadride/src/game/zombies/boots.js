// BOOTS (LOD0): a proper sole unit — outsole with scalloped lug edge + tread blocks, stitched welt, heel stack — built around the actual boot
// upper (outline measured from the cloth layer), plus toe cap / heel counter panels, eyelets + criss-cross laces + tongue (leather boots),
// buckle straps (plastic / rubber ski + moon boots), moulded ridges (wellingtons) and leather creases.
import * as THREE from 'three';
import { RIG, BI } from './rig.js';
import { matSpec } from './mesh.js';
import { project, densify, ribbon, dashes, threadSpec, box, patch, button, seam } from './stitch.js';
import { noise3 } from './folds.js';

const PI = Math.PI, TAU = PI * 2, sq = Math.sqrt;
const smoothS = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const norm3 = (a) => { const l = sq(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** the sole unit of both boots. S = Surf of the boot upper layer. */
export function bootSole(o, L, S) {
  const buf = o.buf, G = L.G, kind = L.prm.kind, wellie = kind === 'wellies'; const N = 44;
  const soleSpec = matSpec({ mat: G.o.soleMat || 'rubber', color: G.o.soleColor ?? (wellie ? 0x151515 : 0x1a1816), rough: 0.88, wear: 0.6, dirt: 0.7 });
  const weltSpec = matSpec({ mat: wellie ? 'rubber' : 'leather', color: G.o.weltColor ?? (wellie ? 0x2a2a2a : 0x6a4c2c), rough: 0.62, wear: 0.5, dirt: 0.65 });
  const thread = threadSpec(weltSpec, 0xc9a25a); const lugSpec = matSpec({ mat: 'rubber', color: 0x101010, rough: 0.95, wear: 0.6, dirt: 0.8 });
  for (const side of ['L', 'R']) {
    const Lg = RIG.leg[side], sx = Lg.sx, ax = Lg.ankle[0], az = Lg.ankle[2], ballZ = Lg.ball[2]; const cx = ax + sx * 0.005, cz = az - 0.045, cy = 0.03;
    // outline radius per angle, measured on the upper at 3 cm height
    const r = new Float64Array(N); for (let i = 0; i < N; i++) { const a = i / N * TAU; const h = S.ray(cx, cy, cz, Math.sin(a), 0, -Math.cos(a), 0.3); r[i] = h ? Math.hypot(h.p[0] - cx, h.p[2] - cz) : 0.05; }
    const rs = new Float64Array(N); for (let i = 0; i < N; i++) rs[i] = (r[(i + N - 1) % N] + 2 * r[i] + r[(i + 1) % N]) / 4;
    const ang = (i) => i / N * TAU; const ring = (yk, dr, nrmUp, notch = 0, heel = 0) => { const ids = []; for (let i = 0; i < N; i++) { const a = ang(i), ca = Math.cos(a), sa = Math.sin(a); const arc = a * (rs[i] + 0.008); const sqw = notch ? smoothS(0.35, 0.65, 0.5 + 0.5 * Math.cos(arc / 0.021 * TAU)) : 0; const rad = rs[i] + 0.008 + dr - notch * sqw; const x = cx + sa * rad, z = cz - ca * rad; const hk = heel * smoothS(-0.15, -0.75, ca); const y = yk + hk;
        const zz = z; const toeW = smoothS(ballZ + 0.03, ballZ - 0.04, zz); const w = toeW > 0.02 ? [['toe.' + side, toeW], ['foot.' + side, 1 - toeW]] : [['foot.' + side, 1]]; const nn = norm3([sa * (1 - Math.abs(nrmUp)), nrmUp, -ca * (1 - Math.abs(nrmUp))]); ids.push(buf.vert([x, y, z], nn, w, soleSpec, 0.85 + 0.15 * (yk > 0.01 ? 1 : 0))); } return ids; };
    const r0 = ring(0.0006, -0.002, -0.55), r1 = ring(0.0046, 0.0, 0, 0.0034), r2 = ring(0.0128, 0.0004, 0.1), r3 = ring(0.0138, -0.0016, 0.75, 0, 0.0), r4 = ring(0.0222, -0.0016, 0.05, 0, 0.011);
    const band = (A, B) => { for (let i = 0; i < N; i++) { const j = (i + 1) % N; buf.quad(A[i], B[i], B[j], A[j]); } };
    band(r0, r1); band(r1, r2); band(r2, r3); band(r3, r4);
    { // contact skirt: a flat, irregular apron round the sole in dirty snow / mud colour — grounds the boot (no hovering feet)
      const skSpec = matSpec({ mat: 'rubber', color: 0x2c2825, rough: 1, wear: 0.3, dirt: 0.9 }); const sk = (dr, y, ao) => { const ids = []; for (let i = 0; i < N; i++) { const a = ang(i), ca = Math.cos(a), sa = Math.sin(a); const rad = rs[i] + 0.008 + (dr > 0 ? dr * (0.55 + 0.9 * (0.5 + 0.5 * noise3(sa * 3 + i * 0.37 + side.length, ca * 3, 1.7, 9))) : dr); const zz = cz - ca * rad; const toeW = smoothS(ballZ + 0.03, ballZ - 0.04, zz); const w = toeW > 0.02 ? [['toe.' + side, toeW], ['foot.' + side, 1 - toeW]] : [['foot.' + side, 1]]; ids.push(buf.vert([cx + sa * rad, y, zz], [0, 1, 0], w, skSpec, ao)); } return ids; };
      const k0 = sk(-0.002, 0.0009, 0.75), k1 = sk(0.026, 0.0004, 0.3); for (let i = 0; i < N; i++) { const j = (i + 1) % N; buf.quad(k0[i], k0[j], k1[j], k1[i]); } }
    const cV = buf.vert([cx, 0.0006, cz], [0, -1, 0], [['foot.' + side, 1]], soleSpec, 0.7); for (let i = 0; i < N; i++) buf.tri(cV, r0[i], r0[(i + 1) % N]);
    // tread blocks (herringbone) under the forefoot and heel
    const rowsF = 7, rowsH = 3; for (let k = 0; k < rowsF + rowsH; k++) { const front = k < rowsF; const zz = front ? cz - 0.03 - k * 0.0215 : cz + 0.045 + (k - rowsF) * 0.02; const wOut = (front ? 0.052 - Math.max(0, k - 3) * 0.006 : 0.036) ; const toeW = smoothS(ballZ + 0.03, ballZ - 0.04, zz); const w = toeW > 0.02 ? [['toe.' + side, toeW], ['foot.' + side, 1 - toeW]] : [['foot.' + side, 1]];
      for (const sg of [-1, 1]) { const a = sg * 0.42; const t = [Math.cos(a), 0, Math.sin(a) * sg * -1]; void t; const tt = norm3([Math.cos(a * 1.0), 0, -Math.sin(a) * 1.0]); const ss = norm3(cross([0, -1, 0], tt)); box(o, [cx + sg * wOut * 0.5, 0.0006, zz], tt, ss, [0, -1, 0], [0.018, 0.006, 0.0038], lugSpec, w, 0.75); } }
    // welt ridge around the upper, stitched
    const g = []; for (let i = 0; i <= N; i++) { const a = ang(i % N); const h = S.ray(cx, 0.027, cz, Math.sin(a), 0, -Math.cos(a), 0.3); if (h) g.push(h.p.slice()); }
    if (g.length > 20) { const ch = project(S, densify(g, 0.008), 0.02); ribbon(o, ch, { width: 0.0075, lift: 0.0028, profile: 'round', spec: weltSpec }); dashes(o, project(S, densify(g.map((p) => [p[0], p[1] + 0.0038, p[2]]), 0.0055), 0.02), { spec: thread, lift: 0.0034, width: 0.0011 }); }
  }
}

/** eyelet: flat metal ring with a dark hole */
function eyelet(o, S, gp, metal, dark, r = 0.0036) {
  const h = S.closest(gp[0], gp[1], gp[2], 0.03); if (!h) return null; const buf = o.buf; const c = h.p.slice(), n = h.n.slice(), w = S.weights(h), ao = S.ao(h); const up = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const t = norm3(cross(up, n)), s = norm3(cross(n, t)); const K = 6; const lift = 0.0016; const out = [], inn = [];
  for (let k = 0; k < K; k++) { const a = k / K * TAU, ca = Math.cos(a), sa = Math.sin(a); const d = [t[0] * ca + s[0] * sa, t[1] * ca + s[1] * sa, t[2] * ca + s[2] * sa];
    out.push(buf.vert([c[0] + d[0] * r + n[0] * lift, c[1] + d[1] * r + n[1] * lift, c[2] + d[2] * r + n[2] * lift], norm3([n[0] * 0.8 + d[0] * 0.6, n[1] * 0.8 + d[1] * 0.6, n[2] * 0.8 + d[2] * 0.6]), w, metal, ao));
    inn.push(buf.vert([c[0] + d[0] * r * 0.5 + n[0] * (lift * 0.4), c[1] + d[1] * r * 0.5 + n[1] * (lift * 0.4), c[2] + d[2] * r * 0.5 + n[2] * (lift * 0.4)], norm3([n[0] * 0.8 - d[0] * 0.6, n[1] * 0.8 - d[1] * 0.6, n[2] * 0.8 - d[2] * 0.6]), w, dark, ao * 0.5)); }
  for (let k = 0; k < K; k++) { const k1 = (k + 1) % K; buf.quad(out[k], out[k1], inn[k1], inn[k]); }
  return { p: c, n, w, ao };
}

/** details of one boot layer (LOD0): laces / straps / ridges + toe cap / heel counter + creases */
export function bootDetails(o, layers, li, S) {
  const L = layers[li], G = L.G, kind = L.prm.kind, buf = o.buf; const mat = G.o.mat ?? G.g.mat?.mat ?? 'leather'; const spec = L.spec; const thread = threadSpec(spec);
  const metal = matSpec({ mat: 'metal', color: 0x9a9a92, rough: 0.35, wear: 0.5, dirt: 0.55 }), dark = matSpec({ mat: 'rubber', color: 0x080808, rough: 0.9 });
  const lace = matSpec({ mat: 'cloth', color: G.o.laceColor ?? (mat === 'leather' ? 0x1a1a18 : 0x2a2a2a), rough: 0.9, dirt: 0.6, wear: 0.4, pattern: 'weave' }), tongue = matSpec({ mat: 'leather', color: 0x2e2218, rough: 0.7, wear: 0.4, dirt: 0.7 });
  const yTop = (() => { let y = 0; for (let v = 0; v < L.m.n; v++) if (L.m.P[v * 3 + 1] > y) y = L.m.P[v * 3 + 1]; return y; })();
  for (const side of ['L', 'R']) {
    const Lg = RIG.leg[side], sx = Lg.sx, ax = Lg.ankle[0], az = Lg.ankle[2];
    if (kind === 'boots' && mat === 'leather' && G.o.laces !== false) {
      // lace line: down the shin front then along the instep
      const line = []; for (let y = Math.min(yTop - 0.028, 0.34); y >= 0.125; y -= 0.031) { const h = S.ray(ax, y, -0.5, 0, 0, 1, 0.9); if (h) line.push({ p: h.p.slice(), n: h.n.slice(), w: S.weights(h), ao: S.ao(h) }); }
      for (let z = az - 0.035; z >= az - 0.11; z -= 0.026) { const h = S.ray(ax + sx * 0.002, 0.3, z, 0, -1, 0, 0.5); if (h) line.push({ p: h.p.slice(), n: h.n.slice(), w: S.weights(h), ao: S.ao(h) }); }
      if (line.length > 5) {
        // tongue (padded strip under the laces, peeking out above the top pair)
        const tg = project(S, densify(line.map((c) => c.p), 0.008), 0.03); ribbon(o, tg, { width: 0.04, lift: 0.0042, profile: 'welt', spec: tongue });
        const eye = [[], []]; line.forEach((c, k) => { const t = k < line.length - 1 ? norm3([line[k + 1].p[0] - c.p[0], line[k + 1].p[1] - c.p[1], line[k + 1].p[2] - c.p[2]]) : norm3([c.p[0] - line[k - 1].p[0], c.p[1] - line[k - 1].p[1], c.p[2] - line[k - 1].p[2]]); const sv = norm3(cross(c.n, t)); [-1, 1].forEach((sg, q) => { const gp = [c.p[0] + sv[0] * sg * 0.0205, c.p[1] + sv[1] * sg * 0.0205, c.p[2] + sv[2] * sg * 0.0205]; const e = eyelet(o, S, gp, metal, dark); eye[q].push(e); }); });
        const arc = (A, B) => { const pts = []; for (let t = 0; t <= 1.001; t += 1 / 4) { const gp = [A.p[0] + (B.p[0] - A.p[0]) * t, A.p[1] + (B.p[1] - A.p[1]) * t, A.p[2] + (B.p[2] - A.p[2]) * t]; const hh = S.closest(gp[0], gp[1], gp[2], 0.03); if (!hh) continue; const lift = 0.0052 + 0.0032 * Math.sin(Math.PI * t); pts.push({ p: [hh.p[0] + hh.n[0] * lift, hh.p[1] + hh.n[1] * lift, hh.p[2] + hh.n[2] * lift], n: hh.n.slice(), w: S.weights(hh), ao: S.ao(hh) }); } if (pts.length > 3) ribbon(o, pts, { width: 0.0042, lift: 0.0016, profile: 'round', spec: lace }); };
        for (let k = 0; k < line.length - 1; k++) { if (eye[0][k] && eye[1][k + 1]) arc(eye[0][k], eye[1][k + 1]); if (eye[1][k] && eye[0][k + 1]) arc(eye[1][k], eye[0][k + 1]); }
        // bow: two short tails hanging down each side of the top
        const top = line[0]; for (const sg of [-1, 1]) { const pts = []; for (let q = 0; q <= 5; q++) { const gp = [top.p[0] + sg * (0.006 + q * 0.006), top.p[1] - 0.004 - q * 0.011, top.p[2] - 0.004]; const hh = S.closest(gp[0], gp[1], gp[2], 0.03); if (!hh) continue; pts.push({ p: [hh.p[0] + hh.n[0] * 0.0075, hh.p[1] + hh.n[1] * 0.0075, hh.p[2] + hh.n[2] * 0.0075], n: hh.n.slice(), w: S.weights(hh), ao: S.ao(hh) }); } if (pts.length > 3) ribbon(o, pts, { width: 0.0042, lift: 0.0015, profile: 'round', spec: lace }); }
      }
      // toe cap + heel counter panels with stitching
      { const h = S.ray(ax + sx * 0.006, 0.3, az - 0.145, 0, -1, 0, 0.5); if (h) patch(o, S, [h.p[0], h.p[1], h.p[2] + 0.045], [0, 0, 1], { w: 0.084, h: 0.07, lift: 0.0024, spec, thread, nu: 7, nv: 6, round: 0.03, inset: 0.005 }); }
      { const h = S.ray(ax, 0.1, 0.5, 0, 0, -1, 0.9); if (h) patch(o, S, [h.p[0], h.p[1] + 0.04, h.p[2]], [0, -1, 0], { w: 0.08, h: 0.075, lift: 0.0024, spec, thread, nu: 7, nv: 6, round: 0.03, inset: 0.005 }); }
    } else if (kind === 'wellies') {
      // moulded ridges: ankle bulge line, top roll, vertical mould seams on both sides
      for (const [y, wd, lf] of [[0.118, 0.008, 0.0024], [Math.min(yTop - 0.012, 0.46), 0.012, 0.003]]) { const g = []; for (let a = 0; a <= 32; a++) { const ang = a / 32 * TAU; const h = S.ray(ax, y, az - 0.02, Math.sin(ang), 0, -Math.cos(ang), 0.3); if (h) g.push(h.p.slice()); } if (g.length > 20) ribbon(o, project(S, densify(g, 0.01), 0.02), { width: wd, lift: lf, profile: 'round', spec }); }
      for (const sg of [-1, 1]) { const g = []; for (let y = 0.06; y <= Math.min(yTop - 0.02, 0.44); y += 0.024) { const h = S.ray(ax + sg * 0.3, y, az - 0.01, -sg, 0, 0, 0.4); if (h) g.push(h.p.slice()); } if (g.length > 6) ribbon(o, project(S, densify(g, 0.012), 0.02), { width: 0.0045, lift: 0.0016, profile: 'round', spec }); }
    } else if (mat === 'rubber' || mat === 'plastic') {
      // buckle straps across the shin / ankle (ski + moon boots)
      for (const y of [0.13, 0.215, 0.3].filter((v) => v < yTop - 0.02)) { const g = []; for (let a = -78; a <= 78; a += 8) { const ang = a * PI / 180; const h = S.ray(ax, y, az - 0.02, Math.sin(ang), 0, -Math.cos(ang), 0.3); if (h) g.push(h.p.slice()); } if (g.length > 8) { const ch = project(S, densify(g, 0.008), 0.02); ribbon(o, ch, { width: 0.022, lift: 0.0035, profile: 'flat', spec: dark }); const mid = ch[Math.floor(ch.length * 0.35)]; if (mid) box(o, [mid.p[0] + mid.n[0] * 0.0036, mid.p[1] + mid.n[1] * 0.0036, mid.p[2] + mid.n[2] * 0.0036], norm3(cross(mid.n, [0, 1, 0])), [0, 1, 0], mid.n, [0.03, 0.02, 0.005], metal, mid.w, 1); } }
    }
  }
}
