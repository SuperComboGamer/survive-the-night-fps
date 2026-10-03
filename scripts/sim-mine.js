// In-process smoke test of the Zombies mode: a client joins asking for it, the rounds run, points come in, buys work
// (gun, ammo refill, perk, box, debris), the cage takes the team down and the next round starts a stop deeper.
// Every snapshot goes through the real client decoder. usage: node scripts/sim-mine.js
import { Game } from '../server/game.js';
import { C2S, ACT, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { PHASE } from '../shared/constants.js';
import { ITEM, ZTYPE, WEAPONS } from '../shared/defs.js';
import { readSnapshot } from '../client/net/decode.js';
import { MODE } from '../shared/modes.js';
import { MINE } from '../shared/minedefs.js';
import { PERK } from '../shared/mine.js';

const game = new Game({ seed: 77, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
function client(name, mode) {
  const c = { name, id: 0, mode: -1, resets: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [] };
  c.handler = { sound() {}, shot() {}, impact() {}, hitmark() {}, damage() {}, killfeed() {}, notify: (m, a) => c.notes.push([m, a]), explosion() {}, pickup() {}, zombieDie() {}, structBreak() {}, ping() {}, summary() {}, flyover() {} };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) {
        c.id = r.u16();
        r.u32();
        r.u32();
        r.u8();
        r.u8();
        c.mode = r.u8();
      } else if (t === S2C.WORLD_RESET) {
        r.u32();
        c.resets++;
      } else if (t === S2C.SNAPSHOT) {
        readSnapshot(r, c);
        if (r.left !== 0) throw new Error(`${name}: ${r.left} trailing snapshot bytes`);
      }
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  if (mode !== undefined) w.u8(mode);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  c.act = (act, ...args) => {
    const w2 = new Writer(32);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    if (act === ACT.INTERACT || act === ACT.HOLD_BEGIN) w2.u16(args[0]);
    else if (args.length) w2.u8(args[0]);
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}
const run = (ticks) => {
  for (let i = 0; i < ticks; i++) game.update();
};
const untilTrue = (pred, max = 20 * 120) => {
  for (let i = 0; i < max && !pred(); i++) game.update();
  return pred();
};

const a = client('Miner', MODE.MINE);
run(2);
check('the first joiner picks the mode', game.mode === MODE.MINE && !!game.mine && a.mode === MODE.MINE, `mode ${game.mode} welcome ${a.mode}`);
check('the world is the mine', !!game.world.mine && game.world.mine.stops.length === 5);
check('global state carries the mode block', a.global?.mode === 1 && a.global.stop === 0 && a.global.round === 0, JSON.stringify({ m: a.global?.mode, s: a.global?.stop, r: a.global?.round }));
const p = a.p();
const st = game.world.mine.stops[0];
check('the player starts at stop 0 by the cage, pistol and knife, nothing to build', Math.hypot(p.state.x - st.ox, p.state.z - st.oz - 6) < 6 && p.state.weapons[1] === ITEM.PISTOL && p.state.weapons[4] === 0);
check('points: 500 to start', a.self.points === 500 && game.mine.pts(p) === 500, `self ${a.self.points}`);

// ---- round 1
check('the countdown ends in round 1 (phase night, day = round)', untilTrue(() => game.phase === PHASE.NIGHT) && game.day === 1);
run(120);
const z1 = game.zombies.filter((z) => !z.dead);
check('round 1 brings walkers only, a few at a time', z1.length > 0 && z1.length <= 24 && z1.every((z) => z.ztype === ZTYPE.WALKER), `${z1.length} alive`);
check('they spawn inside the stop', game.zombies.every((z) => Math.abs(z.x - st.ox) < 62 && z.z > st.oz - 10 && z.z < st.oz + 98));
// the dead hunt the survivor across the stop: standing still, they arrive and bite
let nearest = 1e9;
let hurt = false;
for (let i = 0; i < 20 * 50 && !hurt; i++) {
  game.update();
  for (const z of game.zombies) if (!z.dead) nearest = Math.min(nearest, Math.hypot(z.x - p.state.x, z.z - p.state.z));
  hurt = p.hp < p.maxHp;
}
check('the dead come for the survivor and bite', hurt, `closest ${nearest.toFixed(1)} m, hp ${p.hp.toFixed(0)}`);
p.hp = p.maxHp;
const victim = game.zombies.find((z) => !z.dead) || z1[0];

const before = game.mine.pts(p);
game.combat.damageZombie(victim, victim.hp - 1, p, { weapon: ITEM.PISTOL });
game.combat.damageZombie(victim, 5, p, { weapon: ITEM.PISTOL, headshot: true });
check('a hit is 10, a headshot kill 100', game.mine.pts(p) === before + 10 + 100, `${before} -> ${game.mine.pts(p)}`);
let guard = 0;
while ((game.mine.queue > 0 || game.mine.zombiesAlive() > 0) && guard++ < 20 * 600) {
  for (const z of game.zombies) if (!z.dead) game.combat.damageZombie(z, 1e6, p, { weapon: ITEM.PISTOL });
  game.update();
}
check('clearing the round calls the cage', game.mine.state === MINE.STATE.CLEAR && game.phase === PHASE.DAY);
run(20 * 5);
check('the cage comes to the exit shaft, not the arrival one', game.mine.elev.state === MINE.ELEV.OPEN && game.mine.elev.at === 1 && !st.exitClosed && st.cageClosed && a.global.elevAt === 1);

// ---- buys, at the first stop (before the ride)
const buys = game.mine.ents[0].buys;
const at = (e) => {
  p.state.x = e.x;
  p.state.z = e.z + 1.0;
  p.state.y = 0;
};
const gunBuy = buys.find((e) => e.mine.buy.kind === 'gun' && e.mine.buy.a === ITEM.SHOTGUN);
game.mine.points.set(p.id, 10000);
at(gunBuy);
a.act(ACT.HOLD_BEGIN, gunBuy.id);
run(2);
check('a wall gun is bought for its price', p.state.weapons[0] === ITEM.SHOTGUN && game.mine.pts(p) === 10000 - 500 && p.state.mags[0] === WEAPONS[ITEM.SHOTGUN].mag, `${game.mine.pts(p)}`);
p.state.ammo[WEAPONS[ITEM.SHOTGUN].ammo] = 0;
run(8);
a.act(ACT.HOLD_BEGIN, gunBuy.id);
run(2);
check('buying it again refills the ammo for half', p.state.ammo[WEAPONS[ITEM.SHOTGUN].ammo] > 0 && game.mine.pts(p) === 10000 - 500 - 250);
game.mine.points.set(p.id, 3);
run(8);
a.act(ACT.HOLD_BEGIN, gunBuy.id);
run(2);
check('without the points nothing is bought', game.mine.pts(p) === 3);
game.mine.points.set(p.id, 10000);
const perk = buys.find((e) => e.mine.buy.kind === 'perk');
at(perk);
run(8);
a.act(ACT.HOLD_BEGIN, perk.id);
run(2);
check('a perk machine gives its perk (the sim and the client see it)', (p.perks & PERK.QUICK_REVIVE) === PERK.QUICK_REVIVE && p.state.perks === p.perks && a.self.perks === p.perks, `perks ${p.perks} client ${a.self.perks}`);
const box = buys.find((e) => e.mine.buy.kind === 'box');
at(box);
run(8);
a.act(ACT.HOLD_BEGIN, box.id);
run(2);
check('the box rolls', game.mine.box.get(0).state === 1 && box.state === 255);
run(20 * 4);
check('...and offers a gun', game.mine.box.get(0).state === 2 && box.state > 0 && box.state < 255);
a.act(ACT.HOLD_BEGIN, box.id);
run(2);
check('...which is taken', game.mine.box.get(0).state === 0 && p.state.weapons[0] > 0);
check('there is no debris to buy: every stop is open', game.world.mine.stops.every((x) => x.gates.length === 0));

// ---- the ride
p.state.x = st.exit.x;
p.state.z = st.exit.z + 0.2;
run(4);
check('the ride starts with everyone in the cage', untilTrue(() => game.mine.state === MINE.STATE.RIDE, 20 * 8) && st.exitClosed);
check('it runs and arrives at stop 1', untilTrue(() => game.mine.state === MINE.STATE.PREP, 20 * 30) && game.mine.stopIndex === 1);
const st1 = game.world.mine.stops[1];
check("the team is in the new stop's cage", Math.abs(p.state.x - st1.ox) < 3 && p.state.z > st1.oz - 2 && p.state.z < st1.oz + 2.5, `${(p.state.x - st1.ox).toFixed(1)}, ${(p.state.z - st1.oz).toFixed(1)}`);
check("the old stop's dead are gone", game.zombies.length === 0);
check('round 2 starts at stop 1', untilTrue(() => game.phase === PHASE.NIGHT, 20 * 20) && game.day === 2 && game.mine.stopIndex === 1);

// ---- everyone down: game over, and a vote for the other mode switches the next run
a.act(ACT.WANT_MODE, MODE.SURVIVAL);
for (const z of game.zombies) game.combat.damageZombie(z, 1e6, p, {});
game.damagePlayer(p, 1e6, { kind: 2, ztype: 0, x: p.state.x, z: p.state.z });
run(2);
check('with nobody left standing the run is over', game.phase === PHASE.GAMEOVER || !p.alive);
check('the vote carries to the next run: survival', untilTrue(() => game.mode === MODE.SURVIVAL, 20 * 60) && !game.mine && a.resets > 0, `mode ${game.mode} resets ${a.resets}`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
process.exit(fails.length ? 1 : 0);
