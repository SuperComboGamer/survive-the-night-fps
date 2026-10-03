// Face identity + signed-distance sculpt of the head (all coordinates relative to HEAD_CENTER, metres; +x = character's right,
// +y up, −z = forward). One SDF describes cranium, brow ridge, orbits with eyelids (skin sphere with an almond palpebral bore
// through which the eyeball + cornea show), nose (dorsum, hump, tip, alae, nostril pits, columella), lips (vermilion, cupid's bow,
// philtrum groove, mentolabial sulcus), nasolabial folds / marionette lines, cheeks, jowls, masseter, mandible, chin (cleft).
// head.js samples it on a tensor grid that is dense over the eyes / nose / mouth. Constants exported here are mirrored in the
// shader (shading.js / skinshade.js) so painted eyes, lips, hairline and wrinkles land exactly on the geometry.
//
// Reference anthropometry (adult male, mm): bizygomatic 140, bigonial 105, interpupillary 64, eyeball Ø 24, palpebral fissure 28 x 10,
// cornea Ø 11.7 (radius of curvature 7.8, protrudes 2.6 beyond the globe), nose width 35, mouth width 50, ear 62 x 33.
export const EYE = { x: 0.032, y: -0.022, z: -0.0765, r: 0.0122 };
export const MOUTH_Y = -0.0892; // lip contact line (relative)
export const FIS = { cx: 0.0010, hw: 0.0130, up: 0.0046, dn: 0.0060, tilt: 0.06 }; // palpebral fissure (eye-local: ex lateral +, ey up)
export const EAR = { x: 0.0716, y: -0.027, z: 0.018 };
/** signed-ish distance to the almond fissure (< 0 inside); mirrored 1:1 in GLSL (skinshade.js) */
export function fissure(ex, ey) {
  const u = (ex - FIS.cx) / FIS.hw, s = Math.max(0, 1 - u * u), sh = Math.pow(s, 0.85);
  return Math.max(ey - (FIS.up * sh + FIS.tilt * ex), (-FIS.dn * sh + FIS.tilt * ex) - ey, (Math.abs(u) - 1) * FIS.hw * 0.6);
}

// ---------------------------------------------------------------- SDF primitives
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
export const sdSphere = (x, y, z, cx, cy, cz, r) => len3(x - cx, y - cy, z - cz) - r;
export function sdEll(x, y, z, cx, cy, cz, rx, ry, rz) { const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz; const k0 = len3(px, py, pz), k1 = len3(px / rx, py / ry, pz / rz); return k1 < 1e-9 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1; }
export function sdCap(x, y, z, ax, ay, az, bx, by, bz, r) { const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az; const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz))); return len3(pax - bax * h, pay - bay * h, paz - baz * h) - r; }
export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => -smin(-a, -b, k);

/** identity parameters (randomised per look, overridable through o.body({face:{…}}): every key optional) */
export function faceParams(rng, o = {}) {
  const R = (a, b) => a + (b - a) * rng(), S = () => rng() * 2 - 1, P = (p) => rng() < p;
  const gaunt = o.gaunt ?? R(0.3, 0.9), age = o.age ?? R(0.15, 0.95);
  return {
    brow: o.brow ?? R(0.82, 1.42), nose: o.nose ?? R(0.78, 1.3), noseW: o.noseW ?? R(0.85, 1.32), jaw: o.jaw ?? R(0.9, 1.14), chin: o.chin ?? R(0.82, 1.24),
    cheek: o.cheek ?? R(0.88, 1.28), gaunt, lip: o.lip ?? R(0.5, 0.98), cranium: o.cranium ?? R(0.96, 1.05), forehead: o.forehead ?? R(0, 1),
    bloat: o.bloat ?? 0, earSize: o.earSize ?? R(0.9, 1.18), lipsGone: o.lipsGone ?? (rng() < 0.3 ? R(0.3, 1) : 0),
    teethMissing: o.teethMissing ?? R(0.05, 0.3), teethLen: o.teethLen ?? R(1.0, 1.25), earsGone: o.earsGone ?? 0,
    // round-2 identity (all new, all optional)
    age, noseHump: o.noseHump ?? (P(0.4) ? R(0.3, 1.0) : P(0.2) ? R(-0.7, -0.2) : 0), noseTip: o.noseTip ?? S() * 0.8, noseDev: o.noseDev ?? (P(0.3) ? S() : S() * 0.25),
    noseGone: o.noseGone ?? 0, deep: o.deep ?? Math.min(1, gaunt * 0.7 + R(0, 0.4)), bags: o.bags ?? Math.min(1, age * 0.8 + R(0, 0.3)), folds: o.folds ?? Math.min(1, age * 0.9 + R(-0.1, 0.25)),
    jowl: o.jowl ?? Math.max(0, age * 0.8 - gaunt * 0.5 + R(-0.2, 0.3)), masseter: o.masseter ?? R(0.3, 1.0), cleft: o.cleft ?? (P(0.25) ? R(0.5, 1) : 0),
    earStick: o.earStick ?? R(0.28, 0.62), earLobe: o.earLobe ?? R(0.6, 1.2), lidDrop: o.lidDrop ?? R(0, 0.6), browTilt: o.browTilt ?? S(), mouthTilt: o.mouthTilt ?? S(),
    jawShift: o.jawShift ?? S(), asym: o.asym ?? R(0.3, 1.0), gaze: o.gaze ?? [S() * 0.05, (P(0.25) ? R(0.1, 0.35) : S() * 0.05)], // gaze offsets (dead eyes roll up sometimes)
    skinFlush: o.skinFlush ?? R(0, 1), pores: o.pores ?? R(0.4, 1), jawOpenBias: o.jawOpenBias ?? 0,
  };
}

/** fissure incl. per-look eyelid droop (used by the hole cut, the eyeball patch and the lid-margin tube) */
export function fissureL(fp, ex, ey) { return fissure(ex, ey - fp.lidDrop * 0.0008 * (ex > 0 ? 1 : 0.3)); }
const gv = (d, A, s) => A * Math.exp(-(d * d) / (s * s)); // smooth groove / pit profile (added to the distance field): no boolean seams, no noise

/** the head SDF. Groups carry a bounding-sphere cull (exact for the blends they take part in) so sphere tracing far from the face is cheap.
 *  Fine creases are SMOOTH displacements of the field (gv), not carves: carved capsules with a smoothing radius above their own radius made the
 *  field non-monotonic and the radial grid tore. The eyeball, cornea and eyelid margins are separate meshes (head.js buildEyes). */
export function makeFaceSDF(fp) {
  const b = fp.brow, n = fp.nose, nw = fp.noseW, j = fp.jaw, ch = fp.chin, ck = fp.cheek, g = fp.gaunt * 0.55, cr = fp.cranium, bl = fp.bloat;
  const lp = fp.lip * (1 - fp.lipsGone * 0.6), lift = fp.lipsGone * 0.0032, nz = (n - 1) * 0.006, dev = 0, hump = fp.noseHump, tipUp = fp.noseTip * 0.0028;
  const deep = fp.deep, bag = fp.bags, fold = fp.folds, mt = 0, jshift = 0, noseGone = fp.noseGone > 0.5;
  const EX = EYE.x, EY = EYE.y, EZ = EYE.z, ER = EYE.r, bt = 0, lidD = fp.lidDrop, mass = fp.masseter;
  const seg = (x, y, z, ax, ay, az, bx, by, bz) => sdCap(x, y, z, ax, ay, az, bx, by, bz, 0);
  return (x, y, z) => {
    const ax = Math.abs(x), sg = x < 0 ? -1 : 1;
    // ---- base masses
    let d = sdEll(x, y, z, 0, 0.006, 0.012, 0.0755 * cr + bl * 0.004, 0.084 * cr, 0.098 * cr);                                 // cranium
    d = smin(d, sdEll(x, y, z, 0, -0.012 + fp.forehead * 0.004, -0.05, 0.066, 0.05, 0.048), 0.03);                             // frontal bone
    d = smin(d, sdEll(x, y, z, 0, -0.048, -0.04, 0.066 + bl * 0.006, 0.05, 0.06), 0.026);                                      // maxilla + cheeks
    d = smin(d, sdEll(x, y, z, 0, -0.103, -0.046, 0.05 + bl * 0.006, 0.041, 0.05), 0.03);                                     // lower face
    d = smin(d, sdEll(ax, y, z, 0.05, -0.03, -0.055, 0.021 * ck, 0.016, 0.03), 0.014);                                          // zygoma
    d = smin(d, sdCap(ax, y, z, 0.062 * j, -0.042, 0.004, 0.051 * j, -0.098, 0.006, 0.011 + bl * 0.004), 0.028);                // ramus
    d = smin(d, sdCap(ax, y, z, 0.051 * j, -0.098, 0.006, 0.022, -0.128, -0.062 * ch, 0.012 + bl * 0.005), 0.03);               // mandible body
    d = smin(d, sdEll(x - jshift, y, z, 0, -0.127, -0.068 * ch, 0.022 * ch, 0.018, 0.016), 0.016);                             // chin
    d = smin(d, sdEll(x, y, z, 0, -0.088, -0.074, 0.033, 0.023, 0.027), 0.016);                                                // dental arch mass
    d = smin(d, sdEll(x, y, z, 0, -0.022, 0.058, 0.057, 0.05, 0.048), 0.03);                                                   // occiput
    d = smin(d, sdCap(x, y, z, 0, -0.06, 0.018, 0, -0.2, 0.024, 0.045), 0.03);                                                 // neck stub
    const jw = fp.jowl; if (jw > 0.02) d = smin(d, sdEll(ax, y, z, 0.044, -0.113, -0.05, 0.016 * jw + 0.004, 0.013 * jw + 0.004, 0.02), 0.022);   // jowls
    d = smin(d, sdEll(ax, y, z, 0.057, -0.078, -0.006, 0.008 + 0.004 * mass, 0.02, 0.017), 0.02);                             // masseter
    d = smax(d, -sdEll(ax, y, z, 0.07, -0.002, -0.048, 0.011, 0.024, 0.024), 0.012 + g * 0.004);                               // temporal fossa
    d = smax(d, -sdEll(ax, y, z, 0.05, -0.07, -0.062, 0.012 + g * 0.004, 0.017, 0.014), 0.018 + g * 0.01 - bl * 0.01);         // cheek hollow
    if (fp.cleft > 0.02) d += gv(seg(x, y, z, jshift, -0.1345, -0.1245, jshift, -0.1455, -0.1185), 0.0012 * fp.cleft, 0.0022);  // chin cleft
    // ---- eyes region: brows, orbit saucer, lid domes (no bore: the palpebral opening is cut in head.js), bags, creases
    { const dg = len3(ax - 0.034, y + 0.02, z + 0.085) - 0.042;
      if (dg > 0.014) d = Math.min(d, dg);
      else {
        const by = bt * sg;
        d = smin(d, sdCap(ax, y, z, 0.006, 0.0068 + by, -0.0935, 0.030, 0.0105 + by, -0.0915, 0.0105 * b), 0.016);                // brow ridge (medial → arch)
        d = smin(d, sdCap(ax, y, z, 0.030, 0.0105 + by, -0.0915, 0.053, 0.0058 + by, -0.076, 0.0080 * b), 0.014);                 // brow ridge (arch → lateral)
        d = smax(d, -sdEll(ax, y, z, EX + 0.001, EY + 0.002, -0.0945, 0.0215 + deep * 0.002, 0.0172 + deep * 0.003, 0.0068 + deep * 0.0015), 0.007); // orbit (shallow saucer)
        d = smin(d, sdSphere(ax, y, z, EX, EY, EZ, ER + 0.0026 - deep * 0.0008), 0.0035);                                          // lids (skin dome over the globe)
        d = smin(d, sdEll(ax, y, z, EX, EY - 0.0138, -0.0862, 0.0125, 0.0035 * bag + 0.0007, 0.006), 0.005);                       // lower-lid bag
        d += gv(seg(ax, y, z, EX - 0.011, EY + 0.0090 + lidD * 0.002, -0.0872, EX + 0.014, EY + 0.0100 + lidD * 0.002, -0.0872), 0.0009 + 0.0012 * fold, 0.0022); // upper lid crease
        d += gv(seg(ax, y, z, EX - 0.012, EY - 0.0200, -0.0865, EX + 0.012, EY - 0.0212, -0.0870), 0.0007 + 0.0016 * bag, 0.0028);  // tear trough
      } }
    // ---- nose
    { const dg = len3(x, y + 0.045, z + 0.105) - 0.05;
      if (dg > 0.014) d = Math.min(d, dg);
      else if (!noseGone) {
        d = smin(d, sdCap(x, y, z, 0, -0.012, -0.0935, dev, -0.0575 - nz * 0.5, -0.1105 - nz, 0.0043 * nw), 0.011);                    // dorsum
        d = smin(d, sdCap(x, y, z, dev * 0.3, -0.024, -0.098, dev * 0.7, -0.046, -0.1055 - nz * 0.5, 0.0058 * nw), 0.008);              // bridge → cartilage (widens)
        if (hump > 0.02) d = smin(d, sdSphere(x, y, z, dev * 0.4, -0.036, -0.1025 - nz * 0.3, 0.0046 * hump + 0.001), 0.006);             // dorsal hump
        else if (hump < -0.02) d += gv(len3(x, y + 0.038, z + 0.108), 0.0035 * -hump, 0.007);                                            // saddle
        d = smin(d, sdSphere(x, y, z, dev, -0.0625 - nz * 0.5 + tipUp, -0.1135 - nz, 0.0098 * nw), 0.007);                             // tip
        d = smin(d, sdEll(ax, y, z, 0.0112 * nw, -0.069, -0.1045, 0.0078 * nw, 0.0068, 0.0085), 0.006);                                // alae
        d = smin(d, sdCap(x, y, z, dev, -0.0675, -0.1105 - nz * 0.5, 0, -0.0748, -0.1035, 0.0034), 0.005);                             // columella
        d += gv(len3(ax - 0.0082 * nw, y + 0.0755, z + 0.1075 + nz * 0.5), 0.0065, 0.0026);                                            // nostril pits (soft)
        d += gv(seg(ax, y, z, 0.0182 * nw, -0.0605, -0.0995, 0.0205 * nw, -0.0745, -0.0968), 0.0016, 0.0024);                         // alar groove
      } else { d = smax(d, -sdEll(x, y, z, 0, -0.05, -0.1, 0.0105, 0.019, 0.02), 0.004); d = smin(d, sdEll(ax, y, z, 0.0125, -0.066, -0.098, 0.005, 0.006, 0.007), 0.004); } // missing nose: pear-shaped aperture
    }
    // ---- mouth, lips, folds, chin creases
    { const dg = len3(x, y + 0.095, z + 0.09) - 0.062;
      if (dg > 0.014) d = Math.min(d, dg);
      else {
        const uy = -0.0836 + lift + mt * sg, ly = -0.0952 - lift * 0.8 + mt * sg;
        d = smin(d, sdCap(ax, y, z, 0.0015, uy, -0.0995, 0.0208, uy, -0.0972, 0.0052 * lp + 0.0012), 0.006);                            // upper lip (vermilion), each half
        d = smin(d, sdSphere(x, y, z, 0, uy - 0.0009, -0.1018, 0.0033 * lp + 0.0006), 0.004);                                          // tubercle of the upper lip
        d = smin(d, sdCap(ax, y, z, 0.0, ly, -0.1003, 0.0196, ly + 0.001, -0.0975, 0.0064 * lp + 0.0014), 0.006);                      // lower lip
        d += gv(seg(ax, y, z, 0.0, -0.0762, -0.1042, 0.0, -0.0808, -0.1034), 0.0011, 0.0016);                                         // philtrum groove
        d += gv(seg(ax, y, z, 0.0015, -0.1088, -0.1003, 0.0105, -0.1080, -0.0985), 0.0016, 0.0032);                                    // mentolabial sulcus
        d += gv(len3(ax - 0.0264, y + 0.0893 - mt * sg, z + 0.0948), 0.0016, 0.0022);                                                  // commissure dimple
        const fA = 0.0011 + 0.0022 * fold;
        d += gv(seg(ax, y, z, 0.0205 * nw, -0.0745, -0.0965, 0.0262, -0.0868, -0.0935), fA, 0.0034);                                   // nasolabial fold (1)
        d += gv(seg(ax, y, z, 0.0262, -0.0868, -0.0935, 0.0300, -0.0995, -0.0888), fA * 0.9, 0.0036);                                  // nasolabial fold (2)
        d += gv(seg(ax, y, z, 0.0268, -0.0925, -0.0930, 0.0272, -0.1130, -0.0895), 0.0007 + 0.0019 * fold, 0.0032);                   // marionette line
      } }
    return d;
  };
}

/** small identity asymmetries (jaw shift, crooked nose, mouth tilt, brow tilt) applied to the sampled grid AFTER the mirrored trace, so the SDF stays symmetric */
export function asymWarp(fp) {
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const jx = fp.jawShift * 0.0022 * fp.asym, dv = fp.noseDev * 0.0035, mt = fp.mouthTilt * 0.0006 * fp.asym, bt = fp.browTilt * 0.0011 * fp.asym;
  return (p) => {
    const sg = p.x < 0 ? -1 : 1; let dx = jx * sm(-0.09, -0.135, p.y) + dv * sm(-0.012, -0.06, p.y) * sm(-0.075, -0.112, p.z) * 0.9; let dy = 0;
    dy += mt * sg * sm(0.03, 0.006, Math.abs(p.y + 0.0892)) * sm(0.005, 0.02, Math.abs(p.x)) * sm(-0.07, -0.09, p.z); dy += bt * sg * sm(0.03, 0.006, Math.abs(p.y - 0.006)) * sm(-0.07, -0.09, p.z);
    p.x += dx; p.y += dy; return p;
  };
}
