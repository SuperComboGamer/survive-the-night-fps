// Several games on one server: opens a second room over HTTP, joins both over real WebSockets and checks they are separate
// games (each its own seed and players), that the list shows them, and that others can join an existing game.
// usage: node scripts/test-rooms.js   (starts its own server on a spare port)
import { spawn } from 'node:child_process';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';

const PORT = 3100 + Math.floor(Math.random() * 400);
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
let ready = false;
srv.stdout.on('data', (d) => /listening/.test(String(d)) && (ready = true));
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !ready; i++) await sleep(100);
const base = `http://localhost:${PORT}`;
const get = async (p) => (await fetch(base + p)).json();

function join(room, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?room=${room}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const w = new Writer(64);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      ws.send(w.copy());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      if (r.u8() === S2C.WELCOME) {
        const id = r.u16();
        resolve({ ws, id, seed: r.u32() });
      }
    };
    ws.onerror = reject;
    setTimeout(() => reject(new Error('no welcome')), 5000);
  });
}

try {
  let list = await get('/rooms');
  check('the main room is listed', list.length === 1 && list[0].id === 'main' && list[0].main);
  const made = await get('/rooms/new?name=Deep%20Dive');
  check('a second room can be opened', !!made.id && made.name === 'Deep Dive', JSON.stringify(made));
  list = await get('/rooms');
  check('it is listed', list.length === 2 && !!list.find((r) => r.id === made.id));
  const a = await join('main', 'Ann');
  const b = await join(made.id, 'Bob');
  const seeds = Object.fromEntries(list.map((r) => [r.id, r.seed]));
  check('each player is in their own game (its own world)', a.seed === seeds.main && b.seed === seeds[made.id], `${a.seed} ${b.seed}`);
  await sleep(300);
  list = await get('/rooms');
  check('each room has its own player', list.find((r) => r.id === 'main').players === 1 && list.find((r) => r.id === made.id).players === 1);
  const c = await join(made.id, 'Cy');
  await sleep(300);
  list = await get('/rooms');
  check('others can join an existing game', list.find((r) => r.id === made.id).players === 2 && c.seed === b.seed);
  const st = await get('/status');
  check('/status is still the main room', st.players === 1 && st.seed === seeds.main);
  const dr = await get('/dr/status');
  check('/dr/status lists the open Dead Ride games', Array.isArray(dr.games));
  for (const x of [a, b, c]) x.ws.close();
  await sleep(300);
  list = await get('/rooms');
  check('everyone left: players back to zero', list.every((r) => r.players === 0));
} catch (e) {
  check('no error', false, String(e));
}
srv.kill();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
process.exit(fails.length ? 1 : 0);
