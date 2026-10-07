// Where a game waits between two servers on a deploy (server/handoff.js): the file store and the Postgres one (on
// PGlite, in this process, migrated: 008_game_handoff) do the same - a save put is heard, listed, claimed whole once
// and never twice, and swept when nobody came for it. And the match records of a game carried over: the old half
// ends as 'handoff', the new half's row names it in `continues`.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { FileStore, PgStore, encode, decode } from '../server/handoff.js';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { MatchStore } from '../server/matchstore.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

check('the codec keeps what JSON does not: Infinity, typed arrays as arrays', (() => {
  const o = decode(encode({ a: Infinity, b: -Infinity, c: new Float64Array([1.5, 2]), d: 'x', n: NaN }));
  return o.a === Infinity && o.b === -Infinity && Array.isArray(o.c) && o.c[0] === 1.5 && o.d === 'x' && o.n === null;
})());

async function exercise(label, store, db = null) {
  const heard = [];
  store.listen((code) => heard.push(code));
  await sleep(100);
  const body = encode({ hello: 'world', big: 'z'.repeat(5000) });
  const meta = { name: 'A game', inviteOnly: true, maxPlayers: 6, match: randomUUID() };
  await store.put('ABCDEFGHJK', meta, body);
  await sleep(label === 'files' ? 700 : 200);
  check(`${label}: a save that is put is heard of`, heard.includes('ABCDEFGHJK'), JSON.stringify(heard));
  check(`${label}: ...and is listed as waiting`, (await store.pending()).includes('ABCDEFGHJK'));
  const [one, two] = await Promise.all([store.claim('ABCDEFGHJK'), store.claim('ABCDEFGHJK')]);
  const got = one || two;
  check(`${label}: two servers claiming it at once: one gets it`, !!got && !(one && two), `${!!one} ${!!two}`);
  const sorted = (o) => JSON.stringify(Object.entries(o || {}).sort()); // (jsonb keeps no key order)
  check(`${label}: ...whole: the room and the game`, got && sorted(got.meta) === sorted(meta) && decode(got.body).hello === 'world' && Math.abs(Date.now() - got.savedAt) < 10000, JSON.stringify(got?.meta));
  check(`${label}: ...and it is gone from the store`, !(await store.pending()).includes('ABCDEFGHJK') && (await store.claim('ABCDEFGHJK')) === null);
  await store.put('ZZZZZZ', meta, body);
  await store.put('ZZZZZZ', { ...meta, name: 'Saved again' }, body);
  check(`${label}: saving a game again replaces its save`, (await store.claim('ZZZZZZ'))?.meta.name === 'Saved again');
  await store.put('YYYYYY', meta, body);
  await sleep(1100);
  check(`${label}: one nobody came for is swept`, (await store.sweep(1)) >= 1 && !(await store.pending()).includes('YYYYYY'));

  // the builds games are carried on by (builds.js), and their clients' files
  const A = 'a'.repeat(24);
  const B = 'b'.repeat(24);
  const file = (s) => [sha(s), Buffer.from(s)];
  await store.putBuild(A, Buffer.from('build one'), 'sig-of-one', new Map([file('only in one'), file('in both')]));
  await store.putBuild(B, Buffer.from('build two'), '', new Map([file('in both')]));
  const first = await store.getBuild(A);
  check(`${label}: a build is kept with its signature, and given back`, first?.body.toString() === 'build one' && first.sig === 'sig-of-one' && (await store.getBuild('c'.repeat(24))) === null);
  check(`${label}: ...and its client's files, by their hashes`, (await store.getAsset(sha('in both')))?.toString() === 'in both' && (await store.getAsset(sha('nope'))) === null);
  if (db) {
    // (a file put there by anyone else is written over by a server that puts its own build: it knows what is right)
    await db.query(`UPDATE handoff_asset SET body = 'tampered' WHERE hash = $1`, [sha('in both')]);
    await store.putBuild(B, Buffer.from('build two'), '', new Map([file('in both')]));
    check(`${label}: ...a file somebody else changed is put right by the next server that keeps it`, (await store.getAsset(sha('in both')))?.toString() === 'in both');
  }
  await sleep(1100);
  await store.touchBuild(A);
  const swept = await store.sweepBuilds(1);
  check(`${label}: a build nobody used is swept, one in use is not, nor the files it names`, swept === 1 && (await store.getBuild(B)) === null && !!(await store.getBuild(A)) && !!(await store.getAsset(sha('in both'))) && !!(await store.getAsset(sha('only in one'))), String(swept));
  check(`${label}: ...and sweeping the saves leaves the builds be`, (await store.sweep(0)) >= 0 && !!(await store.getBuild(A)));

  // the word between the servers before the saves (rooms.js announce / prepare)
  const coming = [];
  store.listenComing((code, info) => {
    coming.push([code, info.seed]);
    if (code !== 'COMEZZ') store.ready(code);
  });
  await sleep(300);
  const t0 = Date.now();
  const ready = await store.announceAndWait(
    [
      { code: 'COMEAA', info: { seed: 5, act: 1, shape: 'x' } },
      { code: 'COMEZZ', info: { seed: 6, act: 1, shape: 'y' } },
    ],
    1500
  );
  check(`${label}: a server going down tells the next which games are coming, and hears which it is ready for`, coming.some(([c, s]) => c === 'COMEAA' && s === 5) && coming.some(([c]) => c === 'COMEZZ') && ready.has('COMEAA') && !ready.has('COMEZZ') && Date.now() - t0 < 3000, JSON.stringify({ coming, ready: [...ready] }));
  await store.close();
}
const sha = (s) => createHash('sha256').update(s).digest('hex');

var db = null;
await exercise('files', new FileStore(join(mkdtempSync(join(tmpdir(), 'stn-store-')), 'handoff'), { pollMs: 200 }));

db = await openDb('pglite:memory');
const { applied } = await migrate(db);
check('008_game_handoff and 014_handoff_builds apply', applied.includes('008_game_handoff.sql') && applied.includes('014_handoff_builds.sql'), applied.join());
await exercise('postgres', new PgStore(db), db);

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
