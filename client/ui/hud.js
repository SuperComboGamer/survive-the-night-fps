// Per-frame HUD. update(h) is called every frame: it diffs against cached values and only
// touches the DOM when a (rounded) value actually changed.
import { ITEM, ITEM_DEFS, WEAPONS, AMMO_NAMES } from '../../shared/defs.js';
import { PHASE, dayLength, NIGHT_LENGTH, DUSK_WARNING } from '../../shared/constants.js';
import { GUN, MOUNTED_GUN } from '../../shared/mountedgun.js';
import { el, svgEl, fmtTime, parsePrompt, clamp, replay } from './dom.js';
import { itemIcon, glyph, splatSvg } from './icons.js';
import { Compass, Objective, Tracked, Markers, Downed, DamageDir } from './hud2.js';
import { Minimap } from './minimap.js';
import { W, ACT_NOW } from '../game/act.js'; // (this act, and the words for what its parts go into)
import { WORLD } from '../../shared/acts.js';
import { bindLabel, bindTag, onBindsChange } from '../game/binds.js';

const SLOT_LABELS = ['Primary', 'Pistol', 'Melee', 'Throw', 'Build', 'Radio'];
const RADIO = 5; // the walkie-talkie's slot (SLOT_RADIO)
const ARC = { cx: 120, cy: 70, rx: 100, ry: 56 };

// deterministic treeline for the clock horizon
function treeline() {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let d = '';
  for (let x = 2; x < 240; ) {
    const edge = Math.min(x, 240 - x) / 120; // 0 at edges, 1 at centre
    const h = (1 - edge * 0.78) * (7 + r() * 11) + 2;
    const w = 2.2 + h * 0.26 + r() * 1.2;
    const y0 = 76;
    d += `M${(x - w).toFixed(1)} ${y0}L${x.toFixed(1)} ${(y0 - h).toFixed(1)}L${(x + w).toFixed(1)} ${y0}Z`;
    // second tier for bigger trees
    if (h > 9) d += `M${(x - w * 0.8).toFixed(1)} ${(y0 - h * 0.35).toFixed(1)}L${x.toFixed(1)} ${(y0 - h * 1.08).toFixed(1)}L${(x + w * 0.8).toFixed(1)} ${(y0 - h * 0.35).toFixed(1)}Z`;
    x += w * (0.9 + r() * 0.9);
  }
  return d + 'M0 75.6H240V76.6H0Z';
}

function stars() {
  let s = 99;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let out = '';
  for (let i = 0; i < 22; i++) {
    const x = 14 + r() * 212;
    const y = 4 + r() * 58;
    const rad = 0.35 + r() * 0.75;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(2)}" style="animation-delay:${(-r() * 4).toFixed(2)}s"/>`;
  }
  return out;
}

export class Hud {
  // leftLayer: the top-left corner over the inventory, where the objective tracker sits (its slim form stays up while
  // the inventory is open)
  constructor(ui, layer, topLayer, clockLayer, leftLayer = layer) {
    this.ui = ui;
    this.c = Object.create(null); // diff cache
    this.root = layer;

    // ---- world markers (nameplates, pings) sit under everything else
    this.markers = new Markers(layer);
    // ---- full-screen effect layers
    this.lowhp = el('div', 'fx-lowhp', layer);
    this.blood = el('div', 'fx-blood', layer);
    this.splats = el('div', 'fx-splats', layer);
    this.zvig = el('div', 'fx-zombie', layer);

    // ---- top-left info
    const info = el('div', 'hud-info', layer);
    this.iSurv = el('span', 'hi-surv', info);
    svgEl('i', 'hi-ico', this.iSurv, glyph('people'));
    this.iSurvT = el('b', '', this.iSurv, '');
    this.iPing = el('span', 'hi-ping', info);
    svgEl('i', 'hi-ico', this.iPing, glyph('signal'));
    this.iPingT = el('b', '', this.iPing, '');
    this.iFps = el('span', 'hi-fps', info);
    svgEl('i', 'hi-ico', this.iFps, glyph('ecg'));
    this.iFpsT = el('b', '', this.iFps, '');
    this.iFps.hidden = true;

    // ---- minimap (top-left) and the objective tracker (left; under the minimap, slim)
    this.minimap = new Minimap(layer);
    this.objective = new Objective(leftLayer);
    this.objective.setSlim(true);
    this.tracked = new Tracked(leftLayer, this.objective.root); // (the recipe tracked from the crafting panel, under it)
    // ---- top-centre compass
    this.compass = new Compass(topLayer);
    // ---- top-right day / night clock
    const clock = (this.clock = el('div', 'clock is-day', clockLayer));
    const svgWrap = svgEl(
      'div',
      'clk-dial',
      clock,
      `<svg class="clk-svg" viewBox="0 0 240 82" aria-hidden="true">
        <g class="clk-stars">${stars()}</g>
        <path class="clk-track" d="M20 70A100 56 0 0 1 220 70" pathLength="100"/>
        <path class="clk-prog" d="M20 70A100 56 0 0 1 220 70" pathLength="100"/>
        <g class="clk-ticks">${[0.25, 0.5, 0.75]
          .map((p) => {
            const a = Math.PI * p;
            const x = ARC.cx - ARC.rx * Math.cos(a);
            const y = ARC.cy - ARC.ry * Math.sin(a);
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.3"/>`;
          })
          .join('')}</g>
        <g class="clk-body" transform="translate(20 70)">
          <g class="clk-sun"><circle class="halo" r="11"/><circle r="5.4"/><path d="M0-9.5V-7.6M0 9.5V7.6M-9.5 0H-7.6M9.5 0H7.6M-6.7-6.7L-5.4-5.4M6.7 6.7L5.4 5.4M-6.7 6.7L-5.4 5.4M6.7-6.7L5.4-5.4"/></g>
          <g class="clk-moon"><circle class="halo" r="11"/><path d="M1.8-6.4A6.6 6.6 0 1 0 6.4 3.2A5.4 5.4 0 0 1 1.8-6.4Z"/></g>
        </g>
        <path class="clk-trees" d="${treeline()}"/>
      </svg>`,
    );
    this.clkSvg = svgWrap.firstElementChild;
    this.clkProg = this.clkSvg.querySelector('.clk-prog');
    this.clkBody = this.clkSvg.querySelector('.clk-body');
    const ct = el('div', 'clk-text', clock);
    this.clkTitle = el('div', 'clk-title', ct, 'DAY 1');
    const sub = el('div', 'clk-sub', ct);
    this.clkLabel = el('span', 'clk-label', sub, '');
    this.clkTime = el('span', 'clk-time', sub, '');
    this.clkRemain = el('div', 'clk-remain', ct);
    svgEl('i', 'clk-rico', this.clkRemain, glyph('horde'));
    this.clkRemainN = el('b', '', this.clkRemain, '0');
    el('span', '', this.clkRemain, 'remain');
    this.clkRemain.hidden = true;

    // ---- boss bar
    const boss = (this.boss = el('div', 'boss', topLayer));
    boss.hidden = true;
    const bn = el('div', 'boss-name', boss);
    svgEl('i', 'boss-ico', bn, glyph('bossSkull'));
    this.bossName = el('span', '', bn, '');
    svgEl('i', 'boss-ico', bn, glyph('bossSkull'));
    const bb = el('div', 'boss-bar', boss);
    this.bossLag = el('i', 'boss-lag', bb);
    this.bossFill = el('i', 'boss-fill', bb);
    el('i', 'boss-ticks', bb);

    // ---- centre: crosshair, hitmarker, use ring, prompt, context
    const center = el('div', 'hud-center', layer);
    this.xh = el('div', 'xh', center);
    for (const k of ['t', 'b', 'l', 'r']) el('i', 'xh-' + k, this.xh);
    el('i', 'xh-dot', this.xh);
    this.hm = svgEl(
      'div',
      'hm',
      center,
      '<svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M-9.5-9.5L-3.6-3.6M9.5-9.5L3.6-3.6M-9.5 9.5L-3.6 3.6M9.5 9.5L3.6 3.6"/></svg>',
    );
    this.killSkull = svgEl('div', 'hm-skull', center, glyph('skull'));
    this.useWrap = svgEl(
      'div',
      'use',
      center,
      '<svg class="use-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="42"/><circle class="fg" cx="50" cy="50" r="42" pathLength="100" transform="rotate(-90 50 50)"/></svg>',
    );
    this.useFg = this.useWrap.querySelector('.fg');
    this.useLabel = el('div', 'use-label', this.useWrap, '');
    this.useWrap.hidden = true;
    this.dmgDir = new DamageDir(center);

    // pinned by a leaper: the key to mash, which jolts with every press, over how far it has been shoved off
    this.shove = el('div', 'shove', center);
    const shoveRow = el('div', 'shove-row', this.shove);
    this.shoveKey = el('span', 'kbd', shoveRow, '');
    el('span', 'shove-t', shoveRow, 'Mash to shove it off');
    this.shoveFill = el('i', '', el('div', 'shove-bar', this.shove));
    this.shove.hidden = true;

    this.prompt = el('div', 'prompt', center);
    this.promptKey = el('span', 'kbd', this.prompt, 'E');
    this.promptText = el('span', 'prompt-t', this.prompt, '');
    this.prompt.hidden = true;

    this.ctx = el('div', 'ctx scrap', center);
    this.ctx.hidden = true;
    const ch = el('div', 'ctx-head', this.ctx);
    this.ctxIco = el('i', 'ctx-ico', ch);
    this.ctxTitle = el('span', 'ctx-title', ch, '');
    this.ctxVal = el('span', 'ctx-val', ch, '');
    this.ctxBar = el('div', 'ctx-bar', this.ctx);
    this.ctxFill = el('i', '', this.ctxBar);

    // ---- bottom-left vitals
    const vit = (this.vitals = el('div', 'vitals', layer));
    const comms = (this.comms = el('div', 'v-comms', vit)); // the voice speaker list is parked in here too (ui.js)
    this.mic = svgEl('div', 'v-mic', comms, glyph('mic'));
    this.mic.hidden = true;
    this.radio = svgEl('div', 'v-radio', comms, glyph('radio')); // the walkie-talkie in hand (tx: keyed, on the air)
    this.radio.title = 'Walkie-talkie: hold fire to talk to everyone';
    this.radio.hidden = true;
    const hp = (this.hpRow = el('div', 'vrow v-hp', vit));
    this.hpIco = svgEl('i', 'v-ico', hp, glyph('cross'));
    this.hpNum = el('span', 'v-num', hp, '100');
    const stack = el('div', 'v-stack', hp);
    const hpb = el('div', 'v-bar', stack);
    this.hpLag = el('i', 'v-lag', hpb);
    this.hpFill = el('i', 'v-fill', hpb);
    // stamina rides directly under the health bar
    const st = (this.stRow = el('div', 'v-st', stack));
    const stb = el('div', 'v-bar', st);
    this.stFill = el('i', 'v-fill', stb);
    svgEl('i', 'v-ico', st, glyph('bolt'));
    // what the quick keys have left, each beside the bar it fills: healing items (what the heal key would use) by the
    // health bar, red once there are none; energy drinks (the drink key's) under it, by the stamina line, dimmed once
    // there are none. (Their tooltips name the keys: _keys)
    const counts = el('div', 'v-counts', hp);
    this.meds = el('div', 'v-meds', counts);
    svgEl('i', 'v-meds-ico', this.meds, itemIcon(ITEM.MEDKIT));
    this.medsNum = el('span', 'v-meds-n', this.meds, '0');
    this.drinks = el('div', 'v-meds v-drinks', counts);
    svgEl('i', 'v-meds-ico', this.drinks, itemIcon(ITEM.ENERGY_DRINK));
    this.drinksNum = el('span', 'v-meds-n', this.drinks, '0');
    this.ecg = svgEl(
      'i',
      'v-ecg',
      hp,
      '<svg viewBox="0 0 60 20" aria-hidden="true"><path pathLength="100" d="M0 11H14L17 6L21 16L25 1.5L29 18L32 9L34 11H60"/></svg>',
    );
    const ar = (this.arRow = el('div', 'vrow v-ar', vit));
    svgEl('i', 'v-ico', ar, glyph('shield'));
    this.arNum = el('span', 'v-num', ar, '0');
    const arb = el('div', 'v-bar', ar);
    this.arFill = el('i', 'v-fill', arb);
    this.arRow.hidden = true;
    const fl = (this.flRow = el('div', 'v-flash', vit));
    this.flBeam = svgEl('i', 'fl-beam', fl, glyph('flashlight'));
    const batt = el('span', 'batt', fl);
    this.flLvl = el('i', 'batt-lvl', batt);
    el('i', 'batt-nub', batt);
    this.flTxt = el('span', 'fl-txt', fl, '100%');

    // ---- bottom-right weapons
    const wp = (this.weap = el('div', 'weap', layer));
    const slots = el('div', 'slots', wp);
    this.slotEls = SLOT_LABELS.map((lab, i) => {
      const row = el('div', 'slot empty', slots);
      const ico = el('i', 'slot-ico', row);
      const name = el('span', 'slot-name', row, '');
      const cnt = el('span', 'slot-cnt', row, '');
      const key = el('span', 'slot-key', row, '');
      return { row, ico, name, cnt, key, item: -1 };
    });
    const am = (this.ammo = el('div', 'ammo', wp));
    const wn = el('div', 'w-head', am);
    this.wIco = el('i', 'w-ico', wn);
    // the drop key held: a ring filling up to the weapon going down (game/drophold.js), or, let go too soon, how
    this.wDrop = el('span', 'w-drop', wn);
    this.wDrop.hidden = true;
    el('i', 'w-drop-ring', this.wDrop);
    this.wDropT = el('span', 'w-drop-t', this.wDrop, '');
    this.wName = el('span', 'w-name', wn, '');
    const ar2 = (this.ammoRow = el('div', 'ammo-row', am));
    this.aMag = el('span', 'a-mag', ar2, '0');
    this.aSep = el('span', 'a-sep', ar2, '/');
    this.aRes = el('span', 'a-res', ar2, '0');
    // the magazine, one pip per round (--n rounds, --m of them lit); it fills back up while reloading
    this.aPips = el('div', 'a-pips', am);
    el('i', '', this.aPips);
    this.aPips.hidden = true;
    this.aType = el('div', 'a-type', am, '');

    // ---- downed overlay
    this.downed = new Downed(layer);

    // ---- zombie ability panel
    const zp = (this.zpanel = el('div', 'zpanel', layer));
    svgEl('i', 'z-ico', zp, glyph('claw'));
    const zt = el('div', 'z-txt', zp);
    el('div', 'z-title', zt, 'Infected');
    el('div', 'z-sub', zt, 'Hunt the survivors');
    const zl = el('div', 'z-leap', zp);
    el('span', 'z-leap-l', zl, 'Leap');
    const zlb = el('div', 'z-leap-bar', zl);
    this.zLeapFill = el('i', '', zlb);
    this.zLeapTxt = el('span', 'z-leap-t', zl, 'Ready');

    this._keys();
    onBindsChange(() => this._keys());
  }

  // what names a key here: the weapon slots' key caps, what the heal key would use
  _keys() {
    this.slotEls.forEach((s, i) => (s.key.textContent = bindLabel('slot' + (i + 1)).replace('unbound', '–')));
    this.meds.title = `Healing items ${bindTag('heal')}`;
    this.drinks.title = `Energy drinks ${bindTag('drink')}`;
    this.c.dh = undefined;
  }

  // ------------------------------------------------------------ per-frame
  update(h) {
    const c = this.c;
    const zombie = !!h.zombie;

    if (c.zombie !== zombie) {
      c.zombie = zombie;
      this.ui.root.classList.toggle('is-zombie', zombie);
      this.hpIco.innerHTML = glyph(zombie ? 'claw' : 'cross');
      c.lowhp = undefined;
    }

    // ----- night factor (subtle HUD dimming)
    const nq = Math.round(clamp(h.night || 0, 0, 1) * 10) / 10;
    if (c.night !== nq) {
      c.night = nq;
      this.root.style.setProperty('--night', nq);
    }

    this._clock(h);
    this._boss(h.boss);
    this._vitals(h, zombie);
    if (zombie) this._zombie(h);
    else this._weapons(h);
    this._center(h);
    this._info(h);
    this.compass.update(h.yaw || 0, h.compassMarks || []);
    this.minimap.setVisible(!!h.minimap);
    if (h.minimap) this.minimap.update(this.ui.map, h.minimap);
    this.objective.update(zombie ? null : h.objective);
    const showObj = !zombie && !!h.objective;
    if (c.objShow !== showObj) {
      c.objShow = showObj;
      this.objective.root.hidden = !showObj;
    }
    this.objective.syncTip();
    this.tracked.update(zombie ? null : h.tracked || null);
    this.markers.update(h.worldMarks || []);
    this.downed.update(h.downed || null);
  }

  _clock(h) {
    const c = this.c;
    const phase = h.phase;
    const tl = Math.max(0, Math.ceil(h.timeLeft || 0));
    const day = h.day | 0;
    let state;
    if (phase === PHASE.NIGHT) state = 'night';
    else if (phase === PHASE.DAY) state = tl <= DUSK_WARNING ? 'warn' : 'day';
    else if (phase === PHASE.GAMEOVER || phase === PHASE.VICTORY) state = 'end';
    else state = 'wait';

    const clkCls = 'clock is-' + state + (h.finale ? ' is-finale' : '');
    if (c.clkState !== clkCls) {
      c.clkState = clkCls;
      this.clock.className = clkCls;
      c.clkTitle = c.clkLabel = c.clkTime = undefined;
    }

    let title, label, time;
    if (h.finale) {
      // a stalled warm-up keeps its time on show: it stopped there, it did not start over. (A title that fits one
      // line: a second one pushes the horde counter down into the kill feed.)
      const plane = ACT_NOW === WORLD.MAINLAND;
      title = h.escapeReady ? (h.runwayBlocked ? 'Clear the runway!' : W.getIn) : h.escapeStalled ? 'Stalled' : plane ? 'Runway stand' : 'Final stand';
      label = h.escapeReady ? (h.runwayBlocked ? 'The dead are in its way' : h.escapeLeaving ? 'Someone is getting in' : plane ? 'The engines are running' : 'The engine is running') : h.escapeStalled ? (plane && !h.standWarm ? 'Get back to the fuel truck' : `Get back to the ${W.thing}`) : plane ? (h.standWarm ? 'Engines warm in' : 'Tanks full in') : 'Engine ready in';
      time = h.escapeReady ? '' : fmtTime(h.escapeT);
    } else if (state === 'night') {
      title = 'Night ' + day;
      label = (h.waves ? 'Wave ' + h.wave + '/' + h.waves + ' · ' : '') + 'dawn in';
      time = fmtTime(tl);
    } else if (state === 'warn') {
      title = 'Day ' + day;
      label = 'The horde is coming';
      time = fmtTime(tl);
    } else if (state === 'day') {
      title = 'Day ' + day;
      label = 'Nightfall in';
      time = fmtTime(tl);
    } else if (state === 'wait') {
      title = 'The calm';
      label = 'Waiting for survivors';
      time = '';
    } else {
      title = day ? 'Night ' + day : '';
      label = '';
      time = '';
    }
    if (c.clkTitle !== title) this.clkTitle.textContent = c.clkTitle = title;
    if (c.clkLabel !== label) this.clkLabel.textContent = c.clkLabel = label;
    if (c.clkTime !== time) this.clkTime.textContent = c.clkTime = time;

    const remain = (state === 'night' || h.finale) && h.hordeLeft >= 0 ? h.hordeLeft | 0 : -1;
    if (c.remain !== remain) {
      c.remain = remain;
      this.clkRemain.hidden = remain < 0;
      if (remain >= 0) this.clkRemainN.textContent = String(remain);
    }

    // arc progress through the current phase
    let len = phase === PHASE.NIGHT ? NIGHT_LENGTH : dayLength(day);
    if (h.timeLeft > len) len = h.timeLeft;
    let p = phase === PHASE.DAY || phase === PHASE.NIGHT ? 1 - (h.timeLeft || 0) / len : 0;
    p = Math.round(clamp(p, 0, 1) * 600) / 600;
    if (c.clkP !== p) {
      c.clkP = p;
      this.clkProg.style.strokeDashoffset = (100 - p * 100).toFixed(2);
      const a = Math.PI * p;
      const x = ARC.cx - ARC.rx * Math.cos(a);
      const y = ARC.cy - ARC.ry * Math.sin(a);
      this.clkBody.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    }
  }

  _boss(b) {
    const c = this.c;
    const show = !!b;
    if (c.bossShow !== show) {
      c.bossShow = show;
      this.boss.hidden = !show;
      this.ui.root.classList.toggle('has-boss', show);
    }
    if (!b) return;
    if (c.bossName !== b.name) this.bossName.textContent = c.bossName = b.name || '';
    const hp = Math.round(clamp(b.hp, 0, 1) * 1000) / 1000;
    if (c.bossHp !== hp) {
      c.bossHp = hp;
      this.bossFill.style.transform = `scaleX(${hp})`;
      this.bossLag.style.transform = `scaleX(${hp})`;
    }
  }

  _vitals(h, zombie) {
    const c = this.c;
    const maxHp = h.maxHp || 100;
    const hp = Math.max(0, Math.ceil(h.hp || 0));
    if (c.hp !== hp) {
      // a hit or a heal kicks the number; the 1 hp ticks of regeneration stay quiet
      const d = c.hp === undefined || c.hpZ !== zombie ? 0 : hp - c.hp;
      c.hp = hp;
      c.hpZ = zombie;
      this.hpNum.textContent = String(hp);
      if (d < 0 || d > 1) {
        const col = d < 0 ? '#ff5446' : '#b6d08a';
        this.hpNum.animate([{ color: col, transform: `scale(${d < 0 ? 1.14 : 1.08})` }, { color: col, offset: 0.35 }, { transform: 'scale(1)' }], { duration: d < 0 ? 380 : 560, easing: 'ease-out' });
      }
    }
    const hr = Math.round(clamp((h.hp || 0) / maxHp, 0, 1) * 400) / 400;
    if (c.hpR !== hr) {
      c.hpR = hr;
      this.hpFill.style.transform = `scaleX(${hr})`;
      this.hpLag.style.transform = `scaleX(${hr})`;
    }
    const low = !zombie && hp > 0 && hp < 30;
    if (c.lowhp !== low) {
      c.lowhp = low;
      this.ui.root.classList.toggle('low-hp', low);
    }

    const meds = h.heals | 0;
    if (c.meds !== meds) {
      const kick = c.meds !== undefined;
      c.meds = meds;
      this.medsNum.textContent = String(meds);
      this.meds.classList.toggle('out', meds === 0);
      if (kick) this.meds.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
    }
    const drinks = h.drinks | 0;
    if (c.drinks !== drinks) {
      const kick = c.drinks !== undefined;
      c.drinks = drinks;
      this.drinksNum.textContent = String(drinks);
      this.drinks.classList.toggle('none', drinks === 0);
      if (kick) this.drinks.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
    }

    const armorMax = h.armorMax || 0;
    const armor = Math.max(0, Math.ceil(h.armor || 0));
    const showAr = !zombie && armorMax > 0;
    if (c.arShow !== showAr) {
      c.arShow = showAr;
      this.arRow.hidden = !showAr;
    }
    if (showAr) {
      if (c.ar !== armor) this.arNum.textContent = String((c.ar = armor));
      const r = Math.round(clamp(armor / armorMax, 0, 1) * 300) / 300;
      if (c.arR !== r) {
        c.arR = r;
        this.arFill.style.transform = `scaleX(${r})`;
      }
    }

    const sr = Math.round(clamp((h.stamina || 0) / 100, 0, 1) * 300) / 300;
    if (c.st !== sr) {
      c.st = sr;
      this.stFill.style.transform = `scaleX(${sr})`;
    }
    const ex = !!h.exhausted;
    if (c.ex !== ex) {
      c.ex = ex;
      this.stRow.classList.toggle('exhausted', ex);
    }

    const fl = Math.round(clamp(h.flashlight || 0, 0, 100));
    if (c.fl !== fl) {
      c.fl = fl;
      this.flLvl.style.transform = `scaleX(${fl / 100})`;
      this.flTxt.textContent = fl + '%';
      this.flRow.classList.toggle('low', fl <= 15);
    }
    const on = !!h.flashlightOn;
    if (c.flOn !== on) {
      c.flOn = on;
      this.flRow.classList.toggle('on', on);
    }
  }

  _weapons(h) {
    const c = this.c;
    const weapons = h.weapons || [];
    const slot = h.slot | 0;
    if (c.slot !== slot) {
      if (c.slot !== undefined) {
        this.weap.classList.add('recent');
        clearTimeout(this._recentT);
        this._recentT = setTimeout(() => this.weap.classList.remove('recent'), 2200);
      }
      c.slot = slot;
      this.slotEls.forEach((s, i) => s.row.classList.toggle('active', i === slot));
    }
    for (let i = 0; i < SLOT_LABELS.length; i++) {
      const s = this.slotEls[i];
      const id = i === 3 ? h.throwItem || weapons[3] || 0 : weapons[i] || 0;
      if (s.item !== id) {
        s.item = id;
        s.row.classList.toggle('empty', !id);
        s.ico.innerHTML = id ? itemIcon(id) : '';
        s.name.textContent = id ? ITEM_DEFS[id]?.name || '' : SLOT_LABELS[i];
      }
      if (i === 3) {
        const tc = id ? h.throwCount | 0 : 0;
        if (c.tc !== tc) {
          c.tc = tc;
          s.cnt.textContent = tc > 1 ? '×' + tc : '';
        }
      }
    }

    // active weapon block
    // (manning the mounted gun: it stands in for the weapon in the hands, its belt for the magazine)
    const id = h.mounted ? MOUNTED_GUN : slot === 3 ? h.throwItem || weapons[3] || 0 : weapons[slot] || 0;
    if (c.wId !== id) {
      const wasId = c.wId;
      c.wId = id;
      this.wName.textContent = h.mounted ? GUN.name : id ? ITEM_DEFS[id]?.name || '' : 'Unarmed';
      this.wIco.innerHTML = id ? itemIcon(id) : '';
      const w = h.mounted ? GUN : WEAPONS[id];
      c.aTypeStr = w && !w.melee ? AMMO_NAMES[w.ammo] : '';
      c.magMax = w && w.mag ? w.mag : 0;
      c.magEach = !!(w && w.reloadEach);
      c.mag = c.res = c.ammoMode = c.pipM = undefined;
      if (wasId !== undefined) this.ammo.animate([{ opacity: 0.3, transform: 'translateX(8px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
    }
    let mode;
    if (slot === 3 && id && !h.mounted) mode = 'throw';
    else if (slot === RADIO && id && !h.mounted) mode = 'radio'; // (no rounds: how to use it, under its name)
    else if (h.mag == null) mode = 'none';
    else mode = 'gun';
    if (c.ammoMode !== mode) {
      c.ammoMode = mode;
      this.ammoRow.hidden = mode === 'none' || mode === 'radio';
      this.aSep.hidden = this.aRes.hidden = mode === 'throw';
      this.aType.hidden = mode !== 'gun' && mode !== 'radio';
      const pips = mode === 'gun' && c.magMax > 0;
      this.aPips.hidden = !pips;
      if (pips) {
        this.aPips.style.setProperty('--n', c.magMax);
        this.aPips.classList.toggle('dense', c.magMax > 60); // too many rounds to tell apart: a plain gauge
      }
      c.mag = c.res = c.pipM = undefined;
    }
    if (mode === 'throw') {
      const tc = h.throwCount | 0;
      if (c.mag !== 'x' + tc) {
        c.mag = 'x' + tc;
        this.aMag.textContent = '×' + tc;
        this.aMag.classList.remove('low', 'out');
      }
    } else if (mode === 'gun') {
      const mag = h.mag | 0;
      const res = h.reserve == null ? -1 : h.reserve | 0;
      if (c.mag !== mag) {
        c.mag = mag;
        this.aMag.textContent = String(mag);
        const lowT = Math.max(1, Math.ceil(c.magMax * 0.25));
        const low = mag > 0 && mag <= lowT && mag < c.magMax; // a full single-shot is not low
        this.aMag.classList.toggle('low', low);
        this.aMag.classList.toggle('out', mag === 0);
        this.aPips.classList.toggle('low', low);
      }
      if (c.res !== res) {
        c.res = res;
        this.aRes.textContent = res < 0 ? '∞' : String(res);
        this.aRes.classList.toggle('out', res === 0);
      }
    }
    const rl = mode === 'gun' && h.reloading >= 0 ? Math.round(clamp(h.reloading, 0, 1) * 200) / 200 : -1;
    if (c.rl !== rl) {
      if ((rl >= 0) !== (c.rl >= 0)) this.ammo.classList.toggle('reloading', rl >= 0);
      c.rl = rl;
    }
    // the drop key: held, the ring fills; let go too soon, "Hold G to drop" for a moment
    const dp = h.dropHold >= 0 ? Math.round(h.dropHold * 40) / 40 : -1;
    const dh = dp < 0 ? h.dropHint || '' : '';
    if (c.dp !== dp || c.dh !== dh) {
      if ((c.dp >= 0 || c.dh) !== (dp >= 0 || !!dh)) this.wDrop.hidden = !(dp >= 0 || dh);
      if (c.dh !== dh || (c.dp >= 0) !== (dp >= 0)) {
        this.wDrop.classList.toggle('tap', !!dh);
        this.wDropT.textContent = '';
        if (dh) {
          el('span', '', this.wDropT, 'Hold ');
          el('span', 'kbd sm', this.wDropT, dh);
          el('span', '', this.wDropT, ' to drop');
        } else this.wDropT.textContent = 'Drop';
      }
      this.wDrop.style.setProperty('--p', Math.max(0, dp));
      c.dp = dp;
      c.dh = dh;
    }
    const lab = rl >= 0 ? 'Reloading' : mode === 'radio' ? (h.radioKeyed ? 'On the air' : 'Hold fire to talk') : c.aTypeStr;
    if (c.aLab !== lab) this.aType.textContent = c.aLab = lab;
    const air = mode === 'radio' && !!h.radioKeyed;
    if (c.air !== air) this.ammo.classList.toggle('on-air', (c.air = air));
    if (mode === 'gun') {
      // lit pips: the rounds in the magazine, plus the ones sliding in as a reload runs (one shell at a
      // time for a shotgun, never more than the reserve holds)
      let m = c.mag;
      if (rl >= 0) m += rl * (c.magEach ? 1 : Math.max(0, Math.min(c.magMax, c.mag + (c.res < 0 ? c.magMax : c.res)) - c.mag));
      m = Math.round(Math.min(c.magMax, m) * 20) / 20;
      if (c.pipM !== m) this.aPips.style.setProperty('--m', (c.pipM = m));
    }
  }

  _zombie(h) {
    const c = this.c;
    const a = Math.round(clamp(h.ability == null ? 1 : h.ability, 0, 1) * 200) / 200;
    if (c.zAb !== a) {
      c.zAb = a;
      this.zLeapFill.style.transform = `scaleX(${a})`;
      const ready = a >= 1;
      if (c.zReady !== ready) {
        c.zReady = ready;
        this.zpanel.classList.toggle('ready', ready);
        this.zLeapTxt.textContent = ready ? 'Ready' : '';
      }
    }
  }

  _center(h) {
    const c = this.c;
    const xh = h.crosshair || { spread: 6, visible: true };
    const vis = !!xh.visible && !this.ui.inventoryOpen;
    if (c.xhVis !== vis) {
      c.xhVis = vis;
      this.xh.classList.toggle('off', !vis);
    }
    const g = Math.round(clamp(xh.spread || 0, 0, 200) * 2) / 2;
    if (c.xhG !== g) {
      c.xhG = g;
      this.xh.style.setProperty('--g', g + 'px');
    }

    // interaction prompt
    const pr = h.prompt || null;
    if (c.prompt !== pr) {
      c.prompt = pr;
      if (pr) {
        const { key, text } = parsePrompt(pr);
        this.promptKey.textContent = key;
        this.promptKey.hidden = !key;
        this.promptText.textContent = text;
      }
      this.prompt.hidden = !pr;
    }

    // use progress ring
    const up = h.useProgress >= 0 ? Math.round(clamp(h.useProgress, 0, 1) * 200) / 200 : -1;
    if (c.use !== up) {
      if ((up >= 0) !== (c.use >= 0)) this.useWrap.hidden = up < 0;
      c.use = up;
      if (up >= 0) this.useFg.style.strokeDashoffset = (100 - up * 100).toFixed(1);
    }
    const ul = up >= 0 ? h.useLabel || '' : '';
    if (c.useL !== ul) this.useLabel.textContent = c.useL = ul;

    // shove meter (pinned by a leaper)
    const sv = h.shove >= 0 ? Math.round(clamp(h.shove, 0, 1) * 100) / 100 : -1;
    if (c.shove !== sv) {
      if ((sv >= 0) !== (c.shove >= 0)) {
        this.shove.hidden = sv < 0;
        if (sv >= 0) replay(this.shove, 'in');
      }
      c.shove = sv;
      if (sv >= 0) this.shoveFill.style.transform = `scaleX(${sv})`;
    }
    if (c.shoveKey !== h.shoveKey) this.shoveKey.textContent = c.shoveKey = h.shoveKey;
    if (c.shoves !== h.shoves) {
      c.shoves = h.shoves;
      if (sv >= 0) replay(this.shoveKey, 'hit');
    }

    this._context(h.context);
  }

  _context(ctx) {
    const c = this.c;
    const type = ctx ? ctx.type : null;
    if (c.ctxType !== type) {
      c.ctxType = type;
      c.ctxA = c.ctxB = c.ctxC = undefined;
      this.ctx.hidden = !type;
      this.ctx.className = 'ctx scrap' + (type ? ' ctx-' + type : '');
      if (type === 'campfire') {
        this.ctxIco.innerHTML = glyph('campfire');
        this.ctxTitle.textContent = 'Campfire';
      } else if (type === 'structure') {
        this.ctxIco.innerHTML = glyph('hammer');
      } else if (type === 'fair') {
        this.ctxIco.innerHTML = glyph('fuel');
        this.ctxTitle.textContent = 'Fair generator';
      }
    }
    if (!ctx) return;
    if (type === 'campfire') {
      const fuel = Math.max(0, Math.ceil(ctx.fuel || 0));
      if (c.ctxA !== fuel) {
        c.ctxA = fuel;
        this.ctxVal.textContent = fuel > 0 ? fmtTime(fuel) : 'Out';
        const r = Math.round(clamp(fuel / (ctx.max || 1), 0, 1) * 300) / 300;
        this.ctxFill.style.transform = `scaleX(${r})`;
        this.ctx.classList.toggle('warn', fuel > 0 && r < 0.2);
        this.ctx.classList.toggle('dead', fuel <= 0);
      }
    } else if (type === 'structure') {
      if (c.ctxB !== ctx.name) this.ctxTitle.textContent = c.ctxB = ctx.name || 'Structure';
      const r = Math.round(clamp(ctx.hp, 0, 1) * 100) / 100;
      if (c.ctxA !== r) {
        c.ctxA = r;
        this.ctxVal.textContent = Math.round(r * 100) + '%';
        this.ctxFill.style.transform = `scaleX(${r})`;
        this.ctx.classList.toggle('warn', r < 0.35);
      }
    } else if (type === 'fair') {
      // the Tri-County Fair's generator (client/game/fair.js): running or not, and the fuel in its tank
      const fuel = Math.max(0, Math.ceil(ctx.fuel || 0));
      const key = ctx.running ? fuel : -1 - fuel;
      if (c.ctxA !== key) {
        c.ctxA = key;
        this.ctxVal.textContent = ctx.running ? 'Running · ' + fmtTime(fuel) : fuel > 0 ? 'Off · ' + fmtTime(fuel) : 'Off';
        this.ctxFill.style.transform = `scaleX(${Math.round(clamp(fuel / (ctx.max || 1), 0, 1) * 300) / 300})`;
        this.ctx.classList.toggle('warn', ctx.running && fuel < 30);
        this.ctx.classList.toggle('dead', !ctx.running);
      }
    }
  }

  _info(h) {
    const c = this.c;
    const p = h.players;
    const surv = p ? p.alive + '/' + p.total : '';
    if (c.surv !== surv) {
      c.surv = surv;
      this.iSurvT.textContent = surv;
      this.iSurv.hidden = !surv;
    }
    // (stalled: the link has gone quiet, and nothing done until it is back reaches the server)
    const ping = h.ping == null ? '' : h.stalled ? 'no signal' : Math.round(h.ping) + ' ms';
    if (c.ping !== ping) {
      c.ping = ping;
      this.iPingT.textContent = ping;
      this.iPing.hidden = !ping;
      this.iPing.classList.toggle('bad', !!h.stalled || h.ping > 150);
    }
    const showFps = !!this.ui.settings.showFps && !!h.fps;
    const fps = showFps ? Math.round(h.fps) + ' fps' : '';
    if (c.fps !== fps) {
      c.fps = fps;
      this.iFpsT.textContent = fps;
      this.iFps.hidden = !fps;
      this.iFps.classList.toggle('bad', h.fps < 30);
    }
  }

  // ------------------------------------------------------------ events
  hitmarker(headshot, kill) {
    const hm = this.hm;
    hm.classList.toggle('hs', !!headshot);
    hm.classList.toggle('kill', !!kill);
    hm.getAnimations().forEach((a) => a.cancel());
    const s0 = headshot ? 1.5 : 1.15;
    hm.animate(
      [
        { opacity: 1, transform: `translate(-50%,-50%) scale(${s0})` },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.35 },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(1)' },
      ],
      { duration: kill ? 420 : headshot ? 320 : 240, easing: 'ease-out' },
    );
    if (kill) {
      const k = this.killSkull;
      k.classList.toggle('hs', !!headshot);
      k.getAnimations().forEach((a) => a.cancel());
      k.animate(
        [
          { opacity: 0, transform: 'translate(-50%,-50%) scale(1.8)' },
          { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.18 },
          { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.6 },
          { opacity: 0, transform: 'translate(-50%,-62%) scale(.9)' },
        ],
        { duration: 700, easing: 'ease-out' },
      );
    }
  }

  damage(amount, angle) {
    const a = clamp(amount || 0, 0, 100);
    if (a <= 0) return;
    if (angle != null) this.dmgDir.hit(angle, a);
    const peak = clamp(0.28 + a / 45, 0.3, 1);
    this.blood.getAnimations().forEach((x) => x.cancel());
    this.blood.animate([{ opacity: peak }, { opacity: peak * 0.8, offset: 0.2 }, { opacity: 0 }], {
      duration: 700 + a * 16,
      easing: 'ease-out',
    });
    if (a >= 18) {
      const n = a >= 40 ? 2 : 1;
      for (let i = 0; i < n; i++) this._splat(a);
    }
  }

  _splat(a) {
    if (this.splats.childElementCount >= 6) this.splats.firstElementChild.remove();
    const s = document.createElement('div');
    s.className = 'splat';
    s.innerHTML = splatSvg((Math.random() * 4) | 0);
    // bias toward screen edges/corners
    const edge = Math.random();
    let x, y;
    if (edge < 0.5) {
      x = Math.random() < 0.5 ? -4 + Math.random() * 16 : 88 + Math.random() * 16;
      y = Math.random() * 100;
    } else {
      x = Math.random() * 100;
      y = Math.random() < 0.5 ? -6 + Math.random() * 16 : 86 + Math.random() * 18;
    }
    const size = 18 + a * 0.22 + Math.random() * 8;
    s.style.cssText = `left:${x}vw;top:${y}vh;width:${size}vmin;height:${size}vmin;transform:translate(-50%,-50%) rotate(${(Math.random() * 360) | 0}deg)`;
    this.splats.appendChild(s);
    const anim = s.animate(
      [
        { opacity: 0, transform: s.style.transform + ' scale(.6)' },
        { opacity: 0.95, transform: s.style.transform + ' scale(1)', offset: 0.06 },
        { opacity: 0.8, offset: 0.55 },
        { opacity: 0 },
      ],
      { duration: 2600 + a * 20, easing: 'ease-out', fill: 'forwards' },
    );
    anim.onfinish = () => s.remove();
  }
}
