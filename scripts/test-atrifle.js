// The anti-tank rifle (ITEM.AT_RIFLE): one round, a very long reload, made for the big ones. In-process against a real
// Game, its shots fired as Combat.fire is handed them:
//   - the row itself: one round a magazine, the longest reload of any gun, re-loads by itself, its own calibre, a
//     workbench recipe behind the Rifle Schematic, and somewhere to find it
//   - the simulation: a shot empties it, the reload starts by itself and takes the whole of it, one round comes out
//     of the reserve; with none left it only clicks
//   - a boss or a Tank takes bossMul x the round (a head shot on top of that), a rank-and-file zombie the round as it
//     is, and the round goes through five in a line, losing some with each
// usage: node scripts/test-atrifle.js [seed = 1]
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { ITEM, ITEM_DEFS, WEAPONS, AMMO, AMMO_ITEMS, RECIPES, LOOT_TABLES, CONT_TABLES, ZONE, ZTYPE, ZOMBIE_DEFS, SOUND, loadedAmmo } from '../shared/defs.js';
import { BTN, CMD_DT, SLOT_PRIMARY } from '../shared/constants.js';
import { createPlayerState, simulatePlayer } from '../shared/playersim.js';

const seed = +(process.argv[2] || 1);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

const AT = WEAPONS[ITEM.AT_RIFLE];

// ---------------------------------------------------------------- the row
{
  const guns = Object.entries(WEAPONS).filter(([, w]) => !w.melee);
  const longest = Math.max(...guns.filter(([id]) => +id !== ITEM.AT_RIFLE).map(([, w]) => (w.reloadEach ? w.reload * w.mag : w.reload)));
  check('one round to a magazine, and the longest reload of any gun', AT.mag === 1 && AT.slot === SLOT_PRIMARY && AT.reload > longest && AT.autoReload, `${AT.reload} s against ${longest} s`);
  const ammoItem = AMMO_ITEMS[AT.ammo];
  check('its own calibre', ammoItem === ITEM.AMMO_145 && ITEM_DEFS[ammoItem].ammo === AT.ammo && guns.filter(([, w]) => w.ammo === AT.ammo).length === 1);
  check('hits the big ones harder, and goes through a line', AT.bossMul > 1 && AT.pierce >= 3 && !AT.flame && !AT.rocket && AT.pellets === 1);
  check('the loudest gun there is', guns.every(([id, w]) => +id === ITEM.AT_RIFLE || (w.noise || 0) < AT.noise), `${AT.noise} m`);
  const gun = RECIPES.find((r) => r.out === ITEM.AT_RIFLE);
  const rounds = RECIPES.find((r) => r.out === ITEM.AMMO_145);
  check('made at the workbench once the Rifle Schematic is found; its rounds there too', gun?.station === 'bench' && gun.schem === ITEM.SCHEM_RIFLE && rounds?.station === 'bench' && ITEM_DEFS[ITEM.SCHEM_RIFLE].desc.includes('Anti-Tank Rifle'));
  const found = (t) => t.some(([item]) => item === ITEM.AT_RIFLE);
  check('found in the army\'s places and its ammo crates, and in the mine\'s strongbox', found(LOOT_TABLES[ZONE.MILITARY]) && found(CONT_TABLES.military) && found(CONT_TABLES.strongbox));
  const la = loadedAmmo(ITEM.AT_RIFLE, 2);
  check('a loaded one out of the strongbox comes with two rounds', la && la[0] === ITEM.AMMO_145 && la[1] === 2);
  check('a sound of its own', SOUND.AT_RIFLE > 0 && SOUND.AT_RELOAD > 0 && SOUND.AT_RIFLE !== SOUND.RIFLE);
}

// ---------------------------------------------------------------- the game
const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });
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
// an open, flat stretch well away from everything: the survivor stands at one end (as test-bosses.js finds it)
const spot = (() => {
  const w = game.world;
  for (const c of w.hordeSpawns) {
    let ok = true;
    for (let d = -30; d <= 30 && ok; d += 3) {
      const h = w.heightAt(c.x + d, c.z);
      if (Math.abs(h - w.heightAt(c.x, c.z)) > 1.2 || w.isDeepWater(c.x + d, c.z) || game.nav.isBlocked(c.x + d, c.z)) ok = false;
    }
    if (ok) return c;
  }
  return w.car;
})();
clear();

// ---------------------------------------------------------------- the simulation: fire, the long reload, the reserve
{
  const s = createPlayerState();
  s.x = spot.x;
  s.z = spot.z;
  s.y = game.world.heightAt(s.x, s.z);
  s.weapons[SLOT_PRIMARY] = ITEM.AT_RIFLE;
  s.slot = SLOT_PRIMARY;
  s.mags[0] = 1;
  s.ammo[AMMO.R145] = 3;
  let seq = 0;
  const step = (buttons) => {
    const ev = [];
    simulatePlayer(s, { seq: seq++, buttons, yaw: 0, pitch: 0, slot: 255 }, game.world, ev);
    return ev;
  };
  for (let i = 0; i < 4; i++) step(0);
  const shot = step(BTN.ATTACK);
  let t = 0;
  let reloadAt = -1;
  let doneAt = -1;
  let reloadTime = 0;
  for (let i = 0; i < Math.ceil(12 / CMD_DT) && doneAt < 0; i++) {
    t += CMD_DT;
    for (const e of step(0)) {
      if (e.type === 'reload' && reloadAt < 0) {
        reloadAt = t;
        reloadTime = e.time;
      }
      if (e.type === 'reload_done') doneAt = t;
    }
    if (reloadAt >= 0 && doneAt < 0 && s.mags[0] !== 0) break;
  }
  check('a shot empties it', shot.some((e) => e.type === 'fire' && e.weapon === ITEM.AT_RIFLE) && (doneAt > 0 || s.mags[0] === 0));
  check('...the reload starts by itself once the shot is done', Math.abs(reloadAt - AT.rate) < 0.05, `at ${reloadAt.toFixed(2)} s`);
  check('...and takes the whole of it before there is a round in', reloadTime === AT.reload && Math.abs(doneAt - reloadAt - AT.reload) < 0.05 && s.mags[0] === 1 && s.ammo[AMMO.R145] === 2, `${(doneAt - reloadAt).toFixed(2)} s, mag ${s.mags[0]}, ${s.ammo[AMMO.R145]} left`);
  // with nothing left to load it does not try, and the trigger only clicks
  s.ammo[AMMO.R145] = 0;
  step(BTN.ATTACK);
  let reloads = 0;
  for (let i = 0; i < Math.ceil(3 / CMD_DT); i++) for (const e of step(0)) if (e.type === 'reload') reloads++;
  const dry = step(BTN.ATTACK);
  check('with no rounds left it does not reload, and only clicks', reloads === 0 && s.mags[0] === 0 && dry.some((e) => e.type === 'dry'));
}

// ---------------------------------------------------------------- the damage
const s = p.state;
s.x = spot.x;
s.z = spot.z;
s.y = game.world.heightAt(s.x, s.z);
const EYE = 1.62;
// one round at (x, y, z), straight from the survivor's eye; returns nothing, the zombies keep the score
const fire = (weapon, x, y, z) => {
  const oy = s.y + EYE;
  const dx = x - s.x;
  const dz = z - s.z;
  p.renderTick = game.tick & 0xffff;
  p.renderFrac = 0;
  game.combat.fire(p, { weapon, x: s.x, y: oy, z: s.z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(y - oy, Math.hypot(dx, dz)), recoilPitch: 0, spread: 0, seed: 1 });
};
const spawn = (type, dx, opts = {}) => game.zm.spawn(type, spot.x + dx, spot.z, opts);
const chest = (z) => z.y + z.def.height * 0.62;
const lost = (z, hp0) => (z.dead ? `dead (${hp0.toFixed(0)} hp)` : `${(hp0 - z.hp).toFixed(0)} of ${hp0.toFixed(0)} hp`);

// a boss in the body, then in the head; the hunting rifle against it for scale
{
  const z = spawn(ZTYPE.BOSS_ABOMINATION, 22, { horde: true, boss: true });
  let hp0 = z.hp;
  fire(ITEM.AT_RIFLE, z.x, chest(z), z.z);
  check('a boss takes bossMul x the round in the body', !z.dead && Math.abs(hp0 - z.hp - AT.damage * AT.bossMul) < 1e-6, lost(z, hp0));
  hp0 = z.hp;
  fire(ITEM.AT_RIFLE, z.x, z.y + z.def.headY, z.z);
  check('...and the boss head-shot multiplier on top of it in the head', Math.abs(hp0 - z.hp - AT.damage * AT.bossMul * 1.6) < 1e-6, lost(z, hp0));
  hp0 = z.hp;
  fire(ITEM.HUNTING_RIFLE, z.x, chest(z), z.z);
  check('...where a hunting rifle round is just itself', Math.abs(hp0 - z.hp - WEAPONS[ITEM.HUNTING_RIFLE].damage) < 1e-6, lost(z, hp0));
  clear();
}
// a Tank in the horde is not a boss, and it takes the same
{
  const z = spawn(ZTYPE.TANK, 18, { horde: true });
  const hp0 = z.hp;
  fire(ITEM.AT_RIFLE, z.x, chest(z), z.z);
  check('a Tank takes bossMul x the round, boss or not', !z.boss && Math.abs(hp0 - z.hp - AT.damage * AT.bossMul) < 1e-6, lost(z, hp0));
  clear();
}
// six walkers in a line: the round goes through five, losing some with each, and the sixth never feels it
{
  const line = [];
  for (let i = 0; i < 6; i++) line.push(spawn(ZTYPE.WALKER, 12 + i * 1.1, { horde: true }));
  const hp0 = line.map((z) => z.hp);
  const first = line[0];
  fire(ITEM.AT_RIFLE, first.x + 6, chest(first), first.z);
  let d = AT.damage;
  const want = line.map((z, i) => {
    const got = i < AT.pierce ? d : 0;
    d *= 0.7;
    return got;
  });
  const ok = line.every((z, i) => (want[i] >= hp0[i] ? z.dead : !z.dead && Math.abs(hp0[i] - z.hp - want[i]) < 1e-6));
  check('a rank-and-file zombie takes the round as it is, and it goes through five in a line', ok && line.filter((z) => z.dead).length >= 3 && line[5].hp === hp0[5], line.map((z, i) => lost(z, hp0[i])).join(', '));
  clear();
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
