// Texture gallery: every synth pattern on a 1 m tile, lit by a low raking light so relief is visible.
import * as THREE from 'three';
import { Synth } from '../core/synth.js';
import { PATTERNS } from '../core/synthGLSL.js';
import { compileAtmo } from '../core/gfx.js';

export async function run(gfx, P) {
  const synth = new Synth(gfx.renderer);
  const sc = gfx.scene;
  const atmo = compileAtmo({ fog: { color: 0x202830, density: 0.004 }, sky: { zenith: 0x203040, horizon: 0x506070, stars: 0, disc: 0 }, sun: { dir: [0.5, 0.55, 0.65], color: 0xfff0e0, intensity: 3.2, shadow: false }, env: { intensity: 0.6 }, exposure: 1, bloom: 0.1, vignette: 0.15, grain: 0.0 });
  atmo.envTex = gfx.makeEnv({ sky: { zenith: 0x304050, horizon: 0x708090, stars: 0, disc: 0, cloud: 0 }, fog: { color: 0x708090 } });
  gfx.setAtmo(atmo);
  const names = Object.keys(PATTERNS).filter((n) => n !== 'custom');
  const defs = {
    noise: { colors: [0x8a8880, 0x6c6a64, 0x4a4844, 0xaaa89e], params: { scale: 4, contrast: 3, fine: 64, speckle: 0.05, pores: 0.5, panels: 2, panelWidth: 0.004 }, bump: 2, rough: [0.7, 0.95], layers: { grime: 0.5, cracks: 0.3 } },
    planks: { colors: [0x9a7b52, 0x5d4126, 0x1c140c], params: { rows: 8, gap: 0.004, grain: 6, knots: 0.35, cols: 2, weather: 0.6, nails: 1 }, bump: 4, tile: 1, rough: [0.6, 0.9], layers: { grime: 0.3 } },
    bricks: { colors: [0x8e4a34, 0x6a3324, 0x9c968a], params: { rows: 12, cols: 6, mortar: 0.012, variation: 0.6, chips: 0.6, moss: 0.2, soot: 0.3 }, bump: 6, rough: [0.75, 0.95] },
    stone: { colors: [0x8a8a86, 0x6a6864, 0x2a2826, 0x9a968a], params: { scale: 5, gap: 0.05, round: 0.3, variation: 0.5, strata: 0.3, lichen: 0.4 }, bump: 10, rough: [0.7, 0.95] },
    tiles: { colors: [0xd8d4c8, 0xa0a8a8, 0x5a5850], params: { n: 6, grout: 0.008, checker: 1, bevel: 0.006, wear: 0.4, gloss: 0.7, crackle: 0.3 }, bump: 1.5, rough: [0.2, 0.6] },
    plates: { colors: [0x6a7078, 0x585e66, 0x2a2c2e], params: { cols: 3, rows: 3, seam: 0.008, rivets: 8, brushed: 0.5, panelVar: 0.5, bolts: 0 }, bump: 3, metal: 1, rough: [0.3, 0.6], layers: { rust: 0.35, scratch: 0.5, edge: 0.3 } },
    corrugated: { colors: [0x7a8288, 0x5a6268], params: { ribs: 10, depth: 1, vertical: 1, paint: 0, dents: 0.5 }, bump: 14, metal: 1, rough: [0.35, 0.65], layers: { rust: 0.45, streak: 0.6 } },
    diamond: { colors: [0x8a8e92, 0x70767a], params: { n: 10, height: 1, wear: 0.5 }, bump: 3, metal: 1, rough: [0.35, 0.6], layers: { scratch: 0.6 } },
    rock: { colors: [0x2c2b2a, 0x4a4844, 0x6a655c, 0x807a70], params: { scale: 5, strata: 8, cracks: 0.8, roughness: 0.8, tone: 0.5, moisture: 0.4 }, bump: 40, rough: [0.6, 0.95], layers: { moss: 0.2 } },
    snow: { colors: [0xe6ecf4, 0xf6f9ff, 0xc4d4e8], params: { scale: 4, ripples: 0.8, sparkle: 1, direction: 0, crust: 0.6 }, bump: 25, rough: [0.45, 0.75] },
    ice: { colors: [0xb8d8ea, 0xdcf0fa, 0xffffff], params: { scale: 4, cracks: 0.8, bubbles: 0.5, depth: 0.5 }, bump: 4, rough: [0.05, 0.3] },
    gravel: { colors: [0x6a655c, 0x8a8478, 0x4a463f, 0x9a8f78], params: { scale: 16, variation: 0.8, sand: 0.4 }, bump: 30, rough: [0.7, 0.95] },
    dirt: { colors: [0x4a3a2a, 0x6a5238, 0x2a2016, 0x8a7a66], params: { scale: 4, pebbles: 0.3, cracks: 0.4, grass: 0 }, bump: 20, rough: [0.85, 1] },
    weave: { colors: [0x5a6a4a, 0x4a5a3a], params: { threads: 96, twill: 1, variation: 0.6, fuzz: 0.5, ripstop: 0.5 }, bump: 0.6, rough: [0.85, 1] },
    quilt: { colors: [0xc03030, 0x601010], params: { rows: 6, cols: 4, puff: 0.9, stitch: 1, threads: 128 }, bump: 8, rough: [0.5, 0.8] },
    leather: { colors: [0x5a3a22, 0x3a2414, 0x8a6a4a], params: { scale: 64, creases: 0.6, wear: 0.4 }, bump: 1.2, rough: [0.35, 0.6] },
    rubber: { colors: [0x181818, 0x282828], params: { scale: 12, tread: 1 }, bump: 3, rough: [0.8, 0.95] },
    carpet: { colors: [0x6a1a1a, 0x4a1010, 0xc0a060], params: { scale: 8, pattern: 1 }, bump: 1.5, rough: [1, 1] },
    terrazzo: { colors: [0xc8c2b4, 0x7a6a5a, 0xd8d0c0, 0x3a3a3c], params: { scale: 6, chips: 0.7, chipSize: 0.3 }, bump: 0.6, rough: [0.15, 0.4] },
    lava: { colors: [0x1a1512, 0x2c241f, 0xff5a10, 0xffc040], params: { scale: 4, crackWidth: 0.07, glow: 3, crust: 0.5 }, bump: 60, rough: [0.7, 0.95] },
    hex: { colors: [0x2a3040, 0x3a4256, 0x101418, 0x40e0ff], params: { n: 6, border: 0.06, glow: 1.5, bevel: 0.05 }, bump: 3, metal: 0.8, rough: [0.25, 0.5] },
    hazard: { colors: [0xe0b020, 0x181818, 0x403830], params: { n: 8, angle: 0, wear: 0.6 }, bump: 1, rough: [0.5, 0.85], layers: { scratch: 0.4 } },
    asphalt: { colors: [0x2a2a2c, 0x3a3a3e, 0xe0c020, 0x6a6a70], params: { scale: 6, aggregate: 0.6, cracks: 0.5, lines: 1 }, bump: 6, rough: [0.7, 0.95] },
    crystal: { colors: [0x2a1a5a, 0x5a3aa0, 0xd0a0ff, 0x9060ff], params: { scale: 4, facets: 0.8, veins: 0.7, glow: 2 }, bump: 8, rough: [0.1, 0.5] },
    wood: { colors: [0x8a6a44, 0x4a3018], params: { scale: 16, rings: 8, knots: 0.5, weather: 0.4, vertical: 1 }, bump: 3, rough: [0.6, 0.9] },
    scales: { colors: [0x4a5a68, 0x3a4652], params: { rows: 10, cols: 8, round: 0.5, variation: 0.6 }, bump: 8, rough: [0.6, 0.9] },
    bark: { colors: [0x3a2a1e, 0x5a4a3a, 0x201810], params: { scale: 6, depth: 1, moss: 0.4 }, bump: 25, rough: [0.85, 1] },
  };
  const cols = 7, rows = Math.ceil(names.length / cols);
  const tw = performance.now(); await synth.warm(true); console.log('warm(compile) ms', (performance.now() - tw).toFixed(0));
  const t0 = performance.now();
  names.forEach((n, i) => {
    const d = { pattern: n, size: 512, tile: 1, ...(defs[n] || {}) };
    const m = synth.material(d);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.position.set((i % cols) * 1.08 - (cols - 1) * 0.54, -Math.floor(i / cols) * 1.08 + (rows - 1) * 0.54, 0);
    sc.add(mesh);
  });
  console.log('baked', names.length, 'materials (js time) in', (performance.now() - t0).toFixed(0), 'ms');
  { const g = gfx.renderer.getContext(); const t1 = performance.now(); g.finish(); console.log('gpu finish wait ms', (performance.now() - t1).toFixed(0)); }
  gfx.camera.position.set(0, 0, 4.9); gfx.camera.lookAt(0, 0, 0); gfx.vmEnabled = false; gfx.camera.fov = 56; gfx.camera.updateProjectionMatrix();
  gfx.shadowCenter.set(0, 0, 0);
  let t = 0, last = performance.now();
  const loop = () => { const n = performance.now(); const dt = (n - last) / 1000; last = n; t += dt; gfx.render(dt, t); window.__frames = (window.__frames || 0) + 1; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await new Promise((r) => setTimeout(r, 400));
  window.__ready = true;
}
