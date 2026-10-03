// DOM HUD (Black-Ops-2-Zombies style): round counter, points + popups, perks, ammo, crosshair, hit-markers, prompts, banners,
// damage arcs, power-up timers, fps/perf panel. System fonts only.
import { clamp, lerp } from '../core/util.js';
import { PERKS } from './props3d.js';

const CSS = `
#hud{position:fixed;inset:0;pointer-events:none;font-family:"Bahnschrift","Segoe UI",Roboto,Arial,sans-serif;color:#e9e4d8;text-shadow:0 1px 3px #000;display:none;z-index:5}
#hud .abs{position:absolute}
#hud-round{left:22px;bottom:14px;width:360px;height:118px;transition:transform .3s,opacity .3s;filter:drop-shadow(0 0 6px rgba(0,0,0,.9)) drop-shadow(0 0 14px rgba(170,0,0,.35))}
#hud-round.pulse{animation:rpulse 1.2s ease}
@keyframes rpulse{0%{transform:scale(1)}30%{transform:scale(1.35);color:#ff2a1a}100%{transform:scale(1)}}
#hud-points{left:34px;bottom:124px;font:800 34px "Bahnschrift","Segoe UI",Arial,sans-serif;color:#f4efe1;letter-spacing:1px}
#hud-points small{display:block;font-size:12px;letter-spacing:4px;color:#b9b19a;font-weight:600}
#hud-popups{left:200px;bottom:126px;width:160px;height:200px;overflow:hidden}
.pop{position:absolute;left:0;bottom:0;font:800 24px "Bahnschrift",Arial,sans-serif;color:#ffe680;opacity:0;animation:popup 1.1s ease-out forwards}
.pop.neg{color:#ff6a5a}
@keyframes popup{0%{transform:translateY(0);opacity:0}10%{opacity:1}100%{transform:translateY(-90px);opacity:0}}
#hud-perks{left:30px;bottom:186px;display:flex;gap:8px}
.perk{width:46px;height:46px;background-size:cover;filter:drop-shadow(0 2px 4px rgba(0,0,0,.75));animation:perkin .5s cubic-bezier(.2,1.6,.4,1)}@keyframes perkin{from{transform:scale(.2);opacity:0}to{transform:scale(1);opacity:1}}
#hud-ammo{right:36px;bottom:26px;text-align:right}
#hud-ammo .mag{font:900 76px "Bahnschrift","Segoe UI",Arial,sans-serif;line-height:.9;letter-spacing:-1px}
#hud-ammo .res{font:700 34px "Bahnschrift",Arial,sans-serif;color:#c8c1ae;margin-left:8px}
#hud-ammo .wname{font:700 15px "Bahnschrift",Arial,sans-serif;letter-spacing:4px;color:#b9b19a;text-transform:uppercase}
#hud-ammo .gren{font:700 20px "Bahnschrift",Arial,sans-serif;color:#d8d2c0;margin-top:6px}
#hud-ammo.low .mag{color:#ff5a3a}
#hud-cross{left:50%;top:50%;width:0;height:0}
#hud-cross i{position:absolute;background:rgba(255,255,255,.9);box-shadow:0 0 2px #000;width:2px;height:9px}
#hud-cross i.h{width:9px;height:2px}
#hud-cross b{position:absolute;left:-1.5px;top:-1.5px;width:3px;height:3px;border-radius:50%;background:#fff;box-shadow:0 0 2px #000}
#hud-hit{left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;opacity:0;transition:opacity .25s}
#hud-hit::before,#hud-hit::after{content:"";position:absolute;left:50%;top:50%;width:26px;height:3px;background:#fff;box-shadow:0 0 3px #000;transform:translate(-50%,-50%) rotate(45deg)}
#hud-hit::after{transform:translate(-50%,-50%) rotate(-45deg)}
#hud-hit.kill::before,#hud-hit.kill::after{background:#ff3a2a}
#hud-hit.on{opacity:1;transition:none}
#hud-prompt{left:50%;bottom:22%;transform:translateX(-50%);font:700 22px "Bahnschrift","Segoe UI",Arial,sans-serif;text-align:center;padding:6px 16px;background:rgba(0,0,0,.35);border-radius:4px;opacity:0;transition:opacity .15s;white-space:nowrap}
#hud-prompt.on{opacity:1}
#hud-prompt span{color:#ffd45a}
#hud-banner{left:50%;top:16%;transform:translateX(-50%);text-align:center;font:900 64px Impact,"Arial Black",sans-serif;color:#b01010;letter-spacing:4px;opacity:0;text-shadow:0 0 8px #000,0 0 30px rgba(190,0,0,.5)}
#hud-banner small{display:block;font:700 22px "Bahnschrift",Arial,sans-serif;color:#e8e2d0;letter-spacing:6px;margin-top:6px}
#hud-banner.on{animation:banner 3.2s ease forwards}
@keyframes banner{0%{opacity:0;transform:translateX(-50%) scale(1.6)}12%{opacity:1;transform:translateX(-50%) scale(1)}80%{opacity:1}100%{opacity:0}}
#hud-power{left:50%;bottom:110px;transform:translateX(-50%);display:flex;gap:14px}
.pu{font:800 16px "Bahnschrift",Arial,sans-serif;padding:4px 10px;border:2px solid;border-radius:5px;background:rgba(0,0,0,.45)}
#hud-arcs{position:absolute;inset:0;width:100%;height:100%}
#hud-fps{left:10px;top:8px;font:12px "Courier New",monospace;color:#9fff9f;background:rgba(0,0,0,.55);padding:6px 8px;border-radius:4px;white-space:pre;display:none;line-height:1.35}
#hud-graph{left:10px;top:118px;width:240px;height:52px;background:rgba(0,0,0,.5);display:none;border:1px solid #244}
#hud-stop{right:24px;top:18px;text-align:right;font:700 16px "Bahnschrift",Arial,sans-serif;letter-spacing:3px;color:#cfc8b4;text-transform:uppercase}
#hud-stop small{display:block;font-size:12px;color:#9c957f;letter-spacing:2px}
#hud-boss{left:50%;top:26px;transform:translateX(-50%);font:700 14px "Bahnschrift",Arial,sans-serif;color:#e8e2d0;letter-spacing:2px}
`;
export class HUD {
  constructor(root) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.root = document.createElement('div'); this.root.id = 'hud'; root.appendChild(this.root);
    const mk = (id, cls = 'abs', html = '') => { const d = document.createElement('div'); d.id = id; d.className = cls; d.innerHTML = html; this.root.appendChild(d); return d; };
    this.arcs = document.createElement('canvas'); this.arcs.id = 'hud-arcs'; this.root.appendChild(this.arcs); this.actx = this.arcs.getContext('2d');
    this.eRound = document.createElement('canvas'); this.eRound.id = 'hud-round'; this.eRound.className = 'abs'; this.eRound.width = 720; this.eRound.height = 236; this.root.appendChild(this.eRound); this.rctx = this.eRound.getContext('2d'); this.roundN = 0; this.tallyT = 9; this.ePoints = mk('hud-points', 'abs', '<span class="v">500</span><small>POINTS</small>'); this.ePopups = mk('hud-popups'); this.ePerks = mk('hud-perks');
    this.eAmmo = mk('hud-ammo', 'abs', '<div class="wname"></div><div><span class="mag">8</span><span class="res">/ 80</span></div><div class="gren"></div>');
    this.eCross = mk('hud-cross', 'abs', '<b></b><i class="h" style="left:-14px;top:-1px"></i><i class="h" style="left:5px;top:-1px"></i><i style="left:-1px;top:-14px"></i><i style="left:-1px;top:5px"></i>');
    this.eHit = mk('hud-hit'); this.ePrompt = mk('hud-prompt'); this.eBanner = mk('hud-banner'); this.ePower = mk('hud-power'); this.eFps = mk('hud-fps'); this.eStop = mk('hud-stop');
    this.eGraph = document.createElement('canvas'); this.eGraph.id = 'hud-graph'; this.eGraph.className = 'abs'; this.eGraph.width = 240; this.eGraph.height = 52; this.root.appendChild(this.eGraph); this.gctx = this.eGraph.getContext('2d');
    this.crossSpread = 0; this.hitT = 0; this.points = 0; this.shownPoints = 0; this.perkEls = {}; this.powerEls = {};
    this.resize(); addEventListener('resize', () => this.resize());
  }
  resize() { this.arcs.width = innerWidth; this.arcs.height = innerHeight; }
  show(v) { this.root.style.display = v ? 'block' : 'none'; }
  setRound(n, pulse = true) { this.roundN = n; this.tallyT = pulse ? 0 : 9; this.drawTally(); if (pulse) { this.eRound.classList.remove('pulse'); void this.eRound.offsetWidth; this.eRound.classList.add('pulse'); } }
  /** BO2-style blood-red brush-stroke tally marks: groups of five (four bars + diagonal); numeral past 25. The newest stroke animates in. */
  drawTally() {
    const c = this.rctx, W = 720, H = 236; c.clearRect(0, 0, W, H); const n = this.roundN; if (n <= 0) return;
    const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    const stroke = (x0, y0, x1, y1, w, seed, k) => { // dry-brush stroke with ragged bristles + drip
      const tx = x0 + (x1 - x0) * k, ty = y0 + (y1 - y0) * k;
      for (let b = 0; b < 7; b++) { const o = (b - 3) * w * 0.16, jx = (rnd(seed + b) - 0.5) * 5, jy = (rnd(seed * 3 + b) - 0.5) * 6; c.beginPath(); c.moveTo(x0 + o + jx, y0 + jy); c.quadraticCurveTo((x0 + tx) / 2 + o + jy, (y0 + ty) / 2 + jx, tx + o * 0.7, ty); c.lineWidth = w * (0.34 - Math.abs(b - 3) * 0.035); c.strokeStyle = b % 2 ? '#7d0a0a' : '#a41010'; c.globalAlpha = 0.85; c.lineCap = 'round'; c.stroke(); }
      c.globalAlpha = 1; if (k >= 1 && rnd(seed) > 0.45) { const dx = x1 + (rnd(seed + 9) - 0.5) * 8, len = 8 + rnd(seed + 5) * 22; c.beginPath(); c.moveTo(dx, y1); c.lineTo(dx, y1 + len); c.lineWidth = 3.2; c.strokeStyle = '#7d0a0a'; c.stroke(); }
    };
    if (n > 25) { c.font = '900 190px Impact, "Arial Black", sans-serif'; c.textBaseline = 'alphabetic'; c.lineWidth = 8; c.strokeStyle = '#2a0000'; c.strokeText(String(n), 24, 200); c.fillStyle = '#a00e0e'; c.fillText(String(n), 24, 200); return; }
    const groups = Math.ceil(n / 5); const gw = 138, base = 208, top = 34; let made = 0;
    for (let g = 0; g < groups; g++) {
      const cnt = Math.min(5, n - g * 5), gx = 26 + (g % 5) * gw;
      for (let i = 0; i < Math.min(4, cnt); i++) { made++; const last = made === n; const k = last ? Math.min(1, this.tallyT / 0.45) : 1; const x = gx + i * 26 + (rnd(made) - 0.5) * 4; stroke(x, top + rnd(made + 7) * 10, x + (rnd(made + 3) - 0.5) * 12, base - rnd(made + 2) * 10, 17, made * 13, k); }
      if (cnt === 5) { made++; const last = made === n; const k = last ? Math.min(1, this.tallyT / 0.45) : 1; stroke(gx - 14, base - 22, gx + 118, top + 20, 18, made * 13, k); }
    }
  }
  setPoints(p) { this.points = p; }
  popup(text, neg = false) { const d = document.createElement('div'); d.className = 'pop' + (neg ? ' neg' : ''); d.textContent = text; d.style.left = (Math.random() * 60) + 'px'; this.ePopups.appendChild(d); setTimeout(() => d.remove(), 1200); }
  /** perk icons: canvas-drawn bottle glyphs (cached per perk) in a rounded plate, BO2-style */
  _perkIcon(k) {
    this._icons = this._icons || {}; if (this._icons[k]) return this._icons[k];
    const S = 96, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), P = PERKS[k], hex = (c) => '#' + c.toString(16).padStart(6, '0');
    const base = hex(P.color), light = hex(P.glow), trim = hex(P.trim);
    const grad = g.createLinearGradient(0, 0, 0, S); grad.addColorStop(0, light); grad.addColorStop(0.55, base); grad.addColorStop(1, '#000'); g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, 7); g.fill();
    g.fillStyle = grad; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 7, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3; g.stroke();
    g.save(); g.translate(S / 2, S / 2); g.fillStyle = trim; g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 2.2; g.lineJoin = 'round';
    const bottle = () => { g.beginPath(); g.moveTo(-6, -30); g.lineTo(6, -30); g.lineTo(6, -20); g.bezierCurveTo(6, -12, 17, -8, 17, 4); g.lineTo(17, 24); g.quadraticCurveTo(17, 30, 11, 30); g.lineTo(-11, 30); g.quadraticCurveTo(-17, 30, -17, 24); g.lineTo(-17, 4); g.bezierCurveTo(-17, -8, -6, -12, -6, -20); g.closePath(); g.fill(); g.stroke(); g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(-7, -34, 14, 6); g.fillStyle = trim; };
    if (k === 'juggernog') { bottle(); g.fillStyle = base; g.fillRect(-17, 6, 34, 14); g.fillStyle = trim; g.font = '900 13px Impact, sans-serif'; g.textAlign = 'center'; g.fillText('JUG', 0, 17); }
    else if (k === 'speedcola') { bottle(); g.fillStyle = base; g.beginPath(); g.moveTo(-3, -4); g.lineTo(9, -4); g.lineTo(2, 8); g.lineTo(10, 8); g.lineTo(-8, 26); g.lineTo(-3, 11); g.lineTo(-10, 11); g.closePath(); g.fill(); }
    else if (k === 'doubletap') { bottle(); g.fillStyle = base; g.font = '900 30px Impact, sans-serif'; g.textAlign = 'center'; g.fillText('2', 0, 22); g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(-10, -2, 20, 2); }
    else if (k === 'quickrevive') { g.beginPath(); g.arc(0, 0, 25, 0, 7); g.fillStyle = trim; g.fill(); g.stroke(); g.fillStyle = base; g.fillRect(-6, -19, 12, 38); g.fillRect(-19, -6, 38, 12); }
    else { bottle(); g.fillStyle = base; g.beginPath(); g.moveTo(-9, 24); g.lineTo(0, 0); g.lineTo(9, 24); g.lineTo(4, 24); g.lineTo(0, 12); g.lineTo(-4, 24); g.closePath(); g.fill(); g.beginPath(); g.moveTo(-9, 0); g.lineTo(0, -12); g.lineTo(9, 0); g.lineTo(5, 0); g.lineTo(0, -6); g.lineTo(-5, 0); g.closePath(); g.fill(); }
    g.restore(); return (this._icons[k] = cv.toDataURL('image/png'));
  }
  setPerks(set) { for (const k of Object.keys(PERKS)) { const has = set.has(k); if (has && !this.perkEls[k]) { const d = document.createElement('div'); d.className = 'perk'; d.style.backgroundImage = `url(${this._perkIcon(k)})`; d.title = PERKS[k].name; this.ePerks.appendChild(d); this.perkEls[k] = d; } else if (!has && this.perkEls[k]) { this.perkEls[k].remove(); delete this.perkEls[k]; } } }
  setAmmo(name, mag, reserve, gren, magSize) { const e = this.eAmmo; e.querySelector('.wname').textContent = name; e.querySelector('.mag').textContent = mag; e.querySelector('.res').textContent = '/ ' + reserve; e.querySelector('.gren').textContent = gren !== undefined ? '● '.repeat(gren) : ''; e.classList.toggle('low', mag <= Math.max(1, Math.floor(magSize * 0.25))); }
  prompt(html) { if (html) { this.ePrompt.innerHTML = html; this.ePrompt.classList.add('on'); } else this.ePrompt.classList.remove('on'); }
  banner(title, sub = '') { const b = this.eBanner; b.innerHTML = `${title}<small>${sub}</small>`; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
  hitmarker(kill = false) { const h = this.eHit; h.classList.toggle('kill', kill); h.classList.add('on'); clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('on'), 70); }
  setStop(name, sub) { this.eStop.innerHTML = `${name}<small>${sub}</small>`; }
  setPower(kind, name, color, secs) { let e = this.powerEls[kind]; if (secs <= 0) { if (e) { e.remove(); delete this.powerEls[kind]; } return; } if (!e) { e = document.createElement('div'); e.className = 'pu'; e.style.borderColor = e.style.color = '#' + color.toString(16).padStart(6, '0'); this.ePower.appendChild(e); this.powerEls[kind] = e; } e.textContent = `${name} ${Math.ceil(secs)}`; }
  setCrosshair(spreadPx, visible = true) { this.crossSpread = spreadPx; const k = this.eCross; k.style.display = visible ? 'block' : 'none'; const [l, r, u, d] = [...k.querySelectorAll('i')]; l.style.left = -(5 + spreadPx + 9) + 'px'; r.style.left = (5 + spreadPx) + 'px'; u.style.top = -(5 + spreadPx + 9) + 'px'; d.style.top = (5 + spreadPx) + 'px'; }
  drawArcs(player, dt) {
    const c = this.actx, W = this.arcs.width, H = this.arcs.height; c.clearRect(0, 0, W, H); if (!player.hitDir.length) return;
    const yaw = player.worldYaw; for (const h of player.hitDir) { const ang = Math.atan2(-(h.x - player.pos.x), -(h.z - player.pos.z)) - yaw; const a = clamp(h.t / 1.4); c.save(); c.translate(W / 2, H / 2); c.rotate(-ang); c.strokeStyle = `rgba(200,10,10,${a * 0.9})`; c.lineWidth = 22; c.lineCap = 'round'; c.beginPath(); c.arc(0, 0, Math.min(W, H) * 0.36, -Math.PI / 2 - 0.35, -Math.PI / 2 + 0.35); c.stroke(); c.restore(); }
  }
  update(dt) { if (this.tallyT < 1) { this.tallyT += dt; this.drawTally(); } this.shownPoints = lerp(this.shownPoints, this.points, 1 - Math.exp(-14 * dt)); if (Math.abs(this.shownPoints - this.points) < 1) this.shownPoints = this.points; this.ePoints.querySelector('.v').textContent = Math.round(this.shownPoints); }
  perf(text, ft) {
    if (!this.perfOn) return; this.eFps.textContent = text;
    const g = this.gctx, W = 240, H = 52; g.clearRect(0, 0, W, H); g.strokeStyle = '#2f5'; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(0, H - 16.7 * (H / 40)); g.lineTo(W, H - 16.7 * (H / 40)); g.stroke(); g.globalAlpha = 1;
    for (let i = 0; i < ft.length; i++) { const v = ft[i]; g.fillStyle = v > 16.9 ? '#f44' : '#4f8'; g.fillRect(i * (W / ft.length), H - Math.min(H, v * (H / 40)), Math.max(1, W / ft.length), Math.min(H, v * (H / 40))); }
  }
  setPerf(on) { this.perfOn = on; this.eFps.style.display = on ? 'block' : 'none'; this.eGraph.style.display = on ? 'block' : 'none'; }
}
