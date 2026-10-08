// The pictures on Dead Hand's cards (ui/cardface.js): the game's own models, drawn once each by a small WebGL renderer
// of their own and kept as images for as long as the page lasts. A card's art (shared/cards.js) says what it is of:
//   ['z', ZTYPE, variant] one of the dead (ui/portrait.js frames it, as the bestiary does; the same cache)
//   ['s', seed, ITEM]     a survivor holding that item, from the waist up    ['c', charId] a character's portrait
//   ['p', propType]       a prop, three-quarters from above                  ['d', variant] a deer   ['cat'] the cat
//   ['g', glyph] / ['i', ITEM]: no drawing - the glyph or the item's icon is the picture
// Until a picture is drawn (or if drawing it fails) the card shows a glyph of what it is.
//
// Cheap on purpose: nothing is drawn per frame, and only what is on screen is drawn (an IntersectionObserver on each
// card's picture asks for it as it comes into view, so a deck builder's grid of 70 cards draws what is scrolled to).
// The renderer is made for a batch and let go of as soon as nothing more is asked for (dispose and forceContextLoss):
// the game's own context is never kept waiting by a second one. A batch of pictures is drawn side by side into one
// canvas and read back from the graphics card once (reading back waits for everything sent to it, the game's frames
// included: picker.js CharacterStage.sheet). Pixel ratio 1.5 at most.
import * as THREE from 'three';
import { glyph, itemIcon } from './icons.js';
import { MonsterStage, monsterPic, keepMonsterPic, PW, PH } from './portrait.js';

const W = PW; // a picture, css px (the bestiary's portrait size: one cache serves both)
const H = PH;
const BATCH = 6; // pictures read back at once
const DRAWN = new Set(['z', 's', 'c', 'p', 'd', 'cat']);

const cache = new Map(); // art key -> data URL ('': drawing it failed, the glyph stays)
const arts = new Map(); // art key -> the art
const waiting = new Map(); // art key -> Set of <img> to give it to
const queue = [];
let running = null;
let io = null;

export const artKey = (art) => (Array.isArray(art) ? art.join(':') : '');
const isDrawn = (art) => Array.isArray(art) && DRAWN.has(art[0]);

// What a card shows until (or instead of) its picture: markup of a glyph (trusted, ours)
export function artGlyph(art) {
  if (!Array.isArray(art)) return glyph('cards');
  switch (art[0]) {
    case 'g':
      return glyph(art[1]);
    case 'i':
      return itemIcon(art[1]);
    case 'z':
      return glyph('skull');
    case 's':
    case 'c':
      return glyph('person');
    case 'p':
      return glyph('car');
    case 'd':
    case 'cat':
      return glyph('paw');
  }
  return glyph('cards');
}

// The picture already drawn for this art ('' if none yet)
export function artUrl(art) {
  const key = artKey(art);
  return cache.get(key) || (art?.[0] === 'z' ? monsterPic(art[1], art[2]) : '') || '';
}

function show(img, url) {
  if (!url || !img.isConnected && !img.parentElement) return;
  if (img.getAttribute('src') !== url) img.src = url;
  img.hidden = false;
  img.parentElement?.classList.add('has-art');
}

// Gives an <img> of a card its picture: at once if it is drawn, else as soon as it is (asked for when it scrolls into
// view). Nothing for a glyph's art.
export function fillArt(img, art) {
  if (!isDrawn(art)) return;
  const url = artUrl(art);
  if (url) return show(img, url);
  const key = artKey(art);
  if (cache.has(key)) return; // (drawing it failed: the glyph)
  arts.set(key, art);
  let set = waiting.get(key);
  if (!set) waiting.set(key, (set = new Set()));
  set.add(img);
  img.dataset.art = key;
  if (typeof IntersectionObserver === 'undefined') return want(key);
  // (the picture's box is watched, not the <img>: hidden until it has a picture, that never comes into view)
  const box = img.parentElement || img;
  box.dataset.art = key;
  io ||= new IntersectionObserver(
    (list) => {
      for (const e of list) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        want(e.target.dataset.art);
      }
    },
    { rootMargin: '120px' },
  );
  io.observe(box);
}

function want(key) {
  if (!key || cache.has(key) || queue.includes(key)) return;
  queue.push(key);
  running ||= draw().catch((err) => console.error('cards: pictures failed', err));
}

function done(key, url) {
  cache.set(key, url);
  const set = waiting.get(key);
  waiting.delete(key);
  if (set) for (const img of set) if (img.dataset.art === key) show(img, url);
}

async function draw() {
  try {
    const [characters, props, deer, cat, gun, gunDefs] = await Promise.all([
      import('../render/models/characters.js'),
      import('../render/models/props.js'),
      import('../render/models/deer.js'),
      import('../render/models/cat.js'),
      import('../render/models/mountedgun.js'),
      import('../../shared/mountedgun.js'),
    ]);
    const stage = new ArtStage({ characters, props, deer, cat, gun, pivotY: gunDefs.GUN.pivotY || 1.18 });
    try {
      while (queue.length) {
        await new Promise((go) => requestAnimationFrame(go));
        const keys = queue.splice(0, BATCH).filter((k) => !cache.has(k));
        if (!keys.length) continue;
        const urls = stage.sheet(keys.map((k) => arts.get(k)));
        keys.forEach((k, i) => {
          done(k, urls[i]);
          const a = arts.get(k);
          if (urls[i] && a[0] === 'z') keepMonsterPic(a[1], a[2], urls[i]);
        });
      }
    } finally {
      stage.dispose();
    }
  } finally {
    running = null;
    if (queue.length) running = draw().catch((err) => console.error('cards: pictures failed', err));
  }
}

// ---------------------------------------------------------------- the renderer
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();

class ArtStage {
  constructor(m) {
    this.m = m;
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.setClearColor(0x000000, 0);
    this.monster = new MonsterStage(m.characters, this.renderer);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xcfd6e0, 0x3a3024, 1.7));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.position.set(-3, 5, -4);
    const rim = new THREE.DirectionalLight(0xa8b8ff, 1.7);
    rim.position.set(3, 3, 4);
    this.scene.add(key, rim);
    this.camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 200);
  }

  // Draws several pictures side by side and reads them back once: -> [data URL | '' (failed)]
  sheet(list) {
    const r = this.renderer;
    const pr = r.getPixelRatio();
    r.setSize(W * list.length, H, false);
    r.setScissorTest(true);
    const ok = list.map((art, k) => {
      r.setViewport(k * W, 0, W, H);
      r.setScissor(k * W, 0, W, H);
      try {
        this.draw(art);
        return true;
      } catch (err) {
        console.warn(`cards: no picture of ${artKey(art)}`, err);
        r.clear();
        return false;
      }
    });
    r.setScissorTest(false);
    const all = document.createElement('canvas');
    all.width = this.canvas.width;
    all.height = this.canvas.height;
    const ax = all.getContext('2d', { willReadFrequently: true });
    ax.drawImage(this.canvas, 0, 0);
    const one = document.createElement('canvas');
    one.width = Math.round(W * pr);
    one.height = Math.round(H * pr);
    const ox = one.getContext('2d');
    return list.map((art, k) => {
      if (!ok[k]) return '';
      ox.clearRect(0, 0, one.width, one.height);
      ox.drawImage(all, Math.round(k * W * pr), 0, one.width, one.height, 0, 0, one.width, one.height);
      return one.toDataURL('image/webp', 0.86);
    });
  }

  draw(art) {
    switch (art[0]) {
      case 'z':
        return this.monster.draw(art[1], art[2] | 0, W / H);
      case 's':
        return this.person(art[1] | 0, -1, art[2] | 0);
      case 'c':
        return this.person(art[1] | 0, art[1] | 0, 0);
      case 'p':
        return this.thing(this.prop(String(art[1])), new THREE.Vector3(-0.75, 0.5, -1), 1.02);
      case 'd': {
        const d = this.m.deer.createDeer(art[1] | 0, 3);
        for (let i = 0; i < 30; i++) d.update(1 / 30, 0, 0, 1 + i / 30, true);
        return this.thing(d.object, new THREE.Vector3(-1, 0.28, -0.55), 1.05, () => d.dispose?.());
      }
      case 'cat': {
        const c = this.m.cat.createCat(0, 3, false);
        for (let i = 0; i < 30; i++) c.update(1 / 30, 0, 0, 1 + i / 30);
        return this.thing(c.object, new THREE.Vector3(-0.8, 0.45, -1), 1.1, () => c.dispose?.());
      }
    }
    throw new Error('no such art');
  }

  prop(type) {
    // (the Mounted Gun's prop is only where its tripod stands - the ammo cans: the gun is its own model)
    if (type === 'mg_tripod') {
      const g = new THREE.Group();
      const stand = this.m.gun.createGunStand();
      const gun = this.m.gun.createGunMount();
      gun.position.y = this.m.pivotY;
      gun.rotation.x = 0.08;
      g.add(stand, gun);
      return g;
    }
    return this.m.props.createProp(type, 0);
  }

  // a survivor (look: a character, -1 for the seed's) holding an item, from the waist up; or (no item) a portrait
  person(seed, look, item) {
    const s = this.m.characters.createSurvivor(seed, look);
    const o = s.object;
    this.scene.add(o);
    try {
      o.rotation.y = item ? -0.5 : -0.35; // (they face -Z: toward the camera, turned a little)
      if (item) s.setWeapon(item);
      for (let i = 0; i < 20; i++) s.update(1 / 30, { speed: 0, sprint: false, crouch: false, pitch: 0, onGround: true, reloading: false, dead: false, time: 1 + i / 30 });
      o.updateMatrixWorld(true);
      s.headWorld(_head);
      const c = this.camera;
      c.aspect = W / H;
      if (item) {
        c.fov = 30;
        c.position.set(_head.x + 0.55, _head.y - 0.12, _head.z - 1.85);
        c.lookAt(_head.x + 0.05, _head.y - 0.36, _head.z);
      } else {
        c.fov = 24;
        c.position.set(_head.x + 0.14, _head.y + 0.03, _head.z - 1.05);
        c.lookAt(_head.x, _head.y - 0.1, _head.z);
      }
      c.near = 0.05;
      c.far = 20;
      c.updateProjectionMatrix();
      this.renderer.render(this.scene, c);
    } finally {
      this.scene.remove(o);
      s.dispose?.();
    }
  }

  // a model framed whole, seen along dir (toward it), fill: how much room is left round it
  thing(o, dir, fill, dispose = null) {
    this.scene.add(o);
    try {
      o.updateMatrixWorld(true);
      _box.setFromObject(o, true);
      if (_box.isEmpty()) throw new Error('nothing to draw');
      _box.getSize(_size);
      _box.getCenter(_mid);
      const c = this.camera;
      c.fov = 30;
      c.aspect = W / H;
      _dir.copy(dir).normalize();
      const half = Math.tan(THREE.MathUtils.degToRad(c.fov / 2));
      const rad = _size.length() / 2;
      const dist = (rad / Math.min(half, half * c.aspect)) * fill;
      c.position.copy(_mid).addScaledVector(_dir, dist);
      c.near = Math.max(0.02, dist / 50);
      c.far = dist * 4;
      c.updateProjectionMatrix();
      c.lookAt(_mid);
      this.renderer.render(this.scene, c);
    } finally {
      this.scene.remove(o);
      dispose?.();
    }
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
