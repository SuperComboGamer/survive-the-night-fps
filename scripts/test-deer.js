// The valley's deer (server/deer.js, shared/deer.js), against the real server in-process and decoded as a client
// does: where the groups are put, what makes them bolt and how far, that a shot at one goes through the same
// lag-compensated path as a shot at a zombie dog, what a kill leaves and what it does not count as, that nothing
// that walks the zombie list ever meets a deer, the dawn's newcomers, venison - and that half an hour of being
// chased round the valley leaves none in the lake, down the mine, inside a wall or standing pushing at one.
// usage: node scripts/test-deer.js [seed ...]   (VERBOSE=1 prints the passes too)
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, ENT, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { MAP_HALF, PHASE, SPRINT_SPEED, SERVER_DT } from '../shared/constants.js';
import { ITEM, ZTYPE, ZONE, STRUCT, SOUND, NOTIFY, RECIPES, CONSUMABLES, WEAPONS, EVT } from '../shared/defs.js';
import { groundAt, deepWaterAt } from '../shared/collision.js';
import { readSnapshot } from '../client/net/decode.js';
import { DEER, DANIM, DEER_LOOT, DEER_HEAD, deerHitbox } from '../shared/deer.js';
import { countItem } from '../server/inventory.js';

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

function run(seed) {
  seedNow = seed;
  const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  // a client: what the server sends it, decoded as the real one decodes it
  const client = (name) => {
    const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], chat: [], events: [] };
    const nop = () => {};
    c.handler = new Proxy({ notify: (m, a) => c.notes.push([m, a]), killfeed: (...a) => c.events.push(['killfeed', ...a]), hitmark: (f) => c.events.push(['hitmark', f]) }, { get: (t, k) => t[k] || nop });
    c.conn = {
      send(bytes) {
        const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
        const t = r.u8();
        if (t === S2C.WELCOME) c.id = r.u16();
        else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
        else if (t === S2C.CHAT) {
          r.u16();
          r.u8();
          c.chat.push(r.str());
        }
      },
    };
    c.session = game.onOpen(c.conn);
    const w = new Writer(64);
    w.u8(C2S.JOIN);
    w.u8(PROTOCOL_VERSION);
    w.str(name);
    game.onMessage(c.session, w.bytes().slice());
    c.p = () => game.players.get(c.id);
    if (c.p()) c.p().admin = true; // (the admin chat commands)
    c.act = (act, a) => {
      const w2 = new Writer(16);
      w2.u8(C2S.ACTION);
      w2.u8(act);
      w2.u8(a);
      game.onMessage(c.session, w2.bytes().slice());
    };
    return c;
  };
  const A = client('Ann');
  const a = A.p();
  const w = game.world;
  const dm = game.dm;
  // the valley to ourselves: none of the dead about unless a check puts one there
  const clearDead = () => {
    for (const z of [...game.zombies]) game.removeEntity(z);
    game.zombies.length = 0;
  };
  game.zm.spawnRoamer = () => null;
  game.zm.spawnForestPack = () => 0;
  game.zm.herds.spawn = () => null;
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
    game.fillHistory(p);
  };
  const far = () => put(a, w.car.x, w.car.z); // (no group is put down within 70 m of the car)
  const ticks = (n, fn) => {
    for (let i = 0; i < n; i++) {
      game.update();
      if (fn) fn(i);
    }
  };
  const alive = () => game.deer.filter((d) => !d.dead);
  const mid = (gr) => ({ x: gr.members.reduce((s, m) => s + m.x, 0) / gr.members.length, z: gr.members.reduce((s, m) => s + m.z, 0) / gr.members.length });
  // a spot `d` m from the middle of a group with a clear walk to it, and nothing else of the valley's deer near
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
  // a group of n on ground of its own with open ground all round, far from the valley's groups
  const fresh = (n = 3, calm = 0) => {
    const spots = dm.grounds();
    for (const s of spots) {
      if (dm.groups.some((gr) => gr.members.length && (Math.hypot(gr.cx - s.x, gr.cz - s.z) < 110 || Math.hypot(gr.x - s.x, gr.z - s.z) < 110))) continue;
      if (Math.hypot(s.x - w.car.x, s.z - w.car.z) < 80 || Math.max(Math.abs(s.x), Math.abs(s.z)) > MAP_HALF - 90) continue;
      const gr = dm.spawnGroup(s.x, s.z, n);
      if (gr) gr.calm = calm;
      return gr;
    }
    throw new Error('no ground for a test group');
  };
  const drop = (gr) => {
    for (const m of [...gr.members]) {
      game.deer.splice(game.deer.indexOf(m), 1);
      game.removeEntity(m);
    }
    gr.members.length = 0;
  };

  // ---------------------------------------------------------------- where they are
  {
    const gs = dm.groups;
    const n = alive().length;
    check('the valley has its groups of deer: 2-4 to a group, no more than the cap', gs.length >= 3 && gs.length <= DEER.groups && n <= DEER.cap && gs.every((gr) => gr.members.length >= DEER.groupMin && gr.members.length <= DEER.groupMax), `${gs.length} groups, ${n} deer: ${gs.map((gr) => gr.members.length).join(' ')}`);
    const bad = [];
    for (const gr of gs) {
      if (w.zoneAt(gr.x, gr.z) !== ZONE.FOREST) bad.push(`in a place ${gr.x},${gr.z}`);
      if (w.roadDistAt(gr.x, gr.z) < 22) bad.push(`on a road ${gr.x},${gr.z}`);
      if (Math.hypot(gr.x - w.car.x, gr.z - w.car.z) < 70) bad.push('at the car');
      for (const p of w.mine?.portals || []) if (Math.hypot(p.x - gr.x, p.z - gr.z) < 26) bad.push('at a mine mouth');
      for (const o of gs) if (o !== gr && dist(o, gr) < 54) bad.push('two groups together');
      for (const m of gr.members) if (!dm.open(m.x, m.z) || Math.hypot(m.x - gr.x, m.z - gr.z) > 8) bad.push(`a member off its ground ${m.x.toFixed(0)},${m.z.toFixed(0)}`);
    }
    check('...in the woods and clearings: off the places, the roads, the car and the mine mouths, apart from each other', bad.length === 0, bad.slice(0, 4).join('; '));
    check('...as an entity kind of their own: none of them in the zombie list, the horde or any ZTYPE', game.deer.every((d) => d.kind === ENT.DEER && !game.zombies.includes(d)) && game.hordeAlive() === 0 && !Object.keys(ZTYPE).some((k) => /deer/i.test(k)));
    check('...with a buck in some groups, never two', gs.every((gr) => gr.members.filter((m) => m.variant & 1).length <= 1), gs.map((gr) => gr.members.filter((m) => m.variant & 1).length).join(' '));
  }

  // ---------------------------------------------------------------- on the wire
  {
    const gr = dm.groups[0];
    const at = beside(gr, 40);
    put(a, at.x, at.z);
    ticks(3);
    const seen = [...A.store.ents.values()].filter((e) => e.kind === ENT.DEER);
    const ok = gr.members.every((m) => {
      const e = A.store.ents.get(m.id);
      return e && e.kind === ENT.DEER && e.variant === m.variant && Math.abs(e.q[0] / 64 - m.x) < 0.02 && Math.abs(e.q[2] / 64 - m.z) < 0.02 && e.q[4] === m.anim;
    });
    check('a survivor 40 m off is sent the group: kind, coat, position, what each is doing', ok && seen.length >= gr.members.length, `${seen.length} deer known`);
    far();
    ticks(3);
    check('...and no longer, from the other side of the valley', dist(a.state, mid(gr)) < 115 || ![...A.store.ents.values()].some((e) => e.id === gr.members[0].id));
  }

  // ---------------------------------------------------------------- left alone, they graze
  {
    far();
    const gr = fresh(4);
    const from = mid(gr);
    let grazing = 0;
    let walking = 0;
    let n = 0;
    let wet = 0;
    ticks(1200, () => {
      for (const m of gr.members) {
        n++;
        if (m.anim === DANIM.GRAZE) grazing++;
        if (m.anim === DANIM.WALK) walking++;
        if (!dm.open(m.x, m.z)) wet++;
      }
    });
    check('a group nobody comes near grazes: heads down most of a minute, a few steps now and then, never at a run', grazing / n > 0.55 && walking / n > 0.01 && walking / n < 0.4 && gr.members.every((m) => m.anim !== DANIM.RUN) && wet === 0, `grazing ${((grazing / n) * 100).toFixed(0)}%, walking ${((walking / n) * 100).toFixed(0)}%`);
    check('...and stays together on its ground (or drifts on to new ground a little way off)', dist(mid(gr), from) < 50 && gr.members.every((m) => dist(m, mid(gr)) < 12), `moved ${dist(mid(gr), from).toFixed(1)} m`);
    drop(gr);
  }

  // ---------------------------------------------------------------- a survivor comes close
  {
    const gr = fresh(3);
    const c0 = mid(gr);
    let at = beside(gr, DEER.notice + 9);
    put(a, at.x, at.z);
    ticks(60);
    check('a survivor standing 31 m off does not trouble them', gr.mode !== 2 && dist(mid(gr), c0) < 6, `mode ${gr.mode}`);
    // crouched, they can come much nearer
    at = beside(gr, DEER.notice * DEER.crouch + 9);
    put(a, at.x, at.z);
    a.state.crouch = 1;
    ticks(40);
    const calm = gr.mode !== 2;
    check(`...nor one crouched ${(DEER.notice * DEER.crouch + 9).toFixed(0)} m off, where one standing would`, calm && gr.members.every((m) => dist(m, a.state) < DEER.notice + 9), `nearest ${Math.min(...gr.members.map((m) => dist(m, a.state))).toFixed(1)} m`);
    a.state.crouch = 0;
    at = beside(gr, DEER.notice - 3);
    put(a, at.x, at.z);
    sounds.length = 0;
    let top = 0;
    let boltTick = -1;
    ticks(260, (i) => {
      if (boltTick < 0 && gr.mode === 2) boltTick = i;
      for (const m of gr.members) top = Math.max(top, Math.hypot(m.vx, m.vz));
    });
    const c1 = mid(gr);
    check('standing up there (inside the notice range) sends the whole group off at once, with a snort', boltTick >= 0 && boltTick <= 6 && sounds.includes(SOUND.DEER_SNORT), `bolted on tick ${boltTick}`);
    check('...faster than a survivor sprints', top > SPRINT_SPEED + 0.8 && top <= DEER.run + 1.5, `${top.toFixed(1)} m/s against ${SPRINT_SPEED}`);
    check('...a good way off, away from the survivor, and there they stop', dist(c1, c0) > 35 && dist(c1, a.state) > dist(c0, a.state) + 25 && gr.mode !== 2 && gr.members.every((m) => Math.hypot(m.vx, m.vz) < 2 && m.anim !== DANIM.RUN), `${dist(c1, c0).toFixed(0)} m, now ${dist(c1, a.state).toFixed(0)} m from them, mode ${gr.mode}`);
    check('...still together', gr.members.every((m) => dist(m, c1) < 14), gr.members.map((m) => dist(m, c1).toFixed(0)).join(' '));
    far();
    ticks(400);
    check('...and soon graze again', gr.mode === 0 || gr.mode === 1, `mode ${gr.mode}`);
    drop(gr);
  }

  // ---------------------------------------------------------------- noise, and the dead
  {
    far();
    const gr = fresh(3);
    const c0 = mid(gr);
    const n0 = beside(gr, 40);
    game.zm.noise(n0.x, n0.z, 20);
    ticks(10);
    check('a noise that does not carry to them (20 m, from 40 m off) leaves them grazing', gr.mode !== 2);
    game.zm.noise(n0.x, n0.z, 45);
    ticks(120);
    const c1 = mid(gr);
    check('a pistol shot 40 m off (it carries 45 m) sends them running the other way', dist(c1, c0) > 25 && dist(c1, n0) > dist(c0, n0) + 15, `${dist(c1, c0).toFixed(0)} m, ${dist(c0, n0).toFixed(0)} -> ${dist(c1, n0).toFixed(0)} m from the shot`);
    drop(gr);
  }
  {
    far();
    const gr = fresh(3);
    const c0 = mid(gr);
    const zat = beside(gr, 11);
    const z = game.zm.spawn(ZTYPE.WALKER, zat.x, zat.z);
    const hp = gr.members.map((m) => m.hp);
    ticks(160);
    const c1 = mid(gr);
    check('one of the dead 11 m off sends them running from it', !!z && dist(c1, c0) > 25 && dist(c1, z) > 30, `${dist(c1, c0).toFixed(0)} m, ${dist(c1, z).toFixed(0)} m from it`);
    check('...and it takes no notice of them: no target, no chase, no harm done', z.target === 0 && dist(z, zat) < 25 && gr.members.every((m, i) => m.hp === hp[i]), `it moved ${dist(z, zat).toFixed(1)} m`);
    clearDead();
    drop(gr);
  }

  // a lane to shoot down: open, level ground for a deer and for a shooter 7 m to the side of it, nothing in between
  const lane = dm.grounds().find((s) => {
    if (Math.hypot(s.x - w.car.x, s.z - w.car.z) < 80) return false;
    for (let k = -1; k <= 7; k++) if (!dm.open(s.x + k, s.z) || !dm.open(s.x + k, s.z + 7)) return false;
    const y = groundAt(w, s.x, s.z, 200, 0.2);
    for (let k = -0.5; k <= 6.5; k += 0.25) {
      const ys = groundAt(w, s.x + k, s.z + 7, 200, 0.3);
      if (Math.abs(groundAt(w, s.x + k, s.z, 200, 0.2) - y) > 0.3 || Math.abs(ys - y) > 0.5) return false;
      for (const h of [0.25, 0.8, 1.4]) if (!game.zm.clearLine(s.x + k, ys + 1.62, s.z + 7, s.x + k, y + h, s.z - 0.5)) return false;
    }
    return true;
  });
  // ...and one deer standing in it, side on to the shooter, that lets them come that close
  const inLane = (anim) => {
    for (const o of dm.groups) if (o.members.length && Math.hypot(o.cx - lane.x, o.cz - lane.z) < 60) drop(o);
    const gr = dm.spawnGroup(lane.x + 3, lane.z, 1);
    const d = gr.members[0];
    gr.calm = 1e9;
    d.x = lane.x + 3;
    d.z = lane.z;
    d.y = groundAt(w, d.x, d.z, 200, 0.2, false);
    d.yaw = -Math.PI / 2; // facing +x
    d.anim = anim;
    game.fillHistory(d);
    return gr;
  };

  // ---------------------------------------------------------------- hunting: the lag-compensated hit path
  // The same probe for a deer and for a zombie dog: it runs a straight line for 12 ticks, as the game records it, and
  // a shooter whose screen is 8 ticks behind fires at where it was drawn then. The server has to rewind to hit it.
  {
    far();
    const shots = (e, bodyY, undo) => {
      e.x = lane.x;
      e.z = lane.z;
      e.y = groundAt(w, e.x, e.z, 200, 0.2, false);
      game.fillHistory(e);
      const gy = e.y;
      for (let k = 0; k < 12; k++) {
        game.tick++;
        e.x += 0.45;
        e.y = gy;
        game.recordHistory();
      }
      const old = { x: e.x - 8 * 0.45, y: gy + bodyY, z: e.z };
      put(a, old.x, old.z + 7);
      const oy = a.state.y + 1.62;
      const dx = old.x - a.state.x;
      const dz = old.z - a.state.z;
      const ev = { weapon: ITEM.PISTOL, x: a.state.x, y: oy, z: a.state.z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(old.y - oy, Math.hypot(dx, dz)), recoilPitch: 0, spread: 0, seed: 1 };
      const res = [];
      for (const back of [0, 8]) {
        const hp = e.hp;
        a.renderTick = (game.tick - back) & 0xffff;
        a.renderFrac = 0;
        game.combat.fire(a, ev);
        res.push(e.hp < hp);
        undo();
      }
      return res;
    };
    const gr = inLane(DANIM.IDLE);
    const d = gr.members[0];
    const deer = shots(d, 0.7, () => {
      gr.boltCd = 0;
      gr.mode = 0;
    });
    drop(gr);
    const dog = game.zm.spawn(ZTYPE.DOG, lane.x, lane.z);
    const dogs = shots(dog, 0.4, () => {});
    check('a shot at where a running deer was 8 ticks ago misses unless the server rewinds to the shooter\'s picture, and then hits', deer[0] === false && deer[1] === true, `no rewind: ${deer[0] ? 'hit' : 'miss'}, rewound: ${deer[1] ? 'hit' : 'miss'}`);
    check('...exactly as it goes for a zombie dog', dogs[0] === deer[0] && dogs[1] === deer[1], `dog: no rewind ${dogs[0] ? 'hit' : 'miss'}, rewound ${dogs[1] ? 'hit' : 'miss'}`);
    clearDead();
  }

  // ---------------------------------------------------------------- hunting: what a hit does
  {
    far();
    // one shot from 7 m at a point h m above the deer's feet and `ahead` m in front of it
    const fireAt = (d, h, ahead, weapon = ITEM.PISTOL) => {
      const tx = d.x - Math.sin(d.yaw) * ahead;
      const tz = d.z - Math.cos(d.yaw) * ahead;
      // from its flank, so the head is not behind the body
      put(a, tx + Math.cos(d.yaw) * 7, tz - Math.sin(d.yaw) * 7);
      const oy = a.state.y + 1.62;
      const dx = tx - a.state.x;
      const dz = tz - a.state.z;
      a.renderTick = game.tick & 0xffff;
      a.renderFrac = 0;
      A.events.length = 0;
      game.combat.fire(a, { weapon, x: a.state.x, y: oy, z: a.state.z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(d.y + h - oy, Math.hypot(dx, dz)), recoilPitch: 0, spread: 0, seed: 1 });
    };
    const one = inLane;
    let gr = one(DANIM.IDLE);
    let d = gr.members[0];
    fireAt(d, 0.7, 0);
    check('a pistol round in the body wounds it (30 of its 70)', !d.dead && d.hp === DEER.hp - WEAPONS[ITEM.PISTOL].damage, `hp ${d.hp}`);
    check('...and it bolts, bleating', gr.mode === 2 && sounds.includes(SOUND.DEER_BLEAT));
    fireAt(d, 0.7, 0);
    fireAt(d, 0.7, 0);
    check('...three bring it down', d.dead && d.anim === DANIM.DEAD, `hp ${d.hp}`);
    drop(gr);
    game.deer.splice(game.deer.indexOf(d), 1);
    game.removeEntity(d);

    gr = one(DANIM.IDLE);
    d = gr.members[0];
    const kills0 = [a.zkills, a.kills, game.nightStats.kills];
    const items0 = new Set(game.items);
    let credits = 0;
    const credit = game.credit.bind(game);
    game.credit = (...args) => {
      credits++;
      credit(...args);
    };
    fireAt(d, DEER_HEAD.up[0], DEER_HEAD.up[1]);
    check('one in the head kills, as on a dog (the pistol\'s head shot is three times the round)', d.dead && d.anim === DANIM.DEAD);
    ticks(2);
    const left = game.items.filter((e) => !items0.has(e));
    const sum = (item) => left.filter((e) => e.item === item).reduce((n, e) => n + e.count, 0);
    check('a kill leaves leather (1-2) and two cuts of raw venison by the body, to walk over', left.length === DEER_LOOT.length && sum(ITEM.LEATHER) >= 1 && sum(ITEM.LEATHER) <= 2 && sum(ITEM.VENISON_RAW) === 2 && left.every((e) => dist(e, d) < 2.5 && e.drop), left.map((e) => `${e.count} x item ${e.item}`).join(', '));
    check('...and counts for nothing: no kill on the scoreboard, the record or the night, nothing in the killfeed', a.zkills === kills0[0] && a.kills === kills0[1] && game.nightStats.kills === kills0[2] && credits === 0 && !A.events.some((e) => e[0] === 'killfeed'));
    check('...though the shooter\'s hit marker shows the kill', A.events.some((e) => e[0] === 'hitmark' && e[1] & 2 && e[1] & 1), JSON.stringify(A.events));
    game.credit = credit;
    const body = A.store.ents.get(d.id);
    check('the body lies there, on the wire as a dead deer', !!body && body.q[4] === DANIM.DEAD && game.deer.includes(d));
    ticks(Math.ceil(DEER.corpse / SERVER_DT) + 5);
    check(`...for ${DEER.corpse} s, then it is gone`, !game.deer.includes(d) && !A.store.ents.has(d.id) && dm.groups.indexOf(gr) < 0);
    for (const e of left) if (!e.removed) game.removeItemEnt(e);

    // grazing: the head is down in the grass, and that is where a head shot has to go
    gr = one(DANIM.GRAZE);
    d = gr.members[0];
    fireAt(d, DEER_HEAD.up[0], DEER_HEAD.up[1]);
    const missed = d.hp === DEER.hp;
    gr.mode = 0;
    gr.boltCd = 0;
    d.anim = DANIM.GRAZE;
    fireAt(d, DEER_HEAD.graze[0], DEER_HEAD.graze[1]);
    check('a grazing deer\'s head is down in the grass: a shot where it would hold it up passes over, one into the grass kills', missed && d.dead, `over: ${missed ? 'miss' : 'hit'}, low: ${d.dead ? 'kill' : 'no'}`);
    check('...and the hitbox is where shared/deer.js says for both', deerHitbox(0, DANIM.GRAZE).headY === DEER_HEAD.graze[0] && deerHitbox(0, DANIM.IDLE).headY === DEER_HEAD.up[0] && Math.abs(deerHitbox(Math.PI / 2, DANIM.IDLE).hx + DEER_HEAD.up[1]) < 1e-9);
    drop(gr);

    // the quiet weapon: one bolt, and nothing else in the valley hears it
    gr = one(DANIM.GRAZE);
    const other = fresh(2);
    d = gr.members[0];
    put(a, d.x + 30, d.z);
    const heard = dist(mid(other), a.state);
    fireAt(d, 0.7, 0, ITEM.CROSSBOW);
    ticks(5);
    check('a crossbow bolt drops one, and a group out of its 6 m of noise goes on grazing', d.dead && other.mode !== 2 && heard > 6, `the other group ${heard.toFixed(0)} m off`);
    drop(other);
    drop(gr);

    // blades, blasts and fire
    gr = one(DANIM.IDLE);
    d = gr.members[0];
    put(a, d.x, d.z + 1.4);
    a.state.yaw = 0;
    a.state.pitch = -0.3;
    a.renderTick = game.tick & 0xffff;
    game.combat.melee(a, { weapon: ITEM.KNIFE, heavy: true });
    check('a heavy knife blow from beside it kills one (80 against its 70)', d.dead, `hp ${d.hp}`);
    drop(gr);
    gr = fresh(3, 1e9);
    game.combat.explode(gr.members[0].x, gr.members[0].y + 0.3, gr.members[0].z, 7, { zombies: 420, kind: 0, owner: a, weapon: ITEM.PIPEBOMB });
    check('a pipe bomb among them kills what stands in the blast', gr.members.length < 3 && game.deer.some((x) => x.dead));
    drop(gr);
    gr = one(DANIM.GRAZE);
    d = gr.members[0];
    game.combat.spawnArea(2, d.x, d.y, d.z, 4.5, 8, a, 40);
    ticks(8);
    check('burning ground hurts one standing in it, and it runs out of it', d.hp < DEER.hp && gr.mode === 2, `hp ${d.hp.toFixed(0)}`);
    drop(gr);
    for (const e of [...game.areas]) game.removeEntity(e);
    game.areas.length = 0;
    for (const x of game.deer.filter((x) => x.dead)) {
      game.deer.splice(game.deer.indexOf(x), 1);
      game.removeEntity(x);
    }
    for (const e of [...game.items]) if (e.drop) game.removeItemEnt(e);
  }

  // ---------------------------------------------------------------- the game's own random stream is left alone
  {
    far();
    let drawn = 0;
    const rng = game.rng;
    game.rng = () => {
      drawn++;
      return rng();
    };
    const gr = fresh(3);
    dm.bolt(gr, gr.cx + 5, gr.cz);
    for (let i = 0; i < 300; i++) dm.update(SERVER_DT);
    dm.hear(gr.cx, gr.cz, 50);
    dm.damage(gr.members[0], 500, a, {});
    dm.dawn(game.humans());
    for (let i = 0; i < 100; i++) dm.update(SERVER_DT);
    check('grazing, bolting, hearing, dying, dropping, walking in at dawn: none of it draws from the game\'s random stream', drawn === 0 && game.rng !== rng, `${drawn} draws`);
    game.rng = rng;
    drop(gr);
    for (const e of [...game.items]) if (e.drop) game.removeItemEnt(e);
  }

  // ---------------------------------------------------------------- the rest of the game does not count them
  {
    far();
    const n = alive().length;
    const chat = (text) => {
      A.chat.length = 0;
      game.handleChat(a, text);
      return A.chat.join(' | ');
    };
    const sp = chat('/spawn deer');
    const zs = chat('/zombies');
    check('/spawn and /zombies know of no deer', /no zombie called "deer"/.test(sp) && !/deer/i.test(zs) && alive().length === n, sp);
    game.startNight();
    ticks(5);
    check('nightfall takes none of them, and none of them is horde', alive().length === n && game.hordeAlive() + game.waves.reduce((s, wv) => s + wv.queue.length, 0) > 0 && game.zombies.every((z) => z.kind === ENT.ZOMBIE));
    const burning = () => game.zombies.filter((z) => z.burning > 0 || z.onFire).length;
    const z = game.zm.spawn(ZTYPE.WALKER, a.state.x + 40, a.state.z, { horde: true });
    const before = alive().length;
    game.startDay();
    check('the dawn sun burns the horde and not the deer', burning() > 0 && !!z && alive().length >= before && game.deer.every((d) => !d.burning && !d.onFire));
    game.phase = PHASE.DAY;
    clearDead();
  }

  // ---------------------------------------------------------------- dawn: the hunted are replaced
  {
    far();
    for (const gr of [...dm.groups]) drop(gr);
    dm.update(SERVER_DT);
    check('(every deer hunted out)', dm.groups.length === 0 && alive().length === 0);
    // one deer of a group left over: it stays, and does not count as a group
    const lone = fresh(1);
    const made = dm.dawn(game.humans());
    const news = dm.groups.filter((gr) => gr !== lone);
    check('at sunrise new groups come, up to the valley\'s ten and its cap of deer', made >= 3 && news.length <= DEER.groups && alive().length <= DEER.cap && news.every((gr) => gr.members.length >= DEER.groupMin && gr.members.length <= DEER.groupMax), `${made} groups, ${alive().length} deer`);
    check('...in at the rim of the map, out of every survivor\'s sight', news.every((gr) => gr.members.every((m) => Math.max(Math.abs(m.x), Math.abs(m.z)) > MAP_HALF - 22 && dist(m, a.state) > 75)), news.map((gr) => Math.max(Math.abs(gr.cx), Math.abs(gr.cz)).toFixed(0)).join(' '));
    check('...walking, not running, to ground in the woods', news.every((gr) => gr.mode === 1));
    ticks(1500);
    check('...where they are grazing a minute or so later', news.every((gr) => gr.mode !== 1 || gr.t < 60) && news.filter((gr) => dist(mid(gr), gr) < 10).length >= news.length - 1 && news.every((gr) => gr.members.every((m) => m.anim !== DANIM.RUN)), news.map((gr) => dist(mid(gr), gr).toFixed(0)).join(' '));
    const again = dm.dawn(game.humans());
    check('a valley that has its deer gets no more at the next sunrise', again === 0 || alive().length <= DEER.cap, `${again} more, ${alive().length} deer`);
    const startDay = alive().length;
    for (const gr of news.slice(0, 2)) drop(gr);
    dm.update(SERVER_DT);
    game.startDay();
    check('Game.startDay is what calls them in', alive().length > startDay - 8 && dm.groups.length >= news.length - 1, `${alive().length} deer in ${dm.groups.length} groups`);
    clearDead();
  }

  // ---------------------------------------------------------------- venison
  {
    far();
    const rec = RECIPES.find((r) => r.out === ITEM.VENISON);
    check('cooked venison is recipe 30: one raw cut, at a campfire', !!rec && RECIPES[30] === rec && rec.station === 'fire' && rec.cost[ITEM.VENISON_RAW] === 1 && rec.n === 1);
    a.inv.fill(null);
    game.giveItem(a, ITEM.VENISON_RAW, 3);
    A.notes.length = 0;
    game.craft(a, rec.id);
    ticks(1);
    check('with no fire near it cannot be cooked', countItem(a.inv, ITEM.VENISON) === 0 && A.notes.some(([m]) => m === NOTIFY.NEED_FIRE));
    const fire = { stype: STRUCT.CAMPFIRE, x: a.state.x + 1, z: a.state.z, burnLeft: 100 };
    const near = game.nearStation;
    game.nearStation = (p, kind) => (kind === 'fire' ? fire : null);
    game.craft(a, rec.id);
    game.nearStation = near;
    check('at a burning campfire a raw cut becomes a cooked one', countItem(a.inv, ITEM.VENISON) === 1 && countItem(a.inv, ITEM.VENISON_RAW) === 2);
    const eat = (item) => {
      a.hp = 40;
      a.state.stamina = 10;
      A.act(ACT.USE_ITEM, a.inv.findIndex((x) => x && x.item === item));
      ticks(Math.ceil(CONSUMABLES[item].time / SERVER_DT) + 2);
      return [a.hp, Math.round(a.state.stamina)]; // (a little more than the meal: health comes back by itself too)
    };
    const cooked = eat(ITEM.VENISON);
    check('eating it heals 45 and restores stamina: more than a tin of tuna', cooked[0] >= 85 && cooked[0] < 88 && cooked[1] === 100 && CONSUMABLES[ITEM.VENISON].heal > CONSUMABLES[ITEM.TUNA].heal && countItem(a.inv, ITEM.VENISON) === 0, `hp 40 -> ${cooked[0].toFixed(1)}, stamina ${cooked[1]}`);
    const raw = eat(ITEM.VENISON_RAW);
    check('raw, it is eaten for little: 8', raw[0] >= 48 && raw[0] < 51 && countItem(a.inv, ITEM.VENISON_RAW) === 1, `hp 40 -> ${raw[0].toFixed(1)}`);
    a.inv.fill(null);
    a.hp = a.maxHp;
  }

  // ---------------------------------------------------------------- half an hour of being chased about
  // A survivor turns up 18 m from a group every few seconds, and the dead walk the woods: wherever that drives them,
  // no deer is ever in the lake, in a mouth of the mine or down it, or inside anything solid; none stands pushing at
  // a fence; and every bolt ends.
  {
    far();
    for (const gr of [...dm.groups]) drop(gr);
    dm.update(SERVER_DT);
    dm.spawnInitial();
    for (let i = 0; i < 25; i++) {
      const s = w.resourceSpawns[(i * 37) % w.resourceSpawns.length];
      game.zm.spawn(i % 3 ? ZTYPE.WALKER : ZTYPE.RUNNER, s.x, s.z);
    }
    const bad = { water: 0, mine: 0, solid: 0, off: 0 };
    let pushing = 0; // deer-ticks spent held up (wanting to move, not moving)
    let moving = 0;
    let flips = 0; // a gait taken up and dropped again within half a second (run-walk-run, walk-stand-walk): flicker
    let longest = 0;
    let bolts = 0;
    const last = new Map();
    const TICKS = 36000;
    let k = 0;
    ticks(TICKS, (i) => {
      if (i % 140 === 0 && dm.groups.length) {
        const gr = dm.groups[k++ % dm.groups.length];
        const at = beside(gr, 18);
        put(a, at.x, at.z);
        bolts++;
      }
      for (const gr of dm.groups) {
        if (gr.mode === 2) longest = Math.max(longest, gr.t);
        for (const m of gr.members) {
          if (deepWaterAt(w, m.x, m.z, m.y, 0.2, false)) bad.water++;
          if (w.mine && (w.mine.inHole(m.x, m.z) || w.mine.under(m.x, m.y + 0.3, m.z))) bad.mine++;
          if (Math.abs(m.x) > MAP_HALF - 9.9 || Math.abs(m.z) > MAP_HALF - 9.9 || m.x !== m.x) bad.off++;
          if (i % 20 === 0) {
            const p = { x: m.x, y: m.y, z: m.z };
            for (const grid of w.colliderGrids) for (const c of grid.query(m.x, m.z, 0.1, [])) if (!(c.flags & 2) && c.y1 > m.y + 0.5 && c.y0 < m.y + 1 && Math.hypot(c.x - m.x, c.z - m.z) < 0.05) bad.solid++;
            void p;
          }
          const sp = Math.hypot(m.vx, m.vz);
          if (gr.mode === 2 || gr.mode === 1) {
            if (!m.arrived && m.pause <= 0) {
              moving++;
              if (sp < 0.3) pushing++;
            }
          }
          const l = last.get(m) || last.set(m, { now: m.anim, was: -1, t: i }).get(m);
          if (l.now !== m.anim) {
            if (m.anim === l.was && i - l.t < 10) flips++;
            l.was = l.now;
            l.now = m.anim;
            l.t = i;
          }
        }
      }
    });
    const minutes = TICKS / 20 / 60;
    const n = alive().length;
    check('half an hour of being chased: no deer in the lake, in or down the mine, inside anything solid or off the map', bad.water + bad.mine + bad.solid + bad.off === 0, JSON.stringify(bad));
    check('...none stands pushing at what holds it up (under 2% of the time they are going somewhere)', moving > 5000 && pushing / moving < 0.02, `${((pushing / moving) * 100).toFixed(2)}% of ${moving} deer-ticks`);
    check('...no gait flickers (run-walk-run or walk-stand-walk inside half a second: under one a minute each)', flips / n / minutes < 1, `${(flips / n / minutes).toFixed(2)} a minute each`);
    check('...and every bolt ends', longest < 20 && bolts > 100, `longest ${longest.toFixed(1)} s over ${bolts} scares`);
    check('...with all of them still alive and in their groups', n >= 8 && dm.groups.every((gr) => gr.members.every((m) => dist(m, mid(gr)) < 60)), `${n} deer`);
  }
}

for (const seed of seeds) run(seed);
console.log(`\n${fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}` : `all checks passed (${passes} over seeds ${seeds.join(', ')})`}`);
process.exit(fails.length ? 1 : 0);
