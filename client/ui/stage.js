// The splash's own little renderer for survivors (the picker, client/ui/picker.js, and the character creator,
// client/ui/creator.js): portraits (cached as images) and a turntable, drawn with the real survivor models, the same
// ones the game draws (models/characters.js createSurvivor). Made the first time the splash wants one and let go of
// when the game starts (releaseStage).
//
// A survivor here is a reference: a roster id (shared/characters.js), or a custom survivor's look key ('a:<code>':
// shared/appearance.js lookKey). The creator's preview is a model of its own (transient), made again at every change.
import * as THREE from 'three';
import { lookKey } from '../../shared/appearance.js';

let models = null; // models/characters.js, loaded with the stage (it pulls in every model builder)
let looks = null; // models/looks.js (appearanceOfRoster)

const IDLE = { speed: 0, sprint: false, crouch: false, pitch: 0, onGround: true, reloading: false, dead: false };

class CharacterStage {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cp-stage';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xcfd6e0, 0x3a3024, 1.6));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.position.set(-2.5, 4, -4);
    const rim = new THREE.DirectionalLight(0xa8b8ff, 1.6);
    rim.position.set(3, 3, 4);
    const fill = new THREE.DirectionalLight(0xffd8b0, 0.6);
    fill.position.set(3, 1, -2);
    // (the creator turns the figure toward the camera: a light from the camera's side too, so a face is seen)
    const front = new THREE.DirectionalLight(0xfff4e8, 0.9);
    front.position.set(0.5, 2, 5);
    this.scene.add(key, rim, fill, front);
    this.camera = new THREE.PerspectiveCamera(26, 0.7, 0.05, 30);
    this.people = new Map(); // ref -> survivor (createSurvivor)
    this.portraits = new Map(); // ref -> the picture's URL
    this.preview = null; // the creator's: { key, sv }
    this.time = 0;
    this.focus = 0; // 0: the whole figure .. 1: the head (the creator's face and hair)
  }

  /** A roster or saved survivor (built once, kept while the stage lives). */
  person(ref) {
    let s = this.people.get(ref);
    if (!s) {
      s = models.createSurvivor(typeof ref === 'number' ? ref : 1, ref);
      s.object.visible = false;
      this.scene.add(s.object);
      this.people.set(ref, s);
    }
    return s;
  }

  /** The creator's preview of a look (values: shared/appearance.js): made again only when the look changed. */
  previewOf(values) {
    const key = lookKey(values);
    if (this.preview && this.preview.key === key) return this.preview.sv;
    this.dropPreview();
    const sv = models.createSurvivor(1, key, { transient: true });
    sv.object.visible = false;
    this.scene.add(sv.object);
    this.preview = { key, sv };
    return sv;
  }
  dropPreview() {
    if (!this.preview) return;
    this.preview.sv.dispose();
    this.preview = null;
  }

  // pose one at its clock (standing easy) and show only it
  pose(s, yaw) {
    for (const p of this.people.values()) p.object.visible = false;
    if (this.preview) this.preview.sv.object.visible = false;
    s.object.visible = true;
    s.object.rotation.y = yaw;
    s.update(1 / 60, { ...IDLE, time: this.time });
    return s;
  }

  /** A head-and-shoulders portrait, as an image (made once). */
  portrait(ref) {
    let url = this.portraits.get(ref);
    if (url) return url;
    this.shoot(this.person(ref));
    url = this.canvas.toDataURL('image/png');
    this.portraits.set(ref, url);
    return url;
  }

  /**
   * The portraits of several at once, for the picker's grid: all of them drawn side by side into the one canvas and
   * read back from the graphics card ONCE. (Reading a picture back waits for the card to finish everything it has
   * been sent, the game's own frames included: ten portraits read one after another were ten such waits, and they
   * were most of the freeze as the picker opened.) Returns a sheet to cut the pictures from: sheet.cut(ref) is that
   * one's URL, encoded then, from memory.
   */
  sheet(refs) {
    const W = 160, H = 200;
    refs = refs.filter((ref) => !this.portraits.has(ref));
    const r = this.renderer;
    const pr = r.getPixelRatio();
    r.setSize(W * Math.max(1, refs.length), H, false);
    r.setScissorTest(true);
    refs.forEach((ref, k) => {
      r.setViewport(k * W, 0, W, H);
      r.setScissor(k * W, 0, W, H);
      this.shoot(this.person(ref), false);
    });
    r.setScissorTest(false);
    r.setViewport(0, 0, W * Math.max(1, refs.length), H);
    // (a canvas kept in memory, not on the card: cutting from it and encoding its pieces waits for nothing)
    const all = document.createElement('canvas');
    all.width = this.canvas.width;
    all.height = this.canvas.height;
    const ax = all.getContext('2d', { willReadFrequently: true });
    if (refs.length) ax.drawImage(this.canvas, 0, 0);
    const one = document.createElement('canvas');
    one.width = Math.round(W * pr);
    one.height = Math.round(H * pr);
    const ox = one.getContext('2d', { willReadFrequently: true });
    return {
      cut: (ref) => {
        const k = refs.indexOf(ref);
        if (k >= 0 && !this.portraits.has(ref)) {
          ox.clearRect(0, 0, one.width, one.height);
          ox.drawImage(all, Math.round(k * W * pr), 0, one.width, one.height, 0, 0, one.width, one.height);
          this.portraits.set(ref, one.toDataURL('image/png'));
        }
        return this.portrait(ref);
      },
    };
  }

  // draws the portrait of one into the canvas (sized: the canvas made its size first; the sheet sizes its own)
  shoot(s, sized = true) {
    const W = 160, H = 200;
    if (sized) this.renderer.setSize(W, H, false);
    this.time = 1.3;
    this.pose(s, -0.35); // (they face -Z: toward the camera, turned a little)
    s.object.updateMatrixWorld(true);
    const head = s.object.userData.head.getWorldPosition(new THREE.Vector3());
    this.camera.aspect = W / H;
    this.camera.fov = 24;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(head.x + 0.12, head.y + 0.03, head.z - 0.95);
    this.camera.lookAt(head.x, head.y - 0.07, head.z);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * The turntable: one survivor (a ref, or the creator's preview survivor), turning, into this.canvas at w x h (css
   * px). o.focus: 'head' eases the camera in to the face; o.yaw: turned by hand this much more; o.still: no turning
   * of its own (the creator: it faces the camera, swaying, and the player turns it).
   */
  turn(who, w, h, dt, o = {}) {
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio())) this.renderer.setSize(w, h, false);
    this.time += dt;
    const s = typeof who === 'object' ? who : this.person(who);
    const spin = o.still ? 0.35 * Math.sin(this.time * 0.5) : 0.5 * Math.sin(this.time * 0.6) + this.time * 0.35;
    this.pose(s, Math.PI + spin + (o.yaw || 0));
    this.focus += ((o.focus === 'head' ? 1 : 0) - this.focus) * Math.min(1, dt * 5);
    s.object.updateMatrixWorld(true);
    const hy = s.object.userData.head.getWorldPosition(_head).y;
    const k = this.focus * this.focus * (3 - 2 * this.focus);
    this.camera.aspect = w / h;
    this.camera.fov = 24 - 6 * k;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 1.0 + (hy + 0.02 - 1.0) * k, 4.2 + (1.45 - 4.2) * k);
    this.camera.lookAt(0, 0.92 + (hy - 0.03 - 0.92) * k, 0);
    this.renderer.render(this.scene, this.camera);
  }

  /** A saved survivor's portraits and model, when its look changed or it was deleted. */
  forget(ref) {
    const s = this.people.get(ref);
    if (s) s.dispose();
    this.people.delete(ref);
    this.portraits.delete(ref);
  }

  dispose() {
    for (const s of this.people.values()) s.dispose();
    this.people.clear();
    this.dropPreview();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
const _head = new THREE.Vector3();

let stage = null;
let stageWait = null;
/** The stage, made (and the models loaded) the first time it is wanted. */
export async function getStage() {
  if (stage) return stage;
  if (!stageWait)
    stageWait = (async () => {
      models = models || (await import('../render/models/characters.js'));
      looks = looks || (await import('../render/models/looks.js'));
      stage = new CharacterStage();
      return stage;
    })();
  return stageWait;
}
/** models/looks.js, once the stage is loaded (appearanceOfRoster: "Make one like Dale"). */
export const looksModule = () => looks;
/** Let go of the stage's renderer (the game starting: its context and models are not needed in play). */
export function releaseStage() {
  if (stage) stage.dispose();
  stage = null;
  stageWait = null;
}
