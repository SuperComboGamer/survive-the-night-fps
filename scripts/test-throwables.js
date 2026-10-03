// The frag grenade and the noisemaker, in-process against a real Game: what they cost at the workbench, that both take
// their turn in the throwable slot, that a thrown grenade bounces, rolls and bursts on its fuse (killing what stands
// in its blast and nothing outside it, and luring nothing first), and that a noisemaker lands, rings and pulls the
// dead to it from far off for its time - except one already on a survivor - and hurts nothing.
// usage: node scripts/test-throwables.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { SLOT_THROW, SERVER_DT } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, RECIPES, THROWABLES, THROW_ITEMS, PROJ, ZTYPE, STRUCT, NOTIFY, SCHEM_BIT } from '../shared/defs.js';
import { readSnapshot } from '../client/net/decode.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
game.debugCommands = true;
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

function client(name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], seq: 0 };
  const nop = () => {};
  c.handler = new Proxy({ notify: (m, a) => c.notes.push([m, a]) }, { get: (t, k) => t[k] || nop });
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  c.act = (act, ...args) => {
    const w2 = new Writer(32);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    if (act === ACT.BUILD) {
      w2.u8(args[0]);
      w2.i16(Math.round(args[1] * 64));
      w2.i16(Math.round(args[2] * 64));
      w2.u8(args[3]);
    } else if (args.length) w2.u8(args[0]);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.input = (buttons, slot = 255) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(0), qpitch: qpitch(0), slot: i === 0 ? slot : 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.tp = (x, z) => game.handleChat(c.p(), `/tp ${x} ${z}`);
  return c;
}
const run = (ticks, fn) => {
  for (let i = 0; i < ticks; i++) {
    fn?.(i);
    game.update();
  }
};
const count = (p, item) => p.inv.reduce((n, it) => n + (it && it.item === item ? it.count : 0), 0);
const clearInv = (p) => {
  p.inv.fill(null);
  p.state.weapons[SLOT_THROW] = 0;
  p.invDirty = true;
  game.syncThrow(p);
};

const A = client('Alice');
const a = A.p();
const w = game.world;

// ---------------------------------------------------------------- an open, level stretch of ground to throw along
// (the thrower at one end; nothing in the way for 70 m, no water, no trees, no big rise)
const treeBy = (x0, z0, x1, z1, m) => {
  const t = w.trees;
  const l = Math.hypot(x1 - x0, z1 - z0) || 1;
  const [ux, uz] = [(x1 - x0) / l, (z1 - z0) / l];
  for (let i = 0; i < t.length; i += 6) {
    const along = Math.max(0, Math.min(l, (t[i] - x0) * ux + (t[i + 2] - z0) * uz));
    if (Math.hypot(t[i] - x0 - ux * along, t[i + 2] - z0 - uz * along) < m) return true;
  }
  return false;
};
const open = (x, z) => Math.abs(x) < 300 && Math.abs(z) < 300 && !w.isDeepWater(x, z) && !game.nav.isBlocked(x, z);
const cluttered = (x, z, r) => w.staticGrid.query(x, z, r, []).some((o) => o.y1 > w.heightAt(x, z) + 0.2 && Math.hypot(o.x - x, o.z - z) < r + o.r);
let spot = null;
for (let x = -240; x <= 240 && !spot; x += 16) {
  for (let z = -240; z <= 240 && !spot; z += 16) {
    for (let k = 0; k < 8 && !spot; k++) {
      const dx = Math.sin((k * Math.PI) / 4);
      const dz = Math.cos((k * Math.PI) / 4);
      const h0 = w.heightAt(x, z);
      let ok = open(x, z) && !cluttered(x, z, 6) && game.nav.segClear(x, z, x + dx * 70, z + dz * 70) && !treeBy(x, z, x + dx * 70, z + dz * 70, 3.5);
      for (let d = 0; d <= 70 && ok; d += 2) ok = open(x + dx * d, z + dz * d) && Math.abs(w.heightAt(x + dx * d, z + dz * d) - h0) < 2.5 && !cluttered(x + dx * d, z + dz * d, 2.5);
      if (ok) spot = { x, z, dx, dz };
    }
  }
}
check('found open level ground to throw along', !!spot, spot ? `(${spot.x}, ${spot.z}) facing ${spot.dx.toFixed(2)},${spot.dz.toFixed(2)}` : '');
if (!spot) {
  console.log('\nFAILED: no ground to test on');
  process.exit(1);
}
const s = a.state;
const yaw = Math.atan2(-spot.dx, -spot.dz); // (forward is -sin(yaw), -cos(yaw))
// the thrower, put at the near end and faced down the stretch (no input is sent while throwing: the view holds)
const stand = () => {
  A.tp(spot.x, spot.z);
  run(2);
  s.yaw = yaw;
  s.pitch = 0;
  s.vx = s.vz = 0;
};
// the dead already roaming about are put out of the way, so only the ones the checks spawn are near
const clearZombies = () => {
  for (const z of game.zombies) {
    z.dead = true;
    z.deadT = 2;
  }
  run(2);
};
const throwIt = (item) => {
  game.giveItem(a, item, 1);
  game.handleSimEvent(a, { type: 'throw', item });
  return game.projectiles[game.projectiles.length - 1];
};
const ground = (x, z) => w.floorAt(x, z, w.heightAt(x, z) + 1);

// ---------------------------------------------------------------- the recipes
{
  stand();
  clearInv(a);
  a.state.weapons[4] = ITEM.HAMMER; // (the build slot)
  game.giveItem(a, ITEM.WOOD, 10);
  game.giveItem(a, ITEM.NAILS, 10);
  game.giveItem(a, ITEM.SCRAP, 4);
  const rg = RECIPES.find((r) => r.out === ITEM.GRENADE);
  const rd = RECIPES.find((r) => r.out === ITEM.DECOY);
  check('recipe ids are their index, the new ones at the end', RECIPES.every((r, i) => r.id === i) && RECIPES.indexOf(rg) >= 31 && RECIPES.indexOf(rd) >= 31);
  check('the frag grenade costs 2 scrap and 3 gunpowder at the workbench, behind the explosives schematic', rg.station === 'bench' && rg.schem === ITEM.SCHEM_EXPLOSIVES && rg.n === 1 && JSON.stringify(rg.cost) === JSON.stringify({ [ITEM.SCRAP]: 2, [ITEM.POWDER]: 3 }));
  check('the noisemaker costs scrap, barbed wire and a battery at the workbench, no schematic', rd.station === 'bench' && !rd.schem && rd.n === 1 && JSON.stringify(rd.cost) === JSON.stringify({ [ITEM.SCRAP]: 1, [ITEM.WIRE]: 1, [ITEM.BATTERY]: 1 }));
  const pb = RECIPES.find((r) => r.out === ITEM.PIPEBOMB);
  const total = (r) => Object.values(r.cost).reduce((x, y) => x + y, 0);
  check('...the grenade is cheaper than the pipe bomb', total(rg) < total(pb) && rg.cost[ITEM.POWDER] < pb.cost[ITEM.POWDER]);

  // no bench yet: nothing is made, nothing is spent
  game.giveItem(a, ITEM.WIRE, 1);
  game.giveItem(a, ITEM.BATTERY, 1);
  A.notes.length = 0;
  A.act(ACT.CRAFT, rd.id);
  run(1);
  check('away from a workbench the noisemaker is not made', count(a, ITEM.DECOY) === 0 && A.notes.some(([m]) => m === NOTIFY.NEED_BENCH));
  // a workbench beside her
  A.input(0, 4);
  run(10, () => A.input(0));
  const n0 = game.structures.length;
  for (let k = 0; k < 12 && game.structures.length === n0; k++) {
    const t = (k / 12) * Math.PI * 2;
    A.act(ACT.BUILD, STRUCT.WORKBENCH, s.x + Math.sin(t) * 3, s.z + Math.cos(t) * 3, 0);
    run(4);
  }
  check('a workbench went up', game.structures.some((e) => e.stype === STRUCT.WORKBENCH));
  clearInv(a);
  game.giveItem(a, ITEM.SCRAP, 3);
  game.giveItem(a, ITEM.POWDER, 3);
  game.giveItem(a, ITEM.WIRE, 1);
  game.giveItem(a, ITEM.BATTERY, 1);
  A.notes.length = 0;
  A.act(ACT.CRAFT, rg.id);
  run(1);
  check('without the explosives schematic the grenade is locked', count(a, ITEM.GRENADE) === 0 && count(a, ITEM.POWDER) === 3 && A.notes.some(([m, x]) => m === NOTIFY.LOCKED && x === ITEM.SCHEM_EXPLOSIVES));
  game.unlockSchematic(ITEM.SCHEM_EXPLOSIVES, a);
  check('(schematic found)', !!(game.unlocked & (1 << SCHEM_BIT[ITEM.SCHEM_EXPLOSIVES])));
  A.act(ACT.CRAFT, rg.id);
  run(1);
  check('a crafted grenade took 2 scrap and 3 gunpowder', count(a, ITEM.GRENADE) === 1 && count(a, ITEM.SCRAP) === 1 && count(a, ITEM.POWDER) === 0, `grenades ${count(a, ITEM.GRENADE)}, scrap ${count(a, ITEM.SCRAP)}, powder ${count(a, ITEM.POWDER)}`);
  A.act(ACT.CRAFT, rd.id);
  run(1);
  check('a crafted noisemaker took 1 scrap, 1 wire and 1 battery', count(a, ITEM.DECOY) === 1 && count(a, ITEM.SCRAP) === 0 && count(a, ITEM.WIRE) === 0 && count(a, ITEM.BATTERY) === 0);
  A.act(ACT.CRAFT, rd.id);
  run(1);
  check('...and with nothing left, no second one', count(a, ITEM.DECOY) === 1);
  check('both are throwables that stack to 3', [ITEM.GRENADE, ITEM.DECOY].every((it) => ITEM_DEFS[it].cat === 'throw' && ITEM_DEFS[it].stack === 3 && THROW_ITEMS.includes(it)));
}

// ---------------------------------------------------------------- the throwable slot
{
  clearInv(a);
  for (const it of [ITEM.MOLOTOV, ITEM.PIPEBOMB, ITEM.GRENADE, ITEM.DECOY, ITEM.FLARE]) game.giveItem(a, it, 2);
  run(1);
  // [4] on the throwable slot: the next throwable carried, in THROW_ITEMS order (client/game/game.js)
  const next = () => {
    const i = THROW_ITEMS.indexOf(s.weapons[SLOT_THROW]);
    for (let k = 1; k <= THROW_ITEMS.length; k++) {
      const it = THROW_ITEMS[(i + k) % THROW_ITEMS.length];
      if (count(a, it) && it !== s.weapons[SLOT_THROW]) return A.act(ACT.SELECT_THROWABLE, it);
    }
  };
  const seen = [s.weapons[SLOT_THROW]];
  for (let k = 0; k < 5; k++) {
    next();
    run(1);
    seen.push(s.weapons[SLOT_THROW]);
  }
  const name = (it) => ITEM_DEFS[it]?.name || it;
  check('[4] cycles through every throwable, the grenade and the noisemaker with them', seen.join() === [ITEM.MOLOTOV, ITEM.PIPEBOMB, ITEM.GRENADE, ITEM.DECOY, ITEM.FLARE, ITEM.MOLOTOV].join(), seen.map(name).join(' > '));
  A.act(ACT.SELECT_THROWABLE, ITEM.GRENADE);
  run(1);
  check('the grenade selected, the slot counts grenades', s.weapons[SLOT_THROW] === ITEM.GRENADE && s.throwCount === 2);
  A.act(ACT.SELECT_THROWABLE, ITEM.DECOY);
  run(1);
  check('the noisemaker selected, the slot counts noisemakers', s.weapons[SLOT_THROW] === ITEM.DECOY && s.throwCount === 2);
  // the last noisemaker thrown: the slot moves on to another throwable carried
  clearZombies();
  for (let k = 0; k < 2; k++) {
    game.handleSimEvent(a, { type: 'throw', item: ITEM.DECOY });
    run(1);
  }
  check('throwing the last noisemaker moves the slot on to what is left', count(a, ITEM.DECOY) === 0 && s.weapons[SLOT_THROW] !== ITEM.DECOY && s.weapons[SLOT_THROW] !== 0);
  for (const e of [...game.projectiles]) {
    game.projectiles.splice(game.projectiles.indexOf(e), 1);
    game.removeEntity(e);
  }
  clearInv(a);
}

// ---------------------------------------------------------------- the frag grenade
{
  const def = THROWABLES[ITEM.GRENADE];
  stand();
  clearZombies();
  // a walker 20 m off to the side of where it will come down: no beeping, no lure
  const side = (d, off) => [spot.x + spot.dx * d - spot.dz * off, spot.z + spot.dz * d + spot.dx * off];
  const watcher = game.zm.spawn(ZTYPE.WALKER, ...side(10, 20));
  s.pitch = -0.3; // (lobbed a little short, so it is lying still among them before it goes off)
  const t0 = game.time;
  const g = throwIt(ITEM.GRENADE);
  check('a grenade leaves the hand as a grenade', !!g && g.ptype === PROJ.GRENADE && count(a, ITEM.GRENADE) === 0);
  // follow it: when it is on the ground, and where it comes to rest
  let bounced = 0;
  let rolled = 0;
  let lastVy = g.vy;
  let rest = null;
  let lured = false;
  let boomAt = null;
  let boomPos = null;
  const explode = game.combat.explode.bind(game.combat);
  let blasts = [];
  game.combat.explode = (x, y, z, r, opts) => {
    blasts.push({ x, y, z, r, opts, t: game.time });
    return explode(x, y, z, r, opts);
  };
  const kills = [];
  const dz = game.combat.damageZombie.bind(game.combat);
  game.combat.damageZombie = (z, dmg, owner, opts = {}) => {
    const r = dz(z, dmg, owner, opts);
    if (z.dead) kills.push({ z, weapon: opts.weapon, owner });
    return r;
  };
  let inside = null;
  let outside = null;
  for (let i = 0; i < 80 && game.projectiles.includes(g); i++) {
    const was = { x: g.x, y: g.y, z: g.z };
    game.update();
    if (watcher.lureT > 0) lured = true;
    if (!game.projectiles.includes(g)) break;
    if (lastVy < -0.5 && g.vy > 0) bounced++;
    lastVy = g.vy;
    if (g.rolling) rolled++;
    const moved = Math.hypot(g.x - was.x, g.z - was.z);
    if (!rest && g.grav === 0 && !g.rolling && moved < 1e-4) {
      rest = { x: g.x, y: g.y, z: g.z, t: game.time - t0 };
      // the dead it is about to go off among: one well inside the blast, one well outside it
      const fx = spot.dz;
      const fz = -spot.dx;
      inside = game.zm.spawn(ZTYPE.WALKER, g.x + fx * 1.5, g.z + fz * 1.5);
      outside = game.zm.spawn(ZTYPE.WALKER, g.x - fx * (def.radius + 5), g.z - fz * (def.radius + 5));
    }
  }
  const b = blasts.find((x) => x.opts.weapon === ITEM.GRENADE);
  if (b) {
    boomAt = b.t - t0;
    boomPos = b;
  }
  const flew = boomPos ? Math.hypot(boomPos.x - spot.x, boomPos.z - spot.z) : 0;
  check('it bounces off the ground and rolls on', bounced >= 1 && rolled > 0, `${bounced} bounce(s), rolled ${(rolled * SERVER_DT).toFixed(2)} s`);
  check('it comes to rest on the ground before it goes off', !!rest && Math.abs(rest.y - 0.08 - ground(rest.x, rest.z)) < 0.05, rest ? `at ${rest.t.toFixed(2)} s, ${Math.hypot(rest.x - spot.x, rest.z - spot.z).toFixed(1)} m out` : 'never rested');
  check(`it goes off ${def.fuse} s after the throw`, boomAt !== null && Math.abs(boomAt - def.fuse) <= SERVER_DT * 1.5 && !game.projectiles.includes(g), boomAt !== null ? `${boomAt.toFixed(2)} s, ${flew.toFixed(1)} m from the thrower` : 'no blast');
  check(`...a ${def.radius} m blast of ${def.damage}, quieter than a pipe bomb's`, !!b && b.r === def.radius && b.opts.zombies === def.damage && b.opts.noise === def.noise && def.noise < 170 && !b.opts.humans);
  check('it kills the walker in its blast, and the kill is the thrower\'s with the grenade', !!inside && inside.dead && kills.some((k) => k.z === inside && k.weapon === ITEM.GRENADE && k.owner === a));
  check('...and leaves the one outside it unhurt', !!outside && !outside.dead && outside.hp === outside.maxHp, outside ? `${Math.hypot(outside.x - boomPos.x, outside.z - boomPos.z).toFixed(1)} m out, hp ${outside.hp}/${outside.maxHp}` : '');
  check('the grenade lures nothing while it rolls and ticks', !lured && !(watcher.lureT > 0));
  check('it hurts no survivor (as the pipe bomb does not)', a.hp === a.maxHp);
  game.combat.explode = explode;
  game.combat.damageZombie = dz;
  clearZombies();
}

// ---------------------------------------------------------------- the noisemaker
{
  const def = THROWABLES[ITEM.DECOY];
  stand();
  clearZombies();
  clearInv(a);
  const hp = a.hp;
  // one on Alice already, and one far down the stretch
  const onHer = game.zm.spawn(ZTYPE.WALKER, s.x + spot.dz * 1.2, s.z - spot.dx * 1.2);
  onHer.target = a.id;
  run(10);
  let blasts = 0;
  const explode = game.combat.explode.bind(game.combat);
  game.combat.explode = (...args) => {
    blasts++;
    return explode(...args);
  };
  const t0 = game.time;
  const d = throwIt(ITEM.DECOY);
  check('a noisemaker leaves the hand as a noisemaker', !!d && d.ptype === PROJ.DECOY);
  let landedAt = null;
  for (let i = 0; i < 60 && !landedAt; i++) {
    run(1);
    if (d.landed) landedAt = game.time - t0;
  }
  check('it lands', landedAt !== null && Math.abs(d.y - 0.08 - ground(d.x, d.z)) < 0.05, landedAt !== null ? `after ${landedAt.toFixed(2)} s, ${Math.hypot(d.x - spot.x, d.z - spot.z).toFixed(1)} m out` : '');
  // walkers far off: down the stretch past it, near the edge of its reach
  const far = (k) => game.zm.spawn(ZTYPE.WALKER, d.x + spot.dx * (def.lure - 7) - spot.dz * k, d.z + spot.dz * (def.lure - 7) + spot.dx * k);
  const pack = [far(0), far(2.5)];
  const gap = (z) => Math.hypot(z.x - d.x, z.z - d.z);
  run(2);
  const g0 = pack.map(gap);
  const onGap0 = gap(onHer);
  run(Math.round(5 / SERVER_DT));
  const g1 = pack.map(gap);
  check(`the dead ${def.lure - 7} m off come to it while it rings`, pack.every((z, i) => z.lureT > 0 && g1[i] < g0[i] - 3), pack.map((z, i) => `${g0[i].toFixed(1)} -> ${g1[i].toFixed(1)} m`).join(', '));
  const onDist = Math.hypot(onHer.x - s.x, onHer.z - s.z);
  check('...but the one already on Alice stays on her', !onHer.dead && onDist < 3 && onHer.target === a.id, `${onDist.toFixed(1)} m from her, ${onGap0.toFixed(1)} -> ${gap(onHer).toFixed(1)} m from it`);
  check('it is still ringing', game.projectiles.includes(d) && d.fuse > 0);
  // the walkers' distance when the noisemaker gives out, and what they do after
  let goneAt = null;
  for (let i = 0; i < Math.round((def.lureTime + 5) / SERVER_DT) && goneAt === null; i++) {
    run(1);
    if (!game.projectiles.includes(d)) goneAt = game.time - t0;
  }
  const rang = goneAt === null ? null : goneAt - landedAt;
  check(`it rings for ${def.lureTime} s, then it is gone`, rang !== null && Math.abs(rang - def.lureTime) <= SERVER_DT * 1.5, rang !== null ? `rang ${rang.toFixed(2)} s` : 'still there');
  run(Math.round(1.5 / SERVER_DT));
  check('...and once it stops, it lures no more', pack.every((z) => !(z.lureT > 0)), pack.map((z) => z.lureT.toFixed(2)).join(', '));
  check('it does no damage to anything', blasts === 0 && pack.every((z) => !z.dead && z.hp === z.maxHp) && a.hp === hp);
  game.combat.explode = explode;
}

console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'all checks passed'}`);
process.exit(fails.length ? 1 : 0);
