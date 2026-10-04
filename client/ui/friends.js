// The friends panel, opened from the splash and the pause menu. Signed out, it says what an account is for and
// where to get one (account.js). Signed in: the requests waiting for your answer; the people in the game you are in,
// to add; your friends - those you can go and join first, then those online, then the rest - each with a Chat, a
// Join (or "Leave & join" from inside a game) while they play; adding someone by their name; and the requests you
// sent. Chat opens the conversation in the panel itself. The friends, the requests and the messages are
// client/net/friends.js. It borrows the lobby's card (games.js) and closes the same ways: the cross, Esc, or a click
// outside the card.
//
// In a game, a message from a friend or a friend request is said in the chat as a line of its own, and nothing else:
// the pointer and the keys stay with the game.
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { Panel, phaseText, seatsText } from './games.js';
import { ago } from './account.js';
import { accountState, onAccountChange } from '../net/account.js';
import {
  socialState,
  onSocialChange,
  onSocialEvent,
  friend,
  isFriendName,
  requestedName,
  askedByName,
  playingFriends,
  refreshFriends,
  requestFriend,
  acceptFriend,
  declineFriend,
  removeFriend,
  friendGame,
  conversation,
  loadConversation,
  loadOlder,
  sendMessage,
  setOpenConversation,
} from '../net/friends.js';

const MSG_MAX = 500;
const STAMP_GAP = 10 * 60 * 1000; // a time over the messages after a pause this long
const lower = (s) => String(s || '').toLowerCase();
const sameId = (a, b) => String(a) === String(b);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const SAID = {
  sent: (n) => `Request sent to ${n}. They show up in your friends once they say yes.`,
  accepted: (n) => `${n} had asked you already: you are friends now.`,
  pending: (n) => `You asked ${n} already: it is waiting for them.`,
  already: (n) => `${n} is your friend already.`,
};

// 'Today 14:02', 'Yesterday 09:15', 'Oct 1 22:40'
function stamp(t) {
  const d = new Date(t);
  if (isNaN(d)) return '';
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Today ${hm}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday ${hm}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${hm}`;
}

// a button: an icon, a word or both
function button(parent, cls, icon, text, fn) {
  const b = el('button', 'btn btn-ghost ' + cls, parent);
  b.type = 'button';
  if (icon) svgEl('i', 'btn-ico', b, glyph(icon));
  if (text) el('span', '', b, text);
  if (fn) b.addEventListener('click', fn);
  return b;
}

export class FriendsPanel extends Panel {
  constructor(ui, parent) {
    super(ui, parent, 'fr-panel', 'Friends');
    this.confirm = ''; // the friend whose cross was pressed once (a second press takes them off)
    this.confirmT = 0;
    this.key = '';
    this.convId = ''; // the friend whose conversation is on screen ('' = the lists)
    this.convV = -1; // ...as it stood when last drawn
    this.convFirst = '';
    this.joiningId = ''; // the friend whose game is being looked up to join
    this.busy = new Set(); // ids with an accept / decline / add out

    // ---- signed out
    const out = (this.outView = el('div', 'gb-empty fr-signin', this.body));
    svgEl('i', 'fr-signin-ico', out, glyph('people'));
    this.outText = el('p', '', out, '');
    this.outSub = el('p', 'gb-empty-sub', out, '');
    const ob = (this.outBtns = el('div', 'fr-signin-btns', out));
    button(ob, '', 'person', 'Sign in', () => this.toAccount('signin'));
    button(ob, '', 'personPlus', 'Create account', () => this.toAccount('register'));

    // ---- the lists
    const lists = (this.listView = el('div', 'fr-lists', this.body));
    this.reqSec = el('div', 'fr-sec', lists);
    el('div', 'fr-h', this.reqSec, 'Asking to be your friend');
    this.reqList = el('div', 'gb-list', this.reqSec);

    this.hereSec = el('div', 'fr-sec', lists);
    el('div', 'fr-h', this.hereSec, 'In this game');
    this.hereList = el('div', 'gb-list', this.hereSec);
    this.hereNote = el('div', 'fr-note', this.hereSec, '');

    el('div', 'fr-h', lists, 'Your friends');
    this.list = el('div', 'gb-list', lists);

    // adding someone by their name
    const add = el('form', 'fr-add', lists);
    add.addEventListener('submit', (e) => {
      e.preventDefault();
      this.addTyped();
    });
    this.input = el('input', 'gc-name fr-name-in', add);
    this.input.type = 'text';
    this.input.maxLength = 16;
    this.input.placeholder = 'Their name, to send a friend request';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.addBtn = el('button', 'btn btn-ghost', add);
    this.addBtn.type = 'submit';
    svgEl('i', 'btn-ico', this.addBtn, glyph('personPlus'));
    el('span', '', this.addBtn, 'Add');
    this.said = el('div', 'fr-said', lists, '');
    this.said.hidden = true;

    this.sentSec = el('div', 'fr-sec', lists);
    el('div', 'fr-h', this.sentSec, 'Waiting for an answer');
    this.sentList = el('div', 'gb-list', this.sentSec);

    // ---- a conversation
    const cv = (this.convView = el('div', 'fr-conv', this.body));
    const ch = el('div', 'fr-conv-head', cv);
    button(ch, 'fr-back', 'arrowLeft', 'Friends', () => this.closeConv());
    const cw = (this.convWho = el('div', 'gb-who fr-conv-who', ch));
    const cn = el('div', 'gb-name', cw);
    el('i', 'fr-dot', cn);
    this.convName = el('span', '', cn, '');
    this.convMeta = el('div', 'gb-meta', cw, '');
    this.convJoin = button(ch, 'gb-join', '', '', () => {
      const f = friend(this.convId);
      if (f) this.join(f);
    });
    this.convJoinTxt = el('span', '', this.convJoin, 'Join');
    this.msgs = el('div', 'fr-msgs', cv);
    this.msgs.setAttribute('role', 'log');
    const send = el('form', 'fr-send', cv);
    send.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send();
    });
    this.msgIn = el('input', 'gc-name fr-msg-in', send);
    this.msgIn.type = 'text';
    this.msgIn.maxLength = MSG_MAX;
    this.msgIn.autocomplete = 'off';
    this.msgIn.setAttribute('aria-label', 'Message');
    const sb = el('button', 'btn btn-ghost', send);
    sb.type = 'submit';
    svgEl('i', 'btn-ico', sb, glyph('arrowRight'));
    el('span', '', sb, 'Send');
    this.sendErr = el('div', 'fr-said', cv, '');
    this.sendErr.hidden = true;

    // ---- foot: who you are, and the account
    const mine = el('div', 'fr-mine', this.foot);
    el('span', 'fr-mine-l', mine, 'Signed in as');
    this.mineName = el('b', 'fr-mine-name', mine, '');
    el('span', 'gb-gap', this.foot);
    button(this.foot, '', 'person', 'Account', () => {
      this.hide();
      this.ui.accountPanel.show();
    });

    onSocialChange(() => this.visible && this.render());
    onAccountChange(() => {
      if (!accountState().user) this.convId = '';
      if (this.visible) this.render();
    });
    onSocialEvent((ev) => this.heard(ev));
  }

  // ---------------------------------------------------------------- open / close
  show() {
    super.show();
    this.said.hidden = true;
    this.key = '';
    this.convId = '';
    this.render();
    refreshFriends();
    // (a friend's game moves on - day, night, seats - without anything being said about it: asked for now and then)
    clearInterval(this._iv);
    this._iv = setInterval(() => this.visible && accountState().user && refreshFriends(), 5000);
  }

  hide() {
    super.hide();
    clearInterval(this._iv);
    this._iv = 0;
    this.confirm = '';
    if (this.convId) setOpenConversation('');
    this.convId = '';
  }

  // the account panel, to sign in from (and back here once signed in)
  toAccount(tab) {
    this.hide();
    this.ui.accountPanel.show({ tab, after: this });
  }

  // the game we are in and who else is in it, or null on the splash (main.js)
  peers() {
    try {
      return this.ui.cb.onPeers() || null;
    } catch {
      return null;
    }
  }

  // In a game, what is worth knowing at once goes in the chat as a line of its own. (On the splash the Friends
  // button counts it.)
  heard(ev) {
    if (!this.peers()) return;
    if (ev.t === 'dm') {
      if (this.visible && sameId(this.convId, ev.from.id)) return; // (being read right now)
      this.ui.addChat('', `Message from ${ev.from.username}: "${clip(String(ev.message.body || ''), 90)}" · Esc, then Friends, to answer`, { system: true });
    } else if (ev.t === 'request') this.ui.addChat('', `${ev.who.username} wants to be your friend · Esc, then Friends, to answer`, { system: true });
    else if (ev.t === 'accepted') this.ui.addChat('', `${ev.who.username} accepted your friend request`, { system: true });
  }

  say(text, ok = false) {
    const box = this.convId ? this.sendErr : this.said;
    box.textContent = text;
    box.className = 'fr-said' + (ok ? ' ok' : '');
    box.hidden = !text;
  }

  // ---------------------------------------------------------------- doing things
  async act(id, fn, failText) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    this.key = '';
    this.render();
    try {
      await fn();
    } catch (err) {
      this.say(err.message || failText);
    } finally {
      this.busy.delete(id);
      this.key = '';
      if (this.visible) this.render();
    }
  }

  async addName(name) {
    name = String(name || '').trim().replace(/^@/, '');
    if (!name) return this.say('Type the name they play under.');
    const k = 'add:' + lower(name);
    if (this.busy.has(k)) return;
    this.busy.add(k);
    this.addBtn.disabled = true;
    this.key = '';
    this.render();
    try {
      const r = await requestFriend(name);
      const said = SAID[r?.result];
      this.say(said ? said(r.friend?.username || name) : 'Done.', true);
      if (lower(this.input.value.trim()) === lower(name)) this.input.value = '';
    } catch (err) {
      this.say(err.message || 'Could not send the request.');
    } finally {
      this.busy.delete(k);
      this.addBtn.disabled = false;
      this.key = '';
      if (this.visible) this.render();
    }
  }

  addTyped() {
    this.addName(this.input.value);
  }

  // Joins a friend's game: asks where they are now (the list can be a few seconds old), then from the splash goes
  // straight in, and from a game leaves it first (the splash goes on into theirs once it is back up: Splash.show)
  async join(f) {
    if (this.joiningId || this.ui.splash.joining) return;
    this.joiningId = f.id;
    this.key = '';
    this.render();
    let g = null;
    let why = '';
    try {
      g = await friendGame(f.id);
    } catch (err) {
      why = err.status === 404 ? `${f.username} is not in a game any more.` : err.message || 'Could not find their game.';
    }
    this.joiningId = '';
    if (g?.full) {
      why = `${f.username}'s game is full right now.`;
      g = null;
    }
    const at = this.peers();
    if (g && at?.room && g.code === at.room.code) {
      why = `You are in ${f.username}'s game already.`;
      g = null;
    }
    if (!g) {
      this.key = '';
      this.render();
      this.say(why);
      refreshFriends();
      return;
    }
    this.hide();
    const splash = this.ui.splash;
    if (!at) return splash.join(g.code);
    splash.next = g.code;
    this.ui.cb.onLeave();
  }

  openConv(f) {
    this.convId = String(f.id);
    this.convV = -1;
    this.convFirst = '';
    this.convHad = false;
    this.sendErr.hidden = true;
    this.said.hidden = true;
    this.msgs.textContent = '';
    setOpenConversation(f.id);
    loadConversation(f.id);
    this.render();
    setTimeout(() => this.visible && this.convId && this.msgIn.focus({ preventScroll: true }), 30);
  }

  closeConv() {
    setOpenConversation('');
    this.convId = '';
    this.key = '';
    this.msgIn.value = '';
    this.render();
  }

  async send() {
    const id = this.convId;
    const text = this.msgIn.value.trim();
    if (!id || !text) return;
    this.msgIn.value = '';
    this.sendErr.hidden = true;
    this.convJump = true; // (your own message: down to it, wherever you were reading)
    try {
      await sendMessage(id, text);
    } catch (err) {
      if (this.convId !== id) return;
      if (!this.msgIn.value) this.msgIn.value = text; // (not lost: there to send again)
      this.say(err.message || 'Could not send it.');
    }
  }

  // ---------------------------------------------------------------- drawing
  render() {
    const a = accountState();
    const user = a.user;
    this.outView.hidden = !!user;
    this.listView.hidden = !user || !!this.convId;
    this.convView.hidden = !user || !this.convId;
    this.root.classList.toggle('conv', !!user && !!this.convId);
    this.foot.hidden = !user;
    if (!user) return this.renderOut(a);
    this.mineName.textContent = user.username;
    if (this.convId) return this.renderConv(user);
    this.renderLists(user);
  }

  renderOut(a) {
    this.sub.textContent = '';
    this.outBtns.hidden = !a.accounts;
    if (!a.accounts) {
      this.outText.textContent = 'Friends need an account, and this server has none set up.';
      this.outSub.textContent = 'You can still play together: send them the invite link from the pause menu.';
    } else {
      this.outText.textContent = 'Sign in to have friends.';
      this.outSub.textContent = 'Add people by their name, see who is playing and where, message them, and join their games - invite-only ones too.';
    }
  }

  // the way a friend reads in a row: the dot's class, and the line under their name
  status(f, at) {
    const g = f.status === 'playing' ? f.game : null;
    if (g) {
      if (at?.room && g.code === at.room.code) return ['on', 'In this game with you'];
      return ['on', `${phaseText(g.phase, g.day)} · ${g.name}${g.inviteOnly ? ' · invite only' : ''}`];
    }
    if (f.status === 'online') return ['idle', 'Online · not in a game'];
    return ['off', f.lastSeen ? `Last seen ${ago(f.lastSeen)}` : 'Offline'];
  }

  renderLists(user) {
    const s = socialState();
    const at = this.peers();
    const here = at ? at.players.filter((p) => !p.self) : [];
    const signedHere = here.filter((p) => p.account && lower(p.account) !== lower(user.username));
    const guests = here.length - here.filter((p) => p.account).length;
    if (this.confirm && performance.now() - this.confirmT > 4000) this.confirm = '';

    // the ones you can go and join first, then the rest of those playing, those online, the others by when last seen
    const rank = (f) => {
      const g = f.status === 'playing' ? f.game : null;
      if (g) return !g.full && !(at?.room && g.code === at.room.code) ? 0 : 1;
      return f.status === 'online' ? 2 : 3;
    };
    const seen = (f) => (f.lastSeen ? new Date(f.lastSeen).getTime() : 0);
    const rows = s.friends.slice().sort((a, b) => rank(a) - rank(b) || (b.unread | 0) - (a.unread | 0) || seen(b) - seen(a) || a.username.localeCompare(b.username));
    const n = playingFriends().length;
    this.sub.textContent =
      s.error && !s.loaded ? 'cannot reach the server' : !s.loaded ? 'looking…' : s.friends.length ? `${n} of ${s.friends.length} playing now` : 'add someone by their name';

    const key = JSON.stringify([
      at?.room?.code,
      signedHere.map((p) => [p.id, p.account, isFriendName(p.account), requestedName(p.account), !!askedByName(p.account)]),
      guests,
      s.incoming.map((r) => [r.id, r.username, ago(r.at)]),
      s.outgoing.map((r) => [r.id, r.username, ago(r.at)]),
      rows.map((f) => [f.id, f.username, f.status, f.unread, this.status(f, at)[1], f.game && seatsText(f.game), !!f.game?.full]),
      this.confirm,
      [...this.busy],
      this.joiningId,
      this.ui.splash.joining,
      s.loaded,
      s.error,
    ]);
    if (key === this.key) return;
    this.key = key;

    // ---- asking you
    this.reqSec.hidden = !s.incoming.length;
    this.reqList.textContent = '';
    for (const r of s.incoming) {
      const row = el('div', 'gb-row fr-row fr-req', this.reqList);
      const who = el('div', 'gb-who', row);
      el('div', 'gb-name', who, r.username);
      el('div', 'gb-meta', who, `asked ${ago(r.at)}`);
      el('span', '', row);
      const acts = el('div', 'fr-acts', row);
      const busy = this.busy.has(r.id);
      button(acts, 'gb-join', 'check', 'Accept', () => this.act(r.id, () => acceptFriend(r.id), 'Could not accept it.')).disabled = busy;
      const no = button(acts, 'fr-rm', 'xmark', '', () => this.act(r.id, () => declineFriend(r.id), 'Could not turn it down.'));
      no.title = 'Turn it down';
      no.disabled = busy;
    }

    // ---- in this game
    this.hereSec.hidden = !at || !here.length;
    this.hereList.textContent = '';
    for (const p of signedHere) {
      const row = el('div', 'gb-row fr-row', this.hereList);
      const who = el('div', 'gb-who', row);
      el('div', 'gb-name', who, p.account);
      if (p.name !== p.account) el('div', 'gb-meta', who, `playing as ${p.name}`);
      el('span', '', row);
      const acts = el('div', 'fr-acts', row);
      const asked = askedByName(p.account);
      if (isFriendName(p.account)) {
        const tag = el('span', 'fr-tag', acts);
        svgEl('i', 'fr-ico', tag, glyph('star'));
        el('span', '', tag, 'Friend');
      } else if (requestedName(p.account)) el('span', 'fr-tag dim', acts, 'Requested');
      else if (asked) button(acts, 'gb-join', 'check', 'Accept', () => this.act(asked.id, () => acceptFriend(asked.id), 'Could not accept it.')).disabled = this.busy.has(asked.id);
      else button(acts, 'gb-join', 'personPlus', 'Add', () => this.addName(p.account)).disabled = this.busy.has('add:' + lower(p.account));
    }
    this.hereNote.hidden = !guests;
    this.hereNote.textContent = guests
      ? `${guests === 1 ? 'One player here is' : `${guests} players here are`} playing as a guest: they can be added once they sign in.`
      : '';

    // ---- your friends
    this.list.textContent = '';
    if (!rows.length) {
      const e = el('div', 'gb-empty fr-empty', this.list);
      if (!s.loaded) el('p', '', e, s.error ? 'Cannot reach the server.' : 'Looking for your friends…');
      else {
        el('p', '', e, 'No friends yet.');
        el('p', 'gb-empty-sub', e, at ? 'Add the people in this game above, or someone by their name below.' : 'Add someone by the name they play under, below. They become your friend once they say yes.');
      }
    }
    for (const f of rows) {
      const g = f.status === 'playing' ? f.game : null;
      const [tone, meta] = this.status(f, at);
      const withYou = !!(g && at?.room && g.code === at.room.code);
      const row = el('div', 'gb-row fr-row ' + tone, this.list);
      const who = el('div', 'gb-who', row);
      const nm = el('div', 'gb-name', who);
      el('i', 'fr-dot', nm);
      el('span', '', nm, f.username);
      el('div', 'gb-meta', who, meta);
      const seats = el('div', 'gb-seats', row);
      if (g) {
        svgEl('i', 'gb-ico', seats, glyph('people'));
        el('span', '', seats, seatsText(g));
      }
      const acts = el('div', 'fr-acts', row);
      const chat = button(acts, 'fr-chat', 'chat', '', () => this.openConv(f));
      chat.title = f.unread ? `${f.unread} new message${f.unread === 1 ? '' : 's'}` : `Message ${f.username}`;
      if (f.unread) el('b', 'fr-badge', chat, f.unread > 99 ? '99+' : String(f.unread));
      const ach = button(acts, 'fr-chat', 'trophy', '', () => {
        this.hide();
        this.ui.achPanel.show({ friend: { id: f.id, name: f.username } });
      });
      ach.title = `${f.username}'s achievements`;
      if (g && !withYou) {
        const join = el('button', 'btn btn-ghost gb-join', acts);
        join.type = 'button';
        const looking = sameId(this.joiningId, f.id);
        join.disabled = !!g.full || !!this.joiningId || this.ui.splash.joining;
        el('span', '', join, looking ? 'Finding…' : g.full ? 'Full' : at ? 'Leave & join' : 'Join');
        join.addEventListener('click', () => this.join(f));
      }
      const sure = this.confirm === f.id;
      const rm = svgEl('button', 'btn btn-ghost fr-rm' + (sure ? ' sure' : ''), acts, sure ? '' : glyph('xmark'));
      rm.type = 'button';
      rm.disabled = this.busy.has(f.id);
      if (sure) el('span', '', rm, 'Remove');
      rm.title = sure ? 'Take them off your friends (both ways)' : 'Remove from friends';
      rm.addEventListener('click', () => {
        if (this.confirm === f.id) {
          this.confirm = '';
          this.act(f.id, () => removeFriend(f.id), 'Could not remove them.');
        } else {
          this.confirm = f.id;
          this.confirmT = performance.now();
          this.key = '';
          this.render();
        }
      });
    }

    // ---- asked by you
    this.sentSec.hidden = !s.outgoing.length;
    this.sentList.textContent = '';
    for (const r of s.outgoing) {
      const row = el('div', 'gb-row fr-row off', this.sentList);
      const who = el('div', 'gb-who', row);
      el('div', 'gb-name', who, r.username);
      el('div', 'gb-meta', who, `asked ${ago(r.at)} · not answered yet`);
      el('span', '', row);
      const acts = el('div', 'fr-acts', row);
      button(acts, 'gb-join', '', 'Cancel', () => this.act(r.id, () => declineFriend(r.id), 'Could not take it back.')).disabled = this.busy.has(r.id);
    }
  }

  renderConv(user) {
    const s = socialState();
    const f = friend(this.convId);
    if (!f) {
      // (taken off the list while this was open: back to it)
      if (s.loaded) {
        this.closeConv();
        this.say('They are not on your friends list any more.');
      }
      return;
    }
    const at = this.peers();
    const [tone, meta] = this.status(f, at);
    this.sub.textContent = `talking to ${f.username}`;
    this.convWho.className = 'gb-who fr-conv-who ' + tone;
    this.convName.textContent = f.username;
    this.convMeta.textContent = meta;
    const g = f.status === 'playing' ? f.game : null;
    const withYou = !!(g && at?.room && g.code === at.room.code);
    this.convJoin.hidden = !g || withYou;
    if (g) {
      this.convJoin.disabled = !!g.full || !!this.joiningId || this.ui.splash.joining;
      this.convJoinTxt.textContent = this.joiningId ? 'Finding…' : g.full ? 'Full' : at ? 'Leave & join' : 'Join';
    }

    const c = conversation(this.convId);
    if (c.v === this.convV) return;
    this.convV = c.v;
    const box = this.msgs;
    // the reader stays where they were: at the foot as messages come in if they were there, and on the same
    // message when older ones are put above it
    const atFoot = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const fromFoot = box.scrollHeight - box.scrollTop;
    const first = c.messages.length ? String(c.messages[0].id) : '';
    const above = !!this.convFirst && first !== this.convFirst;
    this.convFirst = first;
    box.textContent = '';
    if (c.more) {
      const older = button(box, 'fr-older', '', c.loading ? 'Loading…' : 'Older messages', () => loadOlder(this.convId));
      older.disabled = c.loading;
    }
    if (!c.messages.length) {
      el('div', 'gb-empty fr-empty', box, c.error || (c.loading || !c.loaded ? 'Loading…' : `Nothing yet. Say hello to ${f.username}.`));
    }
    let last = 0;
    let lastFrom = '';
    for (const m of c.messages) {
      const t = new Date(m.at).getTime() || 0;
      if (!last || t - last > STAMP_GAP) el('div', 'fr-stamp', box, stamp(m.at));
      const mine = sameId(m.from, user.id);
      const b = el('div', 'fr-msg' + (mine ? ' me' : '') + (String(m.from) === lastFrom && t - last <= STAMP_GAP ? ' cont' : ''), box);
      el('div', 'fr-msg-b', b, m.body);
      b.title = `${mine ? 'You' : f.username} · ${stamp(m.at)}`;
      last = t;
      lastFrom = String(m.from);
    }
    if (c.error && c.messages.length) el('div', 'fr-said', box, c.error);
    if (above && !this.convJump) box.scrollTop = box.scrollHeight - fromFoot;
    else if (atFoot || this.convJump || !this.convHad) box.scrollTop = box.scrollHeight;
    this.convJump = false; // (once down there, what comes next keeps it there: atFoot)
    this.convHad = c.messages.length > 0;
  }
}
