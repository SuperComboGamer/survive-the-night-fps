// The bestiary [J]: every kind of the dead (shared/bestiary.js), a card each with a portrait, the name and what it does.
// A kind never seen is a dark smudge of a portrait, "???" and a vague line; once seen (net/bestiary.js) the portrait
// clears and the card says how it fights and how to fight it. "Seen X of Y" in the head. Opened by its key and from the
// pause menu; the cross, its key, Esc or a click outside the frame closes it (the game sets onClose).
//
// The portraits are the game's own models (models/characters.js createZombie), drawn by a small WebGL renderer of its
// own the first time the book opens, kept as images, and the renderer let go of again. A locked card is only given the
// smudge (made from the drawing in a canvas): no clear portrait of a kind not seen is put in the page.
import * as THREE from 'three';
import { ZANIM, ZOMBIE_DEFS } from '../../shared/defs.js';
import { BESTIARY, BESTIARY_GROUPS, SEEN_RANGE, bit, seenCount } from '../../shared/bestiary.js';
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { bindLabel, liveText } from '../game/binds.js';
import { bestiaryView, onBestiary } from '../net/bestiary.js';

const PW = 240; // a portrait, css px
const PH = 200;
const GROUP_TAG = { horde: 'Horde', special: 'Special', boss: 'Boss' };

// ---------------------------------------------------------------- the portraits
const pics = new Map(); // ztype -> { clear, dark } (data URLs), for as long as the page lasts
let picsWait = null;

class MonsterStage {
  constructor(models) {
    this.models = models;
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(PW, PH, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.setClearColor(0x000000, 0);
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

  // one kind, posed standing, framed whole -> { clear, dark }
  shoot(t) {
    const z = this.models.createZombie(t, 1);
    const o = z.object;
    this.scene.add(o);
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
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fit = Math.max(this.size.y / 2 / half, Math.max(this.size.x, this.size.z) / 2 / (half * this.camera.aspect));
    const dist = fit * 1.06 + Math.max(this.size.x, this.size.z) * 0.25;
    this.camera.position.copy(this.mid).addScaledVector(this.dir, dist);
    this.camera.near = Math.max(0.05, dist / 50);
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.mid);
    this.renderer.render(this.scene, this.camera);
    const clear = this.canvas.toDataURL('image/png');
    const dark = smudge(this.canvas);
    this.scene.remove(o);
    z.dispose?.();
    return { clear, dark };
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}

// What a kind not seen yet looks like: its shape in one flat murky tone, blurred past making out. Drawn at a quarter
// size, its outline blurred there (a box blur, three times over, of the coverage), and stretched back up.
const SMUDGE_R = 2; // px of the quarter-size drawing
function smudge(src) {
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

// Draws every kind's portrait, a couple a frame (each, as it is done, to onPic(t)), then lets the renderer go
function drawPortraits(onPic) {
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

// ---------------------------------------------------------------- the book
export class Bestiary {
  constructor(ui, parent) {
    this.ui = ui;
    this.open = false;
    this.onClose = null; // the game's: the cross, the key, Esc, a click outside

    this.root = el('div', 'bstscr', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Bestiary');
    const bg = el('div', 'map-bg', this.root);
    const frame = el('div', 'bst-frame paper', this.root);
    const head = el('div', 'map-head', frame);
    el('span', 'map-title', head, 'Bestiary');
    this.count = el('span', 'map-coords', head, '');
    const close = (this.close = svgEl('button', 'set-close btn-icon map-close', head, glyph('xmark')));
    close.type = 'button';
    close.setAttribute('aria-label', 'Close bestiary');
    liveText(close, () => `Close (${bindLabel('bestiary')})`, 'title');
    close.addEventListener('click', () => this.onClose?.());
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      this.onClose?.();
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && (e.target === bg || e.target === this.root)) this.onClose?.();
    });

    el('p', 'bst-rule', frame, `A page fills in once you have seen one of them: within ${SEEN_RANGE} m, in plain sight.`);
    this.body = el('div', 'bst-body', frame);
    this.cards = new Map(); // ztype -> { card, img, name, text }
    this.groupNs = new Map(); // group -> its "n / m"
    for (const [g, title] of BESTIARY_GROUPS) {
      const list = BESTIARY.filter((e) => e.group === g);
      const sec = el('section', 'bst-group', this.body);
      const h = el('div', 'fr-h bst-group-h', sec);
      el('span', '', h, title);
      this.groupNs.set(g, [el('span', 'bst-group-n', h, ''), list]);
      const grid = el('div', 'bst-grid', sec);
      for (const e of list) {
        const card = el('article', 'bst-card locked', grid);
        const pic = el('div', 'bst-pic', card);
        const img = el('img', '', pic);
        img.alt = '';
        img.hidden = true;
        svgEl('i', 'bst-lock', pic, glyph('question'));
        const b = el('div', 'bst-card-b', card);
        const top = el('div', 'bst-card-top', b);
        const name = el('b', 'bst-name', top, '???');
        el('span', `bst-tag tag-${e.group}`, top, GROUP_TAG[e.group]);
        const text = el('p', 'bst-text', b, '');
        this.cards.set(e.t, { card, img, name, text });
      }
    }

    const foot = el('div', 'map-keys bst-keys', frame);
    for (const [k, t] of [
      [() => bindLabel('bestiary'), 'close'],
      ['Esc', 'close'],
    ]) {
      const s = el('span', 'gh', foot);
      if (typeof k === 'function') liveText(el('span', 'kbd sm', s), k);
      else el('span', 'kbd sm', s, k);
      el('span', '', s, t);
    }
    this.kept = el('span', 'bst-kept', foot, '');

    onBestiary(() => this.open && this.render());
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
    this.ui.root.classList.toggle('bestiary-open', open);
    if (open) {
      this.render();
      this.body.scrollTop = 0;
      this.returnFocus = document.activeElement;
      this.close.focus({ preventScroll: true });
      drawPortraits((t) => this.open && this.renderPic(t)).catch((err) => console.error('bestiary: portraits failed', err));
    } else if (this.returnFocus?.isConnected && !this.returnFocus.closest?.('[hidden]')) {
      this.returnFocus.focus({ preventScroll: true });
      this.returnFocus = null;
    }
  }

  render() {
    const v = (this.view = bestiaryView());
    this.count.textContent = v.loading ? 'Looking up your record…' : `Seen ${seenCount(v.mask)} of ${BESTIARY.length}`;
    this.kept.textContent = v.account ? 'Kept on your account' : 'Kept in this browser';
    for (const [g, [n, list]] of this.groupNs) n.textContent = `${list.filter((e) => v.mask & bit(e.t)).length} / ${list.length}`;
    for (const e of BESTIARY) {
      const c = this.cards.get(e.t);
      const seen = !!(v.mask & bit(e.t));
      c.card.classList.toggle('locked', !seen);
      c.card.classList.toggle('seen', seen);
      c.name.textContent = seen ? e.name : '???';
      c.text.textContent = seen ? e.tip : e.vague;
      this.renderPic(e.t);
    }
  }

  renderPic(t) {
    const c = this.cards.get(t);
    const seen = !!(this.view?.mask & bit(t));
    const src = pics.get(t)?.[seen ? 'clear' : 'dark'] || '';
    if (c.img.getAttribute('src') !== src) {
      if (src) c.img.src = src;
      else c.img.removeAttribute('src');
    }
    c.img.hidden = !src;
  }
}
