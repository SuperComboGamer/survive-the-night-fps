// Ray Gun (fictional, retro-futuristic "Model 9 Plasma Projector") - HSB round: built with real-construction discipline: double-wall flared emitter bell with rim bolts (hex heads),
// prongs around a glowing core, chrome barrel with red/chrome cooling fins + collars + copper conduits with clamps, brass reactor cage (12 hex bolts per ring) around a rotating plasma coil,
// hexagonal energy crystal in a four-claw cradle, swept tail fins, dial gauge with bezel bolts + tick marks, toggle + valve, glass energy cell with knurled brass caps, bakelite grip with screws.
// Reference: pistol-sized 285 x 76 x 182 mm (length x width x height incl. grip) -> in-engine 286 x 76 x 182 | plasma emissive parts use the animated 'plasma' material.
import { hsb, rrect, circ, slot, strip, roundPoly, arcPts, bezPts, helixPts } from '../hsb-kit.js';
import '../hsb-mats.js';

const BR = 'hBrass', CR = 'hChrome', RA = 'hRed', BK = 'hBake', PZ = 'plasma', GL = 'hBake', MK = 'marks:raygun', CX = 'crystal', CU = 'hCopper', SB = 'hChrome', KN = 'hBrass';
const Z6 = [0, 0, 0, 0, 0, 0];
const DRAWN = [0.02, -0.21, 0.07, -58, 10, -32];

export default {
  id: 'raygun',
  handling: {
    hip: { p: [0.108, -0.104, -0.36], r: [0.5, 2.8, 0] }, eye: 0.36, sprint: { p: [0.1, -0.12, -0.27], r: [-30, 34, 30] },
    pivot: [0, -0.06, 0.06], wall: { p: [-0.02, -0.02, 0.12], r: [30, 8, -8] },
    shoulderR: [0.17, -0.25, 0.08], shoulderL: [-0.17, -0.25, 0.08], poleR: [0.6, -1, 0.2], poleL: [-0.6, -1, 0.2],
    hands: { R: { f: 'gripR', pose: 'pistolGrip' }, L: { f: 'supportL', pose: 'pistolSupport' } },
    sprintHands: { L: { c: [-0.16, -0.46, -0.12], fd: [0.2, -0.6, -0.75], pn: [0.8, 0, 0.3], pose: 'relaxed' } },
    frames: {
      gripR: { part: 'root', p: [0.0215, -0.0640, 0.0560], fd: [0, -0.28, -0.96], pn: [-1, 0, 0] },
      supportL: { part: 'root', p: [-0.0330, -0.0620, 0.0440], fd: [0.25, -0.38, -0.89], pn: [1, 0.2, 0.08] },
      cellL: { part: 'cell', p: [-0.006, 0.020, 0.110], fd: [0.4, -0.5, -0.76], pn: [0.2, -0.9, 0.3] },
    },
    parts(rig, st, vm) { rig.set('coil', 0, 0, 0, 0, 0, (vm ? vm.time : 0) * 7); rig.scale('cell', st.mag > 0 || st.reloading ? 1 : 1); },
    clips: {
      fire: { dur: 0.3, tracks: { trigger: [[0, [0, 0, 0.003]], [0.12, [0, 0, 0.003]], [0.3, [0, 0, 0], 'out']], emitter: [[0, [0, 0, 0.004]], [0.2, [0, 0, 0], 'out']] } },
      dry: { dur: 0.14, tracks: { trigger: [[0, [0, 0, 0.003]], [0.14, [0, 0, 0], 'out']] } },
      draw: { dur: 0.5, events: [[0.0, 'snd', 'draw'], [0.1, 'snd', 'charge']], tracks: { gun: [[0, DRAWN], [0.5, Z6, 'out3']] } },
      holster: { dur: 0.3, tracks: { gun: [[0, Z6], [0.3, DRAWN, 'in']] } },
      firstDraw: { dur: 0.9, events: [[0.0, 'snd', 'draw'], [0.2, 'snd', 'charge']], tracks: { gun: [[0, DRAWN], [0.45, [0.0, 0.01, 0.02, 8, -10, -24], 'out3'], [0.9, Z6, 'io']] } },
      reload: {
        dur: 2.0, events: [[0.3, 'snd', 'cellOut'], [1.3, 'snd', 'cellIn'], [1.32, 'magFill'], [1.36, 'snd', 'charge']],
        tracks: {
          gun: [[0, Z6], [0.25, [-0.09, 0.0, -0.12, 24, -40, 0], 'io'], [1.3, [-0.092, 0.004, -0.12, 25, -41, -1], 'io'], [1.36, [-0.088, 0.006, -0.11, 23, -39, 0], 'out'], [2.0, Z6, 'io']],
          cell: [[0.26, Z6], [0.38, [0, 0.004, 0.05], 'out'], [0.62, [-0.05, -0.3, 0.1, 40, 20, 0], 'in'], [0.74, [-0.08, -0.3, 0.12, 60, 30, 0], 'step'], [1.14, [0, 0.01, 0.06], 'out'], [1.3, Z6, 'in']],
          L: [[0, { f: 'rest' }], [0.24, { f: 'cellL', pose: 'pinch' }, 'io'], [0.6, { f: 'cellL', pose: 'pinch' }], [0.74, { f: 'cellL', pose: 'pinch' }, 'step'], [1.3, { f: 'cellL', pose: 'pinch' }], [1.36, { f: 'cellL', p: [0, 0, -0.008], pose: 'slap' }, 'out'], [1.8, { f: 'rest' }, 'io']] } },
    },
  },
  build(K, M) {
    M.util(); M.plasma();
    M.marks('raygun', 1024, 256, (g) => { g.font = 'bold 40px "Arial", sans-serif'; g.textBaseline = 'middle'; g.fillText('MODEL 9  PLASMA PROJECTOR', 12, 32); g.fillText('DANGER  -  HIGH ENERGY', 12, 96); g.fillText('1 2 3 4 5', 12, 160); }, { color: 0x2a2010, rough: 0.5, metal: 0.6 });
    const row = (i, u1) => [0, 1 - (i + 1) / 4 + 0.01, u1, 1 - i / 4 - 0.01]; const qw = (hh, u1) => hh * (u1 * 1024 / 64) * 0.98;
    const h = hsb(K); const { ex, ez, ey, bx, lt, cy, tb, rv, hx, spring, bar, gear, sx: strap } = h; const R = K.root; const both = (f) => { f(1); f(-1); };
    const trigger = K.part('trigger', { pivot: [0, -0.04, 0.02] }), coil = K.part('coil', { pivot: [0, 0, 0.026] }), cell = K.part('cell', { pivot: [0, 0, 0.1] }), emitter = K.part('emitter', { pivot: [0, 0, -0.13] });
    // ------------------------------------------------------------ emitter: double-wall flared bell, core lens, four prongs, rim bolts, ring grooves
    emitter.lathe(CR, [0, 0, 0], roundPoly([[0.0104, -0.1120], [0.0118, -0.1180, 0.0006], [0.0160, -0.1300], [0.0250, -0.1460], [0.0305, -0.1520, 0.0008], [0.0314, -0.1556, 0.0008], [0.0296, -0.1568, 0.0006], [0.0276, -0.1546, 0.0006], [0.0218, -0.1490], [0.0140, -0.1400], [0.0092, -0.1320], [0.0092, -0.1120]], 18), { axis: 'z', seg: 40, sharp: 55, chamfer: 0.004 });
    lt(emitter, PZ, [0, 0, 0], [[0, -0.1262], [0.0090, -0.1322], [0.0068, -0.1345], [0, -0.1358]], { axis: 'z', seg: 26, deg: 30 }); // glowing throat
    lt(emitter, PZ, [0, 0, 0], [[0, -0.1358], [0.0040, -0.1360], [0.0038, -0.1440], [0, -0.1452]], { axis: 'z', seg: 16, deg: 30 }); // core tip
    for (const [r, z] of [[0.0155, -0.1410], [0.0215, -0.1470]]) emitter.torus(RA, [0, 0, z], r, 0.0011, { seg: 8, tube: 36 });
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; ex(emitter, SB, [[-0.1350, 0.0, 0.001], [-0.1520, 0.0060, 0.002], [-0.1520, 0.0110, 0.002], [-0.1330, 0.0090, 0.002]], -0.0007, 0.0007, { r: 0.0003, rot: [0, 0, a * 57.2958], p: [0, 0, 0] }); } // prongs around the core
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; hx(emitter, SB, [Math.cos(a) * 0.0285, Math.sin(a) * 0.0285, -0.1571], 0.0021, 0.0016, { axis: 'z', spin: a }); } // rim bolts (real hex heads)
    // ------------------------------------------------------------ barrel core, three collars with hex nuts, cooling fins (red / chrome), top spine + sights
    lt(R, CR, [0, 0, 0], [[0, -0.1180], [0.0098, -0.1180, 0.0005], [0.0102, -0.1160], [0.0102, -0.0280], [0.0135, -0.0240, 0.0006], [0.0135, -0.0180], [0, -0.0180]], { axis: 'z', seg: 32 });
    for (let i = 0; i < 8; i++) { const z = -0.106 + i * 0.0108, r = 0.0205 + i * 0.0011; lt(R, i % 2 ? CR : RA, [0, 0, 0], [[0.0102, z - 0.0016], [r - 0.0007, z - 0.0016, 0.0005], [r, z - 0.0009, 0.0005], [r, z + 0.0009, 0.0005], [r - 0.0007, z + 0.0016, 0.0005], [0.0102, z + 0.0016]], { axis: 'z', seg: 36, sharp: 50 }); }
    for (const z of [-0.112, -0.024]) { lt(R, SB, [0, 0, 0], [[0.0102, z - 0.0030], [0.0128, z - 0.0030, 0.0005], [0.0128, z + 0.0030, 0.0005], [0.0102, z + 0.0030]], { axis: 'z', seg: 24 }); hx(R, SB, [0, 0.0128, z], 0.0040, 0.0030, { axis: 'y' }); }
    ex(R, CR, [[-0.1040, 0.0225, 0.001], [-0.0320, 0.0225, 0.001], [-0.0340, 0.0300, 0.003], [-0.0500, 0.0345, 0.004], [-0.0850, 0.0345, 0.003], [-0.1020, 0.0270, 0.004]], -0.0009, 0.0009, { r: 0.0004 }); // swept top spine / front sight fin
    ex(R, CR, [[-0.1120, 0.0240, 0.001], [-0.1000, 0.0240, 0.001], [-0.1000, 0.0420, 0.002], [-0.1060, 0.0440, 0.002]], -0.0010, 0.0010, { r: 0.0004 });
    both((s) => { R.sweep(CU, [[s * 0.0125, 0.0040, -0.1050], [s * 0.0134, 0.0045, -0.0700], [s * 0.0134, 0.0045, -0.0350], [s * 0.0160, 0.0040, -0.0180]], 0.0013, { seg: 8, smooth: 3 }); for (const z of [-0.0920, -0.0560]) lt(R, SB, [s * 0.0134, 0.0045, z], [[0.0012, -0.0016], [0.0020, -0.0016, 0.0003], [0.0020, 0.0016, 0.0003], [0.0012, 0.0016]], { axis: 'z', seg: 12 }); }); // conduits + clamps
    // ------------------------------------------------------------ reactor: brass end rings with bolt circles, six flanged bars, dark core, rotating plasma coil
    lt(R, BR, [0, 0, 0], [[0.0135, -0.0200], [0.0290, -0.0180, 0.0008], [0.0312, -0.0120, 0.0008], [0.0312, -0.0020, 0.0008], [0.0280, 0.0000], [0.0135, 0.0000]], { axis: 'z', seg: 40 });
    lt(R, BR, [0, 0, 0], [[0.0135, 0.0520], [0.0280, 0.0520], [0.0312, 0.0540, 0.0008], [0.0312, 0.0680, 0.0008], [0.0280, 0.0740, 0.0008], [0.0140, 0.0780]], { axis: 'z', seg: 40 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; bx(R, BR, [Math.cos(a) * 0.0292, Math.sin(a) * 0.0292, 0.0260], [0.0050, 0.0038, 0.0540], { r: 0.0012, rot: [0, 0, a * 57.2958] }); }
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; hx(R, SB, [Math.cos(a) * 0.0296, Math.sin(a) * 0.0296, -0.0100], 0.0016, 0.0012, { axis: 'z', spin: a }); hx(R, SB, [Math.cos(a) * 0.0296, Math.sin(a) * 0.0296, 0.0640], 0.0016, 0.0012, { axis: 'z', spin: a }); }
    cy(R, GL, [0, 0, 0.0260], 0.0085, 0.0520, { axis: 'z', seg: 18, r: 0 });
    coil.sweep(PZ, helixPts(0.052, 0.0185, 5.5, 110).map((p) => [p[0], p[1], p[2]]), 0.0022, { seg: 8 });
    // energy crystal (hexagonal prism, HDR emissive) in a four-claw chrome cradle
    lt(R, CX, [0, 0.0395, 0.0260], [[0, -0.0160], [0.0036, -0.0120], [0.0046, -0.0060], [0.0046, 0.0060], [0.0036, 0.0120], [0, 0.0160]], { axis: 'z', seg: 6, sharp: 20, deg: 60 });
    lt(R, CR, [0, 0.0395, 0.0260], [[0.0052, -0.0105], [0.0062, -0.0100], [0.0062, 0.0100], [0.0052, 0.0105]], { axis: 'z', seg: 24, t0: Math.PI * 1.25, tlen: Math.PI * 0.5, sharp: 60 });
    for (const [x, z] of [[-0.0048, 0.0140], [0.0048, 0.0140], [-0.0048, 0.0380], [0.0048, 0.0380]]) bx(R, CR, [x, 0.0355, z], [0.0014, 0.0085, 0.0028], { r: 0.0004, rot: [0, 0, x > 0 ? -18 : 18] });
    bx(R, CR, [0, 0.0318, 0.0260], [0.0120, 0.0024, 0.0340], { r: 0.0008 });
    // swept tail fins (top + two canted side fins)
    for (const [rz, x] of [[0, 0], [-58, 0.012], [58, -0.012]]) ex(R, CR, [[0.0500, 0.0200, 0.002], [0.0780, 0.0200, 0.003], [0.0920, 0.0460, 0.004], [0.0860, 0.0500, 0.002], [0.0660, 0.0340, 0.004]], -0.0012, 0.0012, { r: 0.0005, rot: [0, 0, rz], p: [x, rz ? -0.004 : 0, 0] });
    // copper feed pipes from the reactor into the grip frame + clamps, side dial (bezel with hex bolts, lens, needle, tick marks), toggle, valve
    both((s) => { R.sweep(CU, [[s * 0.0240, -0.0160, 0.0040], [s * 0.0220, -0.0260, 0.0100], [s * 0.0160, -0.0300, 0.0240], [s * 0.0120, -0.0300, 0.0400]], 0.0016, { seg: 8, smooth: 3 }); lt(R, SB, [s * 0.0170, -0.0292, 0.0200], [[0.0014, -0.0024], [0.0024, -0.0024, 0.0004], [0.0024, 0.0024, 0.0004], [0.0014, 0.0024]], { axis: 'z', seg: 12 }); });
    tb(R, BR, [-0.0310, -0.0040, 0.0620], 0.0080, 0.0060, 0.0050, { axis: 'x', seg: 28, r: 0.0007 }); cy(R, GL, [-0.0322, -0.0040, 0.0620], 0.0062, 0.0008, { axis: 'x', seg: 26, r: 0 });
    for (let i = 0; i < 9; i++) { const a = (-120 + i * 30) * Math.PI / 180; bx(R, SB, [-0.0331, -0.0040 + Math.sin(a + 1.5708) * 0.0052, 0.0620 + Math.cos(a + 1.5708) * 0.0052], [0.0004, 0.0010 + (i % 2 ? 0 : 0.0006), 0.0004], { r: 0.0001, wear: 0, rot: [-(a + 1.5708) * 57.2958 + 90, 0, 0] }); }
    bx(R, BK, [-0.0334, -0.0025, 0.0615], [0.0004, 0.0046, 0.0007], { r: 0.0001, rot: [30, 0, 0], wear: 0 }); // needle
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; hx(R, SB, [-0.0322, -0.0040 + Math.cos(a) * 0.0088, 0.0620 + Math.sin(a) * 0.0088], 0.0011, 0.0012, { axis: '-x', spin: a }); }
    bx(R, RA, [-0.0314, 0.0100, 0.0300], [0.0030, 0.0040, 0.0070], { r: 0.0007 }); cy(R, SB, [-0.0327, 0.0100, 0.0290], 0.0011, 0.0060, { axis: 'x', seg: 8, r: 0.0003, rot: [0, 0, 20] }); // toggle switch
    lt(R, BR, [0.0316, -0.0060, 0.0500], [[0, 0], [0.0060, 0, 0.0006], [0.0060, 0.0030, 0.0006], [0.0034, 0.0034], [0.0034, 0.0064], [0.0050, 0.0066, 0.0006], [0.0050, 0.0084, 0.0008], [0, 0.0086]], { axis: 'x', seg: 20 }); // brass valve knob (right)
    both((s) => { rv(R, BR, [0.0310 * s, 0.0060, 0.0300], 0.0046, { axis: s > 0 ? 'x' : '-x', h: 0.0026 }); });
    // barrel-shroud louvres (chrome slats) + top vents (glowing slots)
    for (let i = 0; i < 6; i++) both((s) => bx(R, CR, [s * 0.0128, 0.0062, -0.0960 + i * 0.0140], [0.0018, 0.0035, 0.0065], { r: 0.0004, rot: [0, 0, s * -35] }));
    for (let i = 0; i < 4; i++) { bx(R, BR, [0, 0.0318, 0.0570 + i * 0.0045], [0.0180, 0.0020, 0.0024], { r: 0.0005 }); bx(R, PZ, [0, 0.0312, 0.0592 + i * 0.0045], [0.0140, 0.0016, 0.0016], { r: 0.0002, wear: 0 }); }
    both((s) => bx(R, CR, [s * 0.0040, 0.0385, 0.0700], [0.0045, 0.0080, 0.0060], { r: 0.0007 })); // rear sight ears
    // ------------------------------------------------------------ energy cell (glass capsule, brass caps with real knurl, bayonet lugs) at the rear
    lt(cell, BR, [0, 0, 0], [[0, 0.0760], [0.0118, 0.0760, 0.0006], [0.0124, 0.0780], [0.0124, 0.0860], [0.0110, 0.0880], [0, 0.0880]], { axis: 'z', seg: 28 });
    lt(cell, PZ, [0, 0, 0], [[0.0100, 0.0870], [0.0105, 0.0880], [0.0105, 0.1120], [0.0100, 0.1130]], { axis: 'z', seg: 28 });
    lt(cell, BR, [0, 0, 0], [[0.0110, 0.1120], [0.0124, 0.1140, 0.0006], [0.0124, 0.1220], [0.0110, 0.1260], [0.0050, 0.1280], [0, 0.1285]], { axis: 'z', seg: 28 });
    gear(cell, KN, [0, 0, 0.1185], 40, 0.0127, 0.0007, 0.0060, { axis: 'z' });
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; bx(cell, BR, [Math.cos(a) * 0.0122, Math.sin(a) * 0.0122, 0.0810], [0.0030, 0.0030, 0.0070], { r: 0.0007, rot: [0, 0, a * 57.2958] }); }
    // ------------------------------------------------------------ grip (bakelite, finger grooves, screws), brass guard + pommel, lower body tube, red serrated trigger
    const gp = roundPoly([[0.0180, -0.0260], [0.0660, -0.0260, 0.006], [0.0740, -0.0520, 0.010], [0.0880, -0.1180, 0.008], [0.0780, -0.1260, 0.006], [0.0500, -0.1240, 0.008], [0.0460, -0.1080, 0.005], [0.0400, -0.0980, 0.006], [0.0420, -0.0860, 0.005], [0.0360, -0.0760, 0.006], [0.0380, -0.0640, 0.005], [0.0300, -0.0520, 0.006]], 16);
    ex(R, BK, gp, -0.0152, 0.0152, { r: 0.0030, segs: 3 });
    both((s) => { for (const [z, y] of [[0.0600, -0.0460], [0.0740, -0.1040]]) rv(R, SB, [s * 0.0154, y, z], 0.0032, { axis: s > 0 ? 'x' : '-x', h: 0.0014 }); });
    lt(R, BR, [0.0, -0.1265, 0.0680], [[0, -0.0040], [0.0120, -0.0040, 0.0006], [0.0130, 0.0000, 0.0004], [0, 0.0020]], { axis: 'y', seg: 26, rot: [-12, 0, 0] }); // pommel cap
    strap(R, BR, [[0.0340, -0.0260], [0.0100, -0.0300], [-0.0120, -0.0400], [-0.0140, -0.0540], [0.0230, -0.0640], [0.0390, -0.0600]], 0.0048, -0.0058, 0.0058, { r: 0.0012 }); // brass guard bow
    lt(R, BR, [0, -0.0205, -0.0040], [[0, -0.0180], [0.0145, -0.0180, 0.0008], [0.0155, -0.0120], [0.0155, 0.0120], [0.0145, 0.0180, 0.0008], [0, 0.0180]], { axis: 'z', seg: 30 }); // lower body tube
    both((s) => { for (let i = 0; i < 6; i++) cy(R, GL, [s * 0.0153, -0.0205, -0.0140 + i * 0.0056], 0.0012, 0.0010, { axis: 'x', seg: 10, r: 0, wear: 0 }); }); // heat-vent perforations
    ex(trigger, RA, [[0.0100, -0.0300], [0.0040, -0.0400, 0.004], [0.0080, -0.0500, 0.002], [0.0140, -0.0480, 0.002], [0.0160, -0.0320]], -0.0034, 0.0034, { r: 0.0007 });
    for (let i = 0; i < 4; i++) bx(trigger, RA, [0, -0.0410 - i * 0.0020, 0.0060 + i * 0.0006], [0.0072, 0.0006, 0.0018], { r: 0.0002, wear: 0.3 }); // trigger serrations
    R.quad(MK, [-0.0312, 0.0120, 0.0640], qw(0.0035, 0.62), 0.0035, row(0, 0.62), { r: [0, -90, 0] });
    K.socket('muzzle', 'emitter', [0, 0, -0.157]); K.socket('sightRear', 'root', [0, 0.0425, 0.07]); K.socket('sightFront', 'root', [0, 0.0425, -0.106]);
    return { length: 0.285, sightHeight: 0.0425, rearSightZ: 0.07, frontSightZ: -0.106 };
  },
};
