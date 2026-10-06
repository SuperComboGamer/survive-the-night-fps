// Checks a cluster that is up (several game servers behind the proxy, docs/scaling.md) from outside, through the
// proxy only: games are spread over the servers and every join by code reaches its game, quick joins share one game,
// the lobby lists every server's games and two accounts on two servers are friends who see each other online and
// playing. Which server answered is the proxy's x-stn-server header; x-stn-via asks it for one.
//
//   node scripts/verify-cluster.js https://<proxy domain>
//   node scripts/verify-cluster.js https://<proxy domain> --hold [minutes=10]
//
// --hold: a player stays in a game until its socket is ended as moved (redeploy the game servers or the proxy in the
// meantime), then comes back as the client does, and is checked to be in their own body again. It makes accounts and
// games: not for production.
import { randomUUID } from 'node:crypto';
import { C2S, S2C, ROOMF, PROTOCOL_VERSION, MOVED_CODE, REJECT_REASON, Writer, Reader } from '../shared/protocol.js';
import { PHASE } from '../shared/constants.js';

const BASE = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(BASE)) {
  console.log('usage: node scripts/verify-cluster.js https://<proxy domain> [--hold [minutes]]');
  process.exit(2);
}
const WS = BASE.replace(/^http/, 'ws');
const HOLD = process.argv.includes('--hold');
const HOLD_MIN = Number(process.argv[process.argv.indexOf('--hold') + 1]) || 10;

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  const t = Date.now() + ms;
  while (Date.now() < t) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
};

const api = async (path, { method = 'GET', body, cookie, via } = {}) => {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (via) headers['x-stn-via'] = via;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const set = r.headers.getSetCookie?.() || [];
  return { status: r.status, server: r.headers.get('x-stn-server'), body: await r.json().catch(() => null), cookie: set.map((c) => c.split(';')[0]).join('; ') };
};
// an account of its own: { id, cookie }
const account = async (prefix = 'chk') => {
  const n = `${prefix}${randomUUID().slice(0, 8)}`;
  const r = await api('/api/auth/register', { method: 'POST', body: { email: `${n}@check.example`, username: n, password: 'password123' } });
  if (r.status !== 201) throw new Error(`no account made: ${r.status} ${JSON.stringify(r.body)}`);
  return { id: r.body.user.id, name: n, cookie: r.cookie };
};
// a game made, by an account of its own (a player has one game going at a time, and an address is one player),
// waiting out the allowance of 3 a minute (an address's, on each server) when it is spent
const make = async (body) => {
  const { cookie } = await account();
  const r = await api('/api/games', { method: 'POST', body, cookie });
  if (r.status !== 429) return r;
  console.log('      (made the 3 games a minute an address may on one server: waiting a minute)');
  await sleep(61000);
  return api('/api/games', { method: 'POST', body, cookie });
};

const client = (code = '', { name = 'Bot', pid = '', cookie = '' } = {}) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/ws${code ? `?game=${code}` : ''}`, cookie ? { headers: { cookie } } : undefined);
    ws.binaryType = 'arraybuffer';
    const c = { ws, id: 0, room: null, reject: 0, closed: null };
    c.gone = new Promise((done) => (c.onGone = done));
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
      if (t === S2C.ROOM) c.room = { code: r.str(), name: r.str(), inviteOnly: !!(r.u8() & ROOMF.INVITE_ONLY) };
      else if (t === S2C.WELCOME) {
        c.id = r.u16();
        c.seed = r.u32();
        resolve(c);
      } else if (t === S2C.REJECT) {
        c.reject = r.u8();
        resolve(c);
      }
    };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      c.closed = { code: e.code, reason: e.reason };
      c.onGone(c.closed);
      resolve(c);
    };
  });
// as the client does after MOVED_CODE (main.js moveBack): the same code again for up to 45 s, giving up on 3 NO_GAMEs
async function moveBack(code, opts) {
  let noGame = 0;
  const t = Date.now() + 45000;
  while (Date.now() < t && noGame < 3) {
    const c = await client(code, opts);
    if (c.id) return { c, noGame };
    if (c.reject === REJECT_REASON.NO_GAME) noGame++;
    await sleep(500);
  }
  return { c: null, noGame };
}
const social = (cookie, via) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/social`, { headers: { cookie, 'x-stn-via': via } });
    const s = { ws, heard: [] };
    s.hear = (pred, ms = 10000) => until(() => s.heard.some(pred), ms);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      s.heard.push(msg);
      if (msg.t === 'hello') resolve(s);
    };
    ws.onerror = () => resolve(s);
  });

async function hold() {
  const pid = randomUUID();
  const made = await make({ name: 'Held', inviteOnly: true });
  const code = made.body?.code;
  const player = await client(code, { name: 'Holder', pid });
  check(`a player in game ${code} on ${made.server}`, player.id > 0, JSON.stringify({ made: made.status, reject: player.reject }));
  if (!player.id) return;
  await until(async () => [PHASE.DAY, PHASE.NIGHT].includes((await api(`/api/games/${code}`)).body?.phase), 30000);
  console.log(`      waiting up to ${HOLD_MIN} min for the socket to be ended (redeploy the game servers or the proxy now)`);
  for (let round = 1; ; round++) {
    const gone = await Promise.race([player.gone, sleep(HOLD_MIN * 60000).then(() => null)]);
    if (!gone) {
      if (round === 1) check(`the socket is ended within ${HOLD_MIN} min`, false);
      return;
    }
    const t0 = Date.now();
    check(`move ${round}: the socket is ended as moved`, gone.code === MOVED_CODE, JSON.stringify(gone));
    const back = await moveBack(code, { name: 'Holder', pid });
    const card = await api(`/api/games/${code}`);
    check(`...and the player is back in their own body in ${Date.now() - t0} ms, now on ${card.server}`, back.c?.id === player.id && back.c.seed === player.seed, JSON.stringify({ id: back.c?.id, was: player.id, noGame: back.noGame }));
    if (!back.c?.id) return;
    player.gone = back.c.gone;
  }
}

try {
  const health = await api('/proxy/health');
  check('the proxy is up and sees two servers or more', health.body?.servers >= 2, JSON.stringify(health.body));
  const st = await api('/status');
  const ids = (st.body?.servers || []).filter((s) => !s.draining && !s.error).map((s) => s.id);
  check('/status has every server', ids.length >= 2, JSON.stringify(st.body?.servers));
  if (HOLD) {
    await hold();
  } else {
    // ------------------------------------------------------------ games by code
    // (each joined as soon as it is made: an empty game is closed after a while, and making them can wait out a minute)
    const games = [];
    let joined = 0;
    let cards = 0;
    for (let i = 0; i < 4; i++) {
      const r = await make({ name: `Check ${i}`, inviteOnly: true });
      if (r.status !== 201) continue;
      const g = { code: r.body.code, on: r.server };
      games.push(g);
      for (let k = 0; k < 3; k++) {
        const c = await client(g.code, { name: `P${k}`, pid: randomUUID() });
        if (c.id && c.room?.code === g.code) joined++;
        c.ws.close();
      }
      const card = await api(`/api/games/${g.code}`);
      if (card.status === 200 && card.server === g.on) cards++;
    }
    check('four invite-only games made', games.length === 4, JSON.stringify(games));
    check('...spread over the servers', new Set(games.map((g) => g.on)).size >= 2, JSON.stringify(games));
    check('every join by code reaches its game (12 of 12)', joined === 12, `${joined}/12`);
    check("...and every game's invite card is found, on the server it was made on", cards === 4, `${cards}/4`);
    const owner = await account();
    const one = await api('/api/games', { method: 'POST', body: { name: 'Mine', inviteOnly: true }, cookie: owner.cookie });
    const two = await api('/api/games', { method: 'POST', body: { name: 'Mine too', inviteOnly: true }, cookie: owner.cookie });
    check('a player with a game going cannot make another, on any server, and is told its code', one.status === 201 && two.status === 409 && two.body?.code === one.body?.code, JSON.stringify([one.status, one.server, two.status, two.server, two.body]));
    const nope = await client('ZZZZZZZZZZ');
    check('a code nobody has is no game', nope.reject === REJECT_REASON.NO_GAME, JSON.stringify({ reject: nope.reject, closed: nope.closed }));

    // ------------------------------------------------------------ quick joins and the lobby
    const q = [];
    for (let i = 0; i < 4; i++) q.push(await client('', { name: `Q${i}`, pid: randomUUID() }));
    const qCodes = new Set(q.map((c) => c.room?.code));
    check('four quick joins share one game', q.every((c) => c.id) && qCodes.size === 1, JSON.stringify([...qCodes]));
    const pub = [];
    for (let i = 0; i < 2; i++) pub.push(await make({ name: `Public ${i}` }));
    await sleep(3000);
    const lobby = await api('/api/games');
    const listed = new Set((lobby.body?.list || []).map((g) => g.code));
    const mine = [...pub.map((p) => p.body?.code), [...qCodes][0]];
    const on = await Promise.all(mine.map(async (code) => (await api(`/api/games/${code}`)).server));
    check(
      'the lobby lists the public games of every server',
      mine.every((code) => listed.has(code)) && new Set(on).size >= 2,
      JSON.stringify({ listed: [...listed], mine, on })
    );
    for (const c of q) c.ws.close();

    // ------------------------------------------------------------ friends on two servers
    const [onA, onB] = ids;
    const tag = randomUUID().slice(0, 6);
    const reg = (n) => api('/api/auth/register', { method: 'POST', body: { email: `${n}@check.example`, username: n, password: 'password123' } });
    const ann = await reg(`ann${tag}`);
    const ben = await reg(`ben${tag}`);
    check('two accounts made', ann.status === 201 && ben.status === 201, JSON.stringify([ann.status, ann.body, ben.status, ben.body]));
    const annId = ann.body?.user?.id;
    const benId = ben.body?.user?.id;
    const annSoc = await social(ann.cookie, onA);
    const benSoc = await social(ben.cookie, onB);
    check(`their /social sockets are up (on ${onA} and on ${onB})`, annSoc.heard[0]?.t === 'hello' && benSoc.heard[0]?.t === 'hello');
    await api('/api/friends/request', { method: 'POST', body: { username: `ben${tag}` }, cookie: ann.cookie, via: onA });
    check("Ben hears Ann's request made on the other server", await benSoc.hear((m) => m.t === 'friends' && m.why === 'request' && m.who?.id === annId));
    await api('/api/friends/accept', { method: 'POST', body: { id: annId }, cookie: ben.cookie, via: onB });
    check('Ann hears Ben accept on the other server', await annSoc.hear((m) => m.t === 'friends' && m.why === 'accepted' && m.who?.id === benId));
    const dm = await api('/api/messages', { method: 'POST', body: { to: benId, body: 'over here' }, cookie: ann.cookie, via: onA });
    check('a message is let through', dm.status === 201, JSON.stringify(dm));
    check('...and reaches Ben on the other server', await benSoc.hear((m) => m.t === 'dm' && m.message?.body === 'over here'));
    const seen = await api('/api/friends', { cookie: ben.cookie, via: onB });
    check("Ben's server sees Ann online on hers", seen.body?.friends?.[0]?.status === 'online', JSON.stringify(seen.body?.friends));
    const benPlay = await client('', { name: 'Ben', pid: randomUUID(), cookie: ben.cookie });
    const onAGame = benPlay.room?.code;
    check('Ben, signed in, joins a game', benPlay.id > 0, JSON.stringify({ reject: benPlay.reject }));
    check('Ann hears he is playing', await annSoc.hear((m) => m.why === 'presence' && m.who?.id === benId && m.status === 'playing'));
    const fromB = await api('/api/friends', { cookie: ann.cookie, via: onB });
    const benRow = fromB.body?.friends?.find((f) => f.id === benId);
    check('the other server says Ben is playing, and where', benRow?.status === 'playing' && benRow.game?.code === onAGame, JSON.stringify(benRow));
    const join = await api(`/api/friends/${benId}/game`, { cookie: ann.cookie, via: onB });
    check("...and gives Ann that game's code to join him", join.status === 200 && join.body?.code === onAGame, JSON.stringify(join));
    benPlay.ws.close();
    check('Ann hears he stopped', await annSoc.hear((m) => m.why === 'presence' && m.who?.id === benId && m.status === 'online'));
    await api('/api/auth/logout', { method: 'POST', body: {}, cookie: ann.cookie, via: onB });
    check("signing out on Ben's server closes her /social socket on hers", await until(() => annSoc.ws.readyState === 3, 8000));
    benSoc.ws.close();
  }
} catch (err) {
  failed++;
  console.log('FAIL  threw:', err.stack);
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
