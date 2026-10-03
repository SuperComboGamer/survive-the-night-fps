// GLSL for the organic zombie materials: dead skin (face zones, pores, wrinkles, veins, livor, bruises, stubble, lips, ears, hands with
// finger creases + knuckle wrinkles + tendon veins, feet), the eyeball patch (id 17: sclera veins, iris fibres + limbal ring, pupil,
// cataract / glow), teeth, gums + tongue papillae, exposed flesh (fat / muscle fibres / tendon), bone, nails and hair strands
// (Kajiya-Kay via the light-loop hook in shading.js). Strings are spliced into the single zombie fragment shader (shading.js).
// Fetch budget of the skin branch (LOD0/1): 2 macro + 1 vein + 1 micro + a few zone fetches ≈ 10 — one uNoise3 fetch returns FOUR
// independent fields, so every fetch is spent on several uses. All detail is evaluated in REST space (sticks to the body while it moves).
import { RIG, HEAD_CENTER } from './rig.js';
import { EYE, EAR } from './face.js';

const f = (x) => x.toFixed(5);
const v3 = (a) => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;
// right-hand constants (the left hand is the exact mirror of the right one in the rig: shader mirrors |x|)
const A = RIG.arm.R;
const FING = ['index', 'middle', 'ring', 'pinky', 'thumb'];
const FP = FING.map((n) => A.fingers[n].pts.map(v3)).flat();
const FR = FING.map((n) => f(A.fingers[n].rad));
const FL = FING.map((n) => A.fingers[n].len.map(f)).flat();
export const HAND_GLSL = `
const vec3 H_WR = ${v3(A.wr)}, H_H = ${v3(A.h)}, H_P = ${v3(A.p)}, H_T = ${v3(A.t)};
const vec3 FPT[20] = vec3[20](${FP.join(', ')});
const float FRAD[5] = float[5](${FR.join(', ')});
const float FLEN[15] = float[15](${FL.join(', ')});
`;
const HC = HEAD_CENTER;

/** helpers in the fragment-shader global scope (before main) */
export const SKIN_PARS = /* glsl */`
vec4 zn4(vec3 p){ return texture(uNoise3, p * 0.125); }          // one fetch = 4 independent fields (1 cell per unit of p)
float gSSS = 0.0, gHair = 0.0; vec3 gHairT = vec3(0.0, 1.0, 0.0); vec3 gHairCol = vec3(0.3);
${HAND_GLSL}
float sdSeg(vec3 p, vec3 a, vec3 b, out float t){ vec3 ab = b - a; t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return length(p - a - ab * t); }
`;

// ------------------------------------------------------------------------------------------------------------------ id 0: skin
export const SKIN_BRANCH = /* glsl */`
if (id == 0) { // ---------------- dead skin
  isSkin = true; porous = true;
  zAlb *= uSkinTint;
  vec4 M4 = zn4(S * 3.3), N4 = zn4(S * 11.6 + vec3(2.3, 5.1, 1.7));       // macro (30 cm) + meso (9 cm) fields, 1 fetch each
  float ageK = uFace.z, gauntK = uStyle.y;
  zAlb *= 0.8 + 0.42 * M4.r + 0.16 * (N4.r - 0.5);
  // livor mortis (blood pooled low / at the back), grey-green necrosis, bruises with a yellow-green rim
  float lm = smoothstep(0.5, 0.72, M4.g) * (0.45 + 0.55 * smoothstep(1.2, 0.3, P.y)) * (0.6 + 0.4 * smoothstep(-0.02, 0.06, P.z));
  zAlb = mix(zAlb, zAlb * vec3(0.55, 0.28, 0.42) + vec3(0.03, 0.0, 0.015), lm * 0.85);
  zAlb = mix(zAlb, zAlb * vec3(0.74, 0.9, 0.7), smoothstep(0.42, 0.68, M4.b) * 0.7);
  float bru = smoothstep(0.56, 0.76, M4.a) * (0.45 + 0.55 * smoothstep(1.35, 0.5, P.y)) * (1.0 - headZone * 0.5);
  float bruRim = smoothstep(0.5, 0.56, M4.a) * (1.0 - smoothstep(0.56, 0.64, M4.a));
  zAlb = mix(zAlb, vec3(0.16, 0.055, 0.12) + zAlb * 0.25, bru * 0.85);
  zAlb = mix(zAlb, zAlb * vec3(1.12, 1.02, 0.45), bruRim * (1.0 - bru) * 0.55 * (1.0 - headZone * 0.5));
  zRough = mix(zRough, 0.3, smoothstep(0.55, 0.75, N4.b) * 0.5); zRough = mix(zRough, 0.82, smoothstep(0.35, 0.15, M4.r) * 0.5);
  // age spots / freckles (per spawn age), moles
  float spots = smoothstep(0.72, 0.8, N4.g) * (0.25 + ageK * 0.75) * step(0.1, P.y); zAlb = mix(zAlb, zAlb * vec3(0.72, 0.55, 0.42), spots * 0.5);
  // veins: sparse blue-green branching lines (forearms, hands, temples, neck, chest), thickness 1.5-3 mm
  float vmask = (0.3 + 0.7 * smoothstep(0.12, 0.3, abs(P.x)) * smoothstep(1.5, 1.0, P.y)) * (1.0 - headZone * 0.55);
  float vr = ridge(S * vec3(6.0, 2.2, 6.0) + N4.rgb * 1.7); float vein = smoothstep(0.93, 0.985, vr) * vmask * aaFade(0.02, fp);
  zAlb = mix(zAlb, zAlb * vec3(0.42, 0.5, 0.62) + vec3(0.0, 0.008, 0.016), vein * 0.62); zH += vein * 0.00018;
  // marbling: the branching green-purple network of decomposing veins (visible at 2 m on chest / limbs)
  float mbr = ridge(S * vec3(4.2, 2.2, 4.2) + N4.rgb * 1.3 + 3.0); float marb = smoothstep(0.9, 0.975, mbr) * smoothstep(0.4, 0.7, M4.b) * (0.3 + 0.7 * smoothstep(1.55, 0.6, P.y)) * (1.0 - headZone * 0.7) * aaFade(0.03, fp);
  zAlb = mix(zAlb, zAlb * vec3(0.5, 0.75, 0.55) + vec3(0.0, 0.01, 0.0), marb * 0.7);
  // rot / decay patches
  float rot = smoothstep(0.62, 0.78, N4.a) * (0.3 + wear);
  zAlb = mix(zAlb, vec3(0.085, 0.08, 0.035), rot * 0.75); zRough = mix(zRough, 0.28, rot * 0.7);
#ifndef ZFAR
  vec4 MI = zn4(S * 1100.0 + vec3(3.1, 1.3, 7.7)), MJ = zn4(S * 2000.0 + vec3(5.3, 2.9, 1.1));   // micro (0.9 mm cells): pores, fine creases; (0.5 mm): stubble dots
  float pores = smoothstep(0.68, 0.88, MI.r) * aaFade(0.0012, fp);
  zH += (MI.r - 0.5) * 0.00005 * aaFade(0.0014, fp) + (MI.g - 0.5) * 0.00005 * aaFade(0.0035, fp);
  zRough = mix(zRough, min(1.0, zRough + 0.18), pores * 0.6); zAlb *= 1.0 - pores * 0.10 * (0.4 + uFace.z * 0.6);
#endif
  // ---- head zones
  if (headZone > 0.5) {
    float sx = sign(q.x); float ax = abs(q.x); float flush = 0.4 + 0.6 * fract(uSeed * 3.71);
    // facial redness: cheeks / nose / ears, yellow forehead, dark periorbital rings, sallow under the jaw
    float cheekF = exp(-pow2((ax - 0.046) / 0.022) - pow2((q.y + 0.05) / 0.03));
    float noseF = exp(-length((q - vec3(0.0, -0.064, -0.113)) * vec3(1.0, 0.9, 1.0)) / 0.016) + 0.6 * exp(-length((vec3(ax, q.y, q.z) - vec3(0.011, -0.069, -0.105))) / 0.012);
    float earF = smoothstep(0.062, 0.072, ax) * step(-0.05, q.y) * step(q.y, 0.03) * step(-0.02, q.z);
    zAlb *= mix(vec3(1.0), vec3(1.10, 0.88, 0.9), clamp(cheekF * 0.6 + noseF * 0.75 + earF * 0.7, 0.0, 1.0) * flush);
    zAlb = mix(zAlb, zAlb * vec3(1.06, 1.0, 0.82), smoothstep(0.0, 0.05, q.y) * smoothstep(-0.06, -0.09, q.z) * 0.5);
    vec3 e = q - vec3(sx * ${f(EYE.x)}, ${f(EYE.y)}, ${f(EYE.z)}); float de = length(e);
    float orb = smoothstep(0.036, 0.008, length(e.xy * vec2(0.8, 1.15))) * step(e.z, 0.01);
    zAlb = mix(zAlb, zAlb * vec3(0.5, 0.38, 0.46) + vec3(0.02, 0.0, 0.015), orb * (0.7 + 0.3 * gauntK));
    zAO *= 1.0 - orb * (0.3 + 0.3 * gauntK); zEmis += uGlow.rgb * uGlow.w * uStyle.w * smoothstep(0.03, 0.01, de) * 0.05;
    // lips: vermilion (blue-purple, cracked, lighter border roll), philtrum ridges, corner shadows
    float lipY = q.y + ${f(-0.0892)};
    float lipM = smoothstep(0.0128, 0.0102, lipY) * smoothstep(-0.0142, -0.0112, lipY) * smoothstep(0.0232, 0.0196, ax) * smoothstep(-0.083, -0.094, q.z);
    float lipRoll = smoothstep(0.0009, 0.0, abs(abs(lipY + 0.0005) - 0.0110 + step(lipY, 0.0) * 0.0012)) * lipM;
    vec3 lipCol = mix(vec3(0.15, 0.085, 0.095), vec3(0.24, 0.11, 0.12), flush * 0.5) * (0.7 + 0.5 * zAlb.g) * (0.8 + 0.4 * N4.b);
    zAlb = mix(zAlb, lipCol + zAlb * 0.15, lipM * 0.85); zAlb = mix(zAlb, zAlb * 1.25 + 0.01, lipRoll * 0.5); zRough = mix(zRough, 0.5, lipM);
    zEmis += zAlb * vec3(1.0, 0.3, 0.22) * 0.05 * clamp(noseF * 0.8 + earF + lipM * 0.6, 0.0, 1.0); // blood colour shows through thin skin even in cold / dark light
#ifndef ZFAR
    float lcr = smoothstep(0.62, 0.72, MI.g) * lipM; zAlb *= 1.0 - lcr * 0.35; zH += lipM * (MI.b - 0.5) * 0.0002 - lcr * 0.0003;
#endif
    // nostrils, alar creases
    float nos = smoothstep(0.0072, 0.0018, length((vec3(ax, q.y, q.z) - vec3(0.0080, -0.0742, -0.1075)) * vec3(1.0, 1.7, 1.0)));
    zAlb *= 1.0 - nos * 0.88; zAO *= 1.0 - nos * 0.6;
    // aged skin: forehead lines, glabellar frown, crow's feet, lip lines, eye bags creping (per-spawn age); lines wobble + break with noise
    float wob = (N4.g - 0.5) * 0.010;
    float fh = smoothstep(0.30, 0.0, abs(fract((q.y - 0.02 + wob) / 0.0118) - 0.5)) * step(0.02, q.y) * step(q.y, 0.075) * step(q.z, -0.07) * smoothstep(0.055, 0.03, ax) * smoothstep(0.35, 0.65, N4.b + 0.3 * ageK);
    float gl = smoothstep(0.0022, 0.0, abs(ax - 0.006 - 0.5 * (q.y + 0.005))) * step(-0.012, q.y) * step(q.y, 0.03) * step(q.z, -0.085);
    float cfr = length(vec2(ax - 0.0475, q.y + 0.0215)); float cf = smoothstep(0.32, 0.0, abs(fract(atan(q.y + 0.0215, ax - 0.0475) * 2.1 + N4.r * 1.5) - 0.5)) * smoothstep(0.004, 0.011, cfr) * smoothstep(0.03, 0.018, cfr) * step(0.0465, ax) * smoothstep(-0.9, -0.2, (q.y + 0.0215) / max(cfr, 1e-4) * -1.0 + 0.0);
    float ll = smoothstep(0.28, 0.0, abs(fract(q.x / 0.0032 + N4.r * 2.0) - 0.5)) * smoothstep(0.02, 0.016, ax) * smoothstep(0.0, 0.002, abs(lipY) - 0.0125) * smoothstep(0.024, 0.016, abs(lipY)) * step(q.z, -0.09);
    float agel = clamp((fh + gl * 0.8 + cf + ll * 0.7) * (0.25 + ageK * 0.95), 0.0, 1.0);
    zAlb *= 1.0 - agel * 0.26; zH -= agel * 0.00055; zAO *= 1.0 - agel * 0.12;
    // stubble / beard shadow: dark pepper dots over the lower face, denser toward the chin and upper lip
    float beardZone = smoothstep(-0.06, -0.085, q.y) * smoothstep(0.02, -0.05, q.z) * (1.0 - smoothstep(0.0, 0.004, lipM)) + smoothstep(0.03, 0.02, ax) * smoothstep(-0.08, -0.075, q.y) * smoothstep(-0.093, -0.088, q.y) * step(q.z, -0.085);
    beardZone = clamp(beardZone, 0.0, 1.0) * smoothstep(-0.03, -0.045 + (N4.g - 0.5) * 0.02, q.y) * smoothstep(0.078, 0.06, ax);
    float side = uFace.y * smoothstep(0.014, 0.004, abs(ax - 0.066)) * step(-0.06, q.y) * step(q.y, 0.02) * step(-0.04, q.z) * step(q.z, 0.01);
    float stubD = clamp(beardZone * uHair2.y * 1.2 + side, 0.0, 1.0);
#ifndef ZFAR
    vec3 sc3 = S * 2200.0; vec3 sci = floor(sc3); float sh = zh1(sci); float sdot = smoothstep(0.30, 0.14, length(fract(sc3) - 0.5 - (vec3(zh1(sci + 1.3), zh1(sci + 2.7), zh1(sci + 4.1)) - 0.5) * 0.55) * (0.8 + 0.7 * zh1(sci + 9.1))) * step(1.0 - stubD * 0.85, sh) * aaFade(0.0018, fp);
    zAlb = mix(zAlb, uHair.rgb * 0.55, sdot * 0.85); zH += sdot * 0.00002;
#endif
    zAlb = mix(zAlb, mix(zAlb, uHair.rgb * 1.2 + 0.02, 0.5), stubD * 0.22);
    // scalp: hair-root shadow beneath the strand geometry (fades with hair amount); brows
    float front = smoothstep(0.02, -0.07, q.z);
    float hl = mix(-0.05, 0.05 - uHair2.x * 0.035, front); hl -= smoothstep(0.045, 0.075, ax) * front * 0.035;
    float crown = smoothstep(0.045, 0.02, length(q.xz - vec2(0.0, 0.02))) * step(0.07, q.y) * uHair2.w;
    float scalp = smoothstep(hl - 0.003, hl + 0.008, q.y + (N4.b - 0.5) * 0.012) * uHair.w * (1.0 - crown) * smoothstep(0.02, 0.05, length(q.xz) + q.y * 0.3);
    zAlb = mix(zAlb, uHair.rgb * 0.55 + zAlb * 0.1, scalp * 0.85); zRough = mix(zRough, 0.6, scalp); faceHair = scalp > 0.5;
    float brow = smoothstep(0.0055, 0.0016, abs(q.y - (-0.022 + 0.0165 + 0.002 * cos(ax * 60.0)))) * smoothstep(0.052, 0.042, ax) * smoothstep(0.008, 0.014, ax) * step(q.z, -0.07) * uHair2.z;
    zAlb = mix(zAlb, uHair.rgb * 0.6, brow * 0.22);
    // blood around the mouth / chin (feeding): clotted dark red, glossy
    float mb = smoothstep(0.038, 0.0, length((q - vec3(0.0, -0.105, -0.095)) * vec3(0.8, 1.15, 1.0))) * (0.3 + 0.7 * N4.a) * uLayers.w;
    zAlb = mix(zAlb, vec3(0.09, 0.006, 0.008), clamp(mb * 1.6, 0.0, 0.92)); zRough = mix(zRough, 0.16, clamp(mb * 1.6, 0.0, 0.9)); zCC = max(zCC, mb);
    // oily T-zone vs dry cheeks, thin-skin translucency handled in zThin
    zRough = mix(zRough, 0.36, smoothstep(0.02, 0.0, ax) * step(-0.1, q.y) * step(q.y, 0.04) * 0.7); zRough = mix(zRough, 0.5, cheekF * 0.4);
    if (uFace.w != 0.0) { // torn cheek (painted for LOD2 / distance; the geometry version is built by flesh.js)
      vec2 cq = vec2(q.x * sign(uFace.w) - 0.043, q.y + 0.083); float cr = length(cq * vec2(1.0, 1.5));
      float hole = smoothstep(0.022, 0.016, cr), rim = smoothstep(0.03, 0.02, cr) - hole;
      float teeth = hole * smoothstep(0.009, 0.004, abs(cq.y)) * smoothstep(0.3, 0.12, abs(fract(cq.x / 0.0055) - 0.5));
      zAlb = mix(zAlb, vec3(0.12, 0.012, 0.015), hole); zAlb = mix(zAlb, vec3(0.2, 0.03, 0.035), rim * 0.8); zAlb = mix(zAlb, vec3(0.5, 0.44, 0.3), teeth);
      zRough = mix(zRough, 0.2, hole); zH -= hole * 0.003; zAO *= 1.0 - hole * 0.5;
    }
  }
  // ---- torso anatomy relief (rest space): ribs (gaunt), clavicles, sternum, linea alba, spine groove, scapulae
  if (P.y > 0.9 && P.y < 1.5 && abs(P.x) < 0.2) {
    float ax = abs(P.x); float front = smoothstep(0.0, -0.05, P.z), back = smoothstep(0.02, 0.07, P.z);
    float ribPh = (P.y + ax * 0.32 - 1.0 + (N4.r - 0.5) * 0.012) / 0.034; float rib = smoothstep(0.35, 0.0, abs(fract(ribPh) - 0.5)) * step(1.07, P.y) * step(P.y, 1.31) * smoothstep(0.025, 0.06, ax) * (1.0 - back * 0.5);
    rib *= 0.55 + 0.9 * N4.g; zH += rib * 0.0011 * gauntK; zAO *= 1.0 - (1.0 - rib) * 0.1 * gauntK * step(1.07, P.y) * step(P.y, 1.31) * smoothstep(0.025, 0.06, ax);
    float clav = smoothstep(0.012, 0.0, abs(P.y - (1.432 + ax * 0.06))) * smoothstep(0.02, 0.05, ax) * smoothstep(0.19, 0.15, ax) * front; zH += clav * 0.003;
    float alba = smoothstep(0.008, 0.0, ax) * front * step(0.98, P.y) * step(P.y, 1.28); zH -= alba * 0.0018; float stern = smoothstep(0.01, 0.0, ax) * front * step(1.28, P.y) * step(P.y, 1.42); zH -= stern * 0.0012;
    float spine = smoothstep(0.012, 0.0, ax) * back; zH -= spine * 0.003; zH += spine * smoothstep(0.3, 0.0, abs(fract(P.y / 0.028) - 0.5)) * 0.001 * gauntK;
    float scap = smoothstep(0.05, 0.02, length(vec2(ax - 0.09, (P.y - 1.34) * 0.7))) * back; zH += scap * 0.004;
  }
  // ---- neck: sternocleidomastoid cords, Adam's apple, horizontal neck creases
  if (P.y > 1.47 && P.y < 1.63 && length(P.xz - vec2(0.0, 0.02)) < 0.09) {
    float ax = abs(P.x); float sc = smoothstep(0.011, 0.0, abs(ax - (0.024 + (P.y - 1.5) * 0.02))) * smoothstep(-0.02, -0.05, P.z) * (0.4 + 0.6 * gauntK) * smoothstep(1.47, 1.5, P.y);
    zH += sc * 0.0022; zAO *= 1.0 - sc * 0.15;
    float lx = smoothstep(0.009, 0.0, length(vec2(P.x, P.y - 1.545)) + (P.z + 0.03) * 0.0) * smoothstep(-0.03, -0.045, P.z); zH += lx * 0.0016;
    float nc = smoothstep(0.3, 0.0, abs(fract((P.y + N4.r * 0.006) / 0.012) - 0.5)) * smoothstep(-0.02, -0.04, P.z) * (0.2 + ageK * 0.8); zH -= nc * 0.00035; zAlb *= 1.0 - nc * 0.1;
  }
  // ---- hands: knuckle wrinkles, finger creases (palmar), thenar / hypothenar pads, tendon veins, fingertip cyanosis, nail-bed pink
  { vec3 Pm = vec3(abs(P.x), P.y, P.z); vec3 Nm = vec3(Nr.x * (P.x < 0.0 ? -1.0 : 1.0), Nr.y, Nr.z); vec3 hd = Pm - H_WR; float hz = smoothstep(0.26, 0.2, length(hd));
#ifndef ZFAR
    if (hz > 0.0) {
      float ha = dot(hd, H_H), hb = dot(hd, H_P), hc = dot(hd, H_T); float dors = smoothstep(0.1, -0.5, dot(Nm, H_P)), palm = 1.0 - dors;
      // nearest finger (segment distance − radius)
      float bestD = 1e9, bestS = 0.0; int bestF = 0;
      for (int fi = 0; fi < 5; fi++) { float sAcc = 0.0; for (int k = 0; k < 3; k++) { float t; float d0 = sdSeg(Pm, FPT[fi * 4 + k], FPT[fi * 4 + k + 1], t) - FRAD[fi] * (1.0 - 0.13 * float(k)); float sl = FLEN[fi * 3 + k]; if (d0 < bestD) { bestD = d0; bestS = sAcc + t * sl; bestF = fi; } sAcc += sl; } }
      float fingerM = smoothstep(0.008, 0.0, bestD) * step(0.0, ha - 0.05) ; // fingers only (beyond the palm's knuckle line)
      float l0 = FLEN[bestF * 3], l1 = FLEN[bestF * 3 + 1];
      float dj1 = bestS - l0, dj2 = bestS - l0 - l1, dj0 = bestS;
      // palmar creases (deep single line at DIP / PIP / MCP) + dorsal transverse wrinkles at the knuckles
      float crease = exp(-pow2(dj1 / 0.0009)) + exp(-pow2(dj2 / 0.0008)) * 0.8 + exp(-pow2((dj0 - 0.0) / 0.0011)) * 0.9;
      float wr = (exp(-pow2(dj1 / 0.0055)) + exp(-pow2(dj2 / 0.0045)) + 0.7 * exp(-pow2((dj0 - 0.003) / 0.0055))) * (0.5 + 0.5 * sin(bestS * 6.2832 / 0.0013 + N4.r * 3.0));
      zH -= fingerM * (palm * crease * 0.00045 + dors * wr * 0.00013) * aaFade(0.0025, fp);
      zAlb *= 1.0 - fingerM * (palm * crease * 0.22 + dors * wr * 0.09);
      float knuck = (exp(-pow2(dj1 / 0.007)) + exp(-pow2(dj2 / 0.006)) + exp(-pow2((dj0 - 0.002) / 0.008))) * dors * fingerM; zAlb *= mix(vec3(1.0), vec3(0.9, 0.7, 0.68), knuck * 0.55);
      float tip = smoothstep(l0 + l1 + 0.004, l0 + l1 + 0.02, bestS) * fingerM; zAlb = mix(zAlb, zAlb * vec3(0.72, 0.55, 0.66), tip * 0.5);
      // palm: creases (heart / head / life lines), thenar + hypothenar pad shading, tendon veins along the back of the hand
      float palmM = smoothstep(0.02, 0.0, abs(hb + 0.014)) * step(ha, 0.09) * step(0.0, ha) * palm;
      float pl = smoothstep(0.0011, 0.0, abs(length(vec2(hc - 0.03, ha - 0.09)) - 0.05)) + smoothstep(0.0011, 0.0, abs(length(vec2(hc + 0.01, ha - 0.11)) - 0.07)) * 0.8; zH -= pl * palmM * 0.0004; zAlb *= 1.0 - pl * palmM * 0.2;
      float back = dors * step(-0.02, ha) * step(ha, 0.095) * smoothstep(0.045, 0.03, abs(hc));
      float tv = ridge(vec3(hc * 60.0, ha * 4.0, hb * 60.0) + N4.rgb * 0.8 + vec3(2.0)); float tvein = smoothstep(0.94, 0.985, tv) * back * hz; zAlb = mix(zAlb, zAlb * vec3(0.5, 0.58, 0.68), tvein * 0.75); zH += tvein * 0.00012;
      zAlb = mix(zAlb, zAlb * vec3(0.86, 0.78, 0.76), smoothstep(0.03, 0.0, hb) * back * 0.4);
    }
#endif
  }
  // ---- feet: pale soles; forefoot toe separation + painted toenails (the cage foot fuses the toes)
  if (P.y < 0.12) { zAlb = mix(zAlb, zAlb * vec3(1.12, 1.0, 0.9), smoothstep(0.03, 0.005, P.y) * smoothstep(0.3, 0.9, -Nr.y) * 0.5); }
  if (P.y < 0.07 && P.z < -0.115 && Nr.y > -0.3) {
    float fxc = abs(P.x) - 0.104; float tk = (fxc + 0.033) / 0.0165; float tf = abs(fract(tk + 0.5) - 0.5); float tz = smoothstep(-0.12, -0.15, P.z) * step(-0.045, fxc) * step(fxc, 0.045);
    float gro = smoothstep(0.36, 0.5, tf) * tz * smoothstep(0.0, 0.02, Nr.y + 0.3); zAlb *= 1.0 - gro * 0.4; zH -= gro * 0.0007; zAO *= 1.0 - gro * 0.25;
    float tid = floor(tk + 0.5); float xk = tid * 0.0165 - 0.033; float ex2 = (fxc - xk) / 0.0068, ez2 = (P.z + 0.176) / 0.0085; float nl = smoothstep(1.0, 0.8, length(vec2(ex2, ez2))) * step(0.25, Nr.y) * step(0.0, tid) * step(tid, 4.0);
    float ridg = 0.5 + 0.5 * sin(fxc * 900.0 + tid); zAlb = mix(zAlb, mix(vec3(0.16, 0.12, 0.08), vec3(0.32, 0.27, 0.2), ridg), nl * 0.85); zH += nl * (0.0004 + ridg * 0.00015); zRough = mix(zRough, 0.3, nl);
  }
  // dirt: cavities (low AO) and lower body collect grime; sweat / grease sheen
  float gr = dirt * (0.4 * (1.0 - zAO) + 0.6 * smoothstep(0.45, 0.8, M4.b + 0.2 * N4.r));
  zAlb = mix(zAlb, vec3(0.055, 0.045, 0.035), clamp(gr, 0.0, 0.85)); zRough = mix(zRough, 0.85, gr * 0.5);
  zAlb = mix(zAlb, vec3(dot(zAlb, vec3(0.3, 0.55, 0.15))), 0.36) * vec3(0.97, 1.0, 0.985); // dead pallor: grey, slightly cool
  zRough = max(zRough, 0.42 - 0.1 * float(zCC > 0.0)); // skin never gets mirror-glossy (lips / blood / wet layers keep their own values)
  zSheen = vec3(0.06, 0.05, 0.045); zSheenR = 0.4; gSSS = 0.42;
  zEmis += zAlb * vec3(1.0, 0.55, 0.45) * 0.03; // subsurface fill: skin never goes pure black in shadow / at night
}
`;

// ------------------------------------------------------------------------------------------------------------------ id 17: eyeball patch
export const EYE_BRANCH = /* glsl */`
else if (id == 17) { // ---------------- eyeball (sclera + iris + cornea), local coordinates around the globe centre
  float sx = q.x < 0.0 ? -1.0 : 1.0; vec3 e = q - vec3(sx * ${f(EYE.x)}, ${f(EYE.y)}, ${f(EYE.z)}); vec3 ed = normalize(e);
  float gx = (vMat2.x / 255.0 - 0.5) / 6.0, gy = (vMat2.y / 255.0 - 0.5) / 6.0; vec3 gz = normalize(vec3(sx * gx, gy, -1.0));
  float c = dot(ed, gz); float pupS = param;                       // pupil size 0.35..0.65
  vec3 ua = normalize(cross(gz, vec3(0.0, 1.0, 0.0))), va = cross(ua, gz); float th = atan(dot(ed, va), dot(ed, ua)); float rho = acos(clamp(c, -1.0, 1.0)) / 0.5;   // rho 0..1 = centre .. limbus (28.6 deg)
  vec4 E4 = zn4(vec3(cos(th) * 3.2, sin(th) * 3.2, rho * 1.6 + uSeed));                 // radial fibres (1 fetch)
  float irisM = smoothstep(1.02, 0.94, rho), pupilM = smoothstep(pupS * 0.75 + 0.06, pupS * 0.75 + 0.03, rho);
  float limb = smoothstep(0.8, 1.0, rho) * irisM, colr = smoothstep(0.32, 0.4, rho) * smoothstep(0.55, 0.45, rho);
  vec3 ic = vZCol * (0.55 + 0.9 * E4.r) * (1.0 - 0.6 * limb) * (1.0 + 0.5 * colr); ic = mix(ic, ic * 0.5 + vec3(0.02), smoothstep(0.35, 0.0, rho) * 0.5);
  float cat = uStyle.x; ic = mix(ic, vec3(0.42, 0.46, 0.5) * (0.8 + 0.4 * E4.g), cat * 0.8 * smoothstep(1.0, 0.25, rho));
  vec3 scl = vec3(0.50, 0.44, 0.34) * (0.85 + 0.25 * E4.b); float lat = smoothstep(0.004, 0.011, abs(e.x));
  vec4 V4 = zn4(vec3(e.x * 240.0 + th, e.y * 240.0, e.z * 240.0)); float rv = smoothstep(0.6, 0.85, ridge(vec3(cos(th) * 5.0 + 1.0, sin(th) * 5.0, rho * 6.0 + 4.0) + V4.rgb)) * (1.0 - irisM);
  scl = mix(scl, vec3(0.34, 0.09, 0.075), clamp(rv * 0.55 + lat * 0.1 * smoothstep(0.6, 1.4, rho), 0.0, 0.6));
  vec3 col = mix(scl, ic, irisM); col = mix(col, mix(vec3(0.015), vec3(0.34, 0.36, 0.38), cat * 0.6), pupilM);
  zAlb = col; zRough = mix(0.32, 0.035, smoothstep(0.0, 1.05, rho * -1.0 + 1.05)); zCC = 1.0; zCCR = 0.03; zMetal = 0.0;
  float lidS = smoothstep(0.004, -0.001, e.y - 0.0035) * 0.0 + smoothstep(0.0, 0.0055, e.y);   // upper lid shadow across the globe
  zAO = mix(0.35, 1.0, 1.0 - lidS * 0.7); zAO *= 1.0 - smoothstep(0.0075, 0.0125, abs(e.y)) * 0.4 * 0.0;
  zEmis += uGlow.rgb * uGlow.w * (irisM * 1.0 + pupilM * 0.6 + 0.08 + 0.45 * uStyle.w);
  isSkin = false; porous = false;
}
`;

// ------------------------------------------------------------------------------------------------------------------ teeth / mouth / flesh / bone / nails / hair
export const OTHER_BRANCHES = /* glsl */`
else if (id == 6) { // hair strands / cards (KK highlight in the light loop; tangent is carried in the normal attribute)
  float hairShade = 1.0;
#ifndef ZFAR
  if (vMat2.w > 128.0) { // card: cut 5-6 tapering sub-strands out of the ribbon (mat2.x = across, .y = along, .z = card id); TAA resolves the cut-out edges
    float cu = vMat2.x / 127.5 - 1.0, cv = vMat2.y / 255.0; float cell = cu * 3.0 + 3.0; float fi = floor(cell), ff = fract(cell) - 0.5;
    float h1 = zh1(vec3(fi, vMat2.z, uSeed)), h2 = zh1(vec3(fi * 3.1 + 1.0, vMat2.z + 7.0, 1.7));
    float wd = mix(0.42, 0.07, pow(cv, 0.75)) * (0.65 + 0.55 * h1); float ctr = (h2 - 0.5) * 0.4 * (1.0 - cv * 0.6);
    float al = 1.0 - smoothstep(wd * 0.75, wd, abs(ff - ctr)); al *= step(0.08, h1);
    al = mix(al, 1.0, clamp(fp / 0.0011, 0.0, 1.0)); // beyond ~1 mm per pixel the card is solid: no dithered stipple at gameplay distances
    if (al < 0.5) discard;
    hairShade = 0.62 + 0.55 * smoothstep(0.55, 0.0, abs(ff - ctr)) * (0.7 + 0.5 * h1);
  }
#endif
  vec4 H4 = zn4(S * 40.0); float strand = 0.68 + 0.6 * H4.r; zAlb *= strand * (0.9 + 0.2 * H4.g) * hairShade;
  zRough = 0.5 + 0.2 * H4.b; zCC = 0.0; gHair = 1.0; gHairCol = mix(zAlb, vec3(1.0), 0.15); faceHair = true; zSheen = vec3(0.0); zSheenR = 0.5; zAO *= 0.55 + 0.45 * (vMat2.y / 255.0);
}
else if (id == 7) { // teeth: enamel over dentine, vertical craze lines, cervical staining, plaque in the gum-line crevice, caries
  vec4 T4 = zn4(S * vec3(90.0, 14.0, 90.0)); float craze = smoothstep(0.75, 0.9, T4.r) * 0.5;
  zAlb *= 0.9 + 0.16 * T4.g; zAlb = mix(zAlb, zAlb * vec3(0.7, 0.62, 0.5), craze * 0.6);
  float plaque = (1.0 - zAO) * 1.6 + smoothstep(0.55, 0.8, T4.b) * 0.5; zAlb = mix(zAlb, vec3(0.22, 0.17, 0.07), clamp(plaque * 0.7, 0.0, 0.85)); zAlb *= 0.8 + 0.3 * T4.g;
  zRough = 0.28 + 0.15 * T4.b; zCC = 0.4; zCCR = 0.16; zSheen = vec3(0.04, 0.04, 0.05); gSSS = 0.35;
}
else if (id == 8) { // mouth interior: gum, palate, tongue (papillae + coating), wet mucosa
  vec4 G4 = zn4(S * 55.0); float tongue = step(0.8, psc);
  float pap = smoothstep(0.55, 0.8, zn4(S * 330.0).r) * tongue * aaFade(0.0025, fp);
  zAlb *= 0.75 + 0.4 * G4.r; zAlb = mix(zAlb, zAlb * vec3(1.15, 1.05, 1.0) + 0.05, tongue * smoothstep(0.35, 0.7, G4.g) * 0.5); zH += pap * 0.0004 - tongue * smoothstep(0.0, 0.004, abs(q.x)) * 0.0;
  zCC = 0.55; zCCR = 0.16; zRough = 0.36; zSheen = vec3(0.05, 0.008, 0.008); gSSS = 0.45;
}
else if (id == 9) { // exposed flesh: fat / muscle fibres / tendon by vertex colour, wet
  vec4 F4 = zn4(S * vec3(180.0, 22.0, 180.0)); vec4 F5 = zn4(S * 45.0);
  float fib = F4.r; zAlb *= 0.72 + 0.5 * fib; zH += (fib - 0.5) * 0.0006 * aaFade(0.004, fp) + (F5.g - 0.5) * 0.0015;
  float dark = smoothstep(0.55, 0.8, F5.b) * 0.45; zAlb = mix(zAlb, zAlb * vec3(0.4, 0.15, 0.18), dark);
  zCC = 0.7; zCCR = 0.14; zRough = 0.3 + 0.12 * F5.a; zSheen = vec3(0.1, 0.012, 0.012); gSSS = 0.5; porous = true;
}
else if (id == 10) { // bone: ivory, porous, cracked, dried marrow
  vec4 B4 = zn4(S * 150.0); vec4 B5 = zn4(S * 25.0); zAlb *= 0.8 + 0.3 * B4.r; zH += (B4.g - 0.5) * 0.0004 + (B5.b - 0.5) * 0.0012;
  float crk = smoothstep(0.9, 0.97, ridge(S * 60.0 + B5.rgb)) ; zAlb = mix(zAlb, zAlb * 0.4, crk * 0.7); zRough = 0.55 + 0.2 * B4.b; zAlb = mix(zAlb, zAlb * vec3(0.95, 0.85, 0.7), smoothstep(0.5, 0.8, B5.a) * 0.6);
}
else if (id == 16) { // nails: keratin plate with ridges, lunula, dirt under the free edge, translucency
  float ntip = param; // 0 at the cuticle .. 1 at the free edge (vertex data)
  vec4 K4 = zn4(S * vec3(700.0, 60.0, 700.0)); float ridges = K4.r;
  zAlb *= 0.8 + 0.35 * ridges; zH += (ridges - 0.5) * 0.00012;
  float lun = smoothstep(0.34, 0.24, ntip) * smoothstep(0.0, 0.08, ntip); zAlb = mix(zAlb, vec3(0.5, 0.46, 0.4), lun * 0.6);
  float free = smoothstep(0.86, 0.95, ntip); zAlb = mix(zAlb, vec3(0.16, 0.12, 0.08), free * (0.35 + dirt * 0.5));
  zRough = 0.3 + 0.1 * K4.g; zCC = 0.25; zCCR = 0.2; gSSS = 0.3;
}
`;

/** patch of the physical light function: skin wrap (cheap SSS) + Kajiya-Kay hair highlight; applied in shading.js */
export function patchLightChunk(src) {
  return src.replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
    `vec3 diffIrr = irradiance;
	if (gSSS > 0.0) { float nlw = dot( geometryNormal, directLight.direction ); vec3 wr = gSSS * vec3( 1.0, 0.6, 0.48 ); diffIrr = directLight.color * clamp( ( vec3( nlw ) + wr ) / ( 1.0 + wr ), 0.0, 1.0 ); }
	if (gHair > 0.0) { vec3 Hh = normalize( directLight.direction + geometryViewDir ); vec3 T1 = normalize( gHairT + geometryNormal * 0.10 ), T2 = normalize( gHairT - geometryNormal * 0.24 );
		float s1 = pow( sqrt( clamp( 1.0 - pow2( dot( T1, Hh ) ), 0.0, 1.0 ) ), 80.0 ), s2 = pow( sqrt( clamp( 1.0 - pow2( dot( T2, Hh ) ), 0.0, 1.0 ) ), 22.0 );
		float vis = clamp( dot( geometryNormal, directLight.direction ) * 1.6 + 0.35, 0.0, 1.0 );
		reflectedLight.directSpecular += directLight.color * vis * min( s1 * 0.035 + s2 * gHairCol * 0.04, vec3( 0.12 ) ); diffIrr = directLight.color * clamp( dot( geometryNormal, directLight.direction ) * 0.6 + 0.4, 0.0, 1.0 ); }
	reflectedLight.directDiffuse += diffIrr * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`);
}
void HC; void EAR;
