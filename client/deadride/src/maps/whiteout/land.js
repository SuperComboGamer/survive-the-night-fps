// WHITEOUT geography (world coordinates, metres): mountain heightfield, station geometry, gondola line legs.
// Pure maths (no THREE / DOM) so it can be unit-tested with node. Shared by the three stops, the route scenery and the vehicle.
//
// Layout: three stations on a closed circuit  Base Village (0) -> Mid Station (1) -> Summit (2) -> back to the Village.
// The stop ORIGIN of each stop is the DOCK point of its station (platform level). Each station is a "fillet" of the two line
// directions: the cabin runs in along the incoming line, wraps a horizontal bullwheel of rail radius RAIL_R and leaves along the
// outgoing line; it docks on the outgoing straight (dockAfter metres after the arc). Line legs are straight in plan.
import { noise3, fbm2, ridged2, clamp, smoothstep, lerp } from '../../core/util.js';

export const ORIGINS = [[0, 0, 0], [270, 105, -90], [430, 245, 100]];
export const RAIL_R = 3.4;          // carrier rail radius round the bullwheel (m)
export const PIVOT_H = 4.45;        // grip/rope height above the cabin floor (m)
export const DOCK_AFTER = 8;        // dock distance after the end of the bullwheel arc (m)
export const GATE_RUN = 26;         // straight run between the arc/dock and the rope gate (m)
export const LINE_LOOK = ['base', 'mid', 'summit'];

const hyp = Math.hypot;
const nrm = (x, z) => { const l = hyp(x, z) || 1; return [x / l, z / l]; };

// ------------------------------------------------------------------ station geometry (plan) -- fixed-point iteration
function solveStations() {
  const n = ORIGINS.length; const dock = ORIGINS.map((o) => [o[0], o[2]]);
  let K = dock.map((d) => [d[0], d[1]]);
  let dOut = [], dIn = [], tau = [], tan = [];
  for (let it = 0; it < 24; it++) {
    dOut = K.map((k, i) => nrm(K[(i + 1) % n][0] - k[0], K[(i + 1) % n][1] - k[1]));
    dIn = K.map((k, i) => dOut[(i + n - 1) % n]);
    tau = K.map((k, i) => Math.acos(clamp(dIn[i][0] * dOut[i][0] + dIn[i][1] * dOut[i][1], -1, 1)));
    tan = tau.map((t) => RAIL_R * Math.tan(t / 2));
    K = K.map((k, i) => [dock[i][0] - dOut[i][0] * (tan[i] + DOCK_AFTER), dock[i][1] - dOut[i][1] * (tan[i] + DOCK_AFTER)]);
  }
  return K.map((k, i) => {
    const o = ORIGINS[i], din = dIn[i], dout = dOut[i], t = tan[i], ta = tau[i];
    const cross = din[0] * dout[1] - din[1] * dout[0]; const side = cross > 0 ? 1 : -1;      // +1: turns towards +z-rotation (see arc())
    const b = nrm(-din[0] + dout[0], -din[1] + dout[1]); const cd = RAIL_R / Math.cos(ta / 2);
    const C = [k[0] + b[0] * cd, k[1] + b[1] * cd];
    const A0 = [k[0] - din[0] * t, k[1] - din[1] * t], A1 = [k[0] + dout[0] * t, k[1] + dout[1] * t];
    const dk = [A1[0] + dout[0] * DOCK_AFTER, A1[1] + dout[1] * DOCK_AFTER];
    const gOut = [A1[0] + dout[0] * (DOCK_AFTER + GATE_RUN), A1[1] + dout[1] * (DOCK_AFTER + GATE_RUN)];
    const gIn = [A0[0] - din[0] * GATE_RUN, A0[1] - din[1] * GATE_RUN];
    const loc = (p) => [p[0] - o[0], p[1] - o[2]];
    return { i, origin: o, K, Kw: k, dIn: din, dOut: dout, tau: ta, tan: t, side, bis: b, Cw: C, A0w: A0, A1w: A1, dockW: dk, gateOutW: gOut, gateInW: gIn,
      // local (stop) coordinates -- what a stop author needs
      C: loc(C), A0: loc(A0), A1: loc(A1), dock: loc(dk), K_: loc(k), gateOut: loc(gOut), gateIn: loc(gIn),
      yaw: Math.atan2(-dout[0], -dout[1]), inYaw: Math.atan2(-din[0], -din[1]), wheelY: PIVOT_H };
  });
}
export const STATIONS = solveStations();

// ------------------------------------------------------------------ line legs (gate to gate, plan straight)
export const LEGS = STATIONS.map((a, i) => {
  const b = STATIONS[(i + 1) % STATIONS.length]; const p0 = a.gateOutW, p1 = b.gateInW; const L = hyp(p1[0] - p0[0], p1[1] - p0[1]);
  const y0 = a.origin[1] + PIVOT_H, y1 = b.origin[1] + PIVOT_H;
  return { i, from: a.i, to: b.i, p0, p1, y0, y1, len: L, dir: [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L], slope: (y1 - y0) / L };
});
/** rope height (no sag) at plan distance u along leg i, and the point on the leg nearest to (x,z): {u, d (signed lateral), y} */
export function legAt(leg, x, z) {
  const dx = x - leg.p0[0], dz = z - leg.p0[1]; const u = dx * leg.dir[0] + dz * leg.dir[1]; const d = -dx * leg.dir[1] + dz * leg.dir[0];
  return { u, d, y: leg.y0 + (leg.y1 - leg.y0) * clamp(u / leg.len) };
}

// ------------------------------------------------------------------ mountain
const gauss = (x, z, cx, cz, r) => Math.exp(-((x - cx) * (x - cx) + (z - cz) * (z - cz)) / (r * r));
const ridge = (x, z, cx, cz, dx, dz, hl, hw) => { const px = x - cx, pz = z - cz; const a = px * dx + pz * dz, b = -px * dz + pz * dx; return Math.exp(-(a * a) / (hl * hl) - (b * b) / (hw * hw)); };

/** raw mountain (no plateaus / corridor): valley floor far below the village, ridges, massifs, ravines */
function mountainRaw(x, z) {
  let h = -70;
  h += 330 * gauss(x, z, 468, 112, 150);                 // summit peak (right above the summit station)
  h += 170 * gauss(x, z, 520, 230, 170);                 // summit's southern buttress
  h += 250 * ridge(x, z, 270, -90, 0.35, 0.94, 210, 70);  // mid ridge (runs NNE-SSW through the mid station)
  h += 230 * gauss(x, z, -20, -250, 250);                // northern wall behind the village
  h += 200 * gauss(x, z, -240, -20, 210);                // western wall
  h += 150 * gauss(x, z, 120, 270, 180);                 // southern shoulder
  h += 70 * gauss(x, z, -30, 60, 70);                    // village shelf swell
  // ravines: creek gully between village and mid ridge, saddle between mid ridge and summit, valley draining south-west
  h -= 40 * ridge(x, z, 140, -20, 0.6, 0.8, 140, 34);
  h -= 70 * ridge(x, z, 350, 30, 0.85, 0.52, 80, 46);
  h -= 50 * ridge(x, z, -40, 200, 0.85, 0.5, 260, 90);
  // rock bands + medium relief (stronger higher up)
  const alt = clamp((h + 70) / 450);
  h += (ridged2(x * 0.0085 + 3.1, z * 0.0085 - 1.7, 5) - 0.55) * (30 + 60 * alt);
  h += (fbm2(x * 0.03 + 9.7, z * 0.03 + 2.3, 4) - 0.0) * (5 + 8 * alt);
  h += (fbm2(x * 0.075 + 1.3, z * 0.075 - 6.1, 3) - 0.05) * (3 + 5 * alt) + ridged2(x * 0.045 - 4.0, z * 0.045 + 8.8, 3) * (2 + 5 * alt);
  return h;
}

// plateau specs per stop (local rect half sizes, blend width)
export const PLATEAU = [
  { hx: 44, hz: 32, blend: 30 },   // village: wide street plateau
  { hx: 26, hz: 25, blend: 24 },   // mid station: exposed ridge top
  { hx: 21, hz: 24, blend: 22 },   // summit: small bench under the peak
];
function plateauW(i, x, z) {
  const o = ORIGINS[i], p = PLATEAU[i]; const dx = Math.abs(x - o[0]) - p.hx, dz = Math.abs(z - o[2]) - p.hz;
  const d = hyp(Math.max(dx, 0), Math.max(dz, 0)); return 1 - smoothstep(0, p.blend, d);
}
/** distance-weighted "shelf" so the raw mountain is close to the plateau height near each stop (avoids huge cuts) */
function shelfBias(x, z) {
  let s = 0;
  for (let i = 0; i < ORIGINS.length; i++) {
    const o = ORIGINS[i]; const d2 = (x - o[0]) * (x - o[0]) + (z - o[2]) * (z - o[2]); const w = Math.exp(-d2 / (95 * 95));
    s += w * (o[1] - mountainRaw(o[0], o[2]));
  }
  return s;
}
const _raw = new Map();
// clearance (rope above ground, m) along each leg as [u/len, clearance] anchors: shallow near the stations, a real gorge crossing mid-leg
const CLEAR = [
  [[0, 5.5], [0.08, 12], [0.2, 20], [0.32, 32], [0.45, 66], [0.6, 76], [0.72, 54], [0.84, 30], [0.93, 22], [1, 5.5]],
  [[0, 5.5], [0.1, 12], [0.25, 21], [0.4, 30], [0.5, 50], [0.62, 58], [0.74, 38], [0.86, 22], [0.94, 14], [1, 5.5]],
  [[0, 5.5], [0.06, 15], [0.15, 24], [0.3, 30], [0.42, 68], [0.55, 104], [0.7, 82], [0.82, 36], [0.92, 20], [1, 5.5]],
];
function clearAt(li, t) {
  const A = CLEAR[li]; let k = 0; while (k < A.length - 2 && t > A[k + 1][0]) k++;
  const u = clamp((t - A[k][0]) / (A[k + 1][0] - A[k][0])); return lerp(A[k][1], A[k + 1][1], u * u * (3 - 2 * u));
}
function corridorCarve(x, z, h, k = 1) {
  // shape the ground under each leg so that the rope clears it by the designed clearance (the corridor floor follows the rope, with relief)
  for (const leg of LEGS) {
    const a = legAt(leg, x, z); if (a.u < 0 || a.u > leg.len) continue;
    const ad = Math.abs(a.d); if (ad > 52) continue;
    const w = (1 - smoothstep(9, 52, ad)) * k; const t = a.u / leg.len;
    const noise = (fbm2(x * 0.045 + leg.i * 7.7, z * 0.045 - leg.i * 3.1, 3) - 0.25) * 16;
    const target = a.y - clearAt(leg.i, t) + noise * smoothstep(0.03, 0.15, Math.min(t, 1 - t));
    h = lerp(h, target, w);
  }
  return h;
}
/** world ground height (metres above the village dock plane) */
export function H(x, z) {
  let h = mountainRaw(x, z) + shelfBias(x, z), wp = 0;
  for (let i = 0; i < ORIGINS.length; i++) { const w = plateauW(i, x, z); if (w > 0) { const sw = w * w * (3 - 2 * w); h = lerp(h, ORIGINS[i][1], sw); wp = Math.max(wp, sw); } }
  return corridorCarve(x, z, h, 1 - wp * wp);
}
/** slope in degrees at (x,z) (for prop placement / forest) */
export function slopeDeg(x, z, e = 2) { const gx = (H(x + e, z) - H(x - e, z)) / (2 * e), gz = (H(x, z + e) - H(x, z - e)) / (2 * e); return Math.atan(hyp(gx, gz)) * 57.2958; }
/** ground height in a stop's LOCAL coordinates */
export const localH = (i) => { const o = ORIGINS[i]; return (x, z) => H(x + o[0], z + o[2]) - o[1]; };
/** distance from (x,z) (world) to the nearest rope corridor centre line (plan) */
export function corridorDist(x, z) { let m = 1e9; for (const leg of LEGS) { const a = legAt(leg, x, z); if (a.u < -20 || a.u > leg.len + 20) continue; m = Math.min(m, Math.abs(a.d)); } return m; }

// ------------------------------------------------------------------ terrain patches: each stop owns a fine patch around it; the route mesh fills the rest of the world (coarser)
export const EXT = [{ hx: 100, hz: 92 }, { hx: 96, hz: 96 }, { hx: 96, hz: 96 }];
export const GRID = 8;                                    // route terrain cell (m); stop patch rects are aligned to it so the hole edges are straight
export const STOP_RECTS = ORIGINS.map((o, i) => {
  const e = EXT[i]; const minX = GRID * Math.floor((o[0] - e.hx) / GRID), maxX = GRID * Math.ceil((o[0] + e.hx) / GRID), minZ = GRID * Math.floor((o[2] - e.hz) / GRID), maxZ = GRID * Math.ceil((o[2] + e.hz) / GRID);
  return { minX, maxX, minZ, maxZ, lminX: minX - o[0], lmaxX: maxX - o[0], lminZ: minZ - o[2], lmaxZ: maxZ - o[2] };
});
export const insideStopRect = (x, z) => { for (const r of STOP_RECTS) if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return true; return false; };
export const plateauMask = plateauW;
