// The stats page's numbers (server/publicstats.js) against PGlite:
//   - three matches whose every number is known, written through the match store as a game's would be: the totals,
//     the running totals before a range, the day rows, the records and the top survivors come out exactly;
//   - the public answer names no account id, no guest key and no game code; names come out as the game calls them;
//   - the admin's answer: actives, retention, sessions, bounce and deploys from the same matches;
//   - an empty database answers every range with zeros, not an error; an answer is kept for a while, and a range
//     that is not one is read as 30 days;
//   - 60 days of made-up history (scripts/seed-stats.js): the totals agree with the tables, every range answers.
import { randomUUID } from 'node:crypto';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { MatchStore } from '../server/matchstore.js';
import { PublicStats, label } from '../server/publicstats.js';
import { seedStats } from './seed-stats.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

const db = await openDb('pglite:memory');
await migrate(db);
const ps = new PublicStats({ db, live: () => ({ games: 2, players: 5, list: [{ code: 'ABCDEF', name: 'Open game', players: 3, max: 8, day: 2, phase: 1 }] }) });

// ---------------------------------------------------------------- an empty database
{
  let ok = true;
  for (const r of ['7d', '30d', '90d', 'all']) {
    const v = await ps.publicView(r);
    const a = await ps.adminView(r);
    ok &&= v.enabled && v.totals.zombiesKilled === 0 && v.totals.matches === 0 && v.daily.length === 1 && v.heatmap.length === 168 && v.online24h.length >= 96 && Object.values(v.records).every((x) => x === null) && a.actives.mau === 0;
  }
  check('an empty database answers every range with zeros', ok);
  ps.cache.clear();
}

// ---------------------------------------------------------------- three known matches
const ANN = { id: randomUUID(), name: 'Ann' };
await db.query(`INSERT INTO users (id, email, username, password_hash, created_at) VALUES ($1, 'ann@example.com', 'Ann', 'x', now() - interval '20 days')`, [ANN.id]);
const BOB_KEY = 'b0b'.repeat(21) + 'b';
const store = new MatchStore({ db, build: 'abc1234def' });
const H = 3600_000;
const now = Date.now();
const stint = (matchId, who, joinedAt, seconds, o) => ({
  k: 'player', matchId, userId: who.userId ?? null, guestKey: who.guestKey ?? null, name: who.name, firstStint: true, joinedAt, leftAt: joinedAt + seconds * 1000, seconds,
  joinedDay: 1, joinedPhase: 'day', leftDay: o.leftDay ?? 2, leftPhase: o.leftPhase ?? 'night', leftReason: o.leftReason ?? 'match_end', outcome: o.outcome ?? 'dead',
  kills: o.kills, zombieKills: 0, deaths: o.deaths ?? 0, downs: o.downs ?? 0, revivesGiven: o.revives ?? 0, revivesReceived: 0, damageDealt: 0, damageTaken: 0,
  shots: o.shots ?? 0, hits: 0, headshots: o.headshots ?? 0, bossKills: o.bossKills ?? 0, nightsSurvived: o.nights ?? 0, distanceM: o.distanceM ?? 0, crafted: 0, built: o.built ?? 0,
  itemsUsed: 0, cachesSearched: 0, suppliesFound: 0, suppliesInstalled: 0, pingAvg: 50, killsByType: o.killsByType ?? {}, killsByWeapon: o.killsByWeapon ?? {},
  damageTakenBy: {}, shotsByWeapon: o.shotsByWeapon ?? {}, hitsByWeapon: {}, craftedItems: {}, builtTypes: {}, usedItems: {}, stats: { longestLifeS: o.life ?? 0 },
});
const match = (id, startedAt, o) => store.push({ k: 'match', id, startedAt, seed: 1, startDay: 1, seats: 8, protocol: 37, settings: { difficulty: o.mode } });
const end = (id, endedAt, o) =>
  store.push({ k: 'match_end', matchId: id, endedAt, outcome: o.outcome, lastDay: o.lastDay, lastPhase: 'night', nightsSurvived: o.nights, durationS: o.durationS, peakPlayers: o.peak, uniquePlayers: o.peak, playerSeconds: 0, suppliesInstalled: 0, suppliesNeeded: 7, engineStartedS: null, escaped: 0, kills: o.kills, deaths: 0, downs: 0, revives: 0, structuresBuilt: 0, structuresLost: o.lost ?? 0, summary: {} });

// match 1, 10 days ago: Ann (account) and Bob (guest), wiped on night 2
const m1 = randomUUID();
const t1 = now - 10 * 24 * H;
match(m1, t1, { mode: 'nightfall' });
store.push(stint(m1, { userId: ANN.id, name: 'Ann' }, t1, 1200, { kills: 30, deaths: 1, downs: 2, headshots: 5, shots: 100, nights: 1, revives: 1, distanceM: 1500, built: 4, life: 600, killsByType: { walker: 25, runner: 5 }, killsByWeapon: { ak47: 30 }, shotsByWeapon: { ak47: 100 } }));
store.push(stint(m1, { guestKey: BOB_KEY, name: 'Bob' }, t1 + 5000, 1100, { kills: 10, deaths: 1, nights: 1, distanceM: 900, life: 500, killsByType: { walker: 10 }, killsByWeapon: { pistol: 10 } }));
store.push({ k: 'night', matchId: m1, night: 1, startedAt: t1 + 400_000, endedAt: t1 + 580_000, durationS: 180, theme: null, boss: null, bossKilled: false, hordeSize: 40, hordeHpMul: 1, playersStart: 2, survivorsStart: 2, survivorsEnd: 2, kills: 25, structuresLost: 1, downs: 0, deaths: 0, revives: 0, outcome: 'dawn' });
store.push({ k: 'night', matchId: m1, night: 2, startedAt: t1 + 900_000, endedAt: t1 + 1_080_000, durationS: 180, theme: null, boss: 'boss_brute', bossKilled: false, hordeSize: 60, hordeHpMul: 1, playersStart: 2, survivorsStart: 2, survivorsEnd: 0, kills: 15, structuresLost: 3, downs: 2, deaths: 2, revives: 1, outcome: 'wipe' });
store.push({ k: 'event', matchId: m1, at: t1 + 1_000_000, t: 1000, day: 2, phase: 'night', type: 'death', userId: ANN.id, name: 'Ann', x: 0, z: 0, data: { cause: 'boss_brute' } });
store.push({ k: 'sample', matchId: m1, t: 30, at: t1 + 30_000, day: 1, phase: 'day', players: 2, survivors: 2, downed: 0, dead: 0, zombies: 10, tickMs: 0.5, tickP99: 1, pingAvg: 50 });
end(m1, t1 + 1200_000, { outcome: 'wipe', lastDay: 2, nights: 1, durationS: 1200, peak: 2, kills: 40, lost: 4 });

// match 2, 2 days ago: Ann alone, escaped on day 5 (Ann is back: the same player)
const m2 = randomUUID();
const t2 = now - 2 * 24 * H;
match(m2, t2, { mode: 'ember' });
store.push(stint(m2, { userId: ANN.id, name: 'Ann' }, t2, 2400, { kills: 50, headshots: 20, shots: 150, nights: 4, outcome: 'escaped', bossKills: 1, distanceM: 4000, life: 2400, killsByType: { walker: 30, runner: 15, boss_brute: 5 }, killsByWeapon: { ak47: 40, bat: 10 } }));
end(m2, t2 + 2400_000, { outcome: 'victory', lastDay: 5, nights: 4, durationS: 2400, peak: 1, kills: 50 });

// match 3, 1 hour ago: Cy (no id at all) walked out after 50 s
const m3 = randomUUID();
const t3 = now - H;
match(m3, t3, { mode: 'nightfall' });
store.push(stint(m3, { name: 'Cy' }, t3, 50, { kills: 1, leftReason: 'left', outcome: 'left', leftDay: 1, leftPhase: 'day' }));
end(m3, t3 + 60_000, { outcome: 'abandoned', lastDay: 1, nights: 0, durationS: 60, peak: 1, kills: 1 });
await store.flush();
await store.close();

{
  const v = await ps.publicView('all');
  const t = v.totals;
  check('totals: kills, players, accounts and guests add up over the stints', t.zombiesKilled === 91 && t.players === 3 && t.accounts === 1 && t.guests === 2, JSON.stringify(t));
  check('totals: matches, escapes, nights, deaths, headshots, shots, bosses', t.matches === 3 && t.victories === 1 && t.escaped === 1 && t.nightsSurvived === 6 && t.deaths === 2 && t.downs === 2 && t.headshots === 25 && t.shots === 250 && t.bossesKilled === 1);
  check('totals: hours, km, barricades built and lost, the biggest game', t.hours === Math.round(((1200 + 1100 + 2400 + 50) / 3600) * 10) / 10 && t.km === 6.4 && t.built === 4 && t.lost === 4 && t.peakInOneGame === 2);
  check('totals: the first match is when it all began', Math.abs(new Date(t.firstMatchAt).getTime() - t1) < 1000);
  check('live: what the lobby says is there now', v.live.players === 5 && v.live.games === 2 && v.live.list.length === 1);

  const daySum = (k) => v.daily.reduce((a, d) => a + d[k], 0);
  check('days: one row for every day from the first match to today', v.daily.length === 11 && v.daily.at(-1).day === new Date().toISOString().slice(0, 10), `${v.daily.length} rows`);
  check('days: kills, runs and new players add up to the totals', daySum('kills') === 91 && daySum('matches') === 3 && daySum('newPlayers') === 3 && daySum('victories') === 1);
  check('days: the busiest moment from the samples', v.daily[0].peak === 2);
  check('heatmap: one session begun per first stint, in the hour of the week it began', v.heatmap.reduce((a, b) => a + b, 0) === 4);

  const r = v.records;
  check('records: the longest run is the escape, 4 nights by Ann', r.longestRun?.value === 4 && r.longestRun.names === 'Ann' && r.longestRun.day === 5);
  check('records: most kills, headshots, revives in one run', r.mostKills?.value === 50 && r.mostKills.name === 'Ann' && r.mostHeadshots?.value === 20 && r.mostRevives?.value === 1);
  check('records: farthest walk, longest life, fastest escape, biggest game, bloodiest night, biggest horde', r.farthestWalk?.value === 4000 && r.longestLife?.value === 2400 && r.fastestEscape?.value === 2400 && r.biggestGame?.value === 2 && r.deadliestNight?.value === 25 && r.deadliestNight.night === 1 && r.biggestHorde?.value === 60);
  check('top survivors: Ann first with both runs together, Bob second, Cy third', v.topPlayers.map((p) => `${p.name}:${p.kills}:${p.matches}`).join() === 'Ann:80:2,Bob:10:1,Cy:1:1' && v.topPlayers[0].account && !v.topPlayers[1].account);
  check('breakdowns: zombie kinds and weapons named as the game names them', v.killsByType[0].key === 'walker' && v.killsByType[0].label === 'Walker' && v.killsByType[0].kills === 65 && v.weapons[0].key === 'ak47' && v.weapons[0].kills === 70 && v.weapons[0].label === label('ak47') && label('ak47') !== 'Ak47');
  check('breakdowns: outcomes, difficulty, death causes, bosses, the night funnel', v.outcomes.length === 3 && v.modes.find((m) => m.key === 'ember')?.label === 'Ember' && v.deathCauses[0].label === label('boss_brute') && label('boss_brute') !== 'Boss Brute' && v.bosses[0].nights === 1 && v.nights[0].reached === 1 && v.nights[0].survived === 1 && v.nights[1].wiped === 1, JSON.stringify(v.deathCauses));
  check('latest runs: newest first, no codes or names', v.recent.length === 3 && v.recent[0].outcome === 'abandoned' && !('code' in v.recent[0]));
  const json = JSON.stringify(v);
  check('nothing that says who someone is beyond their name: no account id, no guest key', !json.includes(ANN.id) && !json.includes(BOB_KEY) && !json.includes(m1));

  const w = await ps.publicView('7d');
  check('a range: running totals start from what came before it', w.base.kills === 40 && w.base.players === 2 && w.base.matches === 1 && w.daily.length === 8 && w.daily.reduce((a, d) => a + d.kills, 0) === 51);
  check('a range: the all-time totals stay all-time', w.totals.zombiesKilled === 91);
  check('a range that is not one is read as 30 days', (await ps.publicView('nonsense')).range === '30d');
  const again = await ps.publicView('all');
  check('an answer is kept for a while (the same numbers, not asked again)', again.generatedAt === v.generatedAt);

  const a = await ps.adminView('all');
  check('admin: actives today, this week, this month', a.actives.dau === 1 && a.actives.wau === 2 && a.actives.mau === 3 && a.actives.accounts === 1, JSON.stringify(a.actives));
  check('admin: of the first day\'s two new players Ann came back (8 days on: not within the week), Bob never', a.cohorts.length === 2 && a.cohorts[0].newPlayers === 2 && a.cohorts[0].d7 === 0 && a.cohorts[0].ever === 1, JSON.stringify(a.cohorts));
  check('admin: sessions by length, and their median', a.sessions.n === 4 && a.sessions.buckets[0].n === 1 && a.sessions.buckets[3].n === 2 && a.sessions.buckets[4].n === 1 && a.sessions.medianMinutes === 19.2, JSON.stringify(a.sessions));
  check('admin: Cy bounced (left his first run inside 2 minutes)', a.bounce.newPlayers === 3 && a.bounce.bounced === 1);
  check('admin: the deploy the runs were played on, by its short commit', a.builds.length === 1 && a.builds[0].build === 'abc1234' && a.builds[0].matches === 3 && a.builds[0].victoryPct === 50);
  check('admin: where players walk out: Cy on day 1, by day', a.quits.length === 1 && a.quits[0].day === 1 && a.quits[0].byDay === 1);
  check('admin: regulars by hours, guests marked', a.regulars[0].name === 'Ann' && a.regulars[0].account && a.regulars[0].days === 2 && !a.regulars[1].account);
}

// ---------------------------------------------------------------- 60 days of made-up history
{
  const big = await openDb('pglite:memory');
  await migrate(big);
  const seeded = await seedStats(big, { days: 60, seed: 11 });
  const ps2 = new PublicStats({ db: big });
  const sum = (await big.query('SELECT sum(kills) AS k, count(DISTINCT match_id) AS m FROM match_players')).rows[0];
  const v = await ps2.publicView('all');
  check('seeded: the totals agree with the tables', v.totals.zombiesKilled === sum.k && v.totals.matches === seeded.matches && v.totals.players === seeded.players, `${v.totals.zombiesKilled} kills, ${v.totals.matches} matches`);
  let ok = true;
  for (const r of ['7d', '30d', '90d']) {
    const x = await ps2.publicView(r);
    const runningEnd = x.base.kills + x.daily.reduce((a, d) => a + d.kills, 0);
    ok &&= runningEnd === v.totals.zombiesKilled && x.daily.length >= Math.min(60, +r.slice(0, -1));
    const a = await ps2.adminView(r);
    ok &&= a.cohorts.length > 0 && a.health.length > 0 && a.builds.length > 0;
  }
  check('seeded: every range answers, and its running totals end at the all-time total', ok);
  await big.close();
}

await db.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall passed');
process.exit(fails.length ? 1 : 0);
