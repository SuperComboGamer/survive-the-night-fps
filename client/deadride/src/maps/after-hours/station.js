// AFTER HOURS — station platform base shared by the four lands (deck, understructure, beam pylons, stairs, rails). Each land adds its own canopy.
import { stationFrame, pipe } from './common.js';

export const DECK = { X0: 1.42, X1: 5.92, L: 30.4 };

/**
 * T = { deck, col, stair, rail, edge, warn } materials. Platform: 4.5 m wide deck beside the train (x_s 1.42..5.92), 30.4 m long, deck top = platform level (5.4 m).
 * Two staircases (0.18 m rise, 0.28 m run) leave the deck ends and descend along +/- z_s; invisible non-shootable wall colliders keep players off the stair sides.
 */
export function buildStationBase(ctx, k, T) {
  const { B } = ctx, S = stationFrame(k), yw = S.yaw, { X0, X1, L } = DECK, XC = (X0 + X1) / 2, LV = S.pos[1];
  B.box({ p: S.P(XC, -0.55, 0), s: [X1 - X0, 0.55, L], yaw: yw, mat: T.deck, col: 'concrete', bevel: 0.03 });
  B.box({ p: S.P(X0 + 0.16, 0, 0), s: [0.32, 0.02, L], yaw: yw, mat: T.edge, bevel: 0.004, cast: false });                       // yellow safety strip at the platform edge
  for (let z = -L / 2 + 0.6; z < L / 2 - 0.3; z += 0.6) B.box({ p: S.P(X0 + 0.55, 0, z), s: [0.5, 0.012, 0.44], yaw: yw, mat: T.warn, bevel: 0.003, cast: false });   // tactile blister pavers
  for (const z of [-13.5, -6.5, 0, 6.5, 13.5]) B.box({ p: S.G(X1 - 0.5, 0, z), s: [0.7, LV - 1.1, 0.7], yaw: yw, mat: T.col, col: 'concrete', bevel: 0.04 });   // under-deck columns
  for (const z of [-13.5, -6.5, 0, 6.5, 13.5]) B.box({ p: S.P(XC, -1.1, z), s: [X1 - X0 + 0.2, 0.55, 0.5], yaw: yw, mat: T.col, bevel: 0.03 });                    // cross girders
  // wide pylons carrying the beam through the station (beam bottom = 3.75)
  for (const z of [-12, 0, 12]) { B.box({ p: S.G(0, 0, z), s: [1.0, 3.4, 1.4], yaw: yw, mat: T.col, col: 'concrete', bevel: 0.06 }); B.box({ p: S.G(0, 3.4, z), s: [1.7, 0.42, 1.9], yaw: yw, mat: T.col, bevel: 0.05 }); }
  const wall = (x, y, z, hx, hy, hz) => { const p = S.G(x, y, z); B.colliders.addBox({ x: p[0], y, z: p[2], hx, hy, hz, yaw: yw, surface: 'metal', walk: false, shootable: false }); };
  wall(X1 + 0.05, LV + 1.0, 0, 0.06, 1.0, L / 2);                                                                                    // deck outer edge
  const n = 30, run = 0.28, rise = 0.18, sw = 3.2;
  for (const sgn of [-1, 1]) {
    const zTop = sgn * (L / 2), zBot = sgn * (L / 2 + n * run), d = S.dir(0, -sgn), yawS = Math.atan2(-d[1], d[0]);
    B.stairs({ p: S.G(XC, 0, zBot), n, rise, run, w: sw, yaw: yawS, mat: T.stair, col: 'concrete' });
    for (const sx of [-1, 1]) {
      const xr = XC + sx * (sw / 2 - 0.06);
      pipe(B, S.P(xr, 0.98, zTop), S.G(xr, 0.98, zBot), 0.024, T.rail, { seg: 6 });
      for (let i = 0; i <= 10; i++) { const f = i / 10, q = S.G(xr, 0, zBot + (zTop - zBot) * f); B.cyl({ p: [q[0], LV * f, q[2]], r: 0.016, h: 0.98, seg: 5, mat: T.rail, cast: false }); }
      wall(xr + sx * 0.1, LV * 0.5 + 1.4, (zTop + zBot) / 2, 0.05, LV * 0.5 + 1.4, Math.abs(zTop - zBot) / 2);
    }
  }
  return S;
}
