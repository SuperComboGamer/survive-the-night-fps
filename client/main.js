// Client bootstrap: wires the UI, audio engine, renderer and game together and runs the frame loop.
import './render/globals.js'; // must run before any material is created (global fog + shared uniforms)
import { GameRenderer } from './render/renderer.js';
import { UI } from './ui/ui.js';
import { DEFAULT_SETTINGS } from './ui/settings.js';
import { AudioEngine } from './audio/audio.js';
import { Game } from './game/game.js';
import { setMaxAnisotropy } from './render/textures.js';
import { setMaxAnisotropy as setCharAnisotropy } from './render/models/charTextures.js';

let game = null;
let joining = false;
const audio = new AudioEngine();

const callbacks = {
  async onJoin(name) {
    if (joining || !game) return;
    joining = true;
    try {
      await audio.init();
      applyAudioSettings(ui.getSettings());
      await game.join(name);
      ui.hideSplash();
      document.activeElement?.blur?.(); // the name field must not keep eating gameplay keys
    } catch (err) {
      console.error(err);
      ui.setJoinError(err.message || 'Could not join');
    } finally {
      joining = false;
    }
  },
  onCraft: (id) => game?.uiCallbacks().onCraft(id),
  onCraftRepeat: (id, n) => game?.uiCallbacks().onCraftRepeat(id, n),
  onUseItem: (i) => game?.uiCallbacks().onUseItem(i),
  onDropItem: (i, n) => game?.uiCallbacks().onDropItem(i, n),
  onSwapItems: (a, b) => game?.uiCallbacks().onSwapItems(a, b),
  onEquipArmor: (i) => game?.uiCallbacks().onEquipArmor(i),
  onDropWeapon: (s) => game?.uiCallbacks().onDropWeapon(s),
  onSelectStructure: (t) => game?.uiCallbacks().onSelectStructure(t),
  onSelectThrowable: (it) => game?.uiCallbacks().onSelectThrowable(it),
  onCloseInventory: () => game?.uiCallbacks().onCloseInventory(),
  onChatSend: (text) => {
    game?.uiCallbacks().onChatSend(text);
    if (game && game.state === 'playing') {
      game.input.enabled = !ui.inventoryOpen;
      game.input.requestLock();
    }
  },
  onSettings: (s) => applySettings(s),
  onResume: () => {
    if (!game) return;
    ui.showPause(false);
    game.input.enabled = true;
    game.input.requestLock();
  },
  onLeave: () => {
    game?.leave();
  },
  onUiSound: (name) => audio.ready && audio.playLocal(name, { volume: 0.5 }),
};

const ui = new UI(document.getElementById('ui'), callbacks);
ui.setControls([
  ['WASD', 'Move'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump / vault barricades & windows'],
  ['Ctrl / C', 'Crouch (stealth)'],
  ['LMB / RMB', 'Fire · Aim / heavy attack'],
  ['1 2 3 4 5', 'Primary · Pistol · Melee · Throwable · Build'],
  ['Q / Wheel', 'Last weapon / cycle (build: Q / E cycle structure)'],
  ['R', 'Reload'],
  ['E', 'Interact · hold: search, revive, start the car'],
  ['Melee', 'Hit trees for wood, wrecks for scrap'],
  ['Z / MMB', 'Ping (go · danger · loot)'],
  ['M', 'Field map'],
  ['F', 'Flashlight'],
  ['H', 'Quick heal'],
  ['Tab', 'Inventory & crafting'],
  ['Enter · V', 'Chat · push-to-talk'],
  ['X', 'Demolish (build mode)'],
]);
const settings = ui.getSettings();
const renderer = new GameRenderer(document.getElementById('game'), settings.quality || 'medium');
setMaxAnisotropy(Math.min(8, renderer.renderer.capabilities.getMaxAnisotropy()));
setCharAnisotropy(Math.min(8, renderer.renderer.capabilities.getMaxAnisotropy()));
game = new Game({ renderer, ui, audio, settings });
applySettings(settings);
ui.showSplash();

function applyAudioSettings(s) {
  if (!audio.ready) return;
  // "Music & ambience": the slider's default leaves the ambience mix as it was tuned; below that it fades out with the music
  const ambience = Math.min(1, s.musicVolume / DEFAULT_SETTINGS.musicVolume);
  audio.setVolumes({ master: s.masterVolume, music: s.musicVolume, ambience, sfx: s.sfxVolume, voice: s.voiceVolume });
}

function applySettings(s) {
  game.settings = s;
  renderer.setQuality(s.quality || 'medium');
  renderer.setRenderScale(s.renderScale ?? 1);
  renderer.setFov(s.fov || 75);
  game.input.sensitivity = s.sensitivity || 1;
  game.input.invertY = !!s.invertY;
  game.input.rawInput = s.rawMouse !== false;
  game.voice.setVolume(s.voiceVolume ?? 1);
  game.foliage?.setQuality(renderer.q);
  game.weatherFx?.setQuality(renderer.quality);
  game.lights.setShadows(renderer.q.flashShadows);
  game.env.setShadows(renderer.q);
  game.setShadowQuality?.(renderer.q);
  game.prewarm(); // (does nothing unless the quality changed)
  applyAudioSettings(s);
}

// build the world behind the splash screen as soon as we know the server's seed
async function preload() {
  try {
    const res = await fetch('/status', { cache: 'no-store' });
    const st = await res.json();
    if (typeof st.seed === 'number' && game.state === 'menu') game.loadWorld(st.seed);
  } catch {
    // server offline: the UI shows it; build a placeholder world so the menu has a backdrop
    if (!game.world) game.loadWorld(1337);
  }
}
preload();

// ---------------------------------------------------------------- frame loop
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt <= 0) return;
  // average fps over ~1s of real frame times (before the sim clamp); a >1s gap means
  // the tab was hidden, so restart the window instead of reporting ~0 fps
  if (dt > 1) {
    fpsAcc = 0;
    fpsFrames = 0;
  } else {
    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc >= 1) {
      game.fps = Math.round(fpsFrames / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }
  }
  if (dt > 0.1) dt = 0.1;
  const t0 = performance.now();
  try {
    game.update(dt);
  } catch (err) {
    console.error('update error', err);
  }
  const t1 = performance.now();
  // (nothing is drawn while the scene's shader programs are being built in the background: Game.prewarm)
  if (game.post && !game.warm?.hold) renderer.render(game.post, game.state === 'playing');
  const t2 = performance.now();
  game.cpuUpdateMs = (game.cpuUpdateMs || 0) * 0.95 + (t1 - t0) * 0.05;
  game.cpuRenderMs = (game.cpuRenderMs || 0) * 0.95 + (t2 - t1) * 0.05;
}
requestAnimationFrame(frame);

// debug handle
window.__game = game;
