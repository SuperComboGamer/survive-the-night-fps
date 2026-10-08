// A player's own survivors (the character creator) kept on their account as well as in the browser (shared/customs.js,
// client/ui/customs.js, client/net/accountcustoms.js, server/usersettings.js). In-process: a copy tidied (an old one
// without times, junk left out, a removed part repaired), two copies merged survivor by survivor (both browsers' new
// ones kept, the copy changed last wins, a deletion stays unless changed after, no more than are kept), the server's
// strict check, and the browser's store (an old copy read and rewritten, saving and deleting with their times, a merged
// copy taken). Against a real server process on a PGlite database of its own: a guest is told to sign in, a signed-in
// player's survivors are kept and come back in their other browser, two browsers' survivors merged, a deletion
// carried, junk refused; and a server without a database answering without accounts.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CUSTOMS_MAX, CUSTOMS_KEPT, tidyCustoms, mergeCustoms, checkCustoms, sameCustoms } from '../shared/customs.js';
import { randomLook, mulberry, defaults } from '../shared/appearance.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const look = (n) => randomLook(mulberry(n));
const S = (id, n, made, updatedAt, name = id) => ({ id, name, fields: look(n), made, updatedAt });
const ids = (c) => c.list.map((it) => it.id).join();
const sorted = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const eq = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b)); // (jsonb keeps an object's keys in an order of its own)

// ---------------------------------------------------------------- a copy, tidied
{
  const old = { v: 1, list: [{ id: 'aaa', name: 'Ash', fields: look(1) }, { id: 'bbb', name: 'B<o>b!', fields: { ...look(2), hat: 'stetson' } }, { id: 'BAD id', name: 'x' }, { id: 'aaa', name: 'twice' }, 'junk'] };
  const t = tidyCustoms(old);
  check('an old copy (no times) is tidied: made in the order listed, changed long ago', t.v === 2 && ids(t) === 'aaa,bbb' && t.list[0].made < t.list[1].made && t.list.every((it) => it.updatedAt === 1), JSON.stringify(t.list.map((it) => [it.id, it.made, it.updatedAt])));
  check('...junk, a bad id and a second copy of an id left out; a name cleaned', t.list.length === 2 && t.list[1].name === 'Bob');
  check('...and a part no longer in the game replaced by its default', t.list[1].fields.hat === defaults().hat);
  check('anything at all is an empty copy', ['', null, 7, [], { list: 'no' }].every((x) => tidyCustoms(x).list.length === 0));
}

// ---------------------------------------------------------------- two copies, merged
{
  const pc = { v: 2, list: [S('ash', 1, 100, 1000), S('cole', 3, 300, 3000)], gone: [] };
  const laptop = { v: 2, list: [S('ash', 1, 100, 900), S('dot', 4, 400, 4000)], gone: [] };
  const m = mergeCustoms(pc, laptop);
  check("both browsers' new survivors live on (a whole-copy 'newer wins' would lose one)", ids(m) === 'ash,cole,dot', ids(m));
  const edited = { v: 2, list: [{ ...S('ash', 9, 100, 5000), name: 'Ashley' }], gone: [] };
  check('of one survivor, the copy changed last wins', mergeCustoms(pc, edited).list.find((it) => it.id === 'ash').name === 'Ashley' && mergeCustoms(edited, pc).list.find((it) => it.id === 'ash').name === 'Ashley');
  const deleted = { v: 2, list: [S('ash', 1, 100, 1000)], gone: [{ id: 'cole', at: 3500 }] };
  check('one deleted in one browser stays deleted when merged with one that still has it', ids(mergeCustoms(pc, deleted)) === 'ash' && ids(mergeCustoms(deleted, pc)) === 'ash');
  const changedAfter = { v: 2, list: [S('cole', 5, 300, 3600)], gone: [] };
  check('...unless it was changed after it was deleted', ids(mergeCustoms(deleted, changedAfter)).includes('cole'));
  check('...and the deletion is remembered in the merged copy', mergeCustoms(pc, deleted).gone.some((g) => g.id === 'cole' && g.at === 3500));
  const many = { v: 2, list: Array.from({ length: CUSTOMS_KEPT }, (_, i) => S('m' + i, i, i + 1, 100 + i)), gone: [] };
  const more = { v: 2, list: [S('new1', 50, 999, 9999), S('new2', 51, 1000, 9998)], gone: [] };
  const capped = mergeCustoms(many, more);
  check(`no more than ${CUSTOMS_KEPT} are kept: the ones changed longest ago go`, capped.list.length === CUSTOMS_KEPT && ids(capped).includes('new1') && !ids(capped).includes('m0') && !ids(capped).includes('m1'), ids(capped));
  check('merging is the same either way round, and merging again changes nothing', sameCustoms(mergeCustoms(pc, laptop), mergeCustoms(laptop, pc)) && sameCustoms(mergeCustoms(m, laptop), m));
  check('a clock a year ahead is held to a day ahead', tidyCustoms({ list: [S('far', 1, 1, Date.now() + 365 * 86400_000)] }).list[0].updatedAt <= Date.now() + 86400_000 + 5000);
}

// ---------------------------------------------------------------- the server's check
{
  const good = { v: 2, list: [S('ash', 1, 100, 1000)], gone: [{ id: 'old', at: 5 }] };
  check('a good copy passes, tidied', checkCustoms(good).ok && checkCustoms(good).customs.list.length === 1);
  const bad = [null, 'all of them', [], { list: 'no' }, { list: Array.from({ length: CUSTOMS_KEPT + 1 }, (_, i) => S('x' + i, i, 1, 1)) }, { list: [{ name: 'no id' }] }, { list: [S('a', 1, 1, 1), S('a', 2, 1, 1)] }, { list: [{ id: 'a', fields: [1, 2] }] }, { list: [], gone: 'nope' }];
  const why = bad.map((b) => checkCustoms(b));
  check('junk is refused: not an object, not a list, too many, no id, an id twice, fields not a look, gone not a list', why.every((r) => !r.ok && r.error), JSON.stringify(why));
}

// ---------------------------------------------------------------- the browser's store
{
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  mem.set('stn.customs', JSON.stringify({ v: 1, list: [{ id: 'aaa', name: 'Ash', fields: look(1) }] }));
  const C = await import('../client/ui/customs.js');
  const heard = [];
  C.onCustomsChange((why) => heard.push(why));
  check('an old copy in the browser is read, and kept again in the new form', C.customs().length === 1 && JSON.parse(mem.get('stn.customs')).v === 2);
  const t0 = Date.now();
  const id = C.saveCustom({ name: 'Birdie', values: look(2) });
  const b = C.getCustom(id);
  check('a new one has when it was made and changed, and says so (edit)', b && b.made >= t0 && b.updatedAt >= t0 && heard.at(-1) === 'edit');
  C.saveCustom({ id: 'aaa', name: 'Ash two', values: look(3) });
  check('...a change keeps when it was made', C.getCustom('aaa').made === 1 && C.getCustom('aaa').updatedAt >= t0);
  C.deleteCustom(id);
  const ex = C.exportCustoms();
  check('a deletion is remembered in what goes to the account', ex.list.length === 1 && ex.gone.some((g) => g.id === id));
  for (let i = 0; i < CUSTOMS_MAX - 1; i++) C.saveCustom({ name: 'n' + i, values: look(10 + i) });
  check(`no more than ${CUSTOMS_MAX} are made here`, C.saveCustom({ name: 'one more', values: look(30) }) === null);
  C.adoptCustoms(mergeCustoms(C.exportCustoms(), { v: 2, list: [S('zzz', 40, 1, Date.now())], gone: [] }));
  check('a copy merged with the account is taken, and says so (sync) - up to the kept, past the made', C.getCustom('zzz') && C.customs().length === CUSTOMS_MAX + 1 && heard.at(-1) === 'sync');
  check('...and it is what this browser keeps', C.reloadCustoms().some((c) => c.id === 'zzz'));
}

// ---------------------------------------------------------------- a real server
const dir = mkdtempSync(join(tmpdir(), 'stn-customs-'));
const procs = [];
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
async function stop(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const gone = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGTERM');
  const t = setTimeout(() => proc.kill('SIGKILL'), 8000);
  await gone;
  clearTimeout(t);
}
async function startServer(env) {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), STATS_FILE: '', GAME_IDLE_SECONDS: '2', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc);
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 300 && !log.includes('listening'); i++) await sleep(50);
  if (!log.includes('listening')) throw new Error(`server did not start:\n${log}`);
  return { port, proc, base: `http://localhost:${port}` };
}
const browser = (base) => {
  const b = { cookie: '' };
  b.req = async (method, path, body, raw) => {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(15000), method, headers: { ...(body !== undefined || raw ? { 'Content-Type': 'application/json' } : {}), ...(b.cookie ? { cookie: b.cookie } : {}) }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    for (const c of res.headers.getSetCookie?.() || []) {
      const m = /^stn_session=([^;]*)/.exec(c);
      if (m) b.cookie = m[1] ? `stn_session=${m[1]}` : '';
    }
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return b;
};

try {
  const { base } = await startServer({ DATABASE_URL: `pglite:${join(dir, 'db')}` });
  const guest = browser(base);
  const g1 = await guest.req('GET', '/api/me/customs');
  const g2 = await guest.req('PUT', '/api/me/customs', { customs: { v: 2, list: [], gone: [] } });
  check('a guest is told to sign in (401), for reading and for saving', g1.status === 401 && g2.status === 401, JSON.stringify([g1.status, g2.status]));

  const home = browser(base);
  const reg = await home.req('POST', '/api/auth/register', { email: 'cc@example.com', username: 'Maker', password: 'maker-password' });
  check('signed up', reg.status === 201 && home.cookie, JSON.stringify(reg));
  const none = await home.req('GET', '/api/me/customs');
  check('a new account keeps no survivors yet', none.status === 200 && none.body.customs === null, JSON.stringify(none));

  const t = Date.now();
  const mine = { v: 2, list: [S('ash', 1, t, t, 'Ash'), S('cole', 3, t + 1, t + 1, 'Cole')], gone: [] };
  const put = await home.req('PUT', '/api/me/customs', { customs: mine });
  check('PUT keeps them, and answers with what is kept', put.status === 200 && ids(put.body.customs) === 'ash,cole' && put.body.customs.list[0].name === 'Ash', JSON.stringify(put.body)?.slice(0, 200));
  const got = await home.req('GET', '/api/me/customs');
  check('GET gives them back, looks and times and all', sameCustoms(got.body.customs, mine) && eq(got.body.customs.list[1].fields, tidyCustoms(mine).list[1].fields));

  const work = browser(base);
  await work.req('POST', '/api/auth/login', { login: 'Maker', password: 'maker-password' });
  const there = await work.req('GET', '/api/me/customs');
  check('signed in in another browser: the survivors are there', sameCustoms(there.body.customs, mine));

  // the work browser makes one of its own, not having heard of the others (a copy of its own, before it signed in)
  const workOwn = { v: 2, list: [S('dot', 4, t + 5, t + 5, 'Dot')], gone: [] };
  const merged = await work.req('PUT', '/api/me/customs', { customs: workOwn });
  check("a browser's own survivor is merged in, and nobody else's is lost", ids(merged.body.customs) === 'ash,cole,dot', ids(merged.body.customs));
  // the home browser deletes Cole
  const del = await home.req('PUT', '/api/me/customs', { customs: { v: 2, list: [mine.list[0]], gone: [{ id: 'cole', at: t + 10 }] } });
  check('a deletion goes up and is kept', ids(del.body.customs) === 'ash,dot' && del.body.customs.gone.some((g) => g.id === 'cole'), ids(del.body.customs));
  // the work browser, behind, saves its old copy of Cole
  const stale = await work.req('PUT', '/api/me/customs', { customs: { v: 2, list: [mine.list[1]], gone: [] } });
  check("...and a browser that still had it doesn't bring it back", !ids(stale.body.customs).includes('cole'), ids(stale.body.customs));

  const junk = await Promise.all([
    home.req('PUT', '/api/me/customs', { customs: 'all of them' }),
    home.req('PUT', '/api/me/customs', { customs: { list: [{ name: 'no id' }] } }),
    home.req('PUT', '/api/me/customs', { customs: { list: Array.from({ length: CUSTOMS_KEPT + 1 }, (_, i) => S('x' + i, i, 1, 1)) } }),
    home.req('PUT', '/api/me/customs', {}),
    home.req('PUT', '/api/me/customs', undefined, JSON.stringify({ customs: { v: 2, list: [{ id: 'big', name: 'x'.repeat(40000) }] } })),
  ]);
  check('junk is refused: not a list, no id, too many, nothing (400) and too big (413)', junk.slice(0, 4).every((r) => r.status === 400 && r.body?.error) && junk[4].status === 413, JSON.stringify(junk.map((r) => r.status)));
  check('...and what was kept is untouched', ids((await home.req('GET', '/api/me/customs')).body.customs) === 'ash,dot');

  let refused = 0;
  for (let i = 0; i < 40; i++) if ((await home.req('PUT', '/api/me/customs', { customs: { v: 2, list: [], gone: [] } })).status === 429) refused++;
  check('saving many times in a row is held back (429) after a burst', refused > 0 && refused < 40, String(refused));

  await home.req('POST', '/api/auth/logout', {});
  check('signed out: a guest again', (await home.req('GET', '/api/me/customs')).status === 401);
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

try {
  const { base } = await startServer({ DATABASE_URL: '' });
  const get = await fetch(base + '/api/me/customs').then(async (r) => ({ status: r.status, body: await r.json() }));
  const put = await fetch(base + '/api/me/customs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customs: { v: 2, list: [], gone: [] } }) });
  check('without a database: GET says there are no accounts (the browser keeps its own), PUT is a 503', get.status === 200 && get.body.accounts === false && get.body.customs === null && put.status === 503, JSON.stringify([get, put.status]));
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

await Promise.all(procs.map(stop));
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
