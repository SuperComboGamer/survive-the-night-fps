// Iteration 2 HUD pieces: compass strip, objective tracker ("field notes"), world markers (teammate
// nameplates, pings, the car), downed overlay, damage direction arrows and the dawn summary card.
// Same conventions as hud.js: update() is called every frame and only touches the DOM on change.
import { ITEM_DEFS, ZONE_NAMES, ITEM, ZOMBIE_DEFS, supplyRumours } from '../../shared/defs.js';
import { SUPPLIES, SUPPLY_NEED, W, ACT_NOW } from '../game/act.js'; // (this act's: the car's supplies, or the plane's parts)
import { WORLD, RUNWAY } from '../../shared/acts.js';
import { PHASE, DUSK_WARNING } from '../../shared/constants.js';
import { nightBoss } from '../../shared/nights.js';
import { el, svgEl, fmtTime, clamp } from './dom.js';
import { itemIcon, glyph } from './icons.js';
import { bindTag } from '../game/binds.js';
import { trackStatus } from '../game/tracked.js';

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

// A survivor's health fraction as a class, for nameplates, the compass and the player list: 'crit' below 30%
// (where your own vitals turn red), 'hurt' below 60%. Negative = no health to show (downed, unknown).
export const healthTier = (f) => (f < 0 || f >= 0.6 ? '' : f < 0.3 ? ' crit' : ' hurt');

// ---------------------------------------------------------------- compass
// A marker may also carry `name` (what it is: shown before its label while you face it, and always for your
// waypoint), `d` (its distance in metres) and `pinEdge` (stays on the tape's end when out of view).
// When two markers would print over each other the one that matters more keeps its place and its text:
// a downed teammate or the car in the final stand, then by kind in this order - with whatever you are
// facing just behind your teammates - and between two of a kind the nearer one. (teamway: a teammate's waypoint)
const RANK = { ping: 1, way: 2, mate: 3, teamway: 5, crate: 6, car: 7, hint: 8, poi: 9 };
const RANK_FACING = 4;
const LABEL_GAP = 6; // px kept clear between two labels
const byRank = (a, b) => a.rank - b.rank || a.d - b.d;
const FULL = 0; // icon at its bearing, with its text when that fits under it (or a little to one side)
const ASIDE = 1; // icon moved aside by one icon's width, no text
const TICK = 2; // no room beside it either: a tick on the tape at its bearing

export class Compass {
  constructor(parent) {
    this.root = el('div', 'compass', parent);
    this.strip = el('div', 'cmp-strip', this.root);
    this.ticks = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const card = CARDINALS.find(([c]) => Math.abs(wrapA(c - a)) < 0.01);
      const t = el('i', 'cmp-tick' + (card ? (card[1].length === 1 ? ' major' : ' minor') : '') + (i === 0 ? ' north' : ''), this.strip);
      if (card) el('b', '', t, card[1]);
      this.ticks.push({ a, e: t });
    }
    el('i', 'cmp-center', this.root);
    this.pool = [];
    this.halfFov = 1.35; // radians shown on each side
    // strip width, kept current by a ResizeObserver: reading clientWidth every frame, after the HUD's
    // style writes, forced a synchronous style + layout pass per frame
    this.width = 0;
    if (typeof ResizeObserver !== 'undefined')
      new ResizeObserver(() => {
        this.width = this.root.clientWidth;
        this._font();
      }).observe(this.root);
    // label widths come from a canvas with the label's font, never from laying out the label itself
    this.probe = el('span', 'cmp-mk-lab cmp-probe', this.root);
    this.ctx = document.createElement('canvas').getContext('2d');
    this.textW = new Map();
    this.spacing = -1;
    document.fonts?.addEventListener?.('loadingdone', () => this._font()); // the web font replaces the fallback
    this.vis = []; // scratch: the markers on the tape this frame, in marker order...
    this.order = []; // ...and by rank
  }

  _font() {
    const cs = getComputedStyle(this.probe);
    this.ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    this.spacing = parseFloat(cs.letterSpacing) || 0;
    this.textW.clear();
  }

  _width(text) {
    let w = this.textW.get(text);
    if (w === undefined) {
      if (this.textW.size > 400) this.textW.clear(); // distances tick over as you walk
      w = this.ctx.measureText(text).width + this.spacing * text.length;
      this.textW.set(text, w);
    }
    return w;
  }

  // Where the label (width w) of a marker at x goes among those already placed (order[0..i)): under its
  // icon, or pushed off a label in its way by up to `slack`. NaN when there is no room for it.
  _labelAt(i, x, w, slack) {
    let at = x;
    for (let tries = 0; tries < 2; tries++) {
      let hit = null;
      for (let j = 0; j < i && !hit; j++) {
        const o = this.order[j];
        if (o.text && Math.abs(o.lx - at) < (o.w + w) / 2 + LABEL_GAP - 0.1) hit = o; // (a hair under what it is pushed to)
      }
      if (!hit) return at;
      at = hit.lx + (x >= hit.lx ? 1 : -1) * ((hit.w + w) / 2 + LABEL_GAP);
      if (Math.abs(at - x) > slack) break;
    }
    return NaN;
  }

  _iconFree(i, x, gap) {
    for (let j = 0; j < i; j++) {
      const o = this.order[j];
      if (o.lvl !== TICK && Math.abs(o.px - x) < gap - 0.5) return false;
    }
    return true;
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
      m = { e, ico, lab, key: '', lkey: '', cls: '', dx: 0 };
      this.pool[i] = m;
    }
    return m;
  }

  // yaw: camera yaw (0 = facing -Z/north, positive = turning left/west). markers: [{bearing, kind, icon, label, cls,
  // hp (a teammate's health 0..1, optional)}]
  update(yaw, markers) {
    const heading = -yaw; // clockwise from north
    if (!this.width) this.width = this.root.clientWidth;
    if (this.spacing < 0) this._font();
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
    // which markers are on the tape, and which one you are facing
    const vis = this.vis;
    const order = this.order;
    let count = 0;
    let facing = null;
    let off = W * 0.045; // facing: the named marker nearest the centre mark, within this of it
    for (const mk of markers) {
      let x = toX(mk.bearing);
      let edge = '';
      if (x === null) {
        if (!mk.pinEdge) continue;
        // out of view: pinned just inside the tape's faded ends, with a chevron pointing the way round
        const right = wrapA(mk.bearing - heading) > 0;
        x = W * (right ? 0.87 : 0.13);
        edge = right ? ' edge edge-r' : ' edge edge-l';
      }
      const r = vis[count] || (vis[count] = {});
      order[count++] = r;
      r.mk = mk;
      r.x = x;
      r.edge = edge;
      r.rank = mk.cls === 'downed' || mk.cls === 'urgent' ? 0 : (RANK[mk.kind] ?? 10);
      r.d = mk.d || 0;
      if (mk.name && !edge && Math.abs(x - W / 2) < off) {
        off = Math.abs(x - W / 2);
        facing = r;
      }
    }
    order.length = count;
    if (facing && facing.rank > RANK_FACING) facing.rank = RANK_FACING;
    order.sort(byRank);
    // lay them out in that order: each takes the room it needs, the next ones fit around it
    const gap = Math.max(15, W * 0.036); // two icons nearer than this touch
    for (let i = 0; i < count; i++) {
      const r = order[i];
      const mk = r.mk;
      r.px = r.x;
      r.lvl = FULL;
      r.text = '';
      if (!this._iconFree(i, r.x, gap)) {
        // beside the nearest icon in its way, on its own side of it (pinned ones: towards the middle)
        let by = null;
        for (let j = 0; j < i; j++) if (order[j].lvl !== TICK && (!by || Math.abs(order[j].px - r.x) < Math.abs(by.px - r.x))) by = order[j];
        const side = r.edge ? (r.x < W / 2 ? 1 : -1) : r.x >= by.px ? 1 : -1;
        r.lvl = TICK;
        for (let k = 0; k < 2; k++) {
          const x = by.px + (k ? -side : side) * gap;
          // never further than one icon's width from where it belongs
          if (Math.abs(x - r.x) > gap + 0.5 || !this._iconFree(i, x, gap)) continue;
          r.px = x;
          r.lvl = ASIDE;
          break;
        }
        continue;
      }
      const short = mk.label || '';
      if (mk.name && !r.edge && (r === facing || mk.kind === 'way')) {
        const long = short ? mk.name + ' · ' + short : mk.name;
        const w = this._width(long);
        // a name has to fit inside the part of the tape that is not faded out
        if (r.px - w / 2 > W * 0.1 && r.px + w / 2 < W * 0.9 && this._labelAt(i, r.px, w, 0) === r.px) {
          r.text = long;
          r.w = w;
          r.lx = r.px;
          continue;
        }
      }
      if (short) {
        const w = this._width(short);
        const at = this._labelAt(i, r.px, w, gap * 0.7); // still plainly under its own icon
        if (!Number.isNaN(at)) {
          r.text = short;
          r.w = w;
          r.lx = at;
        }
      }
    }
    // write them out in marker order, so a marker keeps its element from frame to frame
    let n = 0;
    while (n < count) {
      const r = vis[n];
      const mk = r.mk;
      const edge = r.edge + (r.lvl === ASIDE ? ' aside' : r.lvl === TICK ? ' tick' : '');
      const m = this._marker(n++);
      const cls = 'cmp-mk k-' + mk.kind + (mk.cls ? ' ' + mk.cls : '') + healthTier(mk.hp ?? -1) + edge;
      if (m.cls !== cls) m.e.className = m.cls = cls;
      if (m.key !== mk.icon) m.ico.innerHTML = m.key = mk.icon;
      if (m.lkey !== r.text) m.lab.textContent = m.lkey = r.text;
      const dx = r.text ? Math.round(r.lx - r.px) : 0;
      if (m.dx !== dx) m.lab.style.transform = (m.dx = dx) ? `translateX(${dx}px)` : '';
      this._moveTo(m, r.px);
      if (m.e.hidden) m.e.hidden = false;
    }
    for (let i = n; i < this.pool.length; i++) if (!this.pool[i].e.hidden) this.pool[i].e.hidden = true;
  }
}

// ---------------------------------------------------------------- objective tracker
export class Objective {
  constructor(parent) {
    this.root = el('div', 'obj scrap', parent);
    const head = (this.head = el('div', 'obj-head', this.root));
    this.hIco = svgEl('i', 'obj-hico', head, glyph('car'));
    this.hTitle = el('span', 'obj-title', head, 'Escape');
    // one pip per supply the car still needs
    const pips = el('span', 'obj-pips', head);
    this.pips = Array.from({ length: SUPPLY_NEED.reduce((a, b) => a + b, 0) }, () => el('i', '', pips));
    this.hCount = el('span', 'obj-count', head, '');
    this.directive = el('div', 'obj-dir', this.root, '');
    this.list = el('div', 'obj-list', this.root);
    this.rows = SUPPLIES.map((item, i) => {
      const r = el('div', 'obj-row', this.list);
      svgEl('i', 'obj-ico', r, itemIcon(item));
      const name = el('span', 'obj-name', r, ITEM_DEFS[item].name + (SUPPLY_NEED[i] > 1 ? 's' : ''));
      const where = el('span', 'obj-where', r, '');
      const st = el('span', 'obj-st', r, '');
      svgEl('i', 'obj-box', r, glyph('check')); // ticked off once it is in the car
      return { r, name, where, st, key: '', tip: null };
    });
    this.key = '';
    this.done = -1;
    this.act = ACT_NOW;
    // slim (under the minimap): the supplies are a row of icons, and a pointer over one says what it is and where.
    // (The pointer is only free with a menu up: the slim tracker stays over the inventory for that.) The tip sits
    // outside the torn paper, whose mask would cut it off
    this.slim = false;
    this.headTip = { name: 'Escape', body: '' };
    this.tip = el('div', 'obj-tip', parent);
    this.tip.hidden = true;
    this.tipName = el('b', 'obj-tip-name', this.tip);
    this.tipBody = el('span', 'obj-tip-body', this.tip);
    this.tipFor = null;
    this.root.addEventListener('pointerover', (e) => this._hover(e.target.closest('.obj-row, .obj-head')));
    this.root.addEventListener('pointerout', (e) => {
      if (!this.root.contains(e.relatedTarget)) this._hover(null);
    });
  }

  setSlim(on) {
    this.slim = !!on;
    this.root.classList.toggle('slim', this.slim);
    if (!this.slim) this._hover(null);
  }

  // every frame: the tip goes when its icon does, or when the pointer is taken back (closing the inventory locks it
  // where it stands, and no pointerout comes then)
  syncTip() {
    if (this.tipFor && (document.pointerLockElement || this.root.hidden || !this.tipFor.matches(':hover'))) this._hover(null);
  }

  _hover(row) {
    const tip = !this.slim || !row ? null : row === this.head ? this.headTip : this.rows.find((x) => x.r === row)?.tip;
    this.tipFor = tip ? row : null;
    if (!tip) {
      this.tip.hidden = true;
      return;
    }
    this.tipName.textContent = tip.name;
    this.tipBody.textContent = tip.body;
    const r = row.getBoundingClientRect();
    this.tip.style.left = r.left + 'px';
    this.tip.style.top = r.bottom + 6 + 'px';
    this.tip.hidden = false;
  }

  // the act changed (the mainland: the plane's parts take the car's supplies' rows)
  setAct() {
    this.act = ACT_NOW;
    this.hIco.innerHTML = glyph(W.glyph);
    SUPPLIES.forEach((item, i) => {
      const row = this.rows[i];
      row.r.querySelector('.obj-ico').innerHTML = itemIcon(item);
      row.name.textContent = ITEM_DEFS[item].name + (SUPPLY_NEED[i] > 1 ? 's' : '');
      row.key = '';
    });
    this.key = '';
    this.done = -1;
  }

  update(o) {
    if (!o) return;
    if (this.act !== ACT_NOW) this.setAct();
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
      const loose = o.loose?.[item] | 0;
      const complete = have >= need;
      let where;
      if (complete) where = 'installed';
      else if (carried) where = 'in your pack';
      else if (loose) where = 'on the ground';
      else {
        // the places it is still rumoured to be in (a rumour keeps its question mark, as on the map); none left
        // because every one has been picked up: it is in somebody's hands, or lying where they left it
        const rum = supplyRumours(i, o.hints, o.found);
        if (!rum.zones.length) where = rum.found ? 'found' : 'somewhere out there';
        else where = need > 1 ? rum.zones.map((z) => ZONE_NAMES[z]).join(' · ') : ZONE_NAMES[rum.zones[0]] + '?';
      }
      const st = need > 1 && !complete ? `${have}/${need}` : '';
      const k = where + '|' + st + '|' + complete + '|' + carried;
      if (row.key === k) return;
      row.key = k;
      // the slim tracker's hover text: the name, then where it is in words
      let body;
      if (complete) body = `Installed in the ${W.thing}.`;
      else if (carried) body = `In your pack: take ${carried > 1 ? 'them' : 'it'} to the ${W.thing} and install ${carried > 1 ? 'them' : 'it'}.`;
      else if (loose) body = 'Dropped on the ground, or left where a survivor fell: it is marked on the map.';
      else {
        const rum = supplyRumours(i, o.hints, o.found);
        if (rum.zones.length) body = `Rumoured to be at ${rum.zones.map((z) => ZONE_NAMES[z]).join(', ')}.`;
        else if (rum.found) body = 'Already picked up: a survivor has it, or it was dropped somewhere.';
        else body = `Nobody knows where yet. Search ${W.where}.`;
      }
      row.tip = { name: ITEM_DEFS[item].name + (need > 1 ? `s · ${Math.min(have, need)} of ${need} in the ${W.thing}` : ''), body };
      row.where.textContent = where;
      row.st.textContent = st;
      row.r.classList.toggle('done', complete);
      row.r.classList.toggle('carried', !!carried && !complete);
      row.r.classList.toggle('wrap', where.length > 26); // a long list of places gets a line of its own
    });
    if (this.done !== done) {
      this.done = done;
      this.hCount.textContent = `${done}/${total}`;
      this.pips.forEach((p, i) => p.classList.toggle('on', i < done));
    }
    // what to do right now
    let dir = '';
    let tone = '';
    const plane = this.act === WORLD.MAINLAND;
    if (o.finale) {
      if (o.escapeReady && o.runwayBlocked) {
        // (the plane's stand: warm, but it will not go with the dead on the runway ahead of it)
        dir = `The dead are on the runway. Clear it: the plane cannot take off with more than ${RUNWAY.CLEAR} of them in its way.`;
        tone = 'danger';
      } else if (o.escapeReady) {
        // nothing ends the run but a survivor driving, and whoever is not at the car then stays behind
        dir = o.escapeLeaving ? `Someone is getting in: be at the ${W.thing} or be left behind!` : `The ${plane ? 'engines are' : 'engine is'} running. Hold ${bindTag('interact')} at the ${W.thing} to ${W.go}.`;
        tone = 'good';
      } else if (o.escapeStalled) {
        dir = plane ? (o.standWarm ? 'The engines falter: get back to the plane' : 'The pump stops: get back to the fuel truck') : 'The engine stalls: get back to the car';
        tone = 'danger';
      } else {
        dir = plane ? (o.standWarm ? `Defend the plane · engines warm in ${fmtTime(o.escapeT)}` : `Hold the fuel truck · tanks full in ${fmtTime(o.escapeT)}`) : `Defend the car · engine ready in ${fmtTime(o.escapeT)}`;
        tone = 'danger';
      }
    } else if (o.suppliesDone) {
      dir = plane ? `Every part is in. Hold ${bindTag('interact')} at the plane to start fuelling - then hold the truck, the plane and the runway.` : `Every supply is in. Hold ${bindTag('interact')} at the car to start the engine - then survive the final stand.`;
      tone = 'good';
    } else if (o.phase === PHASE.NIGHT) {
      dir = `Survive the night · wave ${o.wave}/${o.waves}`;
      tone = 'night';
    } else if (o.phase === PHASE.DAY && o.timeLeft <= DUSK_WARNING) {
      dir = `Nightfall in ${fmtTime(o.timeLeft)} - build a shelter where you stand`;
      tone = 'danger';
    } else if (o.anyCarried) {
      dir = `Bring the ${W.supplies} you carry back to the ${W.thing}`;
      tone = 'good';
    } else if (o.phase === PHASE.DAY) {
      dir = `Scavenge and find the ${W.parts} before dark`;
    }
    this.directive.textContent = dir;
    this.directive.className = 'obj-dir' + (tone ? ' dir-' + tone : '');
    this.directive.hidden = !dir;
    this.root.classList.toggle('compact', o.phase === PHASE.NIGHT || o.finale);
    this.headTip.body = `${done} of ${total} ${W.parts} are in the ${W.thing}. Install them all, ${W.start} and ${W.go}.` + (dir ? `\n\nNow: ${dir}` : '');
    if (this.tipFor) this._hover(this.tipFor); // (what it says may just have changed)
  }
}

// ---------------------------------------------------------------- the recipe tracked from the crafting panel
// Right under the objective tracker (however tall that is): its checklist, ticking off as things are picked up, and
// where to get the first thing still short - or, with everything in hand, where to craft it.
export class Tracked {
  constructor(parent, above) {
    this.root = el('div', 'trk scrap', parent);
    this.root.hidden = true;
    const head = el('div', 'trk-head', this.root);
    svgEl('i', 'trk-flag', head, glyph('flag'));
    this.name = el('span', 'trk-name', head);
    el('span', 'trk-tag', head, 'Tracked');
    this.list = el('div', 'trk-list', this.root);
    this.foot = el('div', 'trk-foot', this.root);
    this.key = '';
    this.above = above;
    new ResizeObserver(() => this._place()).observe(above);
  }

  _place() {
    const a = this.above;
    this.root.style.top = (a.hidden ? a.offsetTop : a.offsetTop + a.offsetHeight + 8) + 'px';
  }

  // t: { r (the recipe), counts (item -> carried), near ({ fire, bench }), unlocked } or null for nothing tracked
  update(t) {
    if (!t) {
      if (!this.root.hidden) this.root.hidden = true;
      this.key = '';
      return;
    }
    const st = trackStatus(t.r, t.counts, t.near, t.unlocked);
    const key = JSON.stringify([t.r.id, st.ings.map((g) => [g.have, g.ok]), st.station?.ok, st.schem?.ok]);
    if (key === this.key) return;
    this.key = key;
    this.name.textContent = ITEM_DEFS[t.r.out].name;
    this.list.textContent = '';
    const row = (ok, name, val) => {
      const r = el('div', 'trk-row' + (ok ? ' ok' : ''), this.list);
      svgEl('i', 'trk-box', r, ok ? glyph('check') : '');
      el('span', 'trk-n', r, name);
      el('span', 'trk-v', r, val);
    };
    for (const g of st.ings) row(g.ok, g.name, `${Math.min(g.have, 999)} / ${g.need}`);
    if (st.station) row(st.station.ok, `At a ${st.station.name.toLowerCase()}`, st.station.ok ? 'here' : '—');
    if (st.schem) row(st.schem.ok, st.schem.name, st.schem.ok ? 'found' : 'not found');
    let foot;
    let tone = '';
    if (st.ready) {
      foot = `Ready: craft it now ${bindTag('inventory')}`;
      tone = 'good';
    } else if (st.mats && st.schem?.ok !== false) {
      foot = `Ready: craft at a ${st.station.name.toLowerCase()}`;
      tone = 'good';
    } else if (st.src) foot = `${st.src.name}: ${(st.src.where || 'nowhere known').replace(/^./, (c) => c.toLowerCase())}`;
    else foot = 'Find the schematic in lockers, crates or toolboxes';
    this.foot.textContent = foot;
    this.foot.className = 'trk-foot' + (tone ? ' ' + tone : '');
    this.root.hidden = false;
    this._place();
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
      const bar = it.bar ?? -1;
      const cls = 'wmk k-' + it.kind + (it.cls ? ' ' + it.cls : '') + healthTier(bar); // the bar's colour follows its length
      if (k.cls !== cls) m.e.className = k.cls = cls;
      if (k.icon !== it.icon) m.ico.innerHTML = k.icon = it.icon || '';
      if (k.name !== it.name) m.name.textContent = k.name = it.name || '';
      if (k.sub !== it.sub) m.sub.textContent = k.sub = it.sub || '';
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
    this.sub.textContent = d.reviving ? 'Hold on. A teammate has you.' : d.medkit ? `Use a medkit ${bindTag('heal')} to get back up, or wait for a teammate` : `Crawl to cover. A teammate can revive you with ${bindTag('interact')}`;
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
    this.root = el('div', 'summary scrap', parent);
    this.root.hidden = true;
    this.title = el('div', 'sm-title', this.root, '');
    this.stats = el('div', 'sm-stats', this.root);
    this.theme = el('div', 'sm-theme', this.root);
    this.boss = el('div', 'sm-theme sm-boss', this.root);
    this.next = el('div', 'sm-next', this.root, '');
  }
  // theme: the coming night's theme (shared/nights.js), or null for a plain night; boss: its boss (nightBossText)
  show(s, nextText, theme, boss) {
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
    // a themed night gets a line of its own: the one thing on the card the team can act on before dark
    this.theme.textContent = '';
    if (theme) {
      el('b', '', this.theme, `Tonight: ${theme.name}`);
      el('span', '', this.theme, theme.warn);
    }
    // ...and so does its boss: knowing which one is coming is what the day is for
    this.boss.textContent = '';
    if (boss) {
      el('b', '', this.boss, `Boss: ${boss.name}`);
      el('span', '', this.boss, `With the second wave. ${boss.tip}`);
    }
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

// what the next night brings (shown on the dawn card): its one new kind of the dead (ZOMBIE_DEFS minNight). Its boss
// has a line of its own on the card (nightBossText)
export function nextNightText(night) {
  const n = night;
  const more = n <= 1 ? 'The next horde will be bigger.' : `Horde ${n}: bigger and hungrier.`;
  const fresh = Object.values(ZOMBIE_DEFS).filter((d) => d.minNight === n && !d.boss && d.intro);
  return [more, ...fresh.map((d) => d.intro)].join(' ');
}

// the boss that comes with night n, named on the dawn card and at the dusk horn so the team can get ready for it. The
// server draws the same one from the seed (shared/nights.js nightBoss): nothing crosses the wire
export function nightBossText(seed, night) {
  const zd = ZOMBIE_DEFS[nightBoss(seed, night)];
  return { name: (zd.boss ? '' : 'A ') + zd.name, tip: zd.tip || '' };
}

export { PING_LABEL, ITEM };
