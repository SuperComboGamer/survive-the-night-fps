// TEMPORARY stop stub used while stops are under development (?lf=N builds only stop N fully; the others use this)
import { STOPS } from './layout.js';
import { ATMO, ENV } from './atmos.js';
import { getSea } from './shared.js';
export function stubStop(ctx, i, def) {
  const { B, world } = ctx; const st = STOPS[i]; const sea = getSea(); sea.attach(world.root);
  const conc = B.m('stubConc', { pattern: 'noise', size: 512, tile: 3, colors: [0x6c6a64, 0x585650, 0x2f2d2a, 0x8a877e], params: { scale: 5, contrast: 3, fine: 96, speckle: 0.04, pores: 0.6 }, bump: 3, rough: [0.5, 0.9], layers: { grime: 0.6, wet: 0.5 } }, { wet: true });
  const a0 = st.toLocal(0, 4.8 + 20), horiz = Math.abs(st.f[0]) > 0.5; const len = 140, dep = 40;
  B.box({ p: [a0[0], st.quayY - 4, a0[1]], s: horiz ? [len, 4, dep] : [dep, 4, len], mat: conc, col: 'concrete' });
  const ps = st.toLocal(0, 4.8 + 6);
  return { atmo: ATMO[i], envPatches: ENV[i], playerStart: { pos: [ps[0], st.quayY, ps[1]], yaw: Math.atan2(-st.out[0], -st.out[1]) + Math.PI }, station: { pos: st.stationLocal, yaw: st.yaw },
    groundY: -3, waterY: 0, navBounds: [-60, -60, 60, 60], nav: false, spawns: [], buys: { walls: [], perks: [], box: null }, zombieVariants: ['drowned'], ambient: null, landmark: { pos: [0, 10, 0], name: def.name }, update(dt, t) { sea.tick(t, ctx.gfx.camera.position, ctx.gfx); } };
}

/** dev flag: ?lf=N builds only stop N fully (others use the stub) to speed up iteration */
export const skipStop = (i) => { try { const v = new URLSearchParams(location.search).get('lf'); return v !== null && +v !== i; } catch (e) { return false; } };
