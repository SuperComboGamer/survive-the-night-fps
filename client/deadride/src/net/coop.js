// DEAD RIDE co-op (1-5 players): the host's browser runs the game - the director, the zombies' AI, their attacks, the rounds,
// the vehicle, the power-ups - and everyone else mirrors it. Every player moves and shoots on their own machine: their
// position goes to everyone, their hits go to the host as claims, and the host applies them, credits the points to whoever
// earned them and tells everyone what happened (so a limb comes off for everybody). Traffic goes through the server's
// lobby relay (server/lobby.js, net/lobby.js): binary frames, [dest][type][...] - type 1 a JSON event, 2 a player's state,
// 3 the zombies' snapshot.
//
// Teammates are drawn with Survive the Night's animated survivors (client/render/models/characters.js), each holding the
// nearest Survive the Night gun to the DEAD RIDE gun in their hands.
import * as THREE from 'three';
import { createSurvivor } from '../../../render/models/characters.js';
import { ITEM } from '../../../../shared/defs.js';
import { TO_HOST, TO_ALL } from './lobby.js';

const T_EVENT = 1;
const T_PLAYER = 2;
const T_ZOMBIES = 3;
const PLAYER_HZ = 15;
const ZOMBIE_HZ = 10;
const INTERP = 0.12; // seconds teammates are drawn in the past
const BLEED_OUT = 30; // a downed player has this long to be revived
const REVIVE_TIME = 3;
const GUNS = ['m1911', 'mp5', 'olympia', 'm14', 'ak74u', 'remington870', 'raygun', 'knife'];
const STN_GUN = { m1911: ITEM.PISTOL, mp5: ITEM.MP5, olympia: ITEM.DB_SHOTGUN, m14: ITEM.HUNTING_RIFLE, ak74u: ITEM.AK47, remington870: ITEM.SHOTGUN, raygun: ITEM.M4A1, knife: ITEM.KNIFE };
const F_ALIVE = 1;
const F_DOWNED = 2;
const F_RIDING = 4;
const F_CROUCH = 8;
const F_SPRINT = 16;
const F_INSIDE = 32; // standing in the docked vehicle
const F_RELOAD = 64;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const enc = new TextEncoder();
const dec = new TextDecoder();
const r3 = (v) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
const v3 = (a, out = new THREE.Vector3()) => out.set(a[0], a[1], a[2]);
// what may only come from the host (anyone else sending these is ignored), and what only the host acts on
const FROM_HOST = new Set(['go', 'spawn', 'dmg', 'kill', 'atk', 'hurt', 'credit', 'round', 'cleared', 'arrive', 'ride', 'state', 'pu', 'put', 'boards', 'gameover', 'sync']);
// the fields of each event that are vectors
const VECS = { spawn: ['p'], dmg: ['d', 'pt'], hit: ['d', 'pt', 'n'], shot: ['o', 'd'], pu: ['p'], expl: ['p'] };
const fin = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const vec = (a) => Array.isArray(a) && a.length === 3 && a.every((x) => fin(x, -1e5, 1e5));
const num = (n, lo, hi, d = 0) => (fin(n, lo, hi) ? n : d);
// player names go into the HUD's HTML (banners, prompts): nothing but plain characters (the server already filters them)
export const safeName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _\-.!?]/gu, '').slice(0, 16) || 'Survivor';

class Buf {
  constructor(n = 1024) {
    this.b = new ArrayBuffer(n);
    this.d = new DataView(this.b);
    this.o = 0;
  }
  need(n) {
    if (this.o + n <= this.b.byteLength) return;
    const nb = new ArrayBuffer(Math.max(this.b.byteLength * 2, this.o + n));
    new Uint8Array(nb).set(new Uint8Array(this.b, 0, this.o));
    this.b = nb;
    this.d = new DataView(nb);
  }
  u8(v) {
    this.need(1);
    this.d.setUint8(this.o++, v);
  }
  u16(v) {
    this.need(2);
    this.d.setUint16(this.o, v, true);
    this.o += 2;
  }
  i16(v) {
    this.need(2);
    this.d.setInt16(this.o, Math.max(-32768, Math.min(32767, Math.round(v))), true);
    this.o += 2;
  }
  f32(v) {
    this.need(4);
    this.d.setFloat32(this.o, v, true);
    this.o += 4;
  }
  bytes() {
    return new Uint8Array(this.b, 0, this.o).slice();
  }
}

export class Coop {
  // lobby: LobbyClient; start: the lobby's start message {map, seed, host, you, players, late}
  constructor(lobby, start) {
    this.lobby = lobby;
    this.you = start.you;
    this.hostPid = start.host;
    this.seed = start.seed;
    this.late = !!start.late;
    this.names = new Map(start.players.map((p) => [p.pid, p.name]));
    this.remotes = new Map(); // pid -> teammate
    this.zById = new Map(); // net id -> zombie
    this.zSeq = 0;
    this.puSeq = 0;
    this.puById = new Map();
    this.loaded = new Set();
    this.game = null;
    this.ready = false; // play has begun on this machine
    this.goWaiters = [];
    this.pt = 0;
    this.zt = 0;
    this.st = 0;
    this.bt = 0;
    this.shooter = 0; // while the host applies a teammate's hit: who to credit
    this.downT = 0;
    this.reviveT = 0;
    this.reviving = 0;
    this.spectating = false;
    this.hud = null;
    this.buf = new Buf(2048);
    this.unsub = [];
    lobby.onBinary = (from, payload) => this.onBinary(from, payload);
    this.unsub.push(lobby.on('host', (m) => this.onHostChange(m.pid)));
    this.unsub.push(lobby.on('gone', (m) => this.onGone(m.pid, m.name)));
    this.unsub.push(lobby.on('arrived', (m) => this.onArrived(m.pid, m.name)));
    this.unsub.push(lobby.on('lobby', (m) => m.lobby.players.forEach((p) => this.names.set(p.pid, p.name))));
  }

  get isHost() {
    return this.hostPid === this.you;
  }
  // this player's place in the team (0 = the first in the lobby): who starts where
  slot() {
    return [...this.names.keys()].sort((a, b) => a - b).indexOf(this.you);
  }
  get client() {
    return !this.isHost;
  }

  // ---------------------------------------------------------------- wiring into the game (boot.js calls this once the systems exist)
  attach(sys) {
    Object.assign(this, sys); // { game, player, zombies, weapons, combat, world, fx, audio, gfx, hud, input }
    const { game, zombies, combat } = sys;
    game.net = this;
    combat.net = this;
    zombies.net = this;
    zombies.puppet = this.client;
    // every round of the same game in every browser: the box's starting stop and the like
    game.seedRng?.(this.seed);
    // the host tells everyone about every zombie it spawns, every hit it applies and every death
    zombies.onNetSpawn = (z, o) => this.isHost && this.netSpawn(z, o);
    zombies.onNetDamage = (z, o, info) => this.isHost && this.netDamage(z, o, info);
    zombies.onNetKill = (z) => this.isHost && this.event(TO_ALL, { e: 'kill', id: z.netId });
    zombies.onNetAttack = (z) => this.isHost && this.event(TO_ALL, { e: 'atk', id: z.netId });
    zombies.onAttackTarget = (z, tgt, dmg) => this.isHost && tgt.pid && this.event(tgt.pid, { e: 'hurt', dmg, x: z.pos.x, z: z.pos.z });
    zombies.targets = [];
    this.buildHud();
  }

  // ---------------------------------------------------------------- loading: everyone starts together
  // resolves when the host says go (the host waits for everyone who was in the lobby, at most 2 minutes)
  waitGo() {
    if (this.late) return new Promise((res) => this.goWaiters.push(res)); // (a late joiner starts on the host's 'sync')
    this.event(TO_ALL, { e: 'loaded' });
    this.loaded.add(this.you);
    return new Promise((res) => {
      this.goWaiters.push(res);
      if (this.isHost) {
        const t0 = performance.now();
        const check = () => {
          const want = [...this.names.keys()];
          if (want.every((pid) => this.loaded.has(pid)) || performance.now() - t0 > 120000) {
            this.event(TO_ALL, { e: 'go' });
            this.go();
          } else setTimeout(check, 250);
        };
        check();
      }
    });
  }
  go() {
    this.ready = true;
    for (const r of this.goWaiters.splice(0)) r();
  }

  // ---------------------------------------------------------------- sending
  event(dest, obj) {
    const body = enc.encode(JSON.stringify(obj));
    const out = new Uint8Array(body.length + 2);
    out[1] = T_EVENT;
    out.set(body, 2);
    this.lobby.sendBinary(dest === 0 ? TO_HOST : dest, out);
  }
  toHost(obj) {
    if (this.isHost) this.onEvent(this.you, obj);
    else this.event(TO_HOST, obj);
  }

  // ---------------------------------------------------------------- receiving
  onBinary(from, p) {
    const type = p[0];
    if (type === T_EVENT) {
      let m;
      try {
        m = JSON.parse(dec.decode(p.subarray(1)));
      } catch {
        return;
      }
      this.onEvent(from, m);
    } else if (type === T_PLAYER) this.onPlayer(from, new DataView(p.buffer, p.byteOffset + 1, p.byteLength - 1));
    else if (type === T_ZOMBIES && this.client && from === this.hostPid) this.onZombies(new DataView(p.buffer, p.byteOffset + 1, p.byteLength - 1));
  }

  onEvent(from, m) {
    const g = this.game;
    if (!m || typeof m.e !== 'string') return;
    if (FROM_HOST.has(m.e) && from !== this.hostPid) return; // (only the host speaks for the game)
    for (const k of VECS[m.e] || []) if (m[k] != null && !vec(m[k])) return; // (positions and directions are three finite numbers)
    const z = m.id !== undefined ? this.zById.get(m.id) : null;
    switch (m.e) {
      case 'loaded':
        this.loaded.add(from);
        break;
      case 'go':
        this.go();
        break;
      // -------- from the host
      case 'spawn':
        if (this.client) this.applySpawn(m);
        break;
      case 'dmg':
        if (this.client && z) this.applyDamage(z, m);
        break;
      case 'kill':
        if (this.client && z && !z.dead) this.zombies._kill(z, { killed: true }, null, null, 0);
        break;
      case 'atk':
        if (this.client && z && !z.dead && !z.anim.attack) this.zombies._startAttack(z);
        break;
      case 'hurt':
        if (!g.godMode && this.player.alive) this.player.damage(num(m.dmg, 0, 200), _v.set(num(m.x, -1e5, 1e5), this.player.pos.y, num(m.z, -1e5, 1e5)));
        break;
      case 'credit':
        g.addPoints(num(m.n, 0, 1000), !m.k);
        if (m.k) {
          g.kills++;
          if (m.h) g.headshots++;
          this.hud.popup?.('+' + m.n * (g.doublePoints > 0 ? 2 : 1));
        }
        g.hud.hitmarker(!!m.k);
        break;
      case 'round':
        if (this.client) g.beginRound(num(m.n, 1, 9999, g.round + 1));
        this.respawnIfDead();
        break;
      case 'cleared':
        if (this.client) g.netCleared(m.n);
        break;
      case 'arrive':
        if (this.client) g.vehicleArrive();
        break;
      case 'ride':
        if (this.client) g.beginRide(true);
        break;
      case 'state':
        if (this.client) g.netState(m);
        break;
      case 'pu':
        if (this.client) g.netPowerupSpawn(m);
        break;
      case 'put':
        g.netPowerupTaken(m);
        break;
      case 'boards':
        if (this.client) this.applyBoards(m);
        break;
      case 'gameover':
        g.netGameOver(m);
        break;
      case 'sync':
        if (this.client) this.applySync(m);
        break;
      // -------- from any player
      case 'repair': {
        const b = g.stopProps?.[m.s]?.barricades[m.i];
        if (b && from !== this.you) b.repairNext();
        break;
      }
      case 'boxmove':
        if (from !== this.you) g.netBoxMove(m.stop);
        break;
      case 'revive':
        if (m.pid === this.you) this.revived(from);
        break;
      case 'shot':
        this.remoteShot(from, m);
        break;
      // -------- to the host from a player
      case 'hit':
        if (this.isHost && z && fin(m.a, 0, 1e5)) this.hostHit(from, z, m);
        break;
      case 'expl':
        if (this.isHost && vec(m.p) && fin(m.r, 0, 12) && fin(m.d, 0, 5000)) {
          this.shooter = from;
          this.zombies.explode(v3(m.p), m.r, m.d, { source: { weaponId: String(m.w || '') } });
          this.shooter = 0;
        }
        break;
      case 'take':
        if (this.isHost) g.hostTakePowerup(m.id, from);
        break;
    }
  }

  // ---------------------------------------------------------------- zombies: the host's side
  netSpawn(z, o) {
    z.netId = this.zSeq = (this.zSeq % 60000) + 1;
    this.zById.set(z.netId, z);
    const st = this.world.active;
    this.event(TO_ALL, this.spawnMsg(z, o, st));
  }
  spawnMsg(z, o, st) {
    return { e: 'spawn', id: z.netId, v: z.variant, p: r3(z.pos), yaw: Math.round(z.anim.yaw * 1000) / 1000, hp: z.maxHp, base: o?.hp, sp: z.speed, cls: z.speedClass, kind: z.kind, sd: o?.spawnDef ? st.spawns.indexOf(o.spawnDef) : -1, seed: z.seed, look: z.look };
  }
  netDamage(z, o, info) {
    if (!z.netId) return;
    this.event(TO_ALL, {
      e: 'dmg',
      id: z.netId,
      a: Math.round((o.amount ?? 50) * 10) / 10,
      part: o.part || 'torso',
      bi: o._bi,
      d: o.dir ? r3(o.dir) : null,
      pt: o.point ? r3(o.point) : null,
      imp: o.impulse,
      hm: o.headshotMul,
      m: o.melee ? 1 : 0,
      x: o.explosion ? 1 : 0,
      k: info.killed ? 1 : 0,
      hp: Math.round(z.hp),
    });
  }
  // a teammate's shot reached the host: apply it as if it had been fired here, crediting them
  hostHit(from, z, m) {
    if (z.dead) return;
    const o = { amount: m.a * (this.game.instaKill > 0 ? 1000 : 1), part: m.part, dir: m.d ? v3(m.d) : undefined, point: m.pt ? v3(m.pt) : undefined, normal: m.n ? v3(m.n, _v2) : undefined, impulse: m.imp, weapon: m.w, headshotMul: m.hm, melee: !!m.m, _bi: m.bi };
    this.shooter = from;
    const info = this.zombies.damage(z, o);
    if (info) this.game.onZombieHit(z, info, { _sid: m.sid + from * 1e6, melee: !!m.m });
    this.shooter = 0;
  }
  // credit points to a player (the host's own points directly)
  credit(pid, n, kill = false, head = false) {
    if (!pid || pid === this.you) return false;
    this.event(pid, { e: 'credit', n, k: kill ? 1 : 0, h: head ? 1 : 0 });
    return true;
  }

  sendZombies() {
    const b = this.buf;
    b.o = 0;
    b.u8(0);
    b.u8(T_ZOMBIES);
    const list = this.zombies.alive;
    let n = 0;
    for (const z of list) if (z.netId && z.state !== 'spawning') n++;
    b.u8(Math.min(255, n));
    let k = 0;
    for (const z of list) {
      if (!z.netId || z.state === 'spawning' || k++ >= 255) continue;
      const A = z.anim;
      b.u16(z.netId);
      b.f32(A.pos.x);
      b.f32(A.pos.y);
      b.f32(A.pos.z);
      b.i16(A.vel.x * 500);
      b.i16(A.vel.z * 500);
      b.i16((A.want.faceYaw ?? A.yaw) * 5000);
    }
    this.lobby.sendBinary(TO_ALL, b.bytes());
  }

  // ---------------------------------------------------------------- zombies: a client's side (puppets of the host's)
  applySpawn(m) {
    if (this.zById.has(m.id)) return;
    const st = this.world.active;
    const sd = m.sd >= 0 ? st.spawns[m.sd] : null;
    const z = this.zombies.spawn(m.v, v3(m.p), m.yaw, { hp: m.base, speed: m.sp, speedClass: m.cls, kind: m.kind, spawnDef: sd, barricade: sd?.barricade || null, path: sd?.path, seed: m.seed, look: m.look, force: true });
    if (!z) return;
    z.netId = m.id;
    z.maxHp = z.hp = m.hp;
    z.net = { x: m.p[0], y: m.p[1], z: m.p[2], vx: 0, vz: 0, yaw: m.yaw, t: performance.now() };
    this.zById.set(m.id, z);
  }
  applyDamage(z, m) {
    // the host's outcome is the outcome: fix the health so the same hit kills here exactly when it killed there
    const o = { amount: m.a, part: m.part, dir: m.d ? v3(m.d) : undefined, point: m.pt ? v3(m.pt, _v2) : undefined, impulse: m.imp, headshotMul: m.hm, melee: !!m.m, explosion: !!m.x, _bi: m.bi };
    const mul = m.part === 'head' ? (m.hm ?? 2) : 1;
    z.hp = m.k ? Math.min(z.hp, (o.amount * mul) * 0.5) : Math.max(z.hp, o.amount * mul + 1);
    this.zombies.damage(z, o);
    if (!m.k && !z.dead) z.hp = m.hp;
    else if (m.k && !z.dead) this.zombies._kill(z, { killed: true, headshot: m.part === 'head' }, o.point, o.dir, o.impulse ?? 3);
  }
  onZombies(d) {
    const n = d.getUint8(0);
    let o = 1;
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const id = d.getUint16(o, true);
      const x = d.getFloat32(o + 2, true);
      const y = d.getFloat32(o + 6, true);
      const z = d.getFloat32(o + 10, true);
      const vx = d.getInt16(o + 14, true) / 500;
      const vz = d.getInt16(o + 16, true) / 500;
      const yaw = d.getInt16(o + 18, true) / 5000;
      o += 20;
      const zb = this.zById.get(id);
      if (!zb || zb.dead) continue;
      const net = zb.net || (zb.net = {});
      net.x = x;
      net.y = y;
      net.z = z;
      net.vx = vx;
      net.vz = vz;
      net.yaw = yaw;
      net.t = now;
    }
  }

  // ---------------------------------------------------------------- shots and hits from this machine
  // combat calls this instead of damaging a zombie when this machine is not the host: the hit goes to the host as a claim
  claimHit(z, o, spec) {
    if (!z.netId) return;
    this.event(TO_HOST, {
      e: 'hit',
      id: z.netId,
      a: Math.round((o.amount ?? 50) * 10) / 10 / (this.game.instaKill > 0 ? 1000 : 1),
      part: o.part,
      bi: o._bi,
      d: o.dir ? r3(o.dir) : null,
      pt: o.point ? r3(o.point) : null,
      n: o.normal ? r3(o.normal) : null,
      imp: o.impulse,
      w: o.weapon,
      hm: o.headshotMul,
      m: o.melee ? 1 : 0,
      sid: spec?._sid ?? 0,
    });
  }
  claimExplosion(pos, radius, damage, weaponId) {
    this.event(TO_HOST, { e: 'expl', p: r3(pos), r: radius, d: damage, w: weaponId });
  }
  localShot(spec) {
    const now = performance.now();
    if (now - (this._shotT || 0) < 45) return; // (an automatic's every round is not news: enough for the sound and the tracers)
    this._shotT = now;
    this.event(TO_ALL, { e: 'shot', w: spec.weaponId, o: r3(spec.muzzle || spec.origin), d: r3(spec.dir), s: spec.isShotgun ? 1 : 0 });
  }
  remoteShot(from, m) {
    const r = this.remotes.get(from);
    const o = v3(m.o);
    const d = v3(m.d, _v2);
    const hw = this._hw || (this._hw = {});
    let t = 120;
    if (this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 120, hw)) t = hw.t;
    const to = new THREE.Vector3().copy(o).addScaledVector(d, t);
    this.fx.tracers?.add(o, to, this.fx.time, { speed: 900, len: 6, width: 0.012, color: [1, 0.72, 0.3], a: 0.8 });
    this.fx.muzzleBlast?.(o, d, m.s ? 1.4 : 1, m.s);
    this.fx.pulseLight?.(o, 0xffb060, 30, 0.05, 8);
    if (GUNS.includes(m.w)) this.audio?.play?.(`gun.${m.w}.fire`, { pos: o, vol: 0.9 });
    if (r) r.fire = 1;
  }

  // ---------------------------------------------------------------- players
  sendPlayer() {
    const p = this.player;
    const g = this.game;
    const b = this.buf;
    b.o = 0;
    b.u8(0);
    b.u8(T_PLAYER);
    const riding = !!p.platform;
    const pos = riding ? p.local : p.pos;
    b.f32(pos.x);
    b.f32(pos.y);
    b.f32(pos.z);
    b.f32(p.yaw);
    b.i16(p.pitch * 10000);
    b.i16(Math.hypot(p.vel?.x || 0, p.vel?.z || 0) * 100);
    let f = 0;
    if (p.alive) f |= F_ALIVE;
    if (g.state === 'downed') f |= F_DOWNED;
    if (riding) f |= F_RIDING;
    if (p.crouching) f |= F_CROUCH;
    if (p.sprinting) f |= F_SPRINT;
    if (g.playerInVehicle?.()) f |= F_INSIDE;
    if (this.weapons?.state === 'reload') f |= F_RELOAD;
    b.u8(f);
    b.u8(Math.max(0, GUNS.indexOf(this.weapons?.currentId)));
    b.u8(Math.round((p.hp / p.maxHp) * 255));
    b.u8(g.stopIndex);
    this.lobby.sendBinary(TO_ALL, b.bytes());
  }

  remote(pid) {
    let r = this.remotes.get(pid);
    if (!r) {
      const sv = createSurvivor(pid * 7 + 3);
      sv.setWeapon(ITEM.PISTOL);
      this.gfx.scene.add(sv.object);
      const tag = document.createElement('div');
      tag.className = 'coop-tag';
      this.hudRoot.appendChild(tag);
      r = { pid, sv, tag, buf: [], gun: -1, speed: 0, flags: F_ALIVE, hp: 1, stop: 0, pos: new THREE.Vector3(), yaw: 0, pitch: 0, fire: 0, seen: performance.now() };
      this.remotes.set(pid, r);
    }
    return r;
  }

  onPlayer(from, d) {
    const r = this.remote(from);
    const s = {
      x: d.getFloat32(0, true),
      y: d.getFloat32(4, true),
      z: d.getFloat32(8, true),
      yaw: d.getFloat32(12, true),
      pitch: d.getInt16(16, true) / 10000,
      speed: d.getInt16(18, true) / 100,
      flags: d.getUint8(20),
      gun: d.getUint8(21),
      hp: d.getUint8(22) / 255,
      stop: d.getUint8(23),
      t: performance.now() / 1000,
    };
    r.buf.push(s);
    if (r.buf.length > 8) r.buf.shift();
    r.seen = performance.now();
  }

  // where a teammate is now (interpolated), in world coordinates
  updateRemotes(dt, time) {
    const now = performance.now() / 1000 - INTERP;
    const v = this.world.vehicle;
    for (const r of this.remotes.values()) {
      const B = r.buf;
      if (!B.length) continue;
      let a = B[0];
      let b = B[B.length - 1];
      for (let i = 0; i < B.length - 1; i++) {
        if (B[i].t <= now && B[i + 1].t >= now) {
          a = B[i];
          b = B[i + 1];
          break;
        }
      }
      const k = b.t > a.t ? Math.max(0, Math.min(1, (now - a.t) / (b.t - a.t))) : 1;
      const riding = b.flags & F_RIDING;
      _v.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      let yaw = a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * k;
      if (riding && v && (a.flags & F_RIDING)) {
        v.localToWorld(_v, r.pos);
        v.frame.updateWorldMatrix(true, false);
        const e = new THREE.Euler().setFromQuaternion(v.frame.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
        yaw += e.y;
      } else r.pos.copy(_v);
      r.yaw = yaw;
      r.pitch = b.pitch;
      r.flags = b.flags;
      r.hp = b.hp;
      r.stop = b.stop;
      r.speed = b.speed;
      if (b.gun !== r.gun) {
        r.gun = b.gun;
        r.sv.setWeapon(STN_GUN[GUNS[b.gun]] ?? ITEM.PISTOL);
      }
      const shown = r.stop === this.game.stopIndex || riding;
      const o = r.sv.object;
      o.visible = shown && !!(r.flags & (F_ALIVE | F_DOWNED));
      o.position.copy(r.pos);
      o.rotation.y = r.yaw;
      if (r.fire > 0) {
        r.sv.fire();
        r.fire = 0;
      }
      const downed = !!(r.flags & F_DOWNED);
      r.sv.update(dt, { speed: downed ? 0 : r.speed, sprint: !!(r.flags & F_SPRINT), crouch: !!(r.flags & F_CROUCH) || downed, pitch: downed ? 0.9 : -r.pitch, onGround: true, reloading: !!(r.flags & F_RELOAD), dead: !(r.flags & (F_ALIVE | F_DOWNED)), time });
    }
    // the zombies' targets on the host: every player who is up
    if (this.isHost) {
      const T = this.zombies.targets;
      T.length = 0;
      const p = this.player;
      if (p.alive && this.game.state !== 'downed') T.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z, eyeY: p.eyeH, pid: 0 });
      for (const r of this.remotes.values()) if (r.flags & F_ALIVE && !(r.flags & F_DOWNED) && r.stop === this.game.stopIndex && !(r.flags & F_RIDING)) T.push({ x: r.pos.x, y: r.pos.y, z: r.pos.z, eyeY: 1.6, pid: r.pid });
    }
  }

  // is everyone who is up standing in the docked vehicle? (the host's boarding rule) / out of it (the next round's)
  allInVehicle() {
    const g = this.game;
    if (g.player.alive && g.state !== 'downed' && !g.playerInVehicle()) return false;
    for (const r of this.remotes.values()) if (r.flags & F_ALIVE && !(r.flags & F_DOWNED) && !(r.flags & F_INSIDE) && !(r.flags & F_RIDING)) return false;
    return true;
  }
  anyInVehicle() {
    if (this.game.playerInVehicle()) return true;
    for (const r of this.remotes.values()) if (r.flags & F_INSIDE) return true;
    return false;
  }
  allOutOfVehicle() {
    if (this.game.playerInVehicle()) return false;
    for (const r of this.remotes.values()) if (r.flags & (F_INSIDE | F_RIDING)) return false;
    return true;
  }
  // is anybody still up? (when nobody is, the run is over)
  anyoneUp() {
    if (this.player.alive && this.game.state !== 'downed') return true;
    for (const r of this.remotes.values()) if (r.flags & F_ALIVE && !(r.flags & F_DOWNED)) return true;
    return false;
  }
  // a teammate who is down within reach, for the revive prompt
  downedNear(pos, reach = 2.2) {
    let best = null;
    let bd = reach;
    for (const r of this.remotes.values()) {
      if (!(r.flags & F_DOWNED) || r.stop !== this.game.stopIndex) continue;
      const d = r.pos.distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best;
  }
  name(pid) {
    return safeName(this.names.get(pid));
  }

  // ---------------------------------------------------------------- downed, revived, back next round
  goDown() {
    this.downT = BLEED_OUT;
    this.spectating = false;
  }
  revive(pid) {
    this.event(pid, { e: 'revive', pid });
  }
  revived(by) {
    const g = this.game;
    if (g.state !== 'downed') return;
    g.netRevived(this.name(by));
  }
  respawnIfDead() {
    const g = this.game;
    if (g.state === 'spectating' || g.state === 'downed') g.netRespawn();
  }

  // ---------------------------------------------------------------- barricades
  repaired(stop, i) {
    this.event(TO_ALL, { e: 'repair', s: stop, i });
  }
  sendBoards() {
    const g = this.game;
    const sp = g.stopProps?.[g.stopIndex];
    if (!sp) return;
    this.event(TO_ALL, { e: 'boards', s: g.stopIndex, b: sp.barricades.map((b) => b.boards) });
  }
  applyBoards(m) {
    const sp = this.game.stopProps?.[m.s];
    if (!sp) return;
    sp.barricades.forEach((b, i) => {
      const want = m.b[i];
      if (want === undefined) return;
      let guard = 8;
      while (b.boards > want && guard--) b.tearNext(1);
      while (b.boards < want && guard--) b.repairNext();
    });
  }

  // ---------------------------------------------------------------- joining a game under way, and the host changing
  onArrived(pid, name) {
    this.names.set(pid, name);
    this.hud.banner?.(`${safeName(name).toUpperCase()} JOINED`, '');
    if (!this.isHost) return;
    // the state of play for the newcomer, once it has loaded (it asks with 'loaded'... a late joiner just gets it now and again until it is ready)
    const send = () => this.event(pid, this.syncMsg());
    setTimeout(send, 500);
  }
  syncMsg() {
    const g = this.game;
    const st = this.world.active;
    return {
      e: 'sync',
      round: g.round,
      state: g.state,
      stop: g.stopIndex,
      toSpawn: g.toSpawn,
      spawned: g.spawned,
      boxStop: g.boxStop,
      zombies: this.zombies.alive.filter((z) => z.netId).map((z) => this.spawnMsg(z, { hp: z.maxHp / (z.def?.hp ?? 1), spawnDef: null }, st)),
      pu: g.powerups.map((pu) => ({ id: pu.netId, kind: pu.kind, p: r3(pu.pos) })),
      boards: g.stopProps?.[g.stopIndex]?.barricades.map((b) => b.boards) || [],
    };
  }
  applySync(m) {
    const g = this.game;
    g.netSync(m);
    for (const s of m.zombies) {
      s.kind = 'walk';
      this.applySpawn(s);
    }
    for (const p of m.pu) g.netPowerupSpawn(p);
    this.applyBoards({ s: m.stop, b: m.boards });
    if (!this.ready) this.go();
  }
  onHostChange(pid) {
    const was = this.isHost;
    this.hostPid = pid;
    if (this.isHost && !was) {
      // this machine runs the game from here on: its puppets come to life
      this.zombies.puppet = false;
      for (const z of this.zombies.alive) z.net = null;
      this.game.netBecomeHost();
      this.hud.banner?.('YOU ARE THE HOST', 'The game carries on from your machine');
    } else this.hud.banner?.(`${this.name(pid).toUpperCase()} IS THE HOST`, '');
  }
  onGone(pid, name) {
    const r = this.remotes.get(pid);
    if (r) {
      this.gfx.scene.remove(r.sv.object);
      r.sv.dispose?.();
      r.tag.remove();
      this.remotes.delete(pid);
    }
    this.loaded.delete(pid);
    this.names.delete(pid);
    this.hud.banner?.(`${safeName(name || 'A player').toUpperCase()} LEFT`, '');
  }

  // ---------------------------------------------------------------- every frame
  update(dt, time) {
    const now = performance.now();
    this.updateRemotes(dt, time);
    if (now - this.pt > 1000 / PLAYER_HZ) {
      this.pt = now;
      this.sendPlayer();
    }
    if (this.isHost) {
      if (now - this.zt > 1000 / ZOMBIE_HZ) {
        this.zt = now;
        this.sendZombies();
      }
      if (now - this.st > 1000) {
        this.st = now;
        const g = this.game;
        this.event(TO_ALL, { e: 'state', round: g.round, state: g.state, stop: g.stopIndex, toSpawn: g.toSpawn, spawned: g.spawned, dp: g.doublePoints, ik: g.instaKill });
      }
      if (now - this.bt > 2000) {
        this.bt = now;
        this.sendBoards();
      }
    }
    // downed: bleeding out, or being picked up
    const g = this.game;
    if (g.state === 'downed') {
      this.downT -= dt;
      this.hudDowned.style.display = 'block';
      this.hudDowned.textContent = `DOWN — a teammate can revive you (hold F)  ·  ${Math.max(0, Math.ceil(this.downT))}`;
      if (this.downT <= 0) g.netBleedOut();
    } else if (g.state === 'spectating') {
      this.hudDowned.style.display = 'block';
      this.hudDowned.textContent = 'YOU BLED OUT — back at the start of the next round';
    } else this.hudDowned.style.display = 'none';
    this.drawHud();
  }

  // revive: hold F on a downed teammate for REVIVE_TIME
  tickRevive(dt, held, target) {
    if (!held || !target) {
      this.reviveT = 0;
      this.reviving = 0;
      return 0;
    }
    if (this.reviving !== target.pid) {
      this.reviving = target.pid;
      this.reviveT = 0;
    }
    this.reviveT += dt;
    if (this.reviveT >= (this.game.perks.has('quickrevive') ? REVIVE_TIME / 2 : REVIVE_TIME)) {
      this.revive(target.pid);
      this.game.addPoints(50, true);
      this.reviveT = 0;
      this.reviving = 0;
    }
    return this.reviveT / REVIVE_TIME;
  }

  // ---------------------------------------------------------------- teammates on the HUD
  buildHud() {
    const st = document.createElement('style');
    st.textContent = `#coop{position:fixed;inset:0;pointer-events:none;z-index:5;font-family:"Bahnschrift","Segoe UI",Arial,sans-serif}
#coop .team{position:absolute;left:24px;top:110px;display:flex;flex-direction:column;gap:6px}
#coop .tm{min-width:180px;padding:5px 9px;background:rgba(0,0,0,.45);border-left:3px solid #ff9a30;color:#eee7d6;font:700 13px "Bahnschrift",Arial;letter-spacing:.06em;text-shadow:0 1px 2px #000}
#coop .tm.down{border-color:#e03020;color:#ffb0a0}#coop .tm.out{border-color:#555;color:#888}
#coop .tm i{display:block;height:3px;margin-top:4px;background:#333}#coop .tm i b{display:block;height:100%;background:#7fd35f}
#coop .coop-tag{position:absolute;transform:translate(-50%,-100%);color:#fff;font:700 13px "Bahnschrift",Arial;letter-spacing:.08em;text-shadow:0 1px 3px #000,0 0 6px #000;white-space:nowrap}
#coop .coop-tag.down{color:#ff7060}
#coop .downed{position:absolute;left:0;right:0;top:62%;text-align:center;color:#ff7060;font:900 26px Impact,"Arial Black",sans-serif;letter-spacing:.12em;text-shadow:0 2px 6px #000;display:none}`;
    document.head.appendChild(st);
    this.hudRoot = document.createElement('div');
    this.hudRoot.id = 'coop';
    document.body.appendChild(this.hudRoot);
    this.hudTeam = document.createElement('div');
    this.hudTeam.className = 'team';
    this.hudRoot.appendChild(this.hudTeam);
    this.hudDowned = document.createElement('div');
    this.hudDowned.className = 'downed';
    this.hudRoot.appendChild(this.hudDowned);
  }
  drawHud() {
    const cam = this.gfx.camera;
    const W = innerWidth;
    const H = innerHeight;
    let html = '';
    for (const r of this.remotes.values()) {
      const down = r.flags & F_DOWNED;
      const out = !(r.flags & (F_ALIVE | F_DOWNED));
      html += `<div class="tm ${down ? 'down' : out ? 'out' : ''}">${escapeHtml(this.name(r.pid))}${down ? ' · DOWN' : out ? ' · OUT' : ''}<i><b style="width:${Math.round(r.hp * 100)}%"></b></i></div>`;
      // name over the head
      const o = r.sv.object;
      if (!o.visible) {
        r.tag.style.display = 'none';
        continue;
      }
      _v.copy(r.pos);
      _v.y += down ? 0.9 : 2.05;
      _v.project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) {
        r.tag.style.display = 'none';
        continue;
      }
      r.tag.style.display = 'block';
      r.tag.style.left = `${((_v.x + 1) / 2) * W}px`;
      r.tag.style.top = `${((1 - _v.y) / 2) * H}px`;
      const label = this.name(r.pid) + (down ? ' — DOWN' : '');
      if (r.tag.textContent !== label) r.tag.textContent = label;
      r.tag.classList.toggle('down', !!down);
    }
    if (html !== this._teamHtml) {
      this._teamHtml = html;
      this.hudTeam.innerHTML = html; // (names are escaped)
    }
  }

  dispose() {
    for (const u of this.unsub) u();
    this.lobby.onBinary = null;
    for (const r of this.remotes.values()) {
      this.gfx.scene.remove(r.sv.object);
      r.sv.dispose?.();
    }
    this.remotes.clear();
    this.hudRoot?.remove();
    if (this.zombies) {
      this.zombies.puppet = false;
      this.zombies.targets = null;
      this.zombies.net = null;
      this.zombies.onNetSpawn = this.zombies.onNetDamage = this.zombies.onNetKill = this.zombies.onNetAttack = this.zombies.onAttackTarget = null;
    }
    if (this.game) this.game.net = null;
    if (this.combat) this.combat.net = null;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
