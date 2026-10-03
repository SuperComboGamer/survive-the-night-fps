// Map-select screen: live 3D hero of each map's first stop (built lazily, cinematic first-person camera), map cards, route diagram,
// settings, controls. DOM overlay + the real renderer behind it.
import * as THREE from 'three';
import { World } from '../core/world.js';
import { audio } from '../core/audio.js';
import { loadMap, MAPS } from '../maps/index.js';
import { clamp, lerp, damp, noise2 } from '../core/util.js';

const CSS = `
#menu{position:fixed;inset:0;display:none;font-family:"Bahnschrift","Segoe UI",Roboto,Arial,sans-serif;color:#eee7d6;z-index:10;user-select:none}
#menu .vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 40%,rgba(0,0,0,0) 30%,rgba(0,0,0,.72) 100%),linear-gradient(180deg,rgba(0,0,0,.55) 0,rgba(0,0,0,0) 22%,rgba(0,0,0,0) 55%,rgba(0,0,0,.85) 100%);pointer-events:none}
#menu h1{position:absolute;left:5vw;top:5vh;margin:0;font:900 clamp(44px,8vw,120px)/0.9 Impact,"Arial Black",sans-serif;letter-spacing:.06em;color:#c8bfa5;text-shadow:0 2px 0 #000,0 0 30px rgba(0,0,0,.8);transition:color .6s}
#menu h1 em{color:var(--acc,#c21f1f);font-style:normal;text-shadow:0 0 22px var(--acc,#c21f1f),0 2px 0 #000;transition:color .6s,text-shadow .6s}
#menu .sub{position:absolute;left:5.2vw;top:calc(5vh + clamp(44px,8vw,120px)*0.95);font:600 clamp(11px,1.1vw,16px) "Bahnschrift",Arial;letter-spacing:.5em;color:#a89f88;text-transform:uppercase}
#menu .info{position:absolute;left:5vw;bottom:33vh;width:min(560px,42vw);transition:opacity .4s}
#menu .info h2{margin:0 0 6px;font:900 clamp(28px,3.4vw,52px) Impact,"Arial Black",sans-serif;letter-spacing:.05em;color:var(--acc,#fff);text-shadow:0 2px 0 #000,0 0 18px rgba(0,0,0,.7)}
#menu .info p{margin:0 0 12px;font-size:clamp(13px,1.12vw,17px);line-height:1.45;color:#d9d1bd;text-shadow:0 1px 3px #000;max-width:520px}
#menu .route{display:flex;align-items:center;flex-wrap:wrap;gap:0;margin:8px 0 14px}
#menu .route .n{display:flex;flex-direction:column;align-items:center;font:700 11px "Bahnschrift",Arial;letter-spacing:.11em;color:#ddd5c0;text-shadow:0 1px 3px #000;text-transform:uppercase;width:84px;text-align:center}
#menu .route .n i{width:11px;height:11px;border-radius:50%;background:var(--acc,#fff);box-shadow:0 0 10px var(--acc,#fff);margin-bottom:5px}
#menu .route .l{width:34px;height:2px;background:linear-gradient(90deg,var(--acc,#fff),rgba(255,255,255,.2));margin-top:-16px}
#menu .route .loop{font:700 10px Arial;color:#9c957f;margin-left:6px;margin-top:-16px}
#menu .meta{display:flex;gap:22px;font:600 12px "Bahnschrift",Arial;letter-spacing:.14em;color:#b3ab95;text-transform:uppercase;margin-bottom:14px}
#menu .meta b{display:block;color:#efe8d4;font-size:14px;letter-spacing:.06em;margin-top:2px}
#menu .threat i{display:inline-block;width:14px;height:6px;margin-right:3px;background:#3a352b}
#menu .threat i.on{background:var(--acc,#c21f1f);box-shadow:0 0 6px var(--acc,#c21f1f)}
#menu .play{pointer-events:auto;display:inline-block;padding:12px 44px;font:900 26px Impact,"Arial Black",sans-serif;letter-spacing:.2em;color:#111;background:var(--acc,#c21f1f);border:none;cursor:pointer;box-shadow:0 0 24px var(--acc,#c21f1f);transition:transform .15s,filter .15s}
#menu .play:hover{transform:translateY(-2px) scale(1.03);filter:brightness(1.15)}
#menu .cards{position:absolute;left:5vw;right:5vw;bottom:5vh;display:flex;gap:18px;pointer-events:auto}
#menu .card{flex:1;min-width:0;padding:16px 18px 14px;background:linear-gradient(180deg,rgba(18,16,14,.72),rgba(8,7,6,.86));border:1px solid rgba(255,255,255,.12);border-top:3px solid var(--c);cursor:pointer;transition:transform .2s,background .2s,box-shadow .2s;backdrop-filter:blur(6px);position:relative;overflow:hidden}
#menu .card:hover{transform:translateY(-6px)}
#menu .card.sel{transform:translateY(-12px);box-shadow:0 0 34px -6px var(--c),inset 0 0 40px -18px var(--c);background:linear-gradient(180deg,rgba(28,24,20,.82),rgba(10,8,6,.9))}
#menu .card .no{font:700 11px "Bahnschrift",Arial;letter-spacing:.3em;color:var(--c)}
#menu .card .nm{font:900 clamp(20px,2.2vw,34px) Impact,"Arial Black",sans-serif;letter-spacing:.06em;margin:4px 0 4px;color:#f2ead6}
#menu .card .tg{font-size:12px;color:#aaa28d;min-height:32px}
#menu .card .st{margin-top:8px;font:600 11px "Bahnschrift",Arial;letter-spacing:.1em;color:#8f8874;text-transform:uppercase}
#menu .card .ld{position:absolute;left:0;bottom:0;height:2px;background:var(--c);width:0;transition:width .3s}
#menu .card.busy::after{content:'';position:absolute;left:0;bottom:0;height:2px;width:35%;background:var(--c);animation:zbusy 1.1s linear infinite;will-change:transform}
@keyframes zbusy{from{transform:translateX(-100%)}to{transform:translateX(300%)}}
#menu .tools{position:absolute;right:5vw;top:5vh;display:flex;gap:10px;pointer-events:auto}
#menu .tools button,#menu .modal button{background:rgba(10,10,10,.6);color:#d8d0bc;border:1px solid rgba(255,255,255,.25);padding:8px 16px;font:700 12px "Bahnschrift",Arial;letter-spacing:.2em;cursor:pointer;text-transform:uppercase}
#menu .tools button:hover,#menu .modal button:hover{background:rgba(255,255,255,.12)}
#menu .modal{position:absolute;inset:0;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;pointer-events:auto}
#menu .modal .box{width:min(640px,88vw);background:rgba(16,14,12,.96);border:1px solid rgba(255,255,255,.18);padding:26px 30px;max-height:84vh;overflow:auto}
#menu .modal h3{margin:0 0 14px;font:900 28px Impact,sans-serif;letter-spacing:.1em;color:#d8cfb8}
#menu .row{display:flex;align-items:center;justify-content:space-between;margin:10px 0;font:600 13px "Bahnschrift",Arial;letter-spacing:.08em}
#menu .row input[type=range]{width:220px;accent-color:var(--acc,#ff9a30)}#menu .row input[type=checkbox]{accent-color:var(--acc,#ff9a30);width:18px;height:18px}#menu .row select{background:#111;color:#ddd;border:1px solid #444;padding:4px}
#menu kbd{display:inline-block;min-width:22px;text-align:center;padding:2px 7px;border:1px solid #777;border-bottom-width:3px;border-radius:4px;background:#1b1a18;margin-right:6px;font:700 12px "Courier New",monospace}
#menu .load{position:absolute;inset:0;background:rgba(0,0,0,.94);display:none;flex-direction:column;align-items:center;justify-content:center;pointer-events:auto;text-align:center}
#menu .load .bar{width:min(520px,70vw);height:6px;background:#222;margin:18px 0}#menu .load .bar i{display:block;height:100%;width:0;background:var(--acc,#c21f1f);box-shadow:0 0 12px var(--acc,#c21f1f)}
#menu .load .t{font:900 44px Impact,sans-serif;letter-spacing:.12em}#menu .load .m{font:600 13px "Bahnschrift",Arial;letter-spacing:.3em;color:#9c957f;text-transform:uppercase}
#menu .load .go{margin-top:26px;display:none;font:900 22px Impact,sans-serif;letter-spacing:.3em;color:#fff;animation:blink 1.2s infinite}
@keyframes blink{50%{opacity:.35}}
`;
export class Menu {
  constructor({ gfx, synth, fx, audio, ui, onPlay, onOnline, onSettings }) {
    Object.assign(this, { gfx, synth, fx, audio, ui, onPlay, onOnline, onSettings }); this.heroes = {}; this.defs = {}; this.sel = 0; this.active = false; this.t = 0; this.camYaw = 0; this.hero = null; this.buildQueue = []; this.building = false;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.root = document.createElement('div'); this.root.id = 'menu'; ui.appendChild(this.root);
    this.root.innerHTML = `<div class="vig"></div><h1>DEAD<em> RIDE</em></h1><div class="sub">Four maps · Four vehicles · One long night</div>
      <div class="tools"><button data-a="home" title="Back to Survive the Night">◂ Survive the Night</button><button data-a="controls">Controls</button><button data-a="settings">Settings</button></div>
      <div class="info"></div><div class="cards"></div>
      <div class="modal" data-m="settings"><div class="box"><h3>SETTINGS</h3>
        <div class="row">Graphics quality<select id="s-q"><option>low</option><option>medium</option><option selected>high</option><option>ultra</option></select></div>
        <div class="row">Field of view (horizontal)<input id="s-fov" type="range" min="65" max="110" value="90"><span id="s-fov-v">90</span></div>
        <div class="row">Mouse sensitivity<input id="s-sens" type="range" min="0.3" max="3" step="0.05" value="1"><span id="s-sens-v">1.0</span></div>
        <div class="row">Master volume<input id="s-vol" type="range" min="0" max="1" step="0.05" value="0.8"></div>
        <div class="row">Show FPS counter (F3)<input id="s-fps" type="checkbox"></div>
        <div class="row">Dynamic resolution (keeps 60 fps on slow GPUs)<input id="s-dyn" type="checkbox" checked></div>
        <div style="text-align:right;margin-top:18px"><button data-a="close">Close</button></div></div></div>
      <div class="modal" data-m="controls"><div class="box"><h3>CONTROLS</h3>
        <div class="row"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</span><span><kbd>Shift</kbd> Sprint</span></div>
        <div class="row"><span><kbd>Mouse</kbd> Aim / Fire</span><span><kbd>RMB</kbd> Aim down sights</span></div>
        <div class="row"><span><kbd>R</kbd> Reload</span><span><kbd>V</kbd> Knife</span></div>
        <div class="row"><span><kbd>G</kbd> Frag grenade</span><span><kbd>1</kbd><kbd>2</kbd><kbd>Wheel</kbd> Swap weapon</span></div>
        <div class="row"><span><kbd>F</kbd> Buy / Use / Repair (hold)</span><span><kbd>Space</kbd> Jump · <kbd>C</kbd> Crouch</span></div>
        <div class="row"><span><kbd>F3</kbd> FPS / frame-time counter</span><span><kbd>Esc</kbd> Pause</span></div>
        <p style="color:#a9a18b;font-size:13px;line-height:1.5">Clear each wave, then step into the vehicle to ride to the next stop. Spend points on wall weapons, perk machines and the mystery box. Barricades slow the dead — hold <kbd>F</kbd> to rebuild them.</p>
        <div style="text-align:right;margin-top:18px"><button data-a="close">Close</button></div></div></div>
      <div class="load"><div class="t"></div><div class="bar"><i></i></div><div class="m"></div><div class="go">CLICK TO BEGIN</div></div>`;
    this.eInfo = this.root.querySelector('.info'); this.eCards = this.root.querySelector('.cards'); this.eLoad = this.root.querySelector('.load');
    this.root.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'home') location.href = '/'; else if (a === 'settings' || a === 'controls') this.root.querySelector(`[data-m=${a}]`).style.display = 'flex'; else if (a === 'close') this.root.querySelectorAll('.modal').forEach((m) => (m.style.display = 'none')); });
    const q = (id) => this.root.querySelector(id); const S = this.settings = { quality: 'high', fov: 90, sens: 1, vol: 0.8, fps: false, dyn: true };
    q('#s-q').onchange = (e) => { S.quality = e.target.value; gfx.setQuality(S.quality); }; q('#s-fov').oninput = (e) => { S.fov = +e.target.value; q('#s-fov-v').textContent = S.fov; onSettings?.(S); };
    q('#s-sens').oninput = (e) => { S.sens = +e.target.value; q('#s-sens-v').textContent = S.sens.toFixed(1); onSettings?.(S); }; q('#s-vol').oninput = (e) => { S.vol = +e.target.value; onSettings?.(S); };
    q('#s-fps').onchange = (e) => { S.fps = e.target.checked; onSettings?.(S); }; q('#s-dyn').onchange = (e) => { S.dyn = e.target.checked; gfx.dynRes = S.dyn; onSettings?.(S); };
    MAPS.forEach((m) => this.defs[m.id] = null);
    const unlock = async () => { try { await audio.init(); this.audioReady = true; this.menuAmbience(); } catch (e) { /* no audio */ } };
    addEventListener('pointerdown', unlock, { once: true }); addEventListener('keydown', unlock, { once: true });
  }
  uiSound(name, vol = 0.5) { if (this.audioReady) audio.play?.(name, { vol, bus: 'ui' }); }
  menuAmbience() { const st = this.hero?.world?.stops?.[0]; if (this.audioReady && st && this.active) { audio.setSpace?.(st.atmo.reverb, 0.5); if (st.ambient) audio.ambience?.set?.(st.ambient, 2.0); } }
  async init() {
    for (const m of MAPS) { try { this.defs[m.id] = await loadMap(m.id); } catch (e) { console.warn('map not available yet', m.id, e.message); this.defs[m.id] = null; } }
    this.cards = []; this.eCards.innerHTML = '';
    MAPS.forEach((m, i) => { const d = this.defs[m.id]; if (!d) return; const c = document.createElement('div'); c.className = 'card'; c.style.setProperty('--c', d.accent); c.innerHTML = `<div class="no">MAP 0${i + 1}</div><div class="nm">${d.name.toUpperCase()}</div><div class="tg">${d.tagline}</div><div class="st">${d.stops.length} stops · ${d.vehicleName}</div><div class="ld"></div>`; c.onclick = () => { this.uiSound('ui.click'); this.select(i); }; c.onmouseenter = () => { this.uiSound('ui.hover', 0.25); if (!this.locked && this.heroes[m.id]?.state === 'ready') this.preview(i); }; /* (building a hero is a 1-5 s main-thread task: only on click) */ this.eCards.appendChild(c); this.cards[i] = c; });
    const first = MAPS.findIndex((m) => this.defs[m.id]); this.select(Math.max(0, first));
  }
  select(i) {
    const m = MAPS[i], d = this.defs[m.id]; if (!d) return; this.sel = i; this.cards.forEach((c, k) => c?.classList.toggle('sel', k === i)); this.root.style.setProperty('--acc', d.accent);
    const stops = d.stops.map((s) => `<div class="n"><i></i>${s.name}</div>`).join('<div class="l"></div>');
    this.eInfo.innerHTML = `<h2>${d.name.toUpperCase()}</h2><p>${d.blurb}</p><div class="route">${stops}<span class="loop">↻</span></div>
      <div class="meta"><div>Vehicle<b>${d.vehicleName}</b></div><div>Undead<b>${d.zombieName}</b></div><div>Threat<b class="threat">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= d.threat ? 'on' : ''}"></i>`).join('')}</b></div></div>
      <div style="display:flex;gap:12px;align-items:stretch;flex-wrap:nowrap"><button class="play">PLAY ${d.name.toUpperCase()}</button><button class="play online" style="padding:12px 22px;font-size:20px;background:rgba(10,9,8,.7);color:var(--acc,#c21f1f);border:2px solid var(--acc,#c21f1f);box-shadow:none;white-space:nowrap">PLAY ONLINE</button></div>`;
    this.eInfo.querySelector('.play').onclick = () => { this.uiSound('ui.buy', 0.7); this.onPlay(m.id); };
    this.eInfo.querySelector('.play.online').onclick = () => { this.uiSound('ui.click', 0.7); this.onOnline?.(m.id); };
    this.preview(i);
  }
  preview(i) { const m = MAPS[i]; this.ensureHero(m.id, true); const h = this.heroes[m.id]; if (h && h.state === 'ready') this.setHero(m.id); this.previewId = m.id; }
  /** heroes are built one at a time in the background; the selected map gets priority */
  ensureHero(id, prio = false) { if (this.heroes[id] || !this.defs[id]) return; this.heroes[id] = { state: 'queued', world: null }; if (prio) this.buildQueue.unshift(id); else this.buildQueue.push(id); this.pump(); }
  async pump() {
    if (this.building) return; this.building = true;
    while (this.buildQueue.length) { const id = this.buildQueue.shift(); const h = this.heroes[id]; h.state = 'loading'; const idx = MAPS.findIndex((m) => m.id === id); const card = this.cards[idx]; const bar = card?.querySelector('.ld'); if (bar) bar.style.width = '40%'; card?.classList.add('busy'); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); /* (let the shimmer paint before the main thread blocks) */
      try { const w = new World(this.gfx, this.synth, this.fx); w.shown = false; w.root.visible = false; await w.loadMap(this.defs[id], () => {}, { heroOnly: true }); h.world = w; h.state = 'ready'; card?.classList.remove('busy'); if (bar) bar.style.width = '100%'; if (this.previewId === id || (!this.hero && this.active)) this.setHero(id); }
      catch (e) { console.error('hero build failed', id, e); h.state = 'failed'; card?.classList.remove('busy'); if (bar) bar.style.background = '#a22'; } await new Promise((r) => setTimeout(r, 30)); }
    this.building = false;
  }
  setHero(id) {
    const h = this.heroes[id]; if (!h || h.state !== 'ready') return; if (this.hero && this.hero !== h) this.hero.world.setShown(false); this.hero = h; this.heroId = id; h.world.setActive(0); h.world.setShown(this.active); this.menuAmbience(); this.gfx.resetExposure = true; this.camT = 0;
    const st = h.world.stops[0]; this.camBase = new THREE.Vector3(st.origin.x + st.playerStart.pos[0], st.origin.y + st.playerStart.pos[1] + 1.7, st.origin.z + st.playerStart.pos[2]); const lm = st.landmark?.pos || [0, 12, 0]; this.camLook = new THREE.Vector3(st.origin.x + lm[0], st.origin.y + Math.min(lm[1], 14), st.origin.z + lm[2]); this.fx.clearWorldFX?.();
  }
  show(v) { this.active = v; this.root.style.display = v ? 'block' : 'none'; if (this.hero) this.hero.world.setShown(v); }
  /** loading overlay control */
  loading(title, pct, msg, ready = false) { const L = this.eLoad; L.style.display = 'flex'; L.querySelector('.t').textContent = title; L.querySelector('.bar i').style.width = (pct * 100) + '%'; L.querySelector('.m').textContent = msg; L.querySelector('.go').style.display = ready ? 'block' : 'none'; }
  hideLoading() { this.eLoad.style.display = 'none'; }
  update(dt, t) {
    if (!this.active) return; this.t += dt; const h = this.hero; const cam = this.gfx.camera;
    if (h) {
      h.world.update(dt, t, cam.position); this.camT += dt; const k = this.camT;
      const dir = V.copy(this.camLook).sub(this.camBase); const base = Math.atan2(-dir.x, -dir.z); const yaw = base + Math.sin(k * 0.11) * 0.42; const pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) * 0.7 - 0.02 + Math.sin(k * 0.17) * 0.03;
      cam.position.copy(this.camBase); cam.position.x += Math.sin(k * 0.23) * 0.5; cam.position.y += Math.sin(k * 0.31) * 0.08; cam.rotation.set(pitch, yaw, Math.sin(k * 0.13) * 0.012, 'YXZ'); this.gfx.setFov(52); this.gfx.shadowCenter.copy(cam.position);
    } else { cam.position.set(0, 2, 0); cam.rotation.set(0, this.t * 0.05, 0); }
  }
}
const V = new THREE.Vector3();
