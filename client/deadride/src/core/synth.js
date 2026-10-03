// GPU material synthesizer front-end. synth.make(def) bakes tileable PBR maps (albedo/normal/ORM[/emissive]) on the GPU.
//   def = { pattern:'planks', size:512, tile:2 (metres per tile), colors:[hex,...], rough:[min,max], metal:0, bump:3 (mm relief),
//           ao:.7, params:{rows:8,...}, layers:{rust:.3,grime:.4,...}, rustColor, mossColor, seed, emissive:bool, glsl:'S p_custom(vec2 uv){...}' }
//   synth.material(def, extra) -> patched MeshStandardMaterial with map/normalMap/ORM (+emissive) using real-world UV metres.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { PATTERNS, LAYERS, buildFragment, CONVERT_FS } from './synthGLSL.js';
import { std } from './mats.js';

const VS = /* glsl */`out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const col = (c) => new THREE.Color(c);
// a copy of a program's uniform values (a deferred bake has its own) and back
const snapshot = (U) => { const o = {}; for (const k in U) { const v = U[k].value; o[k] = v && v.clone ? v.clone() : v; } return o; };
const restore = (U, o) => { for (const k in o) { const v = o[k]; if (v && v.isColor) U[k].value.copy(v); else if (v && (v.isVector2 || v.isVector4)) U[k].value.copy(v); else U[k].value = v; } };

const GRAVEL_PATTERNS = new Set(['dirt', 'gravel', 'asphalt']);
export class Synth {
  constructor(renderer) {
    this.r = renderer; this.cache = new Map(); this.progs = new Map(); this.conv = new Map(); this.quad = new FullScreenQuad(); this.count = 0; this.aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    this.tmp = new Map(); // half-float scratch targets by size/emissive
    // defer: bakes are queued instead of drawn at once, and flush() builds every program they need in parallel first
    // (KHR_parallel_shader_compile) - the world turns it on while it builds a stop, so a stop's dozen or so pattern programs
    // compile side by side instead of one after another on the main thread
    this.defer = false; this.queue = [];
  }
  _conv(emissive) {
    let m = this.conv.get(emissive);
    if (!m) { m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: CONVERT_FS, defines: emissive ? { EMISSIVE: 1 } : {}, uniforms: { tA: { value: null }, tO: { value: null }, tE: { value: null }, uSize: { value: 512 }, uTileM: { value: 1 }, uBump: { value: 2 } }, depthTest: false, depthWrite: false }); this.conv.set(emissive, m); }
    return m;
  }
  _scratch(size, emissive) {
    const k = size + (emissive ? 'E' : 'e'); let rt = this.tmp.get(k);
    if (!rt) { rt = new THREE.WebGLRenderTarget(size, size, { count: emissive ? 3 : 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false }); this.tmp.set(k, rt); }
    return rt;
  }
  /** Compile the synth programs in the background (KHR_parallel_shader_compile) so the first bake does not stall the UI. */
  async warm(emissive = true) {
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
    // (the pattern programs are built per pattern as they are first used: only the conversion passes here)
    for (const e of emissive ? [false, true] : [false]) {
      for (const m of [this._conv(e)]) { const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), m); mesh.frustumCulled = false; scene.add(mesh); }
    }
    try { await this.r.compileAsync(scene, cam); } catch (e) { /* ignore */ }
  }
  // p0: for a custom GLSL that switches on its first parameter (it says so by testing SYNTH_P0), a program per value of it
  _prog(emissive, custom, pattern = -1, p0 = null, layerMask = -1) {
    const spec = custom && p0 !== null && custom.includes('SYNTH_P0');
    const key = (emissive ? 'E' : 'e') + pattern + ':' + layerMask + ':' + (spec ? p0 + ':' : '') + (custom || '');
    let m = this.progs.get(key);
    if (!m) {
      const U = { uPattern: { value: 0 }, uSeed: { value: 0 }, uSize: { value: 512 }, uTileM: { value: 1 }, uBump: { value: 2 }, uAOAmt: { value: .7 }, uP0: { value: new THREE.Vector4() }, uP1: { value: new THREE.Vector4() },
        uC0: { value: col(0x808080) }, uC1: { value: col(0x606060) }, uC2: { value: col(0x404040) }, uC3: { value: col(0xa0a0a0) }, uRough: { value: new THREE.Vector2(.5, .9) }, uMetal: { value: 0 },
        uLA: { value: new THREE.Vector4() }, uLB: { value: new THREE.Vector4() }, uLC: { value: new THREE.Vector4() }, uCRust: { value: col(0x8a3d16) }, uCMoss: { value: col(0x3d5a22) } };
      m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: buildFragment({ emissive, custom, pattern, layerMask }), defines: spec ? { SYNTH_P0: (+p0).toFixed(1) } : {}, uniforms: U, depthTest: false, depthWrite: false });
      this.progs.set(key, m);
    }
    return m;
  }
  make(def) {
    const key = JSON.stringify(def);
    if (this.cache.has(key)) return this.cache.get(key);
    const emissive = !!def.emissive || def.pattern === 'lava' || def.pattern === 'crystal' || def.pattern === 'hex' && (def.params?.glow > 0);
    const size = def.size || 512;
    const pat = PATTERNS[def.pattern || 'noise'] || PATTERNS.noise;
    // (layers compiled out per material for the built-in patterns and custom GLSL that opts in; a custom GLSL shared by many
    // materials - the guns' - stays one program with every layer, compiled once)
    let lmask = 0; if (def.layers) for (const [k, v] of Object.entries(def.layers)) { const i = LAYERS.indexOf(k); if (i >= 0 && v > 0) lmask |= 1 << i; }
    if (def.glsl && !def.glsl.includes('SYNTH_P0')) lmask = -1;
    const mat = this._prog(emissive, def.glsl || '', def.glsl && !def.pattern ? 99 : pat[0], def.p ? def.p[0] : null, lmask);
    const u = mat.uniforms;
    u.uPattern.value = def.glsl && !def.pattern ? 99 : pat[0]; u.uSeed.value = (def.seed ?? 0) * 7.13; u.uSize.value = size; u.uTileM.value = def.tile ?? 1; u.uBump.value = def.bump ?? 2; u.uAOAmt.value = def.ao ?? .7;
    const P = new Array(8).fill(0); const names = pat[1];
    if (def.params) for (const [k, v] of Object.entries(def.params)) { const i = names.indexOf(k); if (i >= 0) P[i] = +v; }
    if (def.p) def.p.forEach((v, i) => (P[i] = v));
    u.uP0.value.set(P[0], P[1], P[2], P[3]); u.uP1.value.set(P[4], P[5], P[6], P[7]);
    const cs = (def.colors || [0x808080]).map(col); while (cs.length < 4) cs.push(cs[cs.length - 1].clone());
    u.uC0.value.copy(cs[0]); u.uC1.value.copy(cs[1]); u.uC2.value.copy(cs[2]); u.uC3.value.copy(cs[3]);
    u.uRough.value.set(...(def.rough || [.5, .9])); u.uMetal.value = def.metal ?? 0;
    const L = new Array(12).fill(0); if (def.layers) for (const [k, v] of Object.entries(def.layers)) { const i = LAYERS.indexOf(k); if (i >= 0) L[i] = v; }
    u.uLA.value.set(L[0], L[1], L[2], L[3]); u.uLB.value.set(L[4], L[5], L[6], L[7]); u.uLC.value.set(L[8], L[9], L[10], L[11]);
    u.uCRust.value.copy(col(def.rustColor ?? 0x8a3d16)); u.uCMoss.value.copy(col(def.mossColor ?? 0x3d5a22));
    const n = emissive ? 4 : 3;
    const rt = new THREE.WebGLRenderTarget(size, size, { count: n, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false, stencilBuffer: false });
    rt.textures[0].colorSpace = THREE.SRGBColorSpace; if (n > 3) rt.textures[3].colorSpace = THREE.SRGBColorSpace;
    for (const t of rt.textures) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = this.aniso; t.repeat.set(1 / (def.tile ?? 1), 1 / (def.tile ?? 1)); }
    const set = { map: rt.textures[0], normalMap: rt.textures[1], orm: rt.textures[2], emissiveMap: n > 3 ? rt.textures[3] : null, tile: def.tile ?? 1, def, rt };
    this.cache.set(key, set); this.count++;
    const job = { mat, emissive, size, def, rt, u: snapshot(u) };
    if (this.defer) this.queue.push(job); else this._bake(job);
    return set;
  }
  _bake(job) {
    const { mat, emissive, size, def, rt } = job; restore(mat.uniforms, job.u);
    const r = this.r, prevRT = r.getRenderTarget(), prevAuto = r.autoClear;
    const scr = this._scratch(size, emissive);
    r.autoClear = false;
    this.quad.material = mat; r.setRenderTarget(scr); this.quad.render(r);            // pass A: pattern + layers (single evaluation)
    const cv = this._conv(emissive), cu = cv.uniforms; cu.tA.value = scr.textures[0]; cu.tO.value = scr.textures[1]; cu.tE.value = emissive ? scr.textures[2] : null;
    cu.uSize.value = size; cu.uTileM.value = def.tile ?? 1; cu.uBump.value = def.bump ?? 2;
    this.quad.material = cv; r.setRenderTarget(rt); this.quad.render(r);              // pass B: normals from height + 8-bit conversion
    r.setRenderTarget(prevRT); r.autoClear = prevAuto;
  }
  /** Bakes everything queued: first every program they need, compiled in parallel (awaited), then the draws. */
  async flush() {
    if (!this.queue.length) return;
    const jobs = this.queue.splice(0); const mats = new Set(); for (const j of jobs) { mats.add(j.mat); mats.add(this._conv(j.emissive)); }
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(), geo = new THREE.PlaneGeometry();
    for (const m of mats) { const q = new THREE.Mesh(geo, m); q.frustumCulled = false; scene.add(q); }
    try { await this.r.compileAsync(scene, cam); } catch (e) { /* built on first use below */ }
    geo.dispose(); for (const j of jobs) this._bake(j);
  }
  /** The same without waiting (a frame is about to draw with these textures). */
  flushSync() { const jobs = this.queue.splice(0); for (const j of jobs) this._bake(j); }
  /** Build a PBR material from a def or a baked set. extra = three material params + patch opts (triplanar:true, snow, wet, breakup, vis, wind...) */
  material(defOrSet, extra = {}) {
    const set = defOrSet.rt ? defOrSet : this.make(defOrSet);
    const o = { map: set.map, normalMap: set.normalMap, roughnessMap: set.orm, metalnessMap: set.orm, aoMap: set.orm, roughness: 1, metalness: 1, normalScale: 1, ...extra };
    if (set.emissiveMap) { o.emissiveMap = set.emissiveMap; o.emissive = o.emissive ?? 0xffffff; o.emissiveIntensity = o.emissiveIntensity ?? 1.5; }
    if (o.triplanar === true) o.triplanar = 1 / set.tile;
    if (o.detail === undefined && defOrSet.pattern && GRAVEL_PATTERNS.has(defOrSet.pattern)) o.detail = 'gravel'; // pebbly micro-relief for ground-like patterns (mats.js patch)
    const m = std(o); m.userData.tile = set.tile; return m;
  }
  dispose() { for (const s of this.cache.values()) s.rt.dispose(); this.cache.clear(); }
}
