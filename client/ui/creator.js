// The character creator: a survivor of the player's own, made from the wardrobe (shared/wardrobe.js). Opened from the
// picker (client/ui/picker.js: "Create", "Make one like Dale", "Edit", "Copy", "Keep one"); kept by
// client/ui/customs.js. Everything on it is made from the wardrobe's fields - a tab per section, a row of buttons per
// pick, of colours per swatch, a slider per slider, only the fields that matter with what is chosen (appearance.js
// relevant) - so a part added to the wardrobe is here without a line of this changing.
//
// Every choice goes through the wardrobe's rules with the field just set winning (appearance.js normalize, lock): a
// choice that would change something else says so on hover ("Also changes: Collar to Shirt"). The dice roll the
// whole survivor, or the tab's section only. The turntable is a model of its own (CharacterStage.previewOf), made again
// as the look changes; on the Face and Hair tabs the camera comes in to the head, and dragging it turns them.
import { APPEARANCE, normalize, relevant, optionsFor, randomLook, rerollSection, defaults } from '../../shared/appearance.js';
import { SECTIONS } from '../../shared/wardrobe.js';
import { CHARACTERS } from '../../shared/characters.js';
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { Panel } from './games.js';
import { saveCustom, deleteCustom, getCustom, noteFor, cleanName, customs, NAME_MAX, MAX_CUSTOMS } from './customs.js';
import { getStage, looksModule } from './stage.js';

const A = APPEARANCE;
const HEAD_TABS = new Set(['face', 'hair']);
const REBUILD_MS = 120; // the preview made again at most this often while a slider is dragged

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class CreatorPanel extends Panel {
  // on: { saved(id), deleted(id), closed() }
  constructor(ui, parent, on) {
    super(ui, parent, 'cr-panel', 'Make a survivor');
    this.on = on;
    this.sub.textContent = 'Everyone in the game sees them as you make them here.';
    const wrap = el('div', 'cr-wrap', this.body);
    // ---- the left: the turntable, the name, the dice and where to start from
    const left = el('div', 'cr-left', wrap);
    this.view = el('div', 'cp-view cr-view', left);
    this.view.title = 'Drag to turn them';
    this.nameIn = el('input', 'cr-name', left);
    this.nameIn.type = 'text';
    this.nameIn.maxLength = NAME_MAX;
    this.nameIn.placeholder = 'Name (only you see it)';
    this.nameIn.setAttribute('aria-label', 'Name your survivor');
    this.nameIn.addEventListener('input', () => (this.nameIn.value = this.nameIn.value.slice(0, NAME_MAX)));
    const tools = el('div', 'cr-tools', left);
    const all = svgEl('button', 'btn btn-ghost cr-roll', tools, glyph('dice'));
    all.type = 'button';
    el('span', '', all, 'Roll everything');
    all.title = 'A whole new survivor, made up';
    all.addEventListener('click', () => this.set(randomLook()));
    this.from = el('select', 'cr-from', tools);
    this.from.setAttribute('aria-label', 'Start from');
    const opt = (value, label) => {
      const o = el('option', '', this.from, label);
      o.value = value;
    };
    opt('', 'Start from...');
    opt('basic', 'The basics');
    for (const ch of CHARACTERS) opt(String(ch.id), `${ch.name}, ${ch.role.toLowerCase()}`);
    this.from.addEventListener('change', () => {
      const v = this.from.value;
      this.from.value = '';
      if (v === 'basic') this.set(defaults());
      else if (v !== '') this.set(looksModule().appearanceOfRoster(+v));
    });
    this.note = el('p', 'cr-note', left, '');
    this.note.hidden = true;
    // ---- the right: a tab per section, its dice, its fields
    const right = el('div', 'cr-right', wrap);
    const bar = el('div', 'cr-bar', right);
    const tabs = el('nav', 'cr-tabs', bar);
    tabs.setAttribute('role', 'tablist');
    this.tabBtns = new Map();
    for (const s of SECTIONS) {
      const b = el('button', 'cr-tab', tabs, s.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.tab(s.key));
      this.tabBtns.set(s.key, b);
    }
    this.roll = svgEl('button', 'btn btn-ghost cr-roll cr-roll-sec', bar, glyph('dice'));
    this.roll.type = 'button';
    this.rollTxt = el('span', '', this.roll, '');
    this.roll.addEventListener('click', () => this.set(rerollSection(this.values, this.section)));
    this.fields = el('div', 'cr-fields', right);
    this.fields.setAttribute('role', 'tabpanel');
    // ---- the foot: delete (one of theirs), cancel, save
    this.del = el('button', 'btn btn-ghost cr-del', this.foot, 'Delete');
    this.del.type = 'button';
    this.del.addEventListener('click', () => this.remove());
    el('span', 'cr-gap', this.foot);
    this.msg = el('span', 'cr-msg', this.foot, '');
    const cancel = el('button', 'btn btn-ghost', this.foot, 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.hide());
    const save = el('button', 'btn btn-blood cr-save', this.foot);
    save.type = 'button';
    el('span', '', save, 'Save');
    save.addEventListener('click', () => this.save());
    // turning them by hand
    this.yaw = 0;
    let drag = null;
    this.view.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, yaw: this.yaw };
      this.view.setPointerCapture(e.pointerId);
    });
    this.view.addEventListener('pointermove', (e) => drag && (this.yaw = drag.yaw + (e.clientX - drag.x) * 0.012));
    const up = () => (drag = null);
    this.view.addEventListener('pointerup', up);
    this.view.addEventListener('pointercancel', up);
    this.values = defaults();
    this.section = SECTIONS[0].key;
    this.id = null;
    this.draft = null; // what was being made when it was closed unsaved: { id, name, values }
    this.raf = 0;
  }

  /** Opens it on a look: { id (one of theirs being changed; none: a new one), name, values }. */
  async open({ id = null, name = '', values = null } = {}) {
    this.id = id;
    this.nameIn.value = name;
    this.values = normalize(values || randomLook());
    this.yaw = 0;
    this.armed = false;
    this.del.hidden = !id;
    this.del.textContent = 'Delete';
    this.msg.textContent = '';
    const note = id ? noteFor(id) : '';
    this.note.textContent = note;
    this.note.hidden = !note;
    this.title(id ? 'Change your survivor' : 'Make a survivor');
    this.tab(this.section);
    super.show();
    const st = await getStage();
    if (this.root.hidden) return;
    this.view.appendChild(st.canvas);
    this.built = 0;
    this.shown = null; // the values the preview was last made of
    let last = performance.now();
    const frame = (now) => {
      if (this.root.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const r = this.view.getBoundingClientRect();
      // made again when the look changed - while a slider is dragged (dirty), at most every REBUILD_MS
      if (this.values !== this.shown && (!this.dirty || now - this.built >= REBUILD_MS || !st.preview)) {
        st.previewOf(this.values);
        this.shown = this.values;
        this.built = now;
      }
      if (r.width > 10) st.turn(st.preview.sv, r.width, r.height, dt, { still: true, yaw: this.yaw, focus: HEAD_TABS.has(this.section) ? 'head' : 'body' });
      this.raf = requestAnimationFrame(frame);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(frame);
  }

  title(t) {
    const h = this.card.querySelector('.set-title');
    if (h) h.textContent = t;
  }

  // the whole look at once (the dice, "Start from")
  set(values) {
    this.values = normalize(values);
    this.dirty = false;
    this.render();
  }

  // one field set by the player: the rules applied with it winning
  choose(key, name) {
    let v = { ...this.values, [key]: name };
    // a body's own starting points (feminine: a chest, softer features)
    const o = A.choice(A.byKey.get(key), name);
    if (o && o.sets) v = { ...v, ...o.sets };
    this.values = normalize(v, { lock: key });
    this.render();
  }

  tab(key) {
    this.section = key;
    for (const [k, b] of this.tabBtns) {
      b.classList.toggle('on', k === key);
      b.setAttribute('aria-selected', String(k === key));
    }
    this.rollTxt.textContent = 'Roll ' + SECTIONS.find((s) => s.key === key).label.toLowerCase();
    this.roll.title = `New ${SECTIONS.find((s) => s.key === key).label.toLowerCase()}, the rest kept`;
    this.render();
  }

  // the tab's fields, as they stand
  render() {
    const top = this.fields.scrollTop;
    this.fields.textContent = '';
    for (const f of A.fields) {
      if (f.section !== this.section || !relevant(this.values, f)) continue;
      const row = el('div', 'cr-row cr-row-' + f.kind, this.fields);
      let label = f.label;
      if (f.key === 'hairSize') label = A.choice(A.byKey.get('hair'), this.values.hair)?.size?.label ?? label;
      el('span', 'cr-label', row, label);
      const ctl = el('div', 'cr-ctl', row);
      if (f.kind === 'slider') this.slider(ctl, f, label);
      else if (f.kind === 'swatch') this.swatches(ctl, f);
      else this.picks(ctl, f);
    }
    this.fields.scrollTop = top;
  }

  picks(ctl, f) {
    ctl.classList.add('cr-opts');
    ctl.setAttribute('role', 'group');
    ctl.setAttribute('aria-label', f.label);
    for (const o of optionsFor(this.values, f.key)) {
      const b = el('button', 'cr-opt', ctl, o.label);
      b.type = 'button';
      const on = this.values[f.key] === o.name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      if (!on && o.changes.length) {
        b.classList.add('cr-alters');
        b.title = 'Also changes: ' + o.changes.map((c) => `${c.label} to ${c.to}`).join(', ');
      }
      b.addEventListener('click', () => this.choose(f.key, o.name));
    }
  }

  swatches(ctl, f) {
    ctl.classList.add('cr-swatches');
    ctl.setAttribute('role', 'group');
    ctl.setAttribute('aria-label', f.label);
    for (const o of A.offered(f)) {
      const b = el('button', 'cr-swatch', ctl);
      b.type = 'button';
      if (o.hex !== undefined) b.style.background = hex(o.hex);
      else {
        b.classList.add('cr-swatch-none');
        b.textContent = o.label;
      }
      b.title = o.label;
      b.setAttribute('aria-label', o.label);
      const on = this.values[f.key] === o.name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => this.choose(f.key, o.name));
    }
  }

  slider(ctl, f, label) {
    const inp = el('input', 'set-range cr-range', ctl);
    inp.type = 'range';
    inp.min = 0;
    inp.max = f.steps;
    inp.step = 1;
    inp.value = A.step(f, this.values[f.key]);
    inp.setAttribute('aria-label', label);
    const paint = () => inp.style.setProperty('--p', ((inp.value / f.steps) * 100).toFixed(1) + '%');
    paint();
    inp.addEventListener('input', () => {
      this.values = { ...this.values, [f.key]: A.valueAt(f, +inp.value) };
      this.dirty = true;
      paint();
    });
    inp.addEventListener('change', () => (this.dirty = false));
  }

  save() {
    const name = cleanName(this.nameIn.value) || `Survivor ${customs().length + (this.id ? 0 : 1)}`;
    const id = saveCustom({ id: this.id, name, values: this.values });
    if (!id) {
      this.msg.textContent = `You can keep ${MAX_CUSTOMS}: delete one first.`;
      return;
    }
    this.draft = null;
    this.close();
    this.on.saved?.(id);
  }

  remove() {
    if (!this.id) return;
    if (!this.armed) {
      this.armed = true;
      this.del.textContent = `Delete ${getCustom(this.id)?.name || 'them'}? Click again`;
      return;
    }
    const id = this.id;
    deleteCustom(id);
    this.draft = null;
    this.close();
    this.on.deleted?.(id);
  }

  /** Closed unsaved (the cross, Escape, Cancel): what was being made is kept to come back to (picker: Create). */
  hide() {
    if (this.root.hidden) return;
    this.draft = { id: this.id, name: this.nameIn.value, values: this.values };
    this.close();
    this.on.closed?.();
  }

  /** Closed without a word (the game starting). */
  close() {
    super.hide();
    cancelAnimationFrame(this.raf);
  }
}
