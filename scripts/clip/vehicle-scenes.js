// The scenes scripts/clip/vehicle-shots.js runs (see its head for the context each is given).
const DAY = 0.2, NIGHT = 0.75;
const KIND = { moped: 1, car: 2, bike: 3 };

// to the mainland, the dead about the bridgehead put down, the hour pinned
async function mainland(c, p = c.A, cycle = DAY) {
  if (await c.ev(p, () => window.__game.world?.kind === 2)) return;
  await c.chat(p, '/map2');
  for (let i = 0; i < 120; i++) {
    await c.wait(500);
    if (await c.ev(p, () => window.__game.world?.kind === 2 && window.__game.prediction.hasServerState && window.__game.state === 'playing')) break;
  }
  await c.wait(4000);
  await c.chat(p, '/clear 300');
  await c.ev(p, (cy) => (window.__game.debugCycle = cy), cycle);
  await c.wait(800);
}
// the vehicle of kind vk nearest to the player: [id, x, y, z, yaw]
const nearest = (c, p, vk) =>
  c.ev(
    p,
    (vk) => {
      const g = window.__game;
      const s = g.prediction.state;
      let best = null, bd = 1e9;
      for (const e of g.vehicles.list.values()) {
        if (vk && e.vk !== vk) continue;
        const d = Math.hypot(e.veh.x - s.x, e.veh.z - s.z);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      return best && [best.id, best.veh.x, best.veh.y, best.veh.z, best.veh.yaw];
    },
    vk,
  );
const TP = [-500, 12]; // an open stretch of the embankment by the bridgehead

// A turnaround of each vehicle: found (broken), running, and with its lamps lit at night.
export async function turn(c) {
  const p = c.A;
  await mainland(c);
  for (const [name, vk] of Object.entries(KIND)) {
    for (const state of ['broken', 'ok', 'night']) {
      await c.chat(p, `/tp ${TP[0]} ${TP[1]}`);
      await c.ev(p, () => {
        window.__game.input.yaw = 0;
        window.__game.input.pitch = 0;
      });
      await c.wait(700);
      await c.chat(p, `/veh ${name}${state === 'broken' ? ' broken' : ''}`);
      await c.wait(900);
      const v = await nearest(c, p, vk);
      if (state === 'night') {
        await c.ev(p, (cy) => (window.__game.debugCycle = cy), NIGHT);
        await c.chat(p, '/veh lights');
      }
      const files = [];
      const dist = vk === 2 ? 8.5 : 4.2;
      for (const [k, yaw, pitch] of [[0, 0.6, 0.22], [1, Math.PI / 2, 0.12], [2, Math.PI - 0.5, 0.25], [3, -Math.PI / 2 - 0.4, 0.3], [4, 0.02, 0.1], [5, 1.0, 1.1]]) {
        // (yaw 0: the camera in front of it; the vehicle's own yaw turns the ring)
        await c.orbit(p, [v[1], v[2] + (vk === 2 ? 0.75 : 0.6), v[3]], v[4] + yaw, pitch, dist, { fov: 34, body: false });
        files.push(await c.shot(p, `turn-${name}-${state}-${k}`, { hud: false, settle: 500 }));
      }
      c.strip(`turn-${name}-${state}`, files, 3, `${name}: ${state === 'broken' ? 'as found (it wants its parts)' : state === 'ok' ? 'running' : 'lamps lit at night'}`, [640, 360]);
      if (state === 'night') await c.ev(p, (cy) => (window.__game.debugCycle = cy), DAY);
      await c.chat(p, '/veh remove');
      await c.wait(300);
      // (out of the way of the next one)
      await c.chat(p, `/tp ${TP[0] + 14} ${TP[1] + 2}`);
      await c.wait(400);
    }
  }
  await c.cam(p, null);
}

// A first look while building: one of each, running, from four sides and from the seat.
export async function peek(c) {
  const p = c.A;
  await mainland(c);
  for (const [name, vk] of Object.entries(KIND)) {
    await c.chat(p, `/tp ${TP[0]} ${TP[1]}`);
    await c.ev(p, () => {
      window.__game.input.yaw = 0;
      window.__game.input.pitch = 0;
    });
    await c.wait(700);
    await c.chat(p, `/veh ${name}`);
    await c.wait(900);
    const v = await nearest(c, p, vk);
    const files = [];
    const dist = vk === 2 ? 8 : 3.8;
    for (const [k, yaw, pitch] of [[0, 0.6, 0.2], [1, Math.PI / 2, 0.1], [2, Math.PI - 0.5, 0.25], [3, 1.0, 1.0]]) {
      await c.orbit(p, [v[1], v[2] + 0.7, v[3]], v[4] + yaw, pitch, dist, { fov: 36, body: false });
      files.push(await c.shot(p, `peek-${name}-${k}`, { hud: false }));
    }
    // in it: from outside with our own body drawn, then from the seat
    const idx = await c.ev(p, (id) => [...window.__game.vehicles.list.keys()].indexOf(id), v[0]);
    void idx;
    await c.cam(p, null);
    await c.ev(p, (id) => window.__game.conn.action(37, 0, id), v[0]);
    await c.wait(1200);
    for (const [k, yaw, pitch] of [[4, 0.7, 0.2], [5, Math.PI / 2, 0.1], [6, Math.PI - 0.6, 0.3]]) {
      await c.orbit(p, [v[1], v[2] + 0.9, v[3]], v[4] + yaw, pitch, dist * 0.8, { fov: 36, body: true });
      files.push(await c.shot(p, `peek-${name}-${k}`, { hud: false }));
    }
    await c.cam(p, null);
    await c.ev(p, (yaw) => {
      window.__game.input.yaw = yaw;
      window.__game.input.pitch = -0.25;
    }, v[4]);
    files.push(await c.shot(p, `peek-${name}-7`, { hud: true, settle: 600 }));
    await c.ev(p, () => (window.__game.input.pitch = -0.75));
    files.push(await c.shot(p, `peek-${name}-8`, { hud: true, settle: 600 }));
    c.strip(`peek-${name}`, files, 3, name, [640, 360]);
    await c.chat(p, '/veh out');
    await c.wait(500);
    await c.chat(p, '/veh remove');
    await c.chat(p, `/tp ${TP[0] + 14} ${TP[1] + 2}`);
    await c.wait(400);
  }
}
