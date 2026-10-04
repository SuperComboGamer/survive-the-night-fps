// Player list, up for as long as [Tab] is held: who is in the game - on their feet, down, dead or turned - with
// their level, their health, their kills and their ping, who is on the walkie-talkie, who is talking and who is your friend
// (by their account: friends.js). Nothing in it takes a click, so the pointer stays locked and the game goes on under it.
import { el, svgEl, clamp } from './dom.js';
import { glyph } from './icons.js';
import { healthTier } from './hud2.js';

export class Roster {
  constructor(ui, parent) {
    this.ui = ui;
    this.open = false;
    this.key = null;
    this.rows = [];

    this.root = el('div', 'rosterscr', parent);
    this.root.hidden = true;
    const frame = el('div', 'roster-frame paper', this.root);
    const head = el('div', 'map-head', frame);
    el('span', 'map-title', head, 'Survivors');
    this.count = el('span', 'map-coords', head, '');
    this.list = el('ul', 'sv-list', frame);
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
  }

  // list: [{id, name, status: 'alive' | 'downed' | 'dead' | 'zombie', hp (0..1, -1 = unknown), kills, ping, level,
  // talking, radio, self}]. Called often while the list is up: the rows are rebuilt only when something but health
  // changed, and a change of health moves just that row's bar.
  set(list) {
    list = Array.isArray(list) ? list : [];
    const friend = list.map((p) => !p.self && this.ui.isFriendId(p.id));
    const key = list.map((p, i) => [p.id, p.name, p.status, p.kills | 0, Math.round((p.ping || 0) / 5), p.talking ? 1 : 0, p.radio ? 1 : 0, p.self ? 1 : 0, friend[i] ? 1 : 0, p.level | 0].join('|')).join(';');
    if (key !== this.key) {
      this.key = key;
      this.list.textContent = '';
      this.rows = [];
      let alive = 0;
      let down = 0;
      for (const [i, p] of list.entries()) {
        const st = p.status || 'alive';
        if (st === 'alive' || st === 'downed') alive++; // as the HUD counts them: down is not dead yet
        if (st === 'downed') down++;
        const li = el('li', 'sv st-' + st + (p.self ? ' self' : '') + (p.talking ? ' talking' : ''), this.list);
        svgEl('i', 'sv-st', li, glyph(st === 'zombie' ? 'claw' : st === 'dead' ? 'skull' : st === 'downed' ? 'downed' : 'person'));
        el('span', 'sv-lv', li, String(p.level || 1)).title = `Level ${p.level || 1}`;
        const nm = el('span', 'sv-name', li, p.name || '???');
        if (p.self) el('small', 'sv-you', nm, 'you');
        if (friend[i]) svgEl('i', 'sv-friend', nm, glyph('star')).title = 'Your friend';
        el('span', 'sv-tag', li, st === 'alive' ? '' : st === 'downed' ? 'down' : st); // the state in a word
        const rd = svgEl('i', 'sv-radio', li, glyph('radio'));
        if (p.radio) {
          rd.classList.add('on');
          rd.title = 'On the walkie-talkie';
        }
        svgEl('i', 'sv-mic', li, glyph('mic'));
        const k = el('span', 'sv-kills', li);
        svgEl('i', '', k, glyph('skull'));
        el('b', '', k, String(p.kills | 0));
        el('span', 'sv-ping', li, p.ping != null ? Math.round(p.ping) + 'ms' : '');
        // health, for those who still have some: a bar along the foot of the row
        const row = { bar: null, fill: null, hp: null };
        if (st === 'alive') {
          row.bar = el('i', 'sv-hp', li);
          row.fill = el('i', '', row.bar);
        }
        this.rows.push(row);
      }
      const n = list.length;
      this.count.textContent = n ? `${n} in game · ${alive} alive` + (down ? ` (${down} down)` : '') : '';
    }
    for (let i = 0; i < list.length; i++) {
      const row = this.rows[i];
      if (!row.bar) continue;
      const hp = Math.round(clamp(list[i].hp ?? -1, -1, 1) * 100);
      if (row.hp === hp) continue;
      row.hp = hp;
      row.bar.hidden = hp < 0;
      if (hp < 0) continue;
      row.bar.className = 'sv-hp' + healthTier(hp / 100);
      row.bar.title = `${hp}% health`;
      row.fill.style.transform = `scaleX(${hp / 100})`;
    }
  }
}
