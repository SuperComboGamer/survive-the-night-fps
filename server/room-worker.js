// One game server: a worker thread running one Game (game.js) and its fixed-rate tick loop. The network thread
// (index.js, rooms.js) owns the sockets and passes this room's traffic in and out as packed frames (wire.js); the
// leaderboard lives there too, so a game's records are a stand-in that posts to it (RemoteRecords).
//
// From the network thread:
//   { t: 'open', slot, ip, user }  a socket was put in this slot (user: its account { id, name, isAdmin }, null for a guest)
//   { t: 'close', slot, code }     ...and closed (code: the socket's close code - 4001 the player left on purpose)
//   { t: 'in', buf }               their messages (frames, in order)    { t: 'stop' }          shut down
//   { t: 'finish' }                the server is going down: end the match being played, and say when it is
//   { t: 'save' }                  ...and the next one takes the game over (handoff.js): stop, and send it saved
//   { t: 'progress', tok, ... }    a player's progress (progress.js): { first, xp, perks, best } as they join, { perks } on a pick
//   { t: 'achieved', user, ids }   an account's achievements unlocked (userachievements.js): tell the player
//   { t: 'bestiary', tok, mask }   the kinds of the dead an account has seen (userbestiary.js), as they join
//   { t: 'admin', id, op, ... }    the admin panel asks something of this game (gameadmin.js): answered { t: 'admin', id, ok, ... }
// To it:
//   { t: 'ready', seed }           the game is built and ticking        { t: 'out', buf }      messages for sockets
//   { t: 'closed', slot }          done with that slot's socket: nothing more will go out for it
//   { t: 'kick', slot }            close that socket: it took a seat and never joined (JOIN_WAIT)
//   { t: 'kick', slot, code, why } ...or an admin removed its player (gameadmin.js): closed with that code and reason
//   { t: 'status', ... }           once a second, and when the number of players changes
//   { t: 'rec', op, ... }          the leaderboard and XP (RemoteRecords) { t: 'board', ... }  a player asked for it
//   { t: 'an', rec }               a record of the match being played (analytics.js), for the database (matchstore.js)
//   { t: 'ach', user, add, feats, strangers }  what an account earned towards its achievements (achievements.js)
//   { t: 'seen', user, mask }      kinds of the dead an account saw for the first time (bestiary.js), to be written
//   { t: 'finished' }              ...the match is ended and its records posted
//   { t: 'saved', buf }            the game, saved (gzipped: handoff.js), and its match ended as 'handoff'
//   { t: 'saveFailed', error }     ...or it could not be, and its match ended as 'interrupted'
//   { t: 'restoreFailed', why }    the save this game was to be made from cannot be used here: it ends
//
// workerData.restore: a game the last server saved (the gzipped envelope), to carry on with instead of a new one.
import { parentPort, workerData } from 'node:worker_threads';
import { Game } from './game.js';
import { FramePacker, eachFrame } from './wire.js';
import { SERVER_TICK_RATE } from '../shared/constants.js';
import { envelope, encode, decode } from './handoff.js';
import { adminOp } from './gameadmin.js';
import { ENDED_CODE, LEFT_CODE } from '../shared/protocol.js';

const { code, opts, congestion, restore } = workerData;
// ms a socket may hold a seat without joining (a client sends its JOIN as soon as it is open). JOIN_WAIT_SECONDS: tests
const JOIN_WAIT = (+process.env.JOIN_WAIT_SECONDS || 15) * 1000;
const tag = `[game ${code}]`;
const congested = new Int32Array(congestion); // per slot: the network thread is holding that socket's sends back
const post = (m, transfer) => parentPort.postMessage(m, transfer);

// ---------------------------------------------------------------- the leaderboard, kept by the network thread
// What Game asks of PlayerStats (stats.js), posted on. A record here is a token the other side files the real one
// under. The id is a bearer secret: it goes to the network thread for PlayerStats.enter and nowhere else.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class RemoteRecords {
  constructor() {
    this.remote = true; // Game.sendBoard: the board is the network thread's to send
    this.n = 0;
  }
  // account: the one the player is signed in to, or null - then only a browser id gets a record
  enter(id, name, account = null) {
    if (!account && (typeof id !== 'string' || !UUID.test(id))) return null; // (nobody: nothing is kept, as PlayerStats.enter)
    const rec = { tok: ++this.n };
    post({ t: 'rec', op: 'enter', tok: rec.tok, id: account ? '' : id, name, user: account ? account.id : '' });
    return rec;
  }
  leave(rec) {
    if (rec) post({ t: 'rec', op: 'leave', tok: rec.tok });
  }
  bump(rec, stat, n = 1) {
    if (rec) post({ t: 'rec', op: 'bump', tok: rec.tok, stat, n });
  }
  best(rec, day) {
    if (rec) post({ t: 'rec', op: 'best', tok: rec.tok, day });
  }
  // me: the asking player's record, here: everybody's in this game
  sendBoard(slot, me, here) {
    post({ t: 'board', slot, me: me ? me.tok : 0, here: [...here].map((r) => r.tok) });
  }
}

// (an emptied game builds its next valley when someone joins it, not for nobody: the lobby closes it if nobody does)
// (the match records go to the network thread, which writes them if the server has a database and drops them if not;
// so does what an account earns towards its achievements, which the network thread answers with what that unlocked)
// (a save that cannot be used ends this game where it started: the network thread closes it, and the code is gone)
let game;
try {
  game = new Game({
    ...opts,
    restore: restore ? decode(Buffer.from(restore)) : null,
    rollWhenEmpty: false,
    stats: new RemoteRecords(),
    analytics: opts.analytics ? (rec) => post({ t: 'an', rec }) : undefined,
    achieve: opts.achievements ? (m) => post({ t: 'ach', ...m }) : undefined,
    bestiary: opts.bestiary ? (m) => post({ t: 'seen', ...m }) : undefined,
    log: (...a) => console.log(tag, ...a),
  });
} catch (err) {
  if (!restore) throw err;
  post({ t: 'restoreFailed', why: err.message });
  throw err;
}

// ---------------------------------------------------------------- sockets
// Everything the game sends between two turns of the event loop goes out in one batch.
const out = new FramePacker(1 << 16);
let flushing = false;
function flush() {
  flushing = false;
  if (out.empty) return;
  const buf = out.take();
  post({ t: 'out', buf }, [buf]);
}
function queue(slot, bytes) {
  out.push(slot, bytes);
  if (!flushing) {
    flushing = true;
    setImmediate(flush);
  }
}

const sessions = [];
const conns = [];
const openedAt = []; // per slot: when its socket came (performance.now()); 0 once it joined or was kicked
function makeConn(slot, ip, user) {
  return {
    ip,
    slot,
    user, // the account it is signed in to ({ id, name, isAdmin }), or null (Game.handleJoin)
    closed: false,
    send(bytes) {
      if (!this.closed) queue(slot, bytes);
    },
    congested() {
      return !this.closed && Atomics.load(congested, slot) !== 0;
    },
    cork(fn) {
      fn(); // (the network thread corks each socket's share of a batch)
    },
  };
}

// An admin removed the player on this socket (gameadmin.js kick): the game lets go of them now, as of a player who
// left on purpose (no place is held for them), and the network thread closes the socket with the reason. What the
// socket still sends is for nobody; its slot is given back when its close comes (case 'close').
function drop(slot, why) {
  const s = sessions[slot];
  if (!s) return;
  conns[slot].closed = true;
  sessions[slot] = conns[slot] = null;
  openedAt[slot] = 0;
  game.onClose(s, LEFT_CODE);
  post({ t: 'kick', slot, code: ENDED_CODE, why: why ? `An admin removed you from the game: ${why}` : 'An admin removed you from the game.' });
}

parentPort.on('message', (m) => {
  switch (m.t) {
    case 'open': {
      const conn = makeConn(m.slot, m.ip, m.user || null);
      conns[m.slot] = conn;
      sessions[m.slot] = game.onOpen(conn);
      openedAt[m.slot] = performance.now();
      break;
    }
    case 'in':
      eachFrame(m.buf, (slot, bytes) => {
        const s = sessions[slot];
        if (s) game.onMessage(s, bytes);
      });
      break;
    case 'close': {
      const s = sessions[m.slot];
      if (s) {
        conns[m.slot].closed = true;
        sessions[m.slot] = conns[m.slot] = null;
        game.onClose(s, m.code);
      }
      flush(); // (whatever was still going to them is out of the way: the slot can have a new socket)
      post({ t: 'closed', slot: m.slot });
      break;
    }
    case 'progress':
      game.onProgress(m.tok, m);
      break;
    case 'achieved':
      game.ach.achieved(m.user, m.ids);
      break;
    case 'bestiary':
      game.onBestiary(m.tok, m.mask);
      break;
    case 'admin': {
      // (whatever goes wrong in it is the panel's answer, never this game's end)
      let reply;
      try {
        reply = adminOp(game, m, { drop });
      } catch (err) {
        reply = { ok: false, error: String(err?.message || err).slice(0, 200) };
      }
      post({ t: 'admin', id: m.id, ...reply });
      break;
    }
    case 'finish':
      try {
        game.track?.finish('interrupted');
      } catch (err) {
        console.error(tag, 'finish failed', err);
      }
      post({ t: 'finished' });
      break;
    case 'save': {
      // (between ticks, as Game.save needs: this runs between two turns of the loop, and the loop goes no further)
      clearTimeout(timer);
      flush();
      let buf = null;
      let error = '';
      const t0 = performance.now();
      try {
        buf = encode(envelope(game));
      } catch (err) {
        error = err.stack || err.message;
      }
      try {
        game.track?.finish(buf ? 'handoff' : 'interrupted');
      } catch (err) {
        console.error(tag, 'finish failed', err);
      }
      if (!buf) {
        console.error(tag, 'save failed', error);
        post({ t: 'saveFailed', error });
        break;
      }
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      post({ t: 'saved', buf: ab, ms: Math.round(performance.now() - t0) }, [ab]);
      break;
    }
    case 'stop':
      clearTimeout(timer);
      flush();
      parentPort.close();
      return;
  }
  if (game.players.size !== lastPlayers) status();
});

// ---------------------------------------------------------------- what the lobby shows, and how hard this room works
let lastPlayers = -1;
let cpuAt = process.threadCpuUsage();
let cpuT = performance.now();
let elu = performance.eventLoopUtilization();
let load = { cpuMs: 0, elu: 0 }; // over the last second: CPU ms this thread used per second, share of time busy
// ticks that threw (the loop carries on): how many, and the last one - what the admin panel shows of a game going wrong
let errs = 0;
let lastErr = '';
function tickError(err) {
  errs++;
  lastErr = String(err?.message || err).slice(0, 160);
  console.error(tag, 'tick error', err);
}
function status() {
  lastPlayers = game.players.size;
  let lead = '';
  let held = 0; // (dropped, or brought over from the last server: their places are kept for them)
  for (const p of game.players.values()) {
    lead ||= p.name; // (the one who has been in longest: the map keeps join order)
    if (p.away) held++;
  }
  post({ t: 'status', players: game.players.size, held, lead, phase: game.phase, day: game.day, seed: game.seed >>> 0, tick: game.tickStats.status(performance.now()), load, heapMb: Math.round(process.memoryUsage().heapUsed / 1e5) / 10, act: game.act, zombies: game.zombies.length, errs, lastErr });
}
setInterval(() => {
  const now = performance.now();
  const cpu = process.threadCpuUsage(cpuAt);
  cpuAt = process.threadCpuUsage();
  const e = performance.eventLoopUtilization(elu);
  elu = performance.eventLoopUtilization();
  load = { cpuMs: Math.round((cpu.user + cpu.system) / 10 / ((now - cpuT) / 1000)) / 100, elu: Math.round(e.utilization * 1000) / 1000 };
  cpuT = now;
  status();
  // a seat held by a socket that never joined goes back
  for (let slot = 0; slot < sessions.length; slot++) {
    const s = sessions[slot];
    if (!s || !openedAt[slot]) continue;
    if (s.player) openedAt[slot] = 0;
    else if (now - openedAt[slot] > JOIN_WAIT) {
      openedAt[slot] = 0;
      post({ t: 'kick', slot });
    }
  }
}, 1000).unref();

// the [stats] line, every 10 s while anybody is on
setInterval(() => {
  const s = game.stats;
  const t = game.tickStats.roll(); // (closed with nobody on too: status reads it)
  if (game.players.size) {
    const perClient = s.bytesOut / Math.max(1, game.players.size) / 10;
    const tick = `tick ${t.meanMs.toFixed(2)}ms p99 ${t.p99Ms.toFixed(2)}ms max ${t.maxMs.toFixed(2)}ms over ${t.over}/${t.ticks} late ${t.lateMeanMs.toFixed(2)}ms latemax ${t.lateMaxMs.toFixed(2)}ms`;
    console.log(`${tag} [stats] players ${game.players.size} zombies ${game.zombies.length} ents ${game.all.length} ${tick} cpu ${load.cpuMs}ms/s out ${(perClient / 1024).toFixed(1)} KB/s/client`);
  }
  s.bytesOut = 0;
  s.msgsOut = 0;
}, 10000).unref();

// ---------------------------------------------------------------- fixed-rate tick loop
const TICK_MS = 1000 / SERVER_TICK_RATE;
let next = performance.now();
let due = next; // when the timer that wakes the loop was due
let timer = 0;
function loop() {
  const now = performance.now();
  if (game.stepMode) {
    // the clock is held (the admin chat command /step on: Game.debugCommand): only the ticks asked for run, and the
    // fixed-rate clock starts again from here when it is let go
    const n = game.takeSteps(now, 8);
    for (let i = 0; i < n; i++) {
      try {
        game.update();
      } catch (err) {
        tickError(err);
      }
    }
    if (n) flush();
    next = now + TICK_MS;
    due = next;
    timer = setTimeout(loop, 1);
    return;
  }
  // a wake with a tick to run: how long after its timer was due did it come? That is the event loop or the host
  // holding the server up, not the cost of a tick (after a slow tick the timer is armed late, so it is not counted)
  if (now >= next) game.tickStats.late(now - due);
  let steps = 0;
  while (now >= next && steps < 4) {
    try {
      game.update();
    } catch (err) {
      tickError(err);
    }
    next += TICK_MS;
    steps++;
  }
  if (now - next > 1000) next = now; // way behind (debugger / sleep): resync
  if (steps) {
    flush(); // this tick's snapshots go now, not after whatever else is queued
    if (game.players.size !== lastPlayers) status();
  }
  const armed = performance.now();
  const wait = Math.max(0, next - armed);
  due = armed + wait;
  timer = setTimeout(loop, wait > 2 ? wait - 1 : 0);
}

post({ t: 'ready', seed: game.seed >>> 0 });
status();
loop();
