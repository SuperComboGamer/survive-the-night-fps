// Remington 870 (12 gauge pump) — hard-surface rebuild (hs-kit). Gun-local metres: -Z = muzzle, +Y up, +X right, origin = bore axis at the breech face.
// REFERENCE (mm): overall 1010, barrel 457 (18"), 6 + 1 rounds, receiver 30.4 wide x 60 tall (milled, blued), bore 18.5 (12 ga), magazine tube OD 23.8 at 24.5 below
//   the bore, pump travel 92, forend 182 long with 10 circumferential grooves, stock length of pull ~ 355, black recoil pad 24 thick with white-line spacer,
//   trigger plate 94 long (black alloy), cross-bolt safety behind the guard, slide-release lever ahead of it (left), bead sight 12 above the bore.
// Real ports are CUT: ejection port in the right wall (pocket with the bolt visible), loading port in the belly (shell carrier + latches visible).
// Bones: pump (forend + action bars), bolt, carrier, trigger, round (shell waiting in the tube).
import { roundPoly, arcPts, bezPts, DEG } from '../geo.js';
import { rng, circle, roundOpen, insideTest } from '../hs-kit.js';

const ST = 'm870Steel', BL = 'm870Blue', AL = 'm870Alloy', W = 'm870Wood', RB = 'rubber', BR = 'brassPolished', HU = 'shellHull', BO = 'bore', MK = 'marks:remington870', WH = 'dotWhite', BP = 'brass';
const Z6 = [0, 0, 0, 0, 0, 0];
const DRAWN = [0.03, -0.22, 0.05, -40, 12, -22];
const PUMP = 0.092;
const RG = [-0.09, 0.08, -0.18, 14, -10, -58], RG2 = [-0.09, 0.082, -0.176, 15, -10, -59]; // shell-loading presentation: gun pushed out, rolled so the loading port faces the camera

export default {
  id: 'remington870',
  handling: {
    hip: { p: [0.1, -0.115, -0.17], r: [0.8, 2.2, 0] }, eye: 0.14, adsOffset: [0, -0.002, 0], sprint: { p: [0.05, -0.12, -0.19], r: [10, 48, 35] },
    pivot: [0, -0.07, 0.50], animPivot: [0, -0.03, 0.05], wall: { p: [0, -0.03, 0.08], r: [28, 12, -12] },
    shoulderR: [0.14, -0.22, 0.13], shoulderL: [-0.2, -0.26, 0.04], poleR: [0.9, -0.7, 0.2], poleL: [-0.45, -1, 0.1],
    hands: { R: { f: 'gripR', pose: 'rifleGrip' }, L: { f: 'pumpL', pose: 'pump' } },
    propHold: { shell: { p: [0, 0.002, -0.05], r: [0, 0, 0] } }, // shell lies along the fingers, crimp end past the fingertips (visible, thumb pushes the base)
    frames: {
      gripR: { part: 'root', p: [0.0225, -0.0560, 0.2380], fd: [0, -0.5, -0.87], pn: [-1, 0, 0] },
      pumpL: { part: 'pump', p: [-0.002, -0.0600, -0.170], fd: [0.9, 0.14, -0.4], pn: [0.05, 1, 0.1] },
      portL: { part: 'root', p: [-0.004, -0.075, 0.100], fd: [0.15, 0.3, -0.94], pn: [0.1, 0.95, 0.3] }, // palm up under the port, shell along the fingers
    },
    parts(rig, st) { rig.scale('round', 1); },
    clips: {
      fire: { dur: 0.1, tracks: { trigger: [[0, [0, 0, 0, 12, 0, 0]], [0.1, Z6, 'out']] } },
      pump: { dur: 0.52, events: [[0.02, 'snd', 'pumpBack'], [0.14, 'eject'], [0.3, 'snd', 'pumpFwd']], tracks: {
        pump: [[0, [0, 0, 0]], [0.16, [0, 0, PUMP], 'io'], [0.2, [0, 0, PUMP]], [0.36, [0, 0, 0], 'io']], bolt: [[0, [0, 0, 0]], [0.16, [0, 0, PUMP], 'io'], [0.2, [0, 0, PUMP]], [0.36, [0, 0, 0], 'io']],
        carrier: [[0.12, Z6], [0.18, [0, 0, 0, 16, 0, 0], 'out'], [0.26, Z6, 'in']],
        gun: [[0, Z6], [0.14, [0.002, -0.004, 0.006, -1.5, 0.5, 1.5], 'out'], [0.3, [0.0, 0.002, -0.004, 1.2, 0, -0.6], 'io'], [0.52, Z6, 'io']] } },
      dry: { dur: 0.14, tracks: { trigger: [[0, [0, 0, 0, 12, 0, 0]], [0.14, Z6, 'out']] } },
      draw: { dur: 0.55, events: [[0.0, 'snd', 'draw']], tracks: { gun: [[0, DRAWN], [0.55, Z6, 'out3']] } },
      holster: { dur: 0.32, tracks: { gun: [[0, Z6], [0.32, DRAWN, 'in']] } },
      firstDraw: { dur: 1.05, events: [[0.0, 'snd', 'draw'], [0.52, 'snd', 'pumpBack'], [0.74, 'snd', 'pumpFwd']], tracks: {
        gun: [[0, DRAWN], [0.45, [0, 0.01, 0, 2, 4, 6], 'out3'], [1.05, Z6, 'io']],
        pump: [[0.48, [0, 0, 0]], [0.62, [0, 0, PUMP], 'io'], [0.66, [0, 0, PUMP]], [0.8, [0, 0, 0], 'io']], bolt: [[0.48, [0, 0, 0]], [0.62, [0, 0, PUMP], 'io'], [0.66, [0, 0, PUMP]], [0.8, [0, 0, 0], 'io']] } },
      reloadStart: { dur: 0.38, tracks: {
        gun: [[0, Z6], [0.38, RG, 'io']],
        L: [[0, { f: 'rest' }], [0.38, { c: [-0.13, -0.36, -0.24], fd: [0.3, 0.4, -0.85], pn: [0.2, -0.9, 0.2], pose: 'pinch' }, 'io']], holdL: [[0, ''], [0.3, 'shell']] } },
      reloadShell: { scale: 0.818, dur: 0.55, events: [[0.3, 'snd', 'shellIn'], [0.33, 'shell']], tracks: {
        gun: [[0, RG], [0.3, RG2, 'io'], [0.36, RG, 'out'], [0.55, RG]],
        carrier: [[0.18, Z6], [0.24, [0, 0, 0, 14, 0, 0], 'out'], [0.36, Z6, 'in']],
        holdL: [[0, 'shell'], [0.33, ''], [0.42, 'shell']],
        L: [[0, { c: [-0.13, -0.36, -0.24], fd: [0.3, 0.4, -0.85], pn: [0.2, -0.9, 0.2], pose: 'pinch' }], [0.2, { f: 'portL', p: [0, -0.03, 0.02], pose: 'pinch' }, 'out'], [0.32, { f: 'portL', pose: 'pinch' }, 'in'], [0.36, { f: 'portL', p: [0, 0, -0.01], pose: 'slap' }, 'out'], [0.55, { c: [-0.13, -0.36, -0.24], fd: [0.3, 0.4, -0.85], pn: [0.2, -0.9, 0.2], pose: 'pinch' }, 'io']] } },
      reloadEnd: { dur: 0.4, tracks: { gun: [[0, RG], [0.4, Z6, 'io']], holdL: [[0, 'shell'], [0.05, '']], L: [[0, { c: [-0.13, -0.36, -0.24], fd: [0.3, 0.4, -0.85], pn: [0.2, -0.9, 0.2], pose: 'pinch' }], [0.4, { f: 'rest' }, 'io']] } },
      reloadEndPump: { dur: 0.85, events: [[0.42, 'snd', 'pumpBack'], [0.64, 'snd', 'pumpFwd']], tracks: {
        gun: [[0, RG], [0.38, Z6, 'io'], [0.5, [0.002, -0.004, 0.006, -1.5, 0.5, 1.5], 'out'], [0.85, Z6, 'io']], holdL: [[0, 'shell'], [0.05, '']],
        L: [[0, { c: [-0.13, -0.36, -0.24], fd: [0.3, 0.4, -0.85], pn: [0.2, -0.9, 0.2], pose: 'pinch' }], [0.36, { f: 'rest' }, 'io']],
        pump: [[0.38, [0, 0, 0]], [0.52, [0, 0, PUMP], 'io'], [0.56, [0, 0, PUMP]], [0.7, [0, 0, 0], 'io']], bolt: [[0.38, [0, 0, 0]], [0.52, [0, 0, PUMP], 'io'], [0.56, [0, 0, PUMP]], [0.7, [0, 0, 0], 'io']] } },
    },
  },
  build(K, M) {
    M.util();
    M.marks('remington870', 1024, 512, (g) => {
      g.textBaseline = 'middle'; g.font = 'italic bold 46px "Times New Roman", serif'; g.fillText('Remington.', 10, 32); g.font = 'bold 34px "Arial", sans-serif'; g.fillText('12 GA. 2-3/4 & 3 IN. CYL. BORE', 10, 96); g.fillText('RS 0214 88M', 10, 160);
      g.font = 'italic bold 40px "Times New Roman", serif'; g.fillText('Model 870 Wingmaster', 10, 224); g.font = 'bold 34px "Arial", sans-serif'; g.fillText('REMINGTON ARMS CO. ILION N.Y.', 10, 288); g.fillText('FIRE  ●  SAFE', 10, 352); g.fillText('SPECIAL STEEL  PROOF', 10, 416); g.fillText('MADE IN U.S.A.', 10, 480);
    }, { color: 0x0d0d0e, rough: 0.7, metal: 0.4 });
    const row = (i, u1) => [0, 1 - (i + 1) / 8 + 0.004, u1, 1 - i / 8 - 0.004]; const qw = (h, u1) => h * (u1 * 1024 / 64) * 0.98;
    const rnd = rng(870), jr = (a) => (rnd() * 2 - 1) * a;
    const R = K.root;
    const pump = K.part('pump', { pivot: [0, -0.03, -0.16] }), bolt = K.part('bolt', { pivot: [0, 0, 0.02] }), carrier = K.part('carrier', { pivot: [0, -0.02, 0.105] }), trigger = K.part('trigger', { pivot: [0, -0.04, 0.12] }), round = K.part('round', { pivot: [0, -0.0245, 0.0] });
    const pinX = (P, mat, y, z, rad, xa, xb) => { for (const x of [xa, xb]) { const s = Math.sign(x); P.rlathe(mat, [x, y, z], [[0, -0.0004], [rad, -0.0004, 0.0003], [rad, 0.0002, 0.0002], [rad * 0.7, 0.0007], [0, 0.0008]], { axis: s > 0 ? 'x' : '-x', seg: 10, sharp: 60 }); } };

    // ------------------------------------------------------------ RECEIVER: milled block, radiused crown; sections along z carry the CUT ports (right ejection port, belly loading port)
    const crown = (hx, ys, yc, n = 12) => { const c = (hx * hx + ys * ys - yc * yc) / (2 * (ys - yc)), R0 = yc - c; const a0 = Math.atan2(ys - c, hx), a1 = Math.PI - a0; const o = []; for (let k = 1; k < n; k++) { const a = a0 + (a1 - a0) * k / n; o.push([Math.cos(a) * R0, c + Math.sin(a) * R0]); } return o; };
    const HX = 0.0152, YB = -0.0370, YS = 0.0162, YC = 0.0232, DP = 0.0050; // half width, bottom, shoulder, crown; wall thickness of the pocket floor
    const recSec = (rn, bn) => { const pts = [[-HX, YB, 0.004]]; if (bn) pts.push([-0.0120, YB, 0.0006], [-0.0120, YB + 0.0060, 0.0006], [0.0120, YB + 0.0060, 0.0006], [0.0120, YB, 0.0006]); pts.push([HX, YB, 0.004]);
      if (rn) pts.push([HX, -0.0080, 0.0006], [HX - DP, -0.0080, 0.0006], [HX - DP, 0.0140, 0.0006], [HX, 0.0140, 0.0006]); pts.push([HX, YS, 0.002], ...crown(HX, YS, YC), [-HX, YS, 0.002]); return roundPoly(pts, 8); };
    const seg = (z0, z1, rn, bn, o = {}) => R.rextZ(BL, recSec(rn, bn), z0, z1, { r0: 0, r1: 0, crease: 60, wearWalls: 0.3, ...o });
    seg(-0.012, 0.011, false, false, { r0: 0.0010 }); seg(0.011, 0.025, true, false); seg(0.025, 0.089, true, true); seg(0.089, 0.111, false, true); seg(0.111, 0.168, false, false);
    const sec2 = (hx, yb, ys, yc) => roundPoly([[-hx, yb, 0.004], [hx, yb, 0.004], [hx, ys, 0.002]].concat(crown(hx, ys, yc)).concat([[-hx, ys, 0.002]]), 8);
    R.polyLoft(BL, [{ z: 0.168, pts: sec2(HX, YB, YS, YC) }, { z: 0.180, pts: sec2(0.0152, -0.0370, 0.0150, 0.0214) }, { z: 0.188, pts: sec2(0.0150, -0.0370, 0.0120, 0.0178) }, { z: 0.194, pts: sec2(0.0146, -0.0368, 0.0060, 0.0110) }, { z: 0.1965, pts: sec2(0.0138, -0.0360, 0.0010, 0.0045) }], { N: 64, wear: 0.5, wearK: 0.001 });
    // pocket interiors: dark floors, ejection-port + loading-port rims, bolt guide rails
    R.rb(BO, [HX - DP - 0.0006, 0.0030, 0.0500], [0.0006, 0.0220, 0.0780], { r: 0.0002, seg: 1, wear: 0 }); R.rb(BO, [0.0, YB + 0.0066, 0.0680], [0.0236, 0.0006, 0.0860], { r: 0.0002, seg: 1, wear: 0 });
    R.rb(BL, [0.0152, 0.0146, 0.0500], [0.0010, 0.0016, 0.0800], { r: 0.0005, seg: 1, wear: 1.3 }); R.rb(BL, [0.0152, -0.0084, 0.0500], [0.0010, 0.0016, 0.0800], { r: 0.0005, seg: 1, wear: 1.3 }); // port rims (bright edges)
    for (const sx of [-1, 1]) R.rb(BL, [sx * 0.0122, YB - 0.0002, 0.0680], [0.0016, 0.0014, 0.0880], { r: 0.0005, seg: 1, wear: 1.3 });
    // milled top: 13 fine longitudinal ridges (matted sight plane) and the receiver ring / barrel shoulder
    for (let i = 0; i < 10; i++) R.rb(BL, [-0.0054 + i * 0.0012, YC + 0.0001 - Math.pow((-0.0054 + i * 0.0012) / 0.0150, 2) * 0.0009, 0.0900], [0.00062, 0.0007, 0.1560], { r: 0.0002, seg: 1, wear: 0.15 });
    R.rlathe(BL, [0, 0, 0], [[0.0102, -0.0300], [0.0126, -0.0300, 0.0005], [0.0126, -0.0120, 0.0005], [0.0102, -0.0120]], { axis: 'z', seg: 40 }); // barrel extension ring
    for (const [z, y] of [[0.130, -0.018], [0.160, -0.024]]) for (const sx of [-1, 1]) pinX(R, BL, y, z, 0.0024, sx * HX, 0); // trigger plate pins (both sides)
    R.quad(MK, [-0.01527, -0.0040, 0.0900], qw(0.0062, 0.62), 0.0062, row(0, 0.26), { r: [0, -90, 0] }); R.quad(MK, [-0.01527, -0.0130, 0.0900], qw(0.0040, 0.36), 0.0040, row(3, 0.66), { r: [0, -90, 0] });
    R.quad(MK, [-0.01527, -0.0225, 0.0900], qw(0.0034, 0.28), 0.0034, row(2, 0.28), { r: [0, -90, 0] });
    // ------------------------------------------------------------ bolt (in the port) + extractor + carrier (lifter) + shell latches; trigger plate, guard, safety, slide release
    bolt.rlathe(ST, [0.0040, 0.0040, 0.0160], [[0, -0.0060], [0.0068, -0.0060, 0.0006], [0.0068, 0.0770, 0.0008], [0, 0.0770]], { axis: 'z', seg: 26, wear: 1.5 });
    bolt.rb(ST, [0.0090, 0.0040, 0.0420], [0.0040, 0.0100, 0.0500], { r: 0.0007, seg: 2, wear: 1.5 }); bolt.rb(ST, [0.0125, 0.0050, 0.0100], [0.0030, 0.0080, 0.0120], { r: 0.0006, seg: 1, wear: 1.5 }); bolt.rb(BO, [0.0090, 0.0090, 0.0500], [0.0060, 0.0010, 0.0300], { r: 0.0002, seg: 1, wear: 0 });
    carrier.rext(ST, roundPoly([[0.024, -0.034], [0.110, -0.030], [0.110, -0.022], [0.030, -0.028]]), -0.011, 0.011, { r: 0.0008, seg: 2, wear: 1.3 });
    for (const sx of [-1, 1]) R.rb(BL, [sx * 0.0112, -0.0330, 0.0300], [0.0016, 0.0060, 0.0100], { r: 0.0005, seg: 1, wear: 1.5 }); // shell latches
    R.rext(AL, roundPoly([[0.102, -0.036], [0.196, -0.036], [0.200, -0.046, 0.004], [0.106, -0.046, 0.004]]), -0.013, 0.013, { r: 0.0012, seg: 2 }); // trigger plate (black alloy)
    R.rext(AL, roundPoly([[0.106, -0.044], [0.100, -0.060, 0.008], [0.112, -0.076, 0.012], [0.172, -0.078, 0.008], [0.190, -0.050], [0.178, -0.052, 0.004], [0.168, -0.066, 0.004], [0.118, -0.066, 0.008], [0.112, -0.058, 0.004], [0.116, -0.044]]), -0.0062, 0.0062, { r: 0.0009, seg: 2 }); // guard
    R.rlathe(BL, [0, -0.041, 0.166], [[0, -0.0150], [0.0031, -0.0150, 0.0004], [0.0031, 0.0150, 0.0004], [0, 0.0150]], { axis: 'x', seg: 18 }); // cross-bolt safety
    R.rlathe(HU, [-0.0146, -0.041, 0.166], [[0, 0], [0.0034, 0, 0.0003], [0.0034, 0.0018], [0, 0.0018]], { axis: '-x', seg: 18 }); // red band (safety pushed right = FIRE)
    R.rext(BL, roundPoly([[0.092, -0.036], [0.104, -0.036], [0.104, -0.050, 0.002], [0.094, -0.048]]), -0.0162, -0.0142, { r: 0.0004, seg: 1, wear: 1.5 }); // slide release (left)
    R.quad(MK, [-0.0100, -0.0500, 0.1660], qw(0.0022, 0.36), 0.0022, row(5, 0.36), { r: [90, 0, 0] });
    trigger.rext(BL, roundPoly([[0.136, -0.044], [0.130, -0.056, 0.004], [0.133, -0.068, 0.002], [0.139, -0.066, 0.002], [0.141, -0.046]]), -0.0036, 0.0036, { r: 0.0007, seg: 2, wear: 1.5 });
    // ------------------------------------------------------------ barrel + bead + barrel ring; magazine tube + cap + swivel
    R.rlathe(BL, [0, 0, 0], [[0.00925, -0.4575], [0.0100, -0.4575, 0.0005], [0.0102, -0.4560], [0.0102, -0.0300], [0.0118, -0.0280], [0.0118, -0.012]], { axis: 'z', seg: 40, wear: 1.5 });
    R.rlathe(BO, [0, 0, 0], [[0.00925, -0.0200], [0.00925, -0.4530], [0, -0.4530]], { axis: 'z', seg: 24 });
    R.rlathe(BR, [0, 0.0106, -0.450], [[0, 0], [0.0011, 0, 0.0002], [0.0011, 0.0016], [0.0004, 0.0027], [0, 0.0029]], { axis: 'y', seg: 14 }); R.rb(BL, [0, 0.0100, -0.450], [0.0050, 0.0010, 0.0080], { r: 0.0004, seg: 1 }); // bead + base
    R.rb(BL, [0, -0.012, -0.392], [0.0200, 0.0360, 0.0160], { r: 0.0025, seg: 2, wear: 1.3 }); pinX(R, BL, -0.012, -0.392, 0.0028, 0.0100, -0.0100); // barrel ring (clamp) with screw heads
    R.rlathe(BL, [0, -0.0245, 0], [[0, -0.418], [0.0100, -0.418, 0.0012], [0.0126, -0.415, 0.0012], [0.0126, -0.398], [0.0119, -0.396], [0.0119, -0.012]], { axis: 'z', seg: 36, wear: 1.4 }); // mag tube + cap
    R.knurl(BL, [0, -0.0245, -0.4070], 0.0127, 0.0090, { axis: 'z', n: 64, depth: 0.0004 }); // knurled magazine cap
    R.rlathe(BL, [0, -0.0368, -0.410], [[0, 0], [0.0028, 0, 0.0004], [0.0028, 0.006], [0, 0.006]], { axis: '-y', seg: 14 }); R.torus(BL, [0, -0.047, -0.410], 0.0075, 0.0014, { r: [0, 90, 0], seg: 10, tube: 24 }); // swivel stud + loop
    R.quad(MK, [-0.01025, 0.0, -0.10], qw(0.0045, 0.62), 0.0045, row(1, 0.62), { r: [0, -90, 0] });
    // ------------------------------------------------------------ pump: walnut forend (10 real grooves) + action bars + end cap
    const fe = [[-0.262, 0.0205, 0.018, 0.024], [-0.256, 0.0225, 0.020, 0.028]];
    for (let i = 0; i < 10; i++) { const zc = -0.236 + i * 0.0142; for (const [dz, d] of [[-0.0046, 0], [-0.0032, 0.0006], [-0.0016, 0.0014], [0.0, 0.0018], [0.0016, 0.0014], [0.0032, 0.0006], [0.0046, 0]]) fe.push([zc + dz, 0.0225 - d, 0.020, 0.028 - d * 1.25]); }
    fe.push([-0.092, 0.0225, 0.020, 0.028], [-0.080, 0.0205, 0.018, 0.024]);
    pump.loft(W, fe.map(([z, a, bt, bb]) => ({ c: [0, -0.029, z], a, bt, bb, n: 2.6 })), { K: 36, wear: 0.4 });
    pump.rlathe(BL, [0, -0.0245, -0.2652], [[0.0118, -0.0033], [0.0127, -0.0033, 0.0008], [0.0127, 0.0033, 0.0008], [0.0118, 0.0033]], { axis: 'z', seg: 36, wear: 1.3 }); // forend nut
    for (const sx of [-1, 1]) { pump.rb(ST, [sx * 0.0122, -0.020, -0.0200], [0.0022, 0.0050, 0.1400], { r: 0.0007, seg: 1, wear: 1.3 }); pump.rb(BL, [sx * 0.0122, -0.0245, -0.0870], [0.0040, 0.0140, 0.0100], { r: 0.0008, seg: 1 }); } // action bars + sleeve block
    // ------------------------------------------------------------ stock: walnut, pistol grip, checkering panels (real pyramids), recoil pad with spacer, swivel
    R.profLoftB(W, { z0: 0.190, z1: 0.534, steps: 70, K: 34, wear: 0.4,
      top: [[0.190, 0.0105], [0.21, 0.0085], [0.24, 0.0055], [0.28, 0.0015], [0.33, -0.004], [0.534, -0.018]],
      bot: [[0.190, -0.032], [0.21, -0.038], [0.235, -0.058], [0.26, -0.088], [0.278, -0.098], [0.295, -0.094], [0.315, -0.072], [0.36, -0.082], [0.534, -0.132]],
      w: [[0.190, 0.0165], [0.23, 0.0172], [0.28, 0.0168], [0.34, 0.0195], [0.534, 0.0220]], n: [[0.19, 2.5], [0.28, 2.2], [0.534, 2.35]] });
    R.rext(AL, roundPoly([[0.2735, -0.0965, 0.002], [0.2835, -0.0985, 0.002], [0.2835, -0.1010, 0.002], [0.2735, -0.1010, 0.002]]), -0.0140, 0.0140, { r: 0.0006, seg: 1, rot: [0, 0, 0] }); // grip cap plate
    R.rlathe(AL, [0, -0.1000, 0.279], [[0, 0], [0.0138, 0, 0.0008], [0.0145, 0.0035, 0.0008], [0, 0.0035]], { axis: '-y', seg: 32, r: [16, 0, 0] }); R.rlathe(BL, [0, -0.1035, 0.279], [[0, 0], [0.0030, 0], [0.0030, 0.0006], [0, 0.0006]], { axis: '-y', seg: 14, r: [16, 0, 0] }); // grip cap + bolt head
    const gripPanel = roundPoly([[0.216, -0.020, 0.005], [0.258, -0.024, 0.005], [0.274, -0.078, 0.005], [0.240, -0.074, 0.005]]); const gTest = insideTest(gripPanel, 0.0032);
    for (const sx of [-1, 1]) {
      R.rext(W, gripPanel, sx > 0 ? 0.0150 : -0.0175, sx > 0 ? 0.0175 : -0.0150, { r: 0.0004, seg: 1, wear: 0.4 });
      R.checker(W, { map: (u, v) => ({ p: [sx * 0.0175, v, u], n: [sx, 0, 0] }), u0: 0.210, u1: 0.280, v0: -0.082, v1: -0.016, pitch: 0.00160, h: 0.00040, alpha: 45, inside: (u, v) => gTest(u, v), seed: sx + 3, wear: 0.9 });
    }
    R.rext(WH, roundPoly([[0.5340, -0.016, 0.004], [0.5362, -0.016, 0.004], [0.5362, -0.134, 0.006], [0.5340, -0.134, 0.006]]), -0.0219, 0.0219, { r: 0.0004, seg: 1, wear: 0.3 }); // white line spacer
    R.rext(RB, roundPoly([[0.536, -0.016, 0.008], [0.560, -0.015, 0.006], [0.562, -0.136, 0.008], [0.536, -0.134, 0.008]]), -0.0222, 0.0222, { r: 0.0030, seg: 3, wear: 0.6 }); // recoil pad
    for (let i = 0; i < 17; i++) R.rb(RB, [0, -0.0250 - i * 0.0064, 0.5628], [0.0400, 0.0028, 0.0016], { r: 0.0009, seg: 1, wear: 0 }); // pad ribs
    R.rlathe(BL, [0, -0.1170, 0.4600], [[0, 0], [0.0030, 0, 0.0004], [0.0030, 0.0080, 0.0004], [0, 0.0080]], { axis: '-y', seg: 14 }); R.torus(BL, [0, -0.1250, 0.4600], 0.0075, 0.0014, { r: [0, 90, 0], seg: 10, tube: 24 });
    // a shell waiting in the carrier (visible through the loading port) — the tube is never shown empty unless mag 0
    round.lathe(HU, [0, -0.0245, 0], [[0, -0.060], [0.0094, -0.0595], [0.0101, -0.057], [0.0101, -0.012], [0, -0.012]], { axis: 'z', seg: 20 });
    round.lathe(BP, [0, -0.0245, 0], [[0.0101, -0.0125], [0.0106, -0.012], [0.0106, 0.0], [0, 0.0]], { axis: 'z', seg: 20 });
    K.socket('muzzle', 'root', [0, 0, -0.458]); K.socket('eject', 'root', [0.016, 0.004, 0.05]);
    K.socket('sightRear', 'root', [0, 0.0345, 0.192]); K.socket('sightFront', 'root', [0, 0.0139, -0.450]);
    return { length: 1.01, sightHeight: 0.0262, rearSightZ: 0.18, frontSightZ: -0.45 };
  },
};
