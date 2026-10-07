// Seats for everybody, soon after the team comes off the bridge: on a mainland seed, with a team of n, how long a
// team that plays sensibly takes until every survivor sits in a vehicle that runs. The real server in-process, the
// survivors moved by their own commands: the first four walk to the car they crossed in; each of the rest walks to
// the nearest of the bridgehead's vehicles that still has a seat - whoever gets there first holds [E] until it
// runs, and gets on; the others get on behind. The dead are kept off (this times the walking and the work, not a fight).
//   node scripts/vehicle-seats.js [seeds=24] [--sizes 1,2,4,8,16] [--first 1]
// Exports seatsFor(seed, sizes) and the bot client for scripts/test-vehicles.js.
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, VACT, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE } from '../shared/constants.js';
import { ITEM, AMMO } from '../shared/defs.js';
import { VSTATE, VEHICLES } from '../shared/vehicles.js';
import { readSnapshot } from '../client/net/decode.js';

const SEC = SERVER_TICK_RATE;

// a client that takes what the server sends as the real one does, and plays without predicting
export function client(game, name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, seq: 0, notes: [] };
  const nop = () => {};
  c.handler = new Proxy({ notify: (msg, arg) => c.notes.push([msg, arg]) }, { get: (t, k) => t[k] || nop });
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) {
        readSnapshot(r, c);
        if (r.left) throw new Error(`${name}: ${r.left} trailing snapshot bytes`);
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
  c.act = (act, ...v) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    if (act === ACT.VEHICLE) {
      w2.u8(v[0]);
      w2.u16(v[1] || 0);
    } else if (act === ACT.HOLD_BEGIN || act === ACT.INTERACT) w2.u16(v[0]);
    else if (act === ACT.SIPHON) {
      w2.i16(v[0]);
      w2.i16(v[1]);
    } else if (v[0] !== undefined) w2.u8(v[0]);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.input = (buttons = 0, yaw = 0, pitch = 0) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(yaw), qpitch: qpitch(pitch), slot: 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.ent = (id) => c.store.ents.get(id);
  return c;
}

// a game on the mainland of this seed with n survivors in it, the dead cleared off and kept off
export function mainlandGame(seed, n, opts = {}) {
  const game = new Game({ seed, godMode: true, dayLength: 36000, themes: false, maxPlayers: Math.max(8, n), log: () => {}, ...opts });
  const cs = [];
  for (let i = 0; i < n; i++) cs.push(client(game, `bot${i}`));
  game.update();
  game.debugCommand(cs[0].p(), ['map2']);
  game.update();
  quiet(game);
  return { game, cs };
}
export function quiet(game) {
  for (const z of [...game.zombies]) game.removeEntity(z);
  game.zombies.length = 0;
  game.zm.maintainT = 1e9;
}

// The scripted team (see the head). Returns { first: s until somebody sits in one that runs, all: s until everybody
// does (Infinity: not within `limit`), seats: [who sat where] }
export function playSeats(game, cs, limit = 300) {
  const V = game.vehicles;
  const yawTo = (s, x, z) => Math.atan2(-(x - s.x), -(z - s.z));
  const plan = cs.map(() => ({ e: null, stuckT: 0, lastD: 1e9, side: 1, sideT: 0, held: false, poured: false }));
  const runs = (e) => e.state === VSTATE.OK;
  const claimed = new Map(); // vehicle -> how many are headed for it
  const pick = (c) => {
    const s = c.p().state;
    let best = null, bd = 1e9;
    for (const e of V.list) {
      if (e.state === VSTATE.WRECK || e.state === VSTATE.DEAD) continue;
      if (!e.quest && !e.starter) continue;
      const P = VEHICLES[e.vk];
      if ((claimed.get(e) || 0) >= P.seats.length) continue;
      // (one that runs already is worth a longer walk than one that wants work)
      const d = Math.hypot(e.x - s.x, e.z - s.z) + (runs(e) ? 0 : 25);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) claimed.set(best, (claimed.get(best) || 0) + 1);
    return best;
  };
  cs.forEach((c, i) => (plan[i].e = pick(c)));
  let first = Infinity;
  for (let tick = 0; tick < limit * SEC; tick++) {
    let seated = 0;
    cs.forEach((c, i) => {
      const p = c.p();
      const s = p.state;
      const pl = plan[i];
      if (s.drive || s.pass) {
        seated++;
        const e = V.of(p);
        if (e && runs(e) && first === Infinity) first = tick / SEC;
        return c.input(0, s.yaw);
      }
      const e = pl.e;
      if (!e) return c.input(0, s.yaw);
      // what to walk to: the scrap beside one that does not run (whoever is nearest fetches it), else the vehicle
      let tx = e.x, tz = e.z, reach = VEHICLES[e.vk].half + 1.6;
      if (!runs(e)) {
        const need = game.vehicles.job(p, e);
        if (typeof need === 'number') {
          let it = null, bd = 1e9;
          for (const item of game.items) {
            if (item.item !== ITEM.SCRAP) continue;
            if (Math.hypot(item.x - e.x, item.z - e.z) > 4) continue;
            if (item.item === ITEM.AMMO_FUEL && s.ammo[AMMO.FUEL] > 0) continue;
            const d = Math.hypot(item.x - s.x, item.z - s.z);
            if (d < bd) (bd = d), (it = item);
          }
          if (it) (tx = it.x), (tz = it.z), (reach = 0.6);
        } else if (V.near(p, e)) {
          if (!p.hold) c.act(ACT.HOLD_BEGIN, e.id);
          return c.input(0, yawTo(s, e.x, e.z));
        }
      } else if (V.near(p, e)) {
        // it runs: a pour of fuel if we carry any and it is not full, then on
        const P = VEHICLES[e.vk];
        if (P.tank && s.ammo[AMMO.FUEL] > 0 && e.fuel < P.tank - 1 && !pl.poured) {
          if (!p.hold) {
            if (pl.held) pl.poured = true;
            else c.act(ACT.HOLD_BEGIN, e.id);
            pl.held = true;
          }
          return c.input(0, yawTo(s, e.x, e.z));
        }
        c.act(ACT.VEHICLE, VACT.ENTER, e.id);
        return c.input(0, yawTo(s, e.x, e.z));
      }
      const d = Math.hypot(tx - s.x, tz - s.z);
      if (d < reach && runs(e)) return c.input(0, yawTo(s, tx, tz));
      // held up by something: round it, one side then the other
      if (tick % SEC === 0) {
        if (d > pl.lastD - 0.6) pl.stuckT++;
        else pl.stuckT = 0;
        pl.lastD = d;
        if (pl.stuckT >= 2) {
          pl.side = -pl.side;
          pl.sideT = SEC * 1.2;
          pl.stuckT = 0;
        }
      }
      let b = BTN.FWD | (s.exhausted ? 0 : BTN.SPRINT);
      if (pl.sideT > 0) {
        pl.sideT--;
        b = (pl.side > 0 ? BTN.RIGHT : BTN.LEFT) | BTN.FWD;
      }
      c.input(b, yawTo(s, tx, tz));
    });
    if (seated === cs.length) return { first, all: tick / SEC };
    game.update();
  }
  return { first, all: Infinity };
}

// The same game again as the team of the first n of its survivors has just come off the bridge: the vehicles as the
// map is stocked for that many, the rest of the survivors out of the way.
export function arriveAs(game, cs, n) {
  for (const p of game.players.values()) game.vehicles.drop(p);
  for (const e of [...game.vehicles.list]) game.removeEntity(e);
  game.vehicles.clear();
  for (const it of [...game.items]) if (it.despawnAt > game.time + 1e5) game.removeItemEnt(it);
  cs.forEach((c, i) => {
    const p = c.p();
    const s = p.state;
    p.hold = null;
    s.ammo[AMMO.FUEL] = 0;
    for (let k = 0; k < p.inv.length; k++) if (p.inv[k] && p.inv[k].item === ITEM.SCRAP) p.inv[k] = null;
    game.putAtStart(s);
    if (i >= n) s.x += 400; // (not of this team: far off)
    s.vx = s.vy = s.vz = 0;
    game.fillHistory(p);
  });
  game.vehicles.spawn(n);
}

// seed -> { [n]: { first, all } } for each team size (one game, the team arriving again as each size)
export function seatsFor(seed, sizes = [1, 2, 4, 8, 16]) {
  const out = {};
  const { game, cs } = mainlandGame(seed, Math.max(...sizes));
  for (const n of sizes) {
    arriveAs(game, cs, n);
    out[n] = { ...playSeats(game, cs.slice(0, n)), vehicles: game.vehicles.list.filter((e) => e.quest || e.starter).map((e) => VEHICLES[e.vk].name) };
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('vehicle-seats.js')) {
  const nSeeds = +(process.argv[2] || 24);
  const sizesArg = process.argv.indexOf('--sizes');
  const sizes = sizesArg > 0 ? process.argv[sizesArg + 1].split(',').map(Number) : [1, 2, 4, 8, 16];
  const firstArg = process.argv.indexOf('--first');
  const seed0 = firstArg > 0 ? +process.argv[firstArg + 1] : 1;
  const rows = [];
  for (let seed = seed0; seed < seed0 + nSeeds; seed++) {
    const r = seatsFor(seed, sizes);
    rows.push(r);
    console.log(`seed ${String(seed).padStart(3)}  ` + sizes.map((n) => `${n}: first ${r[n].first.toFixed(0)} s, all ${r[n].all.toFixed(0)} s`).join('   '));
  }
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log('\nteam   first vehicle (median / worst)   seats for all (median / worst)   what stands at the bridgehead');
  for (const n of sizes) {
    const f = rows.map((r) => r[n].first), a = rows.map((r) => r[n].all);
    console.log(`${String(n).padStart(4)}   ${med(f).toFixed(0).padStart(6)} s / ${Math.max(...f).toFixed(0).padStart(3)} s            ${med(a).toFixed(0).padStart(6)} s / ${Math.max(...a).toFixed(0).padStart(3)} s            car (the team's) + ${rows[0][n].vehicles.slice(1).join(', ') || '-'}`);
  }
}
