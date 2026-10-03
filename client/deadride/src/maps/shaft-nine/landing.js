// Landing (outer) shaft gates for a stop: a portal frame, fixed side panels, and two sliding mesh leaves that the cage elevator
// opens/closes in sync with its own scissor gate. Static parts go through the stop's Builder; the leaves are separate meshes in a group.
import * as THREE from 'three';
import { Builder } from '../../core/build.js';
import { std } from '../../core/mats.js';
import { OPEN, SHAFT, PI } from './kit.js';

/**
 * opts: {frame: material, steel: material, mesh: material, plate: material, signalOn/off colours, style:'steel'|'timber'}
 * Returns {group, setOpen(k), open (0..1), colliders}. Everything is stop-local; the gate plane is z = OPEN.z + 0.25 (in front of the lining).
 */
export function buildLanding(ctx, B, mats, opts = {}) {
  const { frame, steel, mesh, plate } = mats; const zg = SHAFT.hz + 0.3 + 0.12; const w = OPEN.hw, h = OPEN.h; const fh = h + 0.3;
  const timber = opts.style === 'timber';
  // portal: jambs, lintel, threshold plate (bridges the 0.35 m gap between landing and cage floor)
  for (const s of [-1, 1]) B.box({ p: [s * (w + 0.11), 0, zg - 0.05], s: [0.24, fh, 0.3], mat: frame, bevel: 0.02, col: 'concrete', walk: false });
  B.box({ p: [0, fh - 0.02, zg - 0.05], s: [2 * w + 0.6, 0.3, 0.34], mat: frame, bevel: 0.02, col: false });
  B.box({ p: [0, 0, 1.48], s: [2 * w, 0.03, 0.6], mat: plate, bevel: 0.006, col: 'metal', cast: false });                        // threshold plate: floor level -> cage floor
  // fixed mesh panels beside the leaves (in the plane behind the leaves)
  for (const s of [-1, 1]) { B.box({ p: [s * (w + 0.9), 0.0, zg - 0.05], s: [1.5, fh, 0.03], mat: mesh, bevel: 0, col: false, cast: false }); B.box({ p: [s * (w + 0.9), 0, zg - 0.05], s: [1.56, 0.06, 0.06], mat: steel, bevel: 0.006, cast: false }); B.box({ p: [s * (w + 0.9), fh - 0.05, zg - 0.05], s: [1.56, 0.06, 0.06], mat: steel, bevel: 0.006, cast: false }); B.box({ p: [s * (w + 1.65), 0, zg - 0.05], s: [0.08, fh, 0.08], mat: steel, bevel: 0.01, cast: false }); }
  // top track for the leaves
  B.box({ p: [0, fh + 0.2, zg + 0.1], s: [2 * (w + 1.7), 0.1, 0.08], mat: steel, bevel: 0.01, cast: false }); B.box({ p: [0, 0, zg + 0.12], s: [2 * (w + 1.7), 0.02, 0.05], mat: steel, bevel: 0.004, cast: false });
  // signal lamps above the gate: red = closed / cage away, green = cage docked and open
  const red = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a10, emissiveIntensity: 8 }), green = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x30ff60, emissiveIntensity: 0.0 });
  const lampR = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), red), lampG = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), green); lampR.position.set(-0.22, fh + 0.42, zg + 0.1); lampG.position.set(0.22, fh + 0.42, zg + 0.1); B.group.add(lampR, lampG);
  B.box({ p: [0, fh + 0.31, zg + 0.08], s: [0.7, 0.2, 0.1], mat: steel, bevel: 0.02, cast: false });
  // leaves
  const leaves = []; const cols = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(0, 0, zg + 0.1); B.group.add(g); const LB = new Builder({ synth: ctx.synth, group: g, seed: 5 });
    const lw = w - 0.02; const cx = s * lw / 2; const T = 0.05;
    LB.box({ p: [cx, 0.06, 0], s: [lw, h - 0.06, 0.02], mat: mesh, bevel: 0, cast: false });
    LB.box({ p: [cx, 0.02, 0], s: [lw, 0.09, 0.06], mat: steel, bevel: 0.006 }); LB.box({ p: [cx, h - 0.04, 0], s: [lw, 0.09, 0.06], mat: steel, bevel: 0.006 }); LB.box({ p: [cx, h * 0.5, 0], s: [lw, 0.06, 0.06], mat: steel, bevel: 0.006 });
    LB.box({ p: [cx - lw / 2 + 0.03, 0.02, 0], s: [0.07, h, 0.07], mat: steel, bevel: 0.006 }); LB.box({ p: [cx + lw / 2 - 0.03, 0.02, 0], s: [0.07, h, 0.07], mat: steel, bevel: 0.006 });
    LB.beam([cx - lw / 2 + 0.05, 0.1, 0.01], [cx + lw / 2 - 0.05, h - 0.1, 0.01], 0.04, 0.04, { mat: steel });
    LB.box({ p: [cx - s * (lw / 2 - 0.02), 1.0, 0.05], s: [0.05, 0.2, 0.05], mat: steel, bevel: 0.006 });                               // handle
    LB.finish(); leaves.push({ g, s });
    // closed-state collider (blocks player + zombies while the cage is away)
    cols.push(B.colliders.addBox({ x: s * lw / 2, y: h / 2, z: zg + 0.1, hx: lw / 2, hy: h / 2, hz: 0.05, surface: 'metal', walk: false, solid: true }));
  }
  const L = { group: null, open: 0, colliders: cols, lampR, lampG, leaves };
  L.setOpen = (k) => {
    L.open = k; const dx = k * (w + 0.05); for (const l of leaves) l.g.position.x = l.s * dx;
    for (const c of cols) c.solid = k < 0.6;
    red.emissiveIntensity = 8 * (1 - Math.min(1, k * 3)); green.emissiveIntensity = 7 * Math.min(1, Math.max(0, k * 3 - 0.2));
  };
  L.setOpen(0);
  return L;
}
