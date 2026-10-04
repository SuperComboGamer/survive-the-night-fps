// Your level and perks (shared/progress.js, client/net/progress.js): the Progress panel, opened from the splash and
// from the inventory screen - your level and how far to the next, the three perks on offer when a pick is waiting,
// the perks you have, and starting them over. Picking here is allowed between fights only in effect: a perk picked
// while a night is on comes into force at dawn (the server sees to it, Game.setProgress).
//
// Also the small pieces the rest of the UI shows it with: the level badge and the XP bar (xpBar).
import { el, svgEl } from './dom.js';
import { glyph } from './icons.js';
import { Panel } from './games.js';
import { PERK_BY_ID, PERK_GROUPS, LEVEL_CAP, levelInfo } from '../../shared/progress.js';
import { fetchProgress, pickPerk, respecPerks, onProgress, lastProgress } from '../net/progress.js';
import { accountState } from '../net/account.js';

const num = (n) => (n | 0).toLocaleString('en-US');
const GROUP_ICON = ['heart', 'headshot', 'search', 'cross', 'bolt', 'star'];

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

// one perk as a card: its group, name and what it does. button: the label of a button on it (a pick), or none
function perkCard(parent, id, button = '', onClick = null) {
  const p = PERK_BY_ID[id];
  if (!p) return null;
  const card = el('div', 'pk-card' + (p.keystone ? ' key' : ''), parent);
  const g = el('div', 'pk-group', card);
  svgEl('i', 'pk-ico', g, glyph(GROUP_ICON[p.group] || 'star'));
  el('span', '', g, PERK_GROUPS[p.group]);
  el('div', 'pk-name', card, p.name);
  el('div', 'pk-text', card, p.text);
  if (button) {
    const b = el('button', 'btn btn-blood pk-pick', card, button);
    b.type = 'button';
    b.addEventListener('click', () => onClick?.(id, b));
  }
  return card;
}

export class ProgressPanel extends Panel {
  constructor(ui, parent) {
    super(ui, parent, 'pg-panel', 'Progress');
    this.view = null;
    this.err = '';
    this.busy = false;
    this.confirmT = 0; // when "Start over" was pressed once: a second press inside 4 s does it

    this.bar = xpBar(this.body, 'pg-xpb');
    this.note = el('p', 'ac-note pg-note', this.body, '');
    this.pickH = el('div', 'fr-h', this.body, 'Pick a perk');
    this.offer = el('div', 'pk-row', this.body);
    this.mineH = el('div', 'fr-h', this.body, 'Your perks');
    this.mine = el('div', 'pk-grid', this.body);
    this.empty = el('div', 'gb-empty pg-empty', this.body);
    this.emptyT = el('p', '', this.empty, '');
    this.emptySub = el('p', 'gb-empty-sub', this.empty, '');

    this.respec = el('button', 'btn btn-ghost btn-danger', this.foot);
    this.respec.type = 'button';
    this.respecT = el('span', '', this.respec, 'Start over');
    this.respec.title = 'Undo every pick and choose again, from new offers';
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

  async _pick(id, btn) {
    if (this.busy) return;
    this.busy = true;
    btn.disabled = true;
    try {
      await pickPerk(id);
      this.ui.sound('ui_click');
      const p = PERK_BY_ID[id];
      this.ui.notify?.(`Perk: ${p.name}`, 'toast', 3);
    } catch (err) {
      this.err = err.message || 'That did not go through';
      await this.refresh();
    }
    this.busy = false;
    this.render();
  }

  async _respec() {
    if (this.busy || !this.view?.perks.length) return;
    const now = performance.now();
    if (now - this.confirmT > 4000) {
      this.confirmT = now;
      this.respecT.textContent = 'Undo every pick?';
      setTimeout(() => {
        if (performance.now() - this.confirmT >= 4000) this.respecT.textContent = 'Start over';
      }, 4100);
      return;
    }
    this.confirmT = 0;
    this.respecT.textContent = 'Start over';
    this.busy = true;
    try {
      await respecPerks();
    } catch (err) {
      this.err = err.message || 'That did not go through';
    }
    this.busy = false;
    this.render();
  }

  render() {
    const v = this.view;
    this.empty.hidden = !!v;
    this.bar.root.hidden = !v;
    if (!v) {
      this.sub.textContent = '';
      this.note.hidden = this.pickH.hidden = this.offer.hidden = this.mineH.hidden = this.mine.hidden = true;
      this.respec.hidden = true;
      this.emptyT.textContent = this.err || 'Asking the server…';
      this.emptySub.textContent = this.err ? 'Your XP is kept on the server: it needs to be reachable to pick perks.' : '';
      return;
    }
    this.bar.set(v.xp);
    this.sub.textContent = `Level ${v.level}${v.level >= LEVEL_CAP ? ' · top' : ''}`;
    const signedIn = !!accountState().user;
    const lines = [];
    if (this.err) lines.push(this.err);
    if (v.pending) lines.push(`${v.pending === 1 ? 'A perk is' : `${v.pending} perks are`} waiting to be picked. A perk picked during a night comes into force at dawn.`);
    else if (v.nextPick) lines.push(`Your next perk comes at level ${v.nextPick}.`);
    else lines.push('Every perk pick is made.');
    if (!signedIn) lines.push("As a guest your progress is kept for this browser, and moves onto your account when you sign in.");
    this.note.textContent = lines.join(' ');
    this.note.hidden = false;
    this.note.classList.toggle('bad', !!this.err);

    this.pickH.hidden = this.offer.hidden = !v.pending;
    this.offer.textContent = '';
    for (const id of v.offer) perkCard(this.offer, id, 'Pick', (pid, b) => this._pick(pid, b));

    this.mineH.hidden = false;
    this.mine.hidden = false;
    this.mine.textContent = '';
    for (const id of v.perks) perkCard(this.mine, id);
    if (!v.perks.length) el('p', 'pg-none', this.mine, v.picks ? 'None picked yet.' : `You pick your first perk at level 2: earn XP by killing the dead, reviving teammates and seeing the night through.`);
    this.respec.hidden = !v.perks.length;
    this.respec.disabled = this.busy;
  }
}
