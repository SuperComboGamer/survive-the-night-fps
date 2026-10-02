// Full-screen menus and overlays: splash/title, pause, death, game over / victory, connection banner.
import { PHASE, MAX_PLAYERS } from '../../shared/constants.js';
import { el, svgEl, lsGet, lsSet, fmtTime } from './dom.js';
import { glyph } from './icons.js';
import { loadRecord, recordSummary } from './records.js';

export const DEFAULT_CONTROLS = [
  ['W A S D', 'Move'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump'],
  ['Ctrl', 'Crouch'],
  ['LMB', 'Attack · place'],
  ['RMB', 'Aim · heavy swing'],
  ['R', 'Reload'],
  ['E', 'Interact · pick up'],
  ['F', 'Flashlight'],
  ['1 – 5', 'Weapon slots'],
  ['I', 'Inventory & crafting'],
  ['Tab', 'Player list (hold)'],
  ['Y / Enter', 'Chat'],
  ['V', 'Push to talk'],
  ['Esc', 'Menu'],
];

export function renderControls(parent, list) {
  parent.textContent = '';
  for (const [k, a] of list) {
    const r = el('div', 'ctl-row', parent);
    const keys = el('span', 'ctl-keys', r);
    for (const part of String(k).split(/\s*\+\s*/)) el('span', 'kbd sm', keys, part);
    el('span', 'ctl-act', r, a);
  }
}

// what the game asks of the player: on every splash, whichever tagline is drawn under it
const GOAL = 'Scavenge by day. Board up by night. Fix the car. Get out.';
const TAGLINES = [
  'Your car died on Route 9. The dark is coming.',
  'Nobody is coming to save you.',
  'Wherever you are at sundown is where you make your stand.',
  'Every night there are more of them.',
];

// ---------------------------------------------------------------- splash
export class Splash {
  constructor(ui, parent) {
    this.ui = ui;
    const root = (this.root = el('div', 'splash', parent));
    root.hidden = true;
    el('div', 'ov-vignette', root);
    el('div', 'sp-fog', root);
    el('div', 'grain', root);
    el('div', 'scratches', root);

    const main = el('div', 'sp-main', root);
    const logo = el('h1', 'logo', main);
    logo.setAttribute('aria-label', 'Survive the Night');
    const l1 = el('div', 'logo-1', logo);
    [...'SURVIVE'].forEach((ch, i) => {
      const s = el('span', 'lg-ch' + (i === 3 ? ' flick-a' : i === 5 ? ' flick-b' : ''), l1, ch);
      s.setAttribute('aria-hidden', 'true');
    });
    const l2 = el('div', 'logo-2', logo);
    el('i', 'logo-rule', l2);
    const l2t = el('span', 'logo-2t', l2, 'THE NIGHT');
    el('i', 'logo-rule', l2);
    // blood drips hanging off "THE NIGHT"
    const drips = [
      [9, 0.9, 1.6, 0],
      [23, 0.6, 3.1, 1.4],
      [41, 1.2, 2.2, 0.4],
      [58, 0.7, 4.2, 2.4],
      [67, 1.0, 1.4, 0.9],
      [86, 0.8, 2.8, 1.8],
    ];
    for (const [x, w, len, delay] of drips) {
      const d = el('i', 'drip', l2t);
      d.style.cssText = `left:${x}%;--w:${w};--len:${len};--d:${delay}s`;
    }

    el('p', 'sp-goal', main, GOAL);
    el('p', 'sp-tag', main, TAGLINES[(Math.random() * TAGLINES.length) | 0]);

    const form = (this.form = el('form', 'sp-join', main));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._join();
    });
    const field = el('label', 'sp-field', form);
    el('span', 'sp-field-l', field, 'Your name');
    this.name = el('input', 'sp-name', field);
    this.name.type = 'text';
    this.name.maxLength = 16;
    this.name.autocomplete = 'off';
    this.name.spellcheck = false;
    let saved = lsGet('stn.name', '');
    if (!saved) saved = 'Survivor' + String(100 + ((Math.random() * 900) | 0));
    this.name.value = saved.slice(0, 16);
    // kept as it is typed, not only on Join: a name outlives a tab closed, or a full server, before the first run
    this.name.addEventListener('input', () => lsSet('stn.name', this._typedName()));
    this.joinBtn = el('button', 'btn btn-blood sp-joinbtn', form);
    this.joinBtn.type = 'submit';
    this.joinTxt = el('span', '', this.joinBtn, 'Join');
    this.err = el('div', 'sp-err', main, '');
    this.err.hidden = true;
    const st = (this.status = el('div', 'sp-status', main));
    this.dot = el('i', 'dot', st);
    this.statusTxt = el('span', '', st, 'Contacting server…');
    // the player's own record (records.js): not there at all until a first run is on it
    this.record = el('div', 'sp-record', main);

    const foot = el('div', 'sp-foot', root);
    const btns = el('div', 'sp-btns', foot);
    const cb = el('button', 'btn btn-ghost', btns);
    cb.type = 'button';
    svgEl('i', 'btn-ico', cb, glyph('keyboard'));
    el('span', '', cb, 'Controls');
    cb.addEventListener('click', () => this.ui.controlsPanel.show());
    const sb = el('button', 'btn btn-ghost sp-settings', btns);
    sb.type = 'button';
    svgEl('i', 'btn-ico', sb, glyph('gear'));
    el('span', '', sb, 'Settings');
    sb.addEventListener('click', () => this.ui.settingsPanel.show());
    el('div', 'sp-credit', foot, `Co-op survival horror · 1–${MAX_PLAYERS} players`);

    this.full = false;
    this.joining = false;
  }

  _typedName() {
    return this.name.value.replace(/\s+/g, ' ').trim().slice(0, 16);
  }

  _join() {
    if (this.joining || this.full) return;
    let name = this._typedName();
    if (!name) {
      name = 'Survivor' + String(100 + ((Math.random() * 900) | 0));
      this.name.value = name;
    }
    lsSet('stn.name', name);
    this.joining = true;
    this.err.hidden = true;
    this.root.classList.add('joining');
    this._syncBtn();
    this.ui.cb.onJoin(name);
  }

  _syncBtn() {
    this.joinBtn.disabled = this.joining || this.full;
    this.joinTxt.textContent = this.joining ? 'Joining…' : this.full ? 'Server full' : 'Join';
  }

  setError(text) {
    this.joining = false;
    this.root.classList.remove('joining');
    this.err.textContent = text || 'Connection failed';
    this.err.hidden = !text;
    this._syncBtn();
    this.err.classList.remove('shake');
    void this.err.offsetWidth;
    this.err.classList.add('shake');
  }

  async _poll() {
    let ctl;
    try {
      ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch('/status', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error('bad status');
      const s = await r.json();
      if (this.root.hidden) return;
      const players = s.players | 0;
      const max = s.max | 0 || MAX_PLAYERS;
      this.full = players >= max;
      let phase = '';
      if (s.phase === PHASE.NIGHT) phase = 'Night ' + (s.day | 0);
      else if (s.phase === PHASE.DAY) phase = 'Day ' + (s.day | 0);
      else if (s.phase === PHASE.WAITING) phase = 'Waiting to begin';
      else if (s.phase === PHASE.GAMEOVER) phase = 'Restarting';
      else if (s.phase === PHASE.VICTORY) phase = 'They escaped';
      const txt = this.full
        ? `Server full · ${players} / ${max} survivors`
        : `${players} / ${max} survivor${max === 1 ? '' : 's'}` + (phase ? ' · ' + phase : '');
      this.statusTxt.textContent = txt;
      this.status.className = 'sp-status ' + (this.full ? 'full' : s.phase === PHASE.NIGHT ? 'online night' : 'online');
    } catch {
      if (this.root.hidden) return;
      this.full = false;
      this.statusTxt.textContent = 'Server offline';
      this.status.className = 'sp-status offline';
    }
    this._syncBtn();
  }

  syncRecord() {
    const parts = recordSummary(loadRecord());
    this.record.textContent = '';
    this.record.hidden = !parts.length;
    if (!parts.length) return;
    el('b', '', this.record, 'Your record');
    el('span', '', this.record, parts.join(' · '));
  }

  show() {
    this.root.hidden = false;
    this.joining = false;
    this.root.classList.remove('joining');
    this._syncBtn();
    this.syncRecord();
    this.root.classList.remove('in');
    void this.root.offsetWidth;
    this.root.classList.add('in');
    clearInterval(this._iv);
    this._poll();
    this._iv = setInterval(() => this._poll(), 3000);
    setTimeout(() => {
      if (!this.root.hidden && document.activeElement === document.body) this.name.focus({ preventScroll: true });
    }, 50);
  }

  hide() {
    this.root.hidden = true;
    clearInterval(this._iv);
    this._iv = 0;
    this.joining = false;
  }
}

// ---------------------------------------------------------------- pause
export class Pause {
  constructor(ui, parent) {
    this.ui = ui;
    const root = (this.root = el('div', 'pause', parent));
    root.hidden = true;
    el('div', 'ov-vignette', root);
    el('div', 'grain', root);
    const main = el('div', 'pause-main', root);
    el('div', 'pause-kicker', main, 'Paused');
    const resume = el('button', 'pause-resume', main);
    resume.type = 'button';
    el('span', 'pr-t', resume, 'Click to resume');
    el('p', 'pause-note', main, 'The night does not wait. The world keeps moving while you are away.');
    const btns = el('div', 'pause-btns', main);
    const cb = el('button', 'btn btn-ghost', btns);
    cb.type = 'button';
    svgEl('i', 'btn-ico', cb, glyph('keyboard'));
    el('span', '', cb, 'Controls');
    const sb = el('button', 'btn btn-ghost', btns);
    sb.type = 'button';
    svgEl('i', 'btn-ico', sb, glyph('gear'));
    el('span', '', sb, 'Settings');
    const lb = el('button', 'btn btn-ghost btn-danger', btns);
    lb.type = 'button';
    svgEl('i', 'btn-ico', lb, glyph('exit'));
    el('span', '', lb, 'Leave game');

    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ui.controlsPanel.show();
    });
    sb.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ui.settingsPanel.show();
    });
    lb.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ui.cb.onLeave();
    });
    // clicking anywhere that is not a control resumes (keeps the user gesture for pointer lock)
    root.addEventListener('click', (e) => {
      if (e.target.closest('.pause-btns')) return;
      this.ui.sound('ui_click');
      this.ui.cb.onResume();
    });
  }

  show(on) {
    on = !!on;
    if (on === !this.root.hidden) return;
    this.root.hidden = !on;
    this.ui.root.classList.toggle('paused', on);
    if (on) {
      this.root.classList.remove('in');
      void this.root.offsetWidth;
      this.root.classList.add('in');
    } else if (this.ui.splash.root.hidden) {
      if (this.ui.settingsPanel.visible) this.ui.settingsPanel.hide();
      if (this.ui.controlsPanel.visible) this.ui.controlsPanel.hide();
    }
  }
}

// ---------------------------------------------------------------- controls reference
// The key list, opened from the Controls button on the splash and the pause menu. It borrows the settings
// panel's card (settings.js) and closes the same ways: the cross, Done, Esc, or a click outside the card.
export class ControlsPanel {
  constructor(ui, parent) {
    this.ui = ui;
    this.root = el('div', 'stn-settings stn-controls', parent);
    this.root.setAttribute('role', 'dialog');
    this.root.hidden = true;
    const card = el('div', 'set-card paper', this.root);
    const head = el('div', 'set-head', card);
    el('h2', 'set-title', head, 'Controls');
    el('span', 'set-sub', head, 'field notes');
    const close = svgEl('button', 'set-close btn-icon', head, glyph('xmark'));
    close.title = 'Close';
    close.addEventListener('click', () => this.hide());
    this.list = el('div', 'ctl-grid', el('div', 'set-body', card));
    renderControls(this.list, DEFAULT_CONTROLS);
    const done = el('button', 'btn btn-blood', el('div', 'set-foot', card), 'Done');
    done.addEventListener('click', () => this.hide());

    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.hide();
    });
    document.addEventListener(
      'keydown',
      (e) => {
        if (this.root.hidden || e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      },
      true
    );
  }

  show() {
    this.root.hidden = false;
    this.root.classList.remove('in');
    void this.root.offsetWidth;
    this.root.classList.add('in');
  }

  hide() {
    this.root.hidden = true;
  }

  get visible() {
    return !this.root.hidden;
  }
}

// ---------------------------------------------------------------- death
export class Death {
  constructor(ui, parent) {
    this.ui = ui;
    const root = (this.root = el('div', 'death', parent));
    root.hidden = true;
    el('div', 'death-bg', root);
    el('div', 'grain', root);
    const m = el('div', 'death-main', root);
    this.title = el('div', 'death-title', m, 'You died');
    this.by = el('div', 'death-by', m, '');
    this.rise = el('div', 'death-rise', m, '');
    svgEl('i', 'death-claw', this.rise, glyph('claw'));
    this.riseText = el('span', '', this.rise, '');
  }

  show(info = {}) {
    clearTimeout(this._t1);
    clearTimeout(this._t2);
    clearTimeout(this._t3);
    const parts = [];
    if (info.killer) parts.push('Killed by ' + info.killer);
    if (info.day) parts.push((info.night ? 'Night ' : 'Day ') + info.day);
    this.by.textContent = parts.join(' · ');
    // info.dawn: this death lasts until sunrise (DAWN_RETURN), not for the rest of the run
    this.riseText.textContent = info.dawn ? 'You rise as one of them. Hunt the survivors until dawn: the sun brings you back.' : 'You have risen as one of them. Hunt the survivors.';
    this.root.hidden = false;
    this.root.className = 'death';
    this.ui.root.classList.add('death-on');
    void this.root.offsetWidth;
    this.root.classList.add('in');
    this._t1 = setTimeout(() => this.root.classList.add('rise'), 2600);
    this._t2 = setTimeout(() => this.root.classList.add('out'), 8200);
    this._t3 = setTimeout(() => this.hide(), 9400);
  }

  hide() {
    clearTimeout(this._t1);
    clearTimeout(this._t2);
    clearTimeout(this._t3);
    this.root.hidden = true;
    this.root.className = 'death';
    this.ui.root.classList.remove('death-on');
  }
}

// ---------------------------------------------------------------- game over / victory
export class EndScreen {
  constructor(ui, parent) {
    this.ui = ui;
    const root = (this.root = el('div', 'end', parent));
    root.hidden = true;
    el('div', 'end-bg', root);
    el('div', 'grain', root);
    el('div', 'scratches', root);
    const m = el('div', 'end-main', root);
    this.kicker = el('div', 'end-kicker', m, '');
    this.title = el('h1', 'end-title', m, '');
    this.reason = el('p', 'end-reason', m, '');
    const st = el('div', 'end-stat', m);
    this.nights = el('b', '', st, '0');
    this.nightsL = el('span', '', st, 'nights survived');
    // the team's board and the player's own record sit side by side, so the record costs the screen no height
    const panels = el('div', 'end-panels', m);
    this.board = el('div', 'end-board paper', panels);
    this.record = el('div', 'end-board end-record paper', panels);
    this.count = el('div', 'end-count', m);
  }

  // What this run did to the player's own record. rep: recordRun's report (records.js), { late: true } for a
  // run joined too late to count, or nothing when the run was not followed at all.
  _record(rep) {
    const box = this.record;
    box.textContent = '';
    box.hidden = !rep;
    if (!rep) return;
    el('h3', 'panel-h', box, 'Your record');
    if (rep.late) {
      el('p', 'er-note', box, 'You joined this run after its first minute, so it is not on your record.');
      return;
    }
    const { run, news, record: rec } = rep;
    const tiles = el('div', 'er-tiles', box);
    // this run's figure over the best that stands after it, lit when this run set it
    const tile = (k, label, value, best) => {
      const t = el('div', 'er-tile' + (news.some((n) => n.k === k) ? ' new' : ''), tiles);
      el('span', '', t, label);
      el('b', '', t, value);
      el('small', '', t, best);
    };
    tile('secs', 'Time', fmtTime(run.secs), rec.best.secs ? 'fastest escape ' + fmtTime(rec.best.secs) : 'no escape yet');
    tile('nights', 'Nights', String(run.nights), 'best ' + rec.best.nights);
    tile('kills', 'Kills', String(run.kills), 'best ' + rec.best.kills);
    for (const n of news) {
      const row = el('div', 'er-new', box);
      el('b', '', row, n.label);
      el('span', '', row, n.text);
      if (n.was) el('small', '', row, 'was ' + n.was);
    }
    const t = rec.total;
    el('div', 'er-foot', box, `Run ${t.runs} · ${t.escapes} escape${t.escapes === 1 ? '' : 's'}` + (t.streak > 1 ? ` · ${t.streak} in a row` : ''));
  }

  show(kind, stats = {}) {
    const victory = kind === 'victory';
    this.root.hidden = false;
    this.root.className = 'end ' + (victory ? 'victory' : 'gameover');
    void this.root.offsetWidth;
    this.root.classList.add('in');
    this.kicker.textContent = victory ? 'The engine turns over' : 'Game over';
    this.title.textContent = stats.title || (victory ? 'You escaped' : 'Everyone died');
    this.reason.textContent =
      stats.reason || (victory ? 'Headlights cut through the trees. The valley shrinks in the mirror.' : 'The valley is quiet again. The car never started.');
    // stats.days is the day the run ended on. Night N closes day N, so a run that ends on day N - in its
    // daylight or in its night - got through N - 1 nights (a wipe during the first night survived none)
    const n = Math.max(0, (stats.days | 0) - 1);
    this.nights.textContent = String(n);
    this.nightsL.textContent = n === 1 ? 'night survived' : 'nights survived';

    this.board.textContent = '';
    const kills = Array.isArray(stats.kills) ? [...stats.kills].sort((a, b) => (b.kills | 0) - (a.kills | 0)) : [];
    if (kills.length) {
      el('h3', 'panel-h', this.board, 'Body count');
      const list = el('ol', 'end-list', this.board);
      kills.slice(0, 8).forEach((k, i) => {
        const li = el('li', i === 0 && (k.kills | 0) > 0 ? 'top' : '', list);
        el('span', 'el-rank', li, String(i + 1));
        el('span', 'el-name', li, k.name || '???');
        const kc = el('span', 'el-kills', li);
        svgEl('i', '', kc, glyph('skull'));
        el('b', '', kc, String(k.kills | 0));
      });
    }
    this.board.hidden = !kills.length;
    this._record(stats.record);

    clearInterval(this._iv);
    this.count.textContent = '';
    if (stats.restartIn > 0) {
      const end = performance.now() + stats.restartIn * 1000;
      const tick = () => {
        const s = Math.max(0, Math.ceil((end - performance.now()) / 1000));
        this.count.textContent = '';
        el('span', '', this.count, s > 0 ? 'New game in ' : 'Starting new game');
        if (s > 0) el('b', '', this.count, String(s));
        if (s <= 0) clearInterval(this._iv);
      };
      tick();
      this._iv = setInterval(tick, 250);
    }
  }

  hide() {
    clearInterval(this._iv);
    this.root.hidden = true;
  }
}

// ---------------------------------------------------------------- connection banner
export class Banner {
  constructor(parent) {
    this.root = el('div', 'conn', parent);
    this.root.hidden = true;
    svgEl('i', 'conn-ico', this.root, glyph('signal'));
    this.txt = el('span', 'conn-t', this.root, '');
    el('span', 'conn-dots', this.root, '');
  }

  set(text) {
    this.root.hidden = !text;
    if (text) this.txt.textContent = String(text);
  }
}

// ---------------------------------------------------------------- voice speakers (top-left)
export class VoiceList {
  constructor(parent) {
    this.root = el('div', 'voice', parent);
    this.key = '';
  }

  // speakers: names, or { name, radio } (radio = coming through the walkie-talkie)
  set(speakers) {
    const list = (Array.isArray(speakers) ? speakers.slice(0, 6) : []).map((s) => (typeof s === 'object' && s ? s : { name: s }));
    const key = list.map((s) => (s.radio ? '\u0002' : '') + s.name).join('\u0001');
    if (key === this.key) return;
    this.key = key;
    this.root.textContent = '';
    for (const s of list) {
      const r = el('div', 'vc-row' + (s.radio ? ' radio' : ''), this.root);
      svgEl('i', 'vc-ico', r, glyph(s.radio ? 'radio' : 'mic'));
      el('span', 'vc-name', r, String(s.name));
    }
  }
}
