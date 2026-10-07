// The stray cat in somebody's arms, client side (the rules: server/cats.js). The server replicates the cat (ENT.CAT)
// with whose arms it is in (TF.HOLDER) and whether it is being stroked (CANIM.PET); whether it is in our own arms is
// our simulation's s.pet, so the weapon goes away and comes back on the command that does it. Here:
//   - [E] on it picks it up (Game.interact: ACT.INTERACT on the cat). With it in our arms the prompt says how to
//     stroke it and put it down; [E] or [G] sets it down (ACT.CAT_PUT), and so does a weapon key (the simulation)
//   - our own view of it: a cat of its coat across our arms in the viewmodel (ViewModel.holdCat), stroked while the
//     fire button is held, purring as it is
//   - everyone else's: the cat drawn across its holder's forearms (their pose: s.cradle, s.pet), purring to whoever
//     is near while they stroke it, and a meow as it is picked up
import * as THREE from 'three';
import { ENT, ACT } from '../../shared/protocol.js';
import { CANIM, SOUND } from '../../shared/defs.js';
import { createCat } from '../render/models/cat.js';
import { bindTag } from './binds.js';

const PURR_EVERY = 2.2; // s: one purr is a breath in and out
const PURR_RANGE = 12; // m: heard this close to somebody else's cat
const _at = new THREE.Vector3();

export class CatClient {
  constructor(game) {
    this.g = game;
    this.cats = new Set(); // the cat entities in view (attach / detach)
    this.view = null; // the cat in our own arms, as the viewmodel draws it
    this.purrT = 0; // our own purr's clock
  }

  // our own simulation has it in our arms
  get holding() {
    return !!this.g.prediction.state.pet;
  }

  // Entities: a cat came into view, or went
  attach(e) {
    this.cats.add(e);
    e.holder = e.q[5];
    e.purrT = Math.random() * PURR_EVERY;
  }
  detach(e) {
    this.cats.delete(e);
  }

  // the cat in this player's arms, if it is in view
  heldBy(id) {
    for (const e of this.cats) if (e.q[5] === id) return e;
    return null;
  }

  // [E] or [G] with it in our arms
  put() {
    this.g.conn.action(ACT.CAT_PUT);
  }

  // The [E] prompt while it is in our arms: it is all our hands are doing (Game.updateLookTarget)
  look() {
    if (!this.holding) return false;
    const g = this.g;
    g.lookTarget = 'cat';
    g.prompt = `${bindTag('fire')} Pet the cat · ${bindTag('interact')} Put it down`;
    return true;
  }

  // once a frame, before the viewmodel: our own view of it, and the purr while we stroke it. stroking: the fire button
  // held with it in our arms
  update(dt, stroking) {
    const g = this.g;
    const want = this.holding && !!g.self.alive;
    if (want && !this.view) {
      // (its coat: the cat whose holder we are, or, the moment before the snapshot says so, the nearest one)
      const e = this.heldBy(g.myId) || this.nearest();
      this.view = createCat(e ? e.variant : 0, e ? e.id : 0, true);
      g.vm.holdCat(this.view);
      this.purrT = 0.4;
    } else if (!want && this.view) {
      g.vm.holdCat(null);
      this.view.dispose();
      this.view = null;
    }
    if (!this.view || !stroking) return;
    this.purrT -= dt;
    if (this.purrT <= 0) {
      this.purrT = PURR_EVERY;
      g.audio.playLocal('purr');
    }
  }

  nearest() {
    const rp = this.g.renderPos;
    let best = null;
    let bd = Infinity;
    for (const e of this.cats) {
      const d = (e.rx - rp.x) ** 2 + (e.rz - rp.z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // Entities.update, after every entity has moved: a cat in somebody's arms is drawn across their forearms, where
  // their body is posed this frame (ours: only for the free camera's body; the viewmodel has it otherwise). The
  // meow as it is picked up, the purr while it is stroked.
  placeHeld(dt, time, camPos) {
    const g = this.g;
    for (const e of this.cats) {
      const holder = e.q[5];
      const v = e.view;
      if (holder !== e.holder) {
        if (holder && v) g.audio.play(SOUND.CAT_MEOW, { x: e.rx, y: e.ry, z: e.rz }); // (picked up)
        e.holder = holder;
      }
      if (!v) continue;
      if (!holder) {
        v.object.visible = true; // (set down: on the ground again, where Entities.update draws it. In our own arms it was hidden)
        continue;
      }
      const me = holder === g.myId;
      const by = me ? (g.debugCam ? g.selfBody : null) : g.entities.ents.get(holder)?.view;
      v.object.visible = !!by && by.object.visible;
      if (!v.object.visible) continue;
      by.cradleAt(_at);
      v.object.position.copy(_at);
      v.object.rotation.y = by.object.rotation.y + Math.PI / 2; // (its head to their left)
      e.rx = _at.x;
      e.ry = _at.y;
      e.rz = _at.z;
      v.update(dt, e.q[4], 0, time);
      if (me || e.q[4] !== CANIM.PET) continue;
      e.purrT -= dt;
      if (e.purrT <= 0) {
        e.purrT = PURR_EVERY;
        if ((e.rx - camPos.x) ** 2 + (e.rz - camPos.z) ** 2 < PURR_RANGE * PURR_RANGE) g.audio.play(SOUND.CAT_PURR, { x: e.rx, y: e.ry + 0.2, z: e.rz });
      }
    }
  }

  // the pose of a survivor with the cat in their arms (Entities, Game.updateSelfBody): { cradle, pet }
  poseOf(id, out) {
    const e = this.heldBy(id);
    out.cradle = !!e;
    out.pet = !!e && e.q[4] === CANIM.PET;
    return out;
  }
}
