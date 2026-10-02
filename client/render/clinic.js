// Mercy Clinic (shared/clinic.js), the part of it the static world does not draw: the lining of its dark wards and
// the lettering of its signs.
// The lining is what is seen from inside the passage and the ward wing: floor, ceiling, the inner face of every
// wall, the partitions. Its boxes come from world generation (world.clinic.lining) and are drawn here with the
// material of the mine's rock: each vertex carries how much of the day reaches it (aSky: all of it at the doorway
// from reception, none a passage's length in), so from reception the passage falls away into black, and what a
// survivor sees in the wards is what their own light falls on.
import * as THREE from 'three';
import { smoothstep } from '../../shared/rng.js';
import { mesh } from './mine.js';

const STEP = 1.2; // a face is cut into pieces no longer than this, so the dark and the stains vary along it
const TILE = 0.6; // the floor's lino tiles
const DADO = 1.3; // the walls are painted green up to here above the floor, cream above
// paint by kind of piece, as multipliers of the texture (a grey concrete tile: over 1 lifts it to pale plaster, so
// that by the door from reception, where the day still reaches, the passage is no darker than the room it leaves)
const TINT = { low: [0.6, 0.86, 0.74], high: [1.4, 1.34, 1.12], ceil: [1.15, 1.13, 1.02], tileA: [1.05, 1.08, 0.98], tileB: [0.5, 0.66, 0.6], board: [0.8, 0.64, 0.48] };

// blotches: smooth value noise on a lattice, 0..1
function hash3(x, y, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const su = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const sv = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
  const sw = (z - zi) * (z - zi) * (3 - 2 * (z - zi));
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), su), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), su), sv),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), su), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), su), sv),
    sw,
  );
}

// The faces of the signs: one canvas, the board of the car park's sign in its upper two thirds (2 : 1) and the strip
// over the door below it. -> { map, uv: per kind [u0, v0, u1, v1] }
function signTexture() {
  const W = 512;
  const H = 384;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  let seed = 9173;
  const r = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const font = (px) => `bold ${px}px "Arial Black", "Arial", sans-serif`;
  const grime = (x, y, w, h, n) => {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    for (let k = 0; k < n; k++) {
      // rust runs down from the top edge, dirt blooms anywhere
      const gx = x + r() * w;
      const run = g.createLinearGradient(0, y, 0, y + h * (0.3 + r() * 0.6));
      run.addColorStop(0, `rgba(96,52,24,${0.25 + r() * 0.3})`);
      run.addColorStop(1, 'rgba(96,52,24,0)');
      g.fillStyle = run;
      g.fillRect(gx, y, 2 + r() * 5, h);
      const px = x + r() * w;
      const py = y + r() * h;
      const R = 10 + r() * h * 0.35;
      const blot = g.createRadialGradient(px, py, 0, px, py, R);
      blot.addColorStop(0, `rgba(30,26,18,${0.1 + r() * 0.18})`);
      blot.addColorStop(1, 'rgba(30,26,18,0)');
      g.fillStyle = blot;
      g.fillRect(px - R, py - R, R * 2, R * 2);
    }
    g.restore();
  };
  const cross = (x, y, s, col) => {
    g.fillStyle = col;
    g.fillRect(x - s * 0.17, y - s / 2, s * 0.34, s);
    g.fillRect(x - s / 2, y - s * 0.17, s, s * 0.34);
  };
  // the board
  g.fillStyle = '#d6d2c2';
  g.fillRect(0, 0, W, 256);
  g.strokeStyle = '#27493b';
  g.lineWidth = 8;
  g.strokeRect(10, 10, W - 20, 236);
  cross(104, 128, 132, '#96201a');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#27493b';
  g.font = font(74);
  g.fillText('MERCY', 334, 92, 300);
  g.fillText('CLINIC', 334, 170, 300);
  g.fillStyle = '#96201a';
  g.fillRect(196, 214, 276, 6);
  grime(0, 0, W, 256, 22);
  // the strip over the door
  g.fillStyle = '#d0ccbc';
  g.fillRect(0, 264, W, 76);
  cross(38, 302, 44, '#96201a');
  cross(W - 38, 302, 44, '#96201a');
  g.fillStyle = '#27493b';
  g.font = font(50);
  g.fillText('MERCY CLINIC', W / 2, 304, 390);
  grime(0, 264, W, 76, 12);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return { map, uv: [[0, 1 - 256 / H, 1, 1], [0, 1 - 340 / H, 1, 1 - 264 / H]] };
}

// -> THREE.Group (the lining and the signs), or null on a map without the clinic
export function buildClinic(world) {
  const c = world.clinic;
  if (!c) return null;
  const dark = world.darks[0];
  const floorY = c.y;
  // how much of the day reaches (x, z): what world.darkAt leaves of it (asked of the mouth itself, not of the boxes:
  // a vertex on the wall of one is neither in nor out)
  const skyAt = (x, z) => 1 - smoothstep(dark.near, dark.far, Math.hypot(x - dark.mx, z - dark.mz));
  const soup = () => ({ pos: [], col: [], sky: [] });
  const plaster = soup();
  const boards = soup();
  const vert = (to, p, tint) => {
    // (damp comes up from the floor and down from the roof; the rest is how the years sat on the paint)
    const n = noise3(p[0] * 0.55, p[1] * 0.9, p[2] * 0.55);
    const k = 0.74 + 0.36 * n;
    to.pos.push(p[0], p[1], p[2]);
    to.col.push(tint[0] * k * (1 + 0.08 * n), tint[1] * k, tint[2] * k * (1 - 0.05 * n));
    to.sky.push(skyAt(p[0], p[2]));
  };
  // a flat rectangle a + u * U + v * V (wound a, a+U, a+U+V, a+V: its front is U x V), in pieces; tint(i, j, nu, nv)
  // colours each piece
  const rect = (to, a, U, V, nu, nv, tint) => {
    const at = (i, j) => [a[0] + (U[0] * i) / nu + (V[0] * j) / nv, a[1] + (U[1] * i) / nu + (V[1] * j) / nv, a[2] + (U[2] * i) / nu + (V[2] * j) / nv];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const t = tint(i, j);
        const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        for (const p of [q[0], q[1], q[2], q[0], q[2], q[3]]) vert(to, p, t);
      }
    }
  };

  for (const part of c.lining) {
    const { x, y, z, sx, sy, sz, mat } = part;
    const cy = Math.cos(part.ry || 0);
    const sny = Math.sin(part.ry || 0);
    const cz = Math.cos(part.rz || 0);
    const snz = Math.sin(part.rz || 0);
    // a point of the box in the world: turned about its own Z, then about Y (as the static world turns its parts)
    const at = (lx, ly, lz) => {
      const ax = lx * cz - ly * snz;
      const ay = lx * snz + ly * cz;
      return [x + ax * cy + lz * sny, y + ay, z - ax * sny + lz * cy];
    };
    const sub = (p, q) => [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const to = mat === 'board' ? boards : plaster;
    const cuts = (len, step = STEP) => Math.max(1, Math.ceil(len / step));
    // the top and the underside (a floor shows its top as tiles, a ceiling its underside, a lintel what is under it)
    const flat = mat === 'floor' ? (i, j) => ((i + j) & 1 ? TINT.tileA : TINT.tileB) : () => (mat === 'board' ? TINT.board : mat === 'wall' ? TINT.high : TINT.ceil);
    const step = mat === 'floor' ? TILE : STEP;
    rect(to, at(-hx, hy, hz), sub(at(-hx, hy, hz), at(hx, hy, hz)), sub(at(-hx, hy, hz), at(-hx, hy, -hz)), cuts(sx, step), cuts(sz, step), flat);
    if (mat !== 'floor') rect(to, at(-hx, -hy, -hz), sub(at(-hx, -hy, -hz), at(hx, -hy, -hz)), sub(at(-hx, -hy, -hz), at(-hx, -hy, hz)), cuts(sx), cuts(sz), flat);
    if (mat === 'floor' || mat === 'ceil') continue;
    // the four sides. A wall is two bands: green below the dado line, cream above it
    const bands = [];
    const dado = floorY + DADO - (y - hy); // the line, measured up the piece
    if (mat !== 'wall' || dado <= 0.02) bands.push([-hy, hy, mat === 'board' ? TINT.board : TINT.high]);
    else if (dado >= sy - 0.02) bands.push([-hy, hy, TINT.low]);
    else bands.push([-hy, -hy + dado, TINT.low], [-hy + dado, hy, TINT.high]);
    for (const [y0, y1, tint] of bands) {
      const t = () => tint;
      rect(to, at(-hx, y0, hz), sub(at(-hx, y0, hz), at(hx, y0, hz)), sub(at(-hx, y0, hz), at(-hx, y1, hz)), cuts(sx), 1, t); // +z
      rect(to, at(hx, y0, -hz), sub(at(hx, y0, -hz), at(-hx, y0, -hz)), sub(at(hx, y0, -hz), at(hx, y1, -hz)), cuts(sx), 1, t); // -z
      rect(to, at(hx, y0, hz), sub(at(hx, y0, hz), at(hx, y0, -hz)), sub(at(hx, y0, hz), at(hx, y1, hz)), cuts(sz), 1, t); // +x
      rect(to, at(-hx, y0, -hz), sub(at(-hx, y0, -hz), at(-hx, y0, hz)), sub(at(-hx, y0, -hz), at(-hx, y1, -hz)), cuts(sz), 1, t); // -x
    }
  }

  const group = new THREE.Group();
  group.name = 'clinic';
  group.add(mesh('clinic-plaster', plaster, 'concrete'), mesh('clinic-boards', boards, 'wood'));
  // the lettered faces of the signs, lit like any painted board
  const face = signTexture();
  const paint = new THREE.MeshLambertMaterial({ map: face.map });
  for (const s of c.signs) {
    const geo = new THREE.PlaneGeometry(s.w, s.h);
    const [u0, v0, u1, v1] = face.uv[s.kind];
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    const m = new THREE.Mesh(geo, paint);
    m.name = 'clinic-sign';
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.ry;
    m.receiveShadow = true;
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  group.matrixAutoUpdate = false;
  return group;
}

// (the materials were made for this world; the lining's textures are the shared tiles, the signs' canvas is their own)
export function disposeClinic(group) {
  for (const m of group.children) {
    m.geometry.dispose();
    if (m.name === 'clinic-sign') m.material.map.dispose();
    m.material.dispose();
  }
}
