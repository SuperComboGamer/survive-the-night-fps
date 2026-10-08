// The two-act run (issue #111, shared/acts.js), played through on the Game itself with fake connections that read
// what they are sent with the client's own decoders:
//   the car's final stand -> driving off is the crossing, not the victory -> the mainland is built behind the
//   cutscene -> everybody arrives with what they carried -> the dead come back at the checkpoint -> the bridgehead
//   cache makes up the floor and nothing more -> the plane's parts are at their set places, are found and fitted ->
//   the runway stand: the fuel truck, then the plane, then a runway to keep clear -> the take-off is the victory
// and round it: a wipe on the mainland ends the run (the next begins on the island), a late joiner lands in the act being played,
// a dropped player and a deploy both get across the crossing, and the mainland's nights have the late bosses. The
// survivor each player chose to be (shared/characters.js) is the same one through all of it.
// It ends with what a tick costs with a night's horde up on each of the two maps.
process.env.REJOIN_GRACE_SECONDS = '600';
process.env.HANDOFF_FREEZE_SECONDS = '0'; // (a game brought over runs on at once here: its waiting for its players is scripts/test-handoff-safe.js)
const { Game } = await import('../server/game.js');
const { C2S, S2C, ACT, CAR_ID, HOLD, SNAP, PLF, UNDO_NO, PROTOCOL_VERSION, Writer, Reader, qpos, dqpos, usePos, POS_SCALE, POS_SCALE_WIDE } = await import('../shared/protocol.js');
const { PHASE, ESCAPE_DRIVE_TIME, ENGINE_START_TIME, GAME_OVER_DELAY, SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE, SLOT_BUILD, INVENTORY_MAX, dayLength, MAP_SIZE } = await import('../shared/constants.js');
const { ITEM, WEAPONS, AMMO, AMMO_ITEMS, ZTYPE, ZONE, ZONE_NAMES, NOTIFY, EVT, CACHE_GAVE, PLANE_PARTS, PLANE_NEED, SUPPLIES, ZOMBIE_DEFS, SCHEMATICS, SCHEM_BIT, CONT_DEFS, schematicRumours } = await import('../shared/defs.js');
const { WORLD, MAINLAND_SIZE, CROSSING, TAKEOFF_TIME, RUNWAY, BRIDGEHEAD, ARRIVAL_DAY, MAINLAND_DAY_MORE, MAINLAND_NIGHT } = await import('../shared/acts.js');
const { nightBoss, nightTheme, MAINLAND_BOSSES, NIGHT_THEMES } = await import('../shared/nights.js');
const { readHeader, readGlobal, readSelf } = await import('../client/net/decode.js');
const { envelope, encode, decode } = await import('../server/handoff.js');
const { START_CLEAR } = await import('../server/zombies.js');
const { countItem, sortInventory, invCap } = await import('../server/inventory.js');
const { bit } = await import('../shared/bestiary.js');
const { randomUUID } = await import('node:crypto');
const { CHARACTER_COUNT, CHARACTER_NONE, defaultCharacter } = await import('../shared/characters.js');
const AP = await import('../shared/appearance.js');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const quiet = () => {};
const SEED = 4242;

// a client: what it is told, read as the client reads it (global state, own state, the notices among its events)
// (character: the survivor chosen on the splash, the JOIN's last byte; none: the byte is left off, as an older client does.
// look: a custom survivor's, after it - the character creator)
function client(game, name, pid = '', character = CHARACTER_NONE, look = null) {
  const c = { id: 0, name, net: {}, global: null, notes: [], resets: [], welcome: null, chars: new Map(), looks: new Map(), self: { alive: 1, hp: 100, maxHp: 100, armor: 0, armorMax: 0, battery: 100, weapons: [0, 0, 0, 0, 0], mags: [0, 0], ammo: AMMO_ITEMS.map(() => 0) } };
  c.conn = {
    ip: name,
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) {
        c.id = r.u16();
        c.welcome = { seed: r.u32(), tick: r.u32(), rate: r.u8(), max: r.u8(), flags: r.u8(), act: r.u8() };
      } else if (t === S2C.WORLD_RESET) c.resets.push({ seed: r.u32(), act: r.u8() });
      else if (t === S2C.INVENTORY) {
        // the backpack as the client is shown it: a slot's item and its count
        c.inv = [];
        for (let i = 0; i < INVENTORY_MAX; i++) c.inv.push({ item: r.u8(), count: r.u16() });
      }
      else if (t === S2C.PLAYERS) {
        // the player list: who is who, and after them all the character of each (what every client draws them as)
        const ids = [];
        for (let n = r.u8(); n > 0; n--) {
          ids.push(r.u16());
          r.str();
          r.u8();
          const flags = r.u8();
          r.u16();
          r.u16();
          r.u8();
          if (flags & PLF.WAYPOINT) {
            r.i16();
            r.i16();
            r.u8();
          }
        }
        c.chars = new Map(ids.map((id) => [id, r.left > 0 ? r.u8() : -1]));
      } else if (t === S2C.LOOKS) {
        for (let n = r.u8(); n > 0; n--) {
          const id = r.u16();
          const b = AP.readLook(r);
          c.looks.set(id, b ? [...b] : null);
        }
      } else if (t === S2C.SNAPSHOT) {
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
  if (character !== CHARACTER_NONE) w.u8(character);
  if (look) AP.writeLook(w, look);
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
// who each player is, as the server holds it and as every client in `cs` was last told it (the player list's bytes)
const whoIs = (game, cs) => [...game.players.values()].map((p) => `${p.id}:${p.character}`).join() + ' | ' + cs.map((c) => [...c.chars].map(([id, ch]) => `${id}:${ch}`).join()).join(' | ');
const isChar = (game, cs, id, ch) => game.players.get(id)?.character === ch && cs.every((c) => c.chars.get(id) === ch);
const near = (p, at, r) => Math.hypot(p.state.x - at.x, p.state.z - at.z) <= r;
// the dead standing in the clearing round where the run on this map began (zombies.js START_CLEAR)
const nearHead = (game) => game.zombies.filter((z) => !z.dead && Math.hypot(z.x - game.world.start.x, z.z - game.world.start.z) < START_CLEAR);

// ================================================================ the run
{
  const game = new Game({ seed: SEED, log: quiet, godMode: true, themes: false });
  const notes = notices(game);
  const ann = client(game, 'Ann', randomUUID(), 3);
  const ben = client(game, 'Ben', randomUUID(), CHARACTER_COUNT - 1);
  const cy = client(game, 'Cy', randomUUID()); // (chose nobody: the survivor his id picks)
  ticks(game, 1);
  const trio = [ann, ben, cy];
  const chose = [[ann.id, 3], [ben.id, CHARACTER_COUNT - 1], [cy.id, defaultCharacter(cy.id)]];
  const same = (g = game, cs = trio) => chose.every(([id, ch]) => isChar(g, cs, id, ch));
  check('each is the survivor they chose to be, and everybody is told', same(), whoIs(game, trio));
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
  check('...and they are who they were, in the car', same(), whoIs(game, trio));
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
  check(`...with none of the dead within ${START_CLEAR} m of it`, !nearHead(game).length, nearHead(game).map((z) => `${z.x | 0},${z.z | 0}`).join(' '));
  check('what a survivor carried came over with them: weapons, rounds, backpack, armour, perks, kills', kitOf(a) === before && a.perks === 5 && a.kills === kills, `${kitOf(a)}\n      ${before}`);
  check('...and a well-stocked one gets nothing from the bridgehead cache', !notes.some((n) => n[0] === NOTIFY.CACHE && n[2] === a.id));
  const floor = (p) => p.state.weapons[SLOT_PISTOL] === BRIDGEHEAD.PISTOL && p.state.mags[1] === WEAPONS[ITEM.PISTOL].mag && p.state.ammo[AMMO.P9] === Math.min(BRIDGEHEAD.ROUNDS, BRIDGEHEAD.MAGS * WEAPONS[ITEM.PISTOL].mag) && countItem(p.inv, ITEM.BANDAGE) === BRIDGEHEAD.BANDAGES && p.state.weapons[SLOT_MELEE] === BRIDGEHEAD.MELEE && p.state.weapons[SLOT_BUILD] === BRIDGEHEAD.BUILD && !p.state.weapons[SLOT_PRIMARY];
  const all = CACHE_GAVE.PISTOL | CACHE_GAVE.AMMO | CACHE_GAVE.BANDAGE | CACHE_GAVE.MELEE | CACHE_GAVE.BUILD;
  check('one who crossed with nothing has the floor: a pistol, two magazines, a bandage, a knife, a hammer', floor(b) && notes.some((n) => n[0] === NOTIFY.CACHE && n[1] === all && n[2] === b.id), kitOf(b));
  check('the checkpoint: whoever was dead or turned is a survivor again, with the floor', c.alive && !c.zombie && floor(c) && cy.self.alive === 1 && notes.some((n) => n[0] === NOTIFY.ARRIVED && n[1] === 1), `alive ${c.alive} zombie ${c.zombie} ${kitOf(c)}`);
  check("the crossing changes nobody's character: not the survivors', not the one the checkpoint brought back from the dead", same() && !c.zombie, whoIs(game, trio));
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
  check('...and after the take-off, on the next island, they are still who they chose to be', same(), whoIs(game, trio));
  check('the next run begins on the island again', game.phase === PHASE.DAY && game.act === WORLD.ISLAND && game.world.kind === WORLD.ISLAND && game.day === 1 && ann.resets.at(-1).act === WORLD.ISLAND && !game.checkpoint, `act ${game.act} day ${game.day} resets ${JSON.stringify(ann.resets)}`);
}

// ================================================================ a wipe on the mainland, and late joiners
{
  const game = new Game({ seed: SEED, log: quiet, themes: false });
  const notes = notices(game);
  const ann = client(game, 'Ann', randomUUID(), 6);
  const ben = client(game, 'Ben', randomUUID());
  ticks(game, 1);
  const a = ann.p();
  const b = ben.p();
  const benIs = defaultCharacter(ben.id);
  game.giveItem(a, ITEM.SHOTGUN, 1);
  game.giveItem(a, ITEM.AMMO_SHELLS, 30);
  // the car leaves at night, three nights in
  game.day = 3;
  game.phase = PHASE.NIGHT;
  game.cross(a, true);
  game.arrive();
  check('a car that left in the night comes off the bridge the next morning', game.phase === PHASE.DAY && game.day === 4 && game.act === WORLD.MAINLAND, `day ${game.day}`);
  check('...and its first day is the long one', Math.abs(game.timeLeft - ARRIVAL_DAY) < 2 && game.checkpoint?.day === 4);
  game.day = 5;
  check('the days after are a minute longer than the island\'s', game.dayLen === dayLength(5) + MAINLAND_DAY_MORE, String(game.dayLen));
  game.day = 4;
  // late joiners: into the act being played
  const dee = client(game, 'Dee', randomUUID(), 1);
  ticks(game, 0.5);
  const d = dee.p();
  check('a late joiner on the mainland is the survivor they chose', isChar(game, [ann, ben, dee], dee.id, 1) && dee.chars.get(ann.id) === 6, whoIs(game, [ann, ben, dee]));
  check('a late joiner lands in act 2: told the mainland, put down at its start with that day\'s kit', dee.welcome.act === WORLD.MAINLAND && dee.global.act === WORLD.MAINLAND && near(d, game.world.start, 16) && d.state.weapons[SLOT_PISTOL] === ITEM.PISTOL && d.state.ammo[AMMO.P9] > 36 && countItem(d.inv, ITEM.BANDAGE) >= 3, `act ${dee.welcome.act} at ${d.state.x | 0},${d.state.z | 0} ammo ${d.state.ammo[AMMO.P9]}`);
  const city = game.world.zoneById[ZONE.CITY];
  put(game, a, city.x - 140, city.z - 4);
  put(game, b, city.x - 138, city.z - 2);
  put(game, d, city.x - 141, city.z - 1);
  ticks(game, 0.5);
  const eve = client(game, 'Eve', randomUUID());
  ticks(game, 0.5);
  check('...or beside the team, once it has left the bridgehead', near(eve.p(), a.state, 26), `${eve.p().state.x | 0},${eve.p().state.z | 0} vs ${a.state.x | 0},${a.state.z | 0}`);
  // days later, with other things in their hands, they are wiped out
  game.giveItem(a, ITEM.MEDKIT, 3);
  game.day = 6;
  game.unlocked = 3;
  const resets = ann.resets.length;
  for (const p of [a, b, d, eve.p()]) game.killPlayer(p, { kind: 3 });
  game.checkAllDead();
  check('everybody dead on the mainland is a game over', game.phase === PHASE.GAMEOVER && game.act === WORLD.MAINLAND && notes.some((n) => n[0] === NOTIFY.GAME_OVER && n[1] === 6), `phase ${game.phase}`);
  ticks(game, GAME_OVER_DELAY - 1);
  check('...with the end screen up for as long as one on the island', game.phase === PHASE.GAMEOVER, `phase ${game.phase}`);
  ticks(game, 1.5);
  check('...and then the run is over: the next begins on the island, on its first day, not back at the bridge', game.phase === PHASE.DAY && game.act === WORLD.ISLAND && game.world.kind === WORLD.ISLAND && game.day === 1 && !game.checkpoint && ann.resets.length === resets + 1 && ann.resets.at(-1).act === WORLD.ISLAND && dee.resets.at(-1).act === WORLD.ISLAND, `phase ${game.phase} act ${game.act} day ${game.day} resets ${JSON.stringify(ann.resets)}`);
  check('...everybody alive at the island\'s start with a new starting kit, not what they had on the mainland', [a, b, d, eve.p()].every((p) => p.alive && !p.zombie && near(p, game.world.start, 30)) && a.state.weapons[SLOT_PRIMARY] !== ITEM.SHOTGUN && countItem(a.inv, ITEM.MEDKIT) === 0 && game.unlocked === 0, `${kitOf(a)}`);
  check('...with the car to fix again, its supplies all to find', game.sup.items === SUPPLIES && game.supplies.every((n) => n === 0) && !game.world.car.plane, JSON.stringify(game.supplies));
  ticks(game, 0.2);
  check('...everybody still who they chose to be', isChar(game, [ann, ben, dee], ann.id, 6) && isChar(game, [ann, ben, dee], ben.id, benIs) && isChar(game, [ann, ben, dee], dee.id, 1), whoIs(game, [ann, ben, dee]));
}

// ================================================================ a drop, and a deploy, across the crossing
{
  const game = new Game({ seed: SEED, log: quiet, themes: false });
  const annId = randomUUID();
  const ann = client(game, 'Ann', annId, 2);
  // (Ben made his own survivor: the character creator; 7 is the roster survivor most like him)
  const benLook = AP.randomLook(AP.mulberry(7));
  const benBytes = [...AP.encode(AP.canonical(benLook))];
  const ben = client(game, 'Ben', randomUUID(), 7, benLook);
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
  check('...each held player the survivor they chose', B.players.get(ann.id)?.character === 2 && B.players.get(ben.id)?.character === 7, whoIs(B, []));
  const sameBytes = (x) => JSON.stringify(x) === JSON.stringify(benBytes);
  check('...and the one who made their own still their look (kept as plain bytes in the saved game)', sameBytes(B.players.get(ben.id)?.look) && !B.players.get(ann.id)?.look && ann.looks.get(ben.id) && sameBytes(ann.looks.get(ben.id)), JSON.stringify(B.players.get(ben.id)?.look)?.slice(0, 40));
  // (she comes back asking to be somebody else - a client that picked another on its splash: the body held for her is
  // the one she left, so she is who she was)
  const back = client(B, 'Ann', annId, 5);
  const a2 = back.p();
  ticks(B, 0.2);
  check('...a player who comes back into a held body is the survivor that body is, whatever the rejoin asks for', isChar(B, [back], ann.id, 2) && back.chars.get(ben.id) === 7, whoIs(B, [back]));
  check("...and is told the others' looks again as they come back (S2C.LOOKS)", sameBytes(back.looks.get(ben.id)) && !back.looks.has(ann.id));
  check('...its players come back into their own bodies, and are told which map', back.id === ann.id && back.welcome.act === WORLD.ISLAND && kitOf(a2) === kit, `${back.id} vs ${ann.id}`);
  ticks(B, CROSSING.TIME);
  check('...and is still that survivor off the bridge', isChar(B, [back], ann.id, 2) && isChar(B, [back], ben.id, 7), whoIs(B, [back]));
  check('...and it arrives on the mainland with what was carried', B.phase === PHASE.DAY && B.act === WORLD.MAINLAND && back.resets.some((r) => r.act === WORLD.MAINLAND) && kitOf(a2) === kit && near(a2, B.world.start, 16), `phase ${B.phase} act ${B.act}`);
  // ...and a deploy on the mainland: the act, the mainland and the day they arrived survive it
  ticks(B, 2);
  put(B, a2, B.world.start.x + 60, B.world.start.z);
  B.giveItem(a2, ITEM.MEDKIT, 1);
  const C = new Game({ log: quiet, themes: false, restore: decode(encode(envelope(B))) });
  check('a deploy on the mainland: act 2, the mainland of the same seed, the checkpoint', C.act === WORLD.MAINLAND && C.world.kind === WORLD.MAINLAND && C.world.size === MAINLAND_SIZE && C.worldHash === B.worldHash && C.checkpoint?.day === B.checkpoint.day && C.items.length === B.items.length && C.zombies.length === B.zombies.length, `act ${C.act} hash ${C.worldHash}/${B.worldHash} cp ${JSON.stringify(C.checkpoint)?.length}`);
  const again = client(C, 'Ann', annId);
  const a3 = again.p();
  ticks(C, 0.2);
  check('...and who they chose to be (a rejoin that names nobody keeps it too)', isChar(C, [again], ann.id, 2) && isChar(C, [again], ben.id, 7), whoIs(C, [again]));
  check('...their own looks too, a second deploy on', sameBytes(C.players.get(ben.id)?.look) && sameBytes(again.looks.get(ben.id)));
  check('...the players where they stood, told it is the mainland', again.welcome.act === WORLD.MAINLAND && Math.abs(a3.state.x - a2.state.x) < 0.01 && kitOf(a3) === kitOf(a2));
  for (const p of C.players.values()) {
    p.away = null;
    C.killPlayer(p, { kind: 3 });
  }
  C.checkAllDead();
  ticks(C, GAME_OVER_DELAY + 0.5);
  ticks(C, 0.2);
  check('...as the same survivors', isChar(C, [again], ann.id, 2) && isChar(C, [again], ben.id, 7), whoIs(C, [again]));
  check('...and a wipe after it is the end of the run: the next begins on the island', C.phase === PHASE.DAY && C.act === WORLD.ISLAND && C.world.kind === WORLD.ISLAND && !C.checkpoint && kitOf(a3) !== kit && near(a3, C.world.start, 30), `phase ${C.phase} act ${C.act} ${kitOf(a3)}`);
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

// ================================================================ what the island has learnt since, on the mainland
// Difficulty levels, the schematics' rumours, a backpack that sorts itself and takes a drop back, the bestiary, the
// dead fanning out of a crowd and dogs that bite and run were each written for the island. Here each is held on the
// mainland: across the crossing, at the checkpoint, and out where the island's 640 m have long ended.
{
  // a game of that difficulty with its team on the mainland: Ann with what she started with, Ben with nothing
  const land = (difficulty, before) => {
    const game = new Game({ seed: SEED, log: quiet, godMode: true, themes: false, difficulty });
    const notes = notices(game);
    const ann = client(game, 'Ann', randomUUID());
    const ben = client(game, 'Ben', randomUUID());
    ticks(game, 1);
    const b = ben.p();
    b.state.weapons = [0, 0, 0, 0, 0];
    b.state.mags = [0, 0];
    b.state.ammo = b.state.ammo.map(() => 0);
    b.inv = b.inv.map(() => null);
    before?.(game, ann, ben);
    game.cross(ann.p());
    game.arrive();
    ticks(game, 0.2);
    return { game, notes, ann, ben, a: ann.p(), b, d: game.diff };
  };
  const wipe = (g) => {
    for (const p of g.game.players.values()) g.game.killPlayer(p, { kind: 3 });
    g.game.checkAllDead();
    ticks(g.game, GAME_OVER_DELAY + 0.5);
    ticks(g.game, 0.2);
  };

  // ---- difficulty (shared/difficulty.js): Ember, Nightfall, Blackout
  const E = land('ember');
  const N = land('nightfall');
  const B = land('blackout');
  const three = [E, N, B];
  const rising = (f) => f(E) < f(N) && f(N) < f(B);
  check('a game of each difficulty crosses to the mainland', three.every((g) => g.game.act === WORLD.MAINLAND && g.game.phase === PHASE.DAY) && E.d.id === 'ember' && N.d.id === 'nightfall' && B.d.id === 'blackout');
  check("the day of the arrival is stretched as the island's days are: 495 s on Ember, 330 on Nightfall, 264 on Blackout", three.every((g) => Math.abs(g.game.timeLeft - Math.round(ARRIVAL_DAY * g.d.day)) < 2 && g.ann.global.phaseLen === Math.round(ARRIVAL_DAY * g.d.day)) && Math.round(ARRIVAL_DAY * E.d.day) === 495 && Math.round(ARRIVAL_DAY * B.d.day) === 264, three.map((g) => g.game.timeLeft.toFixed(0)).join());
  {
    const lens = three.map((g) => {
      g.game.day++;
      const len = g.game.dayLen;
      g.game.day--;
      return [len, Math.round((dayLength(g.game.day + 1) + MAINLAND_DAY_MORE) * g.d.day)];
    });
    check('...and so are the days after it', lens.every(([got, want]) => got === want) && lens[0][0] > lens[1][0] && lens[1][0] > lens[2][0], JSON.stringify(lens));
  }
  {
    // the floor's rounds and bandages follow the starting kit's: two magazines on Nightfall
    const mag = WEAPONS[ITEM.PISTOL].mag;
    const want = (g) => [Math.min(Math.round(BRIDGEHEAD.ROUNDS * g.d.ammo), Math.round(mag * BRIDGEHEAD.MAGS * g.d.ammo)), Math.max(1, Math.round(BRIDGEHEAD.BANDAGES * g.d.bandages))];
    const got = (g) => [g.b.state.ammo[AMMO.P9], countItem(g.b.inv, ITEM.BANDAGE)];
    const tools = (g) => g.b.state.weapons[SLOT_PISTOL] === BRIDGEHEAD.PISTOL && g.b.state.mags[1] === mag && g.b.state.weapons[SLOT_MELEE] === BRIDGEHEAD.MELEE && g.b.state.weapons[SLOT_BUILD] === BRIDGEHEAD.BUILD;
    check("the bridgehead's floor follows the difficulty: 48 rounds and 2 bandages on Ember, 24 and 1 on Nightfall, 16 and 1 on Blackout; the pistol, the knife and the hammer on all three", three.every((g) => String(got(g)) === String(want(g)) && tools(g)) && String(got(E)) === '48,2' && String(got(N)) === '24,1' && String(got(B)) === '16,1', three.map((g) => got(g).join('/')).join(' '));
  }
  {
    const cys = three.map((g) => client(g.game, 'Cy', randomUUID()));
    for (const g of three) ticks(g.game, 0.5);
    const kit = (g, i) => [cys[i].p().state.ammo[AMMO.P9], countItem(cys[i].p().inv, ITEM.BANDAGE)];
    check("a late joiner on the mainland has that difficulty's starting kit: 72 rounds and 4 bandages, 36 and 2, 24 and 1", String(kit(E, 0)) === '72,4' && String(kit(N, 1)) === '36,2' && String(kit(B, 2)) === '24,1' && cys.every((c) => c.welcome.act === WORLD.MAINLAND), three.map((g, i) => kit(g, i).join('/')).join(' '));
  }
  check('the dead that stand about the mainland by day: fewer on Ember, more on Blackout', rising((g) => g.game.zombies.length), three.map((g) => g.game.zombies.length).join());
  check('what lies about it to be picked up: more on Ember, less on Blackout', rising((g) => -g.game.items.length), three.map((g) => g.game.items.length).join());
  {
    const base = Math.round((10 + 6 * 4 + 1.3 * 16) * (0.6 + 0.4 * 3));
    const size = (g) => g.game.hordeSize(4, 3);
    check("a mainland night's horde: 55% of Nightfall's on Ember, 140% on Blackout", size(N) === base && size(E) === Math.round(base * 0.55) && size(B) === Math.round(base * 1.4), three.map(size).join());
    const stand = (g) => {
      g.game.day = 4;
      const n = g.game.finalStandSize();
      g.game.day = g.game.checkpoint.day;
      return n;
    };
    check("...and the runway stand is sized from it: 1.3 of what the car's would be, on each", rising(stand) && three.every((g) => Math.abs(stand(g) - 1.25 * RUNWAY.SIZE * g.game.hordeSize(4, g.game.humanCount())) <= 1), three.map(stand).join());
    const hp = (g) => g.game.zm.spawn(ZTYPE.WALKER, g.game.world.car.x, g.game.world.car.z - 40).maxHp;
    const hps = three.map(hp);
    check('one of the dead on the mainland has the health its difficulty gives it', hps[1] === ZOMBIE_DEFS[ZTYPE.WALKER].hp && Math.abs(hps[0] - hps[1] * E.d.zombieHp) < 1e-6 && Math.abs(hps[2] - hps[1] * B.d.zombieHp) < 1e-6, hps.join());
    // a night on each: it comes, in waves, and the tick runs (what the difficulty moves in the dead is in every tick)
    for (const g of three) {
      for (const p of g.game.players.values()) put(g.game, p, g.game.world.car.x, g.game.world.car.z - 20);
      g.game.day = 4;
      g.game.startNight();
      ticks(g.game, 30);
    }
    const queued = (g) => g.game.hordeAlive() + g.game.waves.reduce((n, wv) => n + wv.queue.length, 0);
    check('the night comes on all three, the smaller on Ember', three.every((g) => g.game.phase === PHASE.NIGHT && g.game.hordeAlive() > 0) && rising(queued), three.map(queued).join());
  }

  // ---- the schematics' rumours (a zone per schematic in the global state)
  {
    const got = 1 << SCHEM_BIT[SCHEMATICS[0]];
    let island = null;
    const g = land('nightfall', (game) => {
      island = game.schemHints.slice();
      game.unlocked = got; // (the team found one on the island)
    });
    const { game, ann } = g;
    const w = game.world;
    const at = SCHEMATICS.map((it) => game.caches.filter((c) => c.schem === it));
    const rest = SCHEMATICS.slice(1);
    check('on the island each of the five was rumoured to a place of the island', island.length === SCHEMATICS.length && island.every((z) => z !== 255 && z < ZONE.BRIDGEHEAD), island.join());
    check('across the bridge the ones the team lacks are hidden again, each in one container of a place of the mainland it is rumoured to be in', rest.every((it, k) => at[k + 1].length === 1 && CONT_DEFS[at[k + 1][0].ctype].schem && at[k + 1][0].zone === game.schemHints[k + 1] && w.zoneById[game.schemHints[k + 1]] && ZONE_NAMES[game.schemHints[k + 1]] && game.schemHints[k + 1] >= ZONE.BRIDGEHEAD), game.schemHints.join());
    check('...every one in a different place, far from the bridgehead', new Set(game.schemHints.slice(1)).size === rest.length && at.slice(1).every(([c]) => Math.hypot(c.x - w.start.x, c.z - w.start.z) > 90));
    check('...and the one the team has is hidden nowhere, and rumoured nowhere', at[0].length === 0 && game.schemHints[0] === 255 && game.unlocked === got);
    const rumours = () => schematicRumours(ann.global.schemHints, ann.global.unlocked);
    check("the rumours reach the team as the mainland's: four, each at a place its map can mark", JSON.stringify(ann.global.schemHints) === JSON.stringify(game.schemHints) && ann.global.unlocked === got && rumours().length === 4 && rumours().every((rm) => w.zoneById[rm.zone] && Math.abs(w.zoneById[rm.zone].x) < w.half && Math.abs(w.zoneById[rm.zone].z) < w.half), JSON.stringify(ann.global.schemHints));
    // found: searching the container it is in unlocks it, and its rumour goes
    game.searchCache(g.a, at[1][0]);
    ticks(game, 0.2);
    check('one searched out of its container is unlocked, and its rumour gone', !!(game.unlocked & (1 << SCHEM_BIT[SCHEMATICS[1]])) && rumours().length === 3 && !rumours().some((rm) => rm.item === SCHEMATICS[1]), JSON.stringify(rumours()));
    wipe(g);
    check('a wipe ends the run: on the next island all five are lost again, each rumoured to a place of the island', game.act === WORLD.ISLAND && game.unlocked === 0 && game.schemHints.every((z) => z !== 255 && z < ZONE.BRIDGEHEAD) && JSON.stringify(ann.global.schemHints) === JSON.stringify(game.schemHints) && rumours().length === 5, game.schemHints.join());
  }

  // ---- the backpack (it sorts itself after a pickup or a drop; the last drop can be taken back: ACT.UNDO_DROP)
  {
    const raw = (c, game, fn) => {
      const m = new Writer(16);
      m.u8(C2S.ACTION);
      fn(m);
      game.onMessage(c.session, m.bytes());
    };
    const drop = (c, game, idx, n) =>
      raw(c, game, (m) => {
        m.u8(ACT.DROP_SLOT);
        m.u8(idx);
        m.u16(n);
      });
    const undo = (c, game) => raw(c, game, (m) => m.u8(ACT.UNDO_DROP));
    let carried = '';
    let wire = '';
    let dropped = null;
    const g = land('nightfall', (game, ann) => {
      const a = ann.p();
      for (const [it, n] of [[ITEM.SCRAP, 9], [ITEM.MEDKIT, 2], [ITEM.CLOTH, 5], [ITEM.AMMO_762, 60], [ITEM.AK47, 1], [ITEM.ROPE, 3]]) game.giveItem(a, it, n);
      a.backpackItem = ITEM.BACKPACK;
      ticks(game, 0.2);
      // (her last act on the island: three scrap put down by the car)
      drop(ann, game, a.inv.findIndex((it) => it?.item === ITEM.SCRAP), 3);
      ticks(game, 0.2);
      dropped = a.lastDrop?.e;
      carried = kitOf(a);
      wire = JSON.stringify(ann.inv);
    });
    const { game, notes, ann, a, b } = g;
    // (sorted: sorting it again changes nothing)
    const sorted = (p) => {
      const copy = p.inv.map((it) => (it ? { ...it } : null));
      sortInventory(copy, invCap(p), new Map(p.splitKeep));
      return JSON.stringify(copy) === JSON.stringify(p.inv);
    };
    const onWire = (c) => JSON.stringify(c.inv.map((it) => (it.item ? [it.item, it.count] : 0))) === JSON.stringify(c.p().inv.map((it) => (it ? [it.item, it.count] : 0)));
    check('a sorted backpack comes over the bridge slot for slot, the pack on her back with it', !!dropped && countItem(a.inv, ITEM.SCRAP) === 6 && kitOf(a) === carried && sorted(a) && a.backpackItem === ITEM.BACKPACK && JSON.stringify(ann.inv) === wire && onWire(ann), `${kitOf(a)}\n      ${carried}`);
    check('...and what the cache gave the one with nothing lies sorted in his, as his client was told', countItem(b.inv, ITEM.BANDAGE) === BRIDGEHEAD.BANDAGES && sorted(b) && !b.invSort && onWire(g.ben), JSON.stringify(b.inv));
    notes.length = 0;
    undo(ann, game);
    ticks(game, 0.2);
    check('the drop she made on the island cannot be taken back from the mainland: she is told it is gone, and nothing is made of it', dropped.removed && countItem(a.inv, ITEM.SCRAP) === 6 && notes.some((n) => n[0] === NOTIFY.UNDO_GONE && n[1] === UNDO_NO.GONE && n[2] === a.id) && kitOf(a) === carried, JSON.stringify(notes));
    // on the mainland itself: a drop, taken back; a pickup, sorted in
    const cloth = countItem(a.inv, ITEM.CLOTH);
    drop(ann, game, a.inv.findIndex((it) => it?.item === ITEM.CLOTH), 2);
    ticks(game, 0.2);
    const down = countItem(a.inv, ITEM.CLOTH);
    undo(ann, game);
    ticks(game, 0.2);
    check('on the mainland a drop is taken back as on the island', cloth >= 5 && down === cloth - 2 && countItem(a.inv, ITEM.CLOTH) === cloth && sorted(a) && onWire(ann) && kitOf(a) === carried, `${cloth}, ${down}, then ${countItem(a.inv, ITEM.CLOTH)}`);
    const nails = countItem(a.inv, ITEM.NAILS);
    game.giveItem(a, ITEM.NAILS, 7);
    ticks(game, 0.2);
    check('...and what is picked up there is sorted in', countItem(a.inv, ITEM.NAILS) === nails + 7 && sorted(a) && onWire(ann), `${nails} then ${countItem(a.inv, ITEM.NAILS)}`);
    wipe(g);
    check('a wipe ends the run: on the next island each has a new starting kit, and their clients are told', game.act === WORLD.ISLAND && kitOf(a) !== carried && countItem(a.inv, ITEM.SCRAP) === 0 && !a.backpackItem && onWire(ann) && onWire(g.ben), `${kitOf(a)}`);
  }

  // ---- the bestiary: what is met on the mainland goes onto the record the island began
  {
    const g = land('nightfall', (game, ann) => {
      const p = ann.p();
      game.zm.spawn(ZTYPE.RUNNER, p.state.x + 6, p.state.z + 1);
      ticks(game, 1);
    });
    const { game, a } = g;
    const runner = bit(ZTYPE.RUNNER);
    check('a kind seen on the island is on the record across the bridge', !!(a.bst.seen & runner), String(a.bst.seen));
    // out on the runway, a kilometre from the bridge and well past where the island's map ends
    for (const z of [...game.zombies]) {
      game._listRemove(game.zombies, z);
      game.removeEntity(z);
    }
    const plane = game.world.car;
    put(game, a, plane.x, plane.z - 30);
    const tank = game.zm.spawn(ZTYPE.TANK, plane.x + 1, plane.z - 42);
    ticks(game, 1);
    check(`one met on the mainland (${Math.round(plane.x)} m east: past the island's edge) is seen and recorded`, !!tank && !!(a.bst.seen & bit(ZTYPE.TANK)) && !!(a.bst.seen & runner) && plane.x > MAP_SIZE / 2, `seen ${a.bst.seen}`);
    wipe(g);
    check('...and a wipe takes nothing off the record', !!(a.bst.seen & bit(ZTYPE.TANK)) && !!(a.bst.seen & runner));
  }

  // ---- the dead fanning out of a crowd, and dogs that bite and run, on the mainland's own nav grid
  {
    const g = land('nightfall');
    const { game, a } = g;
    const clear = () => {
      for (const z of [...game.zombies]) {
        game._listRemove(game.zombies, z);
        game.removeEntity(z);
      }
      game.zm.herds.reset();
      game.zm.maintainT = game.zm.herds.spawnT = 1e9;
    };
    const plane = game.world.car;
    const spot = { x: plane.x, z: plane.z - 60 }; // (on the runway: open ground, far outside the island's 640 m)
    put(game, a, spot.x, spot.z);
    // a column of walkers down the runway at her, the first 20 m off, each 2 m behind the last: the arc they come in on
    const column = (spread) => {
      clear();
      game.zm.spreadOut = spread ? Object.getPrototypeOf(game.zm).spreadOut : () => false;
      const zs = [];
      for (let i = 0; i < 12; i++) {
        const z = game.zm.spawn(ZTYPE.WALKER, spot.x, spot.z - 20 - i * 2, { horde: true });
        if (z) zs.push({ z, b: null });
      }
      let fanned = 0;
      let reach = Infinity;
      for (let i = 0; i < 25 * 20 && zs.some((e) => e.b === null); i++) {
        game.timeLeft += 0.05;
        game.update();
        for (const e of zs) {
          if (e.z.spreadFor) fanned++;
          if (e.b !== null || Math.hypot(e.z.x - a.state.x, e.z.z - a.state.z) > 3.2) continue;
          e.b = Math.atan2(e.z.x - a.state.x, -(e.z.z - a.state.z));
        }
        if (i === 40) reach = game.nav.fieldDist(a.id, zs[0].z.x, zs[0].z.z);
      }
      const bs = zs.filter((e) => e.b !== null).map((e) => e.b);
      return { n: zs.length, arrived: bs.length, arc: bs.length ? Math.max(...bs) - Math.min(...bs) : 0, fanned, reach };
    };
    const file = column(false);
    const fan = column(true);
    delete game.zm.spreadOut;
    const deg = (r) => Math.round((r * 180) / Math.PI);
    check("the way round to a survivor is known out there (the flow field's window follows the mainland's grid)", Number.isFinite(fan.reach) && fan.reach > 0 && spot.x > MAP_SIZE / 2, `fieldDist ${fan.reach} at x ${Math.round(spot.x)}`);
    check('a column of the dead on the runway fans out and comes in at angles, and every one gets there', fan.fanned > 0 && file.fanned === 0 && fan.arrived === fan.n && file.arrived === file.n && fan.arc > Math.max(file.arc * 1.5, (30 * Math.PI) / 180), `arc ${deg(file.arc)} deg in single file, ${deg(fan.arc)} deg fanned out; ${fan.arrived}/${fan.n} arrived`);
    // one dog: bites, breaks off, comes back
    clear();
    const bites = [];
    game.damagePlayer = (p, amount, src) => {
      if (src?.ztype === ZTYPE.DOG) bites.push(game.time);
    };
    const dog = game.zm.spawn(ZTYPE.DOG, spot.x + 3, spot.z - 14, { horde: true });
    let off = 0;
    let beside = 0;
    const T = 30 * 20;
    for (let i = 0; i < T; i++) {
      game.timeLeft += 0.05;
      game.update();
      if (dog.state === 7) off++;
      if (Math.hypot(dog.x - a.state.x, dog.z - a.state.z) < 1.8) beside++;
    }
    delete game.damagePlayer;
    const gaps = bites.slice(1).map((t, i) => t - bites[i]);
    check('a dog on the mainland bites, breaks off and comes back in: seconds between its bites, little of the time beside her', !!dog && bites.length >= 3 && Math.min(...gaps) >= 1 && off > 0 && beside / T < 0.35, `${bites.length} bites, gaps ${gaps.map((x) => x.toFixed(1)).join(' ')}, broken off ${off} ticks, beside ${Math.round((beside / T) * 100)}% of the time`);
  }
}

// ================================================================ the admin's /map2: straight to the mainland
{
  const game = new Game({ seed: SEED, log: quiet, themes: false });
  const ann = client(game, 'Ann', randomUUID());
  const ben = client(game, 'Ben', randomUUID());
  ticks(game, 1);
  const a = ann.p();
  const b = ben.p();
  const world = game.world;
  game.handleChat(a, '/map2');
  check('/map2 from somebody who is not an admin does nothing', game.act === WORLD.ISLAND && game.phase === PHASE.DAY && game.world === world);
  a.admin = true;
  game.day = 2;
  const xp = [game.xpOf(a), game.xpOf(b)];
  game.handleChat(a, '/map2');
  check('an admin\'s /map2 mid-day: the first day on the mainland, at once, everybody at the bridgehead', game.act === WORLD.MAINLAND && game.world.kind === WORLD.MAINLAND && game.phase === PHASE.DAY && !game.crossing && game.day === 2 && [a, b].every((p) => p.alive && near(p, game.world.start, 16)) && ann.resets.some((r) => r.act === WORLD.MAINLAND), `act ${game.act} phase ${game.phase} day ${game.day}`);
  check('...with no XP for an escape nobody made', game.xpOf(a) === xp[0] && game.xpOf(b) === xp[1], `${game.xpOf(a)}/${xp[0]} ${game.xpOf(b)}/${xp[1]}`);
  const main = game.world;
  game.handleChat(a, '/mainland');
  check('...and again on the mainland changes nothing', game.world === main && game.phase === PHASE.DAY && game.act === WORLD.MAINLAND);
  ticks(game, 1);

  const g2 = new Game({ seed: SEED, log: quiet, themes: false, devAdmin: true });
  const cy = client(g2, 'Cy', randomUUID());
  ticks(g2, 1);
  const c = cy.p();
  g2.killPlayer(c, { kind: 3 });
  g2.checkAllDead();
  check('(a wipe on the island: the end screen)', g2.phase === PHASE.GAMEOVER && g2.act === WORLD.ISLAND);
  g2.handleChat(c, '/map2');
  check('/map2 from the end screen: a new run, straight onto the mainland\'s first day', g2.phase === PHASE.DAY && g2.act === WORLD.MAINLAND && g2.day === 1 && c.alive && !c.zombie && near(c, g2.world.start, 16), `phase ${g2.phase} act ${g2.act} day ${g2.day}`);
  ticks(g2, 1);

  const g3 = new Game({ seed: SEED, log: quiet, themes: false, devAdmin: true });
  const dee = client(g3, 'Dee', randomUUID());
  ticks(g3, 1);
  g3.cross(dee.p());
  ticks(g3, 1);
  g3.handleChat(dee.p(), '/map2');
  check('/map2 during the crossing cuts it short', g3.phase === PHASE.DAY && g3.act === WORLD.MAINLAND && g3.world.kind === WORLD.MAINLAND && !g3.crossing, `phase ${g3.phase} act ${g3.act}`);
  ticks(g3, 1);

  g3.handleChat(dee.p(), '/cutscene');
  check('/cutscene from the mainland: a new run on the island, and the crossing with its cutscene at its start', g3.phase === PHASE.CROSSING && g3.act === WORLD.ISLAND && g3.world.kind === WORLD.ISLAND && !!g3.crossing && g3.crossing.pending === 2 && g3.timeLeft === CROSSING.TIME && !g3.checkpoint, `phase ${g3.phase} act ${g3.act} pending ${g3.crossing?.pending}`);
  g3.handleChat(dee.p(), '/cutscene');
  check('...and again mid-crossing does not start it over', g3.phase === PHASE.CROSSING && g3.timeLeft === CROSSING.TIME);
  ticks(g3, 1);

  const g4 = new Game({ seed: SEED, log: quiet, themes: false, devAdmin: true });
  const eve = client(g4, 'Eve', randomUUID());
  ticks(g4, 1);
  g4.killPlayer(eve.p(), { kind: 3 });
  g4.checkAllDead();
  g4.handleChat(eve.p(), '/cross');
  check('/cross from the end screen: a new run, and the crossing to the mainland', g4.phase === PHASE.CROSSING && g4.act === WORLD.ISLAND && !!g4.crossing, `phase ${g4.phase} act ${g4.act}`);
}

// ================================================================ the admin's /map1: back to the island
{
  const game = new Game({ seed: SEED, log: quiet, themes: false });
  const ann = client(game, 'Ann', randomUUID());
  const ben = client(game, 'Ben', randomUUID());
  ticks(game, 1);
  const a = ann.p();
  const b = ben.p();
  a.admin = true;
  const island = game.world;
  game.handleChat(a, '/map1');
  check('/map1 on the island changes nothing', game.world === island && game.act === WORLD.ISLAND && game.phase === PHASE.DAY);
  game.handleChat(a, '/map2');
  ticks(game, 1);
  game.day = 3;
  a.admin = false;
  game.handleChat(a, '/map1');
  check('/map1 from somebody who is not an admin does nothing', game.act === WORLD.MAINLAND && game.world.kind === WORLD.MAINLAND && game.day === 3);
  a.admin = true;
  const resets = ann.resets.length;
  game.handleChat(a, '/map1');
  check('an admin\'s /map1 on the mainland: a new run on the island\'s first day, everybody at its start', game.act === WORLD.ISLAND && game.world.kind === WORLD.ISLAND && game.phase === PHASE.DAY && game.day === game.startDayNum && !game.checkpoint && !game.crossing && [a, b].every((p) => p.alive && !p.zombie && near(p, game.world.start, 16)) && ann.resets.slice(resets).some((r) => r.act === WORLD.ISLAND), `act ${game.act} phase ${game.phase} day ${game.day}`);
  ticks(game, 1);

  const g2 = new Game({ seed: SEED, log: quiet, themes: false, devAdmin: true });
  const cy = client(g2, 'Cy', randomUUID());
  ticks(g2, 1);
  const c = cy.p();
  g2.handleChat(c, '/map2');
  ticks(g2, 1);
  g2.killPlayer(c, { kind: 3 });
  g2.checkAllDead();
  check('(a wipe on the mainland: the end screen)', g2.phase === PHASE.GAMEOVER && g2.act === WORLD.MAINLAND && !!g2.checkpoint);
  g2.handleChat(c, '/island');
  check('/island from the mainland\'s end screen: the island, not the bridge', g2.phase === PHASE.DAY && g2.act === WORLD.ISLAND && g2.world.kind === WORLD.ISLAND && !g2.checkpoint && c.alive && near(c, g2.world.start, 16), `phase ${g2.phase} act ${g2.act}`);
  ticks(g2, 1);

  const g3 = new Game({ seed: SEED, log: quiet, themes: false, devAdmin: true });
  const dee = client(g3, 'Dee', randomUUID());
  ticks(g3, 1);
  g3.cross(dee.p());
  g3.buildMainland(true);
  g3.handleChat(dee.p(), '/map1');
  check('/map1 during the crossing (the mainland already built): back on the island, the crossing called off', g3.phase === PHASE.DAY && g3.act === WORLD.ISLAND && g3.world.kind === WORLD.ISLAND && !g3.crossing, `phase ${g3.phase} act ${g3.act}`);
  ticks(g3, 1);
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
