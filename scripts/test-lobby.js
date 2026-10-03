// DEAD RIDE lobbies against a real server: create, list, join by code, the 5-player cap, ready + start, relay of game
// traffic (to the host, to everyone, to one player), a late joiner, and the host leaving (the next player takes over).
// usage: node scripts/test-lobby.js   (starts its own server on a spare port)
import { spawn } from 'node:child_process';

const PORT = 3500 + Math.floor(Math.random() * 400);
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

function client(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/dr`);
    ws.binaryType = 'arraybuffer';
    const c = { ws, name, msgs: [], bins: [], last: {} };
    c.send = (o) => ws.send(JSON.stringify(o));
    c.bin = (bytes) => ws.send(new Uint8Array(bytes));
    c.wait = async (t, pred = () => true, ms = 3000) => {
      for (let k = 0; k < ms / 20; k++) {
        const m = c.msgs.find((x) => x.t === t && pred(x));
        if (m) {
          c.msgs.splice(c.msgs.indexOf(m), 1);
          return m;
        }
        await sleep(20);
      }
      return null;
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const m = JSON.parse(e.data);
        c.msgs.push(m);
        c.last[m.t] = m;
      } else c.bins.push(new Uint8Array(e.data));
    };
    ws.onopen = () => {
      c.send({ t: 'hello', name });
      resolve(c);
    };
  });
}

try {
  const a = await client('Ann');
  check('hello: welcome with the four maps and a cap of 5', (await a.wait('welcome'))?.maps.length === 4 && a.last.welcome.max === 5);
  a.send({ t: 'create', map: 'whiteout', name: 'Ann team' });
  const ja = await a.wait('joined');
  const code = ja?.code;
  check('a game is created with a code', !!code && /^[A-Z2-9]{4}$/.test(code), code);
  const b = await client('Bob');
  const lst = await b.wait('lobbies', (m) => m.list.length === 1);
  check('a browsing player sees it in the list', lst?.list[0]?.code === code && lst.list[0].map === 'whiteout' && lst.list[0].players === 1);
  b.send({ t: 'join', code });
  await b.wait('joined');
  const lob = await a.wait('lobby', (m) => m.lobby.players.length === 2);
  check('joining by code: both see two players', !!lob && lob.lobby.host === ja.you);
  const more = [];
  for (const n of ['Cy', 'Di', 'Ed']) {
    const x = await client(n);
    x.send({ t: 'join', code });
    await x.wait('joined');
    more.push(x);
  }
  const f = await client('Fay');
  f.send({ t: 'join', code });
  check('the sixth is turned away: 5 is the most', (await f.wait('error'))?.msg === 'That game is full');
  more[2].send({ t: 'leave' }); // (Ed makes room again)
  await sleep(150);
  a.send({ t: 'start' });
  check('the host cannot start before everyone is ready', (await a.wait('error'))?.msg === 'Not everyone is ready');
  for (const x of [b, more[0], more[1]]) x.send({ t: 'ready', v: true });
  await sleep(150);
  a.send({ t: 'start' });
  const st = await b.wait('start');
  check('start: everyone gets the map, the seed, the host and the roster', st?.map === 'whiteout' && st.seed > 0 && st.host === ja.you && st.players.length === 4);
  // relay
  a.bin([255, 7, 8, 9]);
  b.bin([0, 1, 2]);
  await sleep(200);
  const toAll = [b, more[0], more[1]].every((x) => x.bins.some((p) => p[0] === ja.you && p[1] === 7 && p.length === 4));
  check('host -> everyone: the frame arrives with the sender id in front', toAll && !a.bins.some((p) => p[1] === 7));
  check('player -> host only', a.bins.some((p) => p[0] === st.you && p[1] === 1) && !more[0].bins.some((p) => p[1] === 1));
  a.bin([more[1].last.joined.you, 42]);
  await sleep(150);
  check('host -> one player', more[1].bins.some((p) => p[1] === 42) && !more[0].bins.some((p) => p[1] === 42));
  // late joiner
  f.send({ t: 'join', code });
  const late = await f.wait('start');
  check('a late joiner gets the start (marked late) and the host hears about it', late?.late === true && !!(await a.wait('arrived', (m) => m.name === 'Fay')));
  // host leaves
  a.ws.close();
  const h = await b.wait('host');
  check('the host leaves: the longest-standing player takes over', h?.pid === st.you);
  b.bin([255, 5]);
  await sleep(150);
  check('...and its frames go out as the host now', more[0].bins.some((p) => p[0] === st.you && p[1] === 5));
  for (const x of [b, f, ...more]) x.ws.close();
  await sleep(200);
  const s = await (await fetch(`http://localhost:${PORT}/dr/status`)).json();
  check('everyone gone: no lobbies left', s.lobbies === 0, JSON.stringify(s));
} catch (e) {
  check('no error', false, String(e && e.stack));
}
srv.kill();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
process.exit(fails.length ? 1 : 0);
