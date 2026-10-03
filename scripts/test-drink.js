// Energy drinks: a can from the backpack (ACT.USE_ITEM, what [B] sends: Game.quickDrink) refills stamina. In-process
// checks against a real Game, with the packets written as Connection.action writes them: a spent survivor is topped
// up and no longer exhausted once the drink is down, one can goes, the crack is heard by the survivors around but not
// sent back to the drinker (who heard their own at once), a full survivor is turned down and keeps the can, a downed
// one too; and the can is somewhere to be found.
// usage: node scripts/test-drink.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { SERVER_DT, STAMINA_MAX } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, CONSUMABLES, LOOT_TABLES, CONT_TABLES, SOUND, EVT } from '../shared/defs.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

function client(name) {
  const c = { name, id: 0 };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  // ACT.USE_ITEM as Connection.action writes it (client/net/connection.js): u8 backpack slot
  c.use = (idx) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(ACT.USE_ITEM);
    w2.u8(idx);
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}

const has = (p, item) => p.inv.reduce((n, x) => n + (x && x.item === item ? x.count : 0), 0);
const pack = (p, ...list) => {
  p.inv.fill(null);
  list.forEach(([item, count], i) => (p.inv[i] = { item, count }));
  p.invDirty = true;
};
const tick = (n = 2) => {
  for (let i = 0; i < n; i++) game.update();
};
// the drink sounds queued for this tick: who is left out of each
const drinkSounds = () => game.events.filter((e) => e.bytes[0] === EVT.SOUND && e.bytes[1] === SOUND.DRINK);

const A = client('Alice');
const B = client('Bob');
const a = A.p();
const b = B.p();
const s = a.state;
tick();
b.state.x = s.x + 2;
b.state.z = s.z;

// the item itself
{
  const def = ITEM_DEFS[ITEM.ENERGY_DRINK];
  const c = CONSUMABLES[ITEM.ENERGY_DRINK];
  check('an energy drink is a consumable that refills stamina and heals nothing', def?.cat === 'cons' && c?.stamina >= STAMINA_MAX && !c.heal, JSON.stringify(c));
  check('it goes down in under a second', c.time < 1, `${c.time}s`);
  const places = Object.values(LOOT_TABLES).filter((t) => t.some((row) => row[0] === ITEM.ENERGY_DRINK)).length;
  const conts = Object.keys(CONT_TABLES).filter((k) => CONT_TABLES[k].some((row) => row[0] === ITEM.ENERGY_DRINK));
  check('it can be found lying about in several places and in containers', places >= 5 && conts.length >= 2, `${places} places · ${conts.join(', ')}`);
}

// spent, and topped up
{
  pack(a, [ITEM.ENERGY_DRINK, 2]);
  s.stamina = 4;
  s.exhausted = 1;
  game.events.length = 0;
  A.use(0);
  check('a spent survivor starts drinking', a.useItem?.item === ITEM.ENERGY_DRINK);
  const snd = drinkSounds();
  check('the can is heard cracking as the drink starts, by everyone but the drinker', snd.length === 1 && snd[0].except === a.id, `${snd.length} sound(s), except ${snd[0]?.except}`);
  tick(Math.ceil(CONSUMABLES[ITEM.ENERGY_DRINK].time / SERVER_DT) + 1);
  check('once it is down stamina is full', s.stamina === STAMINA_MAX, `${s.stamina}`);
  check('...and they are no longer exhausted', !s.exhausted);
  check('one can is gone', has(a, ITEM.ENERGY_DRINK) === 1, `${has(a, ITEM.ENERGY_DRINK)} left`);
  check('the drink is over', !a.useItem);
}

// half spent: topped up all the same
{
  s.stamina = 55;
  s.exhausted = 0;
  A.use(0);
  tick(Math.ceil(CONSUMABLES[ITEM.ENERGY_DRINK].time / SERVER_DT) + 1);
  check('a half-spent survivor is topped up too', s.stamina === STAMINA_MAX && has(a, ITEM.ENERGY_DRINK) === 0, `${s.stamina}, ${has(a, ITEM.ENERGY_DRINK)} left`);
}

// full: turned down, the can kept
{
  pack(a, [ITEM.ENERGY_DRINK, 1]);
  s.stamina = STAMINA_MAX;
  s.exhausted = 0;
  game.events.length = 0;
  A.use(0);
  check('a survivor at full stamina is turned down', !a.useItem && drinkSounds().length === 0);
  tick(Math.ceil(CONSUMABLES[ITEM.ENERGY_DRINK].time / SERVER_DT) + 1);
  check('...and keeps the can', has(a, ITEM.ENERGY_DRINK) === 1);
}

// downed: only a medkit is any use
{
  s.stamina = 10;
  a.downed = true;
  A.use(0);
  check('a downed survivor cannot drink one', !a.useItem && has(a, ITEM.ENERGY_DRINK) === 1);
  a.downed = false;
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
