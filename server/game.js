// Authoritative game simulation.
//
// Iteration 2 loop: by day the team scavenges the valley (containers, wrecks, trees, schematics) and
// hunts for the car supplies hidden around the map; by night the horde comes in waves to wherever the
// survivors are, so they throw up a temporary shelter on the spot. Every night is harder. Once every
// supply is in the car, starting the engine triggers the final stand - survive it and drive away.
import {
  SERVER_TICK_RATE,
  HISTORY_TICKS,
  SERVER_DT,
  CMD_RATE,
  MAX_PLAYERS,
  MAX_ENTITIES,
  PHASE,
  CMDS_PER_PACKET,
  dayLength,
  NIGHT_LENGTH,
  DUSK_WARNING,
  NIGHT_WAVES,
  WAVE_TIMES,
  WAVE_SPREAD,
  TANK_BOSS_HP,
  BOSS_WAVE,
  BOSS_HP_PER_PLAYER,
  BOSS_HP_PER_NIGHT,
  ESCAPE_TIME,
  ESCAPE_RADIUS,
  ESCAPE_DRIVE_TIME,
  GAME_OVER_DELAY,
  PLAYER_MAX_HP,
  STAMINA_MAX,
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
  SLOT_MELEE,
  SLOT_THROW,
  SLOT_BUILD,
  INVENTORY_SIZE,
  INVENTORY_MAX,
  PLAYER_RADIUS,
  PLAYER_HEIGHT,
  WATER_LEVEL,
  STEP_HEIGHT,
  DOWN_TIME,
  REVIVE_TIME,
  REVIVE_HP,
  DAWN_RETURN,
  SEARCH_TIME,
  ENGINE_START_TIME,
  INTERACT_REACH,
  PICK_RADIUS,
  INTERACT_SLACK,
  HOLD_SLACK,
  EYE_HEIGHT,
  HORDE_SPAWN_MIN,
  HORDE_SPAWN_MAX,
  PLANE_SPEED,
  PLANE_LEAD,
  PLANE_ALTITUDE,
  PLANE_RAMP,
  CRATE_FREEFALL,
  CRATE_FALL_SPEED,
  CRATE_DRAG,
  NOISE,
  TALK_CLEAR,
  TALK_RANGE,
  SLOT_RADIO,
} from '../shared/constants.js';
import {
  ITEM,
  ITEM_DEFS,
  WEAPONS,
  RECIPES,
  SALVAGE,
  STRUCT,
  STRUCT_DEFS,
  structPickRadius,
  REPAIR_COST,
  CAMPFIRE_FUEL,
  CAMPFIRE_MAX_FUEL,
  ZTYPE,
  ZOMBIE_DEFS,
  LOOT_TABLES,
  suppliesOf,
  CACHE_GAVE,
  SCHEMATICS,
  SCHEM_BIT,
  CONT,
  CONT_DEFS,
  CONT_TABLES,
  loadedAmmo,
  CONSUMABLES,
  useWasted,
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
  radioLinked,
  salvageOf,
} from '../shared/defs.js';
import { C2S, S2C, SNAP, SELF, ACT, SALVAGE_FROM, WORN, WORN_DO, UNDO_NO, ENT, HOLD, CAR_ID, REJECT_REASON, LEFT_CODE, CHATF, PLF, PROGF, WELCOMEF, PROTOCOL_VERSION, Writer, Reader, readInput, writeBoard, qpos, dqpos, usePos, qangle8, qangle16, dqangle16, dqpitch } from '../shared/protocol.js';
import { XP, XPS, XP_SRC, levelOf, perkMods, perkMask } from '../shared/progress.js';
import { worldFor } from '../shared/worlds.js';
import { WORLD, nightRank, ARRIVAL_DAY, MAINLAND_DAY_MORE, CROSSING, TAKEOFF_TIME, RUNWAY, BRIDGEHEAD, PLANE_REACH } from '../shared/acts.js';
import { fellTree, regrowTrees } from '../shared/felling.js';
import { blowOf, BLOW } from '../shared/surfaces.js';
import { WRECK_SALVAGE, WRECK_HITS_MAX, HITF, WRECKF, WRECK_ALARM, ALARM, ALARM_SAY, alarmStep, wreckOf, wreckLocal } from '../shared/wrecks.js';
import { PRY, pryTime, pryWeapon, trunkCar, hasBootLid } from '../shared/trunk.js';
import { MineNav } from './minenav.js';
import { createPlayerState, copyPlayerState, samePlayerState, snapPlayerState, hashPlayerState, simulatePlayer, eyeHeight, currentWeapon, DRAW_TIME, radioKeyed } from '../shared/playersim.js';
import { makeBox, COL, footprintContains, groundAt, resolveBody, overlapBoxes, canReach } from '../shared/collision.js';
import { mulberry32 } from '../shared/rng.js';
import { swimming, DROWN_DPS } from '../shared/swim.js';
import { nightTheme, nightBoss } from '../shared/nights.js';
import { difficultyOf } from '../shared/difficulty.js';
import { Nav } from './nav.js';
import { ClientView, writeEntities, stageEntities } from './snapshot.js';
import { createInventory, invCap, addItem, removeItem, takeFrom, tidyStacks, countItem, countsMap, payCost, canFit, freeSlot, sortInventory } from './inventory.js';
import { planCost } from '../shared/autocraft.js';
import { Zombies } from './zombies.js';
import { Cats } from './cats.js';
import { Deer } from './deer.js';
import { Combat } from './combat.js';
import { TickStats, T_INPUTS, T_PHASE, T_PLAYERS, T_ZOMBIES, T_CATS, T_COMBAT, T_UPKEEP, T_SNAPSHOTS } from './tickstats.js';
import { PlayerStats, idKey } from './stats.js';
import { Fixtures } from './fixtures.js';
import { Cemetery } from './cemetery.js';
import { MountedGun } from './mountedgun.js';
import { GUN, GUN_LYING } from '../shared/mountedgun.js';
import { Fair } from './fair.js';
import { Handcars } from './handcar.js';
import { FAIR_GEN_ID, FAIR_TANK_ID } from '../shared/protocol.js';
import { Power } from './power.js';
import { MatchTracker } from './analytics.js';
import { AchievementTracker } from './achievements.js';
import { BestiaryTracker } from './bestiary.js';
import { checkEnvelope, worldHash, HandoffError } from './handoff.js';
import { saveGame, loadGame } from './gamestate.js';
import { CHARACTER_NONE, characterFor, defaultCharacter } from '../shared/characters.js';
import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_ZOMBIES_ALIVE = 120;
// The final stand is sized from the night of the same number (hordeSize), so it follows the team the way the nightly
// waves do. Balance numbers, a first pass:
const FINAL_STAND_SIZE = 1.25; // its zombies, as a multiple of that night's horde (the ones that join at the start count)
const FINAL_STAND_ALIVE = 0.6; // at most this share of them is on its feet at once
const FINAL_STAND_SPREAD = ESCAPE_TIME - 30; // seconds they set out over: a walker needs the last 30 of the warm-up to reach the car
const FINAL_STAND_TANKS = 1; // Tanks among them, per survivor (the boss comes on top)
const FINAL_STAND_JOIN_RANGE = 95; // wanderers this close to a survivor join the stand (the same reach as at nightfall)
// The escape is the team's to make (the radius and the hold are ESCAPE_RADIUS and ESCAPE_DRIVE_TIME in constants.js).
// Also a first pass:
const ESCAPE_LINGER_PACE = 0.5; // once the engine is warm, groups keep coming at this share of the stand's pace until someone drives
const NO_HASH = -2; // a command packet that came without a state fingerprint
const WEDGED_FOR = 15; // s one of the dead has been after a survivor without getting anywhere (z.wedgeT): its kill earns no XP
const CMDS_PER_TICK = CMD_RATE / SERVER_TICK_RATE; // commands a client issues per server tick
const CMD_QUEUE_MAX = 24; // commands a client can have waiting (0.4 s of them); older ones are dropped
const CMD_CATCH_UP = 1.05; // a client's command allowance refills this much faster than it issues them (processInputs)
const CAR_ALARM_CHANCE = 0.1;
const CAR_ALARM_MIN_ZOMBIES = 6;
const CAR_ALARM_MAX_ZOMBIES = 7;
const CAR_ALARM_SPAWN_MIN = 62;
const CAR_ALARM_SPAWN_MAX = 86;
// A stack a survivor put down on purpose (ACT.DROP_SLOT) is theirs to leave lying: walking over it does not put it
// back in their backpack until they have been this far from it. A teammate's feet, and their own [E], take it as usual.
const DROP_LEAVE_DIST = 3;
// ACT.UNDO_DROP: how long after a drop (s) it can be taken back, and how far from it (m) its dropper may have moved.
// The client offers it for 5 s; the rest is the round trip
const UNDO_DROP_TIME = 6;
const UNDO_DROP_REACH = 5;
// seconds between two "no room for that" notices to a survivor whose full backpack keeps leaving things on the ground
const FULL_NOTICE_EVERY = 6;
const AUTO_PICKUP = { res: 1, ammo: 1, cons: 1, throw: 1, part: 1, schem: 1 };
// Someone who joins a run in progress is put down beside the team (pickJoinSpawn): JOIN_NEAR_MIN..MAX metres from a
// teammate, at whichever of JOIN_TRIES spots around them is furthest from the dead (nothing within JOIN_CLEAR is
// as good as it gets). If even that one has a zombie within JOIN_LAP, the ring out to JOIN_FAR_MAX is tried too.
const JOIN_NEAR_MIN = 2.5;
const JOIN_NEAR_MAX = 9;
const JOIN_FAR_MAX = 22;
const JOIN_TRIES = 48;
const JOIN_CLEAR = 15;
const JOIN_LAP = 6;
const LEFT_KITS_MAX = 64; // kits remembered for players who left this run (parkKit)
// What a survivor starts with. Day 1's kit is the opening hand; someone who joins on a later day gets a little more
// 9mm, bandages and light for each day gone by (first-pass numbers): enough to be of use that night, well short of
// what those days of scavenging turn up - no primary, no armour, no medkit, nothing to throw.
const STEP_IDLE = 20000; // ms: a clock held by /step is let go when nothing has been asked of it for this long
const STARTER_TOOLS = [0, ITEM.PISTOL, ITEM.KNIFE, 0, ITEM.HAMMER]; // by weapon slot
function starterKit(day = 1, diff = null) {
  const d = Math.max(0, day - 1);
  const ammo = diff?.ammo ?? 1;
  const bandages = diff?.bandages ?? 1;
  return {
    mag: WEAPONS[ITEM.PISTOL].mag,
    ammo: Math.min(AMMO_MAX[AMMO.P9], Math.max(0, Math.round((36 + 24 * d) * ammo))), // 9mm in reserve
    items: [
      [ITEM.BANDAGE, Math.max(1, Math.round((2 + Math.min(3, d)) * bandages))],
      [ITEM.TORCH, d ? 2 : 1],
      [ITEM.WOOD, 6],
      [ITEM.NAILS, 8],
      [ITEM.STICK, 4],
      [ITEM.CLOTH, 1],
    ],
  };
}
// A loose drop is an entity every client in range has to be told about, so there is a ceiling on them: once this
// many lie around the valley, each new one takes the place of the oldest (spawnItem). Car supplies and schematics
// never despawn and are not counted. (A whole lobby dying with full packs is under 300.)
const MAX_DROPS = 400;
// Coming and going. An address may join twice the lobby in one go, then once every JOIN_EVERY seconds: more than
// a household reloading its browsers gets near (admitJoin). The join / leave chat lines of everybody together
// get two lobbies' worth, then one every GREET_EVERY seconds; past that, players come and go unannounced.
const JOIN_EVERY = 4;
const GREET_EVERY = 10;
// A dropped player (connection lost, browser crashed or closed) keeps their place this long (onClose / hold / resume).
// The client closes with LEFT_CODE when "Leave game" is pressed: that one goes at once. REJOIN_GRACE_SECONDS: tests.
export const REJOIN_GRACE = +(process.env.REJOIN_GRACE_SECONDS || 60);
const DEAD_CONN = { send() {}, close() {}, closed: true, slot: -1, user: null, ip: '' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Debug commands take an item by id or by name: its ITEM key (`ammo_fuel`) or what the inventory calls it
// (`flamethrower fuel`). Case, spaces, underscores and dashes don't matter, and the start of a name will do as long
// as it fits one item only. A zombie type goes the same way: its ZTYPE key (`boss_hivequeen`) or its name
// (`hive queen`).
const ITEM_CAT_LABELS = { res: 'resources', cons: 'consumables', throw: 'throwables', armor: 'armor', pack: 'backpacks', gear: 'gear', weapon: 'weapons', ammo: 'ammo', part: 'car parts', schem: 'schematics' };
const itemKey = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
const ITEM_NAMES = Object.entries(ITEM)
  .filter(([, id]) => ITEM_DEFS[id])
  .map(([key, id]) => ({ id, name: key.toLowerCase(), keys: [itemKey(key), itemKey(ITEM_DEFS[id].name)] }));
const ZOMBIE_NAMES = Object.entries(ZTYPE).map(([key, id]) => ({ id, name: key.toLowerCase(), keys: [itemKey(key), itemKey(ZOMBIE_DEFS[id].name)] }));
// every one of `names` (ITEM_NAMES, ZOMBIE_NAMES) `text` could mean: exactly one if it is clear
function findNamed(names, text) {
  if (/^\d+$/.test(text)) return names.filter((it) => it.id === +text);
  const k = itemKey(text);
  if (!k) return [];
  for (const fits of [(key) => key === k, (key) => key.startsWith(k), (key) => key.includes(k)]) {
    const found = names.filter((it) => it.keys.some(fits));
    if (found.length) return found;
  }
  return [];
}

const CRATE_TABLE = [
  [ITEM.AMMO_762, 5, 30, 60],
  [ITEM.AMMO_556, 5, 30, 60],
  [ITEM.AMMO_SHELLS, 5, 8, 16],
  [ITEM.AMMO_9MM, 4, 20, 40],
  [ITEM.MEDKIT, 4, 1, 2],
  [ITEM.PIPEBOMB, 2, 1, 2],
  [ITEM.GRENADE, 2, 1, 2],
  [ITEM.MOLOTOV, 2, 1, 2],
  [ITEM.FLARE, 3, 2, 3],
  [ITEM.AMMO_FLARE, 2, 2, 3],
  [ITEM.FLARE_GUN, 1, 1, 1],
  [ITEM.PLATE, 2, 1, 1],
  [ITEM.GUNPARTS, 3, 1, 2],
  [ITEM.AK47, 1, 1, 1],
  [ITEM.M4A1, 1, 1, 1],
  [ITEM.MP5, 1, 1, 1],
  [ITEM.SHOTGUN, 1, 1, 1],
  [ITEM.DB_SHOTGUN, 1, 1, 1],
  [ITEM.FLAMETHROWER, 1, 1, 1],
  [ITEM.AMMO_FUEL, 2, 40, 80],
  [ITEM.RPG, 1, 1, 1],
  [ITEM.AMMO_ROCKET, 2, 2, 3],
  [ITEM.AT_RIFLE, 1, 1, 1],
  [ITEM.AMMO_145, 3, 3, 6],
  [ITEM.KEVLAR, 1, 1, 1],
  [ITEM.NAILS, 3, 10, 20],
  [ITEM.BATTERY, 2, 1, 2],
  [ITEM.POWDER, 3, 5, 10],
];

// What a player who died comes back with at dawn (returnFallen), next to the tools every survivor has (pistol,
// knife, hammer): the magazine in the pistol and one bandage. Enough for a daytime walk back to where they fell;
// nothing to hold a night with. Against the starting kit that is 36 rounds, a bandage, the torch and two
// barricades' worth of wood and nails short - and everything they had found lies where they died (dropAll), for
// 240 s: still there at sunrise after a death in the night, gone after one earlier in the day unless a teammate
// picked it up. First-pass numbers. The shape is a starting kit's: rounds in the pistol, 9mm in reserve, pack items.
// They are put down beside the team, where a late joiner would be (pickJoinSpawn).
const RETURN_KIT = { mag: WEAPONS[ITEM.PISTOL].mag, ammo: 0, items: [[ITEM.BANDAGE, 1]] };

const randomSeed = () => (Math.random() * 0x7fffffff) | 0;

// a car supply on the ground that is not in its hiding place (that one is only rumoured): dropped, or where its
// carrier fell
const looseSupply = (e) => e.permanent && e.hint < 0 && ITEM_DEFS[e.item]?.cat === 'part';

export class Game {
  // opts.restore: a game the last server saved as it went down (handoff.js envelope), to carry on from where it was.
  // One this build cannot read throws a HandoffError, and nothing is made.
  constructor(opts = {}) {
    const restore = opts.restore || null;
    if (restore) checkEnvelope(restore);
    this.fixedSeed = opts.seed !== undefined; // a given seed pins the map: every playthrough is the same valley
    this.maxPlayers = opts.maxPlayers ?? MAX_PLAYERS;
    this.diff = difficultyOf(opts.difficulty); // Ember / Nightfall / Blackout. Nightfall is every multiplier at 1.
    // optional overrides (testing): DAY_SECONDS / NIGHT_SECONDS / START_DAY env vars. A fixed length is that length:
    // the difficulty stretches the schedule, not a test that pinned the clock.
    this.dayLenOverride = opts.dayLength || 0; // every day this long (otherwise they shorten: dayLength)
    this.nightLen = opts.nightLength || Math.round(NIGHT_LENGTH * this.diff.night);
    this.startDayNum = opts.startDay || 1;
    this.godMode = !!opts.godMode; // testing only: survivors take no damage
    // Signed-in accounts with users.is_admin may run the admin chat commands. DEV_ADMIN=1 grants the same access
    // only on a non-production test/look-dev server without requiring accounts.
    this.devAdmin = !!opts.devAdmin;
    this.dawnReturn = opts.dawnReturn ?? DAWN_RETURN; // the dead are survivors again at sunrise (the option: tests)
    this.themes = opts.themes !== false; // night themes (shared/nights.js). false: every night is plain (tests, benchmarks)
    // an emptied game rolls its next valley on the next tick (resetToWaiting). false: on the next join instead - a
    // game in a worker of its own (room-worker.js), which closes if nobody comes, need not build one for nobody
    this.rollWhenEmpty = opts.rollWhenEmpty !== false;
    this.log = opts.log ?? ((...a) => console.log('[game]', ...a));
    this.records = opts.stats ?? new PlayerStats(); // the leaderboard (stats.js): the server's is kept in a file, this one goes with the game
    // (a restored game's valley is the one it was played on: built from its seed, which pins nothing)
    // The run's act (shared/acts.js): 1 on the island, 2 on the mainland. checkpoint: what the team crossed the
    // bridge with (arrive), which a wipe on the mainland starts again from. crossing: the cutscene between the two,
    // while it plays ({ pending: the mainland is still to be built, skip: who has asked to skip it }).
    this.act = WORLD.ISLAND;
    this.checkpoint = null;
    this.crossing = null;
    this.setWorld(restore ? restore.game.seed : opts.seed ?? randomSeed(), restore?.game.act ?? WORLD.ISLAND);
    if (restore && restore.worldHash !== this.worldHash) throw new HandoffError(`this build makes another valley of seed ${this.seed}`);
    this.rng = mulberry32(this.seed ^ 0xabcdef);

    this.ents = new Array(MAX_ENTITIES).fill(null);
    this.gens = new Uint32Array(MAX_ENTITIES);
    this.freeIds = [];
    this.quarantine = [];
    this.nextId = 1;
    this.all = []; // live entity list (players included)

    this.sessions = new Set();
    this.players = new Map(); // id -> player
    this.joins = new Map(); // address -> its join allowance (see allow)
    this.greets = { n: 0, t: 0 }; // the allowance of join / leave chat lines
    this.zombies = [];
    this.items = [];
    this.maxDrops = opts.maxDrops ?? MAX_DROPS;
    this.drops = 0; // loose drops lying around (items with e.drop)
    this.dropSeq = 0;
    this.structures = [];
    this.projectiles = [];
    this.areas = [];
    this.crates = [];
    this.flyovers = []; // supply planes on their way to a release point
    this.caches = []; // searchable containers
    this.cats = [];
    this.deer = []; // the deer, the dead ones lying about included (deer.js)

    this.tick = 0;
    this.time = 0;
    this.phase = PHASE.WAITING;
    this.day = 0;
    this.timeLeft = 0;
    this.supplies = [0, 0, 0, 0, 0]; // installed per SUPPLIES entry
    this.supplyHints = [255, 255, 255, 255, 255, 255, 255]; // zones: 4 parts + 3 jerry cans
    this.supplyFound = 0; // a bit per hint: that one has been taken from its hiding place (nothing left to search there)
    this.unlocked = 0; // schematics bitmask
    this.schemHints = [255, 255, 255, 255, 255]; // zones: where each schematic (SCHEMATICS order) is rumoured to be
    this.fallen = new Set(); // who left dead since the last sunrise (leaverKey: removePlayer, handleJoin)
    this.waves = [];
    this.wave = 0;
    this.bossPending = null;
    this.bossId = 0;
    this.warned = false;
    this.shadeWarned = false; // the "a shade is out there" notice went out tonight
    this.escape = this.noEscape();
    this.supplyAt = [];
    this.restartT = 0;
    this.globalDirty = true;
    this.playersDirty = true;
    this.playersListT = 0;
    // collider -> { left, day } and, of a wreck that was hit, { hits, alarm, ringT, pulseT } (shared/wrecks.js)
    this.gather = new Map();
    this.ringing = new Set(); // the wrecks (colliders) whose alarm is going
    this.stepMode = false; // the clock held by the admin /step (room-worker.js): ticks only as they are asked for
    this.stepCredit = 0;
    this.stepAsked = 0;
    this.leftKits = new Map(); // leaverKey -> what is left of the starting kit of a player who left this run (parkKit)
    this.nightStats = { kills: 0, structLost: 0, downs: 0, deaths: 0, revives: 0 };

    this.lootPoints = [];
    this.dropper = 0; // the survivor putting a stack down right now (ACT.DROP_SLOT), for spawnItem to note on the item
    this.w = new Writer(1 << 16);
    this.ew = new Writer(1 << 14);
    this.events = [];

    this.zm = new Zombies(this);
    this.cm = new Cats(this);
    this.dm = new Deer(this);
    this.combat = new Combat(this);
    this.fixtures = new Fixtures(this); // the chapel bell and the Relay Station's radio
    this.cemetery = new Cemetery(this); // the dead that come up out of the graves at St. Agnes (cemetery.js)
    this.gun = new MountedGun(this); // the mounted gun at the Army Checkpoint, on the maps that have one
    this.fair = new Fair(this); // the Tri-County Fair: its generator and who is on its rides
    this.handcars = new Handcars(this); // the handcars on the railway: where they are on the line, who rides them
    this.power = new Power(this); // the buildable generator and its floodlights
    this.stats = { bytesOut: 0, msgsOut: 0, lastReport: Date.now(), tickMs: 0 };
    this.tickStats = new TickStats(1000 / SERVER_TICK_RATE); // how long ticks take and where a slow one went (update)
    this.track = new MatchTracker(this, opts.analytics); // match analytics (analytics.js): a no-op without opts.analytics
    this.inviteOnly = !!opts.inviteOnly; // only its link gets anyone in (rooms.js): the Plus One achievement
    // achievements (achievements.js). opts.achieve: where an account's go (the network thread); none: no accounts
    this.ach = new AchievementTracker(this, opts.achieve);
    // the kinds of the dead each player has seen (bestiary.js). opts.bestiary: where an account's go (the network thread)
    this.bestiary = new BestiaryTracker(this, opts.bestiary);
    if (restore) this.load(restore.game);
  }

  // ---------------------------------------------------------------- handoff (handoff.js, gamestate.js)
  // The game as plain data, for the next server. Only between ticks: some systems swap this.rng inside one.
  save() {
    return saveGame(this);
  }
  // ...and back, into a game just made on the save's valley. The run's match goes on as a new one (analytics.js:
  // the old server ended its own as 'handoff').
  load(s) {
    loadGame(this, s);
    if (this.phase === PHASE.DAY || this.phase === PHASE.NIGHT) this.track.start();
  }

  // ---------------------------------------------------------------- entity registry
  // Returns null when every id is in use (or resting in quarantine): callers have to cope with that.
  spawnEntity(e) {
    let id;
    if (this.freeIds.length) id = this.freeIds.pop();
    else if (this.nextId < MAX_ENTITIES) id = this.nextId++;
    // (the id check is a backstop: an entity whose id is not a slot of the registry mis-frames every snapshot
    // it is written into, for every client)
    if (!Number.isInteger(id) || id <= 0 || id >= MAX_ENTITIES) return null;
    this.gens[id] = (this.gens[id] + 1) >>> 0 || 1;
    e.id = id;
    e.gen = this.gens[id];
    e.removed = false;
    this.ents[id] = e;
    this.all.push(e);
    return e;
  }
  // An entity back under the id it had (gamestate.js: the registry's ids and generations are restored first). null when
  // that id is no slot or is taken.
  spawnEntityAt(e, id) {
    if (!Number.isInteger(id) || id <= 0 || id >= MAX_ENTITIES || this.ents[id]) return null;
    if (!this.gens[id]) this.gens[id] = 1;
    e.id = id;
    e.gen = this.gens[id];
    e.removed = false;
    this.ents[id] = e;
    this.all.push(e);
    if (id >= this.nextId) this.nextId = id + 1;
    return e;
  }
  removeEntity(e) {
    if (e.removed) return;
    e.removed = true;
    // only the holder of a slot gives its id back: an entity that never got one (spawnEntity returned null) would
    // put `undefined` into the free list, and the next thing spawned would take that as its id
    if (this.ents[e.id] !== e) return;
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
  // code: the socket's close code. A player whose connection dropped (or whose browser crashed or closed) is held for
  // REJOIN_GRACE seconds rather than removed: they stay where they were, safe - the dead don't go for them, nothing hurts
  // them, a downed one doesn't bleed - and a JOIN from the same account or browser in that time puts them back in their
  // own body with everything they had (handleJoin -> resume). Only "Leave game" (LEFT_CODE), or a player nobody could
  // know again (no account, no browser id), leaves at once; the held are removed when their time is up (update).
  onClose(session, code = 0) {
    this.sessions.delete(session);
    const p = session.player;
    if (!p) return;
    if (code !== LEFT_CODE && p.rejoinKey && (this.phase === PHASE.DAY || this.phase === PHASE.NIGHT || this.phase === PHASE.CROSSING)) this.hold(p);
    else this.removePlayer(p);
  }

  // grace: seconds they have to come back. handoff: they were brought over from the last server (gamestate.js), and
  // quiet: nobody is told (everybody was moved).
  hold(p, { grace = REJOIN_GRACE, quiet = false, handoff = false } = {}) {
    p.away = { since: this.time, grace, handoff };
    p.session = { conn: DEAD_CONN, player: p, ip: '', msgCount: 0, msgWindow: 0 }; // (whatever the game still sends them goes nowhere)
    p.cmdQueue.length = 0;
    p.hold = null;
    this.endUse(p);
    this.releaseHolds(p); // (a leaper or a roper on them lets go)
    this.playersDirty = true;
    if (!quiet) this.systemChat(`${p.name} lost connection - holding their place for ${grace} seconds.`);
    this.log(`hold ${p.name}: ${handoff ? 'from the last server' : 'dropped'}, ${grace} s to come back`);
  }

  // a held player is back (a JOIN from the same account or browser): this session takes over their body
  resume(session, p) {
    const moved = p.away?.handoff;
    p.away = null;
    p.session = session;
    session.player = p;
    p.admin = !!session.conn.user?.isAdmin || this.devAdmin;
    // a new client: it knows nothing yet - everything is sent again as to a newcomer, and its commands count from 0
    p.cmdQueue.length = 0;
    p.lastSeq = 0;
    p.hasSeq = false;
    p.recvSeq = 0;
    p.view = new ClientView();
    p.selfSync = true;
    // (what the old client was sent: writeSelf, writeGlobalFor and the player list only send what differs from it, and
    // the new one starts from its defaults - a held zombie would come back to a survivor's HUD)
    p.selfCache = null;
    p.globalCache = null;
    p.listVer = -1;
    p.snapTick = -2;
    p.ackSent = 0;
    p.invDirty = true;
    p.progDirty = true; // (their XP too)
    p.progT = -99;
    const w = new Writer(64);
    w.u8(S2C.WELCOME);
    w.u16(p.id);
    w.u32(this.seed >>> 0);
    w.u32(this.tick);
    w.u8(SERVER_TICK_RATE);
    w.u8(this.maxPlayers);
    w.u8(p.admin ? WELCOMEF.ADMIN : 0);
    w.u8(this.act); // which of the run's two maps that seed is to be built as (shared/acts.js)
    session.conn.send(w.bytes());
    const spent = [];
    for (const [col, g] of this.gather) if (g.left <= 0) spent.push(col);
    this.tellStripped(spent, p.id);
    this.tellWrecks(p.id);
    this.tellFriendCodes(p);
    this.bestiary.join(p);
    this.sendChat(p, 0, CHATF.SYSTEM, moved ? 'The server was updated while you played: you are back where you were, with what you had.' : 'Reconnected: you are back where you were, with what you had.');
    if (!moved) this.systemChat(`${p.name} reconnected.`);
    this.playersDirty = true;
    this.globalDirty = true;
    this.log(`resume ${p.name}`);
  }
  onMessage(session, data) {
    usePos(this.world); // (positions in what this message says are in this world's units: protocol.js)
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
        case C2S.BOARD:
          return this.sendBoard(p);
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

  // A rate allowance: a.n is how much of it was used lately, wearing off by one every `every` seconds (a.t: when
  // that was last worked out). Uses one more unless that would take it past `burst`.
  allow(a, burst, every) {
    a.n = Math.max(0, a.n - (this.time - a.t) / every);
    a.t = this.time;
    if (a.n + 1 > burst) return false;
    a.n++;
    return true;
  }
  // May this session's address join now? (JOIN_EVERY; an allowance that has worn off is forgotten in update)
  admitJoin(session) {
    let a = this.joins.get(session.ip);
    if (!a) this.joins.set(session.ip, (a = { n: 0, t: this.time, refused: false }));
    const ok = this.allow(a, 2 * this.maxPlayers, JOIN_EVERY);
    if (!ok && !a.refused) this.log(`join refused: too many in a row from ${session.ip || 'one address'}`);
    a.refused = !ok;
    return ok;
  }

  handleJoin(session, r) {
    if (session.player) return;
    const version = r.u8();
    let name = r.str().replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Survivor';
    // who they are to the leaderboard: for PlayerStats.enter alone, never logged and never sent on. (A client that
    // sends none - the test bots - plays like anyone else, and nothing is kept for it.)
    const pid = r.left > 0 ? r.str() : '';
    // the survivor they chose to be (shared/characters.js): a trailing byte an older client leaves off, which gets the
    // look picked from their id as before; a value out of range is treated the same (characterFor)
    const choice = r.left > 0 ? r.u8() : CHARACTER_NONE;
    // signed in to an account (server/auth.js: the network thread knew them by their session cookie, and says so
    // on the socket: room-worker.js), they play under its name whatever the JOIN says
    const account = session.conn.user || null;
    if (account) name = account.name;
    const reject = (reason) => {
      const w = new Writer(4);
      w.u8(S2C.REJECT);
      w.u8(reason);
      session.conn.send(w.bytes());
    };
    if (version !== PROTOCOL_VERSION) return reject(REJECT_REASON.VERSION);
    // back from a drop inside the grace minute, or from a deploy: their own body (onClose / hold). (A guest by the
    // hash of their browser id, never the id: it is the key to their leaderboard record, and a deploy saves this.)
    const key = account ? `a:${account.id}` : UUID_RE.test(pid) ? `g:${idKey(pid)}` : '';
    if (key) {
      for (const q of this.players.values()) {
        if (!q.away || q.rejoinKey !== key) continue;
        q.rec ||= this.records.enter(pid, q.name, account); // (one brought over from the last server has none here yet)
        return this.resume(session, q);
      }
    }
    if (this.players.size >= this.maxPlayers) return reject(REJECT_REASON.FULL);
    if (!this.admitJoin(session)) return reject(REJECT_REASON.FULL); // (the one "try again later" the client knows)
    // unique names
    const names = new Set([...this.players.values()].map((p) => p.name));
    let base = name;
    let k = 2;
    while (names.has(name)) name = `${base.slice(0, 13)}#${k++}`;
    // an emptied server rolls its next valley on the tick after (resetToWaiting): a join that beats that tick
    // rolls it here, so the seed in WELCOME is the one this run is played on
    if (this.phase === PHASE.WAITING) this.rollWorld();
    this.buildMainland(true); // (a join during the crossing: the mainland it is put down on has to stand)

    const p = this.createPlayer(session, name);
    // no entity id left for them: turned away like from a full server, to try again once ids have come back
    if (!p) return reject(REJECT_REASON.FULL);
    session.player = p;
    p.admin = !!account?.isAdmin || this.devAdmin;
    p.character = characterFor(choice, p.id);
    p.rejoinKey = key; // who can take this body back after a drop ('' : nobody - no account and no browser id)
    p.rec = this.records.enter(pid, base, account);
    p.account = account ? account.id : ''; // their account's id, '' for a guest
    p.guestKey = account ? '' : idKey(pid); // a guest's browser id as stats.js files it ('' without one): never the id itself
    p.friend = account ? account.name : ''; // the account a friend request goes to (S2C.FRIENDS); '' for a guest
    this.loadProgress(p);
    const w = new Writer(64);
    w.u8(S2C.WELCOME);
    w.u16(p.id);
    w.u32(this.seed >>> 0);
    w.u32(this.tick);
    w.u8(SERVER_TICK_RATE);
    w.u8(this.maxPlayers);
    w.u8(p.admin ? WELCOMEF.ADMIN : 0);
    w.u8(this.act); // which of the run's two maps that seed is to be built as (shared/acts.js)
    session.conn.send(w.bytes());
    if (this.phase === PHASE.WAITING) this.startGame();
    else if (this.fallen.delete(this.leaverKey(p)) && (this.phase === PHASE.DAY || this.phase === PHASE.NIGHT)) {
      // died in this run and came back in before sunrise: they are what they were, and wait for dawn with the rest
      // of the dead - a reload is no way round a death, and nor is another name (leaverKey). The kit parked for them
      // stays where it is: the dead carry nothing, and returnFallen replaces it at sunrise.
      this.spawnPlayerZombie(p);
      this.sendChat(p, 0, CHATF.SYSTEM, `You died in this run: you are one of them ${this.escape.active ? 'to the end of it' : 'until dawn'}.`);
    } else {
      // a run in progress: beside the team, with a kit for the day - or, back in the run they left, with what they
      // left with (parkKit)
      const left = this.leftKits.get(this.leaverKey(p));
      this.leftKits.delete(this.leaverKey(p));
      this.spawnHuman(p, left || starterKit(this.day, this.diff), true);
      if (left) this.sendChat(p, 0, CHATF.SYSTEM, 'Back in the same run: you have what you left with.');
    }
    this.track.join(p);
    this.ach.join(p);
    this.bestiary.join(p);
    // what the team has used up before they came (a run this join started has cleared it: NEW_GAME says so)
    const spent = [];
    for (const [col, g] of this.gather) if (g.left <= 0) spent.push(col);
    this.tellStripped(spent, p.id);
    this.tellWrecks(p.id);
    this.notify(NOTIFY.PLAYER_JOINED, p.id);
    this.tellFriendCodes(p);
    p.greeted =this.allow(this.greets, 2 * this.maxPlayers, GREET_EVERY);
    if (p.greeted) this.systemChat(p.zombie ? `${p.name} is back among the dead.` : `${p.name} joined the survivors.`);
    this.playersDirty = true;
    this.globalDirty = true;
    this.log(`join ${p.name} (${this.players.size}/${this.maxPlayers})`);
  }

  // id: the one they had on the last server (gamestate.js), else the next free one
  createPlayer(session, name, id = 0) {
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
      backpackItem: 0, // the backpack worn (ITEM.BACKPACK), 0: none. Worn, it opens BACKPACK_SLOTS more slots (invCap)
      alive: true,
      zombie: false,
      downed: false,
      bleed: 0,
      lastSrc: null,
      revivedBy: 0,
      respawnT: 0,
      inv: createInventory(),
      invDirty: true,
      invSort: false, // something picked up or dropped: the grid is sorted before it goes out (sendTick)
      splitKeep: new Map(), // item -> its count when last split (ACT.SPLIT_INV): kept apart while it stays that (tidyStacks)
      lastDrop: null, // { e, t }: the item entity they last put down from the inventory, and when (ACT.UNDO_DROP)
      kit: null, // the starting kit they were issued (spawnHuman)
      flashlight: false,
      battery: FLASHLIGHT_MAX,
      lastDamageT: -99,
      useItem: null,
      hold: null,
      kills: 0,
      zkills: 0,
      deaths: 0,
      rec: null, // their record on the leaderboard (stats.js); null for a player who joined without an id
      // experience and perks (shared/progress.js, setProgress). Their XP is xpBase + this run's, by source
      xpBase: 0, // on their record before this run, once the stats have said (xpLoaded)
      xpRun: new Array(XP_SRC.length).fill(0),
      xpLoaded: false,
      best: 0, // the furthest day they have ever seen dawn on (from the record)
      perks: 0, // the perks in force (a bitmask of ids; s.perks carries it into the simulation)
      perksNext: -1, // picked during a night: in force from dawn (-1: nothing waiting)
      nightKills: 0, // kills this night (or day): past XP.killsFull they earn half
      nightRevives: 0,
      lastChance: false, // Second Chance spent this night
      progDirty: true, // S2C.PROGRESS is out of date (sendProgress)
      progT: -99,
      admin: false, // may run admin chat commands: set from the signed-in account in handleJoin/resume
      boardT: -99, // when they were last sent the leaderboard
      cmdQueue: [],
      cmdBudget: 6,
      lastSeq: 0,
      hasSeq: false,
      recvSeq: 0, // the newest command that has come in, run or not (useItem)
      renderTick: 0,
      renderFrac: 0,
      view: new ClientView(),
      shadow: createPlayerState(), // the state right after the last command: what the client's prediction holds
      selfSync: true, // the client has to rebase its prediction on our state (see writeSelf)
      snapTick: -2, // tick and acked command of the last snapshot it was sent
      ackSent: 0,
      pingAt: 0, // when its latest IN_PING arrived (0 = none waiting)
      hx: new Float32Array(HISTORY_TICKS),
      hy: new Float32Array(HISTORY_TICKS),
      hz: new Float32Array(HISTORY_TICKS),
      chatT: 0,
      chatCount: 0,
      onAir: false, // keying the walkie-talkie, as last sent in the player list
      interactT: 0,
      actionT: 0,
      pingT: 0,
      waypoint: null, // their field-map waypoint { x, z, zone } (zone 255: none), shown to the team in the player list
      fullT: -99, // when they were last told their backpack had no room for something lying there (updateItems)...
      partFullT: -99, // ...and when that something was a car supply
      pinnedBy: 0,
      ropedBy: 0,
      ping: 0,
      ts: null, // the stint analytics.js is counting for them (null: none)
      rejoinKey: '', // 'a:<account id>' or 'g:<sha-256 of the browser id>': whose JOIN may take this player back after a drop (resume)
      away: null, // dropped and held: { since, grace, handoff } (hold), until they come back or their grace runs out
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
    // (a player without an id must never get into `players`: it would sit there under the key `undefined`)
    if (!(id ? this.spawnEntityAt(p, id) : this.spawnEntity(p))) return null;
    this.players.set(p.id, p);
    return p;
  }

  // ---------------------------------------------------------------- experience and perks (shared/progress.js)
  // What a joining player has earned before: their XP, the furthest day they have seen and the perks they picked.
  // The file-kept records answer at once; a game in a room's worker hears from the network thread (onProgress).
  loadProgress(p) {
    if (!p.rec) return this.setProgress(p, { first: true, xp: 0, perks: [], best: 0 }); // (nothing kept: nothing to load)
    if (this.records.remote) return;
    const got = this.records.progress?.(p.rec);
    if (got && typeof got.then === 'function') got.then((v) => v && this.players.get(p.id) === p && this.setProgress(p, { first: true, ...v }));
    else if (got) this.setProgress(p, { first: true, ...got });
  }
  // the network thread's answer for the record with this token (room-worker.js)
  onProgress(tok, m) {
    for (const p of this.players.values()) if (p.rec && p.rec.tok === tok) this.setProgress(p, m);
  }
  // ...and its bestiary (an account's: userbestiary.js)
  onBestiary(tok, mask) {
    this.bestiary.loaded(tok, mask);
  }
  // m: { first, xp, perks, best } as they join, { perks } when they pick again (validated by whoever sent it:
  // stats.js cleanPerks, server/progress.js)
  setProgress(p, m) {
    // (one brought over from the last server has theirs: the record already holds this run's XP, xpRun has it too)
    if (m.first && p.xpLoaded) return;
    if (m.first) {
      p.xpBase = Math.max(0, m.xp | 0);
      p.best = Math.max(0, m.best | 0);
      p.xpLoaded = true;
      this.playersDirty = true;
    }
    if (Array.isArray(m.perks)) {
      const mask = perkMask(m.perks);
      // a pick made while the night is on waits for dawn: nobody changes their kit mid-fight
      if (m.first || !this.fighting()) {
        if (!m.first && mask !== p.perks) this.sendChat(p, 0, CHATF.SYSTEM, 'Your perks are in force.');
        this.applyPerks(p, mask);
        p.perksNext = -1;
      } else if (mask !== p.perks) {
        p.perksNext = mask;
        this.sendChat(p, 0, CHATF.SYSTEM, 'Your new perks come into force at dawn.');
      }
    }
    p.progDirty = true;
  }
  fighting() {
    return this.phase === PHASE.NIGHT || this.escape.active;
  }
  // The perks in force for a player are these now: into the simulation (s.perks: the client hears of it as of any
  // change to the state) and onto their health
  applyPerks(p, mask) {
    p.perks = mask >>> 0;
    p.state.perks = p.perks;
    this.playersDirty = true; // (the player list carries everyone's perks, for their profile)
    if (!p.alive || p.zombie) return;
    const max = PLAYER_MAX_HP + perkMods(p.perks).hp;
    if (!p.downed) p.hp = Math.max(1, Math.min(max, p.hp + Math.max(0, max - p.maxHp)));
    p.maxHp = max;
  }
  xpOf(p) {
    let n = p.xpBase;
    for (const v of p.xpRun) n += v;
    return n;
  }
  levelOf(p) {
    return levelOf(this.xpOf(p));
  }
  // n XP for `src` (XPS), scaled by their perks and the difficulty: on this run's tally, and on their record with the
  // leaderboard's stats
  award(p, src, n) {
    if (!p) return;
    n = Math.round(n * perkMods(p.perks).xp * this.diff.xp);
    if (n <= 0) return;
    const was = this.levelOf(p);
    p.xpRun[src] += n;
    this.records.bump(p.rec, 'xp', n);
    p.progDirty = true;
    if (this.levelOf(p) !== was) this.playersDirty = true;
  }
  // one of the dead put down by a survivor: what it was worth, less past the night's first XP.killsFull, and nothing
  // for one that had been stuck for a while (z.wedgeT) - the dead piled up at a wall they will never get round
  killXp(p, z, headshot) {
    if (p.zombie) return;
    const pm = perkMods(p.perks);
    if (pm.killStamina && p.alive && !p.downed) p.state.stamina = Math.min(STAMINA_MAX, p.state.stamina + pm.killStamina);
    if (pm.killHeal && p.alive && !p.downed) p.hp = Math.min(p.maxHp, p.hp + pm.killHeal);
    if (z.wedgeT > WEDGED_FOR) return;
    if (z.boss) return this.award(p, XPS.bosses, XP.boss);
    const half = ++p.nightKills > XP.killsFull;
    const base = XP.kinds[z.ztype] ?? XP.kill;
    this.award(p, XPS.kills, half ? Math.ceil(base / 2) : base);
    if (headshot) this.award(p, XPS.headshots, half ? Math.ceil(XP.headshot / 2) : XP.headshot);
  }
  // A new night or a new day: the diminishing returns start over. dawn: also what is earned for seeing it, and the
  // perks picked during the night come into force
  phaseXp(dawn, night = 0) {
    for (const p of this.players.values()) {
      p.nightKills = p.nightRevives = 0;
      p.lastChance = false;
      if (!dawn) continue;
      if (p.alive && !p.zombie) {
        this.award(p, XPS.nights, Math.min(XP.nightCap, XP.night * night));
        if (p.xpLoaded && this.day > p.best) {
          if (p.best > 0 || this.day > 2) this.award(p, XPS.best, XP.best); // (day 2 is everyone's first dawn: no record broken)
          p.best = this.day;
          this.records.best?.(p.rec, this.day);
        }
      }
      if (p.perksNext >= 0) {
        this.applyPerks(p, p.perksNext);
        p.perksNext = -1;
        this.sendChat(p, 0, CHATF.SYSTEM, 'Your new perks are in force.');
      }
    }
  }

  // S2C.PROGRESS: varu XP (on record, this run's in it), u8 PROGF, this run's XP by source. Sent when it changed,
  // once a second at most - at once when the run has just ended, for the end screen
  sendProgress(p) {
    if (!p.progDirty || (this.time - p.progT < 1 && this.phase !== PHASE.GAMEOVER && this.phase !== PHASE.VICTORY)) return;
    p.progDirty = false;
    p.progT = this.time;
    const w = new Writer(8 + 4 * XP_SRC.length);
    w.u8(S2C.PROGRESS);
    w.varu(this.xpOf(p));
    w.u8((p.xpLoaded ? PROGF.LOADED : 0) | (p.rec ? PROGF.KEPT : 0));
    for (const v of p.xpRun) w.varu(v);
    p.session.conn.send(w.bytes());
    this.stats.bytesOut += w.o;
    this.stats.msgsOut++;
  }

  // Who a leaver is to this run if they come back (fallen, leftKits): their account or browser (rejoinKey), so coming
  // back under another name gets round neither a death nor a used-up kit. Only a player with neither - the test bots -
  // is known by their name. (A key has a ':' in it and a name never does: the two cannot collide.)
  leaverKey(p) {
    return p.rejoinKey || p.name;
  }

  // A leaver takes what is left of their starting kit with them - never more of anything than they were issued - and
  // gets exactly that back if they rejoin this run (leaverKey). Only what they found on top of it is dropped for the
  // team. Dropping the kit and issuing a fresh one on the way back in would let a reconnect loop pile rounds and
  // bandages up at the team's feet, and refill anyone who had used theirs up (or lost them by dying).
  parkKit(p) {
    const kit = p.kit;
    if (!kit) return;
    const s = p.state;
    const left = { mag: 0, ammo: 0, items: [] };
    const gone = p.zombie || !p.alive; // the dead dropped theirs where they fell
    if (!gone) {
      left.ammo = Math.min(s.ammo[AMMO.P9], kit.ammo);
      s.ammo[AMMO.P9] -= left.ammo;
      if (s.weapons[SLOT_PISTOL] === ITEM.PISTOL) left.mag = Math.min(s.mags[1], kit.mag);
      // The pistol, knife and hammer everyone starts with go along from the slots they are in, and a rejoin brings
      // back those and no others: one dropped for the team or torn down for parts (salvage) stays gone, or a
      // reconnect loop would pile pistols - or the gun parts in them - up at the team's feet
      left.tools = [];
      for (const slot of [SLOT_PISTOL, SLOT_MELEE, SLOT_BUILD]) {
        if (s.weapons[slot] !== STARTER_TOOLS[slot]) continue;
        s.weapons[slot] = 0;
        left.tools.push(slot);
      }
    }
    for (const [item, n] of kit.items) left.items.push([item, gone ? 0 : removeItem(p.inv, item, n)]);
    this.leftKits.delete(this.leaverKey(p));
    this.leftKits.set(this.leaverKey(p), left);
    if (this.leftKits.size > LEFT_KITS_MAX) this.leftKits.delete(this.leftKits.keys().next().value); // (the oldest)
  }

  removePlayer(p) {
    this.track.leave(p); // (before anything of theirs is touched)
    this.ach.leave(p);
    this.releaseHolds(p);
    this.parkKit(p); // (they take their starting kit along: only what they found beyond it is dropped)
    this.dropAll(p);
    this.players.delete(p.id);
    this.records.leave(p.rec);
    this.nav.removeField(p.id);
    if (this.dawnReturn && (p.zombie || !p.alive)) this.fallen.add(this.leaverKey(p)); // left dead: dead if they rejoin before sunrise (handleJoin)
    this.removeEntity(p);
    this.notify(NOTIFY.PLAYER_LEFT, 0);
    // (whoever arrived unannounced leaves unannounced; an announced one always gets their line, and it counts)
    if (p.greeted && this.allow(this.greets, Infinity, GREET_EVERY)) this.systemChat(`${p.name} left.`);
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

  // ---------------------------------------------------------------- world
  // act: which of the run's two maps to make of the seed (shared/acts.js): the island, or the mainland
  setWorld(seed, act = WORLD.ISLAND) {
    const t0 = Date.now();
    this.seed = seed;
    this.act = act;
    this.world = worldFor(seed, act);
    usePos(this.world);
    this.worldHash = worldHash(this.world); // (what a save made on this valley is checked against: handoff.js)
    this.nav = new Nav(this.world);
    this.mineNav = this.world.mine ? new MineNav(this.world, this.nav) : null; // (a valley without the workings has none)
    this.worldPlayed = false;
    this.gather?.clear(); // (what was used up was of the world before this one)
    this.ringing?.clear();
    this.zm?.setWorld(); // (its grids and per-world caches)
    this.log(`world seed ${seed}${act === WORLD.MAINLAND ? ' (the mainland)' : ''} generated in ${Date.now() - t0}ms`);
  }

  // Every playthrough gets a valley of its own: once a game has been played on this one, generate the next
  // and tell the clients its seed. Call with the world cleared (structures live in the old world's grids).
  // A run always begins on the island: after one that ended on the mainland that is built again even where the seed
  // is pinned.
  rollWorld() {
    if (!this.worldPlayed || (this.fixedSeed && this.act === WORLD.ISLAND)) return;
    this.setWorld(this.fixedSeed ? this.seed : randomSeed(), WORLD.ISLAND);
    this.tellWorld();
  }
  // every client builds the world this game is now on (S2C.WORLD_RESET: its seed and its act)
  tellWorld() {
    const w = new Writer(8);
    w.u8(S2C.WORLD_RESET);
    w.u32(this.seed >>> 0);
    w.u8(this.act);
    this.broadcast(w.bytes());
  }

  // ---------------------------------------------------------------- game flow
  // The last player has left. This runs inside their socket's close callback, so the next valley is not rolled
  // here: generating one blocks the thread for a few hundred ms (seconds on a loaded machine), and the socket
  // would stay open that long. The played world stays, cleared, until the next tick rolls its successor (update),
  // or the next join if that comes first (handleJoin).
  resetToWaiting() {
    this.track.finish('abandoned'); // (a run still on: everybody left it)
    this.clearWorld();
    this.checkpoint = null;
    this.crossing = null;
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
    this.drops = 0;
    this.structures.length = 0;
    this.projectiles.length = 0;
    this.areas.length = 0;
    this.crates.length = 0;
    this.flyovers.length = 0;
    this.caches.length = 0;
    this.cats.length = 0;
    this.deer.length = 0;
    this.waves = [];
    this.wave = 0;
    this.fallen.clear();
    this.bossPending = null;
    this.bossId = 0;
    this.gather.clear();
    this.ringing.clear();
    regrowTrees(this.world); // (a new game on the same valley: the trees the last one cut stand again)
    this.leftKits.clear();
    this.escape = this.noEscape();
    this.fixtures.reset();
  }
  // the final stand, not begun. stage: of the plane's stand, 0 fuelling, 1 warming up (acts.js RUNWAY); blocked: the
  // dead stand on the runway ahead of the plane
  noEscape() {
    return { active: false, t: 0, ready: false, stalled: false, leaving: false, spawnT: 0, boss: false, sent: 0, tanks: 0, stage: 0, blocked: false };
  }

  startGame() {
    // a wipe on the mainland costs the mainland, not the hour before it: the run starts again where the team came
    // off the bridge, with what each of them crossed with (the checkpoint, arrive)
    if (this.phase === PHASE.GAMEOVER && this.act === WORLD.MAINLAND && this.checkpoint) return this.restartFromBridge();
    this.track.finish('abandoned'); // (a run still being played as a new one begins: debug, tests)
    this.clearWorld();
    this.checkpoint = null;
    this.crossing = null;
    this.rollWorld();
    this.worldPlayed = true;
    this.phase = PHASE.DAY;
    this.day = this.startDayNum;
    this.timeLeft = this.dayLen;
    this.unlocked = 0;
    this.populate();
    for (const p of this.players.values()) {
      p.kills = p.zkills = p.deaths = 0; // the scoreboard counts this run only: whoever stayed on from the last one starts level
      p.xpBase = this.xpOf(p); // ...and so does the end screen's XP: the last run's is on their record now
      p.xpRun.fill(0);
      p.nightKills = p.nightRevives = 0;
      p.lastChance = false;
      if (p.perksNext >= 0) p.perks = p.perksNext; // (spawnHuman puts them in force)
      p.perksNext = -1;
      p.progDirty = true;
      p.waypoint = null; // (it pointed into the old valley; the client drops its own on NEW_GAME)
      this.spawnHuman(p);
    }
    this.notify(NOTIFY.NEW_GAME, this.day);
    this.globalDirty = true;
    this.playersDirty = true;
    this.track.start();
    this.ach.start();
    this.log('new game started');
  }

  // What a map holds as an act begins on it: its loot, its containers and the schematics hidden in them, the act's
  // supplies, and the dead that stand about by day. The world is cleared (clearWorld) and the day set before it.
  populate() {
    this.supplies = [0, 0, 0, 0, 0];
    this.warned = false;
    this.nightStats = { kills: 0, structLost: 0, downs: 0, deaths: 0, revives: 0 };
    this.scheduleSupplyDrops();
    const w = this.world;
    // floor loot
    this.lootPoints = [];
    for (const sp of w.lootSpawns) this.lootPoints.push({ ...sp, ent: null, respawnAt: 0, table: LOOT_TABLES[sp.zone] || LOOT_TABLES[ZONE.FOREST] });
    for (const sp of w.resourceSpawns) this.lootPoints.push({ ...sp, ent: null, respawnAt: 0, table: LOOT_TABLES[ZONE.FOREST] });
    for (const lp of this.lootPoints) if (this.rng() < Math.min(0.98, 0.8 * this.diff.loot)) this.spawnLoot(lp);
    // searchable containers
    for (const c of w.containers) {
      const e = { kind: ENT.CACHE, ctype: c.ctype, x: c.x, y: c.y, z: c.z, zone: c.zone, state: 0, schem: 0 };
      if (this.spawnEntity(e)) this.caches.push(e);
    }
    this.placeSchematics();
    this.placeSupplies();
    this.cemetery.reset();
    this.gun.spawn();
    this.fair.reset();
    this.handcars.spawn();
    // zone guards + roaming dead
    this.zm.spawnInitial();
    this.cm.spawnInitial();
    this.dm.spawnInitial();
  }

  // ---------------------------------------------------------------- the two acts (shared/acts.js)
  // What this act's escape takes: the car's supplies on the island, the plane's parts on the mainland.
  get sup() {
    return suppliesOf(this.act);
  }

  // The car is away with the team in it: the island is done. The crossing begins - every client plays the cutscene
  // off this phase's clock - and the mainland is built in the next tick (buildMainland), so that what tells the
  // clients has left this thread before a world is generated on it. by: who drove.
  // night: it left in the night. paid: the escape's XP is given (not for an admin's /map2: nobody escaped)
  cross(by, night = false, paid = true) {
    if (this.act !== WORLD.ISLAND || this.phase === PHASE.CROSSING) return;
    this.log('crossing to the mainland');
    this.track.crossed(by, night); // (before the world is cleared: it reads who is alive, and at the car)
    // the escape from the island is paid as it always was: more to whoever was in the car than to those it left
    const car = this.world.car;
    for (const p of paid ? this.players.values() : []) {
      const aboard = p.alive && !p.zombie && Math.hypot(p.state.x - car.x, p.state.z - car.z) <= ESCAPE_RADIUS;
      this.award(p, XPS.escape, aboard ? XP.escape : XP.team);
    }
    this.clearWorld();
    this.phase = PHASE.CROSSING;
    this.timeLeft = CROSSING.TIME;
    this.crossing = { pending: 2, skip: [], night, back: 0 };
    this.waves = [];
    this.wave = 0;
    for (const p of this.players.values()) {
      p.hold = null;
      this.endUse(p);
      this.releaseHolds(p);
      p.cmdQueue.length = 0;
      p.waypoint = null; // (it pointed into the island)
    }
    this.notify(NOTIFY.CROSSING, by ? by.id : 0);
    this.sound(SOUND.CAR_START, car.x, car.y + 0.8, car.z, 0);
    this.globalDirty = true;
    this.playersDirty = true;
  }

  // The mainland, CROSSING.SWAP seconds into the crossing - the moment the cutscene cuts to black, which is when the
  // clients take the island down. In two ticks: the first tells the clients which world to build (and everything a
  // tick sends leaves the thread when the tick is done), the second builds ours, which holds this thread for a
  // moment: nobody is acting. Then it is populated and the team is put down on it; they stand at the bridgehead
  // from then on, behind the cutscene. now: both steps at once (a join that cannot wait, a skip, a save).
  buildMainland(now = false) {
    const c = this.crossing;
    if (!c?.pending || (!now && CROSSING.TIME - this.timeLeft < CROSSING.SWAP)) return;
    if (c.pending === 2) {
      c.pending = 1;
      this.act = WORLD.MAINLAND;
      this.tellWorld();
      if (!now) return;
    }
    c.pending = 0;
    this.setWorld(this.seed, WORLD.MAINLAND);
    this.worldPlayed = true; // (the run is on it: the next one gets an island of its own)
    // the morning after: whatever the hour was when the car left, the team comes off the bridge at the start of a
    // day - the next one, if it left in the night
    if (c.night) this.day++;
    this.populate();
    c.back = this.checkpointAt();
    this.globalDirty = true;
    this.playersDirty = true;
  }

  // The checkpoint at the bridge. Everybody is alive on the mainland - whoever was dead or turned at the end of the
  // island comes back - with what they carried over and, at the least, the bridgehead cache's floor (bridgehead).
  // What each of them has now is kept: a wipe on the mainland starts again from it (restartFromBridge). Returns how
  // many it brought back from the dead.
  checkpointAt() {
    let back = 0;
    for (const p of this.players.values()) {
      if (!p.alive || p.zombie) {
        // they dropped what they had where they fell, on the island: they cross with nothing but the floor
        this.spawnHuman(p, { mag: 0, ammo: 0, items: [], tools: [] });
        this.track.returned(p);
        back++;
      } else this.landOn(p);
      this.bridgehead(p);
    }
    const kits = [];
    for (const p of this.players.values()) kits.push([this.leaverKey(p), this.kitOf(p)]);
    this.checkpoint = { day: this.day, unlocked: this.unlocked, kits };
    return back;
  }

  // a survivor who crossed in the car, put down at the bridgehead as they are: on their feet, off whatever the
  // island had them on, with everything they carried
  landOn(p) {
    const s = p.state;
    if (p.downed) {
      p.downed = false;
      s.downed = 0;
      p.bleed = 0;
      p.revivedBy = 0;
      p.hp = Math.max(p.hp, REVIVE_HP);
    }
    s.ride = s.cart = s.hmg = 0;
    s.pinned = s.pulled = 0;
    s.vx = s.vy = s.vz = 0;
    this.putAtStart(s);
    p.selfSync = true;
    this.fillHistory(p);
  }

  // where a run on this map begins: one of its spawn points, facing away from what was left behind
  putAtStart(s) {
    const w = this.world;
    const sp = w.spawnPoints[Math.floor(this.rng() * w.spawnPoints.length)];
    s.x = sp.x + (this.rng() - 0.5) * 1.5;
    s.z = sp.z + (this.rng() - 0.5) * 1.5;
    s.y = groundAt(w, s.x, s.z, 50, 0.3);
    const car = w.kind === WORLD.MAINLAND ? { x: w.bridge.x1 - 40, z: w.bridge.z } : w.car;
    s.yaw = Math.atan2(-(car.x - s.x), -(car.z - s.z)) + Math.PI; // back to the car (or the bridge), facing the road
  }

  // The bridgehead cache (acts.js BRIDGEHEAD): what a survivor is short of the floor is made up, and nothing else. A
  // team that crossed with empty guns can fight its way to the first building; one that crossed well stocked gets
  // nothing. The difficulty moves the floor's rounds and bandages as it does the starting kit's (starterKit):
  // Nightfall's are the numbers in acts.js. Returns what it gave (CACHE_GAVE), which the survivor is told.
  bridgehead(p) {
    const s = p.state;
    let gave = 0;
    const gun = (it) => isFirearm(it) && it !== ITEM.FLARE_GUN;
    const guns = [s.weapons[SLOT_PRIMARY], s.weapons[SLOT_PISTOL]];
    if (!guns.some(gun) && this.giveItem(p, BRIDGEHEAD.PISTOL, 1, WEAPONS[BRIDGEHEAD.PISTOL].mag)) {
      gave |= CACHE_GAVE.PISTOL;
      guns.push(BRIDGEHEAD.PISTOL); // (in the pistol's slot, or in the backpack if a flare gun has that)
    }
    for (const it of guns) {
      if (!gun(it)) continue;
      const def = WEAPONS[it];
      const want = Math.min(Math.round(BRIDGEHEAD.ROUNDS * this.diff.ammo), Math.round(def.mag * BRIDGEHEAD.MAGS * this.diff.ammo), AMMO_MAX[def.ammo]);
      if (s.ammo[def.ammo] >= want) continue;
      s.ammo[def.ammo] = want;
      gave |= CACHE_GAVE.AMMO;
    }
    const heals = countItem(p.inv, ITEM.BANDAGE) + countItem(p.inv, ITEM.MEDKIT);
    const bandages = Math.max(1, Math.round(BRIDGEHEAD.BANDAGES * this.diff.bandages));
    if (heals < bandages && this.giveItem(p, ITEM.BANDAGE, bandages - heals)) gave |= CACHE_GAVE.BANDAGE;
    if (!s.weapons[SLOT_MELEE]) {
      s.weapons[SLOT_MELEE] = BRIDGEHEAD.MELEE;
      gave |= CACHE_GAVE.MELEE;
    }
    if (!s.weapons[SLOT_BUILD]) {
      s.weapons[SLOT_BUILD] = BRIDGEHEAD.BUILD;
      gave |= CACHE_GAVE.BUILD;
    }
    if (gave) {
      p.invDirty = true;
      p.selfSync = true;
      this.notify(NOTIFY.CACHE, gave, p.id);
    }
    return gave;
  }

  // what a survivor carries, as plain data (the checkpoint), and back
  kitOf(p) {
    const s = p.state;
    return { weapons: s.weapons.slice(), mags: s.mags.slice(), ammo: s.ammo.slice(), inv: p.inv.map((it) => (it ? { ...it } : null)), armor: p.armor, armorMax: p.armorMax, armorItem: p.armorItem, backpackItem: p.backpackItem, kit: p.kit };
  }
  wear(p, k) {
    const s = p.state;
    s.weapons = k.weapons.slice();
    s.mags = k.mags.slice();
    s.ammo = k.ammo.slice();
    p.inv = k.inv.map((it) => (it ? { ...it } : null));
    p.armor = k.armor;
    p.armorMax = k.armorMax;
    p.armorItem = k.armorItem;
    p.backpackItem = k.backpackItem;
    p.kit = k.kit;
    p.invDirty = true;
    this.syncThrow(p);
  }

  // The crossing is over (its clock ran out, or everybody asked to skip it): the first day on the mainland begins.
  arrive() {
    this.buildMainland(true); // (a crossing cut short before its mainland was up)
    const back = this.crossing?.back || 0;
    this.crossing = null;
    this.phase = PHASE.DAY;
    this.track.arrived(back);
    this.timeLeft = this.dayLen;
    this.notify(NOTIFY.ARRIVED, back);
    this.sound(SOUND.DAWN, 0, 0, 0, 0);
    this.globalDirty = true;
    this.playersDirty = true;
    this.log(`arrived on the mainland: day ${this.day}, ${back} back from the dead`);
  }

  // A player asks for the crossing to be skipped (ACT.SKIP). It is, once everybody who is connected has asked, and
  // not before the clients have their mainland up (CROSSING.SKIP_AFTER).
  skipCrossing(p) {
    const c = this.crossing;
    if (this.phase !== PHASE.CROSSING || !c || c.skip.includes(p.id)) return;
    c.skip.push(p.id);
    this.globalDirty = true;
  }
  skipVotes() {
    const c = this.crossing;
    let need = 0;
    let got = 0;
    for (const p of this.players.values()) {
      if (p.away) continue;
      need++;
      if (c && c.skip.includes(p.id)) got++;
    }
    return [got, need];
  }

  // A wipe on the mainland: the same mainland again, as the team found it coming off the bridge, on the day they
  // did, each with what they crossed with. Whoever joined since has a late joiner's kit for that day.
  restartFromBridge() {
    const cp = this.checkpoint;
    this.track.finish('abandoned');
    this.clearWorld();
    this.phase = PHASE.DAY;
    this.day = cp.day;
    this.unlocked = cp.unlocked;
    this.timeLeft = this.dayLen;
    this.populate();
    const kits = new Map(cp.kits);
    for (const p of this.players.values()) {
      p.nightKills = p.nightRevives = 0;
      p.lastChance = false;
      if (p.perksNext >= 0) p.perks = p.perksNext;
      p.perksNext = -1;
      p.waypoint = null;
      const k = kits.get(this.leaverKey(p));
      this.spawnHuman(p, k ? k.kit || { mag: 0, ammo: 0, items: [], tools: [] } : starterKit(this.day, this.diff));
      if (k) this.wear(p, k);
    }
    this.notify(NOTIFY.CHECKPOINT, this.day);
    this.globalDirty = true;
    this.playersDirty = true;
    this.track.start();
    this.log(`wiped on the mainland: back at the bridgehead, day ${this.day}`);
  }

  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Hide the schematics around the map: each in a locker, ammo crate or toolbox (CONT_DEFS[t].schem) of a random
  // place far from the start, never two in the same place while there is a place left without one. The survivors
  // are told which place each is rumoured to be in, not which container: they have to search that place's.
  placeSchematics() {
    const w = this.world;
    const byPlace = new Map();
    for (const c of this.caches) {
      // (far from where a run on this map begins: the car on the island, the bridgehead on the mainland)
      if (!CONT_DEFS[c.ctype].schem || !w.zoneById[c.zone] || Math.hypot(c.x - w.start.x, c.z - w.start.z) <= 90) continue;
      byPlace.set(c.zone, [...(byPlace.get(c.zone) || []), c]);
    }
    const places = this.shuffle([...byPlace.values()]);
    let turn = 0;
    this.schemHints = SCHEMATICS.map((item) => {
      // (one the team has is hidden nowhere: the mainland hides what the island kept)
      if (this.unlocked & (1 << SCHEM_BIT[item])) return 255;
      for (let tries = 0; tries < places.length; tries++) {
        const free = places[turn++ % places.length].filter((c) => !c.schem);
        if (!free.length) continue;
        const c = free[Math.floor(this.rng() * free.length)];
        c.schem = item;
        return c.zone;
      }
      return 255;
    });
  }

  // Hide the car supplies around the valley: each at a random hiding spot of a random place on this map, and
  // never two in the same place while there is a place left without one. The survivors are told which place
  // each is rumoured to be in.
  placeSupplies() {
    const shuffle = (a) => this.shuffle(a);
    const byPlace = new Map();
    for (const sp of this.world.partSpots) byPlace.set(sp.zone, [...(byPlace.get(sp.zone) || []), sp]);
    const places = this.act === WORLD.MAINLAND ? [] : shuffle([...byPlace.values()].map(shuffle));
    this.supplySpots = [];
    this.supplyFound = 0;
    const { items, need } = this.sup;
    // on the mainland a part is at one of its own set places (world.partSpots[k].supply: shared/mainland.js)
    const own = (i) => shuffle(this.world.partSpots.filter((sp) => sp.supply === i));
    const set = items.map((_, i) => own(i));
    // deal them out round the places: a place only gets a second one once every place has had one
    let turn = 0;
    this.supplyHints = items.flatMap((item, i) => new Array(need[i]).fill(i)).map((i, hint) => {
      const item = items[i];
      const at = set[i].pop();
      if (at) {
        this.spawnItem(item, 1, at.x, at.y, at.z, { permanent: true, hint });
        this.supplySpots.push(at);
        return at.zone;
      }
      for (let tries = 0; tries < places.length; tries++) {
        const sp = places[turn++ % places.length].pop();
        if (!sp) continue;
        this.spawnItem(item, 1, sp.x, sp.y, sp.z, { permanent: true, hint });
        this.supplySpots.push(sp);
        return sp.zone;
      }
      return 255;
    });
  }

  // Where someone who joins a run in progress is put down: beside the team instead of alone at the car, which by
  // then can be 250 m and a horde away from anyone. null = the car will do: nobody alive to join, or the team is
  // within clear earshot of it anyway (day 1 before anyone has set off).
  pickJoinSpawn(p) {
    // the team: the survivor with the most others within earshot (one on their feet before one who is down)
    let a = null;
    let most = -1;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.zombie) continue;
      let n = q.downed ? 0 : 0.5;
      for (const o of this.players.values()) if (o !== q && o !== p && o.alive && !o.zombie && Math.hypot(o.state.x - q.state.x, o.state.z - q.state.z) < TALK_RANGE) n++;
      if (n > most) {
        most = n;
        a = q.state;
      }
    }
    const w = this.world;
    if (!a || Math.hypot(a.x - w.start.x, a.z - w.start.z) < TALK_CLEAR) return null;
    const ay = groundAt(w, a.x, a.z, a.y, PLAYER_RADIUS * 0.7);
    const dead = []; // zombies and player-zombies that could be near a spot
    for (const z of this.zombies) if (!z.dead && Math.hypot(z.x - a.x, z.z - a.z) < JOIN_FAR_MAX + JOIN_CLEAR) dead.push(z);
    for (const q of this.players.values()) if (q.zombie && q.alive) dead.push(q.state);
    const lim = this.world.half - 3;
    const body = { x: 0, y: 0, z: 0 };
    const a0 = this.rng() * Math.PI * 2;
    let spot = null;
    let far = -1;
    // right beside them; only if the dead are all over that ground, a little further out
    for (const [r0, r1] of [[JOIN_NEAR_MIN, JOIN_NEAR_MAX], [JOIN_NEAR_MAX, JOIN_FAR_MAX]]) {
      for (let k = 0; k < JOIN_TRIES; k++) {
        const ang = a0 + ((k + this.rng()) / JOIN_TRIES) * Math.PI * 2;
        const d = r0 + this.rng() * (r1 - r0);
        const x = a.x + Math.sin(ang) * d;
        const z = a.z + Math.cos(ang) * d;
        if (Math.abs(x) > lim || Math.abs(z) > lim || this.nav.isBlocked(x, z)) continue;
        // somewhere to stand: on the teammate's level (not down a bank, not up on a counter), dry, with room for a
        // body clear of every wall, prop, tree and built structure...
        const y = groundAt(w, x, z, ay, PLAYER_RADIUS * 0.7);
        if (Math.abs(y - ay) > 1 || y < WATER_LEVEL) continue;
        body.x = x;
        body.y = y;
        body.z = z;
        if (resolveBody(w, body, PLAYER_RADIUS, PLAYER_HEIGHT)) continue;
        // ...and a straight walk to the teammate: no wall, barricade or door boards in between
        if (!this.zm.clearLine(x, y + 0.6, z, a.x, ay + 0.6, a.z)) continue;
        // out of the fight if there is such a spot: the one furthest from the nearest of the dead
        let near = JOIN_CLEAR;
        for (const e of dead) near = Math.min(near, Math.hypot(e.x - x, e.z - z));
        if (near > far) {
          far = near;
          spot = { x, y, z, yaw: Math.atan2(-(a.x - x), -(a.z - z)) }; // facing the teammate
        }
      }
      if (far >= JOIN_LAP) break;
    }
    // nowhere around them (a closet, a ledge): the teammate's own spot is good by construction - players do not
    // collide with each other
    return spot || { x: a.x, y: a.y, z: a.z, yaw: a.yaw };
  }

  // kit: what they start with (starterKit, or what a returning player left with); beside: put them with the team
  // if there is one to join. A respawn into a run in progress would pass both, as handleJoin does.
  spawnHuman(p, kit = starterKit(this.day, this.diff), beside = false) {
    const s = p.state;
    const fresh = createPlayerState();
    Object.assign(s, fresh);
    s.weapons = kit.tools ? STARTER_TOOLS.map((t, slot) => (kit.tools.includes(slot) ? t : 0)) : STARTER_TOOLS.slice(); // (tools: parkKit)
    s.mags = [0, kit.mag];
    this.putAtStart(s);
    if (beside) Object.assign(s, this.pickJoinSpawn(p)); // (x, y, z, yaw - or nothing: the car it is)
    s.perks = p.perks;
    p.maxHp = PLAYER_MAX_HP + perkMods(p.perks).hp;
    p.hp = p.maxHp;
    p.armor = 0;
    p.armorMax = 0;
    p.armorItem = 0;
    p.backpackItem = 0;
    p.alive = true;
    p.zombie = false;
    p.downed = false;
    p.bleed = 0;
    p.revivedBy = 0;
    p.respawnT = 0;
    p.becomeZombie = false;
    p.flashlight = false;
    p.battery = FLASHLIGHT_MAX;
    this.endUse(p);
    p.hold = null;
    p.inv = createInventory();
    p.splitKeep.clear();
    for (const [item, n] of kit.items) addItem(p.inv, item, n);
    s.ammo = AMMO_ITEMS.map((_, i) => (i === AMMO.P9 ? kit.ammo : 0));
    p.kit = kit; // what they were handed: it goes with them if they leave the game (parkKit)
    p.invDirty = true;
    this.fillHistory(p);
    this.playersDirty = true;
  }

  spawnPlayerZombie(p) {
    const s = p.state;
    Object.assign(s, createPlayerState());
    s.zombie = 1;
    s.perks = p.perks; // (the simulation leaves them out while turned: perkMods(0))
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
    this.endUse(p);
    p.hold = null;
    this.fillHistory(p);
    this.playersDirty = true;
    this.track.turned(p);
  }

  // Sunrise, with DAWN_RETURN on: every player who died since the last one - risen as a zombie, or still lying
  // where they fell - is a survivor again, beside the team, with RETURN_KIT in place of the starting kit. The night
  // they died is still the night they hunted. The final stand stops the clock, so there is no dawn in it: a death
  // there lasts to the end of the run.
  returnFallen() {
    // Whoever left dead has sat the night out. If they come back into this run now, they are a survivor, with what
    // the dead who stayed wake with: handleJoin hands back the kit parked for them (parkKit left it empty),
    // so waiting out a death offline is neither better nor worse than waiting it out as a zombie.
    for (const who of this.fallen) if (this.leftKits.has(who)) this.leftKits.set(who, RETURN_KIT);
    this.fallen.clear();
    // Nobody alive to come back to: a wipe is a loss, never a second chance. checkAllDead ends the run on the death
    // that leaves nobody standing, in the tick it happens, so the clock does not reach dawn in that state - this
    // is that rule, stated again where the dead come back.
    if (!this.humans().length) return;
    for (const p of this.players.values()) {
      if (p.alive && !p.zombie) continue;
      this.spawnHuman(p, this.dawnKit(), true); // beside the team, as a late joiner is (pickJoinSpawn)
      this.track.returned(p);
      const s = p.state;
      this.notify(NOTIFY.RETURNED, p.id);
      this.sound(SOUND.REVIVE, s.x, s.y + 1, s.z, 30);
    }
  }

  fillHistory(e) {
    for (let i = 0; i < HISTORY_TICKS; i++) {
      e.hx[i] = e.x;
      e.hy[i] = e.y;
      e.hz[i] = e.z;
    }
  }

  // how long today is, horn included: the first two days are long, then they shorten (dayLength).
  // A pinned length (DAY_SECONDS, the tests) is not stretched. The horn itself stays a minute either way.
  // (on the mainland every walk is twice as far: the day the team arrives is long, the rest a little longer than
  // the island's - acts.js - and the difficulty stretches those as it does the island's)
  get dayLen() {
    if (this.dayLenOverride) return this.dayLenOverride;
    if (this.act === WORLD.MAINLAND) return Math.round((this.checkpoint && this.day === this.checkpoint.day ? ARRIVAL_DAY : dayLength(this.day) + MAINLAND_DAY_MORE) * this.diff.day);
    return Math.round(dayLength(this.day) * this.diff.day);
  }

  // What a death gives back at sunrise. Ember sends you back with a second bandage; the pistol is still one magazine.
  dawnKit() {
    if (this.diff.bandages <= 1) return RETURN_KIT;
    return { mag: RETURN_KIT.mag, ammo: 0, items: [[ITEM.BANDAGE, 2]] };
  }

  scheduleSupplyDrops() {
    const len = this.dayLen;
    const n = this.day >= 2 ? 2 : 1;
    this.supplyAt = [];
    for (let i = 0; i < n; i++) this.supplyAt.push(len * (0.2 + (i + this.rng()) * (0.6 / n))); // timeLeft thresholds
  }

  // How many of the dead night n brings for this many survivors. The final stand is sized from the same number
  // (finalStandSize), so a change here moves both.
  hordeSize(n, humans) {
    const base = Math.round((10 + 6 * n + 1.3 * n * n) * (0.6 + 0.4 * humans));
    return Math.max(NIGHT_WAVES, Math.round(base * this.diff.zombies));
  }

  // Night N: the horde comes in waves to wherever the survivors are. Bigger and tougher every night, with one new kind
  // of the dead in it (ZOMBIE_DEFS minNight) and a boss with the second wave.
  startNight() {
    this.phase = PHASE.NIGHT;
    this.timeLeft = this.nightLen;
    this.warned = false;
    this.nightStats = { kills: 0, structLost: 0, downs: 0, deaths: 0, revives: 0 };
    this.phaseXp(false);
    const n = this.day;
    const humans = Math.max(1, this.humanCount());
    const total = this.hordeSize(n, humans);
    const shares = [0.3, 0.33, 0.37];
    const scale = this.nightLen / NIGHT_LENGTH;
    // tonight's theme re-weights the blend below (the client works out the same theme from the seed to warn the team)
    const theme = this.themes ? nightTheme(this.seed, n, this.act) : null;
    const rank = nightRank(this.act, n); // (which kinds have joined the horde: on the mainland, those of night 4 at the least)
    const shadeCap = Math.min(6, (1 + Math.floor((rank - ZOMBIE_DEFS[ZTYPE.SHADE].minNight) / 2) + Math.floor(humans / 2)) * (theme?.shadeCap ?? 1));
    let shades = 0;
    this.waves = [];
    for (let k = 0; k < NIGHT_WAVES; k++) {
      const count = Math.max(3, Math.round(total * shares[k]));
      const sp = k / (NIGHT_WAVES - 1); // later waves bring more specials
      const weights = [
        [ZTYPE.WALKER, 50 - sp * 12],
        [ZTYPE.RUNNER, 16 + n * 2 + sp * 6],
        [ZTYPE.SPITTER, 6 + sp * 4],
        [ZTYPE.BOOMER, 6 + sp * 3],
        [ZTYPE.DOG, 3 + sp * 2], // each pick is a pack of 2-3
        [ZTYPE.LEAPER, 6 + sp * 4],
        [ZTYPE.BAT, 7],
        [ZTYPE.ROPER, 5 + sp * 3],
        [ZTYPE.TANK, (1 + n * 0.3) * (0.5 + sp)],
        [ZTYPE.SHADE, 2.5 + sp * 2.5],
      ];
      // one new kind a night: each stays out of the horde until its night comes
      for (const wt of weights) if (rank < ZOMBIE_DEFS[wt[0]].minNight) wt[1] = 0;
      if (theme) for (const wt of weights) wt[1] *= theme.mul[wt[0]] ?? 1;
      // Ember thins the kinds that punish movement. Blackout brings more of them. Walkers and tanks stay: one is
      // the crowd, the other is a slow thing you can see coming. The night's guaranteed new kind is added below.
      if (this.diff.specials !== 1) {
        for (const wt of weights) {
          if (wt[0] === ZTYPE.SPITTER || wt[0] === ZTYPE.BOOMER || wt[0] === ZTYPE.LEAPER || wt[0] === ZTYPE.ROPER || wt[0] === ZTYPE.SHADE || wt[0] === ZTYPE.BAT) wt[1] *= this.diff.specials;
        }
      }
      const tot = weights.reduce((a, b) => a + b[1], 0);
      const q = [];
      for (let i = 0; i < count; i++) {
        let r = this.rng() * tot;
        for (const [t, wgt] of weights) {
          r -= wgt;
          if (r <= 0) {
            // only so many shades a night: each one ties up a light (or a survivor holding a beam on it)
            if (t === ZTYPE.SHADE && shades++ >= shadeCap) {
              q.push(ZTYPE.RUNNER);
              break;
            }
            const k = t === ZTYPE.DOG ? 2 + (this.rng() < 0.5 ? 1 : 0) : 1;
            for (let j = 0; j < k; j++) q.push(t);
            i += k - 1;
            break;
          }
        }
      }
      this.waves.push({ start: WAVE_TIMES[k] * scale, queue: q, started: false, spawnT: 0, interval: (WAVE_SPREAD * scale) / Math.max(1, Math.ceil(count / 3.5)) });
    }
    // the night's new kind is in it for certain (the dawn card and the dusk horn said it would be), and from their
    // night on there is always at least one shade out there. Both come with the second wave, in a walker's place
    const fresh = [];
    for (const t of Object.values(ZTYPE)) if (ZOMBIE_DEFS[t].minNight === rank && !ZOMBIE_DEFS[t].boss && !this.waves.some((wv) => wv.queue.includes(t))) fresh.push(t);
    if (rank >= ZOMBIE_DEFS[ZTYPE.SHADE].minNight && !shades && !fresh.includes(ZTYPE.SHADE)) fresh.push(ZTYPE.SHADE);
    for (const t of fresh) {
      const q = this.waves[1].queue;
      const at = q.indexOf(ZTYPE.WALKER);
      q[at >= 0 ? at : Math.floor(this.rng() * q.length)] = t;
    }
    this.shadeWarned = false;
    this.wave = 0;
    this.hordeHpMul = 1 + 0.1 * (n - 1) + 0.12 * (humans - 1);
    this.bossPending = null;
    // a boss comes in with the second wave: early enough in the night that the survivors have to deal with it, and
    // can - at dawn the sun takes whatever is left of it, and what it carried (Combat.killZombie)
    const bossT = WAVE_TIMES[BOSS_WAVE] * scale + 8;
    // every night has one: The Brute on the first, then one drawn from the seed (BOSS_POOL)
    this.bossPending = { types: [nightBoss(this.seed, n, this.act)], t: bossT };
    this.notify(NOTIFY.NIGHT_FALLS, n);
    this.track.nightfall();
    this.ach.nightfall();
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
    // the night goes on the record of everyone who saw it through (the dead come back below: it was not theirs)
    this.credit(this.humans(), 'nights');
    this.phaseXp(true, night); // (...and so does its XP)
    this.track.dawn(night);
    this.ach.dawn();
    // horde burns in the sunlight (what is down in the mine burns when it comes up into it: Zombies.updateOne)
    for (const z of this.zombies) {
      if (z.dead || !(z.horde || z.def.flying)) continue;
      if (z.under || this.zm.inDark(z)) z.spared = true; // (nor into the boarded-up wards of the clinic)
      else z.burning = 0.5 + this.rng() * 5;
    }
    // ...and the mine fills up again with the ones that live down there
    this.zm.stockMine(this.humans());
    this.zm.wards.stock(this.humans());
    this.cemetery.dawn();
    // ...and deer walk in from the rim for the ones that were hunted
    this.dm.dawn(this.humans());
    // ...and burns the sickness out of whoever died since the last sunrise
    if (this.dawnReturn) this.returnFallen();
    // the valley restocks a little: some searched containers are refilled, trees & wrecks regrow
    for (const c of this.caches) {
      if (c.state === 1 && !CONT_DEFS[c.ctype].once && this.rng() < 0.4) c.state = 0;
    }
    this.gather.clear(); // (and with it what every wreck took: they are whole again, and quiet)
    this.ringing.clear();
    regrowTrees(this.world);
    this.emit((w) => w.u8(EVT.REGROWN));
    this.globalDirty = true;
  }

  victory() {
    this.track.finish('victory'); // (first: who is where as the car leaves)
    this.ach.victory();
    this.phase = PHASE.VICTORY;
    this.restartT = GAME_OVER_DELAY + 6 + (this.act === WORLD.MAINLAND ? TAKEOFF_TIME : 0); // (the take-off is watched first)
    this.checkpoint = null;
    this.escape.active = false;
    this.credit(this.players.values(), 'wins'); // the run is the team's: won by everybody in it, the turned and the left-behind too
    // ...but the XP for the escape is for whoever is in the car (as the end screen tells it: ESCAPE_RADIUS)
    const car = this.world.car;
    for (const p of this.players.values()) {
      const aboard = p.alive && !p.zombie && Math.hypot(p.state.x - car.x, p.state.z - car.z) <= ESCAPE_RADIUS;
      this.award(p, XPS.escape, aboard ? XP.escape : XP.team);
    }
    this.notify(NOTIFY.VICTORY, this.day);
    this.sound(SOUND.CAR_START, this.world.car.x, 0.5, this.world.car.z, 0);
    this.globalDirty = true;
    this.log('victory!');
  }

  gameOver() {
    this.track.finish('wipe');
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
    for (const p of this.players.values()) if (p.alive && !p.zombie && !p.downed) return;
    // nobody left standing to revive the fallen
    for (const p of this.players.values()) if (p.alive && !p.zombie && p.downed) this.killPlayer(p, p.lastSrc || { kind: KILLER.WORLD }, true);
    this.gameOver();
  }

  allSuppliesIn() {
    const { items, need } = this.sup;
    for (let i = 0; i < items.length; i++) if (this.supplies[i] < need[i]) return false;
    return true;
  }

  // How many of the dead the final stand brings in all. It is read whenever a group is due (updateEscape), so it
  // follows the survivors still alive: a death shrinks what is still to come, a late joiner adds to it.
  finalStandSize() {
    return Math.round(FINAL_STAND_SIZE * (this.act === WORLD.MAINLAND ? RUNWAY.SIZE : 1) * this.hordeSize(this.day, Math.max(1, this.humanCount())));
  }

  startEngine(p) {
    if (this.escape.active || !this.allSuppliesIn()) return;
    if (this.phase !== PHASE.DAY && this.phase !== PHASE.NIGHT) return;
    this.escape = { ...this.noEscape(), active: true, t: this.act === WORLD.MAINLAND ? RUNWAY.FUEL_TIME : ESCAPE_TIME, spawnT: 3 };
    const car = this.world.car;
    this.notify(NOTIFY.ENGINE_START, p ? p.id : 0);
    this.sound(SOUND.ENGINE_CRANK, car.x, car.y + 0.8, car.z, 300);
    this.sound(SOUND.HORDE_HORN, 0, 0, 0, 0);
    this.hordeHpMul = 1 + 0.12 * this.day + 0.12 * (Math.max(1, this.humanCount()) - 1);
    // as at nightfall: the wanderers near the survivors join in, and count towards the stand's size; the rest drift
    // off, which leaves the stand its room under MAX_ZOMBIES_ALIVE (a day's valley can fill most of it)
    const hs = this.humans();
    for (const z of [...this.zombies]) {
      if (z.dead) continue;
      let md = Infinity;
      for (const h of hs) md = Math.min(md, Math.hypot(h.state.x - z.x, h.state.z - z.z));
      if (z.horde || z.boss || md < FINAL_STAND_JOIN_RANGE) {
        z.horde = true;
        if (!z.boss) {
          this.escape.sent++;
          if (z.ztype === ZTYPE.TANK) this.escape.tanks++;
        }
      } else {
        this._listRemove(this.zombies, z);
        this.removeEntity(z);
      }
    }
    this.globalDirty = true;
    this.track.engineStart(p);
    this.log('engine started - final stand');
  }

  // A survivor got in and drove (HOLD.DRIVE at the car, once the engine is warm). That wins the run for the whole
  // team, as victory always has: one phase and one restart for everybody. Whoever is not at the car is left
  // behind, which each client works out for its own end screen from ESCAPE_RADIUS.
  // On the island that is no longer the end: the car makes for the bridge, and the run goes on across it (cross).
  // On the mainland it is the plane, and it does not go while the dead stand on the runway ahead of it.
  driveOff(p) {
    if (!this.escape.active || !this.escape.ready) return;
    if (this.act === WORLD.MAINLAND) {
      const n = this.onRunway();
      if (n > RUNWAY.CLEAR) return this.notify(NOTIFY.RUNWAY_BLOCKED, n, p.id);
      this.log('took off:', p.name);
      this.track.drove(p);
      this.ach.drove(p);
      return this.victory();
    }
    this.log('drove off:', p.name);
    this.track.drove(p);
    this.ach.drove(p); // (the driver's feat is the car's, as it was)
    this.cross(p, this.phase === PHASE.NIGHT);
  }

  // how many of the dead stand on the runway ahead of the plane (acts.js RUNWAY: the strip it needs for its run)
  onRunway() {
    const car = this.world.car;
    let n = 0;
    for (const z of this.zombies) if (!z.dead && !z.def.flying && Math.abs(z.x - car.x) < RUNWAY.LANE && car.z - z.z > 4 && car.z - z.z < RUNWAY.STRIP) n++;
    return n;
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
      droppedBy: this.dropper, // who put it down on purpose and has stayed by it since (0: nobody); see updateItems
      despawnAt: opts.permanent || opts.point ? Infinity : this.time + (opts.life || 150),
      permanent: !!opts.permanent,
      hint: opts.hint ?? -1, // a car supply still in its hiding place: which of the supply hints points at it
      noAutoUntil: opts.noAuto ? this.time + opts.noAuto : 0,
      drop: opts.drop && !opts.permanent ? ++this.dropSeq : 0, // a loose drop: its place in the order they fell
    };
    if (!this.spawnEntity(e)) return null;
    this.items.push(e);
    if (looseSupply(e)) this.globalDirty = true; // (the field map marks it: writeGlobal)
    // the ceiling on loose drops (MAX_DROPS): the oldest one makes room
    if (e.drop && ++this.drops > this.maxDrops) {
      let oldest = e;
      for (const it of this.items) if (it.drop && it.drop < oldest.drop) oldest = it;
      this.removeItemEnt(oldest);
    }
    return e;
  }

  removeItemEnt(e) {
    if (e.point) {
      e.point.ent = null;
      e.point.respawnAt = this.time + (e.point.zone === ZONE.FOREST ? 110 + this.rng() * 140 : 150 + this.rng() * 180);
    }
    if (e.drop && !e.removed) this.drops--;
    // a hidden car supply only ever leaves its spot in someone's hands: that place needs no more searching
    if (e.hint >= 0 && !e.removed) {
      this.track.supplyFound(e);
      this.supplyFound |= 1 << e.hint;
      this.globalDirty = true;
    }
    if (looseSupply(e) && !e.removed) this.globalDirty = true;
    this._listRemove(this.items, e);
    this.removeEntity(e);
  }

  // The height something dropped from feet height y comes to rest at on x,z - or null where nobody could pick it up
  // again: on the lake bed (a deck over the water is ground like any other) or inside something solid.
  dropRest(x, y, z) {
    const w = this.world;
    // (the ground of the level the feet are on: down in the mine the floor of the drift, and no spot in its rock)
    const terrain = w.floorAt(x, z, y + 0.5);
    if (w.mine && w.mine.under(x, y + 0.5, z) && w.mine.sdf(x, z) > -0.2) return null;
    // onto whatever is there up to a metre above the feet (a table, a hood), uphill onto what stands on the slope
    const gy = groundAt(w, x, z, Math.max(y, terrain) + 1, 0.1, true);
    if (w.isDeepWater(x, z) && gy <= terrain + 0.01) return null;
    const near = [];
    for (const grid of w.colliderGrids) {
      for (const c of grid.query(x, z, 0.15, near)) {
        if (c.flags & (COL.NOBLOCK | COL.HUMANPASS)) continue;
        // a wall, a rock, a wreck, a tree trunk - not the floor under it or a roof over it
        if (c.y1 > gy + STEP_HEIGHT && c.y0 < gy + 0.3 && footprintContains(c, x, z, 0.15)) return null;
      }
    }
    return gy;
  }

  // Scatter a dropped item near x,z. It never comes to rest where nobody can get at it - the lake bed off the pier,
  // inside a wall or a rock, beyond the edge of the map: it lands short of that instead, on the way back to the feet of
  // whoever dropped it (opts.from, else x,z itself), and when those will not do either (a body out in the lake) on the
  // nearest spot around them that will. A car supply lost that way would make the game unwinnable. The search draws
  // nothing from the rng.
  dropItem(item, count, x, y, z, opts = {}) {
    const a = this.rng() * Math.PI * 2;
    const r = opts.spread ?? 0.6 + this.rng() * 0.8;
    const lim = this.world.half - 3; // as far out as a survivor gets (simulatePlayer)
    const inMap = (v) => Math.max(-lim, Math.min(lim, v));
    const hx = inMap(opts.from?.x ?? x);
    const hz = inMap(opts.from?.z ?? z);
    const sx = inMap(x + Math.sin(a) * r);
    const sz = inMap(z + Math.cos(a) * r);
    // it falls from the ground under the dropper's feet (they may be in mid-air), not onto a roof beside them. What
    // flies over open water has no ground to speak of and drops from where it is, onto the deck if that is nearest
    const under = groundAt(this.world, hx, hz, y, PLAYER_RADIUS * 0.7, true);
    const fy = this.world.isDeepWater(hx, hz) && under <= this.world.heightAt(hx, hz) + 0.01 ? y : Math.min(y, under);
    let dx;
    let dz;
    let gy = null;
    const tryAt = (px, pz) => {
      dx = px;
      dz = pz;
      gy = this.dropRest(px, fy, pz);
    };
    // where it was thrown, then two thirds and one third of the way there, then the dropper's feet
    for (let k = 3; k >= 0 && gy === null; k--) tryAt(hx + ((sx - hx) * k) / 3, hz + ((sz - hz) * k) / 3);
    // then rings around the feet, each a little wider than the last, as far as the lake is across
    for (let ring = 0.25, n = 0; ring < 140 && gy === null; ring *= 1.15, n++) {
      for (let k = 0; k < 16 && gy === null; k++) tryAt(inMap(hx + Math.sin(a + n + k * 0.3927) * ring), inMap(hz + Math.cos(a + n + k * 0.3927) * ring));
    }
    if (gy === null) {
      // nowhere at all (no map has such a place): back at the breakdown rather than gone
      const sp = this.world.spawnPoints[0];
      dx = sp.x;
      dz = sp.z;
      gy = groundAt(this.world, dx, dz, this.world.heightAt(dx, dz) + 1, 0.1, true);
    }
    const cat = ITEM_DEFS[item]?.cat;
    return this.spawnItem(item, count, dx, gy + 0.02, dz, { life: opts.life ?? 240, mag: opts.mag, permanent: cat === 'part' || cat === 'schem', noAuto: opts.noAuto, drop: true });
  }

  // everything a survivor carries goes on the ground around them (one who leaves the game has had what is left of
  // their starting kit taken out first: parkKit)
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
      // the backpack goes down with what was in it (its pockets were emptied with the rest above)
      if (p.backpackItem) this.dropItem(p.backpackItem, 1, x, y, z, { spread: 1.2 });
    }
    p.backpackItem = 0;
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
    // ammunition is carried apart from the backpack, up to AMMO_MAX of a calibre: what a full reserve has no room for
    // is left where it is
    if (def.cat === 'ammo') {
      const take = Math.max(0, Math.min(AMMO_MAX[def.ammo] - s.ammo[def.ammo], count));
      s.ammo[def.ammo] += take;
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
      const i = freeSlot(p.inv, invCap(p));
      if (i < 0) return 0;
      p.inv[i] = { item, count: 1, mag: mag ?? (isFirearm(item) ? WEAPONS[item].mag : 0) };
      p.invDirty = p.invSort = true;
      return 1;
    }
    if (def.cat === 'armor' && mag) {
      // a worn vest that was dropped comes back with the points it had left, not as a new one
      const i = freeSlot(p.inv, invCap(p));
      if (i < 0) return 0;
      p.inv[i] = { item, count: 1, mag };
      p.invDirty = p.invSort = true;
      return 1;
    }
    const left = addItem(p.inv, item, count, invCap(p));
    const taken = count - left;
    if (taken > 0) {
      p.invDirty = p.invSort = true;
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
      this.notify(NOTIFY.INVENTORY_FULL, ITEM_DEFS[item]?.cat === 'ammo' ? item : 0, p.id); // (ammo: that reserve is full)
    }
  }

  unlockSchematic(item, p) {
    const bit = SCHEM_BIT[item];
    if (bit === undefined || this.unlocked & (1 << bit)) return;
    this.unlocked |= 1 << bit;
    this.notify(NOTIFY.SCHEMATIC, item);
    this.track.schematic(item, p);
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
    // where the client's interpolation clock stood when it sent these commands: what it had on screen, so what
    // their shots were aimed at. It stays with them: by the time a command is run, newer packets may have come in
    const renderTick = r.u16();
    const renderFrac = r.u8() / 255;
    const { cmds, hash, ping, rttMs } = readInput(r);
    if (ping) {
      p.pingAt = performance.now(); // answered in this player's next snapshot (sendSnapshots)
      if (rttMs > 0) {
        const next = p.ping > 0 ? p.ping * 0.7 + rttMs * 0.3 : rttMs;
        if (Math.round(next) !== Math.round(p.ping)) this.playersDirty = true;
        p.ping = next;
      }
    }
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      // the packet's last command carries the client's fingerprint of its predicted state after it (NO_HASH: none
      // to check against, so that client gets our state)
      p.cmdQueue.push({ seq: c.seq, buttons: c.buttons, yaw: dqangle16(c.qyaw), pitch: Math.max(-1.55, Math.min(1.55, dqpitch(c.qpitch))), slot: c.slot, hash: i < cmds.length - 1 ? -1 : hash < 0 ? NO_HASH : hash, renderTick, renderFrac });
      p.recvSeq = c.seq;
    }
    if (p.cmdQueue.length > CMD_QUEUE_MAX) p.cmdQueue.splice(0, p.cmdQueue.length - CMD_QUEUE_MAX);
  }

  // a client's commands during the crossing: acknowledged, and not run (nobody acts while the cutscene plays)
  drainInputs(p) {
    for (const cmd of p.cmdQueue) {
      p.lastSeq = cmd.seq;
      p.hasSeq = true;
    }
    if (p.cmdQueue.length) p.selfSync = true; // (its prediction ran them: it takes our state back)
    p.cmdQueue.length = 0;
  }

  processInputs() {
    for (const p of this.players.values()) {
      // A client issues CMDS_PER_TICK commands a tick, and that is what it is allowed. They do not arrive that
      // evenly: a hiccup on the link or at either end and a whole burst comes in late. So the allowance banks up
      // while nothing arrives (as far as the queue is long) and a late burst is run at once, and it refills a touch
      // faster than commands are issued, so whatever does get left waiting drains. A queue that only ever empties
      // as fast as it fills would delay everything that client does from then on: it would stand somewhere it left
      // a moment ago, for the dead to hit, and fire every shot late.
      p.cmdBudget = Math.min(p.cmdBudget + CMDS_PER_TICK * CMD_CATCH_UP, CMD_QUEUE_MAX);
      while (p.cmdQueue.length && p.cmdBudget >= 1) {
        const cmd = p.cmdQueue.shift();
        if (p.hasSeq && ((cmd.seq - p.lastSeq) & 0xffff) >= 0x8000) continue; // old/duplicate
        if (p.hasSeq && cmd.seq === p.lastSeq) continue;
        p.cmdBudget--;
        p.lastSeq = cmd.seq;
        p.hasSeq = true;
        // lag compensation rewinds to what this command's packet said was on screen (Combat.rewindTime)
        p.renderTick = cmd.renderTick;
        p.renderFrac = cmd.renderFrac;
        if (!p.alive) continue;
        const events = [];
        // The client predicts with the same simulation, so its state only needs sending when the two can differ:
        // something other than a command touched ours since the last one, or its fingerprint says it got elsewhere
        if (!samePlayerState(p.state, p.shadow)) p.selfSync = true;
        // an item asked for is in the hands from the client's first command after asking on (useItem)
        if (p.useItem && !p.state.using && ((cmd.seq - p.useItem.from) & 0xffff) < 0x8000) p.state.using = 1;
        simulatePlayer(p.state, cmd, this.world, events);
        // pinned by a leaper: shoved all the way (the simulation's meter, s.shove), they throw it off (Zombies.throwOff)
        if (p.state.pinned && p.state.shove >= 1 && this.zm.throwOff(p)) {
          p.selfSync = true;
          this.ach.threwOff(p);
        }
        copyPlayerState(p.shadow, p.state);
        if (cmd.hash === NO_HASH || (cmd.hash >= 0 && cmd.hash !== hashPlayerState(p.state))) p.selfSync = true;
        for (const ev of events) this.handleSimEvent(p, ev);
        if (this.gun.ent) this.gun.command(p, cmd); // the gunner's commands are the mounted gun's trigger
      }
    }
  }

  /** Held (the admin /step): how many ticks may run now. Takes them. */
  takeSteps(now, max) {
    if (now - this.stepAsked > STEP_IDLE) this.stepMode = false;
    const n = Math.min(max, this.stepCredit);
    this.stepCredit -= n;
    return n;
  }

  handleSimEvent(p, ev) {
    const s = p.state;
    switch (ev.type) {
      case 'gun_drop':
        this.gun.drop(p); // reached for a weapon with the mounted gun in their arms: it goes down where they stand
        break;
      case 'fire':
        this.combat.fire(p, ev);
        break;
      case 'melee':
        this.combat.melee(p, ev);
        break;
      case 'nk_swing':
        // a move of the nunchucks begins: the others hear the swing now, its blows land later ('melee', with the move)
        this.sound(SOUND.MELEE_SWING, s.x, s.y + eyeHeight(s), s.z, 20, p.id);
        break;
      case 'use_cancel':
        // a click or a weapon asked for put the item in the hands away unused (the simulation has let go of it). (Not
        // one asked for since, that the client has in its hands from a later command on)
        if (p.useItem && ((p.lastSeq - p.useItem.from) & 0xffff) < 0x8000) p.useItem = null;
        break;
      case 'throw': {
        const item = ev.item;
        // (no entity id left for the projectile: nothing leaves the hand, and syncThrow gives the simulation
        // back the one it counted as thrown)
        if (this.combat.throwProjectile(p, item)) removeItem(p.inv, item, 1);
        p.invDirty = true;
        this.syncThrow(p);
        break;
      }
      case 'reload':
        this.sound(currentWeapon(s) === ITEM.CROSSBOW ? SOUND.CROSSBOW_COCK : currentWeapon(s) === ITEM.AT_RIFLE ? SOUND.AT_RELOAD : SOUND.RELOAD, s.x, s.y + 1.2, s.z, 20, p.id);
        break;
      case 'leap':
        this.sound(SOUND.ZPLAYER_GROWL, s.x, s.y + 1.5, s.z, 40, p.id);
        break;
      case 'land':
        if (!p.zombie && ev.v > 13) this.damagePlayer(p, (ev.v - 13) * 6, { kind: KILLER.WORLD, fall: true });
        break;
      case 'splash': // into the lake (shared/swim.js): the others hear it from what they see (client entities)
        break;
      case 'cart_bump':
        // a handcar run into the end of its stretch of line (shared/handcar.js)
        this.sound(SOUND.METAL_HIT, s.x, s.y, s.z, 40, p.id);
        break;
    }
  }

  // ---------------------------------------------------------------- actions
  // ACT.WAYPOINT: a player's field-map waypoint (or none), which the rest of the team sees through the player list.
  // A burst of clicks costs one list a tick at most (playersDirty), so there is no rate limit to fall out of step with.
  setWaypoint(p, r) {
    let wp = null;
    if (r.u8()) {
      const lim = this.world.half - 3; // (as the map clamps a click)
      const x = Math.max(-lim, Math.min(lim, dqpos(r.i16())));
      const z = Math.max(-lim, Math.min(lim, dqpos(r.i16())));
      const zone = r.u8();
      wp = { x, z, zone: this.world.zoneById[zone] ? zone : 255 };
    }
    const cur = p.waypoint;
    if (cur === wp || (cur && wp && cur.x === wp.x && cur.z === wp.z && cur.zone === wp.zone)) return;
    p.waypoint = wp;
    this.playersDirty = true;
  }

  handleAction(p, r) {
    const act = r.u8();
    const s = p.state;
    // (a waypoint is only a mark on the map: it is theirs to move whatever has become of them)
    if (act === ACT.WAYPOINT) return this.setWaypoint(p, r);
    if (act === ACT.SKIP) return this.skipCrossing(p);
    if (this.phase === PHASE.CROSSING) return; // (nobody acts while the cutscene plays)
    if (!p.alive) return;
    if (p.zombie && act !== ACT.FLASHLIGHT && act !== ACT.PING) return;
    if (p.downed && act !== ACT.FLASHLIGHT && act !== ACT.PING && act !== ACT.HOLD_END) return;
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
        const x = dqpos(r.i16());
        const y = dqpos(r.i16());
        const z = dqpos(r.i16());
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
        const cnt = r.u16();
        const it = p.inv[idx];
        if (!it) return;
        this.dropper = p.id; // the stack remembers who put it down, so it does not hop back into their backpack
        const n = cnt === 0 ? it.count : Math.min(cnt, it.count);
        const ex = s.x - Math.sin(s.yaw) * 1.1;
        const ez = s.z - Math.cos(s.yaw) * 1.1;
        const dropped = this.dropItem(it.item, n, ex, s.y, ez, { spread: 0.3, mag: it.mag, noAuto: 4, from: s });
        this.dropper = 0;
        // (no entity id left for it on the ground: it stays in the pack)
        if (!dropped) return;
        p.lastDrop = { e: dropped, t: this.time };
        takeFrom(p.inv, idx, n); // (a few off a full stack: what is left of it merged with the part stack, consolidate)
        p.invDirty = p.invSort = true;
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
        const dropped = this.dropItem(wpn, 1, ex, s.y, ez, { spread: 0.2, mag: slot === SLOT_PRIMARY ? s.mags[0] : slot === SLOT_PISTOL ? s.mags[1] : 0, from: s });
        if (!dropped) return;
        p.lastDrop = { e: dropped, t: this.time };
        s.weapons[slot] = 0;
        if (slot === SLOT_PRIMARY) s.mags[0] = 0;
        if (slot === SLOT_PISTOL) s.mags[1] = 0;
        return;
      }
      case ACT.DROP_AMMO: {
        // rounds out of a reserve onto the ground for a teammate: all of a calibre, or some (the ammo pouch's popover
        // and menu). The client hears of the smaller reserve in its next snapshot, as of a reload
        const cal = r.u8();
        const cnt = r.u16();
        const have = cal < AMMO_ITEMS.length ? s.ammo[cal] : 0;
        if (have <= 0) return;
        const n = cnt === 0 ? have : Math.min(cnt, have);
        this.dropper = p.id; // (as a dropped stack: it does not hop straight back into the reserve)
        const ex = s.x - Math.sin(s.yaw) * 1.1;
        const ez = s.z - Math.cos(s.yaw) * 1.1;
        const dropped = this.dropItem(AMMO_ITEMS[cal], n, ex, s.y, ez, { spread: 0.3, noAuto: 4, from: s });
        this.dropper = 0;
        if (!dropped) return;
        s.ammo[cal] -= n;
        p.lastDrop = { e: dropped, t: this.time };
        return;
      }
      case ACT.UNDO_DROP:
        return this.undoDrop(p);
      case ACT.CRAFT:
        return this.craft(p, r.u8());
      case ACT.SALVAGE: {
        const from = r.u8();
        return this.salvage(p, from, r.u16());
      }
      case ACT.USE_ITEM:
        return this.useItem(p, r.u8());
      case ACT.UNEQUIP: {
        const slot = r.u8();
        return this.unequip(p, slot, r.u8());
      }
      case ACT.EQUIP_ARMOR:
        return this.useItem(p, r.u8());
      case ACT.WORN: {
        const which = r.u8();
        return this.wornGear(p, which, r.u8());
      }
      case ACT.BUILD: {
        const type = r.u8();
        const x = dqpos(r.i16());
        const z = dqpos(r.i16());
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
        // (a locked slot - past the capacity - is neither taken from nor put into)
        if (a >= invCap(p) || b >= invCap(p)) return;
        const A = p.inv[a];
        const B = p.inv[b];
        // onto a stack of the same that has room it tops that up; onto a full one the two trade places, as anything
        // else does (and as the client shows a drag at once: InventoryScreen)
        if (A && B && A !== B && A.item === B.item && ITEM_DEFS[A.item].stack > 1 && B.count < ITEM_DEFS[A.item].stack) {
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
      case ACT.SPLIT_INV: {
        // part of a stack into a slot of its own: to drop for a teammate, or to keep apart
        const it = p.inv[r.u8()];
        const n = r.u16();
        if (!it || n < 1 || n >= it.count) return;
        const to = freeSlot(p.inv, invCap(p));
        if (to < 0) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
        it.count -= n;
        p.inv[to] = { item: it.item, count: n };
        // The one way to more than one part stack of a thing: asked for. They stay apart while they are only moved
        // about; the next change to that item's count (a pickup, a use, a craft, a drop) merges them again
        p.splitKeep.set(it.item, countItem(p.inv, it.item));
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
      case ACT.GUN_MAN:
        return this.gun.man(p, r.u8());
      case ACT.GUN_FEED:
        return this.gun.feed(p, r.u8());
      case ACT.GUN_PUT:
        return this.gun.put(p, r.u8());
      case ACT.RIDE:
        return this.fair.board(p, r.u8());
      case ACT.HANDCAR:
        return this.handcars.board(p, r.u8());
      case ACT.GEN_SWITCH:
        return this.power.flip(p, r.u16());
    }
  }

  // (the plane is a bigger thing to stand beside than the car: PLANE_REACH further)
  nearCar(p, r = 5) {
    const s = p.state;
    const car = this.world.car;
    return Math.hypot(s.x - car.x, s.z - car.z) <= r + (car.plane ? PLANE_REACH : 0);
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

  // what player p could craft with right here: { fire, bench, unlocked } (planCost, shared/autocraft.js)
  craftCtx(p) {
    return { fire: !!this.nearStation(p, 'fire'), bench: !!this.nearStation(p, 'bench'), unlocked: this.unlocked };
  }

  // how p pays `cost`, the materials short of it made from what they are made of (planCost); null: p cannot
  planFor(p, cost) {
    return planCost(countsMap(p.inv), cost, this.craftCtx(p));
  }

  // What a plan's batches made beyond what it took (ten Nails for the four a wall needs), once its `take` is paid and
  // what was bought handed over: into the pack where addItem puts it (craftRun in client/game/bulkcraft.js puts it
  // in the same place), and at p's feet what does not fit
  madeExtra(p, plan) {
    for (const k in plan.give) {
      const left = addItem(p.inv, +k, plan.give[k], invCap(p));
      if (left > 0) this.dropItem(+k, left, p.state.x, p.state.y, p.state.z, { spread: 0.8 });
    }
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
      this.sup.items.forEach((item, i) => {
        const need = this.sup.need[i] - this.supplies[i];
        if (need <= 0) return;
        const have = countItem(p.inv, item);
        const n = Math.min(need, have);
        if (n <= 0) return;
        removeItem(p.inv, item, n);
        this.supplies[i] += n;
        installed += n;
        this.track.install(p, item, n);
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
    if (id === FAIR_TANK_ID) return this.fair.topUp(p);
    const e = this.ents[id];
    if (!e || e.removed) return;
    const dx = e.x - ex;
    const dz = e.z - ez;
    const dy = this.pickY(e) - ey;
    const d = Math.hypot(dx, dz);
    const reach = this.reachOf(e);
    if (d > reach || Math.abs(dy) > reach) return;
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
          // (the weapon in hand goes down first: with no entity id left for it there is no swap, and it is kept)
          if (old && !this.dropItem(old, 1, s.x, s.y, s.z, { mag: oldMag, spread: 0.5 })) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
          s.weapons[slot] = e.item;
          if (s.slot === slot) s.reloadT = 0; // a reload of the weapon swapped out must not finish on this one
          if (slot === SLOT_PRIMARY) s.mags[0] = e.mag;
          if (slot === SLOT_PISTOL) s.mags[1] = e.mag;
          this.removeItemEnt(e);
          this.pickupEvent(p, e.item, 1);
        } else {
          this.notify(NOTIFY.INVENTORY_FULL, def?.cat === 'ammo' ? e.item : 0, p.id); // (ammo: that reserve is full)
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
      this.track.crateOpened(p);
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
      if (this.power.interact(p, e)) return; // (a generator takes fuel)
      this.repair(p, e.id);
    }
  }

  // height of the entity's interaction point (as the client picks it)
  pickY(e) {
    if (e.kind === ENT.ITEM) return e.y + 0.15;
    if (e.kind === ENT.CRATE) return e.y + 0.6;
    if (e.kind === ENT.STRUCTURE) return e.y + Math.min(1, STRUCT_DEFS[e.stype].sy * 0.5);
    if (e.kind === ENT.PLAYER) return e.y + 0.3;
    if (e.kind === ENT.GUN && e.mode === GUN_LYING) return e.y - GUN.pivotY + 0.3; // (on its side on the ground)
    return e.y;
  }

  // How far away the entity can be interacted with: as far as a client can be offered [E] on it (its view ray passes
  // within the pick radius of the interaction point, inside INTERACT_REACH of the eye), and INTERACT_SLACK beyond,
  // because our copy of the player trails the one that client looks out of. Never less: a refusal is silent, so
  // the player would be holding [E] on a prompt with nothing happening
  reachOf(e) {
    const r = e.kind === ENT.ITEM ? PICK_RADIUS.ITEM : e.kind === ENT.CACHE ? PICK_RADIUS.CACHE : e.kind === ENT.CRATE ? PICK_RADIUS.CRATE : e.kind === ENT.STRUCTURE ? structPickRadius(e.stype) : PICK_RADIUS.DOWNED;
    return Math.hypot(INTERACT_REACH, r) + INTERACT_SLACK;
  }

  // eye -> the entity's interaction point isn't cut off by a wall
  canReachEnt(p, e) {
    const s = p.state;
    return canReach(this.world, s.x, s.y + eyeHeight(s), s.z, e.x, this.pickY(e), e.z, s.y + EYE_HEIGHT);
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
      if (!this.nearCar(p)) return;
      if (this.escape.active) {
        // once the engine is warm the same hold gets in and drives: the run does not end until somebody does
        if (this.escape.ready) p.hold = { kind: HOLD.DRIVE, target: CAR_ID, t: 0, need: ESCAPE_DRIVE_TIME };
        return;
      }
      if (!this.allSuppliesIn()) return this.interact(p, CAR_ID);
      p.hold = { kind: HOLD.ENGINE, target: CAR_ID, t: 0, need: ENGINE_START_TIME };
      return;
    }
    if (this.fixtures.owns(id)) return this.fixtures.holdBegin(p, id);
    if (id === FAIR_GEN_ID) return this.fair.holdBegin(p);
    const e = this.ents[id];
    if (!e || e.removed || !this.canReachEnt(p, e)) return;
    if (e.kind === ENT.GUN) return this.gun.holdBegin(p); // lifting the mounted gun
    const d = Math.hypot(e.x - s.x, e.z - s.z);
    if (e.kind === ENT.CACHE) {
      if (d > this.reachOf(e) || e.state !== 0) {
        if (e.state !== 0) this.notify(NOTIFY.SEARCH_EMPTY, 0, p.id);
        return;
      }
      // (a car's boot is forced: longer, by what is in the hand - shared/trunk.js)
      const pry = this.pryOf(p, e);
      p.hold = { kind: HOLD.SEARCH, target: id, t: 0, need: (pry ? pryTime(pry.weapon) : SEARCH_TIME) * perkMods(p.perks).search, pry };
      this.sound(SOUND.SEARCH, e.x, e.y, e.z, 18);
      return;
    }
    if (e.kind === ENT.PLAYER && e !== p && e.alive && e.downed && !e.zombie) {
      if (d > this.reachOf(e)) return;
      p.hold = { kind: HOLD.REVIVE, target: id, t: 0, need: REVIVE_TIME * this.diff.revive * perkMods(p.perks).revive };
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
      if (h.target === CAR_ID) ok = this.nearCar(p, 6) && (h.kind === HOLD.DRIVE ? this.escape.active && this.escape.ready : !this.escape.active);
      else if (this.fixtures.owns(h.target)) ok = this.fixtures.holdOk(p, h);
      else if (h.target === FAIR_GEN_ID) ok = this.fair.holdOk(p, h);
      else {
        tgt = this.ents[h.target];
        if (!tgt || tgt.removed) ok = false;
        else {
          // broken off a little further out than it can start: a hold begun at the edge survives a step back
          const near = Math.hypot(tgt.x - s.x, tgt.z - s.z) < this.reachOf(tgt) + HOLD_SLACK;
          if (h.kind === HOLD.SEARCH) ok = near && tgt.state === 0;
          else if (h.kind === HOLD.REVIVE) ok = near && tgt.alive && tgt.downed && !tgt.zombie;
          else if (h.kind === HOLD.GUN_LIFT) ok = this.gun.holdOk(p);
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
    if (h.pry && h.t >= h.pry.next && h.t < h.need) {
      h.pry.next += PRY.lever;
      this.pryHeave(p, tgt, h.pry);
    }
    if (h.t < h.need) return;
    p.hold = null;
    if (h.kind === HOLD.SEARCH) this.searchCache(p, tgt);
    else if (h.kind === HOLD.REVIVE) this.revive(tgt, p);
    else if (h.kind === HOLD.ENGINE) this.startEngine(p);
    else if (h.kind === HOLD.DRIVE) this.driveOff(p);
    else if (h.kind === HOLD.GUN_LIFT) this.gun.lift(p);
    else if (this.fixtures.owns(h.target)) this.fixtures.holdDone(p, h);
    else if (h.target === FAIR_GEN_ID) this.fair.holdDone(p, h);
  }

  // Forcing a car's boot (shared/trunk.js). What the hold is to be, when this container is the boot of a car with a
  // lid on it: the weapon that levers it (0: bare hands) and where. null: searched as any container - not a boot,
  // its lid up already, or the wreck picked clean (every part of it is off then, the lid too: Wreck.pickClean).
  pryOf(p, c) {
    if (c.ctype !== CONT.TRUNK) return null;
    if (c.car === undefined) c.car = trunkCar(this.world, c);
    const car = c.car;
    if (!hasBootLid(car)) return null;
    for (const col of this.world.staticGrid.query(car.x, car.z, 1, [])) if (col.tag === car && this.gather.get(col)?.left <= 0) return null;
    // the lid's edge, over the bumper; the lever goes in and down
    const ax = Math.sin(car.ry), az = Math.cos(car.ry);
    return { weapon: pryWeapon(currentWeapon(p.state)), next: PRY.lever, x: car.x + ax * 2.12, y: car.y + 0.84, z: car.z + az * 2.12, dx: -ax * 0.8, dy: -0.6, dz: -az * 0.8 };
  }
  // one heave on the lever: a blow on the lid's edge that those near see and hear (as a swing that lands on a wreck
  // does: nothing is put on the wreck's record, and it gives nothing), and a little noise for the dead
  pryHeave(p, c, pry) {
    if (pry.weapon) this.strike(p, pry.weapon, false, pry.x, pry.y, pry.z, pry.dx, pry.dy, pry.dz);
    else this.sound(SOUND.SEARCH, c.x, c.y, c.z, 18);
    this.zm.noise(c.x, c.z, PRY.noise);
  }

  searchCache(p, c) {
    c.state = 1;
    this.track.searched(p, c);
    this.ach.searched(p, c);
    const def = CONT_DEFS[c.ctype];
    const table = (def.table && CONT_TABLES[def.table]) || LOOT_TABLES[c.zone] || LOOT_TABLES[ZONE.ROADSIDE];
    let rolls = def.rolls[0] + Math.floor(this.rng() * (def.rolls[1] - def.rolls[0] + 1));
    if (this.diff.loot > 1) rolls++; // Ember: the first cupboard still pays even if you do not know what you are looking for
    const extra = perkMods(p.perks).extraFind;
    if (extra && this.rng() < extra) rolls++;
    for (let i = 0; i < rolls; i++) {
      const [item, n] = this.rollTable(table);
      this.giveOrDrop(p, item, n);
      // (a strongbox: the gun comes with something to fire)
      const ammo = def.loaded ? loadedAmmo(item, def.loaded) : null;
      if (ammo) this.giveOrDrop(p, ammo[0], ammo[1]);
    }
    for (const [item, n] of def.also || []) this.giveOrDrop(p, item, n);
    if (c.schem) {
      this.unlockSchematic(c.schem, p);
      this.pickupEvent(p, c.schem, 1);
      c.schem = 0;
    }
    this.sound(SOUND.SEARCH, c.x, c.y, c.z, 20);
    if (c.ctype === CONT.TRUNK && this.rng() < CAR_ALARM_CHANCE) this.triggerCarAlarm(p, c);
  }

  triggerCarAlarm(p, c) {
    const humans = this.humans();
    if (!p.alive || p.zombie || !humans.length) return;
    const count = Math.max(2, Math.round((CAR_ALARM_MIN_ZOMBIES + Math.floor(this.rng() * (CAR_ALARM_MAX_ZOMBIES - CAR_ALARM_MIN_ZOMBIES + 1))) * this.diff.zombies));
    this.makeZombieRoom(count, humans);
    if (this.zombies.length >= MAX_ZOMBIES_ALIVE) return;
    this.notify(NOTIFY.CAR_ALARM, 0);
    this.sound(SOUND.HORDE_HORN, c.x, c.y, c.z, 140);
    this.zm.noise(c.x, c.z, NOISE.CAR_ALARM);
    let spawned = 0;
    for (let i = 0; i < count && this.zombies.length < MAX_ZOMBIES_ALIVE; i++) {
      const sp = this.pickCarAlarmSpawn(p, c, humans);
      if (!sp) break;
      const r = this.rng();
      const type = r < 0.65 ? ZTYPE.WALKER : r < 0.9 ? ZTYPE.RUNNER : this.day >= 2 ? ZTYPE.SPITTER : ZTYPE.RUNNER;
      const z = this.zm.spawn(type, sp.x + (this.rng() - 0.5) * 6, sp.z + (this.rng() - 0.5) * 6, { horde: true, hpMul: 1 + 0.04 * this.day });
      if (!z) continue;
      z.target = p.id;
      z.targetT = 0.8;
      z.aggroId = p.id;
      z.aggroT = 30;
      z.alertX = p.state.x;
      z.alertZ = p.state.z;
      z.alertT = 20;
      z.alertRush = 1;
      spawned++;
    }
    this.track.carAlarm(p, spawned);
    this.ach.carAlarm(p);
    if (spawned) this.globalDirty = true;
  }

  // the day's wanderers fill most of the zombie cap: idle ones far out of everyone's sight drift off so n more fit
  // (not the dog packs or the wandering herd: the day's upkeep would only spawn them again)
  makeZombieRoom(n, humans) {
    let over = this.zombies.length + n - MAX_ZOMBIES_ALIVE;
    if (over <= 0) return;
    const far = [];
    for (const z of this.zombies) {
      if (z.dead || z.horde || z.boss || z.pack || z.herd || z.target) continue;
      let md = Infinity;
      for (const h of humans) md = Math.min(md, Math.hypot(h.state.x - z.x, h.state.z - z.z));
      if (md > 150) far.push({ z, md });
    }
    far.sort((a, b) => b.md - a.md);
    for (const { z } of far) {
      if (over-- <= 0) break;
      this._listRemove(this.zombies, z);
      this.removeEntity(z);
    }
  }

  pickCarAlarmSpawn(p, c, humans) {
    const s = p.state;
    const lim = this.world.half - 14;
    const behind = s.yaw + Math.PI;
    for (let tries = 0; tries < 20; tries++) {
      const a = behind + (this.rng() - 0.5) * Math.PI;
      const d = CAR_ALARM_SPAWN_MIN + this.rng() * (CAR_ALARM_SPAWN_MAX - CAR_ALARM_SPAWN_MIN);
      const x = s.x - Math.sin(a) * d;
      const z = s.z - Math.cos(a) * d;
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      if (this.world.isDeepWater(x, z) || this.nav.isBlocked(x, z)) continue;
      let ok = true;
      for (const h of humans) {
        const hs = h.state;
        if (Math.hypot(hs.x - x, hs.z - z) < CAR_ALARM_SPAWN_MIN * 0.75) {
          ok = false;
          break;
        }
      }
      if (ok) return { x, z };
    }
    return this.zm.pickSpawnAround(c.x, c.z, humans, CAR_ALARM_SPAWN_MIN, CAR_ALARM_SPAWN_MAX);
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
      g = { left: tree ? 6 : WRECK_SALVAGE };
      this.gather.set(col, g);
    }
    if (g.left <= 0) {
      if (this.rng() < 0.35) this.notify(NOTIFY.SEARCH_EMPTY, tree ? 1 : 2, p.id);
      return;
    }
    g.left--;
    const r = this.rng;
    const more = perkMods(p.perks).gather;
    if (more && r() < more) this.giveOrDrop(p, tree ? ITEM.STICK : ITEM.SCRAP, 1);
    if (tree) {
      const dead = col.tv === 3 || col.tv === 4 || col.tv === 6;
      let sticks = weapon === ITEM.KNIFE || weapon === ITEM.NUNCHAKU ? 1 : 2;
      if (dead) sticks++;
      this.giveOrDrop(p, ITEM.STICK, sticks);
      const plankChance = (weapon === ITEM.MACHETE ? 0.35 : weapon === ITEM.HAMMER ? 0.15 : 0.22) + (col.tv === 5 ? 0.15 : 0);
      if (r() < plankChance) this.giveOrDrop(p, ITEM.WOOD, 1);
      if (!dead && r() < 0.07) this.giveOrDrop(p, ITEM.HERB, 1);
      this.zm.noise(x, z, NOISE.CHOP); // (what it sounds like is the blow's: EVT.STRIKE)
    } else {
      this.giveOrDrop(p, ITEM.SCRAP, weapon === ITEM.HAMMER ? 1 + (r() < 0.5 ? 1 : 0) : 1);
      if (r() < 0.3) this.giveOrDrop(p, ITEM.NAILS, 2 + Math.floor(r() * 3));
      if (r() < 0.08) this.giveOrDrop(p, ITEM.TAPE, 1);
      if (r() < 0.05) this.giveOrDrop(p, ITEM.WIRE, 1);
      if (r() < 0.04) this.giveOrDrop(p, ITEM.BATTERY, 1);
      this.zm.noise(x, z, NOISE.SALVAGE);
    }
    if (g.left > 0) return;
    // that was the last of it. A tree comes down, away from whoever cut it, and is out of the world until dawn;
    // a wreck stays where it is, and nobody's prompt offers the hit any more (the one who took it is told)
    if (tree) {
      this.ach.felled(p);
      return this.fellTree(col, Math.atan2(p.state.x - col.x, p.state.z - col.z));
    }
    this.tellStripped([col]);
    this.notify(NOTIFY.SEARCH_EMPTY, 2, p.id);
  }

  // ---------------------------------------------------------------- blows on the world, and wrecks taken apart
  // A melee swing that struck the world at x,y,z going dx,dy,dz: the clients draw what it did (shared/surfaces.js).
  strike(p, weapon, heavy, x, y, z, dx, dy, dz) {
    this.emit(
      (w) => {
        w.u8(EVT.STRIKE);
        w.u16(p.id);
        w.u8(blowOf(weapon) | (heavy ? HITF.HEAVY : 0));
        w.i16(qpos(x));
        w.i16(qpos(y));
        w.i16(qpos(z));
        w.i8(Math.round(dx * 127));
        w.i8(Math.round(dy * 127));
        w.i8(Math.round(dz * 127));
      },
      { x, z, r: 90 },
    );
  }

  // A blow on a wreck (its collider `col`) at x,y,z going dx,dy,dz: kept on its record while there is room, and
  // told to everybody (EVT.WRECK) - and its alarm, if it has one, hears it. took: it took one of the wreck's salvage.
  wreckHit(col, x, y, z, dx, dy, dz, blow, heavy = false, took = false) {
    const prop = wreckOf(col);
    if (!prop) return;
    let g = this.gather.get(col);
    if (!g) this.gather.set(col, (g = { left: WRECK_SALVAGE }));
    const hits = (g.hits ||= []);
    let hit = null;
    if (hits.length < WRECK_HITS_MAX) {
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
      hit = [qpos(x), qpos(y), qpos(z), qangle8(yaw), Math.round((pitch / (Math.PI / 2)) * 127), blow | (heavy ? HITF.HEAVY : 0) | (took ? HITF.TOOK : 0)];
      hits.push(hit);
    }
    if (hit || took) this.tellWreck(col, g, hit ? [hit] : [], 0);
    this.alarmHit(col, g, prop, blow, x, z);
  }

  // What a blast does to the wrecks round it: each one in reach takes it as a blow on the side it faces. It gives
  // no scrap.
  blastWrecks(x, y, z, radius) {
    const near = this.world.staticGrid.query(x, z, radius + 6, []);
    for (const col of near) {
      if (!wreckOf(col) || this.gather.get(col)?.hits?.length >= WRECK_HITS_MAX) continue;
      // the nearest point of its box
      const lx = col.c * (x - col.x) - col.s * (z - col.z);
      const lz = col.s * (x - col.x) + col.c * (z - col.z);
      const cx = Math.max(-col.hx, Math.min(col.hx, lx));
      const cz = Math.max(-col.hz, Math.min(col.hz, lz));
      const px = col.x + col.c * cx + col.s * cz;
      const pz = col.z - col.s * cx + col.c * cz;
      const py = Math.max(col.y0 + 0.3, Math.min(col.y1 - 0.2, y));
      const d = Math.hypot(px - x, py - y, pz - z);
      if (d > radius) continue;
      // (a blast right on top of it: from above its middle)
      if (d > 0.05) this.wreckHit(col, px, py, pz, (px - x) / d, (py - y) / d, (pz - z) / d, BLOW.BLAST);
      else this.wreckHit(col, px, py, pz, 0, -1, 0, BLOW.BLAST);
    }
  }

  alarmHit(col, g, prop, blow, x, z) {
    const front = wreckLocal(prop, x, 0, z)[2] / Math.max(0.5, col.hz);
    const [state, say] = alarmStep(g.alarm || ALARM.UNKNOWN, prop.type, blow, front, this.rng);
    g.alarm = state;
    if (say < 0) return;
    if (say === ALARM_SAY.RING) {
      g.ringT = WRECK_ALARM.ring;
      g.pulseT = 0; // (the first of its noises now)
      this.ringing.add(col);
    } else if (say === ALARM_SAY.QUIET) this.ringing.delete(col);
    this.tellAlarm(col, say, g);
  }

  // the alarms that are going: each calls the dead every WRECK_ALARM.pulse seconds until it runs down
  updateAlarms(dt) {
    for (const col of this.ringing) {
      const g = this.gather.get(col);
      if (!g || g.alarm !== ALARM.RINGING) {
        this.ringing.delete(col);
        continue;
      }
      if ((g.pulseT -= dt) <= 0) {
        g.pulseT = WRECK_ALARM.pulse;
        this.zm.noise(col.x, col.z, WRECK_ALARM.noise);
      }
      if ((g.ringT -= dt) > 0) continue;
      g.alarm = ALARM.SPENT;
      this.ringing.delete(col);
      this.tellAlarm(col, ALARM_SAY.QUIET, g);
    }
  }

  tellAlarm(col, say, g, to = 0) {
    this.emit(
      (w) => {
        w.u8(EVT.WRECK_ALARM);
        w.i16(qpos(col.x));
        w.i16(qpos(col.y0));
        w.i16(qpos(col.z));
        w.u8(say);
        w.u8(say === ALARM_SAY.RING ? Math.max(1, Math.ceil(g.ringT)) : 0);
      },
      to ? { to } : { x: col.x, z: col.z, r: 220 },
    );
  }

  // One wreck's record to everybody: the new hits (or none: only what is left in it changed).
  tellWreck(col, g, hits, flags, to = 0) {
    this.emit(
      (w) => {
        w.u8(EVT.WRECK);
        w.u8(flags);
        w.u8(1);
        this.writeWreck(w, col, g, hits);
      },
      { to },
    );
  }
  writeWreck(w, col, g, hits) {
    w.i16(qpos(col.x));
    w.i16(qpos(col.y0));
    w.i16(qpos(col.z));
    w.u8(Math.max(0, g.left));
    w.u8(hits.length);
    for (const h of hits) {
      w.i16(h[0]);
      w.i16(h[1]);
      w.i16(h[2]);
      w.u8(h[3]);
      w.i8(h[4]);
      w.u8(h[5]);
    }
  }
  // Every wreck that has been hit, as it is, to player id `to` (who joins, or comes back): the whole of each record,
  // and the alarms that are ringing.
  tellWrecks(to) {
    const list = [];
    for (const [col, g] of this.gather) if (g.hits?.length && wreckOf(col)) list.push([col, g]);
    for (let i = 0; i < list.length; i += 16) {
      const part = list.slice(i, i + 16);
      this.emit(
        (w) => {
          w.u8(EVT.WRECK);
          w.u8(WRECKF.REPLAY);
          w.u8(part.length);
          for (const [col, g] of part) this.writeWreck(w, col, g, g.hits);
        },
        { to },
      );
    }
    for (const col of this.ringing) {
      const g = this.gather.get(col);
      if (g) this.tellAlarm(col, ALARM_SAY.RING, g, to);
    }
  }

  // yaw: the way it falls (the game's yaw: toward -sin, -cos)
  fellTree(col, yaw) {
    if (!fellTree(this.world, col)) return;
    this.emit((w) => {
      w.u8(EVT.FELL);
      w.i16(qpos(col.x));
      w.i16(qpos(col.y0));
      w.i16(qpos(col.z));
      w.u8(qangle8(yaw));
    });
  }

  // Which trees and wrecks are used up, to player id `to` (0: everybody). They are colliders of the static world,
  // which every client has built for itself: named by where they stand (client/game/harvest.js keys them the same).
  tellStripped(cols, to = 0) {
    for (let i = 0; i < cols.length; i += 255) {
      const part = cols.slice(i, i + 255);
      this.emit(
        (w) => {
          w.u8(EVT.STRIPPED);
          w.u8(part.length);
          for (const c of part) {
            w.i16(qpos(c.x));
            w.i16(qpos(c.y0));
            w.i16(qpos(c.z));
          }
        },
        { to },
      );
    }
  }

  craft(p, recipeId) {
    const rec = RECIPES[recipeId];
    if (!rec) return;
    if (rec.schem && !(this.unlocked & (1 << SCHEM_BIT[rec.schem]))) return this.notify(NOTIFY.LOCKED, rec.schem, p.id);
    if (rec.station && !this.nearStation(p, rec.station)) return this.notify(rec.station === 'fire' ? NOTIFY.NEED_FIRE : NOTIFY.NEED_BENCH, 0, p.id);
    const plan = this.planFor(p, rec.cost);
    if (!plan) {
      this.notify(NOTIFY.NOT_ENOUGH, 0, p.id);
      return;
    }
    const def = ITEM_DEFS[rec.out];
    // capacity check
    if (def.cat === 'ammo') {
      if (p.state.ammo[def.ammo] >= AMMO_MAX[def.ammo]) return this.notify(NOTIFY.INVENTORY_FULL, rec.out, p.id);
    } else if (def.cat === 'weapon') {
      const slot = WEAPONS[rec.out].slot;
      if (p.state.weapons[slot] && freeSlot(p.inv, invCap(p)) < 0) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
    } else if (!canFit(p.inv, rec.out, rec.n, invCap(p))) {
      // paying may free slots; do a trial
      const copy = p.inv.map((x) => (x ? { ...x } : null));
      payCost(copy, plan.take);
      if (!canFit(copy, rec.out, rec.n, invCap(p))) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
    }
    payCost(p.inv, plan.take);
    const sorting = p.invSort;
    const taken = this.giveItem(p, rec.out, rec.n);
    this.madeExtra(p, plan);
    p.invSort = sorting; // (a craft lands where the client's model of it puts it, bulkcraft.js: it is not a pickup)
    // rounds the reserve has no room for were paid for all the same: they go on the ground instead of nowhere
    if (def.cat === 'ammo' && taken < rec.n) {
      this.dropItem(rec.out, rec.n - taken, p.state.x, p.state.y, p.state.z, { spread: 0.8 });
      this.notify(NOTIFY.INVENTORY_FULL, rec.out, p.id);
    }
    this.track.craft(p, rec);
    this.ach.crafted(p);
    p.invDirty = true;
    this.syncThrow(p);
    this.sound(SOUND.CRAFT, p.state.x, p.state.y + 1, p.state.z, 15);
  }

  // Tear something down for what it is made of (SALVAGE): n of the stack at backpack index `from`, or what is in a
  // weapon slot or worn (SALVAGE_FROM). What comes of it goes into the pack, and at their feet what does not fit.
  salvage(p, from, n) {
    const s = p.state;
    let item = 0;
    let mag = 0; // rounds in a gun's magazine: they go back into the pack
    if (from < INVENTORY_MAX) {
      const it = from < invCap(p) ? p.inv[from] : null;
      if (!it || !SALVAGE[it.item] || n < 1) return;
      item = it.item;
      mag = it.mag || 0; // (a weapon is a stack of one)
      n = takeFrom(p.inv, from, n); // (what is left of that item consolidated)
    } else if (from === SALVAGE_FROM.ARMOR) {
      if (!SALVAGE[p.armorItem]) return;
      item = p.armorItem;
      n = 1;
      p.armorItem = 0;
      p.armor = 0;
      p.armorMax = 0;
    } else {
      // (the throwable slot only points at a stack in the backpack: that is torn down from there)
      const slot = from - SALVAGE_FROM.WEAPON;
      if (slot < 0 || slot > SLOT_BUILD || slot === SLOT_THROW || !SALVAGE[s.weapons[slot]]) return;
      item = s.weapons[slot];
      n = 1;
      mag = slot === SLOT_PRIMARY ? s.mags[0] : slot === SLOT_PISTOL ? s.mags[1] : 0;
      s.weapons[slot] = 0;
      if (slot === SLOT_PRIMARY) s.mags[0] = 0;
      if (slot === SLOT_PISTOL) s.mags[1] = 0;
    }
    p.invDirty = true;
    this.ach.salvaged(p, n);
    for (const k in SALVAGE[item]) this.giveOrDrop(p, +k, SALVAGE[item][k] * n);
    if (mag > 0 && isFirearm(item)) this.giveOrDrop(p, AMMO_ITEMS[WEAPONS[item].ammo], mag);
    this.syncThrow(p);
    this.sound(SOUND.CRAFT, s.x, s.y + 1, s.z, 15, p.id); // (they hear their own at once: Game.uiCallbacks)
  }

  // A weapon out of its slot into the backpack (the inventory's Equipment panel: a click, or a drag onto the grid):
  // into backpack index `to` if that is free, else the first free one (255: any). Onto a weapon for the same slot it
  // is the swap a click on that one makes (useItem). The throwable slot only points at a stack in the backpack: no.
  unequip(p, slot, to) {
    const s = p.state;
    if (slot > SLOT_BUILD || slot === SLOT_THROW) return;
    const wpn = s.weapons[slot];
    if (!wpn) return;
    const there = p.inv[to];
    if (there && WEAPONS[there.item]?.slot === slot) return this.useItem(p, to);
    const cap = invCap(p); // (never into a locked slot: past the capacity)
    const i = to < cap && !there ? to : freeSlot(p.inv, cap);
    if (i < 0) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
    // (it keeps its magazine, as a weapon stored in the backpack does)
    p.inv[i] = { item: wpn, count: 1, mag: slot === SLOT_PRIMARY ? s.mags[0] : slot === SLOT_PISTOL ? s.mags[1] : 0 };
    s.weapons[slot] = 0;
    if (slot === SLOT_PRIMARY) s.mags[0] = 0;
    if (slot === SLOT_PISTOL) s.mags[1] = 0;
    if (s.slot === slot) s.reloadT = 0; // (a reload under way must not finish on an empty hand)
    p.invDirty = true;
  }

  useItem(p, idx) {
    const it = idx < invCap(p) ? p.inv[idx] : null;
    if (!it) return;
    const s = p.state;
    const def = ITEM_DEFS[it.item];
    if (!def) return;
    if (p.downed) return; // (only a teammate gets a downed survivor back up: nothing in their own pack does)
    if (def.cat === 'cons') {
      const c = CONSUMABLES[it.item];
      if (!c || useWasted(it.item, { hp: p.hp, maxHp: p.maxHp, battery: p.battery, downed: p.downed, stamina: s.stamina, exhausted: s.exhausted })) return;
      // The hands go onto it (s.using: no weapon goes off until it is used up or put away, simulatePlayer) from the
      // client's next command on, which is where its prediction has them go: it sends every command it has made
      // before it asks (Game.useConsumable), so that is the one after the newest that has come in. Those still
      // waiting to be run are run without it (processInputs); with none waiting, that is now.
      p.useItem = { item: it.item, t: 0, total: c.time * perkMods(p.perks).useTime, from: (p.recvSeq + 1) & 0xffff, idx };
      if (!p.cmdQueue.length) {
        s.using = 1;
        p.shadow.using = 1; // (the client did the same after the same command: nothing to rebase it on)
      }
      p.hold = null;
      // a can is cracked as the drink starts; the drinker heard their own at once (Game.quickDrink)
      if (c.drink) this.sound(SOUND.DRINK, s.x, s.y + 1.5, s.z, 12, p.id);
      return;
    }
    if (def.cat === 'armor') {
      // the vest taken off goes into the backpack with the points it has left (`mag`, as a stored weapon keeps its
      // magazine), whatever its condition: it is neither made new nor thrown away. No `mag` is a new vest
      p.inv[idx] = p.armorItem && p.armor > 0 ? { item: p.armorItem, count: 1, mag: p.armor } : null;
      p.armorItem = it.item;
      p.armor = it.mag || def.armor;
      p.armorMax = def.armor;
      p.invDirty = true;
      return;
    }
    if (def.cat === 'pack') {
      // on it goes; one worn till now takes its place in the grid (one for another: the capacity stays as it was)
      p.inv[idx] = p.backpackItem ? { item: p.backpackItem, count: 1 } : null;
      p.backpackItem = it.item;
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

  // ACT.WORN: the armor or the backpack being worn (which: WORN.*) taken off into the grid, dropped in front of the
  // player, or salvaged (salvageOf: about half its recipe back). The backpack holds up its own pockets: while
  // anything is in a slot past INVENTORY_SIZE it does not come off at all - spilling them on the ground would be
  // easy to do by accident in a fight.
  wornGear(p, which, what) {
    const pack = which === WORN.BACKPACK;
    const item = pack ? p.backpackItem : which === WORN.ARMOR ? p.armorItem : 0;
    if (!item) return;
    if (pack && p.inv.some((x, i) => x && i >= INVENTORY_SIZE)) return this.notify(NOTIFY.POCKETS, 0, p.id);
    const s = p.state;
    const mag = pack ? 0 : Math.ceil(p.armor); // (a vest keeps its points, as one taken off for another does)
    if (what === WORN_DO.OFF) {
      // into a slot it can stay in: with the backpack off, one past INVENTORY_SIZE is a locked one
      const i = freeSlot(p.inv, pack ? INVENTORY_SIZE : invCap(p));
      if (i < 0) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
      p.inv[i] = pack ? { item, count: 1 } : { item, count: 1, mag };
    } else if (what === WORN_DO.DROP) {
      const ex = s.x - Math.sin(s.yaw) * 1.1;
      const ez = s.z - Math.cos(s.yaw) * 1.1;
      // (no entity id left for it on the ground: it stays on)
      const dropped = this.dropItem(item, 1, ex, s.y, ez, { spread: 0.2, mag: mag || undefined, from: s });
      if (!dropped) return;
      p.lastDrop = { e: dropped, t: this.time };
    } else if (what !== WORN_DO.SALVAGE || !salvageOf(item)) return;
    if (pack) p.backpackItem = 0;
    else p.armorItem = p.armor = p.armorMax = 0;
    // (taken off before what it gives back is handed over: none of it may land in pockets that are gone)
    if (what === WORN_DO.SALVAGE) {
      const back = salvageOf(item);
      for (const k in back) this.giveOrDrop(p, +k, back[k]);
      this.sound(SOUND.CRAFT, s.x, s.y + 1, s.z, 15);
    }
    p.invDirty = true;
  }

  // ACT.UNDO_DROP: the last thing this survivor put down from the inventory (p.lastDrop) back in their hands, as a
  // pickup of it would put it there. Only their own last drop, within UNDO_DROP_TIME, while it still lies there (a
  // teammate may have taken it, or some of it) and they are within UNDO_DROP_REACH of it. What finds no room stays down.
  undoDrop(p) {
    const d = p.lastDrop;
    p.lastDrop = null;
    if (!d) return;
    const e = d.e;
    if (e.removed || e.count <= 0) return this.notify(NOTIFY.UNDO_GONE, UNDO_NO.GONE, p.id);
    if (this.time - d.t > UNDO_DROP_TIME) return this.notify(NOTIFY.UNDO_GONE, UNDO_NO.LATE, p.id);
    const s = p.state;
    if (Math.hypot(e.x - s.x, e.z - s.z) > UNDO_DROP_REACH) return this.notify(NOTIFY.UNDO_GONE, UNDO_NO.FAR, p.id);
    const taken = this.giveItem(p, e.item, e.count, e.mag);
    if (taken <= 0) return this.notify(NOTIFY.INVENTORY_FULL, ITEM_DEFS[e.item]?.cat === 'ammo' ? e.item : 0, p.id);
    this.pickupEvent(p, e.item, taken);
    e.count -= taken;
    if (e.count <= 0) this.removeItemEnt(e);
  }

  // An item use over, done or not: the hands are free again. (The simulation's `using` is never sent on its own: the
  // client reads it off the item in use in the status (writeSelf), which only names one while `using` is up. So the
  // use is never dropped without it: here, or the simulation's 'use_cancel', which put it down first)
  endUse(p) {
    p.useItem = null;
    p.state.using = 0;
  }

  finishUse(p) {
    const u = p.useItem;
    this.endUse(p);
    p.state.switchT = DRAW_TIME; // the weapon comes back out
    if (countItem(p.inv, u.item) <= 0) return;
    const c = CONSUMABLES[u.item];
    // from the stack it was taken from (the one clicked in the grid; [H] and [B] ask for the smallest, as removeItem
    // takes), if that still holds it, and what is left consolidated either way
    if (p.inv[u.idx]?.item === u.item) takeFrom(p.inv, u.idx, 1);
    else removeItem(p.inv, u.item, 1);
    this.track.used(p, u.item);
    p.invDirty = true;
    if (c.heal) p.hp = Math.min(p.maxHp, p.hp + c.heal);
    if (c.stamina) {
      p.state.stamina = 100;
      p.state.exhausted = 0;
    }
    if (c.flashlight) p.battery = FLASHLIGHT_MAX;
    if (!c.drink) this.sound(c.food ? SOUND.EAT : SOUND.HEAL, p.state.x, p.state.y + 1, p.state.z, 12);
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
    // on the ground of the level the builder is on: down in the mine the floor of the drift, never the rock beside
    // it, and nothing is put up on one level from the other
    const mine = this.world.mine;
    let y = this.world.floorAt(x, z, s.y + 0.5);
    const down = !!mine && mine.under(x, y + 0.3, z);
    if (mine && (down !== mine.under(s.x, s.y + 0.3, s.z) || (down && mine.sdf(x, z) > -0.3))) return fail();
    let door = null;
    if (def.snap === 'door') {
      door = this.world.openingNear(x, z, 1.4);
      if (!door) return fail(NOTIFY.DOOR_ONLY);
      x = door.x;
      z = door.z;
      y = door.y;
      rot8 = Math.round((((door.ry % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 256) & 255;
    }
    // the client's ghost reaches BUILD_REACH from where that client stands; we see the player a moment earlier
    if (Math.hypot(x - s.x, z - s.z) > BUILD_REACH + INTERACT_SLACK + (door ? 1 : 0)) return fail();
    const car = this.world.car;
    if (Math.hypot(x - car.x, z - car.z) < 3.2) return fail();
    if (this.world.isDeepWater(x, z)) return fail();
    const plan = this.planFor(p, def.cost);
    if (!plan) return fail(NOTIFY.NOT_ENOUGH);
    const col = this.structCollider(type, x, y, z, rot8, 0);
    // overlaps: static world, other blocking structures, players
    const tmp = [];
    if (!door) {
      this.world.staticGrid.query(x, z, col.r + 0.2, tmp);
      for (const o of tmp) {
        if (o.y1 < y + 0.2 || (down && o.y0 > y + def.sy + 0.5)) continue; // (what stands on the ground over a drift is not in the way down there)
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
    if (!this.spawnEntity(e)) return fail(); // (no entity id left: nothing is built, so nothing is paid)
    payCost(p.inv, plan.take);
    this.madeExtra(p, plan);
    p.invDirty = true;
    e.collider = this.structCollider(type, x, y, z, rot8, e.id);
    this.world.structGrid.add(e.collider);
    this.nav.addStructure(e.collider);
    this.structures.push(e);
    this.track.build(p, type);
    if (type === STRUCT.WORKBENCH) this.globalDirty = true;
    this.sound(SOUND.BUILD, x, y + 0.8, z, 35);
    this.zm.noise(x, z, NOISE.BUILD, y);
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
      if (n <= 0) continue;
      const taken = this.giveItem(p, +k, n);
      if (taken < n) this.dropItem(+k, n - taken, e.x, e.y, e.z); // only what did not fit, not the whole refund again
    }
    this.power.demolished(p, e); // (what is left in a generator's tank comes back)
    p.invDirty = true;
    this.destroyStructure(e, false);
  }

  repair(p, id) {
    const e = this.ents[id];
    if (!e || e.kind !== ENT.STRUCTURE) return;
    const s = p.state;
    const hammer = s.weapons[SLOT_BUILD] === ITEM.HAMMER;
    if (Math.hypot(e.x - s.x, e.z - s.z) > 4.5) return;
    if (e.stype === STRUCT.CAMPFIRE) {
      if (hammer) this.feedFire(p, e);
      return;
    }
    if (e.hp >= e.maxHp && !(e.stype === STRUCT.TORCH && e.burnLeft <= 0)) return;
    if (this.time - p.actionT < 0.6) return;
    if (!hammer || s.slot !== SLOT_BUILD) return this.notify(NOTIFY.NEED_HAMMER, 0, p.id); // (the hammer in hand, not just carried)
    if (e.stype === STRUCT.TORCH) {
      if (countItem(p.inv, ITEM.CLOTH) < 1) return this.notify(NOTIFY.NOT_ENOUGH, ITEM.CLOTH, p.id);
      removeItem(p.inv, ITEM.CLOTH, 1);
      e.burnLeft = STRUCT_DEFS[STRUCT.TORCH].burn;
      e.hp = e.maxHp;
    } else {
      const plan = this.planFor(p, REPAIR_COST);
      if (!plan) return this.notify(NOTIFY.NOT_ENOUGH, 0, p.id);
      payCost(p.inv, plan.take);
      this.madeExtra(p, plan);
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.35);
    }
    p.actionT = this.time;
    p.invDirty = true;
    this.sound(SOUND.BUILD, e.x, e.y + 0.8, e.z, 30);
    this.zm.noise(e.x, e.z, NOISE.BUILD, e.y);
  }

  damageStructure(e, amount) {
    if (e.removed) return;
    e.hp -= amount;
    this.sound(STRUCT_DEFS[e.stype].metal ? SOUND.METAL_HIT : SOUND.WOOD_HIT, e.x, e.y + 1, e.z, 40);
    if (e.hp <= 0) this.destroyStructure(e, true);
  }

  destroyStructure(e, broken) {
    if (e.removed) return;
    this.world.structGrid.remove(e.collider);
    this.nav.removeStructure(e.collider);
    this._listRemove(this.structures, e);
    if (e.stype === STRUCT.WORKBENCH) this.globalDirty = true;
    if (broken) {
      if (this.phase === PHASE.NIGHT) this.nightStats.structLost++;
      this.track.structureLost(e);
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
      this.sound(STRUCT_DEFS[e.stype].metal ? SOUND.METAL_HIT : SOUND.WOOD_BREAK, e.x, e.y + 1, e.z, 70);
    }
    this.removeEntity(e);
  }

  // ---------------------------------------------------------------- damage (players)
  damagePlayer(p, amount, src) {
    if (!p.alive || amount <= 0 || p.away) return; // (dropped and held: nothing hurts them until they are back)
    if (this.godMode && !p.zombie) return;
    if (this.phase !== PHASE.DAY && this.phase !== PHASE.NIGHT) return;
    // The dead, a fall, the lake. Not a player's own bomb: that should do what the player threw it to do.
    if (!p.zombie && src && (src.kind === KILLER.ZOMBIE || src.kind === KILLER.WORLD)) amount *= this.diff.hurt;
    if (!p.zombie) amount *= perkMods(p.perks).hurt;
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
    this.track.hurt(p, amount, src);
    p.hp -= amount;
    p.lastDamageT = this.time;
    p.lastSrc = src;
    // Second Chance (a keystone perk): once a night the blow that would have put them down leaves them standing
    if (p.hp <= 0 && !p.zombie && !p.lastChance && perkMods(p.perks).secondChance) {
      p.lastChance = true;
      p.hp = 1;
      this.sendChat(p, 0, CHATF.SYSTEM, 'Second Chance: you are still standing. Get clear.');
    }
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
      if (!p.zombie && this.standing() > 1) this.goDown(p);
      else this.killPlayer(p, src);
    }
  }

  goDown(p) {
    p.downed = true;
    p.hp = 0;
    p.bleed = DOWN_TIME * this.diff.down;
    this.endUse(p);
    p.hold = null;
    p.revivedBy = 0;
    this.releaseHolds(p);
    const s = p.state;
    s.downed = 1;
    s.sprinting = 0;
    if (s.weapons[SLOT_PISTOL] && s.slot !== SLOT_PISTOL && s.slot !== SLOT_RADIO) {
      s.slot = SLOT_PISTOL;
      s.reloadT = 0; // a reload in progress was of the weapon just put away: left running it locks the pistol, then reloads it
    }
    this.nightStats.downs++;
    this.track.down(p);
    this.notify(NOTIFY.DOWNED, p.id);
    this.sound(SOUND.DOWNED, s.x, s.y + 0.6, s.z, 70);
    this.playersDirty = true;
    this.checkAllDead();
  }

  revive(p, by, hp = REVIVE_HP) {
    if (!p.downed) return;
    this.track.revive(p, by);
    this.ach.revive(p, by);
    p.downed = false;
    p.state.downed = 0;
    p.hp = Math.min(p.maxHp, hp + (by ? perkMods(by.perks).reviveHp : 0));
    if (by && by !== p && ++by.nightRevives <= XP.revivesFull) this.award(by, XPS.revives, XP.revive * perkMods(by.perks).reviveXp);
    if (by && by !== p && by.alive && !by.downed && !by.zombie) by.hp = Math.min(by.maxHp, by.hp + perkMods(by.perks).reviveSelf);
    p.bleed = 0;
    p.revivedBy = 0;
    p.lastDamageT = this.time;
    this.nightStats.revives++;
    this.notify(NOTIFY.REVIVED, p.id);
    this.sound(SOUND.REVIVE, p.state.x, p.state.y + 1, p.state.z, 30);
    if (by) this.credit([by], 'revives');
    this.playersDirty = true;
  }

  killPlayer(p, src, silent = false) {
    this.track.death(p, src, silent); // (first: what they were when it came)
    this.ach.death(p, src);
    p.hp = 0;
    p.alive = false;
    p.deaths++;
    this.endUse(p);
    p.hold = null;
    p.downed = false;
    p.state.downed = 0;
    this.releaseHolds(p);
    const s = p.state;
    s.vx = s.vy = s.vz = 0;
    if (src.kind === KILLER.PLAYER) {
      const k = this.players.get(src.id);
      if (k) {
        k.kills++;
        if (p.zombie) this.credit([k], 'kills'); // a turned player put down. (A survivor killed by one is on nobody's record)
      }
    }
    this.killfeed(src.kind || KILLER.WORLD, src.kind === KILLER.PLAYER ? src.id : src.ztype ?? 0, p.id, src.weapon || 0, (src.headshot ? 1 : 0) | (p.zombie ? 2 : 0) | (src.drown ? 4 : 0));
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
    // Old clients may still send `/admin <password>`; consume it so a former secret is never broadcast as chat.
    if (/^\/admin(?:\s|$)/i.test(text)) return this.sendChat(p, 0, CHATF.SYSTEM, 'Admin access comes from your signed-in account.');
    if (p.admin && text.startsWith('/')) {
      const args = text.slice(1).split(/\s+/);
      this.track.event('admin', p, { command: args.join(' ').slice(0, 60) }); // (a match with these in it is no ordinary one)
      return this.debugCommand(p, args);
    }
    if (this.time - p.chatT > 5) {
      p.chatT = this.time;
      p.chatCount = 0;
    }
    if (++p.chatCount > 6) return;
    // only those in earshot hear it, and everyone else too when it was said with the walkie-talkie in hand
    const base = p.zombie ? CHATF.ZOMBIE : 0;
    const radio = this.radioInHand(p);
    if (radio) this.ach.onAir(p);
    const s = p.state;
    let heard = 0;
    for (const q of this.players.values()) {
      if (q === p) continue;
      const d = Math.hypot(q.state.x - s.x, q.state.y - s.y, q.state.z - s.z);
      let flags = base;
      if (d > TALK_CLEAR) {
        if (radioLinked(radio, this.hasWalkie(q))) flags |= CHATF.RADIO;
        else if (d <= TALK_RANGE) flags |= CHATF.FAINT;
        else continue;
      }
      this.sendChat(q, p.id, flags, text);
      heard++;
    }
    this.sendChat(p, p.id, heard || this.players.size < 2 ? base : base | CHATF.UNHEARD, text);
  }
  sendChat(to, id, flags, text) {
    const w = new Writer(text.length * 3 + 8);
    w.u8(S2C.CHAT);
    w.u16(id);
    w.u8(flags);
    w.str(text);
    to.session.conn.send(w.bytes());
  }
  // every survivor carries a walkie-talkie (SLOT_RADIO; the dead and the turned have none)...
  hasWalkie(p) {
    return p.alive && !p.zombie;
  }
  // ...chat said with it in hand goes out over it...
  radioInHand(p) {
    return this.hasWalkie(p) && p.state.slot === SLOT_RADIO;
  }
  // ...and while it is keyed, so does the voice (the clients route it, told by the player list: PLF.ON_AIR)
  onAir(p) {
    return this.hasWalkie(p) && radioKeyed(p.state);
  }
  debugCommand(p, args) {
    const s = p.state;
    const [x0, z0] = [s.x, s.z];
    switch (args[0]) {
      case 'kill':
        if (p.alive) this.killPlayer(p, { kind: KILLER.WORLD });
        break;
      case 'down':
        if (p.alive && !p.zombie && !p.downed) this.goDown(p);
        break;
      case 'xp': {
        // /xp <n>: that much XP onto their record (progress.js), outside this run's tally: for trying levels and perks
        const n = Math.max(0, Math.min(1e6, Math.floor(+args[1] || 0)));
        if (!n) return this.sendChat(p, 0, CHATF.SYSTEM, 'Usage: /xp <amount>');
        p.xpBase += n;
        this.records.bump(p.rec, 'xp', n);
        p.progDirty = true;
        this.playersDirty = true;
        this.sendChat(p, 0, CHATF.SYSTEM, `+${n} XP: level ${this.levelOf(p)}${p.rec ? '' : ' (not kept: you have no record)'}.`);
        break;
      }
      case 'night':
        if (this.phase === PHASE.DAY) this.timeLeft = 0.05;
        break;
      case 'step':
        // /step on | off | <n>: hold this game's clock (room-worker.js runs a tick only when one is asked for), let
        // it go, or run n ticks while it is held. For filming a client frame by frame (scripts/clip/nunchaku-film.js):
        // a frame can take a second to draw and save, and the world must not run on meanwhile. Let go by itself
        // after 20 s with nothing asked (STEP_IDLE), so a game is never left standing
        if (args[1] === 'on') this.stepMode = true;
        else if (args[1] === 'off') this.stepMode = false;
        else if (this.stepMode) this.stepCredit = Math.min(200, this.stepCredit + Math.max(1, Math.floor(+args[1] || 1)));
        this.stepAsked = performance.now();
        break;
      case 'day':
        if (this.phase === PHASE.NIGHT) this.timeLeft = 0.05;
        break;
      case 'dusk':
        // /dusk [s]: to 5 s (or that many) before nightfall. The horn sounds at once; today's supply drops still to
        // come are skipped rather than all landing together
        if (this.phase === PHASE.DAY) {
          this.timeLeft = Math.max(0.05, +args[1] || 5);
          this.supplyAt.length = 0;
          this.globalDirty = true;
        }
        break;
      case 'dawn':
        // /dawn [s]: to 5 s (or that many) before daybreak. Tonight's waves still to come are skipped rather than all
        // starting together
        if (this.phase === PHASE.NIGHT) {
          this.timeLeft = Math.max(0.05, +args[1] || 5);
          for (const wv of this.waves) {
            if (wv.started) continue;
            wv.started = true;
            wv.queue.length = 0;
          }
          this.globalDirty = true;
        }
        break;
      case 'give': {
        // /give <item> [n]: the item by name or id (see findNamed); /items lists the names
        const words = args.slice(1);
        const n = words.length > 1 && /^\d+$/.test(words[words.length - 1]) ? +words.pop() : 1;
        const found = findNamed(ITEM_NAMES, words.join(' '));
        if (found.length !== 1) {
          this.sendChat(p, 0, CHATF.SYSTEM, found.length ? `which one: ${found.map((it) => it.name).join(', ')}?` : `no item called "${words.join(' ')}" (/items lists them)`);
          break;
        }
        const taken = this.giveItem(p, found[0].id, n);
        p.invDirty = true;
        this.sendChat(p, 0, CHATF.SYSTEM, `gave ${taken} x ${ITEM_DEFS[found[0].id].name}`);
        break;
      }
      case 'items': {
        // /items [text]: the names /give takes, by category (only the ones containing `text`)
        const k = itemKey(args.slice(1).join(' '));
        for (const cat in ITEM_CAT_LABELS) {
          const names = ITEM_NAMES.filter((it) => ITEM_DEFS[it.id].cat === cat && (!k || it.keys.some((key) => key.includes(k)))).map((it) => it.name);
          if (names.length) this.sendChat(p, 0, CHATF.SYSTEM, `${ITEM_CAT_LABELS[cat]}: ${names.join(' ')}`);
        }
        break;
      }
      case 'spawn': {
        // /spawn <type> [n]: up to 20 of a zombie type, by name or id (see findNamed), 12 m ahead; /zombies lists the names
        const words = args.slice(1);
        const n = Math.min(20, words.length > 1 && /^\d+$/.test(words[words.length - 1]) ? +words.pop() : 1);
        const found = findNamed(ZOMBIE_NAMES, words.join(' '));
        if (found.length !== 1) {
          this.sendChat(p, 0, CHATF.SYSTEM, found.length ? `which one: ${found.map((it) => it.name).join(', ')}?` : `no zombie called "${words.join(' ')}" (/zombies lists them)`);
          break;
        }
        const t = found[0].id;
        const pack = this.zm.newPack();
        let made = 0;
        for (let i = 0; i < n; i++) if (this.zm.spawn(t, s.x - Math.sin(s.yaw) * 12 + (this.rng() - 0.5) * 4, s.z - Math.cos(s.yaw) * 12 + (this.rng() - 0.5) * 4, { horde: true, boss: ZOMBIE_DEFS[t].boss, pack })) made++;
        this.sendChat(p, 0, CHATF.SYSTEM, `spawned ${made} x ${ZOMBIE_DEFS[t].name}`);
        break;
      }
      case 'zombies':
        // the names /spawn takes
        this.sendChat(p, 0, CHATF.SYSTEM, `zombies: ${ZOMBIE_NAMES.map((it) => it.name).join(' ')}`);
        break;
      case 'clear': {
        // /clear [m]: every one of the dead within that many metres (default 80) drops where it stands, to nobody's credit
        const r = +args[1] || 80;
        for (const z of [...this.zombies]) if (!z.dead && Math.hypot(z.x - s.x, z.z - s.z) <= r) this.combat.killZombie(z, null);
        break;
      }
      case 'legs': {
        // /legs [1|2]: shoot that many legs (default both) off every zombie within 30 m that has legs to lose
        const n = args[1] === '1' ? 1 : 2;
        for (const z of this.zombies) {
          if (z.dead || !z.legHp || Math.hypot(z.x - s.x, z.z - s.z) > 30) continue;
          for (let i = 0; i < n && z.legs !== 3; i++) this.combat.hitLeg(z, z.maxHp, 1, z.x - s.x, z.z - s.z);
        }
        break;
      }
      case 'den': {
        // teleport 15 m from the nearest zombie dog pack's den (dense forest)
        let best = null;
        for (const z of this.zombies) {
          if (z.dead || !z.pack || z.horde) continue;
          if (!best || Math.hypot(z.homeX - s.x, z.homeZ - s.z) < Math.hypot(best.homeX - s.x, best.homeZ - s.z)) best = z;
        }
        if (best) {
          const a = this.rng() * Math.PI * 2;
          s.x = best.homeX + Math.sin(a) * 15;
          s.z = best.homeZ + Math.cos(a) * 15;
          s.y = groundAt(this.world, s.x, s.z, 200, 0.3);
          s.vx = s.vy = s.vz = 0;
          this.fillHistory(p);
        }
        break;
      }
      case 'herd': {
        // teleport 45 m from the wandering herd (just out of its sight)
        const h = this.zm.herds.first();
        if (h) {
          const a = this.rng() * Math.PI * 2;
          s.x = h.cx + Math.sin(a) * 45;
          s.z = h.cz + Math.cos(a) * 45;
          s.y = groundAt(this.world, s.x, s.z, 200, 0.3);
          s.vx = s.vy = s.vz = 0;
          this.fillHistory(p);
        }
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
      case 'airdrop':
        this.spawnSupplyDrop();
        break;
      case 'parts':
        this.supplies = this.sup.need.slice();
        this.globalDirty = true;
        break;
      case 'engine':
        this.supplies = this.sup.need.slice();
        this.startEngine(p);
        break;
      case 'unlock':
        for (const it of SCHEMATICS) this.unlockSchematic(it, null);
        break;
      case 'cross':
      case 'cutscene':
        // /cross (or /cutscene) [skip | hold | go]: the car is away, as if the final stand was won and somebody drove
        // - the crossing to the mainland, with its cutscene, or straight there. From the end screen or the mainland
        // a new run on the island is begun first. hold: the cutscene's clock stops (for looking at it) - first on
        // the island, before the worlds change, then after /cross go short of its end, and after another it runs out
        if (args[1] === 'go' && this.crossing) this.crossing.hold = Math.max(0, (this.crossing.hold | 0) - 1);
        else if (this.phase === PHASE.CROSSING) this.sendChat(p, 0, CHATF.SYSTEM, 'the crossing is already on');
        else {
          if (this.act !== WORLD.ISLAND || (this.phase !== PHASE.DAY && this.phase !== PHASE.NIGHT)) {
            this.checkpoint = null; // (a wipe on the mainland would start again at the bridge, not on the island)
            this.startGame();
          }
          this.cross(p, this.phase === PHASE.NIGHT);
          if (args[1] === 'skip') this.arrive();
          else if (args[1] === 'hold') this.crossing.hold = 2;
          this.sendChat(p, 0, CHATF.SYSTEM, args[1] === 'skip' ? `on the mainland (map 2): day ${this.day}` : 'the crossing to the mainland (map 2) has begun');
        }
        break;
      case 'map2':
      case 'mainland':
        // /map2: straight to the first day on the mainland, from anywhere on the island (the end screen too: a new
        // run is begun first), with no cutscene and no XP for the escape. Mid-crossing, the crossing is cut short
        if (this.act === WORLD.MAINLAND && this.phase !== PHASE.CROSSING) {
          this.sendChat(p, 0, CHATF.SYSTEM, 'already on the mainland (map 2)');
          break;
        }
        if (this.phase !== PHASE.CROSSING) {
          if (this.phase !== PHASE.DAY && this.phase !== PHASE.NIGHT) this.startGame();
          this.cross(p, false, false);
        }
        this.arrive();
        this.sendChat(p, 0, CHATF.SYSTEM, `on the mainland (map 2): day ${this.day}`);
        break;
      case 'takeoff':
        // /takeoff [hold | go]: the plane goes, now (the run's last shot, and the victory). hold: the clock that ends
        // the game stops (for looking at it) - first at the start of the take-off, then after /takeoff go with the end
        // screen up, and after another it runs out
        if (args[1] === 'go' && this.takeoffHold) {
          this.takeoffHold--;
          if (this.takeoffHold) this.restartT = GAME_OVER_DELAY + 6; // (the take-off is over: the end screen)
          this.globalDirty = true;
        } else if (this.act === WORLD.MAINLAND && (this.phase === PHASE.DAY || this.phase === PHASE.NIGHT)) {
          this.supplies = this.sup.need.slice();
          this.victory();
          if (args[1] === 'hold') this.takeoffHold = 2;
        }
        break;
      case 'place': {
        // /place <zone id>: to the middle of that place of this map (the mainland's: 27 the bridgehead .. 34)
        const zn = this.world.zoneById[+args[1]];
        if (zn) {
          s.x = zn.x;
          s.z = zn.z - 3;
          s.y = groundAt(this.world, s.x, s.z, 200, 0.3);
          s.vx = s.vy = s.vz = 0;
          this.fillHistory(p);
        }
        break;
      }
      case 'plane':
        // /plane: to the plane (the car, on the island), with every part of it in the backpack
        s.x = this.world.car.x - 6;
        s.z = this.world.car.z + 2;
        s.y = groundAt(this.world, s.x, s.z, 200, 0.3);
        s.vx = s.vy = s.vz = 0;
        this.fillHistory(p);
        this.sup.items.forEach((it, i) => this.giveItem(p, it, this.sup.need[i] - this.supplies[i]));
        break;
      case 'wipe':
        // /wipe: every survivor dies (the checkpoint at the bridge is what a wipe on the mainland goes back to)
        for (const q of [...this.players.values()]) if (q.alive && !q.zombie) this.killPlayer(q, { kind: KILLER.WORLD }, true);
        this.checkAllDead();
        break;
      case 'tp': {
        // /tp x z [y]: onto whatever is highest there, or with a height onto what is under feet at it (down a drift)
        const x = +args[1];
        const z = +args[2];
        if (Number.isFinite(x) && Number.isFinite(z)) {
          s.x = x;
          s.z = z;
          s.y = groundAt(this.world, x, z, Number.isFinite(+args[3]) && args[3] !== undefined ? +args[3] : 200, 0.3);
          s.vx = s.vy = s.vz = 0;
          this.fillHistory(p);
        }
        break;
      }
      case 'mine': {
        // /mine: to the adit of Blackrock Mine. /mine far: to the far portal. /mine in: down to the junction
        const mine = this.world.mine;
        if (!mine) {
          this.systemChat('this valley has no workings under its mine');
          break;
        }
        const pt = mine.portals[args[1] === 'far' ? 1 : 0];
        const rm = mine.rooms[0];
        [s.x, s.z] = args[1] === 'in' ? [rm.x + 2.5, rm.z] : [pt.x - pt.dx * 4.5, pt.z - pt.dz * 4.5];
        s.y = groundAt(this.world, s.x, s.z, args[1] === 'in' ? rm.y + 0.2 : 200, 0.3);
        s.vx = s.vy = s.vz = 0;
        this.fillHistory(p);
        break;
      }
      case 'clinic': {
        // /clinic: to the front door of Mercy Clinic. /clinic ward: into its dark wards
        const c = this.world.clinic;
        if (!c) {
          this.systemChat('this valley has no Mercy Clinic');
          break;
        }
        const at = args[1] === 'ward' ? c.ward : c.door;
        [s.x, s.z] = [at.x, at.z];
        s.y = groundAt(this.world, s.x, s.z, c.y + 0.3, 0.3); // (from above, the ground in a ward is its roof)
        s.vx = s.vy = s.vz = 0;
        this.fillHistory(p);
        break;
      }
      case 'depot':
      case 'train': {
        // /depot: to the front of the station house at Whitlock Depot. /train: onto the loading bank beside the
        // freight train stalled on the line
        const spot = this.world.rail?.spots[args[0]];
        if (!spot) {
          this.systemChat(`this valley has no ${args[0]}`);
          break;
        }
        [s.x, s.z] = spot;
        s.y = groundAt(this.world, s.x, s.z, 200, 0.3);
        s.vx = s.vy = s.vz = 0;
        this.fillHistory(p);
        break;
      }
      case 'gun':
        // /gun: to the grips of the mounted gun (at the Army Checkpoint, until somebody carries it off)
        if (this.gun.teleport(p)) this.fillHistory(p);
        else this.systemChat('this valley has no Army Checkpoint, so no mounted gun (a new game deals a new valley)');
        break;
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
      case 'deer': {
        // /deer: to 34 m from the nearest group of deer (out of what startles them). /deer spawn [m]: a group 20 m
        // ahead (or that many), which lets you stand there for ten seconds before it notices you
        if (args[1] === 'spawn') {
          const d = Math.max(4, Math.min(60, +args[2] || 20));
          const gr = this.dm.spawnAhead(s.x, s.z, s.yaw, d);
          this.sendChat(p, 0, CHATF.SYSTEM, gr ? `${gr.members.length} deer ${d} m ahead` : 'no room for deer there');
          break;
        }
        const gr = this.dm.nearest(s.x, s.z);
        if (!gr) {
          this.sendChat(p, 0, CHATF.SYSTEM, 'no deer in the valley');
          break;
        }
        // from the side you came from, on ground you can stand on
        const a0 = Math.atan2(s.x - gr.cx, s.z - gr.cz);
        for (let k = 0; k < 16; k++) {
          const a = a0 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.39;
          const x = gr.cx + Math.sin(a) * 34;
          const z = gr.cz + Math.cos(a) * 34;
          if (!this.dm.open(x, z) && k < 15) continue;
          s.x = x;
          s.z = z;
          break;
        }
        s.y = groundAt(this.world, s.x, s.z, 200, 0.3);
        s.vx = s.vy = s.vz = 0;
        this.fillHistory(p);
        const b = Math.atan2(gr.cx - s.x, -(gr.cz - s.z));
        this.sendChat(p, 0, CHATF.SYSTEM, `${gr.members.length} deer 34 m to the ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / (Math.PI / 4)) & 7]}`);
        break;
      }
      case 'fair':
        // /fair: to the gate of the Tri-County Fair. /fair on | off: its generator. /fair wheel | carousel: onto a ride
        this.fair.debug(p, args[1]);
        break;
      case 'where':
        this.systemChat(`pos ${s.x.toFixed(1)} ${s.y.toFixed(1)} ${s.z.toFixed(1)} zone ${this.world.zoneAt(s.x, s.z)}`);
        break;
      case 'alarm': {
        // /alarm: the nearest wreck that can have one has a live battery (its next hard blow makes it chirp).
        // /alarm ring: it goes off now
        let best = null;
        for (const col of this.world.staticGrid.query(s.x, s.z, 12, [])) {
          const prop = wreckOf(col);
          if (!prop || !WRECK_ALARM.types.includes(prop.type)) continue;
          if (!best || Math.hypot(col.x - s.x, col.z - s.z) < Math.hypot(best.x - s.x, best.z - s.z)) best = col;
        }
        if (!best) break;
        let g = this.gather.get(best);
        if (!g) this.gather.set(best, (g = { left: WRECK_SALVAGE }));
        g.alarm = ALARM.LIVE;
        if (args[1] === 'ring') {
          g.alarm = ALARM.RINGING;
          g.ringT = WRECK_ALARM.ring;
          g.pulseT = 0;
          this.ringing.add(best);
          this.tellAlarm(best, ALARM_SAY.RING, g);
        }
        break;
      }
      case 'bell':
      case 'radio':
        // /bell: the chapel bell tolls now, wherever you are. /radio: to the Relay Station's radio, with the batteries
        this.fixtures.debug(p, args);
        break;
      case 'cemetery':
        // /cemetery: to the gate of St. Agnes Cemetery. /cemetery rise [n]: the nearest n graves give up their dead now
        this.cemetery.debug(p, args);
        break;
      case 'floodlight':
        // the materials for one generator and two floodlights, and a full tank of fuel
        this.power.give(p);
        break;
      case 'handcar':
        // /handcar [n]: onto handcar n on the railway (1, 2), or the first one nobody is on
        this.handcars.debug(p, args[1]);
        break;
    }
    // a command that took the player somewhere takes them out of a fair ride's seat, or the ride carries them back
    // (and off a handcar, which would too)
    if (s.ride && args[0] !== 'fair' && (s.x !== x0 || s.z !== z0)) s.ride = 0;
    if (s.cart && args[0] !== 'handcar' && (s.x !== x0 || s.z !== z0)) s.cart = 0;
    this.systemChat(`[debug] ${args.join(' ')}`);
  }

  systemChat(text) {
    const w = new Writer(text.length * 3 + 8);
    w.u8(S2C.CHAT);
    w.u16(0);
    w.u8(CHATF.SYSTEM);
    w.str(text);
    this.broadcast(w.bytes());
  }
  broadcast(bytes) {
    for (const p of this.players.values()) p.session.conn.send(bytes);
  }

  // ---------------------------------------------------------------- tick
  // (the ts.mark after each group of calls times it as one section of the tick: see tickstats.js)
  update() {
    const ts = this.tickStats;
    ts.begin();
    usePos(this.world); // (positions in everything this tick sends are in this world's units: protocol.js)
    this.tick++;
    const dt = SERVER_DT;
    this.time += dt;
    // release quarantined ids
    while (this.quarantine.length && this.quarantine[1] <= this.tick) {
      this.freeIds.push(this.quarantine[0]);
      this.quarantine.splice(0, 2);
    }
    // forget the join allowances that have worn off (see allow)
    if (this.tick % 600 === 0) for (const [ip, a] of this.joins) if (this.time - a.t >= a.n * JOIN_EVERY) this.joins.delete(ip);
    // the held whose minute is up are gone (hold)
    if (this.tick % SERVER_TICK_RATE === 0)
      for (const p of [...this.players.values()])
        if (p.away && this.time - p.away.since >= p.away.grace) {
          this.log(`hold ${p.name}: did not come back`);
          this.removePlayer(p);
        }
    if (this.phase === PHASE.WAITING) {
      if (this.rollWhenEmpty) this.rollWorld(); // (the valley for the next run, once the last one has emptied: see resetToWaiting)
      this.processInputs();
      ts.mark(T_INPUTS);
      this.sendSnapshots();
      ts.mark(T_SNAPSHOTS);
      this.endTick();
      return;
    }
    // the crossing: nobody acts, nothing walks. The mainland is built in its first tick, then the clock runs out
    if (this.phase === PHASE.CROSSING) {
      this.buildMainland();
      for (const p of this.players.values()) this.drainInputs(p);
      ts.mark(T_INPUTS);
      const prev = Math.ceil(this.timeLeft);
      this.timeLeft -= dt;
      if (this.crossing.hold) this.timeLeft = Math.max(this.timeLeft, this.crossing.hold === 2 ? CROSSING.TIME - 2 : 4); // (/cross hold: look-dev)
      if (Math.ceil(this.timeLeft) !== prev) this.globalDirty = true;
      const [got, need] = this.skipVotes();
      if (this.timeLeft <= 0 || (need > 0 && got >= need && CROSSING.TIME - this.timeLeft >= CROSSING.SKIP_AFTER)) this.arrive();
      this.recordHistory();
      ts.mark(T_PHASE);
      this.sendSnapshots();
      ts.mark(T_SNAPSHOTS);
      this.endTick();
      return;
    }
    this.processInputs();
    this.fair.update();
    this.handcars.update();
    ts.mark(T_INPUTS);
    this.updatePhase(dt);
    this.cemetery.update(dt);
    ts.mark(T_PHASE);
    this.updatePlayers(dt);
    this.gun.update(dt);
    ts.mark(T_PLAYERS);
    this.zm.update(dt);
    ts.mark(T_ZOMBIES);
    this.cm.update(dt);
    this.dm.update(dt);
    ts.mark(T_CATS);
    this.combat.updateProjectiles(dt);
    this.combat.updateAreas(dt);
    ts.mark(T_COMBAT);
    this.updateStructures(dt);
    this.updateItems(dt);
    this.updateCrates(dt);
    this.fixtures.update(dt);
    if (this.ringing.size) this.updateAlarms(dt);
    this.recordHistory();
    this.track.tick();
    this.ach.tick();
    this.bestiary.tick();
    ts.mark(T_UPKEEP);
    this.sendSnapshots();
    ts.mark(T_SNAPSHOTS);
    this.endTick();
  }

  // Closes the tick's timing. One over its budget is logged at once with where the time went and what the server
  // was carrying (TickStats lets a line through every few seconds and counts the rest).
  endTick() {
    const ts = this.tickStats;
    const due = ts.end();
    this.stats.tickMs = this.stats.tickMs * 0.95 + ts.ms * 0.05;
    if (due) this.log(`slow tick ${ts.slowText(`players ${this.players.size} zombies ${this.zombies.length} ents ${this.all.length}`)}`);
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
    // a group led by dogs comes out of the woods
    const dogs = type0Queue[type0Queue.length - 1] === ZTYPE.DOG;
    const sp = anchor ? this.zm.pickSpawnAround(anchor.x, anchor.z, humans, HORDE_SPAWN_MIN, HORDE_SPAWN_MAX, dogs) : this.zm.pickHordeSpawn(humans, dogs);
    if (!sp) return 0;
    const group = 3 + Math.floor(this.rng() * 3);
    const pack = this.zm.newPack(); // the group's dogs hunt as one pack
    let n = 0;
    for (let i = 0; i < group && type0Queue.length && alive + i < MAX_ZOMBIES_ALIVE; i++) {
      const type = type0Queue.pop();
      const z = this.zm.spawn(type, sp.x + (this.rng() - 0.5) * 8, sp.z + (this.rng() - 0.5) * 8, { horde: true, hpMul: this.hordeHpMul, pack });
      if (!z) type0Queue.push(type);
      else {
        n++;
        if (type === ZTYPE.SHADE && !this.shadeWarned) {
          this.shadeWarned = true;
          this.notify(NOTIFY.SHADE, 0);
        }
      }
    }
    if (n) this.globalDirty = true;
    return n;
  }

  updatePhase(dt) {
    if (this.phase === PHASE.GAMEOVER || this.phase === PHASE.VICTORY) {
      if (this.takeoffHold) return; // (/takeoff hold: look-dev)
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
          this.cemetery.wave(wv); // (with a survivor near St. Agnes Cemetery, part of it comes up out of the graves)
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
      const hpMul = (1 + BOSS_HP_PER_PLAYER * (Math.max(1, this.humanCount()) - 1) + BOSS_HP_PER_NIGHT * (this.day - 1)) * (type === ZTYPE.TANK ? TANK_BOSS_HP : 1);
      const z = this.zm.spawn(type, sp.x, sp.z, { horde: true, hpMul, boss: true });
      if (z) {
        this.bossId = z.id;
        this.track.bossSpawn(z);
        this.notify(NOTIFY.BOSS, type);
        this.sound(type === ZTYPE.TANK ? SOUND.TANK_ROAR : SOUND.BOSS_ROAR, sp.x, 2, sp.z, 0);
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

  // The engine is warming up: the whole valley heard it. It only warms while a survivor on their feet is at the car
  // (it stalls otherwise: the count stops where it is, it does not start over), and once it is warm the run goes on
  // until a survivor gets in and drives (HOLD.DRIVE -> driveOff).
  updateEscape(dt) {
    const e = this.escape;
    const car = this.world.car;
    // The plane's stand (acts.js RUNWAY) has two things to hold, one after the other: the fuel truck while it pumps,
    // then the plane while its engines warm. The car's has the one.
    const plane = this.act === WORLD.MAINLAND;
    const at = plane && e.stage === 0 ? this.world.runway.truck : car;
    const reach = plane && e.stage === 0 ? RUNWAY.HOLD : ESCAPE_RADIUS;
    let held = false; // somebody stands at it
    let leaving = false; // somebody is getting in
    for (const p of this.players.values()) {
      if (!p.alive || p.zombie || p.downed) continue;
      if (Math.hypot(p.state.x - at.x, p.state.z - at.z) <= reach) held = true;
      if (p.hold && p.hold.kind === HOLD.DRIVE) leaving = true;
    }
    // ...and once it is ready, a runway to keep clear: the plane does not go with the dead in its way (driveOff)
    const blocked = plane && e.ready && this.tick % 5 === 0 ? this.onRunway() > RUNWAY.CLEAR : e.blocked;
    if (blocked !== e.blocked) {
      e.blocked = blocked;
      this.globalDirty = true;
    }
    const stalled = !e.ready && !held;
    if (stalled !== e.stalled || leaving !== e.leaving) {
      e.stalled = stalled;
      e.leaving = leaving;
      this.globalDirty = true; // the HUD says both, and the client stops its own countdown on a stall
    }
    if (!e.ready && !stalled) {
      const prev = Math.ceil(e.t);
      e.t -= dt;
      if (Math.ceil(e.t) !== prev) this.globalDirty = true;
    }
    // The stand comes on its own clock, stalled engine or not: the dead hunt the survivors, not the car.
    e.spawnT -= dt;
    // its size, the cap on how many stand at once and the pace all follow the survivors still alive; a group that
    // finds the cap full waits and comes as soon as there is room
    const size = e.spawnT <= 0 ? this.finalStandSize() : 0; // 0: no group is due
    // a warm engine goes on drawing them once the stand is spent, so every second the team lingers at the car costs
    const linger = e.ready && size > 0 && e.sent >= size;
    if ((e.sent < size || linger) && this.hordeAlive() < Math.min(MAX_ZOMBIES_ALIVE, Math.round(size * FINAL_STAND_ALIVE))) {
      const spread = plane ? RUNWAY.FUEL_TIME + RUNWAY.WARM_TIME - 30 : FINAL_STAND_SPREAD;
      e.spawnT = ((spread / Math.ceil(size / 3.5)) * (0.7 + this.rng() * 0.6)) / (linger ? ESCAPE_LINGER_PACE : 1); // groups of 3-5, as a wave's
      const n = this.day;
      const tanks = FINAL_STAND_TANKS * Math.max(1, this.humanCount());
      const q = [];
      for (let i = linger ? 5 : Math.min(5, size - e.sent); i > 0; i--) {
        const r = this.rng();
        const type = r < 0.45 ? ZTYPE.WALKER : r < 0.67 ? ZTYPE.RUNNER : r < 0.72 && n >= 2 ? ZTYPE.DOG : r < 0.8 && n >= 2 ? ZTYPE.SPITTER : r < 0.87 && n >= 2 ? ZTYPE.BOOMER : r < 0.93 && n >= 3 ? ZTYPE.LEAPER : r < 0.97 && n >= 3 && e.tanks < tanks ? ZTYPE.TANK : ZTYPE.RUNNER;
        if (type === ZTYPE.TANK) e.tanks++;
        q.push(type);
      }
      // (the plane's comes down the runway: its groups appear round a point well along it)
      e.sent += this.spawnHordeGroup(q, plane ? { x: car.x, z: car.z - RUNWAY.AHEAD } : car);
      for (const t of q) if (t === ZTYPE.TANK) e.tanks--; // rolled, but the group came out smaller: it was not sent
    }
    if (!e.ready) {
      if (!e.boss && e.t <= (plane ? RUNWAY.FUEL_TIME : ESCAPE_TIME) * 0.5) {
        e.boss = true;
        this.spawnBosses([this.day % 2 ? ZTYPE.BOSS_ABOMINATION : ZTYPE.BOSS_HIVEQUEEN], car);
      }
      if (e.t <= 0 && plane && e.stage === 0) {
        // the tanks are full: the engines start, and the stand moves from the truck to the plane. The other of the
        // two late bosses comes with it
        e.stage = 1;
        e.t = RUNWAY.WARM_TIME;
        this.notify(NOTIFY.STAND_STAGE, 1);
        this.sound(SOUND.ENGINE_CRANK, car.x, car.y + 0.8, car.z, 300);
        this.spawnBosses([this.day % 2 ? ZTYPE.BOSS_HIVEQUEEN : ZTYPE.BOSS_ABOMINATION], { x: car.x, z: car.z - RUNWAY.AHEAD });
        this.globalDirty = true;
      } else if (e.t <= 0) {
        e.t = 0;
        e.ready = true;
        this.notify(NOTIFY.ESCAPE_READY, 0);
        this.track.engineReady();
        this.sound(SOUND.CAR_START, car.x, car.y + 0.8, car.z, 300);
        this.globalDirty = true;
      }
    }
    this.trackBoss();
  }

  // A cargo plane crosses the valley in a straight line and kicks the crate off its ramp so that, after
  // shedding the plane's speed under the canopy, it lands on a supply spot. Clients draw the plane and its
  // smoke trail from one FLYOVER event; the crate itself is an ordinary entity once it leaves the ramp.
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
    const heading = this.rng() * Math.PI * 2;
    this.flySupplyDrop(sp.x, sp.z, heading);
  }

  // The plane itself, for a drop at (x, z), coming in on `heading`. y: the height of the ground meant there, for a
  // spot that may have something over or beside it (a drop called to where a survivor stands, server/fixtures.js);
  // without it, the top of whatever is highest there.
  flySupplyDrop(x, z, heading, y = 200) {
    const sp = { x, z };
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    const gy = groundAt(this.world, sp.x, sp.z, y, 0.6);
    const drift = PLANE_SPEED / CRATE_DRAG;
    // release point = where the ramp is when the crate leaves; the plane's origin is PLANE_RAMP ahead of it
    const rx = sp.x - fx * drift;
    const rz = sp.z - fz * drift;
    const alt = gy + PLANE_ALTITUDE;
    const eta = PLANE_LEAD / PLANE_SPEED;
    const px = rx + fx * PLANE_RAMP;
    const pz = rz + fz * PLANE_RAMP;
    this.flyovers.push({ at: this.time + eta, x: rx, y: alt - 2.4, z: rz, vx: fx * PLANE_SPEED, vz: fz * PLANE_SPEED, tx: sp.x, tz: sp.z, gy });
    this.emit((w) => {
      w.u8(EVT.FLYOVER);
      w.i16(qpos(px));
      w.i16(qpos(alt));
      w.i16(qpos(pz));
      w.u16(qangle16(heading));
      w.u16(Math.round(eta * 1000));
    });
    this.notify(NOTIFY.SUPPLY_DROP, 0);
    this.track.crateDrop(x, z);
  }

  updateCrates(dt) {
    for (let i = this.flyovers.length - 1; i >= 0; i--) {
      const f = this.flyovers[i];
      if (this.time < f.at) continue;
      this.flyovers.splice(i, 1);
      // state 3: tumbling off the ramp, the canopy still packed
      const e = { kind: ENT.CRATE, x: f.x, y: f.y, z: f.z, vx: f.vx, vy: 0, vz: f.vz, tx: f.tx, tz: f.tz, gy: f.gy, free: CRATE_FREEFALL, state: 3, despawnAt: this.time + 600 };
      if (this.spawnEntity(e)) this.crates.push(e);
    }
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      if (c.state === 0 || c.state === 3) {
        if (c.vx !== undefined) {
          const k = Math.exp(-CRATE_DRAG * dt);
          c.x += (c.vx * (1 - k)) / CRATE_DRAG;
          c.z += (c.vz * (1 - k)) / CRATE_DRAG;
          c.vx *= k;
          c.vz *= k;
        }
        if (c.free > 0) {
          c.free -= dt;
          c.vy -= 9.8 * dt;
          if (c.free <= 0) c.state = 0; // canopy opens
        } else if (c.vy !== undefined) c.vy += (-CRATE_FALL_SPEED - c.vy) * Math.min(1, dt * 2.5);
        c.y += (c.vy ?? -CRATE_FALL_SPEED) * dt;
        if (c.y <= c.gy) {
          c.y = c.gy;
          if (c.tx !== undefined) {
            c.x = c.tx;
            c.z = c.tz;
          }
          c.state = 1;
          this.sound(SOUND.CRATE_LAND, c.x, c.y, c.z, 80);
          this.zm.noise(c.x, c.z, NOISE.CRATE_LAND);
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
      // afloat with no stamina left (shared/swim.js): drowning, in gulps, until the feet find the bottom
      if (s.stamina <= 0 && swimming(this.world, s)) {
        if ((p.drownT = (p.drownT || 0) + dt) >= 0.5) {
          p.drownT -= 0.5;
          this.damagePlayer(p, DROWN_DPS * 0.5, { kind: KILLER.WORLD, drown: true });
          if (!p.alive) continue;
          this.ach.drowning(p);
        }
      } else p.drownT = 0;
      if (p.downed) {
        if (!p.revivedBy && !p.away) p.bleed -= dt * perkMods(p.perks).bleed; // (a held player's clock stops)
        if (p.bleed <= 0) this.killPlayer(p, p.lastSrc || { kind: KILLER.WORLD });
        if (p.revivedBy) {
          const rv = this.players.get(p.revivedBy);
          if (!rv || !rv.hold || rv.hold.target !== p.id) p.revivedBy = 0;
        }
        continue;
      }
      // healing
      if (this.time - p.lastDamageT > HEAL_DELAY * this.diff.healDelay && p.hp < p.maxHp) {
        const nearFire = this.nearLitFire(s.x, s.z);
        // a campfire heals what it always healed: building one is the same decision on every difficulty
        p.hp = Math.min(p.maxHp, p.hp + (nearFire ? HEAL_RATE_CAMPFIRE : HEAL_RATE * this.diff.heal) * dt);
      }
      // flashlight battery
      if (p.flashlight) {
        p.battery -= FLASHLIGHT_DRAIN * this.diff.light * dt;
        if (p.battery <= 0) {
          p.battery = 0;
          p.flashlight = false;
        }
      } else p.battery = Math.min(FLASHLIGHT_MAX, p.battery + FLASHLIGHT_RECHARGE * dt);
      // item use
      if (p.useItem && s.using) {
        p.useItem.t += dt;
        if (p.useItem.t >= p.useItem.total) this.finishUse(p);
      }
      this.updateHold(p, dt);
      if (p.invDirty) this.syncThrow(p);
    }
  }

  updateStructures(dt) {
    this.power.update(dt); // generators burn their fuel, hum and feed the floodlights
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
          // what this survivor put down themselves stays down while they stand by it (to clear a slot, to hand it to
          // a teammate): once they have walked off it is a stack like any other, for them too
          if (e.droppedBy === p.id) {
            if (dx * dx + dz * dz <= DROP_LEAVE_DIST * DROP_LEAVE_DIST) continue;
            e.droppedBy = 0;
          }
          if (dx * dx + dz * dz > 1.9 * 1.9 || Math.abs(e.y - s.y) > 1.6) continue;
          if (this.time < e.noAutoUntil) continue;
          const cat = ITEM_DEFS[e.item]?.cat;
          if (!AUTO_PICKUP[cat] || !this.canReachEnt(p, e)) continue;
          const taken = this.giveItem(p, e.item, e.count, e.mag);
          if (taken <= 0) {
            e.noAutoUntil = this.time + 3;
            // No room in the backpack (ammo is another matter: a full reserve). Say so, or the survivor walks on
            // without knowing: always for a car supply, the run depends on those; for the rest only as they walk
            // over it, not again and again while they stand in a pile of it.
            const part = cat === 'part';
            if (cat !== 'ammo' && this.time - (part ? p.partFullT : p.fullT) >= FULL_NOTICE_EVERY && (part || s.vx * s.vx + s.vz * s.vz > 1)) {
              p.fullT = this.time;
              if (part) p.partFullT = this.time;
              this.notify(NOTIFY.INVENTORY_FULL, e.item, p.id);
            }
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
    const k = this.tick & (HISTORY_TICKS - 1);
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
    for (const d of this.deer) {
      d.hx[k] = d.x;
      d.hy[k] = d.y;
      d.hz[k] = d.z;
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
    for (let i = 0; i < 5; i++) w.u8(this.supplies[i]); // (this act's: suppliesOf)
    for (let i = 0; i < 7; i++) w.u8(this.supplyHints[i] ?? 255);
    w.u8(this.supplyFound);
    w.u8(this.unlocked);
    for (let i = 0; i < SCHEMATICS.length; i++) w.u8(this.schemHints[i] ?? 255);
    w.u8(this.phase === PHASE.NIGHT ? this.wave : 0);
    w.u8(NIGHT_WAVES);
    w.u16(Math.round(Math.max(0, this.escape.t) * 10));
    const esc = this.escape;
    // 8: the warm-up has stalled (nobody on their feet at the car), 16: a survivor is getting in to drive
    // 32: (the plane's stand) the tanks are full and the engines are warming, 64: the dead are on the runway
    w.u8((esc.active ? 1 : 0) | (this.allSuppliesIn() ? 2 : 0) | (esc.ready ? 4 : 0) | (esc.active && esc.stalled ? 8 : 0) | (esc.active && esc.leaving ? 16 : 0) | (esc.active && esc.stage ? 32 : 0) | (esc.active && esc.blocked ? 64 : 0));
    let alive = 0;
    let total = 0;
    for (const p of this.players.values()) {
      total++;
      if (p.alive && !p.zombie) alive++;
    }
    w.u8(alive);
    w.u8(total);
    w.f32(this.restartT);
    w.u16(Math.round(this.phase === PHASE.DAY ? this.dayLen : this.phase === PHASE.CROSSING ? CROSSING.TIME : this.nightLen));
    // the act being played (shared/acts.js), and who has asked to skip the crossing out of who would have to
    w.u8(this.act);
    const [got, need] = this.phase === PHASE.CROSSING ? this.skipVotes() : [0, 0];
    w.u8(Math.min(255, got));
    w.u8(Math.min(255, need));
    // workbenches, for the field map: structures themselves only replicate inside AOI_STRUCTURE_RADIUS
    const at = w.reserve8();
    let benches = 0;
    for (const e of this.structures) {
      if (e.stype !== STRUCT.WORKBENCH || benches === 255) continue;
      w.i16(qpos(e.x));
      w.i16(qpos(e.z));
      benches++;
    }
    w.patch8(at, benches);
    // car supplies lying loose (dropped, or where whoever carried one died), for the field map: items only replicate
    // inside AOI_ITEM_RADIUS, and one that never despawns must not be lost for want of knowing where it went down
    const pat = w.reserve8();
    let parts = 0;
    for (const e of this.items) {
      if (!looseSupply(e) || parts === 255) continue;
      w.u8(e.item);
      w.i16(qpos(e.x));
      w.i16(qpos(e.z));
      parts++;
    }
    w.patch8(pat, parts);
  }

  // Self state. The simulated part only goes out when the client has to rebase its prediction on it (SELF.SYNC):
  // in its first snapshot, while it is dead, when anything but its own commands touched the state (knockback, a
  // pickup, a respawn...) or when its fingerprint of the prediction disagreed with ours (processInputs). Then it is
  // 5 chunks, delta-compressed against what this client last got (byte-compared), and our own state is rounded to
  // what went on the wire so both ends carry on from identical numbers. The status part (hp, armor, battery...)
  // goes out group by group as it changes. A client whose prediction holds costs nothing. Returns false when
  // there was nothing to write.
  writeSelf(w, p) {
    const s = p.state;
    const c = this.cw || (this.cw = new Writer(128));
    if (!p.selfCache) p.selfCache = [];
    // appends the scratch chunk if it differs from the one this client has
    const put = (i) => {
      const prev = p.selfCache[i];
      let same = prev && prev.length === c.o;
      for (let k = 0; same && k < c.o; k++) same = prev[k] === c.u8a[k];
      if (same) return 0;
      p.selfCache[i] = c.u8a.slice(0, c.o);
      w.ensure(c.o);
      w.u8a.set(c.u8a.subarray(0, c.o), w.o);
      w.o += c.o;
      return 1;
    };
    const maskAt = w.reserve8();
    let mask = 0;
    if (p.selfSync || !p.alive || !samePlayerState(s, p.shadow)) {
      mask = SELF.SYNC;
      p.selfSync = false;
      snapPlayerState(s);
      copyPlayerState(p.shadow, s);
      for (let chunk = 0; chunk < 5; chunk++) {
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
          case 1:
            c.u8((s.onGround ? 1 : 0) | (s.crouch ? 2 : 0) | (s.exhausted ? 4 : 0) | (s.zombie ? 8 : 0) | (s.pulled ? 16 : 0) | (s.pinned ? 32 : 0) | (s.sprinting ? 64 : 0) | (s.downed ? 128 : 0));
            c.f32(s.stamina);
            c.f32(s.staminaDelay);
            break;
          case 2:
            c.u8(s.slot);
            c.f32(s.switchT);
            c.f32(s.cooldown);
            c.f32(s.reloadT);
            c.f32(s.recoil);
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
            c.f32(s.leapCd);
            c.f32(s.stunT);
            c.f32(s.shove);
            c.u8(s.pulled ? 1 : 0);
            if (s.pulled) {
              c.f32(s.pullX);
              c.f32(s.pullY);
              c.f32(s.pullZ);
            }
            break;
        }
        if (put(chunk)) mask |= 1 << chunk;
      }
      // (the seat of a ride at the fair: fair.js; the handcar on the railway: handcar.js; the mounted gun in their
      // arms: mountedgun.js; the perks they picked: progress.js)
      c.reset();
      c.u8(s.ride);
      c.u8(s.rideGo);
      c.u32(s.rideT);
      c.u8(s.cart);
      c.f32(s.cartS);
      c.f32(s.cartV);
      c.u8(s.hmg);
      c.u32(s.perks);
      if (put(12)) mask |= SELF.RIDE;
    }
    // status: 7 field groups behind their own mask
    const subAt = w.reserve8();
    let sub = 0;
    for (let g = 0; g < 7; g++) {
      c.reset();
      switch (g) {
        case 0:
          c.u16(Math.max(0, Math.ceil(p.hp)));
          c.u16(p.maxHp);
          break;
        case 1:
          c.u8(Math.ceil(p.armor));
          c.u8(p.armorMax);
          break;
        case 2:
          c.u8((p.alive ? 1 : 0) | (p.flashlight ? 2 : 0) | (p.revivedBy ? 4 : 0));
          c.u8(Math.round(p.battery));
          break;
        case 3:
          // (only once it is in the hands: this is also what the client has the simulation's `using` from, endUse)
          c.u8(p.useItem && s.using ? p.useItem.item : 0);
          c.u8(p.useItem && s.using ? Math.min(255, Math.round((p.useItem.t / p.useItem.total) * 255)) : 0);
          break;
        case 4:
          c.u8(Math.max(0, Math.min(255, Math.ceil(p.respawnT))));
          break;
        case 5: {
          const h = p.hold;
          c.u8(h ? h.kind : 0);
          c.u8(h ? Math.min(255, Math.round((h.t / h.need) * 255)) : 0);
          break;
        }
        case 6:
          c.u8(p.downed ? Math.max(0, Math.min(255, Math.ceil(p.bleed * 4))) : 0);
          break;
      }
      if (put(5 + g)) sub |= 1 << g;
    }
    if (sub) {
      mask |= SELF.STATUS;
      w.patch8(subAt, sub);
    } else w.o = subAt;
    if (!mask) {
      w.o = maskAt;
      return false;
    }
    w.patch8(maskAt, mask);
    return true;
  }

  sendInventory(p) {
    const w = this.w.reset();
    w.u8(S2C.INVENTORY);
    for (let i = 0; i < INVENTORY_MAX; i++) {
      const it = p.inv[i];
      w.u8(it ? it.item : 0);
      w.u16(it ? it.count : 0);
    }
    w.u8(p.armorItem);
    w.u8(Math.ceil(p.armor));
    w.u8(p.armorMax);
    w.u8(p.backpackItem);
    p.session.conn.send(w.bytes());
    this.stats.bytesOut += w.o;
    this.stats.msgsOut++;
    p.invDirty = false;
  }

  // ---------------------------------------------------------------- leaderboard
  // One more of `stat` on the record of each of these players (stats.js). A record is credited once however many
  // of its sessions are among them (one browser, two tabs), and a player without one gets nothing.
  credit(players, stat) {
    const done = new Set();
    for (const p of players) {
      if (!p.rec || done.has(p.rec)) continue;
      done.add(p.rec);
      this.records.bump(p.rec, stat);
    }
  }

  // Who is signed in to an account (S2C.FRIENDS: its name, '' for a guest), for sending each other friend requests: a
  // newcomer is told everyone's, their own among them, and everyone else is told theirs. (An id that comes back to
  // someone else comes with its new account.)
  tellFriendCodes(p) {
    const w = new Writer(16 + 12 * this.players.size);
    w.u8(S2C.FRIENDS);
    w.u8(this.players.size);
    for (const q of this.players.values()) {
      w.u16(q.id);
      w.str(q.friend || '');
    }
    p.session.conn.send(w.bytes());
    const one = new Writer(16);
    one.u8(S2C.FRIENDS);
    one.u8(1);
    one.u16(p.id);
    one.str(p.friend || '');
    const bytes = one.bytes();
    for (const q of this.players.values()) if (q !== p) q.session.conn.send(bytes);
  }

  // The leaderboard for the player who asked (C2S.BOARD), once a second at most
  sendBoard(p) {
    if (this.time - p.boardT < 1) return;
    p.boardT = this.time;
    const here = new Set();
    for (const q of this.players.values()) if (q.rec) here.add(q.rec);
    // a game in a room's worker has its records on the network thread, which answers the player itself (rooms.js)
    if (this.records.remote) return this.records.sendBoard(p.session.conn.slot, p.rec, here);
    const { total, rows } = this.records.board(p.rec, here);
    const w = new Writer(1024);
    w.u8(S2C.BOARD);
    writeBoard(w, total, rows);
    p.session.conn.send(w.bytes());
    this.stats.bytesOut += w.o;
    this.stats.msgsOut++;
  }

  // sends everyone the player list now (it normally rides along with the next snapshot, see sendTick)
  sendPlayers() {
    this.playersList();
    for (const p of this.players.values()) this.sendList(p);
  }
  sendList(p) {
    if (p.listVer === this.listVer) return;
    p.listVer = this.listVer;
    p.session.conn.send(this.listBytes);
    this.stats.bytesOut += this.listBytes.length;
    this.stats.msgsOut++;
  }

  // Rebuilds the player list message; a client is sent it when its copy is out of date (listVer)
  playersList() {
    const w = this.w.reset();
    w.u8(S2C.PLAYERS);
    w.u8(this.players.size);
    for (const p of this.players.values()) {
      w.u16(p.id);
      w.str(p.name);
      w.u8(!p.alive ? 2 : p.zombie ? 1 : p.downed ? 3 : 0);
      p.onAir = this.onAir(p);
      if (p.onAir) this.ach.onAir(p);
      const wp = p.waypoint;
      w.u8((p.onAir ? PLF.ON_AIR : 0) | (wp ? PLF.WAYPOINT : 0));
      w.u16(p.kills + p.zkills);
      w.u16(Math.min(9999, Math.round(p.ping)));
      w.u8(this.levelOf(p));
      if (wp) {
        w.i16(qpos(wp.x));
        w.i16(qpos(wp.z));
        w.u8(wp.zone);
      }
    }
    // each player's character, in the same order, after them all: a client from before the roster stops reading at the
    // end of the list and never sees these
    for (const p of this.players.values()) w.u8(p.character ?? defaultCharacter(p.id));
    // ...then each one's perks in force (progress.js: a mask of ids), for their profile card
    for (const p of this.players.values()) w.u32(p.perks >>> 0);
    this.playersDirty = false;
    const prev = this.listBytes;
    let same = !!prev && prev.length === w.o;
    for (let i = 0; same && i < w.o; i++) same = prev[i] === w.u8a[i];
    if (same) return;
    this.listBytes = w.u8a.slice(0, w.o);
    this.listVer = (this.listVer || 0) + 1;
  }

  // Global state for one client: all of it the first time and whenever anything but the clocks changed, just the
  // clocks (time left, horde left: bytes 2-5) when only they moved, nothing when not even those did.
  // all: this tick's full global state. Returns false if nothing was written.
  writeGlobalFor(w, p, all) {
    const prev = p.globalCache;
    let full = !prev || prev.length !== all.length;
    let clocks = false;
    for (let i = 0; !full && i < all.length; i++) {
      if (prev[i] === all[i]) continue;
      if (i >= 2 && i < 6) clocks = true;
      else full = true;
    }
    if (!full && !clocks) return false;
    w.u8(full ? 1 : 0);
    w.ensure(all.length);
    if (full) {
      w.u8a.set(all, w.o);
      w.o += all.length;
      p.globalCache = all.slice();
    } else {
      for (let i = 2; i < 6; i++) w.u8(all[i]);
      prev.set(all.subarray(2, 6), 2);
    }
    return true;
  }

  // somebody keyed their walkie-talkie or let go of it: everyone has to know at once (their voice, the static)
  checkOnAir() {
    for (const p of this.players.values()) if (this.onAir(p) !== p.onAir) this.playersDirty = true;
  }

  sendSnapshots() {
    if (!this.playersDirty) this.checkOnAir();
    // the list is rebuilt on changes and every 2 s (kills, ping), and only goes out when it came out different
    if (this.playersDirty || this.tick - this.playersListT > 40) {
      this.playersListT = this.tick;
      this.playersList();
    }
    let global = null;
    if (this.globalDirty || this.tick % 20 === 0) {
      const gw = (this.gw || (this.gw = new Writer(256))).reset();
      this.writeGlobal(gw);
      global = gw.bytes();
    }
    this.globalDirty = false;
    if (this.players.size) stageEntities(this.all); // once for all clients: each sendTick's writeEntities reads the staged copy
    for (const p of this.players.values()) {
      const conn = p.session.conn;
      if (p.pingAt) {
        const held = Math.min(255, Math.round(performance.now() - p.pingAt));
        p.pingAt = 0;
        this.emit(
          (w) => {
            w.u8(EVT.PONG);
            w.u8(held);
          },
          { to: p.id },
        );
      }
      // A client that isn't draining its socket gets nothing this tick: every baseline stays where it is and the
      // next snapshot that does go out covers the gap (dropping an encoded one would break the delta chain)
      if (conn.congested && conn.congested()) continue;
      // everything this client gets this tick leaves as one packet
      if (conn.cork) conn.cork(() => this.sendTick(p, global));
      else this.sendTick(p, global);
    }
    this.events.length = 0;
  }

  // one client's traffic for this tick: the player list and its inventory when they changed, then the snapshot
  // global: this tick's full global state when it is due (null otherwise)
  sendTick(p, global) {
    const conn = p.session.conn;
    this.sendList(p);
    this.sendProgress(p);
    if (p.invDirty) {
      // picked up or dropped this tick: sorted (sortInventory), a split left apart. Else the safety net, for any path
      // that left two part stacks of a thing
      if (p.invSort) sortInventory(p.inv, invCap(p), p.splitKeep);
      else tidyStacks(p.inv, p.splitKeep);
      p.invSort = false;
      this.sendInventory(p);
    }
    const w = this.w.reset();
    w.u8(S2C.SNAPSHOT);
    const flagsAt = w.reserve8();
    let flags = 0;
    const ackStep = (p.lastSeq - p.ackSent) & 0xffff;
    if (this.tick !== p.snapTick + 1) {
      flags |= SNAP.TICK;
      w.u32(this.tick);
      w.u16(p.lastSeq);
    } else if (ackStep !== CMDS_PER_PACKET) {
      flags |= SNAP.ACK;
      w.varu(ackStep);
    }
    p.snapTick = this.tick;
    p.ackSent = p.lastSeq;
    if (global && this.writeGlobalFor(w, p, global)) flags |= SNAP.GLOBAL;
    if (this.writeSelf(w, p)) flags |= SNAP.SELF;
    flags |= writeEntities(w, p.view, p, this.all, this.tick);
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
    if (n) {
      flags |= SNAP.EVENTS;
      w.patch8(at, n);
    } else w.o = at;
    w.patch8(flagsAt, flags);
    conn.send(w.bytes());
    this.stats.bytesOut += w.o;
    this.stats.msgsOut++;
  }
}

export { SLOT_BUILD, SLOT_PISTOL };
