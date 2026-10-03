// The account panel, opened from the splash's account button (and from the friends panel, signed out): signing in or
// making an account; then who you are, what the server has on record for you over every game, your last games,
// and signing out. The account itself is client/net/account.js. It borrows the lobby's card (games.js) and closes
// the same ways: the cross, Esc, or a click outside the card.
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { Panel } from './games.js';
import { accountState, onAccountChange, refreshAccount, register, login, logout, myStats } from '../net/account.js';

// the four the leaderboard ranks, as it calls them (leaderboard.js)
const TILES = [
  ['kills', 'Kills', 'skull'],
  ['nights', 'Nights', 'moon'],
  ['wins', 'Wins', 'car'],
  ['revives', 'Revives', 'cross'],
];
const num = (n) => (n | 0).toLocaleString('en-US');

// '2 h ago' and the like, from a time (ms or anything Date takes)
export function ago(t) {
  const ms = typeof t === 'number' ? t : new Date(t).getTime();
  if (!(ms > 0)) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 45) return `${Math.round(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// '3 h 20 min', '12 min', '40 s'
export function duration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

const day = (t) => {
  const d = new Date(t);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

// what became of a game you played: its title, and good / bad for its colour
function outcomeOf(m) {
  if (!m.outcome) return ['Still going', ''];
  if (m.outcome === 'victory') {
    if (m.myOutcome === 'escaped') return ['Escaped', 'good'];
    if (m.myOutcome === 'left_behind') return ['Left behind', ''];
    return ['They escaped', ''];
  }
  if (m.outcome === 'wipe') return ['Wiped out', 'bad'];
  if (m.outcome === 'interrupted') return ['Cut short', ''];
  return ['Abandoned', ''];
}

function whenIn(m) {
  const d = m.lastDay | 0;
  if (!d) return '';
  if (m.lastPhase === 'night') return `Night ${d}`;
  if (m.lastPhase === 'final_stand') return `Final stand, day ${d}`;
  return `Day ${d}`;
}

export class AccountPanel extends Panel {
  constructor(ui, parent) {
    super(ui, parent, 'ac-panel', 'Account');
    this.tab = 'signin'; // 'signin' | 'register'
    this.busy = false;
    this.after = null; // a panel to go back to once signed in (the friends panel sent them here)
    this.stats = null; // /api/me/stats as last answered
    this.statsErr = '';
    this.statsFor = ''; // ...for this account

    // ---- signed out: sign in, or make an account
    const out = (this.outView = el('div', 'ac-out', this.body));
    const seg = el('div', 'set-seg ac-tabs', out);
    this.tabBtns = [
      ['signin', 'Sign in'],
      ['register', 'Create account'],
    ].map(([id, label]) => {
      const b = el('button', 'seg-btn', seg, label);
      b.type = 'button';
      b.addEventListener('click', () => this.setTab(id));
      return [id, b];
    });

    this.signin = this.form(out, 'Sign in', 'Signing in…', [
      ['login', 'Email or name', 'text', 'username', 254],
      ['password', 'Password', 'password', 'current-password', 128],
    ]);
    this.signin.root.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit('signin');
    });
    this.reg = this.form(out, 'Create account', 'Creating it…', [
      ['email', 'Email', 'email', 'email', 254, 'only for signing in: nobody else sees it'],
      ['username', 'Name', 'text', 'username', 16, 'what everyone sees you as: 3 to 16 letters, numbers, . _ -'],
      ['password', 'Password', 'password', 'new-password', 128, '8 characters or more'],
    ]);
    this.reg.root.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit('register');
    });
    const note = el('p', 'ac-note', out);
    svgEl('i', 'ac-note-ico', note, glyph('star'));
    el(
      'span',
      '',
      note,
      'With an account your stats are kept on the server, you play under your name wherever you sign in, and you can add friends, message them and join their games. What this browser has earned as a guest moves onto the account.'
    );

    // ---- signed in: who, the record, the last games
    const inV = (this.inView = el('div', 'ac-in', this.body));
    const prof = el('div', 'ac-prof', inV);
    svgEl('i', 'ac-prof-ico', prof, glyph('person'));
    const who = el('div', 'ac-who', prof);
    this.uName = el('div', 'ac-name', who, '');
    this.uMeta = el('div', 'ac-meta', who, '');
    this.guestNote = el('p', 'ac-note ac-guest', inV, 'You are in this game as a guest: your account takes over from the next game you join.');
    el('div', 'fr-h', inV, 'Over every game');
    this.tiles = el('div', 'ac-tiles', inV);
    this.more = el('div', 'ac-more', inV);
    el('div', 'fr-h', inV, 'Your last games');
    this.matches = el('div', 'gb-list ac-matches', inV);

    // ---- no accounts here, or no server
    const no = (this.noView = el('div', 'gb-empty ac-none', this.body));
    this.noText = el('p', '', no, '');
    this.noSub = el('p', 'gb-empty-sub', no, '');
    this.retry = el('button', 'btn btn-ghost ac-retry', no);
    this.retry.type = 'button';
    el('span', '', this.retry, 'Try again');
    this.retry.addEventListener('click', () => refreshAccount().then(() => this.render()));

    // ---- foot: signing out, and the friends panel
    this.outBtn = el('button', 'btn btn-ghost btn-danger', this.foot);
    this.outBtn.type = 'button';
    svgEl('i', 'btn-ico', this.outBtn, glyph('exit'));
    this.outTxt = el('span', '', this.outBtn, 'Sign out');
    this.outBtn.addEventListener('click', () => this.signOut());
    el('span', 'gb-gap', this.foot);
    this.friendsBtn = el('button', 'btn btn-ghost', this.foot);
    this.friendsBtn.type = 'button';
    svgEl('i', 'btn-ico', this.friendsBtn, glyph('star'));
    el('span', '', this.friendsBtn, 'Friends');
    this.friendsBtn.addEventListener('click', () => {
      this.hide();
      this.ui.friends.show();
    });

    onAccountChange(() => {
      if (this.visible) this.render();
    });
    this.setTab('signin');
  }

  // A form of labelled fields: [name, label, type, autocomplete, maxLength, hint]. -> { root, fields: name ->
  // { input, err }, err, go, goTxt, label, busyLabel }
  form(parent, label, busyLabel, defs) {
    const root = el('form', 'ac-form', parent);
    root.noValidate = true; // (the server says what is wrong, in the game's words)
    const fields = {};
    for (const [name, text, type, auto, max, hint] of defs) {
      const f = el('label', 'ac-field', root);
      const l = el('span', 'set-label', f, text);
      if (hint) el('span', 'set-hint', l, hint);
      const input = el('input', 'gc-name ac-in', f);
      input.type = type;
      input.name = name;
      input.autocomplete = auto;
      input.maxLength = max;
      input.spellcheck = false;
      input.autocapitalize = 'off';
      const err = el('span', 'ac-ferr', f, '');
      err.hidden = true;
      input.addEventListener('input', () => (err.hidden = true));
      fields[name] = { input, err };
    }
    const err = el('div', 'gc-err ac-err', root, '');
    err.hidden = true;
    const row = el('div', 'ac-go', root);
    const go = el('button', 'btn btn-blood', row);
    go.type = 'submit';
    const goTxt = el('span', '', go, label);
    return { root, fields, err, go, goTxt, label, busyLabel };
  }

  setTab(tab, focus = true) {
    this.tab = tab;
    for (const [id, b] of this.tabBtns) b.classList.toggle('on', id === tab);
    this.signin.root.hidden = tab !== 'signin';
    this.reg.root.hidden = tab !== 'register';
    this.sub.textContent = tab === 'signin' ? 'welcome back' : 'one account, every game';
    if (focus) this.focusFirst();
  }

  focusFirst() {
    const f = this.tab === 'signin' ? this.signin : this.reg;
    if (!this.visible || f.root.hidden) return;
    const first = Object.values(f.fields).find((x) => !x.input.value) || Object.values(f.fields)[0];
    setTimeout(() => this.visible && !f.root.hidden && first.input.focus({ preventScroll: true }), 30);
  }

  // opts: { tab: 'signin' | 'register', after: a panel to show once signed in }
  show(opts = {}) {
    super.show();
    this.after = opts.after || null;
    if (opts.tab) this.setTab(opts.tab);
    for (const f of [this.signin, this.reg]) {
      f.err.hidden = true;
      for (const x of Object.values(f.fields)) x.err.hidden = true;
    }
    const a = accountState();
    if (!a.ready || a.offline) refreshAccount().then(() => this.visible && this.render());
    this.render();
    this.focusFirst();
  }

  hide() {
    super.hide();
    this.after = null;
  }

  async submit(which) {
    if (this.busy) return;
    const f = which === 'signin' ? this.signin : this.reg;
    const v = (k) => f.fields[k].input.value;
    f.err.hidden = true;
    for (const x of Object.values(f.fields)) x.err.hidden = true;
    this.busy = true;
    f.go.disabled = true;
    f.goTxt.textContent = f.busyLabel;
    try {
      if (which === 'signin') await login({ login: v('login').trim(), password: v('password') });
      else await register({ email: v('email').trim(), username: v('username').trim(), password: v('password') });
      for (const x of Object.values(f.fields)) if (x.input.type === 'password') x.input.value = '';
      const then = this.after;
      if (then) {
        this.hide();
        then.show();
      } else this.render();
    } catch (err) {
      const field = f.fields[err.field];
      if (field) {
        field.err.textContent = err.message;
        field.err.hidden = false;
        field.input.focus({ preventScroll: true });
        field.input.select();
      } else {
        f.err.textContent = err.message || 'Something went wrong';
        f.err.hidden = false;
        if (err.status === 401) {
          f.fields.password.input.focus({ preventScroll: true });
          f.fields.password.input.select();
        }
      }
    } finally {
      this.busy = false;
      f.go.disabled = false;
      f.goTxt.textContent = f.label;
    }
  }

  async signOut() {
    if (this.busy) return;
    this.busy = true;
    this.outTxt.textContent = 'Signing out…';
    try {
      await logout();
    } catch {}
    this.busy = false;
    this.outTxt.textContent = 'Sign out';
    this.stats = null;
    this.statsFor = '';
    this.setTab('signin', false);
    this.render();
  }

  async loadStats() {
    const u = accountState().user;
    if (!u) return;
    const id = u.id;
    this.statsErr = '';
    try {
      const s = await myStats();
      if (accountState().user?.id !== id) return;
      this.stats = s;
      this.statsFor = id;
    } catch (err) {
      this.statsErr = err.message || 'Could not load your record';
    }
    if (this.visible) this.renderIn();
  }

  // in a game as a guest (signed in since joining it): the account takes over from the next one
  _guestHere() {
    try {
      const at = this.ui.cb.onPeers();
      const self = at?.players.find((p) => p.self);
      return !!self && !self.account;
    } catch {
      return false;
    }
  }

  render() {
    const a = accountState();
    const user = a.user;
    const none = !a.ready || !a.accounts || (a.offline && !user);
    this.noView.hidden = !none;
    this.outView.hidden = none || !!user;
    this.inView.hidden = none || !user;
    this.outBtn.hidden = !user;
    this.friendsBtn.hidden = !user;
    this.foot.hidden = !user;
    if (none) {
      this.sub.textContent = '';
      this.retry.hidden = a.ready && !a.offline;
      if (!a.ready && !a.offline) {
        this.noText.textContent = 'Asking the server…';
        this.noSub.textContent = '';
      } else if (a.offline) {
        this.noText.textContent = 'Cannot reach the server.';
        this.noSub.textContent = 'Signing in needs it: try again in a moment.';
      } else {
        this.noText.textContent = 'Accounts are not set up on this server.';
        this.noSub.textContent = 'Everything else works as a guest: your record is kept for this browser.';
      }
      return;
    }
    if (!user) {
      this.setTab(this.tab, false);
      return;
    }
    this.sub.textContent = 'signed in';
    if (this.statsFor !== user.id) {
      this.stats = null;
      this.statsFor = '';
    }
    this.renderIn();
    this.loadStats();
  }

  renderIn() {
    const user = accountState().user;
    if (!user) return;
    this.uName.textContent = user.username;
    const since = day(user.createdAt);
    this.uMeta.textContent = [user.email, since && `member since ${since}`].filter(Boolean).join(' · ');
    this.guestNote.hidden = !this._guestHere();

    const s = this.stats?.stats || null;
    this.tiles.textContent = '';
    this.more.textContent = '';
    this.matches.textContent = '';
    if (!this.stats) {
      el('div', 'gb-empty fr-empty ac-wait', this.tiles, this.statsErr || 'Looking up your record…');
      return;
    }
    for (const [k, label, icon] of TILES) {
      const t = el('div', 'ac-tile', this.tiles);
      const h = el('span', 'ac-tile-l', t);
      svgEl('i', 'ac-tile-ico', h, glyph(icon));
      el('span', '', h, label);
      el('b', '', t, num(s?.[k]));
      const rank = s?.ranks?.[k] | 0;
      el('small', rank ? 'ranked' : '', t, rank ? `#${num(rank)} on the board` : 'unranked');
    }
    if (s) {
      const bits = [
        ['Games', num(s.games)],
        ['Deaths', num(s.deaths)],
        ['Downed', num(s.downs)],
        ['Headshots', num(s.headshots)],
        ['Bosses', num(s.bossKills)],
        ['Best day', s.bestDay ? num(s.bestDay) : '—'],
        ['Time played', duration(s.playSeconds)],
      ];
      for (const [label, value] of bits) {
        const b = el('span', 'ac-bit', this.more);
        el('span', '', b, label);
        el('b', '', b, value);
      }
    } else el('p', 'ac-note', this.more, 'Nothing on record yet: play a game and it shows up here.');

    const recent = Array.isArray(this.stats.recent) ? this.stats.recent : [];
    if (!recent.length) {
      el('div', 'gb-empty fr-empty', this.matches, 'No games yet.');
      return;
    }
    for (const m of recent) {
      const [title, tone] = outcomeOf(m);
      const row = el('div', 'gb-row ac-match' + (tone ? ' ' + tone : ''), this.matches);
      const who = el('div', 'gb-who', row);
      el('div', 'gb-name', who, title);
      const meta = [whenIn(m), m.players ? `${m.players} player${m.players === 1 ? '' : 's'}` : '', m.seconds ? `you played ${duration(m.seconds)}` : '', ago(m.startedAt)];
      el('div', 'gb-meta', who, meta.filter(Boolean).join(' · '));
      const k = el('div', 'gb-seats', row);
      k.title = 'Your kills in it';
      svgEl('i', 'gb-ico', k, glyph('skull'));
      el('span', '', k, num(m.kills));
      const n = el('div', 'gb-seats', row);
      n.title = 'Nights you saw through in it';
      svgEl('i', 'gb-ico', n, glyph('moon'));
      el('span', '', n, num(m.nights));
    }
  }
}
