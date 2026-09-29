// WebGL renderer, cameras, world + viewmodel scenes and the post-process chain:
// bloom (bright pass -> separable blur at 1/4 res) and the final pass (ACES tonemap, film grain,
// vignette, horror color grade, damage / low-health / infected vision).
import * as THREE from 'three';

const QUALITY = {
  low: { pixelRatio: 0.75, samples: 0, shadows: false, sunShadows: false, bloom: false, grass: 0.4, treeDist: 130 },
  medium: { pixelRatio: 1, samples: 4, shadows: false, sunShadows: false, bloom: true, grass: 0.8, treeDist: 190 },
  high: { pixelRatio: 1.5, samples: 4, shadows: true, sunShadows: true, bloom: true, grass: 1.2, treeDist: 240 },
};

const BLOOM_BRIGHT = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  // 4-tap box downsample, then a soft-knee threshold on luminance
  vec3 c = texture2D(tScene, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tScene, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c = c * 0.25 * uExposure;
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
uniform vec2 uRes;
varying vec2 vUv;

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
  float ca = (0.0015 + uDamage * 0.008 + uDead * 0.004) * r2 * 4.0;
  vec3 col;
  col.r = texture2D(tScene, uv + cc * ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - cc * ca).b;
  col *= uExposure;
  // bloom: fires, flares, muzzle flashes, lamps and the low sun glow
  col += texture2D(tBloom, uv).rgb * uBloom;
  col = aces(col);
  // horror grade: desaturate, cold teal shadows, sickly highlights
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  float desat = 0.2 + uNight * 0.2 + uLowHealth * 0.45 + uDead * 0.5;
  col = mix(col, vec3(l), desat);
  vec3 shadowTint = vec3(0.86, 0.98, 1.06);
  vec3 highTint = vec3(1.04, 1.0, 0.9);
  col *= mix(shadowTint, highTint, smoothstep(0.1, 0.7, l));
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
  col *= mix(0.35, 1.0, vig);
  // film grain + subtle flicker
  float g = hash(uv * uRes + fract(uTime * 13.7) * 100.0) - 0.5;
  col += g * (0.022 + uNight * 0.012 + uLowHealth * 0.02) * (1.0 - l * 0.5);
  col *= 0.985 + 0.015 * sin(uTime * 37.0);
  // dead: fade to dark red
  col = mix(col, col * vec3(0.5, 0.1, 0.1), uDead * 0.6);
  gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
}
`;

export class GameRenderer {
  constructor(container, quality = 'medium') {
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
        uRes: { value: new THREE.Vector2(1, 1) },
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
      uniforms: { tScene: { value: null }, uTexel: { value: new THREE.Vector2() }, uExposure: { value: 1 }, uThreshold: { value: 0.9 } },
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

    this.rt = null;
    this.quality = null;
    this.setQuality(quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.stats = { calls: 0, tris: 0 };
  }

  get q() {
    return QUALITY[this.quality];
  }

  setQuality(q) {
    if (!QUALITY[q]) q = 'medium';
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.shadowMap.enabled = QUALITY[q].shadows;
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
    const samples = isWebGL2 ? QUALITY[this.quality].samples : 0;
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
      // nothing samples scene depth: skip blitting the multisampled depth buffer on every resolve
      resolveDepthBuffer: false,
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
    const pr = Math.min(window.devicePixelRatio || 1, 2) * QUALITY[this.quality].pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    const pw = Math.floor(w * pr);
    const ph = Math.floor(h * pr);
    this.rt.setSize(pw, ph);
    this.postMat.uniforms.uRes.value.set(pw, ph);
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
    r.render(this.scene, this.camera);
    this.stats.calls = r.info.render.calls;
    this.stats.tris = r.info.render.triangles;
    if (drawViewmodel) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
      r.autoClear = true;
    }
    if (this.q.bloom) this._bloom(post.exposure ?? 1, 0.32 + post.night * 0.18);
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
