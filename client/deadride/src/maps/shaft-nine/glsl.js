// Custom procedural PBR patterns for Shaft Nine, written against the synth's uber shader (src/core/synthGLSL.js): one shared p_custom(uv)
// that switches on uP0.x (pattern id). All patterns are tileable (periodic noise with integer periods), height is physical (bump mm over `tile` m).
//   1 TIMBER   rough-sawn mine timber: grain, saw marks, checks, knots, tide marks, white mine fungus.   p: [1, tone, bleach, fungus | wet, orient, cracks, boards]
//   2 STRATA   coal-measure rock: shale/sandstone beds, blocky jointing, coal smears, pits, damp.          p: [2, blocks, coal, damp | dust, beds, cracks, tint]
//   3 SHUTTER  board-marked concrete: shuttering boards with grain imprint, tie holes, cracks, efflorescence, rust tears.  p: [3, boards, tie, wear | stain, rust, wet, 0]
//   4 COAL     faceted coal: conchoidal facets with glint, dust.                                            p: [4, facets, sheen, dust]
//   5 CINDER   yard ground: aggregate, clinkers, compaction, oil, weeds.                                    p: [5, grit, oil, weeds | ruts, puddle]
//   6 BASALT   volcanic rock: vesicles, columnar jointing, glassy skin, oxidised streaks.                   p: [6, columns, vesic, glass | oxid, ash]
//   7 CALCITE  cave rock: flowstone ripples, crystal crust, vugs, mineral veins.                            p: [7, flow, crust, veins | tint, damp]
export const SHAFT_GLSL = /* glsl */`
float sat1(float x){ return clamp(x, 0., 1.); }
// periodic gradient noise (Perlin): round blobs without the grid-aligned blockiness of the synth's value noise (which reads as digital camouflage when thresholded)
vec2 grad2(vec2 c){ float a = h21(c + 17.3) * 6.2831853; return vec2(cos(a), sin(a)); }
float gnoise(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  float a = dot(grad2(mod(i, per)), f), b = dot(grad2(mod(i + vec2(1., 0.), per)), f - vec2(1., 0.)), c = dot(grad2(mod(i + vec2(0., 1.), per)), f - vec2(0., 1.)), d = dot(grad2(mod(i + vec2(1., 1.), per)), f - vec2(1., 1.));
  return clamp(.5 + .95 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0., 1.);
}
float fbmG(vec2 uv, float sc, int oct){ vec2 p = uv * sc, per = vec2(sc); float a = .5, s = 0., n = 0.; for (int i = 0; i < 5; i++) { if (i >= oct) break; s += a * gnoise(p, per); n += a; p = p * 2. + 5.7; per *= 2.; a *= .5; } return s / n; }
// worley with the vector to the nearest feature point (F1, F2, id) — lets facets have their own orientation
vec4 wv(vec2 p, vec2 per, out vec2 rn){
  vec2 i = floor(p), f = fract(p); float f1 = 8., f2 = 8., id = 0.; rn = vec2(0.);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 cell = mod(i + g, per); vec2 o = h22(cell + 5.31); vec2 r = g + o - f; float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = h21(cell + 3.7); rn = r; } else if (d < f2) f2 = d;
  }
  return vec4(sqrt(f1), sqrt(f2), id, 0.);
}

// ---------------------------------------------------------------- 1 TIMBER
S tim(vec2 uv){
  S s = mk(); float tone = uP0.y, bleach = uP0.z, fung = uP0.w, wet = uP1.x, ori = uP1.y, crk = uP1.z; float rows = max(floor(uP1.w + .5), 1.);
  vec2 q = ori > .5 ? uv.yx : uv; float yy = q.y * rows, row = floor(yy), fy = fract(yy); float rid = h21(vec2(row, 3.7)), rid2 = h21(vec2(row, 9.1));
  float sh = rid * 7.3;
  float w1 = fbm2(vec2(q.x * 2. + sh, yy * 3.), vec2(2., rows * 3.), 3);
  float g1 = fbm2(vec2(q.x * 3. + sh, yy * 44. + w1 * 2.6), vec2(3., rows * 44.), 4);
  float g2 = vnoise(vec2(q.x * 8. + sh, yy * 150.), vec2(8., rows * 150.));
  float g3 = vnoise(vec2(q.x * 20. + sh, yy * 320.), vec2(20., rows * 320.));
  float rings = .5 + .5 * sin((yy * 11. + w1 * 2.2 + g1 * .8) * 6.2831853);
  float lat = smoothstep(.35, .8, rings);
  float bt = mix(.7, 1.15, rid);
  vec3 col = mix(uC0, uC1, sat1(.2 + .55 * g1 + .4 * lat * (1. - tone) + .2 * g2)) * bt;
  col *= .8 + .32 * g2 + .16 * g3;
  float bl = smoothstep(.45, .85, fbmG(uv, 5., 4) + .25 * rid2) * bleach;
  col = mix(col, vec3(dot(col, vec3(.33))) * vec3(1.05, 1.02, .95) + .04, bl * .7);
  float cn = vnoise(vec2(q.x * 4. + sh, yy * 72.), vec2(4., rows * 72.)); float cm = smoothstep(.4, .75, fbm2(vec2(q.x * 3. + sh, yy * 4.), vec2(3., rows * 4.), 2));
  float chk = smoothstep(.86, .955, cn) * cm * crk;
  float saw = sin((q.x * 16. + w1 * 1.2 + rid * .5) * 6.2831853) * .5 + .5;
  vec2 rk; vec4 wk = wv(vec2(q.x * 2. + rid * .3, yy), vec2(2., rows), rk); float kn = smoothstep(.2, .03, wk.x) * step(.74, h21(vec2(wk.z * 91., 3.)));
  col = mix(col, uC0 * .3, kn * .8 + chk * .85);
  float edge = min(fy, 1. - fy); float gap = rows > 1.5 ? 1. - smoothstep(0., .014, edge) : 0.; float lip = rows > 1.5 ? smoothstep(0., .06, edge) : 1.;
  col = mix(col, uC0 * .25, gap * .9);
  float wm = smoothstep(.4, .75, fbmG(uv + vec2(rid, 0.), 3., 4)) * wet; col *= 1. - wm * .4;
  float fm = smoothstep(.7, .84, fbmG(uv + 3.3, 13., 5) * .8 + .2 * fbmG(uv, 3., 3)) * fung;
  float fibre = vnoise(uv * 180., vec2(180.));
  col = mix(col, vec3(.5, .48, .42) * (.7 + .5 * fibre), fm * .65);
  s.a = col;
  s.h = .5 + .3 * g1 + .16 * lat - .16 * g2 - .05 * g3 + .06 * (1. - saw) - chk * .6 - kn * .16 - gap * .7 + fm * .16 + .12 * lip;
  s.r = mix(uRough.x, uRough.y, sat1(.55 + .5 * g2 - wm * .55)); s.r = mix(s.r, .96, fm); s.m = 0.;
  s.ao = sat1(1. - chk * .7 - gap * .6 - kn * .25);
  return s;
}

// ---------------------------------------------------------------- 2 STRATA rock (stacked blocks by bed)
S strata(vec2 uv){
  S s = mk(); float nb = max(uP0.y, 2.), coal = uP0.z, damp = uP0.w, dust = uP1.x, beds = max(floor(uP1.y + .5), 3.), crk = uP1.z, tint = uP1.w;
  float wob = fbm2(vec2(uv.x * 3., uv.y * 2.), vec2(3., 2.), 4) - .5;
  float bp = uv.y * beds + wob * .55 + .1 * sin(6.2831853 * 2. * uv.y + 1.) + .06 * sin(6.2831853 * 5. * uv.y + 2.);   // uneven bed thickness (monotonic warp)
  float bi = floor(bp); float bim = mod(bi, beds); float bf = fract(bp);
  float br = h21(vec2(bim, 5.3)), br2 = h21(vec2(bim, 11.9)), br3 = h21(vec2(bim, 2.7));
  float nx = 2. + floor(br2 * nb);                                      // blocks per tile length in this bed (integer => tiles)
  float jag = fbm2(vec2(uv.x * 6., uv.y * 24.), vec2(6., 24.), 3) - .5;
  float bx = uv.x * nx + br * 5. + jag * .35; float bxi = floor(bx), bxf = fract(bx);
  float cellId = h21(vec2(mod(bxi, nx), bim + 30.));
  float jw = .012 * nx / uTileM;
  float vj = 1. - smoothstep(0., jw, min(bxf, 1. - bxf)); vj *= step(.5, h21(vec2(mod(bxi, nx), bim + 7.))) * step(.4, br2);
  float bw2 = .010 * beds / uTileM; float hj = (1. - smoothstep(0., bw2, min(bf, 1. - bf))); hj *= step(.25, br3);
  vec2 cr0; vec4 cw = wv(uv * 4. + wob * .3, vec2(4.), cr0); float ck = (1. - smoothstep(0., .02, cw.y - cw.x)) * crk * step(.6, h21(vec2(cw.z * 7., 3.)));
  float hard = h21(vec2(bim, 8.8));
  vec3 shale = mix(uC0, uC1, sat1(br * 1.4)), sand = mix(uC1, uC3, sat1(br2)); vec3 col = mix(shale, sand, step(.55, hard) * .65);
  bool isCoal = coal > 0. && br3 > .9 - coal * .12 && br > .5;
  if (isCoal) col = uC0 * .28;
  float nn = fbmG(uv, 12., 4); col *= .84 + .26 * nn + .14 * (cellId - .5);
  col = mix(col, col * vec3(1.07, .96, .86), tint);
  vec2 pr; vec4 pw = wv(uv * 44., vec2(44.), pr); float psz = h21(vec2(pw.z * 71., 2.)); float pit = (1. - smoothstep(.0, .1 + .25 * psz, pw.x)) * step(.9, psz) * .8;
  col *= 1. - pit * .5;
  float relief = fbmG(uv, 9., 5), fine = fbmG(uv, 70., 3);
  float bedH = (isCoal ? .12 : hard * .25) + (cellId - .5) * .22;
  s.h = .45 + bedH + relief * .3 + fine * .22 - (vj + ck) * .5 - hj * .34 - pit * .25;
  float dm = smoothstep(.42, .78, fbmG(uv + 2.1, 13., 4) + (vj + hj) * .25) * damp; col *= 1. - .3 * dm;
  float dst = smoothstep(.45, .8, fbmG(uv + 5.7, 21., 4)) * dust; col = mix(col, vec3(.26, .24, .21), dst * .35);
  s.a = col * (1. - (vj + ck) * .08 - hj * .05);
  s.r = mix(uRough.x, uRough.y, sat1(.55 + .5 * fine - dm * .75)); if (isCoal) s.r = .3; s.m = 0.;
  s.ao = sat1(1. - (vj + ck) * .75 - hj * .45 - pit * .5);
  s.e = vec3(0.);
  return s;
}

// ---------------------------------------------------------------- 3 SHUTTER concrete
S shutter(vec2 uv){
  S s = mk(); float nb = max(floor(uP0.y + .5), 4.), tie = uP0.z, wear = uP0.w, stain = uP1.x, rust = uP1.y, wet = uP1.z;
  float yy = uv.y * nb, row = floor(yy), fy = fract(yy); float rid = h21(vec2(mod(row, nb), 4.4)); float sh = rid * 9.;
  float gr = fbm2(vec2(uv.x * 3. + sh, yy * 26.), vec2(3., nb * 26.), 4); float gr2 = vnoise(vec2(uv.x * 6. + sh, yy * 90.), vec2(6., nb * 90.));
  float tone = mix(.8, 1.1, rid) * (.9 + .2 * fbmG(uv, 5., 4));
  float edge = min(fy, 1. - fy); float seam = 1. - smoothstep(0., .03, edge); float lip = 1. - smoothstep(0., .1, edge);
  float bxx = fract(uv.x * 2. + rid * .5); float bjoint = (1. - smoothstep(0., .008, min(bxx, 1. - bxx))) * step(.5, h21(vec2(mod(row, nb), 2.2)));
  vec3 col = mix(uC0, uC1, sat1(.5 + .5 * fbmG(uv, 7., 4))) * tone * (.9 + .16 * gr);
  vec2 tc = vec2(uv.x * 4., uv.y * nb / 3.); vec2 tf = fract(tc) - .5; float hd = length(vec2(tf.x * uTileM / 4., tf.y * uTileM * 3. / nb)); float hole = (1. - smoothstep(.016, .026, hd)) * tie; float cone = (1. - smoothstep(.03, .05, hd)) * tie;
  vec2 bwr; vec4 bw = wv(uv * 70., vec2(70.), bwr); float blow = (1. - smoothstep(.0, .12, bw.x)) * step(.86, h21(vec2(bw.z * 53., 6.)));
  col *= 1. - blow * .55 - hole * .6 - cone * .25 - seam * .35;
  float drip = vnoise(vec2(uv.x * 40., uv.y * 2.), vec2(40., 2.)); float tear = smoothstep(.62, .95, drip) * smoothstep(.4, .8, fbmG(uv, 3., 3)) * stain; col = mix(col, col * .55, tear * .7);
  float ef = smoothstep(.64, .9, fbmG(uv + 5.5, 6., 5)) * stain * .8; col = mix(col, vec3(.7, .7, .64), ef * .45);
  float rt = (1. - smoothstep(.01, .035, abs(tf.x * uTileM / 4.))) * smoothstep(-.5, 0., tf.y) * step(tf.y, 0.) * step(.5, h21(floor(tc))) * rust * tie;
  col = mix(col, vec3(.3, .13, .06) * (.6 + .6 * drip), rt * .7);
  float sp = smoothstep(.76, .86, fbmG(uv + 1.7, 5., 5)) * wear; col = mix(col, uC2 * .8, sp * .8);
  vec2 cr2; vec4 cr = wv(uv * 3. + fbmG(uv, 4., 3) * .5, vec2(3.), cr2); float crack = (1. - smoothstep(0., .012, cr.y - cr.x)) * wear * step(.55, h21(vec2(cr.z * 9., 1.))); col *= 1. - crack * .75;
  float wm = smoothstep(.4, .8, fbmG(uv + 7.7, 3., 4)) * wet; col *= 1. - wm * .32;
  s.a = col;
  s.h = .5 + .14 * gr - .06 * gr2 - lip * .3 - seam * .35 - bjoint * .25 - blow * .3 - hole * .6 - cone * .12 - crack * .5 - sp * .3 + ef * .06 + (fbmG(uv, 40., 3) - .5) * .12;
  s.r = mix(uRough.x, uRough.y, sat1(.6 + .5 * gr2 - wm * .8)); s.m = 0.; s.ao = sat1(1. - seam * .5 - hole * .7 - crack * .5 - blow * .3);
  return s;
}

// ---------------------------------------------------------------- 4 COAL facets
S coalp(vec2 uv){
  // multi-scale broken coal: big chunks (fc/2.4), small chunks (fc*1.5) and dust between them; rounded facet tops, soft joints, matte black with the odd bright fracture face
  S s = mk(); float fc = max(uP0.y, 3.), sheen = uP0.z, dust = uP0.w;
  float fa = floor(fc / 2.4 + .5), fb = floor(fc * 1.5 + .5);
  vec2 wa = (vec2(fbmG(uv, 4., 3), fbmG(uv + 7., 4., 3)) - .5) * .35;
  vec2 r1, r2; vec4 A = wv(uv * fa + wa, vec2(fa), r1), Bc = wv(uv * fb + wa * 1.7 + 3.1, vec2(fb), r2);
  float mixm = smoothstep(.42, .62, fbmG(uv + 2.3, 5., 3));                     // where the small chunks take over
  vec4 w = mix(A, Bc, mixm); vec2 rr = mix(r1, r2, mixm);
  float id = w.z; vec2 tv = (vec2(h21(vec2(id * 77., 1.)), h21(vec2(id * 41., 2.))) - .5) * 2.;
  float edge = w.y - w.x; float fs = smoothstep(0., .07, edge), dome = clamp(1. - w.x * 1.55, 0., 1.);
  s.h = .5 + dot(-rr, tv) * .38 + dome * .32 + fs * .12 - (1. - fs) * .2 + (fbmG(uv, 34., 3) - .5) * .12;
  vec3 col = mix(uC0, uC1, sat1(h21(vec2(id * 13., 4.)) * .8 + .2 * fbmG(uv, 12., 3)));
  float glint = step(.86, h21(vec2(id * 29., 8.))) * sheen; col = mix(col, uC3, glint * .22);
  col *= .8 + .4 * fbmG(uv, 40., 3); float dst = smoothstep(.45, .8, fbmG(uv + 4., 6., 4)) * dust; col = mix(col, vec3(.12, .118, .115), dst * .6);
  s.a = col * (.82 + .18 * fs) * (.75 + .25 * dome); s.r = mix(uRough.x, uRough.y, sat1(.55 + .5 * fbmG(uv, 20., 3) + dst * .5)); s.r = mix(s.r, .16, glint * .8); s.m = 0.; s.ao = mix(.5, 1., fs) * (.7 + .3 * dome);
  return s;
}

// ---------------------------------------------------------------- 5 CINDER / gravel ground
S cinder(vec2 uv){
  S s = mk(); float grit = max(floor(uP0.y + .5), 12.), oil = uP0.z, weeds = uP0.w, ruts = uP1.x, pud = uP1.y;
  float n0 = fbmG(uv, 12., 5), n1 = fbmG(uv, 22., 4), n2 = vnoise(uv * 200., vec2(200.));
  vec2 r1; vec4 w = wv(uv * grit, vec2(grit), r1); float rnd = h21(vec2(w.z * 17., 7.)); float dome = clamp(1. - w.x * 1.7, 0., 1.);
  vec2 r2; vec4 w2 = wv(uv * grit * 3., vec2(grit * 3.), r2); float rnd2 = h21(vec2(w2.z * 23., 9.)); float dome2 = clamp(1. - w2.x * 2.0, 0., 1.);
  vec3 col = mix(uC0, uC1, sat1(n0 * 1.2 - .1)); col = mix(col, uC2, smoothstep(.5, .9, n1) * .55);
  col = mix(col, mix(uC1, uC3, rnd), dome * .55 * step(.3, rnd)); col = mix(col, mix(uC0, uC3, rnd2), dome2 * .4);
  vec2 rc; vec4 cl = wv(uv * 14., vec2(14.), rc); float clink = (1. - smoothstep(.0, .3, cl.x)) * step(.75, h21(vec2(cl.z * 33., 5.)));
  col = mix(col, uC3 * (.5 + .7 * rnd), clink * .5);
  col *= .8 + .4 * n2; float gap = 1. - smoothstep(0., .5, w.y - w.x);
  float rut = smoothstep(.42, .5, abs(fract(uv.x * 2.) - .5)) * ruts * smoothstep(.3, .7, n0); col *= 1. - rut * .25;
  float os = smoothstep(.6, .78, fbmG(uv + 8.1, 11., 4)) * oil; col = mix(col, col * .45, os * .75);
  float pu = smoothstep(.6, .74, fbmG(uv + 2.4, 9., 4)) * pud; col *= 1. - pu * .45;
  float wd = step(.94, h21(floor(uv * 60.) + 3.)) * smoothstep(.55, .75, fbmG(uv + 6.6, 17., 4)) * weeds; col = mix(col, uCMoss * (.5 + .8 * n2), wd * .8);
  s.a = col * (.75 + .25 * (1. - gap)); s.h = .4 + n0 * .12 + dome * .34 + dome2 * .22 + clink * .12 - rut * .25 - pu * .2 + n2 * .05;
  s.r = mix(uRough.x, uRough.y, sat1(.6 + .4 * n1)); s.r = mix(s.r, .14, os * .8 + pu * .9); s.m = 0.; s.ao = mix(.5, 1., sat1(dome + dome2 * .5));
  return s;
}

// ---------------------------------------------------------------- 6 BASALT
S basalt(vec2 uv){
  S s = mk(); float cols = max(floor(uP0.y + .5), 2.), vs = uP0.z, glass = uP0.w, ox = uP1.x, ash = uP1.y;
  float rows = max(floor(cols * .34 + .5), 2.);                                           // irregular polygonal columns (wider than tall), not stripes
  vec2 hr; vec4 hw = wv(vec2(uv.x * cols, uv.y * rows), vec2(cols, rows), hr); float ce = hw.y - hw.x; float cj = 1. - smoothstep(0., .06, ce);
  float ch = h21(vec2(hw.z * 51., 3.));
  float n0 = fbmG(uv, 14., 5), n1 = fbmG(uv, 36., 4);
  vec3 col = mix(uC0, uC1, sat1(.22 + .55 * n0)); col = mix(col, uC2, smoothstep(.5, .85, n1) * .5) * (.82 + .36 * (ch - .5));
  vec2 vr; vec4 vw = wv(uv * 40., vec2(40.), vr); float vsz = h21(vec2(vw.z * 63., 2.)); float ves = (1. - smoothstep(.0, .12 + .2 * vsz, vw.x)) * step(1. - vs, vsz) * smoothstep(.3, .6, n0);
  col *= 1. - ves * .7;
  float st = vnoise(vec2(uv.x * 120., uv.y * 6.), vec2(120., 6.)); col *= .9 + .2 * st;
  float ax = smoothstep(.5, .85, fbmG(uv + 4.3, 17., 4)) * ox; col = mix(col, vec3(.3, .11, .05) * (.5 + n1), ax * .4);
  float gl = smoothstep(.62, .85, fbmG(uv + 9., 23., 4)) * glass; col = mix(col, vec3(.02), gl * .55);
  float as = smoothstep(.45, .85, fbmG(uv + 1.3, 27., 4)) * ash; col = mix(col, vec3(.2, .19, .19), as * .45);
  s.a = col; s.h = .5 + n0 * .24 + n1 * .16 + (ch - .5) * .3 - cj * .5 - ves * .4;
  s.r = mix(uRough.x, uRough.y, sat1(.6 + .5 * n1 - gl * 1.2)); s.m = 0.; s.ao = sat1(1. - cj * .7 - ves * .6);
  return s;
}

// ---------------------------------------------------------------- 7 CALCITE cave rock
S calcite(vec2 uv){
  S s = mk(); float fl = max(floor(uP0.y + .5), 2.), cr = uP0.z, vn = uP0.w, tint = uP1.x, damp = uP1.y;
  float wob = fbm2(vec2(uv.x * 3., uv.y * 2.), vec2(3., 2.), 4) - .5;
  float ripple = .5 + .5 * sin((uv.y * fl + wob * 3. + fbmG(uv, 6., 3) * 1.6) * 6.2831853);
  float n0 = fbmG(uv, 13., 5), n1 = fbmG(uv, 26., 4);
  vec3 col = mix(uC0, uC1, sat1(.2 + .5 * n0 + ripple * .22)); col = mix(col, uC2, smoothstep(.55, .9, n1) * .45); col *= .82 + .32 * n1;
  vec2 c1; vec4 cw = wv(uv * 38. + wob, vec2(38.), c1); float crust = (1. - smoothstep(.0, .3, cw.x)) * cr; col = mix(col, uC3 * (.6 + .5 * h21(vec2(cw.z * 19., 4.))), crust * .35);
  vec2 v1; vec4 vw = wv(uv * 7. + n0 * .3, vec2(7.), v1); float vein = (1. - smoothstep(0., .03, vw.y - vw.x)) * vn * step(.55, h21(vec2(vw.z * 11., 3.))); col = mix(col, uC3, vein * .35);
  vec2 p1; vec4 pw = wv(uv * 26., vec2(26.), p1); float vug = (1. - smoothstep(.0, .18, pw.x)) * step(.84, h21(vec2(pw.z * 37., 1.))); col *= 1. - vug * .5;
  float dm = smoothstep(.42, .8, fbmG(uv + 3.3, 14., 4)) * damp; col *= 1. - dm * .22;
  s.a = col; s.h = .5 + n0 * .26 + ripple * .2 + n1 * .14 - vein * .12 - vug * .3 + crust * .1;
  s.r = mix(uRough.x, uRough.y, sat1(.55 + .5 * n1 - dm * .8 - ripple * .2)); s.m = 0.; s.ao = sat1(1. - vug * .5 - (1. - n0) * .08);
  return s;
}

S p_custom(vec2 uv){
  int k = int(uP0.x + .5);
  if (k == 1) return tim(uv); if (k == 2) return strata(uv); if (k == 3) return shutter(uv); if (k == 4) return coalp(uv);
  if (k == 5) return cinder(uv); if (k == 6) return basalt(uv); if (k == 7) return calcite(uv);
  return mk();
}
`;

export const TIMBER = 1, STRATA = 2, SHUTTER = 3, COAL = 4, CINDER = 5, BASALT = 6, CALCITE = 7;
/** material def for the synth: id + parameter list p (see header) + colours etc. */
export const custom = (id, p, o = {}) => ({ glsl: SHAFT_GLSL, size: 512, tile: 1.5, bump: 8, ...o, p: [id, ...p] });
