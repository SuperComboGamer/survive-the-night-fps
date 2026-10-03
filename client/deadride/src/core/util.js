// Shared math / RNG / noise helpers. No allocations in hot helpers.
export const PI = Math.PI, TAU = Math.PI * 2, DEG = Math.PI / 180;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const smoother = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const sign = (x) => (x < 0 ? -1 : 1);
export const wrapAngle = (a) => { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; };
export const angleDelta = (a, b) => wrapAngle(b - a);
export const dampAngle = (a, b, lambda, dt) => a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// mulberry32 seeded RNG
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.gauss = () => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  r.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  r.onDisc = (out, rad = 1) => { const a = r() * TAU, d = Math.sqrt(r()) * rad; out.x = Math.cos(a) * d; out.z = Math.sin(a) * d; return out; };
  return r;
}
export const rand = makeRng((Math.random() * 4294967296) >>> 0); // global non-deterministic RNG for gameplay/effects
export const strHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// ---- value/gradient noise (JS side; used for terrain, placement, waves, camera shake) ----
const P = new Uint8Array(512);
(() => { const r = makeRng(1337); const p = Array.from({ length: 256 }, (_, i) => i); r.shuffle(p); for (let i = 0; i < 512; i++) P[i] = p[i & 255]; })();
const G3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise3(x, y, z) {
  let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
  const u = fade(x), v = fade(y), w = fade(z);
  const g = (h, dx, dy, dz) => { const q = G3[h % 12]; return q[0] * dx + q[1] * dy + q[2] * dz; };
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return lerp(
    lerp(lerp(g(P[AA], x, y, z), g(P[BA], x - 1, y, z), u), lerp(g(P[AB], x, y - 1, z), g(P[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(g(P[AA + 1], x, y, z - 1), g(P[BA + 1], x - 1, y, z - 1), u), lerp(g(P[AB + 1], x, y - 1, z - 1), g(P[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}
export const noise2 = (x, y) => noise3(x, y, 0.5);
export function fbm2(x, y, oct = 5, lac = 2, gain = 0.5) { let a = 0.5, s = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, i * 7.13); f *= lac; a *= gain; } return s; }
export function fbm3(x, y, z, oct = 4, lac = 2, gain = 0.5) { let a = 0.5, s = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f + i * 3.7); f *= lac; a *= gain; } return s; }
export function ridged2(x, y, oct = 5) { let a = 0.5, s = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(noise3(x * f, y * f, i * 5.3))); f *= 2; a *= 0.5; } return s; }

// ---- springs / integrators (used by recoil, vehicles, sway) ----
export class Spring {
  constructor(k = 120, c = 14, x = 0) { this.k = k; this.c = c; this.x = x; this.v = 0; this.target = 0; }
  step(dt) { // semi-implicit euler, substepped for stability
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (this.k * (this.target - this.x) - this.c * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
  kick(imp) { this.v += imp; }
}
export class Spring3 {
  constructor(k, c) { this.x = new Spring(k, c); this.y = new Spring(k, c); this.z = new Spring(k, c); }
  step(dt) { this.x.step(dt); this.y.step(dt); this.z.step(dt); }
  kick(a, b, c) { this.x.kick(a); this.y.kick(b); this.z.kick(c); }
}

// tiny array pool
export class Pool {
  constructor(make, n = 0) { this.make = make; this.free = []; for (let i = 0; i < n; i++) this.free.push(make()); }
  get() { return this.free.pop() || this.make(); }
  put(o) { this.free.push(o); }
}

export const hex = (c) => c; // documentation helper: colors are given as 0xRRGGBB sRGB and converted by three's ColorManagement
export const fmt = (n, d = 1) => n.toFixed(d);
export const now = () => performance.now() / 1000;
