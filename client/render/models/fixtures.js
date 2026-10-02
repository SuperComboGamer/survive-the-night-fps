// Models of the chapel bell and the Relay Station's radio set (shared/fixtures.js; footprints in shared/props.js).
// Prop builders like those of props.js, which lists these among its own: (b: MeshBuilder, r: rng), origin at the
// middle of the base, front facing -Z.
const PI = Math.PI;

export const FIXTURE_PROPS = {
  // The bell as it hangs in the belfry: the lip at y = 0, the headstock it swings from across the top along X,
  // reaching the corner posts on either side, and the wheel the rope runs over at one end.
  church_bell(b) {
    const timber = [0.5, 0.44, 0.38];
    // from the lip up over the sound bow, the waist and the shoulder to the crown
    const prof = [[0.5, 0], [0.5, 0.035], [0.455, 0.1], [0.385, 0.21], [0.335, 0.36], [0.305, 0.52], [0.29, 0.64], [0.255, 0.72], [0.17, 0.77], [0.001, 0.785]];
    b.lathe('rust', prof, 14);
    b.lathe('dark', [[0.001, 0.7], [0.27, 0.62], [0.31, 0.36], [0.43, 0.1], [0.47, 0.012]], 14); // the inside, up the mouth
    b.cyl('rust', 0.51, 0.51, 0.03, 14, { p: [0, 0.018, 0], open: true });
    // clapper
    b.cylBetween('steel', [0, 0.6, 0], [0.05, 0.06, 0.03], 0.012, 0.018, 5);
    b.sphere('steel', 0.065, 7, 5, { p: [0.05, 0.03, 0.03] });
    // the crown bolted up into the headstock
    b.cyl('rust', 0.11, 0.15, 0.09, 8, { p: [0, 0.82, 0] });
    b.box('wood', 2.3, 0.2, 0.2, { p: [0, 0.96, 0], c: timber, grain: true });
    for (const x of [-0.16, 0.16]) b.box('steel', 0.045, 0.31, 0.215, { p: [x, 0.915, 0] });
    for (const sx of [-1, 1]) b.cyl('steel', 0.035, 0.035, 0.16, 6, { p: [sx * 0.96, 0.96, 0], r: [0, 0, PI / 2] }); // gudgeons
    // the wheel: a rim, eight spokes
    b.group({ p: [-0.72, 0.96, 0], r: [0, PI / 2, 0] }, () => {
      b.torus('wood', 0.5, 0.028, 4, 14, PI * 2, { c: timber });
      for (let k = 0; k < 4; k++) b.box('wood', 0.98, 0.035, 0.03, { r: [0, 0, (k * PI) / 4], c: timber, grain: true });
    });
  },

  // A field radio on a steel equipment cabinet, the mast it feeds on its left. The set has its tuning dial, knobs,
  // speaker and power lamp on a bare metal face, a handset off its hook on a coiled cord and a whip antenna; its
  // lead runs off the back to the mast.
  radio_set(b) {
    const cab = [0.3, 0.34, 0.27];
    const set = [0.2, 0.25, 0.14];
    const W = 1.0, H = 0.86, D = 0.56;
    const zf = -D / 2;
    // the cabinet: plinth, body, a top that overhangs, two doors with a seam between them
    b.box('dark', W - 0.08, 0.06, D - 0.08, { p: [0, 0.03, 0] });
    b.box('paint', W, H - 0.09, D, { p: [0, 0.06 + (H - 0.09) / 2, 0], c: cab });
    b.box('paint', W + 0.03, 0.03, D + 0.03, { p: [0, H - 0.015, 0], c: cab.map((c) => c * 1.12) });
    b.box('dark', 0.008, H - 0.16, 0.006, { p: [0, 0.43, zf - 0.002] });
    for (const sx of [-1, 1]) {
      b.box('paint', W / 2 - 0.05, H - 0.2, 0.012, { p: [sx * (W / 4), 0.43, zf - 0.005], c: cab.map((c) => c * 1.06) });
      b.box('chrome', 0.02, 0.1, 0.02, { p: [sx * 0.05, 0.47, zf - 0.02] });
      for (let k = 0; k < 4; k++) b.box('dark', 0.26, 0.012, 0.004, { p: [sx * (W / 4), 0.2 + k * 0.03, zf - 0.012] }); // vents
    }
    // the set
    const sw = 0.64, sh = 0.36, sd = 0.34;
    const sx0 = 0.14; // it stands to one side: the handset lies beside it
    const sy = H + sh / 2;
    const ff = -0.02 - sd / 2; // its face
    b.box('paint', sw, sh, sd, { p: [sx0, sy, -0.02], c: set });
    for (const sx of [-1, 1]) b.box('paint', 0.025, sh + 0.02, sd + 0.04, { p: [sx0 + sx * (sw / 2), sy, -0.02], c: set.map((c) => c * 0.7) }); // end caps
    b.box('steel', sw - 0.07, sh - 0.07, 0.008, { p: [sx0, sy, ff - 0.003] });
    // tuning dial, and the scale it reads off above it
    b.cyl('dark', 0.07, 0.07, 0.016, 12, { p: [sx0 + 0.17, sy - 0.05, ff - 0.014], r: [PI / 2, 0, 0] });
    b.cyl('chrome', 0.03, 0.036, 0.034, 8, { p: [sx0 + 0.17, sy - 0.05, ff - 0.036], r: [PI / 2, 0, 0] });
    b.box('paint', 0.22, 0.055, 0.004, { p: [sx0 + 0.13, sy + 0.09, ff - 0.009], c: [0.92, 0.84, 0.55] });
    b.box('emissive_red', 0.008, 0.055, 0.004, { p: [sx0 + 0.18, sy + 0.09, ff - 0.012] });
    // volume and squelch, two toggles, the power lamp
    for (const x of [-0.02, -0.1]) b.cyl('dark', 0.022, 0.027, 0.03, 7, { p: [sx0 + x, sy - 0.09, ff - 0.02], r: [PI / 2, 0, 0] });
    for (const x of [-0.02, -0.07]) b.box('chrome', 0.012, 0.035, 0.022, { p: [sx0 + x, sy - 0.005, ff - 0.016], r: [x < -0.05 ? 0.5 : -0.5, 0, 0] });
    b.sphere('emissive_red', 0.018, 6, 4, { p: [sx0 - 0.04, sy + 0.09, ff - 0.01] });
    // speaker
    b.box('dark', 0.17, 0.22, 0.006, { p: [sx0 - 0.19, sy, ff - 0.008] });
    for (let k = 0; k < 6; k++) b.box('steel', 0.15, 0.01, 0.006, { p: [sx0 - 0.19, sy - 0.08 + k * 0.032, ff - 0.012] });
    // carrying handle
    b.torus('steel', 0.09, 0.009, 4, 8, PI, { p: [sx0, H + sh, -0.02] });
    // whip antenna on its spring base, at the back corner
    b.cyl('rubber', 0.03, 0.036, 0.1, 6, { p: [sx0 + 0.24, H + sh + 0.05, 0.09] });
    b.cylBetween('dark', [sx0 + 0.24, H + sh + 0.08, 0.09], [sx0 + 0.32, H + sh + 1.45, 0.16], 0.007, 0.016, 5);
    // the handset, lying off its hook on the cabinet top, and its coiled cord
    b.group({ p: [-0.33, H + 0.035, -0.06], r: [0, 0.35, 0] }, () => {
      b.box('rubber', 0.05, 0.04, 0.22, {});
      for (const sz of [-1, 1]) b.cyl('rubber', 0.04, 0.035, 0.05, 8, { p: [0, -0.005, sz * 0.11] });
    });
    const coil = [];
    for (let k = 0; k <= 26; k++) {
      const u = k / 26;
      const a = u * PI * 12;
      coil.push([-0.3 + u * 0.13 + Math.cos(a) * 0.014, H + 0.022 + Math.sin(a) * 0.014 + Math.sin(u * PI) * 0.02, 0.05 + u * 0.03]);
    }
    b.tube('rubber', coil, 0.005, 52, 3);
    // the lead to the mast: off the back, down to the ground and away to the left
    b.tube('rubber', [[sx0 - 0.2, H + 0.1, 0.16], [sx0 - 0.22, 0.5, D / 2 + 0.04], [sx0 - 0.25, 0.03, D / 2 + 0.12], [-0.45, 0.015, D / 2 + 0.3], [-0.85, 0.015, D / 2 + 0.38]], 0.014, 12, 4);
  },
};
