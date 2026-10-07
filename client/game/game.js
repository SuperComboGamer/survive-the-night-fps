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
  SLOT_RADIO,
  INVENTORY_MAX,
  inventoryCap,
  WATER_LEVEL,
  MAX_PLAYERS,
  ESCAPE_RADIUS,
  GAME_OVER_DELAY,
  GRID_STEP,
  DUSK_WARNING,
  DAWN_RETURN,
  EYE_HEIGHT,
  INTERACT_REACH,
  CAR_REACH,
  STAMINA_MAX,
  BTN,
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
  SCHEM_BIT,
  THROW_ITEMS,
  CONT,
  CONT_DEFS,
  SOUND,
  NOTIFY,
  CACHE_GAVE,
  KILLER,
  ZTYPE,
  ZANIM,
  IMPACT,
  ZONE,
  ZONE_NAMES,
  AMMO_NAMES,
  AMMO_ITEMS,
  CONSUMABLES,
  useWasted,
  PROJ,
} from '../../shared/defs.js';
import { LEFT_CODE, MOVED_CODE, ENDED_CODE, ACT, ENT, SNAP, HOLD, CAR_ID, PING_KIND, PFLAG, CHATF, PLF, PROGF, UNDO_NO, dqpos } from '../../shared/protocol.js';
import { trackedRecipe, trackedNeed } from './tracked.js';
import { mayHold } from './itemguide.js';
import { worldFor } from '../../shared/worlds.js';
import { WORLD, CROSSING, TAKEOFF_TIME, PLANE_REACH, RUNWAY } from '../../shared/acts.js';
import { SUPPLIES, SUPPLY_NEED, W, setAct } from './act.js'; // (this act's supplies, and the words for what they go into)
import { usePos } from '../../shared/protocol.js';
import { characterFor, defaultCharacter, CHARACTER_COUNT } from '../../shared/characters.js';
import { chosenCharacter } from '../ui/picker.js';
import { SPAWN_KEY } from '../ui/spawnmenu.js';
import { treeAt, fellTree, regrowTrees } from '../../shared/felling.js';
import { nightTheme } from '../../shared/nights.js';
import { shotDirections, currentWeapon, eyeHeight } from '../../shared/playersim.js';
import { pryWeapon } from '../../shared/trunk.js';
import { perkMods, levelOf, picksEarned, XP_SRC } from '../../shared/progress.js';
import { swimming } from '../../shared/swim.js';
import { raycastWorld, makeBox, overlapBoxes, COL } from '../../shared/collision.js';
const _wcF = new THREE.Vector3(), _wcR = new THREE.Vector3(), _wcU = new THREE.Vector3(), _wcD = new THREE.Vector3();
const _wcHit = { t: -1, col: null, terrain: false };
const WC_RAYS = [[0, 0], [0.3, -0.25]]; // (right, up) of the view: straight on, and out past the right hand
import { zombieHitbox, playerHitbox, rayHitbox } from '../../shared/hitbox.js';
import { difficultyOf } from '../../shared/difficulty.js';
import { deerHitbox } from '../../shared/deer.js';
import { readHeader, readGlobal, readSelf, readEntities, readEvents } from '../net/decode.js';
import { Connection } from '../net/connection.js';
import { playerId } from '../net/identity.js';
import { accountState } from '../net/account.js';
import { achievementEvent, joinedGame } from '../net/achievements.js';
import { bestiaryEvent, joinedBestiary } from '../net/bestiary.js';
import { Prediction } from './prediction.js';
import { InputBuffer } from './inputbuffer.js';
import { harvestPrompt, harvestTarget, strippedKey, needLines } from './harvest.js';
import { Impacts } from './impacts.js';
import { Entities } from './entities.js';
import { GunClient } from './mountedgun.js';
import { RocketsClient } from './rockets.js';
import { MOUNTED_GUN } from '../../shared/mountedgun.js';
import { smallestStack } from '../../shared/stacks.js';
import { planCost } from '../../shared/autocraft.js';
import { FairClient } from './fair.js';
import { HandcarClient } from './handcar.js';
import { Highlight } from './highlight.js';
import { Input } from './input.js';
import { actionsOf, bindTag, bindPair, bindLabel } from './binds.js';
import { DropHold } from './drophold.js';
import { SkyFlares } from './skyflares.js';
import { Voice } from './voice.js';
import { Environment } from '../render/environment.js';
import { buildTerrain, buildWater } from '../render/terrain.js';
import { buildMine } from '../render/mine.js';
import { buildClinic, disposeClinic } from '../render/clinic.js';
import { Graves } from '../render/cemetery.js';
import { buildRailway } from '../render/railway.js';
import { BridgeView } from '../render/bridge.js';
import { Crossing, Takeoff, liveProps } from './cutscene.js';
import { StaticWorld } from '../render/staticworld.js';
import { Crowd } from '../render/crowd.js';
import { getCrowdMaterial, crowdBones } from '../render/models/skinning.js';
import { Foliage } from '../render/foliage.js';
import { Effects } from '../render/effects.js';
import { Flyover } from '../render/flyover.js';
import { FixtureUI } from './fixtures.js';
import { nkSounds, nkStrike, nkRemoteHit } from './nunchaku.js';
import { RadioClient } from './radio.js';
import { Lights } from '../render/lights.js';
import { Atmosphere } from '../render/atmosphere.js';
import { WeatherFX } from '../render/weatherfx.js';
import { Weather } from './weather.js';
import { ViewModel } from '../render/models/weapons.js';
import { createGhost, createStructure } from '../render/models/structures.js';
import { PowerViews } from './power.js';
import { createZombie, createSurvivor, zombieVariants, warmSurvivor } from '../render/models/characters.js';
import { createCat } from '../render/models/cat.js';
import { createDeer } from '../render/models/deer.js';
import { createPickup } from '../render/models/pickups.js';
import { createSupplyCrate, createProjectile } from '../render/models/misc.js';
import { itemIcon, glyph } from '../ui/icons.js';
import { recordRun } from '../ui/records.js';
import { KeyHints } from '../ui/keyhints.js';
import { radialIndex } from '../ui/build.js';
import { MenuTour } from './menutour.js';
import { KeyGuard } from './keyguard.js';
import { bearing, nextNightText, nightBossText, tonightBrief, PING_LABEL } from '../ui/hud2.js';

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
  [ITEM.RPG]: SOUND.RPG,
  [ITEM.AT_RIFLE]: SOUND.AT_RIFLE,
  [ITEM.FLARE_GUN]: SOUND.FLARE_GUN,
};
// first-person muzzle flash scale + camera shake per shot (default [1, 0.06])
const SHOT_KICK = {
  [ITEM.SHOTGUN]: [1.4, 0.25],
  [ITEM.DB_SHOTGUN]: [1.6, 0.3],
  [ITEM.HUNTING_RIFLE]: [1.3, 0.3],
  [ITEM.MP5]: [0.8, 0.04],
  [ITEM.CROSSBOW]: [0, 0.1],
  [ITEM.RPG]: [1.8, 0.45],
  [ITEM.AT_RIFLE]: [2.2, 0.7],
  [ITEM.FLARE_GUN]: [1.5, 0.12],
};
// the anti-tank rifle's long reload: how far into it the round goes home (its bolt opens at the start, closes at the end)
const AT_ROUND_IN = 0.62;
// what [H] reaches for when not badly hurt, in that order; the HUD counts these as the healing left
const HEAL_ITEMS = [ITEM.BANDAGE, ITEM.TUNA, ITEM.VENISON, ITEM.PAINKILLERS, ITEM.MEDKIT];
const PING_LIFE = 12;
const WAYPOINT_REACH = 10; // metres: this close to a waypoint that is not on a named place and it is reached
// two waypoints on one spot: on the same place, or bare spots a few steps apart
const sameSpot = (a, b) => (a.zone >= 0 || b.zone >= 0 ? a.zone === b.zone : Math.hypot(a.x - b.x, a.z - b.z) < WAYPOINT_REACH);
// A bulk craft is one ACT.CRAFT per craft. The server drops whatever a client sends past 200 messages in a second,
// commands included (Game.onMessage), so the repeats leave through a bucket: a whole Ctrl+click at once, and when
// clicks pile up on top of that, the rest over the next ticks.
const CRAFT_BURST = 20;
const CRAFT_RATE = 40; // per second
// the build ring's pointer (mouse px): how far out it goes, and how far it must be pushed to point at a structure
const BUILD_MENU_REACH = 120;
const BUILD_MENU_DEAD = 26;
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
const _jetCol = new THREE.Color(0xff9440); // a flamethrower stream's light
const _nkAcc = new THREE.Vector3();
const _nkQ = new THREE.Quaternion();
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
    this.admin = false; // the server lets us run the admin commands (WELCOMEF.ADMIN): the spawn menu [`] is ours
    this.global = { phase: PHASE.WAITING, day: 0, timeLeft: 0, hordeLeft: -1, bossId: 0, supplies: [0, 0, 0, 0, 0], hints: [255, 255, 255, 255, 255, 255, 255], found: 0, unlocked: 0, schemHints: [255, 255, 255, 255, 255], wave: 0, waves: 3, escapeT: 0, flags: 0, finale: false, suppliesDone: false, escapeReady: false, humansAlive: 0, playersTotal: 0, restartT: 0, benches: [], parts: [] };
    this.self = { alive: 1, hp: 100, maxHp: 100, armor: 0, armorMax: 0, battery: 100, weapons: [0, 0, 0, 0, 0], mags: [0, 0], ammo: AMMO_ITEMS.map(() => 0) };
    this.inventory = { slots: new Array(INVENTORY_MAX).fill(null), armor: null, backpack: 0 };
    this.craftQueue = []; // recipe ids of bulk crafts waiting to be sent (sendCrafts)
    this.craftBudget = CRAFT_BURST;
    this.craftSoundT = -1; // when a craft was last heard (eventHandler.sound)
    this.players = new Map(); // id -> {name, status, walkie, kills, ping, way: their waypoint {x, z, zone} | null}
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
    this.buildPicked = false; // a structure picked from the ring since the hammer came out: its ghost is up to place
    this.buildMenu = null; // { hover }: the ring of structures is open (the mouse points in it: Input.cursor)
    this.buildRot = 0;
    this.ghosts = {};
    this.lastSlot = SLOT_PISTOL;
    this.dropHold = new DropHold(); // the drop key held, on its way to dropping the weapon in the hands (drophold.js)
    this.localFlash = false;
    this.localFlashT = 0;
    this.openness = 0;
    this.indoor = 0;
    this.under = 0; // how far down the mine the eye is (0..1)
    this._envOver = { under: 0 };
    this._wxDown = {};
    this.stepAcc = 0;
    this.swimming = false; // afloat in the lake or a pond (shared/swim.js), as of the last frame
    this.swimK = 0; // ...eased 0..1: the view riding the water
    this.treadT = 0; // till the next paddle treading water
    this.swimTired = false; // told this time in the water that stamina is running low
    this.swimTold = false; // told what swimming is, this page load
    this.deathShown = false;
    this.overlay = null;
    this.runOn = false; // a run is under way, as far as this client has seen (trackRun)
    this.run = null; // ...and we have been in it from the start: { tick, kills0 }
    this.runReport = null; // what the run that just ended did to the personal record, for the end screen
    this.prevPhase = -1;
    this.lastHudInvKey = '';
    this.talkPeers = [];
    this.talkKey = '';
    this.pttHeld = false; // [V] held down (push-to-talk): the microphone is open
    this.lookTarget = null;
    this.menuAngle = 0;
    this.lowHpBeat = 0;
    this.holding = 0; // hold-to-interact target we told the server about
    this.flames = new Map(); // flamethrowers spraying right now: shooter id (-1 = ours) -> { loop, t, glow, at, light }
    this.flameLights = []; // their fire lights this frame, for the light pool
    this.pings = [];
    // your own waypoint, set on the field map; the server lists it for the team (shareWaypoint):
    // { x, y, z, zone (id of the place it sits on, or -1), r (arrival radius), visited, away }
    this.waypoint = null;
    ui.map.onWaypoint = (at) => this.setWaypoint(at);
    ui.map.onClose = () => this.toggleMap(false);
    ui.board.onClose = () => this.toggleBoard(false);
    ui.bestiary.onClose = () => this.toggleBestiary(false);
    ui.spawn.onClose = () => this.toggleSpawn(false);
    ui.spawn.onSpawn = (cmd) => this.conn.chat(cmd);
    ui.roster.onClose = () => this.pinRoster(false);
    this.boardT = 0; // when the leaderboard is next asked for, while it is open (performance.now)
    this.discovered = new Set([ZONE.CAMP]);
    this.stripped = new Set(); // the trees and wrecks with nothing left to give today (harvest.js strippedKey)
    this.discoverT = 0;
    this.debugCam = null;
    this.selfBody = null; // our own survivor, shown to a debug camera that asks for it (updateSelfBody)
    this.nkVx = this.nkVz = 0; // (nunchucks: the eye's velocity last frame, and what their sounds remember)
    this.nkBtn = 0;
    this.nkSt = {};
    this.nkSt2 = {};
    this.warm = null; // shader warm-up in progress (prewarm)
    this.warmKey = ''; // quality + map the programs were last warmed for

    this.input = new Input(renderer.canvas);
    this.input.sensitivity = settings.sensitivity || 1;
    this.input.invertY = !!settings.invertY;
    this.input.rawInput = settings.rawMouse !== false;
    // Ctrl+W (crouch + forward) must not close the tab: fullscreen with the keys locked, else a "Leave site?" prompt
    // (not between two servers on a deploy: the place is kept there, and a new build reloads the page itself: moveBack)
    this.keyGuard = new KeyGuard(() => this.state === 'playing' && !this.moving);
    this.keyGuard.fullscreen = settings.fullscreen !== false;
    this.input.onRequestLock = () => this.keyGuard.engage();
    this.keyHints = new KeyHints(this); // names the key on the HUD at the moment it would help
    this.conn = new Connection({
      snapshot: (r) => this.onSnapshot(r),
      world: (seed, act) => this.onWorld(seed, act),
      inventory: (r) => this.onInventory(r),
      chat: (id, flags, text) => this.onChat(id, flags, text),
      players: (r) => this.onPlayers(r),
      progress: (r) => this.onProgress(r),
      board: (b) => this.ui.setBoard(b),
      voice: (from, payload) => this.voice.onSignal(from, payload),
      // (ENDED_CODE: an admin closed the game or removed this player - the reason is said, and nothing rejoins)
      close: (code, reason) => this.onDisconnect(code, code === ENDED_CODE ? reason || 'This game was ended by an admin.' : ''),
    });
    this.voice = new Voice(this.conn, audio);
    this.voice.onState = (s) => this.ui.setVoiceState({ ...s, speakers: this.speakers() });
    this.env = new Environment(this.scene);
    this.weather = new Weather();
    this.weather.onStrike = (s) => this.onLightning(s);
    this.lights = new Lights(this.scene, this.camera, renderer.q);
    this.vm = null; // built with the first world (ensureViewModel), not here: the splash has to paint first
    this.vmItem = -1;
    // the dead are drawn as a crowd: one draw call for all of a kind, one texture for all their bones (render/crowd.js)
    this.crowd = new Crowd(this.scene, getCrowdMaterial(), crowdBones, () => (this.renderer.q.shadowDist || 60) + 15);
    this.entities = new Entities(this);
    this.fixtures = new FixtureUI(this); // the chapel bell and the Relay Station's radio: prompts and notices
    this.radio = new RadioClient(this); // the walkie-talkie in slot 6: keyed, on the air, its static
    this.gun = new GunClient(this); // the mounted gun at the Army Checkpoint
    this.rockets = new RocketsClient(this); // our own RPG grenades in flight
    this.fair = new FairClient(this); // the Tri-County Fair: its rides, its lights, who sits where
    this.handcar = new HandcarClient(this); // the handcars on the railway: where they are drawn, who rides them
    this.highlight = new Highlight(this); // the faint outline on what [E] would act on
    this.power = new PowerViews(this); // the generator and its floodlights: their lights, sound and [E]
    this.skyflares = new SkyFlares(this); // flare gun flares: drawn, flown (our own), and their light on the world
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

  // jet: how bright our own flamethrower's stream is burning (its fire light's intensity, 0 when it is out)
  updateViewmodelLight(dt, cam, nearFire, jet = 0) {
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
    // the world's fire lights never reach the view model's own scene: our stream washes the hands and the gun orange
    if (jet > 0) {
      const w = Math.min(1, jet * 0.6);
      vmh.color.lerp(_jetCol, w);
      vmh.groundColor.lerp(_jetCol, w * 0.7);
      vmh.intensity += jet * 0.8;
    }
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
    this.terrain?.userData.setShadows(!!q.shadows);
    this.staticWorld?.setShadows(!!q.shadows);
    this.impacts?.wrecks.setShadows(!!q.shadows);
  }

  // The first-person arms and weapons. Baking their two 1024 px atlases holds the main thread for ~0.3 s, so it is
  // done in the shader warm-up behind the splash (warmViews), after the backdrop is on screen, or on the join if
  // that comes first - not in the constructor or the world build, where it held the splash's first picture back.
  ensureViewModel() {
    if (this.vm) return;
    this.vm = new ViewModel();
    this.renderer.vmScene.add(this.vm.group);
  }

  // ---------------------------------------------------------------- world
  // The server says which world the game is on now (S2C.WORLD_RESET): a new run's island, or - CROSSING.SWAP seconds
  // into the crossing, as the cutscene cuts to black - the mainland. Entities that follow are that world's, and their
  // positions are in its units from this message on.
  // Building the mainland holds the thread for seconds, and nothing is drawn until it is done: the crossing's loading
  // card must be on screen first. If it has not been drawn yet (this clock a little behind the server's), it goes up
  // now and the build waits a frame or two for it, with what the server sends after this held back until then.
  onWorld(seed, act) {
    const card = this.cine?.card;
    if (card && !card.painted && act !== this.act) {
      card.set(true, true);
      this.conn.hold();
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        this.swapWorld(seed, act);
        this.conn.release();
      };
      const wait = () => (card.painted ? go() : requestAnimationFrame(wait));
      requestAnimationFrame(wait);
      setTimeout(go, 1000); // (a hidden tab draws no frames)
      return;
    }
    this.swapWorld(seed, act);
  }
  swapWorld(seed, act) {
    this.loadWorld(seed, act);
    this.stripped.clear();
    this.cine?.worldChanged();
  }

  // act: which of the run's two maps to make of the seed (shared/acts.js)
  loadWorld(seed, act = WORLD.ISLAND) {
    if (this.seed === seed && this.act === act && this.world) return;
    const t0 = performance.now();
    if (this.world) this.unloadWorld();
    this.seed = seed;
    this.act = act;
    setAct(act);
    this.waypoint = null; // it pointed into the old valley
    this.world = worldFor(seed, act);
    usePos(this.world); // (what a metre is in a position on the wire: protocol.js)
    this.prediction.setWorld(this.world);
    const t1 = performance.now();
    this.terrain = buildTerrain(this.world);
    this.terrain.userData.setShadows(!!this.renderer.q.shadows); // hills shade the valleys at low sun
    this.scene.add(this.terrain);
    this.water = buildWater(this.world);
    this.scene.add(this.water);
    this.mine = buildMine(this.world); // (null in a valley without the workings)
    if (this.mine) this.scene.add(this.mine);
    this.clinic = buildClinic(this.world); // the lining of Mercy Clinic's dark wards and its signs (null on a map without it)
    if (this.clinic) this.scene.add(this.clinic);
    this.fair.setWorld(this.world);
    this.handcar.setWorld(this.world);
    this.railway = buildRailway(this.world); // (the ballast, sleepers and rails of the line)
    if (this.railway) this.scene.add(this.railway);
    this.bridge = this.world.bridge ? new BridgeView(this.scene, this.world) : null; // (the mainland: the bridge the car came over)
    this.live = liveProps(this.scene, this.world); // (...the car they came in and the plane: the props a cutscene moves)
    this.under = 0;
    const t2 = performance.now();
    this.staticWorld = new StaticWorld(this.scene, this.world);
    this.staticWorld.setShadows(!!this.renderer.q.shadows);
    const t3 = performance.now();
    this.foliage = new Foliage(this.scene, this.world, this.renderer.q, this.settings.grassDistance);
    const t4 = performance.now();
    if (!this.effects) this.effects = new Effects(this.scene, this.renderer.vmScene, this.world);
    else this.effects.world = this.world;
    // the marks blows and bullets leave, and the wrecks taken apart (none of the old world's are left)
    if (!this.impacts) this.impacts = new Impacts(this);
    else this.impacts.setWorld();
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
      } else if (l.kind === 'smoke') {
        // a column of smoke standing over a ruin (the mainland's city: it is what shows where it is from the bridge)
        this.staticEmitters.push(this.effects.createEmitter('column', l.x, l.y, l.z, { radius: l.r || 1 }));
      } else if (l.kind === 'fire') {
        // a building burning: its flames, the smoke over them, its light on the street and its roar
        const loop = this.audio.createLoop?.('blaze', l.x, l.y, l.z) || null;
        this.staticEmitters.push(this.effects.createEmitter('blaze', l.x, l.y, l.z, { radius: l.r || 1, loop }));
        this.staticEmitters.push(this.effects.createEmitter('column', l.x, l.y + 3, l.z, { radius: 0.8 }));
        this.staticFires.push({ x: l.x, y: l.y - 0.4, z: l.z, intensity: 1, big: true });
      }
    }
    this.ui.map.setWorld(this.world);
    this.ui.map.baked(); // (the minimap draws from it at once: bake it here, in the load, not on the first frame)
    this.prewarm();
    console.log(`[client] world ${seed}: gen ${(t1 - t0).toFixed(0)}ms, terrain ${(t2 - t1).toFixed(0)}ms, static ${(t3 - t2).toFixed(0)}ms, foliage ${(t4 - t3).toFixed(0)}ms, rest ${(performance.now() - t4).toFixed(0)}ms`);
  }

  // (the server deals a new map every playthrough, so worlds come and go for as long as the page is open)
  unloadWorld() {
    this.scene.remove(this.terrain, this.water);
    this.terrain.userData.dispose();
    this.water.geometry.dispose();
    this.water.material.dispose();
    this.bridge?.dispose();
    this.bridge = null;
    this.live?.dispose();
    this.live = null;
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
    if (this.railway) {
      this.scene.remove(this.railway);
      for (const mesh of this.railway.children) mesh.geometry.dispose(); // (its materials are the shared ones)
      this.railway = null;
    }
    this.impacts?.wrecks.clear(); // (what it lifted out of the static world goes with that world)
    this.staticWorld?.dispose();
    this.foliage?.dispose();
    this.fair.setWorld(null);
    this.handcar.setWorld(null);
    for (const em of this.staticEmitters) this.effects.removeEmitter(em);
    this.flyover?.clear();
    this.highlight.reset();
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
    const key = `${this.renderer.quality}:${this.seed}:${this.act}`;
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
    if (!w.sync) yield 50; // (the backdrop's first frames go out before the views' build holds the thread again)
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
    const steps = [() => this.ensureViewModel()];
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
            if (z.member) this.crowd.batch(rig); // (its batch in the crowd, in the scene from now on: its programs are built with the scene's)
            fresh = !rigs.has(rig);
            rigs.add(rig);
            if (chars.length) z.dispose();
            else set.add(chars[0] = z.object);
          }
        });
      }
    }
    // every survivor's model, and each one turned, built now rather than when a player picks them or dies
    for (let v = 0; v < CHARACTER_COUNT; v++) steps.push(() => warmSurvivor(v));
    steps.push(() => {
      const sv = createSurvivor(1);
      sv.setWeapon(ITEM.PISTOL);
      chars.push(sv.object);
      // (Entities draws these three with its own geometry: a teammate's flashlight cone, a roper's rope, the loot glints)
      const e = this.entities;
      set.add(sv.object, new THREE.Mesh(e.coneGeo, e.coneMat), new THREE.Mesh(e.ropeGeo, e.ropeMat), new THREE.Points(e.glints.geometry, e.glints.material));
      set.add(...this.highlight.warm(sv.object.getObjectByProperty('isSkinnedMesh', true))); // the outline on what [E] would act on (a downed one too)
    });
    steps.push(() => set.add(createCat(0, 1).object));
    for (const v of [0, 2, 1]) steps.push(() => set.add(createDeer(v, 1).object)); // a doe of each coat, the buck
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
    steps.push(() => set.add(...this.power.warm())); // a floodlight's lens, glow and beam
    steps.push(() => set.add(...this.foliage.falling.warmViews())); // a felled tree coming down, in its fading twins
    steps.push(() => set.add(this.skyflares.warm())); // a flare gun flare's glow
    steps.push(() => {
      // the supply plane, in the materials Flyover gives it
      this.flyover.start(0, 0, 0, 0, 0, this.time, null);
      set.add(this.flyover.planes.pop().obj);
    });
    // the viewmodel builds a weapon's mesh the first time it is held
    for (const it of [...Object.keys(WEAPONS), ...THROW_ITEMS, ITEM.WALKIE]) steps.push(() => this.vm.setItem(+it));
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
  // code: the game to join (an invite, a pick from the list, one just made); none for a quick join. resume: back into
  // the game we were playing a moment ago on the server before a deploy (onMoving): the same run on the same valley,
  // so what this client knows of it - the places found, its waypoint, the run being recorded - stays, and there is no
  // stinger or introduction
  async join(name, code = '', { resume = false } = {}) {
    if (!resume) this.audio.stinger?.('join');
    const info = await this.conn.connect(name, playerId(), code, chosenCharacter());
    this.room = info.room; // { code, name, inviteOnly }: what the invite link points at
    this.myId = info.id;
    this.admin = info.admin;
    this.voice.setMyId(info.id);
    this.ensureViewModel();
    this.loadWorld(info.seed, info.act);
    this.entities.clear();
    this.rockets.clear();
    this.skyflares.clear();
    this.clientTick = info.tick;
    this.clockInit = false;
    this.interpExtra = 0;
    this.introPending = !resume; // until NEW_GAME introduces the run this join started, or lateJoinIntro one already under way
    if (!resume) {
      this.runOn = false;
      this.run = this.runReport = null;
      this.progress = null; // our XP (onProgress), once the server says
    }
    this.moving = false;
    this.ui.setConnectionStatus('');
    this.state = 'playing';
    this.input.enabled = true;
    this.inputBuffer.clear();
    this.input.requestLock();
    if (!resume) this.discovered = new Set([ZONE.CAMP, ZONE.BRIDGEHEAD]); // (where a run, and its second act, begin)
    this.stripped.clear(); // (the first snapshot says which are)
    this.regrowTrees(); // (and which trees are down: on a rejoin the valley is the one we left)
    if (!resume) this.waypoint = null;
    if (this.admin && !resume) this.ui.addChat('', 'Admin: the key under Esc ( ` ~ ) opens the spawn menu.', { system: true });
    joinedGame(!!accountState().user); // (a guest's achievements count the days played on here; an account's, the server)
    joinedBestiary(); // (whose bestiary this game keeps: its first EVT.BESTIARY says)
    return info;
  }

  // A tree chopped down (EVT.FELL; yaw: the way it falls), or one that was down before we came (EVT.STRIPPED,
  // yaw null): out of the world until dawn, and out of the forest - the one falling now crashes down first.
  fellTree(qx, qy, qz, yaw = null) {
    const col = this.world && treeAt(this.world, qx, qy, qz);
    if (!col || !fellTree(this.world, col)) return;
    this.impacts?.gone(col); // (the cuts in its bark go down with it)
    this.foliage?.fell(col.ti, yaw);
    if (yaw === null) return;
    // heard from a little way out along its fall: between the creaking stump and where the crown comes down
    const out = 0.3 * (col.y1 - col.y0);
    const x = col.x - Math.sin(yaw) * out;
    const z = col.z - Math.cos(yaw) * out;
    this.audio.play(SOUND.TREE_FALL, { x, y: this.world.heightAt(x, z) + 1.5, z });
  }

  regrowTrees() {
    if (!this.world) return;
    regrowTrees(this.world);
    this.foliage?.regrow();
  }

  // code: the socket's close code. why: what the splash says (none: a drop, which main.js goes straight back in from)
  onDisconnect(code = 0, why = '') {
    if (this.state !== 'playing') return;
    if (code === MOVED_CODE && this.room && this.onMove && !this.leaving) return this.onMoving();
    this.moving = false;
    this.ui.setConnectionStatus('');
    this.state = 'menu';
    this.input.enabled = false;
    this.input.exitLock();
    this.keyGuard.release();
    this.entities.clear();
    this.rockets.clear();
    this.skyflares.clear();
    this.voice.closeAll();
    this.radio.reset();
    // the splash is see-through and the next join starts from this UI: take down whatever the game had up
    this.ui.setMapOpen(false);
    this.ui.setBoardOpen(false);
    this.ui.setBestiaryOpen(false);
    this.ui.setBoard(null); // (what it showed was that server's, as of then)
    this.ui.setSpawnOpen(false);
    this.ui.setRosterOpen(false);
    this.ui.setInventoryOpen(false);
    this.ui.showPause(false); // ("Leave game" is pressed on it)
    this.ui.clearNotices();
    this.ui.hideOverlays();
    this.overlay = null;
    this.deathShown = false;
    this.ui.showSplash();
    // a player who pressed "Leave game" knows why they are back here: only a drop is an error - and the server holds
    // the place of a dropped player for a minute, so main.js goes straight back in (onDrop)
    const dropped = !this.leaving;
    this.leaving = false;
    if (why) this.ui.setJoinError(why);
    else if (dropped && this.room && this.onDrop) this.onDrop(this.room.code);
    else if (dropped) this.ui.setJoinError('Disconnected from server.');
  }

  // The server went down for a deploy and handed this game to the next one (MOVED_CODE, server/handoff.js), where our
  // body waits for us. The game stays on screen, still, with the pointer kept, while main.js joins the same code
  // there (moveBack: join with resume); only if that cannot be done does it end here as a drop does (onDisconnect).
  onMoving() {
    this.moving = true;
    this.input.enabled = false;
    this.inputBuffer.clear();
    this.voice.closeAll(); // (the peers find each other again through the next server)
    this.radio.reset();
    this.ui.setConnectionStatus('Server updating - bringing you back');
    this.onMove(this.room.code);
  }

  // The page is about to be loaded again for a deploy's new client (main.js reloadInto), and Edge has crashed instead of
  // reloading a page still in the middle of a game. What the game holds of the browser - the mouse, fullscreen with the
  // keyboard locked, the microphone - is given back first, and the mouse and the screen are waited for (the browser
  // says when they are back, or a moment passes).
  async letGo() {
    this.input.enabled = false;
    this.input.handlers.onLockChange = null; // (the mouse let go is not Esc: no pause menu under the "Game updated" card)
    const back = (type, ms) => new Promise((done) => (document.addEventListener(type, done, { once: true }), setTimeout(done, ms)));
    const mouse = document.pointerLockElement ? back('pointerlockchange', 300) : null;
    this.input.exitLock();
    await mouse;
    const screen = document.fullscreenElement ? back('fullscreenchange', 600) : null;
    this.keyGuard.release(); // (the keyboard lock, and the fullscreen it took)
    await screen;
    this.voice.closeAll();
    this.voice.stopMic();
  }

  leave() {
    if (this.state !== 'playing') return;
    this.leaving = true;
    if (this.moving) return this.onDisconnect(); // (between two servers: nothing to close)
    this.conn.close(LEFT_CODE);
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
    // (the crossing between the acts is part of the run: it goes on over the bridge)
    if (g.phase === PHASE.DAY || g.phase === PHASE.NIGHT || g.phase === PHASE.CROSSING) {
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
    for (let i = 0; i < INVENTORY_MAX; i++) {
      const item = r.u8();
      const count = r.u16();
      slots[i] = item ? { item, count } : null;
    }
    const armorItem = r.u8();
    const armor = r.u8();
    const armorMax = r.u8();
    this.inventory.armor = armorItem ? { item: armorItem, points: armor, max: armorMax } : null;
    this.inventory.backpack = r.u8(); // the backpack worn (0: none): it opens the locked slots of the grid
    this.pushInventoryToUI(true);
  }

  pushInventoryToUI(force = false) {
    const s = this.prediction.state;
    // (the magazines move with every shot: only the open screen shows them)
    const key = `${s.weapons.join(',')}|${s.ammo.join(',')}|${this.ui.inventoryOpen ? s.mags.join(',') : ''}|${s.throwCount}`;
    if (!force && key === this.lastHudInvKey) return;
    this.lastHudInvKey = key;
    const throwCounts = {};
    for (const it of this.inventory.slots) if (it && THROW_ITEMS.includes(it.item)) throwCounts[it.item] = (throwCounts[it.item] || 0) + it.count;
    this.ui.setInventory({ slots: this.inventory.slots, armor: this.inventory.armor, backpack: this.inventory.backpack, ammo: [...s.ammo], weapons: [...s.weapons], mags: [...s.mags], throwCounts });
  }

  // what we carry, by item: the backpack, and the ammunition carried apart from it (the reserves we predict)
  // The car whose boot a container is, when that car has a lid to force (shared/trunk.js): { car, shut } - shut:
  // the lid is still down on it (not forced, not lifted by a blow, not off). null: any other container.
  bootOf(e) {
    if (!e || e.kind !== ENT.CACHE || e.ctype !== CONT.TRUNK) return null;
    const car = this.impacts.bootOf(e);
    return car ? { car, shut: this.impacts.wrecks.bootShut(car) } : null;
  }

  invCounts() {
    const m = {};
    for (const it of this.inventory.slots) if (it) m[it.item] = (m[it.item] || 0) + it.count;
    this.prediction.state.ammo.forEach((n, i) => n > 0 && (m[AMMO_ITEMS[i]] = n));
    return m;
  }

  onChat(id, flags, text) {
    const radio = !!(flags & CHATF.RADIO);
    if (flags & CHATF.SYSTEM) {
      this.ui.addChat('', text, { system: true });
      this.ui.spawn.serverSays(text);
    } else {
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
      const flags = r.u8();
      const onAir = !!(flags & PLF.ON_AIR);
      const kills = r.u16();
      const ping = r.u16();
      const level = r.u8();
      let way = null;
      if (flags & PLF.WAYPOINT) {
        const x = dqpos(r.i16());
        const z = dqpos(r.i16());
        const zone = r.u8();
        way = { x, z, zone: zone === 255 ? -1 : zone };
      }
      seen.add(id);
      const prev = this.players.get(id);
      this.players.set(id, { name, status, onAir, kills, ping, level, way });
      // a teammate's new waypoint (not one they already had when we first heard of them, nor one being cleared)
      if (way && prev && id !== this.myId && !(prev.way && prev.way.x === way.x && prev.way.z === way.z)) this.waypointSet(id, way);
    }
    // each player's character, after them all (a server from before the roster sends none: the look picked from the id)
    const order = [...seen];
    for (const id of order) this.players.get(id).character = r.left > 0 ? characterFor(r.u8(), id) : defaultCharacter(id);
    // ...then everyone's perks in force (a server from before them sends none)
    for (const id of order) this.players.get(id).perks = r.left >= 4 ? r.u32() : 0;
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
    // (a count that went down was reset by the server for the new run: the run's kills then count from there)
    if (this.run) this.run.kills0 = Math.min(this.run.kills0, this.players.get(this.myId)?.kills ?? Infinity);
    this.pushRoster();
    this.voice.syncPlayers([...this.players.keys()]);
    this.radio.players(this.players, this.myId); // who is on the air: their voices come over the walkie-talkie
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
      list.push({ id, name: p.name, account: this.conn.accounts.get(id) || '', status: ST[p.status] || 'alive', hp, kills: p.kills, ping: self ? Math.round(this.conn.rtt) : p.ping, level: p.level, perks: p.perks || 0, talking: this.talkPeers.includes(id), radio: p.onAir, self });
    }
    this.ui.setPlayers(list);
  }

  // S2C.PROGRESS: our XP as the server counts it (shared/progress.js), this run's by source. A level gained during
  // the run is announced, with the perk it brings
  onProgress(r) {
    const xp = r.varu();
    const f = r.u8();
    const run = XP_SRC.map(() => r.varu());
    const was = this.progress;
    const p = (this.progress = { xp, run, loaded: !!(f & PROGF.LOADED), kept: !!(f & PROGF.KEPT) });
    if (was?.loaded && p.loaded && p.kept) {
      const before = levelOf(was.xp);
      const now = levelOf(xp);
      if (now > before) {
        this.ui.notify(`LEVEL ${now}`, 'big', 3.5);
        this.ui.notify(picksEarned(now) > picksEarned(before) ? `A perk point to spend: Perks, in the inventory (${bindLabel('inventory')})` : 'Keep going: more XP, more perk points.', 'sub', 3.5);
        this.audio.stinger?.('car_part');
      }
    }
    this.ui.setProgress(p);
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
        if (snd === SOUND.MELEE_HIT) nkRemoteHit(g, x, y, z); // (a survivor's nunchucks come off what they struck)
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
        const killer = kk === KILLER.PLAYER ? g.name(killerId) : kk === KILLER.ZOMBIE ? ZOMBIE_DEFS[killerId]?.name || 'Zombie' : sunKill ? 'The sun' : flags & 4 ? 'The water' : 'The world'; // (flags 4: drowned)
        const victim = victimId & 0x8000 ? ZOMBIE_DEFS[victimId & 0xff]?.name || 'Zombie' : g.name(victimId);
        g.ui.killfeed({ killer, victim, weaponItem: weapon, headshot: !!(flags & 1), killerZombie: kk === KILLER.ZOMBIE || (kk === KILLER.PLAYER && g.players.get(killerId)?.status === 1), victimPlayer: !(victimId & 0x8000) });
        if (sunKill) g.ui.notify(`${victim.startsWith('The ') ? victim : 'The ' + victim} burned in the sun, and what it carried with it. Kill a boss before sunrise to loot it.`, 'toast', 7);
      },
      notify(msg, arg) {
        g.onNotify(msg, arg);
      },
      explosion(x, y, z, radius, kind) {
        g.rockets.burst(x, y, z); // (a grenade of ours that went off: it is not drawn flying on)
        g.effects.explosion(x, y, z, radius, kind);
        if (kind === 0 || kind === 2) g.impacts.blast(x, y, z, radius);
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
        g.fellTree(qx, qy, qz); // (a tree in the list was cut down before we came)
      },
      fell(qx, qy, qz, yaw) {
        g.fellTree(qx, qy, qz, yaw);
      },
      strike(id, blow, heavy, x, y, z, dx, dy, dz) {
        g.impacts.strike(id, blow, heavy, x, y, z, dx, dy, dz);
      },
      wreck(flags, qx, qy, qz, left, hits) {
        g.impacts.wreck(flags, qx, qy, qz, left, hits);
      },
      wreckAlarm(qx, qy, qz, say, secs) {
        g.impacts.wreckAlarm(qx, qy, qz, say, secs);
      },
      regrown() {
        g.stripped.clear();
        g.regrowTrees();
        g.impacts.regrown();
      },
      flyover(x, y, z, heading, eta) {
        g.flyover?.start(x, y, z, heading, eta, g.time, g.audio);
      },
      grave(i) {
        g.graves?.stir(i);
      },
      achieve(flags, add, ids) {
        achievementEvent(flags, add, ids);
      },
      bestiary(flags, mask) {
        bestiaryEvent(flags, mask);
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
        setTimeout(() => g.state === 'playing' && g.ui.showSummary(s, nextNightText(s.night + 1, g.act), nightTheme(g.seed, s.night + 1, g.act), nightBossText(g.seed, s.night + 1, g.act)), 4300);
      },
    };
    return this._eh;
  }

  onNotify(msg, arg) {
    const ui = this.ui;
    const a = this.audio;
    if (this.fixtures.notify(msg, arg)) return;
    if (this.fair.onNotify(msg, arg)) return;
    switch (msg) {
      case NOTIFY.NIGHT_FALLS: {
        // a themed night says so (the same theme the server drew: both work it out from the seed)
        const th = nightTheme(this.seed, arg, this.act);
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
      case NOTIFY.HORDE_SOON:
        // one line. What tonight brings (its theme, the new kind, its boss) is on the card under the clock from now to
        // dark (hud2.js Tonight, from Game.tonight), and the objective says where to board up
        ui.notify('THE HORDE IS COMING', 'danger', 5);
        break;
      case NOTIFY.BOSS: {
        const zd = ZOMBIE_DEFS[arg];
        ui.notify(zd ? (zd.boss ? '' : 'A ') + zd.name.toUpperCase() : 'SOMETHING', 'big', 4);
        ui.notify('has risen from the woods.', 'sub', 4);
        if (zd?.tip) ui.notify(zd.tip, 'toast', 7);
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
        ui.notify(`${ITEM_DEFS[arg]?.name || 'A supply'} found! Bring it to the ${W.thing}.`, 'good', 5);
        a.stinger?.('car_part');
        break;
      case NOTIFY.CAR_PART:
        ui.notify(`${ITEM_DEFS[arg]?.name || 'Part'} installed in the ${W.thing}`, 'good', 4);
        a.playLocal('install_part');
        break;
      case NOTIFY.SUPPLIES_DONE:
        ui.notify(this.act === WORLD.MAINLAND ? 'THE PLANE IS FIXED' : 'EVERY SUPPLY IS IN', 'big', 5);
        if (this.act === WORLD.MAINLAND) ui.notify(`Hold ${bindTag('interact')} at the plane to start fuelling. Hold the fuel truck for ${RUNWAY.FUEL_TIME} seconds, then the plane for ${RUNWAY.WARM_TIME}, and keep the runway clear.`, 'sub', 9);
        else ui.notify(`Fortify the car. Hold ${bindTag('interact')} at the car to start the engine - it takes 90 seconds to warm up.`, 'sub', 7);
        a.stinger?.('car_part');
        break;
      case NOTIFY.NEED_SUPPLIES:
        ui.notify(`${W.The} still needs ${W.supplies}`, 'warning', 2.5);
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
        ui.notify(`Hold ${bindTag('interact')} at the car to drive away. Whoever is not at the car is left behind.`, 'sub', 7);
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
        } else ui.notify(`${this.name(arg)} is down! Hold ${bindTag('interact')} on them to revive.`, 'danger', 5);
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
      // the two acts (shared/acts.js)
      case NOTIFY.ARRIVED:
        ui.notify('THE MAINLAND', 'big', 6);
        ui.notify('The bridge is gone behind you. There is an airfield past the city: find the plane, find its parts, fly out.', 'sub', 9);
        if (arg) ui.notify(`${arg === 1 ? 'One of the dead is' : `${arg} of the dead are`} a survivor again: the crossing brought them back.`, 'good', 7);
        ui.notify('There is no second chance here: if everyone falls, the run starts over on the island.', 'toast', 9);
        this.discovered = new Set([ZONE.BRIDGEHEAD]);
        break;
      case NOTIFY.CACHE: {
        const got = [arg & CACHE_GAVE.PISTOL && 'a pistol', arg & CACHE_GAVE.AMMO && 'ammunition', arg & CACHE_GAVE.BANDAGE && 'a bandage', arg & CACHE_GAVE.MELEE && 'a knife', arg & CACHE_GAVE.BUILD && 'a hammer'].filter(Boolean);
        if (got.length) ui.notify(`From the checkpoint's cache at the bridgehead: ${got.join(', ')}.`, 'toast', 8);
        break;
      }
      case NOTIFY.STAND_STAGE:
        ui.notify('THE TANKS ARE FULL', 'big', 4);
        ui.notify('The engines are turning over. Get to the plane and hold it.', 'sub', 6);
        a.stinger?.('car_part');
        break;
      case NOTIFY.RUNWAY_BLOCKED:
        ui.notify(`${arg} of the dead are on the runway. Clear it before you go.`, 'warning', 3);
        a.playLocal('build_fail');
        break;
      case NOTIFY.GAME_OVER:
        a.stinger?.('gameover');
        break;
      case NOTIFY.NEED_FIRE:
        ui.notify(`Needs a lit campfire nearby (build one ${bindTag('slot5')})`, 'warning', 2.5);
        a.playLocal('build_fail');
        break;
      case NOTIFY.NEED_BENCH:
        ui.notify(`Needs a workbench nearby (build one ${bindTag('slot5')})`, 'warning', 2.5);
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
        ui.notify(`Too many structures - demolish some ${bindTag('demolish')}`, 'warning', 2.5);
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
          ui.notify(`Inventory full - ${d.name} left on the ground! Drop something to make room: right-click a stack in the backpack ${bindTag('inventory')}.`, 'danger', 6);
          a.playLocal('build_fail');
        } else if (d?.cat === 'ammo') ui.notify(`Can't carry more ${d.name}`, 'warning', 2);
        else ui.notify(d ? `Inventory full - no room for ${d.name}` : 'Inventory full', 'warning', 2);
        break;
      }
      case NOTIFY.POCKETS:
        ui.notify("Empty the backpack's extra pockets first", 'warning', 2.5);
        a.playLocal('build_fail');
        break;
      case NOTIFY.NEED_HAMMER:
        ui.notify(`Equip the hammer to repair ${bindTag('slot5')}`, 'warning', 2);
        a.playLocal('build_fail');
        break;
      case NOTIFY.UNDO_GONE:
        ui.notify(arg === UNDO_NO.LATE ? 'Too late to take it back: it is still on the ground' : arg === UNDO_NO.FAR ? 'Too far from it to take it back: it is still on the ground' : 'Somebody already picked it up', 'warning', 2.5);
        a.playLocal('build_fail');
        break;
      case NOTIFY.CAMPFIRE_LIT:
        ui.notify('The fire roars back to life.', 'good', 2);
        break;
      case NOTIFY.GEN_LOW:
        ui.notify('The generator is down to its last minute of fuel.', 'warning', 4);
        break;
      case NOTIFY.GEN_OUT:
        ui.notify('The generator has run dry. The floodlights are out.', 'danger', 5);
        break;
      case NOTIFY.NEW_GAME:
        ui.hideOverlays();
        if (this.overlay === 'gameover' || this.overlay === 'victory') this.pointerAfterEnd();
        this.overlay = null;
        this.deathShown = false;
        this.discovered = new Set([ZONE.CAMP]);
        this.stripped.clear();
        this.regrowTrees();
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

  // The card under the clock from the dusk horn to nightfall (hud2.js Tonight): what the coming night brings, worked
  // out from the seed as the server does. The same object while it holds (the card rebuilds when the key changes);
  // null by night, before the horn and in the final stand
  tonight(g) {
    if (g.phase !== PHASE.DAY || g.finale || !g.day || g.timeLeft > DUSK_WARNING) return null;
    const key = `${this.seed}:${this.act}:${g.day}`;
    if (this._tonight?.key !== key) this._tonight = { key, rows: tonightBrief(this.seed, g.day, this.act) };
    return this._tonight;
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
    if (this.act === WORLD.MAINLAND) {
      ui.notify('The team crossed the bridge to the mainland. Find the parts of the plane, fix it, fly out.', 'sub', 6);
      ui.notify(g.suppliesDone ? 'You joined a run in progress: every part is in. Fuelling the plane is next.' : `You joined a run in progress, in its second act: ${have} of ${need} plane parts are in.`, 'toast', 8);
    } else {
      ui.notify('Your car died on Route 9. Find the supplies, fix it, drive out.', 'sub', 6);
      ui.notify(g.suppliesDone ? 'You joined a run in progress: every supply is in. Starting the engine is next.' : `You joined a run in progress: ${have} of ${need} car supplies are in.`, 'toast', 8);
    }
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
      this.effects.worldMuzzle(_v, def.rocket || def.bossMul ? 1.8 : def.pellets > 1 ? 1.3 : 1);
      this.lights.flashMuzzle(_v, 0.8);
    }
    this.audio.play(SHOT_SOUND[ev.weapon] || SOUND.PISTOL, { x: mx, y: my, z: mz });
    if (def.rocket) {
      // no tracer: the grenade is a projectile of its own (entities.js). The backblast out of the back of the tube
      const cp = Math.cos(ev.pitch);
      const fx = -Math.sin(ev.yaw) * cp;
      const fy = Math.sin(ev.pitch);
      const fz = -Math.cos(ev.yaw) * cp;
      this.effects.backblast(mx - fx, my - fy, mz - fz, -fx, -fy, -fz);
      return;
    }
    if (def.skyflare) return; // (no bullet: the flare is a projectile of its own, game/skyflares.js)
    const n = shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, def.pellets, ev.seed, _dirs);
    for (let i = 0; i < n; i++) {
      const dx = _dirs[i * 3];
      const dy = _dirs[i * 3 + 1];
      const dz = _dirs[i * 3 + 2];
      raycastWorld(this.world, ev.x, ev.y, ev.z, dx, dy, dz, def.range, _ray);
      const dist = _ray.t >= 0 ? _ray.t : Math.min(def.range, 80);
      this.predictPellet(ev, def, i, dx, dy, dz, false); // (the hole each pellet leaves, if no body stopped it)
      if (def.pellets > 1 && i % 2) continue;
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
    const dist = Math.max(0.3, (_ray.t >= 0 ? _ray.t : def.range) - ahead);
    this.effects.flameJet(mx, my, mz, dx, dy, dz, dist, def.flame.cone);
    _v.set(mx + dx * 1.2, my + dy * 1.2 + 0.25, mz + dz * 1.2);
    this.lights.flashMuzzle(_v, 0.3, 0.12);
    // the stream lights up everything round it like a big fire: its light sits well short of where the fire ends
    // (a light right on the wall it splashes on burns that wall white), no more than 4.5 m out, so the shooter
    // stands in it too. Sprayed point-blank into something, the fire is smothered and lights less
    const k = Math.min(4.5, Math.max(dist * 0.4, dist - 1.8));
    let f = this.flames.get(id);
    if (!f) {
      _v.set(mx + dx * k, my + dy * k - 0.9, mz + dz * k); // (the light pool lifts a big fire's light 0.9 m)
      this.flames.set(id, (f = { loop: undefined, t: 0, glow: 0, at: _v.clone(), light: { x: _v.x, y: _v.y, z: _v.z, intensity: 0, big: true, color: 0xff9440 } }));
    }
    if (f.loop === undefined) f.loop = this.audio.createLoop?.('flamethrower', mx, my, mz) || null;
    f.loop?.setPosition(mx, my, mz);
    f.t = 0.2;
    f.glow = (1.05 + Math.random() * 0.4) * Math.min(1, 0.4 + dist * 0.2); // each puff a little brighter or dimmer than the last: it flickers
    f.at.set(mx + dx * k, my + dy * k - 0.9, mz + dz * k);
  }

  // ---------------------------------------------------------------- local predicted events
  // One pellet of our own shot, judged the way the server will judge it (Combat.fire): against the world (_ray holds
  // that already) and against the hitboxes of the dead where they are drawn - the server rewinds its own to the same
  // moment, so the two agree. What the pellet strikes is shown now (ownImpact) instead of a round trip later, when
  // the server says so. Only the look of it: the damage and the hit marker wait for the server.
  // Returns how far the pellet flies before something stops it, -1 if nothing does.
  // own: false for somebody else's pellet (EVT.SHOT): the server tells of the bodies it struck, so only what it
  // does to the world is shown - the hole it leaves, where no body stood in its way.
  predictPellet(ev, def, i, dx, dy, dz, own = true) {
    const wall = _ray.t;
    const wallT = wall >= 0 ? wall : def.range;
    const col = _ray.col;
    const terrain = _ray.terrain;
    const hits = _shotHits;
    hits.length = 0;
    for (const e of this.entities.ents.values()) {
      const zdef = e.kind === ENT.ZOMBIE ? ZOMBIE_DEFS[e.ztype] : null;
      const deer = e.kind === ENT.DEER; // (hunted through the same path as the dead are shot: shared/deer.js)
      if (zdef || deer ? e.dead : e.kind !== ENT.PLAYER || e.id === (own ? this.myId : ev.shooter) || (e.q[5] & (PFLAG.ZOMBIE | PFLAG.DEAD)) !== PFLAG.ZOMBIE) continue;
      // (first by how far the ray passes from it: most of them are nowhere near)
      const rx = e.rx - ev.x;
      const ry = e.ry + 0.8 - ev.y;
      const rz = e.rz - ev.z;
      const along = rx * dx + ry * dy + rz * dz;
      if (along < -1 || along > wallT + 2 || rx * rx + ry * ry + rz * rz - along * along > 16) continue;
      const hb = deer ? deerHitbox(e.ryaw, e.q[4]) : zdef ? zombieHitbox(zdef, e.ryaw, e.q[7], e.q[4] === ZANIM.AIRBORNE, difficultyOf(this.room?.difficulty).aim) : playerHitbox(true, !!(e.q[5] & PFLAG.CROUCH));
      _hbPos.x = e.rx;
      _hbPos.y = e.ry;
      _hbPos.z = e.rz;
      const t = rayHitbox(_hbPos, hb, ev.x, ev.y, ev.z, dx, dy, dz, wallT);
      if (t >= 0) hits.push({ t, e });
    }
    hits.sort((a, b) => a.t - b.t);
    const pierce = def.pierce || 1;
    for (let k = 0; own && k < hits.length && k < pierce; k++) {
      const { t, e } = hits[k];
      const z = e.kind === ENT.ZOMBIE;
      const green = z && (e.ztype === ZTYPE.SPITTER || e.ztype === ZTYPE.BOOMER || e.ztype === ZTYPE.BOSS_HIVEQUEEN || e.ztype === ZTYPE.BOSS_BLOATER);
      // (a shade pinned by light is stone: the bullet chips it)
      this.ownImpact(z && e.q[4] === ZANIM.FROZEN ? IMPACT.DIRT : green ? IMPACT.GREEN_BLOOD : IMPACT.BLOOD, ev.x + dx * t, ev.y + dy * t, ev.z + dz * t, -dx, -dy, -dz);
    }
    if (hits.length) return hits.length >= pierce ? hits[pierce - 1].t : wall;
    // nothing in the way but the world: the hole every pellet leaves in what it struck, the dust or the sparks off
    // it (Impacts.shot: by what that is made of), and the window it went through on its way. The server's word of
    // the same impact, a round trip later, is dropped (sameAsOwn).
    this.impacts.shot(ev.weapon ?? MOUNTED_GUN, ev.x, ev.y, ev.z, dx, dy, dz, wall, col, terrain, def.range); // (a round with no weapon named is the mounted gun's)
    if (wall >= 0) {
      const list = this.ownImpacts || (this.ownImpacts = []);
      if (list.length >= 48) list.shift();
      list.push({ x: ev.x + dx * wall, y: ev.y + dy * wall, z: ev.z + dz * wall, t: this.time });
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

  // into the water or out of it (shared/swim.js). The hands go to swimming and the weapon out of sight; it is drawn
  // again on the way out
  // How far the world is in front of the held item (m, along the view): two short rays from the eye, straight ahead and
  // out past the right hand where a gun's muzzle or a blade is, against walls, props, structures and the ground
  weaponClearance(cam) {
    const f = _wcF.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = _wcR.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const u = _wcU.set(0, 1, 0).applyQuaternion(cam.quaternion);
    let near = 99;
    for (const [a, b] of WC_RAYS) {
      const d = _wcD.copy(f).addScaledVector(r, a).addScaledVector(u, b).normalize();
      raycastWorld(this.world, cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z, 1.4, _wcHit);
      if (_wcHit.t >= 0) near = Math.min(near, _wcHit.t * d.dot(f));
    }
    return near;
  }

  onSwim(swim) {
    this.swimming = swim;
    if (!swim) {
      this.vmItem = null;
      return;
    }
    this.swimTired = false;
    if (!this.swimTold) {
      this.swimTold = true;
      this.ui.notify('Swimming: your hands are busy, and stamina drains the whole time. Run out of it and you drown.', 'toast', 7);
    }
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
          if (def.rocket) {
            // No pellets: a grenade, flown on from here by game/rockets.js along the line the server flies it. It
            // leaves the muzzle on the right shoulder, and the backblast leaves the back of the tube behind it
            shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, 1, ev.seed, _dirs);
            const cp = Math.cos(ev.pitch);
            const fx = -Math.sin(ev.yaw) * cp;
            const fy = Math.sin(ev.pitch);
            const fz = -Math.cos(ev.yaw) * cp;
            const rx = Math.cos(ev.yaw) * 0.16;
            const rz = -Math.sin(ev.yaw) * 0.16;
            this.rockets.fire(def, ev.x, ev.y, ev.z, _dirs[0], _dirs[1], _dirs[2], ev.x + rx + fx * 0.8, ev.y - 0.1 + fy * 0.8, ev.z + rz + fz * 0.8);
            this.effects.backblast(ev.x + rx - fx * 0.5, ev.y - 0.1 - fy * 0.5, ev.z + rz - fz * 0.5, -fx, -fy, -fz);
            this.recoilKick += def.recoil * (ev.aiming ? 0.5 : 1) * 1.4;
            this.camShake = Math.min(1, (this.camShake || 0) + kick[1]);
            break;
          }
          if (def.skyflare) {
            // no bullet: the flare, flown from the eye along the aim (as the server will) and drawn off the gun's
            // muzzle, low on the right ahead of the eye
            shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, 1, ev.seed, _dirs);
            const cp = Math.cos(ev.pitch);
            const mx = ev.x + Math.cos(ev.yaw) * 0.12 - Math.sin(ev.yaw) * cp * 0.5;
            const mz = ev.z - Math.sin(ev.yaw) * 0.12 - Math.cos(ev.yaw) * cp * 0.5;
            this.skyflares.fire(ev, _dirs[0], _dirs[1], _dirs[2], mx, ev.y - 0.12 + Math.sin(ev.pitch) * 0.5, mz);
            this.recoilKick += def.recoil * (ev.aiming ? 0.5 : 1) * 1.4;
            this.camShake = Math.min(1, (this.camShake || 0) + (kick ? kick[1] : 0.06));
            break;
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
          else a.playLocal(currentWeapon(s) === ITEM.CROSSBOW ? 'xbow_cock' : currentWeapon(s) === ITEM.AT_RIFLE ? 'at_bolt' : currentWeapon(s) === ITEM.RPG ? 'rpg_draw' : currentWeapon(s) === ITEM.FLARE_GUN ? 'flare_open' : 'reload_start');
          break;
        }
        case 'reload_done': {
          const w = currentWeapon(s);
          a.playLocal(w === ITEM.SHOTGUN ? 'pump' : w === ITEM.HUNTING_RIFLE ? 'bolt' : w === ITEM.AT_RIFLE ? 'at_bolt' : w === ITEM.CROSSBOW ? 'xbow_load' : w === ITEM.RPG ? 'rpg_load' : w === ITEM.FLARE_GUN ? 'flare_close' : 'reload_end');
          break;
        }
        case 'melee':
          if (ev.move !== undefined) {
            // a blow of the nunchucks lands (the move began at 'nk_swing'): what it met here, for the free handle to
            // come off and the hands to feel - the server says what it hurt
            const hit = nkStrike(this, s, ev);
            if (hit) {
              this.vm.nkHit(hit.kind, hit.nx, hit.ny, hit.nz, hit.power);
              this.selfBody?.nkHit(hit.kind, hit.power);
              this.camShake = Math.min(1, (this.camShake || 0) + 0.1 * hit.power);
            }
            break;
          }
          this.vm.melee(!!ev.heavy);
          this.selfBody?.melee();
          a.playLocal(s.zombie ? 'claw' : ev.heavy ? 'swing_heavy' : 'swing');
          break;
        case 'nk_swing':
          // a move of the nunchucks begins: the hands play it; its sounds are its own motion's (nkSounds)
          this.vm.nkSwing(ev.move);
          this.selfBody?.nkSwing(ev.move);
          break;
        case 'throw':
          this.vm.throwItem();
          a.playLocal('throw');
          break;
        case 'switch':
          a.playLocal('switch', { volume: 0.6 });
          break;
        case 'use_cancel':
          // a click (or a weapon asked for) put the item away: the weapon comes straight back out
          this.vm.cancelUse?.();
          if (!events.some((e) => e.type === 'switch')) a.playLocal('switch', { volume: 0.6 });
          break;
        case 'jump':
          a.playLocal('jump', { volume: 0.5 });
          break;
        case 'shove':
          // a shove at the leaper on us: the hands thrust (the viewmodel), the palms thump into it, the HUD's key jolts
          this.vm.shove(ev.v);
          this.shoves = (this.shoves | 0) + 1;
          a.playLocal('hit', { volume: 0.3 + 0.25 * ev.v, rate: 0.75 });
          this.camShake = Math.min(1, (this.camShake || 0) + 0.05);
          break;
        case 'land':
          a.playLocal('land'); // the view's dip comes with every landing, see the camera in update()
          break;
        case 'splash': {
          // into the water (shared/swim.js), from a jump or off the end of the pier: the view dips as on a landing
          const k = Math.min(1, ev.v / 12);
          a.footstep('water', undefined, undefined, undefined, 0.7 + 0.3 * k, { run: true });
          this.effects.splash(s.x - Math.sin(s.yaw) * 0.9, WATER_LEVEL, s.z - Math.cos(s.yaw) * 0.9, 0.3 + 0.5 * k);
          break;
        }
        case 'cart_bump':
          this.handcar.bump(); // our handcar run into the end of the line
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
      if (!locked && (this.overlay === 'gameover' || this.overlay === 'victory')) {
        inp.enabled = false; // (the run's end screen let the pointer go, for its poll: no pause menu over it)
      } else if (!locked && !this.ui.isTyping() && !this.screenUp()) {
        // (the browser kept the Esc for itself: back from the menu, the hammer is out with no piece up)
        this.dropBuildPick();
        this.ui.showPause(true);
        inp.enabled = false;
      } else if (locked) {
        this.ui.showPause(false);
        // A lock lands a moment after it is asked for, and a screen can open in that moment (I straight after the click
        // that takes the mouse back, the pause menu's way back with the map up, a chat line sent from the inventory). Held
        // over it the pointer can't click the screen and the input is off: the trigger is dead and, with Esc the page's
        // under fullscreen's keyboard lock, only leaving fullscreen got out. The screen keeps the pointer.
        inp.enabled = !this.screenUp();
        if (!inp.enabled) inp.exitLock();
      }
    };
    inp.handlers.onKey = (code, acts) => this.onKey(code, acts);
    // acts: what the key went down as (rebound since or not: what was started by it is what stops)
    inp.handlers.onKeyUp = (code, acts, cancelled) => {
      for (const a of acts) {
        if (a === 'talk' && this.settings.pushToTalk !== false) {
          this.pttHeld = false;
          if (!this.radio.keyed) this.voice.setTransmit(false); // (still keying the walkie-talkie: still talking)
        } else if (a === 'interact') {
          this.endHold();
          this.power.release();
          this.gun.keyUp();
        } else if (a === 'players' && !this.ui.rosterPinned) this.showRoster(false);
        else if (a === 'drop') this.dropHold.release(cancelled); // (let go too soon: the HUD says to hold it)
      }
    };
    inp.handlers.onBlur = () => this.ui.rosterPinned || this.showRoster(false);
  }

  // A key (or mouse button) went down: code, and the actions it is bound to (binds.js). Most keys are one action; a key
  // of the hands and a key of building can be the same one, and then which it is depends on the hammer being out.
  onKey(code, acts = actionsOf(code)) {
    if (this.state !== 'playing') return;
    const s = this.prediction.state;
    const ui = this.ui;
    const has = (a) => acts.includes(a);
    if (code === 'Escape') {
      if (ui.rosterPinned) this.pinRoster(false);
      else if (ui.mapOpen) this.toggleMap(false);
      else if (ui.boardOpen) this.toggleBoard(false);
      else if (ui.bestiaryOpen) this.toggleBestiary(false);
      else if (ui.spawnOpen) this.toggleSpawn(false);
      // (Esc only gets here with the mouse still taken under fullscreen's keyboard lock, keyguard.js: it shuts the ring,
      // then puts the piece down, and only then lets go of the mouse for the menu - whatever the input is doing: the
      // browser no longer lets go of the mouse on Esc itself, so this is the only way out short of leaving fullscreen)
      else if (this.input.locked) {
        if (this.buildMenu) this.closeBuildMenu(true);
        else if (!this.dropBuildPick(true)) this.input.exitLock();
      }
      return;
    }
    // (an admin's: it takes over the key from any bind on it)
    if (code === SPAWN_KEY && this.admin) {
      if (!ui.inventoryOpen && !ui.isTyping()) this.toggleSpawn(!ui.spawnOpen);
      return;
    }
    if (has('players')) {
      if (ui.rosterPinned) this.pinRoster(false);
      else this.showRoster(true);
      return;
    }
    // a click with the player list held up keeps it there, with the pointer free to pick someone out of it
    if (ui.rosterOpen && !ui.rosterPinned && this.input.locked && (has('fire') || has('aim'))) {
      this.pinRoster(true);
      return;
    }
    // (whatever else takes the screen or the keys lets go of a pinned list first)
    if (ui.rosterPinned && ['inventory', 'map', 'board', 'bestiary', 'chat'].some(has)) this.pinRoster(false, false);
    if (has('inventory')) {
      this.toggleInventory(!ui.inventoryOpen);
      return;
    }
    if (has('map')) {
      if (ui.inventoryOpen || ui.isTyping()) return;
      this.toggleMap(!ui.mapOpen);
      return;
    }
    if (has('board')) {
      if (ui.inventoryOpen || ui.isTyping()) return;
      this.toggleBoard(!ui.boardOpen);
      return;
    }
    if (has('bestiary')) {
      if (ui.inventoryOpen || ui.isTyping()) return;
      this.toggleBestiary(!ui.bestiaryOpen);
      return;
    }
    // Y as in Half-Life. Input only passes it on while in play; Enter also gets through from the inventory.
    if (has('chat')) {
      // (not from the map: the chat box is hidden under it and could never take the focus, which left
      // every key dead until a reload)
      if (!ui.isTyping() && !ui.mapOpen && !ui.boardOpen && !ui.bestiaryOpen) {
        ui.openChat();
        this.input.releaseAll();
        this.inputBuffer.clear();
      }
      return;
    }
    if (!this.input.enabled) return;
    const digit = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'].findIndex(has);
    if (digit >= 0) {
      // (the mounted gun in their arms: any weapon key reaches for that weapon, and the gun drops where they stand)
      if (digit === SLOT_THROW && s.slot === SLOT_THROW && !s.hmg) {
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
      // the hammer's key again with the hammer out: the ring of structures, to pick another (or put it away again)
      if (digit === SLOT_BUILD && s.slot === SLOT_BUILD && !s.zombie && !s.hmg && !s.using && this.self.alive && !s.downed) {
        if (this.buildMenu) this.closeBuildMenu(true);
        else this.openBuildMenu();
        return;
      }
      if (digit !== s.slot) this.lastSlot = s.slot;
      this.prediction.requestSlot(digit);
      return;
    }
    // hammer out: fire opens the ring of structures and fire in it picks the one pointed at (aim shuts it). With one
    // picked, fire places it and aim turns the piece. The build keys step through the structures (Q back, R / E on) -
    // but the interact key still interacts whenever the prompt offers it, and the ring is not up
    if (s.slot === SLOT_BUILD && !s.zombie) {
      const menu = this.buildMenu;
      const offered = !menu && has('interact') && !!this.prompt?.startsWith(bindTag('interact'));
      if (!offered) {
        if (has('buildPrev')) return this.cycleBuild(-1);
        if (has('buildNext')) return this.cycleBuild(1);
        if (has('demolish')) {
          if (this.lookTarget && this.lookTarget.kind === ENT.STRUCTURE) this.conn.action(ACT.DEMOLISH, this.lookTarget.id);
          return;
        }
      }
      if (this.self.alive && !s.downed && (has('fire') || has('aim'))) {
        // (with an item in the hands the click puts it away, as it does with a weapon out: asking for the slot we are on is
        // what does that here, the build mode's clicks being no fire button)
        if (menu) {
          if (has('fire')) this.pickStructure(menu.hover);
          else this.closeBuildMenu(true);
        } else if (has('fire') && s.using) this.prediction.requestSlot(SLOT_BUILD);
        else if (has('fire')) {
          if (this.buildPicked) this.tryBuild();
          else this.openBuildMenu();
        } else if (this.buildPicked) {
          this.buildRot = (this.buildRot - 32) & 255; // 45deg clockwise seen from above (+yaw is counter-clockwise)
          this.audio.playLocal('ui_click', { volume: 0.4 });
        }
        return;
      }
    }
    for (const a of acts) {
      switch (a) {
        case 'lastWeapon': {
          const t = this.lastSlot;
          this.lastSlot = s.slot;
          this.prediction.requestSlot(t);
          break;
        }
        case 'flashlight': {
          if (s.zombie) break;
          this.localFlash = !this.localFlash;
          if (this.localFlash && this.self.battery <= 1) this.localFlash = false;
          this.localFlashT = 0.6;
          this.conn.action(ACT.FLASHLIGHT, this.localFlash ? 1 : 0);
          this.audio.playLocal('flashlight');
          break;
        }
        case 'interact':
          this.interact();
          break;
        case 'ping':
          this.ping();
          break;
        case 'drop':
          this.pressDrop();
          break;
        case 'heal':
          this.quickHeal();
          break;
        case 'drink':
          this.quickDrink();
          break;
        case 'talk':
          if (this.settings.pushToTalk !== false) {
            this.pttHeld = true;
            this.voice.setTransmit(true);
          } else this.voice.setTransmit(!this.voice.transmitting);
          break;
      }
    }
  }

  // The drop key: the weapon in the hands goes on the ground once the key has been held a moment (drophold.js), or
  // at once with "Hold to drop weapon" off. Never a throwable (those are thrown), never as a zombie.
  pressDrop() {
    const s = this.prediction.state;
    if (s.hmg) return void this.gun.drop(); // the mounted gun in their arms goes down first, at a press (carrying it is all they do)
    if (s.zombie || s.slot === SLOT_THROW || !s.weapons[s.slot]) return;
    if (this.settings.holdToDrop === false) this.conn.action(ACT.DROP_WEAPON, s.slot);
    else this.dropHold.start(s.slot);
  }

  // The weapon that picking up one for this slot would put down: the slot is taken and the pack has no room for a
  // second (the server then swaps them: Game.interact on the server). 0 when it would just go in.
  swapsOut(slot) {
    const held = this.prediction.state.weapons[slot];
    if (!held) return 0;
    const cap = inventoryCap(this.inventory.backpack);
    for (let i = 0; i < cap; i++) if (!this.inventory.slots[i]) return 0;
    return held;
  }

  // A screen that takes clicks is up (the inventory, the map, the leaderboard, the bestiary, the spawn menu, the pinned
  // player list): the pointer is free for it, and the game's keys and buttons are off
  screenUp() {
    const ui = this.ui;
    return ui.inventoryOpen || ui.mapOpen || ui.boardOpen || ui.bestiaryOpen || ui.spawnOpen || ui.rosterPinned;
  }

  toggleInventory(open) {
    const ui = this.ui;
    if (open === ui.inventoryOpen) return;
    if (ui.mapOpen) this.toggleMap(false, false); // the inventory wants the pointer free as well
    if (ui.boardOpen) this.toggleBoard(false, false);
    if (ui.bestiaryOpen) this.toggleBestiary(false, false);
    ui.setCraftContext(this.craftContext());
    ui.setInventoryOpen(open);
    this.input.enabled = !open;
    if (open) this.input.exitLock();
    else this.input.requestLock();
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  // The player list, up for as long as [Tab] is held, with the pointer still locked and the game going on under it...
  showRoster(open) {
    const ui = this.ui;
    if (open === ui.rosterOpen) return;
    if (open) this.pushRoster(); // health as of now, not as of the last player list
    ui.setRosterOpen(open);
  }

  // ...until a click pins it up with the pointer free, the way the map frees it: a click on a player opens their
  // profile (ui/profile.js). Tab, Esc or its cross let it go. Clicks made while it is free never reach the weapon.
  // relock: false when something else that needs the cursor is taking over
  pinRoster(pin, relock = true) {
    const ui = this.ui;
    if (pin === ui.rosterPinned) return;
    this.input.releaseAll();
    this.inputBuffer.clear();
    this.endHold();
    if (pin) {
      this.pushRoster();
      ui.setRosterOpen(true);
      ui.setRosterPinned(true);
      this.input.enabled = false;
      this.input.exitLock();
    } else {
      ui.setRosterOpen(false);
      this.input.enabled = !ui.inventoryOpen && !ui.mapOpen && !ui.boardOpen && !ui.bestiaryOpen;
      if (this.input.enabled && relock) this.input.requestLock();
    }
    this.audio.playLocal('ui_click', { volume: 0.4 });
  }

  // relock: false when something else that needs the cursor is taking over
  toggleMap(open, relock = true) {
    const ui = this.ui;
    if (open === ui.mapOpen) return;
    if (open && ui.boardOpen) this.toggleBoard(false, false);
    if (open && ui.bestiaryOpen) this.toggleBestiary(false, false);
    ui.setMapOpen(open);
    this.input.enabled = !open && !ui.inventoryOpen;
    this.input.releaseAll();
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
    if (open && ui.bestiaryOpen) this.toggleBestiary(false, false);
    ui.setBoardOpen(open);
    this.input.enabled = !open && !ui.inventoryOpen;
    this.input.releaseAll();
    this.endHold();
    if (open) {
      this.boardT = 0; // ask the server at once (update)
      this.input.exitLock();
    } else if (relock) this.input.requestLock();
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  // The bestiary [J] (and the pause menu's button): it scrolls, so it frees the pointer as the leaderboard does.
  // relock: false when something else that needs the cursor is taking over
  toggleBestiary(open, relock = true) {
    const ui = this.ui;
    if (open === ui.bestiaryOpen || (open && this.state !== 'playing')) return;
    if (open && ui.mapOpen) this.toggleMap(false, false);
    if (open && ui.boardOpen) this.toggleBoard(false, false);
    if (open && ui.rosterPinned) this.pinRoster(false, false);
    if (open && ui.spawnOpen) this.toggleSpawn(false, false);
    ui.setBestiaryOpen(open);
    this.input.enabled = !open && !ui.inventoryOpen;
    this.input.releaseAll();
    this.endHold();
    if (open) this.input.exitLock();
    else if (relock) this.input.requestLock();
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  // The admin spawn menu [`] (ui/spawnmenu.js): a search box and a list to click, so it frees the pointer and keeps
  // the keys while it is up. Only offered when the server says we are an admin; it checks every command anyway.
  // relock: false when something else that needs the cursor is taking over
  toggleSpawn(open, relock = true) {
    const ui = this.ui;
    if (open === ui.spawnOpen || (open && !this.admin)) return;
    if (open && ui.mapOpen) this.toggleMap(false, false);
    if (open && ui.boardOpen) this.toggleBoard(false, false);
    if (open && ui.rosterPinned) this.pinRoster(false, false);
    if (open && ui.bestiaryOpen) this.toggleBestiary(false, false);
    ui.setSpawnOpen(open);
    this.input.enabled = !open && !ui.inventoryOpen;
    this.input.releaseAll();
    this.inputBuffer.clear();
    this.endHold();
    if (open) this.input.exitLock();
    else if (relock) this.input.requestLock();
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  // at: { x, z, zone } from a click on the field map (zone: the place it snapped to, or -1), null to clear
  setWaypoint(at) {
    const cur = this.waypoint;
    // a second click on the place that holds it takes it back
    if (!at || (cur && at.zone >= 0 && at.zone === cur.zone)) {
      if (!cur) return;
      this.waypoint = null;
      this.shareWaypoint();
      this.audio.playLocal('ui_click', { volume: 0.35 });
      return;
    }
    const zone = at.zone >= 0 ? this.world.zoneById[at.zone] : null;
    // you have arrived inside a place's yard, or a few steps from a bare spot
    this.waypoint = { x: at.x, y: this.world.heightAt(at.x, at.z), z: at.z, zone: at.zone, r: zone ? zone.flat : WAYPOINT_REACH, visited: !zone || this.discovered.has(at.zone), away: false };
    this.shareWaypoint();
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  // Tells the server where your waypoint is now (or that it is gone): it goes to everyone in the player list.
  // (A new game and a new valley clear everyone's on the server as well, so those need not be sent.)
  shareWaypoint() {
    const wp = this.waypoint;
    this.conn.action(ACT.WAYPOINT, wp && { x: wp.x, z: wp.z, zone: wp.zone });
  }

  // a place lends a waypoint its name once you know it: discovered, or rumoured to hold a supply or a schematic
  knowsPlace(z) {
    return z >= 0 && (this.discovered.has(z) || this.global.hints.includes(z) || this.global.schemHints.includes(z));
  }
  waypointName(z = this.waypoint.zone) {
    return this.knowsPlace(z) ? ZONE_NAMES[z] : 'Waypoint';
  }

  // a teammate has just set a waypoint: a word on screen, if it is one teamWaypoints shows us
  waypointSet(id, way) {
    const p = this.players.get(id);
    if (!this.world || p.status === 2 || (p.status === 1) !== !!this.prediction.state.zombie) return;
    this.ui.notify(`${p.name} marked ${this.knowsPlace(way.zone) ? ZONE_NAMES[way.zone] : 'a waypoint'}`, 'toast', 3);
    this.audio.playLocal('ui_click', { volume: 0.4 });
  }

  // The team's waypoints, from the player list: a survivor sees the other survivors' (downed ones too), a turned
  // player the other turned players'. One entry per spot (sameSpot), naming everyone headed there; `mine`: it is
  // where your own waypoint is too. -> [{ x, y, z, zone, names: [...], mine }] (reused)
  teamWaypoints() {
    const out = this._teamWays || (this._teamWays = []);
    out.length = 0;
    if (!this.world) return out;
    const turned = !!this.prediction.state.zombie;
    for (const [id, p] of this.players) {
      const w = p.way;
      // (status: 0 alive, 1 zombie, 2 dead, 3 downed)
      if (!w || id === this.myId || p.status === 2 || (p.status === 1) !== turned) continue;
      const same = out.find((o) => sameSpot(o, w));
      if (same) same.names.push(p.name);
      else out.push({ x: w.x, y: this.world.heightAt(w.x, w.z), z: w.z, zone: w.zone, names: [p.name], mine: !!this.waypoint && sameSpot(this.waypoint, w) });
    }
    return out;
  }

  // the build keys and the wheel: the next structure round the ring (opening it while none is picked yet), or with one
  // picked and the ring shut, the next one to place
  cycleBuild(dir) {
    const step = (t) => STRUCT_ORDER[(STRUCT_ORDER.indexOf(t) + dir + STRUCT_ORDER.length) % STRUCT_ORDER.length];
    if (!this.buildMenu && !this.buildPicked) this.openBuildMenu(false);
    const menu = this.buildMenu;
    if (menu) {
      menu.hover = step(menu.hover);
      const c = this.input.cursor;
      c.x = c.y = 0; // (or the pointer, still out over the old one, takes it straight back)
      this.audio.playLocal('ui_hover', { volume: 0.6 });
      return;
    }
    this.buildType = step(this.buildType);
    this.audio.playLocal('ui_click', { volume: 0.4 });
  }

  openBuildMenu(sound = true) {
    this.buildMenu = { hover: this.buildType };
    this.input.cursor = { x: 0, y: 0, r: BUILD_MENU_REACH };
    if (sound) this.audio.playLocal('ui_click', { volume: 0.4 });
  }

  closeBuildMenu(sound = false) {
    if (!this.buildMenu) return;
    this.buildMenu = null;
    this.input.cursor = null;
    if (sound) this.audio.playLocal('ui_click', { volume: 0.3 });
  }

  // the piece picked put down, the hammer still out (a click opens the ring again): false with none up
  dropBuildPick(sound = false) {
    if (!this.buildPicked) return false;
    this.buildPicked = false;
    if (sound) this.audio.playLocal('ui_click', { volume: 0.3 });
    return true;
  }

  pointBuildMenu(type) {
    const menu = this.buildMenu;
    if (!menu || menu.hover === type) return;
    menu.hover = type;
    this.audio.playLocal('ui_hover', { volume: 0.6 });
  }

  // a structure picked in the ring: its ghost goes up, to be placed. One whose schematic nobody has found stays shut.
  pickStructure(type) {
    const schem = STRUCT_DEFS[type]?.schem;
    if (schem && !((this.global.unlocked | 0) & (1 << SCHEM_BIT[schem]))) {
      this.ui.notify(`Locked · find the ${ITEM_DEFS[schem].name}`, 'warning', 1.5);
      this.audio.playLocal('build_fail', { volume: 0.5 });
      return;
    }
    this.buildType = type;
    this.buildPicked = true;
    this.closeBuildMenu();
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  quickHeal() {
    const inv = this.inventory.slots;
    const hp = this.self.hp;
    if (this.prediction.state.downed) return void this.ui.notify('Only a teammate can get you up', 'warning', 1.5);
    const order = hp < 45 ? [ITEM.MEDKIT, ITEM.VENISON, ITEM.BANDAGE, ITEM.TUNA, ITEM.PAINKILLERS] : HEAL_ITEMS;
    for (const item of order) {
      const idx = smallestStack(inv, item); // (the stack the server would take from: removeItem)
      if (idx >= 0) {
        if (this.useConsumable(idx, item)) this.audio.playLocal(item === ITEM.MEDKIT ? 'heal' : CONSUMABLES[item].meat ? 'eat' : CONSUMABLES[item].food ? 'can_open' : 'bandage');
        return;
      }
    }
    this.ui.notify('No healing items', 'warning', 1.5);
  }

  // The drink key ([B]): an energy drink from the backpack, stamina back in one go (the server turns one down at full stamina).
  // idx: the backpack slot clicked, when it was not the key
  quickDrink(idx = smallestStack(this.inventory.slots, ITEM.ENERGY_DRINK)) {
    const s = this.prediction.state;
    if (s.zombie || s.downed || s.using || this.self.useItem) return;
    if (idx < 0) return void this.ui.notify('No energy drinks', 'warning', 1.5);
    if (s.stamina >= STAMINA_MAX - 0.5 && !s.exhausted) return void this.ui.notify('Stamina is already full', 'info', 1.5);
    if (this.useConsumable(idx, ITEM.ENERGY_DRINK)) this.audio.playLocal('drink');
  }

  // the commands the prediction has made go out (force: now, not batched up for later; frameDt: Prediction.takeOutbox)
  sendCommands(frameDt, force) {
    for (let out; (out = this.prediction.takeOutbox(frameDt, force)); ) {
      const rt = this.renderTick;
      const rti = Math.floor(rt);
      this.conn.sendInput(rti, rt - rti, out, this.prediction.hash(out));
    }
  }

  // Starts using the consumable in backpack slot idx. The hands go onto it from the next command on (no weapon goes
  // off until it is used up or a click puts it away: simulatePlayer), and the server has them go onto it there too:
  // on the first command that reaches it after the request, so every one made before goes out ahead of it
  // (Game.useItem on the server). A use the server would turn down is not asked for at all.
  useConsumable(idx, item) {
    const c = CONSUMABLES[item];
    if (!c) return false;
    const s = this.prediction.state;
    if (useWasted(item, { hp: this.self.hp, maxHp: this.self.maxHp, battery: this.self.battery, downed: s.downed, stamina: s.stamina, exhausted: s.exhausted })) {
      this.ui.notify(c.flashlight ? 'Flashlight battery is full' : s.downed ? 'Only a teammate can get you up' : c.heal ? 'Health is full' : 'Stamina is already full', 'toast', 1.5);
      return false;
    }
    this.sendCommands(0, true);
    this.conn.action(ACT.USE_ITEM, idx);
    this.prediction.startUse();
    this.vm.useItem?.(c.time * perkMods(s.perks).useTime, item);
    return true;
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
    if (t.fair) return this.fair.interact(t);
    if (t.handcar) return this.handcar.interact(t);
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
    if (t.kind === ENT.STRUCTURE && this.power.press(t)) return; // (a generator: a tap pours fuel, held it is the switch)
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

  // Our own survivor, as the others see us, drawn from our own predicted state: only while a debug camera asks for it
  // (debugCam.body) - a look at the third person from outside without a second client (scripts/clip/nunchaku-film.js).
  // Everything else about a game with one player in it is as it always is: nobody has a body of their own.
  updateSelfBody(dt, s, rp, time, hspeed) {
    const want = !!(this.debugCam && this.debugCam.body && this.self.alive);
    if (!want) {
      if (this.selfBody) {
        this.scene.remove(this.selfBody.object);
        this.selfBody.dispose?.();
        this.selfBody = null;
      }
      return;
    }
    let sv = this.selfBody;
    if (!sv) {
      sv = this.selfBody = createSurvivor(this.myId || 1, this.players.get(this.myId)?.character ?? -1);
      sv.object.traverse((m) => m.isMesh && (m.castShadow = true));
      this.scene.add(sv.object);
      this.selfBodyItem = -1;
    }
    const item = s.zombie ? 0 : currentWeapon(s);
    if (item !== this.selfBodyItem) {
      this.selfBodyItem = item;
      sv.setWeapon(item);
    }
    sv.object.position.set(rp.x, rp.y, rp.z);
    sv.object.rotation.y = this.input.yaw;
    sv.update(dt, { speed: hspeed, sprint: !!s.sprinting, crouch: !!s.crouch, pitch: this.input.pitch, onGround: !!s.onGround, reloading: item !== ITEM.NUNCHAKU && s.reloadT > 0, wind: item === ITEM.NUNCHAKU ? s.reloadT : undefined, dead: false, time });
    const nk = item === ITEM.NUNCHAKU ? sv.nk() : null;
    if (nk) nkSounds(this.audio, nk.core, this.vm.visible ? null : { x: rp.x, y: rp.y + 1.3, z: rp.z }, this.nkSt2, time);
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
        if (it && CONSUMABLES[it.item]?.drink) return void this.quickDrink(i); // (that very can)
        const c = it && CONSUMABLES[it.item];
        if (!c) return this.conn.action(ACT.USE_ITEM, i); // (armour, a schematic: taken at once)
        if (this.useConsumable(i, it.item) && c.food) this.audio.playLocal(c.meat ? 'eat' : 'can_open'); // (venison comes in no tin)
      },
      onDropItem: (i, n) => this.conn.action(ACT.DROP_SLOT, i, n),
      onSplitItem: (i, n) => this.conn.action(ACT.SPLIT_INV, i, n),
      onDropAmmo: (cal, n) => this.conn.action(ACT.DROP_AMMO, cal, n),
      onUndoDrop: () => this.conn.action(ACT.UNDO_DROP),
      onSalvage: (from, n) => {
        this.conn.action(ACT.SALVAGE, from, n);
        this.audio.playLocal('craft', { volume: 0.6 }); // (the server's sound leaves us out)
      },
      onSwapItems: (a, b) => this.conn.action(ACT.SWAP_INV, a, b),
      onEquipArmor: (i) => this.conn.action(ACT.EQUIP_ARMOR, i),
      onDropWeapon: (slot) => this.conn.action(ACT.DROP_WEAPON, slot),
      onUnequip: (slot, to = 255) => this.conn.action(ACT.UNEQUIP, slot, to),
      onWorn: (which, what) => this.conn.action(ACT.WORN, which, what),
      onSelectStructure: (t) => this.buildMenu && this.pickStructure(t),
      onHoverStructure: (t) => this.pointBuildMenu(t),
      onSelectThrowable: (item) => this.conn.action(ACT.SELECT_THROWABLE, item),
      onCloseInventory: () => this.state === 'playing' && this.toggleInventory(false),
      onChatSend: (text) => {
        if (this.devCommand(text)) return;
        this.conn.chat(text);
      },
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
    const menu = this.state === 'menu' || !this.world;
    this.renderer.setCenter(menu ? this.ui.splash.sceneX : 0.5); // (beside the splash's menu, the scene is off-centre)
    if (menu) {
      this.endCine();
      return this.updateMenu(dt);
    }
    const cine = this.updateCine();
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
    // The pointer held with nothing up is play, and a screen up has the pointer (onLockChange keeps both). Should any
    // path still leave the input off under a held pointer, the trigger would be dead with Esc ignored: not past a frame.
    // (Not on the way to the end screen or between two servers on a deploy: the input is off there on purpose.)
    if (inp.locked && !this.moving && !this.overlay && !this.ui.pauseOpen && !this.ui.isTyping()) {
      if (this.screenUp()) inp.exitLock();
      else if (!inp.enabled) inp.enabled = true;
    }
    inp.buildMode = s.slot === SLOT_BUILD && !s.zombie;
    // prediction
    const buttons = cine ? 0 : this.gun.shape(self.alive ? inp.sample() | this.fair.press | this.handcar.press : 0); // (manning the mounted gun: its trigger, not the weapon's. fair.press, handcar.press: [E] getting out of a seat, off a handcar)
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
    this.sendCommands(dt, attacked);
    this.sendCrafts(dt);
    // interpolation clock: corrections are eased in (a step in the clock is a step in every remote entity),
    // and the render delay widens a little when snapshots arrive unevenly so entities don't stall and lurch
    const adj = this.clockAdj * Math.min(1, dt * 6);
    this.clockAdj -= adj;
    this.clientTick += dt * SERVER_TICK_RATE + adj;
    const extra = Math.min(1.5, Math.max(0, 2.5 * Math.sqrt(this.jitter2) - 0.6));
    this.interpExtra += Math.max(-dt * 0.5, Math.min(dt * 0.5, extra - this.interpExtra));
    this.renderTick = this.clientTick - INTERP_DELAY * SERVER_TICK_RATE - this.interpExtra;
    this.fair.update(dt, time); // (the ride clock of this frame: riders, ourselves included, are placed by it)
    this.handcar.update(dt); // (where each handcar is drawn this frame: their riders are placed on them)

    // camera
    this.prediction.renderPos(dt, this.renderPos);
    const rp = this.renderPos;
    this.fair.carry(rp);
    const targetEye = eyeHeight(s);
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * (s.downed ? 5 : 12));
    const hspeed = Math.hypot(s.vx, s.vz);
    // afloat (shared/swim.js): the hands are swimming, the view rides the water, the stride is a stroke
    const swim = !!self.alive && swimming(this.world, s);
    this.swimK += ((swim ? 1 : 0) - this.swimK) * Math.min(1, dt * 3);
    if (swim !== this.swimming) this.onSwim(swim);
    if (s.onGround && hspeed > 0.5) this.camBob += dt * hspeed * (s.downed ? 3.2 : swim ? 1.3 : 1.9);
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
    const bobY = Math.sin(this.camBob * 2) * (s.downed ? 0.06 : 0.035) * Math.min(1, hspeed / 5) - this.landDip - stepLag - this.quake * 0.03 + this.swimK * (Math.sin(time * 1.7) * 0.035 + Math.sin(time * 0.63) * 0.02);
    this.recoilKick *= Math.exp(-dt * 10);
    this.camShake = Math.max(0, (this.camShake || 0) - dt * 2.5);
    const shake = this.camShake * 0.02 + this.effects.shake * 0.03 + this.quake * 0.02;
    const cam = this.camera;
    if (cine) {
      cine.update(dt, cam); // (a cutscene: the shot's camera, and its own field of view)
      cam.position.y += (Math.random() - 0.5) * shake;
    } else if (this.debugCam) {
      const d = this.debugCam;
      cam.position.set(d.x, d.y, d.z);
      cam.rotation.set(d.pitch, d.yaw, 0);
    } else if (self.alive) {
      cam.position.set(rp.x, rp.y + this.eyeH + bobY, rp.z);
      const roll = (s.downed ? 0.18 + Math.sin(time * 1.3) * 0.03 : 0) + this.swimK * Math.sin(time * 1.1) * 0.025;
      cam.rotation.set(inp.pitch + this.recoilKick + (Math.random() - 0.5) * shake, inp.yaw + (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.5 + roll);
      // nunchucks: the view goes with the strikes - a sprung nod, turn and roll from the moves and from what they hit
      // (ViewModel's rig, as of last frame). "Weapon look sway" off leaves the view still
      const nk = this.vm.itemId === ITEM.NUNCHAKU && this.settings.weaponSway !== false ? this.vm.nk?.core : null;
      if (nk) {
        cam.rotation.x += nk.kick.x;
        cam.rotation.y += nk.kick.y;
        cam.rotation.z += nk.kick.z;
      }
    } else {
      // death cam: slumped on the ground looking up
      cam.position.set(rp.x, rp.y + 0.35, rp.z);
      cam.rotation.set(0.9, inp.yaw, 0.4);
    }
    // ADS zoom
    const wdef = WEAPONS[currentWeapon(s)];
    const aiming = self.alive && !!(buttons & 256) && wdef && !wdef.melee && s.reloadT <= 0 && !this.handcar.handsOn && !swim; // (hands on a handcar's lever, or swimming: no sights)
    const baseFov = (this.debugCam && this.debugCam.fov) || this.settings.fov || 75; // (a debug camera may bring its own lens)
    const targetFov = aiming ? baseFov * (currentWeapon(s) === ITEM.HUNTING_RIFLE ? 0.45 : currentWeapon(s) === ITEM.AT_RIFLE ? 0.6 : 0.78) : s.sprinting ? baseFov * 1.06 : baseFov;
    this.fovCur += (targetFov - this.fovCur) * Math.min(1, dt * 12);
    if (!cine && Math.abs(cam.fov - this.fovCur) > 0.01) {
      cam.fov = this.fovCur;
      cam.updateProjectionMatrix();
    }
    // the anti-tank rifle's round going home, partway through its long reload
    if (currentWeapon(s) === ITEM.AT_RIFLE && s.reloadT > 0) {
      const reload = wdef.reload * perkMods(s.perks).reload;
      if (!this.atRoundIn && reload - s.reloadT >= reload * AT_ROUND_IN) {
        this.atRoundIn = true;
        this.audio.playLocal('at_round');
      }
    } else this.atRoundIn = false;
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
      else this.vm.setItem(s.slot === SLOT_BUILD && !weaponNow ? 0 : weaponNow, { tuck: self.alive }); // (tuck: nunchucks are folded away first)
    }
    const [ldx, ldy] = inp.consumeLook();
    this.vm.setVisible(self.alive && !cine && !this.ui.inventoryOpen && !this.ui.mapOpen && !this.ui.boardOpen && !this.ui.bestiaryOpen && !this.debugCam && !this.gun.manning && !s.hmg && !this.handcar.handsOn && !swim);
    const lk = this.settings.weaponSway === false ? 0 : 0.0022 * inp.sensitivity;
    const wallDist = self.alive ? this.weaponClearance(cam) : 99; // (the viewmodel tucks back off a wall in front)
    const vmState = { speed: hspeed, sprint: !!s.sprinting, onGround: !!s.onGround, crouch: !!s.crouch, aiming, lookDX: ldx * lk, lookDY: ldy * lk, time, loaded: s.mags[0] > 0, talk: this.radio.keyed, wallDist, pinned: !!s.pinned && !!self.alive, shove: s.shove };
    if (this.vm.itemId === ITEM.NUNCHAKU) {
      // (asked of the view itself: for a moment after another weapon is asked for they are still in the hands, being
      // folded away)
      // nunchucks: their chain hangs in the world, not in the view - it needs which way the eye looks and how the
      // eye is being carried (so it swings as the view turns and trails as the body starts and stops); and the
      // heavy attack's wind-up clock, straight from the predicted state
      const k = dt > 0 ? 1 / dt : 0;
      _nkAcc.set((s.vx - this.nkVx) * k, 0, (s.vz - this.nkVz) * k).applyQuaternion(_nkQ.copy(cam.quaternion).invert());
      this.nkVx = s.vx;
      this.nkVz = s.vz;
      vmState.camQ = cam.quaternion;
      vmState.acc = _nkAcc;
      vmState.nkWind = weaponNow === ITEM.NUNCHAKU ? s.reloadT : 0;
      // (the reload key has nothing to reload: it asks for the flourish)
      if (weaponNow === ITEM.NUNCHAKU && buttons & BTN.RELOAD && !(this.nkBtn & BTN.RELOAD) && self.alive) {
        if (this.vm.nkFlourish()) this.selfBody?.nkFlourish();
      }
      this.nkBtn = buttons;
    }
    // (forcing a car's boot: the weapon in the hand is the lever)
    const prying = self.holdKind === HOLD.SEARCH && this.entities.ents.get(this.holding);
    vmState.pry = !!(prying && this.bootOf(prying)?.shut && pryWeapon(weaponNow));
    this.vm.update(dt, vmState);
    if (this.vm.itemId === ITEM.NUNCHAKU && this.vm.nk) nkSounds(this.audio, this.vm.nk.core, null, this.nkSt, time);
    this.updateSelfBody(dt, s, rp, time, hspeed);
    if (this.vmMuzzleT > 0) {
      this.vmMuzzleT -= dt;
      if (this.vmMuzzleT <= 0) this.renderer.vmMuzzle.intensity = 0;
    }
    // a flamethrower's roar stops a moment after its last puff; its light dies down with the fire it left
    this.flameLights.length = 0;
    for (const [id, f] of this.flames) {
      const L = f.light;
      if (f.t > 0) {
        L.intensity += (f.glow - L.intensity) * Math.min(1, dt * 18);
        if ((f.t -= dt) <= 0) {
          f.loop?.stop();
          f.loop = undefined;
        }
      } else if ((L.intensity -= dt * 3.5) <= 0) {
        this.flames.delete(id);
        continue;
      }
      const m = Math.min(1, dt * 14); // (it follows the aim, not jumping puff to puff)
      L.x += (f.at.x - L.x) * m;
      L.y += (f.at.y - L.y) * m;
      L.z += (f.at.z - L.z) * m;
      this.flameLights.push(L);
    }

    // local footsteps (afloat: strokes, and a slow paddle treading water)
    if (self.alive && s.onGround && hspeed > 1) {
      this.stepAcc += hspeed * dt;
      const stride = swim ? (s.sprinting ? 2.4 : 1.9) : s.sprinting ? 2.6 : s.crouch ? 1.4 : 2.1;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.audio.footstep(swim ? 'water' : this.surfaceAt(rp.x, rp.y, rp.z), undefined, undefined, undefined, swim ? (s.sprinting ? 0.7 : 0.45) : s.crouch ? 0.25 : s.sprinting ? 0.8 : 0.5, { crouch: !!s.crouch, run: !!s.sprinting });
        if (swim) this.effects.splash(rp.x - Math.sin(inp.yaw) * 0.7, WATER_LEVEL, rp.z - Math.cos(inp.yaw) * 0.7, s.sprinting ? 0.18 : 0.1);
      }
    } else if (swim && (this.treadT -= dt) <= 0) {
      this.treadT = 1.6 + Math.random() * 0.8;
      this.audio.footstep('water', undefined, undefined, undefined, 0.2, { crouch: true });
    }
    if (swim && s.stamina < 30 && !this.swimTired) {
      this.swimTired = true;
      this.ui.notify(s.stamina > 0 ? 'Tiring in the water: get your feet on the bottom before you run out of stamina.' : 'Drowning! Get to shallow water.', 'toast', 5);
    }

    // flashlight: local prediction, server authoritative after a moment
    if (this.localFlashT > 0) this.localFlashT -= dt;
    else this.localFlash = !!self.flashlight;

    // entities
    this.entities.update(dt, this.renderTick, time, cine ? cam.position : rp);
    if (cine) this.entities.hidePlayers(); // (they are in the car, or the plane: the cutscene draws them there)
    this.live?.update(dt, this.global, !!cine);
    this.rockets.update(dt);
    this.skyflares.update(dt, cam); // (after the entities: their fires are gathered; before the environment and the lights)
    this.gun.update(dt, ldx * lk, ldy * lk);

    // interaction target
    this.updateLookTarget();
    this.highlight.update(dt);
    this.updateBuildGhost(s);

    // discovery of places
    this.discoverT -= dt;
    // (a drift of the mine runs under places it does not come up in)
    if (this.discoverT <= 0 && self.alive && !cine && !s.zombie && !this.world.mine?.under(rp.x, rp.y + 0.3, rp.z)) {
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
        this.shareWaypoint();
        // a place seen for the first time has just said so itself ("Discovered")
        if (wp.visited) this.ui.notify(wp.zone >= 0 ? `Arrived · ${ZONE_NAMES[wp.zone]}` : 'Waypoint reached', 'toast', 2.5);
      }
    }
    this.pings = this.pings.filter((p) => time - p.t < PING_LIFE);

    // environment
    const g = this.global;
    const cycle = this.debugCycle ?? cine?.cycle ?? Environment.cycleFor(g.phase, g.timeLeft, g.day, g.phaseLen);
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
    this._envOver.fogMul = this.debugFog ?? (cine ? cine.fogMul : 0); // (a cutscene's long shots see further than the day's haze lets a survivor; debugFog: a look-dev camera's)
    this.env.update(dt, cycle, cam.position, time, weather, this._envOver);
    this.viewDist = Math.max(cine ? cine.far : 0, this.env.fogVisibility + 40); // how far anything is drawn: past it the haze has it
    this.staticWorld.update(cam.position, this.viewDist);
    this.foliage.update(cam.position, this.env.fogVisibility, time, weather, cam);
    if (this.water) {
      const u = this.water.material.uniforms;
      u.uTime.value = time;
      u.uSky.value.copy(this.env.cur.horizon);
      u.uSunDir.value.copy(this.env.sunHeight > -0.05 ? this.env.uniforms.uSunDir.value : this.env.uniforms.uMoonDir.value);
      u.uSunCol.value.copy(this.env.cur.dir);
      u.uCam.value.copy(cam.position);
    }
    const fires = this.entities.fireSources.concat(this.staticFires, this.fair.lights, this.flameLights);
    this.lights.update(dt, time, cam.position, this.localFlash && self.alive && !s.zombie, fires, this.entities.remoteFlash, Math.max(this.env.night, this.under));
    this.power.update(dt, time, cam.position, Math.max(this.env.night, this.under));
    // nearest big fire warms the viewmodel & the ambience
    let nearFire = 0;
    for (const f of fires) {
      if (!f.big || !(f.intensity > 0)) continue;
      nearFire = Math.max(nearFire, Math.max(0, 1 - Math.hypot(rp.x - f.x, rp.z - f.z) / 14) * f.intensity);
    }
    // viewmodel lighting follows the world
    this.updateViewmodelLight(dt, cam, Math.max(nearFire, this.power.eyeLit), this.flames.get(-1)?.light.intensity || 0); // (in a floodlight's cone the hands are lit too)
    this.renderer.vmFlash.intensity = this.localFlash && self.alive ? 0.35 : 0;

    this.effects.setAmbient(Math.max(this.env.night, this.under)); // (down the mine it is night at noon)
    this.effects.update(dt, cam, this.renderer.renderer.domElement.height);
    this.impacts.update(dt);
    this.flyover.update(dt, time, cam, this.env, weather);
    this.graves.update(dt);
    const flashOn = this.localFlash && self.alive && !s.zombie;
    // (no rain or blown leaves once the eye is well down a drift: what falls in the mouth is kept out by its roof)
    const sky = this.under > 0.5 ? Object.assign(this._wxDown, weather, DOWN_WEATHER) : weather;
    this.atmosphere.update(dt, time, cam, this.env, flashOn, this.world.heightAt, sky);
    this.weatherFx.update(dt, time, cam, sky, this.env, flashOn, this.renderer.renderer.domElement.height);

    // audio
    const a = this.audio;
    if (cine) a.setListener(cam.position.x, cam.position.y, cam.position.z, cam.rotation.y, cam.rotation.x);
    else a.setListener(cam.position.x, cam.position.y, cam.position.z, inp.yaw, inp.pitch);
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
      nightPhase: g.phase === PHASE.NIGHT,
      cycle: this.env.cycle,
      open: this.openness,
      indoor: Math.max(this.indoor, this.under),
    });

    // overlays by phase
    this.updateOverlays();
    this.radio.update(s);
    // HUD
    this.updateHud(dt, s, aiming, wdef);
    this.keyHints.update(dt);
    // the drop key held long enough (and still able to: alive, on their feet, the controls live, the same weapon out)
    const canDrop = !!self.alive && !s.zombie && !s.downed && this.input.enabled;
    if (this.dropHold.update(dt, s.slot, canDrop) === 'drop' && s.weapons[s.slot] && s.slot !== SLOT_THROW) this.conn.action(ACT.DROP_WEAPON, s.slot);
    if (this.ui.mapOpen) this.updateMap(s);
    // the leaderboard is asked for while it is up: as it opens, then every few seconds (it moves as people play)
    if (this.ui.boardOpen && performance.now() >= this.boardT) {
      this.boardT = performance.now() + BOARD_EVERY;
      this.conn.board();
    }
    // voice: how loud everyone is talking, for their mouths (entities.js), and the talking indicators
    this.voice.sampleMouths(performance.now());
    if (this.frame % 6 === 0) {
      const talking = this.voice.poll();
      const key = talking.map((id) => (this.voice.overRadio(id) ? 'r' : '') + id).join();
      if (key !== this.talkKey) {
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

  // The cutscene that is on, if one is (cutscene.js): the crossing while the server's phase is PHASE.CROSSING, the
  // take-off for the first TAKEOFF_TIME seconds of a victory on the mainland. Started and ended here, off the global
  // state, so a client that joins or comes back in the middle of one is in it at the right moment.
  updateCine() {
    const g = this.global;
    if (g.phase === PHASE.CROSSING) {
      if (!(this.cine instanceof Crossing)) {
        this.endCine();
        this.startCine(new Crossing(this));
      }
      this.cine.sync(CROSSING.TIME - g.timeLeft);
    } else if (g.phase === PHASE.VICTORY && this.act === WORLD.MAINLAND && this.live?.plane) {
      if (!this.cine && !this.tookOff) {
        this.tookOff = true;
        const left = g.restartT - (GAME_OVER_DELAY + 6);
        if (left > 1) {
          this.startCine(new Takeoff(this, this.live.plane));
          this.cine.t = Math.max(0, TAKEOFF_TIME - left);
        }
      } else if (this.cine && this.cine.t >= TAKEOFF_TIME) this.endCine();
    } else {
      this.tookOff = false;
      this.endCine();
    }
    return this.cine || null;
  }
  startCine(c) {
    this.cine = c;
    this.ui.setMapOpen(false);
    this.ui.setBoardOpen(false);
    this.ui.setBestiaryOpen(false);
    this.ui.setSpawnOpen(false);
    this.closeBuildMenu();
    this.ui.setRosterOpen(false);
    if (this.ui.inventoryOpen) this.toggleInventory(false);
    this.endHold();
    this.inputBuffer.clear();
  }
  endCine() {
    if (!this.cine) return;
    this.cine.dispose();
    this.cine = null;
  }

  // Behind the splash: a walk around the valley at eye level (menutour.js), or, in one with no road to walk, a slow
  // turn around the car
  updateMenu(dt) {
    if (!this.world) return;
    const cam = this.camera;
    if (this.tour?.world !== this.world) this.tour = new MenuTour(this.world, !this.tour);
    let cut = 0;
    if (this.tour.ready) cut = this.tour.update(dt, cam);
    else {
      this.menuAngle += dt * 0.04;
      const car = this.world.car;
      const gy = this.world.heightAt(car.x, car.z);
      cam.position.set(car.x + Math.sin(this.menuAngle) * 15, gy + 3.4, car.z + Math.cos(this.menuAngle) * 15);
      cam.lookAt(car.x, gy + 1.2, car.z);
    }
    this.ui.splash.setCut(cut);
    this.highlight.reset(); // (no outline left over from the game just left)
    const weather = this.weather.update(dt, null, this.time, cam.position);
    this.env.update(dt, 0.49, cam.position, this.time, weather);
    this.staticWorld.update(cam.position, this.env.fogVisibility + 40);
    this.foliage.update(cam.position, this.env.fogVisibility, this.time, weather, cam);
    this.lights.update(dt, this.time, cam.position, false, this.staticFires, [], this.env.night);
    this.power.update(dt, this.time, cam.position, this.env.night); // (no floodlight is left lit from the game before)
    this.effects.update(dt, cam, this.renderer.renderer.domElement.height);
    this.impacts.update(dt);
    this.atmosphere.update(dt, this.time, cam, this.env, false, this.world.heightAt, weather);
    this.weatherFx.update(dt, this.time, cam, weather, this.env, false, this.renderer.renderer.domElement.height);
    this.vm?.setVisible(false);
    // (the state is set before the engine is ready too, so it fetches intro.mp3 first and opens on the splash's mix)
    this.audio.setAmbience({ night: 0.6, horde: false, boss: false, danger: 0, lowHealth: 0, nearFire: 0, dead: false, menu: true });
    if (this.audio.ready) this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, cam.rotation.y, 0);
    this.post = { time: this.time, night: this.env.night, damage: 0, lowHealth: 0, infected: 0, dead: 0, exposure: this.env.exposure, rays: this.env.rays };
  }

  // a lightning strike's light reached us: the bolt now, its thunder when the sound gets here
  onLightning(s) {
    this.weatherFx?.strike(s, this.camera.position);
    this.audio.thunder(s.x, s.z, s.dist, s.delay);
  }

  // The end screen asks how hard the run was (ui/menus.js EndScreen): the pointer goes free so it can be clicked
  freePointerForEnd() {
    this.ui.showPause(false);
    this.input.exitLock();
    this.input.enabled = false;
  }

  // ...and once it is down and the next run is on, a pointer it let go is taken back as after any pause, with a click
  pointerAfterEnd() {
    if (this.state !== 'playing' || this.input.locked || this.ui.isTyping()) return;
    this.ui.showPause(true);
    this.input.enabled = false;
  }

  updateOverlays() {
    const g = this.global;
    if (g.phase === PHASE.GAMEOVER && this.overlay !== 'gameover') {
      this.overlay = 'gameover';
      this.ui.setMapOpen(false);
      this.ui.setBoardOpen(false);
      this.ui.setBestiaryOpen(false);
      this.ui.setSpawnOpen(false);
      const kills = [...this.players.values()].map((p) => ({ name: p.name, kills: p.kills }));
      // (on the mainland a wipe is the end of the whole run: the next one begins on the island)
      const reason = this.world.car.plane ? 'Every survivor has fallen on the mainland. The run starts over on the island.' : 'Every survivor has fallen.';
      this.ui.showGameOver({ days: g.day, kills, reason, restartIn: Math.ceil(g.restartT), record: this.runReport, progress: this.progress });
      this.freePointerForEnd();
    } else if (g.phase === PHASE.VICTORY && this.overlay !== 'victory' && !this.cine) {
      this.overlay = 'victory';
      this.ui.setMapOpen(false);
      this.ui.setBoardOpen(false);
      this.ui.setBestiaryOpen(false);
      this.ui.setSpawnOpen(false);
      const kills = [...this.players.values()].map((p) => ({ name: p.name, kills: p.kills }));
      // The run is won for everyone, but the car took whoever was at it: a survivor further off than ESCAPE_RADIUS
      // when it left stayed in the valley, and so did the players who had already turned.
      const car = this.world.car;
      let title = 'You escaped';
      let reason = 'The engine roars. You tear down Route 9 and leave the valley behind.';
      const plane = !!car.plane; // (the mainland: the run ends in the air)
      if (plane) reason = 'The wheels leave the runway. Port Calder, the bridge and the island fall away behind you.';
      if (!this.self.alive || this.prediction.state.zombie) {
        title = 'They escaped';
        reason = plane ? 'The plane is a speck over the hills. You stay on the mainland with the rest of the dead.' : 'The engine roars and the car is gone down Route 9. You stay in the valley with the rest of the dead.';
      } else if (Math.hypot(this.renderPos.x - car.x, this.renderPos.z - car.z) > ESCAPE_RADIUS) {
        title = 'Left behind';
        reason = plane ? 'The plane goes without you. The others made it off the mainland.' : 'The car tears down Route 9 without you. The others made it out of the valley.';
      }
      this.ui.showVictory({ days: g.day, kills, title, reason, plane, restartIn: Math.ceil(g.restartT), record: this.runReport, progress: this.progress });
      this.freePointerForEnd();
    } else if ((g.phase === PHASE.DAY || g.phase === PHASE.NIGHT) && (this.overlay === 'gameover' || this.overlay === 'victory')) {
      this.overlay = null;
      this.ui.hideOverlays();
      this.pointerAfterEnd();
    }
    // death overlay clears when we rise as a zombie
    if (this.deathShown && this.self.alive && this.self.zombie) {
      this.deathShown = false;
      this.ui.hideOverlays();
      this.ui.notify('YOU HAVE RISEN', 'big', 4);
      this.ui.notify(this.dawnAhead() ? `Hunt the survivors until dawn. [${bindPair('aim')}] to leap.` : `Hunt the survivors. [${bindPair('aim')}] to leap.`, 'sub', 4);
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
      const kind = w.roadKindAt(x, z);
      return kind === 2 ? 'road' : kind === 4 ? 'gravel' : 'dirt'; // (4: the bed of the railway, its ballast)
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
    const was = this.lookTarget;
    this.lookTarget = null;
    this.prompt = null;
    if (!this.self.alive || s.zombie || s.downed) return;
    if (s.ride) return this.fair.rideLook(s);
    if (s.cart) return this.handcar.rideLook(s);
    if (this.gun.look(true)) return; // hands on the mounted gun (at its grips, or carrying it): [E] is the gun's
    cam.getWorldDirection(_v);
    const ox = cam.position.x;
    const oy = cam.position.y;
    const oz = cam.position.z;
    const e = this.entities.pick(ox, oy, oz, _v.x, _v.y, _v.z, INTERACT_REACH, this.renderPos.y + EYE_HEIGHT, was);
    const counts = this.invCounts();
    const g = this.global;
    if (e) {
      if (e.kind === ENT.ITEM) {
        const d = ITEM_DEFS[e.item];
        this.lookTarget = e;
        const n = e.q[3];
        // a weapon whose slot is taken, with no room in the pack for it: taking it puts the one in that slot down
        const swap = d?.cat === 'weapon' && WEAPONS[e.item] ? this.swapsOut(WEAPONS[e.item].slot) : 0;
        this.prompt = swap ? `${bindTag('interact')} Swap your ${ITEM_DEFS[swap].name} for the ${d.name}` : `${bindTag('interact')} Pick up ${d?.name || 'item'}${n > 1 ? ` ×${n}` : ''}`;
        // (something the recipe tracked on the HUD is still short of)
        if (trackedNeed(e.item, counts)) this.prompt += ` · needed for ${ITEM_DEFS[trackedRecipe().out].name} (tracked)`;
        return;
      }
      if (e.kind === ENT.CACHE) {
        this.lookTarget = e;
        const name = CONT_DEFS[e.ctype]?.name || 'Container';
        this.prompt = e.q[3] === 0 ? `${bindTag('interact')} Hold to search ${name}` : `${name} · searched`;
        // (a car's boot is forced open - with what is in the hand, or slowly without: shared/trunk.js)
        const boot = this.bootOf(e);
        if (boot && e.q[3] === 0) {
          const w = pryWeapon(currentWeapon(s));
          this.prompt = boot.shut ? (w ? `${bindTag('interact')} Hold to pry the trunk open with the ${ITEM_DEFS[w].name}` : `${bindTag('interact')} Hold to force the trunk open by hand (slow: a blade or a bat is quicker)`) : `${bindTag('interact')} Hold to search the open trunk`;
        } else if (boot) this.prompt = 'Car Trunk · forced open, searched';
        const r = e.q[3] === 0 && trackedRecipe();
        const want = r && Object.keys(r.cost).find((k) => trackedNeed(+k, counts) && mayHold(e.ctype, +k));
        if (want) this.prompt += ` · may hold ${ITEM_DEFS[want].name} (tracked)`;
        return;
      }
      if (e.kind === ENT.PLAYER && e.downed) {
        this.lookTarget = e;
        this.prompt = `${bindTag('interact')} Hold to revive ${this.name(e.id)}`;
        return;
      }
      if (e.kind === ENT.CRATE) {
        this.lookTarget = e;
        this.prompt = `${bindTag('interact')} Open supply crate`;
        return;
      }
      if (e.kind === ENT.STRUCTURE) {
        this.lookTarget = e;
        const def = STRUCT_DEFS[e.stype];
        const hp = e.q[3] / 255;
        const power = this.power.prompt(e, counts, s.slot === SLOT_BUILD); // what a generator or a floodlight is doing
        if (power) this.prompt = power;
        else if (e.stype === STRUCT.CAMPFIRE) {
          const lit = e.q[4] === 1;
          const w = counts[ITEM.WOOD] || 0;
          const st = counts[ITEM.STICK] || 0;
          this.prompt = w || st ? `${bindTag('interact')} ${lit ? 'Feed' : 'Relight'} the fire (${w ? `${w} Planks` : `${st} Sticks`})` : lit ? 'Campfire · feed it Planks or Sticks' : 'The fire is out · needs Planks or Sticks';
          if (s.slot === SLOT_BUILD) this.prompt += ` · ${bindTag('demolish')} Remove`;
        } else if (s.slot === SLOT_BUILD) {
          if (e.stype === STRUCT.TORCH) this.prompt = hp < 1 || e.q[4] === 0 ? `${bindTag('interact')} Relight torch (1 Cloth) · ${bindTag('demolish')} Remove` : `${bindTag('demolish')} Remove torch`;
          else this.prompt = hp < 0.99 ? `${bindTag('interact')} Repair ${def.name} (1 Planks, 1 Nails) · ${bindTag('demolish')} Demolish` : `${bindTag('demolish')} Demolish ${def.name}`;
        } else if (def.station === 'bench') this.prompt = `Workbench · craft here ${bindTag('inventory')}`;
        this.contextStructure = { name: def.name, hp };
        return;
      }
    }
    if (this.gun.look(false)) return; // at the grips of the mounted gun
    // the bell rope, the radio set
    if (this.fixtures.look(ox, oy, oz, _v.x, _v.y, _v.z, this.renderPos.y + EYE_HEIGHT, counts)) return;
    if (this.fair.look(ox, oy, oz, _v.x, _v.y, _v.z, counts)) return;
    if (this.handcar.look(ox, oy, oz, _v.x, _v.y, _v.z)) return;
    // the car
    const car = this.world.car;
    const dcar = Math.hypot(this.renderPos.x - car.x, this.renderPos.z - car.z);
    if (dcar < CAR_REACH + (car.plane ? PLANE_REACH : 0)) {
      this.lookTarget = 'car';
      const missing = SUPPLIES.filter((p, i) => g.supplies[i] < SUPPLY_NEED[i]);
      const carrying = missing.filter((p) => counts[p]);
      if (g.finale && car.plane) this.prompt = g.escapeReady ? (g.runwayBlocked ? 'The dead are on the runway: clear it' : `${bindTag('interact')} Hold to get in and take off`) : g.standWarm ? 'Defend the plane until the engines are warm' : 'Hold the fuel truck until the tanks are full';
      else if (g.finale) this.prompt = g.escapeReady ? `${bindTag('interact')} Hold to get in and drive away` : 'Defend the car until the engine is warm';
      else if (!missing.length) this.prompt = car.plane ? `${bindTag('interact')} Hold to start fuelling (the runway stand)` : `${bindTag('interact')} Hold to start the engine (final stand)`;
      else if (carrying.length) this.prompt = `${bindTag('interact')} Install ${carrying.map((p) => ITEM_DEFS[p].name).join(', ')}`;
      else this.prompt = `${W.The} needs: ${missing.map((p) => ITEM_DEFS[p].name).join(', ')}`;
    }
    // nothing to interact with: a tree or a wreck within a swing's reach says what hitting it gives
    if (!this.prompt) {
      this.prompt = harvestPrompt(this.world, s, this.stripped);
      if (this.prompt) this.prompt = this.impacts.alarmPrompt(harvestTarget()) || this.prompt; // (a wreck whose alarm is going: how to stop it)
    }
  }

  updateBuildGhost(s) {
    const active = s.slot === SLOT_BUILD && !s.zombie && this.self.alive && !s.downed;
    for (const k in this.ghosts) this.ghosts[k].visible = false;
    this.ghostPlace = null;
    if (!active) {
      this.buildPicked = false; // (the hammer drawn again starts at the ring)
      this.closeBuildMenu();
      this.ui.setBuildMenu(null);
      return;
    }
    // (the pointer let go of - the pause menu, the inventory: the ring goes with it)
    if (this.buildMenu && (!this.input.enabled || !this.input.locked)) this.closeBuildMenu();
    const counts = this.invCounts();
    const ctx = this.craftContext();
    const unlocked = this.global.unlocked | 0;
    let menu = null;
    if (this.buildMenu) {
      const c = this.input.cursor;
      if (Math.hypot(c.x, c.y) > BUILD_MENU_DEAD) this.pointBuildMenu(STRUCT_ORDER[radialIndex(c.x, c.y)]);
      menu = { hover: this.buildMenu.hover, x: c.x / c.r, y: c.y / c.r };
    }
    if (!this.buildPicked) {
      this.ui.setBuildMenu({ picked: false, counts, ctx, unlocked, menu });
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
    const afford = !!planCost(counts, def.cost, ctx);
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
    this.ui.setBuildMenu({ picked: true, selected: this.buildType, rotate: Math.round((((256 - this.buildRot) & 255) / 256) * 360), counts, ctx, valid, reason, unlocked, menu });
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
    const h = this.hud || (this.hud = { crosshair: { spread: 10, visible: true }, weapons: [0, 0, 0, 0, 0, 0] });
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
    h.weapons[SLOT_RADIO] = s.zombie ? 0 : ITEM.WALKIE; // (everyone's)
    h.radioKeyed = this.radio.keyed;
    h.throwItem = s.weapons[SLOT_THROW];
    h.throwCount = s.throwCount;
    h.dropHold = this.dropHold.progress; // the drop key's hold, 0..1 (-1: not held)
    h.dropHint = this.dropHold.hint > 0 ? bindLabel('drop') : ''; // (let go too soon: "Hold G to drop")
    // pinned by a leaper: the shove meter (-1: not pinned), the key to mash, and the presses so far (each jolts it)
    h.shove = self.alive && s.pinned && !s.zombie ? s.shove : -1;
    h.shoveKey = h.shove >= 0 ? bindLabel('jump') : '';
    h.shoves = this.shoves | 0;
    const w = currentWeapon(s);
    const def = WEAPONS[w];
    if (def && !def.melee) {
      h.mag = s.mags[s.slot === SLOT_PRIMARY ? 0 : 1];
      h.reserve = s.ammo[def.ammo];
      h.reloading = s.reloadT > 0 ? 1 - s.reloadT / (def.reload * perkMods(s.perks).reload) : -1;
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
    h.standWarm = g.standWarm; // (the plane's stand: the truck is done, the engines are warming)
    h.runwayBlocked = g.runwayBlocked;
    h.escapeLeaving = g.escapeLeaving;
    h.tonight = this.tonight(g);
    const boss = g.bossId ? this.entities.ents.get(g.bossId) : null;
    h.boss = boss ? { name: ZOMBIE_DEFS[boss.ztype].name, hp: boss.q[5] / 255 } : null;
    h.prompt = h.shove >= 0 ? null : this.prompt; // (pinned: nothing in reach can be used, and the meter is there)
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
      h.useLabel = self.holdKind === HOLD.SEARCH ? `Searching${t ? ' ' + (CONT_DEFS[t.ctype]?.name || '').toLowerCase() : ''}…` : self.holdKind === HOLD.REVIVE ? `Reviving ${t ? this.name(t.id) : ''}…` : self.holdKind === HOLD.DRIVE ? 'Getting in…' : self.holdKind === HOLD.FAIR_START ? 'Starting the generator…' : self.holdKind === HOLD.FAIR_STOP ? 'Shutting it off…' : 'Starting the engine…';
      h.useLabel = this.fixtures.holdLabel(self.holdKind) || h.useLabel;
      if (self.holdKind === HOLD.GUN_LIFT) h.useLabel = 'Lifting the gun…';
      if (self.holdKind === HOLD.SEARCH && t && this.bootOf(t)?.shut) h.useLabel = pryWeapon(currentWeapon(this.prediction.state)) ? 'Prying the trunk open…' : 'Forcing the trunk open…';
    } else {
      // (put away by a click, it is gone at once: the server's word on it is a round trip off)
      h.useProgress = self.useItem && this.prediction.state.using ? self.useProgress : -1;
      const c = CONSUMABLES[self.useItem];
      h.useLabel = self.useItem ? `${c?.food ? 'Eating' : c?.drink ? 'Drinking' : 'Using'} ${ITEM_DEFS[self.useItem]?.name || ''}` : '';
      this.power.hud(h); // ([E] held on a generator's switch)
    }
    // context panel
    const counts = this.invCounts();
    h.heals = HEAL_ITEMS.reduce((n, it) => n + (counts[it] || 0), 0);
    h.drinks = counts[ITEM.ENERGY_DRINK] || 0; // what the drink key has left
    // the recipe tracked on the HUD (game/tracked.js), against what we carry and the stations in reach
    const tracked = !s.zombie && self.alive ? trackedRecipe() : null;
    if (tracked && (!this.trackNear || this.frame % 20 === 5)) this.trackNear = this.craftContext();
    h.tracked = tracked ? { r: tracked, counts, near: this.trackNear, unlocked: g.unlocked | 0 } : null;
    if (this.lookTarget && this.lookTarget.kind === ENT.STRUCTURE) h.context = !s.zombie && currentWeapon(s) === ITEM.HAMMER ? { type: 'structure', name: STRUCT_DEFS[this.lookTarget.stype].name, hp: this.lookTarget.q[3] / 255 } : null;
    else h.context = this.fair.hud();
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
    const loose = {};
    for (const p of this.looseParts()) loose[p.item] = (loose[p.item] || 0) + 1;
    h.objective = { supplies: g.supplies, hints: g.hints, found: g.found, carried, loose, anyCarried, phase: g.phase, timeLeft: Math.ceil(g.timeLeft), finale: g.finale, escapeT: Math.ceil(g.escapeT), escapeReady: g.escapeReady, escapeStalled: g.escapeStalled, escapeLeaving: g.escapeLeaving, standWarm: g.standWarm, runwayBlocked: g.runwayBlocked, suppliesDone: g.suppliesDone, wave: g.wave, waves: g.waves };
    // downed overlay
    h.downed = self.alive && s.downed ? { bleed: self.bleed || 0, reviving: !!self.beingRevived } : null;
    // compass + world markers
    h.yaw = this.input.yaw;
    this.buildMarkers(h, rp);
    // the minimap: only while it is on screen
    h.minimap = !h.zombie && !this.ui.inventoryOpen && !this.ui.mapOpen && !this.ui.boardOpen && !this.ui.bestiaryOpen ? this.mapData(counts) : null;
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
    const carIcon = glyph(W.glyph);
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
    // discovered places nearby (a place that already has a supply icon or a waypoint on it needs no flag too)
    const wp = this.waypoint;
    const team = this.teamWaypoints();
    for (const z of this.world.zones) {
      if (!this.discovered.has(z.id) || z.id === ZONE.CAMP || hintSeen.has(z.id) || wp?.zone === z.id || team.some((t) => t.zone === z.id)) continue;
      const d = dist(z.x, z.z);
      if (d < 30 || d > 260) continue;
      cm.push({ kind: 'poi', bearing: bearing(z.x - rp.x, z.z - rp.z), icon: glyph('flag'), label: '', name: `${ZONE_NAMES[z.id]} · ${Math.round(d)}m`, d });
    }
    // the team's waypoints: on the tape while in view, and a marker on the spot like yours (raised the same way). One
    // on the spot of your own adds no flag: yours says who else is headed there
    let along = '';
    for (const t of team) {
      const who = t.names.join(', ');
      if (t.mine) {
        along = who;
        continue;
      }
      const d = dist(t.x, t.z);
      const name = `${who}: ${this.waypointName(t.zone)}`;
      const label = `${Math.round(d)}m`;
      cm.push({ kind: 'teamway', bearing: bearing(t.x - rp.x, t.z - rp.z), icon: glyph('flag'), label, name, d });
      if (d > 8 && this.project(t.x, t.y + 2.4 + d * 0.07, t.z, _sc)) wm.push({ kind: 'teamway', x: _sc.x, y: _sc.y, icon: glyph('flag'), name, sub: label, scale: 0.85 });
    }
    // your waypoint: always on the tape (pinned to its end when behind you), and a marker standing on the spot
    if (wp) {
      const d = dist(wp.x, wp.z);
      const name = this.waypointName();
      const label = `${Math.round(d)}m`;
      cm.push({ kind: 'way', bearing: bearing(wp.x - rp.x, wp.z - rp.z), icon: glyph('flag'), label, name, d, pinEdge: true });
      // (raised with the distance, so that walking at it the marker floats over the crosshair and not on it)
      if (d > 8 && this.project(wp.x, wp.y + 2.4 + d * 0.07, wp.z, _sc)) wm.push({ kind: 'way', x: _sc.x, y: _sc.y, icon: glyph('flag'), name, sub: along ? `${label} · ${along} too` : label, scale: 0.95 });
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
            sub: e.downed ? `DOWN · ${e.beingRevived ? 'being revived' : near ? `hold ${bindTag('interact')} to revive` : `${Math.round(d)}m`}` : d > 15 ? `${Math.round(d)}m` : '',
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
      wm.push({ kind: 'car', x: sc.x, y: sc.y, icon: carIcon, name: g.finale ? (g.escapeReady ? 'GET IN' : g.escapeStalled ? 'Engine stalled' : `Defend the ${W.thing}`) : W.your, sub: `${Math.round(dCar)}m`, cls: g.finale ? 'urgent' : '', scale: 0.95 });
    }
  }

  updateMap(s) {
    this.ui.map.update(this.mapData());
    void s;
  }

  // this act's car supplies lying loose on the ground, of the kinds the car still needs
  looseParts() {
    const g = this.global;
    return (g.parts || []).filter((p) => {
      const i = SUPPLIES.indexOf(p.item);
      return i >= 0 && g.supplies[i] < SUPPLY_NEED[i];
    });
  }

  // what the field map [M] and the minimap show
  mapData(counts = this.invCounts()) {
    const g = this.global;
    const mates = [];
    const crates = [];
    const enemies = []; // the living zombies, and players turned (big: a Tank or a boss)
    for (const e of this.entities.ents.values()) {
      if (e.kind === ENT.PLAYER) {
        if (e.q[5] & PFLAG.DEAD) continue;
        if (e.q[5] & PFLAG.ZOMBIE) enemies.push({ x: e.rx, z: e.rz, big: false });
        else mates.push({ x: e.rx, z: e.rz, name: this.name(e.id), status: e.downed ? 'downed' : 'alive' });
      } else if (e.kind === ENT.ZOMBIE) {
        if (!e.dead) enemies.push({ x: e.rx, z: e.rz, big: e.ztype === ZTYPE.TANK || !!ZOMBIE_DEFS[e.ztype]?.boss });
      } else if (e.kind === ENT.CRATE && e.q[3] !== 2) crates.push({ x: e.rx, z: e.rz });
    }
    const carried = {};
    SUPPLIES.forEach((it) => counts[it] && (carried[it] = counts[it]));
    return {
      parts: this.looseParts(),
      self: { x: this.renderPos.x, z: this.renderPos.z, yaw: this.input.yaw },
      mates,
      enemies,
      car: this.world.car,
      pings: this.pings,
      crates,
      benches: g.benches,
      discovered: this.discovered,
      hints: g.hints,
      found: g.found,
      schemHints: g.schemHints,
      unlocked: g.unlocked | 0,
      supplies: g.supplies,
      carried,
      waypoint: this.waypoint,
      teamWays: this.teamWaypoints(),
    };
  }
}

export { MAX_PLAYERS, DUSK_WARNING, AMMO_NAMES, ZTYPE, dqpos };
