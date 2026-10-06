// Footage of the nunchucks in the real game, frame by frame (docs/object-clipping.md's rules: one headless browser,
// through lib.js's launchChrome). Starts the built game server of this tree and joins one client, then holds both
// clocks: the client's (performance.now and requestAnimationFrame are stood in for in the page, so a frame of the game
// happens when this script says and is exactly 1/60 s long, however long it took to draw and save) and the server's
// (the admin chat command /step: a tick when asked, Game.debugCommand). A shot is a list of frames: what is held down,
// where the view points, where the camera is - the eye, or outside it looking at our own survivor (Game.debugCam with
// body: true). Each frame is saved as a PNG; scripts/clip/nunchaku-reel.js cuts them into the reel.
//
// usage: node scripts/clip/nunchaku-film.js [--shots draw,idle,...] [--out shots/pr/nunchucks/frames] [--seed 1]
//          [--quality high] [--gpu] [--list] [--every 1]
//   --shots    which shots this browser takes (default: all that fit in its lifetime; --list names them)
//   --gpu      the real GPU (default: software rendering). A frame is drawn only when it is asked for, so the load is
//              a few frames a second whichever it is
//   --every    keep every n-th frame only (a quick look at a shot's motion before filming it in full)
// Sound is not recorded: a headless browser has no audio out, and the game's sounds are played live off the chain's motion.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, parseArgs, sleep, list, startGame, launchChrome, LIFE_MAX } from './lib.js';

const args = parseArgs(process.argv.slice(2), { out: join(REPO, 'shots', 'pr', 'nunchucks', 'frames'), seed: '1', quality: 'high', every: '1' });
const { BTN } = await import(pathToFileURL(join(REPO, 'shared', 'constants.js')).href);
const { ITEM } = await import(pathToFileURL(join(REPO, 'shared', 'defs.js')).href);
const { ACT } = await import(pathToFileURL(join(REPO, 'shared', 'protocol.js')).href);
const FPS = 60;
const EVERY = Math.max(1, +args.every || 1);

// ---------------------------------------------------------------- the page's clock
// Runs before any page script. Until hold() the page is as it always is; from then a frame happens on step(ms).
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
      now = realNow() + 50; // (ahead of the frame the browser has already scheduled, so time never runs back)
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

// ---------------------------------------------------------------- the shots
// Each: { name, about, night?, setup(film): before the clocks are held for it, run(film): the frames }.
// film: the helpers below (film.frame, film.skip, film.aimAt, ...). All angles in radians; the survivor stands at
// film.at facing film.yaw0.
const A = BTN.ATTACK, ALT = BTN.ALT;
const orbit = (film, ang, dist, h, look = 1.15, fov = 42) => {
  // a camera out from the survivor: ang 0 = straight ahead of them looking back, + = round to their left
  const yaw = film.yaw0 + ang;
  const x = film.at.x - Math.sin(yaw) * dist, z = film.at.z - Math.cos(yaw) * dist, y = film.at.y + h;
  const dx = film.at.x - x, dz = film.at.z - z, dy = film.at.y + look - y;
  return { x, y, z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), fov, body: true };
};
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
// the light chain, held down: how long it takes (the rates of its four moves: shared/nunchaku.js) + its follow-through
const COMBO = 0.32 + 0.3 + 0.44 + 0.62;

const SHOTS = [
  {
    name: 'draw',
    about: 'the draw: out from below, folded, snapped open, caught',
    async run(f) {
      await f.put(ITEM.PISTOL, 1);
      await f.frames(20, {});
      f.mark('draw');
      await f.frames(80, { slot: 2 });
    },
  },
  {
    name: 'idle',
    about: 'at rest in first person: the guard, a look round (the chain swings with the view), the idle flourish',
    async run(f) {
      await f.frames(40, {});
      // a look to the right and back, and up: the chain hangs in the world, not in the view
      await f.frames(110, (i) => ({ yaw: f.yaw0 - 0.5 * Math.sin((i / 110) * Math.PI * 2) * ease(i / 20), pitch: 0.18 * Math.sin((i / 110) * Math.PI) }));
      await f.frames(250, {});
    },
  },
  {
    name: 'combo',
    about: 'the light chain on a walker: whip, backhand, figure-eight, overhead smash',
    async setup(f) {
      await f.spawn('walker', 1, 4.2);
    },
    async run(f) {
      await f.until(() => f.nearest() < 1.75, 400, (i) => ({ ...f.aimNearest(1.45) }));
      await f.frames(8, () => ({ ...f.aimNearest(1.45) }));
      f.mark('chain');
      await f.frames(Math.round((COMBO + 0.05) * FPS), () => ({ buttons: A, ...f.aimNearest(1.45) }));
      await f.frames(70, () => ({}));
    },
  },
  {
    name: 'heavy',
    about: 'the heavy attack: wound up overhead through its three tiers, and let go on a walker',
    async setup(f) {
      await f.spawn('walker', 1, 5.2);
    },
    async run(f) {
      await f.frames(10, () => ({ ...f.aimNearest(1.45) }));
      f.mark('wind');
      await f.until(() => f.nearest() < 1.9 && f.n > 100, 300, () => ({ buttons: ALT, ...f.aimNearest(1.45) }));
      await f.frames(8, () => ({ buttons: ALT, ...f.aimNearest(1.45) }));
      f.mark('release');
      await f.frames(100, () => ({ ...f.aimNearest(1.45) }));
    },
  },
  {
    name: 'passes',
    about: 'the flourish (the reload key): figure-eights and the passes from hand to hand, first person',
    async run(f) {
      await f.frames(20, {});
      f.mark('flourish');
      await f.frames(4, { buttons: BTN.RELOAD });
      await f.frames(300, {});
    },
  },
  {
    name: 'tp-front',
    about: 'third person, from the front: the draw, the guard, the light chain twice',
    async run(f) {
      const cam = (i) => orbit(f, 0.4 + 0.0008 * i, 2.5, 0.75, 1.2, 46);
      await f.put(ITEM.PISTOL, 1);
      await f.skip(6, { cam: cam(0) });
      await f.frames(20, (i) => ({ cam: cam(i) }));
      await f.frames(70, (i) => ({ slot: 2, cam: cam(i + 20) }));
      f.mark('chain');
      await f.frames(Math.round(COMBO * 2 * FPS), (i) => ({ buttons: A, cam: cam(i + 90) }));
      await f.frames(80, (i) => ({ cam: cam(i + 90 + COMBO * 2 * FPS) }));
    },
  },
  {
    name: 'tp-side',
    about: 'third person, from the side and low: the heavy wind-up and release, then the openers',
    async run(f) {
      const cam = (i) => orbit(f, 1.3 - 0.0012 * i, 2.7, 0.6, 1.2, 46);
      await f.skip(6, { cam: cam(0) });
      await f.frames(20, (i) => ({ cam: cam(i) }));
      await f.frames(85, (i) => ({ buttons: ALT, cam: cam(i + 20) }));
      await f.frames(90, (i) => ({ cam: cam(i + 105) }));
      // crouched: the sweep and on up the chain
      await f.frames(20, (i) => ({ buttons: BTN.CROUCH, cam: cam(i + 195) }));
      await f.frames(45, (i) => ({ buttons: BTN.CROUCH | A, cam: cam(i + 215) }));
      await f.frames(70, (i) => ({ cam: cam(i + 260) }));
    },
  },
  {
    name: 'tp-slow',
    about: 'third person, quarter speed: the light chain, the chain and the free handle through every stroke',
    dt: 1 / (FPS * 4),
    async run(f) {
      const cam = (i) => orbit(f, -0.55 + 0.0004 * i, 2.2, 1.0, 1.2, 44);
      await f.skip(6, { cam: cam(0) });
      await f.frames(24, (i) => ({ cam: cam(i) }));
      f.mark('chain');
      await f.frames(Math.round((COMBO + 0.3) * FPS * 4), (i) => ({ buttons: i < COMBO * FPS * 4 ? A : 0, cam: cam(i + 24) }));
    },
  },
  {
    name: 'tp-flourish',
    about: 'third person, circling: the flourish with its passes',
    async run(f) {
      const cam = (i) => orbit(f, 0.2 + 0.0105 * i, 2.5, 0.85, 1.15, 46);
      await f.skip(6, { cam: cam(0) });
      await f.frames(20, (i) => ({ cam: cam(i) }));
      f.mark('flourish');
      await f.frames(4, (i) => ({ buttons: BTN.RELOAD, cam: cam(i + 20) }));
      await f.frames(300, (i) => ({ cam: cam(i + 24) }));
    },
  },
  {
    name: 'night',
    about: 'a fight at night: four of the dead, first person, combos and a heavy',
    night: true,
    async setup(f) {
      await f.flashlight(true);
      await f.chat('/spawn walker 3');
      await f.spawn('walker', 1, 4.6);
    },
    async run(f) {
      // back off them and strike as each comes into reach: the chain while one is in it, a wind-up while none is
      await f.until(() => f.count() === 0 || f.n > 700, 700, () => {
        const d = f.nearest();
        const aim = f.aimNearest(1.45);
        if (d < 1.85) return { buttons: A | (d < 1.1 ? BTN.BACK : 0), ...aim };
        if (d < 3.4) return { buttons: ALT, ...aim };
        return { ...aim };
      });
      await f.frames(60, {});
    },
  },
  {
    name: 'finish',
    about: 'the finish: third person, low, one of the dead walking in, a full wind-up let go, and the guard',
    async setup(f) {
      await f.spawn('walker', 1, 5.2);
    },
    async run(f) {
      const cam = (i) => orbit(f, 0.7 - 0.0016 * i, 2.5 - 0.0012 * i, 0.5, 1.15, 46);
      let i = 0;
      await f.skip(6, { cam: cam(0) });
      await f.frames(16, () => ({ cam: cam(i++), ...f.aimNearest(1.45) }));
      f.mark('wind');
      await f.until(() => f.nearest() < 1.9 && f.n > 110, 320, () => ({ buttons: ALT, cam: cam(i++), ...f.aimNearest(1.45) }));
      await f.frames(6, () => ({ buttons: ALT, cam: cam(i++), ...f.aimNearest(1.45) }));
      f.mark('release');
      await f.frames(170, () => ({ cam: cam(i++) }));
    },
  },
];

if (args.list) {
  for (const s of SHOTS) console.log(`${s.name.padEnd(12)} ${s.about}`);
  process.exit(0);
}
// (the night's shot is taken last whatever the list's order: there is no morning after it)
const want = (list(args.shots) || SHOTS.map((s) => s.name)).sort((a, b) => (a === 'night') - (b === 'night'));
const shots = want.map((n) => {
  const s = SHOTS.find((x) => x.name === n);
  if (!s) throw new Error(`no shot '${n}' (--list)`);
  return s;
});
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------- run
let game = null, chrome = null;
let t0 = Date.now();
try {
  // (the browser first: there is one on the whole machine, and this waits its turn for it - up to --wait minutes)
  chrome = await launchChrome({ width: 1280, height: 720, gpu: !!args.gpu, life: LIFE_MAX, wait: (+args.wait || 45) * 60_000, storage: { 'stn.settings': JSON.stringify({ quality: args.quality, renderScale: 1, weaponSway: true }) } });
  game = await startGame(REPO, { seed: +args.seed, build: !args.nobuild });
  const p = chrome.page;
  await p.evaluateOnNewDocument(VIRTUAL_CLOCK);
  await p.evaluateOnNewDocument((k) => {
    try {
      localStorage.setItem('stn.admin', k);
    } catch {}
  }, game.secret);
  t0 = Date.now(); // (the browser's life runs from here)
  await p.goto(game.url, { waitUntil: 'load', timeout: 60000 });
  await sleep(3500);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^\s*(quick )?join/i.test(x.textContent))?.click());
  for (let i = 0; i < 120 && !(await p.evaluate(() => !!(window.__game && window.__game.myId && window.__game.vm))); i++) await sleep(250);
  await sleep(2500);
  await p.evaluate((k) => {
    const g = window.__game;
    g.input.locked = true;
    g.input.enabled = true;
    g.input.requestLock = () => {};
    g.input.handlers.onLockChange = () => {};
    g.ui.showPause(false);
    g.conn.chat(`/admin ${k}`);
  }, game.secret);
  await p.addStyleTag({ content: '#ui { visibility: hidden !important; }' });
  await sleep(600);
  const chat = (t) => p.evaluate((t) => window.__game.conn.chat(t), t);

  // ---- the film: what a shot's script calls
  const film = {
    at: { x: 0, y: 0, z: 0 },
    yaw0: 0,
    n: 0, // frames of the shot so far
    dir: '',
    saved: 0,
    dt: 1 / FPS,
    tickAcc: 0,
    state: { buttons: 0, yaw: 0, pitch: 0, cam: null },
    chat,
    info: null, // what the page said after the last frame: { ents: [{ x, y, z, d }] }
    /** One frame: o = what changes ({ buttons, yaw, pitch, cam, slot }). keep: save it. */
    async frame(o, keep = true) {
      const st = this.state;
      st.buttons = o.buttons || 0;
      if (o.yaw !== undefined) st.yaw = o.yaw;
      if (o.pitch !== undefined) st.pitch = o.pitch;
      st.cam = o.cam || null;
      // the server's ticks: one every 1 / 20 s of the game's time, before the frame that follows it
      this.tickAcc += this.dt * 20;
      const ticks = Math.floor(this.tickAcc + 1e-9);
      this.tickAcc -= ticks;
      this.info = await p.evaluate(
        async (st, slot, ms, ticks) => {
          const g = window.__game;
          g.input.buttons = st.buttons;
          g.input.yaw = st.yaw;
          g.input.pitch = st.pitch;
          g.debugCam = st.cam;
          if (slot !== undefined && slot !== null) g.prediction.requestSlot(slot);
          window.__vt.step(ms);
          if (ticks) {
            const t = g.net.tick, t0 = Date.now();
            g.conn.chat(`/step ${ticks}`);
            while (g.net.tick === t && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 1));
          }
          const s = g.prediction.state;
          const ents = [];
          for (const e of g.entities.ents.values()) if (e.kind === 2 && !e.dead && e.view) ents.push({ x: e.rx, y: e.ry, z: e.rz, d: Math.hypot(e.rx - s.x, e.rz - s.z) });
          return { ents, x: s.x, y: s.y, z: s.z, stamina: s.stamina, combo: s.recoil };
        },
        st,
        o.slot,
        this.dt * 1000,
        ticks,
      );
      this.n++;
      if (keep && this.n % EVERY === 0) {
        await p.screenshot({ path: join(this.dir, String(this.saved++).padStart(5, '0') + '.png'), optimizeForSpeed: true });
      }
    },
    /** n frames. o: what is held (an object), or a function of the frame's number. */
    async frames(n, o) {
      for (let i = 0; i < n; i++) await this.frame(typeof o === 'function' ? o(i) : o);
    },
    /** Frames until test() says so (or `max` of them). */
    async until(test, max, o) {
      for (let i = 0; i < max && !test(); i++) await this.frame(typeof o === 'function' ? o(i) : o);
    },
    /** Frames that are not kept (getting something into place). */
    async skip(n, o = {}) {
      for (let i = 0; i < n; i++) await this.frame(typeof o === 'function' ? o(i) : o, false);
    },
    nearest() {
      return Math.min(99, ...(this.info?.ents || []).map((e) => e.d));
    },
    count() {
      return (this.info?.ents || []).filter((e) => e.d < 14).length;
    },
    marks: {},
    /** Remember this frame of the shot by a name (the reel cuts its strips from them). */
    mark(name) {
      this.marks[name] = this.saved;
    },
    /** The view turned onto the nearest of the dead, `h` m above its feet (eased, as a hand on a mouse would). */
    aimNearest(h) {
      const es = (this.info?.ents || []).filter((e) => e.d < 9); // (not the walkers of the day, off in the trees)
      if (!es.length) return {};
      const e = es.reduce((a, b) => (a.d < b.d ? a : b));
      const dx = e.x - this.info.x, dz = e.z - this.info.z, dy = e.y + h - (this.info.y + 1.62);
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      let dyaw = yaw - this.state.yaw;
      dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
      return { yaw: this.state.yaw + dyaw * 0.25, pitch: this.state.pitch + (pitch - this.state.pitch) * 0.25 };
    },
    /** n of a kind of the dead (/spawn: 12 m ahead, give or take), and frames not kept until the first is `within` m. */
    async spawn(kind, n, within) {
      await chat(`/spawn ${kind} ${n}`);
      await this.skip(6);
      for (let i = 0; i < 900 && this.nearest() > within; i++) await this.frame({ ...this.aimNearest(1.45) }, false);
    },
    /** The flashlight on or off (as its key does it). */
    async flashlight(on) {
      await p.evaluate((on, act) => {
        const g = window.__game;
        if (!!g.localFlash === on) return;
        g.localFlash = on;
        g.localFlashT = 0.6;
        g.conn.action(act, on ? 1 : 0);
      }, on, ACT.FLASHLIGHT);
      await this.skip(8);
    },
    /** Another weapon in a slot and in hand (to draw the nunchucks from). */
    async put(item, slot) {
      void item;
      await this.skip(2, { slot });
      await this.skip(40);
    },
  };

  // ---- where: open ground by the car on Route 9, facing along the road
  const spot = await p.evaluate(() => {
    const g = window.__game, c = g.world.car;
    return { x: c.x, z: c.z, yaw: c.yaw || 0 };
  });
  film.at.x = +(args.x ?? spot.x + 7);
  film.at.z = +(args.z ?? spot.z + 5);
  film.yaw0 = +(args.yaw ?? spot.yaw + 0.4);
  await chat('/give nunchucks 1');
  await sleep(400);
  await p.evaluate((item) => {
    const g = window.__game;
    const i = g.inventory.slots.findIndex((x) => x && x.item === item);
    if (i >= 0) g.conn.action(5, i); // (equip from the backpack)
  }, ITEM.NUNCHAKU);
  await sleep(400);
  await chat(`/tp ${film.at.x.toFixed(2)} ${film.at.z.toFixed(2)}`);
  await chat(`/dusk ${args.dusk || 1500}`); // (so long before nightfall: with startGame's 3000 s day, the middle of it)
  await sleep(1200);
  await p.evaluate((yaw) => {
    const g = window.__game;
    g.input.yaw = yaw;
    g.input.pitch = 0;
    g.prediction.requestSlot(2);
  }, film.yaw0);
  await sleep(1500);
  film.at.y = await p.evaluate(() => window.__game.prediction.state.y);
  film.state.yaw = film.yaw0;
  const yawFP = film.yaw0;

  let night = false;
  const done = [];
  for (const s of shots) {
    if (Date.now() - t0 > LIFE_MAX - 150_000) {
      console.log(`  (out of this browser's time: ${shots.slice(shots.indexOf(s)).map((x) => x.name).join(', ')} not taken - run them next)`);
      break;
    }
    const ts = Date.now();
    film.dir = join(out, s.name);
    rmSync(film.dir, { recursive: true, force: true });
    mkdirSync(film.dir, { recursive: true });
    film.n = film.saved = 0;
    film.marks = {};
    film.dt = s.dt || 1 / FPS;
    film.tickAcc = 0;
    // (seen from in front the survivor faces the other way: the light is behind them on the mark as the view has it.
    // The flourish is filmed going round behind them, so it keeps the way the view faces.)
    film.yaw0 = yawFP + (/^tp-(front|side|slow)|^finish/.test(s.name) ? Math.PI : 0);
    film.state = { buttons: 0, yaw: film.yaw0, pitch: 0, cam: null };
    if (s.night && !night) {
      night = true;
      await chat('/night');
      await sleep(9000); // (the dusk, in real time: the clocks are let go between shots)
    }
    // clear the stage: whatever is left of the last shot, and the survivor back on the mark with stamina
    await chat('/clear 90');
    await chat(`/tp ${film.at.x.toFixed(2)} ${film.at.z.toFixed(2)}`);
    await sleep(2500);
    await p.evaluate((yaw) => {
      const g = window.__game;
      g.input.buttons = 0;
      g.input.yaw = yaw;
      g.input.pitch = 0;
      g.debugCam = null;
      g.prediction.requestSlot(2);
    }, film.yaw0);
    await sleep(1500);
    // hold the clocks
    await chat('/step on');
    await sleep(150);
    await p.evaluate(() => window.__vt.hold());
    await film.skip(20);
    if (s.setup) await s.setup(film);
    await s.run(film);
    // ...and let them go
    await p.evaluate(() => {
      window.__game.debugCam = null;
      window.__game.input.buttons = 0;
      window.__vt.release();
    });
    await chat('/step off');
    const secs = (Date.now() - ts) / 1000;
    console.log(`  ${s.name.padEnd(12)} ${String(film.saved).padStart(4)} frames (${(film.saved / FPS / (s.dt ? 1 : 1)).toFixed(1)} s) in ${secs.toFixed(0)} s: ${(secs / Math.max(1, film.n)).toFixed(2)} s a frame`);
    done.push({ name: s.name, about: s.about, frames: film.saved, slow: s.dt ? Math.round(1 / (s.dt * FPS)) : 1, marks: film.marks });
    writeFileSync(join(film.dir, 'shot.json'), JSON.stringify(done[done.length - 1]));
  }
  console.log(`${done.length} shots in ${out} (renderer: ${chrome.angle})`);
} finally {
  if (chrome) await chrome.close();
  if (game) game.stop();
}
