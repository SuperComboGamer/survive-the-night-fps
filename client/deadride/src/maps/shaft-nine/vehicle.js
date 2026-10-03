// SHAFT NINE vehicle: the CAGE ELEVATOR. Steel mine cage (mesh sides, chequer floor, bonnet roof, crosshead + chains + two hoist ropes over the
// headframe sheaves) hanging on a stretching rope (1-DOF spring-damper with rope-length dependent stiffness), driven by a jerk-limited S-curve
// hoist profile with a creep + brake snap at the landing (=> the cage bounces on its rope), riding on guide rails with noise + rail-joint clack
// rattle, swinging lantern (pendulum driven by the cage's own accelerations), collapsible scissor gate + the stop's landing gates.
import * as THREE from 'three';
import { Vehicle } from '../../core/vehicle.js';
import { Builder } from '../../core/build.js';
import { std } from '../../core/mats.js';
import { signMaterial } from '../../core/canvas2d.js';
import { HaloBatch } from '../../core/glow.js';
import { clamp, lerp, noise2, makeRng, TAU, easeInOutCubic } from '../../core/util.js';
import { unifyPrograms, CAGE, SHAFT, SHEAVE_Y, OPEN, PI, meshMaterial, steelRawMat, cylBetween, signQuad } from './kit.js';
import { RAIL_X } from './shaft.js';
import { Parts, member, angle, gusset, bolt, slab, coil as coilP } from './parts.js';
import { bucket as bucketP, hardHat as hardHatP } from './parts2.js';
import { profL, profFlat, profCircle } from './rawgeo.js';

const G = 9.81, ROPE_X = 0.75, ROPE_Z = -0.05, SOCKET_Y = 5.62, SHEAVE_R = 2.55;
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S3 = new THREE.Vector3(), E = new THREE.Euler();

// ------------------------------------------------------------------ jerk-limited rest-to-creep S-curve
/** plan a move of distance D: accelerate (jerk jm, accel am) to peak <= vmax, cruise, decelerate to creep speed ve, creep `creep` m, brake snap. */
export function planMove(D, { vmax = 13, am = 1.3, jm = 0.9, ve = 0.4, creep = 1.1 } = {}) {
  const Dm = Math.max(0.5, D - creep);
  const sched = (dv) => { let Tj, Ta; if (dv * jm < am * am) { Tj = Math.sqrt(dv / jm); Ta = 0; } else { Tj = am / jm; Ta = dv / am - Tj; } return { Tj, Ta, T: 2 * Tj + Ta }; };
  const dist = (vp) => { const a = sched(vp), d = sched(Math.max(0, vp - ve)); return vp / 2 * a.T + (vp + ve) / 2 * d.T; };
  let vp = vmax; if (dist(vmax) > Dm) { let lo = ve + 0.01, hi = vmax; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (dist(mid) > Dm) hi = mid; else lo = mid; } vp = lo; }
  const a = sched(vp), d = sched(Math.max(0, vp - ve)); const Tv = Math.max(0, (Dm - dist(vp)) / vp);
  const ph = [[a.Tj, jm], [a.Ta, 0], [a.Tj, -jm], [Tv, 0], [d.Tj, -jm], [d.Ta, 0], [d.Tj, jm], [creep / ve, 0]];
  let s = 0, v = 0, ac = 0, t = 0; const st = [];
  for (const [dur, j] of ph) { st.push({ t0: t, dur, j, s0: s, v0: v, a0: ac }); s += v * dur + ac * dur * dur / 2 + j * dur ** 3 / 6; v += ac * dur + j * dur * dur / 2; ac += j * dur; t += dur; }
  const last = st[st.length - 1]; const T = t;
  // the last phase is creep at ve: fix state (numerical drift from the jerk phases)
  return {
    T, D, vp, ve, tv: Tv,
    eval(tt, out) {
      tt = clamp(tt, 0, T); let p = st[st.length - 1]; for (let i = 0; i < st.length; i++) if (tt <= st[i].t0 + st[i].dur) { p = st[i]; break; }
      const u = tt - p.t0; out.s = p.s0 + p.v0 * u + p.a0 * u * u / 2 + p.j * u ** 3 / 6; out.v = p.v0 + p.a0 * u + p.j * u * u / 2; out.a = p.a0 + p.j * u; return out;
    },
  };
}

export class CageElevator extends Vehicle {
  constructor(world, ctx) {
    super(world, { name: 'cage' }); this.ctx = ctx; this.frame.rotation.order = 'YXZ'; this.soundKey = 'cage';
    this.y = 0; this.d = 0; this.dd = 0; this.hoistY = 0; this.hoistV = 0; this.speed = 0; this.motion = null; this.dockStop = null; this.jx = 0; this.jvx = 0; this.jr = 0; this.jvr = 0; this.lastJoint = 0; this.jointSign = 1;
    this.swing = { ax: 0, vx: 0, az: 0, vz: 0 }; this.acc = { x: 0, y: 0, z: 0 }; this.sheaveRot = 0; this.pose = { x: 0, y: 0, z: 0, yaw: 0 }; this.fxT = 0; this.dustT = 0; this.driftK = 0; this.creakT = 0; this.lampPhase = 2;
    this.gateBars = null; this.k = 0; this.riding = false; this.setHidden(true);
    this._build(ctx); unifyPrograms(this.group);
    this.bounds = { minX: -CAGE.hx + 0.1, maxX: CAGE.hx - 0.1, minZ: -CAGE.hz + 0.1, maxZ: CAGE.hz - 0.12 }; this.floorY = 0;
    this.boardBox = { min: new THREE.Vector3(-1.35, 0, -1.0), max: new THREE.Vector3(1.35, 2.4, 1.0) };
  }
  setHidden(h) { this.group.visible = !h; }

  // ================================================================== geometry
  _build(ctx) {
    const VB = this.VB = new Builder({ synth: ctx.synth, group: this.frame, seed: 9 }); const hx = CAGE.hx, hz = CAGE.hz, H = CAGE.h;
    const paint = VB.m('cagePaint', { pattern: 'plates', size: 512, tile: 1.5, colors: [0x3d4640, 0x2d3631, 0x141a17], rustColor: 0x5a2e18, params: { cols: 2, rows: 2, seam: 0.01, rivets: 12, brushed: 0.2, panelVar: 0.4 }, bump: 3, metal: 1, rough: [0.4, 0.8], layers: { rust: 0.12, grime: 0.6, edge: 0.5, scratch: 0.4, streak: 0.4 } }, { breakup: 0.5 });
    const steel = steelRawMat(VB); const floorM = VB.m('cageFloor', { pattern: 'diamond', size: 512, tile: 1, colors: [0x55595c, 0x3f4346], params: { n: 14, height: 1, wear: 0.6 }, bump: 4, metal: 1, rough: [0.35, 0.7], layers: { rust: 0.25, grime: 0.55, scratch: 0.5 } });
    const hazard = VB.m('cageHazard', { pattern: 'hazard', size: 256, tile: 0.5, colors: [0xc8a020, 0x171717, 0x40382a], params: { n: 4, angle: 0, wear: 0.8 }, bump: 1, rough: [0.5, 0.9], layers: { grime: 0.5 } });
    const mesh = meshMaterial({ kind: 'diamond', cell: 0.05, wire: 3.4, tile: 0.4, color: '#5f666a' });
    const dark = VB.m('cageDark', std({ color: 0x0a0a0a, roughness: 0.8, key: 'cageDark' })); const brass = VB.m('cageBrass', std({ color: 0xa88235, metalness: 1, roughness: 0.35, key: 'cageBrass' }));
    const sigG = VB.m('cageSigG', std({ color: 0x000000, emissive: 0x30ff60, emissiveIntensity: 5, key: 'cageSigG' })), sigR = VB.m('cageSigR', std({ color: 0x000000, emissive: 0xff2a10, emissiveIntensity: 4, key: 'cageSigR' }));
    this.mats = { paint, steel, mesh, dark, brass, sigG, sigR };
    const box = (p, s, mat, o = {}) => VB.box({ p, s, mat, bevel: 0.008, cast: true, ...o });
    // ---- floor + underframe
    box([0, -0.1, 0], [2 * hx, 0.1, 2 * hz], floorM, { bevel: 0.004 }); box([0, -0.36, 0], [2 * hx + 0.14, 0.2, 2 * hz + 0.1], paint); box([0, -0.5, 0], [2 * hx - 0.3, 0.06, 2 * hz - 0.3], paint);
    for (const s of [-1, 1]) { box([s * (hx + 0.05), -0.36, 0], [0.09, 0.28, 2 * hz + 0.14], steel); for (const z of [-0.7, 0, 0.7]) box([s * (hx * 0.5), -0.28, z], [hx, 0.16, 0.1], steel); VB.cyl({ p: [s * 1.0, -0.72, 0.7], r: [0.12, 0.09], h: 0.22, seg: 12, mat: paint }); VB.cyl({ p: [s * 1.0, -0.72, -0.7], r: [0.12, 0.09], h: 0.22, seg: 12, mat: paint }); }
    // ---- corner posts, side walls: kick plate + mesh + rails
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box([sx * (hx - 0.04), 0, sz * (hz - 0.04)], [0.09, H, 0.09], paint, { bevel: 0.012 });
    for (const s of [-1, 1]) {
      box([s * (hx - 0.03), 0, 0], [0.04, 0.32, 2 * hz - 0.1], paint); box([s * (hx - 0.03), 0.3, 0], [0.012, H - 0.44, 2 * hz - 0.14], mesh, { bevel: 0, cast: false });
      box([s * (hx - 0.03), 1.0, 0], [0.07, 0.06, 2 * hz - 0.1], steel); box([s * (hx - 0.03), H - 0.1, 0], [0.07, 0.09, 2 * hz - 0.1], paint); box([s * (hx - 0.03), 0, 0], [0.06, H, 0.06], paint);
      // hand rail inside + guide shoes (arms to the rail + rollers)
      for (const y of [0.35, 2.25]) { box([s * (hx + 0.16), y - 0.1, 0], [0.34, 0.2, 0.32], paint); box([s * (hx + 0.32), y - 0.13, 0], [0.06, 0.26, 0.24], steel); for (const z of [-0.09, 0.09]) VB.cyl({ p: [s * (RAIL_X - 0.05), y, z], r: 0.045, h: 0.05, seg: 12, mat: steel, anchor: 'center', pitch: PI / 2 }); VB.cyl({ p: [s * (RAIL_X - 0.02), y, 0], r: 0.04, h: 0.08, seg: 10, mat: steel, anchor: 'center', roll: PI / 2 }); }
    }
    // ---- rear wall: solid lower panel (rivetted) + mesh + rails
    box([0, 0, -(hz - 0.03)], [2 * hx - 0.1, 1.05, 0.04], paint); box([0, 1.03, -(hz - 0.03)], [2 * hx - 0.1, 0.06, 0.07], steel); box([0, 1.08, -(hz - 0.03)], [2 * hx - 0.14, H - 1.2, 0.012], mesh, { bevel: 0, cast: false }); box([0, H - 0.1, -(hz - 0.03)], [2 * hx - 0.1, 0.09, 0.07], paint);
    for (const x of [-0.7, 0.7]) box([x, 0, -(hz - 0.03)], [0.06, H, 0.06], paint);
    // ---- front: gate frame (two side posts, header, threshold plate, hazard strip), fixed mesh wings
    for (const s of [-1, 1]) { box([s * 1.36, 0, hz - 0.05], [0.16, H - 0.08, 0.1], paint); box([s * 1.42, 0.3, hz - 0.03], [0.12, H - 0.5, 0.012], mesh, { bevel: 0, cast: false }); }
    box([0, H - 0.34, hz - 0.05], [2 * hx - 0.1, 0.24, 0.12], paint); box([0, 0.0, hz - 0.04], [2 * 1.3, 0.05, 0.09], steel); box([0, 0.0, hz + 0.02], [2 * 1.3, 0.012, 0.16], hazard, { bevel: 0.002, cast: false });
    box([0, H - 0.2, hz - 0.055], [2.6, 0.045, 0.05], steel);                                           // gate top track
    // ---- roof: gable bonnet + ribs + hatch, crosshead, capel, sockets
    VB.prism({ p: [0, H, 0], s: [2 * hx + 0.34, 0.36, 2 * hz + 0.34], mat: paint });
    for (const z of [-0.85, -0.28, 0.28, 0.85]) box([0, H - 0.1, z], [2 * hx - 0.1, 0.09, 0.07], steel, { cast: false });
    box([0, H + 0.34, 0], [0.7, 0.03, 0.7], paint, { cast: false }); box([0, H + 0.36, 0], [0.08, 0.05, 0.4], steel, { cast: false });
    box([0, H + 0.36, 0], [2.7, 0.2, 0.3], paint); for (const s of [-1, 1]) { box([s * 1.25, H + 0.2, 0], [0.24, 0.28, 0.36], steel); }
    box([0, SOCKET_Y - 0.3, ROPE_Z], [1.95, 0.16, 0.3], paint); for (const s of [-1, 1]) { VB.cyl({ p: [s * ROPE_X, SOCKET_Y - 0.22, ROPE_Z], r: [0.1, 0.055], h: 0.26, seg: 12, mat: steel }); VB.cyl({ p: [s * ROPE_X, SOCKET_Y - 0.04, ROPE_Z], r: 0.03, h: 0.1, seg: 8, mat: steel }); box([s * 0.98, SOCKET_Y - 0.5, ROPE_Z], [0.16, 0.24, 0.28], steel); }
    // ---- chains (instanced torus links), bell rope, signal panel, signs, extinguisher, phone box
    this._chains(VB);
    const rope = VB.cyl({ p: [-1.1, 1.35, -(hz - 0.1)], r: 0.011, h: 1.1, seg: 5, mat: dark, cast: false }); VB.cyl({ p: [-1.1, 1.25, -(hz - 0.1)], r: 0.03, h: 0.15, seg: 8, mat: brass, cast: false });
    box([1.0, 1.28, -(hz - 0.05)], [0.34, 0.24, 0.06], dark, { cast: false }); VB.sphere({ p: [0.93, 1.34, -(hz - 0.085)], r: 0.022, seg: 8, mat: sigG, cast: false }); VB.sphere({ p: [1.03, 1.34, -(hz - 0.085)], r: 0.022, seg: 8, mat: sigR, cast: false }); VB.cyl({ p: [1.07, 1.24, -(hz - 0.085)], r: 0.028, h: 0.03, seg: 10, mat: brass, pitch: PI / 2, anchor: 'center', cast: false });
    signQuad(VB, signMaterial({ lines: ['No.1 CAGE', 'MAX 14 MEN  ·  NO LEANING'], bg: '#c9a227', fg: '#191919', w: 512, h: 128, weather: 0.9, rough: 0.5 }), [0, 1.55, -(hz - 0.075)], 0.9, 0.24, PI);
    VB.cyl({ p: [-1.3, 0.36, -(hz - 0.13)], r: 0.06, h: 0.42, seg: 12, mat: VB.m('cageExt', std({ color: 0xb02018, metalness: 0.4, roughness: 0.45, key: 'cageExt' })), cast: false }); VB.cyl({ p: [-1.3, 0.78, -(hz - 0.13)], r: 0.022, h: 0.06, seg: 8, mat: steel, cast: false });
    // ---- real construction details (parts.js): riveted corner angles, seam straps with rivet rows, knee braces with gussets, shoe bolts, crosshead bolts, a hard hat, a bucket and a coiled rope on the floor
    { const PV = new Parts(VB, makeRng(77)), RV = PV.rnd; const angP = (mirror) => { const p = profL(0.075, 0.009); return mirror ? p.map((q) => [-q[0], q[1]]).reverse() : p; };
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const x = sx * (hx + 0.006), z = sz * (hz + 0.006); member(PV, steel, [x, -0.32, z], [x, H + 0.02, z], angP(sx * sz > 0), { up: [0, 0, -sz], step: 6 });
        for (let y = -0.28; y < H; y += 0.14) { PV.of(steel, false).dome(x - sx * 0.032 + sx * 0.0, y, z + sz * 0.0095, 0, 0, sz, 0.0062, 5); PV.of(steel, false).dome(x + sx * 0.0095, y + 0.07, z - sz * 0.032, sx, 0, 0, 0.0062, 5); } }
      for (const x of [-1.0, -0.33, 0.33, 1.0]) { member(PV, steel, [x, 0.02, -(hz - 0.03) - 0.024], [x, 1.03, -(hz - 0.03) - 0.024], profFlat(0.07, 0.006), { up: [0, 0, -1], step: 3, cast: false }); for (let y = 0.06; y < 1.02; y += 0.11) PV.of(steel, false).dome(x, y, -(hz - 0.03) - 0.03, 0, 0, -1, 0.0058, 5); }
      for (const y of [0.34, 0.7]) member(PV, steel, [-(hx - 0.13), y, -(hz - 0.03) - 0.024], [hx - 0.13, y, -(hz - 0.03) - 0.024], profFlat(0.06, 0.006), { up: [0, 0, -1], step: 3, cast: false });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const px = sx * (hx - 0.1), pz = sz * (hz - 0.06); angle(PV, steel, [px, H - 0.68, pz], [sx * (hx - 0.62), H - 0.1, pz], 0.06, 0.007, { step: 3, cast: false }); gusset(PV, paint, steel, [sx * (hx - 0.16), H - 0.62, pz + sz * 0.012], [-sx, 0, 0], [0, 1, 0], 0.26, 0.008); }
      for (const s of [-1, 1]) for (const y of [0.35, 2.25]) for (const z of [-0.09, 0.09]) bolt(PV, steel, [s * (hx + 0.35), y - 0.13 + (z > 0 ? 0.06 : -0.06), z], [s, 0, 0], 1.0);
      for (const s of [-1, 1]) for (const dz of [-0.11, 0.11]) for (const dy of [0.18, 0.5]) bolt(PV, steel, [s * (1.25 + 0.0), H + 0.36 + 0.101, dz * 0.0 + dz], [0, 1, 0], 1.0);
      hardHatP(PV, VB.m('cageHat', std({ color: 0x6a4e12, roughness: 0.5 })), [1.12, 0.005, -0.86], { yaw: 0.6 }); bucketP(PV, steel, dark, [-1.2, 0.005, -0.82], { yaw: 0.3 }); coilP(PV, dark, [0.25, 0.005, -0.88], 0.22, 0.018, 4, 0.2);
      PV.flush(); }
    // ---- gate meshes (instanced bars + rivets), lantern, halo, light
    this._gate(steel);
    this._lantern(VB, brass); this._depthGauge(VB);
    VB.finish();
    // ---- ropes (world space group) + strobe light + lantern light
    const ropeMat = std({ color: 0x24262a, metalness: 0.9, roughness: 0.42, key: 'cageRope', frag: `{ float ang = atan(vWN.z, vWN.x); float st = 0.5 + 0.5 * sin(ang * 6.0 + vWPos.y * 16.0); diffuseColor.rgb *= 0.5 + 0.7 * st; roughnessFactor = mix(0.7, 0.28, st); }` }); const rg = new THREE.CylinderGeometry(0.02, 0.02, 1, 12); rg.translate(0, 0.5, 0);
    this.ropes = [-1, 1].map((s) => { const m = new THREE.Mesh(rg, ropeMat); m.frustumCulled = false; m.castShadow = false; this.group.add(m); return { m, x: s * ROPE_X }; });
    const gfx = ctx.gfx; this.lampLight = gfx.addLight({ kind: 'point', pos: new THREE.Vector3(), color: 0xffa64a, intensity: 5.0, distance: 8, decay: 2, flicker: 0.04, flickerSpeed: 11, priority: 2.5, enabled: true });
    this.strobe = gfx.addLight({ kind: 'point', pos: new THREE.Vector3(), color: 0xffa850, intensity: 0, distance: 9, decay: 2, priority: 1.5, enabled: true });
    // ---- colliders (frame-local): walls + front gate
    const C = this.colliders; C.groundY = 0;
    C.addBox({ x: -hx, y: 1.2, z: 0, hx: 0.05, hy: 1.3, hz: hz, surface: 'metal', walk: false }); C.addBox({ x: hx, y: 1.2, z: 0, hx: 0.05, hy: 1.3, hz: hz, surface: 'metal', walk: false }); C.addBox({ x: 0, y: 1.2, z: -hz, hx: hx, hy: 1.3, hz: 0.05, surface: 'metal', walk: false });
    this.gateCol = C.addBox({ x: 0, y: 1.2, z: hz - 0.05, hx: 1.4, hy: 1.3, hz: 0.04, surface: 'metal', walk: false, solid: true });
    this.applyDoors(0);
  }
  _chains(VB) {
    const geo = new THREE.TorusGeometry(0.034, 0.0105, 6, 12); const mat = std({ color: 0x3a3d40, metalness: 1, roughness: 0.4, key: 'cageChain' }); const list = [];
    for (const sx of [-1, 1]) for (const dz of [-0.16, 0.16]) {
      const a = new THREE.Vector3(sx * 1.22, CAGE.h + 0.5, dz), b = new THREE.Vector3(sx * ROPE_X * 1.05, SOCKET_Y - 0.4, ROPE_Z + dz * 0.6); const L = a.distanceTo(b), n = Math.floor(L / 0.058); const dir = b.clone().sub(a).normalize();
      for (let i = 0; i < n; i++) { const p = a.clone().addScaledVector(dir, (i + 0.5) * L / n); Q.setFromUnitVectors(V.set(0, 1, 0), dir); const twist = new THREE.Quaternion().setFromAxisAngle(dir, i % 2 ? PI / 2 : 0); Q.premultiply(twist); const m = new THREE.Matrix4().compose(p, Q.clone(), new THREE.Vector3(1, 1.6, 1)); list.push(m); }
    }
    const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.frustumCulled = false; this.frame.add(im);
  }
  _gate(steel) {
    const R = 3, N = 4, per = R * N; this.gateN = N; this.gateR = R;
    this.barGeo = new THREE.BoxGeometry(1, 1, 1); const gm = std({ color: 0x6e7378, metalness: 0.95, roughness: 0.42, key: 'cageGateBar' });
    this.gateBars = new THREE.InstancedMesh(this.barGeo, gm, per * 2 * 2); this.gateBars.castShadow = true; this.gateBars.frustumCulled = false; this.frame.add(this.gateBars);
    const rg = new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8); rg.rotateX(PI / 2); this.gateRivets = new THREE.InstancedMesh(rg, gm, (per + R * 2) * 2 + 4); this.gateRivets.frustumCulled = false; this.frame.add(this.gateRivets);
    this.gateK = -1;
  }
  _updateGate(k) {
    if (Math.abs(k - this.gateK) < 1e-4) return; this.gateK = k; const N = this.gateN, R = this.gateR; const hr = 2.08 / R, y0 = 0.1, wmax = 1.3 / N, wmin = 0.052, w = lerp(wmax, wmin, easeInOutCubic(k)); let bi = 0, ri = 0; const zA = CAGE.hz - 0.07, zB = CAGE.hz - 0.045;
    const put = (ax, ay, bx, by, z) => { const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); Q.setFromAxisAngle(V.set(0, 0, 1), Math.atan2(dy, dx)); M4.compose(V2.set((ax + bx) / 2, (ay + by) / 2, z), Q, S3.set(L + 0.03, 0.034, 0.014)); this.gateBars.setMatrixAt(bi++, M4); };
    const rivet = (x, y, z) => { M4.compose(V2.set(x, y, z), Q.identity(), S3.set(1, 1, 1)); this.gateRivets.setMatrixAt(ri++, M4); };
    for (const s of [-1, 1]) {
      for (let r = 0; r < R; r++) for (let i = 0; i < N; i++) {
        const xa = s * (1.3 - i * w), xb = s * (1.3 - (i + 1) * w), ya = y0 + r * hr, yb = ya + hr;
        put(xa, ya, xb, yb, zA); put(xa, yb, xb, ya, zB); rivet((xa + xb) / 2, (ya + yb) / 2, (zA + zB) / 2);
        if (i > 0) { rivet(xa, ya, zA); rivet(xa, yb, zA); }
      }
    }
    for (; bi < this.gateBars.count;) { M4.makeScale(0, 0, 0); this.gateBars.setMatrixAt(bi++, M4); } for (; ri < this.gateRivets.count;) { M4.makeScale(0, 0, 0); this.gateRivets.setMatrixAt(ri++, M4); }
    this.gateBars.instanceMatrix.needsUpdate = true; this.gateRivets.instanceMatrix.needsUpdate = true;
  }
  /** depth counter above the rear wall (canvas texture redrawn when the metre changes) + brass capacity plate */
  _depthGauge(VB) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96; this.depthCtx = c.getContext('2d'); const tex = this.depthTex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; this._depthShown = -1;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.3, color: 0x0d0d0b, roughness: 0.5 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.19), mat); m.position.set(-0.55, 2.02, -CAGE.hz + 0.045); this.frame.add(m); this._updateDepth();
    signQuad(VB, signMaterial({ lines: ['MAX 12 MEN', '2400 KG'], bg: '#a88235', fg: '#1a1408', w: 256, h: 96, weather: 0.6 }), [0.55, 2.02, -CAGE.hz + 0.04], 0.5, 0.19, 0);
  }
  _updateDepth() {
    const d = Math.max(0, Math.round(-this.y)); if (d === this._depthShown) return; this._depthShown = d; const g = this.depthCtx; g.fillStyle = '#0a0906'; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#5a4520'; g.lineWidth = 4; g.strokeRect(3, 3, 250, 90);
    g.fillStyle = '#c07a20'; g.font = 'bold 20px monospace'; g.textAlign = 'center'; g.fillText('DEPTH', 128, 26); g.fillStyle = '#ffb040'; g.font = 'bold 50px monospace'; g.fillText(d + ' m', 128, 76); this.depthTex.needsUpdate = true;
  }
  _lantern(VB, brass) {
    const g = this.lantern = new THREE.Group(); g.position.set(0.0, CAGE.h - 0.02, 0.12); this.frame.add(g);
    const glass = new THREE.MeshStandardMaterial({ color: 0x1a1006, emissive: 0xffa850, emissiveIntensity: 2.2, roughness: 0.2 }); this.lanternGlass = glass; const metal = std({ color: 0x24211d, metalness: 1, roughness: 0.5, key: 'lanternMetal' });
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = false; g.add(o); return o; };
    add(new THREE.CylinderGeometry(0.0035, 0.0035, 0.2, 5), metal, 0, -0.1, 0); add(new THREE.TorusGeometry(0.02, 0.005, 6, 10), metal, 0, -0.21, 0);
    add(new THREE.CylinderGeometry(0.05, 0.075, 0.03, 12), metal, 0, -0.26, 0); add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 12, 1, true), glass, 0, -0.38, 0); add(new THREE.SphereGeometry(0.045, 10, 8), glass, 0, -0.38, 0);
    add(new THREE.CylinderGeometry(0.07, 0.06, 0.03, 12), metal, 0, -0.49, 0); for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; add(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 4), metal, Math.cos(a) * 0.065, -0.38, Math.sin(a) * 0.065); }
    add(new THREE.ConeGeometry(0.085, 0.06, 12), metal, 0, -0.235, 0);
    this.halo = new HaloBatch(4); this.frame.add(this.halo.mesh); this.halo.add([0, CAGE.h - 0.4, 0.12], 0xffa850, 0.2, 0.32, 6);
  }

  // ================================================================== poses
  stationPose(stop, out = this.pose) { const s = stop.station || { pos: [0, 0, 0], yaw: 0 }; out.x = stop.origin.x + s.pos[0]; out.y = stop.origin.y + s.pos[1]; out.z = stop.origin.z + s.pos[2]; out.yaw = s.yaw || 0; return out; }
  place(x, y, z, yaw) { this.pose.x = x; this.pose.z = z; this.pose.yaw = yaw; this.y = y; this.hoistY = y; this.d = 0; this.dd = 0; this.hoistV = 0; this._apply(0, 0); this.group.updateMatrixWorld(true); }
  _apply() {
    const P = this.pose, f = this.frame; f.position.set(P.x + this.jx + this.latN, this.y, P.z); f.rotation.set(this.pitchN, P.yaw, this.rollN + this.jr, 'YXZ');
    const top = this.y + SOCKET_Y; for (const r of this.ropes) { const len = Math.max(0.1, SHEAVE_Y - top); r.m.position.set(P.x + r.x, top, P.z + ROPE_Z); r.m.scale.set(1, len, 1); const tt = performance.now() * 0.001, sp = Math.min(1.2, this.speed / 10); r.m.rotation.set(0.0005 * Math.sin(tt * 5.3 + r.x * 4) * sp, 0, -this.jx * 0.03 + 0.0007 * Math.sin(tt * 7.1 + r.x * 3) * sp); }
  }
  get exitPoint() { this.frame.updateWorldMatrix(true, false); return V.set(0, 0, CAGE.hz + 2.2).applyMatrix4(this.frame.matrixWorld).clone().setY(this.pose.y); }

  // ================================================================== doors (scissor gate + landing gates + colliders + bounds)
  applyDoors(k) {
    this._updateGate(k); this.k = k; const open = k > 0.55; if (this.gateCol) this.gateCol.solid = !open;
    this.bounds.maxZ = open && this.state === 'open' ? CAGE.hz + 1.5 : CAGE.hz - 0.12;
    const L = this.dockStop?.data?.landing; if (L) L.setOpen(k);
    this.lanternGlass.emissiveIntensity = 2.2;
  }

  // ================================================================== motion
  _hoist(yTarget, plan, { progress = null, first = false } = {}) {
    return new Promise((res) => {
      const y0 = this.hoistY; const dir = Math.sign(yTarget - y0) || 1; const D = Math.abs(yTarget - y0);
      this.motion = { y0, dir, plan, t: 0, res, progress, D, ev: { s: 0, v: 0, a: 0 }, started: false };
    });
  }
  _rope() { const L = Math.max(24, SHEAVE_Y - (this.y + SOCKET_Y)); return { L, w: clamp(8 * Math.sqrt(100 / L), 3.6, 14) }; }

  simulate(dt, time) {
    if (!this.group.visible) { this.speed = 0; return; }
    const m = this.motion; let pAcc = 0, v = 0;
    if (m) {
      m.t += dt; const e = m.plan.eval(m.t, m.ev); this.hoistY = m.y0 + m.dir * e.s; v = m.dir * e.v; pAcc = m.dir * e.a;
      if (!m.started) { m.started = true; this.dd -= m.dir * 0.26; this.emit('start', { dir: m.dir }); }
      if (m.progress) m.progress(clamp(e.s / m.D));
      if (m.t >= m.plan.T) { this.motion = null; this.dd += m.dir * m.plan.ve; v = 0; this.emit('stop', { speed: m.plan.ve }); this.creakT = 0; m.res(); }
    }
    // rope spring: d'' = -w^2 d - 2 z w d' - p''   (d = deviation of the cage from its moving equilibrium)
    const { w } = this._rope(); const zeta = 0.055, n = 3, h = dt / n; const w2 = w * w;
    for (let i = 0; i < n; i++) { this.dd += (-w2 * this.d - 2 * zeta * w * this.dd - pAcc) * h; this.d += this.dd * h; }
    if (!this.motion && Math.abs(this.d) < 2e-4 && Math.abs(this.dd) < 1e-3) { this.d = 0; this.dd = 0; }
    const yPrev = this.y; this.y = this.hoistY + this.d; this.hoistV = v; this.speed = Math.abs(v); const vy = (this.y - yPrev) / Math.max(dt, 1e-4);
    this.acc.y = pAcc + (-w2 * this.d - 2 * zeta * w * this.dd);
    // guide-rail rattle: broadband noise scaled with speed + rail-joint clack every 9.14 m
    const sp = clamp(this.speed / 12, 0, 1.7), t = time;
    this.latN = 0.0038 * sp * (noise2(t * 2.7, 3.3) * 0.7 + noise2(t * 6.1, 8.1) * 0.3);
    this.rollN = 0.0026 * sp * noise2(t * 8.3, 1.9) + 0.0008 * sp * noise2(t * 19, 5.5); this.pitchN = 0.0019 * sp * noise2(t * 6.9, 4.4);
    const joint = Math.floor((this.y + 1000) / 9.14); if (joint !== this.lastJoint && this.speed > 0.6) { this.lastJoint = joint; this.jointSign = -this.jointSign; const a = clamp(this.speed / 10, 0.2, 1.4); this.jvx += this.jointSign * 0.11 * a; this.jvr += -this.jointSign * 0.16 * a; this.emit('bump', { kind: 'joint', speed: this.speed, strength: clamp(this.speed / 9, 0.25, 1.15) }); const fx = this.ctx.fx; if (fx && this.speed > 2 && Math.abs(this.ctx.gfx.camera.position.y - this.y) < 30) { for (let i = 0; i < 4; i++) { V.set(this.pose.x + (Math.random() - 0.5) * 3.2, this.y + 2.6 + Math.random() * 0.8, this.pose.z + (Math.random() - 0.5) * 2.2); V2.set(0, -1, 0); fx.puff(V, V2, 1, { speed: 0.6, size: [0.06, 0.24], life: 1.3, color: [0.55, 0.48, 0.4, 0.4], rise: -0.35, cell: 9, drag: 1.0, grav: 0.5 }); } } } else this.lastJoint = joint;
    { const wj = 42, zj = 0.16; for (let i = 0; i < 2; i++) { const hh = dt / 2; this.jvx += (-wj * wj * this.jx - 2 * zj * wj * this.jvx) * hh; this.jx += this.jvx * hh; this.jvr += (-wj * wj * this.jr - 2 * zj * wj * this.jvr) * hh; this.jr += this.jvr * hh; } this.jx = clamp(this.jx, -0.02, 0.02); this.jr = clamp(this.jr, -0.01, 0.01); }
    this._apply();
    // lantern pendulum (length 0.4 m) driven by the frame's own accelerations (ax from rattle + gravity direction changes with vertical accel)
    this._lantern_update(dt, time);
    // sheave wheels on the headframe: rotate with rope speed (positive = descending)
    const surf = this.world.stops[0]?.data; if (surf?.sheaves) { const dth = -(this.y - yPrev) / SHEAVE_R; for (const wch of surf.sheaves.children) wch.rotation.x += dth; }
    this._lights(dt, time); this._fx(dt, time, vy); this._depthT = (this._depthT || 0) - dt; if (this._depthT < 0) { this._depthT = 0.2; this._updateDepth(); }
    if (this.speed > 2 && (this.creakT -= dt) < 0) { this.creakT = 1.6 + Math.random() * 3.4; this.emit('creak', { speed: this.speed }); }
  }
  _lantern_update(dt, time) {
    const s = this.swing, L = 0.4, g = G; const ax = this.accelLocal.x, az = this.accelLocal.z; const ay = this.accelLocal.y;
    const geff = g + clamp(ay, -6, 6);                                          // vertical acceleration changes effective gravity => period changes
    const wn2 = geff / L, c = 1.4; const n = 2, h = dt / n;
    for (let i = 0; i < n; i++) {
      s.vx += (-wn2 * s.ax - c * s.vx - clamp(az, -8, 8) / L) * h; s.ax += s.vx * h; s.vz += (-wn2 * s.az - c * s.vz + clamp(ax, -8, 8) / L) * h; s.az += s.vz * h;
    }
    s.ax = clamp(s.ax, -0.5, 0.5); s.az = clamp(s.az, -0.5, 0.5); this.lantern.rotation.set(s.ax, 0, s.az);
    // lantern bulb position (frame-local via the lantern's own matrix) -> pooled light + halo
    this.lantern.updateMatrix(); V.set(0, -0.38, 0).applyMatrix4(this.lantern.matrix); this.frame.updateWorldMatrix(true, false); V2.copy(V).applyMatrix4(this.frame.matrixWorld);
    this.lampLight.pos.copy(V2); this.halo.pos.setXYZ(0, V.x, V.y, V.z); this.halo.pos.needsUpdate = true;
  }
  _lights(dt, time) {
    // strobing shaft lamp: one light snaps to the nearest wall lamp (grid y = 2 + 8k on the rear wall), intensity windowed by distance => flashes past at speed
    const every = 8, yc = this.y + 1.7, k = Math.round((yc - 2) / every), yl = 2 + k * every, d = Math.abs(yl - yc), wnd = Math.max(0, 1 - (d / 2.6) ** 2);
    let nearStation = 99; for (const st of this.world.stops) nearStation = Math.min(nearStation, Math.abs(this.y - st.origin.y));
    const fade = clamp((nearStation - 6) / 5, 0, 1) * clamp(this.speed / 3, 0, 1);
    this.strobe.pos.set(this.pose.x + (k & 1 ? 0.75 : -0.75), yl - 0.05, this.pose.z - 1.2); this.strobe.intensity = 22 * wnd * wnd * fade;
  }
  _fx(dt, time, vy) {
    const fx = this.ctx.fx; if (!fx) return; const camY = this.ctx.gfx.camera.position.y; if (Math.abs(camY - this.y) > 40) return;
    // world-fixed dust motes that the cage rushes past (speed cue), falling grit at the start/stop, sparks from the guide shoes at speed
    this.dustT -= dt; if (this.speed > 1.5 && this.dustT < 0) { this.dustT = 0.035; for (let i = 0; i < 2; i++) { const sx = Math.random() < 0.5 ? -1 : 1; fx.alpha.emit({ p: [this.pose.x + sx * (1.65 + Math.random() * 0.4), this.y + 0.5 + Math.random() * 3.5 + Math.sign(vy) * 4, this.pose.z + (Math.random() - 0.5) * 2.6], v: [0, 0, 0], life: 2.2, size: [0.012, 0.03], c0: [0.6, 0.5, 0.38, 0.35], c1: [0.6, 0.5, 0.38, 0], cell: 9, drag: 0 }, fx.time); } }
    this.fxT -= dt; if (this.speed > 7 && this.fxT < 0) { this.fxT = 0.05 + Math.random() * 0.22; const s = Math.random() < 0.5 ? -1 : 1; V.set(this.pose.x + s * (RAIL_X - 0.04), this.y + (Math.random() < 0.5 ? 0.35 : 2.25), this.pose.z); V2.set(-s * 0.3, -Math.sign(vy) * 0.6 + 0.4, 0.0); fx.spark(V, V2, 5, 3.6, 0.012, [1, 0.7, 0.3], 0.4); }
    if (this.motion && this.motion.t < 1.4 && Math.random() < dt * 14) { V.set(this.pose.x + (Math.random() - 0.5) * 2.6, this.y + CAGE.h + 0.4, this.pose.z + (Math.random() - 0.5) * 1.8); V2.set(0, -1, 0); fx.puff(V, V2, 2, { speed: 0.4, size: [0.05, 0.18], life: 1.4, color: [0.55, 0.48, 0.4, 0.35], rise: -0.3, cell: 9, drag: 1.2, grav: 0.4 }); }
  }

  // ================================================================== lifecycle
  update(dt, time) { this._updates = (this._updates || 0) + 1; super.update(dt, time); }
  async arrive(stop) {
    if (!this._updates) { this.snapDocked(stop); return; }               // not being simulated yet (test sandboxes): dock instantly
    const P = this.stationPose(stop, { x: 0, y: 0, z: 0, yaw: 0 }); this.dockStop = stop; this.state = 'arriving'; this.stopIndex = stop.index; this.setHidden(false); this.setDoors(0);
    const fromBelow = stop.index === 0; const y0 = P.y + (fromBelow ? -26 : 26); this.place(P.x, y0, P.z, P.yaw); this.latN = this.rollN = this.pitchN = 0; this.frame.updateMatrixWorld(true);
    await this._hoist(P.y, planMove(26, { vmax: 6, am: 0.9, jm: 0.7, ve: 0.35, creep: 0.9 }));
    await this.wait(0.35); await this.openDoors(1.7); this.state = 'open'; this.setDoors(1); this.emit('arrived', { stop: stop.index });
  }
  snapDocked(stop) { const P = this.stationPose(stop, { x: 0, y: 0, z: 0, yaw: 0 }); this.dockStop = stop; this.setHidden(false); this.place(P.x, P.y, P.z, P.yaw); this.latN = this.rollN = this.pitchN = 0; this.state = 'open'; this.stopIndex = stop.index; this.setDoors(1); this.frame.updateMatrixWorld(true); }
  async ride(fromStop, toStop, hooks = {}) {
    const A = this.stationPose(fromStop, { x: 0, y: 0, z: 0, yaw: 0 }), Bp = this.stationPose(toStop, { x: 0, y: 0, z: 0, yaw: 0 }); this.riding = true;
    if (!this.group.visible || Math.abs(this.y - A.y) > 2) this.snapDocked(fromStop);
    this.state = 'closing'; await this.closeDoors(1.7); this.state = 'riding'; this.emit('signal', { bell: 3 }); fromStop.data?.ringBell?.(1); await this.wait(1.0);
    const D = Math.abs(Bp.y - A.y); const long = D > 200; const plan = planMove(D, long ? { vmax: 28, am: 2.4, jm: 1.6, ve: 0.5, creep: 1.6 } : { vmax: 13, am: 1.3, jm: 0.9, ve: 0.4, creep: 1.1 });
    this.plan = plan; await this._hoist(Bp.y, plan, { progress: (k) => hooks.progress && hooks.progress(k) }); hooks.progress && hooks.progress(1);
    this.dockStop = toStop; this.stopIndex = toStop.index; await this.wait(0.45); this.state = 'opening'; await this.openDoors(1.7); this.state = 'open'; this.setDoors(1); this.riding = false; toStop.data?.ringBell?.(0.7); this.emit('arrived', { stop: toStop.index });
  }
  async depart(stop) {
    this.state = 'closing'; await this.closeDoors(1.6); const P = this.stationPose(stop, { x: 0, y: 0, z: 0, yaw: 0 }); const up = stop.index !== 0 ? 1 : -1; this.state = 'departing';
    await this._hoist(P.y + up * 28, planMove(28, { vmax: 7, am: 1.0, jm: 0.8, ve: 0.3, creep: 0.5 })); this.parkAway(stop);
  }
  parkAway(stop) { this.motion = null; this.setHidden(true); this.state = 'away'; this.doors = 0; this.speed = 0; this.dockStop?.data?.landing?.setOpen(0); this.strobe.intensity = 0; this.lampLight.intensity = 0; this.lampLight.enabled = false; }
}
CageElevator.prototype.latN = 0; CageElevator.prototype.rollN = 0; CageElevator.prototype.pitchN = 0;
