// The scenes scripts/clip/vehicle-shots.js runs (see its head for the context each is given). Every one is on the
// mainland (map 2): there are no vehicles on the island. Run a few at a time (a browser lives 15 minutes):
//   turn-moped | turn-car | turn-bike        a turnaround of each: as found, running, lamps lit at night, broken down, burnt out
//   seat-moped | seat-car | seat-bike        getting on and off (from outside and from the eye), and the view from the seat
//   others                         what a second player sees (two clients)
//   fix                            finding one, the parts it wants, the ring, the bridgehead's starters, fuel, siphoning
//   quest                          the island's quest car (as it always was), and the same car on the mainland
//   chase | swarm | runover | crash | empty      moments of play
//   film-car | film-moped | film-bike            footage: from the seat, then from behind (a scripted rider on a real route)
import { worldFor } from '../../shared/worlds.js';
import { BTN } from '../../shared/constants.js';
import { ZONE_NAMES } from '../../shared/defs.js';
import { COL } from '../../shared/collision.js';
import { siphonOf } from '../../shared/vehicles.js';
import { clearance, flood, makePilot } from '../vehicle-routes.js';

const DAY = 0.2, NIGHT = 0.75;
const KIND = { moped: 1, car: 2, bike: 3 };
const VF_STARTER = 2048, VF_QUEST = 4096;
const deg = (r) => Math.round((r * 180) / Math.PI);
const faceTo = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));

const worlds = new Map();
const world = (c, kind = 2) => {
  const k = `${c.seed}:${kind}`;
  if (!worlds.has(k)) worlds.set(k, worldFor(c.seed, kind));
  return worlds.get(k);
};
// the longest clear stretch of the airfield's runway (scripts/test-vehicles.js openGround): [x, z], clear towards -Z
function runway(c) {
  const w = world(c);
  const r = w.runway;
  let best = null, run = 0, from = 0;
  for (let z = r.z1 - 8; z >= r.z0 + 8; z -= 4) {
    const clear = !w.staticGrid.query(r.x, z, 8, []).some((q) => !(q.flags & COL.NOBLOCK) && q.y1 > w.heightAt(q.x, q.z) + 0.3);
    if (clear) {
      if (!run) from = z;
      run += 4;
      if (!best || run > best[1]) best = [from, run];
    } else run = 0;
  }
  return [r.x, best[0] - 6, best[1]];
}

// to the mainland (with a second client first, if asked), the dead about put down, the hour pinned, the clocks held
async function begin(c, { cycle = DAY, two = false, how = '/map2' } = {}) {
  if (two) await c.second();
  const say = (t) => process.env.CLIP_TRACE && console.log(`  [begin] ${t}`);
  say('pages');
  const pages = [c.A, c.B].filter(Boolean);
  if (!c.held) {
    if (!(await c.ev(c.A, () => window.__game.world?.kind === 2))) {
      await c.chat(c.A, how);
      say('asked');
      for (const p of pages) {
        for (let i = 0; i < 160; i++) {
          await c.wait(500);
          if (await c.ev(p, () => window.__game.world?.kind === 2 && window.__game.prediction.hasServerState && window.__game.state === 'playing')) break;
        }
      }
      await c.wait(4000);
    }
    say('there');
    await c.chat(c.A, '/clear 2000');
    await c.wait(500);
    await c.hold();
    say('held');
  }
  await light(c, cycle);
}
const light = async (c, cycle) => {
  for (const p of [c.A, c.B]) if (p) await c.ev(p, (cy) => (window.__game.debugCycle = cy), cycle);
};
// a survivor put down at a place, looking a way
async function tp(c, p, x, z, yaw = 0, pitch = 0) {
  await c.chat(p, `/tp ${x.toFixed(2)} ${z.toFixed(2)}`);
  const key = p === c.A ? 'A' : 'B';
  await c.run(5, { [key]: { yaw, pitch, cam: null } });
}
const vehAt = (c, x, z, vk = 0, r = 3) => {
  let best = null, bd = r;
  for (const v of c.info.veh) {
    const d = Math.hypot(v.x - x, v.z - z);
    if ((!vk || v.vk === vk) && d < bd) (bd = d), (best = v);
  }
  return best;
};
const vehId = (c, id) => c.info.veh.find((v) => v.id === id);
// a vehicle put down exactly there (the admin /veh ... at), by whoever is within 30 m of it afterwards
async function put(c, name, x, z, yaw = 0, { broken = false, tint = 0, p = c.A } = {}) {
  await c.chat(p, `/veh ${name} at ${x.toFixed(2)} ${z.toFixed(2)} ${deg(yaw)} ${broken ? 'broken' : 'ok'} ${tint}`);
  await c.run(5);
  const v = vehAt(c, x, z, KIND[name]);
  if (!v) throw new Error(`no ${name} came at ${x}, ${z}`);
  return v;
}
const enter = async (c, p, id, n = 10, o) => {
  await c.ev(p, (id) => window.__game.conn.action(37, 0, id), id);
  await c.run(n, o);
};
const leave = async (c, p, n = 10, o) => {
  await c.ev(p, () => window.__game.conn.action(37, 1, 0));
  await c.run(n, o);
};
const key = (c, p, down) => c.ev(p, (down) => (down ? window.__game.input.handlers.onKey('KeyE', ['interact']) : window.__game.input.handlers.onKeyUp('KeyE', ['interact'], false)), down);
// everything of ours cleared off the ground we film on
async function sweep(c, x, z, r = 30) {
  for (let i = 0; i < 8; i++) {
    const v = vehAt(c, x, z, 0, r);
    if (!v) break;
    await c.chat(c.A, `/tp ${(v.x + 2).toFixed(1)} ${v.z.toFixed(1)}`);
    await c.run(3);
    await c.chat(c.A, '/veh out');
    await c.chat(c.A, '/veh remove');
    await c.run(4);
  }
}
// a camera behind and above a vehicle, coming round after it
function chase(c, vk, o = {}) {
  let yaw = null;
  return (v) => {
    if (yaw === null) yaw = v.yaw;
    let d = v.yaw - yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    yaw += d * (o.ease ?? 0.25);
    return c.orbit([v.x, v.y + (vk === 2 ? 1.2 : 1.1), v.z], yaw + Math.PI + (o.side || 0), o.pitch ?? 0.26, o.dist ?? (vk === 2 ? 7.5 : 4.6), { fov: o.fov || 55, body: true });
  };
}
const mine = (c) => ({ x: c.info.s.x, y: c.info.s.y, z: c.info.s.z, yaw: c.info.s.dyaw, vx: c.info.s.vx, vz: c.info.s.vz, steer: c.info.s.dsteer });
const speedOf = (c) => Math.hypot(c.info.s.vx, c.info.s.vz);

// ---------------------------------------------------------------------------------------------------------------
// A turnaround of each vehicle.
async function turn(c, name) {
  const vk = KIND[name];
  await begin(c);
  const [gx, gz] = runway(c);
  await sweep(c, gx, gz - 10);
  const titles = { broken: 'as found (it wants its parts)', ok: 'running', night: 'lamps lit at night', dead: 'broken down (it can be patched)', wreck: 'burnt out (lost for good)' };
  for (const state of ['broken', 'ok', 'night', 'dead', 'wreck']) {
    await tp(c, c.A, gx + 12, gz + 6, 0, 0);
    const v = await put(c, name, gx, gz - 10, 0.6, { broken: state === 'broken', tint: state === 'night' ? 2 : 0 });
    if (state === 'night') {
      await light(c, NIGHT);
      await c.chat(c.A, '/veh lights');
    }
    if (state === 'dead') await c.chat(c.A, '/veh break');
    if (state === 'wreck') await c.chat(c.A, '/veh wreck');
    await c.run(8);
    const files = [];
    const dist = vk === 2 ? 8.5 : 4.2;
    for (const [k, yaw, pitch] of [[0, 0.6, 0.22], [1, Math.PI / 2, 0.12], [2, Math.PI - 0.5, 0.25], [3, -Math.PI / 2 - 0.4, 0.3], [4, 0.02, 0.1], [5, 1.0, 1.1]]) {
      const cam = c.orbit([v.x, v.y + (vk === 2 ? 0.75 : 0.6), v.z], v.yaw + yaw, pitch, dist, { fov: 34, body: false });
      files.push(await c.shot(c.A, `turn-${name}-${state}-${k}`, { hud: false, settle: 3, hold: { A: { cam } } }));
    }
    c.strip(`turn-${name}-${state}`, files, 3, `${name}: ${titles[state]}`, [640, 360]);
    if (state === 'night') await light(c, DAY);
    await c.chat(c.A, '/veh remove');
    await c.run(4, { A: { cam: null } });
  }
}
export const turn_moped = (c) => turn(c, 'moped');
export const turn_car = (c) => turn(c, 'car');
export const turn_bike = (c) => turn(c, 'bike');

// Getting on and off, and the view from the seat.
async function seat(c, name) {
  const vk = KIND[name];
  await begin(c);
  const [gx, gz] = runway(c);
  await sweep(c, gx, gz);
  const side = vk === 2 ? 1.9 : 1.1;
  const pick = (dir, n) => Array.from({ length: n }, (_, i) => `${dir}/${String(i).padStart(5, '0')}.png`);
  await tp(c, c.A, gx - side, gz - 0.2, faceTo(gx - side, gz - 0.2, gx, gz - 0.4), -0.3);
  const v = await put(c, name, gx, gz, 0, { tint: 1 });
  const yawIn = faceTo(gx - side, gz - 0.2, gx, gz - 0.4);
  // from outside
  const cam = c.orbit([v.x - 0.5, v.y + 0.9, v.z], 0.95, 0.2, vk === 2 ? 7 : 4.6, { fov: 40, body: true });
  let dir = await c.rec(`mount-${name}-out`, 2, { A: { cam, yaw: yawIn, pitch: -0.3 } });
  await c.ev(c.A, (id) => window.__game.conn.action(37, 0, id), v.id);
  await c.rec(`mount-${name}-out`, 10, { A: { cam, yaw: 0, pitch: -0.1 } }, { append: true });
  c.strip(`mount-${name}-out`, pick(dir, 12), 6, `${name}: getting on, from outside (1/15 s a frame)`, [426, 240]);
  dir = await c.rec(`dismount-${name}-out`, 2, { A: { cam } });
  await c.ev(c.A, () => window.__game.conn.action(37, 1, 0));
  await c.rec(`dismount-${name}-out`, 10, { A: { cam } }, { append: true });
  c.strip(`dismount-${name}-out`, pick(dir, 12), 6, `${name}: getting off, from outside`, [426, 240]);
  // from the eye
  await tp(c, c.A, gx - side, gz - 0.2, yawIn, -0.3);
  dir = await c.rec(`mount-${name}-eye`, 2, { A: { cam: null, yaw: yawIn, pitch: -0.3 } });
  await c.ev(c.A, (id) => window.__game.conn.action(37, 0, id), v.id);
  await c.rec(`mount-${name}-eye`, 10, { A: { cam: null } }, { append: true });
  c.strip(`mount-${name}-eye`, pick(dir, 12), 6, `${name}: getting on, from the eye`, [426, 240]);
  console.log(`\n  ${name}: seated ${JSON.stringify(c.info.s)}`);
  // the seat
  const held = BTN.FWD | (vk === 3 ? BTN.SPRINT : 0);
  await c.shot(c.A, `seat-${name}-stopped`, { hud: true, settle: 6, hold: { A: { yaw: 0, pitch: -0.12 } } });
  await c.shot(c.A, `seat-${name}-dash`, { hud: true, settle: 4, hold: { A: { yaw: 0, pitch: -0.62 } } });
  await c.shot(c.A, `seat-${name}-left`, { hud: false, settle: 4, hold: { A: { yaw: 1.1, pitch: -0.3 } } });
  await c.run(Math.round(c.fps * 2.4), { A: { buttons: held, yaw: 0, pitch: -0.12 } });
  console.log(`  ${name}: ${speedOf(c).toFixed(1)} m/s after 2.4 s`);
  await c.shot(c.A, `seat-${name}-speed`, { hud: true, settle: 2, hold: { A: { buttons: held, yaw: 0, pitch: -0.12 } } });
  await c.shot(c.A, `seat-${name}-speed-dash`, { hud: true, settle: 2, hold: { A: { buttons: held, yaw: 0, pitch: -0.55 } } });
  await c.shot(c.A, `seat-${name}-turning`, { hud: true, settle: 5, hold: { A: { buttons: held | BTN.LEFT, yaw: 0, pitch: -0.2 } } });
  {
    const cam = chase(c, vk, { side: 2.4, pitch: 0.12, dist: vk === 2 ? 6.5 : 3.6 });
    await c.shot(c.A, `seat-${name}-turning-out`, { hud: false, settle: 8, hold: () => ({ A: { buttons: held | BTN.LEFT, cam: cam(mine(c)) } }) });
  }
  await c.run(4, { A: { buttons: held | BTN.RIGHT, cam: null } });
  {
    const cam = chase(c, vk, { pitch: 0.2 });
    await c.run(8, () => ({ A: { buttons: held, cam: cam(mine(c)) } }));
    await c.shot(c.A, `seat-${name}-braking-out`, { hud: false, settle: 4, hold: () => ({ A: { buttons: BTN.BACK, cam: cam(mine(c)) } }) });
  }
  await c.run(Math.round(c.fps * 2.5), { A: { buttons: BTN.BACK, cam: null } });
  // night, the lamps lit
  await light(c, NIGHT);
  await c.ev(c.A, () => window.__game.conn.action(37, 2, 0));
  await c.run(Math.round(c.fps * 1.5), { A: { buttons: held, yaw: 0, pitch: -0.12 } });
  await c.shot(c.A, `seat-${name}-night`, { hud: true, settle: 2, hold: { A: { buttons: held, yaw: 0, pitch: -0.12 } } });
  {
    const cam = chase(c, vk, { side: 2.6, pitch: 0.16, dist: vk === 2 ? 9 : 5.5 });
    await c.shot(c.A, `seat-${name}-night-out`, { hud: false, settle: 8, hold: () => ({ A: { buttons: held, cam: cam(mine(c)) } }) });
    const cam2 = chase(c, vk, { pitch: 0.2 });
    await c.shot(c.A, `seat-${name}-night-brake`, { hud: false, settle: 4, hold: () => ({ A: { buttons: BTN.BACK, cam: cam2(mine(c)) } }) });
  }
  await c.run(Math.round(c.fps * 2), { A: { buttons: BTN.BACK, cam: null } });
  await light(c, DAY);
  await leave(c, c.A);
  await c.chat(c.A, '/veh remove');
  await c.run(4);
}
export const seat_moped = (c) => seat(c, 'moped');
export const seat_car = (c) => seat(c, 'car');
export const seat_bike = (c) => seat(c, 'bike');

// What the others see: a second client's rider going by, a car with two aboard, a passenger shooting.
export async function others(c) {
  await begin(c, { two: true });
  const [gx, gz] = runway(c);
  await sweep(c, gx, gz);
  for (const name of ['moped', 'bike']) {
    const vk = KIND[name];
    await tp(c, c.B, gx - 1.1, gz, 0, 0);
    const v = await put(c, name, gx, gz, 0, { tint: 3, p: c.B });
    await enter(c, c.B, v.id);
    const ax = gx + 3.2, az = gz - 16;
    await tp(c, c.A, ax, az, faceTo(ax, az, gx, gz), -0.05);
    const held = BTN.FWD | (vk === 3 ? BTN.SPRINT : 0);
    await c.rec(`pass-${name}`, Math.round(c.fps * (vk === 3 ? 4.6 : 3.6)), () => {
      const m = vehId(c, v.id);
      return { A: { yaw: faceTo(ax, az, m.x, m.z), pitch: -0.08, cam: null, slot: 5 }, B: { buttons: held, yaw: 0 } };
    });
    c.video(`pass-${name}`, 12, `a teammate goes by on the ${name} (seen by another player)`);
    await c.run(c.fps * 2, { B: { buttons: BTN.BACK } });
    await leave(c, c.B);
    await sweep(c, vehId(c, v.id).x, vehId(c, v.id).z, 6);
  }
  // the car: B drives, A rides
  await tp(c, c.B, gx - 1.9, gz, 0, 0);
  const car = await put(c, 'car', gx, gz, 0, { tint: 4, p: c.B });
  await enter(c, c.B, car.id);
  await tp(c, c.A, gx + 1.9, gz, faceTo(gx + 1.9, gz, gx, gz), -0.2);
  await c.run(4, { A: { slot: 1 } }); // (the pistol every survivor starts with)
  await enter(c, c.A, car.id);
  console.log(`  car seats ${JSON.stringify(vehId(c, car.id).seats)} pass ${c.info.s.pass}`);
  const cam3 = (side, pitch, dist) => {
    const m = vehId(c, car.id);
    return c.orbit([m.x, m.y + 1.0, m.z], m.yaw + side, pitch, dist, { fov: 42, body: true });
  };
  await c.shot(c.A, 'crew-car-stopped', { hud: false, settle: 3, hold: { A: { cam: cam3(0.7, 0.14, 7) } } });
  await c.shot(c.A, 'crew-car-side', { hud: false, settle: 3, hold: { A: { cam: cam3(-Math.PI / 2, 0.08, 6) } } });
  await c.shot(c.A, 'crew-car-inside', { hud: true, settle: 3, hold: { A: { cam: null, yaw: 0.9, pitch: -0.15 } } });
  await c.rec('crew-car', c.fps * 4, () => ({ A: { cam: cam3(0.6, 0.16, 8) }, B: { buttons: BTN.FWD, yaw: 0 } }));
  c.video('crew-car', 8, 'a car with a driver and a passenger (the second client drives)');
  // the passenger shoots out of the side
  await c.rec('passenger-shoots-eye', c.fps * 2, (i) => ({ A: { cam: null, yaw: -1.35, pitch: -0.05, buttons: i % 6 < 3 ? BTN.ATTACK : 0 }, B: { buttons: 0, yaw: 0 } }), { hud: true });
  c.video('passenger-shoots-eye', 8, 'the passenger shoots out of the side (their own view)');
  await c.rec('passenger-shoots-out', c.fps * 2, (i) => ({ A: { cam: cam3(-0.9, 0.12, 5.5), yaw: -1.35, pitch: -0.05, buttons: i % 6 < 3 ? BTN.ATTACK : 0 }, B: { buttons: 0, yaw: 0 } }));
  c.video('passenger-shoots-out', 8, 'the passenger shoots out of the side (from outside)');
  await c.run(c.fps * 2, { A: { cam: null }, B: { buttons: BTN.BACK } });
  // what the driver looks like to the passenger, and the passenger to the driver
  await c.shot(c.A, 'crew-car-driver-seen', { hud: false, settle: 3, hold: { A: { cam: null, yaw: 1.25, pitch: -0.2 } } });
  await c.shot(c.B, 'crew-car-passenger-seen', { hud: false, settle: 3, hold: { B: { yaw: -1.25, pitch: -0.2 } } });
}

// Finding one and making it go.
export async function fix(c) {
  await begin(c);
  const w = world(c);
  const [gx, gz] = runway(c);
  await sweep(c, gx, gz);
  const look = (x, z) => ({ A: { yaw: faceTo(c.info.s.x, c.info.s.z, x, z), pitch: -0.45, cam: null } });
  for (const [name, gives] of [['moped', ['scrap 4', 'duct tape 1', 'batteries 1']], ['car', ['scrap 8', 'duct tape 2', 'batteries 2', 'gun parts 1']], ['bike', ['scrap 2', 'duct tape 1']]]) {
    const vk = KIND[name];
    const side = vk === 2 ? 2.2 : 1.3;
    await tp(c, c.A, gx - side, gz, faceTo(gx - side, gz, gx, gz), -0.45);
    const v = await put(c, name, gx, gz, 0, { broken: true });
    await c.shot(c.A, `fix-${name}-1-found`, { hud: true, settle: 6, hold: look(gx, gz) });
    console.log(`\n  ${name} found: "${c.info.prompt}"`);
    for (const g of gives) await c.chat(c.A, `/give ${g}`);
    await c.shot(c.A, `fix-${name}-2-parts`, { hud: true, settle: 6, hold: look(gx, gz) });
    console.log(`  ${name} with the parts: "${c.info.prompt}"`);
    await key(c, c.A, true);
    await c.run(Math.round(c.fps * 1.2), look(gx, gz));
    await c.shot(c.A, `fix-${name}-3-ring`, { hud: true, settle: 1, hold: look(gx, gz) });
    const n = await c.until(() => vehId(c, v.id).state === 1, c.fps * 30, look(gx, gz));
    await key(c, c.A, false);
    console.log(`  ${name} fixed after ${((n + Math.round(c.fps * 1.2) + 1) / c.fps).toFixed(1)} s of holding`);
    await c.shot(c.A, `fix-${name}-4-fixed`, { hud: true, settle: 8, hold: look(gx, gz) });
    if (vk !== 3) {
      // the tank: nearly dry, and a canister in the pack
      await c.chat(c.A, '/veh fuel 2');
      await c.chat(c.A, '/give flamethrower fuel 60');
      await c.shot(c.A, `fuel-${name}-1-prompt`, { hud: true, settle: 8, hold: look(gx, gz) });
      console.log(`  ${name} dry: "${c.info.prompt}" fuel ${vehId(c, v.id).fuel}`);
      await key(c, c.A, true);
      await c.run(Math.round(c.fps * 0.7), look(gx, gz));
      await c.shot(c.A, `fuel-${name}-2-ring`, { hud: true, settle: 1, hold: look(gx, gz) });
      await c.run(Math.round(c.fps * 5), look(gx, gz));
      await key(c, c.A, false);
      await c.shot(c.A, `fuel-${name}-3-poured`, { hud: true, settle: 6, hold: look(gx, gz) });
      console.log(`  ${name} after 5.7 s of pouring: fuel ${vehId(c, v.id).fuel}`);
      // hurt: patched with scrap and tape
      await c.chat(c.A, '/veh hp 30');
      await c.chat(c.A, '/give scrap 2');
      await c.chat(c.A, '/give duct tape 1');
      await c.shot(c.A, `patch-${name}-1-prompt`, { hud: true, settle: 8, hold: look(gx, gz) });
      console.log(`  ${name} hurt: "${c.info.prompt}" hp ${vehId(c, v.id).hp}`);
      await key(c, c.A, true);
      await c.run(Math.round(c.fps * 3.4), look(gx, gz));
      await key(c, c.A, false);
      await c.run(4, look(gx, gz));
      console.log(`  ${name} patched: hp ${vehId(c, v.id).hp}`);
    }
    await c.chat(c.A, '/veh remove');
    await c.run(4);
  }
  await starter(c);
  // a wreck's tank
  let best = null, bd = 1e9;
  for (const p of w.props) {
    const n = siphonOf(p);
    const d = Math.hypot(p.x - w.start.x, p.z - w.start.z);
    if (n > 0 && d < bd) (bd = d), (best = p);
  }
  if (best) {
    console.log(`  a wreck with fuel in it: ${best.type} at ${best.x.toFixed(1)}, ${best.z.toFixed(1)} (${siphonOf(best)} Fuel), ${bd.toFixed(0)} m from the bridgehead`);
    let spot = null;
    for (let a = 0; a < 16 && !spot; a++) {
      const x = best.x + Math.cos(a * 0.3927) * 2.6, z = best.z + Math.sin(a * 0.3927) * 2.6;
      if (!w.staticGrid.query(x, z, 0.5, []).some((q) => !(q.flags & COL.NOBLOCK))) spot = [x, z];
    }
    spot ||= [best.x + 2.8, best.z];
    await tp(c, c.A, spot[0], spot[1], faceTo(spot[0], spot[1], best.x, best.z), -0.3);
    const lk = { A: { yaw: faceTo(spot[0], spot[1], best.x, best.z), pitch: -0.3, cam: null } };
    await c.shot(c.A, 'siphon-1-prompt', { hud: true, settle: 6, hold: lk });
    console.log(`  siphon: "${c.info.prompt}"`);
    await key(c, c.A, true);
    await c.run(Math.round(c.fps * 2), lk);
    await c.shot(c.A, 'siphon-2-ring', { hud: true, settle: 1, hold: lk });
    await c.run(Math.round(c.fps * 2.6), lk);
    await key(c, c.A, false);
    await c.shot(c.A, 'siphon-3-drawn', { hud: true, settle: 4, hold: lk });
    console.log(`  siphon after: "${c.info.prompt}"`);
  }
}

// One of the bridgehead's starters: no parts, four seconds.
export async function starter(c) {
  await begin(c);
  c.world = world(c);
  const look = (x, z) => ({ A: { yaw: faceTo(c.info.s.x, c.info.s.z, x, z), pitch: -0.45, cam: null } });
  const st = c.info.veh.filter((v) => v.vf & VF_STARTER);
  console.log(`  starters out: ${st.map((v) => `${v.vk}@${v.x.toFixed(0)},${v.z.toFixed(0)} state ${v.state}`).join(' | ')}; quest ${JSON.stringify(c.info.veh.find((v) => v.vf & VF_QUEST) || null)}`);
  const s0 = st.find((v) => v.state === 0);
  if (s0) {
    let sx = s0.x - Math.cos(s0.yaw) * 1.4, sz = s0.z + Math.sin(s0.yaw) * 1.4;
    await tp(c, c.A, sx, sz, faceTo(sx, sz, s0.x, s0.z), -0.45);
    await c.run(4, look(s0.x, s0.z));
    if (/Pick up/.test(c.info.prompt)) {
      // (its can of fuel lies on this side: picked up first, as anybody would)
      await c.shot(c.A, 'starter-0-can', { hud: true, settle: 2, hold: look(s0.x, s0.z) });
      await key(c, c.A, true);
      await c.run(2, look(s0.x, s0.z));
      await key(c, c.A, false);
      await c.run(6, look(s0.x, s0.z));
      console.log(`  the can picked up: "${c.info.prompt}"`);
    }
    await c.shot(c.A, 'starter-1-found', { hud: true, settle: 6, hold: look(s0.x, s0.z) });
    console.log(`  starter: "${c.info.prompt}"`);
    await c.shot(c.A, 'starter-0-place', { hud: false, settle: 2, hold: { A: { cam: c.orbit([s0.x, s0.y + 1, s0.z], 0.5, 0.5, 26, { fov: 50, body: true }) } } });
    await c.shot(c.A, 'starter-0-bridgehead', { hud: false, settle: 2, hold: { A: { cam: c.orbit([c.world.start.x, s0.y + 1, c.world.start.z], 1.9, 0.6, 60, { fov: 55, body: true }) } } });
    await c.run(2, { A: { cam: null } });
    await c.run(2, look(s0.x, s0.z));
    await key(c, c.A, true);
    await c.run(Math.round(c.fps * 2), look(s0.x, s0.z));
    await c.shot(c.A, 'starter-2-ring', { hud: true, settle: 1, hold: look(s0.x, s0.z) });
    const n = await c.until(() => vehId(c, s0.id).state === 1, c.fps * 20, look(s0.x, s0.z));
    await key(c, c.A, false);
    console.log(`  starter going after ${((n + Math.round(c.fps * 2) + 1) / c.fps).toFixed(1)} s`);
    await c.shot(c.A, 'starter-3-going', { hud: true, settle: 8, hold: look(s0.x, s0.z) });
  }
}

// The quest car: on the island as it always was; on the mainland, the team's car.
export async function quest(c) {
  const isl = world(c, 1);
  const prop = isl.car;
  await c.wait(1500);
  if (prop && !c.held) {
    const x = prop.x + 3.2, z = prop.z + 2.4;
    await c.chat(c.A, `/tp ${x.toFixed(1)} ${z.toFixed(1)}`);
    await c.ev(c.A, (yaw) => {
      window.__game.input.yaw = yaw;
      window.__game.input.pitch = -0.25;
    }, faceTo(x, z, prop.x, prop.z));
    await c.wait(2500);
    await c.shot(c.A, 'quest-island-car', { hud: true, wait: 800 });
    const seen = await c.ev(c.A, () => ({ veh: window.__game.vehicles.list.size, prompt: window.__game.prompt || '', kind: window.__game.world?.kind }));
    console.log(`\n  the island (world ${seen.kind}): ${seen.veh} vehicles; at the quest car: "${seen.prompt}"`);
  }
  await begin(c, { how: '/cross skip' });
  const q = c.info.veh.find((v) => v.vf & VF_QUEST);
  console.log(`  on the mainland: ${c.info.veh.length} vehicles; the quest car ${JSON.stringify(q)}; we are at ${c.info.s.x.toFixed(1)}, ${c.info.s.z.toFixed(1)}`);
  if (!q) return;
  const files = [];
  for (const [k, yaw, pitch, dist] of [[0, 0.7, 0.2, 9], [1, Math.PI - 0.6, 0.25, 9], [2, 1.2, 0.7, 30]]) {
    files.push(await c.shot(c.A, `quest-mainland-${k}`, { hud: false, settle: 3, hold: { A: { cam: c.orbit([q.x, q.y + 0.8, q.z], q.yaw + yaw, pitch, dist, { fov: 40, body: true }) } } }));
  }
  const sx = q.x - Math.cos(q.yaw) * 2.1, sz = q.z + Math.sin(q.yaw) * 2.1;
  await tp(c, c.A, sx, sz, faceTo(sx, sz, q.x, q.z), -0.35);
  files.push(await c.shot(c.A, 'quest-mainland-3-prompt', { hud: true, settle: 6, hold: { A: { yaw: faceTo(sx, sz, q.x, q.z), pitch: -0.35, cam: null } } }));
  console.log(`  at it: "${c.info.prompt}"`);
  await enter(c, c.A, q.id, 12, { A: { yaw: q.yaw, pitch: -0.15 } });
  files.push(await c.shot(c.A, 'quest-mainland-4-seat', { hud: true, settle: 4, hold: { A: { yaw: q.yaw, pitch: -0.2 } } }));
  console.log(`  in it: drive ${c.info.s.drive}, fuel ${c.info.s.dfuel}`);
  const cam = chase(c, 2, { side: 2.5, pitch: 0.2, dist: 9 });
  await c.run(c.fps * 3, () => ({ A: { buttons: BTN.FWD, cam: cam(mine(c)) } }));
  files.push(await c.shot(c.A, 'quest-mainland-5-driven', { hud: false, settle: 1, hold: { A: { buttons: BTN.FWD, cam: cam(mine(c)) } } }));
  console.log(`  driven: ${speedOf(c).toFixed(1)} m/s, at ${c.info.s.x.toFixed(1)}, ${c.info.s.z.toFixed(1)}`);
  c.strip('quest-mainland', files, 3, 'the quest car on the mainland after the crossing: the team’s car', [640, 360]);
  await c.run(c.fps * 2, { A: { buttons: BTN.BACK, cam: null } });
}

// The dead after a moped.
export async function chase_(c) {
  await begin(c);
  const [gx, gz] = runway(c);
  await sweep(c, gx, gz);
  await tp(c, c.A, gx - 1.1, gz, Math.PI, 0);
  const v = await put(c, 'moped', gx, gz, 0, { tint: 2 });
  await c.chat(c.A, '/spawn runner 6');
  await c.chat(c.A, '/spawn walker 6');
  await c.run(6, { A: { yaw: Math.PI } });
  await enter(c, c.A, v.id, 8, { A: { yaw: 0 } });
  const cam = (side, dist) => c.orbit([c.info.s.x, c.info.s.y + 1.0, c.info.s.z], c.info.s.dyaw + side, 0.2, dist, { fov: 55, body: true });
  await c.rec('chase-moped', c.fps * 7, (i) => ({ A: { buttons: i < c.fps * 1.2 ? 0 : BTN.FWD, yaw: 0, cam: cam(0.35, 5.5) } }));
  c.video('chase-moped', 8, 'the dead come for the noise; a moped outruns them (runners keep up for a while)');
  console.log(`\n  chase: ${speedOf(c).toFixed(1)} m/s, ${c.info.dead.length} of the dead about, hp ${c.info.hp}`);
  await c.run(c.fps * 2, { A: { buttons: BTN.BACK, cam: null } });
  await c.chat(c.A, '/clear 400');
}
export { chase_ as chase };

// A stopped car with the dead all round it.
export async function swarm(c) {
  await begin(c);
  const [gx, gz] = runway(c);
  await sweep(c, gx, gz);
  await tp(c, c.A, gx - 1.9, gz, 0, 0);
  const v = await put(c, 'car', gx, gz, 0, { tint: 5 });
  await enter(c, c.A, v.id, 8, { A: { yaw: 0 } });
  await c.chat(c.A, '/spawn walker 10');
  await c.chat(c.A, '/spawn runner 4');
  const cam = (side, pitch, dist) => c.orbit([v.x, v.y + 1.0, v.z], side, pitch, dist, { fov: 50, body: true });
  const hp0 = vehId(c, v.id).hp;
  const n = await c.until(() => c.info.dead.filter((d) => Math.hypot(d.x - v.x, d.z - v.z) < 3.2).length >= 4, c.fps * 25, { A: { yaw: 0, cam: cam(0.8, 0.45, 12) } });
  console.log(`\n  swarm: on it after ${(n / c.fps).toFixed(1)} s; the car ${hp0} hp, the driver ${c.info.hp}`);
  await c.rec('swarm-car', c.fps * 8, (i) => ({ A: { yaw: 0, buttons: i > c.fps * 5 && i < c.fps * 6 ? BTN.HORN : 0, cam: cam(0.8 + i * 0.012, 0.45, 12) } }));
  c.video('swarm-car', 8, 'a stopped car with the dead on it: the body takes the blows first');
  console.log(`  swarm: after 8 s more the car ${vehId(c, v.id).hp} hp (of ${hp0}), the driver ${c.info.hp}`);
  await c.shot(c.A, 'swarm-car-inside', { hud: true, settle: 3, hold: { A: { cam: null, yaw: 0.5, pitch: -0.1 } } });
  await c.run(c.fps * 10, { A: { yaw: 0.5, pitch: -0.1 } });
  await c.shot(c.A, 'swarm-car-inside-later', { hud: true, settle: 3, hold: { A: { cam: null, yaw: -0.6, pitch: -0.1 } } });
  console.log(`  swarm: after 10 s more the car ${vehId(c, v.id).hp} hp, state ${vehId(c, v.id).state}, the driver ${c.info.hp}`);
  // ...and out through them
  await c.rec('swarm-car-away', c.fps * 4, () => ({ A: { yaw: 0, buttons: BTN.FWD, cam: c.orbit([c.info.s.x, c.info.s.y + 1.0, c.info.s.z], 0.6, 0.4, 12, { fov: 50, body: true }) } }));
  c.video('swarm-car-away', 8, 'driving out through them');
  console.log(`  swarm: away at ${speedOf(c).toFixed(1)} m/s, the car ${vehId(c, v.id).hp} hp, the driver ${c.info.hp}`);
  await c.run(c.fps * 2, { A: { buttons: BTN.BACK, cam: null } });
  await c.chat(c.A, '/clear 400');
}

// Through a knot of the dead at speed.
export async function runover(c) {
  await begin(c);
  const [gx, gz] = runway(c);
  await sweep(c, gx, gz);
  for (const name of ['car', 'moped']) {
    const vk = KIND[name];
    await tp(c, c.A, gx, gz - 38, 0, 0);
    await c.chat(c.A, '/spawn walker 8');
    await c.run(4);
    await tp(c, c.A, gx - (vk === 2 ? 1.9 : 1.1), gz, 0, 0);
    const v = await put(c, name, gx, gz, 0, { tint: 6 });
    await enter(c, c.A, v.id, 8, { A: { yaw: 0 } });
    const hp0 = vehId(c, v.id).hp, mine0 = c.info.hp, dead0 = c.info.dead.length;
    const cam = chase(c, vk, { pitch: 0.42, dist: vk === 2 ? 10 : 7, side: 0.5 });
    let top = 0;
    await c.rec(`runover-${name}`, c.fps * 6, () => {
      top = Math.max(top, speedOf(c));
      return { A: { yaw: 0, buttons: BTN.FWD, cam: cam(mine(c)) } };
    });
    c.video(`runover-${name}`, 8, `the ${name} through a knot of walkers`);
    console.log(`\n  runover ${name}: top ${top.toFixed(1)} m/s, now ${speedOf(c).toFixed(1)}; the dead ${dead0} -> ${c.info.dead.length}; the ${name} ${hp0} -> ${vehId(c, v.id)?.hp} hp; the rider ${mine0} -> ${c.info.hp} hp; still driving: ${c.info.s.drive}`);
    await c.run(c.fps * 2, { A: { buttons: BTN.BACK, cam: null } });
    await c.chat(c.A, '/clear 400');
    await c.chat(c.A, '/veh out');
    await c.chat(c.A, '/veh remove');
    await c.run(6);
  }
}

// Into something solid, and what it costs.
export async function crash(c) {
  await begin(c);
  const [gx, gz] = runway(c);
  await sweep(c, gx, gz);
  for (const name of ['car', 'moped', 'bike']) {
    const vk = KIND[name];
    await tp(c, c.A, gx - (vk === 2 ? 1.9 : 1.1), gz, 0, 0);
    const wall = await put(c, 'car', gx, gz - (vk === 2 ? 62 : vk === 1 ? 40 : 30), Math.PI / 2, { tint: 3, broken: true });
    await c.chat(c.A, `/tp ${(gx - (vk === 2 ? 1.9 : 1.1)).toFixed(1)} ${gz.toFixed(1)}`);
    const v = await put(c, name, gx, gz, 0, { tint: 1 });
    await enter(c, c.A, v.id, 8, { A: { yaw: 0 } });
    const hp0 = vehId(c, v.id).hp, mine0 = c.info.hp;
    const held = BTN.FWD | (vk === 3 ? BTN.SPRINT : 0);
    let top = 0;
    const far = () => Math.abs(c.info.s.z - wall.z);
    await c.until(() => far() < 14 + speedOf(c) * 0.5 || !c.info.s.drive, c.fps * 12, () => {
      top = Math.max(top, speedOf(c));
      return { A: { yaw: 0, buttons: held, cam: null } };
    });
    const cam = c.orbit([wall.x, wall.y + 1.0, wall.z + 3], -Math.PI / 2 - 0.5, 0.22, 13, { fov: 50, body: true });
    await c.rec(`crash-${name}`, Math.round(c.fps * 2.4), () => {
      top = Math.max(top, speedOf(c));
      return { A: { yaw: 0, buttons: held, cam } };
    });
    c.video(`crash-${name}`, 8, `the ${name} into a wreck at ${Math.round(top * 3.6)} km/h`);
    const now = vehId(c, v.id);
    console.log(`\n  crash ${name}: struck at ${top.toFixed(1)} m/s; the ${name} ${hp0} -> ${now?.hp} hp (state ${now?.state}); the rider ${mine0} -> ${c.info.hp} hp; still on it: ${!!c.info.s.drive}`);
    await c.shot(c.A, `crash-${name}-after`, { hud: true, settle: 6, hold: { A: { cam: null, pitch: -0.2 } } });
    if (vk === 2) {
      // ...and again and again, until it gives up
      let hits = 1;
      for (; hits < 12 && vehId(c, v.id).state === 1; hits++) {
        await c.run(Math.round(c.fps * 4.5), { A: { yaw: 0, buttons: BTN.BACK } });
        await c.until(() => speedOf(c) < 0.5 && Math.abs(c.info.s.z - wall.z) < 6, c.fps * 10, { A: { yaw: 0, buttons: held } });
      }
      console.log(`  crash car: broken down after ${hits} hits: hp ${vehId(c, v.id).hp}, state ${vehId(c, v.id).state}`);
      await c.shot(c.A, 'breakdown-car-seat', { hud: true, settle: 6, hold: { A: { cam: null, pitch: -0.2 } } });
      await c.shot(c.A, 'breakdown-car-out', { hud: false, settle: 10, hold: { A: { cam: c.orbit([c.info.s.x, c.info.s.y + 1, c.info.s.z], 0.9, 0.25, 9, { fov: 45, body: true }) } } });
    }
    await c.run(2, { A: { cam: null } });
    await c.chat(c.A, '/veh out');
    await c.run(4);
    await sweep(c, gx, gz, 90);
  }
}

// The tank runs dry.
export async function empty(c) {
  await begin(c);
  const [gx, gz] = runway(c);
  await sweep(c, gx, gz);
  for (const name of ['moped', 'car']) {
    const vk = KIND[name];
    await tp(c, c.A, gx - (vk === 2 ? 1.9 : 1.1), gz, 0, 0);
    const v = await put(c, name, gx, gz, 0, { tint: 2 });
    await enter(c, c.A, v.id, 8, { A: { yaw: 0 } });
    await c.chat(c.A, `/veh fuel ${vk === 2 ? 5 : 1.6}`);
    await c.run(Math.round(c.fps * 2.6), { A: { yaw: 0, buttons: BTN.FWD } });
    await c.shot(c.A, `empty-${name}-1-low`, { hud: true, settle: 1, hold: { A: { yaw: 0, buttons: BTN.FWD, pitch: -0.3 } } });
    const n = await c.until(() => speedOf(c) < 0.3, c.fps * 30, { A: { yaw: 0, buttons: BTN.FWD, pitch: -0.3 } });
    await c.shot(c.A, `empty-${name}-2-dry`, { hud: true, settle: 4, hold: { A: { yaw: 0, buttons: BTN.FWD, pitch: -0.3 } } });
    console.log(`\n  ${name} on its last ${vk === 2 ? 5 : 1.6} Fuel: stopped ${(n / c.fps + 2.7).toFixed(1)} s on, ${Math.abs(c.info.s.z - gz).toFixed(0)} m off; fuel ${c.info.s.dfuel}; "${c.info.prompt}"`);
    await leave(c, c.A, 10, { A: { yaw: 0 } });
    await c.chat(c.A, '/veh remove');
    await c.run(4);
  }
}

// Footage: a rider who knows the road (scripts/vehicle-routes.js's pilot), from the bridgehead towards a district -
// from the seat, then from behind.
async function film(c, name, place, { skip = 0, each = 15, bold = 1 } = {}) {
  const vk = KIND[name];
  await begin(c);
  const w = world(c);
  const z = w.zones.find((q) => ZONE_NAMES[q.id] === place);
  if (!z) throw new Error(`no ${place} in this world`);
  const cl = clearance(w);
  const fl = flood(w, cl, w.start.x, w.start.z, vk === 2 ? 1.1 : 0.75, vk);
  const raw = fl.path(z.x, z.z);
  // (set off a little down the way: the bridgehead itself has the team's vehicles standing on it)
  const from = Math.min(raw.length - 40, 30);
  const pilot = makePilot(w, vk, raw.slice(from), cl, bold);
  const [sx, sz] = pilot.path[0];
  for (const p of pilot.path.slice(0, 400)) {
    const v = vehAt(c, p[0], p[1], 0, 3);
    if (v) await sweep(c, v.x, v.z, 1);
  }
  await tp(c, c.A, sx, sz, pilot.yaw0, -0.1);
  await c.chat(c.A, `/tp ${(sx + Math.cos(pilot.yaw0) * 1.6).toFixed(2)} ${(sz - Math.sin(pilot.yaw0) * 1.6).toFixed(2)}`);
  const v = await put(c, name, sx, sz, pilot.yaw0, { tint: vk === 2 ? 7 : 2 });
  await enter(c, c.A, v.id, 8, { A: { yaw: pilot.yaw0 } });
  await c.chat(c.A, '/clear 2000');
  let done = false, top = 0, far = 0, last = null, stuck = 0;
  const hold = () => {
    const m = mine(c);
    const sp = Math.hypot(m.vx, m.vz);
    top = Math.max(top, sp);
    if (last) far += Math.hypot(m.x - last[0], m.z - last[1]);
    last = [m.x, m.z];
    const st = pilot.step(m);
    done ||= st.done;
    stuck = sp < 0.4 ? stuck + 1 : 0;
    // (held up: back off, as scripts/vehicle-routes.js's driver does)
    if (stuck > c.fps * 2.5 && stuck < c.fps * 4) return BTN.BACK | (st.turn > 0 ? BTN.LEFT : st.turn < 0 ? BTN.RIGHT : 0);
    if (stuck >= c.fps * 4) stuck = 0;
    return (st.thr > 0 ? BTN.FWD : st.thr < 0 ? BTN.BACK : 0) | (st.turn > 0 ? BTN.RIGHT : st.turn < 0 ? BTN.LEFT : 0) | (vk === 3 ? BTN.SPRINT : 0);
  };
  const lookYaw = () => c.info.s.dyaw;
  await c.rec(`film-${name}-seat`, c.fps * each, () => (done ? null : { A: { buttons: hold(), yaw: lookYaw(), pitch: -0.14, cam: null } }), { hud: true });
  c.video(`film-${name}-seat`, 8, `${name}: from the seat, the bridgehead towards ${place}`);
  console.log(`\n  film ${name}: after the seat ${far.toFixed(0)} m, top ${top.toFixed(1)} m/s, fuel ${c.info.s.dfuel.toFixed(1)}, hp ${vehId(c, v.id)?.hp}`);
  if (skip) await c.run(c.fps * skip, () => (done ? {} : { A: { buttons: hold(), yaw: lookYaw(), pitch: -0.14, cam: null } }));
  const cam = chase(c, vk);
  await c.rec(`film-${name}-behind`, c.fps * each, () => (done ? null : { A: { buttons: hold(), yaw: lookYaw(), cam: cam(mine(c)) } }));
  c.video(`film-${name}-behind`, 8, `${name}: from behind, on towards ${place}`);
  console.log(`  film ${name}: in all ${far.toFixed(0)} m in ${each * 2 + skip} s, top ${top.toFixed(1)} m/s, fuel ${c.info.s.dfuel.toFixed(1)}, hp ${vehId(c, v.id)?.hp}, arrived: ${done}`);
  await c.run(c.fps * 2, { A: { buttons: BTN.BACK, cam: null } });
  await leave(c, c.A);
  await c.chat(c.A, '/veh remove');
  await c.run(4);
}
export const film_car = (c) => film(c, 'car', 'Port Calder');
export const film_moped = (c) => film(c, 'moped', 'Mile 9 Truck Stop', { skip: 12 });
export const film_bike = (c) => film(c, 'bike', 'Port Calder');

// What they cost a frame (software rendering, so no frame rate: the draw calls and triangles the scene takes with
// them in view, and the milliseconds VehicleClient.update takes - the page's real clock round each call).
export async function cost(c) {
  await begin(c);
  const [gx, gz] = runway(c);
  await sweep(c, gx, gz - 12, 40);
  await tp(c, c.A, gx, gz + 4, 0, -0.1);
  await c.ev(c.A, () => {
    const g = window.__game, V = g.vehicles, real = window.__realNow || performance.now.bind(performance);
    if (!V.__timed) {
      const up = V.update.bind(V);
      V.__timed = { ms: 0, n: 0 };
      V.update = (dt, rp) => {
        const t = Date.now(), t1 = real();
        up(dt, rp);
        V.__timed.ms += real() - t1;
        V.__timed.n++;
        void t;
      };
    }
  });
  const take = async (label, o) => {
    await c.run(10, o);
    await c.ev(c.A, () => {
      const g = window.__game;
      g.vehicles.__timed.ms = 0;
      g.vehicles.__timed.n = 0;
      g.__calls = [];
    });
    for (let i = 0; i < 40; i++) {
      await c.frame(typeof o === 'function' ? o(i) : o || {});
      await c.ev(c.A, () => {
        const R = window.__game.renderer;
        const r = (R.renderer || R.gl || R).info.render;
        window.__game.__calls.push([r.calls, r.triangles]);
      });
    }
    const r = await c.ev(c.A, () => {
      const g = window.__game, a = g.__calls;
      const med = (k) => a.map((x) => x[k]).sort((p, q) => p - q)[a.length >> 1];
      return { calls: med(0), tris: med(1), ms: g.vehicles.__timed.ms / Math.max(1, g.vehicles.__timed.n), n: g.vehicles.list.size, programs: (g.renderer.renderer || g.renderer.gl || g.renderer).info.programs.length };
    });
    console.log(`\n  cost ${label}: ${r.calls} draw calls, ${r.tris} triangles, VehicleClient.update ${r.ms.toFixed(3)} ms a frame (${r.n} vehicles in the world), ${r.programs} shader programs`);
    return r;
  };
  const look = { A: { yaw: 0, pitch: -0.1, cam: null } };
  await take('nothing in view', look);
  const made = [];
  for (const [i, name] of ['car', 'moped', 'bike', 'car', 'moped', 'bike'].entries()) made.push(await put(c, name, gx - 5 + (i % 3) * 5, gz - 8 - Math.floor(i / 3) * 7, 0.5, { tint: i }));
  await take('six parked in view (2 cars, 2 mopeds, 2 bicycles)', look);
  await c.chat(c.A, '/veh starters 6');
  await light(c, NIGHT);
  for (const v of made) {
    await c.chat(c.A, `/tp ${(v.x + 1.5).toFixed(1)} ${v.z.toFixed(1)}`);
    await c.run(3);
    await c.chat(c.A, '/veh lights');
    await c.run(2);
  }
  await tp(c, c.A, gx, gz + 4, 0, -0.1);
  await take('the six at night, lamps lit', look);
  await light(c, DAY);
  await tp(c, c.A, gx - 6.9, gz - 8, 0, 0);
  await enter(c, c.A, made[0].id, 8, { A: { yaw: 0 } });
  await take('driving a car past the others', { A: { yaw: 0, pitch: -0.1, cam: null, buttons: BTN.FWD } });
  await c.run(c.fps * 2, { A: { buttons: BTN.BACK } });
}

// The strips (and the mp4s) of footage already taken, cut again: for a session that ended before its sheets were made.
export async function strips(c) {
  const T = { 'runover-car': 'the car through a knot of walkers', 'runover-moped': 'the moped through a knot of walkers (it is stopped, and its rider thrown)', 'crash-car': 'the car into a wreck at 61 km/h', 'crash-moped': 'the moped into a wreck at 48 km/h', 'crash-bike': 'the bicycle into a wreck at 36 km/h' };
  for (const [name, title] of Object.entries(T)) c.video(name, 8, title);
}

// One clip of a scripted rider on a real route (run at --fps 30: the rider's hands are as quick as the frames):
// from the seat or from behind, starting `at` of the way along it.
async function clip(c, name, place, mode, { at = 0, secs = 15, bold = 0.8 } = {}) {
  const vk = KIND[name];
  await begin(c);
  const w = world(c);
  const z = w.zones.find((q) => ZONE_NAMES[q.id] === place);
  if (!z) throw new Error(`no ${place} in this world`);
  const cl = clearance(w);
  const raw = flood(w, cl, w.start.x, w.start.z, vk === 2 ? 1.1 : 0.75, vk).path(z.x, z.z);
  const from = Math.max(30, Math.min(raw.length - 60, Math.round(raw.length * at)));
  const pilot = makePilot(w, vk, raw.slice(from), cl, bold);
  const [sx, sz] = pilot.path[0];
  for (const p of pilot.path) {
    const v = vehAt(c, p[0], p[1], 0, 3);
    if (v) await sweep(c, v.x, v.z, 1);
  }
  await tp(c, c.A, sx + Math.cos(pilot.yaw0) * 1.6, sz - Math.sin(pilot.yaw0) * 1.6, pilot.yaw0, -0.1);
  const v = await put(c, name, sx, sz, pilot.yaw0, { tint: vk === 2 ? 7 : 2 });
  await enter(c, c.A, v.id, 8, { A: { yaw: pilot.yaw0 } });
  await c.chat(c.A, '/clear 2000');
  let done = false, top = 0, far = 0, last = null, stuck = 0, backs = 0;
  const hold = () => {
    const m = mine(c);
    const sp = Math.hypot(m.vx, m.vz);
    top = Math.max(top, sp);
    if (last) far += Math.hypot(m.x - last[0], m.z - last[1]);
    last = [m.x, m.z];
    const st = pilot.step(m);
    done ||= st.done;
    stuck = sp < 0.4 ? stuck + 1 : stuck > c.fps * 1.2 ? stuck + 1 : 0;
    // (held up: back off for a moment, as scripts/vehicle-routes.js's driver does)
    if (stuck > c.fps * 1.2 && stuck < c.fps * 2.6) {
      if (stuck === Math.round(c.fps * 1.2) + 1) backs++;
      return BTN.BACK | (st.turn > 0 ? BTN.LEFT : st.turn < 0 ? BTN.RIGHT : 0);
    }
    if (stuck >= c.fps * 2.6) stuck = 0;
    return (st.thr > 0 ? BTN.FWD : st.thr < 0 ? BTN.BACK : 0) | (st.turn > 0 ? BTN.RIGHT : st.turn < 0 ? BTN.LEFT : 0) | (vk === 3 ? BTN.SPRINT : 0);
  };
  const cam = chase(c, vk, { pitch: 0.34, dist: vk === 2 ? 6.5 : 4.2, ease: 0.12 });
  const tag = `film-${name}-${mode}`;
  await c.rec(tag, c.fps * secs, () => (done ? null : { A: { buttons: hold(), yaw: c.info.s.dyaw, pitch: -0.14, cam: mode === 'seat' ? null : cam(mine(c)) } }), { hud: mode === 'seat' });
  c.video(tag, 8, `${name}: ${mode === 'seat' ? 'from the seat' : 'from behind'}, on the way from the bridgehead to ${place} (a scripted rider)`);
  console.log(`\n  ${tag}: ${far.toFixed(0)} m in ${secs} s, top ${top.toFixed(1)} m/s, fuel ${c.info.s.dfuel.toFixed(1)}, hp ${vehId(c, v.id)?.hp}, backed off ${backs} times, arrived: ${done}`);
}
export const film_car_seat = (c) => clip(c, 'car', 'Port Calder', 'seat');
export const film_car_behind = (c) => clip(c, 'car', 'Port Calder', 'behind', { at: 0.45 });
export const film_moped_seat = (c) => clip(c, 'moped', 'Mile 9 Truck Stop', 'seat', { at: 0.3 });
export const film_moped_behind = (c) => clip(c, 'moped', 'Port Calder', 'behind', { at: 0.5 });
export const film_bike_seat = (c) => clip(c, 'bike', 'Port Calder', 'seat', { at: 0.5 });
export const film_bike_behind = (c) => clip(c, 'bike', 'Port Calder', 'behind', { at: 0.1 });
