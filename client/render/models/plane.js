// Supply plane: a four-engine turboprop cargo lifter (C-130-like: ~30 m long, 40 m span), made to read from
// 100+ m below - high straight wing, deep nacelles with spinning props, upswept tail with the cargo ramp down.
// Front faces -Z. Origin on the fuselage axis at the wing; the ramp's lip is PLANE_RAMP (9 m) behind and ~2.3 m below.
import * as THREE from 'three';
import { MeshBuilder, partsToGroup } from '../materials.js';

const PI = Math.PI;
const BODY = [0.31, 0.34, 0.29]; // olive-grey
const RADOME = [0.19, 0.2, 0.19];
const GLASS = [0.035, 0.045, 0.055];
const PROP = [0.06, 0.06, 0.06];
const PROP_TIP = [0.78, 0.63, 0.12];
const INSIGNIA = [0.12, 0.15, 0.27];
const WHITE = [0.82, 0.82, 0.78];

export const ENGINE_X = [-9.95, -4.95, 4.95, 9.95];
export const ENGINE_Y = 2.05;
export const PROP_Z = -6.62;
export const PROP_R = 2.05;

// fuselage cross-sections along Z: centre height y, width w, height h
const FUS = [
  { z: -14.95, w: 0.25, h: 0.22, y: -0.4 },
  { z: -14.75, w: 1.3, h: 1.2, y: -0.38 },
  { z: -14.3, w: 2.4, h: 2.3, y: -0.3 },
  { z: -13.9, w: 3.0, h: 3.0, y: -0.2 },
  { z: -13.4, w: 3.5, h: 3.6, y: -0.08 },
  { z: -12.8, w: 3.9, h: 4.1, y: 0.02 },
  { z: -12.0, w: 4.2, h: 4.45, y: 0.08 },
  { z: -11.0, w: 4.3, h: 4.5, y: 0.05 },
  { z: 4.8, w: 4.3, h: 4.5, y: 0.05 },
  { z: 6.5, w: 4.25, h: 4.2, y: 0.2 },
  { z: 8.5, w: 3.95, h: 3.45, y: 0.6 },
  { z: 10.5, w: 3.4, h: 2.65, y: 1.0 },
  { z: 12.5, w: 2.55, h: 1.9, y: 1.38 },
  { z: 14.3, w: 1.4, h: 1.15, y: 1.7 },
  { z: 15.2, w: 0.45, h: 0.45, y: 1.85 },
  { z: 15.35, w: 0.05, h: 0.05, y: 1.86 },
];
// slightly boxy round section (flatter belly and sides than a circle, like a cargo hull)
const SQ = 2 / 2.4;
const fusProfile = (t) => {
  const a = t * PI * 2;
  const c = Math.cos(a), s = Math.sin(a);
  return [Math.sign(c) * Math.abs(c) ** SQ, Math.sign(s) * Math.abs(s) ** SQ];
};
// point on the hull at station z and angle a (0 = +x side, PI/2 = top), pushed `out` metres off the skin
function hullAt(z, a, out = 0) {
  let k = 0;
  while (k < FUS.length - 2 && FUS[k + 1].z < z) k++;
  const A = FUS[k], B = FUS[k + 1];
  const t = Math.max(0, Math.min(1, (z - A.z) / (B.z - A.z)));
  const w = A.w + (B.w - A.w) * t, h = A.h + (B.h - A.h) * t, y = A.y + (B.y - A.y) * t;
  const [px, py] = fusProfile(a / (PI * 2));
  const len = Math.hypot(px, py) || 1;
  return [px * (w / 2 + (out * px) / len), y + py * (h / 2 + (out * py) / len), z];
}
// a patch of skin between two stations and two angles (windows, the open cargo bay), tessellated to follow the hull
function hullPatch(b, mat, z0, z1, a0, a1, c, out = 0.03, nz = 1, na = 4) {
  const verts = [];
  const faces = [];
  for (let i = 0; i <= nz; i++) for (let j = 0; j <= na; j++) verts.push(hullAt(z0 + ((z1 - z0) * i) / nz, a0 + ((a1 - a0) * j) / na, out));
  for (let i = 0; i < nz; i++)
    for (let j = 0; j < na; j++) {
      const p = i * (na + 1) + j;
      faces.push([p, p + 1, p + na + 1], [p + 1, p + na + 2, p + na + 1]);
    }
  b.poly(mat, verts, faces, { c });
}

// airfoil section (NACA 00xx thickness, closed trailing edge) as a ring of [chord fraction, half-thickness / t]
const AIRFOIL = (() => {
  const N = 9;
  const up = [];
  for (let i = 0; i <= N; i++) {
    const u = (1 - Math.cos((PI * i) / N)) / 2;
    up.push([u, 5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4)]);
  }
  const ring = [];
  for (let i = N; i >= 0; i--) ring.push(up[i]); // trailing edge -> leading edge over the top
  for (let i = 1; i < N; i++) ring.push([up[i][0], -up[i][1]]); // and back underneath
  return ring;
})();

/**
 * Lifting surface through spanwise stations {s, le, c, t, y} (s ascending): leading edge z, chord, max thickness.
 * axis 'x': wing / tailplane (s = x, y = height) · 'y': fin (s = height, y = sideways). Close the ends with a
 * near-zero station.
 */
function surfaceGeo(stations, axis) {
  const R = AIRFOIL.length;
  const pos = [];
  const uv = [];
  for (const st of stations)
    for (const [u, v] of AIRFOIL) {
      const z = st.le + u * st.c;
      const off = (st.y || 0) + v * st.t;
      if (axis === 'x') pos.push(st.s, off, z);
      else pos.push(off, st.s, z);
      uv.push(z, st.s); // metres: panels run along the chord and the span
    }
  const idx = [];
  const flip = axis === 'x'; // keeps the winding (and computed normals) facing out
  for (let j = 0; j < stations.length - 1; j++)
    for (let k = 0; k < R; k++) {
      const a = j * R + k, b = j * R + ((k + 1) % R), c = a + R, d = b + R;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const mirror = (half) => [...half.map((s) => ({ ...s, s: -s.s })).reverse(), ...half];

function starShape(R) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? R * 0.382 : R;
    const a = PI / 2 + (i * PI) / 5;
    if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  sh.closePath();
  return sh;
}
// insignia: star in a disc, laid on a surface whose outward normal is n ([0,-1,0] under a wing, [±1,0,0] on a side)
function insignia(b, p, n, R) {
  const r = n[1] < 0 ? [PI / 2, 0, 0] : [0, n[0] > 0 ? PI / 2 : -PI / 2, 0];
  b.disc('aircraft', R, 20, { p, r: n[1] < 0 ? [PI, 0, 0] : [0, 0, n[0] > 0 ? -PI / 2 : PI / 2], c: INSIGNIA });
  b.extrude('aircraft', starShape(R * 0.9), 0.01, { p: [p[0] + n[0] * 0.01, p[1] + n[1] * 0.01, p[2] + n[2] * 0.01], r, c: WHITE });
}

let bodyParts = null, propParts = null;

function buildBody() {
  const b = new MeshBuilder(701, { ao: false });
  // ---------------------------------------------------------------- fuselage
  b.loft('aircraft', FUS, fusProfile, 28, { flip: true, c: BODY, cfn: (x, y, z, c) => (z < -14.05 ? c.setRGB(...RADOME) : c) });
  // cockpit glazing: windscreen panes across the brow, side windows behind them
  for (let k = 0; k < 6; k++) {
    const a0 = PI * (0.3 + k * 0.068), a1 = a0 + PI * 0.058;
    hullPatch(b, 'aircraft', -13.3, -12.55, a0, a1, GLASS, 0.03, 2, 2);
  }
  for (const a0 of [0.17, 0.75]) {
    hullPatch(b, 'aircraft', -12.35, -11.8, PI * a0, PI * (a0 + 0.08), GLASS, 0.03, 1, 1);
    hullPatch(b, 'aircraft', -11.65, -11.1, PI * a0, PI * (a0 + 0.08), GLASS, 0.03, 1, 1);
  }
  // crew door up front, paratroop doors aft (a shade darker than the skin)
  for (const [a0, a1] of [[-0.6, 0.25], [PI - 0.25, PI + 0.6]]) {
    hullPatch(b, 'aircraft', -10.3, -9.5, a0, a1, [0.22, 0.24, 0.2], 0.015, 1, 3);
    hullPatch(b, 'aircraft', 3.2, 4.1, a0, a1, [0.22, 0.24, 0.2], 0.015, 1, 3);
  }
  // open cargo bay: the dark hole under the upswept tail, ramp lowered level for the drop
  hullPatch(b, 'dark', 4.95, 11.6, PI * 1.33, PI * 1.67, undefined, 0.035, 6, 6);
  b.beam('aircraft', [0, -1.86, 4.95], [0, -2.3, 8.55], 3.0, 0.14, { side: [0, 1, 0], c: BODY });
  for (const s of [-1, 1]) b.beam('aircraft', [s * 1.45, -1.72, 4.95], [s * 1.45, -2.2, 8.55], 0.1, 0.35, { side: [0, 1, 0], c: [0.24, 0.26, 0.22] });
  b.box('aircraft', 2.9, 0.06, 0.4, { p: [0, -2.28, 8.4], c: [0.5, 0.48, 0.4] }); // worn lip plate
  // landing-gear sponsons along the belly, wing fairing on top
  for (const s of [-1, 1]) b.sphere('aircraft', 1, 16, 10, { p: [s * 1.95, -1.3, -0.2], s: [0.75, 0.95, 3.9], c: BODY });
  b.sphere('aircraft', 1, 16, 8, { p: [0, 2.28, -0.8], s: [1.75, 0.55, 4.4], c: BODY });
  // radome seam, antennae
  b.cylBetween('aircraft', [0, 2.3, -6], [0, 2.95, -5.4], 0.05, 0.03, 4, { c: [0.15, 0.15, 0.15] });
  b.cylBetween('aircraft', [0, -2.24, -4], [0, -2.7, -3.6], 0.04, 0.025, 4, { c: [0.15, 0.15, 0.15] });

  // ---------------------------------------------------------------- wing (one piece across the top)
  const WING = [
    { s: 2.2, le: -3.2, c: 4.85, t: 0.72, y: 2.55 },
    { s: 10.4, le: -2.75, c: 4.0, t: 0.5, y: 2.63 },
    { s: 20.2, le: -2.05, c: 2.45, t: 0.28, y: 2.78 },
    { s: 20.45, le: -1.4, c: 1.15, t: 0.04, y: 2.78 },
  ];
  b.add('aircraft', surfaceGeo(mirror(WING), 'x'), { c: BODY });
  for (const s of [-1, 1]) b.sphere('aircraft', 0.3, 8, 6, { p: [s * 20.25, 2.78, -0.9], s: [0.5, 0.35, 1.8], c: BODY }); // wingtip fairings
  // ---------------------------------------------------------------- engines
  const nacelle = [[0.001, -6.62], [0.42, -6.58], [0.62, -6.35], [0.72, -5.7], [0.76, -4.1], [0.76, -1.5], [0.67, 0.6], [0.47, 2.2], [0.2, 3.1], [0.001, 3.25]];
  const spinner = [[0.001, -7.5], [0.13, -7.4], [0.27, -7.1], [0.36, -6.8], [0.39, -6.62], [0.001, -6.6]];
  for (const x of ENGINE_X) {
    b.lathe('aircraft', nacelle, 18, { p: [x, ENGINE_Y, 0], r: [PI / 2, 0, 0], s: [0.95, 1, 1.22], c: BODY });
    b.lathe('aircraft', spinner, 14, { p: [x, ENGINE_Y, 0], r: [PI / 2, 0, 0], c: [0.26, 0.27, 0.25] });
    b.box('dark', 0.52, 0.32, 0.3, { p: [x, ENGINE_Y - 0.72, -6.05] }); // chin intake
    b.cylBetween('aircraft', [x + Math.sign(x) * 0.62, ENGINE_Y + 0.05, 0.9], [x + Math.sign(x) * 0.7, ENGINE_Y - 0.05, 2.1], 0.2, 0.22, 8, { c: [0.1, 0.09, 0.08] }); // exhaust stack
  }
  // ---------------------------------------------------------------- tail
  b.add(
    'aircraft',
    surfaceGeo(
      [
        { s: 1.3, le: 7.2, c: 8.0, t: 0.6 },
        { s: 2.4, le: 8.6, c: 6.5, t: 0.56 },
        { s: 8.4, le: 12.25, c: 3.05, t: 0.3 },
        { s: 8.62, le: 12.9, c: 1.9, t: 0.05 },
      ],
      'y',
    ),
    { c: BODY },
  );
  const HT = [
    { s: 1.0, le: 11.4, c: 3.85, t: 0.42, y: 1.8 },
    { s: 8.0, le: 13.2, c: 2.0, t: 0.18, y: 1.86 },
    { s: 8.25, le: 13.9, c: 1.0, t: 0.03, y: 1.86 },
  ];
  b.add('aircraft', surfaceGeo(mirror(HT), 'x'), { c: BODY });
  // ---------------------------------------------------------------- markings
  for (const s of [-1, 1]) {
    insignia(b, [s * 14.2, 2.47, -0.95], [0, -1, 0], 1.05);
    const [hx, hy] = hullAt(6.6, s > 0 ? 0.05 : PI - 0.05, 0.03);
    insignia(b, [hx, hy, 6.6], [s, 0, 0], 0.85);
  }
  return b.build();
}

function buildProp() {
  const b = new MeshBuilder(702, { ao: false });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * PI * 2;
    const r = [0, 0.45, a - PI / 2];
    b.box('aircraft', 0.3, 1.62, 0.06, { p: [Math.cos(a) * 1.12, Math.sin(a) * 1.12, 0], r, order: 'ZYX', c: PROP });
    b.box('aircraft', 0.28, 0.2, 0.062, { p: [Math.cos(a) * 1.95, Math.sin(a) * 1.95, 0], r, order: 'ZYX', c: PROP_TIP });
  }
  return b.build();
}

/**
 * The plane. userData.props: the four propeller groups (spin them about local Z) · userData.beacons: the red
 * anti-collision lights (blink them) · userData.discs: the translucent prop-blur discs.
 */
export function createCargoPlane() {
  if (!bodyParts) {
    bodyParts = buildBody();
    propParts = buildProp();
  }
  const g = partsToGroup(bodyParts, 'supply_plane');
  const discMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const discGeo = new THREE.CircleGeometry(PROP_R, 28);
  const props = [];
  const discs = [];
  for (const x of ENGINE_X) {
    const p = partsToGroup(propParts, 'prop');
    p.position.set(x, ENGINE_Y, PROP_Z);
    p.rotation.z = Math.random() * PI;
    g.add(p);
    props.push(p);
    const d = new THREE.Mesh(discGeo, discMat);
    d.position.set(x, ENGINE_Y, PROP_Z - 0.02);
    d.renderOrder = 2;
    g.add(d);
    discs.push(d);
  }
  // navigation lights (red left, green right, white tail) and blinking red beacons top and bottom
  const light = (color, r, p) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color }));
    m.position.set(...p);
    g.add(m);
    return m;
  };
  light(0xff2a1a, 0.16, [-20.5, 2.78, -1.0]);
  light(0x1aff5a, 0.16, [20.5, 2.78, -1.0]);
  light(0xfff4e0, 0.14, [0, 1.9, 15.4]);
  const beacons = [light(0xff2010, 0.2, [0, 2.95, 1.2]), light(0xff2010, 0.2, [0, -2.32, 1.5])];
  g.userData.props = props;
  g.userData.discs = discs;
  g.userData.beacons = beacons;
  return g;
}
