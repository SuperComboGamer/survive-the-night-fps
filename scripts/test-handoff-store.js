// Where a game waits between two servers on a deploy (server/handoff.js): the file store and the Postgres one (on
// PGlite, in this process, migrated: 008_game_handoff) do the same - a save put is heard, listed, claimed whole once
// and never twice, and swept when nobody came for it. And the match records of a game carried over: the old half
// ends as 'handoff', the new half's row names it in `continues`.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

async function exercise(label, store) {
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
  await store.close();
}

await exercise('files', new FileStore(join(mkdtempSync(join(tmpdir(), 'stn-store-')), 'handoff'), { pollMs: 200 }));

const db = await openDb('pglite:memory');
const { applied } = await migrate(db);
check('008_game_handoff applies', applied.includes('008_game_handoff.sql'), applied.join());
await exercise('postgres', new PgStore(db));

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

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
