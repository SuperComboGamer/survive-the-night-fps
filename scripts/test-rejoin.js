// Coming back after a drop (server/game.js hold / resume) against a real server process: a player whose socket drops
// keeps their place - the game still counts them, and the same browser (or account) joining again gets the same body
// back, at the same spot, not a new player - while "Leave game" (LEFT_CODE) lets the place go at once, a drop that
// nobody comes back for is let go when REJOIN_GRACE runs out, and somebody else's browser cannot take a held body.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { C2S, S2C, PROTOCOL_VERSION, LEFT_CODE, Writer, Reader } from '../shared/protocol.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRACE = 4; // seconds (REJOIN_GRACE_SECONDS)
const port = 39900 + Math.floor(Math.random() * 90);
const dir = mkdtempSync(join(tmpdir(), 'stn-rejoin-'));
const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), STATS_FILE: join(dir, 'stats.json'), REJOIN_GRACE_SECONDS: String(GRACE), GAME_IDLE_SECONDS: '30' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
proc.stdout.on('data', (d) => (log += d));
proc.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 200 && !log.includes('listening'); i++) await sleep(50);

const client = (code, name, pid) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws${code ? `?game=${code}` : ''}`);
    ws.binaryType = 'arraybuffer';
    const c = { ws, room: null, id: 0, reject: 0, chat: [], snaps: 0, closed: false };
    c.close = (code = 1000) => new Promise((done) => (c.closed ? done() : ((ws.onclose = () => ((c.closed = true), done())), ws.close(code))));
    ws.onopen = () => {
      const w = new Writer(128);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.str(pid);
      ws.send(w.bytes());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      const t = r.u8();
      if (t === S2C.ROOM) c.room = { code: r.str() };
      else if (t === S2C.WELCOME) {
        c.id = r.u16();
        resolve(c);
      } else if (t === S2C.REJECT) {
        c.reject = r.u8();
        resolve(c);
      } else if (t === S2C.SNAPSHOT) c.snaps++;
      else if (t === S2C.CHAT) {
        r.u16();
        r.u8();
        c.chat.push(r.str());
      }
    };
    ws.onclose = () => {
      c.closed = true;
      resolve(c);
    };
  });
const players = async (code) => (await (await fetch(`http://localhost:${port}/api/games/${code}`)).json())?.players;

try {
  const annId = randomUUID();
  const ann = await client('', 'Ann', annId);
  const code = ann.room.code;
  const ben = await client(code, 'Ben', randomUUID()); // (keeps the game going, and hears the chat)
  await sleep(1500);
  check('two players in the game', (await players(code)) === 2, String(await players(code)));

  // a drop: the place is held
  ann.ws.close(1000); // (a plain close, not LEFT_CODE: as a dropped link or a closed tab)
  await sleep(1500);
  check('a dropped player is still counted while their place is held', (await players(code)) === 2, String(await players(code)));
  check('the others are told', ben.chat.some((t) => /lost connection/.test(t)), JSON.stringify(ben.chat));

  // someone else's browser under the same name does not get the body
  const imp = await client(code, 'Ann', randomUUID());
  check('another browser under the same name is a newcomer, not the held player', imp.id && imp.id !== ann.id, `${imp.id} vs ${ann.id}`);
  await imp.close(LEFT_CODE);
  await sleep(800);

  // the same browser comes back inside the minute: the same player
  const back = await client(code, 'Ann', annId);
  check('the same browser back inside the grace time gets the same player', back.id === ann.id, `${back.id} vs ${ann.id}`);
  await sleep(1200);
  check('...still two players, not three', (await players(code)) === 2, String(await players(code)));
  check('...and is told so', back.chat.some((t) => /Reconnected/.test(t)), JSON.stringify(back.chat));
  check('...and the game streams to them again', back.snaps > 10, String(back.snaps));

  // "Leave game": the place goes at once
  await back.close(LEFT_CODE);
  await sleep(1500);
  check('"Leave game" lets the place go at once', (await players(code)) === 1, String(await players(code)));

  // a drop nobody comes back for is let go when the grace time is up
  const cyId = randomUUID();
  const cy = await client(code, 'Cy', cyId);
  await sleep(1000);
  cy.ws.close(1000);
  await sleep(1500);
  const held = await players(code);
  await sleep((GRACE + 2) * 1000);
  const after = await players(code);
  check('a drop nobody comes back for is let go after the grace time', held === 2 && after === 1, `held ${held}, after ${after}`);
  const late = await client(code, 'Cy', cyId);
  check('...and coming back after that is a fresh join', late.id && late.chat.every((t) => !/Reconnected/.test(t)));
  await late.close(LEFT_CODE);
  await ben.close(LEFT_CODE);
} catch (e) {
  check('no error', false, String(e && e.stack));
}
proc.kill();
if (failed) console.log(log.split('\n').slice(-30).join('\n'));
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
