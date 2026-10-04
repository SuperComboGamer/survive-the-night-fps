// Client bootstrap: wires the UI, audio engine, renderer and game together and runs the frame loop.
import './render/globals.js'; // must run before any material is created (global fog + shared uniforms)
import { GameRenderer } from './render/renderer.js';
import { UI } from './ui/ui.js';
import { DEFAULT_SETTINGS } from './ui/settings.js';
import { AudioEngine } from './audio/audio.js';
import { Game } from './game/game.js';
import { loadBinds, askLayout, bindPair } from './game/binds.js';
import { startBindsSync } from './net/accountbinds.js';
import { keysOf, moveKeys, slotKeys } from './ui/menus.js';
import { playerId } from './net/identity.js';
import { PROTOCOL_VERSION, REJECT_REASON } from '../shared/protocol.js';
import { refreshAccount } from './net/account.js';
import { startAchievementsSync } from './net/achievements.js';
import { linkedCode, inviteLink, showCodeInAddress, gameInfo, listGames } from './net/lobby.js';
import { setMaxAnisotropy } from './render/textures.js';
import { setMaxAnisotropy as setCharAnisotropy } from './render/models/charTextures.js';

let game = null;
let joining = false;
loadBinds(); // the player's keybinds, as this browser keeps them (game/binds.js): before anything names a key
askLayout(); // (and what this keyboard prints on its keys, when the browser says)
startBindsSync(); // ...and kept on their account while they are signed in (net/accountbinds.js)
playerId(); // who this browser is to the leaderboard: made up and stored on the first launch, sent with every join
refreshAccount(); // ...and the account it is signed in to, if any (the cookie goes with every join: the server plays them as it)
startAchievementsSync(); // ...whose achievements this browser's guest ones are merged into on signing in (net/achievements.js)
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

// ---------------------------------------------------------------- back in after a drop
// The server holds a dropped player's place for a minute (server/game.js hold): their body stays where it was, safe,
// and a JOIN from this browser in that time puts them back in it with everything they had. So a drop goes straight
// back in, trying every few seconds for that minute; and a page reopened on the game it was playing (a crash, the tab
// closed by accident) does the same. stn.playing: { code, t } of the game being played, renewed while playing.
const REJOIN_MS = 60_000;
let lastName = '';
let rejoining = false;
async function rejoin(code, name = lastName) {
  if (rejoining || !code || !name) return;
  rejoining = true;
  const until = performance.now() + REJOIN_MS;
  let moved = false; // (this page was loaded again for a deploy's new build: moveBack)
  try {
    moved = sessionStorage.getItem(MOVED_KEY) === '1';
    sessionStorage.removeItem(MOVED_KEY);
  } catch {}
  try {
    while (game.state !== 'playing' && performance.now() < until) {
      ui.setJoinError(`${moved ? 'The game was updated' : 'Connection lost'} - getting you back into game ${code} (${Math.ceil((until - performance.now()) / 1000)} s)...`);
      await callbacks.onJoin(name, code);
      if (game.state === 'playing') return;
      await new Promise((done) => setTimeout(done, 3000));
    }
    if (game.state !== 'playing') {
      ui.showSplash();
      ui.setJoinError('Connection lost, and the game could not be reached in time: your place there is gone.');
    }
  } finally {
    ui.showUpdating(false);
    rejoining = false;
  }
}

// ---------------------------------------------------------------- back in after a deploy
// A deploy hands every game to the next server (server/handoff.js) and closes its sockets with MOVED_CODE. The game
// stays on screen (Game.onMoving) while this joins the same code on the next server, where our body is waiting: at
// once and then a little less often, for a while (the old server may still be taking connections that the edge sends
// it). The game is in the store before our socket is closed, so a next server that says it has no such game three
// times over means it could not bring it back. If the next server runs another build, this page is loaded again
// first (and then goes back in as a reopened page does, below).
const MOVE_MS = 45_000;
const MOVE_NO_GAME = 3;
const BUILD = fetch('/api/version')
  .then((r) => r.json())
  .catch(() => null); // what this page was loaded from
const MOVED_KEY = 'stn.moved';
const UPDATING_READ_MS = 1500; // the "Game updated" modal is up this long over the game before the page reloads
async function reloadInto(code, name) {
  try {
    sessionStorage.setItem(MOVED_KEY, '1');
    localStorage.setItem(PLAYING_KEY, JSON.stringify({ code, name, t: Date.now() })); // (the reloaded page goes back in by it)
  } catch {}
  ui.showUpdating(true);
  await new Promise((done) => setTimeout(done, UPDATING_READ_MS));
  location.reload();
}
async function moveBack(code) {
  const name = lastName;
  const until = performance.now() + MOVE_MS;
  const loadedFrom = await BUILD;
  let noGame = 0;
  for (let wait = 250; game.moving && performance.now() < until && noGame < MOVE_NO_GAME; wait = Math.min(wait * 2, 2000)) {
    const now = await fetch('/api/version', { cache: 'no-store' })
      .then((r) => r.json())
      .catch(() => null);
    if (now && (now.protocol !== PROTOCOL_VERSION || (loadedFrom?.build && now.build !== loadedFrom.build))) return reloadInto(code, name);
    if (now) {
      try {
        await game.join(name, code, { resume: true });
        return;
      } catch (err) {
        // (another build: load it)
        if (err.reason === REJECT_REASON.VERSION) return reloadInto(code, name);
        if (err.reason === REJECT_REASON.NO_GAME) noGame++;
      }
    }
    await new Promise((done) => setTimeout(done, wait));
  }
  if (game.moving) game.onDisconnect(0, 'The server was updated, but your game could not be brought back.');
}

const PLAYING_KEY = 'stn.playing';
setInterval(() => {
  try {
    if (game?.state === 'playing' && game.room) localStorage.setItem(PLAYING_KEY, JSON.stringify({ code: game.room.code, name: lastName, t: Date.now() }));
  } catch {}
}, 5000);
function forgetPlaying() {
  try {
    localStorage.removeItem(PLAYING_KEY);
  } catch {}
}

const callbacks = {
  // code: the game to go into (an invite, a pick from the list, one just made); '' for a quick join
  async onJoin(name, code = '') {
    if (joining || !game) return;
    joining = true;
    lastName = name;
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
        ui.addChat('', `${room.inviteOnly ? 'Invite only' : 'Public'} game ${room.code}. Invite friends with ${link} (press Esc to copy the link).`, { system: true });
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
  onDropAmmo: (cal, n) => game?.uiCallbacks().onDropAmmo(cal, n),
  onSalvage: (from, n) => game?.uiCallbacks().onSalvage(from, n),
  onSwapItems: (a, b) => game?.uiCallbacks().onSwapItems(a, b),
  onEquipArmor: (i) => game?.uiCallbacks().onEquipArmor(i),
  onDropWeapon: (s) => game?.uiCallbacks().onDropWeapon(s),
  onUnequip: (s, to) => game?.uiCallbacks().onUnequip(s, to),
  onWorn: (which, what) => game?.uiCallbacks().onWorn(which, what),
  onSortItems: () => game?.uiCallbacks().onSortItems(),
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
    forgetPlaying();
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
// the full controls list (the Controls button on the splash and the pause menu), from the keybinds as they are when it
// is opened (Settings > Keybinds rebinds them)
ui.setControls(() => [
  [moveKeys(), 'Move'],
  [keysOf('sprint'), 'Sprint'],
  [keysOf('jump'), 'Jump / vault barricades & windows'],
  [keysOf('crouch'), 'Crouch (stealth)'],
  [keysOf('fire'), 'Fire / attack'],
  [keysOf('aim'), 'Aim / heavy attack (hold)'],
  [slotKeys(), 'Primary · Pistol · Melee · Throwable · Build · Walkie-talkie'],
  [[...keysOf('lastWeapon'), 'Wheel'], `Last weapon / cycle (build: ${bindPair('buildPrev')} / ${bindPair('buildNext')} cycle structure)`],
  [keysOf('reload'), 'Reload'],
  [keysOf('interact'), 'Interact · hold: search, revive, start the car'],
  ['Melee', 'Hit trees for wood, wrecks for scrap'],
  [keysOf('ping'), 'Ping (go · danger · loot)'],
  [keysOf('map'), 'Field map'],
  [keysOf('board'), 'Leaderboard'],
  [keysOf('flashlight'), 'Flashlight'],
  [keysOf('heal'), 'Quick heal'],
  [keysOf('drink'), 'Energy drink (refills stamina)'],
  [keysOf('inventory'), 'Inventory & crafting'],
  [keysOf('players'), 'Player list (hold)'],
  [keysOf('chat'), 'Chat'],
  [keysOf('talk'), 'Push to talk'],
  [keysOf('slot6'), 'Walkie-talkie: hold fire to talk to everyone, chat with it out reaches everyone'],
  [keysOf('drop'), 'Drop weapon (hold)'],
  [keysOf('demolish'), 'Demolish (build mode)'],
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
  renderer.setPs1(s.ps1, s.ps1Strength);
  renderer.setFov(s.fov || 75);
  game.input.sensitivity = s.sensitivity || 1;
  game.input.invertY = !!s.invertY;
  game.input.rawInput = s.rawMouse !== false;
  game.keyGuard.fullscreen = s.fullscreen !== false;
  game.foliage?.setQuality(renderer.q, s.grassDistance);
  game.weatherFx?.setQuality(renderer.quality);
  game.lights.setShadows(renderer.q.flashShadows, renderer.q.shadows);
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

// a page reopened on the game it was playing a moment ago (crash, tab closed): back in while the server holds the place
game.onDrop = (code) => rejoin(code);
game.onMove = (code) => moveBack(code); // (a deploy: the game moved to the next server)
try {
  const was = JSON.parse(localStorage.getItem(PLAYING_KEY) || 'null');
  if (was && was.code && was.code === linkedCode() && Date.now() - was.t < REJOIN_MS) {
    // reloaded for a deploy's new client: still "in the game" under the modal, not on the splash with a Join button
    if (sessionStorage.getItem(MOVED_KEY) === '1') {
      ui.hideSplash();
      ui.showUpdating(true);
    }
    setTimeout(() => rejoin(was.code, was.name), 300);
  }
} catch {}

// ---------------------------------------------------------------- the still behind the splash
// index.html shows a blurred still of the walk until the world is built and first drawn (seconds, on a slow machine);
// it fades into the scene then. The still is the last one this browser drew: the valley at its own quality settings.
const STILL_KEY = 'stn.still';
const still = document.getElementById('still');
let stillKept = false;
function showScene() {
  if (!still || still.classList.contains('gone')) return;
  still.classList.add('gone');
  still.addEventListener('transitionend', () => still.remove(), { once: true });
}
// (read back in the same task as the draw: the canvas does not keep its picture once it is on screen)
function keepStill() {
  stillKept = true;
  try {
    const src = renderer.canvas;
    const c = document.createElement('canvas');
    c.width = 384;
    c.height = Math.round((384 * src.height) / src.width);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    localStorage.setItem(STILL_KEY, c.toDataURL('image/jpeg', 0.7));
  } catch {}
}

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
  if (game.post && !game.warm?.hold) {
    renderer.render(game.post, game.state === 'playing');
    showScene();
    // a few seconds into a shot of the walk, faded all the way in, the shaders all built
    if (!stillKept && game.state === 'menu' && !game.warm && game.tour?.t > 6 && ui.splash.cutK === 0) keepStill();
  }
  const t2 = performance.now();
  game.cpuUpdateMs = (game.cpuUpdateMs || 0) * 0.95 + (t1 - t0) * 0.05;
  game.cpuRenderMs = (game.cpuRenderMs || 0) * 0.95 + (t2 - t1) * 0.05;
}
requestAnimationFrame(frame);

// debug handle
window.__game = game;
