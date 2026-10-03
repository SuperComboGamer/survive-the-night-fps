// After Hours look-dev viewer: ?sandbox=park&map=after-hours&stop=0[&only=1][&route=1][&veh=1][&from=0&to=1&auto=1]
// only=1 builds just that stop (fast); route=1/veh=1 add the route scenery / monorail (veh needs the full map to map stations to stops).
// window.__t: cam(x,y,z,yaw,pitch,fov), free(x,y,z,lx,ly,lz,fov), dock(i), inside(), ride(i,j), outside(pos), plus world/player/gfx/fx/veh.
import * as THREE from 'three';
import { Synth } from '../core/synth.js';
import { FX } from '../core/fx.js';
import { World } from '../core/world.js';
import { Player } from '../core/player.js';
import { input } from '../core/input.js';
import { loadMap } from '../maps/index.js';
import { PARK } from '../maps/after-hours/park.js';

export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer); const fx = new FX(gfx); const world = new World(gfx, synth, fx);
  input.init(gfx.canvas);
  let map = await loadMap(P.get('map') || 'after-hours'); const idx = +(P.get('stop') || 0); const only = P.get('only') === '1';
  if (only) map = { ...map, stops: [map.stops[idx]], buildRoute: P.get('route') === '1' ? map.buildRoute : null, buildVehicle: P.get('veh') === '1' ? map.buildVehicle : null };
  if (P.get('prof')) await installProf(world, map);   // ?prof=1: per-section build timings (window.__prof)
  const t0 = performance.now(); await world.loadMap(map, (p, m) => console.log(`load ${(p * 100) | 0}% ${m}`)); window.__mapMs = performance.now() - t0; console.log('map built in', window.__mapMs.toFixed(0), 'ms');
  world.setActive(only ? 0 : Math.min(idx, world.stops.length - 1)); const veh = world.vehicle;
  const st = world.active; const player = new Player(gfx, world, input); gfx.vmEnabled = false;
  player.teleport([st.origin.x + st.playerStart.pos[0], st.origin.y + st.playerStart.pos[1], st.origin.z + st.playerStart.pos[2]], st.playerStart.yaw);
  let t = 0, last = performance.now(), frames = 0, k = 0; const ft = [];
  if (veh) veh.onEvent = (e, d) => { if (P.get('ev')) console.log('vehicle event', e, JSON.stringify(d && d.pos ? { ...d, pos: undefined } : d || {})); };
  const T = window.__t = {
    gfx, world, player, fx, synth, input, veh, k: 0, log: [],
    cam(x, y, z, yaw, pitch, fov) { player.frozen = true; player._free = false; player.platform && player.setPlatform(null); player.pos.set(x, y - 1.7, z); player.yaw = yaw; player.pitch = pitch; if (fov) gfx.setFov(fov); player.update(0.001); },
    free(x, y, z, lx, ly, lz, fov) { player.frozen = true; player._free = true; gfx.camera.position.set(x, y, z); gfx.camera.lookAt(lx, ly, lz); if (fov) gfx.setFov(fov); },
    /** LOCAL-coordinate camera helpers (relative to the active stop's origin) */
    lcam(x, y, z, yaw, pitch, fov) { const o = world.active.origin; T.cam(o.x + x, o.y + y, o.z + z, yaw, pitch, fov); },
    lfree(x, y, z, lx, ly, lz, fov) { const o = world.active.origin; T.free(o.x + x, o.y + y, o.z + z, o.x + lx, o.y + ly, o.z + lz, fov); },
    async dock(i) { world.setActive(i); veh.snapDocked(world.stops[i]); },
    inside(dz = 0, x = 0) { player.frozen = false; player._free = false; const v = veh; const local = new THREE.Vector3(x, v.floorY, dz); v.frame.updateWorldMatrix(true, false); v.localToWorld(local, player.pos); player.yaw = 0; player.setPlatform(v); },
    outside(pos) { player.setPlatform(null); if (pos) player.teleport(pos); },
    async ride(i, j) { T.riding = true; const hooks = { progress: (kk) => { T.k = kk; world.setTransit(i, j, kk); } }; await veh.ride(world.stops[i], world.stops[j], hooks); world.setActive(j); T.riding = false; console.log('ride complete'); },
    async arrive(i) { world.setActive(i); await veh.arrive(world.stops[i]); console.log('arrived'); },
    async depart(i) { await veh.depart(world.stops[i]); console.log('departed'); },
    /** draw-call anatomy of the current view: main-pass visible meshes (frustum test) grouped by kind, plus sun-shadow casters; prints a table */
    drawStats(top = 14, showProgs = false) {
      const cam = gfx.camera; cam.updateMatrixWorld(); const fr = new THREE.Frustum(); fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const sh = gfx.sun.shadow.camera; sh.updateMatrixWorld(); const fs = new THREE.Frustum(); fs.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(sh.projectionMatrix, sh.matrixWorldInverse));
      const main = new Map(), shad = new Map(); let nm = 0, ns = 0, tm = 0, ts = 0; const bs = new THREE.Sphere(); const progs = new Set(), progInfo = new Map();
      const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      gfx.scene.traverse((o) => {
        if (!(o.isMesh || o.isLine || o.isPoints) || !visible(o)) return; const g = o.geometry; if (!g) return;
        if (!g.boundingSphere) g.computeBoundingSphere(); bs.copy(g.boundingSphere).applyMatrix4(o.matrixWorld); const inst = o.isInstancedMesh ? o.count : 1; const idx = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
        const tris = (o.isInstancedMesh ? o.count : 1) * idx / 3 * (g.instanceCount ? g.instanceCount : 1); const kind = (o.isInstancedMesh ? 'inst' : o.isSkinnedMesh ? 'skin' : g.isInstancedBufferGeometry ? 'ibg' : o.userData.shadowProxy ? 'proxy' : o.isMesh ? 'mesh' : o.isLine ? 'line' : 'points');
        const mat = Array.isArray(o.material) ? o.material[0] : o.material; const mn = (mat && (mat.name || mat.type)) || '?'; const key = kind + ' ' + (o.userData.shadowProxy ? 'shadowProxy' : mn);
        const hitMain = (o.frustumCulled === false || fr.intersectsSphere(bs)) && !o.userData.shadowProxy && (o.layers.mask & cam.layers.mask || o.layers.test(cam.layers)); if (hitMain) { const e = main.get(key) || { n: 0, tris: 0 }; e.n++; e.tris += tris; main.set(key, e); nm++; tm += tris; const pp = gfx.renderer.properties.get(mat); if (pp && pp.currentProgram) { progs.add(pp.currentProgram.id); let pi = progInfo.get(pp.currentProgram.id); if (!pi) progInfo.set(pp.currentProgram.id, pi = { n: 0, mats: new Set(), key: String(pp.currentProgram.cacheKey || '').slice(0, 90) }); pi.n++; pi.mats.add(mn); const po = mat.userData.patchOpts || {}; pi.d = `${o.isInstancedMesh ? 'INST ' : ''}${mat.map ? 'map ' : ''}${mat.emissiveMap ? 'emis ' : ''}${mat.alphaTest ? 'aTest ' : ''}${mat.transparent ? 'transp ' : ''}${mat.side === 2 ? 'dbl ' : ''}${o.geometry.attributes.aVis ? 'aVis ' : ''}${po.frag ? 'frag:' + String(po.frag).slice(0, 34).replace(/\s+/g, ' ') + ' ' : ''}${po.wet ? 'wet ' : ''}${po.breakup ? 'brk' + po.breakup + ' ' : ''}${po.wind ? 'wind ' : ''}${po.key ? 'key:' + po.key + ' ' : ''}`; } }
        const casts = (o.castShadow && !o.userData.shadowProxy) || (o.userData.shadowProxy); if (casts && (o.frustumCulled === false || fs.intersectsSphere(bs))) { const e = shad.get(key) || { n: 0, tris: 0 }; e.n++; e.tris += tris; shad.set(key, e); ns++; ts += tris; }
      });
      const fmt = (m) => [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, top).map(([k, v]) => `${String(v.n).padStart(4)} ${String(Math.round(v.tris / 1000)).padStart(5)}k  ${k}`).join('\n');
      return `MAIN pass: ${nm} draws ~${Math.round(tm / 1000)}k tris, ${progs.size} distinct programs\n${fmt(main)}\nSUN shadow pass: ${ns} draws ~${Math.round(ts / 1000)}k tris\n${fmt(shad)}\nrenderer calls ${gfx.stats.calls} tris ${gfx.stats.tris}` + (showProgs ? '\nPROGRAMS (draws, materials, key):\n' + [...progInfo.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, v]) => `${String(v.n).padStart(4)}  #${id}  ${[...v.mats].slice(0, 4).join(',')}  | ${v.d}`).join('\n') : '');
    },
    frames: () => frames, ft: () => ft.slice(),
    /** snapshot of interesting numbers */
    info() { const r = gfx.renderer.info; return { calls: gfx.stats.calls, tris: gfx.stats.tris, gpu: +gfx.gpuMsAvg.toFixed(2), tex: gfx.stats.tex, geoms: gfx.stats.geoms, progs: gfx.stats.progs, lights: gfx.pool.points.filter((l) => l.intensity > 0).length }; },
  };
  if (P.get('dock') !== null && veh) { const i = +P.get('dock'); world.setActive(i); veh.snapDocked(world.stops[i]); if (P.get('inside')) T.inside(); }
  const loop = () => {
    const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; frames++; ft.push(dt * 1000); if (ft.length > 900) ft.shift();
    if (!player._free) player.update(dt);
    world.update(dt, t, gfx.camera.position); if (!veh) PARK.tick(dt, t); fx.update(dt, t, gfx.camera.position);
    gfx.shadowCenter.copy(gfx.camera.position); gfx.render(dt, t); input.endFrame(); requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  if (P.get('auto')) T.ride(+(P.get('from') || 0), +(P.get('to') || 1));
  await new Promise((r) => setTimeout(r, 500)); window.__ready = true;
}

/** ?prof=1 — wraps the expensive build stages with performance.now timers and dumps a table into console + window.__prof. */
async function installProf(world, map) {
  const rec = window.__prof = { stops: [], calls: {}, log: [] };
  const acc = (k, ms) => { const c = rec.calls[k] || (rec.calls[k] = { n: 0, ms: 0 }); c.n++; c.ms += ms; };
  const wrap = (obj, name, key = name) => { const f = obj[name]; obj[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); if (r && typeof r.then === 'function') return r.then((v) => { acc(key, performance.now() - t); return v; }); acc(key, performance.now() - t); return r; }; };
  const S = await import('../core/synth.js'); { const f = S.Synth.prototype.make; S.Synth.prototype.make = function (def) { const t = performance.now(); const r = f.call(this, def); const ms = performance.now() - t; acc('synth.make', ms); if (ms > 15) rec.log.push(`make ${def.pattern || 'CUSTOM'} ${def.size || 512}px ${ms.toFixed(0)} ms ${def.glsl ? '[glsl]' : ''}`); return r; }; } wrap(S.Synth.prototype, 'warm', 'synth.warm'); wrap(S.Synth.prototype, '_prog', 'synth._prog');
  const Bm = await import('../core/build.js'); { const f = Bm.Builder.prototype.finish; Bm.Builder.prototype.finish = function () { const t = performance.now(); const r = f.apply(this, arguments); const ms = performance.now() - t; acc('Builder.finish', ms); rec.log.push(`finish ${this.group && this.group.name || '?'} ${ms.toFixed(0)} ms`); return r; }; } for (const k of ['box', 'cyl', 'sphere', 'lathe', 'extrude', 'tube', 'cable', 'plane', 'stairs', 'rock', 'prism', 'addRaw', 'instance']) if (Bm.Builder.prototype[k]) wrap(Bm.Builder.prototype, k, 'B.' + k);
  const C = await import('../maps/after-hours/common.js'); void C;
  wrap(world.gfx, 'makeEnv', 'gfx.makeEnv'); { const f = Object.getPrototypeOf(world)._buildStop; Object.getPrototypeOf(world)._buildStop = async function (def, i) { const t = performance.now(); const r = await f.call(this, def, i); rec.log.push(`_buildStop ${def.id} total ${(performance.now() - t).toFixed(0)} ms`); acc('world._buildStop', performance.now() - t); return r; }; } wrap(Object.getPrototypeOf(world), '_buildRest', 'world._buildRest');
  map.stops.forEach((st, i) => { const f = st.build; st.build = async function (ctx) { const t = performance.now(); const r = await f.call(this, ctx); rec.stops.push({ id: st.id, buildMs: +(performance.now() - t).toFixed(0) }); return r; }; });
  if (map.buildRoute) { const f = map.buildRoute; map.buildRoute = async (ctx) => { const t = performance.now(); const r = await f(ctx); rec.stops.push({ id: 'route', buildMs: +(performance.now() - t).toFixed(0) }); return r; }; }
  if (map.buildVehicle) { const f = map.buildVehicle; map.buildVehicle = async (ctx) => { const t = performance.now(); const r = await f(ctx); rec.stops.push({ id: 'vehicle', buildMs: +(performance.now() - t).toFixed(0) }); return r; }; }
  window.__profDump = () => { const rows = Object.entries(rec.calls).map(([k, v]) => `${k.padEnd(20)} n=${String(v.n).padStart(6)} ${v.ms.toFixed(0).padStart(7)} ms`).sort(); return rec.stops.map((s) => `${s.id.padEnd(10)} build ${s.buildMs} ms`).concat(rows, ['-- slow synth.make calls'], rec.log).join('\n'); };
}
