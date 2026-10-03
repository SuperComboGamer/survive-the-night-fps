// M1911A1 (.45 ACP) — hard-surface rebuild (hs-kit): real fillets on every edge, cut slide serrations, real double-diamond checkering (pyramids),
// separate slide / frame / barrel / bushing / plug / hammer / grip safety / thumb safety / slide stop / mag catch / trigger / magazine, pins, screws.
// Gun-local: -Z = muzzle, +Y up, +X right, bore axis y = 0, breech face z = 0.  Grip / magazine tilt 18 deg.
// REFERENCE (mm, US Ordnance drawings / Colt M1911A1): overall length 216, height 137, width over grips 32, slide 190.5 x 23.4 (top flat 11 wide),
//   barrel 127 (5"), sight radius 162, sight height above the bore 24.5, grip angle 18 deg, mag 7 rd (+1), 1.1 kg, slide travel 34,
//   trigger pull 9.5 wide x 7 travel, grip panels 45 x 66 (double diamond, 20 LPI), serrations 15 x 1.95 pitch, hammer travel 54 deg.
// Bones: slide, barrel (tilts on its link), hammer, trigger, safety, slideStop, magCatch, gripSafety, mag, round.
import { roundPoly, arcPts, bezPts, DEG } from '../geo.js';
import { rng, circle, roundOpen, insideTest } from '../hs-kit.js';

const S = 'm1911Park', BL = 'm1911Blue', MG = 'm1911Mag', WD = 'm1911Wood', BR = 'brass', CU = 'copper', DOT = 'dotWhite', BO = 'bore', MK = 'marks:m1911';
const GRIP = -18; // grip / magazine tilt (deg about X; top forward)
const Z6 = [0, 0, 0, 0, 0, 0];
const DRAWN = [0.02, -0.21, 0.07, -58, 10, -32];
export default {
  id: 'm1911',
  handling: {
    hip: { p: [0.108, -0.1, -0.385], r: [0.5, 2.5, 0] }, eye: 0.42, sprint: { p: [0.1, -0.12, -0.28], r: [-30, 34, 30] },
    pivot: [0, -0.055, 0.06], wall: { p: [-0.02, -0.02, 0.12], r: [30, 8, -8] },
    shoulderR: [0.17, -0.25, 0.08], shoulderL: [-0.17, -0.25, 0.08], poleR: [0.6, -1, 0.2], poleL: [-0.6, -1, 0.2],
    hands: { R: { f: 'gripR', pose: 'pistolGrip' }, L: { f: 'supportL', pose: 'pistolSupport' } },
    sprintHands: { L: { c: [-0.16, -0.46, -0.12], fd: [0.2, -0.6, -0.75], pn: [0.8, 0, 0.3], pose: 'relaxed' } },
    frames: {
      gripR: { part: 'root', p: [0.0192, -0.0585, 0.0585], fd: [0, -0.31, -0.95], pn: [-1, 0, 0] },
      supportL: { part: 'root', p: [-0.0300, -0.0560, 0.0450], fd: [0.25, -0.38, -0.89], pn: [1, 0.2, 0.08] },
      magL: { part: 'mag', p: [-0.004, -0.1255, 0.0560], fd: [0.12, 0.45, -0.88], pn: [0.1, 1, 0.12] },
      slideL: { part: 'slide', p: [0.0, 0.034, 0.0470], fd: [1, -0.25, 0.05], pn: [0, -1, 0] },
    },
    parts(rig, st) {
      if (st.locked) { rig.set('slide', 0, 0, 0.034); rig.set('slideStop', 0, 0, 0, -0.12, 0, 0); rig.set('barrel', 0, 0, 0, 0.023, 0, 0); }
      rig.set('safety', 0, 0, 0, -0.3, 0, 0); rig.set('gripSafety', 0, 0, 0, -0.06, 0, 0);
      rig.scale('round', st.mag > 1 ? 1 : 0);
    },
    clips: {
      fire: { dur: 0.1, events: [[0.011, 'eject']], tracks: {
        slide: [[0, [0, 0, 0]], [0.012, [0, 0, 0.034], 'out'], [0.022, [0, 0, 0.034]], [0.07, [0, 0, 0], 'in']],
        hammer: [[0, [0, 0, 0, -54, 0, 0]], [0.008, [0, 0, 0, -54, 0, 0]], [0.018, [0, 0, 0, 5, 0, 0], 'out'], [0.03, Z6]],
        barrel: [[0, Z6], [0.012, [0, 0, 0, 1.3, 0, 0], 'out'], [0.058, [0, 0, 0, 1.3, 0, 0]], [0.07, Z6, 'in']],
        trigger: [[0, [0, 0, 0.0028]], [0.06, [0, 0, 0.0028]], [0.1, [0, 0, 0], 'out']] } },
      fireLast: { dur: 0.1, events: [[0.011, 'eject']], tracks: {
        slide: [[0, [0, 0, 0]], [0.012, [0, 0, 0.034], 'out'], [0.1, [0, 0, 0.034]]],
        slideStop: [[0, Z6], [0.016, [0, 0, 0, -7, 0, 0], 'out']],
        hammer: [[0, [0, 0, 0, -54, 0, 0]], [0.008, [0, 0, 0, -54, 0, 0]], [0.018, [0, 0, 0, 5, 0, 0], 'out'], [0.03, Z6]],
        barrel: [[0, Z6], [0.012, [0, 0, 0, 1.3, 0, 0], 'out']],
        trigger: [[0, [0, 0, 0.0028]], [0.06, [0, 0, 0.0028]], [0.1, [0, 0, 0], 'out']] } },
      dry: { dur: 0.14, tracks: { trigger: [[0, [0, 0, 0.0028]], [0.14, [0, 0, 0], 'out']] } },
      draw: { dur: 0.42, events: [[0.0, 'snd', 'draw']], tracks: { gun: [[0, DRAWN], [0.42, Z6, 'out3']] } },
      holster: { dur: 0.28, tracks: { gun: [[0, Z6], [0.28, DRAWN, 'in']] } },
      firstDraw: { dur: 0.95, events: [[0.0, 'snd', 'draw'], [0.56, 'snd', 'slide']], tracks: {
        // rack presentation: pistol brought in toward the centre line, pushed out and rolled right so the slide top faces the incoming
        // left hand (keeps the left forearm low in the frame instead of filling it)
        gun: [[0, DRAWN], [0.34, [-0.03, 0.0, -0.05, 6, -14, 18], 'out3'], [0.5, [-0.036, 0.004, -0.056, 8, -16, 24]], [0.62, [-0.03, 0.0, -0.05, 5, -12, 18], 'out'], [0.95, Z6, 'io']],
        slide: [[0.46, [0, 0, 0]], [0.53, [0, 0, 0.034], 'out'], [0.555, [0, 0, 0.034]], [0.585, [0, 0, 0], 'in']],
        L: [[0, { f: 'rest' }], [0.3, { f: 'rest' }], [0.44, { f: 'slideL', pose: 'magGrip' }, 'io'], [0.53, { f: 'slideL', p: [0, 0, 0.0], pose: 'magGrip' }], [0.6, { f: 'slideL', p: [0.01, 0.025, 0.04], pose: 'open' }, 'out'], [0.9, { f: 'rest' }, 'io']] } },
      reload: {
        scale: 1.032, dur: 1.55, events: [[0.02, 'snd', 'magout'], [0.62, 'snd', 'magdrop'], [0.99, 'snd', 'magin'], [1.0, 'magFill']],
        tracks: {
          gun: [[0, Z6], [0.2, [-0.035, 0.055, 0.02, 14, -14, -28], 'io'], [0.9, [-0.04, 0.06, 0.02, 16, -16, -32], 'io'], [1.02, [-0.04, 0.052, 0.024, 12, -14, -28], 'out'], [1.1, [-0.04, 0.056, 0.022, 14, -14, -28], 'io'], [1.55, Z6, 'io']],
          mag: [[0.0, Z6], [0.06, [0, -0.012, 0.004, 0, 0, 0], 'in'], [0.3, [0.02, -0.3, 0.1, 25, 0, 20], 'in'],
            [0.44, [0.04, -0.32, 0.12, -35, 10, 25], 'step'], [0.8, [0.002, -0.06, 0.016, -9, 0, 0], 'out'], [0.9, [0, -0.02, 0.0065, 0, 0, 0], 'io'], [1.0, Z6, 'in']],
          R: [[0, { f: 'rest' }], [0.05, { f: 'rest', pose: 'pistolGripMag' }], [0.14, { f: 'rest' }], [1.55, { f: 'rest' }]],
          L: [[0, { f: 'rest' }], [0.2, { c: [-0.14, -0.38, -0.22], fd: [0.3, -0.5, -0.8], pn: [0.8, 0.1, 0.3], pose: 'relaxed' }, 'in'],
            [0.44, { f: 'magL', pose: 'magGrip' }, 'step'], [1.0, { f: 'magL', pose: 'magGrip' }], [1.05, { f: 'magL', p: [0.0, 0.012, 0.004], pose: 'slap' }, 'out'], [1.14, { f: 'magL', p: [-0.01, -0.02, 0.01], pose: 'slap' }], [1.4, { f: 'rest' }, 'io']] } },
      reloadEmpty: {
        scale: 0.974, dur: 1.9, events: [[0.02, 'snd', 'magout'], [0.62, 'snd', 'magdrop'], [0.99, 'snd', 'magin'], [1.0, 'magFill'], [1.3, 'unlock'], [1.3, 'snd', 'slide']],
        tracks: {
          gun: [[0, Z6], [0.2, [-0.035, 0.055, 0.02, 14, -14, -28], 'io'], [0.9, [-0.04, 0.06, 0.02, 16, -16, -32], 'io'], [1.02, [-0.04, 0.052, 0.024, 12, -14, -28], 'out'], [1.18, [-0.02, 0.03, 0.012, 6, -8, -14], 'io'], [1.3, [-0.018, 0.028, 0.01, 5, -7, -12]], [1.34, [-0.018, 0.034, 0.02, 8, -7, -13], 'out'], [1.9, Z6, 'io']],
          mag: [[0.0, Z6], [0.06, [0, -0.012, 0.004, 0, 0, 0], 'in'], [0.3, [0.02, -0.3, 0.1, 25, 0, 20], 'in'],
            [0.44, [0.04, -0.32, 0.12, -35, 10, 25], 'step'], [0.8, [0.002, -0.06, 0.016, -9, 0, 0], 'out'], [0.9, [0, -0.02, 0.0065, 0, 0, 0], 'io'], [1.0, Z6, 'in']],
          slide: [[1.3, [0, 0, 0.034]], [1.335, [0, 0, 0], 'in']], slideStop: [[1.22, [0, 0, 0, -7, 0, 0]], [1.3, [0, 0, 0, 0, 0, 0], 'out']],
          R: [[0, { f: 'rest' }], [0.05, { f: 'rest', pose: 'pistolGripMag' }], [0.14, { f: 'rest' }], [1.16, { f: 'rest' }], [1.26, { f: 'rest', pose: 'pistolGripStop' }], [1.34, { f: 'rest' }], [1.9, { f: 'rest' }]],
          L: [[0, { f: 'rest' }], [0.2, { c: [-0.14, -0.38, -0.22], fd: [0.3, -0.5, -0.8], pn: [0.8, 0.1, 0.3], pose: 'relaxed' }, 'in'],
            [0.44, { f: 'magL', pose: 'magGrip' }, 'step'], [1.0, { f: 'magL', pose: 'magGrip' }], [1.05, { f: 'magL', p: [0.0, 0.012, 0.004], pose: 'slap' }, 'out'], [1.14, { f: 'magL', p: [-0.01, -0.02, 0.01], pose: 'slap' }], [1.5, { f: 'rest' }, 'io']] } },
    },
  },
  build(K, M) {
    M.util();
    M.marks('m1911', 1024, 512, (g) => {
      g.textBaseline = 'middle'; g.font = 'bold 40px "Courier New", monospace';
      g.fillText("COLT'S PT. F.A. MFG. CO.", 8, 32); g.fillText('HARTFORD, CT. U.S.A.', 8, 96); g.fillText('M1911 A1 U.S. ARMY', 8, 160); g.fillText('UNITED STATES PROPERTY', 8, 224);
      g.fillText('No. 1402217', 8, 288); g.font = 'bold 44px "Courier New", monospace'; g.fillText('P  △', 8, 352); g.font = 'bold 34px "Courier New", monospace'; g.fillText('S   HMS  ♠', 8, 416); g.fillText('CAL .45', 8, 480);
    }, { color: 0x0e0e0e, rough: 0.7, metal: 0.4 });
    const row = (i, u1 = 0.62) => [0.0, 1 - (i + 1) / 8 + 0.004, u1, 1 - i / 8 - 0.004];
    const qw = (h, u1) => h * (u1 * 1024 / 64) * 0.98; // quad width keeping the atlas aspect
    const rnd = rng(1911), jr = (a) => (rnd() * 2 - 1) * a;
    const F = K.root; // frame
    const slide = K.part('slide', { pivot: [0, 0, 0] }), barrel = K.part('barrel', { pivot: [0, 0, -0.118] }), hammer = K.part('hammer', { pivot: [0, -0.0205, 0.0560] }), trigger = K.part('trigger', { pivot: [0, -0.036, -0.012] });
    const safety = K.part('safety', { pivot: [-0.0118, -0.0165, 0.0515] }), stop = K.part('slideStop', { pivot: [-0.0118, -0.0205, -0.0215] }), mcatch = K.part('magCatch', { pivot: [-0.0118, -0.0425, 0.0115] });
    const gsafe = K.part('gripSafety', { pivot: [0, -0.0150, 0.0640] }), mag = K.part('mag', { pivot: [0, -0.0625, 0.0415] }), round = K.part('round', { parent: 'mag', pivot: [0, -0.0130, 0.0300] });
    const pinX = (P, mat, y, z, rad, xa, xb) => { for (const x of [xa, xb]) { const s = Math.sign(x); P.rlathe(mat, [x, y, z], [[0, -0.0003], [rad, -0.0003, 0.0003], [rad, 0.0002, 0.0002], [rad * 0.7, 0.0006], [0, 0.0007]], { axis: s > 0 ? 'x' : '-x', seg: 10, sharp: 60 }); } };

    // ------------------------------------------------------------ SLIDE: flat-topped section (R5.5 shoulders), sections along z (nose, body, ejection-port notch, serration field), all edges filleted
    const YT = 0.0178, sSec = (hx, yb, rt = 0.0055) => roundPoly([[-hx, yb, 0.0008], [hx, yb, 0.0008], [hx, YT, rt], [-hx, YT, rt]], 10);
    const HX = 0.0117, YB = -0.0125;
    slide.rextZ(S, sSec(HX, -0.0262), -0.1275, -0.1035, { holes: [circle(0, 0, 0.0099, 32), circle(0, -0.0178, 0.0066, 26)], r0: 0.0003, r1: 0, crease: 60, seg: 1 }); // nose: bushing + spring-plug holes (dark inside)
    slide.rextZ(S, sSec(HX, YB), -0.1035, -0.0270, { r0: 0, r1: 0, crease: 60 });
    slide.rextZ(S, sSec(HX, YB), -0.0270, -0.0215, { r0: 0, r1: 0, crease: 60 });
    const port = roundPoly([[-HX, YB, 0.0008], [HX, YB, 0.0008], [HX, -0.0010, 0.0006], [0.0058, -0.0010, 0.0008], [0.0058, YT, 0.0006], [-HX, YT, 0.0055]], 10); // A1 ejection port: notch through the right shoulder
    slide.rextZ(S, port, -0.0215, -0.0005, { r0: 0, r1: 0, crease: 60 });
    slide.rextZ(S, sSec(HX, YB), -0.0005, 0.0312, { r0: 0, r1: 0, crease: 60 });
    slide.rextZ(S, sSec(0.0110, YB), 0.0312, 0.0630, { r0: 0, r1: 0.0009, crease: 60 }); // serration field (recessed 0.7 mm), rear face rounded
    for (const sx of [-1, 1]) for (let i = 0; i < 15; i++) slide.rb(S, [sx * 0.01133, 0.0018, 0.0330 + i * 0.00195], [0.0006, 0.0206, 0.00098], { r: 0.00028, seg: 1, wear: 1.7 }); // 15 vertical serration ridges per side (cut grooves between)
    for (const sx of [-1, 1]) { slide.rb(BO, [sx * 0.01110, 0.0018, 0.0451], [0.0002, 0.0212, 0.0290], { r: 0.0001, seg: 1, wear: 0 }); } // groove floors: dark
    // port rim highlights (real edges), extractor, barrel hood seen through the port, ejector notch
    slide.rb(S, [0.0084, -0.0006, -0.0110], [0.0058, 0.0009, 0.0210], { r: 0.0004, seg: 1, wear: 1.5 }); slide.rb(S, [0.0086, 0.0035, -0.0216], [0.0056, 0.0140, 0.0008], { r: 0.0004, seg: 1, wear: 1.5 }); slide.rb(S, [0.0086, 0.0035, -0.0004], [0.0056, 0.0140, 0.0008], { r: 0.0004, seg: 1, wear: 1.5 });
    slide.rb(S, [0.0119, 0.0072, 0.0215], [0.0012, 0.0032, 0.0400], { r: 0.0004, seg: 1, wear: 1.6 }); slide.rb(BO, [0.0116, 0.0044, 0.0215], [0.0006, 0.0018, 0.0380], { r: 0.0002, seg: 1, wear: 0 });
    slide.rb(BO, [-0.0114, -0.0108, -0.0300], [0.0008, 0.0030, 0.0065], { r: 0.0004, seg: 1, wear: 0 }); // disassembly notch
    // rear face: firing pin stop plate, pin hole, retaining slot
    slide.rext(S, roundPoly([[-0.0165, 0.0110, 0.001], [0.0165, 0.0110, 0.001], [0.0165, -0.0100, 0.001], [-0.0165, -0.0100, 0.001]]), -0.0052, 0.0052, { r: 0.0005, seg: 1, p: [0, 0, 0.0636], rot: [0, 90, 0], wear: 1.2 }); // firing pin stop (thin plate on the rear face)
    slide.rlathe(BO, [0, 0, 0.0643], [[0, 0], [0.0011, 0], [0.0011, 0.0001], [0, 0.0001]], { axis: 'z', seg: 14 });
    // bushing + recoil spring plug (dished)
    slide.rlathe(S, [0, 0, -0.1244], [[0.0087, -0.0033], [0.0101, -0.0033, 0.0005], [0.0101, 0.0033, 0.0005], [0.0087, 0.0033]], { axis: 'z', seg: 40, wear: 1.6 }); // bushing ring
    slide.rb(S, [0.0, 0.0102, -0.1240], [0.0040, 0.0022, 0.0050], { r: 0.0005, seg: 1, wear: 1.6 }); // bushing lug
    slide.rlathe(S, [0, -0.0178, 0], [[0, -0.1257], [0.0042, -0.1264, 0.0006], [0.0067, -0.1273, 0.0006], [0.0067, -0.1080], [0, -0.1080]], { axis: 'z', seg: 28, wear: 1.5 }); // spring plug
    slide.rlathe(BO, [0, -0.0178, 0], [[0, -0.1262], [0.0030, -0.1262], [0.0030, -0.1257], [0, -0.1257]], { axis: 'z', seg: 12 }); // guide-rod dimple
    // sights (GI A1): dovetailed rear blade with square notch, staked front blade; white dots kept for aiming
    slide.rextZ(S, roundPoly([[-0.0062, 0.0176, 0.0004], [0.0062, 0.0176, 0.0004], [0.0062, 0.0249, 0.0006], [0.0017, 0.0249, 0.0003], [0.0017, 0.0205, 0.0002], [-0.0017, 0.0205, 0.0002], [-0.0017, 0.0249, 0.0003], [-0.0062, 0.0249, 0.0006]]), 0.0455, 0.0577, { r: 0.0004, seg: 1, wear: 1.7 });
    for (const sx of [-1, 1]) slide.rlathe(DOT, [sx * 0.0040, 0.0223, 0.05765], [[0, 0], [0.00105, 0], [0.00105, 0.0003], [0, 0.0003]], { axis: 'z', seg: 14 });
    slide.rext(S, roundPoly([[-0.1228, 0.0172], [-0.1150, 0.0172], [-0.1150, 0.0245, 0.0006], [-0.1180, 0.0248, 0.0008], [-0.1228, 0.0196, 0.001]]), -0.00150, 0.00150, { r: 0.0004, seg: 2, wear: 1.8 });
    slide.rlathe(DOT, [0, 0.0222, -0.1150], [[0, 0], [0.00095, 0], [0.00095, 0.0003], [0, 0.0003]], { axis: 'z', seg: 14 }); slide.rb(S, [0, 0.0170, -0.1190], [0.0090, 0.0012, 0.0100], { r: 0.0004, seg: 1 });
    // markings: left slide, right slide
    slide.quad(MK, [-0.01176, 0.0072, -0.0290], qw(0.0040, 0.66), 0.0040, row(0, 0.66), { r: [0, -90, 0] }); slide.quad(MK, [-0.01176, 0.0022, -0.0290], qw(0.0036, 0.60), 0.0036, row(1, 0.60), { r: [0, -90, 0] });
    slide.quad(MK, [0.01176, 0.0060, -0.0620], qw(0.0040, 0.54), 0.0040, row(2, 0.54), { r: [0, 90, 0] });

    // ------------------------------------------------------------ BARREL (tilts on its link; hood + chamber + feed ramp visible in the port), bore with lands hint
    barrel.rlathe(S, [0, 0, 0], [[0.0066, -0.1275], [0.0081, -0.1275, 0.0004], [0.0086, -0.1268], [0.0086, -0.0300, 0.0004], [0.0092, -0.0292], [0.0092, -0.0012, 0.0004], [0.0088, 0.0], [0.0062, 0.0]], { axis: 'z', seg: 36, wear: 1.8 });
    barrel.lathe(BO, [0, 0, 0], [[0.0062, 0.0], [0.0061, -0.0230], [0.00575, -0.0238], [0.00572, -0.1270], [0.0066, -0.1275]], { axis: 'z', seg: 24 });
    barrel.rb(S, [0, 0.0080, -0.0140], [0.0135, 0.0035, 0.0265], { r: 0.0006, seg: 1 }); barrel.rb(S, [0.0058, 0.0040, -0.0140], [0.0030, 0.0070, 0.0265], { r: 0.0005, seg: 1 });
    barrel.rb(S, [0, -0.0095, -0.0060], [0.0070, 0.0080, 0.0110], { r: 0.0008, seg: 1 }); barrel.rb(BO, [0, 0.0006, -0.0020], [0.0100, 0.0010, 0.0040], { r: 0.0002, seg: 1, wear: 0 }); // chamber mouth

    // ------------------------------------------------------------ FRAME: rails + dust cover (slide clearance gap 0.4 mm), grip, trigger guard with cut-out, mainspring housing
    const upper = roundPoly([[-0.1030, -0.0129], [0.0610, -0.0129], [0.0628, -0.0160, 0.0018], [0.0606, -0.0372], [0.0102, -0.0372], [0.0086, -0.0300, 0.0025], [-0.0368, -0.0270, 0.0022], [-0.1030, -0.0270, 0.0030]]);
    F.rext(S, upper, -0.0116, 0.0116, { r: 0.0011, seg: 2, wear: 1.5 });
    for (const sx of [-1, 1]) F.rb(BO, [sx * 0.01120, -0.01275, -0.0210], [0.0003, 0.0008, 0.1640], { r: 0.0001, seg: 1, wear: 0 }); // slide / frame parting gap (dark)
    F.rext(S, roundPoly([[0.0598, -0.0350], [0.0712, -0.1085, 0.001], [0.0292, -0.1085, 0.0015], [0.0112, -0.0525, 0.004], [0.0098, -0.0350]]), -0.0105, 0.0105, { r: 0.0008, seg: 2 }); // grip frame
    F.rlathe(BO, [0, -0.0178, -0.1027], [[0, 0], [0.0045, 0], [0.0045, 0.0008], [0, 0.0008]], { axis: 'z', seg: 18 }); // dust cover: recoil spring guide hole
    F.rext(S, roundPoly([[-0.0366, -0.0262], [-0.0394, -0.0350, 0.004], [-0.0402, -0.0452, 0.008], [-0.0356, -0.0550, 0.009], [0.0060, -0.0574, 0.006], [0.0130, -0.0522, 0.003], [0.0118, -0.0470], [0.0068, -0.0522, 0.003], [-0.0322, -0.0504, 0.006], [-0.0354, -0.0440, 0.005], [-0.0347, -0.0345, 0.003], [-0.0326, -0.0265]]), -0.0039, 0.0039, { r: 0.0010, seg: 2, wear: 1.6 }); // guard
    for (const [z, y, r, x] of [[0.0560, -0.0205, 0.0023, 0.0112], [0.0480, -0.0280, 0.0019, 0.0112], [-0.0215, -0.0205, 0.0028, 0.0112], [0.0715, -0.1010, 0.0017, 0.0096]]) pinX(F, S, y, z, r, x, 0);
    pinX(F, S, -0.0280, 0.0480, 0.0019, -0.0112, 0); pinX(F, S, -0.0205, 0.0560, 0.0023, -0.0112, 0);
    F.rlathe(S, [-0.0124, -0.0158, 0.0250], [[0, -0.0100], [0.0021, -0.0100, 0.0004], [0.0021, 0.0100, 0.0004], [0, 0.0100]], { axis: 'z', seg: 14 }); // plunger tube (left)
    // mainspring housing: arched, vertical grooves (A1), lanyard loop
    const back = bezPts([0.0650, -0.0376], [0.0702, -0.0470], [0.0806, -0.0690], [0.0790, -0.1080], 16);
    F.rext(S, [[0.0598, -0.0360], ...back.map((p) => [p[0] - 0.0009, p[1]]), [0.0781, -0.1085], [0.0708, -0.1085], [0.0610, -0.0380]], -0.0100, 0.0100, { r: 0.0008, seg: 2 });
    for (let i = 0; i < 13; i++) { const x = -0.0078 + i * 0.0013; for (let k = 0; k < back.length - 1; k += 1) { const a = back[k], b = back[k + 1]; const zz = (a[0] + b[0]) / 2 - 0.0005, yy = (a[1] + b[1]) / 2; const ang = Math.atan2(b[0] - a[0], -(b[1] - a[1])) / DEG; F.rb(S, [x, yy, zz], [0.0007, Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.02, 0.0008], { rot: [-ang, 0, 0], r: 0.0002, seg: 1, wear: 1.2 }); } }
    F.torus(S, [0, -0.1106, 0.0752], 0.0034, 0.0009, { r: [0, 90, 0], seg: 10, tube: 22 }); F.rb(S, [0, -0.1092, 0.0752], [0.0030, 0.0022, 0.0060], { r: 0.0005, seg: 1 });
    // markings: right frame
    F.quad(MK, [0.01165, -0.0182, -0.0640], qw(0.0040, 0.66), 0.0040, row(3, 0.66), { r: [0, 90, 0] });
    F.quad(MK, [0.01165, -0.0234, -0.0110], qw(0.0036, 0.30), 0.0036, row(4, 0.30), { r: [0, 90, 0] }); F.quad(MK, [0.01165, -0.0250, 0.0300], qw(0.0036, 0.24), 0.0036, row(5, 0.24), { r: [0, 90, 0] });

    // ------------------------------------------------------------ GRIP PANELS: walnut, real double-diamond checkering (pyramids), smooth borders + screw bosses, bushings, slotted screws
    const panelPts = [[0.0148, -0.0386, 0.003], [0.0586, -0.0386, 0.005], [0.0690, -0.1000, 0.006], [0.0668, -0.1050, 0.004], [0.0360, -0.1050, 0.006], [0.0318, -0.1010, 0.004]];
    const panel = roundPoly(panelPts), screws = [[0.0258, -0.0460], [0.0612, -0.0978]];
    const boss = (z, y) => [[z - 0.0010, y + 0.0100], [z + 0.0064, y], [z + 0.0010, y - 0.0100], [z - 0.0064, y]]; // the two smooth diamonds around the screws
    const bossTest = screws.map(([z, y]) => insideTest(boss(z, y), 0)); const fieldTest = insideTest(panel, 0.0034);
    for (const sx of [-1, 1]) {
      const x0 = sx > 0 ? 0.0105 : -0.0152, x1 = sx > 0 ? 0.0152 : -0.0105;
      F.rext(WD, panel, x0, x1, { r: 0.0016, seg: 2, wear: 1.3 });
      F.checker(WD, { map: (u, v) => ({ p: [sx * 0.0152, v, u], n: [sx, 0, 0] }), u0: 0.0148, u1: 0.0700, v0: -0.1052, v1: -0.0384, pitch: 0.00168, h: 0.00046, alpha: 45, inside: (u, v) => fieldTest(u, v) && !bossTest[0](u, v) && !bossTest[1](u, v), seed: sx, wear: 1.0 });
      for (const [z, y] of screws) {
        F.rext(WD, roundPoly(boss(z, y).map((p) => [p[0], p[1], 0.0012])), sx > 0 ? 0.0148 : -0.0157, sx > 0 ? 0.0157 : -0.0148, { r: 0.0005, seg: 1 }); // boss proud of the checkering
        F.rlathe(S, [sx * 0.0157, y, z], [[0, 0], [0.0040, 0, 0.0002], [0.0040, 0.0009, 0.0002], [0, 0.0009]], { axis: sx > 0 ? 'x' : '-x', seg: 20 }); // bushing collar
        F.hsScrew(S, [sx * 0.0166, y, z], 0.0031, { axis: sx > 0 ? 'x' : '-x', slot: jr(50) + (z > 0.04 ? 25 : -10), h: 0.0012 });
      }
    }
    // ------------------------------------------------------------ GRIP SAFETY (tang over the web of the hand)
    gsafe.rext(BL, roundPoly([[0.0608, -0.0124], [0.0790, -0.0150, 0.008], [0.0868, -0.0215, 0.005], [0.0852, -0.0262, 0.003], [0.0745, -0.0250, 0.006], [0.0680, -0.0330, 0.004], [0.0684, -0.0565, 0.002], [0.0616, -0.0565], [0.0600, -0.0200]]), -0.0096, 0.0096, { r: 0.0012, seg: 2, wear: 1.4 });
    gsafe.rb(S, [0, -0.0335, 0.0678], [0.0100, 0.0500, 0.0006], { r: 0.0002, seg: 1, wear: 0 }); pinX(gsafe, BL, -0.0185, 0.0640, 0.0016, -0.0098, 0.0098);

    // ------------------------------------------------------------ HAMMER (authored fired/down, rotated +54deg = cocked rest pose), serrated spur
    const hOut = roundPoly([[-0.0042, -0.0062, 0.003], [0.0068, -0.0062, 0.003], [0.0112, 0.0060, 0.004], [0.0132, 0.0200, 0.003], [0.0162, 0.0288, 0.002], [0.0118, 0.0322, 0.003], [0.0079, 0.0240, 0.0008], [0.0076, 0.0165, 0.0008], [0.0012, 0.0102, 0.003]]);
    hammer.rext(BL, hOut, -0.0040, 0.0040, { r: 0.0005, seg: 2, p: [0, -0.0205, 0.0560], rot: [54, 0, 0], wear: 1.6 });
    { const c = Math.cos(54 * DEG), sn = Math.sin(54 * DEG); const hp = (dz, dy) => [0, -0.0205 + dy * c - dz * sn, 0.0560 + dy * sn + dz * c]; const d = [0.32, 0.947], nrm = [0.947, -0.32];
      for (let i = 0; i < 6; i++) { const t = 0.0009 + i * 0.0015; hammer.rb(BL, hp(0.0132 + d[0] * t + nrm[0] * 0.0003, 0.0200 + d[1] * t + nrm[1] * 0.0003), [0.0083, 0.0006, 0.0008], { rot: [54 + 18.7, 0, 0], r: 0.0002, seg: 1, wear: 1.5 }); } }

    // ------------------------------------------------------------ THUMB SAFETY (left, serrated pad), SLIDE STOP (left, pad), MAG CATCH (knurled button)
    safety.rext(BL, roundPoly([[0.0060, 0.0048, 0.003], [0.0060, -0.0046, 0.003], [-0.0120, -0.0032], [-0.0205, -0.0022, 0.002], [-0.0218, 0.0032, 0.0015], [-0.0080, 0.0047]]), -0.0134, -0.0117, { r: 0.0005, seg: 2, p: [0, -0.0165, 0.0515], wear: 1.6 });
    safety.rb(BL, [-0.0142, -0.0165 + 0.0020, 0.0515 - 0.0192], [0.0040, 0.0020, 0.0060], { r: 0.0005, seg: 1, wear: 1.6 }); for (let i = 0; i < 5; i++) safety.rb(BL, [-0.0148, -0.0165 + 0.0033, 0.0515 - 0.0205 + i * 0.0012], [0.0006, 0.0009, 0.0007], { r: 0.0001, seg: 1, wear: 1.6 });
    pinX(safety, BL, -0.0165, 0.0515, 0.0028, -0.0134, 0);
    stop.rext(BL, roundPoly([[-0.0040, 0.0040, 0.003], [-0.0040, -0.0040, 0.003], [0.0180, -0.0022], [0.0238, -0.0012, 0.002], [0.0252, 0.0052, 0.002], [0.0150, 0.0070], [0.0050, 0.0056]]), -0.0133, -0.0117, { r: 0.0005, seg: 2, p: [0, -0.0205, -0.0215], wear: 1.6 });
    for (let i = 0; i < 6; i++) stop.rb(BL, [-0.0138, -0.0205 + 0.0053, -0.0215 + 0.0172 + i * 0.0011], [0.0006, 0.0030, 0.0007], { r: 0.0001, seg: 1, wear: 1.4 }); // thumb-pad serrations
    stop.rlathe(BL, [-0.0133, -0.0205, -0.0215], [[0, 0], [0.0030, 0, 0.0003], [0.0030, 0.0011, 0.0003], [0, 0.0011]], { axis: '-x', seg: 16 });
    mcatch.rlathe(BL, [-0.0118, -0.0425, 0.0115], [[0, 0], [0.0046, 0, 0.0004], [0.0046, 0.0036, 0.0006], [0, 0.0036]], { axis: '-x', seg: 24, wear: 1.5 });
    mcatch.knurl(BL, [-0.0118 - 0.0036 - 0.0002, -0.0425, 0.0115], 0.0040, 0.0004, { axis: '-x', diamond: true, pitch: 0.0007, depth: 0.0003, wear: 1.5 });

    // ------------------------------------------------------------ TRIGGER (A1 short, 3 grooves, slides straight back)
    trigger.rext(BL, roundPoly([[-0.0136, -0.0280], [-0.0152, -0.0372, 0.004], [-0.0124, -0.0458, 0.0018], [-0.0096, -0.0447, 0.0015], [-0.0082, -0.0290]]), -0.0030, 0.0030, { r: 0.0007, seg: 2, wear: 1.5 });
    for (let i = 0; i < 3; i++) trigger.rb(BO, [0, -0.0355 - i * 0.0030, -0.0088 - i * 0.0002], [0.0062, 0.0007, 0.0005], { r: 0.0002, seg: 1, wear: 0 }); // finger grooves on the rear face

    // ------------------------------------------------------------ MAGAZINE (7 rd, tilted with the grip): stamped body, seam, rib, witness holes, feed lips, folded base plate + top round
    const mc = [0, -0.0625, 0.0415];
    mag.rb(MG, mc, [0.0141, 0.0960, 0.0346], { rot: [GRIP, 0, 0], r: 0.0012, seg: 2, wear: 1.3 });
    const gp = (d, x = 0, off = 0) => [x, mc[1] + d * Math.cos(GRIP * DEG) + off * Math.sin(GRIP * DEG), mc[2] - d * Math.sin(GRIP * DEG) + off * Math.cos(GRIP * DEG)]; // point on the mag axis at distance d (+ offset along the mag depth)
    for (const sx of [-1, 1]) { mag.rb(MG, gp(0, sx * 0.0067, 0.0166), [0.0006, 0.0900, 0.0030], { rot: [GRIP, 0, 0], r: 0.0002, seg: 1 }); } // front rib (both sides of the folded front)
    mag.rb(MG, gp(0, 0.0, -0.0176), [0.0100, 0.0900, 0.0007], { rot: [GRIP, 0, 0], r: 0.0002, seg: 1 }); // rear weld seam
    for (let i = 0; i < 7; i++) { const d = -0.030 + i * 0.0090; const p = gp(d, -0.0071, 0.004); mag.cyl(BO, p, 0.0011, 0.0004, { axis: 'x', seg: 12, b: 0 }); }
    mag.rb(MG, [0, -0.1095, 0.0520], [0.0160, 0.0024, 0.0400], { r: 0.0009, seg: 2, wear: 1.6 }); mag.rb(BO, [0, -0.1078, 0.0520], [0.0140, 0.0004, 0.0380], { r: 0.0001, seg: 1, wear: 0 }); // base plate + lip shadow
    mag.rb(MG, [-0.0082, -0.0170, 0.0295], [0.0014, 0.0040, 0.0330], { rot: [GRIP, 0, 0], r: 0.0004, seg: 1 }); mag.rb(MG, [0.0082, -0.0170, 0.0295], [0.0014, 0.0040, 0.0330], { rot: [GRIP, 0, 0], r: 0.0004, seg: 1 }); // feed lips
    round.cyl(BR, [0, -0.0130, 0.0311], 0.0060, 0.0228, { axis: 'z', seg: 24, b: 0.0005 });
    round.rlathe(CU, [0, -0.0130, 0], [[0, 0.0101], [0.0030, 0.0106], [0.0051, 0.0121], [0.00572, 0.0143], [0.00572, 0.0205], [0, 0.0205]], { axis: 'z', seg: 24 });
    mag.rb(S, [0, -0.0200, 0.0275], [0.0118, 0.0030, 0.0300], { rot: [GRIP, 0, 0], r: 0.0006, seg: 1 }); // follower

    // ------------------------------------------------------------ sockets
    K.socket('muzzle', 'barrel', [0, 0, -0.1285]);
    K.socket('eject', 'slide', [0.0100, 0.0065, -0.0130]);
    K.socket('sightRear', 'slide', [0, 0.0245, 0.0520]);
    K.socket('sightFront', 'slide', [0, 0.0245, -0.1180]);
    K.socket('magWell', 'root', [0, -0.1100, 0.0500]);
    K.socket('magBase', 'mag', [0, -0.1110, 0.0520]);
    K.socket('trigger', 'trigger', [0, -0.0395, -0.0150]);
    K.socket('slideRear', 'slide', [0, 0.004, 0.0450]);
    return { length: 0.216, sightHeight: 0.0245, rearSightZ: 0.052, frontSightZ: -0.118, caliber: '.45 ACP' };
  },
};
