// Salvage: a survivor tears something down for what it is made of (ACT.SALVAGE, the SALVAGE table in shared/defs.js).
// In-process checks against a real Game, with the packets written as Connection.action writes them: from the backpack
// (part of a stack, or a weapon with rounds in it), from a weapon slot, from what is worn; what cannot be torn down is
// refused; what does not fit lands at their feet; the table never gives back as much as a recipe takes; and the starting
// tools torn down are not handed out again by a reconnect.
// usage: node scripts/test-salvage.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, SALVAGE_FROM, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { INVENTORY_SIZE, SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE, SLOT_THROW, SLOT_BUILD } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, WEAPONS, RECIPES, SALVAGE, AMMO, AMMO_ITEMS } from '../shared/defs.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

function client(name) {
  const c = { name, id: 0, slots: [] };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.INVENTORY) {
        // (as Game.onInventory reads it, client/game/game.js)
        for (let i = 0; i < INVENTORY_SIZE; i++) {
          const item = r.u8();
          const count = r.u16();
          c.slots[i] = item ? { item, count } : null;
        }
      }
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  // ACT.SALVAGE as Connection.action writes it (client/net/connection.js): u8 from, u16 count
  c.salvage = (from, n = 1) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(ACT.SALVAGE);
    w2.u8(from);
    w2.u16(n);
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}

const has = (p, item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
const loose = (item) => game.items.filter((e) => e.item === item).reduce((n, e) => n + e.count, 0);
// the pack emptied but for these stacks ([item, count, mag])
const pack = (p, ...list) => {
  p.inv.fill(null);
  list.forEach(([item, count, mag], i) => (p.inv[i] = mag === undefined ? { item, count } : { item, count, mag }));
  p.invDirty = true;
};
const tick = (n = 2) => {
  for (let i = 0; i < n; i++) game.update();
};

const A = client('Alice');
const a = A.p();
const s = a.state;
tick();

// the table itself: what it lists can be torn down, what it gives cannot, and no round trip through a recipe gains
{
  const bad = [];
  for (const [id, gives] of Object.entries(SALVAGE)) {
    const name = ITEM_DEFS[id]?.name || id;
    const cat = ITEM_DEFS[id]?.cat;
    if (!cat || ['res', 'ammo', 'part', 'schem'].includes(cat)) bad.push(`${name} is a ${cat}`);
    for (const k in gives) {
      if (SALVAGE[k]) bad.push(`${name} gives ${ITEM_DEFS[k].name}, which comes apart again`);
      if (!(gives[k] >= 1) || gives[k] % 1) bad.push(`${name} gives ${gives[k]} ${ITEM_DEFS[k]?.name}`);
    }
    const rec = RECIPES.find((r) => r.out === +id);
    if (!rec) continue;
    let back = 0;
    let cost = 0;
    for (const k in rec.cost) cost += rec.cost[k] / rec.n;
    for (const k in gives) {
      back += gives[k];
      if (!rec.cost[k] || gives[k] > rec.cost[k] / rec.n) bad.push(`${name} gives back ${gives[k]} ${ITEM_DEFS[k].name}, its recipe takes ${(rec.cost[k] || 0) / rec.n}`);
    }
    if (back >= cost) bad.push(`${name} gives back ${back} of the ${cost} its recipe takes`);
  }
  const weapons = Object.keys(WEAPONS).filter((id) => !SALVAGE[id]);
  check('every salvage gives raw materials, never all a recipe takes, and every weapon comes apart', !bad.length && !weapons.length, [...bad, ...weapons.map((id) => `${ITEM_DEFS[id].name} cannot be salvaged`)].join('; '));
}

// the knife everyone starts with, from its slot
{
  pack(a);
  s.weapons[SLOT_MELEE] = ITEM.KNIFE;
  A.salvage(SALVAGE_FROM.WEAPON + SLOT_MELEE);
  tick();
  check('the knife in its slot comes apart into scrap and leather', s.weapons[SLOT_MELEE] === 0 && has(a, ITEM.SCRAP) === 1 && has(a, ITEM.LEATHER) === 1 && A.slots.some((x) => x && x.item === ITEM.LEATHER), `melee ${s.weapons[SLOT_MELEE]}, ${has(a, ITEM.SCRAP)} scrap, ${has(a, ITEM.LEATHER)} leather`);
}

// the pistol in its slot, loaded: its rounds go back into the reserve
{
  pack(a);
  s.weapons[SLOT_PISTOL] = ITEM.PISTOL;
  s.mags[1] = 9;
  const before = s.ammo[AMMO.P9];
  A.salvage(SALVAGE_FROM.WEAPON + SLOT_PISTOL);
  tick();
  check('a loaded pistol comes apart into gun parts and scrap, and its rounds go into the reserve', s.weapons[SLOT_PISTOL] === 0 && s.mags[1] === 0 && has(a, ITEM.GUNPARTS) === 1 && has(a, ITEM.SCRAP) === 1 && has(a, ITEM.AMMO_9MM) === 0 && s.ammo[AMMO.P9] === before + 9, `${has(a, ITEM.GUNPARTS)} parts, reserve ${before} -> ${s.ammo[AMMO.P9]}`);
}

// a rifle kept in the backpack, with rounds in it
{
  pack(a, [ITEM.BANDAGE, 1], [ITEM.AK47, 1, 17]);
  const before = s.ammo[AMMO.R762];
  A.salvage(1);
  tick();
  check('a rifle in the backpack comes apart, rounds and all, and its slot is free', !a.inv.some((x) => x && x.item === ITEM.AK47) && has(a, ITEM.GUNPARTS) === 2 && has(a, ITEM.SCRAP) === 2 && has(a, ITEM.WOOD) === 1 && s.ammo[AMMO.R762] === before + 17, `${a.inv.filter(Boolean).map((x) => `${ITEM_DEFS[x.item].name} ${x.count}`).join(', ')}; 7.62 ${before} -> ${s.ammo[AMMO.R762]}`);
}

// part of a stack
{
  pack(a, [ITEM.MEDKIT, 3]);
  A.salvage(0, 2);
  tick();
  check('two of a stack of three medkits come apart, one is left', has(a, ITEM.MEDKIT) === 1 && has(a, ITEM.CLOTH) === 2 && has(a, ITEM.HERB) === 2 && A.slots[0]?.item === ITEM.MEDKIT && A.slots[0]?.count === 1, `${has(a, ITEM.MEDKIT)} medkit, ${has(a, ITEM.CLOTH)} cloth, ${has(a, ITEM.HERB)} herbs`);
  A.salvage(0, 999);
  tick();
  check('...and asking for more than there is takes what there is', has(a, ITEM.MEDKIT) === 0 && has(a, ITEM.CLOTH) === 3 && has(a, ITEM.HERB) === 3);
}

// the armor worn
{
  pack(a);
  a.armorItem = ITEM.KEVLAR;
  a.armor = 40;
  a.armorMax = ITEM_DEFS[ITEM.KEVLAR].armor;
  A.salvage(SALVAGE_FROM.ARMOR);
  tick();
  check('the vest worn comes apart into a plate and cloth, and nothing is worn', a.armorItem === 0 && a.armor === 0 && has(a, ITEM.PLATE) === 1 && has(a, ITEM.CLOTH) === 2, `wearing ${a.armorItem}, ${has(a, ITEM.PLATE)} plate`);
}

// what cannot be torn down is left alone
{
  pack(a, [ITEM.WOOD, 5], [ITEM.NAILS, 30], [ITEM.SPARK_PLUGS, 1], [ITEM.TUNA, 2], [ITEM.MOLOTOV, 2]);
  s.weapons[SLOT_THROW] = ITEM.MOLOTOV;
  s.weapons[SLOT_BUILD] = ITEM.HAMMER;
  const before = JSON.stringify(a.inv);
  for (const from of [0, 1, 2, 3, 9, INVENTORY_SIZE, 200, SALVAGE_FROM.WEAPON + SLOT_THROW, SALVAGE_FROM.WEAPON + 5, SALVAGE_FROM.WEAPON + SLOT_PRIMARY, SALVAGE_FROM.ARMOR]) A.salvage(from);
  A.salvage(4, 0);
  tick();
  check('raw materials, car supplies, food, the throwable slot, empty slots and n = 0 are refused', JSON.stringify(a.inv) === before && s.weapons[SLOT_BUILD] === ITEM.HAMMER, a.inv.filter(Boolean).map((x) => `${ITEM_DEFS[x.item].name} ${x.count}`).join(', '));
  A.salvage(4);
  tick();
  check('...a molotov from the backpack is not', has(a, ITEM.MOLOTOV) === 1 && has(a, ITEM.ALCOHOL) === 1 && s.weapons[SLOT_THROW] === ITEM.MOLOTOV);
}

// no room in the pack: what comes of it lands at their feet
{
  pack(a, [ITEM.KNIFE, 1], ...Array.from({ length: INVENTORY_SIZE - 1 }, () => [ITEM.WOOD, 20]));
  const scrap = loose(ITEM.SCRAP);
  const leather = loose(ITEM.LEATHER);
  A.salvage(0);
  tick();
  // (the knife's own slot is free once it is torn down: the scrap goes in there, the leather on the ground)
  check('with the pack full, what does not fit lands at their feet', has(a, ITEM.SCRAP) === 1 && loose(ITEM.SCRAP) === scrap && loose(ITEM.LEATHER) === leather + 1, `${has(a, ITEM.SCRAP)} scrap in the pack, ${loose(ITEM.LEATHER) - leather} leather on the ground`);
}

// the downed cannot (nor the dead and player-zombies: handleAction turns them away before any of this)
{
  // (an action is handled as it arrives: no tick in between, which would see a half-made downed state through)
  pack(a, [ITEM.BANDAGE, 2]);
  a.downed = true;
  A.salvage(0);
  a.downed = false;
  check('a downed survivor cannot salvage', has(a, ITEM.BANDAGE) === 2 && has(a, ITEM.CLOTH) === 0, a.inv.filter(Boolean).map((x) => `${ITEM_DEFS[x.item].name} ${x.count}`).join(', '));
}

// a reconnect hands back the starting tools a leaver still had - and not one they tore down
{
  const C = client('Carl');
  tick();
  const c = C.p();
  c.state.mags[1] = 5;
  C.salvage(SALVAGE_FROM.WEAPON + SLOT_PISTOL);
  C.salvage(SALVAGE_FROM.WEAPON + SLOT_MELEE);
  tick();
  const parts = has(c, ITEM.GUNPARTS);
  game.onClose(C.session);
  tick();
  const B = client('Carl');
  tick();
  const b = B.p();
  check('a reconnect does not hand back the pistol and knife torn down, the hammer still comes back', parts === 1 && b.state.weapons[SLOT_PISTOL] === 0 && b.state.weapons[SLOT_MELEE] === 0 && b.state.weapons[SLOT_BUILD] === ITEM.HAMMER && has(b, ITEM.GUNPARTS) === 0, `weapons ${b.state.weapons.join()}`);
  // ...and one who left with them all gets them all
  game.onClose(B.session);
  const D = client('Dana');
  tick();
  game.onClose(D.session);
  tick();
  const E = client('Dana');
  tick();
  check('...one who left with all three gets all three', E.p().state.weapons.join() === [0, ITEM.PISTOL, ITEM.KNIFE, 0, ITEM.HAMMER].join(), `weapons ${E.p().state.weapons.join()}`);
  game.onClose(E.session);
}

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall salvage checks passed');
process.exit(fails.length ? 1 : 0);
