// Experience, levels and perks (shared/progress.js, server/progress.js, the XP in server/game.js): the rules on their
// own; what a survivor earns in a running game and what they do not (the night's diminishing returns, the wedged dead,
// a death keeping what was earned); perks in force in the simulation and the server's rules, a pick made during a
// night waiting for dawn; the client's prediction keeping step with a perk the server set; picking and starting over
// through the API, with both stores (the file's and the database's, a guest's progress moving onto their account);
// and end to end against a real server process: a pick reaching the player's game in its worker.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { Game } from '../server/game.js';
import { PlayerStats, idKey, cleanPerks } from '../server/stats.js';
import { DbStats } from '../server/dbstats.js';
import { Progress } from '../server/progress.js';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { C2S, S2C, SNAP, PROGF, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { readHeader, readGlobal, readSelf } from '../client/net/decode.js';
import { createPlayerState, copyPlayerState, simulatePlayer, hashPlayerState } from '../shared/playersim.js';
import { BTN, PLAYER_MAX_HP, SPRINT_SPEED, CMD_DT } from '../shared/constants.js';
import { ZTYPE, ITEM, WEAPONS } from '../shared/defs.js';
import { XP, XPS, XP_SRC, LEVEL_CAP, PICK_LEVELS, PERK_POINTS, KEYSTONE_LEVEL, TIER, TIER_LEVELS, BRANCHES, PERKS, PERK_BY_ID, PERK_CAP, xpToNext, xpForLevel, levelOf, levelInfo, picksEarned, perkLock, perkDependents, perksValid, fitPerks, perkMods, perkMask, perkIds, killXp, progressView } from '../shared/progress.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const uid = (n) => `7c9e6679-7425-40de-944b-${String(n).padStart(12, '0')}`;
const sha = (id) => createHash('sha256').update(id).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idOf = (name) => PERKS.find((p) => p.name === name).id;

// ---------------------------------------------------------------- the rules
{
  let ok = levelOf(0) === 1 && levelOf(xpForLevel(2) - 1) === 1 && levelOf(xpForLevel(2)) === 2 && levelOf(1e12) === LEVEL_CAP;
  for (let l = 1; l < LEVEL_CAP; l++) ok = ok && xpForLevel(l + 1) - xpForLevel(l) === xpToNext(l) && levelOf(xpForLevel(l)) === l;
  check('the curve: level L to L + 1 is 200 + 120 L XP, and levelOf is its inverse', ok && xpToNext(1) === 320, `${xpForLevel(LEVEL_CAP)} to the cap`);
  const top = levelInfo(1e9);
  check('at the cap there is no next level', top.level === LEVEL_CAP && top.need === 0 && top.frac === 1);
  check('ten perk points, the last at the top level', PICK_LEVELS.join() === '2,4,6,9,12,15,18,21,25,30' && PERK_POINTS === 10 && picksEarned(1) === 0 && picksEarned(2) === 1 && picksEarned(20) === 7 && picksEarned(LEVEL_CAP) === PERK_POINTS);
  check('kill XP: by kind, a boss, a headshot on top', killXp(ZTYPE.WALKER) === XP.kill && killXp(ZTYPE.TANK) === 30 && killXp(ZTYPE.SPITTER, false, true) === 17 && killXp(ZTYPE.BOSS_BRUTE, true, true) === XP.boss);
  check('the tree fits a bitmask, ids unique', PERKS.length <= 31 && PERKS.every((p) => p.id >= 0 && p.id <= 30) && new Set(PERKS.map((p) => p.id)).size === PERKS.length && PERKS.every((p) => PERK_BY_ID[p.id] === p));
  check('a third of the tree at most: there are three perks for every point', PERKS.length >= 3 * PERK_POINTS);
  check('a mask and its ids go round', perkIds(perkMask([0, 5, 19, 30])).join() === '0,5,19,30' && perkMask([99, 'x']) === 0);

  // the shape of the tree
  let shape = true;
  for (let g = 0; g < BRANCHES; g++) {
    const br = PERKS.filter((p) => p.group === g);
    if (br.length !== 5 || br.filter((p) => p.tier === 0).length !== 2 || br.some((p) => p.tier > 2)) shape = false;
    // every perk below the first tier needs the one right above it, in its own branch
    for (const p of br) if (p.tier > 0 && !(p.req.length === 1 && PERK_BY_ID[p.req[0]].group === g && PERK_BY_ID[p.req[0]].tier === p.tier - 1 && PERK_BY_ID[p.req[0]].col === p.col)) shape = false;
  }
  const combos = PERKS.filter((p) => p.tier === TIER.COMBO);
  const keys = PERKS.filter((p) => p.keystone);
  check('five branches of five perks, three tiers deep, each needing the one above it', shape);
  check('a combination needs a tier 2 perk from each of two branches', combos.length === 3 && combos.every((p) => p.req.length === 2 && p.req.every((r) => PERK_BY_ID[r].tier === 1) && PERK_BY_ID[p.req[0]].group !== PERK_BY_ID[p.req[1]].group));
  check('a keystone needs any tier 3 perk', keys.length === 3 && keys.every((p) => p.level === KEYSTONE_LEVEL && p.reqAny.length === BRANCHES && p.reqAny.every((r) => PERK_BY_ID[r].tier === 2)));
  check('a perk opens at its tier\'s level', PERKS.every((p) => p.level === TIER_LEVELS[p.tier]));
  // every tier is in reach the moment it opens: a branch's tier 3, a combination, a keystone
  check('...and the points to get there are earned by then', picksEarned(TIER_LEVELS[2]) >= 3 && picksEarned(TIER_LEVELS[TIER.COMBO]) >= 5 && picksEarned(KEYSTONE_LEVEL) >= 4);

  const T = idOf;
  const at = (lv) => xpForLevel(lv);
  check('taking a perk: what it needs, its level, a point to spend', perkLock([], T('Thick Skin'), 2) === '' && perkLock([], T('Thick Skin'), 1) === 'level' && perkLock([], T('Field Medic'), 6) === 'needs' && perkLock([T('Thick Skin')], T('Field Medic'), 6) === '' && perkLock([T('Thick Skin')], T('Field Medic'), 5) === 'level' && perkLock([T('Thick Skin')], T('Deep Lungs'), 3) === 'points' && perkLock([T('Thick Skin')], T('Thick Skin'), 30) === 'owned' && perkLock([], 99, 30) === 'unknown');
  const path3 = [T('Thick Skin'), T('Field Medic'), T('Hardened')];
  check('a keystone: from level 20 with a tier 3 perk, one per survivor', perkLock(path3, T('Last Stand'), 19) === 'level' && perkLock(path3.slice(0, 2), T('Last Stand'), 20) === 'needs' && perkLock(path3, T('Last Stand'), 20) === '' && perkLock([...path3, T('Last Stand')], T('Adrenaline'), 30) === 'keystone');
  const medic = [T('Thick Skin'), T('Field Medic'), T('Guardian Angel'), T('Rally')];
  check('a combination: both of what it needs', perkLock(medic.slice(0, 3), T('Combat Medic'), 30) === 'needs' && perkLock(medic, T('Combat Medic'), 14) === '' && perkLock(medic, T('Combat Medic'), 13) === 'level');
  check('what needs a perk: the ones below it, and a keystone left with no tier 3', perkDependents(path3, T('Field Medic')).join() === String(T('Hardened')) && perkDependents([...path3, T('Last Stand')], T('Hardened')).join() === String(T('Last Stand')) && perkDependents(path3, T('Hardened')).length === 0);
  check('sets that could not be had are refused, in any order', perksValid([T('Field Medic'), T('Thick Skin')], at(6)) && !perksValid([T('Field Medic')], 1e9) && !perksValid([0], 0) && !perksValid([0, 0], 1e9) && !perksValid([99], 1e9) && !perksValid([...path3, T('Last Stand')], at(20) - 1) && perksValid([...path3, T('Last Stand')], at(20)) && !perksValid([...path3, T('Last Stand'), T('Adrenaline')], 1e9) && !perksValid([0, 1, 4, 5, 9, 10, 11, 13, 14, 15, 3], 1e9));
  check('a stored set is fitted to the tree: what it cannot have dropped, the rest kept', fitPerks([T('Hardened'), T('Field Medic'), T('Thick Skin'), 99, 0], at(12)).join() === [T('Thick Skin'), T('Field Medic'), T('Hardened')].join() && fitPerks([T('Field Medic'), T('Deep Lungs')], 1e9).join() === String(T('Deep Lungs')) && fitPerks([0, 1, 4, 5, 9, 10, 11, 13, 14, 15, 3, 2], 1e9).length === PERK_POINTS && fitPerks('x', 1e9).length === 0);

  const all = perkMods(perkMask(PERKS.filter((p) => !p.keystone).map((p) => p.id)));
  const over = Object.entries(all).filter(([key, v]) => (key === 'hp' ? v > 100 * PERK_CAP : !['extraFind', 'gather', 'reviveHp', 'reviveXp', 'xp', 'killStamina', 'killHeal', 'reviveSelf', 'secondChance'].includes(key) && Math.abs(v - 1) > PERK_CAP + 1e-9));
  check('no stat moves more than the cap through the ordinary perks', !over.length, JSON.stringify(over));
  check('multipliers multiply: Last Stand halves the bleeding, Mentor is half as much XP again', perkMods(perkMask([idOf('Last Stand')])).bleed === 0.5 && perkMods(perkMask([idOf('Mentor')])).reviveXp === 1.5 && perkMods(perkMask([idOf('Quick Hands')])).reload === 0.85);
  check('Treasure Hunter makes the extra find one in two', perkMods(perkMask([T('Keen Eye'), T('Treasure Hunter')])).extraFind === 0.5);
  check('no perks: every number its base', perkMods(0).reload === 1 && perkMods(0).hp === 0 && perkMods(0).xp === 1 && Object.isFrozen(perkMods(0)));
  const v = progressView(xpForLevel(4) + 10, [0]);
  check('the view: level, points earned, spent and waiting, the next one', v.level === 4 && v.picks === 2 && v.points === PERK_POINTS && v.pending === 1 && v.nextPick === 6 && !('offer' in v));
}

// ---------------------------------------------------------------- the simulation
const sharedGame = new Game({ seed: 4242, godMode: true, dayLength: 3600, stats: new PlayerStats(), log: () => {} });
{
  const world = sharedGame.world;
  const sp = world.spawnPoints[0];
  // the same commands with and without the perks, from the same spot
  const run = (perks, buttons, n, setup) => {
    const s = createPlayerState();
    s.x = sp.x;
    s.z = sp.z;
    s.y = world.floorAt(sp.x, sp.z, 50);
    s.perks = perks;
    setup?.(s);
    const evs = [];
    for (let i = 0; i < n; i++) simulatePlayer(s, { seq: i, buttons, yaw: 0, pitch: 0, slot: 255 }, world, evs);
    return { s, evs };
  };
  {
    const dist = (s) => Math.hypot(s.x - sp.x, s.z - sp.z);
    const plain = run(0, BTN.FWD | BTN.SPRINT, 40).s;
    const fleet = run(perkMask([idOf('Fleet Foot'), idOf('Deep Lungs')]), BTN.FWD | BTN.SPRINT, 40).s;
    check('Fleet Foot: a sprint goes further; Deep Lungs: it costs less stamina', dist(fleet) > dist(plain) * 1.03 && fleet.stamina > plain.stamina && Math.hypot(fleet.vx, fleet.vz) <= SPRINT_SPEED * 1.08 + 1e-6, `${dist(plain).toFixed(2)} / ${dist(fleet).toFixed(2)} m`);
    const arm = (s) => {
      s.slot = 1;
      s.switchT = 0;
      s.mags[1] = 0;
      s.ammo[WEAPONS[ITEM.PISTOL].ammo] = 30;
    };
    const reloadIn = (perks) => {
      const { evs } = run(perks, BTN.RELOAD, 1, arm);
      return evs.find((e) => e.type === 'reload')?.time;
    };
    check('Quick Hands: a reload takes 15% less time', Math.abs(reloadIn(perkMask([idOf('Quick Hands')])) - WEAPONS[ITEM.PISTOL].reload * 0.85) < 1e-9 && reloadIn(0) === WEAPONS[ITEM.PISTOL].reload);
    const a = createPlayerState();
    a.perks = 5;
    const b = copyPlayerState(createPlayerState(), a);
    check('the perks are part of the simulated state: copied, and in the fingerprint', b.perks === 5 && hashPlayerState(a) !== hashPlayerState({ ...a, perks: 0, weapons: a.weapons, mags: a.mags, ammo: a.ammo }));
    const z = run(perkMask([idOf('Fleet Foot')]), BTN.FWD | BTN.SPRINT, 30, (s) => (s.zombie = 1)).s;
    const z0 = run(0, BTN.FWD | BTN.SPRINT, 30, (s) => (s.zombie = 1)).s;
    check('a turned player has no perks', z.z === z0.z && z.x === z0.x);
  }
}

// ---------------------------------------------------------------- in a game
{
  const game = sharedGame;
  const store = game.records;
  function client(name, id) {
    const c = { name, id: 0, prog: null, list: new Map(), perks: new Map(), self: {}, chats: [] };
    c.conn = {
      send(bytes) {
        const r = new Reader(bytes.slice());
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.PROGRESS) {
          c.prog = { xp: r.varu(), flags: r.u8(), run: XP_SRC.map(() => r.varu()) };
          if (r.left) throw new Error('trailing progress bytes');
        } else if (t === S2C.CHAT) c.chats.push((r.u16(), r.u8(), r.str()));
        else if (t === S2C.PLAYERS) {
          const ids = [];
          for (let n = r.u8(); n > 0; n--) {
            const id = r.u16();
            r.str();
            r.u8();
            const flags = r.u8();
            r.u16();
            r.u16();
            const level = r.u8();
            if (flags & 2) {
              r.i16();
              r.i16();
              r.u8();
            }
            c.list.set(id, level);
            ids.push(id);
          }
          for (const _ of ids) r.u8(); // (their characters)
          for (const id of ids) c.perks.set(id, r.u32());
        } else if (t === S2C.SNAPSHOT) {
          const flags = readHeader(r, c.hdr || (c.hdr = {}));
          if (flags & SNAP.GLOBAL) readGlobal(r, c.glob || (c.glob = {}));
          readSelf(r, c.self, flags);
        }
      },
      congested: () => false,
      cork: (fn) => fn(),
    };
    c.session = game.onOpen(c.conn);
    const w = new Writer(96);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    if (id) w.str(id);
    game.onMessage(c.session, w.bytes().slice());
    c.p = () => game.players.get(c.id);
    return c;
  }
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) game.update();
  };
  const kill = (c, type = ZTYPE.WALKER, head = false) => {
    const z = game.zm.spawn(type, c.p().x + 3, c.p().z + 3);
    game.combat.killZombie(z, c.p(), { headshot: head });
    return z;
  };

  const Ann = client('Ann', uid(1));
  const Ben = client('Ben', uid(2));
  const Bot = client('Bot');
  tick(2);
  const A = Ann.p();
  check('a joining player is loaded from their record at once (the file-kept store)', A.xpLoaded && A.xpBase === 0 && Ann.prog && Ann.prog.flags & PROGF.LOADED && Ann.prog.flags & PROGF.KEPT);
  check('...and a player with no record is told nothing is kept', Bot.prog && !(Bot.prog.flags & PROGF.KEPT));

  kill(Ann);
  kill(Ann, ZTYPE.WALKER, true);
  kill(Ann, ZTYPE.TANK);
  const want = XP.kill * 2 + 30;
  check('kills earn XP by kind, a headshot on top, on the run and on the record', A.xpRun[XPS.kills] === want && A.xpRun[XPS.headshots] === XP.headshot && store.recs.get(sha(uid(1))).xp === want + XP.headshot, `${A.xpRun} / ${store.recs.get(sha(uid(1))).xp}`);
  const z = game.zm.spawn(ZTYPE.WALKER, A.x + 3, A.z + 3);
  z.wedgeT = 60;
  const before = game.xpOf(A);
  game.combat.killZombie(z, A);
  check('one of the dead that had been wedged for a minute earns nothing', game.xpOf(A) === before);
  const boss = game.zm.spawn(ZTYPE.BOSS_BRUTE, A.x + 4, A.z + 4);
  boss.boss = true;
  game.combat.killZombie(boss, A);
  check('a boss is worth its own', A.xpRun[XPS.bosses] === XP.boss);

  A.nightKills = XP.killsFull;
  const at = A.xpRun[XPS.kills];
  kill(Ann);
  check('past the night\'s full kills, a kill is worth half', A.xpRun[XPS.kills] - at === Math.ceil(XP.kill / 2));
  game.startNight();
  check('...and a new night starts the count over', A.nightKills === 0);

  game.goDown(Ben.p());
  game.revive(Ben.p(), A);
  check('a revive earns XP for whoever did it', A.xpRun[XPS.revives] === XP.revive);
  game.goDown(A);
  game.revive(A, null);
  check('...a medkit of their own earns nothing', A.xpRun[XPS.revives] === XP.revive);

  game.killPlayer(Ben.p(), { kind: 0 });
  const benXp = game.xpOf(Ben.p());
  game.startDay();
  check('a survivor alive at dawn earns the night; the dead keep what they had, and earn no night', A.xpRun[XPS.nights] === XP.night * 1 && Ben.p().xpRun[XPS.nights] === 0 && game.xpOf(Ben.p()) === benXp);
  check('day 2 is everyone\'s first dawn: no personal best for it', A.xpRun[XPS.best] === 0 && A.best === 2);
  game.startNight();
  game.startDay();
  check('a dawn past the furthest day ever seen is a personal best, once', A.xpRun[XPS.best] === XP.best && A.best === 3 && store.recs.get(sha(uid(1))).best === 3 && A.xpRun[XPS.nights] === XP.night * 3);

  tick(30);
  check('the client is told its XP: on record, and this run by source', Ann.prog.xp === game.xpOf(A) && Ann.prog.run.join() === A.xpRun.join(), `${Ann.prog.xp} / ${game.xpOf(A)}`);
  check('everyone\'s level is in the player list', game.levelOf(A) > 1 && Ann.list.size === 3 && [...game.players.values()].every((q) => Ann.list.get(q.id) === game.levelOf(q)), `${[...Ann.list]}`);

  // perks
  const tough = idOf('Thick Skin');
  const lungs = idOf('Deep Lungs');
  const hp0 = A.hp;
  game.setProgress(A, { perks: [tough, lungs] });
  tick(2);
  check('perks picked by day are in force at once: the simulation\'s, and health', A.state.perks === perkMask([tough, lungs]) && A.maxHp === PLAYER_MAX_HP + 10 && A.hp === Math.min(A.maxHp, hp0 + 10), `${A.hp} / ${A.maxHp}`);
  check('...and the client hears of them with the state it predicts from', Ann.self.perks === A.state.perks, `${Ann.self.perks}`);
  game.startNight();
  game.setProgress(A, { perks: [] });
  check('a pick (or a respec) during a night waits for dawn', A.perks === perkMask([tough, lungs]) && A.perksNext === 0 && Ann.chats.some((t) => /dawn/.test(t)));
  game.startDay();
  check('...and comes into force then', A.perks === 0 && A.maxHp === PLAYER_MAX_HP && A.perksNext === -1);
  game.setProgress(A, { perks: [idOf('Second Chance')] });
  game.startNight();
  game.godMode = false;
  game.damagePlayer(A, 9999, { kind: 0 });
  const stood = A.alive && !A.downed && A.hp === 1;
  game.damagePlayer(A, 9999, { kind: 0 });
  check('Second Chance: the first blow that would put them down leaves 1 health, the next does not', stood && (A.downed || !A.alive));
  game.godMode = true;

  // the tree's server-side effects
  if (A.downed) game.revive(A, null);
  game.applyPerks(A, perkMask([idOf('Hardened')]));
  game.godMode = false;
  A.armor = 0;
  A.hp = A.maxHp;
  game.damagePlayer(A, 20, { kind: 0 });
  const took = A.maxHp - A.hp;
  game.godMode = true;
  check('Hardened: a blow takes 15% less', Math.abs(took - 17) < 1e-6, `${took}`);
  game.applyPerks(A, perkMask([idOf('Executioner'), idOf('Quick Study')]));
  A.hp = 50;
  const xp0 = game.xpOf(A);
  kill(Ann);
  check('Executioner: a kill gives back 5 health; Quick Study: 10% more XP', A.hp === 55 && game.xpOf(A) - xp0 === Math.round(XP.kill * 1.1), `${A.hp} / ${game.xpOf(A) - xp0}`);
  game.applyPerks(A, perkMask([idOf('Second Wind')]));
  A.hp = 30;
  game.goDown(Bot.p());
  game.revive(Bot.p(), A);
  check('Second Wind: reviving a teammate gives back 20 health', A.hp === 50, `${A.hp}`);
  tick(2);
  check('everyone\'s perks are in the player list', Ann.perks.get(A.id) === perkMask([idOf('Second Wind')]), `${Ann.perks.get(A.id)}`);
  game.applyPerks(A, 0);

  const run0 = game.xpOf(A);
  const car = game.world.car;
  Object.assign(A.state, { x: car.x + 2, z: car.z });
  if (A.downed) game.revive(A, null);
  Object.assign(Ben.p().state, { x: car.x + 150, z: car.z });
  game.victory();
  const aboard = A.xpRun[XPS.escape];
  check('a win earns XP: the escape for whoever is in the car, less for the one left behind', aboard === XP.escape && Ben.p().xpRun[XPS.escape] === XP.team, `${aboard} / ${Ben.p().xpRun[XPS.escape]}`);
  game.startGame();
  check('a new run: this run\'s XP starts over, what was earned is on the record', A.xpRun.every((x) => x === 0) && A.xpBase === run0 + aboard);
}

// ---------------------------------------------------------------- the API, with the file-kept store
{
  const stats = new PlayerStats();
  const told = [];
  const api = new Progress({ stats, changed: (key, perks) => told.push([key, perks.join()]) });
  const g = { guestId: uid(9) };
  const err = async (p) => {
    try {
      await p;
      return 0;
    } catch (e) {
      return e.status;
    }
  };
  check('nobody to look up is a 400', (await err(api.view({ guestId: 'nope' }))) === 400);
  let v = await api.view(g);
  check('a guest who never played: level 1, no point to spend', v.level === 1 && v.pending === 0 && v.picks === 0);
  check('...and taking a perk is refused', (await err(api.pick(g, 0))) === 409);
  const rec = stats.enter(uid(9), 'Nia');
  stats.bump(rec, 'xp', xpForLevel(6));
  v = await api.view(g);
  check('three levels\' points earned, none spent', v.level === 6 && v.pending === 3 && v.picks === 3);
  check('a perk whose need is not met is refused, and one that is not a perk', (await err(api.pick(g, idOf('Field Medic')))) === 409 && (await err(api.pick(g, idOf('Hardened')))) === 409 && (await err(api.pick(g, 'x'))) === 400 && (await err(api.pick(g, 99))) === 400);
  v = await api.pick(g, idOf('Thick Skin'));
  check('a point spent: kept, the games told', rec.perks.join() === String(idOf('Thick Skin')) && v.pending === 2 && told.at(-1)?.[0] === rec.key && told.at(-1)?.[1] === String(idOf('Thick Skin')));
  v = await api.pick(g, idOf('Field Medic'));
  check('...which opens the next tier of the branch', v.perks.join() === [idOf('Thick Skin'), idOf('Field Medic')].join() && v.pending === 1);
  check('the same perk again is refused', (await err(api.pick(g, idOf('Field Medic')))) === 409);
  check('a perk another needs cannot be taken back', (await err(api.unpick(g, idOf('Thick Skin')))) === 409 && (await err(api.unpick(g, idOf('Deep Lungs')))) === 409);
  v = await api.unpick(g, idOf('Field Medic'));
  check('...one nothing needs can: the point is back', rec.perks.join() === String(idOf('Thick Skin')) && v.pending === 2 && told.at(-1)?.[1] === String(idOf('Thick Skin')));
  await api.pick(g, idOf('Deep Lungs'));
  await api.pick(g, idOf('Quick Hands'));
  check('every point spent: no more', (await err(api.pick(g, idOf('Steady Grip')))) === 409 && rec.perks.length === 3);
  v = await api.respec(g);
  check('starting over: every point back, counted', rec.perks.length === 0 && rec.respecs === 1 && v.pending === 3 && v.respecs === 1 && told.at(-1)?.[1] === '');
  await api.pick(g, idOf('Mentor'));
  const saved = JSON.parse(stats.serialize()).players[sha(uid(9))];
  check('the file keeps the XP, the picks and the respecs', saved.xp === xpForLevel(6) && saved.respecs === 1 && saved.perks.join() === String(idOf('Mentor')));
  check('stored picks are fitted to the level and the tree when read, junk dropped', cleanPerks([1, 2, 3, 4, 5], xpForLevel(4)).join() === '1,4' && cleanPerks([3, 3], 1e9).length === 0 && cleanPerks([1, 1], 1e9).join() === '1' && cleanPerks('x', 1e9).length === 0);
}

// ---------------------------------------------------------------- the database's store
{
  const db = await openDb('pglite:memory');
  await migrate(db);
  const stats = new DbStats({ db });
  const browser = randomUUID();
  const g = stats.enter(browser, 'Guesty');
  stats.bump(g, 'xp', xpForLevel(3));
  stats.best(g, 4);
  check('XP not yet written is in what a game is told', (await stats.progress(g)).xp === xpForLevel(3));
  await stats.flush();
  const row = (await db.query('SELECT xp, best_day FROM player_stats WHERE key = $1', [`g:${idKey(browser)}`])).rows[0];
  check('XP and the furthest day go into the database with the board\'s stats', row?.xp === xpForLevel(3) && row.best_day === 4, JSON.stringify(row));
  const api = new Progress({ stats });
  let v = await api.view({ guestId: browser });
  v = await api.pick({ guestId: browser }, idOf('Light Fingers'));
  const picked = v.perks[0];
  const p = await stats.progressOf({ guestId: browser });
  check('a guest\'s pick is kept in the database', p.perks.join() === String(picked) && (await stats.progress(g)).perks.join() === String(picked));
  const stale = { ...p };
  await stats.setPerks(p, [], 1);
  check('a write against picks that changed meanwhile does not go in', !(await stats.setPerks(stale, [picked, 1], 0)));
  await stats.setPerks({ ...p, stored: [], respecs: 1 }, [picked], 1);
  const user = (await db.query(`INSERT INTO users (email, username, password_hash) VALUES ('g@x.io', 'Guesty', 'x') RETURNING id`)).rows[0].id;
  const acct = stats.enter('', 'Guesty', user);
  stats.bump(acct, 'xp', 100);
  await stats.flush();
  await stats.claimGuest(user, 'Guesty', browser);
  const mine = await stats.progressOf({ userId: user });
  check('signing in: the guest\'s XP adds onto the account, and its picks come along', mine.xp === xpForLevel(3) + 100 && mine.perks.join() === String(picked) && mine.respecs === 1, JSON.stringify(mine));
  const prof = await stats.profile('GUESTY');
  check('an account\'s profile by its name, any case: level, perks, the record', prof?.username === 'Guesty' && prof.level === levelOf(xpForLevel(3) + 100) && prof.perks.join() === String(picked) && prof.stats.kills === 0 && !('email' in prof) && (await stats.profile('nobody')) === null, JSON.stringify(prof));
  const board = await stats.board(acct, new Set([acct]));
  check('the board says each player\'s level', board.rows.find((r) => r.flags & 1)?.level === levelOf(xpForLevel(3) + 100));
  await stats.close();
  await db.close?.();
}

// ---------------------------------------------------------------- end to end: the network thread and a game's worker
{
  const port = await new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), STATS_FILE: '', GAME_IDLE_SECONDS: '2', NODE_ENV: 'test', DEV_ADMIN: '1', GODMODE: '1', LOBBY_LIMITS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 200 && !log.includes('listening'); i++) await sleep(50);
    const guestId = randomUUID();
    const api = async (path, body) => {
      const res = await fetch(`http://localhost:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const c = { prog: null, self: {}, hdr: {}, glob: {} };
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.binaryType = 'arraybuffer';
    await new Promise((resolve) => {
      ws.onopen = () => {
        const w = new Writer(128);
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str('Eve');
        w.str(guestId);
        ws.send(w.bytes());
      };
      ws.onmessage = (m) => {
        const r = new Reader(m.data);
        const t = r.u8();
        if (t === S2C.WELCOME) resolve();
        else if (t === S2C.PROGRESS) c.prog = { xp: r.varu(), flags: r.u8() };
        else if (t === S2C.SNAPSHOT) {
          const flags = readHeader(r, c.hdr);
          if (flags & SNAP.GLOBAL) readGlobal(r, c.glob);
          readSelf(r, c.self, flags);
        }
      };
      setTimeout(resolve, 8000);
    });
    const chat = (text) => {
      const w = new Writer(64);
      w.u8(C2S.CHAT);
      w.str(text);
      ws.send(w.bytes());
    };
    let ok = false;
    for (let i = 0; i < 100 && !(ok = !!(c.prog && c.prog.flags & PROGF.LOADED)); i++) await sleep(50);
    check('in a room\'s worker, a joining guest\'s record is read on the network thread and handed in', ok);
    chat(`/xp ${xpForLevel(3)}`);
    for (let i = 0; i < 100 && !(ok = c.prog?.xp === xpForLevel(3)); i++) await sleep(50);
    await sleep(2200); // (the record's XP goes over to the network thread at once; the board's write is every 2 s)
    let v = await api('/api/progress', { guestId });
    check('the XP earned in the game is on the record the API reads', ok && v.status === 200 && v.body.level === 3 && v.body.pending === 1, JSON.stringify(v.body));
    const perk = idOf('Thick Skin');
    v = await api('/api/progress/pick', { guestId, perk });
    for (let i = 0; i < 100 && !(ok = c.self.perks === perkMask([perk])); i++) await sleep(50);
    check('a pick through the API reaches the game the player is in: their simulation has it', v.status === 200 && ok, `${c.self.perks} / ${perkMask([perk])}`);
    v = await api('/api/progress/pick', { guestId, perk });
    check('...and the same pick again is refused', v.status === 409);
    ws.close();
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)));
  }
  if (failed) console.log(log.split('\n').slice(-20).join('\n'));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
