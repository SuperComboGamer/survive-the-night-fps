// A car's boot is forced, not just searched (shared/trunk.js): how long it takes by what is in the hand, the heaves
// on the way (a blow those near see and hear, a little noise), that the loot and the alarm are what a search always
// gave, that a boot whose lid is up already or off is just searched - and, on the client, that the lid stands open
// for whoever watched and for whoever comes later, and that a wreck's record is judged the same either way.
//
//   node scripts/test-trunk.js [seed]
import './clip/dom-stub.js';
import { Game } from '../server/game.js';
import { C2S, S2C, SNAP, PROTOCOL_VERSION, Writer, Reader, qpos, usePos } from '../shared/protocol.js';
import { ITEM, CONT, WEAPONS, CONT_TABLES } from '../shared/defs.js';
import { SEARCH_TIME, NOISE, SERVER_DT } from '../shared/constants.js';
import { BLOW, blowOf } from '../shared/surfaces.js';
import { HITF, WRECKF } from '../shared/wrecks.js';
import { PRY, pryTime, pryWeapon, trunkCar, hasBootLid } from '../shared/trunk.js';
import { randomUUID } from 'node:crypto';

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`);
  if (!ok) fails.push(name);
};

const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
let sent = [];
{
  const emit = game.emit.bind(game);
  game.emit = (fn, opts = {}) => {
    emit(fn, opts);
    sent.push({ bytes: game.events[game.events.length - 1].bytes, opts });
  };
}
const { readEvents } = await import('../client/net/decode.js');
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
function client(name) {
  const c = { name, id: 0 };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(randomUUID());
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  return c;
}
const A = client('Alice');
const a = A.p();
game.update();
const world = game.world;
usePos(world);
const DT = SERVER_DT;

// ---- the table
const melee = Object.keys(WEAPONS).map(Number).filter((w) => WEAPONS[w].melee);
check('every melee weapon the game has is a lever, each with its time', melee.length >= 6 && melee.every((w) => PRY.time[w] > 0 && pryWeapon(w) === w), melee.filter((w) => !PRY.time[w]).join());
check('a claw or a long blade is quickest, a knife slowest, bare hands slower still - and none of it far from a search', pryTime(ITEM.HAMMER) < pryTime(ITEM.MACHETE) && pryTime(ITEM.MACHETE) < pryTime(ITEM.BAT) && pryTime(ITEM.BAT) === pryTime(ITEM.SPIKED_BAT) && pryTime(ITEM.BAT) < pryTime(ITEM.NUNCHAKU) && pryTime(ITEM.NUNCHAKU) < pryTime(ITEM.KNIFE) && pryTime(ITEM.KNIFE) < PRY.hand && pryTime(0) === PRY.hand && pryTime(ITEM.AK47) === PRY.hand && pryWeapon(ITEM.AK47) === 0 && PRY.hand <= 3 && pryTime(ITEM.HAMMER) >= SEARCH_TIME, JSON.stringify(PRY.time));
check('a heave is quieter than a swing for scrap, and far quieter than a shot', PRY.noise < NOISE.SALVAGE && PRY.noise < NOISE.GUNSHOT / 2);

// ---- the boots of this valley
const trunks = game.caches.filter((c) => c.ctype === CONT.TRUNK);
const withLid = trunks.filter((c) => hasBootLid(trunkCar(world, c)));
const other = trunks.filter((c) => trunkCar(world, c) && !hasBootLid(trunkCar(world, c)));
check('every boot in the valley is found behind its car; the cars have a lid to force, a pickup has not', trunks.length > 6 && trunks.filter((c) => !trunkCar(world, c)).length <= 2 && withLid.length > 4 && withLid.every((c) => PRY.types.includes(trunkCar(world, c).type)) && other.every((c) => !PRY.types.includes(trunkCar(world, c).type) || trunkCar(world, c).type === 'car_open'), `${trunks.length} trunks, ${withLid.length} with a lid, ${trunks.filter((c) => !trunkCar(world, c)).length} with no car`);
check('the sedan left in the street with its boot up has nothing to force', !hasBootLid({ type: 'car_open', seed: 3 }) && !hasBootLid({ type: 'car_open', seed: 7 }) && hasBootLid({ type: 'car_open', seed: 4 }) && hasBootLid({ type: 'car_wreck', seed: 3 }) && !hasBootLid({ type: 'pickup_truck', seed: 0 }) && !hasBootLid({ type: 'van_wreck', seed: 0 }) && !hasBootLid(null));

const idOf = (c) => c.id;
const hold = (p) => p.hold;
// stand a player at a boot with a weapon in the hand (0: a rifle in it - no lever)
function at(p, c, weapon) {
  const car = trunkCar(world, c);
  const s = p.state;
  s.x = c.x + Math.sin(car.ry) * 0.9;
  s.z = c.z + Math.cos(car.ry) * 0.9;
  s.y = world.heightAt(s.x, s.z);
  s.yaw = Math.atan2(-(c.x - s.x), -(c.z - s.z));
  s.pitch = -0.2;
  s.vx = s.vy = s.vz = 0;
  if (weapon && WEAPONS[weapon].melee) {
    s.slot = WEAPONS[weapon].slot;
    s.weapons[s.slot] = weapon;
  } else {
    s.slot = 0;
    s.weapons[0] = ITEM.AK47;
  }
  for (const z of game.zombies) z.x = z.z = 1e6;
  game.zm.rebuildHash();
  p.hold = null;
  p.useItem = 0;
}
// hold [E] on it to the end: { need, strikes, noises, done }
function force(p, c, weapon, stopAt = Infinity) {
  at(p, c, weapon);
  const noises = [];
  const noise = game.zm.noise;
  game.zm.noise = (x, z, r) => {
    noises.push(r);
    return noise.call(game.zm, x, z, r);
  };
  sent = [];
  game.holdBegin(p, idOf(c));
  const h = p.hold;
  const need = h ? h.need : 0;
  let t = 0, n = 0;
  while (p.hold && t < stopAt && n++ < 400) {
    game.updateHold(p, DT);
    t += DT;
  }
  game.zm.noise = noise;
  const evs = decode(sent);
  return { started: !!h, pry: h ? h.pry : null, need, t, strikes: evs.filter((e) => e[0] === 'strike'), noises, done: c.state === 1 };
}

// ---- the times, the heaves
{
  const order = [ITEM.HAMMER, ITEM.MACHETE, ITEM.SPIKED_BAT, ITEM.BAT, ITEM.NUNCHAKU, ITEM.KNIFE, 0];
  const got = [];
  let ok = true, heaves = true, quiet = true, blows = true;
  order.forEach((w, i) => {
    const c = withLid[i % withLid.length];
    c.state = 0;
    const invBefore = JSON.stringify(a.inv);
    const r = force(a, c, w);
    got.push(`${w}:${r.need.toFixed(2)}`);
    const want = pryTime(w);
    ok &&= r.started && Math.abs(r.need - want) < 1e-9 && Math.abs(r.t - want) < DT * 1.5 && r.done && JSON.stringify(a.inv) !== invBefore;
    const nh = Math.floor((want - 1e-9) / PRY.lever);
    heaves &&= w ? r.strikes.length === nh : r.strikes.length === 0;
    quiet &&= r.noises.filter((x) => x === PRY.noise).length === nh;
    blows &&= r.strikes.every((e) => e[1] === a.id && (e[2] & 7) === blowOf(w) && Math.hypot(e[4] - c.x, e[6] - c.z) < 0.6);
    c.state = 0;
  });
  check('forcing a boot takes the time of what is in the hand: hammer, machete, the bats, nunchucks, knife, bare hands (a gun in the hand is bare hands)', ok, got.join(' '));
  check(`a heave every ${PRY.lever} s on the way: a blow on the lid's edge (EVT.STRIKE, the weapon's own kind of blow, at the back of the car) - none with bare hands`, heaves && blows);
  check('...and each makes its little noise for the dead, weapon or no', quiet);
}
// ---- what a boot gives is what a search gave: the same function, the same draws
{
  const c = withLid[0];
  c.state = 0;
  at(a, c, ITEM.KNIFE);
  const rng = game.rng;
  let draws = 0;
  game.rng = () => (draws++, rng.call(game));
  const pry = game.pryOf(a, c);
  game.pryHeave(a, c, pry);
  game.pryHeave(a, c, { ...pry, weapon: 0 });
  const drawsPry = draws;
  let searched = 0;
  const search = game.searchCache;
  game.searchCache = function (p, e) {
    searched++;
    return search.call(this, p, e);
  };
  const r = force(a, c, ITEM.KNIFE);
  game.searchCache = search;
  game.rng = rng;
  check('the loot is the search\'s: forcing draws nothing of the game\'s dice itself, and ends in the one search there always was', drawsPry === 0 && searched === 1 && r.done && draws > 0, `${drawsPry} draws by the prying, ${searched} searches`);
  const tbl = new Set(CONT_TABLES.trunk.map((e) => e[0]));
  check('...from the boot\'s own table', tbl.size > 5);
  // let go half way: nothing
  c.state = 0;
  const inv = JSON.stringify(a.inv);
  const half = force(a, c, ITEM.KNIFE, pryTime(ITEM.KNIFE) / 2);
  a.hold = null;
  check('let go half way and nothing is opened and nothing given', half.started && !half.done && c.state === 0 && JSON.stringify(a.inv) === inv && half.strikes.length >= 1);
  // a second go at one already forced: nothing to do
  c.state = 1;
  const again = force(a, c, ITEM.BAT);
  check('a boot already forced is not forced again', !again.started);
  c.state = 0;
}
// ---- the alarm: the boot's own, as it was
{
  const c = withLid[1];
  c.state = 0;
  let alarms = 0, during = 0;
  const trig = game.triggerCarAlarm;
  game.triggerCarAlarm = () => alarms++;
  const rng = game.rng;
  game.rng = () => 0; // (every draw the lowest: the one in ten comes up)
  at(a, c, ITEM.BAT);
  game.holdBegin(a, idOf(c));
  for (let i = 0; i < 400 && a.hold && a.hold.t + DT < a.hold.need; i++) game.updateHold(a, DT);
  during = alarms;
  for (let i = 0; i < 5 && a.hold; i++) game.updateHold(a, DT);
  game.rng = () => 0.999;
  c.state = 0;
  const before = alarms;
  force(a, c, ITEM.BAT);
  game.rng = rng;
  game.triggerCarAlarm = trig;
  check('the alarm is the boot\'s own, as before: one chance in ten when it comes open - never from a heave on the way, and no second rule on top', during === 0 && before === 1 && alarms === 1, `${during} during, ${before} at the end, ${alarms - before} with the dice high`);
  c.state = 0;
}
// ---- a boot that is no lid's: searched as ever
{
  const r0 = other.length ? force(a, other[0], ITEM.BAT) : null;
  if (other[0]) other[0].state = 0;
  check('a pickup\'s, a camper\'s: searched as before, in a second, with no blows', !other.length || (r0.started && !r0.pry && Math.abs(r0.need - SEARCH_TIME) < 1e-9 && r0.strikes.length === 0 && r0.noises.filter((x) => x === PRY.noise).length === 0 && r0.done), other.length ? `${trunkCar(world, other[0]).type}: ${r0.need}` : 'none here');
  // picked clean: the lid is off with everything else
  const c = withLid[2];
  const car = trunkCar(world, c);
  const col = world.staticGrid.query(car.x, car.z, 1, []).find((q) => q.tag === car);
  c.state = 0;
  game.gather.set(col, { left: 0, hits: [], alarm: 0 });
  const r = force(a, c, ITEM.BAT);
  check('a car picked clean has no lid left on it: its boot is searched, not forced - and still gives what it holds', r.started && !r.pry && Math.abs(r.need - SEARCH_TIME) < 1e-9 && r.strikes.length === 0 && r.done);
  game.gather.delete(col);
  c.state = 0;
}

// ================================================================== the client: the lid
const THREE = await import('three');
const { StaticWorld } = await import('../client/render/staticworld.js');
const { Impacts } = await import('../client/game/impacts.js');
{
  const scene = new THREE.Scene();
  const sw = new StaticWorld(scene, world);
  const sounds = [];
  const pool = () => ({ emit() {} });
  const caches = new Set();
  const g = {
    scene, world, staticWorld: sw, time: 100, myId: 1,
    effects: { alpha: pool(), add: pool(), world },
    renderer: { q: { shadows: true } },
    entities: { ents: new Map(), caches },
    camera: { position: new THREE.Vector3(0, 0, 0) },
    renderPos: { x: 0, z: 0 },
    audio: { strike: (n) => sounds.push(n), play: (id) => sounds.push('#' + id) },
    lights: { flashMuzzle() {} },
    ui: { notify() {} },
    surfaceAt: () => 'grass',
    camShake: 0,
  };
  const im = new Impacts(g);
  const c = withLid.find((q) => trunkCar(world, q).type === 'car_wreck');
  const car = trunkCar(world, c);
  const col = world.staticGrid.query(car.x, car.z, 1, []).find((q) => q.tag === car);
  const ent = { kind: 4, ctype: CONT.TRUNK, q: [qpos(c.x), qpos(c.y), qpos(c.z), 0] };
  caches.add(ent);
  g.camera.position.set(car.x + 4, car.y + 1.6, car.z);
  const run = (n = 1) => {
    for (let i = 0; i < n; i++) im.update(1 / 60);
  };
  const settle = () => {
    let n = 0;
    while (im.wrecks.active.size && n++ < 3000) im.update(1 / 60);
    return n;
  };
  // how high the lid's back edge stands (above the car's base), and its shape
  const lidTop = () => {
    const w = im.wrecks.get(car);
    const p = w.bootLid();
    let top = -Infinity;
    for (const s of p.isles) for (const v of s.verts) top = Math.max(top, w.rest[s.piece][v * 3 + 1] - car.y);
    return top;
  };
  run(20);
  check('a boot nobody has touched: the car is in the static world still, nothing lifted, nothing heard', im.bootOf(ent) === car && im.wrecks.live.size === 0 && !sw.lifted.size && !sounds.length && im.wrecks.bootShut(car));
  // watched: the container is searched as we look
  ent.q[3] = 1;
  run(14);
  const w = im.wrecks.get(car);
  const lid = w && w.bootLid();
  const moving = im.wrecks.active.has(w);
  const frames = settle();
  const up = lidTop();
  check('searched as we watch: the car leaves the static world, its boot lid strains, lets go with a bang and a creak and swings up on its hinge - and stays', !!lid && lid.kind === 'lid' && lid.mid[2] > 0 && moving && sw.lifted.has(car) && frames > 30 && frames < 200 && up > 1.3 && sounds.includes('metal_bang') && sounds.includes('hinge_creak') && lid.state === 0 && !im.wrecks.bootShut(car), `lid top ${up.toFixed(2)} m, ${frames} frames, ${sounds.join()}`);
  const seen = w.rest.map((r) => r.slice());
  // who comes later: the container arrives searched
  im.regrown();
  sounds.length = 0;
  const ent2 = { kind: 4, ctype: CONT.TRUNK, q: ent.q.slice() };
  caches.clear();
  caches.add(ent2);
  run(20);
  const w2 = im.wrecks.get(car);
  let diff = 0;
  w2.rest.forEach((r, i) => {
    for (let k = 0; k < r.length; k++) diff = Math.max(diff, Math.abs(r[k] - seen[i][k]));
  });
  check('who joins later, or walks up later (and after a dawn): the same lid up, at once and in silence', w2 !== w && diff < 1e-6 && !im.wrecks.active.size && !sounds.length, `max difference ${diff}, ${sounds.join()}`);
  // the wreck's record is judged with the lid where the record has it: forced before the blows or after, the same car
  const cc = Math.cos(car.ry), ss = Math.sin(car.ry);
  const hitAt = (lx, ly, lz, dlx, dlz, bits) => {
    const x = car.x + cc * lx + ss * lz, z = car.z - ss * lx + cc * lz;
    const dx = cc * dlx + ss * dlz, dz = -ss * dlx + cc * dlz;
    const yaw = Math.atan2(-dx, -dz);
    return [qpos(x), qpos(car.y + ly), qpos(z), Math.round((((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 256) & 255, 0, bits];
  };
  const hits = [hitAt(1.2, 0.6, 1.7, -1, 0, BLOW.BLUNT | HITF.TOOK), hitAt(0, 0.7, 2.6, 0, -1, BLOW.BLUNT), hitAt(-1.2, 0.6, 1.2, 1, 0, BLOW.CHOP | HITF.TOOK), hitAt(0.3, 0.8, 2.6, 0, -1, BLOW.HAMMER)];
  const [qx, qy, qz] = [qpos(col.x), qpos(col.y0), qpos(col.z)];
  let left = 5;
  for (const h of hits) {
    if (h[5] & HITF.TOOK) left--;
    im.wreck(0, qx, qy, qz, left, [h]);
    run(10);
  }
  settle();
  const wa = im.wrecks.get(car);
  const A1 = wa.rest.map((r) => r.slice()), statesA = wa.parts.map((p) => p.kind + p.state).join(' ');
  // the other way round: the blows first, the boot forced after them
  im.regrown();
  caches.clear();
  im.wreck(WRECKF.REPLAY, qx, qy, qz, left, hits);
  run(5);
  caches.add({ kind: 4, ctype: CONT.TRUNK, q: ent.q.slice() });
  run(20);
  settle();
  const wb = im.wrecks.get(car);
  let d2 = 0;
  wb.rest.forEach((r, i) => {
    for (let k = 0; k < r.length; k++) d2 = Math.max(d2, Math.abs(r[k] - A1[i][k]));
  });
  check('blows on the wreck are judged with the lid where the record has it: the boot forced before them or after them, everybody has the same car to the vertex', d2 < 1e-6 && wb.parts.map((p) => p.kind + p.state).join(' ') === statesA, `max difference ${d2}; ${statesA} / ${wb.parts.map((p) => p.kind + p.state).join(' ')}; differing: ${wb.isles.filter((s2) => Array.from(s2.verts).some((v) => Math.abs(wb.rest[s2.piece][v * 3 + 1] - A1[s2.piece][v * 3 + 1]) > 1e-6)).map((s2) => s2.name + (s2.part ? ':' + s2.part.kind : '')).join()}`);
  // refilled at dawn: shut again
  for (const e of caches) e.q[3] = 0;
  run(20);
  const shutTop = wb.bootLid().state < 3 ? lidTop() : 0;
  check('a boot that is filled again is shut again (unless a blow had its lid off)', wb.bootLid().state >= 3 || (shutTop < 1.2 && !wb.pried));
  // a lid a blow has lifted, or taken off, is no lid to force
  im.regrown();
  caches.clear();
  run(2);
  const fresh = im.wrecks.wreck(car);
  const bl = fresh.bootLid();
  const shut0 = im.wrecks.bootShut(car);
  bl.state = 1;
  const lifted = im.wrecks.bootShut(car);
  bl.state = 3;
  const off = im.wrecks.bootShut(car);
  check('a lid already lifted by a blow, or off, is not there to be forced: the boot under it is simply searched', shut0 && !lifted && !off);
  im.regrown();
}

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall ok');
process.exit(fails.length ? 1 : 0);
