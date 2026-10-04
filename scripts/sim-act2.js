// The two-act run (issue #111, shared/acts.js), played through on the Game itself with fake connections that read
// what they are sent with the client's own decoders:
//   the car's final stand -> driving off is the crossing, not the victory -> the mainland is built behind the
//   cutscene -> everybody arrives with what they carried -> the dead come back at the checkpoint -> the bridgehead
//   cache makes up the floor and nothing more -> the plane's parts are at their set places, are found and fitted ->
//   the runway stand: the fuel truck, then the plane, then a runway to keep clear -> the take-off is the victory
// and round it: a wipe on the mainland starts again from the bridge, a late joiner lands in the act being played,
// a dropped player and a deploy both get across the crossing, and the mainland's nights have the late bosses.
// It ends with what a tick costs with a night's horde up on each of the two maps.
process.env.REJOIN_GRACE_SECONDS = '600';
const { Game } = await import('../server/game.js');
const { C2S, S2C, ACT, CAR_ID, HOLD, SNAP, PROTOCOL_VERSION, Writer, Reader, qpos, dqpos, usePos, POS_SCALE, POS_SCALE_WIDE } = await import('../shared/protocol.js');
const { PHASE, ESCAPE_DRIVE_TIME, ENGINE_START_TIME, GAME_OVER_DELAY, SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE, SLOT_BUILD, dayLength, MAP_SIZE } = await import('../shared/constants.js');
const { ITEM, WEAPONS, AMMO, AMMO_ITEMS, ZTYPE, ZONE, NOTIFY, EVT, CACHE_GAVE, PLANE_PARTS, PLANE_NEED, SUPPLIES, ZOMBIE_DEFS } = await import('../shared/defs.js');
const { WORLD, MAINLAND_SIZE, CROSSING, TAKEOFF_TIME, RUNWAY, BRIDGEHEAD, ARRIVAL_DAY, MAINLAND_DAY_MORE, MAINLAND_NIGHT } = await import('../shared/acts.js');
const { nightBoss, nightTheme, MAINLAND_BOSSES, NIGHT_THEMES } = await import('../shared/nights.js');
const { readHeader, readGlobal, readSelf } = await import('../client/net/decode.js');
const { envelope, encode, decode } = await import('../server/handoff.js');
const { countItem } = await import('../server/inventory.js');
const { randomUUID } = await import('node:crypto');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const quiet = () => {};
const SEED = 4242;

// a client: what it is told, read as the client reads it (global state, own state, the notices among its events)
function client(game, name, pid = '') {
  const c = { id: 0, name, net: {}, global: null, notes: [], resets: [], welcome: null, self: { alive: 1, hp: 100, maxHp: 100, armor: 0, armorMax: 0, battery: 100, weapons: [0, 0, 0, 0, 0], mags: [0, 0], ammo: AMMO_ITEMS.map(() => 0) } };
  c.conn = {
    ip: name,
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) {
        c.id = r.u16();
        c.welcome = { seed: r.u32(), tick: r.u32(), rate: r.u8(), max: r.u8(), act: r.u8() };
      } else if (t === S2C.WORLD_RESET) c.resets.push({ seed: r.u32(), act: r.u8() });
      else if (t === S2C.SNAPSHOT) {
        const flags = readHeader(r, c.net);
        if (flags & SNAP.GLOBAL) c.global = readGlobal(r, c.global);
        readSelf(r, c.self, flags);
        // the notices: every event starts with its type, and a NOTIFY is u8 msg, u16 arg. They are looked for where the
        // entity sections end, which this reader does not parse - so by pattern from the events' count byte on
        if (flags & SNAP.EVENTS) c.raw = bytes.slice();
      }
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(pid);
  game.onMessage(c.session, w.bytes());
  c.p = () => game.players.get(c.id);
  c.act = (a, ...args) => {
    const m = new Writer(16);
    m.u8(C2S.ACTION);
    m.u8(a);
    for (const v of args) m.u16(v);
    game.onMessage(c.session, m.bytes());
  };
  return c;
}
// the notices a game sends, caught at the source (Game.notify): [msg, arg, to]
function notices(game) {
  const out = [];
  const notify = game.notify.bind(game);
  game.notify = (msg, arg = 0, to = 0) => {
    out.push([msg, arg, to]);
    return notify(msg, arg, to);
  };
  return out;
}
const ticks = (game, sec, each) => {
  for (let i = 0, n = Math.round(sec * 20); i < n; i++) {
    each?.();
    game.update();
  }
};
const put = (game, p, x, z) => {
  p.state.x = x;
  p.state.z = z;
  p.state.y = game.world.heightAt(x, z) + 0.05;
  p.state.vx = p.state.vy = p.state.vz = 0;
};
const kitOf = (p) => JSON.stringify({ w: p.state.weapons, m: p.state.mags, a: p.state.ammo, inv: p.inv, armor: [p.armorItem, p.armor, p.armorMax], pack: p.backpackItem });
const near = (p, at, r) => Math.hypot(p.state.x - at.x, p.state.z - at.z) <= r;

// ================================================================ the run
{
  const game = new Game({ seed: SEED, log: quiet, godMode: true, themes: false });
  const notes = notices(game);
  const ann = client(game, 'Ann', randomUUID());
  const ben = client(game, 'Ben', randomUUID());
  const cy = client(game, 'Cy', randomUUID());
  ticks(game, 1);
  check('a run begins on the island: act 1, 640 m, positions at 1/64 m', game.act === WORLD.ISLAND && game.world.kind === WORLD.ISLAND && game.world.size === MAP_SIZE && game.world.posScale === POS_SCALE && ann.welcome.act === 1 && ann.global.act === 1, `act ${game.act} size ${game.world.size}`);
  // Ann is well stocked, Ben has spent everything he had, Cy is dead and turned
  const a = ann.p();
  const b = ben.p();
  const c = cy.p();
  game.giveItem(a, ITEM.AK47, 1);
  game.giveItem(a, ITEM.AMMO_762, 120);
  game.giveItem(a, ITEM.MEDKIT, 2);
  game.giveItem(a, ITEM.SCRAP, 9);
  a.armorItem = ITEM.KEVLAR;
  a.armor = 77;
  a.armorMax = 120;
  a.backpackItem = ITEM.BACKPACK;
  a.perks = 5;
  b.state.weapons = [0, 0, 0, 0, 0];
  b.state.mags = [0, 0];
  b.state.ammo = b.state.ammo.map(() => 0);
  b.inv = b.inv.map(() => null);
  game.killPlayer(c, { kind: 3 });
  ticks(game, 12); // (it rises)
  check('one of the three is dead and turned before the car leaves', c.zombie && c.alive && game.humans().length === 2);
  const car = game.world.car;
  for (const p of [a, b]) put(game, p, car.x + 2, car.z + 2);
  game.supplies = [1, 1, 1, 1, 3];
  ann.act(ACT.HOLD_BEGIN, CAR_ID);
  ticks(game, ENGINE_START_TIME + 0.3);
  check("the car's final stand begins as it always has", game.escape.active && ann.global.finale && !ann.global.escapeReady, JSON.stringify(game.escape));
  game.escape.t = 0.2;
  ticks(game, 1);
  ann.act(ACT.HOLD_BEGIN, CAR_ID);
  const before = kitOf(a);
  const kills = a.kills;
  ticks(game, ESCAPE_DRIVE_TIME + 0.3);
  check('driving off is not the victory: it is the crossing', game.phase === PHASE.CROSSING && ann.global.phase === PHASE.CROSSING && notes.some((n) => n[0] === NOTIFY.CROSSING) && !notes.some((n) => n[0] === NOTIFY.VICTORY), `phase ${game.phase}`);
  check('...the island is still the world while the cutscene leaves it', game.act === WORLD.ISLAND && game.world.kind === WORLD.ISLAND && !ann.resets.length);
  // nobody acts during it
  const at0 = [a.state.x, a.state.z];
  ann.act(ACT.DROP_SLOT, 0, 0);
  ticks(game, 1);
  check('nobody acts while it plays', kitOf(a) === before && a.state.x === at0[0] && a.state.z === at0[1]);
  let built = null;
  ticks(game, CROSSING.SWAP + 1, () => {
    if (!built && game.world.kind === WORLD.MAINLAND) built = CROSSING.TIME - game.timeLeft;
  });
  check(`the mainland is built ${CROSSING.SWAP} s into it, behind the cut to black, and the clients are told first`, built !== null && Math.abs(built - CROSSING.SWAP) < 0.3 && ann.resets.length === 1 && ann.resets[0].act === WORLD.MAINLAND && ann.resets[0].seed === SEED >>> 0, `built at ${built}, resets ${JSON.stringify(ann.resets)}`);
  const w = game.world;
  check('...twice the island across, positions at 1/32 m', game.act === WORLD.MAINLAND && w.size === MAINLAND_SIZE && w.size === 2 * MAP_SIZE && w.half === MAINLAND_SIZE / 2 && w.posScale === POS_SCALE_WIDE && ann.global.act === WORLD.MAINLAND, `size ${w.size} scale ${w.posScale}`);
  {
    usePos(w);
    const far = [w.half - 3, -(w.half - 3), 0.33, -317.77];
    const err = Math.max(...far.map((v) => Math.abs(dqpos(qpos(v)) - v)));
    check("a position at the map's far corner goes over the wire and comes back within half a step", err <= 0.5 / POS_SCALE_WIDE + 1e-9 && qpos(w.half - 3) < 32767 && qpos(-(w.half - 3)) > -32768, `error ${err}`);
  }
  // skipping: everybody connected has to ask, and not before the clients have their mainland up
  ann.act(ACT.SKIP);
  ticks(game, 0.5);
  check('one vote does not skip it', game.phase === PHASE.CROSSING && ann.global.skips === 1 && ann.global.skipNeed === 3, `${ann.global.skips}/${ann.global.skipNeed}`);
  ben.act(ACT.SKIP);
  cy.act(ACT.SKIP);
  const elapsed = () => CROSSING.TIME - game.timeLeft;
  let skipped = 0;
  for (let i = 0; i < CROSSING.TIME * 20 && game.phase === PHASE.CROSSING; i++) {
    skipped = elapsed();
    game.update();
  }
  check(`every vote skips it, once it is ${CROSSING.SKIP_AFTER} s old`, game.phase === PHASE.DAY && skipped >= CROSSING.SKIP_AFTER - 0.2 && skipped < CROSSING.SKIP_AFTER + 1, `left the crossing ${skipped} s in, phase ${game.phase}`);
  ticks(game, 0.2);
  // ---- the arrival
  check('the team stands at the bridgehead', [a, b, c].every((p) => near(p, w.start, 16)) && w.zoneAt(a.state.x, a.state.z) === ZONE.BRIDGEHEAD, [a, b, c].map((p) => `${p.state.x | 0},${p.state.z | 0}`).join(' '));
  check('what a survivor carried came over with them: weapons, rounds, backpack, armour, perks, kills', kitOf(a) === before && a.perks === 5 && a.kills === kills, `${kitOf(a)}\n      ${before}`);
  check('...and a well-stocked one gets nothing from the bridgehead cache', !notes.some((n) => n[0] === NOTIFY.CACHE && n[2] === a.id));
  const floor = (p) => p.state.weapons[SLOT_PISTOL] === BRIDGEHEAD.PISTOL && p.state.mags[1] === WEAPONS[ITEM.PISTOL].mag && p.state.ammo[AMMO.P9] === Math.min(BRIDGEHEAD.ROUNDS, BRIDGEHEAD.MAGS * WEAPONS[ITEM.PISTOL].mag) && countItem(p.inv, ITEM.BANDAGE) === BRIDGEHEAD.BANDAGES && p.state.weapons[SLOT_MELEE] === BRIDGEHEAD.MELEE && p.state.weapons[SLOT_BUILD] === BRIDGEHEAD.BUILD && !p.state.weapons[SLOT_PRIMARY];
  const all = CACHE_GAVE.PISTOL | CACHE_GAVE.AMMO | CACHE_GAVE.BANDAGE | CACHE_GAVE.MELEE | CACHE_GAVE.BUILD;
  check('one who crossed with nothing has the floor: a pistol, two magazines, a bandage, a knife, a hammer', floor(b) && notes.some((n) => n[0] === NOTIFY.CACHE && n[1] === all && n[2] === b.id), kitOf(b));
  check('the checkpoint: whoever was dead or turned is a survivor again, with the floor', c.alive && !c.zombie && floor(c) && cy.self.alive === 1 && notes.some((n) => n[0] === NOTIFY.ARRIVED && n[1] === 1), `alive ${c.alive} zombie ${c.zombie} ${kitOf(c)}`);
  check('the day the team arrives on is long, whatever the hour was when the car left', game.day === 1 && Math.abs(game.timeLeft - ARRIVAL_DAY) < 2 && ann.global.phaseLen === ARRIVAL_DAY, `day ${game.day}, ${game.timeLeft} s`);
  check('the mainland is stocked: loot, containers, the dead by day', game.items.length > 200 && game.caches.length > 200 && game.zombies.length > 40, `${game.items.length} items, ${game.caches.length} containers, ${game.zombies.length} zombies`);

  // ---- the plane's parts: at set places
  const where = { [ITEM.PROPELLER]: [ZONE.HANGARS], [ITEM.MAGNETO]: [ZONE.CITY], [ITEM.HYDRAULIC_PUMP]: [ZONE.INDUSTRIAL], [ITEM.FLIGHT_RADIO]: [ZONE.TERMINAL], [ITEM.AVGAS]: [ZONE.FUEL_DEPOT, ZONE.HANGARS, ZONE.INDUSTRIAL] };
  const parts = game.items.filter((e) => PLANE_PARTS.includes(e.item));
  const zoneOf = (e) => w.zoneAt(e.x, e.z);
  check("the plane's seven parts lie at their set places, and the team is told which", parts.length === 7 && parts.every((e) => where[e.item].includes(zoneOf(e))) && ann.global.hints.every((z, k) => where[PLANE_PARTS[Math.min(k, 4)]].includes(z)) && !game.items.some((e) => SUPPLIES.includes(e.item) && e.item !== 0), parts.map((e) => `${e.item}@${zoneOf(e)}`).join(' ') + ' hints ' + ann.global.hints);
  // found and fitted
  for (const e of parts) {
    put(game, a, e.x + 0.4, e.z + 0.3);
    a.state.y = e.y;
    ann.act(ACT.INTERACT, e.id);
    ticks(game, 0.3);
  }
  check('a survivor walks to each and picks it up', PLANE_PARTS.every((it, i) => countItem(a.inv, it) === PLANE_NEED[i]) && ann.global.found === 0x7f, `found ${ann.global.found?.toString(2)} ` + PLANE_PARTS.map((it) => countItem(a.inv, it)).join());
  const plane = w.car;
  put(game, a, plane.x - 3, plane.z + 4);
  ann.act(ACT.INTERACT, CAR_ID);
  ticks(game, 0.5);
  check('...and fits them at the plane', game.allSuppliesIn() && ann.global.suppliesDone && notes.some((n) => n[0] === NOTIFY.SUPPLIES_DONE) && PLANE_PARTS.every((it) => countItem(a.inv, it) === 0), game.supplies.join());

  // ---- the runway stand
  const spawned = [];
  const spawn = game.zm.spawn.bind(game.zm);
  game.zm.spawn = (type, x, z, o) => {
    const e = spawn(type, x, z, o);
    if (e && o?.horde) spawned.push(e.boss ? { boss: type } : { x, z });
    return e;
  };
  ann.act(ACT.HOLD_BEGIN, CAR_ID);
  ticks(game, ENGINE_START_TIME + 0.3);
  const e0 = game.escape;
  check('starting it begins the runway stand: the fuel truck pumps first', e0.active && e0.stage === 0 && Math.abs(e0.t - RUNWAY.FUEL_TIME) < 1 && ann.global.finale && !ann.global.standWarm, JSON.stringify(e0));
  let t0 = game.escape.t;
  ticks(game, 3);
  check('...only while somebody stands at the truck: at the plane, it stalls', game.escape.t === t0 && ann.global.escapeStalled, `${t0} -> ${game.escape.t}`);
  const truck = w.runway.truck;
  put(game, a, truck.x + 3.5, truck.z + 1);
  ticks(game, 3);
  check('at the truck it pumps', game.escape.t < t0 - 2.5 && !ann.global.escapeStalled, `${t0} -> ${game.escape.t}`);
  game.escape.t = Math.min(game.escape.t, RUNWAY.FUEL_TIME / 2 - 0.1);
  ticks(game, 1);
  game.escape.t = 0.1;
  ticks(game, 1);
  check('the tanks full, the stand moves to the plane: the engines warm up', game.escape.stage === 1 && Math.abs(game.escape.t - RUNWAY.WARM_TIME) < 1.5 && ann.global.standWarm && notes.some((n) => n[0] === NOTIFY.STAND_STAGE), JSON.stringify(game.escape));
  t0 = game.escape.t;
  ticks(game, 2);
  check('...which the truck no longer does anything for', game.escape.t === t0 && ann.global.escapeStalled);
  put(game, a, plane.x - 3, plane.z + 4);
  ticks(game, 2);
  check('at the plane they warm', game.escape.t < t0 - 1.5);
  const bosses = spawned.filter((s) => s.boss).map((s) => s.boss);
  check('each of the two stages brings one of the late bosses', bosses.length === 2 && bosses.includes(ZTYPE.BOSS_ABOMINATION) && bosses.includes(ZTYPE.BOSS_HIVEQUEEN), bosses.join());
  const groups = spawned.filter((s) => !s.boss);
  const ahead = groups.filter((s) => plane.z - s.z > RUNWAY.AHEAD - 95 && Math.abs(s.x - plane.x) < 95).length;
  check('the horde comes down the runway: its groups appear well along it from the plane', groups.length >= 3 && ahead === groups.length, `${ahead} of ${groups.length} spawned along the runway`);
  // warm: a runway to keep clear
  for (const z of [...game.zombies]) {
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
  game.escape.t = 0.1;
  game.escape.spawnT = 1e6;
  ticks(game, 1);
  check('warm: the plane can go', game.escape.ready && ann.global.escapeReady && !ann.global.runwayBlocked);
  for (let k = 0; k < RUNWAY.CLEAR + 1; k++) spawn(ZTYPE.WALKER, plane.x - 2 + k * 2, plane.z - 30 - k * 3, { horde: true });
  for (const z of game.zombies) z.speedMul = 0; // (they stand where they were put)
  ticks(game, 0.5);
  ann.act(ACT.HOLD_BEGIN, CAR_ID);
  ticks(game, ESCAPE_DRIVE_TIME + 0.4, () => game.zombies.forEach((z, k) => ((z.x = plane.x - 2 + k * 2), (z.z = plane.z - 30 - k * 3))));
  check(`...but not with more than ${RUNWAY.CLEAR} of the dead on the runway ahead of it`, game.phase !== PHASE.VICTORY && ann.global.runwayBlocked && notes.some((n) => n[0] === NOTIFY.RUNWAY_BLOCKED && n[1] === RUNWAY.CLEAR + 1), `phase ${game.phase}, on it ${game.onRunway()}`);
  for (const z of [...game.zombies]) {
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
  ticks(game, 0.5);
  ann.act(ACT.HOLD_BEGIN, CAR_ID);
  ticks(game, ESCAPE_DRIVE_TIME + 0.4);
  check('the runway clear, a survivor takes it up: that is the victory', game.phase === PHASE.VICTORY && ann.global.phase === PHASE.VICTORY && notes.some((n) => n[0] === NOTIFY.VICTORY), `phase ${game.phase}`);
  check('...and the end screen waits for the take-off to be watched', Math.abs(game.restartT - (GAME_OVER_DELAY + 6 + TAKEOFF_TIME)) < 1, String(game.restartT));
  ticks(game, GAME_OVER_DELAY + 6 + TAKEOFF_TIME + 1);
  check('the next run begins on the island again', game.phase === PHASE.DAY && game.act === WORLD.ISLAND && game.world.kind === WORLD.ISLAND && game.day === 1 && ann.resets.at(-1).act === WORLD.ISLAND && !game.checkpoint, `act ${game.act} day ${game.day} resets ${JSON.stringify(ann.resets)}`);
}

// ================================================================ a wipe on the mainland, and late joiners
{
  const game = new Game({ seed: SEED, log: quiet, themes: false });
  const notes = notices(game);
  const ann = client(game, 'Ann', randomUUID());
  const ben = client(game, 'Ben', randomUUID());
  ticks(game, 1);
  const a = ann.p();
  const b = ben.p();
  game.giveItem(a, ITEM.SHOTGUN, 1);
  game.giveItem(a, ITEM.AMMO_SHELLS, 30);
  // the car leaves at night, three nights in
  game.day = 3;
  game.phase = PHASE.NIGHT;
  game.cross(a, true);
  game.arrive();
  check('a car that left in the night comes off the bridge the next morning', game.phase === PHASE.DAY && game.day === 4 && game.act === WORLD.MAINLAND, `day ${game.day}`);
  const kits = [kitOf(a), kitOf(b)];
  // days later, with other things in their hands, they are wiped out
  ticks(game, 2);
  game.giveItem(a, ITEM.MEDKIT, 3);
  a.state.ammo[AMMO.SHELL] = 1;
  game.day = 6;
  game.unlocked = 3;
  put(game, a, 100, 100);
  for (const p of [a, b]) game.killPlayer(p, { kind: 3 });
  game.checkAllDead();
  check('everybody dead on the mainland is a game over', game.phase === PHASE.GAMEOVER);
  ticks(game, GAME_OVER_DELAY + 0.5);
  check('...and the run starts again from the bridge, not from the island', game.phase === PHASE.DAY && game.act === WORLD.MAINLAND && game.world.kind === WORLD.MAINLAND && game.day === 4 && notes.some((n) => n[0] === NOTIFY.CHECKPOINT && n[1] === 4) && !ann.resets.some((r) => r.act === WORLD.ISLAND), `phase ${game.phase} act ${game.act} day ${game.day}`);
  check('...everybody alive at the bridgehead with what they crossed with', [a, b].every((p) => p.alive && !p.zombie && near(p, game.world.start, 16)) && kitOf(a) === kits[0] && kitOf(b) === kits[1] && game.unlocked === 0, `${kitOf(a)}\n      ${kits[0]}`);
  check('...on a mainland stocked afresh, the plane as they first found it', game.supplies.every((n) => n === 0) && game.items.filter((e) => PLANE_PARTS.includes(e.item)).length === 7 && game.zombies.length > 40);
  check('...and its first day is the long one again', Math.abs(game.timeLeft - ARRIVAL_DAY) < 2 && game.checkpoint?.day === 4);
  game.day = 5;
  check('the days after are a minute longer than the island\'s', game.dayLen === dayLength(5) + MAINLAND_DAY_MORE, String(game.dayLen));
  game.day = 4;
  // late joiners: into the act being played
  const dee = client(game, 'Dee', randomUUID());
  ticks(game, 0.5);
  const d = dee.p();
  check('a late joiner lands in act 2: told the mainland, put down at its start with that day\'s kit', dee.welcome.act === WORLD.MAINLAND && dee.global.act === WORLD.MAINLAND && near(d, game.world.start, 16) && d.state.weapons[SLOT_PISTOL] === ITEM.PISTOL && d.state.ammo[AMMO.P9] > 36 && countItem(d.inv, ITEM.BANDAGE) >= 3, `act ${dee.welcome.act} at ${d.state.x | 0},${d.state.z | 0} ammo ${d.state.ammo[AMMO.P9]}`);
  const city = game.world.zoneById[ZONE.CITY];
  put(game, a, city.x - 140, city.z - 4);
  put(game, b, city.x - 138, city.z - 2);
  put(game, d, city.x - 141, city.z - 1);
  ticks(game, 0.5);
  const eve = client(game, 'Eve', randomUUID());
  ticks(game, 0.5);
  check('...or beside the team, once it has left the bridgehead', near(eve.p(), a.state, 26), `${eve.p().state.x | 0},${eve.p().state.z | 0} vs ${a.state.x | 0},${a.state.z | 0}`);
  for (const p of [a, b, d, eve.p()]) game.killPlayer(p, { kind: 3 });
  game.checkAllDead();
  ticks(game, GAME_OVER_DELAY + 0.5);
  check('a second wipe goes back to the bridge again; whoever joined since has a late joiner\'s kit', game.phase === PHASE.DAY && game.act === WORLD.MAINLAND && kitOf(a) === kits[0] && d.alive && d.state.weapons[SLOT_PISTOL] === ITEM.PISTOL && near(d, game.world.start, 16));
}

// ================================================================ a drop, and a deploy, across the crossing
{
  const game = new Game({ seed: SEED, log: quiet, themes: false });
  const annId = randomUUID();
  const ann = client(game, 'Ann', annId);
  const ben = client(game, 'Ben', randomUUID());
  ticks(game, 1);
  const a = ann.p();
  game.giveItem(a, ITEM.MP5, 1);
  game.giveItem(a, ITEM.AMMO_9MM, 60); // (over the bridgehead's floor: the cache gives her nothing)
  const kit = kitOf(a);
  game.cross(ben.p());
  ticks(game, 2);
  game.onClose(ann.session, 1006);
  check('a player who drops during the crossing is held', game.players.get(ann.id) === a && !!a.away);
  // the deploy: saved on the island side of the crossing, carried on by the next server
  const B = new Game({ log: quiet, themes: false, restore: decode(encode(envelope(game))) });
  check('a deploy in the middle of the crossing: the next server carries it on, the island still up', B.phase === PHASE.CROSSING && B.act === WORLD.ISLAND && B.crossing?.pending === 2 && Math.abs(B.timeLeft - game.timeLeft) < 0.1 && B.players.size === 2, `phase ${B.phase} act ${B.act} ${JSON.stringify(B.crossing)}`);
  const back = client(B, 'Ann', annId);
  const a2 = back.p();
  check('...its players come back into their own bodies, and are told which map', back.id === ann.id && back.welcome.act === WORLD.ISLAND && kitOf(a2) === kit, `${back.id} vs ${ann.id}`);
  ticks(B, CROSSING.TIME);
  check('...and it arrives on the mainland with what was carried', B.phase === PHASE.DAY && B.act === WORLD.MAINLAND && back.resets.some((r) => r.act === WORLD.MAINLAND) && kitOf(a2) === kit && near(a2, B.world.start, 16), `phase ${B.phase} act ${B.act}`);
  // ...and a deploy on the mainland: the act, the mainland and the checkpoint survive it
  ticks(B, 2);
  put(B, a2, B.world.start.x + 60, B.world.start.z);
  B.giveItem(a2, ITEM.MEDKIT, 1);
  const C = new Game({ log: quiet, themes: false, restore: decode(encode(envelope(B))) });
  check('a deploy on the mainland: act 2, the mainland of the same seed, the checkpoint', C.act === WORLD.MAINLAND && C.world.kind === WORLD.MAINLAND && C.world.size === MAINLAND_SIZE && C.worldHash === B.worldHash && C.checkpoint?.kits.length === 2 && C.checkpoint.day === B.checkpoint.day && C.items.length === B.items.length && C.zombies.length === B.zombies.length, `act ${C.act} hash ${C.worldHash}/${B.worldHash} cp ${JSON.stringify(C.checkpoint)?.length}`);
  const again = client(C, 'Ann', annId);
  const a3 = again.p();
  check('...the players where they stood, told it is the mainland', again.welcome.act === WORLD.MAINLAND && Math.abs(a3.state.x - a2.state.x) < 0.01 && kitOf(a3) === kitOf(a2));
  for (const p of C.players.values()) {
    p.away = null;
    C.killPlayer(p, { kind: 3 });
  }
  C.checkAllDead();
  ticks(C, GAME_OVER_DELAY + 0.5);
  check('...and a wipe after it still goes back to the bridge, with what was carried over it', C.phase === PHASE.DAY && C.act === WORLD.MAINLAND && kitOf(a3) === kit && near(a3, C.world.start, 16), `phase ${C.phase} ${kitOf(a3)}`);
}

// ================================================================ the mainland's nights
{
  const late = new Set(MAINLAND_BOSSES);
  let ok = true;
  let detail = '';
  for (const seed of [1, 7, 1337, SEED, 99991]) {
    let prev = -1;
    for (let n = 1; n <= 12; n++) {
      const boss = nightBoss(seed, n, WORLD.MAINLAND);
      if (!late.has(boss) || (n >= 2 && boss === prev) || (n === 4 && boss !== ZTYPE.BOSS_ABOMINATION) || (n === 5 && boss !== ZTYPE.BOSS_HIVEQUEEN)) {
        ok = false;
        detail += ` seed ${seed} night ${n}: ${boss}`;
      }
      prev = boss;
    }
  }
  check('every mainland night has one of the late bosses: The Abomination on the fourth, The Hive Queen on the fifth, never the same twice running', ok, detail);
  check('...while the island keeps its own (The Brute on the first night)', nightBoss(SEED, 1) === ZTYPE.BOSS_BRUTE && nightBoss(SEED, 1, WORLD.ISLAND) === ZTYPE.BOSS_BRUTE);
  const early = NIGHT_THEMES.filter((th) => th.from > 2 && th.from <= MAINLAND_NIGHT).map((th) => th.id);
  let drawn = false;
  for (let seed = 1; seed < 400 && !drawn; seed++) drawn = early.includes(nightTheme(seed, 2, WORLD.MAINLAND)?.id) && !early.includes(nightTheme(seed, 2)?.id);
  check('a mainland night counts as the fourth at the least: its themes can be drawn however early the team crossed', drawn, early.join());
  // in a game: a team that crossed on day 2 meets, that night, a horde made up as on night 4
  const game = new Game({ seed: SEED, log: quiet, godMode: true });
  const ann = client(game, 'Ann', randomUUID());
  ticks(game, 1);
  game.day = 2;
  game.cross(ann.p());
  game.arrive();
  game.startNight();
  const kinds = new Set(game.waves.flatMap((wv) => wv.queue));
  check('the night after an early crossing: a late boss, and the kinds of night 4 in the horde', game.bossPending.types[0] === nightBoss(SEED, 2, WORLD.MAINLAND) && late.has(game.bossPending.types[0]) && [...kinds].every((t) => ZOMBIE_DEFS[t].minNight <= MAINLAND_NIGHT) && [...kinds].some((t) => ZOMBIE_DEFS[t].minNight > 2), `boss ${game.bossPending.types[0]}, kinds ${[...kinds].join()}`);
}

// ================================================================ what a tick costs: a night's horde on each map
{
  const run = (act) => {
    const game = new Game({ seed: SEED, log: quiet, godMode: true, themes: false });
    const cs = ['A', 'B', 'C', 'D'].map((n) => client(game, n, randomUUID()));
    ticks(game, 1);
    if (act === WORLD.MAINLAND) {
      game.cross(cs[0].p());
      game.arrive();
      const city = game.world.zoneById[ZONE.CITY];
      cs.forEach((c, k) => put(game, c.p(), city.x - 20 + k * 3, city.z + 4));
    }
    game.day = 4;
    game.startNight();
    ticks(game, 112); // (all three waves are up)
    const n = 1200;
    let worst = 0;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      game.timeLeft += 0.05; // (the night does not end under the measurement)
      game.update();
      worst = Math.max(worst, performance.now() - t);
    }
    return { ms: (performance.now() - t0) / n, worst, zombies: game.zombies.length, ents: game.all.length };
  };
  const isl = run(WORLD.ISLAND);
  const main = run(WORLD.MAINLAND);
  console.log(`      a night-4 horde, 4 players, ${1200} ticks: the island ${isl.ms.toFixed(3)} ms a tick (worst ${isl.worst.toFixed(1)}, ${isl.zombies} zombies, ${isl.ents} entities), the mainland ${main.ms.toFixed(3)} ms (worst ${main.worst.toFixed(1)}, ${main.zombies} zombies, ${main.ents} entities)`);
  check('a tick on the mainland costs nothing like four times a tick on the island', main.ms < isl.ms * 2.5 + 0.3, `${main.ms.toFixed(3)} vs ${isl.ms.toFixed(3)} ms`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
