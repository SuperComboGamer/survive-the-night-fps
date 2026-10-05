// The generator and the floodlights on the client (the rule is the server's: server/power.js, numbers in
// shared/power.js). Everything here is driven by the two structures' replicated state byte:
//  - a running generator shakes on its feet, puffs exhaust and drones (a positional loop);
//  - a powered floodlight shows a lit lens, a glow and a faint beam, and the nearest FLOOD_SPOTS of them are real
//    lights: a small fixed pool of spot lights without shadows, laid over the server's cone, so the ground and
//    whatever stands in it are lit. The pool is created once (a change in the scene's light count recompiles every
//    program); a lit floodlight further off than the nearest few keeps its lens, glow and beam and lights nothing.
// It also owns the generator's [E] (a tap pours fuel, held it is the switch) and what the prompt says of both.
import * as THREE from 'three';
import { SLOT_BUILD } from '../../shared/constants.js';
import { ITEM, STRUCT, SOUND } from '../../shared/defs.js';
import { ACT } from '../../shared/protocol.js';
import { GEN_RANGE, GEN_HOLD, GEN_TANK, FLOOD_RANGE, FLOOD_HALF, FLOOD_PITCH, FLOOD_LENS_UP, FLOOD_LENS_FWD, genOn, genFuel, genRunning, genPour, floodAim, inFloodCone } from '../../shared/power.js';
import { G } from '../render/globals.js';
import { getTexture } from '../render/textures.js';
import { TEX } from '../render/effects.js';
import { FLOOD_LENS, GEN_EXHAUST, powerReachRing } from '../render/models/power.js';
import { bindTag } from './binds.js';

// How many floodlights light the world at once: the nearest lit ones to the eye. Every lit pixel pays for every
// light in the scene, so the pool is small (the scene has 3 spot and 6 point lights besides).
export const FLOOD_SPOTS = 3;
const SPOT_REACH = 95; // a floodlight further from the eye than this takes no light of the pool (m)
const FLOOD_COLOR = 0xdce8ff; // a cold lamp, to tell it from torchlight and the flashlight
const FLOOD_POWER = 21; // the pool light's intensity at night...
const FLOOD_DAY = 0.3; // ...and the share of it left by day, when it has the sun to compete with
// The pool light is shaped so that what the eye sees lit is where the server's cone is. Its edge is soft, so it is
// a little wider and longer than the rule: at the rule's edge (FLOOD_HALF off the axis, FLOOD_RANGE out) about a
// third to a half of the light is left. It does not thin with distance (a negative decay: it grows a little), or the
// ground 20 m out, which the lamp only grazes, would show nothing of the cone.
const SPOT_ANGLE = FLOOD_HALF + 0.06;
const SPOT_PENUMBRA = 0.2;
const SPOT_DISTANCE = FLOOD_RANGE + 5;
const SPOT_DECAY = -0.25;
const BEAM_LEN = 12; // the visible shaft of the beam (m): it fades out long before the light does
const BEAM_HALF = FLOOD_HALF * 0.85;
const TAP_SHOWN = 0.15; // the switch's progress ring only shows once [E] has been down this long (a tap shows none)
const byDistance = (a, b) => a.d2 - b.d2;
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// The beam: a cone of haze added to the frame, brightest at the lamp and gone at its open end. Where the cone's
// surface turns edge-on to the eye it fades out, so it reads as a soft shaft from the side and as next to nothing from
// behind the lamp or from inside it. The haze dims it (uFog: the scene fog's density) instead of colouring it: it is
// additive, and three's fog would paint the whole cone the colour of the haze.
function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(FLOOD_COLOR) }, uOpacity: { value: 0.16 }, uFog: { value: 0 }, uPs1: G.uPs1 },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vView;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vAlong = uv.y;
        vec3 transformed = position;
        #include <project_vertex>
        vN = normalMatrix * normal;
        vView = -mvPosition.xyz;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uFog;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float L = length(vView);
        float rim = abs(dot(normalize(vN), vView / max(L, 1e-4)));
        // (clamped: at the open end the interpolated v dips a hair below 0, and pow of that is not a number)
        float a = uOpacity * pow(clamp(vAlong, 0.0, 1.0), 1.7) * rim * rim * exp(-uFog * uFog * L * L);
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export class PowerViews {
  constructor(game) {
    this.g = game;
    this.gens = []; // generator entities in view
    this.floods = []; // floodlight entities in view
    this.lit = []; // this frame's lit floodlights, nearest first
    this.held = 0; // the generator [E] is down on
    this.heldT = 0;
    this.planning = false; // the hammer is out with a generator or a floodlight picked: the reach rings show
    this.eyeLit = 0; // 0..1: the eye stands in a lit floodlight's cone (the hands in view are lit by it)
    const scene = game.scene;
    this.spots = [];
    for (let i = 0; i < FLOOD_SPOTS; i++) {
      const s = new THREE.SpotLight(FLOOD_COLOR, 0, SPOT_DISTANCE, SPOT_ANGLE, SPOT_PENUMBRA, SPOT_DECAY);
      scene.add(s);
      scene.add(s.target);
      this.spots.push(s);
    }
    // the lamp's glass, its glow and its beam: one geometry and one material each, shared by every floodlight
    this.lensGeo = new THREE.PlaneGeometry(FLOOD_LENS.w, FLOOD_LENS.h).rotateY(Math.PI); // (facing -Z, the front)
    this.lensOn = new THREE.MeshBasicMaterial({ color: FLOOD_COLOR, fog: false });
    this.lensOn.color.multiplyScalar(3.4); // (over white: it blooms)
    this.lensOff = new THREE.MeshBasicMaterial({ color: 0x0b0d10 });
    let glowTex = null;
    try {
      glowTex = getTexture('fx_glow');
    } catch {
      glowTex = null;
    }
    // (no fog on the glow either, for the same reason as the beam: update() shrinks it with the haze instead)
    this.glowMat = new THREE.SpriteMaterial({ map: glowTex, color: FLOOD_COLOR, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const beam = new THREE.ConeGeometry(Math.tan(BEAM_HALF) * BEAM_LEN, BEAM_LEN, 24, 1, true);
    beam.translate(0, -BEAM_LEN / 2, 0);
    beam.rotateX(Math.PI / 2); // tip at the origin, opening along -Z
    this.beamGeo = beam;
    this.beamMat = beamMaterial();
  }

  // one of everything here that is drawn with a material of its own, for Game.warmViews
  warm() {
    const glow = new THREE.Sprite(this.glowMat);
    return [new THREE.Mesh(this.lensGeo, this.lensOn), new THREE.Mesh(this.lensGeo, this.lensOff), glow, new THREE.Mesh(this.beamGeo, this.beamMat)];
  }

  // ---------------------------------------------------------------- views (Entities.onCreate, a structure's)
  add(e, v) {
    const g = this.g;
    if (e.stype === STRUCT.GENERATOR) {
      const yaw = v.rotation.y;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      // the end of the exhaust and the way it points, in the world
      e.exX = e.rx + GEN_EXHAUST.x * c + GEN_EXHAUST.z * s;
      e.exY = e.ry + GEN_EXHAUST.y;
      e.exZ = e.rz - GEN_EXHAUST.x * s + GEN_EXHAUST.z * c;
      e.exDx = c;
      e.exDz = -s;
      e.run = false;
      e.puffT = 0;
      e.loop = g.audio.createLoop?.('genset', e.rx, e.ry + 0.5, e.rz);
      e.loop?.setVolume?.(0);
      const reach = powerReachRing();
      reach.visible = this.planning;
      v.add(reach);
      v.userData.reach = reach;
      this.gens.push(e);
    } else if (e.stype === STRUCT.FLOODLIGHT) {
      const lens = new THREE.Mesh(this.lensGeo, this.lensOff);
      lens.position.set(0, FLOOD_LENS_UP, -FLOOD_LENS_FWD - 0.004);
      lens.rotation.x = FLOOD_PITCH;
      const glow = new THREE.Sprite(this.glowMat);
      glow.position.set(0, FLOOD_LENS_UP, -FLOOD_LENS_FWD - 0.06);
      glow.scale.setScalar(1.5);
      glow.renderOrder = 6;
      const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
      beam.position.copy(lens.position);
      beam.rotation.x = FLOOD_PITCH;
      beam.renderOrder = 6;
      glow.visible = beam.visible = false;
      v.add(lens, glow, beam);
      e.lens = lens;
      e.glow = glow;
      e.beam = beam;
      e.aim = floodAim(e.rx, e.ry, e.rz, e.rot8, {});
      e.lit = undefined; // (not known yet: the first look at its state makes no sound)
      e.warm = 0;
      e.d2 = 0;
      this.floods.push(e);
    }
  }

  // ---------------------------------------------------------------- per frame
  // night: 0 by day .. 1 in the dark (or down the mine)
  update(dt, time, camPos, night) {
    const g = this.g;
    // generators: the drone, the shake, the exhaust
    const gens = this.gens;
    for (let i = gens.length - 1; i >= 0; i--) {
      const e = gens[i];
      if (!e.obj) {
        gens[i] = gens[gens.length - 1];
        gens.pop();
        continue;
      }
      const run = genRunning(e.q[4]);
      if (run !== e.run) {
        e.run = run;
        e.loop?.setVolume?.(run ? 1 : 0);
        if (!run) {
          e.obj.position.set(e.rx, e.ry, e.rz);
          e.obj.rotation.z = 0;
        }
      }
      if (!run) continue;
      if (!(e.shakeT > 0)) e.obj.position.set(e.rx + Math.sin(time * 173 + e.id) * 0.003, e.ry + Math.abs(Math.sin(time * 94 + e.id)) * 0.004, e.rz + Math.sin(time * 151 + e.id * 2) * 0.003);
      e.obj.rotation.z = Math.sin(time * 61 + e.id) * 0.005;
      e.puffT -= dt;
      if (e.puffT <= 0) {
        e.puffT = 0.06 + Math.random() * 0.05;
        const dx = e.rx - camPos.x;
        const dz = e.rz - camPos.z;
        // a grey puff out of the muffler, thinning as it rises
        if (dx * dx + dz * dz < 70 * 70) g.effects?.alpha.emit(e.exX, e.exY, e.exZ, e.exDx * 1.1 + (Math.random() - 0.5) * 0.3, 0.35 + Math.random() * 0.4, e.exDz * 1.1 + (Math.random() - 0.5) * 0.3, 1.1 + Math.random() * 0.6, 0.1, 0.75, 0.2, 0.2, 0.2, 0.34, 0.3, 0.3, 0.3, 0, -0.25, 0.9, TEX.SMOKE, 0.4);
      }
    }
    // floodlights: the lamp follows its state; the lit ones are sorted for the light pool
    const floods = this.floods;
    const lit = this.lit;
    lit.length = 0;
    const haze = g.scene.fog?.density || 0;
    this.beamMat.uniforms.uFog.value = haze;
    for (let i = floods.length - 1; i >= 0; i--) {
      const e = floods[i];
      if (!e.obj) {
        floods[i] = floods[floods.length - 1];
        floods.pop();
        continue;
      }
      const on = e.q[4] === 1;
      if (on !== e.lit) {
        if (e.lit !== undefined) g.audio.play(SOUND.FLOOD_SWITCH, { x: e.aim.x, y: e.aim.y, z: e.aim.z });
        e.lit = on;
        e.lens.material = on ? this.lensOn : this.lensOff;
        e.glow.visible = e.beam.visible = on;
        if (!on) e.warm = 0;
      }
      if (!on) continue;
      e.warm = Math.min(1, e.warm + dt * 6); // the lamp comes up over a moment
      const a = e.aim;
      const dx = a.x - camPos.x;
      const dy = a.y - camPos.y;
      const dz = a.z - camPos.z;
      e.d2 = dx * dx + dz * dz;
      // the glare is for an eye the lamp is turned towards: from the side it shrinks, from behind there is none.
      // The haze takes it too, as it takes the beam
      const dist = Math.sqrt(e.d2 + dy * dy) || 1;
      const front = Math.min(1, Math.max(0, 0.25 - ((dx * a.dx + dy * a.dy + dz * a.dz) / dist) * 1.5)) * Math.exp(-haze * haze * dist * dist);
      e.glow.visible = front > 0.02;
      e.glow.scale.setScalar((1.2 + 0.5 * night) * e.warm * front);
      if (e.d2 < SPOT_REACH * SPOT_REACH) lit.push(e);
    }
    if (lit.length > 1) lit.sort(byDistance);
    // how much floodlight falls on the eye itself (the hands in view take it): in the cone of one of the lit ones
    this.eyeLit = 0;
    for (let i = 0; i < lit.length && i < FLOOD_SPOTS; i++) if (inFloodCone(lit[i].aim, camPos.x, camPos.y, camPos.z)) this.eyeLit = Math.max(this.eyeLit, 0.7 * lit[i].warm * night);
    const power = FLOOD_POWER * (FLOOD_DAY + (1 - FLOOD_DAY) * night);
    for (let i = 0; i < this.spots.length; i++) {
      const L = this.spots[i];
      const e = lit[i];
      if (!e) {
        L.intensity = 0;
        continue;
      }
      const a = e.aim;
      L.position.set(a.x, a.y, a.z);
      L.target.position.set(a.x + a.dx * 10, a.y + a.dy * 10, a.z + a.dz * 10);
      L.intensity = power * e.warm;
    }
    // the switch: [E] still down on the same generator after GEN_HOLD
    if (this.held) {
      const t = g.lookTarget;
      if (!t || t.id !== this.held) this.held = 0; // looked away: nothing happens
      else if ((this.heldT += dt) >= GEN_HOLD) {
        g.conn.action(ACT.GEN_SWITCH, this.held);
        this.held = 0;
      }
    }
    // with the hammer out and one of the two picked (or pointed at in the ring), every generator shows how far its power reaches
    const s = g.prediction.state;
    const type = g.buildMenu ? g.buildMenu.hover : g.buildPicked ? g.buildType : 0;
    const planning = s.slot === SLOT_BUILD && !s.zombie && (type === STRUCT.GENERATOR || type === STRUCT.FLOODLIGHT);
    if (planning !== this.planning) {
      this.planning = planning;
      for (const e of gens) if (e.obj) e.obj.userData.reach.visible = planning;
    }
  }

  // ---------------------------------------------------------------- [E] on a generator
  // With the hammer out a damaged generator is mended like any other structure (Power.interact on the server).
  mending(e, slot) {
    return slot === SLOT_BUILD && e.q[3] / 255 < 0.99;
  }

  // [E] goes down on a structure: true when it is a generator's key (nothing is sent yet: a tap pours on release)
  press(e) {
    if (e.stype !== STRUCT.GENERATOR || this.mending(e, this.g.prediction.state.slot)) return false;
    this.held = e.id;
    this.heldT = 0;
    return true;
  }

  // [E] comes up before the switch went: a tap, which pours fuel in
  release() {
    if (!this.held) return;
    this.g.conn.action(ACT.INTERACT, this.held);
    this.held = 0;
  }

  // the switch's progress ring (Game.updateHud)
  hud(h) {
    if (!this.held || this.heldT < TAP_SHOWN) return;
    const e = this.g.entities.ents.get(this.held);
    h.useProgress = Math.min(1, (this.heldT - TAP_SHOWN) / (GEN_HOLD - TAP_SHOWN));
    h.useLabel = e && genOn(e.q[4]) ? 'Switching off…' : 'Switching on…';
  }

  // What the prompt says of a generator or a floodlight (null: not one of ours, or one to be mended with the hammer).
  // counts: the backpack by item. building: the hammer is out.
  prompt(e, counts, building) {
    if (e.stype !== STRUCT.GENERATOR && e.stype !== STRUCT.FLOODLIGHT) return null;
    if (this.mending(e, building ? SLOT_BUILD : -1)) return null;
    let text;
    if (e.stype === STRUCT.FLOODLIGHT) text = e.q[4] === 1 ? 'Floodlight · powered' : `Floodlight · no power: it needs a running generator within ${GEN_RANGE} m`;
    else {
      const st = e.q[4];
      const on = genOn(st);
      const fuel = genFuel(st);
      const have = counts[ITEM.AMMO_FUEL] || 0;
      const pour = genPour(have, fuel);
      const tank = fuel <= 0 ? 'tank empty' : `${mmss(fuel)} of fuel`;
      const state = !on ? 'Generator off' : fuel > 0 ? 'Generator running' : 'Generator out of fuel';
      const sw = `switch ${on ? 'off' : 'on'}`;
      if (pour > 0) text = `${bindTag('interact')} Pour in fuel (${pour} of ${have}) · hold to ${sw} · ${state}, ${tank}`;
      else if (fuel > 0 || !on) text = `${bindTag('interact')} Hold to ${sw} · ${state}, ${tank}${have && fuel >= GEN_TANK - 5 ? ' (full)' : ''}${fuel <= 0 ? ': it burns Flamethrower Fuel' : ''}`;
      else text = `${state} · it burns Flamethrower Fuel`;
    }
    return building ? `${text} · ${bindTag('demolish')} Remove` : text;
  }
}
