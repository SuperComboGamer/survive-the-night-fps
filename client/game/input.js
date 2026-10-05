// Keyboard + mouse input with pointer lock. Gameplay keys only; the UI handles its own DOM input. Which key does what
// is the player's keybinds (binds.js): this only knows codes - a KeyboardEvent.code, or 'Mouse0'..'Mouse4' for a mouse
// button - and asks binds.js which actions a code is.
import { BTN } from '../../shared/constants.js';
import { mouseCode } from '../../shared/binds.js';
import { actionsOf, isBound } from './binds.js';

// the held actions and the button each one holds down in a command
const HOLD_BTN = {
  forward: BTN.FWD,
  back: BTN.BACK,
  left: BTN.LEFT,
  right: BTN.RIGHT,
  jump: BTN.JUMP,
  sprint: BTN.SPRINT,
  crouch: BTN.CROUCH,
  reload: BTN.RELOAD,
  fire: BTN.ATTACK,
  // held, the same as right mouse held: aim, heavy swing, a zombie's leap. On a trackpad a right click can't be held
  // while you click to fire; the left thumb rests on Alt (Option on a Mac) with the fingers on WASD
  aim: BTN.ALT,
};

// a code that is still answered with the controls off (the inventory, the map, the pause menu): the key that opened
// something shuts it, Esc backs out, and Enter opens the chat from the inventory and the pause menu (Y does not: as
// in Half-Life, it is a key of play)
const MENU_ACTIONS = new Set(['inventory', 'map', 'board', 'bestiary', 'players']);
function passesMenus(code) {
  if (code === 'Escape') return true;
  for (const a of actionsOf(code)) if (MENU_ACTIONS.has(a) || (a === 'chat' && code === 'Enter')) return true;
  return false;
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.buttons = 0;
    this.latched = 0; // buttons pressed since the last sample (so sub-16ms taps are never lost)
    this.yaw = 0;
    this.pitch = 0;
    this.lookDX = 0; // accumulated this frame (for viewmodel sway)
    this.lookDY = 0;
    this.sensitivity = 1;
    this.invertY = false;
    this.rawInput = true; // ask for unadjusted movement (no OS mouse acceleration)
    this.rawActive = false; // the current lock actually delivers raw movement
    this.skipMove = false; // drop the first delta after locking
    this.locked = false;
    this.enabled = false; // gameplay input enabled (not typing / not in menus)
    this.down = new Map(); // code held -> the actions it went down as (what letting it go lets go of, rebound since or not)
    this.wheel = 0;
    this.handlers = {}; // onKey(code, actions) for discrete actions, onKeyUp(code, actions, cancelled)
    this.buildMode = false;

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      // the first delta after locking can carry the cursor's jump to the lock point
      this.skipMove = this.locked;
      if (!this.locked) {
        // (the mouse buttons, and fire / aim on whatever keys: nothing is fired or aimed with the pointer free)
        for (const [code, acts] of [...this.down]) if (code.startsWith('Mouse') || acts.includes('fire') || acts.includes('aim')) this.release(code, true);
      }
      this.handlers.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (this.skipMove) {
        this.skipMove = false;
        return;
      }
      let mx = e.movementX;
      let my = e.movementY;
      // Browsers merge all moves of a frame into one event, so a fast flick legitimately
      // produces big deltas. Only non-raw (OS-warped) pointers emit bogus spikes; clamp those.
      if (!this.rawActive) {
        mx = Math.max(-300, Math.min(300, mx));
        my = Math.max(-300, Math.min(300, my));
      }
      const k = 0.0022 * this.sensitivity;
      this.yaw -= mx * k;
      this.pitch -= my * k * (this.invertY ? -1 : 1);
      if (this.pitch > 1.54) this.pitch = 1.54;
      if (this.pitch < -1.54) this.pitch = -1.54;
      this.lookDX += mx;
      this.lookDY += my;
    });
    // A mouse button only counts pressed under the lock: a click on the map or in the inventory never reaches the weapon
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || !this.enabled) return;
      if (e.button === 1 || e.button >= 3) e.preventDefault(); // (the wheel's autoscroll; the side buttons' back / forward)
      const code = mouseCode(e.button);
      if (code) this.press(code, false);
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button >= 3 && this.locked) e.preventDefault(); // (Chrome goes back a page on the side button's release)
      const code = mouseCode(e.button);
      if (code && this.down.has(code)) this.release(code);
    });
    document.addEventListener('auxclick', (e) => {
      if (this.locked && e.button >= 3) e.preventDefault();
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked || !this.enabled) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    window.addEventListener('keydown', (e) => {
      const typing = this.handlers.isTyping?.();
      if (typing) return;
      if (e.code === 'Tab') e.preventDefault(); // (never the browser's focus hopping, whatever Tab is bound to)
      if (!this.enabled && !passesMenus(e.code)) return;
      // a key of the game is the game's, not the page's (Space scrolling, an arrow, Alt opening a menu bar, F finding)
      if (this.enabled && (isBound(e.code) || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'ControlLeft')) e.preventDefault();
      this.press(e.code, e.repeat);
    });
    window.addEventListener('keyup', (e) => {
      if ((e.code === 'AltLeft' || e.code === 'AltRight') && this.locked) e.preventDefault(); // (Firefox shows its menu bar when Alt is let go)
      this.release(e.code);
    });
    window.addEventListener('blur', () => {
      this.releaseAll();
      this.handlers.onBlur?.(); // (the keyup of a key held as the window lost the focus never comes)
    });
  }

  // A code goes down: the actions it is bound to now are the ones it holds until it comes up. A key's auto-repeat
  // presses nothing again; it only keeps its held buttons latched (and picks a key up again after releaseAll, so a
  // key still held when the map shuts moves you again).
  press(code, repeat) {
    let acts = this.down.get(code);
    if (!acts) {
      acts = actionsOf(code).slice();
      this.down.set(code, acts);
      this.recompute();
    }
    for (const a of acts) this.latched |= HOLD_BTN[a] || 0;
    if (!repeat) this.handlers.onKey?.(code, acts);
  }

  // ...and comes up. cancelled: let go of by the game (the window lost the focus, a menu took over), not the player
  release(code, cancelled = false) {
    const acts = this.down.get(code);
    if (!acts) return this.handlers.onKeyUp?.(code, [], cancelled);
    this.down.delete(code);
    this.recompute();
    this.handlers.onKeyUp?.(code, acts, cancelled);
  }

  // everything held is let go (opening the chat, the map, the leaderboard: what the keys were doing stops)
  releaseAll() {
    for (const code of [...this.down.keys()]) this.release(code, true);
    this.buttons = 0;
  }

  recompute() {
    let b = 0;
    for (const acts of this.down.values()) for (const a of acts) b |= HOLD_BTN[a] || 0;
    this.buttons = b;
  }

  // The mouse buttons held, as a mask (1 left, 2 right): the e2e scripts hold the trigger down by setting it
  get mouseButtons() {
    return (this.down.has('Mouse0') ? 1 : 0) | (this.down.has('Mouse2') ? 2 : 0);
  }
  set mouseButtons(m) {
    for (const [bit, code] of [[1, 'Mouse0'], [2, 'Mouse2']]) {
      if (m & bit) {
        if (!this.down.has(code)) this.press(code, true);
      } else if (this.down.has(code)) this.release(code);
    }
  }

  // is an action held down right now (by any of its keys)?
  held(action) {
    for (const acts of this.down.values()) if (acts.includes(action)) return true;
    return false;
  }

  requestLock() {
    if (this.locked) return;
    this.onRequestLock?.(); // (game.js: the same click takes fullscreen + keyboard lock - keyguard.js)
    this.rawActive = false;
    if (!this.rawInput) {
      this.canvas.requestPointerLock?.();
      return;
    }
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (!p || !p.then) return; // no promise: the option was ignored, movement is OS-adjusted
    p.then(
      () => (this.rawActive = true),
      (err) => {
        // only retry without raw input when the browser can't do it; other rejections
        // (e.g. re-locking too soon after Esc) would silently downgrade the session
        if (err?.name === 'NotSupportedError') this.canvas.requestPointerLock?.();
      },
    );
  }
  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // gameplay button mask for the next command
  sample() {
    if (!this.enabled) {
      this.latched = 0;
      return 0;
    }
    let b = this.buttons | this.latched;
    // build mode: fire places and aim turns the piece (Game.onKey), and reload's key steps through the structures
    if (this.buildMode) b &= ~(BTN.ATTACK | BTN.ALT | BTN.RELOAD);
    return b;
  }

  // call once the sampled buttons were used by at least one simulation step
  clearLatch() {
    this.latched = 0;
  }

  consumeLook() {
    const dx = this.lookDX;
    const dy = this.lookDY;
    this.lookDX = 0;
    this.lookDY = 0;
    return [dx, dy];
  }
  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
