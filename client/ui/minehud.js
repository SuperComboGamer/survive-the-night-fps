// Zombies-mode HUD: the round counter, points, perks, and the line that says what the cage / the countdown is doing.
// Only touched while a mine run is on (it hides itself otherwise); updates only the nodes whose text changed.
import { el } from './dom.js';
import { PERKS } from '../../shared/mine.js';
import { MINE } from '../../shared/minedefs.js';

export class MineHud {
  constructor(parent) {
    const root = (this.root = el('div', 'mine-hud', parent));
    root.hidden = true;
    const top = el('div', 'mh-top', root);
    this.roundLbl = el('div', 'mh-round-l', top, 'ROUND');
    this.round = el('div', 'mh-round', top, '1');
    this.left = el('div', 'mh-left', top, '');
    this.banner = el('div', 'mh-banner', root, '');
    this.sub = el('div', 'mh-sub', root, '');
    const pts = el('div', 'mh-pts', root);
    this.perks = el('div', 'mh-perks', pts);
    this.perkEls = PERKS.map((p) => {
      const e = el('div', 'mh-perk', this.perks, p.name.slice(0, 1));
      e.style.setProperty('--c', p.color);
      e.title = p.name;
      e.hidden = true;
      return e;
    });
    this.pointsEl = el('div', 'mh-points', pts, '500');
    this.pointsGain = el('div', 'mh-gain', pts, '');
    this.c = Object.create(null);
    this.lastPoints = 500;
    this.gainT = 0;
    this.power = el('div', 'mh-power', root, '');
  }

  set(k, v, fn) {
    if (this.c[k] === v) return;
    this.c[k] = v;
    fn(v);
  }

  update(dt, s) {
    const on = !!s.active;
    if (this.root.hidden === on) this.root.hidden = !on;
    if (!on) return;
    this.set('round', s.round, (v) => (this.round.textContent = v));
    this.set('left', s.state === MINE.STATE.ROUND ? s.left : -1, (v) => (this.left.textContent = v >= 0 ? `${v} left` : ''));
    this.set('pts', s.points, (v) => {
      this.pointsEl.textContent = v;
      const d = v - this.lastPoints;
      this.lastPoints = v;
      if (d) {
        this.pointsGain.textContent = (d > 0 ? '+' : '') + d;
        this.pointsGain.className = 'mh-gain ' + (d > 0 ? 'up' : 'down');
        this.gainT = 1.4;
      }
    });
    if (this.gainT > 0) {
      this.gainT -= dt;
      if (this.gainT <= 0) this.pointsGain.className = 'mh-gain';
    }
    PERKS.forEach((p, i) => this.set('perk' + i, !!(s.perks & p.bit), (v) => (this.perkEls[i].hidden = !v)));
    let banner = '';
    let sub = '';
    if (s.state === MINE.STATE.PREP) {
      banner = s.round === 0 ? 'SHAFT NINE' : `ROUND ${s.round + 1}`;
      sub = `The dead come in ${Math.ceil(s.timeLeft)}`;
    } else if (s.state === MINE.STATE.CLEAR) {
      banner = 'ROUND CLEARED';
      sub = s.elev === MINE.ELEV.OPEN ? 'The cage is at the exit shaft: find the green light and get in' : 'The cage is coming down the exit shaft…';
    } else if (s.state === MINE.STATE.RIDE) {
      banner = s.stopName ? `DOWN TO ${s.stopName.toUpperCase()}` : '';
      sub = 'Hold on';
    }
    this.set('banner', banner, (v) => (this.banner.textContent = v));
    this.set('sub', sub, (v) => (this.sub.textContent = v));
    const power = [s.doublePoints > 0 ? `2× POINTS ${s.doublePoints}` : '', s.instaKill > 0 ? `INSTA-KILL ${s.instaKill}` : ''].filter(Boolean).join('   ');
    this.set('power', power, (v) => (this.power.textContent = v));
  }
}
