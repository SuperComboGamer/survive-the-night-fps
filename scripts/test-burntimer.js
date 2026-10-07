// A torch's and a campfire's time left to burn (SF.BURN), against a real Game in-process with a survivor joined as a
// client joins. The server sends the tick a fire burns out at, not the seconds left, so a burning fire costs nothing on
// the wire until it is fed or relit: that tick must hold still while it burns, move by what the fire was fed, and the
// count the client makes from it must read the seconds the server has left.
// usage: node scripts/test-burntimer.js [seed]
import { Game } from '../server/game.js';
import { C2S, PROTOCOL_VERSION, Writer } from '../shared/protocol.js';
import { SERVER_TICK_RATE, SLOT_BUILD } from '../shared/constants.js';
import { STRUCT, STRUCT_DEFS, ITEM, CAMPFIRE_FUEL } from '../shared/defs.js';
import { addItem } from '../server/inventory.js';

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

const game = new Game({ seed, themes: false, log: () => {} });
const session = game.onOpen({ send() {} });
{
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('Alice');
  game.onMessage(session, w.bytes().slice());
}
const p = [...game.players.values()][0];
const s = p.state;
s.slot = SLOT_BUILD;
addItem(p.inv, ITEM.TORCH, 2);
addItem(p.inv, ITEM.STICK, 8);
addItem(p.inv, ITEM.WOOD, 4);
// set down within reach, on the first spot round the survivor that is clear (the car, a wall, the other one)
const built = (type) => {
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    p.actionT = -1;
    game.build(p, type, s.x + Math.sin(a) * 3, s.z + Math.cos(a) * 3, 0);
    const e = game.structures.find((st) => st.stype === type);
    if (e) return e;
  }
  return null;
};
const torch = built(STRUCT.TORCH);
const fire = built(STRUCT.CAMPFIRE);
check('a torch and a campfire are built', !!torch && !!fire);

// what the snapshot sends (server/snapshot.js quant), and what the client makes of it (Game.burnLeft)
const sent = (e) => (e.burnLeft > 0 ? (game.tick + Math.round(e.burnLeft * SERVER_TICK_RATE)) & 0xffff || 1 : 0);
const read = (v, tick) => {
  if (!v) return 0;
  const left = (v - tick) & 0xffff;
  return left > 0xf000 ? 0 : left / SERVER_TICK_RATE;
};
const run = (ticks) => {
  for (let i = 0; i < ticks; i++) game.update();
};

{
  const t0 = sent(torch);
  const f0 = sent(fire);
  run(200);
  check('while they burn, the tick each burns out at holds still (nothing to send)', sent(torch) === t0 && sent(fire) === f0, `${t0} ${sent(torch)} / ${f0} ${sent(fire)}`);
  const left = read(sent(torch), game.tick);
  check("the client's count is the torch's time left", Math.abs(left - torch.burnLeft) < 0.06, `${left.toFixed(2)} s, server ${torch.burnLeft.toFixed(2)} s`);
  check('...10 s gone of its 6 minutes', Math.abs(left - (STRUCT_DEFS[STRUCT.TORCH].burn - 200 / SERVER_TICK_RATE)) < 0.06);
}

{
  const f0 = sent(fire);
  const was = fire.burnLeft;
  p.actionT = -1;
  game.feedFire(p, fire);
  const f1 = sent(fire);
  check('fed a plank, the campfire burns 70 s longer', ((f1 - f0) & 0xffff) === CAMPFIRE_FUEL[ITEM.WOOD] * SERVER_TICK_RATE && Math.abs(fire.burnLeft - was - CAMPFIRE_FUEL[ITEM.WOOD]) < 1e-6, `${(f1 - f0) & 0xffff} ticks`);
}

{
  // burnt out: 0 on the wire, and "out" on the client
  torch.burnLeft = 0.5;
  run(Math.ceil(SERVER_TICK_RATE * 0.6));
  check('a burnt-out torch sends 0', sent(torch) === 0 && torch.state === 0);
  check('...which the client reads as out', read(0, game.tick) === 0);
  // the count across the 16-bit wrap of the tick
  check('the count holds across the wrap of the 16-bit tick', Math.abs(read((65530 + 400) & 0xffff, 65530) - 20) < 1e-9);
  check('...and a fire just gone out reads 0, not 54 minutes', read((65530 - 3) & 0xffff, 65530) === 0);
}

if (fails.length) {
  console.log(`\n${fails.length} FAILED`);
  process.exit(1);
}
console.log('\nall passed');
process.exit(0);
