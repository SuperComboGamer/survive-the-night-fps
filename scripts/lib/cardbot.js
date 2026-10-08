// A Dead Hand opponent in node, for scripts/e2e-cards.js (and by hand): joins a game as a player, stands where it lands,
// takes any challenge put to it (with a starter deck; one with a bet, or a trade, it turns down) and plays the match out
// with the computer's moves (shared/cardai.js chooseMove), a moment after each turn comes to it. It says on stdout what
// it heard and did, one line each.
//
//   node scripts/lib/cardbot.js <ws url, e.g. ws://localhost:3000/ws?game=ABCD> [--name Sam] [--secs 300]
//                               [--slot -2] [--level normal] [--once]
// --slot: the deck it answers with (0-3 kept, -1 the Survivors' starter, -2 the Dead's); --once: leave after one match
import { randomUUID } from 'node:crypto';
import { C2S, S2C, CARDOP, CARDMSG, PROTOCOL_VERSION, Writer, Reader, writeCards, readCards } from '../../shared/protocol.js';
import { CHARACTER_NONE } from '../../shared/characters.js';
import { chooseMove } from '../../shared/cardai.js';
import { legalMoves } from '../../shared/cardgame.js';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const URL = argv.find((a) => /^wss?:/.test(a)) || 'ws://localhost:3000/ws';
const NAME = opt('name', 'Sam');
const SECS = +opt('secs', 300);
const SLOT = +opt('slot', -2);
const LEVEL = opt('level', 'normal');
const ONCE = argv.includes('--once');
const THINK = 450; // ms before it moves

const say = (...a) => console.log(`[cardbot ${NAME}]`, ...a);
let seed = 0x5eed;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const ws = new WebSocket(URL);
ws.binaryType = 'arraybuffer';
let me = 0;
let match = null; // { v, view }
let moveT = null;
let sentFor = -1;
const send = (op, data) => {
  const w = new Writer(256);
  w.u8(C2S.CARDS);
  writeCards(w, op, data);
  ws.send(w.bytes());
};

ws.onopen = () => {
  const w = new Writer(128);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(NAME);
  w.str(`cardbot-${randomUUID()}`); // (a browser id of its own: an owner apart from whoever it plays)
  w.u8(CHARACTER_NONE);
  ws.send(w.bytes());
};

// is it the bot's to act now?
function mine(v) {
  if (!v || v.phase === 'over') return false;
  if (v.phase === 'redraw') return !v.redraw.done[v.me];
  if (v.pendingSide >= 0) return v.pendingSide === v.me;
  return v.turn === v.me && !v.passed[v.me];
}

function think() {
  clearTimeout(moveT);
  if (!match?.view || !mine(match.view) || sentFor === match.v) return;
  moveT = setTimeout(() => {
    const v = match?.view;
    if (!v || !mine(v) || sentFor === match.v || !legalMoves(v).length) return;
    const move = chooseMove(v, { rand, level: LEVEL });
    sentFor = match.v;
    send(CARDOP.MOVE, { v: match.v, move });
    say('move', JSON.stringify(move));
  }, THINK);
}

ws.onmessage = (m) => {
  const r = new Reader(m.data);
  const type = r.u8();
  if (type === S2C.WELCOME) {
    me = r.u16();
    say('joined as', me);
    return;
  }
  if (type === S2C.REJECT) {
    say('turned away', r.u8());
    process.exit(2);
  }
  if (type !== S2C.CARDS) return;
  let msg;
  try {
    msg = readCards(r);
  } catch (err) {
    say('a message it could not read', err.message);
    return;
  }
  const { op, data } = msg;
  switch (op) {
    case CARDMSG.ASKS:
      for (const a of data.asks || []) {
        if (a.to !== me) continue;
        const yes = a.kind === 'match' && !a.bet && !match;
        say('asked', a.kind, 'by', a.from, yes ? '- yes' : '- no');
        send(CARDOP.ANSWER, { from: a.from, kind: a.kind, yes, slot: SLOT, bet: 0 });
      }
      break;
    case CARDMSG.MATCH:
      match = { v: data.v, view: data.view };
      if (data.view && data.v !== sentFor) think();
      if (!data.view) say('the match is starting (bets going in)');
      break;
    case CARDMSG.MATCH_END:
      say('match over:', data.outcome, data.reason || '');
      match = null;
      if (ONCE) setTimeout(() => process.exit(0), 1500);
      break;
    case CARDMSG.NOTE:
      say('note', data.code, data.arg ?? '');
      // (a move for a table that moved on: the table comes again, and the move is thought again)
      if (data.code === 'stale' || data.code === 'move') sentFor = -1;
      break;
    case CARDMSG.COLL:
      say('collection', data.loaded ? 'loaded' : 'not loaded', Object.keys(data.found || {}).length, 'kinds found');
      break;
    case CARDMSG.TRADE:
      send(CARDOP.CLOSE, {});
      break;
  }
};
ws.onclose = (e) => {
  say('socket closed', e.code);
  process.exit(0);
};
ws.onerror = () => {};
setTimeout(() => {
  say('time is up');
  try {
    ws.close();
  } catch {}
  process.exit(0);
}, SECS * 1000).unref?.();
