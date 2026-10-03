// Bullet impacts per surface, ricochet, near-miss whiz, flesh, glass, explosions.
// Physical layers: T = contact transient (tick/crack), B = struck-body modal response, D = debris grain cloud, plus material extras
// (metal whine, water bubble + splash, ice crack chirp, lava sizzle...).
import * as dsp from '../dsp.js';
import { PLATE, BELL, partialsFrom, grain, crunch, cloud, bubble, swish, creak, wander, tilt } from './common.js';

const IMPACT = {
  concrete(K, s, R) {
    K.mix(s, K.burst(0.006, { atk: 0.00005, tau: 0.0012, hp: 800, lp: 9000 }), 1, 0);
    K.mix(s, K.burst(0.02, { color: 'pink', atk: 0.0002, tau: 0.006, bp: 2800, q: 0.6 }), 0.7, 0);
    K.mix(s, K.thump(0.09, 190, 90, 0.03, 0.03), 0.5, 0);
    K.mix(s, crunch(K, 0.22, 260, 0.09, 1800, 6000, 0.002, 0.005, 0.16), 1, 0.004);
    K.mix(s, K.burst(0.14, { color: 'pink', atk: 0.002, tau: 0.05, lp: 1500 }), 0.1, 0.01);
  },
  brick(K, s, R) {
    K.mix(s, K.burst(0.006, { atk: 0.00005, tau: 0.0014, hp: 600, lp: 6500 }), 0.9, 0);
    K.mix(s, K.burst(0.03, { color: 'pink', atk: 0.0003, tau: 0.009, bp: 1900, q: 0.6 }), 0.7, 0);
    K.mix(s, K.thump(0.1, 160, 75, 0.03, 0.035), 0.55, 0);
    K.mix(s, K.ring(0.1, [[R.range(560, 700), 1, 0.02], [R.range(1200, 1500), 0.4, 0.012]], { soft: 0.001 }), 0.35, 0);
    K.mix(s, crunch(K, 0.3, 320, 0.12, 900, 3500, 0.003, 0.008, 0.2), 1, 0.006);
  },
  rock(K, s, R) {
    K.mix(s, K.burst(0.005, { atk: 0.00003, tau: 0.001, hp: 1500, lp: 11000 }), 1, 0);
    K.mix(s, K.ring(0.2, [[R.range(1300, 1700), 0.5, 0.03], [R.range(2600, 3100), 0.35, 0.02], [R.range(4400, 5200), 0.2, 0.012]], { soft: 0.0003 }), 0.6, 0);
    K.mix(s, K.thump(0.08, 210, 110, 0.025, 0.03), 0.4, 0);
    K.mix(s, crunch(K, 0.3, 200, 0.1, 800, 3200, 0.006, 0.016, 0.3), 1, 0.008);
    K.mix(s, crunch(K, 0.2, 250, 0.08, 2500, 7500, 0.002, 0.005, 0.14), 1, 0.003);
  },
  metal(K, s, R) { // struck steel: hard tick, ringing plate modes, low "dong" of the panel, rattle when the sheet is thin
    const thin = R.chance(0.5), f0 = R.range(650, thin ? 1500 : 2300), tau = thin ? 0.07 : 0.22;
    K.mix(s, K.burst(0.004, { atk: 0.00003, tau: 0.0009, hp: 1500 }), 1, 0);
    K.mix(s, K.ring(0.8, partialsFrom(f0, PLATE, tau), { soft: 0.0002 }), 0.75, 0);
    K.mix(s, K.ring(0.3, [[f0 * 0.16, 1, 0.07]], { soft: 0.001 }), 0.4, 0);
    if (thin) for (let k = 0; k < 6; k++) K.mix(s, grain(K, R.range(1500, 3200), 0.008), 0.3 * Math.pow(0.7, k), 0.015 + k * 0.022 * R.range(0.7, 1.4));
    K.mix(s, K.burst(0.02, { atk: 0.0002, tau: 0.005, bp: 4500, q: 0.7 }), 0.4, 0);
  },
  wood(K, s, R) { // "thock": plank body resonances + fibre crack + splinter ticks
    K.mix(s, K.ring(0.25, [[R.range(200, 340), 1, 0.045], [R.range(560, 700), 0.55, 0.03], [R.range(1150, 1350), 0.3, 0.02], [2400, 0.1, 0.012]], { soft: 0.0008 }), 0.85, 0);
    K.mix(s, K.burst(0.012, { atk: 0.0001, tau: 0.003, hp: 900, lp: 8000 }), 0.8, 0);
    K.mix(s, K.burst(0.03, { atk: 0.0003, tau: 0.009, bp: 2300, q: 0.9 }), 0.5, 0.002);
    K.mix(s, crunch(K, 0.14, 380, 0.05, 2500, 7000, 0.0012, 0.004, 0.24), 1, 0.005);
    K.mix(s, K.thump(0.1, 150, 80, 0.03, 0.03), 0.4, 0);
  },
  snow(K, s, R) { // no crack at all: a soft "fump" of crystals collapsing
    K.mix(s, K.burst(0.11, { color: 'pink', atk: 0.003, tau: 0.03, lp: 950 }), 0.9, 0);
    K.mix(s, K.thump(0.14, 95, 48, 0.04, 0.05), 0.6, 0);
    K.mix(s, crunch(K, 0.1, 500, 0.04, 1800, 5500, 0.0015, 0.004, 0.06), 1, 0.008);
    K.lp(s, 2600);
  },
  ice(K, s, R) { // brittle: crack chirp + glassy ring + fissure grains
    K.mix(s, K.burst(0.005, { atk: 0.00003, tau: 0.001, hp: 2000 }), 0.9, 0);
    K.mix(s, K.sweep(0.05, (u) => 5200 - 4000 * Math.pow(u, 0.6), { harm: [1, 0.3], atk: 0.001, rel: 0.02 }), 0.5, 0);
    K.mix(s, K.ring(0.4, [[R.range(2700, 3300), 0.5, 0.05], [R.range(4300, 5200), 0.35, 0.035], [R.range(6100, 7200), 0.2, 0.02]], { soft: 0.0002 }), 0.45, 0);
    K.mix(s, K.thump(0.12, 150, 75, 0.03, 0.04), 0.5, 0);
    K.mix(s, crunch(K, 0.25, 320, 0.09, 2500, 8500, 0.002, 0.007, 0.2), 1, 0.01);
  },
  water(K, s, R) { // plop-splash: cavity bubble (rising Minnaert tone), splash noise, droplets
    K.mix(s, bubble(K, R.range(420, 760), 0.03, 1.5), 0.9, 0.004);
    K.mix(s, K.svf(K.burst(0.22, { color: 'pink', atk: 0.002, tau: 0.06 }), 'bp', 2800, 0.5), 0.8, 0);
    K.mix(s, K.burst(0.03, { atk: 0.0002, tau: 0.007, hp: 2500 }), 0.5, 0);
    K.mix(s, K.thump(0.1, 120, 60, 0.025, 0.04), 0.4, 0);
    for (let k = 0; k < 9; k++) K.mix(s, grain(K, R.range(2000, 5200), 0.004), 0.25, 0.05 + R.next() * 0.3);
    for (let k = 0; k < 2; k++) K.mix(s, bubble(K, R.range(500, 1100), 0.012), 0.3, 0.06 + R.next() * 0.15);
  },
  glass(K, s, R) {
    K.mix(s, K.burst(0.004, { atk: 0.00003, tau: 0.001, hp: 2500 }), 0.9, 0);
    K.mix(s, K.ring(0.3, [[R.range(2200, 3000), 0.5, 0.06], [R.range(3800, 4600), 0.4, 0.04], [R.range(5900, 7000), 0.3, 0.03]], { soft: 0.0002 }), 0.6, 0);
    K.mix(s, crunch(K, 0.4, 900, 0.14, 2000, 9000, 0.006, 0.03, 0.25), 1, 0.004);
    K.mix(s, K.ring(0.2, [[R.range(500, 900), 0.6, 0.05]], { soft: 0.001 }), 0.3, 0);
  },
  crystal(K, s, R) { // chime-shatter: pentatonic bell partials + glittering shards
    const f = R.pick([1046.5, 1318.5, 1568, 1975.5, 2349]);
    K.mix(s, K.burst(0.004, { atk: 0.00003, tau: 0.001, hp: 2500 }), 0.8, 0);
    K.mix(s, K.ring(1.4, partialsFrom(f, BELL, 0.5), { soft: 0.0002 }), 0.55, 0.002);
    K.mix(s, K.ring(1.0, partialsFrom(f * 1.5, BELL, 0.3), { soft: 0.0003 }), 0.25, 0.03);
    K.mix(s, crunch(K, 0.6, 700, 0.25, 3000, 10000, 0.004, 0.02, 0.2), 1, 0.005);
  },
  lava(K, s, R) { // hiss + sizzling pops + gloop
    K.mix(s, K.burst(0.6, { atk: 0.004, tau: 0.22, hp: 2500 }), 0.28, 0);
    K.mix(s, crunch(K, 0.6, 900, 0.3, 900, 4200, 0.0015, 0.005, 0.35), 1, 0.01);
    K.mix(s, bubble(K, R.range(150, 260), 0.06, 1.3), 0.6, 0.02);
    K.mix(s, K.thump(0.14, 110, 55, 0.03, 0.05), 0.5, 0);
    K.mix(s, K.burst(0.01, { atk: 0.0001, tau: 0.002, hp: 1500 }), 0.5, 0);
  },
  fabric(K, s, R) {
    K.mix(s, K.burst(0.1, { color: 'pink', atk: 0.002, tau: 0.028, lp: 1300 }), 0.85, 0);
    K.mix(s, K.thump(0.1, 130, 65, 0.03, 0.035), 0.55, 0);
    K.mix(s, K.burst(0.15, { atk: 0.006, tau: 0.05, bp: 4500, q: 0.5 }), 0.06, 0.01);
    K.mix(s, K.burst(0.005, { atk: 0.00005, tau: 0.001, hp: 1200, lp: 6000 }), 0.2, 0);
  },
  dirt(K, s, R) {
    K.mix(s, K.thump(0.12, 130, 65, 0.035, 0.04), 0.75, 0);
    K.mix(s, K.burst(0.1, { color: 'pink', atk: 0.002, tau: 0.03, lp: 900 }), 0.8, 0);
    K.mix(s, K.burst(0.008, { atk: 0.00008, tau: 0.002, hp: 1000, lp: 7000 }), 0.4, 0);
    K.mix(s, crunch(K, 0.2, 240, 0.08, 1200, 4500, 0.003, 0.008, 0.16), 1, 0.006);
  },
  gravel(K, s, R) {
    K.mix(s, K.burst(0.005, { atk: 0.00005, tau: 0.001, hp: 1000, lp: 9000 }), 0.8, 0);
    K.mix(s, crunch(K, 0.35, 900, 0.14, 900, 6000, 0.002, 0.008, 0.36), 1, 0.002);
    K.mix(s, K.thump(0.1, 140, 70, 0.03, 0.035), 0.55, 0);
    K.mix(s, K.burst(0.06, { color: 'pink', atk: 0.001, tau: 0.02, lp: 800 }), 0.4, 0);
  },
  plastic(K, s, R) {
    K.mix(s, K.burst(0.005, { atk: 0.00005, tau: 0.001, hp: 1200 }), 0.8, 0);
    K.mix(s, K.ring(0.15, [[R.range(750, 1100), 1, 0.014], [R.range(1800, 2300), 0.5, 0.01], [R.range(3200, 3800), 0.2, 0.006]], { soft: 0.0006 }), 0.8, 0);
    K.mix(s, K.burst(0.03, { atk: 0.0003, tau: 0.008, bp: 2800, q: 0.7 }), 0.4, 0);
    K.mix(s, crunch(K, 0.08, 350, 0.04, 2000, 6000, 0.002, 0.005, 0.15), 1, 0.006);
  },
  tile(K, s, R) {
    K.mix(s, K.burst(0.005, { atk: 0.00003, tau: 0.001, hp: 2000 }), 1, 0);
    K.mix(s, K.ring(0.3, [[R.range(1700, 2000), 0.5, 0.04], [R.range(3200, 3600), 0.4, 0.03], [R.range(4700, 5200), 0.25, 0.02]], { soft: 0.0003 }), 0.5, 0);
    K.mix(s, K.thump(0.08, 260, 120, 0.02, 0.025), 0.4, 0);
    K.mix(s, crunch(K, 0.25, 300, 0.08, 1800, 7000, 0.002, 0.006, 0.2), 1, 0.005);
  },
  grass(K, s, R) {
    K.mix(s, K.thump(0.12, 120, 60, 0.03, 0.04), 0.65, 0);
    K.mix(s, K.burst(0.1, { color: 'pink', atk: 0.003, tau: 0.03, lp: 700 }), 0.7, 0);
    K.mix(s, K.svf(K.burst(0.12, { color: 'pink', atk: 0.01, tau: 0.04 }), 'bp', 3200, 0.7), 0.2, 0);
  },
};
const IMPACT_LEN = { concrete: 0.35, brick: 0.4, rock: 0.45, metal: 1.0, wood: 0.4, snow: 0.3, ice: 0.6, water: 0.6, glass: 0.7, crystal: 1.7, lava: 0.9, fabric: 0.3, dirt: 0.35, gravel: 0.5, plastic: 0.3, tile: 0.5, grass: 0.3 };
const IMPACT_PEAK = { snow: 0.45, fabric: 0.5, dirt: 0.55, grass: 0.5, water: 0.6, crystal: 0.6, lava: 0.55 };

function flesh(K, head) {
  const R = K.rng, s = K.buf(head ? 0.5 : 0.35);
  K.mix(s, K.thump(0.16, head ? 105 : 135, head ? 48 : 62, 0.035, head ? 0.06 : 0.045), head ? 0.7 : 0.62, 0);
  K.mix(s, K.burst(0.09, { color: 'pink', atk: 0.0008, tau: 0.03, lp: head ? 1400 : 700 }), 0.75, 0);
  K.mix(s, K.svf(K.burst(0.12, { color: 'pink', atk: 0.0005, tau: 0.035 }), 'bp', head ? 900 : 620, 0.8), head ? 0.7 : 0.75, 0.001);                // dull mid "thwack" of the wet tissue slap (the part that survives small speakers)
  K.mix(s, K.burst(0.02, { atk: 0.0002, tau: 0.006, bp: 1700, q: 0.7 }), 0.55, 0.002);                       // wet smack
  for (let k = 0; k < (head ? 5 : 4); k++) K.mix(s, bubble(K, R.range(220, 650), R.range(0.008, 0.016), 1.4), R.range(0.12, 0.25), 0.02 + k * R.range(0.02, 0.04)); // squelch
  if (head) { // skull: dense brittle crunch + bone ring + pop
    K.mix(s, crunch(K, 0.12, 2200, 0.04, 800, 4200, 0.0015, 0.005, 0.5), 1, 0);
    K.mix(s, K.ring(0.1, [[R.range(950, 1250), 0.6, 0.02], [R.range(1900, 2400), 0.3, 0.012]], { soft: 0.0005 }), 0.45, 0);
    K.mix(s, K.burst(0.03, { atk: 0.0001, tau: 0.008, hp: 2000, lp: 9000 }), 0.7, 0);
    K.mix(s, K.svf(K.burst(0.25, { color: 'pink', atk: 0.006, tau: 0.09 }), 'bp', 900, 1), 0.3, 0.02);
  }
  return s;
}

function gib(K) { // limb torn off / body bursting: deep wet burst, fibrous tearing, sloshing squelches, bone crunch, then droplets pattering back
  const R = K.rng, s = K.buf(0.95), n = K.n(0.36), rip = K.noise(0.36, 'pink'), w = wander(K, n, R.range(45, 75));
  K.mix(s, K.thump(0.36, 88, 36, 0.05, 0.12, { drive: 1.4 }), 1, 0);
  K.mix(s, K.burst(0.3, { color: 'pink', atk: 0.002, tau: 0.1, lp: 2200 }), 0.85, 0);
  for (let i = 0; i < n; i++) rip[i] *= Math.pow(w[i], 1.6); K.env(rip, { atk: 0.012, tau: 0.13 }); K.svf(rip, 'bp', (i) => 1700 - 900 * i / n, 0.8); K.mix(s, rip, 0.55, 0.015);
  for (let k = 0; k < R.int(9, 14); k++) K.mix(s, bubble(K, R.range(160, 620), R.range(0.008, 0.02), 1.4), R.range(0.12, 0.32), 0.02 + k * R.range(0.02, 0.045));
  K.mix(s, crunch(K, 0.14, 1800, 0.05, 700, 3800, 0.0015, 0.005, 0.5), 0.8, 0);
  K.mix(s, crunch(K, 0.6, 70, 0.28, 260, 1500, 0.004, 0.012, 0.3), 1, 0.12);
  return s;
}

function ricochet(K) { // pitch-dropping whine of a tumbling, deformed bullet leaving the surface + initial tick
  const R = K.rng, d = R.range(0.3, 0.5), f0 = R.range(3600, 6300), f1 = R.range(850, 1700), n = K.n(d), s = K.buf(d + 0.05);
  const fr = (u) => f1 + (f0 - f1) * Math.pow(1 - u, 2.2), tumble = R.range(22, 34);
  const w = K.sweep(d, fr, { harm: [1, 0.3, 0.12], atk: 0.004, rel: 0.05, amp: (u) => Math.pow(1 - u, 0.9) });
  const nz = K.svf(K.noise(d), 'bp', (i) => fr(i / n), 9); for (let i = 0; i < n; i++) { const am = 1 + 0.45 * Math.sin(dsp.TAU * tumble * i / K.sr); w[i] = (w[i] * 0.7 + nz[i] * 0.9 * (1 - i / n)) * am; }
  K.mix(s, w, 0.6, 0.004); K.mix(s, K.burst(0.005, { atk: 0.00003, tau: 0.001, hp: 1500 }), 0.8, 0); K.mix(s, K.ring(0.2, [[f0 * 0.7, 0.4, 0.04]], { soft: 0.0002 }), 0.25, 0);
  return s;
}
function whiz(K) { // supersonic pass-by: N-wave crack then a doppler-swept "zip" of turbulence
  const R = K.rng, d = R.range(0.14, 0.26), n = K.n(d), s = K.buf(d + 0.08), f0 = R.range(5500, 8500), f1 = R.range(1100, 2000);
  K.mix(s, K.burst(0.0012, { atk: 0.00002, tau: 0.0004, lp: 14000 }), 0.9, 0);
  const z = K.svf(K.noise(d, 'white'), 'bp', (i) => f1 + (f0 - f1) * Math.pow(1 - i / n, 1.7), 2.5); K.env(z, { atk: d * 0.12, tau: d * 0.35 });
  K.mix(s, z, 0.8, 0.002);
  const t = K.sweep(d, (u) => f1 * 1.3 + (f0 * 0.5 - f1 * 1.3) * Math.pow(1 - u, 1.7), { harm: [1, 0.25], atk: d * 0.1, rel: 0.03, amp: (u) => Math.pow(1 - u, 1.4) * 0.35 }); K.mix(s, t, 0.5, 0.002);
  return s;
}

function glassBreak(K, big) {
  const R = K.rng, T = big ? 1.7 : 1.0, s = K.buf(T);
  K.mix(s, K.burst(0.006, { atk: 0.00003, tau: 0.0012, hp: 1500 }), 1, 0);
  K.mix(s, K.burst(0.05, { atk: 0.0003, tau: 0.012, bp: 3600, q: 0.6 }), 0.7, 0);
  K.mix(s, K.ring(0.5, [[R.range(650, 950), 0.6, 0.08], [R.range(1400, 1900), 0.4, 0.06], [R.range(2600, 3200), 0.3, 0.05]], { soft: 0.0006 }), 0.5, 0);
  K.mix(s, cloud(K, T, (t) => (big ? 900 : 600) * Math.exp(-t / (big ? 0.28 : 0.16)), Array.from({ length: 14 }, () => grain(K, R.range(1800, 8500), R.range(0.008, 0.045))), 0.3), 1, 0.004);
  for (let k = 0; k < (big ? 9 : 4); k++) K.mix(s, K.ring(0.3, [[R.range(900, 2800), 1, R.range(0.05, 0.12)]], { soft: 0.0003 }), R.range(0.12, 0.3), 0.04 + Math.pow(R.next(), 1.6) * (big ? 1.0 : 0.5));
  return s;
}

// ------------------------------------------------------------------------------------------------ explosion
function* explosion(K, kind) {
  const R = K.rng, far = kind === 'far', small = kind === 'small', T = far ? 6.5 : small ? 2.8 : 5.2, s = K.buf(T), sc = small ? 0.6 : 1;
  if (!far) {
    const crack = K.burst(0.07, { atk: 0.0003, tau: small ? 0.008 : 0.014, hp: 350 }); K.sat(crack, 3); K.mix(s, crack, 1, 0);
    K.mix(s, K.burst(0.004, { atk: 0.00003, tau: 0.001, lp: 13000 }), 0.9, 0); yield;
  }
  K.mix(s, K.low(4, (K2) => K2.thump(far ? 3.4 : 2.6 * sc + 0.4, far ? 70 : 92, far ? 24 : 27, far ? 0.35 : 0.3 * sc, far ? 1.0 : 0.72 * sc, { drive: 2, atk: far ? 0.06 : 0.003 })), far ? 0.7 : 0.95, far ? 0.15 : 0.004); yield;
  K.mix(s, K.low(4, (K2) => { const a = K2.noise(far ? 3.5 : 2.4 * sc, 'pink'); K2.env(a, { atk: far ? 0.12 : 0.006, tau: far ? 0.9 : 0.55 * sc }); return K2.svf(a, 'lp', (i) => (far ? 120 : 140) + (far ? 500 : 2600) * Math.exp(-i / ((far ? 0.6 : 0.28) * K2.sr)), 0.8); }), far ? 0.8 : 0.85, far ? 0.15 : 0.002); yield;
  // debris rain: chunks thumping down and stones pinging, for 2-3 seconds
  K.mix(s, K.low(2, (K2) => { const pool = [...Array.from({ length: 7 }, () => K2.burst(0.05, { color: 'pink', atk: 0.001, tau: 0.012, lp: R.range(350, 900) })), ...Array.from({ length: 7 }, () => grain(K2, R.range(500, 2600), R.range(0.006, 0.02)))]; return cloud(K2, 3.2 * sc, (t) => (far ? 40 : 260 * sc) * Math.exp(-Math.max(0, t - 0.1) / 1.0), pool, 0.16); }), far ? 0.3 : 0.9, far ? 0.5 : 0.18); yield;
  // rolling rumble tail + terrain reflections
  const roll = K.low(6, (K2) => { const a = K2.noise(T, 'brown'); K2.env(a, { atk: far ? 0.5 : 0.05, tau: far ? 1.9 : 1.5 * sc + 0.3 }); K2.lp(a, far ? 160 : 230); return a; }); yield;
  K.mix(s, roll, far ? 0.9 : 0.55, 0.1); yield;
  for (const [dl, g] of [[0.33, 0.35], [0.71, 0.25], [1.22, 0.16]]) { const echo = roll.slice(0, K.n(1.6)); K.lp(echo, 500); K.mix(s, echo, g * (far ? 1.2 : 0.7), dl * R.range(0.9, 1.1) + (far ? 0.4 : 0)); } yield;
  K.lp(s, far ? 900 : 15000, far ? 4 : 2); if (far) K.lp(s, 600); yield;
  return s;
}

const HARD_IMPACT = new Set(['concrete', 'brick', 'rock', 'tile', 'plastic', 'wood', 'metal', 'gravel']); // (contact cracks: sub-bass cut, top lifted)
export function install(lib) {
  const core = new Set(['concrete']), core1 = new Set(['metal', 'wood', 'dirt', 'rock', 'snow']);
  for (const [surf, fn] of Object.entries(IMPACT)) lib.def(`impact.${surf}`, { n: 4, peak: IMPACT_PEAK[surf] ?? 0.85, prio: core.has(surf) ? 2 : core1.has(surf) ? 1 : 0 }, (K) => { const s = K.buf(IMPACT_LEN[surf]); fn(K, s, K.rng); if (HARD_IMPACT.has(surf)) tilt(K, s, 90, 2600, 0.8); return s; });
  lib.def('impact.flesh', { n: 4, peak: 0.7, prio: 2 }, (K) => flesh(K, false));
  lib.def('flesh.hit', { n: 4, peak: 0.7, prio: 2 }, (K) => flesh(K, false));
  lib.def('flesh.head', { n: 4, peak: 0.85, prio: 2 }, (K) => flesh(K, true));
  lib.def('flesh.gib', { n: 3, peak: 0.9, prio: 2 }, gib);
  lib.alias('impact.headshot', 'flesh.head');
  for (const [a, b] of [['carpet', 'fabric'], ['default', 'concrete'], ['sand', 'dirt'], ['mud', 'dirt'], ['stone', 'rock'], ['marble', 'tile'], ['steel', 'metal'], ['iron', 'metal'], ['cloth', 'fabric'], ['leather', 'fabric'], ['rubber', 'fabric'], ['foliage', 'grass'], ['leaves', 'grass']]) lib.alias(`impact.${a}`, `impact.${b}`);
  lib.def('ricochet', { n: 4, peak: 0.55, prio: 2 }, ricochet);
  lib.def('bullet.whiz', { n: 4, peak: 0.6, prio: 2, meta: { refDist: 2, maxDist: 40, doppler: 1 } }, whiz);
  lib.def('glass.break', { n: 3, peak: 0.8, prio: 0 }, (K) => glassBreak(K, true));
  lib.def('glass.tinkle', { n: 3, peak: 0.5, prio: 0 }, (K) => glassBreak(K, false));
  lib.def('explosion', { n: 3, peak: 0.97, prio: 2 }, (K) => explosion(K, 'near'));
  lib.def('explosion.small', { n: 2, peak: 0.94, prio: 1, meta: { refDist: 8 } }, (K) => explosion(K, 'small'));
  lib.def('explosion.far', { n: 2, peak: 0.85, prio: 1, meta: { refDist: 30 } }, (K) => explosion(K, 'far'));
}
