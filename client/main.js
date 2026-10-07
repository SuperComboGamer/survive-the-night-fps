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
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { refreshAccount } from './net/account.js';
import { startAchievementsSync } from './net/achievements.js';
import { linkedCode, inviteLink, showCodeInAddress, gameInfo, listGames } from './net/lobby.js';
import { comeBack } from './net/comeback.js';
import { moveBack as movedBack, joinVerdict, pageBuild, mayReload, reloadedInto, RELOAD_LOOP_TEXT } from './net/moveback.js';
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
// A game that is over for good - the next server could not carry it over a deploy, or no server has it - is not
// asked for again: the player is told why, once (net/comeback.js).
const REJOIN_MS = 60_000;
let lastName = '';
let rejoining = false;
async function rejoin(code, name = lastName) {
  if (rejoining || !code || !name) return;
  rejoining = true;
  let moved = false; // (this page was loaded again for a deploy's new build: moveBack)
  try {
    moved = sessionStorage.getItem(MOVED_KEY) === '1';
    sessionStorage.removeItem(MOVED_KEY);
  } catch {}
  try {
    const why = await comeBack({
      code,
      moved,
      ms: REJOIN_MS,
      join: async () => (game.state === 'playing' ? true : (await callbacks.onJoin(name, code, { quiet: true })) || game.state === 'playing'),
      waiting: (s) => ui.setJoinError(`${moved ? 'The game was updated' : 'Connection lost'} - getting you back into game ${code} (${s} s)...`),
    });
    if (why && game.state !== 'playing') {
      console.warn(`[net] not back in game ${code}: ${why}`);
      forgetPlaying();
      ui.showSplash();
      ui.setJoinError(why);
    }
  } finally {
    ui.showUpdating(false);
    rejoining = false;
  }
}

// ---------------------------------------------------------------- back in after a deploy
// A deploy hands every game to the next server (server/handoff.js) and closes its sockets with MOVED_CODE. The game
// stays on screen (Game.onMoving) while this joins the same code on the next server, where our body is waiting
// (net/moveback.js decides how: in place, which is a few tens of ms, or loading the page again first when the code both
// ends run changed; a change to the client alone waits for the player to leave the game).
// What this page was loaded with: written into it by the server (pageBuild); the Vite dev server writes nothing, and
// then the server is asked.
const BUILD = Promise.resolve(pageBuild()).then(
  (b) =>
    b ||
    fetch('/api/version')
      .then((r) => r.json())
      .catch(() => null)
);
// (what runs the game now: a server going down says 503, and one that does not answer in a moment is asked again)
const version = (code = '') => fetch(`/api/version${code ? `?game=${encodeURIComponent(code)}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout?.(2000) }).then((r) => (r.ok ? r.json() : null));
let updateReady = false; // the server runs a newer client than this page, which can still play: loaded once the player leaves
const MOVED_KEY = 'stn.moved';
const UPDATING_READ_MS = 250; // the "Game updated" card is painted over the game before the page reloads (the new page shows it at once too)
// (sessionStorage, or null where the browser will not have it: then reloads are not counted)
const tabStore = () => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};
// the server's "try again" pages (a server going down, an older build's page not to be had) count their tries here:
// this page is up, so the count starts again
try {
  for (const k of Object.keys(sessionStorage)) if (k.startsWith('stn.retry.')) sessionStorage.removeItem(k);
} catch {}
async function reloadInto(code, name) {
  // (a server that keeps asking for the page to be loaded again for this game: told so, not reloaded for ever)
  if (!mayReload(tabStore(), code)) {
    forgetPlaying();
    if (game.moving) game.onDisconnect(0, RELOAD_LOOP_TEXT);
    else ui.setJoinError(RELOAD_LOOP_TEXT);
    return;
  }
  try {
    sessionStorage.setItem(MOVED_KEY, '1');
    localStorage.setItem(PLAYING_KEY, JSON.stringify({ code, name, t: Date.now() })); // (the reloaded page goes back in by it)
  } catch {}
  ui.showUpdating(true);
  await new Promise((done) => setTimeout(done, UPDATING_READ_MS));
  // Everything the game holds goes before the page does (Edge has crashed instead of reloading a page still in a game):
  // the mouse, the screen, the keyboard and the microphone (Game.letGo), then the frames, the sound and the GPU.
  try {
    await game.letGo();
    stopped = true;
    audio.close();
    renderer.dispose();
  } catch (err) {
    console.error(err); // (the reload goes ahead: it is what this is for)
  }
  location.reload();
}
async function moveBack(code) {
  const name = lastName;
  const t0 = performance.now();
  const r = await movedBack({
    code,
    loadedFrom: (await BUILD) || { protocol: PROTOCOL_VERSION },
    version,
    still: () => game.moving,
    join: () => game.join(name, code, { resume: true }).then(
      () => true,
      (err) => err
    ),
  });
  console.log(`[net] after the deploy: ${r.verdict}${r.update ? ' (a newer client is ready)' : ''} in ${Math.round(performance.now() - t0)} ms`);
  if (r.verdict === 'reload') return reloadInto(code, name);
  if (r.verdict === 'in place') {
    reloadedInto(tabStore(), code);
    if (r.update && !updateReady) {
      updateReady = true;
      ui.addChat('', 'The game was updated. The new version loads the next time you leave the game.', { system: true });
    }
    return;
  }
  if (r.verdict === 'ended') forgetPlaying(); // (the next server could not carry the game over, and says why: asking again will not change it)
  if (r.verdict !== 'left' && game.moving) game.onDisconnect(0, r.message);
}

// Before going into a game in this page (a pick from the list, a friend's game, a quick join): can this page play it?
// The game may be run by other code than this page was loaded with - a deploy came while the page sat on the splash,
// or an older build carries that game on (server/builds.js). Then that game's page is loaded instead, and goes in by
// itself as a reopened one does - a newer client of the same compat too (joinVerdict: this page's own files may be
// gone from the server). -> true when this page may join
async function canJoinHere(code, name) {
  // (a server going down says nothing - 503 - and this page may be its: asked until one that will run the game answers)
  let v = null;
  for (let i = 0; i < 20 && !v; i++) if (!(v = await version(code).catch(() => null))) await new Promise((done) => setTimeout(done, 250));
  if (joinVerdict((await BUILD) || { protocol: PROTOCOL_VERSION }, v) !== 'reload') return true;
  // (loaded again for this game too often already: its server keeps sending us round - told so instead)
  if (!mayReload(tabStore(), code)) {
    forgetPlaying();
    throw new Error(RELOAD_LOOP_TEXT);
  }
  try {
    if (code) localStorage.setItem(PLAYING_KEY, JSON.stringify({ code, name, t: Date.now() }));
  } catch {}
  if (code) location.href = `/?game=${encodeURIComponent(code)}`;
  else location.reload();
  return false;
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
  // code: the game to go into (an invite, a pick from the list, one just made); '' for a quick join. quiet: one try of
  // several at getting back in (rejoin), whose failure is not shown: rejoin says how it ended. -> nothing once in the
  // game (or when no join could be tried), else the Error
  async onJoin(name, code = '', { quiet = false } = {}) {
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
      if (!(await canJoinHere(code, name))) return;
      await game.join(name, code);
      reloadedInto(tabStore(), game.room?.code || code);
      ui.hideSplash();
      document.activeElement?.blur?.(); // the name field must not keep eating gameplay keys
      // the game's link: in the address bar (a reload comes back here, and it can be copied from there), on the
      // pause menu, and said once in the chat
      const room = game.room;
      if (room) {
        const link = inviteLink(room.code);
        showCodeInAddress(room.code);
        ui.setRoom(room, link);
        ui.addChat('', `${room.inviteOnly ? 'Invite only' : 'Public'} game ${room.code}. Invite friends with ${link} (or press Esc, then Invite friends).`, { system: true });
      }
    } catch (err) {
      joinCue = false;
      if (quiet) return err;
      console.error(err);
      ui.setJoinError(err.message || 'Could not join');
      return err;
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
  onUndoDrop: () => game?.uiCallbacks().onUndoDrop(),
  onSalvage: (from, n) => game?.uiCallbacks().onSalvage(from, n),
  onSwapItems: (a, b) => game?.uiCallbacks().onSwapItems(a, b),
  onEquipArmor: (i) => game?.uiCallbacks().onEquipArmor(i),
  onDropWeapon: (s) => game?.uiCallbacks().onDropWeapon(s),
  onUnequip: (s, to) => game?.uiCallbacks().onUnequip(s, to),
  onWorn: (which, what) => game?.uiCallbacks().onWorn(which, what),
  onSelectStructure: (t) => game?.uiCallbacks().onSelectStructure(t),
  onHoverStructure: (t) => game?.uiCallbacks().onHoverStructure(t),
  onSelectThrowable: (it) => game?.uiCallbacks().onSelectThrowable(it),
  onCloseInventory: () => game?.uiCallbacks().onCloseInventory(),
  onChatSend: (text) => {
    game?.uiCallbacks().onChatSend(text);
    // (sent from the inventory: back to the inventory, with the pointer free for it)
    if (game && game.state === 'playing' && !game.screenUp()) {
      game.input.enabled = true;
      game.input.requestLock();
    }
  },
  onSettings: (s) => applySettings(s),
  onResume: () => {
    if (!game) return;
    ui.showPause(false);
    if (game.screenUp()) return; // (the map or the bestiary opened over the menu keeps the pointer)
    game.input.enabled = true;
    game.input.requestLock();
  },
  onLeave: () => {
    forgetPlaying();
    showCodeInAddress(''); // (back on the splash for any game, not this one's invitation)
    ui.setRoom(null);
    game?.leave();
    // a deploy brought a newer client this page could do without while it played (moveBack): it is loaded now
    if (updateReady) setTimeout(() => location.reload(), 300);
  },
  onUiSound: (name) => audio.ready && audio.playLocal(name, { volume: 0.5 }),
  // the friends panel: who is in this game with us, and the accounts they are signed in to (S2C.FRIENDS)
  onPeers: () => {
    if (!game || game.state !== 'playing') return null;
    const accounts = game.conn.accounts;
    return { room: game.room, players: [...game.players].map(([id, p]) => ({ id, name: p.name, account: accounts.get(id) || '', self: id === game.myId })) };
  },
  onAccountName: (id) => game?.conn.accounts.get(id) || '',
  onBestiary: () => game?.toggleBestiary(true),
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
  [keysOf('reload'), 'Reload · a flourish, with nunchucks in hand'],
  [keysOf('interact'), 'Interact · hold: search, revive, start the car'],
  ['Melee', 'Hit trees for wood, wrecks for scrap'],
  [keysOf('ping'), 'Ping (go · danger · loot)'],
  [keysOf('map'), 'Field map'],
  [keysOf('board'), 'Leaderboard'],
  [keysOf('bestiary'), 'Bestiary: the monsters you have seen'],
  [keysOf('flashlight'), 'Flashlight'],
  [keysOf('heal'), 'Quick heal'],
  [keysOf('drink'), 'Energy drink (refills stamina)'],
  [keysOf('inventory'), 'Inventory & crafting'],
  [keysOf('players'), 'Player list (hold)'],
  [keysOf('chat'), 'Chat'],
  [keysOf('talk'), 'Push to talk'],
  [keysOf('slot6'), 'Walkie-talkie: hold fire to talk to everyone'],
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
let stopped = false; // the page is about to be loaded again (reloadInto): nothing more is drawn
function frame(now) {
  if (stopped) return;
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
