// A player's profile, opened by clicking them on the pinned player list [Tab] (roster.js): their level, what they
// have done in this game and over all their games (an account's, from the server: GET /api/players/:name), the perks
// they have in force, and a friend request to send them - or theirs to accept or turn down. A guest has no record
// beyond this game and cannot be asked: they are told apart and said to be one. It borrows the lobby's card
// (games.js) and closes the same ways: the cross, Esc, or a click outside the card.
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { Panel } from './games.js';
import { duration } from './account.js';
import { BRANCH_ICON } from './perktree.js';
import { PERKS, PERK_GROUPS, perkIds } from '../../shared/progress.js';
import { accountState } from '../net/account.js';
import { fetchProfile, onSocialChange, isFriendName, requestedName, askedByName, requestFriend, acceptFriend, declineFriend } from '../net/friends.js';

const num = (n) => (n | 0).toLocaleString('en-US');
const lower = (s) => String(s || '').toLowerCase();
const STATUS = { alive: 'On their feet', downed: 'Down', dead: 'Dead', zombie: 'Turned' };
const TILES = [
  ['kills', 'Kills', 'skull'],
  ['nights', 'Nights', 'moon'],
  ['wins', 'Wins', 'car'],
  ['revives', 'Revives', 'cross'],
];
const SAID = {
  sent: (n) => `Request sent. ${n} becomes your friend once they say yes.`,
  accepted: (n) => `${n} had asked you already: you are friends now.`,
  pending: (n) => `You asked ${n} already: it is waiting for them.`,
  already: (n) => `${n} is your friend already.`,
};

function button(parent, cls, icon, text, fn) {
  const b = el('button', 'btn ' + cls, parent);
  b.type = 'button';
  if (icon) svgEl('i', 'btn-ico', b, glyph(icon));
  el('span', '', b, text);
  b.addEventListener('click', fn);
  return b;
}

export class ProfilePanel extends Panel {
  constructor(ui, parent) {
    super(ui, parent, 'pf-panel', 'Survivor');
    this.p = null; // the player, as the list has them: { id, name, account, level, kills, status, perks, self }
    this.gone = false; // they left the game while this was open
    this.rec = null; // their account's profile, once it came
    this.recErr = '';
    this.busy = false;
    this.said = '';
    this.saidOk = false;

    const head = el('div', 'pf-head', this.body);
    const lv = el('span', 'xpb-lv pf-lv', head);
    el('small', '', lv, 'LV');
    this.lv = el('b', '', lv, '1');
    const who = el('div', 'pf-who', head);
    this.nameEl = el('div', 'pf-name', who, '');
    this.tags = el('div', 'pf-tags', who);

    el('div', 'fr-h', this.body, 'This game');
    this.game = el('div', 'ac-more pf-game', this.body);

    el('div', 'fr-h', this.body, 'All their games');
    this.tiles = el('div', 'ac-tiles', this.body);
    this.more = el('div', 'ac-more', this.body);

    this.perksH = el('div', 'fr-h', this.body, 'Perks');
    this.perks = el('div', 'pf-perks', this.body);

    this.saidEl = el('div', 'fr-said pf-said', this.body, '');
    this.acts = el('div', 'pf-acts', this.foot);
    el('span', 'gb-gap', this.foot);
    const close = el('button', 'btn btn-ghost', this.foot, 'Close');
    close.type = 'button';
    close.addEventListener('click', () => this.hide());

    onSocialChange(() => this.visible && this.renderActs());
  }

  // p: a row of the player list (Roster.set)
  show(p) {
    super.show();
    const same = this.p && this.p.id === p.id && this.p.account === p.account;
    this.p = { ...p };
    this.gone = false;
    if (!same) {
      this.rec = null;
      this.recErr = '';
      this.said = '';
    }
    this.render();
    if (p.account && !same) this.load(p.account);
  }

  async load(name) {
    try {
      const rec = await fetchProfile(name);
      if (lower(this.p?.account) === lower(name)) this.rec = rec;
    } catch (err) {
      if (lower(this.p?.account) === lower(name)) this.recErr = err.status === 503 ? 'This server keeps no records of accounts.' : err.message || 'Could not look them up.';
    }
    if (this.visible) this.render();
  }

  // the player list again (it comes every so often while it is up): what this game says of them now
  refresh(list) {
    if (!this.p) return;
    const now = list.find((q) => q.id === this.p.id && q.name === this.p.name);
    if (!now) {
      if (!this.gone) {
        this.gone = true;
        this.render();
      }
      return;
    }
    const was = this.p;
    this.p = { ...now };
    if (was.level !== now.level || was.kills !== now.kills || was.status !== now.status || was.perks !== now.perks || was.account !== now.account) this.render();
  }

  say(text, ok = false) {
    this.said = text;
    this.saidOk = ok;
    this.renderActs();
  }

  async act(fn, fail) {
    if (this.busy) return;
    this.busy = true;
    this.renderActs();
    try {
      await fn();
    } catch (err) {
      this.said = err.message || fail;
      this.saidOk = false;
    }
    this.busy = false;
    this.renderActs();
  }

  render() {
    const p = this.p;
    if (!p) return;
    this.sub.textContent = p.self ? 'you' : p.account ? 'signed in' : 'guest';
    this.lv.textContent = String(this.rec?.level || p.level || 1);
    this.nameEl.textContent = p.name;
    this.tags.textContent = '';
    const tag = (text, cls = '', icon = '') => {
      const t = el('span', 'pf-tag ' + cls, this.tags);
      if (icon) svgEl('i', 'fr-ico', t, glyph(icon));
      el('span', '', t, text);
    };
    if (p.self) tag('You', 'me');
    if (!p.self && p.account && isFriendName(p.account)) tag('Friend', 'friend', 'star');
    if (p.account && p.account !== p.name) tag(`Account ${p.account}`);
    if (!p.account) tag('Guest', 'dim');
    if (this.gone) tag('Left the game', 'dim');

    // this game
    this.game.textContent = '';
    for (const [label, value] of [
      ['Kills', num(p.kills)],
      ['Now', this.gone ? 'Gone' : STATUS[p.status] || 'On their feet'],
      ['Level', String(p.level || 1)],
    ]) {
      const b = el('span', 'ac-bit', this.game);
      el('span', '', b, label);
      el('b', '', b, value);
    }

    // over all their games
    this.tiles.textContent = '';
    this.more.textContent = '';
    const s = this.rec?.stats;
    if (!p.account) el('p', 'ac-note', this.more, 'Guests keep no record anyone else can see: they can sign in to have one.');
    else if (!this.rec) el('div', 'gb-empty fr-empty ac-wait', this.tiles, this.recErr || 'Looking up their record…');
    else {
      for (const [k, label, icon] of TILES) {
        const t = el('div', 'ac-tile', this.tiles);
        const h = el('span', 'ac-tile-l', t);
        svgEl('i', 'ac-tile-ico', h, glyph(icon));
        el('span', '', h, label);
        el('b', '', t, num(s[k]));
      }
      for (const [label, value] of [
        ['Games', num(s.games)],
        ['Deaths', num(s.deaths)],
        ['Headshots', num(s.headshots)],
        ['Bosses', num(s.bossKills)],
        ['Best day', s.bestDay ? num(s.bestDay) : '—'],
        ['Time played', duration(s.playSeconds)],
      ]) {
        const b = el('span', 'ac-bit', this.more);
        el('span', '', b, label);
        el('b', '', b, value);
      }
    }

    // the perks in force: theirs as this game has them, branch by branch
    const ids = perkIds(p.perks >>> 0);
    this.perksH.textContent = ids.length ? `Perks · ${ids.length}` : 'Perks';
    this.perks.textContent = '';
    if (!ids.length) el('p', 'ac-note', this.perks, p.self ? 'You have no perks in force yet: spend your points from Perks.' : 'No perks in force.');
    for (const q of PERKS.filter((x) => ids.includes(x.id)).sort((a, b) => a.group - b.group || a.tier - b.tier)) {
      const c = el('div', 'pf-perk' + (q.keystone ? ' key' : ''), this.perks);
      svgEl('i', 'pf-perk-ico', c, glyph(q.icon));
      const t = el('div', 'pf-perk-t', c);
      el('b', '', t, q.name);
      el('small', '', t, PERK_GROUPS[q.group]);
      c.title = q.text;
      svgEl('i', 'pf-perk-br', c, glyph(BRANCH_ICON[q.group]));
    }
    this.renderActs();
  }

  // what you can do about them: send a request, answer theirs, or nothing
  renderActs() {
    const p = this.p;
    this.acts.textContent = '';
    this.saidEl.textContent = this.said;
    this.saidEl.className = 'fr-said pf-said' + (this.saidOk ? ' ok' : '');
    this.saidEl.hidden = !this.said;
    if (!p) return;
    const me = accountState();
    const note = (text) => el('span', 'pf-note', this.acts, text);
    if (p.self) {
      button(this.acts, 'btn-ghost', 'arrowUp', 'Your perks', () => {
        this.hide();
        this.ui.progress.show();
      });
      return;
    }
    if (!p.account) return void note('Playing as a guest: they can be added once they sign in.');
    if (!me.accounts) return void note('This server has no accounts: no friend requests.');
    if (!me.user) return void note('Sign in (Esc, then Friends) to send a friend request.');
    if (lower(me.user.username) === lower(p.account)) return void note('That is your own account.');
    if (isFriendName(p.account)) return void note('You are friends.');
    const asked = askedByName(p.account);
    if (asked) {
      note(`${p.account} asked to be your friend.`);
      button(this.acts, 'btn-blood', 'check', 'Accept', () =>
        this.act(async () => {
          await acceptFriend(asked.id);
          this.said = `You and ${p.account} are friends now.`;
          this.saidOk = true;
        }, 'Could not accept it.')
      ).disabled = this.busy;
      button(this.acts, 'btn-ghost', 'xmark', 'Turn down', () =>
        this.act(async () => {
          await declineFriend(asked.id);
          this.said = 'Turned down.';
          this.saidOk = true;
        }, 'Could not turn it down.')
      ).disabled = this.busy;
      return;
    }
    if (requestedName(p.account)) return void note('Friend request sent: waiting for them.');
    button(this.acts, 'btn-blood', 'personPlus', 'Send friend request', () =>
      this.act(async () => {
        const r = await requestFriend(p.account);
        const said = SAID[r?.result];
        this.said = said ? said(r.friend?.username || p.account) : 'Done.';
        this.saidOk = true;
      }, 'Could not send the request.')
    ).disabled = this.busy;
  }
}
