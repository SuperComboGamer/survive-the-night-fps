// The Zombies mode on the Shaft Nine map: rounds of the dead, points for hits and kills, guns off the walls, the
// box, perks, debris to buy away, and the cage elevator that takes the team down to the next stop between rounds.
//
// It rides on the survival game's machinery: a round is PHASE.NIGHT (the horde is out) and the time between rounds is
// PHASE.DAY (the elevator, the countdown), `day` is the round number, the buys are ENT.CACHE entities (ctype MINE_CT.*),
// the dead are ordinary zombies spawned with `horde`. What it adds is kept here; Game calls in at a handful of places
// (all behind `this.mine`).
import { ENT } from '../shared/protocol.js';
import { PHASE } from '../shared/constants.js';
import { ITEM, AMMO_MAX, WEAPONS, ZTYPE, NOTIFY, SOUND } from '../shared/defs.js';
import { MINE_STOPS, PERKS, PERK, BOX_COST, CAGE_RECT, setGateOpen, setCageClosed, stopLocal } from '../shared/mine.js';
import { MINE_CT, MINE, boxItem, roundQuota, roundHealth } from '../shared/minedefs.js';
import { groundAt } from '../shared/collision.js';
import { Nav } from './nav.js';

const SLOT_PRIMARY = 0;

const EL = MINE.ELEV;

export class MineMode {
  constructor(game) {
    this.g = game;
    this.reset();
  }

  reset() {
    this.round = 0;
    this.stopIndex = 0;
    this.state = MINE.STATE.PREP; // PREP (countdown to the round), ROUND, CLEAR (waiting at the cage), RIDE
    this.t = MINE.FIRST_PREP;
    this.queue = 0; // zombies of this round still to come
    this.spawnT = 0;
    this.elev = { state: EL.AWAY, t: 0, at: 0, riding: 0, rideLen: 0, moved: false, firstIn: 0 }; // at: 0 the cage at the arrival shaft, 1 the one at the exit
    this.box = new Map(); // stop -> { ent, state, item, buyer, t }
    this.ents = []; // [stop][buy] entity, [stop].gates
    this.points = new Map(); // player id -> points
    this.tracker = [];
    this.doublePoints = 0;
    this.instaKill = 0;
    this.bossAlive = false;
    this.dogRound = false;
    this.stats = { kills: 0 };
    this.sentRound = 0;
    this.boxUses = 0;
    this.drops = 0;
    this.powerups = [];
  }

  get stop() {
    return this.g.world.mine.stops[this.stopIndex];
  }

  // ---------------------------------------------------------------- start of a run
  start() {
    const g = this.g;
    this.reset();
    const w = g.world;
    this.ents = w.mine.stops.map((stop) => {
      const row = { buys: [], gates: [] };
      stop.buys.forEach((b) => {
        const kind = b.kind === 'gun' ? MINE_CT.GUN : b.kind === 'box' ? MINE_CT.BOX : MINE_CT.PERK;
        const e = { kind: ENT.CACHE, ctype: MINE_CT.BUY + b.index, x: b.x, y: b.kind === 'box' ? 0.55 : 1.15, z: b.z, zone: 0, state: 0, schem: 0, stash: 0, mine: { stop: stop.index, buy: b, k: kind } };
        if (g.spawnEntity(e)) {
          g.caches.push(e);
          row.buys.push(e);
          if (b.kind === 'box') this.box.set(stop.index, { ent: e, state: 0, item: 0, buyer: 0, t: 0 });
        }
      });
      stop.gates.forEach((gt) => {
        const [x0, z0, x1, z1] = gt.rect;
        const e = { kind: ENT.CACHE, ctype: MINE_CT.GATE + gt.index, x: stop.ox + (x0 + x1) / 2, y: 1.3, z: stop.oz + (z0 + z1) / 2, zone: 0, state: 0, schem: 0, stash: 0, mine: { stop: stop.index, gate: gt } };
        if (g.spawnEntity(e)) {
          g.caches.push(e);
          row.gates.push(e);
        }
      });
      return row;
    });
    let reopened = false;
    for (const stop of w.mine.stops) {
      stop.gates.forEach((gt, gi) => {
        if (gt.open) reopened = true;
        setGateOpen(w, stop, gi, false);
      });
    }
    if (reopened) g.nav = new Nav(w); // (a run on the same map as one that cleared debris)
    this.stopIndex = 0;
    for (const p of g.players.values()) {
      this.points.set(p.id, MINE.START_POINTS);
      this.spawnPlayer(p);
    }
    this.setCage(0, true, EL.AWAY);
    g.phase = PHASE.DAY;
    g.day = 1;
    g.timeLeft = this.t;
    g.notify(NOTIFY.NEW_GAME, 1);
    g.globalDirty = true;
    g.playersDirty = true;
    g.log('zombies mode: new run');
  }

  // a player (new, or back after a death) starts a stop at the cage, with a pistol and a knife
  spawnPlayer(p, stop = this.stop) {
    const g = this.g;
    g.spawnHuman(p, { mag: WEAPONS[ITEM.PISTOL].mag, ammo: 56, items: [] });
    const s = p.state;
    s.weapons[4] = 0; // (nothing to build here)
    s.slot = 1; // the pistol in hand
    s.perks = 0;
    p.perks = 0;
    p.battery = 100;
    p.flashlight = true; // (the lamp is on: it is dark down here)
    this.placeAt(p, stop, (g.rng() - 0.5) * 3, 5 + g.rng() * 2.5);
    if (!this.points.has(p.id)) this.points.set(p.id, MINE.START_POINTS);
    this.sendPoints(p);
  }

  placeAt(p, stop, lx, lz) {
    const s = p.state;
    s.x = stop.ox + lx;
    s.z = stop.oz + lz;
    s.y = groundAt(this.g.world, s.x, s.z, 5, 0.3);
    s.vx = s.vy = s.vz = 0;
    s.yaw = Math.PI; // facing +z: out into the stop
    s.pitch = 0;
    this.g.fillHistory(p);
  }

  onJoin(p) {
    this.points.set(p.id, MINE.START_POINTS);
    // a run in progress: down with the team, at the cage
    this.spawnPlayer(p);
  }

  onLeave(p) {
    this.points.delete(p.id);
  }

  pts(p) {
    return this.points.get(p.id) || 0;
  }
  addPoints(p, n) {
    if (!p) return;
    if (n > 0 && this.doublePoints > 0) n *= 2;
    this.points.set(p.id, Math.max(0, this.pts(p) + n));
    p.pointsDirty = true;
  }
  sendPoints(p) {
    p.pointsDirty = true;
  }

  // ---------------------------------------------------------------- rounds
  humansUp() {
    return this.g.humans();
  }

  // (the numbers are the old game's: its quota table and health curve, health relative to the 150 of round 1)
  roundTotal(r, n) {
    return Math.max(4, Math.round(roundQuota(r) * (1 + 0.4 * (n - 1))));
  }
  hpMul(r, n) {
    return (roundHealth(r) / 150) * (1 + 0.1 * (n - 1));
  }
  maxAlive(n) {
    return Math.min(36, 24 + 4 * (n - 1));
  }

  startRound() {
    const g = this.g;
    this.round++;
    this.state = MINE.STATE.ROUND;
    const n = Math.max(1, g.humanCount());
    this.dogRound = this.round >= 5 && (this.round - 5) % 5 === 0;
    let total = this.roundTotal(this.round, n);
    if (this.dogRound) total = Math.round(total * 0.55);
    this.queue = total;
    this.bossLeft = this.round % 10 === 0 ? this.round / 10 : 0;
    this.spawnT = 1.5;
    this.alivePeak = 0;
    // the cage that brought the team down leaves: the way on is to be found
    this.elev.at = 0;
    this.setCage(0, true, EL.AWAY);
    g.phase = PHASE.NIGHT;
    g.day = Math.min(255, this.round);
    g.wave = 0;
    g.timeLeft = 0;
    g.hordeHpMul = this.hpMul(this.round, n);
    for (const p of g.players.values()) p.qrUsed = false;
    g.notify(NOTIFY.MINE_ROUND, this.round);
    g.sound(SOUND.HORDE_HORN, 0, 0, 0, 0);
    // everyone who fell last round is back on their feet at the cage
    for (const p of g.players.values()) {
      if (p.alive && !p.zombie) continue;
      this.spawnPlayer(p);
    }
    g.globalDirty = true;
    g.playersDirty = true;
  }

  pickType() {
    const g = this.g;
    const r = this.round;
    if (this.dogRound) return ZTYPE.DOG;
    const id = this.stop.id;
    const w = [[ZTYPE.WALKER, Math.max(20, 100 - r * 7)]];
    if (r >= 3) w.push([ZTYPE.RUNNER, Math.min(45, 6 + r * 4)]);
    if (id === 'tunnels' && r >= 4) w.push([ZTYPE.SPITTER, 6 + r]);
    if (id === 'flooded' && r >= 5) w.push([ZTYPE.LEAPER, 8 + r]);
    if (id === 'crystal' && r >= 6) w.push([ZTYPE.BAT, 8 + r]);
    if (id === 'magma' && r >= 5) w.push([ZTYPE.BOOMER, 6 + r]);
    if (id === 'surface' && r >= 6) w.push([ZTYPE.ROPER, 5 + r]);
    let tot = 0;
    for (const e of w) tot += e[1];
    let x = g.rng() * tot;
    for (const e of w) {
      x -= e[1];
      if (x <= 0) return e[0];
    }
    return ZTYPE.WALKER;
  }

  // A spot in an unlocked area, far enough off and (if there is one) out of every survivor's sight. The dead come out
  // of the dark: nothing is spawned in view.
  pickSpawn(humans) {
    const g = this.g;
    const stop = this.stop;
    const open = stop.spawns; // (every part of the stop is open: nothing to buy your way through)
    if (!open.length || !humans.length) return null;
    let best = null;
    let bd = -1;
    for (let k = 0; k < 8; k++) {
      const sp = open[Math.floor(g.rng() * open.length)];
      let d = 1e9;
      for (const h of humans) d = Math.min(d, Math.hypot(h.state.x - sp.x, h.state.z - sp.z));
      if (d < 16) continue;
      let seen = false;
      for (const h of humans) {
        const s = h.state;
        if (Math.hypot(s.x - sp.x, s.z - sp.z) < 45 && g.zm.clearLine(s.x, s.y + 1.5, s.z, sp.x, s.y + 1.6, sp.z)) {
          seen = true;
          break;
        }
      }
      const score = (seen ? 0 : 1000) - Math.abs(d - 30);
      if (score > bd) {
        bd = score;
        best = sp;
      }
    }
    return best;
  }

  spawnOne(humans) {
    const g = this.g;
    const sp = this.pickSpawn(humans);
    if (!sp) return false;
    let type = this.pickType();
    let boss = false;
    if (this.bossLeft > 0) {
      type = ZTYPE.TANK;
      boss = true;
    }
    const pack = type === ZTYPE.DOG ? g.zm.newPack() : 0;
    const z = g.zm.spawn(type, sp.x + (g.rng() - 0.5) * 2, sp.z + (g.rng() - 0.5) * 2, { horde: true, hpMul: g.hordeHpMul * (boss ? 1.4 : 1), pack, boss: false });
    if (!z) return false;
    z.mineBoss = boss;
    if (boss) {
      this.bossLeft--;
      g.notify(NOTIFY.BOSS, ZTYPE.TANK);
    }
    return true;
  }

  zombiesAlive() {
    let n = 0;
    for (const z of this.g.zombies) if (!z.dead) n++;
    return n;
  }

  // ---------------------------------------------------------------- the tick
  update(dt) {
    const g = this.g;
    if (g.phase === PHASE.GAMEOVER || g.phase === PHASE.VICTORY) {
      g.restartT -= dt;
      if (g.restartT <= 0) g.startGame();
      return;
    }
    if (this.doublePoints > 0) this.doublePoints -= dt;
    if (this.instaKill > 0) this.instaKill -= dt;
    this.updateBox(dt);
    this.updatePowerups(dt);
    const humans = this.humansUp();
    if (this.state === MINE.STATE.PREP) {
      this.t -= dt;
      g.timeLeft = Math.max(0, this.t);
      if (this.t <= 0) this.startRound();
      this.syncSecond();
    } else if (this.state === MINE.STATE.ROUND) {
      const n = Math.max(1, g.humanCount());
      if (this.queue > 0 && humans.length) {
        this.spawnT -= dt;
        if (this.spawnT <= 0) {
          const interval = Math.max(0.38, 2.1 - 0.09 * this.round) * (this.dogRound ? 0.8 : 1);
          this.spawnT = interval * (0.7 + g.rng() * 0.6);
          if (this.zombiesAlive() < this.maxAlive(n) && this.spawnOne(humans)) this.queue--;
        }
      }
      if (this.queue <= 0 && this.zombiesAlive() === 0) this.endRound();
    } else if (this.state === MINE.STATE.CLEAR) {
      this.updateClear(dt);
    } else if (this.state === MINE.STATE.RIDE) {
      this.updateRide(dt);
    }
    this.updatePerksTick(dt);
  }

  // debug (DEBUG_COMMANDS): /clear ends the round now, /round n goes to round n
  debug(cmd, n) {
    const g = this.g;
    if (cmd === 'clear') {
      this.queue = 0;
      for (const z of g.zombies) if (!z.dead) g.combat.killZombie(z, null, {});
    } else if (cmd === 'round' && n > 0) {
      this.round = n - 1;
      this.queue = 0;
      for (const z of [...g.zombies]) {
        g.removeEntity(z);
        g._listRemove(g.zombies, z);
      }
      this.state = MINE.STATE.PREP;
      this.t = 1;
    }
  }

  syncSecond() {
    const g = this.g;
    const s = Math.ceil(this.t);
    if (s !== this.lastSec) {
      this.lastSec = s;
      g.globalDirty = true;
    }
  }

  endRound() {
    const g = this.g;
    this.state = MINE.STATE.CLEAR;
    g.phase = PHASE.DAY;
    g.timeLeft = 0;
    // the downed are pulled up between rounds
    for (const p of g.players.values()) if (p.alive && p.downed && !p.zombie) g.revive(p, null, 60);
    // the cage comes to the exit shaft, somewhere in the stop: the team has to find it
    this.elev.at = 1;
    this.elev.state = EL.ARRIVING;
    this.elev.t = 0;
    this.elev.firstIn = 0;
    g.notify(NOTIFY.MINE_CLEAR, this.round);
    g.sound(SOUND.CAR_PART, this.stop.ox, 1, this.stop.oz, 80);
    g.globalDirty = true;
  }

  inCage(p) {
    const stop = this.stop;
    const [lx, lz] = stopLocal(stop, p.state.x, p.state.z);
    const r = this.elev.at ? stop.exit.rect : CAGE_RECT;
    return lx >= r[0] && lx <= r[2] && lz >= r[1] && lz <= r[3];
  }

  updateClear(dt) {
    const g = this.g;
    const e = this.elev;
    e.t += dt;
    if (e.state === EL.ARRIVING && e.t >= MINE.ARRIVE_TIME) {
      e.state = EL.OPEN;
      e.t = 0;
      this.setCage(1, false, EL.OPEN);
      g.sound(SOUND.CAR_PART, this.stop.exit.x, 1, this.stop.exit.z, 90);
    }
    if (e.state !== EL.OPEN) return;
    // the ride starts once everyone who is up is in the cage, or a little after the first one got in
    const up = g.players.size ? [...g.players.values()].filter((p) => p.alive && !p.zombie && !p.downed) : [];
    const inside = up.filter((p) => this.inCage(p));
    if (inside.length && !e.firstIn) e.firstIn = g.time;
    if (!inside.length) e.firstIn = 0;
    const all = up.length > 0 && inside.length === up.length;
    if ((all && g.time - e.firstIn > 1.2) || (e.firstIn && g.time - e.firstIn > MINE.BOARD_GRACE)) this.beginRide();
  }

  beginRide() {
    const g = this.g;
    const e = this.elev;
    this.state = MINE.STATE.RIDE;
    const next = (this.stopIndex + 1) % MINE_STOPS.length;
    const diff = Math.abs(MINE_STOPS[next].depth - MINE_STOPS[this.stopIndex].depth);
    e.state = EL.CLOSING;
    e.t = 0;
    e.rideLen = Math.max(MINE.RIDE_MIN, Math.min(MINE.RIDE_MAX, 4 + diff / 40));
    e.moved = false;
    this.setCage(1, true, EL.CLOSING);
    // the ones not inside are carried in (the gate is shut: nobody is left on a stop the cage has left)
    for (const p of g.players.values()) {
      if (!p.alive || p.zombie) continue;
      if (!this.inCage(p)) this.placeAt(p, this.stop, this.stop.exit.lx + (g.rng() - 0.5) * 2, this.stop.exit.lz - 0.2 + g.rng() * 1.2);
      p.hold = null;
    }
    g.notify(NOTIFY.MINE_RIDE, next);
    g.globalDirty = true;
  }

  updateRide(dt) {
    const g = this.g;
    const e = this.elev;
    e.t += dt;
    if (e.state === EL.CLOSING && e.t >= MINE.GATE_TIME) {
      e.state = EL.RIDING;
      e.t = 0;
      g.globalDirty = true;
    } else if (e.state === EL.RIDING) {
      if (!e.moved && e.t >= e.rideLen * 0.5) {
        e.moved = true;
        this.moveTeam();
      }
      if (e.t >= e.rideLen) {
        e.state = EL.OPENING;
        e.t = 0;
        g.globalDirty = true;
      }
    } else if (e.state === EL.OPENING && e.t >= MINE.GATE_TIME) {
      e.state = EL.OPEN;
      e.t = 0;
      e.at = 0;
      this.setCage(0, false, EL.OPEN);
      this.state = MINE.STATE.PREP;
      this.t = MINE.PREP;
      g.timeLeft = this.t;
      g.notify(NOTIFY.MINE_STOP, this.stopIndex);
      g.globalDirty = true;
    }
  }

  moveTeam() {
    const g = this.g;
    const from = this.stop;
    this.stopIndex = (this.stopIndex + 1) % MINE_STOPS.length;
    const to = this.stop;
    for (const p of g.players.values()) {
      const s = p.state;
      if (p.alive && !p.zombie) {
        // (the same place in the new cage: from the exit cage of the old stop to the arrival cage of the next)
        s.x += to.ox - from.exit.x;
        s.z += to.oz - from.exit.z;
        s.y = groundAt(g.world, s.x, s.z, 5, 0.3);
        s.vx = s.vy = s.vz = 0;
        g.fillHistory(p);
      }
    }
    // (the leftovers of the old stop stay behind: whatever of the dead is still standing there is of no use now)
    for (const z of [...g.zombies]) {
      if (z.dead) continue;
      g.removeEntity(z);
      g._listRemove(g.zombies, z);
    }
    this.elev.at = 0; // (the ride goes on in the cage of the arrival shaft: the stop's own model and the shaft tube are the same)
    this.setCage(0, true, EL.RIDING);
    g.globalDirty = true;
  }

  // which: 0 the arrival cage of the stop the team is in, 1 its exit cage; every other gate is shut
  setCage(which, closed, state) {
    const w = this.g.world;
    for (const st of w.mine.stops) {
      setCageClosed(w, st, st === this.stop && which === 0 ? closed : true, 0);
      setCageClosed(w, st, st === this.stop && which === 1 ? closed : true, 1);
    }
    this.elev.state = state;
  }

  // ---------------------------------------------------------------- scoring
  // Called with the damage about to be dealt: returns what is dealt (perks, power-ups)
  scaleDamage(p, z, amount, opts) {
    if (!p || p.zombie) return amount;
    if (this.instaKill > 0) return z.hp + 1;
    if (p.perks & PERK.DOUBLE_TAP && !opts.melee && !opts.fire) amount *= 1.33;
    if (p.perks & PERK.DEADSHOT && opts.headshot) amount *= 1.6;
    return amount;
  }

  onHit(p, z, opts, killed) {
    if (!p || p.zombie || p.kind !== ENT.PLAYER) return;
    if (killed) {
      this.addPoints(p, opts.melee ? 130 : opts.headshot ? 100 : 60);
      this.stats.kills++;
      this.maybeDrop(z);
    } else if (!opts.dot && !opts.fire) this.addPoints(p, 10);
  }

  // ---------------------------------------------------------------- power-ups
  // from round 2, at most three a round, 2% a kill (and a better chance for the first when the round is nearly done)
  maybeDrop(z) {
    const g = this.g;
    if (this.round < 2 || this.drops >= 3) return;
    const left = this.queue + this.zombiesAlive() - 1;
    const chance = 0.02 + (this.drops === 0 && left < 3 ? 0.25 : 0);
    if (g.rng() >= chance) return;
    this.drops++;
    const kind = Math.floor(g.rng() * 4);
    const e = { kind: ENT.CACHE, ctype: MINE.POWER_CT + kind, x: z.x, y: 0.9, z: z.z, zone: 0, state: 0, schem: 0, stash: 0, mine: { power: kind, life: MINE.POWER_LIFE } };
    if (g.spawnEntity(e)) {
      g.caches.push(e);
      this.powerups.push(e);
    }
  }

  updatePowerups(dt) {
    const g = this.g;
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const e = this.powerups[i];
      e.mine.life -= dt;
      let taker = null;
      if (e.mine.life > 0) {
        for (const p of g.humans()) {
          if (!p.downed && Math.hypot(p.state.x - e.x, p.state.z - e.z) < 1.6) {
            taker = p;
            break;
          }
        }
      }
      if (!taker && e.mine.life > 0) continue;
      this.powerups.splice(i, 1);
      g._listRemove(g.caches, e);
      g.removeEntity(e);
      if (taker) this.givePower(e.mine.power, taker);
    }
  }

  givePower(kind, p) {
    const g = this.g;
    const P = MINE.POWER;
    if (kind === P.MAX_AMMO) {
      for (const q of g.humans()) {
        const s = q.state;
        for (const slot of [0, 1]) {
          const def = WEAPONS[s.weapons[slot]];
          if (!def) continue;
          s.mags[slot] = def.mag;
          s.ammo[def.ammo] = AMMO_MAX[def.ammo];
        }
      }
    } else if (kind === P.INSTA_KILL) this.instaKill = MINE.POWER_TIME;
    else if (kind === P.DOUBLE_POINTS) this.doublePoints = MINE.POWER_TIME;
    else if (kind === P.KABOOM) {
      for (const z of [...g.zombies]) if (!z.dead) g.combat.killZombie(z, null, { explode: true });
      for (const q of g.humans()) this.addPoints(q, 400);
    }
    g.notify(NOTIFY.MINE_POWER, kind);
    g.sound(SOUND.REVIVE, p.state.x, p.state.y + 1, p.state.z, 40);
    g.globalDirty = true;
  }

  // ---------------------------------------------------------------- buying (hold E on a buy)
  buy(p, e) {
    const g = this.g;
    if (!p.alive || p.zombie || p.downed || !e.mine || e.mine.power !== undefined) return;
    const s = p.state;
    const m = e.mine;
    if (m.stop !== this.stopIndex) return;
    const have = this.pts(p);
    if (m.gate) {
      const gt = m.gate;
      if (gt.open) return;
      if (have < gt.cost) return g.notify(NOTIFY.MINE_NEED, gt.cost, p.id);
      this.addPoints(p, -gt.cost);
      this.openGate(m.stop, gt.index, p);
      return;
    }
    const b = m.buy;
    if (b.kind === 'gun') {
      const item = b.a;
      const def = WEAPONS[item];
      const slot = def.slot;
      const owned = s.weapons[slot] === item;
      const cost = owned ? Math.round(b.cost / 2) : b.cost;
      if (have < cost) return g.notify(NOTIFY.MINE_NEED, cost, p.id);
      this.addPoints(p, -cost);
      this.giveGun(p, item, owned);
      g.sound(SOUND.CAR_PART, e.x, e.y, e.z, 25);
      g.notify(owned ? NOTIFY.MINE_AMMO : NOTIFY.MINE_GUN, item, p.id);
    } else if (b.kind === 'perk') {
      const perk = PERKS.find((pk) => pk.bit === b.a);
      if (p.perks & perk.bit) return g.notify(NOTIFY.MINE_OWNED, 0, p.id);
      if (have < perk.cost) return g.notify(NOTIFY.MINE_NEED, perk.cost, p.id);
      this.addPoints(p, -perk.cost);
      this.givePerk(p, perk.bit);
      g.sound(SOUND.REVIVE, e.x, e.y, e.z, 30);
      g.notify(NOTIFY.MINE_PERK, perk.bit, p.id);
    } else if (b.kind === 'box') {
      const bx = this.box.get(m.stop);
      if (!bx) return;
      if (bx.state === 2) {
        // take what it offered (only whoever paid)
        if (bx.buyer !== p.id) return;
        this.giveGun(p, bx.item, s.weapons[WEAPONS[bx.item].slot] === bx.item);
        g.notify(NOTIFY.MINE_GUN, bx.item, p.id);
        this.boxReset(bx);
        return;
      }
      if (bx.state !== 0) return;
      if (have < BOX_COST) return g.notify(NOTIFY.MINE_NEED, BOX_COST, p.id);
      this.addPoints(p, -BOX_COST);
      bx.state = 1;
      bx.buyer = p.id;
      bx.t = MINE.BOX_ROLL;
      bx.item = boxItem(g.rng());
      this.boxUses++;
      // after a few rolls the box may take the points back (a teddy bear: the old game's rule)
      bx.teddy = this.boxUses > 3 && g.rng() < 0.14 + 0.03 * this.boxUses;
      bx.ent.state = 255;
      g.sound(SOUND.CAR_PART, e.x, e.y, e.z, 40);
    }
  }

  boxReset(bx) {
    bx.state = 0;
    bx.item = 0;
    bx.buyer = 0;
    bx.ent.state = 0;
  }

  updateBox(dt) {
    for (const bx of this.box.values()) {
      if (bx.state === 1) {
        bx.t -= dt;
        if (bx.t <= 0 && bx.teddy) {
          const buyer = this.g.players.get(bx.buyer);
          if (buyer) {
            this.addPoints(buyer, BOX_COST);
            this.g.notify(NOTIFY.MINE_TEDDY, 0, buyer.id);
          }
          this.boxReset(bx);
        } else if (bx.t <= 0) {
          bx.state = 2;
          bx.t = MINE.BOX_HOLD;
          bx.ent.state = bx.item;
        }
      } else if (bx.state === 2) {
        bx.t -= dt;
        if (bx.t <= 0) this.boxReset(bx);
      }
    }
  }

  giveGun(p, item, refillOnly) {
    const g = this.g;
    const s = p.state;
    const def = WEAPONS[item];
    const slot = def.slot;
    if (!refillOnly) {
      s.weapons[slot] = item;
      if (slot === SLOT_PRIMARY) s.mags[0] = def.mag;
      else if (slot === 1) s.mags[1] = def.mag;
      s.slot = slot;
      s.reloadT = 0;
      s.switchT = 0.3;
    } else {
      if (slot === SLOT_PRIMARY) s.mags[0] = def.mag;
      else if (slot === 1) s.mags[1] = def.mag;
      s.reloadT = 0;
    }
    const ai = def.ammo;
    s.ammo[ai] = refillOnly ? AMMO_MAX[ai] : Math.min(AMMO_MAX[ai], s.ammo[ai] + def.mag * 6);
    g.playersDirty = true;
  }

  givePerk(p, bit) {
    p.perks |= bit;
    p.state.perks = p.perks;
    if (bit === PERK.JUGGERNOG) {
      p.maxHp = 250;
      p.hp = p.maxHp;
    }
    p.pointsDirty = true;
  }

  losePerks(p) {
    if (!p.perks) return;
    p.perks = 0;
    p.state.perks = 0;
    p.maxHp = 100;
    p.hp = Math.min(p.hp, p.maxHp);
    p.pointsDirty = true;
  }

  openGate(stopIdx, gi, p) {
    const g = this.g;
    const w = g.world;
    const stop = w.mine.stops[stopIdx];
    setGateOpen(w, stop, gi, true);
    // the dead walk on a changed map: the nav grid learns about the way that opened
    g.nav = new Nav(w);
    const e = this.ents[stopIdx].gates[gi];
    if (e) e.state = 1;
    g.sound(SOUND.WOOD_BREAK, e.x, 1, e.z, 70);
    g.notify(NOTIFY.MINE_GATE, gi, 0);
    g.globalDirty = true;
  }

  updatePerksTick() {}

  // ---------------------------------------------------------------- hooks
  onDown(p) {
    // downed: perks go (a Quick Revive holder alone gets back up by itself in Game.updatePlayers)
    if (p.perks & PERK.QUICK_REVIVE && this.g.standing() === 0 && !p.qrUsed) {
      p.qrUsed = true;
      p.qrT = 6;
    }
    this.losePerks(p);
  }

  // all players dead or downed: the run is over
  updateSolo(dt) {}

  // ---------------------------------------------------------------- the wire
  writeGlobal(w) {
    const e = this.elev;
    w.u8(this.stopIndex);
    w.u8(this.state);
    w.u8(e.state | (e.at ? 0x80 : 0)); // (bit 7: the cage is at the exit shaft)
    w.u8(Math.max(0, Math.min(255, Math.round((e.state === EL.RIDING ? e.t / Math.max(0.1, e.rideLen) : e.state === EL.ARRIVING ? e.t / MINE.ARRIVE_TIME : e.t / MINE.GATE_TIME) * 255))));
    w.u8(Math.round(Math.max(0, Math.min(25, e.rideLen)) * 10));
    w.u16(Math.min(65535, this.queue + this.zombiesAlive()));
    w.u8(this.round > 255 ? 255 : this.round);
    w.u8(Math.min(255, Math.ceil(Math.max(0, this.doublePoints))));
    w.u8(Math.min(255, Math.ceil(Math.max(0, this.instaKill))));
    let gates = 0;
    const st = this.g.world.mine.stops;
    for (let s = 0; s < st.length; s++) st[s].gates.forEach((gt, gi) => (gates |= gt.open ? 1 << (s * 3 + gi) : 0));
    w.u16(gates);
    const bx = this.box.get(this.stopIndex);
    w.u8(bx ? bx.state : 0);
  }

  writePoints(c, p) {
    c.u32(this.pts(p));
    c.u8(p.perks | 0);
  }
}
