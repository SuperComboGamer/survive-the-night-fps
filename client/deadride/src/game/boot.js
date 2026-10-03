// Boot: menu -> load map -> play loop. Falls back to stub zombie/weapon systems if the real ones are missing.
import * as THREE from 'three';
import { Synth } from '../core/synth.js';
import { FX } from '../core/fx.js';
import { Player } from '../core/player.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { HUD } from './hud.js';
import { Menu } from './menu.js';
import { Game } from './game.js';
import { Combat } from './combat.js';
import { Perf } from './perf.js';
import { StubZombies, StubWeapons, STUB_WEAPONS } from './stubs.js';
import { MAPS, loadMap } from '../maps/index.js';
import { World } from '../core/world.js';
import { installBench } from './bench.js';
import { LobbyClient } from '../net/lobby.js';
import { LobbyUI } from '../net/lobbyui.js';
import { Coop } from '../net/coop.js';

const hFovToV = (h, aspect) => (2 * Math.atan(Math.tan((h * Math.PI / 180) / 2) / aspect)) * 180 / Math.PI;

/** Sound must never be able to crash the game: wrap every audio entry point. */
function guardAudio(a) {
  const warned = new Set(); const wrap = (obj, k, label) => { const f = obj[k]; if (typeof f !== 'function' || f.__guarded) return; const g = function (...args) { try { return f.apply(this, args); } catch (e) { const key = label + k + String(e && e.message).slice(0, 40); if (!warned.has(key)) { warned.add(key); console.warn('[audio] ' + label + k + ' failed:', e && e.message); } return null; } }; g.__guarded = true; obj[k] = g; };
  for (const k of ['init', 'play', 'update', 'setSpace', 'register', 'muffle', 'duck', 'explosion', 'impact', 'attachPlayer', 'setListenerVehicle', 'heartbeat', 'zombieVoice', 'vehicleLoop']) wrap(a, k, '');
  if (a.ambience) for (const k of ['set', 'blend', 'update']) wrap(a.ambience, k, 'ambience.');
}

export async function start(gfx, P) {
  guardAudio(audio); const ui = document.getElementById('ui'); const synth = new Synth(gfx.renderer); const fx = new FX(gfx); input.init(gfx.canvas);
  const hud = new HUD(ui); const perf = new Perf(gfx, hud); const S = { fov: 90, sens: 1, vol: 0.8, fps: false }; let mode = 'menu', game = null, world = null, player = null, weapons = null, zombies = null, combat = null, paused = false, coop = null;
  // online: the lobby on the server (net/lobby.js) and its screens; a started game is played with net/coop.js
  const lobby = new LobbyClient();
  let lobbyUI = null;
  const menu = new Menu({ gfx, synth, fx, audio, ui, onPlay: (id) => play(id), onOnline: () => { menu.show(false); lobbyUI.show(); }, onSettings: (s) => { Object.assign(S, s); input.sens = S.sens; if (audio.master) audio.master.gain.value = S.vol; perf.toggle(S.fps); } });
  lobbyUI = new LobbyUI(lobby, { getMap: () => MAPS[menu.sel]?.id || MAPS[0].id, onStart: (m) => { if (mode === 'menu') { lobbyUI.hide(); play(m.map, m); } }, onClose: () => menu.show(true), uiSound: (n) => menu.uiSound?.(n) });
  window.__g = { cpu: {}, gfx, fx, hud, perf, menu, input, lobby, get coop() { return coop; }, get game() { return game; }, get world() { return world; }, get player() { return player; }, get weapons() { return weapons; }, get zombies() { return zombies; }, get mode() { return mode; }, S, synth };
  gfx.setQuality(P.get('q') || 'high'); gfx.dynRes = P.get('dyn') !== '0'; if (P.get('dyn') === '0') S.dyn = false;
  const overlay = document.createElement('div'); overlay.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,.72);color:#eee;font:900 40px Impact,sans-serif;letter-spacing:.15em;z-index:20;pointer-events:auto;text-align:center'; ui.appendChild(overlay);
  const showOverlay = (html, buttons = []) => { overlay.innerHTML = html + `<div style="margin-top:26px;display:flex;gap:16px">${buttons.map((b, i) => `<button data-i="${i}" style="pointer-events:auto;background:#c21f1f;color:#fff;border:0;padding:12px 30px;font:900 20px Impact,sans-serif;letter-spacing:.2em;cursor:pointer">${b.label}</button>`).join('')}</div>`; overlay.style.display = 'flex'; overlay.querySelectorAll('button').forEach((el) => (el.onclick = () => { overlay.style.display = 'none'; buttons[+el.dataset.i].fn(); })); };

  async function loadSystems(mapDef) {
    let ZM = StubZombies, WS = StubWeapons, wapi = { WEAPONS: STUB_WEAPONS };
    try { const m = await import('./zombies/index.js'); if (m.ZombieManager) ZM = m.ZombieManager; } catch (e) { console.warn('[boot] zombie system unavailable → stub:', e.message); }
    try { const m = await import('./weapons/index.js'); if (m.WeaponSystem) { WS = m.WeaponSystem; wapi = m; } } catch (e) { console.warn('[boot] weapon system unavailable → stub:', e.message); }
    return { ZM, WS, wapi };
  }
  // The player, the zombies (every variant's bodies built), combat and the weapons (guns built, textures baked) for a map's world.
  // The menu starts this in the background once the map has loaded (see the interval below), so PLAY finds it done.
  let pre = null; // { world, p: Promise<systems> }
  function prepareSystems(id, w, progress = () => {}) {
    if (pre && pre.world === w) return pre.p;
    if (pre) { const old = pre.p; old.then((s2) => { gfx.scene.remove(s2.zombies.group); s2.weapons.vm?.root?.parent?.remove(s2.weapons.vm.root); }).catch(() => {}); } // (a set for another map: dropped)
    const def = menu.defs[id];
    const p = (async () => {
      const { ZM, WS, wapi } = await loadSystems(def);
      const pl = new Player(gfx, w, input); pl.fov = hFovToV(S.fov, gfx.aspect);
      const zm = new ZM({ gfx, world: w, fx, audio }); zm.registerVariants?.(id, def.zombies?.variants || []); if (def.zombies?.register) def.zombies.register(zm);
      try { const vm = await import('./zombies/variants/index.js'); await vm.registerAll?.(zm); } catch (e) { /* variant sets not available (yet) */ }
      if (zm.prepare) { progress(0.88, 'Raising the dead…'); await new Promise((r) => setTimeout(r, 30)); try { await zm.prepare(id); } catch (e) { console.warn('zombie prepare failed', e); } }
      const cb = new Combat({ world: w, fx, zombies: zm, audio, game: null }); const ws = new WS({ gfx, fx, audio, world: w, player: pl, input, combat: cb }); cb.game = null;
      if (mode === 'menu' && ws.vm?.root) ws.vm.root.visible = false; // (the hands stay out of the menu)
      try { await Promise.race([ws.ready, new Promise((r) => setTimeout(r, 20000))]); } catch (e) { /* the game waits again below */ }
      return { ZM, WS, wapi, player: pl, zombies: zm, combat: cb, weapons: ws, voices: !!audio.ready };
    })();
    pre = { world: w, p };
    p.catch(() => { if (pre?.p === p) pre = null; });
    return p;
  }
  async function play(id, online = null) {
    if (mode !== 'menu') return; mode = 'loading'; coop?.dispose(); coop = online ? new Coop(lobby, online) : null; try { await audio.init(); if (audio.master) audio.master.gain.value = S.vol; } catch (e) { console.warn('audio init failed', e); }
    const def = menu.defs[id]; menu.loading(def.name.toUpperCase(), 0.02, 'Preparing…');
    let hero = menu.heroes[id]; if (!hero) { menu.ensureHero(id, true); } while (!hero || hero.state === 'queued' || hero.state === 'loading') { await new Promise((r) => setTimeout(r, 60)); hero = menu.heroes[id]; } if (hero.state !== 'ready') { menu.loading('ERROR', 0, 'Map failed to build'); mode = 'menu'; return; }
    world = hero.world; await world.loadRest((p, m) => menu.loading(def.name.toUpperCase(), 0.1 + p * 0.7, m)); world.root.visible = true;
    menu.loading(def.name.toUpperCase(), 0.85, 'Arming systems…'); await new Promise((r) => setTimeout(r, 30));
    const sys = await prepareSystems(id, world, (k, msg) => menu.loading(def.name.toUpperCase(), k, msg)); pre = null; // (a system set is used once)
    const { wapi } = sys; player = sys.player; zombies = sys.zombies; combat = sys.combat; weapons = sys.weapons; player.fov = hFovToV(S.fov, gfx.aspect); if (weapons.vm?.root) weapons.vm.root.visible = true;
    // prepared on the menu before sound could start: the zombies' voices are built now that it has
    if (!sys.voices && zombies.prepare && zombies.voiceSets) { zombies.voiceSets.clear(); try { await zombies.prepare(id); } catch (e) { /* silent dead */ } }
    game = new Game({ gfx, synth, fx, world, audio, input, hud, player, zombies, weapons, combat, weaponsApi: wapi, onGameOver: (st) => gameOver(st) }); combat.game = game; game.weaponsApi = wapi; window.__g.combat = combat;
    audio.attachPlayer?.(player); fx.setWorld(world); if (coop) coop.attach({ game, player, zombies, weapons, combat, world, fx, audio, gfx, hud, input }); game.buildProps(); game.newRun(); if (P.get('round')) game.debugSetRound(+P.get('round'));
    menu.loading(def.name.toUpperCase(), 0.92, 'Compiling shaders…'); await new Promise((r) => setTimeout(r, 30)); const tw = performance.now(); try { await world.warm(); } catch (e) { console.warn('warmup failed', e); } console.log('[boot] warm-up ms', (performance.now() - tw).toFixed(0));
    // the weapon system builds its guns / textures in background slices: finish that before play so no 0.3–0.9 s main-thread task lands in the first waves
    { menu.loading(def.name.toUpperCase(), 0.96, 'Loading weapons…'); const tb = performance.now(); try { await Promise.race([weapons.ready, new Promise((r) => setTimeout(r, 20000))]); while (weapons.timing && !weapons.timing.all && performance.now() - tb < 25000) await new Promise((r) => setTimeout(r, 40)); } catch (e) { console.warn('weapon build wait failed', e); } console.log('[boot] weapons ready ms', (performance.now() - tb).toFixed(0)); try { gfx.resetTAA(); } catch (e) {} }
    menu.loading(def.name.toUpperCase(), 1, 'Ready', true);
    if (coop) { menu.loading(def.name.toUpperCase(), 1, 'Waiting for the team…', false); await coop.waitGo(); }
    else await new Promise((res) => { const go = () => { removeEventListener('click', go); res(); }; if (P.get('autostart')) res(); else addEventListener('click', go); });
    menu.hideLoading(); menu.show(false); world.setShown(true); hud.show(true); input.lock(); mode = 'play'; paused = false; if (P.get('nolock')) input.locked = true;
  }
  function gameOver(st) {
    input.unlock();
    if (coop) { // co-op: the team's run is over: back to the lobby, together
      showOverlay(`<div style="color:#b01010;font-size:72px">EVERYONE IS DOWN</div><div style="font:600 20px Bahnschrift,Arial;letter-spacing:.2em;margin-top:18px;line-height:1.9">THE TEAM SURVIVED <b>${st.round - 1 > 0 ? st.round - 1 : 0}</b> ROUNDS · YOU: ${st.kills} KILLS · ${st.headshots} HEADSHOTS</div>`, [{ label: 'BACK TO LOBBY', fn: () => leaveOnline(true) }]);
      return;
    } showOverlay(`<div style="color:#b01010;font-size:72px">YOU DIED</div><div style="font:600 20px Bahnschrift,Arial;letter-spacing:.2em;margin-top:18px;line-height:1.9">SURVIVED <b>${st.round - 1 > 0 ? st.round - 1 : 0}</b> ROUNDS · ${st.kills} KILLS · ${st.headshots} HEADSHOTS · ${Math.round(st.time)}s</div>`, [{ label: 'RESTART', fn: () => { game.newRun(); input.lock(); } }, { label: 'MAP SELECT', fn: () => backToMenu() }]);
  }
  // out of an online game: to the lobby (staying in it) or out of it
  function leaveOnline(stay) {
    if (lobby.isHost && stay) lobby.send({ t: 'end' });
    coop?.dispose(); coop = null; backToMenu();
    if (stay && lobby.lobby) { menu.show(false); lobbyUI.show(); } else lobby.leave();
  }
  function backToMenu() { mode = 'menu'; hud.show(false); zombies?.clear(); game.stopProps?.forEach((sp) => { sp.perks.forEach((m) => m.setVisible(false)); sp.walls.forEach((w) => w.setVisible(false)); sp.barricades.forEach((b) => (b.group.visible = false)); }); game.box && (game.box.group.visible = false); for (const pu of game.powerups) pu.remove(); game.powerups = []; world.setShown(false); menu.setHero(menu.heroId); menu.show(true); }
  input.onLockChange = (locked) => { if (!locked && mode === 'play' && coop && game.state !== 'dead' && !P.get('nolock')) { showOverlay('MENU<div style="font:600 15px Bahnschrift,Arial;letter-spacing:.2em;margin-top:12px">THE GAME GOES ON FOR YOUR TEAM</div>', [{ label: 'RESUME', fn: () => input.lock() }, { label: 'LEAVE GAME', fn: () => leaveOnline(false) }]); return; }
    if (!locked && mode === 'play' && game.state !== 'dead' && !P.get('nolock')) { paused = true; game.paused = true; audio.muffle?.(0.5); showOverlay('PAUSED', [{ label: 'RESUME', fn: () => { paused = false; game.paused = false; audio.muffle?.(0); input.lock(); } }, { label: 'MAP SELECT', fn: () => { paused = false; game.paused = false; audio.muffle?.(0); backToMenu(); } }]); } };
  addEventListener('keydown', (e) => { if (e.code === 'F3') { S.fps = !perf.on; perf.toggle(S.fps); e.preventDefault(); } });
  perf.toggle(!!P.get('fps'));

  await menu.init(); menu.show(true); gfx.camera.position.set(0, 2, 0);
  // from the Survive the Night splash: ?online=1 opens the lobby list, ?join=CODE goes straight into that game's lobby
  if ((P.get('online') || P.get('join')) && !P.get('play')) { menu.show(false); lobbyUI.show().then(() => { const code = (P.get('join') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); if (code.length === 4 && lobby.open && !lobby.lobby) lobby.send({ t: 'join', code }); }); }
  // while the player looks at the menu, the selected map's other stops, route and vehicle load in the background: PLAY then
  // only waits for what is left (a map is a lot of building and shader compiling)
  setInterval(() => { if (mode !== 'menu' || menu.building) return; const id = MAPS[menu.sel]?.id; const h = id && menu.heroes[id]; if (!h || h.state !== 'ready' || !h.world) return; if (!h.world.loadedAll) { if (!h.world._restP) h.world.loadRest().catch((e) => console.warn('background load', e)); } else if (!pre || pre.world !== h.world) prepareSystems(id, h.world).catch((e) => console.warn('background prepare', e)); }, 1000);
  // debug / test hooks
  window.__g.play = play; window.__g.hero = () => menu.hero; installBench(window.__g);
  let last = performance.now(), t = 0, running = true; window.__g.stop = () => { running = false; };
  const frame = (now) => {
    if (!running) return; if (synth.queue?.length && !synth.defer) synth.flushSync(); /* (a deferred texture bake left over: draw it before anything shows it) */ const raw = now - last; last = now; const dt = Math.min(0.05, raw / 1000); t += dt; perf.frame(raw, mode === 'play' ? `z ${zombies?.count ?? 0}\n` + Object.entries(window.__g.cpu).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('  ') : ''); perf.adapt(dt);
    if (mode === 'menu') { menu.update(dt, t); fx.update(dt, t, gfx.camera.position); gfx.render(dt, t); }
    else if (mode === 'play' && !paused) {
      const C = window.__g.cpu, T0 = performance.now(); let T1;
      const lap = (k) => { T1 = performance.now(); C[k] = (C[k] ?? T1 - T0) * 0.95 + (T1 - lapT) * 0.05; lapT = T1; }; let lapT = T0;
      gfx.fxShake = fx.shake; const asp = gfx.aspect || 16 / 9; player.fov = hFovToV(S.fov, asp);
      player.update(dt); lap('player'); weapons.update(dt, t); lap('weapons'); gfx.setFov(player.fov * (weapons.fovMul ?? 1) * (1 + (player.sprinting ? 0.04 : 0)));
      game.update(dt, t); lap('game+zombies'); world.update(dt, t, gfx.camera.position); lap('world'); if (coop) { coop.lateUpdate(dt, t); lap('team'); } fx.update(dt, t, gfx.camera.position); gfx.shadowCenter.copy(gfx.camera.position); lap('fx');
      audio.update?.(dt, { pos: gfx.camera.position, forward: player.forward, up: { x: 0, y: 1, z: 0 } }, {}); lap('audio');
      gfx.render(dt, t); lap('render(cpu)');
    } else if (mode === 'play') gfx.render(0.0001, t); else { menu.update(dt, t); gfx.render(dt, t); }
    input.endFrame(); requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (P.get('play')) { await new Promise((r) => setTimeout(r, 300)); window.__ready = false; await play(P.get('play')); }
  window.__ready = true;
}
