// Real physics for the gondola: a 2-DOF (pitch theta, roll phi) spherical pendulum hanging from a moving grip.
//   bob = L * (sin th cos ph, -cos th cos ph, sin ph)   in the (h = heading, up, l = right) frame
//   th'' = (fx cos th + fy sin th)/(L cos ph) + 2 tan ph ph' th' - c th'
//   ph'' = (-fx sin th sin ph + fy cos th sin ph + fz cos ph)/L - th'^2 cos ph sin ph - c ph'
// f = g_vec - a_pivot + a_drag  (specific force on the cabin in the accelerating pivot frame). a_drag = 1/2 rho Cd A |v_rel| v_rel / m,
// v_rel = wind - v_cabin. Station guides can "hold" the cabin (spring-damper) while it is docked / in the terminal.
import * as THREE from 'three';
import { clamp, noise2, fbm2 } from '../../core/util.js';

export const G0 = 9.81;
const M4 = new THREE.Matrix4(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();

export class Pendulum {
  constructor({ L = 3.7, Lf = 4.45, zeta = 0.07, mass = 900, Af = 4.5, As = 5.2, Cdf = 0.65, Cds = 1.15, rho = 1.3, maxAngle = 0.62 } = {}) {
    Object.assign(this, { L, Lf, zeta, mass, Af, As, Cdf, Cds, rho, maxAngle });
    this.th = 0; this.ph = 0; this.thd = 0; this.phd = 0; this.psi = 0; this.psid = 0; this.thdd = 0; this.phdd = 0;
    this.kf = 0.5 * rho * Cdf * Af / mass; this.ks = 0.5 * rho * Cds * As / mass; this.w0 = Math.sqrt(G0 / L); this.c = 2 * zeta * this.w0;
    this.vbh = 0; this.vbl = 0; this.adh = 0; this.adl = 0; // last bob velocity / drag accel (for sounds)
  }
  reset() { this.th = this.ph = this.thd = this.phd = this.psi = this.psid = this.thdd = this.phdd = 0; }
  /** advance dt. a = pivot accel components (h,u,l), v = pivot velocity (h,l), w = wind velocity (h,l) scaled by exposure, hold 0..1 (guides) */
  step(dt, ah, au, al, vh, vl, wh, wl, hold = 0, torque = 0) {
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const sT = Math.sin(this.th), cT = Math.cos(this.th), sP = Math.sin(this.ph), cP = Math.cos(this.ph), L = this.L;
      const vbh = vh + L * (this.thd * cT * cP - this.phd * sT * sP), vbl = vl + L * this.phd * cP;
      const rh = wh - vbh, rl = wl - vbl, rm = Math.hypot(rh, rl);
      const adh = this.kf * rm * rh, adl = this.ks * rm * rl; this.vbh = vbh; this.vbl = vbl; this.adh = adh; this.adl = adl;
      const fx = -ah + adh, fy = -G0 - au, fz = -al + adl;
      let thdd = (fx * cT + fy * sT) / (L * cP) + 2 * Math.tan(this.ph) * this.phd * this.thd - this.c * this.thd;
      let phdd = (-fx * sT * sP + fy * cT * sP + fz * cP) / L - this.thd * this.thd * cP * sP - this.c * this.phd;
      if (hold > 0) { thdd -= hold * (55 * this.th + 12 * this.thd); phdd -= hold * (55 * this.ph + 12 * this.phd); }
      this.thdd = thdd; this.phdd = phdd;
      this.thd += thdd * h; this.phd += phdd * h; this.th += this.thd * h; this.ph += this.phd * h;
      if (Math.abs(this.th) > this.maxAngle) { this.th = Math.sign(this.th) * this.maxAngle; this.thd *= -0.3; }
      if (Math.abs(this.ph) > this.maxAngle) { this.ph = Math.sign(this.ph) * this.maxAngle; this.phd *= -0.3; }
      // torsion (yaw twist about the hanger): weak spring + damping, driven by gust torque
      const psidd = torque - 2.2 * this.psi - 0.55 * this.psid - hold * (30 * this.psi + 8 * this.psid); this.psid += psidd * h; this.psi += this.psid * h; this.psi = clamp(this.psi, -0.45, 0.45);
    }
  }
  /** world pose of the cabin floor centre + orientation for pivot p and horizontal heading (hx,hz) */
  pose(px, py, pz, hx, hz, outPos, outQuat) {
    const sT = Math.sin(this.th), cT = Math.cos(this.th), sP = Math.sin(this.ph), cP = Math.cos(this.ph);
    const dh = sT * cP, du = -cT * cP, dl = sP; const Dx = hx * dh - hz * dl, Dy = du, Dz = hz * dh + hx * dl;
    outPos.set(px + Dx * this.Lf, py + Dy * this.Lf, pz + Dz * this.Lf);
    const Ux = -Dx, Uy = -Dy, Uz = -Dz; const hu = hx * Ux + hz * Uz;
    let Fx = hx - hu * Ux, Fy = -hu * Uy, Fz = hz - hu * Uz; const fl = Math.hypot(Fx, Fy, Fz) || 1; Fx /= fl; Fy /= fl; Fz /= fl;
    let Rx = Fy * Uz - Fz * Uy, Ry = Fz * Ux - Fx * Uz, Rz = Fx * Uy - Fy * Ux;         // right = F x U
    const cp = Math.cos(this.psi), sp = Math.sin(this.psi);                               // twist about U
    const Fx2 = Fx * cp - Rx * sp, Fy2 = Fy * cp - Ry * sp, Fz2 = Fz * cp - Rz * sp, Rx2 = Rx * cp + Fx * sp, Ry2 = Ry * cp + Fy * sp, Rz2 = Rz * cp + Fz * sp;
    M4.makeBasis(V1.set(Rx2, Ry2, Rz2), V2.set(Ux, Uy, Uz), V3.set(-Fx2, -Fy2, -Fz2)); outQuat.setFromRotationMatrix(M4);
  }
}

// ------------------------------------------------------------------ wind field (world horizontal), advected gusts
export const WIND_DIR = [0.35, 0.94];    // blows TOWARDS (x,z)
export const wind = {
  mean: 8, gust: 0.4, t: 0,
  /** wind speed (m/s) at world position (x,z) and time t: mean * (1 + gust * turbulence); gusts are advected along the wind */
  speed(x, z, t, mean = this.mean, gust = this.gust) {
    const along = x * WIND_DIR[0] + z * WIND_DIR[1]; const u = mean * 1.0 + 1e-3;
    const n1 = noise2(along * 0.011 - t * 0.22 * (0.4 + mean * 0.03), 3.7 + t * 0.03) * 1.6;     // big gust fronts
    const n2 = noise2(along * 0.05 - t * 0.9, 11.1 + t * 0.2) * 0.9;                            // small-scale turbulence
    return Math.max(0.05 * mean, mean * (1 + gust * (n1 + 0.6 * n2)) + 0 * u);
  },
  /** direction wobble (radians) */
  wobble(x, z, t) { return noise2(x * 0.004 + t * 0.05, z * 0.004 - 2.2) * 0.35; },
};
