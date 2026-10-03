// Keyboard + mouse input with pointer lock. Gameplay keys only; the UI handles its own DOM input.
import { BTN, SLOT_BUILD } from '../../shared/constants.js';

const KEYMAP = {
  KeyW: BTN.FWD,
  ArrowUp: BTN.FWD,
  KeyS: BTN.BACK,
  ArrowDown: BTN.BACK,
  KeyA: BTN.LEFT,
  ArrowLeft: BTN.LEFT,
  KeyD: BTN.RIGHT,
  ArrowRight: BTN.RIGHT,
  Space: BTN.JUMP,
  ShiftLeft: BTN.SPRINT,
  ShiftRight: BTN.SPRINT,
  ControlLeft: BTN.CROUCH,
  KeyC: BTN.CROUCH,
  KeyR: BTN.RELOAD,
};

// The one-off action keys the HUD names in its key hints (ui/keyhints.js). Game.onKey is what acts on these
// codes and still spells them out itself: a rebind has to change both.
export const ACTION_KEYS = {
  flashlight: 'KeyF',
  heal: 'KeyH',
  map: 'KeyM',
  board: 'KeyL',
  inventory: 'KeyI',
  players: 'Tab', // held, not pressed: the player list is up from keydown to keyup
  build: 'Digit' + (SLOT_BUILD + 1), // the weapon slots are on the digits, slot 0 on [1]
};

// what goes on the key cap: 'KeyF' -> 'F', 'Digit5' -> '5', 'Tab' -> 'Tab'
export const keyLabel = (code) => code.replace(/^(Key|Digit)/, '');

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.buttons = 0;
    this.latched = 0; // buttons pressed since the last sample (so sub-16ms taps are never lost)
    this.mouseButtons = 0;
    this.mouseLatched = 0;
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
    this.pressed = new Set(); // edge-triggered key codes since last consume
    this.wheel = 0;
    this.handlers = {}; // onKey(code) for discrete actions
    this.buildMode = false;

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      // the first delta after locking can carry the cursor's jump to the lock point
      this.skipMove = this.locked;
      if (!this.locked) {
        this.buttons &= ~(BTN.ATTACK | BTN.ALT);
        this.mouseButtons = 0;
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
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || !this.enabled) return;
      if (e.button === 1) e.preventDefault();
      if (e.button === 0) this.mouseButtons |= 1;
      if (e.button === 2) this.mouseButtons |= 2;
      this.mouseLatched |= e.button === 0 ? 1 : e.button === 2 ? 2 : 0;
      this.handlers.onMouseDown?.(e.button);
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseButtons &= ~1;
      if (e.button === 2) this.mouseButtons &= ~2;
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
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat) this.handlers.onKey?.('Tab');
        return;
      }
      if (!this.enabled && e.code !== 'Enter' && e.code !== 'Escape' && e.code !== 'KeyM' && e.code !== 'KeyL' && e.code !== 'KeyI') return;
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'ControlLeft' || e.code === 'KeyF' || e.code === 'KeyM' || (e.ctrlKey && (e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'KeyD'))) e.preventDefault();
      const b = KEYMAP[e.code];
      if (b) {
        this.buttons |= b;
        this.latched |= b;
      }
      if (!e.repeat) this.handlers.onKey?.(e.code);
    });
    window.addEventListener('keyup', (e) => {
      const b = KEYMAP[e.code];
      if (b) this.buttons &= ~b;
      this.handlers.onKeyUp?.(e.code);
    });
    window.addEventListener('blur', () => {
      this.buttons = 0;
      this.mouseButtons = 0;
      this.handlers.onBlur?.(); // (the keyup of a key held as the window lost the focus never comes)
    });
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
      this.mouseLatched = 0;
      return 0;
    }
    let b = this.buttons | this.latched;
    const mb = this.mouseButtons | this.mouseLatched;
    if (!this.buildMode) {
      if (mb & 1) b |= BTN.ATTACK;
      if (mb & 2) b |= BTN.ALT;
    } else {
      b &= ~BTN.RELOAD; // R cycles structures in build mode
    }
    return b;
  }

  // call once the sampled buttons were used by at least one simulation step
  clearLatch() {
    this.latched = 0;
    this.mouseLatched = 0;
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
