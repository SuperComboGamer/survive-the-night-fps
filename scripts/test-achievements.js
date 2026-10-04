// Achievements (shared/achievements.js, server/achievements.js, server/userachievements.js, client/net/achievements.js):
//   - the list and the rules on their own: counters reaching their goals, feats, junk records, merging two records
//   - a running Game: what each hook counts, decoded off the wire as the client reads it (EVT.ACHIEVE), feats once per
//     connection, an account's progress posted to the network thread and its unlocks told back
//   - the browser's guest record: what an event adds, the banner's list, a day played
//   - the accounts' store on PGlite: counters unlocking as the counts cross their goals, friends and strangers, a day
//     played, and a guest record merged into an account (the greater of each count, unlocks of either, never the board)
//   - the HTTP API against a real server: your own, a friend's and nobody else's, the merge
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACHIEVEMENTS, ACH_BY_ID, ACH_BY_N, ACH_STATS, ACHF, KILL_FEATS, applyAchievements, sanitizeProgress, mergeProgress, counterUnlocks, achProgress } from '../shared/achievements.js';
import { C2S, PROTOCOL_VERSION, SNAP, Writer, Reader } from '../shared/protocol.js';
import { ITEM, ZTYPE, KILLER, EVT } from '../shared/defs.js';
import { floatY } from '../shared/swim.js';
import { handcars } from '../shared/handcar.js';
import { readEvents } from '../client/net/decode.js';
import { GLYPH_NAMES } from '../client/ui/icons.js';
import { Game } from '../server/game.js';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { AchievementStore } from '../server/userachievements.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = (n) => `7c9e6679-7425-40de-944b-${String(n).padStart(12, '0')}`;

// ---------------------------------------------------------------- the list and the rules
{
  const ns = new Set(ACHIEVEMENTS.map((a) => a.n));
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  check(`${ACHIEVEMENTS.length} achievements, each number and id once, numbers fit a byte`, ns.size === ACHIEVEMENTS.length && ids.size === ACHIEVEMENTS.length && Math.max(...ns) <= 255 && Math.min(...ns) >= 1);
  check('every counter counts a stat that exists, to a goal above zero', ACHIEVEMENTS.every((a) => !a.stat || (ACH_STATS.includes(a.stat) && a.goal > 0)));
  check('every one has a name, a description, a tier and a group', ACHIEVEMENTS.every((a) => a.name && a.desc && ['bronze', 'silver', 'gold', 'platinum'].includes(a.tier) && a.group));
  const badIcons = ACHIEVEMENTS.filter((a) => !(a.icon.startsWith('item:') ? Number.isInteger(+a.icon.slice(5)) : GLYPH_NAMES.includes(a.icon)));
  check('every icon is a glyph or an item', !badIcons.length, badIcons.map((a) => a.id).join());
  check('every weapon kind of kill names a feat', Object.values(KILL_FEATS).every((id) => ACH_BY_ID.get(id) && !ACH_BY_ID.get(id).stat));
  check('ACH_BY_N finds them by number', ACHIEVEMENTS.every((a) => ACH_BY_N[a.n] === a));

  const rec = sanitizeProgress(null);
  check('an empty record out of nothing', ACH_STATS.every((k) => rec.stats[k] === 0) && !Object.keys(rec.unlocked).length);
  let fresh = applyAchievements(rec, { kills: 9 }, [], 1000);
  check('9 kills unlock nothing', !fresh.length && rec.stats.kills === 9);
  fresh = applyAchievements(rec, { kills: 1, headshots: 3 }, ['kill_pistol', 'kill_pistol', 'kills_1000', 'nope'], 2000);
  check('the 10th kill unlocks First Blood; a feat once; a counter or a junk id passed as a feat does nothing', fresh.join() === 'kill_pistol,kills_10' && rec.unlocked.kills_10 === 2000 && !rec.unlocked.kills_1000 && !rec.unlocked.nope, fresh.join());
  check('...and nothing again the second time', !applyAchievements(rec, { kills: 1 }, ['kill_pistol']).length);
  check("a counter's progress", achProgress(ACH_BY_ID.get('kills_100'), rec.stats).have === 11 && achProgress(ACH_BY_ID.get('kills_10'), rec.stats).have === 10 && achProgress(ACH_BY_ID.get('pacifist'), rec.stats) === null);
  fresh = applyAchievements(rec, { kills: 5000 });
  check('a jump past several goals unlocks each of them', fresh.join() === 'kills_100,kills_1000', fresh.join());
  check('counterUnlocks: what the counts reach and is not unlocked yet', counterUnlocks({ nights: 12 }, { nights_1: 1 }).join() === 'nights_10');

  const junk = sanitizeProgress({ stats: { kills: -4, nights: 'x', escapes: 2.9, headshots: 1e30, bogus: 5 }, unlocked: { kills_10: 'yesterday', drowned: 1e30, nope: 5, flare: 1700000000000 } }, 1800000000000);
  check('junk in a record: counts made whole and capped, unknown ids dropped, bad times "some time"', junk.stats.kills === 0 && junk.stats.nights === 0 && junk.stats.escapes === 2 && junk.stats.headshots === 0x7fffffff && !('bogus' in junk.stats) && junk.unlocked.kills_10 === 1 && junk.unlocked.drowned === 1800000000000 && junk.unlocked.flare === 1 && !('nope' in junk.unlocked), JSON.stringify(junk));
  check('...and an array where the unlocks should be is none', !Object.keys(sanitizeProgress({ unlocked: ['kills_10'] }).unlocked).length);
  const m = mergeProgress({ stats: { kills: 5, nights: 9 }, unlocked: { a: 30, b: 10 } }, { stats: { kills: 7, nights: 2 }, unlocked: { a: 20, c: 5 } });
  check('merging two records: the greater of each count, every unlock at its earlier time', m.stats.kills === 7 && m.stats.nights === 9 && m.unlocked.a === 20 && m.unlocked.b === 10 && m.unlocked.c === 5, JSON.stringify(m));
}

// ---------------------------------------------------------------- in a game
// What each player was sent: EVT.ACHIEVE events, decoded by the client's own reader
function watch(game) {
  const got = new Map(); // player id -> [{ flags, add, ids }]
  const emit = game.emit.bind(game);
  game.emit = (fn, opts = {}) => {
    emit(fn, opts);
    const ev = game.events[game.events.length - 1];
    if (ev.bytes[0] !== EVT.ACHIEVE) return;
    const buf = new Uint8Array(ev.bytes.length + 1);
    buf[0] = 1;
    buf.set(ev.bytes, 1);
    const r = new Reader(buf);
    readEvents(r, { achieve: (flags, add, ids) => (got.get(ev.to) || got.set(ev.to, []).get(ev.to)).push({ flags, add, ids: ids.map((n) => ACH_BY_N[n].id) }) }, SNAP.EVENTS, new Map());
    if (r.left) throw new Error(`${r.left} bytes left after an EVT.ACHIEVE`);
  };
  // everything sent to p, added up: { add, ids }
  got.of = (p) => {
    const add = {};
    const ids = [];
    for (const e of got.get(p.id) || []) {
      for (const [k, n] of Object.entries(e.add)) add[k] = (add[k] || 0) + n;
      ids.push(...e.ids);
    }
    return { add, ids };
  };
  return got;
}
function enter(game, name, opts = {}) {
  const c = { chats: [] };
  c.conn = {
    user: opts.user || null,
    send(bytes) {
      const r = new Reader(bytes.slice());
      if (r.u8() === 4) {
        r.u16();
        r.u8();
        c.chats.push(r.str());
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
  w.str(opts.pid ?? randomUUID());
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.session.player?.id);
  return c;
}
const wait = (game, secs) => {
  for (let i = 0; i < secs * 20; i++) game.update();
};
const walker = (game, p, dx = 3) => game.zm.spawn(ZTYPE.WALKER, p.state.x + dx, p.state.z + 3);

{
  const game = new Game({ seed: 4242, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  const got = watch(game);
  const Ann = enter(game, 'Ann');
  const Ben = enter(game, 'Ben');
  const Cat = enter(game, 'Cat');
  const ann = Ann.p();
  const ben = Ben.p();
  const cat = Cat.p();

  for (let i = 0; i < 3; i++) game.combat.killZombie(walker(game, ann, 3 + i), ann, { weapon: ITEM.PISTOL, headshot: i < 2 });
  game.combat.killZombie(walker(game, ann), ann, { weapon: ITEM.KNIFE, melee: true });
  wait(game, 1.1);
  let a = got.of(ann);
  check('kills with the pistol and the knife: those feats go out within a second, with the counts', a.ids.sort().join() === 'kill_knife,kill_pistol' && a.add.kills === 4 && a.add.headshots === 2, JSON.stringify(a));
  game.combat.killZombie(walker(game, ann), ann, { weapon: ITEM.PISTOL });
  wait(game, 3.2);
  a = got.of(ann);
  check('...a feat goes once per connection; counts keep coming every few seconds', a.ids.filter((x) => x === 'kill_pistol').length === 1 && a.add.kills === 5, JSON.stringify(a));
  check('nothing goes to a player who did none of it', !got.get(ben.id) && !got.get(cat.id));

  // a night: Ann shoots, Ben does not and ends it nearly dead, Cat dies of a fall
  game.startNight();
  game.ach.shot(ann, ITEM.PISTOL);
  ben.hp = 6;
  game.killPlayer(cat, { kind: KILLER.WORLD, fall: true });
  game.startDay();
  wait(game, 1.1);
  const b = got.of(ben);
  check('the dawn: the night counts for whoever saw it through; Ben never fired and is on 6 health', b.add.nights === 1 && b.ids.includes('pacifist') && b.ids.includes('low_hp') && got.of(ann).add.nights === 1 && !got.of(ann).ids.includes('pacifist'), JSON.stringify([b, got.of(ann)]));
  check('a death from a fall', got.of(cat).ids.includes('fall_death') && !got.of(cat).add.nights, JSON.stringify(got.of(cat)));

  // a revive of a guest by a guest: a stranger (guests have no friends)
  game.goDown(ann);
  game.revive(ann, ben);
  game.goDown(ann);
  game.revive(ann, null); // her own medkit
  wait(game, 3.2);
  check('a revive counts for the one who did it, and a guest is a stranger', got.of(ben).add.revives === 1 && got.of(ben).ids.includes('stranger') && !got.of(ann).add.revives, JSON.stringify(got.of(ben)));

  // one grenade, five of the dead
  const s = ann.state;
  for (let i = 0; i < 5; i++) game.zm.spawn(ZTYPE.WALKER, s.x + 20 + (i % 3) * 0.6, s.z + 20 + Math.floor(i / 3) * 0.6);
  game.update(); // (into the grid the blast finds them by)
  game.combat.explode(s.x + 20.6, s.y + 1, s.z + 20.3, 5, { zombies: 5000, owner: ann, weapon: ITEM.GRENADE });
  // a Tank's charge that missed Ben, a leaper thrown off, the walkie-talkie
  const tank = game.zm.spawn(ZTYPE.TANK, ben.state.x + 8, ben.state.z);
  game.ach.dodged(tank, ben.id);
  game.ach.threwOff(ben);
  game.ach.onAir(ben);
  wait(game, 1.1);
  check('five killed by one grenade', got.of(ann).ids.includes('grenade_5'), JSON.stringify(got.of(ann)));
  check("a Tank's charge that missed, a leaper thrown off, the walkie-talkie", ['tank_dodge', 'leaper_off', 'walkie'].every((x) => got.of(ben).ids.includes(x)), JSON.stringify(got.of(ben)));

  // travel: 12 m a second for 4 s, then a teleport that is not travel
  const d0 = got.of(ben).add.distance || 0;
  for (let k = 0; k < 4; k++) {
    ben.state.x += 12;
    wait(game, 1);
  }
  ben.state.x += 300;
  wait(game, 3.2);
  const dm = (got.of(ben).add.distance || 0) - d0;
  check('distance: what a survivor covers, not a jump across the map', dm >= 46 && dm <= 50, String(dm));

  // the run won with a death in it: no Flawless; whoever is at the car escapes
  const car = game.world.car;
  Object.assign(ann.state, { x: car.x + 2, z: car.z });
  Object.assign(ben.state, { x: car.x + 300, z: car.z });
  game.victory();
  check('a win: the one at the car escaped, the one far off did not; a death in the run is no Flawless', got.of(ann).add.escapes === 1 && !got.of(ben).add.escapes && !got.of(ann).ids.includes('flawless'), JSON.stringify(got.of(ann)));
}

// a flawless run in an invite-only game; a signed-in player's progress goes to the network thread
{
  const posted = [];
  const game = new Game({ seed: 4243, godMode: true, dayLength: 3600, themes: false, inviteOnly: true, achieve: (m) => posted.push(m), log: () => {} });
  const got = watch(game);
  const Gus = enter(game, 'Gus');
  const Acc = enter(game, 'Acct', { user: { id: uid(1), name: 'Acct' } });
  const Acc2 = enter(game, 'Other', { user: { id: uid(2), name: 'Other' } });
  const gus = Gus.p();
  const acc = Acc.p();
  wait(game, 1.1);
  check('joining an invite-only game: Plus One', got.of(gus).ids.includes('invited'));
  game.combat.killZombie(walker(game, acc), acc, { weapon: ITEM.AK47 });
  game.goDown(Acc2.p());
  game.revive(Acc2.p(), acc);
  wait(game, 3.2);
  const mine = posted.filter((m) => m.user === uid(1));
  const add = {};
  for (const m of mine) for (const [k, n] of Object.entries(m.add)) add[k] = (add[k] || 0) + n;
  const feats = mine.flatMap((m) => m.feats);
  check("a signed-in player's progress goes to the network thread, not to their browser", !got.get(acc.id) && add.kills === 1 && add.revives === 1 && feats.includes('kill_rifle') && feats.includes('invited'), JSON.stringify(mine));
  check('...and reviving another account is asked about there (friend or stranger)', mine.some((m) => m.strangers.includes(uid(2))) && !feats.includes('stranger'), JSON.stringify(mine));
  game.ach.achieved(uid(1), ['kills_10', 'nope']);
  const told = got.get(acc.id)?.[0];
  check('what that unlocked is told to the player (ACHF.ACCOUNT), and the game hears of it in the chat', told && told.flags & ACHF.ACCOUNT && told.ids.join() === 'kills_10' && !Object.keys(told.add).length && Gus.chats.some((t) => t === 'Acct unlocked First Blood.'), JSON.stringify([told, Gus.chats]));
  const car = game.world.car;
  for (const p of game.players.values()) Object.assign(p.state, { x: car.x + 1, z: car.z });
  game.victory();
  wait(game, 1.1);
  check('a win with nobody dead: Flawless, for the guest and (posted) the account', got.of(gus).ids.includes('flawless') && posted.some((m) => m.user === uid(1) && m.feats.includes('flawless')));
}

// the places: the mine and its deepest room, every place in the valley, a swim and the water that nearly had them, a
// handcar's whole line, the Ferris wheel
{
  const game = new Game({ seed: 4242, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  const got = watch(game);
  const p = enter(game, 'Pat').p();
  const s = p.state;
  const w = game.world;
  const at = (x, y, z) => {
    Object.assign(s, { x, y, z });
    wait(game, 1);
  };
  const box = w.containers.find((c) => c.ctype === 12); // CONT.STRONGBOX
  if (w.mine && box) {
    at(box.x + 1, box.y, box.z);
    check('down the mine, by the strongbox: Into the Dark and Rock Bottom', ['mine_enter', 'mine_deep'].every((x) => got.of(p).ids.includes(x)), JSON.stringify(got.of(p)));
  } else check('this valley has a mine with a strongbox (seed 4242)', false);
  for (const z of w.zones) at(z.x, w.heightAt(z.x, z.z), z.z);
  check(`every one of the ${w.zones.length} places visited: Tourist`, got.of(p).ids.includes('landmarks'), JSON.stringify(got.of(p).ids));
  const L = w.lake;
  Object.assign(s, { x: L.x, z: L.z });
  s.y = floatY(s);
  wait(game, 1);
  game.ach.drowning(p);
  at(w.car.x, w.heightAt(w.car.x, w.car.z), w.car.z);
  check('out of the water 60 m and more from where the swim began, after taking water: Strong Swimmer and Second Wind', ['swim_lake', 'near_drown'].every((x) => got.of(p).ids.includes(x)), JSON.stringify(got.of(p).ids));
  const runs = handcars(w);
  if (runs.length) {
    game.handcars.debug(p);
    const k = s.cart - 1;
    for (const at of [runs[k].lo + 2, (runs[k].lo + runs[k].hi) / 2, runs[k].hi - 2]) {
      s.cartS = at;
      wait(game, 1);
    }
    check('a handcar ridden from one end of its line to the other: End of the Line', got.of(p).ids.includes('handcar_run'), JSON.stringify(got.of(p).ids));
    s.cart = 0;
  }
  game.fair.running = true;
  game.fair.fuel = 1e6;
  s.ride = 3;
  wait(game, 1);
  check('in a gondola of the Ferris wheel while it turns: Thrill Seeker', got.of(p).ids.includes('ferris'), JSON.stringify(got.of(p).ids));
}

// ---------------------------------------------------------------- the browser's guest record
{
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const ach = await import('../client/net/achievements.js');
  const shown = [];
  ach.onUnlock((list) => shown.push(...list.map((a) => a.id)));
  ach.achievementEvent(0, { kills: 9, nights: 1 }, [ACH_BY_ID.get('flare').n]);
  check('a guest event: counts added, feats and counters unlocked, the banner told', JSON.parse(mem.get('stn.achievements')).stats.kills === 9 && shown.join() === 'flare,nights_1', shown.join());
  ach.achievementEvent(0, { kills: 1 }, [ACH_BY_ID.get('flare').n]);
  check('...the 10th kill, and the feat it already has is no news', shown.join() === 'flare,nights_1,kills_10', shown.join());
  const stored = JSON.parse(mem.get('stn.achievements'));
  check('kept in localStorage as a versioned record, waiting to be merged into an account', stored.v === 1 && stored.pending === true && stored.unlocked.kills_10 > 0, JSON.stringify(stored));
  ach.joinedGame(false);
  ach.joinedGame(false);
  check('a game joined as a guest: one day played on, however many games that day', JSON.parse(mem.get('stn.achievements')).stats.days === 1);
  ach.joinedGame(true);
  check("...an account's days are the server's to count", JSON.parse(mem.get('stn.achievements')).stats.days === 1);
  shown.length = 0;
  ach.achievementEvent(ACHF.ACCOUNT, {}, [ACH_BY_ID.get('kills_100').n]);
  check("an account's unlock is shown and not put in the browser's record", shown.join() === 'kills_100' && !JSON.parse(mem.get('stn.achievements')).unlocked.kills_100);
  mem.set('stn.achievements', '{"v":1,"stats":{"kills":"lots"},"unlocked":{"nope":1}}');
  check('a stored record that is junk reads as one with nothing in it', ach.achievementsView().stats.kills === 0 && !Object.keys(ach.achievementsView().unlocked).length);
}

// ---------------------------------------------------------------- the accounts' store
{
  const db = await openDb('pglite:memory');
  await migrate(db);
  const user = async (name) => (await db.query(`INSERT INTO users (email, username, password_hash) VALUES ($1, $2, 'x') RETURNING id`, [`${name}@x.io`, name])).rows[0].id;
  const [A, B, C] = [await user('a'), await user('b'), await user('c')];
  await db.query('INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1)', [A, B]);
  const told = [];
  const room = { achieved: (u, ids) => told.push([u, ...ids.sort()].join(' ')) };
  const store = new AchievementStore({ db });
  const flush = async () => {
    told.length = 0;
    await store.flush();
    return told.sort();
  };

  store.add(A, { kills: 9 }, [], [], room);
  check('9 kills: written, nothing unlocked', !(await flush()).length);
  store.add(A, { kills: 1, headshots: 2 }, ['kill_pistol', 'kills_1000', 'bogus'], [], room);
  check('the 10th: First Blood and the feat, told to the room; a counter posted as a feat or a junk id is not', (await flush()).join() === `${A} kill_pistol kills_10`, told.join('|'));
  store.add(A, { kills: 2 }, ['kill_pistol'], [], room);
  check("...and what it has already is not told again", !(await flush()).length);
  store.add(A, { revives: 1 }, [], [B, C], room);
  check('revived a friend and a stranger: the revive counts, and the stranger is Kindness of Strangers', (await flush()).join() === `${A} revives_1 stranger`, told.join('|'));
  store.add(B, { revives: 1 }, [], [A], room);
  check('...revived only a friend: no stranger', (await flush()).join() === `${B} revives_1`, told.join('|'));
  store.together(C, [A, B], room);
  check('in a game with no friend of theirs: nothing', !(await flush()).length);
  store.together(A, [B, C], room);
  check('in a game with a friend: Better Together, for both of them', (await flush()).join('|') === [`${A} friend`, `${B} friend`].sort().join('|'), told.join('|'));
  store.played(A, room);
  store.played(A, room);
  await flush();
  store.played(A, room);
  await flush();
  const days = (await db.query(`SELECT value FROM user_achievement_stats WHERE user_id = $1 AND stat = 'days'`, [A])).rows[0]?.value;
  check('playing three times in a day is one day', days === 1, String(days));
  await db.query(`UPDATE user_achievement_stats SET value = value - 1 WHERE user_id = $1 AND stat = 'day_mark'`, [A]);
  store.played(A, room);
  await flush();
  check('...and the next day is another', (await db.query(`SELECT value FROM user_achievement_stats WHERE user_id = $1 AND stat = 'days'`, [A])).rows[0]?.value === 2);

  const mine = await store.forUser(A);
  check("an account's record: the counts and the unlocks with when", mine.stats.kills === 12 && mine.stats.days === 2 && mine.unlocked.some((u) => u.id === 'kills_10' && u.at > Date.now() - 60000 && u.source === 'game') && !('day_mark' in mine.stats), JSON.stringify(mine));

  // a guest record merged in
  const t0 = Date.UTC(2025, 5, 1);
  const guest = { stats: { kills: 150, nights: 3, escapes: 1 }, unlocked: { kill_rifle: t0, kills_10: t0, kills_100: t0, nights_10: t0, bogus: t0, escapes_1: 'when' } };
  const merged = await store.merge(A, guest);
  const at = (id) => merged.unlocked.find((u) => u.id === id);
  check('a merge: the greater of each count', merged.stats.kills === 150 && merged.stats.nights === 3 && merged.stats.revives === 1 && merged.stats.days === 2, JSON.stringify(merged.stats));
  check("...the guest's feats and the counters its counts reach come over, as the guest's", at('kill_rifle')?.source === 'guest' && at('kill_rifle').at === t0 && at('kills_100')?.source === 'guest' && at('escapes_1')?.source === 'guest', JSON.stringify(merged.unlocked));
  check("...one the account had keeps its own time; one the counts do not reach (nights 3 of 10) does not come", at('kills_10')?.source === 'game' && at('kills_10').at > t0 && !at('nights_10') && !at('bogus'), JSON.stringify(merged.unlocked));
  const again = await store.merge(A, guest);
  check('merging the same again changes nothing', JSON.stringify(again) === JSON.stringify(merged));
  check('a merge never reaches the leaderboard', !(await db.query('SELECT 1 FROM player_stats')).rowCount);
  let n = 0;
  for (let i = 0; i < 12; i++) await store.merge(C, {}).catch((err) => err.status === 429 && n++);
  check('merging over and over is slowed down', n > 0);

  // a write that fails is tried again
  const tx = db.tx;
  db.tx = async () => {
    throw new Error('down');
  };
  store.add(C, { kills: 10 }, [], [], room);
  await flush();
  db.tx = tx;
  check('a write that fails keeps what it had for the next one', (await flush()).join() === `${C} kills_10`, told.join('|'));
  await store.close();
  await db.close();
}

// ---------------------------------------------------------------- the API, on a real server
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const dir = mkdtempSync(join(tmpdir(), 'stn-ach-'));
const procs = [];
async function startServer(env) {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), STATS_FILE: '', GAME_IDLE_SECONDS: '2', LOBBY_LIMITS: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc);
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  proc.log = () => log;
  for (let i = 0; i < 200 && !log.includes('listening'); i++) await sleep(50);
  if (!log.includes('listening')) throw new Error(`server did not start:\n${log}`);
  return { port, proc, base: `http://localhost:${port}` };
}
try {
  const { base, port, proc } = await startServer({ DATABASE_URL: `pglite:${join(dir, 'db')}` });
  const browser = () => {
    const b = { cookie: '' };
    b.req = async (method, path, body) => {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(15000), method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(b.cookie ? { cookie: b.cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      for (const c of res.headers.getSetCookie?.() || []) {
        const m = /^stn_session=([^;]*)/.exec(c);
        if (m) b.cookie = m[1] ? `stn_session=${m[1]}` : '';
      }
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    return b;
  };
  const ann = browser();
  const ben = browser();
  const cal = browser();
  check('not signed in: no achievements to ask for', (await ann.req('GET', '/api/achievements')).status === 401);
  await ann.req('POST', '/api/auth/register', { email: 'ann@x.io', username: 'Ann', password: 'ann-password' });
  await ben.req('POST', '/api/auth/register', { email: 'ben@x.io', username: 'Ben', password: 'ben-password' });
  await cal.req('POST', '/api/auth/register', { email: 'cal@x.io', username: 'Cal', password: 'cal-password' });
  const ids = {};
  for (const [k, b] of Object.entries({ ann, ben, cal })) ids[k] = (await b.req('GET', '/api/auth/me')).body.user.id;
  const none = await ann.req('GET', '/api/achievements');
  check('a new account: every count 0, nothing unlocked', none.status === 200 && none.body.stats.kills === 0 && Array.isArray(none.body.unlocked) && !none.body.unlocked.length, JSON.stringify(none.body));
  const merged = await ann.req('POST', '/api/achievements/merge', { stats: { kills: 120 }, unlocked: { flare: Date.UTC(2025, 1, 1) } });
  check('the merge, over HTTP: the record back', merged.status === 200 && merged.body.stats.kills === 120 && merged.body.unlocked.some((u) => u.id === 'kills_100') && merged.body.unlocked.some((u) => u.id === 'flare'), JSON.stringify(merged.body));
  await ann.req('POST', '/api/friends/request', { username: 'Ben' });
  await ben.req('POST', '/api/friends/accept', { id: ids.ann });
  const theirs = await ben.req('GET', `/api/achievements/${ids.ann}`);
  const stranger = await cal.req('GET', `/api/achievements/${ids.ann}`);
  const junk = await cal.req('GET', '/api/achievements/not-an-id');
  check("a friend's achievements, and nobody else's", theirs.status === 200 && theirs.body.stats.kills === 120 && stranger.status === 403 && junk.status === 404, JSON.stringify([theirs.status, stranger.status, junk.status]));

  // in a game: a signed-in player's unlocks come back from the database (Better Together: Ann and Ben are friends)
  const play = (b, code, name) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws${code ? `?game=${code}` : ''}`, { headers: b?.cookie ? { cookie: b.cookie } : {} });
      ws.binaryType = 'arraybuffer';
      const c = { ws, chats: [] };
      ws.onopen = () => {
        const w = new Writer(128);
        w.u8(C2S.JOIN);
        w.u8(PROTOCOL_VERSION);
        w.str(name);
        w.str('');
        ws.send(w.bytes());
      };
      ws.onmessage = (m) => {
        const r = new Reader(m.data);
        const t = r.u8();
        if (t === 1) resolve(c);
        else if (t === 4) {
          r.u16();
          r.u8();
          c.chats.push(r.str());
        }
      };
      c.close = () => new Promise((done) => ((ws.onclose = done), ws.close(4001)));
    });
  const g = await fetch(base + '/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteOnly: true }) }).then((r) => r.json());
  const a = await play(ann, g.code, 'Ann');
  const b = await play(ben, g.code, 'Ben');
  const heard = async (fn, ms = 4000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (fn()) return true;
    return false;
  };
  check('two friends in one invite-only game: the game hears of their unlocks from the database', await heard(() => a.chats.some((t) => /^Ben unlocked .*Better Together/.test(t)) && a.chats.some((t) => /^Ann unlocked .*Plus One/.test(t))), JSON.stringify(a.chats));
  const after = (await ben.req('GET', '/api/achievements')).body;
  check("...and they are on Ben's record, with a day played", after.unlocked.some((u) => u.id === 'friend') && after.unlocked.some((u) => u.id === 'invited') && after.stats.days === 1, JSON.stringify(after));
  await Promise.all([a.close(), b.close()]);
  check('the server logged nothing that went wrong', !/failed|Error|error:/.test(proc.log()), proc.log().split('\n').filter((l) => /failed|Error|error:/.test(l)).join('\n'));

  const plain = await startServer({ DATABASE_URL: '' });
  const no = await fetch(plain.base + '/api/achievements').then((r) => r.json());
  check('without a database: no accounts, and the browser keeps its own', no.accounts === false && no.stats === null);
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

for (const p of procs) p.kill('SIGTERM');
await sleep(300);
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
