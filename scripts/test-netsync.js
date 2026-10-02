// Self-state sync test: the server only sends a client its own simulated state when the two can disagree, so check
// that they really do stay in agreement, and get back into it, on a laggy link.
// One client with the real Prediction / Connection / decoder walks, sprints, turns and jumps while every message is
// delayed (ordered, like TCP) by LAG ms each way plus jitter. Every 6 s the server shoves the player (a change the
// client cannot predict). Expected: the prediction of every command matches the server's result exactly, except for
// about a round trip after each shove; the server rebases the client only during that window and never in between.
// Then a link that hiccups (runStall): the commands that arrive late in one burst must not stay queued on the server.
// Then the input buffer (runBuffer): early presses of fire, reload and jump are performed, and only those.
// Last (runSteps), no server: the camera's step smoothing, which reads the prediction and must not be fooled by it.
// usage: node scripts/test-netsync.js [lagMs=100] [jitterMs=30]
import { Spring } from '../client/render/models/weapons.js';
import { Game } from '../server/game.js';
import { C2S, S2C, SNAP, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE, SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE } from '../shared/constants.js';
import { ITEM, AMMO } from '../shared/defs.js';
import { readHeader, readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';
import { Connection } from '../client/net/connection.js';
import { Prediction } from '../client/game/prediction.js';
import { InputBuffer } from '../client/game/inputbuffer.js';
import { createWorld } from '../shared/world.js';
import { makeCyl } from '../shared/collision.js';
import { createPlayerState, copyPlayerState, samePlayerState, simulatePlayer } from '../shared/playersim.js';

// Not netcode, but the same kind of promise: the viewmodel's springs (recoil, landing dip, look lag) must move the
// gun the same way whatever the frame time. The reference is what they were tuned as, one explicit step per frame at
// 60 fps. Kick each spring and run it in frames of 16, 33, 66, 100 and 500 ms, at 240 fps and in uneven frames.
// Expected: at every frame that falls on a 60 fps frame the spring is where the reference is, in between it never
// swings past the reference's furthest frame by more than the curve does (one long frame used to throw the gun
// the wrong way, 10 fps used to diverge), and it comes to rest on its target.
function runSprings() {
  // [k, c] as in ViewModel's constructor: recoil back / pitch / yaw, the landing dip, the look lag
  const SPRINGS = [[260, 22], [200, 18], [150, 16], [120, 22], [160, 25]];
  const KICK = 2;
  const N = 180; // 3 s of 60 fps frames
  const ref = new Float64Array(N + 1);
  let rs = 5;
  const rnd = () => ((rs = (Math.imul(rs, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  const bad = [];
  let worst = 0; // furthest from the reference, as a share of its peak
  let reach = 0; // furthest swing, as a share of the reference's
  for (const [k, c] of SPRINGS) {
    let x = 0, v = KICK, peak = 0;
    for (let i = 1; i <= N; i++) {
      v += (-k * x - c * v) / 60;
      x += v / 60;
      ref[i] = x;
      peak = Math.max(peak, Math.abs(x));
    }
    // frames of `every` 60ths of a second; 0: uneven frames of 2 to 60 ms that meet the reference every 6th of a second
    for (const every of [1, 2, 4, 6, 30, 0.25, 0]) {
      const s = new Spring(k, c);
      s.v += KICK;
      let at = 0; // time so far, in 60ths
      while (at < N - 1e-9) {
        let d = every;
        if (!every) {
          const next = Math.min(N, (Math.floor(at / 10 + 1e-9) + 1) * 10);
          d = Math.min(0.12 + rnd() * 3.5, next - at);
          if (next - at - d < 0.01) d = next - at;
        }
        at += d;
        s.step(d / 60);
        if (!(Math.abs(s.x) <= peak * 1.02)) bad.push(`k ${k} c ${c}, frames of ${every || 'uneven'}/60 s: swung to ${(s.x / peak).toFixed(2)} of the 60 fps peak`);
        reach = Math.max(reach, Math.abs(s.x) / peak);
        const i = Math.round(at);
        if (Math.abs(at - i) < 1e-9) worst = Math.max(worst, Math.abs(s.x - ref[i]) / peak);
      }
      if (!(Math.abs(s.x) < peak * 1e-4 && Math.abs(s.v) < KICK * 1e-4)) bad.push(`k ${k} c ${c}, frames of ${every || 'uneven'}/60 s: not at rest after 3 s (${s.x})`);
    }
    // a target other than 0, and one frame much longer than anything a browser delivers
    const s = new Spring(k, c);
    s.step(0.5, 1);
    s.step(1e6, 1);
    if (!(Math.abs(s.x - 1) < 1e-9)) bad.push(`k ${k} c ${c}: rests at ${s.x} with its target at 1`);
  }
  if (!(worst < 1e-9)) bad.push(`up to ${worst.toExponential(1)} of the peak away from the 60 fps motion`);
  // a spring too stiff for a 60 Hz step at all still settles
  const stiff = new Spring(9000, 150);
  stiff.v += KICK;
  let far = 0;
  for (let i = 0; i < 30; i++) far = Math.max(far, Math.abs(stiff.step(1 / 30)));
  if (!(far < KICK / 60 && Math.abs(stiff.x) < 1e-9)) bad.push(`a stiff spring swung to ${far} and ended at ${stiff.x}`);
  const ok = !bad.length;
  console.log(`${ok ? 'PASS' : 'FAIL'}  viewmodel springs at any frame time: ${ok ? `${SPRINGS.length} springs in frames of 16, 33, 66, 100 and 500 ms, at 240 fps and in uneven frames stay within ${worst.toExponential(1)} of the 60 fps motion's peak, swing at most ${reach.toFixed(3)} times as far and come to rest` : bad.slice(0, 4).join('; ')}`);
  return ok;
}

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

// The camera's step smoothing (Prediction.viewLag) is presentation only, but it lives on the prediction and has to
// keep out of its way. Walk a prediction onto a 0.3 m slab and back off it, at a steady 60 fps and at an uneven
// frame rate (frames that run no command, or several). Expected: the feet take the step within one command while
// the camera height (render feet - lag) takes it a few centimetres a frame, never moves against it and ends level;
// on bare terrain and in a jump there is no lag at all, and neither a teleport nor a correction leaves any behind.
function runSteps() {
  const world = createWorld(4242);
  const out = { x: 0, y: 0, z: 0 };
  let rs = 99;
  const rnd = () => ((rs = (Math.imul(rs, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  const spawn = (x, z, y = world.heightAt(x, z)) => {
    const pred = new Prediction(world);
    const s = createPlayerState();
    s.x = x;
    s.z = z;
    s.y = y;
    pred.reconcile(0, s);
    return pred;
  };
  // frames of dtOf() seconds; returns per frame the feet as drawn, the camera height under the eye and the lag
  const run = (pred, seconds, dtOf, buttons, yaw) => {
    const T = [];
    for (let t = 0; t < seconds; ) {
      const dt = dtOf();
      t += dt;
      pred.step(dt, typeof buttons === 'function' ? buttons(T.length) : buttons, yaw, 0, () => {});
      pred.renderPos(dt, out);
      const lag = pred.viewLag(dt);
      T.push({ feet: out.y, cam: out.y - lag, lag, slab: pred.footing(pred.state) === 2, air: !pred.state.onGround });
    }
    return T;
  };
  // open ground by the car: a heading on which 2 s of walking meets nothing but terrain
  const x0 = world.car.x + 9;
  const z0 = world.car.z + 9;
  let yaw = -1;
  for (let k = 0; k < 16 && yaw < 0; k++) {
    const pred = spawn(x0, z0);
    const T = run(pred, 2, () => 1 / 60, BTN.FWD, k * 0.4);
    if (Math.hypot(pred.state.x - x0, pred.state.z - z0) > 8 && T.every((f) => !f.slab && !f.air && f.lag === 0)) yaw = k * 0.4;
  }
  if (yaw < 0) {
    console.log('FAIL  camera over a step: no open ground by the car to test on');
    return false;
  }
  // the slab: a disc 0.3 m proud of the ground where its near edge is, 3 m ahead
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const top = world.heightAt(x0 + fx * 3, z0 + fz * 3) + 0.3;
  world.staticGrid.add(makeCyl(x0 + fx * 5, z0 + fz * 5, top - 2, top, 2));

  const bad = [];
  let report = '';
  for (const [name, dtOf, perFrame] of [
    ['60 fps', () => 1 / 60, 0.06],
    ['uneven frames', () => (0.3 + 1.9 * rnd()) / 60, 0.12],
  ]) {
    const pred = spawn(x0, z0);
    const up = run(pred, 1.2, dtOf, BTN.FWD, yaw);
    up.push(...run(pred, 1, dtOf, 0, yaw)); // standing on it
    const i0 = up.findIndex((f) => f.slab);
    let feetUp = 0;
    let camUp = 0;
    let against = 0;
    for (let i = 1; i < up.length; i++) {
      feetUp = Math.max(feetUp, up[i].feet - up[i - 1].feet);
      if (i < i0) continue;
      camUp = Math.max(camUp, up[i].cam - up[i - 1].cam);
      against = Math.min(against, up[i].cam - up[i - 1].cam);
    }
    if (i0 < 0 || up.slice(0, i0).some((f) => f.lag !== 0)) bad.push(`${name}: lag on bare terrain`);
    if (feetUp < 0.15) bad.push(`${name}: the feet never stepped up (+${feetUp.toFixed(3)})`);
    if (camUp > perFrame) bad.push(`${name}: the camera rose ${camUp.toFixed(3)} m in one frame`);
    if (against < -0.005) bad.push(`${name}: the camera moved ${against.toFixed(3)} m against the step`);
    if (Math.abs(up.at(-1).lag) > 1e-3 || Math.abs(up.at(-1).cam - top) > 1e-3) bad.push(`${name}: not level after the step (${up.at(-1).lag.toFixed(4)})`);
    // a jump on the slab is not a step
    const hop = run(pred, 1.2, dtOf, (i) => (i < 4 ? BTN.JUMP : 0), yaw);
    if (!hop.some((f) => f.air) || hop.some((f) => Math.abs(f.lag) > 1e-3)) bad.push(`${name}: a jump was lagged`);
    // and back off it
    const down = run(pred, 1.2, dtOf, BTN.FWD, yaw + Math.PI);
    down.push(...run(pred, 1, dtOf, 0, yaw));
    let feetDown = 0;
    let camDown = 0;
    for (let i = 1; i < down.length; i++) {
      feetDown = Math.min(feetDown, down[i].feet - down[i - 1].feet);
      camDown = Math.min(camDown, down[i].cam - down[i - 1].cam);
    }
    if (feetDown > -0.15) bad.push(`${name}: the feet never stepped down (${feetDown.toFixed(3)})`);
    if (camDown < -perFrame) bad.push(`${name}: the camera dropped ${camDown.toFixed(3)} m in one frame`);
    if (Math.abs(down.at(-1).lag) > 1e-3) bad.push(`${name}: not level after stepping down`);
    report += `${report ? '; ' : ''}${name}: feet +${feetUp.toFixed(3)} / ${feetDown.toFixed(3)} m in one frame, camera +${camUp.toFixed(3)} / ${camDown.toFixed(3)}`;
  }
  // a teleport in the frame of the step: nothing left to ease
  {
    const pred = spawn(x0, z0);
    while (pred.footing(pred.state) !== 2 && pred.seq < 600) run(pred, 1 / 60, () => 1 / 60, BTN.FWD, yaw);
    const lag = pred.lag;
    const far = copyPlayerState(createPlayerState(), pred.state);
    far.x = x0 - fx * 40;
    far.z = z0 - fz * 40;
    far.y = world.heightAt(far.x, far.z);
    pred.reconcile(pred.seq, far);
    const T = run(pred, 0.2, () => 1 / 30, 0, yaw);
    if (lag < 0.15 || T.some((f) => f.lag !== 0)) bad.push(`teleport: lag ${lag.toFixed(3)} before, ${T[0].lag.toFixed(3)} after`);
  }
  // a correction that moves the feet from the slab to the ground beside it is not a step either
  {
    const pred = spawn(x0 + fx * 5, z0 + fz * 5, top);
    run(pred, 0.3, () => 1 / 30, 0, yaw);
    const off = copyPlayerState(createPlayerState(), pred.state);
    off.x = x0 + fx * 2.4;
    off.z = z0 + fz * 2.4;
    off.y = world.heightAt(off.x, off.z);
    pred.reconcile(pred.seq, off);
    const T = run(pred, 0.3, () => 1 / 30, 0, yaw);
    if (pred.corrections !== 1 || T.some((f) => f.slab || Math.abs(f.lag) > 1e-9)) bad.push(`correction: left a lag of ${Math.max(...T.map((f) => Math.abs(f.lag))).toFixed(3)}`);
  }
  const ok = !bad.length;
  console.log(`${ok ? 'PASS' : 'FAIL'}  camera over a 0.3 m step: ${ok ? report + '; none on terrain, in a jump, after a teleport or a correction' : bad.join('; ')}`);
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
if (!args.length) ok = runSprings() && ok;
for (const [lag, jit] of cases) ok = run(lag, jit) && ok;
if (!args.length) for (const hold of [300, 700, 1500]) ok = runStall(hold) && ok;
if (!args.length) ok = runBuffer(100) && ok;
if (!args.length) ok = runSteps() && ok;
process.exit(ok ? 0 : 1);
