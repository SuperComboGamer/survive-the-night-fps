// Self-state sync test: the server only sends a client its own simulated state when the two can disagree, so check
// that they really do stay in agreement, and get back into it, on a laggy link.
// One client with the real Prediction / Connection / decoder walks, sprints, turns and jumps while every message is
// delayed (ordered, like TCP) by LAG ms each way plus jitter. Every 6 s the server shoves the player (a change the
// client cannot predict). Expected: the prediction of every command matches the server's result exactly, except for
// about a round trip after each shove; the server rebases the client only during that window and never in between.
// Then a link that hiccups (runStall): the commands that arrive late in one burst must not stay queued on the server.
// usage: node scripts/test-netsync.js [lagMs=100] [jitterMs=30]
import { Game } from '../server/game.js';
import { C2S, S2C, SNAP, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE } from '../shared/constants.js';
import { readHeader, readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';
import { Connection } from '../client/net/connection.js';
import { Prediction } from '../client/game/prediction.js';
import { createWorld } from '../shared/world.js';
import { createPlayerState, copyPlayerState } from '../shared/playersim.js';

function run(LAG, JIT) {
  let rs = 12345;
  const rnd = () => ((rs = (Math.imul(rs, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  const game = new Game({ seed: 4242, godMode: true, log: () => {} });
  let now = 0; // ms of simulated time
  const toClient = []; // [deliverAt, bytes]
  const toServer = [];
  const push = (q, bytes) => q.push([Math.max(now + LAG + rnd() * JIT, q.length ? q[q.length - 1][0] : 0), bytes]);

  const c = { net: { tick: 0, ack: 0 }, self: {}, global: null, ents: new Map(), id: 0, pred: null, rebases: 0, snaps: 0 };
  const store = { ents: c.ents, onCreate() {}, onRemove() {}, onUpdate() {} };
  const handler = new Proxy({}, { get: () => () => {} });
  const session = game.onOpen({ send: (bytes) => push(toClient, bytes.slice()) });
  const conn = new Connection({});
  conn.open = true;
  conn.ws = { readyState: 1, send: (bytes) => push(toServer, bytes.slice()), close() {} };
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('laggy');
  game.onMessage(session, w.bytes().slice());

  const predAt = new Map(); // seq -> the client's prediction of the state after it (as of when it was issued)
  function onClientMessage(buf) {
    const r = new Reader(buf);
    const t = r.u8();
    if (t === S2C.WELCOME) {
      c.id = r.u16();
      c.pred = new Prediction(createWorld(r.u32()));
    } else if (t === S2C.SNAPSHOT) {
      const flags = readHeader(r, c.net);
      if (flags & SNAP.GLOBAL) c.global = readGlobal(r, c.global);
      const sync = readSelf(r, c.self, flags);
      readEntities(r, store, c.net.tick, flags);
      c.snaps++;
      if (sync) {
        c.rebases++;
        c.pred.reconcile(c.net.ack, c.self);
        predAt.clear(); // the replay rewrote the prediction of everything still unacked
      } else c.pred.confirm(c.net.ack);
      readEvents(r, handler, flags, c.ents);
      if (r.left) throw new Error(`${r.left} trailing bytes in a snapshot`);
    }
  }

  const TICKS = SERVER_TICK_RATE * 90;
  const SHOVE_EVERY = SERVER_TICK_RATE * 6;
  let frame = 0;
  let yaw = 0;
  let shoveTick = -1e9;
  let shoves = 0;
  let checks = 0;
  let late = 0; // disagreements / rebases outside the window after a shove
  let rebasesAtShove = 0;
  let maxRebases = 0;
  const rttTicks = Math.ceil(((2 * LAG + JIT) / 1000) * SERVER_TICK_RATE);
  const window = 2 * rttTicks + 4; // a prediction issued before the last rebase arrived can still be on its way
  for (let tick = 0; tick < TICKS; tick++) {
    for (let f = 0; f < 60 / SERVER_TICK_RATE; f++) {
      now = (frame * 1000) / 60;
      while (toClient.length && toClient[0][0] <= now) onClientMessage(toClient.shift()[1]);
      while (toServer.length && toServer[0][0] <= now) game.onMessage(session, toServer.shift()[1]);
      if (c.pred) {
        yaw += 0.01 + Math.sin(frame / 50) * 0.02;
        const buttons = BTN.FWD | (((frame / 240) | 0) % 2 ? BTN.SPRINT : 0) | (frame % 300 === 0 ? BTN.JUMP : 0);
        const before = c.pred.seq;
        c.pred.step(1 / 60, buttons, yaw, 0, () => {});
        if (c.pred.seq !== before) predAt.set(c.pred.seq, copyPlayerState(createPlayerState(), c.pred.state));
        for (let out; (out = c.pred.takeOutbox(1 / 60)); ) conn.sendInput(c.net.tick - 2, 0, out, c.pred.hash(out));
      }
      frame++;
    }
    const p = game.players.get(c.id);
    if (p && tick > 100 && tick % SHOVE_EVERY === 0) {
      maxRebases = Math.max(maxRebases, c.rebases - rebasesAtShove);
      rebasesAtShove = c.rebases;
      p.state.vx += 5;
      p.state.vz -= 3;
      p.state.vy = 4;
      p.state.onGround = 0;
      shoveTick = tick;
      shoves++;
    }
    const rebasesBefore = c.rebases;
    const seqBefore = p ? p.lastSeq : 0;
    game.update();
    if (!p || tick < 100) continue;
    const settled = tick - shoveTick > window;
    if (settled && c.rebases !== rebasesBefore) late++;
    const mine = p.lastSeq !== seqBefore && predAt.get(p.lastSeq);
    if (mine) {
      checks++;
      const s = p.state;
      const err = Math.max(Math.abs(mine.x - s.x), Math.abs(mine.y - s.y), Math.abs(mine.z - s.z), Math.abs(mine.vx - s.vx), Math.abs(mine.vy - s.vy), Math.abs(mine.vz - s.vz), Math.abs(mine.stamina - s.stamina));
      if (err > 1e-9 && settled) late++;
    }
    for (const k of predAt.keys()) if (((p.lastSeq - k) & 0xffff) < 0x8000) predAt.delete(k);
  }
  maxRebases = Math.max(maxRebases, c.rebases - rebasesAtShove);
  const ok = late === 0 && checks > TICKS / 4 && maxRebases <= rttTicks + 3 && shoves > 5;
  console.log(`${ok ? 'PASS' : 'FAIL'}  self-state sync at ${LAG} ms each way (+${JIT} jitter): ${checks} predictions checked against the server, ${shoves} shoves, at most ${maxRebases} rebases per shove (round trip ${rttTicks} ticks), ${c.rebases} of ${c.snaps} snapshots carried our state, ${late} disagreements outside the catch-up window`);
  return ok;
}

// A hiccup on the link: for HOLD ms nothing the client sends gets through, then all of it arrives at once.
// Expected: the server runs the late commands when they come instead of leaving them queued behind the ones that
// keep arriving (a queue that never empties delays everything that client does from then on), and every command is
// lag compensated with the render time of the packet it came in, however long it waited.
function runStall(HOLD) {
  const game = new Game({ seed: 4242, godMode: true, log: () => {} });
  const c = { net: { tick: 0, ack: 0 }, self: {}, global: null, ents: new Map(), id: 0, pred: null };
  const store = { ents: c.ents, onCreate() {}, onRemove() {}, onUpdate() {} };
  const handler = new Proxy({}, { get: () => () => {} });
  const toClient = [];
  const held = []; // what the client sent while the link was down
  let down = false;
  const session = game.onOpen({ send: (bytes) => toClient.push(bytes.slice()) });
  const conn = new Connection({});
  conn.open = true;
  conn.ws = { readyState: 1, send: (bytes) => (down ? held.push(bytes.slice()) : game.onMessage(session, bytes.slice())), close() {} };
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('hiccup');
  game.onMessage(session, w.bytes().slice());

  function onClientMessage(buf) {
    const r = new Reader(buf);
    const t = r.u8();
    if (t === S2C.WELCOME) {
      c.id = r.u16();
      c.pred = new Prediction(createWorld(r.u32()));
    } else if (t === S2C.SNAPSHOT) {
      const flags = readHeader(r, c.net);
      if (flags & SNAP.GLOBAL) c.global = readGlobal(r, c.global);
      const sync = readSelf(r, c.self, flags);
      readEntities(r, store, c.net.tick, flags);
      if (sync) c.pred.reconcile(c.net.ack, c.self);
      else c.pred.confirm(c.net.ack);
      readEvents(r, handler, flags, c.ents);
    }
  }

  const HOLD_TICKS = Math.round((HOLD / 1000) * SERVER_TICK_RATE);
  const DOWN_AT = SERVER_TICK_RATE * 5;
  const UP_AT = DOWN_AT + HOLD_TICKS;
  const SETTLED = UP_AT + SERVER_TICK_RATE; // a second to get over it
  const TICKS = SETTLED + SERVER_TICK_RATE * 5;
  const sentAt = new Map(); // seq -> the render time its packet carried
  let frame = 0;
  let wrongTime = 0;
  let checked = 0;
  let waiting = 0; // most commands left in the queue after a tick, once it has had time to recover
  for (let tick = 0; tick < TICKS; tick++) {
    down = tick >= DOWN_AT && tick < UP_AT;
    if (tick === UP_AT) for (const bytes of held.splice(0)) game.onMessage(session, bytes);
    for (let f = 0; f < 60 / SERVER_TICK_RATE; f++) {
      while (toClient.length) onClientMessage(toClient.shift());
      if (c.pred) {
        c.pred.step(1 / 60, BTN.FWD, frame * 0.01, 0, () => {});
        for (let out; (out = c.pred.takeOutbox(1 / 60)); ) {
          const rt = (c.net.tick - 2) & 0xffff;
          for (const cmd of out) sentAt.set(cmd.seq, rt);
          conn.sendInput(rt, 0, out, c.pred.hash(out));
        }
      }
      frame++;
    }
    const p = game.players.get(c.id);
    const seqBefore = p ? p.lastSeq : 0;
    game.update();
    if (!p) continue;
    if (p.lastSeq !== seqBefore && sentAt.has(p.lastSeq)) {
      checked++;
      if (p.renderTick !== sentAt.get(p.lastSeq)) wrongTime++;
    }
    if (tick >= SETTLED) waiting = Math.max(waiting, p.cmdQueue.length);
  }
  const ok = checked > TICKS / 2 && wrongTime === 0 && waiting === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  a ${HOLD} ms hiccup on the link: a second later at most ${waiting} commands are left waiting on the server, ${wrongTime} of ${checked} commands were run with another packet's render time`);
  return ok;
}

const args = process.argv.slice(2);
const cases = args.length
  ? [[+args[0], +(args[1] ?? 30)]]
  : [
      [0, 0],
      [100, 30],
      [250, 120],
    ];
let ok = true;
for (const [lag, jit] of cases) ok = run(lag, jit) && ok;
if (!args.length) for (const hold of [300, 700, 1500]) ok = runStall(hold) && ok;
process.exit(ok ? 0 : 1);
