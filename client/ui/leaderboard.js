// Leaderboard overlay [L]: what the server has on record for every player over all the games they have played
// (server/stats.js) - the dead they put down, the nights they saw through, the runs they won, the teammates they
// revived - with your own row picked out. Two lists: the best of everyone on record, and the players in this
// game. A click on a column sorts by it. The game asks the server for the board while this is open and hands
// each answer to set().
import { BOARD_STATS, BOARD_TOP } from '../../shared/protocol.js';
import { el, svgEl, lsGet, lsSet } from './dom.js';
import { glyph } from './icons.js';
import { bindLabel, liveText } from '../game/binds.js';

const STORE = 'stn.board'; // 'all:kills': the list and the column last looked at
// per stat: column head, its glyph, what it counts
const COLS = {
  kills: ['Kills', 'skull', 'The dead you put down: zombies and turned players'],
  nights: ['Nights', 'moon', 'Nights you were still alive at the end of'],
  wins: ['Wins', 'car', 'Runs your team escaped from'],
  revives: ['Revives', 'cross', 'Teammates you got back on their feet'],
};
const LISTS = [
  ['all', 'All time'],
  ['here', 'This game'],
];
const num = (n) => n.toLocaleString('en-US');

export class Leaderboard {
  constructor(ui, parent) {
    this.ui = ui;
    this.open = false;
    this.data = null; // { total, rows } as last sent (shared/protocol.js readBoard)
    const [list, sort] = lsGet(STORE, '').split(':');
    this.list = LISTS.some(([id]) => id === list) ? list : 'all';
    this.sort = BOARD_STATS.includes(sort) ? sort : BOARD_STATS[0];
    this.key = '';

    this.root = el('div', 'lbscr', parent);
    this.root.hidden = true;
    const bg = el('div', 'map-bg', this.root);
    const frame = el('div', 'lb-frame paper', this.root);
    const head = el('div', 'map-head', frame);
    el('span', 'map-title', head, 'Leaderboard');
    this.count = el('span', 'map-coords', head, '');
    // the cross, or a left press outside the frame, closes it: the game sets onClose
    this.onClose = null;
    const close = svgEl('button', 'set-close btn-icon map-close', head, glyph('xmark'));
    close.type = 'button';
    close.title = 'Close (L)';
    close.addEventListener('click', () => this.onClose?.());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && (e.target === bg || e.target === this.root)) this.onClose?.();
    });

    const seg = el('div', 'set-seg lb-lists', frame);
    this.listBtns = LISTS.map(([id, label]) => {
      const b = el('button', 'seg-btn', seg, label);
      b.type = 'button';
      b.addEventListener('click', () => this._choose(id, this.sort));
      return b;
    });

    const table = el('div', 'lb-table', frame);
    const hd = el('div', 'lb-row lb-hd', table);
    el('span', 'lb-rank', hd, '#');
    el('span', 'lb-name', hd, 'Player');
    this.sortBtns = BOARD_STATS.map((k) => {
      const [label, ico, what] = COLS[k];
      const b = el('button', 'lb-col', hd);
      b.type = 'button';
      b.title = what;
      svgEl('i', 'lb-ico', b, glyph(ico));
      el('span', '', b, label);
      b.addEventListener('click', () => this._choose(this.list, k));
      return b;
    });
    this.body = el('div', 'lb-body', table);
    this.note = el('div', 'lb-note', table, '');
    // your own row, under the list, when the list does not reach down to it
    this.mine = el('div', 'lb-mine', table);

    const keys = el('div', 'map-keys', frame);
    for (const [k, t] of [
      [() => bindLabel('board'), 'close'], // (its keybind: game/binds.js)
      ['LMB', 'sort by a column'],
    ]) {
      const s = el('span', 'gh', keys);
      if (typeof k === 'function') liveText(el('span', 'kbd sm', s), k);
      else el('span', 'kbd sm', s, k);
      el('span', '', s, t);
    }
    this._render();
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
    this.ui.root.classList.toggle('board-open', open);
  }

  // data: { total, rows: [{ name, me, here, kills, nights, wins, revives, ranks | null }] }, null: none yet
  set(data) {
    this.data = data || null;
    this._render();
  }

  _choose(list, sort) {
    this.list = list;
    this.sort = sort;
    lsSet(STORE, `${list}:${sort}`);
    this._render();
  }

  _row(parent, rank, row) {
    const r = el('div', 'lb-row' + (row.me ? ' me' : ''), parent);
    el('span', 'lb-rank', r, rank ? String(rank) : '–');
    const name = el('span', 'lb-name', r);
    el('span', 'lb-nm', name, row.name);
    if (row.me) el('span', 'lb-tag', name, 'you');
    else if (row.here && this.list === 'all') el('span', 'lb-tag here', name, 'in this game');
    for (const k of BOARD_STATS) el('span', 'lb-val' + (k === this.sort ? ' on' : ''), r, num(row[k]));
  }

  _render() {
    const d = this.data;
    const k = this.sort;
    // (set() comes every few seconds while the board is open: the rows are only rebuilt when something on them moved)
    const key = JSON.stringify([this.list, k, d]);
    if (key === this.key) return;
    this.key = key;
    this.listBtns.forEach((b, i) => b.classList.toggle('on', LISTS[i][0] === this.list));
    this.sortBtns.forEach((b, i) => b.classList.toggle('on', BOARD_STATS[i] === k));
    this.body.textContent = '';
    this.mine.textContent = '';
    this.mine.hidden = true;
    this.count.textContent = d ? `${num(d.total)} ${d.total === 1 ? 'player' : 'players'} on record` : '';
    if (!d) {
      this.note.textContent = 'Asking the server…';
      this.note.hidden = false;
      return;
    }
    const all = this.list === 'all';
    const me = d.rows.find((r) => r.me) || null;
    // everyone on record: the best BOARD_TOP with anything in this column. This game: whoever is in it
    const rows = d.rows
      .filter((r) => (all ? r[k] > 0 : r.here))
      .sort((a, b) => b[k] - a[k] || a.name.localeCompare(b.name))
      .slice(0, all ? BOARD_TOP : undefined);
    // equal scores share a place, as in the place the server gives us for our own row
    let rank = 0;
    rows.forEach((row, i) => {
      if (!i || row[k] !== rows[i - 1][k]) rank = i + 1;
      this._row(this.body, rank, row);
    });
    this.note.hidden = rows.length > 0;
    if (!rows.length) this.note.textContent = all ? `Nobody has any ${COLS[k][0].toLowerCase()} on record yet.` : 'Nobody in this game is on the board.';
    if (all && me && !rows.includes(me)) {
      this.mine.hidden = false;
      this._row(this.mine, me.ranks[BOARD_STATS.indexOf(k)], me);
    }
  }
}
