// MP5A3 (9x19) - HSB round: every part is a filleted, bone-weighted solid (see hsb-kit.js); stamped 1.0 mm tube receiver with a REAL ejection-port cut, hollow cocking tube,
// knurled rotary diopter drum (hollow, aperture plate), hooded front sight ring, ribbed polymer handguard, Navy trigger group, retractable A3 stock.
// Reference (mm, real -> in-engine via hsb.js T.dims): overall 660 (stock out) -> 669 | barrel 225 -> 226 | receiver 42.4 wide, 1.0 sheet | sight radius 340 -> 354 |
//   handguard 101 long x 46 wide | magazine 30-rd 185 long x 23.6 wide | height incl. mag 260 (from tube top) -> 263 | mass 2.5 kg | 800 rpm (specs.js).
// gun-local frame: -Z = muzzle, +Y up, +X right, origin = bore axis at the breech face.
import { hsb, rrect, circ, slot, strip, roundPoly, arcPts, bezPts } from '../hsb-kit.js';
import '../hsb-mats.js';

const ADR = 'hDrum', P = 'hPaint', PO = 'hPolymer', ST = 'hPhos', BR = 'hBrass', CU = 'hBrass', BO = 'hRubber', RB = 'hRubber', MK = 'marks:mp5';
const Z6 = [0, 0, 0, 0, 0, 0];
const PL = [-1, -0.3, 0.15]; // left elbow out to the side while working the cocking handle (forearm comes in from the left, not up through the view)
const DRAWN = [0.03, -0.2, 0.05, -45, 12, -25];

export default {
  id: 'mp5',
  handling: {
    hip: { p: [0.094, -0.108, -0.24], r: [0.8, 2.6, 0] }, eye: 0.075, sprint: { p: [0.06, -0.12, -0.22], r: [5, 48, 38] },
    pivot: [0, -0.03, 0.40], animPivot: [0, -0.05, 0.0], wall: { p: [0, -0.03, 0.08], r: [28, 12, -12] },
    shoulderR: [0.15, -0.22, 0.12], shoulderL: [-0.19, -0.25, 0.06], poleR: [0.8, -0.8, 0.2], poleL: [-0.5, -1, 0.1],
    hands: { R: { f: 'gripR', pose: 'rifleGrip' }, L: { f: 'foreL', pose: 'handguard' } },
    frames: {
      gripR: { part: 'root', p: [0.0215, -0.0830, 0.0720], fd: [0, -0.42, -0.91], pn: [-1, 0, 0] },
      foreL: { part: 'root', p: [-0.004, -0.0395, -0.128], fd: [0.9, 0.12, -0.42], pn: [0.05, 1, 0.1] },
      magL: { part: 'mag', p: [-0.030, -0.070, -0.032], fd: [0.4, -0.25, -0.88], pn: [1, 0.05, 0.1] },
      chargeL: { part: 'charge', p: [-0.046, 0.030, -0.096], fd: [0.35, -0.8, -0.45], pn: [0.4, -0.3, 0.86] },
      slapL: { part: 'root', p: [-0.022, 0.085, -0.030], fd: [0.55, -0.2, -0.8], pn: [0.15, -1, 0.05] }, // HK slap: flat palm onto the locked-up handle tip (-0.021, 0.062, -0.036), fingers forward-right
    },
    parts(rig, st) {
      rig.set('selector', 0, 0, 0, 0, 0, 0); rig.scale('round', st.mag > 1 ? 1 : 0);
      if (st.boltLocked) { rig.set('bolt', 0, 0, 0.068); rig.set('charge', 0, 0, 0.074, 0, 0, -1.1); }
    },
    clips: {
      fire: { dur: 0.074, events: [[0.01, 'eject']], tracks: { bolt: [[0, [0, 0, 0]], [0.018, [0, 0, 0.052], 'out'], [0.05, [0, 0, 0], 'in']], trigger: [[0, [0, 0, 0, 12, 0, 0]], [0.074, [0, 0, 0, 12, 0, 0]]] } },
      dry: { dur: 0.14, tracks: { trigger: [[0, [0, 0, 0, 12, 0, 0]], [0.14, Z6, 'out']] } },
      draw: { dur: 0.5, events: [[0.0, 'snd', 'draw']], tracks: { gun: [[0, DRAWN], [0.5, Z6, 'out3']] } },
      holster: { dur: 0.3, tracks: { gun: [[0, Z6], [0.3, DRAWN, 'in']] } },
      firstDraw: { dur: 1.2, events: [[0.0, 'snd', 'draw'], [0.55, 'snd', 'chargeBack'], [0.86, 'snd', 'chargeSlap'], [1.02, 'snd', 'selector']], tracks: {
        gun: [[0, DRAWN], [0.4, [-0.02, 0.02, 0.0, 4, -8, -18], 'out3'], [0.7, [-0.02, -0.015, -0.06, 2, -6, 22], 'io'], [0.86, [-0.02, -0.024, -0.062, 0, -6, 25], 'in'], [0.9, [-0.02, -0.016, -0.066, 3, -6, 24], 'out'], [1.2, Z6, 'io']],
        charge: [[0.45, Z6], [0.58, [0, 0, 0.074, 0, 0, 0], 'out'], [0.66, [0, 0, 0.074, 0, 0, -63], 'io'], [0.85, [0, 0, 0.074, 0, 0, -63]], [0.88, [0, 0, 0.074, 0, 0, 0], 'out'], [0.93, Z6, 'in']],
        bolt: [[0.45, [0, 0, 0]], [0.58, [0, 0, 0.068], 'out'], [0.88, [0, 0, 0.068]], [0.93, [0, 0, 0], 'in']],
        L: [[0, { f: 'rest' }], [0.4, { f: 'chargeL', pose: 'pinch', pole: PL }, 'io'], [0.66, { f: 'chargeL', pose: 'pinch', pole: PL }], [0.78, { f: 'slapL', p: [0, 0.04, 0.01], pose: 'slap', pole: PL }, 'io'], [0.86, { f: 'slapL', pose: 'slap', pole: PL }, 'in'], [0.95, { f: 'slapL', p: [0, 0.03, 0.02], pose: 'slap', pole: PL }, 'out'], [1.2, { f: 'rest' }, 'io']] } },
      reload: {
        scale: 1.095, dur: 2.1, events: [[0.34, 'snd', 'magout'], [1.38, 'snd', 'magin'], [1.4, 'magFill']],
        tracks: {
          gun: [[0, Z6], [0.28, [-0.07, 0.02, -0.12, 6, 18, -40], 'io'], [1.3, [-0.075, 0.024, -0.12, 7, 19, -43], 'io'], [1.42, [-0.07, 0.016, -0.11, 5, 18, -40], 'out'], [1.55, [-0.075, 0.024, -0.12, 7, 19, -43], 'io'], [2.1, Z6, 'io']],
          mag: [[0.3, Z6], [0.42, [0, -0.06, -0.004, -4, 0, 0], 'in'], [0.62, [-0.03, -0.3, 0.02, -20, 20, 10], 'in'], [0.78, [-0.05, -0.34, 0.02, -30, 30, 20], 'step'], [1.18, [0, -0.06, -0.002, -5, 0, 0], 'out'], [1.32, [0, -0.012, 0, 0, 0, 0], 'io'], [1.4, Z6, 'in']],
          L: [[0, { f: 'rest' }], [0.28, { f: 'magL', pose: 'magGrip' }, 'io'], [0.6, { f: 'magL', pose: 'magGrip' }], [0.78, { f: 'magL', pose: 'magGrip' }, 'step'], [1.4, { f: 'magL', pose: 'magGrip' }], [1.47, { f: 'magL', p: [0.0, -0.05, 0.03], pose: 'slap' }, 'out'], [1.52, { f: 'magL', p: [0.0, -0.064, 0.03], pose: 'slap' }, 'out'], [1.62, { f: 'magL', p: [-0.01, -0.09, 0.05], pose: 'slap' }, 'out'], [2.0, { f: 'rest' }, 'io']] } },
      reloadEmpty: {
        dur: 2.6, events: [[0.14, 'snd', 'chargeBack'], [0.72, 'snd', 'magout'], [1.74, 'snd', 'magin'], [1.76, 'magFill'], [2.12, 'snd', 'chargeSlap']],
        tracks: {
          gun: [[0, Z6], [0.2, [-0.02, 0.02, -0.03, 4, -8, -16], 'io'], [0.5, [-0.07, 0.02, -0.12, 6, 18, -40], 'io'], [1.6, [-0.075, 0.024, -0.12, 7, 19, -43], 'io'], [1.8, [-0.07, 0.016, -0.11, 5, 18, -40], 'out'], [2.0, [-0.02, -0.02, -0.07, 2, -6, 24], 'io'], [2.12, [-0.02, -0.026, -0.064, 0, -6, 25], 'in'], [2.16, [-0.02, -0.018, -0.068, 3, -6, 24], 'out'], [2.6, Z6, 'io']],
          charge: [[0.08, Z6], [0.2, [0, 0, 0.074, 0, 0, 0], 'out'], [0.3, [0, 0, 0.074, 0, 0, -63], 'io'], [2.1, [0, 0, 0.074, 0, 0, -63]], [2.12, [0, 0, 0.074, 0, 0, 0], 'out'], [2.17, Z6, 'in']],
          bolt: [[0.08, [0, 0, 0]], [0.2, [0, 0, 0.068], 'out'], [2.12, [0, 0, 0.068]], [2.17, [0, 0, 0], 'in']],
          mag: [[0.66, Z6], [0.78, [0, -0.06, -0.004, -4, 0, 0], 'in'], [0.98, [-0.03, -0.3, 0.02, -20, 20, 10], 'in'], [1.14, [-0.05, -0.34, 0.02, -30, 30, 20], 'step'], [1.56, [0, -0.06, -0.002, -5, 0, 0], 'out'], [1.68, [0, -0.012, 0, 0, 0, 0], 'io'], [1.76, Z6, 'in']],
          L: [[0, { f: 'rest' }], [0.1, { f: 'chargeL', pose: 'pinch', pole: PL }, 'io'], [0.3, { f: 'chargeL', pose: 'pinch', pole: PL }], [0.62, { f: 'magL', pose: 'magGrip' }, 'io'], [0.96, { f: 'magL', pose: 'magGrip' }], [1.14, { f: 'magL', pose: 'magGrip' }, 'step'], [1.76, { f: 'magL', pose: 'magGrip' }], [1.84, { f: 'magL', p: [0, -0.05, 0.03], pose: 'slap' }, 'out'],
            [1.98, { f: 'slapL', p: [0, 0.04, 0.01], pose: 'slap', pole: PL }, 'io'], [2.12, { f: 'slapL', pose: 'slap', pole: PL }, 'in'], [2.2, { f: 'slapL', p: [0, 0.03, 0.02], pose: 'slap', pole: PL }, 'out'], [2.6, { f: 'rest' }, 'io']] } },
    },
  },
  build(K, M) {
    M.util();
    M.marks('mp5', 1024, 256, (g) => {
      g.font = 'bold 40px "Arial", sans-serif'; g.textBaseline = 'middle'; g.fillText('MP5A3', 12, 32); g.fillText('Kal. 9mm x19', 12, 96); g.fillText('D 71204', 12, 160);
      g.font = 'bold 44px "Arial", sans-serif'; g.fillText('S', 620, 32); g.fillText('E', 700, 32); g.fillText('F', 780, 32);
      g.lineWidth = 5; g.beginPath(); g.arc(640, 160, 20, 0, 7); g.stroke(); g.fillRect(700, 146, 36, 28); g.fillRect(760, 146, 18, 28); g.fillRect(790, 146, 18, 28); g.fillRect(820, 146, 18, 28);
    }, { color: 0xc4c6c6, rough: 0.5, metal: 0.5 });
    const row = (i, u0, u1) => [u0, 1 - (i + 1) / 4 + 0.01, u1, 1 - i / 4 - 0.01]; const qw = (hh, du) => hh * (du * 1024 / 64) * 0.98;
    const h = hsb(K); const { ex, ez, ey, bx, lt, cy, tb, rv, bar, spring, sx: strap } = h; const R = K.root;
    const bolt = K.part('bolt', { pivot: [0, 0.004, 0.0] }), charge = K.part('charge', { pivot: [0, 0.021, -0.11] }), trigger = K.part('trigger', { pivot: [0, -0.034, 0.035] });
    const selector = K.part('selector', { pivot: [-0.0172, -0.030, 0.066] }), mag = K.part('mag', { pivot: [0, -0.07, -0.024] }), round = K.part('round', { parent: 'mag', pivot: [0, -0.012, -0.02] });
    const both = (f) => { f(1); f(-1); };
    // ------------------------------------------------------------ stamped receiver: 1.0 mm tube (round top r 21.2, flat pressed sides with a long stiffening bead, flat welded floor)
    // the ejection port is a real cut: right upper quadrant removed between z 0.020 and 0.058
    const RO = 0.0212, RI = 0.0202, YC = 0.0100, YB = -0.0238, YI = YB + 0.0010;
    const bead = (sxn, o) => sxn > 0 ? [[RO, -0.0170], [RO + o, -0.0160], [RO + o, -0.0050], [RO, -0.0040]] : [[-RO, -0.0040], [-RO - o, -0.0050], [-RO - o, -0.0160], [-RO, -0.0170]];
    const outerAll = () => [...arcPts(0, YC, RO, 0, 180, 26), ...bead(-1, 0.0016), [-RO, YB, 0.0022], [RO, YB, 0.0022], ...bead(1, 0.0016)];
    const innerAll = () => [...arcPts(0, YC, RI, 0, 180, 26), [-RI, YI, 0.0012], [RI, YI, 0.0012]];
    const outerPort = () => [...arcPts(0, YC, RO, 64, 180, 14), ...bead(-1, 0.0016), [-RO, YB, 0.0022], [RO, YB, 0.0022], [RO, -0.0040], [RI, -0.0040], [RI, YI, 0.0012], [-RI, YI, 0.0012], ...arcPts(0, YC, RI, 180, 64, 14)];
    ez(R, P, outerAll(), -0.0700, 0.0200, { r0: 0.0004, r1: 0, segs: 1, holes: [innerAll()] });
    ez(R, P, outerPort(), 0.0200, 0.0580, { r: 0, segs: 1 });
    ez(R, P, outerAll(), 0.0580, 0.1900, { r0: 0, r1: 0.0004, segs: 1, holes: [innerAll()] });
    ez(R, P, outerAll().map((p) => [p[0] * 1.035, p[1] > YC ? p[1] + 0.0006 : p[1], p[2]]), 0.1900, 0.2030, { r: 0.0007, segs: 2, holes: [] }); // receiver end cap (flared, closed)
    ez(R, P, outerAll().map((p) => [p[0] * 1.05, YC + (p[1] - YC) * 1.05, p[2]]), -0.0742, -0.0700, { r: 0.0008, segs: 2, holes: [] }); // barrel-nut / trunnion collar at the receiver front
    // trunnion block visible inside the port + bolt seat, port lip shadow
    ex(R, BO, [[0.0225, -0.0040, 0.001], [0.0555, -0.0040, 0.001], [0.0555, 0.0270, 0.001], [0.0225, 0.0270, 0.001]], 0.0100, 0.0118, { r: 0.0003, segs: 1, wear: 0 });
    // spot welds / rivets on the tube sides, front trunnion rivets, takedown pin heads
    both((s) => { const ax = s > 0 ? 'x' : '-x'; for (const [z, y] of [[-0.0640, -0.0100], [-0.0640, 0.0100], [-0.0500, -0.0195], [0.0900, -0.0195], [0.1500, -0.0195], [0.1900, -0.0195], [-0.0230, -0.0195]]) rv(R, P, [s * (RO + 0.0011), y, z], 0.0018, { axis: ax, h: 0.0009, seg: 8 });
      rv(R, ST, [s * (RO + 0.0011), -0.0020, 0.1965], 0.0040, { axis: ax, h: 0.0022 }); }); // rear takedown pin heads
    bx(R, ST, [0, YB - 0.0002, 0.0600], [0.0014, 0.0006, 0.2400], { r: 0.0002, wear: 0.5 }); // welded seam along the floor
    // ------------------------------------------------------------ magazine well (flared lip), paddle release, push-button release
    ey(R, P, rrect(-0.0196, 0.0196, -0.0560, 0.0090, 0.0040), -0.0490, -0.0225, { r: 0.0008, holes: [rrect(-0.0128, 0.0128, -0.0500, 0.0030, 0.0030)] });
    both((s) => ex(R, P, [[-0.0540, -0.0290, 0.003], [0.0080, -0.0290, 0.002], [0.0080, -0.0440, 0.002], [-0.0530, -0.0470, 0.004]], s > 0 ? 0.0134 : -0.0146, s > 0 ? 0.0146 : -0.0134, { r: 0.0005, segs: 1 })); // pressed side stiffening panels
    bx(R, P, [0, -0.0525, 0.0130], [0.0170, 0.0040, 0.0140], { r: 0.0012, rot: [-18, 0, 0] }); // paddle release
    cy(R, ST, [0.0200, -0.0340, -0.0120], 0.0038, 0.0050, { axis: 'x', seg: 14 }); // push-button release (right)
    // ------------------------------------------------------------ cocking tube (hollow), lock notch, barrel + 3-lug muzzle, hooded front sight, sling loop
    tb(R, P, [0, 0.0210, -0.1350], 0.0105, 0.0090, 0.1300, { axis: 'z', seg: 28, r: 0.0007 });
    ex(R, P, [[-0.1900, 0.0020, 0.001], [-0.0840, 0.0020, 0.001], [-0.0840, -0.0032, 0.001], [-0.1900, -0.0032, 0.001]], -0.0118, -0.0100, { r: 0.0004, segs: 1, wear: 0.3 }); // handle slot lip (left)
    bx(R, P, [-0.0098, 0.0280, -0.0780], [0.0036, 0.0040, 0.0080], { r: 0.0007 }); // lock-up notch
    for (const z of [-0.1930, -0.0770]) tb(R, ST, [0, 0.0210, z], 0.0116, 0.0088, 0.0050, { axis: 'z', seg: 28, r: 0.0006 }); // tube collars
    lt(R, P, [0, 0, 0], [[0.0045, -0.2260], [0.0094, -0.2260], [0.0094, -0.2170, 0.0004], [0.0102, -0.2165], [0.0102, -0.2050, 0.0004], [0.0094, -0.2045], [0.0094, -0.0700], [0.0045, -0.0700]], { axis: 'z', seg: 28 });
    lt(R, BO, [0, 0, 0], [[0.0, -0.2262], [0.0046, -0.2262], [0.0046, -0.2100], [0.0, -0.2100]], { axis: 'z', seg: 14, wear: 0 }); // bore
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + Math.PI / 2; bx(R, P, [Math.cos(a) * 0.0109, Math.sin(a) * 0.0109, -0.2120], [0.0050, 0.0032, 0.0080], { r: 0.0005, rot: [0, 0, a * 57.2958] }); }
    // front sight: base block, pillar, ring hood, blade
    ex(R, P, [[-0.2040, -0.0060, 0.003], [-0.1840, -0.0060, 0.003], [-0.1840, 0.0250, 0.003], [-0.2040, 0.0250, 0.003]], -0.0072, 0.0072, { r: 0.0010 });
    ey(R, P, roundPoly([[-0.0060, -0.2010, 0.0015], [0.0060, -0.2010, 0.0015], [0.0060, -0.1870, 0.0015], [-0.0060, -0.1870, 0.0015]], 40), 0.0240, 0.0345, { r: 0.0006 });
    tb(R, P, [0, 0.0465, -0.1940], 0.0128, 0.0106, 0.0110, { axis: 'z', seg: 32, r: 0.0006 }); // protective ring
    bx(R, ST, [0, 0.0420, -0.1940], [0.0016, 0.0130, 0.0040], { r: 0.0003 }); // blade (tip 0.0485)
    bx(R, P, [0, 0.0300, -0.1940], [0.0150, 0.0100, 0.0100], { r: 0.0007 });
    R.torus(ST, [-0.0135, 0.0040, -0.1940], 0.0055, 0.0012, { r: [0, 90, 0], seg: 8, tube: 18 }); // front sling loop
    // ------------------------------------------------------------ handguard (polymer, ribbed): tapering rounded section, barrel channel, lip, grip ribs
    const hg = []; for (let z = -0.0710; z >= -0.1725; z -= 0.0026) { const t = (-0.0710 - z) / 0.1015, hw = 0.0232 - 0.0020 * t + (z < -0.1700 ? 0.0008 : 0), yb = -0.0254 + 0.0018 * t, yt = 0.0124 - 0.0010 * t; hg.push({ z, pts: rrect(-hw, hw, yb, yt, 0.0105, 22) }); }
    R.polyLoft(PO, hg, { N: 64, wear: 0.35, wearK: 0.0008, uv: 'box' });
    both((s) => rv(R, ST, [s * 0.0234, -0.0100, -0.0785], 0.0026, { axis: s > 0 ? 'x' : '-x', h: 0.0014 })); // handguard retaining pins
    both((s) => { for (let i = 0; i < 5; i++) { const y = -0.0195 + i * 0.0052; ex(R, PO, slot(-0.1660, y, -0.0800, y, 0.0030, 4), s > 0 ? 0.0212 : -0.0236, s > 0 ? 0.0236 : -0.0212, { r: 0.0005, segs: 1, wear: 0.3 }); } });
    for (let i = 0; i < 5; i++) { const x = -0.0140 + i * 0.0070; ey(R, PO, slot(x, -0.1660, x, -0.0800, 0.0030, 4), -0.0276, -0.0244, { r: 0.0005, segs: 1, wear: 0.3 }); } // bottom ribs
    // ------------------------------------------------------------ rear sight: base, ears, hollow rotary drum (knurled crescents + end discs), peep plate with the aperture
    const DC = [0.160, 0.0465]; bx(R, P, [0, 0.0350, 0.1580], [0.0230, 0.0090, 0.0360], { r: 0.0015 });
    both((s) => ex(R, P, [[0.1420, 0.0330, 0.002], [0.1780, 0.0330, 0.002], [0.1760, 0.0585, 0.004], [0.1500, 0.0585, 0.004]], s > 0 ? 0.0122 : -0.0154, s > 0 ? 0.0154 : -0.0122, { r: 0.0007 }));
    const knurl = (Ro, Ri, a0, a1) => { const o = []; const n = Math.round(Math.abs(a1 - a0) / 2.2); for (let k = 0; k <= n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180, rr = k % 2 ? Ro - 0.00045 : Ro; o.push([DC[0] + Math.cos(a) * rr, DC[1] + Math.sin(a) * rr]); } for (let k = n; k >= 0; k--) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; o.push([DC[0] + Math.cos(a) * Ri, DC[1] + Math.sin(a) * Ri]); } return o; };
    ex(R, ADR, knurl(0.0116, 0.0100, 26, 154), -0.0098, 0.0098, { r: 0.0004, segs: 1, crease: 60 }); ex(R, ADR, knurl(0.0116, 0.0100, 206, 334), -0.0098, 0.0098, { r: 0.0004, segs: 1, crease: 60 });
    both((s) => { lt(R, ADR, [s * 0.0111, DC[1], DC[0]], [[0, 0], [0.0103, 0, 0.0004], [0.0103, 0.0014, 0.0004], [0.0040, 0.0014], [0.0040, 0.0020], [0, 0.0020]], { axis: s > 0 ? 'x' : '-x', seg: 28 }); }); // end discs with hub
    ez(R, ADR, [...rrect(-0.0092, 0.0092, DC[1] - 0.0100, DC[1] + 0.0100, 0.0030, 30)], 0.1720, 0.1735, { r: 0.0004, segs: 1, holes: [circ(0, DC[1], 0.0014, 14)] }); // peep plate (aperture 2.8 mm)
    rv(R, ST, [0.0161, DC[1] - 0.0030, 0.1600], 0.0032, { axis: 'x', h: 0.0018 }); // windage screw head
    // ------------------------------------------------------------ retractable A3 stock: strut guides, flat steel struts, yoke, polymer butt + rubber pad
    ez(R, P, rrect(-0.0230, -0.0128, -0.0130, 0.0035, 0.0020), 0.0920, 0.2100, { r: 0.0006, caps0: false }); ez(R, P, rrect(0.0128, 0.0230, -0.0130, 0.0035, 0.0020), 0.0920, 0.2100, { r: 0.0006, caps0: false });
    both((s) => bar(R, ST, [s * 0.0195, -0.0045, 0.2050], [s * 0.0195, -0.0045, 0.4080], 0.0062, 0.0104, { r: 0.0011 }));
    ex(R, ST, [[0.4020, 0.0040, 0.003], [0.4180, 0.0060, 0.004], [0.4180, -0.0120, 0.004], [0.4020, -0.0120, 0.003]], -0.0250, 0.0250, { r: 0.0008 }); // strut yoke
    ex(R, PO, [[0.4140, 0.0300, 0.012], [0.4280, 0.0320, 0.008], [0.4300, -0.0760, 0.012], [0.4140, -0.0730, 0.012], [0.4080, -0.0200, 0.010]], -0.0225, 0.0225, { r: 0.0022, segs: 3 });
    ex(R, RB, [[0.4280, 0.0300, 0.012], [0.4390, 0.0300, 0.010], [0.4410, -0.0760, 0.010], [0.4280, -0.0760, 0.010]], -0.0240, 0.0240, { r: 0.0028, segs: 3 });
    for (let i = 0; i < 8; i * 1 + 1 && i++) ex(R, RB, [[0.4405, 0.0250 - i * 0.0125, 0.0004], [0.4425, 0.0250 - i * 0.0125, 0.0004], [0.4425, 0.0200 - i * 0.0125, 0.0004], [0.4405, 0.0200 - i * 0.0125, 0.0004]], -0.0200, 0.0200, { r: 0.0002, segs: 1 }); // pad grip ridges
    R.torus(ST, [0, 0.0120, 0.4260], 0.0055, 0.0012, { r: [0, 0, 0], seg: 8, tube: 18 }); // rear sling loop
    bx(R, ST, [0, 0.0360, 0.2120], [0.0120, 0.0060, 0.0100], { r: 0.0009 }); // stock release lever
    // ------------------------------------------------------------ trigger group (polymer): housing, guard, pistol grip with stippled + checkered panels, selector, trigger
    ex(R, PO, [[-0.0040, -0.0230, 0.001], [0.1000, -0.0230, 0.003], [0.1000, -0.0400, 0.004], [0.0900, -0.0480, 0.005], [-0.0040, -0.0460, 0.004]], -0.0172, 0.0172, { r: 0.0016, segs: 2 });
    ex(R, PO, [[-0.0040, -0.0440], [-0.0060, -0.0580, 0.006], [0.0040, -0.0700, 0.010], [0.0500, -0.0720, 0.006], [0.0580, -0.0600], [0.0500, -0.0620, 0.003], [0.0080, -0.0620, 0.006], [0.0040, -0.0540, 0.004], [0.0060, -0.0460]], -0.0088, 0.0088, { r: 0.0013 });
    const gripO = [[0.0480, -0.0460], [0.0940, -0.0460, 0.004], [0.1060, -0.0780, 0.012], [0.1180, -0.1280, 0.008], [0.1100, -0.1380, 0.006], [0.0820, -0.1360, 0.006], [0.0720, -0.1020, 0.010], [0.0640, -0.0880, 0.006], [0.0680, -0.0780, 0.006], [0.0580, -0.0680, 0.006], [0.0600, -0.0580, 0.004]];
    ex(R, PO, gripO, -0.0157, 0.0157, { r: 0.0034, segs: 3, uv: 'box' });
    both((s) => { for (let i = 0; i < 7; i++) { const y = -0.0790 - i * 0.0074; ex(R, PO, slot(0.0790 + i * 0.0024, y, 0.1075 + i * 0.0018, y, 0.0026, 3), s > 0 ? 0.0155 : -0.0170, s > 0 ? 0.0170 : -0.0155, { r: 0.0004, segs: 1, wear: 0.3 }); } });
    ex(R, PO, [[0.0800, -0.1360, 0.003], [0.1130, -0.1360, 0.003], [0.1150, -0.1420, 0.003], [0.0790, -0.1420, 0.003]], -0.0160, 0.0160, { r: 0.0007 }); // heel
    both((s) => { rv(R, ST, [s * 0.0172, -0.0350, 0.0040], 0.0028, { axis: s > 0 ? 'x' : '-x', h: 0.0014 }); rv(R, ST, [s * 0.0172, -0.0350, 0.0820], 0.0028, { axis: s > 0 ? 'x' : '-x', h: 0.0014 }); }); // takedown / trigger pins
    ex(selector, ST, [[-0.0040, 0.0040, 0.003], [0.0040, 0.0040, 0.003], [0.0040, -0.0040], [-0.0200, -0.0100, 0.004], [-0.0220, -0.0060, 0.003]], -0.0192, -0.0172, { r: 0.0005, p: [0, -0.0300, 0.0660], wear: 2 });
    cy(selector, ST, [-0.0190, -0.0300, 0.0660], 0.0048, 0.0028, { axis: 'x', seg: 18, r: 0.0005 });
    ex(trigger, ST, [[0.0290, -0.0460], [0.0240, -0.0560, 0.004], [0.0270, -0.0660, 0.002], [0.0320, -0.0640, 0.002], [0.0340, -0.0500]], -0.0035, 0.0035, { r: 0.0006, wear: 2 });
    // ------------------------------------------------------------ bolt (seen in the port), cocking handle (HK slap handle)
    bx(bolt, ST, [0, 0.0040, 0.0320], [0.0220, 0.0180, 0.0520], { r: 0.0015 });
    cy(bolt, BO, [0.0090, 0.0040, 0.0120], 0.0022, 0.0200, { axis: 'z', seg: 10, r: 0 });
    cy(charge, ST, [-0.0145, 0.0210, -0.1100], 0.0035, 0.0120, { axis: 'x', seg: 12, r: 0.0005 });
    ex(charge, ST, [[-0.1160, 0.0245, 0.002], [-0.1040, 0.0245, 0.002], [-0.1020, 0.0175, 0.002], [-0.1180, 0.0175, 0.002]], -0.0460, -0.0180, { r: 0.0008 });
    lt(charge, PO, [-0.0470, 0.0210, -0.1100], [[0, -0.0050], [0.0060, -0.0050, 0.0008], [0.0065, 0.0040, 0.0008], [0, 0.0050]], { axis: 'x', seg: 18 });
    // ------------------------------------------------------------ 30-rd curved magazine (blued steel), pressed ribs, witness holes, baseplate
    const front = [[-0.0455, -0.012], ...bezPts([-0.0455, -0.030], [-0.0470, -0.110], [-0.058, -0.170], [-0.074, -0.212], 12)], back = [[-0.0105, -0.012], ...bezPts([-0.0105, -0.030], [-0.0115, -0.115], [-0.024, -0.182], [-0.042, -0.228], 12)];
    const magO = [...back, [-0.050, -0.2310, 0.004], [-0.082, -0.2180, 0.004], ...front.slice().reverse()];
    ex(mag, P, magO, -0.0118, 0.0118, { r: 0.0012, segs: 2, deg: 30 });
    const zAt = (crv, y) => { for (let i = 0; i < crv.length - 1; i++) { const a = crv[i], b = crv[i + 1]; if ((a[1] - y) * (b[1] - y) <= 0) return a[0] + (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 1); } return crv[crv.length - 1][0]; };
    both((s) => { for (const dz of [0.0100, 0.0210]) ex(mag, P, (() => { const o = []; for (let y = -0.0500; y > -0.2000; y -= 0.010) o.push([zAt(front, y) + dz, y]); for (let y = -0.2000; y <= -0.0500; y += 0.010) o.push([zAt(front, y) + dz + 0.0022, y]); return o; })(), s > 0 ? 0.0114 : -0.0126, s > 0 ? 0.0126 : -0.0114, { r: 0.0004, segs: 1, wear: 0.4 }); }); // two pressed vertical ribs per side
    bx(mag, PO, [0, -0.2295, -0.0660], [0.0260, 0.0060, 0.0400], { r: 0.0012, rot: [-26, 0, 0] }); // baseplate
    ey(mag, P, rrect(-0.0118, 0.0118, -0.0470, -0.0090, 0.0020), -0.0140, -0.0100, { r: 0.0004, holes: [rrect(-0.0100, 0.0100, -0.0452, -0.0108, 0.0012)] }); bx(mag, ST, [0, -0.0160, -0.0280], [0.0180, 0.0025, 0.0300], { r: 0.0006 }); // feed lips + follower
    both((s) => { for (let i = 0; i < 5; i++) { const y = -0.0600 - i * 0.0300; rv(mag, ST, [s * 0.0118, y, (zAt(front, y) + zAt(back, y)) / 2], 0.0016, { axis: s > 0 ? 'x' : '-x', h: 0.0006, seg: 8 }); } }); // witness marks
    cy(round, BR, [0, -0.0125, -0.0205], 0.0049, 0.0192, { axis: 'z', seg: 16, r: 0.0004 });
    lt(round, CU, [0, -0.0125, 0], [[0, -0.0438], [0.0022, -0.0433], [0.0038, -0.0415], [0.00451, -0.0385], [0.00451, -0.0300], [0, -0.0300]], { axis: 'z', seg: 16 });
    // ------------------------------------------------------------ markings
    R.quad(MK, [-RO - 0.0006, 0.0018, 0.0300], qw(0.0072, 0.12), 0.0072, row(0, 0, 0.12), { r: [0, -90, 0] });
    R.quad(MK, [RO + 0.0006, 0.0018, -0.0300], qw(0.0066, 0.25), 0.0066, row(1, 0, 0.25), { r: [0, 90, 0] });
    R.quad(MK, [-0.0177, -0.0360, 0.0750], qw(0.007, 0.21), 0.007, row(0, 0.58, 0.79), { r: [0, -90, 0] });
    K.socket('muzzle', 'root', [0, 0, -0.226]); K.socket('eject', 'root', [0.019, 0.010, 0.030]);
    K.socket('sightRear', 'root', [0, 0.0465, 0.1735]); K.socket('sightFront', 'root', [0, 0.0465, -0.194]);
    return { length: 0.66, sightHeight: 0.0465, rearSightZ: 0.1735, frontSightZ: -0.194 };
  },
};
