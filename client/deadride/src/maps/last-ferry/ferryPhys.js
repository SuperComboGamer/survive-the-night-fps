// FERRY RIGID-BODY PHYSICS (pure JS, no three.js): 6-DOF body floating on the Gerstner sea.
//  * hull buoyancy from a grid of 36 vertical "columns" (9 stations x 4): F = rho g a * submerged depth (sampled with water.height per column, per sub-step),
//    applied at the column centroid so metacentric stability (GM) emerges from the hull shape; per-column vertical damping (wave-making) gives heave/pitch/roll decay.
//  * horizontal motion: hull drag + propulsion/rudder modelled as a PD tracker of a reference pose on the route, applied BELOW the CG (so accelerations heel/trim the ship);
//    mooring lines (tension-only springs), fender contact against the quay plane.
//  * outputs pose of the deck origin O (body frame origin, deck level, midship centreline) for the visual frame.
// Body axes: +X starboard, +Y up, -Z forward (bow). Yaw ψ about +Y; forward(ψ) = (-sinψ, 0, -cosψ).
export const RHO = 1025, GRAV = 9.81;
export const HULL = { L: 28, HB: 4.5, KEEL: -3.0, DECK_H: 1.35 };

// ---- hull lines (shared with the mesh generator)
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const tOf = (z) => (z + 14) / 28;                                  // 0 at the stem, 1 at the transom
export function halfWidth(z) {                                             // deck-level half width
  const t = Math.min(1, Math.max(0, tOf(z)));
  if (t < 0.34) return HULL.HB * (1 - Math.pow(1 - t / 0.34, 2.3));
  if (t > 0.82) return HULL.HB * (1 - 0.10 * Math.pow((t - 0.82) / 0.18, 2));
  return HULL.HB;
}
export function keelY(z) {
  const t = Math.min(1, Math.max(0, tOf(z)));
  if (t < 0.28) return HULL.KEEL + 1.15 * Math.pow(1 - t / 0.28, 2);
  if (t > 0.88) return HULL.KEEL + 0.45 * Math.pow((t - 0.88) / 0.12, 2);
  return HULL.KEEL;
}
/** half-width fraction at height fraction u (0 keel .. 1 deck): flat keel strip, round bilge, near-vertical topsides */
export function sectionF(u) { return u < 0.42 ? 0.08 + 0.85 * (1 - Math.pow(1 - u / 0.42, 2.2)) : 0.93 + 0.07 * (u - 0.42) / 0.58; }
export function sectionU(f) { if (f <= 0.08) return 0; if (f >= 0.93) return 0.42 + (f - 0.93) / 0.07 * 0.58; return 0.42 * (1 - Math.pow(1 - (f - 0.08) / 0.85, 1 / 2.2)); }
export function bottomAt(xabs, z) { const W = Math.max(1e-3, halfWidth(z)), k = keelY(z); return k + sectionU(Math.min(1, xabs / W)) * (0 - k); }

// ---- tiny vector/quaternion helpers on plain arrays (no allocation in the step)
const qmul = (a, b, o) => { const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3]; o[0] = aw * bx + ax * bw + ay * bz - az * by; o[1] = aw * by - ax * bz + ay * bw + az * bx; o[2] = aw * bz + ax * by - ay * bx + az * bw; o[3] = aw * bw - ax * bx - ay * by - az * bz; return o; };
const qrot = (q, v, o) => { const x = q[0], y = q[1], z = q[2], w = q[3], vx = v[0], vy = v[1], vz = v[2]; const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx); o[0] = vx + w * tx + (y * tz - z * ty); o[1] = vy + w * ty + (z * tx - x * tz); o[2] = vz + w * tz + (x * ty - y * tx); return o; };
const qinvrot = (q, v, o) => qrot([-q[0], -q[1], -q[2], q[3]], v, o);
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
export const yawQuat = (psi, o = [0, 0, 0, 1]) => { o[0] = 0; o[1] = Math.sin(psi / 2); o[2] = 0; o[3] = Math.cos(psi / 2); return o; };
export function quatToYPR(q) { // yaw about Y, pitch about X, roll about Z (body), 'YXZ' order
  const x = q[0], y = q[1], z = q[2], w = q[3]; const m11 = 1 - 2 * (y * y + z * z), m13 = 2 * (x * z + y * w), m21 = 2 * (x * y + z * w), m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w), m33 = 1 - 2 * (x * x + y * y);
  const pitch = Math.asin(-Math.max(-1, Math.min(1, m23))); let yaw, roll; if (Math.abs(m23) < 0.9999) { yaw = Math.atan2(m13, m33); roll = Math.atan2(m21, m22); } else { yaw = Math.atan2(-2 * (x * z - y * w), m11); roll = 0; } return { yaw, pitch, roll };
}

const ZS = [-13.2, -10.3, -7.2, -3.6, 0, 3.6, 7.2, 10.4, 13.1], XI = [-0.75, -0.25, 0.25, 0.75];
export class FerryBody {
  constructor(heightFn, opt = {}) {
    this.h = heightFn; this.cgY = opt.cgY ?? -0.25; this.zeta = opt.zeta ?? 0.30;
    // ---- buoyancy columns
    this.cols = []; const Hc = 3.6;
    for (let j = 0; j < ZS.length; j++) {
      const z = ZS[j], lo = j === 0 ? -14 : (ZS[j - 1] + z) / 2, hi = j === ZS.length - 1 ? 14 : (z + ZS[j + 1]) / 2, dz = hi - lo, W = halfWidth(z);
      for (const xi of XI) { const x = xi * W; this.cols.push({ x, z, yb: bottomAt(Math.abs(x), z), a: dz * 0.5 * W, Hc, r: [0, 0, 0], p: [0, 0, 0], rb: [0, 0, 0] }); }
    }
    // ---- design draught -> mass and CG (LCB), inertias
    let V = 0, mz = 0; const y0 = HULL.DECK_H; for (const c of this.cols) { const d = Math.max(0, Math.min(c.Hc, 0 - (y0 + c.yb))); V += c.a * d; mz += c.a * d * c.z; }
    this.M = RHO * V; this.cg = [0, this.cgY, mz / V]; this.Vdisp = V; this.Awp = this.cols.reduce((s, c) => s + (0 - (y0 + c.yb) > 0 ? c.a : 0), 0);
    const M = this.M; this.mH = M * 1.35; this.mV = M * 1.55;
    this.I = [M * 7.0 * 7.0 * 1.5, M * 7.4 * 7.4 * 1.45, M * 3.4 * 3.4 * 1.25]; // pitch (X), yaw (Y), roll (Z)
    const kA = RHO * GRAV * this.Awp, cCrit = 2 * Math.sqrt(kA * this.mV); for (const c of this.cols) c.c = this.zeta * cCrit * c.a / this.Awp;
    // ---- state (CG)
    this.p = [0, y0 + this.cg[1], 0]; this.q = [0, 0, 0, 1]; this.v = [0, 0, 0]; this.wb = [0, 0, 0]; // wb: angular velocity in BODY frame
    this.F = [0, 0, 0]; this.T = [0, 0, 0]; this.psiRef = 0; this.t = 0; this.tmp = [0, 0, 0]; this.tmp2 = [0, 0, 0]; this.tmp3 = [0, 0, 0]; this.qt = [0, 0, 0, 1];
    this.thrust = 0; this.rudder = 0; this.slam = 0; this.bump = 0; this.lastPen = 0; this.contact = 0; this.fenderF = 0; this.ropeT = [0, 0, 0, 0];
    // horizontal hydrodynamics (surge / sway / yaw): linear + quadratic
    this.dU = [1.2e4, 9e2]; this.dS = [1.2e5, 2.6e4]; this.dR = [5e6, 2.5e6];
    // fender contact points (body coords, starboard side)
    this.fend = [-9, -4.5, 0, 4.5, 9, 12.4].map((z) => ({ b: [HULL.HB + 0.3, -0.35, z], r: [0, 0, 0], p: [0, 0, 0], v: [0, 0, 0] }));
    this.applyLever = opt.lever ?? -0.35; this.rollDamp = opt.rollDamp ?? 4e6; this.pitchDamp = opt.pitchDamp ?? 4.5e5;                           // propulsion/rudder force acts this far below the CG (m)
    this.mode = 'free';
  }
  /** place at rest on the surface at world (x,z) heading psi */
  reset(x, z, psi, t = 0) {
    this.q = yawQuat(psi); this.p[0] = x; this.p[2] = z; this.v.fill(0); this.wb.fill(0); this.t = t; this.p[1] = this.h(x, z, t) + HULL.DECK_H + this.cg[1];
    for (let i = 0; i < 200; i++) this._step(0.01, this.t, null, true); // settle (heave only) — stiff damping while settling
    this.v.fill(0); this.wb.fill(0);
  }
  /** deck origin O in world (out) and orientation */
  deckPos(o) { const r = qrot(this.q, [-this.cg[0], -this.cg[1], -this.cg[2]], this.tmp); o[0] = this.p[0] + r[0]; o[1] = this.p[1] + r[1]; o[2] = this.p[2] + r[2]; return o; }
  pointVel(bx, by, bz, o) { const q = this.q, wb = this.wb; const rb = this.tmp3; rb[0] = bx - this.cg[0]; rb[1] = by - this.cg[1]; rb[2] = bz - this.cg[2]; const wx = wb[1] * rb[2] - wb[2] * rb[1], wy = wb[2] * rb[0] - wb[0] * rb[2], wz = wb[0] * rb[1] - wb[1] * rb[0]; qrot(q, [wx, wy, wz], o); o[0] += this.v[0]; o[1] += this.v[1]; o[2] += this.v[2]; return o; }
  bodyToWorld(bx, by, bz, o) { const r = this.tmp; r[0] = bx - this.cg[0]; r[1] = by - this.cg[1]; r[2] = bz - this.cg[2]; qrot(this.q, r, o); o[0] += this.p[0]; o[1] += this.p[1]; o[2] += this.p[2]; return o; }
  forwardSpeed() { const psi = quatToYPR(this.q).yaw; return this.v[0] * -Math.sin(psi) + this.v[2] * -Math.cos(psi); }

  /** ctl: { ref:{x,z,psi,vx,vz,r} | null, moor:{lines:[{cb:[x,y,z], B:[x,y,z], L0, k}] } | null, quay:{nx,nz,off} | null, thrustMax } */
  step(dt, t, ctl) { const n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n; for (let i = 0; i < n; i++) this._step(h, t - dt + (i + 1) * h, ctl, false); this.t = t; }

  _addF(fx, fy, fz, rx, ry, rz) { const F = this.F, T = this.T; F[0] += fx; F[1] += fy; F[2] += fz; T[0] += ry * fz - rz * fy; T[1] += rz * fx - rx * fz; T[2] += rx * fy - ry * fx; }
  _step(dt, t, ctl, settle) {
    const F = this.F, T = this.T; F[0] = F[1] = F[2] = 0; T[0] = T[1] = T[2] = 0; const q = this.q, p = this.p, v = this.v, wb = this.wb, cg = this.cg;
    const r = this.tmp, pw = this.tmp2; let slamN = 0;
    // gravity
    F[1] -= this.M * GRAV;
    // buoyancy columns
    for (const c of this.cols) {
      r[0] = c.x - cg[0]; r[1] = c.yb - cg[1]; r[2] = c.z - cg[2]; qrot(q, r, c.r); const bx = p[0] + c.r[0], by = p[1] + c.r[1], bz = p[2] + c.r[2];
      const hw = this.h(bx, bz, t); let d = hw - by; if (d <= 0) continue; if (d > c.Hc) d = c.Hc;
      // vertical velocity of the point
      const wx = wb[1] * r[2] - wb[2] * r[1], wy = wb[2] * r[0] - wb[0] * r[2], wz = wb[0] * r[1] - wb[1] * r[0]; qrot(q, [wx, wy, wz], pw); const vy = v[1] + pw[1];
      let f = RHO * GRAV * c.a * d - c.c * vy * (settle ? 3 : 1); if (f < 0) f = 0; if (vy < -3.5 && d < 0.5) slamN += 1;
      this._addF(0, f, 0, c.r[0], c.r[1] + d * 0.5, c.r[2]);
    }
    if (!settle) {
      const psi = quatToYPR(q).yaw, fx = -Math.sin(psi), fz = -Math.cos(psi), rx = Math.cos(psi), rz = -Math.sin(psi);
      let u = v[0] * fx + v[2] * fz, s = v[0] * rx + v[2] * rz;
      // hydrodynamic drag (surge, sway) at the hull centre below CG
      let fu = -(this.dU[0] + this.dU[1] * Math.abs(u)) * u, fs = -(this.dS[0] + this.dS[1] * Math.abs(s)) * s;
      this._addF(fu * fx + fs * rx, 0, fu * fz + fs * rz, 0, this.applyLever, 0);
      // yaw drag torque (world Y)
      const wy = qrot(q, wb, this.tmp3)[1]; T[1] += -(this.dR[0] + this.dR[1] * Math.abs(wy)) * wy;
      // roll/pitch extra damping (bilge keels, skeg): small
      const wbq = this.tmp3; qrot(q, wb, wbq); T[0] += -this.pitchDamp * wbq[0]; T[2] += -this.rollDamp * wbq[2];
      if (ctl && ctl.ref) this._control(ctl.ref, ctl.thrustMax || 9e5, ctl.tight || 1);
      if (ctl && ctl.moor) this._moor(ctl.moor, t);
      if (ctl && ctl.quay) this._quay(ctl.quay, dt);
    }
    // ---- integrate
    const mH = this.mH, mV = this.mV; v[0] += F[0] / mH * dt; v[1] += F[1] / mV * dt; v[2] += F[2] / mH * dt;
    p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
    // angular: torque to body frame
    const tb = qinvrot(q, T, this.tmp); const I = this.I; const Iw = [I[0] * wb[0], I[1] * wb[1], I[2] * wb[2]];
    const cx = wb[1] * Iw[2] - wb[2] * Iw[1], cy = wb[2] * Iw[0] - wb[0] * Iw[2], cz = wb[0] * Iw[1] - wb[1] * Iw[0];
    wb[0] += (tb[0] - cx) / I[0] * dt; wb[1] += (tb[1] - cy) / I[1] * dt; wb[2] += (tb[2] - cz) / I[2] * dt;
    const qt = this.qt; qt[0] = wb[0] * dt * 0.5; qt[1] = wb[1] * dt * 0.5; qt[2] = wb[2] * dt * 0.5; qt[3] = 0; qmul(q, qt, qt); q[0] += qt[0]; q[1] += qt[1]; q[2] += qt[2]; q[3] += qt[3];
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
    this.slam = Math.max(this.slam * (1 - dt * 3), slamN);
  }
  _control(ref, fmax, tight) {
    const p = this.p, v = this.v, q = this.q, ypr = quatToYPR(q), psi = ypr.yaw; const M = this.mH;
    // position PD (world, horizontal): natural frequency 0.55 rad/s, damping 1.2
    const kp = 0.7 * tight, kd = 1.9;
    // deck-origin horizontal position (control point) so tracking is about the reference pose of the visual origin
    const O = this.deckPos(this.tmp2); let ex = ref.x - O[0], ez = ref.z - O[2];
    let ax = kp * ex + kd * ((ref.vx || 0) - v[0]) + (ref.ax || 0), az = kp * ez + kd * ((ref.vz || 0) - v[2]) + (ref.az || 0);
    // feed-forward for hull drag at the commanded velocity (so the PD only fights disturbances)
    const su = Math.hypot(ref.vx || 0, ref.vz || 0); if (su > 0.05) { const ff = (this.dU[0] + this.dU[1] * su) * su / M; ax += ff * (ref.vx / su); az += ff * (ref.vz / su); }
    let fx = M * ax, fz = M * az; const fl = Math.hypot(fx, fz); if (fl > fmax) { fx *= fmax / fl; fz *= fmax / fl; }
    this._addF(fx, 0, fz, 0, this.applyLever, 0); this.thrust = fl;
    // heading PD -> yaw torque (rudder / thrusters), clamped to authority
    const wy = qrot(q, this.wb, this.tmp3)[1]; const perr = wrapPi(ref.psi - psi); const Iy = this.I[1];
    let tz = Iy * (0.95 * perr * tight + 1.9 * ((ref.r || 0) - wy)); const lim = Iy * 0.26; if (tz > lim) tz = lim; else if (tz < -lim) tz = -lim; this.T[1] += tz; this.rudder = tz / lim;
  }
  _moor(m, t) {
    const q = this.q, cg = this.cg; const cw = this.tmp2, pv = this.tmp3;
    for (let i = 0; i < m.lines.length; i++) {
      const ln = m.lines[i]; if (ln.slack) { this.ropeT[i] = 0; continue; }
      this.bodyToWorld(ln.cb[0], ln.cb[1], ln.cb[2], cw); let dx = ln.B[0] - cw[0], dy = ln.B[1] - cw[1], dz = ln.B[2] - cw[2]; const d = Math.hypot(dx, dy, dz) || 1e-3; dx /= d; dy /= d; dz /= d;
      this.pointVel(ln.cb[0], ln.cb[1], ln.cb[2], pv); const rate = -(pv[0] * dx + pv[1] * dy + pv[2] * dz); // >0 when the line is lengthening
      const ext = d - ln.L0; let T = 0; if (ext > 0) { T = ln.k * ext + (rate > 0 ? ln.c * rate : 0); if (T > 2.2e6) T = 2.2e6; } this.ropeT[i] = T; ln.len = d;
      if (T > 0) this._addF(T * dx, T * dy, T * dz, cw[0] - this.p[0], cw[1] - this.p[1], cw[2] - this.p[2]);
    }
  }
  _quay(qy, dt) {
    let contact = 0, fsum = 0; const pw = this.tmp2, pv = this.tmp3;
    for (const f of this.fend) {
      this.bodyToWorld(f.b[0], f.b[1], f.b[2], pw); const pen = (pw[0] * qy.nx + pw[2] * qy.nz) - qy.off; if (pen <= 0) continue;
      this.pointVel(f.b[0], f.b[1], f.b[2], pv); const vn = pv[0] * qy.nx + pv[2] * qy.nz; let N = 6.5e5 * Math.min(pen, 0.5) + (vn > 0 ? 3.5e5 * vn : 0); fsum += N; contact++;
      const rx = pw[0] - this.p[0], ry = pw[1] - this.p[1], rz = pw[2] - this.p[2];
      // normal force pushes away from the quay, friction opposes tangential/vertical slip
      const tx = -qy.nz, tz = qy.nx; const vt = pv[0] * tx + pv[2] * tz; const mu = 0.35;
      this._addF(-N * qy.nx - mu * N * Math.sign(vt) * Math.min(1, Math.abs(vt) * 2) * tx, -mu * N * Math.max(-1, Math.min(1, pv[1] * 2)), -N * qy.nz - mu * N * Math.sign(vt) * Math.min(1, Math.abs(vt) * 2) * tz, rx, ry, rz);
      if (vn > this.bump) this.bump = vn;
    }
    this.contact = contact; this.fenderF = fsum;
  }
}
