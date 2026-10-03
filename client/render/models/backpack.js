// The craftable Backpack (ITEM.BACKPACK): one model for the item lying on the ground (pickups.js) and for the pack
// a survivor wears (characters.js, on the chest bone while PFLAG.BACKPACK is set), drawn in the character style -
// the char atlas's canvas, leather and knit cells under vertex colour, with darker piping along the seams and the
// edges rubbed pale. A 35-litre canvas rucksack at real size: a padded body 32 cm wide, 44 high and 20 deep that
// bulges at the front and narrows to the top, a domed lid with its front flap held by two leather straps and
// buckles, a zipped front pocket, a bottle sleeve on each side (a dented canteen in the left one), two compression
// straps round each side, a grab loop, the padded back panel, and a blanket roll tied on top with cord.
//
// Pack space: x across, y up from the bottom, z out from the back panel (z = 0 lies against the wearer's back, +z away
// from it). Worn, the shoulder straps come off the top of the back panel, over the shoulders and down the chest to a
// sternum strap and the webbing that runs under the arms back to the bottom corners; on the ground they lie loose down
// the back panel. About 4,000 triangles. The inventory icon (icons.js) draws this same pack: change the two together.
// The worn fit is checked in the models sandbox: /sandbox/models-test.html?pack=poses (and ?pack=ground).
import * as THREE from 'three';
import { MeshBuilder, getCharacterMaterial, fbm3 } from './skinning.js';
import { CR } from './charTextures.js';

const PI = Math.PI;
// the body (m)
const W = 0.32;
const H = 0.44;
const D = 0.2;
// where the worn pack sits in the chest bone's space (characters.js): its back panel 14.5 cm behind the bone, clear of
// the jacket, and its bottom 30 cm below it, at the small of the back
export const WORN_AT = [0, -0.3, 0.145];

const CANVAS = [0.4, 0.38, 0.25];
const LID = [0.24, 0.26, 0.16];
const LEATHER = [0.33, 0.2, 0.11];
const WEBBING = [0.1, 0.1, 0.09];
const BUCKLE = [0.05, 0.05, 0.045]; // (the plain cell is white: metal goes in dark)

// sewn canvas: piping darker where two panels meet (the edges of a rounded box, where the normal turns between faces),
// rubbed pale and thin on the corners, dirtier toward the bottom
function canvasTint(seamK = 1) {
  return (p, n, c) => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const edge = Math.min(Math.max(ax, az), ay) + Math.min(ax, az) * 0.9;
    if (edge > 0.42) c.multiplyScalar(1 - 0.32 * seamK * Math.min(1, (edge - 0.42) * 4));
    const wear = fbm3(p.x * 40, p.y * 40, p.z * 40, 2, 11);
    if (edge > 0.3 && wear > 0.6) c.lerp(new THREE.Color(0.62, 0.6, 0.5), 0.35);
    if (p.y < 0.07) c.multiplyScalar(0.72 + p.y * 4);
  };
}

// A flat strap swept along a curve: w wide (along `across`, kept square to the curve), t thick. Its section is a
// little rectangle, so it reads as webbing or a padded strap from any side.
function strap(mb, pts, w, t, across, o) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const n = o.ts || Math.max(4, pts.length * 4);
  const g = new THREE.Vector3(across[0], across[1], across[2]).normalize();
  const pos = [];
  const uv = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    curve.getPointAt(s, P);
    curve.getTangentAt(s, T);
    N.crossVectors(g, T).normalize();
    B.crossVectors(T, N).normalize();
    const ww = (o.taper ? o.taper(s) : 1) * w;
    for (let k = 0; k < corners.length; k++) {
      const [a, b] = corners[k];
      pos.push(P.x + B.x * a * ww * 0.5 + N.x * b * t * 0.5, P.y + B.y * a * ww * 0.5 + N.y * b * t * 0.5, P.z + B.z * a * ww * 0.5 + N.z * b * t * 0.5);
      uv.push(k / 4, s * (o.uvLen || 4));
    }
  }
  const idx = [];
  const ring = corners.length;
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 4; k++) {
      const a = i * ring + k, b = a + 1, c = a + ring, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return mb.geom(0, geo, o);
}

// A rounded box comes out of the builder as six faces with their own normals, which reads as flat facets on a soft
// padded body: one normal per point in space instead (the piping along the seams is the tint's job).
function smooth(geo) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const sum = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    const a = sum.get(k) || [0, 0, 0];
    a[0] += n.getX(i);
    a[1] += n.getY(i);
    a[2] += n.getZ(i);
    sum.set(k, a);
  }
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = sum.get(key(i));
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(i, x / l, y / l, z / l);
  }
  return geo;
}

// a buckle: a frame with its bar, at c, square to `normal`-ish (rot)
function buckle(mb, c, rot, s = 1) {
  const o = { region: CR.PLAIN, color: BUCKLE, mottle: 0.12, rot };
  mb.box(0, c, [0.03 * s, 0.024 * s, 0.006 * s], o);
  mb.box(0, [c[0], c[1], c[2]], [0.034 * s, 0.006 * s, 0.008 * s], { ...o, color: [0.36, 0.35, 0.32], rot });
}

// the padded body: a rounded box puffed out at the front, narrowing to the top, its back panel flat. (Rounding at
// 0.55 swells a box 8% past its size: it is built that much smaller, to come out W x H x D.)
const SWELL = 1.0825;
function body(mb) {
  smooth(mb.box(0, [0, H / 2, D / 2], [W / SWELL, H / SWELL, D / SWELL], {
    round: 0.55,
    sgx: 8,
    sgy: 9,
    sgz: 6,
    region: CR.CANVAS,
    color: CANVAS,
    mottle: 0.1,
    mf: 14,
    uv: [2, 2, 0, 0],
    shape: (v) => {
      const X = v.x / (W / 2), Y = v.y / (H / 2), Z = v.z / (D / 2);
      const up = Math.min(1, Math.max(0, (Y + 1) / 2));
      v.x *= 1 - 0.1 * up;
      if (Z > -0.4) v.z = -0.4 * (D / 2) + (v.z + 0.4 * (D / 2)) * (1 - 0.22 * Math.max(0, Y));
      if (Z > 0) v.z += D * 0.1 * (1 - X * X) * (1 - Y * Y) * Z;
      if (Z < -0.7) v.z = -D / 2 - 0.004 * (1 - X * X);
    },
    tint: canvasTint(),
  }));
  // padded back panel: a frame sheet and two foam pads with a channel between them
  mb.box(0, [0, H * 0.5, -0.01], [W * 0.82, H * 0.88, 0.012], { round: 0.35, seg: 2, region: CR.KNIT, color: [0.14, 0.14, 0.13], mottle: 0.08 });
  for (const s of [-1, 1]) mb.box(0, [s * 0.065, H * 0.54, -0.022], [0.105, H * 0.7, 0.026], { round: 0.6, seg: 2, region: CR.KNIT, color: [0.2, 0.2, 0.18], mottle: 0.1 });
  mb.box(0, [0, 0.085, -0.022], [0.25, 0.065, 0.026], { round: 0.6, seg: 2, region: CR.KNIT, color: [0.19, 0.19, 0.17], mottle: 0.1 });
}

// the domed lid over the top and its front flap down the face, two leather straps to buckles on the body
function lid(mb) {
  const topY = H - 0.012;
  mb.ellip(0, [0, topY, D * 0.5], [W * 0.47, 0.06, D * 0.56], {
    ws: 14,
    hs: 5,
    tl: PI / 2,
    region: CR.CANVAS,
    color: LID,
    mottle: 0.1,
    mf: 14,
    shape: (v) => {
      v.z += v.z > 0 ? v.z * 0.12 : 0;
    },
    tint: canvasTint(0.8),
    double: true,
  });
  // the flap: a padded sheet off the dome's front edge, wrapped round the curve of the face and hanging over its top,
  // its lower edge bound in leather (darker)
  const fh = 0.13;
  const fy = topY - 0.045;
  const fz = D * 1.06;
  smooth(mb.box(0, [0, fy, fz], [W * 0.84, fh, 0.014], {
    round: 0.3,
    sgx: 8,
    sgy: 4,
    sgz: 1,
    region: CR.CANVAS,
    color: LID,
    mottle: 0.1,
    mf: 14,
    // (just proud of the face, which leans back toward the top and rounds off to the sides; tucked under the dome)
    shape: (v) => {
      const X = v.x / (W * 0.42);
      const Y = v.y / fh + 0.5; // 0 at the bottom edge, 1 at the top
      v.z += 0.219 - fz - 0.045 * Y - X * X * 0.032 - Math.max(0, Y - 0.72) ** 2 * 0.5;
      v.y -= Math.abs(X) ** 3 * 0.012 * (1 - Y);
    },
    tint: (p, n, c) => {
      canvasTint(0.8)(p, n, c);
      if (p.y < fy - fh / 2 + 0.012) c.lerp(new THREE.Color(0.2, 0.13, 0.08), 0.8);
    },
  }));
  for (const s of [-1, 1]) {
    const x = s * 0.075;
    // from the back of the dome over it and down the flap, on down the face to its buckle
    const pts = [[x, topY + 0.02, D * 0.2], [x, topY + 0.062, D * 0.55], [x, topY + 0.03, D * 0.98], [x, topY - 0.05, D * 1.075], [x, topY - 0.15, D * 1.07]];
    strap(mb, pts, 0.026, 0.005, [1, 0, 0], { region: CR.LEATHER, color: LEATHER, mottle: 0.14, ts: 10, tint: (p, n, c) => fbm3(p.x * 90, p.y * 90, p.z * 90, 2, 3) > 0.62 && c.lerp(new THREE.Color(0.5, 0.36, 0.22), 0.4) });
    buckle(mb, [x, topY - 0.16, D * 1.075], [-0.05, 0, 0]);
    // the keeper strap sewn to the body that the buckle hangs from
    strap(mb, [[x, topY - 0.16, D * 1.07], [x, topY - 0.21, D * 1.06]], 0.022, 0.004, [1, 0, 0], { region: CR.LEATHER, color: [0.26, 0.16, 0.09], mottle: 0.1, ts: 2 });
  }
}

// the zipped front pocket
function pocket(mb) {
  const y = H * 0.27;
  smooth(mb.box(0, [0, y, D * 1.07], [W * 0.62, H * 0.36, 0.06], {
    round: 0.55,
    sgx: 5,
    sgy: 4,
    sgz: 2,
    region: CR.CANVAS,
    color: CANVAS.map((v) => v * 0.94),
    mottle: 0.1,
    mf: 14,
    shape: (v) => {
      if (v.z < -0.012) v.z = -0.012 - (v.z + 0.012) * 0.2;
    },
    tint: canvasTint(),
  }));
  // two leather lash tabs above it (for an axe or a coil of rope), each with its two slots
  for (const sx of [-1, 1]) {
    const c = [sx * 0.045, H * 0.56, D * 1.115];
    mb.box(0, c, [0.026, 0.034, 0.006], { round: 0.5, seg: 2, region: CR.LEATHER, color: [0.26, 0.16, 0.09], mottle: 0.12, rot: [-0.12, 0, PI / 4] });
    for (const dy of [-0.007, 0.007]) mb.box(0, [c[0], c[1] + dy, c[2] + 0.003], [0.012, 0.003, 0.002], { region: CR.PLAIN, color: [0.02, 0.02, 0.02], rot: [-0.12, 0, 0] });
  }
  // the zip along its top, and its pull
  const zy = y + H * 0.15;
  strap(mb, [[-W * 0.27, zy - 0.01, D * 1.08], [0, zy + 0.004, D * 1.1 + 0.022], [W * 0.27, zy - 0.01, D * 1.08]], 0.006, 0.004, [0, 1, 0], { region: CR.PLAIN, color: [0.03, 0.03, 0.03], mottle: 0.05, ts: 6 });
  mb.box(0, [W * 0.12, zy - 0.012, D * 1.1 + 0.026], [0.008, 0.026, 0.004], { region: CR.LEATHER, color: [0.2, 0.13, 0.08], mottle: 0.08, rot: [0.1, 0, 0.15] });
}

// a bottle sleeve on each side, a dented canteen in the left one, and two compression straps round each side
function sides(mb) {
  for (const s of [-1, 1]) {
    const x = s * (W * 0.5 + 0.004);
    const prof = [[0, 0], [0.034, 0.002], [0.04, 0.02], [0.042, 0.08], [0.044, 0.13], [0.046, 0.136]];
    mb.lathe(0, [x, 0.012, D * 0.58], prof, { rs: 10, region: CR.CANVAS, color: CANVAS.map((v) => v * 0.9), mottle: 0.1, sz: 0.8, double: true, tint: canvasTint() });
    // its elastic hem
    mb.lathe(0, [x, 0.012, D * 0.58], [[0.044, 0.128], [0.048, 0.132], [0.048, 0.142], [0.044, 0.146]], { rs: 10, sz: 0.8, region: CR.KNIT, color: [0.1, 0.1, 0.09], mottle: 0.05 });
    for (const y of [H * 0.4, H * 0.72]) {
      const pts = [[s * W * 0.43, y, 0.006], [s * (W * 0.52), y, D * 0.3], [s * (W * 0.53 - 0.01 * (y / H)), y, D * 0.62], [s * W * 0.44, y, D * 0.98]];
      strap(mb, pts, 0.024, 0.004, [0, 1, 0], { region: CR.CANVAS, color: WEBBING, mottle: 0.06, ts: 8 });
      buckle(mb, [s * (W * 0.5 + 0.004), y, D * 0.8], [0, s * 1.15, 0], 0.85);
    }
  }
  // the canteen: dented aluminium, its cap on a little chain
  const cx = -(W * 0.5 + 0.004), cz = D * 0.58;
  mb.lathe(0, [cx, 0.016, cz], [[0, 0], [0.028, 0.002], [0.031, 0.012], [0.031, 0.15], [0.026, 0.172], [0.012, 0.184], [0.012, 0.196]], {
    rs: 12,
    sz: 0.82,
    region: CR.PLAIN,
    color: [0.15, 0.155, 0.15],
    mottle: 0.16,
    mf: 30,
    noise: 0.0016,
    nf: 40,
    tint: (p, n, c) => c.multiplyScalar(0.8 + 0.25 * n.y + 0.15 * fbm3(p.x * 60, p.y * 60, p.z * 60, 2, 4)),
  });
  mb.lathe(0, [cx, 0.016, cz], [[0, 0.192], [0.015, 0.192], [0.015, 0.212], [0.012, 0.216], [0, 0.216]], { rs: 12, region: CR.PLAIN, color: [0.03, 0.03, 0.028], mottle: 0.05 });
}

// the blanket roll on the lid, tied with two turns of cord
function bedroll(mb) {
  const y = H + 0.084;
  const z = D * 0.52;
  const r = 0.052;
  const L = W * 1.06;
  const geo = new THREE.CylinderGeometry(r, r, L, 14, 3, false);
  mb.geom(0, geo, {
    rot: [0, 0, PI / 2],
    at: [0, y, z],
    region: CR.KNIT,
    color: [0.36, 0.2, 0.15],
    mottle: 0.14,
    mf: 18,
    // the rolled layers show at the ends as rings; a stripe woven across the blanket near each end
    tint: (p, n, c) => {
      if (Math.abs(n.x) > 0.7) {
        const rr = Math.hypot(p.y - y, p.z - z);
        c.multiplyScalar(Math.sin(rr * 620) > 0.2 ? 0.95 : 0.5);
      } else if (Math.abs(Math.abs(p.x) - L * 0.36) < 0.012) c.lerp(new THREE.Color(0.55, 0.48, 0.3), 0.7);
    },
  });
  for (const s of [-1, 1]) {
    for (const k of [0, 1]) mb.geom(0, new THREE.TorusGeometry(r + 0.003, 0.0035, 4, 14), { rot: [0, PI / 2, 0], at: [s * L * 0.3 + s * k * 0.008, y, z], region: CR.CLOTH, color: k ? [0.5, 0.42, 0.28] : [0.55, 0.47, 0.32], mottle: 0.12 });
    // the cord's loose ends
    mb.tube(0, [[s * L * 0.3, y - r, z + 0.01], [s * L * 0.3 + s * 0.01, y - r - 0.012, z + 0.04], [s * L * 0.3 + s * 0.02, y - r - 0.03, z + 0.05]], 0.003, 0.0025, { rs: 4, ts: 5, region: CR.CLOTH, color: [0.52, 0.45, 0.3] });
  }
}

// the grab loop at the top of the back panel
function grabLoop(mb) {
  strap(mb, [[-0.03, H - 0.035, 0.012], [-0.02, H + 0.01, 0.006], [0, H + 0.024, 0.004], [0.02, H + 0.01, 0.006], [0.03, H - 0.035, 0.012]], 0.022, 0.004, [0, 0, 1], { region: CR.CANVAS, color: WEBBING, mottle: 0.06, ts: 12 });
}

// the shoulder straps: worn, over the shoulders and down the chest (in pack space, from the chest bone's: WORN_AT);
// on the ground, lying loose down the back panel
function shoulderStraps(mb, worn) {
  const pad = { region: CR.CANVAS, color: [0.16, 0.17, 0.12], mottle: 0.08 };
  const web = { region: CR.CANVAS, color: WEBBING, mottle: 0.06 };
  for (const s of [-1, 1]) {
    if (worn) {
      // (chest-bone space, less WORN_AT): off the back panel, over the shoulder, down the chest
      const c = (x, y, z) => [x - WORN_AT[0], y - WORN_AT[1], z - WORN_AT[2]];
      const pts = [c(s * 0.075, 0.12, 0.148), c(s * 0.112, 0.205, 0.118), c(s * 0.122, 0.236, 0.02), c(s * 0.124, 0.205, -0.105), c(s * 0.124, 0.13, -0.142), c(s * 0.124, 0.02, -0.142), c(s * 0.122, -0.045, -0.14)];
      strap(mb, pts, 0.056, 0.016, [1, 0, 0], { ...pad, ts: 14, taper: (t) => 1 - 0.3 * Math.max(0, t - 0.7) / 0.3 });
      // the webbing on from the strap's foot, under the arm and back to the pack's bottom corner, with its buckle
      buckle(mb, c(s * 0.122, -0.06, -0.148), [0, 0, 0], 0.9);
      strap(mb, [c(s * 0.122, -0.07, -0.142), c(s * 0.15, -0.13, -0.11), c(s * 0.19, -0.19, -0.03), c(s * 0.2, -0.24, 0.06), c(s * 0.15, -0.28, 0.15)], 0.024, 0.004, [0.3 * s, 1, 0], { ...web, ts: 14 });
      // and the sternum strap's half, to the clip in the middle of the chest
      strap(mb, [c(s * 0.124, 0.07, -0.152), c(s * 0.06, 0.07, -0.158), c(s * 0.012, 0.07, -0.16)], 0.018, 0.004, [0, 1, 0], { ...web, ts: 4 });
    } else {
      strap(mb, [[s * 0.075, H - 0.02, -0.02], [s * 0.1, H - 0.1, -0.044], [s * 0.112, H * 0.5, -0.05], [s * 0.12, H * 0.22, -0.044], [s * 0.13, 0.04, -0.02]], 0.056, 0.013, [1, 0, 0], { ...pad, ts: 12, taper: (t) => 1 - 0.35 * Math.max(0, t - 0.6) / 0.4 });
    }
  }
  if (worn) {
    const c = (x, y, z) => [x - WORN_AT[0], y - WORN_AT[1], z - WORN_AT[2]];
    mb.box(0, c(0, 0.07, -0.162), [0.03, 0.022, 0.008], { round: 0.3, seg: 2, region: CR.PLAIN, color: [0.025, 0.025, 0.022], mottle: 0.04 });
  } else {
    // (the webbing ends hanging off the bottom corners)
    for (const s of [-1, 1]) strap(mb, [[s * 0.15, 0.03, 0.002], [s * 0.16, 0.02, -0.03], [s * 0.15, 0.012, -0.07]], 0.024, 0.004, [0, 1, 0.3], { region: CR.CANVAS, color: WEBBING, mottle: 0.06, ts: 6 });
  }
}

function buildPack(worn) {
  const mb = new MeshBuilder({ skinned: false });
  mb.aoStrength = 0.22;
  body(mb);
  lid(mb);
  pocket(mb);
  sides(mb);
  bedroll(mb);
  grabLoop(mb);
  shoulderStraps(mb, worn);
  return mb.build();
}

const cache = new Map();
/** The backpack as a mesh: worn (with its straps over the shoulders: put it at WORN_AT on the chest bone) or as
 *  it lies on the ground (resting on its base, back panel at z = 0). Geometry and material are shared. */
export function createBackpack(worn) {
  let built = cache.get(worn);
  if (!built) {
    built = buildPack(worn);
    cache.set(worn, built);
  }
  const mesh = new THREE.Mesh(built.geometry, getCharacterMaterial());
  mesh.name = worn ? 'worn_pack' : 'backpack';
  mesh.userData.tris = built.tris;
  return mesh;
}
