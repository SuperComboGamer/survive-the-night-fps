// WebGL renderer, cameras, world + viewmodel scenes and the post-process chain:
// world -> [SSAO + sun shafts applied in place, see post.js] -> viewmodel -> bloom (bright pass ->
// separable blur at 1/4 res) -> final pass (ACES tonemap, film grain, vignette, horror color grade,
// damage / low-health / infected vision).
//
// PS1 mode (setPs1, the "PS1 shader" setting) draws the same chain the way a 1995 console would have: a frame of
// about 250 lines scaled up with hard pixels, no anti-aliasing (so no AO, sun shafts or flashlight beam either:
// they read the resolved depth), vertices snapped to the pixel grid and thicker fog (both in globals.js), and
// 15-bit colour through the console's ordered dither in the final pass.
import * as THREE from 'three';
import { ScreenPasses } from './post.js';
import { G } from './globals.js';

// Quality presets. Knobs read by other modules:
//  shadows / shadowMapSize (per cascade, 2 cascades) / shadowDist (m): cascaded sun shadows
//  foliageShadows: bushes & rocks cast · charShadows: zombies & players cast · flashShadows: flashlight shadow map
//  grass: density multiplier · treeDist: tree/rock draw radius (m) · ao: 0 off, 1 SSAO, 2 SSAO 12 taps · godrays
//  maxPixelRatio: cap on the device pixel ratio (the render-scale setting multiplies it)
const QUALITY = {
  low: { label: 'Low', maxPixelRatio: 0.75, samples: 0, shadows: false, shadowMapSize: 1024, shadowDist: 0, foliageShadows: false, charShadows: false, flashShadows: false, bloom: false, ao: 0, godrays: false, grass: 0.45, treeDist: 130 },
  medium: { label: 'Medium', maxPixelRatio: 1, samples: 4, shadows: true, shadowMapSize: 1024, shadowDist: 65, foliageShadows: false, charShadows: false, flashShadows: false, bloom: true, ao: 0, godrays: true, grass: 0.8, treeDist: 180 },
  high: { label: 'High', maxPixelRatio: 1.5, samples: 4, shadows: true, shadowMapSize: 2048, shadowDist: 120, foliageShadows: true, charShadows: true, flashShadows: true, bloom: true, ao: 1, godrays: true, grass: 1.2, treeDist: 240 },
  ultra: { label: 'Ultra', maxPixelRatio: 2, samples: 4, shadows: true, shadowMapSize: 3072, shadowDist: 170, foliageShadows: true, charShadows: true, flashShadows: true, bloom: true, ao: 2, godrays: true, grass: 1.6, treeDist: 300 },
};
// legacy alias used by older call sites
for (const q of Object.values(QUALITY)) q.sunShadows = q.shadows;

// Zombies mode's own preset: everything on, full resolution
const MINE_QUALITY = { label: 'Shaft Nine', maxPixelRatio: 2, samples: 4, shadows: true, shadowMapSize: 2048, shadowDist: 60, foliageShadows: false, charShadows: true, flashShadows: true, bloom: true, ao: 2, godrays: true, grass: 0, treeDist: 0 };
const PS1_LINES = 256; // frame height aimed for in PS1 mode (the real one is the nearest whole-pixel scale: 240 at 720p, 270 at 1080p)
const PS1_FOG = 1.2; // extra fog in PS1 mode: optical depth x2.2, so about two thirds of the view distance

const BLOOM_BRIGHT = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uThreshold;
uniform sampler2D tAdapt;
varying vec2 vUv;
void main() {
  // 4-tap box downsample, then a soft-knee threshold on luminance
  vec3 c = texture2D(tScene, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c = c * 0.25 * uExposure * texture2D(tAdapt, vec2(0.5)).r;
  float l = max(max(c.r, c.g), c.b);
  float knee = uThreshold * 0.6;
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * w, vec3(24.0)), 1.0);
}
`;
const BLOOM_BLUR = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
  c += texture2D(tSrc, vUv + uDir * 1.3846153).rgb * 0.3162162;
  c += texture2D(tSrc, vUv - uDir * 1.3846153).rgb * 0.3162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692).rgb * 0.0702703;
  c += texture2D(tSrc, vUv - uDir * 3.2307692).rgb * 0.0702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

// Eye adaptation: log-luminance of the scene (centre-weighted) into a 64x64 mip chain, then a 1x1
// ping-pong target eases the exposure multiplier towards (reference / average)^0.4, clamped, so the
// keyframed time-of-day exposure stays in charge and only dense forest / bright sky are compensated.
const LUM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  vec2 d = vUv - 0.5;
  float w = exp(-dot(d, d) * 5.0);
  gl_FragColor = vec4(log(l) * w, w, 0.0, 1.0);
}
`;
const ADAPT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float uRef;
uniform float uBlend;
uniform vec2 uRange;
varying vec2 vUv;
void main() {
  vec2 s = textureLod(tLum, vec2(0.5), 6.0).rg;
  float avg = exp(s.x / max(s.y, 1e-4));
  float target = clamp(pow(uRef / avg, 0.4), uRange.x, uRange.y);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  gl_FragColor = vec4(mix(prev, target, uBlend), avg, 0.0, 1.0);
}
`;

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const POST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uTime;
uniform float uNight;
uniform float uDamage;
uniform float uLowHealth;
uniform float uInfected;
uniform float uDead;
uniform float uExposure;
uniform sampler2D tAdapt;
uniform vec2 uRes;
uniform float uPs1;
uniform float uClean; // Zombies mode: no grain, no colour fringing, no flicker, a gentler grade
varying vec2 vUv;

// the PlayStation's 4x4 dither offsets (in 8-bit steps), added before the colour is cut to 5 bits a channel
const mat4 PS1_DITHER = mat4(-4.0, 0.0, -3.0, 1.0, 2.0, -2.0, 3.0, -1.0, -3.0, 1.0, -4.0, 0.0, 3.0, -1.0, 2.0, -2.0);
vec3 ps1Color(vec3 c) {
  ivec2 p = ivec2(gl_FragCoord.xy) & 3;
  return floor(clamp(c * 255.0 + PS1_DITHER[p.y][p.x], 0.0, 255.0) / 8.0) / 31.0;
}

vec3 aces(vec3 x) {
  const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  // chromatic aberration at the edges (more when hurt)
  float ca = (0.0015 * (1.0 - uClean) + uDamage * 0.008 + uDead * 0.004) * r2 * 4.0;
  vec3 col;
  col.r = texture2D(tScene, uv + cc * ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - cc * ca).b;
  col *= uExposure * texture2D(tAdapt, vec2(0.5)).r;
  // bloom: fires, flares, muzzle flashes, lamps and the low sun glow
  col += texture2D(tBloom, uv).rgb * uBloom;
  col = aces(col);
  // horror grade: desaturate, cold teal shadows, sickly highlights
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  float desat = (0.2 + uNight * 0.2) * (1.0 - 0.85 * uClean) + uLowHealth * 0.45 + uDead * 0.5;
  col = mix(col, vec3(l), desat);
  vec3 shadowTint = vec3(0.86, 0.98, 1.06);
  vec3 highTint = vec3(1.04, 1.0, 0.9);
  col *= mix(vec3(1.0), mix(shadowTint, highTint, smoothstep(0.1, 0.7, l)), 1.0 - 0.8 * uClean);
  col = pow(col, vec3(1.05)); // contrast
  // lift the deepest shadows a hair so night silhouettes still read
  col = col * 0.97 + vec3(0.006, 0.007, 0.009);
  // infected (zombie) vision: red-shifted, high contrast
  if (uInfected > 0.0) {
    float li = dot(col, vec3(0.3, 0.59, 0.11));
    vec3 z = vec3(li * 1.5 + 0.03, li * 0.55, li * 0.5);
    col = mix(col, z, uInfected * 0.85);
  }
  // low health: pulsing red edges
  float pulse = 0.6 + 0.4 * sin(uTime * 6.0);
  float edge = smoothstep(0.12, 0.5, r2 * 2.2);
  col = mix(col, vec3(0.35, 0.0, 0.0), edge * uLowHealth * 0.55 * pulse);
  col = mix(col, vec3(0.5, 0.02, 0.02), edge * uDamage * 0.75);
  // vignette
  float vig = smoothstep(0.85, 0.2, r2 * (1.6 + uNight * 0.6));
  col *= mix(mix(0.35, 0.8, uClean), 1.0, vig);
  // film grain + subtle flicker
  float g = hash(uv * uRes + fract(uTime * 13.7) * 100.0) - 0.5;
  // (PS1 mode: far less of it. At that size a grain is a blob, and it would bury the dither pattern)
  col += g * (0.022 + uNight * 0.012 + uLowHealth * 0.02) * (1.0 - l * 0.5) * (1.0 - 0.7 * uPs1) * (1.0 - uClean);
  col *= 1.0 - 0.015 * (1.0 - uClean) * (0.5 - 0.5 * sin(uTime * 37.0));
  // dead: fade to dark red
  col = mix(col, col * vec3(0.5, 0.1, 0.1), uDead * 0.6);
  col = toSRGB(clamp(col, 0.0, 1.0));
  if (uPs1 > 0.5) col = ps1Color(col);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class GameRenderer {
  constructor(container, quality = 'medium') {
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.type = THREE.PCFShadowMap; // r186: Vogel-disc PCF (PCFSoft was removed)
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 520);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(68, 1, 0.01, 20);
    this.vmHemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
    this.vmDir = new THREE.DirectionalLight(0xffffff, 1);
    this.vmDir.position.set(-0.4, 1, 0.6); // from above, behind the left shoulder: lights the sides the player sees
    this.vmFlash = new THREE.PointLight(0xfff1d6, 0, 3, 1.5);
    this.vmFlash.position.set(-0.05, 0.12, 0.15); // flashlight spill: from the player's side, so the hands in the beam light up
    this.vmMuzzle = new THREE.PointLight(0xffb060, 0, 3, 1.5);
    this.vmMuzzle.position.set(0.2, -0.1, -1.0);
    this.vmScene.add(this.vmHemi, this.vmDir, this.vmFlash, this.vmMuzzle);

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uBloom: { value: 0 },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uDamage: { value: 0 },
        uLowHealth: { value: 0 },
        uInfected: { value: 0 },
        uDead: { value: 0 },
        uExposure: { value: 1 },
        tAdapt: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uPs1: { value: 0 },
        uClean: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new THREE.Mesh(tri, this.postMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.quad = quad;
    // bloom chain
    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: BLOOM_BRIGHT,
      uniforms: { tScene: { value: null }, uTexel: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uThreshold: { value: 0.9 }, tAdapt: { value: null } },
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: BLOOM_BLUR,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    const bopt = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this.bloomA = new THREE.WebGLRenderTarget(4, 4, bopt);
    this.bloomB = new THREE.WebGLRenderTarget(4, 4, bopt);
    this.bloomC = new THREE.WebGLRenderTarget(4, 4, bopt);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.postMat.uniforms.tBloom.value = this.black;
    // eye adaptation
    this.lumRT = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const aopt = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.adapt = [new THREE.WebGLRenderTarget(1, 1, aopt), new THREE.WebGLRenderTarget(1, 1, aopt)];
    this.adaptIdx = 0;
    this.adaptReset = true;
    this.lumMat = new THREE.ShaderMaterial({ vertexShader: POST_VERT, fragmentShader: LUM_FRAG, uniforms: { tScene: { value: null } }, depthTest: false, depthWrite: false });
    this.adaptMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: ADAPT_FRAG,
      uniforms: { tLum: { value: this.lumRT.texture }, tPrev: { value: null }, uRef: { value: 0.1 }, uBlend: { value: 1 }, uRange: { value: new THREE.Vector2(0.7, 1.6) } },
      depthTest: false,
      depthWrite: false,
    });
    this.one = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.one.needsUpdate = true;
    this.adaptTex = this.one;

    this.passes = new ScreenPasses(renderer, quad, this.postScene, this.postCamera);
    this.rt = null;
    this.quality = null;
    this.renderScale = 1;
    this.ps1 = false;
    this.setQuality(quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.stats = { calls: 0, tris: 0 };
  }

  get q() {
    return this.mine ? MINE_QUALITY : QUALITY[this.quality];
  }

  // Zombies mode draws at the best the machine can do (full device resolution up to 2x, 4x MSAA, flashlight shadows,
  // SSAO) with a clean image: no grain, fringing or flicker (the post pass's uClean)
  setMine(on) {
    on = !!on;
    if (on === !!this.mine) return;
    this.mine = on;
    this.postMat.uniforms.uClean.value = on ? 1 : 0;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this._makeTarget();
    this.resize();
  }

  setQuality(q) {
    if (!QUALITY[q]) q = 'medium';
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this._makeTarget();
    this.resize();
  }

  // fraction of the preset's resolution (0.5..1)
  setRenderScale(s) {
    s = Math.max(0.5, Math.min(1, +s || 1));
    if (s === this.renderScale) return;
    this.renderScale = s;
    this.resize();
  }

  // PS1 mode on/off (see the top of this file). The frame size is then its own: quality's pixel ratio and the
  // render scale do not apply.
  setPs1(on) {
    on = !!on;
    if (on === this.ps1) return;
    this.ps1 = on;
    this.canvas.style.imageRendering = on ? 'pixelated' : '';
    this.postMat.uniforms.uPs1.value = on ? 1 : 0;
    this._makeTarget();
    this.resize();
  }

  // Can the scene target use packed-float HDR (R11G11B10F) at this MSAA sample count? Probed once per
  // count; renderers without float render targets or multisampled packed floats keep RGBA16F.
  _packedHdr(samples) {
    this._packed ??= new Map();
    if (this._packed.has(samples)) return this._packed.get(samples);
    const gl = this.renderer.getContext();
    let ok = this.renderer.capabilities.isWebGL2 && this.renderer.extensions.has('EXT_color_buffer_float');
    if (ok && samples > 0) {
      const counts = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.R11F_G11F_B10F, gl.SAMPLES);
      ok = !!counts && counts.length > 0 && Math.max(...counts) >= samples;
    }
    if (ok) {
      const tex = gl.createTexture();
      const fb = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R11F_G11F_B10F, 4, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      this.renderer.resetState(); // the probe bypassed three's GL state cache
    }
    this._packed.set(samples, ok);
    return ok;
  }

  _makeTarget() {
    if (this.rt) this.rt.dispose();
    const isWebGL2 = this.renderer.capabilities.isWebGL2;
    const samples = isWebGL2 && !this.ps1 ? this.q.samples : 0;
    // The scene target never needs alpha, so it is packed-float HDR where supported: half the memory
    // traffic of RGBA16F, which dominates the cost of the 4x MSAA target (identical to within 2/255
    // after tone mapping).
    const packed = this._packedHdr(samples);
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: packed ? THREE.UnsignedInt101111Type : THREE.HalfFloatType,
      format: packed ? THREE.RGBFormat : THREE.RGBAFormat,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
      // the resolved world depth feeds SSAO / sun shafts (only with MSAA: without it the depth texture
      // is the live depth attachment and could not be sampled while applying them in place)
      depthTexture: samples > 0 ? new THREE.DepthTexture(4, 4) : null,
      resolveDepthBuffer: samples > 0,
    });
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.postMat.uniforms.tScene.value = this.rt.texture;
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    // PS1 mode: every pixel of the frame is a whole number of screen pixels, so the scaled-up image stays even
    const pr = this.ps1 ? dpr / Math.max(1, Math.round((h * dpr) / PS1_LINES)) : Math.min(dpr, this.q.maxPixelRatio) * (this.mine ? 1 : this.renderScale);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    const pw = Math.floor(w * pr);
    const ph = Math.floor(h * pr);
    this.rt.setSize(pw, ph);
    this.passes.setSize(pw, ph);
    this.postMat.uniforms.uRes.value.set(pw, ph);
    if (this.ps1) G.uPs1.value.set(pw / 2, ph / 2, PS1_FOG, 0);
    else G.uPs1.value.set(0, 0, 0, 0);
    // bloom at half (bright pass) and quarter (blur) resolution of the CSS size
    const bw = Math.max(4, Math.floor(w / 2));
    const bh = Math.max(4, Math.floor(h / 2));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(Math.max(4, bw >> 1), Math.max(4, bh >> 1));
    this.bloomC.setSize(Math.max(4, bw >> 1), Math.max(4, bh >> 1));
    this.brightMat.uniforms.uTexel.value.set(0.5 / pw, 0.5 / ph);
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.postScene, this.postCamera);
  }

  _bloom(exposure, strength) {
    const bm = this.brightMat.uniforms;
    bm.tScene.value = this.rt.texture;
    bm.uExposure.value = exposure;
    bm.tAdapt.value = this.adaptTex;
    this._pass(this.brightMat, this.bloomA);
    const u = this.blurMat.uniforms;
    const bw = this.bloomB.width;
    const bh = this.bloomB.height;
    // two H/V iterations with a growing radius: tight core + wide glow
    u.tSrc.value = this.bloomA.texture;
    u.uDir.value.set(1 / this.bloomA.width, 0);
    this._pass(this.blurMat, this.bloomB);
    u.tSrc.value = this.bloomB.texture;
    u.uDir.value.set(0, 1 / bh);
    this._pass(this.blurMat, this.bloomC);
    u.tSrc.value = this.bloomC.texture;
    u.uDir.value.set(2.2 / bw, 0);
    this._pass(this.blurMat, this.bloomB);
    u.tSrc.value = this.bloomB.texture;
    u.uDir.value.set(0, 2.2 / bh);
    this._pass(this.blurMat, this.bloomC);
    this.postMat.uniforms.tBloom.value = this.bloomC.texture;
    this.postMat.uniforms.uBloom.value = strength;
  }

  // eases the adapted exposure multiplier; ref = the average scene luminance the keyframed exposure
  // was tuned for (the renderer's caller derives it from the light levels)
  _adaptExposure(post) {
    if (!(post.adaptRef > 0)) {
      this.adaptTex = this.one;
      this.adaptReset = true;
      return;
    }
    this.lumMat.uniforms.tScene.value = this.rt.texture;
    this._pass(this.lumMat, this.lumRT);
    const prev = this.adapt[this.adaptIdx];
    this.adaptIdx ^= 1;
    const next = this.adapt[this.adaptIdx];
    const u = this.adaptMat.uniforms;
    u.tPrev.value = this.adaptReset ? this.one : prev.texture;
    u.uRef.value = post.adaptRef;
    // brighten slowly (eyes adjusting to the dark), darken faster
    u.uBlend.value = this.adaptReset ? 1 : 1 - Math.exp(-(post.dt || 0.016) * 1.2);
    this._pass(this.adaptMat, next);
    this.adaptReset = false;
    this.adaptTex = next.texture;
  }

  /** Debug: current adapted exposure multiplier (GPU readback, slow). */
  readAdapt() {
    if (this.adaptTex === this.one) return 1;
    const buf = new Uint16Array(4);
    this.renderer.readRenderTargetPixels(this.adapt[this.adaptIdx], 0, 0, 1, 1, buf);
    this.debugAvgLum = THREE.DataUtils.fromHalfFloat(buf[1]);
    return THREE.DataUtils.fromHalfFloat(buf[0]);
  }

  // Starts building the shader program of every material in the world scene, the viewmodel scene and the post
  // passes this quality runs, without waiting for any of them (Game.prewarm): the driver compiles and links in
  // the background (KHR_parallel_shader_compile) and only the first USE of a program waits for it. A program's
  // cache key holds its scene's lights and fog and the colour space of the target it is drawn into, so each
  // scene is compiled as itself and against the same kind of target as in render(), or these would be programs
  // nobody uses.
  compilePrograms() {
    const r = this.renderer;
    const p = this.passes;
    const q = this.q;
    r.setRenderTarget(this.rt);
    r.compile(this.scene, this.camera);
    r.compile(this.vmScene, this.vmCamera);
    const mats = [this.lumMat, this.adaptMat];
    if (q.bloom) mats.push(this.brightMat, this.blurMat);
    if (this.rt.depthTexture) {
      if (q.ao) mats.push(p.aoMat, p.aoBlur);
      if (q.godrays) mats.push(p.maskMat, p.rayBlur, p.beamMat);
      if (q.ao || q.godrays) mats.push(p.applyMat);
    }
    for (const m of mats) {
      this.quad.material = m;
      r.compile(this.postScene, this.postCamera);
    }
    this.quad.material = this.postMat;
    r.setRenderTarget(null); // the final pass is the only one drawn to the canvas
    r.compile(this.postScene, this.postCamera);
  }

  // The shadow passes draw each caster with a depth material of three's own, so their programs cannot be started
  // through the casters' materials. A stand-in can: a depth material in the state WebGLShadowMap gives its own for
  // that mesh (sides swapped, the texture and alpha test of the mesh's material), worn by the mesh for one
  // compile(). Same cache key, so the shadow pass finds its program built. casters: the meshes that cast.
  compileDepth(casters) {
    const r = this.renderer;
    if (!r.shadowMap.enabled) return;
    const flip = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
    this._depth ??= new Map(); // material -> its stand-in
    const worn = casters.map((o) => {
      const m = o.material;
      if (Array.isArray(m)) return m; // (none today: its programs would be built by the warm frame instead)
      let d = o.customDepthMaterial || this._depth.get(m);
      if (!d) this._depth.set(m, (d = new THREE.MeshDepthMaterial()));
      d.side = m.shadowSide ?? flip[m.side];
      d.map = m.map;
      d.alphaMap = m.alphaMap;
      d.alphaTest = m.alphaTest;
      o.material = d;
      return m;
    });
    // three draws the casters outside any scene: the world's lights still count, its fog does not. So compile()
    // gets the lights from the world scene, the materials from the casters alone and no fog from a bare scene.
    const root = { traverseVisible: (f) => this.scene.traverseVisible(f), traverse: (f) => casters.forEach(f) };
    r.setRenderTarget(this.rt);
    r.compile(root, this.camera, (this._bare ??= new THREE.Scene()));
    r.setRenderTarget(null);
    casters.forEach((o, i) => (o.material = worn[i]));
  }

  /** false while a program is still being built in the background */
  programsReady() {
    return this.renderer.info.programs.every((p) => p.isReady());
  }

  render(post, drawViewmodel = true) {
    const r = this.renderer;
    const u = this.postMat.uniforms;
    u.uTime.value = post.time;
    u.uNight.value = post.night;
    u.uDamage.value = post.damage;
    u.uLowHealth.value = post.lowHealth;
    u.uInfected.value = post.infected;
    u.uDead.value = post.dead;
    u.uExposure.value = post.exposure ?? 1;
    r.setRenderTarget(this.rt);
    r.autoClear = true;
    // three resolves the MSAA target after every render into it. Only the world's depth is ever sampled
    // (AO, sun shafts, beam), so the resolves after the in-place apply pass and the viewmodel are colour only.
    this.rt.resolveDepthBuffer = this.rt.samples > 0;
    r.render(this.scene, this.camera);
    this.rt.resolveDepthBuffer = false;
    this.stats.calls = r.info.render.calls;
    this.stats.tris = r.info.render.triangles;
    const q = this.q;
    if (this.rt.depthTexture) {
      this.passes.run(this.rt, this.camera, { ao: post.dead ? 0 : q.ao, rays: q.godrays ? post.rays : null, beam: q.godrays ? post.beam : null, exposure: post.exposure ?? 1 });
    }
    this._adaptExposure(post); // before the viewmodel so the hands don't bias the metering
    if (drawViewmodel) {
      r.setRenderTarget(this.rt);
      r.autoClear = false;
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
      r.autoClear = true;
    }
    u.tAdapt.value = this.adaptTex;
    if (this.q.bloom) this._bloom(post.exposure ?? 1, this.mine ? 0.1 : 0.32 + post.night * 0.18);
    else {
      u.tBloom.value = this.black;
      u.uBloom.value = 0;
    }
    this.quad.material = this.postMat;
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
  }
}

export { QUALITY };
