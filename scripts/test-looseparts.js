// Car supplies lying loose go out in the global state (global.parts), so the field map can mark one wherever the team
// is: items only replicate close by, and a supply never despawns. In-process checks against a real Game, the global
// state written as the server writes it and read with the client's decoder: none of the hidden ones is listed, one a
// survivor died carrying is, at the spot they fell, and the state is sent again at once; it goes from the list (and
// the state is sent again) when it is picked up; an ordinary item dropped the same way is never listed.
// usage: node scripts/test-looseparts.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { ITEM, ITEM_DEFS, KILLER } from '../shared/defs.js';
import { readGlobal } from '../client/net/decode.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

function join(name) {
  const c = { id: 0 };
  const session = game.onOpen({
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  });
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(session, w.bytes().slice());
  return game.players.get(c.id);
}

// the global state as a client reads it (writeGlobalFor's "all of it" byte, then writeGlobal)
const global = () => {
  const w = new Writer(256);
  w.u8(1);
  game.writeGlobal(w);
  const r = new Reader(w.bytes().slice().buffer);
  const g = readGlobal(r, null);
  if (r.left) throw new Error(`${r.left} trailing bytes in the global state`);
  return g;
};
const tick = (n = 2) => {
  for (let i = 0; i < n; i++) game.update();
};

const a = join('Alice');
const b = join('Bob'); // (alive, far off: with nobody left the game would be over)
tick();
const s = a.state;
b.state.x = s.x + 60;
b.state.z = s.z;

const hidden = game.items.filter((e) => ITEM_DEFS[e.item]?.cat === 'part');
check('the car supplies are out in their hiding places', hidden.length > 0 && hidden.every((e) => e.hint >= 0), `${hidden.length}`);
check('...and none of them is on the list: those are only rumoured', global().parts.length === 0, JSON.stringify(global().parts));

// died carrying one
a.inv.fill(null);
a.inv[0] = { item: ITEM.CAR_BATTERY, count: 1 };
a.inv[1] = { item: ITEM.BANDAGE, count: 2 };
a.invDirty = true;
const at = { x: s.x, z: s.z };
game.globalDirty = false;
game.killPlayer(a, { kind: KILLER.WORLD });
check('a survivor who dies with a car supply sends the global state again at once', game.globalDirty);
let parts = global().parts;
const p = parts[0];
check('the supply they carried is on the list', parts.length === 1 && p.item === ITEM.CAR_BATTERY, JSON.stringify(parts));
check('...where they fell', p && Math.hypot(p.x - at.x, p.z - at.z) < 4, p ? `${Math.hypot(p.x - at.x, p.z - at.z).toFixed(2)} m away` : '');
const ent = game.items.find((e) => e.item === ITEM.CAR_BATTERY && e.hint < 0);
check('...and it is the item lying there, which never despawns', ent && ent.despawnAt === Infinity && Math.abs(ent.x - p.x) < 0.05 && Math.abs(ent.z - p.z) < 0.05);
check('the bandages they dropped are not listed', game.items.some((e) => e.item === ITEM.BANDAGE) && !parts.some((q) => q.item === ITEM.BANDAGE));

// a minute later, still there
tick(20 * 60);
parts = global().parts;
check('it is still on the list a minute later', parts.length === 1 && parts[0].item === ITEM.CAR_BATTERY, JSON.stringify(parts));

// picked up
game.globalDirty = false;
game.removeItemEnt(ent);
check('picking it up sends the global state again at once', game.globalDirty);
check('...and it is gone from the list', global().parts.length === 0, JSON.stringify(global().parts));

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
