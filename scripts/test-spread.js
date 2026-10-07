// Where a gun's rounds go (shared/playersim.js shotSpread / shotClimb, client/game/aimview.js). No browser.
//   - the rule, for every gun: the sights tighten the cone, moving opens it, crouching tightens it; a burst's first
//     rounds are nearly as tight as its first and the cone then opens to a limit; the climb starts at nothing, grows
//     for CLIMB_FULL rounds and stays there, halved behind the sights; the heat is capped, so the gun is settled
//     again HEAT_MAX / HEAT_COOL s after the trigger is let go however long it was held
//   - the AK-47, in centimetres on a wall: its first aimed round, an aimed burst of five, an aimed magazine, the hip
//     and the hip on the move, each within stated bounds and in that order; and against its rivals - it hits harder
//     than the M4A1 and is the less accurate of the two in every stance, and it kills a Walker 25 m out as fast as
//     it does at 10 m when aimed
//   - the server and the client's prediction agree: the same commands through a real Game and through
//     simulatePlayer give Combat.fire the very rounds (seed, cone, climb) the prediction drew
//   - the view agrees with the rounds: lifted by Game's own stepping (aimview.js) through a magazine at 60 and at
//     30 frames a second, the view is on each round's climb as it is fired, the last round's punch is over by then,
//     and it is back down once the gun has settled; the crosshair's ticks stand on the edge of the cone
// usage: node scripts/test-spread.js
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, dqangle16, dqpitch, writeInput } from '../shared/protocol.js';
import { BTN, CMD_DT, SLOT_PRIMARY } from '../shared/constants.js';
import { ITEM, WEAPONS, AMMO } from '../shared/defs.js';
import { createPlayerState, copyPlayerState, simulatePlayer, hashPlayerState, shotSpread, shotClimb, shotDirections, HEAT_MAX, HEAT_COOL, CLIMB_FULL, AIM_CLIMB } from '../shared/playersim.js';
import { stepClimb, punchOf, punchAt, crosshairGap, CROSSHAIR_MIN } from '../client/game/aimview.js';
import { loadTree, gunList, fireString, shooter, stanceButtons, measureGroups, measureKill, STANCES } from './gun-groups.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const tree = await loadTree();
const guns = gunList(tree);
const AIM = STANCES.find((s) => s.key === 'aim'), AIM_MOVE = STANCES.find((s) => s.key === 'aimMove'), HIP = STANCES.find((s) => s.key === 'hip'), HIP_MOVE = STANCES.find((s) => s.key === 'hipMove');
const cm = (rad, D) => rad * D * 100;

// ---------------------------------------------------------------- the rule, every gun
{
  const bad = [];
  for (const g of guns) {
    const first = (st) => fireString(tree, g.id, st, 1)[0].spread;
    const a = first(AIM), am = first(AIM_MOVE), h = first(HIP), hm = first(HIP_MOVE);
    const hc = first({ ...HIP, crouch: true });
    if (!(a < h && h < hm && a < am && am < hm)) bad.push(`${g.name}: aimed ${a.toFixed(4)} / aimed walking ${am.toFixed(4)} / hip ${h.toFixed(4)} / hip walking ${hm.toFixed(4)}`);
    if (!(hc < h)) bad.push(`${g.name}: crouched ${hc.toFixed(4)} is no tighter than standing ${h.toFixed(4)}`);
    if (fireString(tree, g.id, HIP, 1)[0].recoilPitch !== 0) bad.push(`${g.name}: its first round climbs`);
  }
  check('every gun: aimed is tighter than the hip, the hip than the hip on the move, and a crouch tightens it; a first round does not climb', !bad.length, bad.length ? bad.join('; ') : `${guns.length} guns`);
}
{
  // the automatics, a magazine with the trigger held
  const bad = [];
  let said = '';
  for (const g of guns.filter((x) => WEAPONS[x.id].auto)) {
    const def = WEAPONS[g.id];
    for (const st of [AIM, HIP]) {
      const evs = fireString(tree, g.id, st, def.mag);
      const sp = evs.map((e) => e.spread), cl = evs.map((e) => e.recoilPitch);
      const rising = (a, n) => a.slice(1, n).every((v, i) => v > a[i]);
      if (!rising(sp, HEAT_MAX + 1)) bad.push(`${g.name} ${st.key}: the cone does not open round by round`);
      if (sp[2] > sp[0] * 1.3) bad.push(`${g.name} ${st.key}: the third round's cone is ${(sp[2] / sp[0]).toFixed(2)} x the first's`);
      if (!(sp[HEAT_MAX] > sp[0] * 2.5) || sp[def.mag - 1] !== sp[HEAT_MAX]) bad.push(`${g.name} ${st.key}: the cone ends ${(sp[def.mag - 1] / sp[0]).toFixed(2)} x the first's, ${(sp[HEAT_MAX] / sp[0]).toFixed(2)} x after ${HEAT_MAX}`);
      if (!rising(cl, CLIMB_FULL + 1) || cl[def.mag - 1] !== cl[CLIMB_FULL]) bad.push(`${g.name} ${st.key}: the climb does not grow for ${CLIMB_FULL} rounds and stay`);
      if (cl[2] > cl[CLIMB_FULL] * 0.2) bad.push(`${g.name} ${st.key}: the third round is already ${(cl[2] / cl[CLIMB_FULL]).toFixed(2)} of the full climb`);
      if (st === AIM) said += `${g.name} ${(cl[CLIMB_FULL] * 1000).toFixed(1)} mrad aimed, `;
    }
    const full = (st) => fireString(tree, g.id, st, def.mag)[def.mag - 1].recoilPitch;
    if (Math.abs(full(AIM) / full(HIP) - AIM_CLIMB) > 1e-9) bad.push(`${g.name}: the aimed climb is ${(full(AIM) / full(HIP)).toFixed(2)} of the hip's`);
  }
  check('an automatic: the first rounds of a burst are tight, the cone then opens to a limit; the climb grows and stays, halved behind the sights', !bad.length, bad.length ? bad.join('; ') : said.slice(0, -2));
}
{
  // let go after a whole magazine: the gun is itself again in just over a second (the heat is capped)
  const sh = shooter(tree, ITEM.AK47, { reserve: 0 });
  const def = WEAPONS[ITEM.AK47];
  let n = 0;
  for (let i = 0; i < 600 && n < def.mag - 1; i++) for (const e of sh.step(BTN.ATTACK)) if (e.type === 'fire') n++;
  const hot = sh.s.recoil;
  const settle = HEAT_MAX / HEAT_COOL;
  for (let i = 0; i < Math.round((settle * 0.5) / CMD_DT); i++) sh.step(0);
  const half = shotSpread(sh.s, def, false);
  for (let i = 0; i < Math.round((settle * 0.5 + 0.1) / CMD_DT); i++) sh.step(0);
  check('the heat is capped: a magazine emptied, the gun is settled again in just over a second', hot === HEAT_MAX && half > def.spread && half < def.spread * 2.5 && sh.s.recoil === 0 && shotSpread(sh.s, def, false) === def.spread && shotClimb(sh.s, def, false) === 0, `heat ${hot} after ${n} rounds, cone x${(half / def.spread).toFixed(2)} at ${(settle * 0.5).toFixed(2)} s, settled by ${(settle + 0.1).toFixed(2)} s`);
}

// ---------------------------------------------------------------- the AK-47, on the wall
{
  const g = {};
  for (const st of STANCES) g[st.key] = measureGroups(tree, ITEM.AK47, st, 80);
  const m4 = {};
  for (const st of STANCES) m4[st.key] = measureGroups(tree, ITEM.M4A1, st, 80);
  const first = (k, D) => cm(g[k].first * 2, D);
  const es = (k, which, D) => (g[k][which].es * D) / 10;
  check('AK-47, aimed: the first round within 30 cm at 25 m (a head) and 1.2 m at 100 m', first('aim', 25) <= 30 && first('aim', 100) <= 120, `${first('aim', 25).toFixed(0)} cm, ${first('aim', 100).toFixed(0)} cm`);
  check('AK-47, aimed: a burst of five within 45 cm at 25 m, its middle no more than 15 cm high', es('aim', 'burst', 25) <= 45 && (g.aim.burst.cy * 25) / 10 <= 15, `${es('aim', 'burst', 25).toFixed(0)} cm across, ${((g.aim.burst.cy * 25) / 10).toFixed(0)} cm high`);
  check('AK-47, aimed: a held magazine opens up and climbs - 0.8 to 1.6 m across at 25 m, its middle 35 to 80 cm high', es('aim', 'mag', 25) >= 80 && es('aim', 'mag', 25) <= 160 && (g.aim.mag.cy * 25) / 10 >= 35 && (g.aim.mag.cy * 25) / 10 <= 80, `${es('aim', 'mag', 25).toFixed(0)} cm across, ${((g.aim.mag.cy * 25) / 10).toFixed(0)} cm high`);
  check('AK-47, from the hip: the first round 2.5 to 4 x as wide as aimed, a magazine at least twice as wide as aimed', first('hip', 25) >= first('aim', 25) * 2.5 && first('hip', 25) <= first('aim', 25) * 4 && es('hip', 'mag', 25) >= es('aim', 'mag', 25) * 2, `${first('hip', 25).toFixed(0)} cm against ${first('aim', 25).toFixed(0)} cm; ${es('hip', 'mag', 25).toFixed(0)} against ${es('aim', 'mag', 25).toFixed(0)} cm`);
  check('AK-47, on the move: the hip opens 1.8 to 3.5 x, the sights open too and stay tighter than the hip standing still', first('hipMove', 25) >= first('hip', 25) * 1.8 && first('hipMove', 25) <= first('hip', 25) * 3.5 && first('aimMove', 25) > first('aim', 25) && first('aimMove', 25) < first('hip', 25), `hip ${first('hip', 25).toFixed(0)} -> ${first('hipMove', 25).toFixed(0)} cm, aimed ${first('aim', 25).toFixed(0)} -> ${first('aimMove', 25).toFixed(0)} cm`);
  const worse = STANCES.every((st) => g[st.key].first > m4[st.key].first && g[st.key].mag.es > m4[st.key].mag.es && g[st.key].mag.climb > m4[st.key].mag.climb);
  check('AK-47 against the M4A1: hits harder, and is the less accurate and the harder kicking of the two in every stance', WEAPONS[ITEM.AK47].damage > WEAPONS[ITEM.M4A1].damage && worse, STANCES.map((st) => `${st.key} ${(g[st.key].first * 1000).toFixed(1)} / ${(m4[st.key].first * 1000).toFixed(1)} mrad`).join(', '));
  const k10 = measureKill(tree, ITEM.AK47, AIM, 10, { trials: 200 }), k25 = measureKill(tree, ITEM.AK47, AIM, 25, { trials: 200 }), k50 = measureKill(tree, ITEM.AK47, AIM, 50, { trials: 200, steer: true });
  const h10 = measureKill(tree, ITEM.AK47, HIP, 10, { trials: 200 }), h25 = measureKill(tree, ITEM.AK47, HIP, 25, { trials: 200 }), hm10 = measureKill(tree, ITEM.AK47, HIP_MOVE, 10, { trials: 200 });
  check('AK-47, aimed at a Walker\'s chest and held: dead in under 0.5 s at 10 and at 25 m with 9 rounds in 10 striking, and at 50 m with the climb pulled down', k10.ttk < 0.5 && k25.ttk < 0.5 && k25.hit >= 0.9 && k50.ttk < 0.6, `${k10.ttk.toFixed(2)} s, ${k25.ttk.toFixed(2)} s (${Math.round(k25.hit * 100)}%), ${k50.ttk.toFixed(2)} s`);
  check('AK-47, from the hip: as good at 10 m standing, most rounds still striking at 10 m on the move, and a waste of rounds at 25 m', h10.ttk < 0.5 && hm10.hit >= 0.55 && hm10.hit < k10.hit && h25.hit < 0.5, `10 m ${h10.ttk.toFixed(2)} s; on the move ${Math.round(hm10.hit * 100)}% strike; 25 m ${Math.round(h25.hit * 100)}% strike`);
}

// ---------------------------------------------------------------- the server and the prediction
{
  const game = new Game({ seed: 1, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  const conn = {
    id: 0,
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) conn.id = r.u16();
    },
  };
  const session = game.onOpen(conn);
  {
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str('Alice');
    game.onMessage(session, w.bytes().slice());
  }
  const p = game.players.get(conn.id);
  const clear = () => {
    for (const z of [...game.zombies]) {
      game._listRemove(game.zombies, z);
      game.removeEntity(z);
    }
  };
  clear();
  for (let i = 0; i < 5; i++) game.update();
  const s = p.state;
  s.weapons[SLOT_PRIMARY] = ITEM.AK47;
  s.slot = SLOT_PRIMARY;
  s.mags[0] = WEAPONS[ITEM.AK47].mag;
  s.ammo[AMMO.R762 ?? WEAPONS[ITEM.AK47].ammo] = 90;
  s.switchT = 0;
  s.recoil = 0;
  // what Combat.fire is handed
  const served = [];
  const fire = game.combat.fire.bind(game.combat);
  game.combat.fire = (pl, ev) => {
    served.push({ seed: ev.seed, spread: ev.spread, recoilPitch: ev.recoilPitch, aiming: ev.aiming });
    return fire(pl, ev);
  };
  // the prediction: the same state (as the server sends it: a state it has changed goes out rounded to what the wire
  // carries, and both go on from that), the same commands
  game.update();
  game.update();
  const mine = createPlayerState();
  copyPlayerState(mine, s);
  const drawn = [];
  let seq = 100;
  const yaw = 0.7, pitch = -0.05;
  const tick = (buttons) => {
    const w = new Writer(64);
    w.u8(C2S.INPUT);
    w.u16(game.tick & 0xffff);
    w.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      seq = (seq + 1) & 0xffff;
      cmds.push({ seq, buttons, qyaw: qangle16(yaw), qpitch: qpitch(pitch), slot: 255 });
      const ev = [];
      simulatePlayer(mine, { seq, buttons, yaw: dqangle16(qangle16(yaw)), pitch: dqpitch(qpitch(pitch)), slot: 255 }, game.world, ev);
      for (const e of ev) if (e.type === 'fire') drawn.push({ seed: e.seed, spread: e.spread, recoilPitch: e.recoilPitch, aiming: e.aiming });
    }
    writeInput(w, cmds, hashPlayerState(mine)); // (with the prediction's fingerprint, as a client sends it: the server only sends its state when the two disagree)
    game.onMessage(session, w.bytes().slice());
    clear();
    game.update();
  };
  const run = (n, b) => {
    for (let i = 0; i < n; i++) tick(b);
  };
  run(10, 0);
  run(24, BTN.ATTACK | BTN.ALT); // an aimed burst of a dozen
  run(4, BTN.ALT); // half settled
  run(16, BTN.ATTACK | BTN.RIGHT); // from the hip, strafing
  run(30, BTN.RIGHT); // settled
  run(6, BTN.ATTACK | BTN.ALT | BTN.CROUCH); // crouched behind the sights
  run(6, 0);
  const same = served.length === drawn.length && served.every((e, i) => e.seed === drawn[i].seed && e.spread === drawn[i].spread && e.recoilPitch === drawn[i].recoilPitch && e.aiming === drawn[i].aiming);
  const d1 = new Float32Array(3), d2 = new Float32Array(3);
  const dirs = served.every((e, i) => {
    shotDirections(yaw, pitch, e.recoilPitch, e.spread, 1, e.seed, d1);
    shotDirections(yaw, pitch, drawn[i]?.recoilPitch, drawn[i]?.spread, 1, drawn[i]?.seed, d2);
    return d1[0] === d2[0] && d1[1] === d2[1] && d1[2] === d2[2];
  });
  check('the server and the prediction: the same commands give Combat.fire the rounds the prediction drew - seed, cone, climb and where each goes', served.length >= 20 && same && dirs && hashPlayerState(mine) === hashPlayerState(s), `${served.length} rounds on the server, ${drawn.length} predicted; state hash ${hashPlayerState(s)} / ${hashPlayerState(mine)}` + (same ? '' : ' first off: ' + JSON.stringify(served.map((e, i) => [e, drawn[i]]).find(([a, b]) => !b || a.seed !== b.seed || a.spread !== b.spread || a.recoilPitch !== b.recoilPitch || a.aiming !== b.aiming))));
  const kinds = new Set(served.map((e) => `${e.aiming ? 'aimed' : 'hip'}`));
  check('...aimed and from the hip, with cones from the tightest to the hip on the move', kinds.size === 2 && Math.max(...served.map((e) => e.spread)) > Math.min(...served.map((e) => e.spread)) * 6, `${(Math.min(...served.map((e) => e.spread)) * 1000).toFixed(1)} to ${(Math.max(...served.map((e) => e.spread)) * 1000).toFixed(1)} mrad`);
}

// ---------------------------------------------------------------- the view
{
  // A magazine with the trigger held, the frames stepped as Game steps them: the commands of a frame, then the view.
  // err: how far the view (the climb as eased, and what is left of the last round's punch) is from where each round
  // went, as it was fired
  const through = (gun, stance, fps) => {
    const def = WEAPONS[gun];
    const sh = shooter(tree, gun, { reserve: 0 });
    const hold = stanceButtons(tree, stance);
    for (let i = 0; i < 40; i++) sh.step(hold);
    const dt = 1 / fps;
    let acc = 0, view = 0, punch = 0, punchT = 9, punchLen = 0.1, err = 0, punchLeft = 0, rounds = 0, top = 0;
    const frame = (buttons) => {
      acc += dt;
      while (acc >= CMD_DT - 1e-9) {
        acc -= CMD_DT;
        for (const e of sh.step(buttons)) {
          if (e.type !== 'fire') continue;
          // (the view of the frame before is what the player fired on)
          const left = punch * punchAt(punchT / punchLen);
          if (rounds) {
            err = Math.max(err, Math.abs(view + left - e.recoilPitch));
            punchLeft = Math.max(punchLeft, left);
          }
          rounds++;
          const pu = punchOf(def, !!stance.aim);
          punch = pu.amp;
          punchLen = pu.len;
          punchT = 0;
        }
      }
      view = stepClimb(view, shotClimb(sh.s, def, !!stance.aim), dt);
      punchT += dt;
      top = Math.max(top, view);
    };
    for (let i = 0; i < fps * 6 && rounds < def.mag; i++) frame(hold | BTN.ATTACK);
    const full = shotClimb(sh.s, def, !!stance.aim);
    for (let i = 0; i < fps * (HEAT_MAX / HEAT_COOL + 0.6); i++) frame(hold);
    return { err, punchLeft, top, full, rest: view, rounds };
  };
  const bad = [];
  let worst = 0;
  for (const g of guns.filter((x) => WEAPONS[x.id].auto)) {
    for (const st of [AIM, HIP]) {
      for (const fps of [60, 30, 144]) {
        const r = through(g.id, st, fps);
        const step = r.full / CLIMB_FULL; // a round's share of the climb
        worst = Math.max(worst, r.err / r.full);
        // at 30 frames a second a round can go in the same frame as the one before it: the view is a frame behind
        const tol = fps >= 60 ? Math.max(step * 0.6, r.full * 0.06) : step * 2.2;
        if (r.err > tol) bad.push(`${g.name} ${st.key} at ${fps} fps: the view is ${(r.err * 1000).toFixed(2)} mrad off a round (the full climb is ${(r.full * 1000).toFixed(1)})`);
        if (fps >= 60 && r.punchLeft > 1e-9) bad.push(`${g.name} ${st.key} at ${fps} fps: ${(r.punchLeft * 1000).toFixed(2)} mrad of punch left as the next round goes`);
        if (Math.abs(r.top - r.full) > r.full * 0.02 || r.rest > r.full * 0.01) bad.push(`${g.name} ${st.key} at ${fps} fps: the view tops out at ${(r.top * 1000).toFixed(1)} of ${(r.full * 1000).toFixed(1)} mrad and rests at ${(r.rest * 1000).toFixed(2)}`);
      }
    }
  }
  check('the view goes where the rounds go: through a held magazine it is on each round\'s climb as it is fired, the punch over by then, and back down once the gun has settled', !bad.length, bad.length ? bad.slice(0, 5).join('; ') : `the worst a round was off: ${(worst * 100).toFixed(1)}% of the gun's full climb`);
}
{
  // every punch is over before the gun can fire again; one round at a time keeps the kick it always had
  const bad = [];
  for (const g of guns) {
    const def = WEAPONS[g.id];
    const pu = punchOf(def, false), pa = punchOf(def, true);
    if (pu.len >= def.rate || punchAt(def.rate / pu.len) !== 0 || punchAt(0.5) <= 0 || punchAt(0.5) > 1) bad.push(`${g.name}: its punch lasts ${pu.len} s of a ${def.rate} s cycle`);
    if (!def.auto && Math.abs(pu.amp - def.recoil * 1.4) > 1e-12) bad.push(`${g.name}: a punch of ${pu.amp}`);
    if (Math.abs(pa.amp - pu.amp * 0.5) > 1e-12) bad.push(`${g.name}: the aimed punch is not half`);
  }
  check('a round\'s punch is over before the gun can fire again, and halved behind the sights', !bad.length, bad.join('; '));
}
{
  // a point on the edge of the cone, through a camera `fov` degrees high, lands on the tick
  const bad = [];
  for (const fov of [58.5, 75, 100]) {
    for (const ang of [0.004, 0.018, 0.044, 0.12]) {
      const H = 1080;
      const f = H / 2 / Math.tan((fov * Math.PI) / 360); // px to the image plane
      const px = f * Math.tan(ang);
      const gap = crosshairGap(ang, fov, H);
      if (Math.abs(gap - Math.max(CROSSHAIR_MIN, px)) > 1e-6) bad.push(`${ang} rad at ${fov}: ${gap} px, the cone's edge is at ${px}`);
    }
  }
  const s = createPlayerState();
  const def = WEAPONS[ITEM.AK47];
  const still = crosshairGap(shotSpread(s, def, false), 75, 1080);
  s.vx = 4.6;
  const moving = crosshairGap(shotSpread(s, def, false), 75, 1080);
  s.vx = 0;
  s.recoil = HEAT_MAX;
  const hot = crosshairGap(shotSpread(s, def, false), 75, 1080);
  check('the crosshair\'s ticks stand on the edge of the cone, and open with a walk and with a burst', !bad.length && moving > still * 1.8 && hot > still * 2.5, bad.length ? bad.join('; ') : `AK-47 at 1080p: ${still.toFixed(0)} px still, ${moving.toFixed(0)} walking, ${hot.toFixed(0)} after a long burst`);
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
