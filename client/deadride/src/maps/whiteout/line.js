// Gondola line: dense sampled pivot (grip) paths for every leg, towers, rope spans. Shared by route.js (scenery) and vehicle.js (physics).
// A leg path runs  dock(a) -> exit run -> gate -> [spans over towers] -> gate -> entry run -> bullwheel arc -> dock(b).
import * as L from './land.js';
import { clamp, lerp, smoothstep, makeRng } from '../../core/util.js';

export const DS = 0.5;                 // path sample spacing (m)
export const ROPE_GAP = 5.6;           // spacing between the two ropes of a line (m); oncoming rope is on the LEFT of the travel direction
const hyp = Math.hypot;

function tangentsOf(P) {
  const n = P.n;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let dx = P.x[b] - P.x[a], dy = P.y[b] - P.y[a], dz = P.z[b] - P.z[a]; const l = hyp(dx, dy, dz) || 1;
    P.tx[i] = dx / l; P.ty[i] = dy / l; P.tz[i] = dz / l;
  }
  // curvature vector dT/ds (smoothed over ~ +-2 m)
  const W = 4;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - W), b = Math.min(n - 1, i + W); const d = (b - a) * DS;
    P.kx[i] = (P.tx[b] - P.tx[a]) / d; P.ky[i] = (P.ty[b] - P.ty[a]) / d; P.kz[i] = (P.tz[b] - P.tz[a]) / d;
  }
}
function smoothVar(arr, half) { // variable-window box filter (half[i] in samples) using prefix sums
  const n = arr.length, pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + arr[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const h = Math.max(0, Math.round(half[i])); const a = Math.max(0, i - h), b = Math.min(n - 1, i + h); out[i] = (pre[b + 1] - pre[a]) / (b - a + 1); }
  return out;
}

/** choose tower positions along a leg (plan distance u from the gate): ~100 m spans, on ground a real tower can reach */
function placeTowers(leg, rng) {
  const towers = []; const H = L.H;
  const ropeY = (u) => leg.y0 + (leg.y1 - leg.y0) * u / leg.len;
  const groundAt = (u) => H(leg.p0[0] + leg.dir[0] * u, leg.p0[1] + leg.dir[1] * u);
  const ok = (u) => { const c = ropeY(u) - groundAt(u); return c >= 8 && c <= 50; };
  let last = 0;
  while (leg.len - last > 120) {
    const lo = last + 55, hi = Math.min(last + 260, leg.len - 30); if (hi <= lo) break;
    const ideal = Math.min(last + 84 + rng() * 26, hi); let best = null, bd = 1e9;
    for (let u = lo; u <= hi; u += 2) if (ok(u)) { const d = Math.abs(u - ideal); if (d < bd) { bd = d; best = u; } }
    if (best === null) { let bc = 1e9; for (let u = lo; u <= hi; u += 3) { const c = ropeY(u) - groundAt(u); if (c < bc) { bc = c; best = u; } } }
    towers.push({ u: best, x: leg.p0[0] + leg.dir[0] * best, z: leg.p0[1] + leg.dir[1] * best, ground: groundAt(best), top: ropeY(best), h: ropeY(best) - groundAt(best) }); last = best;
  }
  return towers;
}

function buildLeg(leg) {
  const a = L.STATIONS[leg.from], b = L.STATIONS[leg.to]; const rng = makeRng(101 + leg.i * 17);
  const towers = placeTowers(leg, rng);
  // per-tower rope offsets (real lines are not perfectly linear): +-0.6 m
  for (const t of towers) { t.top += (rng() - 0.5) * 1.2; }
  // supports: gate0, towers..., gate1  -> parabolic sag between them
  const sup = [{ u: 0, y: leg.y0 }, ...towers.map((t) => ({ u: t.u, y: t.top })), { u: leg.len, y: leg.y1 }];
  const ropeYAt = (u) => { let k = 0; while (k < sup.length - 2 && u > sup[k + 1].u) k++; const A = sup[k], Bs = sup[k + 1]; const t = clamp((u - A.u) / (Bs.u - A.u)); const span = Bs.u - A.u; return lerp(A.y, Bs.y, t) - 4 * 0.021 * span * t * (1 - t); };
  const pts = []; // plan points with raw y and a support flag
  const push = (x, y, z, tag) => pts.push({ x, y, z, tag });
  const yA = a.origin[1] + L.PIVOT_H, yB = b.origin[1] + L.PIVOT_H;
  // 1. exit run (dock -> gateOut)
  const sd = a.dockW; const runN = Math.round(L.GATE_RUN / DS);
  for (let i = 0; i < runN; i++) { const d = i * DS; push(sd[0] + a.dOut[0] * d, yA, sd[1] + a.dOut[1] * d, 0); }
  // 2. line
  const lineN = Math.round(leg.len / DS);
  for (let i = 0; i < lineN; i++) { const u = i * DS; push(leg.p0[0] + leg.dir[0] * u, ropeYAt(u), leg.p0[1] + leg.dir[1] * u, 1); }
  // 3. entry run (gateIn(b) -> A0(b))
  for (let i = 0; i < runN; i++) { const d = i * DS; push(b.gateInW[0] + b.dIn[0] * d, yB, b.gateInW[1] + b.dIn[1] * d, 0); }
  // 4. bullwheel arc round C(b) from A0 to A1
  const arcLen = b.tau * L.RAIL_R, arcN = Math.max(2, Math.round(arcLen / DS));
  const a0 = Math.atan2(b.A0w[1] - b.Cw[1], b.A0w[0] - b.Cw[0]); const dth = b.side * b.tau / arcN;
  // orientation of travel: for side>0 (cross>0) heading rotates towards +angle in (x,z) plane measured atan2(z,x)
  for (let i = 0; i < arcN; i++) { const th = a0 + dth * i; push(b.Cw[0] + Math.cos(th) * L.RAIL_R, yB, b.Cw[1] + Math.sin(th) * L.RAIL_R, 2); }
  // 5. dock run (A1 -> dock)
  const dN = Math.round(L.DOCK_AFTER / DS);
  for (let i = 0; i <= dN; i++) { const d = i * DS; push(b.A1w[0] + b.dOut[0] * d, yB, b.A1w[1] + b.dOut[1] * d, 0); }
  const n = pts.length; const P = { n, leg: leg.i, from: leg.from, to: leg.to, towers, s: new Float32Array(n), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    tx: new Float32Array(n), ty: new Float32Array(n), tz: new Float32Array(n), kx: new Float32Array(n), ky: new Float32Array(n), kz: new Float32Array(n) };
  // cumulative arc length in 3D (raw)
  let acc = 0; const yr = new Float32Array(n);
  for (let i = 0; i < n; i++) { if (i) acc += hyp(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) ; P.s[i] = acc; P.x[i] = pts[i].x; P.z[i] = pts[i].z; yr[i] = pts[i].y; }
  // smoothing of y: wide near the gates (rope rises out of the station), tight at towers (sheave trains)
  const gate0 = L.GATE_RUN, gate1 = L.GATE_RUN + leg.len; const half = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = P.s[i]; let w = 0.8 / DS;
    const dg = Math.min(Math.abs(s - gate0), Math.abs(s - gate1)); w = Math.max(w, 13 * (1 - smoothstep(0, 26, dg)) / DS);
    for (const t of towers) { const dt = Math.abs(s - (gate0 + t.u)); if (dt < 8) w = Math.max(w, 2.6 * (1 - smoothstep(2, 8, dt)) / DS); }
    half[i] = w;
  }
  P.y = smoothVar(yr, half); P.y = smoothVar(P.y, half.map((h) => h * 0.5));
  // re-accumulate 3D arc length
  acc = 0; for (let i = 0; i < n; i++) { if (i) acc += hyp(P.x[i] - P.x[i - 1], P.y[i] - P.y[i - 1], P.z[i] - P.z[i - 1]); P.s[i] = acc; }
  P.length = acc; tangentsOf(P);
  // s-position of the towers and gates along the 3D path (nearest sample to the plan position)
  const sAtU = (u) => { const target = gate0 + u; let bi = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = Math.abs(planS(i) - target); if (d < bd) { bd = d; bi = i; } } return P.s[bi]; };
  const plan = new Float32Array(n); let pa = 0; for (let i = 0; i < n; i++) { if (i) pa += hyp(P.x[i] - P.x[i - 1], P.z[i] - P.z[i - 1]); plan[i] = pa; } const planS = (i) => plan[i];
  for (const t of towers) t.s = sAtU(t.u);
  P.gateOutS = sAtU(0); P.gateInS = sAtU(leg.len); P.dockA = 0; P.dockB = P.length; P.arcS0 = P.gateInS + L.GATE_RUN; P.arcS1 = P.arcS0 + arcLen;
  return P;
}

const _out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, kx: 0, ky: 0, kz: 0, i: 0 };
/** index of the sample at/below s (binary search on the 3D arc length) */
export function indexAt(P, s) { let lo = 0, hi = P.n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.s[m] <= s) lo = m; else hi = m; } return lo; }
export function sampleS(P, s, out = _out) {
  const i = indexAt(P, clamp(s, 0, P.length)), j = Math.min(P.n - 1, i + 1); const s0 = P.s[i], s1 = P.s[j]; const t = clamp((s - s0) / Math.max(1e-6, s1 - s0)); const m = (a) => a[i] + (a[j] - a[i]) * t;
  out.x = m(P.x); out.y = m(P.y); out.z = m(P.z); out.tx = m(P.tx); out.ty = m(P.ty); out.tz = m(P.tz); out.kx = m(P.kx); out.ky = m(P.ky); out.kz = m(P.kz); out.i = i; return out;
}

let _line = null;
/** the whole gondola line (cached): paths[k] = leg k from stop k to stop k+1 */
export function getLine() {
  if (_line) return _line;
  const paths = L.LEGS.map(buildLeg);
  _line = { paths, legs: L.LEGS, stations: L.STATIONS };
  return _line;
}
/** the haul rope inside/around station i (world points): entry arm -> bullwheel wrap -> dock -> exit arm to the gate, step ~0.8 m */
export function stationRope(i, step = 0.8) {
  const line = getLine(); const prev = line.paths[(i + 2) % 3], next = line.paths[i]; const pts = [];
  for (let s = prev.gateInS - 2; s < prev.length; s += step) { const T = sampleS(prev, s); pts.push([T.x, T.y, T.z]); }
  for (let s = 0; s <= next.gateOutS + 2; s += step) { const T = sampleS(next, s); pts.push([T.x, T.y, T.z]); }
  return pts;
}
export { L as LAND };
