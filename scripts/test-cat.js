// The stray cat in a survivor's arms (server/cats.js, s.pet in shared/playersim.js): in-process checks against a real
// Game, with what the server sends decoded as a client does.
//   - picking it up: [E] on it (ACT.INTERACT), from within reach and not from across the road; it rides along in
//     their arms, replicated with its holder; nobody takes it out of them; the "Who Is a Good Kitty?" feat
//   - in their arms: no weapon goes off, swings or reloads; the fire button strokes it (CANIM.PET); they run as fast
//     as ever and do not swim with it
//   - setting it down: [E] / [G] (ACT.CAT_PUT) in front of them, a weapon key where they stand, using a medkit; and it
//     leaps clear when they go down, die, drop off the game or leave
//   - the island's car driving off with it in somebody's arms: "Nobody Gets Left Behind" for them (and only them),
//     and the cat sits beside them at the bridgehead on the mainland
// usage: node scripts/test-cat.js [seed = 1]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, ENT, CAR_ID, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE, CMD_DT, SLOT_PRIMARY, SLOT_PISTOL, WALK_SPEED, WATER_LEVEL, PHASE, ENGINE_START_TIME, ESCAPE_DRIVE_TIME } from '../shared/constants.js';
import { createPlayerState, copyPlayerState, simulatePlayer } from '../shared/playersim.js';
import { ITEM, WEAPONS, CANIM, KILLER } from '../shared/defs.js';
import { ACH_BY_N, ACH_BY_ID } from '../shared/achievements.js';
import { WORLD, CROSSING } from '../shared/acts.js';
import { groundAt } from '../shared/collision.js';
import { swimming } from '../shared/swim.js';
import { readSnapshot } from '../client/net/decode.js';
import { CAT_MODE } from '../server/cats.js';

const seed = +(process.argv[2] || 1);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`);
  if (!ok) fails.push(name);
};

const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });

function client(name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, feats: [], seq: 0 };
  const nop = () => {};
  c.handler = new Proxy({ achieve: (flags, add, ids) => c.feats.push(...ids.map((n) => ACH_BY_N[n].id)) }, { get: (t, k) => t[k] || nop });
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
    },
    congested: () => false,
    cork: (fn) => fn(),
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  c.yaw = 0;
  c.act = (act, ...a) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    if (act === ACT.INTERACT || act === ACT.HOLD_BEGIN) w2.u16(a[0]);
    else if (a.length) w2.u8(a[0]);
    game.onMessage(c.session, w2.bytes().slice());
  };
  // a tick's worth of commands (3); slot: a weapon asked for on the first
  c.input = (buttons, slot = 255) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(c.yaw), qpitch: qpitch(0), slot: i === 0 ? slot : 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}

const A = client('Ann');
const B = client('Ben');
const a = A.p();
const b = B.p();
const s = a.state;
const run = (ticks, fa, fb) => {
  for (let i = 0; i < ticks; i++) {
    A.input(fa ? fa(i) : 0);
    B.input(fb ? fb(i) : 0);
    game.update();
  }
};
const secs = (t) => Math.round(t * SERVER_TICK_RATE);
// the dead the valley put down at the start go: one wandering up would send the cat running
const clearDead = () => {
  for (const z of game.zombies) {
    z.dead = true;
    game.removeEntity(z);
  }
  game.zombies.length = 0;
};
clearDead();
const cat = () => game.cats[0];
const seen = (c) => [...c.store.ents.values()].find((e) => e.kind === ENT.CAT && e.id === cat()?.id);
// stands a player d m from the cat, facing it (from the first side round it with nothing between their eye and it)
const toCat = (c, d = 1.2, side = 0) => {
  const k = cat();
  const p = c.p();
  const st = p.state;
  for (let i = 0; i < 8; i++) {
    const ang = side + i * (Math.PI / 4);
    st.x = k.x + Math.sin(ang) * d;
    st.z = k.z + Math.cos(ang) * d;
    st.y = groundAt(game.world, st.x, st.z, k.y + 1, 0.3);
    if (game.canReachEnt(p, k) && Math.abs(st.y - k.y) < 0.3) break;
  }
  st.vx = st.vy = st.vz = 0;
  c.yaw = Math.atan2(st.x - k.x, st.z - k.z);
  game.fillHistory(p);
};
const lift = (c) => {
  // (the cat sits still for it: a fresh visit or wander would carry it off between the two)
  Object.assign(cat(), { mode: CAT_MODE.SIT, modeT: 30, vx: 0, vz: 0 });
  toCat(c);
  run(4); // (the server takes one [E] in 0.15 s)
  c.act(ACT.INTERACT, cat().id);
  run(2);
};
const held = () => cat().mode === CAT_MODE.HELD;

run(5);
check('a new game has the stray cat near the car, in nobody\'s arms', !!cat() && !held() && cat().holder === 0 && Math.hypot(cat().x - game.world.car.x, cat().z - game.world.car.z) < 14 && seen(A)?.q[5] === 0);

// ---------------------------------------------------------------- picking it up
{
  Object.assign(cat(), { mode: CAT_MODE.SIT, modeT: 30 });
  toCat(A, 6);
  A.act(ACT.INTERACT, cat().id);
  run(2);
  check('not from 6 m off', !held() && !s.pet);
  lift(A);
  const e = seen(B);
  check('[E] on it: it is in their arms, and everybody sees whose', held() && cat().holder === a.id && s.pet === 1 && A.self.pet === 1 && e?.q[5] === a.id && (e.q[4] === CANIM.HELD || e.q[4] === CANIM.PET), `mode ${cat().mode}, holder ${cat().holder}, s.pet ${s.pet}, Ann told ${A.self.pet}, Ben sees ${e?.q[5]}/${e?.q[4]}`);
  run(secs(1.2));
  check('the feat for picking it up goes to them', A.feats.includes('cat_lift') && !B.feats.includes('cat_lift'), JSON.stringify([A.feats, B.feats]));
  // nobody takes it out of their arms
  toCat(B, 0.8, 2);
  B.act(ACT.INTERACT, cat().id);
  run(2);
  check('nobody takes it out of their arms', cat().holder === a.id && !b.state.pet);
  // it goes where they go
  const x0 = s.x;
  const z0 = s.z;
  run(secs(1), () => BTN.FWD);
  check('it rides along with them, at their chest', Math.hypot(s.x - x0, s.z - z0) > 2 && Math.hypot(cat().x - s.x, cat().z - s.z) < 0.01 && Math.abs(cat().y - s.y - 1.05) < 0.01, `walked ${Math.hypot(s.x - x0, s.z - z0).toFixed(2)} m, the cat ${Math.hypot(cat().x - s.x, cat().z - s.z).toFixed(2)} m off, ${(cat().y - s.y).toFixed(2)} m up`);
}

// ---------------------------------------------------------------- in their arms
{
  game.giveItem(a, ITEM.PISTOL, 1);
  s.weapons[SLOT_PISTOL] = ITEM.PISTOL;
  s.mags[1] = 5;
  const fc = s.fireCount;
  run(secs(1), () => BTN.ATTACK | BTN.RELOAD | BTN.ALT);
  check('the fire button strokes it: it purrs (CANIM.PET), and nothing is fired, swung or reloaded', held() && cat().anim === CANIM.PET && seen(B)?.q[4] === CANIM.PET && s.fireCount === fc && s.mags[1] === 5 && s.reloadT === 0, `anim ${cat().anim}, fired ${s.fireCount - fc}, mag ${s.mags[1]}`);
  run(2);
  check('...and stops when it is let go', cat().anim === CANIM.HELD);
  // the pace: the same stretch walked and sprinted with it and without, in the simulation both ends run
  const pace = (pet, buttons) => {
    const st = copyPlayerState(createPlayerState(), s);
    st.pet = pet;
    st.vx = st.vz = 0;
    st.stamina = 100;
    const cmd = { seq: 0, buttons, yaw: 0.4, pitch: 0, slot: 255 };
    for (let i = 0; i < 30; i++) simulatePlayer(st, cmd, game.world, null);
    const x = st.x;
    const z = st.z;
    for (let i = 0; i < 60; i++) simulatePlayer(st, cmd, game.world, null);
    return Math.hypot(st.x - x, st.z - z) / (60 * CMD_DT);
  };
  const walk = pace(1, BTN.FWD);
  const sprint = pace(1, BTN.FWD | BTN.SPRINT);
  const walk0 = pace(0, BTN.FWD);
  const sprint0 = pace(0, BTN.FWD | BTN.SPRINT);
  check('it slows nobody down: walking and sprinting with it as fast as without', walk === walk0 && sprint === sprint0 && walk > WALK_SPEED * 0.8 && sprint > WALK_SPEED * 1.2, `walking ${walk.toFixed(2)} / ${walk0.toFixed(2)}, sprinting ${sprint.toFixed(2)} / ${sprint0.toFixed(2)} m/s`);
}

// into the lake: nobody swims with it
{
  const L = game.world.lake;
  if (!L) check('a lake to walk into', false, `seed ${seed} has none`);
  else {
    if (!held()) lift(A);
    const ang = Math.atan2(-L.x, -L.z);
    s.x = L.x + Math.sin(ang) * (L.r + 10);
    s.z = L.z + Math.cos(ang) * (L.r + 10);
    s.y = groundAt(game.world, s.x, s.z, 200, 0.3);
    s.vx = s.vy = s.vz = 0;
    A.yaw = Math.atan2(s.x - L.x, s.z - L.z);
    game.fillHistory(a);
    let afloat = 0;
    let deepest = 0;
    for (let t = 0; t < secs(25); t++) {
      A.input(BTN.FWD | BTN.SPRINT);
      B.input(0);
      game.update();
      if (swimming(game.world, s)) afloat++;
      deepest = Math.max(deepest, WATER_LEVEL - s.y);
    }
    check('with the cat in their arms the deep water stops them where they would float', afloat === 0 && deepest > 0.5 && held() && cat().holder === a.id, `${afloat} ticks afloat, waded ${deepest.toFixed(2)} m deep`);
  }
}

// ---------------------------------------------------------------- setting it down
{
  // (back on dry land by the car: at the lake's edge it would be set down at their feet, not in the water ahead)
  Object.assign(cat(), { x: game.world.car.x + 4, z: game.world.car.z + 4, mode: CAT_MODE.SIT, holder: 0 });
  s.pet = 0;
  cat().y = groundAt(game.world, cat().x, cat().z, 50, 0.16);
  lift(A);
  A.yaw = 0.7;
  run(2);
  A.act(ACT.CAT_PUT);
  run(1);
  const ahead = { x: s.x - Math.sin(s.yaw) * 0.65, z: s.z - Math.cos(s.yaw) * 0.65 };
  check('[E] / [G]: it is set down in front of them, on the ground, sitting', !held() && !s.pet && cat().holder === 0 && Math.hypot(cat().x - ahead.x, cat().z - ahead.z) < 0.15 && Math.abs(cat().y - groundAt(game.world, cat().x, cat().z, s.y + 0.6, 0.16)) < 0.05 && cat().anim === CANIM.SIT && seen(B)?.q[5] === 0, `${Math.hypot(cat().x - ahead.x, cat().z - ahead.z).toFixed(2)} m from the spot, anim ${cat().anim}`);
  run(secs(0.5));
  check('...and Ann is told her arms are empty', A.self.pet === 0);

  lift(A);
  const at = { x: s.x, z: s.z };
  const slot0 = s.slot;
  const want = slot0 === SLOT_PISTOL ? SLOT_PRIMARY : SLOT_PISTOL;
  if (!s.weapons[want]) s.weapons[want] = want === SLOT_PISTOL ? ITEM.PISTOL : ITEM.AK47;
  A.input(0, want);
  game.update();
  run(1);
  check('a weapon key sets it down where they stand, and the weapon comes out', !held() && !s.pet && s.slot === want && Math.hypot(cat().x - at.x, cat().z - at.z) < 0.7, `slot ${slot0} -> ${s.slot}, ${Math.hypot(cat().x - at.x, cat().z - at.z).toFixed(2)} m off`);

  lift(A);
  a.hp = 50;
  game.giveItem(a, ITEM.BANDAGE, 1);
  const bi = a.inv.findIndex((x) => x && x.item === ITEM.BANDAGE);
  A.act(ACT.USE_ITEM, bi);
  run(2);
  check('using a bandage: the hands go to it, and the cat is set down first', !held() && !s.pet && !!a.useItem, `held ${held()}, using ${!!a.useItem}`);
  run(secs(4));
  a.hp = a.maxHp;
}

// ---------------------------------------------------------------- it leaps clear
{
  lift(A);
  game.goDown(a);
  run(2);
  check('going down: it leaps clear and runs', !held() && !s.pet && cat().mode === CAT_MODE.FLEE);
  game.revive(a, b);
  run(secs(3));
  check('down, they cannot pick it up', (() => {
    game.goDown(a);
    Object.assign(cat(), { mode: CAT_MODE.SIT, modeT: 30 });
    toCat(A);
    A.act(ACT.INTERACT, cat().id);
    run(2);
    const ok = !held();
    game.revive(a, b);
    run(secs(3));
    return ok;
  })());

  lift(A);
  game.killPlayer(a, { kind: KILLER.WORLD });
  run(2);
  check('dying: it leaps clear', !held() && !s.pet);
  game.spawnHuman(a);
  run(secs(1));
}

// a dropped connection: let go of where they stood
{
  const C = client('Cy');
  const c = C.p();
  clearDead();
  lift(C);
  check('a third survivor picks it up', held() && cat().holder === c.id, `mode ${cat().mode}, holder ${cat().holder}, Cy ${c.id} alive ${c.alive} zombie ${c.zombie} downed ${c.downed} hold ${!!c.hold} use ${!!c.useItem} swimming ${swimming(game.world, c.state)} d ${Math.hypot(c.state.x - cat().x, c.state.z - cat().z).toFixed(2)} dy ${(c.state.y - cat().y).toFixed(2)}`);
  game.onClose(C.session);
  run(2);
  check('their connection drops: it is let go of', !held() && cat().holder === 0);
}

// ---------------------------------------------------------------- off the island in somebody's arms
{
  const b2 = B.p();
  const a2 = A.p();
  if (!a2.alive || a2.zombie) game.spawnHuman(a2);
  clearDead();
  const car = game.world.car;
  const at = (p, dx) => {
    p.state.x = car.x + dx;
    p.state.z = car.z + 2.5;
    p.state.y = groundAt(game.world, p.state.x, p.state.z, 50, 0.3);
    p.state.vx = p.state.vz = 0;
    game.fillHistory(p);
  };
  // Ann takes the cat to the car; Ben starts it and, once the stand is over, drives
  Object.assign(cat(), { mode: CAT_MODE.SIT, modeT: 30, x: car.x + 3, z: car.z + 4 });
  cat().y = groundAt(game.world, cat().x, cat().z, 50, 0.16);
  lift(A);
  at(a2, 1.5);
  at(b2, -1.5);
  game.supplies = game.sup.need.slice();
  game.globalDirty = true;
  run(2);
  B.act(ACT.HOLD_BEGIN, CAR_ID);
  run(secs(ENGINE_START_TIME + 0.3));
  check("the final stand begins with the cat in Ann's arms", game.escape.active && held() && cat().holder === a2.id, JSON.stringify(game.escape));
  game.escape.t = 0.2;
  clearDead();
  run(secs(1));
  check('...and is won', game.escape.ready);
  B.act(ACT.HOLD_BEGIN, CAR_ID);
  const variant = cat().variant;
  A.feats.length = 0;
  B.feats.length = 0;
  run(secs(ESCAPE_DRIVE_TIME + 0.3));
  check('the car drives off: the crossing', game.phase === PHASE.CROSSING, `phase ${game.phase}`);
  run(secs(0.5));
  check('"Nobody Gets Left Behind" goes to whoever had the cat in their arms, at once, and to nobody else (not the driver)', A.feats.includes('cat_escape') && !B.feats.includes('cat_escape'), JSON.stringify([A.feats, B.feats]));
  game.arrive();
  run(secs(1));
  const ns = a2.state;
  const near = game.cats.filter((k) => Math.hypot(k.x - ns.x, k.z - ns.z) < 2.5);
  check('on the mainland the cat that crossed sits beside them at the bridgehead, in nobody\'s arms', game.act === WORLD.MAINLAND && near.length === 1 && near[0].variant === variant && near[0].holder === 0 && !ns.pet && game.cats.length === 2, `act ${game.act}, ${near.length} cats beside Ann (of ${game.cats.length}), coat ${near[0]?.variant} (was ${variant}), s.pet ${ns.pet}`);
}

// a drive-off with nobody holding it: no feat for anyone
{
  const g2 = new Game({ seed: seed + 1, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  const sent = [];
  g2.ach.feat = ((f) => (p, id) => (sent.push(id), f.call(g2.ach, p, id)))(g2.ach.feat);
  g2.ach.leftIsland();
  check('nobody holding it: nobody has the escape feat', !sent.includes('cat_escape'));
}

check('the two feats are on the list, numbered and named', ACH_BY_ID.get('cat_lift')?.n === 70 && ACH_BY_ID.get('cat_escape')?.n === 71 && ACH_BY_N[70]?.id === 'cat_lift');
void WEAPONS;
void CROSSING;

if (fails.length) {
  console.log(`\n${fails.length} FAILED`);
  process.exit(1);
}
console.log('\nall cat checks passed');
