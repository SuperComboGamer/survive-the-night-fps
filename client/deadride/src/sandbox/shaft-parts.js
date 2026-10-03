// Shaft Nine parts lab: ?sandbox=shaft-parts — every hand-built part (src/maps/shaft-nine/parts.js) on a gravel floor under warm lamps, for macro shots (30-50 cm) and gameplay-distance shots.
// window.__t.cam(x,y,z, lx,ly,lz, fov) frames a view; __t.items lists {name, x, z} of the part groups.
import * as THREE from 'three';
import { Synth } from '../core/synth.js';
import { compileAtmo } from '../core/gfx.js';
import { Builder } from '../core/build.js';
import { std } from '../core/mats.js';
import { makeRng } from '../core/util.js';
import { custom, TIMBER, COAL, CINDER } from '../maps/shaft-nine/glsl.js';
import { Parts, timberSet, lagging, railLine, oreCart, iBeam, angle, channel, gusset, rivets, wireRope, corrugated, brickWall, drum, crate, lampCage, coil, hewn, T } from '../maps/shaft-nine/parts.js';
import * as PX from '../maps/shaft-nine/parts2.js';

export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer); await synth.warm(true); const sc = gfx.scene; const group = new THREE.Group(); sc.add(group); const B = new Builder({ synth, group, seed: 5 }); const R = makeRng(11);
  const atmo = compileAtmo({ fog: { color: 0x0a0806, density: 0.006 }, sky: null, sun: { dir: [0.3, 0.7, 0.4], color: 0xffffff, intensity: 0, shadow: false }, env: { intensity: 0.25 }, exposure: 1, bloom: 0.2, vignette: 0.25, grain: 0.02, autoExposure: { key: 0.12, min: 1.0, max: 2.4 }, grade: { sat: 1.0, contrast: 1.12, lift: [0, 0.004, 0.012], gain: [1, 1, 1], tint: [1, 1, 1] } });
  atmo.envTex = gfx.makeEnv({ sky: { zenith: 0x304050, horizon: 0x404858, stars: 0, disc: 0, cloud: 0 }, fog: { color: 0x404858 } }); gfx.setAtmo(atmo);
  const M = {
    post: B.m('post', custom(TIMBER, [0.35, 0.35, 0.25, 0.35, 0, 0.9, 1], { colors: [0x24201b, 0x4f4436], size: 512, tile: 1.6, bump: 12, rough: [0.72, 0.97], layers: { grime: 0.35 } }), { breakup: 0.4, wet: true }),
    board: B.m('board', custom(TIMBER, [0.55, 0.5, 0.2, 0.4, 0, 0.7, 4], { colors: [0x2a251f, 0x5a4e3f], size: 512, tile: 1.2, bump: 10, rough: [0.75, 0.98], layers: { grime: 0.4, dust: 0.1 } }), { breakup: 0.4, wet: true }),
    sleeper: B.m('sleeper', custom(TIMBER, [0.3, 0.6, 0.2, 0.2, 0, 1.0, 1], { colors: [0x1c1815, 0x3a3128], size: 512, tile: 1.0, bump: 12, rough: [0.8, 0.98], layers: { grime: 0.5 } }), { breakup: 0.4, wet: true }),
    iron: B.m('iron', { pattern: 'plates', size: 512, tile: 1, colors: [0x3a3936, 0x2a2927, 0x100f0e], rustColor: 0x4e2812, params: { cols: 1, rows: 1, seam: 0.0, rivets: 0, brushed: 0.5 }, bump: 2, metal: 1, rough: [0.4, 0.8], layers: { rust: 0.25, grime: 0.6, scratch: 0.5, edge: 0.4 } }, { breakup: 0.4, wet: true }),
    rail: B.m('rail', { pattern: 'plates', size: 256, tile: 1, colors: [0x4a3a30, 0x372a22, 0x120e0b], rustColor: 0x5a2c14, params: { cols: 1, rows: 1, seam: 0.0, rivets: 0, brushed: 0.9 }, bump: 1, metal: 1, rough: [0.35, 0.7], layers: { rust: 0.35, grime: 0.5, streak: 0.3 } }, { breakup: 0.4, wet: true }),
    tub: B.m('tub', { pattern: 'plates', size: 512, tile: 1, colors: [0x4a4038, 0x372e28, 0x17110e], rustColor: 0x4e2812, params: { cols: 2, rows: 1, seam: 0.012, rivets: 0, brushed: 0.3 }, bump: 2, metal: 1, rough: [0.45, 0.85], layers: { rust: 0.3, grime: 0.6, streak: 0.5, edge: 0.4 } }, { breakup: 0.4, wet: true }),
    ballast: B.m('ballast', custom(CINDER, [70, 0, 0, 0.2, 0], { colors: [0x24211e, 0x37332e, 0x161412, 0x655e53], size: 512, tile: 1.5, bump: 14, rough: [0.85, 1] }), { breakup: 0.4, wet: true }),
    coal: B.m('coal', custom(COAL, [7, 0.7, 0.4], { colors: [0x1a1a1c, 0x2a2a2e, 0x3a3b44, 0x9a9cb0], size: 512, tile: 1, bump: 28, rough: [0.2, 0.6] }), { triplanar: 1, breakup: 0.4, wet: true }),
    brick: B.m('brickFace', { pattern: 'noise', size: 512, tile: 0.8, colors: [0x7a4030, 0x5c2e22, 0x8c5a45, 0x45241c], params: { scale: 14, contrast: 2, fine: 60, speckle: 0.08, pores: 0.4, panels: 0, panelWidth: 0 }, bump: 5, rough: [0.8, 0.98], layers: { grime: 0.5, streak: 0.4 } }, { breakup: 0.4, wet: true }),
    concrete: B.m('concrete', { pattern: 'noise', size: 512, tile: 3, colors: [0x66655f, 0x53524d, 0x2c2b28, 0x85837a], params: { scale: 5, contrast: 3, fine: 96, speckle: 0.04, pores: 0.6, panels: 3, panelWidth: 0.003 }, bump: 3, rough: [0.8, 0.98], layers: { grime: 0.6, cracks: 0.5, streak: 0.5 } }, { breakup: 0.4, wet: true }),
    corr: B.m('corr', { pattern: 'noise', size: 512, tile: 2, colors: [0x5a5f5a, 0x444a48, 0x2a2e2c, 0x7a7f78], rustColor: 0x4a2814, params: { scale: 6, contrast: 2, fine: 90, speckle: 0.05, pores: 0.4, panels: 0, panelWidth: 0 }, bump: 3, metal: 1, rough: [0.45, 0.8], layers: { rust: 0.3, streak: 0.7, grime: 0.5 } }, { breakup: 0.4, wet: true }),
    dark: B.m('dark', std({ color: 0x0a0a0a, roughness: 0.7 })), glass: B.m('glass', std({ color: 0x1a1006, emissive: 0xffa850, emissiveIntensity: 3, roughness: 0.2 })),
  }; M.rim = M.tub; M.wheel = M.iron; M.ore = M.coal;
  const floor = B.m('floor', custom(CINDER, [30, 0.5, 0.06, 0.5, 0.6], { colors: [0x131210, 0x211f1c, 0x0a0908, 0x3a352d], size: 1024, tile: 3, bump: 14, rough: [0.7, 1] }), { breakup: 0.4 });
  B.plane({ p: [26, 0, 0], s: [90, 40], mat: floor, cast: false });
  const Pt = new Parts(B, R); const items = []; const put = (name, x, z) => { items.push({ name, x, z }); return [x, 0, z]; };
  // 0 timber set + lagging + track + cart (tunnel section)
  { const p = put('tunnel', 0, 0); for (const z of [-2.4, 0, 2.4]) timberSet(Pt, M, { p: [p[0], 0, z], yaw: 0, w: 2.9, h: 2.6, seed: z * 3 + 5, brace: z === 0 }); lagging(Pt, M, { p: [p[0], 0, -1.2], yaw: 0, len: 2.4, w: 2.9, h: 2.6, seed: 2 }); lagging(Pt, M, { p: [p[0], 0, 1.2], yaw: 0, len: 2.4, w: 2.9, h: 2.6, seed: 3 }); railLine(Pt, M, [0.5, 0, -6], [0.5, 0, 8], {}); oreCart(Pt, M, { p: [0.5, 0, 1.5], yaw: PI2(), load: 'coal', seed: 1 }); }
  // 1 steel joint: I-beam legs, angle X-bracing, channel ring, gusset + rivets
  { const p = put('steel', 10, 0); const L0 = [p[0] - 1.2, 0, 0], L1 = [p[0] + 1.2, 0, 0]; iBeam(Pt, M.iron, L0, [L0[0] + 0.1, 3.2, 0], 0.32, 0.16, 0.022, 0.013); iBeam(Pt, M.iron, L1, [L1[0] - 0.1, 3.2, 0], 0.32, 0.16, 0.022, 0.013); channel(Pt, M.iron, [p[0] - 1.1, 1.6, 0], [p[0] + 1.1, 1.6, 0], 0.2, 0.075, 0.009); angle(Pt, M.iron, [p[0] - 1.1, 0.2, 0.1], [p[0] + 1.0, 1.55, 0.1], 0.1, 0.01); angle(Pt, M.iron, [p[0] + 1.1, 0.2, 0.1], [p[0] - 1.0, 1.55, 0.1], 0.1, 0.01); gusset(Pt, M.iron, M.iron, [p[0] - 1.1, 1.6, 0.1], [1, 0, 0], [0, 1, 0], 0.5); gusset(Pt, M.iron, M.iron, [p[0] + 1.1, 1.6, 0.1], [-1, 0, 0], [0, 1, 0], 0.5); wireRope(Pt, M.iron, [[p[0], 0.3, 1.2], [p[0], 0.3, 3.5], [p[0] + 1.5, 0.4, 5]], 0.016, 0.11); }
  // 2 corrugated wall + roof lap
  { const p = put('corr', 20, 0); corrugated(Pt, M.corr, M.iron, { a: [p[0] - 2, 0, 0], dir: [1, 0, 0], up: [0, 1, 0], w: 4, h: 2.4 }); }
  // 3 brick wall with window + door holes
  { const p = put('brick', 30, 0); brickWall(Pt, M.brick, { p: [p[0], 0, 0], yaw: 0, w: 4.4, h: 3.2, holes: [{ x0: -0.6, x1: 0.6, y0: 0, y1: 2.2 }, { x0: 1.2, x1: 2.0, y0: 1.0, y1: 2.4 }], face: 1, t: 0.3 }); Pt.B.box({ p: [p[0], 0, -0.16], s: [4.4, 3.3, 0.3], mat: M.concrete, cast: false }); }
  // 4 drums / crates / lamp / coil
  { const p = put('props', 40, 0); drum(Pt, M.tub, M.dark, [p[0], 0, 0], { yaw: 0.3 }); drum(Pt, M.tub, M.dark, [p[0] + 0.7, 0, 0.1], { yaw: 1.3, dent: 0.014 }); drum(Pt, M.iron, M.dark, [p[0] + 0.3, 0, 0.75], { tilt: 1.45, yaw: 0.6 }); crate(Pt, M.board, M.iron, [p[0] - 1.2, 0, 0], [0.7, 0.45, 0.5], 0.3); crate(Pt, M.board, M.iron, [p[0] - 1.2, 0.45, 0], [0.5, 0.35, 0.4], 0.9); lampCage(Pt, M.iron, M.glass, [p[0] + 1.6, 1.4, 0]); coil(Pt, M.dark, [p[0] + 1.6, 0, 0.9], 0.28, 0.022, 4, 0); }
  // 5 rocks, hex columns, grating and the rest of the library (parts2)
  { const p = put('rocks', 50, 0); PX.lab && PX.lab(Pt, M, p, R); }
  Pt.flush(); console.log('[parts lab] triangles', Pt.tris); B.finish();
  for (const [x, y, z, c, I] of [[0, 3.5, -1, 0xffa860, 80], [0, 3.5, 3, 0xffa860, 80], [10, 4.5, 3, 0xffc890, 120], [20, 3.4, 3, 0xffb070, 100], [30, 3.6, 3, 0xffb878, 120], [40, 3, 3, 0xffb070, 90], [50, 3.6, 3, 0xffb070, 120]]) gfx.addLight({ pos: new THREE.Vector3(x, y, z), color: c, intensity: I, distance: 14, decay: 2, kind: 'point' });
  gfx.vmEnabled = false; gfx.camera.fov = 55; gfx.camera.updateProjectionMatrix();
  let t = 0, last = performance.now();
  window.__t = { gfx, B, items, M, cam(x, y, z, lx = 0, ly = 0, lz = 0, fov = 55) { gfx.camera.position.set(x, y, z); gfx.camera.lookAt(lx, ly, lz); gfx.setFov(fov); gfx.shadowCenter.copy(gfx.camera.position); gfx.resetTAA?.(); } };
  window.__t.cam(0, 1.7, 5, 0, 1.2, 0);
  const loop = () => { const n = performance.now(); const dt = Math.min(0.05, (n - last) / 1000); last = n; t += dt; gfx.shadowCenter.copy(gfx.camera.position); gfx.render(dt, t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop); await new Promise((r) => setTimeout(r, 700)); window.__ready = true;
}
function PI2() { return Math.PI / 2; }
