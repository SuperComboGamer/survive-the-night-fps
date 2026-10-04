// The splash's backdrop: a walk around the valley at eye level, one shot at a time. A shot glides some 35 m along a
// road or trail - toward your car first, then into the places in a shuffled order, with a few stretches of empty
// road and forest trail between - and the picture fades to black at each cut. The camera only goes where a survivor
// could walk: a stretch with anything in the way at head height is moved over to the verge, or left out.
import { COL, footprintContains, groundAt, deepWaterAt } from '../../shared/collision.js';

const EYE = 1.62; // m above the ground
const SPEED = 2.3; // m/s: an unhurried walk
const SHOT = 15; // s a shot
const FADE = 1.1; // s to black, and the same back, at a cut
const WALK = SPEED * SHOT;
const AHEAD = 9; // m: the camera faces a point this far on along the way
const SIDESTEP = [0, 1.3, -1.3, 2.5, -2.5]; // m off the middle of the road, tried in turn
const ROAMS = 4; // stretches that lead nowhere in particular
const PLACE_REACH = 50; // m beyond a place's yard that a road may pass and still be the way in

const _q = [];

// could a survivor stand at (x, y, z)? Nothing solid between their knees and the top of their head, and no deep water
function standable(world, x, y, z) {
  if (deepWaterAt(world, x, z, y)) return false;
  for (const grid of world.colliderGrids) {
    for (const c of grid.query(x, z, 0.6, _q)) {
      if (c.flags & COL.NOBLOCK) continue;
      if (c.y1 > y + 0.4 && c.y0 < y + EYE + 0.25 && footprintContains(c, x, z, 0.45)) return false;
    }
  }
  return true;
}

// Road points i0 -> i1 (either way round) as a path, `off` m to the right of the road's middle, with its length
// so far at every point
function stretch(road, i0, i1, off) {
  const p = road.pts;
  const n = p.length / 2;
  const dir = i1 >= i0 ? 1 : -1;
  const xs = [];
  const zs = [];
  for (let i = i0; dir > 0 ? i <= i1 : i >= i1; i += dir) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let tx = (p[b * 2] - p[a * 2]) * dir;
    let tz = (p[b * 2 + 1] - p[a * 2 + 1]) * dir;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    // (right of the way it is walked: forward (tx, tz) turned clockwise seen from above)
    xs.push(p[i * 2] - tz * off);
    zs.push(p[i * 2 + 1] + tx * off);
  }
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  return { xs, zs, cum, len: cum[cum.length - 1] };
}

// the point `s` m along a path (on past its end along its last leg)
function along(path, s, out) {
  const { xs, zs, cum } = path;
  const last = xs.length - 1;
  let i = 0;
  while (i < last - 1 && cum[i + 1] < s) i++;
  const seg = cum[i + 1] - cum[i] || 1;
  const t = (s - cum[i]) / seg;
  out.x = xs[i] + (xs[i + 1] - xs[i]) * t;
  out.z = zs[i] + (zs[i + 1] - zs[i]) * t;
  return out;
}

// the path walked from road point i0 toward i1, on the middle of the road or as near it as is clear; null if
// nowhere across the road is
function clearPath(world, road, i0, i1) {
  const p = { x: 0, z: 0 };
  for (const off of SIDESTEP) {
    const path = stretch(road, i0, i1, off);
    if (path.len < WALK - 1) return null;
    let y = world.heightAt(path.xs[0], path.zs[0]);
    let ok = true;
    for (let s = 0; s <= WALK && ok; s += 1) {
      along(path, s, p);
      y = groundAt(world, p.x, p.z, y + 0.3);
      ok = standable(world, p.x, y, p.z);
    }
    if (ok) return path;
  }
  return null;
}

// the index of the point of `road` nearest (x, z), and how far it is
function nearestOn(road, x, z) {
  const p = road.pts;
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < p.length / 2; i++) {
    const d = (p[i * 2] - x) ** 2 + (p[i * 2 + 1] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { i: best, d: Math.sqrt(bd) };
}

// from point i of `road`, the first point at least m metres on toward dir (or the road's last, short of that), and
// how far it is
function walkOn(road, i, dir, m) {
  const p = road.pts;
  const n = p.length / 2;
  let d = 0;
  while (d < m && i + dir >= 0 && i + dir < n) {
    d += Math.hypot(p[(i + dir) * 2] - p[i * 2], p[(i + dir) * 2 + 1] - p[i * 2 + 1]);
    i += dir;
  }
  return { i, d };
}

// a shot that walks along `road` up to point `end` (and looks on past it, if the road goes on), from whichever
// side has room - tried in a random order
function arriving(world, road, end, focus) {
  const sides = Math.random() < 0.5 ? [1, -1] : [-1, 1];
  for (const dir of sides) {
    const from = walkOn(road, end, -dir, WALK + 2);
    if (from.d < WALK) continue;
    const path = clearPath(world, road, from.i, walkOn(road, end, dir, AHEAD + 4).i);
    if (path) return { path, focus };
  }
  return null;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// every shot the valley has: the car's first, the rest shuffled
function planShots(world) {
  const roads = world.roads.filter((r) => r.length > WALK + AHEAD + 10);
  const car = world.car;
  const out = [];
  if (world.highway) {
    // (stopping short of it, from one side or the other: it is parked at the side of the road)
    const { i } = nearestOn(world.highway, car.x, car.z);
    for (const dir of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
      const shot = arriving(world, world.highway, walkOn(world.highway, i, -dir, 7).i, { x: car.x, z: car.z });
      if (shot) {
        out.push(shot);
        break;
      }
    }
  }
  const rest = [];
  for (const zn of world.zones) {
    let best = null;
    for (const road of roads) {
      const near = nearestOn(road, zn.x, zn.z);
      if (near.d < zn.flat + PLACE_REACH && (!best || near.d < best.d)) best = { road, ...near };
    }
    if (!best) continue;
    const shot = arriving(world, best.road, best.i, { x: zn.x, z: zn.z });
    if (shot) rest.push(shot);
  }
  const total = roads.reduce((s, r) => s + r.length, 0);
  for (let k = 0, tries = 0; k < ROAMS && tries < ROAMS * 6 && total > 0; tries++) {
    let pick = Math.random() * total;
    const road = roads.find((r) => (pick -= r.length) <= 0) || roads[0];
    const n = road.pts.length / 2;
    const shot = arriving(world, road, (Math.random() * n) | 0, null);
    if (shot) {
      rest.push(shot);
      k++;
    }
  }
  return out.concat(shuffle(rest));
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class MenuTour {
  // open: the first shot starts on the picture, not out of black (the page's first: it fades in over the still)
  constructor(world, open = false) {
    this.world = world;
    this.shots = planShots(world);
    this.k = 0;
    this.t = 0;
    this.open = open;
    this.clock = 0;
    this.y = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.fresh = true; // (a new shot: the camera is put there, not eased)
    this._p = { x: 0, z: 0 };
    this._a = { x: 0, z: 0 };
  }

  get ready() {
    return this.shots.length > 0;
  }

  // Walks on by dt and puts `cam` where the walk is. Returns how far the picture is faded to black (0..1).
  update(dt, cam) {
    const shot = this.shots[this.k];
    this.t += dt;
    this.clock += dt;
    if (this.t > SHOT) {
      this.t = 0;
      this.fresh = true;
      this.open = false;
      if (++this.k >= this.shots.length) {
        this.k = 0;
        shuffle(this.shots);
      }
      return this.update(0, cam);
    }
    const w = this.world;
    const p = along(shot.path, this.t * SPEED, this._p);
    const a = along(shot.path, this.t * SPEED + AHEAD, this._a);
    const ground = groundAt(w, p.x, p.z, (this.fresh ? w.heightAt(p.x, p.z) : this.y - EYE) + 0.3);
    // the way ahead, turned partway toward the place the shot is about while it is in reach
    let yaw = Math.atan2(-(a.x - p.x), -(a.z - p.z));
    if (shot.focus) {
      const f = shot.focus;
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      const pull = 0.5 * (1 - smooth(25, 70, d)) * smooth(5, 12, d);
      yaw += Math.max(-0.75, Math.min(0.75, wrap(Math.atan2(-(f.x - p.x), -(f.z - p.z)) - yaw))) * pull;
    }
    // a head that looks about a little as it goes
    yaw += Math.sin(this.clock * 0.23) * 0.07 + Math.sin(this.clock * 0.61 + 1.3) * 0.02;
    const aheadY = w.heightAt(a.x, a.z);
    const pitch = Math.atan2(aheadY - ground, AHEAD) * 0.6 - 0.035 + Math.sin(this.clock * 0.31) * 0.02;
    const k = this.fresh ? 1 : Math.min(1, dt * 2.5);
    this.yaw += wrap(yaw - this.yaw) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.y += (ground + EYE - this.y) * (this.fresh ? 1 : Math.min(1, dt * 6));
    this.fresh = false;
    // footsteps, faintly
    const bob = Math.sin(this.clock * Math.PI * 2 * 0.85) * 0.022;
    cam.position.set(p.x, this.y + bob, p.z);
    cam.rotation.set(this.pitch, this.yaw, Math.sin(this.clock * 0.43) * 0.008);
    return 1 - Math.min(this.open ? 1 : smooth(0, FADE, this.t), smooth(SHOT, SHOT - FADE, this.t));
  }
}
