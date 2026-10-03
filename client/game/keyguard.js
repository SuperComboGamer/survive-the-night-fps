// Keeps the browser's own shortcuts from ending a game. Crouch is Ctrl and forward is W - and Ctrl+W closes the tab in Chrome
// (Ctrl+R, crouch + reload, reloads it). A normal tab cannot cancel those: Chrome keeps Ctrl+W / T / N for itself and never
// hands them to the page. A page in fullscreen it asked for can, with the Keyboard Lock API: every combination of a locked key
// (Ctrl+W, Ctrl+Shift+W, ...) then goes to the page instead. So while playing, the click that takes the mouse also takes
// fullscreen with the game's keys locked (Settings > Controls > "Fullscreen while playing"), and when that is off or not
// available (other browsers) the tab asks "Leave site?" before it closes. Esc is not locked: it still leaves fullscreen.
const LOCK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyT', 'KeyN', 'KeyC', 'KeyV', 'KeyM', 'KeyH', 'KeyZ', 'KeyX', 'Tab', 'Space', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
// with Ctrl (or Cmd) held these do something to the page or the browser; in play they are the game's
const GAME_KEYS = new Set(LOCK_KEYS);

export class KeyGuard {
  constructor(isPlaying) {
    this.isPlaying = isPlaying; // () => true while a game is on (the guard is idle on the splash)
    this.fullscreen = true; // the setting
    this.ours = false; // the fullscreen we are in is one we asked for
    addEventListener('beforeunload', (e) => {
      if (!this.isPlaying()) return;
      e.preventDefault();
      e.returnValue = ''; // (older Chrome needs it set)
    });
    // what a normal tab does let the page cancel (Ctrl+D bookmark, Ctrl+S save, Ctrl+F find, ...), and everything under keyboard lock
    addEventListener(
      'keydown',
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || !GAME_KEYS.has(e.code) || !this.isPlaying()) return;
        if (document.activeElement?.matches?.('input, textarea, [contenteditable="true"]')) return; // (chat: Ctrl+A, Ctrl+V work)
        e.preventDefault();
      },
      true,
    );
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) this.ours = false;
    });
  }

  get supported() {
    return !!(navigator.keyboard?.lock && document.documentElement.requestFullscreen);
  }

  // from a click (it needs the user's gesture): fullscreen with the game's keys locked
  engage() {
    if (!this.fullscreen || !this.supported || !this.isPlaying()) return;
    const lock = () => navigator.keyboard.lock(LOCK_KEYS).catch(() => {});
    if (document.fullscreenElement) {
      lock();
      return;
    }
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => {
        this.ours = true;
        return lock();
      })
      .catch(() => {}); // (no gesture, or the user refused: the "Leave site?" prompt still guards the tab)
  }

  // back on the splash: leave the fullscreen we took
  release() {
    navigator.keyboard?.unlock?.();
    if (this.ours && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    this.ours = false;
  }
}
