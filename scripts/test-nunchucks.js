// Nunchucks (ITEM.NUNCHAKU): the item and where it comes from; its moveset in the shared simulation (shared/nunchaku.js,
// playersim.js) - the light chain's order, when each blow lands, the window that continues a combo and what ends it,
// the openers, the heavy attack's wind-up and its tiers, what it all costs in stamina; what each blow does on the
// server (Combat.melee: reach, damage, how many it strikes, the shove); a client predicting it over a laggy link and
// the server agreeing command for command; the simulated chain (ChainSim: stable, never stretched, never through a
// hand, the same at any frame rate); and the moves' animation in both views run headless (nothing torn, every move
// back in the guard).
// usage: node scripts/test-nunchucks.js [seed]
import * as THREE from 'three';
import { Game } from '../server/game.js';
import { C2S, S2C, SNAP, PROTOCOL_VERSION, PFLAG, Writer, Reader } from '../shared/protocol.js';
import { BTN, CMD_DT, SERVER_TICK_RATE, SLOT_MELEE, SLOT_PISTOL, STAMINA_MAX, STAMINA_REGEN_DELAY } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, WEAPONS, RECIPES, SALVAGE, LOOT_TABLES, CONT_TABLES, ZONE, ZTYPE, ZOMBIE_DEFS } from '../shared/defs.js';
import { createPlayerState, copyPlayerState, samePlayerState, simulatePlayer, hashPlayerState } from '../shared/playersim.js';
import { groundAt } from '../shared/collision.js';
import { createWorld } from '../shared/world.js';
import { NK, NK_MOVE, NK_MOVES, NK_GEOM, NK_CHAIN, NK_SIM, NK_COL, ChainSim, heavyMove, nkMove, nkWind } from '../shared/nunchaku.js';
import { readHeader, readGlobal, readSelf, readEntities, readEvents } from '../client/net/decode.js';
import { Connection } from '../client/net/connection.js';
import { Prediction } from '../client/game/prediction.js';
import { playerFlags } from '../server/snapshot.js';
import { NunchakuCore, FP, tpBody } from '../client/render/models/nunchaku.js';
import { survey as jitterSurvey, jitterBad, JITTER_LIMIT } from './clip/nunchaku-jitter.js';

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const DEF = WEAPONS[ITEM.NUNCHAKU];
const M = NK_MOVE;
const near = (a, b, tol = CMD_DT * 1.01) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- the item
{
  check('the item: id 57, a melee weapon in the melee slot, with a moveset', ITEM.NUNCHAKU === 57 && ITEM_DEFS[57]?.cat === 'weapon' && ITEM_DEFS[57].stack === 1 && DEF.melee && DEF.nunchaku && DEF.slot === SLOT_MELEE);
  check('no id was renumbered for it', ITEM.MACHETE === 53 && ITEM.HAMMER === 54 && ITEM.PISTOL === 55 && ITEM.FLARE_GUN === 56 && ITEM.SHOTGUN === 60 && ITEM.AMMO_9MM === 70 && ITEM.ENERGY_DRINK === 28);
  // (they came in at 41 and needed no bump of their own; later features bump it: 42 was Dead Hand's)
  check('the protocol version is as it was', PROTOCOL_VERSION >= 41, `${PROTOCOL_VERSION}`);
  const rec = RECIPES.find((r) => r.out === ITEM.NUNCHAKU);
  check('made at the workbench from planks, scrap and tape: its id its place in the list (the recipes of the vehicles come after it)', !!rec && rec.station === 'bench' && !rec.schem && rec === RECIPES[40] && RECIPES.every((r, i) => r.id === i) && rec.id === 40 && Object.keys(rec.cost).every((it) => ITEM_DEFS[it]?.cat === 'res'), JSON.stringify(rec?.cost));
  const sal = SALVAGE[ITEM.NUNCHAKU];
  check('...and it comes apart into less than it took', !!sal && Object.entries(sal).every(([it, n]) => rec.cost[it] && n <= rec.cost[it] / 2 + 0.5) && Object.keys(sal).length < Object.keys(rec.cost).length);
  const where = Object.entries(LOOT_TABLES).filter(([, t]) => t.some((r) => r[0] === ITEM.NUNCHAKU)).map(([z]) => +z);
  const rows = [...where.map((z) => LOOT_TABLES[z]), CONT_TABLES.duffel].map((t) => t.find((r) => r[0] === ITEM.NUNCHAKU));
  check('found, rarely, where one would be: the summer camp, the school, a duffel bag', where.includes(ZONE.SUMMERCAMP) && where.includes(ZONE.SCHOOL) && rows.every((r) => r && r[1] === 1 && r[2] === 1 && r[3] === 1) && where.length <= 3, `zones ${where.join(',')}`);
  // the numbers against the other melee weapons (the comment on its row in defs.js says these)
  const light = [M.WHIP, M.BACKHAND, M.EIGHT, M.SMASH].map((m) => NK_MOVES[m]);
  const dmg = light.reduce((n, m) => n + m.damage * m.hits.length, 0), time = light.reduce((n, m) => n + m.rate, 0), cost = light.reduce((n, m) => n + m.stamina, 0);
  const dps = (w) => w.damage / w.rate;
  const combo = dmg / time;
  check('the light chain on one target: over the knife and the bat, under the machete and the spiked bat', combo > dps(WEAPONS[ITEM.KNIFE]) && combo > dps(WEAPONS[ITEM.BAT]) && combo < dps(WEAPONS[ITEM.MACHETE]) && combo < dps(WEAPONS[ITEM.SPIKED_BAT]), `${dmg} in ${time.toFixed(2)} s: ${combo.toFixed(0)}/s (knife ${dps(WEAPONS[ITEM.KNIFE]).toFixed(0)}, bat ${dps(WEAPONS[ITEM.BAT]).toFixed(0)}, machete ${dps(WEAPONS[ITEM.MACHETE]).toFixed(0)}, spiked bat ${dps(WEAPONS[ITEM.SPIKED_BAT]).toFixed(0)})`);
  check('...its last blow the hardest by far, and each move no weaker than the one before', light[3].damage > 2 * Math.max(light[0].damage, light[1].damage, light[2].damage * 2 * 0.99) * 0.9 && light[1].damage >= light[0].damage && light[2].damage * 2 >= light[1].damage);
  check('...the shortest reach of the melee weapons, one target a move', [ITEM.KNIFE, ITEM.BAT, ITEM.SPIKED_BAT, ITEM.MACHETE].every((id) => WEAPONS[id].range > DEF.range) && light.every((m) => m.targets === 1));
  check('...and it costs stamina: fewer than four combos empty a full bar', cost >= 20 && STAMINA_MAX / cost < 4, `${cost} a combo`);
  const tiers = [M.HEAVY1, M.HEAVY2, M.HEAVY3].map((m) => NK_MOVES[m]);
  const heavyDps = tiers.map((m, i) => m.damage / ((i ? NK.tiers[i - 1] : 0.05) + m.rate));
  check('the heavy attack: harder the longer it is wound, and never more damage a second than the light chain', tiers[0].damage < tiers[1].damage && tiers[1].damage < tiers[2].damage && heavyDps.every((d) => d < combo) && tiers[2].damage > light[3].damage, heavyDps.map((d) => d.toFixed(0)).join(' / ') + ' a second');
  check("the weapon's own row carries the opener's and the full heavy's numbers", DEF.damage === NK_MOVES[M.WHIP].damage && DEF.rate === NK_MOVES[M.WHIP].rate && DEF.altDamage === NK_MOVES[M.HEAVY3].damage && DEF.altRate === NK_MOVES[M.HEAVY3].rate);
  check('every move: its blows inside its own length, in order, and a move to go on to', NK_MOVES.every((m) => m.hits.length >= 1 && m.hits.every((h, i) => h > 0.05 && h < m.rate && (!i || h > m.hits[i - 1])) && NK_MOVES[m.next]));
}

// ---------------------------------------------------------------- the moveset in the shared simulation
const flat = { heightAt: () => 0, floorAt: () => 0, colliderGrids: [], structGrid: null };
function sim() {
  const s = createPlayerState();
  s.weapons[SLOT_MELEE] = ITEM.NUNCHAKU;
  s.slot = SLOT_MELEE;
  s.switchT = 0;
  const log = [];
  let seq = 0, t = 0;
  const run = (n, buttons = 0, slot = 255) => {
    for (let i = 0; i < n; i++) {
      const ev = [];
      simulatePlayer(s, { seq: seq++, buttons, yaw: 0, pitch: 0, slot }, flat, ev);
      slot = 255;
      for (const e of ev) log.push({ t, ...e });
      t += CMD_DT;
    }
  };
  const secs = (x) => Math.round(x / CMD_DT);
  return { s, log, run, secs, now: () => t, of: (type) => log.filter((e) => e.type === type) };
}
let simOk = true;
try {
  sim().run(2, BTN.ATTACK);
} catch (e) {
  simOk = false;
  console.log(e);
}
check('the shared simulation runs them', simOk);
if (simOk) {
  // the light chain, the button held
  {
    const x = sim();
    const light = [M.WHIP, M.BACKHAND, M.EIGHT, M.SMASH];
    const total = light.reduce((n, m) => n + NK_MOVES[m].rate, 0);
    x.run(x.secs(total) + 8, BTN.ATTACK);
    const sw = x.of('nk_swing').slice(0, 5), hits = x.of('melee');
    let at = 0, okT = true, okH = true, n = 0;
    light.forEach((m, i) => {
      okT = okT && sw[i]?.move === m && near(sw[i].t, at, CMD_DT * (i + 1.01)); // (each move may start a command late)
      NK_MOVES[m].hits.forEach((h, k) => {
        const e = hits[n++];
        okH = okH && e && e.move === m && e.hit === k && e.weapon === ITEM.NUNCHAKU && near(e.t - sw[i].t, h) && !e.heavy;
      });
      at += NK_MOVES[m].rate;
    });
    check('held, the light chain runs whip, backhand, figure-eight, smash, each as the last one ends', okT, sw.map((e) => `${NK_MOVES[e.move].name}@${e.t.toFixed(2)}`).join(' '));
    check("...each blow lands its move's time after the move began (the figure-eight lands twice)", okH && n === 5, hits.slice(0, 5).map((e) => `${NK_MOVES[e.move].name}#${e.hit}@${e.t.toFixed(2)}`).join(' '));
    check('...and after the smash the chain starts again from the whip', sw[4]?.move === M.WHIP);
    check('a move counts once for those watching (fireCount), however many blows it lands', x.s.fireCount === x.of('nk_swing').length);
  }
  // the window
  {
    const x = sim();
    const w = NK_MOVES[M.WHIP];
    x.run(2, BTN.ATTACK);
    x.run(x.secs(w.rate + NK.window) - 4);
    x.run(2, BTN.ATTACK);
    const inWindow = x.of('nk_swing')[1]?.move;
    const y = sim();
    y.run(2, BTN.ATTACK);
    y.run(y.secs(w.rate + NK.window) + 3);
    const over = y.s.recoil === 0 && y.s.cooldown === 0;
    y.run(2, BTN.ATTACK);
    const after = y.of('nk_swing')[1]?.move;
    check(`a press inside ${NK.window} s of a move's end goes on to the next; later, the combo is over and it is the opener again`, inWindow === M.BACKHAND && after === M.WHIP && over);
    const z = sim();
    z.run(2, BTN.ATTACK);
    z.run(4);
    z.run(2, BTN.ATTACK); // (pressed while the whip is still under way: nothing, it is not ready)
    check('...and a press before the move is over does nothing (the hold, or the input buffer, is what chains)', z.of('nk_swing').length === 1);
  }
  // the openers
  {
    const a = sim();
    a.run(30, BTN.FWD | BTN.SPRINT);
    a.run(2, BTN.FWD | BTN.SPRINT | BTN.ATTACK);
    const b = sim();
    b.run(10, BTN.CROUCH);
    b.run(2, BTN.CROUCH | BTN.ATTACK);
    const c = sim();
    c.run(10, BTN.BACK);
    c.run(2, BTN.BACK | BTN.ATTACK);
    const got = [a, b, c].map((x) => x.of('nk_swing')[0]?.move);
    check('the opener goes by how they are moving: a lunge at a sprint, a sweep crouched, a retreating backhand backing away', got[0] === M.LUNGE && got[1] === M.SWEEP && got[2] === M.RETREAT, got.map((m) => NK_MOVES[m]?.name).join(', '));
    a.run(a.secs(NK_MOVES[M.LUNGE].rate) + 1, BTN.ATTACK);
    check('...and each goes on into the chain at the backhand', a.of('nk_swing')[1]?.move === M.BACKHAND);
  }
  // the heavy attack
  {
    const held = (secs) => {
      const x = sim();
      x.run(x.secs(secs), BTN.ALT);
      const wound = x.s.reloadT, tier = nkWind(x.s), flag = !!(playerFlags({ state: x.s }) & PFLAG.RELOADING);
      x.run(1);
      const sw = x.of('nk_swing')[0];
      x.run(x.secs(0.3));
      return { x, wound, tier, flag, move: sw?.move, at: sw?.t, hit: x.of('melee')[0] };
    };
    const tap = held(0.1), mid = held(NK.tiers[0] + 0.1), full = held(NK.tiers[1] + 0.1);
    check('the heavy attack is wound up while the button is held and struck when it is let go: a tap, a middling and a full wind-up', tap.move === M.HEAVY1 && mid.move === M.HEAVY2 && full.move === M.HEAVY3 && [tap, mid, full].every((r) => r.x.of('nk_wind').length === 1 && r.x.s.reloadT === 0), [tap, mid, full].map((r) => NK_MOVES[r.move]?.name).join(', '));
    check('...its blow lands the heavy move\'s time after that, marked heavy', [tap, mid, full].every((r) => r.hit && r.hit.heavy && r.hit.move === r.move && near(r.hit.t - r.at, NK_MOVES[r.move].hits[0])));
    check('...the wind-up clock rides in reloadT (so others see the spin as PFLAG.RELOADING), and names its tier', near(full.wound, NK.tiers[1] + 0.1, CMD_DT * 2) && full.flag && tap.tier === 1 && mid.tier === 2 && full.tier === 3 && heavyMove(0) === M.HEAVY1);
    const x = sim();
    x.run(x.secs(0.5), BTN.ALT);
    x.run(1, BTN.ALT | BTN.ATTACK);
    check('...the primary button pressed mid wind-up strikes it too', x.of('nk_swing')[0]?.move === M.HEAVY2 && x.s.reloadT === 0);
    const y = sim();
    y.run(y.secs(NK.windMax + 1), BTN.ALT);
    const clock = y.s.reloadT;
    y.run(y.secs(7), BTN.ALT);
    check('...held on, the clock stops and the spin goes on at its cost, until they are out of breath and it is let go for them', near(clock, NK.windMax, 1e-6) && y.of('exhausted').length === 1 && y.of('nk_swing')[0]?.move === M.HEAVY3 && y.s.exhausted === 1, `struck at ${y.of('nk_swing')[0]?.t.toFixed(1)} s`);
    const z = sim();
    z.run(z.secs(0.3), BTN.ALT);
    z.run(1, 0, SLOT_PISTOL);
    check('...and putting the weapon away drops the wind-up and the combo', z.s.reloadT === 0 && z.s.recoil === 0 && z.of('nk_swing').length === 0);
  }
  // stamina
  {
    const x = sim();
    const light = [M.WHIP, M.BACKHAND, M.EIGHT, M.SMASH];
    const total = light.reduce((n, m) => n + NK_MOVES[m].rate, 0), cost = light.reduce((n, m) => n + NK_MOVES[m].stamina, 0);
    x.run(x.secs(total) - 1, BTN.ATTACK);
    check('each move costs its stamina as it starts', near(x.s.stamina, STAMINA_MAX - cost, 0.01) && x.s.staminaDelay > 0, `${(STAMINA_MAX - x.s.stamina).toFixed(1)} for the light chain`);
    const y = sim();
    y.run(y.secs(1), BTN.ALT);
    check(`winding up costs ${NK.windDrain} a second, and letting go the strike's own`, near(STAMINA_MAX - y.s.stamina, NK.windDrain * 1, 0.4));
    x.run(x.secs(30), BTN.ATTACK);
    const tired = x.of('nk_swing').filter((e) => e.t > x.of('exhausted')[0]?.t + 1);
    check('out of breath it is the opener alone, no combo', x.of('exhausted').length >= 1 && tired.length > 3 && tired.slice(0, 3).every((e) => e.move === M.WHIP));
    const w = sim();
    w.s.stamina = 3;
    w.run(2, BTN.ATTACK);
    w.run(w.secs(STAMINA_REGEN_DELAY + 3));
    check('...and it comes back as it does after a sprint', w.s.stamina > 30 && w.s.exhausted === 0);
  }
  // the other melee weapons are as they were
  {
    const x = sim();
    x.s.weapons[SLOT_MELEE] = ITEM.KNIFE;
    x.run(1, BTN.ATTACK);
    x.run(x.secs(WEAPONS[ITEM.KNIFE].rate));
    x.run(1, BTN.ALT);
    const ev = x.of('melee');
    check('a knife still swings on the press, light and heavy, with no move and no stamina', ev.length === 2 && ev[0].move === undefined && !ev[0].heavy && ev[1].heavy && x.s.stamina === STAMINA_MAX && x.s.recoil === 0 && x.s.reloadT === 0 && x.s.cooldown >= 0);
  }
}

// ---------------------------------------------------------------- the blows on the server
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const w = game.world;
function client(name) {
  const c = { name, id: 0 };
  c.conn = {
    send(bytes) {
      if (bytes[0] === 1 && !c.id) c.id = bytes[1] | (bytes[2] << 8); // (S2C.WELCOME: u8 type, u16 id)
    },
  };
  c.session = game.onOpen(c.conn);
  const wr = new Writer(64);
  wr.u8(C2S.JOIN);
  wr.u8(PROTOCOL_VERSION);
  wr.str(name);
  game.onMessage(c.session, wr.bytes().slice());
  return c;
}
client('Lee');
for (let i = 0; i < 2; i++) game.update();
const a = [...game.players.values()][0];
game.zm.spawnRoamer = () => null;
game.zm.spawnForestPack = () => 0;
if (game.zm.herds) game.zm.herds.spawn = () => null;
const clearZombies = () => {
  for (const z of [...game.zombies]) game.removeEntity(z);
  game.zombies.length = 0;
};
// somewhere open and level, the survivor facing -Z with the dead set out ahead of them
let spot = null;
for (let r = 0; r < 400 && !spot; r += 15) {
  for (let k = 0; k < 16 && !spot; k++) {
    const x = a.state.x + Math.cos((k / 16) * Math.PI * 2) * r, z = a.state.z + Math.sin((k / 16) * Math.PI * 2) * r;
    let ok = true;
    const y0 = groundAt(w, x, z, 200, 0.3);
    for (let dz = 0; dz <= 5 && ok; dz += 0.5) for (const dx of [-1, 0, 1]) ok = ok && Math.abs(groundAt(w, x + dx, z - dz, 200, 0.3) - y0) < 0.15;
    if (ok) spot = { x, z, y: y0 };
  }
}
check('found open ground to fight on', !!spot);
if (spot) {
  const s = a.state;
  s.x = spot.x;
  s.z = spot.z;
  s.y = spot.y;
  s.yaw = 0;
  s.pitch = -0.6; // (at the belly: no head shots unless a check aims for one)
  s.vx = s.vy = s.vz = 0;
  s.weapons[SLOT_MELEE] = ITEM.NUNCHAKU;
  s.slot = SLOT_MELEE;
  game.fillHistory(a);
  const R = ZOMBIE_DEFS[ZTYPE.WALKER].radius;
  const reach = DEF.range * game.diff.melee;
  const put = (dist, dx = 0, type = ZTYPE.WALKER) => {
    const z = game.zm.spawn(type, s.x + dx, s.z - dist, {});
    z.y = groundAt(w, z.x, z.z, 200, 0.3);
    z.hp = z.maxHp = 10000;
    for (let i = 0; i < 4; i++) game.recordHistory();
    return z;
  };
  const blow = (move, hit = 0) => {
    a.renderTick = game.tick & 0xffff;
    a.renderFrac = 0;
    game.combat.melee(a, { weapon: ITEM.NUNCHAKU, heavy: !!NK_MOVES[move].heavy, move, hit });
  };
  // damage, move by move
  {
    clearZombies();
    const z = put(1.2);
    const got = NK_MOVES.map((m, i) => {
      const before = z.hp;
      z.kx = z.kz = 0;
      blow(i);
      return { dmg: before - z.hp, knock: Math.hypot(z.kx, z.kz) };
    });
    check('each move does its own damage', got.every((g, i) => Math.abs(g.dmg - NK_MOVES[i].damage) < 1e-6), got.map((g, i) => `${NK_MOVES[i].name} ${g.dmg}`).join(', '));
    check('...and its own shove (the smash, the heavies and the retreat stagger; the light strokes barely move it)', got.every((g, i) => Math.abs(g.knock - NK_MOVES[i].knock * 1.6 * Math.cos(s.pitch)) < 1e-6) && NK_MOVES[M.SMASH].knock >= 3 && NK_MOVES[M.WHIP].knock < 1);
    s.exhausted = 1;
    const before = z.hp;
    blow(M.WHIP);
    s.exhausted = 0;
    check(`out of breath a blow does ${NK.tired} of it`, Math.abs(before - z.hp - NK_MOVES[M.WHIP].damage * NK.tired) < 1e-6);
    s.pitch = 0;
    const h0 = z.hp;
    blow(M.SMASH);
    s.pitch = -0.6;
    check('aimed at the head it is the head multiplier', Math.abs(h0 - z.hp - NK_MOVES[M.SMASH].damage * DEF.headMul) < 1e-6, `${h0 - z.hp}`);
    const k0 = z.hp;
    game.combat.melee(a, { weapon: ITEM.NUNCHAKU, heavy: false });
    check('a blow that names no move does nothing (nunchucks have no plain swing)', z.hp === k0);
  }
  // reach
  {
    clearZombies();
    const inside = put(reach + R - 0.1), h = inside.hp;
    blow(M.WHIP);
    const hitIn = h - inside.hp > 0;
    clearZombies();
    const outside = put(reach + R + 0.15), h2 = outside.hp;
    blow(M.WHIP);
    const missOut = h2 === outside.hp;
    blow(M.LUNGE);
    const lungeHits = h2 - outside.hp > 0;
    check(`reach: ${DEF.range} m, and the lunge ${NK_MOVES[M.LUNGE].reach} m more`, hitIn && missOut && lungeHits);
  }
  // how many
  {
    clearZombies();
    const z1 = put(1.2, -0.45), z2 = put(1.3, 0.45);
    const hp = () => [z1.hp, z2.hp];
    let b = hp();
    blow(M.WHIP);
    const one = hp().filter((v, i) => v < b[i]).length;
    b = hp();
    blow(M.SWEEP);
    const two = hp().filter((v, i) => v < b[i]).length;
    b = hp();
    blow(M.HEAVY3);
    const heavy = hp().filter((v, i) => v < b[i]).length;
    check('one target a blow; the crouched sweep and a wound-up heavy clip two', one === 1 && two === 2 && heavy === 2, `${one}, ${two}, ${heavy}`);
  }
  // a walker: how many combos it takes
  {
    clearZombies();
    const z = put(1.2);
    z.hp = z.maxHp = ZOMBIE_DEFS[ZTYPE.WALKER].hp;
    let n = 0;
    for (const m of [M.WHIP, M.BACKHAND, M.EIGHT, M.EIGHT, M.SMASH]) {
      if (z.dead) break;
      blow(m, n === 3 ? 1 : 0);
      n++;
    }
    check('one light chain, all of it landed, kills a walker - on the smash', z.dead && n === 5, `dead after ${n} blows`);
  }
  clearZombies();
}

// ---------------------------------------------------------------- prediction and the server
// One client with the real Prediction / Connection / decoder on a link that delays every message 100 ms each way:
// it plays the light chain, a heavy attack and a combo cut short. The server must agree with the prediction of every
// command, never rebase the client, and run the same moves and the same blows.
function runNet(LAG) {
  const g = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
  g.zm.spawnRoamer = () => null;
  g.zm.spawnForestPack = () => 0;
  if (g.zm.herds) g.zm.herds.spawn = () => null;
  let now = 0;
  const toClient = [], toServer = [];
  const push = (q, bytes) => q.push([now + LAG, bytes]);
  const c = { net: { tick: 0, ack: 0 }, self: {}, global: null, ents: new Map(), id: 0, pred: null };
  const store = { ents: c.ents, onCreate() {}, onRemove() {}, onUpdate() {} };
  const handler = new Proxy({}, { get: () => () => {} });
  const session = g.onOpen({ send: (bytes) => push(toClient, bytes.slice()) });
  const conn = new Connection({});
  conn.open = true;
  conn.ws = { readyState: 1, send: (bytes) => push(toServer, bytes.slice()), close() {} };
  const wr = new Writer(64);
  wr.u8(C2S.JOIN);
  wr.u8(PROTOCOL_VERSION);
  wr.str('chain');
  g.onMessage(session, wr.bytes().slice());
  const predAt = new Map();
  let stray = 0, poked = false;
  function onClientMessage(buf) {
    const r = new Reader(buf);
    const t = r.u8();
    if (t === S2C.WELCOME) {
      c.id = r.u16();
      c.pred = new Prediction(createWorld(r.u32()));
    } else if (t === S2C.SNAPSHOT) {
      const flags = readHeader(r, c.net);
      if (flags & SNAP.GLOBAL) c.global = readGlobal(r, c.global);
      const sync = readSelf(r, c.self, flags);
      readEntities(r, store, c.net.tick, flags);
      if (sync) {
        if (c.pred.hasServerState && !poked) stray++;
        c.pred.reconcile(c.net.ack, c.self);
        predAt.clear();
      } else c.pred.confirm(c.net.ack);
      readEvents(r, handler, flags, c.ents);
    }
  }
  const ran = [];
  const handleSimEvent = g.handleSimEvent.bind(g);
  g.handleSimEvent = (p, ev) => {
    if (ev.type === 'nk_swing' || ev.type === 'melee' || ev.type === 'nk_wind') ran.push(`${ev.type}:${ev.move ?? ''}:${ev.hit ?? ''}`);
    handleSimEvent(p, ev);
  };
  const did = [];
  let frame = 0, checks = 0, wrong = 0, hashes = 0;
  const advance = (n, held = 0, slot = 255) => {
    for (; n > 0; n--) {
      now = (frame * 1000) / 60;
      while (toClient.length && toClient[0][0] <= now) onClientMessage(toClient.shift()[1]);
      while (toServer.length && toServer[0][0] <= now) g.onMessage(session, toServer.shift()[1]);
      if (c.pred && c.pred.hasServerState) {
        if (slot !== 255) c.pred.requestSlot(slot);
        slot = 255;
        c.pred.step(1 / 60, held, 0, 0, (evs) => evs.forEach((ev) => (ev.type === 'nk_swing' || ev.type === 'melee' || ev.type === 'nk_wind') && did.push(`${ev.type}:${ev.move ?? ''}:${ev.hit ?? ''}`)), null);
        predAt.set(c.pred.seq, copyPlayerState(createPlayerState(), c.pred.state));
        for (let out; (out = c.pred.takeOutbox(1 / 60)); ) {
          conn.sendInput(c.net.tick - 2, 0, out, c.pred.hash(out));
          hashes++;
        }
      }
      if (++frame % (60 / SERVER_TICK_RATE)) continue;
      const p = g.players.get(c.id);
      const seqBefore = p ? p.lastSeq : 0;
      g.update();
      const mine = p && p.lastSeq !== seqBefore && predAt.get(p.lastSeq);
      if (mine && !poked) {
        checks++;
        if (!samePlayerState(mine, p.shadow)) wrong++;
      }
      if (p) for (const k of predAt.keys()) if (((p.lastSeq - k) & 0xffff) < 0x8000) predAt.delete(k);
    }
  };
  const settle = Math.ceil((2 * LAG * 60) / 1000) + 30;
  advance(settle + 30);
  // the server hands them the nunchucks: a change the client cannot predict, so one rebase is due
  poked = true;
  const p = g.players.get(c.id);
  p.state.weapons[SLOT_MELEE] = ITEM.NUNCHAKU;
  advance(settle);
  poked = false;
  advance(40, 0, SLOT_MELEE);
  const light = 0.32 + 0.3 + 0.44 + 0.62;
  advance(Math.round(light * 2 * 60), BTN.ATTACK); // the light chain, twice round
  advance(90);
  advance(70, BTN.ALT); // wound up past the last tier
  advance(80);
  advance(3, BTN.ATTACK); // a combo cut short: a whip, a pause inside the window, a backhand, then left to run out
  advance(30);
  advance(3, BTN.ATTACK);
  advance(90);
  advance(40, BTN.FWD | BTN.SPRINT); // a lunge at a sprint, into the chain
  advance(50, BTN.FWD | BTN.SPRINT | BTN.ATTACK);
  advance(settle + 60);
  const moves = did.filter((e) => e.startsWith('nk_swing')).map((e) => +e.split(':')[1]);
  const same = did.length === ran.length && did.every((e, i) => e === ran[i]);
  const ok = checks > 150 && wrong === 0 && stray === 0 && same && moves.length >= 13 && moves.includes(M.HEAVY3) && moves.includes(M.LUNGE) && moves.includes(M.SMASH);
  check(`on a ${LAG} ms link the server agrees with the prediction of every command, never rebases, and runs the same moves and blows`, ok, `${checks} commands checked, ${wrong} differed, ${stray} stray rebases, ${did.length} events predicted / ${ran.length} run${same ? '' : ' (not the same)'}, moves ${moves.map((m) => NK_MOVES[m].name).join(' ')}`);
  void hashes;
  void hashPlayerState;
}
runNet(100);

// ---------------------------------------------------------------- the chain
{
  // 10,000 frames at mixed frame rates, the hand thrashing about, a fist and a forearm in the way: nothing is ever
  // not a number, no link is ever longer or shorter than itself, the rod is never further from the hand than the
  // chain, and it is never inside the fist or the forearm
  const sim = new ChainSim();
  sim.setAnchor(0, 1.3, 0, 0, 1, 0);
  sim.reset();
  const rates = [1 / 60, 1 / 30, 1 / 144, 1 / 20, 1 / 240, 1 / 10, 1 / 75, 1 / 1000];
  let t = 0, nan = false, lo = 9, hi = 0, rod = 0, span = 0, gap = 0, deep = 0, fast = 0, steps = 0;
  const FIST = 0.046, ARM = 0.04;
  const F = [0.3, -0.5, 0.8];
  for (let i = 0; i < 10000; i++) {
    const dt = rates[(i * 7 + (i >> 5)) % rates.length];
    let at = null;
    const piece = (dt) => {
    t += dt;
    // strikes, whirls and sudden stops
    const k = 0.5 + 0.5 * Math.sin(t * 0.7);
    const x = 0.35 * Math.sin(t * 9 * k), y = 1.3 + 0.3 * Math.sin(t * 17 * k + 1), z = -0.3 + 0.25 * Math.cos(t * 7 * k);
    const dx = Math.cos(t * 11), dy = Math.sin(t * 13) + 0.4, dz = Math.sin(t * 5);
    const dl = Math.hypot(dx, dy, dz);
    // the fist is where the handle is held: its grip, a hand's reach from the handle's eye back down it; the forearm
    // runs off from it square to the handle, as a forearm does (the rig keeps it so: no wrist cocks further)
    const gx = x - (dx / dl) * 0.214, gy = y - (dy / dl) * 0.214, gz = z - (dz / dl) * 0.214;
    // (carried round with the handle from where it was: a forearm does not jump)
    const fd = (F[0] * dx + F[1] * dy + F[2] * dz) / (dl * dl);
    let fx = F[0] - dx * fd, fy = F[1] - dy * fd, fz = F[2] - dz * fd;
    const fl = Math.hypot(fx, fy, fz) || 1;
    F[0] = fx /= fl;
    F[1] = fy /= fl;
    F[2] = fz /= fl;
    const wx = gx + fx * 0.083, wy = gy + fy * 0.083, wz = gz + fz * 0.083, ex = gx + fx * 0.34, ey = gy + fy * 0.34, ez = gz + fz * 0.34;
    at = { gx, gy, gz, wx, wy, wz, ex, ey, ez };
    sim.setAnchor(x, y, z, dx, dy, dz);
    sim.clearColliders();
    sim.addCollider(gx, gy, gz, wx, wy, wz, FIST, NK_COL.ROD);
    sim.addCollider(wx, wy, wz, ex, ey, ez, ARM, NK_COL.ALL);
    steps += sim.step(dt);
    };
    // (given the hand as the rig gives it: in pieces of at most 1/120 s of a frame - NunchakuCore.update)
    const pieces = Math.max(1, Math.ceil(dt * 120 - 1e-6));
    for (let k = 0; k < pieces; k++) piece(dt / pieces);
    const { gx, gy, gz, wx, wy, wz, ex, ey, ez } = at;
    const e = sim.chainError();
    if (![...sim.top, ...sim.u, ...sim.butt, ...sim.j].every(Number.isFinite)) nan = true;
    lo = Math.min(lo, e.lo);
    hi = Math.max(hi, e.hi);
    rod = Math.max(rod, Math.abs(e.rod - 1));
    span = Math.max(span, e.span);
    gap = Math.max(gap, e.gap);
    fast = Math.max(fast, sim.tipSpeed);
    deep = Math.max(deep, -sim.rodClearance(gx, gy, gz, wx, wy, wz, FIST), -sim.rodClearance(wx, wy, wz, ex, ey, ez, ARM));
  }
  check('the chain, 10,000 frames at 10 to 1000 fps: never not a number', !nan, `${steps} steps of 1/${NK_SIM.hz} s, the free handle up to ${fast.toFixed(0)} m/s`);
  check('...every link its own length, and the free handle its own', lo > 0.9999 && hi < 1.0001 && rod < 1e-9, `links ${((lo - 1) * 100).toFixed(4)}% .. +${((hi - 1) * 100).toFixed(4)}%, handle ${(rod * 100).toExponential(1)}%`);
  check('...the two handles never further apart than the chain is long', span <= 1 + 1e-9 && gap < 0.003, `eye to eye at most ${(span * 100).toFixed(4)}% of it, the drawn chain meets the handle within ${(gap * 1000).toFixed(2)} mm`);
  check('...and the free handle never inside the fist or the forearm', deep < 0.004, `${(deep * 1000).toFixed(2)} mm into the 6 mm of padding round them at the worst`);
}
{
  // the same swing at any frame rate: hung from a still hand and let go 25 degrees off the plumb, chain and handle
  // in a line, it is a pendulum - the same period however long the frames, and it never climbs above where it started
  const A0 = (25 * Math.PI) / 180;
  const period = (dt, uneven) => {
    const sim = new ChainSim();
    sim.setAnchor(0, 2, 0, 0, -1, 0); // (the hand's own handle standing up out of the way, the chain hanging from its eye)
    sim.reset();
    for (const [o, r] of [[0, NK_CHAIN + 0.0774], [3, NK_CHAIN + 0.2506]]) {
      sim.g[o] = Math.sin(A0) * r;
      sim.g[o + 1] = 2 - Math.cos(A0) * r;
      sim.g[o + 2] = 0;
    }
    sim.h.set(sim.g);
    const y0 = 2 - Math.cos(A0) * (NK_CHAIN + NK_GEOM.eye + NK_GEOM.handle);
    let t = 0, last = 1, crossings = [], top = -9, i = 0;
    while (t < 8) {
      const d = uneven ? dt * (0.3 + (1.4 * ((i * 7919) % 13)) / 13) : dt;
      i++;
      sim.setAnchor(0, 2, 0, 0, -1, 0);
      sim.step(d);
      t += d;
      const x = sim.butt[0];
      if (last > 0 && x <= 0) crossings.push(t - d + (d * last) / (last - x));
      last = x;
      top = Math.max(top, sim.butt[1]);
    }
    return { T: crossings.length > 2 ? (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1) : 0, rise: top - y0 };
  };
  const ref = period(1 / 960, false);
  const others = [period(1 / 60, false), period(1 / 30, false), period(1 / 144, false), period(1 / 20, false), period(1 / 60, true)];
  const worst = Math.max(...others.map((o) => Math.abs(o.T - ref.T) / ref.T));
  check('the same swing at 20, 30, 60, 144 fps and at an uneven one: the same period', ref.T > 0.7 && ref.T < 1.4 && worst < 0.02, `${ref.T.toFixed(3)} s, at most ${(worst * 100).toFixed(2)}% off`);
  check('...and it never swings back up past where it was let go (the steps add no energy)', [ref, ...others].every((o) => o.rise <= 1e-3), `at most ${(Math.max(ref.rise, ...others.map((o) => o.rise)) * 1000).toFixed(2)} mm above`);
  // the same inputs give the same chain
  const run = () => {
    const sim = new ChainSim();
    sim.setAnchor(0, 1, 0, 0, 1, 0);
    sim.reset();
    for (let i = 0; i < 400; i++) {
      sim.setAnchor(0.2 * Math.sin(i * 0.2), 1 + 0.1 * Math.cos(i * 0.31), 0.1 * Math.sin(i * 0.13), Math.sin(i * 0.1), 1, Math.cos(i * 0.07));
      sim.step(1 / 60);
    }
    return [...sim.g, ...sim.j].join();
  };
  check('the same hand gives the same chain, every time', run() === run());
}
{
  // caught, held, passed: the catch draws the free handle to the hand and holds it there; a pass swaps which handle
  // is held without either moving
  const sim = new ChainSim();
  sim.setAnchor(0, 1.2, 0, 0, 1, 0);
  sim.reset();
  for (let i = 0; i < 30; i++) {
    sim.setAnchor(0.1 * Math.sin(i * 0.3), 1.2, 0, 0, 1, 0);
    sim.step(1 / 60);
  }
  const target = [-0.08, 1.2, 0, 0, 1, 0];
  for (let i = 0; i <= 12; i++) {
    sim.setAnchor(0, 1.2, 0, 0, 1, 0);
    sim.setPin(i / 12, ...target);
    sim.step(1 / 60);
  }
  const off = Math.hypot(sim.top[0] - target[0], sim.top[1] - target[1], sim.top[2] - target[2]);
  check('a catch brings the free handle to the hand that takes it, and holds it there', off < 1e-4 && sim.u[1] > 0.9999, `${(off * 1000).toFixed(3)} mm off`);
  const before = { top: [...sim.top], a: [...sim.a].slice(0, 3) };
  sim.swap();
  const moved = Math.hypot(sim.a[0] - before.top[0], sim.a[1] - before.top[1], sim.a[2] - before.top[2]) + Math.hypot(sim.top[0] - before.a[0], sim.top[1] - before.a[1], sim.top[2] - before.a[2]);
  sim.setAnchor(...target);
  sim.step(1 / 60);
  const e = sim.chainError();
  check('a pass changes which handle is held, neither of them moving, the chain whole', moved < 1e-6 && e.hi < 1.0001 && e.span <= 1 + 1e-9, `moved ${(moved * 1000).toFixed(4)} mm`);
}

// ---------------------------------------------------------------- the moves' animation, in both views
// The rig the two views share (NunchakuCore), run headless through every move, the light chain, the wind-up and the
// flourish, in first person and on two bodies: nothing not a number, the two handles never torn apart, no wrist bent
// further than a wrist goes, and every one of them back in the guard, the free handle in the other hand, in the end.
{
  const P0 = { shoulderW: 0.185, uarmLen: 0.29, farmLen: 0.26, shoulderY: 1.41, chestY: 1.26 };
  const bodies = [['first person', FP], ['third person', tpBody(P0)], ['third person, long arms', tpBody({ ...P0, uarmLen: 0.31, farmLen: 0.28, shoulderW: 0.2 })]];
  for (const [label, body] of bodies) {
    let bad = '', worstCock = 0, worstSpan = 0, runs = 0, slowest = 0;
    const drive = (name, events, wind, secs) => {
      const core = new NunchakuCore(body);
      core.noIdle = true;
      const dt = 1 / 60, eyeOf = (i) => new THREE.Vector3(0, 0, -(NK_GEOM.grip + NK_GEOM.eye)).applyQuaternion(core.stickQ[i]).add(core.stickP[i]);
      let t = -0.8, ei = 0, settled = -1;
      for (; t < secs; t += dt) {
        while (ei < events.length && events[ei][0] <= t + 1e-9) events[ei++][1](core);
        core.wind(wind(t));
        core.update(dt, {});
        core.events.length = 0;
        const nums = [...core.stickP[0].toArray(), ...core.stickP[1].toArray(), ...core.stickQ[0].toArray(), ...core.stickQ[1].toArray(), ...core.joints, ...core.right.q.toArray(), ...core.left.q.toArray(), ...core.right.pole.toArray(), core.tipSpeed];
        if (!nums.every(Number.isFinite)) bad = bad || `${name}: not a number at ${t.toFixed(2)} s`;
        const span = eyeOf(0).distanceTo(eyeOf(1)) / NK_CHAIN;
        worstSpan = Math.max(worstSpan, span);
        if (t > 0) worstCock = Math.max(worstCock, Math.abs(core.dr.cock) * (core.windT > 0 || core.spin > 0 ? 0 : 1), Math.abs(core.ot.cock) * (core.who === 'o' ? 1 : 0));
        const lastEv = events.length ? events[events.length - 1][0] : 0;
        if (settled < 0 && t > lastEv + 0.3 && !core.clip && core.who === 'o' && core.pinW >= 1 && !(core.windT > 0)) settled = t - lastEv;
      }
      runs++;
      if (settled < 0) bad = bad || `${name}: not back in the guard after ${secs} s`;
      slowest = Math.max(slowest, settled);
    };
    const one = (m) => [[0, (c) => c.swing(m)]];
    NK_MOVES.forEach((m, i) => drive(m.name, one(i), () => 0, 2.5));
    let at = 0;
    const chain = [0, 1, 2, 3, 0, 1, 2, 3].map((m) => {
      const e = [at, (c) => c.swing(m)];
      at += NK_MOVES[m].rate;
      return e;
    });
    drive('the light chain twice', chain, () => 0, at + 2.5);
    // (with the blows landing: the free handle comes off them)
    const hits = [];
    at = 0;
    for (const m of [0, 1, 2, 3]) {
      hits.push([at, (c) => c.swing(m)]);
      for (const h of NK_MOVES[m].hits) hits.push([at + h, (c) => c.hit('bone', 0.2, 0.1, 1, 1.2)]);
      at += NK_MOVES[m].rate;
    }
    hits.sort((x, y) => x[0] - y[0]);
    drive('the light chain, every blow landing', hits, () => 0, at + 2.5);
    drive('a full wind-up and its strike', [[1.5, (c) => c.swing(M.HEAVY3)]], (t) => (t >= 0 && t < 1.5 ? t + 1 / 60 : 0), 4.5);
    drive('the draw', [[0, (c) => c.draw()]], () => 0, 2.5);
    if (body.clips.show1) drive('the flourish', [[0, (c) => c.flourish()]], () => 0, 10);
    check(`the moves, ${label}: every one ends back in the guard, nothing torn or not a number`, !bad && worstSpan < 1.02, bad || `${runs} runs, back in the guard within ${slowest.toFixed(2)} s of the last move, the handles' eyes at most ${(worstSpan * 100).toFixed(1)}% of the chain apart`);
    check(`...and no wrist is cocked further than a wrist goes`, worstCock < 0.64, `${((worstCock * 180) / Math.PI).toFixed(0)} degrees at the most`);
  }
}

// ---------------------------------------------------------------- smooth
// Nothing shakes, pops or snaps: every move, and every hand-off between two of them, in both views, at 30, 60 and 144
// frames a second and on uneven frames with hitches - what is drawn (the hands, both handles, every link) looked at
// 120 times a second and more (scripts/clip/nunchaku-jitter.js, which is the instrument and says what it measures).
{
  const rows = jitterSurvey(['fp', 'tp'], [30, 60, 144, 'uneven']);
  const bad = rows.filter(jitterBad);
  const worst = (k) => rows.reduce((m, r) => Math.max(m, r[k]), 0);
  const held = Math.max(worst('shakeHeld'), worst('popHeld')), free = Math.max(worst('shakeFree'), worst('popFree'));
  const f = bad[0];
  check(
    'the motion is smooth: no shake, pop or snap in any move or hand-off, in either view, at 30 / 60 / 144 fps and on uneven frames',
    bad.length === 0,
    bad.length
      ? `${bad.length} of ${rows.length} runs over the marks, the first: ${f.view} ${f.name} @${f.rate} - held ${Math.max(f.shakeHeld, f.popHeld).toFixed(1)} mm${f.worst ? ` (${f.worst.kind}: ${f.worst.at} at ${f.worst.t.toFixed(3)} s)` : ''}, free ${Math.max(f.shakeFree, f.popFree).toFixed(1)} mm, a hand ${f.snap.toFixed(0)} m/s^2`
      : `${rows.length} runs; at the worst ${held.toFixed(1)} mm on the hands and the held handle (mark ${JITTER_LIMIT.held}), ${free.toFixed(1)} mm on the free handle and the chain (${JITTER_LIMIT.free}), a hand ${worst('snap').toFixed(0)} m/s^2 (${JITTER_LIMIT.snap})`,
  );
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall nunchucks checks passed');
process.exit(fails.length ? 1 : 0);
