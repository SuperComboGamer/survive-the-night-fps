// "Nothing looks worse": the same pictures from two builds, compared pixel by pixel (docs/performance.md).
// A fixed list of camera spots - the benchmark's scenes, and close-ups of what a level-of-detail step or a smaller
// vertex format could spoil: a survivor at 2, 8 and 25 m, a walker and every boss at 3, 10 and 30 m, the specials
// either side of the distance their far copy takes over at, a horde at 20 m, a street, a room, the airfield, four
// frames of the crossing - is drawn by the "before" build and by this one with everything pinned: the seed, the
// hour, the weather, Math.random, the game's clock (the page's frames are stepped by hand, a fixed number of fixed
// steps), and the dead and the survivors in the picture are put there by the script, not by a server whose clock
// would differ. Each pair is written side by side with its difference (x8) to docs/pr-images/perf/, and the mean and
// the largest difference per picture to a table.
//
// One headless browser at a time through lib.js launchChrome, on the real GPU with vsync on (the pictures are what a
// player's card draws), at 1280 x 720 and High quality.
//
// usage: node scripts/perf/visual.js [--before perf-baseline | <dir> | same | none] [--only <regex>] [--out docs/pr-images/perf]
//   --before same   this build twice: what two runs of one build differ by (the noise a real difference must exceed)
//   --before none   this build's pictures only (framing a spot)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join as pjoin, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { REPO, parseArgs, sleep, startGame, launchChrome, tempWorktree, LIFE_MAX, badPasswordAttempts } from '../clip/lib.js';
import { SEED, SPOT, DAY, NIGHT, chat, join } from './lib.js';
import { ENT } from '../../shared/protocol.js';
import { ZTYPE, ZANIM } from '../../shared/defs.js';

const args = parseArgs(process.argv.slice(2), { before: 'perf-baseline', out: pjoin(REPO, 'docs', 'pr-images', 'perf'), work: pjoin(REPO, 'shots', 'perf', 'visual') });
const OUT = resolve(args.out), WORK = resolve(args.work);
const only = args.only ? new RegExp(String(args.only)) : null;
const W = 1280, H = 720;
// a difference (mean of |before - after| over the picture's pixels and channels, of 255) above this is looked at
const THRESHOLD = 0.6;

// ---------------------------------------------------------------- the spots
const Z = (type, d, side = 0, o = {}) => ({ k: 'z', type, d, side, variant: o.variant ?? 0, anim: o.anim ?? ZANIM.IDLE, id: o.id });
const P = (id, d, side = 0) => ({ k: 'p', id, d, side });
const I = SPOT.island, ST = SPOT.street;
const row = (types, d, gap) => types.map((t, i) => Z(t, d, (i - (types.length - 1) / 2) * gap, { id: 61000 + i }));
const HUMANOID = [ZTYPE.WALKER, ZTYPE.RUNNER, ZTYPE.SPITTER, ZTYPE.LEAPER, ZTYPE.ROPER, ZTYPE.BOOMER, ZTYPE.SHADE];
const horde = (n, d0, d1) => {
  const out = [];
  const cols = 15;
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    out.push(Z(i % 4 === 3 ? ZTYPE.RUNNER : ZTYPE.WALKER, d0 + (r / Math.ceil(n / cols - 1)) * (d1 - d0) + ((i * 7) % 5) * 0.12, (c - (cols - 1) / 2) * 1.15 + ((i * 3) % 7) * 0.05, { variant: i % 16, id: 62000 + i, anim: i % 3 ? ZANIM.WALK : ZANIM.IDLE }));
  }
  return out;
};
const SPOTS = [
  { name: 'bench-01-island', act: 1, ...I, cycle: DAY },
  { name: 'bench-05-island-night-flashlight', act: 1, ...I, cycle: NIGHT, flash: true, ents: horde(60, 8, 22) },
  { name: 'survivor-02m', act: 1, ...I, ents: [P(50001, 2)] },
  { name: 'survivor-08m', act: 1, ...I, ents: [P(50001, 8, -1.2), P(50002, 8, 0), P(50003, 8, 1.2)] },
  { name: 'survivor-25m', act: 1, ...I, ents: [P(50001, 25, -1.5), P(50002, 25, 0), P(50004, 25, 1.5), P(50005, 25, 3)] },
  { name: 'survivors-all-5m', act: 1, ...I, ents: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => P(50010 + i, 5 + (i % 2) * 1.3, (i - 4.5) * 0.85)) },
  ...[
    ['walker', ZTYPE.WALKER],
    ['tank', ZTYPE.TANK],
    ['brute', ZTYPE.BOSS_BRUTE],
    ['bloater', ZTYPE.BOSS_BLOATER],
    ['abomination', ZTYPE.BOSS_ABOMINATION],
    ['hivequeen', ZTYPE.BOSS_HIVEQUEEN],
    ['alpha', ZTYPE.BOSS_ALPHA],
  ].flatMap(([n, t]) => [3, 10, 30].map((d) => ({ name: `${n}-${String(d).padStart(2, '0')}m`, act: 1, ...I, pitch: d === 3 ? (t === ZTYPE.WALKER || t === ZTYPE.BOSS_ALPHA ? -0.12 : 0.12) : -0.04, ents: [Z(t, d + (d === 3 && t !== ZTYPE.WALKER && t !== ZTYPE.BOSS_ALPHA ? 1.5 : 0), 0, { id: 60001, variant: 3 })] }))),
  { name: 'walkers-16-variants-06m', act: 1, ...I, ents: Array.from({ length: 16 }, (_, i) => Z(ZTYPE.WALKER, 6 + (i % 2) * 1.4, (i - 7.5) * 0.7, { variant: i, id: 60100 + i })) },
  // the humanoid dead either side of where their far copy takes over (15 m out, 12 m back in) and a step beyond
  ...[5, 11, 14, 16, 22].map((d) => ({ name: `specials-${String(d).padStart(2, '0')}m`, act: 1, ...I, ents: row(HUMANOID, d, d < 8 ? 1.0 : 1.4) })),
  { name: 'animals-06m', act: 1, ...I, ents: [Z(ZTYPE.DOG, 6, -2, { id: 60201 }), Z(ZTYPE.BAT, 6, 0, { id: 60202 }), Z(ZTYPE.DOG, 12, 2, { id: 60203 })] },
  { name: 'horde-20m', act: 1, ...I, ents: horde(150, 14, 27) },
  { name: 'horde-40m', act: 1, ...I, ents: horde(150, 34, 50) },
  { name: 'cutscene-1-leaving', cine: 3.0 },
  { name: 'cutscene-2-horde-at-the-lens', cine: 6.4 },
  { name: 'cutscene-3-from-below', cine: 18.8 },
  { name: 'cutscene-4-the-skyline', cine: 30.2 },
  { name: 'bench-08-main-street', act: 2, ...ST, cycle: DAY },
  { name: 'bench-09-city-from-a-roof', act: 2, ...SPOT.roof, cycle: DAY },
  { name: 'bench-10-inside-a-shop', act: 2, ...SPOT.shop, cycle: DAY },
  { name: 'bench-11-street-night-horde', act: 2, ...ST, cycle: NIGHT, flash: true, ents: horde(90, 9, 24) },
  { name: 'bench-12-airfield', act: 2, ...SPOT.airfield, cycle: DAY, ents: [...horde(60, 12, 24), Z(ZTYPE.BOSS_ABOMINATION, 20, 4, { id: 60001 })] },
  { name: 'city-street-2', act: 2, at: [-203, 40], yaw: 0, pitch: 0.05, cycle: DAY },
  { name: 'city-crossing', act: 2, at: [-259, 12], yaw: 2.2, pitch: 0.1, cycle: 0.12 },
  { name: 'city-edge-from-the-bridgehead', act: 2, at: [-430, 0], yaw: -Math.PI / 2, pitch: 0.06, cycle: DAY },
  { name: 'shop-from-the-door', act: 2, at: [-354.2, -89.4], y: 2.2, yaw: Math.PI, pitch: -0.05, cycle: DAY },
  { name: 'airfield-terminal', act: 2, at: [440, -20], yaw: 0.9, pitch: 0.03, cycle: DAY },
].filter((s) => !only || only.test(s.name));

// ---------------------------------------------------------------- in the page
function VIS() {
  // Math.random from a seed that the script resets before every picture
  let a = 1;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const raf = window.requestAnimationFrame.bind(window);
  const V = (window.__vis = { hold: false, cbs: [], now: 0 });
  // (a callback asked for before the hold is caught when the browser comes to run it)
  window.requestAnimationFrame = (cb) => {
    if (V.hold) {
      V.cbs.push(cb);
      return 0;
    }
    return raf((t) => (V.hold ? V.cbs.push(cb) : cb(t)));
  };
  V.seed = (n) => (a = n | 0);
  const stepOnce = (dt) => {
    V.now += dt * 1000;
    const list = V.cbs;
    V.cbs = [];
    for (const cb of list) cb(V.now);
  };
  // the page's frames stop being the browser's: every callback waits until step() runs it
  V.stop = () =>
    new Promise((done) => {
      V.hold = true;
      const iv = setInterval(() => {
        if (!V.cbs.length) return; // (the game's own frame callback is not in hand yet)
        clearInterval(iv);
        V.now = performance.now() + 50;
        done();
      }, 5);
    });
  V.go = () => {
    V.hold = false;
    const list = V.cbs;
    V.cbs = [];
    for (const cb of list) raf(cb);
  };
  // n frames of dt, the game's clock put to `time` after the first (whose length is whatever the last real frame left)
  V.step = (n, dt, time) => {
    const g = window.__game;
    stepOnce(dt);
    if (time !== undefined) g.time = time;
    for (let i = 1; i < n; i++) stepOnce(dt);
  };
  // The wind: its sway clock (globals.js uWind.x) has run for as long as the page has been up, and the weather eases
  // towards what it is told. Both are put where every run has them: the clock through a material that holds the
  // shared uniform, the weather's eased state directly.
  V.calm = () => {
    const g = window.__game;
    let wind = null;
    g.renderer.scene.traverse((o) => {
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) wind ||= m.uniforms?.uWind?.value || m.userData?.shader?.uniforms?.uWind?.value;
    });
    V.wind = !!wind;
    if (wind) wind.x = 100;
    g.weather.force = { kind: 'clear', wind: 0.3, fog: 1, rain: 0, cloud: 0, bolts: 0, dir: 1, noBolts: true };
    Object.assign(g.weather.state, { fog: 1, windBase: 0.3, rain: 0, cloud: 0, bolts: 0 });
    g.weather.dir = 1;
  };
  V.png = () => window.__game.renderer.canvas.toDataURL('image/png');
  // the dead and the survivors of a picture: entities the client is told of here, standing where they are put
  const mine = new Set();
  V.clear = () => {
    const E = window.__game.entities;
    for (const id of mine) {
      const e = E.ents.get(id);
      if (e) {
        E.ents.delete(id);
        E.onRemove(e, 0);
      }
    }
    mine.clear();
    for (const c of E.corpses) E.disposeZombieView(c.view);
    E.corpses.length = 0;
  };
  V.place = (list, ENT) => {
    const g = window.__game;
    const E = g.entities;
    const sc = g.world.posScale || 64;
    for (const o of list) {
      const y = g.world.heightAt(o.x, o.z);
      const e = { id: o.id, kind: o.k === 'p' ? ENT.PLAYER : ENT.ZOMBIE, q: new Int32Array(9) };
      e.q[0] = Math.round(o.x * sc);
      e.q[1] = Math.round(y * sc);
      e.q[2] = Math.round(o.z * sc);
      const yaw = ((o.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (o.k === 'p') {
        e.q[3] = Math.round((yaw / (Math.PI * 2)) * 65536) & 0xffff;
        e.q[6] = o.weapon || 0;
      } else {
        e.ztype = o.type;
        e.variant = o.variant;
        e.q[3] = Math.round((yaw / (Math.PI * 2)) * 256) & 255;
        e.q[4] = o.anim;
        e.q[5] = 255;
      }
      E.ents.set(e.id, e);
      E.onCreate(e, g.latestTick || 0);
      mine.add(e.id);
      // (it stands where it was put, whatever the interpolation clock reads)
      const pin = (t, out) => {
        out.x = o.x;
        out.y = y;
        out.z = o.z;
        out.yaw = yaw;
        out.pitch = 0;
        out.vx = out.vy = out.vz = 0;
        return out;
      };
      e.samples.sample = pin;
      e.samples.sampleSmooth = pin;
      e.samples.lastTick = () => 0;
    }
  };
  // what the server's own world has walking about is not in the pictures (it is somewhere else in each run)
  V.hideLive = (kinds) => {
    for (const e of window.__game.entities.ents.values()) {
      if (mine.has(e.id) || !kinds.includes(e.kind)) continue;
      const o = e.view?.object || e.obj;
      if (o) o.visible = false;
      if (e.cone) e.cone.visible = false;
    }
  };
}

const fwdOf = (s, d, side) => [s.at[0] - Math.sin(s.yaw) * d + Math.cos(s.yaw) * side, s.at[1] - Math.cos(s.yaw) * d - Math.sin(s.yaw) * side];
const STEPS = 300, DT = 1 / 30;

async function shoot(tree, label) {
  const dir = pjoin(WORK, label);
  mkdirSync(dir, { recursive: true });
  let game = null, chrome = null;
  const info = {};
  try {
    game = await startGame(tree, { seed: SEED, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
    chrome = await launchChrome({ width: W, height: H, gpu: true, life: LIFE_MAX, storage: { 'stn.settings': JSON.stringify({ quality: 'high', renderScale: 1 }), 'stn.character': '3', 'stn.name': 'visual' } });
    const page = chrome.page;
    page.on('pageerror', (e) => console.error('  page:', String(e).slice(0, 200)));
    await page.evaluateOnNewDocument(VIS);
    await page.goto(game.url, { waitUntil: 'load', timeout: 60000 });
    for (let i = 0; i < 600 && !(await page.evaluate(() => !!(window.__game && window.__game.state === 'menu' && window.__game.world && !window.__game.warm))); i++) await sleep(100);
    await join(page);
    await sleep(1500);
    let act = 1;
    const take = async (s) => {
      const png = await page.evaluate(
        async (s, ENT, STEPS, DT, kinds) => {
          const g = window.__game, V = window.__vis;
          V.clear();
          if (s.at) {
            g.input.yaw = s.yaw;
            g.input.pitch = s.pitch || 0;
            g.debugCycle = s.cycle ?? 0.2;
            // (the camera exactly where the list says, whatever the player's body was nudged by; the hands are not in
            // these pictures: they cover a third of each)
            const rp = g.renderPos;
            g.debugCam = { x: s.at[0], y: Math.round(rp.y * 4) / 4 + 1.62, z: s.at[1], yaw: s.yaw, pitch: s.pitch || 0 };
            g.weather.force = { kind: 'clear' };
            g.localFlash = !!s.flash;
            g.localFlashT = 1e9;
          }
          if (!s.at) g.debugCam = null;
          V.place(s.list || [], ENT);
          await V.stop();
          V.seed(12345);
          V.hideLive(kinds);
          V.step(1, DT, 5000);
          V.calm();
          V.step(STEPS, DT);
          V.hideLive(kinds);
          V.step(2, DT);
          const png = V.png();
          g.localFlashT = 0;
          g.debugCam = null;
          V.go();
          return [png, V.wind];
        },
        s,
        ENT,
        STEPS,
        DT,
        [ENT.ZOMBIE, ENT.CAT, ENT.DEER, ENT.PLAYER],
      );
      if (!png[1] && !info.warned) console.log((info.warned = '(no handle on the wind uniform: foliage will differ between runs)'));
      writeFileSync(pjoin(dir, `${s.name}.png`), Buffer.from(png[0].split(',')[1], 'base64'));
      const c = await page.evaluate(() => window.__game.renderer.stats);
      info[s.name] = { calls: c.calls, tris: c.tris };
      process.stdout.write(`${s.name} `);
    };
    const inCine = () => page.evaluate(() => !!window.__game.cine);
    const until = async (fn, n = 400) => {
      for (let i = 0; i < n && !(await page.evaluate(fn)); i++) await sleep(100);
    };
    for (const s of SPOTS) {
      if (s.cine !== undefined) {
        // the crossing, its clock held at a moment: the server's /cross hold (which stops it on the island, and
        // after a /cross go again short of its end) and the cutscene's own pin
        if (act === 1 && !(await inCine())) {
          await chat(page, '/cross hold');
          await sleep(1500);
        }
        if (act === 1 && s.cine >= 7.4) {
          await chat(page, '/cross go');
          await until(() => window.__game.act === 2 && !window.__game.warm);
          await sleep(5000);
          act = 2;
        }
        await page.evaluate((t) => window.__game.cine && (window.__game.cine.pin = t), s.cine);
        await sleep(1200);
        await take({ name: s.name });
        continue;
      }
      if (s.act === 2 && (act === 1 || (await inCine()))) {
        if (await inCine()) {
          // (out of the held cutscene: on to the mainland if it is still the island's side of it, then to its end)
          await page.evaluate(() => window.__game.cine && delete window.__game.cine.pin);
          if (act === 1) {
            await chat(page, '/cross go');
            await until(() => window.__game.act === 2 && !window.__game.warm);
            await sleep(1500);
          }
          await chat(page, '/cross go');
        } else await chat(page, '/cross skip');
        await until(() => window.__game.act === 2 && !window.__game.warm && window.__game.global.phase !== 5);
        await sleep(4000);
        act = 2;
      }
      await chat(page, `/tp ${s.at[0]} ${s.at[1]}${s.y === undefined ? '' : ' ' + s.y}`);
      await sleep(1300);
      const list = (s.ents || []).map((o) => {
        const [x, z] = fwdOf(s, o.d, o.side);
        return { ...o, x, z, yaw: s.yaw + Math.PI };
      });
      await take({ ...s, list });
    }
    console.log('');
  } finally {
    await chrome?.close().catch((e) => {
      console.error(String(e));
      process.exitCode = 3;
    });
    game?.stop();
  }
  writeFileSync(pjoin(dir, 'info.json'), JSON.stringify(info));
  return dir;
}

// ---------------------------------------------------------------- comparing
async function compare(dirA, dirB) {
  mkdirSync(OUT, { recursive: true });
  const rows = [];
  const chrome = await launchChrome({ width: 900, height: 600, life: LIFE_MAX });
  try {
    const page = chrome.page;
    const html = pjoin(WORK, 'compare.html');
    writeFileSync(html, '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111"></body>');
    await page.goto(pathToFileURL(html).href);
    for (const s of SPOTS) {
      const fa = pjoin(dirA, `${s.name}.png`), fb = pjoin(dirB, `${s.name}.png`);
      if (!existsSync(fa) || !existsSync(fb)) continue;
      const r = await page.evaluate(
        async (a, b, name, W, H) => {
          const load = (src) =>
            new Promise((res, rej) => {
              const im = new Image();
              im.onload = () => res(im);
              im.onerror = rej;
              im.src = src;
            });
          const [A, B] = await Promise.all([load(a), load(b)]);
          const px = (im) => {
            const c = document.createElement('canvas');
            c.width = W;
            c.height = H;
            const x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(im, 0, 0);
            return x.getImageData(0, 0, W, H);
          };
          const da = px(A), db = px(B);
          const diff = new ImageData(W, H);
          let sum = 0, max = 0, over = 0;
          for (let i = 0; i < da.data.length; i += 4) {
            let m = 0;
            for (let k = 0; k < 3; k++) {
              const d = Math.abs(da.data[i + k] - db.data[i + k]);
              sum += d;
              if (d > m) m = d;
              diff.data[i + k] = Math.min(255, d * 8);
            }
            diff.data[i + 3] = 255;
            if (m > max) max = m;
            if (m > 24) over++;
          }
          // the sheet: before | after | difference x8
          const S = 0.5;
          const c = document.createElement('canvas');
          c.width = W * S * 3 + 16;
          c.height = H * S + 34;
          const x = c.getContext('2d');
          x.fillStyle = '#15171b';
          x.fillRect(0, 0, c.width, c.height);
          x.drawImage(A, 0, 34, W * S, H * S);
          x.drawImage(B, W * S + 8, 34, W * S, H * S);
          const dc = document.createElement('canvas');
          dc.width = W;
          dc.height = H;
          dc.getContext('2d').putImageData(diff, 0, 0);
          x.drawImage(dc, (W * S + 8) * 2, 34, W * S, H * S);
          const mean = sum / (W * H * 3);
          x.fillStyle = '#e8e6e1';
          x.font = '600 15px system-ui, Segoe UI, sans-serif';
          x.fillText(`${name}   before | after | difference x8      mean ${mean.toFixed(3)} / 255, largest ${max}, ${((over / (W * H)) * 100).toFixed(2)}% of pixels differ by more than 24`, 8, 22);
          return { mean, max, over: over / (W * H), png: c.toDataURL('image/jpeg', 0.9) };
        },
        pathToFileURL(fa).href,
        pathToFileURL(fb).href,
        s.name,
        W,
        H,
      );
      writeFileSync(pjoin(OUT, `${s.name}.jpg`), Buffer.from(r.png.split(',')[1], 'base64'));
      rows.push({ name: s.name, mean: r.mean, max: r.max, over: r.over });
    }
  } finally {
    await chrome.close().catch((e) => {
      console.error(String(e));
      process.exitCode = 3;
    });
  }
  return rows;
}

const c0 = badPasswordAttempts();
const build = (dir) => execFileSync(process.execPath, [pjoin(dir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: dir, stdio: 'ignore' });
let wt = null;
try {
  build(REPO);
  let dirA = null;
  if (args.before === 'same') dirA = await shoot(REPO, 'before');
  else if (args.before !== 'none') {
    let tree = resolve(String(args.before));
    if (!existsSync(pjoin(tree, 'package.json'))) {
      wt = tempWorktree(String(args.before));
      tree = wt.dir;
    }
    build(tree);
    dirA = await shoot(tree, 'before');
  }
  const dirB = await shoot(REPO, 'after');
  if (dirA && process.exitCode !== 3) {
    const rows = await compare(dirA, dirB);
    const ia = JSON.parse(readFileSync(pjoin(dirA, 'info.json'), 'utf8')), ib = JSON.parse(readFileSync(pjoin(dirB, 'info.json'), 'utf8'));
    const md = [`| Picture | mean difference (of 255) | largest | pixels differing by > 24 | draw calls | triangles |`, `|---|---|---|---|---|---|`];
    for (const r of rows) md.push(`| ${r.name} | ${r.mean.toFixed(3)}${r.mean > THRESHOLD ? ' (!)' : ''} | ${r.max} | ${(r.over * 100).toFixed(2)}% | ${ia[r.name]?.calls} -> ${ib[r.name]?.calls} | ${((ia[r.name]?.tris || 0) / 1e6).toFixed(2)}M -> ${((ib[r.name]?.tris || 0) / 1e6).toFixed(2)}M |`);
    md.push('', `Before: ${args.before}. 1280 x 720, High quality, the real GPU. Above ${THRESHOLD} of 255 on average a picture is marked (!) and has to be looked at.`);
    writeFileSync(pjoin(OUT, args.before === 'same' ? 'VISUAL-noise.md' : 'VISUAL.md'), md.join('\n') + '\n');
    console.log(md.join('\n'));
  }
} finally {
  wt?.remove();
}
console.log(`the account's failed sign-in counter: ${c0} -> ${badPasswordAttempts()}`);
