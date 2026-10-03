// Procedural sky dome: gradient, sun/moon disc, stars, lit clouds, aurora, lightning. Also used to build per-stop IBL.
import * as THREE from 'three';
import { G, FOG_GLSL } from './mats.js';

const VS = /* glsl */`
varying vec3 vDir;
void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }
`;
const FS = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform float uTime; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform float uGradPow;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunSize; uniform float uSunGlow; uniform float uDisc;
uniform float uStars; uniform float uCloud; uniform vec3 uCloudColor; uniform vec3 uCloudLit; uniform float uCloudSpeed; uniform float uCloudScale; uniform float uCloudDark;
uniform float uAurora; uniform vec3 uAuroraA; uniform vec3 uAuroraB; uniform float uLightning; uniform vec3 uFogColor; uniform float uHorizonFog; uniform vec3 uWindDir;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s; }
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), uGradPow));
  col = mix(col, uGround, smoothstep(0.0, -0.12, h));
  float sd = dot(d, uSunDir);
  // sun / moon
  if (uDisc > 0.5) {
    float cs = cos(uSunSize);
    float disc = smoothstep(cs, cs + (uDisc > 1.5 ? 0.00008 : 0.0004), sd);
    float glow = pow(max(sd, 0.0), 24.0) * 0.5 + pow(max(sd, 0.0), 260.0) * 2.0;
    vec3 dc = uSunColor;
    if (uDisc > 1.5) { // moon: cratered look
      vec2 mp = vec2(dot(d, normalize(cross(uSunDir, vec3(0,1,0)))), dot(d, normalize(cross(cross(uSunDir, vec3(0,1,0)), uSunDir)))) / uSunSize;
      float maria = smoothstep(0.45, 0.65, fbm(mp*2.4 + 3.0)); dc *= mix(1.0, 0.62, maria * 0.8);
    }
    col += dc * disc * (uDisc > 1.5 ? 6.0 : 60.0) * step(-0.02, h) + uSunColor * glow * uSunGlow * step(-0.3, h);
  }
  // stars
  if (uStars > 0.001) {
    vec3 g = d * 260.0; vec3 gi = floor(g); float hh = h31(gi); vec3 gf = fract(g) - 0.5;
    float st = step(0.9965, hh) * smoothstep(0.35, 0.0, length(gf)) * (0.45 + 0.55*h31(gi+7.0));
    st *= 0.6 + 0.4*sin(uTime*(2.0+hh*6.0) + hh*40.0);
    vec3 g2 = d * 700.0; float h2 = h31(floor(g2)+3.0); st += step(0.9985, h2) * smoothstep(0.4, 0.0, length(fract(g2)-0.5)) * 0.6;
    float band = exp(-pow(dot(d, normalize(vec3(0.3,0.5,0.8))) * 3.2, 2.0)); // milky way
    float mw = band * fbm(d.xz*9.0 + d.y*5.0) * 0.16;
    col += (vec3(0.85,0.9,1.0) * st * 2.2 + vec3(0.55,0.6,0.8) * mw) * uStars * smoothstep(0.0, 0.12, h);
  }
  // clouds
  if (uCloud > 0.001) {
    vec2 p = d.xz / max(h + 0.12, 0.06) * uCloudScale + uWindDir.xz * uTime * uCloudSpeed;
    float n = fbm(p + fbm(p*0.5 + uTime*0.01) * 0.8);
    float cov = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.35, n);
    float lit = 0.0;
    { vec2 sp = p + normalize(uSunDir.xz + 1e-4) * 0.12; float n2 = fbm(sp + fbm(sp*0.5 + uTime*0.01)*0.8); lit = clamp((n - n2) * 5.0 + 0.5, 0.0, 1.0); }
    vec3 cc = mix(uCloudColor, uCloudLit, lit * clamp(sd*0.5+0.6, 0.0, 1.0)) * (1.0 - uCloudDark * smoothstep(0.55, 1.0, n));
    col = mix(col, cc, cov * smoothstep(-0.02, 0.15, h) * 0.95);
  }
  // aurora
  if (uAurora > 0.001 && h > 0.02) {
    float t = uTime * 0.05; vec3 acc = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      float fi = float(i); float hh = 0.16 + fi * 0.09;
      vec2 q = d.xz / (h + 0.05) * 0.5; float curtain = fbm(vec2(q.x * 1.5 + t * (1.0 + fi*0.3), q.y * 0.35 + fi * 3.0));
      float band = smoothstep(0.5, 0.75, curtain) * smoothstep(0.0, 0.35, h) * (1.0 - smoothstep(0.55, 0.95, h));
      float ray = 0.6 + 0.4 * vn(vec2(q.x * 22.0 + fi * 5.0, t * 2.0));
      acc += mix(uAuroraA, uAuroraB, fi / 3.0) * band * ray * 0.5;
    }
    col += acc * uAurora;
  }
  col += vec3(0.75, 0.82, 1.0) * uLightning * (0.35 + 0.65 * smoothstep(0.0, 0.7, fbm(d.xz * 3.0 + d.y * 6.0)));
  // blend to fog colour at the horizon so fogged geometry meets the sky seamlessly
  col = mix(col, uFogColor, uHorizonFog * (1.0 - smoothstep(0.0, 0.35, abs(h))) );
  col = mix(col, uFogColor, uHorizonFog * smoothstep(0.02, -0.4, h));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SKY_DEFAULT = {
  zenith: 0x02030a, horizon: 0x0a1020, ground: 0x020305, gradPow: 0.5,
  sunColor: 0xbfd0ff, sunSize: 0.02, sunGlow: 0.3, disc: 2, stars: 1, cloud: 0, cloudColor: 0x202838, cloudLit: 0x7080a0, cloudSpeed: 0.004, cloudScale: 1.6, cloudDark: 0.3,
  aurora: 0, auroraA: 0x30ff90, auroraB: 0x8040ff, horizonFog: 0.6,
};

export class Sky {
  constructor() {
    this.uniforms = {
      uTime: G.uTime, uSunDir: G.uSunDir, uFogColor: G.uFogColor, uWindDir: { value: new THREE.Vector3(1, 0, 0.3) },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uGradPow: { value: 0.5 },
      uSunColor: { value: new THREE.Color() }, uSunSize: { value: 0.02 }, uSunGlow: { value: 0.3 }, uDisc: { value: 2 },
      uStars: { value: 1 }, uCloud: { value: 0 }, uCloudColor: { value: new THREE.Color() }, uCloudLit: { value: new THREE.Color() }, uCloudSpeed: { value: 0.004 }, uCloudScale: { value: 1.6 }, uCloudDark: { value: 0.3 },
      uAurora: { value: 0 }, uAuroraA: { value: new THREE.Color() }, uAuroraB: { value: new THREE.Color() }, uLightning: { value: 0 }, uHorizonFog: { value: 0.6 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, side: THREE.BackSide, depthWrite: false, depthTest: true, depthFunc: THREE.LessEqualDepth, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1000; // drawn after opaques, depth-tested at the far plane: only visible sky pixels are shaded this.mesh.scale.setScalar(1500);
    this.params = { ...SKY_DEFAULT };
    this.set(SKY_DEFAULT);
  }
  set(p) {
    const q = this.params = { ...this.params, ...p }, u = this.uniforms;
    u.uZenith.value.set(q.zenith); u.uHorizon.value.set(q.horizon); u.uGround.value.set(q.ground); u.uGradPow.value = q.gradPow;
    u.uSunColor.value.set(q.sunColor); u.uSunSize.value = q.sunSize; u.uSunGlow.value = q.sunGlow; u.uDisc.value = q.disc; u.uStars.value = q.stars;
    u.uCloud.value = q.cloud; u.uCloudColor.value.set(q.cloudColor); u.uCloudLit.value.set(q.cloudLit); u.uCloudSpeed.value = q.cloudSpeed; u.uCloudScale.value = q.cloudScale; u.uCloudDark.value = q.cloudDark;
    u.uAurora.value = q.aurora; u.uAuroraA.value.set(q.auroraA); u.uAuroraB.value.set(q.auroraB); u.uHorizonFog.value = q.horizonFog;
  }
  update(camPos) { this.mesh.position.copy(camPos); }
}
