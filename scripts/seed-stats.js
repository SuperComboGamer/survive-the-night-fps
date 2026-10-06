// Fills a database with made-up match history, to look at the stats page (/stats) without a live server's records:
// a game that grows over `days`, played mostly in the evenings, by accounts and guests who come back or do not.
// Every record goes in through the match store, as a real game's would.
//   node scripts/seed-stats.js pglite:./data/stats-demo [days = 60] [seed = 7]
//   DATABASE_URL=pglite:./data/stats-demo npm start      then open http://localhost:3000/stats
// Never point it at the live database: it adds rows nobody played.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MatchStore } from '../server/matchstore.js';

const WEAPONS = [['pistol', 0.3], ['shotgun', 0.16], ['ak47', 0.14], ['bat', 0.1], ['machete', 0.08], ['m4a1', 0.07], ['hunting_rifle', 0.05], ['db_shotgun', 0.04], ['crossbow', 0.03], ['flamethrower', 0.02], ['nunchaku', 0.01]];
const ZOMBIES = [['walker', 0.52], ['runner', 0.22], ['spitter', 0.08], ['dog', 0.07], ['leaper', 0.04], ['boomer', 0.03], ['roper', 0.02], ['tank', 0.01], ['shade', 0.01]];
const CAUSES = [['walker', 0.34], ['runner', 0.24], ['spitter', 0.1], ['tank', 0.08], ['boss_brute', 0.06], ['leaper', 0.05], ['dog', 0.05], ['turned_player', 0.04], ['fall', 0.02], ['drowned', 0.02]];
const BOSSES = ['boss_brute', 'boss_alpha', 'boss_abomination', 'boss_hivequeen', 'boss_bloater'];
const SUPPLIES = ['car_battery', 'spare_tire', 'spark_plugs', 'fan_belt', 'fuel_can'];
const NAMES = ['Ann', 'Bob', 'Cy', 'Dee', 'Rook', 'Vex', 'Mara', 'Jules', 'Kip', 'Nox', 'Ivy', 'Taz', 'Odin', 'Pell', 'Quinn', 'Rue', 'Sol', 'Tam', 'Ula', 'Wren', 'Xan', 'Yuki', 'Zed', 'Ash', 'Bram', 'Cass', 'Dax', 'Eli', 'Fen', 'Gus'];
const BUILDS = ['a1b2c3d', 'b4e5f60', 'c7d8e91', 'd0a1b23', 'e4f5a67', 'f8091bc'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -> { matches, players, accounts }
export async function seedStats(db, { days = 60, seed = 7, now = Date.now() } = {}) {
  const r = rng(seed);
  const pick = (list) => {
    let x = r();
    for (const [k, w] of list) if ((x -= w) <= 0) return k;
    return list[0][0];
  };
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const store = new MatchStore({ db });
  clearInterval(store.timer);
  clearInterval(store.staleTimer);

  // the people: a pool that grows; some make accounts, some never come back
  const people = [];
  const person = (at) => {
    const n = people.length;
    const account = r() < 0.3;
    const p = { name: `${NAMES[n % NAMES.length]}${n >= NAMES.length ? n : ''}`, userId: null, guestKey: account ? null : randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''), loyal: r(), at };
    if (account) {
      p.userId = randomUUID();
      p.pendingUser = at;
    }
    people.push(p);
    return p;
  };
  const users = [];
  let matches = 0;
  const DAY = 86400_000;
  const start = now - days * DAY;
  for (let d = 0; d < days; d++) {
    const dayStart = start + d * DAY;
    const growth = 0.25 + (d / days) ** 1.4 * 1.1 + (d % 7 >= 5 ? 0.25 : 0);
    const n = Math.max(0, Math.round(growth * int(4, 9)));
    store.build = BUILDS[Math.min(BUILDS.length - 1, Math.floor((d / days) * BUILDS.length))];
    for (let m = 0; m < n; m++) {
      // evenings (UTC 18-04) most, a few at any hour
      const hour = r() < 0.75 ? (18 + int(0, 10)) % 24 : int(0, 23);
      let startedAt = dayStart + hour * 3600_000 + int(0, 3599) * 1000;
      const team = Math.min(8, 1 + Math.floor(-Math.log(1 - r() * 0.95) * 1.4));
      const crew = [];
      for (let i = 0; i < team; i++) {
        const back = people.filter((p) => p.at < startedAt && r() < p.loyal * 0.5);
        const p = back.length && r() < 0.55 ? back[int(0, back.length - 1)] : person(startedAt);
        if (!crew.includes(p)) crew.push(p);
      }
      for (const p of crew)
        if (p.pendingUser) {
          users.push(p);
          p.pendingUser = 0;
          await db.query(`INSERT INTO users (id, email, username, password_hash, created_at) VALUES ($1, $2, $3, 'x', $4)`, [p.userId, `${p.name.toLowerCase()}@example.com`, p.name, new Date(startedAt)]);
        }
      const mode = pick([['nightfall', 0.62], ['ember', 0.26], ['blackout', 0.12]]);
      const skill = (mode === 'ember' ? 0.85 : mode === 'blackout' ? 0.45 : 0.65) + Math.min(0.15, crew.length * 0.03);
      let nights = 0;
      while (nights < 12 && r() < skill - nights * 0.035) nights++;
      const outcome = nights >= 4 && r() < 0.35 ? 'victory' : r() < 0.72 ? 'wipe' : 'abandoned';
      const lastDay = nights + 1;
      const durationS = Math.round(lastDay * int(380, 520) + int(0, 200));
      startedAt = Math.min(startedAt, now - durationS * 1000 - 60_000); // (over before now)
      const id = randomUUID();
      store.push({ k: 'match', id, startedAt, seed: int(1, 1e9), startDay: 1, seats: 8, protocol: 37, settings: { difficulty: mode } });
      let kills = 0;
      let deaths = 0;
      let downs = 0;
      let escaped = 0;
      // the nights
      for (let k = 1; k <= Math.min(lastDay, 12); k++) {
        const survived = k <= nights;
        const last = k === lastDay;
        const boss = k >= 2 && r() < 0.45 ? BOSSES[int(0, k > 5 ? 4 : 1)] : null;
        store.push({
          k: 'night', matchId: id, night: k, startedAt: startedAt + k * 400_000, endedAt: startedAt + k * 400_000 + 180_000, durationS: 180, theme: null, boss, bossKilled: !!boss && survived && r() < 0.7,
          hordeSize: 20 + k * int(8, 14) * Math.max(1, crew.length / 2), hordeHpMul: 1, playersStart: crew.length, survivorsStart: crew.length, survivorsEnd: survived ? crew.length : 0,
          kills: int(10, 30) * k, structuresLost: int(0, 6), downs: int(0, 3), deaths: survived ? 0 : crew.length, revives: int(0, 2), outcome: survived ? 'dawn' : last && outcome === 'victory' ? 'escaped' : last && outcome === 'wipe' ? 'wipe' : 'abandoned',
        });
      }
      // each player's stint
      for (const p of crew) {
        const seconds = outcome === 'abandoned' && r() < 0.5 ? int(20, durationS) : durationS * (0.6 + r() * 0.4);
        const pk = Math.round((seconds / 60) * (1.5 + r() * 3.5) * (0.6 + p.loyal));
        const shots = Math.round(pk * (2 + r() * 3));
        const killsByWeapon = {};
        const killsByType = {};
        for (let i = 0; i < pk; i++) {
          const w = pick(WEAPONS);
          killsByWeapon[w] = (killsByWeapon[w] || 0) + 1;
          const z = pick(ZOMBIES);
          killsByType[z] = (killsByType[z] || 0) + 1;
        }
        const shotsByWeapon = {};
        const hitsByWeapon = {};
        for (const w in killsByWeapon) {
          shotsByWeapon[w] = Math.round(killsByWeapon[w] * (2 + r() * 3));
          hitsByWeapon[w] = Math.round(shotsByWeapon[w] * (0.3 + r() * 0.4));
        }
        const died = outcome === 'wipe' || r() < 0.25;
        const mine = outcome === 'victory' ? (r() < 0.85 ? 'escaped' : 'left_behind') : outcome === 'wipe' ? 'dead' : 'left';
        if (mine === 'escaped') escaped++;
        const pd = died ? int(1, 3) : 0;
        const pdn = pd + int(0, 3);
        kills += pk;
        deaths += pd;
        downs += pdn;
        const joinedAt = startedAt + int(0, 30) * 1000;
        store.push({
          k: 'player', matchId: id, userId: p.userId, guestKey: p.guestKey, name: p.name, firstStint: true, joinedAt, leftAt: joinedAt + seconds * 1000, seconds,
          joinedDay: 1, joinedPhase: 'day', leftDay: Math.max(1, Math.round((lastDay * seconds) / durationS)), leftPhase: r() < 0.6 ? 'day' : 'night', leftReason: mine === 'left' ? 'left' : 'match_end', outcome: mine,
          kills: pk, zombieKills: 0, deaths: pd, downs: pdn, revivesGiven: crew.length > 1 ? int(0, 4) : 0, revivesReceived: 0, damageDealt: pk * 110, damageTaken: int(100, 900),
          shots, hits: Math.round(shots * 0.45), headshots: Math.round(shots * (0.08 + r() * 0.12)), bossKills: r() < 0.1 ? 1 : 0, nightsSurvived: died ? Math.max(0, nights - 1) : nights,
          distanceM: seconds * (1.2 + r()), crafted: int(0, 12), built: int(0, 20), itemsUsed: int(0, 10), cachesSearched: int(5, 60), suppliesFound: int(0, 2), suppliesInstalled: int(0, 2), pingAvg: int(30, 140),
          killsByType, killsByWeapon, damageTakenBy: { walker: int(50, 400), runner: int(20, 300) }, shotsByWeapon, hitsByWeapon, craftedItems: {}, builtTypes: {}, usedItems: {},
          stats: { longestLifeS: Math.round(seconds * (0.4 + r() * 0.6)), deerKilled: r() < 0.2 ? int(1, 3) : 0 },
        });
        for (let i = 0; i < pdn; i++) {
          const cause = pick(CAUSES);
          const day = int(1, lastDay);
          store.push({ k: 'event', matchId: id, at: joinedAt + int(60, seconds) * 1000, t: int(60, durationS), day, phase: r() < 0.7 ? 'night' : 'day', type: 'down', userId: p.userId, name: p.name, x: 0, z: 0, data: { cause } });
          if (i < pd) store.push({ k: 'event', matchId: id, at: joinedAt + int(60, seconds) * 1000, t: int(60, durationS), day, phase: 'night', type: 'death', userId: p.userId, name: p.name, x: 0, z: 0, data: { cause } });
        }
      }
      // the car's parts, as they were found and put in
      SUPPLIES.forEach((item, i) => {
        const found = int(120, 900) + i * int(60, 200);
        if (found < durationS) store.push({ k: 'event', matchId: id, at: startedAt + found * 1000, t: found, day: 1, phase: 'day', type: 'supply_found', userId: null, name: null, x: 0, z: 0, data: { item } });
        if (found + 200 < durationS) store.push({ k: 'event', matchId: id, at: startedAt + (found + 200) * 1000, t: found + 200, day: 1, phase: 'day', type: 'supply_install', userId: null, name: null, x: 0, z: 0, data: { item } });
      });
      // a sample every 2 minutes (the game takes one every 30 s)
      for (let t = 30; t < durationS; t += 120) store.push({ k: 'sample', matchId: id, t, at: startedAt + t * 1000, day: 1, phase: 'day', players: crew.length, survivors: crew.length, downed: 0, dead: 0, zombies: int(20, 120), tickMs: 0.4 + r() * 0.8, tickP99: 1 + r() * 4, pingAvg: int(30, 140) });
      store.push({
        k: 'match_end', matchId: id, endedAt: startedAt + durationS * 1000, outcome, lastDay, lastPhase: 'night', nightsSurvived: nights, durationS, peakPlayers: crew.length, uniquePlayers: crew.length,
        playerSeconds: durationS * crew.length, suppliesInstalled: outcome === 'victory' ? 7 : int(0, 6), suppliesNeeded: 7, engineStartedS: null, escaped, kills, deaths, downs, revives: int(0, 4),
        structuresBuilt: int(5, 40), structuresLost: int(0, 15), summary: {},
      });
      if (outcome !== 'abandoned' && r() < 0.4)
        for (const p of crew.slice(0, 2)) await store.flush().then(() => db.query(`INSERT INTO difficulty_votes (match_id, voter, rating, outcome, nights_survived, players, my_outcome, my_matches) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`, [id, p.userId ? `u:${p.userId}` : `g:${p.guestKey}`, Math.max(1, Math.min(5, Math.round(3 + (mode === 'blackout' ? 1 : mode === 'ember' ? -1 : 0) + (r() - 0.5) * 2))), outcome, nights, crew.length, outcome === 'victory' ? 'escaped' : 'dead', int(1, 12)]));
      matches++;
      if (store.queue.length > 2000) await store.flush();
    }
  }
  await store.flush();
  await store.close();
  return { matches, players: people.length, accounts: users.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, days = '60', seed = '7'] = process.argv.slice(2);
  if (!url) {
    console.error('usage: node scripts/seed-stats.js <DATABASE_URL> [days] [seed]');
    process.exit(1);
  }
  if (!url.startsWith('pglite:') && !process.env.SEED_STATS_ANYWHERE) {
    console.error('only into a PGlite database (pglite:<folder>): this makes up matches nobody played. SEED_STATS_ANYWHERE=1 to insist');
    process.exit(1);
  }
  const { openDb } = await import('../server/db/index.js');
  const { migrate } = await import('../server/db/migrate.js');
  const db = await openDb(url);
  await migrate(db);
  const out = await seedStats(db, { days: +days, seed: +seed });
  console.log(`seeded ${out.matches} matches, ${out.players} players (${out.accounts} accounts) over ${days} days into ${url}`);
  await db.close();
}
