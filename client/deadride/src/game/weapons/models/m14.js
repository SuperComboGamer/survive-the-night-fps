// M14 (US Rifle 7.62 mm M14) — hard-surface rebuild (hs-kit): real fillets on every edge, real vents / serrations / knurls, ~60 separate
// modelled parts. Gun-local metres: -Z = muzzle, +Y up, +X right, origin = bore axis at the breech face.
// REFERENCE DIMENSIONS (mm, US Rifle M14 / TM 9-1005-223-10) and what this model measures (see measureKit in hs-kit.js, `node measure`):
//   overall length 1120 (butt plate -> flash suppressor tip)   barrel 559 to the breech face, suppressor 94 long, OD 24.8
//   sight radius ~ 688 (rear aperture -> front blade)          receiver 250 long x 30.6 wide, ring OD 32.2
//   stock: forend 42 wide, wrist 37, butt 42 x 126 tall         butt plate 45 wide, hinged trap door, 2 slotted screws
//   magazine 20 rd: 77 x 26 x 116 (steel, pressed panels)       gas cylinder OD 23.4 at 20.5 below the bore, lock nut hex 21 A/F
//   flash suppressor: 5 tines, bayonet lug on the underside     front sight blade 1.6 wide, 32.5 above the bore, protective ears
//   rear sight: 2 mm peep 32 above the bore, elevation drum (left, 19 dia) + windage knob (right, 16 dia), ears 41 above the bore
// Moving parts (bones): bolt, oprod (cycles 95 mm, locks open on the last round), trigger, mag, round.
import { roundPoly, arcPts, bezPts, DEG } from '../geo.js';
import { rng, circle, hexPoly, roundOpen, insideTest } from '../hs-kit.js';

const S = 'm14Park', W = 'm14Wood', WG = 'm14Guard', AP = 'm14Aper', ST = 'm14Steel', MG = 'm14Mag', BR = 'brass', CU = 'copper', BO = 'bore', MK = 'marks:m14';
const Z6 = [0, 0, 0, 0, 0, 0];
const RG = [-0.14, 0.1, -0.24, 20, 8, -50], RG2 = [-0.145, 0.104, -0.24, 21, 9, -52], RG3 = [-0.14, 0.094, -0.232, 19, 8, -49]; // mag-change presentation (magwell centred, rolled)
const DRAWN = [0.03, -0.22, 0.06, -40, 14, -22];

export default {
  id: 'm14',
  handling: {
    hip: { p: [0.098, -0.105, -0.17], r: [0.6, 2.2, 0] }, eye: 0.155, adsOffset: [0, 0, 0], sprint: { p: [0.05, -0.12, -0.2], r: [10, 48, 35] },
    pivot: [0, -0.06, 0.45], animPivot: [0, -0.05, 0.02], wall: { p: [0, -0.03, 0.08], r: [28, 12, -12] },
    shoulderR: [0.14, -0.22, 0.13], shoulderL: [-0.2, -0.26, 0.04], poleR: [0.9, -0.7, 0.2], poleL: [-0.45, -1, 0.1],
    hands: { R: { f: 'gripR', pose: 'rifleGrip' }, L: { f: 'foreL', pose: 'handguard' } },
    frames: {
      gripR: { part: 'root', p: [0.0235, -0.0560, 0.1760], fd: [0, -0.52, -0.85], pn: [-1, 0, 0] },
      foreL: { part: 'root', p: [-0.004, -0.0560, -0.225], fd: [0.9, 0.12, -0.42], pn: [0.05, 1, 0.1] },
      magL: { part: 'mag', p: [-0.030, -0.085, -0.012], fd: [0.35, -0.25, -0.9], pn: [1, 0.05, 0.1] },
      opR: { part: 'oprod', p: [0.050, 0.014, -0.032], fd: [-0.35, -0.5, -0.8], pn: [-0.9, 0, -0.2] },
    },
    parts(rig, st) { rig.scale('round', st.mag > 1 ? 1 : 0); if (st.locked) { rig.set('oprod', 0, 0, 0.095); rig.set('bolt', 0, 0, 0.095); } },
    clips: {
      fire: { dur: 0.09, events: [[0.014, 'eject']], tracks: { oprod: [[0, [0, 0, 0]], [0.018, [0, 0, 0.095], 'out'], [0.024, [0, 0, 0.095]], [0.07, [0, 0, 0], 'in']], bolt: [[0, [0, 0, 0]], [0.02, [0, 0, 0.095], 'out'], [0.026, [0, 0, 0.095]], [0.07, [0, 0, 0], 'in']], trigger: [[0, [0, 0, 0, 10, 0, 0]], [0.06, [0, 0, 0, 10, 0, 0]], [0.09, Z6, 'out']] } },
      fireLast: { dur: 0.09, events: [[0.014, 'eject']], tracks: { oprod: [[0, [0, 0, 0]], [0.018, [0, 0, 0.095], 'out']], bolt: [[0, [0, 0, 0]], [0.02, [0, 0, 0.095], 'out']], trigger: [[0, [0, 0, 0, 10, 0, 0]], [0.06, [0, 0, 0, 10, 0, 0]], [0.09, Z6, 'out']] } },
      dry: { dur: 0.14, tracks: { trigger: [[0, [0, 0, 0, 10, 0, 0]], [0.14, Z6, 'out']] } },
      draw: { dur: 0.6, events: [[0.0, 'snd', 'draw']], tracks: { gun: [[0, DRAWN], [0.6, Z6, 'out3']] } },
      holster: { dur: 0.35, tracks: { gun: [[0, Z6], [0.35, DRAWN, 'in']] } },
      firstDraw: { dur: 1.2, events: [[0.0, 'snd', 'draw'], [0.62, 'snd', 'boltBack'], [0.8, 'snd', 'bolt']], tracks: {
        gun: [[0, DRAWN], [0.45, [-0.02, 0.02, 0.0, 3, 10, 14], 'out3'], [0.82, [-0.02, 0.02, 0.0, 4, 11, 16]], [0.86, [-0.02, 0.025, 0.012, 6, 11, 16], 'out'], [1.2, Z6, 'io']],
        oprod: [[0.5, [0, 0, 0]], [0.66, [0, 0, 0.1], 'out'], [0.78, [0, 0, 0.1]], [0.83, [0, 0, 0], 'in']], bolt: [[0.5, [0, 0, 0]], [0.66, [0, 0, 0.1], 'out'], [0.78, [0, 0, 0.1]], [0.83, [0, 0, 0], 'in']],
        R: [[0, { f: 'rest' }], [0.45, { f: 'opR', pose: 'pinch' }, 'io'], [0.66, { f: 'opR', pose: 'pinch' }], [0.78, { f: 'opR', pose: 'pinch' }], [0.84, { f: 'opR', p: [0.012, 0.006, 0.012], pose: 'relaxed' }, 'out'], [1.14, { f: 'rest' }, 'io']] } },
      reload: {
        scale: 1.13, dur: 2.3, events: [[0.38, 'snd', 'magout'], [1.5, 'snd', 'magin'], [1.52, 'magFill']],
        tracks: {
          gun: [[0, Z6], [0.3, RG, 'io'], [1.44, RG2, 'io'], [1.54, RG3, 'out'], [1.66, RG2, 'io'], [2.3, Z6, 'io']],
          mag: [[0.34, Z6], [0.44, [0, -0.01, -0.008, 14, 0, 0], 'out'], [0.54, [0, -0.07, -0.02, 16, 0, 0], 'in'], [0.74, [-0.03, -0.32, 0.0, 30, 20, 10], 'in'], [0.9, [-0.05, -0.34, 0.0, 35, 30, 20], 'step'], [1.28, [0, -0.07, -0.024, 18, 0, 0], 'out'], [1.4, [0, -0.012, -0.012, 15, 0, 0], 'io'], [1.52, Z6, 'io']],
          L: [[0, { f: 'rest' }], [0.32, { f: 'magL', pose: 'magGrip' }, 'io'], [0.74, { f: 'magL', pose: 'magGrip' }], [0.9, { f: 'magL', pose: 'magGrip' }, 'step'], [1.52, { f: 'magL', pose: 'magGrip' }], [1.6, { f: 'magL', p: [0, -0.02, 0.01], pose: 'slap' }, 'out'], [2.1, { f: 'rest' }, 'io']] } },
      reloadEmpty: {
        scale: 1.09, dur: 2.75, events: [[0.38, 'snd', 'magout'], [1.5, 'snd', 'magin'], [1.52, 'magFill'], [2.08, 'unlock'], [2.08, 'snd', 'bolt']],
        tracks: {
          gun: [[0, Z6], [0.3, RG, 'io'], [1.44, RG2, 'io'], [1.54, RG3, 'out'], [1.8, [-0.05, 0.03, -0.12, 6, 6, 26], 'io'], [2.06, [-0.05, 0.03, -0.12, 7, 7, 28]], [2.1, [-0.05, 0.036, -0.11, 9, 7, 28], 'out'], [2.75, Z6, 'io']],
          mag: [[0.34, Z6], [0.44, [0, -0.01, -0.008, 14, 0, 0], 'out'], [0.54, [0, -0.07, -0.02, 16, 0, 0], 'in'], [0.74, [-0.03, -0.32, 0.0, 30, 20, 10], 'in'], [0.9, [-0.05, -0.34, 0.0, 35, 30, 20], 'step'], [1.28, [0, -0.07, -0.024, 18, 0, 0], 'out'], [1.4, [0, -0.012, -0.012, 15, 0, 0], 'io'], [1.52, Z6, 'io']],
          oprod: [[1.9, [0, 0, 0.095]], [2.02, [0, 0, 0.1], 'io'], [2.08, [0, 0, 0.1]], [2.12, [0, 0, 0], 'in']], bolt: [[1.9, [0, 0, 0.095]], [2.02, [0, 0, 0.1], 'io'], [2.08, [0, 0, 0.1]], [2.12, [0, 0, 0], 'in']],
          L: [[0, { f: 'rest' }], [0.32, { f: 'magL', pose: 'magGrip' }, 'io'], [0.74, { f: 'magL', pose: 'magGrip' }], [0.9, { f: 'magL', pose: 'magGrip' }, 'step'], [1.52, { f: 'magL', pose: 'magGrip' }], [1.6, { f: 'magL', p: [0, -0.02, 0.01], pose: 'slap' }, 'out'], [2.1, { f: 'rest' }, 'io']],
          R: [[0, { f: 'rest' }], [1.62, { f: 'rest' }], [1.84, { f: 'opR', pose: 'pinch' }, 'io'], [2.06, { f: 'opR', pose: 'pinch' }], [2.12, { f: 'opR', p: [0.012, 0.006, 0.012], pose: 'relaxed' }, 'out'], [2.42, { f: 'rest' }, 'io']] } },
    },
  },
  build(K, M) {
    M.util();
    // markings atlas: 8 rows of 64 px (row i -> v band); decals are alpha-tested quads with an engraved normal (see materials.marks)
    M.marks('m14', 1024, 512, (g) => {
      g.textBaseline = 'middle'; g.font = 'bold 40px "Courier New", monospace';
      g.fillText('U.S. RIFLE', 12, 32); g.fillText('7.62-MM M14', 12, 96); g.fillText('SPRINGFIELD ARMORY', 12, 160); g.fillText('1438552', 12, 224);
      g.font = 'bold 34px "Courier New", monospace'; g.fillText('S.A.  FS  05 64', 12, 288); g.fillText('12345678', 12, 352); g.fillText('SAFE   FIRE', 12, 416); g.fillText('P  △  M14', 12, 480);
    }, { color: 0x0c0c0c, rough: 0.7, metal: 0.4 });
    const row = (i, u1) => [0, 1 - (i + 1) / 8 + 0.004, u1, 1 - i / 8 - 0.004]; const qw = (h, u1) => h * (u1 * 1024 / 64) * 0.98;
    const rnd = rng(1438552), jr = (a) => (rnd() * 2 - 1) * a;
    const R = K.root;
    const bolt = K.part('bolt', { pivot: [0, 0.006, 0.02] }), oprod = K.part('oprod', { pivot: [0.02, 0, -0.1] }), trigger = K.part('trigger', { pivot: [0, -0.04, 0.06] });
    const mag = K.part('mag', { pivot: [0, -0.07, -0.012] }), round = K.part('round', { parent: 'mag', pivot: [0, -0.012, -0.012] });
    const C = (cx, cy, r, a0, a1, n) => arcPts(cx, cy, r, a0, a1, n);
    // pin / rivet with rounded heads through a plate (axis x): heads at xa and xb
    const pin = (P, mat, y, z, rad, xa, xb) => { for (const x of [xa, xb]) { const s = Math.sign(x); P.rlathe(mat, [x, y, z], [[0, -0.0004], [rad, -0.0004, 0.0003], [rad, 0.0002, 0.0002], [rad * 0.6, 0.0009], [0, 0.001]], { axis: s > 0 ? 'x' : '-x', seg: 10, sharp: 60 }); } };
    const slotScrew = (P, mat, p, rad, axis) => P.hsScrew(mat, p, rad, { axis, slot: jr(40) + 20, h: rad * 0.4 });

    // ------------------------------------------------------------ STOCK: walnut, one piece (forend, receiver bed, semi-pistol grip, comb, butt)
    R.profLoft(W, { z0: -0.322, z1: 0.4965, steps: 92, K: 34, wear: 0.55,
      top: [[-0.322, -0.0052], [-0.24, -0.0052], [-0.09, -0.0056], [-0.076, -0.0108], [0.156, -0.0108], [0.168, -0.0058], [0.205, -0.0056], [0.30, -0.0118], [0.40, -0.0190], [0.4965, -0.0250]],
      bot: [[-0.322, -0.0355], [-0.26, -0.0385], [-0.16, -0.0425], [-0.07, -0.0470], [0.03, -0.0490], [0.105, -0.0520], [0.14, -0.0770], [0.17, -0.0925], [0.20, -0.0990], [0.235, -0.0975], [0.28, -0.1025], [0.35, -0.1180], [0.42, -0.1310], [0.4965, -0.1415]],
      w: [[-0.322, 0.0158], [-0.24, 0.0172], [-0.10, 0.0196], [0.02, 0.0206], [0.12, 0.0204], [0.165, 0.0186], [0.20, 0.0168], [0.24, 0.0172], [0.32, 0.0196], [0.4965, 0.0212]],
      n: [[-0.3, 2.3], [0.0, 2.5], [0.19, 2.2], [0.3, 2.6], [0.49, 3.0]] });
    // steel butt plate: shell with ribbed shoulder face, hinged trap door (seam, latch button, hinge knuckles), two slotted screws
    R.rext(S, roundPoly([[0.4958, -0.0246, 0.003], [0.5052, -0.0258, 0.004], [0.5086, -0.1402, 0.005], [0.4930, -0.1426, 0.006]]), -0.0228, 0.0228, { r: 0.0013, seg: 2 });
    for (let i = 0; i < 13; i++) R.rb(S, [0, -0.0335 - i * 0.0082, 0.5075 + i * 0.00016], [0.040, 0.0016, 0.0008], { r: 0.0004, seg: 1, wear: 1.2 }); // ribs on the shoulder face
    for (const [x, y, w, h] of [[0, -0.0555, 0.0250, 0.0004], [0, -0.1105, 0.0250, 0.0004], [-0.0125, -0.083, 0.0004, 0.0554], [0.0125, -0.083, 0.0004, 0.0554]]) R.rb(BO, [x, y, 0.5093], [w, h, 0.0008], { r: 0.0001, seg: 1, wear: 0 });
    R.rlathe(S, [0, -0.0592, 0.5093], [[0, 0], [0.0042, 0, 0.0006], [0.0042, 0.0012, 0.0004], [0.0028, 0.0022], [0, 0.0022]], { axis: 'z', seg: 18 }); // latch button (looks aft)
    for (const x of [-0.0072, 0.0072]) R.rlathe(S, [x, -0.1092, 0.5080], [[0, 0], [0.0030, 0, 0.0004], [0.0030, 0.0026, 0.0004], [0, 0.0026]], { axis: 'z', seg: 12 }); // hinge knuckles
    for (const [x, y] of [[-0.0154, -0.0470], [0.0154, -0.0470], [-0.0154, -0.1300], [0.0154, -0.1300]]) slotScrew(R, S, [x, y, 0.5094], 0.0030, 'z');
    // stock ferrule (steel band around the fore-end tip), swivel loop + plate + screws at the rear of the belly
    R.rextZ(S, C(0, -0.0203, 0.0172, 0, 360, 36).map(([x, y]) => [x * 0.99, (y + 0.0203) * 1.09 - 0.0203]), -0.3230, -0.3106, { holes: [C(0, -0.0203, 0.0158, 0, 360, 36).map(([x, y]) => [x, (y + 0.0203) * 1.09 - 0.0203])], r: 0.0007, seg: 2 });
    R.torus(S, [0, -0.1213, 0.3400], 0.0092, 0.0015, { r: [0, 90, 0], seg: 10, tube: 26 });
    R.rext(S, roundPoly([[0.324, -0.1085, 0.001], [0.356, -0.1105, 0.001], [0.353, -0.1153, 0.002], [0.327, -0.1133, 0.002]]), -0.0046, 0.0046, { r: 0.0007 });
    R.rext(S, roundPoly([[0.336, -0.1126, 0.002], [0.344, -0.1126, 0.002], [0.344, -0.1213, 0.003], [0.336, -0.1213, 0.003]]), -0.0036, 0.0036, { r: 0.0006 }); // loop lug
    for (const z of [0.331, 0.349]) slotScrew(R, S, [0, -0.1156, z], 0.0021, '-y');

    R.rb(BO, [0.0172, -0.0085, -0.2100], [0.0010, 0.0060, 0.2200], { r: 0.0003, seg: 1, wear: 0 }); // op-rod channel in the right side of the fore-end
    // dark mortise + receiver-bed gaps (real parting lines between the wood and the steel)
    R.rb(BO, [0, -0.0489, -0.0100], [0.0296, 0.0018, 0.0860], { r: 0.0004, seg: 1, wear: 0 }); R.rb(BO, [0, -0.0505, 0.0640], [0.0262, 0.0016, 0.1040], { r: 0.0004, seg: 1, wear: 0 });
    for (const sx of [-1, 1]) R.rb(BO, [sx * 0.01515, -0.0114, 0.0400], [0.0005, 0.0010, 0.2300], { r: 0.0002, seg: 1, wear: 0 });
    // ------------------------------------------------------------ RECEIVER: ring, open-top body with raceway, closed bridge + heel, rails, clip guide
    R.rlathe(S, [0, 0, 0], [[0.0100, -0.0795], [0.0150, -0.0795, 0.0007], [0.0161, -0.0783], [0.0161, -0.0330, 0.0009], [0.0152, -0.0300], [0.0100, -0.0300]], { axis: 'z', seg: 44, sharp: 50 });
    R.rlathe(S, [0, 0, 0], [[0.0148, -0.0700], [0.0165, -0.0700, 0.0003], [0.0165, -0.0662, 0.0003], [0.0148, -0.0662]], { axis: 'z', seg: 32, sharp: 50 }); // ring shoulder band
    const body = roundPoly([[-0.0150, -0.0135, 0.0025], [0.0150, -0.0135, 0.0025], [0.0153, 0.0000], [0.0141, 0.0048, 0.0012], [0.0093, 0.0048, 0.0006], [0.0089, -0.0090, 0.0035], [-0.0089, -0.0090, 0.0035], [-0.0093, 0.0126, 0.0006], [-0.0121, 0.0150, 0.0012], [-0.0153, 0.0112, 0.0022]], 8);
    R.rextZ(S, body, -0.0310, 0.0575, { r0: 0, r1: 0, crease: 50, wearWalls: 0.5 });
    R.rb(S, [0.0165, -0.0068, 0.0120], [0.0028, 0.0046, 0.0840], { r: 0.0007, seg: 1 }); // right-hand op-rod guide rail
    R.rb(S, [0.0166, 0.0010, 0.0520], [0.0016, 0.0100, 0.0180], { r: 0.0005, seg: 1 }); // receiver rib below the bridge
    const heelSec = (hw, top, bot, rt) => roundPoly([[-hw, bot, 0.002], [hw, bot, 0.002], [hw, top - rt * 1.1, rt], [hw - rt * 0.9, top, rt * 0.8], [-hw + rt * 0.9, top, rt * 0.8], [-hw, top - rt * 1.1, rt]], 8);
    R.polyLoft(S, [{ z: 0.0565, pts: heelSec(0.0152, 0.0163, -0.0135, 0.0048) }, { z: 0.140, pts: heelSec(0.0152, 0.0163, -0.0135, 0.0050) }, { z: 0.156, pts: heelSec(0.0150, 0.0161, -0.0133, 0.0056) },
      { z: 0.164, pts: heelSec(0.0142, 0.0152, -0.0128, 0.0062) }, { z: 0.1685, pts: heelSec(0.0122, 0.0128, -0.0112, 0.0060) }, { z: 0.1705, pts: heelSec(0.0092, 0.0092, -0.0085, 0.0050) }], { N: 72, wear: 0.6, wearK: 0.0012 });
    // markings on the heel top (read from behind) and on the left side of the receiver
    R.quad(MK, [0.0, 0.01636, 0.1200], qw(0.0036, 0.25), 0.0036, row(0, 0.25), { r: [-90, 0, 0] }); R.quad(MK, [0.0, 0.01636, 0.1152], qw(0.0036, 0.31), 0.0036, row(1, 0.31), { r: [-90, 0, 0] });
    R.quad(MK, [0.0, 0.01636, 0.1104], qw(0.0030, 0.5), 0.0030, row(2, 0.5), { r: [-90, 0, 0] }); R.quad(MK, [0.0, 0.01636, 0.1060], qw(0.0030, 0.22), 0.0030, row(3, 0.22), { r: [-90, 0, 0] });
    R.quad(MK, [-0.01535, -0.0056, 0.0350], qw(0.0032, 0.42), 0.0032, row(4, 0.42), { r: [0, -90, 0] }); R.quad(MK, [-0.01535, -0.0092, 0.1300], qw(0.0030, 0.24), 0.0030, row(7, 0.24), { r: [0, -90, 0] });
    // stripper-clip guide (two ears + slot), bolt-hold-open pin, receiver cross pins
    for (const sx of [-1, 1]) R.rb(S, [sx * 0.0044, 0.0184, 0.0640], [0.0046, 0.0044, 0.0130], { r: 0.0006, seg: 1 });
    R.rb(BO, [0, 0.0168, 0.0640], [0.0034, 0.0012, 0.0130], { r: 0.0002, seg: 1, wear: 0 });
    pin(R, S, -0.0035, 0.004, 0.0028, -0.0153, 0.0153); pin(R, S, -0.0085, 0.110, 0.0016, -0.0153, 0.0153); pin(R, S, -0.0062, 0.0475, 0.0019, -0.0153, 0.0153);
    // ------------------------------------------------------------ rear sight on the heel: base, ears, aperture leaf + ring, elevation drum (L), windage knob (R)
    R.rb(S, [0, 0.0184, 0.151], [0.0128, 0.0046, 0.030], { r: 0.0009, seg: 2 }); R.rb(S, [0, 0.0208, 0.1385], [0.0102, 0.0030, 0.0060], { r: 0.0005, seg: 1 });
    for (const sx of [-1, 1]) R.rext(AP, roundPoly([[0.1395, 0.0158], [0.1665, 0.0158], [0.1650, 0.0300, 0.004], [0.1600, 0.0412, 0.0060], [0.1460, 0.0412, 0.0060], [0.1410, 0.0300, 0.004]]), sx > 0 ? 0.0063 : -0.0093, sx > 0 ? 0.0093 : -0.0063, { r: 0.0007, seg: 2 }); // ears
    R.rextZ(AP, roundPoly([[-0.0051, 0.0196, 0.0012], [0.0051, 0.0196, 0.0012], [0.0051, 0.0392, 0.0018], [-0.0051, 0.0392, 0.0018]]), 0.1500, 0.1528, { r: 0.0003, holes: [C(0, 0.032, 0.0010, 0, 360, 22)] }); // leaf with the 2 mm peep
    R.rlathe(AP, [0, 0.032, 0.1532], [[0.0010, -0.0005], [0.0029, -0.0005, 0.0003], [0.0029, 0.0005, 0.0003], [0.0010, 0.0005]], { axis: 'z', seg: 28, sharp: 70 }); // raised ring around the peep
    for (const y of [0.0232, 0.0262, 0.0350]) R.rb(AP, [0, y, 0.15055], [0.0102, 0.0006, 0.0006], { r: 0.0002, seg: 1, wear: 0.4 }); // scale lines on the leaf
    const knob = (sx, rad, th, x0, n) => { // hub + knurled rim + domed, graduated face + detent notches
      const ax = sx > 0 ? 'x' : '-x';
      R.rlathe(S, [x0, 0.0205, 0.151], [[0, -0.0004], [0.0048, -0.0004], [0.0052, 0.0006, 0.0004], [rad * 0.86, 0.0010], [rad - 0.0006, 0.0014], [rad, 0.0020]], { axis: ax, seg: 28 });
      R.knurl(S, [x0 + sx * (0.0020 + (th - 0.0032) / 2), 0.0205, 0.151], rad, th - 0.0032, { axis: ax, n, depth: 0.0004, wear: 2.2 });
      R.rlathe(S, [x0, 0.0205, 0.151], [[rad, th - 0.0012], [rad - 0.0006, th - 0.0002, 0.0004], [rad * 0.8, th], [rad * 0.42, th + 0.0006, 0.0006], [0.0022, th + 0.0009], [0.0020, th + 0.0016], [0, th + 0.0017]], { axis: ax, seg: 28 });
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const big = i % 3 === 0; R.rb(BO, [x0 + sx * (th + 0.0006), 0.0205 + Math.sin(a) * rad * 0.7, 0.151 + Math.cos(a) * rad * 0.7], [0.0003, big ? 0.0006 : 0.0004, big ? 0.0030 : 0.0018], { rot: [a / DEG, 0, 0], r: 0.0001, seg: 1, wear: 0 }); }
    };
    knob(-1, 0.0094, 0.0062, -0.0152, 56); knob(1, 0.0080, 0.0052, 0.0152, 44);

    // ------------------------------------------------------------ upper handguard (walnut C-section around the barrel): continuous strips + separate bars between REAL vent slots
    const band = (ro, ri, cy, a0, a1) => { const o = C(0, cy, ro, a0, a1, 10), i = C(0, cy, ri, a1, a0, 10); return o.concat(i); };
    const hgR = (z) => 0.0146 + (0.0170 - 0.0146) * Math.min(1, Math.max(0, (z + 0.312) / 0.222)); // taper: 14.6 mm at the front, 17.0 at the receiver
    const hgSecs = (a0, a1, zs) => zs.map((z) => ({ z, pts: band(hgR(z), 0.0116 + (z + 0.312) * 0.0004, 0.0006, a0, a1) }));
    const ZS = [-0.0775, -0.090, -0.15, -0.21, -0.27, -0.312];
    R.polyLoft(WG, hgSecs(38, 142, ZS), { N: 40, wear: 0.5 }); // top strip
    for (const [a0, a1] of [[-24, 22], [158, 204]]) R.polyLoft(WG, hgSecs(a0, a1, ZS), { N: 24, wear: 0.5 }); // lower strips
    const vz = [-0.0775, -0.1105, -0.1285, -0.1405, -0.1585, -0.1705, -0.1885, -0.2005, -0.2185, -0.2305, -0.2485, -0.2605, -0.312]; // slot edges: 5 slots of 12 mm, bars between
    for (const [a0, a1] of [[22, 38], [142, 158]]) for (let i = 0; i < vz.length - 1; i += 2) R.polyLoft(WG, [vz[i], vz[i + 1]].map((z) => ({ z, pts: band(hgR(z), 0.0116 + (z + 0.312) * 0.0004, 0.0006, a0, a1) })), { N: 16, wear: 0.6 }); // bars
    R.rextZ(BO, roundPoly([[-0.0118, 0.0006, 0.001], [0.0118, 0.0006, 0.001], [0.0134, -0.0050, 0.002], [-0.0134, -0.0050, 0.002]]), -0.2955, -0.0880, { r: 0.0005, r0: 0, r1: 0, wear: 0 }); // hidden filler under the strips (stops see-through gaps)
    R.rb(S, [0, 0.0158, -0.0800], [0.0250, 0.0028, 0.0060], { r: 0.0006, seg: 1 }); // handguard retainer at the receiver ring
    for (const sx of [-1, 1]) R.rb(S, [sx * 0.0132, -0.0038, -0.0930], [0.0030, 0.0060, 0.0100], { r: 0.0006, seg: 1 }); // spring clips
    // ------------------------------------------------------------ barrel, gas cylinder + lock + plug + spindle valve, front band + swivel
    R.rlathe(S, [0, 0, 0], [[0.0072, -0.5195], [0.0089, -0.5195, 0.0004], [0.0090, -0.460], [0.0098, -0.345], [0.0100, -0.300], [0.0104, -0.080], [0.0072, -0.080]], { axis: 'z', seg: 36 });
    R.rlathe(S, [0, -0.0205, 0], [[0.0060, -0.338], [0.0113, -0.338, 0.0005], [0.0117, -0.341, 0.0006], [0.0117, -0.430, 0.0006], [0.0112, -0.433], [0.0060, -0.433]], { axis: 'z', seg: 36 }); // gas cylinder
    R.rb(S, [0, -0.0118, -0.385], [0.0120, 0.0120, 0.0860], { r: 0.0015, seg: 2 }); // cylinder-to-barrel web
    R.rlathe(S, [0, -0.0205, 0], [[0, -0.452], [0.0055, -0.452, 0.0004], [0.0062, -0.449], [0.0062, -0.446]], { axis: 'z', seg: 24 }); // gas plug
    R.lathe(S, [0, -0.0205, 0], [[0.0100, -0.4455], [0.0106, -0.444], [0.0106, -0.4345], [0.0060, -0.4345]], { axis: 'z', seg: 6, sharp: 20 }); // lock nut (hex)
    R.rb(BO, [0, -0.0205, -0.4468], [0.0036, 0.0036, 0.0040], { r: 0.0004, seg: 1, wear: 0 }); // plug bore
    R.cyl(S, [0.0120, -0.0205, -0.410], 0.0034, 0.004, { axis: 'x', seg: 18, b: 0.0004 }); R.rb(BO, [0.01418, -0.0205, -0.410], [0.0004, 0.0048, 0.0008], { r: 0.0001, seg: 1, wear: 0, rot: [0, 0, jr(20)] }); // spindle valve + slot
    const ringOuter = roundPoly([[-0.0185, -0.0425, 0.004], [0.0185, -0.0425, 0.004], [0.0185, 0.0140, 0.006], [0.0060, 0.0200, 0.004], [-0.0060, 0.0200, 0.004], [-0.0185, 0.0140, 0.006]], 8);
    R.rextZ(S, ringOuter, -0.338, -0.322, { holes: [circle(0, 0, 0.0106, 20), circle(0, -0.0205, 0.0122, 20)], r: 0.0008, seg: 2 }); R.rextZ(BO, ringOuter, -0.3366, -0.3228, { r0: 0, r1: 0, wear: 0 }); // front band ring (holes for barrel + cylinder, dark fill recessed)
    R.rb(S, [0, -0.0225, -0.330], [0.0140, 0.0040, 0.0120], { r: 0.0008, seg: 1 });
    R.torus(S, [0, -0.0415, -0.376], 0.0092, 0.0015, { r: [0, 90, 0], seg: 10, tube: 26 }); R.rb(S, [0, -0.0335, -0.376], [0.0060, 0.0075, 0.0120], { r: 0.0010, seg: 2 }); R.rb(S, [0, -0.0310, -0.330], [0.0060, 0.0090, 0.0100], { r: 0.0010, seg: 2 }); // front swivel
    R.cyl(S, [0, -0.0426, -0.3300], 0.0010, 0.0060, { axis: 'x', seg: 10, b: 0.0002 }); slotScrew(R, S, [0.0172, -0.0080, -0.3300], 0.0016, 'x'); slotScrew(R, S, [-0.0172, -0.0080, -0.3300], 0.0016, '-x');

    // ------------------------------------------------------------ flash suppressor: threaded sleeve, 5 open tines (real slots), protected blade sight, bayonet lug
    R.rlathe(S, [0, 0, 0], [[0.0092, -0.5195], [0.0118, -0.5195, 0.0005], [0.0124, -0.5215, 0.0005], [0.0124, -0.546], [0.0104, -0.546]], { axis: 'z', seg: 44 });
    for (let i = 0; i < 5; i++) { const a = i / 5 * 360 + 90 + 36; // tine i spans 44 deg, slots 28 deg (Part.lathe angle t maps to gun angle -t)
      R.rlathe(S, [0, 0, 0], [[0.0104, -0.6125], [0.0121, -0.6125, 0.0006], [0.0124, -0.6100, 0.0005], [0.0124, -0.546], [0.0104, -0.546]], { axis: 'z', seg: 9, t0: -(a + 22) * DEG, tlen: 44 * DEG, sharp: 30 });
      for (const s of [-1, 1]) { const ae = (a + s * 22) * DEG; R.rb(S, [Math.cos(ae) * 0.0114, Math.sin(ae) * 0.0114, -0.5793], [0.0021, 0.0020, 0.0667], { rot: [0, 0, a + s * 22 + 90], r: 0.0004, seg: 1 }); } } // tine side walls
    R.rlathe(BO, [0, 0, 0], [[0.0104, -0.546], [0.0104, -0.6125]], { axis: 'z', seg: 44 }); // dark inner wall
    R.rlathe(S, [0, 0, -0.0005], [[0.0038, -0.5860], [0.0076, -0.5860, 0.0004], [0.0076, -0.5460]], { axis: 'z', seg: 26 }); // barrel muzzle inside the hider
    R.rlathe(BO, [0, 0, 0], [[0.0000, -0.5862], [0.0039, -0.5862], [0.0039, -0.5500], [0, -0.5500]], { axis: 'z', seg: 20 }); // bore
    R.rb(S, [0, -0.0165, -0.536], [0.0095, 0.0105, 0.0300], { r: 0.0012, seg: 2 }); R.rb(S, [0, -0.0125, -0.5150], [0.0100, 0.0040, 0.0140], { r: 0.0008, seg: 1 }); // bayonet lug + stud
    R.rext(ST, roundPoly([[-0.0055, 0.0000], [0.0050, 0.0000], [0.0035, 0.0140, 0.001], [0.0000, 0.0210], [-0.0035, 0.0210], [-0.0055, 0.0100, 0.001]]), -0.0008, 0.0008, { r: 0.0002, seg: 1, p: [0, 0.0115, -0.535], rot: [0.4, 0, 0.35] }); // front blade (1.6 mm), canted 0.35 deg about its base: hand-staked // front blade (1.6 mm)
    for (const sx of [-1, 1]) R.rext(S, roundPoly([[-0.5445, 0.0112], [-0.5265, 0.0112], [-0.5280, 0.0330, 0.0025], [-0.5430, 0.0340, 0.0025]]), sx > 0 ? 0.0036 : -0.0054, sx > 0 ? 0.0054 : -0.0036, { r: 0.0005, seg: 2 }); // protective ears
    R.rextZ(S, roundPoly([[-0.0068, 0.0098, 0.001], [0.0068, 0.0098, 0.001], [0.0058, 0.0128, 0.001], [-0.0058, 0.0128, 0.001]]), -0.5445, -0.5265, { r: 0.0005 }); // sight base

    // ------------------------------------------------------------ bolt (visible in the open top): body, lugs, extractor, roller, ejector slot
    bolt.rlathe(S, [0, 0, 0], [[0, -0.0115], [0.0072, -0.0115, 0.0005], [0.0078, -0.0105, 0.0005], [0.0078, 0.058, 0.001], [0.0070, 0.060], [0, 0.060]], { axis: 'z', seg: 30, wear: 1.6 });
    for (const sx of [-1, 1]) bolt.rb(S, [sx * 0.0078, 0.0025, -0.006], [0.0036, 0.0036, 0.010], { r: 0.0005, seg: 1, wear: 1.6 }); // locking lugs
    bolt.cyl(S, [0.0096, 0.0052, 0.012], 0.0034, 0.0052, { axis: 'x', seg: 20, b: 0.0005 }); bolt.rb(BO, [0.0123, 0.0052, 0.012], [0.0004, 0.0016, 0.0050], { r: 0.0001, seg: 1, wear: 0 }); // roller
    bolt.rb(S, [0.0038, 0.0074, 0.010], [0.0026, 0.0018, 0.026], { r: 0.0004, seg: 1, wear: 1.6 }); bolt.rb(BO, [-0.0010, 0.0076, 0.014], [0.0050, 0.0008, 0.030], { r: 0.0002, seg: 1, wear: 0 }); // extractor + cam slot
    bolt.rb(BO, [0, 0, -0.0117], [0.0026, 0.0026, 0.0004], { r: 0.0002, seg: 1, wear: 0 }); // firing pin hole
    // ------------------------------------------------------------ operating rod (right side) + handle with knurled knob
    { const path = [[0.0122, -0.0078, -0.405], [0.0124, -0.0074, -0.20], [0.0130, -0.0066, -0.118], [0.0152, -0.0050, -0.092], [0.0176, -0.0032, -0.070], [0.0186, -0.0026, -0.050]];
      for (let i = 0; i < path.length - 1; i++) { const A = path[i], B = path[i + 1]; const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.hypot(dx, dy, dz);
        oprod.rb(S, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2], [0.0046, 0.0074, L + 0.004], { rot: [Math.atan2(dy, -dz) / DEG, Math.atan2(-dx, -dz) / DEG, 0], r: 0.0012, seg: 2, wear: 1.3 }); } }
    oprod.rext(S, roundPoly([[-0.060, -0.0065, 0.002], [-0.012, -0.0065, 0.002], [-0.006, 0.0040, 0.003], [-0.010, 0.0205, 0.004], [-0.027, 0.0228, 0.005], [-0.036, 0.0110, 0.003], [-0.052, 0.0035, 0.004]]), 0.0165, 0.0208, { r: 0.0009, seg: 2, wear: 1.4 });
    oprod.cyl(S, [0.0292, 0.0185, -0.024], 0.0058, 0.0168, { axis: 'x', seg: 24, b: 0.0009 });
    oprod.knurl(S, [0.0389, 0.0185, -0.024], 0.0060, 0.0026, { axis: 'x', n: 40, depth: 0.0004, wear: 2.2 });
    oprod.rext(BO, roundPoly([[-0.030, 0.0000, 0.001], [-0.014, 0.0000, 0.001], [-0.014, 0.0030, 0.001], [-0.030, 0.0030, 0.001]]), 0.0207, 0.0211, { r: 0.0001, seg: 1, wear: 0 }); // cam cut in the rod
    // ------------------------------------------------------------ trigger group: guard (locks the action), safety, trigger, mag latch, pins
    R.rext(S, roundPoly([[0.020, -0.0455], [0.0160, -0.0690, 0.008], [0.0290, -0.0825, 0.011], [0.0960, -0.0850, 0.009], [0.1130, -0.0610, 0.004], [0.1060, -0.0600, 0.002], [0.0960, -0.0735, 0.005], [0.0360, -0.0725, 0.007], [0.0305, -0.0645, 0.004], [0.0320, -0.0480]]), -0.0060, 0.0060, { r: 0.0010, seg: 2, wear: 1.2 });
    R.rext(S, roundPoly([[0.0180, -0.0425], [0.1150, -0.0425], [0.1170, -0.0495, 0.001], [0.0180, -0.0495, 0.001]]), -0.0120, 0.0120, { r: 0.0009, seg: 2 }); // guard base
    R.rext(S, roundPoly([[0.0330, -0.0470], [0.0395, -0.0470], [0.0380, -0.0600, 0.002], [0.0350, -0.0600, 0.002]]), -0.0022, 0.0022, { r: 0.0004, seg: 1 }); // safety
    R.rb(S, [0, -0.0490, 0.0115], [0.0100, 0.0070, 0.0085], { r: 0.0010, seg: 2 }); for (let i = 0; i < 5; i++) R.rb(BO, [0, -0.0526, 0.0080 + i * 0.0015], [0.0080, 0.0006, 0.0006], { r: 0.0001, seg: 1, wear: 0 }); // magazine latch, serrated
    pin(R, S, -0.0456, 0.0975, 0.0022, -0.0120, 0.0120); pin(R, S, -0.0456, 0.0205, 0.0018, -0.0120, 0.0120);
    R.quad(MK, [-0.0121, -0.0468, 0.0770], qw(0.0025, 0.32), 0.0025, row(6, 0.32), { r: [0, -90, 0] });
    trigger.rext(S, roundPoly([[0.0555, -0.0475], [0.0508, -0.0600, 0.004], [0.0538, -0.0725, 0.002], [0.0588, -0.0705, 0.002], [0.0608, -0.0525]]), -0.0034, 0.0034, { r: 0.0007, seg: 2, wear: 1.5 });
    // ------------------------------------------------------------ 20-round box magazine: tapered pressed body, panels + ribs, folded floorplate, follower + top round
    mag.rext(MG, roundPoly([[-0.0515, -0.0100, 0.002], [0.0260, -0.0100, 0.002], [0.0305, -0.1175, 0.004], [-0.0455, -0.1235, 0.004]]), -0.0130, 0.0130, { r: 0.0013, seg: 2 });
    for (const sx of [-1, 1]) {
      mag.rext(MG, roundPoly([[-0.0400, -0.0320], [0.0175, -0.0320], [0.0205, -0.1045, 0.002], [-0.0360, -0.1085, 0.002]]), sx > 0 ? 0.0126 : -0.0140, sx > 0 ? 0.0140 : -0.0126, { r: 0.0005, seg: 1 }); // pressed panel
      mag.rext(MG, roundPoly([[-0.0080, -0.020], [-0.0050, -0.020], [-0.0020, -0.112, 0.001], [-0.0050, -0.112, 0.001]]), sx > 0 ? 0.0138 : -0.0144, sx > 0 ? 0.0144 : -0.0138, { r: 0.0003, seg: 1 }); // centre rib
      for (let i = 0; i < 3; i++) mag.rb(BO, [sx * 0.0141, -0.0665 - i * 0.0126, -0.0070 + i * 0.0009], [0.0004, 0.0032, 0.0090], { r: 0.0001, seg: 1, wear: 0 }); // witness slots
    }
    mag.rb(MG, [0, -0.1262, -0.0085], [0.0298, 0.0060, 0.0840], { rot: [-4, 0, 0], r: 0.0016, seg: 2, wear: 1.3 }); // floorplate
    for (const sx of [-1, 1]) mag.rb(MG, [sx * 0.0146, -0.1236, -0.0083], [0.0012, 0.0050, 0.0800], { rot: [-4, 0, 0], r: 0.0004, seg: 1 }); // folded lip
    mag.rb(BO, [0, -0.0097, -0.0128], [0.0232, 0.0008, 0.0692], { r: 0.0002, seg: 1, wear: 0 }); // open mouth (dark)
    for (const sx of [-1, 1]) mag.rb(MG, [sx * 0.0116, -0.0104, -0.0128], [0.0030, 0.0034, 0.0704], { r: 0.0008, seg: 1, wear: 1.2 }); // side feed lips
    mag.rb(MG, [0, -0.0104, -0.0490], [0.0256, 0.0034, 0.0030], { r: 0.0008, seg: 1, wear: 1.2 }); mag.rb(MG, [0, -0.0104, 0.0230], [0.0256, 0.0034, 0.0030], { r: 0.0008, seg: 1, wear: 1.2 }); // front / rear lips
    mag.rb(S, [0, -0.0090, -0.0120], [0.0200, 0.0012, 0.0700], { r: 0.0004, seg: 1 }); // follower
    round.cyl(BR, [0, -0.0125, -0.004], 0.0060, 0.051, { axis: 'z', seg: 24, b: 0.0006 });
    round.rlathe(CU, [0, -0.0125, 0], [[0, -0.0505], [0.0022, -0.049], [0.0038, -0.045], [0.00391, -0.040], [0.00391, -0.030], [0, -0.030]], { axis: 'z', seg: 24 });
    K.socket('muzzle', 'root', [0, 0, -0.615]); K.socket('eject', 'root', [0.012, 0.012, 0.0]);
    K.socket('sightRear', 'root', [0, 0.032, 0.152]); K.socket('sightFront', 'root', [0, 0.032, -0.536]);
    return { length: 1.12, sightHeight: 0.032, rearSightZ: 0.152, frontSightZ: -0.536 };
  },
};
