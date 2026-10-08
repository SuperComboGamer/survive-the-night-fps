// Full-screen menus and overlays: splash/title, pause, death, game over / victory, connection banner.
import { PHASE, MAX_PLAYERS } from '../../shared/constants.js';
import { el, svgEl, lsGet, lsSet, fmtTime } from './dom.js';
import { glyph } from './icons.js';
import { bindsOf, keyName } from '../game/binds.js';
import { loadRecord } from './records.js';
import { GameBrowser, GameCreator, phaseText, seatsText, difficultyText } from './games.js';
import { linkedCode, gameInfo, listGames, getLeaderboard } from '../net/lobby.js';
import { accountState, onAccountChange, refreshAccount } from '../net/account.js';
import { voteDifficulty } from '../net/feedback.js';
import { playingFriends, unreadCount, onSocialChange, socialState } from '../net/friends.js';
import { achievementsView, onAchievements, ACH_TOTAL } from '../net/achievements.js';
import { fetchProgress, lastProgress, onProgress } from '../net/progress.js';
import { xpBar } from './progress.js';
import { XP_SRC_NAMES, levelInfo } from '../../shared/progress.js';
import { CharacterCard, releaseStage } from './picker.js';

// the count on a button (unread messages): '' hides it
function setBadge(b, n) {
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : n ? String(n) : '';
}

// The keys of the controls lists, from the player's keybinds (game/binds.js): an action's key caps, each of its binds
export const keysOf = (action) => bindsOf(action).filter(Boolean).map(keyName);
// the four movement keys on one cap, 'W A S D' (each one's primary)
export const moveKeys = () => ['forward', 'left', 'back', 'right'].map((a) => keysOf(a)[0] || '–').join(' ');
// the weapon slots: '1 – 6' while they are the digits in a row, else each one's key
export function slotKeys() {
  const ks = [1, 2, 3, 4, 5, 6].map((i) => keysOf('slot' + i)[0] || '–');
  return ks.join('') === '123456' ? '1 – 6' : ks.join(' ');
}

// the short list, behind the Controls button unless main.js gives a fuller one (ui.setControls). A function: the list
// is drawn afresh each time it is shown, with the keys as they are bound then
export const DEFAULT_CONTROLS = () => [
  [moveKeys(), 'Move'],
  [keysOf('sprint'), 'Sprint'],
  [keysOf('jump'), 'Jump'],
  [keysOf('crouch'), 'Crouch'],
  [keysOf('fire'), 'Attack · place'],
  [keysOf('aim'), 'Aim · heavy swing'],
  [keysOf('reload'), 'Reload · nunchucks flourish'],
  [keysOf('interact'), 'Interact · pick up'],
  [keysOf('flashlight'), 'Flashlight'],
  [slotKeys(), 'Weapon slots'],
  [keysOf('inventory'), 'Inventory & crafting'],
  [keysOf('players'), 'Player list (hold)'],
  [keysOf('chat'), 'Chat'],
  [keysOf('talk'), 'Push to talk'],
  [keysOf('slot6'), 'Walkie-talkie: hold fire to talk to everyone'],
  ['Esc', 'Menu'],
];

// list: [[keys, action], ...], or a function that makes one. keys: a string ('Shift+LMB': a cap each side of the +),
// or an array of caps, one per bind ([] for an action left without a key)
export function renderControls(parent, list) {
  parent.textContent = '';
  for (const [k, a] of typeof list === 'function' ? list() : list) {
    const r = el('div', 'ctl-row', parent);
    const keys = el('span', 'ctl-keys', r);
    if (Array.isArray(k)) {
      k.forEach((cap, i) => {
        if (i) el('span', 'ctl-or', keys, '/');
        el('span', 'kbd sm', keys, cap);
      });
      if (!k.length) el('span', 'kbd sm ctl-none', keys, 'unbound');
    } else for (const part of String(k).split(/\s*\+\s*/)) el('span', 'kbd sm', keys, part);
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
// The title screen and the way into a game: a name, then Quick join (the busiest public game with a seat, or a new
// one), Browse games or Create game (games.js). A page opened from a game's invite link (?game=CODE, lobby.js) is
// that game's invitation instead, and Join goes straight into it - unless it is full or over.
export class Splash {
  constructor(ui, parent) {
    this.ui = ui;
    const root = (this.root = el('div', 'splash', parent));
    root.hidden = true;
    // the walk around the valley behind it (game/menutour.js) fades to black through this at every cut
    this.cut = el('div', 'sp-cut', root);
    this.cutK = 0;
    el('div', 'sp-shade', root); // (the menu's side of the screen, darkened)
    el('div', 'ov-vignette', root);
    el('div', 'sp-fog', root);
    el('div', 'grain', root);
    el('div', 'scratches', root);

    // the menu down the left; the scene is drawn off-centre into the open part beside it (sceneX)
    this.credit = el('div', 'sp-kicker', root, `Co-op survival horror · 1–${MAX_PLAYERS} players`);
    const main = (this.main = el('div', 'sp-main', root));
    this.sceneX = 0.5;
    window.addEventListener('resize', () => this._measure());
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

    // the invitation, on a page opened from a game's link
    const inv = (this.invite = el('div', 'sp-invite', main));
    inv.hidden = true;
    this.invKicker = el('div', 'sp-inv-k', inv, 'You are invited to');
    this.invName = el('div', 'sp-inv-name', inv, '');
    this.invMeta = el('div', 'sp-inv-meta', inv, '');

    // who to play as (picker.js): a card over the name and the way in
    const form = (this.form = el('form', 'sp-join', main));
    this.character = new CharacterCard(ui, main, root, form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._join();
    });
    const field = el('label', 'sp-field', form);
    this.nameL = el('span', 'sp-field-l', field, 'Playing as');
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
    this.joinTxt = el('span', '', this.joinBtn, 'Quick join');
    svgEl('i', 'btn-ico sp-go', this.joinBtn, glyph('arrowRight'));

    // the other ways in
    const alt = el('div', 'sp-alt', main);
    const altBtn = (icon, text, fn) => {
      const b = el('button', 'btn btn-ghost', alt);
      b.type = 'button';
      svgEl('i', 'btn-ico', b, glyph(icon));
      el('span', '', b, text);
      b.addEventListener('click', fn);
      return b;
    };
    this.quickAlt = altBtn('bolt', 'Quick join', () => this.join(''));
    altBtn('search', 'Browse games', () => this.browser.show());
    altBtn('plus', 'Create game', () => this.creator.show());
    this.friendsBtn = altBtn('people', 'Friends', () => this.ui.friends.show());
    this.friendsTxt = this.friendsBtn.lastChild;
    this.friendsBadge = el('b', 'sp-badge', this.friendsBtn, '');
    this.friendsBadge.hidden = true;
    onSocialChange(() => this._syncFriends());

    // the account (account.js), top right: Sign in, or who you are signed in as
    const acct = (this.acctBtn = el('button', 'btn btn-ghost sp-acct', root));
    acct.type = 'button';
    svgEl('i', 'btn-ico', acct, glyph('person'));
    this.acctTxt = el('span', '', acct, 'Sign in');
    acct.addEventListener('click', () => this.ui.accountPanel.show());
    onAccountChange(() => {
      this._syncAccount();
      this._syncFriends();
    });

    this.err = el('div', 'sp-err', main, '');
    this.err.hidden = true;
    const st = (this.status = el('div', 'sp-status', main));
    this.dot = el('i', 'dot', st);
    this.statusTxt = el('span', '', st, 'Contacting server…');
    // the player's own record (records.js): not there at all until a first run is on it
    this.record = el('div', 'sp-record', main);

    const foot = el('div', 'sp-foot', root);
    const btns = el('div', 'sp-btns', foot);
    // your level, and the perks to pick (progress.js): lit while one is waiting
    const pb = (this.perksBtn = el('button', 'btn btn-ghost sp-perks', btns));
    pb.type = 'button';
    svgEl('i', 'btn-ico', pb, glyph('arrowUp'));
    this.perksTxt = el('span', '', pb, 'Perks');
    this.perksBadge = el('b', 'sp-badge', pb, '');
    this.perksBadge.hidden = true;
    pb.addEventListener('click', () => this.ui.progress.show());
    onProgress((v) => this._syncPerks(v));
    const ab = el('button', 'btn btn-ghost', btns);
    ab.type = 'button';
    svgEl('i', 'btn-ico', ab, glyph('trophy'));
    el('span', '', ab, 'Achievements');
    ab.addEventListener('click', () => this.ui.achPanel.show());
    const lb = el('button', 'btn btn-ghost', btns);
    lb.type = 'button';
    svgEl('i', 'btn-ico', lb, glyph('skull'));
    el('span', '', lb, 'Leaderboard');
    lb.addEventListener('click', () => this._showLeaderboard());
    // the whole game's numbers (/stats, client/stats/), in a tab of its own
    const gs = el('button', 'btn btn-ghost', btns);
    gs.type = 'button';
    svgEl('i', 'btn-ico', gs, glyph('signal'));
    el('span', '', gs, 'Stats');
    gs.addEventListener('click', () => window.open('/stats', '_blank', 'noopener'));
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

    this.browser = new GameBrowser(ui, root, this);
    this.creator = new GameCreator(ui, root, this);
    this.code = ''; // the game this page was opened for (its invite link)
    this.game = null; // ...as the server last described it
    this.gone = false; // ...and it is not there (any more)
    this.offline = false;
    this.joining = false;
    this.next = ''; // a game to go on into once this is up (a friend's, picked in another game: FriendsPanel.join)
    this.boardRequest = 0;
    this.boardClose = null;
  }

  async _showLeaderboard() {
    if (this.ui.boardOpen) return;
    const request = ++this.boardRequest;
    this.boardClose = this.ui.board.onClose;
    this.ui.board.onClose = () => this._hideLeaderboard();
    this.ui.board.setLobbyMode(true);
    this.ui.setBoard(null);
    this.ui.setBoardOpen(true);
    try {
      const data = await getLeaderboard();
      if (request === this.boardRequest && this.ui.boardOpen && !this.root.hidden) this.ui.setBoard(data);
    } catch (err) {
      if (request === this.boardRequest && this.ui.boardOpen && !this.root.hidden) this.ui.board.setError(err.message || 'Could not load the leaderboard.');
    }
  }

  _hideLeaderboard() {
    this.boardRequest++;
    this.ui.setBoardOpen(false);
    this.ui.setBoard(null);
    this.ui.board.setLobbyMode(false);
    this.ui.board.onClose = this.boardClose;
    this.boardClose = null;
  }

  _typedName() {
    return this.name.value.replace(/\s+/g, ' ').trim().slice(0, 16);
  }

  // Signed in, the name is the account's (the server plays them under it whatever is typed): the field shows it and
  // takes no typing. Signed out again, the name typed before comes back (it stayed in storage all along).
  _syncAccount() {
    const user = accountState().user;
    this.acctTxt.textContent = user ? user.username : 'Sign in';
    this.acctBtn.classList.toggle('on', !!user);
    this.acctBtn.title = user ? 'Your account: stats, last games, signing out' : 'Sign in or make an account: stats kept on the server, friends';
    if (user) {
      if (!this.name.readOnly) this.guestName = this._typedName(); // (a made-up one is not in storage until a join)
      this.name.value = user.username;
      this.name.readOnly = true;
      this.name.classList.add('locked');
      this.name.title = "Your account's name. Sign out (top right) to play under another.";
      this.nameL.textContent = 'Signed in as';
    } else if (this.name.readOnly) {
      this.name.readOnly = false;
      this.name.classList.remove('locked');
      this.name.title = '';
      this.name.value = (lsGet('stn.name', '') || this.guestName || '').slice(0, 16);
      this.nameL.textContent = 'Playing as';
    }
  }

  // the name to play under (one is made up if the field is empty)
  playerName() {
    let name = this._typedName();
    if (!name) {
      name = 'Survivor' + String(100 + ((Math.random() * 900) | 0));
      this.name.value = name;
    }
    return name;
  }

  // the invited game, while there is one to go into
  get invited() {
    return !!this.code && !this.gone;
  }

  _join() {
    this.join(this.invited ? this.code : '');
  }

  // code: the game to go into; '' for a quick join
  join(code) {
    if (this.joining) return;
    if (code && code === this.code && this.game?.full) return;
    const name = this.playerName();
    if (!accountState().user) lsSet('stn.name', name); // (the guest name: an account's own is not one to keep)
    this.joining = true;
    this.err.hidden = true;
    this.root.classList.add('joining');
    this._syncBtn();
    this.ui.cb.onJoin(name, code);
  }

  _syncBtn() {
    const full = this.invited && !!this.game?.full;
    this.joinBtn.disabled = this.joining || full;
    this.joinTxt.textContent = this.joining ? 'Joining…' : !this.invited ? 'Quick join' : full ? 'Game full' : 'Join game';
    this.quickAlt.hidden = !this.invited; // (without an invitation, the big button is the quick join)
  }

  // the Friends button says how many of them are in a game, and counts the messages nobody has read
  _syncFriends() {
    const on = !!accountState().user;
    const n = on ? playingFriends().length : 0;
    const unread = on ? unreadCount() : 0;
    this.friendsTxt.textContent = n ? `Friends · ${n} playing` : 'Friends';
    this.friendsBtn.classList.toggle('lit', n > 0);
    setBadge(this.friendsBadge, unread);
    this.friendsBtn.title = unread ? `${unread} new message${unread === 1 ? '' : 's'}` : '';
  }

  _syncPerks(v) {
    this.perksTxt.textContent = v ? `Level ${v.level} · Perks` : 'Perks';
    this.perksBtn.classList.toggle('lit', !!v?.pending);
    setBadge(this.perksBadge, v?.pending || 0);
    this.perksBtn.title = v?.pending ? 'A perk point is waiting to be spent' : 'Your level and the perk tree';
  }

  _syncInvite() {
    this.invite.hidden = !this.code;
    if (!this.code) return;
    const g = this.game;
    this.invite.className = 'sp-invite' + (this.gone ? ' gone' : g?.full ? ' full' : '');
    if (this.gone) {
      this.invKicker.textContent = 'Your invitation';
      this.invName.textContent = 'That game has ended';
      this.invMeta.textContent = 'Quick join, or find another under Browse games.';
    } else if (!g) {
      this.invKicker.textContent = 'You are invited to';
      this.invName.textContent = this.offline ? 'A game on this server' : 'Finding the game…';
      this.invMeta.textContent = `Code ${this.code}`;
    } else {
      this.invKicker.textContent = 'You are invited to';
      this.invName.textContent = g.name;
      const parts = [`${seatsText(g)} survivors`, difficultyText(g.difficulty), phaseText(g.phase, g.day)];
      if (g.inviteOnly) parts.push('Invite only');
      this.invMeta.textContent = g.full ? `Full · ${seatsText(g)} · a seat may free up, or pick another game` : parts.join(' · ');
    }
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
    if (text) this._poll(); // (a full or ended game: show it as it is now)
  }

  async _poll() {
    try {
      if (this.code && !this.gone) {
        // (a game that has ended does not come back: no asking again, which an address can only do so often)
        try {
          this.game = await gameInfo(this.code);
          this.gone = false;
        } catch (err) {
          if (err.status !== 404) throw err;
          this.game = null;
          this.gone = true;
        }
      }
      const lobby = await listGames();
      // (the server was not there when the page asked who it is signed in as: asked again now it is)
      const acct = accountState();
      if (!acct.ready || acct.offline) refreshAccount();
      if (this.root.hidden) return;
      this.offline = false;
      this.creator.setLimits(lobby.maxPlayers, lobby.defaultPlayers);
      this.credit.textContent = `Co-op survival horror · 1–${lobby.maxPlayers} players`;
      const n = lobby.games;
      this.statusTxt.textContent = n ? `${n} game${n === 1 ? '' : 's'} running · ${lobby.players} survivor${lobby.players === 1 ? '' : 's'} online` : 'No games running · start one';
      this.status.className = 'sp-status online' + (this.invited && this.game?.phase === PHASE.NIGHT ? ' night' : '');
    } catch {
      if (this.root.hidden) return;
      this.offline = true;
      this.statusTxt.textContent = 'Server offline';
      this.status.className = 'sp-status offline';
    }
    this._syncInvite();
    this._syncBtn();
  }

  syncRecord() {
    const { total: t, best: b } = loadRecord();
    this.record.textContent = '';
    this.record.hidden = !t.runs;
    if (!t.runs) return;
    el('b', 'sp-rec-l', this.record, 'Your record');
    const stat = (value, label, cls = '') => {
      const d = el('div', 'sp-stat' + cls, this.record);
      el('span', 'sp-stat-v', d, String(value));
      el('span', 'sp-stat-l', d, label);
    };
    stat(t.runs, t.runs === 1 ? 'Run' : 'Runs');
    stat(b.nights, 'Most nights');
    if (t.escapes) {
      stat(t.escapes, 'Escaped');
      stat(fmtTime(b.secs), 'Fastest');
    } else stat('Not yet', 'Escaped', ' none');
  }

  // How far across the screen the middle of the open part beside the menu is (where Renderer.setCenter puts the
  // scene's): half way when the menu takes the whole width (a narrow screen: the scene is behind it)
  _measure() {
    if (this.root.hidden) return;
    const w = window.innerWidth;
    const right = this.main.getBoundingClientRect().right;
    this.sceneX = right > 0 && right < w * 0.65 ? (right + w) / 2 / w : 0.5;
  }

  // the cut between two shots of the walk behind: 0 shows the scene, 1 is black
  setCut(k) {
    k = Math.round(k * 100) / 100;
    if (k === this.cutK) return;
    this.cutK = k;
    this.cut.style.opacity = String(k);
  }

  show() {
    this.root.hidden = false;
    this.joining = false;
    this.root.classList.remove('joining');
    const code = linkedCode();
    if (code !== this.code) {
      this.code = code;
      this.game = null;
      this.gone = false;
    }
    this._syncInvite();
    this._syncBtn();
    this._syncAccount();
    this._syncFriends();
    this._syncPerks(lastProgress());
    fetchProgress().catch(() => {}); // (what the run just played earned: the button says if a pick is waiting)
    this.syncRecord();
    this.character.show();
    this._measure();
    this.root.classList.remove('in');
    void this.root.offsetWidth;
    this.root.classList.add('in');
    clearInterval(this._iv);
    this._poll();
    this._iv = setInterval(() => this._poll(), 3000);
    setTimeout(() => {
      if (!this.root.hidden && !this.name.readOnly && document.activeElement === document.body) this.name.focus({ preventScroll: true });
    }, 50);
    if (this.next) {
      const code = this.next;
      this.next = '';
      setTimeout(() => !this.root.hidden && this.join(code), 0);
    }
  }

  hide() {
    if (this.ui.boardOpen && this.ui.board.lobbyMode) this._hideLeaderboard();
    this.root.hidden = true;
    clearInterval(this._iv);
    this._iv = 0;
    this.joining = false;
    this.browser.hide();
    this.creator.hide();
    this.character.panel.hide();
    this.character.panel.creator.close(); // (an edit not saved is kept for the next time it opens)
    releaseStage(); // (the picker's renderer: not needed in play)
  }
}

// ---------------------------------------------------------------- pause
// how long "Leave game" is held before it leaves (a stray click can't end a run)
const LEAVE_HOLD_MS = 900;

// The Esc menu: a rail down the left edge, the rest of the screen left almost clear, because the game never stops for
// it (no "paused" or "resume" anywhere on it). The arrow keys move through the rows and Enter opens one. Esc toggles it
// away; if the browser refuses to take the mouse back on that Esc, the game asks for a click.
export class Pause {
  constructor(ui, parent) {
    this.ui = ui;
    this.room = null;
    this.sel = 0;
    const root = (this.root = el('div', 'pause', parent));
    root.hidden = true;
    el('div', 'pause-shade', root);
    const rail = el('div', 'pause-rail', root);
    const live = el('div', 'pause-live', rail);
    el('i', 'pause-dot', live);
    el('span', '', live, 'Live · the world keeps moving');
    this.title = el('div', 'pause-title', rail, 'Menu');
    this.sub = el('div', 'pause-sub', rail, '');

    const list = el('div', 'pause-list', rail);
    list.setAttribute('role', 'menu');
    this.rows = [];
    const row = (into, icon, label, run, cls = '') => {
      const b = el('button', 'pr-row' + cls, into);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      svgEl('i', 'pr-ico', b, glyph(icon));
      el('span', 'pr-label', b, label);
      const hint = el('span', 'pr-hint', b);
      const r = { b, hint, run };
      b.addEventListener('pointerenter', () => this.select(this.rows.indexOf(r), false));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!r.run) return;
        this.ui.sound('ui_click');
        r.run();
      });
      this.rows.push(r);
      return r;
    };
    const back = row(list, 'arrowRight', 'Back to the game', () => this.ui.cb.onResume(), ' pr-back');
    el('span', 'kbd sm pr-key', back.hint, 'Enter');
    this.invite = row(list, 'personPlus', 'Invite friends', () => this.ui.invitePanel.show());
    this.perks = row(list, 'arrowUp', 'Perks', () => this.ui.progress.show());
    this.ach = row(list, 'trophy', 'Achievements', () => this.ui.achPanel.show());
    row(list, 'skull', 'Bestiary', () => this.ui.cb.onBestiary());
    row(list, 'cards', 'Dead Hand', () => this.ui.cb.onCards());
    this.fr = row(list, 'star', 'Friends', () => this.ui.friends.show());
    row(list, 'gear', 'Settings', () => this.ui.settingsPanel.show());
    row(list, 'keyboard', 'Controls', () => this.ui.controlsPanel.show());

    // held, not clicked: the fill runs along the row while it is held, and letting go early cancels
    el('div', 'pause-sep', rail);
    const leave = row(rail, 'exit', 'Leave game', null, ' pr-leave');
    this.leave = leave;
    this.fill = el('i', 'pr-fill', leave.b);
    this.fill.style.transitionDuration = `${LEAVE_HOLD_MS}ms`;
    this.leaveTxt = el('span', '', leave.hint, 'Hold');
    el('span', 'kbd sm', leave.hint, 'Enter');
    leave.b.addEventListener('pointerdown', (e) => e.button === 0 && this._hold());
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) leave.b.addEventListener(t, () => this._release());

    const keys = el('div', 'pause-keys', rail);
    const key = (caps, what) => {
      const k = el('span', 'pk', keys);
      for (const c of caps) el('span', 'kbd sm', k, c);
      el('span', 'pk-t', k, what);
    };
    key(['↑', '↓'], 'Select');
    key(['Enter'], 'Open');
    key(['Esc'], 'Back');
    el('span', 'pk pk-t', keys, 'Click away to go back');

    // the hints on the right of the rows, kept as what they stand for changes
    const sync = () => this._syncHints();
    onProgress(sync);
    onAchievements(sync);
    onSocialChange(sync);
    onAccountChange(sync);

    // captured before input.js, which would otherwise take Enter for the chat
    window.addEventListener('keydown', (e) => this._key(e), true);
    window.addEventListener('keyup', (e) => (e.code === 'Enter' || e.code === 'NumpadEnter') && this._release(), true);
    // clicking anywhere off the rail resumes (keeps the user gesture for pointer lock)
    root.addEventListener('click', (e) => {
      if (e.target.closest('.pause-rail')) return;
      this.ui.sound('ui_click');
      this.ui.cb.onResume();
    });
  }

  // the game we are in: { code, name, inviteOnly, difficulty } (null: none), and its invite link
  setRoom(room, link) {
    this.room = room;
    this.ui.invitePanel.set(room, link);
    this.invite.b.hidden = !room;
    this.title.textContent = room ? room.name : 'Menu';
    this._syncSub();
    this._syncHints();
  }

  _syncSub() {
    const room = this.room;
    if (!room) return void (this.sub.textContent = '');
    const n = this.ui.cb.onPeers?.()?.players?.length || 0;
    const parts = [difficultyText(room.difficulty), room.inviteOnly ? 'Invite only' : 'Public', `Code ${room.code}`];
    if (n) parts.push(`${n} survivor${n === 1 ? '' : 's'}`);
    this.sub.textContent = parts.join(' · ');
  }

  _syncHints() {
    const count = (hint, n, text) => {
      hint.textContent = '';
      if (n) el('b', 'pr-n', hint, n > 99 ? '99+' : String(n));
      el('span', '', hint, text);
    };
    this.invite.hint.textContent = this.room?.code || '';
    const pending = lastProgress()?.pending || 0;
    count(this.perks.hint, pending, pending ? 'to spend' : '');
    const a = achievementsView();
    this.ach.hint.textContent = a.loading || a.error ? '' : `${Object.keys(a.unlocked).length} / ${ACH_TOTAL}`;
    const s = socialState();
    const unread = accountState().user ? unreadCount() : 0;
    if (unread) count(this.fr.hint, unread, 'new');
    else this.fr.hint.textContent = accountState().user && s.loaded ? `${s.friends.filter((f) => f.status !== 'offline').length} online` : '';
  }

  // the row that Enter opens: hovered, or moved to with the arrow keys (hidden rows are stepped over)
  select(i, sound = true) {
    if (i < 0 || i === this.sel) return;
    this.rows[this.sel]?.b.classList.remove('on');
    this.sel = i;
    this.rows[i].b.classList.add('on');
    if (sound) this.ui.sound('ui_hover');
  }

  _step(d) {
    const n = this.rows.length;
    for (let k = 1; k < n; k++) {
      const i = (this.sel + d * k + n * k) % n;
      if (!this.rows[i].b.hidden) return this.select(i);
    }
  }

  // a panel opened from here, or the chat, has the keys
  get _covered() {
    return this.ui.isTyping() || !!this.ui.root.querySelector('.layer-modal > :not([hidden])');
  }

  _key(e) {
    if (this.root.hidden || this._covered) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      this._step(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      const r = this.rows[this.sel];
      if (e.repeat) {
        // (a repeat only keeps a hold going)
      } else if (r === this.leave) this._hold();
      else {
        this.ui.sound('ui_click');
        r.run();
      }
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  _hold() {
    if (this._holdT) return;
    this.leave.b.classList.add('holding');
    this.leaveTxt.textContent = 'Hold';
    this._holdT = setTimeout(() => {
      this._holdT = 0;
      this.leave.b.classList.remove('holding');
      this.ui.cb.onLeave();
    }, LEAVE_HOLD_MS);
  }

  _release() {
    if (!this._holdT) return;
    clearTimeout(this._holdT);
    this._holdT = 0;
    this.leave.b.classList.remove('holding');
    this.leaveTxt.textContent = 'Keep holding';
    clearTimeout(this._nudgeT);
    this._nudgeT = setTimeout(() => (this.leaveTxt.textContent = 'Hold'), 1800);
  }

  show(on) {
    on = !!on;
    if (on === !this.root.hidden) return;
    this.root.hidden = !on;
    this.ui.root.classList.toggle('paused', on);
    clearInterval(this._iv);
    if (on) {
      this.sel = -1;
      this.rows.forEach((r) => r.b.classList.remove('on'));
      this.select(0, false);
      this._syncSub();
      this._syncHints();
      this._iv = setInterval(() => this._syncSub(), 1000); // (survivors joining and leaving while it is up)
      this.root.classList.remove('in');
      void this.root.offsetWidth;
      this.root.classList.add('in');
    } else {
      this._release();
      if (this.ui.splash.root.hidden) {
        if (this.ui.settingsPanel.visible) this.ui.settingsPanel.hide();
        if (this.ui.controlsPanel.visible) this.ui.controlsPanel.hide();
        if (this.ui.invitePanel.visible) this.ui.invitePanel.hide();
        if (this.ui.friends.visible) this.ui.friends.hide();
        if (this.ui.accountPanel.visible) this.ui.accountPanel.hide();
        if (this.ui.progress.visible && !this.ui.inventoryOpen) this.ui.progress.hide();
      }
    }
  }
}

// ---------------------------------------------------------------- invite
// The game's code and invite link, opened from "Invite friends" on the pause menu. It borrows the settings panel's
// card and closes the same ways as the controls list.
export class InvitePanel {
  constructor(ui, parent) {
    this.ui = ui;
    this.root = el('div', 'stn-settings stn-invite', parent);
    this.root.setAttribute('role', 'dialog');
    this.root.hidden = true;
    const card = el('div', 'set-card paper', this.root);
    const head = el('div', 'set-head', card);
    el('h2', 'set-title', head, 'Invite friends');
    this.sub = el('span', 'set-sub', head, '');
    const close = svgEl('button', 'set-close btn-icon', head, glyph('xmark'));
    close.title = 'Close';
    close.addEventListener('click', () => this.hide());
    const body = el('div', 'set-body', card);
    el('div', 'pi-title', body, 'Game code');
    this.code = el('div', 'iv-code', body, '');
    el('div', 'pi-title', body, 'Invite link');
    const row = el('div', 'pi-row', body);
    this.link = el('input', 'pi-link', row);
    this.link.type = 'text';
    this.link.readOnly = true;
    this.link.spellcheck = false;
    this.link.addEventListener('focus', () => this.link.select());
    const copy = el('button', 'btn btn-ghost pi-copy', row);
    copy.type = 'button';
    svgEl('i', 'btn-ico', copy, glyph('link'));
    this.copyTxt = el('span', '', copy, 'Copy invite link');
    copy.addEventListener('click', () => this.copy());
    this.note = el('div', 'pi-note', body, '');
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

  set(room, link) {
    if (!room) return this.hide();
    this.sub.textContent = `${room.name} · ${difficultyText(room.difficulty)} · ${room.inviteOnly ? 'invite only' : 'public'}`;
    this.code.textContent = room.code;
    this.link.value = link;
    this.note.textContent = room.inviteOnly ? 'Only people with this link can join.' : 'Anyone can join from Browse games, or straight in with this link.';
    this.copyTxt.textContent = 'Copy invite link';
  }

  async copy() {
    const link = this.link.value;
    let ok = false;
    try {
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch {
      // (no clipboard API outside https / localhost: the old way, from the selected field)
      this.link.focus();
      this.link.select();
      try {
        ok = document.execCommand('copy');
      } catch {}
    }
    this.copyTxt.textContent = ok ? 'Link copied' : 'Select it and copy';
    clearTimeout(this._copyT);
    this._copyT = setTimeout(() => (this.copyTxt.textContent = 'Copy invite link'), 2200);
  }

  show() {
    this.copyTxt.textContent = 'Copy invite link';
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
    el('span', 'set-sub', head, 'field notes · rebind in Settings');
    const close = svgEl('button', 'set-close btn-icon', head, glyph('xmark'));
    close.title = 'Close';
    close.addEventListener('click', () => this.hide());
    this.list = el('div', 'ctl-grid', el('div', 'set-body', card));
    this.source = DEFAULT_CONTROLS; // (ui.setControls) drawn as it is shown, with the keys bound then
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
    renderControls(this.list, this.source);
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
// the answers to "how hard was it?", 1..5 as the server counts them (server/feedback.js)
const DIFFICULTY = ['Too easy', 'Easy', 'Just right', 'Hard', 'Too hard'];

// whole percents of counts that add up to 100 (the largest remainders get the leftover points)
function percents(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => 0);
  const exact = counts.map((n) => (n * 100) / total);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}

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
    // the panels' row and the poll under it, the poll as wide as the row
    const body = el('div', 'end-body', m);
    // the team's board and the player's own record sit side by side, so the record costs the screen no height
    const panels = el('div', 'end-panels', body);
    this.board = el('div', 'end-board paper', panels);
    this.record = el('div', 'end-board end-record paper', panels);
    // what the run earned (S2C.PROGRESS, the server's own tally): the bar to the next level, and where the XP came from
    this.xp = el('div', 'end-board end-xp paper', panels);
    el('h3', 'panel-h', this.xp, 'Experience');
    this.xpBar = xpBar(this.xp, 'end-xpb');
    this.xpUp = el('div', 'ex-up', this.xp, '');
    this.xpList = el('ul', 'ex-list', this.xp);
    this.xpFoot = el('div', 'er-foot', this.xp, '');
    this.xp.hidden = true;
    // how hard the run was: a scale of five, and then how everyone has voted, as columns filling the same answers
    this.poll = el('div', 'end-board end-poll paper', body);
    const pollHead = el('h3', 'panel-h ep-head', this.poll, 'How hard was it?');
    this.pollFoot = el('span', 'ep-foot', pollHead, '');
    const opts = el('div', 'ep-opts', this.poll);
    this.pollOpts = DIFFICULTY.map((label, i) => {
      const b = el('button', 'ep-opt', opts);
      b.type = 'button';
      const fill = el('i', '', el('span', 'ep-bar', b));
      const row = el('span', 'ep-row', b);
      el('span', 'ep-key', row, String(i + 1));
      el('span', 'ep-label', row, label);
      const pct = el('b', 'ep-pct', b, '');
      b.addEventListener('click', () => this._vote(i + 1));
      return { b, pct, fill };
    });
    // 1-5 vote as well as a click (the keys of the answers)
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden || !this.vote || e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.ui.isTyping()) return;
      const n = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
      if (n) this._vote(+n[1]);
    });
    this.vote = null;
    this.voteSeq = 0;
    this.count = el('div', 'end-count', m);
  }

  // A fresh poll for this run. vote: rating 1..5 -> a promise of { mine, counts, total } (net/feedback.js), or
  // nothing for no poll
  _poll(vote) {
    this.vote = vote || null;
    this.voteSeq++; // (an answer still on its way is for the run before)
    this.poll.hidden = !this.vote;
    this.poll.className = 'end-board end-poll paper';
    for (const o of this.pollOpts) {
      o.b.classList.remove('mine');
      o.pct.textContent = '';
      o.fill.style.height = '0%';
    }
    this.pollFoot.className = 'ep-foot';
    this.pollFoot.textContent = 'Press 1-5 or click · helps us tune the game';
  }

  async _vote(rating) {
    if (!this.vote) return;
    const seq = ++this.voteSeq;
    this.poll.classList.add('sending');
    this.pollOpts.forEach((o, i) => o.b.classList.toggle('mine', i === rating - 1));
    this.pollFoot.className = 'ep-foot';
    if (!this.poll.classList.contains('voted')) this.pollFoot.textContent = 'Counting your vote...';
    let res;
    try {
      res = await this.vote(rating);
    } catch (err) {
      if (seq !== this.voteSeq) return;
      this.poll.classList.remove('sending');
      this.pollFoot.className = 'ep-foot bad';
      this.pollFoot.textContent = err?.message || 'Your vote did not get through';
      return;
    }
    if (seq !== this.voteSeq) return;
    // everyone's votes, this one counted: each answer's share as a column (the most picked one full), ours lit
    const counts = DIFFICULTY.map((_, i) => Math.max(0, (res?.counts?.[i] | 0)));
    const total = counts.reduce((a, b) => a + b, 0);
    const most = Math.max(...counts);
    const pcts = percents(counts);
    this.poll.classList.remove('sending');
    this.poll.classList.add('voted');
    this.pollOpts.forEach((o, i) => {
      o.pct.textContent = pcts[i] + '%';
      o.fill.style.height = (most ? (counts[i] * 100) / most : 0) + '%';
    });
    this.pollFoot.textContent = `${total} vote${total === 1 ? '' : 's'} so far · click another to change yours`;
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

  // p: { xp (on record, this run's in it), run: [XP by source, as XP_SRC], loaded, kept } or null (not heard yet).
  // Called again while the screen is up when the server's last word on the run comes after it
  setXp(p) {
    this.xp.hidden = !p;
    if (!p) return;
    const got = p.run.reduce((a, b) => a + b, 0);
    const now = this.xpBar.set(p.xp);
    const was = levelInfo(p.xp - got).level;
    this.xpUp.hidden = !(p.loaded && now.level > was);
    this.xpUp.textContent = now.level > was ? `Level up · level ${now.level}` : '';
    this.xpList.textContent = '';
    p.run.forEach((v, i) => {
      if (!v) return;
      const li = el('li', '', this.xpList);
      el('span', '', li, XP_SRC_NAMES[i]);
      el('b', '', li, `+${v.toLocaleString('en-US')}`);
    });
    if (!got) el('li', 'none', this.xpList, 'Nothing this run');
    this.xpFoot.textContent = !p.kept ? 'Not kept: this player has no record' : !p.loaded ? `+${got} XP this run · your record could not be read, so the level counts this run only` : `+${got.toLocaleString('en-US')} XP this run · pick perks from Perks on the menu`;
  }

  show(kind, stats = {}) {
    const victory = kind === 'victory';
    this.root.hidden = false;
    this.root.className = 'end ' + (victory ? 'victory' : 'gameover');
    void this.root.offsetWidth;
    this.root.classList.add('in');
    this.kicker.textContent = victory ? (stats.plane ? 'Wheels up' : 'The engine turns over') : 'Game over';
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
    this.setXp(stats.progress || null);
    // (no poll on a server that keeps no votes: one without a database has no accounts either)
    this._poll(stats.vote || (accountState().accounts ? voteDifficulty : null));

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

// ---------------------------------------------------------------- a deploy with a new client: reloading, then back in
export class UpdatingModal {
  constructor(parent) {
    this.root = el('div', 'stn-settings stn-updating', parent);
    this.root.setAttribute('role', 'alertdialog');
    this.root.hidden = true;
    const card = el('div', 'set-card paper', this.root);
    el('h2', 'set-title', el('div', 'set-head', card), 'Game updated');
    el('p', 'upd-text', el('div', 'set-body', card), 'Refreshing to the new version. You will be put back in this game automatically.');
  }

  show(on) {
    this.root.hidden = !on;
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
