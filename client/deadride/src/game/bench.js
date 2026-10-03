// In-page benchmark scenarios (window.__g.bench). Driven by tools/bench.mjs. A simple bot aims/fires so the whole game loop is exercised.
import * as THREE from 'three';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFrames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });

export function installBench(g) {
  const bot = { on: false, t: 0 };
  const tick = () => {
    if (bot.on && g.game && g.mode === 'play') {
      const p = g.player, zs = g.zombies.alive; bot.t += 1 / 60;
      let best = null, bd = 1e9; for (const z of zs) { const zp = z.pos || z.position; if (!zp || z.dead) continue; const d = zp.distanceTo(p.pos); if (d < bd) { bd = d; best = zp; } }
      if (best) { const dx = best.x - p.eye.x, dz = best.z - p.eye.z, dy = best.y + 1.4 - p.eye.y; p.yaw += (Math.atan2(-dx, -dz) - p.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI; p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
      g.input.hold('KeyW', bd > 6); g.input.hold('KeyS', bd < 3); g.input.hold('KeyA', Math.sin(bot.t * 0.8) > 0.3); g.input.hold('KeyD', Math.sin(bot.t * 0.8) < -0.3);
      g.input.holdMouse(0, true); if (g.weapons.current && (g.weapons.current.mag ?? g.weapons.current.ammoMag ?? 1) === 0) g.input.tap('KeyR'); g.game.godMode = true; p.hp = p.maxHp;
      if (Math.floor(bot.t * 4) % 40 === 0) g.weapons.refillAll?.();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const fill = (n = 24) => { const gm = g.game; gm.state = 'combat'; gm.toSpawn = 9999; gm.spawned = 0; gm.spawnT = 0; gm.round = Math.max(gm.round, 10); gm.zombies.setRound?.(gm.round); const t0 = performance.now(); while (g.zombies.count < n && performance.now() - t0 < 500) if (!gm.spawnOne()) break; };
  const scenarios = {
    async wave(sec) { g.game.debugSetRound(12); await sleep(300); for (let i = 0; i < 4; i++) { fill(24); await sleep(150); } bot.on = true; g.perf.start('wave'); const end = performance.now() + sec * 1000; while (performance.now() < end) { if (g.zombies.count < 24) fill(24); await sleep(100); } bot.on = false; g.input.holdMouse(0, false); return g.perf.stop(); },
    async explosions(sec) { g.game.debugSetRound(14); await sleep(300); fill(24); bot.on = true; g.perf.start('explosions'); const end = performance.now() + sec * 1000; let k = 0; while (performance.now() < end) { if (g.zombies.count < 24) fill(24); const zs = g.zombies.alive; const z = zs[(Math.random() * zs.length) | 0]; const zp = z && (z.pos || z.position); const c = zp ? zp.clone() : g.player.pos.clone().add(new THREE.Vector3(4, 0, 4)); c.y += 0.6; g.combat.explode(c, 5, 60, { hurtPlayer: false }); if (k++ % 4 === 0) g.fx.explosion(g.player.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, 0.5, -6 - Math.random() * 6)), 6, 2); await sleep(650); } bot.on = false; g.input.holdMouse(0, false); return g.perf.stop(); },
    async ride(sec, opts = {}) { const gm = g.game, w = g.world; g.zombies.clear(); gm.state = 'cleared'; gm.clearedT = 0; const from = gm.stopIndex; g.perf.start('ride' + from); const t0 = performance.now(); await gm.vehicleArrive(); const v = w.vehicle; const c = v.boardBox; const local = new THREE.Vector3((c.min.x + c.max.x) / 2, v.floorY, (c.min.z + c.max.z) / 2); v.frame.updateWorldMatrix(true, false); v.localToWorld(local, g.player.pos); await gm.beginRide(); await sleep(1200); const r = g.perf.stop(); r.rideSeconds = (performance.now() - t0) / 1000; return r; },
    async stops(sec) { const w = g.world, res = []; g.zombies.clear(); g.perf.start('stops'); for (let i = 0; i < w.stops.length; i++) { w.setActive(i); g.game.stopIndex = i; g.game.showStopProps(i); const st = w.stops[i]; g.player.teleport([st.origin.x + st.playerStart.pos[0], st.origin.y + st.playerStart.pos[1], st.origin.z + st.playerStart.pos[2]], st.playerStart.yaw); g.gfx.resetTAA(); const before = g.perf.stats(g.perf.recording.ft.slice(-1)); await sleep(sec * 1000 / w.stops.length); res.push({ stop: i, calls: g.gfx.stats.calls, tris: g.gfx.stats.tris }); } const r = g.perf.stop(); r.perStop = res; return r; },
    /** Plays whole rounds with the bot and rides the vehicle between stops. opts: {rounds}. Returns state-transition log + frame stats. */
    async autoplay(sec, opts = {}) {
      const rounds = opts.rounds || 3, gm = g.game, w = g.world, log = []; const t0 = performance.now(); let last = ''; bot.on = true; gm.godMode = true; g.perf.start('autoplay'); const tmp = new THREE.Vector3();
      while ((performance.now() - t0) / 1000 < sec) {
        const st = gm.state; const key = st + '|' + gm.round + '|' + gm.stopIndex; if (key !== last) { log.push({ t: +((performance.now() - t0) / 1000).toFixed(1), state: st, round: gm.round, stop: gm.stopIndex, zombies: g.zombies.count, hp: Math.round(g.player.hp) }); last = key; }
        if (st === 'awaitBoard') { const v = w.vehicle; if (v && !gm.playerInVehicle()) { const c = v.boardBox; tmp.set((c.min.x + c.max.x) / 2, v.floorY + 0.05, (c.min.z + c.max.z) / 2); v.localToWorld(tmp, g.player.pos); g.player.vel.set(0, 0, 0); } }
        if (st === 'arrived' && gm.playerInVehicle()) { const s = w.active; g.player.teleport([s.origin.x + s.playerStart.pos[0], s.origin.y + s.playerStart.pos[1], s.origin.z + s.playerStart.pos[2]], s.playerStart.yaw); }
        if (gm.state === 'dead') break; if (gm.round > rounds && (gm.state === 'combat' || gm.state === 'cleared')) break; await sleep(100);
      }
      bot.on = false; g.input.holdMouse(0, false); const r = g.perf.stop(); r.log = log; r.finalRound = gm.round; r.finalStop = gm.stopIndex; r.kills = gm.kills; r.points = gm.points; return r;
    },
    async menu(sec) { g.perf.start('menu'); await sleep(sec * 1000); return g.perf.stop(); },
  };
  g.bench = async (name, sec = 20, opts) => scenarios[name](sec, opts);
  g.fill = fill; g.botOn = (v) => (bot.on = v);
}
