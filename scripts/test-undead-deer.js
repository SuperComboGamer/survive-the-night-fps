// The mainland's undead deer (server/deer.js with gr.undead, UNDEAD in shared/deer.js), against the real server
// in-process and decoded as a client does: that every deer on map 2 is undead and none on the island is, that a pack
// roams and fears nothing, what sets it on a survivor (coming near, crouched or not, a shot at one of it, a gun fired
// close by) and what does not (a survivor lying downed, one further off), that every ram comes after the antlers have
// been down for the windup, that it hurts and throws the survivor back, that a survivor who steps aside is missed more
// often than not, that a pack gives up on one who gets away, what a kill leaves, what a death by one is called - and
// that ten minutes of packs hunting round the plain leaves none in the water or inside a wall.
// usage: node scripts/test-undead-deer.js [seed ...]   (VERBOSE=1 prints the passes too)
import { Game } from '../server/game.js';
import { C2S, S2C, ENT, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { ITEM, NOTIFY, SOUND, KILLER } from '../shared/defs.js';
import { WORLD } from '../shared/acts.js';
import { groundAt, deepWaterAt, resolveBody } from '../shared/collision.js';
import { readSnapshot } from '../client/net/decode.js';
import { DANIM, DEER_UNDEAD, UNDEAD, UNDEAD_LOOT, deerHitbox, DEER_HEAD } from '../shared/deer.js';

const seeds = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (!seeds.length) seeds.push(4242, 7);
const VERBOSE = !!process.env.VERBOSE;
const fails = [];
let passes = 0;
let seedNow = 0;
const check = (name, ok, info = '') => {
  if (!ok) fails.push(`${name} (seed ${seedNow})`);
  else passes++;
  if (!ok || VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}${ok ? '' : ` [seed ${seedNow}]`}`);
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const HUNT = 4;
const WARY = 3;

function run(seed) {
  seedNow = seed;
  const game = new Game({ seed, godMode: false, dayLength: 3600, themes: false, log: () => {} });
  const client = (name) => {
    const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], events: [] };
    const nop = () => {};
    c.handler = new Proxy({ notify: (m, a) => c.notes.push([m, a]), killfeed: (...a) => c.events.push(['killfeed', ...a]) }, { get: (t, k) => t[k] || nop });
    c.conn = {
      send(bytes) {
        const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
      },
    };
    c.session = game.onOpen(c.conn);
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    game.onMessage(c.session, w.bytes().slice());
    c.p = () => game.players.get(c.id);
    return c;
  };
  const A = client('Ann');
  const a = A.p();
  const dm = game.dm;

  // ---------------------------------------------------------------- the island first: its deer are living
  check('the island has deer, and not one of them is undead', game.deer.length > 0 && game.deer.every((d) => !(d.variant & DEER_UNDEAD)) && dm.groups.every((gr) => !gr.undead), `${game.deer.length} deer`);

  game.cross(a, false, false);
  game.arrive();
  const w = game.world;
  check('(on the mainland)', game.act === WORLD.MAINLAND && w.kind === WORLD.MAINLAND);
  // the plain to ourselves: none of the dead about
  const clearDead = () => {
    for (const z of [...game.zombies]) game.removeEntity(z);
    game.zombies.length = 0;
  };
  game.zm.spawnRoamer = () => null;
  game.zm.spawnForestPack = () => 0;
  game.zm.herds.spawn = () => null;
  if (game.zm.spawnStreet) game.zm.spawnStreet = () => 0;
  clearDead();
  const sounds = [];
  const sound = game.sound.bind(game);
  game.sound = (id, ...rest) => {
    sounds.push(id);
    sound(id, ...rest);
  };
  const put = (p, x, z) => {
    const s = p.state;
    s.x = x;
    s.z = z;
    s.y = groundAt(w, x, z, 200, 0.3);
    s.vx = s.vy = s.vz = 0;
    s.crouch = 0;
    s.sprinting = 0;
    s.onGround = 1; // (nothing here runs a survivor's own simulation, which would land them and run out their stun)
    s.stunT = 0;
    game.fillHistory(p);
  };
  const tough = () => {
    a.maxHp = a.hp = 1e6;
    a.armor = 0;
  };
  const ticks = (n, fn) => {
    for (let i = 0; i < n; i++) {
      game.update();
      if (game.zombies.length) clearDead();
      if (fn && fn(i) === false) return i;
    }
    return n;
  };
  const alive = () => game.deer.filter((d) => !d.dead);
  const mid = (gr) => ({ x: gr.members.reduce((s, m) => s + m.x, 0) / gr.members.length, z: gr.members.reduce((s, m) => s + m.z, 0) / gr.members.length });

  // ---------------------------------------------------------------- where they are
  {
    const gs = dm.groups;
    const all = alive();
    check('every deer on the mainland is undead: the bit on the wire, the pack flag, the hp', all.length > 0 && all.every((d) => d.variant & DEER_UNDEAD && d.group.undead && d.maxHp === UNDEAD.hp) && gs.every((gr) => gr.undead), `${all.length} deer in ${gs.length} packs`);
    check(`...in packs of ${UNDEAD.groupMin}-${UNDEAD.groupMax}, no more than the cap`, gs.length >= 8 && gs.length <= UNDEAD.groups && all.length <= UNDEAD.cap && gs.every((gr) => gr.members.length >= UNDEAD.groupMin && gr.members.length <= UNDEAD.groupMax), gs.map((gr) => gr.members.length).join(' '));
    const near = gs.filter((gr) => dist(mid(gr), w.start) < UNDEAD.start);
    check(`...and none within ${UNDEAD.start} m of where the team comes off the bridge`, near.length === 0, near.map((gr) => dist(mid(gr), w.start).toFixed(0)).join(' '));
  }

  // a pack of n on open ground of its own, far from the start, every other pack within 150 m of it taken away
  const ours = [];
  const drop = (gr) => {
    for (const m of [...gr.members]) {
      game.deer.splice(game.deer.indexOf(m), 1);
      game.removeEntity(m);
    }
    gr.members.length = 0;
  };
  const roomy = (s) => {
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      for (const r of [8, 16, 24]) if (!dm.open(s.x + Math.sin(ang) * r, s.z + Math.cos(ang) * r)) return false;
    }
    return true;
  };
  const spots = dm.grounds().filter((s) => dist(s, w.start) > 200 && Math.max(Math.abs(s.x), Math.abs(s.z)) < w.half - 80 && roomy(s));
  let spotI = 0;
  const fresh = (n = 4, calm = 0) => {
    const s = spots[(spotI++ * 7) % spots.length];
    for (const o of [...dm.groups]) if (o.members.length && (dist(mid(o), s) < 150 || dist(o, s) < 150)) drop(o);
    const gr = dm.spawnGroup(s.x, s.z, n, null, true);
    gr.calm = calm;
    ours.push(gr);
    return gr;
  };
  // a spot `d` m from the middle of a pack, on open ground with a clear walk to it
  const beside = (gr, d) => {
    const c = mid(gr);
    for (let k = 0; k < 32; k++) {
      const ang = (k / 32) * Math.PI * 2;
      const x = c.x + Math.sin(ang) * d;
      const z = c.z + Math.cos(ang) * d;
      if (dm.open(x, z) && dm.clearWay(x, z, c.x, c.z, d)) return { x, z };
    }
    return { x: c.x + d, z: c.z };
  };
  // ...and one `d` m from the nearest of it
  const off = (gr, d) => {
    const c = mid(gr);
    for (let k = 0; k < 32; k++) {
      const ang = (k / 32) * Math.PI * 2;
      for (let r = d; r < d + 14; r += 0.5) {
        const x = c.x + Math.sin(ang) * r;
        const z = c.z + Math.cos(ang) * r;
        if (Math.min(...gr.members.map((m) => Math.hypot(m.x - x, m.z - z))) < d) continue;
        if (dm.open(x, z) && dm.clearWay(x, z, c.x, c.z, r)) return { x, z };
        break;
      }
    }
    return beside(gr, d + 6);
  };
  const away = () => put(a, w.start.x, w.start.z);
  check(`(open ground for test packs: ${spots.length} spots)`, spots.length > 10);

  // ---------------------------------------------------------------- on the wire
  {
    const gr = fresh(4, 1e9);
    const at = beside(gr, 40);
    put(a, at.x, at.z);
    ticks(3);
    const ok = gr.members.every((m) => {
      const e = A.store.ents.get(m.id);
      return e && e.kind === ENT.DEER && e.variant === m.variant && e.variant & DEER_UNDEAD;
    });
    check('a survivor 40 m off is sent the pack, the undead bit in each one\'s variant', ok);
    drop(gr);
  }

  // ---------------------------------------------------------------- left alone, a pack roams
  {
    away();
    const gr = fresh(4);
    const from = mid(gr);
    let far = 0;
    let ran = false;
    ticks(20 * 180, () => {
      far = Math.max(far, dist(mid(gr), from));
      if (gr.members.some((m) => m.anim === DANIM.RUN || m.anim === DANIM.CHARGE)) ran = true;
    });
    check('a pack nobody comes near roams: in three minutes it has moved on a good way, at a walk', far > 25 && !ran && gr.members.every((m) => dist(m, mid(gr)) < 16), `${far.toFixed(0)} m from where it began`);
    drop(gr);
  }

  // ---------------------------------------------------------------- what sets it off
  {
    tough();
    const gr = fresh(4);
    let at = off(gr, UNDEAD.notice + 4);
    put(a, at.x, at.z);
    ticks(40);
    check(`a survivor standing ${UNDEAD.notice + 4} m from the nearest of a pack is let be`, gr.mode !== HUNT, `mode ${gr.mode}`);
    at = off(gr, UNDEAD.notice * UNDEAD.crouch + 3);
    put(a, at.x, at.z);
    a.state.crouch = 1;
    ticks(20);
    check(`...and one crouched ${(UNDEAD.notice * UNDEAD.crouch + 3).toFixed(0)} m off`, gr.mode !== HUNT, `mode ${gr.mode}`);
    a.downed = true;
    a.bleed = 999;
    a.state.downed = 1;
    a.state.crouch = 0;
    at = off(gr, 8);
    put(a, at.x, at.z);
    ticks(40);
    check('...and one lying downed 8 m off: they are not hunted', gr.mode !== HUNT);
    a.downed = false;
    a.bleed = 0;
    a.state.downed = 0;
    // standing, inside the notice range
    at = off(gr, UNDEAD.notice - 4);
    put(a, at.x, at.z);
    sounds.length = 0;
    const t0 = game.tick;
    ticks(8, () => gr.mode !== HUNT);
    check('one standing inside the notice range sets the whole pack on them at once, with a bellow', gr.mode === HUNT && gr.prey === a.id && game.tick - t0 <= 6 && sounds.includes(SOUND.DEER_SCREAM), `after ${game.tick - t0} ticks`);
    // what each of them does, until four rams have landed
    const hp0 = a.hp;
    const windup = new Map(); // member -> the tick its antlers went down, standing
    const before = []; // for every ram: s the antlers were down before it went
    const knocked = [];
    let rams = 0;
    let fastest = 0;
    let last = a.hp;
    ticks(20 * 40, () => {
      for (const m of gr.members) {
        if (m.hs === 1 && !windup.has(m)) windup.set(m, game.tick);
        if (m.hs === 2) fastest = Math.max(fastest, Math.hypot(m.vx, m.vz));
        if (m.ramT > 0.44) {
          before.push(windup.has(m) ? (game.tick - windup.get(m)) / 20 : -1);
          windup.delete(m);
        }
        if (m.hs === 0) windup.delete(m);
      }
      if (a.hp < last) {
        rams++;
        knocked.push(Math.hypot(a.state.vx, a.state.vz));
        // (stand still where they were: the survivor does not move in this test)
        put(a, at.x, at.z);
      }
      last = a.hp;
      return rams < 4;
    });
    check('they come at a survivor who stands still and ram them: four rams inside 40 s', rams >= 4, `${rams} rams, ${(hp0 - a.hp).toFixed(0)} hp`);
    check('...every one after the antlers were down a windup\'s length', before.length >= 4 && before.every((s) => s >= UNDEAD.windup - 0.06), before.map((s) => s.toFixed(2)).join(' '));
    check(`...at a charge faster than a sprint (${UNDEAD.charge} m/s)`, fastest > 8 && fastest <= UNDEAD.charge + 0.5, `${fastest.toFixed(1)} m/s`);
    const per = (hp0 - a.hp) / Math.max(1, rams);
    const want = UNDEAD.dmg * (1 + 0.07 * (game.day - 1)) * game.diff.hurt;
    check('...each for the ram\'s damage (the day\'s claw multiplier, the difficulty\'s)', Math.abs(per - want) < 0.5, `${per.toFixed(1)} a ram, ${want.toFixed(1)} wanted`);
    check('...and each throws them back', knocked.length >= 4 && knocked.every((v) => v > UNDEAD.knock * 0.6), knocked.map((v) => v.toFixed(1)).join(' '));
    // one that gets home while they are still off their feet from the last: it hurts, it does not throw them again
    {
      a.state.onGround = 0;
      a.state.stunT = 0.1;
      a.state.vx = a.state.vz = 0;
      const hp1 = a.hp;
      const m = gr.members[0];
      dm.ram(m, gr, a);
      check('...but not again while they are still off their feet: the shoves of a pack do not add up', a.hp < hp1 && Math.hypot(a.state.vx, a.state.vz) === 0, `${(hp1 - a.hp).toFixed(0)} hp, ${Math.hypot(a.state.vx, a.state.vz).toFixed(1)} m/s`);
      put(a, at.x, at.z);
    }
    // they get away: the pack gives up
    const go = beside(gr, UNDEAD.leash + 40);
    put(a, go.x, go.z);
    ticks(8);
    check(`a survivor ${UNDEAD.leash + 40} m off is given up on`, gr.mode !== HUNT && gr.prey === 0, `mode ${gr.mode}`);
    ticks(20 * 12);
    check('...and the pack roams again', gr.mode === 0 || gr.mode === 1, `mode ${gr.mode}`);
    drop(gr);
  }

  // ---------------------------------------------------------------- stepping aside
  {
    const trial = (dodge) => {
      tough();
      const gr = fresh(3);
      const at = beside(gr, UNDEAD.notice - 6);
      put(a, at.x, at.z);
      let charges = 0;
      let rams = 0;
      let last = a.hp;
      const seen = new Set();
      let dodgeT = 0;
      let dir = null;
      ticks(20 * 45, () => {
        for (const m of gr.members) {
          if (m.hs === 2 && !seen.has(m)) {
            seen.add(m);
            charges++;
            if (dodge && dodgeT <= 0) {
              dodgeT = 0.6; // a step to the side, as the charge leaves
              const side = charges & 1 ? 1 : -1;
              dir = { x: -m.chz * side, z: m.chx * side };
            }
          }
          if (m.hs !== 2) seen.delete(m);
        }
        if (dodgeT > 0) {
          dodgeT -= 0.05;
          const nx = a.state.x + dir.x * 5 * 0.05;
          const nz = a.state.z + dir.z * 5 * 0.05;
          if (dm.open(nx, nz)) {
            a.state.x = nx;
            a.state.z = nz;
            a.state.y = groundAt(w, nx, nz, a.state.y + 1, 0.3);
          }
        }
        if (a.hp < last) rams++;
        last = a.hp;
        a.state.vx = a.state.vz = 0;
      });
      drop(gr);
      return { charges, rams };
    };
    const still = trial(false);
    const side = trial(true);
    check('a survivor who stands still is hit by most charges', still.charges >= 6 && still.rams / still.charges > 0.7, `${still.rams} of ${still.charges}`);
    check('...one who steps aside as each charge leaves is missed by most', side.charges >= 6 && side.rams / side.charges < 0.5, `${side.rams} of ${side.charges}`);
  }

  // ---------------------------------------------------------------- shots, and the noise of them
  {
    tough();
    away();
    const gr = fresh(4);
    const at = beside(gr, 45);
    put(a, at.x, at.z);
    ticks(10);
    check('(45 m off: let be)', gr.mode !== HUNT);
    dm.damage(gr.members[0], 10, a, { weapon: ITEM.PISTOL });
    ticks(2);
    check('a shot at one of them from 45 m sets the pack on whoever fired it', gr.mode === HUNT && gr.prey === a.id);
    drop(gr);
    const gr2 = fresh(4);
    const at2 = beside(gr2, 40);
    put(a, at2.x, at2.z);
    ticks(10);
    const far = beside(gr2, 30);
    game.zm.noise(far.x + 0.1, far.z, 60);
    ticks(2);
    check('a noise nobody is standing at only turns them to look', gr2.mode === WARY);
    ticks(20 * 8);
    game.zm.noise(a.state.x, a.state.z, 60);
    ticks(2);
    check('a gun fired 40 m off (it carries 60 m) sets them on whoever fired it', gr2.mode === HUNT && gr2.prey === a.id, `mode ${gr2.mode}`);
    drop(gr2);
  }

  // ---------------------------------------------------------------- the kill
  {
    away();
    const gr = fresh(3, 1e9);
    const d = gr.members[0];
    const before = new Set(game.items);
    const kills = a.kills;
    dm.damage(d, 1e4, a, { weapon: ITEM.PISTOL });
    ticks(2);
    const drops = game.items.filter((e) => !before.has(e) && dist(e, d) < 4);
    const what = new Set(drops.map((e) => e.item));
    check('a dead one leaves leather, and no venison: nothing of it is fit to eat', d.dead && UNDEAD_LOOT.every(([it]) => what.has(it)) && !what.has(ITEM.VENISON_RAW), [...what].join(' '));
    check('...and is on nobody\'s record', a.kills === kills);
    drop(gr);
  }

  // ---------------------------------------------------------------- the hitbox while charging
  {
    const hb = deerHitbox(0, DANIM.CHARGE);
    check('a charging one\'s head is judged where the model carries it, down level with its back', hb.headY === DEER_HEAD.charge[0] && hb.headY < DEER_HEAD.up[0] - 0.15);
  }

  // ---------------------------------------------------------------- ten minutes on the plain
  // A survivor turns up 14 m from the next pack every 7 s and stands there: wherever the hunts take them, no deer is
  // ever in the water, inside anything solid or off the map, and none stands pushing at what holds it up
  {
    tough();
    for (const gr of [...dm.groups]) drop(gr);
    dm.update(0.05);
    dm.spawnInitial();
    let wet = 0;
    let inside = 0;
    let offMap = 0;
    let stuck = 0;
    let n = 0;
    let rams = 0;
    let hunts = 0;
    let k = 0;
    let last = a.hp;
    const body = { x: 0, y: 0, z: 0 };
    ticks(20 * 600, (i) => {
      if (i % 140 === 0) {
        const gs = dm.groups.filter((gr) => gr.members.length);
        const gr = gs[k++ % gs.length];
        const at = off(gr, 14);
        put(a, at.x, at.z);
        hunts++;
      }
      if (a.hp < last) rams++;
      a.state.vx = a.state.vz = 0;
      last = a.hp = Math.max(a.hp, 1e5);
      for (const m of alive()) {
        n++;
        if (deepWaterAt(w, m.x, m.z, m.y, 0.2, false)) wet++;
        if (Math.abs(m.x) > w.half - 9.9 || Math.abs(m.z) > w.half - 9.9 || m.x !== m.x) offMap++;
        if (m.stuckT > 0.5) stuck++;
        if (i % 10 === 0) {
          body.x = m.x;
          body.y = m.y;
          body.z = m.z;
          // (the body, not the head: the river bed under a bridge's deck is low; and a deck's end over the bed can
          // take a hand's width of a deer's legs, as it does the living deer's: inside is more than that)
          resolveBody(w, body, UNDEAD.radius * 0.75, 0.9, false);
          if (Math.hypot(body.x - m.x, body.z - m.z) > 0.15) {
            inside++;
            if (process.env.DEBUG_INSIDE) console.log('inside', i, m.id, m.x.toFixed(2), m.y.toFixed(2), m.z.toFixed(2), 'pushed', Math.hypot(body.x - m.x, body.z - m.z).toFixed(3), 'hs', m.hs, 'mode', m.group.mode, 'v', Math.hypot(m.vx, m.vz).toFixed(2), 'anim', m.anim);
          }
        }
      }
    });
    check('ten minutes of packs hunting a survivor round the plain: none in the water, inside anything solid or off the map', wet + inside + offMap === 0 && rams > 40, `${hunts} hunts, ${rams} rams; ${wet} wet, ${inside} inside, ${offMap} off`);
    check('...and hardly ever held up pushing at something', stuck / n < 0.01, `${((stuck / n) * 100).toFixed(2)}% of deer-ticks`);
  }

  // ---------------------------------------------------------------- a death by one
  {
    A.notes.length = 0;
    A.events.length = 0;
    a.maxHp = 100;
    a.hp = 1;
    a.armor = 0;
    for (let i = 0; i < a.inv.length; i++) if (a.inv[i]?.item === ITEM.MEDKIT) a.inv[i] = null; // (no getting up again)
    const gr = fresh(4);
    const at = beside(gr, 10);
    put(a, at.x, at.z);
    ticks(20 * 30, () => a.alive);
    const kf = A.events.find((e) => e[0] === 'killfeed' && e[3] === a.id);
    const died = A.notes.find(([m]) => m === NOTIFY.YOU_DIED);
    check('a survivor rammed to death: the killfeed blames an undead deer, and so does their death card', !a.alive && !!kf && kf[1] === KILLER.WORLD && kf[5] & 8 && !!died && died[1] === 254, kf ? `kf ${kf.slice(1).join(',')}` : 'no killfeed');
    drop(gr);
  }
}

for (const s of seeds) run(s);
if (fails.length) {
  console.log(`\n${fails.length} FAILED:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log(`all checks passed (${passes} over seeds ${seeds.join(', ')})`);
