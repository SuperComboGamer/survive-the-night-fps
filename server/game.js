// Authoritative game simulation.
//
// Iteration 2 loop: by day the team scavenges the valley (containers, wrecks, trees, schematics) and
// hunts for the car supplies hidden around the map; by night the horde comes in waves to wherever the
// survivors are, so they throw up a temporary shelter on the spot. Every night is harder. Once every
// supply is in the car, starting the engine triggers the final stand - survive it and drive away.
import {
  SERVER_TICK_RATE,
  SERVER_DT,
  MAX_PLAYERS,
  MAX_ENTITIES,
  PHASE,
  DAY_LENGTH,
  FIRST_DAY_LENGTH,
  NIGHT_LENGTH,
  DUSK_WARNING,
  NIGHT_WAVES,
  WAVE_TIMES,
  WAVE_SPREAD,
  BOSS_EVERY,
  ESCAPE_TIME,
  ESCAPE_RADIUS,
  GAME_OVER_DELAY,
  PLAYER_MAX_HP,
  ZOMBIE_PLAYER_MAX_HP,
  HEAL_DELAY,
  HEAL_RATE,
  HEAL_RATE_CAMPFIRE,
  CAMPFIRE_HEAL_RADIUS,
  CRAFT_STATION_RADIUS,
  BUILD_REACH,
  MAX_STRUCTURES,
  FLASHLIGHT_MAX,
  FLASHLIGHT_DRAIN,
  FLASHLIGHT_RECHARGE,
  SLOT_PRIMARY,
  SLOT_PISTOL,
  SLOT_THROW,
  SLOT_BUILD,
  INVENTORY_SIZE,
  PLAYER_RADIUS,
  DOWN_TIME,
  REVIVE_TIME,
  REVIVE_HP,
  SEARCH_TIME,
  ENGINE_START_TIME,
  EYE_HEIGHT,
} from '../shared/constants.js';
import {
  ITEM,
  ITEM_DEFS,
  WEAPONS,
  RECIPES,
  STRUCT,
  STRUCT_DEFS,
  REPAIR_COST,
  CAMPFIRE_FUEL,
  CAMPFIRE_MAX_FUEL,
  ZTYPE,
  ZOMBIE_DEFS,
  LOOT_TABLES,
  SUPPLIES,
  SUPPLY_NEED,
  SUPPLY_ZONES,
  FUEL_SPOTS,
  SCHEMATICS,
  SCHEM_BIT,
  CONT_DEFS,
  CONT_TABLES,
  CONSUMABLES,
  AMMO,
  AMMO_MAX,
  AMMO_ITEMS,
  SOUND,
  EVT,
  NOTIFY,
  KILLER,
  ZONE,
  THROW_ITEMS,
  isFirearm,
} from '../shared/defs.js';
import { C2S, S2C, ACT, ENT, HOLD, CAR_ID, REJECT_REASON, PROTOCOL_VERSION, Writer, Reader, qpos, dqangle16, dqpitch } from '../shared/protocol.js';
import { createWorld } from '../shared/world.js';
import { createPlayerState, simulatePlayer, eyeHeight, currentWeapon } from '../shared/playersim.js';
import { makeBox, COL, footprintContains, groundAt, overlapBoxes, canReach } from '../shared/collision.js';
import { mulberry32 } from '../shared/rng.js';
import { Nav } from './nav.js';
import { ClientView, writeEntities } from './snapshot.js';
import { createInventory, addItem, removeItem, countItem, hasCost, payCost, canFit } from './inventory.js';
import { Zombies } from './zombies.js';
import { Cats } from './cats.js';
import { Combat } from './combat.js';

const MAX_ZOMBIES_ALIVE = 120;
const AUTO_PICKUP = { res: 1, ammo: 1, cons: 1, throw: 1, part: 1, schem: 1 };
const CRATE_TABLE = [
  [ITEM.AMMO_762, 5, 30, 60],
  [ITEM.AMMO_556, 5, 30, 60],
  [ITEM.AMMO_SHELLS, 5, 8, 16],
  [ITEM.AMMO_9MM, 4, 20, 40],
  [ITEM.MEDKIT, 4, 1, 2],
  [ITEM.PIPEBOMB, 2, 1, 2],
  [ITEM.MOLOTOV, 2, 1, 2],
  [ITEM.FLARE, 3, 2, 3],
  [ITEM.PLATE, 2, 1, 1],
  [ITEM.GUNPARTS, 3, 1, 2],
  [ITEM.AK47, 1, 1, 1],
  [ITEM.M4A1, 1, 1, 1],
  [ITEM.MP5, 1, 1, 1],
  [ITEM.SHOTGUN, 1, 1, 1],
  [ITEM.DB_SHOTGUN, 1, 1, 1],
  [ITEM.KEVLAR, 1, 1, 1],
  [ITEM.NAILS, 3, 10, 20],
  [ITEM.BATTERY, 2, 1, 2],
  [ITEM.POWDER, 3, 5, 10],
];

export class Game {
  constructor(opts = {}) {
    this.seed = opts.seed ?? ((Math.random() * 0x7fffffff) | 0);
    this.maxPlayers = opts.maxPlayers ?? MAX_PLAYERS;
    // optional overrides (testing): DAY_SECONDS / NIGHT_SECONDS / START_DAY env vars
    this.dayLen = opts.dayLength || DAY_LENGTH;
    this.firstDayLen = opts.dayLength || FIRST_DAY_LENGTH;
    this.nightLen = opts.nightLength || NIGHT_LENGTH;
    this.startDayNum = opts.startDay || 1;
    this.godMode = !!opts.godMode; // testing only: survivors take no damage
    this.debugCommands = !!opts.debugCommands; // testing only: /kill /night /day /give /spawn /tp chat commands
    this.log = opts.log ?? ((...a) => console.log('[game]', ...a));
    const t0 = Date.now();
    this.world = createWorld(this.seed);
    this.nav = new Nav(this.world);
    this.log(`world seed ${this.seed} generated in ${Date.now() - t0}ms`);
    this.rng = mulberry32(this.seed ^ 0xabcdef);

    this.ents = new Array(MAX_ENTITIES).fill(null);
    this.gens = new Uint32Array(MAX_ENTITIES);
    this.freeIds = [];
    this.quarantine = [];
    this.nextId = 1;
    this.all = []; // live entity list (players included)

    this.sessions = new Set();
    this.players = new Map(); // id -> player
    this.zombies = [];
    this.items = [];
    this.structures = [];
    this.projectiles = [];
    this.areas = [];
    this.crates = [];
    this.caches = []; // searchable containers
    this.cats = [];

    this.tick = 0;
    this.time = 0;
    this.phase = PHASE.WAITING;
    this.day = 0;
    this.timeLeft = 0;
    this.supplies = [0, 0, 0, 0, 0]; // installed per SUPPLIES entry
    this.supplyHints = [255, 255, 255, 255, 255, 255, 255]; // zones: 4 parts + 3 jerry cans
    this.unlocked = 0; // schematics bitmask
    this.waves = [];
    this.wave = 0;
    this.bossPending = null;
    this.bossId = 0;
    this.warned = false;
    this.escape = { active: false, t: 0, ready: false, spawnT: 0, boss: false };
    this.supplyAt = [];
    this.restartT = 0;
    this.globalDirty = true;
    this.playersDirty = true;
    this.playersListT = 0;
    this.gather = new Map(); // collider -> {left, day}
    this.nightStats = { kills: 0, structLost: 0, downs: 0, deaths: 0, revives: 0 };

    this.lootPoints = [];
    this.w = new Writer(1 << 16);
    this.ew = new Writer(1 << 14);
    this.events = [];

    this.zm = new Zombies(this);
    this.cm = new Cats(this);
    this.combat = new Combat(this);
    this.stats = { bytesOut: 0, msgsOut: 0, lastReport: Date.now(), tickMs: 0 };
  }

  // ---------------------------------------------------------------- entity registry
  spawnEntity(e) {
    let id;
    if (this.freeIds.length) id = this.freeIds.pop();
    else if (this.nextId < MAX_ENTITIES) id = this.nextId++;
    else return null;
    this.gens[id] = (this.gens[id] + 1) >>> 0 || 1;
    e.id = id;
    e.gen = this.gens[id];
    e.removed = false;
    this.ents[id] = e;
    this.all.push(e);
    return e;
  }
  removeEntity(e) {
    if (e.removed) return;
    e.removed = true;
    this.ents[e.id] = null;
    this.quarantine.push(e.id, this.tick + 60);
    const i = this.all.indexOf(e);
    if (i >= 0) {
      this.all[i] = this.all[this.all.length - 1];
      this.all.pop();
    }
  }
  _listRemove(list, e) {
    const i = list.indexOf(e);
    if (i >= 0) {
      list[i] = list[list.length - 1];
      list.pop();
    }
  }

  // ---------------------------------------------------------------- events
  // Pre-encodes an event once; per-client filtering by radius / recipient.
  emit(writeFn, opts = {}) {
    const w = this.ew.reset();
    writeFn(w);
    this.events.push({ bytes: w.u8a.slice(0, w.o), x: opts.x, z: opts.z, r2: opts.r ? opts.r * opts.r : 0, to: opts.to || 0, except: opts.except || 0 });
  }
  sound(snd, x, y, z, r = 60, except = 0) {
    this.emit(
      (w) => {
        w.u8(EVT.SOUND);
        w.u8(snd);
        w.i16(qpos(x));
        w.i16(qpos(y));
        w.i16(qpos(z));
      },
      { x, z, r, except },
    );
  }
  impact(kind, x, y, z, nx = 0, ny = 1, nz = 0) {
    this.emit(
      (w) => {
        w.u8(EVT.IMPACT);
        w.u8(kind);
        w.i16(qpos(x));
        w.i16(qpos(y));
        w.i16(qpos(z));
        w.i8(Math.round(nx * 127));
        w.i8(Math.round(ny * 127));
        w.i8(Math.round(nz * 127));
      },
      { x, z, r: 90 },
    );
  }
  notify(msg, arg = 0, to = 0) {
    this.emit(
      (w) => {
        w.u8(EVT.NOTIFY);
        w.u8(msg);
        w.u16(arg);
      },
      { to },
    );
  }
  killfeed(killerKind, killerId, victimId, weapon, flags) {
    this.emit((w) => {
      w.u8(EVT.KILLFEED);
      w.u8(killerKind);
      w.u16(killerId);
      w.u16(victimId);
      w.u8(weapon);
      w.u8(flags);
    });
  }

  // ---------------------------------------------------------------- sessions
  onOpen(conn) {
    const session = { conn, player: null, ip: conn.ip || '', msgCount: 0, msgWindow: 0 };
    this.sessions.add(session);
    return session;
  }
  onClose(session) {
    this.sessions.delete(session);
    const p = session.player;
    if (p) this.removePlayer(p);
  }
  onMessage(session, data) {
    // basic flood protection
    const now = this.time;
    if (now - session.msgWindow > 1) {
      session.msgWindow = now;
      session.msgCount = 0;
    }
    if (++session.msgCount > 200) return;
    let r;
    try {
      r = new Reader(data);
      const type = r.u8();
      const p = session.player;
      if (type === C2S.JOIN) return this.handleJoin(session, r);
      if (type === C2S.PING) {
        const t = r.f64();
        const w = new Writer(16);
        w.u8(S2C.PONG);
        w.f64(t);
        session.conn.send(w.bytes());
        return;
      }
      if (!p) return;
      switch (type) {
        case C2S.INPUT:
          return this.handleInput(p, r);
        case C2S.ACTION:
          return this.handleAction(p, r);
        case C2S.CHAT:
          return this.handleChat(p, r.str());
        case C2S.VOICE: {
          const target = r.u16();
          const payload = r.str();
          const tp = this.players.get(target);
          if (tp && payload.length < 20000) {
            const w = new Writer(payload.length * 3 + 16);
            w.u8(S2C.VOICE);
            w.u16(p.id);
            w.str(payload);
            tp.session.conn.send(w.bytes());
          }
          return;
        }
      }
    } catch (err) {
      this.log('bad message', err.message);
    }
  }

  handleJoin(session, r) {
    if (session.player) return;
    const version = r.u8();
    let name = r.str().replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Survivor';
    const reject = (reason) => {
      const w = new Writer(4);
      w.u8(S2C.REJECT);
      w.u8(reason);
      session.conn.send(w.bytes());
    };
    if (version !== PROTOCOL_VERSION) return reject(REJECT_REASON.VERSION);
    if (this.players.size >= this.maxPlayers) return reject(REJECT_REASON.FULL);
    // unique names
    const names = new Set([...this.players.values()].map((p) => p.name));
    let base = name;
    let k = 2;
    while (names.has(name)) name = `${base.slice(0, 13)}#${k++}`;

    const p = this.createPlayer(session, name);
    session.player = p;
    const w = new Writer(64);
    w.u8(S2C.WELCOME);
    w.u16(p.id);
    w.u32(this.seed >>> 0);
    w.u32(this.tick);
    w.u8(SERVER_TICK_RATE);
    w.u8(this.maxPlayers);
    session.conn.send(w.bytes());
    if (this.phase === PHASE.WAITING) this.startGame();
    else this.spawnHuman(p);
    this.notify(NOTIFY.PLAYER_JOINED, p.id);
    this.systemChat(`${p.name} joined the survivors.`);
    this.playersDirty = true;
    this.globalDirty = true;
    this.log(`join ${p.name} (${this.players.size}/${this.maxPlayers})`);
  }

  createPlayer(session, name) {
    const p = {
      kind: ENT.PLAYER,
      session,
      name,
      state: createPlayerState(),
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      armor: 0,
      armorMax: 0,
      armorItem: 0,
      alive: true,
      zombie: false,
      downed: false,
      bleed: 0,
      lastSrc: null,
      revivedBy: 0,
      respawnT: 0,
      inv: createInventory(),
      invDirty: true,
      flashlight: false,
      battery: FLASHLIGHT_MAX,
      lastDamageT: -99,
      useItem: null,
      hold: null,
      kills: 0,
      zkills: 0,
      deaths: 0,
      cmdQueue: [],
      cmdBudget: 6,
      lastSeq: 0,
      hasSeq: false,
      renderTick: 0,
      renderFrac: 0,
      view: new ClientView(),
      hx: new Float32Array(16),
      hy: new Float32Array(16),
      hz: new Float32Array(16),
      chatT: 0,
      chatCount: 0,
      interactT: 0,
      actionT: 0,
      pingT: 0,
      pinnedBy: 0,
      ropedBy: 0,
      ping: 0,
      globalSent: false,
      get x() {
        return this.state.x;
      },
      get y() {
        return this.state.y;
      },
      get z() {
        return this.state.z;
      },
    };
    this.spawnEntity(p);
    this.players.set(p.id, p);
    return p;
  }

  removePlayer(p) {
    this.releaseHolds(p);
    this.dropAll(p);
    this.players.delete(p.id);
    this.nav.removeField(p.id);
    this.removeEntity(p);
    this.notify(NOTIFY.PLAYER_LEFT, 0);
    this.systemChat(`${p.name} left.`);
    this.playersDirty = true;
    this.log(`leave ${p.name} (${this.players.size}/${this.maxPlayers})`);
    if (this.players.size === 0) this.resetToWaiting();
    else this.checkAllDead();
  }

  // living survivors (downed ones included - the dead still hunt them)
  humans() {
    const out = [];
    for (const p of this.players.values()) if (p.alive && !p.zombie) out.push(p);
    return out;
  }
  standing() {
    let n = 0;
    for (const p of this.players.values()) if (p.alive && !p.zombie && !p.downed) n++;
    return n;
  }
  humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.zombie) n++;
    return n;
  }

  // ---------------------------------------------------------------- game flow
  resetToWaiting() {
    this.clearWorld();
    this.phase = PHASE.WAITING;
    this.day = 0;
    this.globalDirty = true;
  }

  clearWorld() {
    for (const e of [...this.all]) if (e.kind !== ENT.PLAYER) this.removeEntity(e);
    for (const s of this.structures) {
      this.world.structGrid.remove(s.collider);
      this.nav.removeStructure(s.collider);
    }
    this.zombies.length = 0;
    this.items.length = 0;
    this.structures.length = 0;
    this.projectiles.length = 0;
    this.areas.length = 0;
    this.crates.length = 0;
    this.caches.length = 0;
    this.cats.length = 0;
    this.waves = [];
    this.wave = 0;
    this.bossPending = null;
    this.bossId = 0;
    this.gather.clear();
    this.escape = { active: false, t: 0, ready: false, spawnT: 0, boss: false };
  }

  startGame() {
    this.clearWorld();
    this.phase = PHASE.DAY;
    this.day = this.startDayNum;
    this.timeLeft = this.firstDayLen;
    this.supplies = [0, 0, 0, 0, 0];
    this.unlocked = 0;
    this.warned = false;
    this.nightStats = { kills: 0, structLost: 0, downs: 0, deaths: 0, revives: 0 };
    this.scheduleSupplyDrops();
    const w = this.world;
    // floor loot
    this.lootPoints = [];
    for (const sp of w.lootSpawns) this.lootPoints.push({ ...sp, ent: null, respawnAt: 0, table: LOOT_TABLES[sp.zone] || LOOT_TABLES[ZONE.FOREST] });
    for (const sp of w.resourceSpawns) this.lootPoints.push({ ...sp, ent: null, respawnAt: 0, table: LOOT_TABLES[ZONE.FOREST] });
    for (const lp of this.lootPoints) if (this.rng() < 0.8) this.spawnLoot(lp);
    // searchable containers
    for (const c of w.containers) {
      const e = { kind: ENT.CACHE, ctype: c.ctype, x: c.x, y: c.y, z: c.z, zone: c.zone, state: 0, schem: 0 };
      if (this.spawnEntity(e)) this.caches.push(e);
    }
    // hide the schematics in lockers / ammo crates / toolboxes around the map (one each, far from the start)
    const eligible = this.caches.filter((c) => CONT_DEFS[c.ctype].schem && Math.hypot(c.x - w.car.x, c.z - w.car.z) > 90);
    for (const item of SCHEMATICS) {
      for (let tries = 0; tries < 20 && eligible.length; tries++) {
        const c = eligible[Math.floor(this.rng() * eligible.length)];
        if (c.schem) continue;
        c.schem = item;
        break;
      }
    }
    this.placeSupplies();
    // zone guards + roaming dead
    this.zm.spawnInitial();
    this.cm.spawnInitial();
    for (const p of this.players.values()) this.spawnHuman(p);
    this.notify(NOTIFY.NEW_GAME, this.day);
    this.globalDirty = true;
    this.playersDirty = true;
    this.log('new game started');
  }

  // Hide every car supply at one of its candidate places (three different places for the fuel).
  placeSupplies() {
    const w = this.world;
    const usedSpots = new Set();
    const zoneLoad = new Map();
    const pickSpot = (zones) => {
      const order = zones.slice().sort(() => this.rng() - 0.5);
      order.sort((a, b) => (zoneLoad.get(a) || 0) - (zoneLoad.get(b) || 0));
      for (const zid of order) {
        const spots = w.partSpots.filter((s) => s.zone === zid && !usedSpots.has(s));
        if (!spots.length) continue;
        const sp = spots[Math.floor(this.rng() * spots.length)];
        usedSpots.add(sp);
        zoneLoad.set(zid, (zoneLoad.get(zid) || 0) + 1);
        return sp;
      }
      return null;
    };
    const hints = [];
    this.supplySpots = [];
    for (let i = 0; i < 4; i++) {
      const item = SUPPLIES[i];
      const sp = pickSpot(SUPPLY_ZONES[item]);
      hints.push(sp ? sp.zone : 255);
      if (sp) {
        this.spawnItem(item, 1, sp.x, sp.y, sp.z, { permanent: true });
        this.supplySpots.push(sp);
      }
    }
    const fuelZones = SUPPLY_ZONES[ITEM.FUEL_CAN].slice();
    for (let i = 0; i < FUEL_SPOTS; i++) {
      const sp = pickSpot(fuelZones.filter((z) => !hints.slice(4).includes(z)));
      hints.push(sp ? sp.zone : 255);
      if (sp) {
        this.spawnItem(ITEM.FUEL_CAN, 1, sp.x, sp.y, sp.z, { permanent: true });
        this.supplySpots.push(sp);
      }
    }
    this.supplyHints = hints;
  }

  spawnHuman(p) {
    const s = p.state;
    const fresh = createPlayerState();
    Object.assign(s, fresh);
    s.weapons = [0, ITEM.PISTOL, ITEM.KNIFE, 0, ITEM.HAMMER];
    s.mags = [0, 12];
    s.ammo = AMMO_ITEMS.map((_, i) => (i === AMMO.P9 ? 36 : 0));
    const sp = this.world.spawnPoints[Math.floor(this.rng() * this.world.spawnPoints.length)];
    s.x = sp.x + (this.rng() - 0.5) * 1.5;
    s.z = sp.z + (this.rng() - 0.5) * 1.5;
    s.y = groundAt(this.world, s.x, s.z, 50, 0.3);
    const car = this.world.car;
    s.yaw = Math.atan2(-(car.x - s.x), -(car.z - s.z)) + Math.PI; // back to the car, facing the road
    p.hp = PLAYER_MAX_HP;
    p.maxHp = PLAYER_MAX_HP;
    p.armor = 0;
    p.armorMax = 0;
    p.armorItem = 0;
    p.alive = true;
    p.zombie = false;
    p.downed = false;
    p.bleed = 0;
    p.revivedBy = 0;
    p.respawnT = 0;
    p.becomeZombie = false;
    p.flashlight = false;
    p.battery = FLASHLIGHT_MAX;
    p.useItem = null;
    p.hold = null;
    p.inv = createInventory();
    addItem(p.inv, ITEM.BANDAGE, 2);
    addItem(p.inv, ITEM.TORCH, 1);
    addItem(p.inv, ITEM.WOOD, 6);
    addItem(p.inv, ITEM.NAILS, 8);
    addItem(p.inv, ITEM.STICK, 4);
    addItem(p.inv, ITEM.CLOTH, 1);
    p.invDirty = true;
    this.fillHistory(p);
    this.playersDirty = true;
  }

  spawnPlayerZombie(p) {
    const s = p.state;
    Object.assign(s, createPlayerState());
    s.zombie = 1;
    s.weapons = [0, 0, 0, 0, 0];
    s.slot = 2;
    const humans = this.humans();
    const sp = this.zm.pickHordeSpawn(humans) || { x: 200, z: 0 };
    s.x = sp.x;
    s.z = sp.z;
    s.y = groundAt(this.world, s.x, s.z, 80, 0.3, false);
    p.zombie = true;
    p.alive = true;
    p.downed = false;
    p.hp = ZOMBIE_PLAYER_MAX_HP;
    p.maxHp = ZOMBIE_PLAYER_MAX_HP;
    p.armor = 0;
    p.armorMax = 0;
    p.flashlight = false;
    p.useItem = null;
    p.hold = null;
    this.fillHistory(p);
    this.playersDirty = true;
  }

  fillHistory(e) {
    for (let i = 0; i < 16; i++) {
      e.hx[i] = e.x;
      e.hy[i] = e.y;
      e.hz[i] = e.z;
    }
  }

  scheduleSupplyDrops() {
    const len = this.day === 1 ? this.firstDayLen : this.dayLen;
    const n = this.day >= 2 ? 2 : 1;
    this.supplyAt = [];
    for (let i = 0; i < n; i++) this.supplyAt.push(len * (0.2 + (i + this.rng()) * (0.6 / n))); // timeLeft thresholds
  }

  // Night N: the horde comes in waves to wherever the survivors are. Bigger, tougher and nastier every night.
  startNight() {
    this.phase = PHASE.NIGHT;
    this.timeLeft = this.nightLen;
    this.warned = false;
    this.nightStats = { kills: 0, structLost: 0, downs: 0, deaths: 0, revives: 0 };
    const n = this.day;
    const humans = Math.max(1, this.humanCount());
    const pf = 0.6 + 0.4 * humans;
    const total = Math.round((10 + 6 * n + 1.3 * n * n) * pf);
    const shares = [0.3, 0.33, 0.37];
    const scale = this.nightLen / NIGHT_LENGTH;
    this.waves = [];
    for (let k = 0; k < NIGHT_WAVES; k++) {
      const count = Math.max(3, Math.round(total * shares[k]));
      const sp = k / (NIGHT_WAVES - 1); // later waves bring more specials
      const weights = [
        [ZTYPE.WALKER, 50 - sp * 12],
        [ZTYPE.RUNNER, 16 + n * 2 + sp * 6],
        [ZTYPE.SPITTER, n >= 2 ? 6 + sp * 4 : 0],
        [ZTYPE.BOOMER, n >= 2 ? 6 + sp * 3 : 0],
        [ZTYPE.LEAPER, n >= 3 ? 6 + sp * 4 : 0],
        [ZTYPE.BAT, n >= 3 ? 7 : 0],
        [ZTYPE.ROPER, n >= 4 ? 5 + sp * 3 : 0],
        [ZTYPE.TANK, n >= 4 ? (1 + n * 0.3) * (0.5 + sp) : 0],
      ];
      const tot = weights.reduce((a, b) => a + b[1], 0);
      const q = [];
      for (let i = 0; i < count; i++) {
        let r = this.rng() * tot;
        for (const [t, wgt] of weights) {
          r -= wgt;
          if (r <= 0) {
            q.push(t);
            break;
          }
        }
      }
      this.waves.push({ start: WAVE_TIMES[k] * scale, queue: q, started: false, spawnT: 0, interval: (WAVE_SPREAD * scale) / Math.max(1, Math.ceil(count / 3.5)) });
    }
    this.wave = 0;
    this.hordeHpMul = 1 + 0.1 * (n - 1) + 0.12 * (humans - 1);
    this.bossPending = null;
    if (n % BOSS_EVERY === 0) {
      const type = (n / BOSS_EVERY) % 2 === 1 ? ZTYPE.BOSS_ABOMINATION : ZTYPE.BOSS_HIVEQUEEN;
      this.bossPending = { types: [type], t: WAVE_TIMES[NIGHT_WAVES - 1] * scale + 10 };
    }
    this.notify(NOTIFY.NIGHT_FALLS, n);
    this.globalDirty = true;
    // day wanderers near the survivors join the hunt; the rest drift off into the dark
    const hs = this.humans();
    for (const z of [...this.zombies]) {
      if (z.dead) continue;
      let md = Infinity;
      for (const h of hs) md = Math.min(md, Math.hypot(h.state.x - z.x, h.state.z - z.z));
      if (md < 95 || z.boss) z.horde = true;
      else {
        this._listRemove(this.zombies, z);
        this.removeEntity(z);
      }
    }
  }

  startDay() {
    this.phase = PHASE.DAY;
    const night = this.day;
    this.day++;
    this.timeLeft = this.dayLen;
    this.warned = false;
    this.waves = [];
    this.wave = 0;
    this.bossPending = null;
    this.scheduleSupplyDrops();
    const st = this.nightStats;
    this.emit((w) => {
      w.u8(EVT.SUMMARY);
      w.u8(night);
      w.u16(Math.min(65535, st.kills));
      w.u8(Math.min(255, st.structLost));
      w.u8(Math.min(255, st.downs));
      w.u8(Math.min(255, st.deaths));
      w.u8(Math.min(255, st.revives));
    });
    this.notify(NOTIFY.DAWN, this.day);
    this.sound(SOUND.DAWN, 0, 0, 0, 0);
    // horde burns in the sunlight
    for (const z of this.zombies) {
      if (!z.dead && (z.horde || z.def.flying)) z.burning = 0.5 + this.rng() * 5;
    }
    // the valley restocks a little: some searched containers are refilled, trees & wrecks regrow
    for (const c of this.caches) {
      if (c.state === 1 && this.rng() < 0.4) c.state = 0;
    }
    this.gather.clear();
    this.globalDirty = true;
  }

  victory() {
    this.phase = PHASE.VICTORY;
    this.restartT = GAME_OVER_DELAY + 6;
    this.escape.active = false;
    this.notify(NOTIFY.VICTORY, this.day);
    this.sound(SOUND.CAR_START, this.world.car.x, 0.5, this.world.car.z, 0);
    this.globalDirty = true;
    this.log('victory!');
  }

  gameOver() {
    this.phase = PHASE.GAMEOVER;
    this.restartT = GAME_OVER_DELAY;
    this.escape.active = false;
    this.notify(NOTIFY.GAME_OVER, this.day);
    this.globalDirty = true;
    this.log('game over on day', this.day);
  }

  checkAllDead() {
    if (this.phase !== PHASE.DAY && this.phase !== PHASE.NIGHT) return;
    if (this.players.size === 0) return;
    let downedWithMedkit = false;
    for (const p of this.players.values()) {
      if (p.zombie || !p.alive) continue;
      if (!p.downed) return;
      if (countItem(p.inv, ITEM.MEDKIT) > 0) downedWithMedkit = true;
    }
    if (downedWithMedkit) return;
    // nobody left standing to revive the fallen
    for (const p of this.players.values()) if (p.alive && !p.zombie && p.downed) this.killPlayer(p, p.lastSrc || { kind: KILLER.WORLD }, true);
    this.gameOver();
  }

  allSuppliesIn() {
    for (let i = 0; i < SUPPLIES.length; i++) if (this.supplies[i] < SUPPLY_NEED[i]) return false;
    return true;
  }

  startEngine(p) {
    if (this.escape.active || !this.allSuppliesIn()) return;
    if (this.phase !== PHASE.DAY && this.phase !== PHASE.NIGHT) return;
    this.escape = { active: true, t: ESCAPE_TIME, ready: false, spawnT: 3, boss: false };
    const car = this.world.car;
    this.notify(NOTIFY.ENGINE_START, p ? p.id : 0);
    this.sound(SOUND.ENGINE_CRANK, car.x, car.y + 0.8, car.z, 300);
    this.sound(SOUND.HORDE_HORN, 0, 0, 0, 0);
    this.hordeHpMul = 1 + 0.12 * this.day + 0.12 * (Math.max(1, this.humanCount()) - 1);
    for (const z of this.zombies) z.horde = true;
    this.globalDirty = true;
    this.log('engine started - final stand');
  }

  // ---------------------------------------------------------------- items / loot
  rollTable(table) {
    let total = 0;
    for (const t of table) total += t[1];
    let r = this.rng() * total;
    for (const t of table) {
      r -= t[1];
      if (r <= 0) return [t[0], t[2] + Math.floor(this.rng() * (t[3] - t[2] + 1))];
    }
    const t = table[0];
    return [t[0], t[2]];
  }

  spawnLoot(lp) {
    const [item, count] = this.rollTable(lp.table);
    lp.ent = this.spawnItem(item, count, lp.x, lp.y, lp.z, { point: lp });
  }

  spawnItem(item, count, x, y, z, opts = {}) {
    const e = {
      kind: ENT.ITEM,
      item,
      count,
      x,
      y,
      z,
      mag: opts.mag ?? (isFirearm(item) ? Math.floor(WEAPONS[item].mag * (0.3 + this.rng() * 0.7)) : 0),
      point: opts.point || null,
      despawnAt: opts.permanent || opts.point ? Infinity : this.time + (opts.life || 150),
      permanent: !!opts.permanent,
      noAutoUntil: opts.noAuto ? this.time + opts.noAuto : 0,
    };
    if (!this.spawnEntity(e)) return null;
    this.items.push(e);
    return e;
  }

  removeItemEnt(e) {
    if (e.point) {
      e.point.ent = null;
      e.point.respawnAt = this.time + (e.point.zone === ZONE.FOREST ? 110 + this.rng() * 140 : 150 + this.rng() * 180);
    }
    this._listRemove(this.items, e);
    this.removeEntity(e);
  }

  // scatter a dropped item near x,z
  dropItem(item, count, x, y, z, opts = {}) {
    const a = this.rng() * Math.PI * 2;
    const r = opts.spread ?? 0.6 + this.rng() * 0.8;
    const dx = x + Math.sin(a) * r;
    const dz = z + Math.cos(a) * r;
    const gy = groundAt(this.world, dx, dz, y + 1, 0.1, true);
    const cat = ITEM_DEFS[item]?.cat;
    return this.spawnItem(item, count, dx, gy + 0.02, dz, { life: opts.life ?? 240, mag: opts.mag, permanent: cat === 'part' || cat === 'schem', noAuto: opts.noAuto });
  }

  dropAll(p) {
    const s = p.state;
    const x = s.x;
    const y = s.y;
    const z = s.z;
    for (let i = 0; i < p.inv.length; i++) {
      const it = p.inv[i];
      if (it) this.dropItem(it.item, it.count, x, y, z, { spread: 1.5 + this.rng() * 1.5, mag: it.mag, noAuto: 2 });
      p.inv[i] = null;
    }
    if (!p.zombie) {
      for (let slot = 0; slot < 5; slot++) {
        const wpn = s.weapons[slot];
        if (!wpn || slot === SLOT_THROW) continue;
        this.dropItem(wpn, 1, x, y, z, { spread: 1.2, mag: slot === SLOT_PRIMARY ? s.mags[0] : slot === SLOT_PISTOL ? s.mags[1] : 0 });
      }
      for (let i = 0; i < AMMO_ITEMS.length; i++) if (s.ammo[i] > 0) this.dropItem(AMMO_ITEMS[i], s.ammo[i], x, y, z, { spread: 1.5, noAuto: 2 });
      if (p.armorItem && p.armor > p.armorMax * 0.3) this.dropItem(p.armorItem, 1, x, y, z);
    }
    s.ammo = AMMO_ITEMS.map(() => 0);
    p.invDirty = true;
  }

  // give an item to a player (pickup / craft / search). Returns number taken.
  giveItem(p, item, count, mag) {
    const s = p.state;
    const def = ITEM_DEFS[item];
    if (!def) return 0;
    if (def.cat === 'schem') {
      this.unlockSchematic(item, p);
      return count;
    }
    if (def.cat === 'ammo') {
      const i = def.ammo;
      const room = AMMO_MAX[i] - s.ammo[i];
      const take = Math.min(room, count);
      s.ammo[i] += take;
      return take;
    }
    if (def.cat === 'weapon') {
      const slot = WEAPONS[item].slot;
      if (!s.weapons[slot]) {
        s.weapons[slot] = item;
        if (slot === SLOT_PRIMARY) s.mags[0] = mag ?? WEAPONS[item].mag;
        if (slot === SLOT_PISTOL) s.mags[1] = mag ?? WEAPONS[item].mag;
        return 1;
      }
      // store in inventory (keeps its mag)
      for (let i = 0; i < p.inv.length; i++) {
        if (!p.inv[i]) {
          p.inv[i] = { item, count: 1, mag: mag ?? (isFirearm(item) ? WEAPONS[item].mag : 0) };
          p.invDirty = true;
          return 1;
        }
      }
      return 0;
    }
    const left = addItem(p.inv, item, count);
    const taken = count - left;
    if (taken > 0) {
      p.invDirty = true;
      if (THROW_ITEMS.includes(item) && !s.weapons[SLOT_THROW]) s.weapons[SLOT_THROW] = item;
      this.syncThrow(p);
      if (def.cat === 'part') this.notify(NOTIFY.SUPPLY_FOUND, item);
    }
    return taken;
  }

  // give, or drop at the player's feet what does not fit
  giveOrDrop(p, item, count) {
    const taken = this.giveItem(p, item, count);
    if (taken > 0) this.pickupEvent(p, item, taken);
    if (taken < count) {
      const s = p.state;
      this.dropItem(item, count - taken, s.x, s.y, s.z, { spread: 0.8 });
      this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
    }
  }

  unlockSchematic(item, p) {
    const bit = SCHEM_BIT[item];
    if (bit === undefined || this.unlocked & (1 << bit)) return;
    this.unlocked |= 1 << bit;
    this.notify(NOTIFY.SCHEMATIC, item);
    if (p) this.sound(SOUND.CRAFT, p.state.x, p.state.y + 1, p.state.z, 20);
    this.globalDirty = true;
  }

  syncThrow(p) {
    const s = p.state;
    if (s.weapons[SLOT_THROW]) {
      s.throwCount = countItem(p.inv, s.weapons[SLOT_THROW]);
      if (s.throwCount === 0) {
        s.weapons[SLOT_THROW] = 0;
        for (const it of THROW_ITEMS) {
          const n = countItem(p.inv, it);
          if (n > 0) {
            s.weapons[SLOT_THROW] = it;
            s.throwCount = n;
            break;
          }
        }
      }
    } else {
      for (const it of THROW_ITEMS) {
        const n = countItem(p.inv, it);
        if (n > 0) {
          s.weapons[SLOT_THROW] = it;
          s.throwCount = n;
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- input
  handleInput(p, r) {
    p.renderTick = r.u16();
    p.renderFrac = r.u8() / 255;
    const n = r.u8();
    for (let i = 0; i < n && i < 8; i++) {
      const seq = r.u16();
      const buttons = r.u16();
      const yaw = dqangle16(r.u16());
      const pitch = Math.max(-1.55, Math.min(1.55, dqpitch(r.i16())));
      const slot = r.u8();
      p.cmdQueue.push({ seq, buttons, yaw, pitch, slot });
    }
    if (p.cmdQueue.length > 24) p.cmdQueue.splice(0, p.cmdQueue.length - 24);
  }

  processInputs() {
    for (const p of this.players.values()) {
      p.cmdBudget = Math.min(p.cmdBudget + 3, 10);
      while (p.cmdQueue.length && p.cmdBudget >= 1) {
        const cmd = p.cmdQueue.shift();
        if (p.hasSeq && ((cmd.seq - p.lastSeq) & 0xffff) >= 0x8000) continue; // old/duplicate
        if (p.hasSeq && cmd.seq === p.lastSeq) continue;
        p.cmdBudget--;
        p.lastSeq = cmd.seq;
        p.hasSeq = true;
        if (!p.alive) continue;
        const events = [];
        if (p.useItem && cmd.slot !== 255) p.useItem = null; // switching cancels use
        simulatePlayer(p.state, cmd, this.world, events);
        for (const ev of events) this.handleSimEvent(p, ev);
      }
    }
  }

  handleSimEvent(p, ev) {
    const s = p.state;
    switch (ev.type) {
      case 'fire':
        this.combat.fire(p, ev);
        break;
      case 'melee':
        this.combat.melee(p, ev);
        break;
      case 'throw': {
        const item = ev.item;
        removeItem(p.inv, item, 1);
        p.invDirty = true;
        this.syncThrow(p);
        this.combat.throwProjectile(p, item);
        break;
      }
      case 'reload':
        this.sound(currentWeapon(s) === ITEM.CROSSBOW ? SOUND.CROSSBOW_COCK : SOUND.RELOAD, s.x, s.y + 1.2, s.z, 20, p.id);
        break;
      case 'leap':
        this.sound(SOUND.ZPLAYER_GROWL, s.x, s.y + 1.5, s.z, 40, p.id);
        break;
      case 'land':
        if (!p.zombie && ev.v > 13) this.damagePlayer(p, (ev.v - 13) * 6, { kind: KILLER.WORLD });
        break;
    }
  }

  // ---------------------------------------------------------------- actions
  handleAction(p, r) {
    const act = r.u8();
    const s = p.state;
    if (!p.alive) return;
    if (p.zombie && act !== ACT.FLASHLIGHT && act !== ACT.PING) return;
    if (p.downed && act !== ACT.FLASHLIGHT && act !== ACT.PING && act !== ACT.USE_ITEM && act !== ACT.HOLD_END) return;
    switch (act) {
      case ACT.INTERACT:
        return this.interact(p, r.u16());
      case ACT.HOLD_BEGIN:
        return this.holdBegin(p, r.u16());
      case ACT.HOLD_END:
        p.hold = null;
        return;
      case ACT.PING: {
        const kind = r.u8();
        const x = r.i16() / 64;
        const y = r.i16() / 64;
        const z = r.i16() / 64;
        if (this.time - p.pingT < 0.6) return;
        p.pingT = this.time;
        this.emit((w) => {
          w.u8(EVT.PING);
          w.u16(p.id);
          w.u8(kind & 3);
          w.i16(qpos(x));
          w.i16(qpos(y));
          w.i16(qpos(z));
        });
        return;
      }
      case ACT.DROP_SLOT: {
        const idx = r.u8();
        const cnt = r.u8();
        const it = p.inv[idx];
        if (!it) return;
        const n = cnt === 0 ? it.count : Math.min(cnt, it.count);
        const ex = s.x - Math.sin(s.yaw) * 1.1;
        const ez = s.z - Math.cos(s.yaw) * 1.1;
        this.dropItem(it.item, n, ex, s.y, ez, { spread: 0.3, mag: it.mag, noAuto: 4 });
        it.count -= n;
        if (it.count <= 0) p.inv[idx] = null;
        p.invDirty = true;
        this.syncThrow(p);
        return;
      }
      case ACT.DROP_WEAPON: {
        const slot = r.u8();
        if (slot > 4 || slot === SLOT_THROW) return;
        const wpn = s.weapons[slot];
        if (!wpn) return;
        const ex = s.x - Math.sin(s.yaw) * 1.1;
        const ez = s.z - Math.cos(s.yaw) * 1.1;
        this.dropItem(wpn, 1, ex, s.y, ez, { spread: 0.2, mag: slot === SLOT_PRIMARY ? s.mags[0] : slot === SLOT_PISTOL ? s.mags[1] : 0 });
        s.weapons[slot] = 0;
        if (slot === SLOT_PRIMARY) s.mags[0] = 0;
        if (slot === SLOT_PISTOL) s.mags[1] = 0;
        return;
      }
      case ACT.CRAFT:
        return this.craft(p, r.u8());
      case ACT.USE_ITEM:
        return this.useItem(p, r.u8());
      case ACT.EQUIP_ARMOR:
        return this.useItem(p, r.u8());
      case ACT.BUILD: {
        const type = r.u8();
        const x = r.i16() / 64;
        const z = r.i16() / 64;
        const rot = r.u8();
        return this.build(p, type, x, z, rot);
      }
      case ACT.DEMOLISH:
        return this.demolish(p, r.u16());
      case ACT.REPAIR:
        return this.repair(p, r.u16());
      case ACT.FLASHLIGHT: {
        const on = r.u8() === 1;
        p.flashlight = on && p.battery > 1 && !p.zombie;
        return;
      }
      case ACT.SWAP_INV: {
        const a = r.u8();
        const b = r.u8();
        if (a >= INVENTORY_SIZE || b >= INVENTORY_SIZE) return;
        const A = p.inv[a];
        const B = p.inv[b];
        if (A && B && A.item === B.item && ITEM_DEFS[A.item].stack > 1) {
          const max = ITEM_DEFS[A.item].stack;
          const move = Math.min(max - B.count, A.count);
          B.count += move;
          A.count -= move;
          if (A.count <= 0) p.inv[a] = null;
        } else {
          p.inv[a] = B;
          p.inv[b] = A;
        }
        p.invDirty = true;
        return;
      }
      case ACT.SELECT_THROWABLE: {
        const item = r.u8();
        if (THROW_ITEMS.includes(item) && countItem(p.inv, item) > 0) {
          s.weapons[SLOT_THROW] = item;
          this.syncThrow(p);
        }
        return;
      }
      case ACT.INSTALL_PART:
        return this.interact(p, CAR_ID);
    }
  }

  nearCar(p, r = 5) {
    const s = p.state;
    const car = this.world.car;
    return Math.hypot(s.x - car.x, s.z - car.z) <= r;
  }

  // nearest structure of a crafting station kind ('fire' needs to be lit)
  nearStation(p, kind) {
    const s = p.state;
    for (const e of this.structures) {
      const def = STRUCT_DEFS[e.stype];
      if (def.station !== kind) continue;
      if (kind === 'fire' && e.burnLeft <= 0) continue;
      if (Math.hypot(e.x - s.x, e.z - s.z) <= CRAFT_STATION_RADIUS) return e;
    }
    return null;
  }

  interact(p, id) {
    if (this.time - p.interactT < 0.15) return;
    p.interactT = this.time;
    const s = p.state;
    const ex = s.x;
    const ey = s.y + eyeHeight(s);
    const ez = s.z;
    if (id === CAR_ID) {
      if (!this.nearCar(p)) return;
      let installed = 0;
      SUPPLIES.forEach((item, i) => {
        const need = SUPPLY_NEED[i] - this.supplies[i];
        if (need <= 0) return;
        const have = countItem(p.inv, item);
        const n = Math.min(need, have);
        if (n <= 0) return;
        removeItem(p.inv, item, n);
        this.supplies[i] += n;
        installed += n;
        this.notify(NOTIFY.CAR_PART, item);
      });
      const car = this.world.car;
      if (installed) {
        p.invDirty = true;
        this.sound(SOUND.CAR_PART, car.x, 0.8, car.z, 40);
        this.globalDirty = true;
        if (this.allSuppliesIn()) this.notify(NOTIFY.SUPPLIES_DONE, 0);
      } else if (!this.allSuppliesIn()) this.notify(NOTIFY.NEED_SUPPLIES, 0, p.id);
      return;
    }
    const e = this.ents[id];
    if (!e || e.removed) return;
    const dx = e.x - ex;
    const dz = e.z - ez;
    const dy = e.y - ey;
    const d = Math.hypot(dx, dz);
    if (d > (e.kind === ENT.CRATE ? 4.8 : 3.6) || Math.abs(dy) > 3) return;
    if (!this.canReachEnt(p, e)) return;
    if (e.kind === ENT.ITEM) {
      const taken = this.giveItem(p, e.item, e.count, e.mag);
      if (taken <= 0) {
        // weapon slot full & inventory full: swap weapon
        const def = ITEM_DEFS[e.item];
        if (def && def.cat === 'weapon') {
          const slot = WEAPONS[e.item].slot;
          const old = s.weapons[slot];
          const oldMag = slot === SLOT_PRIMARY ? s.mags[0] : slot === SLOT_PISTOL ? s.mags[1] : 0;
          s.weapons[slot] = e.item;
          if (slot === SLOT_PRIMARY) s.mags[0] = e.mag;
          if (slot === SLOT_PISTOL) s.mags[1] = e.mag;
          this.removeItemEnt(e);
          if (old) this.dropItem(old, 1, s.x, s.y, s.z, { mag: oldMag, spread: 0.5 });
          this.pickupEvent(p, e.item, 1);
        } else {
          this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
        }
        return;
      }
      this.pickupEvent(p, e.item, taken);
      e.count -= taken;
      if (e.count <= 0) this.removeItemEnt(e);
      return;
    }
    if (e.kind === ENT.CRATE) {
      if (e.state !== 1) return;
      e.state = 2;
      e.despawnAt = this.time + 180;
      const n = 5 + Math.floor(this.rng() * 3);
      for (let i = 0; i < n; i++) {
        const [item, cnt] = this.rollTable(CRATE_TABLE);
        this.dropItem(item, cnt, e.x, e.y, e.z, { spread: 1.4 + this.rng() * 1.2, life: 400 });
      }
      // supply drops often carry a schematic the team is still missing
      const missing = SCHEMATICS.filter((it) => !(this.unlocked & (1 << SCHEM_BIT[it])));
      if (missing.length && this.rng() < 0.45) this.dropItem(missing[Math.floor(this.rng() * missing.length)], 1, e.x, e.y, e.z, { spread: 1 });
      this.sound(SOUND.WOOD_BREAK, e.x, e.y + 0.5, e.z, 30);
      return;
    }
    if (e.kind === ENT.CACHE) {
      this.holdBegin(p, e.id);
      return;
    }
    if (e.kind === ENT.STRUCTURE) {
      if (e.stype === STRUCT.CAMPFIRE) return this.feedFire(p, e);
      this.repair(p, e.id);
    }
  }

  // eye -> the entity's interaction point (as the client picks it) isn't cut off by a wall
  canReachEnt(p, e) {
    const s = p.state;
    let y = e.y;
    if (e.kind === ENT.ITEM) y += 0.15;
    else if (e.kind === ENT.CRATE) y += 0.6;
    else if (e.kind === ENT.STRUCTURE) y += Math.min(1, STRUCT_DEFS[e.stype].sy * 0.5);
    else if (e.kind === ENT.PLAYER) y += 0.3;
    return canReach(this.world, s.x, s.y + eyeHeight(s), s.z, e.x, y, e.z, s.y + EYE_HEIGHT);
  }

  feedFire(p, e) {
    if (e.burnLeft >= CAMPFIRE_MAX_FUEL - 5) return;
    let item = 0;
    if (countItem(p.inv, ITEM.WOOD) > 0) item = ITEM.WOOD;
    else if (countItem(p.inv, ITEM.STICK) > 0) item = ITEM.STICK;
    if (!item) return this.notify(NOTIFY.NOT_ENOUGH, ITEM.STICK, p.id);
    removeItem(p.inv, item, 1);
    p.invDirty = true;
    const wasOut = e.burnLeft <= 0;
    e.burnLeft = Math.min(CAMPFIRE_MAX_FUEL, Math.max(0, e.burnLeft) + CAMPFIRE_FUEL[item]);
    e.state = 1;
    e.hp = e.maxHp;
    this.sound(SOUND.CAMPFIRE_ADD, e.x, e.y + 0.4, e.z, 30);
    if (wasOut) this.notify(NOTIFY.CAMPFIRE_LIT, p.id, p.id);
  }

  // ---------------------------------------------------------------- hold-to-interact
  holdBegin(p, id) {
    const s = p.state;
    if (p.useItem) return;
    if (id === CAR_ID) {
      if (!this.nearCar(p) || this.escape.active) return;
      if (!this.allSuppliesIn()) return this.interact(p, CAR_ID);
      p.hold = { kind: HOLD.ENGINE, target: CAR_ID, t: 0, need: ENGINE_START_TIME };
      return;
    }
    const e = this.ents[id];
    if (!e || e.removed || !this.canReachEnt(p, e)) return;
    const d = Math.hypot(e.x - s.x, e.z - s.z);
    if (e.kind === ENT.CACHE) {
      if (d > 2.8 || e.state !== 0) {
        if (e.state !== 0) this.notify(NOTIFY.SEARCH_EMPTY, 0, p.id);
        return;
      }
      p.hold = { kind: HOLD.SEARCH, target: id, t: 0, need: SEARCH_TIME };
      this.sound(SOUND.SEARCH, e.x, e.y, e.z, 18);
      return;
    }
    if (e.kind === ENT.PLAYER && e !== p && e.alive && e.downed && !e.zombie) {
      if (d > 2.6) return;
      p.hold = { kind: HOLD.REVIVE, target: id, t: 0, need: REVIVE_TIME };
      e.revivedBy = p.id;
    }
  }

  updateHold(p, dt) {
    const h = p.hold;
    if (!h) return;
    const s = p.state;
    let ok = !p.downed && !p.zombie && p.alive;
    let tgt = null;
    if (ok) {
      if (h.target === CAR_ID) ok = this.nearCar(p, 6) && !this.escape.active;
      else {
        tgt = this.ents[h.target];
        if (!tgt || tgt.removed) ok = false;
        else {
          const d = Math.hypot(tgt.x - s.x, tgt.z - s.z);
          if (h.kind === HOLD.SEARCH) ok = d < 3.2 && tgt.state === 0;
          else if (h.kind === HOLD.REVIVE) ok = d < 3 && tgt.alive && tgt.downed && !tgt.zombie;
          ok = ok && this.canReachEnt(p, tgt);
        }
      }
    }
    if (!ok) {
      if (tgt && h.kind === HOLD.REVIVE && tgt.revivedBy === p.id) tgt.revivedBy = 0;
      p.hold = null;
      return;
    }
    h.t += dt;
    if (h.kind === HOLD.REVIVE && tgt) tgt.revivedBy = p.id;
    if (h.t < h.need) return;
    p.hold = null;
    if (h.kind === HOLD.SEARCH) this.searchCache(p, tgt);
    else if (h.kind === HOLD.REVIVE) this.revive(tgt, p);
    else if (h.kind === HOLD.ENGINE) this.startEngine(p);
  }

  searchCache(p, c) {
    c.state = 1;
    const def = CONT_DEFS[c.ctype];
    const table = (def.table && CONT_TABLES[def.table]) || LOOT_TABLES[c.zone] || LOOT_TABLES[ZONE.ROADSIDE];
    const rolls = def.rolls[0] + Math.floor(this.rng() * (def.rolls[1] - def.rolls[0] + 1));
    for (let i = 0; i < rolls; i++) {
      const [item, n] = this.rollTable(table);
      this.giveOrDrop(p, item, n);
    }
    if (c.schem) {
      this.unlockSchematic(c.schem, p);
      this.pickupEvent(p, c.schem, 1);
      c.schem = 0;
    }
    this.sound(SOUND.SEARCH, c.x, c.y, c.z, 20);
  }

  pickupEvent(p, item, count) {
    this.emit(
      (w) => {
        w.u8(EVT.PICKUP);
        w.u8(item);
        w.u16(count);
      },
      { to: p.id },
    );
    p.invDirty = true;
  }

  // ---------------------------------------------------------------- gathering (melee on trees & wrecks)
  gatherHit(p, col, x, y, z, weapon) {
    const tree = !!(col.flags & COL.TREE);
    let g = this.gather.get(col);
    if (!g) {
      g = { left: tree ? 6 : 5 };
      this.gather.set(col, g);
    }
    if (g.left <= 0) {
      if (this.rng() < 0.35) this.notify(NOTIFY.SEARCH_EMPTY, tree ? 1 : 2, p.id);
      return;
    }
    g.left--;
    const r = this.rng;
    if (tree) {
      const dead = col.tv === 3 || col.tv === 4 || col.tv === 6;
      let sticks = weapon === ITEM.KNIFE ? 1 : 2;
      if (dead) sticks++;
      this.giveOrDrop(p, ITEM.STICK, sticks);
      const plankChance = (weapon === ITEM.MACHETE ? 0.35 : weapon === ITEM.HAMMER ? 0.15 : 0.22) + (col.tv === 5 ? 0.15 : 0);
      if (r() < plankChance) this.giveOrDrop(p, ITEM.WOOD, 1);
      if (!dead && r() < 0.07) this.giveOrDrop(p, ITEM.HERB, 1);
      this.sound(SOUND.CHOP, x, y, z, 30);
    } else {
      this.giveOrDrop(p, ITEM.SCRAP, weapon === ITEM.HAMMER ? 1 + (r() < 0.5 ? 1 : 0) : 1);
      if (r() < 0.3) this.giveOrDrop(p, ITEM.NAILS, 2 + Math.floor(r() * 3));
      if (r() < 0.08) this.giveOrDrop(p, ITEM.TAPE, 1);
      if (r() < 0.05) this.giveOrDrop(p, ITEM.WIRE, 1);
      if (r() < 0.04) this.giveOrDrop(p, ITEM.BATTERY, 1);
      this.sound(SOUND.SALVAGE, x, y, z, 35);
    }
  }

  craft(p, recipeId) {
    const rec = RECIPES[recipeId];
    if (!rec) return;
    if (rec.schem && !(this.unlocked & (1 << SCHEM_BIT[rec.schem]))) return this.notify(NOTIFY.LOCKED, rec.schem, p.id);
    if (rec.station && !this.nearStation(p, rec.station)) return this.notify(rec.station === 'fire' ? NOTIFY.NEED_FIRE : NOTIFY.NEED_BENCH, 0, p.id);
    if (!hasCost(p.inv, rec.cost)) {
      this.notify(NOTIFY.NOT_ENOUGH, 0, p.id);
      return;
    }
    const def = ITEM_DEFS[rec.out];
    // capacity check
    if (def.cat === 'ammo') {
      if (p.state.ammo[def.ammo] >= AMMO_MAX[def.ammo]) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
    } else if (def.cat === 'weapon') {
      const slot = WEAPONS[rec.out].slot;
      if (p.state.weapons[slot] && !p.inv.some((x) => !x)) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
    } else if (!canFit(p.inv, rec.out, rec.n)) {
      // paying may free slots; do a trial
      const copy = p.inv.map((x) => (x ? { ...x } : null));
      payCost(copy, rec.cost);
      if (!canFit(copy, rec.out, rec.n)) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
    }
    payCost(p.inv, rec.cost);
    this.giveItem(p, rec.out, rec.n);
    p.invDirty = true;
    this.syncThrow(p);
    this.sound(SOUND.CRAFT, p.state.x, p.state.y + 1, p.state.z, 15);
  }

  useItem(p, idx) {
    const it = p.inv[idx];
    if (!it) return;
    const s = p.state;
    const def = ITEM_DEFS[it.item];
    if (!def) return;
    if (p.downed && it.item !== ITEM.MEDKIT) return;
    if (def.cat === 'cons') {
      const c = CONSUMABLES[it.item];
      if (!c) return;
      if (c.heal && p.hp >= p.maxHp && !c.stamina && !p.downed) return;
      if (c.flashlight && p.battery >= FLASHLIGHT_MAX - 1) return;
      p.useItem = { item: it.item, t: 0, total: c.time };
      p.hold = null;
      return;
    }
    if (def.cat === 'armor') {
      const old = p.armorItem;
      const oldFrac = p.armorMax ? p.armor / p.armorMax : 0;
      p.inv[idx] = null;
      p.armorItem = it.item;
      p.armor = def.armor;
      p.armorMax = def.armor;
      if (old && oldFrac > 0.5) p.inv[idx] = { item: old, count: 1 };
      p.invDirty = true;
      return;
    }
    if (def.cat === 'weapon') {
      const slot = WEAPONS[it.item].slot;
      const cur = s.weapons[slot];
      const curMag = slot === SLOT_PRIMARY ? s.mags[0] : slot === SLOT_PISTOL ? s.mags[1] : 0;
      s.weapons[slot] = it.item;
      if (slot === SLOT_PRIMARY) s.mags[0] = it.mag || 0;
      if (slot === SLOT_PISTOL) s.mags[1] = it.mag || 0;
      p.inv[idx] = cur ? { item: cur, count: 1, mag: curMag } : null;
      s.slot = slot;
      s.switchT = 0.42;
      s.reloadT = 0;
      p.invDirty = true;
      return;
    }
    if (def.cat === 'throw') {
      s.weapons[SLOT_THROW] = it.item;
      this.syncThrow(p);
      return;
    }
  }

  finishUse(p) {
    const u = p.useItem;
    p.useItem = null;
    if (countItem(p.inv, u.item) <= 0) return;
    const c = CONSUMABLES[u.item];
    removeItem(p.inv, u.item, 1);
    p.invDirty = true;
    if (p.downed) {
      // a medkit gets you back on your feet
      this.revive(p, null, 50);
      return;
    }
    if (c.heal) p.hp = Math.min(p.maxHp, p.hp + c.heal);
    if (c.stamina) {
      p.state.stamina = 100;
      p.state.exhausted = 0;
    }
    if (c.flashlight) p.battery = FLASHLIGHT_MAX;
    this.sound(SOUND.HEAL, p.state.x, p.state.y + 1, p.state.z, 12);
  }

  // ---------------------------------------------------------------- building
  structCollider(type, x, y, z, rot8, id) {
    const def = STRUCT_DEFS[type];
    const yaw = (rot8 / 256) * Math.PI * 2;
    let flags = COL.STRUCT;
    if (!def.block) flags |= COL.NOBLOCK;
    if (def.humanPass) flags |= COL.HUMANPASS;
    if (type === STRUCT.BARBED_WIRE || type === STRUCT.CAMPFIRE) flags |= COL.NOBULLET;
    return makeBox(x, z, y - 0.3, y + def.sy, def.sx, def.sz, yaw, flags, id);
  }

  build(p, type, x, z, rot8) {
    const s = p.state;
    const def = STRUCT_DEFS[type];
    if (!def || s.slot !== SLOT_BUILD) return;
    if (this.time - p.actionT < 0.25) return;
    p.actionT = this.time;
    const fail = (why = NOTIFY.CANT_BUILD_HERE, arg = 0) => {
      this.notify(why, arg, p.id);
    };
    if (def.schem && !(this.unlocked & (1 << SCHEM_BIT[def.schem]))) return fail(NOTIFY.LOCKED, def.schem);
    if (this.structures.length >= MAX_STRUCTURES) return fail(NOTIFY.STRUCT_CAP);
    let y = this.world.heightAt(x, z);
    let door = null;
    if (def.snap === 'door') {
      door = this.world.openingNear(x, z, 1.4);
      if (!door) return fail(NOTIFY.DOOR_ONLY);
      x = door.x;
      z = door.z;
      y = door.y;
      rot8 = Math.round((((door.ry % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 256) & 255;
    }
    if (Math.hypot(x - s.x, z - s.z) > BUILD_REACH + (door ? 1 : 0)) return fail();
    const car = this.world.car;
    if (Math.hypot(x - car.x, z - car.z) < 3.2) return fail();
    if (this.world.isDeepWater(x, z)) return fail();
    if (!hasCost(p.inv, def.cost)) return fail(NOTIFY.NOT_ENOUGH);
    const col = this.structCollider(type, x, y, z, rot8, 0);
    // overlaps: static world, other blocking structures, players
    const tmp = [];
    if (!door) {
      this.world.staticGrid.query(x, z, col.r + 0.2, tmp);
      for (const o of tmp) {
        if (o.y1 < y + 0.2) continue;
        if (overlapBoxes(col, o)) return fail();
      }
    }
    this.world.structGrid.query(x, z, col.r + 0.2, tmp);
    for (const o of tmp) {
      const bothBlock = !(o.flags & COL.NOBLOCK) && def.block;
      const bothTrap = o.flags & COL.NOBLOCK && !def.block;
      if ((bothBlock || bothTrap) && overlapBoxes(col, o, -0.05)) return fail();
    }
    if (def.block) {
      for (const q of this.players.values()) {
        if (!q.alive) continue;
        if (def.humanPass && !q.zombie) continue;
        if (footprintContains(col, q.state.x, q.state.z, PLAYER_RADIUS)) return fail();
      }
      for (const zb of this.zombies) if (!zb.dead && footprintContains(col, zb.x, zb.z, zb.def.radius * 0.8)) return fail();
    }
    payCost(p.inv, def.cost);
    p.invDirty = true;
    const e = {
      kind: ENT.STRUCTURE,
      stype: type,
      rot8,
      x,
      y,
      z,
      hp: def.hp,
      maxHp: def.hp,
      state: 1,
      owner: p.id,
      burnLeft: def.burn || 0,
      collider: null,
      trapTick: 0,
    };
    if (!this.spawnEntity(e)) return;
    e.collider = this.structCollider(type, x, y, z, rot8, e.id);
    this.world.structGrid.add(e.collider);
    this.nav.addStructure(e.collider);
    this.structures.push(e);
    this.sound(SOUND.BUILD, x, y + 0.8, z, 35);
  }

  demolish(p, id) {
    const e = this.ents[id];
    if (!e || e.kind !== ENT.STRUCTURE) return;
    const s = p.state;
    if (Math.hypot(e.x - s.x, e.z - s.z) > 5) return;
    const def = STRUCT_DEFS[e.stype];
    const frac = (e.hp / e.maxHp) * 0.5;
    for (const k in def.cost) {
      const n = Math.floor(def.cost[k] * frac);
      if (n > 0) this.giveItem(p, +k, n) < n && this.dropItem(+k, n, e.x, e.y, e.z);
    }
    p.invDirty = true;
    this.destroyStructure(e, false);
  }

  repair(p, id) {
    const e = this.ents[id];
    if (!e || e.kind !== ENT.STRUCTURE) return;
    const s = p.state;
    if (s.weapons[SLOT_BUILD] !== ITEM.HAMMER) return;
    if (Math.hypot(e.x - s.x, e.z - s.z) > 4.5) return;
    if (e.stype === STRUCT.CAMPFIRE) return this.feedFire(p, e);
    if (e.hp >= e.maxHp && !(e.stype === STRUCT.TORCH && e.burnLeft <= 0)) return;
    if (this.time - p.actionT < 0.6) return;
    if (e.stype === STRUCT.TORCH) {
      if (countItem(p.inv, ITEM.CLOTH) < 1) return this.notify(NOTIFY.NOT_ENOUGH, ITEM.CLOTH, p.id);
      removeItem(p.inv, ITEM.CLOTH, 1);
      e.burnLeft = STRUCT_DEFS[STRUCT.TORCH].burn;
      e.hp = e.maxHp;
    } else {
      if (!hasCost(p.inv, REPAIR_COST)) return this.notify(NOTIFY.NOT_ENOUGH, 0, p.id);
      payCost(p.inv, REPAIR_COST);
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.35);
    }
    p.actionT = this.time;
    p.invDirty = true;
    this.sound(SOUND.BUILD, e.x, e.y + 0.8, e.z, 30);
  }

  damageStructure(e, amount) {
    if (e.removed) return;
    e.hp -= amount;
    this.sound(e.stype === STRUCT.METAL_WALL ? SOUND.METAL_HIT : SOUND.WOOD_HIT, e.x, e.y + 1, e.z, 40);
    if (e.hp <= 0) this.destroyStructure(e, true);
  }

  destroyStructure(e, broken) {
    if (e.removed) return;
    this.world.structGrid.remove(e.collider);
    this.nav.removeStructure(e.collider);
    this._listRemove(this.structures, e);
    if (broken) {
      if (this.phase === PHASE.NIGHT) this.nightStats.structLost++;
      this.emit(
        (w) => {
          w.u8(EVT.STRUCT_BREAK);
          w.i16(qpos(e.x));
          w.i16(qpos(e.y));
          w.i16(qpos(e.z));
          w.u8(e.stype);
        },
        { x: e.x, z: e.z, r: 120 },
      );
      this.sound(e.stype === STRUCT.METAL_WALL ? SOUND.METAL_HIT : SOUND.WOOD_BREAK, e.x, e.y + 1, e.z, 70);
    }
    this.removeEntity(e);
  }

  // ---------------------------------------------------------------- damage (players)
  damagePlayer(p, amount, src) {
    if (!p.alive || amount <= 0) return;
    if (this.godMode && !p.zombie) return;
    if (this.phase !== PHASE.DAY && this.phase !== PHASE.NIGHT) return;
    if (p.downed) {
      // hits on a downed survivor drain what's left of their blood
      p.bleed -= amount * 0.12;
      p.lastSrc = src;
      p.lastDamageT = this.time;
      if (p.bleed <= 0) this.killPlayer(p, src);
      return;
    }
    if (!p.zombie && p.armor > 0) {
      const def = ITEM_DEFS[p.armorItem];
      const absorb = def ? def.absorb : 0.3;
      const soak = Math.min(p.armor, amount * absorb);
      p.armor -= soak;
      amount -= soak;
      if (p.armor <= 0.5) {
        p.armor = 0;
        p.armorItem = 0;
        p.armorMax = 0;
      }
    }
    p.hp -= amount;
    p.lastDamageT = this.time;
    p.lastSrc = src;
    const s = p.state;
    const fx = src.x ?? s.x;
    const fz = src.z ?? s.z;
    this.emit(
      (w) => {
        w.u8(EVT.DAMAGE);
        w.u8(Math.min(255, Math.round(amount)));
        w.i16(qpos(fx));
        w.i16(qpos(fz));
      },
      { to: p.id },
    );
    if (this.rng() < 0.5) this.sound(p.zombie ? SOUND.ZOMBIE_PAIN : SOUND.PLAYER_HURT, s.x, s.y + 1.5, s.z, 30, p.id);
    if (p.hp <= 0) {
      if (!p.zombie && (this.standing() > 1 || countItem(p.inv, ITEM.MEDKIT) > 0)) this.goDown(p);
      else this.killPlayer(p, src);
    }
  }

  goDown(p) {
    p.downed = true;
    p.hp = 0;
    p.bleed = DOWN_TIME;
    p.useItem = null;
    p.hold = null;
    p.revivedBy = 0;
    this.releaseHolds(p);
    const s = p.state;
    s.downed = 1;
    s.sprinting = 0;
    if (s.weapons[SLOT_PISTOL]) s.slot = SLOT_PISTOL;
    this.nightStats.downs++;
    this.notify(NOTIFY.DOWNED, p.id);
    this.sound(SOUND.DOWNED, s.x, s.y + 0.6, s.z, 70);
    this.playersDirty = true;
    this.checkAllDead();
  }

  revive(p, by, hp = REVIVE_HP) {
    if (!p.downed) return;
    p.downed = false;
    p.state.downed = 0;
    p.hp = hp;
    p.bleed = 0;
    p.revivedBy = 0;
    p.lastDamageT = this.time;
    this.nightStats.revives++;
    this.notify(NOTIFY.REVIVED, p.id);
    this.sound(SOUND.REVIVE, p.state.x, p.state.y + 1, p.state.z, 30);
    if (by) by.kills += 0; // (revives are shown on the scoreboard summary instead)
    this.playersDirty = true;
  }

  killPlayer(p, src, silent = false) {
    p.hp = 0;
    p.alive = false;
    p.deaths++;
    p.useItem = null;
    p.hold = null;
    p.downed = false;
    p.state.downed = 0;
    this.releaseHolds(p);
    const s = p.state;
    s.vx = s.vy = s.vz = 0;
    if (src.kind === KILLER.PLAYER) {
      const k = this.players.get(src.id);
      if (k) k.kills++;
    }
    this.killfeed(src.kind || KILLER.WORLD, src.kind === KILLER.PLAYER ? src.id : src.ztype ?? 0, p.id, src.weapon || 0, (src.headshot ? 1 : 0) | (p.zombie ? 2 : 0));
    if (!p.zombie) {
      this.nightStats.deaths++;
      this.dropAll(p);
      s.weapons = [0, 0, 0, 0, 0];
      p.armor = 0;
      p.armorItem = 0;
      p.armorMax = 0;
      p.flashlight = false;
      this.notify(NOTIFY.YOU_DIED, src.kind === KILLER.ZOMBIE ? src.ztype : 255, p.id);
      this.notify(NOTIFY.PLAYER_DIED, p.id);
      this.sound(SOUND.PLAYER_DEATH, s.x, s.y + 1, s.z, 60);
      p.respawnT = 6;
      p.becomeZombie = true;
    } else {
      this.sound(SOUND.ZOMBIE_DEATH, s.x, s.y + 1, s.z, 40);
      p.respawnT = 8;
      p.becomeZombie = true;
    }
    this.playersDirty = true;
    if (!silent) this.checkAllDead();
  }

  // leaper pin / roper rope bookkeeping
  releaseHolds(p) {
    for (const z of this.zombies) {
      if (z.link === p.id) this.zm.releaseLink(z);
    }
    p.state.pulled = 0;
    p.state.pinned = 0;
  }

  // ---------------------------------------------------------------- chat
  handleChat(p, text) {
    text = text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
    if (!text) return;
    if (this.debugCommands && text.startsWith('/')) return this.debugCommand(p, text.slice(1).split(/\s+/));
    if (this.time - p.chatT > 5) {
      p.chatT = this.time;
      p.chatCount = 0;
    }
    if (++p.chatCount > 6) return;
    const w = new Writer(text.length * 3 + 8);
    w.u8(S2C.CHAT);
    w.u16(p.id);
    w.u8(p.zombie ? 2 : 0);
    w.str(text);
    this.broadcast(w.bytes());
  }
  debugCommand(p, args) {
    const s = p.state;
    switch (args[0]) {
      case 'kill':
        if (p.alive) this.killPlayer(p, { kind: KILLER.WORLD });
        break;
      case 'down':
        if (p.alive && !p.zombie && !p.downed) this.goDown(p);
        break;
      case 'night':
        if (this.phase === PHASE.DAY) this.timeLeft = 0.05;
        break;
      case 'day':
        if (this.phase === PHASE.NIGHT) this.timeLeft = 0.05;
        break;
      case 'give': {
        const item = +args[1];
        if (ITEM_DEFS[item]) this.giveItem(p, item, +(args[2] || 1));
        p.invDirty = true;
        break;
      }
      case 'spawn': {
        const t = +args[1];
        const n = Math.min(20, +(args[2] || 1));
        for (let i = 0; i < n; i++) this.zm.spawn(t, s.x - Math.sin(s.yaw) * 12 + (this.rng() - 0.5) * 4, s.z - Math.cos(s.yaw) * 12 + (this.rng() - 0.5) * 4, { horde: true, boss: ZOMBIE_DEFS[t]?.boss });
        break;
      }
      case 'supply': {
        // drop a crate a few meters in front of the player from low altitude
        const x = s.x - Math.sin(s.yaw) * 5;
        const z = s.z - Math.cos(s.yaw) * 5;
        const e = { kind: ENT.CRATE, x, y: s.y + 12, z, gy: groundAt(this.world, x, z, 200, 0.6), state: 0, despawnAt: this.time + 600 };
        if (this.spawnEntity(e)) this.crates.push(e);
        break;
      }
      case 'parts':
        for (let i = 0; i < SUPPLIES.length; i++) this.supplies[i] = SUPPLY_NEED[i];
        this.globalDirty = true;
        break;
      case 'engine':
        for (let i = 0; i < SUPPLIES.length; i++) this.supplies[i] = SUPPLY_NEED[i];
        this.startEngine(p);
        break;
      case 'unlock':
        for (const it of SCHEMATICS) this.unlockSchematic(it, null);
        break;
      case 'tp': {
        const x = +args[1];
        const z = +args[2];
        if (Number.isFinite(x) && Number.isFinite(z)) {
          s.x = x;
          s.z = z;
          s.y = groundAt(this.world, x, z, 200, 0.3);
          s.vx = s.vy = s.vz = 0;
          this.fillHistory(p);
        }
        break;
      }
      case 'cat': {
        // bring the cat over (2 m in front)
        const c = this.cats[0];
        if (c) {
          c.x = s.x - Math.sin(s.yaw) * 2;
          c.z = s.z - Math.cos(s.yaw) * 2;
          c.y = groundAt(this.world, c.x, c.z, 200, 0.2);
          c.vx = c.vz = c.vy = 0;
        }
        break;
      }
      case 'where':
        this.systemChat(`pos ${s.x.toFixed(1)} ${s.y.toFixed(1)} ${s.z.toFixed(1)} zone ${this.world.zoneAt(s.x, s.z)}`);
        break;
    }
    this.systemChat(`[debug] ${args.join(' ')}`);
  }

  systemChat(text) {
    const w = new Writer(text.length * 3 + 8);
    w.u8(S2C.CHAT);
    w.u16(0);
    w.u8(1);
    w.str(text);
    this.broadcast(w.bytes());
  }
  broadcast(bytes) {
    for (const p of this.players.values()) p.session.conn.send(bytes);
  }

  // ---------------------------------------------------------------- tick
  update() {
    const t0 = performance.now();
    this.tick++;
    const dt = SERVER_DT;
    this.time += dt;
    // release quarantined ids
    while (this.quarantine.length && this.quarantine[1] <= this.tick) {
      this.freeIds.push(this.quarantine[0]);
      this.quarantine.splice(0, 2);
    }
    if (this.phase === PHASE.WAITING) {
      this.processInputs();
      this.sendSnapshots();
      return;
    }
    this.processInputs();
    this.updatePhase(dt);
    this.updatePlayers(dt);
    this.zm.update(dt);
    this.cm.update(dt);
    this.combat.updateProjectiles(dt);
    this.combat.updateAreas(dt);
    this.updateStructures(dt);
    this.updateItems(dt);
    this.updateCrates(dt);
    this.recordHistory();
    this.sendSnapshots();
    this.stats.tickMs = this.stats.tickMs * 0.95 + (performance.now() - t0) * 0.05;
  }

  hordeAlive() {
    let n = 0;
    for (const z of this.zombies) if (z.horde && !z.dead) n++;
    return n;
  }

  spawnHordeGroup(type0Queue, anchor) {
    const humans = this.humans();
    if (!humans.length) return 0;
    const alive = this.zombies.length;
    if (alive >= MAX_ZOMBIES_ALIVE) return 0;
    const sp = anchor ? this.zm.pickSpawnAround(anchor.x, anchor.z, humans) : this.zm.pickHordeSpawn(humans);
    if (!sp) return 0;
    const group = 3 + Math.floor(this.rng() * 3);
    let n = 0;
    for (let i = 0; i < group && type0Queue.length && alive + i < MAX_ZOMBIES_ALIVE; i++) {
      const type = type0Queue.pop();
      const z = this.zm.spawn(type, sp.x + (this.rng() - 0.5) * 8, sp.z + (this.rng() - 0.5) * 8, { horde: true, hpMul: this.hordeHpMul });
      if (!z) type0Queue.push(type);
      else n++;
    }
    if (n) this.globalDirty = true;
    return n;
  }

  updatePhase(dt) {
    if (this.phase === PHASE.GAMEOVER || this.phase === PHASE.VICTORY) {
      this.restartT -= dt;
      if (this.restartT <= 0) this.startGame();
      return;
    }
    // the final stand at the car pauses the day/night clock
    if (this.escape.active) return this.updateEscape(dt);
    const prevSec = Math.ceil(this.timeLeft);
    this.timeLeft -= dt;
    if (Math.ceil(this.timeLeft) !== prevSec && prevSec % 5 === 0) this.globalDirty = true;
    if (this.phase === PHASE.DAY) {
      if (!this.warned && this.timeLeft <= DUSK_WARNING) {
        this.warned = true;
        this.notify(NOTIFY.HORDE_SOON, this.day);
        this.sound(SOUND.HORDE_HORN, 0, 0, 0, 0);
      }
      for (let i = this.supplyAt.length - 1; i >= 0; i--) {
        if (this.timeLeft <= this.supplyAt[i]) {
          this.supplyAt.splice(i, 1);
          this.spawnSupplyDrop();
        }
      }
      if (this.timeLeft <= 0) this.startNight();
    } else if (this.phase === PHASE.NIGHT) {
      const elapsed = this.nightLen - this.timeLeft;
      for (let k = 0; k < this.waves.length; k++) {
        const wv = this.waves[k];
        if (!wv.started && elapsed >= wv.start) {
          wv.started = true;
          this.wave = k + 1;
          if (k > 0) this.notify(NOTIFY.WAVE, k + 1);
          this.globalDirty = true;
        }
        if (!wv.started || !wv.queue.length) continue;
        wv.spawnT -= dt;
        if (wv.spawnT <= 0) {
          wv.spawnT = wv.interval * (0.7 + this.rng() * 0.6);
          this.spawnHordeGroup(wv.queue);
        }
      }
      if (this.bossPending) {
        this.bossPending.t -= dt;
        if (this.bossPending.t <= 0) this.spawnBosses(this.bossPending.types);
      }
      if (this.timeLeft <= 0) this.startDay();
    }
    this.trackBoss();
  }

  spawnBosses(types, anchor) {
    const humans = this.humans();
    const sp = anchor ? this.zm.pickSpawnAround(anchor.x, anchor.z, humans) : this.zm.pickHordeSpawn(humans);
    if (!sp) return;
    for (const type of types) {
      const z = this.zm.spawn(type, sp.x, sp.z, { horde: true, hpMul: 1 + 0.35 * (Math.max(1, this.humanCount()) - 1) + 0.05 * this.day, boss: true });
      if (z) {
        this.bossId = z.id;
        this.notify(NOTIFY.BOSS, type);
        this.sound(SOUND.BOSS_ROAR, sp.x, 2, sp.z, 0);
      }
    }
    this.bossPending = null;
    this.globalDirty = true;
  }

  trackBoss() {
    if (this.bossId) {
      const b = this.ents[this.bossId];
      if (!b || b.kind !== ENT.ZOMBIE || b.dead) {
        this.bossId = 0;
        for (const z of this.zombies) if (z.boss && !z.dead) this.bossId = z.id;
        this.globalDirty = true;
      }
    }
  }

  // The engine is warming up: the whole valley heard it. Hold the car until it is ready, then get in.
  updateEscape(dt) {
    const e = this.escape;
    const car = this.world.car;
    if (!e.ready) {
      const prev = Math.ceil(e.t);
      e.t -= dt;
      if (Math.ceil(e.t) !== prev) this.globalDirty = true;
      e.spawnT -= dt;
      const cap = Math.min(MAX_ZOMBIES_ALIVE, 40 + this.day * 8);
      if (e.spawnT <= 0 && this.hordeAlive() < cap) {
        e.spawnT = Math.max(1.2, 3 - this.day * 0.15) * (0.7 + this.rng() * 0.6);
        const n = this.day;
        const q = [];
        for (let i = 0; i < 5; i++) {
          const r = this.rng();
          q.push(r < 0.45 ? ZTYPE.WALKER : r < 0.72 ? ZTYPE.RUNNER : r < 0.8 && n >= 2 ? ZTYPE.SPITTER : r < 0.87 && n >= 2 ? ZTYPE.BOOMER : r < 0.93 && n >= 3 ? ZTYPE.LEAPER : r < 0.97 && n >= 3 ? ZTYPE.TANK : ZTYPE.RUNNER);
        }
        this.spawnHordeGroup(q, car);
      }
      if (!e.boss && e.t <= ESCAPE_TIME * 0.5) {
        e.boss = true;
        this.spawnBosses([this.day % 2 ? ZTYPE.BOSS_ABOMINATION : ZTYPE.BOSS_HIVEQUEEN], car);
      }
      if (e.t <= 0) {
        e.t = 0;
        e.ready = true;
        this.notify(NOTIFY.ESCAPE_READY, 0);
        this.sound(SOUND.CAR_START, car.x, car.y + 0.8, car.z, 300);
        this.globalDirty = true;
      }
    } else {
      for (const p of this.players.values()) {
        if (!p.alive || p.zombie) continue;
        if (Math.hypot(p.state.x - car.x, p.state.z - car.z) <= ESCAPE_RADIUS) {
          this.victory();
          return;
        }
      }
    }
    this.trackBoss();
  }

  spawnSupplyDrop() {
    const humans = this.humans();
    // somewhere 70-200 m from the survivors
    let pts = this.world.resourceSpawns.filter((p) => {
      let md = Infinity;
      for (const h of humans) md = Math.min(md, Math.hypot(h.state.x - p.x, h.state.z - p.z));
      return md > 70 && md < 200;
    });
    if (!pts.length) pts = this.world.resourceSpawns;
    if (!pts.length) return;
    const sp = pts[Math.floor(this.rng() * pts.length)];
    const e = { kind: ENT.CRATE, x: sp.x, y: sp.y + 110, z: sp.z, gy: groundAt(this.world, sp.x, sp.z, 200, 0.6), state: 0, despawnAt: this.time + 600 };
    if (!this.spawnEntity(e)) return;
    this.crates.push(e);
    this.notify(NOTIFY.SUPPLY_DROP, 0);
    this.sound(SOUND.PLANE, sp.x, 80, sp.z, 0);
  }

  updateCrates(dt) {
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      if (c.state === 0) {
        c.y -= 5.5 * dt;
        if (c.y <= c.gy) {
          c.y = c.gy;
          c.state = 1;
          this.sound(SOUND.CRATE_LAND, c.x, c.y, c.z, 80);
        }
      }
      if (this.time > c.despawnAt) {
        this.crates.splice(i, 1);
        this.removeEntity(c);
      }
    }
  }

  // lit campfire within the heal radius?
  nearLitFire(x, z) {
    for (const e of this.structures) {
      if (e.stype !== STRUCT.CAMPFIRE || e.burnLeft <= 0) continue;
      if (Math.hypot(e.x - x, e.z - z) < CAMPFIRE_HEAL_RADIUS) return true;
    }
    return false;
  }

  updatePlayers(dt) {
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.respawnT > 0) {
          p.respawnT -= dt;
          if (p.respawnT <= 0 && (this.phase === PHASE.DAY || this.phase === PHASE.NIGHT)) {
            this.spawnPlayerZombie(p);
            this.checkAllDead();
          }
        }
        continue;
      }
      const s = p.state;
      if (p.zombie) {
        if (this.time - p.lastDamageT > 4) p.hp = Math.min(p.maxHp, p.hp + 4 * dt);
        continue;
      }
      if (p.downed) {
        if (!p.revivedBy) p.bleed -= dt;
        if (p.useItem) {
          p.useItem.t += dt;
          if (p.useItem.t >= p.useItem.total) this.finishUse(p);
        }
        if (p.downed && p.bleed <= 0) this.killPlayer(p, p.lastSrc || { kind: KILLER.WORLD });
        if (p.revivedBy) {
          const rv = this.players.get(p.revivedBy);
          if (!rv || !rv.hold || rv.hold.target !== p.id) p.revivedBy = 0;
        }
        continue;
      }
      // healing
      if (this.time - p.lastDamageT > HEAL_DELAY && p.hp < p.maxHp) {
        const nearFire = this.nearLitFire(s.x, s.z);
        p.hp = Math.min(p.maxHp, p.hp + (nearFire ? HEAL_RATE_CAMPFIRE : HEAL_RATE) * dt);
      }
      // flashlight battery
      if (p.flashlight) {
        p.battery -= FLASHLIGHT_DRAIN * dt;
        if (p.battery <= 0) {
          p.battery = 0;
          p.flashlight = false;
        }
      } else p.battery = Math.min(FLASHLIGHT_MAX, p.battery + FLASHLIGHT_RECHARGE * dt);
      // item use
      if (p.useItem) {
        p.useItem.t += dt;
        if (p.useItem.t >= p.useItem.total) this.finishUse(p);
      }
      this.updateHold(p, dt);
      if (p.invDirty) this.syncThrow(p);
    }
  }

  updateStructures(dt) {
    for (let i = this.structures.length - 1; i >= 0; i--) {
      const e = this.structures[i];
      if (e.stype === STRUCT.TORCH) {
        e.burnLeft -= dt;
        e.state = e.burnLeft > 0 ? 1 : 0;
        if (e.burnLeft < -30) this.destroyStructure(e, false);
      } else if (e.stype === STRUCT.CAMPFIRE) {
        if (e.burnLeft > 0) {
          e.burnLeft -= dt;
          // the dead avoid nothing, but stepping into the flames hurts
          if (this.tick % 5 === 0) {
            this.zm.forNear(e.x, e.z, 1.4, (z) => {
              if (!z.dead && !z.def.flying && Math.hypot(z.x - e.x, z.z - e.z) < 1.1) this.combat.damageZombie(z, 22 * dt * 5, null, { fire: true });
            });
          }
        }
        e.state = e.burnLeft > 0 ? 1 : 0;
      }
    }
  }

  updateItems(dt) {
    // auto-pickup of materials / ammo / consumables the survivors walk over
    if (this.tick % 4 === 0) {
      for (const p of this.players.values()) {
        if (!p.alive || p.zombie || p.downed) continue;
        const s = p.state;
        for (let i = this.items.length - 1; i >= 0; i--) {
          const e = this.items[i];
          if (!e || e.removed) continue;
          const dx = e.x - s.x;
          const dz = e.z - s.z;
          if (dx * dx + dz * dz > 1.9 * 1.9 || Math.abs(e.y - s.y) > 1.6) continue;
          if (this.time < e.noAutoUntil) continue;
          const cat = ITEM_DEFS[e.item]?.cat;
          if (!AUTO_PICKUP[cat] || !this.canReachEnt(p, e)) continue;
          const taken = this.giveItem(p, e.item, e.count, e.mag);
          if (taken <= 0) {
            e.noAutoUntil = this.time + 3;
            continue;
          }
          this.pickupEvent(p, e.item, taken);
          e.count -= taken;
          if (e.count <= 0) this.removeItemEnt(e);
          else e.noAutoUntil = this.time + 3;
        }
      }
    }
    // despawn dropped items, respawn loot points slowly when nobody is watching
    if (this.tick % 10 !== 0) return;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      if (this.time > e.despawnAt) this.removeItemEnt(e);
    }
    const humans = this.humans();
    for (const lp of this.lootPoints) {
      if (lp.ent || this.time < lp.respawnAt || lp.respawnAt === 0) continue;
      let seen = false;
      for (const h of humans) {
        if (Math.hypot(h.state.x - lp.x, h.state.z - lp.z) < 30) {
          seen = true;
          break;
        }
      }
      if (!seen) this.spawnLoot(lp);
    }
  }

  recordHistory() {
    const k = this.tick & 15;
    for (const z of this.zombies) {
      z.hx[k] = z.x;
      z.hy[k] = z.y;
      z.hz[k] = z.z;
    }
    for (const p of this.players.values()) {
      p.hx[k] = p.state.x;
      p.hy[k] = p.state.y;
      p.hz[k] = p.state.z;
    }
  }

  // ---------------------------------------------------------------- networking out
  writeGlobal(w) {
    w.u8(this.phase);
    w.u8(this.day);
    w.u16(Math.max(0, Math.round(this.timeLeft * 10)));
    let hordeLeft = this.hordeAlive();
    for (const wv of this.waves) hordeLeft += wv.queue.length;
    w.u16(this.phase === PHASE.NIGHT || this.escape.active ? Math.min(0xfffe, hordeLeft) : 0xffff);
    w.u16(this.bossId);
    for (let i = 0; i < SUPPLIES.length; i++) w.u8(this.supplies[i]);
    for (let i = 0; i < 7; i++) w.u8(this.supplyHints[i] ?? 255);
    w.u8(this.unlocked);
    w.u8(this.phase === PHASE.NIGHT ? this.wave : 0);
    w.u8(NIGHT_WAVES);
    w.u16(Math.round(Math.max(0, this.escape.t) * 10));
    w.u8((this.escape.active ? 1 : 0) | (this.allSuppliesIn() ? 2 : 0) | (this.escape.ready ? 4 : 0));
    let alive = 0;
    let total = 0;
    for (const p of this.players.values()) {
      total++;
      if (p.alive && !p.zombie) alive++;
    }
    w.u8(alive);
    w.u8(total);
    w.f32(this.restartT);
    w.u16(Math.round(this.phase === PHASE.DAY ? (this.day <= 1 ? this.firstDayLen : this.dayLen) : this.nightLen));
  }

  // Self state for reconciliation, delta-compressed in 6 chunks against what this client last got
  // (byte-compared), so an idle player costs 1 byte/tick and a moving one ~30.
  writeSelf(w, p) {
    const s = p.state;
    const c = this.cw || (this.cw = new Writer(128));
    if (!p.selfCache) p.selfCache = [null, null, null, null, null, null];
    const maskAt = w.reserve8();
    let mask = 0;
    for (let chunk = 0; chunk < 6; chunk++) {
      c.reset();
      switch (chunk) {
        case 0:
          c.f32(s.x);
          c.f32(s.y);
          c.f32(s.z);
          c.f32(s.vx);
          c.f32(s.vy);
          c.f32(s.vz);
          break;
        case 1: {
          let f = 0;
          if (s.onGround) f |= 1;
          if (s.crouch) f |= 2;
          if (s.exhausted) f |= 4;
          if (s.zombie) f |= 8;
          if (s.pulled) f |= 16;
          if (s.pinned) f |= 32;
          if (s.sprinting) f |= 64;
          if (p.alive) f |= 128;
          if (p.flashlight) f |= 256;
          if (s.downed) f |= 512;
          c.u16(f);
          c.u16(Math.round(s.stamina * 100));
          c.u16(Math.round(Math.max(0, s.staminaDelay) * 1000));
          break;
        }
        case 2:
          c.u8(s.slot);
          c.u16(Math.round(Math.max(0, s.switchT) * 1000));
          c.u16(Math.round(Math.max(0, s.cooldown) * 1000));
          c.u16(Math.round(Math.max(0, s.reloadT) * 1000));
          c.u16(Math.round(s.recoil * 1000));
          c.u16(s.lastBtn);
          c.u8(s.fireCount);
          break;
        case 3:
          for (let i = 0; i < 5; i++) c.u8(s.weapons[i]);
          c.u8(s.mags[0]);
          c.u8(s.mags[1]);
          for (let i = 0; i < AMMO_ITEMS.length; i++) c.u16(s.ammo[i]);
          c.u8(s.throwCount);
          break;
        case 4:
          c.u16(Math.round(Math.max(0, s.leapCd) * 1000));
          c.u16(Math.round(Math.max(0, s.stunT) * 1000));
          if (s.pulled) {
            c.f32(s.pullX);
            c.f32(s.pullY);
            c.f32(s.pullZ);
          }
          break;
        case 5: {
          c.u16(Math.max(0, Math.ceil(p.hp)));
          c.u16(p.maxHp);
          c.u8(Math.ceil(p.armor));
          c.u8(p.armorMax);
          c.u8(Math.round(p.battery));
          c.u8(p.useItem ? p.useItem.item : 0);
          c.u8(p.useItem ? Math.min(255, Math.round((p.useItem.t / p.useItem.total) * 255)) : 0);
          c.f32(p.respawnT);
          const h = p.hold;
          c.u8(h ? h.kind : 0);
          c.u8(h ? Math.min(255, Math.round((h.t / h.need) * 255)) : 0);
          c.u8(p.downed ? Math.max(0, Math.min(255, Math.ceil(p.bleed * 4))) : 0);
          c.u8(p.revivedBy ? 1 : 0);
          break;
        }
      }
      const prev = p.selfCache[chunk];
      let same = prev && prev.length === c.o;
      if (same) {
        for (let i = 0; i < c.o; i++) {
          if (prev[i] !== c.u8a[i]) {
            same = false;
            break;
          }
        }
      }
      if (same) continue;
      mask |= 1 << chunk;
      p.selfCache[chunk] = c.u8a.slice(0, c.o);
      w.ensure(c.o);
      w.u8a.set(c.u8a.subarray(0, c.o), w.o);
      w.o += c.o;
    }
    w.patch8(maskAt, mask);
  }

  sendInventory(p) {
    const w = this.w.reset();
    w.u8(S2C.INVENTORY);
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const it = p.inv[i];
      w.u8(it ? it.item : 0);
      w.u8(it ? it.count : 0);
    }
    w.u8(p.armorItem);
    w.u8(Math.ceil(p.armor));
    w.u8(p.armorMax);
    p.session.conn.send(w.bytes());
    this.stats.bytesOut += w.o;
    p.invDirty = false;
  }

  sendPlayers() {
    const w = this.w.reset();
    w.u8(S2C.PLAYERS);
    w.u8(this.players.size);
    for (const p of this.players.values()) {
      w.u16(p.id);
      w.str(p.name);
      w.u8(!p.alive ? 2 : p.zombie ? 1 : p.downed ? 3 : 0);
      w.u16(p.kills + p.zkills);
      w.u16(Math.min(9999, Math.round(p.ping)));
    }
    this.broadcast(w.bytes());
    this.playersDirty = false;
  }

  sendSnapshots() {
    if (this.playersDirty || this.tick - this.playersListT > 40) {
      this.playersListT = this.tick;
      this.sendPlayers();
    }
    const sendGlobal = this.globalDirty || this.tick % 20 === 0;
    this.globalDirty = false;
    const all = this.all;
    for (const p of this.players.values()) {
      if (p.invDirty) this.sendInventory(p);
      const w = this.w.reset();
      w.u8(S2C.SNAPSHOT);
      w.u32(this.tick);
      w.u16(p.lastSeq);
      w.u8(sendGlobal ? 1 : 0);
      if (sendGlobal) this.writeGlobal(w);
      this.writeSelf(w, p);
      writeEntities(w, p.view, p, all, this.tick);
      // events
      const at = w.reserve8();
      let n = 0;
      const px = p.state.x;
      const pz = p.state.z;
      for (const ev of this.events) {
        if (ev.to && ev.to !== p.id) continue;
        if (ev.except && ev.except === p.id) continue;
        if (ev.r2) {
          const dx = ev.x - px;
          const dz = ev.z - pz;
          if (dx * dx + dz * dz > ev.r2) continue;
        }
        if (n >= 255) break;
        w.ensure(ev.bytes.length);
        w.u8a.set(ev.bytes, w.o);
        w.o += ev.bytes.length;
        n++;
      }
      w.patch8(at, n);
      p.session.conn.send(w.bytes());
      this.stats.bytesOut += w.o;
      this.stats.msgsOut++;
    }
    this.events.length = 0;
  }
}

export { SLOT_BUILD, SLOT_PISTOL };
