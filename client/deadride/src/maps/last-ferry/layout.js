// LAST FERRY — world layout (single source of truth): berth stations, stop origins, ferry route legs, speed profile.
// Pure math (no three.js) so it can be unit-tested in node. World axes: +X east, -Z north, y up. Forward of yaw θ = (-sinθ, -cosθ).
// The ferry loops counter-clockwise around the bay; every quay lies on the ferry's STARBOARD side (starboard(yaw) = (cosθ, -sinθ) = OUT).
export const PI = Math.PI;
export const BEAM_HALF = 4.5;          // ferry deck half-width (m)
export const FENDER = 0.3;             // fender thickness between hull and quay face
export const DECK_H = 1.35;            // ferry main deck height above the waterline at rest (freeboard)
export const OUT = 108;                // distance origin <-> ferry centreline, away from the water (stops are 350-600 m apart)
export const RIDE = { cruise: 14.0, acc: 2.0, dec: 1.8, aLat: 1.6, v0: 0.5, vEnd: 0.5, vDock: 3.0, lat: 3.2, dockLen: 14, straightOut: 28, straightIn: 34 };

const defs = [
  { id: 'pier',       S: [60, -20],   yaw: -PI / 2, quayY: 1.6 },
  { id: 'wharf',      S: [235, -150], yaw: 0,       quayY: 1.4 },
  { id: 'prison',     S: [120, -320], yaw: PI / 2,  quayY: 1.65 },
  { id: 'lighthouse', S: [-70, -190], yaw: PI,      quayY: 1.55 },
];
export const STOPS = defs.map((d) => {
  const f = [-Math.sin(d.yaw), -Math.cos(d.yaw)], out = [Math.cos(d.yaw), -Math.sin(d.yaw)];
  const origin = [d.S[0] + out[0] * OUT, 0, d.S[1] + out[1] * OUT];
  return { ...d, f, out, origin, S3: [d.S[0], 0, d.S[1]],
    stationLocal: [-out[0] * OUT, DECK_H, -out[1] * OUT],                       // ferry centre, stop-local
    quayFace: -OUT + BEAM_HALF + FENDER,                                          // coordinate of the quay face along OUT axis (stop-local)
    // convert (along-quay a, outward-distance d from ferry centre) to stop-local x,z. a>0 = toward bow (forward)
    toLocal(a, d) { return [-out[0] * OUT + out[0] * d + f[0] * a, -out[1] * OUT + out[1] * d + f[1] * a]; },
  };
});
export const worldOf = (i, lx, lz) => [STOPS[i].origin[0] + lx, STOPS[i].origin[2] + lz];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---- route legs: straight out along the quay, cubic Bezier across the bay, straight in along the next quay
function bez(p0, p1, p2, p3, t) { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; }
export class Leg {
  constructor(i) {
    this.from = i; this.to = (i + 1) % STOPS.length; const A = STOPS[this.from], B = STOPS[this.to];
    const a0 = A.S, a1 = [A.S[0] + A.f[0] * RIDE.straightOut, A.S[1] + A.f[1] * RIDE.straightOut];
    const b1 = [B.S[0] - B.f[0] * RIDE.straightIn, B.S[1] - B.f[1] * RIDE.straightIn], b0 = B.S;
    const d = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]), k = d * 0.36;
    const c1 = [a1[0] + A.f[0] * k, a1[1] + A.f[1] * k], c2 = [b1[0] - B.f[0] * k, b1[1] - B.f[1] * k];
    const pts = [a0];
    for (let t = 0.02; t < 1; t += 0.02) pts.push(bez(a1, c1, c2, b1, t));
    pts.push(b1, b0);
    // resample by arc length every 0.5 m
    const raw = [pts[0]]; for (let s = 1; s < pts.length; s++) { const p = pts[s - 1], q = pts[s], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.25)); for (let j = 1; j <= n; j++) raw.push([p[0] + (q[0] - p[0]) * j / n, p[1] + (q[1] - p[1]) * j / n]); }
    // start with a1 exact: pts already includes; recompute exact bezier for accuracy in the middle
    const cum = [0]; for (let s = 1; s < raw.length; s++) cum.push(cum[s - 1] + Math.hypot(raw[s][0] - raw[s - 1][0], raw[s][1] - raw[s - 1][1]));
    this.L = cum[cum.length - 1]; this.step = 0.5; const n = Math.floor(this.L / this.step); this.n = n; this.x = new Float32Array(n + 2); this.z = new Float32Array(n + 2);
    let j = 0; for (let s = 0; s <= n + 1; s++) { const target = Math.min(this.L, s * this.step); while (j < cum.length - 2 && cum[j + 1] < target) j++; const t = (target - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]); this.x[s] = raw[j][0] + (raw[j + 1][0] - raw[j][0]) * t; this.z[s] = raw[j][1] + (raw[j + 1][1] - raw[j][1]) * t; }
    this.outA = A.out; this.outB = B.out; this.headA = A.yaw; this.headB = B.yaw;
    this._profile();
  }
  /** speed profile: cruise, curvature limit (lateral accel), docking ramp; then forward/backward passes enforce the accel/decel limits */
  _profile() {
    const n = this.n + 2, ds = this.step, v = new Float32Array(n), lim = new Float32Array(n);
    const hd = new Float32Array(n); for (let i = 0; i < n; i++) { const i0 = Math.max(0, i - 4), i1 = Math.min(n - 1, i + 4); hd[i] = Math.atan2(-(this.x[i1] - this.x[i0]), -(this.z[i1] - this.z[i0])); }
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 8), i1 = Math.min(n - 1, i + 8); let dh = hd[i1] - hd[i0]; dh = ((dh + 3 * PI) % (2 * PI)) - PI; const kap = Math.abs(dh) / Math.max(0.5, (i1 - i0) * ds);
      const s = i * ds, rem = this.L - s; let l = Math.min(RIDE.cruise, Math.sqrt(RIDE.aLat / Math.max(kap, 1e-4)));
      if (rem < RIDE.dockLen) l = Math.min(l, RIDE.vEnd + (RIDE.vDock - RIDE.vEnd) * Math.max(0, rem) / RIDE.dockLen);
      lim[i] = l;
    }
    v[0] = RIDE.v0; for (let i = 1; i < n; i++) v[i] = Math.min(lim[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * RIDE.acc * ds));
    v[n - 1] = Math.min(v[n - 1], RIDE.vEnd); for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * RIDE.dec * ds));
    this.vp = v;
  }
  base(s, o) { s = Math.max(0, Math.min(this.L, s)); const u = s / this.step, k = Math.min(this.n, Math.floor(u)), f = u - k; o[0] = this.x[k] + (this.x[k + 1] - this.x[k]) * f; o[1] = this.z[k] + (this.z[k + 1] - this.z[k]) * f; return o; }
  /** lateral standoff (m, away from the quay) as function of arc length: 0 at both berths, RIDE.lat in between */
  offset(s) { return RIDE.lat * Math.min(sstep(2, 16, s), 1 - sstep(this.L - RIDE.dockLen, this.L - 2, s)); }
  /** reference pose at arc length s: o = [x, z, headingYaw] */
  ref(s, o = [0, 0, 0]) {
    const p = this._p || (this._p = [0, 0]), q = this._q || (this._q = [0, 0]); this.base(s, p); const off = this.offset(s);
    // the standoff direction rotates smoothly from berth A's outward normal to berth B's (a hard switch at mid-leg would teleport the reference by ~4.5 m)
    const w = sstep(0.36 * this.L, 0.64 * this.L, s); let ox = this.outA[0] + (this.outB[0] - this.outA[0]) * w, oz = this.outA[1] + (this.outB[1] - this.outA[1]) * w; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
    o[0] = p[0] - ox * off; o[1] = p[1] - oz * off;
    // heading follows the BASE path only (the ferry crabs sideways into/out of the berth with thrusters, staying parallel to the quay)
    const e = 2.5; this.base(Math.min(this.L, s + e), q); const x1 = q[0], z1 = q[1]; this.base(Math.max(0, s - e), q); o[2] = Math.atan2(-(x1 - q[0]), -(z1 - q[1])); return o;
  }
  /** commanded speed profile (m/s) at arc length s */
  speed(s) { s = Math.max(0, Math.min(this.L, s)); const u = s / this.step, k = Math.min(this.vp.length - 2, Math.floor(u)); return this.vp[k] + (this.vp[k + 1] - this.vp[k]) * (u - k); }
}
const cache = new Map();
export const leg = (i) => { i = ((i % STOPS.length) + STOPS.length) % STOPS.length; let l = cache.get(i); if (!l) { l = new Leg(i); cache.set(i, l); } return l; };
/** travel time estimate of a leg (s) */
export function legTime(l) { let t = 0; for (let s = 0; s < l.L; s += 0.5) t += 0.5 / Math.max(0.4, l.speed(s + 0.25)); return t; }
