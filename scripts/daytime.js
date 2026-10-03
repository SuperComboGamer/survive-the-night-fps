// How long does a day have to be? node scripts/daytime.js [maps=40] [--floor] [--rows]
// Walks the real player simulation (stamina, collisions, terrain) over the zombie nav grid, on that many random
// valleys: from the spawn to the nearest named place, round everything there is to search in it (nearest first,
// each container a SEARCH_TIME hold), on to the next nearest place and round that one. Once with sprint held the
// whole way (it runs out, the survivor walks, it comes back) and once without. The survivor knows where every
// container is, takes the shortest way and meets nobody: the floor under what a person needs, not the figure.
//   --floor   also pick up the loose loot lying about each place
//   --rows    a line per map: the two places, metres and seconds
// DAY_LENGTH (shared/constants.js), the shortest a day gets, was set from this.
import { createWorld } from '../shared/world.js';
import { Nav } from '../server/nav.js';
import { createPlayerState, simulatePlayer } from '../shared/playersim.js';
import { BTN, CMD_DT, MAP_HALF, INTERACT_REACH, SEARCH_TIME, WALK_SPEED, DAY_LENGTH, dayLength, DUSK_WARNING } from '../shared/constants.js';
import { ZONE, ZONE_NAMES } from '../shared/defs.js';

const args = process.argv.slice(2);
const MAPS = +(args.find((a) => !a.startsWith('--')) || 40);
const FLOOR = args.includes('--floor');
const ROWS = args.includes('--rows');
const SIZE = MAP_HALF * 2; // the nav grid: 1 m cells
const NDI = [1, -1, 0, 0, 1, 1, -1, -1]; // (neighbour order of Nav.edge)
const NDJ = [0, 0, 1, -1, 1, -1, 1, -1];
const NCOST = [10, 10, 10, 10, 14, 14, 14, 14];
const INF = 0x7fffffff;
const AIM_TIME = 0.4; // turning to a container and finding its prompt, on top of the hold
const REACH = INTERACT_REACH * 0.8; // how close the survivor walks up to one

const dist = new Int32Array(SIZE * SIZE);
const parent = new Int32Array(SIZE * SIZE);
const cellOf = (x, z) => Math.floor(z + MAP_HALF) * SIZE + Math.floor(x + MAP_HALF);
const cx = (k) => (k % SIZE) - MAP_HALF + 0.5;
const cz = (k) => Math.floor(k / SIZE) - MAP_HALF + 0.5;

// nearest walkable cell to (x,z): a container's own cell is inside its prop
function openCell(nav, x, z, reach = 4) {
  const k0 = cellOf(x, z);
  if (!nav.blocked[k0]) return k0;
  const i0 = k0 % SIZE;
  const j0 = Math.floor(k0 / SIZE);
  let best = -1;
  let bd = Infinity;
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      const i = i0 + di;
      const j = j0 + dj;
      if (i < 0 || j < 0 || i >= SIZE || j >= SIZE || nav.blocked[j * SIZE + i]) continue;
      const d = Math.hypot(cx(j * SIZE + i) - x, cz(j * SIZE + i) - z);
      if (d < bd) {
        bd = d;
        best = j * SIZE + i;
      }
    }
  }
  return best;
}

// Dijkstra over the whole nav grid from one cell (the steps Nav._solve allows), into dist / parent.
// stop: cells that end the search once every one of them has been reached
function solve(nav, from, stop) {
  dist.fill(INF);
  parent.fill(-1);
  const heap = []; // distance * 2^19 + cell
  const push = (v) => {
    let i = heap.push(v) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p] <= heap[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1;
        let m = i;
        if (l < heap.length && heap[l] < heap[m]) m = l;
        if (l + 1 < heap.length && heap[l + 1] < heap[m]) m = l + 1;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const left = stop ? new Set(stop) : null;
  dist[from] = 0;
  push(from);
  while (heap.length) {
    const v = pop();
    const k = v % 524288;
    const d = (v - k) / 524288;
    if (d !== dist[k]) continue;
    if (left && left.delete(k) && !left.size) break;
    const i = k % SIZE;
    const j = (k - i) / SIZE;
    for (let n = 0; n < 8; n++) {
      const ni = i + NDI[n];
      const nj = j + NDJ[n];
      if (ni < 0 || nj < 0 || ni >= SIZE || nj >= SIZE) continue;
      const q = nj * SIZE + ni;
      if (nav.blocked[q] || nav.edge[k] & (1 << n)) continue;
      if (n >= 4 && (nav.blocked[k + NDI[n]] || nav.blocked[k + NDJ[n] * SIZE])) continue; // no corner cutting
      if (d + NCOST[n] < dist[q]) {
        dist[q] = d + NCOST[n];
        parent[q] = k;
        push(dist[q] * 524288 + q);
      }
    }
  }
}
const pathTo = (k) => {
  const p = [];
  for (; k >= 0; k = parent[k]) p.push(k);
  return p.reverse();
};

// Walk the survivor along a path of cells until it is within `reach` of (tx,tz) -> { t: seconds, m: metres,
// stuck: the follower gave up (an upper floor, a tight doorway) and the rest was charged at walking pace }
function walk(world, nav, s, path, tx, tz, reach, sprint) {
  const cmd = { buttons: 0, yaw: 0, pitch: 0, slot: 255 };
  let pi = 0;
  let t = 0;
  let m = 0;
  let [lastX, lastZ, stallT, jam] = [s.x, s.z, 0, 0];
  while (t < 600) {
    if (Math.hypot(tx - s.x, tz - s.z) <= reach) return { t, m, stuck: false };
    // progress: the furthest of the next few path cells the survivor is already beside
    for (let k = Math.min(path.length - 1, pi + 6); k > pi; k--) {
      if (Math.hypot(cx(path[k]) - s.x, cz(path[k]) - s.z) < 1.3) {
        pi = k;
        break;
      }
    }
    if (pi >= path.length - 1 && Math.hypot(cx(path[pi]) - s.x, cz(path[pi]) - s.z) < 0.6) return { t, m, stuck: false };
    // aim a few cells ahead, never through a wall (a doorway is taken square on); jammed: the very next cell, hopping
    let ahead = path[Math.min(path.length - 1, pi + 1)];
    for (let k = Math.min(path.length - 1, pi + 4); !jam && k > pi + 1; k--) {
      if (!nav.segClear(s.x, s.z, cx(path[k]), cz(path[k]))) continue;
      ahead = path[k];
      break;
    }
    cmd.yaw = Math.atan2(s.x - cx(ahead), s.z - cz(ahead));
    cmd.buttons = BTN.FWD | (sprint ? BTN.SPRINT : 0) | (jam && Math.floor(t * 2) % 2 ? BTN.JUMP : 0);
    const [ox, oz] = [s.x, s.z];
    simulatePlayer(s, cmd, world, null, CMD_DT);
    m += Math.hypot(s.x - ox, s.z - oz);
    t += CMD_DT;
    stallT += CMD_DT;
    if (stallT < 1) continue;
    const moved = Math.hypot(s.x - lastX, s.z - lastZ);
    [lastX, lastZ, stallT] = [s.x, s.z, 0];
    if (moved >= 1) jam = 0;
    else if (++jam > 4) break;
  }
  const end = path[path.length - 1];
  const len = (path.length - 1) * 1.1;
  [s.x, s.z, s.vx, s.vz] = [cx(end), cz(end), 0, 0];
  s.y = world.heightAt(s.x, s.z);
  return { t: len / WALK_SPEED, m: len, stuck: true };
}

const rows = [];
let legs = 0;
let stuck = 0;
for (let n = 0; n < MAPS; n++) {
  const seed = 1 + n * 7919;
  const world = createWorld(seed);
  const nav = new Nav(world);
  // what there is to search inside each named place (the scattered roadside sites borrow a place's id for its
  // loot table: those are not it)
  const stops = new Map(); // zone id -> [{ x, z, cell, hold, reach }]
  const add = (c, hold, reach) => {
    const zid = world.zoneAt(c.x, c.z);
    const cell = zid === ZONE.CAMP || zid === ZONE.FOREST ? -1 : openCell(nav, c.x, c.z);
    if (cell < 0) return;
    if (!stops.has(zid)) stops.set(zid, []);
    stops.get(zid).push({ x: c.x, z: c.z, cell, hold, reach });
  };
  for (const c of world.containers) add(c, AIM_TIME + SEARCH_TIME, REACH);
  if (FLOOR) for (const c of world.lootSpawns) add(c, 0.3, 1.5); // a glance and [E]
  for (const sprint of [true, false]) {
    const s = createPlayerState();
    const sp = world.spawnPoints[0];
    [s.x, s.y, s.z] = [sp.x, world.heightAt(sp.x, sp.z), sp.z];
    const row = { seed, sprint, places: [] };
    const seen = new Set();
    for (let hop = 0; hop < 2; hop++) {
      // the nearest place not yet visited, by the walk to the nearest thing in it
      solve(nav, openCell(nav, s.x, s.z), null);
      let best = null;
      for (const [zid, list] of stops) {
        if (seen.has(zid)) continue;
        for (const c of list) if (dist[c.cell] < (best?.d ?? INF)) best = { zid, c, d: dist[c.cell] };
      }
      seen.add(best.zid);
      const trip = walk(world, nav, s, pathTo(best.c.cell), best.c.x, best.c.z, best.c.reach, sprint);
      legs++;
      if (trip.stuck) stuck++;
      const todo = [...stops.get(best.zid)];
      const loot = []; // seconds since arriving at which each one was searched
      let lt = 0;
      while (todo.length) {
        solve(nav, openCell(nav, s.x, s.z), todo.map((c) => c.cell));
        let bi = 0;
        for (let i = 1; i < todo.length; i++) if (dist[todo[i].cell] < dist[todo[bi].cell]) bi = i;
        const c = todo.splice(bi, 1)[0];
        if (dist[c.cell] === INF) continue;
        const w = walk(world, nav, s, pathTo(c.cell), c.x, c.z, c.reach, sprint);
        legs++;
        if (w.stuck) stuck++;
        lt += w.t + c.hold;
        // standing still for the hold: the stamina comes back
        const idle = { buttons: 0, yaw: s.yaw, pitch: 0, slot: 255 };
        for (let k = 0; k < c.hold / CMD_DT; k++) simulatePlayer(s, idle, world, null, CMD_DT);
        loot.push(lt);
      }
      row.places.push({ name: ZONE_NAMES[best.zid], t: trip.t, m: trip.m, n: loot.length, all: loot.at(-1) ?? 0, half: loot[Math.ceil(loot.length / 2) - 1] ?? 0 });
    }
    rows.push(row);
  }
}

const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
const stat = (label, a) => console.log(`  ${label.padEnd(42)} median ${pct(a, 0.5).toFixed(0).padStart(4)}   9 in 10 under ${pct(a, 0.9).toFixed(0).padStart(4)}   worst ${Math.max(...a).toFixed(0).padStart(4)}`);
for (const sprint of [true, false]) {
  const R = rows.filter((r) => r.sprint === sprint);
  const [a, b] = [0, 1].map((i) => R.map((r) => r.places[i]));
  console.log(`\n${sprint ? 'Sprint held' : 'Walking'}, ${R.length} maps${FLOOR ? ', floor loot picked up too' : ''} (seconds unless it says otherwise)`);
  stat('spawn -> nearest place (m)', a.map((p) => p.m));
  stat('spawn -> nearest place', a.map((p) => p.t));
  stat('...things to search in it (count)', a.map((p) => p.n));
  stat('...half of them searched', a.map((p) => p.half));
  stat('...all of them searched', a.map((p) => p.all));
  stat('on to the next nearest place (m)', b.map((p) => p.m));
  stat('on to the next nearest place', b.map((p) => p.t));
  stat('...things to search in it (count)', b.map((p) => p.n));
  stat('...half of them searched', b.map((p) => p.half));
  stat('...all of them searched', b.map((p) => p.all));
  stat('both trips', R.map((r) => r.places[0].t + r.places[1].t));
  stat('both trips, half of each place', R.map((r) => r.places[0].t + r.places[0].half + r.places[1].t + r.places[1].half));
  stat('both trips, all of both places', R.map((r) => r.places[0].t + r.places[0].all + r.places[1].t + r.places[1].all));
}
console.log(`\n${legs} legs walked, ${stuck} the follower gave up on (charged at walking pace)`);
console.log(`Days 1-8 are ${[1, 2, 3, 4, 5, 6, 7, 8].map(dayLength).join(', ')} s, then ${DAY_LENGTH} s: the horn sounds ${DUSK_WARNING} s before the end, so the shortest leaves ${DAY_LENGTH - DUSK_WARNING} s until it.`);
if (ROWS) {
  console.log();
  for (const r of rows.filter((r) => r.sprint)) console.log(String(r.seed).padStart(7), r.places.map((p) => `${p.name}: ${p.m.toFixed(0)} m in ${p.t.toFixed(0)} s, ${p.n} searched in ${p.all.toFixed(0)} s`).join('  ->  '));
}
