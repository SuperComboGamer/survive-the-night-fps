// The flare gun, in-process against a real Game and decoded as a client does: what it costs at the workbench, that it
// takes the pistol's slot, that a shot straight up climbs, opens its chute, drifts down at its fall speed and burns out
// after its minute without ever touching the ground, that its single shell re-loads from the shells carried by itself, that
// a shot fired flat comes down and burns on the ground for the rest of its minute, that the flare reaches a survivor
// clear across the valley (no area of interest), and that at night it pins a Shade standing in the circle it lights
// and not one standing outside it.
// usage: node scripts/test-flaregun.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ENT, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { SLOT_PISTOL, SERVER_DT, BTN, PHASE } from '../shared/constants.js';
import { ITEM, RECIPES, WEAPONS, PROJ, ZTYPE, AMMO, AMMO_ITEMS } from '../shared/defs.js';
import { SKYFLARE, launchFlare, flarePos } from '../shared/skyflare.js';
import { groundAt } from '../shared/collision.js';
import { readSnapshot } from '../client/net/decode.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

function client(name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], seq: 0 };
  const nop = () => {};
  c.handler = new Proxy({ notify: (m, a) => c.notes.push([m, a]) }, { get: (t, k) => t[k] || nop });
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  if (c.p()) c.p().admin = true; // (the admin chat commands: c.tp)
  c.input = (buttons, yaw, pitch, slot = 255) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(yaw), qpitch: qpitch(pitch), slot: i === 0 ? slot : 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.tp = (x, z) => game.handleChat(c.p(), `/tp ${x} ${z}`);
  return c;
}
const run = (ticks, fn) => {
  for (let i = 0; i < ticks; i++) {
    fn?.(i);
    game.update();
  }
};
const count = (p, item) => p.inv.reduce((n, it) => n + (it && it.item === item ? it.count : 0), 0);
const skyflares = () => game.projectiles.filter((e) => e.ptype === PROJ.SKYFLARE);

// ---------------------------------------------------------------- the workbench
const gunR = RECIPES.find((r) => r.out === ITEM.FLARE_GUN);
const shellR = RECIPES.find((r) => r.out === ITEM.AMMO_FLARE);
check('the flare gun and its shells are made at the workbench, no schematic', !!gunR && !!shellR && gunR.station === 'bench' && shellR.station === 'bench' && !gunR.schem && !shellR.schem);
check('the recipe ids are unique', new Set(RECIPES.map((r) => r.id)).size === RECIPES.length);
const def = WEAPONS[ITEM.FLARE_GUN];
check("it is a sidearm (the pistol's slot) firing flare shells", def.slot === SLOT_PISTOL && def.skyflare && AMMO_ITEMS[def.ammo] === ITEM.AMMO_FLARE && def.ammo === AMMO.FLARE);

// ---------------------------------------------------------------- open ground under open sky
// somewhere flat with nothing standing for 45 m (the flat shot's run) and nothing over it
const w = game.world;
const treeBy = (x0, z0, x1, z1, m) => {
  const t = w.trees;
  const l = Math.hypot(x1 - x0, z1 - z0) || 1;
  const [ux, uz] = [(x1 - x0) / l, (z1 - z0) / l];
  for (let i = 0; i < t.length; i += 6) {
    const along = Math.max(0, Math.min(l, (t[i] - x0) * ux + (t[i + 2] - z0) * uz));
    if (Math.hypot(t[i] - x0 - ux * along, t[i + 2] - z0 - uz * along) < m) return true;
  }
  return false;
};
const open = (x, z) => Math.abs(x) < 250 && Math.abs(z) < 250 && !w.isDeepWater(x, z) && !game.nav.isBlocked(x, z);
const cluttered = (x, z, r) => w.staticGrid.query(x, z, r, []).some((o) => o.y1 > w.heightAt(x, z) + 0.2 && Math.hypot(o.x - x, o.z - z) < r + o.r);
let spot = null;
for (let x = -200; x <= 200 && !spot; x += 16) {
  for (let z = -200; z <= 200 && !spot; z += 16) {
    const dx = 0;
    const dz = -1;
    const h0 = w.heightAt(x, z);
    let ok = open(x, z) && !cluttered(x, z, 8) && game.nav.segClear(x, z, x + dx * 45, z + dz * 45) && !treeBy(x, z, x + dx * 45, z + dz * 45, 4) && !treeBy(x - 6, z, x + 6, z, 6);
    for (let d = 0; d <= 45 && ok; d += 2) ok = open(x + dx * d, z + dz * d) && Math.abs(w.heightAt(x + dx * d, z + dz * d) - h0) < 2 && !cluttered(x + dx * d, z + dz * d, 2.5);
    if (ok) spot = { x, z };
  }
}
check('found open level ground under open sky', !!spot, spot ? `(${spot.x}, ${spot.z})` : '');
if (!spot) {
  console.log('\nFAILED: no ground to test on');
  process.exit(1);
}

const A = client('Alice');
const B = client('Bob');
const a = A.p();
const s = a.state;
A.tp(spot.x, spot.z);
// Bob clear across the valley: far outside every area of interest
const far = { x: spot.x > 0 ? spot.x - 300 : spot.x + 300, z: spot.z };
B.tp(far.x, far.z);
run(4, () => {
  A.input(0, 0, 0);
  B.input(0, 0, 0);
});

// the flare gun goes in the pistol's place, loaded, with three shells carried
const pistol = s.weapons[SLOT_PISTOL];
s.weapons[SLOT_PISTOL] = 0;
game.giveItem(a, ITEM.FLARE_GUN, 1);
game.giveItem(a, ITEM.AMMO_FLARE, 3);
check('picked up loaded into the empty pistol slot', s.weapons[SLOT_PISTOL] === ITEM.FLARE_GUN && s.mags[1] === 1, `slot ${s.weapons[SLOT_PISTOL]} mag ${s.mags[1]} (pistol was ${pistol})`);
run(2, () => A.input(0, 0, 0, SLOT_PISTOL));
run(12, () => A.input(0, 0, 0));
check('the shells count as its reserve', s.ammo[AMMO.FLARE] === 3 && s.slot === SLOT_PISTOL, `reserve ${s.ammo[AMMO.FLARE]}, slot ${s.slot}`);

// ---------------------------------------------------------------- straight up
const UP = 1.5;
const ground = groundAt(w, s.x, s.z, s.y + 2, 0.3);
run(1, () => A.input(BTN.ATTACK, 0, UP));
run(1, () => A.input(0, 0, UP));
let fl = skyflares()[0];
check('a shot puts one flare in the air, its owner the shooter', skyflares().length === 1 && fl.owner === a.id && fl.everywhere, `${skyflares().length} flares`);
check('the gun is empty after the shot', s.mags[1] === 0);
if (!fl) {
  console.log('\nFAILED: no flare');
  process.exit(1);
}
const f = fl.flare;
const eye = f.y0;
// over the climb: where the closed form says it is, and up as high as a shot at UP rad goes
let top = -1e9;
let topT = 0;
run(Math.ceil((f.tOpen + 0.5) / SERVER_DT), () => {
  A.input(0, 0, UP);
  if (fl.y > top) {
    top = fl.y;
    topT = fl.t;
  }
});
const v = SKYFLARE.speed * Math.sin(UP);
const want = eye + (v * v) / (2 * SKYFLARE.grav);
check('it climbs to the top of its arc', Math.abs(top - want) < 1.5 && top - ground > 80, `top ${(top - ground).toFixed(1)} m over the ground (${(want - ground).toFixed(1)} expected) at ${topT.toFixed(2)} s`);
check('re-loaded itself from the shells carried', s.mags[1] === 1 && s.ammo[AMMO.FLARE] === 2, `mag ${s.mags[1]}, reserve ${s.ammo[AMMO.FLARE]}`);
// under the chute: down at its fall speed
run(Math.round(3 / SERVER_DT), () => A.input(0, 0, 0));
const y0 = fl.y;
const t0 = fl.t;
run(Math.round(10 / SERVER_DT), () => A.input(0, 0, 0));
const fall = (y0 - fl.y) / (fl.t - t0);
check('drifts down under its chute at its fall speed', Math.abs(fall - SKYFLARE.fall) < 0.08, `${fall.toFixed(2)} m/s (${SKYFLARE.fall})`);
const p = flarePos(f, fl.t, {});
check('the server flies it where the closed form puts it', Math.hypot(p.x - fl.x, p.y - fl.y, p.z - fl.z) < 1e-6);
// (an 86 degree shot carries the flare a dozen metres out before the chute opens; past that only the drift and the sway)
const drift = Math.hypot(fl.x - s.x, fl.z - s.z);
const most = SKYFLARE.speed * Math.cos(UP) * (f.tOpen + SKYFLARE.catch) + SKYFLARE.drift * (fl.t - f.tOpen) + SKYFLARE.sway + 0.5;
check('and it has drifted no further than its shot, the air and its swing take it', drift < most, `${drift.toFixed(1)} m from under the gun (at most ${most.toFixed(1)})`);

// the far survivor has it too, though nothing else around Alice reaches Bob
const be = B.store.ents.get(fl.id);
check('a survivor 300 m off sees it', !!be && be.kind === ENT.PROJECTILE && be.ptype === PROJ.SKYFLARE, be ? '' : 'not in their snapshot');
const near = game.zm.spawn(ZTYPE.WALKER, s.x + 6, s.z + 6);
run(2, () => A.input(0, 0, 0));
check('...while the dead around the shooter stay out of it (area of interest still holds)', !!near && !B.store.ents.has(near.id) && A.store.ents.has(near.id));
game.combat.damageZombie(near, 1e6, null, {});

// it burns its minute out in the air
let lowest = 1e9;
run(Math.round((SKYFLARE.burn - fl.t - 0.5) / SERVER_DT), () => {
  A.input(0, 0, 0);
  lowest = Math.min(lowest, fl.y);
});
check('still burning half a second before its minute is up, and still in the air', skyflares().includes(fl) && !f.landed && lowest - ground > 3, `${(lowest - ground).toFixed(1)} m up`);
run(Math.round(1 / SERVER_DT), () => A.input(0, 0, 0));
check('burnt out at its minute', !skyflares().includes(fl) && fl.removed !== false);
run(2, () => A.input(0, 0, 0));
check('...and gone from the far survivor too', !B.store.ents.has(fl.id));

// ---------------------------------------------------------------- fired flat
const FLAT = -0.02;
run(1, () => A.input(BTN.ATTACK, 0, FLAT));
run(1, () => A.input(0, 0, FLAT));
fl = skyflares()[0];
check('a second shot', !!fl);
run(Math.round(5 / SERVER_DT), () => A.input(0, 0, FLAT));
const land = Math.hypot(fl.x - s.x, fl.z - s.z);
const g2 = w.floorAt(fl.x, fl.z, fl.y + 1);
check('fired flat it comes down out in front', fl.flare.landed && land > 8 && land < 45 && fl.y - g2 < 0.2, `${land.toFixed(1)} m out, ${(fl.y - g2).toFixed(2)} m over the floor`);
const lx = fl.x;
const lz = fl.z;
run(Math.round(40 / SERVER_DT), () => A.input(0, 0, 0));
check('and burns on the ground where it lies', skyflares().includes(fl) && fl.x === lx && fl.z === lz);
run(Math.round(16 / SERVER_DT), () => A.input(0, 0, 0));
check('out at its minute', !skyflares().includes(fl));

// ---------------------------------------------------------------- the night: what its light pins
for (const z of game.zombies) game.combat.damageZombie(z, 1e6, null, {});
game.startNight();
game.timeLeft += 600;
run(4, () => A.input(0, 0, 0));
for (const z of game.zombies) {
  z.dead = true;
  z.deadT = 2;
}
run(4, () => A.input(0, 0, 0));
check('night', game.phase === PHASE.NIGHT);
// a flare in the air at 60 m right over the shooter, chute open (put there by hand: the same flight)
const hang = (x, y, z) => {
  const e = game.combat.spawnProjectile(PROJ.SKYFLARE, a, x, y, z, 0, 0, 0, { grav: 0 });
  e.flare = launchFlare(x, y, z, 0, 1, 0, 1);
  e.flare.vy = 0; // (no climb: it opens where it is)
  e.flare.tOpen = SKYFLARE.openMin;
  e.everywhere = true;
  return e;
};
// two shades stood still in the dark on the ground: one 30 m out from under where the flare will be, one 55 m out
const inR = game.zm.spawn(ZTYPE.SHADE, s.x + 30, s.z, { horde: true });
const outR = game.zm.spawn(ZTYPE.SHADE, s.x - 55, s.z, { horde: true });
run(6, () => A.input(0, 0, 0));
check('in the dark neither is lit', inR && outR && !inR.lit && !outR.lit);
const h = hang(s.x, ground + 60, s.z);
run(Math.round((SKYFLARE.openMin + 0.6) / SERVER_DT), () => A.input(0, 0, 0));
const lit30 = inR.lit;
const lit55 = outR.lit;
check(`a flare 60 m up pins a Shade 30 m out from under it`, lit30, `(reach ${SKYFLARE.reach} m)`);
check(`...but not one 55 m out`, !lit55);
const ix = inR.x;
const iz = inR.z;
run(20, () => A.input(0, 0, 0));
check('the pinned one stays where it is', Math.hypot(inR.x - ix, inR.z - iz) < 0.01);
game.projectiles.splice(game.projectiles.indexOf(h), 1);
game.removeEntity(h);
run(4, () => A.input(0, 0, 0));
check('with the flare gone it is free again', !inR.lit);

console.log(fails.length ? `\nFAILED: ${fails.length} check(s): ${fails.join('; ')}` : '\nall flare gun checks passed');
process.exit(fails.length ? 1 : 0);
