// Downed means downed: only a teammate holding [E] gets a survivor back up, never their own medkit. In-process checks
// against a real Game, with ACT.USE_ITEM written as Connection.action writes it (what [H] and a click in the backpack
// send): a downed survivor's medkit is turned down and kept, a medkit already in the hands when they go down is put
// away unused, the last one standing dies at 0 HP with a medkit in the pack as without one, and a team left all down
// is a game over whatever they carry.
// usage: node scripts/test-downed-medkit.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { SERVER_DT, PHASE } from '../shared/constants.js';
import { ITEM, CONSUMABLES, KILLER, useWasted } from '../shared/defs.js';

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

function client(game, name) {
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
const WORLD = { kind: KILLER.WORLD };
const medkitTicks = Math.ceil(CONSUMABLES[ITEM.MEDKIT].time / SERVER_DT) + 5;

// the rule both sides read (the client does not even ask)
check('a medkit while down is a use for nothing', useWasted(ITEM.MEDKIT, { hp: 0, maxHp: 100, battery: 100, downed: true, stamina: 50, exhausted: 0 }));
check('...one while hurt and standing is not', !useWasted(ITEM.MEDKIT, { hp: 40, maxHp: 100, battery: 100, downed: false, stamina: 50, exhausted: 0 }));

// down with a medkit in the pack: turned down, kept, still down
{
  const game = new Game({ seed, dayLength: 3600, log: () => {} });
  const tick = (n = 2) => {
    for (let i = 0; i < n; i++) game.update();
  };
  const A = client(game, 'Ann');
  const B = client(game, 'Ben');
  const a = A.p();
  tick();
  pack(a, [ITEM.MEDKIT, 2]);
  game.damagePlayer(a, 999, WORLD);
  check('Ann goes down while Ben still stands', a.alive && a.downed, `alive ${a.alive} downed ${a.downed}`);
  A.use(0);
  check('her medkit is turned down', !a.useItem && !a.state.using);
  tick(medkitTicks);
  check('...she is still down', a.alive && a.downed && a.hp === 0, `hp ${a.hp}`);
  check('...and both medkits are still in her pack', has(a, ITEM.MEDKIT) === 2, `${has(a, ITEM.MEDKIT)} left`);
  check('the game goes on while Ben stands', game.phase === PHASE.DAY);

  // a teammate still gets her up
  game.revive(a, B.p());
  check('Ben can still revive her', a.alive && !a.downed && a.hp > 0, `hp ${a.hp}`);

  // a medkit in the hands when she goes down: put away, not finished
  a.hp = 30;
  A.use(0);
  tick(2);
  check('hurt and standing, she starts on a medkit', a.useItem?.item === ITEM.MEDKIT);
  game.damagePlayer(a, 999, WORLD);
  check('down in the middle of it, it leaves her hands', a.downed && !a.useItem && !a.state.using);
  tick(medkitTicks);
  check('...and it never finishes: still down, medkit kept', a.downed && has(a, ITEM.MEDKIT) === 2, `downed ${a.downed}, ${has(a, ITEM.MEDKIT)} left`);

  // Ben, the last one standing, carries a medkit: it no longer keeps him from dying, nor the game from ending
  const b = B.p();
  pack(b, [ITEM.MEDKIT, 3]);
  game.damagePlayer(b, 999, WORLD);
  check('the last one standing dies at 0 HP, medkit or not', !b.alive && !b.downed, `alive ${b.alive} downed ${b.downed}`);
  check('...and with nobody left standing it is a game over (Ann had medkits too)', game.phase === PHASE.GAMEOVER, `phase ${game.phase}`);
}

// a lone survivor with a medkit: dead, not down
{
  const game = new Game({ seed, dayLength: 3600, log: () => {} });
  const C = client(game, 'Cy');
  const c = C.p();
  game.update();
  pack(c, [ITEM.MEDKIT, 1]);
  game.damagePlayer(c, 999, WORLD);
  check('a lone survivor with a medkit dies at 0 HP rather than going down', !c.alive && !c.downed);
  check('...a game over', game.phase === PHASE.GAMEOVER, `phase ${game.phase}`);
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
