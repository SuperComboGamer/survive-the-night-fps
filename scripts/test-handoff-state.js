// A game saved by a server going down and loaded by the next one (server/gamestate.js, handoff.js), on the Game
// itself: a run is played into its first night, saved, put through the codec and restored into a new Game, and the
// two are compared - the run's progress, the players, what was built, dropped, searched, felled and stripped, the
// dead walking about. Then the unsaved-field check: both games are walked whole, and every field that came back
// different is a failure unless it is on TRANSIENT below - so a field added later that nobody saves fails here,
// instead of resetting on every deploy. And: players come back into their own bodies with their browser id, one
// who does not is let go after HANDOFF_RESERVE as a leaver, and a save this build cannot read is refused.
process.env.HANDOFF_RESERVE_SECONDS = '6';
process.env.HANDOFF_FREEZE_SECONDS = '0'; // (the restored game runs on at once: its waiting for its players is scripts/test-handoff-safe.js)
const { Game } = await import('../server/game.js');
const { envelope, encode, decode, HandoffError } = await import('../server/handoff.js');
const { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, ENT } = await import('../shared/protocol.js');
const { PHASE, SLOT_BUILD } = await import('../shared/constants.js');
const { ITEM, STRUCT, ZTYPE, COL } = { ...(await import('../shared/defs.js')), ...(await import('../shared/collision.js')) };
const { randomUUID } = await import('node:crypto');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const quiet = () => {};
const join = (game, name, pid) => {
  const c = { id: 0, chats: [], snaps: 0, reject: 0 };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.REJECT) c.reject = r.u8();
      else if (t === S2C.SNAPSHOT) c.snaps++;
      else if (t === S2C.CHAT) {
        r.u16();
        r.u8();
        c.chats.push(r.str());
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
  return c;
};
const tick = (game, sec) => {
  for (let i = 0, n = Math.round(sec * 20); i < n; i++) game.update();
};

// ---------------------------------------------------------------- a run, into its first night
const A = new Game({ seed: 4242, dayLength: 3600, godMode: true, log: process.env.DEBUG ? console.log : quiet }); // (nobody dies: a wipe would start another run)
const ids = { ann: randomUUID(), ben: randomUUID(), cy: randomUUID(), dee: randomUUID() };
const ann = join(A, 'Ann', ids.ann);
const ben = join(A, 'Ben', ids.ben);
const cy = join(A, 'Cy', ids.cy);
const bot = join(A, 'Bot', ''); // (no browser id: nobody can take this one back)
tick(A, 2);
const pa = A.players.get(ann.id);
const pb = A.players.get(ben.id);
// somebody who left this run with what was left of their kit (leftKits), and somebody who left it dead (fallen)
const dee = join(A, 'Dee', ids.dee);
tick(A, 0.5);
A.onClose(dee.session, 4001);
A.fallen.add('g:someone');
// the run's progress
A.supplies[0] = 1;
A.unlocked = 0b101;
pa.hp = 61;
pa.state.x += 4;
pa.kills = 7;
A.giveItem(pa, ITEM.WOOD, 30);
A.giveItem(pa, ITEM.NAILS, 30);
A.giveItem(pb, ITEM.SHOTGUN, 1);
pb.armorItem = ITEM.KEVLAR;
pb.armor = 40;
pb.armorMax = 100;
// something built
pa.state.slot = SLOT_BUILD;
for (let k = 0; k < 24 && !A.structures.length; k++) {
  pa.actionT = -9; // (one build a quarter second)
  A.build(pa, STRUCT.BARRICADE, pa.state.x + 3 * Math.sin(k), pa.state.z + 3 * Math.cos(k), (k * 32) & 255);
}
check('a structure to save', A.structures.length === 1);
if (A.structures[0]) A.structures[0].hp = 333;
// something dropped (and a car part, which never despawns), a container searched
A.dropItem(ITEM.MEDKIT, 1, pb.state.x, pb.state.y, pb.state.z);
const part = A.items.find((e) => e.hint >= 0);
check('a car part lying in its hiding place', !!part && part.despawnAt === Infinity);
A.caches[3].state = 1;
// a tree felled and a wreck stripped
const near = [];
const tree = A.world.staticGrid.query(0, 0, 400, near).find((c) => c.flags & COL.TREE);
A.gather.set(tree, { left: 0 });
A.fellTree(tree, 0);
const wreck = A.world.staticGrid.query(0, 0, 400, near).find((c) => c.flags & COL.SALVAGE);
if (wreck) A.gather.set(wreck, { left: 2 });
// nightfall and a minute of it: the horde is out
A.timeLeft = 0.05;
tick(A, 60);
check('night has fallen and the horde is out', A.phase === PHASE.NIGHT && A.zombies.some((z) => z.horde), `${A.phase} ${A.zombies.filter((z) => z.horde).length}`);
const herd = [...A.zm.herds.list.values()][0];
// what a player has earned towards an achievement and not sent yet, and the places they have been this run
A.ach.bump(pa, 'kills', 3);
A.ach.of(pa).places.add(A.world.zones[1].id);
// ...and their experience: what was on their record before this run, and this run's
pa.xpBase = 1200;
pa.best = 3;
A.award(pa, 0, 75);
// ...a boss mid-fight, a survivor down and bleeding, one dead, and a wreck that took blows and is ringing
const boss = A.zm.spawn(ZTYPE.BOSS_BRUTE, pa.state.x + 25, pa.state.z + 5, { horde: true });
if (boss) {
  boss.hp = Math.round(boss.maxHp * 0.4);
  A.bossId = boss.id;
}
pb.downed = true;
pb.bleed = 17.5;
const pc = A.players.get(cy.id);
pc.alive = false;
if (wreck) {
  A.gather.set(wreck, { left: 2, hits: [[3, 1, 2, 0, 4, 1]], alarm: 4 });
  A.ringing.add(wreck); // (ALARM.RINGING, as the game has it)
}

// ---------------------------------------------------------------- saved, encoded, restored
const t0 = performance.now();
const env = envelope(A);
const buf = encode(env);
const saveMs = performance.now() - t0;
check(`the save is small: ${(buf.length / 1024).toFixed(0)} KB gzipped, ${saveMs.toFixed(0)} ms`, buf.length < 600 * 1024 && saveMs < 250);
const t1 = performance.now();
const B = new Game({ dayLength: 3600, log: quiet, restore: decode(buf) });
console.log(`      (restored in ${(performance.now() - t1).toFixed(0)} ms, the valley included)`);

const same = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n   was ${JSON.stringify(a)?.slice(0, 300)}\n   now ${JSON.stringify(b)?.slice(0, 300)}`);
same('the valley, the clock and the phase', [A.seed, A.tick, A.time, A.phase, A.day, A.timeLeft], [B.seed, B.tick, B.time, B.phase, B.day, B.timeLeft]);
same("the run's progress: supplies, schematics, hints", [A.supplies, A.unlocked, A.supplyHints, A.supplyFound], [B.supplies, B.unlocked, B.supplyHints, B.supplyFound]);
same("the night's waves and what is left of them", A.waves, B.waves);
same('who left with their kit, and who left dead', [[...A.leftKits], [...A.fallen]], [[...B.leftKits], [...B.fallen]]);
const pl = (g) => [...g.players.values()].map((p) => ({ id: p.id, name: p.name, x: p.state.x, y: p.state.y, z: p.state.z, hp: p.hp, armor: p.armor, inv: p.inv, w: p.state.weapons, mags: p.state.mags, ammo: p.state.ammo, kit: p.kit, kills: p.kills, key: p.rejoinKey }));
same('every player: where they stood, health, armour, weapons, backpack, kit, kills', pl(A), pl(B));
check('...waiting to come back (held), not playing', [...B.players.values()].every((p) => p.away && p.away.handoff));
const st = (g) => g.structures.map((e) => [e.id, e.stype, e.x, e.y, e.z, e.rot8, e.hp, e.owner]);
same('what was built, with its health and who built it', st(A), st(B));
check('...standing in the world again: it blocks the way and the nav grid', B.structures.every((e) => e.collider && e.collider.cells && B.world.structGrid.query(e.x, e.z, 0.1, []).includes(e.collider)));
const it = (g) => g.items.map((e) => [e.id, e.item, e.count, e.x, e.z, e.despawnAt, e.hint, e.point ? g.lootPoints.indexOf(e.point) : -1]);
same('what lies on the ground: the same items, where they were, for as long (a car part for good)', it(A), it(B));
check('...and the loot points know their items again', B.items.every((e) => !e.point || e.point.ent === e));
same('the containers, searched or not', A.caches.map((c) => [c.id, c.state, c.schem]), B.caches.map((c) => [c.id, c.state, c.schem]));
same('the felled tree is down, the stripped wreck stripped', [A.world.felled.length, [...A.gather.values()]], [B.world.felled.length, [...B.gather.values()]]);
check('...the tree is out of the world on the new valley too', !B.world.staticGrid.query(tree.x, tree.z, 0.2, []).some((c) => c.flags & COL.TREE && Math.abs(c.x - tree.x) < 0.01 && Math.abs(c.z - tree.z) < 0.01));
const zs = (g) => g.zombies.map((z) => [z.id, z.ztype, z.x, z.y, z.z, z.hp, z.maxHp, z.horde, z.boss, z.legs, z.herd]);
same('the dead: each one where it was, as hurt, of the same kind, the horde still the horde', zs(A), zs(B));
same('the boss is still the boss', A.bossId, B.bossId);
check('...mid-fight: as hurt as it was', !!boss && B.zombies.find((z) => z.id === boss.id)?.hp === boss.hp && B.bossId === boss.id, `${boss?.hp} -> ${B.zombies.find((z) => z.id === boss?.id)?.hp}`);
same('a survivor down and bleeding is still down, bleeding as much; one dead is still dead', [pb.downed, pb.bleed, pc.alive], [B.players.get(ben.id).downed, B.players.get(ben.id).bleed, B.players.get(cy.id).alive]);
check('a wreck keeps the blows it took, and its alarm rings on', !wreck || (JSON.stringify(B.gather.get([...B.gather.keys()].find((c) => c.x === wreck.x && c.z === wreck.z))) === JSON.stringify(A.gather.get(wreck)) && [...B.ringing].some((c) => c.x === wreck.x && c.z === wreck.z)));
if (herd) same('the wandering herd', herd.id, [...B.zm.herds.list.values()][0]?.id);
same('the mounted gun, the fair, the handcars', [A.gun.save(), A.fair.save(), A.handcars.save()], [B.gun.save(), B.fair.save(), B.handcars.save()]);
same('the bell and the cemetery', [A.fixtures.save(), A.cemetery.save()], [B.fixtures.save(), B.cemetery.save()]);
const ach = (g) => [g.ach.save(), [...g.players.values()].map((p) => p.ach && { add: p.ach.add, places: [...p.ach.places], sent: [...p.ach.sent] })];
same("achievements: what each player has earned and not sent yet, the places they have been, the run's own", ach(A), ach(B));
const xp = (g) => [...g.players.values()].map((p) => [g.xpOf(p), p.xpRun, p.best, p.perks, p.xpLoaded]);
same('experience: on the record before this run, this run by source, the best day, the perks', xp(A), xp(B));
check('no entity has an id another has, and every one is in the registry', B.all.every((e) => B.ents[e.id] === e) && new Set(B.all.map((e) => e.id)).size === B.all.length);
check('the deer and the cat are out again', B.deer.length > 0 && B.cats.length > 0);

// ---------------------------------------------------------------- the unsaved-field check
// Paths (ids and indices as *) that may come back different: derived, rebuilt, the connection's, or started afresh
// on purpose (gamestate.js says which and why). Anything else that differs was forgotten.
const TRANSIENT = [
  // the game: the connection, the clocks of the network side, things rebuilt from the valley
  /^game\.(godMode|fixedSeed|dayLenOverride|nightLen|startDayNum|dawnReturn|themes|maxDrops|adminHash|rollWhenEmpty)\b/, // (the new server's own options)
  /^game\.(rng|sessions|joins|greets|log|records|w|ew|events|stats|tickStats|track|globalDirty|playersDirty|playersListT|cw|gw|listBytes|listVer|world|nav|mineNav|lootPoints\.\*\.ent|thawAt|frozenAt)\b/,
  // (the ids that had a custom look, told to the clients: every one is back through resume, which tells them again)
  /^game\.lookIds\b/,
  /^game\.(ents|all|freeIds|gens|deer|cats|projectiles|areas)\b/, // (the registry is checked above; the deer, the cat and what was in flight start afresh)
  // a player: their connection, and what resume starts afresh for the client that comes back
  /^players\.\*\.(session|rec|view|shadow|cmdQueue|cmdBudget|hx|hy|hz|selfSync|away|arriving|ts|invDirty|selfCache|globalCache|listVer|snapTick|ackSent|greeted)\b/,
  // a zombie: its position history (filled again), and what its spatial hash is
  /^zombies\.\*\.(hx|hy|hz)\b/,
  /^zm\.(head|next|humansCache|crowdList|lights|lightTick|treeGrid|dens|spawnPicks|spawnsScreened|spawnsInView|fieldRR)\b/,
  /^zm\.herds\.list\.\*\.(members|fieldT)\b/,
  /^zm\.wards\.(seed|rng)\b/, // (its stream: drawn again from the seed when first needed)
  /^structures\.\*\.collider\.(stamp|_rs)\b/, // (a grid query's scratch marks)
  /^cemetery\.rng\b/,
  /^game\.ach\.(world|village|deep)\b/, // (the achievements' spots in the valley: found again from the valley)
  /^power\.(rng|running|cones)\b/,
  /^dm\b/,
  /^cm\b/,
];
const transient = (path) => TRANSIENT.some((re) => re.test(path));
const diffs = [];
let roots = new Set(); // (what is walked on its own: a system's way back to its game, the valley, another system)
function walk(a, b, path, depth = 0) {
  if (transient(path) || depth > 7) return;
  if (a === b || (depth > 0 && roots.has(a))) return;
  if (typeof a === 'number' && typeof b === 'number' && (Math.abs(a - b) < 1e-9 || (Number.isNaN(a) && Number.isNaN(b)))) return;
  if (typeof a === 'function' || typeof b === 'function') return;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return diffs.push(`${path}: ${String(a).slice(0, 40)} -> ${String(b).slice(0, 40)}`);
  if (a instanceof DataView || a instanceof ArrayBuffer) return; // (a writer's scratch space)
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b) && a.length === b.length && a.every((v, i) => v === b[i] || Math.abs(v - b[i]) < 1e-9)) return;
    return diffs.push(`${path}: typed array`);
  }
  // an entity inside something else is a reference: the same one is enough
  if (depth > 0 && typeof a.kind === 'number' && typeof a.id === 'number' && a.id !== undefined) {
    if (a.id !== b.id) diffs.push(`${path}: entity ${a.id} -> ${b.id}`);
    return;
  }
  if (a instanceof Map || a instanceof Set) {
    if (!(b instanceof Map || b instanceof Set) || a.size !== b.size) return diffs.push(`${path}: ${a.constructor.name} of ${a.size} -> ${b?.size}`);
    if (a instanceof Map) {
      for (const [k, v] of a) if (typeof k !== 'object') walk(v, b.get(k), `${path}.*`, depth + 1);
    }
    return;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return diffs.push(`${path}: array of ${a.length} -> ${b?.length}`);
    a.forEach((v, i) => walk(v, b[i], `${path}.*`, depth + 1));
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const da = Object.getOwnPropertyDescriptor(a, k);
    if (da && !('value' in da)) continue; // (a getter: what it reads is checked where it is kept)
    walk(a[k], b[k], `${path}.${k}`, depth + 1);
  }
}
const SUBS = ['zm', 'cm', 'dm', 'combat', 'fixtures', 'cemetery', 'gun', 'fair', 'handcars', 'power'];
const LISTS = ['players', 'zombies', 'items', 'structures', 'caches', 'crates'];
const gameOwn = (g) => Object.fromEntries(Object.entries(g).filter(([k]) => !SUBS.includes(k) && !LISTS.includes(k)));
roots = new Set([A, A.world, A.nav, A.mineNav, ...SUBS.map((k) => A[k])].filter(Boolean));
walk(gameOwn(A), gameOwn(B), 'game');
for (const k of SUBS) walk(A[k], B[k], k);
const byId = (list) => new Map([...(list.values ? list.values() : list)].map((e) => [e.id, e]));
for (const k of LISTS) {
  const a = byId(A[k]);
  const b = byId(B[k]);
  for (const [id, e] of a) walk(e, b.get(id), `${k}.*`);
  if (a.size !== b.size) diffs.push(`${k}: ${a.size} -> ${b.size}`);
}
check('every field of every entity and system came back as it was (or is listed as transient)', !diffs.length, `\n   ${[...new Set(diffs)].slice(0, 40).join('\n   ')}`);

// ---------------------------------------------------------------- coming back
tick(B, 0.5);
const ann2 = join(B, 'Ann', ids.ann);
const pa2 = B.players.get(ann.id);
check('the same browser is given back its own body', ann2.id === ann.id && pa2 && !pa2.away, `${ann2.id} vs ${ann.id}`);
check('...and told the server was updated', ann2.chats.some((t) => /server was updated/.test(t)), JSON.stringify(ann2.chats));
// the network thread answers the new record's lookup with the XP it holds, this run's in it already: not counted twice
const had = B.xpOf(pa2);
B.setProgress(pa2, { first: true, xp: 1275, perks: [], best: 3 });
check("...and their record's XP, which holds this run's already, is not counted twice", B.xpOf(pa2) === had && had === 1275, `${had} -> ${B.xpOf(pa2)}`);
const ben2 = join(B, 'Benjamin', ids.ben);
check('another name, the same browser: their own body and name all the same', ben2.id === ben.id && B.players.get(ben.id).name === 'Ben');
const stranger = join(B, 'Cy', randomUUID());
check('somebody else under a name of theirs is a newcomer', stranger.id && stranger.id !== cy.id && B.players.get(stranger.id)?.name !== 'Cy');
tick(B, 2);
check('the game runs on and streams to them', ann2.snaps > 20 && B.phase === PHASE.NIGHT, String(ann2.snaps));
check('...and the dead go for those who are back', B.zombies.some((z) => z.target === ann.id || z.target === ben.id || z.target === stranger.id) || B.zombies.filter((z) => z.horde).length === 0);
// who does not come back is let go after the reserve, as a leaver: their kit parked under their key, the rest dropped
const cyP = B.players.get(cy.id);
const cyHad = cyP.inv.filter(Boolean).length;
tick(B, 6);
check("one who does not come back is let go once their place's time is up", !B.players.has(cy.id) && !B.players.has(bot.id), [...B.players.values()].map((p) => p.name).join(' '));
check('...as a leaver: their kit parked for them', B.leftKits.has(`g:${(await import('../server/stats.js')).idKey(ids.cy)}`) && cyHad > 0);

// ---------------------------------------------------------------- saves this build cannot read
const refused = (why, mutate) => {
  const e = decode(buf);
  mutate(e);
  try {
    new Game({ dayLength: 3600, log: quiet, restore: e });
    check(why, false, 'it was restored');
  } catch (err) {
    check(why, err instanceof HandoffError, err.stack);
  }
};
refused('a save of another state version is refused', (e) => e.stateVersion++);
refused('...and one where an item has been renumbered since', (e) => (e.enums.ITEM.SHOTGUN += 100));
refused('...and one of a valley this build makes differently', (e) => (e.worldShape = 'nope'));
check('...but an entry that is only new in this build is fine', (() => {
  const e = decode(buf);
  delete e.enums.ITEM.SHOTGUN; // (as if the save's build had not had it: this one adds it)
  try {
    return !!new Game({ dayLength: 3600, log: quiet, restore: e });
  } catch {
    return false;
  }
})());

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
