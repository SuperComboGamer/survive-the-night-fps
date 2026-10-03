// Several games on one server: opens a second room over HTTP, joins both over real WebSockets and checks they are separate
// games (different mode, different players), that the list shows them, and that an emptied opened room is closed.
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

function join(room, name, mode) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?room=${room}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const w = new Writer(64);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.u8(mode);
      ws.send(w.copy());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      if (r.u8() === S2C.WELCOME) {
        const id = r.u16();
        r.u32();
        r.u32();
        r.u8();
        r.u8();
        resolve({ ws, id, mode: r.u8() });
      }
    };
    ws.onerror = reject;
    setTimeout(() => reject(new Error('no welcome')), 5000);
  });
}

try {
  let list = await get('/rooms');
  check('the main room is listed', list.length === 1 && list[0].id === 'main' && list[0].main);
  const made = await get('/rooms/new?mode=1&name=Deep%20Dive');
  check('a second room can be opened', !!made.id && made.name === 'Deep Dive', JSON.stringify(made));
  list = await get('/rooms');
  check('it is listed as a Zombies room', list.length === 2 && list.find((r) => r.id === made.id)?.mode === 1);
  const a = await join('main', 'Ann', 0);
  const b = await join(made.id, 'Bob', 0); // (asks for survival, but the room was opened for zombies)
  check('the main room plays survival, the opened one zombies, whoever joins', a.mode === 0 && b.mode === 1, `${a.mode} ${b.mode}`);
  await sleep(300);
  list = await get('/rooms');
  check('each room has its own player', list.find((r) => r.id === 'main').players === 1 && list.find((r) => r.id === made.id).players === 1);
  const c = await join(made.id, 'Cy', 1);
  await sleep(300);
  list = await get('/rooms');
  check('others can join an existing game', list.find((r) => r.id === made.id).players === 2 && c.mode === 1);
  const st = await get('/status');
  check('/status is still the main room', st.mode === 0 && st.players === 1);
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
