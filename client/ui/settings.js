// Settings: persistence + the settings panel (shared by splash and pause menu).
import { el, svgEl, lsGet, lsSet, clamp } from './dom.js';
import { glyph } from './icons.js';
import { loadRecord, clearRecord } from './records.js';
import { QUALITY, grassRadius } from '../render/renderer.js';
import { KeybindsSection } from './keybinds.js';

const KEY = 'stn.settings';

export const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 1.0,
  aimSensitivity: 1.0,
  fov: 75,
  masterVolume: 0.4,
  musicVolume: 0.6,
  sfxVolume: 0.9,
  voiceVolume: 1, // 100% = the level the mix is balanced at (audio.js VOICE_BUS); the slider runs to 200%
  voiceDuck: true,
  quality: 'medium',
  grassDistance: 1, // x the quality preset's grass radius
  renderScale: 1,
  ps1: false,
  ps1Strength: 0.5,
  highlight: 'subtle', // the outline on what [E] would act on (game/highlight.js): off / subtle / strong
  pushToTalk: true,
  invertY: false,
  rawMouse: true,
  fullscreen: true,
  weaponSway: true,
  keyHints: true,
  showFps: true,
  minimap: false, // experimental
});

const NUM_RANGES = {
  sensitivity: [0.1, 3],
  aimSensitivity: [0.25, 2],
  fov: [60, 100],
  masterVolume: [0, 1],
  musicVolume: [0, 1],
  sfxVolume: [0, 1],
  voiceVolume: [0, 2],
  renderScale: [0.5, 1],
  grassDistance: [0.5, 3],
  ps1Strength: [0.1, 1],
};

export function sanitizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  if (s && typeof s === 'object') {
    for (const k of Object.keys(NUM_RANGES)) {
      const v = Number(s[k]);
      if (Number.isFinite(v)) out[k] = clamp(v, NUM_RANGES[k][0], NUM_RANGES[k][1]);
    }
    if (['low', 'medium', 'high', 'ultra'].includes(s.quality)) out.quality = s.quality;
    if (['off', 'subtle', 'strong'].includes(s.highlight)) out.highlight = s.highlight;
    for (const k of ['pushToTalk', 'voiceDuck', 'invertY', 'rawMouse', 'fullscreen', 'weaponSway', 'keyHints', 'showFps', 'ps1', 'minimap']) if (typeof s[k] === 'boolean') out[k] = s[k];
  }
  return out;
}

export function loadSettings() {
  try {
    return sanitizeSettings(JSON.parse(lsGet(KEY, 'null')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  lsSet(KEY, JSON.stringify(s));
}

// ---------------------------------------------------------------- panel
const pct = (v) => Math.round(v * 100) + '%';

const SECTIONS = [
  {
    title: 'Controls',
    rows: [
      { k: 'sensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.1, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { k: 'aimSensitivity', label: 'Aim sensitivity', type: 'range', min: 0.25, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + '×', hint: 'While aiming, on top of the zoom' },
      { k: 'invertY', label: 'Invert mouse Y', type: 'toggle' },
      { k: 'rawMouse', label: 'Raw mouse input', type: 'toggle', hint: 'Off = OS mouse acceleration applies' },
      { k: 'fullscreen', label: 'Fullscreen while playing', type: 'toggle', hint: 'Keeps Ctrl+W (crouch + forward) from closing the tab. Off = the tab asks before it closes' },
      { k: 'weaponSway', label: 'Weapon look sway', type: 'toggle', hint: 'Gun trails behind fast turns' },
      { k: 'keyHints', label: 'Key hints', type: 'toggle', hint: 'Names a key when it would help, until you have used it twice' },
      { k: 'fov', label: 'Field of view', type: 'range', min: 60, max: 100, step: 1, fmt: (v) => Math.round(v) + '°' },
    ],
  },
  {
    title: 'Audio',
    rows: [
      { k: 'masterVolume', label: 'Master', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
      { k: 'musicVolume', label: 'Music & ambience', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
      { k: 'sfxVolume', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
      { k: 'voiceVolume', label: 'Voice chat', type: 'range', min: 0, max: 2, step: 0.01, fmt: pct },
      { k: 'voiceDuck', label: 'Lower game for voices', type: 'toggle', hint: 'Music and effects step back while someone you can hear is talking' },
      { k: 'pushToTalk', label: 'Push to talk', type: 'toggle', hint: 'Off = open mic' },
    ],
  },
  {
    title: 'Graphics',
    rows: [
      { k: 'quality', label: 'Quality', type: 'seg', options: ['low', 'medium', 'high', 'ultra'], hint: 'Shadows, sun rays, ambient occlusion, grass density, view distance' },
      {
        k: 'grassDistance',
        label: 'Grass distance',
        type: 'range',
        min: 0.5,
        max: 3,
        step: 0.05,
        fmt: (v, s) => Math.round(grassRadius(QUALITY[s.quality] || QUALITY.medium, v)) + ' m',
        hint: 'How far out grass is drawn. Further costs frame rate',
      },
      { k: 'renderScale', label: 'Render scale', type: 'range', min: 0.5, max: 1, step: 0.05, fmt: pct },
      { k: 'ps1', label: 'PS1 shader', type: 'toggle', hint: 'Low resolution, wobbling polygons, dithered colour, thicker fog' },
      { k: 'ps1Strength', label: 'PS1 intensity', type: 'range', min: 0.1, max: 1, step: 0.05, fmt: pct, needs: 'ps1', hint: 'Pixel size, wobble, colour banding and fog' },
      { k: 'highlight', label: 'Interaction highlight', type: 'seg', options: ['off', 'subtle', 'strong'], hint: 'A faint outline on what you can use, while you look at it up close' },
      { k: 'showFps', label: 'Show FPS counter', type: 'toggle' },
      { k: 'minimap', label: 'Minimap (experimental)', type: 'toggle', hint: 'A map in the top-left corner that turns with you. The car supplies shrink to icons under it' },
    ],
  },
];

export class SettingsPanel {
  constructor(ui, parent) {
    this.ui = ui;
    this.root = el('div', 'stn-settings', parent);
    this.root.setAttribute('role', 'dialog');
    this.root.hidden = true;
    const card = el('div', 'set-card paper', this.root);
    const head = el('div', 'set-head', card);
    el('h2', 'set-title', head, 'Settings');
    el('span', 'set-sub', head, 'changes apply immediately');
    const close = svgEl('button', 'set-close btn-icon', head, glyph('xmark'));
    close.title = 'Close';
    close.addEventListener('click', () => this.hide());

    this.inputs = {};
    const body = el('div', 'set-body', card);
    for (const sec of SECTIONS) {
      const s = el('section', 'set-sec', body);
      el('h3', 'set-sec-title', s, sec.title);
      for (const row of sec.rows) this._row(s, row);
      if (sec.title === 'Controls') this.keybinds = new KeybindsSection(this, body); // (keybinds.js: under the controls)
    }
    // not a setting, but this is where a player looks for it: wiping the personal record (records.js).
    // It takes two clicks: the first only arms the button.
    const rs = el('section', 'set-sec', body);
    el('h3', 'set-sec-title', rs, 'Your record');
    this.recRow = el('div', 'set-row set-rec', rs);
    this.recHint = el('small', 'set-hint', el('label', 'set-label', this.recRow, 'Personal bests & run history'));
    const rc = el('div', 'set-ctl', this.recRow);
    this.recKeep = el('button', 'btn btn-ghost', rc, 'Keep it');
    this.recClear = el('button', 'btn btn-ghost btn-danger', rc);
    this.recKeep.type = this.recClear.type = 'button';
    this.recKeep.addEventListener('click', () => this._syncRecord());
    this.recClear.addEventListener('click', () => {
      if (!this.recArmed) return this._syncRecord(true);
      clearRecord();
      this._syncRecord();
      this.ui.splash.syncRecord();
    });
    const foot = el('div', 'set-foot', card);
    const reset = el('button', 'btn btn-ghost', foot, 'Reset defaults');
    reset.addEventListener('click', () => {
      this.ui._applySettings({ ...DEFAULT_SETTINGS });
      this.sync();
    });
    const done = el('button', 'btn btn-blood', foot, 'Done');
    done.addEventListener('click', () => this.hide());

    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.hide();
    });
    this._onKey = (e) => {
      if (!this.root.hidden && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this._onKey, true);
  }

  _row(parent, row) {
    const r = el('div', 'set-row sr-' + row.type, parent);
    const lab = el('label', 'set-label', r, row.label);
    if (row.hint) el('small', 'set-hint', lab, row.hint);
    const ctl = el('div', 'set-ctl', r);
    if (row.type === 'range') {
      const inp = el('input', 'set-range', ctl);
      inp.type = 'range';
      inp.min = row.min;
      inp.max = row.max;
      inp.step = row.step;
      const val = el('output', 'set-val', ctl);
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        val.textContent = row.fmt(v, this.ui.settings);
        this._paintRange(inp);
        this.ui._applySettings({ ...this.ui.settings, [row.k]: v });
      });
      this.inputs[row.k] = {
        sync: (s) => {
          inp.value = s[row.k];
          val.textContent = row.fmt(s[row.k], s);
          this._paintRange(inp);
          // a row that only means something with another setting on is dimmed while that one is off
          if (row.needs) r.classList.toggle('set-off', (inp.disabled = !s[row.needs]));
        },
      };
    } else if (row.type === 'toggle') {
      const b = el('button', 'set-toggle', ctl);
      b.type = 'button';
      el('i', 'knob', b);
      const txt = el('span', 'set-toggle-txt', ctl);
      b.addEventListener('click', () => {
        this.ui._applySettings({ ...this.ui.settings, [row.k]: !this.ui.settings[row.k] });
        this.sync();
      });
      this.inputs[row.k] = {
        sync: (s) => {
          b.classList.toggle('on', !!s[row.k]);
          b.setAttribute('aria-pressed', s[row.k] ? 'true' : 'false');
          txt.textContent = s[row.k] ? 'On' : 'Off';
        },
      };
    } else if (row.type === 'seg') {
      const seg = el('div', 'set-seg', ctl);
      const btns = row.options.map((o) => {
        const b = el('button', 'seg-btn', seg, o);
        b.type = 'button';
        b.addEventListener('click', () => {
          this.ui._applySettings({ ...this.ui.settings, [row.k]: o });
          this.sync();
        });
        return b;
      });
      this.inputs[row.k] = { sync: (s) => btns.forEach((b, i) => b.classList.toggle('on', row.options[i] === s[row.k])) };
    }
  }

  _paintRange(inp) {
    const p = ((inp.value - inp.min) / (inp.max - inp.min)) * 100;
    inp.style.setProperty('--p', p.toFixed(1) + '%');
  }

  sync() {
    const s = this.ui.settings;
    for (const k in this.inputs) this.inputs[k].sync(s);
    this._syncRecord();
  }

  _syncRecord(armed = false) {
    const { runs, escapes } = loadRecord().total;
    const n = `${runs} run${runs === 1 ? '' : 's'}`;
    this.recArmed = armed;
    this.recRow.classList.toggle('armed', armed);
    this.recKeep.hidden = !armed;
    this.recClear.textContent = armed ? 'Yes, clear it' : 'Clear record';
    this.recClear.disabled = !runs;
    this.recHint.textContent = armed
      ? `Erase ${n} and your bests for good?`
      : runs
        ? `${n}, ${escapes} escape${escapes === 1 ? '' : 's'}. Kept in this browser only.`
        : 'Nothing recorded yet. Kept in this browser only.';
  }

  show() {
    this.sync();
    this.root.hidden = false;
    this.root.classList.remove('in');
    void this.root.offsetWidth;
    this.root.classList.add('in');
  }

  hide() {
    this.keybinds.cancel(); // (a bind being listened for is not set by a key pressed after the panel shut)
    this.root.hidden = true;
  }

  get visible() {
    return !this.root.hidden;
  }
}
