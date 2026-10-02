// Self-state sync test: the server only sends a client its own simulated state when the two can disagree, so check
// that they really do stay in agreement, and get back into it, on a laggy link.
// One client with the real Prediction / Connection / decoder walks, sprints, turns and jumps while every message is
// delayed (ordered, like TCP) by LAG ms each way plus jitter. Every 6 s the server shoves the player (a change the
// client cannot predict). Expected: the prediction of every command matches the server's result exactly, except for
// about a round trip after each shove; the server rebases the client only during that window and never in between.
// Then a link that hiccups (runStall): the commands that arrive late in one burst must not stay queued on the server.
// Then the input buffer (runBuffer): early presses of fire, reload and jump are performed, and only those.
// usage: node scripts/test-netsync.js [lagMs=100] [jitterMs=30]
import { Game } from '../server/game.js';
import { C2S, S2C, SNAP, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE, SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE } from '../shared/constants.js';
import { ITEM, AMMO } from '../shared/defs.js';
import { readHeader, readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';
import { Connection } from '../client/net/connection.js';
import { Prediction } from '../client/game/prediction.js';
import { InputBuffer } from '../client/game/inputbuffer.js';
import { createWorld } from '../shared/world.js';
import { createPlayerState, copyPlayerState, samePlayerState, simulatePlayer } from '../shared/playersim.js';

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

// Input buffering (client/game/inputbuffer.js): fire, reload or jump pressed a moment early is performed on the
// first command that can act on it, once, and never as something the player did not ask for. The buffer only decides
// which buttons go into the commands, so on a laggy link the server must still agree with the prediction of every
// one of them and never have to rebase the client.
function runBuffer(LAG) {
  const game = new Game({ seed: 4242, godMode: true, log: () => {} });
  let now = 0;
  const toClient = [];
  const toServer = [];
  const push = (q, bytes) => q.push([now + LAG, bytes]);
  const c = { net: { tick: 0, ack: 0 }, self: {}, global: null, ents: new Map(), id: 0, pred: null };
  const store = { ents: c.ents, onCreate() {}, onRemove() {}, onUpdate() {} };
  const handler = new Proxy({}, { get: () => () => {} });
  const session = game.onOpen({ send: (bytes) => push(toClient, bytes.slice()) });
  const conn = new Connection({});
  conn.open = true;
  conn.ws = { readyState: 1, send: (bytes) => push(toServer, bytes.slice()), close() {} };
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('early');
  game.onMessage(session, w.bytes().slice());

  const predAt = new Map(); // seq -> the client's prediction of the state after it
  let poked = false; // the test itself just changed the player on the server: a rebase is due
  let stray = 0; // rebases nothing called for
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
      if (sync) {
        if (c.pred.hasServerState && !poked) stray++;
        c.pred.reconcile(c.net.ack, c.self);
        predAt.clear();
      } else c.pred.confirm(c.net.ack);
      readEvents(r, handler, flags, c.ents);
    }
  }
  const ran = []; // what the server's simulation did on our commands
  const handleSimEvent = game.handleSimEvent.bind(game);
  game.handleSimEvent = (p, ev) => {
    ran.push(ev.type);
    handleSimEvent(p, ev);
  };

  let buffer = null;
  let frame = 0;
  let checks = 0;
  let wrong = 0;
  let reloadCmds = 0; // commands that went out with R down
  const did = []; // what the prediction did: [frame of the command, event]
  // n frames (one command each) with these buttons really held; `slot`: a weapon switch asked for in the first
  const advance = (n, held = 0, slot = 255) => {
    for (; n > 0; n--) {
      now = (frame * 1000) / 60;
      while (toClient.length && toClient[0][0] <= now) onClientMessage(toClient.shift()[1]);
      while (toServer.length && toServer[0][0] <= now) game.onMessage(session, toServer.shift()[1]);
      if (c.pred && c.pred.hasServerState) {
        if (slot !== 255) c.pred.requestSlot(slot);
        slot = 255;
        const at = frame;
        c.pred.step(1 / 60, held, 0, 0, (evs) => evs.forEach((ev) => did.push([at, ev.type])), buffer);
        if (c.pred.lastOut.buttons & BTN.RELOAD) reloadCmds++;
        predAt.set(c.pred.seq, copyPlayerState(createPlayerState(), c.pred.state));
        for (let out; (out = c.pred.takeOutbox(1 / 60)); ) conn.sendInput(c.net.tick - 2, 0, out, c.pred.hash(out));
      }
      if (++frame % (60 / SERVER_TICK_RATE)) continue;
      const p = game.players.get(c.id);
      const seqBefore = p ? p.lastSeq : 0;
      game.update();
      const mine = p && p.lastSeq !== seqBefore && predAt.get(p.lastSeq);
      if (mine && !poked) {
        checks++;
        if (!samePlayerState(mine, p.shadow)) wrong++;
      }
      if (p) for (const k of predAt.keys()) if (((p.lastSeq - k) & 0xffff) < 0x8000) predAt.delete(k);
    }
  };
  const settle = Math.ceil((2 * LAG * 60) / 1000) + 30; // frames for a change made on the server to reach the prediction
  const poke = (fn) => {
    poked = true;
    fn(game.players.get(c.id));
    advance(settle);
    poked = false;
  };
  const since = (mark, type) => did.slice(mark).filter((d) => d[1] === type);
  const TAP = 3; // frames a click or a key press lasts
  const clicks = (n, every) => {
    for (let i = 0; i < n; i++) {
      advance(TAP, BTN.ATTACK);
      advance(every - TAP);
    }
  };
  let ok = true;
  const report = (pass, what) => {
    ok = ok && pass;
    console.log(`${pass ? 'PASS' : 'FAIL'}  input buffer: ${what}`);
  };

  advance(settle + 30); // joined, first state in
  // the pistol (a shot every 10 commands) clicked every 6: as it was, then with the buffer
  advance(40, 0, SLOT_PISTOL);
  let mark = did.length;
  clicks(10, 6);
  advance(20);
  const shotsBefore = since(mark, 'fire').length;
  advance(TAP, BTN.RELOAD);
  advance(100);
  buffer = new InputBuffer();
  mark = did.length;
  clicks(10, 6);
  advance(20);
  let shots = since(mark, 'fire');
  const gaps = shots.slice(1).map((d, i) => d[0] - shots[i][0]);
  // ...and the button held down is still one shot
  mark = did.length;
  advance(60, BTN.ATTACK);
  advance(20);
  const heldShots = since(mark, 'fire').length;
  report(shots.length === 7 && gaps.every((g) => g === 10) && shotsBefore === 5 && heldShots === 1, `10 clicks in a second fire the pistol ${shots.length} times, ${[...new Set(gaps)].join('/')} commands apart (${shotsBefore} without the buffer); held down, ${heldShots} shot`);

  // R while the pistol is being drawn (26 commands: it can act on the 25th after the switch)
  advance(40, 0, SLOT_MELEE);
  mark = did.length;
  let f0 = frame;
  advance(6, 0, SLOT_PISTOL);
  advance(TAP, BTN.RELOAD);
  advance(40);
  const reloads = since(mark, 'reload');
  report(reloads.length === 1 && reloads[0][0] - f0 === 25, `R 6 commands into the draw: ${reloads.length ? `the reload starts ${reloads[0][0] - f0} commands after the switch` : 'no reload'}`);
  advance(80);

  // a click in the draw: 5 commands in is not "a moment early" (20 to go), 18 in is
  advance(40, 0, SLOT_MELEE);
  mark = did.length;
  advance(5, 0, SLOT_PISTOL);
  advance(TAP, BTN.ATTACK);
  advance(40);
  const tooEarly = since(mark, 'fire').length;
  advance(40, 0, SLOT_MELEE);
  mark = did.length;
  f0 = frame;
  advance(18, 0, SLOT_PISTOL);
  advance(TAP, BTN.ATTACK);
  advance(40);
  shots = since(mark, 'fire');
  report(tooEarly === 0 && shots.length === 1 && shots[0][0] - f0 === 25, `a click 18 commands into the draw fires ${shots.length ? `${shots[0][0] - f0} commands after the switch` : 'nothing'}; one 5 commands in fires ${tooEarly} times`);

  // Space again before touching down
  const s = c.pred.state;
  f0 = frame;
  advance(TAP, BTN.JUMP);
  while (!s.onGround) advance(1);
  const air = frame - f0; // commands from the jump to the one that can jump again
  advance(30);
  mark = did.length;
  f0 = frame;
  advance(TAP, BTN.JUMP);
  advance(air - TAP - 7);
  advance(TAP, BTN.JUMP);
  advance(air + 30);
  const jumps = since(mark, 'jump');
  report(jumps.length === 2 && jumps[1][0] - f0 === air, `Space 7 commands before touchdown: ${jumps.length} jumps${jumps.length > 1 ? `, the second ${jumps[1][0] - f0 - air} commands after the first one can` : ''}`);

  // an automatic run dry with the trigger held: as it was, then with the buffer
  const arm = (p) => {
    p.state.weapons[SLOT_PRIMARY] = ITEM.AK47;
    p.state.mags[0] = 4;
    if (!p.state.ammo[AMMO.R762]) game.giveItem(p, ITEM.AMMO_762, 60);
  };
  buffer = null;
  poke(arm);
  advance(40, 0, SLOT_PRIMARY);
  mark = did.length;
  advance(90, BTN.ATTACK);
  advance(20);
  const reloadsBefore = since(mark, 'reload').length;
  buffer = new InputBuffer();
  poke(arm);
  mark = did.length;
  const r0 = reloadCmds;
  advance(240, BTN.ATTACK);
  advance(20);
  shots = since(mark, 'fire');
  const dry = since(mark, 'reload');
  report(dry.length === 1 && dry[0][0] - shots[3][0] === 1 && reloadCmds - r0 === 1 && shots.length > 4 && reloadsBefore === 0, `AK-47 emptied with the trigger held: ${dry.length ? `the reload starts ${dry[0][0] - shots[3][0]} command after the last round, R down in ${reloadCmds - r0} command, and it fires on after it` : 'no reload'} (${reloadsBefore} reloads without the buffer)`);

  // An early press is not carried over to another weapon. The pistol fired, clicked again and held through a switch
  // to the knife (which swings, as a held button always did), the same from the knife back to the pistol, and R in
  // the pistol's draw followed by a switch to the AK-47, whose draw ends while that R would still be held.
  advance(40, 0, SLOT_PISTOL);
  mark = did.length;
  advance(TAP, BTN.ATTACK);
  advance(1);
  advance(2, BTN.ATTACK);
  advance(60, BTN.ATTACK, SLOT_MELEE);
  advance(40);
  const pistolShots = since(mark, 'fire').length;
  mark = did.length;
  advance(TAP, BTN.ATTACK);
  advance(17);
  advance(2, BTN.ATTACK);
  advance(60, BTN.ATTACK, SLOT_PISTOL);
  advance(20);
  const carried = since(mark, 'fire').length;
  const swings = since(mark, 'melee').length;
  advance(40, 0, SLOT_MELEE);
  mark = did.length;
  advance(2, 0, SLOT_PISTOL);
  advance(TAP, BTN.RELOAD);
  advance(60, 0, SLOT_PRIMARY);
  const wrongGun = since(mark, 'reload').length;
  report(pistolShots === 1 && carried === 0 && swings === 1 && wrongGun === 0 && s.mags[0] < 30 && s.mags[1] < 12, `an early press and then a weapon switch: ${pistolShots - 1} more shots from the pistol left behind, ${carried} from the pistol switched to, ${wrongGun} reloads of the AK-47 for an R pressed on the pistol`);

  // straight on the buffer: an early click, then going down or losing the input before it can fire
  const fires = (how) => {
    const buf = new InputBuffer();
    const st = copyPlayerState(createPlayerState(), s);
    Object.assign(st, { slot: SLOT_PISTOL, switchT: 0, reloadT: 0, cooldown: 0.1, lastBtn: 0, downed: 0 });
    st.mags[1] = 5;
    let n = 0;
    for (let i = 0; i < 30; i++) {
      if (i === 1 && how === 'downed') st.downed = 1;
      if (i === 1 && how === 'menu') buf.clear();
      const cmd = { seq: i, buttons: how === 'menu' && i ? 0 : BTN.ATTACK, yaw: 0, pitch: 0, slot: 255 };
      cmd.buttons = buf.shape(cmd, st, c.pred.world);
      const evs = [];
      simulatePlayer(st, cmd, c.pred.world, evs);
      n += evs.filter((ev) => ev.type === 'fire').length;
    }
    return n;
  };
  report(fires('') === 1 && fires('downed') === 0 && fires('menu') === 0, `an early click fires ${fires('')} time if nothing happens, ${fires('downed')} if the player goes down first, ${fires('menu')} if a menu takes the input first`);

  advance(settle + 30);
  const same = did.map((d) => d[1]).join() === ran.join();
  report(wrong === 0 && stray === 0 && same && checks > 300, `at ${LAG} ms each way the server agreed with ${checks - wrong} of ${checks} predictions, rebased the client ${stray} times and ran ${same ? 'the same' : 'OTHER'} ${ran.length} events`);
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
if (!args.length) ok = runBuffer(100) && ok;
process.exit(ok ? 0 : 1);
