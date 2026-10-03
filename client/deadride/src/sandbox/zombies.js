// Zombie sandbox.
//   ?sandbox=zombies&map=shaft-nine&stop=0&variant=miner_lamp&n=1   real map stop (World, nav, colliders) + zombies chasing a dummy player
//   ?sandbox=zombies&scene=tunnel&variant=miner_lamp&n=3            dark timbered mine tunnel with an L-bend (lamp beam tests)
//   ?sandbox=zombies&scene=studio&variant=frost_tourist             neutral studio (turntables / close-ups)
//   &map=<id> also imports src/maps/<id>/zombies.js (a map's variant set) if it exists; &vmod=path/to/module.js imports any module
// window.__t: spawn, shoot, explode, kill, cam, follow, orbit, closeup, freeze, step, metrics, stress, lod, ...
import * as THREE from 'three';
import { Synth } from '../core/synth.js';
import { FX } from '../core/fx.js';
import { World } from '../core/world.js';
import { Player } from '../core/player.js';
import { input } from '../core/input.js';
import { compileAtmo } from '../core/gfx.js';
import { std } from '../core/mats.js';
import { HaloBatch } from '../core/glow.js';
import { loadMap } from '../maps/index.js';
import { Barricade } from '../game/barricade.js';
import { ZombieManager, REGISTRY } from '../game/zombies/index.js';
import { BI } from '../game/zombies/rig.js';
import { registerAll } from '../game/zombies/variants/index.js';
import '../game/zombies/variants/debug.js';

const V3 = THREE.Vector3;

// ------------------------------------------------------------------ test stops
const studioStop = { id: 'studio', name: 'Studio', origin: [0, 0, 0], viewRadius: 400, async build(ctx) {
  const { B } = ctx; const floor = B.m('sbFloor', std({ color: 0x4a4a48, roughness: 0.85, key: 'sbfloor' }));
  B.plane({ p: [0, 0, 0], s: [120, 120], mat: floor, cast: false });
  return { atmo: { name: 'studio', fog: { color: 0x3a4048, density: 0.002 }, sky: { zenith: 0x404a58, horizon: 0x8a929c, stars: 0, disc: 0, cloud: 0 }, sun: { dir: [0.5, 0.7, -0.6], color: 0xfff2e0, intensity: 3.2, shadow: true }, env: { intensity: 0.55 }, exposure: 1, bloom: 0.25, vignette: 0.25, grain: 0.0, ao: 0.6, autoExposure: { key: 0.2, min: 0.9, max: 1.4 } },
    envPatches: [{ dir: [0.5, 0.7, -0.6], color: 0xfff0e0, size: 2, intensity: 6 }], playerStart: { pos: [0, 0, 6], yaw: 0 }, groundY: 0, groundSurface: 'concrete', navBounds: [-40, -40, 40, 40], spawns: [] };
} };
const tunnelStop = { id: 'tunnel', name: 'Test Drift', origin: [0, 0, 0], viewRadius: 400, async build(ctx) {
  const { B } = ctx;
  const rock = B.m('tRock', { pattern: 'rock', size: 512, tile: 3, colors: [0x1c1a18, 0x2c2926, 0x3e3a34, 0x55504a], params: { scale: 6, strata: 6, cracks: 0.9, roughness: 0.8, tone: 0.5, moisture: 0.5 }, bump: 70, rough: [0.65, 0.95], layers: { grime: 0.4, dust: 0.3 } }, { triplanar: 1 / 3 });
  const timber = B.m('tTimber', { pattern: 'wood', size: 512, tile: 1.5, colors: [0x5a4430, 0x2e2216], params: { scale: 14, rings: 8, knots: 0.5, weather: 0.8 }, bump: 5, rough: [0.75, 0.95], layers: { grime: 0.5, dust: 0.3 } });
  const floorM = B.m('tFloor', { pattern: 'gravel', size: 512, tile: 1.4, colors: [0x1e1c1a, 0x2e2b27, 0x141210, 0x46413a], params: { scale: 16, variation: 0.8, sand: 0.6 }, bump: 20, rough: [0.75, 0.95], layers: { dust: 0.4 } });
  const rail = B.m('tRail', std({ color: 0x3a2a22, metalness: 1, roughness: 0.55, key: 'trail' }));
  const W = 3.2, H = 2.7;
  // drift A runs along −Z (x = 0, z 10 → −30); drift B branches east at z = −30 (x 0 → 32). Walls are explicit segments so
  // the junction stays open; walls/props are walk:false so the nav grid does not treat their tops as floor.
  const wall = (x0, z0, x1, z1) => { const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0); B.box({ p: [(x0 + x1) / 2, -0.2, (z0 + z1) / 2], s: [1.0, H + 0.6, len], yaw, mat: rock, col: 'rock', walk: false, cast: false }); };
  wall(-2.1, 12.5, -2.1, -32.6); wall(2.1, 12.5, 2.1, -28.4); wall(1.6, -27.9, 34.5, -27.9); wall(-2.6, -32.1, 34.5, -32.1); wall(-2.6, 12.1, 2.6, 12.1); wall(34.1, -27.4, 34.1, -32.6);
  B.box({ p: [0, -0.2, -10], s: [W + 1.2, 0.2, 46], mat: floorM, col: 'gravel', cast: false }); B.box({ p: [17, -0.2, -30], s: [35, 0.2, W + 1.2], mat: floorM, col: 'gravel', cast: false });
  B.box({ p: [0, H, -10], s: [W + 2, 0.8, 46], mat: rock, col: 'rock', walk: false, cast: false }); B.box({ p: [17, H, -30], s: [35, 0.8, W + 2], mat: rock, col: 'rock', walk: false, cast: false });
  const sets = (x0, z0, x1, z1) => { const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0); const nx = Math.cos(yaw), nz = -Math.sin(yaw); const n = Math.floor(len / 1.8);
    for (let i = 0; i <= n; i++) { const t = i / n, px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t; for (const sg of [-1, 1]) B.box({ p: [px + nx * sg * (W / 2 - 0.12), 0, pz + nz * sg * (W / 2 - 0.12)], s: [0.22, H - 0.05, 0.22], yaw, mat: timber, col: 'wood', walk: false, bevel: 0.02 }); B.box({ p: [px, H - 0.28, pz], s: [W, 0.24, 0.24], yaw: yaw + Math.PI / 2, mat: timber, col: false, bevel: 0.02 }); }
    for (const sg of [-1, 1]) B.box({ p: [(x0 + x1) / 2 + nx * sg * 0.305, 0.0, (z0 + z1) / 2 + nz * sg * 0.305], s: [0.06, 0.08, len], yaw, mat: rail, col: false, cast: false }); };
  sets(0, 10, 0, -26.5); sets(3.5, -30, 32, -30);
  const halos = new HaloBatch(16); B.group.add(halos.mesh);
  for (const z of [4, -8]) { ctx.light({ pos: [0, H - 0.4, z], color: 0xffb070, intensity: 6, distance: 12, decay: 2, flicker: 0.15, flickerSpeed: 7 }); halos.add([0, H - 0.4, z], 0xffb070, 0.35, 0.8, 7); }
  return { atmo: { name: 'tunnel', fog: { color: 0x0a0908, scatter: 0x1a1612, density: 0.045, falloff: 0, base: 0 }, sky: null, sun: { dir: [0, 1, 0], intensity: 0, shadow: false }, env: { intensity: 0.07 }, exposure: 1.2, bloom: 0.45, vignette: 0.4, grain: 0.035, ao: 0.7, autoExposure: { key: 0.13, min: 1.1, max: 2.4 }, reverb: 'tunnel' },
    playerStart: { pos: [0, 0, 6], yaw: 0 }, groundY: 0, groundSurface: 'gravel', navBounds: [-3, -33, 34, 12], spawns: [] };
} };

export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer); const fx = new FX(gfx); const world = new World(gfx, synth, fx);
  input.init(gfx.canvas);
  const scene = P.get('scene') || (P.get('map') ? 'map' : 'studio');
  let map;
  if (scene === 'map') map = await loadMap(P.get('map') || 'shaft-nine');
  else map = { id: 'sandbox-' + scene, name: scene, stops: [scene === 'tunnel' ? tunnelStop : studioStop] };
  const t0 = performance.now(); await world.loadMap(map, () => {}); console.log('world built in', (performance.now() - t0).toFixed(0), 'ms');
  world.setActive(Math.min(+(P.get('stop') || 0), world.stops.length - 1));
  const st = world.active; const O = st.origin;
  const player = new Player(gfx, world, input); player.teleport([O.x + st.playerStart.pos[0], O.y + st.playerStart.pos[1], O.z + st.playerStart.pos[2]], st.playerStart.yaw); player.frozen = true; gfx.vmEnabled = false;
  // dummy target the zombies chase (movable), separate from the camera
  const target = { pos: player.pos.clone(), eyeH: 1.6, moving: null };
  const zm = new ZombieManager({ gfx, world, fx, audio: null }); window.__zm = zm;
  // a map's own variant module (src/maps/<map>/zombies.js by convention, or ?vmod=path/from/root.js) is imported if present
  const vmod = P.get('vmod') ? '/' + P.get('vmod').replace(/^\//, '') : (P.get('map') && P.get('map') !== 'shaft-nine' ? `../maps/${P.get('map')}/zombies.js` : null);
  if (vmod) { try { await import(vmod); } catch (e) { console.log('variant module not loaded:', vmod, e.message); } }
  await registerAll(); const mapId = P.get('map') || 'shaft-nine';
  const mapVariants = REGISTRY.maps.get(mapId) || [];
  const vid = P.get('variant') || mapVariants[0] || 'miner_lamp';
  const tb = performance.now(); await zm.prepare(mapId); console.log('zombie assets prepared in', (performance.now() - tb).toFixed(0), 'ms');
  let t = 0, last = performance.now(), frozen = false, aiOff = false; const ft = []; let camMode = null;
  const slip = { max: 0, sum: 0, n: 0 }; let accMax = 0;
  const T = window.__t = {
    gfx, world, fx, zm, player, target, BI, V3,
    /** spawn n zombies of a variant; opts {dist, spread, kind, speedClass, yawToTarget, at:[x,y,z]} */
    spawn(variant = vid, n = 1, o = {}) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = (o.angle ?? 0) + (n > 1 ? (i / n) * Math.PI * 2 * (o.arc ?? 1) : 0); const d = o.dist ?? 6;
        const p = o.at ? new V3(o.at[0], o.at[1], o.at[2]) : new V3(target.pos.x - Math.sin(a) * d, target.pos.y, target.pos.z - Math.cos(a) * d);
        const g = world.groundAt(p.x, p.z, p.y + 2); p.y = g.y;
        const yaw = Math.atan2(-(target.pos.x - p.x), -(target.pos.z - p.z));
        const z = zm.spawn(Array.isArray(variant) ? variant[i % variant.length] : variant, p, o.yaw ?? yaw, { speedClass: o.speedClass, speed: o.speed, kind: o.kind || 'walk', spawnDef: o.spawnDef, barricade: o.barricade, hp: o.hp, look: o.look, hatOff: o.hatOff });
        if (z) { z.anim.measure = true; out.push(z); }
      }
      return out.length;
    },
    clear() { zm.clear(); },
    /** synthetic hit on zombie k at a body part: 'head'|'torso'|'arm'|'leg'|bone name */
    shoot(part = 'torso', o = {}) {
      const z = zm.alive[o.k ?? 0]; if (!z) return null; const bone = { head: 'head', torso: 'chest', arm: 'forearm.R', leg: 'thigh.L', neck: 'neck' }[part] || part; const bi = BI[bone];
      const tp = z.pose.P[bi].clone(); if (bone === 'head') z.pose.pointOn(bi, 0, 1.66, -0.02, tp); else if (bone !== 'chest') { const tl = z.pose.tail(bi, new V3()); tp.lerp(tl, 0.5); } else tp.y -= 0.05;
      const from = o.from ? new V3(...o.from) : gfx.camera.position.clone(); const dir = tp.clone().sub(from).normalize();
      const out = {}; const hit = zm.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, 200, out);
      if (!hit) return { miss: true };
      const r = zm.damage(out.zombie, { amount: o.dmg ?? 40, part: out.part, dir, point: out.point, normal: out.normal, impulse: o.impulse ?? 3, weapon: 'test' });
      return { part: out.part, bone: out.bone, surface: out.surface, ...r, hp: out.zombie.hp };
    },
    explode(x, y, z, r = 5, dmg = 400) { const p = x === undefined ? (zm.alive[0] ? zm.alive[0].pos.clone().add(new V3(0.8, 0.5, 0.5)) : target.pos.clone()) : new V3(x, y, z); fx.explosion(p, r, 1); zm.explode(p, r, dmg); return true; },
    kill(k = 0) { const z = zm.alive[k]; if (!z) return false; return T.shoot('torso', { k, dmg: 99999, impulse: 5 }); },
    cam(x, y, z, lx, ly, lz, fov = 55) { camMode = null; player._free = true; gfx.camera.position.set(x, y, z); gfx.camera.lookAt(lx, ly, lz); gfx.setFov(fov); },
    /** camera orbiting zombie k: yaw deg, dist, height, look height, fov */
    orbit(yawDeg = 0, dist = 3, y = 1.0, ly = 0.95, fov = 40, k = 0) { camMode = { kind: 'orbit', yawDeg, dist, y, ly, fov, k, rel: true }; player._free = true; gfx.setFov(fov); },
    /** camera at (yaw deg relative to the zombie's facing, dist) aimed at a bone's current world position */
    boneCam(bone = 'head', yawDeg = 0, dist = 0.6, dy = 0.0, fov = 30, k = 0) { camMode = { kind: 'bone', bone, yawDeg, dist, dy, k }; player._free = true; gfx.setFov(fov); },
    closeup(what = 'head', k = 0, yawDeg = 20) { const cfg = { head: [0.65, 1.64, 1.62, 26], hands: [1.1, 1.0, 0.95, 32], feet: [1.2, 0.3, 0.12, 30], torso: [1.6, 1.3, 1.2, 34] }[what]; camMode = { kind: 'orbit', yawDeg, dist: cfg[0], y: cfg[1], ly: cfg[2], fov: cfg[3], k, rel: true }; player._free = true; gfx.setFov(cfg[3]); },
    follow(ox = 2.5, oy = 1.3, oz = 0.5, ly = 0.95, fov = 40, k = 0) { camMode = { kind: 'follow', ox, oy, oz, ly, fov, k }; player._free = true; gfx.setFov(fov); },
    freeze(v = true) { frozen = v; }, aiOff(v = true) { aiOff = v; },
    step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt); gfx.render(dt, t); },
    moveTarget(x, z) { target.pos.set(x, target.pos.y, z); const g = world.groundAt(x, z, target.pos.y + 1); target.pos.y = g.y; },
    /** target walks a circle (radius r, speed m/s) so the crowd keeps moving */
    circleTarget(r = 6, sp = 1.5) { target.moving = { r, sp, a: 0, c: target.pos.clone() }; },
    lod(l) { zm.lodDist = l === 0 ? [999, 999] : l === 1 ? [0, 999] : [0, 0]; if (l === 0) zm.triBudget = 1e9; },
    metrics() {
      let sm = slip.max, ss = slip.sum, sn = slip.n; for (const z of zm.bodies) { const s = z.anim.slip; if (!s) continue; sm = Math.max(sm, s.max); ss += s.sum; sn += s.n; }
      return { slipMaxCm: +(sm * 100).toFixed(3), slipMeanCm: +(ss / Math.max(1, sn) * 100).toFixed(4), stances: sn, rootAccelMax: +accMax.toFixed(2), alive: zm.count, bodies: zm.bodies.length, visible: zm.stats.visible,
        cpuMs: +zm.stats.updateMsAvg.toFixed(3), gpuMs: +(gfx.gpuMsAvg || 0).toFixed(2), calls: gfx.stats.calls, tris: gfx.stats.tris, frameMs: ft.length ? +(ft.reduce((a, b) => a + b, 0) / ft.length).toFixed(2) : 0 };
    },
    resetMetrics() { slip.max = 0; slip.sum = 0; slip.n = 0; accMax = 0; for (const z of zm.bodies) z.anim.slip = { max: 0, sum: 0, n: 0, last: 0 }; ft.length = 0; },
    /** draw calls / triangles with and without the zombie system (same view) */
    async zombieCost() { const vis = (v) => { zm.group.visible = v; zm.sig.group.visible = v; }; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      vis(true); await wait(1500); const a = { calls: gfx.stats.calls, tris: gfx.stats.tris, gpuMs: +(gfx.gpuMsAvg || 0).toFixed(2) }; vis(false); await wait(1500); const b = { calls: gfx.stats.calls, tris: gfx.stats.tris, gpuMs: +(gfx.gpuMsAvg || 0).toFixed(2) }; vis(true);
      // exact zombie draws: averaged per animation frame over 1.5 s (main view + sun shadow + spot/point shadows)
      const acc = { total: 0, totalCalls: 0, tris: 0, sunTris: 0, spotTris: 0, maxTotal: 0 }; let fr = 0, run = true; const tk = () => { if (!run) return; const D = zm.stats.draw; for (const k of ['total', 'totalCalls', 'tris', 'sunTris', 'spotTris']) acc[k] += D[k]; acc.maxTotal = Math.max(acc.maxTotal, D.total); fr++; requestAnimationFrame(tk); }; requestAnimationFrame(tk); await wait(1500); run = false;
      const per = {}; for (const k of ['total', 'totalCalls', 'tris', 'sunTris', 'spotTris']) per[k] = Math.round(acc[k] / Math.max(1, fr)); per.maxTotal = acc.maxTotal;
      return { withZ: a, without: b, sceneDeltaCalls: a.calls - b.calls, sceneDeltaTris: a.tris - b.tris, zGpuMs: +(a.gpuMs - b.gpuMs).toFixed(2), zombieDraws: per }; },
    /** triangles per look and LOD for every registered variant (builds them if needed) */
    async triStats() { const f = await import('../game/zombies/factory.js'); const out = {}; for (const [id, def] of REGISTRY.variants) { if (!mapVariants.includes(id)) continue; const a = f.getVariantAssets(def); out[id] = a.geos.map((g) => g.tris.map((t) => Math.round(t))); } return out; },
    /** n zombies (mixed variants + speed classes) on free, walkable nav cells 6-22 m around the target (never inside rock) */
    stress(n = 24, variants = null) { zm.clear(); const vs = variants || mapVariants.length ? (variants || mapVariants) : [vid]; let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < n; i++) { let p = null; for (let k = 0; k < 60 && !p; k++) { const a = rnd() * Math.PI * 2, d = 6 + rnd() * 16; const x = target.pos.x - Math.sin(a) * d, zz = target.pos.z - Math.cos(a) * d; if (!world.isFree(x, zz)) continue; const g = world.groundAt(x, zz, target.pos.y + 1.2); if (!g || Math.abs(g.y - target.pos.y) > 1.2) continue; p = new V3(x, g.y, zz); }
        if (!p) continue; const z = zm.spawn(vs[i % vs.length], p, 0, { speedClass: ['walk', 'run', 'sprint'][i % 3] }); if (z) z.anim.measure = true; } return zm.count; },
    frames: () => ft.length, ft: () => ft.slice(),
    /** window with 5 planks (the game's Barricade class) and a zombie that tears them down and steps through */
    barricadeTest(variant = 'miner_coal') {
      zm.clear(); const wallZ = -2; const mat = std({ color: 0x7a5a3a, roughness: 0.85, key: 'sbPlank' });
      if (!T._bar) { const wm = std({ color: 0x5a524a, roughness: 0.9, key: 'sbWall' }); for (const x of [-2.1, 2.1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 0.3), wm); w.position.set(x, 1.3, wallZ); w.castShadow = w.receiveShadow = true; gfx.scene.add(w); } const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.3), wm); top.position.set(0, 2.3, wallZ); gfx.scene.add(top);
        world.active.B.colliders.addBox({ x: -2.1, y: 1.3, z: wallZ, hx: 1.3, hy: 1.3, hz: 0.15, surface: 'concrete', walk: false }); world.active.B.colliders.addBox({ x: 2.1, y: 1.3, z: wallZ, hx: 1.3, hy: 1.3, hz: 0.15, surface: 'concrete', walk: false }); world.active.B.colliders.build(); }
      if (T._bar) T._bar.reset(); else T._bar = new Barricade(gfx.scene, mat, { pos: [0, 0, wallZ], yaw: Math.PI, boards: 5, width: 1.5, height: 1.9 });
      const b = T._bar; T.moveTarget(0, 4);
      const z = zm.spawn(variant, new V3(0.4, 0, wallZ - 2.8), Math.PI, { kind: 'barricade', spawnDef: { kind: 'barricade', boards: 5, yaw: Math.PI }, barricade: b, speedClass: 'walk' }); if (z) z.anim.measure = true;
      T._barUpd = (dt) => b.update(dt); return !!z;
    },
    /** pier with a ladder rising out of "water": swim → climb → mantle onto the deck */
    ladderTest(variant = 'drowned_docker') {
      zm.clear(); const px = 0, pz = -3, deckY = 2.2;
      if (!T._pier) { const g = new THREE.Group(); const wood = std({ color: 0x5a4a38, roughness: 0.85, key: 'sbPier' }); const deck = new THREE.Mesh(new THREE.BoxGeometry(4, deckY, 3), wood); deck.position.set(px, deckY / 2, pz - 1.5); deck.castShadow = deck.receiveShadow = true; g.add(deck);
        const metal = std({ color: 0x3a3a38, roughness: 0.5, metalness: 1, key: 'sbLadder' }); for (const x of [-0.23, 0.23]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, deckY + 0.9, 8), metal); r.position.set(px + x, (deckY + 0.9) / 2 - 0.3, pz + 0.04); g.add(r); }
        for (let y = 0.0; y <= deckY + 0.01; y += 0.3) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.46, 8), metal); r.rotation.z = Math.PI / 2; r.position.set(px, y, pz + 0.04); g.add(r); }
        const water = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), std({ color: 0x0c2230, roughness: 0.06, metalness: 0, key: 'sbWater' })); water.rotation.x = -Math.PI / 2; water.position.set(px, 0.05, pz + 5); g.add(water);
        gfx.scene.add(g); T._pier = g; world.active.B.colliders.addBox({ x: px, y: deckY / 2, z: pz - 1.5, hx: 2, hy: deckY / 2, hz: 1.5, surface: 'wood', walk: true }); world.active.B.colliders.build(); }
      zm.waterOverride = () => 0.05; T.moveTarget(px, pz - 2.5);
      const def = { kind: 'ladder', pos: [px + 1.5, 0, pz + 6], yaw: 0, path: [[px, -0.9, pz + 0.04], [px, deckY, pz + 0.04]], ladderTop: [px, deckY, pz - 0.7], rung: 0.3 };
      const z = zm.spawn(variant, new V3(px + 1.5, 0, pz + 6), 0, { kind: 'ladder', spawnDef: def, speedClass: 'walk' }); return !!z;
    },
    riseTest(variant = 'miner_lamp') { zm.clear(); T.moveTarget(0, 5); const z = zm.spawn(variant, new V3(0, 0, 0), Math.PI, { kind: 'rise', speedClass: 'walk' }); return !!z; },
    variants: () => [...REGISTRY.variants.keys()], mapIds: () => (REGISTRY.maps.get(mapId) || []).slice(),
    /** anthropometric table of a variant's LOD0 body vs a 1.75 m adult male (see src/game/zombies/anthro.js) */
    async anthro(id = 'debug_body', look = 0) { const m = await import('../game/zombies/anthro.js'); return m.measureVariant(id, look); },
  };
  const tick = (dt) => {
    t += dt;
    if (target.moving) { const m = target.moving; m.a += dt * m.sp / m.r; T.moveTarget(m.c.x + Math.cos(m.a) * m.r, m.c.z + Math.sin(m.a) * m.r); }
    if (T._barUpd) T._barUpd(dt);
    zm.update(dt, t, aiOff ? null : { pos: target.pos, eyeH: target.eyeH });
    for (const z of zm.alive) { const a = Math.hypot(z.anim.acc.x, z.anim.acc.z); if (a > accMax && z.anim.tAlive > 0.5) accMax = a; }
    // camera modes
    const z0 = zm.bodies[camMode?.k ?? 0];
    if (camMode && z0) { const p = z0.pose.rootPos; if (camMode.kind === 'follow') { gfx.camera.position.set(p.x + camMode.ox, camMode.oy + p.y, p.z + camMode.oz); gfx.camera.lookAt(p.x, camMode.ly + p.y, p.z); }
      else if (camMode.kind === 'bone') { const bp = z0.pose.P[BI[camMode.bone]]; const c = camMode.bone === 'head' ? z0.pose.pointOn(BI.head, 0, 1.64, -0.02, new V3()) : bp; const yaw = (camMode.yawDeg * Math.PI / 180) + z0.anim.yaw; gfx.camera.position.set(c.x - Math.sin(yaw) * camMode.dist, c.y + camMode.dy, c.z - Math.cos(yaw) * camMode.dist); gfx.camera.lookAt(c.x, c.y, c.z); }
      else { const yaw = (camMode.yawDeg * Math.PI / 180) + (camMode.rel ? z0.anim.yaw : 0); gfx.camera.position.set(p.x - Math.sin(yaw) * camMode.dist, p.y + camMode.y, p.z - Math.cos(yaw) * camMode.dist); gfx.camera.lookAt(p.x, p.y + camMode.ly, p.z); } }
    world.update(dt, t, gfx.camera.position); fx.update(dt, t, gfx.camera.position);
    gfx.shadowCenter.copy(z0 ? z0.pose.rootPos : gfx.camera.position);
  };
  if (!player._free) player.update(0.001);
  const loop = () => { const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; ft.push(dt * 1000); if (ft.length > 600) ft.shift(); if (!frozen) tick(dt); gfx.render(dt, t); input.endFrame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  // initial content from the query
  const n0 = +(P.get('n') || 1); if (n0 > 0) T.spawn(vid, n0, { dist: +(P.get('dist') || 5) });
  T.cam(target.pos.x + 2.5, target.pos.y + 1.6, target.pos.z + 3.5, target.pos.x, target.pos.y + 1.0, target.pos.z - 3, 55);
  await new Promise((r) => setTimeout(r, 500)); window.__ready = true;
}
