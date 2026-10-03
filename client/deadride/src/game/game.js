// Game orchestrator: rounds (BO2 scaling), economy, interactables (wall buys, perks, mystery box, barricades), power-ups,
// vehicle loop (cleared -> vehicle arrives -> board -> ride -> next stop -> next round, endless), player death / restart.
import * as THREE from 'three';
import { rand, clamp, makeRng, TAU } from '../core/util.js';
import { PerkMachine, MysteryBox, WallBuy, PowerUp, PERKS, POWERUPS } from './props3d.js';
import { Barricade } from './barricade.js';
import { std } from '../core/mats.js';

const V = new THREE.Vector3(), V2 = new THREE.Vector3();
const normId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); // 'doubleTap' | 'double-tap' | 'Double_Tap' -> 'doubletap'
const PERK_ALIAS = { juggernog: 'juggernog', jugg: 'juggernog', speedcola: 'speedcola', speed: 'speedcola', doubletap: 'doubletap', doubletaprootbeer: 'doubletap', quickrevive: 'quickrevive', revive: 'quickrevive', staminup: 'staminup', stamina: 'staminup', staminupp: 'staminup' };
const GUN_ALIAS = { remington: 'remington870', r870: 'remington870', remington870mcs: 'remington870', ak74: 'ak74u', aks74u: 'ak74u', ak47u: 'ak74u', ray: 'raygun', raygun: 'raygun', coachgun: 'olympia', m1911a1: 'm1911', mp5a3: 'mp5', mp5k: 'mp5' };
const perkId = (s) => { const n = normId(s); return PERK_ALIAS[n] || n; }, gunId = (s) => { const n = normId(s); return GUN_ALIAS[n] || n; };
const ZOMBIES_PER_ROUND = [6, 8, 13, 18, 24, 27, 28, 28, 29, 33, 34, 36, 39, 41, 44, 47, 49, 52, 54, 56];
export const roundQuota = (r) => (r <= ZOMBIES_PER_ROUND.length ? ZOMBIES_PER_ROUND[r - 1] : Math.min(90, Math.round(56 + (r - 20) * 3.4)));
export const roundHealth = (r) => { if (r < 10) return 150 + 100 * (r - 1); let h = 950; for (let i = 10; i <= r; i++) h = Math.round(h * 1.1); return h; };
const MAX_ALIVE = 24;

export class Game {
  constructor(d) {
    this.d = d; const { gfx, fx, world, hud } = d; Object.assign(this, { gfx, fx, world, hud, audio: d.audio, input: d.input, player: d.player, zombies: d.zombies, weapons: d.weapons, combat: d.combat });
    this.state = 'menu'; this.round = 0; this.points = 500; this.kills = 0; this.headshots = 0; this.time = 0; this.perks = new Set(); this.quickReviveUsed = false; this.doublePoints = 0; this.instaKill = 0; this.powerups = []; this.powerupsThisRound = 0; this.stopIndex = 0;
    this.props = []; this.barricades = []; this.box = null; this.boxStop = 0; this.boxUses = 0; this.interact = null; this.holdT = 0; this.rideProgress = 0; this.gameOverT = 0; this.paused = false; this.spawnT = 0; this.toSpawn = 0; this.spawned = 0; this.exitT = 0; this.boardT = 0; this.clearedT = 0; this.rng = makeRng((Math.random() * 1e9) | 0);
    this.plankMat = null; this.events = {}; this.stats = { rounds: 0 }; this.godMode = false; this.tmpO = new THREE.Vector3(); this.hitCount = 0;
    this.flashOn = false; this.flashSrc = this.gfx.addLight({ kind: 'spot', pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), color: 0xfff2dc, intensity: 70, distance: 38, decay: 2, angle: 0.42, penumbra: 0.65, shadow: true, priority: 50, enabled: false });
    this.wireCallbacks();
  }
  wireCallbacks() {
    const z = this.zombies; z.onKill = (zb, info) => this.onKill(zb, info || {}); z.onAttackPlayer = (zb, dmg) => { if (!this.godMode) this.player.damage(dmg, zb.pos || zb.position); }; // (hurt / step / land sounds come from the audio engine's attachPlayer follow mode)
    const p = this.player; p.onDeath = () => this.onPlayerDown();
    this.fx.casings.onBounce = (pos, surface, shotgun) => this.audio?.play?.(`casing.${shotgun ? 'shell' : 'brass'}.${surface}`, { pos, vol: 0.5 });
  }

  // ------------------------------------------------------------------ setup after the world is loaded
  buildProps() {
    const { world, gfx, fx } = this; for (const p of this.props) p.dispose?.(); this.props = []; this.barricades = [];
    const api = this.d.weaponsApi; this.plankMat = this.d.synth.material({ pattern: 'planks', size: 512, tile: 1.2, colors: [0x8a7048, 0x4e3b24, 0x140e08], params: { rows: 1, gap: 0.0, grain: 6, knots: 0.3, cols: 1, weather: 0.6, nails: 1 }, bump: 4, rough: [0.7, 0.95], layers: { grime: 0.4 } });
    this.stopProps = world.stops.map((st) => {
      const o = st.origin, sp = { perks: [], walls: [], barricades: [] };
      for (const b of st.buys.perks || []) { b.perk = perkId(b.perk); if (!PERKS[b.perk]) { console.warn('[game] unknown perk', b.perk); continue; } const m = new PerkMachine(gfx.scene, gfx, b.perk, this.d.synth); m.place([o.x + b.pos[0], o.y + b.pos[1], o.z + b.pos[2]], b.yaw || 0); m.setVisible(false); sp.perks.push(m); }
      for (const w of st.buys.walls || []) { w.gun = gunId(w.gun); const info = api?.WEAPONS?.[w.gun] || this.weapons.WEAPONS?.[w.gun]; const wb = new WallBuy(gfx.scene, gfx, { ...w, pos: [o.x + w.pos[0], o.y + w.pos[1], o.z + w.pos[2]] }, api, info); wb.setVisible(false); sp.walls.push(wb); }
      for (const s of st.spawns) if (s.kind === 'barricade') { const fwd = V.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)); const b = new Barricade(gfx.scene, this.plankMat, { pos: [o.x + s.pos[0] + fwd.x * 0.8, o.y + s.pos[1], o.z + s.pos[2] + fwd.z * 0.8], yaw: s.yaw, boards: s.boards || 5 }); b.group.visible = false; s.barricade = b; sp.barricades.push(b); this.barricades.push(b); b.onEvent = (e, bb) => { this.audio?.play?.(e === 'tear' ? 'board.plank' : 'board.repair', { pos: bb.pos, vol: 1 }); }; }
      return sp;
    });
    if (this.box) { gfx.scene.remove(this.box.group); }
    this.box = new MysteryBox(gfx.scene, gfx, this.d.synth, api); this.box.group.visible = false;
    const cands = world.stops.map((s, i) => (s.buys.box ? i : -1)).filter((i) => i >= 0); this.boxStops = cands; this.boxStop = cands.length ? cands[(this.rng() * cands.length) | 0] : -1;
    this.box.onReady = (r) => { this.hud.prompt(null); };
    this.box.onTimeout = () => { this.boxOffer = null; };
    this.showStopProps(this.stopIndex);
  }
  showStopProps(i) {
    this.stopProps.forEach((sp, k) => { const v = k === i; sp.perks.forEach((m) => m.setVisible(v)); sp.walls.forEach((w) => w.setVisible(v)); sp.barricades.forEach((b) => (b.group.visible = v)); });
    const st = this.world.stops[i]; if (this.box) { const here = this.boxStop === i && st.buys.box; this.box.group.visible = !!here; this.box.setVisible(!!here); if (here && this.box.state === 'gone') this.box.state = 'closed'; if (here) { this.box.group.position.set(st.origin.x + st.buys.box.pos[0], st.origin.y + st.buys.box.pos[1], st.origin.z + st.buys.box.pos[2]); this.box.group.rotation.y = st.buys.box.yaw || 0; this.box.place([this.box.group.position.x, this.box.group.position.y, this.box.group.position.z], st.buys.box.yaw || 0); if (this.box.state === 'gone' || this.box.state === 'leaving') { this.box.state = 'closed'; } } }
    // three.js updates matrices of INVISIBLE objects every frame: freeze the hidden stops' props (perk machines, wall buys, barricades, box) until they are shown again
    const freeze = (g, on) => { if (!g) return; if (g.__live === on) return; g.__live = on; if (on) g.updateMatrixWorld(true); g.traverse((o) => { if (on) { o.matrixAutoUpdate = o.__mau ?? true; } else { if (o.__mau === undefined) o.__mau = o.matrixAutoUpdate; o.matrixAutoUpdate = false; o.matrixWorldNeedsUpdate = false; } }); };
    this.stopProps.forEach((sp, k) => { const v = k === i; sp.perks.forEach((m) => freeze(m.group, v)); sp.walls.forEach((w) => freeze(w.group, v)); sp.barricades.forEach((b) => freeze(b.group, v)); });
    if (this.box) freeze(this.box.group, !!this.box.group.visible);
    this.hud.setStop(st.name, `${this.world.map.name} · Stop ${i + 1}/${this.world.stops.length}`);
  }

  // ------------------------------------------------------------------ run control
  newRun() {
    const { player, weapons, world } = this; this.round = 0; this.points = 500; this.kills = 0; this.headshots = 0; this.time = 0; this.perks.clear(); this.quickReviveUsed = false; this.doublePoints = this.instaKill = 0; this.gameOverT = 0; this.stopIndex = 0; this.boxUses = 0;
    for (const pu of this.powerups) pu.remove(); this.powerups = []; player.alive = true; player.maxHp = 100; player.hp = 100; player.speedMul = 1; player.frozen = false; player.perks = this.perks; player.sinceHit = 99;
    weapons.slots.length = 0; weapons.give('m1911'); weapons.setPerks({}); this.zombies.clear(); this.state = 'menu'; this.hud.setPerks(this.perks); this.hud.setPoints(this.points);
    world.setActive(0); this.showStopProps(0); for (const b of this.barricades) b.reset();
    const st = world.stops[0]; player.teleport(this.startSpot(st), st.playerStart.yaw); player.pitch = 0;
    this.applyStopAudio(st); this.gfx.damage = 0; this.gfx.lowHP = 0;
    if (world.vehicle) world.vehicle.parkAway(st);
    this.introBanner = st.name; this.stateT = 3; this.state = 'intro'; // (the banner is shown by the first intro tick, i.e. once play has actually started)
  }
  applyStopAudio(st) { const a = this.audio; if (!a) return; a.setSpace?.(st.atmo.reverb, 0.6); if (st.ambient) a.ambience?.set?.(st.ambient, 1.5); }
  beginRound(n) {
    if (this.net?.isHost) this.net.event(255, { e: 'round', n });
    this.round = n; this.state = 'combat'; this.toSpawn = roundQuota(n); this.spawned = 0; this.spawnT = 2.5; this.powerupsThisRound = 0; this.zombies.setRound?.(n); this.stats.rounds = n;
    this.hud.setRound(n); this.hud.banner(`ROUND ${n}`, this.world.active.name.toUpperCase()); this.audio?.play?.('ui.round.start', { vol: 0.9, bus: 'ui' });
    const v = this.world.vehicle; if (v && (v.state === 'open')) { this.syncVehicle(false); v.depart(this.world.active).then(() => {}); }
  }
  addPoints(n, popup = true) { if (this.doublePoints > 0) n *= 2; this.points += n; this.hud.setPoints(this.points); if (popup) this.hud.popup('+' + n); this.audio?.play?.('ui.point', { vol: 0.25, bus: 'ui' }); }
  spend(n) { this.points -= n; this.hud.setPoints(this.points); this.hud.popup('-' + n, true); }

  // ------------------------------------------------------------------ zombie events
  onZombieHit(z, info, spec) {
    this.hitCount++;
    const by = this.net?.shooter || 0; if (!by) this.hud.hitmarker(info.killed);
    if (info.killed) this.scoreKill(z, info, spec?.melee); else if (spec?._sid === undefined || z._lastShot !== spec._sid) { z._lastShot = spec?._sid; if (!this.net?.credit(by, 10)) this.addPoints(10, false); }
  }
  scoreKill(z, info = {}, melee = false) {
    if (z._scored) return; z._scored = true; if (this.net?.client) return; // (co-op: the host scores every kill)
    const base = info.nuke ? 0 : (melee || info.melee) ? 130 : info.headshot ? 100 : info.explosion ? 50 : 60; const by = this.net?.shooter || 0;
    if (!(base && this.net?.credit(by, base, true, !!info.headshot))) { this.kills++; if (info.headshot) this.headshots++; if (base) { this.addPoints(base, false); this.hud.popup('+' + base * (this.doublePoints > 0 ? 2 : 1)); } }
    this.maybeDropPowerup(z);
  }
  onKill(z, info) { this.scoreKill(z, info || {}, this.combat.lastMelee); }
  maybeDropPowerup(z) {
    if (this.round < 2 || this.powerupsThisRound >= 3) return; const chance = 0.02 + (this.powerupsThisRound === 0 && this.zombiesLeft() < 3 ? 0.25 : 0); if (rand() > chance) return; this.powerupsThisRound++;
    const kinds = ['maxammo', 'instakill', 'doublepoints', 'nuke']; this.dropPowerup(kinds[(rand() * kinds.length) | 0], z.pos || z.position);
  }
  dropPowerup(kind, p) {
    const g = this.world.groundAt(p.x, p.z, p.y + 1);
    const pu = new PowerUp(this.gfx.scene, this.gfx, kind, new THREE.Vector3(p.x, g.y, p.z)); pu.netId = (this._puSeq = (this._puSeq || 0) + 1); this.powerups.push(pu); this.audio?.play?.('powerup.spawn', { pos: p, vol: 0.7 });
    if (this.net) this.net.event(255, { e: 'pu', id: pu.netId, kind, p: [p.x, g.y, p.z] });
  }
  zombiesLeft() { return (this.toSpawn - this.spawned) + this.zombies.count; }
  takePowerup(pu) {
    if (this.net) { this.net.toHost({ e: 'take', id: pu.netId }); return; } // (co-op: the host hands it out, to everyone)
    this.applyPowerup(pu);
  }
  applyPowerup(pu, local = true) {
    pu.remove(); const k = pu.kind; this.audio?.play?.('powerup.' + k, { vol: 1, bus: 'ui' }); this.hud.banner(POWERUPS[k].name, '');
    if (k === 'maxammo') { this.weapons.refillAll(); } else if (k === 'instakill') this.instaKill = 30; else if (k === 'doublepoints') this.doublePoints = 30;
    else if (k === 'nuke') { this.fx.explosion(this.player.eye.clone().add(new THREE.Vector3(0, 2, 0)), 14, 2); this.gfx.flash.set(1, 0.95, 0.8, 1.0); if (!this.net?.client) this.zombies.killAll?.(); this.addPoints(400, true); this.audio?.play?.('explosion', { vol: 1 }); }
  }

  // ------------------------------------------------------------------ player
  onPlayerDown() {
    // co-op: down, waiting for a teammate (Quick Revive still gets you up on your own once), not the end of the run
    if (this.net && this.state !== 'dead' && !(this.perks.has('quickrevive') && !this.quickReviveUsed)) { this.state = 'downed'; this.perks.clear(); this.hud.setPerks(this.perks); this.applyPerks(); this.player.frozen = true; this.net.goDown(); this.audio?.play?.('player.death', { vol: 0.8 }); this.hud.banner('YOU ARE DOWN', 'Hold on: a teammate can revive you'); return; }
    if (this.perks.has('quickrevive') && !this.quickReviveUsed) { this.quickReviveUsed = true; this.perks.delete('quickrevive'); const p = this.player; this.state = 'reviving'; this.stateT = 3; this.hud.banner('REVIVING…', ''); p.alive = false; this.reviveHold = true; this.hud.setPerks(this.perks); return; }
    this.state = 'dead'; this.gameOverT = 0; this.player.frozen = true; this.audio?.play?.('player.death', { vol: 1 }); this.perks.clear(); this.hud.setPerks(this.perks); this.hud.prompt(null); this.d.onGameOver?.({ round: this.round, kills: this.kills, headshots: this.headshots, points: this.points, time: this.time });
  }

  // ------------------------------------------------------------------ interactables
  findInteractable() {
    const p = this.player, eye = p.eye, fwd = p.forward, sp = this.stopProps[this.stopIndex]; let best = null, bestScore = 0;
    const consider = (kind, obj, pos, r) => { const dx = pos.x - eye.x, dy = pos.y - eye.y, dz = pos.z - eye.z; const d = Math.hypot(dx, dy, dz); if (d > r) return; const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (d || 1); if (dot < 0.35 && d > 1.2) return; const s = (r - d) + dot * 2; if (s > bestScore) { bestScore = s; best = { kind, obj, d }; } };
    for (const m of sp.perks) consider('perk', m, m.worldPos, 2.6);
    for (const w of sp.walls) { w.setNear(0); consider('wall', w, w.worldPos, 2.4); }
    if (this.box && this.box.group.visible && this.box.state !== 'gone' && this.box.state !== 'leaving') consider('box', this.box, this.box.worldPos, 2.6);
    for (const b of sp.barricades) if (b.boards < b.max) consider('barricade', b, V2.set(b.pos.x, b.pos.y + 1, b.pos.z), 2.4);
    return best;
  }
  promptFor(it) {
    const F = '<span>F</span>'; const w = this.weapons;
    switch (it.kind) {
      case 'perk': { const d = it.obj.def; if (this.perks.has(it.obj.kind)) return `${d.name} — owned`; return `Press ${F} to buy ${d.name} [Cost: ${d.price}]`; }
      case 'wall': { const info = it.obj.info; if (w.has(it.obj.gun)) return `Press ${F} to buy ${info?.name || it.obj.gun} ammo [Cost: ${Math.round((info?.wallPrice ?? 500) / 2)}]`; return `Press ${F} to buy ${info?.name || it.obj.gun} [Cost: ${it.obj.price}]`; }
      case 'box': { const b = it.obj; if (b.state === 'closed') return `Press ${F} for Mystery Box [Cost: 950]`; if (b.state === 'ready') { const nm = this.d.weaponsApi?.WEAPONS?.[b.result]?.name || b.result; if (b.result === 'teddy') return ''; if (this.net && this.boxOwner !== this.net.you) return `${this.net.names.get(this.boxOwner) || 'A teammate'}'s ${nm}`; return `Press ${F} to take ${nm}`; } return ''; }
      case 'barricade': return `Hold ${F} to rebuild barricade`;
    }
    return '';
  }
  useInteractable(it, held, dt) {
    const w = this.weapons, api = this.d.weaponsApi?.WEAPONS || w.WEAPONS || {};
    if (it.kind === 'barricade') { if (held) { this.holdT += dt; if (this.holdT > 0.55) { this.holdT = 0; if (it.obj.repairNext()) { this.addPoints(10, true); const sp = this.stopProps[this.stopIndex]; this.net?.repaired(this.stopIndex, sp.barricades.indexOf(it.obj)); } } } return; }
    if (!this.input.pressed('KeyF')) return;
    if (it.kind === 'perk') { const m = it.obj, def = m.def; if (this.perks.has(m.kind)) return; if (this.points < def.price) return this.deny(); this.spend(def.price); this.perks.add(m.kind); m.dispense(); this.audio?.play?.(def.jingle, { vol: 0.9, bus: 'ui' }); this.applyPerks(); this.hud.setPerks(this.perks); this.hud.banner(def.name.toUpperCase(), def.desc); }
    else if (it.kind === 'wall') { const info = it.obj.info; const price = it.obj.price; if (w.has(it.obj.gun)) { const c = Math.round(price / 2); if (this.points < c) return this.deny(); this.spend(c); w.addAmmo(it.obj.gun); this.audio?.play?.('ui.buy', { vol: 0.8, bus: 'ui' }); } else { if (this.points < price) return this.deny(); this.spend(price); w.give(it.obj.gun); this.audio?.play?.('ui.buy', { vol: 0.8, bus: 'ui' }); } }
    else if (it.kind === 'box') { const b = it.obj; if (b.state === 'closed') { if (this.points < 950) return this.deny(); if (this.net) { /* (co-op: the host rolls the one box everyone sees; the points go when it opens for us) */ const now = performance.now(); if (now - (this.boxAskT || 0) > 1500) { this.boxAskT = now; this.net.toHost({ e: 'boxuse', w: this.weapons.current?.id || '' }); } return; } this.spend(950); this.openBox(); } else this.takeBox(); }
  }
  deny() { this.audio?.play?.('ui.deny', { vol: 0.7, bus: 'ui' }); this.hud.banner('NOT ENOUGH POINTS', ''); }
  applyPerks() { const p = this.player, pk = this.perks; const had = p.maxHp; p.maxHp = pk.has('juggernog') ? 250 : 100; if (p.maxHp > had) p.hp = p.maxHp; p.speedMul = pk.has('staminup') ? 1.15 : 1; this.weapons.setPerks({ speedCola: pk.has('speedcola'), doubleTap: pk.has('doubletap'), juggernog: pk.has('juggernog'), staminUp: pk.has('staminup') }); }
  /** take the gun the box is offering (in co-op only the player who rolled it can) */
  takeBox() { const b = this.box; if (!b || b.state !== 'ready' || b.result === 'teddy' || (this.net && this.boxOwner !== this.net.you)) return false; const id = b.take(); this.weapons.give(id); this.audio?.play?.('ui.buy', { vol: 0.8, bus: 'ui' }); this.net?.event(255, { e: 'boxtake' }); return id; }
  /** one roll of the box: what it cycles through and what it lands on ('teddy': it moves on). cur: the roller's gun, never offered */
  rollBox(cur) {
    const W = this.d.weaponsApi?.WEAPONS || this.weapons.WEAPONS || {}; const pool = Object.values(W).filter((x) => x.box).map((x) => x.id);
    const teddy = this.boxUses >= 3 && rand() < 0.14 + 0.03 * this.boxUses; const choices = pool.filter((id) => id !== cur); const result = teddy ? 'teddy' : choices[(rand() * choices.length) | 0];
    return { choices, result, teddy };
  }
  openBox() { const r = this.rollBox(this.weapons.current?.id); this.playBox(r.choices, r.result, r.teddy, true); }
  /** the box opening (every machine in co-op): mine - this player paid for it and gets the gun or the refund */
  playBox(choices, result, teddy, mine) {
    this.boxUses++; this.audio?.play?.('ui.box.open', { pos: this.box.worldPos, vol: 1 }); this.box.open([...choices, 'teddy'].filter((x) => x !== 'teddy' || teddy), result);
    if (teddy) { this.box.onReady = () => { this.audio?.play?.('ui.box.teddy', { pos: this.box.worldPos, vol: 1 }); if (mine) { this.points += 950; this.hud.setPoints(this.points); this.hud.popup('+950'); } setTimeout(() => { this.box.vanish(); if (!this.net || this.net.isHost) this.relocateBox(); }, 1800); }; } else this.box.onReady = () => {};
  }
  /** co-op, the host: a player asks to roll the box at the stop the team is at */
  hostBoxUse(pid, cur) {
    const b = this.box; if (!b || !b.group.visible || b.state !== 'closed' || this.boxStop !== this.stopIndex) return;
    const r = this.rollBox(String(cur || '').slice(0, 32)); const m = { e: 'box', pid, c: r.choices, r: r.result, t: r.teddy ? 1 : 0 };
    this.net.event(255, m); this.netBox(m);
  }
  /** co-op: the host rolled the box for player m.pid */
  netBox(m) {
    const b = this.box; if (!b || b.state !== 'closed') return; const W = this.d.weaponsApi?.WEAPONS || this.weapons.WEAPONS || {};
    const choices = (Array.isArray(m.c) ? m.c : []).filter((id) => typeof id === 'string' && W[id]).slice(0, 64); const result = m.t ? 'teddy' : String(m.r); if (!choices.length || (!m.t && !W[result])) return;
    const mine = m.pid === this.net.you; this.boxOwner = m.pid; if (mine) this.spend(Math.min(950, Math.max(0, this.points)));
    this.playBox(choices, result, !!m.t, mine);
  }
  /** co-op: the player who rolled it took the gun */
  netBoxTaken(pid) { if (pid === this.boxOwner && this.box?.state === 'ready') this.box.close(); }
  relocateBox() { const c = this.boxStops.filter((i) => i !== this.boxStop); if (c.length) this.boxStop = c[(this.rng() * c.length) | 0]; this.box.onGone = () => { this.box.state = 'closed'; }; this.net?.event(255, { e: 'boxmove', stop: this.boxStop }); }

  // ------------------------------------------------------------------ vehicle loop
  async vehicleArrive() {
    if (this.net?.isHost) this.net.event(255, { e: 'arrive' });
    const v = this.world.vehicle; if (!v) { this.state = 'awaitBoard'; return; } const st = this.world.active; this.state = 'vehicleArriving'; this.hud.banner('WAVE CLEARED', `${this.world.map.vehicleName || 'Vehicle'} inbound`); this.audio?.play?.('ui.round.end', { vol: 0.9, bus: 'ui' });
    await v.arrive(st); if (this.world.active !== st) return; this.syncVehicle(true); this.state = 'awaitBoard'; this.boardT = 0; this.hud.banner('BOARD THE ' + (this.world.map.vehicleName || 'VEHICLE').toUpperCase(), 'Step inside to travel to the next stop');
  }
  async beginRide() {
    const v = this.world.vehicle, w = this.world; if (!v) return; if (this.net?.isHost) this.net.event(255, { e: 'ride' });
    const from = this.stopIndex, to = (from + 1) % w.stops.length; this.state = 'riding'; v.clock = 0; v.timeScale = 1;
    // (co-op: whoever is not aboard when it leaves is put aboard - nobody is left on a stop the vehicle has left)
    if (this.net && !this.playerInVehicle()) { const bb = v.bounds; v.frame.updateWorldMatrix(true, false); const c = V.set((bb.minX + bb.maxX) / 2 + (Math.random() - 0.5) * 0.6, v.floorY + 0.05, (bb.minZ + bb.maxZ) / 2 + (Math.random() - 0.5) * 0.6); v.localToWorld(c, this.player.pos); }
    this.syncVehicle(false); this.player.setPlatform(v); this.gfx.resetTAA(); this.audio?.setListenerVehicle?.(v.name); this.hud.prompt(null);
    const hooks = { progress: (k) => { this.rideProgress = k; w.setTransit(from, to, k); } };
    await v.ride(w.stops[from], w.stops[to], hooks); v.timeScale = 1;
    this.stopIndex = to; w.setActive(to); this.showStopProps(to); this.player.setPlatform(null); this.syncVehicle(true); this.gfx.resetTAA(); this.applyStopAudio(w.stops[to]); for (const b of this.barricades) b.reset(); this.audio?.setListenerVehicle?.(null);
    this.state = 'arrived'; this.exitT = 0; this.stateT = 25; this.hud.banner(w.stops[to].name.toUpperCase(), 'Exit and hold the line');
  }
  /** Add/remove the docked vehicle's walls+floor to the stop's colliders so the player can walk in/out in world mode. */
  syncVehicle(on) {
    const v = this.world.vehicle, st = this.world.active; if (!v || !st) return; const col = st.B.colliders;
    if (this._vehCols) { for (const b of this._vehCols.list) this._vehCols.col.remove(b); this._vehCols = null; }
    if (!on) return; v.group.updateMatrixWorld(true); v.frame.updateWorldMatrix(true, false); const M = v.frame.matrixWorld, q = new THREE.Quaternion(); M.decompose(new THREE.Vector3(), q, new THREE.Vector3()); const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'); const yaw = e.y; const o = st.origin; const list = [];
    for (const b of v.colliders.boxes) { const p = V.set(b.x, b.y, b.z).applyMatrix4(M); list.push(col.addBox({ x: p.x - o.x, y: p.y - o.y, z: p.z - o.z, hx: b.hx, hy: b.hy, hz: b.hz, yaw: yaw + b.yaw, surface: b.surface, walk: b.walk, solid: b.solid, tag: 'vehicle' })); }
    for (const b of v.colliders.cyls) { const p = V.set(b.x, (b.y0 + b.y1) / 2, b.z).applyMatrix4(M); list.push(col.addCyl({ x: p.x - o.x, z: p.z - o.z, r: b.r, y0: p.y - o.y - (b.y1 - b.y0) / 2, y1: p.y - o.y + (b.y1 - b.y0) / 2, surface: b.surface, walk: b.walk, solid: b.solid, tag: 'vehicle' })); }
    const bb = v.bounds; const c = V.set((bb.minX + bb.maxX) / 2, v.floorY - 0.06, (bb.minZ + bb.maxZ) / 2).applyMatrix4(M); list.push(col.addBox({ x: c.x - o.x, y: c.y - o.y, z: c.z - o.z, hx: (bb.maxX - bb.minX) / 2, hy: 0.06, hz: (bb.maxZ - bb.minZ) / 2, yaw, surface: 'metal', walk: true, solid: true, tag: 'vehicleFloor' }));
    this._vehCols = { list, col };
  }
  playerInVehicle() { const v = this.world.vehicle; return v && (this.player.platform === v || v.isInside(this.player.pos)); }

  // ------------------------------------------------------------------ frame
  update(dt, time) {
    if (this.paused) return; this.time += dt; const p = this.player, hud = this.hud, w = this.world;
    // flashlight (T)
    if (this.input.pressed('KeyT') && this.state !== 'dead') { this.flashOn = !this.flashOn; this.audio?.play?.('ui.click', { vol: 0.5, bus: 'ui' }); }
    { const f = this.flashSrc; f.enabled = this.flashOn && this.state !== 'dead'; if (f.enabled) { f.pos.copy(p.eye).addScaledVector(p.right, 0.16).addScaledVector(V.set(0, 1, 0), -0.12).addScaledVector(p.forward, 0.25); f.dir.copy(p.forward); } }
    // power-up timers
    if (this.doublePoints > 0) { this.doublePoints -= dt; hud.setPower('dp', 'DOUBLE POINTS', POWERUPS.doublepoints.color, this.doublePoints); }
    if (this.instaKill > 0) { this.instaKill -= dt; hud.setPower('ik', 'INSTA-KILL', POWERUPS.instakill.color, this.instaKill); }
    this.combat.insta = this.instaKill > 0;
    // docked vehicle that heaves (ferry on swell, gondola in wind): keep the mirrored walkable colliders on the moving deck (20 Hz, only when it actually moved)
    if (this._vehCols && (this.state === 'awaitBoard' || this.state === 'arrived' || this.state === 'combat' || this.state === 'cleared')) {
      this._vehT = (this._vehT || 0) + dt;
      if (this._vehT >= 0.05) { this._vehT = 0; const v = this.world.vehicle; if (v && v.frame) { v.frame.updateWorldMatrix(true, false); const e = v.frame.matrixWorld.elements, k = this._vehKey || (this._vehKey = new Float32Array(16)); let d = 0; for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(e[i] - k[i])); if (d > 0.002) { k.set(e); this.syncVehicle(true); } } }
    }
    // stop props
    const sp = this.stopProps?.[this.stopIndex]; if (sp) { sp.perks.forEach((m) => m.update(dt, time)); sp.barricades.forEach((b) => b.update(dt)); }
    for (const st of this.stopProps || []) if (st !== sp) st.barricades.forEach((b) => b.update(dt));
    if (this.box) this.box.update(dt, time);
    for (let i = this.powerups.length - 1; i >= 0; i--) { const pu = this.powerups[i]; pu.update(dt, time); if (pu.dead) { this.powerups.splice(i, 1); continue; } if (pu.pos.distanceToSquared(p.pos) < 1.8 * 1.8 + 1 && p.alive && !pu.asked) { if (this.net) { pu.asked = true; this.takePowerup(pu); } else { this.powerups.splice(i, 1); this.takePowerup(pu); } } }
    // state machine (co-op: the host runs it; the others follow its events and only handle their own downed / revive)
    if (this.net) this.netFrame(dt, time);
    if (this.net?.client) { if (this.state === 'intro' && this.introBanner) { this.hud.show(true); this.hud.banner('GET READY', this.introBanner); this.introBanner = null; } if (this.state === 'reviving') { this.stateT -= dt; if (this.stateT <= 0) { this.player.alive = true; this.player.hp = this.player.maxHp; this.player.sinceHit = 0; this.state = this.netState_ || 'combat'; this.hud.banner('BACK ON YOUR FEET', ''); } } }
    else switch (this.state) {
      case 'intro': if (this.introBanner) { this.hud.show(true); this.hud.banner('GET READY', this.introBanner); this.introBanner = null; } this.stateT -= dt; if (this.stateT <= 0) this.beginRound(1); break;
      case 'combat': this.director(dt); break;
      case 'cleared': this.clearedT -= dt; if (this.clearedT <= 0) this.vehicleArrive(); break;
      case 'awaitBoard': if (this.net ? this.net.allInVehicle() : this.playerInVehicle()) { this.boardT += dt; if (this.boardT > 0.9) this.beginRide(); } else if (this.net && this.net.anyInVehicle()) { this.boardWait = (this.boardWait || 0) + dt; if (this.boardWait > 20) { this.boardWait = 0; this.beginRide(); } } else { this.boardT = 0; this.boardWait = 0; } break;
      case 'arrived': this.stateT -= dt; if (this.net ? this.net.allOutOfVehicle() : !this.playerInVehicle()) this.exitT += dt; else this.exitT = 0; if (this.exitT > 1.2 || this.stateT <= 0) { if (this.playerInVehicle()) { /* timeout: nudge */ } this.beginRound(this.round + 1); } break;
      case 'reviving': this.stateT -= dt; if (this.stateT <= 0) { this.player.alive = true; this.player.hp = this.player.maxHp; this.player.sinceHit = 0; this.state = 'combat'; this.hud.banner('BACK ON YOUR FEET', ''); } break;
      case 'dead': this.gameOverT += dt; break;
    }
    if (this.state === 'combat' || this.state === 'cleared' || this.state === 'downed' || this.state === 'spectating') { this.zombies.update(dt, time, p); }
    else if (this.zombies.count) this.zombies.update(dt, time, p);
    // interactables
    // co-op: a teammate who is down, within reach: hold F to pick them up
    const downedMate = this.net && p.alive && this.state !== 'downed' ? this.net.downedNear(p.pos) : null;
    if (downedMate) { const k = this.net.tickRevive(dt, this.input.down('KeyF'), downedMate); hud.prompt(`Hold <span>F</span> to revive ${this.net.name(downedMate.pid)}${k > 0 ? ` · ${Math.round(k * 100)}%` : ''}`); }
    else if (this.net) this.net.tickRevive(dt, false, null);
    if (!downedMate && this.state !== 'dead' && this.state !== 'downed' && this.state !== 'spectating' && this.state !== 'menu' && this.stopProps) {
      const near = this.findInteractable(); this.interact = near;
      if (near) { const held = this.input.down('KeyF'); const txt = this.promptFor(near); hud.prompt(txt || null); this.useInteractable(near, held, dt); if (near.kind === 'wall') near.obj.setNear(1); } else { hud.prompt(null); this.holdT = 0; }
    }
    // hud
    const cur = this.weapons.current; if (cur) hud.setAmmo(cur.def?.name || cur.name || cur.id, cur.mag ?? cur.ammoMag ?? 0, cur.reserve ?? cur.ammoReserve ?? 0, this.weapons.grenades, cur.def?.mag || 8);
    hud.setCrosshair(6 + (p.sprinting ? 10 : 0) + p.moveSpeed * 1.4 + (this.weapons.spread ? this.weapons.spread * 900 : 0), !p.sprinting && p.adsK < 0.4 && this.state !== 'dead');
    hud.update(dt); hud.drawArcs(p, dt); this.gfx.damage = clamp(1 - p.hp / p.maxHp, 0, 1) * (p.hp < p.maxHp * 0.6 ? 1 : 0); this.gfx.lowHP = p.hp < p.maxHp * 0.3 ? 1 : 0;
    this.gfx.flash.w = Math.max(0, this.gfx.flash.w - dt * 1.4);
    if (this.gfx.damage > 0 && this.state !== 'dead') this.audio?.heartbeat?.(this.gfx.lowHP);
  }
  director(dt) {
    const alive = this.zombies.count; this.spawnT -= dt;
    if (this.spawned < this.toSpawn && alive < MAX_ALIVE && this.spawnT <= 0) { if (this.spawnOne()) { this.spawned++; this.spawnT = Math.max(0.38, 2.1 - this.round * 0.09) * (0.8 + rand() * 0.4); } else this.spawnT = 0.5; }
    if (this.spawned >= this.toSpawn && alive === 0) { this.state = 'cleared'; this.clearedT = 3.2; this.hud.banner(`ROUND ${this.round} SURVIVED`, ''); this.stats.rounds = this.round; if (this.net?.isHost) this.net.event(255, { e: 'cleared', n: this.round }); }
  }
  pickVariant(st) {
    const vs = st.zombieVariants || ['default']; const list = vs.map((v) => (typeof v === 'string' ? { id: v, weight: 1, minRound: 1 } : { weight: 1, minRound: 1, ...v })).filter((v) => this.round >= v.minRound); const tot = list.reduce((a, b) => a + b.weight, 0); let r = rand() * tot; for (const v of list) { r -= v.weight; if (r <= 0) return v.id; } return list[list.length - 1].id;
  }
  spawnOne() {
    const st = this.world.active, pl = this.player.pos; let best = null, bestS = -1e9; const T = this.zombies.targets;
    for (const s of st.spawns) { const x = st.origin.x + s.pos[0], z = st.origin.z + s.pos[2]; let d = Math.hypot(x - pl.x, z - pl.z); if (T && T.length) { d = 1e9; for (const t of T) d = Math.min(d, Math.hypot(x - t.x, z - t.z)); } if (d < 9) continue; if (s.kind === 'barricade' && s.barricade && s.barricade.boards === 0 && this.zombies.alive.some((z2) => z2.spawnDef === s)) { } const score = -Math.abs(d - 26) + rand() * 14; if (score > bestS) { bestS = score; best = s; } }
    if (!best) best = st.spawns[(rand() * st.spawns.length) | 0]; if (!best) return false;
    const o = st.origin; V.set(o.x + best.pos[0], o.y + best.pos[1], o.z + best.pos[2]); const hp = roundHealth(this.round); const r = this.round;
    const sprintP = r < 3 ? 0 : Math.min(0.6, (r - 2) * 0.06), runP = r < 2 ? 0 : Math.min(0.7, (r - 1) * 0.12); const roll = rand(); const cls = roll < sprintP ? 'sprint' : roll < sprintP + runP ? 'run' : 'walk';
    const speed = { walk: 0.85 + rand() * 0.55, run: 2.3 + rand() * 1.0, sprint: 4.4 + rand() * 1.4 }[cls];
    const z = this.zombies.spawn(best.variant || this.pickVariant(st), V.clone(), best.yaw || 0, { hp, speed, speedClass: cls, kind: best.kind || 'walk', spawnDef: best, barricade: best.barricade || null, path: best.path, layers: best.layers || st.zombieLayers || undefined, layersMul: best.layersMul });
    return !!z;
  }
  // ------------------------------------------------------------------ co-op (net/coop.js drives these)
  seedRng(seed) { this.rng = makeRng(seed | 0); }
  /** where this player starts on a stop: its start, and in co-op a spot of its own beside it (1.3 m apart, a row of three ahead, the next row behind) */
  startSpot(st) {
    const o = st.origin, p0 = st.playerStart.pos, yaw = st.playerStart.yaw || 0; const slot = this.net ? Math.max(0, this.net.slot()) : 0;
    const side = (slot % 3) - 1, back = Math.floor(slot / 3); const lx = side * 1.3, lz = back * 1.3; // (local: x right, z back)
    const c = Math.cos(yaw), s = Math.sin(yaw); const x = p0[0] + lx * c + lz * s, z = p0[2] - lx * s + lz * c;
    const g = this.world.groundAt ? this.world.groundAt(o.x + x, o.z + z, o.y + p0[1] + 1) : null;
    return [o.x + x, g && Math.abs(g.y - (o.y + p0[1])) < 1 ? g.y : o.y + p0[1], o.z + z];
  }
  netFrame(dt, time) {
    this.net.update(dt, time);
    // the run is over when nobody is up (the host says so, for everyone)
    if (this.net.isHost && this.state !== 'dead' && this.state !== 'menu' && this.state !== 'intro' && !this.net.anyoneUp()) {
      const st = { round: this.round, kills: this.kills, headshots: this.headshots, points: this.points, time: this.time };
      this.net.event(255, { e: 'gameover', ...st }); this.netGameOver(st);
    }
  }
  netCleared(n) { this.state = 'cleared'; this.clearedT = 999; this.hud.banner(`ROUND ${n} SURVIVED`, ''); this.stats.rounds = n; }
  netState(m) {
    this.netState_ = m.state; this.toSpawn = m.toSpawn; this.spawned = m.spawned; this.doublePoints = m.dp || 0; this.instaKill = m.ik || 0;
    if (m.round > this.round && this.state !== 'downed' && this.state !== 'spectating') { this.round = m.round; this.hud.setRound(m.round); }
    if (m.stop !== this.stopIndex && this.state !== 'riding' && this.state !== 'vehicleArriving') this.debugGotoStop(m.stop);
  }
  netPowerupSpawn(m) {
    if (this.powerups.some((p) => p.netId === m.id)) return; const pu = new PowerUp(this.gfx.scene, this.gfx, m.kind, new THREE.Vector3(m.p[0], m.p[1], m.p[2])); pu.netId = m.id; this.powerups.push(pu); this.audio?.play?.('powerup.spawn', { pos: pu.pos, vol: 0.7 });
  }
  hostTakePowerup(id, pid) {
    const pu = this.powerups.find((p) => p.netId === id); if (!pu) return; this.net.event(255, { e: 'put', id, kind: pu.kind, by: pid }); this.netPowerupTaken({ id, kind: pu.kind, by: pid });
  }
  netPowerupTaken(m) {
    const i = this.powerups.findIndex((p) => p.netId === m.id); if (i < 0) return; const pu = this.powerups[i]; this.powerups.splice(i, 1); this.applyPowerup(pu);
  }
  netBoxMove(stop) {
    if (this.boxStop === stop || !this.box) return; const here = this.boxStop === this.stopIndex && this.box.group.visible; this.boxStop = stop;
    // (the box at this stop flies off first - the teddy's own vanish is already under way - then the props follow the new stop)
    if (here && this.box.state !== 'gone') { if (this.box.state !== 'leaving') this.box.vanish(); this.box.onGone = () => { this.box.state = 'closed'; this.showStopProps(this.stopIndex); }; return; }
    this.showStopProps(this.stopIndex);
  }
  netRevived(by) { this.state = this.netState_ && this.netState_ !== 'downed' ? this.netState_ : 'combat'; const p = this.player; p.alive = true; p.frozen = false; p.hp = Math.round(p.maxHp * 0.5); p.sinceHit = 0; this.hud.banner('REVIVED', `${by} picked you up`); this.audio?.play?.('ui.round.start', { vol: 0.5, bus: 'ui' }); }
  netBleedOut() { this.state = 'spectating'; this.player.frozen = true; this.hud.banner('YOU BLED OUT', 'Back at the start of the next round'); }
  // a new round: whoever is down or out is back on their feet at the stop's start, with a pistol, like a new survivor
  netRespawn() {
    const p = this.player, st = this.world.active; p.alive = true; p.frozen = false; p.maxHp = 100; p.hp = 100; p.sinceHit = 99; this.perks.clear(); this.applyPerks(); this.hud.setPerks(this.perks);
    this.weapons.slots.length = 0; this.weapons.give('m1911'); p.setPlatform(null); p.teleport(this.startSpot(st), st.playerStart.yaw);
    this.state = 'combat'; this.hud.banner('BACK IN THE FIGHT', '');
  }
  netGameOver(st) { if (this.state === 'dead') return; this.state = 'dead'; this.gameOverT = 0; this.player.frozen = true; this.hud.prompt(null); this.d.onGameOver?.({ ...st, kills: this.kills, headshots: this.headshots, points: this.points, team: true }); }
  // a late joiner: straight to the stop and round the team is on
  netSync(m) {
    if (m.stop !== this.stopIndex) this.debugGotoStop(m.stop); this.player.teleport(this.startSpot(this.world.stops[m.stop]), this.world.stops[m.stop].playerStart.yaw);
    this.round = m.round; this.hud.setRound(m.round); this.toSpawn = m.toSpawn; this.spawned = m.spawned; this.boxStop = m.boxStop; this.showStopProps(this.stopIndex);
    this.state = m.state === 'riding' || m.state === 'vehicleArriving' ? 'combat' : m.state; this.netState_ = m.state; this.hud.show(true);
  }
  // the host left and this machine takes over: it runs the director from the last state the host sent
  netBecomeHost() {
    const s = this.netState_ || this.state; if (s === 'combat' || s === 'intro') { this.state = 'combat'; this.spawnT = 1; }
    else if (s === 'cleared') { this.state = 'cleared'; this.clearedT = 1; }
    else if (s === 'awaitBoard' || s === 'vehicleArriving') { this.vehicleArrive(); }
    else if (s === 'arrived') { this.state = 'arrived'; this.stateT = 10; this.exitT = 0; }
  }
  // debugging helpers
  debugSetRound(n) { this.round = n - 1; this.zombies.clear(); this.beginRound(n); }
  /** tooling helper: jump straight to stop i as if the ride had just arrived (vehicle parked away, player at the stop's start) */
  debugGotoStop(i) {
    const w = this.world, st = w.stops[i]; if (!st) return false; this.zombies.clear(); this.stopIndex = i; w.setActive(i); this.showStopProps(i); this.player.setPlatform(null); this.gfx.resetTAA(); this.applyStopAudio(st); for (const b of this.barricades) b.reset();
    this.player.teleport(this.startSpot(st), st.playerStart.yaw); this.player.pitch = 0; if (w.vehicle) w.vehicle.parkAway?.(st); return true;
  }
}
