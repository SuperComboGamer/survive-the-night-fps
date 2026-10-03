// GPU procedural material synthesizer: one uber fragment shader, MRT output (albedo / normal / ORM / emissive).
// All patterns are tileable. Height is physical: bump amplitude in millimetres over a tile of `tile` metres.

export const PATTERNS = {
  // name: [id, [param names -> uP0.x,y,z,w, uP1.x,y,z,w, ...]]
  noise:    [0, ['scale', 'contrast', 'fine', 'speckle', 'pores', 'panels', 'panelWidth', 'sheen']],
  planks:   [1, ['rows', 'gap', 'grain', 'knots', 'cols', 'vertical', 'weather', 'nails']],
  bricks:   [2, ['rows', 'cols', 'mortar', 'variation', 'chips', 'roughness', 'moss', 'soot']],
  stone:    [3, ['scale', 'gap', 'round', 'variation', 'mortarDark', 'strata', 'lichen', 'x']],
  tiles:    [4, ['n', 'grout', 'checker', 'bevel', 'wear', 'gloss', 'crackle', 'x']],
  plates:   [5, ['cols', 'rows', 'seam', 'rivets', 'brushed', 'panelVar', 'bolts', 'x']],
  corrugated: [6, ['ribs', 'depth', 'vertical', 'paint', 'dents', 'x', 'y', 'z']],
  diamond:  [7, ['n', 'height', 'wear', 'x', 'y', 'z', 'w', 'v']],
  rock:     [8, ['scale', 'strata', 'cracks', 'roughness', 'tone', 'moisture', 'x', 'y']],
  snow:     [9, ['scale', 'ripples', 'sparkle', 'direction', 'crust', 'x', 'y', 'z']],
  ice:      [10, ['scale', 'cracks', 'bubbles', 'depth', 'x', 'y', 'z', 'w']],
  gravel:   [11, ['scale', 'variation', 'sand', 'x', 'y', 'z', 'w', 'v']],
  dirt:     [12, ['scale', 'pebbles', 'cracks', 'grass', 'x', 'y', 'z', 'w']],
  weave:    [13, ['threads', 'twill', 'variation', 'fuzz', 'ripstop', 'x', 'y', 'z']],
  quilt:    [14, ['rows', 'cols', 'puff', 'stitch', 'threads', 'x', 'y', 'z']],
  leather:  [15, ['scale', 'creases', 'wear', 'x', 'y', 'z', 'w', 'v']],
  rubber:   [16, ['scale', 'tread', 'x', 'y', 'z', 'w', 'v', 'u']],
  carpet:   [17, ['scale', 'pattern', 'x', 'y', 'z', 'w', 'v', 'u']],
  terrazzo: [18, ['scale', 'chips', 'chipSize', 'x', 'y', 'z', 'w', 'v']],
  lava:     [19, ['scale', 'crackWidth', 'glow', 'crust', 'pulse', 'x', 'y', 'z']],
  hex:      [20, ['n', 'border', 'glow', 'bevel', 'x', 'y', 'z', 'w']],
  hazard:   [21, ['n', 'angle', 'wear', 'x', 'y', 'z', 'w', 'v']],
  asphalt:  [22, ['scale', 'aggregate', 'cracks', 'lines', 'x', 'y', 'z', 'w']],
  crystal:  [23, ['scale', 'facets', 'veins', 'glow', 'x', 'y', 'z', 'w']],
  wood:     [24, ['scale', 'rings', 'knots', 'weather', 'vertical', 'x', 'y', 'z']], // single log / big board grain
  scales:   [25, ['rows', 'cols', 'round', 'variation', 'x', 'y', 'z', 'w']], // roof shingles / fish-scale tiles
  bark:     [26, ['scale', 'depth', 'moss', 'x', 'y', 'z', 'w', 'v']],
  custom:   [99, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']],
};
export const LAYERS = ['rust', 'moss', 'grime', 'scratch', 'edge', 'wet', 'frost', 'dust', 'streak', 'cracks', 'sparkle', 'oil'];

// pattern: with it, the program is built for that one pattern (uPattern a constant: the compiler drops every other pattern's
// code). Windows browsers translate shaders through Direct3D's compiler, which takes tens of seconds over the program with all
// 27 patterns in it; a program per pattern compiles in a fraction of a second.
export function buildFragment({ emissive = false, custom = '', pattern = -1, layerMask = -1 } = {}) {
  return gateLayers(/* glsl */`
precision highp float; precision highp int;
in vec2 vUv;
layout(location = 0) out highp vec4 oAlb;
layout(location = 1) out highp vec4 oOrm;
${emissive ? 'layout(location = 2) out highp vec4 oEmi;' : ''}
${pattern >= 0 ? `const int uPattern = ${pattern | 0};` : 'uniform int uPattern;'} uniform float uSeed; uniform float uSize; uniform float uTileM; uniform float uBump; uniform float uAOAmt;
uniform vec4 uP0; uniform vec4 uP1;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
uniform vec2 uRough; uniform float uMetal;
uniform vec4 uLA; uniform vec4 uLB; uniform vec4 uLC;   // layers: rust,moss,grime,scratch | edge,wet,frost,dust | streak,cracks,sparkle,oil
uniform vec3 uCRust; uniform vec3 uCMoss;
const float PI = 3.14159265359;

float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx + uSeed) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx + uSeed) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); f = f*f*f*(f*(f*6.-15.)+10.);
  float a = h21(mod(i, per)), b = h21(mod(i + vec2(1,0), per)), c = h21(mod(i + vec2(0,1), per)), d = h21(mod(i + vec2(1,1), per));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm2(vec2 p, vec2 per, int oct){ float a = .5, s = 0., n = 0.; for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vnoise(p, per); n += a; p *= 2.; per *= 2.; a *= .5; } return s / n; }
float fbmU(vec2 uv, float sc, int oct){ return fbm2(uv * sc, vec2(sc), oct); }
// worley: (F1, F2, cell id, unused)
vec3 worley(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); float f1 = 8., f2 = 8., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 cell = mod(i + g, per);
    vec2 o = h22(cell + 5.31); vec2 r = g + o - f; float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = h21(cell + 3.7); } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
vec3 palette(float t){ t = clamp(t, 0., 1.); return t < .5 ? mix(uC0, uC1, t * 2.) : mix(uC1, uC2, (t - .5) * 2.); }

struct S { float h; vec3 a; float r; float m; float ao; vec3 e; };
S mk(){ S s; s.h = .5; s.a = uC0; s.r = .7; s.m = 0.; s.ao = 1.; s.e = vec3(0.); return s; }

// ------------------------------------------------------------------ patterns
S p_noise(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 1.), con = uP0.y, fine = max(uP0.z, 8.), spk = uP0.w, pores = uP1.x, panels = uP1.y, pw = uP1.z;
  float n = fbmU(uv, sc, 5), g = vnoise(uv * fine, vec2(fine)), g2 = vnoise(uv * fine * 2., vec2(fine * 2.));
  s.h = n * .5 + g * .3 + g2 * .2;
  float t = clamp((n - .5) * con + .5, 0., 1.);
  s.a = mix(mix(uC0, uC1, t), uC2, smoothstep(.5, 1., 1. - t) * .35);
  s.a *= .92 + .16 * g;
  if (spk > 0.) { float sp = step(1. - spk, g2); s.a = mix(s.a, uC3, sp * .85); s.h += sp * .1; }
  if (pores > 0.) { vec3 w = worley(uv * 40., vec2(40.)); float pr = (1. - smoothstep(0., .22, w.x)) * step(1. - pores, h21(vec2(w.z * 91., 3.))); s.a *= 1. - pr * .5; s.h -= pr * .3; s.ao *= 1. - pr * .5; }
  if (panels > 0.5) { vec2 pc = uv * panels; vec2 f = fract(pc); float d = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)) / panels; float seam = 1. - smoothstep(0., max(pw, .002), d); s.a *= 1. - seam * .45; s.h -= seam * .5; s.ao *= 1. - seam * .4; s.r += seam * .1; }
  s.r = mix(uRough.x, uRough.y, clamp(1. - t * .6 + g * .3, 0., 1.)); s.m = uMetal;
  return s;
}
S p_planks(vec2 uv){
  S s = mk(); float rows = max(uP0.x, 1.), gap = uP0.y, gs = max(uP0.z, 1.), knots = uP0.w, cols = max(uP1.x, 1.); bool vert = uP1.y > .5; float weather = uP1.z, nails = uP1.w;
  if (vert) uv = uv.yx;
  float ry = uv.y * rows, row = floor(ry), fy = fract(ry);
  float off = h21(vec2(row, 3.1));
  float u = uv.x * cols - off, k = floor(u), fx = fract(u);
  vec2 id = vec2(mod(k, cols), row); float rnd = h21(id + 17.);
  float gper = rows * gs;
  vec2 gp = vec2(uv.x * 3., ry * gs + rnd * 40.);
  float warp = fbm2(gp * vec2(1., .25), vec2(3., gper * .25), 3);
  float g = fbm2(gp + vec2(warp * 2., 0.), vec2(3., gper), 4);
  float ring = .5 + .5 * sin((fy * 7. + warp * 5.5 + rnd * 9.) * 6.2831) * (.6 + .4 * g);
  float fine = vnoise(vec2(uv.x * 6., ry * gs * 3.5 + rnd * 20.), vec2(6., rows * gs * 3.5));
  float tone = mix(.82, 1.12, rnd);
  vec3 wood = mix(uC0, uC1, clamp(ring * .28 + g * .38 + fine * .18, 0., 1.)) * tone;
  // knots
  float kn = 0.;
  if (knots > 0.) { vec2 kc = vec2(h21(id + 4.4), .25 + .5 * h21(id + 8.8)); if (h21(id + 2.2) < knots) { vec2 d = vec2((fx - kc.x) / cols * 1., (fy - kc.y) / rows); float dd = length(d * vec2(rows, cols) * .5); kn = smoothstep(.09, .0, dd); wood = mix(wood, uC1 * .35, kn * .8); ring += kn * sin(dd * 90.) * .3; } }
  float dx = min(fx, 1. - fx) / cols, dy = min(fy, 1. - fy) / rows, d = min(dx, dy);
  float body = smoothstep(gap * .5, gap * .5 + .0035, d);
  float bevel = smoothstep(gap * .5, gap * 1.6 + .01, d);
  s.a = mix(uC2, wood, body);
  s.h = bevel * .8 + ring * .08 + g * .06 - kn * .05;
  // weathering: grey bleach + dirt in grain
  float wn = fbmU(uv, 8., 4); s.a = mix(s.a, s.a * .55 + vec3(.06, .055, .05), weather * smoothstep(.35, .8, wn));
  s.r = mix(uRough.x, uRough.y, clamp(.6 + g * .5 - weather * .0, 0., 1.)); s.m = 0.;
  if (nails > 0.) { for (int i = 0; i < 2; i++) { float nx = i == 0 ? .05 : .95; vec2 nd = vec2((fx - nx) / cols, (fy - .3) / rows); vec2 nd2 = vec2((fx - nx) / cols, (fy - .7) / rows); float nl = min(length(nd), length(nd2)); float nh = 1. - smoothstep(.0016, .0023, nl); s.a = mix(s.a, vec3(.09, .085, .08), nh * nails); s.m = max(s.m, nh * nails * .9); s.h += nh * .1; } }
  s.ao = mix(.35, 1., body);
  return s;
}
S p_bricks(vec2 uv){
  S s = mk(); float rows = max(uP0.x, 2.), cols = max(uP0.y, 1.), mortar = uP0.z, vr = uP0.w, chips = uP1.x, rgh = uP1.y, moss = uP1.z, soot = uP1.w;
  float ry = uv.y * rows, row = floor(ry), fy = fract(ry);
  float off = mod(row, 2.) * .5; float u = uv.x * cols + off, k = floor(u), fx = fract(u);
  vec2 id = vec2(mod(k, cols), row); float rnd = h21(id + 9.1), rnd2 = h21(id + 1.3);
  float dx = min(fx, 1. - fx) / cols, dy = min(fy, 1. - fy) / rows, d = min(dx, dy);
  float body = smoothstep(mortar * .5, mortar * .5 + .0025, d);
  vec3 col = mix(uC0, uC1, rnd) * (1. - vr * .5 + vr * rnd2);
  float sp = fbmU(uv, 24., 3); col *= .82 + .36 * sp;
  vec3 mort = uC2 * (.75 + .5 * fbmU(uv, 40., 3));
  s.a = mix(mort, col, body);
  float bh = smoothstep(mortar * .5, mortar * 1.6, d) * (.75 + .25 * sp) - (1. - body) * .35;
  float chip = 0.; if (chips > 0.) { float cn = vnoise(uv * vec2(cols * 22., rows * 22.), vec2(cols * 22., rows * 22.)); chip = smoothstep(.72, .9, cn) * (1. - smoothstep(0., mortar * 3., d)) * chips; s.a = mix(s.a, mort * .9, chip); bh -= chip * .4; }
  s.h = bh; s.ao = mix(.3, 1., body);
  if (moss > 0.) { float mn = smoothstep(.55, .85, fbmU(uv, 6., 4) + (1. - uv.y) * .15) * moss; s.a = mix(s.a, uCMoss * .7, mn * .7); s.r = mix(s.r, .95, mn); }
  if (soot > 0.) { float sn = fbmU(uv, 5., 4); s.a *= 1. - soot * smoothstep(.3, .8, sn) * .7; }
  s.r = mix(uRough.x, uRough.y, .5 + .5 * sp) ; s.m = 0.;
  return s;
}
S p_stone(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 2.), gap = uP0.y, rd = uP0.z, vr = uP0.w, md = uP1.x, strata = uP1.y, lichen = uP1.z;
  vec2 wp = uv * sc + (fbm2(uv * 6., vec2(6.), 3) - .5) * .35;
  vec3 w = worley(wp, vec2(sc)); float edge = w.y - w.x;
  float body = smoothstep(gap, gap + .05 + rd * .2, edge);
  float rnd = h21(vec2(w.z * 133., 7.));
  vec3 col = mix(uC0, uC1, rnd); col = mix(col, uC3, step(.85, rnd) * .5);
  float n = fbmU(uv, 12., 4); col *= .78 + .4 * n;
  if (strata > 0.) col *= 1. - strata * .18 * sin((uv.y + n * .05) * 62.83);
  s.a = mix(uC2 * (.6 + md * .0), col, body);
  s.h = body * (.55 + .45 * smoothstep(0., .5, edge)) * (.8 + .2 * n) - (1. - body) * .3 + (fbmU(uv, 48., 3) - .5) * .15;
  s.ao = mix(.35, 1., body); s.r = mix(uRough.x, uRough.y, n); s.m = 0.;
  if (lichen > 0.) { float ln = smoothstep(.62, .78, fbmU(uv, 9., 4)) * lichen; s.a = mix(s.a, uCMoss * .8, ln * .6); }
  return s;
}
S p_tiles(vec2 uv){
  S s = mk(); float n = max(uP0.x, 1.), grout = uP0.y, chk = uP0.z, bev = uP0.w, wear = uP1.x, gloss = uP1.y, crk = uP1.z;
  vec2 c = uv * n, id = floor(c), f = fract(c); vec2 idm = mod(id, vec2(n));
  float d = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y)) / n;
  float body = smoothstep(grout * .5, grout * .5 + .002, d); float rnd = h21(idm + 2.2);
  vec3 col = chk > .5 ? (mod(idm.x + idm.y, 2.) < 1. ? uC0 : uC1) : mix(uC0, uC1, rnd * .5);
  col *= .93 + .12 * rnd;
  float n2 = fbmU(uv, 16., 4); col *= .9 + .2 * n2;
  s.a = mix(uC2 * (.8 + .3 * n2), col, body);
  s.h = smoothstep(grout * .5, grout * .5 + max(bev, .002), d) * .8 + (n2 - .5) * .05 - (1. - body) * .3;
  if (crk > 0.) { vec3 w = worley(uv * 6. + rnd, vec2(6.)); float cr = (1. - smoothstep(0., .03, w.y - w.x)) * step(1. - crk, h21(idm + 11.)); s.a *= 1. - cr * .6; s.h -= cr * .3; }
  s.r = mix(uRough.x, uRough.y, clamp(n2 + (1. - gloss) * .3, 0., 1.)); s.m = 0.; s.ao = mix(.5, 1., body);
  return s;
}
S p_plates(vec2 uv){
  S s = mk(); float cols = max(uP0.x, 1.), rows = max(uP0.y, 1.), seam = uP0.z, rv = uP0.w, br = uP1.x, pv = uP1.y, bolts = uP1.z;
  vec2 c = uv * vec2(cols, rows), id = floor(c), f = fract(c); float rnd = h21(mod(id, vec2(cols, rows)) + 3.3);
  vec2 dd = min(f, 1. - f) / vec2(cols, rows); float d = min(dd.x, dd.y);
  float body = smoothstep(seam * .5, seam * .5 + .0025, d);
  float brush = vnoise(vec2(uv.x * 3., uv.y * 240.), vec2(3., 240.)) * br + vnoise(vec2(uv.x * 40., uv.y * 4.), vec2(40., 4.)) * (1. - br) * .5;
  float pn = fbmU(uv, 10., 4);
  vec3 col = mix(uC0, uC1, rnd * pv) * (.88 + .18 * pn) * (.95 + .1 * brush);
  s.a = mix(uC2, col, body);
  s.h = body * .7 + brush * .05 - (1. - body) * .3 + smoothstep(seam * .5, seam * 1.5, d) * .1;
  float riv = 0.;
  if (rv > 0.5) { vec2 rp = fract(uv * vec2(cols, rows) * vec2(rv, rv)) ; // rivet rows along seams
    vec2 q = f * vec2(cols, rows); float dl = min(min(q.x, cols - q.x), 1.); vec2 dm = abs(fract(vec2(f.x * cols, f.y * rows) * rv) - .5);
    float nearSeam = 1. - smoothstep(0., seam * 3.2 + .006, d);
    float r = length(dm) * 1.; riv = nearSeam * (1. - smoothstep(.16, .2, r)) * step(seam * .8, d); s.a = mix(s.a, col * 1.25, riv * .6); s.h += riv * .35; s.ao *= 1. - (1. - riv) * nearSeam * .05; }
  if (bolts > 0.5) { vec2 bp = abs(fract(f * 2.) - .5); float b = 1. - smoothstep(.06, .08, length(bp - .5 + vec2(.42))); s.h += b * .25; s.a = mix(s.a, col * .5, b * .5); }
  s.r = mix(uRough.x, uRough.y, clamp(pn * .8 + brush * .3, 0., 1.)); s.m = uMetal; s.ao = min(s.ao, mix(.5, 1., body));
  return s;
}
S p_corrugated(vec2 uv){
  S s = mk(); float ribs = max(uP0.x, 2.), dep = uP0.y, vert = uP0.z, paint = uP0.w, dents = uP1.x;
  vec2 p = vert > .5 ? uv : uv.yx; float w = sin(p.x * ribs * 6.28318); float prof = w * .5 + .5;
  float n = fbmU(uv, 8., 4), n2 = fbmU(uv, 30., 3);
  float dn = 0.; if (dents > 0.) { dn = (fbmU(uv, 5., 3) - .5) * dents; }
  s.h = prof * dep + dn * .3;
  vec3 col = mix(uC0, uC1, n); col *= .85 + .3 * n2; s.a = col;
  s.r = mix(uRough.x, uRough.y, n2); s.m = uMetal; s.ao = mix(.6, 1., prof);
  return s;
}
S p_diamond(vec2 uv){
  S s = mk(); float n = max(uP0.x, 2.), ht = uP0.y, wear = uP0.z;
  vec2 c = uv * n; vec2 id = floor(c); vec2 f = fract(c) - .5; float alt = mod(id.x + id.y, 2.);
  vec2 q = alt < .5 ? vec2(f.x + f.y, f.x - f.y) * .7071 : vec2(f.x - f.y, f.x + f.y) * .7071;
  float bar = (1. - smoothstep(.07, .1, abs(q.y))) * (1. - smoothstep(.34, .38, abs(q.x)));
  float ns = fbmU(uv, 12., 4), n2 = fbmU(uv, 40., 3);
  s.h = .3 + bar * ht * .7; vec3 col = mix(uC0, uC1, ns); col *= .9 + .2 * n2;
  s.a = mix(col, col * 1.3, bar * .5); s.r = mix(uRough.x, uRough.y, ns); s.m = uMetal; s.ao = mix(.6, 1., bar + .3);
  return s;
}
S p_rock(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 2.), strata = uP0.y, crk = uP0.z, tone = uP0.w, mois = uP1.z;
  float n = fbmU(uv, sc, 6), n2 = fbmU(uv, sc * 4., 3);
  float bands = sin((uv.y * 2. + (n - .5) * .35) * PI * max(strata, 1.));
  vec3 w = worley(uv * sc * .8 + (n - .5) * .5, vec2(sc * .8)); float cr = 1. - smoothstep(0., .08 + .0 * crk, w.y - w.x); cr *= crk;
  float t = clamp(n * 1.2 + bands * .12 * step(.5, strata), 0., 1.);
  vec3 col = mix(palette(t), uC3, smoothstep(.72, .9, n2) * .5);
  col *= .8 + .35 * n2; col = mix(col, col * .4, cr);
  s.a = col; s.h = n * .7 + n2 * .2 + bands * .06 - cr * .4; s.ao = 1. - cr * .7 - (1. - n) * .12;
  s.r = mix(uRough.x, uRough.y, n2); s.m = uMetal + smoothstep(.85, .95, n2) * .0;
  s.r = mix(s.r, uRough.x * .6, mois * smoothstep(.4, .8, fbmU(uv, 4., 3)));
  return s;
}
S p_snow(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 2.), rip = uP0.y, spk = uP0.z, dirn = uP0.w, crust = uP1.x;
  float a = fbm2(vec2(uv.x * sc * (1.), uv.y * sc * 5.), vec2(sc, sc * 5.), 5); float b = fbm2(uv * sc * 2., vec2(sc * 2.), 5); float c = fbmU(uv, 96., 2);
  float rp = (dirn < .5) ? a : b;
  s.h = mix(b, rp, rip) * .8 + c * .1;
  float t = clamp(b * 1.1, 0., 1.); s.a = mix(uC0, uC1, t); s.a = mix(s.a, uC2, smoothstep(.55, .9, 1. - a) * .5);
  float sparkle = step(.988, h21(floor(uv * uSize * .5))) * spk; s.a += vec3(sparkle * .5);
  s.r = mix(uRough.x, uRough.y, c) - sparkle * .35; s.m = 0.; s.ao = mix(.75, 1., s.h);
  if (crust > 0.) { vec3 w = worley(uv * 9., vec2(9.)); float cr = 1. - smoothstep(0., .05, w.y - w.x); s.h -= cr * .12 * crust; s.a *= 1. - cr * .06 * crust; }
  return s;
}
S p_ice(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 2.), crk = uP0.y, bub = uP0.z, dep = uP0.w;
  float n = fbmU(uv, sc, 5), n2 = fbmU(uv, sc * 3., 3);
  vec3 w = worley(uv * 7. + n * .25, vec2(7.)); float cr = (1. - smoothstep(0., .035, w.y - w.x)) * crk;
  vec3 w2 = worley(uv * 20., vec2(20.)); float bb = (1. - smoothstep(.0, .18, w2.x)) * step(1. - bub, h21(vec2(w2.z * 77., 1.)));
  s.a = mix(uC0, uC1, n); s.a = mix(s.a, uC2, cr * .8 + bb * .5); s.a *= .92 + .12 * n2;
  s.h = n * .35 + n2 * .1 - cr * .25 + bb * .1; s.r = mix(uRough.x, uRough.y, clamp(n2 + cr, 0., 1.)); s.m = 0.; s.ao = 1. - cr * .3;
  return s;
}
S p_gravel(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 4.), vr = uP0.y, sand = uP0.z;
  vec3 w = worley(uv * sc, vec2(sc)); vec3 w2 = worley(uv * sc * 2. + 3.7, vec2(sc * 2.));
  float rnd = h21(vec2(w.z * 51., 2.)); float dome = clamp(1. - w.x * 1.35, 0., 1.);
  vec3 col = palette(rnd) * (1. - vr * .35 + vr * .7 * h21(vec2(w.z * 19., 5.)));
  float small = clamp(1. - w2.x * 1.5, 0., 1.);
  float gapm = smoothstep(.45, .8, w.x);
  vec3 sandc = uC3 * (.8 + .4 * fbmU(uv, 32., 3));
  s.a = mix(col, sandc, clamp(gapm * (.4 + sand), 0., 1.)); s.a *= .85 + .3 * dome;
  s.h = max(dome, small * .5) * .9 - gapm * .25; s.ao = mix(.4, 1., dome + small * .3);
  s.r = mix(uRough.x, uRough.y, rnd); s.m = 0.;
  return s;
}
S p_dirt(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 2.), peb = uP0.y, crk = uP0.z, grass = uP0.w;
  float n = fbmU(uv, sc, 6), n2 = fbmU(uv, sc * 5., 4), n3 = fbmU(uv, 96., 3), n4 = vnoise(uv * 256., vec2(256.));
  float clump = smoothstep(.35, .75, fbmU(uv, sc * 2., 4));
  s.a = mix(mix(uC0, uC1, n), uC2, smoothstep(.5, .95, n2) * .55); s.a = mix(s.a, uC1 * 1.15, clump * .35); s.a *= .8 + .35 * n3 + .1 * n4;
  s.h = n * .5 + n2 * .25 + n3 * .15 + n4 * .1 + clump * .1; s.r = mix(uRough.x, uRough.y, n2); s.m = 0.; s.ao = mix(.55, 1., n);
  if (peb > 0.) {
    // sparse stones of two size classes with varied sizes/colours (never a regular mosaic)
    vec3 w = worley(uv * 11., vec2(11.)); float rs = h21(vec2(w.z * 71., 4.)); float on = step(1. - peb * .28, h21(vec2(w.z * 33., 1.))); float rad = mix(.16, .42, rs); float pb = smoothstep(rad, rad * .55, w.x) * on;
    vec3 w2 = worley(uv * 37. + 3.1, vec2(37.)); float rs2 = h21(vec2(w2.z * 53., 6.)); float on2 = step(1. - peb * .5, h21(vec2(w2.z * 29., 2.))); float pb2 = smoothstep(mix(.14, .34, rs2), .05, w2.x) * on2;
    vec3 stoneC = uC3 * (.45 + .75 * h21(vec2(w.z * 71., 3.))); vec3 stoneC2 = uC3 * (.4 + .7 * h21(vec2(w2.z * 61., 5.)));
    s.a = mix(s.a, stoneC, pb); s.a = mix(s.a, stoneC2, pb2 * (1. - pb)); s.h += pb * .55 + pb2 * .3; s.ao *= 1. - .35 * (pb + pb2) * (1. - smoothstep(0., .5, w.x));
    s.r = mix(s.r, .78, max(pb, pb2));
  }
  if (crk > 0.) { vec3 w = worley(uv * 5. + n * .3, vec2(5.)); float cr = (1. - smoothstep(0., .07, w.y - w.x)) * crk; s.a *= 1. - cr * .5; s.h -= cr * .35; }
  if (grass > 0.) { float g1 = vnoise(vec2(uv.x * 160., uv.y * 24.), vec2(160., 24.)), g2 = vnoise(vec2(uv.x * 220., uv.y * 30.) + 7., vec2(220., 30.)); float gm = smoothstep(.42, .7, fbmU(uv, 6., 4)) * grass; vec3 gc = mix(uCMoss * .55, uCMoss * 1.15, g1 * g2 * 1.6); s.a = mix(s.a, gc, gm); s.h += gm * (g1 - .5) * .35; s.r = mix(s.r, .92, gm); }
  return s;
}
S p_weave(vec2 uv){
  S s = mk(); float T = max(uP0.x, 8.), tw = uP0.y, vr = uP0.z, fuzz = uP0.w, rip = uP1.x;
  vec2 c = uv * T; vec2 id = floor(c), f = fract(c);
  float over = tw > .5 ? step(mod(id.x + id.y, 3.), .5) : mod(id.x + id.y, 2.);
  float warp = sin(f.x * PI), weft = sin(f.y * PI);
  float th = over > .5 ? warp : weft; float tv = over > .5 ? f.y : f.x;
  float rnd = h21(over > .5 ? vec2(id.x, 1.) : vec2(id.y, 2.));
  vec3 col = over > .5 ? uC0 : uC1; col *= 1. - vr * .25 + vr * .5 * rnd;
  float n = fbmU(uv, 10., 3); col *= .88 + .24 * n;
  s.a = col; s.h = th * .6 + (over > .5 ? .1 : 0.); s.ao = mix(.6, 1., th);
  s.r = mix(uRough.x, uRough.y, rnd); s.m = 0.;
  if (fuzz > 0.) { float fz = vnoise(uv * 300., vec2(300.)); s.h += (fz - .5) * fuzz * .2; s.a *= 1. + (fz - .5) * fuzz * .3; }
  if (rip > 0.) { float gr = max(smoothstep(.92, 1., fract(uv.x * T / 8.)), smoothstep(.92, 1., fract(uv.y * T / 8.))); s.h += gr * .3 * rip; s.a *= 1. + gr * .15 * rip; }
  return s;
}
S p_quilt(vec2 uv){
  S s = mk(); float rows = max(uP0.x, 1.), cols = max(uP0.y, 1.), puff = uP0.z, stitch = uP0.w, T = max(uP1.x, 32.);
  vec2 c = uv * vec2(cols, rows); vec2 id = floor(c), f = fract(c);
  float px = sin(f.x * PI), py = sin(f.y * PI); float pf = pow(clamp(px * py, 0., 1.), .5 + puff * .0);
  float st = 1. - smoothstep(0., .07, min(min(f.x, 1. - f.x) * .25, min(f.y, 1. - f.y) * .5));
  float rnd = h21(mod(id, vec2(cols, rows)) + 4.1);
  vec3 col = mix(uC0, uC1, .0) * (.9 + .12 * rnd);
  float nn = fbmU(uv, 24., 3); col *= .9 + .2 * nn;
  vec2 tc = uv * T; float th = mod(floor(tc.x) + floor(tc.y), 2.); col *= 1. - th * .05;
  s.a = mix(col, col * .55, st * stitch); s.h = pf * puff - st * .5 * stitch + th * .02; s.ao = mix(.35, 1., pf);
  s.r = mix(uRough.x, uRough.y, nn); s.m = 0.;
  return s;
}
S p_leather(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 8.), cre = uP0.y, wear = uP0.z;
  vec3 w = worley(uv * sc, vec2(sc)); float grain = smoothstep(0., .5, w.y - w.x) ; float n = fbmU(uv, 6., 4);
  vec3 w2 = worley(uv * 5. + n, vec2(5.)); float cr = (1. - smoothstep(0., .05, w2.y - w2.x)) * cre;
  s.a = mix(uC0, uC1, n) * (.85 + .3 * grain) * (1. - cr * .35); s.a = mix(s.a, uC2, smoothstep(.6, .9, fbmU(uv, 9., 3)) * wear);
  s.h = grain * .45 + n * .2 - cr * .4; s.r = mix(uRough.x, uRough.y, 1. - grain * .5 + wear * .2); s.m = 0.; s.ao = mix(.6, 1., grain);
  return s;
}
S p_rubber(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 4.), tread = uP0.y;
  float n = fbmU(uv, 24., 4); float zig = abs(fract(uv.x * sc + abs(fract(uv.y * sc * .5) - .5) * 2.) - .5);
  float groove = tread * (1. - smoothstep(.1, .16, zig));
  s.a = mix(uC0, uC1, n); s.a *= 1. - groove * .3; s.h = n * .2 + (1. - groove) * .6; s.r = mix(uRough.x, uRough.y, n); s.m = 0.; s.ao = mix(.4, 1., 1. - groove);
  return s;
}
S p_carpet(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 4.), pat = uP0.y;
  float f = vnoise(uv * 256., vec2(256.)), f2 = vnoise(uv * 128. + 3., vec2(128.)); float n = fbmU(uv, sc, 4);
  vec3 col = mix(uC0, uC1, n); float d = 0.;
  if (pat > .5) { vec2 g = fract(uv * sc) - .5; d = smoothstep(.02, .0, abs(length(g) - .3)); col = mix(col, uC2, d); }
  s.a = col * (.85 + .3 * f); s.h = f * .5 + f2 * .3 + d * .1; s.r = 1.; s.m = 0.; s.ao = mix(.6, 1., f);
  return s;
}
S p_terrazzo(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 4.), chips = uP0.y, cs = uP0.z;
  vec3 w = worley(uv * sc * 3., vec2(sc * 3.)); float r = h21(vec2(w.z * 47., 5.));
  float inChip = (1. - smoothstep(cs * .8, cs, w.x)) * step(1. - chips, r * .999 + .0);
  vec3 cc = r < .33 ? uC1 : (r < .66 ? uC2 : uC3); float n = fbmU(uv, 10., 4);
  s.a = mix(uC0 * (.92 + .16 * n), cc * (.8 + .4 * h21(vec2(w.z * 13., 1.))), inChip);
  s.h = .5 + inChip * .04 + (n - .5) * .05; s.r = mix(uRough.x, uRough.y, n); s.m = 0.; s.ao = 1.;
  return s;
}
S p_lava(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 2.), cw = uP0.y, glow = uP0.z, crust = uP0.w, pulse = uP1.x;
  float n = fbmU(uv, sc * 2., 5); vec3 w = worley(uv * sc + (n - .5) * .5, vec2(sc)); float edge = w.y - w.x;
  float crack = 1. - smoothstep(cw * .5, cw * 1.6 + .03, edge);
  float inner = 1. - smoothstep(0., cw * .6 + .01, edge);
  vec3 rock = mix(uC0, uC1, n); rock *= .8 + .4 * fbmU(uv, 48., 3);
  s.a = mix(rock, uC2 * .3, crack * .7);
  float heat = clamp(crack * .55 + inner * .9 + (1. - crust) * .0, 0., 1.);
  float fl = .75 + .25 * fbmU(uv + vec2(0., .0), 16., 3);
  s.e = mix(uC2 * .35, uC3, inner) * heat * glow * fl;
  s.h = (1. - crack) * (.6 + n * .4) - crack * .3; s.r = mix(uRough.x, uRough.y, n); s.m = 0.; s.ao = mix(.5, 1., 1. - crack);
  return s;
}
S p_hex(vec2 uv){
  S s = mk(); float n = max(uP0.x, 2.), bord = uP0.y, glow = uP0.z, bev = uP0.w;
  vec2 p = uv * n * vec2(1., 1.1547); vec2 r = vec2(1., 1.7320508); vec2 h = r * .5;
  vec2 a = mod(p, r) - h, b = mod(p - h, r) - h; vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 ag = abs(g); float d = max(dot(ag, normalize(vec2(1., 1.7320508))), ag.x); // hex distance
  float edge = .5 - d; float body = smoothstep(bord * .5, bord * .5 + .03, edge);
  vec2 hid = floor(p / r + .5); float rnd = h21(mod(hid, vec2(n)) + 2.1);
  vec3 col = mix(uC0, uC1, rnd * .5) * (.9 + .15 * fbmU(uv, 20., 3));
  s.a = mix(uC2, col, body); s.h = smoothstep(bord * .5, bord * .5 + max(bev, .02), edge) * .8; s.r = mix(uRough.x, uRough.y, rnd); s.m = uMetal; s.ao = mix(.4, 1., body);
  s.e = uC3 * (1. - body) * glow;
  return s;
}
S p_hazard(vec2 uv){
  S s = mk(); float n = max(uP0.x, 2.), ang = uP0.y, wear = uP0.z;
  float st = step(.5, fract((uv.x + uv.y * (ang < .5 ? 1. : -1.)) * n)); float ns = fbmU(uv, 12., 4), n2 = fbmU(uv, 40., 3);
  vec3 col = mix(uC0, uC1, st); col = mix(col, uC2 * .6, smoothstep(.55, .85, ns) * wear); col *= .9 + .2 * n2;
  s.a = col; s.h = ns * .3 + n2 * .1; s.r = mix(uRough.x, uRough.y, ns); s.m = uMetal; s.ao = 1.;
  return s;
}
S p_asphalt(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 4.), agg = uP0.y, crk = uP0.z, lines = uP0.w;
  float n = fbmU(uv, sc, 5); vec3 w = worley(uv * 96., vec2(96.)); vec3 w2 = worley(uv * 48. + 3., vec2(48.));
  float ag = smoothstep(.4, .1, w.x) * step(1. - agg, h21(vec2(w.z * 61., 1.)));
  s.a = mix(uC0, uC1, n) * (.85 + .25 * h21(vec2(w2.z * 9., 3.))) ; s.a = mix(s.a, uC3 * (.7 + .6 * w.z), ag * .6);
  s.h = n * .4 + ag * .35 + w.x * .1; s.r = mix(uRough.x, uRough.y, n); s.m = 0.; s.ao = mix(.6, 1., n);
  if (crk > 0.) { vec3 c = worley(uv * 4. + n * .6, vec2(4.)); float cr = (1. - smoothstep(0., .035, c.y - c.x)) * crk; s.a *= 1. - cr * .7; s.h -= cr * .5; }
  if (lines > 0.) { float ln = (1. - smoothstep(.015, .02, abs(fract(uv.x * 2.) - .5 + .0))) * lines; s.a = mix(s.a, uC2, ln * smoothstep(.4, .7, n + .2)); }
  return s;
}
S p_crystal(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 2.), fac = uP0.y, veins = uP0.z, glow = uP0.w;
  vec3 w = worley(uv * sc * 2., vec2(sc * 2.)); float f = h21(vec2(w.z * 88., 4.)); float n = fbmU(uv, sc, 4);
  vec3 vv = worley(uv * sc + n * .4, vec2(sc)); float vein = (1. - smoothstep(0., .07, vv.y - vv.x)) * veins;
  s.a = mix(mix(uC0, uC1, f), uC2, vein); s.h = f * fac + n * .2; s.r = mix(uRough.x, uRough.y, f); s.m = 0.; s.ao = mix(.6, 1., f);
  s.e = mix(uC3 * .15, uC3, vein + f * .3) * glow * (.6 + .4 * n);
  return s;
}
S p_wood(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 2.), rings = uP0.y, knots = uP0.z, weather = uP0.w; bool vert = uP1.x > .5; if (vert) uv = uv.yx;
  vec2 gp = vec2(uv.x * 2., uv.y * sc); float warp = fbm2(gp * vec2(1., .3), vec2(2., sc * .3), 4); float g = fbm2(gp + vec2(warp * 3., 0.), vec2(2., sc), 5);
  float ring = .5 + .5 * sin((uv.y * rings + warp * 5.) * 6.2831); float t = clamp(ring * .6 + g * .5, 0., 1.);
  s.a = mix(uC0, uC1, t); if (knots > 0.) { vec3 w = worley(uv * vec2(2., sc * .5), vec2(2., sc * .5)); float k = smoothstep(.22, .0, w.x) * step(1. - knots, h21(vec2(w.z * 33., 8.))); s.a = mix(s.a, uC1 * .3, k); ring += k; }
  s.a = mix(s.a, s.a * .55 + .05, weather * smoothstep(.4, .8, fbmU(uv, 6., 4)));
  s.h = ring * .1 + g * .15; s.r = mix(uRough.x, uRough.y, g); s.m = 0.; s.ao = 1.;
  return s;
}
S p_scales(vec2 uv){
  S s = mk(); float rows = max(uP0.x, 2.), cols = max(uP0.y, 2.), rd = uP0.z, vr = uP0.w;
  vec2 c = uv * vec2(cols, rows); float row = floor(c.y); c.x += mod(row, 2.) * .5; vec2 id = floor(c), f = fract(c);
  float d = length((f - vec2(.5, 1.)) * vec2(1., .9)); float shape = smoothstep(.55, .5, d + (1. - f.y) * .0) ; float tone = h21(mod(id, vec2(cols, rows)) + 1.7);
  s.a = mix(uC0, uC1, tone * vr) * (.85 + .3 * fbmU(uv, 20., 3)) * (.7 + .3 * f.y); s.h = f.y * .7 + shape * .2; s.r = mix(uRough.x, uRough.y, tone); s.m = 0.; s.ao = mix(.4, 1., f.y);
  return s;
}
S p_bark(vec2 uv){
  S s = mk(); float sc = max(uP0.x, 2.), dep = uP0.y, moss = uP0.z;
  float n = fbm2(vec2(uv.x * sc * 3., uv.y * sc), vec2(sc * 3., sc), 5); float w = worley(vec2(uv.x * sc * 4., uv.y * sc * .6), vec2(sc * 4., sc * .6)).y - worley(vec2(uv.x * sc * 4., uv.y * sc * .6), vec2(sc * 4., sc * .6)).x;
  float fis = 1. - smoothstep(0., .18, w); s.a = mix(uC0, uC1, n) * (1. - fis * .6); s.h = n * .7 - fis * dep; s.r = mix(uRough.x, uRough.y, n); s.m = 0.; s.ao = 1. - fis * .6;
  if (moss > 0.) { float mn = smoothstep(.55, .8, fbmU(uv, 5., 4)) * moss; s.a = mix(s.a, uCMoss * .7, mn); s.r = mix(s.r, .95, mn); }
  return s;
}
${custom}
S pattern(vec2 uv){
  if (uPattern == 0) return p_noise(uv); if (uPattern == 1) return p_planks(uv); if (uPattern == 2) return p_bricks(uv); if (uPattern == 3) return p_stone(uv);
  if (uPattern == 4) return p_tiles(uv); if (uPattern == 5) return p_plates(uv); if (uPattern == 6) return p_corrugated(uv); if (uPattern == 7) return p_diamond(uv);
  if (uPattern == 8) return p_rock(uv); if (uPattern == 9) return p_snow(uv); if (uPattern == 10) return p_ice(uv); if (uPattern == 11) return p_gravel(uv);
  if (uPattern == 12) return p_dirt(uv); if (uPattern == 13) return p_weave(uv); if (uPattern == 14) return p_quilt(uv); if (uPattern == 15) return p_leather(uv);
  if (uPattern == 16) return p_rubber(uv); if (uPattern == 17) return p_carpet(uv); if (uPattern == 18) return p_terrazzo(uv); if (uPattern == 19) return p_lava(uv);
  if (uPattern == 20) return p_hex(uv); if (uPattern == 21) return p_hazard(uv); if (uPattern == 22) return p_asphalt(uv); if (uPattern == 23) return p_crystal(uv);
  if (uPattern == 24) return p_wood(uv); if (uPattern == 25) return p_scales(uv); if (uPattern == 26) return p_bark(uv);
  ${custom ? 'return p_custom(uv);' : 'return p_noise(uv);'}
}

// ------------------------------------------------------------------ wear / weathering layers
void layers(inout S s, vec2 uv){
  float edgeM = smoothstep(.62, .95, s.h);
  if (uLA.x > 0.) { // rust
    float n = fbmU(uv, 6., 5), n2 = vnoise(uv * 48., vec2(48.));
    float m = smoothstep(1. - uLA.x, 1. - uLA.x + .22, n * .75 + n2 * .28 + edgeM * .18 + (1. - s.ao) * .25);
    vec3 rc = mix(uCRust * .55, uCRust * 1.25, n2); s.a = mix(s.a, rc, m); s.m = mix(s.m, 0., m * .92); s.r = mix(s.r, .88, m); s.h += m * (n2 - .6) * .22; s.e *= 1. - m;
  }
  if (uLA.y > 0.) { // moss / algae in cavities
    float n = fbmU(uv, 5., 5); float m = smoothstep(1. - uLA.y, 1. - uLA.y + .2, n + (1. - s.h) * .35 + (1. - s.ao) * .2);
    s.a = mix(s.a, uCMoss * (.6 + .6 * vnoise(uv * 64., vec2(64.))), m * .85); s.r = mix(s.r, .93, m); s.m *= 1. - m; s.h += m * .06;
  }
  if (uLA.z > 0.) { // grime: cavities + vertical drips
    float n = fbmU(uv, 7., 4); float dr = vnoise(vec2(uv.x * 36., uv.y * 3.), vec2(36., 3.));
    float m = clamp((1. - s.h) * .7 + n * .5 + smoothstep(.55, .9, dr) * .35, 0., 1.) * uLA.z;
    s.a *= 1. - m * .55; s.r = mix(s.r, .9, m * .5); s.ao *= 1. - m * .3;
  }
  if (uLA.w > 0.) { // scratches
    float sc = 0.; for (int i = 0; i < 3; i++) { float fi = float(i); float ang = h21(vec2(fi, 9.)) * 3.14159; vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (uv * 3. + vec2(fi * .37, 0.)); float v = vnoise(vec2(q.x * 3., q.y * 220.), vec2(1e4)); sc = max(sc, smoothstep(.93, .99, v)); }
    sc *= uLA.w; s.a = mix(s.a, s.a * 1.5 + .05, sc * .7); s.r = mix(s.r, s.r * .5, sc); s.h -= sc * .06;
  }
  if (uLB.x > 0.) { // edge wear: exposed base metal / lighter on high points
    float m = smoothstep(.7, 1., s.h + (fbmU(uv, 30., 3) - .5) * .3) * uLB.x; s.a = mix(s.a, vec3(.55, .55, .56), m * .6); s.m = mix(s.m, 1., m * .6); s.r = mix(s.r, .35, m);
  }
  if (uLB.y > 0.) { // wet: puddle-ish darkening + gloss
    float w = smoothstep(.35, .7, fbmU(uv, 3., 4) + (1. - s.h) * .3) * uLB.y; s.a *= 1. - w * .42; s.r = mix(s.r, .06, w); s.ao = mix(s.ao, 1., w * .5);
  }
  if (uLB.z > 0.) { // frost
    float f = smoothstep(.4, .8, fbmU(uv, 12., 4) + s.h * .2) * uLB.z; float cr = vnoise(uv * 200., vec2(200.)); s.a = mix(s.a, vec3(.82, .9, .97) * (.85 + .3 * cr), f * .85); s.r = mix(s.r, .35, f); s.m *= 1. - f; s.h += f * .08 * cr;
  }
  if (uLB.w > 0.) { // dust
    float d = smoothstep(.3, .8, fbmU(uv, 9., 4)) * uLB.w * smoothstep(.25, .85, s.h); s.a = mix(s.a, vec3(.42, .39, .35), d * .55); s.r = mix(s.r, .95, d);
  }
  if (uLC.x > 0.) { // long vertical streak stains
    float st = vnoise(vec2(uv.x * 28., uv.y * 1.5), vec2(28., 1.5)) * vnoise(vec2(uv.x * 9. + 2., uv.y * 2.), vec2(9., 2.)); float m = smoothstep(.22, .5, st) * uLC.x; s.a *= 1. - m * .5; s.r = mix(s.r, .35, m * .3);
  }
  if (uLC.y > 0.) { // cracks
    vec3 w = worley(uv * 5. + fbmU(uv, 4., 3) * .5, vec2(5.)); float cr = (1. - smoothstep(0., .028, w.y - w.x)) * uLC.y; s.a *= 1. - cr * .65; s.h -= cr * .35; s.ao *= 1. - cr * .5;
  }
  if (uLC.z > 0.) { // glitter
    float g = step(.985, h21(floor(uv * uSize * .5) + 3.3)) * uLC.z; s.a += g * .35; s.r = mix(s.r, .05, g);
  }
  if (uLC.w > 0.) { // oil sheen
    float o = smoothstep(.55, .8, fbmU(uv + .13, 4., 4)) * uLC.w; s.a *= 1. - o * .35; s.r = mix(s.r, .08, o);
  }
}
S surf(vec2 uv){ S s = pattern(fract(uv)); layers(s, fract(uv)); s.h = clamp(s.h, 0., 1.); return s; }

void main(){
  S s = surf(vUv);
  float ao = mix(1., clamp(s.ao, 0., 1.), uAOAmt);
  oAlb = vec4(max(s.a, 0.), s.h);
  oOrm = vec4(ao, clamp(s.r, .03, 1.), clamp(s.m, 0., 1.), 1.);
  ${emissive ? 'oEmi = vec4(max(s.e, 0.), 1.);' : ''}
}`, layerMask);
}

// The layers a material does not use are compiled out (each `if (uLX.c > 0.)` gets a constant in front): the compiler drops
// their code, and a program with two layers in it compiles several times faster than one with all twelve.
const LAYER_UNIFORMS = ['uLA.x', 'uLA.y', 'uLA.z', 'uLA.w', 'uLB.x', 'uLB.y', 'uLB.z', 'uLB.w', 'uLC.x', 'uLC.y', 'uLC.z', 'uLC.w'];
function gateLayers(src, mask) {
  if (mask < 0) return src;
  let out = src;
  LAYER_UNIFORMS.forEach((u, i) => {
    const on = (mask >> i) & 1;
    out = out.split(`if (${u} > 0.)`).join(`if (${on ? 'true' : 'false'} && ${u} > 0.)`);
  });
  return out;
}


// Pass B: converts the half-float bake into final 8-bit maps and derives the normal map from the height channel.
export const CONVERT_FS = /* glsl */`
precision highp float; precision highp int;
in vec2 vUv;
layout(location = 0) out highp vec4 oAlb;
layout(location = 1) out highp vec4 oNrm;
layout(location = 2) out highp vec4 oOrm;
#ifdef EMISSIVE
layout(location = 3) out highp vec4 oEmi;
#endif
uniform sampler2D tA; uniform sampler2D tO;
#ifdef EMISSIVE
uniform sampler2D tE;
#endif
uniform float uSize; uniform float uTileM; uniform float uBump;
float H(ivec2 p){ int n = int(uSize); return texelFetch(tA, ivec2((p.x % n + n) % n, (p.y % n + n) % n), 0).a; }
void main(){
  ivec2 p = ivec2(vUv * uSize);
  vec4 a = texelFetch(tA, p, 0);
  float hl = H(p + ivec2(-1, 0)), hr = H(p + ivec2(1, 0)), hd = H(p + ivec2(0, -1)), hu = H(p + ivec2(0, 1));
  float hl2 = H(p + ivec2(-2, 0)), hr2 = H(p + ivec2(2, 0)), hd2 = H(p + ivec2(0, -2)), hu2 = H(p + ivec2(0, 2));
  float k = uBump * 0.001 / uTileM;
  vec2 slope = vec2((hr - hl) * .75 + (hr2 - hl2) * .125, (hu - hd) * .75 + (hu2 - hd2) * .125) * uSize * k * .5;
  vec3 n = normalize(vec3(-slope, 1.));
  oAlb = vec4(a.rgb, 1.);
  oNrm = vec4(n * .5 + .5, 1.);
  oOrm = texelFetch(tO, p, 0);
  #ifdef EMISSIVE
  oEmi = texelFetch(tE, p, 0);
  #endif
}`;
