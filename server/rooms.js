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
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomInt } from 'node:crypto';
import { availableParallelism, totalmem } from 'node:os';
import * as OWN_PROTOCOL from '../shared/protocol.js';
import { S2C, REJECT_REASON, ENDED_CODE, MOVED_CODE, PROTOCOL_VERSION } from '../shared/protocol.js';
import { difficultyOf } from '../shared/difficulty.js';
import { PHASE, MAX_PLAYERS } from '../shared/constants.js';
import { FramePacker, eachFrame } from './wire.js';
import { HANDOFF_CLOSE } from './handoff.js';

// A WebSocket close frame's reason is at most 123 bytes of UTF-8: what fits of `text`, cut between two characters
export function closeReason(text, max = 120) {
  let out = String(text || '');
  while (Buffer.byteLength(out) > max) out = out.slice(0, -1);
  return out;
}

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
const BUSY = { error: 'Every game server is busy right now. Join a game that is already running, or try again in a minute.', status: 503 };
const yours = (code) => ({ error: `You already have a game going (${code}). Join it, or wait for it to end before making another.`, status: 409, code });
const MISS_BURST = 20;
const MISS_EVERY = 10;
// How long, and of how many games at most, it is remembered that a deploy ended them (Lobby.ended)
const LOST_MS = 30 * 60_000;
const LOST_MAX = 2000;
const WORKER_LIMITS = { maxOldGenerationSizeMb: 512 }; // a game that runs away with memory ends, not the server
// A game carried on by an older build (builds.js) for this long is closed at its next dawn, or when its run ends, so that
// a build's bugs - a fix the new one brings - do not outlive it by more than that. HANDOFF_PIN_MAX_HOURS
const PIN_MAX_HOURS = +(process.env.HANDOFF_PIN_MAX_HOURS ?? 12);
const HELD_MS = +(process.env.HANDOFF_RESERVE_SECONDS || 180) * 1000; // (gamestate.js HANDOFF_RESERVE: how long a player brought over is held)
const PIN_RUN_OVER_MS = 90_000; // (a run over on an older build: its end screen stays up this long, then the game closes)
// A worker prepared for a game the last server announced (Lobby.prepare) that no save came for in this long goes
const PREPARED_MS = 30_000;
// A server going down waits this long at most for its own build to be packed and in the store (Lobby.handoffAll):
// past it the games are saved anyway (naming the build if it is packed by then), well inside HARD_EXIT_MS
const KEEP_MS = 2000;

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
  // that server knew of the room (Room.meta). prepared: a worker that has built the game's valley already, waiting for
  // the save (Lobby.prepare). from: that save as it was claimed ({ meta, body }), kept until the game is up. pin: the
  // build whose code runs this game instead of this server's ({ id, dir, client, since }: builds.js), because this
  // server's could not read its save
  constructor(lobby, { code, name, host, inviteOnly, maxPlayers, quick, difficulty, maker = '', restore = null, first = '', created = Date.now(), continues = null, prepared = null, from = null, pin = null }) {
    this.lobby = lobby;
    this.code = code;
    this.name = name; // as its maker called it ('' for one a quick join made)
    this.host = host; // who made it ('' for a quick join's: then whoever has been in it longest)
    this.maker = maker; // ...as the lobby knows them, for their one game at a time: u:<account id> or ip:<address> ('' for a quick join's)
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
    // (a prepared worker's was made for the most seats a game can have: at least as many slots as this one's)
    this.congestion = prepared && prepared.congestion.byteLength >= 4 * this.socks.length ? prepared.congestion : new SharedArrayBuffer(4 * this.socks.length);
    this.congested = new Int32Array(this.congestion);
    this.recs = new Map(); // the game's record tokens -> records (RemoteRecords in room-worker.js)
    this.st = { players: 0, held: 0, lead: '', phase: PHASE.WAITING, day: 0, seed: 0, tick: null, load: { cpuMs: 0, elu: 0 }, heapMb: 0 };
    this.saved = null; // (handoff: waiting for the worker's save)
    this.movingTo = null; // (handoff: the server it is being handed to, cluster.js)
    this.up = null; // (cluster.js: its row being written, which a new game's maker waits for)
    this.asks = new Map(); // the admin panel's questions the worker has not answered yet: id -> { done, fail, timer } (ask)
    this.askN = 0;
    this.restored = restore ? Date.now() : 0; // (when its save was claimed, for the log)
    this.from = from; // the save as it was claimed ({ meta, body }), kept until the game is up (handoff)
    this.pin = pin;
    // What this thread writes to the players itself (ROOM, BOARD, REJECT, the close codes) is in their client's codec:
    // an older build's, from that build's own shared/protocol.js, for a game it carries on (builds.js protocolOf)
    this.proto = pin?.proto || OWN_PROTOCOL;
    this.failed = 0; // why its save could not be used here (a REJECT_REASON), once the worker has said so
    this.after = false; // (Lobby.afterFailed has been through it)
    this.pinEnd = 0; // (a game on an older build: when it closes - pinCheck)
    this.started = new Promise((done) => (this.onStarted = done)); // (up, or closed without ever being: Lobby.settle)

    // (analytics: the game records its matches - only worth it with a database to write them to. achievements and the
    // bestiary: an account's go to the database too, and a guest's to their browser either way)
    const opts = { ...lobby.gameOpts, maxPlayers, inviteOnly, difficulty: this.difficulty, analytics: !!lobby.matches, achievements: !!lobby.achievements, bestiary: !!lobby.bestiary };
    this.builtAhead = !pin && !!prepared && this.congestion === prepared.congestion;
    if (this.builtAhead) {
      this.worker = prepared.worker;
      this.worker.postMessage({ t: 'start', opts, restore });
    } else {
      prepared?.worker.terminate().catch(() => {});
      // (an older build's worker: its own code, from where builds.js unpacked it)
      const url = pin ? pathToFileURL(join(pin.dir, 'server', 'room-worker.js')) : new URL('./room-worker.js', import.meta.url);
      this.worker = new Worker(url, { workerData: { code, opts, congestion: this.congestion, restore }, resourceLimits: WORKER_LIMITS });
    }
    this.worker.on('message', (m) => this.fromWorker(m));
    this.worker.on('error', (err) => {
      if (this.failed) return; // (its save could not be used, and it has said so)
      lobby.log(`game ${code} crashed:`, err);
      lobby.onIncident?.({ code, kind: 'crashed', text: String(err?.message || err).slice(0, 200) });
    });
    this.worker.on('exit', (exitCode) => {
      if (!this.closed && !this.failed) {
        lobby.log(`game ${code} stopped (exit ${exitCode})`);
        lobby.onIncident?.({ code, kind: 'stopped', text: `its thread ended by itself (exit ${exitCode}) with ${this.open} connected` });
      }
      this.shut(1011, 'Game ended');
      this.onStarted();
      if (this.failed) lobby.afterFailed(this);
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
  // (in the players' own codec, this.proto; should an older build's codec throw on it after all, in this build's - a
  // message the page may misread, never a network thread that throws)
  greet(slot, bytes) {
    try {
      this.greetIn(this.proto, slot, bytes);
    } catch (err) {
      if (this.proto === OWN_PROTOCOL) throw err;
      this.lobby.log(`game ${this.code}: its build's codec failed to write ROOM (${err.message}): written in this build's`);
      this.greetIn(OWN_PROTOCOL, slot, bytes);
    }
  }
  greetIn(proto, slot, bytes) {
    const { C2S, S2C, ROOMF, Writer, Reader } = proto;
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
        // (with a code: an admin removed its player - gameadmin.js)
        this.socks[m.slot]?.end(m.code || 4000, closeReason(m.why || 'Never joined'));
        return;
      case 'admin': {
        const a = this.asks.get(m.id);
        if (!a) return; // (answered too late: ask gave up on it)
        this.asks.delete(m.id);
        clearTimeout(a.timer);
        const { t, id, ...answer } = m;
        a.done(answer);
        return;
      }
      case 'status': {
        const { t, ...st } = m;
        const was = this.st;
        this.st = st;
        if (this.pin) this.pinCheck(was, st);
        return;
      }
      case 'ready':
        this.ready = true;
        this.from = null; // (the game runs here now: its save is this server's to make)
        this.st.seed = m.seed;
        if (this.restored) this.lobby.log(`game ${this.code} up in ${Date.now() - this.restored} ms${this.pin ? ` (on build ${this.pin.id})` : ''}`);
        this.onStarted(); // (since its save was claimed: what a deploy's players wait for, docs/deploys.md)
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
        this.failed = m.world ? REJECT_REASON.ENDED_MAP : REJECT_REASON.ENDED_UPDATE;
        // (the build that saved it may still carry it on: Lobby.afterFailed, once this worker has gone - which it does
        // now. Whoever comes for the code meanwhile waits for that: restore)
        if (this.lobby.canPin(this)) this.lobby.log(`game ${this.code} cannot be carried on by this build (${m.why}): build ${this.from.meta.build} will`);
        else {
          this.lobby.log(`game ${this.code} not restored${this.pin ? ` by build ${this.pin.id} either` : ''}: ${m.why}`);
          this.lobby.onIncident?.({ code: this.code, kind: 'not restored', text: String(m.why).slice(0, 200) });
          this.lobby.ended(this.code, this.failed);
        }
        if (this.closed) this.lobby.afterFailed(this);
        else this.worker.terminate().catch(() => {});
        return;
    }
  }

  // The admin panel asks something of the game (gameadmin.js: op and what it needs, already checked by adminpanel.js).
  // -> its answer, { ok, ... } or { ok: false, error }; a game that does not answer in `ms` (a thread that hangs) is an
  // answer too. Never throws, never waits longer.
  ask(op, args = {}, ms = 3000) {
    if (this.closed) return Promise.resolve({ ok: false, error: 'That game has ended.' });
    return new Promise((done) => {
      const id = ++this.askN;
      const timer = setTimeout(() => {
        this.asks.delete(id);
        done({ ok: false, error: 'The game did not answer in time.', timeout: true });
      }, ms);
      this.asks.set(id, { done, timer });
      try {
        this.worker.postMessage({ ...args, t: 'admin', id, op });
      } catch (err) {
        clearTimeout(timer);
        this.asks.delete(id);
        done({ ok: false, error: `The game could not be asked (${err.message}).` });
      }
    });
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
    const write = (proto, total, rows) => {
      const { Writer, S2C, writeBoard } = proto;
      const w = new Writer(1024);
      w.u8(S2C.BOARD);
      writeBoard(w, total, rows);
      return w.bytes();
    };
    const send = ({ total, rows }) => {
      if (this.socks[m.slot] !== ws) return; // (gone while the database was asked)
      let bytes;
      try {
        bytes = write(this.proto, total, rows);
      } catch (err) {
        if (this.proto === OWN_PROTOCOL) throw err;
        this.lobby.log(`game ${this.code}: its build's codec failed to write BOARD (${err.message}): written in this build's`);
        bytes = write(OWN_PROTOCOL, total, rows);
      }
      if (ws.getBufferedAmount() <= SEND_LIMIT) ws.send(bytes, true, false);
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
  // build: the code this game runs on (builds.js) - this server's, or the older build's that carries it on here, with
  // since when it has been (pinnedAt)
  meta(match) {
    const build = this.pin?.id || this.lobby.builds?.id || undefined;
    return { name: this.name, host: this.host, maker: this.maker, first: this.first, inviteOnly: this.inviteOnly, quick: this.quick, maxPlayers: this.maxPlayers, difficulty: this.difficulty, created: this.created, match, build, pinnedAt: this.pin ? this.pin.since : undefined };
  }

  // A game carried on by an older build is not kept on it for ever: when its run is over (after its end screen has had
  // PIN_RUN_OVER_MS), or at the first dawn once it has been on it PIN_MAX_HOURS, it closes, and its players are told why
  // - the next game they join is on the new build. (Never at a deploy: a deploy carries it on, as any game.)
  pinCheck(was, st) {
    if (this.closed || this.pinEnd) return;
    const over = st.phase === PHASE.GAMEOVER || st.phase === PHASE.VICTORY;
    const dawn = was.phase === PHASE.NIGHT && st.phase === PHASE.DAY;
    const hours = (Date.now() - this.pin.since) / 3600e3;
    if (over) this.pinClose(PIN_RUN_OVER_MS, 'Your run is over. That game was being carried on by an older version of the game, and has closed: start or join a new one to play the latest.');
    else if (dawn && hours >= PIN_MAX_HOURS) this.pinClose(0, `The sun is up. That game had been carried on by an older version of the game for ${Math.floor(hours)} hours since an update, and has closed so that everyone gets the update: start or join a new one.`);
  }
  pinClose(ms, why) {
    this.pinEnd = Date.now() + ms;
    this.lobby.log(`game ${this.code} on build ${this.pin.id}: closes ${ms ? `in ${ms / 1000} s` : 'now'} (${why.split('.')[0]})`);
    const close = () => {
      if (this.closed) return;
      this.lobby.ended(this.code, REJECT_REASON.ENDED_UPDATE, { tell: false });
      this.shut(ENDED_CODE, why);
    };
    if (ms) setTimeout(close, ms).unref?.();
    else close();
  }

  // The server is going down and the next one takes this game over: the worker stops and saves it, the save goes into
  // the store, and only then is every socket closed with HANDOFF_CLOSE (a client that came back sooner would find
  // nothing to come back to). -> { bytes, ms } once it is handed over, or why it was not (a string): then nothing has
  // been closed, and the match is still the caller's to end.
  // target: the server it goes to (cluster.js pickTarget; null: whichever claims it first)
  handoff(store, ms = 8000, target = null) {
    if (this.closed) return Promise.resolve('closed');
    // A game this server was still bringing back when it was told to stop (a deploy on the heels of a deploy): its save
    // goes back into the store as it came, for the next server - the game did not run here.
    if (this.from && !this.ready) {
      const from = this.from;
      return this.lobby.putBack(this.code, from, target).then((ok) => (ok ? (this.shut(HANDOFF_CLOSE, 'Server updating', { handedOff: true }), { bytes: from.body.byteLength, ms: 0, back: true }) : 'its save could not be put back'));
    }
    // (a game brought back and up, whose first word on who is in it is not heard yet: saved all the same)
    if (!this.st.players && (this.st.tick !== null || !this.restored)) return Promise.resolve('nobody in it');
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
        if (target) this.movingTo = target; // (from here its row is the next server's: cluster.js beat leaves it be)
        try {
          await store.put(this.code, target ? { ...this.meta(match), target } : this.meta(match), new Uint8Array(m.buf));
        } catch (err) {
          this.movingTo = null;
          return done(`the store would not take it (${err.message})`);
        }
        if (target) await this.lobby.cluster?.moved(this, target).catch((err) => this.lobby.log(`game ${this.code}: its row not moved to ${target} (${err.message})`));
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
    // (the game's close codes as its players' client has them: an older build's, for a game it carries on)
    if (code === ENDED_CODE) code = this.proto.ENDED_CODE ?? code;
    else if (code === MOVED_CODE) code = this.proto.MOVED_CODE ?? code;
    this.lobby.rooms.delete(this.code);
    this.lobby.cluster?.roomDown(this);
    this.worker.terminate().catch(() => {});
    for (const a of this.asks.values()) {
      clearTimeout(a.timer);
      a.done({ ok: false, error: 'That game has ended.' });
    }
    this.asks.clear();
    for (let i = 0; i < this.socks.length; i++) {
      const ws = this.socks[i];
      if (!ws) continue;
      this.socks[i] = null;
      ws.getUserData().room = null;
      try {
        ws.end(code, closeReason(why));
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
  // prepareMs: how long a server going down waits for the next one to have its games' valleys built (announce)
  // keepMs: how long a server going down waits at most for its own build to be in the store before it saves (KEEP_MS)
  constructor({ stats, matches = null, achievements = null, bestiary = null, gameOpts = {}, maxGames = defaultMaxGames(), maxPlayers = MAX_PLAYERS, roomMaxPlayers = MAX_PLAYERS, limits = true, idleMs = IDLE_MS, store = null, handoffMaxAge = 300, prepareMs = 3000, keepMs = KEEP_MS, settings = null, log = console.log }) {
    this.stats = stats;
    this.settings = settings; // the game's settings in the database (serversettings.js; none without one)
    this.matches = matches;
    this.achievements = achievements;
    this.bestiary = bestiary;
    this.store = store;
    this.handoffMaxAge = handoffMaxAge;
    this.restoring = new Map(); // code -> the restore under way (restore)
    this.prepareMs = prepareMs;
    this.keepMs = keepMs;
    this.prepared = new Map(); // code -> { worker, congestion, info, timer, ready }: valleys built for games on their way here (prepare)
    this.builds = null; // the builds games are carried on by when this one cannot read their saves (builds.js; none: they end)
    this.lost = new Map(); // code -> { reason, at }: games a deploy handed over that could not be carried on here (ended)
    this.stopping = false; // going down: nothing more is restored here
    this.stopped = new Promise((done) => (this.onStopping = done)); // (done once it is going down: handoffAll)
    this.cluster = null; // the other servers behind the proxy (cluster.js), when there are any
    this.playing = new Map(); // account id -> Map(room -> its sockets in it): where the signed-in are playing
    this.onPresence = null; // (account id) => void: they came into a game or left one (social.js)
    this.onIncident = null; // ({ code, kind, text }) => void: a game crashed, stopped or could not be restored (adminpanel.js)
    this.closedToNew = false; // an admin stopped new games being made here (adminpanel.js): those running carry on, and can be joined
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

  // the most games at once over every server (server_settings.max_total_games: serversettings.js), null for no total
  get maxTotal() {
    return this.settings?.maxTotalGames ?? null;
  }
  // whether this server may make another game: its own MAX_GAMES, and (on its own) the total. (In a cluster the total
  // is over every server, and Cluster.reserve keeps it.)
  get canCreate() {
    return !this.closedToNew && this.rooms.size < this.maxGames && (!!this.cluster || this.maxTotal === null || this.rooms.size < this.maxTotal);
  }
  // the game going here that this maker made, or null
  gameOf(maker) {
    if (!maker) return null;
    for (const room of this.rooms.values()) if (room.maker === maker && !room.closed) return room;
    return null;
  }

  // A new game for whoever asked: ip, for the allowance of games made a minute, and maker (u:<account id>, or a
  // guest's ip:<address>), who may have one game going at a time - on any server, in a cluster. Neither holds with
  // limits off. -> { room } or { error, status (HTTP), code (of the maker's game, when that is why) }
  async make(opts = {}, { ip = '', maker = '' } = {}) {
    if (!this.limits) maker = '';
    if (!this.canCreate) return BUSY;
    const mine = this.gameOf(maker);
    if (mine) return yours(mine.code);
    if (ip && this.limits && !allow(this.creates, ip, CREATE_BURST, CREATE_EVERY)) return { error: 'You have made several games just now. Wait a minute before making another.', status: 429 };
    if (!this.cluster) return this.create({ ...opts, maker });
    const code = this.newCode(opts.inviteOnly ? PRIVATE_CODE : PUBLIC_CODE);
    let r;
    try {
      r = await this.cluster.reserve({ code, maker, max: this.maxTotal });
    } catch (err) {
      this.log(`game not made: the cluster could not be asked (${err.message})`);
      return BUSY;
    }
    if (r.mine) return yours(r.mine);
    if (r.full) return BUSY;
    return this.create({ ...opts, code, maker });
  }

  // A new game, made here as it is (make asks first whether it may be): { room } or { error, status }
  create({ name = '', host = '', inviteOnly = false, maxPlayers = this.maxPlayers, difficulty, quick = false, maker = '', code = null } = {}) {
    if (!this.canCreate) return BUSY;
    const seats = Math.max(1, Math.min(this.roomMaxPlayers, Math.floor(+maxPlayers) || this.maxPlayers));
    const room = new Room(this, {
      code: code || this.newCode(inviteOnly ? PRIVATE_CODE : PUBLIC_CODE),
      name: cleanTitle(name, 28),
      host: cleanTitle(host, 16),
      inviteOnly: !!inviteOnly,
      maxPlayers: seats,
      difficulty,
      quick,
      maker,
    });
    this.rooms.set(room.code, room);
    room.up = this.cluster?.roomUp(room) ?? null;
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
  // just ending comes last), or a new one. (In a cluster the new one is made before the socket opens, as it has to ask
  // the others: index.js, make)
  quick() {
    return this.quickPick() || (this.cluster ? null : this.create({ quick: true }).room) || null;
  }
  quickPick() {
    let best = null;
    let bestKey = -1;
    for (const room of this.rooms.values()) {
      if (room.inviteOnly || room.closed || room.noRoom || room.pin) continue; // (pin: an older build's game, for that build's client)
      const ending = room.st.phase === PHASE.GAMEOVER || room.st.phase === PHASE.VICTORY;
      const key = (ending ? 0 : 1000) + room.open;
      if (key > bestKey) {
        best = room;
        bestKey = key;
      }
    }
    return best;
  }

  // the public games, the busiest first
  list() {
    const out = [];
    // (not a game an older build carries on: it is joined from the page its link gives, that build's client)
    for (const room of this.rooms.values()) if (!room.inviteOnly && !room.closed && !room.pin) out.push(room.info());
    out.sort((a, b) => b.seats - a.seats || a.ageS - b.ageS);
    return out;
  }

  // Shuts the games that have been empty too long, and forgets allowances that have worn off.
  reap() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      // (a game brought over whose players are all still on their way is kept as long as their places are: HANDOFF_RESERVE)
      const idle = room.restored && room.st.held > 0 ? Math.max(this.idleMs, HELD_MS) : this.idleMs;
      if (room.open || !room.emptySince || now - room.emptySince < idle) continue;
      this.log(`game ${room.code} closed: empty for ${Math.round((now - room.emptySince) / 1000)} s`);
      room.shut();
    }
    forgetSpent(this.creates);
    forgetSpent(this.misses);
    for (const [code, l] of this.lost) if (now - l.at > LOST_MS) this.lost.delete(code);
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
    this.onStopping();
    for (const code of [...this.prepared.keys()]) this.dropPrepared(code, 'this server is going down itself');
    // (a game being brought back this very moment: its room is there, or its save back in the store, before the rooms
    // are gone through - restore puts back what it claims from now on)
    await Promise.race([Promise.allSettled([...this.restoring.values()]), new Promise((done) => setTimeout(done, 3000))]);
    const rooms = [...this.rooms.values()];
    // (the code these games run on, for a next server that cannot read their saves: builds.js - in the store since a
    // moment after this server started, marked as in use now and put back if it was swept meanwhile, or packed and put
    // there now, while the next server builds the valleys: the saves name it. As is every older build a game here is
    // carried on by, marked as in use. Not waited for past keepMs: the games are saved anyway)
    const keeping = rooms.some((room) => room.st.players && !room.pin) && this.builds ? this.keepOwn() : null;
    for (const room of rooms) if (room.pin) this.builds?.touch(room.pin.id);
    const targets = new Map(rooms.map((room) => [room, room.st.players ? (this.cluster?.pickTarget() ?? null) : null]));
    await Promise.all([keeping, this.announce(store, rooms, targets)]);
    const done = await Promise.all(
      rooms.map(async (room) => {
        const players = room.st.players;
        const target = targets.get(room);
        const r = await room.handoff(store, ms, target);
        if (typeof r === 'object') {
          this.log(`handoff ${room.code}: ${players} players, ${(r.bytes / 1024).toFixed(0)} KB, ${r.ms} ms${target ? `, to ${target}` : ''}`);
          return true;
        }
        if (players) this.log(`handoff ${room.code}: not handed over - ${r}`);
        await room.finish(1500);
        return false;
      })
    );
    return done.filter(Boolean).length;
  }

  // (this build in the store before the saves name it: keepMs at most. -> whether it is there)
  keepOwn() {
    let timer;
    const late = new Promise((done) => (timer = setTimeout(() => done(false), this.keepMs)));
    const kept = Promise.resolve(this.builds.ensure()).then(() => true);
    return Promise.race([kept, late]).then((ok) => {
      clearTimeout(timer);
      if (!ok) this.log(`handoff: this build was not in the store after ${this.keepMs} ms: the games are saved anyway${this.builds.id ? ` (naming build ${this.builds.id})` : ', naming no build'}`);
      return ok;
    });
  }

  // Before the games are saved, the next server is told which are coming (seed, act, the valley's fingerprint) and
  // builds each one's valley in a worker of its own (prepare); it says when each is ready, and only then is the game
  // saved and its players sent over - so they wait for the save to be loaded, not for a valley to be generated. The
  // games go on being played meanwhile. A next server that says nothing (one from before this, or none) costs at most
  // prepareMs, and its games are handed over as before.
  async announce(store, rooms, targets) {
    // (not a game on an older build: that build starts it, it is not built ahead)
    const list = rooms.filter((r) => r.st.players && r.ready && !r.closed && !r.pin).map((r) => ({ code: r.code, info: { seed: r.st.seed >>> 0, act: r.st.act || 1, shape: r.st.shape || '', target: targets.get(r) || undefined } }));
    if (!list.length || !store.announceAndWait || !(this.prepareMs > 0)) return;
    const t0 = Date.now();
    try {
      const ready = await store.announceAndWait(list, this.prepareMs);
      this.log(`handoff: the next server had ${ready.size} of ${list.length} game(s) ready for their saves after ${Date.now() - t0} ms`);
    } catch (err) {
      this.log(`handoff: the next server could not be told what is coming (${err.message})`);
    }
  }

  // The last server is about to hand this game over (announce): its valley is built here now, in the worker that will
  // run it, which then waits for the save (Room's `prepared`, room-worker.js). Once built, the store is told this server
  // is ready for it. Nothing is listed or joinable until the save comes; a worker no save comes for goes after a while.
  prepare(code, info = {}) {
    code = String(code || '').toUpperCase();
    if (!this.store?.ready || this.stopping || !CODE_RE.test(code) || this.rooms.has(code) || this.prepared.has(code)) return;
    if (info.target && this.cluster && info.target !== this.cluster.id) return; // (behind the proxy: another server's)
    if (this.rooms.size + this.prepared.size >= this.maxGames || !Number.isFinite(+info.seed)) return;
    const congestion = new SharedArrayBuffer(4 * (this.roomMaxPlayers * 2 + 2));
    let worker;
    try {
      worker = new Worker(new URL('./room-worker.js', import.meta.url), { workerData: { code, congestion, prepare: { seed: +info.seed >>> 0, act: info.act === 2 ? 2 : 1 } }, resourceLimits: WORKER_LIMITS });
    } catch (err) {
      return void this.log(`game ${code}: its valley could not be built ahead (${err.message})`);
    }
    const p = { worker, congestion, info, ready: false, timer: setTimeout(() => this.dropPrepared(code, 'no save came for it: was the server going down killed before it could hand it over? docs/deploys.md'), PREPARED_MS) };
    p.timer.unref?.();
    p.on = {
      message: (m) => {
        if (m.t === 'prepared' && this.prepared.get(code) === p) this.onPrepared(code, p, m);
      },
      error: (err) => this.dropPrepared(code, err.message),
      exit: () => this.prepared.get(code) === p && this.prepared.delete(code),
    };
    for (const [ev, fn] of Object.entries(p.on)) worker.on(ev, fn);
    this.prepared.set(code, p);
  }
  // a prepared worker has built its valley: the store is told this server is ready for the save
  onPrepared(code, p, m) {
    // (the valley this build makes of that seed is not the one the game is played on: its save takes the long way - and
    // the server going down is told so, not to wait for it)
    if (m.error || (p.info.shape && m.shape !== p.info.shape)) {
      this.store.ready(code, false).catch(() => {});
      return this.dropPrepared(code, m.error || 'this build makes another valley of its seed');
    }
    p.ready = true;
    this.store.ready(code).catch((err) => this.log(`game ${code}: could not say it is ready for its save (${err.message})`));
    this.log(`game ${code}: its valley built ahead in ${m.ms} ms, ready for its save`);
  }
  // the worker prepared for this code, now the save is here (it is the room's from now on), or null
  takePrepared(code) {
    const p = this.prepared.get(code);
    if (!p) return null;
    this.prepared.delete(code);
    clearTimeout(p.timer);
    for (const [ev, fn] of Object.entries(p.on)) p.worker.off(ev, fn); // (only ours: a Worker has listeners of its own)
    return p;
  }
  dropPrepared(code, why) {
    const p = this.takePrepared(code);
    if (!p) return;
    p.worker.terminate().catch(() => {});
    this.log(`game ${code}: the valley built ahead is let go (${why})`);
  }

  // A game the last server handed over could not be carried on here (its room's worker said so: 'restoreFailed'), so
  // it is over. Its code is remembered for a while with why (a REJECT_REASON: ENDED_MAP, ENDED_UPDATE), and whoever
  // comes for it - its players, sent back here by the deploy, or anyone with its link - is told that instead of
  // "no such game" (wasLost; index.js seat). Those already on a socket waiting for it are told now.
  // tell: false: whoever is on a socket in it is told otherwise (Room.pinClose)
  // proto: the codec of its players' client when it is known (an older build's: the one that ran it, or was to) - what
  // whoever comes for it later is told in (lostProto)
  ended(code, reason, { tell = true, proto = null } = {}) {
    if (this.lost.size >= LOST_MAX) this.lost.delete(this.lost.keys().next().value);
    const room = this.rooms.get(code);
    proto ||= room?.proto || null;
    this.lost.set(code, { reason, at: Date.now(), proto: proto === OWN_PROTOCOL ? null : proto });
    if (tell) for (const ws of room?.socks || []) ws?.send(rejectBytes(reason, room.proto), true, false);
  }
  // the codec of the players of a game a deploy ended, when it was not this build's (else undefined)
  lostProto(code) {
    return this.lost.get(String(code || '').toUpperCase())?.proto || undefined;
  }
  // Whether the game of a room whose save this build could not read can be carried on by the build that saved it: the
  // save names one, it is not this one, and it has not been tried already.
  canPin(room) {
    const build = room.from?.meta?.build;
    return !!this.builds?.canStart && !room.pin && typeof build === 'string' && !!build && build !== this.builds.id;
  }
  // The room of a save this build could not read has closed. If the build that saved it may be started here (builds.js
  // fetch says why not), the game is started again from the same save by that build's code, under the same code;
  // whoever asks for the code meanwhile waits for that (restore). Failing that, it is over (ended).
  afterFailed(room) {
    if (room.after || !this.canPin(room) || this.rooms.has(room.code)) return;
    room.after = true;
    const { code, from } = room;
    const m = from.meta;
    // (told to stop meanwhile, the fetch - and the loading of its codec - is not waited for: the save goes back at once,
    // for the next server, and the server going down waits for that - handoffAll)
    let proto = null; // (its players' codec, once known: also what they are told in if it ends here after all)
    const p = (this.stopping ? Promise.resolve(null) : Promise.race([this.builds.fetch(m.build), this.stopped.then(() => null)]))
      .then(async (b) => {
        // (told to stop meanwhile: the next server gets the save, and tries the same)
        if (this.stopping) return (await this.putBack(code, from)) ? 'back' : null;
        if (!b || this.rooms.has(code)) return null;
        // (its players' client reads what this thread writes to them in its own codec: that build's protocol.js. One
        // that cannot be loaded here is only used if it is this build's protocol)
        proto = await Promise.race([this.builds.protocol(b), this.stopped.then(() => null)]);
        if (this.stopping) return (await this.putBack(code, from)) ? 'back' : null;
        if (!proto && b.client.protocol !== PROTOCOL_VERSION) throw new Error(`its client speaks protocol ${b.client.protocol}, and its protocol.js could not be used here`);
        if (this.stopping) return (await this.putBack(code, from)) ? 'back' : null;
        if (this.rooms.has(code)) return null;
        const next = new Room(this, {
          code,
          name: room.name,
          host: room.host,
          inviteOnly: room.inviteOnly,
          maxPlayers: room.maxPlayers,
          difficulty: room.difficulty,
          quick: room.quick,
          maker: room.maker,
          first: room.first,
          created: room.created,
          continues: room.continues,
          restore: from.body,
          from,
          pin: { id: m.build, dir: b.dir, client: b.client, proto, since: Number.isFinite(m.pinnedAt) ? m.pinnedAt : Date.now() },
        });
        this.rooms.set(code, next);
        next.up = this.cluster?.roomUp(next) ?? null;
        this.log(`game ${code} carried on by build ${m.build}, the one that saved it (${this.rooms.size}/${this.maxGames} games)`);
        return next;
      })
      .catch((err) => (this.log(`game ${code} not carried on by build ${m.build} (${err.message})`), null))
      .then((next) => {
        if (!next) {
          this.log(`game ${code} not restored: build ${m.build} could not be started here`);
          this.onIncident?.({ code, kind: 'not restored', text: `its build ${m.build} could not be started here` });
          this.ended(code, room.failed, { proto });
        }
        if (this.restoring.get(code) === p) this.restoring.delete(code);
        return next === 'back' ? null : next;
      });
    this.restoring.set(code, p);
  }
  // The room that goes by this code once it is known what became of its restore: up (on its own build or an older one),
  // or null. (restore answers as soon as there is a room, before its worker has read the save.)
  async settle(code) {
    for (let i = 0; i < 4; i++) {
      const room = await this.restore(code);
      if (!room) return null;
      await Promise.race([room.started, new Promise((done) => setTimeout(done, 15000))]);
      if (!room.closed) return room;
    }
    return null;
  }
  // A save this server claimed and will not run (it is going down itself): back into the store as it was, for the
  // next server (target: the one it goes to, behind the proxy)
  async putBack(code, from, target = null) {
    try {
      const meta = { ...(from.meta || {}) };
      if (target) meta.target = target;
      else delete meta.target;
      await this.store.put(code, meta, from.body);
      this.log(`game ${code}: its save is back in the store for the next server`);
      return true;
    } catch (err) {
      this.log(`game ${code}: its save could not be put back in the store (${err.message})`);
      return false;
    }
  }
  // why the game that went by this code is gone (a REJECT_REASON), or 0: it is not one a deploy ended
  wasLost(code) {
    return this.lost.get(String(code || '').toUpperCase())?.reason || 0;
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
      row = await this.store.claim(code, this.cluster?.id ?? null);
    } catch (err) {
      this.log(`game ${code} not restored: the store failed (${err.message})`);
      return null;
    }
    if (!row) return null;
    // (told to stop while the store was asked: this server will not run it - the next one gets it, as it came)
    if (this.stopping) return void (await this.putBack(code, { meta: row.meta || {}, body: row.body })) || null;
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
    // (a save of another build: a page of its client may still ask for that client's files - builds.js know)
    if (typeof m.build === 'string' && this.builds && m.build !== this.builds.id) this.builds.know(m.build);
    const room = new Room(this, {
      code,
      name: cleanTitle(m.name, 28),
      host: cleanTitle(m.host, 16),
      inviteOnly: !!m.inviteOnly,
      maxPlayers: Math.max(1, Math.min(this.roomMaxPlayers, Math.floor(+m.maxPlayers) || this.maxPlayers)),
      difficulty: m.difficulty, // absent on a save from before difficulties: the room treats that as Nightfall
      quick: !!m.quick,
      maker: typeof m.maker === 'string' ? m.maker.slice(0, 80) : '',
      first: cleanTitle(m.first, 16),
      created: Number.isFinite(m.created) ? m.created : Date.now(),
      continues: typeof m.match === 'string' ? m.match : null,
      restore: row.body,
      prepared: this.takePrepared(code),
      from: { meta: m, body: row.body },
    });
    this.rooms.set(code, room);
    room.up = this.cluster?.roomUp(room) ?? null;
    this.log(`game ${code} restored from the last server (saved ${age.toFixed(1)} s ago, ${(row.body.byteLength / 1024).toFixed(0)} KB${room.builtAhead ? ', its valley built ahead' : ''}) (${this.rooms.size}/${this.maxGames} games)`);
    return room;
  }
}

// What a socket that cannot have a seat is sent before it is closed: the REJECT the client shows (connection.js). proto:
// the codec of the client it goes to (a game an older build carries on: that build's - the reason by its name)
export function rejectBytes(reason = REJECT_REASON.FULL, proto = OWN_PROTOCOL) {
  if (proto && proto !== OWN_PROTOCOL) {
    try {
      const name = Object.keys(REJECT_REASON).find((k) => REJECT_REASON[k] === reason);
      const theirs = proto.REJECT_REASON?.[name];
      const id = proto.S2C?.REJECT;
      if (Number.isInteger(id) && id >= 0 && id < 256) return Uint8Array.of(id, Number.isInteger(theirs) && theirs >= 0 && theirs < 256 ? theirs : reason);
    } catch {}
  }
  return Uint8Array.of(S2C.REJECT, reason);
}
