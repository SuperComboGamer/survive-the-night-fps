// The survivor a player chooses to be (shared/characters.js, the splash's picker: client/ui/picker.js), against a real
// server process: the choice rides on the end of C2S.JOIN and every client hears it on the end of S2C.PLAYERS; a JOIN
// without it (an older client) or with a value out of range gets the look picked from the player's id; two players may
// choose the same one; a dropped player who comes back keeps theirs, and so does a survivor who dies and turns. Then the
// models: all ten build, alive and turned, within their triangle budget, on the same skeleton, and the dead's near and
// far copies stay within theirs.
import './clip/dom-stub.js';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { CHARACTERS, CHARACTER_COUNT, CHARACTER_NONE, characterFor, defaultCharacter } from '../shared/characters.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the roster and its rule
check('ten characters, ids 0-9 in order', CHARACTER_COUNT === 10 && CHARACTERS.every((c, i) => c.id === i && c.name && c.role && c.line && c.full));
check('every name differs', new Set(CHARACTERS.map((c) => c.name)).size === CHARACTER_COUNT);
check('a valid choice is kept', [0, 4, 9].every((c) => characterFor(c, 7) === c));
check('none, or one out of range, is the default for the id', [CHARACTER_NONE, 10, 200, -1, 3.5, undefined].every((c) => characterFor(c, 7) === defaultCharacter(7)));
check('the default is the look the id picked before the roster ((id * 31 + 7) % 10)', [1, 2, 13, 400].every((id) => defaultCharacter(id) === (id * 31 + 7) % 10));

// ---------------------------------------------------------------- on the wire, with a real server
const port = 39700 + Math.floor(Math.random() * 90);
const dir = mkdtempSync(join(tmpdir(), 'stn-chars-'));
const proc = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(port), STATS_FILE: join(dir, 'stats.json'), REJOIN_GRACE_SECONDS: '20', GAME_IDLE_SECONDS: '30', NODE_ENV: 'test', DEV_ADMIN: '1', DATABASE_URL: '', GODMODE: '' }, // (DEV_ADMIN: /kill below is an admin command)
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
proc.stdout.on('data', (d) => (log += d));
proc.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 200 && !log.includes('listening'); i++) await sleep(50);

// a client; char: the byte to send (undefined: send none, as a client from before the roster). It keeps the last
// player list both as a new client reads it (with the characters) and as an old one does (stopping after the players)
const client = (code, name, pid, char) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws${code ? `?game=${code}` : ''}`);
    ws.binaryType = 'arraybuffer';
    const c = { ws, room: null, id: 0, list: null, oldList: null, trailing: -1, closed: false };
    c.close = (code = 1000) => new Promise((done) => (c.closed ? done() : ((ws.onclose = () => ((c.closed = true), done())), ws.close(code))));
    c.say = (text) => {
      const w = new Writer(256);
      w.u8(C2S.CHAT);
      w.str(text);
      ws.send(w.bytes());
    };
    ws.onopen = () => {
      const w = new Writer(128);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.str(pid);
      if (char !== undefined) w.u8(char);
      ws.send(w.bytes());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      const t = r.u8();
      if (t === S2C.ROOM) c.room = { code: r.str() };
      else if (t === S2C.WELCOME) {
        c.id = r.u16();
        resolve(c);
      } else if (t === S2C.REJECT) resolve(c);
      else if (t === S2C.PLAYERS) {
        const n = r.u8();
        const ps = [];
        for (let i = 0; i < n; i++) {
          const p = { id: r.u16(), name: r.str(), status: r.u8() };
          const flags = r.u8();
          r.u16();
          r.u16();
          r.u8(); // (their level)
          if (flags & 2) {
            r.i16();
            r.i16();
            r.u8();
          }
          ps.push(p);
        }
        c.oldList = ps.map((p) => ({ ...p })); // (what an old client has: everything up to here)
        c.trailing = r.left;
        for (const p of ps) p.char = r.left > 0 ? r.u8() : null;
        c.list = ps;
      }
    };
    ws.onclose = () => {
      c.closed = true;
      resolve(c);
    };
  });
const charOf = (c, id) => c.list?.find((p) => p.id === id)?.char;

try {
  const annId = randomUUID();
  const ann = await client('', 'Ann', annId, 3);
  const code = ann.room.code;
  const ben = await client(code, 'Ben', randomUUID()); // (no byte: an older client)
  const cy = await client(code, 'Cy', randomUUID(), 200); // (out of range)
  const dee = await client(code, 'Dee', randomUUID(), 3); // (the same as Ann)
  const eve = await client(code, 'Eve', randomUUID(), CHARACTER_COUNT - 1);
  await sleep(1500);
  check('the JOIN carrying a character: the player is that character', charOf(ann, ann.id) === 3, JSON.stringify(ann.list));
  check('every other client hears it', [ben, cy, dee, eve].every((c) => charOf(c, ann.id) === 3), JSON.stringify(ben.list));
  check('a JOIN without the byte gets the default for its id', charOf(ann, ben.id) === defaultCharacter(ben.id), `${charOf(ann, ben.id)} vs ${defaultCharacter(ben.id)}`);
  check('a value out of range is clamped to the default for the id', charOf(ann, cy.id) === defaultCharacter(cy.id), `${charOf(ann, cy.id)} vs ${defaultCharacter(cy.id)}`);
  check('two players may be the same character (names tell them apart)', charOf(ann, dee.id) === 3 && ann.list.find((p) => p.id === dee.id).name !== ann.list.find((p) => p.id === ann.id).name);
  check('the last id in range is kept', charOf(ben, eve.id) === CHARACTER_COUNT - 1);
  check('one character byte per player after the list', ann.trailing === ann.list.length, `${ann.trailing} for ${ann.list.length}`);
  check('a client from before the roster reads the same players, ignoring the bytes', JSON.stringify(ann.oldList) === JSON.stringify(ann.list.map(({ char, ...p }) => p)));

  // a drop and a rejoin: the same body, the same character, whatever the new JOIN asks for
  ann.ws.close(1000);
  await sleep(1200);
  const back = await client(code, 'Ann', annId, 7);
  await sleep(1500);
  check('a dropped player who comes back is the same player', back.id === ann.id, `${back.id} vs ${ann.id}`);
  check('...and keeps their character', charOf(back, ann.id) === 3 && charOf(ben, ann.id) === 3, `${charOf(back, ann.id)}`);

  // dying and turning: the same character, a zombie now
  back.say('/kill');
  await sleep(2500);
  const me = ben.list.find((p) => p.id === ann.id);
  check('a survivor who dies and turns is still that character', me && me.status !== 0 && me.char === 3, JSON.stringify(me));

  // a fresh join (not a rejoin) takes the new choice
  await dee.close(4001);
  const dee2 = await client(code, 'Dee', randomUUID(), 5);
  await sleep(1500);
  check('a new join takes the character it asks for', charOf(ben, dee2.id) === 5);
  for (const c of [back, ben, cy, dee2, eve]) await c.close(4001);
} catch (e) {
  check('no error', false, String(e && e.stack));
}
proc.kill();
if (failed) console.log(log.split('\n').slice(-30).join('\n'));

// ---------------------------------------------------------------- the models
const SURVIVOR_TRIS = 11000; // a survivor's budget (eight players at most)
const DEAD_NEAR = 9500, DEAD_FAR = 4500; // the humanoid dead's, near and past LOD_FAR
try {
  const C = await import('../client/render/models/characters.js');
  const bones = new Set();
  let worst = 0, worstZ = 0;
  for (let v = 0; v < CHARACTER_COUNT; v++) {
    const s = C.createSurvivor(1, v);
    const inst = s._inst;
    s.setZombie(true);
    worst = Math.max(worst, inst.rigH.tris);
    worstZ = Math.max(worstZ, inst.rigZ.tris);
    bones.add(inst.rigH.bones.map((b) => b.name).join() + '|' + inst.rigZ.bones.length);
    check(`${CHARACTERS[v].name} builds: ${inst.rigH.tris} tris alive, ${inst.rigZ.tris} turned`, inst.rigH.tris > 3000 && inst.rigH.tris <= SURVIVOR_TRIS && inst.rigZ.tris <= SURVIVOR_TRIS && s.character.id === v);
    check(`${CHARACTERS[v].name}: the turned body has the same bones as the living one`, inst.rigZ.bones.length === inst.rigH.bones.length && inst.rigZ.bones.every((b, i) => b.pos.every((x, k) => Math.abs(x - inst.rigH.bones[i].pos[k]) < 1e-9)));
    const ys = inst.rigH.geometry.boundingBox;
    check(`${CHARACTERS[v].name}: stands 1.6-1.95 m tall on the ground`, ys.max.y > 1.6 && ys.max.y < 1.95 && Math.abs(ys.min.y) < 0.01, `${ys.min.y.toFixed(3)}..${ys.max.y.toFixed(3)}`);
    check(`${CHARACTERS[v].name}: a mouth for voice chat`, !!inst.mouth && inst.rigH.mouth && inst.rigH.mouth.z < -0.07);
    s.dispose();
  }
  check('every character is the same rig (bone names and order)', new Set([...bones].map((b) => b.split('|')[0])).size === 1);
  const fallback = C.createSurvivor(13);
  check('a survivor made from a seed alone is the character the seed picks', fallback.character.id === 13 % CHARACTER_COUNT);
  fallback.dispose();
  let near = 0, far = 0;
  for (const t of [0, 1, 3, 4, 5, 6, 11]) {
    const nv = C.zombieVariants(t);
    for (let v = 0; v < nv; v++) {
      near = Math.max(near, C.debugRig(t, v).tris);
      const f = C.debugRig(t, v, true);
      if (f) far = Math.max(far, f.tris);
    }
  }
  check(`the humanoid dead within budget: ${near} tris near (<= ${DEAD_NEAR}), ${far} far (<= ${DEAD_FAR})`, near <= DEAD_NEAR && far > 0 && far <= DEAD_FAR);
  console.log(`  (survivors: up to ${worst} tris alive, ${worstZ} turned)`);
} catch (e) {
  check('the models build', false, String(e && e.stack));
}
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
