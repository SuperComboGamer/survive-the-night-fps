// Portraits of the dead: the game's own models (models/characters.js createZombie), posed standing and framed whole by
// a small WebGL renderer, kept as images for as long as the page lasts. Two pages show them: the bestiary [J]
// (ui/bestiary.js: drawPortraits, a clear one and the dark smudge of a kind not seen yet) and Dead Hand's cards
// (ui/cardart.js, which lends a MonsterStage its own renderer and reads a whole batch back at once). One cache for
// both: a kind drawn for the one is not drawn again for the other.
import * as THREE from 'three';
import { ZANIM, ZOMBIE_DEFS } from '../../shared/defs.js';
import { BESTIARY } from '../../shared/bestiary.js';

export const PW = 240; // a portrait, css px
export const PH = 200;
export const BESTIARY_SEED = 1; // (the bestiary's portrait of a kind: the model built with this seed)

// `${ztype}:${seed}` -> the clear portrait (a data URL), for as long as the page lasts
const clear = new Map();
export const monsterPic = (t, seed = BESTIARY_SEED) => clear.get(`${t}:${seed}`) || '';
export const keepMonsterPic = (t, seed, url) => url && clear.set(`${t}:${seed}`, url);

// the bestiary's: ztype -> { clear, dark }
export const pics = new Map();
let picsWait = null;

export class MonsterStage {
  // renderer: one to draw with (Dead Hand's art stage lends its own; it stays the lender's to size and dispose).
  // None: a renderer of its own, PW x PH
  constructor(models, renderer = null) {
    this.models = models;
    this.own = !renderer;
    if (renderer) this.renderer = renderer;
    else {
      this.canvas = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.setSize(PW, PH, false);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.35;
      this.renderer.setClearColor(0x000000, 0);
    }
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xcfd6e0, 0x3a3024, 1.7));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.8);
    key.position.set(-3, 5, -4);
    const rim = new THREE.DirectionalLight(0xa8b8ff, 1.8);
    rim.position.set(3, 3, 4);
    this.scene.add(key, rim);
    this.camera = new THREE.PerspectiveCamera(30, PW / PH, 0.05, 80);
    this.box = new THREE.Box3();
    this.size = new THREE.Vector3();
    this.mid = new THREE.Vector3();
    this.dir = new THREE.Vector3(-0.42, 0.2, -1).normalize(); // from the front, a little to its right and above
  }

  // one kind (seed: which of its looks), posed standing, framed whole, drawn into the renderer's viewport as it is set
  // (aspect: that viewport's width / height)
  draw(t, seed = BESTIARY_SEED, aspect = PW / PH) {
    const z = this.models.createZombie(t, seed);
    const o = z.object;
    this.scene.add(o);
    try {
      // (the gaze and the near copy of the model go by the viewer: here, this camera. The game sets it again each frame)
      const near = 6;
      this.models.setZombieViewer(this.dir.x * near, 1.4 + this.dir.y * near, this.dir.z * near);
      for (let i = 0; i < 40; i++) z.update(1 / 30, ZANIM.IDLE, 0, 1 + i / 30, true);
      o.updateMatrixWorld(true);
      // framed by where its bones are (the models skin themselves: a box of the mesh is the rest pose's; '__' bones are
      // helpers, not the body), and at least as tall and as wide as the kind is (a bloater's flesh is far past its bones)
      const d = ZOMBIE_DEFS[t];
      const box = this.box.makeEmpty();
      o.traverse((m) => m.isSkinnedMesh && m.skeleton.bones.forEach((b) => b.name.startsWith('__') || box.expandByPoint(b.getWorldPosition(this.mid))));
      if (box.isEmpty()) box.setFromObject(o);
      box.expandByScalar(0.06);
      box.max.y += d.headR;
      if (!d.flying) {
        box.min.y = Math.min(box.min.y, 0);
        box.max.y = Math.max(box.max.y, d.height);
        box.min.x = Math.min(box.min.x, -d.radius);
        box.max.x = Math.max(box.max.x, d.radius);
      }
      box.getSize(this.size);
      box.getCenter(this.mid);
      this.camera.aspect = aspect;
      const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const fit = Math.max(this.size.y / 2 / half, Math.max(this.size.x, this.size.z) / 2 / (half * this.camera.aspect));
      const dist = fit * 1.06 + Math.max(this.size.x, this.size.z) * 0.25;
      this.camera.position.copy(this.mid).addScaledVector(this.dir, dist);
      this.camera.near = Math.max(0.05, dist / 50);
      this.camera.far = dist * 4;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.mid);
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.scene.remove(o);
      z.dispose?.();
    }
  }

  // the bestiary's: one kind -> { clear, dark } (its own renderer, PW x PH)
  shoot(t) {
    this.draw(t, BESTIARY_SEED, PW / PH);
    const c = this.canvas.toDataURL('image/png');
    keepMonsterPic(t, BESTIARY_SEED, c);
    return { clear: c, dark: smudge(this.canvas) };
  }

  dispose() {
    if (!this.own) return;
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}

// What a kind not seen yet looks like: its shape in one flat murky tone, blurred past making out. Drawn at a quarter
// size, its outline blurred there (a box blur, three times over, of the coverage), and stretched back up.
const SMUDGE_R = 2; // px of the quarter-size drawing
export function smudge(src) {
  const canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    return [c, x];
  };
  const w = Math.round(PW / 4);
  const h = Math.round(PH / 4);
  const [small, sx] = canvas(w, h);
  sx.drawImage(src, 0, 0, w, h);
  const im = sx.getImageData(0, 0, w, h);
  const d = im.data;
  let a = new Float32Array(w * h);
  let b = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  const n = 2 * SMUDGE_R + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -SMUDGE_R; k <= SMUDGE_R; k++) s += a[y * w + Math.min(w - 1, Math.max(0, x + k))];
        b[y * w + x] = s / n;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -SMUDGE_R; k <= SMUDGE_R; k++) s += b[Math.min(h - 1, Math.max(0, y + k)) * w + x];
        a[y * w + x] = s / n;
      }
  }
  for (let i = 0; i < a.length; i++) {
    d[i * 4] = 120;
    d[i * 4 + 1] = 128;
    d[i * 4 + 2] = 120;
    d[i * 4 + 3] = Math.round(a[i] * 0.7);
  }
  sx.putImageData(im, 0, 0);
  const [out, ox] = canvas(PW, PH);
  ox.drawImage(small, 0, 0, PW, PH);
  return out.toDataURL('image/png');
}

// The bestiary's: draws every kind's portrait, a couple a frame (each, as it is done, to onPic(t)), then lets the
// renderer go
export function drawPortraits(onPic) {
  if (picsWait) return picsWait;
  picsWait = (async () => {
    const models = await import('../render/models/characters.js');
    const stage = new MonsterStage(models);
    const todo = BESTIARY.map((e) => e.t).filter((t) => !pics.has(t));
    try {
      while (todo.length) {
        await new Promise((go) => requestAnimationFrame(go));
        for (let k = 0; k < 2 && todo.length; k++) {
          const t = todo.shift();
          try {
            pics.set(t, stage.shoot(t));
          } catch (err) {
            console.error(`bestiary: no portrait of kind ${t}`, err);
            pics.set(t, { clear: '', dark: '' });
          }
          onPic(t);
        }
      }
    } finally {
      stage.dispose();
    }
  })();
  return picsWait;
}
