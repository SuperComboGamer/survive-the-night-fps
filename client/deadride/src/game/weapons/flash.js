// View-model muzzle flash: one mesh per gun (1 draw call) of additive layers attached to the muzzle socket:
//  - axial star / petals / ring in the plane normal to the bore (seen face-on from behind the gun),
//  - 2-3 crossed flame "blades" along the bore (the forward cone), - a camera-facing white-hot core.
// Intensity follows real flash duration (~1-3 frames: 1.0 / 0.5 / 0.15) with per-shot random rotation, scale and seed.
// The atlas is drawn procedurally (4x2 cells): 0 star6, 1 turbulent plume petal, 2 flame cone, 3 core, 4 prong petals, 5 cloud, 6 ring (ray gun only), 7 plasma burst.
// Modes: 0 axial (plane normal to the bore), 1 blade along the bore, 2 camera billboard, 3 radial jet (brake ports / suppressor slots).
import * as THREE from 'three';

let ATLAS = null;
function makeAtlas() {
  if (ATLAS) return ATLAS; const C = 256, W = C * 4, H = C * 2; const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'); const img = g.createImageData(W, H); const d = img.data;
  let s = 91; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const vn = (x, y, f, sd) => { const X = Math.floor(x * f), Y = Math.floor(y * f), fx = x * f - X, fy = y * f - Y; const h = (a, b) => { let n = (a * 374761393 + b * 668265263 + sd * 1442695041) | 0; n = (n ^ (n >> 13)) * 1274126177 | 0; return ((n ^ (n >> 16)) >>> 0) / 4294967296; }; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return (h(X, Y) * (1 - sx) + h(X + 1, Y) * sx) * (1 - sy) + (h(X, Y + 1) * (1 - sx) + h(X + 1, Y + 1) * sx) * sy; };
  const cl = (x) => Math.max(0, Math.min(1, x));
  const win = (u, v) => { const e = Math.max(Math.abs(u), Math.abs(v)); return cl((1 - e) / 0.12); }; // fade to 0 at the cell border (no square edges)
  const put = (cell, fn) => { const ox = (cell % 4) * C, oy = Math.floor(cell / 4) * C; for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const u = (x + 0.5) / C * 2 - 1, v = (y + 0.5) / C * 2 - 1; const a = cl(fn(u, v, x / C, y / C) * win(u, v)); const i = ((oy + y) * W + ox + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255); } };
  const rays = (n, jit, sharp) => { const ang = []; for (let i = 0; i < n; i++) ang.push(i / n * Math.PI * 2 + (rnd() - 0.5) * jit); const len = ang.map(() => 0.65 + rnd() * 0.35); return (u, v, x, y) => { const r = Math.hypot(u, v), a = Math.atan2(v, u); let m = 0; for (let i = 0; i < n; i++) { let da = Math.abs(a - ang[i]); da = Math.min(da, Math.PI * 2 - da); const w = 0.07 + 0.25 * (1 - r); m = Math.max(m, Math.exp(-(da * da) / (w * w * sharp)) * cl(1 - r / len[i]) ** 1.2); } const n2 = vn(x, y, 22, 7); return m * (0.75 + 0.5 * n2) + Math.exp(-r * 7) * 1.1; }; };
  put(0, rays(6, 0.5, 0.6));
  put(1, (u, v, x, y) => { // turbulent gas plume / petal: narrow hot root at u=-1, ragged edges, bright core, burns out along its length
    const t = (u + 1) / 2; const n1 = vn(x * 4, y * 2, 7, 41), n2 = vn(x * 9, y * 5, 13, 43), n3 = vn(x * 19, y * 9, 23, 47);
    const w = (0.1 + 0.55 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7)) * (0.55 + 0.8 * n1) * (0.85 + 0.3 * n3);
    const body = Math.exp(-Math.pow(v / Math.max(0.03, w), 2) * 2.6) * Math.pow(Math.max(0, 1 - t), 1.1) * (0.3 + 0.95 * n2);
    return body + Math.exp(-Math.pow(t * 5, 2)) * Math.exp(-v * v * 30) * 0.7; });
  put(2, (u, v, x, y) => { // flame tongue: narrow hot base at u=-1, bulges, tapers to a soft point
    const t = (u + 1) / 2; const n = vn(x * 3, y * 1.2, 9, 3) * 0.6 + vn(x * 7, y * 2, 17, 5) * 0.4; const w = (0.1 + 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.8)) * (0.75 + 0.5 * n);
    const core = Math.exp(-Math.pow(v / Math.max(0.02, w), 2) * 3.2); return core * Math.pow(Math.max(0, 1 - t), 1.6) * (0.5 + 0.7 * n) + Math.exp(-Math.pow(t * 6, 2)) * Math.exp(-v * v * 40) * 0.8; });
  put(3, (u, v) => { const r = Math.hypot(u, v); return Math.exp(-r * r * 14) + 0.22 * Math.exp(-r * 4.5); });
  put(4, (u, v, x, y) => { const r = Math.hypot(u, v), a = Math.atan2(v, u); const pet = Math.pow(Math.max(0, Math.cos(a * 2.5)), 6); const n = vn(x, y, 14, 11); return pet * cl(1 - r / 0.92) ** 1.4 * (0.55 + 0.6 * n) * cl(r * 5) + Math.exp(-r * 9) * 0.9; });
  put(5, (u, v, x, y) => { const r = Math.hypot(u, v); const n = vn(x, y, 5, 13) * 0.55 + vn(x, y, 11, 17) * 0.3 + vn(x, y, 23, 19) * 0.15; const lobes = 0.75 + 0.25 * Math.cos(Math.atan2(v, u) * 5 + n * 4); return cl(1 - (r / lobes + (n - 0.5) * 0.6)) ** 2.2 * (0.35 + 0.8 * n); });
  put(6, (u, v, x, y) => { const r = Math.hypot(u, v); const n = vn(x, y, 16, 23); return Math.exp(-(((r - 0.62 - (n - 0.5) * 0.12) / 0.09) ** 2)) + Math.exp(-r * 5) * 0.6; });
  put(7, (u, v, x, y) => { const r = Math.hypot(u, v), a = Math.atan2(v, u); const arcs = Math.pow(Math.abs(Math.sin(a * 7 + vn(x, y, 6, 29) * 6)), 12) * cl(1 - r) ; return arcs * 0.9 + Math.exp(-r * r * 6) * 0.9; });
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; ATLAS = t; return t; // no mips: lower levels bleed neighbouring cells into grazing quads (x16 gain = visible squares)
}

const VS = /* glsl */`
attribute vec4 aQ;   // x: mode (0 axial, 1 blade, 2 billboard), y: cell, z: size, w: length/zoff
attribute vec2 aQ2;  // x: angle offset (blade/axial), y: layer gain
uniform float uRot; uniform float uScale; uniform float uLen; uniform float uI;
varying vec2 vUv; varying float vCell; varying float vGain; varying float vMode;
void main(){
  vec2 q = position.xy; vUv = q * 0.5 + 0.5; vCell = aQ.y; vGain = aQ2.y * uI; vMode = aQ.x;
  vec3 p; float sz = aQ.z * uScale;
  if (aQ.x < 0.5) { float a = uRot + aQ2.x; float c = cos(a), s = sin(a); vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * sz; p = vec3(r, -aQ.w * uLen); }
  else if (aQ.x < 1.5) { float a = uRot * 0.3 + aQ2.x; vec3 side = vec3(cos(a), sin(a), 0.0); float L = aQ.w * uLen; p = side * q.y * sz + vec3(0.0, 0.0, -(q.x * 0.5 + 0.5) * L); }
  else if (aQ.x > 2.5) { float a = uRot * 0.12 + aQ2.x; vec3 rad = vec3(cos(a), sin(a), 0.0), tg = vec3(-sin(a), cos(a), 0.0); float L = aQ.w * uLen; p = rad * (q.x * 0.5 + 0.5) * L + tg * q.y * sz - vec3(0.0, 0.0, 0.004); } // radial jet (brake port / suppressor slot)
  else { vec4 mv = modelViewMatrix * vec4(0.0, 0.0, -aQ.w * uLen, 1.0); mv.xy += q * sz; gl_Position = projectionMatrix * mv; return; }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FS = /* glsl */`
precision highp float; uniform sampler2D uAtlas; uniform vec3 uCore; uniform vec3 uEdge; uniform float uGain;
varying vec2 vUv; varying float vCell; varying float vGain; varying float vMode;
void main(){
  vec2 co = vec2(mod(vCell, 4.0), floor(vCell / 4.0)); vec2 uv = (co + clamp(vUv, 0.004, 0.996)) / vec2(4.0, 2.0); uv.y = 1.0 - uv.y;
  float i = texture2D(uAtlas, uv).a; if (i < 0.004) discard;
  vec3 col = mix(uEdge, uCore, smoothstep(0.25, 0.95, i)) * i * vGain * uGain;
  gl_FragColor = vec4(col, 0.0);
}`;

// layer recipes per style: [mode, cell, size (m), len/zoff (m), angle, gain]
const STYLES = {
  // pistol / SMG: small forward gas tongues + a faint irregular star + white core (short barrels: little afterburn)
  pistol: [[1, 1, 0.026, 0.085, 0.25, 1.0], [1, 1, 0.024, 0.075, 1.82, 0.9], [1, 2, 0.02, 0.06, 1.0, 0.6], [0, 0, 0.032, 0.008, 0, 0.45], [2, 3, 0.022, 0.012, 0, 0.9]],
  smg: [[1, 1, 0.02, 0.065, 0.35, 0.95], [1, 1, 0.019, 0.06, 1.92, 0.85], [0, 0, 0.026, 0.006, 0, 0.4], [2, 3, 0.017, 0.01, 0, 0.8]],
  // M14 5-slot suppressor: five short radial jets out of the slots + a small forward tongue
  rifle: [[3, 1, 0.011, 0.04, 2.199, 0.85], [3, 1, 0.011, 0.04, 3.456, 0.85], [3, 1, 0.011, 0.04, 4.712, 0.85], [3, 1, 0.011, 0.04, 5.969, 0.85], [3, 1, 0.011, 0.04, 0.942, 0.85],
    [1, 1, 0.018, 0.07, 0.2, 0.55], [1, 1, 0.018, 0.07, 1.77, 0.55], [2, 3, 0.02, 0.012, 0, 0.9]],
  // AKS-74U booster: violent side plumes out of the brake/cone + a forward blob and tongues
  booster: [[3, 1, 0.034, 0.085, 0.0, 1.0], [3, 1, 0.034, 0.085, 3.1416, 1.0], [3, 1, 0.024, 0.055, 1.5708, 0.6], [3, 1, 0.024, 0.05, 4.712, 0.55],
    [1, 1, 0.04, 0.1, 0.3, 0.75], [1, 1, 0.038, 0.09, 1.87, 0.7], [2, 5, 0.055, 0.045, 0, 0.45], [2, 3, 0.035, 0.015, 0, 0.9]],
  // 12 ga: big forward fireball + long tongues + burning powder, dense core
  shotgun: [[1, 1, 0.075, 0.27, 0, 0.9], [1, 1, 0.07, 0.25, 1.05, 0.85], [1, 1, 0.07, 0.24, 2.1, 0.8], [2, 5, 0.12, 0.13, 0, 0.5], [2, 5, 0.08, 0.07, 0, 0.55], [0, 0, 0.07, 0.015, 0, 0.45], [2, 3, 0.05, 0.03, 0, 1.0]],
  ray: [[0, 6, 0.05, 0.004, 0, 1.2], [0, 6, 0.035, 0.03, 0, 0.8], [0, 7, 0.06, 0.012, 0, 1.0], [2, 7, 0.07, 0.02, 0, 0.9], [2, 3, 0.04, 0.01, 0, 1.4], [1, 2, 0.025, 0.05, 0.3, 0.5]],
};
const COLORS = { ray: [[0.75, 1.0, 0.8], [0.1, 1.0, 0.25]], default: [[1.0, 0.92, 0.72], [1.0, 0.42, 0.08]] };

export class MuzzleFlash {
  constructor(style = 'pistol', { size = 1, len = 1, gain = 16 } = {}) {
    const L = STYLES[style] || STYLES.pistol; const n = L.length; const P = [], Q = [], Q2 = [], I = [];
    L.forEach((l, k) => { const b = k * 4; P.push(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0); for (let j = 0; j < 4; j++) { Q.push(l[0], l[1], l[2], l[3]); Q2.push(l[4], l[5]); } I.push(b, b + 1, b + 2, b, b + 2, b + 3); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aQ', new THREE.Float32BufferAttribute(Q, 4)); g.setAttribute('aQ2', new THREE.Float32BufferAttribute(Q2, 2)); g.setIndex(I);
    const col = COLORS[style] || COLORS.default;
    this.u = { uAtlas: { value: makeAtlas() }, uRot: { value: 0 }, uScale: { value: size }, uLen: { value: len }, uI: { value: 0 }, uCore: { value: new THREE.Vector3(...col[0]) }, uEdge: { value: new THREE.Vector3(...col[1]) }, uGain: { value: gain } };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.u, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 50; this.mesh.visible = false; this.age = 99; this.size = size; this.len = len;
  }
  /** start a flash; k scales size (e.g. random 0.85..1.2) */
  fire(k = 1) { this.age = 0; this.u.uRot.value = Math.random() * Math.PI * 2; this.u.uScale.value = this.size * k * (0.85 + Math.random() * 0.3); this.u.uLen.value = this.len * k * (0.75 + Math.random() * 0.5); this.mesh.visible = true; this.u.uI.value = 1; }
  update(dt) {
    if (this.hold) { this.u.uI.value = 1; this.mesh.visible = true; return; }
    if (this.age > 1) return; this.age += dt; const a = this.age;
    // 1-3 frame flash (~16 ms per frame): full, half, faint
    const I = a < 0.017 ? 1 : a < 0.034 ? 0.35 : 0; this.u.uI.value = I; this.mesh.visible = I > 0; // 1-2 frames
  }
}
