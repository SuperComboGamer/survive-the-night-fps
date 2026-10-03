// Full-screen menus and overlays: splash/title, pause, death, game over / victory, connection banner.
import { PHASE, MAX_PLAYERS } from '../../shared/constants.js';
import { el, svgEl, lsGet, lsSet, fmtTime } from './dom.js';
import { glyph } from './icons.js';
import { loadRecord, recordSummary } from './records.js';
import { MODE_INFO } from '../../shared/modes.js';

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
  ['Tab', 'Inventory & crafting'],
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

    this.goal = el('p', 'sp-goal', main, GOAL);
    this.tag = el('p', 'sp-tag', main, TAGLINES[(Math.random() * TAGLINES.length) | 0]);
    this.tagSurvival = [this.goal.textContent, this.tag.textContent];

    // the mode switcher: what an empty server will play (a run in progress is joined as it is)
    this.mode = MODE_INFO[+lsGet('stn.mode', '0')] ? +lsGet('stn.mode', '0') : 0;
    const modes = el('div', 'sp-modes', main);
    this.modeBtns = MODE_INFO.map((m) => {
      const b = el('button', 'sp-mode', modes);
      b.type = 'button';
      b.style.setProperty('--accent', m.accent);
      el('b', '', b, m.name);
      el('span', '', b, m.tag);
      b.title = m.blurb;
      b.addEventListener('click', () => this.setMode(m.id));
      return b;
    });
    this.modeNote = el('div', 'sp-modenote', main, '');
    this.running = -1; // the mode of the run in the selected game (-1: none, it is waiting for a first player)
    // the games on this server: pick one to join, or open a new one in the mode picked above
    this.room = lsGet('stn.room', 'main');
    this.roomList = [];
    const rooms = (this.roomsBox = el('div', 'sp-rooms', main));
    const rh = el('div', 'sp-rooms-h', rooms);
    el('span', '', rh, 'Games');
    this.newBtn = el('button', 'btn btn-ghost sp-newgame', rh, 'New game');
    this.newBtn.type = 'button';
    this.newBtn.addEventListener('click', () => this._newGame());
    this.roomEl = el('div', 'sp-roomlist', rooms);

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

    const ctl = el('div', 'sp-controls paper', root);
    el('h3', 'panel-h', ctl, 'Field notes · controls');
    this.ctlList = el('div', 'ctl-grid', ctl);
    renderControls(this.ctlList, DEFAULT_CONTROLS);

    const foot = el('div', 'sp-foot', root);
    const sb = el('button', 'btn btn-ghost sp-settings', foot);
    sb.type = 'button';
    svgEl('i', 'btn-ico', sb, glyph('gear'));
    el('span', '', sb, 'Settings');
    sb.addEventListener('click', () => this.ui.settingsPanel.show());
    el('div', 'sp-credit', foot, `Co-op survival horror · 1–${MAX_PLAYERS} players`);

    this.full = false;
    this.joining = false;
  }

  get sel() {
    return this.roomList.find((r) => r.id === this.room) || this.roomList[0] || null;
  }

  _renderRooms() {
    const box = this.roomEl;
    const key = JSON.stringify([this.room, this.mode, this.roomList.map((r) => [r.id, r.players, r.phase, r.day])]);
    if (key === this._roomKey) return;
    this._roomKey = key;
    box.textContent = '';
    for (const r of this.roomList) {
      const row = el('button', 'sp-room' + (r.id === this.room ? ' on' : ''), box);
      row.type = 'button';
      const shown = r.main && r.wait ? this.mode : r.mode; // (an empty main room plays what the switcher says)
      row.style.setProperty('--accent', MODE_INFO[shown].accent);
      el('b', '', row, r.name);
      el('i', '', row, MODE_INFO[shown].name);
      const state = r.wait ? 'waiting' : r.mode === 1 ? `round ${r.day}` : `${r.phase === PHASE.NIGHT ? 'night' : 'day'} ${r.day}`;
      el('span', '', row, `${r.players}/${r.max} · ${state}`);
      row.addEventListener('click', () => this.selectRoom(r.id));
    }
  }

  selectRoom(id) {
    this.room = id;
    lsSet('stn.room', id);
    this._roomKey = '';
    this._renderRooms();
    this._syncModes();
    const r = this.sel;
    if (r) this.ui.cb.onMode?.(this._shownMode(), r.seed);
  }

  // the mode on show: the selected game's if it has one going (or was opened for one), else the switcher's
  _shownMode() {
    const r = this.sel;
    return r && (!r.main || !r.wait) ? r.mode : this.mode;
  }

  async _newGame() {
    if (this.joining) return;
    const name = this.name.value.replace(/\s+/g, ' ').trim().slice(0, 16) || 'Survivor';
    try {
      const res = await (await fetch(`/rooms/new?mode=${this.mode}&name=${encodeURIComponent(name + "'s game")}`)).json();
      if (res.error) return this.setError(res.error);
      this.room = res.id;
      lsSet('stn.room', res.id);
      await this._poll();
      this._join();
    } catch {
      this.setError('Could not open a game');
    }
  }

  setMode(m, quiet = false) {
    this.mode = m;
    if (!quiet) lsSet('stn.mode', String(m));
    this.modeBtns.forEach((b, i) => b.classList.toggle('on', i === m));
    this._syncModes();
    if (!quiet && !MODE_INFO[m].solo) this.ui.cb.onMode?.(this._shownMode(), this.sel?.seed);
  }

  _syncModes() {
    const solo = MODE_INFO[this.mode]?.solo;
    this.roomsBox.hidden = !!solo;
    const locked = this.running >= 0 && !solo;
    this.modeBtns.forEach((b, i) => {
      b.classList.toggle('on', locked ? i === this.running : i === this.mode);
      b.classList.toggle('lock', locked && i !== this.running && !MODE_INFO[i].solo);
    });
    this._syncBtn();
    const shown = locked ? this.running : this.mode;
    if (solo) {
      this.goal.textContent = 'Four maps. Four vehicles. One long night.';
      this.tag.textContent = MODE_INFO[this.mode].tag;
    } else if (shown === 1) {
      this.goal.textContent = 'Clear the round. Spend your points. Take the cage down.';
      this.tag.textContent = MODE_INFO[1].tag;
    } else [this.goal.textContent, this.tag.textContent] = this.tagSurvival;
    this.modeNote.textContent = locked ? `A ${MODE_INFO[this.running].name} run is under way: you will join it.` : MODE_INFO[this.mode].blurb;
  }

  _join() {
    // DEAD RIDE is its own page
    if (MODE_INFO[this.mode]?.solo) {
      location.href = MODE_INFO[this.mode].href;
      return;
    }
    if (this.joining || this.full) return;
    let name = this.name.value.replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!name) {
      name = 'Survivor' + String(100 + ((Math.random() * 900) | 0));
      this.name.value = name;
    }
    lsSet('stn.name', name);
    this.joining = true;
    this.err.hidden = true;
    this.root.classList.add('joining');
    this._syncBtn();
    this.ui.cb.onJoin(name, this.running >= 0 ? this.running : this.mode, this.sel?.id || 'main');
  }

  _syncBtn() {
    const solo = MODE_INFO[this.mode]?.solo;
    this.joinBtn.disabled = !solo && (this.joining || this.full);
    this.joinTxt.textContent = solo ? 'Play' : this.joining ? 'Joining…' : this.full ? 'Server full' : 'Join';
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
      // (the selected game speaks for the server: its players, its phase)
      try {
        this.roomList = await (await fetch('/rooms', { cache: 'no-store' })).json();
      } catch {
        this.roomList = [];
      }
      if (!this.roomList.some((r) => r.id === this.room)) this.room = 'main';
      const sel = this.sel;
      if (sel) Object.assign(s, { players: sel.players, max: sel.max, phase: sel.phase, day: sel.day, mode: sel.mode });
      this._renderRooms();
      const players = s.players | 0;
      this.running = sel && !sel.main ? sel.mode : players > 0 && s.phase !== PHASE.WAITING ? s.mode | 0 : -1;
      this._syncModes();
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
    this.setMode(this.mode, true);
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
    const sb = el('button', 'btn btn-ghost', btns);
    sb.type = 'button';
    svgEl('i', 'btn-ico', sb, glyph('gear'));
    el('span', '', sb, 'Settings');
    const lb = el('button', 'btn btn-ghost btn-danger', btns);
    lb.type = 'button';
    svgEl('i', 'btn-ico', lb, glyph('exit'));
    el('span', '', lb, 'Leave game');
    const ctl = el('div', 'pause-controls paper', root);
    el('h3', 'panel-h', ctl, 'Controls');
    this.ctlList = el('div', 'ctl-grid', ctl);
    renderControls(this.ctlList, DEFAULT_CONTROLS);

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
      if (e.target.closest('.pause-btns, .pause-controls')) return;
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
    } else if (this.ui.settingsPanel.visible && this.ui.splash.root.hidden) {
      this.ui.settingsPanel.hide();
    }
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
    // the next run's mode: most votes wins, nobody voting keeps this one (server: Game.tallyVotes)
    const vote = el('div', 'end-vote', m);
    el('span', '', vote, 'Next run');
    this.voteBtns = MODE_INFO.map((mi) => {
      const b = el('button', 'btn btn-ghost end-votebtn', vote, mi.name);
      b.type = 'button';
      b.style.setProperty('--accent', mi.accent);
      b.addEventListener('click', () => {
        this.voted = mi.id;
        this._syncVote();
        this.ui.cb.onVote?.(mi.id);
      });
      return b;
    });
    this.count = el('div', 'end-count', m);
  }

  _syncVote() {
    this.voteBtns.forEach((b, i) => b.classList.toggle('on', i === this.voted));
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
    this.nightsL.textContent = stats.unit ? (n === 1 ? stats.unit : stats.unit + 's') + ' survived' : n === 1 ? 'night survived' : 'nights survived';
    this.voted = stats.mode ?? 0;
    this._syncVote();

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
