// Ground transport (shared/vehicles.js, server/vehicles.js), against the real server in-process:
//  - the island has none, and nothing of it is changed by their being in the build; every mainland seed has its
//    broken vehicles standing clear of everything, the bridgehead's within a short walk, and the car the team came in
//  - seats for everybody within five minutes of coming off the bridge, for teams of 1, 2, 4, 8 and 16 on two dozen
//    seeds, by a team that plays sensibly (scripts/vehicle-seats.js)
//  - fixing (parts, the bridgehead's free fix), fuel (poured, burnt, run dry, siphoned), getting in and out, seats,
//    passengers who shoot and drivers who cannot
//  - the physics' bounds: never through anything solid, off the map, into deep water or through a doorway; slower
//    off the road; a hill costs speed
//  - the dead: struck at speed (at a cost), a Tank stops a car, a rider is thrown or pulled off, a car shields who is
//    in it until its glass is in; an engine is heard and a bicycle is not; a parked car is walked round
//  - damage, breakdown, the patch, the wreck; a downed, dead, dropped or departed driver; a save and restore mid-ride
//  - the crossing still ends the island, the island still has none after a new run, and the mainland has the team's car
//  - a driver on a laggy link: the client's prediction of every command is the server's result
// usage: node scripts/test-vehicles.js [seed] (VERBOSE=1: numbers; VEH_SEEDS=n: how many seeds the sweeps take)
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, VACT, SNAP, ENT, HOLD, VFLAG, PROTOCOL_VERSION, Writer, Reader, qpos } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE, SPRINT_SPEED, WATER_LEVEL, PHASE, CMD_DT } from '../shared/constants.js';
import { ITEM, ZTYPE, AMMO, NOTIFY } from '../shared/defs.js';
import { WORLD } from '../shared/acts.js';
import { VEH, VSTATE, VEHICLES, FIX, REPAIR, STARTERS, STARTER_REACH, stepVehicle, vehicleSpots, starterSpots, questCar, vehicleGrid, parkedCollider, siphonOf, seatAt, surfaceKind, SURF_KIND } from '../shared/vehicles.js';
import { readHeader, readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';
import { Connection } from '../client/net/connection.js';
import { Prediction } from '../client/game/prediction.js';
import { worldFor } from '../shared/worlds.js';
import { createWorld } from '../shared/world.js';
import { createPlayerState, copyPlayerState } from '../shared/playersim.js';
import { COL, groundAt, footprintContains, pushCircle } from '../shared/collision.js';
import { worldHash, envelope } from '../server/handoff.js';
import { client, mainlandGame, quiet, seatsFor } from './vehicle-seats.js';
import { clearance, flood, drive, walk } from './vehicle-routes.js';

const seed = +(process.argv[2] || 1337);
const SEEDS = +(process.env.VEH_SEEDS || 24);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? `: ${info}` : ''}`);
  if (!ok) fails.push(name);
};
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const SEC = SERVER_TICK_RATE;
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const yawAlong = (tx, tz) => Math.atan2(-tx, -tz);
const speedOf = (o) => Math.hypot(o.vx, o.vz);
// is the circle (x, z, r) of a body standing at height y inside anything solid of the world?
const _p = { x: 0, z: 0, nx: 0, nz: 0 };
function sunk(world, x, y, z, r, step, tall, selfId = 0) {
  const g = vehicleGrid(world);
  let worst = 0;
  for (const grid of [world.staticGrid, world.structGrid, g.parked, g.doors]) {
    for (const c of grid.query(x, z, r + 0.2, [])) {
      if (grid !== g.doors && c.flags & COL.NOBLOCK) continue;
      if (c.id && c.id === selfId) continue;
      if (c.y1 <= y + step || c.y0 >= y + tall) continue;
      if (pushCircle(c, x, z, r, _p)) worst = Math.max(worst, Math.hypot(_p.x - x, _p.z - z));
    }
  }
  return worst;
}
// how deep vehicle v's body is in anything solid (m)
function bodySunk(world, v, P = VEHICLES[v.vk]) {
  let worst = 0;
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  for (const [o, r] of P.circles) worst = Math.max(worst, sunk(world, v.x - fx * o, v.y, v.z - fz * o, r, P.step, P.h, v.id));
  return worst;
}
// An open, level stretch of the mainland to drive on: the runway of Calder Field, the longest run of it with nothing
// solid on or beside it. -> [x, z] of its end, from where 150 m and more lie clear ahead facing yaw 0 (towards -z);
// lane: -1 / 0 / 1 across it (3.5 m apart).
function openGround(world, lane = 0) {
  const r = world.runway;
  let best = null, run = 0, from = 0;
  for (let z = r.z1 - 8; z >= r.z0 + 8; z -= 4) {
    const clear = !world.staticGrid.query(r.x, z, 8, []).some((c) => !(c.flags & COL.NOBLOCK) && c.y1 > world.heightAt(c.x, c.z) + 0.3);
    if (clear) {
      if (!run) from = z;
      run += 4;
      if (!best || run > best[1]) best = [from, run];
    } else run = 0;
  }
  if (!best || best[1] < 150) throw new Error(`the runway has only ${best ? best[1] : 0} m clear`);
  return [r.x + lane * 3.5, best[0] - 6];
}
// a straight run of `len` metres over grass with nothing solid within 3 m of it and no great rise: [x, z, dx, dz]
function grassRun(world, len) {
  for (let x = -world.half + 80; x < world.half - 80; x += 14) {
    for (let z = -world.half + 80; z < world.half - 80; z += 14) {
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        let ok = true;
        const h0 = world.heightAt(x, z);
        for (let k = 0; ok && k <= len; k += 3) {
          const px = x + dx * k, pz = z + dz * k;
          const h = world.heightAt(px, pz);
          ok = h > WATER_LEVEL + 1 && Math.abs(h - h0) < 1.2 && surfaceKind(world, px, pz, h) === SURF_KIND.GRASS && !world.staticGrid.query(px, pz, 3, []).some((c) => !(c.flags & COL.NOBLOCK));
        }
        if (ok) return [x, z, dx, dz];
      }
    }
  }
  throw new Error('no run of open grass on this map');
}
const newV = (world, vk, x, z, yaw = 0, id = 0) => ({ vk, id, x, y: groundAt(world, x, z, 200, 0.25, false), z, vx: 0, vz: 0, yaw, steer: 0, fuel: VEHICLES[vk].tank || 1, run: true });
const give = (game, p, item, n) => game.giveItem(p, item, n);
const holdOn = (game, c, e, ticks = 8 * SEC, others = []) => {
  c.act(ACT.HOLD_BEGIN, e.id);
  for (let i = 0; i < ticks; i++) {
    c.input(0, c.p().state.yaw);
    for (const o of others) o.input(0, o.p().state.yaw);
    game.update();
    if (!c.p().hold && i > 2) break;
  }
};
const beside = (game, p, e, side = -1, off = 0.9) => {
  const s = p.state;
  const P = VEHICLES[e.vk];
  s.drive = s.driveK = s.pass = s.passN = 0;
  s.x = e.x + Math.cos(e.yaw) * side * (P.halfW + off);
  s.z = e.z - Math.sin(e.yaw) * side * (P.halfW + off);
  s.y = groundAt(game.world, s.x, s.z, e.y + 1, 0.3);
  s.vx = s.vy = s.vz = 0;
  s.onGround = 1;
  s.yaw = Math.atan2(-(e.x - s.x), -(e.z - s.z));
  game.fillHistory(p);
};

// ================================================================ the worlds
{
  // ---- the island: none, and its world is what it was
  const isl = createWorld(seed);
  const h0 = worldHash(isl);
  const n0 = isl.staticGrid.count;
  const spots = vehicleSpots(isl).length + starterSpots(isl).length;
  vehicleGrid(isl);
  const q = questCar(isl);
  check('the island has no vehicles: no spots, no car of the team, and its world is untouched', spots === 0 && q === null && worldHash(isl) === h0 && isl.staticGrid.count === n0, `${spots} spots, fingerprint ${h0}`);
  // ---- the mainland, over a couple of dozen seeds
  const bad = [];
  let fewest = 99, far = 0, total = 0, kinds = [0, 0, 0, 0];
  const t0 = Date.now();
  for (let sd = 1; sd <= SEEDS; sd++) {
    const w = worldFor(sd, WORLD.MAINLAND);
    const hash = worldHash(w);
    const st = starterSpots(w);
    const rest = vehicleSpots(w);
    const car = questCar(w);
    if (!car || car.cols < 1) bad.push(`seed ${sd}: no car of the team at the bridgehead`);
    if (worldHash(w) === hash) bad.push(`seed ${sd}: the parked car's box is still in the world`);
    fewest = Math.min(fewest, st.length);
    if (st.length < STARTERS.length) bad.push(`seed ${sd}: ${st.length} of ${STARTERS.length} at the bridgehead`);
    total += rest.length;
    for (const s of [...st, ...rest]) {
      kinds[s.kind]++;
      const P = VEHICLES[s.kind];
      if (s.starter) far = Math.max(far, Math.hypot(s.x - w.start.x, s.z - w.start.z));
      const v = { vk: s.kind, id: 0, x: s.x, y: groundAt(w, s.x, s.z, 200, 0.25, false), z: s.z, yaw: s.yaw };
      const deep = bodySunk(w, v);
      if (deep > 0.02) bad.push(`seed ${sd}: a ${P.name} ${f1(deep * 100)} cm into something at ${f1(s.x)}, ${f1(s.z)}`);
      if (w.heightAt(s.x, s.z) < WATER_LEVEL + 0.5) bad.push(`seed ${sd}: a ${P.name} in the water`);
      if (Math.abs(v.y - w.heightAt(s.x, s.z)) > 0.05) bad.push(`seed ${sd}: a ${P.name} on top of something`);
    }
    // (the same again from a fresh world: what a seed gives is what it gives)
    if (sd <= 3) {
      const w2 = worldFor(sd, WORLD.MAINLAND);
      const again = [...starterSpots(w2), ...vehicleSpots(w2)];
      if (JSON.stringify(again) !== JSON.stringify([...st, ...rest])) bad.push(`seed ${sd}: the spots differ between two builds of the world`);
    }
  }
  check(`on ${SEEDS} mainland seeds every vehicle stands clear of everything solid, dry, on the ground; the team's car is at the bridgehead`, bad.length === 0, bad.slice(0, 4).join('; ') || `${(total / SEEDS).toFixed(1)} broken ones a map (${kinds[VEH.MOPED]} mopeds, ${kinds[VEH.CAR]} cars, ${kinds[VEH.BIKE]} bicycles in all), ${Date.now() - t0} ms`);
  check(`...and all ${STARTERS.length} of the bridgehead's stand within ${STARTER_REACH} m of where the team is put down, whatever the seed`, fewest === STARTERS.length && far <= STARTER_REACH, `the fewest on a seed ${fewest}, the furthest ${f1(far)} m`);
}

// ================================================================ seats for everybody
{
  const sizes = [1, 2, 4, 8, 16];
  const rows = [];
  const t0 = Date.now();
  for (let sd = 1; sd <= SEEDS; sd++) rows.push(seatsFor(sd, sizes));
  let worstAll = 0, worstFirst = 0;
  const lines = [];
  for (const n of sizes) {
    const a = rows.map((r) => r[n].all), f = rows.map((r) => r[n].first);
    worstAll = Math.max(worstAll, ...a);
    worstFirst = Math.max(worstFirst, ...f);
    lines.push(`${n}: ${f1(med(f))} / ${f1(Math.max(...f))} s to the first, ${f1(med(a))} / ${f1(Math.max(...a))} s for all`);
  }
  check(`a team of 1, 2, 4, 8 or 16 has a seat for everybody within five minutes of the crossing, on ${SEEDS} seeds (median / worst)`, worstAll < 300 && worstFirst < 300, `${lines.join('; ')} (${Date.now() - t0} ms)`);
  if (process.env.VERBOSE) rows.forEach((r, i) => console.log(`  seed ${i + 1}: ` + sizes.map((n) => `${n}: ${f1(r[n].first)} / ${f1(r[n].all)}`).join('  ')));
}

// ================================================================ the physics' bounds (no server: the step itself)
{
  const w = worldFor(seed, WORLD.MAINLAND);
  vehicleGrid(w);
  questCar(w);
  // ---- random driving from a hundred spots: never into anything, never off the map, never into deep water
  let rs = 4242;
  const rnd = () => ((rs = (Math.imul(rs, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  let deepest = 0, once = 0, where = '', off = 0, wet = 0, fast = 0, steps = 0, crashes = 0, nan = 0;
  const spots = [...vehicleSpots(w), ...starterSpots(w)];
  for (let run = 0; run < 120; run++) {
    const vk = [VEH.CAR, VEH.MOPED, VEH.BIKE][run % 3];
    const P = VEHICLES[vk];
    const s = spots[run % spots.length];
    const v = newV(w, vk, s.x, s.z, rnd() * 6.28 - 3.14);
    // (a vehicle of another kind in this spot may be standing in something: start it clear)
    if (bodySunk(w, v) > 0.01) continue;
    let thr = 1, turn = 0, hb = false, was = 0;
    const ev = [];
    for (let i = 0; i < 25 * 60; i++) {
      if (i % 40 === 0) {
        thr = rnd() < 0.75 ? 1 : rnd() < 0.5 ? -1 : 0;
        turn = rnd() < 0.4 ? 0 : rnd() < 0.5 ? 1 : -1;
        hb = rnd() < 0.08;
      }
      ev.length = 0;
      stepVehicle(v, thr, turn, hb, false, w, CMD_DT, ev);
      steps++;
      crashes += ev.filter((e) => e.type === 'veh_crash').length;
      if (!(v.x === v.x && v.z === v.z && v.y === v.y && v.yaw === v.yaw && v.vx === v.vx)) nan++;
      // (for one step it may be in something low that it was riding over, as the ground falls away under it and that
      // becomes a thing in its way: the next step has it out. In anything for two steps running is what counts)
      const d = bodySunk(w, v);
      const held = Math.min(d, was);
      was = d;
      once = Math.max(once, d);
      if (held > deepest) {
        deepest = held;
        where = `a ${P.name} at ${f1(v.x)}, ${f1(v.z)}`;
      }
      if (Math.abs(v.x) > w.half - 4 || Math.abs(v.z) > w.half - 4) off++;
      if (v.y < WATER_LEVEL - P.wade - 0.05) wet++;
      if (speedOf(v) > (P.hardTop || P.top) * 1.25) fast++;
    }
  }
  check('driven at random from every spot it stands at, a vehicle is never inside anything solid, off the map or under water', deepest < 0.06 && once < 0.3 && off === 0 && wet === 0 && nan === 0 && fast === 0, `${steps} steps, ${crashes} crashes; deepest ${f1(deepest * 100)} cm for two steps running${where ? ` (${where})` : ''}, ${f1(once * 100)} cm for one, ${off} off the map, ${wet} too deep, ${fast} too fast`);
  // ---- the edge of the map: from the nearest clear, dry ground to each side of it, straight out
  {
    let maxOut = -1e9, tried = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let t = -w.half + 40; t < w.half - 40; t += 9) {
        const x = dx ? dx * (w.half - 16) : t, z = dz ? dz * (w.half - 16) : t;
        if (w.heightAt(x, z) < WATER_LEVEL + 0.8) continue;
        const v = newV(w, VEH.MOPED, x, z, yawAlong(dx, dz));
        if (bodySunk(w, v) > 0 || w.staticGrid.query(x + dx * 6, z + dz * 6, 7, []).some((c) => !(c.flags & COL.NOBLOCK))) continue;
        tried++;
        for (let i = 0; i < 8 * 60; i++) stepVehicle(v, 1, 0, false, false, w, CMD_DT, null);
        maxOut = Math.max(maxOut, Math.abs(dx ? v.x : v.z));
        break;
      }
    }
    check('it stops at the edge of the map', tried > 0 && maxOut <= w.half - 4.5 && maxOut > w.half - 9, `${tried} sides tried: as far out as ${f1(maxOut)} of ${w.half}`);
  }
  // ---- deep water: from the shore of the lake, straight in
  {
    let shore = null;
    for (let x = -w.half + 30; x < w.half - 30 && !shore; x += 6) {
      for (let z = -w.half + 30; z < w.half - 30 && !shore; z += 6) {
        if (w.heightAt(x, z) < WATER_LEVEL + 0.6 || w.heightAt(x, z) > WATER_LEVEL + 2) continue;
        for (let a = 0; a < 8 && !shore; a++) {
          const dx = Math.sin((a / 8) * 6.283), dz = Math.cos((a / 8) * 6.283);
          let ok = w.heightAt(x + dx * 14, z + dz * 14) < WATER_LEVEL - 1.2 && sunk(w, x, w.heightAt(x, z), z, 1.2, 0.3, 1.5) === 0;
          for (let k = 2; ok && k < 14; k += 2) ok = w.staticGrid.query(x + dx * k, z + dz * k, 2.5, []).length === 0;
          if (ok) shore = [x, z, dx, dz];
        }
      }
    }
    let deep = 0, dist = 0;
    for (const vk of [VEH.CAR, VEH.MOPED, VEH.BIKE]) {
      const v = newV(w, vk, shore[0], shore[1], yawAlong(shore[2], shore[3]));
      for (let i = 0; i < 12 * 60; i++) stepVehicle(v, 1, 0, false, false, w, CMD_DT, null);
      deep = Math.max(deep, WATER_LEVEL - v.y - VEHICLES[vk].wade);
      dist = Math.max(dist, Math.hypot(v.x - shore[0], v.z - shore[1]));
    }
    check('water stops it: driven off the shore it stands in the shallows, no deeper than it wades', deep <= 0.02 && dist < 14, `${f1((deep + 0.4) * 100)} cm at the deepest, ${f1(dist)} m from the bank`);
  }
  // ---- doorways: a moped and a bicycle ridden at every door of the map
  {
    let through = 0, tried = 0;
    for (const o of w.openings) {
      const nx = Math.sin(o.ry), nz = Math.cos(o.ry); // across the doorway, one way...
      for (const side of [1, -1]) {
        const x = o.x + nx * side * 3.2, z = o.z + nz * side * 3.2;
        const y = groundAt(w, x, z, (o.y || w.heightAt(o.x, o.z)) + 0.4, 0.25, false);
        const v = { ...newV(w, tried % 2 ? VEH.BIKE : VEH.MOPED, x, z, yawAlong(-nx * side, -nz * side)), y };
        if (bodySunk(w, v) > 0.01) continue;
        tried++;
        let passed = false;
        for (let i = 0; i < 3 * 60; i++) {
          stepVehicle(v, 1, 0, false, false, w, CMD_DT, null);
          if (((v.x - o.x) * nx + (v.z - o.z) * nz) * side < -0.6 && Math.abs((v.x - o.x) * nz - (v.z - o.z) * nx) < (o.w || 1.3) / 2) passed = true;
        }
        if (passed) through++;
      }
    }
    check('no doorway lets a moped or a bicycle through: buildings are entered on foot', through === 0 && tried > 200, `${tried} runs at ${w.openings.length} doorways, ${through} got through`);
    // (and no room of the city is ridden into by any way)
    let inRoom = 0;
    for (const r of (w.city?.rooms || []).slice(0, 60)) {
      for (let a = 0; a < 4; a++) {
        const dx = Math.sin(r.ry + (a * Math.PI) / 2), dz = Math.cos(r.ry + (a * Math.PI) / 2);
        const reach = (a % 2 ? r.w : r.d) / 2 + 4;
        const v = newV(w, VEH.MOPED, r.x + dx * reach, r.z + dz * reach, yawAlong(-dx, -dz));
        v.y = groundAt(w, v.x, v.z, r.y + 0.5, 0.25, false);
        if (bodySunk(w, v) > 0.01) continue;
        for (let i = 0; i < 3 * 60; i++) stepVehicle(v, 1, 0, false, false, w, CMD_DT, null);
        const lx = (v.x - r.x) * Math.cos(r.ry) - (v.z - r.z) * Math.sin(r.ry), lz = (v.x - r.x) * Math.sin(r.ry) + (v.z - r.z) * Math.cos(r.ry);
        if (Math.abs(lx) < r.w / 2 - 0.8 && Math.abs(lz) < r.d / 2 - 0.8) inRoom++;
      }
    }
    check('...nor is a room of the city ridden into through its shop front', inRoom === 0, `${inRoom} ended inside a room`);
  }
  // ---- the ground: faster on the road than off it, a hill costs speed, it stays where it is parked
  {
    const hw = w.highway.pts;
    // a clear stretch of Route 9: 120 m of it with nothing solid near
    let on = null;
    for (let i = 20; i < hw.length / 2 - 140 && !on; i += 6) {
      let ok = true;
      for (let k = 0; ok && k < 130; k += 4) ok = !w.staticGrid.query(hw[(i + k) * 2], hw[(i + k) * 2 + 1], 4.5, []).some((c) => !(c.flags & COL.NOBLOCK)) && Math.abs(w.heightAt(hw[(i + k) * 2], hw[(i + k) * 2 + 1]) - w.heightAt(hw[i * 2], hw[i * 2 + 1])) < 1.5;
      if (ok) on = i;
    }
    const [gx, gz] = openGround(w);
    const gr = grassRun(w, 120);
    const tops = {};
    for (const vk of [VEH.CAR, VEH.MOPED, VEH.BIKE]) {
      const P = VEHICLES[vk];
      // down the road, steering along it
      const v = newV(w, vk, hw[on * 2], hw[on * 2 + 1], yawAlong(hw[on * 2 + 20] - hw[on * 2], hw[on * 2 + 21] - hw[on * 2 + 1]));
      let road = 0, k = on;
      for (let i = 0; i < 9 * 60; i++) {
        while (Math.hypot(hw[k * 2] - v.x, hw[k * 2 + 1] - v.z) < 8) k++;
        let err = yawAlong(hw[k * 2] - v.x, hw[k * 2 + 1] - v.z) - v.yaw;
        while (err > Math.PI) err -= 6.283;
        while (err < -Math.PI) err += 6.283;
        stepVehicle(v, 1, err < -0.02 ? 1 : err > 0.02 ? -1 : 0, false, false, w, CMD_DT, null);
        road = Math.max(road, speedOf(v));
      }
      const g = newV(w, vk, gr[0], gr[1], yawAlong(gr[2], gr[3]));
      let grass = 0;
      for (let i = 0; i < 9 * 60; i++) {
        stepVehicle(g, 1, 0, false, false, w, CMD_DT, null);
        grass = Math.max(grass, speedOf(g));
      }
      tops[vk] = [road, grass, P.top];
    }
    const ok = Object.values(tops).every(([road, grass, top]) => road > top * 0.78 && road <= top * 1.1 && grass < road * 0.9);
    check('each is faster on the road than on the grass, and the car loses most off it', ok && tops[VEH.CAR][1] / tops[VEH.CAR][0] < tops[VEH.MOPED][1] / tops[VEH.MOPED][0] + 0.02, Object.entries(tops).map(([k, [r, g]]) => `${VEHICLES[k].name} ${f1(r * 3.6)} / ${f1(g * 3.6)} km/h`).join(', '));
    check('a moped is faster than a sprint, a car faster than a moped, and a bicycle ridden easily still beats a run', tops[VEH.BIKE][0] > SPRINT_SPEED && tops[VEH.MOPED][0] > tops[VEH.BIKE][0] * 1.5 && tops[VEH.CAR][0] > tops[VEH.MOPED][0] * 1.2, `sprint ${f1(SPRINT_SPEED * 3.6)} km/h; ${Object.entries(tops).map(([k, [r]]) => `${VEHICLES[k].name} ${f1(r)} m/s`).join(', ')}`);
    // a hill: the steepest 30 m of open ground within reach
    let hill = null, best = 0;
    for (let x = -w.half + 60; x < w.half - 60; x += 12) {
      for (let z = -w.half + 60; z < w.half - 60; z += 12) {
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const rise = w.heightAt(x + dx * 30, z + dz * 30) - w.heightAt(x, z);
          if (Math.abs(rise) < best || Math.abs(rise) > 9 || w.heightAt(x, z) < WATER_LEVEL + 1 || w.heightAt(x + dx * 30, z + dz * 30) < WATER_LEVEL + 1) continue;
          let clear = true;
          for (let k = -3; clear && k <= 33; k += 3) clear = surfaceKind(w, x + dx * k, z + dz * k, 50) === SURF_KIND.GRASS && !w.staticGrid.query(x + dx * k, z + dz * k, 3, []).some((c) => !(c.flags & COL.NOBLOCK));
          if (!clear) continue;
          best = Math.abs(rise);
          hill = rise > 0 ? [x, z, dx, dz] : [x + dx * 30, z + dz * 30, -dx, -dz];
        }
      }
    }
    const up = newV(w, VEH.MOPED, hill[0], hill[1], yawAlong(hill[2], hill[3]));
    const down = newV(w, VEH.MOPED, hill[0] + hill[2] * 30, hill[1] + hill[3] * 30, yawAlong(-hill[2], -hill[3]));
    for (let i = 0; i < 3 * 60; i++) {
      stepVehicle(up, 1, 0, false, false, w, CMD_DT, null);
      stepVehicle(down, 1, 0, false, false, w, CMD_DT, null);
    }
    const flat = newV(w, VEH.MOPED, gr[0], gr[1], yawAlong(gr[2], gr[3]));
    for (let i = 0; i < 3 * 60; i++) stepVehicle(flat, 1, 0, false, false, w, CMD_DT, null);
    check('a hill costs speed going up and gives it going down', speedOf(up) < speedOf(flat) - 0.4 && speedOf(down) > speedOf(flat) + 0.2, `a ${f1(best)} m rise in 30 m: ${f1(speedOf(up))} m/s up, ${f1(speedOf(flat))} on the level, ${f1(speedOf(down))} down after 3 s`);
    const parked = newV(w, VEH.CAR, hill[0] + hill[2] * 12, hill[1] + hill[3] * 12, yawAlong(hill[2], hill[3]));
    const [px, pz] = [parked.x, parked.z];
    for (let i = 0; i < 10 * 60; i++) stepVehicle(parked, 0, 0, true, false, w, CMD_DT, null);
    check('left with its brake on, it stays where it is on that hill', Math.hypot(parked.x - px, parked.z - pz) < 0.05, `${f1(Math.hypot(parked.x - px, parked.z - pz) * 100)} cm in 10 s`);
    // steering: less lock at speed; the handbrake brings the tail round
    const a = newV(w, VEH.CAR, gx, gz, 0), b = newV(w, VEH.CAR, gx, gz, 0);
    for (let i = 0; i < 60; i++) stepVehicle(a, 1, 1, false, false, w, CMD_DT, null);
    const slowTurn = Math.abs(a.steer);
    for (let i = 0; i < 6 * 60; i++) stepVehicle(b, 1, 0, false, false, w, CMD_DT, null);
    for (let i = 0; i < 60; i++) stepVehicle(b, 1, 1, false, false, w, CMD_DT, null);
    const ev = [];
    const c = newV(w, VEH.CAR, gx, gz, 0);
    for (let i = 0; i < 5 * 60; i++) stepVehicle(c, 1, 0, false, false, w, CMD_DT, null);
    const y0 = c.yaw;
    for (let i = 0; i < 90; i++) stepVehicle(c, 0, 1, true, false, w, CMD_DT, ev);
    check('the steering has less lock the faster it goes, and the handbrake lets the tyres go', slowTurn > Math.abs(b.steer) * 1.8 && ev.some((e) => e.type === 'veh_skid') && Math.abs(c.yaw - y0) > 0.3, `lock ${slowTurn.toFixed(2)} rad from a standstill, ${Math.abs(b.steer).toFixed(2)} at ${f1(speedOf(b))} m/s`);
  }
}

// ================================================================ in a game: found, fixed, fuelled, ridden
{
  // ---- the island first: nothing, and the car at the camp is the quest's
  const game = new Game({ seed, godMode: true, dayLength: 36000, themes: false, log: () => {} });
  const A = client(game, 'Ann');
  const B = client(game, 'Ben');
  game.update();
  const a = A.p(), b = B.p();
  A.act(ACT.VEHICLE, VACT.ENTER, 1);
  A.act(ACT.SIPHON, 0, 0);
  game.update();
  check('on the island there is no vehicle, and asking for one does nothing', game.vehicles.list.length === 0 && game.all.every((e) => e.kind !== ENT.VEHICLE) && !a.state.drive && !a.hold);
  game.debugCommand(a, ['map2']);
  game.update();
  quiet(game);
  const V = game.vehicles;
  const w = game.world;
  const car = V.list.find((e) => e.quest);
  const run1 = (ticks, fa, fb) => {
    for (let i = 0; i < ticks; i++) {
      const [ba, ya] = fa ? fa(i) : [0, a.state.yaw];
      const [bb, yb] = fb ? fb(i) : [0, b.state.yaw];
      A.input(ba, ya);
      B.input(bb, yb);
      game.update();
    }
  };
  run1(2);
  const PC = VEHICLES[VEH.CAR];
  check("on the mainland the car the team crossed in stands at the bridgehead: it runs, with fuel in it, and is everybody's", !!car && car.state === VSTATE.OK && car.fuel > PC.tank * 0.3 && car.hp > PC.hp * 0.5 && car.vk === VEH.CAR && Math.hypot(car.x - w.start.x, car.z - w.start.z) < 40 && !!car.col, car ? `${Math.round((car.fuel / PC.tank) * 100)}% of a tank, ${Math.round((car.hp / PC.hp) * 100)}% sound, ${f1(Math.hypot(car.x - w.start.x, car.z - w.start.z))} m from the team` : '');
  const kinds = [VEH.MOPED, VEH.CAR, VEH.BIKE].map((k) => V.list.filter((e) => e.vk === k && !e.quest && !e.starter).length);
  check('...and about the map stand the broken ones, and one of the bridgehead\'s for a team this small', kinds[0] >= 5 && kinds[1] >= 4 && kinds[2] >= 4 && V.list.filter((e) => e.starter).length === 1 && V.list.every((e) => e.quest || e.state === VSTATE.BROKEN), `${kinds[0]} mopeds, ${kinds[1]} cars, ${kinds[2]} bicycles, ${V.list.filter((e) => e.starter).length} at the bridgehead`);
  check('...which everybody is sent, wherever they stand', V.list.every((e) => A.ent(e.id) && B.ent(e.id)) && (A.ent(car.id).q[5] & VFLAG.QUEST) !== 0);

  // ---- the bridgehead's: no parts, a few seconds' work
  const st = V.list.find((e) => e.starter);
  beside(game, a, st);
  run1(2);
  A.act(ACT.VEHICLE, VACT.ENTER, st.id);
  run1(3);
  check('one that does not run cannot be got onto', !a.state.drive && !a.state.pass && A.notes.some((n) => n[0] === NOTIFY.VEH_NEED));
  holdOn(game, A, st, 8 * SEC, [B]);
  check("the bridgehead's moped wants no part: [E] held a few seconds and it runs", st.state === VSTATE.OK && st.fuel > 0 && A.notes.some((n) => n[0] === NOTIFY.VEH_FIXED), `${Math.round((st.fuel / VEHICLES[st.vk].tank) * 100)}% of a tank in it`);

  // ---- a broken one found on the map: its parts, one hold each
  const mop = V.list.find((e) => e.vk === VEH.MOPED && !e.starter);
  beside(game, a, mop);
  run1(2);
  holdOn(game, A, mop, 3 * SEC, [B]);
  check('a broken moped cannot be fixed without its parts', mop.state === VSTATE.BROKEN && mop.need === 7 && !a.hold);
  give(game, a, FIX[VEH.MOPED][0][0], FIX[VEH.MOPED][0][1]);
  holdOn(game, A, mop, 6 * SEC, [B]);
  check('with the scrap for it one part is fitted, and it still wants the others', mop.state === VSTATE.BROKEN && mop.need === 6 && (A.ent(mop.id).q[5] & VFLAG.NEED) >> VFLAG.NEED_SHIFT === 6, `need ${mop.need}`);
  for (const [item, n] of FIX[VEH.MOPED].slice(1)) give(game, a, item, n);
  holdOn(game, A, mop, 12 * SEC, [B]);
  check('with every part fitted (one [E] held through them all) it runs, and the parts are gone from the pack', mop.state === VSTATE.OK && mop.need === 0 && FIX[VEH.MOPED].every(([item]) => !a.inv.some((it) => it && it.item === item)), `fuel ${f1(mop.fuel)} of ${VEHICLES[VEH.MOPED].tank}`);

  // ---- fuel: poured in from the reserve
  const fuel0 = mop.fuel;
  a.state.ammo[AMMO.FUEL] = 50;
  holdOn(game, A, mop, 3 * SEC, [B]);
  check('[E] held on one that runs pours Fuel from the reserve into its tank', mop.fuel > fuel0 + 15 && a.state.ammo[AMMO.FUEL] < 50 && Math.abs(mop.fuel - fuel0 - (50 - a.state.ammo[AMMO.FUEL])) < 1e-6, `${f1(fuel0)} -> ${f1(mop.fuel)}, ${a.state.ammo[AMMO.FUEL]} left on them`);

  // ---- on it: the driver first, the next one behind
  const [ox, oz] = openGround(w);
  mop.x = ox;
  mop.z = oz;
  mop.yaw = 0;
  V.unpark(mop);
  V.rest(mop);
  beside(game, a, mop);
  beside(game, b, mop, 1);
  run1(2);
  B.act(ACT.VEHICLE, VACT.ENTER, V.list.find((e) => e !== mop && e.state === VSTATE.BROKEN).id);
  A.act(ACT.VEHICLE, VACT.ENTER, mop.id);
  run1(3);
  check('[E] beside it puts a survivor at its bars, and its box leaves the world', a.state.drive === mop.id && a.state.driveK === VEH.MOPED && mop.seats[0] === a.id && !mop.col && A.self.drive === mop.id, `seat 0: ${mop.seats[0]}`);
  B.act(ACT.VEHICLE, VACT.ENTER, mop.id);
  run1(3);
  const seat = seatAt(mop.vk, 1, mop.x, mop.y, mop.z, mop.yaw, {});
  check('...and the next behind them, carried', b.state.pass === mop.id && b.state.passN === 1 && mop.seats[1] === b.id && Math.hypot(b.state.x - seat.x, b.state.z - seat.z) < 0.01, `passenger ${f1(Math.hypot(b.state.x - mop.x, b.state.z - mop.z))} m behind the middle`);
  check('...and everybody sees who sits where', (A.ent(mop.id).q[7] & 0x3fff) === a.id && ((B.ent(mop.id).q[7] >> 14) & 0x3fff) === b.id);
  const C = client(game, 'Cat');
  const cP = C.p();
  beside(game, cP, mop, -1, 1.2);
  game.update();
  C.act(ACT.VEHICLE, VACT.ENTER, mop.id);
  C.input(0, 0);
  run1(2);
  check('a moped seats two: the third is told so', !cP.state.pass && !cP.state.drive && C.notes.some((n) => n[0] === NOTIFY.VEH_NEED));
  game.removePlayer(cP);

  // ---- driven
  const f0 = a.state.dfuel;
  let top = 0;
  run1(6 * SEC, () => [BTN.FWD, 0], () => [0, 0]);
  top = speedOf(a.state);
  const went = Math.hypot(a.state.x - ox, a.state.z - oz);
  check('W opens the throttle: faster than a sprint within seconds, and it burns fuel', top > SPRINT_SPEED + 2 && went > 30 && a.state.dfuel < f0 - 0.5 && Math.abs(mop.fuel - a.state.dfuel) < 1e-4, `${f1(top)} m/s after 6 s, ${f1(went)} m, ${f1(f0 - a.state.dfuel)} Fuel`);
  check('...with the passenger carried all the way, in their seat', Math.hypot(b.state.x - seatAt(mop.vk, 1, mop.x, mop.y, mop.z, mop.yaw, {}).x, b.state.z - seatAt(mop.vk, 1, mop.x, mop.y, mop.z, mop.yaw, {}).z) < 1e-3 && b.state.pass === mop.id);
  const yaw0 = a.state.dyaw;
  run1(SEC, () => [BTN.FWD | BTN.RIGHT, 0], () => [0, 0]);
  check('D steers it to the right', a.state.dsteer > 0.02 && a.state.dyaw < yaw0 - 0.05, `${f1((yaw0 - a.state.dyaw) * 57.3)} degrees in a second`);
  // (no gun at the bars; the passenger's is their own)
  for (const p of [a, b]) {
    p.state.weapons[1] = ITEM.PISTOL;
    p.state.mags[1] = 12;
    p.state.slot = 1;
    p.state.switchT = 0;
  }
  const fa = a.state.fireCount, fb = b.state.fireCount;
  run1(SEC, (i) => [BTN.FWD | (i % 4 < 2 ? BTN.ATTACK : 0), 0], (i) => [i % 4 < 2 ? BTN.ATTACK : 0, 1]);
  check("the driver's weapon does nothing; the passenger's fires", a.state.fireCount === fa && b.state.fireCount !== fb, `${(b.state.fireCount - fb + 256) % 256} shots from the pillion`);
  const v1 = speedOf(a.state);
  run1(SEC, () => [BTN.BACK, 0], () => [0, 0]);
  check('S brakes it', speedOf(a.state) < v1 - 5, `${f1(v1)} -> ${f1(speedOf(a.state))} m/s in a second`);
  // ---- off it
  run1(2 * SEC, () => [BTN.BACK, 0]);
  run1(SEC);
  A.act(ACT.VEHICLE, VACT.EXIT, 0);
  run1(3);
  const offBy = Math.hypot(a.state.x - mop.x, a.state.z - mop.z);
  check('[E] gets the driver off, beside it, and the passenger keeps their seat', !a.state.drive && offBy > 0.5 && offBy < 2 && mop.seats[0] === 0 && mop.seats[1] === b.id && sunk(w, a.state.x, a.state.y, a.state.z, 0.34, 0.45, 1.8) < 0.01, `${f1(offBy)} m from it`);
  B.act(ACT.VEHICLE, VACT.EXIT, 0);
  run1(4);
  check('empty and standing, it is a box in the world again, where the wire says it is', !!mop.col && mop.col.x === mop.x && Math.abs(mop.x - qpos(mop.x) / w.posScale) < 1e-9 && vehicleGrid(w).parked.count >= 1 && sunk(w, mop.x, mop.y, mop.z, 0.2, 0.3, 1.5) > 0);

  // ---- run dry
  beside(game, a, mop);
  run1(2);
  A.act(ACT.VEHICLE, VACT.ENTER, mop.id);
  run1(3);
  a.state.dfuel = 0.4;
  let drySp = 0;
  run1(8 * SEC, () => [BTN.FWD, a.state.yaw]);
  drySp = speedOf(a.state);
  run1(8 * SEC, () => [BTN.FWD, a.state.yaw]);
  check('out of fuel the engine dies: it rolls to a stop however the throttle is held', a.state.dfuel === 0 && speedOf(a.state) < 0.3 && speedOf(a.state) <= drySp, `${f1(drySp)} m/s 8 s after the last of it, then ${f1(speedOf(a.state))}`);
  A.act(ACT.VEHICLE, VACT.EXIT, 0);
  run1(3);

  // ---- siphoning a wreck
  const wreck = w.props.find((pr) => siphonOf(pr) > 0);
  a.state.x = wreck.x + 2.6;
  a.state.z = wreck.z;
  a.state.y = groundAt(w, a.state.x, a.state.z, 200, 0.3);
  a.state.ammo[AMMO.FUEL] = 0;
  run1(2);
  A.notes.length = 0;
  A.act(ACT.SIPHON, qpos(wreck.x), qpos(wreck.z));
  run1(2);
  const holding = a.hold && a.hold.kind === HOLD.SIPHON;
  run1(5 * SEC);
  const got = a.state.ammo[AMMO.FUEL];
  A.act(ACT.SIPHON, qpos(wreck.x), qpos(wreck.z));
  run1(5 * SEC);
  check("[E] held at a wreck with fuel in its tank draws it off into the reserve, once: after that it is dry", holding && got === siphonOf(wreck) && a.state.ammo[AMMO.FUEL] === got && A.notes.filter((n) => n[0] === NOTIFY.SIPHONED).map((n) => n[1]).join() === `${got},0`, `${got} Fuel from a ${wreck.type}`);
  const dryProp = w.props.find((pr) => pr.type === 'car_burnt');
  A.act(ACT.SIPHON, qpos(dryProp.x), qpos(dryProp.z));
  run1(2);
  check('...and a burnt-out one has none', !a.hold);

  // ---- the car: four seats, a shell
  const [cx, cz] = openGround(w, 1);
  car.x = cx;
  car.z = cz;
  car.yaw = 0;
  V.unpark(car);
  V.rest(car);
  const Cs = [A, B, client(game, 'Cy'), client(game, 'Di'), client(game, 'Ed')];
  game.update();
  Cs.forEach((c, i) => beside(game, c.p(), car, i % 2 ? 1 : -1, 0.8 + (i >> 1) * 0.3));
  const runAll = (ticks, fn) => {
    for (let i = 0; i < ticks; i++) {
      Cs.forEach((c, k) => {
        const [bt, yw] = fn ? fn(k, i) : [0, c.p().state.yaw];
        c.input(bt, yw);
      });
      game.update();
    }
  };
  runAll(2);
  for (const c of Cs) {
    c.act(ACT.VEHICLE, VACT.ENTER, car.id);
    runAll(2);
  }
  check('a car seats four - the first at the wheel - and the fifth is left standing', car.seats.join() === Cs.slice(0, 4).map((c) => c.id).join() && !Cs[4].p().state.pass && !Cs[4].p().state.drive, car.seats.join(' '));
  runAll(7 * SEC, (k) => [k === 0 ? BTN.FWD : 0, 0]);
  const carTop = speedOf(a.state);
  const inSeats = Cs.slice(1, 4).every((c, k) => Math.hypot(c.p().state.x - seatAt(VEH.CAR, k + 1, car.x, car.y, car.z, car.yaw, {}).x, c.p().state.z - seatAt(VEH.CAR, k + 1, car.x, car.y, car.z, car.yaw, {}).z) < 1e-3);
  check('...and carries them all, faster than the moped', carTop > top + 3 && inSeats, `${f1(carTop)} m/s after 7 s`);
  // the horn, the headlamp
  runAll(4, (k) => [k === 0 ? BTN.HORN : 0, 0]);
  const horn = car.horn === 1 && (B.ent(car.id).q[5] & VFLAG.HORN) !== 0;
  runAll(2);
  Cs[2].act(ACT.VEHICLE, VACT.LIGHTS, car.id);
  runAll(2);
  check('the horn sounds while its button is down, and anybody in it works the headlamps', horn && car.horn === 0 && car.lights === 1 && (Cs[4].ent(car.id).q[5] & VFLAG.LIGHTS) !== 0);
  runAll(3 * SEC, (k) => [k === 0 ? BTN.BACK : 0, 0]);
  // out of it while it moves hurts
  for (const c of Cs.slice(0, 4)) c.act(ACT.VEHICLE, VACT.EXIT, 0);
  runAll(4);
  const out = Cs.slice(0, 4).map((c) => c.p().state);
  check('everybody out: each beside it, nobody in anybody or in the car', out.every((s) => !s.drive && !s.pass && sunk(w, s.x, s.y, s.z, 0.3, 0.45, 1.8) < 0.02) && out.every((s, i) => out.every((t, j) => i === j || Math.hypot(s.x - t.x, s.z - t.z) > 0.5)) && V.empty(car), out.map((s) => `${f1(s.x - car.x)},${f1(s.z - car.z)}`).join('  '));
  for (const c of Cs.slice(2)) game.removePlayer(c.p());

  // ---- the bicycle: no fuel, no noise, legs
  const bike = V.list.find((e) => e.vk === VEH.BIKE);
  bike.state = VSTATE.OK;
  bike.need = 0;
  bike.x = ox - 3.5;
  bike.z = oz;
  bike.yaw = 0;
  V.unpark(bike);
  V.rest(bike);
  beside(game, a, bike);
  put(b, cx + 200, cz);
  run1(2);
  A.act(ACT.VEHICLE, VACT.ENTER, bike.id);
  run1(3);
  run1(6 * SEC, () => [BTN.FWD, 0]);
  const easy = speedOf(a.state);
  const st0 = a.state.stamina;
  run1(4 * SEC, () => [BTN.FWD | BTN.SPRINT, 0]);
  check('a bicycle needs no fuel: pedalled it beats a sprint, and Shift stands on the pedals, on stamina', bike.vk === VEH.BIKE && easy > SPRINT_SPEED && speedOf(a.state) > easy + 1.5 && a.state.stamina < st0 - 30 && !bike.running, `${f1(easy)} m/s easy, ${f1(speedOf(a.state))} hard, stamina ${Math.round(st0)} -> ${Math.round(a.state.stamina)}`);
  A.act(ACT.VEHICLE, VACT.EXIT, 0);
  run1(3);
  function put(p, x, z) {
    const s = p.state;
    s.drive = s.pass = 0;
    s.x = x;
    s.z = z;
    s.y = groundAt(w, x, z, 200, 0.3);
    s.vx = s.vy = s.vz = 0;
    game.fillHistory(p);
  }
}

// ================================================================ the dead, damage, breakdown
{
  const { game, cs } = mainlandGame(seed, 2);
  const [A, B] = cs;
  const a = A.p(), b = B.p();
  const V = game.vehicles;
  const w = game.world;
  const [ox, oz] = openGround(w);
  game.godMode = false;
  const run1 = (ticks, fa, fb) => {
    for (let i = 0; i < ticks; i++) {
      const [ba, ya] = fa ? fa(i) : [0, a.state.yaw];
      const [bb, yb] = fb ? fb(i) : [0, b.state.yaw];
      A.input(ba, ya);
      B.input(bb, yb);
      game.update();
    }
  };
  const fresh = (vk, x = ox, z = oz, yaw = 0) => {
    for (const p of [a, b]) V.drop(p);
    for (const z2 of [...game.zombies]) game.removeEntity(z2);
    game.zombies.length = 0;
    const P = VEHICLES[vk];
    const e = V.make(vk, x, z, yaw, { state: VSTATE.OK, need: 0, fuel: P.tank, hp: P.hp });
    a.hp = a.maxHp;
    a.downed = false;
    a.state.downed = 0;
    a.state.stunT = 0;
    beside(game, a, e);
    b.state.x = ox + 300;
    b.state.z = oz;
    run1(2);
    A.act(ACT.VEHICLE, VACT.ENTER, e.id);
    run1(3);
    return e;
  };
  const spawnAt = (type, x, z) => {
    const zz = game.zm.spawn(type, x, z, { horde: true });
    zz.x = x;
    zz.z = z;
    zz.y = groundAt(w, x, z, 200, 0.2, false);
    return zz;
  };
  // ---- a car through a walker at speed
  {
    const e = fresh(VEH.CAR);
    run1(6 * SEC, () => [BTN.FWD, 0]);
    const z = spawnAt(ZTYPE.WALKER, a.state.x, a.state.z - 22);
    const hp0 = z.hp, v0 = speedOf(a.state), c0 = e.hp;
    let hit = -1;
    for (let i = 0; i < 4 * SEC && hit < 0; i++) {
      run1(1, () => [BTN.FWD, 0]);
      if (z.hp < hp0 || z.dead) hit = i;
    }
    const v1 = speedOf(a.state);
    run1(SEC, () => [BTN.FWD, 0]);
    check('a car runs a walker down: the walker is killed or flung aside, and the car pays for it in speed and in damage', hit >= 0 && (z.dead || Math.abs(z.x - e.x) > 0.9) && v1 < v0 && e.hp < c0 - 10 && a.state.drive === e.id && a.hp === a.maxHp, `${f1(v0)} -> ${f1(v1)} m/s, ${Math.round(c0 - e.hp)} off the car's ${VEHICLES[VEH.CAR].hp}, the walker ${z.dead ? 'dead' : `-${Math.round(hp0 - z.hp)}`}`);
    // ...a row of them is not mown down for nothing
    const hpA = e.hp;
    const row = [];
    for (let k = 0; k < 8; k++) row.push([spawnAt(ZTYPE.WALKER, a.state.x + (k % 2 ? 0.5 : -0.5), a.state.z - 16 - k * 3.2), a.state.x + (k % 2 ? 0.5 : -0.5), a.state.z - 16 - k * 3.2]);
    let slowest = 99;
    for (let i = 0; i < 4 * SEC; i++) {
      // (they stand in its way until it has struck them: left alone a crowd fans out round what comes at it)
      for (const [z, x, zz] of row) if (!z.dead && z.hp === z.maxHp) (z.x = x), (z.z = zz);
      run1(1, () => [BTN.FWD, 0]);
      slowest = Math.min(slowest, speedOf(a.state));
    }
    check('...eight in a row cost it most of its speed and a good part of itself: a car is no lawnmower', slowest < v0 * 0.55 && hpA - e.hp > 120, `down to ${f1(slowest)} m/s, ${Math.round(hpA - e.hp)} damage`);
    // a Tank stops it dead
    for (const z2 of [...game.zombies]) game.removeEntity(z2);
    game.zombies.length = 0;
    e.hp = VEHICLES[VEH.CAR].hp;
    run1(5 * SEC, () => [BTN.FWD, 0]);
    const t = spawnAt(ZTYPE.TANK, a.state.x, a.state.z - 20);
    const hpB = e.hp;
    let stopped = false;
    for (let i = 0; i < 3 * SEC && !stopped; i++) {
      run1(1, () => [BTN.FWD, 0]);
      if (speedOf(a.state) < 0.5 && t.hp < t.maxHp) stopped = true;
    }
    check('a Tank in its way stops it dead and stands, and the car is badly hurt', stopped && !t.dead && hpB - e.hp > 150, `${Math.round(hpB - e.hp)} damage to the car, ${Math.round(t.maxHp - t.hp)} to the Tank`);
    game.removeEntity(t);
    game.zombies.length = 0;
    A.act(ACT.VEHICLE, VACT.EXIT, 0);
    run1(3);
    V.unpark(e);
    game.removeEntity(e);
  }
  // ---- a stopped car in a crowd: it shields, then its glass goes in; and the crowd holds it
  {
    const e = fresh(VEH.CAR);
    const P = VEHICLES[VEH.CAR];
    for (let k = 0; k < 10; k++) spawnAt(ZTYPE.WALKER, e.x + Math.sin(k * 0.63) * 3.2, e.z + Math.cos(k * 0.63) * 3.2);
    let firstHurt = -1, hpAtHurt = 0;
    for (let i = 0; i < 60 * SEC && e.state === VSTATE.OK; i++) {
      run1(1);
      if (a.hp < a.maxHp && firstHurt < 0) {
        firstHurt = i / SEC;
        hpAtHurt = e.hp;
      }
      if (a.hp < 30) a.hp = 30; // (kept alive: this is about the car)
    }
    const inside = game.zombies.filter((z) => !z.dead && Math.abs((z.x - e.x) * Math.cos(e.yaw) - (z.z - e.z) * Math.sin(e.yaw)) < P.halfW - 0.1 && Math.abs((z.x - e.x) * Math.sin(e.yaw) + (z.z - e.z) * Math.cos(e.yaw)) < P.half - 0.1).length;
    check('the dead round a stopped car beat on it: who is inside is safe while its glass holds, then they get in at them', firstHurt > 4 && hpAtHurt <= P.hp * 0.5 + 30 && e.state !== VSTATE.OK, `the driver first hurt after ${f1(firstHurt)} s with the car at ${Math.round((hpAtHurt / P.hp) * 100)}%; broken down after ${f1((game.tick % 100000) / SEC)} s of it`);
    check('...and none of them walks into the car', inside === 0, `${inside} inside its box`);
    e.state = VSTATE.OK;
    e.hp = P.hp;
    a.state.ddead = 0;
    for (const z of game.zombies) (z.x = e.x + (Math.random() - 0.5) * 1.6), (z.z = e.z - P.half - 0.6 - Math.random());
    let best = 0;
    for (let i = 0; i < 3 * SEC; i++) {
      run1(1, () => [BTN.FWD, 0]);
      best = Math.max(best, speedOf(a.state));
      for (const z of game.zombies) if (!z.dead && z.hp < z.maxHp) z.hp = z.maxHp;
    }
    check('a crowd pressed against its nose holds it: it does not pull away through them', best < 3.2, `${f1(best)} m/s at the most in 3 s of full throttle`);
    for (const z of [...game.zombies]) game.removeEntity(z);
    game.zombies.length = 0;
    A.act(ACT.VEHICLE, VACT.EXIT, 0);
    run1(3);
    // ---- parked and empty, the dead walk round it
    e.hp = P.hp;
    const z = spawnAt(ZTYPE.RUNNER, e.x + 6, e.z);
    a.state.x = e.x - 6;
    a.state.z = e.z;
    a.state.y = groundAt(w, a.state.x, a.state.z, 200, 0.3);
    let through = 0, reached = false;
    for (let i = 0; i < 12 * SEC && !reached; i++) {
      run1(1);
      a.hp = a.maxHp;
      if (Math.abs((z.x - e.x) * Math.cos(e.yaw) - (z.z - e.z) * Math.sin(e.yaw)) < P.halfW - 0.2 && Math.abs((z.x - e.x) * Math.sin(e.yaw) + (z.z - e.z) * Math.cos(e.yaw)) < P.half - 0.2) through++;
      if (Math.hypot(z.x - a.state.x, z.z - a.state.z) < 2) reached = true;
    }
    check('a car standing empty is a box of the world: one of the dead after a survivor beyond it goes round, not through', reached && through === 0 && !!e.col && e.hp === P.hp, `${through} ticks inside it`);
    game.removeEntity(z);
    game.zombies.length = 0;
    V.unpark(e);
    game.removeEntity(e);
  }
  // ---- on a moped: thrown by a body at speed, dragged off at a crawl
  {
    const e = fresh(VEH.MOPED);
    run1(7 * SEC, () => [BTN.FWD, 0]);
    const v0 = speedOf(a.state);
    spawnAt(ZTYPE.WALKER, a.state.x, a.state.z - 16);
    let thrown = false;
    for (let i = 0; i < 3 * SEC && !thrown; i++) {
      run1(1, () => [BTN.FWD, 0]);
      if (!a.state.drive) thrown = true;
    }
    check('a moped ridden into one of the dead at speed throws its rider, hurt', thrown && a.hp < a.maxHp && e.seats[0] === 0 && A.notes.some((n) => n[0] === NOTIFY.VEH_OFF), `at ${f1(v0)} m/s: -${Math.round(a.maxHp - a.hp)} hp`);
    for (const z of [...game.zombies]) game.removeEntity(z);
    game.zombies.length = 0;
    run1(2 * SEC);
    V.unpark(e);
    game.removeEntity(e);
    const e2 = fresh(VEH.MOPED);
    run1(SEC, () => [BTN.FWD, 0]);
    for (let k = 0; k < 4; k++) spawnAt(ZTYPE.WALKER, a.state.x + (k - 1.5) * 0.9, a.state.z - 2.6);
    let pulled = -1;
    for (let i = 0; i < 12 * SEC && pulled < 0; i++) {
      run1(1, () => [0, 0]);
      if (!a.state.drive) pulled = i / SEC;
      if (a.hp < 40) a.hp = 40;
    }
    check('...and a rider among them at a crawl is hit like anybody on foot, and dragged off', pulled >= 0 && a.hp < a.maxHp, `off after ${f1(pulled)} s`);
    for (const z of [...game.zombies]) game.removeEntity(z);
    game.zombies.length = 0;
    V.unpark(e2);
    game.removeEntity(e2);
  }
  // ---- noise: an engine is heard, a bicycle is not
  {
    const heard = {};
    for (const vk of [VEH.CAR, VEH.MOPED, VEH.BIKE]) {
      const e = fresh(vk);
      const zs = [];
      for (const d of [36, 58, 100]) zs.push(spawnAt(ZTYPE.WALKER, e.x + d, e.z - 6));
      for (const z of zs) (z.horde = false), (z.target = 0), (z.alertT = 0);
      // (round in a tight ring, the throttle open, far from their sight by day: 26 m)
      run1(4 * SEC, () => [BTN.FWD | BTN.LEFT, 0]);
      heard[vk] = zs.map((z) => (z.alertT > 0 || z.target ? 1 : 0));
      for (const z of [...game.zombies]) game.removeEntity(z);
      game.zombies.length = 0;
      A.act(ACT.VEHICLE, VACT.EXIT, 0);
      run1(3);
      V.unpark(e);
      game.removeEntity(e);
    }
    check('an engine draws the dead from as far as it carries - a car from further than a moped - and a bicycle draws none', heard[VEH.CAR].join() === '1,1,0' && heard[VEH.MOPED].join() === '1,0,0' && heard[VEH.BIKE].join() === '0,0,0', `at 36 / 58 / 100 m: car ${heard[VEH.CAR].join('')}, moped ${heard[VEH.MOPED].join('')}, bicycle ${heard[VEH.BIKE].join('')}`);
  }
  // ---- a crash: damage by how hard, the rider of a moped over the bars; breakdown, the patch, the wreck
  {
    // (a wall to hit: something of the team's own, built square across the way)
    const wall = (x, z) => {
      const c = { type: 0, x, z, y0: groundAt(w, x, z, 200) - 1, y1: groundAt(w, x, z, 200) + 3, hx: 6, hz: 0.3, c: 1, s: 0, yaw: 0, r: 6.1, flags: COL.STATIC, id: 0, stamp: 0, cells: null, tag: null };
      w.staticGrid.add(c);
      return c;
    };
    const wl = wall(ox, oz - 46);
    const e = fresh(VEH.CAR);
    const P = VEHICLES[VEH.CAR];
    let v0 = 0;
    for (let i = 0; i < 8 * SEC && e.hp === P.hp; i++) {
      v0 = Math.max(v0, speedOf(a.state));
      run1(1, () => [BTN.FWD, 0]);
    }
    const dmg = P.hp - e.hp;
    check('a car driven into a wall stops there, and is damaged by how hard it hit; who is in it is shaken', dmg > 150 && speedOf(a.state) < 2 && bodySunk(w, { ...e, vk: VEH.CAR }) < 0.05 && a.hp < a.maxHp && a.state.drive === e.id, `at ${f1(v0)} m/s: ${Math.round(dmg)} of ${P.hp}, the driver -${Math.round(a.maxHp - a.hp)} hp`);
    // again, until it breaks down
    a.hp = a.maxHp;
    let n = 1;
    for (; n < 16 && e.state === VSTATE.OK; n++) {
      run1(3 * SEC, () => [BTN.BACK, 0]);
      for (let i = 0; i < 6 * SEC && e.state === VSTATE.OK; i++) {
        const before = e.hp;
        run1(1, () => [BTN.FWD, 0]);
        if (e.hp < before) break;
      }
      a.hp = a.maxHp;
    }
    const dead = e.state === VSTATE.DEAD && a.state.ddead === 1;
    run1(4 * SEC, () => [BTN.BACK, 0]);
    const noGo = speedOf(a.state) < 0.5;
    check('enough of that and it breaks down: the engine is out, with whoever is in it still in it', dead && noGo && a.state.drive === e.id && A.notes.some((x) => x[0] === NOTIFY.VEH_BROKE), `after ${n} crashes`);
    A.act(ACT.VEHICLE, VACT.EXIT, 0);
    run1(3);
    holdOn(game, A, e, 3 * SEC, [B]);
    const still = e.state === VSTATE.DEAD;
    for (const k in REPAIR) give(game, a, +k, REPAIR[k] * 3);
    holdOn(game, A, e, 5 * SEC, [B]);
    check('it is patched up with scrap and tape, [E] held: it runs again, part mended - and with none it stays broken down', still && e.state === VSTATE.OK && e.hp >= P.hp * 0.3 && e.hp < P.hp, `${Math.round((e.hp / P.hp) * 100)}% sound after a patch`);
    holdOn(game, A, e, 12 * SEC, [B]);
    check('...and further, a patch at a time, while the scrap lasts', e.hp > P.hp * 0.9, `${Math.round((e.hp / P.hp) * 100)}%`);
    // bullets and a blast
    const hpC = e.hp;
    a.state.x = e.x - 8;
    a.state.z = e.z;
    a.state.y = groundAt(w, a.state.x, a.state.z, 200, 0.3);
    a.state.weapons[1] = ITEM.PISTOL;
    a.state.mags[1] = 12;
    a.state.slot = 1;
    a.state.switchT = 0;
    for (let i = 0; i < SEC; i++) {
      A.input(i % 4 < 2 ? BTN.ATTACK : 0, yawAlong(1, 0), -0.1);
      B.input(0, 0);
      game.update();
    }
    const shot = hpC - e.hp;
    game.combat.explode(e.x + 3, e.y + 0.5, e.z, 7, { zombies: 420, kind: 0 });
    check('a round into one standing empty hurts it, and a blast beside it more', shot > 5 && hpC - e.hp > shot + 100, `${Math.round(shot)} from a second of pistol, ${Math.round(hpC - e.hp - shot)} from a pipe bomb at 3 m`);
    // burnt out for good
    V.damage(e, e.hp + 1);
    beside(game, a, e);
    run1(2);
    A.act(ACT.VEHICLE, VACT.ENTER, e.id);
    run1(3);
    const sat = a.state.drive === e.id;
    V.damage(e, P.hp);
    run1(3);
    A.act(ACT.VEHICLE, VACT.ENTER, e.id);
    holdOn(game, A, e, 3 * SEC, [B]);
    check('broken down and beaten on further it burns out: whoever is in it is put out, and it is lost for good', sat && e.state === VSTATE.WRECK && !a.state.drive && V.empty(e) && !a.hold && (A.ent(e.id).q[5] & VFLAG.STATE) === VSTATE.WRECK);
    w.staticGrid.remove(wl);
    V.unpark(e);
    game.removeEntity(e);
    // a moped into the same wall
    const wl2 = wall(ox, oz - 40);
    const m = fresh(VEH.MOPED);
    let thrown = false, vm = 0;
    for (let i = 0; i < 8 * SEC && !thrown; i++) {
      vm = Math.max(vm, speedOf(a.state));
      run1(1, () => [BTN.FWD, 0]);
      if (!a.state.drive) thrown = true;
    }
    run1(2 * SEC);
    check('a moped into a wall at speed throws its rider over the bars, hurt, and the moped stays at the wall, damaged', thrown && a.hp < a.maxHp - 10 && m.hp < VEHICLES[VEH.MOPED].hp - 50 && Math.abs(m.z - (oz - 40)) < 2.5 && m.seats[0] === 0 && a.state.z > oz - 40, `at ${f1(vm)} m/s: -${Math.round(a.maxHp - a.hp)} hp, the moped -${Math.round(VEHICLES[VEH.MOPED].hp - m.hp)}`);
    w.staticGrid.remove(wl2);
  }
}

// ================================================================ who is at the wheel: down, dead, dropped, gone; a save mid-ride
{
  const { game, cs } = mainlandGame(seed, 3, { godMode: false });
  const [A, B, C] = cs;
  const a = A.p(), b = B.p(), c = C.p();
  // (they are known again when they come back: a drop holds their place)
  a.rejoinKey = 'key-a';
  b.rejoinKey = 'key-b';
  const V = game.vehicles;
  const w = game.world;
  const [ox, oz] = openGround(w);
  const P = VEHICLES[VEH.CAR];
  const car = V.make(VEH.CAR, ox, oz, 0, { state: VSTATE.OK, need: 0, fuel: P.tank, hp: P.hp });
  const run1 = (ticks, fa) => {
    for (let i = 0; i < ticks; i++) {
      const [ba, ya] = fa ? fa(i) : [0, a.state.yaw];
      if (!a.away) A.input(ba, ya);
      if (!b.away) B.input(0, b.state.yaw);
      C.input(0, c.state.yaw);
      game.update();
    }
  };
  const all = () => {
    for (const p of [a, b, c]) {
      V.drop(p);
      p.hp = p.maxHp;
    }
    car.vx = car.vz = 0;
    V.rest(car);
    beside(game, a, car);
    beside(game, b, car, 1);
    beside(game, c, car, 1, 1.4);
    run1(2);
    A.act(ACT.VEHICLE, VACT.ENTER, car.id);
    run1(2);
    B.act(ACT.VEHICLE, VACT.ENTER, car.id);
    run1(2);
  };
  // ---- the driver goes down
  all();
  run1(4 * SEC, () => [BTN.FWD, 0]);
  const vDown = speedOf(a.state);
  game.goDown(a);
  run1(2);
  const outDown = !a.state.drive && car.seats[0] === 0 && a.downed;
  let rolled = 0;
  for (let i = 0; i < 20 * SEC && (car.vx || car.vz); i++) {
    run1(1);
    rolled = Math.hypot(car.x - ox, car.z - oz);
  }
  check('a driver who goes down is out of it where it happened; the car rolls on with its passenger and stops', outDown && b.state.pass === car.id && car.vx === 0 && car.vz === 0 && rolled > 10 && Math.hypot(b.state.x - car.x, b.state.z - car.z) < 1.2, `${f1(vDown)} m/s, stood ${f1(rolled)} m on`);
  game.revive(a, b);
  // ---- the driver dies
  all();
  run1(3 * SEC, () => [BTN.FWD, 0]);
  game.killPlayer(a, { kind: 3 });
  run1(3);
  check('a driver who dies is out of it too, and the passenger can take the wheel once it has stopped', !a.alive && car.seats[0] === 0 && b.state.pass === car.id);
  for (let i = 0; i < 20 * SEC && (car.vx || car.vz); i++) run1(1);
  B.act(ACT.VEHICLE, VACT.EXIT, 0);
  run1(3);
  B.act(ACT.VEHICLE, VACT.ENTER, car.id);
  run1(3);
  check('...which they do', b.state.drive === car.id && car.seats[0] === b.id);
  B.act(ACT.VEHICLE, VACT.EXIT, 0);
  run1(3);
  game.spawnHuman(a);
  run1(2);
  // ---- the driver's connection drops: held, moved off the wheel, carried; back in it when they return
  all();
  run1(3 * SEC, () => [BTN.FWD, 0]);
  game.onClose(A.session, 1006);
  run1(3);
  const moved = a.away && !a.state.drive && a.state.pass === car.id && car.seats[0] === 0 && car.seats.includes(a.id);
  for (let i = 0; i < 20 * SEC && (car.vx || car.vz); i++) run1(1);
  check('a driver whose connection drops is moved off the wheel into a free seat and carried there, and the car stops', moved && car.vx === 0 && Math.hypot(a.state.x - car.x, a.state.z - car.z) < 1.2, `seats ${car.seats.join(' ')}`);
  // (somebody else drives them on)
  beside(game, c, car);
  C.input(0, 0);
  game.update();
  C.act(ACT.VEHICLE, VACT.ENTER, car.id);
  run1(3);
  const x0 = a.state.x;
  for (let i = 0; i < 3 * SEC; i++) {
    C.input(BTN.FWD, 0);
    B.input(0, 0);
    game.update();
  }
  check('...somebody else takes the wheel and drives them on, held in their seat', c.state.drive === car.id && Math.hypot(a.state.x - x0, a.state.z - a.state.z) >= 0 && Math.hypot(a.state.x - car.x, a.state.z - car.z) < 1.2 && Math.hypot(car.x - ox, car.z - oz) > 20);
  // they come back in mid-ride
  const A2 = { name: 'Ann', id: 0, net: { tick: 0, ack: 0 }, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, handler: new Proxy({}, { get: () => () => {} }) };
  {
    const sess = game.onOpen({ send() {} });
    game.resume(sess, a);
    A.session = sess;
  }
  for (let i = 0; i < SEC; i++) {
    C.input(BTN.FWD, 0);
    game.update();
  }
  void A2;
  check('...and when they come back they are still in that seat, in a car that is moving', !a.away && a.state.pass === car.id && car.seats.includes(a.id) && speedOf(c.state) > 3);
  // ---- a save and a restore in the middle of that ride
  const saved = JSON.parse(JSON.stringify(envelope(game)));
  const g2 = new Game({ restore: saved, log: () => {} });
  const car2 = g2.vehicles.list.find((e) => e.id === car.id);
  const same = car2 && Math.abs(car2.x - car.x) < 1e-9 && Math.abs(car2.fuel - car.fuel) < 1e-9 && car2.hp === car.hp && car2.state === car.state && g2.vehicles.list.length === V.list.length && g2.vehicles.starters === V.starters;
  const c2 = g2.players.get(c.id), a2 = g2.players.get(a.id);
  for (let i = 0; i < 2 * SEC; i++) g2.update();
  check('a deploy in the middle of a ride: every vehicle comes back as it was, where it was', !!same, car2 ? `${g2.vehicles.list.length} vehicles, the car at ${f1(car2.x)}, ${f1(car2.z)} with ${f1(car2.fuel)} Fuel` : 'the car is gone');
  check('...the held driver is moved off the wheel as any dropped one is, everybody still in it, and it rolls to a stop', c2.away && !c2.state.drive && car2.seats[0] === 0 && c2.state.pass === car2.id && a2.state.pass === car2.id && [c2, a2].every((p) => Math.hypot(p.state.x - car2.x, p.state.z - car2.z) < 1.3), `seats ${car2.seats.join(' ')}`);
  for (let i = 0; i < 20 * SEC && (car2.vx || car2.vz); i++) g2.update();
  const sess = g2.onOpen({ send() {} });
  g2.resume(sess, c2);
  g2.update();
  check('...and whoever comes back finds themselves in their seat of it', !c2.away && c2.state.pass === car2.id && car2.vx === 0 && bodySunk(g2.world, { ...car2 }) < 0.05);
  // ---- somebody leaves for good from a seat
  game.removePlayer(c);
  run1(3);
  check('a driver who leaves the game leaves the seat', car.seats[0] === 0 && !car.seats.includes(c.id));
  // ---- a bigger team: the bridgehead's are put out as it grows
  const n0 = V.starters;
  const more = [];
  for (let i = 0; i < 11; i++) more.push(client(game, `late${i}`));
  game.update();
  const seats = 4 + V.list.filter((e) => e.starter).reduce((s, e) => s + VEHICLES[e.vk].seats.length, 0);
  check('as survivors join on the mainland the bridgehead grows with them: always a seat each', V.starters > n0 && seats >= game.players.size, `${game.players.size} survivors, ${seats} seats at the bridgehead (${V.starters} of its vehicles out)`);
}

// ================================================================ the crossing, and a new run
{
  const game = new Game({ seed, godMode: true, dayLength: 36000, themes: false, log: () => {} });
  const A = client(game, 'Ann');
  game.update();
  const a = A.p();
  const none = game.vehicles.list.length;
  // the car at the camp is fixed and driven off as it always was
  game.supplies = [...game.sup.need];
  game.startEngine(a);
  const stand = game.escape.active;
  game.escape.ready = true;
  game.driveOff(a);
  const crossing = game.phase === PHASE.CROSSING;
  let ticks = 0;
  for (; ticks < 60 * SEC && game.phase === PHASE.CROSSING; ticks++) {
    A.input(0, 0);
    game.update();
  }
  quiet(game);
  const car = game.vehicles.list.find((e) => e.quest);
  check('the island is left as it always was - the camp car fixed, started, driven off, the crossing - with no vehicle on it', none === 0 && stand && crossing && ticks > 30 * SEC, `the crossing took ${f1(ticks / SEC)} s`);
  check("...and on the mainland that car is the team's: where the crossing left it, running", game.act === WORLD.MAINLAND && !!car && car.state === VSTATE.OK && car.fuel > 0);
  const [qx, qz] = [car.x, car.z];
  beside(game, a, car);
  A.input(0, 0);
  game.update();
  A.act(ACT.VEHICLE, VACT.ENTER, car.id);
  for (let i = 0; i < 4 * SEC; i++) {
    A.input(BTN.FWD, 0);
    game.update();
  }
  check('...and is driven off down Route 9', a.state.drive === car.id && Math.hypot(a.state.x - qx, a.state.z - qz) > 15 && speedOf(a.state) > 6, `${f1(speedOf(a.state))} m/s after 4 s`);
  // a late joiner finds it (and a seat)
  const B = client(game, 'Bo');
  game.update();
  check('a late joiner on the mainland finds the car where the team has it, and the bridgehead has a seat for them', !!B.ent(car.id) && game.vehicles.list.some((e) => e.starter));
  // a new run: back on the island, with none
  game.startGame();
  A.input(0, 0);
  game.update();
  check('a new run begins on the island again, with no vehicle, nobody in one and no box left in its world', game.act === WORLD.ISLAND && game.vehicles.list.length === 0 && !a.state.drive && !game.all.some((e) => e.kind === ENT.VEHICLE) && vehicleGrid(game.world).parked.count === 0);
}

// ================================================================ the ways are there
{
  const w = worldFor(seed, WORLD.MAINLAND);
  const cl = clearance(w);
  const t0 = Date.now();
  const car = flood(w, cl, w.start.x, w.start.z, 1.1, VEH.CAR);
  const mop = flood(w, cl, w.start.x, w.start.z, 0.75, VEH.MOPED);
  const foot = flood(w, cl, w.start.x, w.start.z, 0.75, 0);
  const far = w.zones.filter((z) => Math.hypot(z.x - w.start.x, z.z - w.start.z) > 60);
  const short = (fl, z) => {
    const p = fl.path(z.x, z.z);
    return p ? Math.hypot(p[p.length - 1][0] - z.x, p[p.length - 1][1] - z.z) : Infinity;
  };
  const carShort = far.filter((z) => short(car, z) > 30), mopShort = far.filter((z) => short(mop, z) > 20);
  check('every place of the mainland can be driven to from the bridgehead: a car to within a few metres of it, a moped into it', carShort.length === 0 && mopShort.length === 0, `${far.length} places (${Date.now() - t0} ms); the furthest a car stops from the middle of one ${f1(Math.max(...far.map((z) => short(car, z))))} m, a moped ${f1(Math.max(...far.map((z) => short(mop, z))))} m`);
  // the airfield, by each: driven by the physics along the way found, against a survivor sprinting it
  const field = w.zones.reduce((b, z) => (Math.hypot(z.x - w.car.x, z.z - w.car.z) < Math.hypot(b.x - w.car.x, b.z - w.car.z) ? z : b));
  const tf = walk(w, foot.path(field.x, field.z));
  const tc = drive(w, VEH.CAR, car.path(field.x, field.z), 600, cl);
  const tm = drive(w, VEH.MOPED, mop.path(field.x, field.z), 600, cl);
  check('to the airfield and the plane: a car and a moped both get there, in well under the time it takes on foot, on less than a tank', tc.t > 0 && tm.t > 0 && tc.t < tf * 0.75 && tm.t < tf * 0.75 && tc.burnt < VEHICLES[VEH.CAR].tank && tm.burnt < VEHICLES[VEH.MOPED].tank, `${f1(tf)} s on foot, ${f1(tc.t)} s by car (${f1(tc.burnt)} Fuel), ${f1(tm.t)} s by moped (${f1(tm.burnt)} Fuel)`);
}

// ================================================================ a driver on a laggy link
// The real Prediction and Connection against the server with every message LAG ms late each way (+ jitter, which a
// reliable socket turns loss into), as scripts/test-handcar.js does it: the driver gets in, drives a figure with the
// throttle, the brake, the steering and the handbrake, and gets out. Then the dead in its way: what the server alone
// knows of, and how far that moves the driver's view.
function laggy(LAG, JIT, vk) {
  let rs = 777;
  const rnd = () => ((rs = (Math.imul(rs, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  const game = new Game({ seed, godMode: true, dayLength: 36000, themes: false, log: () => {} });
  let now = 0;
  const toClient = [];
  const toServer = [];
  const push = (q, bytes) => q.push([Math.max(now + LAG + rnd() * JIT, q.length ? q[q.length - 1][0] : 0), bytes]);
  const c = { net: { tick: 0, ack: 0 }, self: {}, global: null, ents: new Map(), id: 0, pred: null, rebases: 0, world: null, cols: new Map() };
  // (the client's own copy of the boxes of what stands empty: client/game/vehicles.js `changed`)
  const boxes = (e) => {
    if (e.kind !== ENT.VEHICLE || !c.world) return;
    const q = e.q;
    const empty = !(q[7] | q[8]) && (q[4] & 255) === 0;
    const old = c.cols.get(e.id);
    if (old) vehicleGrid(c.world).parked.remove(old);
    c.cols.delete(e.id);
    if (!empty) return;
    let yaw = (q[3] / 65536) * Math.PI * 2;
    if (yaw > Math.PI) yaw -= Math.PI * 2;
    const col = parkedCollider(e.vk, e.id, q[0] / c.world.posScale, q[1] / c.world.posScale, q[2] / c.world.posScale, yaw);
    vehicleGrid(c.world).parked.add(col);
    c.cols.set(e.id, col);
  };
  const store = { ents: c.ents, onCreate: boxes, onRemove() {}, onUpdate: boxes };
  const handler = new Proxy({}, { get: () => () => {} });
  const session = game.onOpen({ send: (bytes) => push(toClient, bytes.slice()) });
  const conn = new Connection({});
  conn.open = true;
  conn.ws = { readyState: 1, send: (bytes) => push(toServer, bytes.slice()), close() {} };
  const w0 = new Writer(64);
  w0.u8(C2S.JOIN);
  w0.u8(PROTOCOL_VERSION);
  w0.str('laggy');
  game.onMessage(session, w0.bytes().slice());
  const predAt = new Map();
  let jump = 0; // the furthest a rebase moved where the driver is drawn
  const jumps = [];
  const onClientMessage = (buf) => {
    const r = new Reader(buf);
    const t = r.u8();
    if (t === S2C.WELCOME) {
      c.id = r.u16();
      c.pred = new Prediction(createWorld(r.u32()));
    } else if (t === S2C.WORLD_RESET) {
      const sd = r.u32();
      c.world = worldFor(sd, r.u8());
      vehicleGrid(c.world);
      questCar(c.world);
      c.pred.setWorld(c.world);
      for (const e of c.ents.values()) boxes(e);
    } else if (t === S2C.SNAPSHOT) {
      const flags = readHeader(r, c.net);
      if (flags & SNAP.GLOBAL) c.global = readGlobal(r, c.global);
      const sync = readSelf(r, c.self, flags);
      readEntities(r, store, c.net.tick, flags);
      if (sync) {
        c.rebases++;
        const [x0, z0] = [c.pred.state.x, c.pred.state.z];
        c.pred.reconcile(c.net.ack, c.self);
        const d = Math.hypot(c.pred.state.x - x0, c.pred.state.z - z0);
        if (c.measure && d > 1e-6) jumps.push(d);
        if (c.measure) jump = Math.max(jump, d);
        predAt.clear();
      } else c.pred.confirm(c.net.ack);
      readEvents(r, handler, flags, c.ents);
      if (r.left) throw new Error(`${r.left} trailing bytes in a snapshot`);
    }
  };
  const P = VEHICLES[vk];
  const WHEN = { map: SEC, board: 5 * SEC, drive: 6 * SEC, off: 30 * SEC, dead: 36 * SEC, end: 46 * SEC };
  const rtt = Math.ceil(((2 * LAG + JIT) / 1000) * SEC);
  const window = 2 * rtt + 5;
  let frame = 0, checks = 0, late = 0, lateRebases = 0, top = 0, veh = null, drove = 0, struck = 0, worstErr = 0;
  let spot = null;
  for (let tick = 0; tick < WHEN.end; tick++) {
    const p = game.players.get(c.id);
    for (let fr = 0; fr < 60 / SEC; fr++) {
      now = (frame * 1000) / 60;
      while (toClient.length && toClient[0][0] <= now) onClientMessage(toClient.shift()[1]);
      while (toServer.length && toServer[0][0] <= now) game.onMessage(session, toServer.shift()[1]);
      if (c.pred && c.pred.hasServerState) {
        const ps = c.pred.state;
        const t = tick / SEC;
        let buttons = 0;
        if (ps.drive) {
          // a figure: off, a long right-hander, hard on the brakes, a left with the handbrake, on again, the horn
          const u = t - WHEN.drive / SEC;
          if (tick >= WHEN.dead) buttons = BTN.FWD;
          else buttons = u < 5 ? BTN.FWD : u < 9 ? BTN.FWD | BTN.RIGHT : u < 10.5 ? BTN.BACK : u < 13 ? BTN.FWD | BTN.LEFT : u < 14 ? BTN.LEFT | BTN.JUMP : u < 19 ? BTN.FWD | (Math.sin(u * 3) > 0 ? BTN.RIGHT : BTN.LEFT) | BTN.HORN : u < 22 ? BTN.BACK : 0;
        }
        const yaw = Math.sin(frame / 40) * 0.8;
        const before = c.pred.seq;
        c.pred.step(1 / 60, buttons, yaw, 0, () => {});
        if (c.pred.seq !== before) predAt.set(c.pred.seq, copyPlayerState(createPlayerState(), c.pred.state));
        for (let out; (out = c.pred.takeOutbox(1 / 60)); ) conn.sendInput(c.net.tick - 2, 0, out, c.pred.hash(out));
        if (ps.drive) top = Math.max(top, speedOf(ps));
      }
      frame++;
    }
    if (!p) {
      game.update();
      continue;
    }
    if (tick === WHEN.map) {
      game.debugCommand(p, ['map2']);
      quiet(game);
      spot = openGround(game.world);
      veh = game.vehicles.make(vk, spot[0], spot[1], 0, { state: VSTATE.OK, need: 0, fuel: P.tank, hp: P.hp });
      beside(game, p, veh);
    }
    if (tick === WHEN.board) conn.action(ACT.VEHICLE, VACT.ENTER, veh.id);
    if (tick === WHEN.off) conn.action(ACT.VEHICLE, VACT.EXIT, 0);
    if (tick === WHEN.off + 3 * SEC) conn.action(ACT.VEHICLE, VACT.ENTER, veh.id);
    if (tick === WHEN.dead) {
      // the dead in its way, well ahead: the server's business alone
      c.measure = true;
      const s = p.state;
      const fx = -Math.sin(s.dyaw), fz = -Math.cos(s.dyaw);
      for (let k = 0; k < 3; k++) {
        const z = game.zm.spawn(ZTYPE.WALKER, s.x + fx * (30 + k * 14), s.z + fz * (30 + k * 14), { horde: true });
        z.x = s.x + fx * (30 + k * 14);
        z.z = s.z + fz * (30 + k * 14);
        z.y = groundAt(game.world, z.x, z.z, 200, 0.2, false);
        z.vehT = 0;
      }
    }
    const rebasesBefore = c.rebases;
    const seqBefore = p.lastSeq;
    const hp0 = veh ? veh.hp : 0;
    game.update();
    if (veh && veh.hp < hp0 && tick >= WHEN.dead) struck++;
    if (tick >= WHEN.dead) for (const z of game.zombies) z.target = 0; // (they stand where they were put)
    const near = (t) => tick >= t && tick <= t + window;
    const settled = tick > WHEN.drive + window && tick < WHEN.dead && !near(WHEN.off) && !near(WHEN.off + 3 * SEC);
    if (settled && c.rebases !== rebasesBefore) lateRebases++;
    const mine = p.lastSeq !== seqBefore && predAt.get(p.lastSeq);
    if (mine) {
      const s = p.state;
      const err = Math.max(Math.abs(mine.x - s.x), Math.abs(mine.y - s.y), Math.abs(mine.z - s.z), Math.abs(mine.vx - s.vx), Math.abs(mine.vz - s.vz), Math.abs(mine.dyaw - s.dyaw), Math.abs(mine.dsteer - s.dsteer), Math.abs(mine.dfuel - s.dfuel), Math.abs(mine.drive - s.drive));
      if (settled) {
        checks++;
        if (s.drive) drove++;
        worstErr = Math.max(worstErr, err);
        if (err > 1e-9) {
          late++;
          if (process.env.VERBOSE && late < 4) console.log(`  tick ${tick} seq ${p.lastSeq}: server`, JSON.stringify({ x: s.x, z: s.z, vx: s.vx, dyaw: s.dyaw, st: s.dsteer, f: s.dfuel, d: s.drive }), 'client', JSON.stringify({ x: mine.x, z: mine.z, vx: mine.vx, dyaw: mine.dyaw, st: mine.dsteer, f: mine.dfuel, d: mine.drive }));
        }
      }
    }
    for (const k of predAt.keys()) if (((p.lastSeq - k) & 0xffff) < 0x8000) predAt.delete(k);
  }
  const ok = late === 0 && lateRebases === 0 && drove > 12 * SEC && top > P.top * 0.6;
  check(`a ${P.name} driven at ${LAG} ms each way (+${JIT} jitter): the prediction of every command is the server's result, and it only rebases getting in and out`, ok, `${checks} commands checked (${drove} at the wheel), ${late} disagreed (worst ${worstErr.toExponential(1)}), ${lateRebases} rebases while driving of ${c.rebases} in all, top ${f1(top)} m/s`);
  const fine = vk === VEH.CAR ? struck >= 1 && jump < 2.5 : true;
  check(`...and running the dead down, which only the server knows of, moves the driver's view by no more than a body's length`, fine, `${struck} struck; the corrections ${jumps.length ? jumps.map((j) => j.toFixed(2)).join(', ') : 'none'} m (worst ${jump.toFixed(2)} m)`);
  return { LAG, JIT, jump, jumps, late, lateRebases };
}
laggy(0, 0, VEH.MOPED);
laggy(50, 20, VEH.CAR);
laggy(100, 40, VEH.CAR);
laggy(200, 120, VEH.CAR);
laggy(100, 40, VEH.MOPED);
laggy(100, 40, VEH.BIKE);

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(' | ')}` : '\nall vehicle checks passed');
process.exit(fails.length ? 1 : 0);
