// Survive The Night - DOM user interface.
// Plain DOM + CSS (see ui.css). The game (client/main.js) owns gameplay input, pointer lock,
// Tab / Enter handling; this module only handles events on its own DOM (menus, inventory,
// chat input, settings).
import { el } from './dom.js';
import { Hud } from './hud.js';
import { Killfeed, Pickups, Notifier } from './feed.js';
import { Chat } from './chat.js';
import { Inventory } from './inventory.js';
import { BuildMenu } from './build.js';
import { Splash, Pause, Death, EndScreen, Banner, VoiceList, renderControls, DEFAULT_CONTROLS } from './menus.js';
import { SettingsPanel, loadSettings, saveSettings, sanitizeSettings, DEFAULT_SETTINGS } from './settings.js';
import { MapScreen } from './mapscreen.js';
import { Summary } from './hud2.js';

const NOOP = () => {};
const CALLBACKS = [
  'onJoin',
  'onCraft',
  'onUseItem',
  'onDropItem',
  'onSwapItems',
  'onEquipArmor',
  'onDropWeapon',
  'onSelectStructure',
  'onSelectThrowable',
  'onChatSend',
  'onSettings',
  'onResume',
  'onLeave',
  'onUiSound',
];

const SVG_DEFS = `<svg class="stn-defs" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="stn-rough" x="-5%" y="-25%" width="110%" height="150%">
    <feTurbulence type="fractalNoise" baseFrequency="0.04 0.09" numOctaves="2" seed="4" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="stn-rough-lg" x="-5%" y="-25%" width="110%" height="150%">
    <feTurbulence type="fractalNoise" baseFrequency="0.025 0.06" numOctaves="3" seed="9" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</svg>`;

export { DEFAULT_SETTINGS };

export class UI {
  constructor(rootEl, callbacks = {}) {
    this.root = rootEl;
    rootEl.classList.add('stn-ui');
    rootEl.insertAdjacentHTML('afterbegin', SVG_DEFS);
    this.cb = {};
    for (const k of CALLBACKS) this.cb[k] = typeof callbacks[k] === 'function' ? callbacks[k] : NOOP;
    if (typeof callbacks.onChatClosed === 'function') this.cb.onChatClosed = callbacks.onChatClosed;
    this.settings = loadSettings();

    // layers (bottom -> top)
    const hudL = el('div', 'layer layer-hud', rootEl);
    const invL = el('div', 'layer layer-inv', rootEl);
    const topL = el('div', 'layer layer-top', rootEl);
    const ovL = el('div', 'layer layer-ov', rootEl);
    const menuL = el('div', 'layer layer-menu', rootEl);
    const modalL = el('div', 'layer layer-modal', rootEl);
    const tipL = el('div', 'layer layer-tip', rootEl);
    const topCenter = el('div', 'top-center', topL);

    this.hud = new Hud(this, hudL, topCenter);
    this.voiceList = new VoiceList(hudL);
    this.kf = new Killfeed(hudL);
    this.pickups = new Pickups(hudL);
    this.chat = new Chat(this, hudL);
    this.build = new BuildMenu(this, hudL);
    this.inventory = new Inventory(this, invL, tipL);
    this.map = new MapScreen(this, ovL);
    this.banner = new Banner(topL);
    this.notifier = new Notifier(topL);
    this.summary = new Summary(topL);
    this.death = new Death(this, ovL);
    this.end = new EndScreen(this, ovL);
    this.pause = new Pause(this, ovL);
    this.splash = new Splash(this, menuL);
    this.settingsPanel = new SettingsPanel(this, modalL);

    this._bindSounds();
    this._voice = { enabled: false, transmitting: false };
  }

  // ------------------------------------------------------------ internals
  sound(name) {
    try {
      this.cb.onUiSound(name);
    } catch (e) {
      console.error(e);
    }
  }

  _bindSounds() {
    let last = null;
    let lastT = 0;
    const HOVER = 'button:not(:disabled), .cell:not(.empty), .eq:not(.empty), .bc, input[type=range]';
    this.root.addEventListener('pointerover', (e) => {
      const t = e.target.closest?.(HOVER);
      if (t === last) return;
      last = t;
      const now = performance.now();
      if (t && now - lastT > 45) {
        lastT = now;
        this.sound('ui_hover');
      }
    });
    this.root.addEventListener('click', (e) => {
      if (e.target.closest?.('.btn, .btn-icon, .seg-btn, .set-toggle')) this.sound('ui_click');
    });
  }

  _applySettings(s) {
    this.settings = sanitizeSettings(s);
    saveSettings(this.settings);
    this.hud.c.fps = undefined; // re-evaluate fps visibility on next frame
    try {
      this.cb.onSettings({ ...this.settings });
    } catch (e) {
      console.error(e);
    }
  }

  _menuState() {
    const r = this.root.classList;
    r.toggle('splash-on', !this.splash.root.hidden);
    r.toggle('end-on', !this.end.root.hidden);
  }

  // ------------------------------------------------------------ splash / menus
  showSplash() {
    this.splash.show();
    this._menuState();
  }

  hideSplash() {
    this.splash.hide();
    if (this.settingsPanel.visible) this.settingsPanel.hide();
    this._menuState();
  }

  setJoinError(text) {
    this.splash.setError(text);
  }

  showPause(show) {
    this.pause.show(show);
  }

  getSettings() {
    return { ...this.settings };
  }

  // extra: override the controls reference shown on the splash + pause screens. list = [[keys, action], ...]
  setControls(list) {
    const l = Array.isArray(list) && list.length ? list : DEFAULT_CONTROLS;
    renderControls(this.splash.ctlList, l);
    renderControls(this.pause.ctlList, l);
  }

  // ------------------------------------------------------------ per-frame
  updateHud(h) {
    if (h) this.hud.update(h);
  }

  // extra: hide the whole HUD (e.g. photo mode / cutscenes)
  setHudVisible(v) {
    this.root.classList.toggle('hud-hidden', !v);
  }

  // ------------------------------------------------------------ events
  hitmarker(headshot, kill) {
    this.hud.hitmarker(headshot, kill);
  }

  damage(amount, angle) {
    this.hud.damage(amount, angle);
  }

  showSummary(stats, nextText) {
    this.summary.show(stats, nextText);
  }

  setMapOpen(open) {
    this.map.setOpen(open);
  }

  get mapOpen() {
    return this.map.open;
  }

  killfeed(e) {
    if (e) this.kf.add(e);
  }

  notify(text, style = 'toast', duration = 3) {
    this.notifier.notify(text, style, duration);
  }

  pickup(itemId, count) {
    this.pickups.add(itemId, count);
  }

  addChat(name, text, opts = {}) {
    this.chat.add(name, text, opts || {});
  }

  openChat() {
    this.chat.open();
  }

  // extra: programmatically close chat without sending
  closeChat() {
    this.chat.close();
  }

  isTyping() {
    if (this.chat.typing) return true;
    const a = document.activeElement;
    return !!(a && this.root.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.type !== 'range');
  }

  // ------------------------------------------------------------ inventory / crafting
  setInventory(inv) {
    this.inventory.set(inv);
  }

  setInventoryOpen(open) {
    this.inventory.setOpen(open);
  }

  get inventoryOpen() {
    return this.inventory.open;
  }

  setCraftContext(ctx) {
    this.inventory.setCraftContext(ctx);
  }

  setPlayers(list) {
    this.inventory.setPlayers(list);
  }

  // extra: camp status for the inventory screen. info = { fuel?: seconds, max?: seconds, parts?: bitmask }
  // (also filled automatically from updateHud context when the player stands near the fire / car)
  setCamp(info) {
    this.inventory.setCamp(info);
  }

  setBuildMenu(state) {
    this.build.set(state);
  }

  // ------------------------------------------------------------ overlays
  showDeath(info) {
    this.death.show(info || {});
  }

  showGameOver(stats) {
    this.end.show('gameover', stats || {});
    this._menuState();
  }

  showVictory(stats) {
    this.end.show('victory', stats || {});
    this._menuState();
  }

  hideOverlays() {
    this.death.hide();
    this.end.hide();
    this._menuState();
  }

  setVoiceState(v) {
    v = v || {};
    const mic = this.hud.mic;
    const en = !!v.enabled;
    const tx = en && !!v.transmitting;
    if (en !== this._voice.enabled) mic.hidden = !en;
    if (tx !== this._voice.transmitting) mic.classList.toggle('tx', tx);
    this._voice = { enabled: en, transmitting: tx };
    this.voiceList.set(v.speakers || []);
  }

  setConnectionStatus(text) {
    this.banner.set(text || null);
    this.root.classList.toggle('conn-on', !!text);
  }
}

export default UI;
