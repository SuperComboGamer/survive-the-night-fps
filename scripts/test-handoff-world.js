// A deploy whose build makes the map differently (server/handoff.js worldPrint, Game's check of a save's valley,
// Lobby.ended, client/net/comeback.js).
//
// What happened (6 Oct 2026): a deploy filed one container of the island - the toolbox on the stalled train - under
// "Roadside" where the build before had it under "Whitlock Depot". Nothing moved, but the one fingerprint a save was
// checked against took the label in, so two games on day 1 were dropped ("this build makes another valley of seed
// 1373936255"), and their players, sent back by the reload, were told "That game has ended, or the link is wrong"
// every three seconds for a minute.
//
// Here, on that seed:
//   1. in one process: a game saved by a build that files that toolbox under the depot is restored by this one (same
//      ground: the `shape` fingerprint), players and all; a save whose ground differs is refused, and so is one from
//      before saves carried a shape when the old, stricter fingerprint differs (nothing in it says the ground is the
//      same) - while such an old save of the same valley still loads;
//   2. a real server given those saves, and the client's own Connection and comeBack against it: the game that could
//      be carried over is joined into the same body; the ones that could not are refused once, with why
//      (REJECT_REASON.ENDED_MAP / ENDED_UPDATE), to whoever asks for a while after; a code nobody ever had is still
//      NO_GAME, and is given up on after three.
// (No browser: what the splash then shows is the text checked here, put there by main.js rejoin / moveBack.)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Game } from '../server/game.js';
import { envelope, encode, decode, worldPrint, HandoffError, FileStore, STATE_VERSION } from '../server/handoff.js';
import { C2S, S2C, PROTOCOL_VERSION, REJECT_REASON, Writer, Reader } from '../shared/protocol.js';
import { ZONE, ZONE_NAMES, CONT } from '../shared/defs.js';
import { Connection } from '../client/net/connection.js';
import { comeBack, rejectText, NO_GAME_TRIES } from '../client/net/comeback.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const quiet = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = 1373936255; // (the valley of one of the two games)

// a player on a Game in this process
const join = (game, name, pid) => {
  const c = { id: 0 };
  c.session = game.onOpen({
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  });
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(pid);
  game.onMessage(c.session, w.bytes());
  return c;
};

// ---------------------------------------------------------------- 1. the build before, and this one
// The game as the build before made it: the same valley, with the train's toolbox counted as the depot's (what
// shared/rail.js did until "Schematics are where the map says they are"). Day 1, two players.
const A = new Game({ seed: SEED, dayLength: 3600, godMode: true, log: quiet });
const boxAt = (w) => w.containers.findIndex((c) => c.ctype === CONT.TOOLBOX && c.zone === ZONE.ROADSIDE);
const k = boxAt(A.world);
check('the valley has a toolbox filed under no place (the stalled train has one)', k >= 0);
const now = { ...A.worldPrint };
A.world.containers[k].zone = ZONE.STATION;
A.worldPrint = worldPrint(A.world);
A.worldHash = A.worldPrint.hash;
A.worldShape = A.worldPrint.shape;
check(`filing it under ${ZONE_NAMES[ZONE.STATION]} changes the fingerprint saves used to be checked against`, A.worldHash !== now.hash, `${A.worldHash} / ${now.hash}`);
check('...and not the shape of the valley: nothing moved', A.worldShape === now.shape, `${A.worldShape} / ${now.shape}`);
const pids = { ann: randomUUID(), ben: randomUUID() };
const ann = join(A, 'Ann', pids.ann);
const ben = join(A, 'Ben', pids.ben);
for (let i = 0; i < 40; i++) A.update();
check('two players in it on day 1', ann.id > 0 && ben.id > 0 && A.day === 1, `${ann.id} ${ben.id} day ${A.day}`);
const box = A.caches.find((c) => c.x === A.world.containers[k].x && c.z === A.world.containers[k].z);
box.state = 1; // (searched)
const saved = encode(envelope(A));
const env = () => decode(saved);
check('a save carries both fingerprints: the one builds before this read, and the shape', env().worldHash === A.worldHash && env().worldShape === A.worldShape, JSON.stringify([env().worldHash, env().worldShape]));

// what this build does with a save (changed as `mutate` says first): the Game, or the error
const restore = (mutate = () => {}) => {
  const e = env();
  mutate(e);
  try {
    return new Game({ dayLength: 3600, log: quiet, restore: e });
  } catch (err) {
    return err;
  }
};
const B = restore();
check('this build restores it: the toolbox is filed elsewhere, the ground is the same', B instanceof Game, B?.stack);
if (B instanceof Game) {
  check('...the same valley, day and players, each held for their own browser', B.seed === SEED && B.day === 1 && B.players.has(ann.id) && B.players.has(ben.id) && [...B.players.values()].every((p) => p.away));
  const box2 = B.ents[box.id];
  check('...the toolbox is where it was, searched, still the depot own (a container is saved with its zone)', box2?.x === box.x && box2.z === box.z && box2.state === 1 && box2.zone === ZONE.STATION && B.world.containers[k].zone === ZONE.ROADSIDE, JSON.stringify(box2));
  check('...and what the save said of schematics and supplies is as it was', JSON.stringify(B.schemHints) === JSON.stringify(A.schemHints) && JSON.stringify(B.supplyHints) === JSON.stringify(A.supplyHints));
}
const moved = restore((e) => (e.worldShape = 'another'));
check('a save of a valley whose ground this build makes differently is refused, as a map that changed', moved instanceof HandoffError && moved.world === true, moved?.stack || 'it was restored');
const old = restore((e) => delete e.worldShape);
check('a save from before saves carried a shape, with the old fingerprint differing, is refused too (the two games of 6 Oct)', old instanceof HandoffError && old.world === true && /another valley of seed 1373936255/.test(old.message), old?.stack || 'it was restored');
const oldSame = restore((e) => {
  delete e.worldShape;
  e.worldHash = now.hash;
});
check('...while one of the valley as this build makes it still loads', oldSame instanceof Game, oldSame?.stack);
const otherVersion = restore((e) => e.stateVersion++);
check('a save of another state version is refused, and not as a map that changed', otherVersion instanceof HandoffError && otherVersion.world === false);

// ---------------------------------------------------------------- 2. a real server, and the client's own code
const dir = mkdtempSync(pathJoin(tmpdir(), 'stn-handoff-world-'));
const HANDOFF_DIR = pathJoin(dir, 'handoff');
const store = new FileStore(HANDOFF_DIR);
const meta = { name: 'Day one', host: 'Ann', maker: '', first: 'Ann', inviteOnly: false, quick: false, maxPlayers: 4, difficulty: 'nightfall', created: Date.now(), match: null };
const put = (code, mutate = () => {}) => {
  const e = env();
  mutate(e);
  return store.put(code, meta, encode(e));
};
const CARRIED = 'CARRYME';
const MAP = 'MAPGONE';
const OLD = 'PRESHAPE';
const VER = 'VERSNGONE';
const LATE = 'LATEMAP';
await put(CARRIED);
await put(MAP, (e) => (e.worldShape = 'another'));
await put(OLD, (e) => delete e.worldShape);
await put(VER, (e) => (e.stateVersion = STATE_VERSION + 1));

const port = 42000 + Math.floor(Math.random() * 800);
const proc = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, DATABASE_URL: '', PORT: String(port), STATS_FILE: pathJoin(dir, 'stats.json'), HANDOFF_DIR, GODMODE: '1', DAY_SECONDS: '3600', LOBBY_LIMITS: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
let exited = false;
proc.stdout.on('data', (d) => (log += d));
proc.stderr.on('data', (d) => (log += d));
proc.on('exit', () => (exited = true));

// the client's Connection, as the page uses it (connection.js reads the page's address for the socket's)
globalThis.location = { protocol: 'http:', host: `localhost:${port}` };
// one try at joining `code`: true once in (the WELCOME's id in `into`), else the Error (as main.js onJoin hands rejoin)
const tryJoin = (code, pid, into = {}) => {
  const conn = new Connection({});
  into.tries = (into.tries || 0) + 1;
  return conn.connect('Ann', pid, code).then(
    (info) => {
      into.id = info.id;
      into.seed = info.seed;
      conn.close(4001);
      return true;
    },
    (err) => err
  );
};
const fast = { every: 30, ms: 20_000 };
const warn = console.warn;
console.warn = () => {}; // (connection.js notes each socket that closed unanswered)

try {
  for (let i = 0; i < 300 && !log.includes('listening'); i++) await sleep(50);
  check('the next server is up', log.includes('listening'), log);
  for (let i = 0; i < 200 && (log.match(/not restored: /g) || []).length < 3; i++) await sleep(50);
  check('it says which saves it could not use, and why', /MAPGONE not restored: this build makes another valley of seed 1373936255/.test(log) && /PRESHAPE not restored: this build makes another valley/.test(log) && /VERSNGONE not restored: state version/.test(log), log.split('\n').slice(-12).join('\n'));
  check('...and carries on', !exited);

  // the game whose toolbox was filed elsewhere: carried over
  const back = {};
  const why = await comeBack({ code: CARRIED, moved: true, join: () => tryJoin(CARRIED, pids.ann, back), ...fast });
  check('the game with the same ground is there: its player is back in their own body, in the same valley', why === '' && back.id === ann.id && back.seed === SEED, JSON.stringify({ why, back, log: log.split('\n').slice(-6) }));

  // the game whose map changed: told so, once
  const gone = {};
  const said = await comeBack({ code: MAP, moved: true, join: () => tryJoin(MAP, pids.ann, gone), ...fast });
  check('the game whose map changed: the player is told an update changed the map', said === rejectText(REJECT_REASON.ENDED_MAP) && /update to the game changed the map/.test(said), said);
  check('...after one try, not a minute of them', gone.tries === 1, String(gone.tries));
  const friend = await tryJoin(MAP, pids.ben);
  check('...and so is the other player, and anyone with its link for a while', friend?.reason === REJECT_REASON.ENDED_MAP, String(friend?.reason));
  const card = await fetch(`http://localhost:${port}/api/games/${MAP}`);
  check('...its invite card finds no game', card.status === 404);
  const pre = await tryJoin(OLD, pids.ann);
  check('a save from the build before this one, on a map that build made differently: the same', pre?.reason === REJECT_REASON.ENDED_MAP, String(pre?.reason));
  const ver = {};
  const saidVer = await comeBack({ code: VER, moved: true, join: () => tryJoin(VER, pids.ann, ver), ...fast });
  check('a game the update ended for another reason: told an update ended it, once', saidVer === rejectText(REJECT_REASON.ENDED_UPDATE) && ver.tries === 1, `${saidVer} (${ver.tries})`);

  // a save that arrives as its player does (the old server saves, then closes the sockets: the client is back at once)
  await put(LATE, (e) => (e.worldShape = 'another'));
  const late = {};
  const saidLate = await comeBack({ code: LATE, moved: true, join: () => tryJoin(LATE, pids.ann, late), ...fast });
  check('a player who is on the socket while their game turns out not to restore is told the same', saidLate === rejectText(REJECT_REASON.ENDED_MAP), `${saidLate} (${late.tries})`);

  // a code no game ever had
  const none = {};
  const saidNone = await comeBack({ code: 'NOSUCH22', moved: false, join: () => tryJoin('NOSUCH22', pids.ann, none), ...fast });
  check(`a code nobody has is still "no game", given up on after ${NO_GAME_TRIES} of them`, none.tries === NO_GAME_TRIES && /NOSUCH22 has ended/.test(saidNone), `${saidNone} (${none.tries})`);
  check('the server took it all in its stride', !exited && (await fetch(`http://localhost:${port}/status`)).status === 200);
} catch (e) {
  check('no error', false, String(e && e.stack));
}
console.warn = warn;
proc.kill('SIGKILL');
for (let i = 0; i < 100 && !exited; i++) await sleep(50);
check('the server is stopped', exited);
if (failed) console.log(`\n--- server ---\n${log.split('\n').slice(-30).join('\n')}`);
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
