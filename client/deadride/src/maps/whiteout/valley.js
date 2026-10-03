// Mid-distance valley life for the ride: lit hamlets on the flanks, a lamp-lit valley road, a floodlit second lift line, the glow of a far town. All of it is a
// handful of merged dark boxes + additive far-light sprites (one draw), placed 60-330 m off the ropes so the cabin passes them with strong parallax.
import * as THREE from 'three';
import { std } from '../../core/mats.js';
import { makeRng, smoothstep } from '../../core/util.js';
import { LAND, sampleS, ROPE_GAP } from './line.js';

const L = LAND;
export function buildValley(B, far, line, minX, maxX, minZ, maxZ) {
  const rng = makeRng(4242); const wall = B.m('rHouse', std({ color: 0x1b1a20, roughness: 0.92 })), roof = B.m('rHouseRoof', std({ color: 0xa9b6cc, roughness: 0.85 })), post = B.m('rPost', std({ color: 0x24262b, roughness: 0.7, metalness: 0.4 }));
  const spots = []; const okSpot = (x, z, need) => { if (x < minX + 40 || x > maxX - 40 || z < minZ + 40 || z > maxZ - 40) return false; if (L.insideStopRect(x, z)) return false; const y = L.H(x, z); if (L.slopeDeg(x, z, 6) > need) return false; return y > -60 && y < 215; };
  const warm = [0xffb060, 0xffa848, 0xffc880, 0xff9c40, 0xffd6a0];
  let houses = 0, lights = 0, roadLamps = 0;
  const hamlet = (cx, cz, n, ang) => {                                                    // a loose double row of chalets with lit windows + a street lamp per few houses
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < n; i++) {
      const u = (i - n / 2) * 11 + (rng() - 0.5) * 3, v = (i % 2 ? 1 : -1) * (8 + rng() * 4); const x = cx + u * ca - v * sa, z = cz + u * sa + v * ca; if (!okSpot(x, z, 30)) continue; const y = L.H(x, z);
      const w = 6 + rng() * 3, d = 5 + rng() * 2, h = 4 + rng() * 2.5; const yaw = ang + (rng() - 0.5) * 0.3;
      B.box({ p: [x, y - 0.4, z], s: [w, h + 0.4, d], yaw, mat: wall, bevel: 0.05, cast: false, col: false }); B.prism({ p: [x, y + h, z], s: [w + 1.2, 2.2 + rng(), d + 1.2], yaw, mat: roof, cast: false }); houses++;
      const nw = 1 + ((rng() * 3) | 0); for (let k = 0; k < nw; k++) { const wx = x + (Math.cos(yaw) * (k - (nw - 1) / 2) * 2.0), wz = z - (Math.sin(yaw) * (k - (nw - 1) / 2) * 2.0); const c = warm[(rng() * warm.length) | 0]; far.add([wx, y + h * (0.35 + 0.35 * rng()), wz], c, 2.0 + rng() * 1.4, 1.7 + rng() * 0.9, rng() < 0.15 ? 2 + rng() * 3 : 0); lights++; }
    }
  };
  // hamlets: 3 per leg, alternating sides, 70-230 m off the rope and well below it
  for (const P of line.paths) {
    const leg = L.LEGS[P.leg]; const dx = leg.dir[0], dz = leg.dir[1], lx = dz, lz = -dx;
    for (let k = 0; k < 9; k++) {
      const fs = 0.08 + k * 0.1 + (rng() - 0.5) * 0.04; const s = P.gateOutS + (P.gateInS - P.gateOutS) * fs; const T = sampleS(P, s);
      for (let tries = 0; tries < 24; tries++) {
        const side = (k + P.leg + tries) % 2 ? 1 : -1, off = 45 + rng() * 230; const x = T.x + (side > 0 ? lx * (ROPE_GAP + off) : -lx * off), z = T.z + (side > 0 ? lz * (ROPE_GAP + off) : -lz * off);
        if (!okSpot(x, z, 27) || L.H(x, z) > T.y - 10) continue; hamlet(x, z, 4 + ((rng() * 5) | 0), Math.atan2(dz, dx) + (rng() - 0.5) * 0.7); break;
      }
    }
  }
  // a valley road of street lamps threading between the hamlets on the valley floor (low, warm, evenly spaced): strong parallax against the moving cabin
  for (const P of line.paths) {
    const leg = L.LEGS[P.leg]; const dx = leg.dir[0], dz = leg.dir[1], lx = dz, lz = -dx; const side = P.leg % 2 ? 1 : -1, off = 95 + P.leg * 25;
    for (let s = P.gateOutS + 30; s < P.gateInS - 20; s += 9) { const T = sampleS(P, s + Math.sin(s * 0.05) * 6); const o = off + Math.sin(s * 0.03) * 22; const x = T.x + (side > 0 ? lx * (ROPE_GAP + o) : -lx * o), z = T.z + (side > 0 ? lz * (ROPE_GAP + o) : -lz * o);
      if (!okSpot(x, z, 34) || L.H(x, z) > T.y - 8) continue; const y = L.H(x, z); B.cyl({ p: [x, y, z], r: 0.07, h: 6, seg: 5, mat: post, cast: false, col: false }); far.add([x, y + 6.1, z], 0xffd08a, 1.5, 1.35, 0); roadLamps++; }
  }
  // a floodlit chairlift on the far flank of leg 0/1: towers with a lamp each + moving chair lights (they creep along)
  const tw = []; for (const [x0, z0, x1, z1] of [[120, 150, 240, 250], [330, 20, 400, -120]]) { for (let i = 0; i <= 6; i++) { const x = x0 + (x1 - x0) * i / 6, z = z0 + (z1 - z0) * i / 6; if (!okSpot(x, z, 30)) continue; const y = L.H(x, z); B.cyl({ p: [x, y, z], r: 0.16, h: 9, seg: 6, mat: post, cast: false, col: false }); far.add([x, y + 9.2, z], 0xdff0ff, 1.7, 1.5, 0); tw.push([x, y + 9, z]); } }
  return { houses, lights, roadLamps, lifts: tw.length };
}
