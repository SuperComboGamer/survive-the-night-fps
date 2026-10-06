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
import { randomUUID, createHash } from 'node:crypto';
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
  check('one character byte per player after the list (then four of perks)', ann.trailing === ann.list.length * 5, `${ann.trailing} for ${ann.list.length}`);
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
  // how much of the trunk seen from the front (hips to shoulders, 2 cm squares across the middle 20 cm) a rig covers
  const trunkCover = (rig) => {
    const { P } = rig, p = rig.geometry.attributes.position.array, ix = rig.geometry.index.array;
    const S = 0.02, x0 = -0.1, y0 = P.hipY + 0.05, nx = 10, ny = Math.floor((P.shoulderY - 0.05 - y0) / S);
    const hit = new Uint8Array(nx * ny);
    for (let t = 0; t < ix.length; t += 3) {
      const [ax, ay, bx, by, cx, cy] = [ix[t], ix[t + 1], ix[t + 2]].flatMap((i) => [p[i * 3], p[i * 3 + 1]]);
      const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (Math.abs(d) < 1e-12) continue;
      const cell = (v, o, n) => Math.min(n - 1, Math.max(0, Math.floor((v - o) / S)));
      const i0 = cell(Math.min(ax, bx, cx), x0, nx), i1 = cell(Math.max(ax, bx, cx), x0, nx), j0 = cell(Math.min(ay, by, cy), y0, ny), j1 = cell(Math.max(ay, by, cy), y0, ny);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * S, py = y0 + (j + 0.5) * S;
        const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / d, w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / d;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) hit[j * nx + i] = 1;
      }
    }
    return hit.reduce((a, h) => a + h, 0) / hit.length;
  };
  let near = 0, far = 0;
  const bare = [];
  for (const t of [0, 1, 3, 4, 5, 6, 11]) {
    const nv = C.zombieVariants(t);
    for (let v = 0; v < nv; v++) {
      const n = C.debugRig(t, v);
      near = Math.max(near, n.tris);
      const f = C.debugRig(t, v, true);
      if (f) {
        far = Math.max(far, f.tris);
        if (trunkCover(f) < trunkCover(n) - 0.02) bare.push(`${t}:${v}`);
      }
    }
  }
  check(`the humanoid dead within budget: ${near} tris near (<= ${DEAD_NEAR}), ${far} far (<= ${DEAD_FAR})`, near <= DEAD_NEAR && far > 0 && far <= DEAD_FAR);
  check('the far copy of every humanoid dead has its trunk (a shirtless one lost it past 15 m)', !bare.length, bare.join(' '));
  console.log(`  (survivors: up to ${worst} tris alive, ${worstZ} turned)`);

  // ---- the specials, the bosses and the animals: rebuilt to look better, on the rigs and at the sizes they had. What
  // the server's hitboxes (ZOMBIE_DEFS: radius, height, headY, headR) and every animation hang on is the skeleton, the
  // calibration that puts the head at headY (k), and where the head's centre is on its bone. RIGS is origin/main's
  // (4bd2e1c): per type the bones (how many; sig: a hash of each one's name, parent and bind position), k, the head
  // anchor, and the bind pose's extents in the world (h: height, w: half width, d: half depth, m).
  const { ZTYPE, ZOMBIE_DEFS } = await import('../shared/defs.js');
  const RIGS = {
    TANK: { bones: 21, sig: '531bca95ebf3', k: 1.089, headC: [0, 0.135, 0], h: 2.98, w: 1.07, d: 0.82 },
    SPITTER: { bones: 24, sig: '13887c20f7a6', k: 0.966, headC: [0, 0.09, 0], h: 1.89, w: 0.21, d: 0.17 },
    LEAPER: { bones: 23, sig: '48aa92b9c64c', k: 0.9857, headC: [0, 0.09, 0], h: 1.77, w: 0.22, d: 0.18 },
    ROPER: { bones: 23, sig: '0b013614d8c4', k: 0.9882, headC: [0, 0.108, 0], h: 1.87, w: 0.3, d: 0.18 },
    BOOMER: { bones: 24, sig: '1cecfe48e623', k: 1.0165, headC: [0, 0.108, 0], h: 1.76, w: 0.38, d: 0.49 },
    BAT: { bones: 10, sig: '3b511595e234', k: 1, headC: [0, 0, 0], h: 0.17, w: 0.62, d: 0.26 },
    BOSS_ABOMINATION: { bones: 25, sig: 'b29d1affcf38', k: 1.0826, headC: [0, 0.27, 0], h: 4.28, w: 1.41, d: 1.61 },
    BOSS_HIVEQUEEN: { bones: 30, sig: '105e8a2f390d', k: 1.0529, headC: [0, 0.216, 0], h: 3.48, w: 1.59, d: 1.96 },
    DOG: { bones: 23, sig: '29658d9bc6fe', k: 1, headC: [0, 0.015, -0.06], h: 0.75, w: 0.14, d: 0.67 },
    SHADE: { bones: 23, sig: 'b1987450f3b7', k: 1.1332, headC: [0, 0.0882, 0], h: 2.19, w: 0.24, d: 0.2 },
    BOSS_BRUTE: { bones: 22, sig: '25caaa306e41', k: 0.9915, headC: [0, 0.1125, 0], h: 2.38, w: 0.68, d: 0.62 },
    BOSS_ALPHA: { bones: 23, sig: '29658d9bc6fe', k: 2, headC: [0, 0.015, -0.06], h: 1.56, w: 0.3, d: 1.34 },
    BOSS_BLOATER: { bones: 24, sig: '1d303268902b', k: 1.6162, headC: [0, 0.1035, 0], h: 2.76, w: 1, d: 1.25 },
  };
  // triangles: a boss is alone on the screen, a special comes in threes and fours, dogs in packs and bats in swarms
  const BOSS_TRIS = 12000, DOG_TRIS = 4500, ALPHA_TRIS = 7000, BAT_TRIS = 1500;
  const r4 = (x) => +x.toFixed(4);
  for (const [name, want] of Object.entries(RIGS)) {
    const t = ZTYPE[name], def = ZOMBIE_DEFS[t];
    const nv = C.zombieVariants(t);
    const seen = new Map(); // each variant's geometry once (a dog's coat is picked by the seed)
    for (let seed = 1; seen.size < nv && seed < 300; seed++) {
      const z = C.createZombie(t, seed);
      const meshes = [];
      z.object.traverse((m) => m.isMesh && meshes.push(m));
      if (!seen.has(meshes[0].geometry.uuid)) seen.set(meshes[0].geometry.uuid, { z, meshes });
      else z.dispose();
    }
    let tris = 0, far = 0, h = 0, w = 0, d = 0, low = 0, rigOk = true, one = true, detail = '';
    for (const { z, meshes } of seen.values()) {
      const inst = z._inst;
      const bones = inst.rig
        ? inst.rig.bones.slice(1).map((b) => [b.name, b.parent > 0 ? inst.rig.bones[b.parent].name : '', ...b.local.toArray().map(r4)])
        : inst.bones.slice(1).map((b) => [b.name, b.parent && b.parent.isBone ? b.parent.name : '', ...b.position.toArray().map(r4)]);
      bones.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const sig = createHash('sha1').update(JSON.stringify(bones)).digest('hex').slice(0, 12);
      const k = inst.cal ? inst.cal.k : inst.S;
      const hc = inst.headCenter.position.toArray().map(r4);
      if (bones.length !== want.bones || sig !== want.sig || Math.abs(k - want.k) > 2e-4 || hc.some((x, i) => Math.abs(x - want.headC[i]) > 1e-4)) {
        rigOk = false;
        detail = `${bones.length} bones, sig ${sig}, k ${r4(k)}, head ${hc}`;
      }
      one = one && meshes.length === 1 && meshes[0].isSkinnedMesh;
      const g = meshes[0].geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox;
      tris = Math.max(tris, g.index.count / 3);
      if (inst.rigFar) far = Math.max(far, inst.rigFar.tris);
      h = Math.max(h, bb.max.y * k);
      w = Math.max(w, Math.max(-bb.min.x, bb.max.x) * k);
      d = Math.max(d, Math.max(-bb.min.z, bb.max.z) * k);
      low = Math.min(low, bb.min.y * k);
      z.dispose();
    }
    check(`${def.name}: the rig origin/main's animations and hitboxes hang on (bones, bind positions, head, calibration)`, rigOk, detail);
    check(`${def.name}: one draw call`, one);
    const budget = def.boss ? (t === ZTYPE.BOSS_ALPHA ? ALPHA_TRIS : BOSS_TRIS) : t === ZTYPE.DOG ? DOG_TRIS : t === ZTYPE.BAT ? BAT_TRIS : t === ZTYPE.TANK ? BOSS_TRIS : DEAD_NEAR;
    const lod = [ZTYPE.SPITTER, ZTYPE.LEAPER, ZTYPE.ROPER, ZTYPE.BOOMER, ZTYPE.SHADE].includes(t);
    check(`${def.name}: ${tris} tris (<= ${budget})${lod ? `, ${far} far (<= ${DEAD_FAR})` : ''}`, tris > 500 && tris <= budget && (!lod || (far > 0 && far <= DEAD_FAR)));
    // the size it had: as tall (within 7%), no wider than 8% over (it is shot at its hitbox's width) nor 15% under, about as deep
    check(`${def.name}: the size it was (${h.toFixed(2)} m tall, ${w.toFixed(2)} half wide, ${d.toFixed(2)} half deep; was ${want.h}, ${want.w}, ${want.d})`,
      Math.abs(h / want.h - 1) <= 0.07 && w <= want.w * 1.08 + 0.01 && w >= want.w * 0.85 && d <= want.d + 0.15 && d >= want.d * 0.8 && (t === ZTYPE.BAT || low > -0.02));
  }
  // a boss's teeth do not depend on what was built before it (a far copy used to leave the next head built without them)
  C.debugRig(ZTYPE.WALKER, 0, true);
  const brute = C.createZombie(ZTYPE.BOSS_BRUTE, 1)._inst.rig.geometry;
  let boneVerts = 0;
  for (let i = 0; i < brute.attributes.position.count; i++) if (brute.attributes.position.getY(i) > 2.1 && brute.attributes.color.getX(i) > 0.35 && brute.attributes.color.getZ(i) > 0.2) boneVerts++;
  check('a boss has its teeth whatever was built before it', boneVerts > 20, `${boneVerts}`);
} catch (e) {
  check('the models build', false, String(e && e.stack));
}
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
