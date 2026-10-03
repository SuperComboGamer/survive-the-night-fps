// Spawn animations driven through Animator.scripted (same FK/IK/skinning path as locomotion):
//   RiseScript      — claws out of the ground/snow/water: hands burst through, pull-up on planted hands, knee up, stand.
//   BarricadeScript — walks to the window, tears boards one by one (calls barricade.tearNext on the yank frame), steps through.
//   LadderScript    — treads water toward the ladder, climbs hand-over-hand on the real rung spacing (hands/feet IK on rungs),
//                     mantles onto the deck at ladderTop.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../../core/util.js';

const V3 = THREE.Vector3;
const _d = new V3(), _o = new V3(), _t = new V3(), _r = new V3(), _fw = new V3(), _rt = new V3(); // scratch (no per-frame allocation)
const ease = (t) => t * t * (3 - 2 * t);
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
function mkScripted() { return { x: 0, y: 0, z: 0, yaw: 0, hipY: 0, pitch: 0, roll: 0, spine: 0, twist: 0, headP: 0, headY: 0, jaw: 0.1, arm: { L: null, R: null }, hand: { L: null, R: null }, foot: { L: null, R: null }, vx: 0, vz: 0 }; }
function armPose(o, f, a, e, curl = 0.6, pron = 0.6) { o.f = f; o.a = a; o.e = e; o.curl = curl; o.pron = pron; o.k = 110; o.c = 15; return o; }

// ------------------------------------------------------------------ RISE
export class RiseScript {
  constructor(z, mgr) {
    this.z = z; this.m = mgr; this.t = 0; this.T = 3.3; this.S = mkScripted(); this.g = z.anim.pos.clone(); this.yaw = z.anim.yaw;
    this.hL = new V3(); this.hR = new V3(); this.fR = { ankle: new V3(), yaw: 0, pitch: 0, stance: true }; this.fL = { ankle: new V3(), yaw: 0, pitch: 0, stance: true };
    this.aL = {}; this.aR = {}; this.fx = 0; this.surface = mgr.surfaceAt(this.g); this.burst = false;
  }
  update(dt) {
    const z = this.z, A = z.anim, s = A.scale, S = this.S; this.t += dt; const t = this.t;
    const fw = _fw.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), rt = _rt.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    // depth profile (root below ground)
    const y0 = this.g.y; let dep = -1.95 * s;
    dep = lerp(dep, -1.25 * s, ease(seg(t, 0.35, 1.0))); dep = lerp(dep, -0.6 * s, ease(seg(t, 1.0, 1.9))); dep = lerp(dep, -0.18 * s, ease(seg(t, 1.9, 2.7))); dep = lerp(dep, 0, ease(seg(t, 2.7, 3.3)));
    const lean = lerp(0.1, 0.75, ease(seg(t, 0.9, 1.6))) * (1 - ease(seg(t, 2.4, 3.3)));
    S.x = this.g.x; S.z = this.g.z; S.y = y0 + dep; S.yaw = this.yaw; S.hipY = S.y + 0.925 * s * (1 - 0.18 * (1 - ease(seg(t, 2.6, 3.3))));
    S.pitch = lean * 0.4; S.spine = lean; S.headP = lean * 0.8 + 0.1; S.jaw = t > 0.5 && t < 2.6 ? 0.3 + 0.1 * Math.sin(t * 9) : 0.1;
    // arms: burst upward, then planted hands, then neutral
    const up = 1 - seg(t, 0.95, 1.2);
    armPose(this.aL, lerp(1.2, 2.85, up), 0.25, lerp(0.7, 0.25, up), 0.9, 0.4); armPose(this.aR, lerp(1.2, 2.9, up), 0.22, lerp(0.7, 0.3, up), 0.9, 0.4);
    S.arm.L = t < 2.9 ? this.aL : null; S.arm.R = t < 2.9 ? this.aR : null;
    const plant = t > 1.05 && t < 2.55;
    if (plant) { this.hL.copy(this.g).addScaledVector(fw, 0.42 * s).addScaledVector(rt, -0.26 * s); this.hR.copy(this.g).addScaledVector(fw, 0.45 * s).addScaledVector(rt, 0.27 * s); this.hL.y = y0 + 0.02; this.hR.y = y0 + 0.02; S.hand.L = this.hL; S.hand.R = this.hR; } else { S.hand.L = null; S.hand.R = null; }
    // knee up: right foot plants on the surface in front, then both feet to stance
    if (t > 1.95) {
      this.fR.ankle.copy(this.g).addScaledVector(fw, lerp(0.35, 0.0, ease(seg(t, 2.7, 3.2))) * s).addScaledVector(rt, 0.1 * s); this.fR.ankle.y = y0 + 0.08 * s; this.fR.yaw = this.yaw; this.fR.stance = true;
      this.fL.ankle.copy(this.g).addScaledVector(rt, -0.1 * s).addScaledVector(fw, -0.05 * s); this.fL.ankle.y = lerp(y0 - 0.5 * s, y0 + 0.08 * s, ease(seg(t, 2.5, 3.1))); this.fL.yaw = this.yaw; this.fL.stance = t > 3.0;
      S.foot.R = this.fR; S.foot.L = t > 2.45 ? this.fL : null;
    } else { S.foot.L = null; S.foot.R = null; }
    A.scripted = S;
    // effects: dirt / snow bursts at the surface
    if (!this.burst && t > 0.42) { this.burst = true; this.m.groundBurst(this.g, this.surface, 1.0); this.m.voice(z, 'spawn'); }
    this.fx -= dt; if (t > 0.45 && t < 2.8 && this.fx <= 0) { this.fx = 0.22; this.m.groundBurst(this.g, this.surface, 0.3); }
    if (t >= this.T) { A.scripted = null; A.reset(this.g, this.yaw, s); return true; }
    return false;
  }
}

// ------------------------------------------------------------------ BARRICADE
export class BarricadeScript {
  constructor(z, mgr, spawnDef, barricade) {
    this.z = z; this.m = mgr; this.b = barricade || null; this.def = spawnDef || {}; this.t = 0; this.phase = 'approach'; this.S = mkScripted();
    const yaw = this.b ? this.b.yaw : (spawnDef?.yaw ?? z.anim.yaw); this.yaw = yaw; this.fw = new V3(-Math.sin(yaw), 0, -Math.cos(yaw)); this.rt = new V3(Math.cos(yaw), 0, -Math.sin(yaw));
    // opening: integrator's Barricade.pos is the opening base centre; else 0.8 m ahead of the spawn point
    this.open = this.b ? this.b.pos.clone() : z.anim.pos.clone().addScaledVector(this.fw, 0.8);
    this.stand = this.open.clone().addScaledVector(this.fw, -0.5); this.virtualBoards = this.b ? 0 : (spawnDef?.boards ?? 0);
    this.cycle = 0; this.aL = {}; this.aR = {}; this.hL = new V3(); this.hR = new V3(); this.fL = { ankle: new V3(), yaw, pitch: 0, stance: true }; this.fR = { ankle: new V3(), yaw, pitch: 0, stance: true };
    this.tore = false; this.throughT = 0; this.sill = spawnDef?.sill ?? 0;
  }
  boards() { return this.b ? this.b.boards : this.virtualBoards; }
  boardY(k) { if (this.b && this.b.planks && this.b.planks[k]) return this.b.pos.y + this.b.planks[k].userData.home.y; return this.open.y + 0.35 + k * 0.32; }
  update(dt) {
    const z = this.z, A = z.anim, s = A.scale; this.t += dt;
    if (this.phase === 'approach') {
      const d = _d.subVectors(this.stand, A.pos); d.y = 0; const dist = d.length();
      if (dist < 0.1 || this.t > 8) { this.phase = this.boards() > 0 ? 'tear' : 'through'; this.cycle = 0; A.want.vx = 0; A.want.vz = 0; this._lockFeet(); return false; }
      const sp = Math.min(z.speed, 1.2) * clamp(dist / 0.5, 0.3, 1); A.want.vx = d.x / dist * sp; A.want.vz = d.z / dist * sp; A.want.faceYaw = this.yaw; A.want.hasLook = true; A.want.look.copy(this.open).setY(this.open.y + 1.2);
      return 'loco';
    }
    if (this.phase === 'tear') {
      if (this.boards() <= 0) { this.phase = 'through'; this.throughT = 0; A.scripted = null; A.reset(A.pos, this.yaw, s); return false; }
      this.cycle += dt; const c = this.cycle, T = 1.55; const k = this.boards() - 1; const by = this.boardY(k);
      const reach = ease(seg(c, 0.0, 0.42)), yank = ease(seg(c, 0.68, 0.9)), rec = ease(seg(c, 0.95, T));
      const S = this.S; S.x = this.stand.x; S.z = this.stand.z; S.y = A.pos.y; S.yaw = this.yaw;
      const back = yank * (1 - rec) * 0.14 * s; S.px = 0; S.pz = back / s; S.hipY = S.y + 0.925 * s * (0.97 - 0.05 * yank * (1 - rec));
      S.pitch = lerp(0.15, -0.05, yank) * (1 - rec) + 0.08 * rec; S.spine = lerp(0.35 * reach, -0.2, yank * (1 - rec)) + 0.15 * rec; S.twist = Math.sin(c * 3) * 0.08;
      S.headP = clamp((by - (S.y + 1.55 * s)) * 1.2, -0.5, 0.4); S.headY = 0; S.jaw = yank > 0.1 && rec < 0.5 ? 0.4 : 0.15;
      // hands to the board, grip, pull back
      const hold = c > 0.4 && c < 0.95;
      if (hold) { const pull = yank * 0.35 * s; this.hL.copy(this.open).addScaledVector(this.rt, -0.2 * s).addScaledVector(this.fw, 0.03 - pull); this.hL.y = by; this.hR.copy(this.open).addScaledVector(this.rt, 0.22 * s).addScaledVector(this.fw, 0.03 - pull); this.hR.y = by + 0.02; S.hand.L = this.hL; S.hand.R = this.hR; }
      else { S.hand.L = null; S.hand.R = null; }
      armPose(this.aL, lerp(0.6, 1.5 + (by - A.pos.y - 1.2) * 0.8, reach) * (1 - rec * 0.5), 0.3, 0.6, hold ? 1.1 : 0.7, 0.6); armPose(this.aR, lerp(0.6, 1.5 + (by - A.pos.y - 1.2) * 0.8, reach) * (1 - rec * 0.5), 0.3, 0.6, hold ? 1.1 : 0.7, 0.6);
      S.arm.L = this.aL; S.arm.R = this.aR; S.foot.L = this.fL; S.foot.R = this.fR;
      A.scripted = S;
      if (!this.tore && c > 0.8) { this.tore = true; if (this.b) this.b.tearNext(1); else this.virtualBoards = Math.max(0, this.virtualBoards - 1); this.m.onBoardTorn?.(z, this.def, this.boards()); this.m.voice(z, 'attack'); }
      if (c >= T) { this.cycle = 0; this.tore = false; }
      return false;
    }
    // through: step through the opening with high steps, then hand over to the AI
    this.throughT += dt; A.scripted = null;
    const out = _o.copy(this.open).addScaledVector(this.fw, 1.0); const d = _d.subVectors(out, A.pos); d.y = 0; const dist = d.length();
    A.idio.clearBoost = 0.18; const sp = Math.min(z.speed, 1.1);
    A.want.vx = d.x / (dist || 1) * sp; A.want.vz = d.z / (dist || 1) * sp; A.want.faceYaw = this.yaw;
    if (dist < 0.25 || this.throughT > 4) { A.idio.clearBoost = 0; return true; }
    return 'loco';
  }
  _lockFeet() { const A = this.z.anim; this.fL.ankle.copy(A.feet[0].ankle); this.fR.ankle.copy(A.feet[1].ankle); this.fL.yaw = A.feet[0].yaw; this.fR.yaw = A.feet[1].yaw; }
}

// ------------------------------------------------------------------ LADDER (swim → climb → mantle)
export class LadderScript {
  constructor(z, mgr, spawnDef) {
    this.z = z; this.m = mgr; this.def = spawnDef; this.S = mkScripted(); this.t = 0; this.phase = 'swim';
    const o = mgr.stopOrigin(); const P = (a) => new V3(a[0] + o.x, a[1] + o.y, a[2] + o.z);
    const path = spawnDef.path && spawnDef.path.length >= 2 ? spawnDef.path : [[spawnDef.pos[0], spawnDef.pos[1] - 1, spawnDef.pos[2]], [spawnDef.pos[0], spawnDef.pos[1] + 2.5, spawnDef.pos[2]]];
    this.bot = P(path[0]); this.top = P(path[path.length - 1]); this.deck = spawnDef.ladderTop ? P(spawnDef.ladderTop) : this.top.clone();
    const dx = this.deck.x - this.bot.x, dz = this.deck.z - this.bot.z; this.yaw = (Math.abs(dx) + Math.abs(dz) > 0.05) ? Math.atan2(-dx, -dz) : (spawnDef.yaw ?? 0);
    this.fw = new V3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); this.rt = new V3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.rung = spawnDef.rung ?? 0.3; this.water = mgr.waterY(this.bot) ?? this.bot.y + 0.4;
    this.base = this.bot.clone().addScaledVector(this.fw, -0.34); // where the body hangs in front of the rungs
    this.aL = {}; this.aR = {}; this.hand = { L: { r: 0, t: 1, from: new V3(), p: new V3() }, R: { r: 0, t: 1, from: new V3(), p: new V3() } }; this.foot = { L: { r: 0, t: 1, from: new V3(), p: new V3() }, R: { r: 0, t: 1, from: new V3(), p: new V3() } };
    this.fL = { ankle: new V3(), yaw: this.yaw, pitch: 0, stance: false }; this.fR = { ankle: new V3(), yaw: this.yaw, pitch: 0, stance: false };
    this.splashT = 0; this.climbH = 0; this.mT = 0; this.topRung = Math.floor((this.top.y - this.bot.y) / this.rung);
  }
  rungY(k) { return this.bot.y + k * this.rung; }
  update(dt) {
    const z = this.z, A = z.anim, s = A.scale, S = this.S; this.t += dt; S.yaw = this.yaw;
    if (this.phase === 'swim') {
      const d = _d.subVectors(this.base, A.pos); d.y = 0; const dist = d.length();
      const sp = 0.7 * clamp(dist / 0.8, 0.25, 1); A.pos.x += d.x / (dist || 1) * sp * dt; A.pos.z += d.z / (dist || 1) * sp * dt;
      const c = this.t * 1.6; const stroke = Math.sin(c * Math.PI * 2);
      S.x = A.pos.x; S.z = A.pos.z; S.y = this.water - 1.42 * s; S.hipY = S.y + 0.925 * s; S.pitch = 0.25; S.spine = 0.3 + stroke * 0.05; S.headP = 0.55; S.jaw = 0.25;
      S.hipY += Math.sin(c * Math.PI * 4) * 0.03 * s;
      armPose(this.aL, 1.25 + stroke * 0.35, 0.55 + stroke * 0.5, 0.9 - stroke * 0.4, 0.3, 1.2); armPose(this.aR, 1.25 + stroke * 0.35, 0.55 + stroke * 0.5, 0.9 - stroke * 0.4, 0.3, 1.2); S.arm.L = this.aL; S.arm.R = this.aR; S.hand.L = null; S.hand.R = null;
      // kicking legs (feet targets cycling below and behind the hips)
      for (const [f, ph] of [[this.fL, 0], [this.fR, Math.PI]]) { const k = Math.sin(c * Math.PI * 4 + ph); f.ankle.set(A.pos.x, S.hipY - 0.78 * s + k * 0.08 * s, A.pos.z).addScaledVector(this.fw, -0.25 * s + k * 0.1 * s).addScaledVector(this.rt, (f === this.fL ? -1 : 1) * 0.12 * s); f.pitch = -0.9; f.stance = false; }
      S.foot.L = this.fL; S.foot.R = this.fR; A.scripted = S;
      this.splashT -= dt; if (this.splashT <= 0) { this.splashT = 0.45 + Math.random() * 0.3; this.m.waterSplash(_o.set(A.pos.x, this.water, A.pos.z).addScaledVector(this.fw, 0.25), 0.6); }
      if (dist < 0.06 || this.t > 25) { this.phase = 'climb'; this.t = 0; this.climbH = S.hipY; this._initClimb(); this.m.voice(z, 'spawn'); }
      return false;
    }
    if (this.phase === 'climb') {
      const vClimb = 0.42 * Math.min(1.2, z.speed / 1.2 + 0.4);
      this.climbH += vClimb * dt; const hip = this.climbH; const shoulder = hip + 0.47 * s;
      S.x = this.base.x; S.z = this.base.z; S.y = hip - 0.925 * s; S.hipY = hip; S.pitch = 0.05; S.spine = -0.05; S.headP = 0.45; S.jaw = 0.2;
      // hands: grab the highest rung near shoulder + 0.3; re-grab when the hand sinks below the shoulder
      for (const side of ['L', 'R']) {
        const H = this.hand[side], F = this.foot[side];
        if (H.t >= 1 && this.rungY(H.r) < shoulder - 0.02 && H.r + 2 <= this.topRung) { H.from.copy(H.p); H.r = Math.min(this.topRung, H.r + 3); H.t = 0; }
        if (H.t < 1) { H.t = Math.min(1, H.t + dt / 0.32); }
        const tgt = this._rungPoint(H.r, side === 'L' ? -0.19 : 0.19, 0.0, _t); H.p.lerpVectors(H.from, tgt, ease(H.t)); if (H.t < 1) H.p.addScaledVector(this.fw, -Math.sin(Math.PI * H.t) * 0.12);
        if (H.t >= 1) H.p.copy(tgt);
        // feet: step up when the hip gets > 0.72 m above the rung
        if (F.t >= 1 && hip - this.rungY(F.r) > 0.72 * s) { F.from.copy(F.p); F.r += 2; F.t = 0; }
        if (F.t < 1) F.t = Math.min(1, F.t + dt / 0.36);
        const ft = this._rungPoint(F.r, side === 'L' ? -0.12 : 0.12, -0.06, _r); ft.y += 0.075 * s; F.p.lerpVectors(F.from, ft, ease(F.t)); if (F.t < 1) F.p.addScaledVector(this.fw, -Math.sin(Math.PI * F.t) * 0.15); if (F.t >= 1) F.p.copy(ft);
      }
      S.hand.L = this.hand.L.p; S.hand.R = this.hand.R.p; armPose(this.aL, 2.0, 0.25, 0.9, 1.2, 0.3); armPose(this.aR, 2.0, 0.25, 0.9, 1.2, 0.3); S.arm.L = this.aL; S.arm.R = this.aR;
      this.fL.ankle.copy(this.foot.L.p); this.fR.ankle.copy(this.foot.R.p); this.fL.stance = this.foot.L.t >= 1; this.fR.stance = this.foot.R.t >= 1; this.fL.pitch = 0.1; this.fR.pitch = 0.1; S.foot.L = this.fL; S.foot.R = this.fR;
      A.scripted = S;
      if (hip > this.top.y - 0.35 * s) { this.phase = 'mantle'; this.mT = 0; (this.mFrom ||= new V3()).set(S.x, S.y, S.z); }
      if (this.t > 30) { this.phase = 'mantle'; this.mT = 0; (this.mFrom ||= new V3()).set(S.x, S.y, S.z); }
      return false;
    }
    // mantle: hands on the deck edge, body up and over to the deck point
    this.mT += dt; const u = clamp(this.mT / 1.5, 0, 1);
    const ex = _o.copy(this.top).addScaledVector(this.fw, 0.05); const up = ease(seg(u, 0.0, 0.55)), over = ease(seg(u, 0.35, 1.0));
    const root = _d.copy(this.mFrom).lerp(_t.set(this.mFrom.x, this.deck.y - 0.5 * s, this.mFrom.z), up); root.lerp(this.deck, over);
    S.x = root.x; S.y = root.y; S.z = root.z; S.hipY = root.y + 0.925 * s * lerp(0.85, 1.0, over); S.pitch = 0.6 * (1 - over) + 0.05; S.spine = 0.7 * Math.sin(Math.PI * u); S.headP = 0.4 * (1 - over);
    this.hand.L.p.copy(ex).addScaledVector(this.rt, -0.25 * s); this.hand.R.p.copy(ex).addScaledVector(this.rt, 0.25 * s); this.hand.L.p.y = this.hand.R.p.y = this.deck.y + 0.02;
    S.hand.L = u < 0.8 ? this.hand.L.p : null; S.hand.R = u < 0.85 ? this.hand.R.p : null; S.arm.L = this.aL; S.arm.R = this.aR; armPose(this.aL, 1.4, 0.3, 0.8, 1.0, 0.8); armPose(this.aR, 1.4, 0.3, 0.8, 1.0, 0.8);
    this.fL.ankle.copy(root).addScaledVector(this.rt, -0.1 * s).setY(lerp(this.fL.ankle.y, this.deck.y + 0.08 * s, over)); this.fR.ankle.copy(root).addScaledVector(this.rt, 0.1 * s).setY(lerp(this.fR.ankle.y, this.deck.y + 0.08 * s, ease(seg(u, 0.5, 1)))); this.fL.stance = over > 0.9; this.fR.stance = u > 0.95;
    S.foot.L = this.fL; S.foot.R = this.fR; A.scripted = S;
    if (u >= 1) { A.scripted = null; A.reset(this.deck, this.yaw, s); z.wetT = 25; return true; }
    return false;
  }
  _initClimb() { const s = this.z.anim.scale; this.hand.L.r = Math.max(0, Math.floor((this.climbH + 0.5 * s - this.bot.y) / this.rung)); this.hand.R.r = this.hand.L.r + 1; this.foot.L.r = Math.max(0, Math.floor((this.climbH - 0.72 * s - this.bot.y) / this.rung)); this.foot.R.r = this.foot.L.r + 1;
    for (const side of ['L', 'R']) { this.hand[side].p.copy(this._rungPoint(this.hand[side].r, side === 'L' ? -0.19 : 0.19, 0)); this.hand[side].t = 1; this.foot[side].p.copy(this._rungPoint(this.foot[side].r, side === 'L' ? -0.12 : 0.12, -0.06)); this.foot[side].t = 1; } }
  _rungPoint(k, lat, back, out = new V3()) { return out.copy(this.bot).setY(this.rungY(k)).addScaledVector(this.rt, lat).addScaledVector(this.fw, back); }
}
