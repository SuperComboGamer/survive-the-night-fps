// WEAPON SYSTEM (docs/API.md §8). Seven guns with real specs (specs.js), first-person view-model (viewmodel.js) with animated
// hands, per-gun recoil/flash/casings/sounds, knife (V) and frag grenades (G, max 4).
//   const ws = new WeaponSystem({ gfx, fx, audio, world, player, input, combat }); ws.give('m1911'); ... ws.update(dt, time)
// Surface used by the game: current {id, def, mag, reserve}, slots[], grenades, spread, WEAPONS, give/has/swap/reload/refillAll/
// addAmmo/maxAmmo/setPerks, events onShot/onReload/onEmpty/onSwap (assign callbacks).
import * as THREE from 'three';
import { WEAPONS, WEAPON_IDS, GRENADE, KNIFE } from './specs.js';
import { gunMats } from './materials.js';
import { ViewModel } from './viewmodel.js';
import { MODELS, PROPS } from './models/index.js';
import { CasingSystem } from './casings.js';
import { Grenades } from './grenade.js';
import { registerSounds, warmSounds } from './sounds.js';
import { GENERIC_CLIPS } from './models/props.js';
import { modelData, GunRig } from './rig.js';
import { gfx as GFX } from '../../core/gfx.js';
export { WEAPONS } from './specs.js';
export { getOutline, getIcon } from './outline.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const GUN_TRIM = 0.708; // -3 dB on everything we play on the weapon bus (audio mix: gun bursts sat ~3 dB hot, -13 LUFS short-term)
const WALL_HIT = { t: 0, nx: 0, ny: 0, nz: 0, surface: '' };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const jit = () => 0.85 + Math.random() * 0.3; // per-shot variation
const NOOPT = {}, SPARK_C = [1, 0.8, 0.45], SPARK_SG = [1, 0.75, 0.35], RAY_SPARK = [0.35, 1, 0.45];

export class WeaponSystem {
  constructor({ gfx, fx, audio, world, player, input, combat }) {
    Object.assign(this, { gfx, fx, audio, world, player, input, combat });
    this.WEAPONS = WEAPONS; this.mats = gunMats(gfx.renderer, world?.synth); this.mats.util(); this.mats.deferred = true; // real texture bakes after the async program compile
    const t0 = performance.now(); const T = this.timing = {};
    this.vm = new ViewModel(gfx, this.mats, MODELS, WEAPONS, { props: PROPS, timing: T }); T.vm = performance.now() - t0;
    this.casings = new CasingSystem(gfx.scene, { audio }); this.casings.setWorld(world); T.casings = performance.now() - t0 - T.vm;
    this.grenadeSys = new Grenades(gfx.scene, this.mats, { fx, audio, combat, world }); T.grenades = performance.now() - t0 - T.vm - T.casings;
    this.buildMs = performance.now() - t0; T.synthBake = this.mats.bakeMs || 0;
    this.ready = this.mats.warm().then(() => this.mats.bakePending(3)).then(() => { this.timing.texturesReady = performance.now() - t0; });
    // remaining guns: one per ~80 ms slot right away, i.e. while boot waits on world.warm()'s parallel shader compile (loading screen),
    // not in gameplay (each is a 50-400 ms main-thread task); a gun given/prebuilt earlier is built on demand
    const bg = () => { if (this.vm.buildNext()) this._bgT = setTimeout(bg, 80); else this.timing.all = performance.now() - t0; }; this._bgT = setTimeout(bg, 100);
    // state
    this.slots = []; this.cur = 0; this.ammo = {}; for (const id of WEAPON_IDS) this.ammo[id] = { id, def: WEAPONS[id], name: WEAPONS[id].name, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, chambered: true, barrels: [1, 1] };
    this.grenades = 2; this.perks = { speedCola: false, doubleTap: false, juggernog: false }; this.spread = 0.02;
    this.state = 'none'; this.stateT = 0; this.cool = 0; this.pending = 0; this.adsK = 0; this.sprintK = 0; this.wallK = 0; this.heat = 0; this.smokeT = 0; this.shotIdx = 0; this.lastShot = -9; this.bloom = 0; this.drift = 0;
    this.queue = null; this.autoReloadT = -1; this.meleeHit = false; this.enabled = true; this.frozenPose = null; this.time = 0;
    this.onShot = null; this.onReload = null; this.onEmpty = null; this.onSwap = null;
    this._shot = { origin: new THREE.Vector3(), dir: new THREE.Vector3(), damage: 0, range: 0, pellets: 1, spread: 0, weaponId: '', tracer: null, muzzle: new THREE.Vector3(), isShotgun: false, caliber: 1, headshotMul: 2, falloff: null, explosive: null, impulse: 3 };
    this._meleeSpec = { origin: new THREE.Vector3(), dir: new THREE.Vector3(), range: KNIFE.range, damage: KNIFE.damage }; // (not `_melee`: that is the method)
    this._evt = (type, arg, ev) => this._onClipEvent(type, arg, ev);
    this._snd = {}; // cached sound names [id][event]
    // preallocated option objects (update / fire paths are allocation-free on our side)
    this._po = { pos: null, vol: 1, bus: 'weapon' }; this._vmCtx = { player: null, input: null, sens: 1 };
    this._pumpO = { speed: 1, onEvent: this._evt, onEnd: () => { if (this.state === 'pump') this.state = 'idle'; } }; // cycle stays rpm-limited (870: 75 rpm = 0.8 s)
    this._smokeO = { speed: 0.08, size: [0.008, 0.05], life: 1.1, color: [0.72, 0.72, 0.72, 0.05], rise: 0.28, drag: 1.4, spread: 0.035, cell: 1 };
    this._puffO = { size: [0.02, 0.2], life: 1.0, color: [0.62, 0.62, 0.62, 0.1], speed: 1.6, cell: 1, rise: 0.35, drag: 2.8, spread: 0.2 };
    registerSounds(audio);
    this._warmed = false;
  }

  // ------------------------------------------------------------------ public surface
  get current() { const id = this.slots[this.cur]; return id ? this.ammo[id] : null; }
  get currentId() { return this.slots[this.cur] || null; }
  has(id) { return this.slots.includes(id); }
  /** build a gun's view-model ahead of time (e.g. when the mystery box starts rolling or the player nears a wall buy) */
  prebuild(id) { if (WEAPONS[id] && this.vm.models[id]) this.vm._build(id); }
  give(id) {
    if (!WEAPONS[id]) return; const a = this.ammo[id]; a.mag = WEAPONS[id].mag + (WEAPONS[id].chamber && id !== 'olympia' ? 0 : 0); a.reserve = WEAPONS[id].reserve; a.chambered = true; a.barrels[0] = a.barrels[1] = 1;
    if (this.has(id)) { this._switchTo(this.slots.indexOf(id), true); return; }
    if (this.slots.length < 2) { this.slots.push(id); this._switchTo(this.slots.length - 1, true); } else { this.slots[this.cur] = id; this._switchTo(this.cur, true, true); }
  }
  swap() { if (this.slots.length > 1) this._requestSwap((this.cur + 1) % this.slots.length); }
  reload() { this._tryReload(); }
  refillAll() { for (const id of this.slots) { const a = this.ammo[id]; a.reserve = WEAPONS[id].reserve; } this.grenades = GRENADE.max; }
  addAmmo(id = this.currentId, n = null) { const a = this.ammo[id]; if (!a) return; a.reserve = n == null ? WEAPONS[id].reserve : Math.min(WEAPONS[id].reserve, a.reserve + n); }
  maxAmmo(id) { return id ? WEAPONS[id].reserve : this.refillAll(); }
  setPerks(p = {}) { this.perks.speedCola = !!p.speedCola; this.perks.doubleTap = !!p.doubleTap; this.perks.juggernog = !!p.juggernog; }
  /** FOV multiplier for the world camera while aiming (per-gun optical zoom, eased like the view-model): gfx.setFov(player.fov * weapons.fovMul) */
  get fovMul() { const id = this.currentId; const z = id ? WEAPONS[id].zoom || 1.15 : 1; let k = this.adsK; k = k * k * k * (k * (k * 6 - 15) + 10); return 1 / (1 + (z - 1) * k); }
  get reloadMul() { return this.perks.speedCola ? 2 : 1; }
  get rateMul() { return this.perks.doubleTap ? 1.33 : 1; }

  // ------------------------------------------------------------------ switching
  _switchTo(i, fresh = false, replaced = false) {
    const id = this.slots[i]; if (!id) return; const prevId = this.currentId;
    const doDraw = () => { this.cur = i; this.vm.setGun(id); this._syncState(); this.state = 'draw'; const clip = fresh && this.vm.has('firstDraw') ? 'firstDraw' : 'draw'; this.vm.play(clip, { speed: 1, onEvent: this._evt, onEnd: () => { if (this.state === 'draw') this.state = 'idle'; } }); this._play(id, 'draw'); this.onSwap?.(id); };
    if (prevId && prevId !== id && this.state !== 'none' && this.vm.cur && !replaced) { this.state = 'holster'; this.vm.play('holster', { onEnd: doDraw }); }
    else doDraw();
  }
  _requestSwap(i) { if (i === this.cur || this.state === 'grenade' || this.state === 'melee' || this.state === 'holster') return; this._switchTo(i); }
  _syncState() { const id = this.currentId; if (!id) return; const a = this.ammo[id], st = this.vm.st; st.id = id; st.mag = a.mag; st.empty = a.mag <= 0; st.locked = a.mag <= 0 && (id === 'm1911' || id === 'm14'); st.barrels = a.barrels; st.hammer = 1; st.open = false; st.reserve = a.reserve; }

  // ------------------------------------------------------------------ frame
  update(dt, time) {
    this.time = time; if (!this._warmed && this.audio?.ready) this._warmed = warmSounds(this.audio, 2);
    const pl = this.player, inp = this.input, id = this.currentId; const spec = id ? WEAPONS[id] : null; const a = id ? this.ammo[id] : null;
    const alive = pl ? pl.alive !== false : true; const can = this.enabled && alive && !!spec;
    this.stateT += dt; this.cool -= dt; this.pending = Math.max(0, this.pending - dt);
    // ---- swap input
    if (can && inp) { if (inp.pressed('Digit1')) this._requestSwap(0); else if (inp.pressed('Digit2') && this.slots.length > 1) this._requestSwap(1); else if (inp.wheel && this.slots.length > 1) this._requestSwap((this.cur + 1) % this.slots.length); }
    const busy = this.state !== 'idle' && this.state !== 'fire';
    // ---- sprint / ADS / wall
    const sprinting = !!(pl && pl.sprinting) && this.state !== 'reload';
    this.sprintK = clamp(this.sprintK + (sprinting ? dt / 0.22 : -dt / (spec?.sprintOut || 0.18)), 0, 1);
    const wantAds = can && inp && inp.mouse(2) && !sprinting && (this.state === 'idle' || this.state === 'fire' || this.state === 'pump') && this.wallK < 0.5;
    this.adsK = clamp(this.adsK + (wantAds ? 1 : -1.25) * dt / (spec?.adsTime || 0.2), 0, 1); if (pl) pl.adsK = this.adsK;
    if (this.world && pl && pl.eye) { const f = pl.forward; const hit = this.world.raycast(pl.eye.x, pl.eye.y, pl.eye.z, f.x, f.y, f.z, 0.9, WALL_HIT); const target = hit ? clamp((0.8 - WALL_HIT.t) / 0.45, 0, 1) : 0; this.wallK += (target - this.wallK) * Math.min(1, dt * 10); } else this.wallK = 0;
    // ---- actions
    if (can && inp) {
      if (inp.pressed('KeyG')) this._grenade();
      else if (inp.pressed('KeyV')) this._melee();
      else if (inp.pressed('KeyR')) this._tryReload();
      const trig = inp.mouse(0), trigPressed = inp.mousePressed(0);
      if (trigPressed) this.pending = 0.12;
      this._fireLogic(dt, spec, a, trig, trigPressed);
    }
    // trigger finger visual
    const trigHeld = can && inp && inp.mouse(0) && this.sprintK < 0.35 && (this.state === 'idle' || this.state === 'fire');
    this.vm.triggerK += ((trigHeld ? 1 : 0) - this.vm.triggerK) * Math.min(1, dt * 30);
    // auto reload shortly after running dry
    if (this.autoReloadT >= 0) { this.autoReloadT -= dt; if (this.autoReloadT < 0 && a && a.mag <= 0 && a.reserve > 0 && (this.state === 'idle' || this.state === 'fire')) this._tryReload(); }
    // spread (for the crosshair + shots)
    if (spec) { const sp = spec.spread; const mv = pl ? clamp((pl.moveSpeed || 0) / 4, 0, 1.5) : 0; const air = pl && !pl.onGround ? 1 : 0; this.bloom = Math.max(0, this.bloom - dt * (sp.bloomMax ? sp.bloomMax * 3 : 0.1)); this.spread = sp.hip + (sp.ads - sp.hip) * this.adsK + sp.move * mv * (1 - this.adsK * 0.6) + sp.air * air + this.bloom; }
    // ---- heat / barrel smoke
    this.heat = Math.max(0, this.heat - dt * 0.55);
    if (this.heat > 2.5 && time - this.lastShot > 0.25 && spec && spec.casing !== null) { this.smokeT -= dt; if (this.smokeT <= 0) { this.smokeT = 0.1 + Math.random() * 0.08; this._muzzleWorld(_v); const o = this._smokeO; o.size[1] = 0.05 + this.heat * 0.006; o.color[3] = Math.min(0.07, 0.012 * this.heat); this.fx.puff(_v, _up, 1, o); } }
    // ---- view-model
    const vm = this.vm; vm.adsK = this.adsK; vm.sprintK = this.state === 'reload' || this.state === 'melee' || this.state === 'grenade' ? Math.min(vm.sprintK, this.sprintK) * 0.4 : this.sprintK; vm.wallK = this.wallK;
    if (this.state === 'grenade') vm.lowerK = Math.min(1, vm.lowerK + dt / 0.16); else vm.lowerK = Math.max(0, vm.lowerK - dt / 0.28);
    if (vm.cur) vm.cur.rig.group.visible = vm.lowerK < 0.97 && !vm.hideGun;
    if (this.frozenPose) { const f = this.frozenPose; vm.act.clip = f.clip; vm.act.t = f.t; vm.act.done = false; vm.act.speed = 0; vm.act.onEvent = null; }
    const vc = this._vmCtx; vc.player = pl; vc.input = inp; vc.sens = inp?.sens || 1; vm.update(dt, vc);
    this.casings.update(dt); this.grenadeSys.update(dt, time);
    // ray gun plasma charge (drops on each shot, recharges; flickers when empty)
    this.charge = Math.min(1, (this.charge ?? 1) + dt * 1.6); if (this.mats.plasmaU) { const empty = id === 'raygun' && a && a.mag <= 0; this.mats.plasmaU.value = empty ? 0.12 + 0.08 * Math.random() : 0.35 + 0.85 * this.charge; }
  }

  // ------------------------------------------------------------------ firing
  _fireLogic(dt, spec, a, trig, trigPressed) {
    if (!spec || !a) return; const st = this.state;
    if (st !== 'idle' && st !== 'fire') { // shotgun reload can be interrupted by firing
      if (st === 'reload' && spec.mode === 'pump' && this.pending > 0 && a.mag > 0) { this.reloadInterrupt = true; }
      return;
    }
    if (this.sprintK > 0.3 || this.wallK > 0.6 || this.cool > 0) return;
    const auto = spec.mode === 'auto'; const want = auto ? trig : this.pending > 0;
    if (!want) { if (st === 'fire' && this.cool <= 0) this.state = 'idle'; return; }
    this.pending = 0;
    if (a.mag <= 0) { if (trigPressed || (auto && this.stateT > 0.35)) { this._play(spec.id, 'dry'); this.stateT = 0; this.cool = 0.25; this.vm.play('dry', NOOPT); this.onEmpty?.(spec.id); if (a.reserve > 0) this.autoReloadT = 0.2; } return; }
    this._shoot(spec, a);
  }
  _shoot(spec, a) {
    const pl = this.player, id = spec.id, vm = this.vm; this.state = 'fire'; this.stateT = 0;
    // cycle time; the overshoot of the previous frame is carried so the rate is exact at any frame rate (not quantised to frames)
    const semiInt = spec.triggerRate ? 1 / spec.triggerRate : 0, iv = Math.max(60 / spec.rpm, semiInt) / this.rateMul; this.cool = (this.cool < 0 && this.cool > -iv * 0.5 ? this.cool : 0) + iv;
    a.mag--; this.vm.st.mag = a.mag; this.shotIdx = this.time - this.lastShot > 0.35 ? 0 : this.shotIdx + 1; this.lastShot = this.time;
    // --- ballistics
    const S = this._shot; S.origin.copy(pl.eye); S.dir.copy(pl.forward); S.damage = spec.damage; S.range = spec.range; S.pellets = spec.pellets; S.spread = this.spread; S.weaponId = id; S.tracer = spec.tracer; S.isShotgun = spec.pellets > 1; S.caliber = spec.cal; S.headshotMul = spec.headshotMul; S.falloff = spec.falloff; S.explosive = null; /* splash handled here: detonates when the bolt arrives (see _rayImpact) */ S.impulse = spec.pellets > 1 ? 5 : 2 + spec.cal * 1.5;
    this._muzzleWorld(S.muzzle);
    const res = this.combat?.shoot(S);
    if (spec.explosive && res && res.hits > 0 && res.point) this._scheduleImpact(res.point, S.muzzle, spec); // plasma bolt: splash when it arrives (tracer speed)
    if (spec.spread.bloom) this.bloom = Math.min(spec.spread.bloomMax, this.bloom + spec.spread.bloom);
    // --- recoil: camera kick (springs back) + persistent climb + view-model springs
    const r = spec.recoil, adsM = 1 - this.adsK * 0.3, j = jit;
    this.drift = this.drift * 0.82 + (Math.random() - 0.5) * 0.9 + (spec.mode === 'auto' ? Math.sin(this.shotIdx * 0.45 + (id === 'ak74u' ? 0.6 : 2.0)) * 0.45 : 0);
    pl.addKick?.(r.camKick[0] * j() * adsM, r.camKick[1] * (Math.random() - 0.5) * 2 * adsM, r.camKick[2] * (Math.random() - 0.5) * 2 * adsM);
    const climbRamp = spec.mode === 'auto' ? Math.min(1, 0.55 + this.shotIdx * 0.08) : 1; pl.addAim?.(r.climb[0] * climbRamp * j() * adsM, -r.climb[1] * this.drift * adsM);
    vm.kick(spec, this.adsK);
    // --- view-model mechanism + effects
    const last = a.mag <= 0 && (id === 'm1911' || id === 'm14');
    if (id === 'olympia') { const b = a.barrels[0] ? 0 : 1; a.barrels[b] = 0; vm.st.fired = b; vm.fire(b === 0 ? 'fireR' : 'fireL', 1, this._evt); }
    else vm.fire(last && vm.has('fireLast') ? 'fireLast' : 'fire', this.rateMul, this._evt); // its 'eject' event spawns the casing
    if (last) vm.st.locked = true;
    vm.st.empty = a.mag <= 0;
    const f = spec.flash; this._muzzleWorld(_v, true); _v2.copy(pl.forward).multiplyScalar(0.12); this.fx.pulseLight(_v.add(_v2), f.color, f.light * (0.85 + Math.random() * 0.3), 0.055, 9);
    this._muzzleWorld(_v); this._blast(_v, pl.forward, spec);
    if (spec.pellets > 1) this.fx.spark(_v, pl.forward, 10, 14, 0.012, SPARK_SG, 0.25);
    this.heat += spec.pellets > 1 ? 2.2 : spec.cal;
    if (spec.casing && vm.cur && !vm.cur.ejectInClip && id !== 'remington870' && id !== 'olympia') this._eject(spec);
    this._play(id, 'fire', null, 1); this.onShot?.(id); if (id === 'raygun') this.charge = 0.1;
    if (a.mag <= 0) { this.onEmpty?.(id); if (a.reserve > 0) this.autoReloadT = 0.32; }
    // pump action for the 870
    if (spec.mode === 'pump') { this.state = 'pump'; this._pumpO.speed = this.rateMul; vm.play('pump', this._pumpO); }
    return res;
  }
  /** Ray Gun bolt: schedule the splash at the time the 220 m/s bolt reaches the hit point (pooled records, no per-shot closures) */
  _scheduleImpact(point, from, spec) {
    const P = this._imp || (this._imp = []); let r = null; for (let i = 0; i < P.length; i++) if (!P[i].busy) { r = P[i]; break; }
    if (!r) { r = { busy: false, p: new THREE.Vector3(), spec: null, fn: null }; r.fn = () => { r.busy = false; this._rayImpact(r.p, r.spec); }; P.push(r); }
    r.busy = true; r.p.copy(point); r.spec = spec; const d = from ? from.distanceTo(point) : 0; const delay = d / (spec.tracer?.speed || spec.velocity || 220);
    if (this.fx?.schedule) this.fx.schedule(delay, r.fn); else r.fn();
  }
  /** green plasma detonation (own particles + light + sound) and splash damage; no generic orange fireball */
  _rayImpact(p, spec) {
    const fx = this.fx, t = fx?.time || 0, ex = spec.explosive; if (fx?.add) {
      const o = this._pb || (this._pb = { p: null, v: [0, 0, 0], life: 0.3, size: [0.2, 1.3], c0: [1.2, 4.5, 1.6, 1], c1: [0.1, 1.4, 0.3, 0], cell: 8, drag: 4, rot: 0, rotVel: 0 });
      o.p = p; o.v[0] = o.v[1] = o.v[2] = 0; o.life = 0.42; o.size[0] = 0.3; o.size[1] = 2.1; o.c0[0] = 1.2; o.c0[1] = 4.5; o.c0[2] = 1.6; o.c1[0] = 0.1; o.c1[1] = 1.4; o.c1[2] = 0.3; o.rotVel = 0; fx.add.emit(o, t); // core flash
      for (let i = 0; i < 7; i++) { const a = Math.random() * 6.283, e = (Math.random() - 0.3) * 1.2, sp = 1.2 + Math.random() * 1.6; o.v[0] = Math.cos(a) * Math.cos(e) * sp; o.v[1] = Math.sin(e) * sp + 0.6; o.v[2] = Math.sin(a) * Math.cos(e) * sp; o.life = 0.5 + Math.random() * 0.3; o.size[0] = 0.14; o.size[1] = 0.85; o.c0[0] = 0.5; o.c0[1] = 2.6; o.c0[2] = 0.9; o.c1[0] = 0.05; o.c1[1] = 0.6; o.c1[2] = 0.15; o.rotVel = (Math.random() - 0.5) * 3; fx.add.emit(o, t); } // plasma lobes
      fx.spark?.(p, _up, 26, 7, 0.018, RAY_SPARK, 0.55);
      const so = this._ps || (this._ps = { size: [0.1, 0.9], life: 1.4, color: [0.2, 0.32, 0.24, 0.22], speed: 0.8, cell: 1, rise: 0.6, drag: 2.2, spread: 0.6 }); fx.puff?.(p, _up, 3, so);
      fx.pulseLight?.(p, 0x60ff78, 420, 0.2, 12); fx.addShake?.(0.04);
    }
    if (this.audio?.ready) { const po = this._po; po.pos = p; po.vol = GUN_TRIM; this.audio.play('gun.raygun.impact', po); }
    const c = this.combat; if (!ex || !c) return; const src = this._raySrc || (this._raySrc = { source: 'raygun', weaponId: 'raygun' });
    if (c.zombies?.explode) c.zombies.explode(p, ex.radius, ex.damage, src); else if (c.explode) c.explode(p, ex.radius, ex.damage, src);
  }
  /** world-space muzzle particles: brief fire blob, a little smoke, sparks (shotguns: more, and burning powder flecks) */
  _blast(p, dir, spec) {
    const fx = this.fx, t = fx.time, big = spec.pellets > 1 ? 1 : spec.cal > 1.1 ? 0.7 : 0.45, ray = spec.class === 'wonder';
    const o = this._bo || (this._bo = { p: null, v: [0, 0, 0], life: 0.06, size: [0.1, 0.3], c0: [3, 2, 1, 1], c1: [2, 0.8, 0.2, 0], cell: 8, drag: 8 });
    o.p = p; o.v[0] = dir.x * 3; o.v[1] = dir.y * 3; o.v[2] = dir.z * 3; o.size[0] = 0.05 * big; o.size[1] = 0.22 * big; o.life = 0.05;
    if (ray) { o.c0[0] = 0.5; o.c0[1] = 3; o.c0[2] = 0.8; o.c1[0] = 0.1; o.c1[1] = 1.2; o.c1[2] = 0.2; } else { o.c0[0] = 3; o.c0[1] = 2; o.c0[2] = 1; o.c1[0] = 2; o.c1[1] = 0.8; o.c1[2] = 0.2; }
    fx.add.emit(o, t);
    if (!ray) { const po = this._puffO; po.size[0] = 0.02 * big; po.size[1] = 0.2 * big; po.color[3] = 0.1 + 0.06 * big; fx.puff(p, dir, spec.pellets > 1 ? 3 : 1, po); }
    fx.spark(p, dir, spec.pellets > 1 ? 9 : 3, 10, 0.01, SPARK_C, 0.2);
  }
  _eject(spec) {
    const vm = this.vm; if (!vm.socketCam('eject', _m)) return; _v.setFromMatrixPosition(_m); this.gfx.camera.updateMatrixWorld(); vm.camToWorld(_v, _v3);
    const d = spec.ejectDir; _v2.set(d[0], d[1], d[2]); _q.setFromRotationMatrix(vm.holder.matrix); _v2.applyQuaternion(_q).applyQuaternion(this.gfx.camera.quaternion).normalize();
    const sp = spec.ejectSpeed[0] + Math.random() * (spec.ejectSpeed[1] - spec.ejectSpeed[0]); _v2.multiplyScalar(sp); if (this.player?.vel) _v2.add(this.player.vel);
    _q2.copy(this.gfx.camera.quaternion).multiply(_q); _s.set((Math.random() - 0.5) * 30, 20 + Math.random() * 25, (Math.random() - 0.5) * 12).applyQuaternion(_q2);
    this.casings.spawn(spec.casing, _v3, _v2, _q2, _s);
  }
  /** muzzle position in world space; screen-consistent (true = false) or physical (for lights) */
  _muzzleWorld(out, physical = false) { const vm = this.vm; if (!vm.socketCam('muzzle', _m)) return out.copy(this.player?.eye || out); _v3.setFromMatrixPosition(_m); return physical ? vm.camToWorldTrue(_v3, out) : vm.camToWorld(_v3, out); }

  // ------------------------------------------------------------------ reload
  _tryReload() {
    const id = this.currentId; if (!id) return; const spec = WEAPONS[id], a = this.ammo[id];
    if (!(this.state === 'idle' || this.state === 'fire') || a.reserve <= 0) return;
    const full = id === 'olympia' ? a.barrels[0] && a.barrels[1] : a.mag >= spec.mag + (spec.chamber && a.mag > 0 ? 1 : 0);
    if (full || (id !== 'olympia' && a.mag >= spec.mag && spec.mode === 'pump')) return;
    this.state = 'reload'; this.stateT = 0; this.adsK = Math.min(this.adsK, 0.6); this.onReload?.(id); this.reloadInterrupt = false;
    const vm = this.vm, sp = this.reloadMul;
    if (spec.mode === 'pump') { // shell by shell
      const wasEmpty = a.mag <= 0; vm.st.wasEmpty = wasEmpty;
      const loop = () => {
        if (this.reloadInterrupt || a.mag >= spec.mag || a.reserve <= 0) { vm.play(wasEmpty ? 'reloadEndPump' : 'reloadEnd', { speed: sp, onEvent: this._evt, onEnd: () => { if (wasEmpty) { vm.st.chambered = true; } this.state = 'idle'; } }); return; }
        vm.play('reloadShell', { speed: sp, onEvent: this._evt, onEnd: loop });
      };
      vm.play('reloadStart', { speed: sp, onEvent: this._evt, onEnd: loop }); return;
    }
    let clip = 'reload';
    if (id === 'olympia') clip = a.barrels[0] === 0 && a.barrels[1] === 0 ? 'reloadEmpty' : 'reload';
    else if (a.mag <= 0 && vm.has('reloadEmpty')) clip = 'reloadEmpty';
    vm.st.reloadClip = clip; vm.st.wasEmpty = a.mag <= 0;
    vm.play(clip, { speed: sp, onEvent: this._evt, onEnd: () => { this._finishReload(id); this.state = 'idle'; } });
  }
  _finishReload(id) {
    const spec = WEAPONS[id], a = this.ammo[id];
    if (id === 'olympia') { const need = (a.barrels[0] ? 0 : 1) + (a.barrels[1] ? 0 : 1); const take = Math.min(need, a.reserve); a.reserve -= take; if (!a.barrels[0] && take > 0) a.barrels[0] = 1; if (!a.barrels[1] && take > 1) a.barrels[1] = 1; else if (!a.barrels[1] && take > 0 && a.barrels[0]) a.barrels[1] = 1; a.mag = a.barrels[0] + a.barrels[1]; }
    else if (spec.mode !== 'pump') { const cap = spec.mag + (spec.chamber && a.mag > 0 ? 1 : 0); const take = Math.min(cap - a.mag, a.reserve); a.mag += take; a.reserve -= take; }
    this._syncState(); this.vm.st.locked = false;
  }

  // ------------------------------------------------------------------ clip events (sounds, casings, ammo transfer, grenade release, knife hit)
  _onClipEvent(type, arg, ev) {
    const id = this.currentId, spec = id ? WEAPONS[id] : null, a = id ? this.ammo[id] : null;
    switch (type) {
      case 'snd': this._play(id, arg, null, ev[3] ?? 1); break;
      case 'sndg': this._playRaw(arg, ev[3] ?? 1); break;
      case 'eject': if (spec?.casing) this._eject(spec); break;
      case 'ejectShells': { // olympia: throw out the fired shells
        const n = (a.barrels[0] ? 0 : 1) + (a.barrels[1] ? 0 : 1); for (let i = 0; i < n; i++) this._eject(spec); break; }
      case 'shell': if (a && a.reserve > 0 && a.mag < spec.mag) { a.mag++; a.reserve--; this.vm.st.mag = a.mag; } break;
      case 'unlock': this.vm.st.locked = false; break;
      case 'lock': this.vm.st.locked = true; break;
      case 'magFill': this._finishReload(id); break;
      case 'barrelsFill': break;
      case 'melee': this._meleeHit(); break;
      case 'throw': this._throwGrenade(); break;
      case 'pin': this._playRaw('wpn.grenade.pin'); break;
    }
  }
  _play(id, ev, pos = null, vol = 1) { if (!this.audio?.ready || !id) return; const m = this._snd[id] || (this._snd[id] = {}); const n = m[ev] || (m[ev] = 'gun.' + id + '.' + ev); const o = this._po; o.pos = pos; o.vol = vol * GUN_TRIM; this.audio.play(n, o); }
  _playRaw(n, vol = 1) { if (!this.audio?.ready) return; const o = this._po; o.pos = null; o.vol = vol * GUN_TRIM; this.audio.play(n, o); }

  // ------------------------------------------------------------------ melee (knife, left hand) + grenade
  _melee() {
    if (!(this.state === 'idle' || this.state === 'fire' || this.state === 'reload') || !this.currentId) return;
    if (this.state === 'reload') { this.vm.stop(); this._syncState(); }
    this.state = 'melee'; this.stateT = 0; this.adsK = 0; this._playRaw('wpn.melee.swing');
    this.vm.play('melee', { clip: GENERIC_CLIPS.melee, onEvent: this._evt, onEnd: () => { this.state = 'idle'; this.vm.hold('L', null); } });
  }
  _meleeHit() { const pl = this.player; const M = this._meleeSpec; M.origin.copy(pl.eye); M.dir.copy(pl.forward); const hit = this.combat?.melee(M); pl.addKick?.(hit ? -0.6 : 0.25, 0.4, hit ? 0.8 : 0.2); if (hit) this._playRaw('wpn.melee.hit'); }
  _grenade() {
    if (this.grenades <= 0 || !(this.state === 'idle' || this.state === 'fire') || !this.currentId) return;
    this.state = 'grenade'; this.stateT = 0; this.adsK = 0; this.grenades--;
    this.vm.play('grenade', { clip: GENERIC_CLIPS.grenade, onEvent: this._evt, onEnd: () => { this.vm.hold('R', null); this.state = 'draw'; this.vm.play('draw', { onEnd: () => { this.state = 'idle'; } }); } });
  }
  _throwGrenade() {
    const pl = this.player, vm = this.vm; const T = vm.handT.R; vm.camToWorld(T.P, _v); vm.hold('R', null);
    _v2.copy(pl.forward).multiplyScalar(GRENADE.throwSpeed).addScaledVector(_up, 2.6); if (pl.vel) _v2.addScaledVector(pl.vel, 0.8);
    this.grenadeSys.throw(_v, _v2, GRENADE.fuse - 0.55); this._playRaw('wpn.grenade.throw');
  }

  // ------------------------------------------------------------------ test / sandbox helpers
  /** freeze the view-model on a clip at time t (screenshots) ; null to release */
  freeze(clipName, t) { if (!clipName) { this.frozenPose = null; this.vm.act.done = true; this.vm.act.clip = null; if (this.state === 'reload' && this.currentId) this._finishReload(this.currentId); if (this.state !== 'none') this.state = 'idle'; this.vm.lowerK = 0; return; } const c = this.vm.cur?.clips[clipName] || GENERIC_CLIPS[clipName]; if (!c) return false; this.frozenPose = { clip: c, t }; return c.dur; }
  stats() { return { buildMs: Math.round(this.buildMs), timing: Object.fromEntries(Object.entries(this.timing || {}).map(([k, v]) => [k, Math.round(v)])), vmTris: this.vm.tris, handsTris: this.vm.hands.tris }; }
}

// ------------------------------------------------------------------ unheld models (mystery box / pickups): static meshes, centred
export function buildWorldModel(id, { skinned = false, layer = 0 } = {}) {
  const def = MODELS[id]; if (!def) return null; const mats = gunMats(GFX.renderer); mats.util(); const data = modelData(def, mats);
  const rig = new GunRig(data, mats, { layer, skinned, shadow: true }); const c = new THREE.Vector3(); data.box.getCenter(c);
  const g = new THREE.Group(); g.name = 'worldModel:' + id; rig.group.position.copy(c).negate(); g.add(rig.group); g.userData.rig = rig; return g;
}
