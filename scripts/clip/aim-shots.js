// What a gun's sights and its groups look like in the real game, frame by frame (docs/object-clipping.md's rules: one
// headless browser, through lib.js's launchChrome, software rendering). It starts the built game server of a tree on
// a fixed seed, joins one client and holds both clocks as scripts/clip/nunchaku-film.js does (the page's
// performance.now / requestAnimationFrame stood in for, the server's ticks by the admin command /step), so a frame is
// 1/60 s of the game however long it took to draw, and the same script takes the same pictures of another tree.
//
// usage: node scripts/clip/aim-shots.js [--tree <checkout>] [--out shots/pr/aim/after] [--scenes aim,hip,...]
//          [--gun ak47] [--other m4a1] [--seed 1] [--quality high] [--list]
//   --tree    the checkout to run (default: this one). A "before" is a worktree of origin/main (lib.js tempWorktree)
//   --scenes  which scenes this browser takes (default: all that fit in its lifetime; run the rest next)
//
// The scenes:
//   hip       the gun at the hip and the crosshair, a walker 10 m out
//   aim       the sights up on a walker 10, 25 and 50 m out, by day
//   night     the same at 10 m at night, the flashlight on
//   other     another rifle's sights on a walker 25 m out, to compare
//   climb     the sights on a barn wall 25 m out, the trigger held for a magazine: the frame after the first round,
//             after the middle one and after the last (the aim is never corrected)
//   groups10, groups25
//             the holes in the barn wall from 10 / 25 m, aimed and from the hip: six first shots (one at a time,
//             the gun settled between them), a burst of five, a whole magazine. Pictured square on from close by,
//             a ring on the point of aim and a metre marked
// Each picture is <out>/<name>.png, and <out>/shots-<scenes>.json says what was measured as each was taken.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, parseArgs, sleep, list, startGame, launchChrome, LIFE_MAX } from './lib.js';

const args = parseArgs(process.argv.slice(2), { out: join(REPO, 'shots', 'pr', 'aim', 'after'), seed: '1', quality: 'high', gun: 'ak47', other: 'm4a1' });
const TREE = args.tree ? resolve(String(args.tree)) : REPO;
const { BTN } = await import(pathToFileURL(join(TREE, 'shared', 'constants.js')).href);
const { ITEM, WEAPONS, AMMO_ITEMS } = await import(pathToFileURL(join(TREE, 'shared', 'defs.js')).href);
const { ACT } = await import(pathToFileURL(join(TREE, 'shared', 'protocol.js')).href);
const FPS = 60;
const itemOf = (name) => {
  const id = ITEM[String(name).toUpperCase()];
  if (!id || !WEAPONS[id] || WEAPONS[id].melee) throw new Error(`no gun called '${name}'`);
  return id;
};
const GUN = itemOf(args.gun), OTHER = itemOf(args.other);

// ---------------------------------------------------------------- where (seed 1, Hollow Creek)
// yaw 0 looks down -Z; forward = (-sin yaw, 0, -cos yaw)
// the range: sixty metres of open flat ground beside the road. The barn: its long wall, square to +X, flat ground
// for thirty metres in front of it (both found with raycastWorld over the whole valley, then looked at)
const RANGE = { x: +(args.rx ?? 105), z: +(args.rz ?? 63), yaw: +(args.ryaw ?? 0.7853981633974483) };
const BARN = { wallX: -12.31, z: 105, yaw: (Math.PI * 3) / 2 };
const DAY = 0.2, NIGHT = 0.75; // Environment's cycle, pinned (scripts/perf/lib.js)
const BARN_DAY = 0.36; // ...and the afternoon, when the sun is on the barn's wall

function VIRTUAL_CLOCK() {
  const realNow = performance.now.bind(performance);
  const realRAF = window.requestAnimationFrame.bind(window);
  let held = false, now = 0, queue = [];
  performance.now = () => (held ? now : realNow());
  window.requestAnimationFrame = (cb) => {
    if (!held) return realRAF(cb);
    queue.push(cb);
    return queue.length;
  };
  window.__vt = {
    hold() {
      now = realNow() + 50;
      held = true;
    },
    step(ms) {
      now += ms;
      const cbs = queue;
      queue = [];
      for (const cb of cbs) cb(now);
      return cbs.length;
    },
    release() {
      held = false;
      const cbs = queue;
      queue = [];
      for (const cb of cbs) realRAF(cb);
    },
  };
}

const SCENES = ['hip', 'aim', 'night', 'other', 'climb', 'groups10', 'groups25'];
if (args.list) {
  console.log(SCENES.join('\n'));
  process.exit(0);
}
const want = list(args.scenes) || SCENES;
const out = resolve(String(args.out));
mkdirSync(out, { recursive: true });
const log = {};

let game = null, chrome = null;
try {
  chrome = await launchChrome({ width: 1280, height: 720, gpu: false, life: LIFE_MAX, wait: 45 * 60_000, storage: { 'stn.settings': JSON.stringify({ quality: args.quality, renderScale: 1, weaponSway: true }) } });
  game = await startGame(TREE, { seed: +args.seed, build: !args.nobuild });
  const p = chrome.page;
  await p.evaluateOnNewDocument(VIRTUAL_CLOCK);
  const t0 = Date.now();
  const left = () => LIFE_MAX - (Date.now() - t0);
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
    if (g.weather) g.weather.force = { kind: 'clear' };
  });
  await p.addStyleTag({ content: '.chat-log, .hi-ping { visibility: hidden !important; } .aim-nohud #ui { visibility: hidden !important; } #aim-mark { position: fixed; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 99999; font: 600 15px system-ui, sans-serif; color: #7df; }' });
  await sleep(600);
  const chat = (t) => p.evaluate((t) => window.__game.conn.chat(t), t);

  const st = { buttons: 0, yaw: 0, pitch: 0, cam: null };
  let tickAcc = 0, info = null, serverOn = true, target = 0;
  const tickRate = 20;
  /**
   * One frame of the game: o = what changes ({ buttons, yaw, pitch, cam }). The server ticks along unless frozen (its
   * hold is then asked for again every frame: it lets go by itself after 20 s). draw: false runs the game's frame
   * without drawing it (a frame in software takes a second: only the frames that end in a picture are drawn).
   */
  const frame = async (o = {}, draw = false, meter = false) => {
    st.buttons = o.buttons || 0;
    if (o.yaw !== undefined) st.yaw = o.yaw;
    if (o.pitch !== undefined) st.pitch = o.pitch;
    st.cam = o.cam || null;
    let ticks = 0;
    if (serverOn) {
      tickAcc += tickRate / FPS;
      ticks = Math.floor(tickAcc + 1e-9);
      tickAcc -= ticks;
    }
    info = await p.evaluate(
      async (st, ms, ticks, draw, target, frozen, meter) => {
        const g = window.__game;
        const r = g.renderer;
        if (meter) r.adaptReset = true; // (the exposure metered on this frame alone, not eased from whatever was drawn last)
        if (!draw && !r.__render) {
          r.__render = r.render;
          r.render = () => {};
        } else if (draw && r.__render) {
          r.render = r.__render;
          r.__render = null;
        }
        g.input.buttons = st.buttons;
        g.input.yaw = st.yaw;
        g.input.pitch = st.pitch;
        g.debugCam = st.cam;
        const ran = window.__vt.step(ms);
        if (ticks) {
          const t = g.net.tick, t0 = Date.now();
          g.conn.chat(`/step ${ticks}`);
          while (g.net.tick === t && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 1));
        } else if (frozen) g.conn.chat('/step on');
        const s = g.prediction.state;
        const ents = [];
        for (const [id, e] of g.entities.ents) {
          if (e.kind !== 2) continue;
          if (e.dead && e.view) e.view.object.visible = false; // (the last scene's walker, lying where /clear dropped it)
          if (!e.dead && (!target || id === target)) ents.push({ id, x: e.rx, y: e.ry, z: e.rz, d: Math.hypot(e.rx - s.x, e.rz - s.z) });
        }
        return { ran, ents, x: s.x, y: s.y, z: s.z, mag: s.mags[0], recoil: s.recoil, fires: s.fireCount, reload: s.reloadT, slot: s.slot, camPitch: g.camera.rotation.x, fov: g.camera.fov };
      },
      st,
      1000 / FPS,
      ticks,
      draw,
      target,
      !serverOn,
      meter,
    );
    return info;
  };
  const frames = async (n, o, draw = false) => {
    for (let i = 0; i < n; i++) await frame(typeof o === 'function' ? o(i) : o, draw);
  };
  /** The picture: `settle` drawn frames first, the exposure metered on the last, held as hold() says or as the last frame was. */
  const shot = async (name, note = {}, hold = null, settle = 6) => {
    const o = { ...st };
    for (let i = 0; i < settle; i++) await frame(hold ? hold() : o, true, i === settle - 1);
    await p.screenshot({ path: join(out, name + '.png') });
    log[name] = { ...note, mag: info?.mag, recoil: info?.recoil, pitch: st.pitch, camPitch: info?.camPitch, fov: info?.fov };
    process.stdout.write(`  ${name} ${JSON.stringify(log[name])}\n`);
  };
  const holdClocks = async () => {
    await chat('/step on');
    await sleep(150);
    await p.evaluate(() => window.__vt.hold());
    tickAcc = 0;
    serverOn = true;
    // (the frame the browser had already asked for comes when it comes: nothing is stepped until the game's frames
    // are in the held queue)
    for (let i = 0, ok = 0; i < 200 && ok < 10; i++) {
      await frame({ ...st });
      if (info.ran) ok++;
      else await sleep(50);
    }
  };
  const freeClocks = async () => {
    await p.evaluate(() => {
      const g = window.__game;
      g.debugCam = null;
      g.input.buttons = 0;
      if (g.renderer.__render) {
        g.renderer.render = g.renderer.__render;
        g.renderer.__render = null;
      }
      window.__vt.release();
    });
    await chat('/step off');
    await sleep(300);
  };
  /** The gun in hand with a full magazine and a pocket of rounds (the clocks free). */
  const arm = async (item) => {
    const def = WEAPONS[item];
    await chat(`/give ${item} 1`);
    await sleep(350);
    await chat(`/give ${AMMO_ITEMS[def.ammo]} 240`);
    await sleep(350);
    await p.evaluate((item) => {
      const g = window.__game;
      const i = g.inventory.slots.findIndex((x) => x && x.item === item);
      if (i >= 0) g.conn.action(5, i); // (equip from the backpack)
    }, item);
    await sleep(500);
    await p.evaluate((slot) => window.__game.prediction.requestSlot(slot), def.slot === 0 ? 0 : 1);
    await sleep(900);
    await p.evaluate((b) => (window.__game.input.buttons = b), BTN.RELOAD);
    await sleep(200);
    await p.evaluate(() => (window.__game.input.buttons = 0));
    await sleep((def.reload + 0.8) * 1000);
  };
  /** Stand at x, z facing yaw at a pinned hour (the clocks free). */
  const stand = async (x, z, yaw, cycle = DAY) => {
    await chat('/clear 300');
    await chat(`/tp ${x.toFixed(2)} ${z.toFixed(2)}`);
    await p.evaluate(
      (yaw, cycle) => {
        const g = window.__game;
        g.input.yaw = yaw;
        g.input.pitch = 0;
        g.input.buttons = 0;
        g.debugCam = null;
        g.debugCycle = cycle;
        if (g.weather) g.weather.force = { kind: 'clear' };
        g.impacts?.marks?.pool?.clear();
      },
      yaw,
      cycle,
    );
    st.yaw = yaw;
    st.pitch = 0;
    st.buttons = 0;
    await sleep(1800);
  };
  const flashlight = (on) =>
    p.evaluate(
      (on, act) => {
        const g = window.__game;
        if (!!g.localFlash === on) return;
        g.localFlash = on;
        g.localFlashT = 0.6;
        g.conn.action(act, on ? 1 : 0);
      },
      on,
      ACT.FLASHLIGHT,
    );
  const nearest = () => (info?.ents || []).reduce((a, b) => (!a || b.d < a.d ? b : a), null);
  /** The view on the walker, h m above its feet. */
  const onTarget = (h = 1.12) => {
    const e = nearest();
    if (!e) return {};
    const dx = e.x - info.x, dz = e.z - info.z, dy = e.y + h - (info.y + 1.62);
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  };
  /**
   * A walker D metres out on the range, walking in, and the world stopped as it gets there (the clocks held; the
   * server stays frozen until thaw()). It is spawned 12 m ahead, so for more the survivor steps back first.
   */
  const walkerAt = async (D) => {
    serverOn = true;
    target = 0;
    await frames(4, { ...st });
    const had = new Set(info.ents.map((e) => e.id));
    await chat('/spawn walker 1');
    for (let i = 0; i < 90 && !target; i++) {
      await frame({ ...st });
      target = info.ents.find((e) => !had.has(e.id) && e.d < 20)?.id || 0;
    }
    if (!target) throw new Error('the walker never came');
    const back = Math.max(0, D + 4 - 12);
    await chat(`/tp ${(RANGE.x + Math.sin(RANGE.yaw) * back).toFixed(2)} ${(RANGE.z + Math.cos(RANGE.yaw) * back).toFixed(2)}`);
    await frames(20, { ...st });
    // it walks the last metres in (at the game's own pace: the view draws the dead a moment behind the server, and
    // a server run faster than the page would leave what is drawn far behind where it is)
    for (let i = 0; i < 1500; i++) {
      const e = nearest();
      if (!e) throw new Error('the walker is gone');
      if (e.d <= D) break;
      await frame({ ...st, ...onTarget() });
    }
    serverOn = false;
    await frames(24, () => ({ ...st, ...onTarget() })); // (its last steps drawn up to where the server left it)
    return nearest()?.d;
  };
  const thaw = async () => {
    serverOn = true;
    target = 0;
    tickAcc = 0;
    await chat('/clear 300');
    await frames(6, { buttons: 0 });
  };
  const A = BTN.ATTACK, ALT = BTN.ALT;
  const sights = async (name, D) => {
    const d = await walkerAt(D);
    const hold = () => ({ buttons: ALT, ...onTarget() });
    await frames(36, hold);
    await shot(name, { d }, hold);
    await thaw();
  };

  /** The holes in the barn wall from D metres: first shots, a burst, a magazine; aimed and from the hip. */
  const groups = async (D) => {
    const def = WEAPONS[GUN];
    for (const aimed of [true, false]) {
      const hold = aimed ? ALT : 0;
      await stand(BARN.wallX - D, BARN.z, BARN.yaw, BARN_DAY);
      await holdClocks();
      const aimY = 1.3;
      const pitch = Math.atan2(aimY - 1.62, D);
      const ground = info.y;
      const reload = async () => {
        await frames(3, { buttons: BTN.RELOAD, pitch });
        await frames(Math.ceil((def.reload + 0.5) * FPS), { pitch });
      };
      // the picture: square on to the wall from 7 m (wide) or 2.4 m (close), the point of aim ringed
      const picture = async (name, dist, fov, note) => {
        const cam = { x: BARN.wallX - dist, y: ground + (dist > 4 ? 2.5 : aimY + 0.25), z: BARN.z, yaw: BARN.yaw, pitch: 0, fov };
        const k = 360 / Math.tan((fov * Math.PI) / 360) / dist; // px a metre on the wall
        const y = 360 + (cam.y - ground - aimY) * k;
        await p.evaluate(
          (y, k, label, fov) => {
            window.__game.fovCur = fov; // (the lens at once: the view eases its field of view, and the scale is drawn for this one)
            document.getElementById('aim-mark')?.remove();
            const d = document.createElement('div');
            d.id = 'aim-mark';
            const add = (css, text = '') => {
              const e = document.createElement('div');
              e.style.cssText = 'position:absolute;text-shadow:0 0 3px #000,0 0 3px #000;' + css;
              e.textContent = text;
              d.appendChild(e);
            };
            add(`left:${640 - 9}px;top:${y - 9}px;width:14px;height:14px;border:2px solid #7df;border-radius:50%`);
            add(`left:${640 + 14}px;top:${y - 10}px`, 'point of aim');
            add(`left:40px;top:660px;width:${k}px;height:4px;background:#7df`);
            add('left:40px;top:668px', '1 m');
            add('left:40px;top:24px;font-size:19px;color:#fff', label);
            document.body.appendChild(d);
            document.body.classList.add('aim-nohud');
          },
          y,
          k,
          note,
          fov,
        );
        await frames(4, { cam, pitch });
        await shot(name, { D, aimed, pxPerM: k }, () => ({ cam, pitch }), 5);
        await p.evaluate(() => {
          document.getElementById('aim-mark')?.remove();
          document.body.classList.remove('aim-nohud');
        });
      };
      const wipe = () => p.evaluate(() => window.__game.impacts?.marks?.pool?.clear());
      const tag = `${D}m-${aimed ? 'aimed' : 'hip'}`;
      const said = `${String(args.gun).toUpperCase()} from ${D} m, ${aimed ? 'aimed' : 'from the hip'}`;
      await frames(40, { buttons: hold, pitch });
      // six first shots, the gun settled between them
      for (let i = 0; i < 6; i++) {
        await frames(2, { buttons: hold | A, pitch });
        await frames(70, { buttons: hold, pitch });
      }
      await picture(`group-${tag}-1-first`, 7, 40, `${said}: six first shots`);
      if (aimed || D === 10) await picture(`group-${tag}-1-first-close`, 2.4, 40, `${said}: six first shots (close)`);
      await wipe();
      await reload();
      // a burst of five
      await frames(40, { buttons: hold, pitch });
      const m0 = info.mag;
      for (let i = 0; i < 200 && info.mag > m0 - 5; i++) await frame({ buttons: hold | A, pitch });
      await frames(50, { buttons: hold, pitch });
      await picture(`group-${tag}-2-burst`, 7, 40, `${said}: a burst of five`);
      if (aimed || D === 10) await picture(`group-${tag}-2-burst-close`, 2.4, 40, `${said}: a burst of five (close)`);
      await wipe();
      await reload();
      // the whole magazine
      await frames(40, { buttons: hold, pitch });
      for (let i = 0; i < 900 && info.mag > 0; i++) await frame({ buttons: hold | A, pitch });
      await frames(30, { buttons: hold, pitch });
      await picture(`group-${tag}-3-magazine`, 7, 40, `${said}: a whole magazine (${def.mag})`);
      await wipe();
      await freeClocks();
      await arm(GUN);
    }
  };

  const scenes = {
    async hip() {
      await stand(RANGE.x, RANGE.z, RANGE.yaw);
      await holdClocks();
      const d = await walkerAt(10);
      const hold = () => ({ ...onTarget() });
      await frames(20, hold);
      await shot('hip-10m', { d }, hold);
      await thaw();
      await freeClocks();
    },
    async aim() {
      for (const D of [10, 25, 50]) {
        await stand(RANGE.x, RANGE.z, RANGE.yaw);
        await holdClocks();
        await sights(`aim-${D}m`, D);
        await freeClocks();
      }
    },
    async night() {
      await stand(RANGE.x, RANGE.z, RANGE.yaw, NIGHT);
      await flashlight(true);
      await sleep(1500);
      await holdClocks();
      await sights('aim-night-10m', 10);
      await freeClocks();
      await flashlight(false);
      await sleep(600);
    },
    async other() {
      await arm(OTHER);
      await stand(RANGE.x, RANGE.z, RANGE.yaw);
      await holdClocks();
      await sights(`other-${String(args.other).toLowerCase()}-aim-25m`, 25);
      await freeClocks();
      await arm(GUN);
    },
    async climb() {
      const D = 25;
      await stand(BARN.wallX - D, BARN.z, BARN.yaw, BARN_DAY);
      await holdClocks();
      const pitch = Math.atan2(1.0 - 1.62, D);
      await frames(40, { buttons: ALT, pitch });
      await shot('climb-0-before', { D }, () => ({ buttons: ALT, pitch }));
      const mag = WEAPONS[GUN].mag;
      const at = [mag - 1, Math.floor(mag / 2), 1];
      const names = ['climb-1-first', 'climb-2-middle', 'climb-3-last'];
      let k = 0;
      for (let i = 0; i < 600 && k < at.length; i++) {
        await frame({ buttons: ALT | A, pitch });
        if (info.mag <= at[k]) {
          // (four drawn frames on: the muzzle flash gone, the next round not yet fired, the trigger still held)
          await shot(names[k], { D, round: mag - at[k] }, () => ({ buttons: ALT | A, pitch }), 4);
          k++;
        }
      }
      await frames(30, { buttons: ALT, pitch });
      await freeClocks();
      await arm(GUN);
    },
    groups10: () => groups(10),
    groups25: () => groups(25),
  };

  await chat('/clear 300');
  await arm(GUN);
  for (const name of want) {
    if (!scenes[name]) throw new Error(`no scene '${name}' (--list)`);
    if (left() < 200_000) {
      console.log(`  (out of this browser's time: ${want.slice(want.indexOf(name)).join(', ')} not taken - run them next)`);
      break;
    }
    const ts = Date.now();
    console.log(`${name}:`);
    await scenes[name]();
    console.log(`  ${((Date.now() - ts) / 1000).toFixed(0)} s`);
  }
  writeFileSync(join(out, `shots-${want.join('-')}.json`), JSON.stringify(log, null, 1));
} finally {
  if (chrome) await chrome.close();
  if (game) game.stop();
}
