// "Olympia" 12-gauge side-by-side hammer coach gun - HSB round. Two hollow tapering tubes (22.4 -> 19.2 mm) with swamped matted top rib + brass bead, figure-8 monobloc and lumps,
// walnut splinter forend with iron, latch and real checkering (pyramid geometry), case-hardened boxlock frame, hinge knuckle + pin, top lever with serrated thumb piece, tang safety,
// external hammers with ridged spurs (fire animation = -44 deg), double triggers in a guard bow, walnut pistol-grip stock with real checkering + grip cap + checkered butt pad.
// Reference (mm, real -> in-engine): overall 940 -> 951 | barrels 508 (20") -> 508.5 | tube OD 22.4 breech / 19.2 muzzle | action 45 wide | LOP ~ 340 | mass 3.1 kg.
// Break-open: barrels pivot on the hinge pin; extractors lift the shells; fired hulls are ejected; shells load one by one.
import { hsb, rrect, circ, slot, strip, roundPoly, arcPts, bezPts } from '../hsb-kit.js';
import '../hsb-mats.js';
const LOADED = [1, 1];

const BL = 'hBlue', CH = 'hCase', W = 'hWalnut', RB = 'hPolymer', BR = 'hBrass', HU = 'hShell', BO = 'hPolymer', KN = 'hCase', SB = 'hBlue', MK = 'marks:olympia';
const Z6 = [0, 0, 0, 0, 0, 0];
const DRAWN = [0.03, -0.22, 0.05, -40, 12, -22];
const OPEN = [0, 0, 0, -36, 0, 0]; // barrels break open (muzzles drop)
const OUT = [0, -0.2, 0.2]; // ejected shell (hidden by the vis track)
const RG = [-0.05, -0.01, -0.14, 4, -45, -6], RG2 = [-0.047, -0.004, -0.134, 6, -43, -5]; // reload presentation: breech centred, yawed so the chambers face up-left to the loading hand
// left hand: shell pocket (off-screen low left) and the rise with a shell pinched at the rim (orientation close to loadR/L)
const POCKET = { c: [-0.17, -0.44, -0.2], fd: [0.5, -0.3, -0.8], pn: [0.7, 0.3, 0.5], pose: 'relaxed' };
const RISE = { c: [-0.12, -0.3, -0.3], fd: [1, 0.1, -0.2], pn: [0, -0.6, -0.8], pose: 'pinch' };

export default {
  id: 'olympia',
  handling: {
    hip: { p: [0.1, -0.112, -0.2], r: [0.8, 2.2, 0] }, eye: 0.16, adsOffset: [0, -0.003, 0], sprint: { p: [0.05, -0.12, -0.2], r: [10, 48, 35] },
    pivot: [0, -0.06, 0.40], animPivot: [0, -0.03, 0.0], wall: { p: [0, -0.03, 0.08], r: [28, 12, -12] },
    shoulderR: [0.14, -0.22, 0.13], shoulderL: [-0.2, -0.26, 0.04], poleR: [0.9, -0.7, 0.2], poleL: [-0.45, -1, 0.1],
    hands: { R: { f: 'gripR', pose: 'rifleGrip' }, L: { f: 'foreL', pose: 'handguard' } },
    propHold: { shell: { p: [0, -0.047, -0.065], r: [-90, 0, 0] } }, // shell hangs from a rim pinch (thumb + index) along the palm normal
    frames: {
      gripR: { part: 'root', p: [0.0225, -0.0530, 0.1420], fd: [0, -0.5, -0.87], pn: [-1, 0, 0] },
      foreL: { part: 'barrels', p: [-0.003, -0.0440, -0.150], fd: [0.9, 0.12, -0.42], pn: [0.05, 1, 0.1] },
      // shell pinched at its rim above the chamber mouth (fingers point right, palm faces down the chamber axis): palm = rim - fd*0.045 - pn*0.05
      loadR: { part: 'barrels', p: [-0.034, 0, 0.114], fd: [1, 0, 0], pn: [0, 0, -1] },
      loadL: { part: 'barrels', p: [-0.056, 0, 0.114], fd: [1, 0, 0], pn: [0, 0, -1] },
    },
    parts(rig, st) {
      const b = st.barrels || LOADED; rig.set('hammerR', 0, 0, 0, b[0] ? 0 : -44 * Math.PI / 180, 0, 0); rig.set('hammerL', 0, 0, 0, b[1] ? 0 : -44 * Math.PI / 180, 0, 0);
      rig.scale('shellR', 1); rig.scale('shellL', 1);
    },
    clips: {
      fireR: { dur: 0.12, tracks: { hammerR: [[0, [0, 0, 0, -44, 0, 0]], [0.12, [0, 0, 0, -44, 0, 0]]], triggerF: [[0, [0, 0, 0, 14, 0, 0]], [0.12, Z6, 'out']] } },
      fireL: { dur: 0.12, tracks: { hammerL: [[0, [0, 0, 0, -44, 0, 0]], [0.12, [0, 0, 0, -44, 0, 0]]], triggerB: [[0, [0, 0, 0, 14, 0, 0]], [0.12, Z6, 'out']] } },
      dry: { dur: 0.14, tracks: { triggerF: [[0, [0, 0, 0, 14, 0, 0]], [0.14, Z6, 'out']] } },
      draw: { dur: 0.55, events: [[0.0, 'snd', 'draw']], tracks: { gun: [[0, DRAWN], [0.55, Z6, 'out3']] } },
      holster: { dur: 0.32, tracks: { gun: [[0, Z6], [0.32, DRAWN, 'in']] } },
      firstDraw: { dur: 1.0, events: [[0.0, 'snd', 'draw'], [0.62, 'snd', 'hammer'], [0.74, 'snd', 'hammer']], tracks: {
        gun: [[0, DRAWN], [0.45, [-0.01, 0.01, 0.0, 3, 6, 8], 'out3'], [1.0, Z6, 'io']],
        R: [[0, { f: 'rest' }], [0.5, { f: 'rest', pose: 'rifleGripThumb' }, 'io'], [0.8, { f: 'rest', pose: 'rifleGripThumb' }], [1.0, { f: 'rest' }, 'io']] } },
      reload: {
        dur: 2.1, events: [[0.12, 'snd', 'open'], [0.26, 'ejectShells'], [0.26, 'snd', 'eject'], [1.0, 'snd', 'shellIn'], [1.38, 'snd', 'close'], [1.6, 'snd', 'hammer']],
        tracks: {
          gun: [[0, Z6], [0.28, RG, 'io'], [1.3, RG, 'io'], [1.42, RG2, 'out'], [2.1, Z6, 'io']],
          barrels: [[0.08, Z6], [0.22, OPEN, 'out'], [1.3, OPEN], [1.4, Z6, 'in']], lever: [[0.02, Z6], [0.08, [0, 0, 0, 0, 0, -38], 'out'], [1.36, [0, 0, 0, 0, 0, -38]], [1.42, Z6, 'out']],
          extractor: [[0.18, Z6], [0.26, [0, 0, 0.011], 'out'], [1.3, [0, 0, 0.011]], [1.4, Z6, 'in']],
          shellR: [[0.2, [0, 0, 0.011]], [0.26, [0, 0, 0.011]], [0.27, OUT, 'step'], [0.92, OUT], [0.921, [0, 0, 0.064], 'step'], [1.08, [0, 0, 0.011], 'in'], [1.3, [0, 0, 0.011]], [1.4, Z6, 'in']],
          shellL: [[0.18, Z6], [0.26, [0, 0, 0.011], 'out'], [1.3, [0, 0, 0.011]], [1.4, Z6, 'in']],
          vis: [[0, { shellR: 1 }], [0.27, { shellR: 0 }], [0.92, { shellR: 1 }]],
          holdL: [[0, ''], [0.5, 'shell'], [0.92, '']],
          L: [[0, { f: 'rest' }], [0.1, { f: 'rest' }], [0.34, POCKET, 'in'], [0.62, RISE, 'io'], [0.86, { f: 'loadR', p: [0, 0.025, 0], pose: 'pinch' }, 'out'], [0.92, { f: 'loadR', pose: 'pinch' }, 'io'],
            [1.08, { f: 'loadR', p: [0, -0.053, 0], pose: 'pinch' }, 'in'], [1.22, { f: 'foreL', p: [0, -0.02, 0.02] }, 'io'], [1.4, { f: 'foreL', p: [0, 0.006, 0] }, 'out'], [2.0, { f: 'rest' }, 'io']],
          R: [[0, { f: 'rest' }], [0.02, { f: 'rest', pose: 'rifleGripThumb' }], [0.12, { f: 'rest' }], [1.46, { f: 'rest' }], [1.56, { f: 'rest', pose: 'rifleGripThumb' }], [1.7, { f: 'rest' }]],
          hammerR: [[1.5, [0, 0, 0, -44, 0, 0]], [1.62, Z6, 'io']] } },
      reloadEmpty: {
        dur: 2.8, events: [[0.12, 'snd', 'open'], [0.26, 'ejectShells'], [0.26, 'snd', 'eject'], [1.0, 'snd', 'shellIn'], [1.82, 'snd', 'shellIn'], [2.16, 'snd', 'close'], [2.3, 'snd', 'hammer'], [2.42, 'snd', 'hammer']],
        tracks: {
          gun: [[0, Z6], [0.28, RG, 'io'], [2.08, RG, 'io'], [2.2, RG2, 'out'], [2.8, Z6, 'io']],
          barrels: [[0.08, Z6], [0.22, OPEN, 'out'], [2.08, OPEN], [2.18, Z6, 'in']], lever: [[0.02, Z6], [0.08, [0, 0, 0, 0, 0, -38], 'out'], [2.14, [0, 0, 0, 0, 0, -38]], [2.2, Z6, 'out']],
          extractor: [[0.18, Z6], [0.26, [0, 0, 0.011], 'out'], [2.08, [0, 0, 0.011]], [2.18, Z6, 'in']],
          shellR: [[0.2, [0, 0, 0.011]], [0.26, [0, 0, 0.011]], [0.27, OUT, 'step'], [0.92, OUT], [0.921, [0, 0, 0.064], 'step'], [1.08, [0, 0, 0.011], 'in'], [2.08, [0, 0, 0.011]], [2.18, Z6, 'in']],
          shellL: [[0.2, [0, 0, 0.011]], [0.26, [0, 0, 0.011]], [0.27, OUT, 'step'], [1.74, OUT], [1.741, [0, 0, 0.064], 'step'], [1.9, [0, 0, 0.011], 'in'], [2.08, [0, 0, 0.011]], [2.18, Z6, 'in']],
          vis: [[0, { shellR: 1, shellL: 1 }], [0.27, { shellR: 0, shellL: 0 }], [0.92, { shellR: 1, shellL: 0 }], [1.74, { shellR: 1, shellL: 1 }]],
          holdL: [[0, ''], [0.5, 'shell'], [0.92, ''], [1.3, 'shell'], [1.74, '']],
          L: [[0, { f: 'rest' }], [0.1, { f: 'rest' }], [0.34, POCKET, 'in'], [0.62, RISE, 'io'], [0.86, { f: 'loadR', p: [0, 0.025, 0], pose: 'pinch' }, 'out'], [0.92, { f: 'loadR', pose: 'pinch' }, 'io'],
            [1.08, { f: 'loadR', p: [0, -0.053, 0], pose: 'pinch' }, 'in'], [1.2, RISE, 'io'], [1.32, POCKET, 'io'], [1.5, RISE, 'io'], [1.68, { f: 'loadL', p: [0, 0.025, 0], pose: 'pinch' }, 'out'], [1.74, { f: 'loadL', pose: 'pinch' }, 'io'],
            [1.9, { f: 'loadL', p: [0, -0.053, 0], pose: 'pinch' }, 'in'], [2.02, { f: 'foreL', p: [0, -0.02, 0.02] }, 'io'], [2.18, { f: 'foreL', p: [0, 0.006, 0] }, 'out'], [2.7, { f: 'rest' }, 'io']],
          R: [[0, { f: 'rest' }], [0.02, { f: 'rest', pose: 'rifleGripThumb' }], [0.12, { f: 'rest' }], [2.16, { f: 'rest' }], [2.26, { f: 'rest', pose: 'rifleGripThumb' }], [2.48, { f: 'rest', pose: 'rifleGripThumb' }], [2.6, { f: 'rest' }]],
          hammerR: [[2.2, [0, 0, 0, -44, 0, 0]], [2.3, Z6, 'io']], hammerL: [[2.32, [0, 0, 0, -44, 0, 0]], [2.42, Z6, 'io']] } },
    },
  },
  build(K, M) {
    M.util();
    M.marks('olympia', 1024, 256, (g) => { g.font = 'italic bold 40px "Times New Roman", serif'; g.textBaseline = 'middle'; g.fillText('OLYMPIA  ~  12 GAUGE  ~  2 3/4"', 12, 32); g.font = 'bold 36px "Times New Roman", serif'; g.fillText('No 4127', 12, 96); g.fillText('CHOKE  CYL.', 12, 160); }, { color: 0xd8d8d0, rough: 0.5, metal: 0.5 });
    const row = (i, u1) => [0, 1 - (i + 1) / 4 + 0.01, u1, 1 - i / 4 - 0.01]; const qw = (hh, u1) => hh * (u1 * 1024 / 64) * 0.98;
    const h = hsb(K); const { ex, ez, ey, bx, lt, cy, tb, rv, spring, sx: strap } = h; const R = K.root; const both = (f) => { f(1); f(-1); };
    const barrels = K.part('barrels', { pivot: [0, -0.019, -0.052] });
    const extractor = K.part('extractor', { parent: 'barrels', pivot: [0, 0, 0] });
    const shellR = K.part('shellR', { parent: 'barrels', pivot: [0.0112, 0, -0.035] }), shellL = K.part('shellL', { parent: 'barrels', pivot: [-0.0112, 0, -0.035] });
    const hammerR = K.part('hammerR', { pivot: [0.0172, 0.004, 0.056] }), hammerL = K.part('hammerL', { pivot: [-0.0172, 0.004, 0.056] });
    const trigF = K.part('triggerF', { pivot: [0, -0.024, 0.066] }), trigB = K.part('triggerB', { pivot: [0, -0.024, 0.086] }), lever = K.part('lever', { pivot: [0, 0.018, 0.088] });
    // ------------------------------------------------------------ barrels: two hollow tubes (tapering 22.4 -> 19.2 mm), joined by solder ribs, bead, monobloc + lumps
    both((s) => {
      lt(barrels, BL, [s * 0.0112, 0, 0], [[0.0084, -0.5085], [0.0097, -0.5085, 0.0005], [0.0097, -0.4900], [0.0101, -0.3000], [0.0108, -0.0700], [0.0114, -0.0600, 0.0006], [0.0114, -0.0100], [0.0084, -0.0100]], { axis: 'z', seg: 30, chamfer: 0.006 }); // hollow tube (bore 16.8 mm)
      lt(barrels, BO, [s * 0.0112, 0, 0], [[0, -0.4800], [0.0084, -0.4800], [0.0084, -0.4790], [0, -0.4790]], { axis: 'z', seg: 18, wear: 0 }); // black plug deep in the bore
      lt(barrels, BL, [s * 0.0112, 0, 0], [[0.0089, 0.0000], [0.0117, 0.0000, 0.0005], [0.0117, -0.0100], [0.0089, -0.0100]], { axis: 'z', seg: 26 }); // chamber breech ring
    });
    const ribSec = (hw, top, sag) => roundPoly([[-hw, 0.0026, 0.0004], [hw, 0.0026, 0.0004], [hw, top, 0.0005]].concat(arcPts(0, top + hw * 1.8, hw * 1.8 + sag, -90 + 29, -90 - 29, 8).map((q) => [q[0], q[1]])).concat([[-hw, top, 0.0005]]), 12);
    barrels.polyLoft(BL, [{ z: -0.0600, pts: ribSec(0.0058, 0.0116, 0.0004) }, { z: -0.3000, pts: ribSec(0.0052, 0.0106, 0.0004) }, { z: -0.5000, pts: ribSec(0.0046, 0.0099, 0.0003) }], { N: 40, wear: 0.15 });
    for (let i = 0; i < 24; i++) bx(barrels, BL, [0, 0.0101 + 0.0001, -0.075 - i * 0.0165], [0.0064 - i * 0.00007, 0.0004, 0.0009], { r: 0.0002, wear: 0.2 }); // file-cut matting ticks on the rib
    bx(barrels, BL, [0, -0.0083, -0.2800], [0.0100, 0.0060, 0.4400], { r: 0.0009 }); // bottom rib
    lt(barrels, BR, [0, 0.0102, -0.4985], [[0, -0.0016], [0.0022, -0.0016, 0.0004], [0.0022, 0.0000], [0.0011, 0.0012], [0.0009, 0.0038], [0, 0.0042]], { axis: 'y', seg: 14 }); // brass bead on a post
    ez(barrels, BL, [...arcPts(0.0112, 0, 0.0121, -90, 90, 14), ...arcPts(-0.0112, 0, 0.0121, 90, 270, 14)], -0.0660, 0.0, { r0: 0.0012, r1: 0.0006 }); // monobloc: figure-8 (two fused tubes)
    bx(barrels, BL, [0, -0.0175, -0.0280], [0.0220, 0.0120, 0.0500], { r: 0.0012 }); cy(barrels, BL, [0, -0.0160, -0.0090], 0.0040, 0.0220, { axis: 'x', seg: 14, r: 0.0005 }); // lumps + hook
    // ------------------------------------------------------------ forend (walnut splinter): tapering section, tip cap, iron + latch, real checkering
    const fe = []; for (let z = -0.0660; z >= -0.2500; z -= 0.0046) { const t = (-0.0660 - z) / 0.184, hw = 0.0226 - 0.0032 * t * t, yt = -0.0030, yb = -0.0325 + 0.0030 * t * t + (t > 0.9 ? 0.0028 * (t - 0.9) / 0.1 : 0); fe.push({ z, pts: rrect(-hw, hw, yb, yt, 0.0095 - 0.002 * t, 22) }); }
    barrels.polyLoft(W, fe, { N: 56, wear: 0.4, wearK: 0.0009, uv: 'box' });
    ex(barrels, RB, [[-0.2560, -0.0064, 0.004], [-0.2470, -0.0034, 0.003], [-0.2470, -0.0296, 0.004], [-0.2560, -0.0284, 0.004]], -0.0186, 0.0186, { r: 0.0009 }); // tip cap
    ey(barrels, BL, rrect(-0.0190, 0.0190, -0.0940, -0.0700, 0.0040), -0.0357, -0.0326, { r: 0.0007 }); // forend iron (plate under the wood)
    both((s) => { rv(barrels, SB, [s * 0.0100, -0.0357, -0.0780], 0.0026, { axis: '-y', h: 0.0012 }); rv(barrels, SB, [s * 0.0100, -0.0357, -0.0880], 0.0026, { axis: '-y', h: 0.0012 }); });
    bx(barrels, BL, [0, -0.0320, -0.2050], [0.0100, 0.0060, 0.0200], { r: 0.0012 }); cy(barrels, BL, [0, -0.0360, -0.2050], 0.0042, 0.0050, { axis: 'y', seg: 14, r: 0.0006 }); // latch escutcheon + release button
    both((s) => h.checker(barrels, W, { C: [s * 0.0212, -0.0170, -0.1640], U: [0, 0, 1], V: [0, 1, 0], N: [s, 0, 0], hu: 0.0400, hv: 0.0090, pitch: 0.0016, depth: 0.0007, rv: 0.05, inside: (x, y) => Math.pow(Math.abs(x) / 0.0400, 5) + Math.pow(Math.abs(y) / 0.0090, 5) < 1 }));
    // extractors (half-moon plate between the chambers) + shells in the chambers
    ex(extractor, BL, [[-0.0040, 0.0060], [0.0, 0.0060], [0.0, -0.0105, 0.002], [-0.0040, -0.0105, 0.002]], -0.0115, 0.0115, { r: 0.0004 });
    for (const [part, sxn] of [[shellR, 1], [shellL, -1]]) {
      lt(part, BR, [sxn * 0.0112, 0, 0], [[0, -0.0102], [0.0101, -0.0102, 0.0005], [0.0101, 0.0005], [0.0110, 0.0008], [0.0110, 0.0020, 0.0004], [0, 0.0020]], { axis: 'z', seg: 20 });
      lt(part, HU, [sxn * 0.0112, 0, 0], [[0, -0.0620], [0.0055, -0.0626], [0.0094, -0.0612], [0.0101, -0.0590], [0.0101, -0.0102], [0, -0.0102]], { axis: 'z', seg: 20 });
    }
    // ------------------------------------------------------------ action: case-hardened boxlock frame, standing breech, water table, fences, hinge knuckle + pin
    const actSec = (top, bot, r) => roundPoly([[-0.0225, bot, 0.004], [0.0225, bot, 0.004], [0.0225, top - r, r], [0.0225 - r * 0.9, top, r * 0.8], [-0.0225 + r * 0.9, top, r * 0.8], [-0.0225, top - r, r]], 10);
    ez(R, CH, actSec(-0.0112, -0.0285, 0.003), -0.0580, 0.0, { r0: 0.0016, r1: 0, caps1: false }); // water table
    R.polyLoft(CH, [{ z: 0.0, pts: actSec(0.0130, -0.0240, 0.009) }, { z: 0.016, pts: actSec(0.0182, -0.0240, 0.011) }, { z: 0.050, pts: actSec(0.0178, -0.0240, 0.012) }, { z: 0.080, pts: actSec(0.0160, -0.0240, 0.011) }, { z: 0.096, pts: actSec(0.0112, -0.0240, 0.007) }], { N: 56, wear: 0.5, wearK: 0.0012, uv: 'box' });
    both((s) => lt(R, CH, [s * 0.0112, 0.0, 0.0], [[0.0128, -0.0006], [0.0150, 0.0004], [0.0154, 0.0034], [0.0132, 0.0060], [0.0112, 0.0068]], { axis: 'z', seg: 18, t0: s > 0 ? -1.6 : Math.PI + 0.2, tlen: 1.4, sharp: 60 })); // fences
    cy(R, CH, [0, -0.0190, -0.0520], 0.0068, 0.0460, { axis: 'x', seg: 22, r: 0.0010 }); // knuckle / hinge pin housing
    R.screw(BL, [0.0232, -0.019, -0.052], 0.0038, { axis: 'x', slot: 20 }); R.screw(BL, [-0.0232, -0.019, -0.052], 0.0038, { axis: '-x', slot: -20 });
    both((s) => { cy(R, BL, [s * 0.0112, 0, 0.0008], 0.0016, 0.0024, { axis: 'z', seg: 10, r: 0.0003 }); R.screw(BL, [s * 0.0226, 0.0060, 0.0480], 0.0032, { axis: s > 0 ? 'x' : '-x', slot: 35 * s }); R.screw(BL, [s * 0.0226, -0.0140, 0.0800], 0.0028, { axis: s > 0 ? 'x' : '-x', slot: -20 * s }); }); // firing pins, lock screws
    both((s) => ey(R, BO, rrect(s * 0.0172 - 0.0050, s * 0.0172 + 0.0050, 0.0440, 0.0660, 0.0018), 0.0142, 0.0152, { r: 0.0002, segs: 1, wear: 0 })); // hammer-well shadow on the top of the frame
    // tangs, guard, triggers, top lever
    ex(R, BL, [[0.0800, 0.0185, 0.004], [0.1500, 0.0120, 0.006], [0.1500, 0.0090], [0.0800, 0.0150]], -0.0065, 0.0065, { r: 0.0008 });
    ex(R, BL, [[0.0400, -0.0260], [0.1700, -0.0500, 0.006], [0.1700, -0.0540], [0.0400, -0.0300]], -0.0065, 0.0065, { r: 0.0008 });
    strap(R, BL, [[0.0400, -0.0290], [0.0370, -0.0440], [0.0470, -0.0590], [0.0700, -0.0620], [0.1000, -0.0590], [0.1200, -0.0440], [0.1500, -0.0480]], 0.0030, -0.0058, 0.0058, { r: 0.0008 }); // trigger guard bow
    ex(trigF, BL, [[0.0600, -0.0260], [0.0560, -0.0400, 0.004], [0.0600, -0.0500, 0.002], [0.0650, -0.0490, 0.002], [0.0660, -0.0280]], -0.0032, 0.0032, { r: 0.0006 });
    ex(trigB, BL, [[0.0820, -0.0260], [0.0780, -0.0400, 0.004], [0.0820, -0.0500, 0.002], [0.0870, -0.0490, 0.002], [0.0880, -0.0280]], -0.0032, 0.0032, { r: 0.0006 });
    ex(lever, BL, [[0.0840, 0.0175, 0.003], [0.1180, 0.0150, 0.005], [0.1220, 0.0195, 0.004], [0.0880, 0.0215, 0.003]], -0.0056, 0.0056, { r: 0.0008, wear: 1.8 });
    for (let i = 0; i < 7; i++) bx(lever, BL, [0, 0.0208 + 0.0002, 0.1010 + i * 0.0021], [0.0100, 0.0006, 0.0010], { r: 0.0002, wear: 0.3 }); // serrated thumb piece
    cy(lever, BL, [0, 0.0185, 0.0880], 0.0062, 0.0036, { axis: 'y', seg: 18, r: 0.0008 });
    bx(R, BL, [0, 0.0152, 0.1400], [0.0090, 0.0030, 0.0180], { r: 0.0008 }); // tang safety slide
    // hammers (authored cocked; fired = -44 deg): body, spur with real ridges, hub screw
    both((s) => {
      const part = s > 0 ? hammerR : hammerL, x0 = s * 0.0172 - 0.0034, x1 = s * 0.0172 + 0.0034;
      ex(part, CH, [[0.0460, 0.0020, 0.003], [0.0620, 0.0020, 0.003], [0.0705, 0.0165, 0.005], [0.0855, 0.0320, 0.005], [0.0925, 0.0370, 0.004], [0.0885, 0.0420, 0.004], [0.0780, 0.0370, 0.002], [0.0605, 0.0225, 0.005], [0.0520, 0.0165, 0.005]], x0 - 0.0006, x1 + 0.0006, { r: 0.0014, wear: 1.6 });
      for (let i = 0; i < 6; i++) { const t = i / 5; bx(part, KN, [s * 0.0172, 0.0388 + t * 0.0030, 0.0868 + t * 0.0060], [0.0075, 0.0010, 0.0016], { r: 0.0003, rot: [-38, 0, 0], wear: 0.4 }); } // spur ridges
      cy(part, CH, [s * 0.0172, 0.0040, 0.0560], 0.0050, 0.0080, { axis: 'x', seg: 16, r: 0.0007 });
      rv(part, SB, [s * (0.0172 + 0.0042), 0.0040, 0.0560], 0.0026, { axis: s > 0 ? 'x' : '-x', h: 0.0012 });
    });
    // ------------------------------------------------------------ stock: walnut pistol grip + comb, real checkering on the wrist, hard-rubber grip cap, checkered butt pad with screws
    R.profLoft(W, { z0: 0.090, z1: 0.429, steps: 56, K: 32,
      top: [[0.090, 0.0125], [0.12, 0.005], [0.16, 0.000], [0.2, -0.005], [0.25, -0.010], [0.34, -0.017], [0.43, -0.025]],
      bot: [[0.090, -0.024], [0.11, -0.030], [0.135, -0.047], [0.16, -0.074], [0.178, -0.088], [0.195, -0.085], [0.215, -0.066], [0.26, -0.070], [0.34, -0.088], [0.43, -0.122]],
      w: [[0.090, 0.0195], [0.13, 0.0176], [0.18, 0.0170], [0.24, 0.0190], [0.43, 0.0205]], n: [[0.09, 2.5], [0.18, 2.2], [0.43, 2.35]] });
    cy(R, RB, [0, -0.0905, 0.1790], 0.0145, 0.0034, { axis: 'y', seg: 22, r: 0.0009, rot: [16, 0, 0] }); // grip cap
    both((s) => h.checker(R, W, { C: [s * 0.0166, -0.0430, 0.1420], U: [0, 0, 1], V: [0, 1, 0], N: [s, 0, 0], hu: 0.0290, hv: 0.0260, pitch: 0.0017, depth: 0.0007, rv: 0.06, inside: (x, y) => Math.pow(Math.abs(x) / 0.0290, 4) + Math.pow(Math.abs(y) / 0.0260, 4) < 1 }));
    ex(R, RB, [[0.4270, -0.0210, 0.006], [0.4390, -0.0220, 0.004], [0.4410, -0.1240, 0.006], [0.4270, -0.1240, 0.008]], -0.0208, 0.0208, { r: 0.0020, segs: 2 }); // butt pad
    for (let i = 0; i < 14; i++) { const y = -0.030 - i * 0.0066; ex(R, RB, [[0.4404, y, 0.0002], [0.4418, y, 0.0002], [0.4418, y - 0.0030, 0.0002], [0.4404, y - 0.0030, 0.0002]], -0.0180, 0.0180, { r: 0.0002, segs: 1, wear: 0.3 }); } // pad grip ridges
    for (const y of [-0.036, -0.108]) R.screw(SB, [0, y, 0.4412], 0.0028, { axis: 'z', slot: 90 });
    // ------------------------------------------------------------ markings: barrel flats + action
    barrels.quad(MK, [0, 0.01302, -0.20], qw(0.004, 0.75), 0.004, row(0, 0.75), { r: [-90, 0, 90] });
    R.quad(MK, [0.02255, -0.012, -0.035], qw(0.004, 0.2), 0.004, row(1, 0.2), { r: [0, 90, 0] });
    K.socket('muzzle', 'barrels', [0, 0, -0.509]); K.socket('eject', 'barrels', [0.0, 0.012, 0.02]);
    K.socket('sightRear', 'root', [0, 0.0335, 0.125]); K.socket('sightFront', 'barrels', [0, 0.0143, -0.499]);
    return { length: 0.94, sightHeight: 0.0205, rearSightZ: 0.03, frontSightZ: -0.499 };
  },
};
