// Gun material library: GPU-baked tileable PBR sets (core Synth) with ONE custom pattern program that has a mode per finish
// (parkerized, blued, enamel, walnut, checkering, laminate, bakelite, stipple, case-hardened + scroll engraving, polished metal),
// plus an edge-wear patch: the kit's `aWear` vertex attribute (chamfers) x object-space noise => finish worn to bare metal / raw wood.
// Noise uses the REST-POSE object position (skinned `position` attribute) so wear never swims while the gun moves.
import * as THREE from 'three';
import { Synth } from '../../core/synth.js';
import { std, G as CORE_G } from '../../core/mats.js';
import { canvasTexture } from '../../core/canvas2d.js';
import { HS_DEFS } from './hs-mats.js'; // finishes for the hard-surface rebuild (M14 / M1911 / 870)

// ------------------------------------------------------------------ custom synth pattern (uP1.w = mode)
const GUN_GLSL = /* glsl */`
float gRidge(float x){ return 1. - abs(fract(x) - .5) * 2.; }
S p_custom(vec2 uv){
  S s = mk(); int mode = int(uP1.w + .5);
  if (mode == 0) { // PARKERIZED: phosphate crystals are ~20 um (only a matte sheen at view distance) -> tone blotches, oil/handling sheen, fine grain in normal+roughness only
    float n = fbmU(uv, 4., 5), oil = smoothstep(.45, .82, fbmU(uv + 2.7, 3., 4)), fine = vnoise(uv * 96., vec2(96.)), fine2 = vnoise(uv * 190. + 3.1, vec2(190.));
    s.a = mix(uC0, uC1, n * uP0.y) * (.95 + .1 * fine); s.a = mix(s.a, uC2, smoothstep(.55, .85, fbmU(uv + .9, 6., 4)) * uP0.z);
    s.h = .5 + (fine - .5) * .1 + (fine2 - .5) * .06 + (n - .5) * .03;
    s.r = clamp(mix(uRough.y, uRough.x, oil) * (.92 + .16 * fine2), 0., 1.); s.m = uMetal; s.ao = 1.; return s; }
  if (mode == 1) { // BLUED steel: blue-black with polishing lines along u, mottled blue/plum hues
    float L = max(uP0.x, 64.); float st = vnoise(vec2(uv.x * 3., uv.y * L), vec2(3., L)), st2 = vnoise(vec2(uv.x * 9., uv.y * L * 2.), vec2(9., L * 2.));
    float mot = fbmU(uv, 4., 5), mot2 = fbmU(uv + .37, 3., 4);
    vec3 c = mix(uC0, uC1, smoothstep(.35, .8, mot) * uP0.y); c = mix(c, uC2, smoothstep(.6, .88, mot2) * uP0.z);
    s.a = c * (.88 + .24 * st); s.h = .5 + (st - .5) * .1 + (st2 - .5) * .05;
    s.r = mix(uRough.x, uRough.y, clamp(st * .45 + mot * .55, 0., 1.)); s.m = uMetal; return s; }
  if (mode == 2) { // ENAMEL / baked paint over steel: orange peel + slight gloss variation
    float op = fbmU(uv, max(uP0.x, 4.), 4); float fine = vnoise(uv * 160., vec2(160.)); float blot = fbmU(uv + .7, 3., 4);
    s.a = uC0 * (.92 + .16 * fine); s.a = mix(s.a, uC1, smoothstep(.55, .85, blot) * uP0.y);
    s.h = .5 + (op - .5) * .6 + (fine - .5) * .08; s.r = mix(uRough.x, uRough.y, clamp(op * .6 + blot * .4, 0., 1.)); s.m = uMetal; return s; }
  if (mode == 3) { // WALNUT (oil finish): irregular growth rings along u (stock length) with drifting spacing, cathedral figure, dark mineral streaks, open pores
    float sc = max(uP0.x, 4.);
    float warp = fbm2(vec2(uv.x * 1.5, uv.y * 2.), vec2(1.5, 2.), 4) - .5, warp2 = fbm2(vec2(uv.x * 4., uv.y * 5.) + 3.3, vec2(4., 5.), 3) - .5;
    float fig = fbm2(vec2(uv.x * 2., uv.y * 4.) + vec2(0., warp * 3.), vec2(2., 4.), 4);
    float freq = sc * (.75 + .5 * fbm2(vec2(uv.x * 1., uv.y * .5) + 7.1, vec2(1., 1.), 3));
    float t = uv.y * freq + warp * 2.4 + warp2 * .5 + fig * .7;
    float ring = fract(t); float late = smoothstep(.55, .92, ring) * (1. - smoothstep(.92, 1., ring)); // dark latewood band, sharp on one side
    float g = fbm2(vec2(uv.x * 3., uv.y * sc * 3.), vec2(3., sc * 3.), 4);
    vec3 wp = worley(vec2(uv.x * sc * 2., uv.y * sc * 14.), vec2(sc * 2., sc * 14.));
    float pore = (1. - smoothstep(.06, .30, wp.x)) * step(.35, h21(vec2(wp.z * 13., 1.)));
    float streak = smoothstep(.62, .9, fbm2(vec2(uv.x * 1.2, uv.y * 9.) + 1.7, vec2(1.2, 9.), 4)) * uP0.z; // dark mineral/figure streaks
    vec3 c = mix(uC0, uC1, clamp(late * .5 + g * .4 - .1, 0., 1.)); c = mix(c, uC3, smoothstep(.55, .95, fig) * .4);
    c = mix(c, uC2, clamp(pore * uP0.y + streak * .55, 0., 1.));
    s.a = c; s.h = .55 + late * .05 + g * .04 - pore * .35; s.r = mix(uRough.x, uRough.y, clamp(g * .5 + pore * .8 + late * .2, 0., 1.)); s.m = 0.; s.ao = 1. - pore * .25; return s; }
  if (mode == 4) { // CHECKERING (wood / polymer / steel): sharp diamonds, dirt in the grooves
    float n = max(uP0.x, 4.), k = max(uP0.z, .5);
    float A = uv.x * n * k + uv.y * n, B = uv.x * n * k - uv.y * n;
    float hA = gRidge(A), hB = gRidge(B); float hh = min(hA, hB);
    float border = 1.;
    float groove = 1. - smoothstep(0., max(uP0.y, .02), hh);
    float g = fbmU(uv, 6., 4), fine = vnoise(uv * 220., vec2(220.));
    vec3 top = mix(uC0, uC3, smoothstep(.4, .8, g) * .5) * (.9 + .2 * fine);
    s.a = mix(top, uC1, groove * .85); s.h = .15 + hh * .85;
    s.r = mix(uRough.x, uRough.y, groove * .8 + g * .2); s.m = uMetal * (1. - groove * .3); s.ao = mix(.45, 1., smoothstep(0., .35, hh)); return s; }
  if (mode == 5) { // LAMINATE (AK plywood): coloured plies with dark glue lines, cut at a shallow angle
    float w = fbm2(uv * vec2(2., 2.), vec2(2., 2.), 4) - .5; float plies = max(uP0.x, 2.);
    float t = uv.y * plies + w * uP0.y + uv.x * floor(uP0.z); float ply = fract(t), id = floor(t);
    float glue = 1. - smoothstep(0., .07, min(ply, 1. - ply));
    vec3 c = mix(uC0, uC1, h21(vec2(mod(id, plies), 7.))); float g = fbm2(vec2(uv.x * 4., uv.y * 48.), vec2(4., 48.), 3);
    float fib = vnoise(vec2(uv.x * 7. + w * 3., uv.y * 220.), vec2(7., 220.)); float pore = smoothstep(.72, .9, vnoise(vec2(uv.x * 30., uv.y * 300.), vec2(30., 300.)));
    c *= .74 + .36 * g + .14 * fib; c = mix(c, uC2, glue * .9 + pore * .35);
    s.a = c; s.h = .5 + g * .05 + fib * .03 - glue * .08 - pore * .04; s.r = mix(uRough.x, uRough.y, clamp(g * .6 + pore * .6, 0., 1.)); s.m = 0.; return s; }
  if (mode == 6) { // BAKELITE / 'plum' polymer: marbled swirls
    vec2 q = vec2(fbmU(uv, 3., 4), fbmU(uv + 5.2, 3., 4));
    float n = fbm2((uv + q * .7) * 4., vec2(4.), 5), fine = vnoise(uv * 180., vec2(180.));
    vec3 c = mix(uC0, uC1, smoothstep(.3, .7, n)); c = mix(c, uC2, smoothstep(.64, .82, n) * uP0.x);
    s.a = c * (.95 + .1 * fine); s.h = .5 + (fine - .5) * .05 + (n - .5) * .04; s.r = mix(uRough.x, uRough.y, clamp(n * .7 + fine * .3, 0., 1.)); s.m = 0.; return s; }
  if (mode == 7) { // STIPPLED / textured polymer
    float sc = max(uP0.x, 16.); vec3 w = worley(uv * sc, vec2(sc)); float bmp = 1. - smoothstep(0., .6, w.x); float n = fbmU(uv, 8., 3), fine = vnoise(uv * sc * 3., vec2(sc * 3.));
    s.a = mix(uC0, uC1, n) * (.9 + .15 * bmp); s.h = bmp * .6 + fine * .15 + n * .05; s.r = mix(uRough.x, uRough.y, clamp(1. - bmp * .6 + n * .3, 0., 1.)); s.m = uMetal; s.ao = .8 + .2 * bmp; return s; }
  if (mode == 8) { // COLOUR CASE-HARDENED steel (+ optional scroll engraving uP0.x = scroll cells per tile)
    vec2 q = vec2(fbmU(uv, 3., 4), fbmU(uv + 3.1, 3., 4));
    float n = fbm2((uv + q * .55) * 4., vec2(4.), 5), n2 = fbmU(uv + .77, 7., 4);
    float t = clamp(n * 1.45 - .2 + (n2 - .5) * .35, 0., 1.);
    vec3 grey = vec3(.42, .43, .45), straw = vec3(.58, .43, .2), amber = vec3(.42, .24, .1), purple = vec3(.26, .13, .3), blue = vec3(.1, .18, .42);
    vec3 c = t < .25 ? mix(grey, straw, t * 4.) : t < .5 ? mix(straw, amber, (t - .25) * 4.) : t < .75 ? mix(amber, purple, (t - .5) * 4.) : mix(purple, blue, (t - .75) * 4.);
    c = mix(c, grey * .8, smoothstep(.45, .8, fbmU(uv + 1.9, 6., 4)) * .55); c = mix(c, vec3(dot(c, vec3(.3, .5, .2))), .6) * .7; // subdued + partly faded to grey (metal=1: the colour tints reflections)
    float eng = 0.;
    if (uP0.x > .5) { // scrollwork: per-cell spirals with leaf strokes
      float sc = uP0.x; vec2 pp = uv * sc; vec2 ic = floor(pp), fc = fract(pp); float best = 9.; vec2 bo = vec2(0.);
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)); vec2 o = g + .25 + .5 * h22(mod(ic + g, vec2(sc))) - fc; float d = dot(o, o); if (d < best) { best = d; bo = o; } }
      float rr = length(bo), an = atan(bo.y, bo.x); float sp = fract(an / 6.2831853 + rr * 3.2 + h21(ic) * 7.);
      float line = 1. - smoothstep(.0, .09, abs(sp - .5) - .38); line *= smoothstep(.62, .5, rr) * smoothstep(.02, .08, rr);
      float leaf = (1. - smoothstep(.0, .1, abs(fract(an * 3. / 6.2831853 + rr * 5.) - .5) - .41)) * smoothstep(.55, .3, rr) * smoothstep(.25, .35, rr);
      eng = clamp(line + leaf * .7, 0., 1.);
    }
    s.a = mix(c, c * .45, eng * .8); s.h = .5 - eng * .3 + (n2 - .5) * .04; s.r = mix(uRough.x, uRough.y, n2) + eng * .25; s.m = uMetal; s.ao = 1. - eng * .4; return s; }
  if (mode == 9) { // POLISHED METAL (brass, chrome, nickel): hand-polish lines + tarnish
    float L = max(uP0.x, 32.); float lines = vnoise(vec2(uv.x * 2., uv.y * L), vec2(2., L)); float sw = fbmU(uv, 3., 4);
    float tarn = smoothstep(.5, .85, fbmU(uv + .4, 5., 5)) * uP0.y;
    s.a = mix(uC0, uC1, tarn) * (.94 + .12 * lines); s.h = .5 + (lines - .5) * .05 + (sw - .5) * .03;
    s.r = mix(uRough.x, uRough.y, clamp(tarn * .8 + lines * .25 + sw * .2, 0., 1.)); s.m = uMetal; return s; }
  if (mode == 10) { // KNURL (fine cross knurl on steel)
    float n = max(uP0.x, 8.); float A = gRidge(uv.x * n + uv.y * n), B = gRidge(uv.x * n - uv.y * n); float hh = min(A, B);
    s.a = mix(uC1, uC0, smoothstep(0., .5, hh)); s.h = hh; s.r = mix(uRough.y, uRough.x, hh); s.m = uMetal; s.ao = mix(.5, 1., hh); return s; }
  if (mode == 11) { // WOODLAND CAMO printed on twill (sleeves): 4 colour layers of large blobs + diagonal twill + fuzz
    float n1 = fbm2(uv * 3. + 1.3, vec2(3.), 5), n2 = fbm2(uv * 3. + 7.7, vec2(3.), 5), n3 = fbm2(uv * 4. + 3.1, vec2(4.), 4);
    vec3 c = uC0; c = mix(c, uC1, smoothstep(.5, .54, n1)); c = mix(c, uC2, smoothstep(.56, .6, n2)); c = mix(c, uC3, smoothstep(.62, .65, n3));
    float tw = .5 + .5 * sin((uv.x + uv.y) * uP0.x * 6.2831853); float fz = vnoise(uv * uP0.x * 2., vec2(uP0.x * 2.));
    s.a = c * (.86 + .14 * tw) * (.94 + .12 * fz); s.h = .5 + (tw - .5) * .22 + (fz - .5) * .1; s.r = mix(uRough.x, uRough.y, fz); s.m = 0.; return s; }
  if (mode == 12) { // TACTICAL GLOVE: stretch nylon (fine rib weave) with synthetic-suede patches
    float rib = .5 + .5 * sin(uv.y * uP0.x * 6.2831853 + vnoise(uv * 20., vec2(20.)) * 1.5); float fz = vnoise(uv * uP0.x * .7, vec2(uP0.x * .7)); float pchm = smoothstep(.55, .6, fbm2(uv * 2.5, vec2(2.5), 4));
    s.a = mix(uC0, uC1, pchm) * (.88 + .14 * rib) * (.94 + .1 * fz); s.h = .5 + (rib - .5) * .25 * (1. - pchm) + (fz - .5) * .12; s.r = mix(uRough.x, uRough.y, pchm * .6 + fz * .4); s.m = 0.; s.ao = .85 + .15 * rib; return s; }
  if (mode == 13) { // KNIT jersey (glove back / stretch nylon-spandex): columns of V-shaped yarn loops, ~1 mm pitch, fibre fuzz, heather, pilling
    float W = max(uP0.x, 8.); vec2 c = uv * vec2(W, W * 1.2); vec2 id = floor(c), f = fract(c); float rnd = h21(id + 3.7), rnd2 = h21(id + 9.1);
    float y = f.y; float dl = f.x - (.5 - .3 * y), dr = f.x - (.5 + .3 * y); float prof = .7 + .3 * sin(3.14159 * y);
    float hl = exp(-dl * dl / .011) * prof, hr = exp(-dr * dr / .011) * prof; float hh = max(hl, hr); float gap = 1. - smoothstep(.0, .5, hh);
    float fz = vnoise(uv * W * 14., vec2(W * 14.)), fz2 = vnoise(uv * W * 40. + 2.3, vec2(W * 40.)); float het = fbmU(uv + .3, 5., 4);
    vec3 col = mix(uC0, uC1, clamp(.3 + .5 * hh * (.75 + .5 * rnd), 0., 1.)); col = mix(col, uC2, gap * .3); col *= .88 + .24 * het + .06 * (fz - .5);
    float pill = step(.985, h21(floor(uv * W * 3.) + 5.5)) * uP0.z; col = mix(col, uC1 * 1.5, pill * .5);
    s.a = col; s.h = hh * .8 + (fz - .5) * .18 + (fz2 - .5) * .1 + pill * .1; s.r = mix(uRough.x, uRough.y, clamp(1. - hh * .45 + fz * .3, 0., 1.)); s.m = 0.; s.ao = .5 + .5 * clamp(hh + .15, 0., 1.); return s; }
  if (mode == 14) { // SYNTHETIC LEATHER palm (PU / Amara suede-touch): micro-pebble grain, suede nap, flex-crease wrinkles, mottling
    float sc = max(uP0.x, 16.); vec3 w = worley(uv * sc, vec2(sc)); float grain = smoothstep(.0, .28, w.y - w.x); vec3 w3 = worley(uv * sc * 2.1 + 4.4, vec2(sc * 2.1)); float g2 = smoothstep(.0, .3, w3.y - w3.x);
    float n = fbmU(uv, 5., 4), n2 = fbmU(uv + 2.2, 11., 3); float nap = vnoise(uv * 420., vec2(420.)); float cr = 1. - smoothstep(.0, .06, abs(fbmU(uv + 6.6, 7., 4) - .5) * 2.); cr *= uP0.y;
    vec3 col = mix(uC0, uC1, clamp(n * 1.2 - .1, 0., 1.)); col = mix(col, uC2, cr * .6 + (1. - grain) * .35); col *= .9 + .2 * n2 + .1 * (nap - .5);
    s.a = col; s.h = grain * .5 + g2 * .2 + n2 * .15 + (nap - .5) * .06 - cr * .25; s.r = mix(uRough.x, uRough.y, clamp(1. - grain * .6 + nap * .3 - n * .2, 0., 1.)); s.m = 0.; s.ao = .6 + .4 * grain; return s; }
  if (mode == 15) { // RIPSTOP cotton-nylon field cloth: plain weave (~0.45 mm threads), doubled ripstop threads every 8th, dye mottling, fuzz, fade
    float T = max(uP0.x, 16.); vec2 c = uv * T; vec2 id = floor(c), f = fract(c); float over = mod(id.x + id.y, 2.); float rip = max(step(.5, 1. - abs(fract(id.x / 8.) * 8. - .5) * 2.), step(.5, 1. - abs(fract(id.y / 8.) * 8. - .5) * 2.));
    float th = over > .5 ? sin(3.14159 * f.x) : sin(3.14159 * f.y); float rnd = h21(over > .5 ? vec2(id.x, 1.) : vec2(id.y, 2.)); float thick = 1. + .25 * rip * uP0.y;
    float mot = fbmU(uv, 7., 5), mot2 = fbmU(uv + 3.3, 19., 3); float fz = vnoise(uv * T * 6., vec2(T * 6.)); float fade = smoothstep(.55, .85, fbmU(uv + 8.1, 4., 4)) * uP0.z;
    vec3 col = mix(uC0, uC1, clamp(mot * 1.3 - .15, 0., 1.)); col = mix(col, uC2, (1. - th) * .5 + rip * uP0.y * .12); col *= .84 + .3 * rnd * .5 + .18 * mot2; col = mix(col, uC3, fade * .5); col *= .95 + .1 * fz;
    s.a = col; s.h = th * .75 * thick + (fz - .5) * .14 + rip * .12 * uP0.y; s.r = mix(uRough.x, uRough.y, clamp(rnd * .5 + fz * .4 + fade * .3, 0., 1.)); s.m = 0.; s.ao = .45 + .55 * th; return s; }
  if (mode == 16) { // SKIN (forearm): pores, micro-creases, arm hair (short strokes along v), veins, freckle mottling, warm redness
    float sc = max(uP0.x, 32.); vec3 w = worley(uv * sc, vec2(sc)); float pore = (1. - smoothstep(.0, .2, w.x)) * step(.35, h21(vec2(w.z * 37., 1.))); float n = fbmU(uv, 5., 5), n2 = fbmU(uv + 1.7, 14., 4);
    float cra = abs(fbmU(uv * vec2(1., 1.) + 4.1, 24., 3) - .5); float crease = 1. - smoothstep(.0, .05, cra);
    vec2 hp = uv * uP0.y; vec2 hid = floor(hp), hfr = fract(hp); float hair = 0.;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 cid = hid + vec2(float(i), float(j)); float hr = h21(cid + 7.7); if (hr > uP0.z) continue; vec2 ctr = vec2(float(i), float(j)) + .15 + .7 * h22(cid + 2.1) - hfr; float ang = (h21(cid + 1.3) - .5) * 1.1; vec2 dir = vec2(sin(ang), cos(ang));
      float along = dot(-ctr, dir), across = length(-ctr - dir * clamp(along, -.8, .8)); float wdt = .07 * (1. - .5 * smoothstep(.2, .8, abs(along))); hair = max(hair, (1. - smoothstep(wdt * .5, wdt, across)) * (.6 + .4 * h21(cid + 5.5))); }
    float vein = 1. - smoothstep(.0, .045, abs(fbmU(uv + 9.2, 4., 4) - .5)); vein *= smoothstep(.45, .7, fbmU(uv + 2.2, 3., 3)) * uP1.x;
    vec3 col = mix(uC0, uC1, clamp(n * 1.3 - .2, 0., 1.)); col = mix(col, uC2, smoothstep(.62, .82, n2) * .5); col *= 1. - pore * .1 - crease * .04; col = mix(col, vec3(.2, .24, .34) * (.6 + .4 * n), vein * .32); col = mix(col, vec3(.1, .07, .05), hair * .55);
    s.a = col; s.h = .5 - pore * .2 - crease * .1 + hair * .05 + (n2 - .5) * .08; s.r = mix(uRough.x, uRough.y, clamp(.5 + n * .5 - pore * .3 + hair * .2, 0., 1.)); s.m = 0.; s.ao = 1. - pore * .35; return s; }
  if (mode == 20) { // HSB STAMPED SHEET (painted / phosphated): oil-canning waviness (2-3 cycles per tile), orange peel, rolling marks along u, fine grain, blotchy tone; uP0 = (peel scale, tone blotch, waves per tile), uP1.x = wave amplitude
    float wv = fbmU(uv, max(uP0.z, 2.), 3) - .5, peel = fbmU(uv + 1.3, max(uP0.x, 6.), 4) - .5, grain = vnoise(uv * 150., vec2(150.)) - .5, mark = vnoise(vec2(uv.x * 4., uv.y * 90.), vec2(4., 90.)) - .5, blot = fbmU(uv + .7, 3., 4);
    s.a = mix(uC0, uC1, smoothstep(.45, .85, blot) * uP0.y) * (.94 + .1 * grain); s.a = mix(s.a, uC2, smoothstep(.62, .9, fbmU(uv + 3.1, 5., 4)) * .25);
    s.h = .5 + wv * uP1.x + peel * .12 + grain * .035 + mark * .04; s.r = clamp(mix(uRough.x, uRough.y, .5 + peel * .9 + grain * .25), 0., 1.); s.m = uMetal; s.ao = 1.; return s; }
  return s;
}`;

// ------------------------------------------------------------------ material definitions
// tile = metres per texture repeat. Colours are sRGB. p = [p0..p6, mode].
const DEFS = {
  parkerized: { size: 512, tile: 0.05, colors: [0x4c4f4b, 0x565954, 0x3e403d], rough: [0.34, 0.5], metal: 1, bump: 0.04, p: [0, 0.7, 0.3, 0, 0, 0, 0, 0], layers: { scratch: 0.2, oil: 0.1 }, wear: { color: [0.8, 0.8, 0.78], metal: 1, rough: 0.24, amount: 1 } },
  aperture: { size: 512, tile: 0.05, colors: [0x4c4f4b, 0x565954, 0x3e403d], rough: [0.36, 0.54], metal: 1, bump: 0.04, p: [0, 0.7, 0.3, 0, 0, 0, 0, 0], layers: { scratch: 0.2, oil: 0.1 }, wear: { color: [0.8, 0.8, 0.78], metal: 1, rough: 0.24, amount: 1 }, defocus: [0, 0.032, 0.0013, 0.0092], base: 'parkerized' },
  blued: { size: 512, tile: 0.08, colors: [0x39414f, 0x465470, 0x423646], rough: [0.2, 0.34], metal: 1, bump: 0.02, p: [320, 0.6, 0.35, 0, 0, 0, 0, 1], layers: { scratch: 0.3, oil: 0.2 }, wear: { color: [0.82, 0.82, 0.84], metal: 1, rough: 0.2, amount: 1 } },
  bluedWorn: { size: 512, tile: 0.08, colors: [0x414956, 0x55607a, 0x685a50], rough: [0.26, 0.42], metal: 1, bump: 0.02, p: [260, 0.55, 0.6, 0, 0, 0, 0, 1], layers: { scratch: 0.45, oil: 0.2 }, wear: { color: [0.8, 0.8, 0.82], metal: 1, rough: 0.22, amount: 1.2 } },
  blackPaint: { size: 512, tile: 0.08, colors: [0x121314, 0x1c1d1f], rough: [0.46, 0.62], metal: 0, bump: 0.02, p: [22, 0.5, 0, 0, 0, 0, 0, 2], layers: { scratch: 0.3 }, wear: { color: [0.72, 0.72, 0.72], metal: 1, rough: 0.3, amount: 1 }, phys: [0.05, 0.5] },
  akPaint: { size: 512, tile: 0.08, colors: [0x121314, 0x1a1b1d], rough: [0.56, 0.76], metal: 0, bump: 0.025, p: [18, 0.6, 0, 0, 0, 0, 0, 2], layers: { scratch: 0.45, grime: 0.15 }, wear: { color: [0.7, 0.7, 0.71], metal: 1, rough: 0.32, amount: 1.4 } },
  walnut: { size: 512, tile: 0.14, colors: [0x5c3a22, 0x3c2414, 0x140a05, 0x734a2c], rough: [0.66, 0.84], metal: 0, bump: 0.08, p: [26, 0.6, 0.3, 0, 0, 0, 0, 3], layers: {}, wear: { color: [0.42, 0.28, 0.16], metal: 0, rough: 0.86, amount: 0.8 }, phys: [0.1, 0.55, 0.45] },
  walnutLight: { size: 512, tile: 0.14, colors: [0x6a4426, 0x482c16, 0x1a0e06, 0x80552f], rough: [0.68, 0.86], metal: 0, bump: 0.08, p: [22, 0.6, 0.35, 0, 0, 0, 0, 3], layers: {}, wear: { color: [0.5, 0.36, 0.22], metal: 0, rough: 0.88, amount: 0.8 }, phys: [0.08, 0.6, 0.45] },
  walnutCheck: { size: 512, tile: 0.04, colors: [0x46301e, 0x140c07, 0, 0x563a24], rough: [0.5, 0.85], metal: 0, bump: 0.35, p: [32, 0.16, 0.5, 0, 0, 0, 0, 4], layers: {}, wear: { color: [0.32, 0.22, 0.13], metal: 0, rough: 0.7, amount: 0.4 } },
  laminate: { size: 512, tile: 0.12, colors: [0x3a2217, 0x4a2c1d, 0x120906], comp: 0.55, rough: [0.3, 0.46], metal: 0, bump: 0.035, p: [22, 1.6, 0, 0, 0, 0, 0, 5], layers: { scratch: 0.25, grime: 0.12 }, wear: { color: [0.44, 0.28, 0.17], metal: 0, rough: 0.6, amount: 0.9 }, phys: [0.55, 0.22, 0.5] }, // darker, browner, less saturated (was a toy-like orange-red)
  plum: { size: 512, tile: 0.1, colors: [0x44201a, 0x2c130e, 0x622c1c], rough: [0.3, 0.46], metal: 0, bump: 0.02, p: [0.6, 0, 0, 0, 0, 0, 0, 6], layers: { scratch: 0.3 }, wear: { color: [0.32, 0.16, 0.1], metal: 0, rough: 0.25, amount: 0.6 }, phys: [0.4, 0.3] },
  polymer: { size: 512, tile: 0.05, colors: [0x161718, 0x1f2022], rough: [0.62, 0.84], metal: 0, bump: 0.05, p: [60, 0, 0, 0, 0, 0, 0, 7], layers: { scratch: 0.15 }, wear: { color: [0.09, 0.09, 0.095], metal: 0, rough: 0.4, amount: 0.8 } },
  polymerCheck: { size: 512, tile: 0.03, colors: [0x18191a, 0x08090a, 0, 0x202122], rough: [0.5, 0.85], metal: 0, bump: 0.25, p: [24, 0.2, 0.5, 0, 0, 0, 0, 4], layers: {}, wear: { color: [0.1, 0.1, 0.1], metal: 0, rough: 0.4, amount: 0.3 } },
  steelCheck: { size: 512, tile: 0.03, colors: [0x4c4f4b, 0x1e1f1e, 0, 0x5a5d58], rough: [0.42, 0.8], metal: 1, bump: 0.2, p: [26, 0.2, 0.5, 0, 0, 0, 0, 4], layers: {}, wear: { color: [0.8, 0.8, 0.78], metal: 1, rough: 0.26, amount: 0.8 } },
  knurl: { size: 256, tile: 0.02, colors: [0x4c4f4b, 0x1c1d1c], rough: [0.42, 0.7], metal: 1, bump: 0.12, p: [30, 0, 0, 0, 0, 0, 0, 10], layers: {}, wear: null },
  apertureDrum: { size: 256, tile: 0.02, colors: [0x4c4f4b, 0x1c1d1c], rough: [0.42, 0.7], metal: 1, bump: 0.12, p: [30, 0, 0, 0, 0, 0, 0, 10], layers: {}, wear: null , defocus: [0, 0.0465, 0.0036, 0.0125], base: 'knurl' },
  caseHard: { size: 1024, tile: 0.1, colors: [0x707070], rough: [0.2, 0.36], metal: 1, bump: 0.06, p: [15, 0, 0, 0, 0, 0, 0, 8], layers: { scratch: 0.25, oil: 0.2 }, wear: { color: [0.66, 0.66, 0.67], metal: 1, rough: 0.2, amount: 1 } },
  brass: { size: 256, tile: 0.05, colors: [0xd8aa58, 0x7a5a2a], rough: [0.18, 0.4], metal: 1, bump: 0.01, p: [80, 0.45, 0, 0, 0, 0, 0, 9], layers: { scratch: 0.2 }, wear: { color: [0.95, 0.8, 0.5], metal: 1, rough: 0.14, amount: 0.8 } },
  brassPolished: { size: 256, tile: 0.06, colors: [0xe6bd6c, 0x8a6a36], rough: [0.1, 0.26], metal: 1, bump: 0.01, p: [90, 0.25, 0, 0, 0, 0, 0, 9], layers: { scratch: 0.15 }, wear: { color: [1.0, 0.86, 0.58], metal: 1, rough: 0.1, amount: 0.8 } },
  chrome: { size: 256, tile: 0.06, colors: [0xd4d8dc, 0x9aa0a6], rough: [0.06, 0.16], metal: 1, bump: 0.008, p: [100, 0.2, 0, 0, 0, 0, 0, 9], layers: { scratch: 0.15 }, wear: null },
  steelBright: { size: 256, tile: 0.06, colors: [0x9a9ea2, 0x6c7074], rough: [0.2, 0.36], metal: 1, bump: 0.01, p: [160, 0.3, 0, 0, 0, 0, 0, 9], layers: { scratch: 0.3 }, wear: null },
  rubber: { size: 256, tile: 0.05, pattern: 'rubber', colors: [0x121212, 0x1c1c1c], rough: [0.75, 0.92], metal: 0, bump: 0.2, params: { scale: 20, tread: 0 }, layers: {}, wear: null },
  bakeliteBlack: { size: 256, tile: 0.08, colors: [0x0c0a09, 0x1a1512, 0x2a1a10], rough: [0.2, 0.36], metal: 0, bump: 0.01, p: [0.3, 0, 0, 0, 0, 0, 0, 6], layers: { scratch: 0.2 }, wear: { color: [0.14, 0.1, 0.07], metal: 0, rough: 0.2, amount: 0.6 } },
  redAnodized: { size: 256, tile: 0.06, colors: [0x7a1410, 0x4a0a08, 0x2a0404], rough: [0.22, 0.38], metal: 1, bump: 0.01, p: [120, 0.25, 0, 0, 0, 0, 0, 9], layers: { scratch: 0.2 }, wear: { color: [0.8, 0.8, 0.82], metal: 1, rough: 0.2, amount: 1 } },
  // hands / kit
  glove: { size: 512, tile: 0.05, colors: [0x2c2d2b, 0x3a342c, 0x1a1a19], rough: [0.8, 0.96], metal: 0, bump: 0.22, p: [90, 0, 0, 0, 0, 0, 0, 12], layers: {}, wear: null, phys: [0, 0.5, 0.3], cloth: 0.55 }, // fabric: rough, weak specular, grazing sheen
  sleeve: { size: 512, tile: 0.14, colors: [0x55593c, 0x2d3824, 0x5a4630, 0x1d1e19], rough: [0.84, 0.98], metal: 0, bump: 0.25, p: [80, 0, 0, 0, 0, 0, 0, 11], layers: { grime: 0.2, dust: 0.12 }, wear: null, cloth: 0.45 },
  // hand kit (hands/*.js): p = [p0..p6, mode]; comp = colour pull toward luminance (skin keeps its saturation)
  gloveKnit: { size: 1024, tile: 0.0288, colors: [0x1b1d21, 0x32353b, 0x0d0e10, 0x50535a], rough: [0.84, 0.97], metal: 0, bump: 0.5, p: [24, 0, 0.6, 0, 0, 0, 0, 13], layers: { grime: 0.1 }, wear: null, phys: [0, 0.5, 0.3], cloth: 0.32, comp: 0.3 },
  gloveLeather: { size: 1024, tile: 0.036, colors: [0x3b2f24, 0x4d3d2f, 0x231b14], rough: [0.5, 0.8], metal: 0, bump: 0.55, p: [72, 0.6, 0, 0, 0, 0, 0, 14], layers: {}, wear: null, comp: 0.3 },
  sleeveRip: { size: 1024, tile: 0.048, colors: [0x525a30, 0x444c26, 0x30341a, 0x666a40], rough: [0.86, 0.98], metal: 0, bump: 0.38, p: [96, 1, 0.5, 0, 0, 0, 0, 15], layers: { grime: 0.12, dust: 0.08 }, wear: null, phys: [0, 0.5, 0.3], cloth: 0.35, comp: 0.3 },
  handSkin: { size: 1024, tile: 0.06, colors: [0x805744, 0x714a39, 0x593628, 0x8e6350], rough: [0.52, 0.74], metal: 0, bump: 0.13, p: [190, 44, 0.55, 0, 0.8, 0, 0, 16], layers: {}, wear: null, phys: [0.05, 0.45, 0.5], cloth: 0.12, comp: 0.1 },
  knifeBlade: { size: 256, tile: 0.06, colors: [0x55585c, 0x646870, 0x44464a], rough: [0.34, 0.5], metal: 1, bump: 0.02, p: [20, 0.3, 0, 0, 0, 0, 0, 2], layers: { scratch: 0.5 }, wear: { color: [0.85, 0.85, 0.87], metal: 1, rough: 0.18, amount: 1.5 } },
  leatherWasher: { size: 256, tile: 0.03, pattern: 'leather', colors: [0x5a3a22, 0x3a2414, 0x7a5a3a], rough: [0.45, 0.7], metal: 0, bump: 0.15, params: { scale: 40, creases: 0.3, wear: 0.4 }, layers: { grime: 0.3 }, wear: null },
  odPaint: { size: 256, tile: 0.06, colors: [0x3e4430, 0x4a5038], rough: [0.55, 0.75], metal: 0, bump: 0.03, p: [16, 0.5, 0, 0, 0, 0, 0, 2], layers: { scratch: 0.4, grime: 0.2 }, wear: { color: [0.7, 0.7, 0.68], metal: 1, rough: 0.4, amount: 1 } },
  copper: { size: 256, tile: 0.04, colors: [0xb86a44, 0x7a4028], rough: [0.22, 0.4], metal: 1, bump: 0.01, p: [60, 0.35, 0, 0, 0, 0, 0, 9], layers: {}, wear: null },
  shellHull: { size: 256, tile: 0.05, colors: [0x8a1a14, 0x6a120e], rough: [0.35, 0.5], metal: 0, bump: 0.01, p: [30, 0.3, 0, 0, 0, 0, 0, 2], layers: {}, wear: null },
};
Object.assign(DEFS, HS_DEFS);

// wear patch: aWear (chamfers) x rest-pose noise -> bare metal / raw wood. Also exposes uGlow for emissive animation.
// View-model fill ('moonlight'): tops the ambient + IBL terms of the held gun and hands (view-model pass only) up to a dim cool floor,
// so metal and wood keep some modelling in blue-night / neon stops where the scene leaves them a black cut-out. Where the scene's own
// ambient/IBL is brighter than the floor (day, lit interiors) nothing is added. rgb = colour (luminance 1), w = floor level.
// Tunable at runtime: weapons.mats.vmFill.value.
export const VM_FILL = { value: new THREE.Vector4(0.85, 1.0, 1.4, 0.45) };
function patchWear(mat, wear, key, cloth = 0) {
  const base = mat.onBeforeCompile; const baseKey = mat.customProgramCacheKey();
  const W = wear || { color: [0.5, 0.5, 0.5], metal: 1, rough: 0.3, amount: 0 };
  mat.userData.wearU = { uWearC: { value: new THREE.Color().setRGB(W.color[0], W.color[1], W.color[2], THREE.SRGBColorSpace) }, uWearP: { value: new THREE.Vector4(W.metal, W.rough, W.amount, W.scale ?? 260) } };
  mat.onBeforeCompile = (sh) => {
    base(sh); Object.assign(sh.uniforms, mat.userData.wearU); sh.uniforms.uVmFill = VM_FILL; sh.uniforms.uVmK = CORE_G.uVM; 
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aWear; attribute vec2 aCav; varying float vWear; varying vec3 vLoc; varying vec2 vCav;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vWear = aWear; vLoc = position; vCav = aCav;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWear; varying vec3 vLoc; varying vec2 vCav; uniform vec3 uWearC; uniform vec4 uWearP; uniform vec4 uVmFill; uniform float uVmK;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${cloth ? `
      { float NoVc = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); diffuseColor.rgb *= 1.0 + ${cloth.toFixed(3)} * pow(1.0 - NoVc, 2.5); } // fabric sheen: fibres light up at grazing angles` : ''}
      { float wn = zfbm3(vLoc * uWearP.w) * 0.8 + zvn3(vLoc * uWearP.w * 3.7) * 0.2;
        float thr = 0.60 - 0.1 * uWearP.z; float cvx = smoothstep(0.55, 0.95, vCav.y) * step(0.3, vWear); // baked convexity sharpens wear on true (chamfered) edges only
        float w = vWear * step(0.01, uWearP.z) * smoothstep(thr - 0.1 * cvx, thr + 0.06, wn);
        float halo = vWear * step(0.01, uWearP.z) * smoothstep(thr - 0.08, thr, wn) * (1.0 - w); // burnished rim around the bare spots
        diffuseColor.rgb = mix(diffuseColor.rgb, uWearC, w); diffuseColor.rgb = mix(diffuseColor.rgb, uWearC * 0.6 + diffuseColor.rgb * 0.4, halo * 0.35);
        metalnessFactor = mix(metalnessFactor, uWearP.x, max(w, halo * 0.4)); roughnessFactor = mix(roughnessFactor, uWearP.y, max(w, halo * 0.4));
        // baked cavity: grime in the crevices (darker, rougher)
        diffuseColor.rgb *= 1.0 - 0.3 * vCav.x; roughnessFactor = min(1.0, roughnessFactor + 0.12 * vCav.x); }`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      #if defined( RE_IndirectDiffuse ) && defined( RE_IndirectSpecular )
      { float fk = uVmFill.w * uVmK; if (fk > 0.0) { const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
        vec3 nW = inverseTransformDirection(geometryNormal, viewMatrix); vec3 rW = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
        float fe = fk * (0.35 + 0.65 * clamp(nW.y * 0.5 + 0.5, 0.0, 1.0)); irradiance += uVmFill.rgb * max(0.0, fe - dot(irradiance + iblIrradiance, LW));
        float fr = fk * (0.2 + 0.8 * smoothstep(-0.3, 0.8, rW.y)); radiance += uVmFill.rgb * max(0.0, fr - dot(radiance, LW)); } }
      #endif`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= 1.0 - 0.55 * vCav.x; reflectedLight.indirectSpecular *= 1.0 - 0.45 * vCav.x;`);
  };
  mat.customProgramCacheKey = () => baseKey + '|wear' + (key || '') + (cloth ? '|c' + cloth : '');
  return mat;
}

// The composite's ACES fit has a strong toe that crushes the weaker channels of dark colours (dark brown -> orange).
// Authoring stays photo-referenced; colours are pulled toward their luminance before baking to compensate.
const _cc = new THREE.Color();
export function comp(hex, k = 0.42) {
  _cc.setHex(hex, THREE.SRGBColorSpace); const L = 0.2126 * _cc.r + 0.7152 * _cc.g + 0.0722 * _cc.b; // linear working space
  _cc.r += (L - _cc.r) * k; _cc.g += (L - _cc.g) * k; _cc.b += (L - _cc.b) * k; return _cc.getHex(THREE.SRGBColorSpace);
}

export class GunMats {
  constructor(renderer, synth = null) {
    this.pending = []; this.deferred = false; this.progReady = false; this.vmFill = VM_FILL;
    this.synth = synth || new Synth(renderer); this.renderer = renderer; this.lib = new Map(); this.sets = new Map(); this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  /** texture set for a def name (baked once) */
  set(name) {
    let s = this.sets.get(name); if (s) return s; const d = DEFS[name]; if (!d) throw new Error('unknown gun material ' + name); if (d.base) { s = this.set(d.base); this.sets.set(name, s); return s; }
    const def = { size: d.size, tile: d.tile, colors: d.colors.map((c) => comp(c, d.comp ?? 0.42)), rough: d.rough, metal: d.metal, bump: d.bump, layers: d.layers, seed: d.seed ?? 3, ao: 0.8 };
    if (d.pattern) { def.pattern = d.pattern; def.params = d.params; } else { def.glsl = GUN_GLSL; def.p = d.p; }
    if (this.deferred && def.glsl) { // placeholder now, real bake a few per frame after the async compile (never a synchronous bake in gameplay)
      s = { map: PH.map(), normalMap: PH.normal(), orm: PH.orm(), deferred: def, name }; this.sets.set(name, s); this.pending.push(s);
      if (this.progReady && !this._bakeP && !this._pumpQ) { this._pumpQ = true; requestAnimationFrame(() => { this._pumpQ = false; this.bakePending(2); }); } return s; }
    const t0 = performance.now(); s = this.synth.make(def); this.bakeMs = (this.bakeMs || 0) + performance.now() - t0; this.sets.set(name, s); return s;
  }
  /** material by name; opts: {color (tint multiplier), physical, clearcoat, emissive, key, envMapIntensity} */
  get(name, opts = {}) {
    const k = name + (opts.variant || ''); let m = this.lib.get(k); if (m) return m;
    const d = DEFS[name]; const s = this.set(name); if (s.deferred) (s.users || (s.users = [])).push(() => m); // patched when the real bake lands
    const o = { map: s.map, normalMap: s.normalMap, roughnessMap: s.orm, metalnessMap: s.orm, aoMap: s.orm, roughness: 1, metalness: 1, normalScale: opts.normalScale ?? 1, aoMapIntensity: 0.7, key: 'gun' };
    if (opts.color) o.color = opts.color; if (opts.emissive) { o.emissive = opts.emissive; o.emissiveIntensity = opts.emissiveIntensity ?? 1; }
    const ph = opts.physical ? [opts.clearcoat ?? 0.5, opts.clearcoatRoughness ?? 0.25] : d.phys; // satin oil / varnish / enamel coat
    if (d.detail !== undefined) o.detail = d.detail; // false = no engine world-space detail layer (it swims over a held gun and pebbles fine metal)
    if (d.aniso) { o.physical = true; o.anisotropy = d.aniso[0]; o.anisotropyRotation = d.aniso[1] || 0; } // brushed / turned steel: stretched highlights
    if (ph) { o.physical = true; o.clearcoat = ph[0]; o.clearcoatRoughness = ph[1]; if (ph[2] !== undefined) o.specularIntensity = ph[2]; } // [coat, coatRough, dielectric specular scale]
    m = std(o); m.name = 'gun:' + k; // (view-model IBL scale is applied by the engine around the VM pass: gfx.vmEnv)
    patchWear(m, d.wear, ph ? 'p' : '', d.cloth || 0);
    if (d.defocus) { // rear peep sight: while aiming, the leaf around the hole fades like the out-of-focus aperture the eye sees (pupil > hole)
      const U = this.adsU || (this.adsU = { value: 0 }); const [cx, cy, r0, r1] = d.defocus; m.transparent = true; m.depthWrite = true; const pb = m.onBeforeCompile, pk = m.customProgramCacheKey();
      // colour blends by our alpha; destination alpha forced to 0 (= the view-model TAA mask the core pass writes for every vm pixel)
      m.blending = THREE.CustomBlending; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.ZeroFactor;
      m.onBeforeCompile = (sh) => { pb(sh); sh.uniforms.uAds = U; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uAds;').replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        { float dd = length(vLoc.xy - vec2(${cx.toFixed(4)}, ${cy.toFixed(4)})); diffuseColor.a *= mix(1.0, mix(0.1, 1.0, smoothstep(${r0.toFixed(5)}, ${r1.toFixed(5)}, dd)), uAds); }`).replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor.a = diffuseColor.a;'); };
      m.customProgramCacheKey = () => pk + '|defocus'; }
    this.lib.set(k, m); return m;
  }
  /**
   * Start-up without stalls: the gun pattern program (one big GLSL) is compiled with renderer.compileAsync (KHR_parallel_shader_compile)
   * while materials are created with 1x1 placeholder maps; bake() then renders the real maps a few per frame and swaps them in
   * (same texture slots => same program, no recompile).
   */
  async warm() {
    if (this.progReady) return; const r = this.renderer, sy = this.synth; const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
    try { for (const m of [sy._prog(false, GUN_GLSL), sy._conv(false)]) { const q = new THREE.Mesh(new THREE.PlaneGeometry(), m); q.frustumCulled = false; sc.add(q); } await r.compileAsync(sc, cam); } catch (e) { /* compile synchronously on first bake */ }
    this.progReady = true;
  }
  /** bake every deferred material (n per frame); resolves when done */
  bakePending(perFrame = 3) {
    if (this._bakeP) return this._bakeP; // one pump; it also picks up entries queued while it runs
    return this._bakeP = new Promise((res) => { const step = () => { const t0 = performance.now(); let n = 0;
      while (this.pending.length && n < perFrame) { const ph = this.pending.shift(); const real = this.synth.make(ph.deferred); this.sets.set(ph.name, real); n++;
        for (const f of ph.users || []) { const m = f(); if (!m) continue; m.map = real.map; m.normalMap = real.normalMap; m.roughnessMap = m.metalnessMap = m.aoMap = real.orm; }
        for (const [k, s2] of this.sets) if (s2 === ph) this.sets.set(k, real); }
      this.bakeMs = (this.bakeMs || 0) + performance.now() - t0; if (this.pending.length) requestAnimationFrame(step); else { this._bakeP = null; res(); } }; step(); });
  }
  /** plain helpers */
  basic(key, o) { let m = this.lib.get(key); if (!m) { m = std({ key: 'gunb', ...o }); patchWear(m, null, 'b'); m.name = 'gun:' + key; this.lib.set(key, m); } return m; }
  /** markings atlas (engraved / stamped text): canvas RGBA (colour + alpha mask) + normal map from the letter height. */
  marks(key, w, h, draw, { color = 0x0a0a0a, rough = 0.75, metal = 0.4, fill = 'dark' } = {}) {
    let m = this.lib.get('marks:' + key); if (m) return m;
    const mask = document.createElement('canvas'); mask.width = w; mask.height = h; const g = mask.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; draw(g, w, h);
    const src = g.getImageData(0, 0, w, h).data; const alb = new Uint8ClampedArray(w * h * 4), nrm = new Uint8ClampedArray(w * h * 4);
    const H = (x, y) => src[((Math.min(h - 1, Math.max(0, y)) * w) + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
    const cc = new THREE.Color(color);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; const a = H(x, y); const blur = (H(x - 1, y) + H(x + 1, y) + H(x, y - 1) + H(x, y + 1)) * 0.25; const al = Math.max(a, blur * 0.9);
      alb[i] = cc.r * 255; alb[i + 1] = cc.g * 255; alb[i + 2] = cc.b * 255; alb[i + 3] = al * 255;
      let nx = (H(x + 1, y) - H(x - 1, y)) * 1.6, ny = (H(x, y - 1) - H(x, y + 1)) * 1.6; const l = Math.hypot(nx, ny, 1); nrm[i] = (nx / l * 0.5 + 0.5) * 255; nrm[i + 1] = (ny / l * 0.5 + 0.5) * 255; nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
    }
    const mk = (data, srgb) => canvasTexture(w, h, (c) => c.putImageData(new ImageData(data, w, h), 0, 0), { srgb, aniso: this.aniso });
    m = std({ map: mk(alb, true), normalMap: mk(nrm, false), roughness: rough, metalness: metal, transparent: false, alphaTest: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, key: 'gunmarks', normalScale: 1.5 });
    patchWear(m, null, 'm'); m.name = 'gun:marks:' + key; this.lib.set('marks:' + key, m); return m;
  }
  /** shared utility materials (sight paint, bore darkness, emissive) */
  util() {
    this.basic('dotWhite', { color: 0xe8e6dc, roughness: 0.55, metalness: 0, emissive: 0x303030, emissiveIntensity: 0.3 });
    this.basic('dotGreen', { color: 0x60ff90, roughness: 0.4, metalness: 0, emissive: 0x40ff70, emissiveIntensity: 2.5 });
    this.basic('bore', { color: 0x0a0a0a, roughness: 0.55, metalness: 0.8 });
    this.basic('blackMatte', { color: 0x0d0d0e, roughness: 0.7, metalness: 0.2 });
    this.basic('crystal', { color: 0x1a6a2a, roughness: 0.08, metalness: 0.1, emissive: 0x2cff5a, emissiveIntensity: 4.5 });
    return this;
  }
  /** animated plasma: flowing emissive bands in object space, intensity driven by plasmaU (ray gun charge) */
  plasma() {
    let m = this.lib.get('plasma'); if (m) return m; this.plasmaU = this.plasmaU || { value: 1 };
    m = std({ color: 0x0c2410, roughness: 0.3, metalness: 0, emissive: 0x38ff5c, emissiveIntensity: 6, key: 'plasma' });
    const base = m.onBeforeCompile, U = this.plasmaU;
    m.onBeforeCompile = (sh) => { base(sh); sh.uniforms.uCharge = U;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPl;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vPl = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPl; uniform float uCharge;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float band = 0.5 + 0.5 * sin(vPl.z * 380.0 - uTime * 21.0 + sin(vPl.x * 260.0 + uTime * 3.0) * 2.2); float fl = 0.85 + 0.15 * sin(uTime * 53.0 + vPl.y * 900.0);
          totalEmissiveRadiance *= uCharge * (0.35 + 0.75 * band * band) * fl; diffuseColor.rgb += vec3(0.02, 0.1, 0.03) * uCharge; }`); };
    m.customProgramCacheKey = () => 'plasmaMat'; m.name = 'gun:plasma'; this.lib.set('plasma', m); return m;
  }
  all() { return [...this.lib.values()]; }
}

// 1x1 placeholders used until the deferred bakes land (neutral albedo, flat normal, mid roughness / full metal as the real ORM packs it)
const _ph = {}; const phTex = (k, rgba, srgb) => { if (_ph[k]) return _ph[k]; const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return (_ph[k] = t); };
const PH = { map: () => phTex('m', [70, 70, 70, 255], true), normal: () => phTex('n', [128, 128, 255, 255], false), orm: () => phTex('o', [255, 150, 255, 255], false) };
let _shared = null;
/** shared library (created on first use from the renderer) */
export function gunMats(renderer, synth) { if (!_shared) _shared = new GunMats(renderer, synth); return _shared; }
export { DEFS as GUN_MAT_DEFS };
