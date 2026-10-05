// The railway (shared/rail.js), drawn: for every track a ribbon of ballast on the bed, the sleepers and the two
// rails, each merged into one mesh per stretch of line so a stretch out of view costs nothing. What stands on the
// line (the train, the depot, the tunnel mouths) is part of the static world. None of this has a collider: the
// ground under it is the bed the heightfield was cut to, and that is what is walked on.
import * as THREE from 'three';
import { MultiMesh, ALWAYS } from './multimesh.js';
import { RAIL } from '../../shared/rail.js';
import { getMaterial } from './materials.js';

const STRETCH = 96; // metres of track to a mesh (three draw calls a stretch)
const TIE = 0.62; // sleeper spacing
// the ballast across the track: [offset from the centre line, height over the bed], shoulder to shoulder
const BALLAST = [[-2.35, -0.1], [-1.55, 0.035], [1.55, 0.035], [2.35, -0.1]];
const TIE_TOP = 0.11;
const RAIL_TOP = 0.25; // (shared/rail.js stands its wheels and its crossing planks on this)
const RAIL_W = 0.07;

// a point of track t at f metres along it: where it is, and the unit vector along the track
function at(t, f, out) {
  const i = Math.max(0, Math.min(t.n - 2, Math.floor(f)));
  const u = f - i;
  out.x = t.x[i] + (t.x[i + 1] - t.x[i]) * u;
  out.y = t.y[i] + (t.y[i + 1] - t.y[i]) * u;
  out.z = t.z[i] + (t.z[i + 1] - t.z[i]) * u;
  // (the direction of the chord across the point, so a row of the ribbon is shared by the quads either side of it)
  const a = Math.max(0, Math.round(f) - 1);
  const b = Math.min(t.n - 1, Math.round(f) + 1);
  const l = Math.hypot(t.x[b] - t.x[a], t.z[b] - t.z[a]) || 1;
  out.tx = (t.x[b] - t.x[a]) / l;
  out.tz = (t.z[b] - t.z[a]) / l;
  return out;
}

const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function soup() {
  return { pos: [], nrm: [], uv: [] };
}
// a quad a-b-c-d (counter-clockwise seen from its face) with one normal
function quad(to, a, b, c, d, n, ua, ub, uc, ud) {
  for (const [p, u] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) {
    to.pos.push(p[0], p[1], p[2]);
    to.nrm.push(n[0], n[1], n[2]);
    to.uv.push(u[0], u[1]);
  }
}
// One mesh of a material for the whole line: every stretch's triangles are a run of its buffer, and the runs in
// sight are drawn in one call (multimesh.js), not a mesh a stretch.
function mesh(name, stretches, material) {
  const n = stretches.reduce((a, s) => a + s.pos.length, 0) / 3;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const runs = [];
  const sphere = new THREE.Sphere();
  let o = 0;
  for (const s of stretches) {
    const count = s.pos.length / 3;
    if (!count) continue;
    pos.set(s.pos, o * 3);
    nrm.set(s.nrm, o * 3);
    uv.set(s.uv, o * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(o * 3, (o + count) * 3), 3));
    g.computeBoundingSphere();
    sphere.copy(g.boundingSphere);
    runs.push({ first: o, count, x: sphere.center.x, y: sphere.center.y, z: sphere.center.z, r: sphere.radius, chunk: ALWAYS, maxDist: Infinity });
    o += count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const m = new MultiMesh(geo, material, runs);
  m.name = `railway-${name}`;
  m.receiveShadow = true;
  return m;
}

// -> THREE.Group, or null on a map without a railway. (Its materials are shared: dispose of the geometries only.)
export function buildRailway(world) {
  const rail = world.rail;
  if (!rail) return null;
  const group = new THREE.Group();
  group.name = 'railway';
  group.matrixAutoUpdate = false;
  const all = { ballast: [], ties: [], rails: [] };
  const P = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
  const g = RAIL.GAUGE / 2;
  rail.tracks.forEach((t, ti) => {
    // (where the siding leaves the main line the two beds lie in each other: its ballast is laid a hair lower)
    const dip = ti ? -0.015 : 0;
    for (let from = t.from; from < t.to; from += STRETCH) {
      const to = Math.min(t.to, from + STRETCH);
      const ballast = soup();
      const ties = soup();
      const rails = soup();
      // ---- ballast and rails: a row across the track at every point
      let prev = null;
      for (let i = from; i <= to; i++) {
        at(t, i, P);
        const nx = P.tz; // to the right of the way the track runs
        const nz = -P.tx;
        const row = {
          bal: BALLAST.map(([o, h]) => [P.x + nx * o, P.y + h + dip, P.z + nz * o]),
          // each rail: foot and head on its inner side, head and foot on its outer
          rail: [-1, 1].map((s) =>
            [[g - RAIL_W / 2, TIE_TOP], [g - RAIL_W / 2, RAIL_TOP], [g + RAIL_W / 2, RAIL_TOP], [g + RAIL_W / 2, TIE_TOP]].map(([o, h]) => [P.x + nx * o * s, P.y + h, P.z + nz * o * s]),
          ),
          nx,
          nz,
          v: i,
        };
        if (prev) {
          for (let k = 0; k < 3; k++) {
            const slope = k === 1 ? 0 : k === 0 ? -0.17 : 0.17; // the shoulders lean out
            const l = Math.hypot(slope, 1);
            const n = [(nx * slope) / l, 1 / l, (nz * slope) / l];
            const u0 = BALLAST[k][0];
            const u1 = BALLAST[k + 1][0];
            quad(ballast, prev.bal[k], row.bal[k], row.bal[k + 1], prev.bal[k + 1], n, [u0, prev.v], [u0, row.v], [u1, row.v], [u1, prev.v]);
          }
          for (let s = 0; s < 2; s++) {
            const sg = s ? 1 : -1;
            const a = prev.rail[s];
            const b = row.rail[s];
            // (seen from outside the rail, whichever side of the track it is on)
            const face = (k0, k1, n, w) => {
              if (sg > 0) quad(rails, a[k0], b[k0], b[k1], a[k1], n, [0, prev.v], [0, row.v], [w, row.v], [w, prev.v]);
              else quad(rails, a[k1], b[k1], b[k0], a[k0], n, [w, prev.v], [w, row.v], [0, row.v], [0, prev.v]);
            };
            face(0, 1, [-nx * sg, 0, -nz * sg], RAIL_TOP - TIE_TOP);
            face(1, 2, [0, 1, 0], RAIL_W);
            face(2, 3, [nx * sg, 0, nz * sg], RAIL_TOP - TIE_TOP);
          }
        }
        prev = row;
      }
      // ---- sleepers: boxes across the track, none of them quite square to it
      for (let k = Math.ceil(from / TIE); k * TIE < to; k++) {
        if (ti && k * TIE < 6) continue; // (the siding's first few lie under the main line's)
        at(t, k * TIE, P);
        const skew = (hash(k + ti * 977) - 0.5) * 0.07;
        const shift = (hash(k * 3 + 1 + ti * 977) - 0.5) * 0.12;
        const tx = P.tx * Math.cos(skew) - P.tz * Math.sin(skew);
        const tz = P.tz * Math.cos(skew) + P.tx * Math.sin(skew);
        const nx = tz;
        const nz = -tx;
        const cx = P.x + nx * shift;
        const cz = P.z + nz * shift;
        const hl = 1.25; // half its length (across the track)...
        const hw = 0.11; // ...and its width (along it)
        const y0 = P.y - 0.04;
        const y1 = P.y + TIE_TOP;
        const c = (a, b, y) => [cx + nx * a * hl + tx * b * hw, y, cz + nz * a * hl + tz * b * hw];
        const U = [[0, 0], [0, 0.22], [2.5, 0.22], [2.5, 0]];
        quad(ties, c(-1, -1, y1), c(-1, 1, y1), c(1, 1, y1), c(1, -1, y1), [0, 1, 0], ...U);
        quad(ties, c(-1, 1, y0), c(1, 1, y0), c(1, 1, y1), c(-1, 1, y1), [tx, 0, tz], [0, 0], [2.5, 0], [2.5, 0.15], [0, 0.15]);
        quad(ties, c(1, -1, y0), c(-1, -1, y0), c(-1, -1, y1), c(1, -1, y1), [-tx, 0, -tz], [0, 0], [2.5, 0], [2.5, 0.15], [0, 0.15]);
        quad(ties, c(1, 1, y0), c(1, -1, y0), c(1, -1, y1), c(1, 1, y1), [nx, 0, nz], [0, 0], [0.22, 0], [0.22, 0.15], [0, 0.15]);
        quad(ties, c(-1, -1, y0), c(-1, 1, y0), c(-1, 1, y1), c(-1, -1, y1), [-nx, 0, -nz], [0, 0], [0.22, 0], [0.22, 0.15], [0, 0.15]);
      }
      all.ballast.push(ballast);
      all.ties.push(ties);
      all.rails.push(rails);
    }
  });
  group.add(mesh('ballast', all.ballast, getMaterial('gravel')), mesh('ties', all.ties, getMaterial('trim')), mesh('rails', all.rails, getMaterial('rust')));
  return group;
}
