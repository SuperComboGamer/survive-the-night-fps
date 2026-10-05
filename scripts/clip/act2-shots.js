// Shots of the run's second act for a pull request, in the real game: the crossing's cutscene shot by shot and
// second by second, the mainland's field map beside the island's at one scale, the city (from above, its streets,
// its ruin, its landmarks, its rooms), the river, the coast and the places out on the plain, the airfield, the plane
// from four sides as it is found and as it is mended, the take-off and the end screen. One headless browser for a
// run of it (lib.js launchChrome: one at a time, software rendering), one game server on a free port with the debug
// chat commands (/cross hold, /place, /plane, /takeoff hold). Every shot's draw calls and triangles are printed at
// the end.
//
// A browser lives fifteen minutes (lib.js LIFE_MAX) and a shot of the city takes ten to fifteen seconds in software
// (about forty shots is a run): the whole list is five runs of this, each well inside that -
//   --only cutscene --frames 1            the crossing, and a frame of it every second
//   --only city,ruin                      Port Calder's streets and its ruin
//   --only landmarks,rooms                its landmarks, and its rooms from inside
//   --only map,country,airfield,takeoff   the rest
//   --only plane                          the plane, as found and as mended
//
// usage: node scripts/clip/act2-shots.js [--seed 1337] [--out docs/pr-images] [--only ...] [--frames 1] [--size 1280x720]
//   --only    cutscene, map, city, ruin, landmarks, rooms, country, airfield, plane, takeoff (default: all - too long for one browser)
//   --frames n   also save a frame of the crossing every n seconds (the motion, for judging the pacing): 0 = none
//   --clear   how much of the day's haze the shots from above keep (default 0.12)
//   --pick re   only the shots whose names match (a look at a few of them)
//   --character n   the survivor the client joins as (shared/characters.js; default 3): who is at the wheel in the crossing
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, parseArgs, sleep, startGame, launchChrome, LIFE_MAX, list } from './lib.js';
import { worldFor } from '../../shared/worlds.js';
import { WORLD } from '../../shared/acts.js';
import { COL, footprintContains, raycastWorld } from '../../shared/collision.js';

const args = parseArgs(process.argv.slice(2), { seed: '1337', out: join(REPO, 'docs', 'pr-images'), frames: '0', size: '1280x720', clear: '0.12', character: '3' });
const only = list(args.only);
const want = (k) => !only || only.includes(k);
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const [W, H] = String(args.size).split('x').map(Number);
const clear = +args.clear;
const pick = args.pick ? new RegExp(String(args.pick)) : null;

// ---- Where a camera can stand. The mainland of this seed is built here as well (it is the same world: shared/
// worlds.js), so that every shot's camera is checked before it is taken - that it stands in nothing solid, that it is
// not in the crown of a tree, that nothing stands between it and what it is there to show - and the best of a
// handful of spots is the one used. (A picture taken from inside a building, or with a bus across half of it, or
// through a birch, is how the earlier lists went wrong.)
const M = worldFor(+args.seed, WORLD.MAINLAND);
const _hit = { t: -1, col: null, terrain: false };
const _q = [];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// how far a camera at `at` sees towards `to` before something solid is in the way (m)
const sees = (at, to) => {
  const d = dist3(at, to) || 1;
  raycastWorld(M, at[0], at[1], at[2], (to[0] - at[0]) / d, (to[1] - at[1]) / d, (to[2] - at[2]) / d, d, _hit);
  return _hit.t < 0 ? d : _hit.t;
};
// does it stand in (or within pad of) something solid?
const inSolid = (at, pad = 0.6) => {
  for (const c of M.staticGrid.query(at[0], at[2], pad + 1, _q)) {
    if (c.flags & (COL.NOBLOCK | COL.TREE)) continue;
    if (c.y0 < at[1] + 0.3 && c.y1 > at[1] - 0.3 && footprintContains(c, at[0], at[2], pad)) return true;
  }
  return false;
};
// ...or in the crown of a tree? (How far each kind's branches reach from its trunk at full size, and from what height:
// measured off the models - a birch's leaves are out to 12.8 m.)
const CROWN = [[4.9, 0], [3.6, 0], [4.2, 5.8], [6.9, 1], [3.8, 2], [12.8, 4.8], [1.1, 0]];
const inCrown = (at) => {
  const t = M.trees;
  for (let i = 0; i < t.length; i += 6) {
    const [reach, from] = CROWN[t[i + 5]] || [4, 0];
    const s = t[i + 3];
    if (Math.abs(t[i] - at[0]) > reach * s || Math.abs(t[i + 2] - at[2]) > reach * s) continue;
    if (Math.hypot(t[i] - at[0], t[i + 2] - at[2]) < reach * s * 0.92 && at[1] > t[i + 1] + from * s - 0.5) return true;
  }
  return false;
};
// is a vehicle (or anything else as big) standing within r of it? (A camera at a bus's flank has the bus for a picture.)
const BIG = /bus|truck|van|car|ambulance|carrier|tank|container|camper|tent/;
const crowded = (at, r) => M.props.some((pr) => BIG.test(pr.type) && Math.hypot(pr.x - at[0], pr.z - at[2]) < r);
// The best of the candidate spots [x, y, z] for a camera whose subject is at `to`: the first that stands clear and
// sees its subject (to within `short` m of it: a wall is seen, not seen through); failing that, whichever sees
// furthest. o.room: a spot indoors (the roof over it is no tree, and the furniture round it no crowd).
const pickCam = (name, cands, to, o = {}) => {
  let best = null;
  let bs = -1;
  for (const at of cands) {
    if (inSolid(at, o.room ? 0.3 : 0.6) || (!o.room && inCrown(at))) continue;
    if (!o.room && crowded(at, o.crowd ?? 5)) continue;
    const d = dist3(at, to);
    const s = Math.min(1, (sees(at, to) + (o.short ?? 1.5)) / d);
    if (s >= 1) return at;
    if (s > bs) {
      bs = s;
      best = at;
    }
  }
  console.log(`\n(${name}: no clear spot of ${cands.length}; the best ${best ? `sees ${(bs * 100) | 0}% of the way` : 'is the first, such as it is'})`);
  return best || cands[0];
};

let game = null;
let chrome = null;
const t0 = Date.now();
try {
  game = await startGame(REPO, { seed: +args.seed, build: true, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
  chrome = await launchChrome({ width: W, height: H, life: LIFE_MAX, storage: { 'stn.settings': JSON.stringify({ quality: 'medium', renderScale: 1 }), 'stn.character': String(+args.character) } });
  const p = chrome.page;
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  p.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && /prop failed|citykit|unknown material/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
  await sleep(3500);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^\s*(quick )?join/i.test(x.textContent))?.click());
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
        // (a building cut open: [.., which end of it is gone (-1 / 1 along its own x), how much of its floor area])
        open: C
          ? (C.buildings || [])
              .filter((B) => (B.cut || []).filter((R) => R).length >= 3 && B.floors >= 4)
              .map((B) => {
                let gone = 0;
                let end = 0;
                for (const R of B.cut) {
                  if (!R) continue;
                  gone += B.w * B.d - (R[1] - R[0]) * (R[3] - R[2]);
                  end += R[1] < B.w / 2 - 0.5 ? 1 : R[0] > -B.w / 2 + 0.5 ? -1 : 0;
                }
                return [B.x, B.z, B.y, B.ry, B.w, B.d, B.floors * B.fh, Math.sign(end) || 1, gone];
              })
          : [],
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
    // (who is in the car: each rider's player id and the character drawn for them, beside what the player list says)
    console.log('\nriders', JSON.stringify(await p.evaluate(() => (window.__game.cine?.riders || []).map((r) => ({ id: r.id, drawn: r.sv?.character?.id ?? r.ch, list: window.__game.players.get(r.id)?.character })))), 'asked for', +args.character);
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
    for (const [t, name] of [[10.6, 'cutscene-05-the-approach'], [14.6, 'cutscene-06-the-damage'], [17.0, 'cutscene-07-the-damage-wrecks'], [18.8, 'cutscene-08-from-below'], [20.5, 'cutscene-08b-up-through-the-truss'], [21.9, 'cutscene-08c-going-by'], [24.2, 'cutscene-09-the-gap'], [27.4, 'cutscene-10-past-the-gap'], [30.2, 'cutscene-11-the-skyline'], [33.2, 'cutscene-12-the-skyline-late'], [35.6, 'cutscene-13-arrival'], [37.9, 'cutscene-14-the-span-goes'], [38.9, 'cutscene-15-the-span-falls']]) {
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
  const sun3 = await p.evaluate(() => {
    const v = window.__game.env.uniforms.uSunDir.value;
    return [v.x, v.y, v.z];
  });
  const sun = [sun3[0], sun3[2]];
  // is a spot in the sun at the hour the shots are taken (nothing solid between it and the sun)?
  const sunlit = (at) => sun3[1] > 0.05 && sees(at, [at[0] + sun3[0] * 160, at[1] + sun3[1] * 160, at[2] + sun3[2] * 160]) > 150;
  const lit = (l) => -Math.sin(l.ry) * sun[0] - Math.cos(l.ry) * sun[1];
  const lotOf = (what, n = 0) => I.lots.filter((l) => l.what === what).sort((a, b) => lit(b) - lit(a))[n] || null;
  const lw = (L, lx, lz) => [L.x + Math.cos(L.ry) * lx + Math.sin(L.ry) * lz, L.z - Math.sin(L.ry) * lx + Math.cos(L.ry) * lz];
  // a lot from the street in front of it: back m off its front edge, up m over the pavement, side m to its right,
  // looking lookUp m up its front
  const front = async (what, name, back, up, side = 7, lookUp = 5, n = 0) => {
    if (pick && !pick.test(name)) return;
    const L = lotOf(what, n);
    if (!L) return console.log(`\n(no ${what} on this map)`);
    // (what it looks at: its front wall, lookUp over the pavement; from where: the spot asked for, then others near
    // it - the other side of its front, nearer, further off, higher)
    const [tx, tz] = lw(L, 0, -L.d / 2 + 1.2);
    const to = [tx, city.h + lookUp, tz];
    const cands = [];
    for (const bk of [back, back + 3, back - 3, back + 6]) {
      for (const sd of [side, -side, side * 0.4, -side * 0.4]) {
        const [x, z] = lw(L, sd, -L.d / 2 - bk);
        for (const u of [up, up + 2]) cands.push([x, city.h + u, z]);
      }
    }
    await cam(pickCam(name, cands, to, { short: 2.5 }), to);
    await shot(name);
  };
  // a picture taken in a room of a lot: where the camera stands and what it looks at, in the lot's frame (the spot
  // asked for, then a step to each side of it if something stands there)
  const room = async (L, at, look, name, h = 1.7) => {
    if (!L || (pick && !pick.test(name))) return;
    const to = [lw(L, look[0], look[1])[0], city.h + 1.2, lw(L, look[0], look[1])[1]];
    const cands = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [0.8, 0.8], [-0.8, -0.8]].map(([dx, dz]) => [lw(L, at[0] + dx, at[1] + dz)[0], city.h + h, lw(L, at[0] + dx, at[1] + dz)[1]]);
    await cam(pickCam(name, cands, to, { room: true, short: 1 }), to, { wait: 2200 });
    await shot(name);
  };
  // down a street: of every stretch of the grid's streets (from each crossing, each way), the one that is clear
  // furthest ahead of the camera, has nothing big beside it and has the sun most nearly behind it. n: the n-th best
  // (another picture of another street); at: 'cross' - standing back from a crossing, looking through it
  const streetView = (n = 0, at = '') => {
    const out = [];
    for (let i = 0; i <= 6; i++) {
      for (let j = 0; j <= 6; j++) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const back = at === 'cross' ? 22 : 6;
          const px = city.x - G2 + i * 56 - dx * back + dz * 1.3, pz = city.z - G2 + j * 56 - dz * back - dx * 1.3;
          if (Math.abs(px - city.x) > G2 - 4 || Math.abs(pz - city.z) > G2 - 4) continue;
          const c = [px, eye + 1.1, pz];
          if (inSolid(c, 1.2) || inCrown(c) || crowded(c, 9)) continue;
          const far = sees(c, [px + dx * 110, eye + 1.1, pz + dz * 110]);
          if (far < 50) continue;
          // (a street in the sun: where the camera stands, and twenty and forty metres on)
          const lit = [0, 20, 40].filter((s) => sunlit([px + dx * s, city.h + 1.5, pz + dz * s])).length;
          out.push({ c, to: [px + dx * 60, city.h + 3.5, pz + dz * 60], score: Math.min(far, 100) + 45 * -(dx * sun[0] + dz * sun[1]) + 22 * lit });
        }
      }
    }
    out.sort((a, b) => b.score - a.score);
    // (not the same street twice: the n-th best that is a block or more from the ones before it)
    const taken = [];
    for (const v of out) {
      if (taken.some((q) => Math.hypot(q.c[0] - v.c[0], q.c[2] - v.c[2]) < 70)) continue;
      taken.push(v);
      if (taken.length > n) return v;
    }
    return out[0] || null;
  };
  // round a building [x, z, y, ry, w, d, h]: the camera off one of its corners, of a handful of distances and heights
  const round = async (name, B, corners, o = {}) => {
    if (pick && !pick.test(name)) return;
    const [bx, bz, by, ry, w, d, h] = B;
    const F = { x: bx, z: bz, ry };
    const to = [bx, by + h * (o.aim ?? 0.5), bz];
    const cands = [];
    // (of the corners it may be seen from, the one the sun is behind first)
    const sunny = ([sx, sz]) => {
      const [x, z] = lw(F, sx * 10, sz * 10);
      return (x - bx) * sun[0] + (z - bz) * sun[1];
    };
    for (const [sx, sz] of corners.slice().sort((a, b) => sunny(b) - sunny(a))) {
      for (const out of o.out || [10, 14, 7, 18]) {
        const [x, z] = lw(F, sx * (w / 2 + out), sz * (d / 2 + out * 0.8));
        for (const up of o.up || [0.7, 0.95, 0.5]) cands.push([x, by + h * up, z]);
      }
    }
    await cam(pickCam(name, cands, to, { short: Math.max(w, d) * 0.75 }), to, { fog: 0.6 });
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
    await sleep(1500);
    // (zoomed all the way out: the whole of the mainland on the sheet, not the corner the team stands in)
    await p.evaluate(() => {
      const m = window.__game.ui.map;
      m._zoomTo(1);
      m.draw?.();
    });
    await sleep(1500);
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
    {
      // (a crossing, from back up the street that runs into it; and the length of another street, the sun behind)
      const a = streetView(0, 'cross'), b2 = streetView(1);
      if (a) await cam(a.c, a.to);
      await shot('street-03-a-crossing');
      if (b2) await cam(b2.c, b2.to);
      await shot('street-04-east-along-a-street');
    }
    await cam([city.x + 112 + 2.6, eye, city.z - 20], [city.x + 112 - 6, city.h + 9, city.z - 60]);
    await shot('street-05-looking-up');
    await front('terrace', 'street-06-a-row-of-shops', 14, 3, 10, 5);
    await front('flats', 'street-07-a-walk-up', 13, 4, 8, 8);
    await front('office', 'street-08-an-office-block', 15, 3, 9, 10);
    if (I.glass.length) {
      // (a tower of glass and steel, from off the corner of it the sun is on, over the roofs beside it - the street
      // at its foot is too narrow to see it from - and again from that street, looking up it)
      const T = I.glass.slice().sort((a, b) => b[6] - a[6])[0];
      const [bx, bz, by, ry, w, d, h] = T;
      const sgn = [Math.sign(sun[0] || 1), Math.sign(sun[1] || 1)];
      const to = [bx, by + h * 0.5, bz];
      const cands = [];
      for (const out of [26, 32, 20, 38]) for (const [sx, sz] of [sgn, [sgn[0], -sgn[1]], [-sgn[0], sgn[1]], [-sgn[0], -sgn[1]]]) for (const up of [0.6, 0.8]) cands.push([bx + sx * (w / 2 + out), by + h * up, bz + sz * (d / 2 + out)]);
      void ry;
      await cam(pickCam('street-09-a-glass-tower', cands, to, { short: Math.max(w, d) }), to, { fog: 0.6 });
      await shot('street-09-a-glass-tower');
      const low = [];
      for (const out of [9, 12, 6]) for (const [sx, sz] of [sgn, [sgn[0], -sgn[1]], [-sgn[0], sgn[1]], [-sgn[0], -sgn[1]]]) low.push([bx + sx * (w / 2 + out), city.h + 2.2, bz + sz * (d / 2 + out)]);
      const up = [bx, by + h * 0.62, bz];
      await cam(pickCam('street-09b-the-glass-tower-from-its-foot', low, up, { short: Math.max(w, d) }), up);
      await shot('street-09b-the-glass-tower-from-its-foot');
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
      // (a break, from near: the torn end of the length that lies furthest out, from off its corner on the sunny side)
      const T = M.city.fallen.slice().sort((a, b) => b.len - a.len)[0];
      if (T && !(pick && !pick.test('ruin-03c-a-break'))) {
        const ex = [Math.cos(T.ry), -Math.sin(T.ry)]; // (the way it lies)
        const to = [T.x + ex[0] * (T.len / 2 - 1.5), T.y + T.h * 0.5, T.z + ex[1] * (T.len / 2 - 1.5)];
        const cands = [];
        const s0 = -ex[1] * sun[0] + ex[0] * sun[1] >= 0 ? 1 : -1; // (the side of it the sun is on)
        for (const e of [1, -1]) for (const s of [s0, -s0]) for (const [al, off, up] of [[7, 6, 2.2], [9, 8, 3.2], [5.5, 9, 2.6], [11, 4, 2.4]]) cands.push([T.x + e * ex[0] * (T.len / 2 + al) - s * ex[1] * off, T.y + up, T.z + e * ex[1] * (T.len / 2 + al) + s * ex[0] * off, e]);
        const at = pickCam('ruin-03c-a-break', cands, to, { short: 4, crowd: 3 });
        const end = [T.x + (at[3] || 1) * ex[0] * (T.len / 2 - 1.2), T.y + T.h * 0.5, T.z + (at[3] || 1) * ex[1] * (T.len / 2 - 1.2)];
        await cam(at.slice(0, 3), end);
        await shot('ruin-03c-a-break');
      }
    }
    if (I.open.length) {
      // (the building with most of an end fallen away, from off that end: near enough to see into its rooms; then
      // from its other end, and from behind)
      const B = I.open.slice().sort((a, b) => b[8] - a[8])[0];
      const e = B[7] || 1; // (which end is open)
      await round('ruin-04-a-building-cut-open', B, [[e, -1], [e, 1]], { out: [9, 12, 6, 15], up: [0.6, 0.8, 0.45] });
      await round('ruin-05-cut-open-the-other-end', B, [[-e, -1], [-e, 1]]);
      await round('ruin-05b-cut-open-from-behind', B, [[e, 1], [e, -1]], { out: [16, 20, 12], up: [0.9, 1.1] });
    }
    await front('collapse', 'ruin-06-the-collapsed-block', 12, 3, 10, 5);
    await front('burnt', 'ruin-07-a-burnt-block', 15, 4.5, 8, 4);
    {
      // (...and from inside it, through the gap in its front wall: the rafters, the ash)
      const L = lotOf('burnt');
      if (L) await room(L, [0.6, -L.d / 2 + 2.4], [-3, -L.d / 2 + 9], 'ruin-07b-inside-the-burnt-block', 1.7);
    }
    await front('ruin', 'ruin-08-a-shell', 12, 1.8, 6, 5);
    const blocks = I.wire.filter(([x, z]) => Math.abs(x - city.x) < G2 - 20 && Math.abs(z - city.z) < G2 - 20);
    for (const [k, [wx, wz, ry]] of blocks.filter((_, i) => i % 2 === 0).slice(0, 2).entries()) {
      const ns = Math.abs(Math.sin(ry)) < 0.5; // (a street that runs north-south: the wire lies east-west)
      // (from up the street on the side the sun is behind, then from the other: over the roadway, clear of what stands in it)
      const along = ns ? [0, 1] : [1, 0];
      const lit = -(along[0] * sun[0] + along[1] * sun[1]) >= 0 ? 1 : -1; // (looking this way along it, the sun is behind)
      const to = [wx, city.h + 1.2, wz];
      const spots = (sgn, backs, ups) => backs.flatMap((bk) => ups.flatMap((u) => [1.6, -1.6, 0].map((off) => [wx - sgn * along[0] * bk + along[1] * off, eye + u, wz - sgn * along[1] * bk + along[0] * off])));
      await cam(pickCam(`roadblock ${k} front`, spots(lit, [17, 21, 13], [3.4, 5]), to, { crowd: 4 }), to);
      await shot(`ruin-${String(9 + k * 2).padStart(2, '0')}-a-roadblock`);
      await cam(pickCam(`roadblock ${k} back`, spots(-lit, [20, 24, 15], [6, 8]), to, { crowd: 4 }), to);
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
    for (const [what, name, back, up, side, lookUp] of [['hospital', 'landmark-01-calder-general', 10, 5, 12, 5], ['church', 'landmark-02-st-brendans', 14, 3, -9, 8], ['gas', 'landmark-03-the-filling-station', 17, 7, 10, 2], ['cinema', 'landmark-04-the-cinema', 16, 2.4, 9, 5], ['subway', 'landmark-05-the-subway-entrance', 5, 3.2, 5, 1], ['police', 'landmark-07-the-police-station', 12, 2.2, 6, 4], ['depot', 'landmark-08-the-bus-depot', 13, 5, 14, 3], ['warehouse', 'landmark-09-a-warehouse', 14, 3, 10, 5]]) await front(what, name, back, up, side, lookUp);
    const park = lotOf('carpark');
    if (park && !(pick && !pick.test('landmark-06-the-car-park'))) {
      // (its decks, from off whichever of its corners sees them: a shell stood in front of the one first tried)
      const to = [lw(park, 0, -park.d / 2 + 8.7)[0], city.h + 4.6, lw(park, 0, -park.d / 2 + 8.7)[1]];
      const cands = [];
      for (const [sx, bk] of [[-1, 16], [1, 16], [-1, 22], [1, 22], [0, 20], [-1, 11], [1, 11]]) for (const up of [8, 11, 5]) cands.push([lw(park, sx * 17, -park.d / 2 - bk)[0], city.h + up, lw(park, sx * 17, -park.d / 2 - bk)[1]]);
      for (const [sx, bk] of [[-1, 14], [1, 14]]) for (const up of [9, 12]) cands.push([lw(park, sx * 24, -park.d / 2 + 16.4 + bk)[0], city.h + up, lw(park, sx * 24, -park.d / 2 + 16.4 + bk)[1]]);
      await cam(pickCam('landmark-06-the-car-park', cands, to, { short: 9 }), to);
      await shot('landmark-06-the-car-park');
    }
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
    if (shop) await room(shop, [-6.6, -shop.d / 2 + 13.6], [-0.5, -shop.d / 2 + 13.8], 'interior-01b-its-stock-room');
    const hosp = lotOf('hospital');
    await room(hosp, [8.6, 6.2], [-6, 11.6], 'interior-02-the-emergency-room');
    await room(hosp, [-8.6, 6], [-15.5, 11.5], 'interior-02b-triage');
    await room(hosp, [-7.2, 14.4], [-14, 18], 'interior-03-a-ward');
    // a flat (the left-hand one of a walk-up's ground floor: its rooms are laid out from the hall's wall, x = -1.2,
    // and the front wall, z = f)
    const flat = lotOf('flats');
    if (flat) {
      const f = -flat.d / 2 + 1.2;
      const X = (u) => -1.2 - u;
      await room(flat, [0.3, f + 0.9], [0, f + 13], 'interior-04-the-hall-of-a-walk-up');
      await room(flat, [X(1.75), f + 4.0], [X(1.9), f + 10.5], 'interior-04b-a-flat-its-passage', 1.6);
      await room(flat, [X(4.5), f + 3.3], [X(7.0), f + 0.7], 'interior-04c-a-flat-the-living-room', 1.6);
      await room(flat, [X(7.3), f + 0.9], [X(5.4), f + 4.6], 'interior-04d-a-flat-the-living-room-from-the-window', 1.6);
      await room(flat, [X(4.0), f + 5.7], [X(7.2), f + 8.4], 'interior-05-a-flat-the-kitchen', 1.6);
      await room(flat, [X(4.0), f + 9.7], [X(6.9), f + 13.2], 'interior-05b-a-flat-the-bedroom', 1.6);
      await room(flat, [X(3.0), f + 11.4], [X(0.6), f + 13.4], 'interior-05c-a-flat-the-bathroom', 1.6);
      await room(flat, [X(2.9), f + 3.0], [X(0.7), f + 0.8], 'interior-05d-a-flat-the-small-room', 1.6);
    }
    const pol = lotOf('police');
    if (pol) await room(pol, [-6.5, -pol.d / 2 + 2.2], [5, -pol.d / 2 + 7], 'interior-06-the-police-station');
    if (pol) await room(pol, [-7.2, -pol.d / 2 + 10.1], [-7.6, -pol.d / 2 + 14.2], 'interior-07-the-cell');
    if (pol) await room(pol, [3.2, -pol.d / 2 + 10.1], [-1.4, -pol.d / 2 + 14.2], 'interior-07b-the-armoury');
    const off = lotOf('office');
    if (off) await room(off, [-7, -off.d / 2 + 2.4], [5, -off.d / 2 + 9], 'interior-08-an-office-lobby');
    if (off) await room(off, [2.5, -off.d / 2 + 8.7], [7.6, -off.d / 2 + 13.4], 'interior-08b-an-office');
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
      // (from in front of it and to one side, near enough to read: the first of a ring of spots round it that is
      // out of the trees and sees its middle)
      const name = `place-${String(++n).padStart(2, '0')}-${NAMES[id]}`;
      if (pick && !pick.test(name)) continue;
      const to = [zn.x, zn.h + 2.5, zn.z];
      const cands = [];
      for (const k of [0.75, 1, 0.55, 1.3]) for (const a of [0.5, -0.5, 0, 1.1, -1.1, 1.8, -1.8, Math.PI]) for (const up of [0.22, 0.34]) cands.push([zn.x - Math.sin(zn.ry + a) * (zn.flat * k + 9), zn.h + 4 + zn.flat * up, zn.z - Math.cos(zn.ry + a) * (zn.flat * k + 9)]);
      await cam(pickCam(name, cands, to, { short: zn.flat * 0.7 }), to, { fog: 0.6, wait: 2000 });
      await shot(name);
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
