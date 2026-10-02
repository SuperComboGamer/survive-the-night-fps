// St. Agnes Cemetery: the graveyard behind the chapel, and the handful of older graves in the churchyard beside
// it. world.js calls buildCemetery from the end of the chapel's builder, so it is on every map the chapel is.
//
// The rule it is there for: the dead come up out of the ground (server/cemetery.js). By night a share of each
// wave's rank and file rises from these graves instead of walking in from the treeline, inside whatever the
// survivors have walled off; by day a few restless graves give up a walker to whoever comes close. Every grave
// here is a spot one can climb out of: world.cemetery.graves.
import { ZONE, CONT } from './defs.js';
import { mulberry32 } from './rng.js';
import { makeBox, COL } from './collision.js';

const PI = Math.PI;

// The numbers of the rule, shared so the client draws a rise as long as the server takes over it.
export const CEMETERY = {
  NEAR: 60, // a survivor this close to the middle of the cemetery when a wave starts wakes it (m)
  SHARE: 0.3, // ...and this share of that wave's walkers and runners comes up out of the graves
  SPREAD: 20, // ...staggered over this long (s)
  KEEP_OFF: 4, // no grave gives up its dead with a survivor standing this close to it (m): never under their feet
  RESTLESS: 3, // graves that hold a walker by day, drawn at every sunrise
  WAKE: 5, // a restless grave wakes when a survivor comes this close (m)
  STIR: 1.2, // the earth heaves and the grave is heard this long before anything shows (s)
  RISE: 2.5, // the climb out, from the first fingers to standing on the grass (s)
  REST: 8, // a grave that has given up one of the dead stays quiet this long (s)
};
// How deep the feet of a zombie climbing out still are, as a share of its height, u = 0..1 of the way through the
// climb. Two heaves: the hands are out first, the head a fifth of the way in, the chest by half way, where it
// gathers itself; then the rest of it.
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const riseDepth = (u) => 1 - 0.55 * ease(u / 0.45) - 0.45 * ease((u - 0.5) / 0.5);

// the fence: wrought iron, a body does not pass it and a bullet does
const X0 = -18;
const X1 = 18;
const Z0 = 22;
const Z1 = 41.5;
const GATE = 1.6; // half the width of the gateway
const FENCE_H = 1.55;
const ROWS = [26.5, 30.5, 34.5, 38.5]; // the headstones of each row (local z)
const COLS = [3.5, 6, 8.5, 11, 13.5, 16]; // ...and where they stand either side of the path
const FOOT = 1.15; // a grave lies this far out in front of its headstone
const HEAP = 1.25; // what was dug out of an open one is heaped this far to its side
const TREE = [-11, 31.3]; // the dead tree

// b: the chapel's builder (its frame: the chapel's door is at -Z, the cemetery behind it at +Z).
// heightAt: the terrain. staticGrid: the world's colliders (the fence has a collider and no part of its own).
// -> world.cemetery: { x, y, z, ry, hx, hz, inside(x, z), gate: { x, z }, graves: [{ x, y, z, yaw }] }
export function buildCemetery(b, { seed, heightAt, staticGrid }) {
  const rng = mulberry32(seed ^ 0x6ea7e5); // its own stream: nothing else in the valley moves for it
  const sd = () => rng.int(0, 9999);
  // everything here stands on the ground as it is: the far corners lie past the chapel's levelled yard
  const c = b.sub(0, 0);
  c.zone = ZONE.CEMETERY;
  c.ground = true;
  const gy = (lx, lz) => heightAt(c.wx(lx, lz), c.wz(lx, lz)) - c.y0;
  const graves = [];

  // ---------------------------------------------------------------- the fence
  // one panel of railings from (x0,z0) to (x1,z1): a post, two rails and the pickets between them
  const panel = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / L;
    const uz = (z1 - z0) / L;
    const ry = Math.atan2(-uz, ux);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const y = Math.min(gy(x0, z0), gy(x1, z1)) - 0.08;
    c.box(x0, y, z0, 0.09, FENCE_H + 0.25, 0.09, 'iron', { collide: false });
    for (const h of [0.3, FENCE_H - 0.2]) c.box(mx, y + h, mz, L, 0.05, 0.04, 'iron', { ry, collide: false });
    const n = Math.round(L / 0.29);
    for (let i = 1; i < n; i++) c.box(x0 + (ux * L * i) / n, y, z0 + (uz * L * i) / n, 0.03, FENCE_H + (i % 2 ? 0.08 : 0), 0.03, 'iron', { collide: false });
    staticGrid.add(makeBox(c.wx(mx, mz), c.wz(mx, mz), c.y0 + y, c.y0 + y + FENCE_H, L, 0.12, c.ry + ry, COL.STATIC | COL.NOBULLET));
  };
  // a run of n panels; skip: the ones that are down (a gap the dead and the living both walk through)
  const run = (x0, z0, x1, z1, n, skip = -1) => {
    for (let i = 0; i < n; i++) {
      const a = [x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n];
      const e = [x0 + ((x1 - x0) * (i + 1)) / n, z0 + ((z1 - z0) * (i + 1)) / n];
      if (i !== skip) {
        panel(...a, ...e);
        continue;
      }
      // the panel lies where it fell, its post still standing
      const y = gy(...a);
      c.box(a[0], y - 0.08, a[1], 0.09, FENCE_H + 0.25, 0.09, 'iron', { collide: false });
      const ry = Math.atan2(-(e[1] - a[1]), e[0] - a[0]) + 0.35;
      const mx = (a[0] + e[0]) / 2 + (z1 === z0 ? 0 : 1.1);
      const mz = (a[1] + e[1]) / 2 + (z1 === z0 ? 1.1 : 0);
      const fy = gy(mx, mz);
      for (const o of [-0.55, 0.55]) c.box(mx - Math.sin(ry) * o, fy + 0.02, mz - Math.cos(ry) * o, 2.6, 0.04, 0.05, 'iron', { ry, collide: false });
      for (let i2 = -4; i2 <= 4; i2++) c.box(mx + Math.cos(ry) * i2 * 0.29, fy + 0.03, mz - Math.sin(ry) * i2 * 0.29, 0.03, 0.03, 1.5, 'iron', { ry, collide: false });
      c.clear((a[0] + e[0]) / 2, (a[1] + e[1]) / 2, 2.5);
    }
    c.box(x1, gy(x1, z1) - 0.08, z1, 0.09, FENCE_H + 0.25, 0.09, 'iron', { collide: false });
  };
  const post = GATE + 0.25; // the middle of a gate pillar
  run(X0, Z0, -post - 0.25, Z0, 6);
  run(post + 0.25, Z0, X1, Z0, 6);
  run(X1, Z0, X1, Z1, 7, 3); // a panel is down on the east side
  run(X1, Z1, X0, Z1, 12, 8); // ...and one at the back
  run(X0, Z1, X0, Z0, 7);
  // the gate: two stone pillars, an iron arch over them, the leaves standing open into the cemetery
  for (const s of [-1, 1]) {
    const y = gy(s * post, Z0);
    c.box(s * post, y - 0.1, Z0, 0.5, 2.4, 0.5, 'stone');
    c.box(s * post, y + 2.3, Z0, 0.62, 0.14, 0.62, 'stone', { collide: false });
    // (a leaf: swung in past square, one further than the other, so the gateway stands clear)
    const swing = s < 0 ? 1.75 : 2.05;
    const dx = -s * Math.cos(swing);
    const dz = Math.sin(swing);
    const leaf = GATE - 0.1;
    const at = (d) => [s * GATE + dx * d, Z0 + 0.1 + dz * d];
    for (const h of [0.25, 1.35]) c.box(at(leaf / 2)[0], y + h, at(leaf / 2)[1], leaf, 0.05, 0.04, 'iron', { ry: Math.atan2(-dz, dx), collide: false });
    for (let i = 0; i <= 5; i++) c.box(at((leaf * i) / 5)[0], y + 0.1, at((leaf * i) / 5)[1], 0.03, 1.5 + (i === 5 ? 0.25 : 0), 0.03, 'iron', { collide: false });
    c.prop('lantern_post', s * (post + 1.1), Z0 - 0.45, 0, { seed: sd() });
  }
  c.box(0, gy(0, Z0) + 2.55, Z0, post * 2 + 0.3, 0.07, 0.07, 'iron', { collide: false });
  c.box(0, gy(0, Z0) + 2.62, Z0, 0.07, 0.55, 0.07, 'iron', { collide: false });
  c.box(0, gy(0, Z0) + 2.95, Z0, 0.4, 0.07, 0.07, 'iron', { collide: false });
  c.clear(0, Z0, 3);
  // a gravel path from the gate to the crypt
  for (const [z, len] of [[22, 3], [25, 3], [28, 3], [31, 3], [33.35, 1.7]]) c.box(0, gy(0, z), z, 2.2, 0.03, len, 'gravel', { collide: false });

  // ---------------------------------------------------------------- graves
  // A grave: the headstone at (hx, hz) facing ry (its front, where the grave lies), and what is left of the mound.
  // kind: 0 a mound, 1 sunken, 2 open (dug and never filled, or dug out from below)
  const grave = (hx, hz, ry, kind) => {
    const fx = -Math.sin(ry);
    const fz = -Math.cos(ry);
    const mx = hx + fx * FOOT;
    const mz = hz + fz * FOOT;
    const y = gy(mx, mz);
    c.prop(rng.chance(0.72) ? 'gravestone' : 'grave_cross', hx, hz, ry + rng.range(-0.12, 0.12), { seed: sd() });
    const o = { ry, collide: false };
    if (kind === 0) c.prism(mx, y - 0.02, mz, 0.9, rng.range(0.2, 0.32), 1.9, 'earth', { ry });
    else if (kind === 1) c.box(mx, y - 0.03, mz, 0.95, 0.07, 1.95, 'earth', o);
    else {
      // the pit is a black slab (the ground is a heightfield: nothing can be dug into it), banked with what came out
      c.box(mx, y, mz, 0.95, 0.06, 2.0, 'dark', o);
      for (const s of [-1, 1]) c.prism(mx + fz * s * 0.62, y - 0.02, mz - fx * s * 0.62, 0.34, 0.2, 2.2, 'earth', { ry });
      c.cone(mx - fz * HEAP, y - 0.05, mz + fx * HEAP, 0.6, 0.55, 'earth', 7, { ry: rng.range(0, PI) });
    }
    graves.push({ x: c.wx(mx, mz), y: heightAt(c.wx(mx, mz), c.wz(mx, mz)), z: c.wz(mx, mz), yaw: c.ry + ry });
    return [mx, mz];
  };
  // the rows behind the chapel: every headstone faces the gate. Some plots were never taken, a few have sunk,
  // two stand open
  const open = [[1, 8.5], [2, -16]];
  let dug = null;
  ROWS.forEach((z, row) => {
    for (const s of [-1, 1]) {
      for (const cx of COLS) {
        const x = s * cx + rng.range(-0.2, 0.2);
        if (row >= 2 && cx < 5) continue; // (the crypt stands here)
        if (Math.hypot(s * cx - TREE[0], z - TREE[1]) < 3.95) continue; // (...and the tree here)
        const isOpen = open.some(([r, ox]) => r === row && ox === s * cx);
        if (!isOpen && rng.chance(0.12)) continue;
        const at = grave(x, z + rng.range(-0.15, 0.15), 0, isOpen ? 2 : rng.chance(0.15) ? 1 : 0);
        if (isOpen && !dug) dug = at;
      }
    }
  });
  // the churchyard: the oldest graves, in two short rows beside the chapel, facing away from its wall
  for (const x of [8.4, 12.4]) {
    for (let z = -0.5; z < 14; z += 3.5) {
      if (rng.chance(0.2)) continue;
      grave(x, z + rng.range(-0.2, 0.2), -PI / 2, rng.chance(0.4) ? 1 : 0);
    }
  }
  // the open grave by the path was being dug when it all stopped: planks across it, a shovel in the heap, the
  // gravedigger's bag
  if (dug) {
    const [mx, mz] = dug;
    const y = gy(mx, mz);
    c.box(mx, y + 0.07, mz - 0.5, 1.5, 0.04, 0.22, 'planks', { ry: 0.12, collide: false });
    c.box(mx + 0.1, y + 0.07, mz + 0.4, 1.5, 0.04, 0.22, 'planks', { ry: -0.2, collide: false });
    c.box(mx + HEAP, y + 0.3, mz - 0.1, 0.04, 1.15, 0.04, 'trim', { rz: 0.22, collide: false });
    c.cont(CONT.DUFFEL, mx - 1.7, mz - 0.9, { prop: 'duffel_bag', ry: 0.7, nocollide: true, seed: sd() });
    c.prop('bones', mx + 1.9, mz + 1.2, 0.4, { nocollide: true, seed: sd() });
    c.loot(mx - 1.6, mz + 0.6);
  }
  c.loot(-14.8, 36.6);
  c.loot(12.25, 24.4);
  c.prop('corpse', 5.2, 24.2, 2.2, { nocollide: true, seed: sd() });
  c.tree(TREE[0], TREE[1], 4, 1.55);

  // ---------------------------------------------------------------- the crypt
  // at the head of the path, its door to the gate. One room, one sarcophagus with its lid pushed aside: the casket
  // (CONT.CASKET) is what the place is worth by day.
  {
    const k = c.sub(0, 36.6, 0, gy(0, 36.6));
    k.ground = false; // (its floor is level: what stands in it stands on that)
    k.room(0, 0, 4.4, 4.6, 2.6, 'stone', { n: [{ at: 2.2, w: 1.3, y0: 0, y1: 2.2 }] }, { t: 0.35, roof: 'gable', roofH: 1.4, roofMat: 'stone', floorMat: 'stone' });
    // (a paler stone round the doorway and for the cross over it, so the door shows in the dark of the wall)
    for (const s of [-1, 1]) k.box(s * 0.82, 0, -2.52, 0.26, 2.3, 0.14, 'gravestone', { collide: false });
    k.box(0, 2.24, -2.53, 2.1, 0.28, 0.16, 'gravestone', { collide: false });
    k.box(0, 4.0, -2.3, 0.14, 0.9, 0.14, 'gravestone', { collide: false });
    k.box(0, 4.5, -2.3, 0.55, 0.14, 0.14, 'gravestone', { collide: false });
    k.box(0, 0.12, 0.7, 1.0, 0.7, 2.1, 'gravestone');
    k.box(0.16, 0.82, 0.6, 1.08, 0.12, 2.2, 'gravestone', { ry: 0.2, collide: false });
    k.cont(CONT.CASKET, 0, 0.7, { ly: 0.12, h: 0.85 });
    k.prop('bones', 1.25, 1.5, 1.1, { ly: 0.12, nocollide: true, seed: sd() });
    k.loot(1.3, -1.3, 0.14);
    // (a car supply may be hidden in here: the chapel's own hiding place, so it is the chapel the rumour names)
    k.zone = ZONE.CHURCH;
    k.partSpot(-1.3, 1.6, 0.14);
  }

  const mid = [0, (Z0 + Z1) / 2];
  const x = c.wx(...mid);
  const z = c.wz(...mid);
  // inside the fence (pad: this far outside it still counts)
  const inside = (wx, wz, pad = 0) => {
    const dx = wx - x;
    const dz = wz - z;
    return Math.abs(c.c * dx - c.s * dz) < (X1 - X0) / 2 + pad && Math.abs(c.s * dx + c.c * dz) < (Z1 - Z0) / 2 + pad;
  };
  // (x, z: the middle of the fenced ground; hx, hz: half its width and depth in the frame turned by ry)
  return { x, z, y: heightAt(x, z), ry: c.ry, hx: (X1 - X0) / 2, hz: (Z1 - Z0) / 2, inside, gate: { x: c.wx(0, Z0 - 2), z: c.wz(0, Z0 - 2) }, graves };
}
