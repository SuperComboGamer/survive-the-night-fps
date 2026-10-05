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
  holdToDrop: true, // the drop key has to be held a moment (game/drophold.js), so a stray press keeps the gun
  showFps: true,
  achBanners: true, // a banner when an achievement unlocks (ui/achievements.js)...
  achSound: true, // ...and its chime
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
    for (const k of ['pushToTalk', 'voiceDuck', 'invertY', 'rawMouse', 'fullscreen', 'weaponSway', 'keyHints', 'holdToDrop', 'showFps', 'ps1', 'achBanners', 'achSound']) if (typeof s[k] === 'boolean') out[k] = s[k];
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

// The panel's tabs, down its left side. A { head } entry in rows starts a sub-group within the tab. Keybinds and Record
// draw their own tabs (keybinds.js, _recordTab).
const TABS = [
  {
    id: 'controls',
    label: 'Controls',
    icon: 'headshot',
    rows: [
      { head: 'Mouse' },
      { k: 'sensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.1, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { k: 'aimSensitivity', label: 'Aim sensitivity', type: 'range', min: 0.25, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + '×', hint: 'While aiming, on top of the zoom' },
      { k: 'invertY', label: 'Invert mouse Y', type: 'toggle' },
      { k: 'rawMouse', label: 'Raw mouse input', type: 'toggle', hint: 'Off = OS mouse acceleration applies' },
      { head: 'Gameplay' },
      { k: 'holdToDrop', label: 'Hold to drop weapon', type: 'toggle', hint: 'The drop key has to be held a moment, so a stray press in a fight keeps your gun. Off = a press drops it' },
      { k: 'weaponSway', label: 'Weapon look sway', type: 'toggle', hint: 'Gun trails behind fast turns' },
      { k: 'fullscreen', label: 'Fullscreen while playing', type: 'toggle', hint: 'Keeps Ctrl+W (crouch + forward) from closing the tab. Off = the tab asks before it closes' },
    ],
  },
  { id: 'keybinds', label: 'Keybinds', icon: 'keyboard' },
  {
    id: 'audio',
    label: 'Audio',
    icon: 'speaker',
    rows: [
      { head: 'Volume' },
      { k: 'masterVolume', label: 'Master', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
      { k: 'musicVolume', label: 'Music & ambience', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
      { k: 'sfxVolume', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
      { k: 'voiceVolume', label: 'Voice chat', type: 'range', min: 0, max: 2, step: 0.01, fmt: pct },
      { head: 'Voice chat' },
      { k: 'pushToTalk', label: 'Push to talk', type: 'toggle', hint: 'Off = open mic' },
      { k: 'voiceDuck', label: 'Lower game for voices', type: 'toggle', hint: 'Music and effects step back while someone you can hear is talking' },
    ],
  },
  {
    id: 'graphics',
    label: 'Graphics',
    icon: 'eye',
    rows: [
      { head: 'Performance' },
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
      { head: 'View' },
      { k: 'fov', label: 'Field of view', type: 'range', min: 60, max: 100, step: 1, fmt: (v) => Math.round(v) + '°' },
      { k: 'ps1', label: 'PS1 shader', type: 'toggle', hint: 'Low resolution, wobbling polygons, dithered colour, thicker fog' },
      { k: 'ps1Strength', label: 'PS1 intensity', type: 'range', min: 0.1, max: 1, step: 0.05, fmt: pct, needs: 'ps1', hint: 'Pixel size, wobble, colour banding and fog' },
    ],
  },
  {
    id: 'interface',
    label: 'Interface',
    icon: 'grid',
    rows: [
      { head: 'On screen' },
      { k: 'highlight', label: 'Interaction highlight', type: 'seg', options: ['off', 'subtle', 'strong'], hint: 'A faint outline on what you can use, while you look at it up close' },
      { k: 'keyHints', label: 'Key hints', type: 'toggle', hint: 'Names a key when it would help, until you have used it twice' },
      { k: 'showFps', label: 'Show FPS counter', type: 'toggle' },
      { head: 'Achievements' },
      { k: 'achBanners', label: 'Unlock banners', type: 'toggle', hint: 'A banner at the top of the screen when you unlock an achievement' },
      { k: 'achSound', label: 'Unlock sound', type: 'toggle', hint: 'A chime when you unlock one' },
    ],
  },
  { id: 'record', label: 'Record', icon: 'trophy' },
];
const TAB_KEY = 'stn.settingsTab';

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
    this.tabs = {};
    const body = el('div', 'set-body set-split', card);
    const nav = el('nav', 'set-nav', body);
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-orientation', 'vertical');
    nav.addEventListener('keydown', (e) => this._navKey(e));
    this.main = el('div', 'set-main', body);
    for (const tab of TABS) {
      const btn = svgEl('button', 'set-tab', nav, glyph(tab.icon, 'set-tab-ico'));
      el('span', 'set-tab-txt', btn, tab.label);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => this.select(tab.id));
      let pane;
      if (tab.id === 'keybinds') pane = (this.keybinds = new KeybindsSection(this, this.main)).root;
      else {
        pane = el('section', 'set-sec', this.main);
        el('h3', 'set-sec-title', pane, tab.label);
        if (tab.id === 'record') this._recordTab(pane);
        else for (const row of tab.rows) row.head ? el('h4', 'set-group', pane, row.head) : this._row(pane, row);
      }
      pane.classList.add('set-pane');
      pane.setAttribute('role', 'tabpanel');
      this.tabs[tab.id] = { btn, pane };
    }
    this.select(TABS.some((t) => t.id === lsGet(TAB_KEY, '')) ? lsGet(TAB_KEY, '') : TABS[0].id);

    const foot = el('div', 'set-foot', card);
    const reset = el('button', 'btn btn-ghost', foot, 'Reset defaults');
    reset.title = 'Every setting back to its default (keybinds have their own reset)';
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

  select(id) {
    if (!this.tabs[id]) return;
    if (this.tab !== id) this.keybinds?.cancel(); // (a key being listened for is not left waiting on a tab out of sight)
    this.tab = id;
    lsSet(TAB_KEY, id);
    for (const k in this.tabs) {
      const { btn, pane } = this.tabs[k];
      const on = k === id;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      pane.hidden = !on;
    }
    this.main.scrollTop = 0;
  }

  // up / down (or left / right, when the narrow layout lays the tabs out in a row) walk the tabs
  _navKey(e) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === this.tab);
    const next = TABS[(i + step + TABS.length) % TABS.length].id;
    this.select(next);
    this.tabs[next].btn.focus();
  }

  // not a setting, but this is where a player looks for it: wiping the personal record (records.js).
  // It takes two clicks: the first only arms the button.
  _recordTab(rs) {
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

  show(tab) {
    if (tab) this.select(tab);
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
