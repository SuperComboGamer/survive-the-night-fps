// Supply drop crate (with detachable parachute) and thrown / spat projectile models.
import * as THREE from 'three';
import { PROJ } from '../../../shared/defs.js';
import { MeshBuilder, partsToGroup, makeRng } from '../materials.js';

const PI = Math.PI;
let crateParts = null, chuteParts = null;
const projCache = new Map();

/** Military airdrop crate ~1.2 m, origin at ground centre. userData.parachute = canopy + lines group (hide after landing). */
export function createSupplyCrate() {
  if (!crateParts) {
    const b = new MeshBuilder(501, { ao: true, aoHeight: 0.6 });
    const S = 1.16, H = 0.96, base = 0.14;
    // pallet skid
    for (const x of [-0.45, 0, 0.45]) b.box('wood', 0.12, base, 1.2, { grain: true, p: [x, base / 2, 0], c: [0.7, 0.64, 0.56] });
    for (const z of [-0.52, 0, 0.52]) b.box('wood', 1.22, 0.03, 0.14, { grain: true, p: [0, base + 0.015, z], c: [0.78, 0.72, 0.62] });
    // plywood box painted olive
    const y0 = base + 0.03;
    b.box('olive', S, H, S, { p: [0, y0 + H / 2, 0] });
    // corner battens / steel edge protectors
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) b.box('steel', 0.07, H + 0.02, 0.07, { p: [sx * (S / 2 - 0.02), y0 + H / 2, sz * (S / 2 - 0.02)] });
    for (const y of [y0 + 0.03, y0 + H - 0.03])
      for (const s of [-1, 1]) {
        b.box('olive', S + 0.04, 0.06, 0.05, { p: [0, y, s * (S / 2 + 0.005)] });
        b.box('olive', 0.05, 0.06, S + 0.04, { p: [s * (S / 2 + 0.005), y, 0] });
      }
    // cargo straps (webbing) over the top and down the sides, with buckles
    const strap = [0.32, 0.34, 0.26];
    for (const off of [-0.28, 0.28]) {
      b.box('cloth', 0.07, 0.012, S + 0.05, { p: [off, y0 + H + 0.006, 0], c: strap });
      b.box('cloth', 0.07, 0.012, S + 0.05, { p: [0, y0 + H + 0.012, off], r: [0, PI / 2, 0], c: strap });
      for (const s of [-1, 1]) {
        b.box('cloth', 0.07, H + 0.02, 0.012, { p: [off, y0 + H / 2, s * (S / 2 + 0.03)], c: strap });
        b.box('cloth', 0.012, H + 0.02, 0.07, { p: [s * (S / 2 + 0.03), y0 + H / 2, off], c: strap });
        b.box('steel', 0.1, 0.06, 0.02, { p: [off, y0 + H * 0.55, s * (S / 2 + 0.04)] });
      }
    }
    // stencils on two sides + lid, and a lifting ring
    for (const [p, r] of [[[0, y0 + H * 0.55, -(S / 2 + 0.036)], [0, PI, 0]], [[S / 2 + 0.036, y0 + H * 0.55, 0], [0, PI / 2, 0]], [[-(S / 2 + 0.036), y0 + H * 0.55, 0], [0, -PI / 2, 0]]])
      b.plane('stencil', 0.5, 0.25, { atlas: 'supply', p, r, order: 'YXZ' });
    b.plane('stencil', 0.36, 0.18, { atlas: 'army', p: [0, y0 + H + 0.02, 0], r: [-PI / 2, 0, PI] });
    b.torus('steel', 0.06, 0.012, 4, 10, PI * 2, { p: [0, y0 + H + 0.03, 0], r: [PI / 2, 0, 0] });
    crateParts = b.build();

    // parachute: canopy dome + suspension lines converging on the crate top
    const c = new MeshBuilder(502, { ao: false });
    const top = y0 + H + 0.03;
    const R = 3.1, cy = 6.4;
    const dome = new THREE.SphereGeometry(R, 16, 5, 0, PI * 2, 0, 1.05);
    dome.scale(1, 0.62, 1);
    // flutter the skirt a little
    const pos = dome.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < R * 0.62 * 0.6) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        pos.setY(i, y + Math.sin(a * 8) * 0.12);
      }
    }
    dome.computeVertexNormals();
    c.add('parachute', dome, { raw: true, p: [0, cy - R * 0.62 * Math.cos(1.05), 0] });
    const rimY = cy - R * 0.62 * Math.cos(1.05) + R * 0.62 * Math.cos(1.05);
    const nLines = 12;
    for (let k = 0; k < nLines; k++) {
      const a = (k / nLines) * PI * 2;
      const rx = Math.cos(a) * R * Math.sin(1.05), rz = Math.sin(a) * R * Math.sin(1.05);
      c.cylBetween('rope', [rx, rimY, rz], [0, top + 1.2, 0], 0.008, 0.008, 3, { open: true });
    }
    for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) c.cylBetween('cloth', [0, top + 1.2, 0], [x, top, z], 0.015, 0.015, 3, { open: true, c: [0.3, 0.32, 0.25] });
    chuteParts = c.build();
  }
  const g = partsToGroup(crateParts, 'supply_crate');
  const chute = partsToGroup(chuteParts, 'parachute');
  g.add(chute);
  g.userData.parachute = chute;
  return g;
}

/**
 * An RPG grenade (PG-7 style, 0.9 m) along +Y, nose up, centred on the origin: fuze, ogive and an 85 mm olive bulb, the
 * motor tube, a thin tail boom and four fins at the tail, folded flat along the boom or (in flight) sprung out.
 * Shared by the projectile and the ammo pickup.
 */
export function rpgGrenade(b, finsOut = false) {
  b.lathe('olive', [[0, 0.118], [0.0195, 0.118], [0.024, 0.124], [0.0405, 0.168], [0.0425, 0.18], [0.0425, 0.245], [0.0412, 0.258], [0.035, 0.3], [0.025, 0.35], [0.0135, 0.402], [0.0095, 0.412], [0, 0.412]], 14);
  b.cyl('dark', 0.0429, 0.0429, 0.012, 14, { p: [0, 0.205, 0], open: true }); // painted band
  b.lathe('steel', [[0, 0.41], [0.0082, 0.41], [0.0082, 0.436], [0.0062, 0.444], [0, 0.45]], 8);
  b.cyl('metal', 0.0195, 0.0195, 0.32, 10, { p: [0, -0.04, 0] });
  b.cyl('metal', 0.0212, 0.0212, 0.014, 10, { p: [0, -0.195, 0] }); // joint with the tail
  b.cyl('metal', 0.011, 0.011, 0.24, 8, { p: [0, -0.32, 0] });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * PI * 2 + PI / 4;
    if (finsOut) b.box('steel', 0.04, 0.09, 0.002, { p: [Math.cos(a) * 0.031, -0.39, Math.sin(a) * 0.031], r: [0, -a, 0] });
    else b.box('steel', 0.003, 0.1, 0.014, { p: [Math.cos(a) * 0.0125, -0.385, Math.sin(a) * 0.0125], r: [0, -a, 0] });
  }
  b.cyl('dark', 0.0105, 0.009, 0.012, 8, { p: [0, -0.444, 0] }); // nozzle
}

/** Projectile model centred on its origin. PROJ.ROPE is drawn by the game (returns an empty Object3D). */
export function createProjectile(projType) {
  let parts = projCache.get(projType);
  if (!parts) {
    const b = new MeshBuilder(600 + projType, { ao: false });
    const r = makeRng(projType * 17 + 3);
    switch (projType) {
      case PROJ.ACID: {
        const g = new THREE.IcosahedronGeometry(0.16, 1);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const k = 1 + Math.sin(pos.getX(i) * 31 + pos.getY(i) * 17) * 0.12;
          pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.9, pos.getZ(i) * k * 1.25);
        }
        g.computeVertexNormals();
        b.add('acid', g, { raw: true });
        b.sphere('acid_glow', 0.26, 8, 6, { raw: true, s: [1, 0.9, 1.3] });
        for (let k = 0; k < 3; k++) b.sphere('acid', 0.04, 5, 3, { raw: true, p: [(r() - 0.5) * 0.2, (r() - 0.5) * 0.15, 0.2 + k * 0.08] });
        break;
      }
      case PROJ.MOLOTOV: {
        b.lathe('bottle', [[0.0, -0.12], [0.04, -0.12], [0.04, 0.04], [0.016, 0.09], [0.013, 0.13], [0.0, 0.13]], 10);
        b.cyl('cloth', 0.016, 0.02, 0.08, 6, { p: [0, 0.14, 0], c: [0.7, 0.62, 0.48] });
        b.plane('cloth', 0.06, 0.1, { p: [0.02, 0.19, 0], r: [0, 0, -0.5], c: [0.55, 0.45, 0.35] });
        b.torus('rope', 0.017, 0.004, 3, 6, PI * 2, { p: [0, 0.115, 0], r: [PI / 2, 0, 0] });
        break;
      }
      case PROJ.PIPEBOMB: {
        b.cyl('steel', 0.028, 0.028, 0.2, 10, {});
        for (const y of [-0.105, 0.105]) b.cyl('rust', 0.034, 0.034, 0.03, 6, { p: [0, y, 0] });
        b.cyl('chrome', 0.0295, 0.0295, 0.05, 10, { p: [0, 0.02, 0], open: true });
        b.tube('dark', [[0, 0.12, 0], [0.01, 0.15, 0.01], [0.03, 0.17, 0.0]], 0.003, 5, 3);
        b.sphere('flare', 0.008, 4, 3, { raw: true, p: [0.03, 0.172, 0] });
        break;
      }
      case PROJ.ROCK: {
        b.rock('rock', 0.4, { detail: 1, seed: 91, scale: [1.05, 0.9, 1], flatBottom: false });
        break;
      }
      case PROJ.FLARE: {
        b.cyl('paint', 0.018, 0.018, 0.22, 8, { r: [PI / 2, 0, 0], c: [0.7, 0.1, 0.06] });
        b.cyl('steel', 0.019, 0.019, 0.03, 8, { p: [0, 0, 0.11], r: [PI / 2, 0, 0] });
        b.cyl('flare', 0.014, 0.018, 0.03, 8, { raw: true, p: [0, 0, -0.125], r: [PI / 2, 0, 0] });
        break;
      }
      case PROJ.ROCKET: {
        // nose along +Z (the game points +Z down the velocity), fins sprung out, the motor burning at the -Z end
        b.group({ r: [PI / 2, 0, 0] }, () => {
          rpgGrenade(b, true);
          b.cyl('flare', 0.009, 0.014, 0.022, 8, { raw: true, p: [0, -0.458, 0] });
          b.sphere('flare', 0.012, 6, 4, { raw: true, p: [0, -0.47, 0] });
        });
        break;
      }
      default:
        break;
    }
    parts = b.build();
    projCache.set(projType, parts);
  }
  const g = partsToGroup(parts, `proj_${projType}`);
  g.userData.projType = projType;
  if (projType === PROJ.MOLOTOV) {
    const f = new THREE.Object3D();
    f.name = 'flame';
    f.position.set(0.03, 0.22, 0);
    g.add(f);
    g.userData.flame = f;
  }
  return g;
}
