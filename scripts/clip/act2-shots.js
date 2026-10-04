// Shots of the run's second act for a pull request, in the real game: the crossing's cutscene shot by shot and
// second by second, the mainland's field map beside the island's at one scale, the city (from above, its streets,
// its ruin, its landmarks, its rooms), the river, the coast and the places out on the plain, the airfield, the plane
// from four sides as it is found and as it is mended, the take-off and the end screen. One headless browser for a
// run of it (lib.js launchChrome: one at a time, software rendering), one game server on a free port with the debug
// chat commands (/cross hold, /place, /plane, /takeoff hold). Every shot's draw calls and triangles are printed at
// the end.
//
// A browser lives fifteen minutes (lib.js LIFE_MAX) and a shot of the city takes fifteen to twenty seconds in
// software: the whole list is three runs of this, each well inside that -
//   --only cutscene --frames 1        the crossing, and a frame of it every second
//   --only city,ruin,landmarks,rooms  Port Calder
//   --only map,country,airfield,plane,takeoff   the rest
//
// usage: node scripts/clip/act2-shots.js [--seed 1337] [--out docs/pr-images] [--only ...] [--frames 1] [--size 1280x720]
//   --only    cutscene, map, city, ruin, landmarks, rooms, country, airfield, plane, takeoff (default: all - too long for one browser)
//   --frames n   also save a frame of the crossing every n seconds (the motion, for judging the pacing): 0 = none
//   --clear   how much of the day's haze the shots from above keep (default 0.12)
//   --pick re   only the shots whose names match (a look at a few of them)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, parseArgs, sleep, startGame, launchChrome, LIFE_MAX, list } from './lib.js';

const args = parseArgs(process.argv.slice(2), { seed: '1337', out: join(REPO, 'docs', 'pr-images'), frames: '0', size: '1280x720', clear: '0.12' });
const only = list(args.only);
const want = (k) => !only || only.includes(k);
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const [W, H] = String(args.size).split('x').map(Number);
const clear = +args.clear;
const pick = args.pick ? new RegExp(String(args.pick)) : null;

let game = null;
let chrome = null;
const t0 = Date.now();
try {
  game = await startGame(REPO, { seed: +args.seed, build: true, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
  chrome = await launchChrome({ width: W, height: H, life: LIFE_MAX, storage: { 'stn.settings': JSON.stringify({ quality: 'medium', renderScale: 1 }) } });
  const p = chrome.page;
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  p.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && /prop failed|citykit|unknown material/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
  await sleep(3500);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /join/i.test(x.textContent))?.click());
  for (let i = 0; i < 120 && !(await p.evaluate(() => !!(window.__game && window.__game.myId && window.__game.vm))); i++) await sleep(250);
  await sleep(2500);
  await p.evaluate(() => {
    const g = window.__game;
    g.input.locked = true;
    g.input.enabled = true;
    g.input.requestLock = () => {};
    g.input.handlers.onLockChange = () => {};
    g.ui.showPause(false);
  });
  await p.addStyleTag({ content: '.clip-nohud #ui { visibility: hidden !important; }' });
  const chat = (t) => p.evaluate((t) => window.__game.conn.chat(t), t);
  const costs = [];
  const shot = async (name) => {
    if (pick && !pick.test(name)) return;
    await p.screenshot({ path: join(out, `${name}.png`) });
    const c = await p.evaluate(
      () =>
        new Promise((done) => {
          // (a frame is several passes, and the renderer's counters start again at each: count one whole frame)
          const info = window.__game.renderer.renderer.info;
          info.autoReset = false;
          info.reset();
          requestAnimationFrame(() => {
            const o = [info.render.calls, info.render.triangles];
            info.autoReset = true;
            done(o);
          });
        }),
    );
    costs.push([name, ...c]);
    process.stdout.write(`${name} `);
  };
  const hud = (on) => p.evaluate((on) => document.body.classList.toggle('clip-nohud', !on), on);
  // a free camera: where it stands, what it looks at. o: cycle (the hour: Environment's cycle, 0 sunrise .. 0.25
  // noon), fog (how much of the day's haze: a shot from above thins it), far (the camera's far plane)
  const cam = async (at, look, o = {}) => {
    await p.evaluate(
      (at, look, cycle, fog, far) => {
        const g = window.__game;
        const dx = look[0] - at[0], dy = look[1] - at[1], dz = look[2] - at[2];
        g.debugCam = { x: at[0], y: at[1], z: at[2], yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
        g.debugCycle = cycle;
        g.debugFog = fog;
        g.weather.force = { kind: 'clear' };
        g.renderer.vmScene.visible = false;
        g.renderer.camera.far = far;
        g.renderer.camera.updateProjectionMatrix();
      },
      at,
      look,
      o.cycle ?? 0.22,
      o.fog,
      o.far ?? 520,
    );
    await sleep(o.wait ?? 1500);
  };
  const free = () =>
    p.evaluate(() => {
      const g = window.__game;
      g.debugCam = null;
      g.debugCycle = undefined;
      g.debugFog = undefined;
      g.weather.force = null;
      g.renderer.vmScene.visible = true;
      g.renderer.camera.far = 520;
      g.renderer.camera.updateProjectionMatrix();
    });
  const info = () =>
    p.evaluate(() => {
      const g = window.__game;
      const w = g.world;
      const C = w.city;
      return {
        act: g.act,
        phase: g.global.phase,
        car: w.car,
        bridge: w.bridge ? { x0: w.bridge.x0, x1: w.bridge.x1, z: w.bridge.z, y: w.bridge.deckY } : null,
        places: Object.fromEntries(w.zones.map((z) => [z.id, { x: z.x, z: z.z, h: z.h, ry: z.ry, flat: z.flat }])),
        city: C ? { x: C.x, z: C.z, h: w.zoneById[28].h } : null,
        lots: C ? C.lots.map((l) => ({ x: l.x, z: l.z, w: l.w, d: l.d, ry: l.ry, what: l.what, fell: !!l.fell })) : [],
        across: (w.parts || []).filter((q) => q.across && q.sy > 3).map((q) => [q.x, q.z, q.sx, q.sz]),
        wire: (w.props || []).filter((q) => q.type === 'concertina').map((q) => [q.x, q.z, q.ry]),
        bus: (w.props || []).filter((q) => q.type === 'city_bus').map((q) => [q.x, q.z, q.ry]),
        glass: C ? (C.buildings || []).filter((B) => B.style === 'glass' && B.floors >= 6).map((B) => [B.x, B.z, B.y, B.ry, B.w, B.d, B.floors * B.fh]) : [],
        open: C ? (C.buildings || []).filter((B) => (B.cut || []).filter((R) => R).length >= 3 && B.floors >= 4).map((B) => [B.x, B.z, B.y, B.ry, B.w, B.d, B.floors * B.fh]) : [],
        river: w.river ? w.river.bridges : [],
        sea: w.sea ? w.sea.x : 0,
        runway: w.runway,
        programs: g.renderer.renderer.info.programs.length,
      };
    });
  // the island's field map, kept for the two maps side by side
  const islandMap = want('map') ? await p.evaluate(() => window.__game.ui.map.baked().toDataURL('image/jpeg', 0.9)) : null;

  // ---- the crossing: the cutscene with its clock pinned at each moment
  const pin = (t) => p.evaluate((t) => window.__game.cine && (window.__game.cine.pin = t), t);
  if (want('cutscene')) {
    await chat('/cross hold');
    await sleep(1500);
    for (const [t, name] of [[1.6, 'cutscene-01-leaving-the-island'], [3.0, 'cutscene-02-the-horde-behind'], [4.6, 'cutscene-03-the-horde-second-angle'], [6.4, 'cutscene-04-onto-the-bridge']]) {
      await pin(t);
      await sleep(1400);
      await shot(name);
    }
    const dir = join(out, 'cutscene-frames');
    if (+args.frames > 0) {
      mkdirSync(dir, { recursive: true });
      for (let t = 0.5; t < 7.2; t += +args.frames) {
        await pin(t);
        await sleep(700);
        await p.screenshot({ path: join(dir, `t${t.toFixed(1).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 80 });
      }
    }
    await chat('/cross go'); // (off the island: the clock was held there)
    // (the server puts the mainland up CROSSING.SWAP seconds in)
    for (let i = 0; i < 160 && (await p.evaluate(() => window.__game.act)) !== 2; i++) await sleep(250);
    await sleep(4000);
    for (const [t, name] of [[10.6, 'cutscene-05-the-approach'], [14.6, 'cutscene-06-the-damage'], [17.0, 'cutscene-07-the-damage-wrecks'], [20.2, 'cutscene-08-from-below'], [24.2, 'cutscene-09-the-gap'], [27.4, 'cutscene-10-past-the-gap'], [30.2, 'cutscene-11-the-skyline'], [33.2, 'cutscene-12-the-skyline-late'], [35.6, 'cutscene-13-arrival'], [37.9, 'cutscene-14-the-span-goes'], [38.9, 'cutscene-15-the-span-falls']]) {
      await pin(t);
      await sleep(1800);
      await shot(name);
    }
    if (+args.frames > 0) {
      for (let t = 8.5; t < 40; t += +args.frames) {
        await pin(t);
        await sleep(700);
        await p.screenshot({ path: join(dir, `t${t.toFixed(1).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 80 });
      }
      process.stdout.write('frames ');
    }
    await p.evaluate(() => window.__game.cine && delete window.__game.cine.pin);
    await chat('/cross go');
    for (let i = 0; i < 80 && (await p.evaluate(() => window.__game.global.phase)) === 5; i++) await sleep(250);
    await chat('/cross skip');
    await sleep(2500);
  } else {
    await chat('/cross skip');
    for (let i = 0; i < 200 && (await p.evaluate(() => window.__game.act)) !== 2; i++) await sleep(250);
    await sleep(5000);
  }
  const I = await info();
  console.log(`\non the mainland after ${((Date.now() - t0) / 1000).toFixed(0)} s, ${I.lots.length} lots, ${I.river.length} bridges`);
  const { city } = I;
  const G2 = 168; // (half the grid of streets: GRID * PITCH / 2)
  const eye = city.h + 1.7;
  // where things are: a lot of the city by what stands on it, a point of its own frame out in the world (its
  // front is -Z), a place by its id
  // (of the lots a thing stands on, the one whose front the sun is on at the hour the shots are taken)
  await cam([city.x, city.h + 60, city.z], [city.x + 1, city.h, city.z], { wait: 800 });
  const sun = await p.evaluate(() => {
    const v = window.__game.env.uniforms.uSunDir.value;
    return [v.x, v.z];
  });
  const lit = (l) => -Math.sin(l.ry) * sun[0] - Math.cos(l.ry) * sun[1];
  const lotOf = (what, n = 0) => I.lots.filter((l) => l.what === what).sort((a, b) => lit(b) - lit(a))[n] || null;
  const lw = (L, lx, lz) => [L.x + Math.cos(L.ry) * lx + Math.sin(L.ry) * lz, L.z - Math.sin(L.ry) * lx + Math.cos(L.ry) * lz];
  // a lot from the street in front of it: back m off its front edge, up m over the pavement, side m to its right,
  // looking lookUp m up its front
  const front = async (what, name, back, up, side = 7, lookUp = 5, n = 0) => {
    const L = lotOf(what, n);
    if (!L) return console.log(`\n(no ${what} on this map)`);
    const [x, z] = lw(L, side, -L.d / 2 - back);
    const [tx, tz] = lw(L, 0, -L.d / 2 + 6);
    await cam([x, city.h + up, z], [tx, city.h + lookUp, tz]);
    await shot(name);
  };
  const room = async (L, at, look, name, h = 1.7) => {
    if (!L) return;
    const [x, z] = lw(L, at[0], at[1]);
    const [tx, tz] = lw(L, look[0], look[1]);
    await cam([x, city.h + h, z], [tx, city.h + 1.2, tz]);
    await shot(name);
  };
  const ground = (x, z) => p.evaluate((x, z) => window.__game.world.heightAt(x, z), x, z);
  await hud(false);

  // ---- the two maps at one scale, and the map screen
  if (want('map')) {
    const both = await p.evaluate((islandMap) => {
      const m = window.__game.ui.map.baked();
      const cv = document.createElement('canvas');
      const pad = 40;
      const s = 0.42; // (2 px a metre, drawn at this much of it)
      const isl = new Image();
      isl.src = islandMap;
      return new Promise((done) => {
        isl.onload = () => {
          cv.width = (isl.width + m.width) * s + pad * 3;
          cv.height = m.height * s + pad * 2 + 30;
          const g = cv.getContext('2d');
          g.fillStyle = '#17130f';
          g.fillRect(0, 0, cv.width, cv.height);
          g.drawImage(isl, pad, pad + ((m.height - isl.height) * s) / 2, isl.width * s, isl.height * s);
          g.drawImage(m, pad * 2 + isl.width * s, pad, m.width * s, m.height * s);
          g.fillStyle = '#cfc8b8';
          g.font = '20px sans-serif';
          g.fillText('The island: 640 m x 640 m', pad, cv.height - 22);
          g.fillText('The mainland: 1280 m x 1280 m, at the same scale', pad * 2 + isl.width * s, cv.height - 22);
          done(cv.toDataURL('image/png'));
        };
      });
    }, islandMap);
    writeFileSync(join(out, 'map-island-and-mainland.png'), Buffer.from(both.split(',')[1], 'base64'));
    process.stdout.write('map-island-and-mainland ');
    await hud(true);
    await p.evaluate(() => window.__game.toggleMap(true));
    await sleep(2500);
    await shot('map-screen-mainland');
    await p.evaluate(() => window.__game.toggleMap(false));
    await hud(false);
  }
  // ---- the city: from above, and its streets at eye height in six of its districts
  if (want('city')) {
    await cam([city.x - 30, city.h + 120, city.z + 190], [city.x, city.h, city.z + 20], { fog: clear, far: 900, wait: 3000 });
    await shot('city-01-from-above');
    await cam([city.x + 40, city.h + 45, city.z + 60], [city.x - 40, city.h + 6, city.z - 30], { fog: clear, far: 900, wait: 2500 });
    await shot('city-02-over-the-roofs');
    await cam([city.x - G2 + 6, city.h + 4.4, city.z + 2.4], [city.x - 40, city.h + 3, city.z - 1]);
    await shot('street-01-main-street');
    await cam([city.x - 56 + 1.2, eye, city.z + G2 - 14], [city.x - 56, city.h + 5, city.z]);
    await shot('street-02-a-side-street');
    await cam([city.x + 56 - 1, eye, city.z - 56 - 26], [city.x + 56, city.h + 4, city.z + 100]);
    await shot('street-03-a-crossing');
    await cam([city.x + 2, eye + 1.2, city.z + 56 + 2.5], [city.x + 60, city.h + 3, city.z + 56], { cycle: 0.25 }); // (noon: the street runs east, in its south side's shadow)
    await shot('street-04-east-along-a-street');
    await cam([city.x + 112 + 2.6, eye, city.z - 20], [city.x + 112 - 6, city.h + 9, city.z - 60]);
    await shot('street-05-looking-up');
    await front('terrace', 'street-06-a-row-of-shops', 14, 3, 10, 5);
    await front('flats', 'street-07-a-walk-up', 13, 4, 8, 8);
    await front('office', 'street-08-an-office-block', 15, 3, 9, 10);
    if (I.glass.length) {
      // (a tower of glass and steel, from the corner of it the sun is on)
      const [bx, bz, by, ry, w, d, h] = I.glass[0];
      const B = { x: bx, z: bz, ry };
      // (from over the roofs beside it: the street at its foot is too narrow to see it from)
      const [x, z] = [bx + Math.sign(sun[0] || 1) * (w / 2 + 34), bz + Math.sign(sun[1] || 1) * (d / 2 + 34)];
      void B;
      void ry;
      await cam([x, by + h * 0.75, z], [bx, by + h * 0.5, bz], { fog: 0.6 });
      await shot('street-09-a-glass-tower');
    }
  }
  // ---- its ruin: the tower across the street, a building cut open, a burnt block, the army's last stands, a jam
  if (want('ruin')) {
    const fell = I.lots.find((l) => l.fell);
    if (I.across.length && fell) {
      const [ax, az] = I.across.reduce((m, q) => (q[2] * q[3] > m[2] * m[3] ? q : m)); // (the longest length of it)
      const dir = Math.sign(ax - fell.x) || 1;
      const sd = sun[1] >= 0 ? 1 : -1; // (the side of it the sun is on)
      await cam([ax - dir * 12, eye + 0.4, az + sd * 22], [ax - dir * 2, city.h + 3.5, az]);
      await shot('ruin-01-the-fallen-tower');
      await cam([ax - dir * 26, city.h + 30, az + sd * 40], [ax + dir * 2, city.h + 2, az], { fog: 0.6 });
      await shot('ruin-02-the-fallen-tower-from-above');
      await cam([ax - dir * 6.2, eye + 1.4, az + sd * 13], [ax - dir * 6.2, city.h + 2, az - sd * 8]);
      await shot('ruin-03-through-the-break');
      await cam([ax + dir * 20, city.h + 5, az + sd * 20], [ax, city.h + 2.5, az]);
      await shot('ruin-03b-what-it-fell-on');
    }
    if (I.open.length) {
      const [bx, bz, by, ry, w, d, h] = I.open[0];
      const B = { x: bx, z: bz, ry };
      for (const [sx, sz, name] of [[1, -1, 'ruin-04-a-building-cut-open'], [-1, -1, 'ruin-05-cut-open-the-other-end'], [1, 1, 'ruin-05b-cut-open-from-behind']]) {
        const [x, z] = lw(B, sx * (w / 2 + 15), sz * (d / 2 + 13));
        await cam([x, by + h * 0.9, z], [bx, by + h * 0.5, bz], { fog: 0.6 });
        await shot(name);
      }
    }
    await front('collapse', 'ruin-06-the-collapsed-block', 12, 3, 10, 5);
    await front('burnt', 'ruin-07-a-burnt-block', 17, 6.5, 8, 4);
    await front('ruin', 'ruin-08-a-shell', 12, 1.8, 6, 5);
    const blocks = I.wire.filter(([x, z]) => Math.abs(x - city.x) < G2 - 20 && Math.abs(z - city.z) < G2 - 20);
    for (const [k, [wx, wz, ry]] of blocks.filter((_, i) => i % 2 === 0).slice(0, 2).entries()) {
      const ns = Math.abs(Math.sin(ry)) < 0.5; // (a street that runs north-south: the wire lies east-west)
      await cam(ns ? [wx + 2.5, eye + 3.4, wz - 19] : [wx - 19, eye + 3.4, wz - 2.5], [wx, city.h + 1, wz + (ns ? 5 : 0)]);
      await shot(`ruin-${String(9 + k * 2).padStart(2, '0')}-a-roadblock`);
      await cam(ns ? [wx - 3, eye + 6, wz + 24] : [wx + 24, eye + 6, wz + 3], [wx, city.h + 1, wz]);
      await shot(`ruin-${String(10 + k * 2).padStart(2, '0')}-the-roadblock-from-behind`);
    }
    // (a bus in a street, not the depot's)
    const depots = I.lots.filter((l) => l.what === 'depot');
    const bus = I.bus.find(([x, z]) => Math.abs(x - city.x) < G2 && Math.abs(z - city.z) < G2 && depots.every((l) => Math.abs(x - l.x) > l.w / 2 + 2 || Math.abs(z - l.z) > l.d / 2 + 2));
    if (bus) {
      const ns = Math.abs(Math.sin(bus[2])) < 0.5;
      await cam(ns ? [bus[0] + 1, eye + 4.5, bus[1] + 24] : [bus[0] + 24, eye + 4.5, bus[1] + 1], [bus[0], city.h + 1, bus[1]]);
      await shot('ruin-13-a-jam');
    }
  }
  // ---- the landmarks, each from the street in front of it
  if (want('landmarks')) {
    for (const [what, name, back, up, side, lookUp] of [['hospital', 'landmark-01-calder-general', 10, 5, 12, 5], ['church', 'landmark-02-st-brendans', 14, 3, -9, 8], ['gas', 'landmark-03-the-filling-station', 17, 7, 10, 2], ['cinema', 'landmark-04-the-cinema', 16, 2.4, 9, 5], ['subway', 'landmark-05-the-subway-entrance', 5, 3.2, 5, 1], ['carpark', 'landmark-06-the-car-park', 20, 11, -16, 4], ['police', 'landmark-07-the-police-station', 12, 2.2, 6, 4], ['depot', 'landmark-08-the-bus-depot', 13, 5, 14, 3], ['warehouse', 'landmark-09-a-warehouse', 14, 3, 10, 5]]) await front(what, name, back, up, side, lookUp);
    const hosp = lotOf('hospital');
    if (hosp) {
      const [x, z] = lw(hosp, 3, -17);
      const [tx, tz] = lw(hosp, -4, 6);
      await cam([x, city.h + 1.8, z], [tx, city.h + 3.4, tz]);
      await shot('landmark-10-the-hospital-forecourt');
    }
  }
  // ---- rooms, from inside
  if (want('rooms')) {
    const shop = lotOf('grocery') || lotOf('hardware');
    if (shop) await room(shop, [6.4, -shop.d / 2 + 2.4], [-5, -shop.d / 2 + 10], 'interior-01-a-shop');
    const hosp = lotOf('hospital');
    await room(hosp, [13, 6.4], [-10, 11], 'interior-02-the-emergency-room');
    await room(hosp, [-7.2, 14.4], [-14, 18], 'interior-03-a-ward');
    const flat = lotOf('flats');
    if (flat) await room(flat, [-7.6, -flat.d / 2 + 2.2], [-3, -flat.d / 2 + 12], 'interior-04-a-flat');
    if (flat) await room(flat, [8.2, -flat.d / 2 + 2.4], [5, -flat.d / 2 + 13], 'interior-05-a-kitchen');
    const pol = lotOf('police');
    if (pol) await room(pol, [-6.5, -pol.d / 2 + 2.2], [5, -pol.d / 2 + 7], 'interior-06-the-police-station');
    if (pol) await room(pol, [-2.4, -pol.d / 2 + 12], [-8, -pol.d / 2 + 13.4], 'interior-07-the-cell');
    const off = lotOf('office');
    if (off) await room(off, [-7, -off.d / 2 + 2.4], [5, -off.d / 2 + 9], 'interior-08-an-office-lobby');
    const cin = lotOf('cinema');
    if (cin) await room(cin, [-12, -cin.d / 2 + 7.2], [8, -cin.d / 2 + 15], 'interior-09-the-picture-house', 2.2);
    const ch = lotOf('church');
    if (ch) await room(ch, [0, -ch.d / 2 + 3.2], [0, -ch.d / 2 + 14], 'interior-10-the-church');
  }
  // ---- the country: the river and its crossings, the coast, places out on the plain
  if (want('country')) {
    for (const [k, br] of I.river.slice(0, 2).entries()) {
      const [dx, dz] = [Math.cos(br.ry), -Math.sin(br.ry)]; // (the way the road runs over it)
      await cam([br.x - dx * 26 - dz * 16, br.y + 6, br.z - dz * 26 + dx * 16], [br.x, br.y, br.z], { fog: 0.6 });
      await shot(`river-0${k + 1}-a-bridge`);
    }
    if (I.river.length) {
      const br = I.river[0];
      const [dx, dz] = [Math.cos(br.ry), -Math.sin(br.ry)];
      await cam([br.x - dx * 14 + dz * 1.2, br.y + 1.7, br.z - dz * 14 - dx * 1.2], [br.x + dx * 30, br.y + 1.5, br.z + dz * 30]);
      await shot('river-03-over-the-bridge');
      await cam([br.x + dz * 60, br.y + 34, br.z - dx * 60], [br.x, br.y - 2, br.z], { fog: clear, far: 900, wait: 2500 });
      await shot('river-04-past-the-city');
    }
    const head = I.places[27];
    await cam([I.sea + 30, 80, head.z + 40], [I.sea + 70, 0, head.z - 260], { fog: 0.18, far: 1100, wait: 3000 });
    await shot('coast-01-north-from-over-the-bridgehead');
    await cam([I.sea + 30, 80, head.z - 40], [I.sea + 70, 0, head.z + 260], { fog: 0.18, far: 1100, wait: 3000 });
    await shot('coast-02-south-from-over-the-bridgehead');
    const NAMES = { 53: 'the-boat-works', 54: 'the-drive-in', 55: 'engine-company-9', 60: 'evacuation-point-bravo', 62: 'the-guard-motor-pool', 63: 'landing-zone-kilo', 56: 'halvorsen-grain', 57: 'mile-4-diner' };
    let n = 0;
    for (const id of Object.keys(NAMES)) {
      const zn = I.places[id];
      if (!zn) continue;
      const back = zn.flat + 16;
      const side = zn.flat * 0.5;
      const at = [zn.x - Math.sin(zn.ry) * back + Math.cos(zn.ry) * side, zn.h + 10 + zn.flat * 0.3, zn.z - Math.cos(zn.ry) * back - Math.sin(zn.ry) * side];
      await cam(at, [zn.x, zn.h + 2, zn.z], { fog: 0.6, wait: 2000 });
      await shot(`place-${String(++n).padStart(2, '0')}-${NAMES[id]}`);
    }
  }
  // ---- the airfield
  if (want('airfield')) {
    const R = I.runway;
    const mid = (R.z0 + R.z1) / 2;
    const term = I.places[30], hang = I.places[31];
    await cam([R.x - 130, R.y + 70, mid + 190], [R.x - 60, R.y, mid + 50], { fog: clear, far: 900, wait: 3000 });
    await shot('airfield-01-from-above');
    await cam([term.x - 36, term.h + 2, term.z - 16], [term.x, term.h + 6, term.z + 4]);
    await shot('airfield-02-the-terminal-and-its-tower');
    await cam([term.x - 3, term.h + 1.8, term.z - 3.6], [term.x + 2, term.h + 1.3, term.z + 8]);
    await shot('airfield-03-inside-the-terminal');
    await cam([hang.x + 62, hang.h + 2, hang.z - 24], [hang.x, hang.h + 4, hang.z + 6]);
    await shot('airfield-04-the-hangars');
    await cam([R.x - 30, R.y + 5, mid + 60], [R.x - 64, R.y + 1, mid + 124]);
    await shot('airfield-05-the-apron');
    await cam([R.x - 170, R.y + 2.4, mid + 12], [R.x - 142, R.y + 1.4, mid + 24]);
    await shot('airfield-06-the-gate');
    await cam([R.x + 1.5, R.y + 1.8, R.z1 - 2], [R.x, R.y + 1, R.z0]);
    await shot('airfield-07-down-the-runway');
  }
  // ---- the plane from four sides, as it is found and as it is mended (the client's own model: the counts are the
  // server's, here set by hand)
  if (want('plane')) {
    const c = I.car;
    const parts = (a, fixed) =>
      p.evaluate(
        (a, fixed) => {
          const q = window.__game.live && window.__game.live.plane;
          if (!q || !q.setParts) return false;
          q.setParts(a);
          q.setFixed(fixed);
          return true;
        },
        a,
        fixed,
      );
    const round = async (tag) => {
      for (const [name, dx, dy, dz] of [['front-left', -8.5, 2.6, -9], ['rear-right', 8.5, 3.2, 9], ['left-side', -13.5, 2, 0], ['nose-on', 0.4, 2.2, -13]]) {
        await cam([c.x + dx, c.y + dy, c.z + dz], [c.x, c.y + 1.4, c.z - 0.5], { wait: pick && !pick.test(`plane-${tag}-${name}`) ? 0 : 1200 });
        await shot(`plane-${tag}-${name}`);
      }
    };
    await round('01-as-found');
    await cam([c.x - 5.2, c.y + 2.0, c.z - 6.4], [c.x - 2.5, c.y + 1.5, c.z - 1.6], { wait: 1200 });
    await shot('plane-01-as-found-the-bare-engine');
    console.log('\n quest plane:', await parts([1, 1, 0, 0, 0], false));
    await shot('plane-02-propeller-and-magneto-fitted');
    await parts([1, 1, 1, 1, 3], true);
    await round('03-mended');
  }
  // ---- the take-off, its clock pinned at each shot, and the end screen (/takeoff hold: the server waits)
  if (want('takeoff')) {
    await free();
    await hud(true);
    await chat('/plane');
    await sleep(1500);
    await chat('/takeoff hold');
    for (let i = 0; i < 160 && !(await p.evaluate(() => !!window.__game.cine)); i++) await sleep(250);
    const pinT = (t) => p.evaluate((t) => window.__game.cine && (window.__game.cine.pin = t), t);
    for (const [t, name] of [[1.6, 'takeoff-01-rolling'], [4.4, 'takeoff-02-the-dead-on-the-strip'], [5.6, 'takeoff-03-it-leaves-them'], [7.8, 'takeoff-04-wheels-up'], [10.8, 'takeoff-05-away']]) {
      if (!(await p.evaluate(() => !!window.__game.cine))) break;
      await pinT(t);
      await sleep(1600);
      await shot(name);
    }
    // (the take-off over: the end screen, held as well)
    await chat('/takeoff go');
    await p.evaluate(() => {
      const c = window.__game.cine;
      if (c) {
        delete c.pin;
        c.t = 99;
      }
    });
    for (let i = 0; i < 120 && (await p.evaluate(() => window.__game.overlay)) !== 'victory'; i++) await sleep(250);
    await sleep(1500);
    await shot('end-screen');
    await chat('/takeoff go');
  }
  console.log('\nprograms', (await info()).programs, `(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log('shot: draw calls, triangles');
  for (const [name, calls, tris] of costs) console.log(`  ${name}: ${calls}, ${tris}`);
  if (errors.length) console.log('page errors:\n  ' + [...new Set(errors)].slice(0, 20).join('\n  '));
} finally {
  await chrome?.close().catch((e) => console.error(String(e)));
  game?.stop();
}
