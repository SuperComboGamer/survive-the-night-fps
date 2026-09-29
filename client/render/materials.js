// Shared material instances + a small procedural mesh builder used by all model modules.
//
// UV CONVENTION: surface materials expect UVs in METERS (1 uv unit = 1 m). Each material's texture
// repeat is set so the texture covers its intended world size (see TEXTURE_WORLD_SIZE in textures.js).
// So a building box of 4 x 3 m should get UVs 0..4 / 0..3 on that face. Use `meterBoxGeometry()` below
// for boxes (v axis = world up on side faces).
//
// VERTEX COLOURS: materials listed in VERTEX_COLOR_MATERIALS use vertexColors:true. Every geometry
// rendered with them MUST have a 'color' attribute (all geometry produced here does).
// All other materials must NOT rely on vertex colours.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTexture, TEXTURE_WORLD_SIZE, atlasUV } from './textures.js';

/** Shared wind clock for all vegetation materials. The game updates `.value` (seconds) every frame. */
export const vegetationTime = { value: 0 };

export const VERTEX_COLOR_MATERIALS = new Set(['wood', 'paint', 'carpaint', 'cloth', 'pine', 'leaves', 'bush', 'fern', 'grass', 'weeds']);

function tileTex(name, tile) {
  const t = tile ?? TEXTURE_WORLD_SIZE[name] ?? 1;
  const [tx, ty] = Array.isArray(t) ? t : [t, t];
  return getTexture(name, 1 / tx, 1 / ty);
}

function lambert(o) {
  return new THREE.MeshLambertMaterial(o);
}

// paint mask: texture alpha = painted area. Vertex colour tints only the painted parts (rust stays rust).
function paintMaskPatch(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <color_fragment>',
      `#if defined( USE_COLOR )
        diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, sampledDiffuseColor.a );
      #endif
      diffuseColor.a = opacity;`,
    );
  };
  mat.customProgramCacheKey = () => 'paintmask';
  return mat;
}

// moss on upward-facing surfaces (object-space normal.y, robust for yaw-only instancing & merged world geometry)
function mossPatch(mat, amount = 1) {
  mat.userData.moss = { value: amount };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMoss = mat.userData.moss;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUpN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUpN = normalize( objectNormal ).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vUpN;\nuniform float uMoss;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float lum = dot( sampledDiffuseColor.rgb, vec3( 0.33 ) );
          float m = smoothstep( 0.35, 0.85, vUpN + ( lum - 0.18 ) * 1.6 ) * uMoss;
          vec3 mossCol = vec3( 0.032, 0.05, 0.016 ) * ( 0.6 + lum * 3.0 );
          diffuseColor.rgb = mix( diffuseColor.rgb, mossCol, m * 0.9 );
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'moss';
  return mat;
}

// foliage: wind sway (height based, phase from instance/object position), no back-face normal flip,
// alpha boost with mip level so distant cards don't dissolve.
function foliagePatch(mat, sway, flutter) {
  mat.userData.uTime = vegetationTime;
  mat.userData.sway = { value: sway };
  mat.userData.flutter = { value: flutter };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = vegetationTime;
    sh.uniforms.uSway = mat.userData.sway;
    sh.uniforms.uFlutter = mat.userData.flutter;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;\nuniform float uFlutter;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 ip = modelMatrix[3].xyz;
        #ifdef USE_INSTANCING
          ip += instanceMatrix[3].xyz;
        #endif
        float ph = ip.x * 0.37 + ip.z * 0.23;
        float hh = max( transformed.y, 0.0 );
        float g = sin( uTime * 0.83 + ph ) + 0.45 * sin( uTime * 1.97 + ph * 1.7 ) + 0.2 * sin( uTime * 3.3 + ph * 0.6 );
        float f = sin( uTime * 4.1 + ph * 3.0 + transformed.x * 1.7 + transformed.z * 1.3 + transformed.y * 0.9 );
        float amp = uSway * hh;
        transformed.x += g * amp + f * uFlutter * min( hh, 1.0 );
        transformed.z += ( 0.6 * sin( uTime * 0.71 + ph * 1.3 ) ) * amp + f * uFlutter * 0.7 * min( hh, 1.0 );
      }`,
    );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace(
        '#include <alphatest_fragment>',
        `#ifdef USE_MAP
          {
            vec2 tsz = vec2( textureSize( map, 0 ) );
            vec2 dx = dFdx( vMapUv * tsz ), dy = dFdy( vMapUv * tsz );
            float lod = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) );
            diffuseColor.a *= 1.0 + lod * 0.3;
          }
        #endif
        #include <alphatest_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'foliage';
  return mat;
}

function alphaCards(o) {
  return lambert({ alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, ...o });
}

const DEFS = {
  // ------------------------------------------------ building surfaces (no vertex colours, meter UVs)
  planks: () => lambert({ map: tileTex('planks') }),
  barn: () => lambert({ map: tileTex('barn') }),
  clapboard: () => lambert({ map: tileTex('clapboard') }),
  logwall: () => lambert({ map: tileTex('logwall') }),
  concrete: () => lambert({ map: tileTex('concrete') }),
  brick: () => lambert({ map: tileTex('brick') }),
  shingles: () => lambert({ map: tileTex('shingles') }),
  tin: () => lambert({ map: tileTex('tin') }),
  tin_rust: () => lambert({ map: tileTex('tin_rusty') }),
  rust: () => lambert({ map: tileTex('rust') }),
  metal: () => lambert({ map: tileTex('metal') }),
  stone: () => lambert({ map: tileTex('stone') }),
  dockwood: () => lambert({ map: tileTex('dockwood') }),
  glass: () => lambert({ map: tileTex('glass') }),
  door: () => lambert({ map: tileTex('door') }),
  hay: () => lambert({ map: tileTex('hay') }),
  canvas: () => lambert({ map: tileTex('canvas'), side: THREE.DoubleSide }),
  olive: () => lambert({ map: tileTex('olive') }),
  dark: () => lambert({ color: 0x0b0a09 }),
  trim: () => lambert({ map: tileTex('wood'), color: 0x6e6256 }),
  sash: () => lambert({ map: tileTex('sash') }),

  // ------------------------------------------------ props
  wood: () => lambert({ map: tileTex('wood'), vertexColors: true }),
  paint: () => paintMaskPatch(lambert({ map: tileTex('paint'), vertexColors: true })),
  carpaint: () => paintMaskPatch(lambert({ map: tileTex('carpaint'), vertexColors: true })),
  cloth: () => lambert({ map: tileTex('cloth'), vertexColors: true, side: THREE.DoubleSide }),
  burlap: () => lambert({ map: tileTex('burlap'), side: THREE.DoubleSide }),
  tire: () => lambert({ map: tileTex('tire') }),
  rubber: () => lambert({ color: 0x1b1a19 }),
  chrome: () => lambert({ map: tileTex('paint'), color: 0x9c9c98 }),
  bone: () => lambert({ map: tileTex('bone'), color: 0xa8a090 }),
  blood: () => lambert({ color: 0x3c0605 }),
  blood_decal: () =>
    lambert({ map: getTexture('decal_blood'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  flesh: () => lambert({ map: tileTex('skin') }),
  charred: () => lambert({ map: tileTex('charred') }),
  ash: () => lambert({ map: tileTex('ash') }),
  ember: () => new THREE.MeshBasicMaterial({ color: 0xb4400e }),
  emissive_red: () => new THREE.MeshBasicMaterial({ color: 0x6a0a06 }),
  acid: () => new THREE.MeshBasicMaterial({ color: 0x9cff3c }),
  acid_glow: () => new THREE.MeshBasicMaterial({ color: 0x3aa010, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
  flare: () => new THREE.MeshBasicMaterial({ color: 0xff5a30 }),
  water_dark: () => lambert({ color: 0x0a0f10 }),
  labels: () => lambert({ map: getTexture('atlas') }),
  stencil: () => lambert({ map: getTexture('atlas'), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  mattress: () => lambert({ map: tileTex('mattress') }),
  plastic: () => lambert({ map: tileTex('plastic') }),
  pumpkin: () => lambert({ map: tileTex('pumpkin') }),
  cardboard: () => lambert({ map: tileTex('cardboard') }),
  woodend: () => lambert({ map: getTexture('endgrain') }),
  bottle: () => lambert({ color: 0x2c3a26 }),
  bottle_brown: () => lambert({ color: 0x3e2410 }),
  rope: () => lambert({ map: getTexture('fx_rope', 1 / 0.05, 1 / 0.25) }),
  wire: () => lambert({ color: 0x5c5b57 }),
  steel: () => lambert({ map: tileTex('metal'), color: 0x8a8a8a }),
  parachute: () => lambert({ map: getTexture('fx_parachute'), side: THREE.DoubleSide }),
  canvas_mil: () => lambert({ map: tileTex('canvas'), color: 0x8a9468, side: THREE.DoubleSide }),
  scarecrow_head: () => lambert({ map: getTexture('scareface') }),
  taillight: () => lambert({ color: 0x4a0a07 }),
  dirt: () => lambert({ map: tileTex('ground_dirt', 2) }),
  weeds: () => alphaCards({ map: getTexture('grass_blade') }),
  stone_rough: () => lambert({ map: tileTex('rock'), color: 0x8c8882 }),
  gravestone: () => mossPatch(lambert({ map: tileTex('rock', 1.2), color: 0xb4b0a6 }), 0.8),
  // iteration 2
  gravel: () => lambert({ map: tileTex('gravel', 1.6), color: 0xc4c0b8 }),
  chainlink: () => lambert({ map: tileTex('chainlink', 0.3), transparent: true, alphaTest: 0.08, depthWrite: false, side: THREE.DoubleSide }),

  // ------------------------------------------------ vegetation
  bark: () => lambert({ map: tileTex('bark') }),
  bark_birch: () => lambert({ map: tileTex('bark_birch') }),
  bark_dead: () => lambert({ map: tileTex('bark_dead') }),
  pine: () => foliagePatch(alphaCards({ map: getTexture('pine') }), 0.012, 0.05),
  leaves: () => foliagePatch(alphaCards({ map: getTexture('leaves') }), 0.016, 0.06),
  bush: () => foliagePatch(alphaCards({ map: getTexture('bush') }), 0.05, 0.03),
  fern: () => foliagePatch(alphaCards({ map: getTexture('fern') }), 0.07, 0.03),
  grass: () => foliagePatch(alphaCards({ map: getTexture('grass_blade') }), 0.22, 0.02),
  rock: () => mossPatch(lambert({ map: tileTex('rock') }), 1),
};

export const MAT = {};
for (const name of Object.keys(DEFS)) {
  let inst = null;
  Object.defineProperty(MAT, name, {
    enumerable: true,
    get() {
      if (!inst) {
        inst = DEFS[name]();
        inst.name = name;
      }
      return inst;
    },
  });
}
export const MATERIAL_NAMES = Object.keys(DEFS);

export function getMaterial(name) {
  const m = MAT[name];
  if (!m) throw new Error(`materials: unknown material '${name}'`);
  return m;
}

// ------------------------------------------------ static world surface variants
// Building surfaces merged into the static world carry extra per-vertex data: aGround (height above the
// terrain) for splash-back dirt and contact darkening where walls meet the ground, and for painted
// clapboard aTint, a faded paint colour per building (texture alpha = painted area).
const GRIME_MATERIALS = new Set(['planks', 'barn', 'clapboard', 'logwall', 'concrete', 'brick', 'tin', 'tin_rust', 'stone', 'dockwood', 'rust', 'metal', 'charred']);
const PAINTED_MATERIALS = new Set(['clapboard']);
const staticVariants = new Map();

function groundGrimePatch(mat, paint) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aGround;
        varying float vGround;
        varying float vUpA;
        varying vec3 vGPos;
        ${paint ? 'attribute vec3 aTint;\nvarying vec3 vTint;' : ''}`,
      )
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUpA = abs( objectNormal.y );')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvGround = aGround;\nvGPos = position;${paint ? '\nvTint = aTint;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vGround;
        varying float vUpA;
        varying vec3 vGPos;
        ${paint ? 'varying vec3 vTint;' : ''}
        float grimeNoise( float x ) {
          float i = floor( x ), f = fract( x );
          f = f * f * ( 3.0 - 2.0 * f );
          return mix( fract( sin( i * 127.1 ) * 43758.5453 ), fract( sin( ( i + 1.0 ) * 127.1 ) * 43758.5453 ), f );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${paint ? 'diffuseColor.rgb *= mix( vec3( 1.0 ), vTint, sampledDiffuseColor.a );' : ''}
        diffuseColor.a = opacity;
        {
          // walls only (floors and roofs face up or down): mud splashed up by rain, darker right at the ground
          float side = 1.0 - smoothstep( 0.5, 0.85, vUpA );
          float s = vGPos.x + vGPos.z;
          float edge = grimeNoise( s * 2.3 ) * 0.28 + grimeNoise( s * 9.1 ) * 0.1;
          float splash = ( 1.0 - smoothstep( 0.0, 0.8, vGround - edge ) ) * side;
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.5, 0.43, 0.34 ), splash * 0.8 );
          diffuseColor.rgb *= mix( 1.0, mix( 0.5, 1.0, smoothstep( -0.05, 0.35, vGround ) ), side );
        }`,
      );
  };
  mat.customProgramCacheKey = () => (paint ? 'static-grime-paint' : 'static-grime');
  mat.userData.staticGrime = true;
  mat.userData.staticPaint = paint;
  return mat;
}

/** The static world's variant of a shared material (itself when the material has none). */
export function staticSurface(mat) {
  if (!GRIME_MATERIALS.has(mat.name)) return mat;
  let v = staticVariants.get(mat);
  if (!v) {
    v = groundGrimePatch(mat.clone(), PAINTED_MATERIALS.has(mat.name));
    v.name = mat.name;
    staticVariants.set(mat, v);
  }
  return v;
}

// ================================================================== geometry helpers
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();

export function makeRng(seed) {
  let a = (seed * 2654435761 + 1013904223) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compose(p, r, s, order = 'XYZ') {
  const m = new THREE.Matrix4();
  _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, order);
  _q.setFromEuler(_e);
  if (s === undefined) _s.set(1, 1, 1);
  else if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  m.compose(_v.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0), _q, _s);
  return m;
}

function ensureIndexed(g) {
  if (g.index) return g;
  const n = g.attributes.position.count;
  const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function stripAttributes(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  g.clearGroups();
  g.morphAttributes = {};
  return g;
}

/** meter UVs for a THREE.BoxGeometry(sx,sy,sz) (1 segment). grain=true rotates so u follows the longest face edge. */
function meterUVBox(g, sx, sy, sz, grain = false) {
  const uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    const swap = grain && dv > du;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const u = uv.getX(i), v = uv.getY(i);
      if (swap) uv.setXY(i, v * dv, u * du);
      else uv.setXY(i, u * du, v * dv);
    }
  }
  return g;
}

/** Box geometry with meter UVs (side faces: u horizontal, v = up). Indexed; attributes position/normal/uv. */
export function meterBoxGeometry(sx, sy, sz) {
  return meterUVBox(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz);
}

function meterUVCyl(g, rt, rb, h, seg, grain) {
  const uv = g.attributes.uv;
  const torso = (seg + 1) * (g.parameters.heightSegments + 1);
  const circ = Math.PI * (rt + rb) * (g.parameters.thetaLength / (Math.PI * 2));
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (i < torso) {
      if (grain) uv.setXY(i, v * h, u * circ);
      else uv.setXY(i, u * circ, v * h);
    } else {
      const r = Math.max(rt, rb);
      uv.setXY(i, (u - 0.5) * 2 * r, (v - 0.5) * 2 * r);
    }
  }
  return g;
}

/** per-face planar UVs in meters for arbitrary (non-indexed or per-face-vertex) geometry: u = horizontal-ish, v = up-ish */
function planarUV(g) {
  const pos = g.attributes.position;
  const idx = g.index;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), bt = new THREE.Vector3();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const done = new Uint8Array(pos.count);
  for (let f = 0; f < triCount; f++) {
    const i0 = idx ? idx.getX(f * 3) : f * 3, i1 = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, i2 = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    n.subVectors(c, b).cross(t.subVectors(a, b)).normalize();
    // tangent: horizontal direction in the face plane
    if (Math.abs(n.y) > 0.95) t.set(1, 0, 0);
    else t.crossVectors(Y, n).normalize();
    bt.crossVectors(n, t).normalize();
    for (const i of [i0, i1, i2]) {
      if (done[i]) continue;
      done[i] = 1;
      _v.fromBufferAttribute(pos, i);
      uv[i * 2] = _v.dot(t);
      uv[i * 2 + 1] = _v.dot(bt);
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * MeshBuilder: accumulate primitives per material (in a local transform stack), then merge into one
 * geometry per material. All output geometries are indexed with position/normal/uv (+color for VC materials).
 */
export class MeshBuilder {
  constructor(seed = 1, { ao = true, aoHeight = 0.7 } = {}) {
    this.lists = new Map();
    this.stack = [new THREE.Matrix4()];
    this.rng = makeRng(seed);
    this.ao = ao;
    this.aoHeight = aoHeight;
  }
  get matrix() {
    return this.stack[this.stack.length - 1];
  }
  push(p, r, s, order) {
    this.stack.push(this.matrix.clone().multiply(compose(p, r, s, order)));
    return this;
  }
  pop() {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }
  group(tr, fn) {
    this.push(tr.p, tr.r, tr.s, tr.order);
    fn();
    this.pop();
  }
  /** add a geometry (consumed). o: {p, r, s, order, c (colour hex|[r,g,b]), cfn(x,y,z,color), raw (keep uvs), uvOff:[u,v]} */
  add(mat, g, o = {}) {
    if (!DEFS[mat]) throw new Error(`MeshBuilder: unknown material '${mat}'`);
    const keptColor = o.keepColor && g.attributes.color ? g.attributes.color : null;
    stripAttributes(g);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!o.raw) {
      const uv = g.attributes.uv;
      const du = o.uvOff ? o.uvOff[0] : this.rng() * 4, dv = o.uvOff ? o.uvOff[1] : this.rng() * 4;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
    }
    ensureIndexed(g);
    const m = this.matrix.clone().multiply(compose(o.p, o.r, o.s, o.order));
    g.applyMatrix4(m);
    if (VERTEX_COLOR_MATERIALS.has(mat) && keptColor) g.setAttribute('color', keptColor);
    else if (VERTEX_COLOR_MATERIALS.has(mat)) {
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      if (o.c !== undefined) {
        if (Array.isArray(o.c)) _col.setRGB(o.c[0], o.c[1], o.c[2]);
        else _col.set(o.c);
      } else _col.setRGB(1, 1, 1);
      const pos = g.attributes.position;
      for (let i = 0; i < n; i++) {
        let r = _col.r, gg = _col.g, b = _col.b;
        if (o.cfn) {
          const cc = o.cfn(pos.getX(i), pos.getY(i), pos.getZ(i), new THREE.Color(r, gg, b));
          r = cc.r;
          gg = cc.g;
          b = cc.b;
        }
        col[i * 3] = r;
        col[i * 3 + 1] = gg;
        col[i * 3 + 2] = b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    let list = this.lists.get(mat);
    if (!list) this.lists.set(mat, (list = []));
    list.push(g);
    return g;
  }
  box(mat, sx, sy, sz, o = {}) {
    return this.add(mat, meterUVBox(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, o.grain), o);
  }
  /** box spanning from point a to point b (centre line), cross-section w x d. o.side = vector the 'd' axis should face */
  beam(mat, a, b, w, d, o = {}) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const dir = new THREE.Vector3().subVectors(B, A);
    const len = dir.length();
    dir.normalize();
    const g = meterUVBox(new THREE.BoxGeometry(w, len, d), w, len, d, true);
    const basis = new THREE.Matrix4();
    const side = new THREE.Vector3(...(o.side || (Math.abs(dir.y) > 0.9 ? [0, 0, 1] : [0, 1, 0])));
    const xAxis = new THREE.Vector3().crossVectors(dir, side);
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, dir).normalize();
    basis.makeBasis(xAxis, dir, zAxis);
    basis.setPosition(A.clone().add(B).multiplyScalar(0.5));
    g.applyMatrix4(basis);
    return this.add(mat, g, { ...o, p: undefined, r: undefined, s: undefined });
  }
  /** cylinder along Y centred on origin. o.open, o.theta:[start,len], o.grain (u along height), o.hseg */
  cyl(mat, rt, rb, h, seg = 8, o = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, o.hseg || 1, !!o.open, o.theta ? o.theta[0] : 0, o.theta ? o.theta[1] : Math.PI * 2);
    return this.add(mat, o.raw ? g : meterUVCyl(g, rt, rb, h, seg, o.grain), o);
  }
  /** cylinder between two points */
  cylBetween(mat, a, b, rt, rb, seg = 6, o = {}) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const dir = new THREE.Vector3().subVectors(B, A);
    const len = dir.length();
    const g = meterUVCyl(new THREE.CylinderGeometry(rt, rb, len, seg, 1, !!o.open), rt, rb, len, seg, o.grain !== false);
    g.applyQuaternion(_q.setFromUnitVectors(Y, dir.normalize()));
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    return this.add(mat, g, { ...o, p: undefined, r: undefined, s: undefined });
  }
  sphere(mat, r, ws = 8, hs = 6, o = {}) {
    const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, o.thetaStart || 0, o.thetaLen || Math.PI);
    if (!o.raw) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * Math.PI * r);
    }
    return this.add(mat, g, o);
  }
  /** flat disc facing +Y (raw 0..1 UVs, e.g. end grain) */
  disc(mat, r, seg = 6, o = {}) {
    const g = new THREE.CircleGeometry(r, seg);
    g.rotateX(-Math.PI / 2);
    return this.add(mat, g, { raw: true, ...o });
  }
  torus(mat, R, r, radSeg = 6, tubSeg = 12, arc = Math.PI * 2, o = {}) {
    const g = new THREE.TorusGeometry(R, r, radSeg, tubSeg, arc);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * Math.PI * 2 * r, uv.getX(i) * arc * R);
    return this.add(mat, g, o);
  }
  /** lathe around Y from [[r,y],...] profile; UV meters (u around at max radius, v along profile) */
  lathe(mat, prof, seg = 10, o = {}) {
    const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, seg, o.phiStart || 0, o.phiLen || Math.PI * 2);
    let L = 0;
    for (let k = 1; k < pts.length; k++) L += pts[k].distanceTo(pts[k - 1]);
    const maxR = Math.max(...prof.map((p) => p[0]));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * maxR, uv.getY(i) * L);
    if (o.flat) {
      const ng = g.toNonIndexed();
      ng.computeVertexNormals();
      return this.add(mat, ng, o);
    }
    return this.add(mat, g, o);
  }
  tube(mat, points, r, tubSeg = 12, radSeg = 5, o = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const g = new THREE.TubeGeometry(curve, tubSeg, r, radSeg, false);
    const L = curve.getLength();
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * Math.PI * 2 * r, uv.getX(i) * L);
    return this.add(mat, g, o);
  }
  /** convex-ish hexahedron from 8 corners indexed by (x>0)+(y>0)*2+(z>0)*4 ; planar meter UVs, flat normals */
  hull(mat, corners, o = {}) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = (pos.getX(i) > 0 ? 1 : 0) + (pos.getY(i) > 0 ? 2 : 0) + (pos.getZ(i) > 0 ? 4 : 0);
      pos.setXYZ(i, corners[k][0], corners[k][1], corners[k][2]);
    }
    g.computeVertexNormals();
    planarUV(g);
    return this.add(mat, g, o);
  }
  /** axis-aligned tapered box: bottom sx*sz at y0, top tx*tz at y1 (centre offsets optional) */
  frustum(mat, sx, sz, tx, tz, y0, y1, o = {}) {
    const ox = o.topOff ? o.topOff[0] : 0, oz = o.topOff ? o.topOff[1] : 0;
    const c = [];
    for (let k = 0; k < 8; k++) {
      const X = k & 1 ? 1 : -1, top = k & 2, Z = k & 4 ? 1 : -1;
      c.push(top ? [(X * tx) / 2 + ox, y1, (Z * tz) / 2 + oz] : [(X * sx) / 2, y0, (Z * sz) / 2]);
    }
    return this.hull(mat, c, o);
  }
  /** plane facing +Z (w along X, h along Y). o.atlas = atlas cell name (raw uv mapping) */
  plane(mat, w, h, o = {}) {
    const g = new THREE.PlaneGeometry(w, h, o.ws || 1, o.hs || 1);
    const uv = g.attributes.uv;
    if (o.atlas) {
      const a = atlasUV(o.atlas);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, a.u0 + uv.getX(i) * (a.u1 - a.u0), a.v0 + uv.getY(i) * (a.v1 - a.v0));
      return this.add(mat, g, { ...o, raw: true });
    }
    if (!o.raw) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
    return this.add(mat, g, o);
  }
  /** arbitrary triangle/quad soup: verts [[x,y,z]...], faces [[a,b,c],...]; planar meter UVs, flat normals */
  poly(mat, verts, faces, o = {}) {
    const arr = [];
    for (const f of faces) for (const k of f) arr.push(...verts[k]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    planarUV(g);
    return this.add(mat, g, o);
  }
  /** quad (4 pts in order around) whose winding is chosen so its normal points away from `away` */
  quadOut(mat, pts, away, o = {}) {
    const [a, c, d] = [pts[0], pts[1], pts[2]];
    const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [(pts[0][0] + pts[2][0]) / 2 - away[0], (pts[0][1] + pts[2][1]) / 2 - away[1], (pts[0][2] + pts[2][2]) / 2 - away[2]];
    const ok = n[0] * m[0] + n[1] * m[1] + n[2] * m[2] > 0;
    return this.poly(mat, pts, ok ? [[0, 1, 2], [0, 2, 3]] : [[0, 2, 1], [0, 3, 2]], o);
  }
  /** flat shape (THREE.Shape in XY) extruded along +Z by depth; UVs are shape coords in meters */
  extrude(mat, shape, depth, o = {}) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: o.curveSegments || 6 });
    return this.add(mat, g, o);
  }
  /**
   * loft through cross-sections along Z. sections: [{z, w, h, y, n?}] ; profile(t)->[x,y] unit shape (t in 0..1 around).
   * open: leave ends open. UVs: u = arc length, v = z distance (meters).
   */
  loft(mat, sections, profile, around = 10, o = {}) {
    const S = sections.length, N = around;
    const pos = [], uv = [], idx = [];
    let vz = 0;
    for (let s = 0; s < S; s++) {
      const sec = sections[s];
      if (s > 0) vz += Math.abs(sec.z - sections[s - 1].z);
      let arc = 0;
      let prev = null;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const [px, py] = profile(t, sec);
        const x = px * sec.w * 0.5 + (sec.x || 0), y = py * sec.h * 0.5 + (sec.y || 0);
        if (prev) arc += Math.hypot(x - prev[0], y - prev[1]);
        prev = [x, y];
        pos.push(x, y, sec.z);
        uv.push(arc, vz);
      }
    }
    for (let s = 0; s < S - 1; s++)
      for (let k = 0; k < N; k++) {
        const a = s * (N + 1) + k, b = a + 1, c = a + N + 1, d = c + 1;
        if (o.flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    if (o.flat) {
      g = g.toNonIndexed();
    }
    g.computeVertexNormals();
    return this.add(mat, g, o);
  }
  /** irregular rock: displaced icosahedron, box-projected meter UVs */
  rock(mat, r, o = {}) {
    let g = new THREE.IcosahedronGeometry(1, o.detail ?? 1);
    g = g.index ? g.toNonIndexed() : g;
    const rr = makeRng(o.seed ?? 7);
    const sc = o.scale || [1, 1, 1];
    const pos = g.attributes.position;
    // deterministic displacement per unique direction
    const disp = new Map();
    const bumps = [];
    for (let k = 0; k < 6; k++) bumps.push([new THREE.Vector3(rr() - 0.5, rr() - 0.5, rr() - 0.5).normalize(), (rr() - 0.4) * 0.5]);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).normalize();
      const key = `${_v.x.toFixed(3)},${_v.y.toFixed(3)},${_v.z.toFixed(3)}`;
      let d = disp.get(key);
      if (d === undefined) {
        d = 1 + (rr() - 0.5) * (o.jag ?? 0.28);
        for (const [dir, amt] of bumps) d += Math.max(0, _v.dot(dir)) ** 3 * amt;
        disp.set(key, d);
      }
      let y = _v.y * d * r * sc[1];
      if (o.flatBottom !== false && y < -r * sc[1] * (o.sink ?? 0.35)) y = -r * sc[1] * (o.sink ?? 0.35) + (y + r * sc[1] * (o.sink ?? 0.35)) * 0.15;
      pos.setXYZ(i, _v.x * d * r * sc[0], y, _v.z * d * r * sc[2]);
    }
    g = mergeVerticesByPos(g);
    g.computeVertexNormals();
    // box projection per vertex by dominant normal
    const nrm = g.attributes.normal, p2 = g.attributes.position;
    const uvs = new Float32Array(p2.count * 2);
    for (let i = 0; i < p2.count; i++) {
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
      const x = p2.getX(i), y = p2.getY(i), z = p2.getZ(i);
      if (ny >= nx && ny >= nz) uvs.set([x, z], i * 2);
      else if (nx >= nz) uvs.set([z, y], i * 2);
      else uvs.set([x, y], i * 2);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return this.add(mat, g, o);
  }
  /** merge another builder's content in (under the current transform) */
  include(other) {
    for (const [mat, list] of other.lists) for (const g of list) this.add(mat, g.clone(), { raw: true, keepColor: true });
  }
  /** returns [{name, material, geometry}] one merged geometry per material */
  build() {
    const out = [];
    for (const [mat, list] of this.lists) {
      if (!list.length) continue;
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!g) throw new Error(`MeshBuilder: merge failed for ${mat}`);
      if (this.ao && g.attributes.color) {
        const pos = g.attributes.position, col = g.attributes.color;
        const H = this.aoHeight;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          const t = Math.min(1, Math.max(0, (y + 0.05) / H));
          const k = 0.55 + 0.45 * t * t * (3 - 2 * t);
          col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
        }
      }
      g.computeBoundingBox();
      g.computeBoundingSphere();
      out.push({ name: mat, material: MAT[mat], geometry: g });
    }
    return out;
  }
}

/** merge vertices with equal positions (keeps smooth normals on displaced solids) */
function mergeVerticesByPos(g) {
  const pos = g.attributes.position;
  const map = new Map();
  const newPos = [];
  const idx = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = newPos.length / 3;
      map.set(key, k);
      newPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    idx.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  out.setIndex(idx);
  return out;
}

/** Build a THREE.Group of meshes (shared geometry + shared materials) from build() parts */
export function partsToGroup(parts, name = '') {
  const grp = new THREE.Group();
  grp.name = name;
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.name = p.name;
    grp.add(m);
  }
  return grp;
}
