// Zombie motion quality (server: GODMODE=1 DEV_ADMIN=1): spawns a mixed pack that chases the player while it
// backs off and strafes, records every posed zombie within 30 m each frame (bone world positions, interpolation and
// gait state), and prints jitter metrics: stalls, velocity kinks, high-frequency wobble, planted-foot slip, hip pops.
// Optionally delays snapshots like a bumpy connection (ordered, latency + uniform jitter + a rare stall).
// usage: node scripts/e2e-motion.js [url] [seconds] [jitterMs] [latencyMs]
import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:3000';
const SECS = +(process.argv[3] || 15);
const JIT = +(process.argv[4] || 0);
const LAT = +(process.argv[5] || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.evaluateOnNewDocument((JIT, LAT) => {
  if (!JIT && !LAT) return;
  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    set onmessage(fn) {
      let lastAt = 0;
      super.onmessage = (m) => {
        const now = performance.now();
        const at = Math.max(lastAt, now + LAT + Math.random() * JIT + (Math.random() < 0.01 ? JIT * 3 : 0));
        lastAt = at;
        setTimeout(() => fn(m), at - now);
      };
    }
  };
}, JIT, LAT);
await page.goto(url, { waitUntil: 'load' });
await sleep(2500);
await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent)).click());
await sleep(4000);
await page.evaluate(() => { const g = window.__game; g.input.locked = true; g.input.enabled = true; g.input.requestLock = () => {}; g.input.handlers.onLockChange = () => {}; g.ui.showPause(false); });
const chat = (t) => page.evaluate((t) => window.__game.conn.chat(t), t);
await chat('/spawn 0 12');
await chat('/spawn 1 4');
await sleep(500);
await page.evaluate((SECS) => {
  const g = window.__game;
  const E = g.entities;
  const BONES = [2, 6, 11, 15, 18, 21]; // hips, head, hands, feet
  const rec = (window.__rec = { frames: [], start: g.time });
  const orig = E.update.bind(E);
  E.update = function (dt, renderTick, time, camPos) {
    for (const e of E.ents.values()) {
      const inst = e.kind === 2 && e.view?._inst;
      if (!inst) continue;
      if (!inst.__wrapped) {
        const cp = inst.computePose;
        inst.computePose = function () { this.__posed = true; return cp.call(this); };
        inst.__wrapped = true;
      }
      inst.__posed = false;
    }
    orig(dt, renderTick, time, camPos);
    if (g.time - rec.start > SECS) return;
    const fr = { t: g.time, z: [] };
    for (const e of E.ents.values()) {
      if (e.kind !== 2 || !e.view || e.dead || !e.view._inst.__posed) continue;
      if (Math.hypot(e.rx - camPos.x, e.rz - camPos.z) > 30) continue;
      const inst = e.view._inst;
      inst._solve();
      inst.poseDirty = true; // the render still uploads it
      inst.mesh.updateWorldMatrix(true, false);
      const m = inst.mesh.matrixWorld.elements, W = inst.world, b = [];
      for (const i of BONES) {
        const o = i * 12, x = W[o + 9], y = W[o + 10], z = W[o + 11];
        b.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      const k = inst.gOn && inst.gk;
      // flat: stance feet between heel-strike roll-in and heel-off (the ankle must not move); stand: static stance pins
      const flat = k ? [0, 1].reduce((f, i) => f | (k.stance[i] && k.x[i] / k.D[i] > k.G.rollIn && k.x[i] / k.D[i] < k.G.heelOff ? 1 << i : 0), 0) : 0;
      const stand = inst.standOn && inst.stand ? (inst.stand.u[0] < 0 ? 1 : 0) | (inst.stand.u[1] < 0 ? 2 : 0) : 0;
      fr.z.push({ id: e.id, a: e.q[4], x: e.rx, y: e.ry, z: e.rz, b, flat, stand, fade: inst.fadeT < inst.fadeDur });
    }
    rec.frames.push(fr);
  };
}, SECS);
const t0 = Date.now();
while (Date.now() - t0 < SECS * 1000 + 500) {
  const phase = Math.floor((Date.now() - t0) / 3000) % 4;
  await page.evaluate((phase) => (window.__game.input.yaw += phase % 2 ? 0.25 : -0.25), phase);
  const key = ['KeyS', 'KeyA', '', 'KeyD'][phase];
  if (key) {
    await page.keyboard.down(key);
    await sleep(700);
    await page.keyboard.up(key);
  }
  await sleep(300);
}
const rec = await page.evaluate(() => window.__rec);
await browser.close();

const tracks = new Map();
for (const fr of rec.frames) for (const z of fr.z) {
  if (!tracks.has(z.id)) tracks.set(z.id, []);
  tracks.get(z.id).push({ ...z, t: fr.t });
}
const S = { kink: [], rootV: [], wobHips: [], wobHead: [], wobHand: [], flat: [], stand: [], hip: [] };
let moving = 0, stalled = 0;
const dist = (c, p, o) => Math.hypot(c.b[o] - p.b[o], c.b[o + 2] - p.b[o + 2]);
for (const tr of tracks.values()) {
  for (let i = 1; i < tr.length; i++) {
    const c = tr[i], p = tr[i - 1], dt = c.t - p.t;
    if (dt > 0.02) continue; // not consecutive (culled in between)
    const v = Math.hypot(c.x - p.x, c.z - p.z) / dt;
    S.rootV.push(v);
    if (c.a === 1 || c.a === 2) {
      moving++;
      if (v < 0.15) stalled++;
    }
    S.hip.push(Math.hypot(c.b[0] - p.b[0] - (c.x - p.x), c.b[1] - p.b[1] - (c.y - p.y), c.b[2] - p.b[2] - (c.z - p.z)) / dt);
    for (const [fi, bit] of [[12, 1], [15, 2]]) {
      if (c.fade || p.fade) continue;
      if (c.flat & p.flat & bit) S.flat.push(dist(c, p, fi) / dt);
      if (c.stand & p.stand & bit) S.stand.push(dist(c, p, fi) / dt);
    }
    const q = tr[i - 2];
    if (q && p.t - q.t < 0.02) S.kink.push(Math.hypot((c.x - p.x) / dt - (p.x - q.x) / (p.t - q.t), (c.z - p.z) / dt - (p.z - q.z) / (p.t - q.t)));
  }
  // wobble: distance (cm) from the centered 11-frame average - the jitter the eye sees, not the gait itself
  for (let i = 5; i < tr.length - 5; i++) {
    if (tr[i + 5].t - tr[i - 5].t > 0.2) continue;
    const w = (o) => {
      let x = 0, y = 0, z = 0;
      for (let j = i - 5; j <= i + 5; j++) (x += tr[j].b[o]), (y += tr[j].b[o + 1]), (z += tr[j].b[o + 2]);
      return 100 * Math.hypot(tr[i].b[o] - x / 11, tr[i].b[o + 1] - y / 11, tr[i].b[o + 2] - z / 11);
    };
    S.wobHips.push(w(0));
    S.wobHead.push(w(3));
    S.wobHand.push(Math.max(w(6), w(9)));
  }
}
const pct = (a, q) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN);
const row = (name, a, unit) => console.log(`${name.padEnd(26)} p50 ${pct(a, 0.5).toFixed(2).padStart(6)}  p99 ${pct(a, 0.99).toFixed(2).padStart(6)}  max ${pct(a, 1).toFixed(2).padStart(7)} ${unit}`);
console.log(`${tracks.size} zombies, ${rec.frames.length} frames, network jitter ${JIT} ms latency ${LAT} ms`);
console.log(`moving but stalled: ${((100 * stalled) / Math.max(1, moving)).toFixed(1)}% of walking/running frames`);
row('root speed', S.rootV, 'm/s');
row('root velocity kink', S.kink, 'm/s per frame');
row('hips wobble', S.wobHips, 'cm');
row('head wobble', S.wobHead, 'cm');
row('hand wobble', S.wobHand, 'cm');
row('hips vs root', S.hip, 'm/s');
row('flat stance foot slip', S.flat, 'm/s');
row('standing foot slip', S.stand, 'm/s');
console.log('errors', errors.length, errors.slice(0, 3));
