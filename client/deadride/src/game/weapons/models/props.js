// Held props: combat knife (7" clip-point, leather-washer grip), M67-style frag grenade (spoon, pin, pull ring), 12-gauge shell.
// Generic clips used on every gun: melee (left-hand underhand knife thrust) and grenade (pin pull + overhand throw).
import { roundPoly, bezPts } from '../geo.js';
import { makeClip } from '../anim.js';

export const knife = {
  id: 'knife',
  build(K) {
    const R = K.root, BL = 'knifeBlade', ED = 'steelBright', HW = 'leatherWasher', ST = 'blued', BK = 'blackMatte';
    // blade: clip point, flat grind (satin edge band), black-coated body with a fuller
    const spine = [[0.006, 0.0086], [-0.100, 0.0088]], clip = bezPts([-0.100, 0.0088], [-0.130, 0.0086], [-0.160, 0.0062], [-0.1765, 0.0012], 8), belly = bezPts([-0.1765, 0.0012], [-0.160, -0.0085], [-0.138, -0.0138], [-0.108, -0.0142], 8);
    const full = [...spine, ...clip.slice(1), ...belly.slice(1), [-0.010, -0.0142], [-0.004, -0.0122], [0.006, -0.0122]];
    R.ext(ED, full, -0.0008, 0.0008, { b: 0.0003 });
    const body = [...spine, ...bezPts([-0.100, 0.0088], [-0.128, 0.0084], [-0.152, 0.0056], [-0.166, 0.0012], 8).slice(1), ...bezPts([-0.166, 0.0012], [-0.152, -0.0042], [-0.134, -0.0086], [-0.108, -0.0092], 6).slice(1), [-0.010, -0.0092], [-0.004, -0.0112], [0.006, -0.0112]];
    R.ext(BL, body, -0.0027, 0.0027, { b: 0.0009 });
    for (const sx of [-1, 1]) R.box(BK, [sx * 0.0027, 0.0030, -0.058], [0.0006, 0.0034, 0.086], { b: 0.0003, wear: 0 }); // fuller shadow line
    // guard, spacers, washers, pommel
    R.box(ST, [0, -0.0015, 0.0090], [0.0105, 0.0380, 0.0060], { b: 0.0015 });
    R.lathe(BK, [0, 0, 0], [[0, 0.0120], [0.0138, 0.0120], [0.0138, 0.0142], [0, 0.0142]], { axis: 'z', seg: 20, scale: [0.78, 1, 1] });
    const prof = [[0, 0.0142]]; for (let i = 0; i < 17; i++) { const z = 0.0142 + i * 0.0063, m = 1 + 0.07 * Math.sin((i + 0.5) / 17 * Math.PI); prof.push([0.0128 * m, z + 0.0004], [0.0141 * m, z + 0.0022], [0.0141 * m, z + 0.0041], [0.0128 * m, z + 0.0059]); } prof.push([0, 0.0142 + 17 * 0.0063]);
    R.lathe(HW, [0, 0, 0], prof, { axis: 'z', seg: 22, scale: [0.8, 1, 1], sharp: 70 });
    R.lathe(ST, [0, 0, 0], [[0, 0.1213], [0.0140, 0.1213], [0.0146, 0.1250], [0.0128, 0.1340], [0.0070, 0.1385], [0, 0.1390]], { axis: 'z', seg: 22, scale: [0.82, 1, 1] });
    // grip frame: hand +X = blade direction (knife -Z), hand +Z = knife +Y
    K.socketBasis('grip', 'root', [0, 0.0, 0.068], [0, 0, -1], [-1, 0, 0], [0, 1, 0]);
    return { length: 0.139 + 0.1765 };
  },
  handling: { hold: { p: [0, -0.016, 0.006], r: [0, 0, 0] } },
};

export const grenade = {
  id: 'grenade',
  build(K) {
    const R = K.root, OD = 'odPaint', SP = 'parkerized', ST = 'steelBright';
    const spoon = K.part('spoon', { pivot: [0, 0.050, 0.004] }), pin = K.part('pin', { pivot: [0.012, 0.041, 0.010] });
    R.sphere(OD, [0, 0, 0], 0.0318, { seg: 28 });
    R.lathe(OD, [0, 0, 0], [[0.0100, 0.0262], [0.0108, 0.0290], [0.0098, 0.0300], [0.0098, 0.0420], [0.0090, 0.0470], [0.0060, 0.0505], [0, 0.0512]], { axis: 'y', seg: 20 });
    R.lathe(SP, [0, 0, 0], [[0.0112, 0.0288], [0.0114, 0.0300], [0.0114, 0.0318], [0.0105, 0.0322]], { axis: 'y', seg: 20 }); // fuze collar
    // spoon: strip following the body from the fuze top down the +Z flank
    const P = [[0, 0.0515, 0.0010], [0, 0.0510, 0.0080], [0, 0.0470, 0.0145], [0, 0.0400, 0.0205], [0, 0.0310, 0.0262], [0, 0.0190, 0.0320], [0, 0.0060, 0.0342], [0, -0.0060, 0.0338]];
    spoon.loft(SP, P.map((c, i) => ({ c, a: 0.0062 - i * 0.0002, b: 0.0007, n: 6, up: [0, c[1] - 0.0, c[2]].map((v, j) => (j === 0 ? 0 : v)) })), { K: 16 });
    // pin through the fuze + pull ring
    pin.cyl(ST, [0.0005, 0.041, 0.010], 0.0011, 0.030, { axis: 'x', seg: 10, b: 0.0003 });
    pin.torus(ST, [0.0265, 0.041, 0.010], 0.0115, 0.0012, { r: [0, 0, 0], seg: 8, tube: 26 });
    // right-hand grip: fuze toward the thumb web, spoon against the palm
    K.socketBasis('grip', 'root', [0, 0.004, 0.036], [0, -1, 0], [0, 0, 1], [-1, 0, 0]);
    return { length: 0.08 };
  },
  handling: { hold: { p: [0, 0, 0], r: [0, 0, 0] }, frames: { pin: { part: 'pin', p: [0.058, 0.041, 0.030], fd: [-0.9, -0.1, -0.3], pn: [0, -0.2, -1] } } },
};

export const pinRing = {
  id: 'pinRing',
  build(K) { const R = K.root; R.torus('steelBright', [0, 0, 0], 0.0115, 0.0012, { seg: 8, tube: 26 }); R.cyl('steelBright', [-0.026, 0, 0], 0.0011, 0.030, { axis: 'x', seg: 10 }); K.socket('grip', 'root', [0.03, 0.02, 0.05]); return {}; },
  handling: { hold: { p: [0, 0, 0], r: [0, 0, 0] } },
};

export const shell = {
  id: 'shell',
  build(K) {
    const R = K.root, L = 0.064; // unfired 2 3/4" shell (crimped), axis Z, crimp forward (-Z)
    R.lathe('shellHull', [0, 0, 0], [[0, -L / 2 + 0.0012], [0.006, -L / 2], [0.0094, -L / 2 + 0.0008], [0.01035, -L / 2 + 0.0035], [0.01035, L / 2 - 0.013], [0.0101, L / 2 - 0.0122], [0, L / 2 - 0.0122]], { axis: 'z', seg: 20 });
    R.lathe('brassPolished', [0, 0, 0], [[0.0101, L / 2 - 0.0126], [0.0106, L / 2 - 0.0122], [0.0106, L / 2 - 0.0019], [0.0112, L / 2 - 0.0016], [0.0112, L / 2], [0, L / 2]], { axis: 'z', seg: 20 });
    K.socket('grip', 'root', [0, 0.02, 0.035]);
    return { length: L };
  },
  handling: { hold: { p: [0, 0, 0], r: [0, 0, 0] } },
};

// ------------------------------------------------------------------ generic clips (camera-space hand keys: c = palm centre, fd = finger dir, pn = palm normal)
export const GENERIC_DEFS = {
  melee: {
    dur: 0.58, events: [[0.19, 'melee']],
    tracks: {
      gun: [[0, [0, 0, 0, 0, 0, 0]], [0.09, [0.035, -0.07, 0.05, -20, 8, -24], 'out'], [0.40, [0.035, -0.07, 0.05, -20, 8, -24]], [0.58, [0, 0, 0, 0, 0, 0], 'io']],
      holdL: [[0, ''], [0.06, 'knife'], [0.5, '']],
      L: [[0, { f: 'rest' }],
        [0.08, { c: [-0.14, -0.21, -0.27], fd: [1, 0.25, 0.1], pn: [0.1, 1, 0.1], pose: 'knife' }, 'out'],
        [0.19, { c: [-0.03, -0.105, -0.50], fd: [1, 0.12, -0.25], pn: [0, 1, 0.12], pose: 'knife' }, 'out3'],
        [0.30, { c: [-0.045, -0.12, -0.47], fd: [1, 0.15, -0.2], pn: [0, 1, 0.1], pose: 'knife' }],
        [0.46, { c: [-0.15, -0.25, -0.26], fd: [1, 0.25, 0.1], pn: [0.1, 1, 0.1], pose: 'knife' }, 'io'],
        [0.58, { f: 'rest' }, 'io']],
    },
  },
  grenade: {
    dur: 1.2, events: [[0.34, 'pin'], [0.6, 'throw']],
    tracks: {
      holdR: [[0, ''], [0.14, 'grenade'], [0.6, '']], holdL: [[0, ''], [0.36, 'pinRing'], [0.95, '']],
      R: [[0, { f: 'rest' }],
        [0.16, { c: [0.10, -0.29, -0.30], fd: [-0.4, 0.6, -0.6], pn: [-0.6, 0.4, 0.6], pose: 'grenade' }, 'out'],
        [0.30, { c: [0.08, -0.17, -0.32], fd: [-0.5, 0.5, -0.7], pn: [-0.7, 0.3, 0.6], pose: 'grenade' }, 'io'],
        [0.48, { c: [0.24, -0.02, -0.08], fd: [0, 0.9, -0.4], pn: [-0.3, 0.3, 0.9], pose: 'grenade' }, 'io'],
        [0.60, { c: [0.10, 0.02, -0.52], fd: [0, 0.4, -0.9], pn: [0, -0.6, -0.3], pose: 'open' }, 'in'],
        [0.78, { c: [0.12, -0.34, -0.44], fd: [0, -0.6, -0.8], pn: [0, -0.8, 0.5], pose: 'relaxed' }, 'out'],
        [1.2, { f: 'rest' }, 'io']],
      L: [[0, { f: 'rest' }],
        [0.22, { c: [-0.06, -0.22, -0.30], fd: [0.6, 0.4, -0.6], pn: [0.6, 0.2, 0.7], pose: 'relaxed' }, 'out'],
        [0.32, { f: 'grenade:pin', pose: 'pinch' }, 'io'],
        [0.44, { c: [-0.16, -0.26, -0.24], fd: [0.4, 0.3, -0.8], pn: [0.7, 0.1, 0.6], pose: 'pinch' }, 'out'],
        [0.9, { c: [-0.2, -0.5, -0.2], fd: [0.4, 0.3, -0.8], pn: [0.7, 0.1, 0.6], pose: 'relaxed' }, 'in'],
        [1.2, { f: 'rest' }, 'io']],
    },
  },
};

export const GENERIC_CLIPS = Object.fromEntries(Object.entries(GENERIC_DEFS).map(([k, d]) => [k, makeClip({ ...d, name: k })]));
