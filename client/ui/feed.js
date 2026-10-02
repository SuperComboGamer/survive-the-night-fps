// Killfeed (top-right), pickup toasts (right-middle), cinematic titles (centre) and toasts (bottom-centre).
import { ITEM_DEFS } from '../../shared/defs.js';
import { el, svgEl } from './dom.js';
import { itemIcon, glyph } from './icons.js';

// ---------------------------------------------------------------- killfeed
export class Killfeed {
  constructor(parent) {
    this.root = el('div', 'killfeed', parent);
  }

  add(e) {
    const row = el('div', 'kf-row');
    if (e.killerZombie) row.classList.add('kz');
    if (e.victimPlayer) row.classList.add('vp');
    if (e.killer) el('span', 'kf-k', row, e.killer);
    const w = el('span', 'kf-w', row);
    if (e.weaponItem) w.innerHTML = itemIcon(e.weaponItem);
    else w.innerHTML = glyph(e.killerZombie ? 'claw' : 'skull');
    if (e.headshot) svgEl('span', 'kf-hs', row, glyph('headshot'));
    el('span', 'kf-v', row, e.victim || '');
    this.root.appendChild(row);
    while (this.root.childElementCount > 5) this.root.firstElementChild.remove();
    setTimeout(() => {
      row.classList.add('out');
      setTimeout(() => row.remove(), 600);
    }, 6000);
  }

  clear() {
    this.root.textContent = '';
  }
}

// ---------------------------------------------------------------- pickups
export class Pickups {
  constructor(parent) {
    this.root = el('div', 'pickups', parent);
    this.live = new Map(); // itemId -> {row, n, t}
  }

  add(itemId, count) {
    const def = ITEM_DEFS[itemId];
    if (!def) return;
    count = count | 0 || 1;
    let e = this.live.get(itemId);
    if (e && e.row.isConnected && !e.row.classList.contains('out')) {
      e.n += count;
      e.cnt.textContent = '+' + e.n;
      e.row.getAnimations().forEach((a) => a.cancel());
      e.row.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
      clearTimeout(e.t);
    } else {
      const row = el('div', 'pk-row pk-' + def.cat);
      const cnt = el('span', 'pk-n', row, '+' + count);
      el('span', 'pk-name', row, def.name);
      svgEl('i', 'pk-ico', row, itemIcon(itemId));
      this.root.appendChild(row);
      while (this.root.childElementCount > 6) this.root.firstElementChild.remove();
      e = { row, cnt, n: count, t: 0 };
      this.live.set(itemId, e);
    }
    e.t = setTimeout(() => {
      e.row.classList.add('out');
      setTimeout(() => {
        e.row.remove();
        if (this.live.get(itemId) === e) this.live.delete(itemId);
      }, 500);
    }, 3200);
  }

  clear() {
    this.root.textContent = '';
    this.live.clear();
  }
}

// ---------------------------------------------------------------- cinematic titles + toasts
export class Notifier {
  constructor(parent) {
    // cinematic
    this.cine = el('div', 'cine', parent);
    this.cine.hidden = true;
    this.cineBrush = el('div', 'cine-brush', this.cine);
    this.cineTitle = el('div', 'cine-title', this.cine);
    this.cineSub = el('div', 'cine-sub', this.cine);
    this.queue = [];
    this.current = null;
    // toasts
    this.toasts = el('div', 'toasts', parent);
  }

  notify(text, style = 'toast', duration = 3) {
    text = String(text ?? '');
    const dur = Math.max(0.8, +duration || 3);
    if (style === 'big') {
      this.queue.push({ title: text, sub: '', dur, tone: toneFor(text) });
      this._pump();
    } else if (style === 'sub') {
      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.current;
      if (last && !last.sub) {
        last.sub = text;
        if (last === this.current) {
          this.cineSub.textContent = text;
          this.cineSub.classList.remove('in');
          void this.cineSub.offsetWidth;
          this.cineSub.classList.add('in');
          // make sure the subtitle gets some screen time
          const remain = last.end - performance.now();
          if (remain < dur * 1000 * 0.7) this._schedule(last, dur * 1000 * 0.7);
        }
      } else {
        this.queue.push({ title: '', sub: text, dur, tone: '' });
        this._pump();
      }
    } else {
      this.toast(text, style, dur);
    }
  }

  _pump() {
    if (this.current || !this.queue.length) return;
    const m = (this.current = this.queue.shift());
    this.cine.hidden = false;
    this.cine.className = 'cine' + (m.tone ? ' tone-' + m.tone : '') + (m.title ? '' : ' sub-only');
    this.cineTitle.textContent = m.title;
    this.cineTitle.style.setProperty('--n', Math.max(6, m.title.length));
    this.cineSub.textContent = m.sub;
    void this.cine.offsetWidth;
    this.cine.classList.add('in');
    this.cineSub.classList.toggle('in', !!m.sub);
    this._schedule(m, m.dur * 1000);
  }

  _schedule(m, ms) {
    clearTimeout(this._t1);
    clearTimeout(this._t2);
    m.end = performance.now() + ms;
    this._t1 = setTimeout(() => {
      this.cine.classList.remove('in');
      this.cine.classList.add('out');
      this._t2 = setTimeout(() => {
        this.cine.classList.remove('out');
        this.cine.hidden = true;
        this.current = null;
        this._pump();
      }, 700);
    }, ms);
  }

  toast(text, style, dur) {
    const t = el('div', 'toast t-' + (['warning', 'danger', 'good'].includes(style) ? style : 'info'));
    if (style === 'warning' || style === 'danger') svgEl('i', 't-ico', t, glyph('hazard'));
    else if (style === 'good') svgEl('i', 't-ico', t, glyph('check'));
    el('span', 't-txt', t, text);
    this.toasts.appendChild(t);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 450);
    }, dur * 1000);
  }

  clear() {
    this.queue.length = 0;
    clearTimeout(this._t1);
    clearTimeout(this._t2);
    this.current = null;
    this.cine.hidden = true;
    this.cine.className = 'cine';
    this.toasts.textContent = '';
  }
}

function toneFor(text) {
  const t = text.toUpperCase();
  if (/^NIGHT \d/.test(t)) return 'night'; // a night's title, whatever its theme is called ("NIGHT 2: LIGHTS OUT")
  if (/DIED|DEAD|HORDE|BOSS|ABOMINATION|QUEEN|FINAL|OUT\b/.test(t)) return 'blood';
  if (/ESCAPE|DAWN|SURVIVED|READY|REPAIRED/.test(t)) return 'dawn';
  if (/NIGHT/.test(t)) return 'night';
  return '';
}
