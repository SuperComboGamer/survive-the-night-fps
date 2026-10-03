// View-model: everything drawn in the camera-space pass (layer 1). Owns the gun rigs, the arms, held objects (knife, grenade,
// shells), muzzle flashes and all procedural motion. The WeaponSystem drives it with play()/fire()/state flags.
// Pose stack per frame (camera space):  base (hip <-> ADS from real sight alignment <-> sprint) + wall retract
//   + procedural [step-synced bob, mouse-inertia sway, recoil spring-dampers, landing dip, breathing, strafe lean] + clip 'gun' track,
//   rotations applied about the gun's grip pivot. Parts: rest -> gameplay state (slide lock, hammer...) -> fire clip -> action clip.
// Hands: clip hand keys (frame + offset + finger pose) blended in camera space; 2-bone IK for the arm.
import * as THREE from 'three';
import { GunRig, modelData } from './rig.js';
import { Hands, POSE_ARR, handQuat } from './hands.js';
import { makeClip, seg, sampleNum, fireEvents, blendPose } from './anim.js';
import { MuzzleFlash } from './flash.js';
import { Spring } from '../../core/util.js';
import { HAND_LIGHT } from './hands/hmats.js';

const D = Math.PI / 180;
const PALM = { R: new THREE.Vector3(0.003, -0.018, -0.052), L: new THREE.Vector3(-0.003, -0.018, -0.052) };
const _M = new THREE.Matrix4(), _M2 = new THREE.Matrix4(), _P = new THREE.Vector3(), _P2 = new THREE.Vector3(), _Q = new THREE.Quaternion(), _Q2 = new THREE.Quaternion(), _S = new THREE.Vector3(), _E = new THREE.Euler(), _V = new THREE.Vector3(), _V2 = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const _POLE = new THREE.Vector3(), RIG_C = new THREE.Vector3(), RIG_D = new THREE.Vector3(), RIG_T = new THREE.Vector3(); const RIG_DIST = 1.3, RIG_SPOT = 0.45;
const NUM = new Float32Array(8), POSE_A = new Float32Array(25), POSE_B = new Float32Array(25);
const sstep = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const smoother = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * x * (x * (x * 6 - 15) + 10); };
const jit = () => 0.85 + Math.random() * 0.3, sgn = () => (Math.random() < 0.5 ? -1 : 1);
const GRIP = { R: 'gripR', L: 'gripL' }, HOLD = { R: 'holdR', L: 'holdL' }, WALL0 = { p: [0, -0.03, 0.08], r: [28, 12, -12] };

function frameMatrix(F) { // palm-centre frame {p, fd, pn, r?} -> Matrix4
  const q = handQuat(F.fd, F.pn); if (F.r) { _E.set(F.r[0] * D, F.r[1] * D, F.r[2] * D, 'XYZ'); q.multiply(_Q2.setFromEuler(_E)); }
  return new THREE.Matrix4().compose(new THREE.Vector3(...F.p), q, _one);
}

export class ViewModel {
  constructor(gfx, mats, models, specs, { props = {}, timing = {}, eager = null } = {}) {
    this.gfx = gfx; this.mats = mats; this.specs = specs;
    this.root = new THREE.Group(); this.root.name = 'viewmodel'; gfx.vmCamera.add(this.root);
    this.holder = new THREE.Group(); this.holder.matrixAutoUpdate = false; this.root.add(this.holder);
    let t0 = performance.now(); this.hands = new Hands(mats, { layer: 1 }); this.root.add(this.hands.group); timing.hands = performance.now() - t0;
    this.guns = {}; this.cur = null; this.props = {};
    // guns are built lazily: the eager ones now (the starting pistol), the rest in the background a few frames apart (then their
    // shader programs are pre-compiled with renderer.compileAsync), or synchronously the moment one is needed (setGun)
    this.models = models; this.timing = timing; this._bg = [];
    for (const id of Object.keys(models)) { if ((eager || ['m1911']).includes(id)) this._build(id); else this._bg.push(id); }
    for (const [id, def] of Object.entries(props)) { t0 = performance.now(); this._addProp(id, def); timing['prop:' + id] = performance.now() - t0; }
    // channels
    this.act = { clip: null, t: 0, speed: 1, name: '', onEvent: null, onEnd: null, done: true };
    this.fireCh = { clip: null, t: 0, speed: 1, onEvent: null };
    // procedural state
    this.recoil = { px: new Spring(520, 26), py: new Spring(520, 26), pz: new Spring(520, 26), rx: new Spring(520, 26), ry: new Spring(520, 26), rz: new Spring(520, 26) }; this._springs = Object.values(this.recoil);
    this.sway = { x: new Spring(110, 13), y: new Spring(110, 13), r: new Spring(90, 11) };
    this.adsK = 0; this.sprintK = 0; this.wallK = 0; this.triggerK = 0; this.crouchK = 0; this.lowerK = 0; this.time = 0; this.handsOn = { R: 1, L: 1 };
    this.stepPhase = 0; this.stepCount = 0; this._lastStepDist = 0; this.bobAmp = 0; this.airK = 0;
    this.st = {}; // gameplay part state (per current gun), read by handling.parts()
    this.pose = { P: new THREE.Vector3(), Q: new THREE.Quaternion(), proc: new THREE.Vector3(), procR: new THREE.Vector3() };
    this.handT = { R: { P: new THREE.Vector3(), Q: new THREE.Quaternion(), pose: new Float32Array(25) }, L: { P: new THREE.Vector3(), Q: new THREE.Quaternion(), pose: new Float32Array(25) } };
    this.held = { R: null, L: null };
    this.tris = this.hands.tris;
    this._rigPool = []; this._installLightRig(); this._initVmLights();
    { const r = gfx.renderer; if (r?.compileAsync && gfx.scene) { try { r.compileAsync(this.hands.group, gfx.vmCamera, gfx.scene).catch(() => {}); } catch (e) { /* older three */ } } } // compile the four hand programs during boot, not on the first visible frame
  }

  // ------------------------------------------------------------------ view-model light rig
  // The view-model sits 0.2-1 m from the eye, i.e. right next to the player's flashlight (placed 25 cm ahead of the eye) and to
  // its own muzzle-flash light. With physical inverse-square falloff those lights put 100-1000x the scene irradiance on the gun
  // (white blow-out). For the view-model pass only, every pooled light closer than RIG_D to the gun is pushed out to RIG_D along
  // the same direction (same colour, cone and intensity): the gun keeps the light's direction and warmth, the falloff across the
  // gun becomes plausible, and nothing changes for the world pass. Restored right after the view-model pass.
  _installLightRig() {
    const gfx = this.gfx, sc = gfx.scene, vmc = gfx.vmCamera; if (!sc || !vmc || sc.userData.vmRig) return; sc.userData.vmRig = true;
    const pb = sc.onBeforeRender, pa = sc.onAfterRender, self = this;
    sc.onBeforeRender = function (r, s, cam, rt, g, mat) { pb.call(this, r, s, cam, rt, g, mat); if (cam === vmc) self._rigLights(true); };
    sc.onAfterRender = function (r, s, cam, rt, g, mat) { pa.call(this, r, s, cam, rt, g, mat); if (cam === vmc) self._rigLights(false); };
    this._rigSaved = [];
  }
  _rigLights(on) {
    const P = this.gfx.pool; if (!P) return; const S = this._rigSaved;
    if (!on) { for (let i = 0; i < S.length; i++) { const e = S[i], l = e.l; l.position.copy(e.p); l.intensity = e.i; l.updateMatrixWorld(); if (l.target) { l.target.position.copy(e.t); l.target.updateMatrixWorld(); } e.l = null; } S.length = 0; return; }
    const cam = this.gfx.vmCamera; RIG_C.set(0, -0.08, -0.32).applyMatrix4(cam.matrixWorld); // representative gun point
    for (let k = 0; k < 2; k++) { const pool = k ? P.spots : P.points; if (!pool) continue;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i]; if (!(l.intensity > 0)) continue; RIG_D.copy(l.position).sub(RIG_C); const d = RIG_D.length(); if (d >= RIG_DIST) continue;
        let e = this._rigPool[S.length]; if (!e) e = this._rigPool[S.length] = { l: null, p: new THREE.Vector3(), t: new THREE.Vector3(), i: 0 }; e.l = l; e.p.copy(l.position); e.i = l.intensity; if (l.target) e.t.copy(l.target.position); S.push(e); if (k) l.intensity *= RIG_SPOT; // the flashlight sits right behind the eye: tame its retro-reflected glints on the gun
        if (d < 1e-3) RIG_D.set(0, 0, 1).transformDirection(cam.matrixWorld); else RIG_D.multiplyScalar(1 / d);
        RIG_D.multiplyScalar(RIG_DIST).add(RIG_C); RIG_T.copy(RIG_D).sub(l.position); l.position.copy(RIG_D); l.updateMatrixWorld();
        if (l.target) { l.target.position.add(RIG_T); l.target.updateMatrixWorld(); }
      }
    }
  }

  // ------------------------------------------------------------------ view-model lighting (hands + gun), derived from the atmosphere every frame
  // 1. colour constancy: the eye / a camera white-balances a scene lit by sodium lamps or neon; the view-model pass estimates the dominant illuminant
  //    (sun + sky + pooled lamps near the player) and hands / gun materials that read `uWB` (hands) and the VM fill (VM_FILL, all materials) are
  //    partly neutralised, so an olive sleeve stays olive under warm lamps and a black glove keeps modelling under blue night.
  // 2. a soft key light (upper left, behind the camera) and a rim light (behind the hands, upper right) that exist only in the view-model pass
  //    (layer 1): glove edges, knuckle guards and steel catch light in every stop; both scale with the scene (sun + ambient + lamps), never dark.
  _initVmLights() {
    const sc = this.gfx.scene; if (!sc || sc.userData.vmLights) return; sc.userData.vmLights = true;
    const mk = () => { const l = new THREE.DirectionalLight(0xffffff, 0); l.layers.set(1); l.castShadow = false; sc.add(l); sc.add(l.target); return l; };
    this.vmKey = mk(); this.vmRim = mk(); this._ill = new THREE.Vector3(); this._wb = new THREE.Vector3(1, 1, 1); this._wbT = new THREE.Vector3(); this._lampE = 0;
    this._keyDir = new THREE.Vector3(-0.45, 0.78, 0.5).normalize(); this._rimDir = new THREE.Vector3(0.6, 0.35, -0.72).normalize(); this._ld = new THREE.Vector3(); this._tc = new THREE.Color();
  }
  _vmLight(dt) {
    const gfx = this.gfx, A = gfx.atmo, cam = gfx.camera; if (!A || !this.vmKey || !cam) return; const ill = this._ill, sun = A.sun, sk = A.skyC, fg = A.fog;
    const sunE = sun.intensity, envI = A.env.intensity; ill.set(sun.color.r * sunE * 0.55, sun.color.g * sunE * 0.55, sun.color.b * sunE * 0.55);
    const ar = sk ? (sk.zenith.r + sk.horizon.r) * 0.5 : fg.color.r, ag = sk ? (sk.zenith.g + sk.horizon.g) * 0.5 : fg.color.g, ab = sk ? (sk.zenith.b + sk.horizon.b) * 0.5 : fg.color.b; const aw = envI * 0.6 * (sk ? 1 : 0.4);
    ill.x += (ar * 0.6 + fg.color.r * 0.4) * aw * 1.6; ill.y += (ag * 0.6 + fg.color.g * 0.4) * aw * 1.6; ill.z += (ab * 0.6 + fg.color.b * 0.4) * aw * 1.6;
    // pooled lamps / flashlight near the player (colour x intensity / d^2)
    let lampE = 0; const P = gfx.pool; if (P) for (let k = 0; k < 2; k++) { const pool = k ? P.spots : P.points; if (!pool) continue; for (let i = 0; i < pool.length; i++) { const l = pool[i]; if (!(l.intensity > 0)) continue; const dx = l.position.x - cam.position.x, dy = l.position.y - cam.position.y, dz = l.position.z - cam.position.z; const d2 = dx * dx + dy * dy + dz * dz + 1.5; if (d2 > 900) continue;
      const e = l.intensity / d2 * (k ? 0.5 : 1) * 0.35; ill.x += l.color.r * e; ill.y += l.color.g * e; ill.z += l.color.b * e; lampE += e; } }
    this._lampE += (lampE - this._lampE) * Math.min(1, dt * 4);
    const Lm = 0.2126 * ill.x + 0.7152 * ill.y + 0.0722 * ill.z; const wbT = this._wbT;
    if (Lm > 1e-3) { const cx = Math.min(2.6, Math.max(0.35, ill.x / Lm)), cy = Math.min(2.6, Math.max(0.35, ill.y / Lm)), cz = Math.min(2.6, Math.max(0.35, ill.z / Lm)); wbT.set(1 / cx, 1 / cy, 1 / cz); const w = 0.2126 * wbT.x + 0.7152 * wbT.y + 0.0722 * wbT.z; wbT.multiplyScalar(1 / w); const k = 0.42; wbT.set(Math.min(1.2, Math.max(0.85, 1 + (wbT.x - 1) * k)), Math.min(1.2, Math.max(0.85, 1 + (wbT.y - 1) * k)), Math.min(1.25, Math.max(0.85, 1 + (wbT.z - 1) * k))); } else wbT.set(1, 1, 1);
    const wb = this._wb, s = Math.min(1, dt * 3); wb.x += (wbT.x - wb.x) * s; wb.y += (wbT.y - wb.y) * s; wb.z += (wbT.z - wb.z) * s; HAND_LIGHT.wb.value.copy(wb);
    const F = this.mats.vmFill; if (F) { const w = 0.2126 * wb.x + 0.7152 * wb.y + 0.0722 * wb.z; F.value.x = wb.x / w * 0.94; F.value.y = wb.y / w; F.value.z = wb.z / w * 1.06; F.value.w = Math.min(0.5, Math.max(0.1, 0.55 * Math.exp(-0.9 * Lm))); /* floor fades in bright scenes (dusk yard) so the glove keeps contrast, stays in moonlight / tunnels */ }
    // key + rim: strength follows the scene (sun, ambient, lamps) with a floor so the hands never fall to a silhouette
    const keyI = Math.min(1.6, Math.max(0.42, 0.085 * sunE + 0.33 * envI + 0.22 * Math.min(3, this._lampE) + 0.36)); const ch = this._tc; const kc = 0.4;
    const kr = 1 + (ill.x / Math.max(Lm, 1e-3) - 1) * kc, kg = 1 + (ill.y / Math.max(Lm, 1e-3) - 1) * kc, kb = 1 + (ill.z / Math.max(Lm, 1e-3) - 1) * kc;
    this.vmKey.color.setRGB(Math.max(0.2, kr), Math.max(0.2, kg), Math.max(0.2, kb)); this.vmKey.intensity = keyI;
    this.vmRim.color.setRGB(0.82 + fg.color.r * 0.5, 0.9 + fg.color.g * 0.5, 1.0 + fg.color.b * 0.5); this.vmRim.intensity = keyI * 0.55;
    for (let k = 0; k < 2; k++) { const l = k ? this.vmRim : this.vmKey; this._ld.copy(k ? this._rimDir : this._keyDir).applyQuaternion(cam.quaternion); l.position.copy(cam.position).add(this._ld); l.target.position.copy(cam.position); }
  }

  // ------------------------------------------------------------------ setup
  _build(id) { if (this.guns[id]) return this.guns[id]; const t0 = performance.now(); const g = this._addGun(id, this.models[id], this.specs[id]); this.timing[id] = performance.now() - t0; this._prewarm(g); return g; }
  /** build the remaining guns one per call (call from an idle timer); returns true while work remains */
  buildNext() { while (this._bg.length && this.guns[this._bg[0]]) this._bg.shift(); if (!this._bg.length) return false; this._build(this._bg.shift()); return this._bg.length > 0; }
  _prewarm(g) { const r = this.gfx.renderer; if (!r?.compileAsync) return; const grp = g.rig.group, v = grp.visible; grp.visible = true; try { r.compileAsync(grp, this.gfx.vmCamera, this.gfx.scene).catch(() => {}); } catch (e) { /* older three */ } grp.visible = v; }
  _addGun(id, def, spec) {
    const data = modelData(def, this.mats); const rig = new GunRig(data, this.mats, { layer: 1 }); rig.group.visible = false; this.holder.add(rig.group);
    const H = def.handling || {}; const g = { id, def, spec, rig, H, data, clips: {}, frames: {}, flash: null };
    g.handDef = { R: H.hands?.R || { f: 'gripR', pose: 'relaxed' }, L: H.hands?.L || { f: 'gripL', pose: 'relaxed' } };
    // frames (palm-centre hand frames): gun part frames or camera frames
    for (const [n, F] of Object.entries(H.frames || {})) {
      if (F.cam) { const m = frameMatrix(F); const p = new THREE.Vector3(), q = new THREE.Quaternion(); m.decompose(p, q, _S); g.frames[n] = { cam: true, pos: p, quat: q }; }
      else { const part = data.K.byName[F.part || 'root']; const m = frameMatrix(F); m.premultiply(new THREE.Matrix4().makeTranslation(-part.pivot.x, -part.pivot.y, -part.pivot.z)); g.frames[n] = { bone: part.index, local: m }; }
    }
    for (const [n, c] of Object.entries(H.clips || {})) g.clips[n] = makeClip({ ...c, name: n });
    if (H.sprintHands) { g.sprintHands = {}; for (const [side, k] of Object.entries(H.sprintHands)) { const c = makeClip({ dur: 1, tracks: { x: [[0, k]] } }); g.sprintHands[side] = c.tracks.x[0].v; } }
    // base poses
    g.hipM = this._poseMatrix(H.hip); g.sprintM = this._poseMatrix(H.sprint || H.hip); g.adsM = this._adsMatrix(g, H);
    g.pivot = new THREE.Vector3(...(H.pivot || [0, -0.05, 0.05])); g.animPivot = new THREE.Vector3(...(H.animPivot || H.pivot || [0, -0.05, 0.05]));
    // muzzle flash attached to the muzzle socket's bone
    if (spec && spec.flash && rig.sockets.muzzle) { const f = new MuzzleFlash(spec.flash.style, { size: spec.flash.size, len: spec.flash.len }); const s = rig.sockets.muzzle; f.mesh.matrixAutoUpdate = false; f.mesh.matrix.copy(s.local); f.mesh.layers.set(1); rig.boneList[s.bone].add(f.mesh); g.flash = f; }
    g.ejectInClip = !!(g.clips.fire && g.clips.fire.events.some((e) => e[1] === 'eject'));
    this.guns[id] = g; this.tris = Math.max(this.tris, data.tris + this.hands.tris);
    return g;
  }
  _addProp(id, def) {
    const data = modelData(def, this.mats); const rig = new GunRig(data, this.mats, { layer: 1 }); rig.group.visible = false; rig.group.matrixAutoUpdate = false; this.root.add(rig.group);
    const pr = this.props[id] = { rig, H: def.handling || {}, data, frames: {} };
    for (const [n, F] of Object.entries(pr.H.frames || {})) { const part = data.K.byName[F.part || 'root']; const m = frameMatrix(F); m.premultiply(new THREE.Matrix4().makeTranslation(-part.pivot.x, -part.pivot.y, -part.pivot.z)); pr.frames[n] = { bone: part.index, local: m, prop: pr }; }
  }
  _poseMatrix(p) { if (!p) return new THREE.Matrix4(); _E.set((p.r?.[0] || 0) * D, (p.r?.[1] || 0) * D, (p.r?.[2] || 0) * D, 'YXZ'); return new THREE.Matrix4().compose(new THREE.Vector3(...p.p), new THREE.Quaternion().setFromEuler(_E), _one); }
  /** ADS: place the gun so the rear-sight -> front-sight line lies on the camera axis, rear sight `eye` metres ahead. */
  _adsMatrix(g, H) {
    const s = g.rig.sockets; if (!s.sightRear || !s.sightFront) return g.hipM.clone();
    const R = s.sightRear.pos.clone(), F = s.sightFront.pos.clone(); const dir = F.clone().sub(R).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(0, 0, -1)); if (H.adsRoll) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), H.adsRoll * D));
    const eye = H.eye ?? 0.3; const pos = new THREE.Vector3(0, 0, -eye).sub(R.clone().applyQuaternion(q)); if (H.adsOffset) pos.add(new THREE.Vector3(...H.adsOffset));
    return new THREE.Matrix4().compose(pos, q, _one);
  }

  // ------------------------------------------------------------------ control
  setGun(id) {
    if (this.cur) this.cur.rig.group.visible = false; const g = this.cur = this.guns[id] || (this.models[id] ? this._build(id) : null); if (!g) return;
    g.rig.group.visible = true; const r = g.spec?.recoil; if (r) for (const k in this.recoil) { this.recoil[k].k = r.k; this.recoil[k].c = r.c; this.recoil[k].x = 0; this.recoil[k].v = 0; }
    const h = g.H; this.hands.shoulder.R.fromArray(h.shoulderR || [0.19, -0.24, 0.1]); this.hands.shoulder.L.fromArray(h.shoulderL || [-0.19, -0.24, 0.1]);
    this.hands.pole.R.fromArray(h.poleR || [0.7, -1, 0.1]); this.hands.pole.L.fromArray(h.poleL || [-0.7, -1, 0.1]);
    this.gfx.setVmFov(g.spec?.vmFov || 54); this.act.clip = null; this.act.done = true; this.fireCh.clip = null;
  }
  has(clip) { return !!(this.cur && this.cur.clips[clip]); }
  clipDur(clip) { return this.cur?.clips[clip]?.dur || 0; }
  /** play an action clip on the current gun (or a prop-driven clip given as object) */
  play(name, { speed = 1, onEvent = null, onEnd = null, clip = null } = {}) {
    const c = clip || this.cur?.clips[name]; if (!c) { onEnd?.(); return false; }
    const A = this.act; A.clip = c; A.t = 0; A.speed = speed; A.name = name; A.onEvent = onEvent; A.onEnd = onEnd; A.done = false; return true;
  }
  stop() { const A = this.act; A.clip = null; A.done = true; }
  get busy() { return !this.act.done; }
  fire(name = 'fire', speed = 1, onEvent = null) { const c = this.cur?.clips[name]; if (!c) return; const F = this.fireCh; F.clip = c; F.t = 0; F.speed = speed; F.onEvent = onEvent; this.cur.flash?.fire(1); if (onEvent) fireEvents(c, -1, 0, onEvent); }
  kick(spec, adsK) { // recoil impulses into the view-model springs (per-shot variation)
    const r = spec.recoil, R = this.recoil, a = 1 - adsK * 0.35, j = jit, sg = sgn;
    R.pz.kick(r.vmBack * j() * a); R.py.kick(r.vmBack * 0.12 * j()); R.rx.kick(r.vmPitch * j() * (1 - adsK * 0.25)); R.rz.kick(r.vmRoll * sg() * j() * a); R.ry.kick(r.vmSide * sg() * j() * a); R.px.kick(r.vmSide * 0.004 * sg());
  }

  // ------------------------------------------------------------------ frame
  /** ctx: {player, input, dt, sens} ; returns nothing. Call after player.update (camera placed). */
  update(dt, ctx) {
    const g = this.cur; this.time += dt; if (!g) return; const pl = ctx.player; this._vmLight(dt);
    // ---- channels
    const A = this.act; if (A.clip && !A.done) { const t0 = A.t; A.t += dt * A.speed; if (A.onEvent) fireEvents(A.clip, t0, A.t, A.onEvent); if (A.t >= A.clip.dur) { A.done = true; const cb = A.onEnd; A.onEnd = null; A.t = A.clip.dur; cb?.(); if (A.done) A.clip = null; } }
    const Fc = this.fireCh; if (Fc.clip) { const t0 = Fc.t; Fc.t += dt * Fc.speed; if (Fc.onEvent) fireEvents(Fc.clip, t0, Fc.t, Fc.onEvent); if (Fc.t >= Fc.clip.dur) Fc.clip = null; } // fire-clip events (casing eject at the slide's rearmost point)
    // ---- procedural inputs
    for (let i = 0; i < this._springs.length; i++) this._springs[i].step(dt);
    const inp = ctx.input; const adsE = smoother(this.adsK); if (this.mats.adsU) this.mats.adsU.value = adsE; // peep-sight defocus
    if (g.spec) { const f = g.spec.vmFov + ((g.spec.adsVmFov || g.spec.vmFov) - g.spec.vmFov) * adsE; if (Math.abs(f - this.gfx.vmCamera.fov) > 0.01) this.gfx.setVmFov(f); } const swayMul = (1 - adsE * 0.72) * (1 - this.sprintK * 0.3);
    const dx = inp ? inp.dx : 0, dy = inp ? inp.dy : 0; const sens = ctx.sens || 1;
    this.sway.y.target = Math.max(-0.07, Math.min(0.07, dx * 0.00075 * sens)) * swayMul; this.sway.x.target = Math.max(-0.05, Math.min(0.05, dy * 0.0006 * sens)) * swayMul; this.sway.r.target = this.sway.y.target * 0.9;
    this.sway.x.step(dt); this.sway.y.step(dt); this.sway.r.step(dt);
    // step-synced bob (phase from the player's stride accumulator; footfall at phase 0)
    let bobX = 0, bobY = 0, bobR = 0, bobYaw = 0;
    if (pl) {
      const sd = pl.stepDist || 0; if (sd < this._lastStepDist - 0.05) this.stepCount++; this._lastStepDist = sd; const stride = pl.sprinting ? 2.0 : pl.crouching ? 1.1 : 1.45; this.stepPhase = Math.min(1, sd / stride);
      const spd = pl.moveSpeed || 0; const amp = pl.onGround ? Math.min(1.4, spd / 4) : 0; this.bobAmp += (amp - this.bobAmp) * Math.min(1, dt * 8);
      const A2 = this.bobAmp * (1 - adsE * 0.82) * (1 + this.sprintK * 0.8); const ph = this.stepPhase, side = (this.stepCount & 1) ? 1 : -1;
      const dip = Math.pow(0.5 + 0.5 * Math.cos(ph * Math.PI * 2), 2); // strongest just at the footfall
      bobY = (-0.0055 * dip + 0.0022) * A2; bobX = 0.0045 * Math.sin((ph + (side > 0 ? 0 : 1)) * Math.PI) * A2; bobR = bobX * 3.5; bobYaw = bobX * 1.2;
      this.airK += ((pl.onGround ? 0 : 1) - this.airK) * Math.min(1, dt * 6);
    }
    const land = pl && pl.landDip ? pl.landDip.x : 0;
    // breathing / idle
    const t = this.time, idle = this.still ? 0 : (1 - adsE * 0.75) * (1 - this.sprintK); if (this.still) { bobX = bobY = bobR = bobYaw = 0; }
    const brY = Math.sin(t * 1.55) * 0.0009 * idle, brRx = Math.sin(t * 1.05 + 0.4) * 0.0045 * idle + Math.sin(t * 0.37) * 0.002 * idle, brRy = Math.sin(t * 0.71 + 1.3) * 0.0035 * idle;
    // ---- base pose (hip / ads / sprint)
    const PB = this.pose.P, QB = this.pose.Q;
    g.hipM.decompose(PB, QB, _S); g.adsM.decompose(_P, _Q, _S); PB.lerp(_P, adsE); QB.slerp(_Q, adsE);
    if (this.sprintK > 0.001) { g.sprintM.decompose(_P, _Q, _S); const sk = sstep(this.sprintK); PB.lerp(_P, sk); QB.slerp(_Q, sk); }
    // procedural offsets (camera space translation, rotation about the pivot in gun space)
    const R = this.recoil, pr = this.pose.procR, pp = this.pose.proc;
    pp.set(bobX - this.sway.y.x * 0.06 + R.px.x, bobY + brY + land * 0.02 - this.sway.x.x * 0.03 + R.py.x - this.airK * 0.006, R.pz.x);
    pr.set(this.sway.x.x + brRx + R.rx.x + land * 0.05 - bobY * 0.8 + this.airK * 0.02, this.sway.y.x + brRy + R.ry.x + bobYaw, this.sway.r.x + R.rz.x + bobR);
    // animation-pivot rotations (deg): clip 'gun' track + wall retract + lowered; translations add to pp
    let cx = 0, cy = 0, cz = 0;
    if (this._numTrack('gun', NUM, 6)) { pp.x += NUM[0]; pp.y += NUM[1]; pp.z += NUM[2]; cx += NUM[3]; cy += NUM[4]; cz += NUM[5]; }
    if (this.wallK > 0.001) { const w = sstep(this.wallK); const W = g.H.wall || WALL0; pp.x += W.p[0] * w; pp.y += W.p[1] * w; pp.z += W.p[2] * w; cx += W.r[0] * w; cy += W.r[1] * w; cz += W.r[2] * w; }
    if (this.lowerK > 0.001) { const w = sstep(this.lowerK); pp.y -= 0.22 * w; pp.x += 0.04 * w; pp.z += 0.05 * w; cx -= 50 * w; cz -= 20 * w; }
    // compose: T(P + pp) R(Q) [T(pivot) R(pr) T(-pivot)] [T(ap) R(c) T(-ap)]
    const M = this.holder.matrix; _E.set(pr.x, pr.y, pr.z, 'YXZ'); _Q.setFromEuler(_E);
    M.makeTranslation(g.pivot.x, g.pivot.y, g.pivot.z); _M.makeRotationFromQuaternion(_Q); M.multiply(_M); _M.makeTranslation(-g.pivot.x, -g.pivot.y, -g.pivot.z); M.multiply(_M);
    if (cx || cy || cz) { const ap = g.animPivot; _E.set(cx * D, cy * D, cz * D, 'YXZ'); _Q.setFromEuler(_E); _M.makeTranslation(ap.x, ap.y, ap.z); M.multiply(_M); _M.makeRotationFromQuaternion(_Q); M.multiply(_M); _M.makeTranslation(-ap.x, -ap.y, -ap.z); M.multiply(_M); }
    _M.compose(_P.copy(PB).add(pp), QB, _one); M.premultiply(_M); this.holder.matrixWorldNeedsUpdate = true;
    // ---- parts
    const rig = g.rig; rig.reset(); if (g.H.parts) g.H.parts(rig, this.st, this);
    this._partTracks(Fc.clip, Fc.t, rig); this._partTracks(A.clip, A.t, rig);
    rig.solve();
    // ---- hands + held props (R first: the left hand may grab a prop held by the right)
    this._hand('R', g); this._held('R'); this._hand('L', g); this._held('L');
    g.flash?.update(dt);
  }
  _numTrack(name, out, n) {
    let used = false; for (let i = 0; i < n; i++) out[i] = 0;
    for (let q = 0; q < 2; q++) { const ch = q ? this.act : this.fireCh; const c = ch.clip; if (!c) continue; const k = c.tracks[name]; if (!k) continue; NUM2.fill(0); sampleNum(k, ch.t, NUM2); for (let i = 0; i < n; i++) out[i] += NUM2[i] || 0; used = true; }
    return used;
  }
  _partTracks(clip, t, rig) {
    if (!clip) return; const tr = clip.tracks;
    for (const name in tr) { if (name === 'gun' || name === 'L' || name === 'R' || name === 'holdL' || name === 'holdR' || name === 'vis') continue; const bi = rig.index(name); if (bi < 0) continue; NUM2.fill(0); sampleNum(tr[name], t, NUM2); rig.setI(bi, NUM2[0] || 0, NUM2[1] || 0, NUM2[2] || 0, (NUM2[3] || 0) * D, (NUM2[4] || 0) * D, (NUM2[5] || 0) * D); }
    const vis = tr.vis; if (vis) { const s = seg(vis, t); const v = vis[s.e >= 1 ? s.i1 : s.i0].v; for (const k in v) rig.scale(k, v[k]); }
  }
  /** resolve a named frame (+ key offsets) to camera space */
  _resolve(g, side, key, outP, outQ) {
    if (key && key.camP) { outP.copy(key.camP); outQ.copy(key.camQ); return; }
    let f = key ? key.f : 'rest'; if (f === 'rest' || !f) f = g.handDef[side].f || GRIP[side];
    const F = g.frames[f] || this._propFrame(f);
    if (!F) { outP.set(side === 'R' ? 0.2 : -0.2, -0.5, -0.2); outQ.identity(); }
    else if (F.cam) { outP.copy(F.pos); outQ.copy(F.quat); }
    else { _M2.multiplyMatrices(F.prop ? F.prop.rig.rel[F.bone] : g.rig.rel[F.bone], F.local); _M2.premultiply(F.prop ? F.prop.rig.group.matrix : this.holder.matrix); _M2.decompose(outP, outQ, _S); }
    if (key && key.p) outP.add(_V.set(key.p[0], key.p[1], key.p[2]).applyQuaternion(outQ));
    if (key && key.r) { _E.set(key.r[0] * D, key.r[1] * D, key.r[2] * D, 'XYZ'); outQ.multiply(_Q2.setFromEuler(_E)); }
  }
  _propFrame(name) { // 'prop:frame' (cached: no string slicing per frame)
    const c = this._pf || (this._pf = new Map()); let f = c.get(name); if (f !== undefined) return f;
    const i = name.indexOf(':'); const pr = i < 0 ? null : this.props[name.slice(0, i)]; f = (pr && pr.frames?.[name.slice(i + 1)]) || null; c.set(name, f); return f; }
  _hand(side, g) {
    const MH = this.manualHands && this.manualHands[side]; if (MH) { this.hands.setArm(side, _V.fromArray(MH.p), _Q.set(MH.q[0], MH.q[1], MH.q[2], MH.q[3]), typeof MH.pose === 'string' ? POSE_ARR[MH.pose] : (MH.pose || POSE_ARR.relaxed), undefined, MH.pole ? _POLE.fromArray(MH.pole) : undefined); return; } // (tools: pose the hands freely)
    const T = this.handT[side]; const trackName = side; let keys = this.act.clip?.tracks[trackName]; let tt = this.act.t;
    if (!keys) { keys = this.fireCh.clip?.tracks[trackName]; tt = this.fireCh.t; }
    const def = g.handDef[side]; let pole;
    if (keys) {
      const s = seg(keys, tt); const k0 = keys[s.i0].v, k1 = keys[s.i1].v, e = s.e;
      this._resolve(g, side, k0, T.P, T.Q); const pa = k0.poseArr || POSE_ARR[def.pose]; POSE_A.set(pa);
      if (s.i1 !== s.i0 && e > 0) { this._resolve(g, side, k1, _P2, _Q2); T.P.lerp(_P2, e); T.Q.slerp(_Q2, e); const pb = k1.poseArr || POSE_ARR[def.pose]; blendPose(POSE_A, pb, e, POSE_A); }
      // optional per-key elbow pole (e.g. elbow out to the side for an over-the-top slap), blended with the gun's default pole
      if (k0.pole || k1.pole) { const dp = this.hands.pole[side], a = k0.pole, b = s.i1 !== s.i0 ? k1.pole : a, w = s.i1 !== s.i0 ? e : 0; pole = _POLE.set(a ? a[0] : dp.x, a ? a[1] : dp.y, a ? a[2] : dp.z).lerp(_V2.set(b ? b[0] : dp.x, b ? b[1] : dp.y, b ? b[2] : dp.z), w); }
    } else {
      this._resolve(g, side, null, T.P, T.Q); POSE_A.set(POSE_ARR[def.pose] || POSE_ARR.relaxed);
      // sprint: support hand lets go on one-handed guns
      const sp = g.sprintHands?.[side]; if (sp && this.sprintK > 0.001) { const k = sstep(this.sprintK); this._resolve(g, side, sp, _P2, _Q); T.P.lerp(_P2, k); T.Q.slerp(_Q, k); blendPose(POSE_A, POSE_ARR[sp.pose] || POSE_A, k, POSE_A); }
    }
    // trigger finger
    if (side === 'R' && this.triggerK > 0) { const k = this.triggerK; POSE_A[5] += 10 * k; POSE_A[6] += 16 * k; POSE_A[7] += 8 * k; }
    T.pose.set(POSE_A);
    // wrist from palm centre
    _V.copy(PALM[side]).applyQuaternion(T.Q); _P.copy(T.P).sub(_V);
    this.hands.setArm(side, _P, T.Q, T.pose, undefined, pole);
  }
  /** attach a prop (knife / grenade / shell) to a hand; its 'grip' socket goes to the palm frame (+ H.hold offset) */
  hold(side, id) { const cur = this.held[side]; if (cur && cur !== id && this.props[cur]) this.props[cur].rig.group.visible = false; this.held[side] = id || null; if (id && this.props[id]) this.props[id].rig.group.visible = true; }
  _held(side) {
    // clip-driven hold tracks
    const tr = this.act.clip?.tracks[HOLD[side]]; if (tr) { const s = seg(tr, this.act.t); const v = tr[s.e >= 1 ? s.i1 : s.i0].v; const id = typeof v === 'string' ? v : v?.id || ''; if ((id || null) !== this.held[side]) this.hold(side, id); }
    const id = this.held[side]; if (!id) return; const pr = this.props[id]; if (!pr) return; const T = this.handT[side];
    const H = pr.H; const gh = this.cur?.H.propHold?.[id]; const off = gh || (side === 'L' ? (H.holdL || H.hold) : (H.holdR || H.hold)); // per-gun override (e.g. shell pinched at the rim)
    // palm frame -> object: M = T(palm) R(palmQ) T(off.p) R(off.r) inverse(gripSocket)
    _M.compose(T.P, T.Q, _one); if (off) { _E.set(off.r[0] * D, off.r[1] * D, off.r[2] * D, 'XYZ'); _M2.compose(_V.set(off.p[0], off.p[1], off.p[2]), _Q.setFromEuler(_E), _one); _M.multiply(_M2); }
    const s = pr.rig.sockets.grip; if (s) { _M2.compose(s.pos, s.quat, _one).invert(); _M.multiply(_M2); }
    pr.rig.group.matrix.copy(_M); pr.rig.group.matrixWorldNeedsUpdate = true; pr.rig.reset(); if (H.parts) H.parts(pr.rig, this.st, this); pr.rig.solve();
  }

  // ------------------------------------------------------------------ effect positions
  /** socket of the current gun in camera space -> out Matrix4 */
  socketCam(name, out) { const g = this.cur; if (!g || !g.rig.sockets[name]) return null; g.rig.socket(name, out); out.premultiply(this.holder.matrix); return out; }
  /** camera-space point -> world point that APPEARS at the same screen position in the world camera (FOV-corrected). */
  camToWorld(q, out, cam = this.gfx.camera) { const k = Math.tan(cam.fov * D / 2) / Math.tan(this.gfx.vmCamera.fov * D / 2); out.set(q.x * k, q.y * k, q.z); return out.applyMatrix4(cam.matrixWorld); }
  /** actual world position of a camera-space point (for lights) */
  camToWorldTrue(q, out, cam = this.gfx.camera) { return out.copy(q).applyMatrix4(cam.matrixWorld); }
  setVisible(v) { this.root.visible = v; }
}
const NUM2 = new Float32Array(8);
