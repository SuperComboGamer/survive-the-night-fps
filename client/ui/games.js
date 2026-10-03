// The lobby's panels, opened from the splash: the list of public games (Browse games) and making a game of your own
// (Create game). Both borrow the settings panel's card (settings.js) and close the same ways: the cross, Esc, or a
// click outside the card. The lobby itself is client/net/lobby.js.
import { PHASE, MAX_PLAYERS } from '../../shared/constants.js';
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { listGames, createGame } from '../net/lobby.js';

export function phaseText(phase, day) {
  if (phase === PHASE.DAY) return `Day ${day}`;
  if (phase === PHASE.NIGHT) return `Night ${day}`;
  if (phase === PHASE.GAMEOVER) return 'Restarting';
  if (phase === PHASE.VICTORY) return 'They escaped';
  return 'Starting';
}
export const seatsText = (g) => `${g.players} / ${g.max}`;

// a card in the settings panel's style, with a head (title, sub line, close cross), a body and a foot
class Panel {
  constructor(ui, parent, cls, title) {
    this.ui = ui;
    this.root = el('div', `stn-settings ${cls}`, parent);
    this.root.setAttribute('role', 'dialog');
    this.root.hidden = true;
    const card = (this.card = el('div', 'set-card paper', this.root));
    const head = el('div', 'set-head', card);
    el('h2', 'set-title', head, title);
    this.sub = el('span', 'set-sub', head, '');
    const close = svgEl('button', 'set-close btn-icon', head, glyph('xmark'));
    close.type = 'button';
    close.title = 'Close';
    close.addEventListener('click', () => this.hide());
    this.body = el('div', 'set-body', card);
    this.foot = el('div', 'set-foot', card);
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

// ---------------------------------------------------------------- Browse games
// splash: the splash, whose name field and join the list's Join buttons use
export class GameBrowser extends Panel {
  constructor(ui, parent, splash) {
    super(ui, parent, 'gb-panel', 'Games');
    this.splash = splash;
    this.list = el('div', 'gb-list', this.body);
    const refresh = el('button', 'btn btn-ghost', this.foot);
    refresh.type = 'button';
    el('span', '', refresh, 'Refresh');
    refresh.addEventListener('click', () => this.poll());
    el('span', 'gb-gap', this.foot);
    const make = el('button', 'btn btn-ghost', this.foot);
    make.type = 'button';
    svgEl('i', 'btn-ico', make, glyph('plus'));
    el('span', '', make, 'Create game');
    make.addEventListener('click', () => {
      this.hide();
      this.splash.creator.show();
    });
    this.games = null;
  }

  show() {
    super.show();
    if (!this.games) this.render(null, 'Looking for games…');
    this.poll();
    clearInterval(this._iv);
    this._iv = setInterval(() => this.poll(), 3000);
  }

  hide() {
    super.hide();
    clearInterval(this._iv);
    this._iv = 0;
  }

  async poll() {
    try {
      const lobby = await listGames();
      if (this.root.hidden) return;
      this.games = lobby.list;
      this.sub.textContent = `${lobby.games} running · ${lobby.players} survivor${lobby.players === 1 ? '' : 's'} on this server`;
      this.render(lobby.list);
    } catch (err) {
      if (!this.root.hidden) this.render(null, err.message);
    }
  }

  render(list, note = '') {
    this.list.textContent = '';
    if (!list) {
      el('div', 'gb-empty', this.list, note);
      return;
    }
    if (!list.length) {
      const e = el('div', 'gb-empty', this.list);
      el('p', '', e, 'No public games right now.');
      el('p', 'gb-empty-sub', e, 'Make one and send the link around, or quick join to start one anybody can drop into.');
      return;
    }
    for (const g of list) {
      const row = el('div', 'gb-row' + (g.full ? ' full' : ''), this.list);
      const who = el('div', 'gb-who', row);
      el('div', 'gb-name', who, g.name);
      el('div', 'gb-meta', who, phaseText(g.phase, g.day) + (g.phase === PHASE.NIGHT ? ' · the horde is out' : ''));
      const seats = el('div', 'gb-seats', row);
      svgEl('i', 'gb-ico', seats, glyph('people'));
      el('span', '', seats, seatsText(g));
      const join = el('button', 'btn btn-ghost gb-join', row);
      join.type = 'button';
      join.disabled = g.full || this.splash.joining;
      el('span', '', join, g.full ? 'Full' : 'Join');
      join.addEventListener('click', () => {
        this.hide();
        this.splash.join(g.code);
      });
    }
  }
}

// ---------------------------------------------------------------- Create game
const SEAT_CHOICES = [2, 4, 6, 8, 12, 16, 24, 32];

export class GameCreator extends Panel {
  constructor(ui, parent, splash) {
    super(ui, parent, 'gc-panel', 'New game');
    this.splash = splash;
    this.sub.textContent = 'you get a link to send your friends';
    this.inviteOnly = false;
    this.seats = MAX_PLAYERS;
    this.cap = MAX_PLAYERS;

    const nameRow = el('label', 'set-row', this.body);
    const nl = el('span', 'set-label', nameRow, 'Name');
    el('span', 'set-hint', nl, 'what the game list calls it');
    this.name = el('input', 'gc-name', nameRow);
    this.name.type = 'text';
    this.name.maxLength = 28;
    this.name.autocomplete = 'off';
    this.name.spellcheck = false;

    const seatRow = el('div', 'set-row', this.body);
    const sl = el('span', 'set-label', seatRow, 'Players');
    el('span', 'set-hint', sl, 'the most that can be in it at once');
    this.seatSeg = el('div', 'set-seg', seatRow);

    const whoRow = el('div', 'set-row', this.body);
    const wl = el('span', 'set-label', whoRow, 'Who can join');
    this.whoHint = el('span', 'set-hint', wl, '');
    const seg = el('div', 'set-seg', whoRow);
    this.whoBtns = [
      [false, 'Anyone'],
      [true, 'Invite only'],
    ].map(([only, label]) => {
      const b = el('button', 'seg-btn', seg);
      b.type = 'button';
      svgEl('i', 'gc-seg-ico', b, glyph(only ? 'lock' : 'unlock'));
      el('span', '', b, label);
      b.addEventListener('click', () => {
        this.inviteOnly = only;
        this.sync();
      });
      return [only, b];
    });

    this.err = el('div', 'gc-err', this.body, '');
    this.err.hidden = true;

    const cancel = el('button', 'btn btn-ghost', this.foot);
    cancel.type = 'button';
    el('span', '', cancel, 'Cancel');
    cancel.addEventListener('click', () => this.hide());
    this.go = el('button', 'btn btn-blood', this.foot);
    this.go.type = 'button';
    this.goTxt = el('span', '', this.go, 'Create');
    this.go.addEventListener('click', () => this.create());
    this.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.create();
      }
    });
    this.busy = false;
    this.renderSeats();
    this.sync();
  }

  // cap: the most seats the server lets a game have; seats: what it gives one by default (/api/games)
  setLimits(cap, seats) {
    if (!(cap > 0) || (cap === this.cap && seats === this.defaultSeats)) return;
    this.cap = cap;
    if (this.defaultSeats !== seats) this.seats = Math.min(cap, seats || MAX_PLAYERS);
    this.defaultSeats = seats;
    this.renderSeats();
  }

  renderSeats() {
    this.seatSeg.textContent = '';
    const choices = SEAT_CHOICES.filter((n) => n <= this.cap);
    if (!choices.includes(this.seats)) choices.push(this.seats);
    choices.sort((a, b) => a - b);
    for (const n of choices) {
      const b = el('button', 'seg-btn' + (n === this.seats ? ' on' : ''), this.seatSeg, String(n));
      b.type = 'button';
      b.addEventListener('click', () => {
        this.seats = n;
        this.renderSeats();
      });
    }
  }

  sync() {
    for (const [only, b] of this.whoBtns) b.classList.toggle('on', only === this.inviteOnly);
    this.whoHint.textContent = this.inviteOnly ? 'only people you send the link to' : 'listed under Browse games for anybody';
    this.go.disabled = this.busy;
    this.goTxt.textContent = this.busy ? 'Making it…' : 'Create & join';
  }

  show() {
    super.show();
    this.err.hidden = true;
    this.name.placeholder = `${this.splash.playerName()}'s game`;
    setTimeout(() => this.visible && this.name.focus({ preventScroll: true }), 30);
  }

  async create() {
    if (this.busy || this.splash.joining) return;
    this.busy = true;
    this.err.hidden = true;
    this.sync();
    try {
      const host = this.splash.playerName();
      const g = await createGame({ name: this.name.value.trim() || `${host}'s game`, host, inviteOnly: this.inviteOnly, maxPlayers: this.seats });
      this.hide();
      this.splash.join(g.code);
    } catch (err) {
      this.err.textContent = err.message || 'Could not make the game';
      this.err.hidden = false;
    } finally {
      this.busy = false;
      this.sync();
    }
  }
}
