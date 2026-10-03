// Ejected cases: real-profile lathe meshes per calibre, world-space rigid-body-lite physics (gravity, tumbling, bounce with
// restitution + friction on world.groundAt / world.raycast walls, settle lying on their side), pooled InstancedMeshes (layer 0),
// bounce sounds 'casing.<brass|shell>.<surface>'. Zero allocation per frame.
import * as THREE from 'three';
import { std } from '../../core/mats.js';

// profiles [r, y] from the head (y = 0) to the mouth; units metres; `met` 1 = metal, colour per vertex band
const TYPES = {
  '45acp': { len: 0.0228, prof: [[0, 0], [0.0059, 0], [0.00601, 0.0005], [0.00601, 0.0012], [0.0053, 0.0016], [0.0053, 0.0027], [0.0060, 0.0032], [0.00598, 0.0226], [0.0057, 0.0228], [0.0056, 0.0215]], col: 0xc9a14f, snd: 'brass' },
  '9mm': { len: 0.01915, prof: [[0, 0], [0.00488, 0], [0.00496, 0.0005], [0.00496, 0.0011], [0.0042, 0.0014], [0.0042, 0.0022], [0.00493, 0.0027], [0.00482, 0.0190], [0.00462, 0.01915], [0.0045, 0.018]], col: 0xcfa854, snd: 'brass' },
  '545': { len: 0.0398, prof: [[0, 0], [0.0049, 0], [0.0050, 0.0006], [0.0050, 0.0013], [0.0042, 0.0017], [0.0042, 0.0027], [0.0050, 0.0032], [0.00470, 0.0262], [0.0033, 0.0300], [0.00318, 0.0396], [0.0030, 0.0398], [0.0029, 0.038]], col: 0x5b5e44, snd: 'brass', steel: true },
  '762': { len: 0.0512, prof: [[0, 0], [0.0059, 0], [0.00601, 0.0007], [0.00601, 0.0013], [0.0051, 0.0018], [0.0051, 0.0030], [0.00598, 0.0036], [0.00575, 0.0395], [0.00445, 0.0425], [0.00435, 0.0510], [0.0041, 0.0512], [0.0040, 0.049]], col: 0xc49a4a, snd: 'brass' },
  '12ga': { len: 0.0698, prof: [[0, 0], [0.0108, 0], [0.0112, 0.0006], [0.0112, 0.0016], [0.0105, 0.0019], [0.0105, 0.0120], [0.01035, 0.0128], [0.01035, 0.0660], [0.0110, 0.0698], [0.0100, 0.0698], [0.0095, 0.066]], col: 0xc9a14f, snd: 'shell', hull: 0x8e1d18, head: 0.0122 },
};

function caseGeometry(T) {
  const pts = T.prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)); const g = new THREE.LatheGeometry(pts, 14); g.computeVertexNormals();
  const pos = g.attributes.position; const n = pos.count; const col = new Float32Array(n * 3), met = new Float32Array(n);
  const brass = new THREE.Color(T.col), hull = new THREE.Color(T.hull ?? T.col), primer = new THREE.Color(0xb07a4a);
  for (let i = 0; i < n; i++) { const y = pos.getY(i), r = Math.hypot(pos.getX(i), pos.getZ(i)); let c = brass, m = T.steel ? 0.55 : 1; if (T.hull && y > T.head) { c = hull; m = 0; } if (y < 0.0002 && r < 0.0024) { c = primer; m = 1; } col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; met[i] = m; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aMet', new THREE.BufferAttribute(met, 1));
  g.translate(0, -T.len / 2, 0); g.rotateX(Math.PI / 2); // case axis along Z, centred
  return g;
}
function caseMaterial() {
  const m = std({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 1, key: 'casing' });
  const base = m.onBeforeCompile; m.onBeforeCompile = (sh) => { base(sh); sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aMet; varying float vMet;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMet = aMet;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMet;').replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMet; roughnessFactor = mix(0.42, 0.26, vMet);'); };
  m.customProgramCacheKey = () => 'casingMet'; return m;
}

const _q = new THREE.Quaternion(), _ax = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _zero = new THREE.Matrix4().makeScale(0, 0, 0), _up = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3();
const HIT = { t: 0, nx: 0, ny: 0, nz: 0, surface: 'concrete' };

export class CasingSystem {
  constructor(scene, { max = 24, audio = null } = {}) {
    this.audio = audio; this.world = null; this.types = {}; const mat = caseMaterial(); this.mat = mat;
    for (const [k, T] of Object.entries(TYPES)) {
      const mesh = new THREE.InstancedMesh(caseGeometry(T), mat, max); mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.name = 'casings:' + k;
      for (let i = 0; i < max; i++) mesh.setMatrixAt(i, _zero); scene.add(mesh); mesh.visible = false;
      const P = []; for (let i = 0; i < max; i++) P.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), life: 0, bounces: 0, rest: false });
      this.types[k] = { T, mesh, P, i: 0, live: 0 };
    }
  }
  setWorld(w) { this.world = w; }
  /** spawn a case: pos, vel (world), orientation quaternion of the case axis, spin (rad/s vector) */
  spawn(type, pos, vel, q, spin) {
    const S = this.types[type]; if (!S) return; const c = S.P[S.i]; S.i = (S.i + 1) % S.P.length;
    c.pos.copy(pos); c.vel.copy(vel); c.q.copy(q); c.w.copy(spin); c.life = 9; c.bounces = 0; c.rest = false; S.mesh.visible = true;
  }
  update(dt) {
    const w = this.world; if (dt <= 0) return;
    for (const k in this.types) {
      const S = this.types[k]; if (!S.mesh.visible) continue; let live = 0; const snd = S.T.snd; let dirty = false;
      for (let i = 0; i < S.P.length; i++) {
        const c = S.P[i]; if (c.life <= 0) continue; c.life -= dt; dirty = true;
        if (c.life <= 0) { S.mesh.setMatrixAt(i, _zero); continue; } live++;
        if (!c.rest) {
          c.vel.y -= 9.81 * dt; c.vel.multiplyScalar(1 - 0.08 * dt); // light air drag
          const nx = c.pos.x + c.vel.x * dt, ny = c.pos.y + c.vel.y * dt, nz = c.pos.z + c.vel.z * dt;
          // walls: short ray along the horizontal motion
          const hs = Math.hypot(c.vel.x, c.vel.z) * dt;
          if (w && hs > 1e-4 && w.raycast(c.pos.x, c.pos.y, c.pos.z, c.vel.x * dt / hs, 0, c.vel.z * dt / hs, hs + 0.006, HIT) && HIT.ny < 0.5) {
            const vn = c.vel.x * HIT.nx + c.vel.z * HIT.nz; if (vn < 0) { c.vel.x -= 1.5 * vn * HIT.nx; c.vel.z -= 1.5 * vn * HIT.nz; c.w.multiplyScalar(-0.6); this._snd(snd, HIT.surface, c.pos, Math.min(1, -vn * 0.4)); }
          }
          const g = w ? w.groundAt(nx, nz, c.pos.y + 0.05) : null; const gy = g ? g.y : -1e9; const rad = 0.004;
          if (ny < gy + rad && c.vel.y < 0) {
            const vy = -c.vel.y; c.pos.set(nx, gy + rad, nz); c.vel.y = vy * (k === '12ga' ? 0.28 : 0.42); c.vel.x *= 0.62; c.vel.z *= 0.62; c.w.multiplyScalar(0.55); c.w.x += (Math.random() - 0.5) * 20; c.bounces++;
            if (vy > 0.35 || c.bounces === 1) this._snd(snd, g.surface, c.pos, Math.min(1, vy * 0.35));
            if (vy < 0.45 || c.bounces > 5) { // settle: lie on the side, random heading, roll a bit
              c.rest = true; c.vel.set(0, 0, 0); _ax.set(0, 0, 1).applyQuaternion(c.q); _ax.y = 0; if (_ax.lengthSq() < 1e-4) _ax.set(1, 0, 0); _ax.normalize(); _m.lookAt(_p.set(0, 0, 0), _ax, _up); c.q.setFromRotationMatrix(_m); c.pos.y = gy + (k === '12ga' ? 0.0105 : k === '762' ? 0.006 : 0.005);
            }
          } else c.pos.set(nx, ny, nz);
          const ang = c.w.length() * dt; if (ang > 1e-6) { _ax.copy(c.w).normalize(); _q.setFromAxisAngle(_ax, ang); c.q.premultiply(_q); }
        }
        _s.setScalar(1); _m.compose(c.pos, c.q, _s); S.mesh.setMatrixAt(i, _m);
      }
      if (dirty) S.mesh.instanceMatrix.needsUpdate = true; S.live = live; if (!live) S.mesh.visible = false;
    }
  }
  _snd(kind, surface, pos, vol) {
    const a = this.audio; if (!a || !a.ready || vol < 0.05) return;
    if (a.casing) { a.casing(pos, surface || 'concrete', kind === 'shell', vol > 0.5 ? 1 : 2); return; } // audio library helper (handles surface families)
    let m = this._names || (this._names = {}); const key = kind + surface; let n = m[key]; if (!n) n = m[key] = 'casing.' + kind + '.' + (surface || 'concrete');
    const o = this._po || (this._po = { pos: null, vol: 1, bus: 'sfx', minDist: 1, maxDist: 25 }); o.pos = pos; o.vol = 0.35 + vol * 0.6; a.play(n, o);
  }
}
export const CASING_TYPES = TYPES;
