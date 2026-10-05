// Where a frame's time goes (docs/performance.md), in one of the benchmark's scenes, with the frame rate capped (the
// real GPU, vsync on: lib.js launchChrome's gpu: true and nothing more):
//   - the CPU side: Chrome's sampling profiler over a few seconds of frames, as self time per function (an
//     unminified build is made for it, and the normal one put back after);
//   - by ablation: the same scene with one thing taken away at a time - the game's update, the drawing, the shadows,
//     the dead, the static world, the trees and grass, the screen passes, the HUD, half the pixels - and the
//     JavaScript and GPU time per frame each leaves.
//
// usage: node scripts/perf/profile.js [--scene island|island-horde|street|street-horde|roof|shop] [--seconds 4] [--top 45] [--no-cpu] [--tree <dir>]
import { execFileSync } from 'node:child_process';
import { join as pjoin, resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { REPO, parseArgs, sleep, startGame, launchChrome, LIFE_MAX } from '../clip/lib.js';
import { SEED, SPOT, DAY, NIGHT, baitOf, joinBot, INSTRUMENT, chat, throttle, loadMenu, join, stand, flashlight, summarize } from './lib.js';

const args = parseArgs(process.argv.slice(2), { scene: 'island-horde', seconds: '4', top: '45', tree: REPO });
const TREE = resolve(String(args.tree));
const vite = (extra) => execFileSync(process.execPath, [pjoin(TREE, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', ...extra], { cwd: TREE, stdio: 'ignore' });
const mainland = /street|roof|shop/.test(args.scene);
const horde = /horde/.test(args.scene);
const night = /night/.test(args.scene);
const S = SPOT[args.scene.replace(/-horde|-night/g, '')] || SPOT.island;

let game = null, chrome = null, bait = null;
try {
  if (!args['no-cpu']) vite(['--minify', 'false']);
  game = await startGame(TREE, { seed: SEED, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
  chrome = await launchChrome({ width: 1280, height: 720, gpu: true, life: LIFE_MAX, storage: { 'stn.settings': JSON.stringify({ quality: 'high', renderScale: 1 }), 'stn.character': '3', 'stn.name': 'profile' } });
  const page = chrome.page;
  page.on('pageerror', (e) => console.error('  page:', String(e).slice(0, 200)));
  await page.evaluateOnNewDocument(INSTRUMENT);
  await loadMenu(page, game.url);
  await join(page);
  bait = await joinBot(game.url, 'bait', 5);
  if (mainland) {
    await chat(page, '/cross skip');
    for (let i = 0; i < 400 && !(await page.evaluate(() => window.__game.act === 2 && !window.__game.warm && window.__game.global.phase !== 5)); i++) await sleep(100);
    await sleep(3000);
  }
  await stand(page, S, night ? NIGHT : DAY);
  if (night) await flashlight(page, true);
  const bp = baitOf(S, horde ? 18 : 150);
  bait.tp(bp[0], bp[1]);
  await sleep(2500);
  if (horde) {
    for (let k = 0; k < 10; k++) {
      bait.face(S.yaw + ((k % 5) - 2) * 0.55);
      await sleep(260);
      bait.chat(`/spawn ${k % 4 === 2 ? 'runner' : 'walker'} 20`);
      await sleep(240);
    }
    await sleep(14000);
  }
  await sleep(1500);
  const frames = async (label, secs = +args.seconds) => {
    await throttle(page, 0);
    await sleep(500);
    await page.evaluate(() => window.__bench.start());
    await sleep(secs * 1000);
    const R = await page.evaluate(() => window.__bench.stop());
    const c = await page.evaluate(() => window.__bench.counts());
    await throttle(page, 16);
    const s = summarize(R);
    console.log(`${label.padEnd(34)} js ${s.jsMs.toFixed(2).padStart(6)} ms   gpu ${(s.gpuMs ?? NaN).toFixed(2).padStart(6)} ms   calls ${String(c.calls).padStart(5)}  tris ${(c.tris / 1e6).toFixed(2)}M  (${s.fps.toFixed(0)} fps)`);
    return s;
  };
  console.log(`scene ${args.scene}, 1280 x 720, High, the dead: ${JSON.stringify(await page.evaluate(() => window.__bench.zombies()))}`);
  await frames('the scene as it is');
  // ---- the CPU profile
  if (!args['no-cpu']) {
    const cdp = await page.createCDPSession();
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await throttle(page, 0);
    await cdp.send('Profiler.start');
    await sleep(+args.seconds * 1000);
    const { profile } = await cdp.send('Profiler.stop');
    await throttle(page, 16);
    const frames0 = await page.evaluate(() => window.__bench.frames);
    await sleep(1000);
    const self = new Map();
    const dt = profile.timeDeltas;
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    let total = 0;
    profile.samples.forEach((id, i) => {
      const n = byId.get(id);
      const f = n.callFrame;
      const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) || 0) + dt[i]);
      total += dt[i];
    });
    const rows = [...self].sort((a, b) => b[1] - a[1]);
    const idle = rows.filter(([k]) => /^\((idle|program|garbage collector)\)/.test(k));
    console.log(`\nCPU self time over ${(total / 1e6).toFixed(1)} s (${frames0} frames so far in the page):`);
    for (const [k, v] of idle) console.log(`  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
    const busy = total - idle.filter(([k]) => /idle/.test(k)).reduce((a, r) => a + r[1], 0);
    for (const [k, v] of rows.filter(([k]) => !/^\(idle\)/.test(k)).slice(0, +args.top)) console.log(`  ${((v / busy) * 100).toFixed(1).padStart(5)}% of busy  ${k}`);
    mkdirSync(pjoin(REPO, 'shots', 'perf'), { recursive: true });
    writeFileSync(pjoin(REPO, 'shots', 'perf', `profile-${args.scene}.cpuprofile`), JSON.stringify(profile));
    await cdp.detach().catch(() => {});
  }
  // ---- one frame's draw calls, by what is drawn and in which pass
  await throttle(page, 0);
  const who = await page.evaluate(
    () =>
      new Promise((done) => {
        const r = window.__game.renderer.renderer;
        const own = r.renderBufferDirect;
        const tally = {};
        r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
          let top = object;
          while (top.parent && !top.parent.isScene) top = top.parent;
          const pass = scene === null ? 'shadow' : camera.isOrthographicCamera ? 'post' : camera === window.__game.renderer.vmCamera ? 'hands' : 'view';
          const what = pass === 'post' ? material.type : top.name || (object.isInstancedMesh ? 'instanced:' + (object.material.name || object.geometry.type) : object.type + ':' + (material.name || material.type));
          const k = pass + ' ' + what;
          tally[k] = (tally[k] || 0) + 1;
          return own.call(this, camera, scene, geometry, material, object, group);
        };
        requestAnimationFrame(() => {
          for (const k in tally) delete tally[k];
          requestAnimationFrame(() => {
            r.renderBufferDirect = own;
            done(tally);
          });
        });
      }),
  );
  await throttle(page, 16);
  const rowsW = Object.entries(who).sort((a, b) => b[1] - a[1]);
  console.log(`\none frame's ${rowsW.reduce((a, r) => a + r[1], 0)} draw calls: ` + rowsW.map(([k, v]) => `${v} ${k}`).join(' | '));
  // ---- ablations
  console.log('\nwith one thing taken away:');
  const ab = async (label, on, off) => {
    await page.evaluate(on);
    await sleep(900);
    await frames(label, 2.5);
    await page.evaluate(off);
    await sleep(300);
  };
  await ab('no game update (drawing only)', () => { const g = window.__game; g.__u = g.update; g.update = () => {}; }, () => { const g = window.__game; g.update = g.__u; });
  await ab('no drawing (update only)', () => { const r = window.__game.renderer; r.__r = r.render; r.render = () => {}; }, () => { const r = window.__game.renderer; r.render = r.__r; });
  await ab('no HUD (the DOM hidden)', () => (document.getElementById('ui').style.display = 'none'), () => (document.getElementById('ui').style.display = ''));
  await ab('no dead, no survivors', () => { for (const e of window.__game.entities.ents.values()) if (e.view?.object) e.view.object.visible = false; }, () => { for (const e of window.__game.entities.ents.values()) if (e.view?.object) e.view.object.visible = true; });
  await ab('no static world', () => (window.__game.staticWorld.group.visible = false), () => (window.__game.staticWorld.group.visible = true));
  await ab('no static shadow casters', () => (window.__game.staticWorld.casters.visible = false), () => (window.__game.staticWorld.casters.visible = true));
  await ab('no trees, bushes, rocks, grass', () => { const s = window.__game.renderer.scene; window.__hid = s.children.filter((o) => o.isInstancedMesh && o.visible); window.__hid.forEach((o) => (o.visible = false)); }, () => window.__hid.forEach((o) => (o.visible = true)));
  await ab('no terrain', () => { const s = window.__game.renderer.scene; window.__hid = s.children.filter((o) => /terrain/i.test(o.name) && o.visible); window.__hid.forEach((o) => (o.visible = false)); window.__hidN = window.__hid.length; }, () => window.__hid.forEach((o) => (o.visible = true)));
  await ab('no shadow maps at all', () => { const R = window.__game.renderer; R.__sd = R._shadowsDue; R._shadowsDue = () => false; }, () => { const R = window.__game.renderer; R._shadowsDue = R.__sd; });
  await ab('no hands', () => (window.__game.renderer.vmScene.visible = false), () => (window.__game.renderer.vmScene.visible = true));
  await ab('half the pixels each way', () => window.__game.renderer.setRenderScale(0.5), () => window.__game.renderer.setRenderScale(1));
  await ab('quality Low (no MSAA, AO, shafts, bloom, shadows)', () => { const g = window.__game; g.renderer.setQuality('low'); g.env.setShadows(g.renderer.q); g.lights.setShadows(false, false); }, () => { const g = window.__game; g.renderer.setQuality('high'); g.env.setShadows(g.renderer.q); g.lights.setShadows(true, true); });
  const kids = await page.evaluate(() => {
    const s = window.__game.renderer.scene;
    const by = {};
    let n = 0, vis = 0;
    s.traverse((o) => {
      n++;
      if (o.visible) vis++;
    });
    for (const o of s.children) by[o.name || o.type] = (by[o.name || o.type] || 0) + 1;
    return { objects: n, visible: vis, top: by };
  });
  console.log('\nthe world scene:', JSON.stringify(kids));
} finally {
  bait?.close();
  await chrome?.close().catch((e) => console.error(String(e)));
  game?.stop();
  if (!args['no-cpu']) vite([]);
}
