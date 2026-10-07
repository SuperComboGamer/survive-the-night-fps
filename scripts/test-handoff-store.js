// Where a game waits between two servers on a deploy (server/handoff.js): the file store and the Postgres one (on
// PGlite, in this process, migrated: 008_game_handoff) do the same - a save put is heard, listed, claimed whole once
// and never twice, and swept when nobody came for it; builds are swept when unused, but never one a waiting save names;
// the next server can say it will not have a game's valley built, and the one going down stops waiting for it; the
// wait counts from the call. And the match records of a game carried over: the old half ends as 'handoff', the new
// half's row names it in `continues`.
import { mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { FileStore, PgStore, encode, decode } from '../server/handoff.js';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { MatchStore } from '../server/matchstore.js';

let failed = 0;
// (detail: what was seen, printed when the check fails - every check gives one)
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -- saw: ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

check('the codec keeps what JSON does not: Infinity, typed arrays as arrays', (() => {
  const o = decode(encode({ a: Infinity, b: -Infinity, c: new Float64Array([1.5, 2]), d: 'x', n: NaN }));
  return o.a === Infinity && o.b === -Infinity && Array.isArray(o.c) && o.c[0] === 1.5 && o.d === 'x' && o.n === null;
})());

async function exercise(label, store, db = null) {
  const heard = [];
  await store.listen((code) => heard.push(code)); // (listening once this is done: a save put from here on is heard)
  const body = encode({ hello: 'world', big: 'z'.repeat(5000) });
  const meta = { name: 'A game', inviteOnly: true, maxPlayers: 6, match: randomUUID() };
  await store.put('ABCDEFGHJK', meta, body);
  for (let i = 0; i < 100 && !heard.includes('ABCDEFGHJK'); i++) await sleep(50);
  check(`${label}: a save that is put is heard of`, heard.includes('ABCDEFGHJK'), JSON.stringify(heard));
  const waiting = await store.pending();
  check(`${label}: ...and is listed as waiting`, waiting.includes('ABCDEFGHJK'), JSON.stringify(waiting));
  const [one, two] = await Promise.all([store.claim('ABCDEFGHJK'), store.claim('ABCDEFGHJK')]);
  const got = one || two;
  check(`${label}: two servers claiming it at once: one gets it`, !!got && !(one && two), `${!!one} ${!!two}`);
  const sorted = (o) => JSON.stringify(Object.entries(o || {}).sort()); // (jsonb keeps no key order)
  check(`${label}: ...whole: the room and the game`, got && sorted(got.meta) === sorted(meta) && decode(got.body).hello === 'world' && Math.abs(Date.now() - got.savedAt) < 10000, JSON.stringify(got?.meta));
  const after = await store.pending();
  const third = await store.claim('ABCDEFGHJK');
  check(`${label}: ...and it is gone from the store`, !after.includes('ABCDEFGHJK') && third === null, JSON.stringify({ after, third: !!third }));
  await store.put('ZZZZZZ', meta, body);
  await store.put('ZZZZZZ', { ...meta, name: 'Saved again' }, body);
  const again = await store.claim('ZZZZZZ');
  check(`${label}: saving a game again replaces its save`, again?.meta.name === 'Saved again', JSON.stringify(again?.meta));
  await store.put('YYYYYY', meta, body);
  await sleep(1100);
  const sweptSaves = await store.sweep(1);
  const left = await store.pending();
  check(`${label}: one nobody came for is swept`, sweptSaves >= 1 && !left.includes('YYYYYY'), JSON.stringify({ sweptSaves, left }));

  // the builds games are carried on by (builds.js), and their clients' files
  const A = 'a'.repeat(24);
  const B = 'b'.repeat(24);
  const file = (s) => [sha(s), Buffer.from(s)];
  await store.putBuild(A, Buffer.from('build one'), 'sig-of-one', new Map([file('only in one'), file('in both')]));
  await store.putBuild(B, Buffer.from('build two'), '', new Map([file('in both')]));
  const first = await store.getBuild(A);
  const none = await store.getBuild('c'.repeat(24));
  check(`${label}: a build is kept with its signature, and given back`, first?.body.toString() === 'build one' && first.sig === 'sig-of-one' && none === null, JSON.stringify({ first: first?.body.toString(), sig: first?.sig, none }));
  const both = await store.getAsset(sha('in both'));
  const nope = await store.getAsset(sha('nope'));
  check(`${label}: ...and its client's files, by their hashes`, both?.toString() === 'in both' && nope === null, JSON.stringify({ both: both?.toString(), nope }));
  if (db) {
    // (a file put there by anyone else is written over by a server that puts its own build: it knows what is right)
    await db.query(`UPDATE handoff_asset SET body = 'tampered' WHERE hash = $1`, [sha('in both')]);
    await store.putBuild(B, Buffer.from('build two'), '', new Map([file('in both')]));
    check(`${label}: ...a file somebody else changed is put right by the next server that keeps it`, (await store.getAsset(sha('in both')))?.toString() === 'in both');
  }
  await sleep(1100);
  const touched = await store.touchBuild(A);
  const swept = await store.sweepBuilds(1);
  check(`${label}: a build nobody used is swept, one in use is not, nor the files it names`, touched === true && swept === 1 && (await store.getBuild(B)) === null && !!(await store.getBuild(A)) && !!(await store.getAsset(sha('in both'))) && !!(await store.getAsset(sha('only in one'))), JSON.stringify({ touched, swept }));
  check(`${label}: ...and marking one that is not there says so`, (await store.touchBuild(B)) === false);
  const savesSwept = await store.sweep(0);
  check(`${label}: ...and sweeping the saves leaves the builds be`, savesSwept >= 0 && !!(await store.getBuild(A)), String(savesSwept));
  // a build a save waiting in the store names is never swept, however long since anybody used it (a server that ran for
  // days without a deploy: its games' saves name it)
  const C = 'c'.repeat(24);
  await store.putBuild(C, Buffer.from('build three'), '', new Map([file('only in three')]));
  await store.put('NAMESC', { ...meta, build: C }, body);
  if (db) await db.query(`UPDATE handoff_build SET used_at = now() - interval '10 days' WHERE id = $1`, [C]);
  else {
    const old = new Date(Date.now() - 10 * 86400e3);
    utimesSync(join(`${store.dir}-builds`, `${C}.json`), old, old);
  }
  const keptNamed = await store.sweepBuilds(3600);
  check(`${label}: a build unused for days that a waiting save names is not swept`, keptNamed === 0 && !!(await store.getBuild(C)), String(keptNamed));
  await store.claim('NAMESC');
  if (db) await db.query(`UPDATE handoff_build SET used_at = now() - interval '10 days' WHERE id = $1`, [C]);
  else {
    const old = new Date(Date.now() - 10 * 86400e3);
    utimesSync(join(`${store.dir}-builds`, `${C}.json`), old, old);
  }
  const sweptC = await store.sweepBuilds(3600);
  check(`${label}: ...and is swept once no save names it`, sweptC === 1 && (await store.getBuild(C)) === null, String(sweptC));

  // the word between the servers before the saves (rooms.js announce / prepare)
  const coming = [];
  await store.listenComing((code, info) => {
    coming.push([code, info.seed]);
    if (code === 'COMENO') store.ready(code, false); // (another valley of that seed here: it says it will not)
    else if (code !== 'COMEZZ') store.ready(code);
  });
  const WAIT = 1500;
  let t0 = Date.now();
  const ready = await store.announceAndWait(
    [
      { code: 'COMEAA', info: { seed: 5, act: 1, shape: 'x' } },
      { code: 'COMEZZ', info: { seed: 6, act: 1, shape: 'y' } },
    ],
    WAIT
  );
  const took = Date.now() - t0;
  // (COMEZZ is never answered: the wait runs its course, and only that - a slow machine is given a second on top)
  check(`${label}: a server going down tells the next which games are coming, and hears which it is ready for`, coming.some(([c, s]) => c === 'COMEAA' && s === 5) && coming.some(([c]) => c === 'COMEZZ') && ready.has('COMEAA') && !ready.has('COMEZZ') && took >= WAIT - 50 && took < WAIT + 1000, JSON.stringify({ coming, ready: [...ready], took }));
  t0 = Date.now();
  const declined = await store.announceAndWait(
    [
      { code: 'COMEBB', info: { seed: 7, act: 1, shape: 'x' } },
      { code: 'COMENO', info: { seed: 8, act: 1, shape: 'z' } },
    ],
    3000
  );
  const tookNo = Date.now() - t0;
  check(`${label}: ...one the next server says it will not have built is not waited for: the wait ends once both are answered`, declined.has('COMEBB') && !declined.has('COMENO') && tookNo < 1500, JSON.stringify({ ready: [...declined], took: tookNo }));
  await store.close();
}
const sha = (s) => createHash('sha256').update(s).digest('hex');

var db = null;
await exercise('files', new FileStore(join(mkdtempSync(join(tmpdir(), 'stn-store-')), 'handoff'), { pollMs: 200 }));

db = await openDb('pglite:memory');
const { applied } = await migrate(db);
check('008_game_handoff and 014_handoff_builds apply', applied.includes('008_game_handoff.sql') && applied.includes('014_handoff_builds.sql'), applied.join());
await exercise('postgres', new PgStore(db), db);

// the wait counts from the call: a database slow to start listening does not stretch it (nor hang it)
{
  const slow = { query: async () => ({ rows: [] }), listen: () => new Promise((done) => setTimeout(() => done(async () => {}), 2500)) };
  const t0 = Date.now();
  const got = await new PgStore(slow).announceAndWait([{ code: 'SLOWDB', info: { seed: 1, act: 1 } }], 300);
  const took = Date.now() - t0;
  check('postgres: a database that takes 2.5 s to listen does not make a 300 ms wait longer', took < 1000 && got.size === 0, String(took));
}

// the two halves of a match a deploy split
const matches = new MatchStore({ db });
const old = randomUUID();
const now = randomUUID();
const room = { code: 'ABCDEF', quick: false, inviteOnly: false, continues: null, match: null };
matches.push({ k: 'match', id: old, startedAt: Date.now() - 60000, seed: 1, startDay: 1, seats: 8, protocol: 1, settings: {} }, room);
matches.push({ k: 'match_end', matchId: old, endedAt: Date.now(), outcome: 'handoff', lastDay: 2, summary: {} }, room);
const moved = { ...room, continues: old };
matches.push({ k: 'match', id: now, startedAt: Date.now(), seed: 1, startDay: 2, seats: 8, protocol: 1, settings: {} }, moved);
matches.push({ k: 'match', id: randomUUID(), startedAt: Date.now(), seed: 2, startDay: 1, seats: 8, protocol: 1, settings: {} }, moved);
await matches.flush();
const rows = (await db.query('SELECT id, outcome, continues FROM matches ORDER BY started_at')).rows;
check("the old server's half ends as 'handoff'", rows.find((r) => r.id === old)?.outcome === 'handoff', JSON.stringify(rows));
check("...and the new server's first match carries it on (continues)", rows.find((r) => r.id === now)?.continues === old, JSON.stringify(rows));
check('...only the first: the next run in that game is a match of its own', rows.filter((r) => r.continues).length === 1, JSON.stringify(rows));
await matches.close();
await db.close();

// ...and on a real Postgres, when there is one this test may use (STORE_TEST_DATABASE_URL, on this machine: its
// handoff tables are emptied). PGlite is Postgres compiled to WebAssembly, but the server runs on the real thing.
const REAL = process.env.STORE_TEST_DATABASE_URL;
if (REAL && /^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(REAL)) {
  const pg = await openDb(REAL);
  await migrate(pg);
  await pg.query('DELETE FROM game_handoff');
  await pg.query('DELETE FROM handoff_build');
  await pg.query('DELETE FROM handoff_asset');
  await exercise('real postgres', new PgStore(pg), pg);
  await pg.close();
} else console.log('note  STORE_TEST_DATABASE_URL not set (a Postgres on this machine): the store was run on PGlite only');

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
