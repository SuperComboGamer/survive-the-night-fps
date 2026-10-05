// Match analytics: what a match was like, for tuning the game. A MatchTracker runs inside the authoritative Game
// (game.js builds it as this.track) and hands plain-object records to a sink - the room's worker posts them to the
// network thread, which writes them to Postgres (server/db/migrations/002_matches.sql has the tables, one column per
// field below). Without a sink it is a no-op: no match is ever opened, and every hook returns on its first line.
//
// The game calls one-line hooks where things happen (game.js, combat.js, zombies.js, deer.js, fixtures.js). Those on
// hot paths (shots, hits, damage, kills) only bump counters on the stint the player carries (p.ts) or on the match;
// a record goes out only for a match, a stint, a night, a sample or one of the rare events.
//
// Records (k: kind; every one but 'match' carries matchId). *At: ms since the epoch; t and *S: seconds of game
// time since the match began. Numbers are finite; what is not known is null.
//   match      when a run starts (Game.startGame)
//   match_end  once per match: victory, the team wiped out, everyone gone (abandoned), or finish() from outside
//   player     one per stint: from joining the match (or its start) to leaving it or the match ending
//   night      when a night ends: at dawn, in a wipe, by escaping during it, or with the match abandoned
//   event      the rare moments: join leave down death revive turned returned_at_dawn night_start dawn boss_spawn
//              boss_kill supply_found supply_install schematic engine_start engine_ready crate_drop car_alarm
//              radio_call bell, admin (an admin chat command, data.command: Game.handleChat), crossing (the car
//              left the island for the mainland: Game.cross) and arrival (the team is off the bridge: Game.arrive),
//              and the match's end as victory | wipe | abandoned | interrupted | handoff
//   sample     every SAMPLE_EVERY seconds of a running match
//
// Vocabularies
//   phase                 day | night | final_stand (the engine is warming or warm: Game.escape.active)
//   match outcome         victory | wipe | abandoned (the last player left, or a new run began over it) |
//                         interrupted (finish('interrupted'): the server stopped with it running) |
//                         handoff (finish('handoff'): a deploy, and the next server carries the run on as a new
//                         match whose row names this one in `continues`: server/handoff.js)
//   night outcome         dawn | wipe | escaped | abandoned (also for an interrupted match)
//   player leftReason     left | match_end
//   player outcome        escaped      victory, a living survivor within ESCAPE_RADIUS of the car (downed counts)
//                         left_behind  victory, a living survivor further off
//                         alive        the match ended otherwise (abandoned / interrupted) with them a survivor
//                         dead         the match ended with them lying dead (not risen yet); everyone in a wipe
//                         turned       the match ended with them a player-zombie
//                         left         they left mid-match (stats.state says what they were then)
//   causes                a zombie type (walker, runner, tank, spitter, boss_brute...), turned_player (a survivor
//                         hurt or killed by a player-zombie), survivor (a player-zombie hurt by a survivor), fall,
//                         drowned (out of stamina in deep water), world (anything else without a source)
//   names                 zombie types, items/weapons, structures, containers, zones: the lowercased keys of ZTYPE,
//                         ITEM, STRUCT, CONT, ZONE in shared/defs.js (pistol, ak47, db_shotgun, car_battery,
//                         metal_wall...); the mounted gun is mounted_gun; a kill without a weapon is fire,
//                         explosion or unknown
//
// The two acts (shared/acts.js): a run that drives off the island goes on across the bridge as the same match, and
// its victory is the plane's. A wipe on the mainland ends the match, and the run from the checkpoint at the bridge
// is a new one that begins on the mainland (summary.startAct 2). In the match_end record suppliesInstalled /
// suppliesNeeded and engineStartedS are of the act the match ended in (the engine: the last one started);
// summary.supplies is always the car's, summary.planeParts the plane's (the same shape; null for a match that never
// saw the mainland), every supplyLog entry names its act, summary.act is the act it ended in, and summary.crossing
// is how the island was left (null: it was not): { t, day, phase, night, driver, players, alive, downed, dead,
// turned, aboard (alive and at the car), back (the dead and turned the checkpoint brought back), arrivedS,
// arrivedDay, engineStartedS, engineStartedDay, engineReadyS (the car's) }.
//
// Counting rules: shots / hits / headshots are rounds fired through Combat.fire by everything but the flamethrower
// (a shotgun blast is one shot; a hit is a shot that struck something, a headshot one that struck a head); the
// flamethrower's puffs are only in shotsByWeapon / hitsByWeapon. Melee swings are stats.swings / stats.swingHits.
// damageDealt / damageTaken are what came off health, overkill and armour not counted. kills are zombies and
// player-zombies killed by a survivor; zombieKills are survivors killed by that player while turned. crafted /
// craftedItems count crafts, not the items they made. itemsUsed / usedItems are consumables used and throwables
// thrown. Revives by a teammate are revivesGiven / revivesReceived; a medkit back on one's feet is
// stats.medkitRevives (the match's revives count both).
import { randomUUID } from 'node:crypto';
import { PHASE, ESCAPE_RADIUS, SERVER_TICK_RATE } from '../shared/constants.js';
import * as CONSTANTS from '../shared/constants.js';
import { ITEM, ZTYPE, STRUCT, CONT, ZONE, KILLER, suppliesOf } from '../shared/defs.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { MOUNTED_GUN } from '../shared/mountedgun.js';
import { nightTheme } from '../shared/nights.js';

export const SAMPLE_EVERY = 30; // seconds of game time between two samples
const MOVE_MAX = 15; // m/s: a move faster than this between two once-a-second looks is a teleport or a respawn, not a walk
const NEAR = 10; // m: the dead this close count as "near" a down or a death

// id -> readable name tables
const names = (o) => {
  const out = [];
  for (const [k, v] of Object.entries(o)) out[v] = k.toLowerCase();
  return out;
};
const ITEM_NAME = names(ITEM);
ITEM_NAME[MOUNTED_GUN] = 'mounted_gun';
const ZNAME = names(ZTYPE);
const SNAME = names(STRUCT);
const CNAME = names(CONT);
const ZONE_NAME = names(ZONE);
export const itemName = (id) => ITEM_NAME[id] || (id ? `item_${id}` : 'unknown');
export const zombieName = (t) => ZNAME[t] || 'zombie';
// what an act's escape takes, as the summary keeps it: a row per item (act 2: the plane's parts)
const supplyRows = (act) => {
  const { items, need } = suppliesOf(act);
  const rows = {};
  items.forEach((item, i) => (rows[itemName(item)] = { need: need[i], found: 0, installed: 0, firstFoundS: null, firstFoundDay: null, firstInstalledS: null, doneS: null, doneDay: null }));
  return rows;
};
const total = (list) => list.reduce((a, b) => a + b, 0);

const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r1 = (v) => Math.round(fin(v) * 10) / 10;
const r2 = (v) => Math.round(fin(v) * 100) / 100;
const bump = (map, key, n = 1) => {
  map[key] = (map[key] || 0) + n;
};
const round1All = (map) => {
  const out = {};
  for (const k in map) out[k] = r1(map[k]);
  return out;
};
// who a player is across stints of one match: their account, else their browser id's key, else their name
const identity = (p) => (p.account ? `u:${p.account}` : p.guestKey ? `g:${p.guestKey}` : `n:${p.name}`);
const stateOf = (p) => (!p.alive ? 'dead' : p.zombie ? 'turned' : p.downed ? 'downed' : 'alive');
const killWeapon = (opts) => (opts.weapon ? itemName(opts.weapon) : opts.fire ? 'fire' : opts.explode ? 'explosion' : 'unknown');

export class MatchTracker {
  // sink: (record) => void, or anything else for none (a no-op tracker)
  constructor(game, sink) {
    this.g = game;
    this.sink = typeof sink === 'function' ? sink : null;
    this.m = null; // the match being played (null: none, always without a sink)
    this.sinkErrors = 0;
  }

  // ---------------------------------------------------------------- plumbing
  emit(rec) {
    try {
      this.sink(rec);
    } catch (err) {
      if (this.sinkErrors++ % 100 === 0) this.g.log(`analytics: the sink threw (${this.sinkErrors} so far): ${err.message}`);
    }
  }
  // seconds of game time since the match began
  t() {
    return r1(this.g.time - this.m.t0);
  }
  phase() {
    const g = this.g;
    if (g.escape.active) return 'final_stand';
    return g.phase === PHASE.NIGHT ? 'night' : g.phase === PHASE.DAY ? 'day' : null;
  }
  // a rare moment. p: the player it is about (or null); x, z: where (p's position by default)
  event(type, p = null, data = null, x, z) {
    const m = this.m;
    if (!m) return;
    const g = this.g;
    if (x === undefined && p) {
      x = p.state.x;
      z = p.state.z;
    }
    this.emit({
      k: 'event',
      matchId: m.id,
      at: Date.now(),
      t: this.t(),
      day: g.day,
      phase: this.phase(),
      type,
      userId: p ? p.account || null : null,
      name: p ? p.name : null,
      x: x == null ? null : r1(x),
      z: z == null ? null : r1(z),
      data: data || {},
    });
  }
  // the cause a damage source stands for (see the vocabularies above)
  cause(src) {
    if (!src) return 'world';
    if (src.kind === KILLER.ZOMBIE) return zombieName(src.ztype);
    if (src.kind === KILLER.PLAYER) {
      const a = this.g.players.get(src.id);
      return a && !a.zombie ? 'survivor' : 'turned_player';
    }
    return src.fall ? 'fall' : src.drown ? 'drowned' : 'world';
  }
  // the dead within NEAR of p, and the nearest teammate on their feet (m, null: none)
  surroundings(p) {
    const g = this.g;
    const s = p.state;
    let near = 0;
    for (const z of g.zombies) if (!z.dead && Math.abs(z.x - s.x) < NEAR && Math.abs(z.z - s.z) < NEAR && Math.hypot(z.x - s.x, z.z - s.z) < NEAR) near++;
    let mate = Infinity;
    for (const q of g.players.values()) if (q !== p && q.alive && !q.zombie && !q.downed) mate = Math.min(mate, Math.hypot(q.state.x - s.x, q.state.z - s.z));
    return { zombiesNear: near, mateM: mate === Infinity ? null : r1(mate) };
  }
  survivors() {
    let n = 0;
    for (const p of this.g.players.values()) if (p.alive && !p.zombie) n++;
    return n;
  }

  // ---------------------------------------------------------------- the match
  // Game.startGame, once the new run is set up (a run still open is ended first, as abandoned)
  start() {
    if (!this.sink) return;
    if (this.m) this.finish('abandoned');
    const g = this.g;
    const act = g.act === 2 ? 2 : 1; // (2: a run from the checkpoint at the bridge)
    const m = (this.m = {
      id: randomUUID(),
      t0: g.time,
      startedAt: Date.now(),
      ids: new Set(),
      peak: 0,
      playerSeconds: 0,
      kills: 0,
      deaths: 0,
      downs: 0,
      revives: 0,
      built: 0,
      lost: 0,
      crafted: 0,
      nightsSurvived: 0,
      engineS: null,
      engineDay: null,
      engineReadyS: null,
      driver: null,
      night: null,
      nextSample: SAMPLE_EVERY,
      lastT: g.time,
      phaseS: { day: 0, night: 0, final_stand: 0 },
      bosses: [],
      bossOf: new Map(), // zombie -> its entry in bosses
      supplies: supplyRows(1),
      planeParts: act === 2 ? supplyRows(2) : null,
      startAct: act,
      crossing: null,
      moving: false, // the crossing is being played: the island is being taken down
      fallen: [], // who was dead or turned as the car left (the checkpoint brings them back)
      supplyLog: [],
      schematics: [],
      crates: { dropped: 0, opened: 0 },
      carAlarms: 0,
      bells: 0,
      radioCalls: 0,
      deer: 0,
      joins: 0,
      leaves: 0,
      cachesSearched: 0,
      cachesByType: {},
      killsByType: {},
      killsByWeapon: {},
      zombieDeaths: { player: 0, sun: 0, trap: 0, fire: 0, explosion: 0, other: 0 },
      deathsByCause: {},
      downsByCause: {},
      builtByType: {},
      lostByType: {},
      craftedItems: {},
      usedItems: {},
    });
    this.emit({
      k: 'match',
      id: m.id,
      startedAt: m.startedAt,
      seed: g.seed >>> 0,
      startDay: g.day,
      seats: g.maxPlayers,
      protocol: PROTOCOL_VERSION,
      settings: this.settings(),
    });
    for (const p of g.players.values()) this.beginStint(p, true);
  }

  // What the run is played with. dayLen: every day this long (a fixed length: DAY_SECONDS, tests), null when the days
  // follow the schedule (shared/constants.js dayLength), which daySchedule lists for days 1-10; firstDayLen: the
  // first day of this run. (A Game from before the shortening days has dayLen and firstDayLen as plain numbers.)
  settings() {
    const g = this.g;
    const fixed = 'dayLenOverride' in g ? g.dayLenOverride || null : fin(g.dayLen) || null;
    const first = g.firstDayLen ?? g.dayLen; // (a getter: at the start of the run, the first day's)
    const sched = !fixed && typeof CONSTANTS.dayLength === 'function' ? Array.from({ length: 10 }, (_, i) => fin(CONSTANTS.dayLength(i + 1))) : null;
    return { dayLen: fixed, firstDayLen: fin(first) || null, daySchedule: sched, nightLen: fin(g.nightLen) || null, godMode: !!g.godMode, adminCommands: !!g.devAdmin, themes: !!g.themes, difficulty: g.diff?.id || 'nightfall' };
  }

  // Ends the running match now, if there is one, with that outcome (see the vocabularies): its event, the open night,
  // every open stint (leftReason match_end) and the match_end record go out before it returns. Game.victory /
  // gameOver / resetToWaiting / startGame call it; the worker calls finish('interrupted') when the server stops.
  finish(outcome) {
    const m = this.m;
    if (!m) return;
    const g = this.g;
    try {
      this.account();
      const phase = this.phase();
      const driver = outcome === 'victory' ? m.driver : null;
      this.event(outcome, driver && g.players.get(driver.id) === driver ? driver : null, { survivors: this.survivors(), players: g.players.size, driver: driver ? driver.name : null });
      if (m.night) this.endNight(outcome === 'victory' ? 'escaped' : outcome === 'wipe' ? 'wipe' : 'abandoned');
      let escaped = 0;
      for (const p of g.players.values()) {
        if (!p.ts) continue;
        const o = this.outcomeOf(p, outcome);
        if (o === 'escaped') escaped++;
        this.closeStint(p, 'match_end', o);
      }
      const t = this.t();
      const installed = g.supplies.reduce((a, b) => a + b, 0);
      const act = g.act === 2 ? 2 : 1;
      this.emit({
        k: 'match_end',
        matchId: m.id,
        endedAt: Date.now(),
        outcome,
        lastDay: g.day,
        lastPhase: phase,
        nightsSurvived: m.nightsSurvived,
        durationS: t,
        peakPlayers: m.peak,
        uniquePlayers: m.ids.size,
        playerSeconds: r1(m.playerSeconds),
        suppliesInstalled: installed,
        suppliesNeeded: total(suppliesOf(act).need),
        engineStartedS: m.engineS,
        escaped,
        kills: m.kills,
        deaths: m.deaths,
        downs: m.downs,
        revives: m.revives,
        structuresBuilt: m.built,
        structuresLost: m.lost,
        summary: {
          act,
          startAct: m.startAct,
          crossing: m.crossing,
          supplies: m.supplies,
          planeParts: m.planeParts,
          supplyLog: m.supplyLog,
          bosses: m.bosses,
          schematics: m.schematics,
          crates: { dropped: m.crates.dropped, opened: m.crates.opened, radioCalls: m.radioCalls },
          carAlarms: m.carAlarms,
          bells: m.bells,
          killsByType: m.killsByType,
          killsByWeapon: m.killsByWeapon,
          zombieDeaths: m.zombieDeaths, // every zombie that died, by what killed it (not player-zombies)
          deathsByCause: m.deathsByCause,
          downsByCause: m.downsByCause,
          builtByType: m.builtByType,
          lostByType: m.lostByType,
          crafted: m.crafted,
          craftedItems: m.craftedItems,
          usedItems: m.usedItems,
          cachesSearched: m.cachesSearched,
          cachesByType: m.cachesByType,
          deerKilled: m.deer,
          joins: m.joins,
          leaves: m.leaves,
          phaseSeconds: round1All(m.phaseS),
          engineStartedDay: m.engineDay,
          engineReadyS: m.engineReadyS,
          finalStandS: m.engineS !== null && phase === 'final_stand' ? r1(t - m.engineS) : null,
          driver: driver ? driver.name : null,
          seed: g.seed >>> 0,
        },
      });
    } catch (err) {
      g.log(`analytics: could not finish the match: ${err.stack || err.message}`);
    } finally {
      for (const p of g.players.values()) p.ts = null;
      this.m = null;
    }
  }

  // how a stint that the match's end closes came out
  outcomeOf(p, outcome) {
    if (!p.alive) return 'dead';
    if (p.zombie) return 'turned';
    if (outcome !== 'victory') return 'alive';
    const car = this.g.world.car;
    return Math.hypot(p.state.x - car.x, p.state.z - car.z) <= ESCAPE_RADIUS ? 'escaped' : 'left_behind';
  }

  // ---------------------------------------------------------------- stints
  beginStint(p, carried = false) {
    const m = this.m;
    const g = this.g;
    const id = identity(p);
    const first = !m.ids.has(id);
    m.ids.add(id);
    m.joins++;
    p.ts = {
      first,
      name: p.name,
      userId: p.account || null,
      guestKey: p.guestKey || null,
      joinedAt: Date.now(),
      t: g.time,
      lastT: g.time, // when account() last looked
      lifeT: g.time, // when they last came into the run as a survivor
      downT: 0,
      deathT: 0,
      joinedDay: g.day,
      joinedPhase: this.phase(),
      x: p.state.x,
      z: p.state.z,
      kills: 0,
      zombieKills: 0,
      deaths: 0,
      downs: 0,
      revivesGiven: 0,
      revivesReceived: 0,
      damageDealt: 0,
      damageTaken: 0,
      shots: 0,
      hits: 0,
      headshots: 0,
      bossKills: 0,
      nightsSurvived: 0,
      distanceM: 0,
      crafted: 0,
      built: 0,
      itemsUsed: 0,
      cachesSearched: 0,
      suppliesFound: 0,
      suppliesInstalled: 0,
      pingSum: 0,
      pingN: 0,
      killsByType: {},
      killsByWeapon: {},
      damageTakenBy: {},
      shotsByWeapon: {},
      hitsByWeapon: {},
      craftedItems: {},
      builtTypes: {},
      usedItems: {},
      st: {
        secondsAlive: 0, // a survivor on their feet
        secondsDowned: 0,
        secondsDead: 0, // lying dead, before rising
        secondsTurned: 0,
        turnedDistanceM: 0,
        turnedDamageDealt: 0,
        turnedDamageTaken: 0,
        turnedDeaths: 0, // put down while turned
        swings: 0,
        swingHits: 0,
        headshotKills: 0,
        meleeKills: 0,
        medkitRevives: 0,
        returnedAtDawn: 0,
        pinned: 0, // by a leaper
        roped: 0, // by a roper
        schematics: 0,
        cratesOpened: 0,
        carAlarms: 0,
        radioCalls: 0,
        bellRings: 0,
        deerKilled: 0,
        maxCarDistM: 0,
        longestLifeS: 0,
      },
    };
    m.peak = Math.max(m.peak, g.players.size);
    this.event('join', p, { state: stateOf(p), firstStint: first, carried, players: g.players.size });
  }

  closeStint(p, reason, outcome) {
    const s = p.ts;
    const m = this.m;
    const g = this.g;
    this.accountOne(p, s, g.time);
    p.ts = null;
    const seconds = g.time - s.t;
    m.playerSeconds += seconds;
    const st = s.st;
    if (p.alive && !p.zombie) st.longestLifeS = Math.max(st.longestLifeS, g.time - s.lifeT);
    const stats = round1All(st);
    stats.state = stateOf(p); // what they were as the stint closed: alive | downed | dead | turned
    this.emit({
      k: 'player',
      matchId: m.id,
      userId: s.userId,
      guestKey: s.guestKey,
      name: s.name,
      firstStint: s.first,
      joinedAt: s.joinedAt,
      leftAt: Date.now(),
      seconds: r1(seconds),
      joinedDay: s.joinedDay,
      joinedPhase: s.joinedPhase,
      leftDay: g.day,
      leftPhase: this.phase(),
      leftReason: reason,
      outcome,
      kills: s.kills,
      zombieKills: s.zombieKills,
      deaths: s.deaths,
      downs: s.downs,
      revivesGiven: s.revivesGiven,
      revivesReceived: s.revivesReceived,
      damageDealt: r1(s.damageDealt),
      damageTaken: r1(s.damageTaken),
      shots: s.shots,
      hits: s.hits,
      headshots: s.headshots,
      bossKills: s.bossKills,
      nightsSurvived: s.nightsSurvived,
      distanceM: r1(s.distanceM),
      crafted: s.crafted,
      built: s.built,
      itemsUsed: s.itemsUsed,
      cachesSearched: s.cachesSearched,
      suppliesFound: s.suppliesFound,
      suppliesInstalled: s.suppliesInstalled,
      pingAvg: s.pingN ? r1(s.pingSum / s.pingN) : null,
      killsByType: s.killsByType,
      killsByWeapon: s.killsByWeapon,
      damageTakenBy: round1All(s.damageTakenBy),
      shotsByWeapon: s.shotsByWeapon,
      hitsByWeapon: s.hitsByWeapon,
      craftedItems: s.craftedItems,
      builtTypes: s.builtTypes,
      usedItems: s.usedItems,
      stats,
    });
  }

  // Game.handleJoin, once the newcomer is in (a join that started the run already has its stint: start)
  join(p) {
    if (!this.m || p.ts) return;
    this.beginStint(p);
  }
  // Game.removePlayer, before anything of theirs is touched
  leave(p) {
    const m = this.m;
    const s = p.ts;
    if (!m || !s) return;
    m.leaves++;
    this.event('leave', p, { state: stateOf(p), seconds: r1(this.g.time - s.t), players: this.g.players.size - 1 });
    this.closeStint(p, 'left', 'left');
  }

  // ---------------------------------------------------------------- once a second (Game.update calls it every tick)
  tick() {
    const m = this.m;
    if (!m) return;
    const g = this.g;
    if (g.tick % SERVER_TICK_RATE !== 0) return;
    this.account();
    if (g.time - m.t0 >= m.nextSample) {
      m.nextSample += SAMPLE_EVERY;
      this.sample();
    }
  }
  // time in each state and phase, distance walked, the furthest from the car, ping - since the last look
  account() {
    const m = this.m;
    const g = this.g;
    const now = g.time;
    const ph = this.phase();
    if (ph) m.phaseS[ph] += now - m.lastT;
    m.lastT = now;
    for (const p of g.players.values()) if (p.ts) this.accountOne(p, p.ts, now);
  }
  accountOne(p, s, now) {
    const dt = now - s.lastT;
    if (dt <= 0) return;
    s.lastT = now;
    const st = s.st;
    if (!p.alive) st.secondsDead += dt;
    else if (p.zombie) st.secondsTurned += dt;
    else if (p.downed) st.secondsDowned += dt;
    else st.secondsAlive += dt;
    const x = p.state.x;
    const z = p.state.z;
    const d = Math.hypot(x - s.x, z - s.z);
    s.x = x;
    s.z = z;
    if (p.alive && d <= MOVE_MAX * dt + 1) {
      if (p.zombie) st.turnedDistanceM += d;
      else s.distanceM += d;
    }
    if (p.alive && !p.zombie) {
      const car = this.g.world.car;
      const cd = Math.hypot(x - car.x, z - car.z);
      if (cd > st.maxCarDistM) st.maxCarDistM = cd;
    }
    if (p.ping > 0) {
      s.pingSum += p.ping;
      s.pingN++;
    }
  }
  sample() {
    const m = this.m;
    const g = this.g;
    let players = 0;
    let survivors = 0;
    let downed = 0;
    let ping = 0;
    let pinged = 0;
    for (const p of g.players.values()) {
      players++;
      if (p.alive && !p.zombie) {
        survivors++;
        if (p.downed) downed++;
      }
      if (p.ping > 0) {
        ping += p.ping;
        pinged++;
      }
    }
    let zombies = 0;
    for (const z of g.zombies) if (!z.dead) zombies++;
    const w = g.tickStats.window; // the last 10 s window the worker closed (none yet: no p99)
    this.emit({
      k: 'sample',
      matchId: m.id,
      at: Date.now(),
      t: this.t(),
      day: g.day,
      phase: this.phase(),
      players,
      survivors, // living survivors, the downed among them
      downed,
      dead: players - survivors, // lying dead or turned
      zombies,
      tickMs: r2(g.stats.tickMs),
      tickP99: w.ticks ? r2(w.p99Ms) : null,
      pingAvg: pinged ? r1(ping / pinged) : null,
    });
  }

  // ---------------------------------------------------------------- nights
  // Game.startNight, once the waves and the boss are set
  nightfall() {
    const m = this.m;
    if (!m) return;
    const g = this.g;
    if (m.night) {
      if (m.night.n === g.day) m.night = null; // (the same night begun again: debug and tests)
      else this.endNight('abandoned');
    }
    let horde = 0;
    for (const wv of g.waves) horde += wv.queue.length;
    const theme = g.themes ? nightTheme(g.seed, g.day) : null;
    const bossType = g.bossPending && g.bossPending.types ? g.bossPending.types[0] : undefined;
    const survivors = this.survivors();
    m.night = {
      n: g.day,
      startedAt: Date.now(),
      t: g.time,
      theme: theme ? theme.id : null,
      boss: bossType === undefined ? null : zombieName(bossType),
      bossKilled: false,
      hordeSize: horde,
      hordeHpMul: r2(g.hordeHpMul),
      playersStart: g.players.size,
      survivorsStart: survivors,
    };
    this.event('night_start', null, { night: g.day, theme: m.night.theme, boss: m.night.boss, hordeSize: horde, hordeHpMul: m.night.hordeHpMul, survivors, players: g.players.size });
  }
  // Game.startDay, with the day moved on and before the dead come back (night: the number of the night just over)
  dawn(night) {
    const m = this.m;
    if (!m) return;
    const g = this.g;
    // (a sunrise with no night before it - debug, tests - is no night survived)
    if (m.night) {
      m.nightsSurvived++;
      for (const p of g.players.values()) if (p.ts && p.alive && !p.zombie) p.ts.nightsSurvived++;
    }
    const st = g.nightStats;
    this.event('dawn', null, { night, survivors: this.survivors(), players: g.players.size, kills: st.kills, downs: st.downs, deaths: st.deaths, revives: st.revives, structuresLost: st.structLost });
    this.endNight('dawn');
  }
  endNight(outcome) {
    const m = this.m;
    const n = m.night;
    if (!n) return;
    m.night = null;
    const g = this.g;
    const st = g.nightStats;
    this.emit({
      k: 'night',
      matchId: m.id,
      night: n.n,
      startedAt: n.startedAt,
      endedAt: Date.now(),
      durationS: r1(g.time - n.t),
      theme: n.theme,
      boss: n.boss,
      bossKilled: n.bossKilled,
      hordeSize: n.hordeSize,
      hordeHpMul: n.hordeHpMul,
      playersStart: n.playersStart,
      survivorsStart: n.survivorsStart,
      survivorsEnd: this.survivors(),
      kills: st.kills,
      structuresLost: st.structLost,
      downs: st.downs,
      deaths: st.deaths,
      revives: st.revives,
      outcome,
    });
  }

  // ---------------------------------------------------------------- combat (hot: counters only)
  // Combat.fire: one shot (a blast of pellets is one)
  shot(p, weapon) {
    const s = p.ts;
    if (!s) return;
    bump(s.shotsByWeapon, itemName(weapon));
    if (weapon !== ITEM.FLAMETHROWER) s.shots++;
  }
  // ...that struck something (head: a head among it)
  hit(p, weapon, head) {
    const s = p.ts;
    if (!s) return;
    bump(s.hitsByWeapon, itemName(weapon));
    if (weapon === ITEM.FLAMETHROWER) return;
    s.hits++;
    if (head) s.headshots++;
  }
  // Combat.melee: one swing, and whether it struck anyone
  swing(p, hit) {
    const s = p.ts;
    if (!s) return;
    s.st.swings++;
    if (hit) s.st.swingHits++;
  }
  // Combat.damageZombie, before the blow comes off its health: what a survivor took off one of the dead
  dealt(a, z, amount) {
    const s = a && a.ts;
    if (!s) return;
    s.damageDealt += amount < z.hp ? amount : z.hp > 0 ? z.hp : 0;
  }
  // Game.damagePlayer, armour taken off and before the blow comes off their health
  hurt(p, amount, src) {
    const s = p.ts;
    if (!s) return;
    const d = amount < p.hp ? amount : p.hp > 0 ? p.hp : 0;
    if (src.kind === KILLER.PLAYER) {
      const a = this.g.players.get(src.id);
      const as = a && a.ts;
      if (as) {
        if (a.zombie) as.st.turnedDamageDealt += d;
        else as.damageDealt += d;
      }
    }
    if (p.zombie) {
      s.st.turnedDamageTaken += d;
      return;
    }
    s.damageTaken += d;
    bump(s.damageTakenBy, this.cause(src), d);
  }
  // Combat.killZombie: one of the dead died. a: the survivor credited with it (null: a trap, the sun, its own blast...)
  zombieDied(z, a, opts, sunKill) {
    const m = this.m;
    if (!m) return;
    const s = a && a.ts;
    const type = zombieName(z.ztype);
    const zd = m.zombieDeaths;
    if (s) {
      zd.player++;
      m.kills++;
      s.kills++;
      bump(s.killsByType, type);
      bump(m.killsByType, type);
      const w = killWeapon(opts);
      bump(s.killsByWeapon, w);
      bump(m.killsByWeapon, w);
      if (opts.headshot) s.st.headshotKills++;
      if (opts.melee) s.st.meleeKills++;
      if (z.boss && !sunKill) s.bossKills++;
    } else if (sunKill || z.onFire) zd.sun++;
    else if (opts.trap) zd.trap++;
    else if (opts.explode) zd.explosion++;
    else if (opts.fire) zd.fire++;
    else zd.other++;
    if (z.boss) this.bossDied(z, s ? a : null, opts, sunKill);
  }
  // a leaper's pin or a roper's rope took hold of p (how: 'pinned' | 'roped')
  grabbed(p, how) {
    const s = p.ts;
    if (s) s.st[how]++;
  }
  // deer.js: a deer was killed (a: whoever did it, if anyone)
  deerKilled(a) {
    const m = this.m;
    if (!m) return;
    m.deer++;
    const s = a && a.ts;
    if (s) s.st.deerKilled++;
  }

  // ---------------------------------------------------------------- survivors (rare: events)
  // Game.goDown, as they go down
  down(p) {
    const m = this.m;
    const s = p.ts;
    if (!m || !s) return;
    s.downs++;
    m.downs++;
    s.downT = this.g.time;
    const cause = this.cause(p.lastSrc);
    bump(m.downsByCause, cause);
    const around = this.surroundings(p);
    this.event('down', p, { cause, zombiesNear: around.zombiesNear, nearestMateM: around.mateM, armor: Math.round(fin(p.armor)), standing: this.g.standing() });
  }
  // Game.revive, as they get up (by: the teammate, null for their own medkit)
  revive(p, by) {
    const m = this.m;
    const s = p.ts;
    if (!m || !s) return;
    m.revives++;
    if (by && by.ts) {
      by.ts.revivesGiven++;
      s.revivesReceived++;
    } else s.st.medkitRevives++;
    this.event('revive', p, { by: by ? by.name : null, medkit: !by, downedS: r1(this.g.time - s.downT) });
  }
  // Game.killPlayer, before anything about them changes (silent: the wipe putting the last of the downed out)
  death(p, src, silent) {
    const m = this.m;
    const s = p.ts;
    if (!m || !s) return;
    const g = this.g;
    const killer = src.kind === KILLER.PLAYER ? g.players.get(src.id) : null;
    const ks = killer && killer.ts;
    if (p.zombie) {
      // a player-zombie put down: the survivor's kill
      s.st.turnedDeaths++;
      if (ks && !killer.zombie) {
        const w = src.weapon ? itemName(src.weapon) : 'unknown';
        ks.kills++;
        m.kills++;
        bump(ks.killsByType, 'turned_player');
        bump(m.killsByType, 'turned_player');
        bump(ks.killsByWeapon, w);
        bump(m.killsByWeapon, w);
        if (src.headshot) ks.st.headshotKills++;
      }
      return;
    }
    const cause = this.cause(src);
    s.deaths++;
    m.deaths++;
    bump(m.deathsByCause, cause);
    if (ks && killer.zombie) ks.zombieKills++;
    const lifeS = g.time - s.lifeT;
    s.deathT = g.time;
    s.st.longestLifeS = Math.max(s.st.longestLifeS, lifeS);
    const around = this.surroundings(p);
    this.event('death', p, {
      cause,
      killer: killer ? killer.name : src.kind === KILLER.ZOMBIE ? zombieName(src.ztype) : null,
      weapon: killer && src.weapon ? itemName(src.weapon) : null,
      wasDowned: !!p.downed,
      downedS: p.downed ? r1(g.time - s.downT) : null,
      wipe: !!silent,
      aliveS: r1(lifeS),
      zombiesNear: around.zombiesNear,
      nearestMateM: around.mateM,
    });
  }
  // Game.spawnPlayerZombie: they rise as one of the dead (a rejoin that comes back dead has no stint yet: its join says so)
  turned(p) {
    const s = p.ts;
    if (!this.m || !s) return;
    this.event('turned', p, { deadS: r1(this.g.time - s.deathT) });
  }
  // Game.returnFallen: a survivor again at sunrise
  returned(p) {
    const s = p.ts;
    if (!this.m || !s) return;
    s.st.returnedAtDawn++;
    s.lifeT = this.g.time;
    this.event('returned_at_dawn', p);
  }

  // ---------------------------------------------------------------- bosses
  // Game.spawnBosses, for each one that came
  bossSpawn(z) {
    const m = this.m;
    if (!m) return;
    const g = this.g;
    const e = { type: zombieName(z.ztype), night: g.day, final: !!g.escape.active, spawnS: this.t(), hp: Math.round(fin(z.maxHp)), killed: false, cause: null, by: null, weapon: null, killedS: null, aliveS: null };
    m.bosses.push(e);
    m.bossOf.set(z, e);
    this.event('boss_spawn', null, { type: e.type, hp: e.hp, final: e.final }, z.x, z.z);
  }
  bossDied(z, a, opts, sunKill) {
    const m = this.m;
    const g = this.g;
    let e = m.bossOf.get(z);
    if (e) m.bossOf.delete(z);
    else {
      // (one that came some other way: /spawn)
      e = { type: zombieName(z.ztype), night: g.day, final: !!g.escape.active, spawnS: null, hp: Math.round(fin(z.maxHp)), killed: false, cause: null, by: null, weapon: null, killedS: null, aliveS: null };
      m.bosses.push(e);
    }
    const t = this.t();
    // a boss the dawn sun has set alight is the sun's, whoever lands the last blow (Combat.killZombie)
    e.killed = !sunKill && !z.onFire;
    e.cause = sunKill || z.onFire ? 'sun' : a ? 'player' : opts.trap ? 'trap' : opts.fire ? 'fire' : opts.explode ? 'explosion' : 'other';
    e.by = a ? a.name : null;
    e.weapon = a ? killWeapon(opts) : null;
    e.killedS = t;
    e.aliveS = e.spawnS === null ? null : r1(t - e.spawnS);
    if (e.killed && m.night && !e.final && e.night === m.night.n) m.night.bossKilled = true;
    this.event('boss_kill', a, { type: e.type, cause: e.cause, killed: e.killed, weapon: e.weapon, aliveS: e.aliveS, final: e.final }, z.x, z.z);
  }

  // ---------------------------------------------------------------- the run
  // Game.removeItemEnt: a car supply was taken from its hiding place (e: the item, still where it lay). Whoever took
  // it is the survivor nearest it: it only ever leaves that spot in someone's hands.
  supplyFound(e) {
    const m = this.m;
    if (!m || m.moving) return; // (moving: nobody took it - the island went with it still hidden)
    const g = this.g;
    let by = null;
    let best = 6;
    for (const p of g.players.values()) {
      if (!p.alive || p.zombie) continue;
      const d = Math.hypot(p.state.x - e.x, p.state.z - e.z);
      if (d < best) {
        best = d;
        by = p;
      }
    }
    if (by && by.ts) by.ts.suppliesFound++;
    const item = itemName(e.item);
    const zone = ZONE_NAME[g.supplyHints[e.hint]] ?? null;
    const t = this.t();
    const act = g.act === 2 ? 2 : 1;
    const sp = (act === 2 ? m.planeParts : m.supplies)?.[item];
    if (sp) {
      sp.found++;
      if (sp.firstFoundS === null) {
        sp.firstFoundS = t;
        sp.firstFoundDay = g.day;
      }
    }
    m.supplyLog.push({ e: 'found', item, n: 1, t, day: g.day, phase: this.phase(), by: by ? by.name : null, zone, act });
    this.event('supply_found', by, { item, zone, act }, e.x, e.z);
  }
  // Game.interact at the car (on the mainland, the plane): n of a supply put in
  install(p, item, n) {
    const m = this.m;
    if (!m) return;
    const g = this.g;
    if (p.ts) p.ts.suppliesInstalled += n;
    const name = itemName(item);
    const act = g.act === 2 ? 2 : 1;
    const { items, need } = suppliesOf(act);
    const i = items.indexOf(item);
    const t = this.t();
    const sp = (act === 2 ? m.planeParts : m.supplies)?.[name];
    if (sp && i >= 0) {
      sp.installed = g.supplies[i];
      if (sp.firstInstalledS === null) sp.firstInstalledS = t;
      if (g.supplies[i] >= need[i] && sp.doneS === null) {
        sp.doneS = t;
        sp.doneDay = g.day;
      }
    }
    m.supplyLog.push({ e: 'install', item: name, n, t, day: g.day, phase: this.phase(), by: p.name, zone: null, act });
    const installed = g.supplies.reduce((a, b) => a + b, 0);
    const needed = total(need);
    this.event('supply_install', p, { item: name, n, installed, needed, complete: installed >= needed, act });
  }
  // Game.unlockSchematic, for a new one (p: who found it, null for /unlock)
  schematic(item, p) {
    const m = this.m;
    if (!m) return;
    const name = itemName(item);
    if (p && p.ts) p.ts.st.schematics++;
    m.schematics.push({ item: name, t: this.t(), day: this.g.day, phase: this.phase(), by: p ? p.name : null });
    this.event('schematic', p, { item: name });
  }
  // Game.startEngine, with the final stand begun
  engineStart(p) {
    const m = this.m;
    if (!m) return;
    const g = this.g;
    m.engineS = this.t();
    m.engineDay = g.day;
    this.event('engine_start', p, { during: g.phase === PHASE.NIGHT ? 'night' : 'day', survivors: this.survivors(), players: g.players.size });
  }
  // Game.updateEscape: the engine is warm, somebody can drive
  engineReady() {
    const m = this.m;
    if (!m) return;
    m.engineReadyS = this.t();
    this.event('engine_ready', null, { survivors: this.survivors(), warmupS: m.engineS === null ? null : r1(m.engineReadyS - m.engineS) });
  }
  // Game.driveOff: p got in and drove (the crossing follows, or on the mainland victory)
  drove(p) {
    if (this.m) this.m.driver = p;
  }
  // Game.cross, before the island is cleared: the car is away to the mainland (by: who drove, or null; night: it
  // left in the night). Who was what as it left is the crossing's record; a night it left in ends here, escaped.
  // What the car's engine was is kept with it: the match's engine times are the plane's from here on.
  crossed(by, night = false) {
    const m = this.m;
    if (!m || m.crossing) return;
    const g = this.g;
    this.account();
    const car = g.world.car;
    const c = { t: this.t(), day: g.day, phase: this.phase(), night: !!night, driver: by ? by.name : null, players: g.players.size, alive: 0, downed: 0, dead: 0, turned: 0, aboard: 0, back: null, arrivedS: null, arrivedDay: null, engineStartedS: m.engineS, engineStartedDay: m.engineDay, engineReadyS: m.engineReadyS };
    for (const p of g.players.values()) {
      if (!p.alive || p.zombie) m.fallen.push(p);
      if (!p.alive) c.dead++;
      else if (p.zombie) c.turned++;
      else {
        c.alive++;
        if (p.downed) c.downed++;
        if (Math.hypot(p.state.x - car.x, p.state.z - car.z) <= ESCAPE_RADIUS) c.aboard++;
      }
    }
    this.event('crossing', by && g.players.get(by.id) === by ? by : null, { ...c });
    if (m.night) this.endNight('escaped');
    m.crossing = c;
    m.planeParts = supplyRows(2);
    m.engineS = m.engineDay = m.engineReadyS = null;
    m.driver = null;
    m.moving = true;
  }
  // Game.arrive: the team is off the bridge and the first day on the mainland begins. back: how many of the dead and
  // the turned the checkpoint brought back
  arrived(back = 0) {
    const m = this.m;
    if (!m) return;
    m.moving = false;
    const c = m.crossing;
    if (!c || c.arrivedS !== null) return;
    c.back = back;
    c.arrivedS = this.t();
    c.arrivedDay = this.g.day;
    for (const p of m.fallen) if (p.ts && p.alive && !p.zombie) p.ts.lifeT = this.g.time; // (a survivor again)
    m.fallen = [];
    this.event('arrival', null, { back, day: c.arrivedDay, survivors: this.survivors(), players: this.g.players.size, crossingS: r1(c.arrivedS - c.t) });
  }
  // Game.flySupplyDrop: a plane is on its way with a crate for (x, z)
  crateDrop(x, z) {
    const m = this.m;
    if (!m) return;
    m.crates.dropped++;
    this.event('crate_drop', null, { n: m.crates.dropped }, x, z);
  }
  crateOpened(p) {
    const m = this.m;
    if (!m) return;
    m.crates.opened++;
    if (p.ts) p.ts.st.cratesOpened++;
  }
  // Game.triggerCarAlarm: a trunk's alarm went off and brought n of the dead
  carAlarm(p, n) {
    const m = this.m;
    if (!m) return;
    m.carAlarms++;
    if (p.ts) p.ts.st.carAlarms++;
    this.event('car_alarm', p, { zombies: n });
  }
  // fixtures.js: the chapel bell rung, the Relay Station's radio called a plane
  bell(p) {
    const m = this.m;
    if (!m) return;
    m.bells++;
    if (p.ts) p.ts.st.bellRings++;
    this.event('bell', p);
  }
  radioCall(p) {
    const m = this.m;
    if (!m) return;
    m.radioCalls++;
    if (p.ts) p.ts.st.radioCalls++;
    this.event('radio_call', p);
  }

  // ---------------------------------------------------------------- scavenging and building (counters)
  searched(p, c) {
    const m = this.m;
    const s = p.ts;
    if (!m || !s) return;
    s.cachesSearched++;
    m.cachesSearched++;
    bump(m.cachesByType, CNAME[c.ctype] || 'container');
  }
  craft(p, rec) {
    const m = this.m;
    const s = p.ts;
    if (!m || !s) return;
    const name = itemName(rec.out);
    s.crafted++;
    bump(s.craftedItems, name);
    m.crafted++;
    bump(m.craftedItems, name);
  }
  // a consumable used up, or a throwable thrown
  used(p, item) {
    const m = this.m;
    const s = p.ts;
    if (!m || !s) return;
    const name = itemName(item);
    s.itemsUsed++;
    bump(s.usedItems, name);
    bump(m.usedItems, name);
  }
  build(p, type) {
    const m = this.m;
    const s = p.ts;
    if (!m || !s) return;
    const name = SNAME[type] || 'structure';
    s.built++;
    bump(s.builtTypes, name);
    m.built++;
    bump(m.builtByType, name);
  }
  // Game.destroyStructure: one was broken (not taken down or burnt out)
  structureLost(e) {
    const m = this.m;
    if (!m) return;
    m.lost++;
    bump(m.lostByType, SNAME[e.stype] || 'structure');
  }
}
