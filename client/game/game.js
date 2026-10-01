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
  DUSK_WARNING,
  EYE_HEIGHT,
} from '../../shared/constants.js';
import {
  ITEM,
  ITEM_DEFS,
  WEAPONS,
  STRUCT,
  STRUCT_DEFS,
  STRUCT_ORDER,
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
  ZONE,
  ZONE_NAMES,
  AMMO_NAMES,
  AMMO_ITEMS,
  CONSUMABLES,
} from '../../shared/defs.js';
import { ACT, ENT, HOLD, CAR_ID, PING_KIND, PFLAG, dqpos } from '../../shared/protocol.js';
import { createWorld } from '../../shared/world.js';
import { shotDirections, currentWeapon, eyeHeight } from '../../shared/playersim.js';
import { raycastWorld, makeBox, overlapBoxes, COL } from '../../shared/collision.js';
import { readGlobal, readSelf, readEntities, readEvents } from '../net/decode.js';
import { Connection } from '../net/connection.js';
import { Prediction } from './prediction.js';
import { Entities } from './entities.js';
import { Input } from './input.js';
import { Voice } from './voice.js';
import { Environment } from '../render/environment.js';
import { buildTerrain, buildWater } from '../render/terrain.js';
import { StaticWorld } from '../render/staticworld.js';
import { Foliage } from '../render/foliage.js';
import { Effects } from '../render/effects.js';
import { Lights } from '../render/lights.js';
import { Atmosphere } from '../render/atmosphere.js';
import { WeatherFX } from '../render/weatherfx.js';
import { Weather } from './weather.js';
import { ViewModel } from '../render/models/weapons.js';
import { createGhost } from '../render/models/structures.js';
import { itemIcon, glyph } from '../ui/icons.js';
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
const _ray = { t: -1, col: null, terrain: false };
const _dirs = new Float32Array(48);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _p = new THREE.Vector3();

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
    this.global = { phase: PHASE.WAITING, day: 0, timeLeft: 0, hordeLeft: -1, bossId: 0, supplies: [0, 0, 0, 0, 0], hints: [255, 255, 255, 255, 255, 255, 255], unlocked: 0, wave: 0, waves: 3, escapeT: 0, flags: 0, finale: false, suppliesDone: false, escapeReady: false, humansAlive: 0, playersTotal: 0, restartT: 0 };
    this.self = { alive: 1, hp: 100, maxHp: 100, armor: 0, armorMax: 0, battery: 100, weapons: [0, 0, 0, 0, 0], mags: [0, 0], ammo: AMMO_ITEMS.map(() => 0) };
    this.inventory = { slots: new Array(INVENTORY_SIZE).fill(null), armor: null };
    this.players = new Map(); // id -> {name, status, kills, ping}
    this.renderPos = new THREE.Vector3();
    this.clientTick = 0;
    this.clockInit = false;
    this.clockAdj = 0; // pending clock correction, eased in over a few frames
    this.latestTick = 0; // newest snapshot received
    this.jitter2 = 0; // mean squared snapshot arrival error (ticks^2)
    this.lateRun = 0; // consecutive snapshots far behind the clock
    this.interpExtra = 0; // extra interpolation delay (ticks) on a jittery connection
    this.renderTick = 0;
    this.damageFx = 0;
    this.hitFx = 0;
    this.recoilKick = 0;
    this.camBob = 0;
    this.eyeH = 1.62;
    this.fovCur = settings.fov || 75;
    this.buildType = STRUCT.BARRICADE;
    this.buildRot = 0;
    this.ghosts = {};
    this.lastSlot = SLOT_PISTOL;
    this.localFlash = false;
    this.localFlashT = 0;
    this.stepAcc = 0;
    this.deathShown = false;
    this.overlay = null;
    this.prevPhase = -1;
    this.lastHudInvKey = '';
    this.talkPeers = [];
    this.lookTarget = null;
    this.menuAngle = 0;
    this.lowHpBeat = 0;
    this.holding = 0; // hold-to-interact target we told the server about
    this.pings = [];
    this.discovered = new Set([ZONE.CAMP]);
    this.discoverT = 0;
    this.debugCam = null;

    this.input = new Input(renderer.canvas);
    this.input.sensitivity = settings.sensitivity || 1;
    this.input.invertY = !!settings.invertY;
    this.input.rawInput = settings.rawMouse !== false;
    this.conn = new Connection({
      snapshot: (r) => this.onSnapshot(r),
      inventory: (r) => this.onInventory(r),
      chat: (id, flags, text) => this.onChat(id, flags, text),
      players: (r) => this.onPlayers(r),
      voice: (from, payload) => this.voice.onSignal(from, payload),
      close: () => this.onDisconnect(),
    });
    this.voice = new Voice(this.conn, audio);
    this.voice.onState = (s) => this.ui.setVoiceState({ ...s, speakers: this.talkPeers.map((id) => this.players.get(id)?.name || '?') });
    this.env = new Environment(this.scene);
    this.weather = new Weather();
    this.weather.onStrike = (s) => this.onLightning(s);
    this.lights = new Lights(this.scene, this.camera, renderer.q);
    this.vm = new ViewModel();
    renderer.vmScene.add(this.vm.group);
    this.vmItem = -1;
    this.entities = new Entities(this);
    this.prediction = new Prediction(null);
    this.setupInputHandlers();
  }

  // ---------------------------------------------------------------- world
  loadWorld(seed) {
    if (this.seed === seed && this.world) return;
    const t0 = performance.now();
    if (this.world) this.unloadWorld();
    this.seed = seed;
    this.world = createWorld(seed);
    this.prediction.setWorld(this.world);
    const t1 = performance.now();
    this.terrain = buildTerrain(this.world);
    this.scene.add(this.terrain);
    this.water = buildWater(this.world);
    this.scene.add(this.water);
    const t2 = performance.now();
    this.staticWorld = new StaticWorld(this.scene, this.world);
    const t3 = performance.now();
    this.foliage = new Foliage(this.scene, this.world, this.renderer.q);
    const t4 = performance.now();
    if (!this.effects) this.effects = new Effects(this.scene, this.renderer.vmScene, this.world);
    else this.effects.world = this.world;
    if (!this.atmosphere) this.atmosphere = new Atmosphere(this.scene);
    this.weather.setWorld(this.world);
    if (!this.weatherFx) this.weatherFx = new WeatherFX(this.scene, this.renderer.quality);
    this.weatherFx.setWorld(this.world, this.weather);
    this.staticFires = [];
    for (const l of this.world.lights) {
      if (l.kind === 'embers') {
        // burning barrels / smouldering wrecks
        this.effects.createEmitter('barrel', l.x, l.y, l.z);
        this.staticFires.push({ x: l.x, y: l.y - 0.4, z: l.z, intensity: 0.75 });
      }
    }
    this.ui.map.setWorld(this.world);
    console.log(`[client] world ${seed}: gen ${(t1 - t0).toFixed(0)}ms, terrain ${(t2 - t1).toFixed(0)}ms, static ${(t3 - t2).toFixed(0)}ms, foliage ${(t4 - t3).toFixed(0)}ms, rest ${(performance.now() - t4).toFixed(0)}ms`);
  }

  unloadWorld() {
    this.scene.remove(this.terrain);
    this.scene.remove(this.water);
    this.staticWorld?.dispose();
    this.world = null;
  }

  // ---------------------------------------------------------------- connection
  async join(name) {
    this.audio.stinger?.('join');
    const info = await this.conn.connect(name);
    this.myId = info.id;
    this.voice.setMyId(info.id);
    this.loadWorld(info.seed);
    this.entities.clear();
    this.clientTick = info.tick;
    this.clockInit = false;
    this.interpExtra = 0;
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
    this.discovered = new Set([ZONE.CAMP]);
    this.renderer.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked && !this.ui.inventoryOpen && !this.ui.isTyping()) this.input.requestLock();
    });
    return info;
  }

  onDisconnect() {
    if (this.state !== 'playing') return;
    this.state = 'menu';
    this.input.enabled = false;
    this.input.exitLock();
    this.entities.clear();
    this.voice.closeAll();
    this.ui.setMapOpen(false);
    this.ui.hideOverlays();
    this.ui.showSplash();
    this.ui.setJoinError('Disconnected from server.');
  }

  leave() {
    this.conn.close();
  }

  onSnapshot(r) {
    const tick = r.u32();
    const ack = r.u16();
    if (r.u8()) this.global = readGlobal(r);
    readSelf(r, this.self);
    readEntities(r, this.entities.store, tick);
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
    this.prediction.reconcile(ack, this.self);
    readEvents(r, this.eventHandler);
  }

  onInventory(r) {
    const slots = this.inventory.slots;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const item = r.u8();
      const count = r.u8();
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
    if (flags & 1) this.ui.addChat('', text, { system: true });
    else {
      const p = this.players.get(id);
      this.ui.addChat(p ? p.name : '???', text, { zombie: !!(flags & 2), color: flags & 2 ? '#7fae5a' : undefined });
    }
    this.audio.playLocal?.('chat', { volume: 0.5 });
  }

  onPlayers(r) {
    const n = r.u8();
    const seen = new Set();
    const list = [];
    for (let i = 0; i < n; i++) {
      const id = r.u16();
      const name = r.str();
      const status = r.u8();
      const kills = r.u16();
      const ping = r.u16();
      seen.add(id);
      this.players.set(id, { name, status, kills, ping });
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
    const ST = ['alive', 'zombie', 'dead', 'downed'];
    for (const [id, p] of this.players) list.push({ id, name: p.name, status: ST[p.status] === 'downed' ? 'alive' : ST[p.status] || 'alive', kills: p.kills, ping: id === this.myId ? Math.round(this.conn.rtt) : p.ping, talking: this.talkPeers.includes(id), self: id === this.myId });
    this.ui.setPlayers(list);
    this.voice.syncPlayers([...this.players.keys()]);
  }

  name(id) {
    return this.players.get(id)?.name || 'Someone';
  }

  // ---------------------------------------------------------------- events
  get eventHandler() {
    if (this._eh) return this._eh;
    const g = this;
    this._eh = {
      sound(snd, x, y, z) {
        // (HORDE_HORN / DAWN / PLANE are always played 2D by the audio engine)
        g.audio.play(snd, { x, y, z });
      },
      shot(ev) {
        g.remoteShot(ev);
      },
      impact(kind, x, y, z, nx, ny, nz) {
        // hits on ourselves are shown by the damage vignette, not particles in our face
        const dc = Math.hypot(x - g.camera.position.x, y - g.camera.position.y, z - g.camera.position.z);
        if (dc < 1.2) return;
        g.effects.impact(kind, x, y, z, nx, ny, nz);
        if (kind === 1 || kind === 6) g.audio.play(SOUND.FLESH_HIT, { x, y, z, volume: 0.6 });
      },
      hitmark(flags) {
        g.ui.hitmarker(!!(flags & 1), !!(flags & 2));
        g.audio.playLocal(flags & 1 ? 'headshot' : 'hitmarker', { volume: 0.7 });
        if (flags & 2) g.audio.playLocal('kill', { volume: 0.5 });
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
        const killer = kk === KILLER.PLAYER ? g.name(killerId) : kk === KILLER.ZOMBIE ? ZOMBIE_DEFS[killerId]?.name || 'Zombie' : 'The world';
        const victim = victimId & 0x8000 ? ZOMBIE_DEFS[victimId & 0xff]?.name || 'Zombie' : g.name(victimId);
        g.ui.killfeed({ killer, victim, weaponItem: weapon, headshot: !!(flags & 1), killerZombie: kk === KILLER.ZOMBIE || (kk === KILLER.PLAYER && g.players.get(killerId)?.status === 1), victimPlayer: !(victimId & 0x8000) });
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
      structBreak(x, y, z) {
        g.effects.structBreak(x, y, z);
      },
      ping(pid, kind, x, y, z) {
        g.pings = g.pings.filter((p) => p.pid !== pid);
        g.pings.push({ pid, kind, x, y, z, t: g.time, name: g.name(pid) });
        g.audio.playLocal('notify', { volume: 0.7 });
      },
      summary(s) {
        // after the "DAY N" title card has faded
        setTimeout(() => g.state === 'playing' && g.ui.showSummary(s, nextNightText(s.night + 1)), 4300);
      },
    };
    return this._eh;
  }

  onNotify(msg, arg) {
    const ui = this.ui;
    const a = this.audio;
    switch (msg) {
      case NOTIFY.NIGHT_FALLS:
        ui.notify(`NIGHT ${arg}`, 'big', 4);
        ui.notify(arg <= 1 ? 'The horde is coming to wherever you are. Hold your shelter.' : `Horde ${arg}: more of them than last night.`, 'sub', 4);
        a.stinger?.('night');
        break;
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
        ui.notify('THE HORDE IS COMING', 'danger', 5);
        ui.notify('Board up where you stand: door boards, barricades, a campfire.', 'toast', 6);
        break;
      case NOTIFY.BOSS:
        ui.notify(ZOMBIE_DEFS[arg]?.name?.toUpperCase() || 'SOMETHING', 'big', 4);
        ui.notify('has risen from the woods.', 'sub', 4);
        a.stinger?.('boss');
        break;
      case NOTIFY.SHADE:
        ui.notify('A SHADE IS OUT THERE', 'danger', 4);
        ui.notify('It only moves in the dark. Keep a light on it: flashlight, torch, campfire or flare.', 'toast', 7);
        a.playLocal('notify');
        break;
      case NOTIFY.SUPPLY_DROP:
        ui.notify('A supply plane drones overhead... watch the treeline for red smoke.', 'toast', 6);
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
      case NOTIFY.ENGINE_START:
        ui.notify('THE FINAL STAND', 'big', 5);
        ui.notify('The engine is warming up. Every corpse in the valley heard it. Hold the car!', 'sub', 6);
        a.stinger?.('boss');
        break;
      case NOTIFY.ESCAPE_READY:
        ui.notify('GET IN THE CAR!', 'big', 5);
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
        this.deathInfo = { killer: arg === 255 ? 'the wilderness' : ZOMBIE_DEFS[arg]?.name || 'the dead', day: this.global.day, night: this.global.phase === PHASE.NIGHT };
        ui.showDeath(this.deathInfo);
        a.stinger?.('death');
        this.deathShown = true;
        break;
      case NOTIFY.PLAYER_DIED:
        if (arg !== this.myId) ui.notify(`${this.name(arg)} has fallen... and will rise as one of them.`, 'danger', 5);
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
      case NOTIFY.NOT_ENOUGH:
        ui.notify(arg ? `You need ${ITEM_DEFS[arg]?.name || 'materials'}` : 'Not enough materials', 'warning', 2.5);
        a.playLocal('build_fail');
        break;
      case NOTIFY.SEARCH_EMPTY:
        ui.notify(arg === 1 ? 'This tree is stripped bare' : arg === 2 ? 'Nothing left to salvage' : 'Already searched', 'toast', 1.6);
        break;
      case NOTIFY.INVENTORY_FULL:
        ui.notify('Inventory full', 'warning', 2);
        break;
      case NOTIFY.CAMPFIRE_LIT:
        ui.notify('The fire roars back to life.', 'good', 2);
        break;
      case NOTIFY.NEW_GAME:
        ui.hideOverlays();
        this.overlay = null;
        this.deathShown = false;
        this.discovered = new Set([ZONE.CAMP]);
        this.pings = [];
        ui.notify(`DAY ${arg}`, 'big', 5);
        ui.notify('Your car died on Route 9. Find the supplies to fix it - before the dark finds you.', 'sub', 6);
        break;
      case NOTIFY.PLAYER_JOINED:
      case NOTIFY.PLAYER_LEFT:
        break;
    }
  }

  remoteShot(ev) {
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

  // ---------------------------------------------------------------- local predicted events
  onLocalEvents(events, s) {
    const a = this.audio;
    for (const ev of events) {
      switch (ev.type) {
        case 'fire': {
          const def = WEAPONS[ev.weapon];
          this.vm.fire();
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
          // tracers from the gun (visual), hits are server authoritative
          const n = shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, def.pellets, ev.seed, _dirs);
          const cp = Math.cos(ev.pitch);
          const sx = ev.x + Math.cos(ev.yaw) * 0.12 - Math.sin(ev.yaw) * cp * 0.5;
          const sz = ev.z - Math.sin(ev.yaw) * 0.12 - Math.cos(ev.yaw) * cp * 0.5;
          const sy = ev.y - 0.12 + Math.sin(ev.pitch) * 0.5;
          for (let i = 0; i < n; i++) {
            if (def.pellets > 1 && i % 2) continue;
            const dx = _dirs[i * 3];
            const dy = _dirs[i * 3 + 1];
            const dz = _dirs[i * 3 + 2];
            raycastWorld(this.world, ev.x, ev.y, ev.z, dx, dy, dz, def.range, _ray);
            const dist = _ray.t >= 0 ? _ray.t : Math.min(def.range, 90);
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
          a.playLocal('land');
          this.landDip = 0.12;
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
      if (!locked && !this.ui.inventoryOpen && !this.ui.isTyping() && !this.ui.mapOpen) {
        this.ui.showPause(true);
        inp.enabled = false;
      } else if (locked) {
        this.ui.showPause(false);
        inp.enabled = !this.ui.inventoryOpen && !this.ui.mapOpen;
      }
    };
    inp.handlers.onMouseDown = (button) => {
      if (this.state !== 'playing') return;
      const s = this.prediction.state;
      if (button === 1) return this.ping();
      if (s.slot === SLOT_BUILD && !s.zombie && this.self.alive && !s.downed) {
        if (button === 0) this.tryBuild();
        else if (button === 2) {
          this.buildRot = (this.buildRot + 32) & 255;
          this.audio.playLocal('ui_click', { volume: 0.4 });
        }
      }
    };
    inp.handlers.onKey = (code) => this.onKey(code);
    inp.handlers.onKeyUp = (code) => {
      if (code === 'KeyV' && this.settings.pushToTalk !== false) this.voice.setTransmit(false);
      if (code === 'KeyE') this.endHold();
    };
  }

  onKey(code) {
    if (this.state !== 'playing') return;
    const s = this.prediction.state;
    const ui = this.ui;
    if (code === 'Tab') {
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
    if (code === 'Enter') {
      if (!ui.isTyping()) {
        ui.openChat();
        this.input.buttons = 0;
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
    if (ui.mapOpen) this.toggleMap(false);
    ui.setCraftContext(this.craftContext());
    ui.setInventoryOpen(open);
    this.input.enabled = !open;
    if (open) this.input.exitLock();
    else this.input.requestLock();
    this.audio.playLocal('ui_click', { volume: 0.5 });
  }

  toggleMap(open) {
    const ui = this.ui;
    if (open === ui.mapOpen) return;
    ui.setMapOpen(open);
    this.input.enabled = !open && !ui.inventoryOpen;
    this.input.buttons = 0;
    this.endHold();
    this.audio.playLocal('ui_click', { volume: 0.5 });
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

  interact() {
    const t = this.lookTarget;
    const g = this.global;
    if (!t) return;
    if (t === 'car') {
      if (g.suppliesDone && !g.finale) this.beginHold(CAR_ID);
      else this.conn.action(ACT.INTERACT, CAR_ID);
      return;
    }
    if (t.kind === ENT.CACHE || (t.kind === ENT.PLAYER && t.downed)) {
      this.beginHold(t.id);
      return;
    }
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
    this.conn.action(ACT.BUILD, this.buildType, gh.x, gh.z, this.buildRot);
  }

  // ---------------------------------------------------------------- UI callbacks
  uiCallbacks() {
    return {
      onCraft: (id) => {
        this.conn.action(ACT.CRAFT, id);
        this.audio.playLocal('craft', { volume: 0.6 });
      },
      onUseItem: (i) => {
        const it = this.inventory.slots[i];
        this.conn.action(ACT.USE_ITEM, i);
        const c = it && CONSUMABLES[it.item];
        if (!c) return;
        if (c.food) this.audio.playLocal('can_open');
        this.vm.useItem?.(c.time, it.item);
      },
      onDropItem: (i, n) => this.conn.action(ACT.DROP_SLOT, i, n),
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
    const buttons = self.alive ? inp.sample() : 0;
    if (this.prediction.step(dt, buttons, inp.yaw, inp.pitch, (evs, st) => this.onLocalEvents(evs, st)) > 0) inp.clearLatch();
    const out = this.prediction.takeOutbox();
    if (out) {
      const rt = this.renderTick;
      const rti = Math.floor(rt);
      this.conn.sendInput(rti, rt - rti, out);
    }
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
    this.landDip = Math.max(0, (this.landDip || 0) - dt * 0.6);
    const bobY = Math.sin(this.camBob * 2) * (s.downed ? 0.06 : 0.035) * Math.min(1, hspeed / 5) - (this.landDip || 0);
    this.recoilKick *= Math.exp(-dt * 10);
    this.camShake = Math.max(0, (this.camShake || 0) - dt * 2.5);
    const shake = this.camShake * 0.02 + this.effects.shake * 0.03;
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
    inp.sensitivity = (this.settings.sensitivity || 1) * (aiming ? 0.6 : 1);

    // viewmodel
    const weaponNow = s.zombie ? -2 : self.alive ? currentWeapon(s) : 0;
    if (weaponNow !== this.vmItem) {
      this.vmItem = weaponNow;
      if (weaponNow === -2) this.vm.setItem(0, { claws: true });
      else this.vm.setItem(s.slot === SLOT_BUILD && !weaponNow ? 0 : weaponNow);
    }
    const [ldx, ldy] = inp.consumeLook();
    this.vm.setVisible(self.alive && !this.ui.inventoryOpen && !this.ui.mapOpen && !this.debugCam);
    const lk = this.settings.weaponSway === false ? 0 : 0.0022 * inp.sensitivity;
    this.vm.update(dt, { speed: hspeed, sprint: !!s.sprinting, onGround: !!s.onGround, crouch: !!s.crouch, aiming, lookDX: ldx * lk, lookDY: ldy * lk, time, loaded: s.mags[0] > 0 });
    if (this.vmMuzzleT > 0) {
      this.vmMuzzleT -= dt;
      if (this.vmMuzzleT <= 0) this.renderer.vmMuzzle.intensity = 0;
    }

    // local footsteps
    if (self.alive && s.onGround && hspeed > 1) {
      this.stepAcc += hspeed * dt;
      const stride = s.sprinting ? 2.6 : s.crouch ? 1.4 : 2.1;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.audio.footstep(this.surfaceAt(rp.x, rp.y, rp.z), undefined, undefined, undefined, s.crouch ? 0.25 : s.sprinting ? 0.8 : 0.5);
      }
    }

    // flashlight: local prediction, server authoritative after a moment
    if (this.localFlashT > 0) this.localFlashT -= dt;
    else this.localFlash = !!self.flashlight;

    // entities
    this.entities.update(dt, this.renderTick, time, rp);

    // interaction target
    this.updateLookTarget();
    this.updateBuildGhost(s);

    // discovery of places
    this.discoverT -= dt;
    if (this.discoverT <= 0 && self.alive && !s.zombie) {
      this.discoverT = 0.5;
      for (const z of this.world.zones) {
        if (this.discovered.has(z.id)) continue;
        if (Math.hypot(rp.x - z.x, rp.z - z.z) < z.flat + 6) {
          this.discovered.add(z.id);
          this.ui.notify(`Discovered · ${ZONE_NAMES[z.id]}`, 'toast', 3.5);
        }
      }
    }
    this.pings = this.pings.filter((p) => time - p.t < PING_LIFE);

    // environment
    const g = this.global;
    const cycle = this.debugCycle ?? Environment.cycleFor(g.phase, g.timeLeft, g.day, g.phaseLen);
    if (!g.finale) this.global.timeLeft = Math.max(0, g.timeLeft - dt);
    else this.global.escapeT = Math.max(0, g.escapeT - dt);
    const weather = this.weather.update(dt, g, time, cam.position);
    if (weather.kind !== this.weatherKind) {
      this.weatherKind = weather.kind;
      const say = WEATHER_TOAST[weather.kind];
      if (say && time - (this.weatherToastT ?? -1e9) > 45 && self.alive) {
        this.weatherToastT = time;
        this.ui.notify(say, 'toast', 3.5);
      }
    }
    this.env.update(dt, cycle, cam.position, time, weather);
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
    this.lights.update(dt, time, cam.position, this.localFlash && self.alive && !s.zombie, fires, this.entities.remoteFlash, this.env.night);
    // nearest big fire warms the viewmodel & the ambience
    let nearFire = 0;
    for (const f of fires) {
      if (!f.big || !(f.intensity > 0)) continue;
      nearFire = Math.max(nearFire, Math.max(0, 1 - Math.hypot(rp.x - f.x, rp.z - f.z) / 14) * f.intensity);
    }
    // viewmodel lighting follows the world
    const vmh = this.renderer.vmHemi;
    vmh.color.copy(this.env.cur.hemiSky);
    vmh.groundColor.copy(this.env.cur.hemiGround);
    vmh.intensity = (this.env.cur.hemi * 0.75 + nearFire * 0.8) * 1.1;
    this.renderer.vmDir.color.copy(this.env.cur.dir);
    this.renderer.vmDir.intensity = this.env.cur.dirI * 0.8;
    this.renderer.vmFlash.intensity = this.localFlash && self.alive ? 0.35 : 0;

    this.effects.setAmbient(this.env.night);
    this.effects.update(dt, cam, this.renderer.renderer.domElement.height);
    const flashOn = this.localFlash && self.alive && !s.zombie;
    this.atmosphere.update(dt, time, cam, this.env, flashOn, this.world.heightAt, weather);
    this.weatherFx.update(dt, time, cam, weather, this.env, flashOn, this.renderer.renderer.domElement.height);

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
    });

    // overlays by phase
    this.updateOverlays();
    // HUD
    this.updateHud(dt, s, aiming, wdef);
    if (this.ui.mapOpen) this.updateMap(s);
    // voice talking indicators
    if (this.frame % 6 === 0) {
      const talking = this.voice.poll();
      if (talking.join() !== this.talkPeers.join()) {
        this.talkPeers = talking;
        this.ui.setVoiceState({ enabled: this.voice.enabled, transmitting: this.voice.transmitting, speakers: talking.map((id) => this.name(id)) });
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
    this.post = { time: this.time, night: this.env.night, damage: 0, lowHealth: 0, infected: 0, dead: 0, exposure: this.env.exposure };
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
      const kills = [...this.players.values()].map((p) => ({ name: p.name, kills: p.kills }));
      this.ui.showGameOver({ days: g.day, kills, reason: 'Every survivor has fallen.', restartIn: Math.ceil(g.restartT) });
    } else if (g.phase === PHASE.VICTORY && this.overlay !== 'victory') {
      this.overlay = 'victory';
      this.ui.setMapOpen(false);
      const kills = [...this.players.values()].map((p) => ({ name: p.name, kills: p.kills }));
      this.ui.showVictory({ days: g.day, kills, reason: 'The engine roars. You tear down Route 9 and leave the valley behind.', restartIn: Math.ceil(g.restartT) });
    } else if ((g.phase === PHASE.DAY || g.phase === PHASE.NIGHT) && (this.overlay === 'gameover' || this.overlay === 'victory')) {
      this.overlay = null;
      this.ui.hideOverlays();
    }
    // death overlay clears when we rise as a zombie
    if (this.deathShown && this.self.alive && this.self.zombie) {
      this.deathShown = false;
      this.ui.hideOverlays();
      this.ui.notify('YOU HAVE RISEN', 'big', 4);
      this.ui.notify('Hunt the survivors. [RMB] to leap.', 'sub', 4);
    }
  }

  surfaceAt(x, y, z) {
    const w = this.world;
    const th = w.heightAt(x, z);
    if (y > th + 0.08) return 'wood';
    if (th < WATER_LEVEL + 0.3) return 'water';
    if (w.roadDistAt(x, z) < 2.8) return 'dirt';
    return 'grass';
  }

  updateLookTarget() {
    const cam = this.camera;
    const s = this.prediction.state;
    this.lookTarget = null;
    this.prompt = null;
    if (!this.self.alive || s.zombie || s.downed) return;
    cam.getWorldDirection(_v);
    const ox = cam.position.x;
    const oy = cam.position.y;
    const oz = cam.position.z;
    const e = this.entities.pick(ox, oy, oz, _v.x, _v.y, _v.z, 3.3, this.renderPos.y + EYE_HEIGHT);
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
        } else if (def.station === 'bench') this.prompt = 'Workbench · craft here [Tab]';
        this.contextStructure = { name: def.name, hp };
        return;
      }
    }
    // the car
    const car = this.world.car;
    const dcar = Math.hypot(this.renderPos.x - car.x, this.renderPos.z - car.z);
    if (dcar < 3.9) {
      this.lookTarget = 'car';
      const missing = SUPPLIES.filter((p, i) => g.supplies[i] < SUPPLY_NEED[i]);
      const carrying = missing.filter((p) => counts[p]);
      if (g.finale) this.prompt = g.escapeReady ? 'GET IN - the engine is running!' : 'Defend the car until the engine is warm';
      else if (!missing.length) this.prompt = '[E] Hold to start the engine (final stand)';
      else if (carrying.length) this.prompt = `[E] Install ${carrying.map((p) => ITEM_DEFS[p].name).join(', ')}`;
      else this.prompt = `The car needs: ${missing.map((p) => ITEM_DEFS[p].name).join(', ')}`;
    }
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
    let y = this.world.heightAt(x, z);
    let rotY = (this.buildRot / 256) * Math.PI * 2;
    const def = STRUCT_DEFS[this.buildType];
    let reason = '';
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
    this.ui.setBuildMenu({ selected: this.buildType, rotate: Math.round((this.buildRot / 256) * 360), counts, valid, reason, unlocked });
  }

  // same overlap rules the server applies when placing a structure
  buildBlocked(def, x, y, z, yaw) {
    const col = makeBox(x, z, y - 0.3, y + def.sy, def.sx, def.sz, yaw, def.block ? COL.STRUCT : COL.STRUCT | COL.NOBLOCK);
    const tmp = this._bq || (this._bq = []);
    if (!def.snap) {
      this.world.staticGrid.query(x, z, col.r + 0.2, tmp);
      for (const o of tmp) {
        if (o.y1 < y + 0.2) continue;
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
      h.useLabel = self.holdKind === HOLD.SEARCH ? `Searching${t ? ' ' + (CONT_DEFS[t.ctype]?.name || '').toLowerCase() : ''}…` : self.holdKind === HOLD.REVIVE ? `Reviving ${t ? this.name(t.id) : ''}…` : 'Starting the engine…';
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
    h.objective = { supplies: g.supplies, hints: g.hints, carried, anyCarried, phase: g.phase, timeLeft: Math.ceil(g.timeLeft), finale: g.finale, escapeT: Math.ceil(g.escapeT), escapeReady: g.escapeReady, suppliesDone: g.suppliesDone, wave: g.wave, waves: g.waves };
    this.ui.setCamp({ supplies: g.supplies, hints: g.hints, carried });
    // downed overlay
    h.downed = self.alive && s.downed ? { bleed: self.bleed || 0, reviving: !!self.beingRevived, medkit: (counts[ITEM.MEDKIT] || 0) > 0 } : null;
    // compass + world markers
    h.yaw = this.input.yaw;
    this.buildMarkers(h, rp);
    this.ui.updateHud(h);
    this.pushInventoryToUI(false);
    if (this.ui.inventoryOpen && this.frame % 20 === 0) this.ui.setCraftContext(this.craftContext());
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
    // rumoured supply places still missing something
    const done = (i) => g.supplies[i] >= SUPPLY_NEED[i];
    const hintSeen = new Set();
    g.hints.forEach((zid, i) => {
      const si = Math.min(i, 4);
      if (zid === 255 || done(si)) return;
      const z = this.world.zoneById[zid];
      if (!z || hintSeen.has(zid + ':' + si)) return;
      hintSeen.add(zid + ':' + si);
      const d = dist(z.x, z.z);
      if (d < 25) return;
      cm.push({ kind: 'hint', bearing: bearing(z.x - rp.x, z.z - rp.z), icon: itemIcon(SUPPLIES[si]), label: `${Math.round(d)}m` });
    });
    // discovered places nearby
    for (const z of this.world.zones) {
      if (!this.discovered.has(z.id) || z.id === ZONE.CAMP) continue;
      const d = dist(z.x, z.z);
      if (d < 30 || d > 260) continue;
      cm.push({ kind: 'poi', bearing: bearing(z.x - rp.x, z.z - rp.z), icon: glyph('flag'), label: '' });
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
        cm.push({ kind: 'mate', bearing: bearing(e.rx - rp.x, e.rz - rp.z), icon: glyph(e.downed ? 'downed' : 'person'), label: name.slice(0, 10), cls: e.downed ? 'downed' : '', pinEdge: e.downed });
        if (d < 250 && this.project(e.rx, e.ry + (e.downed ? 0.9 : 2.15), e.rz, sc)) {
          const near = d < 12;
          wm.push({
            kind: 'mate',
            x: sc.x,
            y: sc.y,
            icon: e.downed ? glyph('downed') : '',
            name,
            sub: e.downed ? (e.beingRevived ? 'being revived' : near ? 'hold [E] to revive' : `down · ${Math.round(d)}m`) : d > 15 ? `${Math.round(d)}m` : '',
            cls: e.downed ? 'downed' : near ? 'near' : '',
            scale: Math.max(0.75, 1.1 - d / 300),
          });
        }
      } else if (e.kind === ENT.CRATE && e.q[3] < 2) {
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
      wm.push({ kind: 'car', x: sc.x, y: sc.y, icon: carIcon, name: g.finale ? (g.escapeReady ? 'GET IN' : 'Defend the car') : 'Your car', sub: `${Math.round(dCar)}m`, cls: g.finale ? 'urgent' : '', scale: 0.95 });
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
      } else if (e.kind === ENT.CRATE && e.q[3] < 2) crates.push({ x: e.rx, z: e.rz });
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
      discovered: this.discovered,
      hints: g.hints,
      supplies: g.supplies,
      carried,
    });
    void s;
  }
}

export { MAX_PLAYERS, DUSK_WARNING, AMMO_NAMES, ZTYPE, dqpos };
