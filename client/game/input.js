// Keyboard + mouse input with pointer lock. Gameplay keys only; the UI handles its own DOM input.
import { BTN } from '../../shared/constants.js';

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
    this.locked = false;
    this.enabled = false; // gameplay input enabled (not typing / not in menus)
    this.pressed = new Set(); // edge-triggered key codes since last consume
    this.wheel = 0;
    this.handlers = {}; // onKey(code) for discrete actions
    this.buildMode = false;

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.buttons &= ~(BTN.ATTACK | BTN.ALT);
        this.mouseButtons = 0;
      }
      this.handlers.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // clamp absurd spikes (some browsers emit huge deltas on lock)
      const mx = Math.max(-300, Math.min(300, e.movementX));
      const my = Math.max(-300, Math.min(300, e.movementY));
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
      if (!this.enabled && e.code !== 'Enter' && e.code !== 'Escape' && e.code !== 'KeyM') return;
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
    });
  }

  requestLock() {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock?.());
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
