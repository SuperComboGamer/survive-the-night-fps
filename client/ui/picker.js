// Choosing who to play as (the splash, under "Playing as"): the roster of shared/characters.js. A card on the splash
// shows the one chosen - a portrait, the name and what they did - with arrows through the roster; a click on it opens
// the picker, a grid of them all (and Random) beside a turntable of the one picked. The choice is kept in
// localStorage (stn.character: an id, or 'random') and goes to the server with the next JOIN (Game.join ->
// Connection.connect); Random draws one afresh at every join.
//
// The portraits and the turntable are drawn by a small WebGL renderer of their own (CharacterStage), made the first
// time the splash wants one and let go of when the game starts: it draws the real survivor models, the same ones the
// game does (models/characters.js createSurvivor).
import * as THREE from 'three';
import { CHARACTERS, CHARACTER_COUNT } from '../../shared/characters.js';
import { el, svgEl, lsGet, lsSet } from './dom.js';
import { glyph } from './icons.js';
import { Panel } from './games.js';

export const CHARACTER_KEY = 'stn.character';
export const RANDOM = 'random';

/** What the player chose: a character id, or RANDOM (the default). */
export function storedChoice() {
  const v = lsGet(CHARACTER_KEY, RANDOM);
  const n = Number(v);
  return v !== RANDOM && Number.isInteger(n) && n >= 0 && n < CHARACTER_COUNT ? n : RANDOM;
}
export function storeChoice(v) {
  lsSet(CHARACTER_KEY, v === RANDOM ? RANDOM : String(v | 0));
}
/** The character to join as: the one chosen, or (Random) one drawn now. */
export function chosenCharacter() {
  const c = storedChoice();
  return c === RANDOM ? (Math.random() * CHARACTER_COUNT) | 0 : c;
}

// ---------------------------------------------------------------- the renderer
let models = null; // models/characters.js, loaded with the stage (it pulls in every model builder)

/** A renderer of its own for the picker: portraits (cached as images) and the turntable. */
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
    this.scene.add(key, rim, fill);
    this.camera = new THREE.PerspectiveCamera(26, 0.7, 0.05, 30);
    this.people = new Map(); // id -> survivor (createSurvivor)
    this.portraits = new Map(); // id -> the picture's URL
    this.blobs = []; // (the object URLs among them: let go of with the stage)
    this.time = 0;
  }

  person(id) {
    let s = this.people.get(id);
    if (!s) {
      s = models.createSurvivor(id, id);
      s.object.visible = false;
      this.scene.add(s.object);
      this.people.set(id, s);
    }
    return s;
  }

  // pose one at its clock (standing easy) and show only it
  pose(id, yaw) {
    for (const [k, s] of this.people) s.object.visible = k === id;
    const s = this.person(id);
    s.object.visible = true;
    s.object.rotation.y = yaw;
    s.update(1 / 60, { speed: 0, sprint: false, crouch: false, pitch: 0, onGround: true, reloading: false, dead: false, time: this.time });
    return s;
  }

  /** A head-and-shoulders portrait, as an image (made once). */
  portrait(id) {
    let url = this.portraits.get(id);
    if (url) return url;
    this.shoot(id);
    url = this.canvas.toDataURL('image/png');
    this.portraits.set(id, url);
    return url;
  }

  /**
   * The same into an <img>, without holding the frame for it: the picture is drawn now and encoded off the main
   * thread (the picker's grid makes ten of these as it opens, one a frame: CharacterPanel.show).
   */
  portraitInto(id, img) {
    const url = this.portraits.get(id);
    if (url) return void (img.src = url);
    this.shoot(id);
    this.canvas.toBlob((blob) => {
      if (!blob) return void (img.src = this.portrait(id));
      const u = URL.createObjectURL(blob);
      if (!this.portraits.has(id)) this.portraits.set(id, u);
      this.blobs.push(u);
      img.src = this.portraits.get(id);
    }, 'image/png');
  }

  // draws the portrait of one into the canvas
  shoot(id) {
    const W = 160, H = 200;
    this.renderer.setSize(W, H, false);
    this.time = 1.3;
    const s = this.pose(id, -0.35); // (they face -Z: toward the camera, turned a little)
    s.object.updateMatrixWorld(true);
    const head = s.object.userData.head.getWorldPosition(new THREE.Vector3());
    this.camera.aspect = W / H;
    this.camera.fov = 24;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(head.x + 0.12, head.y + 0.03, head.z - 0.95);
    this.camera.lookAt(head.x, head.y - 0.07, head.z);
    this.renderer.render(this.scene, this.camera);
  }

  /** The turntable: the whole figure, turning, into this.canvas at w x h (css px). */
  turn(id, w, h, dt) {
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) this.renderer.setSize(w, h, false);
    this.time += dt;
    const s = this.pose(id, Math.PI + 0.5 * Math.sin(this.time * 0.6) + this.time * 0.35);
    this.camera.aspect = w / h;
    this.camera.fov = 24;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 1.0, 4.2);
    this.camera.lookAt(0, 0.92, 0);
    void s;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const s of this.people.values()) s.dispose();
    this.people.clear();
    for (const u of this.blobs) URL.revokeObjectURL(u);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}

let stage = null;
let stageWait = null;
async function getStage() {
  if (stage) return stage;
  if (!stageWait)
    stageWait = (async () => {
      models = models || (await import('../render/models/characters.js'));
      stage = new CharacterStage();
      return stage;
    })();
  return stageWait;
}
/** Let go of the picker's renderer (the game starting: its context and models are not needed in play). */
export function releaseStage() {
  if (stage) stage.dispose();
  stage = null;
  stageWait = null;
}

// ---------------------------------------------------------------- the splash's card
/**
 * The card on the splash: label, arrows, portrait, name, role and line. A click on the portrait or the name opens
 * the picker (CharacterPanel).
 */
export class CharacterCard {
  constructor(ui, parent, panelParent, before = null) {
    this.root = el('div', 'cp-card');
    if (before) parent.insertBefore(this.root, before);
    else parent.appendChild(this.root);
    el('span', 'sp-field-l', this.root, 'Survivor');
    const row = el('div', 'cp-row', this.root);
    this.prev = svgEl('button', 'btn btn-ghost cp-arrow', row, glyph('arrowLeft'));
    this.prev.type = 'button';
    this.prev.title = 'Previous survivor';
    this.prev.setAttribute('aria-label', 'Previous survivor');
    this.face = el('button', 'cp-face', row);
    this.face.type = 'button';
    this.face.title = 'Choose who to play as';
    this.img = el('img', 'cp-img', this.face);
    this.img.alt = '';
    this.q = el('span', 'cp-q', this.face, '?');
    const txt = el('button', 'cp-txt', row);
    txt.type = 'button';
    txt.title = 'Choose who to play as';
    this.name = el('span', 'cp-name', txt, '');
    this.role = el('span', 'cp-role', txt, '');
    this.line = el('span', 'cp-line', txt, '');
    this.next = svgEl('button', 'btn btn-ghost cp-arrow', row, glyph('arrowRight'));
    this.next.type = 'button';
    this.next.title = 'Next survivor';
    this.next.setAttribute('aria-label', 'Next survivor');
    this.panel = new CharacterPanel(ui, panelParent, this);
    this.prev.addEventListener('click', () => this.step(-1));
    this.next.addEventListener('click', () => this.step(1));
    this.face.addEventListener('click', () => this.panel.show());
    txt.addEventListener('click', () => this.panel.show());
    this.sync();
  }

  // through the roster, Random as the one before the first
  step(d) {
    const c = storedChoice();
    const order = [RANDOM, ...CHARACTERS.map((ch) => ch.id)];
    const i = order.indexOf(c);
    this.choose(order[(i + d + order.length) % order.length]);
  }

  choose(v) {
    storeChoice(v);
    this.sync();
    this.panel.sync();
  }

  async sync() {
    const c = storedChoice();
    const ch = c === RANDOM ? null : CHARACTERS[c];
    this.name.textContent = ch ? ch.name : 'Random';
    this.role.textContent = ch ? ch.role : 'A different survivor every time';
    this.line.textContent = ch ? ch.line : 'Who you are is drawn from the ten when you join.';
    this.root.classList.toggle('random', !ch);
    this.q.hidden = !!ch;
    this.img.hidden = !ch;
    if (ch) {
      const st = await getStage();
      if (storedChoice() === c) this.img.src = st.portrait(c);
    }
  }

  show() {
    this.sync();
  }
}

// ---------------------------------------------------------------- the picker
export class CharacterPanel extends Panel {
  constructor(ui, parent, card) {
    super(ui, parent, 'cp-panel', 'Survivors');
    this.card = card;
    this.sub.textContent = 'Who you play as. Others see them too; two of you may pick the same one.';
    const wrap = el('div', 'cp-wrap', this.body);
    this.grid = el('div', 'cp-grid', wrap);
    const side = el('div', 'cp-side', wrap);
    this.view = el('div', 'cp-view', side);
    this.vName = el('div', 'cp-vname', side, '');
    this.vRole = el('div', 'cp-vrole', side, '');
    this.vLine = el('p', 'cp-vline', side, '');
    this.cells = new Map();
    const cell = (v, label, role) => {
      const b = el('button', 'cp-cell', this.grid);
      b.type = 'button';
      const f = el('span', 'cp-cface', b);
      if (v === RANDOM) el('span', 'cp-q', f, '?');
      else {
        const img = el('img', 'cp-img', f);
        img.alt = '';
        b.img = img;
      }
      el('span', 'cp-cname', b, label);
      el('span', 'cp-crole', b, role);
      b.addEventListener('click', () => this.pick(v));
      b.addEventListener('dblclick', () => {
        this.pick(v);
        this.hide();
      });
      this.cells.set(v, b);
    };
    for (const ch of CHARACTERS) cell(ch.id, ch.name, ch.role);
    cell(RANDOM, 'Random', 'Any of them');
    const done = el('button', 'btn btn-blood cp-done', this.foot);
    done.type = 'button';
    el('span', '', done, 'Done');
    done.addEventListener('click', () => this.hide());
    this.shown = storedChoice();
    this.raf = 0;
  }

  pick(v) {
    this.shown = v;
    this.card.choose(v);
  }

  sync() {
    const c = storedChoice();
    this.shown = c;
    for (const [v, b] of this.cells) b.classList.toggle('on', v === c);
    const ch = c === RANDOM ? null : CHARACTERS[c];
    this.vName.textContent = ch ? ch.full : 'Random';
    this.vRole.textContent = ch ? ch.role : 'Any of the ten';
    this.vLine.textContent = ch ? ch.line : 'A different survivor is drawn for you every time you join.';
    this.root.classList.toggle('random', !ch);
  }

  async show() {
    super.show();
    this.sync();
    const st = await getStage();
    if (this.root.hidden) return;
    this.view.appendChild(st.canvas);
    // the portraits, a step a frame: one frame a survivor's model is made, the next its picture is drawn (and
    // encoded off the main thread) - two a frame of both held every frame of the panel's opening for 50 ms and more
    const ids = CHARACTERS.map((c) => c.id);
    const next = () => {
      if (this.root.hidden || !ids.length) return;
      const id = ids[0];
      const b = this.cells.get(id);
      if (!b || b.img.src) ids.shift();
      else if (!st.people.has(id) && !st.portraits.has(id)) st.person(id);
      else {
        ids.shift();
        st.portraitInto(id, b.img);
      }
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
    let last = performance.now();
    const frame = (now) => {
      if (this.root.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!ids.length) {
        const r = this.view.getBoundingClientRect();
        const id = this.shown === RANDOM ? Math.floor(now / 2500) % CHARACTER_COUNT : this.shown;
        if (r.width > 10) st.turn(id, r.width, r.height, dt);
      }
      this.raf = requestAnimationFrame(frame);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(frame);
  }

  hide() {
    super.hide();
    cancelAnimationFrame(this.raf);
    this.card.sync();
  }
}
