// The interaction highlight (the "Interaction highlight" setting): a faint outline on the one thing [E] would act on,
// while it is in reach and the prompt offers it, so what can be used reads at a glance without anything else in the
// valley glowing.
//
// What: Game.lookTarget, the very target the prompt is about, and only while that prompt offers [E] or [X] (the
// interact and demolish keys, whatever they are bound to: game/binds.js). A
// searched container, the workbench or "the car needs ..." only say what they are and get none, so an outline
// always means "this can be used". Nothing at a distance: finding loot from afar is the glints' job
// (Entities.update), and the glint of whatever is outlined goes out while it is.
//
// How: an inverted hull. Each mesh of the target gets a shell: its back faces, every vertex pushed out across the
// screen by a fixed number of pixels along a normal smoothed over the vertices that share its position (the
// models' hard edges would otherwise tear the shell open at every corner). The object hides the shell everywhere
// but a thin band around its silhouette, and the depth test hides it behind whatever stands in front, so it
// never shows through a wall. Each shell is drawn twice: once into depth only, then in colour where it is the
// nearest shell (EqualDepth), so where shells overlap the line is blended once and stays even. Costs two draws
// per mesh of one object while something is outlined and none otherwise, and needs no stencil, depth texture or
// extra pass, so it is the same with MSAA off (Low quality, PS1 mode, where it snaps to the low-res pixel grid
// with everything else).
//
// Its brightness is set in display terms (divided by the exposure the final pass multiplies by), so it neither
// fades out by day nor turns into a lamp at night, and stays far under the bloom threshold.
//
// Containers, the radio, the car and the fair's generator are drawn merged into the static world's chunks, with no
// object of their own to follow: their shells are built from the same prop (createProp) at the same place. The
// bell rope is a pair of world-gen cylinders, rebuilt the same way.
import * as THREE from 'three';
import { ENT, dqpos } from '../../shared/protocol.js';
import { CONT } from '../../shared/defs.js';
import { fixtureSpots } from '../../shared/fixtures.js';
import { WHEEL } from '../../shared/fair.js';
import { createProp } from '../render/models/props.js';
import { bindTag } from './binds.js';

// per setting: line width (CSS px on a 1080-line screen, scaled with the screen's height), opacity, and brightness
// on screen before tone mapping (linear; the final pass's exposure is taken out)
const LOOK = {
  subtle: { px: 1.6, alpha: 0.55, lum: 0.36 },
  strong: { px: 2.6, alpha: 0.85, lum: 0.7 },
};
const COLOR = [1.0, 0.92, 0.76]; // warm off-white, the glints' colour (entities.js glintTexture)
const NIGHT_DIM = 0.3; // this much dimmer at full night, when the screen around it is near black
const FADE_IN = 0.12; // s
const FADE_OUT = 0.2; // s
// a prompt that offers something to do: it names the interact key or the demolish key
const offers = (prompt) => prompt.includes(bindTag('interact')) || prompt.includes(bindTag('demolish'));
const PROP_CACHE = 24; // prop stand-ins kept for coming back to

// ---------------------------------------------------------------- shells

// The source geometry's position (and skinning), with hullNormal: its normals averaged over every vertex at the same
// position. One per source geometry, sharing its buffers; disposed with it.
const hulls = new WeakMap();
function hullGeometry(src) {
  let h = hulls.get(src);
  if (h) return h;
  const pos = src.attributes.position;
  const nrm = src.attributes.normal;
  const n = pos.count;
  const keys = new Array(n);
  const sums = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    keys[i] = k;
    let s = sums.get(k);
    if (!s) sums.set(k, (s = [0, 0, 0]));
    if (nrm) {
      s[0] += nrm.getX(i);
      s[1] += nrm.getY(i);
      s[2] += nrm.getZ(i);
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = sums.get(keys[i]);
    let x = s[0];
    let y = s[1];
    let z = s[2];
    let l = Math.hypot(x, y, z);
    // (faces back to back, a sheet with two sides: they cancel, and the vertex keeps its own)
    if (l < 1e-3 && nrm) {
      x = nrm.getX(i);
      y = nrm.getY(i);
      z = nrm.getZ(i);
      l = Math.hypot(x, y, z);
    }
    if (l > 0) {
      out[i * 3] = x / l;
      out[i * 3 + 1] = y / l;
      out[i * 3 + 2] = z / l;
    }
  }
  h = new THREE.BufferGeometry();
  for (const name of ['position', 'skinIndex', 'skinWeight']) if (src.attributes[name]) h.setAttribute(name, src.attributes[name]);
  h.setAttribute('hullNormal', new THREE.BufferAttribute(out, 3));
  if (src.index) h.setIndex(src.index);
  h.setDrawRange(src.drawRange.start, src.drawRange.count);
  src.addEventListener('dispose', () => h.dispose());
  hulls.set(src, h);
  return h;
}

// shared by every shell material: the line's width in pixels of the target, the target's size in pixels
const U = { uHullPx: { value: 1 }, uHullRes: { value: new THREE.Vector2(1, 1) } };

const HULL_VERTEX = /* glsl */ `
#include <project_vertex>
{
  vec3 hullN = hullNormal;
  #ifdef USE_SKINNING
    hullN = (skinMatrix * vec4(hullN, 0.0)).xyz;
  #endif
  #ifdef USE_INSTANCING
    hullN = mat3(instanceMatrix) * hullN;
  #endif
  // the way the normal points across the screen, in pixels of the target; out along it by uHullPx
  vec2 hullDir = (projectionMatrix * vec4(normalMatrix * hullN, 0.0)).xy * uHullRes;
  float hullLen = length(hullDir);
  if (hullLen > 1e-6 && gl_Position.w > 0.0) {
    gl_Position.xy += hullDir / hullLen * (2.0 * uHullPx / uHullRes) * gl_Position.w;
    // (PS1 mode: back onto the low-res pixel grid, as globals.js snaps everything else)
    if (uPs1.x > 0.0) gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uPs1.xy + 0.5) / uPs1.xy * gl_Position.w;
  }
}
`;

// depth: the depth-only pass (true) or the colour pass drawn where it left the nearest shell (false)
function hullMaterial(depth) {
  const m = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: depth,
    colorWrite: !depth,
    depthFunc: depth ? THREE.LessDepth : THREE.EqualDepth,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 hullNormal;\nuniform float uHullPx;\nuniform vec2 uHullRes;')
      .replace('#include <project_vertex>', HULL_VERTEX);
  };
  m.customProgramCacheKey = () => 'interaction-hull';
  return m;
}

// every shell's depth-only pass shares one material (it draws no colour, so there is nothing of its own to fade)
const DEPTH_MAT = hullMaterial(true);
// what the meshes of a stand-in wear: they are never drawn, only their shells are
const STAND_IN_MAT = new THREE.MeshBasicMaterial();

// a shell of `src` (a Mesh or SkinnedMesh) in `mat`, drawn where src is: its world matrix (and bind matrices) are
// taken from src just before it is drawn, when three has brought src's up to date
function makeShell(src, mat, order) {
  const geo = hullGeometry(src.geometry);
  const skinned = src.isSkinnedMesh;
  const s = skinned ? new THREE.SkinnedMesh(geo, mat) : new THREE.Mesh(geo, mat);
  if (skinned) {
    s.bind(src.skeleton, src.bindMatrix);
    s.bindMode = THREE.DetachedBindMode; // (the matrices are src's, copied below)
  }
  s.matrixAutoUpdate = false;
  s.matrixWorldAutoUpdate = false;
  s.frustumCulled = false;
  s.renderOrder = order;
  s.raycast = () => {};
  s.onBeforeRender = () => {
    s.matrixWorld.copy(src.matrixWorld);
    if (skinned) {
      s.bindMatrix.copy(src.bindMatrix);
      s.bindMatrixInverse.copy(src.bindMatrixInverse);
    }
  };
  return s;
}

// would three draw o? (it and every parent visible, all the way up to the scene; a stand-in has no parent to ask)
function shown(o, scene) {
  for (; o; o = o.parent) {
    if (!o.visible) return false;
    if (o === scene || o.userData.hullStandIn) return true;
  }
  return false;
}

// which meshes of a model get a shell: solid ones (not glass, flames, glows, beams or the like)
function solid(o) {
  if (!(o.isMesh || o.isSkinnedMesh) || o.isInstancedMesh || !o.geometry?.attributes.position) return false;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  return !!m && m.visible !== false && !m.transparent && m.blending === THREE.NormalBlending && m.depthWrite !== false && m.colorWrite !== false;
}

// ---------------------------------------------------------------- the outline

export class Highlight {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.group.name = 'interaction-highlight';
    this.entries = new WeakMap(); // target root -> { pairs: its shells, mat: their colour material, a: fade 0..1 }
    this.live = []; // entries drawn now (fading in, shown, fading out)
    this.standIns = new Map(); // key -> the prop or parts stand-in (null: nothing to outline there)
    this.focus = null; // the entity outlined now: Entities.update puts out its glint
    this.target = null; // the root outlined now
  }

  // after Game.updateLookTarget, every frame of play
  update(dt) {
    const g = this.g;
    if (this.group.parent !== g.scene) g.scene.add(this.group);
    const look = LOOK[g.settings?.highlight ?? 'subtle'];
    const root = look ? this.targetObject() : null;
    let cur = root ? this.entries.get(root) : null;
    if (root && !cur) this.entries.set(root, (cur = { pairs: [], mat: hullMaterial(false), a: 0 }));
    // (shelled afresh each time it is taken up: a model can have gained or lost meshes since, a gun in a hand)
    if (cur && !this.live.includes(cur)) {
      this.build(root, cur);
      if (cur.pairs.length) {
        for (const p of cur.pairs) this.group.add(p.depth, p.color);
        this.live.push(cur);
      } else cur = null;
    }
    this.target = cur ? root : null;
    this.focus = cur && typeof g.lookTarget === 'object' && g.lookTarget.kind !== undefined ? g.lookTarget : null;
    if (!this.live.length) return;
    // the line's width: so many pixels of a 1080-line screen, in pixels of the frame drawn (never under one)
    const rt = g.renderer.rt;
    const H = window.innerHeight || 1;
    const px = (look || LOOK.subtle).px * Math.max(0.75, H / 1080);
    U.uHullPx.value = Math.max(1, (px * rt.height) / H);
    U.uHullRes.value.set(rt.width, rt.height);
    const lum = ((look || LOOK.subtle).lum * (1 - NIGHT_DIM * (g.env?.night || 0))) / Math.max(0.1, g.env?.exposure || 1);
    const alpha = (look || LOOK.subtle).alpha;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.a = Math.min(1, Math.max(0, e.a + (e === cur ? dt / FADE_IN : -dt / FADE_OUT)));
      if (e.a <= 0) {
        for (const p of e.pairs) this.group.remove(p.depth, p.color);
        this.live.splice(i, 1);
        continue;
      }
      const a = e.a * e.a * (3 - 2 * e.a);
      e.mat.opacity = alpha * a;
      e.mat.color.setRGB(COLOR[0] * lum, COLOR[1] * lum, COLOR[2] * lum);
      for (const p of e.pairs) p.depth.visible = p.color.visible = shown(p.src, g.scene);
    }
  }

  // shells for every solid mesh of root, into its entry e (one colour material per root: each fades on its own)
  build(root, e) {
    e.pairs.length = 0;
    root.traverse((o) => {
      if (solid(o)) e.pairs.push({ src: o, depth: makeShell(o, DEPTH_MAT, 1), color: makeShell(o, e.mat, 2) });
    });
  }

  // The object to outline: what the prompt is about, if it offers [E] or [X]. null: nothing.
  targetObject() {
    const g = this.g;
    const t = g.lookTarget;
    if (!t || !offers(g.prompt || '')) return null;
    if (t === 'car') return this.propAt('car', g.world.car.x, g.world.car.z, 0.05);
    if (t === 'radio') {
      const r = fixtureSpots(g.world).radio;
      return r && this.propAt('radio_set', r.x, r.z, 1);
    }
    if (t === 'bell') return this.bellRope();
    if (t === 'gun') return g.gun.manning ? null : g.gun.model; // (not the gun in our own hands)
    if (t.handcar) return t.handcar === 'board' ? g.handcar.cars[t.k]?.model || null : null;
    if (t.fair) {
      const f = g.world.fair;
      if (t.fair === 'gen') return this.propAt('generator', f.gen.x, f.gen.z, 0.05);
      if (t.fair === 'tank') return this.propAt('barrel', f.tank.x, f.tank.z, 0.05);
      const v = g.fair.view;
      if (t.fair === 'seat' && v) return (t.seat < WHEEL.n ? v.gondolas[t.seat] : v.horses[t.seat - WHEEL.n]) || null;
      return null; // (getting off)
    }
    switch (t.kind) {
      case ENT.ITEM:
      case ENT.CRATE:
      case ENT.STRUCTURE:
        return t.obj || null;
      case ENT.PLAYER:
        return t.view?.object || null;
      case ENT.CACHE:
        return this.containerAt(t);
    }
    return null;
  }

  // the prop a container was built with: at its very spot, or for the trunk of a wreck, the wreck it is behind
  containerAt(e) {
    const x = dqpos(e.q[0]);
    const z = dqpos(e.q[2]);
    if (e.ctype !== CONT.TRUNK) return this.propAt(null, x, z, 0.06);
    return this.standIn(`trunk:${x.toFixed(2)},${z.toFixed(2)}`, () => {
      // (world.js wreck(): the trunk is `back` metres behind the wreck's origin, the way it faces)
      let best = null;
      let bestD = 4.5;
      for (const p of this.g.world.props) {
        const dx = x - p.x;
        const dz = z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < bestD && Math.abs(dx - Math.sin(p.ry) * d) < 0.08 && Math.abs(dz - Math.cos(p.ry) * d) < 0.08) {
          best = p;
          bestD = d;
        }
      }
      return best && propStandIn(best);
    });
  }

  // the nearest prop (of this type, if given) to x, z within maxD, as a stand-in
  propAt(type, x, z, maxD) {
    return this.standIn(`${type}:${x.toFixed(2)},${z.toFixed(2)}`, () => {
      let best = null;
      let bestD = maxD * maxD;
      for (const p of this.g.world.props) {
        if (type && p.type !== type) continue;
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d <= bestD) {
          best = p;
          bestD = d;
        }
      }
      return best && propStandIn(best);
    });
  }

  // the chapel's bell rope and its sally: world-gen cylinders (world.js CHURCH) hanging at the rope spot
  bellRope() {
    const rope = fixtureSpots(this.g.world).bell?.rope;
    if (!rope) return null;
    return this.standIn('bell-rope', () => {
      const root = new THREE.Group();
      for (const p of this.g.world.parts) {
        if (p.shape !== 'cyl' || (p.mat !== 'rope' && p.mat !== 'taillight') || (p.x - rope.x) ** 2 + (p.z - rope.z) ** 2 > 0.04) continue;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(p.sx / 2, p.sx / 2, p.sy, p.sides || 14, 1), STAND_IN_MAT);
        m.position.set(p.x, p.y, p.z);
        m.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0, 'XYZ');
        root.add(m);
      }
      if (!root.children.length) return null;
      root.userData.hullStandIn = true;
      root.updateMatrixWorld(true);
      return root;
    });
  }

  standIn(key, make) {
    if (this.standIns.has(key)) {
      const v = this.standIns.get(key);
      this.standIns.delete(key); // (to the back of the line)
      this.standIns.set(key, v);
      return v;
    }
    const v = make() || null;
    this.standIns.set(key, v);
    if (this.standIns.size > PROP_CACHE) this.standIns.delete(this.standIns.keys().next().value);
    return v;
  }

  // Game.warmViews: the two programs a shell can need (on a mesh, on a skinned mesh) built with everything else
  // before play. skinned: a SkinnedMesh to borrow a skeleton from.
  warm(skinned) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
    const mat = hullMaterial(false);
    const out = [new THREE.Mesh(hullGeometry(box.geometry), DEPTH_MAT), new THREE.Mesh(hullGeometry(box.geometry), mat)];
    if (skinned) {
      for (const m of [DEPTH_MAT, mat]) {
        const s = new THREE.SkinnedMesh(hullGeometry(skinned.geometry), m);
        s.bind(skinned.skeleton, skinned.bindMatrix);
        out.push(s);
      }
    }
    return out;
  }

  // a new world: the stand-ins were of the old one's props
  reset() {
    this.standIns.clear();
    for (const e of this.live) {
      for (const p of e.pairs) this.group.remove(p.depth, p.color);
      e.a = 0;
    }
    this.live.length = 0;
    this.focus = this.target = null;
  }
}

// A prop of the world (world.props) where the static world drew it, with the meshes createProp builds it from: never
// drawn itself, only its shells are.
function propStandIn(p) {
  let obj;
  try {
    obj = createProp(p.type, p.seed);
  } catch {
    return null;
  }
  obj.position.set(p.x, p.y, p.z);
  obj.rotation.y = p.ry;
  obj.userData.hullStandIn = true;
  obj.updateMatrixWorld(true);
  return obj;
}
