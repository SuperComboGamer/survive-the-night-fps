// Dead Hand lobby tables (server/lobbycards.js): open, join, play a full no-bet match, cancel, and leave.
import { randomUUID } from 'node:crypto';
import { LobbyCards } from '../server/lobbycards.js';
import { CardService, MemoryCardStore } from '../server/usercards.js';
import { C2S, S2C, CARDOP, CARDMSG, PROTOCOL_VERSION, Writer, Reader, writeCards, readCards } from '../shared/protocol.js';
import { chooseMove } from '../shared/cardai.js';
import { mulberry32 } from '../shared/rng.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` ${info}`}`);
  if (!ok) fails.push(name);
};
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};

const service = new CardService({ store: new MemoryCardStore() });
const rng = mulberry32(33);
const lobby = new LobbyCards({ service, rng, log: () => {} });

function client(name) {
  const c = { name, pid: randomUUID(), msgs: [], last: {}, notes: [], ended: null, sentV: -1 };
  c.ws = {
    data: { user: null },
    sent: [],
    getUserData() {
      return this.data;
    },
    getBufferedAmount() {
      return 0;
    },
    send(bytes) {
      this.sent.push(bytes);
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t !== S2C.CARDS) return;
      const m = readCards(r);
      c.msgs.push([m.op, m.data]);
      c.last[m.op] = m.data;
      if (m.op === CARDMSG.NOTE) c.notes.push(m.data.code);
      if (m.op === CARDMSG.MATCH_END) c.ended = m.data;
    },
    end() {
      lobby.close(c.ws);
    },
    close() {
      lobby.close(c.ws);
    },
  };
  lobby.open(c.ws);
  const w = new Writer(128);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(c.pid);
  lobby.message(c.ws, w.bytes());
  c.send = (op, data = {}) => {
    const w2 = new Writer(512);
    w2.u8(C2S.CARDS);
    writeCards(w2, op, data);
    lobby.message(c.ws, w2.bytes());
  };
  c.clear = () => {
    c.msgs.length = 0;
    c.notes.length = 0;
    c.ended = null;
  };
  c.me = () => c.last[CARDMSG.TABLES]?.me || 0;
  return c;
}

const A = client('Ann');
const B = client('Ben');
await settle();
check('lobby card clients receive collection, decks and table list', A.last[CARDMSG.COLL]?.loaded === true && Array.isArray(A.last[CARDMSG.DECKS]?.decks) && Array.isArray(A.last[CARDMSG.TABLES]?.tables));

A.send(CARDOP.TABLE_OPEN, { slot: -1 });
await settle();
const open = B.last[CARDMSG.TABLES]?.tables?.[0];
check('opening a lobby table broadcasts it to other lobby clients', open?.host === A.me() && open.name === 'Ann' && open.slot === -1, JSON.stringify(B.last[CARDMSG.TABLES]));

B.send(CARDOP.TABLE_JOIN, { id: open.id, slot: -2 });
await settle();
check('joining a table removes it from the list', !A.last[CARDMSG.TABLES]?.tables?.length && !B.last[CARDMSG.TABLES]?.tables?.length);
check('joining starts a match for both players', A.last[CARDMSG.MATCH]?.view?.phase === 'redraw' && B.last[CARDMSG.MATCH]?.view?.phase === 'redraw' && A.last[CARDMSG.MATCH].opp === B.me() && B.last[CARDMSG.MATCH].opp === A.me());

const playOut = async (cs, max = 3000) => {
  for (let step = 0; step < max; step++) {
    if (cs.every((c) => c.ended)) return true;
    for (const c of cs) {
      const m = c.last[CARDMSG.MATCH];
      const v = m?.view;
      if (!v || v.phase === 'over' || c.sentV === m.v || c.ended) continue;
      const mine = v.phase === 'redraw' ? !v.redraw.done[v.me] : v.pendingSide >= 0 ? v.pendingSide === v.me : v.turn === v.me && !v.passed[v.me];
      if (!mine) continue;
      const mv = chooseMove(v, { rand: rng });
      if (!mv) continue;
      c.sentV = m.v;
      c.send(CARDOP.MOVE, { v: m.v, move: mv });
      await settle();
    }
  }
  return false;
};
const over = await playOut([A, B]);
check('two lobby clients can play a full Dead Hand match to the end', over && ['win', 'loss', 'draw'].includes(A.ended?.outcome) && ['win', 'loss', 'draw'].includes(B.ended?.outcome), JSON.stringify([A.ended, B.ended]));

const C = client('Cy');
const D = client('Dee');
await settle();
C.send(CARDOP.TABLE_OPEN, { slot: -1 });
await settle();
check('a second lobby table can be opened after a match ends', D.last[CARDMSG.TABLES]?.tables?.some((t) => t.host === C.me()));
C.send(CARDOP.TABLE_LEAVE, {});
await settle();
check('an open lobby table can be cancelled', !(D.last[CARDMSG.TABLES]?.tables || []).some((t) => t.host === C.me()));

C.send(CARDOP.TABLE_OPEN, { slot: -1 });
await settle();
const t = D.last[CARDMSG.TABLES].tables.find((x) => x.host === C.me());
D.send(CARDOP.TABLE_JOIN, { id: t.id, slot: -2 });
await settle();
C.ws.close();
await settle();
check('leaving a live lobby match forfeits it for the remaining player', D.ended?.outcome === 'win' && D.ended.reason === 'forfeit', JSON.stringify(D.ended));

lobby.closeAll();
await service.close();
if (fails.length) {
  console.log(`\n${fails.length} failure(s): ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nLobby Dead Hand tests passed');
