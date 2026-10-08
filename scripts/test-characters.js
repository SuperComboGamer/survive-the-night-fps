// The survivor a player chooses to be (shared/characters.js, the splash's picker: client/ui/picker.js), against a real
// server process: the choice rides on the end of C2S.JOIN and every client hears it on the end of S2C.PLAYERS; a JOIN
// without it (an older client) or with a value out of range gets the look picked from the player's id; two players may
// choose the same one; a dropped player who comes back keeps theirs, and so does a survivor who dies and turns. Then the
// models: all ten build, alive and turned, within their triangle budget, on the same skeleton, and the dead's near and
// far copies stay within theirs.
//
// Custom survivors (the character creator: shared/wardrobe.js, shared/appearance.js): the wardrobe's ids and rules, the
// look's bytes (round trip, and anything at all decoding to a look the rules allow), a look kept by name outliving a
// part taken out of the game, the wardrobe and people.js knowing the same parts (both ways), every part changing the
// model, every made-up look building within the budget on the same skeleton, and the look on the wire (S2C.LOOKS).
import './clip/dom-stub.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { CHARACTERS, CHARACTER_COUNT, CHARACTER_NONE, characterFor, defaultCharacter } from '../shared/characters.js';
import { FIELDS, PALETTES, BUILDER_ONLY } from '../shared/wardrobe.js';
import * as AP from '../shared/appearance.js';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

// ---------------------------------------------------------------- the wardrobe and a look's bytes
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cover = AP.coveringLooks({ randoms: 30, seed: 11 });
{
  check('the defaults break no rule', AP.violations(AP.defaults()).length === 0, AP.violations(AP.defaults()).join());
  let rt = 0, rtBad = '';
  for (const { label, values } of cover) {
    const c = AP.canonical(values);
    if (!same(AP.canonical(AP.decode(AP.encode(c))), c) || !same(AP.fromLookCode(AP.lookCode(values)), c)) (rt++, (rtBad = label));
  }
  check(`a look's bytes and code give it back (${cover.length} looks)`, rt === 0, rtBad);
  const bytes = AP.encode(AP.defaults());
  check(`a look is small on the wire (${bytes.length} bytes)`, bytes.length <= 80);
  // anything at all: never throws, and what comes out (normalised) breaks no rule and stays as it is
  const rnd = AP.mulberry(5);
  let thrown = 0, broken = 0, moved = 0;
  for (let i = 0; i < 3000; i++) {
    const n = Math.floor(rnd() * 120);
    const raw = Uint8Array.from([rnd() < 0.95 ? 1 : Math.floor(rnd() * 256), Math.floor(rnd() * 200), ...Array.from({ length: n }, () => Math.floor(rnd() * 256))]);
    try {
      const v = AP.decode(raw);
      if (!v) continue;
      const c = AP.normalize(v);
      if (AP.violations(c).length) broken++;
      if (!same(AP.normalize(c), c)) moved++;
    } catch {
      thrown++;
    }
  }
  check('any bytes at all decode to a look or to none, never an error', thrown === 0, `${thrown}`);
  check('...and normalised, they break no rule, and normalising again changes nothing', broken === 0 && moved === 0, `${broken} broken, ${moved} moved`);
  let rbad = 0;
  for (let i = 0; i < 400; i++) if (AP.violations(AP.randomLook(AP.mulberry(1000 + i))).length) rbad++;
  check('the dice never roll a look the rules forbid', rbad === 0, `${rbad}`);
  // every choice can be had: picked, it stays (the rest move out of its way)
  const unreachable = [];
  for (const f of FIELDS) if (f.kind !== 'slider') for (const o of AP.APPEARANCE.offered(f)) if (AP.normalize({ ...AP.defaults(), [f.key]: o.name }, { lock: f.key })[f.key] !== o.name) unreachable.push(`${f.key}:${o.name}`);
  check('every choice offered can be picked', !unreachable.length, unreachable.join(' '));
  check('every choice is worn by one of the covering looks', FIELDS.every((f) => f.kind === 'slider' || (f.kind === 'swatch' && !f.none) || AP.APPEARANCE.offered(f).every((o) => f.kind === 'swatch' || cover.some((c) => c.values[f.key] === o.name))));
  const sliders = FIELDS.filter((f) => f.kind === 'slider');
  check('a slider keeps its default, its ends and its steps exactly', sliders.every((f) => AP.APPEARANCE.quant(f, f.default) === f.default && AP.APPEARANCE.quant(f, f.range[0]) === f.range[0] && AP.APPEARANCE.quant(f, f.range[1]) === f.range[1]));
  // ids: never two the same, never a retired one; a field's place on the wire never used twice
  check('wire places, option ids and names are each used once', new Set(FIELDS.map((f) => f.wire)).size === FIELDS.length && new Set(FIELDS.map((f) => f.key)).size === FIELDS.length);
  const W = (over) => FIELDS.map((f) => (f.key === 'hat' ? { ...f, ...over(f) } : f));
  let threw = false;
  try {
    AP.createAppearance(W((f) => ({ retired: [9], options: [...f.options, { id: 9, name: 'stetson', label: 'Stetson' }] })));
  } catch {
    threw = true;
  }
  check('a part given an id that was retired is refused', threw);
  threw = false;
  try {
    AP.createAppearance(W((f) => ({ options: [...f.options, { id: 1, name: 'stetson', label: 'Stetson' }] })));
  } catch {
    threw = true;
  }
  check('...and one given an id already in use', threw);

  // a part taken out of the game (the cowboy hat: id 5, retired), and a field taken out (age): what a browser kept
  // falls back, and so does an old id on the wire
  const gone = AP.createAppearance(
    FIELDS.filter((f) => f.key !== 'age').map((f) => (f.key === 'hat' ? { ...f, retired: [5], options: f.options.filter((o) => o.name !== 'cowboy') } : f)),
    PALETTES,
    [26]
  );
  const kept = { ...AP.defaults(), hat: 'cowboy', hatColor: 'straw', age: 0.5, height: 9, hair: 'mohawk', skin: 'tan', removedField: 'x' };
  const fixed = gone.fromNames(kept);
  check('a kept look naming a part no longer in the game gets the field default', fixed.values.hat === 'none' && fixed.values.hair === AP.APPEARANCE.byKey.get('hair').default);
  check('...a slider out of range is clamped, the rest kept', fixed.values.height === 1.04 && fixed.values.skin === 'tan');
  check('...and what was replaced is said', ['Hat', 'Hair', 'Height', 'age', 'removedField'].every((k) => fixed.repaired.includes(k)), fixed.repaired.join());
  check('...and it breaks no rule', gone.violations(fixed.values).length === 0);
  const old = AP.encode({ ...AP.defaults(), hat: 'cowboy', age: 0.5 });
  const dec = gone.decode(old);
  check("an old look on the wire with a retired part: the field default, the retired field's place skipped", dec && dec.hat === 'none' && !('age' in dec) && dec.skin === AP.defaults().skin);
  const later = AP.fromNames({ hair: 'bun' });
  check('a kept look from before a field was added gets its default for it (and nothing is said)', later.values.hat === 'none' && later.values.hair === 'bun' && later.repaired.length === 0, later.repaired.join());
  const longer = AP.decode(Uint8Array.from([...AP.encode(AP.defaults()).slice(0, 1), AP.APPEARANCE.wireLen + 3, ...AP.encode(AP.defaults()).slice(2), 7, 0, 3]));
  check('a look from a newer build (more fields) decodes, its new fields dropped', longer && longer.hair === AP.defaults().hair);
  const shorter = AP.decode(Uint8Array.from([1, 30, ...AP.encode(AP.defaults()).slice(2, 32)]));
  check('...and one from an older build (fewer) gets the defaults for the rest', shorter && shorter.knife === 'none' && shorter.hat === 'none');
}

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
// look: a custom survivor's (values), or raw bytes to send after the character byte as they are
const client = (code, name, pid, char, look = null) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws${code ? `?game=${code}` : ''}`);
    ws.binaryType = 'arraybuffer';
    const c = { ws, room: null, id: 0, list: null, oldList: null, trailing: -1, closed: false, looks: new Map(), lookMsgs: 0 };
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
      if (look instanceof Uint8Array) for (const b of look) w.u8(b);
      else if (look) AP.writeLook(w, look);
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
      else if (t === S2C.LOOKS) {
        c.lookMsgs++;
        for (let n = r.u8(); n > 0; n--) {
          const id = r.u16();
          c.looks.set(id, AP.readLook(r));
        }
      } else if (t === S2C.PLAYERS) {
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
  // ---- custom survivors: their look rides after the character byte, and everyone hears it in S2C.LOOKS
  check('a game of roster survivors sends no looks at all', [back, ben, cy, dee2, eve].every((c) => c.lookMsgs === 0), [back, ben, cy, dee2, eve].map((c) => c.lookMsgs).join());
  const lookA = AP.randomLook(AP.mulberry(3)), lookB = AP.randomLook(AP.mulberry(4));
  const bytesA = [...AP.encode(AP.canonical(lookA))];
  const fayId = randomUUID();
  const fay = await client(code, 'Fay', fayId, 4, lookA);
  const gus = await client(code, 'Gus', randomUUID(), 2, Uint8Array.from([5, 1, 2, 3])); // (a length that runs past the end)
  const hal = await client(code, 'Hal', randomUUID(), 1, Uint8Array.from([9, 7, 7, 7, 7, 7, 7, 7, 7, 7])); // (not a look)
  await sleep(1500);
  const heard = (c, id) => (c.looks.get(id) ? [...c.looks.get(id)] : null);
  check('a JOIN with a look: everyone hears its canonical bytes', [fay, ben, eve, gus, hal].every((c) => same(heard(c, fay.id), bytesA)), JSON.stringify([heard(ben, fay.id)?.length, bytesA.length]));
  check('...and the player list has them as the roster survivor sent beside it', charOf(ben, fay.id) === 4 && charOf(hal, fay.id) === 4);
  check('...which is still one character byte per player after the list', ben.trailing === ben.list.length * 5, `${ben.trailing} for ${ben.list.length}`);
  check('a newcomer hears the look of one who was there before them', same(heard(hal, fay.id), bytesA));
  check('bytes after the character that are not a look: no look, the character', !ben.looks.has(gus.id) && !ben.looks.has(hal.id) && charOf(ben, gus.id) === 2 && charOf(ben, hal.id) === 1);
  // dropped and back, asking for another look: the same body, the same look
  fay.ws.close(1000);
  await sleep(1200);
  const fay2 = await client(code, 'Fay', fayId, 5, lookB);
  await sleep(1500);
  check('a custom survivor who drops and comes back keeps their look, whatever the new JOIN asks', fay2.id === fay.id && same(heard(fay2, fay.id), bytesA) && same(heard(ben, fay.id), bytesA) && charOf(ben, fay.id) === 4);
  fay2.say('/kill');
  await sleep(2500);
  const fz = ben.list.find((p) => p.id === fay.id);
  check('...and one who dies and turns is still that look', fz && fz.status !== 0 && same(heard(ben, fay.id), bytesA) && fz.char === 4);
  for (const c of [fay2, gus, hal]) await c.close(4001);
  for (const c of [back, ben, cy, dee2, eve]) await c.close(4001);
} catch (e) {
  check('no error', false, String(e && e.stack));
}
proc.kill();
if (failed) console.log(log.split('\n').slice(-30).join('\n'));

// ---------------------------------------------------------------- the models
// a survivor's budget (eight players at most). 12500 since the character creator: the roster is 8.6-10.1k, but a
// survivor can now wear every heavy thing at once (no hat, so all the hair; a vest; glasses; a tool belt...); eight of
// them are still a small share of a frame, which is bound by draw calls (one each)
const SURVIVOR_TRIS = 12500;
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

  // ---- custom survivors. The wardrobe (shared/wardrobe.js) and people.js know the same parts, both ways: a part built
  // there that the wardrobe does not list could not be chosen; a part listed that changes nothing is not built
  const Lk = await import('../client/render/models/looks.js');
  const A = AP.APPEARANCE;
  const listed = new Set(BUILDER_ONLY);
  for (const f of FIELDS) if (f.kind !== 'slider') for (const o of A.choices.get(f.key)) listed.add(o.name);
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');
  const people = read('client/render/models/people.js');
  const builds = new Set([...people.matchAll(/\b(?:kind|style|collar|sleeves|pockets|badge) [!=]== '([a-z]+)'/g)].map((m) => m[1]));
  for (const p of ['client/render/models/looks.js', 'client/render/models/deadlooks.js']) for (const m of read(p).matchAll(/\b(?:kind|style|collar|sleeves): '([a-z]+)'/g)) builds.add(m[1]);
  const unlisted = [...builds].filter((n) => !listed.has(n));
  check(`every part people.js builds, and every look wears, is in the wardrobe (${builds.size})`, !unlisted.length, `not listed: ${unlisted.join(' ')}`);
  const kit = new Set([...people.matchAll(/if \(g\.([a-z]+)\)/g), ...people.matchAll(/L\.gear\.([a-z]+)/g)].map((m) => m[1]));
  const kitListed = (k) => BUILDER_ONLY.includes(k) || FIELDS.some((f) => f.path && (f.path === `gear.${k}` || f.path.startsWith(`gear.${k}.`)));
  check(`every piece of kit people.js builds is in the wardrobe (${kit.size})`, [...kit].every(kitListed), `not listed: ${[...kit].filter((k) => !kitListed(k)).join(' ')}`);
  const shape = (key) => {
    const s = C.createSurvivor(1, key, { transient: true });
    const g = s._inst.rigH.geometry;
    const h = createHash('sha1');
    // (the shape, the colours, and the cloth: a fabric is where in the atlas its uvs fall)
    for (const a of ['position', 'color', 'uv']) if (g.attributes[a]) h.update(Buffer.from(g.attributes[a].array.buffer));
    s.dispose();
    return h.digest('hex');
  };
  const inert = [];
  for (const f of FIELDS) {
    const bases = cover.filter((c) => AP.relevant(c.values, f)).slice(0, 6);
    if (f.kind === 'slider') {
      const [lo, hi] = f.range;
      if (!bases.some(({ values }) => shape(AP.lookKey({ ...values, [f.key]: lo })) !== shape(AP.lookKey({ ...values, [f.key]: hi })))) inert.push(f.key);
      continue;
    }
    const opts = A.offered(f);
    if (f.kind === 'swatch') {
      // (a palette: two of its colours differ, and none differs from a colour)
      const cols = opts.filter((o) => o.hex !== undefined);
      const two = (a, b) => bases.some(({ values }) => {
        const x = AP.normalize({ ...values, [f.key]: a }, { lock: f.key }), y = AP.normalize({ ...values, [f.key]: b }, { lock: f.key });
        return AP.relevant(x, f) && shape(AP.lookKey(x)) !== shape(AP.lookKey(y));
      });
      if (!two(cols[0].name, cols[cols.length - 1].name)) inert.push(`${f.key}:colours`);
      if (opts[0].hex === undefined && opts[0].name === 'none' && !two('none', cols[0].name)) inert.push(`${f.key}:none`);
      continue;
    }
    // (a pick: each of its choices differs from another, all else the same)
    for (const o of opts) {
      const base = cover.find((c) => c.label === `${f.key}:${o.name}`)?.values;
      if (!base) continue;
      const alts = opts.filter((a) => a !== o).map((a) => AP.normalize({ ...base, [f.key]: a.name }, { lock: f.key }));
      const kin = alts.filter((x) => FIELDS.every((g) => g === f || x[g.key] === base[g.key]));
      const vs = (kin.length ? kin : alts).slice(0, 2);
      if (vs.length && vs.every((x) => shape(AP.lookKey(x)) === shape(AP.lookKey(base)))) inert.push(`${f.key}:${o.name}`);
    }
  }
  check('every choice in the wardrobe changes the model', !inert.length, `changes nothing: ${inert.join(' ')}`);

  // every look the creator can make: built within the budget, on the same skeleton, standing 1.6-1.95 m, with a mouth
  const looks = [...cover, ...AP.coveringLooks({ bodies: 'extremes', seed: 77 }).filter((_, i) => i % 3 === 0)];
  let lw = 0, lz = 0, lbad = [];
  for (const { label, values } of looks) {
    try {
      const s = C.createSurvivor(1, AP.lookKey(values), { transient: true });
      s.setZombie(true);
      const inst = s._inst;
      lw = Math.max(lw, inst.rigH.tris);
      lz = Math.max(lz, inst.rigZ.tris);
      const bb = inst.rigH.geometry.boundingBox;
      const ok =
        inst.rigH.tris <= SURVIVOR_TRIS && inst.rigZ.tris <= SURVIVOR_TRIS && bb.max.y > 1.6 && bb.max.y < 1.95 && Math.abs(bb.min.y) < 0.01 &&
        inst.rigH.bones.map((b) => b.name).join() + '|' + inst.rigZ.bones.length === [...bones][0] && !!inst.mouth && inst.rigH.mouth.z < -0.07;
      if (!ok) lbad.push(`${label} (${inst.rigH.tris}/${inst.rigZ.tris} tris, ${bb.max.y.toFixed(3)} m)`);
      s.dispose();
    } catch (e) {
      lbad.push(`${label}: ${e.message}`);
    }
  }
  check(`every made-up look builds within budget, on the same skeleton, 1.6-1.95 m, with a mouth (${looks.length}; up to ${lw} tris, ${lz} turned)`, !lbad.length, lbad.slice(0, 6).join('; '));
  // the most a survivor can wear (each field its most costly choice, the rules then applied)
  const most = (() => {
    let v = { ...AP.defaults(), body: 'm', height: 1.04, build: 1.2 };
    const tris = (x) => {
      const s = C.createSurvivor(1, AP.lookKey(x), { transient: true });
      const n = s._inst.rigH.tris;
      s.dispose();
      return n;
    };
    for (const f of FIELDS) {
      if (f.kind !== 'pick') continue;
      let best = v, bn = tris(v);
      for (const o of A.offered(f)) {
        const x = AP.normalize({ ...v, [f.key]: o.name }, { lock: f.key });
        const n = tris(x);
        if (n > bn) (best = x), (bn = n);
      }
      v = best;
    }
    return { v, n: tris(v) };
  })();
  check(`the most a survivor can wear is within the budget (${most.n} tris, <= ${SURVIVOR_TRIS})`, most.n <= SURVIVOR_TRIS);
  // a roster survivor as the wardrobe has them ("Make one like Dale"): the same parts and colours, no rule broken
  const PARTS = ['sex', 'hair.style', 'hair.color', 'beard.style', 'hat.kind', 'hat.color', 'top.kind', 'top.color', 'top.collar', 'top.sleeves', 'vest.kind', 'vest.color', 'overalls.color', 'coverall', 'pants.color', 'shoes.kind', 'skin', 'eye', 'gear.badge', 'gear.holster', 'gear.radio', 'gear.toolbelt', 'gear.knife', 'gear.watch', 'gear.glasses', 'gear.lanyard'];
  const at = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const unlike = [];
  for (let i = 0; i < CHARACTER_COUNT; i++) {
    const v = Lk.appearanceOfRoster(i);
    const L = Lk.lookFromAppearance(v), R = Lk.LOOKS[i];
    for (const p of PARTS) if ((at(L, p) ?? null) !== (at(R, p) ?? null)) unlike.push(`${CHARACTERS[i].name} ${p}: ${at(R, p)} -> ${at(L, p)}`);
    if (AP.violations(v).length) unlike.push(`${CHARACTERS[i].name} breaks ${AP.violations(v).join()}`);
    if (Lk.nearestRoster(v) !== i) unlike.push(`${CHARACTERS[i].name} is nearest to ${Lk.nearestRoster(v)}`);
  }
  check('each of the ten, made in the wardrobe, wears the same parts and colours (and is most like themselves)', !unlike.length, unlike.slice(0, 6).join('; '));
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
