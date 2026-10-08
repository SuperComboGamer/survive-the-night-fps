// Your level and perks (shared/progress.js, client/net/progress.js): the Perks panel, opened from the splash, the pause
// menu and the inventory screen - your level and how far to the next, how many of your perk points are spent, and the
// whole perk tree (perktree.js) to spend them on, take one back, or start over. Opened with a point waiting it shows
// the quick pick first (perkpick.js): only what the point can buy now. A perk taken while a night is on comes into
// force at dawn (the server sees to it, Game.setProgress).
//
// Also the small pieces the rest of the UI shows it with: the level badge and the XP bar (xpBar).
import { el } from './dom.js';
import { Panel } from './games.js';
import { PerkTree } from './perktree.js';
import { PerkPick } from './perkpick.js';
import { PERK_BY_ID, LEVEL_CAP, levelInfo } from '../../shared/progress.js';
import './ux-perks.css';
import { fetchProgress, pickPerk, unpickPerk, respecPerks, onProgress, lastProgress } from '../net/progress.js';
import { accountState } from '../net/account.js';

const num = (n) => (n | 0).toLocaleString('en-US');

// A level badge and a bar to the next level, kept up to date with set(xp)
export function xpBar(parent, cls = '') {
  const root = el('div', 'xpb ' + cls, parent);
  const lv = el('span', 'xpb-lv', root);
  el('small', '', lv, 'LV');
  const n = el('b', '', lv, '1');
  const right = el('div', 'xpb-r', root);
  const bar = el('div', 'xpb-bar', right);
  const fill = el('i', '', bar);
  const txt = el('span', 'xpb-t', right, '');
  return {
    root,
    set(xp) {
      const i = levelInfo(xp);
      n.textContent = String(i.level);
      fill.style.transform = `scaleX(${i.frac})`;
      txt.textContent = i.need ? `${num(i.into)} / ${num(i.need)} XP to level ${i.level + 1}` : `${num(xp)} XP · top level`;
      return i;
    },
  };
}

// perk points as pips: spent, to spend, still to earn
function pips(parent) {
  const root = el('div', 'pg-pips', parent);
  return {
    root,
    set(v) {
      root.textContent = '';
      for (let i = 0; i < v.points; i++) el('i', i < v.perks.length ? 'spent' : i < v.picks ? 'free' : '', root);
    },
  };
}

export class ProgressPanel extends Panel {
  constructor(ui, parent) {
    super(ui, parent, 'pg-panel', 'Perks');
    this.view = null;
    this.err = '';
    this.busy = false;
    this.confirmT = 0; // when "Start over" was pressed once: a second press inside 4 s does it

    this.mode = 'tree'; // 'quick' (a point waiting: what it can buy now) or 'tree'
    this.fresh = false; // just opened: the first view of the record picks the mode
    this.root.classList.add('prk-panel');
    // in the head, beside the title: the level and the bar to the next, and the points (a button to the quick pick)
    const head = this.card.querySelector('.set-head');
    const top = (this.top = el('div', 'pg-top'));
    head.insertBefore(top, head.querySelector('.set-close'));
    this.bar = xpBar(top, 'pg-xpb');
    const pts = (this.pts = el('button', 'pg-pts', top));
    pts.type = 'button';
    pts.addEventListener('click', () => this.view?.pending && this.setMode('quick'));
    this.ptsBig = el('b', 'pg-pts-big', pts, '');
    const ptsR = el('span', 'pg-pts-r', pts);
    this.ptsH = el('span', 'pg-pts-h', ptsR, '');
    this.pips = pips(ptsR);
    this.ptsN = el('span', 'pg-pts-n', ptsR, '');
    this.note = el('p', 'ac-note pg-note', this.body, '');
    const act = { onPick: (id) => this._pick(id), onUnpick: (id) => this._unpick(id) };
    this.quick = new PerkPick(this.body, { ...act, onTree: () => this.setMode('tree') });
    this.tree = new PerkTree(this.body, act);
    this.foot.prepend(this.tree.bar, this.quick.take);
    this.empty = el('div', 'gb-empty pg-empty', this.body);
    this.emptyT = el('p', '', this.empty, '');
    this.emptySub = el('p', 'gb-empty-sub', this.empty, '');
    this.guest = el('p', 'ac-note pg-note prk-guest', this.body, 'As a guest your progress is kept for this browser, and moves onto your account when you sign in.');

    this.respec = el('button', 'btn btn-ghost btn-danger', this.foot);
    this.respec.type = 'button';
    this.respecT = el('span', '', this.respec, 'Start over');
    this.respec.title = 'Every point back, to spend again';
    this.respec.addEventListener('click', () => this._respec());
    el('span', 'gb-gap', this.foot);
    const close = el('button', 'btn btn-ghost', this.foot, 'Close');
    close.type = 'button';
    close.addEventListener('click', () => this.hide());

    onProgress((v) => {
      this.view = v;
      this.err = '';
      if (this.visible) this.render();
    });
  }

  show() {
    super.show();
    this.fresh = true;
    this.view = lastProgress();
    this.render();
    this.refresh();
  }

  async refresh() {
    try {
      await fetchProgress();
    } catch (err) {
      this.err = err.message || 'Could not reach the server';
      this.render();
    }
  }

  async _act(fn, done) {
    if (this.busy) return;
    this.busy = true;
    this.tree.setBusy(true);
    this.quick.setBusy(true);
    try {
      await fn();
      done?.();
    } catch (err) {
      this.err = err.message || 'That did not go through';
      await this.refresh();
    }
    this.busy = false;
    this.tree.setBusy(false);
    this.quick.setBusy(false);
    this.render();
  }

  _pick(id) {
    this._act(
      () => pickPerk(id),
      () => {
        this.ui.sound('ui_click');
        this.ui.notify?.(`Perk: ${PERK_BY_ID[id].name}`, 'toast', 3);
      }
    );
  }

  _unpick(id) {
    this._act(() => unpickPerk(id));
  }

  async _respec() {
    if (this.busy || !this.view?.perks.length) return;
    const now = performance.now();
    if (now - this.confirmT > 4000) {
      this.confirmT = now;
      this.respecT.textContent = 'Every point back?';
      setTimeout(() => {
        if (performance.now() - this.confirmT >= 4000) this.respecT.textContent = 'Start over';
      }, 4100);
      return;
    }
    this.confirmT = 0;
    this.respecT.textContent = 'Start over';
    this._act(() => respecPerks());
  }

  setMode(mode) {
    this.mode = mode;
    this.render();
  }

  render() {
    const v = this.view;
    if (v && this.fresh) {
      this.fresh = false;
      this.mode = v.pending ? 'quick' : 'tree';
    }
    if (v && !v.pending) this.mode = 'tree'; // (the last point spent from the quick pick: on to the tree)
    const quick = !!v && this.mode === 'quick';
    this.root.classList.toggle('prk-quick', quick);
    this.empty.hidden = !!v;
    this.top.hidden = !v;
    this.tree.root.hidden = this.tree.bar.hidden = !v || quick;
    this.quick.root.hidden = this.quick.take.hidden = !quick;
    if (!v) {
      this.guest.hidden = true;
      this.sub.textContent = '';
      this.note.hidden = true;
      this.respec.hidden = true;
      this.emptyT.textContent = this.err || 'Asking the server…';
      this.emptySub.textContent = this.err ? 'Your XP is kept on the server: it needs to be reachable to spend perk points.' : '';
      return;
    }
    this.bar.set(v.xp);
    this.sub.textContent = v.level >= LEVEL_CAP ? 'Top level' : '';
    this.ptsBig.textContent = v.pending ? String(v.pending) : '';
    this.ptsH.textContent = v.pending ? `point${v.pending === 1 ? '' : 's'} to spend` : `${v.perks.length} of ${v.points} spent`;
    this.ptsN.textContent = (v.pending ? `${v.perks.length} of ${v.points} spent` : '') + (v.nextPick ? `${v.pending ? ' · ' : ''}next at level ${v.nextPick}` : v.pending ? '' : 'every point earned');
    this.pts.classList.toggle('lit', !!v.pending);
    this.pts.disabled = !v.pending || quick;
    this.pts.title = v.pending && !quick ? 'Quick pick: just what a point buys now' : '';
    this.pips.set(v);
    const lines = [];
    if (this.err) lines.push(this.err);
    if (!v.picks) lines.push('Your first perk point comes at level 2: earn XP by killing the dead, reviving teammates and seeing the night through.');
    this.guest.hidden = !!accountState().user;
    this.note.textContent = lines.join(' ');
    this.note.hidden = !lines.length;
    this.note.classList.toggle('bad', !!this.err);
    if (quick) this.quick.set(v.perks, v.level);
    else this.tree.set(v.perks, v.level);
    this.respec.hidden = !v.perks.length;
    this.respec.disabled = this.busy;
  }
}
