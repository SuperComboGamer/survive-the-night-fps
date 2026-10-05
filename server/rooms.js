// The games on this server and the lobby that lists them. Every game is a game server of its own: a worker thread
// running one Game (room-worker.js), so the games share the box's cores, a valley being generated in one of them
// holds up nobody else, and a game that crashes takes only its own players with it. This side, the network thread,
// owns the sockets and the leaderboard: it routes each socket to its game by the code in its URL, packs their
// traffic into one message per batch each way (wire.js), and answers for the records the games keep (stats.js).
//
// A game is public (in the lobby's list, and where a quick join can put you) or invite-only (unlisted: only its
// link gets you in). Either way its code is the way in. An invite-only game's code is long enough not to be found by
// guessing, and an address that keeps asking for codes that are not there is told every code is not there for a
// while (find).
import { Worker } from 'node:worker_threads';
import { randomInt } from 'node:crypto';
import { availableParallelism, totalmem } from 'node:os';
import { C2S, S2C, ROOMF, REJECT_REASON, Writer, Reader, writeBoard } from '../shared/protocol.js';
import { difficultyOf } from '../shared/difficulty.js';
import { PHASE, MAX_PLAYERS } from '../shared/constants.js';
import { FramePacker, eachFrame } from './wire.js';
import { HANDOFF_CLOSE } from './handoff.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // (no 0 / O, 1 / I: a code gets read out loud)
const PUBLIC_CODE = 6;
const PRIVATE_CODE = 10; // 32^10: about 10^15 codes
export const CODE_RE = /^[A-Z2-9]{6,10}$/;
// An empty game shuts down after this long: long enough for a reload, or for whoever made it to get the link out
// before they join.
const IDLE_MS = 90_000;
const SEND_LIMIT = 256 * 1024; // a socket with this much unsent is backed up: its messages are dropped or held
// Per address: making games (a few in a row, then one a minute) and asking for codes that turn out not to exist.
const CREATE_BURST = 3;
const CREATE_EVERY = 60;
const MISS_BURST = 20;
const MISS_EVERY = 10;

// Games this box runs at once, unless MAX_GAMES says otherwise. Measured with scripts/stress.js (2 Oct 2026): an
// 8-player game at night uses ~17 ms of CPU a second (45 at worst; plan on 50, so ~14 games a core with 30% to
// spare), ~62 MB on a 70 MB base (plan on 80 MB), and the network thread ~0.4 ms a second per player, which puts
// it at half a core around 150 games. Memory runs out first on most boxes, and running out of it kills every game
// at once, so the count goes by the memory the process may use (a container's limit, else the machine's).
export function defaultMaxGames() {
  const mem = process.constrainedMemory?.() || totalmem();
  const byMemory = Math.floor((mem * 0.75 - 150e6) / 80e6);
  return Math.max(4, Math.min(availableParallelism() * 14, byMemory, 150));
}

const cleanTitle = (v, max) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} _\-.'!?&#]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

// A rate allowance: n is how much was used lately, wearing off by one every `every` seconds.
function allow(map, key, burst, every) {
  const now = Date.now() / 1000;
  let a = map.get(key);
  if (!a) map.set(key, (a = { n: 0, t: now, every }));
  a.n = Math.max(0, a.n - (now - a.t) / every);
  a.t = now;
  if (a.n + 1 > burst) return false;
  a.n++;
  return true;
}
// how much of it is in use right now (without using any)
function used(map, key, every) {
  const a = map.get(key);
  return a ? Math.max(0, a.n - (Date.now() / 1000 - a.t) / every) : 0;
}
const forgetSpent = (map) => {
  const now = Date.now() / 1000;
  for (const [k, a] of map) if (now - a.t >= a.n * a.every) map.delete(k);
};

export class Room {
  // restore: the game the last server saved under this code (handoff.js), with first / created / continues from what
  // that server knew of the room (Room.meta)
  constructor(lobby, { code, name, host, inviteOnly, maxPlayers, quick, difficulty, restore = null, first = '', created = Date.now(), continues = null }) {
    this.lobby = lobby;
    this.code = code;
    this.name = name; // as its maker called it ('' for one a quick join made)
    this.host = host; // who made it ('' for a quick join's: then whoever has been in it longest)
    this.first = first; // the name the first socket in it joined under (a quick join's game is theirs until it has a lead)
    this.inviteOnly = inviteOnly;
    this.quick = quick;
    this.difficulty = difficultyOf(difficulty).id; // Ember, Nightfall or Blackout (a quick join, and a save from before this, is Nightfall)
    this.maxPlayers = maxPlayers;
    this.created = created;
    this.emptySince = Date.now(); // (a restored game nobody comes back to closes as any empty one does)
    this.continues = continues; // the match the last server ended as 'handoff', which this game's next one carries on (matchstore.js)
    this.closed = false;
    this.ready = false;
    // sockets by slot. A slot whose socket closed stays taken until the worker says it is done with it (so nothing
    // still on its way out for the old socket can reach a new one): hence twice as many as the game has seats
    this.socks = new Array(maxPlayers * 2 + 2).fill(null);
    this.draining = new Uint8Array(this.socks.length);
    // per slot: the account its socket is signed in to ({ id, name, isAdmin }, null for a guest: index.js found it by the
    // session cookie), and the name its player joined under ('' before the JOIN)
    this.users = new Array(this.socks.length).fill(null);
    this.names = new Array(this.socks.length).fill('');
    this.match = null; // the id of the match being played in it, while one is (matchstore.js)
    this.open = 0; // live sockets (a seat each, joined or about to)
    this.inbox = new FramePacker();
    this.congestion = new SharedArrayBuffer(4 * this.socks.length);
    this.congested = new Int32Array(this.congestion);
    this.recs = new Map(); // the game's record tokens -> records (RemoteRecords in room-worker.js)
    this.st = { players: 0, held: 0, lead: '', phase: PHASE.WAITING, day: 0, seed: 0, tick: null, load: { cpuMs: 0, elu: 0 }, heapMb: 0 };
    this.saved = null; // (handoff: waiting for the worker's save)

    this.worker = new Worker(new URL('./room-worker.js', import.meta.url), {
      // (analytics: the game records its matches - only worth it with a database to write them to. achievements and the
      // bestiary: an account's go to the database too, and a guest's to their browser either way)
      workerData: { code, opts: { ...lobby.gameOpts, maxPlayers, inviteOnly, difficulty: this.difficulty, analytics: !!lobby.matches, achievements: !!lobby.achievements, bestiary: !!lobby.bestiary }, congestion: this.congestion, restore },
      resourceLimits: { maxOldGenerationSizeMb: 512 }, // a game that runs away with memory ends, not the server
    });
    this.worker.on('message', (m) => this.fromWorker(m));
    this.worker.on('error', (err) => lobby.log(`game ${code} crashed:`, err));
    this.worker.on('exit', (exitCode) => {
      if (!this.closed) lobby.log(`game ${code} stopped (exit ${exitCode})`);
      this.shut(1011, 'Game ended');
    });
  }

  get title() {
    if (this.name) return this.name;
    const who = this.host || this.st.lead || this.first;
    return who ? `${who}'s game` : 'Open game';
  }
  // every socket a seat: no more can come in (attach)
  get full() {
    return this.open >= this.maxPlayers;
  }
  // ...or the seats left are kept for players who dropped, or who were brought over from the last server: no room for a
  // newcomer (a quick join, the lobby's list). Their own sockets still come in: the game knows them (Game.handleJoin)
  get noRoom() {
    return this.full || this.open + (this.st.held || 0) >= this.maxPlayers;
  }

  // what the lobby shows of it (its code included: list() only hands out public games', find() only to whoever has it)
  info() {
    const s = this.st;
    return { code: this.code, name: this.title, players: Math.max(s.players, 0), seats: this.open, max: this.maxPlayers, full: this.noRoom, phase: s.phase, day: s.day, seed: s.seed, inviteOnly: this.inviteOnly, difficulty: this.difficulty, ready: this.ready, ageS: Math.round((Date.now() - this.created) / 1000) };
  }

  // ---------------------------------------------------------------- sockets
  // A seat for this socket: its slot, or -1 when the game is full.
  attach(ws) {
    if (this.closed || this.full) return -1;
    const slot = this.socks.findIndex((s, i) => !s && !this.draining[i]);
    if (slot < 0) return -1;
    this.flushInbox(); // (in order with whatever is still on its way in)
    this.socks[slot] = ws;
    Atomics.store(this.congested, slot, 0);
    this.open++;
    this.emptySince = 0;
    const d = ws.getUserData();
    const user = d.user ? { id: d.user.id, name: d.user.name, isAdmin: d.user.isAdmin === true } : null;
    this.users[slot] = user;
    if (user) this.lobby.userIn(user.id, this);
    this.worker.postMessage({ t: 'open', slot, ip: d.ip, user });
    return slot;
  }

  // code: the socket's close code (LEFT_CODE: the player left on purpose; anything else is a drop the game holds them through)
  detach(slot, code = 0) {
    if (this.socks[slot] === null) return;
    this.socks[slot] = null;
    const user = this.users[slot];
    this.users[slot] = null;
    this.names[slot] = '';
    if (user) this.lobby.userOut(user.id, this);
    this.open--;
    if (!this.open) this.emptySince = Date.now();
    if (this.closed) return;
    this.flushInbox(); // everything they sent goes in before they leave
    this.draining[slot] = 1;
    this.worker.postMessage({ t: 'close', slot, code });
  }

  // a message from a socket, for the game (copied: uWS reuses the buffer). first: it is the socket's first
  deliver(slot, bytes, first = false) {
    if (this.closed) return;
    if (first) this.greet(slot, bytes);
    this.inbox.push(slot, bytes);
    this.lobby.queueFlush(this);
  }

  // Tells a socket which game it is in, before the game answers its first message (its JOIN): a quick join learns
  // its code here, for its invite link. The game's first player names a quick join's game. (A signed-in player
  // plays under their account's name, as Game.handleJoin has it.)
  greet(slot, bytes) {
    if (bytes[0] === C2S.JOIN) {
      try {
        const r = new Reader(bytes);
        r.u8();
        r.u8();
        const name = this.users[slot]?.name || cleanTitle(r.str(), 16);
        if (!this.first) this.first = name;
        this.names[slot] = name || 'Survivor';
      } catch {}
    }
    const w = new Writer(128);
    w.u8(S2C.ROOM);
    w.str(this.code);
    w.str(this.title);
    w.u8(this.inviteOnly ? ROOMF.INVITE_ONLY : 0);
    w.str(this.difficulty); // after the flags, so a client from before difficulties never reads it
    this.socks[slot]?.send(w.bytes(), true, false);
  }
  flushInbox() {
    if (this.inbox.empty || this.closed) return;
    const buf = this.inbox.take();
    this.worker.postMessage({ t: 'in', buf }, [buf]);
  }

  // the game's messages for its sockets: each socket's run of them corked into one write
  sendOut(buf) {
    let ws = null;
    let at = -1;
    const runs = [];
    eachFrame(buf, (slot, bytes) => {
      if (slot !== at) {
        at = slot;
        ws = this.socks[slot];
        if (ws) runs.push(ws, slot, []);
      }
      if (ws) runs[runs.length - 1].push(bytes);
    });
    for (let i = 0; i < runs.length; i += 3) {
      const sock = runs[i];
      const slot = runs[i + 1];
      const msgs = runs[i + 2];
      sock.cork(() => {
        for (const bytes of msgs) {
          // a badly backed-up client loses messages rather than the server's memory growing without end (the game
          // holds its snapshots back meanwhile: congested)
          if (sock.getBufferedAmount() > SEND_LIMIT) break;
          sock.send(bytes, true, false);
        }
      });
      if (sock.getBufferedAmount() > SEND_LIMIT) Atomics.store(this.congested, slot, 1);
    }
  }
  // uWS: a socket's backlog went out
  drained(slot) {
    const ws = this.socks[slot];
    if (ws && ws.getBufferedAmount() <= SEND_LIMIT) Atomics.store(this.congested, slot, 0);
  }

  // ---------------------------------------------------------------- the worker
  fromWorker(m) {
    switch (m.t) {
      case 'out':
        return this.sendOut(m.buf);
      case 'closed':
        this.draining[m.slot] = 0;
        return;
      case 'kick':
        this.socks[m.slot]?.end(4000, 'Never joined');
        return;
      case 'status': {
        const { t, ...st } = m;
        this.st = st;
        return;
      }
      case 'ready':
        this.ready = true;
        this.st.seed = m.seed;
        return;
      case 'rec':
        return this.record(m);
      case 'board':
        return this.board(m);
      case 'an':
        return this.lobby.matches?.push(m.rec, this);
      case 'ach':
        return this.lobby.achievements?.add(m.user, m.add, m.feats, m.strangers, this);
      case 'seen':
        return this.lobby.bestiary?.add(m.user, m.mask);
      case 'finished':
        this.finished?.();
        return;
      case 'saved':
      case 'saveFailed':
        this.saved?.(m);
        return;
      case 'restoreFailed':
        this.lobby.log(`game ${this.code} not restored: ${m.why}`);
        return;
    }
  }

  // an account's achievements unlocked (userachievements.js): the game tells its player
  achieved(userId, ids) {
    if (!this.closed && ids.length) this.worker.postMessage({ t: 'achieved', user: userId, ids });
  }

  record(m) {
    const stats = this.lobby.stats;
    if (m.op === 'enter') {
      const rec = stats.enter(m.id, m.name, m.user || '');
      this.recs.set(m.tok, rec);
      // what they have earned before (progress.js): their level, and the perks they picked - the database's in a moment
      if (rec && stats.progress) {
        Promise.resolve(stats.progress(rec)).then(
          (p) => p && !this.closed && this.recs.get(m.tok) === rec && this.worker.postMessage({ t: 'progress', tok: m.tok, first: true, ...p }),
          (err) => this.lobby.log(`progress of a player could not be read (${err.message})`)
        );
      }
      if (m.user) this.lobby.achievements?.played(m.user, this); // (another day played on, if it is one)
      // the kinds of the dead the account has seen: read once, here, and held by the game from then on
      if (m.user && this.lobby.bestiary) {
        this.lobby.bestiary.load(m.user).then(
          (mask) => !this.closed && this.recs.get(m.tok) === rec && this.worker.postMessage({ t: 'bestiary', tok: m.tok, mask }),
          (err) => this.lobby.log(`bestiary of a player could not be read (${err.message})`)
        );
      }
    } else if (m.op === 'leave') {
      stats.leave(this.recs.get(m.tok));
      this.recs.delete(m.tok);
    } else if (m.op === 'bump') stats.bump(this.recs.get(m.tok), m.stat, m.n);
    else if (m.op === 'best') stats.best?.(this.recs.get(m.tok), m.day);
  }

  // a player's picks changed (/api/progress/pick): whoever plays on that record in this game gets them
  progressChanged(key, perks) {
    if (this.closed) return;
    for (const [tok, rec] of this.recs) if (rec && rec.key === key) this.worker.postMessage({ t: 'progress', tok, perks });
  }

  board(m) {
    const ws = this.socks[m.slot];
    if (!ws) return;
    const here = new Set();
    for (const tok of m.here) {
      const r = this.recs.get(tok);
      if (r) here.add(r);
    }
    const send = ({ total, rows }) => {
      if (this.socks[m.slot] !== ws) return; // (gone while the database was asked)
      const w = new Writer(1024);
      w.u8(S2C.BOARD);
      writeBoard(w, total, rows);
      if (ws.getBufferedAmount() <= SEND_LIMIT) ws.send(w.bytes(), true, false);
    };
    // the file-kept board answers at once, the database's (dbstats.js) in a moment
    const board = this.lobby.stats.board(this.recs.get(m.me) ?? null, here);
    if (typeof board?.then === 'function') board.then(send, (err) => this.lobby.log(`board failed (${err.message})`));
    else send(board);
  }

  // Ends the match being played now, as a server going down does (Lobby.finishAll): the worker writes what it has of
  // it and says when it has. -> a promise, done then or after `ms` regardless
  finish(ms = 1500) {
    if (this.closed || !this.match) return Promise.resolve();
    return new Promise((done) => {
      const t = setTimeout(done, ms);
      this.finished = () => {
        clearTimeout(t);
        this.finished = null;
        done();
      };
      this.worker.postMessage({ t: 'finish' });
    });
  }

  // What the next server needs of this room besides the game (Lobby.restore). match: the one being played as it was
  // saved, which the next server's carries on.
  meta(match) {
    return { name: this.name, host: this.host, first: this.first, inviteOnly: this.inviteOnly, quick: this.quick, maxPlayers: this.maxPlayers, difficulty: this.difficulty, created: this.created, match };
  }

  // The server is going down and the next one takes this game over: the worker stops and saves it, the save goes into
  // the store, and only then is every socket closed with HANDOFF_CLOSE (a client that came back sooner would find
  // nothing to come back to). -> { bytes, ms } once it is handed over, or why it was not (a string): then nothing has
  // been closed, and the match is still the caller's to end.
  handoff(store, ms = 8000) {
    if (this.closed) return Promise.resolve('closed');
    if (!this.st.players) return Promise.resolve('nobody in it');
    const match = this.match;
    const t0 = Date.now();
    return new Promise((done) => {
      const timer = setTimeout(() => {
        this.saved = null;
        done(`no save from the game after ${ms} ms`);
      }, ms);
      this.saved = async (m) => {
        clearTimeout(timer);
        this.saved = null;
        if (m.t === 'saveFailed') return done(`the save failed (${m.error.split('\n')[0]})`);
        try {
          await store.put(this.code, this.meta(match), new Uint8Array(m.buf));
        } catch (err) {
          return done(`the store would not take it (${err.message})`);
        }
        this.shut(HANDOFF_CLOSE, 'Server updating', { handedOff: true });
        done({ bytes: m.buf.byteLength, ms: Date.now() - t0 });
      };
      this.worker.postMessage({ t: 'save' });
    });
  }

  // Ends the game: the worker goes, every socket is closed, and the records it had open are let go. handedOff: the
  // next server has the game, and its match (ended as 'handoff' by the worker) goes on there.
  shut(code = 1001, why = 'Game closed', { handedOff = false } = {}) {
    if (this.closed) return;
    this.closed = true;
    this.lobby.rooms.delete(this.code);
    this.worker.terminate().catch(() => {});
    for (let i = 0; i < this.socks.length; i++) {
      const ws = this.socks[i];
      if (!ws) continue;
      this.socks[i] = null;
      ws.getUserData().room = null;
      try {
        ws.end(code, why);
      } catch {}
    }
    this.open = 0;
    for (let i = 0; i < this.users.length; i++) {
      if (this.users[i]) this.lobby.userOut(this.users[i].id, this);
      this.users[i] = null;
    }
    for (const rec of this.recs.values()) this.lobby.stats.leave(rec);
    this.recs.clear();
    // a match it was in the middle of stops where it was
    if (this.match && !handedOff) this.lobby.matches?.interrupt(this.match);
    this.match = null;
  }
}

export class Lobby {
  // stats: the leaderboard (PlayerStats, or DbStats with a database). matches: where the matches played go
  // (MatchStore; none without a database). achievements: the accounts' (AchievementStore; none without a database).
  // bestiary: the kinds of the dead each account has seen (BestiaryStore; none without a database).
  // gameOpts: what every Game is made with (the env's test switches)
  // limits: false lifts the per-address allowances (load tests make many games from one address). store: where games
  // are handed from one server to the next on a deploy (handoff.js; none: a deploy ends them), and how old a save may
  // be and still be restored (s)
  constructor({ stats, matches = null, achievements = null, bestiary = null, gameOpts = {}, maxGames = defaultMaxGames(), maxPlayers = MAX_PLAYERS, roomMaxPlayers = MAX_PLAYERS, limits = true, idleMs = IDLE_MS, store = null, handoffMaxAge = 300, log = console.log }) {
    this.stats = stats;
    this.matches = matches;
    this.achievements = achievements;
    this.bestiary = bestiary;
    this.store = store;
    this.handoffMaxAge = handoffMaxAge;
    this.restoring = new Map(); // code -> the restore under way (restore)
    this.stopping = false; // going down: nothing more is restored here
    this.playing = new Map(); // account id -> Map(room -> its sockets in it): where the signed-in are playing
    this.onPresence = null; // (account id) => void: they came into a game or left one (social.js)
    this.gameOpts = gameOpts;
    this.maxGames = maxGames;
    this.maxPlayers = maxPlayers; // seats in a game nobody chose the size of (a quick join's)
    this.roomMaxPlayers = Math.max(maxPlayers, roomMaxPlayers); // the most a game can be made with
    this.log = log;
    this.limits = limits;
    this.idleMs = idleMs;
    this.rooms = new Map(); // code -> Room
    this.creates = new Map(); // address -> its allowance of games made
    this.misses = new Map(); // address -> its allowance of codes asked for that were not there
    this.toFlush = new Set();
    this.flushQueued = false;
    this.flushAll = () => {
      this.flushQueued = false;
      for (const room of this.toFlush) room.flushInbox();
      this.toFlush.clear();
    };
    setInterval(() => this.reap(), Math.min(5000, idleMs / 2)).unref();
  }

  queueFlush(room) {
    this.toFlush.add(room);
    if (!this.flushQueued) {
      this.flushQueued = true;
      setImmediate(this.flushAll);
    }
  }

  newCode(len) {
    for (;;) {
      let code = '';
      for (let i = 0; i < len; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  // A new game: { room } or { error, status } (HTTP status). ip: whoever asked, for the allowance (none: no limit)
  create({ name = '', host = '', inviteOnly = false, maxPlayers = this.maxPlayers, difficulty, quick = false } = {}, ip = '') {
    if (this.rooms.size >= this.maxGames) return { error: 'Every game server is busy right now. Join a game that is already running, or try again in a minute.', status: 503 };
    if (ip && this.limits && !allow(this.creates, ip, CREATE_BURST, CREATE_EVERY)) return { error: 'You have made several games just now. Wait a minute before making another.', status: 429 };
    const seats = Math.max(1, Math.min(this.roomMaxPlayers, Math.floor(+maxPlayers) || this.maxPlayers));
    const room = new Room(this, {
      code: this.newCode(inviteOnly ? PRIVATE_CODE : PUBLIC_CODE),
      name: cleanTitle(name, 28),
      host: cleanTitle(host, 16),
      inviteOnly: !!inviteOnly,
      maxPlayers: seats,
      difficulty,
      quick,
    });
    this.rooms.set(room.code, room);
    this.log(`game ${room.code} made: ${room.inviteOnly ? 'invite only' : 'public'}, ${seats} seats, ${room.difficulty}${room.quick ? ' (quick join)' : ''} (${this.rooms.size}/${this.maxGames} games)`);
    return { room };
  }

  // The game with this code, or null. An address asking for one code after another that is not there is told
  // none of them is there for a while, the real ones included: guessing codes gets nowhere.
  find(code, ip = '') {
    code = String(code || '').toUpperCase();
    const room = CODE_RE.test(code) ? this.rooms.get(code) : null;
    const blocked = this.limits && used(this.misses, ip, MISS_EVERY) + 1 > MISS_BURST;
    if (room && !room.closed && !blocked) return room;
    if (ip && this.limits) allow(this.misses, ip, MISS_BURST, MISS_EVERY);
    return null;
  }

  // Where a quick join goes: the public game with the most people in it that still has a seat (a game that is
  // just ending comes last), or a new one.
  quick() {
    let best = null;
    let bestKey = -1;
    for (const room of this.rooms.values()) {
      if (room.inviteOnly || room.closed || room.noRoom) continue;
      const ending = room.st.phase === PHASE.GAMEOVER || room.st.phase === PHASE.VICTORY;
      const key = (ending ? 0 : 1000) + room.open;
      if (key > bestKey) {
        best = room;
        bestKey = key;
      }
    }
    return best || this.create({ quick: true }).room || null;
  }

  // the public games, the busiest first
  list() {
    const out = [];
    for (const room of this.rooms.values()) if (!room.inviteOnly && !room.closed) out.push(room.info());
    out.sort((a, b) => b.seats - a.seats || a.ageS - b.ageS);
    return out;
  }

  // Shuts the games that have been empty too long, and forgets allowances that have worn off.
  reap() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.open || !room.emptySince || now - room.emptySince < this.idleMs) continue;
      this.log(`game ${room.code} closed: empty for ${Math.round((now - room.emptySince) / 1000)} s`);
      room.shut();
    }
    forgetSpent(this.creates);
    forgetSpent(this.misses);
  }

  players() {
    let n = 0;
    for (const room of this.rooms.values()) n += room.st.players;
    return n;
  }

  // the record filed under `key` has these picks now (server/progress.js): every game it is being played in hears
  progressChanged(key, perks) {
    for (const room of this.rooms.values()) room.progressChanged(key, perks);
  }

  // ---------------------------------------------------------------- where the signed-in are playing
  // An account's socket came into a game, or went from one (Room.attach / detach). Its friends hear of it (social.js)
  userIn(userId, room) {
    let rooms = this.playing.get(userId);
    if (!rooms) this.playing.set(userId, (rooms = new Map()));
    rooms.set(room, (rooms.get(room) || 0) + 1);
    this.onPresence?.(userId);
    // a friend in here already: Better Together, for both
    const others = new Set();
    for (const u of room.users) if (u && u.id !== userId) others.add(u.id);
    if (others.size) this.achievements?.together(userId, [...others], room);
  }
  userOut(userId, room) {
    const rooms = this.playing.get(userId);
    const n = rooms?.get(room);
    if (!n) return;
    if (n > 1) rooms.set(room, n - 1);
    else rooms.delete(room);
    if (!rooms.size) this.playing.delete(userId);
    this.onPresence?.(userId);
  }

  // The game an account is playing in (the one it came into last, if it is in two), or null. Friends are told it
  // in full, its code included, to join them by - an invite-only game's too: friends only (social.js)
  playingRoom(userId) {
    const rooms = this.playing.get(userId);
    if (!rooms) return null;
    let last = null;
    for (const room of rooms.keys()) if (!room.closed) last = room;
    return last;
  }

  // The server is going down (a deploy): every match being played is ended as it stands and written (Room.finish)
  finishAll(ms = 1500) {
    return Promise.all([...this.rooms.values()].map((room) => room.finish(ms)));
  }

  // ---------------------------------------------------------------- deploys (handoff.js)
  // The server is going down and the next one is up: every game with anybody in it is saved into the store for that
  // one to carry on with, all at once. One that cannot be (it did not answer in time, the store failed) has its match
  // ended as before (Room.finish) and stays here to go down with the process. -> how many were handed over
  async handoffAll(store, ms = 8000) {
    this.stopping = true;
    const done = await Promise.all(
      [...this.rooms.values()].map(async (room) => {
        const players = room.st.players;
        const r = await room.handoff(store, ms);
        if (typeof r === 'object') {
          this.log(`handoff ${room.code}: ${players} players, ${(r.bytes / 1024).toFixed(0)} KB, ${r.ms} ms`);
          return true;
        }
        if (players) this.log(`handoff ${room.code}: not handed over - ${r}`);
        await room.finish(1500);
        return false;
      })
    );
    return done.filter(Boolean).length;
  }

  // The game the last server saved under this code, if one is waiting in the store: claimed (so no other server takes
  // it too) and started here under the same code, with the room as it was. -> the Room, or null (no save, it was
  // taken, it is too old). Asked when the store says a save has come (index.js), at start-up for any already
  // waiting, and by a socket or an invite card asking for a code this server does not have yet. A save this build
  // cannot read is only found out in the room's worker: that room closes again (Room 'restoreFailed').
  restore(code) {
    code = String(code || '').toUpperCase();
    if (this.rooms.has(code)) return Promise.resolve(this.rooms.get(code));
    if (!this.store || this.stopping || !CODE_RE.test(code)) return Promise.resolve(null);
    let p = this.restoring.get(code);
    if (!p) {
      p = this._restore(code).finally(() => this.restoring.delete(code));
      this.restoring.set(code, p);
    }
    return p;
  }
  async _restore(code) {
    let row;
    try {
      row = await this.store.claim(code);
    } catch (err) {
      this.log(`game ${code} not restored: the store failed (${err.message})`);
      return null;
    }
    if (!row) return null;
    const age = (Date.now() - row.savedAt) / 1000;
    if (age > this.handoffMaxAge) {
      this.log(`game ${code} not restored: saved ${Math.round(age)} s ago`);
      return null;
    }
    if (this.rooms.has(code)) {
      this.log(`game ${code} not restored: a game here has that code`);
      return this.rooms.get(code);
    }
    const m = row.meta || {};
    const room = new Room(this, {
      code,
      name: cleanTitle(m.name, 28),
      host: cleanTitle(m.host, 16),
      inviteOnly: !!m.inviteOnly,
      maxPlayers: Math.max(1, Math.min(this.roomMaxPlayers, Math.floor(+m.maxPlayers) || this.maxPlayers)),
      difficulty: m.difficulty, // absent on a save from before difficulties: the room treats that as Nightfall
      quick: !!m.quick,
      first: cleanTitle(m.first, 16),
      created: Number.isFinite(m.created) ? m.created : Date.now(),
      continues: typeof m.match === 'string' ? m.match : null,
      restore: row.body,
    });
    this.rooms.set(code, room);
    this.log(`game ${code} restored from the last server (saved ${age.toFixed(1)} s ago, ${(row.body.byteLength / 1024).toFixed(0)} KB) (${this.rooms.size}/${this.maxGames} games)`);
    return room;
  }
}

// What a socket that cannot have a seat is sent before it is closed: the REJECT the client shows (connection.js)
export function rejectBytes(reason = REJECT_REASON.FULL) {
  return Uint8Array.of(S2C.REJECT, reason);
}
