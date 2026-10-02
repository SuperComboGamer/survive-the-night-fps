// The leaderboard (server/stats.js, the BOARD messages of shared/protocol.js) against the real server in-process:
// what goes on a player's record and what does not, that the record outlives the process in its file, what a
// client is sent when it asks for the board - and that the id a player joins with never comes back out: not in a
// message to anyone, not in the log, not in the file.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Game } from '../server/game.js';
import { PlayerStats } from '../server/stats.js';
import { C2S, S2C, PROTOCOL_VERSION, BOARD_STATS, BOARD_TOP, BOARDF, Writer, Reader, writeBoard, readBoard } from '../shared/protocol.js';
import { ZTYPE, KILLER } from '../shared/defs.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`);
}

const uid = (n) => `7c9e6679-7425-40de-944b-${String(n).padStart(12, '0')}`;
const sha = (id) => createHash('sha256').update(id).digest('hex');
const stats = (rec) => BOARD_STATS.map((k) => rec[k]).join();
const dir = mkdtempSync(join(tmpdir(), 'stn-stats-'));
const file = join(dir, 'deep', 'stats.json');

// ---- the store on its own
{
  const s = new PlayerStats();
  check('an id that is not one gets no record', [undefined, null, '', 'x', 42, uid(1) + '0', uid(1).replace(/-/g, ''), '../../etc/passwd'].every((id) => s.enter(id, 'X') === null) && s.recs.size === 0);
  const a = s.enter(uid(1), 'Ann');
  check('the same id in capitals is the same player', s.enter(uid(1).toUpperCase(), 'Ann') === a && a.on === 2);
  s.leave(a);
  s.leave(a);
  check('a player who scored nothing leaves nothing behind', s.recs.size === 0);
  s.leave(null);
  s.bump(null, 'kills');
  check('a player without a record can leave and score: nothing happens', s.recs.size === 0 && !s.dirty);
}

// ---- the file
{
  const s = new PlayerStats({ file });
  check('no file yet: an empty board', s.recs.size === 0);
  const a = s.enter(uid(1), 'Ann');
  s.bump(a, 'kills', 3);
  s.bump(a, 'wins');
  const idle = s.enter(uid(2), 'Idle'); // in a game, nothing scored
  s.saveSync();
  const text = readFileSync(file, 'utf8');
  const stored = JSON.parse(text);
  check('the file holds the record under the hash of the id, and not the id', !text.includes(uid(1)) && !text.toLowerCase().includes(uid(1).replace(/-/g, '')) && stats(stored.players[sha(uid(1))]) === '3,0,1,0', text.slice(0, 120));
  check('...and nothing for a player with nothing on the record', Object.keys(stored.players).length === 1 && s.recs.has(idle.key));
  const again = new PlayerStats({ file });
  const b = again.enter(uid(1), 'Annie');
  check('a new process finds the player again, under the name they join with now', stats(b) === '3,0,1,0' && b.name === 'Annie' && again.recs.size === 1);
  again.bump(b, 'revives', 2);
  await again.save();
  check('the periodic save writes what changed', stats(JSON.parse(readFileSync(file, 'utf8')).players[sha(uid(1))]) === '3,0,1,2' && !again.dirty);

  const logs = [];
  writeFileSync(file, '{"v":1,"players":{"7c9e');
  check('a file cut short reads as an empty board, and says so', new PlayerStats({ file, log: (m) => logs.push(m) }).recs.size === 0 && logs.length === 1, logs[0]);
  const good = sha(uid(7));
  writeFileSync(file, JSON.stringify({ v: 1, players: { short: { kills: 5 }, [good]: { name: 12, kills: -3, nights: 'x', wins: 2.7, revives: 1e99, seen: 1790000000000 }, [sha(uid(8))]: { name: 'Zero', kills: 0 }, [sha(uid(9))]: null } }));
  const j = new PlayerStats({ file });
  const rec = j.recs.get(good);
  check('junk in the file: the one usable record is kept, its bad fields zeroed or capped', j.recs.size === 1 && stats(rec) === `0,0,2,${0xffffffff}` && rec.name === 'Survivor' && rec.seen === 1790000000000, rec && `${rec.name} ${stats(rec)}`);

  // the ceiling: the longest unseen go first, whoever is playing stays
  const c = new PlayerStats({ max: 5 });
  for (let i = 1; i <= 8; i++) {
    const r = c.enter(uid(i), 'P' + i);
    c.bump(r, 'kills', i);
    if (i !== 1) c.leave(r); // P1 stays in a game
    r.seen = 1000 + i;
  }
  const kept = Object.keys(JSON.parse(c.serialize()).players);
  check('past the ceiling the longest unseen are dropped, a player in a game never', kept.length === 5 && kept.includes(sha(uid(1))) && [5, 6, 7, 8].every((i) => kept.includes(sha(uid(i)))), `${kept.length} kept`);
}

// ---- what a player is sent
{
  const s = new PlayerStats();
  const recs = [];
  for (let i = 1; i <= 30; i++) {
    const r = s.enter(uid(i), 'P' + i);
    s.bump(r, 'kills', i);
    recs.push(r);
  }
  const me = recs[4]; // 5 kills: 25 players have more
  let b = s.board(me, new Set([me, recs[0]]));
  const mine = b.rows.filter((r) => r.flags & BOARDF.ME);
  check(
    'the board is the best 20, the players in the game and me, each once',
    b.total === 30 && b.rows.length === BOARD_TOP + 2 && mine.length === 1 && b.rows.filter((r) => r.flags & BOARDF.HERE).map((r) => r.name).sort().join() === 'P1,P5' && [11, 20, 30].every((i) => b.rows.some((r) => r.name === 'P' + i)) && !b.rows.some((r) => r.name === 'P10'),
    `${b.rows.length} rows`,
  );
  check('my row says where I stand in each stat, and nowhere in one I have nothing in', mine[0].ranks.join() === '26,0,0,0' && mine[0].kills === 5, mine[0].ranks.join());
  s.bump(recs[29], 'nights', 4);
  s.bump(recs[28], 'nights', 4);
  s.bump(me, 'nights', 4);
  s.bump(recs[0], 'nights', 9);
  b = s.board(me, new Set());
  check('equal scores share a place', b.rows.find((r) => r.flags & BOARDF.ME).ranks.join() === '26,2,0,0', b.rows.find((r) => r.flags & BOARDF.ME).ranks.join());
  b = s.board(null, new Set());
  // (the best 20 by kills, and P1 and P5 for their nights)
  check('a player without a record still gets the board, with no row of their own', b.rows.length === BOARD_TOP + 2 && !b.rows.some((r) => r.flags & BOARDF.ME), `${b.rows.length} rows`);

  // on the wire
  const rows = [
    { name: 'Ann', flags: BOARDF.ME | BOARDF.HERE, kills: 0xffffffff, nights: 300, wins: 0, revives: 127, ranks: [1, 70000, 0, 128] },
    { name: 'Zoë the 2nd', flags: 0, kills: 16384, nights: 0, wins: 5, revives: 0 },
  ];
  const w = new Writer(8);
  writeBoard(w, 20000, rows);
  const r = new Reader(w.bytes().slice());
  const back = readBoard(r);
  check(
    'the board reads back as written',
    r.left === 0 && back.total === 20000 && back.rows.length === 2 && back.rows[0].me && back.rows[0].here && stats(back.rows[0]) === stats(rows[0]) && back.rows[0].ranks.join() === '1,70000,0,128' && back.rows[1].name === 'Zoë the 2nd' && !back.rows[1].me && !back.rows[1].here && back.rows[1].ranks === null && stats(back.rows[1]) === stats(rows[1]),
    JSON.stringify(back.rows[0]),
  );
}

// ---- in a game
{
  const logs = [];
  const store = new PlayerStats({ file: join(dir, 'game.json') });
  const game = new Game({ seed: 4242, godMode: true, dayLength: 3600, stats: store, log: (...a) => logs.push(a.join(' ')) });
  const sent = []; // every byte the server sends to anybody

  function client(name, id) {
    const c = { name, id: 0, pid: id, boards: [] };
    c.conn = {
      send(bytes) {
        const copy = bytes.slice();
        sent.push(copy);
        const r = new Reader(copy);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.BOARD) {
          c.boards.push(readBoard(r));
          if (r.left !== 0) throw new Error(`${name}: ${r.left} trailing board bytes`);
        }
      },
      congested: () => false,
      cork: (fn) => fn(),
    };
    c.session = game.onOpen(c.conn);
    const w = new Writer(96);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    if (id !== undefined) w.str(id);
    game.onMessage(c.session, w.bytes().slice());
    c.p = () => game.players.get(c.id);
    c.rec = () => store.recs.get(sha(id));
    // asks for the board and returns the answer (null: none came)
    c.ask = () => {
      const n = c.boards.length;
      game.onMessage(c.session, new Uint8Array([C2S.BOARD]));
      return c.boards.length > n ? c.boards[c.boards.length - 1] : null;
    };
    c.row = (b, who) => b.rows.find((r) => r.name === who);
    return c;
  }
  const wait = (secs) => {
    for (let i = 0; i < secs * 20; i++) game.update();
  };
  const kill = (c, n = 1) => {
    for (let i = 0; i < n; i++) game.combat.killZombie(game.zm.spawn(ZTYPE.WALKER, c.p().x + 3 + i, c.p().z + 3), c.p());
  };

  const Ann = client('Ann', uid(1));
  const Ben = client('Ben', uid(2));
  const Cat = client('Cat', uid(3));
  const Bot = client('Bot'); // as the test bots join: a name and nothing after it
  const Tab = client('Ann', uid(1)); // Ann's browser, a second tab
  const Odd = client('Odd', 'not-an-id');
  check('everyone is in, with or without an id', [Ann, Ben, Cat, Bot, Tab, Odd].every((c) => c.id && c.p()) && Tab.p().name === 'Ann#2');
  check('a record per id, none without one', Ann.p().rec === Tab.p().rec && Ann.p().rec && Ben.p().rec && Ben.p().rec !== Ann.p().rec && Bot.p().rec === null && Odd.p().rec === null && store.recs.size === 3);

  kill(Ann, 3);
  kill(Tab);
  kill(Bot, 2);
  check('zombies killed go on the record, both tabs on the one', stats(Ann.rec()) === '4,0,0,0' && stats(Ben.rec()) === '0,0,0,0' && Ann.p().zkills === 3 && Bot.p().zkills === 2, stats(Ann.rec()));

  let b = Ann.ask();
  check(
    'the board on request: me, and the others in the game who have an id',
    !!b && b.total === 1 && b.rows.length === 3 && Ann.row(b, 'Ann').me && Ann.row(b, 'Ann').here && Ann.row(b, 'Ann').kills === 4 && Ann.row(b, 'Ann').ranks.join() === '1,0,0,0' && Ann.row(b, 'Ben').here && !Ann.row(b, 'Ben').me && !Ann.row(b, 'Bot') && !Ann.row(b, 'Ann#2'),
    b ? b.rows.map((r) => r.name).join() : 'no answer',
  );
  check('a second request in the same second is not answered', Ann.ask() === null);
  wait(1.2);
  check('...the next one is', Ann.ask() !== null);
  b = Bot.ask();
  check('a player without an id sees the board and is not on it', !!b && b.rows.length === 3 && !b.rows.some((r) => r.me));

  game.goDown(Ben.p());
  game.revive(Ben.p(), Ann.p());
  game.goDown(Ben.p());
  game.revive(Ben.p(), null); // a medkit of their own
  game.goDown(Ben.p());
  game.revive(Ben.p(), Bot.p());
  check('a revive goes on the record of whoever did it', stats(Ann.rec()) === '4,0,0,1' && stats(Ben.rec()) === '0,0,0,0', stats(Ann.rec()));

  game.startNight();
  game.spawnPlayerZombie(Ben.p()); // Ben has turned
  game.killPlayer(Cat.p(), { kind: KILLER.PLAYER, id: Ben.id });
  check('a survivor killed by a turned player is on nobody\'s record', stats(Ben.rec()) === '0,0,0,0' && Ben.p().kills === 1);
  game.killPlayer(Ben.p(), { kind: KILLER.PLAYER, id: Ann.id });
  check('a turned player put down is a kill', stats(Ann.rec()) === '5,0,0,1', stats(Ann.rec()));
  game.startDay();
  check('the night goes to whoever was alive at the end of it, once', stats(Ann.rec()) === '5,1,0,1' && stats(Ben.rec()) === '0,0,0,0' && stats(Cat.rec()) === '0,0,0,0', `${stats(Ann.rec())} | ${stats(Ben.rec())} | ${stats(Cat.rec())}`);

  game.victory();
  check('a win goes to everybody in the game, once each', stats(Ann.rec()) === '5,1,1,1' && stats(Ben.rec()) === '0,0,1,0' && stats(Cat.rec()) === '0,0,1,0', `${stats(Ann.rec())} | ${stats(Ben.rec())}`);

  // leaving
  const Dan = client('Dan', uid(4));
  game.onClose(Dan.session);
  game.onClose(Ben.session);
  check('whoever leaves with nothing on the record is forgotten, the others stay on the board', !store.recs.has(sha(uid(4))) && store.recs.size === 3);
  wait(1.2);
  b = Cat.ask();
  check(
    'the board after: the player who left is still on it, no longer in the game',
    !!b && b.total === 3 && Cat.row(b, 'Ben') && !Cat.row(b, 'Ben').here && Cat.row(b, 'Ben').wins === 1 && Cat.row(b, 'Cat').me && Cat.row(b, 'Cat').ranks.join() === '0,0,1,0' && Cat.row(b, 'Ann').here && stats(Cat.row(b, 'Ann')) === '5,1,1,1',
    b ? JSON.stringify(b.rows) : 'no answer',
  );

  // the id stays where it was sent
  store.saveSync();
  const out = Buffer.concat(sent.map((u) => Buffer.from(u))).toString('latin1') + '\n' + logs.join('\n') + '\n' + readFileSync(join(dir, 'game.json'), 'utf8');
  const secrets = [1, 2, 3, 4].flatMap((n) => [uid(n), uid(n).toUpperCase(), uid(n).replace(/-/g, ''), uid(n).slice(-12)]);
  const wire = Buffer.concat(sent.map((u) => Buffer.from(u))).toString('latin1') + '\n' + logs.join('\n');
  check(`no id in anything sent to any client (${sent.length} messages), logged or saved`, secrets.every((x) => !out.includes(x)));
  check('...and no hash of one in anything sent or logged', [1, 2, 3, 4].every((n) => !wire.includes(sha(uid(n))) && !wire.includes(sha(uid(n)).slice(0, 16))));
}

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
