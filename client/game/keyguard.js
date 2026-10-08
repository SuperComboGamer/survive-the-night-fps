// Keeps the browser's own shortcuts from ending a game. Crouch is Ctrl and forward is W - and Ctrl+W closes the tab in Chrome
// (Ctrl+R, crouch + reload, reloads it). A normal tab cannot cancel those: Chrome keeps Ctrl+W / T / N for itself and never
// hands them to the page. A page in fullscreen it asked for can, with the Keyboard Lock API: every combination of a locked key
// (Ctrl+W, Ctrl+Shift+W, ...) then goes to the page instead. So while playing, the click that takes the mouse also takes
// fullscreen with the game's keys locked (Settings > Controls > "Fullscreen while playing"), and when that is off or not
// available (other browsers) the tab asks "Leave site?" before it closes.
//
// The keys locked are every key the player has bound to something (binds.js) - rebound in the pause menu, the lock is
// taken again with the new ones - plus W, T and N always: Ctrl+W / T / N are the browser's own, and whatever crouch and
// forward are on, a Ctrl+W must not close a game. Esc too: locked, a tap of it reaches the page with the mouse still
// taken (Game.onKey backs out of building with it before it opens the menu), and only holding it leaves fullscreen.
import { boundKeyCodes, onBindsChange } from './binds.js';

const ALWAYS = ['KeyW', 'KeyT', 'KeyN', 'Escape'];
let lockKeys = [];
// with Ctrl (or Cmd) held these do something to the page or the browser; in play they are the game's
let gameKeys = new Set();
function update() {
  // (not Ctrl or Shift themselves: held, they are only ever half of a combination, and the other half is what is locked)
  lockKeys = [...new Set([...ALWAYS, ...boundKeyCodes().filter((c) => !/^(Control|Shift)/.test(c))])];
  gameKeys = new Set(lockKeys);
}
update();
onBindsChange(update);

export class KeyGuard {
  constructor(isPlaying) {
    this.isPlaying = isPlaying; // () => true while a game is on (the guard is idle on the splash)
    this.fullscreen = true; // the setting
    this.ours = false; // the fullscreen we are in is one we asked for
    this.wanted = false; // asked for and not given back since (release)
    addEventListener('beforeunload', (e) => {
      if (!this.isPlaying()) return;
      e.preventDefault();
      e.returnValue = ''; // (older Chrome needs it set)
    });
    // what a normal tab does let the page cancel (Ctrl+D bookmark, Ctrl+S save, Ctrl+F find, ...), and everything under keyboard lock
    addEventListener(
      'keydown',
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || !gameKeys.has(e.code) || !this.isPlaying()) return;
        if (document.activeElement?.matches?.('input, textarea, [contenteditable="true"]')) return; // (chat: Ctrl+A, Ctrl+V work)
        e.preventDefault();
      },
      true,
    );
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) this.ours = false;
    });
    // rebound while the lock is on (Settings over the pause menu, still in fullscreen): lock the keys of now
    onBindsChange(() => {
      if (this.ours && document.fullscreenElement && this.supported) navigator.keyboard.lock(lockKeys).catch(() => {});
    });
  }

  get supported() {
    return !!(navigator.keyboard?.lock && document.documentElement.requestFullscreen);
  }

  // from a click (it needs the user's gesture): fullscreen with the game's keys locked. joining: the click on Join, before
  // the game is on (Game.holdForJoin)
  engage(joining = false) {
    if (!this.fullscreen || !this.supported || !(joining || this.isPlaying())) return;
    this.wanted = true;
    const lock = () => navigator.keyboard.lock(lockKeys).catch(() => {});
    if (document.fullscreenElement) {
      lock();
      return;
    }
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => {
        this.ours = true;
        return this.wanted ? lock() : this.release(); // (given back while it was on its way: a join that failed)
      })
      .catch(() => {}); // (no gesture, or the user refused: the "Leave site?" prompt still guards the tab)
  }

  // back on the splash: leave the fullscreen we took
  release() {
    this.wanted = false;
    navigator.keyboard?.unlock?.();
    if (this.ours && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    this.ours = false;
  }
}
