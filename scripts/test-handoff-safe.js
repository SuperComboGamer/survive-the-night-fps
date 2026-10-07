// Nobody is hurt while they cannot be playing (server/game.js safe / arrived / frozen), on the Game itself.
//
// What happened (6 Oct 2026): a player died "during game updated". A held player was already safe, but the moment
// their reloaded page sent its JOIN they had their body back - and the page then built the valley and its shaders
// for up to half a minute before it drew a frame, with 75 of the dead about. And the restored game ran on all the
// while: the day burned down and the dead closed in round players who were still on their way back.
//
// Here: a night with the dead on top of two survivors is handed over.
//   - the restored game stands still until one of its players is playing again: no clock, nothing moves, nobody hurt
//   - a player who is back but whose client has sent nothing yet is as safe as a held one, for ARRIVE_SECONDS at most
//   - a second of commands (or anything they do) and they are playing: the dead go for them again
//   - after an ordinary drop, coming back is safe for no longer than was left of the grace: no new way out of a fight
//   - a deploy straight after a deploy: the same again, however far each player had got
//   - a game nobody comes back to runs on after HANDOFF_FREEZE_SECONDS, and lets its players go as before
process.env.HANDOFF_RESERVE_SECONDS = '60';
process.env.REJOIN_GRACE_SECONDS = '10';
process.env.ARRIVE_SECONDS = process.env.ARRIVE_SECONDS ?? '45';
process.env.HANDOFF_FREEZE_SECONDS = process.env.HANDOFF_FREEZE_SECONDS ?? '2';
const { Game } = await import('../server/game.js');
const { envelope, encode, decode } = await import('../server/handoff.js');
const { C2S, S2C, ACT, PROTOCOL_VERSION, Writer, Reader, writeInput } = await import('../shared/protocol.js');
const { PHASE } = await import('../shared/constants.js');
const { ZTYPE, KILLER } = await import('../shared/defs.js');
const { randomUUID } = await import('node:crypto');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const quiet = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const join = (game, name, pid) => {
  const c = { id: 0, snaps: 0, seq: 0 };
  c.session = game.onOpen({
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) c.snaps++;
    },
  });
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(pid);
  game.onMessage(c.session, w.bytes());
  return c;
};
// a packet of commands (standing still), as a running client sends every frame
const input = (game, c) => {
  const w = new Writer(64);
  w.u8(C2S.INPUT);
  w.u16(game.tick & 0xffff);
  w.u8(0);
  writeInput(w, [{ seq: ++c.seq & 0xffff, buttons: 0, qyaw: 0, qpitch: 0, slot: 255 }]);
  game.onMessage(c.session, w.bytes());
};
// sec of the game's ticks; playing: clients whose commands come in with every tick. -> the ids of the players who
// were hurt in them. (Everybody is patched up to HP after every tick: this is about who can be hurt, not who dies.)
const HP = 60;
const tick = (game, sec, playing = []) => {
  const hurt = new Set();
  for (let i = 0, n = Math.round(sec * 20); i < n; i++) {
    for (const c of playing) input(game, c);
    game.update();
    for (const p of game.players.values()) {
      if (p.hp < HP - 1e-9 || !p.alive || p.downed) hurt.add(p.id);
      if (p.alive && !p.downed && !p.zombie) p.hp = HP;
    }
  }
  return hurt;
};
// the dead, on top of a player
const beset = (game, p, n = 3) => {
  for (let i = 0; i < n; i++) game.zm.spawn(ZTYPE.WALKER, p.state.x + Math.sin(i) * 1.2, p.state.z + Math.cos(i) * 1.2, { horde: true });
};
const after = (game, p) => game.zombies.filter((z) => z.target === p.id).length;
const bite = (game, p) => game.damagePlayer(p, 5, { kind: KILLER.ZOMBIE });

// ---------------------------------------------------------------- a night, the dead on top of both
const A = new Game({ seed: 4242, dayLength: 3600, nightLength: 3600, log: quiet });
const ids = { ann: randomUUID(), ben: randomUUID() };
const ann = join(A, 'Ann', ids.ann);
const ben = join(A, 'Ben', ids.ben);
tick(A, 1, [ann, ben]);
A.timeLeft = 0.05;
tick(A, 1, [ann, ben]);
const pa = A.players.get(ann.id);
const pb = A.players.get(ben.id);
pb.state.x = pa.state.x + 30; // (apart: each has their own)
A.fillHistory(pb);
beset(A, pa);
beset(A, pb);
pa.hp = pb.hp = HP;
let hurt = tick(A, 4, [ann, ben]);
check('night, and the dead are on both players: they are being hurt', A.phase === PHASE.NIGHT && hurt.has(ann.id) && hurt.has(ben.id) && after(A, pa) > 0 && after(A, pb) > 0 && pa.alive && pb.alive, `hurt ${[...hurt]}, after them ${after(A, pa)} ${after(A, pb)}`);

// ---------------------------------------------------------------- the deploy: nobody is back yet
const B = new Game({ log: quiet, restore: decode(encode(envelope(A))) });
const qa = B.players.get(ann.id);
const qb = B.players.get(ben.id);
const was = { time: B.time, left: B.timeLeft, at: B.zombies.map((z) => [z.x, z.z]) };
hurt = tick(B, 30);
const still = (g, w) => g.time === w.time && g.timeLeft === w.left && g.zombies.every((z, i) => z.x === w.at[i][0] && z.z === w.at[i][1]);
check('the game brought over stands still while nobody is back: no clock runs, nothing moves', still(B, was), `time ${was.time} -> ${B.time}, left ${was.left} -> ${B.timeLeft}`);
check('...and nobody is hurt', !hurt.size && qa.hp === HP && qb.hp === HP, `${qa.hp} ${qb.hp}`);

// Ann is back: her page has her body, and is still building the valley (no frame yet, so no command)
const ann2 = join(B, 'Ann', ids.ann);
hurt = tick(B, 20);
check('a player who is back and not playing yet (the page still loading) does not start it either', ann2.id === ann.id && !qa.away && still(B, was) && !hurt.size, `away ${!!qa.away} hp ${qa.hp} time ${B.time}`);
check('...and is sent the game as it stands meanwhile', ann2.snaps > 100, String(ann2.snaps));
bite(B, qa);
check('...nothing can hurt them', qa.hp === HP, String(qa.hp));
// her client runs: commands with every tick
tick(B, 0.5, [ann2]);
check('half a second of commands is not yet playing', still(B, was) && B.safe(qa));
tick(B, 2.5, [ann2]);
check('a second of commands, and the game runs on with her in it', B.time > was.time && !B.safe(qa) && B.zombies.some((z, i) => z.x !== was.at[i]?.[0]), `time ${was.time} -> ${B.time}`);
hurt = tick(B, 4, [ann2]);
check('...where the dead go for her again', hurt.has(ann.id) && after(B, qa) > 0, `hurt ${[...hurt]}, after her ${after(B, qa)}`);
check('...and not for Ben, who is still on his way: held, unhurt, where he was', qb.away && !hurt.has(ben.id) && after(B, qb) === 0 && Math.abs(qb.state.x - pb.state.x) < 0.01, `hp ${qb.hp}, after him ${after(B, qb)}`);

// Ben is back, and his page loads for 20 s with the dead all round him
const ben2 = join(B, 'Ben', ids.ben);
hurt = tick(B, 20, [ann2]);
check('a player back in a running game is safe while their page loads: 20 s among the dead, not a scratch', ben2.id === ben.id && !qb.away && qb.alive && !hurt.has(ben.id) && after(B, qb) === 0, `hp ${qb.hp}, alive ${qb.alive}, after him ${after(B, qb)}`);
hurt = tick(B, 5, [ann2, ben2]);
bite(B, qb);
check('...and in the fight again once his client runs', !B.safe(qb) && qb.hp < HP && after(B, qb) > 0, `hp ${qb.hp}, after him ${after(B, qb)}`);

// ---------------------------------------------------------------- no new way out of a fight
B.onClose(ann2.session, 1006); // (a cable pulled: held for REJOIN_GRACE = 10 s, as before)
tick(B, 8, [ben2]);
const ann3 = join(B, 'Ann', ids.ann);
hurt = tick(B, 1.5, [ben2]);
check('back from a drop with 2 s of the grace left, and silent: safe for those 2 s', ann3.id === ann.id && B.safe(qa) && !hurt.has(ann.id), `hp ${qa.hp}`);
hurt = tick(B, 3, [ben2]);
bite(B, qa);
check('...and no longer: coming back and sending nothing is no shelter beyond the grace a drop always gave', !B.safe(qa) && qa.hp < HP, `hp ${qa.hp}`);
B.onClose(ann3.session, 1006);
tick(B, 1, [ben2]);
const ann4 = join(B, 'Ann', ids.ann);
const w = new Writer(8);
w.u8(C2S.ACTION);
w.u8(ACT.RELOAD);
B.onMessage(ann4.session, w.bytes());
check('whoever does anything is playing, at once', !B.safe(qa));

// ---------------------------------------------------------------- a deploy straight after a deploy
B.onClose(ben2.session, 4002); // (Ben's page is reloading for the first deploy when the second one comes)
const C = new Game({ log: quiet, restore: decode(encode(envelope(B))) });
const ra = C.players.get(ann.id);
const rb = C.players.get(ben.id);
const wasC = { time: C.time, left: C.timeLeft, at: C.zombies.map((z) => [z.x, z.z]) };
hurt = tick(C, 30);
check('a second deploy on top of the first: both are held again, the game stands still, nobody is hurt', ra?.away && rb?.away && still(C, wasC) && !hurt.size, `${ra?.hp} ${rb?.hp} time ${wasC.time} -> ${C.time}`);
const D = new Game({ log: quiet, restore: decode(encode(envelope(C))) });
const E = new Game({ log: quiet, restore: decode(encode(envelope(D))) });
hurt = tick(E, 30);
const ann5 = join(E, 'Ann', ids.ann);
tick(E, 3, [ann5]);
check('...and after a third and a fourth: Ann is back in her body, as she was, and the game goes on from where it stopped', ann5.id === ann.id && !hurt.size && E.players.get(ann.id)?.alive && E.players.get(ben.id)?.away && Math.abs(E.time - wasC.time) < 3.1 && E.day === B.day, `hurt ${[...hurt]}, time ${wasC.time} -> ${E.time}`);

// ---------------------------------------------------------------- nobody comes back
const wasWall = Date.now();
tick(C, 5);
check('a game nobody has come back to is still standing', still(C, wasC));
await sleep(Math.max(0, 2100 - (Date.now() - wasWall)));
hurt = tick(C, 5);
check('...until HANDOFF_FREEZE_SECONDS are up: then it runs on, its held players still safe', C.time > wasC.time && !hurt.size && C.players.size === 2, `time ${wasC.time} -> ${C.time}`);
tick(C, 58);
check('...and lets them go when their place is no longer kept, as before', C.players.size === 0, String(C.players.size));

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
