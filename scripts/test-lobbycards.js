// Dead Hand lobby tables (server/lobbycards.js): open, join, play a full no-bet match, cancel, and leave.
import { createHash, randomUUID } from 'node:crypto';
import { LobbyCards } from '../server/lobbycards.js';
import { CardService, MemoryCardStore } from '../server/usercards.js';
import { LoadoutService, MemoryLoadoutStore } from '../server/userloadout.js';
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
const loadouts = new LoadoutService({ store: new MemoryLoadoutStore() });
const rng = mulberry32(33);
const lobby = new LobbyCards({ service, loadouts, rng, log: () => {} });
const ownerOf = (pid) => `g:${createHash('sha256').update(pid).digest('hex')}`;

function clientFor(host, name) {
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
      host.close(c.ws);
    },
    close() {
      host.close(c.ws);
    },
  };
  host.open(c.ws);
  const w = new Writer(128);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(c.pid);
  host.message(c.ws, w.bytes());
  c.send = (op, data = {}) => {
    const w2 = new Writer(512);
    w2.u8(C2S.CARDS);
    writeCards(w2, op, data);
    host.message(c.ws, w2.bytes());
  };
  c.clear = () => {
    c.msgs.length = 0;
    c.notes.length = 0;
    c.ended = null;
  };
  c.me = () => c.last[CARDMSG.TABLES]?.me || 0;
  return c;
}
const client = (name) => clientFor(lobby, name);

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

const E = client('Eve');
const Fp = client('Fox');
await settle();
await loadouts.grant(ownerOf(E.pid), 1, {}, 'lobby:wager:e1');
await loadouts.grant(ownerOf(E.pid), 3, {}, 'lobby:wager:e2');
await loadouts.grant(ownerOf(Fp.pid), 2, {}, 'lobby:wager:f1');
await settle();
const eItems = E.last[CARDMSG.COLL]?.loadouts || [];
const fItems = Fp.last[CARDMSG.COLL]?.loadouts || [];
E.send(CARDOP.TABLE_OPEN, { slot: -1, stake: [eItems[0].id] });
await settle();
const staked = Fp.last[CARDMSG.TABLES].tables.find((x) => x.host === E.me());
check('lobby table advertises host loadout item stake', staked?.stake?.[0]?.catalog === eItems[0].catalog, JSON.stringify(staked));
Fp.send(CARDOP.TABLE_JOIN, { id: staked.id, slot: -2, stake: [fItems[0].id] });
await settle();
check('staked lobby table waits for both stake confirmations', E.last[CARDMSG.MATCH]?.stake?.phase === 'staking' && Fp.last[CARDMSG.MATCH]?.stake?.phase === 'staking');
E.send(CARDOP.STAKE_CONFIRM, { on: true });
E.send(CARDOP.STAKE, { items: [eItems[1].id] });
await settle();
check('changing a lobby stake resets both confirmations', E.last[CARDMSG.MATCH]?.stake?.ok?.every((x) => x === false) && Fp.last[CARDMSG.MATCH]?.stake?.theirs?.[0]?.id === eItems[1].id, JSON.stringify(E.last[CARDMSG.MATCH]?.stake));
E.send(CARDOP.STAKE_CONFIRM, { on: true });
Fp.send(CARDOP.STAKE_CONFIRM, { on: true });
await settle();
check('confirmed lobby stakes are escrowed before the match deals', E.last[CARDMSG.MATCH]?.view?.phase === 'redraw' && !(await loadouts.collection(ownerOf(E.pid))).items.some((it) => it.id === eItems[1].id));
E.ws.close();
await settle();
check('forfeit transfers lobby wagered loadout items to the opponent', Fp.ended?.outcome === 'win' && (await loadouts.collection(ownerOf(Fp.pid))).items.some((it) => it.id === eItems[1].id), JSON.stringify(Fp.ended));

class SlowLockStore extends MemoryLoadoutStore {
  async lockWager(args) {
    await new Promise((resolve) => (this.releaseLock = resolve));
    return super.lockWager(args);
  }
}
{
  const cardSvc = new CardService({ store: new MemoryCardStore() });
  const store = new SlowLockStore();
  const loadSvc = new LoadoutService({ store });
  const L = new LobbyCards({ service: cardSvc, loadouts: loadSvc, rng: mulberry32(44), log: () => {} });
  const G = clientFor(L, 'Gail');
  const H = clientFor(L, 'Hal');
  await settle();
  await loadSvc.grant(ownerOf(G.pid), 1, {}, 'lobby:slow:g');
  await loadSvc.grant(ownerOf(H.pid), 2, {}, 'lobby:slow:h');
  await settle();
  const gi = G.last[CARDMSG.COLL].loadouts[0];
  const hi = H.last[CARDMSG.COLL].loadouts[0];
  G.send(CARDOP.TABLE_OPEN, { slot: -1, stake: [gi.id] });
  await settle();
  H.send(CARDOP.TABLE_JOIN, { id: H.last[CARDMSG.TABLES].tables[0].id, slot: -2, stake: [hi.id] });
  await settle();
  G.send(CARDOP.STAKE_CONFIRM, { on: true });
  H.send(CARDOP.STAKE_CONFIRM, { on: true });
  await settle();
  G.ws.close();
  store.releaseLock();
  await settle();
  check('lobby leave while wager lock is in flight pays the recorded winner and clears locks', store.wagerLocks.size === 0 && (await loadSvc.collection(ownerOf(H.pid))).items.some((it) => it.id === gi.id));
  await L.closeAll();
  await cardSvc.close();
  await loadSvc.close();
}

class FlakyPayoutStore extends MemoryLoadoutStore {
  async settleWager(args) {
    if (args.kind === 'wager_pay' && !this.failedOnce) {
      this.failedOnce = true;
      throw new Error('temporary db failure');
    }
    return super.settleWager(args);
  }
}
{
  const cardSvc = new CardService({ store: new MemoryCardStore() });
  const store = new FlakyPayoutStore();
  const loadSvc = new LoadoutService({ store });
  const L = new LobbyCards({ service: cardSvc, loadouts: loadSvc, rng: mulberry32(45), log: () => {} });
  const I = clientFor(L, 'Ivy');
  const J = clientFor(L, 'Joss');
  await settle();
  await loadSvc.grant(ownerOf(I.pid), 1, {}, 'lobby:retry:i');
  await loadSvc.grant(ownerOf(J.pid), 2, {}, 'lobby:retry:j');
  await settle();
  const ii = I.last[CARDMSG.COLL].loadouts[0];
  const ji = J.last[CARDMSG.COLL].loadouts[0];
  I.send(CARDOP.TABLE_OPEN, { slot: -1, stake: [ii.id] });
  await settle();
  J.send(CARDOP.TABLE_JOIN, { id: J.last[CARDMSG.TABLES].tables[0].id, slot: -2, stake: [ji.id] });
  await settle();
  I.send(CARDOP.STAKE_CONFIRM, { on: true });
  J.send(CARDOP.STAKE_CONFIRM, { on: true });
  await settle();
  I.ws.close();
  await new Promise((r) => setTimeout(r, 700));
  L.tick();
  await settle();
  check('lobby payout retries after a transient store failure', store.failedOnce && store.wagerLocks.size === 0 && (await loadSvc.collection(ownerOf(J.pid))).items.some((it) => it.id === ii.id));
  await L.closeAll();
  await cardSvc.close();
  await loadSvc.close();
}

{
  const cardSvc = new CardService({ store: new MemoryCardStore() });
  const store = new MemoryLoadoutStore();
  const loadSvc = new LoadoutService({ store });
  const L = new LobbyCards({ service: cardSvc, loadouts: loadSvc, rng: mulberry32(46), log: () => {} });
  const K = clientFor(L, 'Kit');
  const M = clientFor(L, 'Moe');
  await settle();
  await loadSvc.grant(ownerOf(K.pid), 1, {}, 'lobby:shutdown:k');
  await loadSvc.grant(ownerOf(M.pid), 2, {}, 'lobby:shutdown:m');
  await settle();
  const ki = K.last[CARDMSG.COLL].loadouts[0];
  const mi = M.last[CARDMSG.COLL].loadouts[0];
  K.send(CARDOP.TABLE_OPEN, { slot: -1, stake: [ki.id] });
  await settle();
  M.send(CARDOP.TABLE_JOIN, { id: M.last[CARDMSG.TABLES].tables[0].id, slot: -2, stake: [mi.id] });
  await settle();
  K.send(CARDOP.STAKE_CONFIRM, { on: true });
  M.send(CARDOP.STAKE_CONFIRM, { on: true });
  await settle();
  await L.closeAll();
  check('lobby shutdown refunds active wager locks', store.wagerLocks.size === 0 && (await loadSvc.collection(ownerOf(K.pid))).items.some((it) => it.id === ki.id) && (await loadSvc.collection(ownerOf(M.pid))).items.some((it) => it.id === mi.id));
  await cardSvc.close();
  await loadSvc.close();
}

await lobby.closeAll();
await service.close();
await loadouts.close();
if (fails.length) {
  console.log(`\n${fails.length} failure(s): ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nLobby Dead Hand tests passed');
