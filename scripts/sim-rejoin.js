// The rules of a held player (server/game.js hold / resume), on the Game itself: while their connection is gone they are
// safe - no damage, the dead pick somebody else, a downed one's bleed-out clock stops - they stay where they were, and
// they come back with the same body, spot, health and backpack; the run does not end for want of them; a held player
// is let go when REJOIN_GRACE runs out (as a leaver: their kit parked, their finds dropped). The new client is told
// all of it - a zombie comes back to a zombie's HUD - and leaving dead, then rejoining under another name, is no way
// back to being a survivor (issue #94).
process.env.REJOIN_GRACE_SECONDS = '5';
const { Game, REJOIN_GRACE } = await import('../server/game.js');
const { C2S, S2C, PROTOCOL_VERSION, LEFT_CODE, Writer, Reader } = await import('../shared/protocol.js');
const { PHASE } = await import('../shared/constants.js');
const { ZTYPE, AMMO_ITEMS } = await import('../shared/defs.js');
const { SNAP } = await import('../shared/protocol.js');
const { readHeader, readGlobal, readSelf } = await import('../client/net/decode.js');
const { randomUUID } = await import('node:crypto');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const game = new Game({ seed: 4242, dayLength: 3600, log: () => {} });
// c.self / c.global: what this client knows of itself and the run, read with the client's own decoders and starting
// from its own defaults (client/game/game.js this.self)
const join = (name, pid) => {
  const c = { id: 0, chats: [], net: {}, global: null, self: { alive: 1, hp: 100, maxHp: 100, armor: 0, armorMax: 0, battery: 100, weapons: [0, 0, 0, 0, 0], mags: [0, 0], ammo: AMMO_ITEMS.map(() => 0) } };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) {
        const flags = readHeader(r, c.net);
        if (flags & SNAP.GLOBAL) c.global = readGlobal(r, c.global);
        readSelf(r, c.self, flags);
      } else if (t === S2C.CHAT) {
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
const tick = (sec) => {
  for (let i = 0, n = Math.round(sec * 20); i < n; i++) game.update();
};

check('the grace time can be set for tests', REJOIN_GRACE === 5, String(REJOIN_GRACE));
const annId = randomUUID();
const ann = join('Ann', annId);
const ben = join('Ben', randomUUID());
tick(1);
check('a run is on with two players', game.phase === PHASE.DAY && game.players.size === 2, `${game.phase} ${game.players.size}`);
const p = game.players.get(ann.id);
p.state.x += 3; // (somewhere of their own)
const spot = { x: p.state.x, z: p.state.z };
p.hp = 63;
const inv = JSON.stringify(p.inv);

// the link drops
game.onClose(ann.session, 1006);
check('a dropped player is held, not removed', game.players.get(ann.id) === p && !!p.away);
check('...and the team is told', ben.chats.some((t) => /lost connection/.test(t)), JSON.stringify(ben.chats));
game.damagePlayer(p, 40, { kind: 0 });
check('nothing hurts a held player', p.hp === 63 && p.alive, String(p.hp));
const z = game.zm.spawn(ZTYPE.WALKER ?? 0, p.state.x + 2, p.state.z + 1);
if (z) {
  z.targetT = 0;
  game.zm.chooseTarget(z, game.humans());
  const bp = game.players.get(ben.id);
  bp.state.x += 200; // (the other player far off: the held one is the only survivor in reach)
  game.zm.chooseTarget(z, game.humans());
  check('the dead leave the held player alone, even when nobody else is in reach', z.target === 0, `target ${z.target}`);
  bp.state.x -= 200;
} else check('a zombie to test with', false, 'spawn failed');
// downed while held: the bleed-out clock stops
p.downed = true;
p.bleed = 10;
tick(2);
check("a held player's bleed-out clock stops", p.bleed === 10 && p.alive, String(p.bleed));
p.downed = false;
p.bleed = 0;
check('the run is still on without them', game.phase === PHASE.DAY);

// back from the same browser
const back = join('Ann', annId);
check('the same browser comes back as the same player', back.id === ann.id && game.players.get(ann.id) === p && !p.away, `${back.id} vs ${ann.id}`);
check('...where they were, as hurt as they were, with what they had', Math.abs(p.state.x - spot.x) < 0.01 && Math.abs(p.state.z - spot.z) < 0.01 && p.hp === 63 && JSON.stringify(p.inv) === inv, JSON.stringify({ x: p.state.x, z: p.state.z, spot, hp: p.hp }));
check('...and nobody new took a seat', game.players.size === 2, String(game.players.size));
// (back is not playing yet: until their client has sent a second of commands they are as safe as while they were held)
game.damagePlayer(p, 10, { kind: 0 });
check('...still safe until their client is running', p.hp === 63 && game.safe(p), String(p.hp));
const { writeInput } = await import('../shared/protocol.js');
for (let i = 1; i <= 20; i++) {
  const w = new Writer(32);
  w.u8(C2S.INPUT);
  w.u16(game.tick & 0xffff);
  w.u8(0);
  writeInput(w, [{ seq: i, buttons: 0, qyaw: 0, qpitch: 0, slot: 255 }]);
  game.onMessage(back.session, w.bytes());
  game.update();
}
p.hp = 63;
if (z) {
  game.players.get(ben.id).state.x += 200;
  game.zm.chooseTarget(z, game.humans());
  check('...and the dead go for them again', z.target === p.id, `target ${z.target}`);
  game.players.get(ben.id).state.x -= 200;
}
game.damagePlayer(p, 10, { kind: 0 });
check('...and can be hurt again', p.hp < 63, String(p.hp));

// "Leave game": gone at once
game.onClose(back.session, LEFT_CODE);
check('"Leave game" removes them at once', !game.players.has(ann.id) && game.players.size === 1);

// a drop nobody comes back for
const cyId = randomUUID();
const cy = join('Cy', cyId);
tick(1);
game.onClose(cy.session, 1001); // (a closed tab)
check('a closed tab is held too', game.players.get(cy.id)?.away);
tick(3);
check('...still there before the grace time is up', game.players.has(cy.id));
tick(3);
check('...and let go once it is', !game.players.has(cy.id) && game.players.size === 1, String(game.players.size));

// nobody to know again: a guest without a browser id leaves at once
const anon = join('Anon', '');
tick(0.5);
game.onClose(anon.session, 1006);
check('a player nobody could know again (no id) is not held', !game.players.has(anon.id));

// what the new client is told: everything, not what changed since the old one was last sent something
const sees = (c, p) => `client: alive ${c.self.alive} zombie ${c.self.zombie} hp ${c.self.hp}/${c.self.maxHp} phase ${c.global?.phase}; server: alive ${+p.alive} zombie ${+p.zombie} hp ${Math.ceil(p.hp)}/${p.maxHp} phase ${game.phase}`;
const told = (c, p) => c.self.alive === (p.alive ? 1 : 0) && c.self.zombie === (p.zombie ? 1 : 0) && c.self.hp === Math.ceil(p.hp) && c.self.maxHp === p.maxHp && c.global?.phase === game.phase;
const dropAndBack = (c, name, pid) => {
  game.onClose(c.session, 1006);
  tick(1);
  const b = join(name, pid);
  tick(0.5);
  return b;
};
game.godMode = true; // (no survivor dies from here on: one has to be left standing, or a death ends the run)
const gus = join('Gus', randomUUID());
const eveId = randomUUID();
let eve = join('Eve', eveId);
tick(1);
const ep = game.players.get(eve.id);
ep.hp = 63;
tick(0.5);
eve = dropAndBack(eve, 'Eve', eveId);
check("a survivor back from a drop is told their own state, not the new client's defaults", told(eve, ep), sees(eve, ep));
game.spawnPlayerZombie(ep); // (as updatePlayers does when they rise)
tick(1);
check('...a zombie is told it is one', told(eve, ep) && eve.self.zombie === 1, sees(eve, ep));
eve = dropAndBack(eve, 'Eve', eveId);
check('...and still is after a drop: the HUD and the flashlight are a zombie\'s', game.players.get(eve.id) === ep && ep.zombie && told(eve, ep), sees(eve, ep));
game.killPlayer(ep, { kind: 0 });
tick(1);
eve = dropAndBack(eve, 'Eve', eveId);
check('...dropped while dead, it comes back dead', !ep.alive && told(eve, ep), sees(eve, ep));
tick(9); // (rises again)
check('...and rises a zombie, and is told so', ep.alive && ep.zombie && told(eve, ep), sees(eve, ep));
check('the run went on through all of that', game.phase === PHASE.DAY && game.players.get(gus.id)?.alive, String(game.phase));

// "Leave game" while dead, back before dawn: dead still, whatever name they come back under
game.onClose(eve.session, LEFT_CODE);
eve = join('Evelyn', eveId);
tick(0.5);
check('left as a zombie, back under another name: still a zombie', game.players.get(eve.id)?.zombie === true && eve.self.zombie === 1, sees(eve, game.players.get(eve.id)));
game.onClose(eve.session, LEFT_CODE);
const bot = join('Bot', ''); // (no account, no browser id: known by the name alone)
tick(0.5);
game.spawnPlayerZombie(game.players.get(bot.id));
game.onClose(bot.session, 1006); // (nobody to hold: removed at once)
const bot2 = join('Bot', '');
tick(0.5);
check('...and a player with no id comes back as one under the same name', game.players.get(bot2.id)?.zombie === true);
game.onClose(bot2.session, LEFT_CODE);
// a survivor who leaves and comes back under another name gets the kit they left with, not a fresh one
const finId = randomUUID();
const fin = join('Fin', finId);
tick(0.5);
game.onClose(fin.session, LEFT_CODE);
const fin2 = join('Finn', finId);
tick(0.5);
check('left alive, back under another name: the kit they left with', fin2.chats.some((t) => /Back in the same run/.test(t)) && !game.players.get(fin2.id).zombie, JSON.stringify(fin2.chats));

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
