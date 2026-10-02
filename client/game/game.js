// Client game orchestrator.
import * as THREE from 'three';
import {
  PHASE,
  SERVER_TICK_RATE,
  INTERP_DELAY,
  BUILD_REACH,
  CRAFT_STATION_RADIUS,
  SLOT_PRIMARY,
  SLOT_PISTOL,
  SLOT_MELEE,
  SLOT_THROW,
  SLOT_BUILD,
  INVENTORY_SIZE,
  WATER_LEVEL,
  MAX_PLAYERS,
  ESCAPE_RADIUS,
  MAP_HALF,
  GRID_STEP,
  GRID_N,
  DUSK_WARNING,
  DAWN_RETURN,
  EYE_HEIGHT,
  INTERACT_REACH,
  CAR_REACH,
} from '../../shared/constants.js';
import {
  ITEM,
  ITEM_DEFS,
  WEAPONS,
  RECIPES,
  STRUCT,
  STRUCT_DEFS,
  STRUCT_ORDER,
  REPAIR_COST,
  ZOMBIE_DEFS,
  SUPPLIES,
  SUPPLY_NEED,
  SCHEM_BIT,
  THROW_ITEMS,
  CONT_DEFS,
  SOUND,
  NOTIFY,
  KILLER,
  ZTYPE,
  ZANIM,
  IMPACT,
  ZONE,
  ZONE_NAMES,
  AMMO_NAMES,
  AMMO_ITEMS,
  CONSUMABLES,
  PROJ,
  radioLinked,
} from '../../shared/defs.js';
import { ACT, ENT, SNAP, HOLD, CAR_ID, PING_KIND, PFLAG, CHATF, PLF, dqpos } from '../../shared/protocol.js';
import { createWorld } from '../../shared/world.js';
import { nightTheme } from '../../shared/nights.js';
import { shotDirections, currentWeapon, eyeHeight } from '../../shared/playersim.js';
import { raycastWorld, makeBox, overlapBoxes, COL } from '../../shared/collision.js';
import { zombieHitbox, playerHitbox, rayHitbox } from '../../shared/hitbox.js';
import { readHeader, readGlobal, readSelf, readEntities, readEvents } from '../net/decode.js';
import { Connection } from '../net/connection.js';
import { playerId } from '../net/identity.js';
import { Prediction } from './prediction.js';
import { InputBuffer } from './inputbuffer.js';
import { harvestPrompt, strippedKey, needLines } from './harvest.js';
import { Entities } from './entities.js';
import { GunClient } from './mountedgun.js';
import { MOUNTED_GUN } from '../../shared/mountedgun.js';
import { Input } from './input.js';
import { Voice } from './voice.js';
import { Environment } from '../render/environment.js';
import { buildTerrain, buildWater } from '../render/terrain.js';
import { buildMine } from '../render/mine.js';
import { buildClinic, disposeClinic } from '../render/clinic.js';
import { Graves } from '../render/cemetery.js';
import { StaticWorld } from '../render/staticworld.js';
import { Foliage } from '../render/foliage.js';
import { Effects } from '../render/effects.js';
import { Flyover } from '../render/flyover.js';
import { FixtureUI } from './fixtures.js';
import { Lights } from '../render/lights.js';
import { Atmosphere } from '../render/atmosphere.js';
import { WeatherFX } from '../render/weatherfx.js';
import { Weather } from './weather.js';
import { ViewModel } from '../render/models/weapons.js';
import { createGhost, createStructure } from '../render/models/structures.js';
import { createZombie, createSurvivor, zombieVariants } from '../render/models/characters.js';
import { createCat } from '../render/models/cat.js';
import { createPickup } from '../render/models/pickups.js';
import { createSupplyCrate, createProjectile } from '../render/models/misc.js';
import { itemIcon, glyph } from '../ui/icons.js';
import { recordRun } from '../ui/records.js';
import { KeyHints } from '../ui/keyhints.js';
import { bearing, nextNightText, PING_LABEL } from '../ui/hud2.js';

const WEATHER_TOAST = {
  fog: 'Fog is rolling in',
  gale: 'The wind is picking up',
  rain: 'It starts to rain',
  storm: 'A storm is breaking',
};

const SHOT_SOUND = {
  [ITEM.PISTOL]: SOUND.PISTOL,
  [ITEM.SHOTGUN]: SOUND.SHOTGUN,
  [ITEM.AK47]: SOUND.AK47,
  [ITEM.HUNTING_RIFLE]: SOUND.RIFLE,
  [ITEM.M4A1]: SOUND.M4A1,
  [ITEM.MP5]: SOUND.MP5,
  [ITEM.DB_SHOTGUN]: SOUND.DB_SHOTGUN,
  [ITEM.CROSSBOW]: SOUND.CROSSBOW,
};
// first-person muzzle flash scale + camera shake per shot (default [1, 0.06])
const SHOT_KICK = {
  [ITEM.SHOTGUN]: [1.4, 0.25],
  [ITEM.DB_SHOTGUN]: [1.6, 0.3],
  [ITEM.HUNTING_RIFLE]: [1.3, 0.3],
  [ITEM.MP5]: [0.8, 0.04],
  [ITEM.CROSSBOW]: [0, 0.1],
};
const PING_LIFE = 12;
const WAYPOINT_REACH = 10; // metres: this close to a waypoint that is not on a named place and it is reached
// A bulk craft is one ACT.CRAFT per craft. The server drops whatever a client sends past 200 messages in a second,
// commands included (Game.onMessage), so the repeats leave through a bucket: a whole Ctrl+click at once, and when
// clicks pile up on top of that, the rest over the next ticks.
const CRAFT_BURST = 20;
const CRAFT_RATE = 40; // per second
const LAND_SPRING = 16; // rad/s of the camera's landing dip: lowest ~60 ms after touchdown, level again in ~0.35 s
const RUN_JOIN_GRACE = 60; // seconds into day one by which a player must have joined for the run to go on their record
const BOARD_EVERY = 4000; // ms between two requests for the leaderboard while it is open
// Turning while aimed is slowed by the gun's zoom, tan(aimed fov / 2) / tan(hip fov / 2) (the ratio of the two
// magnifications, the same on any aspect ratio), so what is under the crosshair slides across the screen as far per
// centimetre of mouse as it does from the hip, whatever the zoom. On top of that, AIM_SENS: at 1 aimed and hip would
// match exactly; 0.82 keeps an ordinary gun where the flat 0.6 it replaces had it (0.82 * 0.73 at 75 degrees). The
// "Aim sensitivity" setting multiplies it (1.22 there is the exact match).
const AIM_SENS = 0.82;
const _ray = { t: -1, col: null, terrain: false };
const _dirs = new Float32Array(48);
const _shotHits = [];
const _hbPos = { x: 0, y: 0, z: 0 };
const _v = new THREE.Vector3();
const _spot = { x: 0, y: 0, z: 0 };
const DOWN_WEATHER = { rain: 0, wind: 0.2 }; // the weather as it is well down a drift of the mine
const _v2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _qv = new THREE.Quaternion();
const _sunRay = { t: -1, col: null, terrain: false };
const _near = [];
const _sc = { x: 0, y: 0 };

export class Game {
  constructor({ renderer, ui, audio, settings }) {
    this.renderer = renderer;
    this.ui = ui;
    this.audio = audio;
    this.settings = settings;
    this.scene = renderer.scene;
    this.camera = renderer.camera;
    this.world = null;
    this.seed = null;
    this.state = 'menu'; // menu | playing
    this.frame = 0;
    this.time = 0;
    this.myId = 0;
    this.global = { phase: PHASE.WAITING, day: 0, timeLeft: 0, hordeLeft: -1, bossId: 0, supplies: [0, 0, 0, 0, 0], hints: [255, 255, 255, 255, 255, 255, 255], found: 0, unlocked: 0, wave: 0, waves: 3, escapeT: 0, flags: 0, finale: false, suppliesDone: false, escapeReady: false, humansAlive: 0, playersTotal: 0, restartT: 0, benches: [] };
    this.self = { alive: 1, hp: 100, maxHp: 100, armor: 0, armorMax: 0, battery: 100, weapons: [0, 0, 0, 0, 0], mags: [0, 0], ammo: AMMO_ITEMS.map(() => 0) };
    this.inventory = { slots: new Array(INVENTORY_SIZE).fill(null), armor: null };
    this.craftQueue = []; // recipe ids of bulk crafts waiting to be sent (sendCrafts)
    this.craftBudget = CRAFT_BURST;
    this.craftSoundT = -1; // when a craft was last heard (eventHandler.sound)
    this.players = new Map(); // id -> {name, status, kills, ping}
    this.renderPos = new THREE.Vector3();
    this.clientTick = 0;
    this.clockInit = false;
    this.clockAdj = 0; // pending clock correction, eased in over a few frames
    this.net = { tick: 0, ack: 0 }; // running snapshot header state (tick / acked command of the last one)
    this.latestTick = 0; // newest snapshot received
    this.jitter2 = 0; // mean squared snapshot arrival error (ticks^2)
    this.lateRun = 0; // consecutive snapshots far behind the clock
    this.interpExtra = 0; // extra interpolation delay (ticks) on a jittery connection
    this.renderTick = 0;
    this.damageFx = 0;
    this.hitFx = 0;
    this.recoilKick = 0;
    this.camBob = 0;
    this.landDip = 0; // how far a landing has pushed the view down, a spring (landVel) kicked on touchdown
    this.landVel = 0;
    this.quake = 0; // the ground shaking under something heavy, 0..1: a tank's footfalls each add to it (Entities)
    this.fallV = 0; // downward speed in the last frame in the air
    this.eyeH = 1.62;
    this.fovCur = settings.fov || 75;
    this.aimT = 0; // 0 hip .. 1 aimed, eased with the zoom (look sensitivity)
    this.buildType = STRUCT.BARRICADE;
    this.buildRot = 0;
    this.ghosts = {};
    this.lastSlot = SLOT_PISTOL;
    this.localFlash = false;
    this.localFlashT = 0;
    this.openness = 0;
    this.indoor = 0;
    this.under = 0; // how far down the mine the eye is (0..1)
    this._envOver = { under: 0 };
    this._wxDown = {};
    this.stepAcc = 0;
    this.deathShown = false;
    this.overlay = null;
    this.runOn = false; // a run is under way, as far as this client has seen (trackRun)
    this.run = null; // ...and we have been in it from the start: { tick, kills0 }
    this.runReport = null; // what the run that just ended did to the personal record, for the end screen
    this.prevPhase = -1;
    this.lastHudInvKey = '';
    this.talkPeers = [];
    this.talkKey = '';
    this.onRadio = false; // carrying a walkie-talkie
    this.lookTarget = null;
    this.menuAngle = 0;
    this.lowHpBeat = 0;
    this.holding = 0; // hold-to-interact target we told the server about
    this.flames = new Map(); // flamethrowers spraying right now: shooter id (-1 = ours) -> { loop, t }
    this.pings = [];
    // your own waypoint, set on the field map and never sent anywhere:
    // { x, y, z, zone (id of the place it sits on, or -1), r (arrival radius), visited, away }
    this.waypoint = null;
    ui.map.onWaypoint = (at) => this.setWaypoint(at);
    this.boardT = 0; // when the leaderboard is next asked for, while it is open (performance.now)
    this.discovered = new Set([ZONE.CAMP]);
    this.stripped = new Set(); // the trees and wrecks with nothing left to give today (harvest.js strippedKey)
    this.discoverT = 0;
    this.debugCam = null;
    this.warm = null; // shader warm-up in progress (prewarm)
    this.warmKey = ''; // quality + map the programs were last warmed for

    this.input = new Input(renderer.canvas);
    this.input.sensitivity = settings.sensitivity || 1;
    this.input.invertY = !!settings.invertY;
    this.input.rawInput = settings.rawMouse !== false;
    this.keyHints = new KeyHints(this); // names the key on the HUD at the moment it would help
    this.conn = new Connection({
      snapshot: (r) => this.onSnapshot(r),
      world: (seed) => this.loadWorld(seed),
      inventory: (r) => this.onInventory(r),
      chat: (id, flags, text) => this.onChat(id, flags, text),
      players: (r) => this.onPlayers(r),
      board: (b) => this.ui.setBoard(b),
      voice: (from, payload) => this.voice.onSignal(from, payload),
      close: () => this.onDisconnect(),
    });
    this.voice = new Voice(this.conn, audio);
    this.voice.onState = (s) => this.ui.setVoiceState({ ...s, speakers: this.speakers() });
    this.env = new Environment(this.scene);
    this.weather = new Weather();
    this.weather.onStrike = (s) => this.onLightning(s);
    this.lights = new Lights(this.scene, this.camera, renderer.q);
    this.vm = null; // built with the first world (ensureViewModel), not here: the splash has to paint first
    this.vmItem = -1;
    this.entities = new Entities(this);
    this.fixtures = new FixtureUI(this); // the chapel bell and the Relay Station's radio: prompts and notices
    this.gun = new GunClient(this); // the mounted gun at the Army Checkpoint
    this.prediction = new Prediction(null);
    this.inputBuffer = new InputBuffer(); // holds a fire / reload / jump pressed a moment early until it can act
    this.setupInputHandlers();
    // a click on the canvas takes the pointer back when the lock was lost or refused
    renderer.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked && !this.ui.inventoryOpen && !this.ui.isTyping()) this.input.requestLock();
    });
  }

  // How much sun/moon reaches the camera: blocked by buildings/terrain (ray cast towards the light)
  // and partly by tree crowns along that ray. Keeps the hands dark in the shade and under the canopy.
  lightVisibility(pos) {
    const L = this.env.lightDir;
    const w = this.world;
    raycastWorld(w, pos.x, pos.y, pos.z, L.x, L.y, L.z, 45, _sunRay, COL.NOBULLET | COL.NOBLOCK | COL.TREE);
    if (_sunRay.t >= 0) return 0;
    let occ = 0;
    for (let s = 1.5; s < 26 && occ < 1; s += 3) {
      const px = pos.x + L.x * s;
      const py = pos.y + L.y * s;
      const pz = pos.z + L.z * s;
      for (const c of w.staticGrid.query(px, pz, 3.5, _near)) {
        if (!(c.flags & COL.TREE) || py < c.y0 + 2 || py > c.y1) continue;
        // crowns taper towards the top; dead trees and birches let most light through
        const h = (py - c.y0) / (c.y1 - c.y0);
        const conifer = c.tv <= 2;
        const cr = (conifer ? 3.2 : 2.2) * (c.r / 0.4) * (1 - h * 0.85);
        const d2 = (px - c.x) ** 2 + (pz - c.z) ** 2;
        if (d2 < cr * cr) occ += conifer ? 0.3 : 0.12;
      }
    }
    return Math.max(0, 1 - occ);
  }

  // surroundings for the audio reverb: openness (few trees within 14 m) and a roof overhead
  probeSurroundings(pos) {
    const w = this.world;
    let trees = 0;
    for (const c of w.staticGrid.query(pos.x, pos.z, 14, _near)) if (c.flags & COL.TREE && (c.x - pos.x) ** 2 + (c.z - pos.z) ** 2 < 196) trees++;
    this.openness = Math.max(0, 1 - trees / 7);
    raycastWorld(w, pos.x, pos.y, pos.z, 0, 1, 0, 10, _sunRay, COL.NOBULLET | COL.NOBLOCK | COL.TREE);
    this.indoor = _sunRay.t >= 0 && !_sunRay.terrain ? 1 : 0;
  }

  updateViewmodelLight(dt, cam, nearFire) {
    this.vmLightT = (this.vmLightT || 0) - dt;
    if (this.vmLightT <= 0) {
      this.vmLightT = 0.2;
      this.vmSunTarget = this.lightVisibility(cam.position);
      this.probeSurroundings(cam.position);
    }
    this.vmSun = (this.vmSun ?? 1) + ((this.vmSunTarget ?? 1) - (this.vmSun ?? 1)) * Math.min(1, dt * 5);
    const c = this.env.cur;
    const vmh = this.renderer.vmHemi;
    vmh.color.copy(c.hemiSky);
    vmh.groundColor.copy(c.hemiGround);
    vmh.intensity = (c.hemi * (0.75 + 0.15 * this.vmSun) + nearFire * 0.8) * 1.2;
    // the viewmodel camera never moves: bring the world light direction into camera space
    const d = this.renderer.vmDir;
    d.position.copy(this.env.lightDir).applyQuaternion(_qv.copy(cam.quaternion).invert());
    d.color.copy(c.dir);
    d.intensity = c.dirI * 0.75 * this.vmSun * (this.env.sun.intensity / Math.max(1e-3, c.dirI * Math.PI));
  }

  // local flashlight scattering in the haze (post pass); denser at night and in the valley mist
  beamState() {
    const b = (this._beam ||= { light: this.lights.flashlight, density: 0 });
    // (env.cur.mist already carries fog banks; rain catches the light too)
    b.density = 0.00012 + this.env.night * 0.00022 + this.env.cur.mist * 0.008 + this.weather.state.rain * 0.0003;
    return b;
  }

  setShadowQuality(q) {
    this.entities.setCharShadows(!!q.charShadows);
    if (this.terrain) this.terrain.castShadow = !!q.shadows;
    this.staticWorld?.setShadows(!!q.shadows);
  }

  // The first-person arms and weapons. Baking their two 1024 px atlases holds the main thread for ~0.3 s, so it is
  // done with the first world build (behind the splash, or on the join if that comes first) instead of in the
  // constructor, where it kept the splash from painting. Nothing uses the view model before a world is loaded.
  ensureViewModel() {
    if (this.vm) return;
    this.vm = new ViewModel();
    this.renderer.vmScene.add(this.vm.group);
  }

  // ---------------------------------------------------------------- world
  loadWorld(seed) {
    this.ensureViewModel();
    if (this.seed === seed && this.world) return;
    const t0 = performance.now();
    if (this.world) this.unloadWorld();
    this.seed = seed;
    this.waypoint = null; // it pointed into the old valley
    this.world = createWorld(seed);
    this.prediction.setWorld(this.world);
    const t1 = performance.now();
    this.terrain = buildTerrain(this.world);
    this.terrain.castShadow = !!this.renderer.q.shadows; // hills shade the valleys at low sun
    this.scene.add(this.terrain);
    this.water = buildWater(this.world);
    this.scene.add(this.water);
    this.mine = buildMine(this.world); // (null in a valley without the workings)
    if (this.mine) this.scene.add(this.mine);
    this.clinic = buildClinic(this.world); // the lining of Mercy Clinic's dark wards and its signs (null on a map without it)
    if (this.clinic) this.scene.add(this.clinic);
    this.under = 0;
    const t2 = performance.now();
    this.staticWorld = new StaticWorld(this.scene, this.world);
    this.staticWorld.setShadows(!!this.renderer.q.shadows);
    const t3 = performance.now();
    this.foliage = new Foliage(this.scene, this.world, this.renderer.q);
    const t4 = performance.now();
    if (!this.effects) this.effects = new Effects(this.scene, this.renderer.vmScene, this.world);
    else this.effects.world = this.world;
    if (!this.flyover) this.flyover = new Flyover(this.scene, this.effects.atlas);
    (this.graves ||= new Graves(this)).setWorld(this.world); // the earth of St. Agnes Cemetery, when it breaks open
    if (!this.atmosphere) this.atmosphere = new Atmosphere(this.scene);
    this.weather.setWorld(this.world);
    if (!this.weatherFx) this.weatherFx = new WeatherFX(this.scene, this.renderer.quality);
    this.weatherFx.setWorld(this.world, this.weather);
    this.staticFires = [];
    this.staticEmitters = [];
    for (const l of this.world.lights) {
      if (l.kind === 'embers') {
        // burning barrels / smouldering wrecks
        this.staticEmitters.push(this.effects.createEmitter('barrel', l.x, l.y, l.z));
        this.staticFires.push({ x: l.x, y: l.y - 0.4, z: l.z, intensity: 0.75 });
      }
    }
    this.ui.map.setWorld(this.world);
    this.prewarm();
    console.log(`[client] world ${seed}: gen ${(t1 - t0).toFixed(0)}ms, terrain ${(t2 - t1).toFixed(0)}ms, static ${(t3 - t2).toFixed(0)}ms, foliage ${(t4 - t3).toFixed(0)}ms, rest ${(performance.now() - t4).toFixed(0)}ms`);
  }

  // (the server deals a new map every playthrough, so worlds come and go for as long as the page is open)
  unloadWorld() {
    for (const mesh of [this.terrain, this.water]) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    if (this.mine) {
      this.scene.remove(this.mine);
      for (const mesh of this.mine.children) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      this.mine = null;
    }
    if (this.clinic) {
      this.scene.remove(this.clinic);
      disposeClinic(this.clinic);
      this.clinic = null;
    }
    this.staticWorld?.dispose();
    this.foliage?.dispose();
    for (const em of this.staticEmitters) this.effects.removeEmitter(em);
    this.flyover?.clear();
    this.world = null;
  }

  // ---------------------------------------------------------------- shader warm-up
  // three.js builds a material's shader program the first time it is drawn and waits for it on the main thread,
  // so the frame in which the first torch, gate, muzzle flash or spitter appeared used to stall. Instead every
  // program play can need at this quality is built behind the splash: started without waiting for it (the driver
  // compiles in the background), not used until it is built, and then one frame nobody sees draws one of
  // everything (warmFrame). Runs again for a new map (other props, other materials) and when the quality changes
  // (other lights and shadows: another program for every lit material).
  prewarm() {
    const key = `${this.renderer.quality}:${this.seed}`;
    if (!this.world || key === this.warmKey) return;
    this.warmKey = key;
    this.warmTodo ||= this.warmViews();
    this.scene.add(this.warmSet);
    // hold: the frame loop draws nothing (the scene's own programs are still being built)
    const w = (this.warm = { hold: true, ready: false, sync: false, t0: performance.now() });
    w.steps = this.warmSteps(w);
    const tick = () => {
      if (this.warm !== w) return; // finished early (play began), or the quality changed again
      const step = w.steps.next();
      if (step.done) w.ready = true; // update() draws the warm frame
      else setTimeout(tick, step.value);
    };
    setTimeout(tick, 0);
  }

  // A warm-up's work in slices short enough to leave the splash responsive. Each yield is the wait before the
  // next slice (ms); with w.sync set it runs straight through.
  *warmSteps(w) {
    const R = this.renderer;
    const compile = () => {
      R.compilePrograms();
      const stage = this.warmStage();
      R.compileDepth(stage.casters);
      stage.undo();
    };
    // first what the scene holds already. The frame loop waits for these, then draws again: the splash gets its
    // backdrop while the views are still being built
    compile();
    while (!w.sync && !R.programsReady()) yield 16;
    w.hold = false;
    if (!this.warmTodo.length) return;
    while (this.warmTodo.length) {
      this.warmTodo.shift()();
      if (!w.sync) yield 0;
    }
    compile(); // the views' own
    while (!w.sync && !R.programsReady()) yield 16;
  }

  // One of every view that does not exist until the game needs it (what Entities draws, the build ghosts, the
  // supply plane, the weapons in the hands), as a list of small build steps. Building them also bakes what they
  // are made from - zombie rigs, pickup and weapon meshes - which used to happen in the frame the first one
  // showed up. The views stay in this.warmSet (hidden: only the warm frame shows it) for the next warm-up.
  // Anything new that the game creates on demand with a material of its own belongs here, or its program is
  // built mid-game again.
  warmViews() {
    const set = (this.warmSet = new THREE.Group());
    set.visible = false;
    const chars = (set.userData.chars = []); // these cast shadows on the presets where characters do
    const steps = [];
    // every zombie rig. createZombie picks the variant from its seed, so go through seeds until a rig turns up that
    // has not been built yet; one view is kept, they all share a material
    for (const t of Object.values(ZTYPE)) {
      const rigs = new Set();
      let seed = 0;
      for (let v = zombieVariants(t); v > 0; v--) {
        steps.push(() => {
          for (let fresh = false, tries = 0; !fresh && tries < 64; tries++) {
            const z = createZombie(t, seed++);
            const rig = z.object.getObjectByProperty('isSkinnedMesh', true).geometry;
            fresh = !rigs.has(rig);
            rigs.add(rig);
            if (chars.length) z.dispose();
            else set.add(chars[0] = z.object);
          }
        });
      }
    }
    steps.push(() => {
      const sv = createSurvivor(1);
      sv.setWeapon(ITEM.PISTOL);
      chars.push(sv.object);
      // (Entities draws these three with its own geometry: a teammate's flashlight cone, a roper's rope, the loot glints)
      const e = this.entities;
      set.add(sv.object, new THREE.Mesh(e.coneGeo, e.coneMat), new THREE.Mesh(e.ropeGeo, e.ropeMat), new THREE.Points(e.glints.geometry, e.glints.material));
    });
    steps.push(() => set.add(createCat(0, 1).object));
    steps.push(() => set.add(createSupplyCrate()));
    for (const p of Object.values(PROJ)) steps.push(() => set.add(createProjectile(p)));
    const items = Object.values(ITEM).filter((it) => it);
    for (let i = 0; i < items.length; i += 3) {
      steps.push(() => {
        for (const it of items.slice(i, i + 3)) set.add(createPickup(it));
      });
    }
    for (const t of STRUCT_ORDER) {
      steps.push(() => {
        const s = createStructure(t);
        s.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true)); // as Entities sets them up
        set.add(s, createGhost(t));
      });
    }
    steps.push(() => {
      // the supply plane, in the materials Flyover gives it
      this.flyover.start(0, 0, 0, 0, 0, this.time, null);
      set.add(this.flyover.planes.pop().obj);
    });
    // the viewmodel builds a weapon's mesh the first time it is held
    for (const it of [...Object.keys(WEAPONS), ...THROW_ITEMS]) steps.push(() => this.vm.setItem(+it));
    steps.push(() => {
      this.vm.setItem(0);
      this.vmItem = -1;
    });
    return steps;
  }

  // Sets the scenes up for the warm frame: one mesh of every static-world material, everything else that is
  // hidden or out of view shown, and every mesh that can cast a shadow at this quality casting one. Returns those
  // casters and the way back. The shadow passes draw the casters with depth materials three keeps to itself; it
  // only picks a program for one when the kind of mesh changes, by the sides and texture of the mesh that came by
  // just then, so here every caster makes it pick again (needsUpdate) and every combination play can meet exists.
  warmStage() {
    const set = this.warmSet;
    const undo = [];
    const casters = [];
    for (const o of set.userData.chars) o.traverse((m) => m.isSkinnedMesh && (m.castShadow = this.entities.charShadows));
    // vegetation that can cast at this quality (InstancedSet.update: within castDist, never the near tree LOD)
    const f = this.foliage;
    for (const s of [f.trees, f.bushes, f.rocks]) {
      if (!(s.castDist > 0)) continue;
      for (const lods of s.meshes) {
        lods.forEach((parts, l) => {
          if (lods.length > 1 && l === 0) return;
          for (const m of parts) {
            if (m.castShadow) continue;
            m.castShadow = true;
            undo.push(() => (m.castShadow = false));
          }
        });
      }
    }
    const show = (o) => {
      if (!o.visible) {
        o.visible = true;
        undo.push(() => (o.visible = false));
      }
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      if (o.frustumCulled) {
        o.frustumCulled = false;
        undo.push(() => (o.frustumCulled = true));
      }
      if (o.castShadow) {
        casters.push(o);
        const own = Object.hasOwn(o, 'onBeforeShadow') && o.onBeforeShadow;
        o.onBeforeShadow = function (...a) {
          a[5].needsUpdate = true; // (the depth material this mesh is about to be drawn with)
          if (own) own.apply(this, a);
        };
        undo.push(() => (own ? (o.onBeforeShadow = own) : delete o.onBeforeShadow));
      }
    };
    // the static world: one mesh of each material will do (StaticWorld.update sets their visibility again), and
    // one of its shadow casters for each shadow side - they are what the shadow passes draw of it. Their group is
    // left as StaticWorld.setShadows has it: hidden when the quality has no shadows.
    const statics = this.staticWorld.group;
    const shade = this.staticWorld.casters;
    const mats = new Set();
    for (const m of [...statics.children, ...(shade.visible ? shade.children : [])]) {
      if (m === shade) continue;
      m.visible = !mats.has(m.material);
      mats.add(m.material);
      if (m.visible) show(m);
    }
    const showAll = (o) => {
      if (o === statics) return;
      show(o);
      for (const c of o.children) showAll(c);
    };
    showAll(this.scene);
    showAll(this.renderer.vmScene);
    return { casters, undo: () => undo.forEach((u) => u()) };
  }

  // One frame through the whole pipeline that is never seen (the frame loop draws the real one over it before the
  // browser presents), with one of everything in it and every post pass on: it uses each program once, so not
  // even a program's first use is left for play.
  warmFrame() {
    const R = this.renderer;
    this.camera.getWorldDirection(_v);
    this.warmSet.position.copy(this.camera.position).addScaledVector(_v, 6);
    const stage = this.warmStage();
    const fl = this.lights.flashlight;
    const flI = fl.intensity;
    fl.intensity = 1; // the beam pass only runs with the flashlight on, the sun shafts with the sun on screen
    R.render({ time: this.time, night: this.env.night, damage: 0, lowHealth: 0, infected: 0, dead: 0, exposure: this.env.exposure, rays: { ...this.env.rays, sunDir: _v, strength: 1 }, beam: { light: fl, density: 0.001 }, adaptRef: 0.1, dt: 0.016 }, true);
    R.adaptReset = true; // the eye adaptation does not start from this frame
    fl.intensity = flI;
    stage.undo();
  }

  // Ends a warm-up. If play has begun before it is done (a quick join, a new map or quality mid-game), the rest
  // happens here in one go, as it used to on the first frame.
  finishPrewarm() {
    const w = this.warm;
    const programs = this.renderer.renderer.info.programs;
    w.sync = true;
    while (!w.steps.next().done);
    const n = programs.length;
    const t = performance.now();
    this.warmFrame();
    this.scene.remove(this.warmSet);
    this.warm = null;
    console.log(`[client] shaders: ${programs.length} programs ${w.ready ? 'built' : 'built in one go (play had begun)'} ${(t - w.t0).toFixed(0)}ms after the world, warm frame ${(performance.now() - t).toFixed(0)}ms${programs.length > n ? `, which had to build ${programs.length - n} itself` : ''}`);
  }

  // ---------------------------------------------------------------- connection
  async join(name) {
    this.audio.stinger?.('join');
    const info = await this.conn.connect(name, playerId());
    this.myId = info.id;
    this.voice.setMyId(info.id);
    this.loadWorld(info.seed);
    this.entities.clear();
    this.clientTick = info.tick;
    this.clockInit = false;
    this.interpExtra = 0;
    this.introPending = true; // until NEW_GAME introduces the run this join started, or lateJoinIntro one already under way
    this.runOn = false;
    this.run = this.runReport = null;
    this.state = 'playing';
    this.input.enabled = true;
    this.inputBuffer.clear();
    this.input.requestLock();
    this.discovered = new Set([ZONE.CAMP]);
    this.stripped.clear(); // (the first snapshot says which are)
    this.waypoint = null;
    return info;
  }

  onDisconnect() {
    if (this.state !== 'playing') return;
    this.state = 'menu';
    this.input.enabled = false;
    this.input.exitLock();
    this.entities.clear();
    this.voice.closeAll();
    // the splash is see-through and the next join starts from this UI: take down whatever the game had up
    this.ui.setMapOpen(false);
    this.ui.setBoardOpen(false);
    this.ui.setBoard(null); // (what it showed was that server's, as of then)
    this.ui.setRosterOpen(false);
    this.ui.setInventoryOpen(false);
    this.ui.showPause(false); // ("Leave game" is pressed on it)
    this.ui.clearNotices();
    this.ui.hideOverlays();
    this.overlay = null;
    this.deathShown = false;
    this.ui.showSplash();
    // a player who pressed "Leave game" knows why they are back here: only a drop is an error
    if (!this.leaving) this.ui.setJoinError('Disconnected from server.');
    this.leaving = false;
  }

  leave() {
    if (this.state !== 'playing') return;
    this.leaving = true;
    this.conn.close();
  }

  onSnapshot(r) {
    const flags = readHeader(r, this.net);
    const tick = this.net.tick;
    this.snapAt = performance.now(); // (when they stop coming the HUD says so: updateHud)
    const ack = this.net.ack;
    if (flags & SNAP.GLOBAL) this.global = readGlobal(r, this.global);
    const sync = readSelf(r, this.self, flags);
    readEntities(r, this.entities.store, tick, flags);
    // clock
    if (!this.clockInit) {
      this.clientTick = tick;
      this.clockAdj = 0;
      this.jitter2 = 0;
      this.lateRun = 0;
      this.latestTick = tick;
      this.clockInit = true;
    } else {
      const err = tick - (this.clientTick + this.clockAdj);
      // way off: resync. A single very late snapshot is not that - it's the head of a burst after a
      // server/network stall, and pulling the clock back for it would rewind every entity
      this.lateRun = err < -6 ? this.lateRun + 1 : 0;
      if (err > 6 || this.lateRun > 4) {
        this.clientTick = tick;
        this.clockAdj = 0;
        this.lateRun = 0;
      } else if (err >= -6) {
        this.clockAdj += err * 0.08;
        this.jitter2 += (Math.min(err * err, 9) - this.jitter2) * 0.02;
      }
      if (tick > this.latestTick || this.latestTick - tick > 1000) this.latestTick = tick;
    }
    // the server only sends our own state when the prediction has to be rebased on it
    if (sync) this.prediction.reconcile(ack, this.self);
    else this.prediction.confirm(ack);
    readEvents(r, this.eventHandler, flags, this.entities.ents);
    // (after the events: a join that starts the run gets NEW_GAME in this same snapshot, and that is its introduction)
    if (this.introPending && flags & SNAP.GLOBAL && (this.global.phase === PHASE.DAY || this.global.phase === PHASE.NIGHT)) this.lateJoinIntro();
    if (flags & SNAP.GLOBAL) this.trackRun();
  }

  // The personal record (ui/records.js). A run goes on it when this player was in it from its first minute
  // and is still connected when it ends: joining later or leaving early records nothing. It follows the
  // replicated phase, not the NEW_GAME / VICTORY / GAME_OVER notifications: a client the server skips for a
  // tick loses that tick's events, while the global state always catches up.
  trackRun() {
    const g = this.global;
    if (g.phase === PHASE.DAY || g.phase === PHASE.NIGHT) {
      if (this.runOn) return;
      this.runOn = true;
      // how much of the run was played before we saw it: nothing when it starts under us
      const gone = g.phase === PHASE.DAY && g.day === 1 ? g.phaseLen - g.timeLeft : Infinity;
      // kills0: our score when the run began. The server's count can carry over from the run before
      this.run = gone <= RUN_JOIN_GRACE ? { tick: this.net.tick - gone * SERVER_TICK_RATE, kills0: this.players.get(this.myId)?.kills ?? Infinity } : null;
    } else if (this.runOn) {
      this.runOn = false;
      const run = this.run;
      this.run = null;
      if (g.phase !== PHASE.VICTORY && g.phase !== PHASE.GAMEOVER) return;
      if (!run) {
        this.runReport = { late: true };
        return;
      }
      this.runReport = recordRun({
        t: Date.now(),
        seed: this.seed,
        result: g.phase === PHASE.VICTORY ? 'escaped' : 'wiped',
        nights: g.day - 1, // night N closes day N: a run that ends on day N got through N - 1 of them
        secs: (this.net.tick - run.tick) / SERVER_TICK_RATE, // the server's tick clock, which the day and night run on: a stalled tab or a laggy link cannot bend it
        kills: (this.players.get(this.myId)?.kills ?? 0) - run.kills0,
        team: this.players.size,
      });
    }
  }

  onInventory(r) {
    const slots = this.inventory.slots;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const item = r.u8();
      const count = r.u16();
      slots[i] = item ? { item, count } : null;
    }
    const armorItem = r.u8();
    const armor = r.u8();
    const armorMax = r.u8();
    this.inventory.armor = armorItem ? { item: armorItem, points: armor, max: armorMax } : null;
    this.pushInventoryToUI(true);
  }

  pushInventoryToUI(force = false) {
    const s = this.prediction.state;
    const key = `${s.weapons.join(',')}|${s.ammo.join(',')}|${s.throwCount}`;
    if (!force && key === this.lastHudInvKey) return;
    this.lastHudInvKey = key;
    const throwCounts = {};
    for (const it of this.inventory.slots) if (it && THROW_ITEMS.includes(it.item)) throwCounts[it.item] = (throwCounts[it.item] || 0) + it.count;
    this.ui.setInventory({ slots: this.inventory.slots, armor: this.inventory.armor, ammo: [...s.ammo], weapons: [...s.weapons], throwCounts });
  }

  invCounts() {
    const m = {};
    for (const it of this.inventory.slots) if (it) m[it.item] = (m[it.item] || 0) + it.count;
    return m;
  }

  onChat(id, flags, text) {
    const radio = !!(flags & CHATF.RADIO);
    if (flags & CHATF.SYSTEM) this.ui.addChat('', text, { system: true });
    else {
      const p = this.players.get(id);
      const zombie = !!(flags & CHATF.ZOMBIE);
      this.ui.addChat(p ? p.name : '???', text, { zombie, color: zombie ? '#7fae5a' : undefined, radio, faint: !!(flags & CHATF.FAINT), unheard: !!(flags & CHATF.UNHEARD) });
    }
    this.audio.playLocal?.(radio ? 'radio' : 'chat', { volume: 0.5 });
  }

  onPlayers(r) {
    const n = r.u8();
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const id = r.u16();
      const name = r.str();
      const status = r.u8();
      const walkie = !!(r.u8() & PLF.WALKIE);
      const kills = r.u16();
      const ping = r.u16();
      seen.add(id);
      this.players.set(id, { name, status, walkie, kills, ping });
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
    // (a count that went down was reset by the server for the new run: the run's kills then count from there)
    if (this.run) this.run.kills0 = Math.min(this.run.kills0, this.players.get(this.myId)?.kills ?? Infinity);
    this.pushRoster();
    this.voice.syncPlayers([...this.players.keys()]);
    // who the walkie-talkie reaches
    const onRadio = !!this.players.get(this.myId)?.walkie;
    for (const [id, p] of this.players) if (id !== this.myId) this.voice.setRadio(id, radioLinked(p.walkie, onRadio));
    if (onRadio !== this.onRadio) {
      this.onRadio = onRadio;
      this.ui.setRadio(onRadio);
      if (onRadio) {
        this.ui.addChat('', 'Walkie-talkie: your voice and chat now reach every survivor carrying one.', { system: true });
        this.audio.playLocal?.('radio', { volume: 0.6 });
      }
    }
  }

  // What the player list [Tab] shows: the players as the server lists them, plus everyone's health. Health is not
  // in the list message: a teammate's rides in their entity record (field 7, 0..255), our own in the self state.
  pushRoster() {
    const ST = ['alive', 'zombie', 'dead', 'downed'];
    const list = [];
    const turned = !this.self.alive || !!this.prediction.state.zombie; // the dead get no report on the living
    for (const [id, p] of this.players) {
      const self = id === this.myId;
      const e = self || turned ? null : this.entities.ents.get(id);
      const hp = self ? (this.self.maxHp ? this.self.hp / this.self.maxHp : 1) : e ? e.q[7] / 255 : -1; // -1: nothing to show
      list.push({ id, name: p.name, status: ST[p.status] || 'alive', hp, kills: p.kills, ping: self ? Math.round(this.conn.rtt) : p.ping, talking: this.talkPeers.includes(id), radio: p.walkie, self });
    }
    this.ui.setPlayers(list);
  }

  // the peers you can hear talking right now (for the HUD)
  speakers() {
    return this.talkPeers.map((id) => ({ name: this.players.get(id)?.name || '?', radio: this.voice.overRadio(id) }));
  }

  name(id) {
    return this.players.get(id)?.name || 'Someone';
  }

  // a death now lasts until sunrise (DAWN_RETURN) - unless there is none to come: the final stand stops the clock,
  // and a wipe ends the run
  dawnAhead() {
    const g = this.global;
    return DAWN_RETURN && !g.finale && (g.phase === PHASE.DAY || g.phase === PHASE.NIGHT);
  }

  // ---------------------------------------------------------------- events
  get eventHandler() {
    if (this._eh) return this._eh;
    const g = this;
    this._eh = {
      sound(snd, x, y, z) {
        // a bulk craft is a tick's worth of craft events at one bench: one rummage, not twenty on top of each other
        if (snd === SOUND.CRAFT) {
          if (g.time - g.craftSoundT < 0.1) return;
          g.craftSoundT = g.time;
        }
        // (HORDE_HORN / DAWN / PLANE are always played 2D by the audio engine)
        g.audio.play(snd, { x, y, z });
      },
      shot(ev) {
        g.remoteShot(ev);
      },
      impact(kind, x, y, z, nx, ny, nz, own) {
        // what our own shot struck was shown as it was fired (predictPellet): this is the server saying so again
        if (!own && g.sameAsOwn(x, y, z)) return;
        // hits on ourselves are shown by the damage vignette, not particles in our face
        const dc = Math.hypot(x - g.camera.position.x, y - g.camera.position.y, z - g.camera.position.z);
        if (dc < 1.2) return;
        g.effects.impact(kind, x, y, z, nx, ny, nz);
        if (kind === 1 || kind === 6) g.audio.play(SOUND.FLESH_HIT, { x, y, z, volume: 0.6 });
      },
      hitmark(flags) {
        g.ui.hitmarker(!!(flags & 1), !!(flags & 2));
        // a quiet meaty thwack confirms a gun hit (melee hits already sound MELEE_HIT); kills are heard as the death cry
        const s = g.prediction.state;
        if (!s.zombie && (g.gun.manning || !WEAPONS[currentWeapon(s)]?.melee)) g.audio.playLocal(flags & 1 ? 'headshot' : 'hitmarker', { volume: 0.7 });
      },
      damage(amount, fx, fz) {
        g.damageFx = Math.min(1, g.damageFx + amount / 40);
        const dx = fx - g.renderPos.x;
        const dz = fz - g.renderPos.z;
        const angle = Math.hypot(dx, dz) > 0.3 ? bearing(dx, dz) + g.input.yaw : null;
        g.ui.damage(amount, angle);
        g.camShake = Math.min(1, (g.camShake || 0) + amount / 60);
        g.audio.playLocal(g.self.zombie ? 'zombie_player_growl' : 'hurt', { volume: Math.min(1, 0.4 + amount / 40) });
      },
      killfeed(kk, killerId, victimId, weapon, flags) {
        // a zombie the world killed is a boss that outlived the night: the dawn sun burnt it, and its loot with it
        const sunKill = kk === KILLER.WORLD && !!(victimId & 0x8000);
        const killer = kk === KILLER.PLAYER ? g.name(killerId) : kk === KILLER.ZOMBIE ? ZOMBIE_DEFS[killerId]?.name || 'Zombie' : sunKill ? 'The sun' : 'The world';
        const victim = victimId & 0x8000 ? ZOMBIE_DEFS[victimId & 0xff]?.name || 'Zombie' : g.name(victimId);
        g.ui.killfeed({ killer, victim, weaponItem: weapon, headshot: !!(flags & 1), killerZombie: kk === KILLER.ZOMBIE || (kk === KILLER.PLAYER && g.players.get(killerId)?.status === 1), victimPlayer: !(victimId & 0x8000) });
        if (sunKill) g.ui.notify(`${victim.startsWith('The ') ? victim : 'The ' + victim} burned in the sun, and what it carried with it. Kill a boss before sunrise to loot it.`, 'toast', 7);
      },
      notify(msg, arg) {
        g.onNotify(msg, arg);
      },
      explosion(x, y, z, radius, kind) {
        g.effects.explosion(x, y, z, radius, kind);
        if (kind === 0 || kind === 2) g.lights.flashFx(x, y, z, kind === 2 ? 40 : 120, 0.5);
        const d = Math.hypot(x - g.renderPos.x, z - g.renderPos.z);
        g.camShake = Math.min(1.5, (g.camShake || 0) + Math.max(0, 1 - d / (radius * 5)) * 1.2);
      },
      pickup(item, count) {
        g.ui.pickup(item, count);
        g.audio.playLocal('pickup');
      },
      zombieDie(id, yaw, flags) {
        g.entities.zombieDie(id, yaw, flags);
      },
      zombieLeg(id, legs, yaw) {
        g.entities.zombieLeg(id, legs, yaw);
      },
      structBreak(x, y, z) {
        g.effects.structBreak(x, y, z);
      },
      stripped(qx, qy, qz) {
        g.stripped.add(strippedKey(qx, qy, qz));
      },
      regrown() {
        g.stripped.clear();
      },
      flyover(x, y, z, heading, eta) {
        g.flyover?.start(x, y, z, heading, eta, g.time, g.audio);
      },
      grave(i) {
        g.graves?.stir(i);
      },
      ping(pid, kind, x, y, z) {
        g.pings = g.pings.filter((p) => p.pid !== pid);
        g.pings.push({ pid, kind, x, y, z, t: g.time, name: g.name(pid) });
        g.audio.playLocal('notify', { volume: 0.7 });
      },
      pong(held) {
        g.conn.pong(held);
      },
      summary(s) {
        // after the "DAY N" title card has faded
        setTimeout(() => g.state === 'playing' && g.ui.showSummary(s, nextNightText(s.night + 1), nightTheme(g.seed, s.night + 1)), 4300);
      },
    };
    return this._eh;
  }

  onNotify(msg, arg) {
    const ui = this.ui;
    const a = this.audio;
    if (this.fixtures.notify(msg, arg)) return;
    switch (msg) {
      case NOTIFY.NIGHT_FALLS: {
        // a themed night says so (the same theme the server drew: both work it out from the seed)
        const th = nightTheme(this.seed, arg);
        ui.notify(th ? `NIGHT ${arg}: ${th.name.toUpperCase()}` : `NIGHT ${arg}`, 'big', th ? 6 : 4);
        ui.notify(th ? th.warn : arg <= 1 ? 'The horde is coming to wherever you are. Hold your shelter.' : `Horde ${arg}: more of them than last night.`, 'sub', th ? 6 : 4);
        a.stinger?.('night');
        break;
      }
      case NOTIFY.WAVE:
        ui.notify(`WAVE ${arg}`, 'danger', 3);
        a.playLocal('notify');
        break;
      case NOTIFY.DAWN:
        ui.notify(`DAY ${arg}`, 'big', 4);
        ui.notify('You made it. The sun burns the horde - go find those supplies.', 'sub', 4);
        a.stinger?.('dawn');
        break;
      case NOTIFY.HORDE_SOON: {
        ui.notify('THE HORDE IS COMING', 'danger', 5);
        ui.notify('Board up where you stand: door boards, barricades, a campfire.', 'toast', 6);
        // the dawn card said it first; this is the reminder with 45 seconds left (arg = the coming night)
        const th = nightTheme(this.seed, arg);
        if (th) ui.notify(`${th.name} tonight. ${th.warn}`, 'warning', 9);
        break;
      }
      case NOTIFY.BOSS: {
        const zd = ZOMBIE_DEFS[arg];
        ui.notify(zd ? (zd.boss ? '' : 'A ') + zd.name.toUpperCase() : 'SOMETHING', 'big', 4);
        ui.notify('has risen from the woods.', 'sub', 4);
        if (arg === ZTYPE.TANK) ui.notify('Listen for its footsteps. It charges, and it smashes straight through barricades.', 'toast', 7);
        // (the final stand's boss never sees a sunrise: the clock is stopped)
        if (!this.global.finale) ui.notify('Bring it down before sunrise and what it carries is yours. The sun leaves nothing.', 'toast', 7);
        a.stinger?.('boss');
        break;
      }
      case NOTIFY.SHADE:
        ui.notify('A SHADE IS OUT THERE', 'danger', 4);
        ui.notify('It only moves in the dark. Keep a light on it: flashlight, torch, campfire or flare.', 'toast', 7);
        a.playLocal('notify');
        break;
      case NOTIFY.SUPPLY_DROP:
        ui.notify('A supply plane is inbound - follow its smoke trail to the drop.', 'toast', 6);
        a.stinger?.('supply');
        break;
      case NOTIFY.SUPPLY_FOUND:
        ui.notify(`${ITEM_DEFS[arg]?.name || 'A supply'} found! Bring it to the car.`, 'good', 5);
        a.stinger?.('car_part');
        break;
      case NOTIFY.CAR_PART:
        ui.notify(`${ITEM_DEFS[arg]?.name || 'Part'} installed in the car`, 'good', 4);
        a.playLocal('install_part');
        break;
      case NOTIFY.SUPPLIES_DONE:
        ui.notify('EVERY SUPPLY IS IN', 'big', 5);
        ui.notify('Fortify the car. Hold [E] at the car to start the engine - it takes 90 seconds to warm up.', 'sub', 7);
        a.stinger?.('car_part');
        break;
      case NOTIFY.NEED_SUPPLIES:
        ui.notify('The car still needs supplies', 'warning', 2.5);
        break;
      case NOTIFY.CAR_ALARM:
        ui.notify('CAR ALARM!', 'danger', 4);
        ui.notify('The noise is drawing the dead. Move!', 'sub', 4);
        a.stinger?.('boss');
        break;
      case NOTIFY.HERD:
        ui.notify('THE HERD HAS SEEN YOU', 'danger', 4);
        ui.notify(`${arg} of them, all coming at a run. Sprint out of their sight or stand and fight.`, 'sub', 5);
        a.stinger?.('boss');
        break;
      case NOTIFY.ENGINE_START:
        ui.notify('THE FINAL STAND', 'big', 5);
        ui.notify('The engine is warming up. Every corpse in the valley heard it. Stay at the car: it stalls if nobody is there.', 'sub', 6);
        a.stinger?.('boss');
        break;
      case NOTIFY.ESCAPE_READY:
        ui.notify('GET IN THE CAR!', 'big', 5);
        ui.notify('Hold [E] at the car to drive away. Whoever is not at the car is left behind.', 'sub', 7);
        a.stinger?.('car_part');
        break;
      case NOTIFY.SCHEMATIC:
        ui.notify(`${ITEM_DEFS[arg]?.name || 'Schematic'} found - unlocked for the team`, 'good', 5);
        a.playLocal('craft');
        break;
      case NOTIFY.LOCKED:
        ui.notify(`Locked: find the ${ITEM_DEFS[arg]?.name || 'schematic'}`, 'warning', 3);
        a.playLocal('build_fail');
        break;
      case NOTIFY.DOWNED:
        if (arg === this.myId) {
          a.stinger?.('death');
        } else ui.notify(`${this.name(arg)} is down! Hold [E] on them to revive.`, 'danger', 5);
        break;
      case NOTIFY.REVIVED:
        ui.notify(arg === this.myId ? "You're back on your feet." : `${this.name(arg)} is back up.`, 'good', 3);
        break;
      case NOTIFY.YOU_DIED:
        this.deathInfo = { killer: arg === 255 ? 'the wilderness' : ZOMBIE_DEFS[arg]?.name || 'the dead', day: this.global.day, night: this.global.phase === PHASE.NIGHT, dawn: this.dawnAhead() };
        ui.showDeath(this.deathInfo);
        a.stinger?.('death');
        this.deathShown = true;
        break;
      case NOTIFY.PLAYER_DIED:
        if (arg !== this.myId) ui.notify(`${this.name(arg)} has fallen... and will rise as one of them${this.dawnAhead() ? ' until dawn' : ''}.`, 'danger', 5);
        break;
      case NOTIFY.RETURNED:
        if (arg === this.myId) {
          // (the death card is still up if we died in the last seconds of the night)
          if (this.deathShown) ui.hideOverlays();
          this.deathShown = false;
          ui.notify('The sun burns it out of you: you are a survivor again.', 'good', 6);
          ui.notify('You wake with one pistol magazine and a bandage. Your old gear may still lie where you fell.', 'toast', 8);
        } else ui.notify(`${this.name(arg)} is back among the living.`, 'good', 5);
        break;
      case NOTIFY.VICTORY:
        a.stinger?.('victory');
        break;
      case NOTIFY.GAME_OVER:
        a.stinger?.('gameover');
        break;
      case NOTIFY.NEED_FIRE:
        ui.notify('Needs a lit campfire nearby (build one [5])', 'warning', 2.5);
        a.playLocal('build_fail');
        break;
      case NOTIFY.NEED_BENCH:
        ui.notify('Needs a workbench nearby (build one [5])', 'warning', 2.5);
        a.playLocal('build_fail');
        break;
      case NOTIFY.NEED_STATION:
        ui.notify('Requires a crafting station nearby', 'warning', 2.5);
        a.playLocal('build_fail');
        break;
      case NOTIFY.CANT_BUILD_HERE:
        ui.notify("Can't build there", 'warning', 2);
        a.playLocal('build_fail');
        break;
      case NOTIFY.DOOR_ONLY:
        ui.notify('Door boards go in a doorway', 'warning', 2);
        a.playLocal('build_fail');
        break;
      case NOTIFY.STRUCT_CAP:
        ui.notify('Too many structures - demolish some [X]', 'warning', 2.5);
        break;
      case NOTIFY.NOT_ENOUGH: {
        // The server names one item (arg) or nothing at all. What is short, by how much and where it comes from is
        // worked out here: from that item, or from the cost of what was last asked for against what we carry.
        const need = arg ? needLines({ [arg]: 1 }, {}) : needLines(this.askedCost, this.invCounts());
        if (!need.length) ui.notify('Not enough materials', 'warning', 2.5);
        need.forEach((line, i) => ui.notify(line, i ? 'toast' : 'warning', 4.5));
        a.playLocal('build_fail');
        break;
      }
      case NOTIFY.SEARCH_EMPTY:
        ui.notify(arg === 1 ? 'This tree is stripped bare' : arg === 2 ? 'Nothing left to salvage' : 'Already searched', 'toast', 1.6);
        break;
      case NOTIFY.INVENTORY_FULL: {
        // arg: the item a full backpack left lying where the survivor walked over it (0: a craft, a search, a swap)
        const d = ITEM_DEFS[arg];
        if (d?.cat === 'part') {
          ui.notify(`Inventory full - ${d.name} left on the ground! Drop something to make room: right-click a stack in the backpack [I].`, 'danger', 6);
          a.playLocal('build_fail');
        } else ui.notify(d ? `Inventory full - no room for ${d.name}` : 'Inventory full', 'warning', 2);
        break;
      }
      case NOTIFY.CAMPFIRE_LIT:
        ui.notify('The fire roars back to life.', 'good', 2);
        break;
      case NOTIFY.NEW_GAME:
        ui.hideOverlays();
        this.overlay = null;
        this.deathShown = false;
        this.discovered = new Set([ZONE.CAMP]);
        this.stripped.clear();
        this.pings = [];
        this.waypoint = null;
        this.flyover?.clear();
        this.graves?.reset();
        this.introPending = false;
        ui.notify(`DAY ${arg}`, 'big', 5);
        ui.notify('Your car died on Route 9. Find the supplies to fix it - before the dark finds you.', 'sub', 6);
        break;
      case NOTIFY.PLAYER_JOINED:
      case NOTIFY.PLAYER_LEFT:
        break;
      case NOTIFY.GRAVES:
        ui.notify('THE GRAVES ARE STIRRING', 'danger', 5);
        ui.notify('Part of the horde is coming up out of St. Agnes Cemetery. Watch the ground behind you.', 'toast', 7);
        break;
    }
  }

  // Joined a run that is already under way. NEW_GAME, the card that says what the game is, went out before we were
  // here (and on a drop-in server that is how most first-time players arrive), so say it for the moment we arrive
  // in: the goal in one line, the day and phase, and how far the team has got.
  lateJoinIntro() {
    this.introPending = false;
    const g = this.global;
    const ui = this.ui;
    const night = g.phase === PHASE.NIGHT;
    let need = 0;
    let have = 0;
    SUPPLY_NEED.forEach((n, i) => {
      need += n;
      have += Math.min(n, g.supplies[i]);
    });
    ui.notify(g.finale ? 'THE FINAL STAND' : `${night ? 'NIGHT' : 'DAY'} ${g.day}`, 'big', 5);
    if (g.finale) {
      ui.notify('The car is fixed and the engine is warming up. Defend it, then get in.', 'sub', 6);
      ui.notify('You joined a run in progress: every supply is in. Your team is at the car.', 'toast', 8);
      return;
    }
    ui.notify('Your car died on Route 9. Find the supplies, fix it, drive out.', 'sub', 6);
    ui.notify(g.suppliesDone ? 'You joined a run in progress: every supply is in. Starting the engine is next.' : `You joined a run in progress: ${have} of ${need} car supplies are in.`, 'toast', 8);
    let team = 'Your team is marked on the compass. Scavenge with them before dark.';
    if (night) team = 'Night: the horde is out. Find your team on the compass and hold out until dawn.';
    else if (g.suppliesDone) team = 'Your team is marked on the compass. Meet them at the car.';
    else if (g.timeLeft <= DUSK_WARNING) team = 'Night is seconds away. Find your team on the compass and board up with them.';
    ui.notify(team, 'toast', 8);
  }

  remoteShot(ev) {
    if (ev.weapon === MOUNTED_GUN) return this.gun.remoteShot(ev); // (from its muzzle, not from the gunner's hands)
    const def = WEAPONS[ev.weapon];
    if (!def) return;
    const shooter = this.entities.ents.get(ev.shooter);
    let mx = ev.x;
    let my = ev.y - 0.15;
    let mz = ev.z;
    if (shooter?.view) {
      shooter.view.getMuzzleWorld(_v);
      mx = _v.x;
      my = _v.y;
      mz = _v.z;
      _v.set(mx, my, mz);
    } else _v.set(mx, my, mz);
    if (def.flame) return this.flamePuff(ev.shooter, ev, mx, my, mz, def);
    if (!def.quiet) {
      this.effects.worldMuzzle(_v, def.pellets > 1 ? 1.3 : 1);
      this.lights.flashMuzzle(_v, 0.8);
    }
    this.audio.play(SHOT_SOUND[ev.weapon] || SOUND.PISTOL, { x: mx, y: my, z: mz });
    const n = shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, def.pellets, ev.seed, _dirs);
    for (let i = 0; i < n; i++) {
      if (def.pellets > 1 && i % 2) continue;
      const dx = _dirs[i * 3];
      const dy = _dirs[i * 3 + 1];
      const dz = _dirs[i * 3 + 2];
      raycastWorld(this.world, ev.x, ev.y, ev.z, dx, dy, dz, def.range, _ray);
      const dist = _ray.t >= 0 ? _ray.t : Math.min(def.range, 80);
      if (def.quiet) this.effects.boltTrail(mx, my, mz, dx, dy, dz, dist);
      else this.effects.tracer(mx, my, mz, dx, dy, dz, dist, 0.8);
    }
  }

  // One puff of a flamethrower's stream, ours or someone else's: the fire, its light, and the roar while it lasts.
  // (mx,my,mz) = the nozzle; the stream follows the aim from the eye (ev)
  flamePuff(id, ev, mx, my, mz, def) {
    const cp = Math.cos(ev.pitch);
    const dx = -Math.sin(ev.yaw) * cp;
    const dy = Math.sin(ev.pitch);
    const dz = -Math.cos(ev.yaw) * cp;
    raycastWorld(this.world, ev.x, ev.y, ev.z, dx, dy, dz, def.range, _ray);
    const ahead = (mx - ev.x) * dx + (my - ev.y) * dy + (mz - ev.z) * dz; // the nozzle is this far along the stream
    this.effects.flameJet(mx, my, mz, dx, dy, dz, Math.max(0.3, (_ray.t >= 0 ? _ray.t : def.range) - ahead), def.flame.cone);
    _v.set(mx + dx * 1.2, my + dy * 1.2 + 0.25, mz + dz * 1.2);
    this.lights.flashMuzzle(_v, 0.3, 0.12);
    let f = this.flames.get(id);
    if (!f) this.flames.set(id, (f = { loop: this.audio.createLoop?.('flamethrower', mx, my, mz) || null, t: 0 }));
    f.loop?.setPosition(mx, my, mz);
    f.t = 0.2;
  }

  // ---------------------------------------------------------------- local predicted events
  // One pellet of our own shot, judged the way the server will judge it (Combat.fire): against the world (_ray holds
  // that already) and against the hitboxes of the dead where they are drawn - the server rewinds its own to the same
  // moment, so the two agree. What the pellet strikes is shown now (ownImpact) instead of a round trip later, when
  // the server says so. Only the look of it: the damage and the hit marker wait for the server.
  // Returns how far the pellet flies before something stops it, -1 if nothing does.
  predictPellet(ev, def, i, dx, dy, dz) {
    const wall = _ray.t;
    const wallT = wall >= 0 ? wall : def.range;
    const col = _ray.col;
    const terrain = _ray.terrain;
    const hits = _shotHits;
    hits.length = 0;
    for (const e of this.entities.ents.values()) {
      const zdef = e.kind === ENT.ZOMBIE ? ZOMBIE_DEFS[e.ztype] : null;
      if (zdef ? e.dead : e.kind !== ENT.PLAYER || e.id === this.myId || (e.q[5] & (PFLAG.ZOMBIE | PFLAG.DEAD)) !== PFLAG.ZOMBIE) continue;
      // (first by how far the ray passes from it: most of them are nowhere near)
      const rx = e.rx - ev.x;
      const ry = e.ry + 0.8 - ev.y;
      const rz = e.rz - ev.z;
      const along = rx * dx + ry * dy + rz * dz;
      if (along < -1 || along > wallT + 2 || rx * rx + ry * ry + rz * rz - along * along > 16) continue;
      const hb = zdef ? zombieHitbox(zdef, e.ryaw, e.q[7], e.q[4] === ZANIM.AIRBORNE) : playerHitbox(true, !!(e.q[5] & PFLAG.CROUCH));
      _hbPos.x = e.rx;
      _hbPos.y = e.ry;
      _hbPos.z = e.rz;
      const t = rayHitbox(_hbPos, hb, ev.x, ev.y, ev.z, dx, dy, dz, wallT);
      if (t >= 0) hits.push({ t, e });
    }
    hits.sort((a, b) => a.t - b.t);
    const pierce = def.pierce || 1;
    for (let k = 0; k < hits.length && k < pierce; k++) {
      const { t, e } = hits[k];
      const z = e.kind === ENT.ZOMBIE;
      const green = z && (e.ztype === ZTYPE.SPITTER || e.ztype === ZTYPE.BOOMER || e.ztype === ZTYPE.BOSS_HIVEQUEEN);
      // (a shade pinned by light is stone: the bullet chips it)
      this.ownImpact(z && e.q[4] === ZANIM.FROZEN ? IMPACT.DIRT : green ? IMPACT.GREEN_BLOOD : IMPACT.BLOOD, ev.x + dx * t, ev.y + dy * t, ev.z + dz * t, -dx, -dy, -dz);
    }
    if (hits.length) return hits.length >= pierce ? hits[pierce - 1].t : wall;
    // nothing in the way but the world (of a spread, only every third pellet shows there, as the server sends them)
    if (wall >= 0 && (def.pellets === 1 || i % 3 === 0)) {
      let kind = IMPACT.DIRT;
      if (col && !terrain) kind = col.flags & COL.TREE ? IMPACT.WOOD : col.flags & COL.STRUCT ? (this.entities.ents.get(col.id)?.stype === STRUCT.METAL_WALL ? IMPACT.METAL : IMPACT.WOOD) : IMPACT.SPARK;
      this.ownImpact(kind, ev.x + dx * wall, ev.y + dy * wall, ev.z + dz * wall, -dx, -dy, -dz);
    }
    return wall;
  }

  // A round of ours that no weapon in the hands fired (the mounted gun's: its own row `def`, one pellet along
  // dx,dy,dz), judged like any other. Returns how far it flies, -1 if nothing stops it.
  predictShot(ev, def, dx, dy, dz) {
    raycastWorld(this.world, ev.x, ev.y, ev.z, dx, dy, dz, def.range, _ray);
    return this.predictPellet(ev, def, 0, dx, dy, dz);
  }

  // An impact of our own shot, shown as it is fired. The server sends word of the same impact a round trip later,
  // and sameAsOwn drops that one.
  ownImpact(kind, x, y, z, nx, ny, nz) {
    const list = this.ownImpacts || (this.ownImpacts = []);
    if (list.length >= 48) list.shift();
    list.push({ x, y, z, t: this.time });
    this.eventHandler.impact(kind, x, y, z, nx, ny, nz, true);
  }

  // Is this impact from the server one that was shown already (ownImpact)? It is when one of ours from the last two
  // seconds struck within a metre of it: the server judges the shot against the picture we aimed at, so the two land
  // together. That one of ours is then spent. One that is never answered (the server saw a miss) just lapses.
  sameAsOwn(x, y, z) {
    const list = this.ownImpacts;
    if (!list || !list.length) return false;
    while (list.length && this.time - list[0].t > 2) list.shift();
    let best = -1;
    let bd = 1;
    for (let i = 0; i < list.length; i++) {
      const d = Math.hypot(list[i].x - x, list[i].y - y, list[i].z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return false;
    list.splice(best, 1);
    return true;
  }

  onLocalEvents(events, s) {
    const a = this.audio;
    for (const ev of events) {
      switch (ev.type) {
        case 'fire': {
          const def = WEAPONS[ev.weapon];
          this.vm.fire();
          if (def.flame) {
            // a stream of fire, not a shot: it leaves the nozzle, ahead of the eye and low on the right
            this.vm.getMuzzle(_v);
            this.effects.vmMuzzle(_v, 0.55, 0.1);
            this.renderer.vmMuzzle.intensity = 3;
            this.vmMuzzleT = 0.12;
            const cp = Math.cos(ev.pitch);
            const fx = ev.x + Math.cos(ev.yaw) * 0.12 - Math.sin(ev.yaw) * cp * 0.7;
            const fz = ev.z - Math.sin(ev.yaw) * 0.12 - Math.cos(ev.yaw) * cp * 0.7;
            this.flamePuff(-1, ev, fx, ev.y - 0.12 + Math.sin(ev.pitch) * 0.7, fz, def);
            this.camShake = Math.min(1, (this.camShake || 0) + 0.012);
            break;
          }
          a.playLocal(def.sound || 'pistol');
          const kick = SHOT_KICK[ev.weapon];
          if (!def.quiet) {
            this.vm.getMuzzle(_v);
            this.effects.vmMuzzle(_v, kick ? kick[0] : 1);
            this.renderer.vmMuzzle.intensity = 6;
            this.vmMuzzleT = 0.05;
            // world muzzle light at the camera
            _v2.set(-Math.sin(ev.yaw), 0, -Math.cos(ev.yaw));
            _v.set(ev.x + _v2.x * 0.8, ev.y - 0.1, ev.z + _v2.z * 0.8);
            this.lights.flashMuzzle(_v, 1);
          }
          // Tracers from the gun, and what every pellet strikes (predictPellet): the blood or the puff off the wall is
          // shown now, not a round trip later. The damage and the hit marker are still the server's alone
          const n = shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, def.pellets, ev.seed, _dirs);
          const cp = Math.cos(ev.pitch);
          const sx = ev.x + Math.cos(ev.yaw) * 0.12 - Math.sin(ev.yaw) * cp * 0.5;
          const sz = ev.z - Math.sin(ev.yaw) * 0.12 - Math.cos(ev.yaw) * cp * 0.5;
          const sy = ev.y - 0.12 + Math.sin(ev.pitch) * 0.5;
          for (let i = 0; i < n; i++) {
            const dx = _dirs[i * 3];
            const dy = _dirs[i * 3 + 1];
            const dz = _dirs[i * 3 + 2];
            raycastWorld(this.world, ev.x, ev.y, ev.z, dx, dy, dz, def.range, _ray);
            const end = this.predictPellet(ev, def, i, dx, dy, dz);
            if (def.pellets > 1 && i % 2) continue;
            const dist = end >= 0 ? end : Math.min(def.range, 90);
            if (def.quiet) this.effects.boltTrail(sx, sy, sz, dx, dy, dz, dist);
            else if (Math.random() < (def.pellets > 1 ? 1 : 0.6)) this.effects.tracer(sx, sy, sz, dx, dy, dz, dist, 1);
          }
          this.recoilKick += def.recoil * (ev.aiming ? 0.5 : 1) * 1.4;
          this.camShake = Math.min(1, (this.camShake || 0) + (kick ? kick[1] : 0.06));
          break;
        }
        case 'dry':
          a.playLocal('dry');
          break;
        case 'reload': {
          this.vm.reload(ev.time, !!ev.each);
          if (ev.each) a.playLocal('shell_insert');
          else a.playLocal(currentWeapon(s) === ITEM.CROSSBOW ? 'xbow_cock' : 'reload_start');
          break;
        }
        case 'reload_done': {
          const w = currentWeapon(s);
          a.playLocal(w === ITEM.SHOTGUN ? 'pump' : w === ITEM.HUNTING_RIFLE ? 'bolt' : w === ITEM.CROSSBOW ? 'xbow_load' : 'reload_end');
          break;
        }
        case 'melee':
          this.vm.melee(!!ev.heavy);
          a.playLocal(s.zombie ? 'claw' : ev.heavy ? 'swing_heavy' : 'swing');
          break;
        case 'throw':
          this.vm.throwItem();
          a.playLocal('throw');
          break;
        case 'switch':
          a.playLocal('switch', { volume: 0.6 });
          break;
        case 'jump':
          a.playLocal('jump', { volume: 0.5 });
          break;
        case 'land':
          a.playLocal('land'); // the view's dip comes with every landing, see the camera in update()
          break;
        case 'leap':
          a.playLocal('zombie_player_growl');
          break;
        case 'exhausted':
          a.playLocal('breath');
          break;
      }
    }
  }

  // ---------------------------------------------------------------- input
  setupInputHandlers() {
    const inp = this.input;
    inp.handlers.isTyping = () => this.ui.isTyping();
    inp.handlers.onLockChange = (locked) => {
      if (this.state !== 'playing') return;
      if (!locked && !this.ui.inventoryOpen && !this.ui.isTyping() && !this.ui.mapOpen && !this.ui.boardOpen) {
        this.ui.showPause(true);
        inp.enabled = false;
      } else if (locked) {
        this.ui.showPause(false);
        inp.enabled = !this.ui.inventoryOpen && !this.ui.mapOpen && !this.ui.boardOpen;
      }
    };
    inp.handlers.onMouseDown = (button) => {
      if (this.state !== 'playing') return;
      const s = this.prediction.state;
      if (button === 1) return this.ping();
      if (s.slot === SLOT_BUILD && !s.zombie && this.self.alive && !s.downed) {
        if (button === 0) this.tryBuild();
        else if (button === 2) {
          this.buildRot = (this.buildRot - 32) & 255; // 45deg clockwise seen from above (+yaw is counter-clockwise)
          this.audio.playLocal('ui_click', { volume: 0.4 });
        }
      }
    };
    inp.handlers.onKey = (code) => this.onKey(code);
    inp.handlers.onKeyUp = (code) => {
      if (code === 'KeyV' && this.settings.pushToTalk !== false) this.voice.setTransmit(false);
      if (code === 'KeyE') this.endHold();
      if (code === 'Tab') this.showRoster(false);
    };
    inp.handlers.onBlur = () => this.showRoster(false);
  }

  onKey(code) {
    if (this.state !== 'playing') return;
    const s = this.prediction.state;
    const ui = this.ui;
    if (code === 'Tab') {
      this.showRoster(true);
      return;
    }
    if (code === 'KeyI') {
      this.toggleInventory(!ui.inventoryOpen);
      return;
    }
    if (code === 'KeyM') {
      if (ui.inventoryOpen || ui.isTyping()) return;
      this.toggleMap(!ui.mapOpen);
      return;
    }
    if (code === 'Escape' && ui.mapOpen) {
      this.toggleMap(false);
      return;
    }
    if (code === 'KeyL') {
      if (ui.inventoryOpen || ui.isTyping()) return;
      this.toggleBoard(!ui.boardOpen);
      return;
    }
    if (code === 'Escape' && ui.boardOpen) {
      this.toggleBoard(false);
      return;
    }
    // Y as in Half-Life. Input only passes it on while in play; Enter also gets through from the inventory
    // and the pause menu.
    if (code === 'Enter' || code === 'KeyY') {
      // (not from the map: the chat box is hidden under it and could never take the focus, which left
      // every key dead until a reload)
      if (!ui.isTyping() && !ui.mapOpen && !ui.boardOpen) {
        ui.openChat();
        this.input.buttons = 0;
        this.inputBuffer.clear();
      }
      return;
    }
    if (!this.input.enabled) return;
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 }[code];
    if (digit !== undefined) {
      if (digit === SLOT_THROW && s.slot === SLOT_THROW) {
        // cycle to the next throwable we carry
        const counts = this.invCounts();
        const i = THROW_ITEMS.indexOf(s.weapons[SLOT_THROW]);
        for (let k = 1; k <= THROW_ITEMS.length; k++) {
          const it = THROW_ITEMS[(i + k) % THROW_ITEMS.length];
          if (counts[it] && it !== s.weapons[SLOT_THROW]) {
            this.conn.action(ACT.SELECT_THROWABLE, it);
            break;
          }
        }
        return;
      }
      if (digit !== s.slot) this.lastSlot = s.slot;
      this.prediction.requestSlot(digit);
      return;
    }
    // hammer out: Q / E step through the structures, but E still interacts whenever the prompt offers [E]
    const building = s.slot === SLOT_BUILD && !s.zombie;
    switch (code) {
      case 'KeyQ': {
        if (building) {
          this.cycleBuild(-1);
          break;
        }
        const t = this.lastSlot;
        this.lastSlot = s.slot;
        this.prediction.requestSlot(t);
        break;
      }
      case 'KeyF': {
        if (s.zombie) break;
        this.localFlash = !this.localFlash;
        if (this.localFlash && this.self.battery <= 1) this.localFlash = false;
        this.localFlashT = 0.6;
        this.conn.action(ACT.FLASHLIGHT, this.localFlash ? 1 : 0);
        this.audio.playLocal('flashlight');
        break;
      }
      case 'KeyE':
        if (building && !this.prompt?.startsWith('[E]')) this.cycleBuild(1);
        else this.interact();
        break;
      case 'KeyZ':
        this.ping();
        break;
      case 'KeyG':
        if (!s.zombie && s.slot !== SLOT_THROW && s.weapons[s.slot]) this.conn.action(ACT.DROP_WEAPON, s.slot);
        break;
      case 'KeyH':
        this.quickHeal();
        break;
      case 'KeyR':
        if (s.slot === SLOT_BUILD) this.cycleBuild(1);
        break;
      case 'KeyX':
        if (s.slot === SLOT_BUILD && this.lookTarget && this.lookTarget.kind === ENT.STRUCTURE) this.conn.action(ACT.DEMOLISH, this.lookTarget.id);
        break;
      case 'KeyV':
        if (this.settings.pushToTalk !== false) this.voice.setTransmit(true);
        else this.voice.setTransmit(!this.voice.transmitting);
        break;
    }
  }

  toggleInventory(open) {
    const ui = this.ui;
    if (open === ui.inventoryOpen) return;
    if (ui.mapOpen) this.toggleMap(false, false); // the inventory wants the pointer free as well
    if (ui.boardOpen) this.toggleBoard(false, false);
    ui.setCraftContext(this.craftContext());
    ui.setInventoryOpen(open);
    this.input.enabled = !open;
    if (open) this.input.exitLock();
    else this.input.requestLock();
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  // The player list, up for as long as [Tab] is held. Nothing in it takes a click: the pointer stays locked and
  // the game goes on under it.
  showRoster(open) {
    const ui = this.ui;
    if (open === ui.rosterOpen) return;
    if (open) this.pushRoster(); // health as of now, not as of the last player list
    ui.setRosterOpen(open);
  }

  // relock: false when something else that needs the cursor is taking over
  toggleMap(open, relock = true) {
    const ui = this.ui;
    if (open === ui.mapOpen) return;
    if (open && ui.boardOpen) this.toggleBoard(false, false);
    ui.setMapOpen(open);
    this.input.enabled = !open && !ui.inventoryOpen;
    this.input.buttons = 0;
    this.endHold();
    // the map takes clicks (your waypoint), so it frees the pointer the way the inventory does. Clicks made
    // while it is free never reach the weapon: Input only counts a mouse button pressed under the lock.
    if (open) this.input.exitLock();
    else if (relock) this.input.requestLock();
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  // The leaderboard [L]: it takes clicks (which list, which column), so it frees the pointer the way the map does.
  // relock: false when something else that needs the cursor is taking over
  toggleBoard(open, relock = true) {
    const ui = this.ui;
    if (open === ui.boardOpen) return;
    if (open && ui.mapOpen) this.toggleMap(false, false);
    ui.setBoardOpen(open);
    this.input.enabled = !open && !ui.inventoryOpen;
    this.input.buttons = 0;
    this.endHold();
    if (open) {
      this.boardT = 0; // ask the server at once (update)
      this.input.exitLock();
    } else if (relock) this.input.requestLock();
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  // at: { x, z, zone } from a click on the field map (zone: the place it snapped to, or -1), null to clear
  setWaypoint(at) {
    const cur = this.waypoint;
    // a second click on the place that holds it takes it back
    if (!at || (cur && at.zone >= 0 && at.zone === cur.zone)) {
      if (!cur) return;
      this.waypoint = null;
      this.audio.playLocal('ui_click', { volume: 0.35 });
      return;
    }
    const zone = at.zone >= 0 ? this.world.zoneById[at.zone] : null;
    // you have arrived inside a place's yard, or a few steps from a bare spot
    this.waypoint = { x: at.x, y: this.world.heightAt(at.x, at.z), z: at.z, zone: at.zone, r: zone ? zone.flat : WAYPOINT_REACH, visited: !zone || this.discovered.has(at.zone), away: false };
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  // a place lends the waypoint its name once you know it: discovered, or rumoured to hold a supply
  waypointName() {
    const z = this.waypoint.zone;
    return z >= 0 && (this.discovered.has(z) || this.global.hints.includes(z)) ? ZONE_NAMES[z] : 'Waypoint';
  }

  cycleBuild(dir) {
    const i = STRUCT_ORDER.indexOf(this.buildType);
    this.buildType = STRUCT_ORDER[(i + dir + STRUCT_ORDER.length) % STRUCT_ORDER.length];
    this.audio.playLocal('ui_click', { volume: 0.4 });
  }

  quickHeal() {
    const inv = this.inventory.slots;
    const hp = this.self.hp;
    const down = !!this.prediction.state.downed;
    const order = down ? [ITEM.MEDKIT] : hp < 45 ? [ITEM.MEDKIT, ITEM.BANDAGE, ITEM.TUNA, ITEM.PAINKILLERS] : [ITEM.BANDAGE, ITEM.TUNA, ITEM.PAINKILLERS, ITEM.MEDKIT];
    for (const item of order) {
      const idx = inv.findIndex((x) => x && x.item === item);
      if (idx >= 0) {
        this.conn.action(ACT.USE_ITEM, idx);
        this.audio.playLocal(item === ITEM.MEDKIT ? 'heal' : CONSUMABLES[item].food ? 'can_open' : 'bandage');
        this.vm.useItem?.(CONSUMABLES[item].time, item);
        return;
      }
    }
    this.ui.notify(down ? 'No medkit' : 'No healing items', 'warning', 1.5);
  }

  craftContext() {
    const rp = this.renderPos;
    const st = this.entities.stationsNear(rp.x, rp.z, CRAFT_STATION_RADIUS);
    return { fire: st.fire, bench: st.bench, unlocked: this.global.unlocked | 0 };
  }

  // n more of a craft just asked for (a bulk click in the crafting panel, which has counted what the server will take)
  craftRepeat(id, n) {
    const q = this.craftQueue;
    while (n-- > 0 && q.length < 4 * CRAFT_BURST) q.push(id);
    this.sendCrafts(0);
  }

  // sends the waiting crafts the bucket has room for; called every frame to refill it
  sendCrafts(dt) {
    this.craftBudget = Math.min(CRAFT_BURST, this.craftBudget + dt * CRAFT_RATE);
    const q = this.craftQueue;
    while (q.length && this.craftBudget >= 1) {
      this.conn.action(ACT.CRAFT, q.shift());
      this.craftBudget--;
    }
  }

  interact() {
    const t = this.lookTarget;
    const g = this.global;
    if (!t) return;
    if (t === 'gun') return this.gun.use();
    if (t === 'car') {
      if (g.suppliesDone && (!g.finale || g.escapeReady)) this.beginHold(CAR_ID); // start the engine; once it is warm, get in and drive
      else this.conn.action(ACT.INTERACT, CAR_ID);
      return;
    }
    if (t === 'bell' || t === 'radio') return this.fixtures.interact(t);
    if (t.kind === ENT.CACHE || (t.kind === ENT.PLAYER && t.downed)) {
      this.beginHold(t.id);
      return;
    }
    if (t.kind === ENT.STRUCTURE) this.askedCost = REPAIR_COST;
    this.conn.action(ACT.INTERACT, t.id);
  }

  beginHold(id) {
    this.holding = id;
    this.conn.action(ACT.HOLD_BEGIN, id);
  }

  endHold() {
    if (!this.holding) return;
    this.holding = 0;
    this.conn.action(ACT.HOLD_END);
  }

  // [Z] / middle mouse: mark where you look for the team (enemy -> danger, loot -> loot)
  ping() {
    if (!this.world || !this.self.alive) return;
    const cam = this.camera;
    cam.getWorldDirection(_v);
    const ox = cam.position.x;
    const oy = cam.position.y;
    const oz = cam.position.z;
    raycastWorld(this.world, ox, oy, oz, _v.x, _v.y, _v.z, 220, _ray);
    let t = _ray.t >= 0 ? _ray.t : 60;
    let kind = PING_KIND.GO;
    // zombies along the ray
    for (const e of this.entities.ents.values()) {
      if (e.kind !== ENT.ZOMBIE || e.dead) continue;
      const rx = e.rx - ox;
      const ry = e.ry + 1 - oy;
      const rz = e.rz - oz;
      const along = rx * _v.x + ry * _v.y + rz * _v.z;
      if (along < 0 || along > t + 1) continue;
      const px = rx - _v.x * along;
      const py = ry - _v.y * along;
      const pz = rz - _v.z * along;
      if (px * px + py * py + pz * pz < 1.4 * 1.4) {
        t = along;
        kind = PING_KIND.DANGER;
      }
    }
    if (kind === PING_KIND.GO) {
      const e = this.entities.pick(ox, oy, oz, _v.x, _v.y, _v.z, Math.min(t + 1, 60));
      if (e && (e.kind === ENT.ITEM || e.kind === ENT.CACHE || e.kind === ENT.CRATE)) {
        kind = PING_KIND.LOOT;
        t = Math.hypot(e.rx - ox, e.ry - oy, e.rz - oz);
      }
    }
    this.conn.action(ACT.PING, kind, ox + _v.x * t, oy + _v.y * t, oz + _v.z * t);
  }

  tryBuild() {
    const gh = this.ghostPlace;
    if (!gh) return;
    this.askedCost = STRUCT_DEFS[this.buildType].cost; // for NOTIFY.NOT_ENOUGH, should the server refuse
    this.conn.action(ACT.BUILD, this.buildType, gh.x, gh.z, this.buildRot);
  }

  // ---------------------------------------------------------------- UI callbacks
  uiCallbacks() {
    return {
      onCraft: (id) => {
        this.askedCost = RECIPES[id]?.cost;
        this.conn.action(ACT.CRAFT, id);
        this.audio.playLocal('craft', { volume: 0.6 });
      },
      onCraftRepeat: (id, n) => this.craftRepeat(id, n),
      onUseItem: (i) => {
        const it = this.inventory.slots[i];
        this.conn.action(ACT.USE_ITEM, i);
        const c = it && CONSUMABLES[it.item];
        if (!c) return;
        if (c.food) this.audio.playLocal('can_open');
        this.vm.useItem?.(c.time, it.item);
      },
      onDropItem: (i, n) => this.conn.action(ACT.DROP_SLOT, i, n),
      onSplitItem: (i, n) => this.conn.action(ACT.SPLIT_INV, i, n),
      onSwapItems: (a, b) => this.conn.action(ACT.SWAP_INV, a, b),
      onEquipArmor: (i) => this.conn.action(ACT.EQUIP_ARMOR, i),
      onDropWeapon: (slot) => this.conn.action(ACT.DROP_WEAPON, slot),
      onSelectStructure: (t) => (this.buildType = t),
      onSelectThrowable: (item) => this.conn.action(ACT.SELECT_THROWABLE, item),
      onCloseInventory: () => this.state === 'playing' && this.toggleInventory(false),
      onChatSend: (text) => this.devCommand(text) || this.conn.chat(text),
    };
  }

  // dev builds only: preview the weather locally. /weather fog|gale|rain|storm|clear|auto, /lightning [meters]
  devCommand(text) {
    if (!import.meta.env?.DEV) return false;
    const [cmd, arg] = text.trim().split(/\s+/);
    if (cmd === '/weather') {
      this.weather.force = !arg || arg === 'auto' ? null : arg === 'clear' ? { rain: 0, bolts: 0, cloud: 0, fog: 1, wind: 0.3 } : { kind: arg };
      this.ui.notify(`Weather: ${arg || 'auto'}`, 'toast', 2);
      return true;
    }
    if (cmd === '/lightning') {
      this.weather.strikeNear(this.camera.position, +arg || 150, true, this.input.yaw + Math.PI);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    this.frame++;
    this.time += dt;
    const time = this.time;
    // a warm-up ends here, ahead of this frame's draw: when its programs are built, or now if play has begun
    if (this.warm && (this.warm.ready || this.state === 'playing')) this.finishPrewarm();
    if (this.state === 'menu' || !this.world) return this.updateMenu(dt);
    const s = this.prediction.state;
    const self = this.self;
    const inp = this.input;

    // wheel: build type or weapon cycling
    const wheel = inp.consumeWheel();
    if (wheel) {
      if (s.slot === SLOT_BUILD) this.cycleBuild(wheel > 0 ? 1 : -1);
      else if (!s.zombie) {
        const order = [SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE, SLOT_THROW];
        let i = order.indexOf(s.slot);
        for (let k = 0; k < 4; k++) {
          i = (i + (wheel > 0 ? 1 : -1) + 4) % 4;
          const sl = order[i];
          if (sl === SLOT_THROW ? s.throwCount > 0 && s.weapons[SLOT_THROW] : s.weapons[sl]) {
            this.prediction.requestSlot(sl);
            break;
          }
        }
      }
    }
    inp.buildMode = s.slot === SLOT_BUILD && !s.zombie;
    // prediction
    const buttons = this.gun.shape(self.alive ? inp.sample() : 0); // (manning the mounted gun: its trigger, not the weapon's)
    if (!self.alive || !inp.enabled) this.inputBuffer.clear(); // an early press must not outlive a death or a menu
    let attacked = false;
    const onEvents = (evs, st) => {
      for (const ev of evs) if (ev.type === 'fire' || ev.type === 'melee') attacked = true;
      this.onLocalEvents(evs, st);
    };
    const ran = this.prediction.step(dt, buttons, inp.yaw, inp.pitch, onEvents, this.inputBuffer);
    if (ran > 0) inp.clearLatch();
    if (this.gun.commands(ran)) attacked = true; // the mounted gun is fired by the same commands, outside the simulation
    // a packet carries one render time, the one of the frame it leaves in, and the server rewinds its targets to
    // that for every command in the packet: a shot or a swing goes out in its own frame instead of waiting for
    // the batch to fill, or it would be judged against where things stood a frame or two after it was aimed
    for (let out; (out = this.prediction.takeOutbox(dt, attacked)); ) {
      const rt = this.renderTick;
      const rti = Math.floor(rt);
      this.conn.sendInput(rti, rt - rti, out, this.prediction.hash(out));
    }
    this.sendCrafts(dt);
    // interpolation clock: corrections are eased in (a step in the clock is a step in every remote entity),
    // and the render delay widens a little when snapshots arrive unevenly so entities don't stall and lurch
    const adj = this.clockAdj * Math.min(1, dt * 6);
    this.clockAdj -= adj;
    this.clientTick += dt * SERVER_TICK_RATE + adj;
    const extra = Math.min(1.5, Math.max(0, 2.5 * Math.sqrt(this.jitter2) - 0.6));
    this.interpExtra += Math.max(-dt * 0.5, Math.min(dt * 0.5, extra - this.interpExtra));
    this.renderTick = this.clientTick - INTERP_DELAY * SERVER_TICK_RATE - this.interpExtra;

    // camera
    this.prediction.renderPos(dt, this.renderPos);
    const rp = this.renderPos;
    const targetEye = eyeHeight(s);
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * (s.downed ? 5 : 12));
    const hspeed = Math.hypot(s.vx, s.vz);
    if (s.onGround && hspeed > 0.5) this.camBob += dt * hspeed * (s.downed ? 3.2 : 1.9);
    // Every landing dips the view, by how hard it was: with the square of the fall speed (so with the height
    // fallen) from 4 cm after a jump up to the 12 cm of a hard landing, the one the simulation calls `land`
    // (9 m/s and up), which is this same dip and not another on top. "Weapon look sway" off is the one way a
    // player has to ask for less motion, so then only that hard landing dips, as it always has.
    if (!self.alive) this.fallV = 0;
    else if (!s.onGround) this.fallV = -s.vy;
    else {
      if (this.fallV > 9 || (this.fallV > 0 && this.settings.weaponSway !== false)) this.landVel += 0.12 * Math.min(1, (this.fallV / 9) ** 2) * LAND_SPRING * Math.E;
      this.fallV = 0;
    }
    // (a critically damped spring, solved exactly: a kick of d * LAND_SPRING * e bottoms out d below, 1 / LAND_SPRING s later)
    const landA = (this.landVel + LAND_SPRING * this.landDip) * dt;
    const landE = Math.exp(-LAND_SPRING * dt);
    this.landDip = Math.min(0.12, (this.landDip + landA) * landE); // two touchdowns in a row (a correction) don't add up
    this.landVel = (this.landVel - LAND_SPRING * landA) * landE;
    // a step up or down reaches the eye over ~100 ms (Prediction.viewLag), with the eye kept 0.3 m clear of the floor
    const stepLag = this.prediction.viewLag(dt, this.eyeH - 0.3);
    // a heavy footfall drops the view and rattles it, then dies away in ~0.4 s however faint it was: far off it is a
    // tremor that lasts as long as the jolt of one landing beside you
    this.quake *= Math.exp(-dt * 6);
    const bobY = Math.sin(this.camBob * 2) * (s.downed ? 0.06 : 0.035) * Math.min(1, hspeed / 5) - this.landDip - stepLag - this.quake * 0.03;
    this.recoilKick *= Math.exp(-dt * 10);
    this.camShake = Math.max(0, (this.camShake || 0) - dt * 2.5);
    const shake = this.camShake * 0.02 + this.effects.shake * 0.03 + this.quake * 0.02;
    const cam = this.camera;
    if (this.debugCam) {
      const d = this.debugCam;
      cam.position.set(d.x, d.y, d.z);
      cam.rotation.set(d.pitch, d.yaw, 0);
    } else if (self.alive) {
      cam.position.set(rp.x, rp.y + this.eyeH + bobY, rp.z);
      const roll = s.downed ? 0.18 + Math.sin(time * 1.3) * 0.03 : 0;
      cam.rotation.set(inp.pitch + this.recoilKick + (Math.random() - 0.5) * shake, inp.yaw + (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.5 + roll);
    } else {
      // death cam: slumped on the ground looking up
      cam.position.set(rp.x, rp.y + 0.35, rp.z);
      cam.rotation.set(0.9, inp.yaw, 0.4);
    }
    // ADS zoom
    const wdef = WEAPONS[currentWeapon(s)];
    const aiming = self.alive && !!(buttons & 256) && wdef && !wdef.melee && s.reloadT <= 0;
    const baseFov = this.settings.fov || 75;
    const targetFov = aiming ? baseFov * (currentWeapon(s) === ITEM.HUNTING_RIFLE ? 0.45 : 0.78) : s.sprinting ? baseFov * 1.06 : baseFov;
    this.fovCur += (targetFov - this.fovCur) * Math.min(1, dt * 12);
    if (Math.abs(cam.fov - this.fovCur) > 0.01) {
      cam.fov = this.fovCur;
      cam.updateProjectionMatrix();
    }
    // look sensitivity follows the zoom as it eases in and out (see AIM_SENS), so the turn rate never steps mid-turn.
    // The sprint fov is wider than the hip one and must not speed the turn up; settled at the hip it is the setting alone
    this.aimT += ((aiming ? 1 : 0) - this.aimT) * Math.min(1, dt * 12);
    if (!aiming && this.aimT < 0.001) this.aimT = 0;
    const zoom = this.aimT > 0 ? Math.min(1, Math.tan((this.fovCur * Math.PI) / 360) / Math.tan((baseFov * Math.PI) / 360)) : 1;
    inp.sensitivity = (this.settings.sensitivity || 1) * zoom * (1 + (AIM_SENS * (this.settings.aimSensitivity || 1) - 1) * this.aimT);

    // viewmodel
    const weaponNow = s.zombie ? -2 : self.alive ? currentWeapon(s) : 0;
    if (weaponNow !== this.vmItem) {
      this.vmItem = weaponNow;
      if (weaponNow === -2) this.vm.setItem(0, { claws: true });
      else this.vm.setItem(s.slot === SLOT_BUILD && !weaponNow ? 0 : weaponNow);
    }
    const [ldx, ldy] = inp.consumeLook();
    this.vm.setVisible(self.alive && !this.ui.inventoryOpen && !this.ui.mapOpen && !this.ui.boardOpen && !this.debugCam && !this.gun.manning);
    const lk = this.settings.weaponSway === false ? 0 : 0.0022 * inp.sensitivity;
    this.vm.update(dt, { speed: hspeed, sprint: !!s.sprinting, onGround: !!s.onGround, crouch: !!s.crouch, aiming, lookDX: ldx * lk, lookDY: ldy * lk, time, loaded: s.mags[0] > 0 });
    if (this.vmMuzzleT > 0) {
      this.vmMuzzleT -= dt;
      if (this.vmMuzzleT <= 0) this.renderer.vmMuzzle.intensity = 0;
    }
    // a flamethrower's roar stops a moment after its last puff
    for (const [id, f] of this.flames) {
      if ((f.t -= dt) > 0) continue;
      f.loop?.stop();
      this.flames.delete(id);
    }

    // local footsteps
    if (self.alive && s.onGround && hspeed > 1) {
      this.stepAcc += hspeed * dt;
      const stride = s.sprinting ? 2.6 : s.crouch ? 1.4 : 2.1;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.audio.footstep(this.surfaceAt(rp.x, rp.y, rp.z), undefined, undefined, undefined, s.crouch ? 0.25 : s.sprinting ? 0.8 : 0.5, { crouch: !!s.crouch, run: !!s.sprinting });
      }
    }

    // flashlight: local prediction, server authoritative after a moment
    if (this.localFlashT > 0) this.localFlashT -= dt;
    else this.localFlash = !!self.flashlight;

    // entities
    this.entities.update(dt, this.renderTick, time, rp);
    this.gun.update(dt, ldx * lk, ldy * lk);

    // interaction target
    this.updateLookTarget();
    this.updateBuildGhost(s);

    // discovery of places
    this.discoverT -= dt;
    // (a drift of the mine runs under places it does not come up in)
    if (this.discoverT <= 0 && self.alive && !s.zombie && !this.world.mine?.under(rp.x, rp.y + 0.3, rp.z)) {
      this.discoverT = 0.5;
      for (const z of this.world.zones) {
        if (this.discovered.has(z.id)) continue;
        if (Math.hypot(rp.x - z.x, rp.z - z.z) < z.flat + 6) {
          this.discovered.add(z.id);
          this.ui.notify(`Discovered · ${ZONE_NAMES[z.id]}`, 'toast', 3.5);
        }
      }
    }
    // the waypoint has done its job once you are there
    const wp = this.waypoint;
    if (wp && self.alive && !s.zombie) {
      const d = Math.hypot(rp.x - wp.x, rp.z - wp.z);
      if (d > wp.r + 2) wp.away = true; // (set where you already stand, it waits until you have left and come back)
      else if (wp.away && d < wp.r) {
        this.waypoint = null;
        // a place seen for the first time has just said so itself ("Discovered")
        if (wp.visited) this.ui.notify(wp.zone >= 0 ? `Arrived · ${ZONE_NAMES[wp.zone]}` : 'Waypoint reached', 'toast', 2.5);
      }
    }
    this.pings = this.pings.filter((p) => time - p.t < PING_LIFE);

    // environment
    const g = this.global;
    const cycle = this.debugCycle ?? Environment.cycleFor(g.phase, g.timeLeft, g.day, g.phaseLen);
    if (!g.finale) this.global.timeLeft = Math.max(0, g.timeLeft - dt);
    else if (!g.escapeStalled) this.global.escapeT = Math.max(0, g.escapeT - dt); // a stalled warm-up stands still
    const weather = this.weather.update(dt, g, time, cam.position);
    if (weather.kind !== this.weatherKind) {
      this.weatherKind = weather.kind;
      const say = WEATHER_TOAST[weather.kind];
      if (say && time - (this.weatherToastT ?? -1e9) > 45 && self.alive) {
        this.weatherToastT = time;
        this.ui.notify(say, 'toast', 3.5);
      }
    }
    // how far down the mine the eye is, 0 in daylight .. 1 a dozen metres down a drift: the sky's light goes out
    // with it (Environment), and so do the rain and the wind (below)
    const mine = this.world.mine;
    const deep = mine && mine.under(rp.x, rp.y + 0.3, rp.z) ? Math.min(1, Math.max(0, (mine.depth(rp.x, rp.z) - 2) / 11)) : 0;
    // (the same in a boarded-up ward of the clinic, as far as it is dark where the eye is: world.darkAt)
    const dark = Math.max(deep, this.world.darkAt(rp.x, rp.y + 1, rp.z));
    this.under += (dark - this.under) * Math.min(1, dt * 4);
    if (this.under < 0.002) this.under = 0;
    this._envOver.under = this.under;
    this.env.update(dt, cycle, cam.position, time, weather, this._envOver);
    this.staticWorld.update(cam.position, this.env.fogVisibility + 40);
    this.foliage.update(cam.position, this.env.fogVisibility, time, weather);
    if (this.water) {
      const u = this.water.material.uniforms;
      u.uTime.value = time;
      u.uSky.value.copy(this.env.cur.horizon);
      u.uSunDir.value.copy(this.env.sunHeight > -0.05 ? this.env.uniforms.uSunDir.value : this.env.uniforms.uMoonDir.value);
      u.uSunCol.value.copy(this.env.cur.dir);
      u.uCam.value.copy(cam.position);
    }
    const fires = this.entities.fireSources.concat(this.staticFires);
    this.lights.update(dt, time, cam.position, this.localFlash && self.alive && !s.zombie, fires, this.entities.remoteFlash, Math.max(this.env.night, this.under));
    // nearest big fire warms the viewmodel & the ambience
    let nearFire = 0;
    for (const f of fires) {
      if (!f.big || !(f.intensity > 0)) continue;
      nearFire = Math.max(nearFire, Math.max(0, 1 - Math.hypot(rp.x - f.x, rp.z - f.z) / 14) * f.intensity);
    }
    // viewmodel lighting follows the world
    this.updateViewmodelLight(dt, cam, nearFire);
    this.renderer.vmFlash.intensity = this.localFlash && self.alive ? 0.35 : 0;

    this.effects.setAmbient(Math.max(this.env.night, this.under)); // (down the mine it is night at noon)
    this.effects.update(dt, cam, this.renderer.renderer.domElement.height);
    this.flyover.update(dt, time, cam, this.env, weather);
    this.graves.update(dt);
    const flashOn = this.localFlash && self.alive && !s.zombie;
    // (no rain or blown leaves once the eye is well down a drift: what falls in the mouth is kept out by its roof)
    const sky = this.under > 0.5 ? Object.assign(this._wxDown, weather, DOWN_WEATHER) : weather;
    this.atmosphere.update(dt, time, cam, this.env, flashOn, this.world.heightAt, sky);
    this.weatherFx.update(dt, time, cam, sky, this.env, flashOn, this.renderer.renderer.domElement.height);

    // audio
    const a = this.audio;
    a.setListener(cam.position.x, cam.position.y, cam.position.z, inp.yaw, inp.pitch);
    let danger = 0;
    for (const e of this.entities.ents.values()) {
      if (e.kind !== ENT.ZOMBIE || e.dead) continue;
      const d = Math.hypot(e.rx - rp.x, e.rz - rp.z);
      if (d < 25) danger = Math.max(danger, 1 - d / 25);
    }
    this.danger = (this.danger || 0) + (danger - (this.danger || 0)) * Math.min(1, dt * 2);
    const hpFrac = self.maxHp ? self.hp / self.maxHp : 1;
    a.setAmbience({
      night: this.env.night,
      horde: (g.phase === PHASE.NIGHT && g.hordeLeft > 0) || g.finale,
      boss: !!g.bossId,
      danger: this.danger,
      lowHealth: self.alive && !self.zombie ? (s.downed ? 1 : Math.max(0, 1 - hpFrac / 0.35)) : 0,
      nearFire,
      rain: weather.rain,
      wind: weather.wind,
      underCover: weather.cover,
      dead: !self.alive,
      menu: false,
      cycle: this.env.cycle,
      open: this.openness,
      indoor: Math.max(this.indoor, this.under),
    });

    // overlays by phase
    this.updateOverlays();
    // HUD
    this.updateHud(dt, s, aiming, wdef);
    this.keyHints.update(dt);
    if (this.ui.mapOpen) this.updateMap(s);
    // the leaderboard is asked for while it is up: as it opens, then every few seconds (it moves as people play)
    if (this.ui.boardOpen && performance.now() >= this.boardT) {
      this.boardT = performance.now() + BOARD_EVERY;
      this.conn.board();
    }
    // voice talking indicators
    if (this.frame % 6 === 0) {
      const talking = this.voice.poll();
      const key = talking.map((id) => (this.voice.overRadio(id) ? 'r' : '') + id).join();
      if (key !== this.talkKey) {
        // squelch as somebody keys up on the radio
        if (talking.some((id) => this.voice.overRadio(id) && !this.talkPeers.includes(id))) this.audio.playLocal?.('radio', { volume: 0.5 });
        this.talkKey = key;
        this.talkPeers = talking;
        this.ui.setVoiceState({ enabled: this.voice.enabled, transmitting: this.voice.transmitting, speakers: this.speakers() });
      }
    }
    // post
    this.damageFx = Math.max(0, this.damageFx - dt * 1.5);
    const lowHealth = self.alive && !self.zombie ? (s.downed ? 1 : Math.max(0, 1 - hpFrac / 0.3)) : 0;
    this.post = {
      time,
      night: this.env.night,
      damage: this.damageFx,
      lowHealth,
      infected: self.zombie ? 1 : 0,
      dead: self.alive ? (s.downed ? 0.35 : 0) : 1,
      exposure: this.env.exposure * (self.zombie ? 1.6 : 1),
      rays: this.env.rays,
      beam: this.beamState(),
      adaptRef: self.alive ? this.env.adaptRef : 0,
      dt,
    };
  }

  updateMenu(dt) {
    if (!this.world) return;
    this.menuAngle += dt * 0.04;
    const car = this.world.car;
    const cam = this.camera;
    const r = 15;
    const gy = this.world.heightAt(car.x, car.z);
    cam.position.set(car.x + Math.sin(this.menuAngle) * r, gy + 3.4, car.z + Math.cos(this.menuAngle) * r);
    cam.lookAt(car.x, gy + 1.2, car.z);
    const weather = this.weather.update(dt, null, this.time, cam.position);
    this.env.update(dt, 0.49, cam.position, this.time, weather);
    this.staticWorld.update(cam.position, this.env.fogVisibility + 40);
    this.foliage.update(cam.position, this.env.fogVisibility, this.time, weather);
    this.lights.update(dt, this.time, cam.position, false, this.staticFires, [], this.env.night);
    this.effects.update(dt, cam, this.renderer.renderer.domElement.height);
    this.atmosphere.update(dt, this.time, cam, this.env, false, this.world.heightAt, weather);
    this.weatherFx.update(dt, this.time, cam, weather, this.env, false, this.renderer.renderer.domElement.height);
    this.vm.setVisible(false);
    if (this.audio.ready) {
      this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.menuAngle + Math.PI, 0);
      this.audio.setAmbience({ night: 0.6, horde: false, boss: false, danger: 0, lowHealth: 0, nearFire: 0, dead: false, menu: true });
    }
    this.post = { time: this.time, night: this.env.night, damage: 0, lowHealth: 0, infected: 0, dead: 0, exposure: this.env.exposure, rays: this.env.rays };
  }

  // a lightning strike's light reached us: the bolt now, its thunder when the sound gets here
  onLightning(s) {
    this.weatherFx?.strike(s, this.camera.position);
    this.audio.thunder(s.x, s.z, s.dist, s.delay);
  }

  updateOverlays() {
    const g = this.global;
    if (g.phase === PHASE.GAMEOVER && this.overlay !== 'gameover') {
      this.overlay = 'gameover';
      this.ui.setMapOpen(false);
      this.ui.setBoardOpen(false);
      const kills = [...this.players.values()].map((p) => ({ name: p.name, kills: p.kills }));
      this.ui.showGameOver({ days: g.day, kills, reason: 'Every survivor has fallen.', restartIn: Math.ceil(g.restartT), record: this.runReport });
    } else if (g.phase === PHASE.VICTORY && this.overlay !== 'victory') {
      this.overlay = 'victory';
      this.ui.setMapOpen(false);
      this.ui.setBoardOpen(false);
      const kills = [...this.players.values()].map((p) => ({ name: p.name, kills: p.kills }));
      // The run is won for everyone, but the car took whoever was at it: a survivor further off than ESCAPE_RADIUS
      // when it left stayed in the valley, and so did the players who had already turned.
      const car = this.world.car;
      let title = 'You escaped';
      let reason = 'The engine roars. You tear down Route 9 and leave the valley behind.';
      if (!this.self.alive || this.prediction.state.zombie) {
        title = 'They escaped';
        reason = 'The engine roars and the car is gone down Route 9. You stay in the valley with the rest of the dead.';
      } else if (Math.hypot(this.renderPos.x - car.x, this.renderPos.z - car.z) > ESCAPE_RADIUS) {
        title = 'Left behind';
        reason = 'The car tears down Route 9 without you. The others made it out of the valley.';
      }
      this.ui.showVictory({ days: g.day, kills, title, reason, restartIn: Math.ceil(g.restartT), record: this.runReport });
    } else if ((g.phase === PHASE.DAY || g.phase === PHASE.NIGHT) && (this.overlay === 'gameover' || this.overlay === 'victory')) {
      this.overlay = null;
      this.ui.hideOverlays();
    }
    // death overlay clears when we rise as a zombie
    if (this.deathShown && this.self.alive && this.self.zombie) {
      this.deathShown = false;
      this.ui.hideOverlays();
      this.ui.notify('YOU HAVE RISEN', 'big', 4);
      this.ui.notify(this.dawnAhead() ? 'Hunt the survivors until dawn. [RMB] to leap.' : 'Hunt the survivors. [RMB] to leap.', 'sub', 4);
    }
  }

  surfaceAt(x, y, z) {
    const w = this.world;
    if (w.mine && w.mine.under(x, y + 0.3, z)) return 'dirt'; // (the floor of a drift)
    const th = w.heightAt(x, z);
    if (y > th + 0.08) return 'wood';
    if (th < WATER_LEVEL + 0.3) return 'water';
    if (th < WATER_LEVEL + 1.1) return 'mud';
    if (w.roadDistAt(x, z) < 2.8) {
      const i = Math.round((x + MAP_HALF) / GRID_STEP);
      const j = Math.round((z + MAP_HALF) / GRID_STEP);
      return w.roadKind[j * GRID_N + i] === 2 ? 'road' : 'dirt';
    }
    // needle / leaf litter under a crown
    for (const c of w.staticGrid.query(x, z, 3, _near)) {
      if (c.flags & COL.TREE && (c.x - x) ** 2 + (c.z - z) ** 2 < 9) return c.tv === 5 ? 'leaves' : 'forest';
    }
    return 'grass';
  }

  updateLookTarget() {
    const cam = this.camera;
    const s = this.prediction.state;
    this.lookTarget = null;
    this.prompt = null;
    if (!this.self.alive || s.zombie || s.downed) return;
    if (this.gun.look(true)) return; // hands on the mounted gun: [E] is the gun's
    cam.getWorldDirection(_v);
    const ox = cam.position.x;
    const oy = cam.position.y;
    const oz = cam.position.z;
    const e = this.entities.pick(ox, oy, oz, _v.x, _v.y, _v.z, INTERACT_REACH, this.renderPos.y + EYE_HEIGHT);
    const counts = this.invCounts();
    const g = this.global;
    if (e) {
      if (e.kind === ENT.ITEM) {
        const d = ITEM_DEFS[e.item];
        this.lookTarget = e;
        const n = e.q[3];
        this.prompt = `[E] Pick up ${d?.name || 'item'}${n > 1 ? ` ×${n}` : ''}`;
        return;
      }
      if (e.kind === ENT.CACHE) {
        this.lookTarget = e;
        const name = CONT_DEFS[e.ctype]?.name || 'Container';
        this.prompt = e.q[3] === 0 ? `[E] Hold to search ${name}` : `${name} · searched`;
        return;
      }
      if (e.kind === ENT.PLAYER && e.downed) {
        this.lookTarget = e;
        this.prompt = `[E] Hold to revive ${this.name(e.id)}`;
        return;
      }
      if (e.kind === ENT.CRATE) {
        this.lookTarget = e;
        this.prompt = '[E] Open supply crate';
        return;
      }
      if (e.kind === ENT.STRUCTURE) {
        this.lookTarget = e;
        const def = STRUCT_DEFS[e.stype];
        const hp = e.q[3] / 255;
        if (e.stype === STRUCT.CAMPFIRE) {
          const lit = e.q[4] === 1;
          const w = counts[ITEM.WOOD] || 0;
          const st = counts[ITEM.STICK] || 0;
          this.prompt = w || st ? `[E] ${lit ? 'Feed' : 'Relight'} the fire (${w ? `${w} Planks` : `${st} Sticks`})` : lit ? 'Campfire · feed it Planks or Sticks' : 'The fire is out · needs Planks or Sticks';
          if (s.slot === SLOT_BUILD) this.prompt += ' · [X] Remove';
        } else if (s.slot === SLOT_BUILD) {
          if (e.stype === STRUCT.TORCH) this.prompt = hp < 1 || e.q[4] === 0 ? '[E] Relight torch (1 Cloth) · [X] Remove' : '[X] Remove torch';
          else this.prompt = hp < 0.99 ? `[E] Repair ${def.name} (1 Planks, 1 Nails) · [X] Demolish` : `[X] Demolish ${def.name}`;
        } else if (def.station === 'bench') this.prompt = 'Workbench · craft here [I]';
        this.contextStructure = { name: def.name, hp };
        return;
      }
    }
    if (this.gun.look(false)) return; // at the grips of the mounted gun
    // the bell rope, the radio set
    if (this.fixtures.look(ox, oy, oz, _v.x, _v.y, _v.z, this.renderPos.y + EYE_HEIGHT, counts)) return;
    // the car
    const car = this.world.car;
    const dcar = Math.hypot(this.renderPos.x - car.x, this.renderPos.z - car.z);
    if (dcar < CAR_REACH) {
      this.lookTarget = 'car';
      const missing = SUPPLIES.filter((p, i) => g.supplies[i] < SUPPLY_NEED[i]);
      const carrying = missing.filter((p) => counts[p]);
      if (g.finale) this.prompt = g.escapeReady ? '[E] Hold to get in and drive away' : 'Defend the car until the engine is warm';
      else if (!missing.length) this.prompt = '[E] Hold to start the engine (final stand)';
      else if (carrying.length) this.prompt = `[E] Install ${carrying.map((p) => ITEM_DEFS[p].name).join(', ')}`;
      else this.prompt = `The car needs: ${missing.map((p) => ITEM_DEFS[p].name).join(', ')}`;
    }
    // nothing to interact with: a tree or a wreck within a swing's reach says what hitting it gives
    if (!this.prompt) this.prompt = harvestPrompt(this.world, s, this.stripped);
  }

  updateBuildGhost(s) {
    const active = s.slot === SLOT_BUILD && !s.zombie && this.self.alive && !s.downed;
    for (const k in this.ghosts) this.ghosts[k].visible = false;
    this.ghostPlace = null;
    if (!active) {
      this.ui.setBuildMenu(null);
      return;
    }
    let gh = this.ghosts[this.buildType];
    if (!gh) {
      gh = createGhost(this.buildType);
      this.scene.add(gh);
      this.ghosts[this.buildType] = gh;
    }
    const cam = this.camera;
    cam.getWorldDirection(_v);
    const ox = cam.position.x;
    const oy = cam.position.y;
    const oz = cam.position.z;
    let t = this.world.rayTerrain(ox, oy, oz, _v.x, _v.y, _v.z, 7);
    if (t < 0) t = 5; // aim at the ground 5m ahead
    let x = ox + _v.x * t;
    let z = oz + _v.z * t;
    let rotY = (this.buildRot / 256) * Math.PI * 2;
    const def = STRUCT_DEFS[this.buildType];
    let reason = '';
    // on the ground of the level the builder is on: down in the mine the floor of the drift (aimed at its wall, the
    // piece stands in front of it), and nothing goes up on one level from the other (Game.build on the server)
    const mine = this.world.mine;
    const here = !!mine && mine.under(s.x, s.y + 0.3, s.z);
    if (here) {
      _spot.x = x;
      _spot.y = s.y;
      _spot.z = z;
      mine.confine(_spot, 0.5);
      x = _spot.x;
      z = _spot.z;
    }
    let y = this.world.floorAt(x, z, s.y + 0.5);
    if (mine && here !== mine.under(x, y + 0.3, z)) reason = 'Obstructed';
    if (def.snap === 'door') {
      // door boards: aim near a doorway (look along the ray a bit further for walls)
      let o = this.world.openingNear(x, z, 1.4);
      if (!o) {
        raycastWorld(this.world, ox, oy, oz, _v.x, _v.y, _v.z, BUILD_REACH, _ray);
        if (_ray.t >= 0) o = this.world.openingNear(ox + _v.x * _ray.t, oz + _v.z * _ray.t, 1.6);
      }
      if (o) {
        x = o.x;
        z = o.z;
        y = o.y;
        rotY = o.ry;
      } else reason = 'Aim at a doorway';
    }
    gh.position.set(x, y, z);
    gh.rotation.y = rotY;
    gh.visible = true;
    const counts = this.invCounts();
    let afford = true;
    for (const k in def.cost) if ((counts[k] || 0) < def.cost[k]) afford = false;
    const unlocked = this.global.unlocked | 0;
    const car = this.world.car;
    if (!reason && def.schem && !(unlocked & (1 << SCHEM_BIT[def.schem]))) reason = `Locked · find the ${ITEM_DEFS[def.schem].name}`;
    if (!reason && Math.hypot(x - this.renderPos.x, z - this.renderPos.z) > BUILD_REACH + (def.snap ? 1 : 0)) reason = 'Too far';
    if (!reason && Math.hypot(x - car.x, z - car.z) < 3.2) reason = 'Too close to the car';
    if (!reason && this.world.isDeepWater(x, z)) reason = 'In the water';
    if (!reason && this.buildBlocked(def, x, y, z, rotY)) reason = 'Obstructed';
    if (!reason && !afford) reason = 'Not enough materials';
    const valid = !reason;
    gh.userData.setValid?.(valid);
    this.ghostPlace = { x, z };
    this.ui.setBuildMenu({ selected: this.buildType, rotate: Math.round((((256 - this.buildRot) & 255) / 256) * 360), counts, valid, reason, unlocked });
  }

  // same overlap rules the server applies when placing a structure
  buildBlocked(def, x, y, z, yaw) {
    const col = makeBox(x, z, y - 0.3, y + def.sy, def.sx, def.sz, yaw, def.block ? COL.STRUCT : COL.STRUCT | COL.NOBLOCK);
    const tmp = this._bq || (this._bq = []);
    const down = !!this.world.mine?.under(x, y + 0.3, z); // (what stands on the ground over a drift is not in the way)
    if (!def.snap) {
      this.world.staticGrid.query(x, z, col.r + 0.2, tmp);
      for (const o of tmp) {
        if (o.y1 < y + 0.2 || (down && o.y0 > y + def.sy + 0.5)) continue;
        if (overlapBoxes(col, o)) return true;
      }
    }
    this.world.structGrid.query(x, z, col.r + 0.2, tmp);
    for (const o of tmp) {
      const bothBlock = !(o.flags & COL.NOBLOCK) && def.block;
      const bothTrap = o.flags & COL.NOBLOCK && !def.block;
      if ((bothBlock || bothTrap) && overlapBoxes(col, o, -0.05)) return true;
    }
    return false;
  }

  // world -> screen (px). returns false when behind the camera
  project(x, y, z, out) {
    _p.set(x, y, z).project(this.camera);
    if (_p.z > 1) return false;
    out.x = (_p.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-_p.y * 0.5 + 0.5) * window.innerHeight;
    return true;
  }

  updateHud(dt, s, aiming, wdef) {
    const self = this.self;
    const g = this.global;
    const rp = this.renderPos;
    const h = this.hud || (this.hud = { crosshair: { spread: 10, visible: true }, weapons: [0, 0, 0, 0, 0] });
    h.hp = self.hp;
    h.maxHp = self.maxHp;
    h.armor = self.armor;
    h.armorMax = self.armorMax;
    h.stamina = s.stamina;
    h.exhausted = !!s.exhausted;
    h.flashlight = self.battery;
    h.flashlightOn = this.localFlash;
    h.zombie = !!s.zombie;
    h.ability = s.zombie ? Math.max(0, Math.min(1, 1 - s.leapCd / 4.5)) : 1;
    h.slot = s.slot;
    for (let i = 0; i < 5; i++) h.weapons[i] = s.weapons[i];
    h.throwItem = s.weapons[SLOT_THROW];
    h.throwCount = s.throwCount;
    const w = currentWeapon(s);
    const def = WEAPONS[w];
    if (def && !def.melee) {
      h.mag = s.mags[s.slot === SLOT_PRIMARY ? 0 : 1];
      h.reserve = s.ammo[def.ammo];
      h.reloading = s.reloadT > 0 ? 1 - s.reloadT / def.reload : -1;
    } else if (s.slot === SLOT_THROW) {
      h.mag = s.throwCount;
      h.reserve = null;
      h.reloading = -1;
    } else {
      h.mag = null;
      h.reserve = null;
      h.reloading = -1;
    }
    this.gun.hud(h); // (manning the mounted gun: its belt)
    h.phase = g.phase;
    h.day = g.day;
    h.timeLeft = g.timeLeft;
    h.night = this.env.night;
    h.hordeLeft = g.hordeLeft;
    h.wave = g.wave;
    h.waves = g.waves;
    h.finale = g.finale;
    h.escapeT = g.escapeT;
    h.escapeReady = g.escapeReady;
    h.escapeStalled = g.escapeStalled;
    h.escapeLeaving = g.escapeLeaving;
    const boss = g.bossId ? this.entities.ents.get(g.bossId) : null;
    h.boss = boss ? { name: ZOMBIE_DEFS[boss.ztype].name, hp: boss.q[5] / 255 } : null;
    h.prompt = this.prompt;
    // dynamic crosshair
    let spread = 10;
    if (def && !def.melee) {
      const sp = Math.hypot(s.vx, s.vz);
      const ang = def.spread + def.moveSpread * Math.min(1, sp / 4.6) + Math.min(s.recoil, 10) * def.spread * 0.35 + (s.onGround ? 0 : 0.05);
      spread = 6 + (ang * (s.crouch ? 0.7 : 1) * window.innerHeight) / ((this.camera.fov * Math.PI) / 180);
    }
    h.crosshair.spread = Math.min(80, spread);
    h.crosshair.visible = !aiming && self.alive && !this.ui.inventoryOpen && !this.ui.mapOpen;
    // progress ring: consumables or hold-to-interact
    if (self.holdKind) {
      h.useProgress = self.holdProgress;
      const t = this.entities.ents.get(this.holding);
      h.useLabel = self.holdKind === HOLD.SEARCH ? `Searching${t ? ' ' + (CONT_DEFS[t.ctype]?.name || '').toLowerCase() : ''}…` : self.holdKind === HOLD.REVIVE ? `Reviving ${t ? this.name(t.id) : ''}…` : self.holdKind === HOLD.DRIVE ? 'Getting in…' : 'Starting the engine…';
      h.useLabel = this.fixtures.holdLabel(self.holdKind) || h.useLabel;
    } else {
      h.useProgress = self.useItem ? self.useProgress : -1;
      h.useLabel = self.useItem ? `${CONSUMABLES[self.useItem]?.food ? 'Eating' : 'Using'} ${ITEM_DEFS[self.useItem]?.name || ''}` : '';
    }
    // context panel
    const car = this.world.car;
    const counts = this.invCounts();
    let partsMask = 0;
    SUPPLIES.forEach((_, i) => g.supplies[i] >= SUPPLY_NEED[i] && (partsMask |= 1 << i));
    if (this.lookTarget === 'car') h.context = { type: 'car', parts: partsMask };
    else if (this.lookTarget && this.lookTarget.kind === ENT.STRUCTURE) h.context = { type: 'structure', name: STRUCT_DEFS[this.lookTarget.stype].name, hp: this.lookTarget.q[3] / 255 };
    else h.context = null;
    h.ping = Math.round(this.conn.rtt);
    h.stalled = performance.now() - (this.snapAt || 0) > 1000; // nothing from the server for a second
    h.fps = this.fps || 0;
    h.players = { alive: g.humansAlive, total: g.playersTotal };
    // objective tracker
    const carried = {};
    let anyCarried = false;
    SUPPLIES.forEach((it, i) => {
      if (counts[it] && g.supplies[i] < SUPPLY_NEED[i]) {
        carried[it] = counts[it];
        anyCarried = true;
      }
    });
    h.objective = { supplies: g.supplies, hints: g.hints, found: g.found, carried, anyCarried, phase: g.phase, timeLeft: Math.ceil(g.timeLeft), finale: g.finale, escapeT: Math.ceil(g.escapeT), escapeReady: g.escapeReady, escapeStalled: g.escapeStalled, escapeLeaving: g.escapeLeaving, suppliesDone: g.suppliesDone, wave: g.wave, waves: g.waves };
    this.ui.setCamp({ supplies: g.supplies, hints: g.hints, found: g.found, carried });
    // downed overlay
    h.downed = self.alive && s.downed ? { bleed: self.bleed || 0, reviving: !!self.beingRevived, medkit: (counts[ITEM.MEDKIT] || 0) > 0 } : null;
    // compass + world markers
    h.yaw = this.input.yaw;
    this.buildMarkers(h, rp);
    this.ui.updateHud(h);
    this.pushInventoryToUI(false);
    if (this.ui.inventoryOpen && this.frame % 20 === 0) this.ui.setCraftContext(this.craftContext());
    if (this.ui.rosterOpen && this.frame % 20 === 10) this.pushRoster(); // health moves between player lists
  }

  buildMarkers(h, rp) {
    const g = this.global;
    const cm = h.compassMarks || (h.compassMarks = []);
    const wm = h.worldMarks || (h.worldMarks = []);
    cm.length = 0;
    wm.length = 0;
    const dist = (x, z) => Math.hypot(x - rp.x, z - rp.z);
    const car = this.world.car;
    const dCar = dist(car.x, car.z);
    const carIcon = glyph('car');
    cm.push({ kind: 'car', bearing: bearing(car.x - rp.x, car.z - rp.z), icon: carIcon, label: dCar > 6 ? `${Math.round(dCar)}m` : '', pinEdge: g.finale, cls: g.finale ? 'urgent' : '' });
    // rumoured supply places still missing something (one already taken from its hiding place is no reason to go there)
    const done = (i) => g.supplies[i] >= SUPPLY_NEED[i];
    const hintSeen = new Set();
    g.hints.forEach((zid, i) => {
      const si = Math.min(i, 4);
      if (zid === 255 || done(si) || g.found & (1 << i)) return;
      const z = this.world.zoneById[zid];
      if (!z || hintSeen.has(zid + ':' + si)) return;
      hintSeen.add(zid + ':' + si);
      const d = dist(z.x, z.z);
      if (d < 25) return;
      hintSeen.add(zid);
      // (the compass spells a marker's name out while you face it; a rumour keeps its question mark, as on the map)
      cm.push({ kind: 'hint', bearing: bearing(z.x - rp.x, z.z - rp.z), icon: itemIcon(SUPPLIES[si]), label: `${Math.round(d)}m`, name: ZONE_NAMES[zid] + '?', d });
    });
    // discovered places nearby (a place that already has a supply icon or the waypoint on it needs no flag too)
    const wp = this.waypoint;
    for (const z of this.world.zones) {
      if (!this.discovered.has(z.id) || z.id === ZONE.CAMP || hintSeen.has(z.id) || wp?.zone === z.id) continue;
      const d = dist(z.x, z.z);
      if (d < 30 || d > 260) continue;
      cm.push({ kind: 'poi', bearing: bearing(z.x - rp.x, z.z - rp.z), icon: glyph('flag'), label: '', name: `${ZONE_NAMES[z.id]} · ${Math.round(d)}m`, d });
    }
    // your waypoint: always on the tape (pinned to its end when behind you), and a marker standing on the spot
    if (wp) {
      const d = dist(wp.x, wp.z);
      const name = this.waypointName();
      const label = `${Math.round(d)}m`;
      cm.push({ kind: 'way', bearing: bearing(wp.x - rp.x, wp.z - rp.z), icon: glyph('flag'), label, name, d, pinEdge: true });
      // (raised with the distance, so that walking at it the marker floats over the crosshair and not on it)
      if (d > 8 && this.project(wp.x, wp.y + 2.4 + d * 0.07, wp.z, _sc)) wm.push({ kind: 'way', x: _sc.x, y: _sc.y, icon: glyph('flag'), name, sub: label, scale: 0.95 });
    }
    // teammates
    const sc = { x: 0, y: 0 };
    for (const e of this.entities.ents.values()) {
      if (e.kind === ENT.PLAYER) {
        const zombie = !!(e.q[5] & PFLAG.ZOMBIE);
        const dead = !!(e.q[5] & PFLAG.DEAD);
        if (zombie || dead) continue;
        const d = dist(e.rx, e.rz);
        const name = this.name(e.id);
        // health rides in every player's entity record (field 7, 0..255); a downed survivor has none left to show,
        // and one who has turned is not told which of the living is the weakest
        const hp = e.downed || h.zombie || !this.self.alive ? -1 : e.q[7] / 255;
        cm.push({ kind: 'mate', bearing: bearing(e.rx - rp.x, e.rz - rp.z), icon: glyph(e.downed ? 'downed' : 'person'), label: name.slice(0, 10), cls: e.downed ? 'downed' : '', hp, pinEdge: e.downed });
        if (d < 250 && this.project(e.rx, e.ry + (e.downed ? 0.9 : 2.15), e.rz, sc)) {
          const near = d < 12;
          // the bar is there when it says something: they are hurt, they are within reach, or we look their way
          // (the nameplate within an eighth of the screen height of the crosshair). Unhurt and far off: just the name
          const looked = Math.hypot(sc.x - window.innerWidth / 2, sc.y - window.innerHeight / 2) < window.innerHeight * 0.125;
          wm.push({
            kind: 'mate',
            x: sc.x,
            y: sc.y,
            icon: e.downed ? glyph('downed') : '',
            name,
            sub: e.downed ? `DOWN · ${e.beingRevived ? 'being revived' : near ? 'hold [E] to revive' : `${Math.round(d)}m`}` : d > 15 ? `${Math.round(d)}m` : '',
            bar: hp >= 0 && (hp < 1 || near || looked) ? hp : -1,
            cls: e.downed ? 'downed' : near ? 'near' : '',
            scale: Math.max(0.75, 1.1 - d / 300),
          });
        }
      } else if (e.kind === ENT.CRATE && e.q[3] !== 2) {
        const d = dist(e.rx, e.rz);
        cm.push({ kind: 'crate', bearing: bearing(e.rx - rp.x, e.rz - rp.z), icon: glyph('hazard'), label: `${Math.round(d)}m` });
        if (d > 25 && d < 300 && this.project(e.rx, e.ry + 2, e.rz, sc)) wm.push({ kind: 'crate', x: sc.x, y: sc.y, icon: glyph('hazard'), name: 'Supply drop', sub: `${Math.round(d)}m`, scale: 0.85 });
      }
    }
    // pings
    for (const p of this.pings) {
      const d = Math.hypot(p.x - rp.x, p.y - rp.y, p.z - rp.z);
      const fade = Math.min(1, (PING_LIFE - (this.time - p.t)) / 2);
      cm.push({ kind: 'ping', bearing: bearing(p.x - rp.x, p.z - rp.z), icon: glyph('ping'), label: `${Math.round(d)}m`, cls: 'p' + p.kind, pinEdge: true });
      if (this.project(p.x, p.y + 0.4, p.z, sc)) wm.push({ kind: 'ping', x: sc.x, y: sc.y, icon: glyph('ping'), name: `${p.name}: ${PING_LABEL[p.kind]}`, sub: `${Math.round(d)}m`, cls: 'p' + p.kind + (fade < 1 ? ' fading' : ''), scale: 1 });
    }
    // the car when it matters (finale, or carrying supplies back)
    if ((g.finale || h.objective?.anyCarried || g.suppliesDone) && dCar > 10 && this.project(car.x, car.y + 2.2, car.z, sc)) {
      wm.push({ kind: 'car', x: sc.x, y: sc.y, icon: carIcon, name: g.finale ? (g.escapeReady ? 'GET IN' : g.escapeStalled ? 'Engine stalled' : 'Defend the car') : 'Your car', sub: `${Math.round(dCar)}m`, cls: g.finale ? 'urgent' : '', scale: 0.95 });
    }
  }

  updateMap(s) {
    const g = this.global;
    const mates = [];
    const crates = [];
    for (const e of this.entities.ents.values()) {
      if (e.kind === ENT.PLAYER) {
        if (e.q[5] & (PFLAG.ZOMBIE | PFLAG.DEAD)) continue;
        mates.push({ x: e.rx, z: e.rz, name: this.name(e.id), status: e.downed ? 'downed' : 'alive' });
      } else if (e.kind === ENT.CRATE && e.q[3] !== 2) crates.push({ x: e.rx, z: e.rz });
    }
    const counts = this.invCounts();
    const carried = {};
    SUPPLIES.forEach((it) => counts[it] && (carried[it] = counts[it]));
    this.ui.map.update({
      self: { x: this.renderPos.x, z: this.renderPos.z, yaw: this.input.yaw },
      mates,
      car: this.world.car,
      pings: this.pings,
      crates,
      benches: g.benches,
      discovered: this.discovered,
      hints: g.hints,
      found: g.found,
      supplies: g.supplies,
      carried,
      waypoint: this.waypoint,
    });
    void s;
  }
}

export { MAX_PLAYERS, DUSK_WARNING, AMMO_NAMES, ZTYPE, dqpos };
