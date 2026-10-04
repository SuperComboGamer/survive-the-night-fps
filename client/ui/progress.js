// Your level and perks (shared/progress.js, client/net/progress.js): the Perks panel, opened from the splash, the pause
// menu and the inventory screen - your level and how far to the next, how many of your perk points are spent, and the
// whole perk tree (perktree.js) to spend them on, take one back, or start over. A perk taken while a night is on comes
// into force at dawn (the server sees to it, Game.setProgress).
//
// Also the small pieces the rest of the UI shows it with: the level badge and the XP bar (xpBar).
import { el } from './dom.js';
import { Panel } from './games.js';
import { PerkTree } from './perktree.js';
import { PERK_BY_ID, LEVEL_CAP, levelInfo } from '../../shared/progress.js';
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

    const top = (this.top = el('div', 'pg-top', this.body));
    this.bar = xpBar(top, 'pg-xpb');
    const pts = el('div', 'pg-pts', top);
    this.ptsN = el('div', 'pg-pts-n', pts, '');
    this.pips = pips(pts);
    this.note = el('p', 'ac-note pg-note', this.body, '');
    this.tree = new PerkTree(this.body, { onPick: (id) => this._pick(id), onUnpick: (id) => this._unpick(id) });
    this.empty = el('div', 'gb-empty pg-empty', this.body);
    this.emptyT = el('p', '', this.empty, '');
    this.emptySub = el('p', 'gb-empty-sub', this.empty, '');

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
    try {
      await fn();
      done?.();
    } catch (err) {
      this.err = err.message || 'That did not go through';
      await this.refresh();
    }
    this.busy = false;
    this.tree.setBusy(false);
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

  render() {
    const v = this.view;
    this.empty.hidden = !!v;
    this.top.hidden = this.tree.root.hidden = !v;
    if (!v) {
      this.sub.textContent = '';
      this.note.hidden = true;
      this.respec.hidden = true;
      this.emptyT.textContent = this.err || 'Asking the server…';
      this.emptySub.textContent = this.err ? 'Your XP is kept on the server: it needs to be reachable to spend perk points.' : '';
      return;
    }
    this.bar.set(v.xp);
    this.sub.textContent = `Level ${v.level}${v.level >= LEVEL_CAP ? ' · top' : ''}`;
    this.ptsN.textContent = `${v.perks.length} of ${v.points} points spent` + (v.pending ? ` · ${v.pending} to spend` : v.nextPick ? ` · next at level ${v.nextPick}` : '');
    this.ptsN.classList.toggle('lit', !!v.pending);
    this.pips.set(v);
    const lines = [];
    if (this.err) lines.push(this.err);
    if (v.pending) lines.push(`${v.pending === 1 ? 'A point is' : `${v.pending} points are`} waiting: click a bright perk, then spend it. One taken during a night comes into force at dawn.`);
    else if (!v.picks) lines.push('Your first perk point comes at level 2: earn XP by killing the dead, reviving teammates and seeing the night through.');
    if (!accountState().user) lines.push('As a guest your progress is kept for this browser, and moves onto your account when you sign in.');
    this.note.textContent = lines.join(' ');
    this.note.hidden = !lines.length;
    this.note.classList.toggle('bad', !!this.err);
    this.tree.set(v.perks, v.level);
    this.respec.hidden = !v.perks.length;
    this.respec.disabled = this.busy;
  }
}
