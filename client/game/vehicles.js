// Ground transport in the client (the rules and the physics: shared/vehicles.js; the server: server/vehicles.js; the
// models: render/models/vehicles.js). The server replicates one entity a vehicle (ENT.VEHICLE). Here:
//   - each drawn where it is this frame: the one we drive where our own prediction has it (its commands have moved it
//     on ahead of the server, and the seat must be under us), every other where the server had it a moment ago, as
//     any entity is drawn. It rides the ground (pitch and roll off the terrain under its wheels), sits on its springs,
//     dives when it brakes; on two wheels it leans into its turns. Its wheels turn with the distance rolled, the bars
//     or the steering wheel with the steering, its lamps and clocks are its state
//   - one that stands empty is a box in our copy of the world too (vehicleGrid), where the server has it
//   - whoever sits in one is drawn in their seat, the driver's hands on the bars or the wheel (seatOf, place)
//   - in one ourselves, the eye is the seat's and looks where the mouse does; at the wheel our own arms are on the
//     controls. The view turns with the vehicle
//   - [E] on one: gets in (a tap), or does what it wants done (held: a part fitted, fuel poured, a patch); in one, [E]
//     gets out. The fire button is the horn, the flashlight's key the headlamp
import * as THREE from 'three';
import { BTN, INTERACT_REACH, EYE_HEIGHT } from '../../shared/constants.js';
import { ITEM, ITEM_DEFS, AMMO, SOUND, NOTIFY, VEH_NO, VEH_OFFS } from '../../shared/defs.js';
import { ACT, VACT, VFLAG, HOLD, qpos, dqangle16 } from '../../shared/protocol.js';
import { WORLD } from '../../shared/acts.js';
import { VEH, VSTATE, VEHICLES, VEH_NAMES, FIX, REPAIR, HORN, vehicleGrid, parkedCollider, questCar, siphonOf, seatFeet } from '../../shared/vehicles.js';
import { raycastWorld } from '../../shared/collision.js';
import { VehicleModel, GRIP_HOLD, SEAT_POSE, SIT_T, SIT_K, SEAT_HIP, ANKLE } from '../render/models/vehicles.js';
import { VMArm, handQ, ARM_L1, ARM_L2 } from '../render/models/weapons.js';
import { ikTwoBone, getPropMaterial } from '../render/models/skinning.js';
import { bindTag } from './binds.js';

const SAG0 = [0, 0, 0];
const HOLD_AFTER = 0.28; // s: [E] held this long on a vehicle that runs is not getting in, it is working on it
const PROMPT_TIME = 7; // seconds the list of what the keys do stays up after getting in
const MOUNT_T = 0.38; // s the eye takes into the seat, and out of it
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qU = new THREE.Quaternion();
const _qL = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _S = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _ray = { t: -1, col: null, terrain: false };
const wrap = (a) => {
  a %= Math.PI * 2;
  return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a;
};
const NEED_TEXT = { [VEH_NO.FULL]: 'The tank is full and it needs nothing', [VEH_NO.NO_FUEL]: 'You carry no Fuel', [VEH_NO.NO_PARTS]: 'You lack the parts for it', [VEH_NO.FINE]: 'It needs nothing', [VEH_NO.SEATS]: 'Every seat is taken', [VEH_NO.BROKEN]: 'It does not run yet: fit its parts', [VEH_NO.WRECK]: 'Burnt out: nothing to be done with it' };

export class VehicleClient {
  constructor(game) {
    this.g = game;
    this.list = new Map(); // entity id -> its entity (e.veh: what is drawn of it)
    this.seats = new Map(); // player id -> { e, k }
    this.mine = null; // the vehicle we are in, and the seat
    this.myK = -1;
    this.mountK = 0; // 0..1: how far the eye is into the seat
    this.mountFrom = new THREE.Vector3(); // where the eye was when we got in / where it was in the seat when we got out
    this.boardT = -1e9;
    this.lastYaw = 0;
    this.held = 0; // [E] is down on this vehicle (a tap gets in, held it works on it)
    this.heldT = 0;
    this.target = { vehicle: 0, e: null, siphon: null };
    this.dry = new Set(); // wrecks we know to be drawn off
    this.eye = { x: 0, y: 0, z: 0, roll: 0, on: false };
    this.hud = { on: false, kind: 0, name: '', kmh: 0, fuel: 0, hp: 1, tank: false, driver: false, lights: false, state: 1 };
    // our own arms on the controls, in the world: drawn while we drive
    this.rig = new THREE.Group();
    this.rig.name = 'vehicle_arms';
    this.rig.visible = false;
    this.arms = [new VMArm(-1), new VMArm(1)];
    const mat = getPropMaterial();
    for (const a of this.arms) {
      a.sets.normal.mat = mat;
      a.shoulder.traverse((o) => {
        if (o.isMesh) {
          o.material = mat;
          o.renderOrder = 0;
        }
      });
      a.setPose('grip');
      this.rig.add(a.shoulder);
    }
    this.handQ = {};
    for (const k in GRIP_HOLD) this.handQ[k] = [handQ(-1, GRIP_HOLD[k].finger, GRIP_HOLD[k].palm), handQ(1, GRIP_HOLD[k].finger, GRIP_HOLD[k].palm)];
    game.scene.add(this.rig);
  }

  setWorld(world) {
    for (const e of this.list.values()) this.unpark(e, null);
    this.list.clear();
    this.seats.clear();
    this.mine = null;
    this.myK = -1;
    this.mountK = 0;
    this.held = 0;
    this.dry.clear();
    this.rig.visible = false;
    if (world) {
      vehicleGrid(world);
      questCar(world); // (the parked prop's own box out of the world: the vehicle that stands there has one)
    }
  }

  // ---------------------------------------------------------------- entities
  attach(e) {
    const g = this.g;
    const model = new VehicleModel(e.vk, e.tint);
    e.obj = model.group;
    g.scene.add(model.group);
    const P = VEHICLES[e.vk];
    e.veh = { model, x: e.rx, y: e.ry, z: e.rz, yaw: dqangle16(e.q[3]), vf: 0, steer: 0, roll: 0, pitch: 0, lean: 0, tilt: 0, dy: 0, vy: 0, acc: 0, lastVf: 0, col: null, loop: null, state: -1, seats: [0, 0, 0, 0], skidT: 0, smokeT: 0, hornOn: false, idle: 0 };
    e.veh.loop = P.pedal ? null : g.audio.createLoop?.(e.vk === VEH.CAR ? 'veh_car' : 'veh_moped', e.rx, e.ry, e.rz) || null;
    if (e.veh.loop) e.veh.loop.setVolume(0);
    e.veh.horn = P.pedal ? null : g.audio.createLoop?.('veh_horn', e.rx, e.ry, e.rz) || null;
    if (e.veh.horn) e.veh.horn.setVolume(0);
    this.list.set(e.id, e);
    this.changed(e, 0xffff);
    this.pose(e, 0, e.veh.x, e.veh.y, e.veh.z, e.veh.yaw, 0, 0, true);
  }
  detach(e) {
    if (!e.veh) return;
    this.unpark(e, this.g.world);
    e.veh.loop?.stop();
    e.veh.horn?.stop();
    this.list.delete(e.id);
    for (const [id, s] of this.seats) if (s.e === e) this.seats.delete(id);
    if (this.mine === e) this.mine = null;
  }

  // its record changed (Entities.onUpdate): its state, who sits in it, whether it is a box
  changed(e) {
    const v = e.veh;
    if (!v) return;
    const q = e.q;
    const flags = q[5];
    const state = flags & VFLAG.STATE;
    if (state !== v.state) {
      v.state = state;
      v.model.setState(state);
    }
    const seats = [q[7] & 0x3fff, (q[7] >> 14) & 0x3fff, q[8] & 0x3fff, (q[8] >> 14) & 0x3fff];
    for (let k = 0; k < 4; k++) {
      if (seats[k] === v.seats[k]) continue;
      const was = this.seats.get(v.seats[k]);
      if (was && was.e === e && was.k === k) this.seats.delete(v.seats[k]);
      v.seats[k] = seats[k];
      if (seats[k]) this.seats.set(seats[k], { e, k });
    }
    // standing empty it is a box, exactly where the wire has it (the server's own box is there)
    const empty = !seats[0] && !seats[1] && !seats[2] && !seats[3];
    const still = (q[4] & 255) === 0;
    const world = this.g.world;
    if (empty && still && world) {
      const x = q[0] / world.posScale;
      const y = q[1] / world.posScale;
      const z = q[2] / world.posScale;
      const yaw = wrap(dqangle16(q[3]));
      if (!v.col || v.col.x !== x || v.col.z !== z || v.col.yaw !== yaw) {
        this.unpark(e, world);
        v.col = parkedCollider(e.vk, e.id, x, y, z, yaw);
        vehicleGrid(world).parked.add(v.col);
      }
    } else this.unpark(e, world);
  }
  unpark(e, world) {
    const v = e.veh;
    if (!v || !v.col) return;
    if (world) vehicleGrid(world).parked.remove(v.col);
    this.g.impacts?.gone?.(v.col);
    v.col = null;
  }

  // the seat player `id` sits in: { e, k } or undefined
  seatOf(id) {
    return this.seats.get(id);
  }

  // ---------------------------------------------------------------- input
  // the buttons of this frame's commands, as a driver's: the fire button is the horn
  shape(buttons) {
    if (!this.g.prediction.state.drive) return buttons;
    return buttons & BTN.ATTACK ? (buttons & ~BTN.ATTACK) | HORN : buttons;
  }

  // the flashlight's key, in a vehicle: its headlamp (true: the key was ours)
  lightsKey() {
    const s = this.g.prediction.state;
    if (!s.drive && !s.pass) return false;
    const e = this.list.get(s.drive || s.pass);
    if (e && VEHICLES[e.vk].tank) {
      this.g.conn.action(ACT.VEHICLE, VACT.LIGHTS, e.id);
      this.g.audio.playLocal?.('flashlight');
    }
    return true;
  }

  // ---------------------------------------------------------------- the frame
  // Once a frame, after the prediction has stepped and the render position is known (rp: our feet as drawn), before
  // the camera and the entities are placed.
  update(dt, rp) {
    const g = this.g;
    const pred = g.prediction;
    const s = pred.state;
    const alive = !!g.self.alive;
    const mineId = alive ? s.drive || s.pass : 0;
    const was = this.mine;
    const mine = mineId ? this.list.get(mineId) || null : null;
    if (mine !== was) {
      // into one, or out of one: the eye goes over in a moment
      if (mine) {
        this.boardT = g.time;
        this.mountFrom.set(rp.x, rp.y + g.eyeH, rp.z);
        if (!was) this.mountK = 0;
        this.lastYaw = mine.veh.yaw;
      } else if (was) this.mountFrom.set(this.eye.x, this.eye.y, this.eye.z);
      this.mine = mine;
    }
    this.myK = mine ? (s.drive ? 0 : s.passN) : -1;
    this.mountK = Math.max(0, Math.min(1, this.mountK + (mine ? dt : -dt) / MOUNT_T));
    for (const e of this.list.values()) {
      if (g.entities.ents.get(e.id) !== e) {
        this.detach(e);
        continue;
      }
      const v = e.veh;
      const q = e.q;
      if (e === mine && s.drive === e.id) {
        // ours: where the prediction has it, between the last two commands
        const a = pred.alpha;
        const p0 = pred.prev;
        const yaw = p0.drive === e.id ? p0.dyaw + wrap(s.dyaw - p0.dyaw) * a : s.dyaw;
        const steer = p0.drive === e.id ? p0.dsteer + (s.dsteer - p0.dsteer) * a : s.dsteer;
        const vf = -s.vx * Math.sin(s.dyaw) - s.vz * Math.cos(s.dyaw);
        this.pose(e, dt, rp.x, rp.y, rp.z, yaw, vf, steer, false);
      } else {
        const t = e.samples.sample(g.renderTick, g.entities.tmp);
        const sp = ((q[4] << 24) >> 24) / 4;
        const st = (((q[4] >> 8) << 24) >> 24) / 100;
        this.pose(e, dt, t.x, t.y, t.z, t.yaw, sp, st, false);
      }
      this.dress(e, dt, e === mine);
    }
    // our own body in its seat (under our own eyes: no head, no arms - Game.updateSelfBody), where the model is now
    if (mine) g.updateSelfBody(dt, s, rp, g.time, 0, true);
    this.view(dt, rp, mine, s);
    this.arm(mine && s.drive === mine.id ? mine : null);
    // [E] still down on one that runs: past a tap it is work on it
    if (this.held) {
      const t = g.lookTarget;
      if (!t || t.vehicle !== this.held) this.held = 0;
      else if ((this.heldT += dt) >= HOLD_AFTER) {
        g.beginHold(this.held);
        this.held = 0;
      }
    }
  }

  // e drawn at (x, y, z) facing yaw, going vf along itself with its steering at steer
  pose(e, dt, x, y, z, yaw, vf, steer, snap) {
    const g = this.g;
    const v = e.veh;
    const P = VEHICLES[e.vk];
    const world = g.world;
    const m = v.model;
    v.x = x;
    v.z = z;
    v.yaw = yaw;
    v.vf = vf;
    v.steer = steer;
    // the ground under it: its nose and its tail, its two sides (on a bridge's deck the terrain is not what it stands on)
    let pitch = 0;
    let roll = 0;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    if (world && Math.abs(world.heightAt(x, z) - y) < 0.35) {
      const hl = P.wb * 0.5;
      const hf = world.heightAt(x - sy * hl, z - cy * hl);
      const hb = world.heightAt(x + sy * hl, z + cy * hl);
      pitch = Math.atan2(hf - hb, P.wb);
      const w = Math.max(0.35, P.halfW);
      roll = Math.atan2(world.heightAt(x - cy * w, z + sy * w) - world.heightAt(x + cy * w, z - sy * w), w * 2);
    }
    // its springs: the body follows the ground a moment late, and dives and squats as it slows and gathers speed
    const acc = dt > 0 ? (vf - v.lastVf) / dt : 0;
    v.lastVf = vf;
    v.acc += (Math.max(-12, Math.min(12, acc)) - v.acc) * Math.min(1, dt * 8);
    if (snap || dt <= 0 || Math.abs(y - v.y) > 1.5) {
      v.y = y;
      v.vy = 0;
      v.pitch = pitch;
      v.roll = roll;
    } else {
      const k = 90, c = 13;
      v.vy += ((y - v.y) * k - v.vy * c) * dt;
      v.y += v.vy * dt;
      if (v.y < y - 0.12) v.y = y - 0.12;
      const e2 = Math.min(1, dt * 9);
      v.pitch += (pitch - v.pitch) * e2;
      v.roll += (roll - v.roll) * e2;
    }
    // into its turns: on two wheels it leans in, a car rolls out
    const turn = (vf / P.wb) * Math.tan(steer); // rad/s, + to the right
    const lat = (vf * turn) / 9.8;
    const lean = P.two ? Math.max(-0.62, Math.min(0.62, Math.atan(lat))) : Math.max(-0.07, Math.min(0.07, -lat * 0.05));
    v.lean += (lean - v.lean) * Math.min(1, dt * (P.two ? 7 : 5));
    // standing with nobody on it, a two-wheeler rests on its stand
    const prop = P.two && !v.seats[0] && Math.abs(vf) < 0.3 ? (e.vk === VEH.BIKE ? 0.2 : 0.14) : 0;
    v.tilt += (prop - v.tilt) * Math.min(1, dt * 6);
    m.group.position.set(x, v.y, z);
    m.group.rotation.set(v.pitch, yaw, 0);
    const sag = m.sag || SAG0; // (a car as found or broken down: down at the corner with the flat tyre)
    m.body.rotation.set(-v.acc * (P.two ? 0.004 : 0.006) + sag[0], 0, -(v.lean + v.roll + v.tilt) + sag[2]);
    m.body.position.y = sag[1];
    v.rollD = (v.rollD || 0) + vf * dt;
    m.setWheels(v.rollD, steer);
    const eye = g.camera.position;
    m.group.visible = (x - eye.x) ** 2 + (z - eye.z) ** 2 < (g.viewDist ?? 1e9) ** 2;
  }

  // its lamps, its clocks, its engine, what it throws up
  dress(e, dt, mine) {
    const g = this.g;
    const v = e.veh;
    const P = VEHICLES[e.vk];
    const flags = e.q[5];
    const s = g.prediction.state;
    const driving = mine && s.drive === e.id;
    const lights = !!(flags & VFLAG.LIGHTS);
    const brake = driving ? !!(s.lastBtn & (BTN.BACK | BTN.JUMP)) : !!(flags & VFLAG.BRAKE);
    v.model.setLamps(lights, brake);
    const fuel = P.tank ? (driving ? s.dfuel / P.tank : (e.q[6] & 255) / 255) : 0;
    v.fuel = fuel;
    v.hp = ((e.q[6] >> 8) & 255) / 255;
    v.lights = lights;
    v.model.setDash(Math.abs(v.vf) / (P.top * 1.15), fuel);
    const sp = Math.abs(v.vf);
    const state = flags & VFLAG.STATE;
    const running = !P.pedal && !!v.seats[0] && state === VSTATE.OK && fuel > 0;
    const thr = driving ? !!(s.lastBtn & BTN.FWD) : !!(flags & VFLAG.THROTTLE);
    v.thrK = (v.thrK || 0) + ((thr && running ? 1 : 0) - (v.thrK || 0)) * Math.min(1, dt * 12);
    v.model.setThrottle(v.thrK);
    v.model.setHazard(state === VSTATE.DEAD && g.time % 0.9 < 0.45);
    // the engine: its note follows the road speed through three gears, harder with the throttle open
    if (v.loop) {
      const k = Math.min(1, sp / P.top);
      const gear = k < 0.3 ? k / 0.3 : k < 0.62 ? (k - 0.3) / 0.32 : (k - 0.62) / 0.38;
      const rev = running ? 0.55 + (0.35 + gear * 0.5) * (0.4 + 0.6 * k) + (thr ? 0.16 : 0) : 0;
      v.idle += ((running ? 1 : 0) - v.idle) * Math.min(1, dt * 5);
      v.loop.setPosition(v.x, v.y + 0.5, v.z);
      v.loop.setRate(Math.max(0.5, (e.vk === VEH.CAR ? 0.62 : 0.8) + rev * (e.vk === VEH.CAR ? 0.75 : 0.9)));
      v.loop.setVolume(v.idle * (0.45 + 0.4 * k + (thr ? 0.25 : 0)));
    }
    if (v.horn) {
      const on = !!(flags & VFLAG.HORN) || (driving && !!(s.lastBtn & HORN));
      v.horn.setPosition(v.x, v.y + 0.8, v.z);
      v.horn.setVolume(on ? 1 : 0);
    }
    // tyres letting go, and what the wheels throw up off the road
    const skid = driving ? g.skidT > g.time : !!(flags & VFLAG.SKID);
    if (skid && g.time > v.skidT) {
      v.skidT = g.time + 0.28;
      g.audio.play(SOUND.VEH_SKID, { x: v.x, y: v.y + 0.2, z: v.z, volume: Math.min(1, 0.4 + sp / 20) });
    }
    if (sp > 4 && v.model.group.visible) {
      v.dustT = (v.dustT || 0) - dt * sp;
      if (v.dustT <= 0) {
        v.dustT = 3.2;
        const road = g.world?.roadKindAt?.(v.x, v.z) === 2;
        if (!road || skid) {
          const bx = v.x + Math.sin(v.yaw) * P.half * 0.8;
          const bz = v.z + Math.cos(v.yaw) * P.half * 0.8;
          g.effects.mist?.(bx, v.y + 0.15, bz, (Math.random() - 0.5) * 0.6, 0.5, (Math.random() - 0.5) * 0.6, 1.1, 0.5, 1.5, false);
        }
      }
    }
    // broken down: it steams
    if (state === VSTATE.DEAD && v.model.group.visible) {
      v.smokeT -= dt;
      if (v.smokeT <= 0) {
        v.smokeT = 0.12;
        const fx = v.x - Math.sin(v.yaw) * P.half * 0.6 + (Math.random() - 0.5) * 0.4;
        const fz = v.z - Math.cos(v.yaw) * P.half * 0.6 + (Math.random() - 0.5) * 0.4;
        g.effects.mist?.(fx, v.y + (P.two ? 0.5 : 1), fz, (Math.random() - 0.5) * 0.3, 1.2, (Math.random() - 0.5) * 0.3, 2.2, 0.5, 1.9, false);
      }
    }
    // burnt out: a thread of smoke for as long as it lies there
    if (state === VSTATE.WRECK && v.model.group.visible) {
      v.smokeT -= dt;
      if (v.smokeT <= 0) {
        v.smokeT = 0.5;
        g.effects.mist?.(v.x + (Math.random() - 0.5) * 0.6, v.y + (P.two ? 0.3 : 1.1), v.z + (Math.random() - 0.5) * 0.6, 0.1, 0.7, 0, 3, 0.3, 1.1, false);
      }
    }
  }

  // The eye in the seat (this.eye), and the view turned with the vehicle; our predicted body put where we are carried.
  view(dt, rp, mine, s) {
    const g = this.g;
    const eye = this.eye;
    eye.on = false;
    eye.roll = 0;
    const k = this.mountK * this.mountK * (3 - 2 * this.mountK);
    if (mine) {
      const v = mine.veh;
      const P = VEHICLES[mine.vk];
      const st = P.seats[this.myK] || P.seats[0];
      v.model.group.updateMatrixWorld(true);
      const sv = g.selfBody;
      if (sv && sv.headWorld) {
        // where our own head is in the seat: a little up and forward of its joint, by the vehicle's own up and forward
        sv.headWorld(_v);
        const m = v.model.body.matrixWorld.elements;
        _v.x += m[4] * 0.085 - m[8] * 0.07;
        _v.y += m[5] * 0.085 - m[9] * 0.07;
        _v.z += m[6] * 0.085 - m[10] * 0.07;
      } else _v.set(st[0], st[1] + P.eye, st[2] + (P.eyeZ || 0)).applyMatrix4(v.model.body.matrixWorld);
      // the view goes round with it
      const d = wrap(v.yaw - this.lastYaw);
      this.lastYaw = v.yaw;
      if (Math.abs(d) < 0.5) g.input.yaw += d;
      eye.on = true;
      eye.x = this.mountFrom.x + (_v.x - this.mountFrom.x) * k;
      eye.y = this.mountFrom.y + (_v.y - this.mountFrom.y) * k;
      eye.z = this.mountFrom.z + (_v.z - this.mountFrom.z) * k;
      eye.roll = -(v.lean + v.roll) * 0.7 * k;
      // (the engine through the seat)
      const run = v.idle || 0;
      eye.y += Math.sin(g.time * 47) * 0.0025 * run + Math.sin(g.time * 9.1) * 0.004 * Math.min(1, Math.abs(v.vf) / 8) * (g.world?.roadKindAt?.(v.x, v.z) === 2 ? 0.3 : 1);
      if (s.pass) {
        // carried: our own copy of where we are is the seat's (the server's is; nothing checks ours)
        _v2.set(st[0], st[1], st[2]).applyMatrix4(v.model.body.matrixWorld);
        const fy = seatFeet(mine.vk, _v2.y);
        const pr = g.prediction;
        pr.state.x = pr.prev.x = rp.x = _v2.x;
        pr.state.y = pr.prev.y = rp.y = fy;
        pr.state.z = pr.prev.z = rp.z = _v2.z;
      }
    } else if (this.mountK > 0) {
      // out of it: the eye goes from the seat to where we stand
      const tx = rp.x, ty = rp.y + g.eyeH, tz = rp.z;
      eye.on = true;
      eye.x = tx + (this.mountFrom.x - tx) * k;
      eye.y = ty + (this.mountFrom.y - ty) * k;
      eye.z = tz + (this.mountFrom.z - tz) * k;
    }
    // what the HUD shows of it
    const h = this.hud;
    h.on = !!mine;
    if (mine) {
      const v = mine.veh;
      const P = VEHICLES[mine.vk];
      h.kind = mine.vk;
      h.name = P.name;
      h.kmh = Math.round(Math.abs(v.vf) * 3.6);
      h.fuel = v.fuel;
      h.tank = P.tank > 0;
      h.hp = v.hp;
      h.driver = this.myK === 0;
      h.lights = v.lights;
      h.state = v.state;
    }
  }

  // our hands on the bars or the wheel (the weapon is put away: Game), where the model has them this frame
  get handsOn() {
    return !!this.g.prediction.state.drive && !!this.mine;
  }
  get riding() {
    return !!this.mine;
  }
  arm(e) {
    const rig = this.rig;
    const show = !!e && !this.g.debugCam && !this.g.cine && this.mountK > 0.75;
    rig.visible = show;
    if (!show) return;
    const v = e.veh;
    const P = VEHICLES[e.vk];
    const m = v.model;
    const body = m.body;
    body.updateWorldMatrix(true, false);
    body.matrixWorld.decompose(rig.position, rig.quaternion, rig.scale);
    rig.updateMatrixWorld(true);
    _m.copy(body.matrixWorld).invert();
    _q.copy(rig.quaternion).invert();
    const st = P.seats[0];
    const hq = this.handQ[e.vk];
    for (let k = 0; k < 2; k++) {
      const arm = this.arms[k];
      const side = k ? 1 : -1;
      const grip = m.grips[k];
      grip.updateWorldMatrix(true, false);
      // the shoulder under the eye, a hand's breadth out; the grip and the hand's lie in the body's frame
      // the shoulder: our own body's (it is drawn without its arms: these are them)
      if (this.g.selfBody?.shoulderWorld) this.g.selfBody.shoulderWorld(side, _S).applyMatrix4(_m);
      else _S.set(st[0] + side * 0.19, st[1] + P.eye - 0.25, st[2] + (P.eyeZ || 0) + 0.06);
      arm.shoulder.position.copy(_S);
      _v.setFromMatrixPosition(grip.matrixWorld).applyMatrix4(_m);
      grip.getWorldQuaternion(_q2).premultiply(_q).multiply(hq[k]);
      arm.gripCenter(_v3, 'grip').applyQuaternion(_q2);
      _v.sub(_v3);
      _pole.set(side * 0.8, -1, 0.3);
      ikTwoBone(_S, _v, ARM_L1, ARM_L2, _pole, _qU, _qL);
      arm.orient(_qU, _qL, _q2);
    }
  }

  // A survivor's body put in its seat of the vehicle as drawn (Entities, for whoever seatOf names): sv is their
  // model (createSurvivor). Returns what their pose is to be given: { sitT, sitK, sitSplay, reach } (reach: where a
  // driver's hands go; null for whoever is carried).
  place(seat, sv) {
    return seatBody(seat.e.veh.model, seat.e.vk, seat.k, sv, seat.pose || (seat.pose = {}));
  }

  // the headlamps that are lit, among the lights the scene has to give (Entities: the nearest get one)
  lampCands(out, camPos) {
    for (const e of this.list.values()) {
      const v = e.veh;
      if (!v.lights || v.state === VSTATE.WRECK || v.state === VSTATE.BROKEN || !v.model.group.visible) continue;
      const pos = new THREE.Vector3();
      const dir = new THREE.Vector3();
      v.model.lampWorld(pos, dir);
      out.push({ pos, dir, d: e === this.mine ? -1 : (v.x - camPos.x) ** 2 + (v.z - camPos.z) ** 2, lamp: true, wide: e.vk === VEH.CAR ? 0.72 : 0.5 });
    }
  }

  // ---------------------------------------------------------------- [E]
  // The prompt while we are in one.
  rideLook(s) {
    const g = this.g;
    const e = this.mine;
    this.target.vehicle = e ? e.id : 0;
    this.target.e = e;
    this.target.siphon = null;
    this.target.exit = true;
    g.lookTarget = this.target;
    if (!e) return;
    const P = VEHICLES[e.vk];
    const v = e.veh;
    const out = `${bindTag('interact')} Get ${P.shell ? 'out' : 'off'}`;
    if (s.pass) return void (g.prompt = out);
    const lamp = P.tank ? ` · ${bindTag('flashlight')} Headlamp` : '';
    if (v.state === VSTATE.DEAD) g.prompt = `Broken down: it needs patching up (${costText(REPAIR)}) · ${out}`;
    else if (P.tank && s.dfuel <= 0) g.prompt = `Out of fuel · ${out}`;
    else if (g.time - this.boardT < PROMPT_TIME) g.prompt = `${bindTag('forward')} ${P.pedal ? 'Pedal' : 'Throttle'} · ${bindTag('back')} Brake / reverse · ${bindTag('left')} ${bindTag('right')} Steer · ${bindTag('jump')} ${P.two ? 'Back brake' : 'Handbrake'}${P.pedal ? ` · ${bindTag('sprint')} Pedal hard · ${bindTag('fire')} Bell` : ` · ${bindTag('fire')} Horn`}${lamp} · ${out}`;
    else g.prompt = out;
  }

  // One the view ray (from o along d) is on, for a survivor on foot: sets Game.lookTarget / prompt and returns true.
  look(ox, oy, oz, dx, dy, dz, counts) {
    const g = this.g;
    if (!this.list.size) return false;
    let best = null;
    let bestT = INTERACT_REACH;
    for (const e of this.list.values()) {
      const v = e.veh;
      const P = VEHICLES[e.vk];
      const rx = v.x - ox;
      const rz = v.z - oz;
      if (rx * rx + rz * rz > (INTERACT_REACH + P.half + 1) ** 2) continue;
      // the ray against its box (a little fat, so that a moped is not a thing to aim at)
      const c = Math.cos(v.yaw);
      const sn = Math.sin(v.yaw);
      const lox = -rx * c + rz * sn;
      const loz = -rx * sn - rz * c;
      const ldx = dx * c - dz * sn;
      const ldz = dx * sn + dz * c;
      const t = rayBox(lox, oy - v.y, loz, ldx, dy, ldz, P.halfW + 0.3, P.tall + 0.25, P.half + 0.25, bestT);
      if (t < 0 || t >= bestT) continue;
      bestT = t;
      best = e;
    }
    if (!best) return false;
    const e = best;
    const v = e.veh;
    const P = VEHICLES[e.vk];
    const name = e.q[5] & VFLAG.QUEST ? 'your car' : `the ${VEH_NAMES[e.vk]}`;
    const T = this.target;
    T.vehicle = e.id;
    T.e = e;
    T.siphon = null;
    T.exit = false;
    g.lookTarget = T;
    const E = bindTag('interact');
    const s = g.prediction.state;
    if (v.state === VSTATE.WRECK) {
      g.lookTarget = null;
      g.prompt = `${cap(name)} is burnt out`;
      return true;
    }
    if (v.state === VSTATE.BROKEN) {
      const need = (e.q[5] & VFLAG.NEED) >> VFLAG.NEED_SHIFT;
      const fix = FIX[e.vk];
      const parts = [];
      let can = null;
      for (let i = 0; i < fix.length; i++) {
        if (!(need & (1 << i))) continue;
        const have = counts[fix[i][0]] || 0;
        parts.push(`${ITEM_DEFS[fix[i][0]].name} ${Math.min(have, fix[i][1])}/${fix[i][1]}`);
        if (!can && have >= fix[i][1]) can = fix[i];
      }
      if (!parts.length) {
        // one of the bridgehead's: it wants no part, only a few seconds' work
        g.prompt = `${E} Hold to get ${name} running`;
        T.dead = false;
        return true;
      }
      g.prompt = can ? `${E} Hold to fit ${ITEM_DEFS[can[0]].name} ×${can[1]} · ${cap(name)} needs ${parts.join(', ')}` : `${cap(name)} does not run. It needs ${parts.join(', ')}`;
      if (!can) T.dead = true;
      else T.dead = false;
      return true;
    }
    T.dead = false;
    const patch = Object.keys(REPAIR).every((k) => (counts[k] || 0) >= REPAIR[k]);
    if (v.state === VSTATE.DEAD) {
      g.prompt = patch ? `${E} Hold to patch ${name} up (${costText(REPAIR)})` : `${cap(name)} has broken down. Patching it up takes ${costText(REPAIR)}`;
      return true;
    }
    const taken = v.seats.slice(0, P.seats.length).filter(Boolean).length;
    const free = taken < P.seats.length;
    const who = v.seats[0] ? g.name(v.seats[0]) : '';
    let line = !free ? `${cap(name)} is full` : !v.seats[0] ? `${E} ${P.pedal ? 'Ride' : 'Drive'} ${name}` : `${E} Get ${P.shell ? 'in' : 'on'} with ${who}`;
    const fuel = s.ammo[AMMO.FUEL] || 0;
    const jobs = [];
    if (P.tank && v.fuel < 0.98) jobs.push(fuel > 0 ? `hold ${E} to pour Fuel in (tank ${Math.round(v.fuel * 100)}%)` : `tank ${Math.round(v.fuel * 100)}%: no Fuel on you`);
    else if (v.hp < 0.98) jobs.push(patch ? `hold ${E} to patch it up (${costText(REPAIR)})` : `${Math.round(v.hp * 100)}% sound: a patch takes ${costText(REPAIR)}`);
    if (jobs.length) line += ` · ${jobs[0]}`;
    g.prompt = line;
    return true;
  }

  // A wreck with something in its tank under the crosshair (nothing else to do there): adds to the prompt.
  siphonLook(cam) {
    const g = this.g;
    const w = g.world;
    if (!w || w.kind !== WORLD.MAINLAND || g.prediction.state.drive || g.prediction.state.pass) return false;
    cam.getWorldDirection(_v);
    raycastWorld(w, cam.position.x, cam.position.y, cam.position.z, _v.x, _v.y, _v.z, INTERACT_REACH, _ray);
    const prop = _ray.col?.tag;
    if (!prop || typeof prop !== 'object' || !siphonOf(prop)) return false;
    const key = `${qpos(prop.x)},${qpos(prop.z)}`;
    if (this.dry.has(key)) return false;
    const T = this.target;
    T.vehicle = 0;
    T.e = null;
    T.siphon = prop;
    T.exit = false;
    g.lookTarget = T;
    g.prompt = `${bindTag('interact')} Hold to siphon its tank${g.prompt ? ` · ${g.prompt}` : ''}`;
    return true;
  }

  // [E] on what `look`, `rideLook` or `siphonLook` found
  interact(t) {
    const g = this.g;
    if (t.siphon) {
      this.siphonKey = `${qpos(t.siphon.x)},${qpos(t.siphon.z)}`;
      g.holding = 0xffdf;
      g.conn.action(ACT.SIPHON, qpos(t.siphon.x), qpos(t.siphon.z));
      return;
    }
    if (t.exit) return void g.conn.action(ACT.VEHICLE, VACT.EXIT, 0);
    const e = t.e;
    if (!e || t.dead) return;
    const v = e.veh;
    if (v.state === VSTATE.BROKEN || v.state === VSTATE.DEAD) return g.beginHold(e.id);
    this.held = e.id;
    this.heldT = 0;
  }
  // [E] comes up before the hold: a tap, which gets in
  release() {
    if (!this.held) return;
    this.g.conn.action(ACT.VEHICLE, VACT.ENTER, this.held);
    this.held = 0;
  }

  // what a hold on one is called on the progress ring
  holdLabel(kind) {
    return kind === HOLD.VEH_FIX ? 'Working on it…' : kind === HOLD.VEH_FUEL ? 'Pouring fuel in…' : kind === HOLD.VEH_REPAIR ? 'Patching it up…' : kind === HOLD.SIPHON ? 'Siphoning the tank…' : '';
  }

  // a notice of the server's about one (Game.onNotify): true when it was ours
  notify(msg, arg) {
    const g = this.g;
    const ui = g.ui;
    switch (msg) {
      case NOTIFY.VEH_FIXED:
        ui.notify(arg === g.myId ? 'It runs.' : `${g.name(arg)} has got one running.`, 'toast', 2.5);
        return true;
      case NOTIFY.VEH_BROKE:
        ui.notify('It has broken down.', 'toast', 3);
        return true;
      case NOTIFY.VEH_WRECKED:
        ui.notify('It is burnt out.', 'toast', 3);
        return true;
      case NOTIFY.SIPHONED:
        if (this.siphonKey) this.dry.add(this.siphonKey);
        ui.notify(arg ? `+${arg} Fuel` : 'Its tank is dry.', 'toast', 2);
        return true;
      case NOTIFY.VEH_NEED:
        ui.notify(NEED_TEXT[arg] || 'Nothing to be done', 'toast', 1.8);
        return true;
      case NOTIFY.VEH_OFF:
        ui.notify(arg === VEH_OFFS.THROWN ? 'Thrown off!' : arg === VEH_OFFS.PULLED ? 'Pulled off!' : 'Knocked off!', 'toast', 1.6);
        g.camShake = Math.min(1, (g.camShake || 0) + 0.6);
        return true;
    }
    return false;
  }

  // our own vehicle struck something (the simulation's 'veh_crash'), or its tyres let go ('veh_skid')
  crash(v) {
    const g = this.g;
    g.camShake = Math.min(1, (g.camShake || 0) + Math.min(0.9, v * 0.07));
  }
  skid() {
    this.g.skidT = this.g.time + 0.15;
  }
}

// A survivor's model sv put in seat k of a vehicle's model as it stands: its hips on the seat, facing the way the
// vehicle does, leaning with it. out: { sitT, sitK, sitSplay, reach } for the survivor's own pose (characters.js).
// (Also the models sandbox's, so that what is measured there is what the game draws.)
export function seatBody(model, vk, k, sv, out = {}) {
  const P = VEHICLES[vk];
  const st = P.seats[k] || P.seats[0];
  const pose = SEAT_POSE[vk][k] || SEAT_POSE[vk][0];
  const body = model.body;
  model.group.updateMatrixWorld(true);
  // the hips over the model's own origin: by how the legs are folded (characters.js legCycle)
  const L = sv._inst?.P;
  const ext = (t, kn) => (L ? L.thighLen * Math.cos(t) + L.shinLen * Math.cos(t - kn) : 0);
  const hip = SEAT_HIP + ext(pose[0], pose[1]) - ext(SIT_T, SIT_K);
  const obj = sv.object;
  obj.position.set(st[0], st[1] - hip, st[2]).applyMatrix4(body.matrixWorld);
  body.getWorldQuaternion(obj.quaternion);
  out.sitT = pose[0];
  out.sitK = pose[1];
  out.sitSplay = pose[2];
  out.sitLean = pose[3] || 0;
  out.pedal = undefined;
  // the feet: on the pedals, the footboard, the floor - where the model has them this frame (characters.js solveFeet)
  const feet = model.feet[k];
  if (!feet) out.feet = null;
  else {
    const f = out.feet || (out.feet = { l: new THREE.Vector3(), r: new THREE.Vector3(), splay: 0, pitch: 0 });
    const m = body.matrixWorld.elements;
    for (let i = 0; i < 2; i++) {
      const t = i ? f.r : f.l;
      feet[i].getWorldPosition(t);
      // (the ankle: over the ball of the foot and behind it, by the vehicle's own up and back)
      t.x += m[4] * ANKLE[0] + m[8] * ANKLE[1];
      t.y += m[5] * ANKLE[0] + m[9] * ANKLE[1];
      t.z += m[6] * ANKLE[0] + m[10] * ANKLE[1];
    }
    f.splay = pose[2];
    f.pitch = pose[4] || 0;
  }
  if (k !== 0) out.reach = null;
  else {
    const r = out.reach || (out.reach = { l: new THREE.Vector3(), r: new THREE.Vector3() });
    model.grips[0].getWorldPosition(r.l);
    model.grips[1].getWorldPosition(r.r);
  }
  return out;
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const costText = (cost) => Object.keys(cost).map((k) => `${cost[k]} ${ITEM_DEFS[k].name}`).join(', ');

// a ray from (ox, oy, oz) along d against the box |x| <= hx, 0 <= y <= hy, |z| <= hz: where it enters, or -1
function rayBox(ox, oy, oz, dx, dy, dz, hx, hy, hz, maxT) {
  let t0 = 0;
  let t1 = maxT;
  for (const [o, d, lo, hi] of [[ox, dx, -hx, hx], [oy, dy, 0, hy], [oz, dz, -hz, hz]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  return t0;
}
void EYE_HEIGHT;
void ITEM;
void _e;
