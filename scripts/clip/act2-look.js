// Looks at the mainland while it is being built: a list of camera spots in the real game, one headless browser
// (lib.js launchChrome: one at a time, software rendering), a game server on a free port, straight to act 2 with
// /cross skip. Each shot is a spot of the list below, found from the world as the game built it; the costs of each
// (draw calls, triangles of a whole frame) are printed at the end, and for --break a spot's triangles by material.
//
// usage: node scripts/clip/act2-look.js [--seed 1337] [--out shots/look] [--set kit,street,...] [--size 960x540] [--break street-1]
//   --set    which groups of the list to shoot (default: all)
//   --clear  0..1: thin the haze by this much for the shots from above (default 0.3; 1: the game's own)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, OUT, parseArgs, sleep, startGame, launchChrome, LIFE_MAX, list } from './lib.js';

const args = parseArgs(process.argv.slice(2), { seed: '1337', out: join(OUT, 'look'), size: '960x540', clear: '0.3' });
const sets = list(args.set);
const want = (k) => !sets || sets.includes(k);
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const [W, H] = String(args.size).split('x').map(Number);

let game = null;
let chrome = null;
try {
  game = await startGame(REPO, { seed: +args.seed, build: true, env: { NODE_ENV: 'test', DEV_ADMIN: '1' } });
  chrome = await launchChrome({ width: W, height: H, life: LIFE_MAX, storage: { 'stn.settings': JSON.stringify({ quality: 'medium', renderScale: 1 }) } });
  const p = chrome.page;
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  p.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && /prop failed|citykit|unknown material|Error/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
  await sleep(3500);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^\s*(quick )?join/i.test(x.textContent))?.click());
  for (let i = 0; i < 120 && !(await p.evaluate(() => !!(window.__game && window.__game.myId && window.__game.vm))); i++) await sleep(250);
  await sleep(2000);
  await p.evaluate(() => {
    const g = window.__game;
    g.input.locked = true;
    g.input.enabled = true;
    g.input.requestLock = () => {};
    g.input.handlers.onLockChange = () => {};
    g.ui.showPause(false);
  });
  await p.addStyleTag({ content: '#ui { visibility: hidden !important; }' });
  const t0 = Date.now();
  await p.evaluate(() => window.__game.conn.chat('/cross skip'));
  for (let i = 0; i < 200 && (await p.evaluate(() => window.__game.act)) !== 2; i++) await sleep(250);
  await sleep(5000);
  console.log(`on the mainland after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const costs = [];
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
      o.cycle ?? 0.2,
      o.fog,
      o.far ?? 520,
    );
    await sleep(o.wait ?? 1700);
  };
  const shot = async (name) => {
    await p.screenshot({ path: join(out, `${name}.png`) });
    const c = await p.evaluate(
      () =>
        new Promise((done) => {
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
  // the triangles of what is in view from the camera as it stands, by mesh name and material (one pass: shadows not counted)
  const breakdown = () =>
    p.evaluate(() => {
      const g = window.__game;
      const cam = g.renderer.camera;
      const out = {};
      const add = (k, n, c) => {
        const e = (out[k] ||= [0, 0]);
        e[0] += n;
        e[1] += c;
      };
      g.renderer.scene.traverseVisible((o) => {
        if (!(o.isMesh || o.isPoints) || !o.geometry) return;
        const geo = o.geometry;
        const s = geo.boundingSphere;
        if (o.frustumCulled !== false && s) {
          const c = s.center.clone().applyMatrix4(o.matrixWorld);
          if (c.distanceTo(cam.position) - s.radius > cam.far) return;
        }
        const n = Math.min(geo.drawRange.count === Infinity ? 1e12 : geo.drawRange.count, geo.index ? geo.index.count : geo.attributes.position?.count || 0) / 3;
        const inst = o.isInstancedMesh ? o.count : 1;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        let top = o;
        while (top.parent && top.parent !== g.renderer.scene) top = top.parent;
        add(`${top.name || top.type}/${mats[0]?.name || mats[0]?.type}`, n * inst, 1);
      });
      return Object.entries(out)
        .sort((a, b) => b[1][0] - a[1][0])
        .slice(0, 40)
        .map(([k, [n, c]]) => `${k}: ${Math.round(n)} tris in ${c}`);
    });
  const I = await p.evaluate(() => {
    const g = window.__game;
    const w = g.world;
    const C = w.city;
    return {
      city: { x: C.x, z: C.z, h: w.zoneById[28].h },
      lots: C.lots.map((l) => ({ x: l.x, z: l.z, w: l.w, d: l.d, ry: l.ry, what: l.what, fell: !!l.fell })),
      across: (w.parts || []).filter((q) => q.across && q.sy > 3).map((q) => [q.x, q.z, q.sx, q.sz]),
      wire: (w.props || []).filter((q) => q.type === 'concertina').map((q) => [q.x, q.z, q.ry]),
      bus: (w.props || []).filter((q) => q.type === 'city_bus').map((q) => [q.x, q.z, q.ry]),
      runway: w.runway,
      car: w.car,
      places: Object.fromEntries(w.zones.map((z) => [z.id, { x: z.x, z: z.z, h: z.h, ry: z.ry, flat: z.flat }])),
      river: w.river ? w.river.bridges : null,
      counts: { buildings: C.buildings?.length, rooms: C.rooms?.length, shells: C.shells?.length, heaps: C.heaps?.length, props: w.props.length },
    };
  });
  console.log(JSON.stringify(I.counts));
  const { city } = I;
  const G2 = 168;
  const eye = city.h + 1.7;
  const lotOf = (what, n = 0) => I.lots.filter((l) => l.what === what)[n] || null;
  const lw = (L, lx, lz) => [L.x + Math.cos(L.ry) * lx + Math.sin(L.ry) * lz, L.z - Math.sin(L.ry) * lx + Math.cos(L.ry) * lz];
  const clear = +args.clear;
  // a lot from the street in front of it (back m off its front edge, up m over the pavement, side m to its right)
  const front = async (what, name, back, up, side = 7, n = 0, lookUp = 5) => {
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

  if (want('above')) {
    await cam([city.x - 30, city.h + 120, city.z + 190], [city.x, city.h, city.z + 20], { fog: clear, far: 900, wait: 3500, cycle: 0.2 });
    await shot('above-1-the-city');
    await cam([city.x + 40, city.h + 45, city.z + 60], [city.x - 40, city.h + 6, city.z - 30], { fog: clear, far: 900, wait: 2500 });
    await shot('above-2-over-the-roofs');
  }
  if (want('street')) {
    await cam([city.x - G2 + 8, eye, city.z + 1.5], [city.x, city.h + 5, city.z]);
    await shot('street-1-main-street');
    if (args.break === 'street-1') console.log('\n' + (await breakdown()).join('\n'));
    await cam([city.x - 56 + 1.2, eye, city.z + G2 - 14], [city.x - 56, city.h + 5, city.z]);
    await shot('street-2-a-side-street');
    await cam([city.x + 56 - 1, eye, city.z - 56 - 26], [city.x + 56, city.h + 4, city.z + 100]);
    await shot('street-3-a-crossing');
    await cam([city.x + 2, eye, city.z + 56 + 2.5], [city.x + 60, city.h + 3, city.z + 56]);
    await shot('street-4-east-along-a-street');
    await cam([city.x - 112 - 3, city.h + 9, city.z - 112 + 3], [city.x - 60, city.h + 6, city.z - 112]);
    await shot('street-5-from-a-second-floor');
    await cam([city.x + 112 + 2.6, eye, city.z - 20], [city.x + 112 - 6, city.h + 9, city.z - 60]);
    await shot('street-6-looking-up');
  }
  if (want('kit')) {
    await front('flats', 'kit-1-flats', 13, 4, 8, 0, 8);
    await front('flats', 'kit-2-flats-close', 5, 1.8, 3, 1, 4);
    await front('office', 'kit-3-office', 15, 3, 9, 0, 10);
    await front('terrace', 'kit-4-terrace', 14, 3, 10, 0, 5);
    await front('block', 'kit-5-block', 15, 5, 12, 0, 8);
    await front('tower', 'kit-6-tower', 30, 6, 16, 1, 18);
    await front('warehouse', 'kit-7-warehouse', 14, 3, 10, 0, 5);
    await front('grocery', 'kit-8-shop', 9, 1.8, 4, 0, 3);
    const B = I.lots.find((l) => l.what === 'flats' || l.what === 'block');
    if (B) {
      const [x, z] = lw(B, B.w / 2 + 7, -B.d / 2 - 3);
      const [tx, tz] = lw(B, 0, -B.d / 2 + 5);
      await cam([x, city.h + 2, z], [tx, city.h + 9, tz]);
      await shot('kit-9-corner-looking-up');
    }
  }
  if (want('ruin')) {
    const fell = I.lots.find((l) => l.fell);
    if (I.across.length && fell) {
      const [ax, az] = I.across[1] || I.across[0];
      await cam([ax + 1.6, eye, az + 26], [ax, city.h + 3, az]);
      await shot('ruin-1-the-fallen-tower');
      await cam([ax - 34, city.h + 30, az + 38], [ax, city.h + 2, az], { fog: 0.6 });
      await shot('ruin-2-the-fallen-tower-from-above');
      await cam([ax + 0.5, eye + 1.2, az + 9], [ax, city.h + 2, az - 6]);
      await shot('ruin-3-through-the-break');
    }
    await front('collapse', 'ruin-4-the-collapsed-block', 20, 12, 22, 0, 4);
    await front('collapse', 'ruin-5-the-collapsed-block-street', 9, 1.7, 4, 0, 5);
    await front('ruin', 'ruin-6-a-shell', 12, 1.8, 6, 0, 5);
    await front('burnt', 'ruin-7-burnt', 11, 1.8, 6, 0, 4);
    await front('crushed', 'ruin-8-crushed', 14, 6, 6, 0, 2);
    if (I.wire.length) {
      const [wx, wz, ry] = I.wire[0];
      const ns = Math.abs(Math.sin(ry)) < 0.5;
      await cam(ns ? [wx + 2.5, eye + 0.4, wz - 14] : [wx - 14, eye + 0.4, wz - 2.5], [wx, city.h + 1, wz + (ns ? 4 : 0)]);
      await shot('ruin-9-a-roadblock');
      await cam(ns ? [wx - 3, eye + 5, wz + 22] : [wx + 22, eye + 5, wz + 3], [wx, city.h + 1, wz]);
      await shot('ruin-10-the-roadblock-from-behind');
    }
    if (I.bus.length) {
      const [bx, bz] = I.bus[0];
      await cam([bx + 9, eye + 3, bz + 16], [bx, city.h + 1, bz]);
      await shot('ruin-11-a-jam');
    }
  }
  if (want('landmark')) {
    for (const [what, name, back, up, side, lookUp] of [['hospital', 'landmark-1-calder-general', 10, 5, 12, 5], ['church', 'landmark-2-st-brendans', 17, 3, 9, 8], ['gas', 'landmark-3-the-filling-station', 13, 2.4, 9, 3], ['cinema', 'landmark-4-the-cinema', 16, 2.4, 9, 5], ['subway', 'landmark-5-the-subway', 11, 2.4, 7, 2], ['carpark', 'landmark-6-the-car-park', 15, 5, 14, 4], ['police', 'landmark-7-the-police-station', 12, 2.2, 6, 4], ['depot', 'landmark-8-the-bus-depot', 13, 5, 14, 3]]) await front(what, name, back, up, side, 0, lookUp);
    const hosp = lotOf('hospital');
    if (hosp) {
      const [x, z] = lw(hosp, 3, -17);
      const [tx, tz] = lw(hosp, -4, 6);
      await cam([x, city.h + 1.8, z], [tx, city.h + 3.4, tz]);
      await shot('landmark-9-the-hospital-forecourt');
    }
  }
  if (want('interior')) {
    const shop = lotOf('grocery') || lotOf('hardware');
    if (shop) await room(shop, [6.4, -shop.d / 2 + 2.4], [-5, -shop.d / 2 + 10], 'interior-1-a-shop');
    const hosp = lotOf('hospital');
    await room(hosp, [13, 6.4], [-10, 11], 'interior-2-the-emergency-room');
    await room(hosp, [-7.2, 14.4], [-14, 18], 'interior-3-a-ward');
    const flat = lotOf('flats');
    if (flat) await room(flat, [-7.2, -flat.d / 2 + 2.2], [-3, -flat.d / 2 + 12], 'interior-4-a-flat');
    if (flat) await room(flat, [8.2, -flat.d / 2 + 2.4], [5, -flat.d / 2 + 13], 'interior-5-a-kitchen');
    const pol = lotOf('police');
    if (pol) await room(pol, [-6.5, -pol.d / 2 + 2.2], [5, -pol.d / 2 + 7], 'interior-6-the-police-station');
    if (pol) await room(pol, [-3, -pol.d / 2 + 12.4], [-8, -pol.d / 2 + 13.6], 'interior-7-the-cell');
    const off = lotOf('office');
    if (off) await room(off, [-7, -off.d / 2 + 2.4], [5, -off.d / 2 + 9], 'interior-8-an-office-lobby');
    const cin = lotOf('cinema');
    if (cin) await room(cin, [-12, -cin.d / 2 + 7.2], [8, -cin.d / 2 + 15], 'interior-9-the-cinema', 2.2);
    const ch = lotOf('church');
    if (ch) await room(ch, [0, -ch.d / 2 + 3.2], [0, -ch.d / 2 + 14], 'interior-10-the-church');
  }
  if (want('airfield')) {
    const R = I.runway;
    const mid = (R.z0 + R.z1) / 2;
    const term = I.places[30], hang = I.places[31];
    await cam([R.x - 120, R.y + 70, mid + 190], [R.x - 60, R.y, mid + 60], { fog: clear, far: 900, wait: 3000 });
    await shot('airfield-1-from-above');
    await cam([term.x - 40, term.h + 2, term.z - 14], [term.x, term.h + 5, term.z + 2]);
    await shot('airfield-2-the-terminal');
    await cam([hang.x + 62, hang.h + 2, hang.z - 24], [hang.x, hang.h + 4, hang.z + 6]);
    await shot('airfield-3-the-hangars');
    const c = I.car;
    for (const [name, dx, dy, dz] of [['plane-1-front-left', -8.5, 2.6, -8], ['plane-2-rear-right', 8.5, 3.2, 8], ['plane-3-side', -13, 2, 0], ['plane-4-front', 0, 2, -13], ['plane-5-above', -6, 11, 5]]) {
      await cam([c.x + dx, c.y + dy, c.z + dz], [c.x, c.y + 1.4, c.z - 0.5]);
      await shot(name);
    }
  }
  if (want('river') && I.river) {
    for (const [k, br] of I.river.entries()) {
      await cam([br.x + 24, br.y + 6, br.z + 18], [br.x, br.y, br.z], { fog: 0.6 });
      await shot(`river-${k + 1}-a-crossing`);
    }
  }
  console.log('\nshot: draw calls, triangles');
  for (const [name, calls, tris] of costs) console.log(`  ${name}: ${calls}, ${tris}`);
  if (errors.length) console.log('page errors:\n  ' + [...new Set(errors)].slice(0, 20).join('\n  '));
  writeFileSync(join(out, 'costs.json'), JSON.stringify(costs));
} finally {
  await chrome?.close().catch((e) => console.error(String(e)));
  game?.stop();
}
