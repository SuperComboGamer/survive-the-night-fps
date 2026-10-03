// Match analytics (server/analytics.js) against a real Game in-process, its records caught by a memory sink:
//   - a run from the first join to the car driving off: joins (an account, a guest, a bot), shots, hits and kills by
//     weapon, a craft, a build, an item used, a cache searched, a supply found and the car's supplies put in, a
//     night from nightfall to dawn with its boss killed, a survivor down and revived, one dead, turned and put down,
//     a leave and a rejoin (two stints, the second not the first), samples every 30 s, the engine and the escape;
//   - the next run, begun with everyone still there, abandoned by the last of them leaving mid-match;
//   - a wipe; and a run stopped from outside (finish('interrupted')) in the middle of a night;
//   - every record has exactly its fields, nothing undefined, every number finite, and one match_end per match;
//     the guest's browser id never comes out, only its key; and a Game without a sink keeps nothing at all.
// usage: node scripts/test-analytics.js [seed = 4242]
import { createHash } from 'node:crypto';
import { Game } from '../server/game.js';
import { SAMPLE_EVERY, itemName } from '../server/analytics.js';
import { C2S, S2C, CAR_ID, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { PHASE, EYE_HEIGHT, SLOT_BUILD, ESCAPE_RADIUS, GAME_OVER_DELAY } from '../shared/constants.js';
import { ITEM, ZTYPE, KILLER, STRUCT, SUPPLIES, SUPPLY_NEED } from '../shared/defs.js';
import { raycastWorld } from '../shared/collision.js';

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// ---------------------------------------------------------------- record shapes (the columns of 002_matches.sql)
const KEYS = {
  match: ['k', 'id', 'startedAt', 'seed', 'startDay', 'seats', 'protocol', 'settings'],
  match_end: ['k', 'matchId', 'endedAt', 'outcome', 'lastDay', 'lastPhase', 'nightsSurvived', 'durationS', 'peakPlayers', 'uniquePlayers', 'playerSeconds', 'suppliesInstalled', 'suppliesNeeded', 'engineStartedS', 'escaped', 'kills', 'deaths', 'downs', 'revives', 'structuresBuilt', 'structuresLost', 'summary'],
  player: ['k', 'matchId', 'userId', 'guestKey', 'name', 'firstStint', 'joinedAt', 'leftAt', 'seconds', 'joinedDay', 'joinedPhase', 'leftDay', 'leftPhase', 'leftReason', 'outcome', 'kills', 'zombieKills', 'deaths', 'downs', 'revivesGiven', 'revivesReceived', 'damageDealt', 'damageTaken', 'shots', 'hits', 'headshots', 'bossKills', 'nightsSurvived', 'distanceM', 'crafted', 'built', 'itemsUsed', 'cachesSearched', 'suppliesFound', 'suppliesInstalled', 'pingAvg', 'killsByType', 'killsByWeapon', 'damageTakenBy', 'shotsByWeapon', 'hitsByWeapon', 'craftedItems', 'builtTypes', 'usedItems', 'stats'],
  night: ['k', 'matchId', 'night', 'startedAt', 'endedAt', 'durationS', 'theme', 'boss', 'bossKilled', 'hordeSize', 'hordeHpMul', 'playersStart', 'survivorsStart', 'survivorsEnd', 'kills', 'structuresLost', 'downs', 'deaths', 'revives', 'outcome'],
  event: ['k', 'matchId', 'at', 't', 'day', 'phase', 'type', 'userId', 'name', 'x', 'z', 'data'],
  sample: ['k', 'matchId', 'at', 't', 'day', 'phase', 'players', 'survivors', 'downed', 'dead', 'zombies', 'tickMs', 'tickP99', 'pingAvg'],
};
const EVENT_TYPES = new Set(['join', 'leave', 'down', 'death', 'revive', 'turned', 'returned_at_dawn', 'night_start', 'dawn', 'boss_spawn', 'boss_kill', 'supply_found', 'supply_install', 'schematic', 'engine_start', 'engine_ready', 'crate_drop', 'car_alarm', 'radio_call', 'bell', 'victory', 'wipe', 'abandoned', 'interrupted']);
const PHASES = new Set(['day', 'night', 'final_stand']);
const shapeErrors = [];
// undefined anywhere, or a number that is not finite (JSON would turn those into null or drop them unseen)
function walk(v, path) {
  if (v === undefined) shapeErrors.push(`${path} is undefined`);
  else if (typeof v === 'number' && !Number.isFinite(v)) shapeErrors.push(`${path} = ${v}`);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
}
const recs = [];
const sink = (rec) => {
  const want = KEYS[rec.k];
  if (!want) shapeErrors.push(`unknown kind ${rec.k}`);
  else {
    const have = Object.keys(rec).sort().join();
    if (have !== [...want].sort().join()) shapeErrors.push(`${rec.k}: fields ${have}`);
  }
  walk(rec, rec.k);
  recs.push(JSON.parse(JSON.stringify(rec))); // (as the worker would post it)
};

// ---------------------------------------------------------------- a game and its clients
const game = new Game({ seed, dayLength: 3600, nightLength: 3600, log: () => {}, analytics: sink });
// The dead stand still: every hurt in this test is dealt by the test, so what comes out is what it put in
game.zm.update = () => {};
const run = (ticks) => {
  for (let i = 0; i < ticks; i++) game.update();
};
function connect(name, { user = null, pid = '' } = {}) {
  const c = { id: 0, name };
  c.conn = {
    user,
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(128);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  if (pid) w.str(pid);
  game.onMessage(c.session, w.bytes().slice());
  c.p = game.players.get(c.id);
  return c;
}
const leave = (c) => game.onClose(c.session);
const of = (k, id) => recs.filter((r) => r.k === k && (id === undefined || r.matchId === id || r.id === id));
const events = (id, type) => of('event', id).filter((e) => !type || e.type === type);
const stints = (id, name) => of('player', id).filter((r) => !name || r.name === name);
const zsrc = (ztype, at) => ({ kind: KILLER.ZOMBIE, ztype, x: at.state.x + 1, z: at.state.z });
const near = (p, d = 6, yaw = p.state.yaw) => ({ x: p.state.x - Math.sin(yaw) * d, z: p.state.z - Math.cos(yaw) * d });

const ACCOUNT = { id: '1f0e2d3c-4b5a-4697-8877-665544332211', name: 'Ann' };
const GUEST_PID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const sha = (id) => createHash('sha256').update(id).digest('hex');

// ================================================================ match 1: the whole run
const ann = connect('ignored', { user: ACCOUNT });
const bob = connect('Bob', { pid: GUEST_PID });
const cy = connect('Cy'); // a bot: no id at all
const m1 = of('match')[0];
check('the first join starts a match: one match record with the run\'s settings', of('match').length === 1 && m1.seed === seed && m1.startDay === 1 && m1.seats === game.maxPlayers && m1.protocol === PROTOCOL_VERSION && m1.settings.dayLen === 3600 && m1.settings.nightLen === 3600 && m1.settings.godMode === false && typeof m1.id === 'string' && m1.id.length === 36, JSON.stringify(m1 && m1.settings));
check('every join is an event, the signed-in player under their account', events(m1.id, 'join').length === 3 && events(m1.id, 'join')[0].userId === ACCOUNT.id && events(m1.id, 'join')[0].name === 'Ann' && events(m1.id, 'join')[1].userId === null && events(m1.id, 'join').every((e) => e.phase === 'day' && e.day === 1));

// ---- shots, hits and kills by weapon (Ann, day 1)
{
  const p = ann.p;
  const s = p.state;
  const ey = s.y + EYE_HEIGHT;
  // a heading with nothing solid for 8 m
  let yaw = s.yaw;
  const ray = { t: -1, col: null, terrain: false };
  for (let k = 0; k < 16; k++) {
    const a = s.yaw + (k * Math.PI) / 8;
    raycastWorld(game.world, s.x, ey, s.z, -Math.sin(a), 0, -Math.cos(a), 8, ray);
    if (ray.t < 0) {
      yaw = a;
      break;
    }
  }
  const at = near(p, 6, yaw);
  const z = game.zm.spawn(ZTYPE.WALKER, at.x, at.z, {});
  const fire = (pitchUp = 0) => {
    p.renderTick = game.tick & 0xffff;
    p.renderFrac = 0;
    const dx = z.x - s.x;
    const dz = z.z - s.z;
    const d = Math.hypot(dx, dz);
    const aimYaw = Math.atan2(-dx, -dz);
    const pitch = pitchUp || Math.atan2(z.y + 1.1 - ey, d);
    game.combat.fire(p, { type: 'fire', weapon: ITEM.PISTOL, yaw: aimYaw, pitch, recoilPitch: 0, spread: 0, seed: 7, x: s.x, y: ey, z: s.z });
  };
  fire();
  fire();
  fire();
  fire(1.3); // into the sky
  const st = p.ts;
  check('shots and hits: four pistol shots, three into a walker', st.shots === 4 && st.hits === 3 && st.shotsByWeapon.pistol === 4 && st.hitsByWeapon.pistol === 3 && !z.dead, `shots ${st.shots} hits ${st.hits} (walker hp ${Math.round(z.hp)})`);
  const hp = z.hp;
  game.combat.damageZombie(z, 500, p, { weapon: ITEM.AK47, headshot: true });
  check('a kill by a weapon: killsByType / killsByWeapon / headshot kill, and only what came off its health counts as dealt', z.dead && st.kills === 1 && st.killsByType.walker === 1 && st.killsByWeapon.ak47 === 1 && st.st.headshotKills === 1 && Math.abs(st.damageDealt - z.maxHp) < 0.01, `dealt ${st.damageDealt} of ${z.maxHp} (${Math.round(z.maxHp - hp)} by the pistol)`);
  const r = game.zm.spawn(ZTYPE.RUNNER, at.x, at.z, {});
  game.combat.damageZombie(r, 999, p, { weapon: ITEM.KNIFE, melee: true });
  const t = game.zm.spawn(ZTYPE.WALKER, at.x, at.z, {});
  game.combat.damageZombie(t, 999, null, { trap: true });
  check('a melee kill, and a trap kill on nobody\'s record', st.kills === 2 && st.killsByWeapon.knife === 1 && st.st.meleeKills === 1 && st.killsByType.runner === 1);
  // throw a molotov, craft a bandage, find a schematic, search a cache
  game.combat.throwProjectile(p, ITEM.MOLOTOV);
  game.giveItem(p, ITEM.CLOTH, 2);
  game.craft(p, 1);
  game.giveItem(p, ITEM.SCHEM_SHOTGUN, 1);
  game.searchCache(p, game.caches.find((c) => c.state === 0));
  check('a throwable thrown, a craft, a schematic, a cache: on Ann\'s stint', st.usedItems.molotov === 1 && st.crafted === 1 && st.craftedItems.bandage === 1 && st.st.schematics === 1 && st.cachesSearched === 1 && events(m1.id, 'schematic').length === 1 && events(m1.id, 'schematic')[0].data.item === 'schem_shotgun');
  // build: a barricade somewhere within reach
  s.slot = SLOT_BUILD;
  const before = game.structures.length;
  for (let k = 0; k < 32 && game.structures.length === before; k++) {
    p.actionT = -99;
    const a = (k * Math.PI * 2) / 8;
    const d = 2.5 + Math.floor(k / 8);
    game.build(p, k % 2 ? STRUCT.SPIKES : STRUCT.BARRICADE, s.x - Math.sin(a) * d, s.z - Math.cos(a) * d, 0);
  }
  check('a structure built', st.built === 1 && Object.values(st.builtTypes)[0] === 1, JSON.stringify(st.builtTypes));
  s.slot = 1;
}

// ---- Bob gets hurt and bandages up; Cy finds a car supply
{
  const p = bob.p;
  game.damagePlayer(p, 30, zsrc(ZTYPE.WALKER, p));
  const idx = p.inv.findIndex((it) => it && it.item === ITEM.BANDAGE);
  game.useItem(p, idx);
  run(60);
  check('hurt by a walker, then a bandage used', p.ts.damageTaken === 30 && p.ts.damageTakenBy.walker === 30 && p.ts.usedItems.bandage === 1 && p.ts.itemsUsed === 1, `${JSON.stringify(p.ts.damageTakenBy)} used ${JSON.stringify(p.ts.usedItems)}`);

  const c = cy.p;
  let found = null;
  for (const e of game.items.filter((it) => it.hint >= 0)) {
    c.state.x = e.x;
    c.state.z = e.z;
    c.state.y = e.y;
    c.state.vx = c.state.vz = 0;
    game.fillHistory(c);
    run(8);
    if (e.removed) {
      found = e;
      break;
    }
  }
  const ev = events(m1.id, 'supply_found');
  check('a car supply picked up from its hiding place: found by the survivor who took it, with where it was', !!found && ev.length === 1 && ev[0].name === 'Cy' && ev[0].data.item === itemName(found.item) && c.ts.suppliesFound === 1 && typeof ev[0].data.zone === 'string' && ev[0].x !== null, ev[0] && JSON.stringify(ev[0].data));
}

// ---- a quiet stretch: the samples
run(SAMPLE_EVERY * 20 + 20);
{
  const sm = of('sample', m1.id);
  check('a sample every 30 s of the match, with the server\'s tick time', sm.length >= 1 && sm[0].t >= SAMPLE_EVERY && sm[0].t < SAMPLE_EVERY + 1.5 && sm[0].players === 3 && sm[0].survivors === 3 && sm[0].phase === 'day' && sm[0].tickMs >= 0 && sm[0].pingAvg === null, JSON.stringify(sm[0]));
}

// ---- night 1
game.timeLeft = 0.05;
run(2);
{
  const ns = events(m1.id, 'night_start');
  check('nightfall is an event with the horde\'s size and the boss to come', game.phase === PHASE.NIGHT && ns.length === 1 && ns[0].data.night === 1 && ns[0].data.boss === 'boss_brute' && ns[0].data.hordeSize > 0 && ns[0].phase === 'night', ns[0] && JSON.stringify(ns[0].data));
  game.bossPending.t = 0;
  run(1);
  const boss = game.zombies.find((z) => z.boss && !z.dead);
  check('the night\'s boss comes: boss_spawn', !!boss && events(m1.id, 'boss_spawn').length === 1 && events(m1.id, 'boss_spawn')[0].data.type === 'boss_brute' && events(m1.id, 'boss_spawn')[0].data.final === false);
  run(40);
  game.combat.damageZombie(boss, boss.hp + 1, bob.p, { weapon: ITEM.SHOTGUN });
  const bk = events(m1.id, 'boss_kill');
  check('...and Bob kills it: boss_kill by whom, with what, after how long', bk.length === 1 && bk[0].name === 'Bob' && bk[0].data.weapon === 'shotgun' && bk[0].data.killed === true && bk[0].data.aliveS >= 1.9 && bob.p.ts.bossKills === 1, bk[0] && JSON.stringify(bk[0].data));

  // Bob goes down to a runner and Ann gets him up
  game.damagePlayer(bob.p, 500, zsrc(ZTYPE.RUNNER, bob.p));
  run(20);
  game.revive(bob.p, ann.p);
  const dn = events(m1.id, 'down');
  const rv = events(m1.id, 'revive');
  check('down (cause, where) and revive (by whom, after how long)', dn.length === 1 && dn[0].name === 'Bob' && dn[0].data.cause === 'runner' && dn[0].x !== null && rv.length === 1 && rv[0].data.by === 'Ann' && rv[0].data.downedS >= 0.9 && ann.p.ts.revivesGiven === 1 && bob.p.ts.revivesReceived === 1 && bob.p.ts.downs === 1, rv[0] && JSON.stringify(rv[0].data));

  // Cy goes down to a tank, bleeds out under it and rises as one of the dead
  game.damagePlayer(cy.p, 500, zsrc(ZTYPE.TANK, cy.p));
  game.damagePlayer(cy.p, 1000, zsrc(ZTYPE.TANK, cy.p));
  const dt = events(m1.id, 'death');
  check('a death: what killed them, that they were down, where', dt.length === 1 && dt[0].name === 'Cy' && dt[0].data.cause === 'tank' && dt[0].data.killer === 'tank' && dt[0].data.wasDowned === true && dt[0].x !== null && cy.p.ts.deaths === 1, dt[0] && JSON.stringify(dt[0].data));
  run(130);
  check('...and turned', cy.p.zombie && events(m1.id, 'turned').length === 1 && events(m1.id, 'turned')[0].data.deadS >= 6);
  // turned, Cy claws Ann; Ann puts Cy down
  game.damagePlayer(ann.p, 10, { kind: KILLER.PLAYER, id: cy.id, weapon: 0, x: cy.p.state.x, z: cy.p.state.z });
  game.damagePlayer(cy.p, 999, { kind: KILLER.PLAYER, id: ann.id, weapon: ITEM.PISTOL, headshot: true, x: ann.p.state.x, z: ann.p.state.z });
  check('a turned player\'s blow and its putting down: on both their records, not a survivor death', ann.p.ts.damageTakenBy.turned_player === 10 && cy.p.ts.st.turnedDamageDealt === 10 && ann.p.ts.killsByType.turned_player === 1 && ann.p.ts.killsByWeapon.pistol === 1 && cy.p.ts.st.turnedDeaths === 1 && cy.p.ts.deaths === 1 && events(m1.id, 'death').length === 1);

  // Bob leaves in the middle of the night and comes back
  leave(bob);
  const st1 = stints(m1.id, 'Bob');
  check('a leave ends the stint: leftReason left, outcome left, what they did on it', st1.length === 1 && st1[0].leftReason === 'left' && st1[0].outcome === 'left' && st1[0].firstStint === true && st1[0].bossKills === 1 && st1[0].downs === 1 && st1[0].guestKey === sha(GUEST_PID) && st1[0].userId === null && st1[0].leftPhase === 'night' && st1[0].stats.state === 'alive' && events(m1.id, 'leave').length === 1, st1[0] && `${st1[0].leftReason}/${st1[0].outcome}`);
  Object.assign(bob, connect('Bob', { pid: GUEST_PID }));
  run(30);
}

// ---- dawn
game.timeLeft = 0.05;
run(2);
{
  const nr = of('night', m1.id);
  const n = nr[0];
  check('dawn closes the night: one night record, its boss killed, its downs, deaths and revives', nr.length === 1 && n.night === 1 && n.outcome === 'dawn' && n.boss === 'boss_brute' && n.bossKilled === true && n.downs === 2 && n.deaths === 1 && n.revives === 1 && n.kills >= 1 && n.playersStart === 3 && n.survivorsStart === 3 && n.survivorsEnd === 2 && n.theme === null && n.hordeSize > 0 && n.durationS > 9, JSON.stringify(n));
  check('...a dawn event, and the dead come back', events(m1.id, 'dawn').length === 1 && events(m1.id, 'dawn')[0].day === 2 && events(m1.id, 'returned_at_dawn').length === 1 && events(m1.id, 'returned_at_dawn')[0].name === 'Cy' && !cy.p.zombie && cy.p.alive);
  check('the night survived goes on the stints of those who saw it through', ann.p.ts.nightsSurvived === 1 && bob.p.ts.nightsSurvived === 1 && cy.p.ts.nightsSurvived === 0);
}

// ---- day 2: a crate, a car alarm, the supplies in, the engine, the escape
{
  // (the forced dusk above passed the day's supply plane threshold too, so one came then: that is the game's doing)
  const drops = events(m1.id, 'crate_drop').length;
  game.spawnSupplyDrop();
  const trunk = game.caches[0];
  game.triggerCarAlarm(ann.p, trunk);
  check('a supply plane and a car alarm are events', events(m1.id, 'crate_drop').length === drops + 1 && events(m1.id, 'car_alarm').length === 1 && events(m1.id, 'car_alarm')[0].data.zombies >= 0, `crate_drop ${events(m1.id, 'crate_drop').map((e) => `t${e.t}/d${e.day}/${e.phase}`)} car_alarm ${events(m1.id, 'car_alarm').map((e) => JSON.stringify(e.data))}`);
  const p = ann.p;
  const car = game.world.car;
  p.inv.fill(null);
  SUPPLIES.forEach((item, i) => game.giveItem(p, item, SUPPLY_NEED[i]));
  p.state.x = car.x + 2.5;
  p.state.z = car.z;
  p.state.y = game.world.heightAt(p.state.x, p.state.z);
  game.fillHistory(p);
  p.interactT = -99;
  game.interact(p, CAR_ID);
  const ins = events(m1.id, 'supply_install');
  check('the supplies put in: an event each, the last one complete', ins.length === SUPPLIES.length && ins[ins.length - 1].data.complete === true && ins[ins.length - 1].data.installed === 7 && p.ts.suppliesInstalled === 7, ins.map((e) => `${e.data.item}x${e.data.n}`).join(' '));
  game.startEngine(p);
  check('the engine started: the final stand', game.escape.active && events(m1.id, 'engine_start').length === 1 && events(m1.id, 'engine_start')[0].phase === 'final_stand' && events(m1.id, 'engine_start')[0].data.during === 'day');
  game.escape.t = 0.06;
  run(3);
  check('the engine warm, and the final stand\'s boss', game.escape.ready && events(m1.id, 'engine_ready').length === 1 && events(m1.id, 'boss_spawn').filter((e) => e.data.final).length === 1);
  // Bob wanders off; Cy dies by the car
  bob.p.state.x = car.x + 60;
  bob.p.state.z = car.z + 10;
  game.killPlayer(cy.p, zsrc(ZTYPE.WALKER, cy.p));
  run(2);
  game.driveOff(p);
}
{
  const end = of('match_end', m1.id);
  const e = end[0];
  check('victory: one match_end, how far they got and how it went', end.length === 1 && e.outcome === 'victory' && e.lastDay === 2 && e.lastPhase === 'final_stand' && e.nightsSurvived === 1 && e.peakPlayers === 3 && e.uniquePlayers === 3 && e.suppliesInstalled === 7 && e.suppliesNeeded === 7 && e.engineStartedS > 0 && e.escaped === 1 && e.deaths === 2 && e.downs === 2 && e.revives === 1 && e.structuresBuilt === 1, e && JSON.stringify({ ...e, summary: undefined }));
  const all = stints(m1.id);
  const sum = (k) => all.reduce((a, r) => a + r[k], 0);
  check('...its totals are the sums of the stints', e.kills === sum('kills') && e.kills === 4 && e.deaths === sum('deaths') && e.downs === sum('downs') && Math.abs(e.playerSeconds - sum('seconds')) < 0.5 && e.structuresBuilt === sum('built'), `kills ${e.kills} = ${sum('kills')}, playerSeconds ${e.playerSeconds} ~ ${sum('seconds').toFixed(1)}`);
  const sm = e.summary;
  const parts = {
    pacing: sm.supplies.car_battery.firstInstalledS > 0 && sm.supplies.fuel_can.doneS > 0 && sm.supplies.car_battery.firstFoundS > 0,
    log: sm.supplyLog.some((l) => l.e === 'found' && l.by === 'Cy') && sm.supplyLog.filter((l) => l.e === 'install').length === SUPPLIES.length,
    bosses: sm.bosses.length === 2 && sm.bosses[0].killed === true && sm.bosses[0].by === 'Bob' && sm.bosses[1].final === true && sm.bosses[1].killed === false,
    schematics: sm.schematics.length === 1 && sm.schematics[0].item === 'schem_shotgun' && sm.schematics[0].by === 'Ann',
    crates: sm.crates.dropped === events(m1.id, 'crate_drop').length && sm.crates.dropped >= 1,
    kills: sm.killsByType.walker >= 1 && sm.killsByType.turned_player === 1 && sm.killsByWeapon.ak47 === 1,
    zombieDeaths: sm.zombieDeaths.trap === 1 && sm.zombieDeaths.player === e.kills - 1,
    causes: sm.deathsByCause.tank === 1 && sm.downsByCause.runner === 1,
    phases: sm.phaseSeconds.night > 9 && sm.phaseSeconds.final_stand > 0,
    driver: sm.driver === 'Ann',
  };
  const bad = Object.keys(parts).filter((k) => !parts[k]);
  check('...and its summary: supply pacing, the bosses, schematics, crates, kills by type and weapon, what the dead died of', !bad.length, bad.length ? `failing: ${bad.join(' ')} ${JSON.stringify({ bosses: sm.bosses, schematics: sm.schematics, crates: sm.crates, phaseSeconds: sm.phaseSeconds })}` : '');
  const a = stints(m1.id, 'Ann');
  const b = stints(m1.id, 'Bob');
  const c = stints(m1.id, 'Cy');
  check('the stints at the end: Ann escaped, Bob left behind on his second stint, Cy dead', a.length === 1 && a[0].outcome === 'escaped' && a[0].leftReason === 'match_end' && a[0].userId === ACCOUNT.id && a[0].guestKey === null && b.length === 2 && b[1].firstStint === false && b[1].outcome === 'left_behind' && c.length === 1 && c[0].outcome === 'dead' && c[0].userId === null && c[0].guestKey === null, `${a[0]?.outcome} / ${b.map((r) => r.outcome)} / ${c[0]?.outcome}`);
  check('Ann\'s stint carries what she did', a[0].shots === 4 && a[0].hits === 3 && a[0].kills >= 3 && a[0].killsByType.turned_player === 1 && a[0].crafted === 1 && a[0].built === 1 && a[0].cachesSearched === 1 && a[0].revivesGiven === 1 && a[0].distanceM >= 0 && a[0].stats.secondsAlive > 30 && a[0].stats.swings === 0 && a[0].pingAvg === null && a[0].joinedPhase === 'day' && a[0].leftPhase === 'final_stand', JSON.stringify(a[0].stats));
  check('Cy\'s stint: the death, the turned time, the dawn return', c[0].deaths === 2 && c[0].stats.turnedDeaths === 1 && c[0].stats.secondsTurned > 0 && c[0].stats.returnedAtDawn === 1 && c[0].suppliesFound === 1 && c[0].stats.state === 'dead');
  check('the victory is an event too, by the driver', events(m1.id, 'victory').length === 1 && events(m1.id, 'victory')[0].name === 'Ann');
  const order = recs.findIndex((r) => r.k === 'match_end' && r.matchId === m1.id);
  check('nothing of the match comes after its match_end', !recs.slice(order + 1).some((r) => r.matchId === m1.id));
  check('the guest\'s browser id never comes out, only its key', !JSON.stringify(recs).includes(GUEST_PID) && !JSON.stringify(recs).toLowerCase().includes(GUEST_PID.replace(/-/g, '')));
}

// ================================================================ match 2: begun with everyone on, abandoned
{
  run((GAME_OVER_DELAY + 6) * 20 + 10);
  const ms = of('match');
  const m2 = ms[1];
  check('the next run is a new match, everyone still on carried into it', ms.length === 2 && game.phase === PHASE.DAY && events(m2.id, 'join').length === 3 && events(m2.id, 'join').every((e) => e.data.carried === true) && [ann, bob, cy].every((c) => c.p.ts));
  run(40);
  leave(cy);
  leave(bob);
  check('a match goes on while anyone is in it', of('match_end', m2.id).length === 0);
  leave(ann);
  const e = of('match_end', m2.id);
  check('the last player leaving abandons it: match_end abandoned, every stint left', e.length === 1 && e[0].outcome === 'abandoned' && e[0].lastPhase === 'day' && e[0].uniquePlayers === 3 && stints(m2.id).length === 3 && stints(m2.id).every((r) => r.outcome === 'left' && r.leftReason === 'left' && r.firstStint) && of('night', m2.id).length === 0 && events(m2.id, 'abandoned').length === 1, e[0] && e[0].outcome);
}

// ================================================================ match 3: a wipe
let dee;
{
  dee = connect('Dee');
  const m3 = of('match')[2];
  game.damagePlayer(dee.p, 999, zsrc(ZTYPE.BOOMER, dee.p));
  const e = of('match_end', m3.id);
  check('a lone survivor killed: a wipe, and they are dead', game.phase === PHASE.GAMEOVER && e.length === 1 && e[0].outcome === 'wipe' && e[0].deaths === 1 && e[0].escaped === 0 && stints(m3.id).length === 1 && stints(m3.id)[0].outcome === 'dead' && events(m3.id, 'wipe').length === 1 && events(m3.id, 'death')[0].data.cause === 'boomer');
}

// ================================================================ match 4: stopped from outside in the middle of a night
{
  run(GAME_OVER_DELAY * 20 + 10);
  const m4 = of('match')[3];
  const eve = connect('Eve');
  game.timeLeft = 0.05;
  run(2);
  game.damagePlayer(dee.p, 500, zsrc(ZTYPE.SPITTER, dee.p));
  game.damagePlayer(dee.p, 1000, zsrc(ZTYPE.SPITTER, dee.p));
  run(130);
  const n0 = recs.length;
  game.track.finish('interrupted');
  const added = recs.slice(n0);
  const e = of('match_end', m4.id);
  const n = of('night', m4.id);
  check('finish(\'interrupted\') ends it at once: the night (abandoned), each stint, the match_end', !!m4 && game.phase === PHASE.NIGHT && dee.p.zombie && e.length === 1 && e[0].outcome === 'interrupted' && e[0].lastPhase === 'night' && n.length === 1 && n[0].outcome === 'abandoned' && stints(m4.id, 'Dee')[0].outcome === 'turned' && stints(m4.id, 'Eve')[0].outcome === 'alive' && stints(m4.id).every((r) => r.leftReason === 'match_end') && added.map((r) => r.k).join() === 'event,night,player,player,match_end', added.map((r) => r.k).join());
  const n1 = recs.length;
  game.track.finish('interrupted');
  game.combat.damageZombie(game.zm.spawn(ZTYPE.WALKER, eve.p.state.x + 5, eve.p.state.z, {}) || { dead: true }, 999, eve.p, { weapon: ITEM.PISTOL });
  run(SAMPLE_EVERY * 20 + 5);
  leave(dee);
  leave(eve);
  check('with no match running nothing more comes out: not finish again, not a kill, not a leave', recs.length === n1 && !dee.p.ts && !eve.p.ts, `${recs.length - n1} more`);
}

// ================================================================ every record
{
  check('every record has exactly its fields, nothing undefined, every number finite', shapeErrors.length === 0, shapeErrors.slice(0, 5).join(' | '));
  const ids = new Set(of('match').map((m) => m.id));
  const ends = of('match_end');
  check('one match_end for every match', ends.length === ids.size && new Set(ends.map((e) => e.matchId)).size === ids.size && ends.every((e) => ids.has(e.matchId)), `${ids.size} matches, ${ends.length} ends`);
  check('every other record belongs to one of them', recs.every((r) => r.k === 'match' || ids.has(r.matchId)));
  const badEv = of('event').filter((e) => !EVENT_TYPES.has(e.type) || (e.phase !== null && !PHASES.has(e.phase)));
  check('event types and phases from the vocabulary', badEv.length === 0, badEv.map((e) => `${e.type}/${e.phase}`).join(' '));
  const vocab = { outcome: ['escaped', 'left_behind', 'alive', 'dead', 'turned', 'left'], leftReason: ['left', 'match_end'] };
  check('player outcomes and leave reasons from the vocabulary', of('player').every((r) => vocab.outcome.includes(r.outcome) && vocab.leftReason.includes(r.leftReason) && PHASES.has(r.joinedPhase) && PHASES.has(r.leftPhase)));
  const samples = of('sample');
  check('samples: unique times within a match', samples.every((s, i) => !samples.some((o, j) => j !== i && o.matchId === s.matchId && o.t === s.t)), `${samples.length} samples`);
  console.log(`(${recs.length} records: ${Object.entries(recs.reduce((a, r) => ((a[r.k] = (a[r.k] || 0) + 1), a), {})).map(([k, n]) => `${n} ${k}`).join(', ')})`);
}

// ================================================================ no sink: nothing kept at all
{
  const quiet = new Game({ seed, dayLength: 3600, log: () => {} });
  quiet.zm.update = () => {};
  const conn = { id: 0, send(bytes) { const r = new Reader(bytes.slice().buffer); if (r.u8() === S2C.WELCOME) conn.id = r.u16(); } };
  const session = quiet.onOpen(conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('Solo');
  quiet.onMessage(session, w.bytes().slice());
  const p = quiet.players.get(conn.id);
  const z = quiet.zm.spawn(ZTYPE.WALKER, p.state.x + 4, p.state.z, {});
  quiet.combat.fire(p, { type: 'fire', weapon: ITEM.PISTOL, yaw: p.state.yaw, pitch: 0, recoilPitch: 0, spread: 0, seed: 1, x: p.state.x, y: p.state.y + EYE_HEIGHT, z: p.state.z });
  if (z) quiet.combat.damageZombie(z, 999, p, { weapon: ITEM.PISTOL });
  for (let i = 0; i < SAMPLE_EVERY * 20 + 5; i++) quiet.update();
  quiet.timeLeft = 0.05;
  for (let i = 0; i < 3; i++) quiet.update();
  const open = quiet.track.m;
  quiet.onClose(session);
  check('a Game without a sink opens no match and puts nothing on its players', open === null && quiet.track.m === null && p.ts === null && quiet.track.sink === null);
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
