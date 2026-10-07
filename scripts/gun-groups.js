// Where a gun's rounds go: group sizes and time-to-kill for every firearm, out of the shared simulation itself
// (simulatePlayer's fire events and shotDirections, the two things the server and the client's prediction both run).
// No server, no browser. The numbers in a tuning PR's tables come from here, and scripts/test-spread.js pins them.
//
//   node scripts/gun-groups.js                     every gun, the group table and the time-to-kill table
//   node scripts/gun-groups.js --guns ak47,m4a1    only those (names as in ITEM, any case)
//   node scripts/gun-groups.js --tree ../stn-main  measure another checkout's shared/ (a "before")
//   node scripts/gun-groups.js --json out.json     and write everything measured
//   node scripts/gun-groups.js --md                the tables as markdown
//
// A group is measured on a wall square to the aim, D metres out: the first shot's cone (its diameter, which is what
// the crosshair shows), then strings of 5 rounds and a whole magazine with the trigger held (a semi-automatic is
// clicked as fast as it cycles) and the aim not corrected: the group's extreme spread (the two holes furthest apart)
// and how far its middle sits above the point of aim, the mean of TRIALS strings.
// Time to kill: a Walker standing D metres out, the aim on the middle of its chest and held there; the trigger held
// until it is dead, reloads and all. "steered" is the same with the climb pulled down as the view shows it.
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DISTANCES = [10, 25, 50, 100];
export const STANCES = [
  { key: 'aim', label: 'aimed, still', aim: true, move: false },
  { key: 'aimMove', label: 'aimed, walking', aim: true, move: true },
  { key: 'hip', label: 'hip, still', aim: false, move: false },
  { key: 'hipMove', label: 'hip, walking', aim: false, move: true },
];

// the shared simulation of a checkout
export async function loadTree(root = here) {
  const at = (f) => pathToFileURL(resolve(root, f)).href;
  const [sim, defs, consts, hitbox] = await Promise.all([import(at('shared/playersim.js')), import(at('shared/defs.js')), import(at('shared/constants.js')), import(at('shared/hitbox.js'))]);
  return { root, sim, defs, consts, hitbox };
}

const flat = { heightAt: () => 0, floorAt: () => 0, colliderGrids: [], structGrid: null };

// A survivor with `gun` in hand on open flat ground, and a step() that runs one command through simulatePlayer.
export function shooter(tree, gun, opts = {}) {
  const { sim, defs, consts } = tree;
  const def = defs.WEAPONS[gun];
  const s = sim.createPlayerState();
  const pri = def.slot === 0;
  s.weapons[pri ? consts.SLOT_PRIMARY : consts.SLOT_PISTOL] = gun;
  s.slot = pri ? consts.SLOT_PRIMARY : consts.SLOT_PISTOL;
  s.mags[pri ? 0 : 1] = def.mag;
  for (let i = 0; i < s.ammo.length; i++) s.ammo[i] = 0;
  s.ammo[def.ammo] = opts.reserve ?? 0;
  let seq = opts.seq ?? 1;
  let t = 0;
  const st = { s, def, t: 0, pitch: 0 };
  st.step = (buttons) => {
    const ev = [];
    sim.simulatePlayer(s, { seq: seq++, buttons, yaw: 0, pitch: st.pitch, slot: 255 }, flat, ev);
    seq &= 0xffff;
    t += consts.CMD_DT;
    st.t = t;
    for (const e of ev) e.t = t;
    return ev;
  };
  return st;
}

// The buttons of a stance: the sights up, walking (a strafe, as when circling a crowd), crouched.
export function stanceButtons(tree, st) {
  const { BTN } = tree.consts;
  return (st.aim ? BTN.ALT : 0) | (st.move ? BTN.RIGHT : 0) | (st.crouch ? BTN.CROUCH : 0);
}

// A string of `n` rounds fired as fast as the gun cycles: its fire events ({ t, spread, recoilPitch, seed, ... }).
// opts.tap: seconds the trigger is let go between rounds (tap fire); opts.steer: pull the climb down each round.
export function fireString(tree, gun, stance, n, opts = {}) {
  const { BTN } = tree.consts;
  const sh = shooter(tree, gun, opts);
  const hold = stanceButtons(tree, stance);
  for (let i = 0; i < 45; i++) sh.step(hold); // up to speed, sights up, the gun drawn
  const out = [];
  let click = true;
  let rest = 0;
  for (let i = 0; i < 4000 && out.length < n; i++) {
    let b = hold;
    if (rest > 0) rest -= tree.consts.CMD_DT;
    else if (sh.def.auto && !opts.tap) b |= BTN.ATTACK;
    else {
      if (click && sh.s.cooldown <= 0) b |= BTN.ATTACK;
      click = !(b & BTN.ATTACK);
    }
    if (opts.steer && tree.sim.shotClimb) sh.pitch = -tree.sim.shotClimb(sh.s, sh.def, !!stance.aim);
    for (const e of sh.step(b)) {
      if (e.type !== 'fire') continue;
      e.aimPitch = sh.pitch;
      out.push(e);
      if (opts.tap) rest = opts.tap;
    }
    if (sh.s.reloadT > 0 && !opts.reserve) break;
  }
  return out;
}

const _d = new Float32Array(3 * 16);
// where a fire event's pellets strike a wall D metres out, square to the aim: [x, y] in metres from the point of aim
export function strikes(tree, ev, D, pellets, out = []) {
  const n = tree.sim.shotDirections(0, ev.aimPitch || 0, ev.recoilPitch, ev.spread, pellets, ev.seed, _d);
  for (let i = 0; i < n; i++) {
    const f = -_d[i * 3 + 2];
    out.push([(-_d[i * 3] / f) * D, (_d[i * 3 + 1] / f) * D]);
  }
  return out;
}

// the two holes furthest apart, and the middle of the group
export function groupOf(pts) {
  let es = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    cx += pts[i][0];
    cy += pts[i][1];
    for (let j = i + 1; j < pts.length; j++) es = Math.max(es, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
  }
  return { es, cx: cx / pts.length, cy: cy / pts.length };
}

// One gun in one stance: the first shot's cone (rad), and for strings of 5 and a magazine the mean extreme spread
// and mean height of the group's middle, in mrad (multiply by the distance in metres for millimetres).
export function measureGroups(tree, gun, stance, trials = 60) {
  const def = tree.defs.WEAPONS[gun];
  const first = fireString(tree, gun, stance, 1)[0];
  const res = { first: first.spread, firstClimb: first.recoilPitch };
  for (const [key, n] of [
    ['burst', Math.min(5, def.mag)],
    ['mag', def.mag],
  ]) {
    let es = 0;
    let cy = 0;
    let last = 0;
    let cone = 0;
    for (let k = 0; k < trials; k++) {
      const evs = fireString(tree, gun, stance, n, { seq: 1 + k * 977, reserve: n > def.mag ? 99 : 0 });
      const pts = [];
      for (const e of evs) strikes(tree, e, 1000, 1, pts); // (one pellet a round: where the pattern's middle goes)
      const g = groupOf(pts);
      es += g.es;
      cy += g.cy;
      last += evs[evs.length - 1].recoilPitch * 1000;
      cone = evs[evs.length - 1].spread;
    }
    res[key] = { n, es: es / trials, cy: cy / trials, climb: last / trials, cone };
  }
  return res;
}

// A Walker D metres out, the aim on its chest: seconds until it is dead with the trigger held, the rounds it took,
// the share that struck, and the damage a second over that time. Mean of `trials`.
export function measureKill(tree, gun, stance, D, opts = {}) {
  const { defs, hitbox, consts } = tree;
  const def = defs.WEAPONS[gun];
  const zdef = defs.ZOMBIE_DEFS[defs.ZTYPE.WALKER];
  const hb = hitbox.zombieHitbox(zdef, 0, 0, false);
  const eye = consts.EYE_HEIGHT ?? 1.62;
  const aimY = zdef.height * 0.62;
  const pitch0 = Math.atan2(aimY - eye, D);
  const trials = opts.trials ?? 300;
  let time = 0;
  let shots = 0;
  let hits = 0;
  let kills = 0;
  const pos = { x: 0, y: 0, z: -D };
  for (let k = 0; k < trials; k++) {
    const evs = fireString(tree, gun, stance, 400, { seq: 3 + k * 613, reserve: 400, steer: opts.steer });
    let hp = zdef.hp;
    let t0 = -1;
    for (const e of evs) {
      if (t0 < 0) t0 = e.t;
      shots++;
      const n = tree.sim.shotDirections(0, pitch0 + (e.aimPitch || 0), e.recoilPitch, e.spread, def.pellets, e.seed, _d);
      let any = false;
      for (let i = 0; i < n; i++) {
        const t = hitbox.rayHitbox(pos, hb, 0, eye, 0, _d[i * 3], _d[i * 3 + 1], _d[i * 3 + 2], def.range);
        if (t < 0) continue;
        any = true;
        hp -= def.damage * (hitbox.headHit ? def.headMul : 1);
      }
      if (any) hits++;
      if (hp <= 0) {
        time += e.t - t0;
        kills++;
        break;
      }
    }
    if (hp > 0) time += 30; // (never: out of range, or every round over its head)
  }
  return { ttk: time / trials, shots: shots / trials, hit: hits / shots, killed: kills / trials };
}

export function gunList(tree, names) {
  const { ITEM, WEAPONS } = tree.defs;
  const all = Object.keys(WEAPONS)
    .map(Number)
    .filter((id) => !WEAPONS[id].melee && !WEAPONS[id].flame && !WEAPONS[id].rocket && !WEAPONS[id].skyflare);
  const name = (id) => Object.keys(ITEM).find((k) => ITEM[k] === id);
  const list = names ? all.filter((id) => names.includes(name(id).toLowerCase())) : all;
  return list.map((id) => ({ id, name: name(id) }));
}

export function measureAll(tree, names, opts = {}) {
  const out = {};
  for (const g of gunList(tree, names)) {
    const row = { id: g.id, def: tree.defs.WEAPONS[g.id], groups: {}, kill: {} };
    for (const st of STANCES) {
      row.groups[st.key] = measureGroups(tree, g.id, st, opts.trials ?? 60);
      row.kill[st.key] = {};
      for (const D of [10, 25, 50]) {
        row.kill[st.key][D] = measureKill(tree, g.id, st, D, { trials: opts.killTrials ?? 200 });
        if (tree.sim.shotClimb) row.kill[st.key][D].steered = measureKill(tree, g.id, st, D, { trials: opts.killTrials ?? 200, steer: true });
      }
    }
    out[g.name] = row;
  }
  return out;
}

const cm = (mrad, D) => ((mrad * D) / 10).toFixed(0).padStart(4);

export function printGroups(res, md) {
  const sep = md ? ' | ' : '  ';
  const line = (cells) => console.log(md ? `| ${cells.join(' | ')} |` : cells.join(sep));
  console.log('\nGroup sizes in cm at 10 / 25 / 50 / 100 m. First shot: the cone\'s diameter. Burst (5) and magazine: the two holes');
  console.log('furthest apart, trigger held, aim not corrected; "+" is how far the group\'s middle sits above the point of aim.\n');
  line(['gun'.padEnd(14), 'stance'.padEnd(14), 'first shot'.padEnd(19), '5-round burst'.padEnd(19), 'rise'.padEnd(19), 'magazine'.padEnd(19), 'rise'.padEnd(19)]);
  if (md) line(['---', '---', '---', '---', '---', '---', '---']);
  for (const [name, row] of Object.entries(res)) {
    for (const st of STANCES) {
      const g = row.groups[st.key];
      const at = (mrad) => DISTANCES.map((D) => cm(mrad, D)).join(' ');
      line([name.padEnd(14), st.label.padEnd(14), at(g.first * 2000), at(g.burst.es), at(g.burst.cy), at(g.mag.es), at(g.mag.cy)]);
    }
  }
}

export function printKill(res, md) {
  const sep = md ? ' | ' : '  ';
  const line = (cells) => console.log(md ? `| ${cells.join(' | ')} |` : cells.join(sep));
  console.log('\nA Walker (110 hp), aim held on its chest, trigger held: seconds to kill (share of rounds that struck) at 10 / 25 / 50 m.');
  console.log('30.0 = it was not killed. "steered": the climb pulled down as the view shows it.\n');
  line(['gun'.padEnd(14), 'stance'.padEnd(14), '10 m'.padEnd(12), '25 m'.padEnd(12), '50 m'.padEnd(12), 'steered 10 / 25 / 50'.padEnd(22)]);
  if (md) line(['---', '---', '---', '---', '---', '---']);
  for (const [name, row] of Object.entries(res)) {
    for (const st of STANCES) {
      const k = row.kill[st.key];
      const c = (D) => `${k[D].ttk.toFixed(2).padStart(5)} (${Math.round(k[D].hit * 100)}%)`.padEnd(12);
      const sd = [10, 25, 50].map((D) => (k[D].steered ? k[D].steered.ttk.toFixed(2).padStart(5) : '    -')).join(' ');
      line([name.padEnd(14), st.label.padEnd(14), c(10), c(25), c(50), sd.padEnd(22)]);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  const tree = await loadTree(opt('--tree') ? resolve(opt('--tree')) : here);
  const names = opt('--guns') ? opt('--guns').toLowerCase().split(',') : null;
  const res = measureAll(tree, names, { trials: +(opt('--trials') || 60), killTrials: +(opt('--kill-trials') || 200) });
  printGroups(res, a.includes('--md'));
  printKill(res, a.includes('--md'));
  if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(res, null, 1));
}
