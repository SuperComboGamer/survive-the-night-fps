// AFTER HOURS — monorail track geometry (pure math, no three.js): a closed, C2-continuous periodic cubic B-spline through four
// station straights (level, 72 m straight each) joined by quarter-circle-ish corners that rise to a ~8.3 m beam over the rides.
// Everything is tabulated by arc length (0.25 m) so the vehicle and the route scenery share one source of truth:
//   position of the beam top centre, heading (yaw, three.js convention: forward = (-sin, -cos)), pitch (grade), curvature (+ = left turn),
//   superelevation (bank, + = right side up = left turn), and the jerk-limited speed profile planner (S-curve) used by the train.
export const TAU = Math.PI * 2;
export const A = 125;                                   // station line distance from the park centre (m)
export const STOP_ORIGIN = [[0, 0, 163], [163, 0, 0], [0, 0, -163], [-163, 0, 0]];       // Plaza (S), Space (E), Castle (N), Cove (W)
export const STATION_LOCAL = [[0, 5.4, -38], [-38, 5.4, 0], [0, 5.4, 38], [38, 5.4, 0]]; // platform-level frame origin, stop-local coords
export const STATION_YAW = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];                          // heading E, N, W, S  (counter-clockwise loop seen from above)
export const FLOOR_ABOVE_BEAM = 0.55;                   // interior floor above the beam top
export const BEAM_STATION = 5.4 - FLOOR_ABOVE_BEAM;     // beam top height in the stations (4.85)
export const BEAM_TOP = 8.3;                            // beam top height over the rides
export const DESIGN_SPEED = 12.5;                       // superelevation is designed for this speed (m/s)
const G0 = 9.81;

const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

function controlPoints() {
  const P = []; const R = 77, SPAN = 48, STEP = 12, H = BEAM_TOP - BEAM_STATION;
  const C = [[0, A], [A, 0], [0, -A], [-A, 0]], HD = [[1, 0], [0, -1], [-1, 0], [0, 1]];        // station centre + heading (x,z)
  for (let k = 0; k < 4; k++) {
    const c = C[k], h = HD[k], n = [h[1], -h[0]];
    for (let d = -SPAN; d <= SPAN; d += STEP) P.push([c[0] + h[0] * d, BEAM_STATION, c[1] + h[1] * d]);   // straight: 9 collinear control points => exactly straight +-36 m
    const E = [c[0] + h[0] * SPAN, c[1] + h[1] * SPAN], Q = [E[0] + n[0] * R, E[1] + n[1] * R], NN = 6, arc = R * Math.PI / 2;
    for (let i = 1; i < NN; i++) {
      const u = (Math.PI / 2) * (i / NN), a = R * u;
      const up = smooth(Math.min(a, arc - a) / 62);                                                // rise over the first 62 m, fall over the last 62 m
      P.push([Q[0] - n[0] * R * Math.cos(u) + h[0] * R * Math.sin(u), BEAM_STATION + H * up, Q[1] - n[1] * R * Math.cos(u) + h[1] * R * Math.sin(u)]);
    }
  }
  return P;
}

export function buildTrack() {
  const CP = controlPoints(), M = CP.length;
  // --- dense evaluation of the periodic uniform cubic B-spline
  const SUB = 48, raw = new Float64Array(M * SUB * 3);
  for (let i = 0; i < M; i++) {
    const p0 = CP[i], p1 = CP[(i + 1) % M], p2 = CP[(i + 2) % M], p3 = CP[(i + 3) % M];
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB, t2 = t * t, t3 = t2 * t; const w0 = (-t3 + 3 * t2 - 3 * t + 1) / 6, w1 = (3 * t3 - 6 * t2 + 4) / 6, w2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, w3 = t3 / 6;
      const o = (i * SUB + j) * 3; for (let c = 0; c < 3; c++) raw[o + c] = w0 * p0[c] + w1 * p1[c] + w2 * p2[c] + w3 * p3[c];
    }
  }
  const NR = M * SUB, cum = new Float64Array(NR + 1);
  for (let i = 0; i < NR; i++) { const a = i * 3, b = ((i + 1) % NR) * 3; cum[i + 1] = cum[i] + Math.hypot(raw[b] - raw[a], raw[b + 1] - raw[a + 1], raw[b + 2] - raw[a + 2]); }
  const L = cum[NR], DS = 0.25, N = Math.round(L / DS), ds = L / N;                                 // uniform re-sampling (loop closes exactly)
  const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N);
  let k = 0; for (let i = 0; i < N; i++) {
    const s = i * ds; while (k < NR - 1 && cum[k + 1] < s) k++; const f = (s - cum[k]) / (cum[k + 1] - cum[k] || 1), a = k * 3, b = ((k + 1) % NR) * 3;
    px[i] = raw[a] + (raw[b] - raw[a]) * f; py[i] = raw[a + 1] + (raw[b + 1] - raw[a + 1]) * f; pz[i] = raw[a + 2] + (raw[b + 2] - raw[a + 2]) * f;
  }
  // --- tangent, heading, grade, curvature, bank
  const yaw = new Float64Array(N), pitch = new Float64Array(N), kap = new Float64Array(N), tx = new Float64Array(N), ty = new Float64Array(N), tz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 2) % N, b = (i + 2) % N; let dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a]; const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    tx[i] = dx; ty[i] = dy; tz[i] = dz; yaw[i] = Math.atan2(-dx, -dz); pitch[i] = Math.asin(dy);
  }
  const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  for (let i = 0; i < N; i++) { const a = (i + N - 2) % N, b = (i + 2) % N; kap[i] = wrap(yaw[b] - yaw[a]) / (4 * ds); }
  // bank: design superelevation for DESIGN_SPEED at ~80 % compensation, smoothed along the track (25 m moving average)
  const bank = new Float64Array(N), W = Math.round(12.5 / ds), tmp = new Float64Array(N);
  for (let i = 0; i < N; i++) tmp[i] = 0.8 * Math.atan(DESIGN_SPEED * DESIGN_SPEED * kap[i] / G0);
  for (let i = 0; i < N; i++) { let s = 0; for (let j = -W; j <= W; j++) s += tmp[(i + j + N) % N]; bank[i] = s / (2 * W + 1); }
  const T = { L, N, ds, px, py, pz, tx, ty, tz, yaw, pitch, kap, bank, CP, stations: [] };
  const idx = (s) => { s = ((s % L) + L) % L; const f = s / ds, i = Math.floor(f); return [i % N, (i + 1) % N, f - i]; };
  /** pose at arc length s (wraps). out = {x,y,z,yaw,pitch,bank,kappa,tx,ty,tz} */
  T.at = (s, o = {}) => {
    const [i, j, f] = idx(s); const l = (a, b) => a + (b - a) * f;
    o.x = l(px[i], px[j]); o.y = l(py[i], py[j]); o.z = l(pz[i], pz[j]); o.pitch = l(pitch[i], pitch[j]); o.bank = l(bank[i], bank[j]); o.kappa = l(kap[i], kap[j]);
    o.yaw = yaw[i] + wrap(yaw[j] - yaw[i]) * f; o.tx = l(tx[i], tx[j]); o.ty = l(ty[i], ty[j]); o.tz = l(tz[i], tz[j]); return o;
  };
  T.wrapS = (s) => ((s % L) + L) % L;
  // station arc lengths: closest table sample to each station's world position (the straights are exactly level/straight there)
  for (let k2 = 0; k2 < 4; k2++) {
    const o = STOP_ORIGIN[k2], sl = STATION_LOCAL[k2], wx = o[0] + sl[0], wz = o[2] + sl[2]; let best = 1e9, bi = 0;
    for (let i = 0; i < N; i++) { const d = Math.hypot(px[i] - wx, pz[i] - wz); if (d < best) { best = d; bi = i; } }
    const along = (wx - px[bi]) * tx[bi] + (wz - pz[bi]) * tz[bi];                                  // sub-sample refinement along the (straight) track
    T.stations.push({ s: bi * ds + along, index: k2, x: wx, z: wz, off: best, yaw: STATION_YAW[k2] });
  }
  T.legLength = (a, b) => ((T.stations[b].s - T.stations[a].s) % L + L) % L;
  return T;
}

// ------------------------------------------------------------------ jerk-limited speed profile (S-curve)
/** Acceleration phase from rest to v with limits a (m/s^2), j (m/s^3). Returns {T, s(t), v(t), a(t)} (closed form, symmetric S-curve). */
function accelPhase(v, a, j) {
  let t1, t2; if (v >= a * a / j) { t1 = a / j; t2 = v / a - a / j; } else { t1 = Math.sqrt(v / j); t2 = 0; }
  const ap = j * t1, Tt = 2 * t1 + t2;
  const st = (t) => { // integrate piecewise: returns [s,v,a]
    t = Math.min(Math.max(t, 0), Tt);
    if (t < t1) return [j * t * t * t / 6, j * t * t / 2, j * t];
    const v1 = j * t1 * t1 / 2, s1 = j * t1 * t1 * t1 / 6;
    if (t < t1 + t2) { const u = t - t1; return [s1 + v1 * u + ap * u * u / 2, v1 + ap * u, ap]; }
    const v2 = v1 + ap * t2, s2 = s1 + v1 * t2 + ap * t2 * t2 / 2, u = t - t1 - t2; return [s2 + v2 * u + ap * u * u / 2 - j * u * u * u / 6, v2 + ap * u - j * u * u / 2, ap - j * u];
  };
  return { T: Tt, at: st, dist: v * Tt / 2 };
}
/**
 * Plan a rest-to-rest move of length L: accel/decel S-curves with an optional cruise. Returns {T, at(t) -> [s, v, a], vPeak}.
 * v0 > 0 (arrival from speed, decelerate-only) and rest->cruise-and-vanish (departure) variants are provided by planArrive/planDepart.
 */
export function planRide(L, vMax = 16, aMax = 1.1, jMax = 0.9) {
  let vp = vMax; let ph = accelPhase(vp, aMax, jMax);
  if (2 * ph.dist > L) { let lo = 0, hi = vp; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (2 * accelPhase(m, aMax, jMax).dist > L) hi = m; else lo = m; } vp = lo; ph = accelPhase(vp, aMax, jMax); }
  const cruise = Math.max(0, (L - 2 * ph.dist) / vp), Tt = 2 * ph.T + cruise;
  const at = (t) => {
    t = Math.min(Math.max(t, 0), Tt);
    if (t < ph.T) return ph.at(t);
    if (t < ph.T + cruise) return [ph.dist + vp * (t - ph.T), vp, 0];
    const u = Math.min(ph.T, Tt - t), r = ph.at(u); return [L - r[0], r[1], -r[2]];
  };
  return { T: Tt, at, vPeak: vp, cruise };
}
/** Decelerate from speed v0 to rest: total distance = v0*T/2. Returns {T, dist, at(t)->[s,v,a]} with s measured from the start of braking. */
export function planBrake(v0, aMax = 1.1, jMax = 0.9) { const ph = accelPhase(v0, aMax, jMax); return { T: ph.T, dist: ph.dist, at: (t) => { const u = ph.T - Math.min(Math.max(t, 0), ph.T), r = ph.at(u); return [ph.dist - r[0], r[1], -r[2]]; } }; }
/** Accelerate from rest to v1 (departure): s from the start. */
export function planLaunch(v1, aMax = 1.1, jMax = 0.9) { const ph = accelPhase(v1, aMax, jMax); return { T: ph.T, dist: ph.dist, at: ph.at }; }
