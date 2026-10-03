// St. Agnes Cemetery (shared/cemetery.js, server/cemetery.js): the place on a few valleys, and the rule in a game.
//   - every valley has it behind its chapel, and every grave is a spot one of the dead can stand up on
//   - the dead that come up in it get out through the railings (the gate, the two panels that are down) to a
//     survivor at the chapel's door
//   - by day a restless grave gives up one walker to a survivor who comes close, once, after a warning, and the
//     walker can be shot in the head while it climbs but not through the ground
//   - by night a wave gives a share of its walkers and runners to the graves, and the horde is no bigger for it
//   - a scripted night: a ring of walls round the chapel, and the dead come up inside it and reach the survivors
// usage: node scripts/test-cemetery.js [seed ...]   (VERBOSE=1 prints the passes too)
import { createWorld } from '../shared/world.js';
import { CEMETERY, riseDepth } from '../shared/cemetery.js';
import { ZONE, ZTYPE, ZANIM, ITEM, STRUCT, CONT, NOTIFY } from '../shared/defs.js';
import { PHASE, SERVER_TICK_RATE, SLOT_BUILD, EYE_HEIGHT, NIGHT_LENGTH } from '../shared/constants.js';
import { resolveBody, groundAt } from '../shared/collision.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { Game } from '../server/game.js';
import { Nav } from '../server/nav.js';
import { readSnapshot, dqpos } from '../client/net/decode.js';

const SEEDS = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 2, 3, 4, 5, 6];
const fails = [];
const check = (name, ok, info = '') => {
  if (!ok) fails.push(name);
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  return ok;
};

// ---------------------------------------------------------------- the place, on every valley
for (const seed of SEEDS) {
  const world = createWorld(seed);
  const tag = `[${seed}]`;
  const cem = world.cemetery;
  if (!check(`${tag} the valley has its chapel, and the cemetery behind it`, !!world.zoneById[ZONE.CHURCH] && !!cem)) continue;
  const nav = new Nav(world);
  check(`${tag} it has rows of graves`, cem.graves.length >= 30 && cem.graves.length <= 96, `${cem.graves.length}`);
  let bad = 0;
  for (const gr of cem.graves) {
    const pos = { x: gr.x, y: gr.y, z: gr.z };
    resolveBody(world, pos, 0.38, 1.75, false);
    if (nav.isBlocked(gr.x, gr.z) || world.isDeepWater(gr.x, gr.z) || Math.hypot(pos.x - gr.x, pos.z - gr.z) > 0.05 || Math.abs(gr.y - world.heightAt(gr.x, gr.z)) > 1e-6) bad++;
  }
  check(`${tag} every grave is open ground a body can stand up on`, bad === 0, `${bad} of ${cem.graves.length} are not`);
  const inYard = cem.graves.filter((gr) => !cem.inside(gr.x, gr.z)).length;
  check(`${tag} most of them inside the railings, a few in the churchyard beside the chapel`, inYard >= 3 && inYard <= 12 && cem.graves.length - inYard >= 25, `${inYard} in the churchyard`);
  const mine = (o) => o.zone === ZONE.CEMETERY;
  const casket = world.containers.filter((c) => c.ctype === CONT.CASKET);
  check(`${tag} the crypt holds the one casket, and the cemetery has loot of its own`, casket.length === 1 && cem.inside(casket[0].x, casket[0].z) && world.containers.filter(mine).length >= 2 && world.lootSpawns.filter(mine).length >= 3, `${casket.length} caskets, ${world.containers.filter(mine).length} containers, ${world.lootSpawns.filter(mine).length} loot points`);
  check(`${tag} the crypt has a doorway to board up`, world.openings.some((o) => cem.inside(o.x, o.z)));
  check(`${tag} a car supply can be hidden in it, as one of the chapel's`, world.partSpots.some((s) => s.zone === ZONE.CHURCH && cem.inside(s.x, s.z)) && !world.partSpots.some(mine));
}

// ---------------------------------------------------------------- a game
{
  const seed = SEEDS[0];
  const tag = `[game ${seed}]`;
  // (the first night: a horde of walkers and runners only, so nothing in it dies by its own hand and the count can
  // be held to the number planned)
  const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  const join = (name) => {
    const c = { id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, graves: [], notes: [] };
    c.handler = new Proxy({ grave: (i) => c.graves.push(i), notify: (msg) => c.notes.push(msg) }, { get: (t, k) => t[k] || (() => {}) });
    c.session = game.onOpen({
      send(bytes) {
        const r = new Reader(bytes.slice().buffer);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
      },
    });
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    game.onMessage(c.session, w.bytes().slice());
    c.p = () => game.players.get(c.id);
    c.put = (x, z) => {
      const s = c.p().state;
      [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.onGround] = [x, groundAt(game.world, x, z, 200, 0.3), z, 0, 0, 0, 1];
      game.fillHistory(c.p());
    };
    return c;
  };
  const A = join('Agnes');
  const B = join('Bram');
  const others = [join('Cora'), join('Dov')]; // (they only stand about: with four survivors the horde is half as big again)
  const run = (secs, each) => {
    for (let t = 0; t < secs * SERVER_TICK_RATE; t++) {
      game.update();
      if (each?.()) return t / SERVER_TICK_RATE;
    }
    return -1;
  };
  const world = game.world;
  const cem = world.cemetery;
  const rule = game.cemetery;
  const zn = world.zoneById[ZONE.CHURCH];
  // the chapel's own frame: its door at -Z, the cemetery behind it at +Z
  const wx = (lx, lz) => zn.x + Math.cos(zn.ry) * lx + Math.sin(zn.ry) * lz;
  const wz = (lx, lz) => zn.z - Math.sin(zn.ry) * lx + Math.cos(zn.ry) * lz;
  const local = (x, z) => [Math.cos(zn.ry) * (x - zn.x) - Math.sin(zn.ry) * (z - zn.z), Math.sin(zn.ry) * (x - zn.x) + Math.cos(zn.ry) * (z - zn.z)];
  const living = () => game.zombies.filter((z) => !z.dead);
  const clear = () => {
    for (const z of [...game.zombies]) if (!z.dead) game.combat.killZombie(z, null, {});
    run(2);
  };
  const far = [world.car.x, world.car.z];
  const farEnough = Math.hypot(far[0] - cem.x, far[1] - cem.z) > CEMETERY.NEAR + 40;
  run(0.5);
  game.zm.maintainT = game.zm.herds.spawnT = 1e9; // (no wanderers turning up in the middle of a check)
  for (const c of [A, B, ...others]) c.put(...far);
  clear();

  // ---- by day: restless graves
  check(`${tag} three graves are restless on the first day`, rule.restless.length === CEMETERY.RESTLESS && new Set(rule.restless).size === CEMETERY.RESTLESS && rule.restless.every((i) => cem.graves[i]), `${rule.restless}`);
  run(3);
  check(`${tag} with nobody near, nothing comes up`, rule.risen === 0 && rule.pending.length === 0 && A.graves.length === 0);
  {
    const i = rule.restless[0];
    const gr = cem.graves[i];
    // 4.5 m along the row from it, where nothing stands between her and the grave
    const side = [Math.cos(gr.yaw), -Math.sin(gr.yaw)];
    const at = [1, -1].map((k) => [gr.x + side[0] * 4.5 * k, gr.z + side[1] * 4.5 * k]).find(([x, z]) => game.zm.clearLine(x, world.heightAt(x, z) + EYE_HEIGHT, z, gr.x, gr.y + 0.6, gr.z)) || [gr.x + side[0] * 4.5, gr.z + side[1] * 4.5];
    A.put(...at);
    const p = A.p();
    const stirAt = game.tick;
    const tStir = run(1, () => rule.pending.some((q) => q.grave === i && q.stirred));
    // (another restless grave may lie within reach of the same spot: then that one wakes too)
    check(`${tag} a survivor ${CEMETERY.WAKE} m from a restless grave wakes it`, tStir >= 0 && tStir < 0.3 && rule.restless.length < CEMETERY.RESTLESS && !rule.restless.includes(i));
    run(0.1);
    check(`${tag} ...its earth heaves first: her client is told which grave, and nothing has come up yet`, A.graves.filter((g) => g === i).length === 1 && living().length === 0, `events ${A.graves}`);
    let z = null;
    run(3, () => (z = living().find((q) => q.riseT > 0 && Math.hypot(q.x - gr.x, q.z - gr.z) < 0.5)));
    const warned = (game.tick - stirAt) / SERVER_TICK_RATE;
    const h = z ? z.def.height : 0;
    check(`${tag} ...and ${CEMETERY.STIR} s later a walker starts up out of it, all of it still under the grass`, !!z && z.ztype === ZTYPE.WALKER && !z.horde && Math.abs(warned - CEMETERY.STIR) < 0.25 && Math.hypot(z.x - gr.x, z.z - gr.z) < 0.01 && z.riseY - z.y > h * 0.9 && z.anim === ZANIM.RISE, z ? `after ${warned.toFixed(2)} s, feet ${(z.riseY - z.y).toFixed(2)} m down` : 'nothing came');
    if (z) {
      run(0.1);
      const seen = A.store.ents.get(z.id);
      check(`${tag} ...her client sees it climbing, its feet under the ground`, !!seen && seen.q[4] === ZANIM.RISE && dqpos(seen.q[1]) < gr.y - h * 0.5, seen ? `anim ${seen.q[4]}, y ${dqpos(seen.q[1]).toFixed(2)} (ground ${gr.y.toFixed(2)})` : 'not replicated');
      // the climb: it only comes up, where it is, with no eyes for anybody
      let steady = true;
      let last = z.y;
      const eye = [p.state.x, p.state.y + EYE_HEIGHT, p.state.z];
      const shoot = (ty) => {
        const hp = z.hp;
        p.renderTick = game.tick & 0xffff;
        p.renderFrac = 0;
        game.combat.fire(p, { weapon: ITEM.PISTOL, x: eye[0], y: eye[1], z: eye[2], yaw: Math.atan2(-(z.x - eye[0]), -(z.z - eye[2])), pitch: Math.atan2(ty - eye[1], Math.hypot(z.x - eye[0], z.z - eye[2])), recoilPitch: 0, spread: 0, seed: 1 });
        return hp - z.hp;
      };
      let head = -1;
      let shin = -1;
      run(CEMETERY.RISE + 1, () => {
        if (!(z.riseT > 0)) return true;
        steady = steady && z.y >= last - 1e-9 && Math.hypot(z.x - gr.x, z.z - gr.z) < 0.01 && z.anim === ZANIM.RISE && (!z.target || head >= 0) && z.pendingHit <= 0;
        last = z.y;
        // half out (its head is clear of the grass, its legs are not): a round at its shins, then one at its head
        if (head < 0 && z.y + z.def.headY - z.def.headR > gr.y + 0.15 && z.y + h * 0.3 < gr.y - 0.2) {
          shin = shoot(z.y + h * 0.15);
          head = shoot(z.y + z.def.headY);
        }
        return false;
      });
      const took = (game.tick - stirAt) / SERVER_TICK_RATE;
      check(`${tag} ...it does nothing but climb, straight up, for ${CEMETERY.RISE} s`, steady && z.riseT === 0 && Math.abs(z.y - z.riseY) < 0.05, `y ${z.y.toFixed(2)} of ${z.riseY.toFixed(2)}`);
      check(`${tag} ...so from the first heave to a zombie on its feet is ${CEMETERY.STIR + CEMETERY.RISE} s`, took >= CEMETERY.STIR + CEMETERY.RISE - 0.2 && took < CEMETERY.STIR + CEMETERY.RISE + 0.5, `${took.toFixed(2)} s`);
      check(`${tag} ...a head above the grass is a head: a pistol round in it counts, one at the legs still under the ground does not`, head >= 30 * 3 - 1 && shin === 0, `head ${head}, shins ${shin}`);
      const t = run(3, () => z.target === A.id);
      check(`${tag} ...and once out it is a walker like any other: it comes for her`, t >= 0);
      const kills = p.zkills;
      game.combat.damageZombie(z, 9999, p, { weapon: ITEM.PISTOL });
      check(`${tag} ...and killing it is a kill like any other`, z.dead && p.zkills === kills + 1);
      run(2);
    }
    // once: she walks off and comes back
    A.put(...far);
    run(1);
    A.put(...at);
    run(CEMETERY.STIR + 1);
    check(`${tag} a grave that has given up its dead has no more to give that day`, A.graves.filter((g) => g === i).length === 1 && !living().some((q) => Math.hypot(q.x - gr.x, q.z - gr.z) < 1));
    A.put(...far);
    clear();
  }

  // ---- a riser is not stopped by the railings: from every third grave to a survivor at the chapel's door
  {
    B.put(wx(0, -8), wz(0, -8));
    const zs = cem.graves.filter((_, i) => i % 3 === 0).map((gr) => {
      const z = game.zm.spawn(ZTYPE.RUNNER, gr.x, gr.z);
      z.aggroId = B.id;
      z.aggroT = 600;
      return { z, best: Infinity };
    });
    run(40, () => {
      for (const o of zs) o.best = Math.min(o.best, Math.hypot(o.z.x - B.p().state.x, o.z.z - B.p().state.z));
      return zs.every((o) => o.best < 4);
    });
    const lost = zs.filter((o) => o.best >= 4);
    check(`${tag} the dead of every third grave find their way out of the cemetery to a survivor at the chapel's door`, lost.length === 0, `${zs.length - lost.length} of ${zs.length} got there${lost.length ? `; stuck at ${lost.map((o) => local(o.z.x, o.z.z).map((v) => v.toFixed(1)).join(',')).join(' ')}` : ''}`);
    B.put(...far);
    clear();
  }

  // ---- by night: what a wave gives to the graves (the handler itself: no clock, no spawns)
  {
    const S = ZTYPE.SPITTER;
    const W = ZTYPE.WALKER;
    const R = ZTYPE.RUNNER;
    const mix = () => [W, W, R, S, W, R, W, ZTYPE.BOOMER, W, R, W, ZTYPE.DOG, ZTYPE.DOG, W, R, W, ZTYPE.SHADE, W, R, W];
    const count = (q, t) => q.filter((v) => v === t).length;
    game.waves = [];
    const off = { queue: mix() };
    const n0 = farEnough ? rule.wave(off) : 0;
    check(`${tag} a wave that starts with nobody near the cemetery keeps all of its own`, n0 === 0 && off.queue.length === 20 && rule.pending.length === 0 && game.waves.length === 0, farEnough ? '' : '(the breakdown is too near the chapel on this map: not checked)');
    A.put(wx(0, 6), wz(0, 6)); // in the chapel
    run(0.1);
    const on = { queue: mix() };
    const rank = count(on.queue, W) + count(on.queue, R);
    const n = rule.wave(on);
    const share = game.waves[0];
    check(`${tag} with a survivor in the chapel, ${CEMETERY.SHARE * 100}% of its walkers and runners go to the graves`, n === Math.round(rank * CEMETERY.SHARE) && count(on.queue, W) + count(on.queue, R) === rank - n && rule.pending.length === n, `${n} of ${rank}`);
    check(`${tag} ...only walkers and runners: the specials still come from the treeline`, [S, ZTYPE.BOOMER, ZTYPE.DOG, ZTYPE.SHADE].every((t) => count(on.queue, t) === count(mix(), t)) && rule.pending.every((q) => q.type === W || q.type === R));
    check(`${tag} ...and the horde is the same size: they are counted until they are up`, !!share && share.queue.length === n && on.queue.length + share.queue.length === 20);
    check(`${tag} ...they come up over ${CEMETERY.SPREAD} s, not all at once`, rule.pending.every((q) => q.t >= 0 && q.t <= CEMETERY.SPREAD) && new Set(rule.pending.map((q) => q.t)).size === n);
    run(0.1);
    check(`${tag} ...and the survivor near it is told, once a night`, A.notes.filter((m) => m === NOTIFY.GRAVES).length === 1 && !B.notes.includes(NOTIFY.GRAVES));
    rule.wave({ queue: mix() });
    run(0.1);
    check(`${tag} ...not again for the next wave`, A.notes.filter((m) => m === NOTIFY.GRAVES).length === 1);
    rule.pending.length = 0;
    rule.share = null;
    rule.woke = false;
    game.waves = [];
    A.notes.length = 0;
  }

  // ---- a scripted night: a ring of walls round the chapel, the survivors inside it
  {
    const b = B.p();
    b.state.slot = SLOT_BUILD;
    const built = [];
    const wall = (lx, lz, along) => {
      game.giveItem(b, ITEM.WOOD, 5);
      game.giveItem(b, ITEM.NAILS, 4);
      // (the builder stands two metres inside the piece)
      B.put(wx(lx * 0.9, lz * 0.9 + 0.5), wz(lx * 0.9, lz * 0.9 + 0.5));
      b.actionT = -1;
      const n = game.structures.length;
      const yaw = zn.ry + (along === 'x' ? 0 : Math.PI / 2);
      game.build(b, STRUCT.WALL, wx(lx, lz), wz(lx, lz), Math.round((((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 256) & 255);
      if (game.structures.length === n) return false;
      built.push(game.structures[n]);
      return true;
    };
    // the back of the ring runs between the shed and the cemetery's railings; the other three sides are tried a
    // little further out if something (a tree) stands where a wall has to go
    const ZB = 20.85;
    let ring = null;
    for (const [xa, za] of [[-15.5, -9.5], [-17.5, -12], [-14, -8], [-19, -14]]) {
      const nx = Math.ceil((16.5 - xa) / 3);
      const nz = Math.ceil((ZB - za) / 3);
      const xb = xa + nx * 3;
      const z0 = ZB - nz * 3;
      let gaps = 0;
      for (let i = 0; i < nx; i++) gaps += !wall(xa + i * 3 + 1.5, z0, 'x') + !wall(xa + i * 3 + 1.5, ZB, 'x');
      for (let i = 0; i < nz; i++) gaps += !wall(xa - 0.2, z0 + i * 3 + 1.5, 'z') + !wall(xb + 0.2, z0 + i * 3 + 1.5, 'z');
      if (!gaps) {
        ring = { xa, xb, za: z0, zb: ZB, walls: built.length };
        break;
      }
      for (const e of built.splice(0)) game.destroyStructure(e, false);
    }
    if (check(`${tag} a ring of walls can be built round the chapel`, !!ring, ring ? `${ring.walls} walls, ${(ring.xb - ring.xa).toFixed(0)} x ${(ring.zb - ring.za).toFixed(0)} m` : 'something stood in the way of every ring tried')) {
      const inRing = (x, z) => {
        const [lx, lz] = local(x, z);
        return lx > ring.xa && lx < ring.xb && lz > ring.za && lz < ring.zb;
      };
      const whole = () => built.every((e) => !e.removed);
      const inside = cem.graves.filter((gr) => inRing(gr.x, gr.z)).length;
      check(`${tag} ...with graves of the churchyard inside it, and the cemetery outside`, inside >= 3 && inside < cem.graves.length / 2, `${inside} of ${cem.graves.length} graves inside`);
      // the ring holds: the dead outside it have to break in
      A.put(wx(0, 6), wz(0, 6)); // in the chapel
      B.put(wx(0, -6), wz(0, -6)); // at its door
      run(0.5);
      const out = [[0, ring.za - 8], [ring.xa - 8, 6], [ring.xb + 8, 6]].map(([lx, lz]) => {
        const z = game.zm.spawn(ZTYPE.RUNNER, wx(lx, lz), wz(lx, lz));
        z.aggroId = B.id;
        z.aggroT = 600;
        return z;
      });
      run(20);
      check(`${tag} ...it keeps out the dead that come from outside: they have to break it`, out.every((z) => !inRing(z.x, z.z)) && whole(), `${out.filter((z) => inRing(z.x, z.z)).length} got in`);
      clear();
      // (the walls are made to last the night: the point is who gets to the survivors without breaking one)
      for (const e of built) e.hp = e.maxHp = 1e7;
      // the other two inside the ring as well, out in the yard either side of the chapel
      others[0].put(wx(ring.xb - 2, 6), wz(ring.xb - 2, 6));
      others[1].put(wx(ring.xa + 3, 6), wz(ring.xa + 3, 6));

      // nightfall
      game.timeLeft = 0.01;
      run(0.2);
      const planned = game.waves.reduce((k, wv) => k + wv.queue.length, 0);
      const rank = game.waves.reduce((k, wv) => k + wv.queue.filter((t) => t === ZTYPE.WALKER || t === ZTYPE.RUNNER).length, 0);
      check(`${tag} night ${game.day} falls`, game.phase === PHASE.NIGHT && planned >= 30 && rank === planned, `a horde of ${planned}`);
      // (the night's boss is not of the waves: every night has one, The Brute on the first)
      const left = () => game.zombies.filter((z) => z.horde && !z.dead && !z.boss).length + game.waves.reduce((k, wv) => k + wv.queue.length, 0);
      const risers = new Map(); // zombie -> { inside, born (tick it started up), up (tick it was out), near (how close it got to a survivor while the ring was whole) }
      let lo = Infinity;
      let hi = 0;
      let closest = Infinity; // how close to a survivor one of them came up (never under their feet)
      let waves = 0;
      const humans = [A, B, ...others].map((c) => c.p());
      const night = run(NIGHT_LENGTH - 6, () => {
        if (game.phase !== PHASE.NIGHT) return true;
        waves = Math.max(waves, game.wave);
        const n = left();
        lo = Math.min(lo, n);
        hi = Math.max(hi, n);
        for (const z of game.zombies) {
          if (z.riseT === undefined || z.dead) continue;
          let r = risers.get(z);
          if (!r) {
            risers.set(z, (r = { inside: inRing(z.x, z.z), born: game.tick, up: 0, near: Infinity, type: z.ztype }));            for (const h of humans) closest = Math.min(closest, Math.hypot(h.state.x - z.x, h.state.z - z.z));
          }
          if (!r.up && z.riseT === 0) r.up = game.tick;
          if (whole()) for (const h of humans) r.near = Math.min(r.near, Math.hypot(h.state.x - z.x, h.state.z - z.z));
        }
        return false;
      });
      const all = [...risers.values()];
      const inner = all.filter((r) => r.inside);
      check(`${tag} the night runs its three waves`, night < 0 && waves === 3);
      // (a share of each of three waves, each rounded to a whole zombie)
      check(`${tag} the dead come up out of the graves, wave after wave: about ${CEMETERY.SHARE * 100}% of the horde`, Math.abs(all.length - rank * CEMETERY.SHARE) <= 1.5 && all.every((r) => r.type === ZTYPE.WALKER || r.type === ZTYPE.RUNNER) && [...risers.keys()].every((z) => z.horde), `${all.length} of ${rank}`);
      check(`${tag} ...some of them inside the ring of walls`, inner.length >= 2, `${inner.length} inside, ${all.length - inner.length} in the cemetery behind it`);
      const got = inner.filter((r) => r.near < 2.4);
      check(`${tag} ...and those reach the survivors with every wall still standing`, got.length >= Math.max(2, inner.length - 1), `${got.length} of ${inner.length} got within reach${inner.length ? `, the others to ${inner.filter((r) => r.near >= 2.4).map((r) => r.near.toFixed(1)).join(', ')} m` : ''}`);
      check(`${tag} ...never coming up at a survivor's feet`, closest >= CEMETERY.KEEP_OFF - 0.01, `the nearest came up ${closest.toFixed(1)} m off`);
      check(`${tag} the horde was no bigger for it: ${planned} planned, and ${planned} on the count all night`, lo === planned && hi === planned, `between ${lo} and ${hi}`);
      const hordeEver = game.zombies.filter((z) => z.horde && !z.boss).length;
      check(`${tag} ...and ${planned} came, the graves' share among them`, hordeEver === planned, `${hordeEver} of the horde on the field, ${all.length} of them out of graves`);

      // sunrise
      run(8, () => game.phase === PHASE.DAY);
      check(`${tag} at sunrise other graves are restless, and nothing is left waiting under the ground`, game.phase === PHASE.DAY && rule.restless.length === CEMETERY.RESTLESS && rule.pending.every((q) => q.stirred) && rule.share === null, `${rule.restless}`);
      run(12);
      check(`${tag} ...and what came up in the night burns with the rest of the horde`, [...risers.keys()].every((z) => z.dead));
    }
  }
}

// ---------------------------------------------------------------- the climb itself
check('a climb starts a body\'s height down and ends on the grass, never sinking back', Math.abs(riseDepth(0) - 1) < 1e-9 && Math.abs(riseDepth(1)) < 1e-9 && Array.from({ length: 50 }, (_, i) => riseDepth(i / 50) - riseDepth((i + 1) / 50)).every((d) => d >= -1e-9));

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
