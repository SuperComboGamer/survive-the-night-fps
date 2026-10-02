// Mine test: the workings under Blackrock Mine (shared/mine.js), as the world and a survivor meet them.
// The valley is a heightfield and the mine is a second level under it, so what can go wrong is one level being
// taken for the other: feet in a drift put on the hillside above it, a ray let through the rock, a roof that comes
// out of the ground. For a number of valleys this checks that
//   - the drift is cut (nearly every map), joins the mine yard to another place, and is nowhere too steep
//   - there is ground over every roof and none of it under water
//   - the floor a body stands on and the solid a ray stops at agree with the drift, from inside and from above
//   - a survivor walks in at the adit and out at the far portal by the real player simulation, cannot walk into
//     the rock, and anyone crossing the ground above stays up there
// and, with a game running on one of them, that the dead live down there and find their way in and out.
// usage: node scripts/test-mine.js [seed ...]
import { createWorld } from '../shared/world.js';
import { MINE_R, MINE_H, MINE_PAD, PORTAL } from '../shared/mine.js';
import { ZONE, ZONE_NAMES } from '../shared/defs.js';
import { groundAt, resolveBody, raycastWorld, canReach } from '../shared/collision.js';
import { simulatePlayer, createPlayerState } from '../shared/playersim.js';
import { BTN, CMD_RATE, PLAYER_RADIUS, PLAYER_HEIGHT, WATER_LEVEL, PHASE, SERVER_TICK_RATE, EYE_HEIGHT, SLOT_BUILD } from '../shared/constants.js';
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { ZTYPE, ITEM, STRUCT, CONT, CONT_TABLES, WEAPONS, AMMO_ITEMS } from '../shared/defs.js';
import { countItem } from '../server/inventory.js';

const SEEDS = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const fails = [];
// (a pass is only printed with VERBOSE=1: there are a few dozen checks to a valley)
const check = (name, ok, info = '') => {
  if (!ok) fails.push(name);
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  return ok;
};
const _ray = { t: -1, col: null, terrain: false };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz); // (yaw 0 faces -Z)

// walks a survivor along a line of points by the real simulation; -> { ok, s, worst: how far their feet were from
// the floor of the drift under them, lost: where they stopped }
function walk(world, pts, floorOf, secs) {
  const s = createPlayerState();
  s.x = pts[0][0];
  s.z = pts[0][1];
  s.y = groundAt(world, s.x, s.z, floorOf ? floorOf(s.x, s.z) + 0.2 : 200, PLAYER_RADIUS * 0.7);
  s.onGround = 1;
  let k = 1;
  let worst = 0;
  let seq = 0;
  for (let t = 0; t < secs * CMD_RATE && k < pts.length; t++) {
    const dx = pts[k][0] - s.x;
    const dz = pts[k][1] - s.z;
    if (Math.hypot(dx, dz) < 0.8) {
      k++;
      continue;
    }
    simulatePlayer(s, { seq: ++seq, buttons: BTN.FWD | BTN.SPRINT, yaw: yawTo(dx, dz), pitch: 0, slot: 255 }, world, null);
    if (floorOf) worst = Math.max(worst, Math.abs(s.y - floorOf(s.x, s.z)));
  }
  return { ok: k >= pts.length, s, worst, lost: k };
}

let cut = 0;
const joined = {};
for (const seed of SEEDS) {
  const world = createWorld(seed);
  const mine = world.mine;
  const tag = `[${seed}]`;
  if (!mine) {
    console.log(`${tag} no drift could be cut${world.zoneById[ZONE.MINE] ? '' : ' (the valley has no mine)'}`);
    continue;
  }
  cut++;
  const [A, B] = mine.portals;
  const m = mine.main;
  joined[B.zone] = (joined[B.zone] || 0) + 1;
  console.log(`${tag} ${m.n - 1} m of drift from the mine to ${ZONE_NAMES[B.zone]}, ${mine.galleries.length} galleries, floor ${Math.min(...m.y).toFixed(1)} .. ${Math.max(...m.y).toFixed(1)} m`);

  // ---- the plan
  check(`${tag} the adit is in the mine yard and the far portal at the edge of another place`, A.zone === ZONE.MINE && B.zone !== ZONE.MINE && world.zoneAt(A.x, A.z) === ZONE.MINE && world.zoneAt(B.x - B.dx * 4, B.z - B.dz * 4) === B.zone);
  let steep = 0;
  for (const l of [m, ...mine.galleries]) for (let i = 1; i < l.n; i++) steep = Math.max(steep, Math.abs(l.y[i] - l.y[i - 1]) / Math.hypot(l.x[i] - l.x[i - 1], l.z[i] - l.z[i - 1]));
  check(`${tag} no drift is steeper than a decline`, steep < 0.43, `grade ${steep.toFixed(3)}`);
  check(`${tag} the drift goes down: its floor is well under both portals`, Math.min(...m.y) < Math.min(A.y, B.y) - 5, `${Math.min(...m.y).toFixed(1)} under ${A.y.toFixed(1)} / ${B.y.toFixed(1)}`);

  // ---- ground over every roof, and none of it under water
  let thin = Infinity;
  let wet = 0;
  const roofed = (x, z, y, r) => {
    for (let a = 0; a < 8; a++) {
      for (const d of [0, r * 0.5, r]) {
        const px = x + Math.sin(a * 0.785) * d;
        const pz = z + Math.cos(a * 0.785) * d;
        thin = Math.min(thin, world.heightAt(px, pz) - (y + MINE_H));
        if (world.heightAt(px, pz) < WATER_LEVEL + 0.4) wet++;
      }
    }
  };
  for (let i = PORTAL.LEN; i < m.n - PORTAL.LEN; i++) roofed(m.x[i], m.z[i], m.y[i], MINE_R);
  for (const g of mine.galleries) for (let i = 0; i < g.n; i++) roofed(g.x[i], g.z[i], g.y[i], MINE_R);
  for (const rm of mine.rooms) roofed(rm.x, rm.z, rm.y, rm.r);
  check(`${tag} there is ground over every roof`, thin > 0.8, `thinnest ${thin.toFixed(2)} m`);
  check(`${tag} no drift runs under water`, wet === 0, `${wet} points`);

  // ---- the two levels: floors
  let bad = 0;
  let info = '';
  for (let i = 0; i < m.n; i++) {
    const x = m.x[i];
    const z = m.z[i];
    const down = groundAt(world, x, z, m.y[i] + 0.1, 0.1);
    if (Math.abs(down - m.y[i]) > 0.12) {
      bad++;
      info ||= `at ${i}: feet in the drift stand at ${down.toFixed(2)}, its floor is ${m.y[i].toFixed(2)}`;
    }
    if (i < PORTAL.LEN || i > m.n - 1 - PORTAL.LEN) continue; // (inside a portal there is no ground over the drift)
    const up = world.floorAt(x, z, world.heightAt(x, z) + 0.05);
    if (up !== world.heightAt(x, z) || mine.under(x, world.heightAt(x, z), z)) {
      bad++;
      info ||= `at ${i}: feet on the ground over the drift are put at ${up.toFixed(2)}`;
    }
  }
  check(`${tag} feet in the drift are on its floor, feet over it on the ground`, bad === 0, info);
  for (const p of mine.portals) {
    const out = world.floorAt(p.x - p.dx * 0.3, p.z - p.dz * 0.3, p.y + 0.1);
    const inn = world.floorAt(p.x + p.dx * 0.3, p.z + p.dz * 0.3, p.y + 0.1);
    check(`${tag} the floor runs level through the mouth of the ${p === A ? 'adit' : 'far portal'}`, Math.abs(out - p.y) < 0.06 && Math.abs(inn - p.y) < 0.2, `${out.toFixed(2)} outside, ${inn.toFixed(2)} inside, mouth at ${p.y.toFixed(2)}`);
  }

  // ---- the two levels: rays
  bad = 0;
  info = '';
  for (let i = PORTAL.LEN + 2; i < m.n - PORTAL.LEN - 5; i += 3) {
    const x = m.x[i];
    const y = m.y[i] + 1.4;
    const z = m.z[i];
    // on down the drift: nothing in the way but what stands in the junction
    const k = i + 3;
    let dx = m.x[k] - x;
    let dy = m.y[k] - m.y[i];
    let dz = m.z[k] - z;
    const l = Math.hypot(dx, dy, dz);
    raycastWorld(world, x, y, z, dx / l, dy / l, dz / l, l, _ray);
    if (_ray.t >= 0 && !(_ray.col && Math.hypot(x - mine.rooms[0].x, z - mine.rooms[0].z) < mine.rooms[0].r + 4)) {
      bad++;
      info ||= `at ${i}: a ray down the drift stops after ${_ray.t.toFixed(2)} m`;
    }
    // up: the roof
    raycastWorld(world, x, y, z, 0, 1, 0, 30, _ray);
    if (!(_ray.t > MINE_H - 1.4 - 0.3 && _ray.t < MINE_H - 1.4 + 0.3) && !mine.rooms.some((rm) => Math.hypot(x - rm.x, z - rm.z) < rm.r + 1)) {
      bad++;
      info ||= `at ${i}: the roof is ${_ray.t.toFixed(2)} m over a point 1.4 m up`;
    }
    // sideways: the rock (the timber sets have no colliders), except where a gallery leaves
    const tl = Math.hypot(m.x[i + 1] - m.x[i - 1], m.z[i + 1] - m.z[i - 1]);
    raycastWorld(world, x, y, z, -(m.z[i + 1] - m.z[i - 1]) / tl, 0, (m.x[i + 1] - m.x[i - 1]) / tl, 30, _ray);
    // (the inside of a sharp bend is cut wider)
    if (!(_ray.t > MINE_R - 0.4 && _ray.t < 8) && !mine.galleries.some((g) => Math.hypot(x - g.x[0], z - g.z[0]) < 9)) {
      bad++;
      info ||= `at ${i}: the wall is ${_ray.t.toFixed(2)} m away`;
    }
    // from over the ground above, straight down: the ground, not the drift (the terrain alone: a tree or a house
    // may stand there)
    const t = world.rayTerrain(x, world.heightAt(x, z) + 1.5, z, 0, -1, 0, 30);
    if (!(t > 1.2 && t < 1.8)) {
      bad++;
      info ||= `at ${i}: a ray down from 1.5 m over the ground runs ${t.toFixed(2)} m`;
    }
  }
  check(`${tag} rays stop at the rock, the roof and the ground above, and run free down the drift`, bad === 0, info);

  // ---- a survivor: in at the adit, out at the far portal
  const pts = [[A.x - A.dx * 6, A.z - A.dz * 6]];
  for (let i = 0; i < m.n; i += 2) pts.push([m.x[i], m.z[i]]);
  pts.push([B.x, B.z], [B.x - B.dx * 6, B.z - B.dz * 6]);
  // (the tub in the junction stands on the rails: go round it)
  const J = mine.rooms[0];
  const route = pts.filter(([x, z]) => Math.hypot(x - J.x, z - J.z) > J.r - 0.5);
  {
    const a = Math.max(0, mine.jx - 1);
    const b = Math.min(m.n - 1, mine.jx + 1);
    const tl = Math.hypot(m.x[b] - m.x[a], m.z[b] - m.z[a]);
    const at = route.findIndex(([x, z], k) => k > 0 && Math.hypot(x - m.x[m.n - 1], z - m.z[m.n - 1]) < Math.hypot(J.x - m.x[m.n - 1], J.z - m.z[m.n - 1]));
    route.splice(at, 0, [J.x + ((m.z[b] - m.z[a]) / tl) * (J.r - 2), J.z - ((m.x[b] - m.x[a]) / tl) * (J.r - 2)]);
  }
  const inDrift = (x, z) => mine.sdf(x, z) < 0 && !mine.outside(x, z, mine.floorOf(x, z) + 0.5);
  const thru = walk(world, route, (x, z) => (inDrift(x, z) ? mine.floorOf(x, z) : world.heightAt(x, z)), 120);
  check(`${tag} a survivor walks in at the adit and out at the far portal`, thru.ok, `stopped at point ${thru.lost} of ${route.length}, at ${thru.s.x.toFixed(1)}, ${thru.s.y.toFixed(1)}, ${thru.s.z.toFixed(1)}`);
  check(`${tag} ...on the floor of the drift all the way`, thru.worst < 0.5, `feet ${thru.worst.toFixed(2)} m off it`);
  check(`${tag} ...and comes out onto the ground`, !thru.ok || Math.abs(thru.s.y - world.heightAt(thru.s.x, thru.s.z)) < 0.05);

  // ---- ...cannot walk into the rock
  bad = 0;
  info = '';
  for (let i = PORTAL.LEN + 3; i < m.n - PORTAL.LEN - 3; i += 7) {
    if (mine.rooms.some((rm) => Math.hypot(m.x[i] - rm.x, m.z[i] - rm.z) < rm.r + 3)) continue;
    const tl = Math.hypot(m.x[i + 1] - m.x[i - 1], m.z[i + 1] - m.z[i - 1]);
    const nx = -(m.z[i + 1] - m.z[i - 1]) / tl;
    const nz = (m.x[i + 1] - m.x[i - 1]) / tl;
    for (const side of [1, -1]) {
      const s = createPlayerState();
      s.x = m.x[i];
      s.z = m.z[i];
      s.y = m.y[i];
      s.onGround = 1;
      for (let t = 0; t < CMD_RATE * 2; t++) simulatePlayer(s, { seq: t + 1, buttons: BTN.FWD | BTN.SPRINT | (t === 40 ? BTN.JUMP : 0), yaw: yawTo(nx * side, nz * side), pitch: 0, slot: 255 }, world, null);
      const d = mine.sdf(s.x, s.z);
      if (d > -(PLAYER_RADIUS + MINE_PAD) + 0.03 || Math.abs(s.y - mine.floorOf(s.x, s.z)) > 0.3) {
        bad++;
        info ||= `at ${i}: ended ${(-d).toFixed(2)} m from the rock, feet at ${s.y.toFixed(2)} over a floor at ${mine.floorOf(s.x, s.z).toFixed(2)}`;
      }
    }
  }
  check(`${tag} a survivor running and jumping at the wall of the drift stays in it`, bad === 0, info);

  // ---- ...and stays on the ground when crossing over the drift
  bad = 0;
  info = '';
  for (let i = PORTAL.LEN + 6; i < m.n - PORTAL.LEN - 6; i += 9) {
    const tl = Math.hypot(m.x[i + 1] - m.x[i - 1], m.z[i + 1] - m.z[i - 1]);
    const nx = -(m.z[i + 1] - m.z[i - 1]) / tl;
    const nz = (m.x[i + 1] - m.x[i - 1]) / tl;
    const s = createPlayerState();
    s.x = m.x[i] - nx * 7;
    s.z = m.z[i] - nz * 7;
    s.y = groundAt(world, s.x, s.z, 200, PLAYER_RADIUS * 0.7);
    s.onGround = 1;
    let low = 0;
    for (let t = 0; t < CMD_RATE * 3; t++) {
      simulatePlayer(s, { seq: t + 1, buttons: BTN.FWD | (t % 50 === 20 ? BTN.JUMP : 0), yaw: yawTo(nx, nz), pitch: 0, slot: 255 }, world, null);
      low = Math.max(low, world.heightAt(s.x, s.z) - s.y);
    }
    if (low > 0.05) {
      bad++;
      info ||= `at ${i}: sank ${low.toFixed(2)} m into the ground`;
    }
  }
  check(`${tag} a survivor crossing the ground over the drift stays on it`, bad === 0, info);

  // ---- what is down there can be got at
  const inMine = (e) => mine.under(e.x, e.y + 0.3, e.z) || mine.under(e.x, e.y - 0.3, e.z);
  const conts = world.containers.filter(inMine);
  const loot = world.lootSpawns.filter(inMine);
  check(`${tag} the rooms hold something worth the trip`, conts.length >= mine.rooms.length - 1 && loot.length >= 1, `${conts.length} containers, ${loot.length} loot points`);
  const boxes = world.containers.filter((c) => c.ctype === CONT.STRONGBOX);
  check(`${tag} the one strongbox of the valley is down there`, boxes.length === 1 && inMine(boxes[0]), `${boxes.length} on the map, ${boxes.filter(inMine).length} in the mine`);
  // ...by the server's rules: a place to stand in the drift within reach of it, with a clear line from the eye
  bad = 0;
  info = '';
  for (const [list, reach, lift, what] of [[conts, 2.8, 0, 'a container'], [loot, 3.6, 0.15, 'floor loot'], [world.partSpots.filter(inMine), 3.6, 0.15, 'a supply spot']]) {
    for (const o of list) {
      let ok = false;
      for (let dx = -reach; dx <= reach && !ok; dx += 0.4) {
        for (let dz = -reach; dz <= reach && !ok; dz += 0.4) {
          const x = o.x + dx;
          const z = o.z + dz;
          if (Math.hypot(dx, dz) > reach || mine.sdf(x, z) > -(PLAYER_RADIUS + MINE_PAD)) continue;
          const pos = { x, y: mine.floorOf(x, z), z };
          if (resolveBody(world, pos, PLAYER_RADIUS, PLAYER_HEIGHT) && Math.hypot(pos.x - o.x, pos.z - o.z) > reach) continue;
          const y = groundAt(world, pos.x, pos.z, pos.y + 0.1, PLAYER_RADIUS * 0.7);
          ok = canReach(world, pos.x, y + EYE_HEIGHT, pos.z, o.x, o.y + lift, o.z, y + EYE_HEIGHT);
        }
      }
      if (!ok) {
        bad++;
        info ||= `${what} at ${o.x.toFixed(1)}, ${o.y.toFixed(1)}, ${o.z.toFixed(1)}`;
      }
    }
  }
  check(`${tag} ...and every bit of it can be got at from the drift`, bad === 0, `${bad} cannot: ${info}`);
  bad = 0;
  for (const d of mine.dens) {
    const pos = { x: d.x, y: d.y, z: d.z };
    if (!mine.under(d.x, d.y + 0.1, d.z) || (resolveBody(world, pos, 0.45, 1.8, false) && Math.hypot(pos.x - d.x, pos.z - d.z) > 1.5)) bad++;
  }
  check(`${tag} every den is a place in the drift to stand`, bad === 0 && mine.dens.length >= 4, `${bad} of ${mine.dens.length} are not`);
}

check('nearly every valley has the workings', cut >= SEEDS.length - 1, `${cut} of ${SEEDS.length}`);

// ---------------------------------------------------------------- a game on the first of them
{
  const seed = SEEDS.find((sd) => createWorld(sd).mine);
  const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
  const tag = `[game ${seed}]`;
  const join = (name) => {
    const c = { id: 0 };
    c.session = game.onOpen({
      send(bytes) {
        const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
        if (r.u8() === S2C.WELCOME) c.id = r.u16();
      },
    });
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    game.onMessage(c.session, w.bytes().slice());
    c.p = () => game.players.get(c.id);
    c.put = (x, y, z) => {
      const s = c.p().state;
      [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.onGround] = [x, y, z, 0, 0, 0, 1];
    };
    return c;
  };
  const A1 = join('Ada');
  const run = (secs, until) => {
    for (let t = 0; t < secs * SERVER_TICK_RATE; t++) {
      game.update();
      if (until?.()) return t / SERVER_TICK_RATE;
    }
    return -1;
  };
  run(0.5);
  const world = game.world;
  const mine = world.mine;
  const mn = game.mineNav;
  const m = mine.main;
  const [A, B] = mine.portals;
  const under = (e) => mine.under(e.x, e.y + 0.3, e.z);
  const living = () => game.zombies.filter((z) => !z.dead);
  const clear = () => {
    for (const z of [...game.zombies]) if (!z.dead) game.combat.killZombie(z, null, {});
    run(2);
  };

  // ---- the dead live down there
  const dwellers = living().filter((z) => z.den);
  check(`${tag} the dead live down in the mine, one to a den`, dwellers.length >= mine.dens.length - 2 && dwellers.every(under), `${dwellers.length} of them for ${mine.dens.length} dens, ${dwellers.filter(under).length} down there`);
  check(`${tag} ...and none of them is on the surface grid's side of things`, dwellers.every((z) => Math.abs(z.y - mine.floorOf(z.x, z.z)) < 0.6));
  // left alone for a minute they are still down there
  A1.put(world.car.x, world.heightAt(world.car.x, world.car.z), world.car.z);
  run(60);
  const still = living().filter((z) => z.den);
  check(`${tag} left alone they keep to the workings`, still.length >= dwellers.length - 1 && still.every(under), `${still.filter((z) => !under(z)).length} of ${still.length} came up`);
  check(`${tag} ...on their feet in the drifts, not in the rock`, still.every((z) => mine.sdf(z.x, z.z) < -0.3 && Math.abs(z.y - mine.floorOf(z.x, z.z)) < 0.6));

  // ---- a survivor comes down: whatever is in the drift ahead comes for them
  {
    const i = Math.min(m.n - 12, mine.jx + 14);
    A1.put(m.x[i], m.y[i], m.z[i]);
    const t = run(45, () => living().some((z) => z.den && z.target === A1.id && Math.hypot(z.x - m.x[i], z.z - m.z[i]) < 2.2 && Math.abs(z.y - m.y[i]) < 1.5));
    check(`${tag} a survivor in the drift is found by the dead that live there`, t >= 0, t >= 0 ? `after ${t.toFixed(1)} s` : `nearest ${Math.min(...living().filter((z) => z.den).map((z) => Math.hypot(z.x - m.x[i], z.z - m.z[i]))).toFixed(1)} m off`);
  }

  // ---- from the surface down: a runner outside the adit, the survivor twenty metres down the decline
  clear();
  {
    const i = 22;
    A1.put(m.x[i], m.y[i], m.z[i]);
    const z = game.zm.spawn(ZTYPE.RUNNER, A.x - A.dx * 22 + A.dz * 6, A.z - A.dz * 22 - A.dx * 6);
    z.aggroId = A1.id;
    z.aggroT = 600;
    const t = run(40, () => under(z) && Math.hypot(z.x - m.x[i], z.z - m.z[i]) < 2.2);
    check(`${tag} a zombie on the surface comes in at the adit after a survivor down the drift`, t >= 0, t >= 0 ? `in ${t.toFixed(1)} s` : `it is at ${z.x.toFixed(1)}, ${z.y.toFixed(1)}, ${z.z.toFixed(1)} (${under(z) ? 'down there' : 'on the surface'}), ${Math.hypot(z.x - m.x[i], z.z - m.z[i]).toFixed(1)} m off`);
    // ...and from the far side of the valley floor above them it goes round by the nearer mouth, not to the spot above
    const j = m.n - 20;
    A1.put(m.x[j], m.y[j], m.z[j]);
    const z2 = game.zm.spawn(ZTYPE.RUNNER, B.x - B.dx * 20, B.z - B.dz * 20);
    z2.aggroId = A1.id;
    z2.aggroT = 600;
    const t2 = run(40, () => under(z2) && Math.hypot(z2.x - m.x[j], z2.z - m.z[j]) < 2.2);
    check(`${tag} ...and at the far portal after one at that end`, t2 >= 0, t2 >= 0 ? `in ${t2.toFixed(1)} s` : `it is at ${z2.x.toFixed(1)}, ${z2.y.toFixed(1)}, ${z2.z.toFixed(1)} (${under(z2) ? 'down there' : 'on the surface'})`);
  }

  // ---- from the mine up: one down the drift, the survivor out in front of the far portal
  clear();
  {
    const at = { x: B.x - B.dx * 14, z: B.z - B.dz * 14 };
    A1.put(at.x, world.heightAt(at.x, at.z), at.z);
    const i = m.n - 30;
    const z = game.zm.spawn(ZTYPE.RUNNER, m.x[i], m.z[i], { y: m.y[i] });
    check(`${tag} a zombie can be put down in the drift`, !!z && under(z));
    z.aggroId = A1.id;
    z.aggroT = 600;
    const t = run(40, () => !under(z) && Math.hypot(z.x - at.x, z.z - at.z) < 2.2);
    check(`${tag} a zombie down the drift comes up and out after a survivor outside`, t >= 0, t >= 0 ? `in ${t.toFixed(1)} s` : `it is at ${z.x.toFixed(1)}, ${z.y.toFixed(1)}, ${z.z.toFixed(1)} (${under(z) ? 'down there' : 'on the surface'})`);
  }

  // ---- the ground above is another place: a walker over the drift does not notice who is under it
  clear();
  {
    const i = mine.jx;
    A1.put(m.x[i], m.y[i], m.z[i]);
    const z = game.zm.spawn(ZTYPE.WALKER, m.x[i] + 3, m.z[i] + 3);
    run(6);
    check(`${tag} a zombie standing on the ground over a survivor in the mine does not come for them`, !!z && !z.target && !under(z), `target ${z?.target}`);
    // ...nor does a shot fired down there fetch it through the rock, when the mouths are further off than it carries
    const far = Math.min(mn.between(m.x[i], m.z[i], z.x, z.z).d);
    game.zm.noise(m.x[i], m.z[i], Math.min(60, far - 5), m.y[i]);
    check(`${tag} ...and a noise down there reaches it by the portals, not through the rock`, z.alertT <= 0, `the way round is ${far.toFixed(0)} m`);
    game.zm.noise(m.x[i], m.z[i], far + 20, m.y[i]);
    check(`${tag} ...one loud enough to carry that far does fetch it`, z.alertT > 0 && z.alertU);
  }

  // ---- sunrise: the horde down in the mine does not burn until it comes up
  clear();
  {
    const i = mine.jx;
    A1.put(world.car.x, world.heightAt(world.car.x, world.car.z), world.car.z);
    const down = game.zm.spawn(ZTYPE.WALKER, m.x[i], m.z[i], { y: m.y[i], horde: true });
    const up = game.zm.spawn(ZTYPE.WALKER, B.x - B.dx * 30, B.z - B.dz * 30, { horde: true });
    game.phase = PHASE.NIGHT;
    run(0.2);
    game.startDay();
    run(8);
    check(`${tag} at sunrise the horde on the surface burns, the horde down the mine does not`, up.dead && !down.dead && down.burning <= 0 && !down.onFire);
    check(`${tag} ...and the mine has its dead again`, living().filter((z) => z.den).length >= mine.dens.length - 2);
    down.x = B.x - B.dx * 8;
    down.z = B.z - B.dz * 8;
    down.y = world.heightAt(down.x, down.z);
    run(8);
    check(`${tag} ...until it comes up into the daylight`, down.dead);
  }

  // ---- things put down in the mine stay down there
  clear();
  {
    const i = Math.max(12, mine.jx - 16);
    A1.put(m.x[i], m.y[i], m.z[i]);
    const p = A1.p();
    let bad = 0;
    for (let k = 0; k < 40; k++) {
      const e = game.dropItem(ITEM.SCRAP, 1, m.x[i], m.y[i], m.z[i]);
      const it = game.items[game.items.length - 1];
      if (!it || !under(it) || mine.sdf(it.x, it.z) > -0.15 || Math.abs(it.y - mine.floorOf(it.x, it.z)) > 0.3) bad++;
    }
    check(`${tag} what is dropped in a drift lies on its floor`, bad === 0, `${bad} of 40 did not`);
    // a barricade across the drift
    p.inv[0] = { item: ITEM.WOOD, count: 20 };
    p.inv[1] = { item: ITEM.NAILS, count: 20 };
    p.state.slot = SLOT_BUILD;
    p.actionT = -1;
    const before = game.structures.length;
    game.build(p, STRUCT.BARRICADE, m.x[i + 3], m.z[i + 3], 0);
    const st = game.structures[game.structures.length - 1];
    check(`${tag} a barricade can be built across the drift, on its floor`, game.structures.length === before + 1 && Math.abs(st.y - m.y[i + 3]) < 0.3, game.structures.length === before + 1 ? `at ${st.y.toFixed(2)}, floor ${m.y[i + 3].toFixed(2)}` : 'refused');
    p.actionT = -1;
    game.build(p, STRUCT.BARRICADE, m.x[i] + 40, m.z[i] + 40, 0);
    check(`${tag} ...and nothing on the ground above from down there`, game.structures.length === before + 1);
  }

  // ---- the strongbox: a gun worth the trip, something to fire from it, two pipe bombs - once
  {
    const box = game.caches.find((c) => c.ctype === CONT.STRONGBOX);
    const p = A1.p();
    A1.put(box.x, box.y, box.z);
    p.inv.fill(null);
    p.state.weapons[0] = 0;
    game.searchCache(p, box);
    const gun = p.state.weapons[0];
    const w = WEAPONS[gun];
    const prize = CONT_TABLES.strongbox.some((row) => row[0] === gun);
    check(`${tag} the strongbox holds one of the rare guns, loaded`, prize && p.state.mags[0] === w?.mag, `weapon ${gun}, ${p.state.mags[0]} in it`);
    check(`${tag} ...two magazines more for it and two pipe bombs`, prize && countItem(p.inv, AMMO_ITEMS[w.ammo]) === w.mag * 2 && countItem(p.inv, ITEM.PIPEBOMB) === 2, prize ? `${countItem(p.inv, AMMO_ITEMS[w.ammo])} rounds, ${countItem(p.inv, ITEM.PIPEBOMB)} pipe bombs` : '');
    A1.put(world.car.x, world.heightAt(world.car.x, world.car.z), world.car.z);
    let refilled = 0;
    for (let day = 0; day < 12; day++) {
      game.phase = PHASE.NIGHT;
      game.startDay();
      if (box.state !== 1) refilled++;
    }
    check(`${tag} ...and it is not there again at sunrise`, box.state === 1 && refilled === 0, `refilled ${refilled} of 12 mornings`);
  }
}
console.log(`far portals: ${Object.entries(joined).map(([z, n]) => `${ZONE_NAMES[z]} x${n}`).join(', ')}`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
