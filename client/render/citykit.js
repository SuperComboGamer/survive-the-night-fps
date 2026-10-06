// The city's building kit. Port Calder (shared/mainland.js) says what stands on every lot - a block of storeys of
// such a style, so many of them standing whole and what is left of the rest; the room at its foot; the walls of a
// shell; a heap of what came down - and this file builds what is seen of it: walls with their window openings cut
// into them (reveals, sills, lintels, frames, glass that is whole, broken, gone or boarded), cornices and parapets,
// fins and string courses, fire escapes, balconies, drainpipes, what stands on a roof, storeys cut open on their
// slabs, columns and rooms, rubble, the lining of the rooms that can be walked into, and what the years laid on all
// of it (soot, rust, damp, ivy, paint). Everything is written straight into the static world's merged buffers
// (staticworld.js), in tiers: what is read from across the city (TIER.FAR), and what is only seen from the street
// or from in front of it (STREET, DETAIL, ROOM), so a tower costs a few thousand triangles a mile off.
//
// Frames. A building's own: x along its width, z along its depth, its front at -z (as the Builder that put it
// there: shared/worldkit.js). A face of it: s along the wall to the right as seen from outside, y up, d into the
// wall (so -d stands proud of it).
import { cityUV } from './textures.js';
import { VERTEX_COLOR_MATERIALS } from './materials.js';

// (DETAIL: the fine things of a face, seen from near only. ROOM: what is inside a room that is walked into - its
// lining, its doors, what hangs on its walls - seen from nearer still: from across the street, not from the next
// block. Neither casts a shadow.)
export const TIER = { FAR: 0, STREET: 1, DETAIL: 2, ROOM: 3 };
const PI = Math.PI;
const WHITE = [1, 1, 1];
const CEIL_N = [0.62, -0.35, 0.7];
const PLASTER_CEIL_N = [0.62, 0, 0.78]; // (a plastered ceiling takes the light as the walls under it do)

// a number in 0..1 from up to four integers: the same on every client, whatever was drawn before it
const hash = (a, b = 0, c = 0, d = 0) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647) + Math.imul(d | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const rngOf = (seed) => {
  let a = (Math.imul(seed | 0, 2654435761) + 1013904223) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ the soup
// Triangles gathered per material and tier, in world space, handed to the static world as one piece each.
class Soup {
  constructor() {
    this.lists = new Map();
    this.frame(0, 0, 0, 0);
  }
  // where what follows stands: origin (world), yaw (a Builder's ry)
  // tilt: tipped about its own z as well, its +x end up (a length of tower lying not quite level)
  frame(ox, oy, oz, ry, tilt = 0) {
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
    this.c = Math.cos(ry);
    this.s = Math.sin(ry);
    this.tc = Math.cos(tilt);
    this.ts = Math.sin(tilt);
  }
  list(mat, tier) {
    const key = mat + '|' + tier;
    let l = this.lists.get(key);
    if (!l) this.lists.set(key, (l = { mat, tier, pos: [], nrm: [], uv: [], col: VERTEX_COLOR_MATERIALS.has(mat) ? [] : null }));
    return l;
  }
  // a direction of the frame, in the world (a normal given by hand: tri's nrm)
  dir(x, y, z) {
    return [this.c * x + this.s * z, y, -this.s * x + this.c * z];
  }
  // a triangle of the frame's points [x, y, z], counter-clockwise from outside. col: one colour, or one for each
  // corner (light falling off across a wall)
  tri(mat, tier, a, b, c, ua, ub, uc, col = WHITE, nrm = null) {
    const l = this.list(mat, tier);
    const { ox, oy, oz, c: cs, s: sn, tc, ts } = this;
    if (ts) [a, b, c] = [a, b, c].map((q) => [q[0] * tc - q[1] * ts, q[0] * ts + q[1] * tc, q[2]]);
    const ax = ox + cs * a[0] + sn * a[2], ay = oy + a[1], az = oz - sn * a[0] + cs * a[2];
    const bx = ox + cs * b[0] + sn * b[2], by = oy + b[1], bz = oz - sn * b[0] + cs * b[2];
    const cx = ox + cs * c[0] + sn * c[2], cy = oy + c[1], cz = oz - sn * c[0] + cs * c[2];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    if (nrm) [nx, ny, nz] = nrm;
    l.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    l.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    l.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    if (!l.col) return;
    if (typeof col[0] === 'number') l.col.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
    else l.col.push(col[0][0], col[0][1], col[0][2], col[1][0], col[1][1], col[1][2], col[2][0], col[2][1], col[2][2]);
  }
  // a quad of four points round its edge, counter-clockwise from outside; uv: four pairs, or null for metres laid
  // along its first edge and up its last
  quad(mat, tier, p0, p1, p2, p3, uv = null, col = WHITE, nrm = null) {
    if (!uv) {
      const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      const h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
      const u0 = hash(p0[0] * 31, p0[1] * 17, p0[2] * 13) * 3;
      uv = [[u0, 0], [u0 + w, 0], [u0 + w, h], [u0, h]];
    }
    const each = typeof col[0] !== 'number'; // (a colour for each corner)
    this.tri(mat, tier, p0, p1, p2, uv[0], uv[1], uv[2], each ? [col[0], col[1], col[2]] : col, nrm);
    this.tri(mat, tier, p0, p2, p3, uv[0], uv[2], uv[3], each ? [col[0], col[2], col[3]] : col, nrm);
  }
  // ...seen from both sides
  quad2(mat, tier, p0, p1, p2, p3, uv = null, col = WHITE) {
    this.quad(mat, tier, p0, p1, p2, p3, uv, col);
    this.quad(mat, tier, p1, p0, p3, p2, uv, col);
  }
  // a quad of the city's atlas: cell, the name of one (textures.js CITY_ATLAS)
  cell(mat, tier, name, p0, p1, p2, p3, flip = false) {
    const a = cityUV(name);
    const [u0, u1] = flip ? [a.u1, a.u0] : [a.u0, a.u1];
    this.quad(mat, tier, p0, p1, p2, p3, [[u0, a.v0], [u1, a.v0], [u1, a.v1], [u0, a.v1]]);
  }
  // a box: its middle, its size, turned by yaw about y, then tipped (rx, rz) - metres on every face. skip: a mask of
  // faces left out (1 +x, 2 -x, 4 +y, 8 -y, 16 +z, 32 -z)
  box(mat, tier, cx, cy, cz, sx, sy, sz, o = {}) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cy_ = Math.cos(o.ry || 0), sy_ = Math.sin(o.ry || 0);
    const cxr = Math.cos(o.rx || 0), sxr = Math.sin(o.rx || 0);
    const czr = Math.cos(o.rz || 0), szr = Math.sin(o.rz || 0);
    // (as three's Euler 'XYZ' on a part: about z, then y, then x - the order world parts are turned in)
    const P = (x, y, z) => {
      let x1 = x * czr - y * szr, y1 = x * szr + y * czr, z1 = z;
      const x2 = x1 * cy_ + z1 * sy_, z2 = -x1 * sy_ + z1 * cy_;
      x1 = x2;
      z1 = z2;
      const y3 = y1 * cxr - z1 * sxr, z3 = y1 * sxr + z1 * cxr;
      return [cx + x1, cy + y3, cz + z3];
    };
    const skip = o.skip || 0;
    const col = o.c || WHITE;
    const u0 = o.u0 ?? hash(cx * 7, cy * 11, cz * 13) * 4;
    const face = (bit, a, b, c, d, w, h) => {
      if (skip & bit) return;
      this.quad(mat, tier, a, b, c, d, [[u0, cy - hy], [u0 + w, cy - hy], [u0 + w, cy - hy + h], [u0, cy - hy + h]], col);
    };
    face(1, P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), sz, sy);
    face(2, P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), sz, sy);
    face(4, P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), sx, sz);
    face(8, P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), sx, sz);
    face(16, P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), sx, sy);
    face(32, P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), sx, sy);
  }
  // a bar from a to b, square, `t` across (a pipe, a rail, a length of rebar)
  bar(mat, tier, a, b, t, col = WHITE, sides = 4) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    // two axes across it
    let ux = dz, uy = 0, uz = -dx;
    let ul = Math.hypot(ux, uz);
    if (ul < 1e-5) {
      ux = 1;
      uz = 0;
      ul = 1;
    }
    ux /= ul;
    uz /= ul;
    const vx = (dy * uz - dz * uy) / len, vy = (dz * ux - dx * uz) / len, vz = (dx * uy - dy * ux) / len;
    const r = t / 2;
    const ring = (p) => {
      const out = [];
      for (let k = 0; k < sides; k++) {
        const an = (k / sides) * PI * 2 + PI / 4;
        const cu = Math.cos(an) * r, sv = Math.sin(an) * r;
        out.push([p[0] + ux * cu + vx * sv, p[1] + uy * cu + vy * sv, p[2] + uz * cu + vz * sv]);
      }
      return out;
    };
    const A = ring(a), B = ring(b);
    for (let k = 0; k < sides; k++) {
      const n = (k + 1) % sides;
      this.quad(mat, tier, A[k], A[n], B[n], B[k], [[0, 0], [t, 0], [t, len], [0, len]], col);
    }
  }
  // a cylinder standing on (cx, y0, cz): radius, height, sides; cap: its top closed
  cyl(mat, tier, cx, y0, cz, r, h, sides = 10, cap = true, col = WHITE, rTop = r) {
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * PI * 2, a1 = ((k + 1) / sides) * PI * 2;
      const p0 = [cx + Math.cos(a0) * r, y0, cz - Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, y0, cz - Math.sin(a1) * r];
      const q0 = [cx + Math.cos(a0) * rTop, y0 + h, cz - Math.sin(a0) * rTop], q1 = [cx + Math.cos(a1) * rTop, y0 + h, cz - Math.sin(a1) * rTop];
      const u0 = a0 * r, u1 = a1 * r;
      this.quad(mat, tier, p0, p1, q1, q0, [[u0, y0], [u1, y0], [u1, y0 + h], [u0, y0 + h]], col);
      if (cap && rTop > 0.01) this.tri(mat, tier, [cx, y0 + h, cz], q0, q1, [0, 0], [q0[0] - cx, q0[2] - cz], [q1[0] - cx, q1[2] - cz], col);
    }
  }
  flush(add, x, z) {
    for (const l of this.lists.values()) {
      const n = l.pos.length / 3;
      if (!n) continue;
      const pos = new Float32Array(l.pos);
      let r = 0;
      for (let i = 0; i < pos.length; i += 3) r = Math.max(r, Math.hypot(pos[i] - x, pos[i + 2] - z));
      add(x, z, l.mat, { count: n, pos, nrm: new Float32Array(l.nrm), uv: new Float32Array(l.uv), col: l.col ? new Float32Array(l.col) : null, radius: Math.max(r, 12) }, l.tier);
    }
    this.lists.clear();
  }
}

// ------------------------------------------------------------------ a face of a building
// The face of the box [x0, x1] x [z0, z1] whose outward normal is (nx, nz): where its left end is (seen from
// outside), which way it runs, how long it is.
function faceOf(x0, x1, z0, z1, nx, nz) {
  const tx = nz, tz = -nx;
  const ax = tx > 0 ? x0 : tx < 0 ? x1 : nx > 0 ? x1 : x0;
  const az = tz > 0 ? z0 : tz < 0 ? z1 : nz > 0 ? z1 : z0;
  return { ax, az, tx, tz, nx, nz, len: tx ? x1 - x0 : z1 - z0 };
}
const FACES = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // front, right, back, left (their outward normals)
// The same wall of that box seen from inside it: its normal points into the box.
function innerFace(x0, x1, z0, z1, nx, nz) {
  const tx = -nz, tz = nx;
  const ax = tx > 0 ? x0 : tx < 0 ? x1 : nx > 0 ? x1 : x0;
  const az = tz > 0 ? z0 : tz < 0 ? z1 : nz > 0 ? z1 : z0;
  return { ax, az, tx, tz, nx: -nx, nz: -nz, len: tx ? x1 - x0 : z1 - z0 };
}
// a point of a face: s along it, y up, d into the wall
const fp = (F, s, y, d = 0) => [F.ax + F.tx * s - F.nx * d, y, F.az + F.tz * s - F.nz * d];

// a rectangle of a face, flat on it at depth d: the wall itself (u in metres along the building, v the height)
function wallQuad(S, F, mat, tier, s0, s1, y0, y1, d = 0, col = WHITE) {
  if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
  const u = F.u0 || 0;
  S.quad(mat, tier, fp(F, s0, y0, d), fp(F, s1, y0, d), fp(F, s1, y1, d), fp(F, s0, y1, d), [[u + s0, S.oy + y0], [u + s1, S.oy + y0], [u + s1, S.oy + y1], [u + s0, S.oy + y1]], col);
}
// the same, facing the other way (the inside of a wall that is seen from behind)
function wallBack(S, F, mat, tier, s0, s1, y0, y1, d, col = WHITE) {
  if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
  S.quad(mat, tier, fp(F, s1, y0, d), fp(F, s0, y0, d), fp(F, s0, y1, d), fp(F, s1, y1, d), [[s0, y0], [s1, y0], [s1, y1], [s0, y1]], col);
}
// a box in a face's frame: s0..s1 along, y0..y1 up, d0..d1 into the wall (d0 < d1; the far face is left out when
// `open`)
function faceBox(S, F, mat, tier, s0, s1, y0, y1, d0, d1, col = WHITE, open = true) {
  const a = fp(F, (s0 + s1) / 2, (y0 + y1) / 2, (d0 + d1) / 2);
  // (the face's frame turned into the building's: a box along x there is along t here)
  S.box(mat, tier, a[0], a[1], a[2], F.tx ? s1 - s0 : d1 - d0, y1 - y0, F.tx ? d1 - d0 : s1 - s0, { c: col, skip: open ? (F.nx > 0 ? 2 : F.nx < 0 ? 1 : F.nz > 0 ? 32 : 16) : 0 });
}
// a decal from the city's atlas laid on a face: its middle (s, y), its size; grime: blended (soot, rust, damp) -
// otherwise cut out (lettering, ivy, a board)
function decal(S, F, name, s, y, w, h, grime = true, tier = TIER.STREET, d = -0.02) {
  S.cell(grime ? 'citygrime' : 'citysign', tier, name, fp(F, s - w / 2, y - h / 2, d), fp(F, s + w / 2, y - h / 2, d), fp(F, s + w / 2, y + h / 2, d), fp(F, s - w / 2, y + h / 2, d));
}

// ------------------------------------------------------------------ styles
// bay: the width a window takes of a wall. win: [w, h] of the opening. sill: its foot over the storey's floor.
// rec: how deep the glass stands in the wall. frame: what the window's frame is made of.
const STYLE = {
  walkup: { bay: 3.0, win: [1.1, 1.75], sill: 0.8, rec: 0.2, frame: 'sash', stone: true, cornice: 0.34, roof: ['tank', 'bulkhead', 'vents'] },
  shopflat: { bay: 3.1, win: [1.2, 1.6], sill: 0.85, rec: 0.18, frame: 'sash', stone: true, cornice: 0.26, roof: ['bulkhead', 'vents', 'aerial'] },
  slab: { bay: 3.4, win: [1.7, 1.45], sill: 0.95, rec: 0.14, frame: 'metal', balcony: true, cornice: 0, roof: ['bulkhead', 'vents', 'aerial', 'plant'] },
  office: { bay: 3.2, win: [2.5, 1.75], sill: 0.85, rec: 0.26, frame: 'metal', fins: true, cornice: 0, roof: ['plant', 'bulkhead', 'aerial', 'billboard'] },
  glass: { bay: 1.75, win: [1.6, 2.2], sill: 0.7, rec: 0.1, frame: 'metal', curtain: true, cornice: 0, roof: ['plant', 'bulkhead', 'aerial'] },
  warehouse: { bay: 4.4, win: [2.8, 2.2], sill: 1.1, rec: 0.22, frame: 'metal', panes: true, cornice: 0.2, roof: ['skylights', 'vents', 'tank'] },
  stone: { bay: 3.4, win: [1.2, 2.2], sill: 0.9, rec: 0.3, frame: 'trim', stone: true, cornice: 0.4, roof: ['bulkhead'] },
};
// faded paint for a rendered front (the 'plaster' material takes it as a vertex colour)
const STUCCO = [[0.78, 0.72, 0.56], [0.62, 0.7, 0.74], [0.8, 0.66, 0.6], [0.72, 0.74, 0.62], [0.82, 0.8, 0.72], [0.66, 0.6, 0.52], [0.58, 0.66, 0.6]];
const ROOM_TINT = [[0.86, 0.9, 0.8], [0.92, 0.86, 0.7], [0.82, 0.86, 0.92], [0.94, 0.9, 0.84], [0.9, 0.8, 0.76], [0.8, 0.84, 0.74]];
const CURTAIN = [[0.6, 0.56, 0.44], [0.42, 0.5, 0.5], [0.62, 0.42, 0.36], [0.7, 0.7, 0.66]];

// what a window is: 0 glass, 1 broken (shards in the frame), 2 gone, 3 boarded
function windowState(seed, face, floor, bay, wear, burnt) {
  if (burnt) return 2;
  const r = hash(seed, face * 131 + floor, bay, 7);
  const whole = 0.42 * (1 - wear);
  if (r < whole) return 0;
  if (r < whole + 0.26) return 1;
  if (r < 0.93 - (floor === 0 ? 0.08 : 0)) return 2;
  return 3;
}

// One storey of a face, from s0 to s1 of it (the whole face is F.len long: the bays are counted over all of it, so
// the windows stand one over another whatever is left of each storey). y0: the storey's floor. B: the building.
function storeyWall(S, F, B, fi, floor, y0, s0, s1) {
  const st = B.st;
  const mat = B.wall;
  const col = B.tint;
  const fh = B.fh;
  const blank = B.blank & (1 << fi);
  if (blank) {
    wallQuad(S, F, mat, TIER.FAR, s0, s1, y0, y0 + fh, 0, col);
    return;
  }
  if (st.curtain) return curtainWall(S, F, B, fi, floor, y0, s0, s1);
  const n = Math.max(1, Math.round(F.len / st.bay));
  const bw = F.len / n;
  const ww = Math.min(st.win[0], bw - 0.5);
  const wy0 = y0 + st.sill;
  const wy1 = Math.min(y0 + fh - 0.32, wy0 + st.win[1]);
  // the wall under and over the row of windows
  wallQuad(S, F, mat, TIER.FAR, s0, s1, y0, wy0, 0, col);
  wallQuad(S, F, mat, TIER.FAR, s0, s1, wy1, y0 + fh, 0, col);
  let at = s0;
  for (let b = 0; b < n; b++) {
    const c = (b + 0.5) * bw;
    const a0 = c - ww / 2, a1 = c + ww / 2;
    if (a0 < s0 + 0.15 || a1 > s1 - 0.15) continue; // (a window the break ran through: wall to its edge)
    wallQuad(S, F, mat, TIER.FAR, at, a0, wy0, wy1, 0, col);
    at = a1;
    windowAt(S, F, B, fi, floor, b, a0, a1, wy0, wy1);
  }
  wallQuad(S, F, mat, TIER.FAR, at, s1, wy0, wy1, 0, col);
}

// One storey of a curtain wall, s0..s1 of the face: a band of steel at the slab, and over it glass from mullion to
// mullion up to the next - what is left of it. A pane still in its frame is glass (some of them tipped enough to
// throw the sky back, which is what says glass from across the city); one in six hangs broken; the rest are gone,
// and through them the storey itself is seen: its floor, the underside of the slab over it, its columns standing
// back from the edge, a desk, and the dark beyond.
const CURTAIN_IN = 3; // how far in from the glass a storey is built
function curtainWall(S, F, B, fi, floor, y0, s0, s1) {
  const st = B.st;
  const fh = B.fh;
  const n = Math.max(1, Math.round(F.len / st.bay));
  const bw = F.len / n;
  const ya = y0 + 0.46, yb = y0 + fh; // (the spandrel: the slab's edge and the upstand over it)
  wallQuad(S, F, B.wall, TIER.FAR, s0, s1, y0, ya, 0, B.tint);
  const whole = 0.62 * (1 - B.wear * 0.45);
  const sky = S.dir(F.nx * 0.95, 0.3, F.nz * 0.95);
  const SHADE = [0.4, 0.42, 0.44];
  let gone = 0;
  for (let b = 0; b < n; b++) {
    // (a mullion at each bay line: a strip of it here, whatever the distance; trimOf stands the bar itself proud of it)
    if (b * bw > s0 + 0.05 && b * bw < s1 - 0.05) wallQuad(S, F, 'metal', TIER.FAR, b * bw - 0.05, b * bw + 0.05, ya, yb, -0.015);
    const a0 = Math.max(s0, b * bw + 0.05), a1 = Math.min(s1, (b + 1) * bw - 0.05);
    if (a1 - a0 < 0.25) continue;
    const r = hash(B.seed, fi * 131 + floor, b, 7);
    const h1 = hash(B.seed, b, floor, fi + 310), h2 = hash(B.seed, b, floor, fi + 311);
    const uo = r * 40, vo = h1 * 5;
    const pane = (q0, q1, q2, q3, tip) => S.quad('glass', TIER.FAR, fp(F, q0[0], q0[1], 0.03), fp(F, q1[0], q1[1], 0.03), fp(F, q2[0], q2[1], 0.03), fp(F, q3[0], q3[1], 0.03), [[uo + q0[0], vo + q0[1]], [uo + q1[0], vo + q1[1]], [uo + q2[0], vo + q2[1]], [uo + q3[0], vo + q3[1]]], WHITE, tip ? sky : null);
    if (r < whole) pane([a0, ya], [a1, ya], [a1, yb], [a0, yb], h1 < 0.3);
    else if (r < whole + 0.14) {
      // (what is left of the sheet: a piece of it standing in the foot of the frame, or hanging from its head)
      gone++;
      const m = ya + (yb - ya) * (0.3 + 0.45 * h2);
      if (h1 < 0.5) pane([a0, ya], [a1, ya], [a1, m], [a0, ya + (m - ya) * (0.25 + h1)], h2 < 0.5);
      else pane([a0, m], [a1, yb - (yb - m) * (h1 - 0.4)], [a1, yb], [a0, yb], h2 < 0.5);
    } else gone++;
  }
  if (!gone) {
    wallQuad(S, F, 'dark', TIER.FAR, s0, s1, ya, yb, 0.06);
    return;
  }
  // the storey behind the glass. (The faces at either side build theirs too: these stop short of the corners, so no
  // two floors lie in one another.)
  const D = Math.min(CURTAIN_IN, (F.tx ? B.d : B.w) / 2 - 0.3);
  const side = fi & 1;
  const i0 = side ? Math.max(s0, D) : s0, i1 = side ? Math.min(s1, F.len - D) : s1;
  if (i1 - i0 > 0.3) {
    S.quad('concrete', TIER.FAR, fp(F, i0, y0 + 0.02, 0.02), fp(F, i1, y0 + 0.02, 0.02), fp(F, i1, y0 + 0.02, D), fp(F, i0, y0 + 0.02, D), [[i0, 0], [i1, 0], [i1, D], [i0, D]]);
    S.quad('concrete', TIER.FAR, fp(F, i1, yb - 0.24, 0.02), fp(F, i0, yb - 0.24, 0.02), fp(F, i0, yb - 0.24, D), fp(F, i1, yb - 0.24, D), [[i1, 0], [i0, 0], [i0, D], [i1, D]], WHITE, CEIL_N);
  }
  // (its back wall: what is left of the partitions, in the shade of the floor over it - and the doors through them, dark)
  {
    const b0 = Math.max(s0, D), b1 = Math.min(s1, F.len - D);
    wallQuad(S, F, 'plaster', TIER.FAR, b0, b1, y0, yb - 0.24, D, SHADE);
    for (let s = b0 + 2.2 + hash(B.seed, floor, fi, 330) * 3; s < b1 - 1.4; s += 5 + hash(B.seed, floor, fi + (s | 0), 331) * 4) wallQuad(S, F, 'dark', TIER.FAR, s, s + 1.0, y0, y0 + 2.1, D - 0.02);
  }
  for (let b = 0; b <= n; b += 3) {
    const sa = Math.min(F.len - 0.9, Math.max(0.9, b * bw));
    if (sa < s0 + 0.4 || sa > s1 - 0.4) continue;
    const c = fp(F, sa, 0, 1.15);
    S.box('concrete', TIER.FAR, c[0], (y0 + yb - 0.24) / 2, c[2], 0.44, fh - 0.24, 0.44, { skip: 12 });
    // (a desk left where it stood, a cabinet on its side: enough to say somebody worked here)
    const hk = hash(B.seed, b, floor, fi + 320);
    if (hk > 0.55 || sa + 2.4 > s1 - 0.4) continue;
    const e = fp(F, sa + 1.6, 0, 1.5 + hk);
    S.box('wood', TIER.STREET, e[0], y0 + 0.4, e[2], F.tx ? 1.5 : 0.75, 0.76, F.tx ? 0.75 : 1.5, { c: [0.5, 0.44, 0.36], ry: (hk - 0.3) * 0.8, skip: 8 });
  }
}

// a window opening a0..a1 x y0..y1 of a face: the reveals, what is in it, and from near its frame, sill and lintel
function windowAt(S, F, B, fi, floor, bay, a0, a1, y0, y1, o = {}) {
  const st = B.st;
  const mat = B.wall;
  const col = B.tint;
  const rec = o.rec ?? st.rec;
  const state = o.state ?? windowState(B.seed, fi, floor, bay, B.wear, B.burnt);
  const w = a1 - a0, h = y1 - y0;
  // reveals: the thickness of the wall round the opening
  const u = F.u0 || 0;
  const rv = (p0, p1, p2, p3, uw, uh) => S.quad(mat, TIER.FAR, p0, p1, p2, p3, [[u, 0], [u + uw, 0], [u + uw, uh], [u, uh]], col);
  rv(fp(F, a0, y0, 0), fp(F, a0, y0, rec), fp(F, a0, y1, rec), fp(F, a0, y1, 0), rec, h);
  rv(fp(F, a1, y0, rec), fp(F, a1, y0, 0), fp(F, a1, y1, 0), fp(F, a1, y1, rec), rec, h);
  rv(fp(F, a0, y0, 0), fp(F, a1, y0, 0), fp(F, a1, y0, rec), fp(F, a0, y0, rec), w, rec);
  rv(fp(F, a0, y1, rec), fp(F, a1, y1, rec), fp(F, a1, y1, 0), fp(F, a0, y1, 0), w, rec);
  // what stands in it
  const hk = hash(B.seed, fi * 977 + floor * 31 + bay, 3);
  if (state === 0) {
    const uo = hk * 5, vo = hash(B.seed, bay, floor, fi) * 5;
    S.quad('glass', TIER.FAR, fp(F, a0, y0, rec), fp(F, a1, y0, rec), fp(F, a1, y1, rec), fp(F, a0, y1, rec), [[uo, vo], [uo + w, vo], [uo + w, vo + h], [uo, vo + h]]);
  } else if (!o.through) {
    S.quad('dark', TIER.FAR, fp(F, a0, y0, rec), fp(F, a1, y0, rec), fp(F, a1, y1, rec), fp(F, a0, y1, rec));
  }
  if (state === 3) {
    // boarded: planks nailed across it from outside, none of them level
    const nb = Math.max(3, Math.round(h / 0.34));
    for (let k = 0; k < nb; k++) {
      const by = y0 + ((k + 0.5) * h) / nb;
      const tilt = (hash(B.seed, bay * 13 + k, floor, fi + 40) - 0.5) * 0.09;
      const c0 = fp(F, a0 - 0.1, by - 0.13 - tilt, -0.02), c1 = fp(F, a1 + 0.1, by - 0.13 + tilt, -0.02), c2 = fp(F, a1 + 0.1, by + 0.13 + tilt, -0.02), c3 = fp(F, a0 - 0.1, by + 0.13 - tilt, -0.02);
      S.quad('planks', k % 2 ? TIER.STREET : TIER.FAR, c0, c1, c2, c3, [[0, by], [w + 0.2, by], [w + 0.2, by + 0.26], [0, by + 0.26]]);
    }
  }
  // ---- from near
  const T = TIER.DETAIL;
  const fr = st.frame;
  const ft = 0.06; // the frame's width
  if (state !== 3) {
    // the frame, proud of the glass: four strips, and what divides the panes
    faceBox(S, F, fr, T, a0, a0 + ft, y0, y1, rec - 0.05, rec);
    faceBox(S, F, fr, T, a1 - ft, a1, y0, y1, rec - 0.05, rec);
    faceBox(S, F, fr, T, a0 + ft, a1 - ft, y1 - ft, y1, rec - 0.05, rec);
    faceBox(S, F, fr, T, a0 + ft, a1 - ft, y0, y0 + ft, rec - 0.05, rec);
    if (st.panes) {
      for (let k = 1; k < 4; k++) faceBox(S, F, fr, T, a0 + (k * w) / 4 - 0.02, a0 + (k * w) / 4 + 0.02, y0 + ft, y1 - ft, rec - 0.04, rec);
      for (let k = 1; k < 3; k++) faceBox(S, F, fr, T, a0 + ft, a1 - ft, y0 + (k * h) / 3 - 0.02, y0 + (k * h) / 3 + 0.02, rec - 0.04, rec);
      // (panes of it put out one at a time)
      if (state === 0) {
        for (let k = 0; k < 12; k++) {
          if (hash(B.seed, k + bay * 12, floor * 7 + fi, 21) > 0.4) continue;
          const px = a0 + ((k % 4) * w) / 4, py = y0 + (((k / 4) | 0) * h) / 3;
          S.quad('dark', T, fp(F, px + 0.03, py + 0.03, rec - 0.008), fp(F, px + w / 4 - 0.03, py + 0.03, rec - 0.008), fp(F, px + w / 4 - 0.03, py + h / 3 - 0.03, rec - 0.008), fp(F, px + 0.03, py + h / 3 - 0.03, rec - 0.008));
        }
      }
    } else if (!st.curtain) {
      faceBox(S, F, fr, T, a0 + ft, a1 - ft, y0 + h * 0.5 - 0.025, y0 + h * 0.5 + 0.025, rec - 0.045, rec);
      if (w > 1.5) faceBox(S, F, fr, T, a0 + w / 2 - 0.025, a0 + w / 2 + 0.025, y0 + ft, y1 - ft, rec - 0.045, rec);
    }
  }
  if (state === 1) {
    // what is left of the pane: teeth of glass standing in the frame
    const ns = 5 + ((hk * 5) | 0);
    for (let k = 0; k < ns; k++) {
      const e = k % 4; // which edge it stands on
      const t = hash(B.seed, k * 17 + bay, floor, fi + 9);
      const len = (0.14 + hash(B.seed, k, bay * 3 + floor, fi + 5) * 0.5) * Math.min(w, h) * 0.8;
      const wd = 0.12 + t * 0.3;
      let p0, p1, p2;
      if (e === 0) [p0, p1, p2] = [[a0 + ft + t * (w - 0.4), y0 + ft], [a0 + ft + t * (w - 0.4) + wd, y0 + ft], [a0 + ft + t * (w - 0.4) + wd * 0.4, y0 + ft + len]];
      else if (e === 1) [p0, p1, p2] = [[a0 + ft + t * (w - 0.4) + wd, y1 - ft], [a0 + ft + t * (w - 0.4), y1 - ft], [a0 + ft + t * (w - 0.4) + wd * 0.6, y1 - ft - len]];
      else if (e === 2) [p0, p1, p2] = [[a0 + ft, y0 + ft + t * (h - 0.4) + wd], [a0 + ft, y0 + ft + t * (h - 0.4)], [a0 + ft + len * 0.7, y0 + ft + t * (h - 0.4) + wd * 0.5]];
      else [p0, p1, p2] = [[a1 - ft, y0 + ft + t * (h - 0.4)], [a1 - ft, y0 + ft + t * (h - 0.4) + wd], [a1 - ft - len * 0.7, y0 + ft + t * (h - 0.4) + wd * 0.5]];
      S.tri('glass', T, fp(F, p0[0], p0[1], rec - 0.02), fp(F, p1[0], p1[1], rec - 0.02), fp(F, p2[0], p2[1], rec - 0.02), [p0[0], p0[1]], [p1[0], p1[1]], [p2[0], p2[1]]);
    }
  }
  if ((state === 1 || state === 2) && !st.curtain && !st.panes && !B.burnt && hk < 0.4) {
    // a curtain still hanging in it, what is left of one
    const cc = CURTAIN[((hk * 40) | 0) % CURTAIN.length];
    const side = hk < 0.2;
    const cw = w * (0.22 + hk);
    const drop = h * (0.55 + hash(B.seed, bay, floor + 3, fi) * 0.4);
    const x0 = side ? a0 + ft : a1 - ft - cw;
    S.quad('cloth', T, fp(F, x0, y1 - ft - drop, rec - 0.012), fp(F, x0 + cw, y1 - ft - drop * 0.86, rec - 0.012), fp(F, x0 + cw, y1 - ft, rec - 0.012), fp(F, x0, y1 - ft, rec - 0.012), null, cc);
  }
  if (st.stone && !o.plain) {
    // a sill and a lintel of stone, the sill proud of the wall
    faceBox(S, F, 'concrete', T, a0 - 0.12, a1 + 0.12, y0 - 0.11, y0, -0.08, rec * 0.6, WHITE, false);
    faceBox(S, F, 'concrete', T, a0 - 0.16, a1 + 0.16, y1, y1 + 0.2, -0.03, 0.0);
  } else if (!st.curtain && !o.plain) {
    faceBox(S, F, 'concrete', T, a0 - 0.05, a1 + 0.05, y0 - 0.07, y0, -0.05, rec * 0.5, WHITE, false);
  }
  if (B.burnt || (state === 2 && hash(B.seed, bay, floor, fi + 77) < B.wear * 0.2)) {
    // soot up the wall over an opening a fire came out of
    const sw = w * (1.2 + hk * 0.5), sh = Math.min(B.fh * 1.25, h * (1.3 + hk));
    decal(S, F, hk < 0.5 ? 'soot_a' : 'soot_b', (a0 + a1) / 2 + (hk - 0.5) * 0.3, y1 - 0.12 + sh / 2, sw, sh, true, TIER.FAR, -0.025);
  } else if (hk > 0.72 && !st.curtain) {
    // what the rain ran down from the sill
    decal(S, F, hk > 0.86 ? 'stain_a' : 'stain_b', (a0 + a1) / 2, y0 - 0.1 - 0.75, w * 0.9, 1.5);
  }
  // a box of an air conditioner hung out of one, rust running from it
  if (state !== 3 && !st.curtain && !st.panes && hash(B.seed, bay * 5, floor * 3, fi + 11) < 0.07 && !B.burnt) {
    faceBox(S, F, 'metal', T, a0 + 0.12, a0 + 0.78, y0 + 0.02, y0 + 0.46, -0.42, rec, WHITE, false);
    decal(S, F, 'rust_a', a0 + 0.45, y0 - 0.8, 0.5, 1.6);
  }
}

// ------------------------------------------------------------------ a building
// B (from the world): { x, z, ry, y, w, d, floors, fh, style, mat, seed, cut, wear, burnt, blank, ground, top }.
//   cut[f]: [x0, x1, z0, z1], what stands of storey f in the building's frame (absent: all of it). A side of it that
//   is not on the building's own outline is a break: the storey is open there on its slab, columns and rooms.
//   top: 'roof' (whole, with what stands on a roof), 'slab' (the roof gone: a floor open to the sky)
function building(S, B0) {
  const st = STYLE[B0.style] || STYLE.walkup;
  const stucco = B0.mat === 'plaster';
  const B = {
    ...B0,
    st,
    wall: st.curtain ? 'metal' : B0.mat,
    tint: stucco ? STUCCO[(hash(B0.seed, 5) * STUCCO.length) | 0] : WHITE,
    wear: B0.wear ?? 0.5,
    blank: B0.blank || 0,
    ground: B0.ground || 0,
  };
  S.frame(B.x, B.y, B.z, B.ry);
  const hw = B.w / 2, hd = B.d / 2;
  const full = [-hw, hw, -hd, hd];
  const rectOf = (f) => (f < 0 ? full : f >= B.floors ? null : B.cut?.[f] || full);
  const rnd = rngOf(B.seed * 7 + 3);
  const E = 0.02;
  for (let f = 0; f < B.floors; f++) {
    const R = rectOf(f);
    const up = rectOf(f + 1);
    const y0 = f * B.fh, y1 = y0 + B.fh;
    const open = [];
    FACES.forEach(([nx, nz], fi) => {
      const FF = faceOf(...full, nx, nz);
      FF.u0 = fi * 17.3 + (B.seed % 13);
      // how far along the whole face this storey's wall runs
      const lo = FF.tx > 0 ? R[0] - full[0] : FF.tx < 0 ? full[1] - R[1] : FF.tz > 0 ? R[2] - full[2] : full[3] - R[3];
      const hi = lo + (FF.tx ? R[1] - R[0] : R[3] - R[2]);
      const onOutline = nx > 0 ? R[1] > full[1] - E : nx < 0 ? R[0] < full[0] + E : nz > 0 ? R[3] > full[3] - E : R[2] < full[2] + E;
      if (onOutline) storeyWall(S, FF, B, fi, f, y0, lo, hi);
      else open.push(fi);
    });
    if (open.length) openStorey(S, B, f, R, open, rnd);
    // what of this storey's roof is under the sky: a slab with the stumps of what stood on it
    if (!up) {
      if (B.top === 'slab') terrace(S, B, R, null, y1, rnd);
    } else if (up[0] > R[0] + E || up[1] < R[1] - E || up[2] > R[2] + E || up[3] < R[3] - E) terrace(S, B, R, up, y1, rnd);
  }
  const top = rectOf(B.floors - 1);
  const yT = B.floors * B.fh;
  const whole = top[0] < full[0] + E && top[1] > full[1] - E && top[2] < full[2] + E && top[3] > full[3] - E;
  if (B.top !== 'slab') roofOf(S, B, top, yT, whole, rnd);
  if (whole || B.floors > 1) trimOf(S, B, full, rectOf, rnd);
}

// the parts of rectangle A that B does not cover (B inside A): up to four rectangles
function minus(A, B) {
  const out = [];
  if (B[0] > A[0] + 0.01) out.push([A[0], B[0], A[2], A[3]]);
  if (B[1] < A[1] - 0.01) out.push([B[1], A[1], A[2], A[3]]);
  if (B[2] > A[2] + 0.01) out.push([Math.max(A[0], B[0]), Math.min(A[1], B[1]), A[2], B[2]]);
  if (B[3] < A[3] - 0.01) out.push([Math.max(A[0], B[0]), Math.min(A[1], B[1]), B[3], A[3]]);
  return out;
}

// A storey broken open on some of its sides: its floor and its ceiling's slab, their broken edges with the steel
// hanging out of them, the columns that carried it, and the rooms that are looked into.
function openStorey(S, B, f, R, open, rnd) {
  const y0 = f * B.fh, y1 = y0 + B.fh;
  const SLAB = 0.26;
  const tint = ROOM_TINT[(hash(B.seed, f, 91) * ROOM_TINT.length) | 0];
  // the floor and the underside of the slab over it
  S.quad(f % 2 ? 'planks' : 'concrete', TIER.FAR, [R[0], y0 + 0.01, R[3]], [R[1], y0 + 0.01, R[3]], [R[1], y0 + 0.01, R[2]], [R[0], y0 + 0.01, R[2]], [[R[0], R[3]], [R[1], R[3]], [R[1], R[2]], [R[0], R[2]]]);
  S.quad('concrete', TIER.FAR, [R[0], y1 - SLAB, R[2]], [R[1], y1 - SLAB, R[2]], [R[1], y1 - SLAB, R[3]], [R[0], y1 - SLAB, R[3]], [[R[0], R[2]], [R[1], R[2]], [R[1], R[3]], [R[0], R[3]]], WHITE, CEIL_N);
  for (const fi of open) {
    const [nx, nz] = FACES[fi];
    const F = faceOf(R[0], R[1], R[2], R[3], nx, nz);
    const L = F.len;
    const depth = (F.tx ? R[3] - R[2] : R[1] - R[0]) - 0.4;
    // the slab's broken edge, top and bottom: lengths of it, each broken off at its own place, and bars out of them
    const n = Math.max(2, Math.round(L / 1.7));
    for (const yb of [y0 - SLAB, y1 - SLAB]) {
      if (yb < -0.01) continue;
      let prev = 0;
      for (let k = 0; k < n; k++) {
        const a0 = (k * L) / n, a1 = ((k + 1) * L) / n;
        const out = -(hash(B.seed, f * 37 + k, fi, yb * 10) * 0.55); // (how far past the storey's line this length still reaches)
        S.quad('concrete', TIER.FAR, fp(F, a0, yb, out), fp(F, a1, yb, out), fp(F, a1, yb + SLAB, out), fp(F, a0, yb + SLAB, out));
        S.quad('concrete', TIER.FAR, fp(F, a0, yb + SLAB, out), fp(F, a1, yb + SLAB, out), fp(F, a1, yb + SLAB, 0.02), fp(F, a0, yb + SLAB, 0.02));
        S.quad('concrete', TIER.FAR, fp(F, a0, yb, 0.02), fp(F, a1, yb, 0.02), fp(F, a1, yb, out), fp(F, a0, yb, out));
        if (k && Math.abs(out - prev) > 0.02) {
          const [da, db] = out < prev ? [out, prev] : [prev, out];
          S.quad2('concrete', TIER.FAR, fp(F, a0, yb, da), fp(F, a0, yb, db), fp(F, a0, yb + SLAB, db), fp(F, a0, yb + SLAB, da));
        }
        prev = out;
        // rebar: out of the break and drooping
        for (let j = 0; j < 2; j++) {
          const hx = hash(B.seed, k * 5 + j, f * 3 + fi, 55);
          if (hx > 0.7) continue;
          const sa = a0 + (0.2 + 0.6 * hash(B.seed, k, j, f + fi * 9)) * (a1 - a0);
          const reach = 0.3 + hx * 1.1;
          const p0 = fp(F, sa, yb + SLAB * 0.5, out + 0.05), p1 = fp(F, sa + (hx - 0.35) * 0.5, yb + SLAB * 0.5 - reach * 0.25, out - reach * 0.7), p2 = fp(F, sa + (hx - 0.35) * 0.9, yb - reach * (0.5 + hx), out - reach);
          S.bar('rust', TIER.STREET, p0, p1, 0.035, WHITE, 3);
          S.bar('rust', TIER.STREET, p1, p2, 0.035, WHITE, 3);
        }
      }
    }
    // a slab of the floor above hanging down from its steel, here and there
    if (hash(B.seed, f, fi, 301) < 0.45 && L > 5) {
      const sa = L * (0.2 + 0.6 * hash(B.seed, f, fi, 302));
      const c = fp(F, sa, y1 - SLAB - 0.9, -0.5);
      S.box('concrete', TIER.FAR, c[0], c[1], c[2], F.tx ? 2.2 : 1.5, 0.22, F.tx ? 1.5 : 2.2, { rx: F.nz * 1.0, rz: -F.nx * 1.0 });
    }
    // the inside of the outer walls at either end of the break (where the next side is not broken open too)
    for (const [sa, dir] of [[0.03, -1], [L - 0.03, 1]]) {
      const nb = FACES.findIndex(([ax, az]) => ax === dir * F.tx && az === dir * F.tz);
      if (open.includes(nb)) continue;
      S.quad2('plaster', TIER.FAR, fp(F, sa, y0, 0), fp(F, sa, y0, Math.min(5.2, depth)), fp(F, sa, y1 - SLAB, Math.min(5.2, depth)), fp(F, sa, y1 - SLAB, 0), null, tint);
    }
    // columns, in from the edge
    const nc = Math.max(2, Math.round(L / 4.6) + 1);
    for (let k = 0; k < nc; k++) {
      const sa = 0.5 + (k * (L - 1)) / (nc - 1);
      const c = fp(F, sa, 0, 0.55);
      S.box('concrete', TIER.FAR, c[0], (y0 + y1 - SLAB) / 2, c[2], 0.45, y1 - SLAB - y0, 0.45, { skip: 12 });
    }
    // the rooms: a back wall a room's depth in, walls between them, each room papered or painted its own way
    const rd = Math.min(5.2, depth);
    if (rd > 1.2) {
      const nr = Math.max(1, Math.round(L / 4.8));
      for (let k = 0; k < nr; k++) {
        const a0 = (k * L) / nr, a1 = ((k + 1) * L) / nr;
        const rt = ROOM_TINT[(hash(B.seed, f * 7 + k, fi, 93) * ROOM_TINT.length) | 0];
        const dark = hash(B.seed, f, k, fi + 200) < 0.3 ? 0.55 : 1; // (a room the fire was in)
        const cc = [rt[0] * dark, rt[1] * dark, rt[2] * dark];
        // back wall, with the door out of the room dark in it
        const da = a0 + (a1 - a0) * (0.25 + 0.5 * hash(B.seed, f, k, fi + 60));
        wallQuad(S, F, 'plaster', TIER.FAR, a0, da - 0.45, y0, y1 - SLAB, rd, cc);
        wallQuad(S, F, 'plaster', TIER.FAR, da + 0.45, a1, y0, y1 - SLAB, rd, cc);
        wallQuad(S, F, 'plaster', TIER.FAR, da - 0.45, da + 0.45, y0 + 2.05, y1 - SLAB, rd, cc);
        wallQuad(S, F, 'dark', TIER.FAR, da - 0.45, da + 0.45, y0, y0 + 2.05, rd);
        // the wall between this room and the next (seen from both)
        if (k) {
          const tint2 = ROOM_TINT[(hash(B.seed, f * 7 + k - 1, fi, 93) * ROOM_TINT.length) | 0];
          const e = hash(B.seed, f, k, fi + 300) * 1.2; // (broken short of the edge)
          S.quad('plaster', TIER.FAR, fp(F, a0 + 0.06, y0, e), fp(F, a0 + 0.06, y0, rd), fp(F, a0 + 0.06, y1 - SLAB, rd), fp(F, a0 + 0.06, y1 - SLAB, e + 0.5), null, cc);
          S.quad('plaster', TIER.FAR, fp(F, a0 - 0.06, y0, rd), fp(F, a0 - 0.06, y0, e), fp(F, a0 - 0.06, y1 - SLAB, e + 0.5), fp(F, a0 - 0.06, y1 - SLAB, rd), null, tint2);
          S.quad('concrete', TIER.FAR, fp(F, a0 - 0.06, y0, e), fp(F, a0 + 0.06, y0, e), fp(F, a0 + 0.06, y1 - SLAB, e + 0.5), fp(F, a0 - 0.06, y1 - SLAB, e + 0.5));
        }
        // what was in it: a bed, a table, a cupboard - blocks of them, enough to say a room
        const fk = hash(B.seed, f * 11 + k, fi, 400);
        const c = fp(F, a0 + (a1 - a0) * (0.3 + fk * 0.4), 0, rd - 0.6);
        if (fk < 0.7) S.box(fk < 0.35 ? 'mattress' : 'wood', TIER.STREET, c[0], y0 + (fk < 0.35 ? 0.28 : 0.4), c[2], F.tx ? 1.9 : 1.0, fk < 0.35 ? 0.5 : 0.78, F.tx ? 1.0 : 1.9, { c: [0.5, 0.42, 0.32], rz: fk < 0.15 ? 0.2 : 0 });
        const c2 = fp(F, a0 + 0.5, 0, rd - 0.35);
        if (fk > 0.3) S.box('wood', TIER.STREET, c2[0], y0 + 0.95, c2[2], F.tx ? 0.9 : 0.5, 1.9, F.tx ? 0.5 : 0.9, { c: [0.42, 0.34, 0.26] });
        // a picture still on the wall
        if (fk > 0.55) decal(S, F, fk > 0.8 ? 'poster_a' : 'poster_c', (a0 + a1) / 2 + 1, y0 + 1.6, 0.6, 0.8, false, TIER.STREET, rd - 0.02);
      }
    }
  }
}

// What is left on a slab that is under the sky: the slab itself (R less `up`, the storey still standing on it), the
// stumps of its columns with their bars, low lengths of the walls that stood on its edge, rubble.
function terrace(S, B, R, up, y, rnd) {
  const rects = up ? minus(R, up) : [R];
  const hw = B.w / 2, hd = B.d / 2;
  for (const A of rects) {
    S.quad('concrete', TIER.FAR, [A[0], y, A[3]], [A[1], y, A[3]], [A[1], y, A[2]], [A[0], y, A[2]], [[A[0], A[3]], [A[1], A[3]], [A[1], A[2]], [A[0], A[2]]]);
    const w = A[1] - A[0], d = A[3] - A[2];
    // stumps
    for (let gx = A[0] + 0.8; gx < A[1] - 0.3; gx += 4.4) {
      for (let gz = A[2] + 0.8; gz < A[3] - 0.3; gz += 4.4) {
        const h = 0.3 + rnd() * 1.5;
        if (rnd() < 0.3) continue;
        S.box('concrete', TIER.FAR, gx, y + h / 2, gz, 0.45, h, 0.45, { skip: 8, rz: (rnd() - 0.5) * 0.12 });
        for (let j = 0; j < 3; j++) {
          const bx = gx + (rnd() - 0.5) * 0.3, bz = gz + (rnd() - 0.5) * 0.3;
          S.bar('rust', TIER.STREET, [bx, y + h - 0.05, bz], [bx + (rnd() - 0.5) * 0.7, y + h + 0.5 + rnd() * 1.1, bz + (rnd() - 0.5) * 0.7], 0.04, WHITE, 3);
        }
      }
    }
    // lengths of the outer wall still standing along the slab's edge, where that edge is the building's own
    const edges = [[A[2] < -hd + 0.05, 0, -1], [A[1] > hw - 0.05, 1, 0], [A[3] > hd - 0.05, 0, 1], [A[0] < -hw + 0.05, -1, 0]];
    for (const [on, nx, nz] of edges) {
      if (!on) continue;
      const F = faceOf(A[0], A[1], A[2], A[3], nx, nz);
      for (let s = 0; s < F.len - 0.4; ) {
        const len = Math.min(F.len - s, 1.2 + rnd() * 2.6);
        const h = rnd() < 0.3 ? 0 : 0.35 + rnd() * rnd() * (B.fh * 0.9);
        if (h > 0) {
          const j = h * (0.6 + rnd() * 0.4);
          const p = [fp(F, s, y, 0), fp(F, s + len, y, 0), fp(F, s + len, y + j, 0), fp(F, s, y + h, 0)];
          const q = [fp(F, s, y, 0.3), fp(F, s + len, y, 0.3), fp(F, s + len, y + j, 0.3), fp(F, s, y + h, 0.3)];
          S.quad(B.wall, TIER.FAR, p[0], p[1], p[2], p[3], [[s, y], [s + len, y], [s + len, y + j], [s, y + h]], B.tint);
          S.quad('plaster', TIER.FAR, q[1], q[0], q[3], q[2], null, ROOM_TINT[(rnd() * ROOM_TINT.length) | 0]);
          S.quad2(B.wall, TIER.FAR, p[3], p[2], q[2], q[3], null, B.tint);
          S.quad2(B.wall, TIER.FAR, q[0], p[0], p[3], q[3], null, B.tint);
          S.quad2(B.wall, TIER.FAR, p[1], q[1], q[2], p[2], null, B.tint);
        }
        s += len;
      }
    }
    // what fell on it
    const nh = Math.round((w * d) / 30);
    for (let k = 0; k < nh; k++) rubble(S, A[0] + 0.8 + rnd() * Math.max(0.1, w - 1.6), y, A[2] + 0.8 + rnd() * Math.max(0.1, d - 1.6), 0.7 + rnd() * 1.3, 0.7 + rnd() * 1.3, 0.3 + rnd() * 0.5, rnd, TIER.FAR, 7);
  }
}

// What stands on a roof that is still a roof.
function roofOf(S, B, R, y, whole, rnd) {
  const st = B.st;
  const w = R[1] - R[0], d = R[3] - R[2];
  S.quad('roofing', TIER.FAR, [R[0], y, R[3]], [R[1], y, R[3]], [R[1], y, R[2]], [R[0], y, R[2]], [[R[0], R[3]], [R[1], R[3]], [R[1], R[2]], [R[0], R[2]]]);
  if (!whole) return;
  // the parapet: a low wall round it with a coping, a length of it gone
  const ph = st.curtain ? 0.4 : 0.75;
  const gone = (hash(B.seed, 71) * 6) | 0;
  FACES.forEach(([nx, nz], fi) => {
    const F = faceOf(R[0], R[1], R[2], R[3], nx, nz);
    F.u0 = fi * 17.3 + (B.seed % 13);
    const g0 = fi === gone ? F.len * 0.3 : -1, g1 = fi === gone ? F.len * 0.3 + 2 + hash(B.seed, 72) * 4 : -1;
    for (const [a, b] of fi === gone ? [[0, g0], [Math.min(g1, F.len), F.len]] : [[0, F.len]]) {
      if (b - a < 0.05) continue;
      wallQuad(S, F, B.wall, TIER.FAR, a, b, y, y + ph, 0, B.tint);
      wallBack(S, F, B.wall, TIER.FAR, a, b, y, y + ph, 0.25, B.tint);
      faceBox(S, F, 'concrete', TIER.FAR, a, b, y + ph, y + ph + 0.1, -0.06, 0.31, WHITE, false);
    }
  });
  const want = (k) => st.roof.includes(k);
  const at = () => [R[0] + 1.8 + rnd() * Math.max(0.1, w - 3.6), R[2] + 1.8 + rnd() * Math.max(0.1, d - 3.6)];
  if (want('bulkhead') && w > 6 && d > 6) {
    // the head of the stairs: a brick hut with its door hanging open
    const [bx, bz] = [R[0] + w * 0.3, R[2] + d * 0.6];
    S.box(B.wall === 'metal' ? 'concrete' : B.wall, TIER.FAR, bx, y + 1.3, bz, 3, 2.6, 3.4, { skip: 8, c: B.tint });
    S.box('concrete', TIER.FAR, bx, y + 2.66, bz, 3.3, 0.12, 3.7);
    S.box('dark', TIER.FAR, bx, y + 1.02, bz - 1.71, 0.95, 2.0, 0.03);
    S.box('rust', TIER.STREET, bx + 0.7, y + 1.02, bz - 2.0, 0.05, 2.0, 0.9, { ry: 0.5 });
  }
  if (want('tank') && hash(B.seed, 81) < 0.6 && w > 8) {
    // a wooden water tank on its steel legs
    const [tx, tz] = [R[0] + w * 0.72, R[2] + d * 0.35];
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) S.bar('rust', TIER.FAR, [tx + lx * 1.0, y, tz + lz * 1.0], [tx + lx * 0.9, y + 2.4, tz + lz * 0.9], 0.14);
    for (const [a, b] of [[[-1, -1], [1, 1]], [[1, -1], [-1, 1]]]) S.bar('rust', TIER.STREET, [tx + a[0], y + 0.2, tz + a[1]], [tx + b[0] * 0.9, y + 2.3, tz + b[1] * 0.9], 0.06);
    S.box('rust', TIER.FAR, tx, y + 2.45, tz, 2.5, 0.12, 2.5);
    S.cyl('planks', TIER.FAR, tx, y + 2.5, tz, 1.35, 2.6, 12, false);
    S.cyl('tin_rust', TIER.FAR, tx, y + 5.1, tz, 1.45, 0.75, 12, false, WHITE, 0.02);
    for (const hy of [2.9, 3.8, 4.7]) S.cyl('rust', TIER.STREET, tx, y + hy, tz, 1.37, 0.07, 12, false);
  }
  if (want('plant') && w > 10) {
    // the plant: chillers in a row, a duct between them
    const n = 2 + ((hash(B.seed, 82) * 3) | 0);
    for (let k = 0; k < n; k++) {
      const px = R[0] + w * 0.55 + k * 2.6, pz = R[2] + d * 0.3;
      if (px > R[1] - 1.6) break;
      S.box('metal', TIER.FAR, px, y + 0.85, pz, 2.1, 1.5, 1.6, { skip: 8 });
      S.cyl('dark', TIER.STREET, px, y + 1.6, pz, 0.6, 0.06, 10);
      S.box('rust', TIER.STREET, px, y + 0.08, pz, 2.3, 0.16, 1.8);
    }
    S.box('tin_rust', TIER.FAR, R[0] + w * 0.55 + 1.3, y + 0.5, R[2] + d * 0.3 + 1.5, n * 2.6, 0.5, 0.6);
  }
  if (want('vents')) {
    for (let k = 0; k < 3; k++) {
      const [vx, vz] = at();
      S.cyl('tin_rust', TIER.STREET, vx, y, vz, 0.2, 0.7 + rnd() * 0.5, 7, false);
      S.cyl('tin_rust', TIER.STREET, vx, y + 0.95 + rnd() * 0.2, vz, 0.34, 0.2, 7, true, WHITE, 0.05);
    }
  }
  if (want('aerial') && hash(B.seed, 83) < 0.6) {
    const [ax, az] = at();
    const lean = (rnd() - 0.5) * 0.6;
    S.bar('rust', TIER.FAR, [ax, y, az], [ax + lean, y + 4.6, az], 0.07);
    for (const hy of [3.2, 3.8, 4.3]) S.bar('rust', TIER.STREET, [ax + lean * (hy / 4.6) - 0.6, y + hy, az], [ax + lean * (hy / 4.6) + 0.6, y + hy, az], 0.03);
  }
  if (want('skylights')) {
    for (let k = 0; k < Math.floor(w / 7); k++) {
      const sx = R[0] + 3.5 + k * 7;
      S.box('metal', TIER.FAR, sx, y + 0.25, R[2] + d / 2, 2.2, 0.5, d * 0.5, { skip: 8 });
      S.box(hash(B.seed, k, 84) < 0.5 ? 'glass' : 'dark', TIER.FAR, sx, y + 0.51, R[2] + d / 2, 1.9, 0.02, d * 0.5 - 0.3, { skip: 8 });
    }
  }
  if (want('billboard') && hash(B.seed, 85) < 0.5 && w > 14) {
    // a hoarding on a steel frame, facing the street
    const bw = 9, bh = 4.4, by = y + 1.6;
    const z = R[2] + 1.0;
    for (const px of [-3.4, 0, 3.4]) {
      S.bar('rust', TIER.FAR, [px, y, z + 0.3], [px, by + bh, z + 0.3], 0.16);
      S.bar('rust', TIER.STREET, [px, y, z + 2.2], [px, by + bh * 0.7, z + 0.36], 0.1);
    }
    S.box('metal', TIER.FAR, 0, by + bh / 2, z + 0.14, bw, bh, 0.12);
    S.cell('citysign', TIER.FAR, hash(B.seed, 86) < 0.5 ? 'billboard_a' : 'billboard_b', [bw / 2, by, z + 0.06], [-bw / 2, by, z + 0.06], [-bw / 2, by + bh, z + 0.06], [bw / 2, by + bh, z + 0.06]);
  }
  // weeds on the roof, where the damp stands
  for (let k = 0; k < 4; k++) {
    const [wx, wz] = at();
    weedsAt(S, wx, y, wz, 0.5 + rnd() * 0.6, rnd);
  }
}

// a clump of weeds: crossed cards of the island's blades
function weedsAt(S, x, y, z, h, rnd, tier = TIER.STREET) {
  for (let k = 0; k < 2; k++) {
    const a = rnd() * PI + (k * PI) / 2;
    const dx = Math.cos(a) * 0.3, dz = Math.sin(a) * 0.3;
    S.quad('weeds', tier, [x - dx, y, z - dz], [x + dx, y, z + dz], [x + dx, y + h, z + dz], [x - dx, y + h, z - dz], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.78, 0.8, 0.7]);
    S.quad('weeds', tier, [x + dx, y, z + dz], [x - dx, y, z - dz], [x - dx, y + h, z - dz], [x + dx, y + h, z + dz], [[1, 0], [0, 0], [0, 1], [1, 1]], [0.78, 0.8, 0.7]);
  }
}

// What runs over the whole height of a building, face by face: the cornice under its parapet, the fins of an
// office block, string courses, a fire escape, balconies, a drainpipe, and what the years put on the wall.
function trimOf(S, B, full, rectOf, rnd) {
  const st = B.st;
  const H = B.floors * B.fh;
  const topR = rectOf(B.floors - 1);
  const E = 0.02;
  const wholeTop = topR[0] < full[0] + E && topR[1] > full[1] - E && topR[2] < full[2] + E && topR[3] > full[3] - E;
  // how many storeys of face fi stand the whole length of it (the trim stops there)
  const wholeUpTo = (fi) => {
    const [nx, nz] = FACES[fi];
    let n = 0;
    for (; n < B.floors; n++) {
      const R = rectOf(n);
      const on = nx > 0 ? R[1] > full[1] - E : nx < 0 ? R[0] < full[0] + E : nz > 0 ? R[3] > full[3] - E : R[2] < full[2] + E;
      const span = nx ? R[2] < full[2] + E && R[3] > full[3] - E : R[0] < full[0] + E && R[1] > full[1] - E;
      if (!on || !span) break;
    }
    return n;
  };
  const escapeFace = st.cornice && !B.burnt && hash(B.seed, 101) < 0.75 ? (hash(B.seed, 102) < 0.6 ? 0 : 2) : -1;
  FACES.forEach(([nx, nz], fi) => {
    const F = faceOf(...full, nx, nz);
    F.u0 = fi * 17.3 + (B.seed % 13);
    const nf = wholeUpTo(fi);
    const h = nf * B.fh;
    if (nf < 1) return;
    const n = Math.max(1, Math.round(F.len / st.bay));
    const bw = F.len / n;
    const blank = B.blank & (1 << fi);
    if (st.cornice && wholeTop && nf === B.floors) {
      // the cornice: a course standing out under the parapet, on brackets
      faceBox(S, F, 'concrete', TIER.FAR, -0.1, F.len + 0.1, H - 0.42, H - 0.08, -st.cornice, 0, WHITE);
      faceBox(S, F, 'concrete', TIER.FAR, -0.05, F.len + 0.05, H - 0.62, H - 0.42, -st.cornice * 0.45, 0, WHITE);
      for (let k = 0; k <= n * 3; k++) faceBox(S, F, 'concrete', TIER.DETAIL, (k * F.len) / (n * 3) - 0.07, (k * F.len) / (n * 3) + 0.07, H - 0.84, H - 0.62, -st.cornice * 0.7, 0);
    }
    if (st.stone && !blank) {
      // a string course under each row of sills
      for (let f = 1; f < nf; f++) faceBox(S, F, 'concrete', TIER.STREET, 0, F.len, f * B.fh - 0.06, f * B.fh + 0.1, -0.05, 0);
    }
    if (st.fins && !blank) {
      // fins from the ground floor's head to the roof, one at each bay line; a band at every floor
      for (let k = 0; k <= n; k++) faceBox(S, F, 'concrete', TIER.FAR, k * bw - 0.17, k * bw + 0.17, 0, h, -0.3, 0);
      for (let f = 0; f <= nf; f++) faceBox(S, F, 'concrete', TIER.FAR, 0, F.len, Math.max(0, f * B.fh - 0.2), Math.min(h, f * B.fh + 0.22), -0.12, 0);
    }
    if (st.curtain) {
      // the curtain wall's frame: a mullion at each bay line, a transom at each slab
      for (let k = 0; k <= n; k++) faceBox(S, F, 'metal', TIER.STREET, k * bw - 0.045, k * bw + 0.045, 0, h, -0.07, 0);
      for (let f = 0; f <= nf; f++) faceBox(S, F, 'concrete', TIER.FAR, 0, F.len, Math.max(0, f * B.fh - 0.14), Math.min(h, f * B.fh + 0.14), -0.03, 0);
    }
    if (st.balcony && !blank && (fi === 0 || fi === 2)) {
      // balconies, every other bay: a slab, a rail of rusted iron
      for (let f = 0; f < nf; f++) {
        for (let b = fi; b < n; b += 2) {
          const a0 = b * bw + 0.25, a1 = (b + 1) * bw - 0.25;
          const y = f * B.fh;
          if (hash(B.seed, f * 31 + b, fi, 111) < 0.12) continue; // (one gone)
          faceBox(S, F, 'concrete', TIER.FAR, a0, a1, y - 0.16, y, -1.15, 0);
          faceBox(S, F, 'rust', TIER.STREET, a0, a1, y + 0.96, y + 1.02, -1.14, -1.09, WHITE, false);
          faceBox(S, F, 'rust', TIER.STREET, a0, a0 + 0.05, y, y + 1.0, -1.14, 0, WHITE, false);
          faceBox(S, F, 'rust', TIER.STREET, a1 - 0.05, a1, y, y + 1.0, -1.14, 0, WHITE, false);
          for (let k = 1; k < 8; k++) faceBox(S, F, 'rust', TIER.DETAIL, a0 + (k * (a1 - a0)) / 8 - 0.012, a0 + (k * (a1 - a0)) / 8 + 0.012, y, y + 0.96, -1.13, -1.1, WHITE, false);
          decal(S, F, 'rust_b', a0 + 0.3, y - 1.1, 0.5, 1.8);
        }
      }
    }
    if (fi === escapeFace && nf >= 2 && n >= 2) {
      // the fire escape: a landing at every storey over two bays, a stair from each to the next, a ladder to the street
      const b0 = Math.min(n - 2, 1 + ((hash(B.seed, 103) * (n - 2)) | 0));
      const a0 = b0 * bw + 0.2, a1 = (b0 + 2) * bw - 0.2;
      for (let f = 0; f < nf; f++) {
        const y = f * B.fh + 0.05;
        faceBox(S, F, 'rust', TIER.FAR, a0, a1, y - 0.06, y, -1.05, 0, WHITE, false);
        // the rail round it
        faceBox(S, F, 'rust', TIER.STREET, a0, a1, y + 0.98, y + 1.03, -1.05, -1.0, WHITE, false);
        faceBox(S, F, 'rust', TIER.STREET, a0, a1, y + 0.5, y + 0.54, -1.04, -1.01, WHITE, false);
        for (const sa of [a0, a1 - 0.05]) {
          faceBox(S, F, 'rust', TIER.STREET, sa, sa + 0.05, y, y + 1.0, -1.05, -1.0, WHITE, false);
          faceBox(S, F, 'rust', TIER.STREET, sa, sa + 0.04, y + 0.98, y + 1.03, -1.0, 0, WHITE, false);
        }
        for (let k = 1; k < 10; k++) faceBox(S, F, 'rust', TIER.DETAIL, a0 + (k * (a1 - a0)) / 10 - 0.012, a0 + (k * (a1 - a0)) / 10 + 0.012, y, y + 0.98, -1.04, -1.02, WHITE, false);
        // brackets under it
        for (const sa of [a0 + 0.3, a1 - 0.3]) S.bar('rust', TIER.STREET, fp(F, sa, y - 0.9, 0), fp(F, sa, y - 0.06, -0.95), 0.05);
        if (f < nf - 1) {
          // the stair up to the next: two strings and their treads
          const up = f % 2 ? [a1 - 0.5, a0 + 0.9] : [a0 + 0.5, a1 - 0.9];
          for (const dd of [-0.95, -0.35]) S.bar('rust', TIER.FAR, fp(F, up[0], y, dd), fp(F, up[1], y + B.fh, dd), 0.08);
          for (let k = 1; k < 10; k++) {
            const t = k / 10;
            S.bar('rust', TIER.DETAIL, fp(F, lerp(up[0], up[1], t), y + B.fh * t, -0.95), fp(F, lerp(up[0], up[1], t), y + B.fh * t, -0.35), 0.05);
          }
        }
        if (hash(B.seed, f, 104) < 0.35) decal(S, F, 'rust_a', a0 + 0.4 + hash(B.seed, f, 105) * (a1 - a0 - 0.8), y - 1.0, 0.6, 1.9);
      }
      // the drop ladder, hanging over the pavement
      for (const sa of [a0 + 0.3, a0 + 0.75]) S.bar('rust', TIER.STREET, fp(F, sa, 0.05, -1.0), fp(F, sa, -2.6, -1.0), 0.04);
      for (let k = 0; k < 8; k++) S.bar('rust', TIER.DETAIL, fp(F, a0 + 0.3, -0.2 - k * 0.3, -1.0), fp(F, a0 + 0.75, -0.2 - k * 0.3, -1.0), 0.025);
    }
    // a drainpipe down a corner, broken off part way
    if (!st.curtain && hash(B.seed, fi, 121) < 0.6) {
      const sa = hash(B.seed, fi, 122) < 0.5 ? 0.25 : F.len - 0.25;
      const y0 = hash(B.seed, fi, 123) < 0.4 ? h * 0.3 : -B.ground;
      S.bar('rust', TIER.STREET, fp(F, sa, y0, -0.1), fp(F, sa, h, -0.1), 0.11, WHITE, 5);
      decal(S, F, 'stain_a', sa, Math.max(y0 - 1.2, -B.ground + 1), 1.0, 2.4);
    }
    // ---- what the years laid on it
    const hk = hash(B.seed, fi, 131);
    if (blank) {
      // a blind wall: a painted advertisement all but gone, or ivy to the third floor, damp under the coping
      if (hk < 0.4 && h > 7 && F.len > 8) decal(S, F, 'ghost', F.len / 2, h * 0.62, Math.min(F.len - 2, 8), Math.min(F.len - 2, 8) * 0.72, false, TIER.FAR);
      decal(S, F, 'damp_b', F.len * (0.2 + hk * 0.6), h - 1.6, 4.5, 3.4);
    }
    if (!st.curtain && hash(B.seed, fi, 132) < (blank ? 0.75 : 0.4)) {
      const iw = 4 + hk * 3, ih = Math.min(h + B.ground - 0.3, iw * (1.5 + hk * 0.5));
      const sa = hk < 0.5 ? iw / 2 - 0.2 : F.len - iw / 2 + 0.2;
      decal(S, F, hash(B.seed, fi, 133) < 0.6 ? 'ivy_a' : 'ivy_b', sa, -B.ground + ih / 2, iw, ih, false, TIER.FAR, -0.07);
    }
    for (let k = 0; k < 3; k++) {
      const r1 = hash(B.seed, fi * 7 + k, 141), r2 = hash(B.seed, fi * 7 + k, 142);
      if (r1 < 0.5) decal(S, F, r1 < 0.25 ? 'damp_a' : 'damp_b', r2 * F.len, h * (0.15 + r1 * 1.6), 2.6 + r2 * 2, 2 + r1 * 3);
      else if (r1 < 0.75 && !st.curtain) decal(S, F, r1 < 0.62 ? 'crack_a' : 'crack_b', r2 * F.len, h * (r1 - 0.2), 2.2 + r2 * 1.6, 2.2 + r2 * 1.6);
      else if (st.curtain || st.fins) decal(S, F, r2 < 0.5 ? 'rust_a' : 'rust_b', r2 * F.len, h * (0.3 + r1 * 0.5), 0.7, 2.6);
    }
  });
}

// ------------------------------------------------------------------ rubble
// A heap of what a building came down as, rx by rz across and h high at (x, y, z) of the frame: a mound of dust and
// small stuff, slabs and lumps lying in it at every angle, bricks, a beam or two, bars standing out of it.
// ash: what a fire left - a mound of ash, what lies in it burnt black
function rubble(S, x, y, z, rx, rz, h, rnd, tier = TIER.FAR, lumps = 0, brick = 0.3, ash = false) {
  const [M_MOUND, M_SLAB, M_LUMP, M_BAR] = ash ? ['ash', 'charred', 'charred', 'charred'] : ['gravel', 'concrete', 'brick', 'rust'];
  const NA = 11, NR = 4;
  const hgt = (t) => h * Math.pow(1 - t * t, 0.85) * 0.82; // (the mound: the rest of the height is what lies on it)
  const jit = [];
  for (let a = 0; a < NA; a++) jit.push(0.82 + rnd() * 0.36);
  const P = (a, k) => {
    const an = (a / NA) * PI * 2;
    const t = k / NR;
    const jj = jit[a % NA];
    return [x + Math.cos(an) * rx * t * jj, y + hgt(t) * (0.66 + 0.6 * hash(a % NA, k, (x * 10) | 0, (z * 10) | 0)) * (t < 1 ? 1 : 0), z + Math.sin(an) * rz * t * jj];
  };
  const top = [x, y + h * 0.82, z];
  for (let a = 0; a < NA; a++) {
    for (let k = 0; k < NR; k++) {
      const p0 = k ? P(a, k) : top, p1 = k ? P(a + 1, k) : top, p2 = P(a + 1, k + 1), p3 = P(a, k + 1);
      const uv = (p) => [p[0] * 0.7, p[2] * 0.7];
      if (k) S.tri(M_MOUND, tier, p0, p1, p3, uv(p0), uv(p1), uv(p3));
      S.tri(M_MOUND, tier, p1, p2, p3, uv(p1), uv(p2), uv(p3));
    }
  }
  // (what has grown on it since: weeds at its foot and up its sides)
  if (!lumps && !ash) for (let k = 0; k < 3; k++) {
    const an = rnd() * PI * 2, t = 0.5 + rnd() * 0.5;
    weedsAt(S, x + Math.cos(an) * rx * t, y + hgt(t) * 0.7, z + Math.sin(an) * rz * t, 0.5 + rnd() * 0.5, rnd);
  }
  const n = lumps || Math.round(14 + rx * rz * 3.2);
  for (let k = 0; k < n; k++) {
    const an = rnd() * PI * 2, t = Math.sqrt(rnd()) * 0.95;
    const px = x + Math.cos(an) * rx * t, pz = z + Math.sin(an) * rz * t;
    const py = y + hgt(t) * 0.9;
    const r = rnd();
    if (r < 0.34) {
      // a slab
      const s = 0.7 + rnd() * Math.min(2.2, rx * 0.7);
      S.box(M_SLAB, tier, px, py + 0.12, pz, ash ? s * 1.4 : s, ash ? 0.14 : 0.2 + rnd() * 0.12, ash ? 0.16 : s * (0.55 + rnd() * 0.5), { ry: rnd() * PI, rx: (rnd() - 0.5) * (ash ? 0.5 : 0.9), rz: (rnd() - 0.5) * (ash ? 0.5 : 0.9) });
    } else if (r < 0.62) {
      // a lump
      const s = 0.3 + rnd() * 0.7;
      S.box(rnd() < brick ? M_LUMP : M_SLAB, tier, px, py + s * 0.25, pz, s, s * (0.5 + rnd() * 0.5), s * (0.6 + rnd() * 0.6), { ry: rnd() * PI, rx: (rnd() - 0.5) * 1.2, rz: (rnd() - 0.5) * 1.2 });
    } else if (r < 0.82) {
      // bricks, loose
      for (let j = 0; j < 3; j++) S.box(M_LUMP, TIER.STREET, px + (rnd() - 0.5) * 0.7, py + 0.06, pz + (rnd() - 0.5) * 0.7, 0.22, 0.07, 0.1, { ry: rnd() * PI, rx: (rnd() - 0.5) * 0.8 });
    } else if (r < 0.9 && rx > 1.6) {
      // a steel beam, bent out of it
      const len = 1.6 + rnd() * 2.6;
      const a2 = rnd() * PI * 2;
      S.bar(M_BAR, tier, [px, py - 0.1, pz], [px + Math.cos(a2) * len * 0.7, py + len * (0.2 + rnd() * 0.5), pz + Math.sin(a2) * len * 0.7], 0.16);
    } else {
      // bars
      for (let j = 0; j < 2; j++) {
        const q = [px + (rnd() - 0.5) * 0.5, py + 0.5 + rnd() * 1.0, pz + (rnd() - 0.5) * 0.5];
        S.bar('rust', TIER.STREET, [px, py - 0.1, pz], q, 0.035, WHITE, 3);
        S.bar('rust', TIER.STREET, q, [q[0] + (rnd() - 0.5) * 0.8, q[1] + (rnd() - 0.3) * 0.5, q[2] + (rnd() - 0.5) * 0.8], 0.035, WHITE, 3);
      }
    }
  }
}

// ------------------------------------------------------------------ a shell: walls with the sky behind them
// W (from the world): { x0, z0, x1, z1, y, t, mat, fh, heights: [h...], seed, soot }. The wall runs from (x0, z0) to
// (x1, z1) in lengths, each broken off at its own height (heights: the collider of each is that high). Its window
// openings are holes: the other side of the street is seen through them.
function shell(S, W) {
  S.frame(0, W.y, 0, 0);
  const dx = W.x1 - W.x0, dz = W.z1 - W.z0;
  const L = Math.hypot(dx, dz);
  const tx = dx / L, tz = dz / L;
  const t = W.t || 0.4;
  const n = W.heights.length;
  const seg = L / n;
  const fh = W.fh || 3;
  // two faces: the wall's own two sides
  const faces = [
    { ax: W.x0 - tz * (t / 2), az: W.z0 + tx * (t / 2), tx, tz, nx: -tz, nz: tx, len: L, u0: W.seed % 7 },
    { ax: W.x1 + tz * (t / 2), az: W.z1 - tx * (t / 2), tx: -tx, tz: -tz, nx: tz, nz: -tx, len: L, u0: (W.seed % 5) + 9 },
  ];
  const tint = W.mat === 'plaster' ? STUCCO[(hash(W.seed, 5) * STUCCO.length) | 0] : WHITE;
  // (the inside of a place that burnt: what is left of its plaster, grey with smoke - the soot itself is laid over
  // each opening, on both faces)
  const smoked = W.inner === 'charred';
  const mats = [W.mat, smoked ? 'plaster' : W.inner || W.mat];
  const B = { seed: W.seed, st: { ...STYLE.walkup, rec: t / 2 }, wall: W.mat, tint, wear: 1, burnt: 0, fh };
  for (let k = 0; k < n; k++) {
    const h = W.heights[k];
    const hl = k ? W.heights[k - 1] : 0, hr = k < n - 1 ? W.heights[k + 1] : 0;
    // the broken top of this length: three steps of it, the middle the collider's height
    const steps = [h - hash(W.seed, k, 1) * 0.5, h, h - hash(W.seed, k, 2) * 0.6].map((v) => Math.max(0.2, v));
    faces.forEach((F, side) => {
      const s0 = side ? L - (k + 1) * seg : k * seg;
      const mat = mats[side];
      const sm = 0.8 + hash(W.seed, k, 4) * 0.5;
      const col = side && smoked ? [SOOTY[0] * sm, SOOTY[1] * sm, SOOTY[2] * sm] : side && W.inner === 'plaster' ? ROOM_TINT[(hash(W.seed, k >> 1, 3) * ROOM_TINT.length) | 0] : tint;
      const wq = (a0, a1, y0, y1) => wallQuad(S, F, mat, TIER.FAR, a0, a1, y0, y1, 0, col);
      const c = s0 + seg / 2;
      const ww = Math.min(1.15, seg - 1.1);
      const sub = side ? [steps[2], steps[1], steps[0]] : steps;
      let y = 0;
      for (let f = 0; y < h - 0.1; f++) {
        const top = Math.min(h, y + fh);
        const wy0 = y + 0.9, wy1 = y + 2.5;
        if (wy1 + 0.35 > h || ww < 0.6) {
          // (not enough of the wall left over this floor for a window)
          wq(s0, s0 + seg, y, Math.min(top, Math.min(...sub)));
          break;
        }
        wq(s0, s0 + seg, y, wy0);
        wq(s0, c - ww / 2, wy0, wy1);
        wq(c + ww / 2, s0 + seg, wy0, wy1);
        wq(s0, s0 + seg, wy1, Math.min(top, Math.min(...sub)));
        if (side === 0) {
          // the opening's reveals, right through the wall, and a stone sill; soot over it where the place burnt
          const rv = (p0, p1, p2, p3) => S.quad(W.mat, TIER.FAR, p0, p1, p2, p3, null, tint);
          rv(fp(F, c - ww / 2, wy0, 0), fp(F, c - ww / 2, wy0, t), fp(F, c - ww / 2, wy1, t), fp(F, c - ww / 2, wy1, 0));
          rv(fp(F, c + ww / 2, wy0, t), fp(F, c + ww / 2, wy0, 0), fp(F, c + ww / 2, wy1, 0), fp(F, c + ww / 2, wy1, t));
          rv(fp(F, c - ww / 2, wy0, 0), fp(F, c + ww / 2, wy0, 0), fp(F, c + ww / 2, wy0, t), fp(F, c - ww / 2, wy0, t));
          rv(fp(F, c - ww / 2, wy1, t), fp(F, c + ww / 2, wy1, t), fp(F, c + ww / 2, wy1, 0), fp(F, c - ww / 2, wy1, 0));
          faceBox(S, F, 'concrete', TIER.DETAIL, c - ww / 2 - 0.12, c + ww / 2 + 0.12, wy0 - 0.1, wy0, -0.07, 0.1, WHITE, false);
        }
        if (W.soot && hash(W.seed, k, f, side) < 0.72) {
          // (up the wall from the head of the opening, as far as the wall still goes)
          const sh = Math.min(h - wy1 + 0.3, 1.5 + hash(W.seed, k, f, side + 5) * 2.2);
          if (sh > 0.6) decal(S, F, hash(W.seed, k, f) < 0.5 ? 'soot_a' : 'soot_b', c, wy1 - 0.12 + sh / 2, ww * (1.25 + hash(W.seed, k, f, 6) * 0.6), sh, true, TIER.FAR, -0.025);
        }
        y = top;
      }
      // the ragged top: the three steps over the lowest of them
      const base = Math.min(...sub, h);
      for (let j = 0; j < 3; j++) if (sub[j] > base + 0.02) wq(s0 + (j * seg) / 3, s0 + ((j + 1) * seg) / 3, base, sub[j]);
    });
    // the top of the wall and its broken ends
    const F = faces[0];
    const s0 = k * seg;
    for (let j = 0; j < 3; j++) {
      const a0 = s0 + (j * seg) / 3, a1 = s0 + ((j + 1) * seg) / 3;
      const yy = steps[j];
      S.quad(W.mat, TIER.FAR, fp(F, a0, yy, 0), fp(F, a1, yy, 0), fp(F, a1, yy, t), fp(F, a0, yy, t), null, tint);
      const prev = j ? steps[j - 1] : hl > 0 ? Math.max(0.2, hl - hash(W.seed, k - 1, 2) * 0.6) : 0;
      if (Math.abs(prev - yy) > 0.02) {
        const [lo, hi] = prev < yy ? [prev, yy] : [yy, prev];
        S.quad2(W.mat, TIER.FAR, fp(F, a0, lo, t), fp(F, a0, lo, 0), fp(F, a0, hi, 0), fp(F, a0, hi, t), null, tint);
      }
    }
    if (!hr) S.quad2(W.mat, TIER.FAR, fp(F, s0 + seg, 0, 0), fp(F, s0 + seg, 0, t), fp(F, s0 + seg, steps[2], t), fp(F, s0 + seg, steps[2], 0), null, tint);
    if (!hl) S.quad2(W.mat, TIER.FAR, fp(F, s0, 0, 0), fp(F, s0, 0, t), fp(F, s0, steps[0], t), fp(F, s0, steps[0], 0), null, tint);
    // a bar or two out of the top of it
    if (hash(W.seed, k, 9) < 0.4) {
      const p = fp(F, s0 + seg * 0.5, h - 0.2, t / 2);
      S.bar('rust', TIER.STREET, p, [p[0] + (hash(W.seed, k, 10) - 0.5) * 0.8, p[1] + 0.8 + hash(W.seed, k, 11), p[2] + (hash(W.seed, k, 12) - 0.5) * 0.8], 0.04, WHITE, 3);
    }
  }
  void B;
}

// ------------------------------------------------------------------ a room that is walked into
// R (from the world): { x, z, ry, y, w, d, h, t, mat, sides: { n, s, e, w }: the openings of each wall as the Builder
// cut them, tint (0..), floor ('lino', 'boards' or none), ceiling ('ceiling': office tiles, 'plaster'), ceil (how
// high the ceiling hangs, if under h), sign (a cell of the atlas: the board over the shop), walls: [[x0, z0, x1, z1,
// h, [openings]]] the partitions in it, zones: [[x0, z0, x1, z1, tint]] the rooms those make of it, each painted its
// own way, patches: [[x0, z0, x1, z1, tint]] lino laid over part of its floor (a kitchen's, a bathroom's), homely (a
// home: pictures on its walls), burnt (it burnt out: bare sooted walls, no ceiling) }.
// The walls themselves are the world's own parts (they are what is walked into); this lines them inside with
// plaster, puts a ceiling under the slab and a floor on it, frames the openings, hangs the doors and the shop's
// board. No lamp burns in Port Calder, so a room's light is the day through its openings: it is laid into the
// lining's own colour, brightest beside a window or a doorway and falling off into the room and behind each
// partition (LIT), which is what makes a room read from its door.
const LIT = [1.1, 3.1]; // how much of its colour a lining shows: where the day does not reach, and beside a window
const LINO_TINT = [[1, 1, 0.96], [0.84, 0.94, 0.84], [1.0, 0.9, 0.78], [0.84, 0.9, 1.0], [0.98, 0.86, 0.78], [0.92, 0.92, 0.92]];
const BOARD_TINT = [[1, 0.94, 0.84], [0.92, 0.84, 0.74], [1.02, 1.0, 0.94]];
const CEIL_WHITE = [0.97, 0.96, 0.91];
const CEIL_HANG = 0.35; // (m: see room's ceiling)
const SOOTY = [0.33, 0.3, 0.27];
const STAINS = ['damp_a', 'damp_b', 'stain_a', 'stain_b', 'crack_a', 'crack_b', 'damp_b', 'stain_a'];
function room(S, R) {
  S.frame(R.x, R.y, R.z, R.ry);
  const hw = R.w / 2, hd = R.d / 2;
  const t = R.t || 0.25;
  const base = R.burnt ? SOOTY : ROOM_TINT[(R.tint ?? 0) % ROOM_TINT.length];
  const y0 = 0.12, y1 = Math.min(R.h, R.ceil || R.h); // (the floor's slab, the ceiling)
  const SIDES = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  const rnd = rngOf(R.seed || 1);
  const T = TIER.ROOM;
  // ---- the light: every opening of the outer walls lets the day in, by its size; a partition between takes most of it
  const AT = { n: (o) => [-hw + o.at, -hd + 0.35], s: (o) => [hw - o.at, hd - 0.35], w: (o) => [-hw + 0.35, hd - o.at], e: (o) => [hw - 0.35, -hd + o.at] };
  const lamps = [];
  for (const key of Object.keys(SIDES)) {
    for (const o of R.sides?.[key] || []) {
      const [x, z] = AT[key](o);
      const top = Math.min(o.y1, y1);
      lamps.push([x, (o.y0 + top) / 2, z, o.w * (top - o.y0) * (o.glass ? 0.8 : 1)]);
    }
  }
  const walls = R.walls || [];
  const blocks = []; // (the partitions, less their doorways: [x0, z0, x1, z1])
  const ends = []; // (where a partition ends: a wall it meets is painted another colour on either side of it)
  for (const [x0, z0, x1, z1, , ops] of walls) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    let cur = 0;
    const seg = (a, b) => b - a > 0.05 && blocks.push([x0 + ((x1 - x0) * a) / L, z0 + ((z1 - z0) * a) / L, x0 + ((x1 - x0) * b) / L, z0 + ((z1 - z0) * b) / L]);
    for (const o of (ops || []).slice().sort((a, b) => a.at - b.at)) {
      seg(cur, o.at - o.w / 2);
      cur = o.at + o.w / 2;
    }
    seg(cur, L);
    ends.push([x0, z0], [x1, z1]);
  }
  const crosses = (ax, az, bx, bz, q) => {
    const d1 = (bx - ax) * (q[1] - az) - (bz - az) * (q[0] - ax), d2 = (bx - ax) * (q[3] - az) - (bz - az) * (q[2] - ax);
    if (d1 * d2 >= 0) return false;
    const d3 = (q[2] - q[0]) * (az - q[1]) - (q[3] - q[1]) * (ax - q[0]), d4 = (q[2] - q[0]) * (bz - q[1]) - (q[3] - q[1]) * (bx - q[0]);
    return d3 * d4 < 0;
  };
  const lit = (x, y, z) => {
    if (R.burnt) return 1.15;
    let sum = 0;
    for (const [lx, ly, lz, a] of lamps) {
      let k = a / (1 + ((x - lx) ** 2 + (y - ly) ** 2 + (z - lz) ** 2) / 7);
      if (k < 0.03) continue;
      for (const q of blocks) if (crosses(lx, lz, x, z, q)) k *= 0.42;
      sum += k;
    }
    return LIT[0] + (LIT[1] - LIT[0]) * (sum / (sum + 1.0));
  };
  const zones = R.zones || [];
  const tintAt = (x, z) => {
    if (R.burnt) return base;
    for (const q of zones) if (x >= q[0] && x <= q[2] && z >= q[1] && z <= q[3]) return ROOM_TINT[q[4] % ROOM_TINT.length];
    return base;
  };
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  // A stretch of plaster on a face, a0..a1 along it and ya..yb up: cut where a partition meets the wall (the room
  // on its other side is another colour) and every couple of metres between, so the light falls off along it.
  let nth = 0;
  const lining = (F, a0, a1, ya, yb, d = 0, dim = 1) => {
    if (a1 - a0 < 0.01 || yb - ya < 0.01) return;
    const cuts = [a0, a1];
    for (const [ex, ez] of ends) {
      if (Math.abs((ex - F.ax) * F.nx + (ez - F.az) * F.nz) > 0.4) continue;
      const s = (ex - F.ax) * F.tx + (ez - F.az) * F.tz;
      if (s > a0 + 0.12 && s < a1 - 0.12) cuts.push(s);
    }
    cuts.sort((a, b) => a - b);
    const uo = F.uo ?? 0, vo = F.vo ?? 0;
    for (let c = 0; c + 1 < cuts.length; c++) {
      const b0 = cuts[c], b1 = cuts[c + 1];
      if (b1 - b0 < 0.02) continue;
      const mid = fp(F, (b0 + b1) / 2, 0, -0.3); // (a point off the wall, in the room this face looks into)
      const tn = mul(tintAt(mid[0], mid[2]), dim);
      const n = Math.max(1, Math.ceil((b1 - b0) / 1.8));
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const s = b0 + ((b1 - b0) * k) / n;
        const q = fp(F, Math.min(b1 - 0.1, Math.max(b0 + 0.1, s)), 0, -0.3);
        const cur = [s, mul(tn, lit(q[0], ya, q[2])), mul(tn, lit(q[0], yb, q[2]))];
        if (prev) S.quad('plaster', T, fp(F, prev[0], ya, d), fp(F, s, ya, d), fp(F, s, yb, d), fp(F, prev[0], yb, d), [[uo + prev[0], vo + ya], [uo + s, vo + ya], [uo + s, vo + yb], [uo + prev[0], vo + yb]], [prev[1], cur[1], cur[2], prev[2]]);
        prev = cur;
      }
    }
  };
  // what the years put on a stretch of wall with nothing cut in it: damp, a stain run down from the ceiling, a
  // crack, now and then a picture still hanging or what a fight left
  const marksOn = (F, a0, a1, top) => {
    const len = a1 - a0;
    if (len < 1.5) return;
    const n = Math.max(1, Math.round(len / 4.2));
    for (let j = 0; j < n; j++) {
      const k = nth++;
      const r = hash(R.seed, k, 601), r2 = hash(R.seed, k, 602);
      const s = a0 + (len * (j + 0.22 + 0.56 * r2)) / n;
      if (R.burnt) {
        if (r < 0.6) decal(S, F, r2 < 0.5 ? 'soot_a' : 'soot_b', s, y0 + 1.5, 1.2 + r * 2, 3, true, T);
        continue;
      }
      if (r > 0.72) continue;
      if (r < 0.13 && R.homely) decal(S, F, ['poster_a', 'poster_b', 'poster_c', 'poster_d'][(r2 * 4) | 0], s, y0 + 1.5, 0.46, 0.69, false, T);
      else if (r < 0.19) decal(S, F, r2 < 0.5 ? 'bullets' : 'blood', s, y0 + 0.9 + r2 * 0.8, 1.1, 1.1, true, T);
      else {
        const m = STAINS[(r2 * STAINS.length) | 0];
        if (m[0] === 's') {
          const h = Math.min(top - y0 - 0.2, 1.1 + r * 2);
          decal(S, F, m, s, top - h / 2, 0.5 + r2 * 0.8, h, true, T);
        } else if (m[0] === 'd') {
          const sz = Math.min(len - 0.2, 1.3 + r * 1.7);
          decal(S, F, m, s, r2 < 0.55 ? y0 + sz * 0.42 : top - sz * 0.45, sz, sz * 0.9, true, T);
        } else decal(S, F, m, s, y0 + 1.1 + r2 * 0.9, 1 + r * 1.2, 1 + r * 1.2, true, T);
      }
    }
  };
  let wi = 0;
  for (const [key, [nx, nz]] of Object.entries(SIDES)) {
    // the inside face of this wall. It runs the way the Builder laid the wall (n from -x, s from +x, w from +z, e
    // from -z), so an opening's `at` is its place along it, less half the wall at the corner.
    const In = innerFace(-hw + t / 2 + 0.006, hw - t / 2 - 0.006, -hd + t / 2 + 0.006, hd - t / 2 - 0.006, nx, nz);
    In.uo = hash(R.seed, wi, 611) * 7;
    In.vo = hash(R.seed, wi++, 612) * 5;
    const ops = (R.sides?.[key] || []).map((o) => ({ ...o, s: o.at - t / 2 })).sort((p, q) => p.s - q.s);
    let cur = 0;
    const plain = (a0, a1) => {
      a0 = Math.max(0, a0);
      a1 = Math.min(In.len, a1);
      lining(In, a0, a1, y0, y1);
      if (!R.burnt) lining(In, a0, a1, y0, y0 + 0.14, -0.012, 0.5); // (a skirting board, the dirt of years on it)
      marksOn(In, a0, a1, y1);
    };
    for (const o of ops) {
      const a0 = o.s - o.w / 2, a1 = o.s + o.w / 2;
      plain(cur, a0);
      if (o.y0 > y0) {
        lining(In, a0, a1, y0, o.y0);
        if (!R.burnt) lining(In, a0, a1, y0, y0 + 0.14, -0.012, 0.5);
      }
      if (o.y1 < y1) lining(In, a0, a1, o.y1, y1);
      cur = a1;
      if (!R.burnt) opening(S, In, o, a0, a1, t, R, rnd);
      else if (o.y1 < y1 - 0.4) decal(S, In, hash(R.seed, wi, o.at * 10) < 0.5 ? 'soot_a' : 'soot_b', o.s, o.y1 - 0.15 + (y1 - o.y1 + 0.6) / 2, o.w * 1.5, y1 - o.y1 + 0.6, true, T);
    }
    plain(cur, In.len);
  }
  // the ceiling and the floor, in squares a couple of metres across (each corner takes the light there)
  const sheet = (mat, y, x0, z0, x1, z1, up, uvOf, colOf, nrm = null) => {
    const nx = Math.max(1, Math.ceil((x1 - x0) / 2.3)), nz = Math.max(1, Math.ceil((z1 - z0) / 2.3));
    const P = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
        P.push([[x, y, z], uvOf(x, z), colOf(x, z)]);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = P[j * (nx + 1) + i], b = P[j * (nx + 1) + i + 1], c = P[(j + 1) * (nx + 1) + i + 1], e = P[(j + 1) * (nx + 1) + i];
        if (up) S.quad(mat, T, e[0], c[0], b[0], a[0], [e[1], c[1], b[1], a[1]], [e[2], c[2], b[2], a[2]], nrm);
        else S.quad(mat, T, a[0], b[0], c[0], e[0], [a[1], b[1], c[1], e[1]], [a[2], b[2], c[2], e[2]], nrm);
      }
    }
  };
  const ix = hw - t / 2, iz = hd - t / 2;
  if (R.ceiling && !R.burnt) {
    // (its normal is not straight down: the sky's light is none on a face that looks at the ground, and a ceiling is
    // as light as the walls under it)
    const tiles = R.ceiling !== 'plaster';
    const uo = hash(R.seed, 621) * 3, vo = hash(R.seed, 622) * 3;
    // A plastered ceiling takes the sun as a wall does (its normal: PLASTER_CEIL_N), and what keeps the sun off it
    // is the shadow of the roof over it. Laid right under that roof (a hall with no ceiling hung in it: the picture
    // house, the nave) it is nearer the roof's underside than a shadow map can tell apart, the roof's shadow never
    // falls on it, and it shines like an open sky over a dark room. There it hangs CEIL_HANG lower. A tiled ceiling
    // stays right under its slab: its material takes the sun as the roof's shadow leaves it (materials.js underRoof).
    const hang = !tiles && !R.ceil ? CEIL_HANG : 0.004;
    sheet(tiles ? 'ceiling' : 'plaster', y1 - hang, -ix, -iz, ix, iz, false, (x, z) => (tiles ? [x, z] : [x + uo, z + vo]), (x, z) => mul(tiles ? WHITE : CEIL_WHITE, lit(x, y1, z) * 0.94), tiles ? CEIL_N : PLASTER_CEIL_N);
  }
  const floorOf = (kind, y, x0, z0, x1, z1, ti) => {
    if (kind === 'boards') {
      const along = hash(R.seed, 631) < 0.5;
      const tn = BOARD_TINT[ti % BOARD_TINT.length];
      sheet('floorboards', y, x0, z0, x1, z1, true, (x, z) => (along ? [x, z] : [z, x]), (x, z) => mul(tn, lit(x, y0, z)));
    } else {
      // (tile laid square or on the diagonal, each floor from its own corner: no two rooms' chequers line up)
      const a = hash(R.seed, ti, 632) < 0.35 ? PI / 4 : 0;
      const ca = Math.cos(a), sa = Math.sin(a);
      const uo = hash(R.seed, ti, 633) * 2.4, vo = hash(R.seed, ti, 634) * 2.4;
      const tn = LINO_TINT[ti % LINO_TINT.length];
      sheet('lino', y, x0, z0, x1, z1, true, (x, z) => [x * ca + z * sa + uo, -x * sa + z * ca + vo], (x, z) => mul(tn, lit(x, y0, z)));
    }
  };
  if (R.floor && !R.burnt) floorOf(R.floor, y0 + 0.004, -ix, -iz, ix, iz, (R.tint ?? 0) + (R.seed % 5));
  for (const q of R.patches || []) floorOf('lino', y0 + 0.009, q[0], q[1], q[2], q[3], q[4] ?? 0);
  // partitions: plaster on both faces of each, a door hanging in some of their doorways
  for (const [x0, z0, x1, z1, h, opsIn] of walls) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const tx = (x1 - x0) / L, tz = (z1 - z0) / L;
    const pt = 0.09 + 0.006;
    const top = Math.min(h, y1);
    for (const sgn of [1, -1]) {
      // (the face whose normal is sgn * (-tz, tx): s runs to the right seen from in front of it)
      const nx = sgn * -tz, nz = sgn * tx;
      const ftx = nz, ftz = -nx;
      const fwd = ftx * tx + ftz * tz > 0;
      const F = { ax: (fwd ? x0 : x1) + nx * pt, az: (fwd ? z0 : z1) + nz * pt, tx: ftx, tz: ftz, nx, nz, len: L, uo: hash(R.seed, wi, 611) * 7, vo: hash(R.seed, wi++, 612) * 5 };
      let cur = 0;
      const ops = (opsIn || []).map((o) => ({ ...o, s: fwd ? o.at : L - o.at })).sort((a, b) => a.s - b.s);
      const plain = (a0, a1) => {
        lining(F, a0, a1, y0, top);
        if (!R.burnt) lining(F, a0, a1, y0, y0 + 0.14, -0.012, 0.5);
        marksOn(F, a0 + 0.1, a1 - 0.1, top);
      };
      for (const o of ops) {
        plain(cur, o.s - o.w / 2);
        if (o.y1 < top) lining(F, o.s - o.w / 2, o.s + o.w / 2, o.y1, top);
        if (o.y0 > y0) lining(F, o.s - o.w / 2, o.s + o.w / 2, y0, o.y0);
        cur = o.s + o.w / 2;
        // (a door, on the side of the wall it opens to: one in three is off its hinges and gone)
        if (sgn > 0 && o.y0 === 0 && o.w <= 1.75 && !R.burnt && hash(R.seed, wi, o.at * 10, 641) < 0.68) doorLeaf(S, F, o.s - o.w / 2, o.s + o.w / 2, o, rnd);
      }
      plain(cur, L);
    }
  }
  // ---- outside: the board over a shop, what was sprayed and pasted on its walls
  if (R.sign) {
    const F = faceOf(-hw, hw, -hd, hd, 0, -1);
    const sw = Math.min(R.w - 1.2, 7.6), sh = sw / 4;
    const hang = hash(R.seed, 11) < 0.25; // (down at one end)
    const yb = Math.min(R.h - 0.1, 3.5) - sh * 0.5 + 0.35;
    const c = F.len / 2 + (R.signAt || 0);
    const dy = hang ? -0.55 : 0;
    const p0 = fp(F, c - sw / 2, yb - sh / 2 + dy, -0.16), p1 = fp(F, c + sw / 2, yb - sh / 2, -0.16), p2 = fp(F, c + sw / 2, yb + sh / 2, -0.16), p3 = fp(F, c - sw / 2, yb + sh / 2 + dy, -0.16);
    S.cell('citysign', TIER.FAR, R.sign, p0, p1, p2, p3);
    const b0 = fp(F, c - sw / 2, yb - sh / 2 + dy, -0.02), b1 = fp(F, c + sw / 2, yb - sh / 2, -0.02), b2 = fp(F, c + sw / 2, yb + sh / 2, -0.02), b3 = fp(F, c - sw / 2, yb + sh / 2 + dy, -0.02);
    S.quad('metal', TIER.STREET, p3, p2, b2, b3);
    S.quad('metal', TIER.STREET, b0, b1, p1, p0);
    S.quad('metal', TIER.STREET, b0, p0, p3, b3);
    S.quad('metal', TIER.STREET, p1, b1, b2, p2);
  }
  const marks = ['graf_help', 'graf_dead', 'graf_room', 'graf_god', 'graf_bridge', 'graf_night', 'graf_names', 'graf_tag', 'xcode_a', 'xcode_b', 'poster_a', 'poster_b', 'poster_c', 'poster_d', 'bullets', 'blood'];
  for (const [key, [nx, nz]] of Object.entries(SIDES)) {
    const F = faceOf(-hw, hw, -hd, hd, nx, nz);
    const ops = (R.sides?.[key] || []).map((o) => (key === 'n' || key === 's' || key === 'e' || key === 'w' ? F.len - o.at : o.at));
    // the stretches of wall with nothing cut in them
    const cuts = (R.sides?.[key] || []).map((o) => [F.len - o.at - o.w / 2 - 0.3, F.len - o.at + o.w / 2 + 0.3]).sort((a, b) => a[0] - b[0]);
    void ops;
    let cur = 0.3;
    const free = [];
    for (const [a, b] of cuts) {
      if (a - cur > 1.6) free.push([cur, a]);
      cur = Math.max(cur, b);
    }
    if (F.len - 0.3 - cur > 1.6) free.push([cur, F.len - 0.3]);
    if (R.burnt) {
      // soot up the wall over every opening the fire came out of: densest at its head, thinning upward
      for (const o of R.sides?.[key] || []) {
        const sh = R.h - o.y1 + 2.4 + hash(R.seed, o.at * 10, nx, nz) * 1.6;
        decal(S, F, hash(R.seed, o.at * 10, nx * 3 + nz, 207) < 0.5 ? 'soot_a' : 'soot_b', F.len - o.at, o.y1 - 0.2 + sh / 2, o.w * (1.4 + hash(R.seed, o.at * 10, 208) * 0.5), sh, true, TIER.FAR);
      }
      continue;
    }
    free.forEach(([a, b], k) => {
      const r = hash(R.seed, k, nx * 3 + nz, 201);
      if (r > 0.62) return;
      const m = marks[(hash(R.seed, k, nx * 3 + nz, 202) * marks.length) | 0];
      const soft = m === 'bullets' || m === 'blood';
      const small = m.startsWith('poster') || m.startsWith('xcode');
      const w = Math.min(b - a - 0.2, small ? 0.9 : soft ? 1.4 : 3.2);
      const h = small ? w * (m.startsWith('poster') ? 1.5 : 1) : soft ? w : w * 0.42;
      decal(S, F, m, a + (b - a) * (0.3 + r * 0.6), small ? 1.5 : 1.25 + r * 0.6, w, h, soft, TIER.STREET);
    });
    // damp rising from the pavement, rust and dirt under the roof's edge
    if (hash(R.seed, nx, nz, 203) < 0.7) decal(S, F, 'damp_a', F.len * hash(R.seed, nx, nz, 204), 0.7, 3.4, 1.6);
    if (hash(R.seed, nx, nz, 205) < 0.5) decal(S, F, 'stain_b', F.len * hash(R.seed, nx, nz, 206), R.h - 1.1, 1.3, 2.2);
  }
}

// what is in an opening of a room's wall: o as the Builder cut it, a0..a1 where it is along the inside face In, t the
// wall's thickness
function opening(S, In, o, a0, a1, t, R, rnd) {
  const T = TIER.ROOM;
  const isDoor = o.y0 === 0;
  const fm = R.mat === 'tin' || R.mat === 'concrete' ? 'metal' : 'trim';
  if (!isDoor && !o.glass) {
    // a window with the glass gone: a frame in the wall's thickness and teeth of glass in it
    const d = t / 2;
    for (const [s0, s1, ya, yb] of [[a0, a0 + 0.06, o.y0, o.y1], [a1 - 0.06, a1, o.y0, o.y1], [a0, a1, o.y1 - 0.06, o.y1], [a0, a1, o.y0, o.y0 + 0.06]]) {
      const c = fp(In, (s0 + s1) / 2, (ya + yb) / 2, d);
      S.box(fm, T, c[0], c[1], c[2], In.tx ? s1 - s0 : 0.08, yb - ya, In.tx ? 0.08 : s1 - s0);
    }
    const w = a1 - a0, h = o.y1 - o.y0;
    const n = 4 + ((rnd() * 6) | 0);
    for (let k = 0; k < n; k++) {
      const tt = rnd();
      const len = (0.12 + rnd() * 0.45) * Math.min(w, h);
      const wd = 0.1 + rnd() * 0.35;
      const e = k % 4;
      let p;
      if (e === 0) p = [[a0 + tt * (w - wd), o.y0 + 0.06], [a0 + tt * (w - wd) + wd, o.y0 + 0.06], [a0 + tt * (w - wd) + wd * 0.5, o.y0 + 0.06 + len]];
      else if (e === 1) p = [[a0 + tt * (w - wd) + wd, o.y1 - 0.06], [a0 + tt * (w - wd), o.y1 - 0.06], [a0 + tt * (w - wd) + wd * 0.5, o.y1 - 0.06 - len]];
      else if (e === 2) p = [[a0 + 0.06, o.y0 + tt * (h - wd) + wd], [a0 + 0.06, o.y0 + tt * (h - wd)], [a0 + 0.06 + len * 0.7, o.y0 + tt * (h - wd) + wd * 0.5]];
      else p = [[a1 - 0.06, o.y0 + tt * (h - wd)], [a1 - 0.06, o.y0 + tt * (h - wd) + wd], [a1 - 0.06 - len * 0.7, o.y0 + tt * (h - wd) + wd * 0.5]];
      const q = p.map(([s, y]) => fp(In, s, y, d));
      S.tri('glass', T, q[0], q[1], q[2], p[0], p[1], p[2]);
      S.tri('glass', T, q[1], q[0], q[2], p[1], p[0], p[2]);
    }
  } else if (isDoor && o.w <= 1.75 && rnd() < 0.55) doorLeaf(S, In, a0, a1, o, rnd);
}
// a door still on its hinges in the doorway a0..a1 of the face In, standing open into the room the face looks into
// (well open, back toward its wall: the doorway is walked through)
function doorLeaf(S, In, a0, a1, o, rnd) {
  const atA0 = rnd() < 0.5;
  const ang = 1.05 + rnd() * 0.45;
  const dw = o.w - 0.1;
  const sg = atA0 ? 1 : -1;
  // (from the hinge: along the wall, turned by ang toward the room)
  const dx = In.tx * Math.cos(ang) * sg + In.nx * Math.sin(ang), dz = In.tz * Math.cos(ang) * sg + In.nz * Math.sin(ang);
  const hp = fp(In, atA0 ? a0 + 0.05 : a1 - 0.05, 0.12 + (o.y1 - 0.14) / 2, 0);
  S.box('door', TIER.ROOM, hp[0] + (dx * dw) / 2, hp[1], hp[2] + (dz * dw) / 2, dw, o.y1 - 0.14, 0.045, { ry: Math.atan2(-dz, dx), u0: 0 });
}

// ------------------------------------------------------------------ a length of building lying where it fell
// T (from the world): { x, z, y, ry, len, w, h, floors, fh, style, mat, seed, tilt }. A box of it len (local x: the
// way the tower fell) by w (local z) by h high: what was a side of the tower is its top now, its windows at the sky;
// its two long flanks are the tower's other sides on their sides. Where it broke from the next length it is no box:
// the skin of its last storey is torn off bay by bay at its own place, and behind it the floor that storey stood on
// is seen end on - a slab standing upright, pieces of it gone, the beams and the bars that ran on from it hanging
// out. Everything stays inside the box the world made solid.
function fallen(S, T) {
  S.frame(T.x, T.y, T.z, T.ry, T.tilt || 0);
  const st = STYLE[T.style] || STYLE.office;
  const B = { seed: T.seed, st, wall: st.curtain ? 'metal' : T.mat, tint: WHITE, wear: 1, burnt: 0, fh: T.fh };
  const hl = T.len / 2, hw = T.w / 2, h = T.h;
  const nf = Math.max(1, Math.round(T.len / T.fh)); // storeys along its length
  const fl = T.len / nf;
  const SKIN = 0.28;
  // which of its ends are breaks: both, of any length two storeys long or more
  const torn = () => nf >= 2;
  // a face here is a plane with two axes of its own: U along the tower's storeys (local x), V across
  const plane = (o, U, V, lu, lv, name) => {
    const N = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
    const P = (u, v, d = 0) => [o[0] + U[0] * u + V[0] * v - N[0] * d, o[1] + U[1] * u + V[1] * v - N[1] * d, o[2] + U[2] * u + V[2] * v - N[2] * d];
    const q = (mat, tier, u0, u1, v0, v1, d = 0) => {
      if (u1 - u0 < 0.01 || v1 - v0 < 0.01) return;
      S.quad(mat, tier, P(u0, v0, d), P(u1, v0, d), P(u1, v1, d), P(u0, v1, d), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    };
    // storeys along u: each a band of wall, then a row of windows across v
    const nb = Math.max(1, Math.round(lv / st.bay));
    const bw = lv / nb;
    const ww = st.curtain ? bw - 0.1 : Math.min(st.win[0], bw - 0.5);
    const nt = Math.max(2, Math.round(lv / 2.3)); // (the lengths its skin is torn off in)
    for (let f = 0; f < nf; f++) {
      const u0 = f * fl;
      // (the end this storey is, if it is one: u runs from -x on two of the planes and from +x on the third)
      const sx = f === 0 ? (U[0] > 0 ? -1 : 1) : f === nf - 1 ? (U[0] > 0 ? 1 : -1) : 0;
      if (sx && torn(sx)) {
        // the torn end: what is left of the skin, each length of it from the storey's inner line out to its own break
        const inner = f === 0 && nf > 1 ? u0 + fl : u0;
        const out = f === 0 && nf > 1 ? -1 : 1;
        let prev = 0;
        for (let k = 0; k < nt; k++) {
          const v0 = (k * lv) / nt, v1 = ((k + 1) * lv) / nt;
          const e = fl * (0.1 + 0.82 * hash(T.seed, f * 13 + k, name, 41) ** 1.4);
          const [ua, ub] = out > 0 ? [inner, inner + e] : [inner - e, inner];
          q(B.wall, TIER.FAR, ua, ub, v0, v1);
          // (its other face, and the break itself: the thickness of the wall)
          S.quad('concrete', TIER.FAR, P(ub, v0, SKIN), P(ua, v0, SKIN), P(ua, v1, SKIN), P(ub, v1, SKIN));
          const ue = out > 0 ? ub : ua;
          S.quad2('concrete', TIER.FAR, P(ue, v0, 0), P(ue, v1, 0), P(ue, v1, SKIN), P(ue, v0, SKIN));
          if (k && Math.abs(e - prev) > 0.05) {
            const [ea, eb] = out > 0 ? [inner + Math.min(e, prev), inner + Math.max(e, prev)] : [inner - Math.max(e, prev), inner - Math.min(e, prev)];
            S.quad2('concrete', TIER.FAR, P(ea, v0, 0), P(eb, v0, 0), P(eb, v0, SKIN), P(ea, v0, SKIN));
          }
          prev = e;
          // a bar or two out of the break
          if (hash(T.seed, k, f, name + 60) < 0.6) {
            const pv = v0 + (v1 - v0) * hash(T.seed, k, f, name + 61);
            const a = P(ue, pv, SKIN * 0.5);
            const reach = Math.max(0.2, Math.min(fl - e - 0.1, 0.5 + hash(T.seed, k, f, name + 62) * 1.2));
            S.bar('rust', TIER.STREET, a, [a[0] + sx * reach, Math.max(0.1, a[1] - reach * (0.2 + hash(T.seed, k, f, name + 63) * 0.6)), a[2] + (hash(T.seed, k, f, name + 64) - 0.5) * 0.5], 0.045, WHITE, 3);
          }
        }
        continue;
      }
      const sill = st.curtain ? 0.46 : (fl - Math.min(st.win[1], fl - 1.0)) / 2;
      const w0 = u0 + sill, w1 = st.curtain ? u0 + fl : u0 + fl - sill;
      q(B.wall, TIER.FAR, u0, w0, 0, lv);
      q(B.wall, TIER.FAR, w1, u0 + fl, 0, lv);
      let at = 0;
      for (let b = 0; b < nb; b++) {
        const c = (b + 0.5) * bw;
        const a0 = c - ww / 2, a1 = c + ww / 2;
        q(B.wall, TIER.FAR, w0, w1, at, a0);
        at = a1;
        const r = hash(T.seed, f, b, name);
        const whole = r < (st.curtain ? 0.3 : 0.2);
        q(whole ? 'glass' : 'dark', TIER.FAR, w0, w1, a0, a1, st.rec);
        if (!whole && r < 0.42) {
          // (a piece of the pane still in a corner of it)
          const k = 0.3 + hash(T.seed, f, b, name + 70) * 0.4;
          S.tri('glass', TIER.FAR, P(w0, a0, st.rec - 0.02), P(w0 + (w1 - w0) * k, a0, st.rec - 0.02), P(w0, a0 + ww * (1.1 - k), st.rec - 0.02), [w0, a0], [w0 + (w1 - w0) * k, a0], [w0, a0 + ww * (1.1 - k)]);
        }
        if (!st.curtain && r > 0.3) {
          // (what divided its panes)
          q('metal', TIER.STREET, w0, w1, c - 0.03, c + 0.03, st.rec - 0.05);
          q('metal', TIER.STREET, (w0 + w1) / 2 - 0.03, (w0 + w1) / 2 + 0.03, a0, a1, st.rec - 0.05);
        }
        // reveals
        S.quad(B.wall, TIER.FAR, P(w0, a0, 0), P(w1, a0, 0), P(w1, a0, st.rec), P(w0, a0, st.rec));
        S.quad(B.wall, TIER.FAR, P(w0, a1, st.rec), P(w1, a1, st.rec), P(w1, a1, 0), P(w0, a1, 0));
        S.quad(B.wall, TIER.FAR, P(w0, a0, st.rec), P(w0, a1, st.rec), P(w0, a1, 0), P(w0, a0, 0));
        S.quad(B.wall, TIER.FAR, P(w1, a0, 0), P(w1, a1, 0), P(w1, a1, st.rec), P(w1, a0, st.rec));
      }
      q(B.wall, TIER.FAR, w0, w1, at, lv);
    }
    if (st.fins) for (let f = 1; f < nf; f++) {
      const c = P(f * fl, lv / 2, -0.1);
      S.box('concrete', TIER.FAR, c[0], c[1], c[2], Math.abs(U[0]) * 0.34 + Math.abs(V[0]) * lv + Math.abs(N[0]) * 0.24, Math.abs(U[1]) * 0.34 + Math.abs(V[1]) * lv + Math.abs(N[1]) * 0.24, Math.abs(U[2]) * 0.34 + Math.abs(V[2]) * lv + Math.abs(N[2]) * 0.24);
    }
    // what the fall did to its skin: cracks across it, the damp of the years since, rust from its steel
    const u0 = torn(-1) || torn(1) ? fl : 0, u1 = lu - u0;
    for (let k = 0; k < 6 && u1 - u0 > 4; k++) {
      const r = hash(T.seed, k, name, 81), r2 = hash(T.seed, k, name, 82);
      const cell = ['crack_a', 'crack_b', 'damp_a', 'damp_b', 'scorch', 'crack_a'][(r * 6) | 0];
      const s = Math.min(lv - 0.4, u1 - u0 - 0.4, 2.6 + r2 * 2.6);
      const cu = u0 + s / 2 + (u1 - u0 - s) * hash(T.seed, k, name, 83), cv = s / 2 + (lv - s) * r2;
      S.cell('citygrime', TIER.FAR, cell, P(cu - s / 2, cv - s / 2, -0.03), P(cu + s / 2, cv - s / 2, -0.03), P(cu + s / 2, cv + s / 2, -0.03), P(cu - s / 2, cv + s / 2, -0.03));
    }
  };
  // the top (what was a side of the tower), and the two flanks
  plane([-hl, h, hw], [1, 0, 0], [0, 0, -1], T.len, T.w, 1);
  plane([hl, 0, -hw], [-1, 0, 0], [0, 1, 0], T.len, h, 2);
  plane([-hl, 0, hw], [1, 0, 0], [0, 1, 0], T.len, h, 3);
  // what came down on top of it; a slab of its own skin stove in
  const rnd = rngOf(T.seed + 5);
  for (let k = 0; k < 3; k++) rubble(S, (rnd() - 0.5) * T.len * 0.5, h, (rnd() - 0.5) * T.w * 0.6, 1.4 + rnd() * 1.6, 1.2 + rnd() * 1.4, 0.5 + rnd() * 0.6, rnd, TIER.FAR, 9);
  for (let k = 0; k < 2; k++) S.box('concrete', TIER.FAR, (rnd() - 0.5) * T.len * 0.5, h - 0.1, (rnd() - 0.5) * T.w * 0.5, 3 + rnd() * 2, 0.3, 2.4 + rnd() * 2, { rz: (rnd() - 0.5) * 0.5, rx: (rnd() - 0.5) * 0.5, ry: rnd() * 3 });
  for (const sx of [-1, 1]) {
    const face = (mat, x, y0, y1, z0, z1) => {
      if (sx > 0) S.quad(mat, TIER.FAR, [x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1]);
      else S.quad(mat, TIER.FAR, [x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]);
    };
    if (!torn(sx)) {
      // an end that is no break (the foot of the shaft, a short length): a rim of wall, and the dark of it
      const x = sx * hl, rim = 0.5;
      face('concrete', x, 0, h, -hw, -hw + rim);
      face('concrete', x, 0, h, hw - rim, hw);
      face('concrete', x, h - rim, h, -hw + rim, hw - rim);
      face('concrete', x, 0, rim, -hw + rim, hw - rim);
      face('dark', x - sx * 1.4, rim, h - rim, -hw + rim, hw - rim);
      for (const z of [-hw + rim, hw - rim]) S.quad2('concrete', TIER.FAR, [x, rim, z], [x - sx * 1.4, rim, z], [x - sx * 1.4, h - rim, z], [x, h - rim, z]);
      for (const y of [rim, h - rim]) S.quad2('concrete', TIER.FAR, [x, y, -hw + rim], [x - sx * 1.4, y, -hw + rim], [x - sx * 1.4, y, hw - rim], [x, y, hw - rim]);
      continue;
    }
    // ---- a break. The floor the last storey stood on, end on: a slab upright across the whole of it, in pieces -
    // some whole, some broken off part way up, some gone, and through those the storey behind: its partitions, the dark
    const xs = sx * (hl - fl);
    const IN = Math.min(1.9, fl * 0.6);
    const nz = Math.max(2, Math.round(T.w / 2.4));
    const yA = 0.12, yB = h - SKIN;
    for (let k = 0; k < nz; k++) {
      const z0 = -hw + SKIN + (k * (T.w - SKIN * 2)) / nz, z1 = -hw + SKIN + ((k + 1) * (T.w - SKIN * 2)) / nz;
      const r = hash(T.seed, k, sx, 51);
      if (r < 0.22) continue;
      const top = r < 0.56 ? yA + (yB - yA) * (0.3 + 0.5 * hash(T.seed, k, sx, 52)) : yB;
      S.box('concrete', TIER.FAR, xs + sx * 0.13, (yA + top) / 2, (z0 + z1) / 2, 0.26, top - yA, z1 - z0 - 0.05);
      // bars out of its broken edge, bent over
      if (top < yB) for (let j = 0; j < 2; j++) {
        const bz = z0 + (z1 - z0) * (0.25 + 0.5 * j);
        const reach = 0.5 + hash(T.seed, k * 3 + j, sx, 53) * 1.1;
        S.bar('rust', j ? TIER.STREET : TIER.FAR, [xs + sx * 0.13, top - 0.05, bz], [xs + sx * Math.min(fl - 0.2, 0.13 + reach * 0.8), top + reach * (0.5 - hash(T.seed, k * 3 + j, sx, 54)), bz + (hash(T.seed, k * 3 + j, sx, 55) - 0.5) * 0.7], j ? 0.045 : 0.075, WHITE, 3);
      }
    }
    face('dark', xs - sx * IN, yA, yB, -hw + SKIN, hw - SKIN);
    for (const z of [-hw + SKIN, hw - SKIN]) S.quad2('concrete', TIER.FAR, [xs, yA, z], [xs - sx * IN, yA, z], [xs - sx * IN, yB, z], [xs, yB, z]);
    for (const y of [yA, yB]) S.quad2('concrete', TIER.FAR, [xs, y, -hw + SKIN], [xs - sx * IN, y, -hw + SKIN], [xs - sx * IN, y, hw - SKIN], [xs, y, hw - SKIN]);
    for (let k = 0; k < 2; k++) {
      const z = -hw + T.w * (0.22 + 0.5 * k + 0.12 * hash(T.seed, k, sx, 56));
      S.box('plaster', TIER.FAR, xs - sx * IN * 0.5, (yA + yB) / 2, z, IN, yB - yA, 0.14, { c: ROOM_TINT[(hash(T.seed, k, sx, 57) * ROOM_TINT.length) | 0], skip: sx > 0 ? 2 : 1 });
    }
    // what ran on from that floor into the storey that is gone: beams still fast in it, broken off short and hanging
    for (let k = 0; k < 6; k++) {
      const z = -hw + SKIN + 0.4 + (k % 3 + 0.25 + 0.5 * hash(T.seed, k, sx, 58)) * ((T.w - SKIN * 2 - 0.8) / 3);
      const y = k < 3 ? h * 0.28 : h * 0.72;
      const L = Math.min(fl - 0.3, 0.5 + hash(T.seed, k, sx, 59) * fl * 0.8);
      const droop = (0.04 + hash(T.seed, k, sx, 60) * 0.14) * -sx;
      S.box('concrete', TIER.FAR, xs + sx * (0.26 + L / 2), y - Math.abs(droop) * L * 0.5, z, L, 0.4, 0.4, { rz: droop, skip: sx > 0 ? 2 : 1 });
      const tip = [xs + sx * (0.26 + L), y - Math.abs(droop) * L, z];
      for (let j = 0; j < 2; j++) {
        const reach = Math.max(0.15, Math.min(fl - L - 0.35, 0.3 + hash(T.seed, k * 2 + j, sx, 61) * 0.9));
        S.bar('rust', TIER.STREET, [tip[0] - sx * 0.1, tip[1] + (j ? 0.12 : -0.12), tip[2]], [tip[0] + sx * reach, Math.max(0.08, tip[1] - reach * (0.3 + hash(T.seed, k * 2 + j, sx, 62))), tip[2] + (hash(T.seed, k * 2 + j, sx, 63) - 0.5) * 0.6], 0.04, WHITE, 3);
      }
    }
    // (a piece of the floor come away whole, leaning on what is under it)
    const lz = (hash(T.seed, sx, 64) - 0.5) * T.w * 0.5;
    S.box('concrete', TIER.FAR, xs + sx * fl * 0.55, h * 0.24, lz, 0.26, h * 0.5, Math.min(3.2, T.w * 0.3), { rz: sx * 0.5, ry: (hash(T.seed, sx, 65) - 0.5) * 0.4 });
  }
}

// ------------------------------------------------------------------ floors that came down one on another
// P (from the world): { x, z, y, ry, w, d, n, seed }: n slabs w by d, each lying on what is left of the storey
// under it, the upper ones tipped further; bars and crushed things in the gaps, a slab hanging off the end.
function pancake(S, P) {
  S.frame(P.x, P.y, P.z, P.ry);
  const rnd = rngOf(P.seed);
  let y = 0.15;
  for (let k = 0; k < P.n; k++) {
    const w = P.w * (1 - k * 0.06), d = P.d * (1 - k * 0.07);
    const tilt = (0.03 + k * 0.035) * (k % 2 ? 1 : 0.6);
    const gap = 0.25 + rnd() * 0.5;
    const cx = k * 0.5 + (rnd() - 0.5) * 0.6, cz = (rnd() - 0.5) * 0.8;
    S.box('concrete', TIER.FAR, cx, y + 0.16, cz, w, 0.32, d, { rz: tilt, rx: (rnd() - 0.5) * 0.05, ry: (rnd() - 0.5) * 0.08 });
    // what was between this floor and the next: crushed walls, a column on its side
    for (let j = 0; j < 7; j++) {
      const px = cx + (rnd() - 0.5) * w * 0.9, pz = cz + (j % 2 ? 1 : -1) * (d / 2 - rnd() * 0.5);
      S.box(rnd() < 0.4 ? 'brick' : 'concrete', TIER.FAR, px, y + 0.3 + gap * 0.5 + Math.tan(tilt) * (px - cx), pz, 1 + rnd() * 2, gap * (0.6 + rnd() * 0.4), 0.3 + rnd() * 0.5, { ry: (rnd() - 0.5) * 0.4, rz: tilt });
    }
    // bars out of its edges
    for (let j = 0; j < 10; j++) {
      const side = j % 4;
      const u = rnd() - 0.5;
      const ex = side === 0 ? w / 2 : side === 1 ? -w / 2 : u * w;
      const ez = side === 2 ? d / 2 : side === 3 ? -d / 2 : u * d;
      const py = y + 0.16 + Math.tan(tilt) * ex;
      const ox = side < 2 ? Math.sign(ex) : (rnd() - 0.5) * 0.6, oz = side >= 2 ? Math.sign(ez) : (rnd() - 0.5) * 0.6;
      const reach = 0.4 + rnd() * 1.1;
      S.bar('rust', TIER.STREET, [cx + ex, py, cz + ez], [cx + ex + ox * reach, py - reach * (0.2 + rnd() * 0.8), cz + ez + oz * reach], 0.04, WHITE, 3);
    }
    y += 0.32 + gap;
  }
}

// ------------------------------------------------------------------ boards and marks put anywhere
// G (from the world): { x, y, z, ry, w, h, cell, back, tilt, grime }: a rectangle of the city's atlas facing -Z of
// its own frame, its middle at (x, y, z); back: a board behind it (metres thick) and posts down to `post` under it.
function sign(S, G) {
  S.frame(G.x, G.y, G.z, G.ry);
  const hw = G.w / 2, hh = G.h / 2;
  const tl = G.tilt || 0;
  const pts = [[hw, -hh + tl * hw, 0], [-hw, -hh - tl * hw, 0], [-hw, hh - tl * hw, 0], [hw, hh + tl * hw, 0]];
  const tier = G.far ? TIER.FAR : TIER.STREET;
  S.cell(G.grime ? 'citygrime' : 'citysign', tier, G.cell, pts[0], pts[1], pts[2], pts[3]);
  if (G.back) {
    const b = G.back;
    S.box('metal', tier, 0, 0, b / 2 + 0.01, G.w + 0.08, G.h + 0.08, b, { rz: -Math.atan(tl) });
    if (G.two) S.cell('citysign', tier, G.cell, [-hw, -hh - tl * hw, b + 0.02], [hw, -hh + tl * hw, b + 0.02], [hw, hh + tl * hw, b + 0.02], [-hw, hh - tl * hw, b + 0.02]);
  }
  for (const px of G.posts || []) S.bar('rust', tier, [px, -hh - (G.post || 0), 0.06], [px, hh, 0.06], 0.1);
}

// ------------------------------------------------------------------ the city
export function buildCity(world, add) {
  const C = world.city;
  const S = new Soup();
  for (const B of C.buildings || []) {
    building(S, B);
    S.flush(add, B.x, B.z);
  }
  for (const W of C.shells || []) {
    shell(S, W);
    S.flush(add, (W.x0 + W.x1) / 2, (W.z0 + W.z1) / 2);
  }
  for (const R of C.rooms || []) {
    room(S, R);
    S.flush(add, R.x, R.z);
  }
  for (const H of C.heaps || []) {
    S.frame(H.x, H.y, H.z, H.ry || 0);
    rubble(S, 0, 0, 0, H.rx, H.rz, H.h, rngOf(H.seed), TIER.FAR, 0, H.brick ?? 0.3, !!H.ash);
    S.flush(add, H.x, H.z);
  }
  for (const T of C.fallen || []) {
    fallen(S, T);
    S.flush(add, T.x, T.z);
    S.frame(0, 0, 0, 0);
  }
  for (const P of C.pancakes || []) {
    pancake(S, P);
    S.flush(add, P.x, P.z);
  }
  for (const G of C.signs || []) {
    sign(S, G);
    S.flush(add, G.x, G.z);
  }
}
