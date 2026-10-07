// A game the new build cannot carry on is carried on by the build that saved it (server/builds.js, rooms.js
// Lobby.afterFailed / Room pin, index.js serving that build's page and files). docs/deploys.md.
//
// Builds before this one are made here: copies of this tree's server/ and shared/, each changed in one way a save
// cannot survive - another map of the same seed (the stalled train's toolbox a metre off), another state version, an
// enum entry this build does not have - each with a client of its own in dist/. A game is played on each, saved by its
// own code, and put in the store with the build that saved it, as a server going down for a deploy does. Then:
//   - the builds themselves: named by their contents; signed with the deploy's key and refused without it, or with
//     another; refused when from before a security fix (SECURITY_EPOCH), of another worker API, or using packages of
//     other versions than this server's; the copy unpacked on disk is checked every time it is used, and written
//     again when anything in it changed; the store keeps a client's files once however many builds have them
//   - a real server of this tree, which can read none of those saves, starts each game's worker from the build that
//     saved it: its players are back in their own bodies; the page for the game's code is that build's client (and says
//     so), /api/version for that game is that build's (so its pages go back in without a reload), its files are served
//     by their names; those games are not in the lobby's list or quick joins
//   - a save that names no build, a build not in the store, or one not signed with this deploy's key: the game ends
//     as before, its players told why
//   - a game kept on an older build closes when its run is over, or at the first dawn after HANDOFF_PIN_MAX_HOURS
//   - (Linux and Windows) the next deploy hands such a game on with the same build named, and the one after carries it on
//     the same way; a server told to stop while it is bringing one back puts the save back
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, existsSync, symlinkSync, statSync, chmodSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { gzipSync, gunzipSync } from 'node:zlib';
import { FileStore, worldPrint } from '../server/handoff.js';
import { packBuild, openBuild, signOf, buildId, buildHash, protocolOf, removeTree, Builds, WORKER_API, SECURITY_EPOCH } from '../server/builds.js';
import { Room, Lobby, rejectBytes } from '../server/rooms.js';
import { worldFor } from '../shared/worlds.js';
import { PROTOCOL_VERSION, ENDED_CODE, REJECT_REASON, S2C, C2S, Writer } from '../shared/protocol.js';
import { PHASE } from '../shared/constants.js';
import { Connection } from '../client/net/connection.js';
import { comeBack } from '../client/net/comeback.js';
import { verdictFor, pageBuild } from '../client/net/moveback.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (await fn()) return true;
  return false;
};
const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SEED = 1373936255;
const KEY = 'the-deploy-key-for-this-test';
const dir = mkdtempSync(pathJoin(tmpdir(), 'stn-handoff-pin-'));

// ---------------------------------------------------------------- builds before this one
function oldBuild(name, edits) {
  const root = pathJoin(dir, name);
  for (const d of ['server', 'shared']) cpSync(pathJoin(REPO, d), pathJoin(root, d), { recursive: true });
  writeFileSync(pathJoin(root, 'package.json'), '{ "type": "module" }\n');
  for (const [file, from, to] of edits) {
    const src = readFileSync(pathJoin(root, file), 'utf8').replace(/\r\n/g, '\n'); // (as checked out on Windows: CRLF)
    if (!src.includes(from)) throw new Error(`${file} no longer has "${from}": pick another line for the test to change`);
    writeFileSync(pathJoin(root, file), src.replace(from, to));
  }
  const dist = new Map([
    ['/index.html', { body: Buffer.from(`<!doctype html><html><head><title>${name}</title></head><body><script type="module" src="/assets/index-${name}.js"></script></body></html>`) }],
    [`/assets/index-${name}.js`, { body: Buffer.from(`console.log('the client of ${name}');`) }],
    ['/assets/shared-sound.ogg', { body: Buffer.from('the same sound in every build') }],
  ]);
  return { root, dist, client: { build: `client-${name}`, compat: `compat-${name}`, protocol: PROTOCOL_VERSION } };
}
const imp = (root, path) => import(pathToFileURL(pathJoin(root, path)).href);
// a game of two on day 1, played and saved by the build in `root`: { body, ids, shape, version }
async function savedBy(root, pids) {
  const { Game } = await imp(root, 'server/game.js');
  const { envelope, encode } = await imp(root, 'server/handoff.js');
  const { C2S, S2C, Writer, Reader } = await imp(root, 'shared/protocol.js');
  const g = new Game({ seed: SEED, dayLength: 3600, log: () => {} });
  const ids = [];
  for (const [i, pid] of pids.entries()) {
    const s = g.onOpen({
      send(bytes) {
        const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
        if (r.u8() === S2C.WELCOME) ids[i] = r.u16();
      },
    });
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(['Ann', 'Ben'][i]);
    w.str(pid);
    g.onMessage(s, w.bytes());
  }
  for (let i = 0; i < 40; i++) g.update();
  const env = envelope(g);
  return { body: encode(env), ids, shape: env.worldShape, version: env.stateVersion };
}

const oldmap = oldBuild('oldmap', [['shared/rail.js', 'C(b, CONT.TOOLBOX, ds * 0.7, 5.2,', 'C(b, CONT.TOOLBOX, ds * 0.7, 4.2,']]);
const oldver = oldBuild('oldver', [['server/handoff.js', 'process.env.HANDOFF_STATE_VERSION || 1', 'process.env.HANDOFF_STATE_VERSION || 7']]);
const oldenum = oldBuild('oldenum', [['shared/defs.js', '  NONE: 0,\n  // resources\n', '  NONE: 0,\n  OLD_TEST_ITEM: 990, // (an item this build no longer has)\n  // resources\n']]);
const pids = [randomUUID(), randomUUID()];
const onMap = await savedBy(oldmap.root, pids);
const onVer = await savedBy(oldver.root, pids);
const onEnum = await savedBy(oldenum.root, pids);
check('the first build before this one makes another map of the seed', onMap.shape !== worldPrint(worldFor(SEED, 1)).shape, onMap.shape);
check('the second writes saves of another state version', onVer.version === 7, String(onVer.version));
check('the third has an item this build does not', !!onEnum.body);

// ---------------------------------------------------------------- the builds themselves
const pack = (b, key = KEY) => packBuild(b.root, { client: b.client, dist: b.dist, key });
const mapBuild = pack(oldmap);
const verBuild = pack(oldver);
const enumBuild = pack(oldenum);
check('a build is named by its contents: the same tree, the same name; another, another', pack(oldmap).id === mapBuild.id && mapBuild.id !== verBuild.id && /^[0-9a-f]{24}$/.test(mapBuild.id), `${mapBuild.id} ${verBuild.id}`);
const un = openBuild(mapBuild.id, mapBuild.body, mapBuild.sig, { key: KEY });
check('...and opens whole: its code, its client and what that client is', !un.error && un.api === WORKER_API && un.epoch === SECURITY_EPOCH && un.client.build === 'client-oldmap' && un.files['server/room-worker.js']?.length > 1000 && un.dist['/index.html'] && !Object.keys(un.files).some((f) => f.includes('..')), JSON.stringify(un.error));
check('...signed with the deploy key: not opened without a key, nor with another key, nor unsigned', /no key/.test(openBuild(mapBuild.id, mapBuild.body, mapBuild.sig, { key: '' }).error) && /signature/.test(openBuild(mapBuild.id, mapBuild.body, mapBuild.sig, { key: 'another key' }).error) && /signature/.test(openBuild(mapBuild.id, mapBuild.body, '', { key: KEY }).error));
const forged = JSON.parse(gunzipSync(mapBuild.body).toString());
forged.files['server/room-worker.js'] = Buffer.from('process.exit(7)').toString('base64');
check('a build that is not what its name says is not opened, signature and all', /not what its name says/.test(openBuild(mapBuild.id, gzipSync(JSON.stringify(forged)), mapBuild.sig, { key: KEY }).error) && openBuild(mapBuild.id, Buffer.from('junk'), mapBuild.sig, { key: KEY }).error);
const outside = JSON.parse(gunzipSync(mapBuild.body).toString());
outside.files['server/../../evil.js'] = '';
check('...nor one with a file outside its folders', /outside/.test(openBuild(mapBuild.id, gzipSync(JSON.stringify(outside)), mapBuild.sig, { key: KEY }).error));
// a build correctly named and signed, but of something this server must not start
const variant = (change) => {
  const m = JSON.parse(gunzipSync(mapBuild.body).toString());
  change(m);
  const files = Object.fromEntries(Object.entries(m.files).map(([p, b]) => [p, Buffer.from(b, 'base64')]));
  const hash = buildHash({ ...m, files });
  return { id: hash.slice(0, 24), body: gzipSync(JSON.stringify(m)), sig: signOf(hash, KEY) };
};
const notes = [];
const one = (b) => new Builds({ store: { getBuild: async (id) => (id === b.id ? { body: b.body, sig: b.sig } : null), getAsset: async () => null }, root: REPO, client: {}, key: KEY, log: (t) => notes.push(t), tmp: pathJoin(dir, 'tmp-variant') });
const oldEpoch = variant((m) => (m.epoch = SECURITY_EPOCH - 1));
check('a build from before a security fix (a lower SECURITY_EPOCH) is not started', (await one(oldEpoch).fetch(oldEpoch.id)) === null && notes.some((t) => /from before a security fix/.test(t)), notes.join(' | '));
const otherApi = variant((m) => (m.api = WORKER_API + 1));
check('...nor one that speaks another worker API', (await one(otherApi).fetch(otherApi.id)) === null && notes.some((t) => /worker API/.test(t)));
const otherDeps = variant((m) => (m.deps = { 'some-package': '1.2.3' }));
check("...nor one whose game code uses a package of another version than this server's node_modules", (await one(otherDeps).fetch(otherDeps.id)) === null && notes.some((t) => /uses some-package 1\.2\.3, and this server has none/.test(t)), notes.join(' | '));
const unsignedOk = new Builds({ store: { getBuild: async () => ({ body: mapBuild.body, sig: '' }) }, root: REPO, client: {}, unsigned: true, log: () => {}, tmp: pathJoin(dir, 'tmp-unsigned') });
check('...an unsigned build is started only by a server told to trust the store (HANDOFF_PIN=unsigned)', !!(await unsignedOk.fetch(mapBuild.id)) && (await one({ id: mapBuild.id, body: mapBuild.body, sig: '' }).fetch(mapBuild.id)) === null);
// the copy on disk
const disk = one(mapBuild);
const got = await disk.fetch(mapBuild.id);
const worker = pathJoin(got.dir, 'server', 'room-worker.js');
check('a build is unpacked where a worker can be started from it', existsSync(worker) && readFileSync(worker).equals(un.files['server/room-worker.js']));
appendFileSync(worker, '\nprocess.exit(9); // (somebody else wrote this)\n');
writeFileSync(pathJoin(got.dir, 'server', 'extra.js'), 'export {}');
const again = await disk.fetch(mapBuild.id);
check('...and checked every time it is used: a copy that was changed is written again as the build has it', again && readFileSync(worker).equals(un.files['server/room-worker.js']) && !existsSync(pathJoin(got.dir, 'server', 'extra.js')));

// the signature is of the build's whole hash, not of its 96-bit name
check("a build's signature is of its whole SHA-256: one of its name alone is refused", mapBuild.sig === signOf(buildHash(un), KEY) && /signature/.test(openBuild(mapBuild.id, mapBuild.body, signOf(mapBuild.id, KEY), { key: KEY }).error || ''));

// where builds are unpacked: a folder of this process's own, nobody else's to write in, no links in it
{
  const home = pathJoin(dir, 'tmp-variant');
  const own = readdirSync(home).find((n) => n.startsWith(`stn-builds-${process.pid}-`));
  const mode = statSync(pathJoin(home, own)).mode & 0o777;
  check("builds are unpacked in a folder of this process's own (stn-builds-<pid>-...), only its user's to write", !!own && got.dir.startsWith(pathJoin(home, own)) && (process.platform === 'win32' || mode === 0o700), `${own} ${mode.toString(8)}`);
  // a link planted in the copy (to a file of anybody's choosing): written again without it
  const evil = pathJoin(dir, 'evil.js');
  writeFileSync(evil, 'process.exit(5)');
  let linked = true;
  try {
    unlinkSync(pathJoin(got.dir, 'server', 'wire.js'));
    symlinkSync(evil, pathJoin(got.dir, 'server', 'wire.js'), 'file');
  } catch {
    linked = false; // (Windows without the right to make links: nobody else there can either)
  }
  if (linked) {
    const relinked = await disk.fetch(mapBuild.id);
    check('...a file in it replaced by a link (to anything) is not believed: the copy is written again', relinked && !statSync(pathJoin(got.dir, 'server', 'wire.js'), { throwIfNoEntry: false })?.isSymbolicLink?.() && readFileSync(pathJoin(got.dir, 'server', 'wire.js')).equals(un.files['server/wire.js']));
  }
  // a node_modules of anybody's making beside a build that imports no package: taken away
  mkdirSync(pathJoin(got.dir, 'node_modules', 'evil'), { recursive: true });
  writeFileSync(pathJoin(got.dir, 'node_modules', 'evil', 'index.js'), 'process.exit(6)');
  const cleaned = await disk.fetch(mapBuild.id);
  check('...and so is a node_modules folder put beside a build that imports no package', cleaned && !existsSync(pathJoin(got.dir, 'node_modules')));
  if (process.platform !== 'win32') {
    chmodSync(pathJoin(home, own), 0o777);
    const open = await disk.fetch(mapBuild.id);
    chmodSync(pathJoin(home, own), 0o700);
    check('...and nothing is started from it once others may write in its folder', open === null && notes.some((t) => /is not this server's alone/.test(t)), notes.slice(-2).join(' | '));
  }
  // the folders of processes that are gone are swept (a crash leaves its builds behind), and a link in them is taken
  // away without what it points to
  const outside = pathJoin(dir, 'not-ours');
  mkdirSync(outside, { recursive: true });
  writeFileSync(pathJoin(outside, 'keep.txt'), 'a file somebody else needs');
  const dead = pathJoin(home, 'stn-builds-999999-dead00');
  mkdirSync(pathJoin(dead, 'x'), { recursive: true, mode: 0o700 });
  symlinkSync(outside, pathJoin(dead, 'x', 'node_modules'), 'junction');
  const swept = new Builds({ store: { getBuild: async () => ({ body: mapBuild.body, sig: mapBuild.sig }) }, root: REPO, client: {}, key: KEY, log: () => {}, tmp: home });
  await swept.fetch(mapBuild.id);
  check('...the folders of processes that are gone are swept, and a link in one is taken away without what it points to', !existsSync(dead) && existsSync(pathJoin(outside, 'keep.txt')), readdirSync(home).join(' '));
  const tree = pathJoin(dir, 'tree');
  mkdirSync(tree);
  symlinkSync(outside, pathJoin(tree, 'node_modules'), 'junction');
  removeTree(tree);
  check('...(removeTree never follows a link: a junction to a folder leaves the folder whole)', !existsSync(tree) && existsSync(pathJoin(outside, 'keep.txt')));
}

// a store that failed is asked again the next time; what a build is not is remembered
{
  let asks = 0;
  const flaky = new Builds({ store: { getBuild: async () => (asks++ === 0 ? Promise.reject(new Error('the database is down')) : { body: mapBuild.body, sig: mapBuild.sig }) }, root: REPO, client: {}, key: KEY, log: () => {}, tmp: pathJoin(dir, 'tmp-flaky') });
  const first = await flaky.fetch(mapBuild.id);
  const second = await flaky.fetch(mapBuild.id);
  check('a build the store failed to give is asked for again, not taken to be gone for good', first === null && !!second && asks === 2, `${first} ${!!second} ${asks}`);
  let missing = 0;
  const absent = new Builds({ store: { getBuild: async () => (missing++, null) }, root: REPO, client: {}, key: KEY, log: () => {}, tmp: pathJoin(dir, 'tmp-absent') });
  await absent.fetch(mapBuild.id);
  await absent.fetch(mapBuild.id);
  check('...while one that is not in the store is remembered as not there', missing === 1, String(missing));
}

// many games of one older build coming back at once: its client's files are learnt once, off the event loop
{
  let asks = 0;
  const many = new Builds({ store: { getBuild: async () => (asks++, { body: mapBuild.body, sig: mapBuild.sig }) }, root: REPO, client: {}, key: KEY, log: () => {} });
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  const t0 = performance.now();
  await Promise.all(Array.from({ length: 20 }, () => many.know(mapBuild.id)));
  h.disable();
  const worst = h.max / 1e6;
  console.log(`note  20 games of one older build restored at once: its build opened ${asks} time(s) in ${Math.round(performance.now() - t0)} ms, the event loop held at most ${worst.toFixed(1)} ms`);
  check('twenty games of one older build coming back at once: the store is asked for it once', asks === 1 && many.has('/index.html'), String(asks));
  const nokey = new Builds({ store: { getBuild: async () => (asks++, null) }, root: REPO, client: {}, log: () => {} });
  await nokey.know(mapBuild.id);
  check('...and not at all without the key', asks === 1);
}

// what this thread writes to the players of a game an older build carries on is in that build's codec
{
  const files = JSON.parse(gunzipSync(mapBuild.body).toString()).files;
  let src = Buffer.from(files['shared/protocol.js'], 'base64').toString();
  for (const [from, to] of [['  ROOM: 11,', '  ROOM: 99,'], ['ENDED_MAP: 6', 'ENDED_MAP: 16'], ['export const ENDED_CODE = 4003', 'export const ENDED_CODE = 4013']]) {
    if (!src.includes(from)) throw new Error(`shared/protocol.js no longer has "${from}": pick another line for the test to change`);
    src = src.replace(from, to);
  }
  const proto = await protocolOf({ 'shared/protocol.js': Buffer.from(src) });
  const sent = [];
  const fakeRoom = { proto, code: 'OLDPRO', title: 'Old', inviteOnly: false, difficulty: 'nightfall', first: '', users: [null], names: [''], socks: [{ send: (b) => sent.push(Buffer.from(b)) }] };
  const w = new Writer(32);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('Ann');
  w.str('x');
  Room.prototype.greet.call(fakeRoom, 0, w.bytes());
  check("a game an older build carries on: its players are told which game they are in (ROOM) in their client's codec", sent[0]?.[0] === 99 && S2C.ROOM !== 99, String(sent[0]?.[0]));
  const no = rejectBytes(REJECT_REASON.ENDED_MAP, proto);
  check('...and turned away (REJECT) in it, the reason by its name', no[0] === S2C.REJECT && no[1] === 16, JSON.stringify([...no]));
  let closed = null;
  const shutRoom = { proto, closed: false, code: 'OLDPRO', lobby: { rooms: new Map(), log: () => {}, stats: { leave: () => {} }, matches: null, userOut: () => {} }, socks: [{ getUserData: () => ({}), end: (c) => (closed = c) }], users: [null], recs: new Map(), worker: { postMessage: () => {}, terminate: () => Promise.resolve() }, asks: new Map(), match: null };
  try {
    Room.prototype.shut.call(shutRoom, ENDED_CODE, 'closed');
  } catch {}
  check('...and closed with its close codes', closed === 4013, String(closed));
  check("...and a build whose protocol.js imports another of its files cannot be loaded into this thread", (await protocolOf({ 'shared/protocol.js': Buffer.from("import x from './y.js';\nexport const S2C = {};") })) === null);
}

// the store
const HANDOFF_DIR = pathJoin(dir, 'handoff');
const store = new FileStore(HANDOFF_DIR);
for (const b of [mapBuild, verBuild, enumBuild]) await store.putBuild(b.id, b.body, b.sig, b.assets);
check('the store keeps a build with its signature, and gives it back', (await store.getBuild(mapBuild.id))?.body.equals(mapBuild.body) && (await store.getBuild(mapBuild.id)).sig === mapBuild.sig && (await store.getBuild('0'.repeat(24))) === null);
const assetFiles = readdirSync(`${HANDOFF_DIR}-assets`);
check("...and a client's files once each, however many builds have them (the same sound in three builds: one file)", assetFiles.length === 7, String(assetFiles.length));
check('...and sweeping the saves does not take the builds', (await store.sweep(0)) === 0 && (await store.sweepBuilds(3600)) === 0 && !!(await store.getBuild(verBuild.id)));

// a server that runs for days: its own build is put back in the store if it was swept meanwhile (ensure, at the
// handover and twice a day)
{
  const own = new FileStore(pathJoin(dir, 'handoff-own'));
  const b = new Builds({ store: own, root: oldmap.root, client: oldmap.client, dist: oldmap.dist, key: KEY, log: () => {} });
  await b.pack();
  clearInterval(b.keepTimer);
  const there = !!(await own.getBuild(b.id));
  unlinkSync(pathJoin(dir, 'handoff-own-builds', `${b.id}.json`)); // (another server's sweep took it)
  await b.ensure();
  check("a server's own build, swept from the store while it ran, is put back before its games are saved", there && !!(await own.getBuild(b.id)) && (await own.getBuild(b.id)).sig === b.packed.sig);
}

// the handover does not wait past keepMs for this build to be in the store (a database that hangs): the games are saved
// anyway, within HARD_EXIT_MS
{
  const lobby = new Lobby({ stats: { board: () => ({ total: 0, rows: [] }) }, log: () => {}, keepMs: 300 });
  lobby.builds = { ensure: () => new Promise(() => {}), touch: () => {}, id: 'ab'.repeat(12) };
  let saved = 0;
  lobby.rooms.set('HANGUP', { code: 'HANGUP', st: { players: 1 }, ready: true, closed: false, pin: null, handoff: async () => (saved++, { bytes: 1, ms: 1 }), finish: async () => {} });
  const t0 = Date.now();
  const n = await Promise.race([lobby.handoffAll({}, 1000), sleep(5000).then(() => 'hung')]);
  check('a server going down whose build cannot be put in the store (it hangs) saves its games anyway, in keepMs', n === 1 && saved === 1 && Date.now() - t0 < 2000, `${n} in ${Date.now() - t0} ms`);
}

// a server told to stop while it fetches the build a game needs puts that game's save back at once: the handover
// does not wait for the fetch, nor is the save put back after it has moved on
{
  const lobby = new Lobby({ stats: { board: () => ({ total: 0, rows: [] }) }, log: () => {} });
  const puts = [];
  lobby.store = { put: async (code) => puts.push(code) };
  lobby.builds = { canStart: true, id: 'cd'.repeat(12), fetch: () => new Promise(() => {}), touch: () => {} };
  lobby.afterFailed({ code: 'LATEPB', after: false, pin: null, failed: REJECT_REASON.ENDED_MAP, from: { meta: { build: 'ab'.repeat(12) }, body: Buffer.from('a save') } });
  const t0 = Date.now();
  await lobby.handoffAll(lobby.store, 1000);
  check('a server told to stop while it fetches an older build puts the save back at once, before it goes on', puts.includes('LATEPB') && Date.now() - t0 < 1000, `${JSON.stringify(puts)} in ${Date.now() - t0} ms`);
}

// how long a game is kept on an older build
{
  const closed = [];
  const fake = (since) => ({ code: 'CAPCAP', closed: false, pinEnd: 0, pin: { id: mapBuild.id, since }, lobby: { log: () => {}, ended: (code, reason) => closed.push(['ended', reason]) }, shut: (code, why) => closed.push(['shut', code, why]), pinClose: Room.prototype.pinClose });
  const young = fake(Date.now() - 3600e3);
  Room.prototype.pinCheck.call(young, { phase: PHASE.NIGHT }, { phase: PHASE.DAY });
  check('a game on an older build for an hour goes on through dawn', !closed.length && !young.pinEnd);
  const old = fake(Date.now() - 13 * 3600e3);
  Room.prototype.pinCheck.call(old, { phase: PHASE.DAY }, { phase: PHASE.DAY });
  check('...one on it for over HANDOFF_PIN_MAX_HOURS (12) goes on through the day', !closed.length);
  Room.prototype.pinCheck.call(old, { phase: PHASE.NIGHT }, { phase: PHASE.DAY });
  check('...and closes at its first dawn, its players told why (and whoever comes for it later)', closed.length === 2 && closed[0][1] === REJECT_REASON.ENDED_UPDATE && closed[1][1] === ENDED_CODE && /older version of the game for 13 hours/.test(closed[1][2]), JSON.stringify(closed));
  const over = fake(Date.now());
  Room.prototype.pinCheck.call(over, { phase: PHASE.NIGHT }, { phase: PHASE.GAMEOVER });
  check('a run over on an older build: its game closes once the end screen has had its time', over.pinEnd > Date.now() + 60_000);
}

// ---------------------------------------------------------------- the saves, as a server going down leaves them
const meta = (extra) => ({ name: 'Day one', host: 'Ann', maker: '', first: 'Ann', inviteOnly: false, quick: false, maxPlayers: 4, difficulty: 'nightfall', created: Date.now(), match: null, ...extra });
await store.put('MAPPIN', meta({ build: mapBuild.id }), onMap.body);
await store.put('VERPIN', meta({ build: verBuild.id }), onVer.body);
await store.put('ENUMPIN', meta({ build: enumBuild.id }), onEnum.body);
await store.put('NOBUILD', meta({}), onMap.body); // (as a build from before builds were kept saved it)
await store.put('BUILDGONE', meta({ build: 'ab'.repeat(12) }), onMap.body);
const stranger = packBuild(oldmap.root, { client: { ...oldmap.client, build: 'client-stranger' }, dist: oldmap.dist, key: 'somebody else key' });
await store.put('NOTOURS', meta({ build: stranger.id }), onMap.body);
await store.putBuild(stranger.id, stranger.body, stranger.sig, stranger.assets); // (in the store, signed by another key)

const base = 43000 + Math.floor(Math.random() * 800);
const procs = [];
function server(name, port, env = {}) {
  mkdirSync(pathJoin(dir, `tmp-${name}`), { recursive: true });
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: REPO,
    env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: pathJoin(dir, `stats-${name}.json`), HANDOFF_DIR, HANDOFF_BUILD_KEY: KEY, HANDOFF_PIN: '1', DAY_SECONDS: '3600', LOBBY_LIMITS: '0', TMPDIR: pathJoin(dir, `tmp-${name}`), TEMP: pathJoin(dir, `tmp-${name}`), TMP: pathJoin(dir, `tmp-${name}`), ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const s = { name, port, proc, log: '', exit: null };
  proc.stdout.on('data', (d) => (s.log += d));
  proc.stderr.on('data', (d) => (s.log += d));
  proc.on('exit', (code) => (s.exit = { code }));
  procs.push(s);
  return s;
}
const stop = (s) => (process.platform === 'win32' ? s.proc.send({ t: 'shutdown' }) : s.proc.kill('SIGTERM'));
const text = async (s, path) => {
  const r = await fetch(`http://localhost:${s.port}${path}`, { headers: { 'accept-encoding': 'identity' } });
  return { status: r.status, body: await r.text() };
};
// one try at joining with the client's own Connection: true once in, else the Error
const tryJoin = (s, code, pid, into = {}) => {
  globalThis.location = { protocol: 'http:', host: `localhost:${s.port}` };
  const conn = new Connection({ close: (c) => (into.closed = c) });
  into.conn = conn;
  return conn.connect('Ann', pid, code).then(
    (info) => {
      into.id = info.id;
      into.seed = info.seed;
      return true;
    },
    (err) => err
  );
};
const back = async (s, code, pid) => {
  const into = {};
  into.why = await comeBack({ code, moved: true, join: () => tryJoin(s, code, pid, into), every: 100, ms: 30000 });
  return into;
};
const warn = console.warn;
console.warn = () => {};

try {
  // (the page of the build that runs ENUMPIN is not in the store any more: swept, or a store that fails)
  const enumPage = createHash('sha256').update(oldenum.dist.get('/index.html').body).digest('hex');
  unlinkSync(pathJoin(`${HANDOFF_DIR}-assets`, enumPage));
  const A = server('A', base);
  check('the next server is up', await until(() => A.log.includes('listening')), A.log);
  await until(() => /build [0-9a-f]{24} is in the store/.test(A.log));
  check('...and has put its own build in the store, signed, for the servers after it', /this build is [0-9a-f]{24} \(\d+ files of code, \d+ client files; .*, signed\)/.test(A.log) && /is in the store/.test(A.log), A.log.split('\n').slice(0, 8).join('\n'));
  const ownId = /this build is ([0-9a-f]{24})/.exec(A.log)?.[1];
  await until(() => ['MAPPIN', 'VERPIN', 'ENUMPIN'].every((c) => new RegExp(`game ${c} carried on by build`).test(A.log)) && /NOBUILD not restored/.test(A.log) && /BUILDGONE not restored/.test(A.log) && /NOTOURS not restored/.test(A.log), 30000);
  check('it cannot read the save of another map, and says the build that saved it will carry it on', new RegExp(`game MAPPIN cannot be carried on by this build \\(this build makes another valley of seed ${SEED}\\): build ${mapBuild.id} will`).test(A.log) && /game MAPPIN carried on by build/.test(A.log), A.log.split('\n').slice(-14).join('\n'));
  check('...nor of another state version: the same', /game VERPIN cannot be carried on by this build \(state version 7/.test(A.log) && /game VERPIN carried on by build/.test(A.log));
  check('...nor with an enum entry it does not have: the same', /game ENUMPIN cannot be carried on by this build \(renumbered since the save: ITEM\.OLD_TEST_ITEM/.test(A.log) && /game ENUMPIN carried on by build/.test(A.log), A.log.split('\n').filter((l) => /ENUMPIN/.test(l)).join('\n'));

  for (const [code, saved, label] of [
    ['MAPPIN', onMap, 'the game on the other map'],
    ['VERPIN', onVer, 'the game of the other state version'],
    ['ENUMPIN', onEnum, 'the game with the other enum'],
  ]) {
    const p = await back(A, code, pids[0]);
    check(`${label} goes on: its player is back in their own body, on the same seed`, p.why === '' && p.id === saved.ids[0] && p.seed === SEED, JSON.stringify({ why: p.why, id: p.id, was: saved.ids[0] }));
    p.conn.close(4001);
  }

  // the client each game is played with
  const page = await text(A, '/?game=MAPPIN');
  const pageWas = pageBuild({ querySelector: () => ({ getAttribute: () => /<meta name="stn-build" content="([^"]*)">/.exec(page.body)?.[1] }) });
  check("the page asked for with the game's code is the client of the build that runs it, saying so", page.status === 200 && page.body.includes('<title>oldmap</title>') && pageWas?.build === 'client-oldmap' && pageWas.compat === 'compat-oldmap', page.body.slice(0, 160));
  const v = await (await fetch(`http://localhost:${A.port}/api/version?game=MAPPIN`)).json();
  check("...and /api/version for that game is that build's: its pages go back in as they are, never reloaded for it", v.build === 'client-oldmap' && v.compat === 'compat-oldmap' && verdictFor(pageWas, v) === '', JSON.stringify(v));
  const own = await (await fetch(`http://localhost:${A.port}/api/version`)).json();
  check("...while a page of this build's client asked to join it is sent to that game's page instead (moveback.js verdict)", verdictFor({ protocol: own.protocol, build: own.build, compat: own.compat }, v) === 'reload');
  const asset = await text(A, '/assets/index-oldmap.js');
  check('...whose files are served under their own names, from the store', asset.status === 200 && asset.body.includes('the client of oldmap'), asset.body.slice(0, 80));
  check('...and a file no build has is not there (not the page in its place)', (await text(A, '/assets/index-nosuchfile.js')).status === 404);
  check('...each game its own build', (await text(A, '/?game=VERPIN')).body.includes('<title>oldver</title>'));
  const unavailable = await fetch(`http://localhost:${A.port}/?game=ENUMPIN`, { headers: { 'accept-encoding': 'identity' } });
  const unavailableBody = await unavailable.text();
  check("a game whose build's page cannot be had: 503, try again - never this build's page, which that game's version answer would send round and round", unavailable.status === 503 && +unavailable.headers.get('retry-after') > 0 && !unavailableBody.includes('stn-build') && /older version/.test(unavailableBody), `${unavailable.status} ${unavailableBody.slice(0, 120)}`);
  const plain = await text(A, '/');
  check("the page without a code, or with another, is this build's own", !plain.body.includes('oldmap') && !(await text(A, '/?game=NOSUCH22')).body.includes('oldmap'), plain.body.slice(0, 60));
  const list = await (await fetch(`http://localhost:${A.port}/api/games`)).json();
  const card = await fetch(`http://localhost:${A.port}/api/games/MAPPIN`);
  check("those games are not in the lobby's list (this build's client cannot play them), and their links still work", list.games === 3 && !list.list.some((g) => /PIN$/.test(g.code)) && card.status === 200, JSON.stringify(list.list.map((g) => g.code)));
  const quick = {};
  await tryJoin(A, '', randomUUID(), quick);
  check('...and a quick join does not land in one', quick.id > 0 && quick.conn.room && !/PIN$/.test(quick.conn.room.code), JSON.stringify(quick.conn.room));
  quick.conn.close(4001);

  // saves that cannot be carried on by anything
  const none = await back(A, 'NOBUILD', pids[0]);
  check('a save that names no build ends as before: its player is told the update changed the map', /update to the game changed the map/.test(none.why), none.why);
  const gone = await back(A, 'BUILDGONE', pids[0]);
  check('...and so does one whose build is not in the store', /update to the game changed the map/.test(gone.why) && /build abababababababababababab is not started here: it is not in the store/.test(A.log), gone.why);
  const theirs = await back(A, 'NOTOURS', pids[0]);
  check('...and one whose build was not signed with this deploy key: nothing from the store runs here without it', /update to the game changed the map/.test(theirs.why) && new RegExp(`build ${stranger.id} is not started here: its signature is not this deploy key`).test(A.log), A.log.split('\n').filter((l) => /NOTOURS|signature/.test(l)).join('\n'));

  // ---------------------------------------------------------------- the next deploy, and the one after
  const ann = await back(A, 'MAPPIN', pids[0]);
  const annId = ann.id; // (she left it on purpose above: back as a newcomer, under this id from now on)
  let from = A;
  for (const [name, port] of [
    ['B', base + 1],
    ['C', base + 2],
  ]) {
    const next = server(name, port);
    check(`server ${name} is up`, await until(() => next.log.includes('listening')));
    const closed = {};
    ann.conn.h.close = (c) => (closed.ann = c);
    stop(from);
    await until(() => from.exit, 20000);
    check(`...${from.name} hands its games on and goes: the sockets are closed as moved`, from.exit?.code === 0 && closed.ann === 4002 && /handed over/.test(from.log), JSON.stringify({ exit: from.exit, closed }));
    const again = await back(next, 'MAPPIN', pids[0]);
    check(`...and ${name} carries the game of the other map on by the same build: the player is back in their own body`, again.why === '' && again.id === annId && new RegExp(`game MAPPIN carried on by build ${mapBuild.id}`).test(next.log), JSON.stringify({ why: again.why, id: again.id, log: next.log.split('\n').slice(-8) }));
    check('...still played with that build own client', (await text(next, '/?game=MAPPIN')).body.includes('<title>oldmap</title>'));
    ann.conn = again.conn;
    from = next;
  }
  check('a build a game runs on stays in the store while it does', !!(await store.getBuild(mapBuild.id)) && !!(await store.getBuild(ownId)));
  // a deploy that comes while the server is still bringing such a game back: the save goes back into the store
  await store.put('RACEPIN', meta({ build: mapBuild.id }), onMap.body);
  stop(from); // (nobody after it yet: its games wait in the store, with this one)
  await until(() => from.exit, 20000);
  const D = server('D', base + 3);
  await until(() => /game RACEPIN restored from the last server/.test(D.log), 20000);
  stop(D);
  await until(() => D.exit, 20000);
  check('a server told to stop while it is still bringing a game back puts the save back in the store', D.exit?.code === 0 && /RACEPIN: its save is back in the store/.test(D.log) && (await store.pending()).includes('RACEPIN'), D.log.split('\n').slice(-8).join('\n'));
  const E = server('E', base + 4);
  check('server E is up', await until(() => E.log.includes('listening')));
  const raced = await back(E, 'RACEPIN', pids[0]);
  check('...and the server after it carries the game on: the player is back in their own body', raced.why === '' && raced.id === onMap.ids[0], JSON.stringify({ why: raced.why, id: raced.id }));
  const mapped = await back(E, 'MAPPIN', pids[0]);
  check('...as it does the one handed over with nobody after (three deploys on, still on its build)', mapped.why === '' && mapped.id === annId && new RegExp(`game MAPPIN carried on by build ${mapBuild.id}`).test(E.log), JSON.stringify({ why: mapped.why }));
  // without the key, nothing is kept or started
  stop(E);
  await until(() => E.exit, 20000);
  const F = server('F', base + 5, { HANDOFF_BUILD_KEY: '' });
  check('a server without HANDOFF_BUILD_KEY says what that means as it starts', await until(() => /HANDOFF_BUILD_KEY is not set, so no build is kept/.test(F.log)), F.log.split('\n').slice(0, 6).join('\n'));
  const keyless = await back(F, 'MAPPIN', pids[0]);
  check('...and a game a build before it saved, which it cannot read, ends there, its player told why', /update to the game changed the map/.test(keyless.why), keyless.why);
  stop(F);
  await until(() => F.exit, 20000);
  check('the servers took it all in their stride', procs.every((s) => !/crashed/.test(s.log)), procs.map((s) => s.log.match(/.*crashed.*/g)).join('\n'));
} catch (e) {
  check('no error', false, String(e && e.stack));
}
console.warn = warn;
for (const s of procs) if (!s.exit) s.proc.kill('SIGKILL');
await until(() => procs.every((s) => s.exit), 5000);
check('every server is stopped', procs.every((s) => s.exit));
// (every line about the games the test follows, and the last ones)
if (failed) for (const s of procs) console.log(`\n--- ${s.name} ---\n${s.log.split('\n').filter((l, i, all) => i >= all.length - 30 || /PIN|NOBUILD|BUILDGONE|NOTOURS|build/.test(l)).join('\n')}`);
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
