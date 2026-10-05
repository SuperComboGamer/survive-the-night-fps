// Shared by the performance tools (scripts/perf/*.js, docs/performance.md): the fixed scenes, the bots that stand in
// them, what is put into the page to time its frames, and the numbers taken from a run of frames.
//
// Every browser here is scripts/clip/lib.js's launchChrome (its rules: one at a time, a seeded profile, nothing that
// takes the screen); the uncapped frame rate of bench.js is that launcher's own perf: true and nothing else.
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput, usePos } from '../../shared/protocol.js';
import { CMD_DT, CMDS_PER_PACKET } from '../../shared/constants.js';
import { readHeader } from '../../client/net/decode.js';
import { sleep } from '../clip/lib.js';

export const SEED = 1337;
export const DAY = 0.2, NIGHT = 0.75; // Environment's cycle (0 sunrise, 0.25 noon, 0.75 midnight), pinned for a scene

// ---------------------------------------------------------------- where the scenes are (seed 1337)
// yaw 0 looks down -Z; forward = (-sin yaw, 0, -cos yaw). Every spot was looked at in a picture (visual.js --only
// bench) before it was used: nothing in the camera's face, the subject in the middle of the frame.
const fwd = (yaw, d) => [-Math.sin(yaw) * d, -Math.cos(yaw) * d];
const ahead = (at, yaw, d, side = 0) => [at[0] + fwd(yaw, d)[0] + Math.cos(yaw) * side, at[1] + fwd(yaw, d)[1] - Math.sin(yaw) * side];
export const SPOT = {
  // the island: on Route 9 by the car the run starts at, looking up the road
  island: { at: [24.2, 23.6], yaw: 0.59, pitch: -0.04 },
  // the mainland: Main Street (Route 9 through Port Calder) a block in from its west end, looking east down it
  street: { at: [-311, 13], yaw: -Math.PI / 2, pitch: 0.02 },
  // the roof of the Calder Trust Tower (ten storeys), looking across the middle of the city
  roof: { at: [-271.4, 38], yaw: -1.206, pitch: -0.3 },
  // a grocer's on the west side: from the back of the shop floor, looking at its street door
  shop: { at: [-354.2, -83.6], y: 2.2, yaw: 0, pitch: 0 },
  // Calder Field: beside the plane, looking down the runway the dead come up
  airfield: { at: [500, 84], yaw: 0.12, pitch: -0.02 },
};
export const baitOf = (spot, d = 14) => ahead(spot.at, spot.yaw, d);

// ---------------------------------------------------------------- a bot: a survivor that stands where it is put
/**
 * A player that joins over the real socket, stands still facing `yaw`, and runs admin chat commands (/tp, /spawn: the
 * test server gives every player those). It decodes nothing but each snapshot's header (the tick its commands name).
 * Returns { id, chat(text), face(yaw), tp(x, z, y?), close() }.
 */
export function joinBot(url, name, character = 0) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url.replace(/^http/, 'ws') + '/ws');
    ws.binaryType = 'arraybuffer';
    const net = { tick: 0, ack: 0 };
    let seq = 0, yaw = 0, timer = null, id = 0;
    const send = (w) => ws.readyState === 1 && ws.send(w.bytes());
    const bot = {
      get id() {
        return id;
      },
      chat(text) {
        const w = new Writer(text.length * 3 + 8);
        w.u8(C2S.CHAT);
        w.str(text);
        send(w);
      },
      face(a) {
        yaw = a;
      },
      tp(x, z, y) {
        bot.chat(`/tp ${x.toFixed(2)} ${z.toFixed(2)}${y === undefined ? '' : ' ' + y.toFixed(2)}`);
      },
      close() {
        clearInterval(timer);
        try {
          ws.close();
        } catch {}
      },
    };
    const tick = () => {
      const w = new Writer(64);
      w.u8(C2S.INPUT);
      w.u16(Math.max(0, net.tick - 2) & 0xffff);
      w.u8(128);
      const cmds = [];
      for (let k = 0; k < CMDS_PER_PACKET; k++) {
        seq = (seq + 1) & 0xffff;
        cmds.push({ seq, buttons: 0, qyaw: qangle16(yaw), qpitch: qpitch(0), slot: 255 });
      }
      writeInput(w, cmds);
      send(w);
    };
    const t = setTimeout(() => reject(new Error(`bot ${name}: no welcome`)), 15000);
    ws.onopen = () => {
      const w = new Writer(64);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.str('');
      w.u8(character);
      send(w);
    };
    ws.onerror = () => reject(new Error(`bot ${name}: socket error`));
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      const type = r.u8();
      if (type === S2C.WELCOME) {
        id = r.u16();
        clearTimeout(t);
        timer = setInterval(tick, CMD_DT * 1000 * CMDS_PER_PACKET);
        resolve(bot);
      } else if (type === S2C.SNAPSHOT) {
        try {
          readHeader(r, net);
        } catch {}
      }
    };
  });
}
// (bots never decode a position, but protocol.js wants a world's scale set before anything is read)
usePos({ posScale: 64 });

// ---------------------------------------------------------------- in the page
/**
 * Put into the page before any of its scripts (page.evaluateOnNewDocument): window.__bench. It wraps
 * requestAnimationFrame so that
 *   - while __bench.throttle is set (ms) a frame is not drawn sooner than that after the last: the setting-up of a
 *     scene, the loading, the walk of the dead to their places are not drawn uncapped (the machine is somebody's);
 *   - while __bench.rec is set every frame is timed: when it began, how long its JavaScript ran (the game's update
 *     and the issuing of its draw calls), and how long the GPU worked on it (EXT_disjoint_timer_query_webgl2, one
 *     query round a whole frame, read back some frames later; null where the browser has not got it).
 */
export function INSTRUMENT() {
  const B = (window.__bench = { throttle: 16, rec: null, watch: null, gpuOk: null, frames: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  let gl = null, ext = null, active = null, lastT = -1;
  const pending = [];
  const gpuSetup = () => {
    if (B.gpuOk !== null) return;
    const g = window.__game;
    if (!g || !g.renderer) return;
    gl = g.renderer.renderer.getContext();
    ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    B.gpuOk = !!ext;
  };
  const poll = () => {
    while (pending.length) {
      const [q, R] = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (!disjoint && R === B.rec) R.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
  };
  const run = (cb, t) => {
    B.frames++;
    const R = B.rec;
    if (!R) {
      // (__bench.watch: only the longest a frame's JavaScript ran, over a stretch that has timed scenes inside it)
      const W = B.watch;
      if (!W) return cb(t);
      const a = performance.now();
      cb(t);
      W.max = Math.max(W.max, performance.now() - a);
      return;
    }
    if (t === lastT) {
      // (a second callback of the same frame - a panel's own animation: its time is the frame's)
      const a = performance.now();
      cb(t);
      R.js[R.js.length - 1] += performance.now() - a;
      return;
    }
    lastT = t;
    gpuSetup();
    if (ext) {
      poll();
      if (pending.length < 8) {
        active = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
      }
    }
    const t0 = performance.now();
    try {
      cb(t);
    } finally {
      const t1 = performance.now();
      if (active) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push([active, R]);
        active = null;
      }
      R.t.push(t0);
      R.js.push(t1 - t0);
    }
  };
  let last = 0;
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const th = B.throttle;
      if (!th) return run(cb, t);
      const wait = last + th - performance.now();
      if (wait <= 1) {
        last = performance.now();
        return run(cb, t);
      }
      setTimeout(() => {
        last = performance.now();
        run(cb, last);
      }, wait);
    });
  B.start = () => {
    B.rec = { t: [], js: [], gpu: [] };
  };
  B.stop = () => {
    const R = B.rec;
    B.rec = null;
    const r2 = (a) => a.map((v) => Math.round(v * 100) / 100);
    return { t: r2(R.t), js: r2(R.js), gpu: r2(R.gpu), gpuOk: B.gpuOk };
  };
  // one whole frame's draw calls and triangles (a frame is several passes and the renderer counts each anew), and
  // what the renderer holds
  B.counts = () =>
    new Promise((done) => {
      const g = window.__game;
      const info = g.renderer.renderer.info;
      info.autoReset = false;
      info.reset();
      // (asked for from outside a frame, this runs after the game's own callback of the next frame, and the one asked
      // for here after the game's of the frame after that: exactly one frame of the game lies between the two.
      // Call it with the throttle off: a throttled callback is put off on a timer and the order is not kept.)
      requestAnimationFrame(() => {
        info.reset();
        g.renderer._shadowAcc = 1; // (the frame counted is one that draws its shadow maps: not every frame does)
        requestAnimationFrame(() => {
          const o = { calls: info.render.calls, tris: info.render.triangles, world: { calls: g.renderer.stats.calls, tris: g.renderer.stats.tris }, programs: info.programs.length, geometries: info.memory.geometries, textures: info.memory.textures };
          info.autoReset = true;
          info.reset();
          done(o);
        });
      });
    });
  // an estimate of what is on the graphics card: every vertex and index buffer of the scenes, every texture a
  // material of theirs holds (with its mips), the render targets left out
  B.gpuMem = () => {
    const g = window.__game;
    const bufs = new Set(), texs = new Set();
    let geo = 0, tex = 0;
    const seeTex = (t) => {
      if (!t || !t.isTexture || texs.has(t)) return;
      texs.add(t);
      const im = t.image;
      const w = im?.width || 0, h = im?.height || 0;
      tex += w * h * 4 * (t.generateMipmaps || (t.mipmaps && t.mipmaps.length > 1) ? 4 / 3 : 1);
    };
    const see = (o) => {
      const ge = o.geometry;
      if (ge) {
        for (const k in ge.attributes) {
          const a = ge.attributes[k];
          const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array;
          if (arr && !bufs.has(arr.buffer)) {
            bufs.add(arr.buffer);
            geo += arr.buffer.byteLength;
          }
        }
        if (ge.index && !bufs.has(ge.index.array.buffer)) {
          bufs.add(ge.index.array.buffer);
          geo += ge.index.array.buffer.byteLength;
        }
      }
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        for (const k in m) seeTex(m[k]);
        if (m.uniforms) for (const k in m.uniforms) seeTex(m.uniforms[k]?.value);
      }
      if (o.skeleton?.boneTexture) seeTex(o.skeleton.boneTexture);
    };
    g.renderer.scene.traverse(see);
    g.renderer.vmScene.traverse(see);
    return { geometryMB: geo / 1048576, textureMB: tex / 1048576 };
  };
  // the dead: how many the client has, how many of them stand in the camera's view
  B.zombies = () => {
    const g = window.__game;
    const cam = g.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
    let all = 0, seen = 0, near = 0;
    for (const z of g.entities.ents.values()) {
      if (z.kind !== 2 || z.dead) continue; // (ENT.ZOMBIE)
      all++;
      const x = z.rx, y = z.ry + 1, zz = z.rz;
      const vx = e[0] * x + e[4] * y + e[8] * zz + e[12], vy = e[1] * x + e[5] * y + e[9] * zz + e[13], vz = e[2] * x + e[6] * y + e[10] * zz + e[14];
      if (vz >= -0.2) continue;
      const cx = (p[0] * vx + p[8] * vz) / -vz, cy = (p[5] * vy + p[9] * vz) / -vz;
      if (Math.abs(cx) < 1 && Math.abs(cy) < 1.15) {
        seen++;
        if (-vz < 15) near++;
      }
    }
    return { all, seen, near };
  };
}

// ---------------------------------------------------------------- numbers from a run of frames
const sorted = (a) => a.slice().sort((x, y) => x - y);
export const median = (a) => {
  if (!a.length) return null;
  const s = sorted(a);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
export const pct = (a, p) => (a.length ? sorted(a)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
/** { fps, frames, ms: {median, p99, worst}, jsMs, gpuMs, stalled } from what __bench.stop() gave. */
export function summarize(R) {
  const dt = [];
  for (let i = 1; i < R.t.length; i++) dt.push(R.t[i] - R.t[i - 1]);
  const secs = dt.length ? (R.t[R.t.length - 1] - R.t[0]) / 1000 : 0;
  const med = median(dt);
  const worst = dt.length ? Math.max(...dt) : null;
  return {
    fps: secs ? dt.length / secs : 0,
    frames: dt.length,
    seconds: secs,
    ms: { median: med, p99: pct(dt, 0.99), worst },
    jsMs: median(R.js),
    jsWorstMs: R.js.length ? Math.max(...R.js) : null,
    gpuMs: R.gpuOk && R.gpu.length ? median(R.gpu) : null,
    gpuSamples: R.gpu.length,
    // a frame gap of a quarter of a second, or thirty frames' worth: the machine was doing something else
    stalled: worst !== null && worst > Math.max(250, 30 * med),
  };
}

// ---------------------------------------------------------------- driving the page
export const chat = (page, text) => page.evaluate((t) => window.__game.conn.chat(t), text);
export const throttle = (page, ms) => page.evaluate((ms) => (window.__bench.throttle = ms), ms);
/** Loads the game and waits for the splash's scene: returns the ms from navigation to the menu being drawn and warm. */
export async function loadMenu(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  return page.evaluate(
    () =>
      new Promise((done) => {
        const t0 = performance.now();
        const iv = setInterval(() => {
          const g = window.__game;
          if ((g && g.state === 'menu' && g.world && g.post && !g.warm && g.tour?.t > 0.3) || performance.now() - t0 > 90000) {
            clearInterval(iv);
            done(performance.now());
          }
        }, 20);
      }),
  );
}
/** Opens the survivor picker and returns the longest frame (ms) and the longest run of JavaScript in the 3 s after. */
export async function pickerFreeze(page) {
  await throttle(page, 0);
  await page.evaluate(() => window.__bench.start());
  await sleep(300);
  const ok = await page.evaluate(() => {
    const b = document.querySelector('.cp-face');
    b?.click();
    return !!b;
  });
  await sleep(3000);
  const R = await page.evaluate(() => window.__bench.stop());
  await throttle(page, 16);
  await page.evaluate(() => document.querySelector('.cp-done')?.click());
  await sleep(300);
  if (!ok) return null;
  const s = summarize(R);
  return { worstFrameMs: s.ms.worst, worstJsMs: s.jsWorstMs };
}
/** Clicks Join and waits to be playing: returns the ms it took, the pause menu off and the mouse "taken" (stubbed). */
export async function join(page) {
  const t0 = Date.now();
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^\s*(quick )?join/i.test(x.textContent))?.click());
  let ms = 0;
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => !!(window.__game && window.__game.myId && window.__game.vm && window.__game.state === 'playing' && !window.__game.warm))) {
      ms = Date.now() - t0;
      break;
    }
    await sleep(50);
  }
  if (!ms) throw new Error('never got into the game (state is not "playing")');
  await page.evaluate(() => {
    const g = window.__game;
    g.input.locked = true;
    g.input.enabled = true;
    g.input.requestLock = () => {};
    g.input.handlers.onLockChange = () => {};
    g.ui.showPause(false);
    g.weather.force = { kind: 'clear' };
  });
  return ms;
}
/** Stands the player at a spot, looking its way, at a pinned hour (cycle). */
export async function stand(page, spot, cycle = DAY) {
  await chat(page, `/tp ${spot.at[0]} ${spot.at[1]}${spot.y === undefined ? '' : ' ' + spot.y}`);
  await page.evaluate(
    (yaw, pitch, cycle) => {
      const g = window.__game;
      g.input.yaw = yaw;
      g.input.pitch = pitch;
      g.debugCycle = cycle;
      g.weather.force = { kind: 'clear' };
    },
    spot.yaw,
    spot.pitch || 0,
    cycle,
  );
}
/** The flashlight on or off (the key the player would press). */
export async function flashlight(page, on) {
  for (let i = 0; i < 3; i++) {
    const is = await page.evaluate(() => !!window.__game.localFlash);
    if (is === on) return true;
    await page.keyboard.press('KeyF');
    await sleep(400);
  }
  return (await page.evaluate(() => !!window.__game.localFlash)) === on;
}
/**
 * Times `seconds` of frames as they are: uncapped under launchChrome's perf: true, at the display's rate otherwise.
 * Returns summarize()'s numbers with the frame's draw calls, triangles and what the renderer holds; `raw` keeps the
 * frame times themselves. A run with a stall in it (the machine was busy) is taken again, twice at the most.
 */
export async function measure(page, seconds = 6, { raw = false, retry = 2 } = {}) {
  let out = null;
  for (let k = 0; k <= retry; k++) {
    await throttle(page, 0);
    await sleep(700); // (the frame rate settles, the timer queries start coming back)
    await page.evaluate(() => window.__bench.start());
    await sleep(seconds * 1000);
    const R = await page.evaluate(() => window.__bench.stop());
    const counts = await page.evaluate(() => window.__bench.counts());
    await throttle(page, 16);
    out = { ...summarize(R), ...counts, retries: k };
    if (raw) out.raw = { t: R.t, js: R.js };
    if (!out.stalled) break;
  }
  return out;
}
