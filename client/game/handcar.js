// The handcars on the railway in the client (the rules: shared/handcar.js, the server: server/handcar.js, the model:
// render/models/handcar.js). The server replicates one entity a car (ENT.HANDCAR: where it is on the line, who rides
// it). Here:
//   - each car drawn on the line where it is this frame: the car we ride where our own prediction has it (its
//     commands have moved it on ahead of the server, and the deck must be under our feet), every other one where
//     the server had it a moment ago, as any entity is drawn. The lever goes up and down and the wheels turn with
//     the distance it rolls, and it rattles louder and faster the faster it goes
//   - another player on a car is drawn standing on its deck, wherever the car is drawn
//   - [E] on a car gets on it (the server seats us); on one, [E] gets off: getting off is the simulation's jump,
//     so [E] is sent as Space for a moment, as getting out of a seat at the fair is
//   - while we work the lever, our hands are on its handle bar in our view instead of the weapon
import { BTN, INTERACT_REACH, EYE_HEIGHT } from '../../shared/constants.js';
import { SOUND } from '../../shared/defs.js';
import { ACT, HCAR_AT } from '../../shared/protocol.js';
import { HANDCAR, carFrame, linePoint, leverAngle } from '../../shared/handcar.js';
import { canReach } from '../../shared/collision.js';
import { createHandcar, createHandcarView, WHEEL_R } from '../render/models/handcar.js';
import { bindTag } from './binds.js';

const PROMPT_TIME = 6; // seconds the full list of what the keys do stays up after getting on
const BAR_Y = -0.2; // the handle bar in our view, with the lever level: this far below the eye...
const BAR_Z = -0.55; // ...and this far in front of it
const BAR_BOB = 0.075; // ...and how far it goes up and down with the lever
const _f = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
const _p = { x: 0, y: 0, z: 0, tx: 0, tz: 1, len: 1, slope: 0 };
const _t = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

export class HandcarClient {
  constructor(game) {
    this.g = game;
    this.cars = []; // by car (handcars order): { e (its entity), model, s (where it is drawn), v (drawn speed) }
    this.press = 0; // BTN.JUMP for a moment after [E] on "Get off": getting off is the simulation's jump
    this.pressT = 0;
    this.boardT = -1e9; // when we got onto a car
    this.onCar = 0; // the car we are on + 1, as the prediction has it
    this.hands = 0; // 0..1: our hands on the handle bar in our view, the weapon put away
    this.target = { handcar: '', k: 0 }; // the look target handed to Game (interact)
    this.view = createHandcarView();
    this.view.visible = false;
    game.renderer.vmScene.add(this.view);
  }

  setWorld() {
    this.cars.length = 0;
    this.onCar = 0;
    this.hands = 0;
    this.press = 0;
  }

  // Entities: a car came into view (its entity carries which car it is: e.k)
  attach(e) {
    const g = this.g;
    const model = createHandcar();
    model.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    e.obj = model;
    g.scene.add(model);
    e.loop = g.audio.createLoop?.('handcar', e.rx, e.ry, e.rz) || null;
    this.cars[e.k] = { e, model, s: e.q[3] / HCAR_AT, v: 0 };
    this.place(this.cars[e.k], 0);
  }

  // the rider of car k (0: nobody), ourselves included
  rider(k) {
    const g = this.g;
    if (this.onCar === k + 1) return g.myId;
    const c = this.cars[k];
    return c ? c.e.q[4] : 0;
  }

  // Where another player riding a car stands this frame, on its deck as it is drawn -> true and out.x / y / z, or
  // false when they are on none
  riderAt(id, out) {
    if (!id) return false;
    const m = this.g.world?.rail?.main;
    for (const c of this.cars) {
      if (!c || c.e.q[4] !== id) continue;
      linePoint(m, c.s - HANDCAR.stand, _p);
      out.x = _p.x;
      out.y = _p.y + HANDCAR.deck;
      out.z = _p.z;
      return true;
    }
    return false;
  }

  // our hands are on the lever (Game puts the weapon in them away)
  get handsOn() {
    return this.hands > 0.5;
  }

  // Once a frame, after the prediction has stepped and before the entities are placed.
  update(dt) {
    const g = this.g;
    const pred = g.prediction;
    const ps = pred.state;
    const was = this.onCar;
    this.onCar = g.self.alive && ps.cart > 0 && pred.prev.cart === ps.cart ? ps.cart : 0;
    if (this.onCar && this.onCar !== was) this.boardT = g.time;
    if (this.press && (!ps.cart || (this.pressT -= dt) <= 0)) this.press = 0;
    for (let k = 0; k < this.cars.length; k++) {
      const c = this.cars[k];
      if (!c) continue;
      if (g.entities.ents.get(c.e.id) !== c.e) {
        // out of view, or the world went: its model went with the entity (Entities.destroyView)
        this.cars[k] = null;
        continue;
      }
      const s = this.onCar === k + 1 ? pred.prev.cartS + (ps.cartS - pred.prev.cartS) * pred.alpha : c.e.samples.sample(g.renderTick, _t).pitch;
      this.place(c, dt, s);
    }
    // our hands on the bar while the lever is worked (W / S held), the weapon back up once it is let go
    const working = !!this.onCar && !!(ps.lastBtn & (BTN.FWD | BTN.BACK));
    this.hands += ((working ? 1 : 0) - this.hands) * Math.min(1, dt * 9);
    if (this.hands < 0.01) this.hands = 0;
    const v = this.view;
    v.visible = this.hands > 0 && !g.ui.inventoryOpen && !g.ui.mapOpen && !g.ui.boardOpen && !g.debugCam;
    const c = this.onCar ? this.cars[this.onCar - 1] : null;
    if (v.visible && c) {
      const a = leverAngle(c.s);
      v.position.set(0, BAR_Y - (Math.sin(a) / Math.sin(HANDCAR.swing)) * BAR_BOB - (1 - this.hands) * 0.4, BAR_Z);
      v.rotation.set(-a * 0.8, 0, 0);
    }
  }

  // car c drawn at s (where it was drawn last frame when s is left out): the car, its lever, its wheels, its rattle
  place(c, dt, s = c.s) {
    const m = this.g.world.rail.main;
    const ds = s - c.s;
    if (dt > 0) c.v += (Math.abs(ds) / dt - c.v) * Math.min(1, dt * 6);
    c.s = s;
    carFrame(m, s, _f);
    const model = c.model;
    model.position.set(_f.x, _f.y, _f.z);
    model.rotation.set(-_f.pitch, _f.yaw, 0);
    model.userData.lever.rotation.x = -leverAngle(s);
    model.userData.near.visible = c !== this.cars[this.onCar - 1]; // (our own hands have one of their own: update)
    // (no further than the static world is drawn: past that the haze has it, and it is thirty draw calls a frame)
    const eye = this.g.camera.position;
    model.visible = (_f.x - eye.x) ** 2 + (_f.z - eye.z) ** 2 < (this.g.viewDist ?? 1e9) ** 2;
    for (const w of model.userData.wheels) w.rotation.x = s / WHEEL_R;
    const loop = c.e.loop;
    if (loop) {
      loop.setPosition(_f.x, _f.y - 0.4, _f.z);
      loop.setVolume(Math.min(1, c.v / 5) ** 1.5);
      loop.setRate(Math.max(0.5, Math.min(1.35, c.v / 10)));
    }
  }

  // The prompt while we ride: what the keys do for a while after getting on, then the way off and the speed.
  rideLook(s) {
    const g = this.g;
    this.target.handcar = 'off';
    g.lookTarget = this.target;
    const kmh = Math.round(Math.abs(s.cartV) * 3.6);
    if (g.time - this.boardT < PROMPT_TIME) g.prompt = `${bindTag('forward')} Pump towards where you look · ${bindTag('back')} Pump back / brake · ${bindTag('sprint')} Pump hard · ${bindTag('interact')} Get off`;
    else g.prompt = `${bindTag('interact')} Get off · ${kmh} km/h`;
  }

  // A car the view ray (from o along d) is on, for a player on foot: sets Game.lookTarget / prompt and returns true.
  look(ox, oy, oz, dx, dy, dz) {
    const g = this.g;
    const m = g.world?.rail?.main;
    if (!m || !this.cars.length) return false;
    const reachTop = g.renderPos.y + EYE_HEIGHT;
    const r = HANDCAR.pick.r;
    let best = -1;
    let bestT = INTERACT_REACH;
    for (let k = 0; k < this.cars.length; k++) {
      const c = this.cars[k];
      if (!c) continue;
      carFrame(m, c.s, _f);
      const x = _f.x;
      const y = _f.y + HANDCAR.pick.y;
      const z = _f.z;
      // (the same test Entities.pick makes: the ray passes within r of the point, inside reach, with no wall between)
      const rx = x - ox;
      const ry = y - oy;
      const rz = z - oz;
      const t = rx * dx + ry * dy + rz * dz;
      if (t < 0 || t >= bestT) continue;
      const px = rx - dx * t;
      const py = ry - dy * t;
      const pz = rz - dz * t;
      if (px * px + py * py + pz * pz > r * r || !canReach(g.world, ox, oy, oz, x, y, z, reachTop)) continue;
      bestT = t;
      best = k;
    }
    if (best < 0) return false;
    const who = this.rider(best);
    if (who) {
      g.lookTarget = null;
      g.prompt = `${g.name(who)} is on the handcar`;
      return true;
    }
    this.target.handcar = 'board';
    this.target.k = best;
    g.lookTarget = this.target;
    g.prompt = `${bindTag('interact')} Get on the handcar`;
    return true;
  }

  // [E] on what `look` or `rideLook` found
  interact(t) {
    if (t.handcar === 'off') {
      this.press = BTN.JUMP;
      this.pressT = 0.3;
      return;
    }
    this.g.conn.action(ACT.HANDCAR, t.k);
  }

  // the bang of our own car running into the end of the line (the simulation's 'cart_bump')
  bump() {
    const g = this.g;
    const s = g.prediction.state;
    g.audio.play(SOUND.METAL_HIT, { x: s.x, y: s.y + 0.2, z: s.z, volume: 1.2, rate: 0.7 });
    g.camShake = Math.min(1, (g.camShake || 0) + 0.35);
  }
}
