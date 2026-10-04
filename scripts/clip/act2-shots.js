// Shots of the run's second act for a pull request, in the real game: the crossing's cutscene shot by shot and
// second by second, the bridge, the mainland's field map beside the island's at one scale, the city (from above, its
// streets, its landmarks, its ruin, its rooms), the places out on the plain, the airfield, the plane as the parts
// go onto it, the runway stand and the take-off. One headless browser for all of it (lib.js launchChrome: one at a
// time, software rendering), one game server on a free port with the debug chat commands (/cross hold, /place,
// /plane, /engine, /takeoff). Every shot's draw calls and triangles are printed at the end.
//
// usage: node scripts/clip/act2-shots.js [--seed 1337] [--out docs/pr-images] [--only cutscene,bridge,map,city,places,airfield,plane,stand,takeoff] [--frames 1]
//   --frames n   also save a frame of the crossing every n seconds (the motion, for judging the pacing): 0 = none
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, parseArgs, sleep, startGame, launchChrome, LIFE_MAX, list } from './lib.js';

const args = parseArgs(process.argv.slice(2), { seed: '1337', out: join(REPO, 'docs', 'pr-images'), frames: '0' });
const only = list(args.only);
const want = (k) => !only || only.includes(k);
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

let game = null;
let chrome = null;
try {
  game = await startGame(REPO, { seed: +args.seed, build: true, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
  chrome = await launchChrome({ width: 1280, height: 720, life: LIFE_MAX, storage: { 'stn.settings': JSON.stringify({ quality: 'medium', renderScale: 1 }) } });
  const p = chrome.page;
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
    await p.screenshot({ path: join(out, `${name}.png`) });
    const c = await p.evaluate(() => new Promise((done) => {
        // (a frame is several passes, and the renderer's counters start again at each: count one whole frame)
        const info = window.__game.renderer.renderer.info;
        info.autoReset = false;
        info.reset();
        requestAnimationFrame(() => {
          const out = [info.render.calls, info.render.triangles];
          info.autoReset = true;
          done(out);
        });
      }));
    costs.push([name, ...c]);
    process.stdout.write(`${name} `);
  };
  const hud = (on) => p.evaluate((on) => document.body.classList.toggle('clip-nohud', !on), on);
  // a free camera: where it stands, what it looks at, the hour (Environment's cycle: 0 sunrise .. 0.25 noon)
  const cam = async (at, look, cycle = 0.2, wait = 1800) => {
    await p.evaluate(
      (at, look, cycle) => {
        const g = window.__game;
        const dx = look[0] - at[0], dy = look[1] - at[1], dz = look[2] - at[2];
        g.debugCam = { x: at[0], y: at[1], z: at[2], yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
        g.debugCycle = cycle;
        g.renderer.vmScene.visible = false;
      },
      at,
      look,
      cycle,
    );
    await sleep(wait);
  };
  const free = () => p.evaluate(() => {
    const g = window.__game;
    g.debugCam = null;
    g.debugCycle = undefined;
    g.renderer.vmScene.visible = true;
  });
  const info = () => p.evaluate(() => {
    const g = window.__game;
    const w = g.world;
    const zone = (id) => (w.zoneById[id] ? { x: w.zoneById[id].x, z: w.zoneById[id].z, h: w.zoneById[id].h, ry: w.zoneById[id].ry } : null);
    return { act: g.act, phase: g.global.phase, car: w.car, bridge: w.bridge ? { x0: w.bridge.x0, x1: w.bridge.x1, z: w.bridge.z, y: w.bridge.deckY, broken: w.bridge.spans[w.bridge.broken] } : null, zones: [27, 28, 29, 30, 31, 32, 33, 34].map(zone), places: Object.fromEntries(w.zones.map((z) => [z.id, { x: z.x, z: z.z, h: z.h, ry: z.ry, flat: z.flat }])), lots: w.city ? w.city.lots.map((l) => ({ x: l.x, z: l.z, w: l.w, d: l.d, ry: l.ry, what: l.what })) : [], across: (w.parts || []).filter((q) => q.across).map((q) => [q.x, q.z, q.sx, q.sz]), wire: (w.props || []).filter((q) => q.type === 'razor_wire').map((q) => [q.x, q.z, q.ry]), jams: (w.sites || []).filter((q) => q.type === 'jam').map((q) => [q.x, q.z, q.ry]), lake: w.lake || null, city: w.city ? { x: w.city.x, z: w.city.z } : null, runway: w.runway, programs: g.renderer.renderer.info.programs.length };
  });
  // the island's field map, kept for the two maps side by side
  const islandMap = await p.evaluate(() => window.__game.ui.map.baked().toDataURL('image/jpeg', 0.9));

  // ---- the crossing: the cutscene with its clock pinned at each moment
  await chat('/cross hold');
  await sleep(1500);
  const pin = (t) => p.evaluate((t) => window.__game.cine && (window.__game.cine.pin = t), t);
  if (want('cutscene') || want('island')) {
    for (const [t, name] of [[1.6, 'cutscene-01-leaving-the-island'], [3.0, 'cutscene-02-the-horde-behind'], [4.6, 'cutscene-03-the-horde-second-angle'], [6.4, 'cutscene-04-onto-the-bridge']]) {
      await pin(t);
      await sleep(1600);
      await shot(name);
    }
  }
  if (only && only.length === 1 && only[0] === 'island') {
    console.log(JSON.stringify(await p.evaluate(() => { const g = window.__game; const c = g.cine; return { cine: !!c, t: c?.t, pin: c?.pin, fade: c?.screen.fade, cam: g.camera.position.toArray(), rot: [g.camera.rotation.x, g.camera.rotation.y], pose: c?.pose, far: c?.far, cyc: c?.cycle, expo: g.post?.exposure, phase: g.global.phase, tl: g.global.timeLeft, horde: c?.horde.length, road: c?.road?.len }; })));
    throw new Error('island only');
  }
  if (+args.frames > 0 && want('cutscene')) {
    const dir = join(out, 'cutscene-frames');
    mkdirSync(dir, { recursive: true });
    for (let t = 0.5; t < 7.2; t += +args.frames) {
      await pin(t);
      await sleep(900);
      await p.screenshot({ path: join(dir, `t${t.toFixed(1).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 80 });
    }
  }
  await chat('/cross go'); // (off the island: the clock was held there)
  // (the server puts the mainland up CROSSING.SWAP seconds in)
  for (let i = 0; i < 120 && (await p.evaluate(() => window.__game.act)) !== 2; i++) await sleep(250);
  await sleep(4000);
  console.log('\n', JSON.stringify(await info()));
  if (want('cutscene')) {
    for (const [t, name] of [[10.6, 'cutscene-05-the-approach'], [14.6, 'cutscene-06-the-damage'], [17.0, 'cutscene-07-the-damage-wrecks'], [20.2, 'cutscene-08-from-below'], [24.2, 'cutscene-09-the-gap'], [27.4, 'cutscene-10-past-the-gap'], [30.2, 'cutscene-11-the-skyline'], [33.2, 'cutscene-12-the-skyline-late'], [35.6, 'cutscene-13-arrival'], [37.9, 'cutscene-14-the-span-goes'], [38.9, 'cutscene-15-the-span-falls']]) {
      await pin(t);
      await sleep(2200);
      await shot(name);
    }
  }
  if (+args.frames > 0 && want('cutscene')) {
    const dir = join(out, 'cutscene-frames');
    mkdirSync(dir, { recursive: true });
    for (let t = 8.5; t < 40; t += +args.frames) {
      await pin(t);
      await sleep(900);
      await p.screenshot({ path: join(dir, `t${t.toFixed(1).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 80 });
    }
    process.stdout.write('frames ');
  }
  await p.evaluate(() => window.__game.cine && delete window.__game.cine.pin);
  await chat('/cross go');
  for (let i = 0; i < 80 && (await p.evaluate(() => window.__game.global.phase)) === 5; i++) await sleep(250);
  await chat('/cross skip');
  await sleep(2500);
  const I = await info();
  const br = I.bridge;
  const [head, city, works, term, hang, depot] = I.zones;

  // ---- the bridge, from four sides (the last span down, as it is in play)
  if (want('bridge')) {
    await hud(false);
    await cam([br.x1 + 34, br.y + 3, br.z + 16], [br.x1 - 60, br.y - 2, br.z], 0.12);
    await shot('bridge-01-from-the-bridgehead');
    await cam([br.x1 - 150, br.y + 26, br.z - 70], [br.x1 - 230, br.y, br.z], 0.2);
    await shot('bridge-02-from-above');
    await cam([br.broken.x0 + 20, br.y + 3.2, br.z + br.broken.lost * 16], [br.broken.x0 + 40, br.y, br.z], 0.2);
    await shot('bridge-03-the-broken-span');
    await cam([br.x1 - 200, br.y + 1.7, br.z + 1.5], [br.x1 - 120, br.y + 3, br.z], 0.2);
    await shot('bridge-04-on-the-deck');
    await cam([br.x1 - 100, -0.6, br.z + 40], [br.x1 - 150, br.y + 2, br.z], 0.2);
    await shot('bridge-05-from-the-water');
  }
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
    await free();
    await hud(true);
    await p.evaluate(() => window.__game.toggleMap(true));
    await sleep(2500);
    await shot('map-screen-mainland');
    await p.evaluate(() => window.__game.toggleMap(false));
  }
  // where things are: a lot of the city by what stands on it, a point of its own frame out in the world (its
  // front is -Z), a place by its id
  const lotOf = (what, n = 0) => I.lots.filter((l) => l.what === what)[n] || null;
  const lw = (L, lx, lz) => [L.x + Math.cos(L.ry) * lx + Math.sin(L.ry) * lz, L.z - Math.sin(L.ry) * lx + Math.cos(L.ry) * lz];
  const G2 = 168; // (half the grid of streets: GRID * PITCH / 2)
  const eye = city.h + 1.7;
  // ---- the city
  if (want('city')) {
    await hud(false);
    await cam([city.x - 20, city.h + 95, city.z + 150], [city.x, city.h, city.z + 20], 0.17, 3500);
    await shot('city-01-from-above');
    await cam([city.x + 150, city.h + 60, city.z - 150], [city.x + 40, city.h + 6, city.z - 40], 0.12, 3000);
    await shot('city-02-from-the-north-east');
    await cam([city.x - 60, city.h + 34, city.z + 70], [city.x + 30, city.h + 4, city.z - 30], 0.2, 2500);
    await shot('city-03-over-the-roofs');
    // streets, at eye height
    await cam([city.x - G2 + 6, eye, city.z + 1.5], [city.x, city.h + 5, city.z], 0.15);
    await shot('street-01-main-street');
    await cam([city.x - 56 + 1.2, eye, city.z + G2 - 14], [city.x - 56, city.h + 5, city.z], 0.22);
    await shot('street-02-a-side-street');
    await cam([city.x + 56 - 1, eye, city.z - 56 - 26], [city.x + 56, city.h + 4, city.z + 100], 0.3);
    await shot('street-03-a-crossing');
    await cam([city.x + 112 + 20, eye + 0.3, city.z + 56 + 1], [city.x - 60, city.h + 6, city.z + 56], 0.08);
    await shot('street-04-evening');
    await cam([city.x - 112 - 22, city.h + 7, city.z - 112 + 2], [city.x + 20, city.h + 2, city.z - 112], 0.2);
    await shot('street-05-from-a-first-floor');
    // the ruin: the tower across the street, the block that came down, a roadblock
    if (I.across.length) {
      const [ax, az] = I.across[1] || I.across[0];
      await cam([ax + 1.6, eye, az + 24], [ax, city.h + 2.4, az], 0.2);
      await shot('ruin-01-the-fallen-tower');
      await cam([ax - 30, city.h + 26, az + 34], [ax, city.h + 2, az], 0.2);
      await shot('ruin-02-the-fallen-tower-from-above');
    }
    const down = lotOf('collapse');
    if (down) {
      const [ux, uz] = lw(down, 26, -44);
      await cam([ux, city.h + 20, uz], [down.x, city.h + 5, down.z], 0.2);
      await shot('ruin-03-the-collapsed-block');
      const [vx, vz] = lw(down, 4, -30);
      await cam([vx, eye, vz], [down.x, city.h + 6, down.z], 0.2);
      await shot('ruin-04-the-collapsed-block-from-the-street');
    }
    const wire = I.wire.filter(([x, z]) => Math.abs(x - city.x) < G2 + 4 && Math.abs(z - city.z) < G2 + 4)[0];
    if (wire) {
      const ns = Math.abs(Math.sin(wire[2])) < 0.5; // (a street that runs north-south: the barriers lie east-west)
      await cam(ns ? [wire[0] + 2.5, eye + 0.4, wire[1] + 15] : [wire[0] + 15, eye + 0.4, wire[1] - 2.5], [wire[0], city.h + 1, wire[1]], 0.2);
      await shot('ruin-05-a-roadblock');
    }
    // the landmarks, each from the street in front of it
    for (const [what, name, back, up] of [['hospital', 'landmark-01-calder-general', 20, 7], ['church', 'landmark-02-st-brendans', 22, 5], ['gas', 'landmark-03-the-filling-station', 16, 4], ['cinema', 'landmark-04-the-cinema', 22, 6], ['subway', 'landmark-05-the-subway-entrance', 14, 3], ['carpark', 'landmark-06-the-car-park', 22, 7], ['police', 'landmark-07-the-police-station', 16, 4], ['depot', 'landmark-08-the-bus-depot', 24, 9], ['tower', 'landmark-09-a-tower', 40, 3]]) {
      const L = lotOf(what);
      if (!L) continue;
      const [x, z] = lw(L, 9, -L.d / 2 - back);
      await cam([x, city.h + up, z], [L.x, city.h + (what === 'tower' ? 16 : 4), L.z], 0.2);
      await shot(name);
    }
    // rooms, from inside: a shop, the emergency room, a ward, a flat, the police station
    const room = async (L, at, look, name) => {
      if (!L) return;
      const [x, z] = lw(L, at[0], at[1]);
      const [tx, tz] = lw(L, look[0], look[1]);
      await cam([x, city.h + 1.75, z], [tx, city.h + 1.2, tz], 0.2);
      await shot(name);
    };
    const shop = lotOf('grocery') || lotOf('hardware') || lotOf('pharmacy');
    if (shop) await room(shop, [6.4, -shop.d / 2 + 2.4], [-5, -shop.d / 2 + 10], 'interior-01-a-shop');
    const hosp = lotOf('hospital');
    await room(hosp, [12, -10.6], [-10, -5], 'interior-02-the-emergency-room');
    await room(hosp, [-13.6, 3], [-6, -1], 'interior-03-a-ward');
    const flat = lotOf('flats') || lotOf('block');
    if (flat) await room(flat, [flat.what === 'block' ? -17 : -6.6, -flat.d / 2 + 2.2], [flat.what === 'block' ? -13 : -3, -flat.d / 2 + 12], 'interior-04-a-flat');
    const pol = lotOf('police');
    if (pol) await room(pol, [-6.5, -pol.d / 2 + 2.2], [5, -pol.d / 2 + 7], 'interior-05-the-police-station');
  }
  // ---- the places out on the plain: each from in front of its gate, some from the ground, and the road between
  if (want('places')) {
    await hud(false);
    const NAMES = { 27: 'the-bridgehead', 29: 'kessler-ironworks', 33: 'eastgate', 34: 'truck-stop', 35: 'quarantine-camp', 36: 'route-9-checkpoint', 37: 'substation', 38: 'waterworks', 39: 'marina', 40: 'trailer-park', 41: 'salvage-yard', 42: 'mall', 43: 'school', 44: 'radio-mast', 45: 'motor-inn', 46: 'graveyard', 47: 'logging-camp', 48: 'flight-212', 49: 'westgate', 50: 'container-yard', 51: 'farm' };
    let n = 0;
    for (const id of Object.keys(NAMES)) {
      const zn = I.places[id];
      if (!zn) continue;
      const back = zn.flat + 26;
      const side = zn.flat * 0.5;
      const at = [zn.x - Math.sin(zn.ry) * back + Math.cos(zn.ry) * side, zn.h + 16 + zn.flat * 0.35, zn.z - Math.cos(zn.ry) * back - Math.sin(zn.ry) * side];
      await cam(at, [zn.x, zn.h + 2, zn.z], 0.2, 2200);
      await shot(`place-${String(++n).padStart(2, '0')}-${NAMES[id]}`);
    }
    for (const [id, name, lx, lz, tx, tz] of [[42, 'place-eye-01-the-mall', 0, -40, 0, 0], [39, 'place-eye-02-the-marina', -6, -10, 0, 30], [48, 'place-eye-03-flight-212', -4, -30, 0, 0], [35, 'place-eye-04-quarantine', 0, -34, 0, 0], [43, 'place-eye-05-the-school', -8, -34, 0, 0]]) {
      const zn = I.places[id];
      if (!zn) continue;
      const w = (x, z) => [zn.x + Math.cos(zn.ry) * x + Math.sin(zn.ry) * z, zn.z - Math.sin(zn.ry) * x + Math.cos(zn.ry) * z];
      await cam([w(lx, lz)[0], zn.h + 1.8, w(lx, lz)[1]], [w(tx, tz)[0], zn.h + 2.4, w(tx, tz)[1]], 0.2, 2200);
      await shot(name);
    }
    const ground = (x, z) => p.evaluate((x, z) => window.__game.world.heightAt(x, z), x, z);
    if (I.jams.length) {
      const [jx, jz, ry] = I.jams[0];
      const y = await ground(jx - Math.sin(ry) * 40, jz - Math.cos(ry) * 40);
      await cam([jx - Math.sin(ry) * 40 + 1.2, y + 1.8, jz - Math.cos(ry) * 40], [jx, y + 1.2, jz], 0.2, 2200);
      await shot('road-01-a-jam-on-route-9');
      await cam([jx - Math.sin(ry) * 30 + 26, y + 22, jz - Math.cos(ry) * 30], [jx, y, jz], 0.2, 2200);
      await shot('road-02-the-jam-from-above');
    }
    if (I.lake) {
      const y = await ground(I.lake.x + I.lake.r + 30, I.lake.z);
      await cam([I.lake.x + I.lake.r + 30, y + 9, I.lake.z + 20], [I.lake.x, 0, I.lake.z], 0.14, 2200);
      await shot('country-01-the-lake');
    }
    await cam([head.x + 40, head.h + 60, head.z], [head.x + 400, 0, head.z + 40], 0.2, 3000);
    await shot('country-02-inland-from-over-the-bridgehead');
    await cam([120, 90, 190], [260, 0, 40], 0.2, 3000);
    await shot('country-03-over-the-plain');
    await cam([head.x - 4, head.h + 1.7, head.z + 3], [city.x, city.h + 14, city.z], 0.03, 2500);
    await shot('country-04-skyline-from-the-bridgehead');
  }
  // ---- the airfield
  if (want('airfield')) {
    await hud(false);
    const R = I.runway;
    const mid = (R.z0 + R.z1) / 2;
    await cam([R.x - 150, R.y + 48, mid + 150], [R.x - 70, R.y, mid + 90], 0.2, 3500);
    await shot('airfield-01-from-above');
    await cam([R.x + 90, R.y + 60, R.z1 + 90], [R.x - 70, R.y, mid + 60], 0.14, 3000);
    await shot('airfield-02-from-the-south-east');
    await cam([term.x - 44, term.h + 2, term.z - 14], [term.x, term.h + 4, term.z + 2], 0.2);
    await shot('airfield-03-the-terminal');
    await cam([term.x - 3, term.h + 1.8, term.z - 3.6], [term.x + 2, term.h + 1.3, term.z + 8], 0.2);
    await shot('airfield-04-inside-the-terminal');
    await cam([hang.x + 62, hang.h + 2, hang.z - 24], [hang.x, hang.h + 4, hang.z + 6], 0.2);
    await shot('airfield-05-the-hangars');
    await cam([hang.x + 16, hang.h + 1.8, hang.z - 22], [hang.x - 6, hang.h + 2.5, hang.z - 24], 0.2);
    await shot('airfield-06-inside-a-hangar');
    await cam([depot.x - 40, depot.h + 9, depot.z + 34], [depot.x, depot.h + 2, depot.z], 0.2);
    await shot('airfield-07-the-fuel-depot');
    await cam([R.x - 166, R.y + 2, mid + 30], [R.x - 142, R.y + 1.4, mid + 20], 0.2);
    await shot('airfield-08-the-gate');
    await cam([R.x + 1.5, R.y + 1.8, R.z1 - 2], [R.x, R.y + 1, R.z0], 0.22);
    await shot('airfield-09-down-the-runway');
    await cam([R.x - 30, R.y + 6, mid + 60], [R.x - 70, R.y + 1, mid + 110], 0.2);
    await shot('airfield-10-the-apron');
    const crash = I.places[48];
    if (crash) {
      await cam([crash.x + 30, crash.h + 9, crash.z + 44], [crash.x, crash.h + 2, crash.z], 0.2);
      await shot('airfield-11-the-crash-off-the-runway-end');
    }
  }
  // ---- the plane, as the parts go onto it (the client's own model: the counts are the server's, here set by hand)
  if (want('plane')) {
    await hud(false);
    const c = I.car;
    const parts = (a, fixed) => p.evaluate((a, fixed) => {
      const q = window.__game.live && window.__game.live.plane;
      if (!q || !q.setParts) return false;
      q.setParts(a);
      q.setFixed(fixed);
      return true;
    }, a, fixed);
    const round = async (tag) => {
      await cam([c.x - 8.5, c.y + 2.6, c.z - 8], [c.x, c.y + 1.5, c.z - 0.5], 0.2, 1500);
      await shot(`plane-${tag}-front`);
      await cam([c.x + 8.5, c.y + 3.4, c.z + 8], [c.x, c.y + 1.4, c.z], 0.2, 1500);
      await shot(`plane-${tag}-rear`);
    };
    await round('01-as-found');
    await cam([c.x - 5.5, c.y + 2.2, c.z - 6.5], [c.x - 2.5, c.y + 1.7, c.z - 1], 0.2, 1500);
    await shot('plane-01-as-found-an-engine');
    console.log('\n quest plane:', await parts([1, 1, 0, 0, 0], false));
    await round('02-propeller-and-magneto-fitted');
    await parts([1, 1, 1, 1, 0], false);
    await round('03-all-but-the-fuel');
    await parts([1, 1, 1, 1, 3], true);
    await round('04-mended');
    await cam([c.x - 5.5, c.y + 2.2, c.z - 6.5], [c.x - 2.5, c.y + 1.7, c.z - 1], 0.2, 1500);
    await shot('plane-04-mended-an-engine');
    await free();
    await hud(true);
    await chat('/place 28');
    await sleep(2500);
    await shot('hud-01-plane-parts-objective');
  }
  // ---- the runway stand, and the take-off
  if (want('stand')) {
    await free();
    await hud(true);
    await chat('/plane');
    await sleep(1500);
    await chat('/engine');
    await sleep(9000);
    await p.evaluate(() => {
      const g = window.__game;
      g.input.yaw = 0.25;
      g.input.pitch = 0.02;
    });
    await sleep(6000);
    await shot('stand-01-the-runway-stand');
    await hud(false);
    const c = I.car;
    await cam([c.x - 26, c.y + 9, c.z + 24], [c.x - 6, c.y + 1, c.z - 30], 0.4, 2500);
    await shot('stand-02-from-above');
    await free();
  }
  if (want('takeoff')) {
    await hud(true);
    // (the server's clock is not held through the take-off - TAKEOFF_TIME of it and the run is won - so the shots are
    // taken quickly, each with the cutscene's own clock pinned)
    await chat('/takeoff');
    await sleep(700);
    const pinT = (t) => p.evaluate((t) => window.__game.cine && (window.__game.cine.pin = t), t);
    for (const [t, name] of [[10.6, 'takeoff-04-away'], [7.6, 'takeoff-03-wheels-up'], [4.6, 'takeoff-02-the-dead-on-the-strip'], [1.6, 'takeoff-01-rolling']]) {
      if (!(await p.evaluate(() => !!window.__game.cine))) break; // (it is over: the end screen is up)
      await pinT(t);
      await sleep(900);
      await shot(name);
    }
    await p.evaluate(() => window.__game.cine && delete window.__game.cine.pin);
    for (let i = 0; i < 80 && (await p.evaluate(() => window.__game.global.phase)) !== 4; i++) await sleep(200); // (PHASE.VICTORY)
    await sleep(1200);
    await shot('end-screen');
  }
  console.log('\nprograms', (await info()).programs);
  console.log('shot: draw calls, triangles');
  for (const [name, calls, tris] of costs) console.log(`  ${name}: ${calls}, ${tris}`);
} finally {
  await chrome?.close().catch((e) => console.error(String(e)));
  game?.stop();
}
