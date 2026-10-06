// Is the nunchucks' motion smooth? Runs the rig both views share (NunchakuCore, with each view's own colliders and the
// meshes as they are placed) through every move and every hand-off between two of them, on a stepped clock, at 30, 60,
// 90, 144 and 240 frames a second and on uneven frames with hitches, and measures what is drawn frame by frame: the
// hands (grip, wrist, elbow, the fist's turn), both handles (their ends, their roll), every link (its place, its
// roll), the view's jolt and the body's track. No browser.
//
// What it looks for, on every one of those points:
//   shake   the point goes there, back and there again: three accelerations in a row, each against the last (four, for
//           the simulated half). Given as the size of the wobble, in mm (the smallest of them, x dt^2) - what the eye
//           sees.
//   pop     one step far longer than the steps either side of it (over 2.5 times the longer of them), in mm: the point
//           was put somewhere, it did not go there.
//   snap    (the authored half only) the acceleration of a hand's grip, wrist and elbow, and of the ends of a handle
//           a hand has, m/s^2: a pose that jumps is thousands; a strike is hundreds.
//   jerk    the change of acceleration from one frame to the next, m/s^3 (reported: it has no pass mark of its own -
//           it is what shake and snap are made of).
// The free handle and the chain are a simulation: they are struck, caught and rebound, so a single large acceleration
// is theirs to have. A wobble is not.
//
// usage: node scripts/clip/nunchaku-jitter.js [--view fp,tp] [--only name,...] [--fps 30,60,...,uneven] [--worst 12]
//          [--trace scenario@fps]   (prints the frames around that run's worst shake)
import * as THREE from 'three';
import { NK_MOVES, NK_MOVE, NK, NK_GEOM } from '../../shared/nunchaku.js';
import { NunchakuFP, NunchakuTP } from '../../client/render/models/nunchaku.js';

const M = NK_MOVE;
export const JITTER_RATES = [30, 60, 90, 144, 240, 'uneven'];
// The pass marks: mm of shake or pop on the hands and the held handle / on the free handle and the links; m/s^2 of
// a hand, and of the ends of a handle a hand has. (Before the motion was made smooth - this script run on the tree
// before it - the worst were 700 mm, 594 mm and 40,000 m/s^2. They are 9 mm - an elbow -, 34 mm - a chain link as
// the chain turns over, its two eyes passing each other - and 1600 m/s^2.)
export const JITTER_LIMIT = { held: 12, free: 60, snap: 2000, snapTip: 4500 };
const P0 = { shoulderW: 0.185, uarmLen: 0.29, farmLen: 0.26, shoulderY: 1.41, chestY: 1.26 };

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The scenarios: { name, events: [[t, fn(rig)]], wind(t), state(t) -> { sprint, crouch, speed, yaw, acc }, secs, idle }.
 * t = 0 is 0.8 s after the rig is made (settled in the guard).
 */
export function scenarios() {
  const out = [];
  // (the wind-up clock from a to b: the frame that lets go is the one whose strike it is, whatever the rounding)
  const windOf = (a, b) => (t) => (t >= a - 1e-6 && t < b - 1e-6 ? t - a + 1 / 240 : 0);
  const swingAt = (t, m, hit) => {
    const e = [[t, (r) => r.swing(m)]];
    if (hit) for (const h of NK_MOVES[m].hits) e.push([t + h, (r) => r.hit(hit)]);
    return e;
  };
  const add = (name, events, o = {}) => out.push({ name, events: events.sort((a, b) => a[0] - b[0]), wind: o.wind || (() => 0), state: o.state || (() => ({})), secs: o.secs || 2.6, idle: !!o.idle });
  add('guard', [], { secs: 2 });
  add('idle flourishes', [], { secs: 13, idle: true });
  NK_MOVES.forEach((m, i) => {
    if (i >= M.HEAVY1) return;
    const st = i === M.LUNGE ? () => ({ sprint: false, speed: 5 }) : i === M.SWEEP ? () => ({ crouch: true }) : undefined;
    add(m.name, swingAt(0, i), { state: st });
    add(`${m.name}, landing`, swingAt(0, i, 'bone'), { state: st });
  });
  for (const hit of ['', 'flesh', 'metal']) {
    const ev = [];
    let t = 0;
    for (const m of [0, 1, 2, 3, 0, 1, 2, 3]) {
      ev.push(...swingAt(t, m, hit));
      t += NK_MOVES[m].rate;
    }
    add(`light chain twice${hit ? `, landing on ${hit}` : ''}`, ev, { secs: t + 2 });
  }
  {
    // each press at the last moment of the window
    const ev = [];
    let t = 0;
    for (const m of [0, 1, 2, 3]) {
      ev.push(...swingAt(t, m));
      t += NK_MOVES[m].rate + NK.window - 0.02;
    }
    add('light chain, each press at the end of its window', ev, { secs: t + 2 });
  }
  // every move into every other, the moment the first allows it and a quarter of a second later (mid-settle)
  for (let a = 0; a < M.HEAVY1; a++) {
    for (let b = 0; b < M.HEAVY1; b++) {
      for (const gap of [0, 0.25]) add(`${NK_MOVES[a].name} > ${NK_MOVES[b].name}${gap ? ' (late)' : ''}`, [...swingAt(0, a), ...swingAt(NK_MOVES[a].rate + gap, b)], { secs: NK_MOVES[a].rate + gap + 2.2 });
    }
  }
  [0.2, 0.7, 1.4, 2.4].forEach((held, i) => {
    const mv = M.HEAVY1 + Math.min(2, i);
    for (const hit of ['', 'bone']) add(`heavy, held ${held} s${hit ? ', landing' : ''}`, swingAt(held, mv, hit), { wind: windOf(0, held), secs: held + 3 });
  });
  add('whip > wind-up > heavy', [...swingAt(0, 0), ...swingAt(0.32 + 1.0, M.HEAVY3)], { wind: windOf(0.32, 1.32), secs: 4.2 });
  add('heavy > whip', [...swingAt(0.7, M.HEAVY2), ...swingAt(0.7 + 0.75, 0)], { wind: windOf(0, 0.7), secs: 4 });
  add('draw', [[0, (r) => r.draw()]], { secs: 2.2 });
  add('put away > draw', [[0, (r) => r.holster()], [0.19, (r) => r.draw()]], { secs: 2.4 });
  add('draw > whip at once', [[0, (r) => r.draw()], ...swingAt(0.2, 0)], { secs: 2.6 });
  add('flourish', [[0, (r) => r.flourish()]], { secs: 7 });
  for (const at of [0.5, 0.9, 1.45, 2.1, 2.6, 3.3, 3.9]) add(`flourish, broken into by a whip at ${at} s`, [[0, (r) => r.flourish()], ...swingAt(at, 0)], { secs: at + 2.6 });
  add('flourish, broken into by a wind-up', [[0, (r) => r.flourish()], ...swingAt(1.2 + 1.0, M.HEAVY3)], { wind: windOf(1.2, 2.2), secs: 5.2 });
  const run = (t) => (t >= 0 && t < 1.2 ? { sprint: true, speed: 7 } : {});
  add('sprint and stop', [], { state: run, secs: 2.8 });
  add('sprint > lunge', swingAt(1.2, M.LUNGE), { state: run, secs: 3.6 });
  add('crouch and stand', [], { state: (t) => (t >= 0 && t < 1 ? { crouch: true } : {}), secs: 2.4 });
  add('crouched sweep > stand', swingAt(0.5, M.SWEEP), { state: (t) => (t >= 0 && t < 1 ? { crouch: true } : {}), secs: 3 });
  // turning hard and being thrown about while striking
  const turn = (t) => ({ yaw: 2.2 * Math.sin(t * 3.1), pitch: 0.5 * Math.sin(t * 2.3), acc: [8 * Math.sin(t * 5), 0, 6 * Math.cos(t * 4)] });
  {
    const ev = [];
    let t = 0.2;
    for (const m of [0, 1, 2, 3]) {
      ev.push(...swingAt(t, m, 'flesh'));
      t += NK_MOVES[m].rate;
    }
    add('light chain, turning and moving', ev, { state: turn, secs: t + 2 });
  }
  add('heavy, turning and moving', swingAt(1.4, M.HEAVY3), { wind: windOf(0, 1.4), state: turn, secs: 4.2 });
  add('flourish, turning and moving', [[0, (r) => r.flourish()]], { state: turn, secs: 6 });
  return out;
}

const _geo = { handle: new THREE.BufferGeometry(), link: new THREE.BufferGeometry() };
const _mat = new THREE.MeshBasicMaterial();
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

// a view's rig behind one face: swing / hit / draw / holster / flourish, frame(dt, wind, state) and the points drawn
function makeRig(view, idle) {
  const fp = view === 'fp';
  const nk = fp ? new NunchakuFP(_geo, _mat) : new NunchakuTP(_geo, _mat, P0);
  const core = nk.core;
  core.noIdle = !idle;
  const handle0 = fp ? new THREE.Mesh(_geo.handle, _mat) : nk.handle0;
  const chest = new THREE.Object3D();
  const acc = new THREE.Vector3();
  const rig = {
    core,
    swing: (m) => (fp ? core.swing(m) : nk.swing(m, {})),
    hit: (kind) => core.hit(kind, 0.2, 0.1, 1, 1.1),
    draw: () => core.draw(),
    holster: () => core.holster(),
    flourish: () => core.flourish(),
    frame(dt, wind, s) {
      _q.setFromEuler(_e.set(s.pitch || 0, s.yaw || 0, 0, 'YXZ'));
      if (fp) {
        core.wind(wind);
        core.update(dt, { qW: _q, acc: s.acc ? acc.fromArray(s.acc) : null, stance: s.sprint ? 'carry' : s.crouch ? 'low' : 'guard', colliders: (c) => nk.colliders(c) });
        nk.meshes.place(core, handle0);
      } else {
        chest.quaternion.copy(_q);
        chest.updateMatrixWorld(true);
        nk.update(dt, { wind, sprint: !!s.sprint, speed: s.speed || 0, crouch: !!s.crouch }, chest);
      }
      core.events.length = 0;
    },
    place: () => nk.meshes.place(core, handle0),
    /** -> the points drawn this frame: [class, name, x, y, z]... flat into `to` (classes: 0 held/authored, 1 free). */
    points(to) {
      let n = 0;
      const put = (v) => {
        to[n++] = v.x;
        to[n++] = v.y;
        to[n++] = v.z;
      };
      for (const h of [core.right, core.left]) {
        put(h.p);
        put(h.wrist);
        put(h.elbow);
        put(_v.set(0.06, 0, 0).applyQuaternion(h.q).add(h.p));
        put(_v.set(0, 0.06, 0).applyQuaternion(h.q).add(h.p));
      }
      for (const m of [handle0, nk.meshes.handle]) {
        put(_v.set(0, 0, 0.1).applyQuaternion(m.quaternion).add(m.position)); // the butt
        put(_v.set(0, 0, -0.2).applyQuaternion(m.quaternion).add(m.position)); // the chain's end
        put(_v.set(0.03, 0, 0).applyQuaternion(m.quaternion).add(m.position)); // (its roll)
      }
      for (const m of nk.meshes.links) {
        put(m.position);
        put(_v.set(0.012, 0, 0).applyQuaternion(m.quaternion).add(m.position));
      }
      put(_v.copy(core.kick).multiplyScalar(0.5)); // (the view's jolt, as what it does to a point half a metre out)
      const b = core.bodyS || core.bodyK;
      put(_v.set(b[1] * 0.25, b[2] * 0.3, b[3] * 0.3));
      put(_v.set(b[4], b[5] * 0.3, 0));
      return n;
    },
  };
  return rig;
}
const NAMES = [];
for (const h of ['right', 'left']) for (const p of ['grip', 'wrist', 'elbow', 'fist turn x', 'fist turn y']) NAMES.push(`${h} ${p}`);
for (const h of ['handle 0', 'handle 1']) for (const p of ['butt', 'chain end', 'roll']) NAMES.push(`${h} ${p}`);
for (let i = 0; i < NK_GEOM.links; i++) NAMES.push(`link ${i}`, `link ${i} roll`);
NAMES.push('view jolt', 'body twist/lean/bend', 'body drop/step');
const N_HAND = 10, N_STICK = 6;

/** One run. -> { shake: { mm, at, t, cls }, shakeHeld, shakeFree, snap: { a, at, t }, jerkHeld, jerkFree, frames } */
export function measure(view, sc, rate, opts = {}) {
  const rig = makeRig(view, sc.idle), core = rig.core;
  const rnd = rng(12345);
  const dtOf = () => {
    if (rate !== 'uneven') return 1 / rate;
    const u = rnd();
    return u < 0.04 ? 0.05 + rnd() * 0.04 : 1 / (40 + rnd() * 160); // (now and then a hitch of 50 to 90 ms)
  };
  let t = -0.8, ei = 0;
  const P = [], T = [], H = [];
  const buf = new Float64Array(NAMES.length * 3);
  // What is measured is the motion the frames are samples of: the rig works a frame out in pieces of at most 1/120 s
  // (NunchakuCore.update), and the points are taken after every piece - so a run at 30 frames a second is looked at
  // 120 times a second like any other, and a fast swing seen four frames apart is not mistaken for a shake.
  let tt = t;
  const tick = core._tick.bind(core);
  const C = [];
  core._tick = (d, env) => {
    const cut = core._snap; // (the draw: the hands are put where it begins, below the view, while nothing is seen of them)
    tick(d, env);
    tt += d;
    if (opts.dbg) opts.dbg(tt, core);
    if (tt < -0.2) return;
    rig.place();
    rig.points(buf);
    P.push(Float64Array.from(buf));
    T.push(tt);
    C.push(cut);
    // which physical handle is held (0, 1; or both: 2) - the other is the simulation's
    H.push(core.who === 'o' && core.pinW >= 1 ? 2 : core.anchor);
  };
  while (t < sc.secs) {
    const dt = dtOf();
    while (ei < sc.events.length && sc.events[ei][0] <= t + 1e-9) sc.events[ei++][1](rig);
    rig.frame(dt, sc.wind(t), sc.state(t));
    t += dt;
    tt = t;
  }
  const res = { shakeHeld: 0, shakeFree: 0, popHeld: 0, popFree: 0, snap: 0, snapTip: 0, jerkHeld: 0, jerkFree: 0, frames: P.length, worst: null, worstSnap: null };
  const np = NAMES.length;
  const note = (kind, held, mm, p, i) => {
    const k = kind + (held ? 'Held' : 'Free');
    if (mm > res[k]) res[k] = mm;
    const over = mm / (held ? JITTER_LIMIT.held : JITTER_LIMIT.free);
    if (!res.worst || over > res.worst.over) res.worst = { over, mm, kind, at: NAMES[p], t: T[i], held, p, i };
  };
  const A = new Float64Array(P.length * 3), AM = new Float64Array(P.length), V = new Float64Array(P.length), OK = new Uint8Array(P.length), HELD = new Uint8Array(P.length);
  for (let p = 0; p < np; p++) {
    // each tick's step (V, mm) and each tick's acceleration (A, m/s^2); OK: not across a cut
    for (let i = 1; i < P.length; i++) V[i] = Math.hypot(P[i][p * 3] - P[i - 1][p * 3], P[i][p * 3 + 1] - P[i - 1][p * 3 + 1], P[i][p * 3 + 2] - P[i - 1][p * 3 + 2]) * 1000;
    for (let i = 1; i < P.length - 1; i++) {
      OK[i] = C[i - 1] || C[i] || C[i + 1] ? 0 : 1;
      const d0 = T[i] - T[i - 1], d1 = T[i + 1] - T[i], dm = (d0 + d1) / 2;
      let mag = 0;
      for (let c = 0; c < 3; c++) {
        const o = p * 3 + c;
        const acc = ((P[i + 1][o] - P[i][o]) / d1 - (P[i][o] - P[i - 1][o]) / d0) / dm;
        A[i * 3 + c] = acc;
        mag += acc * acc;
      }
      AM[i] = Math.sqrt(mag);
      // authored (the hands, the body, the view, a handle while a hand has it) or the simulation's
      let held = 1;
      if (p >= N_HAND && p < N_HAND + N_STICK) {
        const stick = p - N_HAND < 3 ? 0 : 1;
        held = H[i] === 2 || H[i] === stick ? 1 : 0;
        if (H[i] !== H[i - 1] || H[i] !== H[i + 1]) held = 0; // (the tick it changes hands: judged as the simulation's)
      } else if (p >= N_HAND + N_STICK && p < np - 3) held = 0;
      HELD[i] = held;
    }
    const opp = (i, j) => A[i * 3] * A[j * 3] + A[i * 3 + 1] * A[j * 3 + 1] + A[i * 3 + 2] * A[j * 3 + 2] < -0.5 * AM[i] * AM[j];
    for (let i = 2; i < P.length - 2; i++) {
      if (!OK[i] || !OK[i - 1] || !OK[i + 1]) continue;
      const held = !!HELD[i], dm = (T[i + 1] - T[i - 1]) / 2;
      const jerk = Math.hypot(A[i * 3] - A[i * 3 - 3], A[i * 3 + 1] - A[i * 3 - 2], A[i * 3 + 2] - A[i * 3 - 1]) / dm;
      if (held) res.jerkHeld = Math.max(res.jerkHeld, jerk);
      else res.jerkFree = Math.max(res.jerkFree, jerk);
      // a shake: there and back and there again - three accelerations in a row, each against the last
      // For the simulated half: four in a row (there, back, there, back) - a handle that is stopped by its chain and
      // snatched on by the hand, or knocked aside, has two or three and is not shaking - and beyond what its own
      // speed accounts for: a handle spinning a third of a turn between two looks has accelerations that oppose.
      // A point that is going nowhere has no such excuse.
      if (opp(i - 1, i) && opp(i, i + 1)) {
        if (held) note('shake', true, Math.min(AM[i - 1], AM[i], AM[i + 1]) * dm * dm * 1000, p, i);
        else if (i > 2 && OK[i - 2] && opp(i - 2, i - 1)) note('shake', false, Math.min(AM[i - 2], AM[i - 1], AM[i], AM[i + 1]) * dm * dm * 1000 - 1.5 * Math.min(V[i - 1], V[i], V[i + 1], V[i + 2]), p, i);
      }
      // a pop: one tick's step far longer than the steps either side of it (it was put there, it did not go there)
      const pop = V[i] - 2.5 * Math.max(V[i - 1], V[i + 1]);
      if (pop > 0) note('pop', held, pop, p, i);
      // a snap: the acceleration of a hand (its grip, wrist, elbow), and of the ends of a handle a hand has
      if (held && p < N_HAND + N_STICK) {
        const tip = p >= N_HAND || p % 5 >= 3;
        if (!tip && AM[i] > res.snap) {
          res.snap = AM[i];
          res.worstSnap = { a: AM[i], at: NAMES[p], t: T[i], p, i };
        }
        if (tip && AM[i] > res.snapTip) res.snapTip = AM[i];
      }
    }
  }
  if (opts.trace && res[opts.trace]) {
    const w = res[opts.trace], rows = [];
    for (let i = Math.max(0, w.i - 5); i <= Math.min(P.length - 1, w.i + 5); i++) rows.push(`    ${T[i].toFixed(4)}  ${[0, 1, 2].map((c) => (P[i][w.p * 3 + c] * 1000).toFixed(1).padStart(8)).join(' ')}  held ${H[i]}`);
    res.rows = rows;
  }
  return res;
}

/** Every scenario at every rate in a view. -> [{ name, view, rate, ...measure }] */
export function survey(views = ['fp', 'tp'], rates = JITTER_RATES, only = null) {
  const out = [];
  for (const view of views) {
    for (const sc of scenarios()) {
      if (only && !only.some((o) => sc.name === o || sc.name.startsWith(o))) continue;
      for (const rate of rates) out.push({ name: sc.name, view, rate, ...measure(view, sc, rate) });
    }
  }
  return out;
}
export const jitterBad = (r) => Math.max(r.shakeHeld, r.popHeld) > JITTER_LIMIT.held || Math.max(r.shakeFree, r.popFree) > JITTER_LIMIT.free || r.snap > JITTER_LIMIT.snap || r.snapTip > JITTER_LIMIT.snapTip;

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/clip/nunchaku-jitter.js')) {
  const arg = (k) => {
    const i = process.argv.indexOf('--' + k);
    return i < 0 ? null : process.argv[i + 1];
  };
  const views = (arg('view') || 'fp,tp').split(',');
  const rates = (arg('fps') || JITTER_RATES.join(',')).split(',').map((r) => (r === 'uneven' ? r : +r));
  const only = arg('only') ? arg('only').split(',') : null;
  const tr = arg('trace');
  if (tr) {
    const [name, rate] = tr.split('@');
    const sc = scenarios().find((s) => s.name === name);
    for (const view of views) {
      for (const kind of ['worst', 'worstSnap']) {
        const r = measure(view, sc, rate === 'uneven' ? rate : +rate, { trace: kind });
        const w = r[kind];
        if (!w) continue;
        console.log(`${view} ${name} @${rate}: ${kind === 'worst' ? `${w.kind} ${w.mm.toFixed(2)} mm` : `snap ${w.a.toFixed(0)} m/s^2`} on ${w.at} at ${w.t.toFixed(3)} s (mm, rig space):`);
        console.log(r.rows.join('\n'));
      }
    }
    process.exit(0);
  }
  const t0 = Date.now();
  const rows = survey(views, rates, only);
  const f = (x, n = 1) => x.toFixed(n).padStart(7);
  // per move (the scenarios grouped: every "a > b" pair under "pairs"), the worst over its runs at each rate
  const group = (n) => (/ > .*(\(late\))?$/.test(n) && !/wind|heavy|draw|stand|lunge$/.test(n) ? 'every move into every other (162 pairs)' : n);
  for (const view of views) {
    const byG = new Map();
    for (const r of rows) {
      if (r.view !== view) continue;
      const g = group(r.name);
      if (!byG.has(g)) byG.set(g, new Map());
      const m = byG.get(g), cur = m.get(r.rate);
      if (!cur) m.set(r.rate, { ...r });
      else for (const k of ['shakeHeld', 'shakeFree', 'popHeld', 'popFree', 'snap', 'snapTip', 'jerkHeld', 'jerkFree']) cur[k] = Math.max(cur[k], r[k]);
    }
    console.log(`\n${view === 'fp' ? 'first person' : 'third person'}: worst shake or pop of the hands and held handle (mm) / of the free handle and chain (mm) / hand acceleration (m/s^2) / jerk, held (km/s^3)`);
    console.log(`${'move'.padEnd(46)} ${rates.map((r) => String(r).padStart(28)).join('')}`);
    for (const [g, m] of byG) console.log(`${g.slice(0, 46).padEnd(46)} ${rates.map((r) => { const x = m.get(r); return `${f(Math.max(x.shakeHeld, x.popHeld), 1)}${f(Math.max(x.shakeFree, x.popFree), 1)}${f(x.snap, 0)}${f(x.jerkHeld / 1000, 0)}`.padStart(28); }).join('')}`);
  }
  const bad = rows.filter(jitterBad).sort((a, b) => (b.worst?.over || 0) - (a.worst?.over || 0));
  console.log(`\n${rows.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s; ${bad.length} over the marks (shake or pop ${JITTER_LIMIT.held} mm held, ${JITTER_LIMIT.free} mm free; a hand ${JITTER_LIMIT.snap} m/s^2, a held handle's ends ${JITTER_LIMIT.snapTip})`);
  for (const r of bad.slice(0, +(arg('worst') || 14))) console.log(`  ${r.view} ${r.name} @${r.rate}: shake ${r.shakeHeld.toFixed(1)} / ${r.shakeFree.toFixed(1)}, pop ${r.popHeld.toFixed(1)} / ${r.popFree.toFixed(1)} mm${r.worst ? ` (${r.worst.kind}: ${r.worst.at} at ${r.worst.t.toFixed(3)} s)` : ''}, snap ${r.snap.toFixed(0)}${r.worstSnap ? ` (${r.worstSnap.at} at ${r.worstSnap.t.toFixed(3)} s)` : ''}, tips ${r.snapTip.toFixed(0)}`);
  process.exit(bad.length ? 1 : 0);
}
