// Where the GPU's share of a frame goes: one of the benchmark's scenes drawn UNCAPPED (lib.js launchChrome's
// perf: true: 1920 x 1080, vsync and the frame limit off - one short browser) with one thing taken away at a time,
// and the frame rate each leaves. Only uncapped does the frame rate say what a thing costs; scripts/perf/profile.js
// does the CPU side with the cap on.
// usage: node scripts/perf/ablate.js [--scene island|street|roof|shop] [--seconds 2.5]
import { REPO, parseArgs, sleep, startGame, launchChrome } from '../clip/lib.js';
import { SEED, SPOT, DAY, INSTRUMENT, chat, throttle, loadMenu, join, stand, summarize } from './lib.js';

const args = parseArgs(process.argv.slice(2), { scene: 'island', seconds: '2.5' });
const mainland = /street|roof|shop|airfield/.test(args.scene);
let game = null, chrome = null;
try {
  game = await startGame(REPO, { seed: SEED, build: true, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
  chrome = await launchChrome({ width: 1920, height: 1080, gpu: true, perf: true, life: 3 * 60_000, storage: { 'stn.settings': JSON.stringify({ quality: 'high', renderScale: 1 }), 'stn.character': '3', 'stn.name': 'ablate' } });
  const page = chrome.page;
  page.on('pageerror', (e) => console.error('  page:', String(e.stack || e).slice(0, 400)));
  await page.evaluateOnNewDocument(INSTRUMENT);
  await loadMenu(page, game.url);
  await join(page);
  if (mainland) {
    await chat(page, '/cross skip');
    for (let i = 0; i < 400 && !(await page.evaluate(() => window.__game.act === 2 && !window.__game.warm && window.__game.global.phase !== 5)); i++) await sleep(100);
    await sleep(3000);
  }
  await stand(page, SPOT[args.scene] || SPOT.island, DAY);
  await sleep(4000);
  const frames = async (label) => {
    await throttle(page, 0);
    await sleep(500);
    await page.evaluate(() => window.__bench.start());
    await sleep(+args.seconds * 1000);
    const s = summarize(await page.evaluate(() => window.__bench.stop()));
    const c = await page.evaluate(() => window.__bench.counts());
    await throttle(page, 16);
    console.log(`${label.padEnd(40)} ${s.fps.toFixed(0).padStart(5)} fps  frame ${s.ms.median.toFixed(2)} ms  js ${s.jsMs.toFixed(2)}  gpu ${(s.gpuMs ?? NaN).toFixed(2)}  calls ${c.calls}  tris ${(c.tris / 1e6).toFixed(2)}M`);
  };
  const ab = async (label, on, off) => {
    await page.evaluate(on);
    await sleep(700);
    await frames(label);
    await page.evaluate(off);
    await sleep(200);
  };
  console.log(`scene ${args.scene}, 1920 x 1080, High, uncapped`);
  await frames('the scene as it is');
  await ab('no drawing at all (update only)', () => { const r = window.__game.renderer; r.__r = r.render; r.render = () => {}; }, () => { const r = window.__game.renderer; r.render = r.__r; });
  await ab('no shadow maps', () => { const R = window.__game.renderer; R.__sd = R._shadowsDue; R._shadowsDue = () => false; }, () => { const R = window.__game.renderer; R._shadowsDue = R.__sd; });
  await ab('shadow maps every frame', () => { const R = window.__game.renderer; R.__sd = R._shadowsDue; R._shadowsDue = () => true; }, () => { const R = window.__game.renderer; R._shadowsDue = R.__sd; });
  await ab('no trees, bushes, rocks, grass', () => { const s = window.__game.renderer.scene; window.__hid = s.children.filter((o) => o.isInstancedMesh && o.visible); window.__hid.forEach((o) => (o.visible = false)); }, () => window.__hid.forEach((o) => (o.visible = true)));
  await ab('no grass', () => { const s = window.__game.renderer.scene; window.__hid = s.children.filter((o) => o.isInstancedMesh && o.visible && /grass/.test(o.material.name)); window.__hid.forEach((o) => (o.visible = false)); }, () => window.__hid.forEach((o) => (o.visible = true)));
  await ab('no static world', () => (window.__game.staticWorld.group.visible = false), () => (window.__game.staticWorld.group.visible = true));
  await ab('no terrain', () => { const s = window.__game.renderer.scene; window.__hid = s.children.filter((o) => /terrain/i.test(o.name)); window.__hid.forEach((o) => (o.visible = false)); }, () => window.__hid.forEach((o) => (o.visible = true)));
  await ab('no hands', () => (window.__game.renderer.vmScene.visible = false), () => (window.__game.renderer.vmScene.visible = true));
  await ab('no HUD (the DOM hidden)', () => (document.getElementById('ui').style.display = 'none'), () => (document.getElementById('ui').style.display = ''));
  const Q = (patch) => `(() => { const R = window.__game.renderer; R.__q = R.__q || { ...R.q }; Object.assign(R.q, ${JSON.stringify(patch)}); })()`;
  const unQ = `(() => { const R = window.__game.renderer; Object.assign(R.q, R.__q); })()`;
  await ab('no ambient occlusion', Q({ ao: 0 }), unQ);
  await ab('no sun shafts / beam', Q({ godrays: false }), unQ);
  await ab('no bloom', Q({ bloom: false }), unQ);
  await ab('no AO, shafts or bloom', Q({ ao: 0, godrays: false, bloom: false }), unQ);
  await ab('half the pixels each way', () => window.__game.renderer.setRenderScale(0.5), () => window.__game.renderer.setRenderScale(1));
  await ab('quality Medium', () => { const g = window.__game; g.renderer.setQuality('medium'); g.env.setShadows(g.renderer.q); g.lights.setShadows(false, true); g.foliage.setQuality(g.renderer.q, 1); }, () => { const g = window.__game; g.renderer.setQuality('high'); g.env.setShadows(g.renderer.q); g.lights.setShadows(true, true); g.foliage.setQuality(g.renderer.q, 1); });
  await ab('quality Low', () => { const g = window.__game; g.renderer.setQuality('low'); g.env.setShadows(g.renderer.q); g.lights.setShadows(false, false); g.foliage.setQuality(g.renderer.q, 1); }, () => { const g = window.__game; g.renderer.setQuality('high'); g.env.setShadows(g.renderer.q); g.lights.setShadows(true, true); g.foliage.setQuality(g.renderer.q, 1); });
  console.log(`browser: ${((Date.now() - chrome.born) / 1000).toFixed(0)} s`);
} finally {
  await chrome?.close().catch((e) => console.error(String(e)));
  game?.stop();
}
