// Survive The Night - DOM user interface.
// Plain DOM + CSS (see ui.css). The game (client/main.js) owns gameplay input, pointer lock,
// I / Tab / Enter handling; this module only handles events on its own DOM (menus, inventory,
// chat input, settings).
import { el } from './dom.js';
import { Hud } from './hud.js';
import { Killfeed, Pickups, Notifier } from './feed.js';
import { Chat } from './chat.js';
import { Inventory } from './inventory.js';
import { BuildMenu } from './build.js';
import { Splash, Pause, Death, EndScreen, Banner, UpdatingModal, VoiceList, ControlsPanel, InvitePanel, DEFAULT_CONTROLS } from './menus.js';
import { SettingsPanel, loadSettings, saveSettings, sanitizeSettings, DEFAULT_SETTINGS } from './settings.js';
import { MapScreen } from './mapscreen.js';
import { Leaderboard } from './leaderboard.js';
import { Bestiary } from './bestiary.js';
import { CardsScreen } from './cards.js';
import { SpawnMenu } from './spawnmenu.js';
import { Roster } from './roster.js';
import { FriendsPanel } from './friends.js';
import { AccountPanel } from './account.js';
import { ProgressPanel } from './progress.js';
import { LoadoutPanel } from './loadout.js';
import { ProfilePanel } from './profile.js';
import { AchievementsPanel, AchievementToasts } from './achievements.js';
import { isFriendName } from '../net/friends.js';
import { onUnlock } from '../net/achievements.js';
import { onSeen } from '../net/bestiary.js';
import { bindLabel } from '../game/binds.js';
import { Summary } from './hud2.js';

const NOOP = () => {};
const CALLBACKS = [
  'onJoin',
  'onCraft',
  'onCraftRepeat',
  'onUseItem',
  'onDropItem',
  'onSplitItem',
  'onDropAmmo', // (calibre, rounds; 0 = all of it): the ammo pouch's popover and menu
  'onUndoDrop', // the inventory's Undo, a few seconds after a drop: the server picks the last one up again
  'onSalvage',
  'onSwapItems',
  'onEquipArmor',
  'onDropWeapon',
  'onUnequip', // (weapon slot, backpack index or 255): a weapon out of its slot into the backpack
  'onWorn', // (which: WORN, what: WORN_DO) the armor or backpack being worn: taken off, dropped or salvaged
  'onSelectStructure', // a structure picked in the build menu's ring
  'onHoverStructure', // ...and pointed at, with a free pointer
  'onSelectThrowable',
  'onCloseInventory',
  'onChatSend',
  'onSettings',
  'onResume',
  'onLeave',
  'onUiSound',
  'onPeers', // () -> { room, players: [{ id, name, account, self }] } while in a game, else null (the friends panel)
  'onAccountName', // (player id) -> the account they are signed in to, '' for a guest
  'onBestiary', // the pause menu's Bestiary button: the game opens it (it frees the pointer)
  'onCards', // the pause menu's Dead Hand row: the game opens the card game's screen (it frees the pointer)
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
    const topLeft = el('div', 'top-left', topL);
    const topCenter = el('div', 'top-center', topL);
    const topRight = el('div', 'top-right', topL);

    this.hud = new Hud(this, hudL, topCenter, topRight, topLeft);
    this.voiceList = new VoiceList(this.hud.comms); // who is talking, beside your own mic over the vitals
    this.kf = new Killfeed(hudL);
    this.pickups = new Pickups(hudL);
    this.chat = new Chat(this, hudL);
    this.build = new BuildMenu(this, hudL);
    this.inventory = new Inventory(this, invL, tipL);
    this.map = new MapScreen(this, ovL);
    this.banner = new Banner(topL);
    this.notifier = new Notifier(topL);
    this.achToasts = new AchievementToasts(this, topL);
    this.summary = new Summary(topL);
    this.death = new Death(this, ovL);
    this.end = new EndScreen(this, ovL);
    this.pause = new Pause(this, ovL);
    // A modal layer lets the same board sit over both the in-game/end overlays and the splash screen.
    this.board = new Leaderboard(this, modalL);
    this.bestiary = new Bestiary(this, modalL);
    this.cards = new CardsScreen(this, modalL); // Dead Hand, the card game (Game.toggleCards)
    this.spawn = new SpawnMenu(this, modalL); // (admins only: Game.toggleSpawn)
    this.roster = new Roster(this, ovL);
    this.splash = new Splash(this, menuL);
    this.settingsPanel = new SettingsPanel(this, modalL);
    this.controlsPanel = new ControlsPanel(this, modalL);
    this.invitePanel = new InvitePanel(this, modalL);
    this.friends = new FriendsPanel(this, modalL);
    this.accountPanel = new AccountPanel(this, modalL);
    this.progress = new ProgressPanel(this, modalL);
    this.loadout = new LoadoutPanel(this, modalL);
    this.profile = new ProfilePanel(this, modalL);
    this.achPanel = new AchievementsPanel(this, modalL);
    this.updating = new UpdatingModal(modalL);
    onUnlock((list) => this.achToasts.show(list));
    onSeen((list) => {
      const key = bindLabel('bestiary');
      const how = key === 'unbound' ? 'It is in the menu.' : `Press ${key} to read up on it.`;
      for (const e of list) this.notify(`New in the bestiary: ${e.name}. ${how}`, 'good', 4.5);
    });

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
    const HOVER = 'button:not(:disabled), .cell:not(.empty), .eq:not(.empty), .br-seg, input[type=range]';
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
    if (this.controlsPanel.visible) this.controlsPanel.hide();
    if (this.invitePanel.visible) this.invitePanel.hide();
    if (this.friends.visible) this.friends.hide();
    if (this.accountPanel.visible) this.accountPanel.hide();
    if (this.progress.visible) this.progress.hide();
    if (this.loadout.visible) this.loadout.hide();
    if (this.profile.visible) this.profile.hide();
    if (this.achPanel.visible) this.achPanel.hide();
    this._menuState();
  }

  setJoinError(text) {
    this.splash.setError(text);
  }

  showPause(show) {
    this.pause.show(show);
  }

  get pauseOpen() {
    return !this.pause.root.hidden;
  }

  // the game we are in ({ code, name, inviteOnly }, or null) and its invite link: on the pause menu and its invite panel
  setRoom(room, link = '') {
    this.pause.setRoom(room, link);
  }

  getSettings() {
    return { ...this.settings };
  }

  // extra: override the controls reference behind the Controls button (splash + pause). list = [[keys, action], ...],
  // or a function that makes one (menus.js renderControls): it is drawn each time the panel opens
  setControls(list) {
    this.controlsPanel.source = typeof list === 'function' || (Array.isArray(list) && list.length) ? list : DEFAULT_CONTROLS;
    if (this.controlsPanel.visible) this.controlsPanel.show();
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

  showSummary(stats, nextText, theme, boss) {
    this.summary.show(stats, nextText, theme, boss);
  }

  setMapOpen(open) {
    this.map.setOpen(open);
  }

  get mapOpen() {
    return this.map.open;
  }

  setBoardOpen(open) {
    this.board.setOpen(open);
  }

  get boardOpen() {
    return this.board.open;
  }

  setBestiaryOpen(open) {
    this.bestiary.setOpen(open);
  }

  get bestiaryOpen() {
    return this.bestiary.open;
  }

  // view: the one to open it on (ui/cards.js CardsScreen.show), null: the one it picks
  setCardsOpen(open, view = null) {
    this.cards.setOpen(open, view);
  }

  get cardsOpen() {
    return this.cards.open;
  }

  setSpawnOpen(open) {
    this.spawn.setOpen(open);
  }

  get spawnOpen() {
    return this.spawn.open;
  }

  // the leaderboard as the server last sent it (shared/protocol.js readBoard); null: not heard from yet
  setBoard(data) {
    this.board.set(data);
  }

  killfeed(e) {
    if (e) this.kf.add(e);
  }

  notify(text, style = 'toast', duration = 3) {
    this.notifier.notify(text, style, duration);
  }

  // drop the title card (and the ones queued behind it), the toasts and the dawn card: the game they belong to is gone
  clearNotices() {
    this.notifier.clear();
    this.summary.root.hidden = true;
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

  // the walkie-talkie in hand; keyed (fire held), the voice reaches every survivor (game/radio.js)
  setRadio(inHand, keyed) {
    const k = (inHand ? 1 : 0) | (keyed ? 2 : 0);
    if (k === this._radioK) return;
    this._radioK = k;
    this.hud.radio.hidden = !inHand;
    this.hud.radio.classList.toggle('tx', !!keyed);
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

  // whether this player in the game is a friend (by the account they are signed in to)
  isFriendId(id) {
    try {
      return isFriendName(this.cb.onAccountName(id) || '');
    } catch {
      return false;
    }
  }

  // the player list [Tab]
  setPlayers(list) {
    this.roster.set(list);
  }

  setRosterOpen(open) {
    this.roster.setOpen(open);
  }

  get rosterOpen() {
    return this.roster.open;
  }

  // pinned up with the pointer free, to click a player for their profile (closing the list lets go of it too)
  setRosterPinned(pin) {
    this.roster.setPinned(pin);
  }

  get rosterPinned() {
    return this.roster.pinned;
  }

  setBuildMenu(state) {
    this.build.set(state);
  }

  // ------------------------------------------------------------ overlays
  showDeath(info) {
    if (!this.end.root.hidden) return; // the run is over and its end screen is up: that is the title to read
    this.death.show(info || {});
  }

  // The death that ends a run arrives with the end of the run (one server tick), and the end screen takes 1.6 s to
  // fade in over whatever is under it: take the death card down first, or the two titles are drawn on top of each other.
  showGameOver(stats) {
    this.death.hide();
    this.end.show('gameover', stats || {});
    this._menuState();
  }

  showVictory(stats) {
    this.death.hide();
    this.end.show('victory', stats || {});
    this._menuState();
  }

  // our XP as the server counts it ({ xp, run, loaded, kept }: Game.onProgress): the inventory's level, and the end
  // screen if the run is over
  setProgress(p) {
    this.inventory.setProgress(p);
    if (!this.end.root.hidden) this.end.setXp(p);
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

  // the page is reloading for a deploy's new client and going back into the game by itself
  showUpdating(on) {
    this.updating.show(on);
    this.root.classList.toggle('updating-on', !!on);
  }
}

export default UI;
