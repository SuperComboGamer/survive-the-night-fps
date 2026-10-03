// Flare gun flares (PROJ.SKYFLARE, shared/skyflare.js): every one in the sky drawn - its glow, the canister under its
// chute, the sparks it drips and the smoke it leaves, its pop and its hiss - and the light of them on the world: the
// sky light (render/lights.js Lights.setSky) under the one that lights the ground round the eye most, and the haze, the
// sky and the clouds lit round them (Environment.flare). One that has come down burns on the ground like a big road
// flare, in the fire-light pool.
// Everyone else's are the server's projectiles, drawn where they are replicated. Ours is flown here from the moment of
// the shot (fire), the way the server flies it (the same closed-form flight, by our own clock), so it leaves the
// barrel at once and not a round trip later; the server's copy of it is never drawn (addEntity pairs the two).
import * as THREE from 'three';
import { INTERP_DELAY } from '../../shared/constants.js';
import { PROJ, SOUND } from '../../shared/defs.js';
import { SKYFLARE, launchFlare, flareStep, flareGlow } from '../../shared/skyflare.js';
import { createProjectile } from '../render/models/misc.js';
import { getTexture } from '../render/textures.js';

const FLARE_COLOR = 0xffc8b4; // what it lights: magnesium-white with a blush of red
const CORE_COLOR = new THREE.Color(0xfff4ee).multiplyScalar(3);
const HALO_COLOR = new THREE.Color(0xff9a86);
const GROUND_LIT = 4.5; // the ground straight under one in the air, at full burn (Lights.setSky)
const LIT_REACH = 70; // m across the ground its light reaches (a little past the circle that pins a Shade)
const SKY_FAR = 170; // m: how far off one still lights half as much of the sky
const CLOSE = 0.15; // s: how fast our own drawn flare closes from the muzzle onto its line of flight
const PAIR_WAIT = 2.5; // s: one of ours the server has not answered in this long was never fired
const OPEN_TIME = 0.6; // s: the chute opening
const _ray = { t: -1, col: null, terrain: false };
const _flareCol = new THREE.Color(FLARE_COLOR);

export class SkyFlares {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.tex = null;
  }

  // Our own shot: fired from the eye (ev: x, y, z) along (dx,dy,dz) with the shot's seed; (mx,my,mz) is the muzzle as
  // drawn
  fire(ev, dx, dy, dz, mx, my, mz) {
    const f = launchFlare(ev.x, ev.y, ev.z, dx, dy, dz, ev.seed);
    const v = this.view(true, f.tOpen, 0);
    v.f = f;
    v.ox = mx - ev.x; // the muzzle's offset from the eye, closed over CLOSE
    v.oy = my - ev.y;
    v.oz = mz - ev.z;
    v.x = mx;
    v.y = my;
    v.z = mz;
  }

  // The server's flare entity e has come into view: ours if we have one in the air it has not answered yet (not drawn
  // twice), anyone else's (or one of ours from before we joined) drawn where it is replicated
  addEntity(e) {
    if (e.owner === this.g.myId) {
      const v = this.list.find((k) => k.own && !k.e && !k.paired);
      if (v) {
        v.e = e;
        v.paired = true;
        e.skyView = v;
        return;
      }
    }
    const v = this.view(false, e.tOpen ?? SKYFLARE.openMin, Math.max(0, (e.age ?? 0) - INTERP_DELAY));
    v.e = e;
    v.x = e.rx;
    v.y = e.ry;
    v.z = e.rz;
    e.skyView = v;
  }

  // ...and gone (burnt out, or out of the game): one of ours flies on to its own burnout
  removeEntity(e) {
    const v = e.skyView;
    e.skyView = null;
    if (!v) return;
    v.e = null;
    if (!v.own) this.end(v);
  }

  // the glow of one, drawn as a flare's are (its canister is among the projectiles): for Game.warmViews
  warm() {
    return this.sprite(HALO_COLOR, 0.3);
  }

  sprite(color, opacity) {
    if (!this.tex) this.tex = getTexture('fx_glow');
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.renderOrder = 1001; // (after the sky dome)
    return s;
  }

  view(own, tOpen, t) {
    const g = this.g;
    const obj = createProjectile(PROJ.SKYFLARE);
    const sprite = (color, opacity) => {
      const s = this.sprite(color, opacity);
      g.scene.add(s);
      return s;
    };
    g.scene.add(obj);
    const chute = obj.userData.chute;
    if (chute) chute.scale.setScalar(t > tOpen ? 1 : 0.001);
    const v = {
      own,
      e: null,
      f: null,
      t,
      tOpen,
      x: 0,
      y: 0,
      z: 0,
      px: 0, // where it was drawn last frame (the particles fill in between)
      py: 0,
      pz: 0,
      fresh: true,
      glow: 0,
      landed: false,
      still: 0, // s a replicated one has not moved: it has come down
      popped: t > tOpen,
      obj,
      chute,
      core: sprite(CORE_COLOR, 1),
      halo: sprite(HALO_COLOR, 0.3),
      acc: { acc: 0 },
      fire: null, // the fire-light source once it lies on the ground
      emitter: null,
      loop: g.audio.createLoop?.('skyflare', 0, -1000, 0) || null,
      seed: Math.random() * 100,
    };
    this.list.push(v);
    return v;
  }

  end(v) {
    const g = this.g;
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    g.scene.remove(v.obj, v.core, v.halo);
    v.core.material.dispose();
    v.halo.material.dispose();
    if (v.emitter) g.effects.removeEmitter(v.emitter);
    v.loop?.stop();
    if (v.e) v.e.skyView = null;
  }

  clear() {
    while (this.list.length) this.end(this.list[this.list.length - 1]);
    this.g.lights.setSky(0, 0, 0, 0, 0, 0);
    const f = this.g.env.flare;
    f.ground = f.sky = 0;
  }

  // Each frame, after the entities have been placed (their fire sources gathered) and before the environment and the
  // lights are updated
  update(dt, cam) {
    const g = this.g;
    const w = g.world;
    let best = null;
    let bestGround = 0;
    let skyBest = null;
    let skyBestK = 0;
    let sky = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      v.t += dt;
      if (v.own) {
        // ours: the flight, by our own clock; drawn off the muzzle and onto its line of flight
        if (!v.paired && v.t > PAIR_WAIT) {
          this.end(v); // (the server never fired it)
          continue;
        }
        const f = flareStep(v.f, v.t, w, _ray);
        const k = Math.exp(-v.t / CLOSE);
        v.x = f.x + v.ox * k;
        v.y = f.y + v.oy * k;
        v.z = f.z + v.oz * k;
        v.landed = f.landed;
      } else if (v.e) {
        const e = v.e;
        v.still = Math.hypot(e.rx - v.x, e.ry - v.y, e.rz - v.z) < 1e-3 ? v.still + dt : 0;
        v.x = e.rx;
        v.y = e.ry;
        v.z = e.rz;
        v.landed = v.t > 0.5 && v.still > 0.4;
      }
      if (v.t >= SKYFLARE.burn) {
        this.end(v);
        continue;
      }
      if (v.fresh) {
        v.px = v.x;
        v.py = v.y;
        v.pz = v.z;
        v.fresh = false;
      }
      const glow = flareGlow(v, v.t) * (0.86 + 0.08 * Math.sin(v.t * 13.1 + v.seed) + 0.06 * Math.sin(v.t * 31.7 + v.seed * 2.3));
      v.glow = glow;
      const climbing = v.t < v.tOpen && !v.landed;
      // the chute pops open at the top of the climb, and the flare bursts alight
      if (!v.popped && v.t >= v.tOpen) {
        v.popped = true;
        if (!v.landed) g.audio.play(SOUND.FLARE_POP, { x: v.x, y: v.y, z: v.z });
      }
      if (v.chute) {
        const u = v.landed ? 0 : Math.min(1, Math.max(0, (v.t - v.tOpen) / OPEN_TIME));
        const b = u - 1;
        v.chute.scale.setScalar(Math.max(0.001, 1 + 2.70158 * b * b * b + 1.70158 * b * b)); // (out with a little overshoot)
      }
      v.obj.position.set(v.x, v.y, v.z);
      // the glow: a hot core and a halo in the haze, the same size on the screen however far off (it is the light
      // that shows from far, not the flare), the haze between eating the core more than the halo
      const d = Math.max(1, Math.hypot(v.x - cam.position.x, v.y - cam.position.y, v.z - cam.position.z));
      const haze = d * g.env.fog.density * 0.3;
      v.core.position.set(v.x, v.y, v.z);
      v.core.scale.setScalar(Math.max(0.35, d * 0.016) * (0.55 + 0.45 * glow));
      v.core.material.opacity = Math.min(1, glow * 1.2) / (1 + haze);
      v.halo.position.set(v.x, v.y + 0.2, v.z);
      v.halo.scale.setScalar(Math.max(1.6, d * 0.13) * (0.4 + 0.6 * glow));
      v.halo.material.opacity = 0.28 * glow * (0.6 + 0.4 / (1 + haze));
      // sparks and smoke, filled in along the way it went this frame; down on the ground, a road flare's
      if (!v.landed) {
        g.effects.skyflare(v.acc, v.px, v.py, v.pz, v.x, v.y, v.z, dt, climbing, glow);
        if (v.emitter) {
          // (a replicated one that only stood still for a moment: the snapshots stalled)
          g.effects.removeEmitter(v.emitter);
          v.emitter = null;
        }
      } else if (!v.emitter) v.emitter = g.effects.createEmitter('flare', v.x, v.y, v.z);
      if (v.emitter) {
        v.emitter.x = v.x;
        v.emitter.y = v.y + 0.02;
        v.emitter.z = v.z;
        v.emitter.intensity = glow > 0.05 ? 1 : 0;
      }
      v.px = v.x;
      v.py = v.y;
      v.pz = v.z;
      v.loop?.setPosition(v.x, v.y, v.z);
      v.loop?.setVolume?.(Math.min(1, glow * 1.4));
      if (glow <= 0) continue;
      // its light: down on the ground, a fire in the pool; in the air, the sky light if it lights the ground round the
      // eye the most (by the falloff of that light: the decay-1 point light at its height, Lights.setSky)
      if (v.landed) {
        const fs = v.fire || (v.fire = { x: 0, y: 0, z: 0, intensity: 0, big: true, color: FLARE_COLOR });
        fs.x = v.x;
        fs.y = v.y - 0.5;
        fs.z = v.z;
        fs.intensity = 1.5 * glow;
        g.entities.fireSources.push(fs);
      } else {
        v.h = Math.max(0.5, v.y - w.heightAt(v.x, v.z));
        const he = Math.max(10, v.h);
        const dx = v.x - cam.position.x;
        const dz = v.z - cam.position.z;
        const ground = (glow * he * he) / (he * he + dx * dx + dz * dz);
        if (ground > bestGround) {
          bestGround = ground;
          best = v;
        }
      }
      // ...and the sky it lights, as far as it is from here
      const k = (glow * (v.landed ? 0.2 : 1)) / (1 + (d / SKY_FAR) ** 2);
      sky += k;
      if (k > skyBestK) {
        skyBestK = k;
        skyBest = v;
      }
    }
    // (none of it gets down the mine, or into a boarded-up ward: as the sky's own light, Game.under)
    const open = 1 - (g.under || 0);
    if (best && open > 0.01) g.lights.setSky(best.x, best.y, best.z, best.h, GROUND_LIT * best.glow * open, LIT_REACH, FLARE_COLOR);
    else g.lights.setSky(0, 0, 0, 0, 0, 0);
    const ef = g.env.flare;
    ef.ground = bestGround;
    ef.sky = sky;
    ef.color.copy(_flareCol);
    if (skyBest) ef.dir.set(skyBest.x - cam.position.x, skyBest.y - cam.position.y, skyBest.z - cam.position.z).normalize();
  }
}
