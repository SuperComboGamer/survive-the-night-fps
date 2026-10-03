// AFTER HOURS — the rides seen from the monorail (world coordinates, always visible, animated via PARK.animators):
// ferris wheel, roller coaster (vertical loop, energy-driven cars), carousel, log flume with splash-down, plus fireworks, searchlights, blimp, lake fountain.
import * as THREE from 'three';
import { HaloBatch, makeBeam } from '../../core/glow.js';
import { std } from '../../core/mats.js';
import { makeRng } from '../../core/util.js';
import { horseGeometry } from './carousel-horse.js';
import { gondolaGeometry, boatGeometry, coasterExtras } from './rides-real.js';
import { glowMat, bulbMat, neonPanel, neonText, torus, pipe, pipes, geo, mergedMesh, loftRaw, TAU, PI } from './common.js';
import { PARK } from './park.js';

const V3 = THREE.Vector3;
/** cached low-level material helper (synth-baked patterns come from route.js and are passed in) */
export function buildRides(ctx, M, halos) {
  const { B, fx } = ctx, R = makeRng(909), RC = () => R(); const A = PARK.animators; const group = B.group;
  const steel = M.steel, whiteM = M.white, redM = M.red, chrome = M.chrome;
  const bulbGeo = geo('rideBulb', () => new THREE.SphereGeometry(0.11, 6, 4));
  const mkBulbs = (positions, mat, parent) => { const im = new THREE.InstancedMesh(bulbGeo, mat, positions.length); const m = new THREE.Matrix4(), c = new THREE.Color(); positions.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, m); c.setRGB(RC(), 0.5, 0.5); im.setColorAt(i, c); }); im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.frustumCulled = false; parent.add(im); return im; };

  // ============================================================ FERRIS WHEEL (NW outside corner, faces the park centre)
  { const C = [-138, 0, -142], WR = 22, HY = 27.5, NG = 24; const face = Math.atan2(-C[0], -C[2]);            // local +z = toward the park centre
    const cy = Math.cos(face), sy = Math.sin(face); const W = (x, y, z) => [C[0] + x * cy + z * sy, y, C[2] - x * sy + z * cy];
    for (const sz of [-1, 1]) { for (const sx of [-1, 1]) { pipe(B, W(0, HY, sz * 2.6), W(sx * 15, 0.3, sz * 6.4), 0.42, whiteM, { seg: 8, r2: 0.34 }); B.box({ p: [...W(sx * 15, -0.3, sz * 6.4)], s: [2.2, 0.8, 2.2], yaw: face, mat: M.conc, cast: true, bevel: 0.05 }); }
      pipe(B, W(-15, 0.6, sz * 6.4), W(15, 0.6, sz * 6.4), 0.24, whiteM, { seg: 6, cast: false }); pipe(B, W(-8.5, 12, sz * 4.4), W(8.5, 12, sz * 4.4), 0.2, whiteM, { seg: 6, cast: false }); }
    pipe(B, W(-15, 0.6, -6.4), W(-15, 0.6, 6.4), 0.24, whiteM, { seg: 6, cast: false }); pipe(B, W(15, 0.6, -6.4), W(15, 0.6, 6.4), 0.24, whiteM, { seg: 6, cast: false });
    B.cyl({ p: W(0, HY, 0), r: 1.3, h: 6.4, seg: 16, mat: chrome, pitch: PI / 2, yaw: face, anchor: 'center' });
    const wheel = new THREE.Group(); wheel.position.set(...W(0, HY, 0)); wheel.rotation.y = face; group.add(wheel);
    const parts = [], G = (g, m) => parts.push({ geo: g, matrix: m });
    for (const zz of [-1.6, 1.6]) { G(new THREE.TorusGeometry(WR, 0.32, 6, 96), new THREE.Matrix4().makeTranslation(0, 0, zz)); G(new THREE.TorusGeometry(WR * 0.5, 0.2, 6, 64), new THREE.Matrix4().makeTranslation(0, 0, zz)); G(new THREE.TorusGeometry(WR - 4.2, 0.12, 5, 64), new THREE.Matrix4().makeTranslation(0, 0, zz)); }
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; for (const zz of [-1.6, 1.6]) { const g = new THREE.CylinderGeometry(0.11, 0.11, WR, 5); g.rotateZ(PI / 2); G(g, new THREE.Matrix4().makeRotationZ(a).setPosition(Math.cos(a) * WR / 2, Math.sin(a) * WR / 2, zz)); } const cb = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 5); cb.rotateX(PI / 2); G(cb, new THREE.Matrix4().makeTranslation(Math.cos(a) * WR, Math.sin(a) * WR, 0)); }
    mergedMesh(wheel, parts, whiteM); const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 3.6, 18), chrome); hub.rotation.x = PI / 2; wheel.add(hub);
    const bl = []; for (let i = 0; i < 96; i++) { const a = i / 96 * TAU; for (const zz of [-1.95, 1.95]) bl.push([Math.cos(a) * (WR + 0.1), Math.sin(a) * (WR + 0.1), zz]); } for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; for (let k = 1; k <= 5; k++) bl.push([Math.cos(a) * WR * k / 5.6, Math.sin(a) * WR * k / 5.6, 1.85]); }
    mkBulbs(bl, M.bulbA, wheel); const bl2 = []; for (let i = 0; i < 48; i++) { const a = i / 48 * TAU; bl2.push([Math.cos(a) * (WR - 4.2), Math.sin(a) * (WR - 4.2), 1.9]); } mkBulbs(bl2, M.bulbB, wheel);
    const gg = new THREE.Group();
    const gmesh = mergedMesh(gg, [{ geo: gondolaGeometry() }], M.gondola); gg.remove(gmesh);   // real carriage (rides-real.js)
    const gond = new THREE.InstancedMesh(gmesh.geometry, M.gondola, NG); gond.frustumCulled = false; gond.castShadow = true; const gc = new THREE.Color(); const gcol = [0xd84040, 0xf0b030, 0x30b8c0, 0xe060b0, 0x5080e0, 0xf0f0f0]; for (let i = 0; i < NG; i++) { gc.set(gcol[i % 6]); gond.setColorAt(i, gc); } group.add(gond);
    const glow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 8, 6), M.gondolaGlow, NG); glow.frustumCulled = false; group.add(glow);
    const hubW = new V3(...W(0, HY, 0)), dm = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), face), pp = new V3(), sc = new V3(1, 1, 1); let ang = 0; const hIdx = []; for (let i = 0; i < 48; i++) hIdx.push(halos.add([0, 0, 0], i % 2 ? 0xffd070 : 0xff6090, 0.9, 0.5, 0));
    const hp = halos.pos;
    A.push((dt, t) => { ang += dt * 0.07; wheel.rotation.z = ang;
      for (let i = 0; i < NG; i++) { const a = ang + i / NG * TAU, lx = Math.cos(a) * WR, ly = Math.sin(a) * WR; pp.set(hubW.x + lx * cy, hubW.y + ly, hubW.z - lx * sy); dm.compose(pp, q, sc); gond.setMatrixAt(i, dm); pp.y += -2.6; glow.setMatrixAt(i, dm.compose(pp, q, sc)); }
      gond.instanceMatrix.needsUpdate = true; glow.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < 48; i++) { const a = ang + i / 48 * TAU, lx = Math.cos(a) * (WR + 0.1), ly = Math.sin(a) * (WR + 0.1), zz = (i % 2 ? 1 : -1) * 1.95; hp.setXYZ(hIdx[i], hubW.x + lx * cy + zz * sy, hubW.y + ly, hubW.z - lx * sy + zz * cy); } hp.needsUpdate = true; });
    ctx.ferris = { hub: hubW };
  }

  // ============================================================ CAROUSEL (inside the loop, SE)
  { const C = [72, 0, 92]; const base = new THREE.Group(); base.position.set(...C); group.add(base);
    B.cyl({ p: C, r: [9.2, 8.8], h: 0.7, seg: 40, mat: M.conc, col: 'concrete' }); B.cyl({ p: [C[0], 0.7, C[2]], r: 9.0, h: 0.06, seg: 40, mat: chrome, cast: false });
    const spin = new THREE.Group(); spin.position.y = 0.8; base.add(spin);
    const flo = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.2, 0.25, 40), M.red); flo.position.y = 0; spin.add(flo); const post = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 6.6, 20), chrome); post.position.y = 3.3; spin.add(post);
    const ring = []; const pole = new THREE.CylinderGeometry(0.05, 0.05, 5.2, 5); const list = []; for (let k = 0; k < 3; k++) { const rr = 3.2 + k * 2.2, n = 8 + k * 4; for (let i = 0; i < n; i++) { const a = i / n * TAU + k * 0.2; list.push({ geo: pole, matrix: new THREE.Matrix4().makeTranslation(Math.cos(a) * rr, 2.9, Math.sin(a) * rr) }); ring.push([a, rr, k]); } }
    mergedMesh(spin, list, chrome);
    // horses: body + neck + head + tail, merged; vertex-shader bob by angle around the axis
    const hg = (() => { const parts = []; const body = new THREE.SphereGeometry(0.42, 8, 6); body.scale(1.55, 0.72, 0.62); body.translate(0, 0, 0); const neck = new THREE.CylinderGeometry(0.15, 0.22, 0.7, 6); neck.rotateZ(-0.6); neck.translate(0.62, 0.42, 0); const head = new THREE.SphereGeometry(0.2, 7, 5); head.scale(1.5, 0.85, 0.85); head.translate(0.98, 0.72, 0); const tail = new THREE.ConeGeometry(0.12, 0.6, 5); tail.rotateZ(2.4); tail.translate(-0.78, 0.0, 0); const legs = []; for (const [x, z] of [[0.4, 0.2], [0.4, -0.2], [-0.4, 0.2], [-0.4, -0.2]]) { const l = new THREE.CylinderGeometry(0.06, 0.05, 0.6, 5); l.translate(x, -0.45, z); legs.push(l); } return [body, neck, head, tail, ...legs]; })();
    const horseMat = std({ color: 0xf2eee4, roughness: 0.28, metalness: 0.06, envMapIntensity: 1.2 });
    const horseI = new THREE.InstancedMesh(horseGeometry(), horseMat, ring.length); horseI.frustumCulled = false; horseI.castShadow = false; horseI.receiveShadow = true; spin.add(horseI);
    const hM = new THREE.Matrix4(), hQ = new THREE.Quaternion(), hE = new THREE.Euler(), hP = new V3(), hS = new V3(1, 1, 1), hAx = new V3(0, 1, 0);
    const bobHorses = (t) => { for (let i = 0; i < ring.length; i++) { const [a, rr, k] = ring[i], ph = t * 2.3 + i * 1.9, bob = Math.sin(ph) * 0.42 * (0.6 + 0.4 * k / 2); hE.set(0, -a + PI / 2 + (k % 2 ? PI : 0), Math.sin(ph + 0.6) * 0.045, 'YXZ'); hQ.setFromEuler(hE); hP.set(Math.cos(a) * rr, 2.75 + bob, Math.sin(a) * rr); hM.compose(hP, hQ, hS); horseI.setMatrixAt(i, hM); } horseI.instanceMatrix.needsUpdate = true; }; bobHorses(0);
    horseI.computeBoundingSphere(); horseI.boundingSphere.radius += 1.6; horseI.frustumCulled = true;   // culled when the carousel is off screen (was always drawn: 83k tris in every view)
    const horseMesh = { bob: bobHorses };
    const canopy = new THREE.Mesh(new THREE.LatheGeometry([[9.4, 0], [9.6, 0.4], [9.2, 0.9], [4.0, 3.4], [0.0, 4.6]].map(([r, y]) => new THREE.Vector2(r, y)), 40), M.canopy); canopy.position.y = 6.6; spin.add(canopy);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(9.4, 0.14, 6, 64), M.gold); rim.rotation.x = PI / 2; rim.position.y = 6.6; spin.add(rim); const fin = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), M.gold); fin.position.y = 11.4; spin.add(fin);
    const cb = []; for (let i = 0; i < 96; i++) { const a = i / 96 * TAU; cb.push([Math.cos(a) * 9.5, 6.45, Math.sin(a) * 9.5]); } mkBulbs(cb, M.bulbA, spin);
    A.push((dt, t) => { spin.rotation.y += dt * 0.5; horseMesh.bob(t); });
    for (let i = 0; i < 6; i++) halos.add([C[0] + Math.cos(i * 1.05) * 9.5, 7.4, C[2] + Math.sin(i * 1.05) * 9.5], 0xffb060, 1.0, 0.4, 0);
    B.sphere({ p: [C[0], 11.7, C[2]], r: 0.2, seg: 6, mat: M.gold, cast: false });
  }

  // ============================================================ ROLLER COASTER (SE outside): lift hill, drop, vertical loop, camelback, two turnarounds; cars driven by energy
  { const P0 = [142, 0, 150]; const pts = []; const add = (x, y, z) => pts.push(new V3(P0[0] + x, y, P0[2] + z));
    [[-26, 3.4, 0], [-14, 4.2, 0], [-3, 10, 0], [7, 20, 0], [15, 29.5, 0], [22, 33, 0], [28, 31, 0], [35, 21, 0], [41, 9.5, 0], [46, 3.6, -0.9]].forEach((p) => add(...p));
    for (let i = 1; i <= 15; i++) { const f = i / 16, phi = f * TAU; add(48 + 10 * Math.sin(phi) + 8 * f, 3.6 + 10 * (1 - Math.cos(phi)), 1.8 * f - 0.9); }
    [[64, 4.2, 0.9], [72, 12.5, 0.9], [80, 5.4, 0.9], [88, 5, 3], [96, 7, 11], [97, 9, 22], [89, 8, 31], [75, 6, 36], [58, 5, 36], [42, 4.4, 33], [24, 4.2, 29], [6, 4.2, 26], [-14, 4.4, 24], [-30, 4.6, 18], [-37, 4.2, 9], [-33, 3.6, 2]].forEach((p) => add(...p));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal'); const N = 620, len = curve.getLength(); const P = [], T = [], Up = []; const up = new V3(0, 1, 0);
    for (let i = 0; i < N; i++) { const u = i / N; P.push(curve.getPointAt(u)); T.push(curve.getTangentAt(u)); }
    for (let i = 0; i < N; i++) { const t = T[i]; if (i === 0) up.set(0, 1, 0).addScaledVector(t, -t.y).normalize(); else up.addScaledVector(t, -up.dot(t)).normalize(); Up.push(up.clone()); }
    const railL = [], railR = [], spine = []; for (let i = 0; i < N; i++) { const r = new V3().crossVectors(T[i], Up[i]).normalize(); railL.push(P[i].clone().addScaledVector(r, -0.62).addScaledVector(Up[i], 0.1)); railR.push(P[i].clone().addScaledVector(r, 0.62).addScaledVector(Up[i], 0.1)); spine.push(P[i].clone().addScaledVector(Up[i], -0.35)); }
    const tubeOf = (arr, r, mat, seg = 5) => B.tube({ pts: arr.filter((_, i) => i % 3 === 0).map((v) => [v.x, v.y, v.z]), r, mat, seg, segs: Math.floor(N / 3) * 2, closed: true, cast: true });
    tubeOf(railL, 0.09, M.redRail); tubeOf(railR, 0.09, M.redRail); tubeOf(spine, 0.2, M.white, 6);
    for (let i = 0; i < N; i += 7) { const r = new V3().crossVectors(T[i], Up[i]).normalize(); const a = railL[i], b = railR[i], c = spine[i]; pipe(B, [a.x, a.y, a.z], [c.x, c.y, c.z], 0.05, M.white, { seg: 4, cast: false }); pipe(B, [b.x, b.y, b.z], [c.x, c.y, c.z], 0.05, M.white, { seg: 4, cast: false }); }
    for (let i = 0; i < N; i += 11) { const c = spine[i]; if (c.y < 2.2) continue; if (Up[i].y < 0) continue; const h = c.y - 0.15; B.cyl({ p: [c.x, 0, c.z], r: [0.24, 0.16], h, seg: 6, mat: M.white, col: 'metal' }); if (c.y > 9 && i % 22 === 0) { const c2 = spine[(i + 11) % N]; pipe(B, [c.x, 1, c.z], [c.x + 1.4, c.y - 1, c.z + 1.4], 0.07, M.white, { seg: 4, cast: false }); pipe(B, [c.x, 1, c.z], [c.x - 1.4, c.y - 1, c.z - 1.4], 0.07, M.white, { seg: 4, cast: false }); } }
    coasterExtras(B, M, { P, T, Up, spine, N });   // cross-ties, lift chain, braced A-frame supports (rides-real.js)
    // station house + lights
    B.box({ p: [P0[0] - 26, 0, P0[2] + 2], s: [12, 3.2, 5], mat: M.red, bevel: 0.08, cast: true }); B.box({ p: [P0[0] - 26, 3.2, P0[2] + 2], s: [13, 0.4, 6], mat: M.white, bevel: 0.05, cast: false });
    const lb = []; for (let i = 0; i < N; i += 9) { const c = P[i], r = new V3().crossVectors(T[i], Up[i]).normalize(); lb.push([c.x + r.x * 0.7 + Up[i].x * 0.35, c.y + Up[i].y * 0.35, c.z + r.z * 0.7 + Up[i].z * 0.35]); } mkBulbs(lb, M.bulbA, group);
    for (let i = 0; i < N; i += 45) halos.add([P[i].x, P[i].y + 0.5, P[i].z], i % 90 ? 0xff4060 : 0xffd060, 1.1, 0.5, 0);
    const NC = 4, carG = (() => { const g = new THREE.BoxGeometry(1.5, 0.55, 2.1); g.translate(0, 0.5, 0); const nose = new THREE.SphereGeometry(0.62, 8, 6); nose.scale(1, 0.5, 0.9); nose.translate(0, 0.55, -1.05); const seat = new THREE.BoxGeometry(1.2, 0.5, 0.5); seat.translate(0, 0.95, 0.3); const w = []; for (const x of [-0.7, 0.7]) for (const z of [-0.8, 0.8]) { const c = new THREE.CylinderGeometry(0.22, 0.22, 0.14, 8); c.rotateZ(PI / 2); c.translate(x, 0.05, z); w.push(c); } return [g, nose, seat, ...w]; })();
    const carMesh = mergedMesh(group, carG.map((g) => ({ geo: g })), M.carMat); group.remove(carMesh); const cars = new THREE.InstancedMesh(carMesh.geometry, M.carMat, NC); cars.frustumCulled = false; cars.castShadow = true; const cc = new THREE.Color(); for (let i = 0; i < NC; i++) { cc.set(i % 2 ? 0xf0f0f0 : 0xd82828); cars.setColorAt(i, cc); } group.add(cars);
    let u = 0.0, speed = 5; const cm = new THREE.Matrix4(), cq = new THREE.Quaternion(), ce = new V3(), cs = new V3(1, 1, 1), bx = new V3(), by = new V3(), bz = new V3(), bp = new V3();
    let peakI = 0; for (let i = 0; i < N * 0.4; i++) if (P[i].y > P[peakI].y) peakI = i; const peakU = peakI / N, hMax = P[peakI].y;
    A.push((dt, t) => { const i0 = Math.floor(((u % 1) + 1) % 1 * N) % N; const h = P[i0].y; const onLift = u % 1 < peakU - 0.02 && T[i0].y > 0.05; const vt = onLift ? 3.2 : Math.max(5.5, Math.sqrt(Math.max(0, 2 * 9.81 * (hMax - h) * 0.72 + 12))); speed += (vt - speed) * Math.min(1, dt * 1.6); u += speed * dt / len;
      for (let c = 0; c < NC; c++) { const uu = (((u - c * 2.7 / len) % 1) + 1) % 1, i = Math.floor(uu * N) % N; bz.copy(T[i]).negate(); by.copy(Up[i]); bx.crossVectors(by, bz).normalize(); cm.makeBasis(bx, by, bz); bp.copy(P[i]); cm.setPosition(bp.x, bp.y, bp.z); cars.setMatrixAt(c, cm); } cars.instanceMatrix.needsUpdate = true; });
    ctx.coaster = { P0 };
  }

  // ============================================================ LOG FLUME (NE outside): elevated trough, lift, big drop, splash pool, boats
  { const F0 = [150, 0, -128], pts = []; [[0, 2.4, 0], [10, 3.0, 0], [22, 11, 0], [30, 13.6, 4], [28, 13.4, 14], [16, 12.6, 20], [0, 12, 20], [-12, 11.4, 15], [-20, 7, 8], [-24, 1.7, 2], [-24, 1.2, -6], [-18, 1.4, -12], [-4, 1.6, -14], [10, 2.0, -10], [16, 2.2, -4], [8, 2.4, -0.5]].forEach(([x, y, z]) => pts.push(new V3(F0[0] + x, y, F0[2] + z)));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal'), N = 300, len = curve.getLength(), P = [], T = []; for (let i = 0; i < N; i++) { P.push(curve.getPointAt(i / N)); T.push(curve.getTangentAt(i / N)); }
    const rings = [], wr = []; const outer = [[-1.5, 0.95], [-1.5, -0.3], [1.5, -0.3], [1.5, 0.95], [1.24, 0.95], [1.24, 0.02], [-1.24, 0.02], [-1.24, 0.95]]; for (let i = 0; i <= N; i++) { const p = P[i % N], t = T[i % N], r = new V3(-t.z, 0, t.x).normalize(), u = new V3().crossVectors(r, t).normalize(); const f = (x, y) => [p.x + r.x * x + u.x * y, p.y + r.y * x + u.y * y, p.z + r.z * x + u.z * y]; rings.push(outer.map(([x, y]) => f(x, y))); wr.push([f(-1.22, 0.14), f(1.22, 0.14)]); }
    const c0 = rings[0][0].slice(); for (const r of rings) for (const q of r) { q[0] -= c0[0]; q[1] -= c0[1]; q[2] -= c0[2]; } B.addRaw(loftRaw(rings, { closed: true, flip: true }), new THREE.Matrix4().makeTranslation(...c0), M.teal, { cast: true });
    const w0 = wr[0][0].slice(); for (const r of wr) for (const q of r) { q[0] -= w0[0]; q[1] -= w0[1]; q[2] -= w0[2]; } B.addRaw(loftRaw(wr, { closed: false }), new THREE.Matrix4().makeTranslation(...w0), M.flumeWater, { cast: false });
    for (let i = 0; i < N; i += 8) { const p = P[i]; if (p.y < 2.2) continue; B.cyl({ p: [p.x, 0, p.z], r: [0.32, 0.22], h: p.y - 0.35, seg: 6, mat: M.white, col: 'concrete' }); B.box({ p: [p.x, p.y - 0.4, p.z], s: [3.4, 0.24, 0.5], yaw: Math.atan2(-T[i].z, T[i].x) + PI / 2, mat: M.conc, cast: false }); }
    let lowI = 0, hiI = 0; for (let i = 0; i < N; i++) { if (P[i].y > P[hiI].y) hiI = i; } for (let k = 0; k < N; k++) { const i = (hiI + k) % N; if (P[i].y < P[lowI].y || k === 0) lowI = i; if (k > 0 && P[i].y < 1.5) { lowI = i; break; } }
    B.box({ p: [P[lowI].x - 1, 0.06, P[lowI].z], s: [10, 0.5, 8], mat: M.flumeWater, cast: false, bevel: 0.05 }); const lbF = []; for (let i = 0; i < N; i += 5) { const p = P[i], t = T[i], r = new V3(-t.z, 0, t.x).normalize(); lbF.push([p.x + r.x * 1.36, p.y + 1.0, p.z + r.z * 1.36]); } mkBulbs(lbF, M.bulbC, group);
    const boatG = [boatGeometry()];
    const bm = mergedMesh(group, boatG.map((g) => ({ geo: g })), M.boat); group.remove(bm); const NB = 5, boats = new THREE.InstancedMesh(bm.geometry, M.boat, NB); boats.frustumCulled = false; boats.castShadow = true; group.add(boats); const bc = new THREE.Color(); for (let i = 0; i < NB; i++) { bc.set([0x8a5a2a, 0x6a4326, 0x9a6a34, 0x7a4c28, 0x8a5a2a][i]); boats.setColorAt(i, bc); }
    const bu = Array.from({ length: NB }, (_, i) => i / NB), bmx = new THREE.Matrix4(), bx = new V3(), by = new V3(0, 1, 0), bz = new V3(), sp = new V3(); const splashAt = lowI / N; const prevU = bu.slice();
    A.push((dt, t) => { for (let b = 0; b < NB; b++) { const u0 = bu[b], i0 = Math.floor(u0 * N) % N, p = P[i0], tg = T[i0]; const hi = P[hiI].y; const v = tg.y > 0.12 ? 2.6 : (p.y > 3 ? 4.5 + (hi - p.y) * 0.32 : 4.2); bu[b] = (u0 + v * dt / len) % 1; const ii = Math.floor(bu[b] * N) % N;
        if (u0 < splashAt && bu[b] >= splashAt || (u0 > 0.9 && bu[b] < 0.1 && false)) { sp.copy(P[lowI]); sp.y += 0.4; fx.splash(sp, by, 3.2); fx.puff(sp, by, 6, { speed: 3.2, size: [0.5, 2.6], life: 1.6, color: [0.75, 0.85, 0.9, 0.5], rise: 2.2, drag: 1.4, spread: 3.0, cell: 9 }); }
        bz.copy(T[ii]).negate(); by.set(0, 1, 0); bx.crossVectors(by, bz).normalize(); by.crossVectors(bz, bx).normalize(); bmx.makeBasis(bx, by, bz); bmx.setPosition(P[ii].x, P[ii].y + 0.05, P[ii].z); boats.setMatrixAt(b, bmx); by.set(0, 1, 0); }
      boats.instanceMatrix.needsUpdate = true; });
  }

  // ============================================================ FIREWORKS, SEARCHLIGHTS, BLIMP
  { const pal = [[[4, 0.6, 0.6], [4, 2.2, 0.6]], [[0.7, 3.2, 4], [0.7, 4, 2]], [[3.5, 1.0, 3.6], [1.2, 3.6, 4]], [[4, 3.4, 1.0], [4, 1.2, 0.3]]]; let nextF = 2.5; const O = new V3();
    const burst = (p, ci) => { const [c1, c2] = pal[ci]; const n = 110; for (let i = 0; i < n; i++) { const a = RC() * TAU, b = Math.acos(2 * RC() - 1), sp = 20 + RC() * 7; const c = i % 3 ? c1 : c2; fx.add.emit({ p: [p.x, p.y, p.z], v: [Math.sin(b) * Math.cos(a) * sp, Math.cos(b) * sp, Math.sin(b) * Math.sin(a) * sp], life: 1.7 + RC() * 0.8, size: [0.5, 0.12], c0: [c[0], c[1], c[2], 1], c1: [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 0], gravity: 0.32, drag: 1.5, cell: 10 }, fx.time); }
      for (let i = 0; i < 40; i++) { const a = RC() * TAU, b = Math.acos(2 * RC() - 1), sp = 9 + RC() * 6; fx.add.emit({ p: [p.x, p.y, p.z], v: [Math.sin(b) * Math.cos(a) * sp, Math.cos(b) * sp, Math.sin(b) * Math.sin(a) * sp], life: 1.0 + RC() * 0.7, size: [0.2, 0.05], c0: [5, 4, 2.4, 1], c1: [2, 1, 0.4, 0], gravity: 0.5, drag: 1.0, cell: 4 }, fx.time + 0.85); }
      fx.pulseLight(p, new THREE.Color(c1[0] / 4, c1[1] / 4, c1[2] / 4), 1600, 0.5, 260); };
    A.push((dt, t) => { nextF -= dt; if (nextF > 0) return; nextF = 3.2 + RC() * 4.5; const p = O.set(60 + RC() * 130, 62 + RC() * 30, -160 + RC() * 90); const ci = Math.floor(RC() * 4);
      for (let i = 0; i < 18; i++) fx.add.emit({ p: [p.x + (RC() - 0.5) * 2, p.y - 30 + i * 1.6, p.z + (RC() - 0.5) * 2], v: [0, 20, 0], life: 0.5, size: [0.25, 0.05], c0: [4, 3, 1.2, 1], c1: [1.5, 0.8, 0.2, 0], drag: 0.6, cell: 4 }, fx.time + i * 0.02); fx.schedule(0.6, () => burst(new V3(p.x, p.y, p.z), ci)); }); }
  for (const [x, z, ph] of [[-195, -195, 0], [195, -195, 1.6], [195, 195, 3.1], [-195, 195, 4.7]]) { const piv = new THREE.Group(); piv.position.set(x, 1, z); group.add(piv); const bmm = makeBeam({ length: 320, r0: 0.7, r1: 16, color: 0xcfe8ff, intensity: 0.07, dust: 1 }); bmm.rotation.x = -1.02; piv.add(bmm); B.cyl({ p: [x, 0, z], r: 1.4, h: 1.0, seg: 10, mat: M.steel }); A.push((dt, t) => { piv.rotation.y = t * 0.16 + ph; }); }
  { const bl = new THREE.Group(); group.add(bl); const prof = []; for (let i = 0; i <= 24; i++) { const f = i / 24, y = -17 + 34 * f, r = 5.6 * Math.pow(Math.sin(PI * (0.02 + 0.96 * f)), 0.78); prof.push(new THREE.Vector2(Math.max(0.02, r), y)); }
    const env = new THREE.LatheGeometry(prof, 28); env.rotateZ(-PI / 2); const em = new THREE.Mesh(env, M.blimp); em.castShadow = false; bl.add(em);
    const gond = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 2.2), M.chromeP); gond.position.set(1, -6.4, 0); bl.add(gond); for (const dz of [-1, 1]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 4), M.chromeP); st.position.set(-1.6 + dz * 0.0, -5.4, dz * 0.9); bl.add(st); }
    const fins = []; for (const a of [0, PI / 2, PI, PI * 1.5]) { const fg = new THREE.BoxGeometry(5, 0.14, 3.4); fg.translate(-1.6, 0, 3.6); fg.rotateX(a); const fm = new THREE.Mesh(fg, M.blimp); fm.position.set(-14, 0, 0); bl.add(fm); fm.rotation.x = 0; }
    const sign = neonPanel(1024, 256, (c, e, w, h) => { c.fillStyle = '#e8ecf0'; c.fillRect(0, 0, w, h); neonText(e, 'After Hours', w / 2, h * 0.42, 150, '#ff3cc8', { core: '#fff', tube: 0.05, style: 'italic 700' }); neonText(c, 'After Hours', w / 2, h * 0.42, 150, '#8a2a70', { core: '#8a2a70', tube: 0.03, style: 'italic 700' }); neonText(e, 'OPEN  LATE  ★  FOREVER', w / 2, h * 0.82, 52, '#40e8ff', { core: '#fff', tube: 0.08, style: '700', font: '"Liberation Sans", sans-serif' }); }, { intensity: 5, flicker: 0.02, cell: 6, seed: 3 });
    for (const sgn of [-1, 1]) { const sp = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.75), sign); sp.position.set(0.5, 0.4, sgn * 5.45); sp.rotation.y = sgn > 0 ? 0 : PI; bl.add(sp); }
    const nav = [[-14, 0, 0, 0xff2030], [0.5, -6.9, 1.1, 0x40ff60], [0.5, -6.9, -1.1, 0xff2030], [16, 0, 0, 0xffffff]]; const navM = nav.map((n) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), glowMat(n[3], 12, { flicker: 0, cell: 100 })); m.position.set(n[0], n[1], n[2]); bl.add(m); return m; });
    const hb = halos.add([0, 0, 0], 0xffffff, 0.5, 0.0, 0); let ang = 0.6; const tv = new V3();
    A.push((dt, t) => { ang += dt * 0.021; const R0 = 262; bl.position.set(Math.cos(ang) * R0, 96 + 5 * Math.sin(ang * 5), Math.sin(ang) * R0); bl.rotation.y = -ang + PI; bl.rotation.z = Math.sin(ang * 7) * 0.03; const on = Math.sin(t * 2.6) > 0.3; for (let i = 0; i < navM.length; i++) navM[i].visible = i > 0 && i < 3 ? true : on; bl.updateMatrixWorld(); tv.set(16, 0, 0); bl.localToWorld(tv); halos.pos.setXYZ(hb, tv.x, tv.y, tv.z); halos.pos.needsUpdate = true; halos.set(hb, 0xffffff, on ? 0.5 : 0); }); }
  ctx.rideStats = 'ok';
}
