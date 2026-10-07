// The hitbox pass seen in the real game, before and after (docs/hitboxes.md): the same seed, the same spot and the
// same aim in two builds, and over each view a fan of shots drawn where the game stops them - a red dot where a
// shot stops on nothing (a collider with no model there), a green ring where it stops on something drawn. The fan
// is cast by the client's own judge of a shot (Impacts.resolve: raycastWorld, then the prop's triangles), so it is
// what the server does to the bullet. In the first two views the pistol is fired as well, for the holes it leaves.
//
// Every browser is scripts/clip/lib.js's launchChrome (one at a time, software rendering, the seeded profile and the
// sign-in counter's guard: docs/object-clipping.md, "The headless browser's rules"); one build after the other.
//
// usage: node scripts/hitbox/game-views.js --before <tree> [--out shots/pr/hitbox-pass/game] [--only bonnet,boot]
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { REPO, parseArgs, sleep, startGame, launchChrome, LIFE_MAX, CHEAP_SETTINGS, badPasswordAttempts } from '../clip/lib.js';
import { worldFor } from '../../shared/worlds.js';
import { PROPS, planOf } from '../../shared/props.js';
import { readPng, pair } from './draw.js';

const args = parseArgs(process.argv.slice(2), { out: join(REPO, 'shots', 'pr', 'hitbox-pass', 'game'), seed: '1' });
const SEED = +args.seed;
const PISTOL = 55;

// ---------------------------------------------------------------- where to stand (the same in both builds)
const frame = (p) => {
  const c = Math.cos(p.ry), s = Math.sin(p.ry);
  return (lx, lz) => [p.x + c * lx + s * lz, p.z - s * lx + c * lz];
};
// a prop of a type that stands clear: nothing else solid within `room` of it, on ground that is nearly level
function clear(world, type, room, pick = () => true) {
  const flat = (p) => [[2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dz]) => Math.abs(world.heightAt(p.x + dx, p.z + dz) - p.y) < 0.25);
  const list = world.props.filter((p) => p.type === type && !p.live && pick(p) && flat(p));
  for (const p of list) {
    const others = world.staticGrid.query(p.x, p.z, room, []).filter((c) => c.tag !== p && !(c.flags & 8));
    if (!others.length) return p;
  }
  return list[0] || null;
}
function views() {
  const island = worldFor(SEED, 1), mainland = worldFor(SEED, 2);
  const out = [];
  const add = (name, map, title, p, stand, look, lookY, o = {}) => {
    if (!p) return console.log(`  (no ${name}: nothing of the kind stands clear on seed ${SEED})`);
    const f = frame(p);
    out.push({ name, map, title, tp: f(...stand), lookAt: [...f(...look), p.y + lookY], ...o });
  };
  add('bonnet', 'island', 'The report: beside the car at camp, aiming across its bonnet', island.props.find((p) => p.type === 'car'), [-1.95, -1.9], [6, -1.9], 1.2, { fire: 4, fan: [[-8, -4, 0, 4, 8], [0, -4]] });
  add('boot', 'island', 'The same across its boot', island.props.find((p) => p.type === 'car'), [-1.95, 1.75], [6, 1.75], 1.2, { fire: 4, fan: [[-8, -4, 0, 4, 8], [0, -4]] });
  add('car-wreck', 'island', 'A wreck by the road: across its bonnet', clear(island, 'car_wreck', 7), [-2.1, -1.6], [6, -1.6], 1.15, { fan: [[-10, -5, 0, 5, 10], [1, -3]] });
  add('pickup', 'island', 'A pickup: over its bed', clear(island, 'pickup_truck', 7), [-2.2, 1.6], [5, 1.6], 1.45, { fan: [[-12, -6, 0, 6, 12], [2, -3]] });
  add('tent', 'island', 'A tent: over its slope', clear(island, 'tent', 6), [-2.7, 0], [2.5, 0], 0.6, { fan: [[-16, -8, 0, 8, 16], [8, 2, -4]] });
  add('semi-truck', 'mainland', 'A jack-knifed lorry: the air beside its tractor', clear(mainland, 'semi_truck', 12, (p) => p.seed % 2 === 0), [5.2, -7.5], [-6, -7.5], 1.2, { fan: [[-14, -7, 0, 7, 14], [3, -4]] });
  add('subway', 'mainland', 'A way down to the underground: its open front', clear(mainland, 'subway_entrance', 7), [0, -6], [0, -0.8], 0.4, { fan: [[-10, -5, 0, 5, 10], [4, -2, -8]] });
  add('subway-walk', 'mainland', 'The same, walked into for three seconds', clear(mainland, 'subway_entrance', 7), [0, -5], [0, 1], 0.6, { walk: 3000, fan: [[-8, 0, 8], [-4]] });
  add('fire-truck', 'mainland', 'A crash tender: under it, between its axles', clear(mainland, 'fire_truck', 8), [-4.2, -0.8], [3, -0.8], 0.45, { crouch: true, fan: [[-12, -6, 0, 6, 12], [0, -4]] });
  return out;
}

// ---------------------------------------------------------------- in the page
// the fan of shots from the eye, drawn over the view (runs in the page)
function drawFan([yaws, pitches]) {
  const g = window.__game;
  const cam = g.renderer.camera;
  document.querySelectorAll('.hb-mark').forEach((e) => e.remove());
  const W = window.innerWidth, H = window.innerHeight;
  const put = (css, text = '') => {
    const d = document.createElement('div');
    d.className = 'hb-mark';
    d.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;font:bold 12px monospace;' + css;
    d.textContent = text;
    document.body.appendChild(d);
  };
  let air = 0, on = 0, far = 0, box = 0;
  for (const dp of pitches) for (const dyw of yaws) {
    const yaw = g.input.yaw + (dyw * Math.PI) / 180, pitch = g.input.pitch + (dp * Math.PI) / 180;
    const cp = Math.cos(pitch);
    const d = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    const h = g.impacts.resolve(cam.position.x, cam.position.y, cam.position.z, d[0], d[1], d[2], 90);
    if (!h) {
      far++;
      continue;
    }
    // (a prop that is not one the game can lift out of the world - not a wreck, nothing light - is judged by its
    // box alone: the game does not know either whether the shot met its model)
    const blind = !!h.bare && !!h.prop && !g.staticWorld.lifts.has(h.prop);
    const bare = !!h.bare && !blind;
    const t = Math.hypot(h.x - cam.position.x, h.y - cam.position.y, h.z - cam.position.z);
    const v = cam.position.clone().set(h.x, h.y, h.z).project(cam);
    if (v.z > 1) continue;
    const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
    if (bare) {
      air++;
      put(`left:${x - 8}px;top:${y - 8}px;width:16px;height:16px;border-radius:50%;background:#ff2a1a;border:2px solid #fff;box-shadow:0 0 6px #000;`);
    } else if (blind) {
      box++;
      put(`left:${x - 7}px;top:${y - 7}px;width:14px;height:14px;background:#ffb020;border:2px solid #000;box-shadow:0 0 6px #000;`);
    } else {
      on++;
      put(`left:${x - 7}px;top:${y - 7}px;width:10px;height:10px;border-radius:50%;border:3px solid #35e06a;box-shadow:0 0 4px #000;`);
    }
    if (dyw === yaws[0] || dyw === yaws[yaws.length - 1] || dyw === 0) put(`left:${x - 16}px;top:${y + (dp === pitches[0] ? -26 : 12)}px;color:${bare ? '#ffb0a8' : blind ? '#ffd890' : '#b6ffc8'};text-shadow:0 0 3px #000,0 0 3px #000,0 0 3px #000;`, `${t.toFixed(1)}m`);
  }
  put(`left:12px;bottom:12px;color:#fff;background:rgba(0,0,0,.78);padding:6px 9px;font-size:13px;`, `${air + on + far + box} shots from the eye, and how far each got:  ${air} stopped by nothing drawn (red)${box ? `   ${box} stopped at a prop's box (amber: see where)` : ''}   ${on} on something drawn (green)   ${far} went on past 90 m`);
  return { air, box, on, far };
}

async function run(root, dir, list) {
  mkdirSync(dir, { recursive: true });
  let game = null, chrome = null;
  const results = {};
  try {
    game = await startGame(root, { seed: SEED, build: true });
    chrome = await launchChrome({ width: 1280, height: 720, life: LIFE_MAX, storage: { 'stn.settings': CHEAP_SETTINGS } });
    const p = chrome.page;
    await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
    await sleep(3500);
    await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^\s*(quick )?join/i.test(x.textContent))?.click());
    for (let i = 0; i < 80 && !(await p.evaluate(() => !!(window.__game && window.__game.myId && window.__game.vm))); i++) await sleep(250);
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
    // (a clear day, the same in both builds: the weather is each client's own)
    const clearSky = () =>
      p.evaluate(() => {
        const g = window.__game;
        document.body.classList.add('clip-nohud');
        if (!g.weather) return;
        g.weather.force = { kind: 'clear', wind: 0.3, fog: 1, rain: 0, cloud: 0, bolts: 0, dir: 1, noBolts: true };
        Object.assign(g.weather.state, { fog: 1, windBase: 0.3, rain: 0, cloud: 0, bolts: 0 });
      });
    await clearSky();
    const chat = (t) => p.evaluate((t) => window.__game.conn.chat(t), t);
    const hideDead = () => p.evaluate(() => { for (const e of window.__game.entities.ents.values()) if (e.kind === 2 && e.view) e.view.object.visible = false; });
    await chat(`/give ${PISTOL} 1`);
    await sleep(300);
    await p.evaluate((item) => {
      const g = window.__game;
      const i = g.inventory.slots.findIndex((x) => x && x.item === item);
      if (i >= 0) g.conn.action(5, i);
    }, PISTOL);
    await sleep(300);
    await p.keyboard.press('Digit2');
    let map = 'island';
    for (const s of list) {
      if (s.map !== map) {
        await chat('/map2');
        for (let i = 0; i < 120 && !(await p.evaluate(() => !!window.__game.world?.city)); i++) await sleep(500);
        await sleep(6000);
        map = s.map;
        await clearSky();
        await p.keyboard.press('Digit2');
      }
      await chat(`/tp ${s.tp[0].toFixed(2)} ${s.tp[1].toFixed(2)}`);
      for (let i = 0; i < 40; i++) {
        await sleep(150);
        if ((await p.evaluate((t) => Math.hypot(window.__game.renderer.camera.position.x - t[0], window.__game.renderer.camera.position.z - t[1]), s.tp)) < 0.6) break;
      }
      const aim = () =>
        p.evaluate((s) => {
          const g = window.__game;
          const c = g.renderer.camera.position;
          const dx = s.lookAt[0] - c.x, dz = s.lookAt[1] - c.z, dy = s.lookAt[2] - c.y;
          g.input.yaw = Math.atan2(-dx, -dz);
          g.input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        }, s);
      await sleep(600);
      if (s.crouch) await p.keyboard.down('ControlLeft');
      await sleep(s.crouch ? 700 : 100);
      await aim();
      await sleep(1200);
      await aim();
      if (s.walk) {
        await p.keyboard.down('KeyW');
        await sleep(s.walk);
        await p.keyboard.up('KeyW');
        await sleep(500);
      }
      for (let i = 0; i < (s.fire || 0); i++) {
        await p.evaluate(() => (window.__game.input.mouseButtons = 1));
        await sleep(90);
        await p.evaluate(() => (window.__game.input.mouseButtons = 0));
        await sleep(520);
      }
      await sleep(400);
      await hideDead();
      const where = await p.evaluate(() => {
        const c = window.__game.renderer.camera.position;
        return [c.x, c.y, c.z];
      });
      results[s.name] = { fan: await p.evaluate(drawFan, s.fan), at: where.map((v) => +v.toFixed(2)) };
      await sleep(150);
      await p.screenshot({ path: join(dir, `${s.name}.png`) });
      await p.evaluate(() => document.querySelectorAll('.hb-mark').forEach((e) => e.remove()));
      if (s.crouch) await p.keyboard.up('ControlLeft');
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  } finally {
    if (chrome) await chrome.close();
    if (game) game.stop();
  }
  return results;
}

const out = resolve(String(args.out));
let list = views();
if (args.only) list = list.filter((s) => String(args.only).split(',').includes(s.name));
console.log(`failed sign-ins on this account before: ${badPasswordAttempts()}`);
const after = await run(REPO, join(out, 'after'), list);
console.log(`failed sign-ins after the first browser: ${badPasswordAttempts()}`);
let before = null;
if (args.before) {
  before = await run(resolve(String(args.before)), join(out, 'before'), list);
  console.log(`failed sign-ins after the second browser: ${badPasswordAttempts()}`);
  for (const s of list) {
    const a = after[s.name], b = before[s.name];
    const title = `${s.title}  (seed ${SEED}, ${s.map}, /tp ${s.tp[0].toFixed(1)} ${s.tp[1].toFixed(1)})`;
    pair(readPng(readFileSync(join(out, 'before', `${s.name}.png`))), readPng(readFileSync(join(out, 'after', `${s.name}.png`))), title).save(join(out, `${s.name}.png`));
  }
}
for (const s of list) console.log(`${s.name.padEnd(12)} ${before ? `before: ${JSON.stringify(before[s.name])}  ` : ''}after: ${JSON.stringify(after[s.name])}`);
void PROPS;
void planOf;
