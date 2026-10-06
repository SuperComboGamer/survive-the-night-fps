// Blows on the world and wrecks taken apart (shared/surfaces.js, shared/wrecks.js, server/game.js strike / wreckHit,
// client/game/impacts.js, client/render/marks.js / wrecks.js), in node with no browser:
//   - the server: a hit on a wreck is put on its record and told to everybody; what is left in it goes down with the
//     salvage and comes back at dawn; who joins late, or comes back, is told every wreck as it is; the salvage a hit
//     gives is what it gave before any of this; a blast is a blow that gives nothing; a wreck nobody hit has no
//     record; the alarm's rules (its chance, the warning before it, the noise it makes, how it is silenced);
//   - the tables: what every material and every prop is made of, the mark and the sound each kind of blow makes on
//     each, a bullet hole's size and pattern by the gun;
//   - the marks: the cap under sustained fire, the fade, nothing done at rest, marks going with what they are on;
//   - the client's own judging, against a real static world: a knife on a plank wall, a rifle into brick, a window
//     shot out, a structure torn down taking its holes with it, a wreck that looks the same to whoever watched it
//     being hit and to whoever arrives afterwards, and that goes back into the static world at dawn.
// usage: node scripts/test-wrecks.js [seed]
import './clip/dom-stub.js';
import { Game } from '../server/game.js';
import { C2S, S2C, SNAP, PROTOCOL_VERSION, Writer, Reader, qpos, dqpos, usePos } from '../shared/protocol.js';
import { ITEM, EVT, WEAPONS, STRUCT } from '../shared/defs.js';
import { PROPS } from '../shared/props.js';
import { COL, makeBox, raycastWorld } from '../shared/collision.js';
import { eyeHeight } from '../shared/playersim.js';
import { SURF, BLOW, MARK, SURF_NAMES, BLOW_NAMES, surfaceOfMat, surfaceOfProp, surfaceOf, markFor, shotMark, shotScale, soundFor, blowOf, blowForce, bitsFor, STRIKE_SOUNDS, LIGHT_PROPS, GRAZE_MAX } from '../shared/surfaces.js';
import { WRECK_SALVAGE, WRECK_HITS_MAX, HITF, WRECKF, WRECK_ALARM, ALARM, ALARM_SAY, alarmStep, wreckOf, wreckColAt } from '../shared/wrecks.js';
import { saveGame } from '../server/gamestate.js';
import { randomUUID } from 'node:crypto';

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`);
  if (!ok) fails.push(name);
};

// ================================================================== the server
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
// every event as it is emitted: { bytes, opts } (who would get it is opts: to / x, z, r)
let sent = [];
{
  const emit = game.emit.bind(game);
  game.emit = (fn, opts = {}) => {
    emit(fn, opts);
    sent.push({ bytes: game.events[game.events.length - 1].bytes, opts });
  };
}
const { readEvents } = await import('../client/net/decode.js');
// the events of `list` as the client's decoder reads them: [[name, ...args]]
function decode(list) {
  const out = [];
  const handler = new Proxy({}, { get: (_, name) => (...a) => out.push([name, ...a]) });
  for (const { bytes } of list) {
    const b = new Uint8Array(bytes.length + 1);
    b[0] = 1;
    b.set(bytes, 1);
    readEvents(new Reader(b.buffer), handler, SNAP.EVENTS, new Map());
  }
  return out;
}
const reaches = (ev, p) => (!ev.opts.to || ev.opts.to === p.id) && (!ev.opts.r || Math.hypot(ev.opts.x - p.state.x, ev.opts.z - p.state.z) <= ev.opts.r);

function client(name, pid = randomUUID()) {
  const c = { name, id: 0 };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  };
  c.join = () => {
    c.session = game.onOpen(c.conn);
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    w.str(pid);
    game.onMessage(c.session, w.bytes().slice());
  };
  c.join();
  c.p = () => game.players.get(c.id);
  return c;
}
const tick = (n = 1) => {
  for (let i = 0; i < n; i++) game.update();
};

const A = client('Alice');
const a = A.p();
tick(2);
const world = game.world;
usePos(world);
const wreckCols = [];
for (const pr of world.props) {
  if (pr.type !== 'car_wreck') continue;
  const col = world.staticGrid.query(pr.x, pr.z, 3, []).find((c) => c.tag === pr);
  if (col) wreckCols.push(col);
}
check('the world tags a wreck\'s collider with its prop', wreckCols.length > 5 && wreckCols.every((c) => wreckOf(c) === c.tag && c.flags & COL.SALVAGE), `${wreckCols.length} car wrecks`);

// stand a player beside a wreck's side, looking at it, and swing. frac: where along it (-1 its nose .. 1 its tail)
function standAt(p, col, frac = 0, height = 0.75) {
  const pr = col.tag;
  const c = Math.cos(pr.ry), s = Math.sin(pr.ry);
  const lx = col.hx + 1.0, lz = frac * col.hz * 0.85;
  const st = p.state;
  st.x = pr.x + c * lx + s * lz;
  st.z = pr.z - s * lx + c * lz;
  st.y = world.heightAt(st.x, st.z);
  const tx = pr.x + s * lz, tz = pr.z + c * lz, ty = pr.y + height;
  const ex = st.x, ey = st.y + eyeHeight(st), ez = st.z;
  st.yaw = Math.atan2(-(tx - ex), -(tz - ez));
  st.pitch = Math.atan2(ty - ey, Math.hypot(tx - ex, tz - ez));
}
function swing(p, col, weapon = ITEM.BAT, frac = 0, heavy = false) {
  standAt(p, col, frac);
  // (the day's walkers out of the way: a swing that meets one never reaches the wreck)
  for (const z of game.zombies) z.x = z.z = 1e6;
  game.zm.rebuildHash();
  sent = [];
  game.combat.melee(p, { weapon, heavy });
  return decode(sent);
}
// (only wrecks that stand clear: every swing of the tests below lands on the wreck it is aimed at)
{
  const st = a.state;
  const keep = wreckCols.filter((col) =>
    [-0.8, -0.5, -0.2, 0, 0.2, 0.5, 0.7].every((frac) => {
      standAt(a, col, frac);
      const cp = Math.cos(st.pitch);
      const r = raycastWorld(world, st.x, st.y + eyeHeight(st), st.z, -Math.sin(st.yaw) * cp, Math.sin(st.pitch), -Math.cos(st.yaw) * cp, 2.6, { t: -1 });
      return r.col === col;
    }),
  );
  wreckCols.length = 0;
  wreckCols.push(...keep);
  check('the valley has wrecks standing clear to test on', wreckCols.length >= 7, `${wreckCols.length}`);
}
const far = client('Bob');
const b = far.p();
tick(1);

// ---- a hit is recorded and sent to everyone
{
  const col = wreckCols[0];
  b.state.x = col.x + 400; // (far beyond the reach of any effect)
  b.state.z = col.z;
  const evs = swing(a, col, ITEM.BAT, 0.2);
  const strike = evs.find((e) => e[0] === 'strike');
  const wreck = evs.find((e) => e[0] === 'wreck');
  check('a swing at a wreck sends EVT.STRIKE: who, the blow, where, which way', !!strike && strike[1] === a.id && strike[2] === BLOW.BLUNT && strike[3] === false && Math.hypot(strike[4] - col.x, strike[6] - col.z) < 3.5, JSON.stringify(strike));
  const g = game.gather.get(col);
  check('...and puts it on the wreck\'s record', g && g.hits.length === 1 && g.left === WRECK_SALVAGE - 1 && (g.hits[0][5] & HITF.BLOW) === BLOW.BLUNT && !!(g.hits[0][5] & HITF.TOOK));
  check('EVT.WRECK names the wreck by its collider and carries the hit and what is left', !!wreck && wreck[1] === 0 && wreck[2] === qpos(col.x) && wreck[3] === qpos(col.y0) && wreck[4] === qpos(col.z) && wreck[5] === WRECK_SALVAGE - 1 && wreck[6].length === 1 && wreck[6][0].join() === g.hits[0].join(), JSON.stringify(wreck));
  const wEv = sent.find((e) => e.bytes[0] === EVT.WRECK), sEv = sent.find((e) => e.bytes[0] === EVT.STRIKE);
  check('the record goes to everybody, however far; the strike only to who is near', reaches(wEv, b) && reaches(wEv, a) && reaches(sEv, a) && !reaches(sEv, b));
  check('a wreck\'s collider is found again by its name', wreckColAt(world, wreck[2], wreck[3], wreck[4]) === col);
  check('the hit is where the swing landed, on the side it was swung at', Math.hypot(dqpos(g.hits[0][0]) - strike[4], dqpos(g.hits[0][2]) - strike[6]) < 0.05);
  check('no sound of its own any more: the strike is the sound', !evs.some((e) => e[0] === 'sound' && e[1] !== 5), evs.filter((e) => e[0] === 'sound').join(' | ')); // (5: the swing's whoosh)
}

// ---- the stages advance with the salvage, and the yield is what it was
{
  const col = wreckCols[1];
  const lefts = [];
  // the stream of random numbers a hit draws: gatherHit's come first, then the alarm's
  const given = [];
  const giveOrDrop = game.giveOrDrop.bind(game);
  game.giveOrDrop = (p, item, n) => {
    given.push([item, n]);
    giveOrDrop(p, item, n);
  };
  const rng = game.rng;
  let draws = [];
  game.rng = () => {
    const v = rng();
    draws.push(v);
    return v;
  };
  let same = true, stripped = 0;
  for (let i = 0; i < 7; i++) {
    const weapon = [ITEM.BAT, ITEM.HAMMER, ITEM.KNIFE, ITEM.MACHETE, ITEM.BAT, ITEM.BAT, ITEM.KNIFE][i];
    given.length = 0;
    draws = [];
    const evs = swing(a, col, weapon, -0.5 + i * 0.15);
    const w = evs.find((e) => e[0] === 'wreck');
    if (w) lefts.push(w[5]);
    stripped += evs.filter((e) => e[0] === 'stripped').length;
    // what a hit gave before (Game.gatherHit on main, word for word), from the same draws
    const want = [];
    if (i < WRECK_SALVAGE) {
      let k = 0;
      const r = () => draws[k++];
      want.push([ITEM.SCRAP, weapon === ITEM.HAMMER ? 1 + (r() < 0.5 ? 1 : 0) : 1]);
      if (r() < 0.3) want.push([ITEM.NAILS, 2 + Math.floor(r() * 3)]);
      if (r() < 0.08) want.push([ITEM.TAPE, 1]);
      if (r() < 0.05) want.push([ITEM.WIRE, 1]);
      if (r() < 0.04) want.push([ITEM.BATTERY, 1]);
    }
    if (JSON.stringify(want) !== JSON.stringify(given)) same = false;
  }
  game.giveOrDrop = giveOrDrop;
  game.rng = rng;
  check('what is left goes down a hit at a time: 4, 3, 2, 1, 0', lefts.slice(0, 5).join() === '4,3,2,1,0', lefts.join());
  check('the salvage a hit gives is unchanged (the same draws give the same items as before)', same);
  check('picked clean after five: told once (EVT.STRIPPED), and later hits give nothing but are still recorded', stripped === 1 && game.gather.get(col).left === 0 && game.gather.get(col).hits.length === 7);
  // the record has a cap
  for (let i = 0; i < 10; i++) swing(a, col, ITEM.BAT, 0);
  const evs = swing(a, col, ITEM.BAT, 0);
  check(`a wreck remembers ${WRECK_HITS_MAX} blows: later ones are a strike and no more`, game.gather.get(col).hits.length === WRECK_HITS_MAX && evs.some((e) => e[0] === 'strike') && !evs.some((e) => e[0] === 'wreck'));
}

// ---- nothing happens to a wreck that is not hit; a swing at a wall is a strike and no record
{
  check('a wreck nobody hit has no record', !game.gather.has(wreckCols[2]) && [...game.gather.keys()].filter((c) => wreckOf(c)).length === 2);
  // a wall: any static box that is no prop
  let wall = null;
  for (const cell of world.staticGrid.cells) {
    wall = cell.find((c) => typeof c.tag === 'string' && c.type === 0 && c.y1 - c.y0 > 2 && c.hx > 1.5 && c.hz < 0.3 && (c.tag === 'planks' || c.tag === 'clapboard' || c.tag === 'barn'));
    if (wall) break;
  }
  const st = a.state;
  let evs = [];
  // (from either face: whichever is not blocked)
  for (const side of [1, -1]) {
    st.x = wall.x + wall.s * side * (wall.hz + 1.1);
    st.z = wall.z + wall.c * side * (wall.hz + 1.1);
    st.y = world.heightAt(st.x, st.z);
    st.yaw = Math.atan2(-(wall.x - st.x), -(wall.z - st.z));
    st.pitch = 0;
    sent = [];
    game.combat.melee(a, { weapon: ITEM.KNIFE, heavy: false });
    evs = decode(sent);
    if (evs.some((e) => e[0] === 'strike')) break;
  }
  const strike = evs.find((e) => e[0] === 'strike');
  check('a knife swung at a wall: EVT.STRIKE (a slash), no impact event, nothing recorded', !!strike && strike[2] === BLOW.SLASH && !evs.some((e) => e[0] === 'wreck' || e[0] === 'impact'), JSON.stringify(evs.map((e) => e[0])));
}

// ---- a blast is a blow that gives nothing
{
  const col = wreckCols[3];
  const pr = col.tag;
  const inv = JSON.stringify(a.inv);
  sent = [];
  game.combat.explode(pr.x + Math.cos(pr.ry) * 2.2, pr.y + 0.5, pr.z - Math.sin(pr.ry) * 2.2, 6, { zombies: 100, kind: 0 });
  const evs = decode(sent);
  const w = evs.find((e) => e[0] === 'wreck' && e[2] === qpos(col.x) && e[4] === qpos(col.z));
  check('a blast beside a wreck is a blow on its record (BLAST), takes none of its salvage and gives no scrap', !!w && (w[6][0][5] & HITF.BLOW) === BLOW.BLAST && !(w[6][0][5] & HITF.TOOK) && w[5] === WRECK_SALVAGE && JSON.stringify(a.inv) === inv, JSON.stringify(w));
}

// ---- late joiners and rejoiners
{
  sent = [];
  const C = client('Carol');
  const c = C.p();
  const mine = decode(sent.filter((e) => e.opts.to === c.id));
  const replay = mine.filter((e) => e[0] === 'wreck');
  const on = [...game.gather].filter(([col, g]) => wreckOf(col) && g.hits?.length);
  const ok = replay.length === on.length && replay.every((e) => e[1] === WRECKF.REPLAY) && on.every(([col, g]) => replay.some((e) => e[2] === qpos(col.x) && e[4] === qpos(col.z) && e[5] === Math.max(0, g.left) && JSON.stringify(e[6]) === JSON.stringify(g.hits)));
  check('who joins late is told every wreck on record: the whole of it, marked as a replay', ok && on.length === 3, `${replay.length} of ${on.length}`);
  check('...and which are picked clean, as before (EVT.STRIPPED)', mine.filter((e) => e[0] === 'stripped').length === 1);
  // drops, and comes back to the same body
  const id = C.id;
  game.onClose(C.session);
  tick(3);
  sent = [];
  C.join();
  const back = decode(sent.filter((e) => e.opts.to === C.id));
  check('who comes back after a drop is told them again', C.id === id && back.filter((e) => e[0] === 'wreck').length === on.length, `id ${id} -> ${C.id}, ${back.filter((e) => e[0] === 'wreck').length}`);
  // what a deploy hands on keeps them
  const save = JSON.parse(JSON.stringify(saveGame(game)));
  const kept = save.gather.filter(([, v]) => v.hits && v.hits.length);
  check('a save keeps every wreck\'s record', kept.length === on.length && kept.some(([, v]) => v.hits.length === WRECK_HITS_MAX));
}

// ---- the alarm
{
  // the rule itself
  const seq = (list) => {
    let k = 0;
    return () => list[k++];
  };
  const T = 'car_wreck';
  check('alarm: a knife never wakes it, whatever its state', [ALARM.UNKNOWN, ALARM.LIVE, ALARM.WARNED].every((s) => alarmStep(s, T, BLOW.SLASH, 0, () => 0).join() === `${s},-1`));
  check('alarm: the first hard blow settles whether the battery lives - and if it does, the answer is a chirp, never the alarm', alarmStep(ALARM.UNKNOWN, T, BLOW.BLUNT, 0, seq([WRECK_ALARM.live - 0.001])).join() === `${ALARM.WARNED},${ALARM_SAY.CHIRP}` && alarmStep(ALARM.UNKNOWN, T, BLOW.BLUNT, 0, seq([WRECK_ALARM.live])).join() === `${ALARM.DEAD},-1`);
  check('alarm: only cars and vans have one', alarmStep(ALARM.UNKNOWN, 'tractor', BLOW.BLUNT, 0, () => 0)[0] === ALARM.DEAD && alarmStep(ALARM.UNKNOWN, 'school_bus', BLOW.BLUNT, 0, () => 0)[0] === ALARM.DEAD && WRECK_ALARM.types.every((t) => PROPS[t]?.salvage));
  check('alarm: once it has chirped a hard blow sets it off with its chance, a dead or spent one never', alarmStep(ALARM.WARNED, T, BLOW.CHOP, 0, seq([WRECK_ALARM.trip - 0.001])).join() === `${ALARM.RINGING},${ALARM_SAY.RING}` && alarmStep(ALARM.WARNED, T, BLOW.CHOP, 0, seq([WRECK_ALARM.trip])).join() === `${ALARM.WARNED},-1` && alarmStep(ALARM.DEAD, T, BLOW.BLUNT, 0, () => 0)[1] === -1 && alarmStep(ALARM.SPENT, T, BLOW.BLUNT, 0, () => 0)[1] === -1);
  check('alarm: ringing, any blow on the bonnet end kills it (a knife too), a blow elsewhere does not', alarmStep(ALARM.RINGING, T, BLOW.SLASH, -0.6, () => 0).join() === `${ALARM.SPENT},${ALARM_SAY.QUIET}` && alarmStep(ALARM.RINGING, T, BLOW.BLUNT, 0.5, () => 0).join() === `${ALARM.RINGING},-1`);
  // the share of wrecks that ring if a player ignores the warning for the rest of the salvage
  let rings = 0;
  const N = 20000;
  let s = 12345;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < N; i++) {
    let st = ALARM.UNKNOWN;
    for (let h = 0; h < WRECK_SALVAGE && st !== ALARM.RINGING; h++) [st] = alarmStep(st, T, BLOW.BLUNT, 0, r);
    if (st === ALARM.RINGING) rings++;
  }
  const expect = WRECK_ALARM.live * (1 - (1 - WRECK_ALARM.trip) ** (WRECK_SALVAGE - 1));
  check(`alarm: a wreck stripped with a bat rings ${(expect * 100).toFixed(0)}% of the time (and never with a knife)`, Math.abs(rings / N - expect) < 0.01, `${(rings / N).toFixed(3)} vs ${expect.toFixed(3)}`);

  // in the game: the chirp, the ring, the noise, the silencing
  for (const g of game.gather.values()) g.alarm = ALARM.DEAD; // (whatever the wrecks hit above did of their own: quiet now)
  game.ringing.clear();
  const col = wreckCols[4];
  const noises = [];
  const noise = game.zm.noise.bind(game.zm);
  game.zm.noise = (x, z, loud, y) => {
    noises.push([x, z, loud]);
    return noise(x, z, loud, y);
  };
  const rng = game.rng;
  game.rng = () => 0; // (the battery lives, and every chance comes up)
  let evs = swing(a, col, ITEM.BAT, 0.5);
  const chirp = evs.find((e) => e[0] === 'wreckAlarm');
  check('a hard blow on a live one: a chirp (EVT.WRECK_ALARM), and it is not ringing', !!chirp && chirp[4] === ALARM_SAY.CHIRP && game.gather.get(col).alarm === ALARM.WARNED && !game.ringing.size, JSON.stringify(chirp));
  evs = swing(a, col, ITEM.KNIFE, 0.5);
  check('a knife after the chirp: nothing', !evs.some((e) => e[0] === 'wreckAlarm') && game.gather.get(col).alarm === ALARM.WARNED);
  evs = swing(a, col, ITEM.BAT, 0.5);
  const ring = evs.find((e) => e[0] === 'wreckAlarm');
  check('the next hard blow sets it off: told with how long it will ring', !!ring && ring[4] === ALARM_SAY.RING && ring[5] === WRECK_ALARM.ring && game.ringing.has(col));
  game.rng = rng;
  noises.length = 0;
  sent = [];
  const ticks = Math.round(7 / 0.05);
  tick(ticks);
  const mine = noises.filter((n) => n[2] === WRECK_ALARM.noise && Math.hypot(n[0] - col.x, n[1] - col.z) < 0.01);
  check(`ringing, it makes a noise the dead hear every ${WRECK_ALARM.pulse} s (Zombies.noise, ${WRECK_ALARM.noise} m): 3 in 7 s`, mine.length === 3, `${mine.length} (${noises.length} noises, ringing ${game.ringing.size}, state ${game.gather.get(col)?.alarm})`);
  // a joiner hears it too
  sent = [];
  const D = client('Dan');
  const told = decode(sent.filter((e) => e.opts.to === D.id)).find((e) => e[0] === 'wreckAlarm');
  check('who joins while it rings is told it is ringing, and for how much longer', !!told && told[4] === ALARM_SAY.RING && told[5] > 0 && told[5] <= WRECK_ALARM.ring - 6, JSON.stringify(told));
  // a blow on the bonnet kills it
  evs = swing(a, col, ITEM.KNIFE, -0.8);
  const quiet = evs.find((e) => e[0] === 'wreckAlarm');
  check('a blow on the bonnet end kills it', !!quiet && quiet[4] === ALARM_SAY.QUIET && !game.ringing.size && game.gather.get(col).alarm === ALARM.SPENT);
  noises.length = 0;
  tick(ticks);
  check('...and it makes no more noise, nor rings again that day', !noises.some((n) => n[2] === WRECK_ALARM.noise) && !swing(a, col, ITEM.BAT, 0.5).some((e) => e[0] === 'wreckAlarm'));
  // one left alone runs down
  const col2 = wreckCols[5];
  game.rng = () => 0;
  swing(a, col2, ITEM.BAT, 0.5);
  swing(a, col2, ITEM.BAT, 0.5);
  game.rng = rng;
  sent = [];
  tick(Math.round((WRECK_ALARM.ring + 0.5) / 0.05));
  check(`left alone it runs down after ${WRECK_ALARM.ring} s`, decode(sent).some((e) => e[0] === 'wreckAlarm' && e[4] === ALARM_SAY.QUIET) && !game.ringing.size);
  game.zm.noise = noise;
}

// ---- dawn
{
  const before = [...game.gather].filter(([col]) => wreckOf(col)).length;
  sent = [];
  game.dawn ? game.dawn() : null;
  let regrown = decode(sent).some((e) => e[0] === 'regrown');
  if (!regrown) {
    // (whatever this build calls the morning: run the clock to it)
    for (let i = 0; i < 20 && !regrown; i++) {
      game.timeLeft = 0.01;
      sent = [];
      tick(3);
      regrown = decode(sent).some((e) => e[0] === 'regrown');
    }
  }
  const cleared = ![...game.gather.keys()].some((c) => wreckOf(c)) && !game.ringing.size;
  // (the night left its dead about: out of the way of the swing)
  const evs = swing(a, wreckCols[1], ITEM.BAT, 0);
  const w = evs.find((e) => e[0] === 'wreck');
  check('at dawn every record is forgotten (EVT.REGROWN): the wrecks give again, from a clean record', regrown && before >= 5 && cleared && (!w || (w[5] === WRECK_SALVAGE - 1 && game.gather.get(wreckCols[1]).hits.length === 1)), `regrown ${regrown}, ${before} records before, cleared ${cleared}, ${JSON.stringify(w)}`);
}

// ================================================================== the tables
{
  check('materials: wood, stone, metal, glass, cloth, earth', surfaceOfMat('planks') === SURF.WOOD && surfaceOfMat('logwall') === SURF.WOOD && surfaceOfMat('brick') === SURF.STONE && surfaceOfMat('concrete') === SURF.STONE && surfaceOfMat('tin') === SURF.METAL && surfaceOfMat('carpaint') === SURF.METAL && surfaceOfMat('glass') === SURF.GLASS && surfaceOfMat('canvas') === SURF.CLOTH && surfaceOfMat('tire') === SURF.RUBBER && surfaceOfMat('earth') === SURF.EARTH);
  const parts = new Set(world.parts.map((p) => p.mat));
  const { MATERIAL_NAMES } = await import('../client/render/materials.js');
  check('every material the world is built of is a material the game has', [...parts].every((m) => MATERIAL_NAMES.includes(m)));
  check('props: by what they are', surfaceOfProp('car_wreck') === SURF.METAL && surfaceOfProp('barrel') === SURF.METAL && surfaceOfProp('crate') === SURF.WOOD && surfaceOfProp('fence') === SURF.WOOD && surfaceOfProp('tent') === SURF.CLOTH && surfaceOfProp('gravestone') === SURF.STONE && surfaceOfProp('jersey_barrier') === SURF.STONE && surfaceOfProp('sandbags') === SURF.CLOTH && Object.keys(PROPS).every((t) => surfaceOfProp(t) >= 0 && surfaceOfProp(t) <= 6));
  check('every vehicle that gives scrap is metal, and nothing light enough to rock is one', Object.keys(PROPS).filter((t) => PROPS[t].salvage).every((t) => surfaceOfProp(t) === SURF.METAL && !LIGHT_PROPS[t]));
  check('the ground: turf is earth, a road is stone, a floor of boards is wood', surfaceOf(null, true, 'grass') === SURF.EARTH && surfaceOf(null, true, 'road') === SURF.STONE && surfaceOf(null, true, 'wood') === SURF.WOOD);
  check('a tree is wood; a built wall is wood, a metal one metal', surfaceOf({ flags: COL.TREE }, false) === SURF.WOOD && surfaceOf({ flags: COL.STRUCT, id: 7 }, false, '', () => STRUCT.WALL) === SURF.WOOD && surfaceOf({ flags: COL.STRUCT, id: 7 }, false, '', () => STRUCT.METAL_WALL) === SURF.METAL);
  check('weapons: a knife slashes, a machete chops, a bat is blunt, the hammer hammers', blowOf(ITEM.KNIFE) === BLOW.SLASH && blowOf(ITEM.MACHETE) === BLOW.CHOP && blowOf(ITEM.BAT) === BLOW.BLUNT && blowOf(ITEM.SPIKED_BAT) === BLOW.BLUNT && blowOf(ITEM.HAMMER) === BLOW.HAMMER);
  check('...and every melee weapon the game has is one of them', Object.keys(WEAPONS).filter((w) => WEAPONS[w].melee).every((w) => [ITEM.KNIFE, ITEM.MACHETE, ITEM.BAT, ITEM.SPIKED_BAT, ITEM.HAMMER].includes(+w)));
  check('a knife barely rocks a car, a bat does, a blast most of all; the heavy swing more', blowForce(BLOW.SLASH) < 0.25 && blowForce(BLOW.BLUNT) > 3 * blowForce(BLOW.SLASH) && blowForce(BLOW.BLAST) === 1 && blowForce(BLOW.BLUNT, true) > blowForce(BLOW.BLUNT));
  const cell = (s, b2) => markFor(s, b2).cell;
  check('the mark fits the material: a pale slash in wood, a scratch on stone, a scrape on metal, a cut in turf, a tear in cloth', cell(SURF.WOOD, BLOW.SLASH) === MARK.SLASH_WOOD && cell(SURF.STONE, BLOW.SLASH) === MARK.SCRATCH_STONE && cell(SURF.METAL, BLOW.SLASH) === MARK.SCRAPE_METAL && cell(SURF.EARTH, BLOW.SLASH) === MARK.CUT_EARTH && cell(SURF.CLOTH, BLOW.SLASH) === MARK.TEAR_CLOTH && cell(SURF.GLASS, BLOW.BLUNT) === MARK.CRACK_GLASS);
  check('...and the weapon: a blade leaves a long thin mark along the stroke, a bat or a hammer a round one, a machete a deeper gouge', [SURF.WOOD, SURF.STONE, SURF.METAL, SURF.EARTH, SURF.CLOTH].every((s) => markFor(s, BLOW.SLASH).along && markFor(s, BLOW.SLASH).w > 3 * markFor(s, BLOW.SLASH).h && markFor(s, BLOW.CHOP).h > markFor(s, BLOW.SLASH).h) && [SURF.WOOD, SURF.STONE, SURF.METAL, SURF.EARTH].every((s) => !markFor(s, BLOW.BLUNT).along && markFor(s, BLOW.BLUNT).w === markFor(s, BLOW.BLUNT).h && markFor(s, BLOW.HAMMER).w < markFor(s, BLOW.BLUNT).w) && cell(SURF.WOOD, BLOW.CHOP) === MARK.GOUGE_WOOD && cell(SURF.METAL, BLOW.BLUNT) === MARK.DENT_METAL);
  check('a table entry for every surface and every blow: a mark, bits, a sound the audio has', SURF_NAMES.every((_, s) => BLOW_NAMES.every((_2, b2) => markFor(s, b2).w > 0 && typeof soundFor(s, b2) === 'string') && bitsFor(s)));
  const { STRIKE_NAMES } = await import('../client/audio/audio.js').catch(() => ({ STRIKE_NAMES: null }));
  if (STRIKE_NAMES) check('every sound a blow can make is one the audio plays', STRIKE_SOUNDS.every((n) => STRIKE_NAMES.includes(n)), STRIKE_SOUNDS.filter((n) => !STRIKE_NAMES.includes(n)).join());
  check('sparks come off metal (and a few off stone), splinters off wood, a clod out of turf', bitsFor(SURF.METAL).sparks === 1 && bitsFor(SURF.STONE).sparks > 0 && !bitsFor(SURF.WOOD).sparks && bitsFor(SURF.WOOD).bits === 'splinter' && bitsFor(SURF.EARTH).bits === 'clod');
  // bullets
  const hole = (s, w, cos = 1, r = 0.5) => ({ ...shotMark(s, w, cos, r) });
  check('a bullet hole fits the material: splintered wood, a crater in stone, a punched hole in metal, a star in glass, a divot in turf', hole(SURF.WOOD, ITEM.PISTOL).cell === MARK.HOLE_WOOD && hole(SURF.STONE, ITEM.PISTOL).cell === MARK.HOLE_STONE && hole(SURF.METAL, ITEM.PISTOL).cell === MARK.HOLE_METAL && hole(SURF.GLASS, ITEM.PISTOL).cell === MARK.HOLE_GLASS && hole(SURF.EARTH, ITEM.PISTOL).cell === MARK.DIVOT_EARTH);
  const size = (w) => hole(SURF.STONE, w).h;
  check('...and the gun: a pistol and an SMG small, rifles bigger, a shotgun pellet smallest, the anti-tank rifle a ragged hole several times a rifle\'s', size(ITEM.PISTOL) === size(ITEM.MP5) && size(ITEM.PISTOL) < size(ITEM.M4A1) && size(ITEM.M4A1) <= size(ITEM.AK47) && size(ITEM.AK47) < size(ITEM.HUNTING_RIFLE) && size(ITEM.SHOTGUN) < size(ITEM.PISTOL) && size(ITEM.AT_RIFLE) > 2 * size(ITEM.HUNTING_RIFLE) && hole(SURF.STONE, ITEM.AT_RIFLE).cell === MARK.HOLE_BIG && hole(SURF.WOOD, ITEM.AK47).cell !== MARK.HOLE_BIG && shotScale(16) > 1, [ITEM.PISTOL, ITEM.M4A1, ITEM.AK47, ITEM.HUNTING_RIFLE, ITEM.SHOTGUN, ITEM.AT_RIFLE].map(size).join());
  check('a shotgun is a pattern: every pellet its own hole', WEAPONS[ITEM.SHOTGUN].pellets >= 6 && WEAPONS[ITEM.DB_SHOTGUN].pellets >= 6);
  const sq = hole(SURF.WOOD, ITEM.AK47, 1), gr = hole(SURF.WOOD, ITEM.AK47, 0.4), flat = hole(SURF.WOOD, ITEM.AK47, 0.01);
  check('square on, a hole is round and turned any way; oblique, a graze drawn out along the bullet\'s way, and no longer than three times', !sq.along && sq.w === sq.h && gr.along && Math.abs(gr.w / gr.h - 2.5) < 0.01 && Math.abs(flat.w / flat.h - GRAZE_MAX) < 1e-9);
  check('no two holes of a burst are the same size', hole(SURF.STONE, ITEM.AK47, 1, 0).h < hole(SURF.STONE, ITEM.AK47, 1, 1).h && hole(SURF.STONE, ITEM.AK47, 1, 1).h / hole(SURF.STONE, ITEM.AK47, 1, 0).h < 1.4);
}

// ================================================================== the marks
const { MarkPool, MARK_RING, MARK_KEPT, MARK_LIFE, MARK_FADE, markCorners } = await import('../client/render/marks.js');
{
  const pool = new MarkPool();
  const quad = (x) => Float32Array.from(markCorners(x, 1, 0, 0, 0, 1, 0.2, 0.2, null, 0, 0, 0));
  const wall = { wall: 1 }, other = { other: 1 };
  // sustained fire: five thousand rounds into one wall
  for (let i = 0; i < 5000; i++) pool.add(quad(i * 0.01), 0, 0, 1, MARK.HOLE_STONE, 1, 1, 1, 1, i % 2 ? wall : other, i * 0.05);
  const xs = [];
  for (let i = 0; i < MARK_RING; i++) xs.push(pool.rest[i * 12]);
  check(`the cap holds under sustained fire: 5,000 marks leave ${MARK_RING}, the newest ones`, pool.count === MARK_RING && Math.min(...xs) > (5000 - MARK_RING - 1) * 0.01 - 0.11, `${pool.count}, oldest x ${Math.min(...xs).toFixed(2)}`);
  check('one buffer for all of them (one draw call): a quad a mark', pool.pos.length === (MARK_RING + MARK_KEPT) * 12);
  // marks a wreck keeps are never overwritten by the ring
  const car = { car: 1 };
  const k = pool.keep(quad(-5), 0, 0, 1, MARK.DENT_METAL, 1, 1, 1, 1, car);
  for (let i = 0; i < 1000; i++) pool.add(quad(i), 0, 0, 1, MARK.HOLE, 1, 1, 1, 1, null, 300);
  check('a mark that is kept is not overwritten, and does not fade', k >= MARK_RING && pool.live[k] === 1 && pool.rest[k * 12] < -4 && pool.count === MARK_RING + 1);
  // marks go with what they are on
  const p2 = new MarkPool();
  for (let i = 0; i < 30; i++) p2.add(quad(i), 0, 0, 1, MARK.HOLE_WOOD, 1, 1, 1, 1, i < 20 ? wall : other, 0);
  const removed = p2.removeOwner(wall);
  check('marks on something that is torn down go with it, and no others', removed === 20 && p2.count === 10 && p2.owner.filter((o) => o === wall).length === 0 && p2.owner.filter((o) => o === other).length === 10);
  let zero = true;
  for (let i = 0; i < 20; i++) for (let c = 0; c < 12; c++) if (p2.pos[i * 12 + c] !== 0) zero = false;
  check('...their quads closed up to nothing (they are not drawn)', zero);
  // marks move with what they are on
  const e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.5, 0, 1];
  p2.moveOwner(other, e);
  check('marks on something that moves move with it, and come back to rest with it', Math.abs(p2.pos[20 * 12 + 1] - p2.rest[20 * 12 + 1] - 0.5) < 1e-6 && (p2.moveOwner(other, null), p2.pos[20 * 12 + 1] === p2.rest[20 * 12 + 1]));
  // the fade
  const p3 = new MarkPool();
  p3.add(quad(0), 0, 0, 1, MARK.HOLE, 1, 1, 1, 1, null, 10);
  p3.update(11);
  p3.lo = p3.cap;
  p3.hi = -1;
  let idle = 0;
  for (let t = 12; t < 10 + MARK_LIFE - 1; t += 5) if (p3.update(t)) idle++;
  check('at rest the pool does nothing: no update touches a buffer until a mark is due', idle === 0 && p3.fading.length === 0);
  p3.update(10 + MARK_LIFE + MARK_FADE / 2);
  const half = p3.col[3];
  p3.update(10 + MARK_LIFE + MARK_FADE + 0.1);
  check(`a mark lasts ${MARK_LIFE} s, fades over ${MARK_FADE} more and is gone`, Math.abs(half - 0.5) < 0.02 && p3.count === 0 && p3.due === Infinity && p3.fading.length === 0, `alpha ${half}`);
  // a mark lies on its surface, the way the stroke went
  const c = markCorners(0, 0, 0, 0, 0, 1, 0.4, 0.1, 1, 0.2, 0.7, 0);
  const lenAlong = Math.hypot(c[3] - c[0], c[4] - c[1], c[5] - c[2]), lenAcross = Math.hypot(c[9] - c[0], c[10] - c[1], c[11] - c[2]);
  const dirx = (c[3] - c[0]) / lenAlong, diry = (c[4] - c[1]) / lenAlong;
  check('a mark is flat on its surface, just proud of it, its long side along the stroke as it runs across', [2, 5, 8, 11].every((i) => Math.abs(c[i] - 0.006) < 1e-6) && Math.abs(lenAlong - 0.4) < 1e-5 && Math.abs(lenAcross - 0.1) < 1e-5 && Math.abs(diry / dirx - 0.2) < 1e-4);
}

// ================================================================== the client, against a real static world
const THREE = await import('three');
const { StaticWorld } = await import('../client/render/staticworld.js');
const { Impacts, PANE_SHOTS } = await import('../client/game/impacts.js');
const { Effects } = await import('../client/render/effects.js').catch(() => ({ Effects: null }));
{
  const scene = new THREE.Scene();
  const sw = new StaticWorld(scene, world);
  const sounds = [];
  const pool = () => ({ emit() {} });
  const ents = new Map();
  const g = {
    scene, world, staticWorld: sw, time: 100, myId: 1,
    effects: { alpha: pool(), add: pool(), world },
    renderer: { q: { shadows: true } },
    entities: { ents },
    camera: { position: new THREE.Vector3(0, 0, 0) },
    renderPos: { x: 0, z: 0 },
    audio: { strike: (n) => sounds.push(n), play: (id) => sounds.push('#' + id) },
    lights: { flashMuzzle() {} },
    ui: { notify() {} },
    surfaceAt: () => 'grass',
    camShake: 0,
  };
  void Effects;
  const im = new Impacts(g);
  const P = im.marks.pool;
  const drawn = (m) => m.runs.reduce((n, r) => n + r.count, 0);
  const total = () => sw.multi.reduce((n, m) => n + drawn(m), 0);
  const whole = total();
  check('nothing is lifted, marked or drawn until something is hit', im.wrecks.live.size === 0 && P.count === 0 && !im.marks.mesh.visible && !im.fx.chips.mesh.visible && im.wrecks.batch.slots.size === 0);

  // a wall: stand in front of a face, and strike it
  const faceOf = (mats) => {
    for (const cell of world.staticGrid.cells) {
      for (const c of cell) {
        if (typeof c.tag !== 'string' || !mats.includes(c.tag) || c.type !== 0 || c.y1 - c.y0 < 2.2 || c.hx < 1.5 || c.hz > 0.3) continue;
        for (const side of [1, -1]) {
          const ox = c.x + c.s * side * (c.hz + 1), oz = c.z + c.c * side * (c.hz + 1), oy = c.y0 + 1.3;
          const dx = -c.s * side, dz = -c.c * side;
          const r = raycastWorld(world, ox, oy, oz, dx, 0, dz, 2, { t: -1 });
          if (r.col === c && Math.abs(r.t - 1) < 0.01 && !im.paneAt(ox, oy, oz, dx, 0, dz, 2)) return { c, ox, oy, oz, dx, dz, x: ox + dx, z: oz + dz };
        }
      }
    }
    return null;
  };
  const wood = faceOf(['planks', 'clapboard', 'barn', 'logwall']);
  const brick = faceOf(['brick', 'concrete', 'stone']);
  check('the test found a wooden wall and a brick one', !!wood && !!brick);
  sounds.length = 0;
  im.strike(2, BLOW.SLASH, false, wood.x, wood.oy, wood.z, wood.dx, 0, wood.dz);
  const i0 = (P.next + MARK_RING - 1) % MARK_RING;
  const cellOf = (i) => Math.round(P.uv[i * 8] * 4) + Math.round((1 - P.uv[i * 8 + 5]) * 6) * 4;
  const nOf = (i) => [P.nrm[i * 12], P.nrm[i * 12 + 1], P.nrm[i * 12 + 2]];
  check('a knife on a wooden wall: one mark, a slash in wood, on the wall\'s face, and it sounds like it', P.count === 1 && cellOf(i0) === MARK.SLASH_WOOD && Math.abs(nOf(i0)[0] + wood.dx) < 1e-6 && Math.abs(nOf(i0)[2] + wood.dz) < 1e-6 && sounds.join() === 'wood_slash' && im.marks.mesh.visible === false, `${P.count} marks, cell ${cellOf(i0)}, ${sounds.join()}`);
  im.update(0.016);
  check('...drawn from the next frame on, by the one mesh', im.marks.mesh.visible === true && scene.children.filter((o) => o.name === 'marks').length === 1);
  im.strike(2, BLOW.BLUNT, false, brick.x, brick.oy, brick.z, brick.dx, 0, brick.dz);
  check('a bat on brick: a chip, and the crack of stone', cellOf((P.next + MARK_RING - 1) % MARK_RING) === MARK.CHIP_STONE && sounds[sounds.length - 1] === 'stone_crack');
  // bullets
  const before = P.count;
  im.shot(ITEM.HUNTING_RIFLE, brick.ox, brick.oy, brick.oz, brick.dx, 0, brick.dz, 1, brick.c, false, 100);
  const hi = (P.next + MARK_RING - 1) % MARK_RING;
  const side = (i) => Math.hypot(P.pos[i * 12 + 3] - P.pos[i * 12], P.pos[i * 12 + 4] - P.pos[i * 12 + 1], P.pos[i * 12 + 5] - P.pos[i * 12 + 2]);
  const rifle = side(hi);
  im.shot(ITEM.PISTOL, brick.ox, brick.oy + 0.3, brick.oz, brick.dx, 0, brick.dz, 1, brick.c, false, 100);
  check('a rifle into brick: a crater on the wall, bigger than a pistol\'s beside it', P.count === before + 2 && cellOf(hi) === MARK.HOLE_STONE && rifle > side((P.next + MARK_RING - 1) % MARK_RING) * 1.05, `${P.count - before} marks, cell ${cellOf(hi)}, rifle ${rifle.toFixed(3)} pistol ${side((P.next + MARK_RING - 1) % MARK_RING).toFixed(3)}`);
  // the ground
  const gx = wood.ox + 30, gz = wood.oz + 30;
  const hG = im.resolve(gx, world.heightAt(gx, gz) + 1.5, gz, 0, -1, 0, 3, { t: 1.5, col: null, terrain: true });
  check('the ground: a mark lies on the slope of the turf', !!hG && hG.surf === SURF.EARTH && hG.ny > 0.7 && Math.abs(hG.y - world.heightAt(gx, gz)) < 0.05);
  // sustained fire into one wall
  for (let i = 0; i < 900; i++) im.shot(ITEM.AK47, brick.ox + (i % 30) * 0.02, brick.oy + (i % 7) * 0.05, brick.oz, brick.dx, 0, brick.dz, 1, brick.c, false, 100);
  check(`several magazines into one wall: still ${MARK_RING} marks, still one mesh`, P.count === MARK_RING && scene.children.filter((o) => o.name === 'marks').length === 1);

  // a structure: built, shot, torn down
  // (somewhere open: nothing standing within a few metres)
  let sx = wood.ox + 40, sz = wood.oz + 12;
  for (let k = 0; k < 400; k++) {
    const x = wood.ox + 30 + (k % 20) * 9, z = wood.oz - 60 + Math.floor(k / 20) * 9;
    if (world.staticGrid.query(x, z, 7, []).length || world.heightAt(x, z) < 3 || Math.abs(world.heightAt(x + 2, z + 2) - world.heightAt(x - 2, z - 2)) > 0.4) continue;
    sx = x;
    sz = z;
    break;
  }
  const sy = world.heightAt(sx, sz);
  const col = makeBox(sx, sz, sy - 0.3, sy + 2.5, 3, 0.3, 0, COL.STRUCT, 77);
  world.structGrid.add(col);
  ents.set(77, { stype: STRUCT.WALL });
  P.clear();
  for (let i = 0; i < 12; i++) {
    const r = raycastWorld(world, sx - 1 + i * 0.15, sy + 1.2, sz + 2, 0, 0, -1, 5, { t: -1 });
    im.shot(ITEM.AK47, sx - 1 + i * 0.15, sy + 1.2, sz + 2, 0, 0, -1, r.t, r.col, r.terrain, 100);
  }
  im.shot(ITEM.PISTOL, brick.ox, brick.oy, brick.oz, brick.dx, 0, brick.dz, 1, brick.c, false, 100);
  const onWall = P.owner.filter((o) => o === col).length;
  // a mark near the edge of a face is made to fit it: 3 cm from the wall's end (whichever end nothing stands before)
  let fitE = null, okE = false;
  for (const end of [1.47, -1.47]) {
    const hE = im.resolve(sx + end, sy + 1.2, sz + 2, 0, 0, -1, 5);
    if (!hE || hE.owner !== col) continue;
    fitE = hE.fit;
    const nE = P.count;
    im.mark(hE, markFor(SURF.WOOD, BLOW.BLUNT), 0, 0, -1, 0.5);
    const iE = (P.next + MARK_RING - 1) % MARK_RING;
    okE = P.count === nE || Math.max(...[0, 3, 6, 9].map((k) => Math.abs(P.pos[iE * 12 + k] - sx))) <= 1.5 + 0.06;
    if (P.count > nE) P.kill(iE);
    break;
  }
  check('near the edge of a face a mark is made small enough not to hang off it (and one too big for the room is not made)', fitE !== null && Math.abs(fitE - 0.03) < 0.005 && okE, String(fitE));
  im.gone(col);
  world.structGrid.remove(col);
  check('automatic fire across a built wall: a hole a round, in wood - and when the wall is torn down they go with it, the hole in the brick stays', onWall >= 8 && P.count === 13 - onWall && P.owner.filter((o) => o === col).length === 0, `${onWall} on the wall, ${P.count} left`);

  // a window
  const pane = im.panes.find((p) => p.hw > 0.3);
  if (pane) {
    const ox = pane.x + pane.nx * 2, oz = pane.z + pane.nz * 2;
    const runsBefore = total() + sw.single.reduce((n, s) => n + (s.mesh.geometry.groups.length ? s.mesh.geometry.groups.reduce((a2, g2) => a2 + g2.count, 0) : s.mesh.geometry.attributes.position.count), 0);
    P.clear();
    sounds.length = 0;
    for (let i = 0; i < PANE_SHOTS - 1; i++) im.shot(ITEM.PISTOL, ox + pane.nz * 0.1 * i, pane.y, oz - pane.nx * 0.1 * i, -pane.nx, 0, -pane.nz, -1, null, false, 60);
    const stars = P.owner.filter((o) => o === pane.part).length;
    // (each star lies on the face of the glass towards the shot, proud of it: the pane is drawn 4 cm thick)
    let proud = true;
    for (let i = 0; i < MARK_RING; i++) {
      if (P.owner[i] !== pane.part) continue;
      const d = (P.pos[i * 12] - pane.x) * pane.nx + (P.pos[i * 12 + 2] - pane.z) * pane.nz;
      if (!(d > 0.021 && d < 0.04)) proud = false;
    }
    check('a star on a window lies on the outer face of the glass, not inside the pane', stars > 0 && proud);
    im.shot(ITEM.PISTOL, ox, pane.y + 0.1, oz, -pane.nx, 0, -pane.nz, -1, null, false, 60);
    const runsAfter = total() + sw.single.reduce((n, s) => n + (s.mesh.geometry.groups.length ? s.mesh.geometry.groups.reduce((a2, g2) => a2 + g2.count, 0) : s.mesh.geometry.attributes.position.count), 0);
    check(`a shot through a window stars the pane; after ${PANE_SHOTS} it falls out, its stars with it, and is no longer drawn`, stars === PANE_SHOTS - 1 && pane.out && P.owner.filter((o) => o === pane.part).length === 0 && (runsBefore - runsAfter === 36 || runsBefore - runsAfter === 72) && sounds.includes('#' + 22), `${stars} stars, out ${pane.out}, ${runsBefore - runsAfter} vertices fewer`);
    im.regrown();
    const runsBack = total() + sw.single.reduce((n, s) => n + (s.mesh.geometry.groups.length ? s.mesh.geometry.groups.reduce((a2, g2) => a2 + g2.count, 0) : s.mesh.geometry.attributes.position.count), 0);
    check('...and is in again at dawn', !pane.out && runsBack === runsBefore);
  } else check('the world has a window to shoot at', false);

  // a barrel rocks and goes back
  const barrelCol = (() => {
    for (const cell of world.staticGrid.cells) for (const c2 of cell) if (c2.tag && c2.tag.type === 'barrel' && sw.lifts.has(c2.tag)) return c2;
    return null;
  })();
  if (barrelCol) {
    const pr = barrelCol.tag;
    P.clear();
    im.strike(2, BLOW.BLUNT, false, pr.x + barrelCol.r, pr.y + 0.7, pr.z, -1, 0, 0);
    const l = im.wrecks.get(pr);
    const liftedNow = !!l && sw.lifted.has(pr) && total() < whole;
    let maxTilt = 0, frames = 0;
    while (im.wrecks.active.size && frames < 2000) {
      im.update(1 / 60);
      maxTilt = Math.max(maxTilt, Math.abs(l.ax), Math.abs(l.az));
      frames++;
    }
    check('a bat on a barrel: it is lifted out of the static world, rocks a few degrees, settles, and is put back as it was', liftedNow && maxTilt > 0.02 && maxTilt < 0.18 && frames > 20 && frames < 600 && !sw.lifted.has(pr) && total() === whole && im.wrecks.live.size === 0, `tilt ${maxTilt.toFixed(3)}, ${frames} frames, lifted ${liftedNow}`);
  } else check('the world has a barrel to hit', false);

  // a wreck: the same to who watched and to who arrives
  const wcol = wreckCols[6];
  const pr = wcol.tag;
  const cc = Math.cos(pr.ry), ss = Math.sin(pr.ry);
  const hitAt = (lx, ly, lz, dlx, dlz, bits) => {
    const x = pr.x + cc * lx + ss * lz, z = pr.z - ss * lx + cc * lz;
    const dx = cc * dlx + ss * dlz, dz = -ss * dlx + cc * dlz;
    const yaw = Math.atan2(-dx, -dz);
    return [qpos(x), qpos(pr.y + ly), qpos(z), Math.round((((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 256) & 255, 0, bits];
  };
  g.camera.position.set(pr.x + 5, pr.y + 1.6, pr.z);
  // (where this wreck's glass and its tyre are: a throwaway look at its parts)
  im.wreck(WRECKF.REPLAY, qpos(wcol.x), qpos(wcol.y0), qpos(wcol.z), 5, [hitAt(1, 0.6, 0.6, -1, 0, BLOW.SLASH)]);
  const look = im.wrecks.get(pr);
  const tyre = look.parts.find((p) => p.kind === 'wheel').isles[0], glass = look.parts.find((p) => p.kind === 'pane');
  const tSide = Math.sign(tyre.mid[0]) || 1, gSide = Math.abs(glass.mid[0]) > 0.4 ? Math.sign(glass.mid[0]) : 0;
  const atGlass = gSide ? hitAt(gSide * 1.2, glass.mid[1], glass.mid[2], -gSide, 0, BLOW.SLASH) : hitAt(0, glass.mid[1], glass.mid[2] + Math.sign(glass.mid[2]) * 0.8, 0, -Math.sign(glass.mid[2]), BLOW.SLASH);
  im.regrown();
  const hits = [hitAt(1, 0.6, 0.6, -1, 0, BLOW.BLUNT | HITF.TOOK), hitAt(1, 0.6, -1.3, -1, 0, BLOW.CHOP | HITF.TOOK), hitAt(0, 0.6, -2.4, 0, 1, BLOW.BLUNT | HITF.TOOK), atGlass, atGlass, hitAt(tSide * 1.2, tyre.mid[1], tyre.mid[2], -tSide, 0, BLOW.SLASH | HITF.TOOK)];
  P.clear();
  const [qx, qy, qz] = [qpos(wcol.x), qpos(wcol.y0), qpos(wcol.z)];
  // watched: one blow at a time, a few frames between
  let left = WRECK_SALVAGE;
  for (const h of hits) {
    if (h[5] & HITF.TOOK) left--;
    im.wreck(0, qx, qy, qz, left, [h]);
    for (let i = 0; i < 12; i++) im.update(1 / 60);
  }
  const w = im.wrecks.get(pr);
  let frames = 0;
  while (im.wrecks.active.size && frames++ < 3000) im.update(1 / 60);
  const watched = w.rest.map((r) => r.slice());
  const marksWatched = P.owner.filter((o) => o === pr).length;
  const states = w.parts.map((p) => p.kind + p.state).join(' ');
  check('a wreck that is hit leaves the static world, is drawn by the lifted batch (a mesh a material) and comes to rest', sw.lifted.has(pr) && total() < whole && im.wrecks.batch.drawn > 3 && frames < 3000 && w.anims.length === 0 && !w.rocking, `${frames} frames`);
  const panes = w.parts.filter((p) => p.kind === 'pane'), loose = w.parts.filter((p) => p.kind === 'loose');
  check('where it was hit decides what reacts: the pane cracked by a knife and then fell out, trim came off, a tyre went down', panes.some((p) => p.state === 2) && loose.some((p) => p.state === 3) && w.parts.some((p) => p.kind === 'wheel' && p.state === 1) && marksWatched >= 3, states);
  // every part that came off lies on the ground, clear of the wreck's own box
  let clear = true, low = true;
  for (const p of w.parts) {
    if (p.state < 3 || p.kind === 'pane' || p.kind === 'lamp') continue;
    for (const s of p.isles) {
      const R = w.rest[s.piece];
      let mx = 0, mz = 0, top = -Infinity;
      for (const v of s.verts) {
        const l = w.local(R[v * 3], R[v * 3 + 1], R[v * 3 + 2], [0, 0, 0]);
        mx += l[0] / s.verts.length;
        mz += l[2] / s.verts.length;
        top = Math.max(top, R[v * 3 + 1] - world.heightAt(R[v * 3], R[v * 3 + 2]));
      }
      if (Math.abs(mx) < wcol.hx && Math.abs(mz) < wcol.hz) clear = false;
      if (top > 0.5) low = false;
    }
  }
  check('what came off lies on the ground beside it, not inside it', clear && low);
  // arrives afterwards: the whole record at once
  im.wreck(WRECKF.REPLAY, qx, qy, qz, left, hits);
  const w2 = im.wrecks.get(pr);
  let diff = 0;
  w2.rest.forEach((r, i) => {
    for (let k = 0; k < r.length; k++) diff = Math.max(diff, Math.abs(r[k] - watched[i][k]));
  });
  check('who arrives afterwards sees the same wreck, to the vertex, with the same marks on it', w2 !== w && diff === 0 && w2.parts.map((p) => p.kind + p.state).join(' ') === states && P.owner.filter((o) => o === pr).length === marksWatched && w2.anims.length === 0, `max difference ${diff}, ${P.owner.filter((o) => o === pr).length} marks vs ${marksWatched}`);
  // picked clean
  im.wreck(0, qx, qy, qz, 0, [hitAt(1, 0.6, 1.5, -1, 0, BLOW.BLUNT | HITF.TOOK)]);
  frames = 0;
  while (im.wrecks.active.size && frames++ < 3000) im.update(1 / 60);
  check('picked clean: no glass, no trim, the lids off, on its rims', w2.clean && w2.parts.every((p) => (p.kind === 'door' ? p.state >= 2 : w2.spent(p))), w2.parts.filter((p) => !w2.spent(p)).map((p) => p.kind + p.state).join());
  // rocking: a bat rocks it more than a knife
  const rock = (blow) => {
    w2.ax = w2.tx;
    w2.az = w2.tz;
    w2.vx = w2.vz = 0;
    im.strike(2, blow, false, pr.x + cc * 0.95, pr.y + 1.0, pr.z - ss * 0.95, -cc, 0, ss);
    let m = 0;
    for (let i = 0; i < 400 && im.wrecks.active.size; i++) {
      im.update(1 / 60);
      m = Math.max(m, Math.abs(w2.az - w2.tz));
    }
    return m;
  };
  const bat = rock(BLOW.BLUNT), knife = rock(BLOW.SLASH);
  check('it rocks on its springs away from the blow and settles: a bat a degree or two, a knife barely', bat > 0.012 && bat < 0.08 && knife < bat * 0.3 && knife > 0 && !im.wrecks.active.size, `bat ${(bat * 57.3).toFixed(2)} deg, knife ${(knife * 57.3).toFixed(2)} deg`);
  // dawn
  const batchMats = im.wrecks.batch.drawn;
  im.regrown();
  check('at dawn it is whole again: back in the static world, its marks gone, nothing left in the batch', batchMats > 3 && !sw.lifted.size && total() === whole && im.wrecks.live.size === 0 && im.wrecks.batch.drawn === 0 && P.owner.filter((o) => o === pr).length === 0);
  // a wreck on record far away is not built until the eye comes near
  g.camera.position.set(pr.x + 600, 0, pr.z);
  im.wreck(WRECKF.REPLAY, qx, qy, qz, 4, hits.slice(0, 1));
  const farBuilt = im.wrecks.live.size;
  g.camera.position.set(pr.x + 20, 0, pr.z);
  for (let i = 0; i < 40; i++) im.update(1 / 60);
  check('a wreck on record far off costs nothing until the eye comes near', farBuilt === 0 && im.wrecks.live.size === 1 && im.wrecks.active.size === 0);
}

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall ok');
process.exit(fails.length ? 1 : 0);
