// Ambient gondola traffic: other cabins on the same haul rope and on the oncoming parallel rope (on our LEFT, ROPE_GAP away).
// Each cabin is a real (cheap) 2-DOF pendulum in the same wind field, so they sway and kick when they cross a tower.
// Rope speed = the player's speed while it rides that leg; parked at a station the whole line creeps at 0.5 m/s (the bullwheels keep turning slowly).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp, smoothstep } from '../../core/util.js';
import { sampleS, ROPE_GAP, stationRope } from './line.js';
import { CAB } from './cabin.js';
import { Pendulum, wind, WIND_DIR } from './pendulum.js';

const LO_DIST = 60;                                       // beyond this the cabin is drawn as the 330-tri silhouette
const SPACING = [128, 120, 150];                          // cabin spacing per leg (m)
export const LEG_WIND = [{ mean: 6, gust: 0.35 }, { mean: 10, gust: 0.4 }, { mean: 12.5, gust: 0.42 }];   // breezy / stormy / violent (gusts peak at ~1.5-1.9x the mean)
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
const mod = (a, n) => ((a % n) + n) % n;

export class Traffic {
  constructor(line, cab, parked = []) {
    this.line = line; this.group = new THREE.Group(); this.group.name = 'gondola-traffic'; this.cabins = []; this.phase = [0, 0, 0];
    this.meshes = this._buildMeshes(cab); this.lo = this._buildLo(cab);
    line.paths.forEach((path, k) => {
      const lo = path.gateOutS - 10, hi = path.gateInS + 10, len = hi - lo; const n = Math.max(2, Math.round(len / SPACING[k])); const gap = len / n;
      for (const dir of [1, -1]) for (let j = 0; j < n; j++) {
        const c = { k, dir, gap, lo, hi, len, off: j * gap + (dir < 0 ? gap * 0.37 : 0), pend: new Pendulum({ zeta: 0.03 + ((j * 7 + k) % 5) * 0.006 }), s: 0, lastS: -1, sc: 1 };
        c.pend.th = Math.sin(j * 2.1 + k) * 0.05; c.pend.ph = Math.cos(j * 1.3 + k * 2) * 0.05; this.cabins.push(c);
      }
    });
    // cabins riding the station loop (entry arm -> bullwheel wrap -> exit arm) at the bullwheel's creep speed: they wrap the wheel inside the terminals
    this.loops = [0, 1, 2].map((i) => { const pts = stationRope(i, 0.8), cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]));
      const prev = line.paths[(i + 2) % 3]; let seam = 0; for (let s2 = prev.gateInS - 2; s2 < prev.length; s2 += 0.8) seam++; const L = cum[cum.length - 1]; return { pts, cum, L, seamU: cum[Math.min(seam, cum.length - 1)], off: [0.12, 0.5, 0.8].map((f) => f * L), phase: 0 }; });
    this._still = new Pendulum(); this._still.th = this._still.ph = 0; this._still.psi = 0; this.nLoop = 9;
    this.parked = parked; const nm = this.cabins.length; this.parkedM = parked.map((pk) => { Q.setFromAxisAngle(P.set(0, 1, 0), pk.yaw); return new THREE.Matrix4().compose(P.set(pk.x, pk.y, pk.z), Q, S.set(1, 1, 1)); });      // parked spare cabins (station garages): appended after the live ones each frame
    this.nFixed = nm + parked.length; for (const m of [...this.meshes, ...this.lo]) { m.count = this.nFixed + this.nLoop; m.instanceMatrix.needsUpdate = true; this.group.add(m); }
  }
  _buildMeshes(cab) {
    const byMat = new Map();
    const add = (geo, mat, offset) => { const g = geo.clone(); if (offset) g.translate(offset.x, offset.y, offset.z); let e = byMat.get(mat); if (!e) byMat.set(mat, (e = { mat, geos: [] })); e.geos.push(g); };
    for (const p of cab.parts) add(p.geometry, p.material); for (const p of cab.doorParts) add(p.geometry, p.material, p.offset);
    const out = [];
    for (const { mat, geos } of byMat.values()) {
      const geo = mergeGeometries(geos, false); if (!geo) continue;
      const im = new THREE.InstancedMesh(geo, mat, 64); im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); out.push(im);
    }
    return out;
  }
  /** far-cabin silhouette (~330 tris, 4 draws instead of 18 draws / 9.6 k tris): red skirt, white roof + dome, dark window band with a lit strip, hanger + grip, marker lights.  Used beyond LO_DIST. */
  _buildLo(cab) {
    const by = {}; for (const p of cab.parts) by[p.material.name] = p.material; const { W, D, sill, glassTop: gt, hangerTop: top } = CAB;
    const bx = (sx, sy, sz, x, y, z) => { const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); g.translate(x, y, z); return g; };
    const dome = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed(); dome.scale(W * 0.5 + 0.02, 0.22, D * 0.5 + 0.02); dome.translate(0, gt + 0.085, 0);
    const hy = gt + 0.15, arm = new THREE.CylinderGeometry(0.05, 0.055, top - hy - 0.42, 6).toNonIndexed(); arm.translate(0, (top + hy - 0.42) / 2, 0);
    const parts = [[by.cabPaint, [bx(W, sill, D, 0, sill / 2, 0)]], [by.cabWhite, [bx(W + 0.06, 0.09, D + 0.06, 0, gt + 0.045, 0), dome]],
      [by.cabSteel, [bx(W - 0.06, gt - sill, D - 0.06, 0, (gt + sill) / 2, 0), bx(W * 0.6, 0.18, D * 0.5, 0, -0.34, 0), arm, bx(0.5, 0.12, 0.34, 0, hy - 0.05, 0), bx(0.22, 0.34, 0.5, 0, top - 0.26, 0), bx(0.16, 0.12, 0.62, 0, top - 0.02, 0)]],
      [by.cabLamp, [bx(W - 0.04, 0.07, D - 0.04, 0, gt - 0.06, 0), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => bx(0.09, 0.05, 0.09, sx * (W / 2 - 0.05), gt + 0.09, sz * (D / 2 - 0.05)))]]];
    const ref = cab.parts[0].geometry.attributes, out = []; for (const [mat, geos] of parts) { if (!mat) continue;
      const geo = mergeGeometries(geos.map((g) => { for (const k in ref) if (!g.attributes[k]) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * ref[k].itemSize).fill(1), ref[k].itemSize)); for (const k of Object.keys(g.attributes)) if (!ref[k]) g.deleteAttribute(k); return g; }), false);
      const im = new THREE.InstancedMesh(geo, mat, 96); im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.name = 'cab-lo'; out.push(im); }
    return out;
  }
  /** ride: {leg, v, s} of the player's cabin while it rides (leg = -1 when docked) */
  update(dt, t, ride) {
    const L = this.line; for (let k = 0; k < 3; k++) this.phase[k] += (ride.leg === k ? Math.max(0.5, ride.v) : 0.5) * dt;      // the rope creeps at 0.5 m/s when parked
    const cam0 = ride.cam, HI2 = LO_DIST * LO_DIST; let nh = 0, nl = 0;
    const put = (mm, x, z) => { if (cam0 && (x - cam0.x) * (x - cam0.x) + (z - cam0.z) * (z - cam0.z) > HI2) { for (const im of this.lo) im.setMatrixAt(nl, mm); nl++; } else { for (const im of this.meshes) im.setMatrixAt(nh, mm); nh++; } };
    for (const c of this.cabins) {
      const path = L.paths[c.k]; const u = mod(c.off + this.phase[c.k], c.len); const s = c.dir > 0 ? c.lo + u : c.hi - u; c.s = s;
      const T = sampleS(path, s); const hl = Math.hypot(T.tx, T.tz) || 1; const hx = T.tx / hl, hz = T.tz / hl;
      let px = T.x, py = T.y, pz = T.z; if (c.dir < 0) { px += hz * ROPE_GAP; pz -= hx * ROPE_GAP; }       // oncoming rope = our left
      const hh0 = c.dir > 0 ? hx : -hx, hh1 = c.dir > 0 ? hz : -hz, lx = -hh1, lz = hh0;                    // this cabin's heading / right
      if (c.lastS >= 0) for (const tw of path.towers) if ((c.lastS - tw.s) * (s - tw.s) < 0 && Math.abs(s - tw.s) < 8) { c.pend.thd += 0.15 * Math.sin(tw.s * 3.1 + c.off); c.pend.phd += 0.1 * Math.cos(tw.s * 1.7); }
      c.lastS = s;
      const v = ride.leg === c.k ? ride.v : 0.5; const wd = LEG_WIND[c.k]; const ws = wind.speed(px, pz, t, wd.mean, wd.gust); const wa = Math.atan2(WIND_DIR[1], WIND_DIR[0]) + wind.wobble(px, pz, t);
      const wx = Math.cos(wa) * ws, wz = Math.sin(wa) * ws; const wh = wx * hh0 + wz * hh1, wl = wx * lx + wz * lz;
      const v2 = v * v; c.pend.step(dt, (T.kx * hh0 + T.kz * hh1) * v2, T.ky * v2, (T.kx * lx + T.kz * lz) * v2, v, 0, wh, wl, 0, 0);
      c.pend.pose(px, py, pz, hh0, hh1, P, Q);
      let want = 1; const edge = Math.min(s - path.gateOutS, path.gateInS - s); if (edge < -6) want = 0;                 // vanish inside the terminals
      if (c.dir > 0 && ride.leg === c.k && Math.abs(s - ride.s) < 40) want = 0;                                       // never overlap the player's own cabin
      c.sc = damp(c.sc, want, 3, dt); const sc = c.sc < 0.02 ? 0 : c.sc; S.setScalar(sc);
      const cam = ride.cam; if (sc > 0 && cam && Math.hypot(P.x - cam.x, P.z - cam.z) > 520) continue;                 // beyond the fog: not drawn
      if (sc === 0) continue; M.compose(P, Q, S); put(M, P.x, P.z);
    }
    // station loops
    for (let i = 0; i < 3; i++) {
      const Lp = this.loops[i]; Lp.phase += 0.5 * dt; const hideDock = ride.near === i;
      for (let q = 0; q < 3; q++) {
        const u = mod(Lp.off[q] + Lp.phase, Lp.L); let j = 1; while (j < Lp.cum.length - 1 && Lp.cum[j] < u) j++; const a = Lp.pts[j - 1], b = Lp.pts[j], f = (u - Lp.cum[j - 1]) / Math.max(1e-3, Lp.cum[j] - Lp.cum[j - 1]);
        const dx = b[0] - a[0], dz = b[2] - a[2], dl = Math.hypot(dx, dz) || 1; const hx = dx / dl, hz = dz / dl;
        let want = smoothstep(9, 15, u) * smoothstep(9, 15, Lp.L - u); if (hideDock) want *= smoothstep(6, 11, Math.abs(u - Lp.seamU));      // fade in/out at the portals; make way for the player's cabin
        this._still.pose(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, hx, hz, P, Q); if (want < 0.02 || (ride.cam && Math.hypot(P.x - ride.cam.x, P.z - ride.cam.z) > 520)) continue; S.setScalar(want); M.compose(P, Q, S); put(M, P.x, P.z);
      }
    }
    for (let k = 0; k < this.parkedM.length; k++) { const pm = this.parkedM[k]; if (ride.cam && Math.hypot(pm.elements[12] - ride.cam.x, pm.elements[14] - ride.cam.z) > 300) continue; put(pm, pm.elements[12], pm.elements[14]); }
    for (const im of this.meshes) { im.count = nh; im.visible = nh > 0; im.instanceMatrix.needsUpdate = true; } for (const im of this.lo) { im.count = nl; im.visible = nl > 0; im.instanceMatrix.needsUpdate = true; }
  }
}
