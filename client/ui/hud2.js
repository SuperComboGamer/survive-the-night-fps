// Iteration 2 HUD pieces: compass strip, objective tracker ("field notes"), world markers (teammate
// nameplates, pings, the car), downed overlay, damage direction arrows and the dawn summary card.
// Same conventions as hud.js: update() is called every frame and only touches the DOM on change.
import { ITEM_DEFS, SUPPLIES, SUPPLY_NEED, ZONE_NAMES, ITEM } from '../../shared/defs.js';
import { PHASE, DUSK_WARNING } from '../../shared/constants.js';
import { el, svgEl, fmtTime, clamp } from './dom.js';
import { itemIcon, glyph } from './icons.js';

const TAU = Math.PI * 2;
const wrapA = (a) => ((a % TAU) + TAU + Math.PI) % TAU - Math.PI;
const CARDINALS = [
  [0, 'N'],
  [Math.PI / 4, 'NE'],
  [Math.PI / 2, 'E'],
  [(3 * Math.PI) / 4, 'SE'],
  [Math.PI, 'S'],
  [(-3 * Math.PI) / 4, 'SW'],
  [-Math.PI / 2, 'W'],
  [-Math.PI / 4, 'NW'],
];
const PING_LABEL = ['Go here', 'Danger', 'Loot'];

// world bearing of (dx,dz): 0 = north (-Z), +90 deg = east (+X)
export const bearing = (dx, dz) => Math.atan2(dx, -dz);

// ---------------------------------------------------------------- compass
export class Compass {
  constructor(parent) {
    this.root = el('div', 'compass', parent);
    this.strip = el('div', 'cmp-strip', this.root);
    this.ticks = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const card = CARDINALS.find(([c]) => Math.abs(wrapA(c - a)) < 0.01);
      const t = el('i', 'cmp-tick' + (card ? (card[1].length === 1 ? ' major' : ' minor') : ''), this.strip);
      if (card) el('b', '', t, card[1]);
      this.ticks.push({ a, e: t });
    }
    el('i', 'cmp-center', this.root);
    this.pool = [];
    this.halfFov = 1.35; // radians shown on each side
    // strip width, kept current by a ResizeObserver: reading clientWidth every frame, after the HUD's
    // style writes, forced a synchronous style + layout pass per frame
    this.width = 0;
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => (this.width = this.root.clientWidth)).observe(this.root);
  }

  // transforms are only rewritten when they change (standing still / not turning costs no style work)
  _moveTo(o, x) {
    const tx = `translateX(${x.toFixed(1)}px)`;
    if (o.tx !== tx) o.e.style.transform = o.tx = tx;
  }

  _marker(i) {
    let m = this.pool[i];
    if (!m) {
      const e = el('div', 'cmp-mk', this.root);
      const ico = el('i', 'cmp-mk-ico', e);
      const lab = el('span', 'cmp-mk-lab', e);
      m = { e, ico, lab, key: '', lkey: '', cls: '' };
      this.pool[i] = m;
    }
    return m;
  }

  // yaw: camera yaw (0 = facing -Z/north, positive = turning left/west). markers: [{bearing, kind, icon, label, cls}]
  update(yaw, markers) {
    const heading = -yaw; // clockwise from north
    if (!this.width) this.width = this.root.clientWidth;
    const W = this.width || 520;
    const toX = (a) => {
      const d = wrapA(a - heading);
      if (Math.abs(d) > this.halfFov) return null;
      return W / 2 + (d / this.halfFov) * (W / 2);
    };
    for (const t of this.ticks) {
      const x = toX(t.a);
      if (x === null) {
        if (!t.hidden) {
          t.e.style.visibility = 'hidden';
          t.hidden = true;
        }
        continue;
      }
      if (t.hidden) {
        t.e.style.visibility = '';
        t.hidden = false;
      }
      this._moveTo(t, x);
    }
    let n = 0;
    for (const mk of markers) {
      let x = toX(mk.bearing);
      const edge = x === null;
      if (edge) {
        if (!mk.pinEdge) continue;
        x = wrapA(mk.bearing - heading) > 0 ? W - 6 : 6;
      }
      const m = this._marker(n++);
      const cls = 'cmp-mk k-' + mk.kind + (mk.cls ? ' ' + mk.cls : '') + (edge ? ' edge' : '');
      if (m.cls !== cls) m.e.className = m.cls = cls;
      if (m.key !== mk.icon) m.ico.innerHTML = m.key = mk.icon;
      const lab = mk.label || '';
      if (m.lkey !== lab) m.lab.textContent = m.lkey = lab;
      this._moveTo(m, x);
      if (m.e.hidden) m.e.hidden = false;
    }
    for (let i = n; i < this.pool.length; i++) if (!this.pool[i].e.hidden) this.pool[i].e.hidden = true;
  }
}

// ---------------------------------------------------------------- objective tracker
export class Objective {
  constructor(parent) {
    this.root = el('div', 'obj', parent);
    const head = el('div', 'obj-head', this.root);
    this.hIco = svgEl('i', 'obj-hico', head, glyph('car'));
    this.hTitle = el('span', 'obj-title', head, 'Escape');
    this.hCount = el('span', 'obj-count', head, '');
    this.directive = el('div', 'obj-dir', this.root, '');
    this.list = el('div', 'obj-list', this.root);
    this.rows = SUPPLIES.map((item, i) => {
      const r = el('div', 'obj-row', this.list);
      svgEl('i', 'obj-ico', r, itemIcon(item));
      const name = el('span', 'obj-name', r, ITEM_DEFS[item].name + (SUPPLY_NEED[i] > 1 ? 's' : ''));
      const where = el('span', 'obj-where', r, '');
      const st = el('span', 'obj-st', r, '');
      return { r, name, where, st, key: '' };
    });
    this.key = '';
  }

  update(o) {
    if (!o) return;
    const key = JSON.stringify(o);
    if (key === this.key) return;
    this.key = key;
    let done = 0;
    let total = 0;
    SUPPLIES.forEach((item, i) => {
      const need = SUPPLY_NEED[i];
      const have = o.supplies[i] | 0;
      total += need;
      done += Math.min(need, have);
      const row = this.rows[i];
      const carried = o.carried[item] | 0;
      const complete = have >= need;
      let where;
      if (complete) where = 'installed';
      else if (carried) where = 'carrying · bring it to the car';
      else if (i < 4) where = o.hints[i] === 255 ? 'somewhere out there' : 'rumoured: ' + ZONE_NAMES[o.hints[i]];
      else {
        const zs = o.hints.slice(4).filter((z) => z !== 255);
        where = zs.length ? zs.map((z) => ZONE_NAMES[z]).join(' · ') : 'somewhere out there';
      }
      const st = need > 1 ? `${have}/${need}` : complete ? '' : carried ? '!' : '';
      const k = where + '|' + st + '|' + complete + '|' + !!carried;
      if (row.key === k) return;
      row.key = k;
      row.where.textContent = where;
      row.st.textContent = st;
      row.r.classList.toggle('done', complete);
      row.r.classList.toggle('carried', !!carried && !complete);
    });
    this.hCount.textContent = `${done}/${total}`;
    // what to do right now
    let dir = '';
    let tone = '';
    if (o.finale) {
      if (o.escapeReady) {
        dir = 'The engine is running - get to the car!';
        tone = 'good';
      } else {
        dir = `Defend the car · engine ready in ${fmtTime(o.escapeT)}`;
        tone = 'danger';
      }
    } else if (o.suppliesDone) {
      dir = 'Every supply is in. Hold [E] at the car to start the engine - then survive the final stand.';
      tone = 'good';
    } else if (o.phase === PHASE.NIGHT) {
      dir = `Survive the night · wave ${o.wave}/${o.waves}`;
      tone = 'night';
    } else if (o.phase === PHASE.DAY && o.timeLeft <= DUSK_WARNING) {
      dir = `Nightfall in ${fmtTime(o.timeLeft)} - build a shelter where you stand`;
      tone = 'danger';
    } else if (o.anyCarried) {
      dir = 'Bring the supplies you carry back to the car';
      tone = 'good';
    } else if (o.phase === PHASE.DAY) {
      dir = 'Scavenge and find the car supplies before dark';
    }
    this.directive.textContent = dir;
    this.directive.className = 'obj-dir' + (tone ? ' t-' + tone : '');
    this.directive.hidden = !dir;
    this.root.classList.toggle('compact', o.phase === PHASE.NIGHT || o.finale);
  }
}

// ---------------------------------------------------------------- world markers (DOM, projected each frame)
export class Markers {
  constructor(parent) {
    this.root = el('div', 'wmk-layer', parent);
    this.pool = [];
  }
  _get(i) {
    let m = this.pool[i];
    if (!m) {
      const e = el('div', 'wmk', this.root);
      const ico = el('i', 'wmk-ico', e);
      const txt = el('div', 'wmk-txt', e);
      const name = el('b', 'wmk-name', txt);
      const sub = el('span', 'wmk-sub', txt);
      const bar = el('i', 'wmk-bar', e);
      const fill = el('i', '', bar);
      m = { e, ico, name, sub, bar, fill, k: {} };
      this.pool[i] = m;
    }
    return m;
  }
  // list: [{kind, x, y (screen px), icon, name, sub, bar (0..1 or -1), cls, scale}]
  update(list) {
    let n = 0;
    for (const it of list) {
      const m = this._get(n++);
      const k = m.k;
      const cls = 'wmk k-' + it.kind + (it.cls ? ' ' + it.cls : '');
      if (k.cls !== cls) m.e.className = k.cls = cls;
      if (k.icon !== it.icon) m.ico.innerHTML = k.icon = it.icon || '';
      if (k.name !== it.name) m.name.textContent = k.name = it.name || '';
      if (k.sub !== it.sub) m.sub.textContent = k.sub = it.sub || '';
      const bar = it.bar ?? -1;
      if (k.bar !== bar) {
        k.bar = bar;
        m.bar.hidden = bar < 0;
        if (bar >= 0) m.fill.style.transform = `scaleX(${clamp(bar, 0, 1).toFixed(3)})`;
      }
      const tf = `translate(${it.x.toFixed(1)}px,${it.y.toFixed(1)}px) translate(-50%,-100%) scale(${(it.scale ?? 1).toFixed(2)})`;
      if (k.tf !== tf) m.e.style.transform = k.tf = tf;
      if (m.e.hidden) m.e.hidden = false;
    }
    for (let i = n; i < this.pool.length; i++) if (!this.pool[i].e.hidden) this.pool[i].e.hidden = true;
  }
}

// ---------------------------------------------------------------- downed overlay
export class Downed {
  constructor(parent) {
    this.root = el('div', 'dn-overlay', parent);
    this.root.hidden = true;
    el('div', 'dn-vig', this.root);
    const box = el('div', 'dn-box', this.root);
    svgEl('i', 'dn-ico', box, glyph('downed'));
    el('div', 'dn-title', box, "You're down");
    this.sub = el('div', 'dn-sub', box, '');
    const bar = el('div', 'dn-bar', box);
    this.fill = el('i', '', bar);
    this.time = el('div', 'dn-time', box, '');
    this.key = '';
  }
  update(d) {
    const show = !!d;
    if (this.root.hidden === show) this.root.hidden = !show;
    if (!d) return;
    const key = Math.ceil(d.bleed) + '|' + d.reviving + '|' + d.medkit;
    if (key === this.key) return;
    this.key = key;
    this.fill.style.transform = `scaleX(${clamp(d.bleed / 30, 0, 1).toFixed(3)})`;
    this.time.textContent = d.reviving ? 'Being revived…' : `Bleeding out · ${fmtTime(d.bleed)}`;
    this.sub.textContent = d.reviving ? 'Hold on. A teammate has you.' : d.medkit ? 'Use a medkit [H] to get back up, or wait for a teammate' : 'Crawl to cover. A teammate can revive you with [E]';
    this.root.classList.toggle('reviving', !!d.reviving);
  }
}

// ---------------------------------------------------------------- damage direction
export class DamageDir {
  constructor(parent) {
    this.root = el('div', 'dmgdir', parent);
    this.items = [];
    for (let i = 0; i < 4; i++) {
      const e = el('i', 'dd', this.root);
      this.items.push({ e, t: 0, a: 0 });
    }
    this.next = 0;
  }
  // angle: screen-relative (0 = in front / top, +pi/2 = right)
  hit(angle, amount) {
    const it = this.items[this.next++ % this.items.length];
    it.a = angle;
    it.e.style.setProperty('--a', angle.toFixed(3) + 'rad');
    it.e.getAnimations().forEach((x) => x.cancel());
    it.e.animate([{ opacity: clamp(0.45 + amount / 40, 0.5, 1) }, { opacity: 0 }], { duration: 900 + amount * 20, easing: 'ease-in' });
  }
}

// ---------------------------------------------------------------- dawn summary
export class Summary {
  constructor(parent) {
    this.root = el('div', 'summary paper', parent);
    this.root.hidden = true;
    this.title = el('div', 'sm-title', this.root, '');
    this.stats = el('div', 'sm-stats', this.root);
    this.next = el('div', 'sm-next', this.root, '');
  }
  show(s, nextText) {
    this.title.textContent = `Night ${s.night} survived`;
    this.stats.textContent = '';
    const stat = (label, v, cls = '') => {
      const d = el('div', 'sm-stat ' + cls, this.stats);
      el('b', '', d, String(v));
      el('span', '', d, label);
    };
    stat('kills', s.kills);
    stat('walls lost', s.structLost);
    stat('downed', s.downs, s.downs ? 'warn' : '');
    stat('revived', s.revives, s.revives ? 'good' : '');
    stat('lost', s.deaths, s.deaths ? 'bad' : '');
    this.next.textContent = nextText || '';
    this.root.hidden = false;
    this.root.classList.remove('out');
    this.root.getAnimations().forEach((a) => a.cancel());
    this.root.animate([{ opacity: 0, transform: 'translate(-50%, -12px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 450, easing: 'ease-out' });
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      const a = this.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700 });
      a.onfinish = () => (this.root.hidden = true);
    }, 9000);
  }
}

// what the next night brings (shown on the dawn card)
export function nextNightText(night) {
  const n = night;
  const adds = [];
  if (n === 2) adds.push('spitters', 'boomers', 'zombie dog packs', 'shades (they only move in the dark)');
  if (n === 3) adds.push('leapers', 'bats', 'a boss');
  if (n === 4) adds.push('ropers', 'tanks');
  if (n >= 5 && n % 3 === 0) adds.push('a boss');
  const more = n <= 1 ? 'The next horde will be bigger.' : `Horde ${n}: bigger and hungrier.`;
  return adds.length ? `${more} New: ${adds.join(', ')}.` : more;
}

export { PING_LABEL, ITEM };
