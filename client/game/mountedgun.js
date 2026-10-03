// The mounted gun at the Army Checkpoint, client side (the rules: shared/mountedgun.js, the server: server/mountedgun.js).
// The server replicates one entity for it (ENT.GUN: belt, gunner, where it was left pointing). Here:
//   - the gun on its tripod, turned for everyone by whoever mans it (their replicated view, held inside the arc)
//   - manning it: [E] at the grips, predicted the way the flashlight is (the press shows at once, the server
//     has the last word a moment later); stepping away lets go
//   - the gunner's own shots, drawn on the command that fires them: the same step the server runs on the same
//     commands (stepGun), so the report, the flash, the tracer and what the round strikes need no round trip.
//     While manning, the fire button goes into the commands as BTN.GUN and not BTN.ATTACK, so the simulation
//     leaves the weapon in the hands alone (and [R] is the belt's, not the magazine's)
//   - everyone else's shots (EVT.SHOT with MOUNTED_GUN as the weapon), from the muzzle
//   - the gunner's view: the gun's rear and their hands on the grips in place of the weapon they carry
import * as THREE from 'three';
import { BTN, SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE, SLOT_BUILD } from '../../shared/constants.js';
import { SOUND, AMMO } from '../../shared/defs.js';
import { ACT, dqangle16, dqpitch, unpackLookYaw, unpackLookPitch } from '../../shared/protocol.js';
import { shotDirections, canSelectSlot } from '../../shared/playersim.js';
import { raycastWorld } from '../../shared/collision.js';
import { GUN, GUN_FIRED, GUN_DRY, gunNest, atGrips, gunAim, gunMuzzle, gunShot, stepGun } from '../../shared/mountedgun.js';
import { createGunMount, createGunView } from '../render/models/mountedgun.js';

const HOLD_TO_FEED = 0.3; // [E] held this long feeds the belt; let go sooner, it lets go of the gun
const SETTLE = 1; // seconds our own request stands before the server's word on who mans it replaces it
const PROMPT_TIME = 5; // seconds the gunner's prompt stays up after they take the grips
const LET_GO = 0.25; // metres past the grips' reach at which a gunner walking off has let go
const _aim = { yaw: 0, pitch: 0 };
const _muz = { x: 0, y: 0, z: 0 };
const _ev = {};
const _cmd = { seq: 0, yaw: 0, pitch: 0 };
const _dirs = new Float32Array(3);
const _ray = { t: -1, col: null, terrain: false };
const _v = new THREE.Vector3();
const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

export class GunClient {
  constructor(game) {
    this.g = game;
    this.ent = null; // the gun's entity, while it is in view
    this.model = null;
    this.manning = false; // we are at the grips (our own prediction, then the server's word)
    this.want = 0; // what we last asked for (1 the grips, 0 to let go) and when
    this.wantT = -1e9;
    this.trig = { belt: 0, wait: 0, held: 0 }; // the gun as our commands leave it (stepGun)
    this.shotT = -1e9; // when we last fired it
    this.feeding = false; // we told the server to feed the belt
    this.eDown = -1; // when [E] went down at the grips while manning (-1: it is up, or it was the press that took them)
    this.eFeed = false;
    this.kick = 0; // the gun jumping back, for everyone
    this.yaw = 0; // where it is drawn pointing
    this.pitch = 0;
    this.view = createGunView();
    this.view.visible = false;
    game.renderer.vmScene.add(this.view); // (in the scene from the start: its programs are built with the rest)
    this.viewKick = 0;
    this.flashAt = null; // where the viewmodel's flash light belongs, while it is over our barrel
    this.swayX = 0;
    this.swayY = 0;
    window.addEventListener('keyup', (e) => e.code === 'KeyE' && this.keyUp());
  }

  get nest() {
    return this.g.world ? gunNest(this.g.world) : null;
  }
  // rounds on the belt, as the gunner's own shots leave it or as the server has it
  get belt() {
    return this.manning ? this.trig.belt : this.ent ? this.ent.q[3] : 0;
  }
  get gunner() {
    return this.ent ? this.ent.q[4] : 0;
  }

  // Entities: the gun came into view
  attach(e) {
    this.ent = e;
    this.model = e.obj = createGunMount();
    this.model.position.set(e.rx, e.ry, e.rz);
    this.g.scene.add(this.model);
    const q = e.q[5];
    this.yaw = dqangle16(unpackLookYaw(q));
    this.pitch = dqpitch(unpackLookPitch(q));
    this.trig.belt = e.q[3];
  }

  ask(act, on) {
    this.g.conn.action(act, on ? 1 : 0);
  }

  // [E] with the gun's prompt up (Game.interact)
  use() {
    const g = this.g;
    if (this.manning) {
      this.eDown = g.time; // let go, or (held) feed the belt: keyUp / update decide
      return;
    }
    if (!this.ent || this.gunner) return;
    this.take(true);
    g.audio.playLocal('bolt', { volume: 0.8 });
  }

  take(on) {
    const g = this.g;
    this.manning = on;
    this.want = on ? 1 : 0;
    this.wantT = g.time;
    this.ask(ACT.GUN_MAN, on);
    this.trig.held = 0;
    this.trig.wait = 0;
    this.eDown = -1;
    this.eFeed = false;
    this.feeding = false;
    if (on && this.ent) this.trig.belt = this.ent.q[3];
    g.inputBuffer.clear(); // a press held for the weapon in the hands must not come out of it later
  }

  keyUp() {
    const t = this.eDown;
    this.eDown = -1;
    if (this.eFeed) this.eFeed = false;
    else if (t >= 0 && this.manning) this.take(false);
  }

  // The buttons of this frame's commands. Manning: the fire button is the gun's trigger, [R] (or [E] held) feeds
  // the belt, and nothing reaches the weapon in the hands.
  shape(buttons) {
    if (!this.manning) return buttons;
    const g = this.g;
    const s = g.prediction.state;
    // (the hammer's build mode takes the mouse for itself: put it away)
    if (s.slot === SLOT_BUILD) {
      const to = [SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE].find((sl) => canSelectSlot(s, sl));
      if (to !== undefined) g.prediction.requestSlot(to);
    }
    const feed = (!!(buttons & BTN.RELOAD) || this.eFeed) && this.trig.belt < GUN.mag && s.ammo[AMMO.R762] > 0;
    if (feed !== this.feeding) {
      this.feeding = feed;
      this.ask(ACT.GUN_FEED, feed);
    }
    let b = buttons & ~(BTN.ATTACK | BTN.ALT | BTN.RELOAD);
    if (buttons & BTN.ATTACK && !feed) b |= BTN.GUN;
    return b;
  }

  // The n commands this frame's prediction step issued: each is run past the gun as the server will run it.
  // True when one of them fired (the packet then leaves at once, with this frame's render time: see Game.update).
  commands(n) {
    if (!n || !this.manning || !this.ent) return false;
    const out = this.g.prediction.outbox;
    let fired = false;
    for (let i = Math.max(0, out.length - n); i < out.length; i++) {
      const c = out[i];
      const r = stepGun(this.trig, c.buttons);
      if (r === GUN_FIRED) {
        this.shoot(c);
        fired = true;
      } else if (r === GUN_DRY) this.g.audio.playLocal('dry');
    }
    return fired;
  }

  // our own round, on the command that fires it
  shoot(c) {
    const g = this.g;
    const nest = this.nest;
    _cmd.seq = c.seq;
    _cmd.yaw = dqangle16(c.qyaw);
    _cmd.pitch = dqpitch(c.qpitch);
    const ev = gunShot(nest, g.prediction.state, _cmd, _ev);
    shotDirections(ev.yaw, ev.pitch, 0, ev.spread, 1, ev.seed, _dirs);
    const end = g.predictShot(ev, GUN, _dirs[0], _dirs[1], _dirs[2]); // what it strikes is shown now, like any shot of ours
    const dist = end >= 0 ? end : Math.min(GUN.range, 90);
    this.shotT = g.time;
    g.audio.playLocal('hmg');
    // the flash at the muzzle the gunner sees, its light in the world, the tracer from there to where the round goes
    const m = this.view.userData.muzzle;
    g.effects.vmMuzzle(m, 2.6);
    // (the viewmodel's flash light sits where a weapon in the hands has its muzzle: for this one, over the barrel)
    const fl = g.renderer.vmMuzzle;
    if (!this.flashAt) this.flashAt = fl.position.clone();
    fl.position.set(0, 0.25, m.z + 1.1);
    fl.intensity = 9;
    g.vmMuzzleT = 0.05;
    const cam = g.camera;
    _v.copy(m).applyQuaternion(cam.quaternion).add(cam.position);
    g.lights.flashMuzzle(_v, 1.3);
    this.trace(_v.x, _v.y, _v.z, ev.x + _dirs[0] * dist, ev.y + _dirs[1] * dist, ev.z + _dirs[2] * dist);
    this.viewKick = 1;
    this.kick = 1;
    g.camShake = Math.min(1, (g.camShake || 0) + 0.07);
  }

  // a tracer from the muzzle to the point the round reaches (it was judged from the gunner's eye)
  trace(x, y, z, tx, ty, tz) {
    const dx = tx - x;
    const dy = ty - y;
    const dz = tz - z;
    const l = Math.hypot(dx, dy, dz);
    if (l > 0.5) this.g.effects.tracer(x, y, z, dx / l, dy / l, dz / l, l, 1);
  }

  // somebody else's round (Game.remoteShot)
  remoteShot(ev) {
    const g = this.g;
    const nest = this.nest;
    if (!nest) return;
    gunMuzzle(nest, ev.yaw, ev.pitch, _muz);
    _v.set(_muz.x, _muz.y, _muz.z);
    g.effects.worldMuzzle(_v, 1.7);
    g.lights.flashMuzzle(_v, 1);
    g.audio.play(SOUND.MOUNTED_GUN, _muz);
    shotDirections(ev.yaw, ev.pitch, 0, ev.spread, 1, ev.seed, _dirs);
    raycastWorld(g.world, ev.x, ev.y, ev.z, _dirs[0], _dirs[1], _dirs[2], GUN.range, _ray);
    const dist = _ray.t >= 0 ? _ray.t : Math.min(GUN.range, 90);
    this.trace(_muz.x, _muz.y, _muz.z, ev.x + _dirs[0] * dist, ev.y + _dirs[1] * dist, ev.z + _dirs[2] * dist);
    this.kick = 1;
  }

  // The [E] prompt (Game.updateLookTarget). held: we man it, and nothing else is in reach of hands that are on the
  // grips; otherwise it is offered to whoever stands at them. True when the prompt is the gun's.
  look(held) {
    const g = this.g;
    if (held !== this.manning || !this.ent) return false;
    const nest = this.nest;
    const rp = g.renderPos;
    if (!nest || (!held && !atGrips(nest, rp.x, rp.y, rp.z))) return false;
    const belt = this.belt;
    g.lookTarget = 'gun';
    if (held) {
      // (the line sits under the crosshair: it says its piece as the grips are taken, and again when the belt is out)
      const have = g.prediction.state.ammo[AMMO.R762];
      if (belt <= 0) g.prompt = have > 0 ? `Belt empty · hold [R] to feed it (${have} × 7.62)` : 'Belt empty · no 7.62 to feed it';
      else if (g.time - this.wantT < PROMPT_TIME) g.prompt = belt >= GUN.mag || !have ? '[E] Let go' : `[E] Let go · hold [R] to feed the belt (${have} × 7.62)`;
    } else if (this.gunner && this.gunner !== g.myId) g.prompt = `${g.name(this.gunner)} is on the gun · belt ${belt}/${GUN.mag}`;
    else g.prompt = `[E] Man the gun · belt ${belt}/${GUN.mag}`;
    return true;
  }

  // the belt in place of the weapon's ammunition, while manning (Game.updateHud)
  hud(h) {
    h.mounted = this.manning;
    if (!this.manning) return;
    h.mag = this.belt;
    h.reserve = this.g.prediction.state.ammo[AMMO.R762];
    h.reloading = this.feeding ? this.belt / GUN.mag : -1;
  }

  // once a frame, after the entities have moved
  update(dt, lookDX = 0, lookDY = 0) {
    const g = this.g;
    const e = this.ent;
    if (e && g.entities.ents.get(e.id) !== e) {
      // out of view, or the world went: its model went with the entity (Entities.destroyView)
      this.ent = this.model = null;
    }
    const nest = this.nest;
    const gun = this.ent;
    const s = g.prediction.state;
    const able = !!gun && !!nest && !!g.self.alive && !s.zombie && !s.downed;
    // who mans it: what we asked for, until the server has had time to say
    if (g.time - this.wantT > SETTLE || !able || (this.want && this.gunner && this.gunner !== g.myId)) {
      const mine = able && this.gunner === g.myId;
      if (mine !== this.manning) {
        this.manning = mine;
        this.trig.held = 0;
        this.eDown = -1;
        this.eFeed = this.feeding = false;
      }
    }
    if (this.manning && (!nest || !atGrips(nest, s.x, s.y, s.z, GUN.reach + LET_GO))) this.take(false);
    if (this.manning) {
      if (this.eDown >= 0 && g.time - this.eDown > HOLD_TO_FEED) {
        this.eDown = -1;
        this.eFeed = true;
      }
      // The belt: ours while our own rounds are leaving it (the server's count trails them by the trip), the
      // server's once they have all arrived, and at once when it says there is less or it is being fed
      const told = gun.q[3];
      if (g.time - this.shotT > 0.6 || told < this.trig.belt || this.feeding) this.trig.belt = told;
    }
    // where it points: with the view of whoever mans it, or where it was left
    if (gun) {
      const by = this.manning ? null : this.gunner && this.gunner !== g.myId ? g.entities.ents.get(this.gunner) : null;
      if (this.manning && nest) gunAim(nest, g.input.yaw, g.input.pitch, _aim);
      else if (by && nest) gunAim(nest, by.ryaw, by.rpitch || 0, _aim);
      else {
        _aim.yaw = dqangle16(unpackLookYaw(gun.q[5]));
        _aim.pitch = dqpitch(unpackLookPitch(gun.q[5]));
      }
      const k = this.manning ? 1 : Math.min(1, dt * 14);
      this.yaw += wrap(_aim.yaw - this.yaw) * k;
      this.pitch += (_aim.pitch - this.pitch) * k;
      this.kick = Math.max(0, this.kick - dt * 14);
      const m = this.model;
      m.visible = !this.manning || !!g.debugCam; // the gunner sees it from behind the grips instead (this.view)
      if (m.visible) {
        const back = this.kick * 0.035;
        const cp = Math.cos(this.pitch);
        m.position.set(gun.rx + Math.sin(this.yaw) * cp * back, gun.ry - Math.sin(this.pitch) * back, gun.rz + Math.cos(this.yaw) * cp * back);
        m.rotation.y = this.yaw;
        m.rotation.x = this.pitch;
      }
    }
    if (!this.manning && this.flashAt) {
      g.renderer.vmMuzzle.position.copy(this.flashAt); // back where the weapons in the hands flash
      this.flashAt = null;
    }
    // the gunner's view of it: on the view's centre inside the arc, left behind at its stop when they look past it
    const v = this.view;
    v.visible = this.manning && !g.ui.inventoryOpen && !g.ui.mapOpen && !g.ui.boardOpen && !g.debugCam;
    if (v.visible) {
      this.viewKick = Math.max(0, this.viewKick - dt * 16);
      const lag = Math.min(1, dt * 10);
      this.swayX += (lookDX - this.swayX) * lag;
      this.swayY += (lookDY - this.swayY) * lag;
      const j = this.viewKick;
      v.position.set((Math.random() - 0.5) * 0.004 * j, (Math.random() - 0.5) * 0.004 * j, 0.03 * j);
      v.rotation.set(this.pitch - g.input.pitch + this.swayY * 0.6 + 0.004 * j, wrap(this.yaw - g.input.yaw) + this.swayX * 0.6, 0, 'YXZ');
    }
  }
}
