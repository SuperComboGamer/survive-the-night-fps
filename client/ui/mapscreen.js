// Field map overlay [M]: the baked survey map of the valley with live markers - you, your team, the
// car, pings, where the car supplies and the schematics are rumoured to be, and the places you have discovered.
// A click sets your own waypoint (the game keeps it, shows it on the compass and in the world, and shares it:
// the team's waypoints are flags here too, with who set them). A pinch or the wheel zooms, a drag pans, and [R] turns
// the map with you, the way you face up (a compass in its corner keeps north).
import { ZONE, ZONE_NAMES, ITEM, ITEM_DEFS, SCHEMATICS, SCHEM_BIT, supplyRumours, schematicRumours } from '../../shared/defs.js';
import { SUPPLIES, SUPPLY_NEED, W } from '../game/act.js'; // (this act's)
import { el, svgEl, lsGet, lsSet } from './dom.js';
import { itemIcon, glyph } from './icons.js';
import { renderMapCanvas, MAP_PX } from './mapcanvas.js';
import { bindLabel, liveText } from '../game/binds.js';

const TEAM_BESIDE = 14; // m: a teammate's waypoint on your own waypoint's spot is drawn this far east of it
const MAX_ZOOM = 4; // the baked map is 2 px a metre: past this it is a blur
const DRAG_PX = 5; // a press that moves this far is a pan, not a click for the waypoint
const START_ZOOM = 2.5; // the first opening starts this close in on you (about 256 m across), the wheel zooms out to all of it
const HEADING_KEY = 'stn.mapHeadingUp';
const ZOOM_KEY = 'stn.mapZoom';

export class MapScreen {
  constructor(ui, parent) {
    this.ui = ui;
    this.open = false;
    this.root = el('div', 'mapscr', parent);
    this.root.hidden = true;
    const bg = el('div', 'map-bg', this.root);
    const frame = (this.frame = el('div', 'map-frame paper', this.root));
    const head = el('div', 'map-head', frame);
    this.title = el('span', 'map-title', head, 'Field map · Harlan Valley');
    this.coords = el('span', 'map-coords', head, '');
    // north up, or turned with you so the way you face is up: kept between openings, and games
    this.headingUp = lsGet(HEADING_KEY, '0') === '1';
    this.rotBtn = el('button', 'map-rot', head);
    this.rotBtn.type = 'button';
    this.rotBtn.title = 'Turn the map with you (R)';
    svgEl('i', 'map-rot-ico', this.rotBtn, glyph('compass'));
    this.rotTxt = el('span', '', this.rotBtn);
    this.rotBtn.addEventListener('click', () => this.setHeadingUp(!this.headingUp));
    const close = svgEl('button', 'set-close btn-icon map-close', head, glyph('xmark'));
    close.type = 'button';
    close.title = 'Close (M)';
    close.addEventListener('click', () => this.onClose?.());
    const body = el('div', 'map-body', frame);
    this.view = el('div', 'map-view', body);
    // the map itself, zoomed and panned inside the view: the names and markers are placed in % of it, so a zoom
    // spreads them apart without making them any bigger
    this.pane = el('div', 'map-pane', this.view);
    this.canvasWrap = el('div', 'map-canvas', this.pane);
    this.labels = el('div', 'map-labels', this.pane);
    this.markers = el('div', 'map-markers', this.pane);
    // where north is, turned with the map; a click on it turns the map too
    this.north = el('button', 'map-north', this.view);
    this.north.type = 'button';
    this.north.title = 'North up / facing up (R)';
    const dial = svgEl('i', 'map-north-dial', this.north, glyph('compass'));
    el('b', '', dial, 'N');
    this.north.addEventListener('click', () => this.setHeadingUp(!this.headingUp));
    const side = el('div', 'map-side', body);
    this.supHead = el('h3', 'inv-h', side).appendChild(el('span', 'inv-h-t', null, 'Car supplies'));
    this.supList = el('div', 'map-sup', side);
    el('h3', 'inv-h', side).appendChild(el('span', 'inv-h-t', null, 'Schematics'));
    this.schemList = el('div', 'map-sup', side);
    el('h3', 'inv-h', side).appendChild(el('span', 'inv-h-t', null, 'Legend'));
    const lg = el('div', 'map-legend', side);
    // (an icon: a glyph's name, or an item's icon as it is)
    for (const [cls, ico, t] of [
      ['you', 'arrowUp', 'You'],
      ['mate', 'person', 'Survivor'],
      ['car', 'car', 'Your car'],
      ['hint', 'fuel', 'Rumoured supply'],
      ['schem', itemIcon(ITEM.SCHEM_SHOTGUN), 'Rumoured schematic'],
      ['ping', 'ping', 'Ping'],
      ['crate', 'hazard', 'Supply drop'],
      ['bench', 'wrench', 'Workbench'],
      ['way', 'flag', 'Your waypoint'],
      ['teamway', 'flag', "A teammate's waypoint"],
    ]) {
      const r = el('div', 'lg ' + cls, lg);
      const i = svgEl('i', 'lg-ico', r, ico.startsWith('<') ? ico : glyph(ico));
      const name = el('span', '', r, t);
      if (cls === 'car') this.carLegend = { i, name }; // (the plane, on the mainland: setWorld)
    }
    const keys = el('div', 'map-keys', side);
    for (const [k, t] of [
      ['LMB', 'set waypoint'],
      ['X', 'clear it'],
      ['Wheel', 'zoom (or pinch)'],
      ['Drag', 'pan'],
      ['R', 'facing up / north up'],
      [() => bindLabel('map'), 'close'], // (keybinds, game/binds.js; X and R above are the map's own)
      [() => bindLabel('ping'), 'ping (in game)'],
    ]) {
      const s = el('span', 'gh', keys);
      if (typeof k === 'function') liveText(el('span', 'kbd sm', s), k);
      else el('span', 'kbd sm', s, k);
      el('span', '', s, t);
    }
    this.world = null;
    this.labelEls = [];
    this.markLabs = [];
    this.pool = [];
    this.supRows = [];
    // waypoint: the game sets onWaypoint and gets { x, z, zone } (zone: id of the place it snapped to, or -1),
    // or null to clear it
    this.onWaypoint = null;
    // the cross, or a left press outside the map's frame, closes it: the game sets onClose
    this.onClose = null;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && (e.target === bg || e.target === this.root)) this.onClose?.();
    });
    // zoom: how many times the view's width the map is, kept between openings, and games. It zooms about the focus, a
    // spot of the map (a fraction across / down) held in the middle of the view as far as the map's edges allow: you,
    // as you move, until a drag moves it somewhere else (an opening puts it back on you). cx / cy is the middle shown
    const z = parseFloat(lsGet(ZOOM_KEY, ''));
    this.zoom = z >= 1 && z <= MAX_ZOOM ? z : START_ZOOM;
    this.fx = this.fy = 0.5;
    this.follow = true;
    this.cx = this.cy = 0.5;
    // how far the map is turned clockwise on screen (rad): your yaw when it faces up, else 0
    this.yaw = 0;
    this.rot = 0;
    this.ptrs = new Map(); // pointer id -> where it was last seen (two of them are a pinch)
    this.press = null; // { id, x, y, target }: a press that has not moved far enough to be a pan; let go, it is a click
    this.gesture = null; // Safari's trackpad pinch: the zoom when it began
    this.view.addEventListener('pointerdown', (e) => {
      if (!this.world || e.target.closest('.map-north')) return;
      // the right button anywhere takes the waypoint back
      if (e.button === 2) return this.onWaypoint?.(null);
      if (e.button !== 0) return;
      this.view.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.press = this.ptrs.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, target: e.target } : null;
    });
    this.view.addEventListener('pointermove', (e) => {
      const p = this.ptrs.get(e.pointerId);
      if (!p) return;
      if (this.press) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_PX) return;
        this.press = null;
        this.view.classList.add('panning');
      }
      if (this.ptrs.size === 1) {
        this._panBy(e.clientX - p.x, e.clientY - p.y);
        p.x = e.clientX;
        p.y = e.clientY;
        return;
      }
      // two fingers: the map zooms with their spread (about the focus, like the wheel)
      const a = this._spread();
      p.x = e.clientX;
      p.y = e.clientY;
      this._zoomTo((this.zoom * this._spread().d) / a.d);
    });
    const release = (e) => {
      if (!this.ptrs.delete(e.pointerId)) return;
      if (!this.ptrs.size) this.view.classList.remove('panning');
      const pr = this.press;
      this.press = null;
      // a click: on the waypoint itself it takes it back, anywhere else it sets it
      if (e.type === 'pointerup' && pr?.id === e.pointerId) this.onWaypoint?.(pr.target.closest('.mm.way') ? null : this._pick(pr.x, pr.y, pr.target));
    };
    this.view.addEventListener('pointerup', release);
    this.view.addEventListener('pointercancel', release);
    this.view.addEventListener('contextmenu', (e) => e.preventDefault());
    // the wheel, and a trackpad pinch (Chrome and Firefox send that as the wheel with Ctrl held, in small steps)
    this.view.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault(); // (Ctrl + wheel would zoom the whole page)
        if (this.gesture !== null) return;
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.view.clientHeight : 1;
        this._zoomTo(this.zoom * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002)));
      },
      { passive: false },
    );
    // Safari sends a trackpad pinch as gesture events instead (on a touch screen the pointers above have it)
    this.view.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      this.gesture = this.zoom;
    });
    this.view.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (this.gesture !== null && this.ptrs.size < 2) this._zoomTo(this.gesture * e.scale);
    });
    this.view.addEventListener('gestureend', (e) => {
      e.preventDefault();
      this.gesture = null;
    });
    // (the game's own key handling is off while the map is open, like the inventory's Q / E)
    window.addEventListener('keydown', (e) => {
      if (!this.open || e.repeat || this.ui.isTyping()) return;
      if (e.code === 'KeyX') this.onWaypoint?.(null);
      else if (e.code === 'KeyR') this.setHeadingUp(!this.headingUp);
    });
    this._showHeading();
  }

  setHeadingUp(on) {
    this.headingUp = !!on;
    lsSet(HEADING_KEY, this.headingUp ? '1' : '0');
    this._showHeading();
    this._layout();
  }

  _showHeading() {
    this.rotTxt.textContent = this.headingUp ? 'Facing up' : 'North up';
    this.rotBtn.classList.toggle('on', this.headingUp);
  }

  // the middle of the first two pointers down and how far apart they are
  _spread() {
    const [a, b] = this.ptrs.values();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  _zoomTo(z) {
    this.zoom = Math.max(1, Math.min(MAX_ZOOM, z));
    this._layout();
  }

  // a drag: the focus becomes the middle shown, moved with the pointer (all the map is in view at 1x north up:
  // nothing to move). The move on screen is turned back onto the map when the map is turned
  _panBy(dx, dy) {
    if (this.zoom <= 1 && !this.headingUp) return;
    this.follow = false;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    const w = this.view.clientWidth * this.zoom; // (the view is square)
    this.fx = this.cx - (dx * c + dy * s) / w;
    this.fy = this.cy - (dy * c - dx * s) / w;
    this._layout();
    this.fx = this.cx;
    this.fy = this.cy;
  }

  // the focus in the middle, but north up the map never pulls away from the view's edges. Turned, it turns about the
  // middle and its corners come into view anyway: then only the focus stays on the map
  _layout() {
    const rot = this.headingUp ? this.yaw : 0;
    const m = this.headingUp ? 0 : 0.5 / this.zoom;
    this.cx = Math.max(m, Math.min(1 - m, this.fx));
    this.cy = Math.max(m, Math.min(1 - m, this.fy));
    const st = this.pane.style;
    st.width = st.height = this.zoom * 100 + '%';
    st.left = (0.5 - this.cx * this.zoom) * 100 + '%';
    st.top = (0.5 - this.cy * this.zoom) * 100 + '%';
    st.transformOrigin = `${this.cx * 100}% ${this.cy * 100}%`;
    if (rot !== this.rot) {
      this.rot = rot;
      st.transform = rot ? `rotate(${rot}rad)` : '';
      // the names and markers turn back the other way, so they stay upright; the compass turns with the map
      st.setProperty('--unrot', -rot + 'rad');
      this.north.style.setProperty('--rot', rot + 'rad');
    }
  }

  // where a click on the map is in the world; on a place's name or inside its yard it is that place
  _pick(px, py, target) {
    const lab = target.closest('.map-lab');
    let zone = lab ? this.world.zoneById[lab.dataset.zone] : null;
    // from the middle of the view, turned back onto the map
    const r = this.view.getBoundingClientRect();
    const dx = px - (r.left + r.width / 2);
    const dy = py - (r.top + r.height / 2);
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    const w = this.view.clientWidth * this.zoom;
    const u = this.cx + (dx * c + dy * s) / w;
    const v = this.cy + (dy * c - dx * s) / w;
    const lim = this.world.half - 3; // the playable ground stops short of the map's edge
    const x = Math.max(-lim, Math.min(lim, u * this.world.size - this.world.half));
    const z = Math.max(-lim, Math.min(lim, v * this.world.size - this.world.half));
    if (!zone) {
      let best = Infinity;
      for (const zn of this.world.zones) {
        const d = Math.hypot(x - zn.x, z - zn.z);
        // (the same reach as discovering the place on foot)
        if (d < zn.flat + 6 && d < best) {
          best = d;
          zone = zn;
        }
      }
    }
    return zone ? { x: zone.x, z: zone.z, zone: zone.id } : { x, z, zone: -1 };
  }

  setWorld(world) {
    if (this.world === world) return;
    this.world = world;
    // the mainland has a plane where the island has a car (game/act.js: Game sets the act before the world)
    const plane = !!world.car?.plane;
    this.title.textContent = plane ? 'Field map · The Calder Coast' : 'Field map · Harlan Valley';
    this.supHead.textContent = plane ? 'Plane parts' : 'Car supplies';
    this.carLegend.i.innerHTML = glyph(W.glyph);
    this.carLegend.name.textContent = W.your;
    this.canvasWrap.textContent = '';
    this.canvas = null;
    this.labels.textContent = '';
    this.labelEls = world.zones.map((z) => {
      const l = el('div', 'map-lab', this.labels);
      l.style.left = ((z.x + this.world.half) / this.world.size) * 100 + '%';
      l.style.top = ((z.z + this.world.half) / this.world.size) * 100 + '%';
      l.dataset.zone = z.id;
      return l;
    });
    // St. Agnes Cemetery is part of the chapel's place: a name of its own on the map, in smaller letters (a click
    // on it is a click in the chapel's yard)
    // ...and so are a city's landmarks (the mainland: world.landmarks), each where it stands
    this.markLabs = (world.landmarks || []).map((m) => {
      const l = el('div', 'map-lab sub', this.labels);
      l.style.left = ((m.x + world.half) / world.size) * 100 + '%';
      l.style.top = ((m.z + world.half) / world.size) * 100 + '%';
      return l;
    });
    this.cemLab = null;
    if (world.cemetery) {
      this.cemLab = el('div', 'map-lab sub', this.labels);
      this.cemLab.style.left = ((world.cemetery.x + world.half) / this.world.size) * 100 + '%';
      this.cemLab.style.top = ((world.cemetery.z + world.half) / this.world.size) * 100 + '%';
    }
  }

  _ensureCanvas() {
    if (this.canvas || !this.world) return;
    const t0 = performance.now();
    this.canvas = renderMapCanvas(this.world);
    this.canvas.className = 'map-cv';
    this.canvasWrap.appendChild(this.canvas);
    console.log(`[map] baked in ${(performance.now() - t0).toFixed(0)}ms (${MAP_PX}px)`);
  }

  // the baked map, for the minimap to draw from (baked now if the map has not been opened yet), or null before a world
  baked() {
    this._ensureCanvas();
    return this.canvas;
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    if (open) {
      this._ensureCanvas();
      this.follow = true;
    } else {
      lsSet(ZOOM_KEY, String(this.zoom));
      this.ptrs.clear();
      this.press = null;
      this.gesture = null;
      this.view.classList.remove('panning');
    }
    this.root.hidden = !open;
    this.ui.root.classList.toggle('map-open', open);
  }

  _mk(i) {
    let m = this.pool[i];
    if (!m) {
      const e = el('div', 'mm', this.markers);
      const ico = el('i', 'mm-ico', e);
      const lab = el('span', 'mm-lab', e);
      m = { e, ico, lab, k: '', l: '', c: '' };
      this.pool[i] = m;
    }
    return m;
  }

  // d: { self:{x,z,yaw}, mates:[{x,z,name,status}], car:{x,z}, pings:[{x,z,kind,name}], crates:[{x,z}],
  //      benches:[{x,z}], discovered:Set, hints:[zone...], found:bits (a hint whose supply has been taken),
  //      schemHints:[zone per schematic], unlocked:bits (the schematics the team has),
  //      supplies:[n...], carried:{item:n}, waypoint:{x,z,zone} | null,
  //      teamWays:[{x,z,zone,names:[...],mine (on the spot of your own)}] }
  update(d) {
    if (!this.open || !this.world) return;
    const pct = (v) => ((v + this.world.half) / this.world.size) * 100;
    this.yaw = d.self.yaw;
    if (this.follow) {
      this.fx = (d.self.x + this.world.half) / this.world.size;
      this.fy = (d.self.z + this.world.half) / this.world.size;
    }
    this._layout();
    const way = d.waypoint;
    const taken = (i) => !!(d.found & (1 << i));
    const schems = schematicRumours(d.schemHints, d.unlocked);
    // place names: known once discovered. A rumour names its place too, and marks it while what it hides is still there
    this.labelEls.forEach((l, i) => {
      const z = this.world.zones[i];
      const known = d.discovered.has(z.id);
      const txt = known ? ZONE_NAMES[z.id] : d.hints.includes(z.id) || d.schemHints.includes(z.id) ? ZONE_NAMES[z.id] + '?' : '?';
      if (l.textContent !== txt) l.textContent = txt;
      l.classList.toggle('unknown', !known);
      l.classList.toggle('hinted', d.hints.some((zid, k) => zid === z.id && !taken(k)) || schems.some((rm) => rm.zone === z.id));
      l.classList.toggle('way', !!way && way.zone === z.id);
    });
    // (a city's landmarks: known once the city is)
    const marks = this.world.landmarks || [];
    for (let i = 0; i < this.markLabs.length; i++) {
      const txt = d.discovered.has(ZONE.CITY) ? marks[i].name : '';
      if (this.markLabs[i].textContent !== txt) this.markLabs[i].textContent = txt;
    }
    if (this.cemLab) {
      // (known once you have been to it, or to the chapel it lies behind)
      const txt = d.discovered.has(ZONE.CEMETERY) || d.discovered.has(ZONE.CHURCH) ? ZONE_NAMES[ZONE.CEMETERY] : '';
      if (this.cemLab.textContent !== txt) this.cemLab.textContent = txt;
    }
    let n = 0;
    const put = (x, z, cls, icon, label = '', rot = null) => {
      const m = this._mk(n++);
      if (m.c !== cls) m.e.className = m.c = 'mm ' + cls;
      if (m.k !== icon) m.ico.innerHTML = m.k = icon;
      if (m.l !== label) m.lab.textContent = m.l = label;
      m.e.style.left = pct(x) + '%';
      m.e.style.top = pct(z) + '%';
      m.ico.style.transform = rot === null ? '' : `rotate(${rot}rad)`;
      if (m.e.hidden) m.e.hidden = false;
    };
    // your waypoint goes under everything else (on a place its own name is the label, in the waypoint's colour)
    if (way) put(way.x, way.z, 'way', glyph('flag'), way.zone >= 0 ? '' : 'waypoint');
    // the team's, named for who set them (one on your own spot stands just east of your ring)
    for (const t of d.teamWays) put(t.x + (t.mine ? TEAM_BESIDE : 0), t.z, 'teamway', glyph('flag'), t.names.join(', '));
    // rumoured supply places: gone from the map once the supply has been picked up there, nothing left to look for
    const seen = new Set();
    d.hints.forEach((zid, i) => {
      if (zid === 255 || taken(i)) return;
      const si = Math.min(i, 4);
      if (d.supplies[si] >= SUPPLY_NEED[si]) return;
      const z = this.world.zoneById[zid];
      if (!z) return;
      const k = zid + ':' + si;
      if (seen.has(k)) return;
      seen.add(k);
      const off = seen.size % 3;
      put(z.x + (off - 1) * 6, z.z - 14, 'hint', itemIcon(SUPPLIES[si]));
    });
    // rumoured schematics: under the place's name (the supplies are over it), gone once the team has that one.
    // Which container of the place holds it is not known: they all have to be searched
    const perPlace = new Map();
    for (const rm of schems) {
      const z = this.world.zoneById[rm.zone];
      if (!z) continue;
      const n = perPlace.get(rm.zone) || 0;
      perPlace.set(rm.zone, n + 1);
      put(z.x + n * 10, z.z + 26, 'schem', itemIcon(rm.item));
    }
    for (const b of d.benches) put(b.x, b.z, 'bench', glyph('wrench'), 'bench');
    for (const c of d.crates) put(c.x, c.z, 'crate', glyph('hazard'), 'drop');
    for (const p of d.pings) put(p.x, p.z, 'ping k' + p.kind, glyph('ping'), p.name);
    put(d.car.x, d.car.z, 'car', glyph(W.glyph), W.thing);
    for (const m of d.mates) put(m.x, m.z, 'mate ' + m.status, glyph(m.status === 'downed' ? 'downed' : 'person'), m.name);
    // (the marker stands upright on screen, so its arrow turns with the map as well as with you)
    put(d.self.x, d.self.z, 'you', glyph('arrowUp'), '', this.rot - d.self.yaw);
    for (let i = n; i < this.pool.length; i++) if (!this.pool[i].e.hidden) this.pool[i].e.hidden = true;
    this.coords.textContent = `${Math.round(d.self.x)} E · ${Math.round(-d.self.z)} N`;
    // supply checklist
    const key = JSON.stringify([d.supplies, d.hints, d.found, d.carried]);
    if (key !== this._supKey) {
      this._supKey = key;
      this.supList.textContent = '';
      SUPPLIES.forEach((item, i) => {
        const r = el('div', 'ms-row' + (d.supplies[i] >= SUPPLY_NEED[i] ? ' done' : d.carried[item] ? ' carried' : ''), this.supList);
        svgEl('i', 'ms-ico', r, itemIcon(item));
        const t = el('div', 'ms-t', r);
        el('b', '', t, ITEM_DEFS[item].name + (SUPPLY_NEED[i] > 1 ? ` ${d.supplies[i]}/${SUPPLY_NEED[i]}` : ''));
        const rum = supplyRumours(i, d.hints, d.found);
        el('span', '', t, d.supplies[i] >= SUPPLY_NEED[i] ? 'installed' : rum.zones.map((z) => ZONE_NAMES[z]).join(' · ') || (rum.found ? 'found' : 'unknown'));
      });
    }
    // schematic checklist
    const sKey = JSON.stringify([d.schemHints, d.unlocked]);
    if (sKey !== this._schemKey) {
      this._schemKey = sKey;
      this.schemList.textContent = '';
      SCHEMATICS.forEach((item, k) => {
        const got = !!(d.unlocked & (1 << SCHEM_BIT[item]));
        const zid = d.schemHints[k];
        const r = el('div', 'ms-row' + (got ? ' done' : ''), this.schemList);
        svgEl('i', 'ms-ico', r, itemIcon(item));
        const t = el('div', 'ms-t', r);
        el('b', '', t, ITEM_DEFS[item].name);
        el('span', '', t, got ? 'found' : zid !== 255 && ZONE_NAMES[zid] ? `${ZONE_NAMES[zid]}? · search its containers` : 'unknown');
      });
    }
  }
}
