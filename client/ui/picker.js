// Choosing who to play as (the splash, under "Playing as"): one of the roster of shared/characters.js, Random (one of
// them drawn at every join), Random stranger (a survivor made up: shared/appearance.js randomLook - a new one at every
// click of its dice, and after every join), or one of the player's own (the character creator: client/ui/creator.js,
// kept by client/ui/customs.js).
// A card on the splash shows the one chosen - a portrait, the name and what they did - with arrows through them all; a
// click on it opens the picker, a grid of them beside a turntable of the one picked, from which the creator is opened.
// The choice is kept in localStorage (stn.character: an id, 'random', 'stranger' or 'c:<custom id>'; the stranger
// made up last in stn.stranger, its lookCode) and goes to the server with the next JOIN (Game.join ->
// Connection.connect).
//
// The portraits and the turntable are drawn by a small WebGL renderer of their own (client/ui/stage.js).
import { CHARACTERS, CHARACTER_COUNT } from '../../shared/characters.js';
import { randomLook, lookKey, lookCode, fromLookCode, mulberry } from '../../shared/appearance.js';
import { el, svgEl, lsGet, lsSet } from './dom.js';
import { glyph } from './icons.js';
import { Panel } from './games.js';
import { customs, getCustom, MAX_CUSTOMS, takeNote, onCustomsChange } from './customs.js';
import { getStage, looksModule, releaseStage } from './stage.js';
import { CreatorPanel } from './creator.js';

export { releaseStage };
export const CHARACTER_KEY = 'stn.character';
export const RANDOM = 'random';
export const STRANGER = 'stranger';
const isCustom = (v) => typeof v === 'string' && v.startsWith('c:');
const customOf = (v) => (isCustom(v) ? getCustom(v.slice(2)) : null);

/** What the player chose: a character id, RANDOM (the default), STRANGER, or 'c:<id>' (a saved survivor of theirs). */
export function storedChoice() {
  const v = lsGet(CHARACTER_KEY, RANDOM);
  if (v === STRANGER) return STRANGER;
  if (isCustom(v)) return customOf(v) ? v : RANDOM;
  const n = Number(v);
  return v !== RANDOM && Number.isInteger(n) && n >= 0 && n < CHARACTER_COUNT ? n : RANDOM;
}
export function storeChoice(v) {
  lsSet(CHARACTER_KEY, typeof v === 'number' ? String(v | 0) : v);
}

// The stranger: the one on the turntable is the one the next join is (made up when there is none, kept until then)
export const STRANGER_KEY = 'stn.stranger';
let strangerNow = null; // { code, values }
function stranger() {
  if (strangerNow) return strangerNow.values;
  const code = lsGet(STRANGER_KEY, '');
  const values = code ? fromLookCode(code) : null;
  if (!values) return rollStranger();
  strangerNow = { code, values };
  return values;
}
/** Another stranger, made up now (a click of the Stranger's dice; every join, for the next). */
export function rollStranger() {
  const values = randomLook(mulberry((Math.random() * 2 ** 32) >>> 0));
  strangerNow = { code: lookCode(values), values };
  lsSet(STRANGER_KEY, strangerNow.code);
  return values;
}

/**
 * Who to join as: { character, look }. A roster survivor (the one chosen, or Random's draw now) has a character and no
 * look; a custom one (a saved survivor, or the stranger shown) a look (shared/appearance.js values) and no character.
 * Joining as the stranger makes up the next one.
 */
export function chosenCharacter() {
  const c = storedChoice();
  if (c === RANDOM) return { character: (Math.random() * CHARACTER_COUNT) | 0, look: null };
  if (c === STRANGER) {
    const look = stranger();
    rollStranger();
    return { character: null, look };
  }
  if (isCustom(c)) return { character: null, look: customOf(c).values };
  return { character: c, look: null };
}
// the stage's reference for a choice: a roster id, a saved survivor's look key; null for Random and Random stranger
// (a key is worked out once per look: the turntable asks every frame)
const keys = new WeakMap();
function refOf(c) {
  if (typeof c === 'number') return c;
  const cu = customOf(c);
  if (!cu) return null;
  let k = keys.get(cu.values);
  if (!k) keys.set(cu.values, (k = lookKey(cu.values)));
  return k;
}
// every choice, in the order the card's arrows go through them
const order = () => [RANDOM, STRANGER, ...CHARACTERS.map((ch) => ch.id), ...customs().map((c) => 'c:' + c.id)];

// what the card and the side of the picker say about a choice
function describe(c) {
  if (c === RANDOM) return { name: 'Random', full: 'Random', role: 'A different survivor every time', line: 'Who you are is drawn from the ten when you join.' };
  if (c === STRANGER) return { name: 'Stranger', full: 'Random stranger', role: 'A brand-new face every time', line: 'Someone the valley has never seen. Click the dice for another; each time you join, a new one.' };
  const cu = customOf(c);
  if (cu) return { name: cu.name, full: cu.name, role: 'Your survivor', line: 'Made by you. Everyone sees how they look; the name stays with you.' };
  const ch = CHARACTERS[c];
  return { name: ch.name, full: ch.full, role: ch.role, line: ch.line };
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
    this.dice = svgEl('span', 'cp-q cp-dice', this.face, glyph('dice'));
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
    this.note = el('p', 'cp-note', this.root, '');
    this.note.hidden = true;
    this.panel = new CharacterPanel(ui, panelParent, this);
    this.prev.addEventListener('click', () => this.step(-1));
    this.next.addEventListener('click', () => this.step(1));
    this.face.addEventListener('click', () => this.panel.show());
    txt.addEventListener('click', () => this.panel.show());
    this.sync();
  }

  // through them all, Random first
  step(d) {
    const c = storedChoice();
    const o = order();
    const i = o.indexOf(c);
    this.choose(o[(i + d + o.length) % o.length]);
  }

  choose(v) {
    storeChoice(v);
    this.sync();
    this.panel.sync();
  }

  async sync() {
    const c = storedChoice();
    const d = describe(c);
    this.name.textContent = d.name;
    this.role.textContent = d.role;
    this.line.textContent = d.line;
    const ref = refOf(c);
    this.root.classList.toggle('random', ref === null);
    this.q.hidden = c !== RANDOM;
    this.dice.hidden = c !== STRANGER;
    this.img.hidden = ref === null;
    // a saved survivor of theirs with parts no longer in the game: said once, here
    const note = isCustom(c) ? takeNote(c.slice(2)) : '';
    if (note) {
      this.note.textContent = note;
      this.note.hidden = false;
    }
    if (ref !== null) {
      const st = await getStage();
      if (storedChoice() === c) this.img.src = st.portrait(ref);
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
    const lists = el('div', 'cp-lists', wrap);
    el('h4', 'cp-group', lists, 'The ten');
    this.grid = el('div', 'cp-grid', lists);
    el('h4', 'cp-group', lists, 'Yours');
    this.mine = el('div', 'cp-grid cp-mine', lists);
    const side = el('div', 'cp-side', wrap);
    this.view = el('div', 'cp-view', side);
    this.vName = el('div', 'cp-vname', side, '');
    this.vRole = el('div', 'cp-vrole', side, '');
    this.vLine = el('p', 'cp-vline', side, '');
    this.acts = el('div', 'cp-acts', side);
    this.cells = new Map();
    for (const ch of CHARACTERS) this.cell(this.grid, ch.id, ch.name, ch.role);
    this.cell(this.grid, RANDOM, 'Random', 'Any of the ten');
    this.cell(this.grid, STRANGER, 'Stranger', 'Made up each time');
    const done = el('button', 'btn btn-blood cp-done', this.foot);
    done.type = 'button';
    el('span', '', done, 'Done');
    done.addEventListener('click', () => this.hide());
    this.creator = new CreatorPanel(ui, parent, {
      saved: (id) => {
        this.fillMine();
        this.card.choose('c:' + id);
        this.show();
      },
      deleted: (id) => {
        if (storedChoice() === 'c:' + id || lsGet(CHARACTER_KEY, '') === 'c:' + id) storeChoice(RANDOM);
        this.fillMine();
        this.card.sync();
        this.show();
      },
      closed: () => this.show(),
    });
    this.fillMine();
    this.shown = storedChoice();
    this.raf = 0;
    // (merged with the account's: survivors made in another browser come in, ones deleted there go)
    onCustomsChange((why) => {
      if (why !== 'sync') return;
      this.fillMine();
      if (!this.root.hidden) this.sync();
      this.card.sync();
    });
  }

  cell(parent, v, label, role, cls = '') {
    const b = el('button', 'cp-cell' + (cls ? ' ' + cls : ''), parent);
    b.type = 'button';
    const f = el('span', 'cp-cface', b);
    if (v === RANDOM) el('span', 'cp-q', f, '?');
    else if (v === STRANGER) svgEl('span', 'cp-q cp-dice', f, glyph('dice'));
    else if (v === 'create') svgEl('span', 'cp-q cp-plus', f, glyph('plus'));
    else {
      const img = el('img', 'cp-img', f);
      img.alt = '';
      b.img = img;
    }
    el('span', 'cp-cname', b, label);
    el('span', 'cp-crole', b, role);
    if (v === 'create') b.addEventListener('click', () => this.create());
    else {
      // (the Stranger's dice: every click, another one)
      b.addEventListener('click', () => {
        if (v === STRANGER) rollStranger();
        this.pick(v);
      });
      b.addEventListener('dblclick', () => {
        this.pick(v);
        this.hide();
      });
      this.cells.set(v, b);
    }
    return b;
  }

  // the player's own: one cell each, and "Create" while there is room
  fillMine() {
    for (const v of [...this.cells.keys()]) if (isCustom(v)) this.cells.delete(v);
    this.mine.textContent = '';
    for (const c of customs()) this.cell(this.mine, 'c:' + c.id, c.name, 'Your survivor');
    if (customs().length < MAX_CUSTOMS) this.cell(this.mine, 'create', 'Create', 'Make your own');
    if (!this.root.hidden) this.portraits();
  }

  pick(v) {
    this.shown = v;
    this.card.choose(v);
  }

  sync() {
    const c = storedChoice();
    this.shown = c;
    for (const [v, b] of this.cells) b.classList.toggle('on', v === c);
    const d = describe(c);
    this.vName.textContent = d.full;
    this.vRole.textContent = d.role;
    this.vLine.textContent = d.line;
    this.root.classList.toggle('random', refOf(c) === null);
    // what can be done from here: make one like a roster survivor, change or copy one's own
    this.acts.textContent = '';
    const act = (label, fn, title = '') => {
      const b = el('button', 'btn btn-ghost cp-act', this.acts, label);
      b.type = 'button';
      if (title) b.title = title;
      b.addEventListener('click', fn);
    };
    const room = customs().length < MAX_CUSTOMS;
    if (typeof c === 'number' && room) act(`Make one like ${CHARACTERS[c].name}`, () => this.create(c), 'Open the creator with them to start from');
    const cu = customOf(c);
    if (cu) {
      act('Edit', () => this.edit({ id: cu.id, name: cu.name, values: cu.values }));
      if (room) act('Copy', () => this.edit({ name: cu.name.slice(0, 13) + ' 2', values: cu.values }));
    }
    if (c === STRANGER) act('Roll another', () => rollStranger(), 'Another stranger, made up now');
    if (c === STRANGER && room) act('Keep one', () => this.create('stranger'), 'Open the creator with the stranger on the turntable');
  }

  /** Opens the creator: from a roster survivor's id, the stranger being shown, or (nothing) a stranger of its own. */
  async create(from = null) {
    // (a new one closed unsaved: "Create" goes back to it)
    if (from === null && this.creator.draft && !this.creator.draft.id) return this.edit(this.creator.draft);
    await getStage();
    let values;
    if (typeof from === 'number') values = looksModule().appearanceOfRoster(from);
    else if (from === 'stranger') values = stranger();
    else values = randomLook();
    this.edit({ name: '', values });
  }

  // the creator in the picker's place (back to the picker when it closes)
  edit(o) {
    this.hide();
    this.creator.open(o);
  }

  // the portraits, a step a frame, so that no frame of the panel's opening is held long: first a survivor's model a
  // frame, then all their pictures drawn in one go and read back once (CharacterStage.sheet), then a picture cut and
  // put in its cell a frame
  async portraits() {
    const st = await getStage();
    if (this.root.hidden) return;
    const todo = [...this.cells].filter(([v, b]) => b.img && !b.img.src && refOf(v) !== null).map(([v]) => v);
    let sheet = null;
    const next = () => {
      if (this.root.hidden || !todo.length) return;
      const need = todo.find((v) => !st.people.has(refOf(v)) && !st.portraits.has(refOf(v)));
      if (need !== undefined) st.person(refOf(need));
      else if (!sheet) sheet = st.sheet(todo.map(refOf));
      else {
        const v = todo.shift();
        const b = this.cells.get(v);
        if (b && refOf(v) !== null) b.img.src = sheet.cut(refOf(v));
      }
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
    this.loading = todo;
  }

  async show() {
    super.show();
    this.sync();
    const st = await getStage();
    if (this.root.hidden) return;
    this.view.appendChild(st.canvas);
    this.portraits();
    let last = performance.now();
    const frame = (now) => {
      if (this.root.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!this.loading?.length) {
        const r = this.view.getBoundingClientRect();
        let who = refOf(this.shown);
        if (this.shown === RANDOM) who = Math.floor(now / 2500) % CHARACTER_COUNT;
        else if (this.shown === STRANGER) who = st.previewOf(stranger()); // (the one the next join is)
        if (r.width > 10 && who !== null) st.turn(who, r.width, r.height, dt);
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
