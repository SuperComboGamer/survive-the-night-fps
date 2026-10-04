// Shots of the run's second act for a pull request, in the real game: the crossing's cutscene frame by frame, the
// bridge, the mainland from above beside the island at the same scale, the map screen, the city, the ironworks, the
// airfield, the plane's parts on the HUD, the runway stand and the take-off. One headless browser for all of it
// (lib.js launchChrome: one at a time, software rendering), one game server on a free port with the debug chat
// commands (/cross hold, /place, /plane, /engine, /takeoff).
//
// usage: node scripts/clip/act2-shots.js [--seed 1337] [--out docs/pr-images] [--only cutscene,bridge,map,places,stand,takeoff] [--frames 1]
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
  const shot = async (name) => {
    await p.screenshot({ path: join(out, `${name}.png`) });
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
    return { act: g.act, phase: g.global.phase, car: w.car, bridge: w.bridge ? { x0: w.bridge.x0, x1: w.bridge.x1, z: w.bridge.z, y: w.bridge.deckY, broken: w.bridge.spans[w.bridge.broken] } : null, zones: [27, 28, 29, 30, 31, 32, 33, 34].map(zone), city: w.city ? { x: w.city.x, z: w.city.z } : null, runway: w.runway, programs: g.renderer.renderer.info.programs.length };
  });
  // the island's field map, kept for the two maps side by side
  const islandMap = await p.evaluate(() => window.__game.ui.map.baked().toDataURL('image/jpeg', 0.9));

  // ---- the crossing: the cutscene with its clock pinned at each moment
  await chat('/cross hold');
  await sleep(1500);
  const pin = (t) => p.evaluate((t) => window.__game.cine && (window.__game.cine.pin = t), t);
  if (want('cutscene') || want('island')) {
    for (const [t, name] of [[1.2, 'cutscene-01-leaving-the-island'], [4.8, 'cutscene-02-the-horde-behind']]) {
      await pin(t);
      await sleep(1600);
      await shot(name);
    }
  }
  if (only && only.length === 1 && only[0] === 'island') {
    console.log(JSON.stringify(await p.evaluate(() => { const g = window.__game; const c = g.cine; return { cine: !!c, t: c?.t, pin: c?.pin, fade: c?.screen.fade, cam: g.camera.position.toArray(), rot: [g.camera.rotation.x, g.camera.rotation.y], pose: c?.pose, far: c?.far, cyc: c?.cycle, expo: g.post?.exposure, phase: g.global.phase, tl: g.global.timeLeft, horde: c?.horde.length, road: c?.road?.len }; })));
    throw new Error('island only');
  }
  await chat('/cross go'); // (off the island: the clock was held there)
  // (the server puts the mainland up CROSSING.SWAP seconds in)
  for (let i = 0; i < 120 && (await p.evaluate(() => window.__game.act)) !== 2; i++) await sleep(250);
  await sleep(4000);
  console.log('\n', JSON.stringify(await info()));
  if (want('cutscene')) {
    for (const [t, name] of [[11.5, 'cutscene-03-the-approach'], [16.4, 'cutscene-04-on-the-deck'], [18.2, 'cutscene-05-past-the-wreck'], [21.5, 'cutscene-06-from-the-water'], [26.5, 'cutscene-07-the-broken-span'], [29.5, 'cutscene-08-threading-the-gap'], [33.2, 'cutscene-09-the-skyline'], [35.6, 'cutscene-10-arrival'], [38.4, 'cutscene-11-the-span-falls']]) {
      await pin(t);
      await sleep(2200);
      await shot(name);
    }
  }
  if (+args.frames > 0) {
    const dir = join(out, 'cutscene-frames');
    mkdirSync(dir, { recursive: true });
    for (let t = 9.5; t < 40; t += +args.frames) {
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
  // ---- places
  if (want('places')) {
    await hud(false);
    await cam([city.x - 4, city.h + 60, city.z + 150], [city.x, city.h + 8, city.z], 0.17);
    await shot('city-01-from-above');
    await cam([city.x - 110, city.h + 1.7, city.z + 2], [city.x, city.h + 6, city.z], 0.15);
    await shot('city-02-main-street');
    await cam([city.x + 28, city.h + 1.7, city.z - 54], [city.x + 28, city.h + 9, city.z + 40], 0.3);
    await shot('city-03-a-side-street');
    await cam([head.x - 4, head.h + 1.7, head.z + 3], [city.x, city.h + 14, city.z], 0.03);
    await shot('city-04-skyline-from-the-bridgehead');
    await cam([works.x + 60, works.h + 22, works.z - 60], [works.x, works.h + 2, works.z], 0.2);
    await shot('ironworks-01');
    await cam([I.runway.x - 60, I.runway.y + 34, I.runway.z1 + 60], [I.car.x - 40, I.car.y, I.car.z - 60], 0.2);
    await shot('airfield-01-from-above');
    await cam([I.car.x - 16, I.car.y + 2.2, I.car.z + 12], [I.car.x, I.car.y + 1.6, I.car.z], 0.2);
    await shot('airfield-02-the-plane');
    await cam([I.car.x + 3, I.car.y + 1.7, I.car.z + 20], [I.car.x, I.car.y + 1, I.car.z - 200], 0.22);
    await shot('airfield-03-down-the-runway');
    // an interior, in first person, the HUD on: a shop in the city
    await free();
    await hud(true);
    const lot = await p.evaluate(() => {
      const c = window.__game.world.containers.find((k) => k.zone === 28 && k.ctype === 8);
      return c ? [c.x, c.z] : null;
    });
    if (lot) {
      await chat(`/tp ${lot[0] + 2.5} ${lot[1] - 3}`);
      await sleep(1500);
      await p.evaluate((lot) => {
        const g = window.__game;
        const c = g.renderer.camera.position;
        g.input.yaw = Math.atan2(-(lot[0] - c.x), -(lot[1] - c.z));
        g.input.pitch = -0.05;
      }, lot);
      await sleep(1500);
      await shot('city-05-an-interior');
    }
    await chat(`/place 28`);
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
    await chat('/takeoff');
    await sleep(1200);
    const pinT = (t) => p.evaluate((t) => window.__game.cine && (window.__game.cine.pin = t), t);
    for (const [t, name] of [[2.4, 'takeoff-01-rolling'], [6.3, 'takeoff-02-wheels-up'], [9.4, 'takeoff-03-away']]) {
      await pinT(t);
      await sleep(2000);
      await shot(name);
    }
    await p.evaluate(() => window.__game.cine && delete window.__game.cine.pin);
    await sleep(3500);
    await shot('end-screen');
  }
  console.log('\n', JSON.stringify(await info()));
} finally {
  await chrome?.close().catch((e) => console.error(String(e)));
  game?.stop();
}
