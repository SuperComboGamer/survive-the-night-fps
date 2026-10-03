// Contextual key hints: one line on the HUD naming the key that answers what is happening right now (it is
// dark and the light is off, hurt with a bandage in the pack, dusk with planks to build with), plus the map
// and the inventory once each in the first minute. A hint goes as soon as its moment has passed and is
// retired for good once the player has done the thing twice. Only a change of hint touches the DOM.
import { PHASE, DUSK_WARNING, SLOT_BUILD } from '../../shared/constants.js';
import { CONSUMABLES, STRUCT_DEFS, STRUCT_ORDER, SCHEM_BIT } from '../../shared/defs.js';
import { ACTION_KEYS, keyLabel } from '../game/input.js';
import { el, replay, lsGet, lsSet } from './dom.js';

const STORE = 'stn.keyhints'; // { flashlight: 2, heal: 1, ... }: how often each was done, counted up to RETIRE
const RETIRE = 2;
const DARK = 0.6; // Environment.night: dusk ends on 0.6, so anything above is the night itself
const HURT = 0.5; // of full health
const LOW_BATTERY = 10; // % - a light that would die within seconds is not worth pointing at
const EARLY_FROM = 6; // seconds of daytime play: after the opening title card...
const EARLY_UNTIL = 60; // ...and within the first minute, the map and the inventory get a mention,
const EARLY_SHOW = 20; // this long each unless the key is pressed sooner
const EVERY = 0.2; // seconds between looks at the situation

// most urgent first: only the first one that applies is shown
const HINTS = [
  { id: 'throwoff', key: 'Space', text: 'Throw it off', always: true }, // pinned by a leaper (Zombies.throwOff)
  { id: 'flashlight', key: ACTION_KEYS.flashlight, text: 'Flashlight' },
  { id: 'heal', key: ACTION_KEYS.heal, text: 'Heal' },
  { id: 'build', key: ACTION_KEYS.build, text: 'Build a shelter' },
  { id: 'map', key: ACTION_KEYS.map, text: 'Field map', early: true },
  { id: 'inventory', key: ACTION_KEYS.inventory, text: 'Inventory & crafting', early: true },
];

function loadCounts() {
  try {
    const o = JSON.parse(lsGet(STORE, 'null'));
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export class KeyHints {
  constructor(game) {
    this.game = game;
    this.root = el('div', 'keyhint', game.ui.hud.root);
    this.root.hidden = true;
    this.cap = el('span', 'kbd', this.root, '');
    this.text = el('span', 'kh-t', this.root, '');
    this.counts = loadCounts();
    this.shown = null;
    this.now = {}; // what the player is doing this frame, by hint id...
    this.was = null; // ...and was doing the frame before
    this.wait = 0; // seconds since the situation was last looked at
    this.age = 0; // seconds of daytime play so far
    this.dwell = {}; // seconds each early hint has been on screen
    this.done = {}; // done at least once since the page loaded
  }

  // call once per frame while playing
  update(dt) {
    const g = this.game;
    const s = g.prediction.state;
    const self = g.self;
    // A use is counted where the key takes effect, not where it is pressed: the light comes on, a heal starts,
    // the hammer comes out, the map or the inventory opens. A key that did nothing taught nothing.
    const now = this.now;
    now.flashlight = !!g.localFlash;
    now.heal = !!CONSUMABLES[self.useItem]?.heal;
    now.build = s.slot === SLOT_BUILD && !s.zombie;
    now.map = !!g.ui.mapOpen;
    now.inventory = !!g.ui.inventoryOpen;
    let used = false;
    if (this.was) {
      for (const h of HINTS) {
        if (!now[h.id] || this.was[h.id]) continue;
        if (h.id === 'heal' && now.inventory) continue; // clicked in the backpack, not the heal key
        this.use(h.id);
        used = true;
      }
    } else this.was = {};
    for (const h of HINTS) this.was[h.id] = now[h.id];

    this.wait += dt;
    if (this.wait < EVERY && !used) return;
    const waited = this.wait;
    this.wait = 0;
    // only for a living survivor with the controls live: not paused, in the inventory, on the map or typing
    const active = !!self.alive && !s.zombie && !s.downed && g.input.enabled && !g.ui.isTyping();
    const day = g.global.phase === PHASE.DAY && !g.global.finale;
    if (active && day) this.age += waited;
    if (this.shown?.early) this.dwell[this.shown.id] = (this.dwell[this.shown.id] || 0) + waited;
    let pick = null;
    if (active && g.settings.keyHints !== false) {
      for (const h of HINTS) {
        if ((!h.always && (this.counts[h.id] | 0) >= RETIRE) || !this.applies(h, day)) continue;
        pick = h;
        break;
      }
    }
    this.show(pick);
  }

  applies(h, day) {
    const g = this.game;
    const self = g.self;
    switch (h.id) {
      case 'throwoff':
        return !!g.prediction.state.pinned;
      case 'flashlight':
        // (it needs no battery item: it runs down while on and recharges by itself while off)
        return g.env.night > DARK && !g.localFlash && self.battery > LOW_BATTERY;
      case 'heal':
        return self.hp < self.maxHp * HURT && !self.useItem && g.inventory.slots.some((it) => it && CONSUMABLES[it.item]?.heal);
      case 'build':
        return day && g.global.timeLeft <= DUSK_WARNING && g.prediction.state.slot !== SLOT_BUILD && this.canBuild();
      default:
        // the early ones: in the quiet of the first minute, each until it is used or has had its time
        return day && this.age >= EARLY_FROM && this.age < EARLY_UNTIL && !this.done[h.id] && (this.dwell[h.id] || 0) < EARLY_SHOW && !(g.danger > 0.3);
    }
  }

  // carrying what at least one structure costs (and the team has its schematic)
  canBuild() {
    const g = this.game;
    const counts = g.invCounts();
    const unlocked = g.global.unlocked | 0;
    for (const type of STRUCT_ORDER) {
      const def = STRUCT_DEFS[type];
      if (def.schem && !(unlocked & (1 << SCHEM_BIT[def.schem]))) continue;
      let afford = true;
      for (const k in def.cost) if ((counts[k] || 0) < def.cost[k]) afford = false;
      if (afford) return true;
    }
    return false;
  }

  use(id) {
    this.done[id] = true;
    const n = this.counts[id] | 0;
    if (n >= RETIRE) return;
    this.counts[id] = n + 1;
    lsSet(STORE, JSON.stringify(this.counts));
  }

  show(h) {
    if (h === this.shown) return;
    this.shown = h;
    this.root.hidden = !h;
    if (!h) return;
    this.cap.textContent = keyLabel(h.key);
    this.text.textContent = h.text;
    replay(this.root, 'in'); // fade in again when one hint takes over from another
  }
}
