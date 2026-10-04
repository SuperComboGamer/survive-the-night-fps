// Achievements on screen (the list: shared/achievements.js; the record: net/achievements.js):
//   AchievementToasts  the banner that slides in at the top right when one unlocks: icon, name, what it was for,
//                      the tier's colour, a shine across it and, for the rare ones, a burst of confetti. Several at
//                      once queue up; each is up about 4 s, less while more are waiting. Settings turn the banners
//                      and the chime off; with reduced motion asked for there is no slide, shine or confetti.
//   AchievementsPanel  the profile page: how many are unlocked, the latest, the headline counts, and every
//                      achievement by group - unlocked with its date, locked greyed out with a bar for a counter,
//                      a secret one as "???" until it is unlocked. A guest's from this browser, an account's from the
//                      server, or (show({ friend })) a friend's.
import { el, svgEl } from './dom.js';
import { glyph, achIcon } from './icons.js';
import { Panel } from './games.js';
import { ago } from './account.js';
import { ACHIEVEMENTS, ACH_GROUPS, ACH_TIERS, achProgress } from '../../shared/achievements.js';
import { achievementsView, onAchievements, refreshAchievements, friendAchievements } from '../net/achievements.js';
import { accountState } from '../net/account.js';

const SHOW_S = 4.2; // seconds a banner is up...
const SHOW_BUSY_S = 2.6; // ...while others wait behind it
const CONFETTI = 26;
const RARE = new Set(['gold', 'platinum']);
const TIER_NAME = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };
const num = (n) => (n | 0).toLocaleString('en-US');
const km = (m) => `${(m >= 10000 ? Math.floor(m / 1000) : Math.floor(m / 100) / 10).toLocaleString('en-US')} km`;
const amount = (a, n) => (a.unit === 'm' ? km(n) : num(n));
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const isRare = (a) => RARE.has(a.tier) || !!a.secret;

// ---------------------------------------------------------------- the banner
export class AchievementToasts {
  constructor(ui, parent) {
    this.ui = ui;
    this.root = el('div', 'ach-toasts', parent);
    this.root.setAttribute('aria-live', 'polite');
    this.queue = [];
    this.cur = null;
    this.timer = 0;
  }

  // achievements just unlocked, in front of the player
  show(list) {
    const s = this.ui.settings;
    for (const a of list) {
      if (s.achBanners === false) {
        if (s.achSound !== false) this.ui.sound(isRare(a) ? 'achieve_rare' : 'achieve');
        continue;
      }
      this.queue.push(a);
    }
    if (!this.cur) this.next();
  }

  next() {
    clearTimeout(this.timer);
    if (this.cur) {
      const old = this.cur;
      old.classList.add('out');
      setTimeout(() => old.remove(), 450);
      this.cur = null;
    }
    const a = this.queue.shift();
    this.ui.root.classList.toggle('ach-on', !!a); // (the killfeed steps out of the way: ui2.css)
    if (!a) return;
    const rare = isRare(a);
    const t = (this.cur = el('div', `ach-toast tier-${a.tier}${rare ? ' rare' : ''}`, this.root));
    const ico = el('div', 'ach-t-ico', t);
    svgEl('i', '', ico, achIcon(a.icon));
    const txt = el('div', 'ach-t-txt', t);
    el('div', 'ach-t-kick', txt, a.secret ? 'Secret achievement unlocked' : `Achievement unlocked · ${TIER_NAME[a.tier] || ''}`);
    el('div', 'ach-t-name', txt, a.name);
    el('div', 'ach-t-desc', txt, a.desc);
    el('i', 'ach-t-shine', t);
    if (rare && !reducedMotion()) this.confetti(t);
    if (this.ui.settings.achSound !== false) this.ui.sound(rare ? 'achieve_rare' : 'achieve');
    this.timer = setTimeout(() => this.next(), (this.queue.length ? SHOW_BUSY_S : SHOW_S) * 1000);
  }

  confetti(t) {
    const box = el('div', 'ach-confetti', t);
    for (let i = 0; i < CONFETTI; i++) {
      const c = el('i', '', box);
      const a = (i / CONFETTI) * Math.PI * 2 + Math.random() * 0.4;
      const d = 60 + Math.random() * 90;
      c.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(1)}px`);
      c.style.setProperty('--dy', `${(Math.sin(a) * d * 0.6 - 20).toFixed(1)}px`);
      c.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
      c.style.setProperty('--d', `${(0.9 + Math.random() * 0.7).toFixed(2)}s`);
      c.style.setProperty('--h', String(Math.round(Math.random() * 360)));
    }
    setTimeout(() => box.remove(), 2000);
  }

  // the game they were for is gone (back to the splash): the ones still waiting go with it
  clear() {
    this.queue.length = 0;
  }
}

// ---------------------------------------------------------------- the profile page
export class AchievementsPanel extends Panel {
  constructor(ui, parent) {
    super(ui, parent, 'ach-panel', 'Achievements');
    this.friend = null; // { id, name } while showing a friend's
    this.friendRec = null;
    this.friendErr = '';

    const sum = (this.sumEl = el('div', 'ach-sum', this.body));
    const count = el('div', 'ach-count', sum);
    svgEl('i', 'ach-count-ico', count, glyph('trophy'));
    const cn = el('div', 'ach-count-n', count);
    this.countN = el('b', '', cn, '0');
    this.countOf = el('span', '', cn, `/ ${ACHIEVEMENTS.length}`);
    this.countBar = el('i', 'ach-bar', el('div', 'ach-bar-bg', cn));
    this.tierEls = {};
    const tiers = el('div', 'ach-tiers', count);
    for (const t of ACH_TIERS) {
      const c = el('span', `ach-tier tier-${t}`, tiers);
      el('i', 'ach-dot', c);
      this.tierEls[t] = el('b', '', c, '0');
      el('span', '', c, TIER_NAME[t]);
    }
    this.heads = el('div', 'ac-tiles ach-heads', sum);
    el('div', 'fr-h', sum, 'Latest');
    this.recent = el('div', 'ach-recent', sum);

    this.note = el('div', 'ach-note', this.body);
    this.noteTxt = el('span', '', this.note, '');
    this.signIn = el('button', 'btn btn-ghost', this.note);
    this.signIn.type = 'button';
    svgEl('i', 'btn-ico', this.signIn, glyph('person'));
    el('span', '', this.signIn, 'Sign in');
    this.signIn.addEventListener('click', () => {
      this.hide();
      this.ui.accountPanel.show({ after: this });
    });

    this.wait = el('div', 'gb-empty fr-empty ach-wait', this.body, '');
    this.groups = el('div', 'ach-groups', this.body);

    onAchievements(() => {
      if (this.visible && !this.friend) this.render();
    });
  }

  // opts: { friend: { id, name } } for a friend's
  show(opts = {}) {
    super.show();
    this.friend = opts.friend || null;
    this.friendRec = null;
    this.friendErr = '';
    this.body.scrollTop = 0;
    if (this.friend) this.loadFriend(this.friend);
    else if (accountState().user) refreshAchievements();
    this.render();
  }

  async loadFriend(f) {
    try {
      const rec = await friendAchievements(f.id);
      if (this.friend !== f) return;
      this.friendRec = rec;
    } catch (err) {
      if (this.friend !== f) return;
      this.friendErr = err.message || 'Could not load their achievements';
    }
    if (this.visible) this.render();
  }

  // -> { stats, unlocked, loading, error, account }
  view() {
    if (!this.friend) return achievementsView();
    if (this.friendRec) return { ...this.friendRec, loading: false, error: '', account: true };
    return { stats: {}, unlocked: {}, loading: !this.friendErr, error: this.friendErr, account: true };
  }

  render() {
    const v = this.view();
    const a = accountState();
    this.sub.textContent = this.friend ? this.friend.name : v.account ? 'kept on your account' : 'kept in this browser';
    const waiting = v.loading || !!v.error;
    this.wait.hidden = !waiting;
    this.wait.textContent = v.error || 'Looking up the achievements…';
    this.sumEl.hidden = this.groups.hidden = waiting;
    // a guest, where there are accounts to keep them on
    this.note.hidden = !!this.friend || v.account || !a.accounts || a.offline;
    this.noteTxt.textContent = 'Kept in this browser only. Sign in and they move onto your account, with everything earned here.';
    if (waiting) return;
    this.renderSummary(v);
    this.renderGroups(v);
  }

  renderSummary(v) {
    const ids = Object.keys(v.unlocked);
    this.countN.textContent = num(ids.length);
    this.countBar.style.width = `${((ids.length / ACHIEVEMENTS.length) * 100).toFixed(1)}%`;
    const per = Object.fromEntries(ACH_TIERS.map((t) => [t, 0]));
    for (const a of ACHIEVEMENTS) if (v.unlocked[a.id]) per[a.tier]++;
    for (const t of ACH_TIERS) this.tierEls[t].textContent = num(per[t]);

    this.heads.textContent = '';
    for (const [k, label, icon] of [
      ['kills', 'Kills', 'skull'],
      ['nights', 'Nights', 'moon'],
      ['escapes', 'Escapes', 'car'],
      ['revives', 'Revives', 'cross'],
    ]) {
      const t = el('div', 'ac-tile', this.heads);
      const h = el('span', 'ac-tile-l', t);
      svgEl('i', 'ac-tile-ico', h, glyph(icon));
      el('span', '', h, label);
      el('b', '', t, num(v.stats[k]));
    }

    this.recent.textContent = '';
    const latest = ACHIEVEMENTS.filter((x) => v.unlocked[x.id]).sort((x, y) => v.unlocked[y.id] - v.unlocked[x.id]).slice(0, 3);
    if (!latest.length) el('div', 'gb-empty fr-empty', this.recent, this.friend ? 'Nothing unlocked yet.' : 'Nothing unlocked yet: play a game and they start coming.');
    for (const x of latest) {
      const r = el('div', `ach-mini tier-${x.tier}`, this.recent);
      svgEl('i', 'ach-mini-ico', r, achIcon(x.icon));
      const w = el('div', 'ach-mini-t', r);
      el('b', '', w, x.name);
      el('small', '', w, when(v.unlocked[x.id]));
    }
  }

  renderGroups(v) {
    this.groups.textContent = '';
    for (const [g, title] of ACH_GROUPS) {
      const list = ACHIEVEMENTS.filter((x) => x.group === g);
      const got = list.filter((x) => v.unlocked[x.id]).length;
      const sec = el('section', 'ach-group', this.groups);
      const h = el('div', 'fr-h ach-group-h', sec);
      el('span', '', h, title);
      el('span', 'ach-group-n', h, `${got} / ${list.length}`);
      const grid = el('div', 'ach-grid', sec);
      for (const x of list) this.achCard(grid, x, v);
    }
  }

  achCard(parent, a, v) {
    const at = v.unlocked[a.id];
    const hidden = a.secret && !at;
    const c = el('div', `ach-card tier-${a.tier}${at ? ' got' : ' locked'}${hidden ? ' secret' : ''}`, parent);
    const ico = el('div', 'ach-card-ico', c);
    svgEl('i', '', ico, hidden ? glyph('question') : achIcon(a.icon));
    if (!at) svgEl('i', 'ach-lock', ico, glyph('lock'));
    const body = el('div', 'ach-card-b', c);
    const top = el('div', 'ach-card-top', body);
    el('b', 'ach-card-name', top, hidden ? '???' : a.name);
    el('span', `ach-card-tier tier-${a.tier}`, top, TIER_NAME[a.tier]);
    el('p', 'ach-card-desc', body, hidden ? 'A secret. It shows itself when you unlock it.' : a.desc);
    if (at) {
      const w = when(at);
      el('small', 'ach-card-when', body, w ? `Unlocked ${w}` : 'Unlocked');
      return;
    }
    const p = achProgress(a, v.stats);
    if (!p) return;
    const row = el('div', 'ach-prog', body);
    const bg = el('div', 'ach-bar-bg', row);
    el('i', 'ach-bar', bg).style.width = `${((p.have / p.goal) * 100).toFixed(1)}%`;
    el('small', '', row, `${amount(a, p.have)} / ${amount(a, p.goal)}`);
  }
}

// when it was unlocked, in a few words ('' for a time we do not know: one carried over from before times were kept)
function when(t) {
  if (!(t > 1)) return '';
  const s = (Date.now() - t) / 1000;
  return s < 86400 * 2 ? ago(t) : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
