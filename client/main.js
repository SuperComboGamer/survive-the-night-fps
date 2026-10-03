// Client bootstrap: wires the UI, audio engine, renderer and game together and runs the frame loop.
import './render/globals.js'; // must run before any material is created (global fog + shared uniforms)
import { GameRenderer } from './render/renderer.js';
import { UI } from './ui/ui.js';
import { DEFAULT_SETTINGS } from './ui/settings.js';
import { AudioEngine } from './audio/audio.js';
import { Game } from './game/game.js';
import { playerId } from './net/identity.js';
import { refreshAccount } from './net/account.js';
import { linkedCode, inviteLink, showCodeInAddress, gameInfo, listGames } from './net/lobby.js';
import { setMaxAnisotropy } from './render/textures.js';
import { setMaxAnisotropy as setCharAnisotropy } from './render/models/charTextures.js';

let game = null;
let joining = false;
playerId(); // who this browser is to the leaderboard: made up and stored on the first launch, sent with every join
refreshAccount(); // ...and the account it is signed in to, if any (the cookie goes with every join: the server plays them as it)
const audio = new AudioEngine();

// The browser only lets audio start on a user gesture. The first key or pointer press on the splash is one (typing a
// name) and comes seconds before the click on Join, so the engine starts there: its sound banks take about a second
// to render (in workers) and are then ready when the player joins. Nothing waits for them: see onJoin.
const GESTURES = ['keydown', 'pointerdown', 'pointerup'];
let audioStarted = false;
let joinCue = false; // a join asked for its stinger before the engine could play it
function startAudio() {
  if (audioStarted) return;
  audioStarted = true;
  for (const type of GESTURES) removeEventListener(type, onGesture, true);
  audio
    .init() // creates the context synchronously, inside the gesture
    .then(() => {
      applyAudioSettings(ui.getSettings());
      if (joinCue) audio.stinger('join');
      joinCue = false;
    })
    .catch((err) => console.error('[audio] failed to start', err)); // a game without sound, not a join that fails
}
function onGesture() {
  // not every one of these counts with the browser (Escape, a finger going down): a context created on one that
  // does not would start suspended, so wait for one that does
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  startAudio();
}
for (const type of GESTURES) addEventListener(type, onGesture, true);

const callbacks = {
  // code: the game to go into (an invite, a pick from the list, one just made); '' for a quick join
  async onJoin(name, code = '') {
    if (joining || !game) return;
    joining = true;
    try {
      // The click on Join is a gesture too, so the engine starts here at the latest - but the join does not wait
      // for it. The socket opens at once, and if the banks are still rendering the game is silent until they are
      // done (a sound asked for before that is dropped; ambience and music come in from the state of the moment).
      startAudio();
      // (a browser that did not count the earlier press as a gesture left the context suspended: this click is one)
      const ctx = audio.context;
      if (ctx && ctx.state !== 'running') {
        try {
          ctx.resume()?.catch?.(() => {});
        } catch {}
      }
      joinCue = !audio.ready; // game.join asks for the join stinger; if the engine cannot play it yet, it is owed
      await game.join(name, code);
      ui.hideSplash();
      document.activeElement?.blur?.(); // the name field must not keep eating gameplay keys
      // the game's link: in the address bar (a reload comes back here, and it can be copied from there), on the
      // pause menu, and said once in the chat
      const room = game.room;
      if (room) {
        const link = inviteLink(room.code);
        showCodeInAddress(room.code);
        ui.setRoom(room, link);
        ui.addChat('', `${room.inviteOnly ? 'Invite only' : 'Public'} game ${room.code}. Invite friends with ${link} (Esc to copy it).`, { system: true });
      }
    } catch (err) {
      joinCue = false;
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
  onSplitItem: (i, n) => game?.uiCallbacks().onSplitItem(i, n),
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
    showCodeInAddress(''); // (back on the splash for any game, not this one's invitation)
    ui.setRoom(null);
    game?.leave();
  },
  onUiSound: (name) => audio.ready && audio.playLocal(name, { volume: 0.5 }),
  // the friends panel: who is in this game with us, and the accounts they are signed in to (S2C.FRIENDS)
  onPeers: () => {
    if (!game || game.state !== 'playing') return null;
    const accounts = game.conn.accounts;
    return { room: game.room, players: [...game.players].map(([id, p]) => ({ id, name: p.name, account: accounts.get(id) || '', self: id === game.myId })) };
  },
  onAccountName: (id) => game?.conn.accounts.get(id) || '',
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
  ['L', 'Leaderboard'],
  ['F', 'Flashlight'],
  ['H', 'Quick heal'],
  ['I', 'Inventory & crafting'],
  ['Tab', 'Player list (hold)'],
  ['Y / Enter · V', 'Chat · push-to-talk'],
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
  audio.setVoiceDucking(s.voiceDuck !== false);
}

function applySettings(s) {
  game.settings = s;
  renderer.setQuality(s.quality || 'medium');
  renderer.setRenderScale(s.renderScale ?? 1);
  renderer.setPs1(s.ps1);
  renderer.setFov(s.fov || 75);
  game.input.sensitivity = s.sensitivity || 1;
  game.input.invertY = !!s.invertY;
  game.input.rawInput = s.rawMouse !== false;
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
  // ...but not before the splash has had a frame on screen: the build holds the main thread for seconds, and on a
  // fast link the seed can be here before the first frame is out
  const painted = new Promise((done) => {
    requestAnimationFrame(() => setTimeout(done, 0)); // (a timer set from a frame callback runs after that frame's paint)
    setTimeout(done, 500); // a tab opened in the background gets no frame: build there anyway
  });
  try {
    // the valley of the game Join is likeliest to go into: the invited one, or the one a quick join would pick
    const code = linkedCode();
    const seed = code ? (await gameInfo(code)).seed : (await listGames()).list.find((g) => !g.full)?.seed;
    await painted;
    if (seed && game.state === 'menu') game.loadWorld(seed);
    else if (!game.world) game.loadWorld(1337); // (none running yet: a backdrop, and the join builds its own)
  } catch {
    // server offline: the UI shows it; build a placeholder world so the menu has a backdrop
    await painted;
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
