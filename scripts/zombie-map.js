// A top-down map of where the dead stand when the survivors arrive on a map: one red dot per zombie, over the water,
// the ground, the roads, what is built and the outline of every place. With --before, the same seed from another
// tree (a worktree of origin/main) goes on the left and this tree on the right, for a before / after.
// usage: node scripts/zombie-map.js <out.png> [--act island|mainland] [--seed 1] [--before <tree>]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const out = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!out) {
  console.error('usage: node scripts/zombie-map.js <out.png> [--act island|mainland] [--seed 1] [--before <tree>]');
  process.exit(1);
}
const act = opt('--act', 'mainland');
const seed = +opt('--seed', 1);
const before = opt('--before', null);
const here = resolve(fileURLToPath(import.meta.url), '../..');

// ---------------------------------------------------------------- a game, as the survivors find the map
async function load(root) {
  const mod = (p) => import(pathToFileURL(resolve(root, p)).href);
  const { Game } = await mod('server/game.js');
  const { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } = await mod('shared/protocol.js');
  const { ZONE } = await mod('shared/defs.js');
  const { PHASE } = await mod('shared/constants.js');
  const g = new Game({ seed, log: () => {}, themes: false, godMode: true });
  const conn = {
    id: 0,
    send(b) {
      const r = new Reader(b.slice ? b.slice().buffer : b);
      if (r.u8() === S2C.WELCOME) conn.id = r.u16();
    },
  };
  const ses = g.onOpen(conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('A');
  g.onMessage(ses, w.bytes().slice());
  g.update();
  const p = g.players.get(conn.id);
  if (act === 'mainland') {
    g.day = 3;
    g.phase = PHASE.NIGHT;
    g.cross(p, true);
    g.arrive();
  }
  const zs = g.zombies.filter((z) => !z.dead);
  const city = g.world.zoneById?.[ZONE.CITY];
  const inCity = city ? zs.filter((z) => Math.hypot(z.x - city.x, z.z - city.z) < city.flat).length : null;
  return { g, zs, city, inCity, start: { x: p.state.x, z: p.state.z } };
}

// ---------------------------------------------------------------- pixels
const W = 1280;
const H = 720;
const px = new Uint8Array(W * H * 3);
const set = (x, y, c) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
};
const fill = (c) => {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, c);
};
const disc = (cx, cy, r, c) => {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) set(cx + x, cy + y, c);
};
const ring = (cx, cy, r, c, t = 1) => {
  for (let y = -r - t; y <= r + t; y++) {
    for (let x = -r - t; x <= r + t; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d >= r - t / 2 && d <= r + t / 2) set(cx + x, cy + y, c);
    }
  }
};

// 5x7 capitals and digits
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ',': ['00000', '00000', '00000', '00000', '00000', '00100', '01000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
const text = (s, x, y, c, k = 3) => {
  for (const ch of s.toUpperCase()) {
    const gl = FONT[ch] || FONT[' '];
    for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (gl[r][q] === '1') for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) set(x + q * k + b, y + r * k + a, c);
    x += 6 * k;
  }
};

// ---------------------------------------------------------------- one map
const P = 620; // a panel's side (px)
function panel(s, ox, oy, title) {
  const w = s.g.world;
  const nav = s.g.nav;
  const m = w.size / P; // metres a pixel
  const at = (x, z) => [ox + Math.floor((x + w.half) / m), oy + Math.floor((z + w.half) / m)];
  for (let j = 0; j < P; j++) {
    for (let i = 0; i < P; i++) {
      const x = -w.half + (i + 0.5) * m;
      const z = -w.half + (j + 0.5) * m;
      let c;
      if (w.isDeepWater(x, z)) c = [34, 62, 96];
      else if (w.roadDistAt(x, z) < 3) c = [118, 116, 108];
      else if (nav.isBlocked(x, z)) c = [52, 52, 56];
      else {
        const k = Math.max(0, Math.min(1, (w.heightAt(x, z) + 2) / 30));
        c = [Math.round(70 + 40 * k), Math.round(92 + 34 * k), Math.round(58 + 22 * k)];
      }
      set(ox + i, oy + j, c);
    }
  }
  for (const zn of w.zones) {
    if (!zn.id || !zn.flat) continue;
    const [x, y] = at(zn.x, zn.z);
    ring(x, y, Math.round(zn.flat / m), zn === s.city ? [250, 220, 120] : [200, 200, 190], zn === s.city ? 2 : 1);
  }
  for (const z of s.zs) {
    const [x, y] = at(z.x, z.z);
    disc(x, y, 3, [60, 0, 0]);
    disc(x, y, 2, [240, 40, 40]);
  }
  const [sx, sy] = at(s.start.x, s.start.z);
  ring(sx, sy, 7, [255, 255, 255], 2);
  text(title, ox, oy - 52, [240, 240, 240]);
  text(`${s.zs.length} zombies${s.inCity != null ? `, ${s.inCity} in the city` : ''}`, ox, oy - 24, [240, 130, 120], 2);
}

const after = await load(here);
fill([22, 22, 26]);
if (before) {
  const b = await load(resolve(before));
  panel(b, 13, 88, 'Before');
  panel(after, W - P - 13, 88, 'After');
} else panel(after, (W - P) >> 1, 88, act);

// ---------------------------------------------------------------- PNG
const crcT = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (buf) => {
  let c = -1;
  for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${before ? 'before / after, ' : ''}${act}, seed ${seed}`);
process.exit(0);
