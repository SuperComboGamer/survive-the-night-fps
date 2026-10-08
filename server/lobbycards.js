// Dead Hand in the lobby: a small host in the network thread for no-bet 1v1 tables that do not belong to a run.
// It reuses the shared rules engine and the same CardService collection/deck storage as in-run matches.
import { randomBytes, randomUUID } from 'node:crypto';
import { C2S, S2C, CARDOP, CARDMSG, CARDNOTE, CARD_JSON_MAX, PROTOCOL_VERSION, Writer, Reader, readCards, writeCards } from '../shared/protocol.js';
import { cardDef, cleanFound, defaultDeck, F, validateDeck, DECK_SLOTS } from '../shared/cards.js';
import * as CG from '../shared/cardgame.js';
import { cleanMove } from './cards.js';
import { idKey } from './stats.js';

const cryptoRand = () => randomBytes(4).readUInt32LE(0) / 0x100000000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOW_BURST = 20;
const ALLOW_EVERY = 0.2;
const EVENTS_MAX = 200;
const NAME_MAX = 16;
const TABLE_MAX = 64;
const STARTER_SLOTS = new Map([
  [-1, F.SURVIVORS],
  [-2, F.DEAD],
]);

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const LOADOUT_ITEM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAKE_MAX = 12;
const cleanName = (v) =>
  String(v || '')
    .replace(/[^\p{L}\p{N} _\-.'!?&#]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX) || 'Survivor';

function allow(st, now, burst = ALLOW_BURST, every = ALLOW_EVERY) {
  st.allow.n = Math.max(0, st.allow.n - (now - st.allow.t) / every);
  st.allow.t = now;
  if (st.allow.n + 1 > burst) return false;
  st.allow.n++;
  return true;
}

function cleanStakeItems(d) {
  const raw = Array.isArray(d?.stake) ? d.stake : Array.isArray(d?.items) ? d.items : [];
  if (raw.length > STAKE_MAX) return null;
  const out = [];
  const seen = new Set();
  for (const id of raw) {
    if (typeof id !== 'string' || !LOADOUT_ITEM_RE.test(id) || seen.has(id)) return null;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export class LobbyCards {
  constructor({ service, loadouts = null, log = () => {}, rng = cryptoRand } = {}) {
    this.service = service;
    this.loadouts = loadouts;
    this.log = log;
    this.rng = rng;
    this.w = new Writer(4096);
    this.nextId = 1;
    this.players = new Map(); // id -> player
    this.bySocket = new Map(); // ws -> player
    this.tables = new Map(); // id -> { id, host, slot, deck, at }
    this.matches = new Map(); // id -> match
    this.pending = new Map();
    this.room = { closed: false, code: 'lobby-cards', worker: { postMessage: (m) => queueMicrotask(() => !this.room.closed && this.fromStore(m)) } };
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), 250);
    this.timer.unref?.();
  }

  ownerOf(user, pid) {
    if (user?.id) return `a:${String(user.id).toLowerCase()}`;
    return UUID_RE.test(String(pid || '')) ? `g:${idKey(pid)}` : '';
  }

  open(ws) {
    // The first binary message is the JOIN; until then the socket is not a lobby-card player.
    ws.getUserData().cardsJoined = false;
  }

  close(ws) {
    const p = this.bySocket.get(ws);
    if (!p) return;
    this.leaveTable(p, 'left');
    if (p.owner) {
      this.service.fromRoom(this.room, { t: 'cards', op: 'leave', owner: p.owner });
      this.loadouts?.fromRoom(this.room, { t: 'loadout', op: 'leave', owner: p.owner });
    }
    this.bySocket.delete(ws);
    this.players.delete(p.id);
    this.broadcastTables();
  }

  message(ws, bytes) {
    const d = ws.getUserData();
    try {
      const r = new Reader(bytes);
      const type = r.u8();
      if (!d.cardsJoined) {
        if (type !== C2S.JOIN) return ws.end(1008, 'Join first');
        return this.join(ws, r);
      }
      const p = this.bySocket.get(ws);
      if (!p || type !== C2S.CARDS || !allow(p, Date.now() / 1000)) return;
      const msg = readCards(r, CARD_JSON_MAX);
      this.onCards(p, msg.op, msg.data);
    } catch (err) {
      this.log(`lobby cards: message failed (${err.message})`);
    }
  }

  join(ws, r) {
    const d = ws.getUserData();
    const version = r.u8();
    if (version !== PROTOCOL_VERSION) return ws.end(1008, 'Wrong version');
    const name = d.user?.name || cleanName(r.str());
    const pid = r.left ? r.str() : '';
    const p = {
      id: this.nextId++,
      ws,
      name,
      owner: this.ownerOf(d.user, pid),
      found: {},
      decks: [],
      loaded: false,
      loadouts: [],
      loadoutsLoaded: !this.loadouts,
      events: [],
      allow: { n: 0, t: Date.now() / 1000 },
    };
    d.cardsJoined = true;
    this.players.set(p.id, p);
    this.bySocket.set(ws, p);
    if (p.owner) {
      this.service.fromRoom(this.room, { t: 'cards', op: 'enter', owner: p.owner });
      this.loadouts?.fromRoom(this.room, { t: 'loadout', op: 'enter', owner: p.owner });
    }
    else {
      p.loaded = true;
      this.write(p, CARDMSG.COLL, this.collFor(p));
      this.write(p, CARDMSG.DECKS, { decks: [] });
    }
    this.sendTables(p);
  }

  onCards(p, op, d) {
    switch (op) {
      case CARDOP.TABLE_OPEN:
        return this.openTable(p, d);
      case CARDOP.TABLE_JOIN:
        return this.joinTable(p, d);
      case CARDOP.TABLE_LEAVE:
        return this.leaveTable(p, 'cancelled');
      case CARDOP.STAKE:
        return this.stake(p, d);
      case CARDOP.STAKE_CONFIRM:
        return this.stakeConfirm(p, d);
      case CARDOP.MOVE:
        return this.move(p, d);
      case CARDOP.FORFEIT:
        return this.forfeit(p);
      case CARDOP.DECK:
        return this.saveDeck(p, d);
      case CARDOP.SYNC:
        this.write(p, CARDMSG.COLL, this.collFor(p));
        this.write(p, CARDMSG.DECKS, { decks: p.owner ? p.decks : [] });
        this.sendTables(p);
        return;
    }
  }

  note(p, code, arg = '') {
    this.write(p, CARDMSG.NOTE, { code, arg });
  }

  busy(p) {
    return !!this.tableOf(p) || !!this.matchOf(p);
  }

  tableOf(p) {
    for (const t of this.tables.values()) if (t.host === p.id) return t;
    return null;
  }

  matchOf(p) {
    for (const m of this.matches.values()) if (m.sides.some((s) => s.pid === p.id)) return m;
    return null;
  }

  present(side) {
    const p = this.players.get(side.pid);
    return p && p.owner === side.owner && p.name === side.name ? p : null;
  }

  deckFor(p, slot) {
    if (slot === undefined || slot === null) slot = -1;
    if (STARTER_SLOTS.has(slot)) return { deck: defaultDeck(STARTER_SLOTS.get(slot)) };
    if (!int(slot, 0, DECK_SLOTS - 1)) return { error: CARDNOTE.DECK, arg: 'slot' };
    if (!p.owner) return { error: CARDNOTE.NOKEY };
    if (!p.loaded) return { error: CARDNOTE.LOADING };
    const kept = p.decks.find((dk) => dk.slot === slot);
    if (!kept) return { error: CARDNOTE.DECK, arg: 'empty' };
    const deck = { leader: kept.leader, cards: { ...kept.cards } };
    const v = validateDeck(deck, p.found);
    return v.ok ? { deck } : { error: CARDNOTE.DECK, arg: String(v.errors?.[0] || 'invalid') };
  }

  deckStillValid(p, deck) {
    return validateDeck(deck, p.owner ? p.found : {}).ok;
  }

  reservedLoadouts(except = null) {
    const r = new Set();
    for (const m of this.matches.values()) {
      if (m === except || !['staking', 'locking'].includes(m.phase)) continue;
      for (const s of m.sides) for (const id of s.stake || []) r.add(id);
    }
    for (const t of this.tables.values()) {
      if (t === except) continue;
      for (const id of t.stake || []) r.add(id);
    }
    return r;
  }

  stakeFor(p, raw, except = null) {
    const items = cleanStakeItems({ items: raw });
    if (!items) return { error: CARDNOTE.LOADOUT };
    if (!items.length) return { items };
    if (!p.owner) return { error: CARDNOTE.NOKEY };
    if (!p.loadoutsLoaded) return { error: CARDNOTE.LOADING };
    const reserved = this.reservedLoadouts(except);
    const owned = new Set((p.loadouts || []).map((it) => it.id));
    for (const id of items) if (!owned.has(id) || reserved.has(id)) return { error: CARDNOTE.LOADOUT };
    return { items };
  }

  stakeView(ids, p) {
    const byId = new Map((p?.loadouts || []).map((it) => [it.id, it]));
    return (ids || []).map((id) => {
      const it = byId.get(id);
      return it ? { id: it.id, catalog: it.catalog } : { id, catalog: 0 };
    });
  }

  openTable(p, d) {
    if (this.busy(p)) return this.note(p, CARDNOTE.BUSY);
    if (this.tables.size >= TABLE_MAX) return this.note(p, CARDNOTE.LIMIT);
    const dk = this.deckFor(p, d.slot ?? -1);
    if (dk.error) return this.note(p, dk.error, dk.arg);
    const stake = this.stakeFor(p, d.stake || d.items || []);
    if (stake.error) return this.note(p, stake.error);
    const id = randomUUID();
    this.tables.set(id, { id, host: p.id, slot: d.slot ?? -1, deck: dk.deck, stake: stake.items, at: Date.now() });
    this.broadcastTables();
  }

  joinTable(p, d) {
    if (this.busy(p)) return this.note(p, CARDNOTE.BUSY);
    const id = typeof d.id === 'string' ? d.id : '';
    const t = this.tables.get(id);
    const host = t ? this.players.get(t.host) : null;
    if (!t || !host) return this.note(p, CARDNOTE.GONE);
    if (host === p) return this.note(p, CARDNOTE.OWNER);
    if (p.owner && p.owner === host.owner) return this.note(p, CARDNOTE.OWNER);
    const mine = this.deckFor(p, d.slot ?? -1);
    if (mine.error) return this.note(p, mine.error, mine.arg);
    const myStake = this.stakeFor(p, d.stake || d.items || [], t);
    if (myStake.error) return this.note(p, myStake.error);
    const theirStake = this.stakeFor(host, t.stake || [], t);
    if (theirStake.error) {
      this.tables.delete(id);
      this.note(host, theirStake.error);
      this.note(p, CARDNOTE.GONE);
      return this.broadcastTables();
    }
    if (!this.deckStillValid(host, t.deck)) {
      this.tables.delete(id);
      this.note(host, CARDNOTE.DECK);
      this.note(p, CARDNOTE.GONE);
      return this.broadcastTables();
    }
    this.tables.delete(id);
    this.startMatch(host, p, [t.deck, mine.deck], [theirStake.items, myStake.items]);
    this.broadcastTables();
  }

  startMatch(a, b, decks, stakes = [[], []]) {
    const id = randomUUID();
    const sides = [a, b].map((p, i) => ({ pid: p.id, owner: p.owner || '', name: p.name, bet: 0, stake: [...(stakes[i] || [])], stakeInfo: this.stakeView(stakes[i] || [], p), ok: false }));
    const hasStake = stakes.some((s) => s?.length);
    const seed = Math.floor(this.rng() * 0x100000000) >>> 0;
    const m = {
      id,
      sides,
      state: hasStake ? null : CG.newMatch({ seed, decks }),
      phase: hasStake ? 'staking' : 'live',
      ver: hasStake ? 0 : 1,
      seed,
      decks,
      locks: null,
      pays: null,
      reason: '',
    };
    if (!hasStake) m.decks = null;
    this.matches.set(id, m);
    for (const p of [a, b]) p.events.length = 0;
    this.sendMatch(m);
  }

  leaveTable(p, reason = 'cancelled') {
    const t = this.tableOf(p);
    if (t) {
      this.tables.delete(t.id);
      this.broadcastTables();
      return true;
    }
    const m = this.matchOf(p);
    if (!m) return false;
    this.forfeit(p, reason);
    return true;
  }

  changed(m, events) {
    m.ver++;
    m.sides.forEach((s, side) => {
      const p = this.present(s);
      if (!p) return;
      const mine = events?.length ? CG.eventsFor(events, side) : [];
      if (p.events.length + mine.length > EVENTS_MAX) p.events.length = 0;
      else p.events.push(...mine);
    });
    this.sendMatch(m);
  }

  stake(p, d) {
    const m = this.matchOf(p);
    if (!m || m.phase !== 'staking') return this.note(p, CARDNOTE.NOMATCH);
    const side = m.sides.findIndex((s) => s.pid === p.id);
    const st = this.stakeFor(p, d.items || d.stake || [], m);
    if (st.error) return this.note(p, st.error);
    m.sides[side].stake = st.items;
    m.sides[side].stakeInfo = this.stakeView(st.items, p);
    for (const s of m.sides) s.ok = false;
    this.sendMatch(m);
  }

  stakeConfirm(p, d) {
    const m = this.matchOf(p);
    if (!m || m.phase !== 'staking') return this.note(p, CARDNOTE.NOMATCH);
    const side = m.sides.findIndex((s) => s.pid === p.id);
    const st = this.stakeFor(p, m.sides[side].stake || [], m);
    if (st.error) return this.note(p, st.error);
    m.sides[side].ok = d.on !== false;
    this.sendMatch(m);
    if (m.sides.every((s) => s.ok)) this.lockMatch(m);
  }

  lockMatch(m) {
    const moves = m.sides.flatMap((s) => (s.stake || []).map((id) => [s.owner, id]));
    if (!moves.length) return this.go(m);
    m.phase = 'locking';
    m.locks = { loadouts: false };
    this.sendMatch(m);
    this.xfer(`${m.id}:loadout_wager_lock`, 'wager_lock', moves, m.id);
  }

  go(m) {
    m.state = CG.newMatch({ seed: m.seed, decks: m.decks });
    m.decks = null;
    m.phase = 'live';
    m.ver = 1;
    this.sendMatch(m);
  }

  move(p, d) {
    const m = this.matchOf(p);
    if (!m || m.phase !== 'live') return this.note(p, CARDNOTE.NOMATCH);
    const side = m.sides.findIndex((s) => s.pid === p.id);
    if (d.v !== m.ver) {
      this.write(p, CARDMSG.MATCH, this.matchMsg(m, side, p));
      return this.note(p, CARDNOTE.STALE);
    }
    const move = cleanMove(d.move);
    if (!move) return this.note(p, CARDNOTE.MOVE, 'bad');
    const r = CG.applyMove(m.state, side, move);
    if (!r.ok) {
      this.write(p, CARDMSG.MATCH, this.matchMsg(m, side, p));
      return this.note(p, CARDNOTE.MOVE, String(r.error || 'refused').slice(0, 60));
    }
    this.changed(m, r.events);
    if (m.state.phase === 'over') this.finish(m);
  }

  forfeit(p, reason = '') {
    const m = this.matchOf(p);
    if (!m) return this.note(p, CARDNOTE.NOMATCH);
    if (m.phase === 'staking') {
      m.reason = reason || 'forfeit';
      return this.finish(m);
    }
    if (m.phase === 'locking') {
      const side = m.sides.findIndex((s) => s.pid === p.id);
      m.reason = reason || 'forfeit';
      m.forfeitWinner = side === 0 ? 1 : 0;
      return;
    }
    const side = m.sides.findIndex((s) => s.pid === p.id);
    const r = CG.applyMove(m.state, side, { t: 'forfeit' });
    if (r.ok) this.changed(m, r.events);
    if (reason && m.state.phase !== 'over') m.reason = reason;
    this.finish(m);
  }

  finish(m) {
    if (!this.matches.has(m.id)) return;
    if (m.phase === 'paying') return;
    const winner = m.state?.result?.winner ?? -1;
    const reason = m.reason || m.state?.result?.reason || '';
    const hasStake = m.sides.some((s) => (s.stake || []).length);
    if (hasStake && m.phase !== 'staking') {
      m.phase = 'paying';
      return winner === 0 || winner === 1 ? this.pay(m, winner) : this.refund(m, reason || 'draw');
    }
    this.finishPaid(m, true);
  }

  pay(m, winner) {
    m.phase = 'paying';
    const moves = [];
    for (let i = 0; i < 2; i++) for (const item of m.sides[i].stake || []) moves.push([m.sides[i].owner, m.sides[winner].owner, item]);
    if (!moves.length) return this.finishPaid(m, true);
    this.xfer(`${m.id}:loadout_wager_pay`, 'wager_pay', moves, m.id);
  }

  refund(m, reason = 'server') {
    if (!this.matches.has(m.id)) return;
    m.reason ||= reason;
    const moves = [];
    for (let i = 0; i < 2; i++) for (const item of m.sides[i].stake || []) moves.push([m.sides[i].owner, m.sides[i].owner, item]);
    if (!moves.length || m.phase === 'staking') return this.finishPaid(m, true);
    m.phase = 'paying';
    this.xfer(`${m.id}:loadout_wager_back`, 'wager_back', moves, m.id);
  }

  finishPaid(m, paid) {
    if (!this.matches.has(m.id)) return;
    this.matches.delete(m.id);
    const winner = m.state?.result?.winner ?? -1;
    const reason = m.reason || m.state?.result?.reason || '';
    m.sides.forEach((s, side) => {
      const p = this.present(s);
      if (!p) return;
      if (m.state) this.write(p, CARDMSG.MATCH, this.matchMsg(m, side, p));
      const outcome = winner === side ? 'win' : winner === 1 - side ? 'loss' : 'draw';
      this.write(p, CARDMSG.MATCH_END, { opp: m.sides[1 - side].pid, oppName: m.sides[1 - side].name, outcome, reason, bet: null, stake: this.stakeEnd(m, side, paid) });
    });
  }

  applyLoadoutWager(match, moves) {
    // Lobby players have no in-run copies to remove; this mirrors the in-run callback shape.
  }

  saveDeck(p, d) {
    if (!p.owner) return this.note(p, CARDNOTE.NOKEY);
    this.service.fromRoom(this.room, { t: 'cards', op: 'deck', owner: p.owner, deck: d });
  }

  tick() {
    const now = Date.now();
    const dt = Math.max(0, Math.min(1, (now - this.lastTick) / 1000));
    this.lastTick = now;
    for (const m of [...this.matches.values()]) {
      if (m.phase !== 'live') continue;
      const ev = CG.tick(m.state, dt, [false, false]);
      if (ev?.length) this.changed(m, ev);
      if (m.state.phase === 'over') this.finish(m);
    }
  }

  xfer(id, kind, moves, ref) {
    this.pending.set(id, { id, kind, moves, ref });
    this.loadouts?.fromRoom(this.room, { t: 'loadout', op: 'xfer', id, kind, match: ref, moves });
  }

  fromStore(m) {
    try {
      if (m.t === 'loadout') return this.fromLoadoutStore(m);
      if (m.op !== 'coll') return;
      for (const p of this.players.values()) {
        if (p.owner !== m.owner) continue;
        p.loaded = m.ok === true;
        if (p.loaded) {
          p.found = cleanFound(Object.fromEntries(Array.isArray(m.found) ? m.found : []));
          p.decks = Array.isArray(m.decks) ? m.decks : [];
        }
        this.write(p, CARDMSG.COLL, this.collFor(p));
        this.write(p, CARDMSG.DECKS, { decks: p.decks });
      }
    } catch (err) {
      this.log(`lobby cards: store message failed (${err.message})`);
    }
  }

  fromLoadoutStore(m) {
    if (m.op === 'coll') {
      for (const p of this.players.values()) {
        if (p.owner !== m.owner) continue;
        p.loadoutsLoaded = m.ok === true;
        p.loadouts = p.loadoutsLoaded && Array.isArray(m.items) ? m.items : [];
        this.write(p, CARDMSG.COLL, this.collFor(p));
        const match = this.matchOf(p);
        if (match) this.write(p, CARDMSG.MATCH, this.matchMsg(match, match.sides.findIndex((s) => s.pid === p.id), p));
      }
      return;
    }
    if (m.op !== 'xfered') return;
    const x = this.pending.get(m.id);
    if (!x) return;
    this.pending.delete(m.id);
    const match = this.matches.get(x.ref);
    if (!match) return;
    if (x.kind === 'wager_lock') {
      if (m.ok) {
        if (match.forfeitWinner === 0 || match.forfeitWinner === 1) return this.pay(match, match.forfeitWinner);
        return match.phase === 'locking' ? this.go(match) : null;
      }
      match.reason = m.why === 'not_owned' ? 'not_owned' : 'store';
      for (const s of match.sides) this.note(this.present(s), m.why === 'not_owned' ? CARDNOTE.LOADOUT : CARDNOTE.STORE);
      return this.finish(match);
    }
    if (m.ok) {
      if (x.kind === 'wager_pay') this.applyLoadoutWager(match, x.moves);
      return this.finishPaid(match, true);
    }
    this.finishPaid(match, false);
  }

  collFor(p) {
    return { loaded: p.owner ? !!p.loaded : true, kept: !!p.owner, found: p.owner ? { ...p.found } : {}, loadouts: p.loadoutsLoaded ? this.stakeView((p.loadouts || []).map((it) => it.id), p) : [] };
  }

  matchMsg(m, side, p) {
    return { me: side, opp: m.sides[1 - side].pid, oppName: m.sides[1 - side].name, v: m.ver, bet: [0, 0], stake: this.stakeMsg(m, side, p), view: m.state ? CG.viewFor(m.state, side) : null, events: p.events.splice(0) };
  }

  stakeMsg(m, side, p) {
    const me = m.sides[side];
    const them = m.sides[1 - side];
    return {
      phase: m.phase === 'staking' ? 'staking' : m.phase === 'locking' ? 'locking' : '',
      mine: me.stakeInfo || this.stakeView(me.stake || [], p),
      theirs: them.stakeInfo || this.stakeView(them.stake || [], this.present(them)),
      loadouts: this.stakeView((p.loadouts || []).map((it) => it.id), p),
      ok: [!!me.ok, !!them.ok],
    };
  }

  stakeEnd(m, side, paid) {
    const me = m.sides[side];
    const them = m.sides[1 - side];
    return { mine: me.stakeInfo || [], theirs: them.stakeInfo || [], paid };
  }

  sendMatch(m) {
    m.sides.forEach((s, side) => {
      const p = this.present(s);
      if (p) this.write(p, CARDMSG.MATCH, this.matchMsg(m, side, p));
    });
  }

  tablesMsg(me = 0) {
    const now = Date.now();
    const tables = [...this.tables.values()]
      .map((t) => {
        const p = this.players.get(t.host);
        return p ? { id: t.id, host: p.id, name: p.name, slot: t.slot, stake: this.stakeView(t.stake || [], p), ageS: Math.max(0, Math.round((now - t.at) / 1000)) } : null;
      })
      .filter(Boolean);
    const names = [...this.players.values()].map((p) => [p.id, p.name]);
    return { me, tables, names };
  }

  sendTables(p) {
    this.write(p, CARDMSG.TABLES, this.tablesMsg(p.id));
  }

  broadcastTables() {
    const msg = this.tablesMsg(0);
    for (const p of this.players.values()) this.write(p, CARDMSG.TABLES, { ...msg, me: p.id });
  }

  write(p, op, data) {
    if (!p?.ws || p.ws.getBufferedAmount?.() > 256 * 1024) return;
    const w = this.w.reset();
    w.u8(S2C.CARDS);
    writeCards(w, op, data);
    p.ws.send(w.bytes(), true, false);
  }

  closeAll() {
    clearInterval(this.timer);
    for (const m of [...this.matches.values()]) this.refund(m, 'server');
    for (const p of [...this.players.values()]) {
      if (p.owner) {
        this.service.fromRoom(this.room, { t: 'cards', op: 'leave', owner: p.owner });
        this.loadouts?.fromRoom(this.room, { t: 'loadout', op: 'leave', owner: p.owner });
      }
      try {
        p.ws.close?.();
      } catch {}
    }
    this.room.closed = true;
    this.players.clear();
    this.bySocket.clear();
    this.tables.clear();
    this.matches.clear();
  }
}
