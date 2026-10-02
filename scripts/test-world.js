// World layout test: the hand-authored places, as a survivor meets them.
// A place is laid out once in shared/world.js and stamped onto every map that has it, so a wall drawn across a
// doorway or a street drawn through a house is there on every one of them. This generates a few valleys and checks,
// for every named place on them:
//   - each doorway can be walked through, both ways, by the real player simulation
//   - each container, floor-loot point and supply spot can be used from somewhere a survivor can walk to from the
//     place's front gate, by the server's own rules (within reach, a clear line from the eye)
//   - none of them is inside something solid, where it can be taken but not seen
//   - no road runs into a building
// Roadside and woodland sites are not checked: they are scattered at random, this is about the authored layouts.
// usage: node scripts/test-world.js [seed ...]
import { createWorld } from '../shared/world.js';
import { PLACES, gatePoint } from '../shared/layout.js';
import { ZONE, ZONE_NAMES, CONT_DEFS } from '../shared/defs.js';
import { PROPS } from '../shared/props.js';
import { COL, footprintContains, pushCircle, canReach, groundAt } from '../shared/collision.js';
import { simulatePlayer, createPlayerState } from '../shared/playersim.js';
import { BTN, CMD_RATE, MAP_HALF, GRID_STEP, PLAYER_RADIUS, PLAYER_HEIGHT, EYE_HEIGHT, STEP_HEIGHT, WATER_LEVEL } from '../shared/constants.js';

// Between them these four valleys have every place twice or more (the test fails if one is missing).
const SEEDS = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 4, 8, 9];

// Known failures: what the checks below find wrong today that is being fixed somewhere else. A failure listed here
// is printed but does not fail the test. An entry is a place, a check and the spot in the place's own frame.
const KNOWN = [
  // Blackwater Dock: the pier's deck stops 2 m short of the T at its end, so nobody can get to the crate and the
  // floor loot out there. Fixed by the pull request from branch fix-pier-deck-and-drops: delete these two entries
  // once that is merged (this test says so when they no longer fail).
  { place: ZONE.DOCK, check: 'reach', at: [-0.6, 44.5], why: 'the pier deck stops short of its end (fixed on branch fix-pier-deck-and-drops)' },
  { place: ZONE.DOCK, check: 'reach', at: [-3.5, 45.5], why: 'the pier deck stops short of its end (fixed on branch fix-pier-deck-and-drops)' },
];

const CELL = 0.2; // walk grid (m): finer than the 0.3 m of play a body has in the narrowest doorway (1 m wide)
const GROUND_R = PLAYER_RADIUS * 0.7; // simulatePlayer feels for the ground under this much of the body
// how far a survivor reaches: flat distance (the server's Game.holdBegin / Game.interact) and from the eye to the
// point aimed at (the pick ray in the client's Game.updateLookTarget)
const REACH_CACHE = { flat: 2.8, ray: 3.15 };
const REACH_ITEM = { flat: 3.6, ray: 3.3 };
const ITEM_PICK_Y = 0.15; // an item is aimed at this far above its base (Game.canReachEnt)

const _push = { x: 0, z: 0, nx: 0, nz: 0 };
const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
// the cells within the longest reach of one, nearest first: [di, dj, metres]
const NEAR = [];
const SPAN = Math.ceil(REACH_ITEM.flat / CELL) + 1;
for (let dj = -SPAN; dj <= SPAN; dj++) for (let di = -SPAN; di <= SPAN; di++) if (Math.hypot(di, dj) <= SPAN) NEAR.push([di, dj, Math.hypot(di, dj) * CELL]);
NEAR.sort((a, b) => a[2] - b[2]);

// Everywhere a survivor can walk to from (sx, sz), on a grid laid in the place's own frame (walls and doorways run
// along it). A cell is the body standing at its centre, and stepping into the next one follows simulatePlayer:
// resolveBody stops it at anything more than a step higher than its feet, groundAt puts its feet on floors and
// decks, and deep water is closed unless something carries it across.
// (The grids are scratch shared by every place: what this returns is good until the next call.)
let cap = 0;
let slow, seen, feet, askY, askG, queue;
function walkable(world, zn, half, sx, sz) {
  const cos = Math.cos(zn.ry);
  const sin = Math.sin(zn.ry);
  const n = Math.ceil((half * 2) / CELL);
  const at = (i) => -half + (i + 0.5) * CELL;
  const wx = (i, j) => zn.x + cos * at(i) + sin * at(j);
  const wz = (i, j) => zn.z - sin * at(i) + cos * at(j);
  const cell = (x, z) => [Math.floor((cos * (x - zn.x) - sin * (z - zn.z) + half) / CELL), Math.floor((sin * (x - zn.x) + cos * (z - zn.z) + half) / CELL)];
  if (n * n > cap) {
    cap = n * n;
    slow = new Uint8Array(cap);
    seen = new Uint8Array(cap);
    feet = new Float64Array(cap);
    askY = new Float64Array(cap);
    askG = new Float64Array(cap);
    queue = new Int32Array(cap);
  }
  slow.fill(0, 0, n * n);
  seen.fill(0, 0, n * n);
  feet.fill(NaN, 0, n * n);
  askY.fill(NaN, 0, n * n);
  // the colliders a body touches in each cell. Most cells are open ground: slow marks the ones that need a look
  const touch = new Map();
  for (const c of world.staticGrid.query(zn.x, zn.z, half * Math.SQRT2, [])) {
    if (c.flags & COL.NOBLOCK) continue;
    const [ci, cj] = cell(c.x, c.z);
    const r = Math.ceil((c.r + PLAYER_RADIUS) / CELL);
    for (let j = Math.max(0, cj - r); j <= Math.min(n - 1, cj + r); j++) {
      for (let i = Math.max(0, ci - r); i <= Math.min(n - 1, ci + r); i++) {
        if (!pushCircle(c, wx(i, j), wz(i, j), PLAYER_RADIUS, _push)) continue;
        const k = j * n + i;
        if (slow[k]) touch.get(k).push(c);
        else touch.set(k, [c]);
        slow[k] = 1;
      }
    }
  }
  // ...and so do the ones that may be over deep water. The terrain is flat between the vertices of its grid, so
  // those are the cells within a grid square's diagonal of a vertex that is under it
  const R = half * Math.SQRT2 + GRID_STEP;
  const span = Math.ceil((GRID_STEP * Math.SQRT2) / CELL);
  for (let x = -MAP_HALF + Math.floor((zn.x - R + MAP_HALF) / GRID_STEP) * GRID_STEP; x <= zn.x + R; x += GRID_STEP) {
    for (let z = -MAP_HALF + Math.floor((zn.z - R + MAP_HALF) / GRID_STEP) * GRID_STEP; z <= zn.z + R; z += GRID_STEP) {
      if (!world.isDeepWater(x, z)) continue;
      const [ci, cj] = cell(x, z);
      for (let j = Math.max(0, cj - span); j <= Math.min(n - 1, cj + span); j++) slow.fill(1, j * n + Math.max(0, ci - span), j * n + Math.min(n - 1, ci + span) + 1);
    }
  }
  // the height a survivor stands at in a cell they reached (open ground: looked up when asked for)
  const stand = (k) => (feet[k] === feet[k] ? feet[k] : (feet[k] = world.heightAt(wx(k % n, (k / n) | 0), wz(k % n, (k / n) | 0))));
  // the height a body walking in at height y stands at in cell (i, j); NaN if it cannot get in
  const enter = (i, j, y) => {
    const k = j * n + i;
    if (askY[k] === y) return askG[k]; // (across a floor every neighbour asks the same question)
    const x = wx(i, j);
    const z = wz(i, j);
    const h = world.heightAt(x, z);
    let g = h;
    for (const c of touch.get(k) || []) {
      if (c.y1 > y + STEP_HEIGHT && c.y0 < y + PLAYER_HEIGHT) g = NaN;
      else if (!(c.flags & COL.TREE) && c.y1 > g && c.y1 <= y + STEP_HEIGHT + 0.02 && footprintContains(c, x, z, GROUND_R)) g = c.y1;
    }
    if (h < WATER_LEVEL && g <= h + 0.01 && world.isDeepWater(x, z)) g = NaN;
    askY[k] = y;
    return (askG[k] = g);
  };
  // start at the free cell nearest (sx, sz)
  let tail = 0;
  const [si, sj] = cell(sx, sz);
  for (const [di, dj] of NEAR) {
    const i = si + di;
    const j = sj + dj;
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const g = enter(i, j, world.heightAt(wx(i, j), wz(i, j)));
    if (g !== g) continue;
    feet[j * n + i] = g;
    seen[j * n + i] = 1;
    queue[tail++] = j * n + i;
    break;
  }
  const open = [false, false, false, false];
  for (let head = 0; head < tail; head++) {
    const k = queue[head];
    const i = k % n;
    const j = (k / n) | 0;
    for (let m = 0; m < 8; m++) {
      const ni = i + DI[m];
      const nj = j + DJ[m];
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) {
        if (m < 4) open[m] = false;
        continue;
      }
      const nk = nj * n + ni;
      // the four straight steps first: a diagonal one needs the cells either side of it free too (no cutting corners)
      if (m >= 4 && (seen[nk] || !open[DI[m] > 0 ? 0 : 1] || !open[DJ[m] > 0 ? 2 : 3])) continue;
      let ok = true;
      if (slow[nk]) {
        const g = enter(ni, nj, stand(k));
        ok = g === g;
        if (ok && !seen[nk]) feet[nk] = g;
      }
      if (m < 4) open[m] = ok;
      if (!ok || seen[nk]) continue;
      seen[nk] = 1;
      queue[tail++] = nk;
    }
  }
  return { n, seen, stand, wx, wz, cell };
}

// Can a survivor use the thing at (t.x, pickY, t.z) from somewhere they can walk to? The server's rules: within
// reach, and a line from the eye that no wall cuts (canReach).
function usable(world, grid, t, pickY, reach) {
  const [ci, cj] = grid.cell(t.x, t.z);
  for (const [di, dj, d] of NEAR) {
    if (d > reach.flat + CELL) break;
    const i = ci + di;
    const j = cj + dj;
    if (i < 0 || j < 0 || i >= grid.n || j >= grid.n || !grid.seen[j * grid.n + i]) continue;
    const x = grid.wx(i, j);
    const z = grid.wz(i, j);
    const eye = grid.stand(j * grid.n + i) + EYE_HEIGHT;
    const flat = Math.hypot(t.x - x, t.z - z);
    if (flat > reach.flat || Math.hypot(flat, pickY - eye) > reach.ray || Math.abs(t.y - eye) > 3) continue;
    if (canReach(world, x, eye, z, t.x, pickY, t.z, eye)) return true;
  }
  return false;
}

// the solid things a point is inside
function solidsAt(world, x, y, z) {
  return world.staticGrid.query(x, z, 0.1, []).filter((c) => !(c.flags & COL.NOBLOCK) && y > c.y0 && y < c.y1 && footprintContains(c, x, z));
}

// The prop a collider belongs to. Colliders carry no owner: matched by where world.js puts a prop's boxes and cylinders
function propOf(world, col) {
  for (const p of world.props) {
    const def = PROPS[p.type];
    if (!def || Math.hypot(p.x - col.x, p.z - col.z) > 8) continue;
    const c = Math.cos(p.ry);
    const s = Math.sin(p.ry);
    for (const [lx, lz] of [...(def.boxes || []).map((b) => [b[0], b[2]]), ...(def.cyls || [])]) {
      if (Math.hypot(p.x + c * lx + s * lz - col.x, p.z - s * lx + c * lz - col.z) < 1e-6) return p;
    }
  }
  return null;
}
const solidName = (world, col) => propOf(world, col)?.type.replace(/_/g, ' ') ?? (col.flags & COL.TREE ? 'tree' : 'wall');

// Walks a body through a doorway with simulatePlayer, from a metre on one side (dir 1 / -1) towards a metre on the
// other. True once all of it is past the wall.
function walksThrough(world, o, dir) {
  const nx = Math.sin(o.ry) * dir; // across the wall
  const nz = Math.cos(o.ry) * dir;
  const s = createPlayerState();
  s.x = o.x - nx;
  s.z = o.z - nz;
  s.y = groundAt(world, s.x, s.z, o.y, GROUND_R);
  s.onGround = 1;
  for (let i = 0; i < CMD_RATE * 2; i++) {
    if ((s.x - o.x) * nx + (s.z - o.z) * nz > 0.6) return true;
    simulatePlayer(s, { seq: i, buttons: BTN.FWD, yaw: Math.atan2(s.x - o.x - nx, s.z - o.z - nz), pitch: 0, slot: 255 }, world, null);
  }
  return false;
}

// ---------------------------------------------------------------- run
const t0 = performance.now();
const found = new Map(); // failures by place, check and spot: the same authored mistake is one entry however many maps have it
const mapsWith = {}; // place -> how many of the maps have it
const counts = { door: 0, reach: 0, solid: 0, road: 0 };
const round = (v) => Math.round(v * 10) / 10 + 0;

for (const seed of SEEDS) {
  const world = createWorld(seed);
  for (const zn of world.zones) {
    mapsWith[zn.id] = (mapsWith[zn.id] || 0) + 1;
    const cos = Math.cos(zn.ry);
    const sin = Math.sin(zn.ry);
    const fail = (check, x, z, text) => {
      const at = [cos * (x - zn.x) - sin * (z - zn.z), sin * (x - zn.x) + cos * (z - zn.z)];
      const key = `${zn.id} ${check} ${round(at[0])} ${round(at[1])}`;
      const f = found.get(key) || { place: zn.id, check, at, text, seeds: [], where: `seed ${seed}: /tp ${x.toFixed(1)} ${z.toFixed(1)}` };
      f.seeds.push(seed);
      found.set(key, f);
    };

    // What the place holds: things carry the place they belong to. A few places reach well past their levelled
    // yard (the pier, the checkpoint's traffic queue, the farm's field).
    const mine = (o) => o.zone === zn.id && Math.hypot(o.x - zn.x, o.z - zn.z) < zn.flat + 32;
    const containers = world.containers.filter(mine);
    const loot = world.lootSpawns.filter(mine);
    const spots = world.partSpots.filter(mine);
    const doors = world.openings.filter((o) => Math.hypot(o.x - zn.x, o.z - zn.z) < zn.flat + 6);

    // ---- doorways
    for (const o of doors) {
      counts.door++;
      const stuck = [1, -1].filter((dir) => !walksThrough(world, o, dir));
      if (stuck.length) fail('door', o.x, o.z, `a ${o.w} m doorway cannot be walked through${stuck.length === 1 ? ' from one side' : ''}`);
    }

    // ---- containers, floor loot, supply spots
    let reachOut = zn.flat;
    for (const o of [...containers, ...loot, ...spots]) reachOut = Math.max(reachOut, Math.hypot(o.x - zn.x, o.z - zn.z));
    const grid = walkable(world, zn, reachOut + 8, ...gatePoint(zn, 'f'));
    for (const c of containers) {
      counts.reach++;
      const name = CONT_DEFS[c.ctype].name.toLowerCase();
      if (!usable(world, grid, c, c.y, REACH_CACHE)) fail('reach', c.x, c.z, `a ${name} cannot be reached on foot`);
      // (a container's point is inside its own prop, the fridge or the locker: that is the thing a survivor aims at)
      const inside = solidsAt(world, c.x, c.y, c.z).filter((col) => {
        const p = propOf(world, col);
        return !p || Math.hypot(p.x - c.x, p.z - c.z) > 1e-6;
      });
      counts.solid++;
      if (inside.length) fail('solid', c.x, c.z, `a ${name} is inside a ${solidName(world, inside[0])}`);
    }
    for (const [list, name] of [[loot, 'floor loot'], [spots, 'a supply spot']]) {
      for (const o of list) {
        counts.reach++;
        if (!usable(world, grid, o, o.y + ITEM_PICK_Y, REACH_ITEM)) fail('reach', o.x, o.z, `${name} cannot be reached on foot`);
        const inside = solidsAt(world, o.x, o.y + ITEM_PICK_Y, o.z);
        counts.solid++;
        if (inside.length) fail('solid', o.x, o.z, `${name} is inside a ${solidName(world, inside[0])}`);
      }
    }

    // ---- roads against buildings
    // A body walked down the middle of every road nearby must not touch the upright pieces of what the place built
    // (walls, posts, machines: world.parts; props are not in it).
    const R = zn.flat + 20;
    const walls = world.parts.filter((p) => (p.shape === 'box' || p.shape === 'cyl') && !p.rx && !p.rz && p.sy >= 1.5 && p.y - p.sy / 2 < zn.h + 0.5 && Math.hypot(p.x - zn.x, p.z - zn.z) < R);
    let hit = []; // [piece, distance from the centre line]
    for (const p of walls) {
      counts.road++;
      const c = Math.cos(p.ry);
      const s = Math.sin(p.ry);
      const far = Math.hypot(p.sx, p.shape === 'box' ? p.sz : 0) / 2 + PLAYER_RADIUS;
      let near = Infinity;
      for (const road of world.roads) {
        const pts = road.pts;
        for (let i = 0; i < pts.length / 2 - 1; i++) {
          const ex = pts[i * 2 + 2] - pts[i * 2];
          const ez = pts[i * 2 + 3] - pts[i * 2 + 1];
          const len = Math.hypot(ex, ez);
          if (!len || Math.hypot(pts[i * 2] - p.x, pts[i * 2 + 1] - p.z) > far + len) continue;
          for (let t = 0; t <= len; t += 0.25) {
            const dx = pts[i * 2] + (ex * t) / len - p.x;
            const dz = pts[i * 2 + 1] + (ez * t) / len - p.z;
            const d = p.shape === 'box' ? Math.hypot(Math.max(0, Math.abs(c * dx - s * dz) - p.sx / 2), Math.max(0, Math.abs(s * dx + c * dz) - p.sz / 2)) : Math.max(0, Math.hypot(dx, dz) - p.sx / 2);
            if (d < near) near = d;
          }
        }
      }
      if (near < PLAYER_RADIUS) hit.push([p, near]);
    }
    // one failure per building: the piece nearest the centre line, and with it everything within 12 m
    while (hit.length) {
      const [worst] = hit.reduce((a, b) => (b[1] < a[1] ? b : a));
      fail('road', worst.x, worst.z, 'a road runs into a building');
      hit = hit.filter(([p]) => Math.hypot(p.x - worst.x, p.z - worst.z) > 12);
    }
  }
}

// ---------------------------------------------------------------- report
const missing = Object.keys(PLACES).filter((id) => !mapsWith[id]).map((id) => ZONE_NAMES[id]);
const known = (f) => KNOWN.find((k) => k.place === f.place && k.check === f.check && Math.hypot(k.at[0] - f.at[0], k.at[1] - f.at[1]) < 0.1);
const all = [...found.values()];
const fresh = all.filter((f) => !known(f));
const line = (f) => `${ZONE_NAMES[f.place]}: ${f.text}, at (${round(f.at[0])}, ${round(f.at[1])}) in the place's frame, on ${f.seeds.length} of ${mapsWith[f.place]} maps (${f.where})`;
console.log(`world layout: ${Object.values(mapsWith).reduce((a, b) => a + b, 0)} places in ${SEEDS.length} valleys (seeds ${SEEDS.join(', ')})`);
for (const [check, what] of [
  ['door', 'doorways can be walked through both ways'],
  ['reach', 'containers, floor-loot points and supply spots can be reached on foot from the front gate'],
  ['solid', 'of them are clear of anything solid'],
  ['road', 'walls and posts stand clear of the middle of every road'],
]) {
  const bad = fresh.filter((f) => f.check === check);
  const old = all.filter((f) => f.check === check && known(f));
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${counts[check]} ${what}${bad.length ? ', except:' : old.length ? ` (except the ${old.length} known failures below)` : ''}`);
  for (const f of bad) console.log(`        ${line(f)}`);
}
if (missing.length) console.log(`FAIL  every place is on one of the maps: not ${missing.join(', ')} (pick more seeds)`);
for (const k of KNOWN) {
  const f = all.find((x) => known(x) === k);
  if (f) console.log(`known   ${line(f)}: ${k.why}`);
  else console.log(`note    the known failure at ${ZONE_NAMES[k.place]} (${k.at.join(', ')}) no longer fails: delete its entry from KNOWN in scripts/test-world.js`);
}
const ok = !fresh.length && !missing.length;
console.log(`${ok ? 'world layout OK' : 'world layout FAILED'}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(ok ? 0 : 1);
