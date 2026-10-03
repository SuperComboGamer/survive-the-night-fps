// AKS-74U (5.45x39) - "Krinkov", built part by part from stamped-steel construction (HSB round).
// Reference dimensions (mm): OAL 735 stock extended / 490 folded, barrel 206.5 (+ muzzle booster to z -272), sight radius 290 (rear leaf z +128 -> front post z -160),
// receiver 36 wide x 45 tall, stamped from 1.0 mm sheet, magwell boot 39 wide, 30-rd 5.45 mag 33 wide x 62 deep, pistol grip 33 wide x 110 long, laminate handguards.
// gun-local frame: -Z = muzzle, +Y up, +X right, origin = bore axis at the breech face. All fillets >= 0.3 mm (real edge breaks).
import { hsb, rrect, circ, slot, strip, roundPoly, arcPts, bezPts } from '../hsb-kit.js';
import '../hsb-mats.js';

const S = 'hPaint', LM = 'hLaminate', PL = 'hPlum', ST = 'hPhos', BR = 'hPhos', BO = 'hBake', GR = 'hBake', CA = 'hPhos', CU = 'hCopper', MK = 'marks:ak74u';
const Z6 = [0, 0, 0, 0, 0, 0];
const DRAWN = [0.03, -0.21, 0.05, -45, 12, -25];

export default {
  id: 'ak74u',
  handling: {
    hip: { p: [0.096, -0.112, -0.235], r: [0.8, 2.4, 0] }, eye: 0.21, sprint: { p: [0.06, -0.12, -0.24], r: [5, 48, 38] },
    pivot: [0, -0.04, 0.42], animPivot: [0, -0.05, 0.02], wall: { p: [0, -0.03, 0.08], r: [28, 12, -12] },
    shoulderR: [0.15, -0.22, 0.12], shoulderL: [-0.19, -0.25, 0.06], poleR: [0.8, -0.8, 0.2], poleL: [-0.5, -1, 0.1],
    hands: { R: { f: 'gripR', pose: 'rifleGrip' }, L: { f: 'foreL', pose: 'handguard' } },
    frames: {
      gripR: { part: 'root', p: [0.0225, -0.0800, 0.0860], fd: [0, -0.42, -0.91], pn: [-1, 0, 0] },
      foreL: { part: 'root', p: [-0.004, -0.0500, -0.106], fd: [0.9, 0.12, -0.42], pn: [0.05, 1, 0.1] },
      magL: { part: 'mag', p: [-0.034, -0.080, -0.016], fd: [0.4, -0.25, -0.88], pn: [1, 0.05, 0.1] },
      chargeR: { part: 'carrier', p: [0.040, 0.006, 0.134], fd: [-0.3, -0.5, -0.8], pn: [-0.9, 0.1, -0.3] },
    },
    parts(rig, st) { rig.set('selector', 0, 0, 0, -10 * Math.PI / 180, 0, 0); rig.set('stock', 0, 0, 0, 0, 0, 0); rig.scale('round', st.mag > 1 ? 1 : 0); },
    clips: {
      fire: { dur: 0.085, events: [[0.012, 'eject']], tracks: { carrier: [[0, [0, 0, 0]], [0.022, [0, 0, 0.062], 'out'], [0.06, [0, 0, 0], 'in']], trigger: [[0, [0, 0, 0, 12, 0, 0]], [0.085, [0, 0, 0, 12, 0, 0]]] } },
      dry: { dur: 0.14, tracks: { trigger: [[0, [0, 0, 0, 12, 0, 0]], [0.14, Z6, 'out']] } },
      draw: { dur: 0.5, events: [[0.0, 'snd', 'draw']], tracks: { gun: [[0, DRAWN], [0.5, Z6, 'out3']] } },
      holster: { dur: 0.3, tracks: { gun: [[0, Z6], [0.3, DRAWN, 'in']] } },
      firstDraw: { dur: 1.15, events: [[0.0, 'snd', 'draw'], [0.55, 'snd', 'boltBack'], [0.75, 'snd', 'boltFwd'], [0.98, 'snd', 'selector']], tracks: {
        gun: [[0, DRAWN], [0.42, [-0.02, 0.02, 0.0, 3, 10, 16], 'out3'], [0.72, [-0.02, 0.022, 0.0, 4, 11, 18]], [0.77, [-0.02, 0.027, 0.012, 6, 11, 18], 'out'], [1.15, Z6, 'io']],
        carrier: [[0.48, [0, 0, 0]], [0.62, [0, 0, 0.062], 'out'], [0.72, [0, 0, 0.062]], [0.76, [0, 0, 0], 'in']],
        selector: [[0.92, [0, 0, 0, 0, 0, 0]], [1.0, [0, 0, 0, -10, 0, 0], 'out']],
        R: [[0, { f: 'rest' }], [0.42, { f: 'chargeR', pose: 'pinch' }, 'io'], [0.62, { f: 'chargeR', pose: 'pinch' }], [0.72, { f: 'chargeR', pose: 'pinch' }], [0.8, { f: 'chargeR', p: [0.03, 0.02, 0.03], pose: 'open' }, 'out'], [1.15, { f: 'rest' }, 'io']] } },
      reload: {
        scale: 1.143, dur: 2.1, events: [[0.32, 'snd', 'magout'], [1.36, 'snd', 'magin'], [1.38, 'magFill']],
        tracks: {
          gun: [[0, Z6], [0.28, [-0.07, 0.02, -0.12, 6, 18, -42], 'io'], [1.3, [-0.075, 0.024, -0.12, 7, 19, -45], 'io'], [1.4, [-0.07, 0.016, -0.11, 5, 18, -42], 'out'], [1.52, [-0.075, 0.024, -0.12, 7, 19, -45], 'io'], [2.1, Z6, 'io']],
          mag: [[0.3, Z6], [0.4, [0, -0.008, -0.01, 14, 0, 0], 'out'], [0.5, [0, -0.07, -0.02, 18, 0, 0], 'in'], [0.68, [-0.03, -0.32, 0.0, 34, 20, 10], 'in'], [0.82, [-0.05, -0.34, 0.0, 38, 30, 20], 'step'], [1.16, [0, -0.07, -0.026, 20, 0, 0], 'out'], [1.28, [0, -0.012, -0.012, 15, 0, 0], 'io'], [1.38, Z6, 'io']],
          L: [[0, { f: 'rest' }], [0.28, { f: 'magL', pose: 'magGrip' }, 'io'], [0.68, { f: 'magL', pose: 'magGrip' }], [0.82, { f: 'magL', pose: 'magGrip' }, 'step'], [1.38, { f: 'magL', pose: 'magGrip' }], [1.46, { f: 'magL', p: [0, -0.02, 0.01], pose: 'slap' }, 'out'], [1.95, { f: 'rest' }, 'io']] } },
      reloadEmpty: {
        scale: 1.078, dur: 2.55, events: [[0.32, 'snd', 'magout'], [1.36, 'snd', 'magin'], [1.38, 'magFill'], [1.86, 'snd', 'boltBack'], [2.02, 'snd', 'boltFwd']],
        tracks: {
          gun: [[0, Z6], [0.28, [-0.07, 0.02, -0.12, 6, 18, -42], 'io'], [1.3, [-0.075, 0.024, -0.12, 7, 19, -45], 'io'], [1.4, [-0.07, 0.016, -0.11, 5, 18, -42], 'out'], [1.7, [-0.03, 0.02, -0.04, 3, 10, 16], 'io'], [2.0, [-0.03, 0.022, -0.04, 4, 11, 18]], [2.04, [-0.03, 0.027, -0.03, 6, 11, 18], 'out'], [2.55, Z6, 'io']],
          mag: [[0.3, Z6], [0.4, [0, -0.008, -0.01, 14, 0, 0], 'out'], [0.5, [0, -0.07, -0.02, 18, 0, 0], 'in'], [0.68, [-0.03, -0.32, 0.0, 34, 20, 10], 'in'], [0.82, [-0.05, -0.34, 0.0, 38, 30, 20], 'step'], [1.16, [0, -0.07, -0.026, 20, 0, 0], 'out'], [1.28, [0, -0.012, -0.012, 15, 0, 0], 'io'], [1.38, Z6, 'io']],
          carrier: [[1.84, [0, 0, 0]], [1.94, [0, 0, 0.062], 'out'], [2.0, [0, 0, 0.062]], [2.04, [0, 0, 0], 'in']],
          L: [[0, { f: 'rest' }], [0.28, { f: 'magL', pose: 'magGrip' }, 'io'], [0.68, { f: 'magL', pose: 'magGrip' }], [0.82, { f: 'magL', pose: 'magGrip' }, 'step'], [1.38, { f: 'magL', pose: 'magGrip' }], [1.46, { f: 'magL', p: [0, -0.02, 0.01], pose: 'slap' }, 'out'], [1.9, { f: 'rest' }, 'io']],
          R: [[0, { f: 'rest' }], [1.5, { f: 'rest' }], [1.8, { f: 'chargeR', pose: 'pinch' }, 'io'], [2.0, { f: 'chargeR', pose: 'pinch' }], [2.08, { f: 'chargeR', p: [0.03, 0.02, 0.03], pose: 'open' }, 'out'], [2.45, { f: 'rest' }, 'io']] } },
    },
  },
  build(K, M) {
    M.util();
    M.marks('ak74u', 1024, 256, (g) => { g.font = 'bold 44px "Arial", sans-serif'; g.textBaseline = 'middle'; g.fillText('АВ', 12, 32); g.fillText('ОД', 120, 32); g.fillText('ИК 3104  1987', 12, 96); g.font = 'bold 40px "Arial", sans-serif'; g.fillText('П', 12, 160); g.fillText('4', 80, 160); g.fillText('5', 140, 160); }, { color: 0xc4c6c4, rough: 0.5, metal: 0.55 });
    const row = (i, u0, u1) => [u0, 1 - (i + 1) / 4 + 0.01, u1, 1 - i / 4 - 0.01]; const qw = (hh, du) => hh * (du * 1024 / 64) * 0.98;
    const h = hsb(K); const { ex, ez, ey, bx, lt, cy, tb, rv, hx, sc, sx: strap, bar, spring, gear } = h;
    const R = K.root;
    const carrier = K.part('carrier', { pivot: [0, 0.004, 0.06] }), trigger = K.part('trigger', { pivot: [0, -0.034, 0.045] }), selector = K.part('selector', { pivot: [0.0192, 0.0015, 0.152] });
    const mag = K.part('mag', { pivot: [0, -0.07, -0.02] }), round = K.part('round', { parent: 'mag', pivot: [0, -0.012, -0.02] }), stock = K.part('stock', { pivot: [-0.0145, -0.012, 0.2] }), cover = K.part('cover', { pivot: [0, 0.018, -0.036] });
    const W = 0.0180, T = 0.0010; // receiver half width, sheet thickness
    const both = (f) => { f(1); f(-1); };
    // ------------------------------------------------------------ stamped receiver: U channel from 1.0 mm sheet; the right wall is cut down for the ejection port
    const RCV = (tR) => [[-W, 0.0152, 0.0002], [-W, -0.0295, 0.0062], [W, -0.0295, 0.0062], [W, tR, 0.0002], [W - T, tR, 0.0002], [W - T, -0.0285, 0.0052], [-W + T, -0.0285, 0.0052], [-W + T, 0.0152, 0.0002]];
    ez(R, S, RCV(0.0152), -0.0660, -0.0060, { r0: 0.0003, r1: 0, segs: 1 });
    ez(R, S, RCV(-0.0030), -0.0060, 0.0920, { r: 0 });
    ez(R, S, RCV(0.0152), 0.0920, 0.1980, { r0: 0, r1: 0.0003, segs: 1 });
    // forged front trunnion (visible as the round barrel collar + block) and the rear trunnion / stock hinge block
    ez(R, ST, rrect(-0.0172, 0.0172, -0.0272, 0.0160, 0.0045), -0.0700, -0.0180, { r: 0.0007, holes: [circ(0, 0, 0.0104, 20)] });
    lt(R, ST, [0, 0, 0], [[0.0092, -0.0715], [0.0126, -0.0715, 0.0005], [0.0126, -0.0690, 0.0005], [0.0092, -0.0690]], { axis: 'z', seg: 26 }); // barrel collar
    ez(R, S, rrect(-0.0175, 0.0175, -0.0290, 0.0058, 0.0035), 0.1950, 0.2025, { r: 0.0005 }); // rear trunnion
    ez(R, ST, rrect(-0.0095, 0.0095, -0.0075, 0.0085, 0.0035), 0.2025, 0.2050, { r: 0.0004 }); // recoil-spring guide cap
    cy(R, BR, [0, 0.0005, 0.2078], 0.0032, 0.0060, { axis: 'z', seg: 14, r: 0.0004 }); // guide rod tip
    // magwell boot (stamped rectangle below the receiver) with a real opening; mag catch behind it
    ey(R, S, rrect(-0.0195, 0.0195, -0.0645, 0.0085, 0.0048), -0.0410, -0.0290, { r: 0.0006, holes: [rrect(-0.0176, 0.0176, -0.0625, 0.0066, 0.0038)] });
    strap(R, ST, [[0.0090, -0.0320], [0.0100, -0.0420], [0.0130, -0.0520], [0.0175, -0.0560]], 0.0020, -0.0075, 0.0075, { r: 0.0004 });
    ex(R, ST, [[0.0085, -0.0305, 0.001], [0.0170, -0.0305, 0.001], [0.0170, -0.0345, 0.001], [0.0085, -0.0345, 0.001]], -0.0090, 0.0090, { r: 0.0004 }); // catch base
    // ---- side details: pressed rail rib, rivets, spot welds, selector slot, markings zone
    both((s) => {
      const x0 = s > 0 ? W - 0.0002 : -W - 0.0009, x1 = s > 0 ? W + 0.0009 : -W + 0.0002;
      ex(R, S, slot(0.030, -0.0100, 0.150, -0.0100, 0.0060, 5), x0, x1, { r: 0.0003, segs: 1 }); // pressed carrier-rail rib
      ex(R, S, slot(0.012, -0.0250, 0.058, -0.0250, 0.0042, 4), x0, x1, { r: 0.0003, segs: 1 }); // magwell reinforcing rib
      const ax = s > 0 ? 'x' : '-x';
      for (const [z, y] of [[-0.0570, 0.0090], [-0.0570, -0.0100], [-0.0570, -0.0225], [-0.0420, -0.0225], [-0.0300, 0.0100], [0.0040, -0.0180], [0.0040, -0.0040], [0.1830, 0.0010], [0.1830, -0.0170]]) rv(R, ST, [s * (W + 0.0007), y, z], 0.0027, { axis: ax, h: 0.0016 });
      for (const [z, y] of [[0.0120, -0.0350], [0.0640, -0.0250], [0.1150, -0.0250], [0.1600, -0.0250]]) rv(R, S, [s * (W + 0.0007), y, z], 0.0016, { axis: ax, h: 0.0009, seg: 8 }); // spot welds
    });
    ex(R, BO, [[0.014, 0.0020, 0.0015], [0.150, 0.0020, 0.0015], [0.150, -0.0010, 0.0015], [0.014, -0.0010, 0.0015]], W + 0.0002, W + 0.0006, { r: 0.0002, segs: 1, wear: 0 }); // selector travel slot (dark)
    // ------------------------------------------------------------ trigger group: guard strap, trigger, hammer pin, grip + screw
    strap(R, S, [[0.0092, -0.0340], [0.0098, -0.0480], [0.0160, -0.0600], [0.0360, -0.0652], [0.0540, -0.0640], [0.0640, -0.0560], [0.0700, -0.0400]], 0.0021, -0.0062, 0.0062, { r: 0.0005, wear: 1.8 });
    both((s) => rv(R, ST, [s * 0.0068, -0.0420, 0.0300], 0.0028, { axis: s > 0 ? 'x' : '-x', h: 0.0012 }));
    ex(trigger, S ? S : S, [[0.0405, -0.0340], [0.0335, -0.0470, 0.004], [0.0362, -0.0575, 0.002], [0.0428, -0.0560, 0.002], [0.0462, -0.0360]], -0.0036, 0.0036, { r: 0.0006, wear: 2 });
    h.ex(trigger, ST, [[0.0500, -0.0300, 0.001], [0.0420, -0.0300, 0.001], [0.0420, -0.0380, 0.001], [0.0500, -0.0380, 0.001]], -0.0026, 0.0026, { r: 0.0004 });
    // pistol grip (dark bakelite): raked, waisted, finger swells + horizontal ribs + steel heel cap with the retaining screw
    const pg = [[0.0600, -0.0290, 0.003], [0.1080, -0.0290, 0.004], [0.1115, -0.0480, 0.008], [0.1130, -0.0700, 0.010], [0.1150, -0.1000, 0.012], [0.1145, -0.1240, 0.008], [0.1030, -0.1385, 0.006], [0.0890, -0.1385, 0.006], [0.0830, -0.1290, 0.008], [0.0730, -0.1000, 0.010], [0.0665, -0.0740, 0.012], [0.0640, -0.0500, 0.008]];
    ex(R, GR, pg, -0.0166, 0.0166, { r: 0.0034, segs: 3, uv: 'box' });
    both((s) => { for (let i = 0; i < 8; i++) { const y = -0.0500 - i * 0.0106; ex(R, GR, [[0.0735 + i * 0.0020, y + 0.0028, 0.0008], [0.1060 + i * 0.0006, y + 0.0028, 0.0008], [0.1060 + i * 0.0006, y - 0.0028, 0.0008], [0.0735 + i * 0.0020, y - 0.0028, 0.0008]], s > 0 ? 0.0163 : -0.0175, s > 0 ? 0.0175 : -0.0163, { r: 0.0004, segs: 1 }); } });
    ex(R, S, [[0.0885, -0.1383, 0.002], [0.1050, -0.1383, 0.002], [0.1050, -0.1418, 0.002], [0.0885, -0.1418, 0.002]], -0.0150, 0.0150, { r: 0.0005 }); // heel cap
    R.screw(BR, [0, -0.1420, 0.0967], 0.0052, { axis: '-y', slot: 0 });
    // ------------------------------------------------------------ selector lever (right side): stamped plate + finger tab + pivot rivet; rotates on the pivot
    ex(selector, S, [[0.1580, 0.0075, 0.004], [0.1500, 0.0088, 0.003], [0.0700, 0.0088, 0.002], [0.0620, 0.0130, 0.004], [0.0500, 0.0135, 0.003], [0.0460, 0.0090, 0.002], [0.0520, 0.0030, 0.002], [0.0700, -0.0030, 0.002], [0.1500, -0.0030, 0.003], [0.1590, -0.0010, 0.004]], W + 0.0004, W + 0.0024, { r: 0.0004, segs: 1, wear: 2.2 });
    rv(selector, ST, [W + 0.0024, 0.0015, 0.1520], 0.0040, { axis: 'x', h: 0.0022 });
    ex(selector, S, slot(0.078, 0.0030, 0.140, 0.0030, 0.0030, 4), W + 0.0022, W + 0.0030, { r: 0.0003, segs: 1 }); for (const z of [0.052, 0.058]) ex(selector, S, slot(z, 0.0100, z, 0.0125, 0.0022, 3), W + 0.0022, W + 0.0029, { r: 0.0003, segs: 1 });
    // ------------------------------------------------------------ bolt carrier + bolt (seen through the port) and the charging handle
    bx(carrier, ST, [0.0010, 0.0055, 0.0800], [0.0250, 0.0130, 0.1300], { r: 0.0012 });
    bx(carrier, ST, [0.0000, 0.0100, 0.0130], [0.0120, 0.0100, 0.0400], { r: 0.0010 }); // bolt head
    ey(carrier, ST, [[0.0120, 0.1170, 0.001], [0.0320, 0.1210, 0.003], [0.0320, 0.1420, 0.003], [0.0120, 0.1440, 0.001]], 0.0035, 0.0100, { r: 0.0007 }); // handle arm
    lt(carrier, ST, [0.0345, 0.0072, 0.1330], [[0, -0.0060], [0.0042, -0.0060, 0.0008], [0.0042, -0.0020], [0.0056, -0.0020, 0.0008], [0.0058, 0.0060, 0.0016], [0, 0.0064]], { axis: 'x', seg: 20, wear: 2 }); // knob
    // ------------------------------------------------------------ dust cover (stamped; hinged at the front) with pressed transverse ribs + rear sight block on the rear half
    const cov = (hx0, ys, yc, rib) => { const yb = 0.0148; const c = (hx0 * hx0 + ys * ys - yc * yc) / (2 * (ys - yc)), R0 = yc - c; const a0 = Math.atan2(ys - c, hx0), a1 = Math.PI - a0; const o = [[-hx0, yb, 0.0005], [hx0, yb, 0.0005], [hx0, ys, 0.0012]];
      for (let k = 1; k < 16; k++) { const a = a0 + (a1 - a0) * k / 16; const x = Math.cos(a) * R0; o.push([x, c + Math.sin(a) * R0 + rib * Math.max(0, 1 - (x / 0.0046) * (x / 0.0046))]); } o.push([-hx0, ys, 0.0012]); return roundPoly(o, 12); };
    const ra = (z) => 0.0009 * Math.min(1, Math.max(0, (z + 0.022) / 0.012)) * Math.min(1, Math.max(0, (0.100 - z) / 0.012)); // long stamped centre ridge on the crown
    const ribs = [0.030, 0.062, 0.094, 0.170]; const bump = (z) => { let b = 0; for (const zr of ribs) { const d = Math.abs(z - zr); if (d < 0.0042) b = Math.max(b, 0.5 + 0.5 * Math.cos(d / 0.0042 * Math.PI)); } return b; };
    const secs = []; for (let z = -0.036; z <= 0.1999; z += 0.0016) { const t = z < 0.150 ? 0 : Math.min(1, (z - 0.150) / 0.049); const hx0 = 0.0188 - 0.0058 * t * t, ys = 0.0205 - 0.0030 * t, yc = 0.0272 - 0.0080 * t * t; const b = bump(z) * 0.0009;
      secs.push({ z, pts: cov(hx0, ys + b * 0.8, yc + b, ra(z)) }); }
    cover.polyLoft(S, secs, { N: 56, wear: 0.4, wearK: 0.0009 });
    const hxAt = (z) => { const t = z < 0.150 ? 0 : Math.min(1, (z - 0.150) / 0.049); return 0.0188 - 0.0058 * t * t; };
    both((s) => { for (const z of [-0.030, 0.178]) rv(cover, ST, [s * (hxAt(z) - 0.0004), 0.0170, z], 0.0022, { axis: s > 0 ? 'x' : '-x', h: 0.0012, seg: 8 }); }); // hinge / latch pins
    // rear sight: block, wings, flip leaf with a U notch, hinge pin, detent (sight line 0.0435 above the bore, z +0.128)
    ez(cover, S, rrect(-0.0100, 0.0100, 0.0210, 0.0330, 0.0028), 0.1040, 0.1500, { r: 0.0008 });
    both((s) => ex(cover, S, [[0.1120, 0.0235, 0.002], [0.1450, 0.0235, 0.002], [0.1450, 0.0385, 0.002], [0.1400, 0.0470, 0.0025], [0.1200, 0.0470, 0.0025], [0.1130, 0.0400, 0.002]], s > 0 ? 0.0092 : -0.0112, s > 0 ? 0.0112 : -0.0092, { r: 0.0004, segs: 1 })); // protective wings
    ez(cover, S, [[-0.0062, 0.0300, 0.0005], [0.0062, 0.0300, 0.0005], [0.0062, 0.0472, 0.0008], [0.0026, 0.0472, 0.0008], [0.0024, 0.0435, 0.0012], [-0.0024, 0.0435, 0.0012], [-0.0026, 0.0472, 0.0008], [-0.0062, 0.0472, 0.0008]], 0.1262, 0.1298, { r: 0.0004, segs: 1, holes: [circ(0, 0.0372, 0.0015, 12)] });
    both((s) => { rv(cover, ST, [s * 0.0115, 0.0330, 0.1200], 0.0018, { axis: s > 0 ? 'x' : '-x', h: 0.0010, seg: 8 }); rv(cover, ST, [s * 0.0115, 0.0330, 0.1370], 0.0018, { axis: s > 0 ? 'x' : '-x', h: 0.0010, seg: 8 }); });
    ez(cover, S, [[-0.0090, 0.0330, 0.001], [0.0090, 0.0330, 0.001], [0.0090, 0.0342, 0.001], [-0.0090, 0.0342, 0.001]], 0.1225, 0.1335, { r: 0.0004, segs: 1 }); // leaf rest bar
    cy(cover, ST, [0, 0.0300, 0.1280], 0.0026, 0.0196, { axis: 'x', seg: 12, r: 0.0004 });
    bx(cover, ST, [0, 0.0338, 0.1155], [0.0040, 0.0020, 0.0100], { r: 0.0004 });
    // ------------------------------------------------------------ handguards (laminate) + ferrule, gas block, hooded front sight, booster, sling loop
    const hgSec = (rx, yb, yt, rr) => roundPoly([[-rx, yt, rr], [-rx, yb + 0.006, 0.006], [-rx + 0.004, yb, 0.006], [rx - 0.004, yb, 0.006], [rx, yb + 0.006, 0.006], [rx, yt, rr]], 14);
    // lower handguard: boat-shaped cradle with the barrel channel, finger grooves (real cross-cuts) and swelling
    const low = []; for (let z = -0.0700; z >= -0.1420; z -= 0.0018) { const t = (-0.0700 - z) / 0.072; const g = [-0.090, -0.104, -0.118].reduce((a, zz) => Math.max(a, Math.abs(z - zz) < 0.0034 ? 1 - Math.abs(z - zz) / 0.0034 : 0), 0);
      const rx = 0.0218 - 0.0016 * t - 0.0012 * g, yb = -0.0345 + 0.0030 * t + 0.0009 * g; low.push({ z, pts: hgSec(rx, yb, 0.0070, 0.002).concat([[0.0106, 0.0070], ...arcPts(0, 0.0, 0.0106, 0, -180, 12).slice(1, -1).map((p) => p), [-0.0106, 0.0070]]) }); }
    // (arc goes clockwise from +x to -x under the axis: the channel is cut into the top face)
    K.part('root').polyLoft(LM, low.map((q) => ({ z: q.z, pts: q.pts })), { N: 60, wear: 0.5, wearK: 0.0007, uv: 'box' });
    // upper handguard / gas tube cover: domed, with fine transverse ribs
    const up = []; for (let z = -0.0560; z >= -0.1400; z -= 0.0012) { const rb = (Math.round((z + 0.056) / 0.0072) * 0.0072 - (z + 0.056)); const bmp = Math.abs(rb) < 0.0019 ? 0.00042 * Math.min(1, (0.0019 - Math.abs(rb)) / 0.0006) : 0; const rx = 0.0196, ys = 0.0200 + bmp, yt = 0.0345 + bmp;
      const o = [[-rx, 0.0070, 0.001], [rx, 0.0070, 0.001], [rx, ys, 0.002]]; const cc = (rx * rx + (yt - ys) * (yt - ys)) / (2 * (yt - ys)), Rr = yt - cc; for (let k = 1; k < 14; k++) { const a = Math.atan2(ys - cc, rx) + (Math.PI - 2 * Math.atan2(ys - cc, rx)) * k / 14; o.push([Math.cos(a) * Rr, cc + Math.sin(a) * Rr]); } o.push([-rx, ys, 0.002]); up.push({ z, pts: roundPoly(o, 14) }); }
    R.polyLoft(LM, up, { N: 56, wear: 0.5, wearK: 0.0007 });
    both((s) => ex(R, ST, [[-0.0700, 0.0068, 0.001], [-0.0560, 0.0068, 0.001], [-0.0560, 0.0110, 0.001], [-0.0700, 0.0110, 0.001]], s > 0 ? 0.0193 : -0.0203, s > 0 ? 0.0203 : -0.0193, { r: 0.0004, segs: 1 })); // rear handguard clips
    both((s) => { for (const y of [-0.0110, 0.0]) for (const z of [-0.0880, -0.1080]) ex(R, BO, slot(z, y, z - 0.0110, y, 0.0030, 4), s > 0 ? 0.0206 : -0.0216, s > 0 ? 0.0216 : -0.0206, { r: 0.0003, segs: 1, wear: 0 }); }); // handguard vent slots
    // ferrule (handguard retainer band) + gas block
    ez(R, ST, rrect(-0.0232, 0.0232, -0.0350, 0.0368, 0.0075), -0.1462, -0.1400, { r: 0.0006, holes: [rrect(-0.0206, 0.0206, -0.0322, 0.0356, 0.0058)] });
    ez(R, ST, rrect(-0.0135, 0.0135, -0.0140, 0.0215, 0.0055), -0.1780, -0.1462, { r: 0.0007, holes: [] });
    both((s) => rv(R, ST, [s * 0.0136, 0.0030, -0.1590], 0.0034, { axis: s > 0 ? 'x' : '-x', h: 0.0016 })); // gas block cross pin heads
    // front sight: base on the block, two protective wings, post with a threaded collar
    ez(R, ST, rrect(-0.0080, 0.0080, 0.0205, 0.0300, 0.0025), -0.1735, -0.1490, { r: 0.0007 });
    both((s) => ex(R, ST, [[-0.1735, 0.0290, 0.002], [-0.1490, 0.0290, 0.002], [-0.1500, 0.0470, 0.003], [-0.1725, 0.0470, 0.003]], s > 0 ? 0.0077 : -0.0097, s > 0 ? 0.0097 : -0.0077, { r: 0.0004, segs: 1 }));
    cy(R, ST, [0, 0.0330, -0.1600], 0.0044, 0.0080, { axis: 'y', seg: 14, r: 0.0005 });
    cy(R, ST, [0, 0.0390, -0.1600], [0.0016, 0.0012], 0.0090, { axis: 'y', seg: 10, r: 0.0002 }); // post tip at 0.0435
    // sling loop (left of the gas block)
    R.torus(ST, [-0.0150, 0.0010, -0.1580], 0.0058, 0.0013, { r: [0, 90, 0], seg: 8, tube: 20 });
    ex(R, ST, [[-0.1640, 0.0010, 0.002], [-0.1520, 0.0010, 0.002], [-0.1520, -0.0060, 0.002], [-0.1640, -0.0060, 0.002]], -0.0158, -0.0132, { r: 0.0004 });
    // barrel + muzzle booster (expansion chamber + flared cone), bore
    lt(R, ST, [0, 0, 0], [[0, -0.1900], [0.0092, -0.1900], [0.0092, -0.0700], [0, -0.0700]], { axis: 'z', seg: 24 });
    const cone = bezPts([0.0132, -0.2440], [0.0150, -0.2540], [0.0178, -0.2650], [0.0203, -0.2708], 9);
    lt(R, ST, [0, 0, 0], [[0, -0.2455], [0.0104, -0.2455], [0.0104, -0.2500], [0.0165, -0.2722, 0.0006], [0.0205, -0.2722, 0.0006], ...cone.slice().reverse(), [0.0132, -0.2380], [0.0156, -0.2360, 0.0006], [0.0156, -0.1960, 0.0006], [0.0128, -0.1960, 0.0004], [0.0128, -0.1780], [0, -0.1780]], { axis: 'z', seg: 32 });
    lt(R, BO, [0, 0, 0], [[0, -0.2463], [0.0100, -0.2463], [0.0100, -0.2456], [0, -0.2456]], { axis: 'z', seg: 16, wear: 0 }); // dark bore
    both((s) => { for (const z of [-0.2100, -0.2200]) bx(R, BO, [s * 0.0154, 0.0040, z], [0.0014, 0.0110, 0.0060], { r: 0.0004, wear: 0 }); }); // chamber slots (dark)
    for (const z of [-0.2140, -0.2290]) lt(R, ST, [0, 0, 0], [[0.0154, z - 0.0009], [0.0164, z - 0.0009, 0.0004], [0.0164, z + 0.0009, 0.0004], [0.0154, z + 0.0009]], { axis: 'z', seg: 32 }); // thread-relief rings
    // ------------------------------------------------------------ skeleton stock (extended): hinge block, latch, two struts, butt plate with ribs
    const xs = -0.0040;
    ez(stock, S, rrect(-0.0205, -0.0040, -0.0290, 0.0060, 0.0040), 0.2050, 0.2200, { r: 0.0006 });
    cy(stock, ST, [-0.0145, -0.0120, 0.2125], 0.0072, 0.0350, { axis: 'y', seg: 18, r: 0.0006 }); // hinge knuckle
    cy(stock, ST, [-0.0145, 0.0080, 0.2125], 0.0046, 0.0022, { axis: 'y', seg: 14, r: 0.0004 }); // hinge pin head
    rv(R, ST, [-W - 0.0008, -0.0160, 0.1865], 0.0046, { axis: '-x', h: 0.0030 }); // stock latch button
    const strut = (a, b, hh, ww) => { bar(stock, S, [xs, a[0], a[1]], [xs, b[0], b[1]], ww, hh, { r: 0.0007 }); };
    // channel-section struts (web + two flanges) drawn as bar + dark inner groove line
    strut([0.0040, 0.2200], [0.0040, 0.4690], 0.0125, 0.0074); strut([-0.0230, 0.2200], [-0.0900, 0.4690], 0.0125, 0.0074);
    bar(stock, BO, [xs + 0.0027, 0.0040, 0.2600], [xs + 0.0027, 0.0040, 0.4400], 0.0002, 0.0050, { r: 0.0001, wear: 0 }); bar(stock, BO, [xs + 0.0027, -0.0290, 0.2600], [xs + 0.0027, -0.0700, 0.4300], 0.0002, 0.0050, { r: 0.0001, wear: 0 });
    ey(stock, S, [[-0.0225 + xs, 0.4700, 0.001], [0.0225 + xs, 0.4700, 0.001], [0.0225 + xs, 0.4620, 0.0008], [0.0209 + xs, 0.4620, 0.0004], [0.0209 + xs, 0.4684, 0.0008], [-0.0209 + xs, 0.4684, 0.0008], [-0.0209 + xs, 0.4620, 0.0004], [-0.0225 + xs, 0.4620, 0.0008]], -0.1000, 0.0100, { r: 0.0008 }); // butt plate: stamped U channel, open to the front
    for (const y of [-0.0560, -0.0200]) rv(stock, ST, [xs, y, 0.4715], 0.0038, { axis: 'z', h: 0.0014 });
    for (const dx of [-0.0110, 0.0110]) ex(stock, S, [[0.4700, -0.0900, 0.001], [0.4738, -0.0900, 0.001], [0.4738, 0.0000, 0.001], [0.4700, 0.0000, 0.001]], xs + dx - 0.0014, xs + dx + 0.0014, { r: 0.0005, segs: 1 }); // pressed vertical ribs
    ex(stock, S, [[0.4520, -0.0330, 0.002], [0.4600, -0.0330, 0.002], [0.4600, -0.0420, 0.002], [0.4520, -0.0420, 0.002]], xs - 0.0062, xs + 0.0062, { r: 0.0005 }); // strut-to-butt gusset
    // ------------------------------------------------------------ 30-rd 5.45 magazine (plum polymer), banana curve, moulded ribs, steel floor plate, hook + rear lug
    const f0 = [[-0.0580, -0.0120], [-0.0580, -0.0300], ...bezPts([-0.0580, -0.0400], [-0.0660, -0.1100], [-0.0840, -0.1700], [-0.1080, -0.2220], 12).slice(1)], b0 = [[0.0040, -0.0120], [0.0040, -0.0300], ...bezPts([0.0040, -0.0400], [0.0000, -0.1100], [-0.0180, -0.1800], [-0.0460, -0.2400], 12).slice(1)];
    const magO = [...b0, [-0.0500, -0.2460, 0.004], [-0.1120, -0.2280, 0.004], ...f0.slice().reverse()];
    ex(mag, PL, magO, -0.0166, 0.0166, { r: 0.0022, segs: 3, deg: 30 });
    const zAt = (crv, y) => { for (let i = 0; i < crv.length - 1; i++) { const a = crv[i], b = crv[i + 1]; if ((a[1] - y) * (b[1] - y) <= 0) return a[0] + (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 1); } return crv[crv.length - 1][0]; };
    both((s) => { for (let i = 0; i < 12; i++) { const y = -0.0620 - i * 0.0132; const zf = zAt(f0, y), zb = zAt(b0, y); ex(mag, PL, [[zb - 0.0030, y + 0.0020, 0.0008], [zf + 0.0030, y + 0.0020, 0.0008], [zf + 0.0030, y - 0.0020, 0.0008], [zb - 0.0030, y - 0.0020, 0.0008]], s > 0 ? 0.0161 : -0.0172, s > 0 ? 0.0172 : -0.0161, { r: 0.0004, segs: 1 }); } });
    both((s) => { const zf = zAt(f0, -0.0550), zb = zAt(b0, -0.0550); ex(mag, PL, [[zb - 0.006, -0.0420, 0.002], [zf + 0.006, -0.0420, 0.002], [zf + 0.006, -0.0520, 0.002], [zb - 0.006, -0.0520, 0.002]], s > 0 ? 0.0160 : -0.0176, s > 0 ? 0.0176 : -0.0160, { r: 0.0005, segs: 1 }); }); // top reinforcement band
    bx(mag, ST, [0, -0.2375, -0.0800], [0.0350, 0.0060, 0.0720], { r: 0.0012, rot: [16, 0, 0] }); // steel floor plate
    bx(mag, ST, [0, -0.0240, 0.0058], [0.0130, 0.0100, 0.0060], { r: 0.0008 }); // rear locking lug
    bx(mag, ST, [0, -0.0220, -0.0600], [0.0200, 0.0100, 0.0060], { r: 0.0008 }); // front hook
    ey(mag, ST, rrect(-0.0166, 0.0166, -0.0590, 0.0050, 0.0020), -0.0140, -0.0102, { r: 0.0004, holes: [rrect(-0.0146, 0.0146, -0.0570, 0.0030, 0.0014)] }); bx(mag, ST, [0, -0.0175, -0.0270], [0.0250, 0.0030, 0.0500], { r: 0.0007 }); // feed lips + follower
    cy(round, CA, [0, -0.0125, -0.0120], 0.0055, 0.0398, { axis: 'z', seg: 16, r: 0.0006 });
    lt(round, CU, [0, -0.0125, 0], [[0, -0.0535], [0.0015, -0.0520], [0.0026, -0.0480], [0.00285, -0.0440], [0.00285, -0.0300], [0, -0.0300]], { axis: 'z', seg: 14 });
    // ------------------------------------------------------------ markings (receiver flats)
    R.quad(MK, [W + 0.0016, -0.0120, 0.1700], qw(0.0088, 0.2), 0.0088, row(0, 0, 0.2), { r: [0, 90, 0] });
    R.quad(MK, [-W - 0.0011, -0.0200, 0.0950], qw(0.0070, 0.26), 0.0070, row(1, 0, 0.26), { r: [0, -90, 0] });
    R.quad(MK, [W + 0.0026, 0.0060, 0.0980], qw(0.0035, 0.2), 0.0035, row(2, 0, 0.2), { r: [0, 90, 0] });
    R.quad(MK, [0, 0.0352, 0.1301], qw(0.0045, 0.2), 0.0045, row(2, 0, 0.2));
    K.socket('muzzle', 'root', [0, 0, -0.272]); K.socket('eject', 'root', [0.018, 0.008, 0.03]);
    K.socket('sightRear', 'cover', [0, 0.0435, 0.128]); K.socket('sightFront', 'root', [0, 0.0435, -0.160]);
    return { length: 0.735, sightHeight: 0.0435, rearSightZ: 0.128, frontSightZ: -0.160 };
  },
};
