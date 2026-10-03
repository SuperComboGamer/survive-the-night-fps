// Keyboard / mouse / pointer-lock input with edge detection and scripted injection (for automated tests).
export const input = {
  keys: new Set(), pressedSet: new Set(), releasedSet: new Set(), buttons: new Set(), btnPressed: new Set(), dx: 0, dy: 0, wheel: 0, locked: false, canvas: null, sens: 1.0, enabled: true,
  init(canvas) {
    this.canvas = canvas;
    addEventListener('keydown', (e) => { if (e.repeat) return; if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'F3', 'F5'].includes(e.code) && (this.locked || e.code === 'F3')) e.preventDefault(); this.keys.add(e.code); this.pressedSet.add(e.code); });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); this.releasedSet.add(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    canvas.addEventListener('mousedown', (e) => { if (!this.locked) return; this.buttons.add(e.button); this.btnPressed.add(e.button); e.preventDefault(); });
    addEventListener('mouseup', (e) => { this.buttons.delete(e.button); });
    addEventListener('mousemove', (e) => { if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; } });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (!this.locked) { this.keys.clear(); this.buttons.clear(); } this.onLockChange?.(this.locked); });
  },
  lock() { // pointer lock needs a user gesture; failures are expected in automated runs and must not surface as unhandled rejections
    const c = this.canvas; const swallow = (p) => { if (p && p.catch) p.catch(() => {}); };
    try { const p = c.requestPointerLock?.({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { swallow(c.requestPointerLock()); } catch (e) { /* ignore */ } }); } catch (e) { try { swallow(c.requestPointerLock()); } catch (e2) { /* ignore */ } }
  },
  unlock() { document.exitPointerLock?.(); },
  down(code) { return this.enabled && this.keys.has(code); },
  pressed(code) { return this.enabled && this.pressedSet.has(code); },
  released(code) { return this.releasedSet.has(code); },
  mouse(b) { return this.enabled && this.buttons.has(b); },
  mousePressed(b) { return this.enabled && this.btnPressed.has(b); },
  endFrame() { this.pressedSet.clear(); this.releasedSet.clear(); this.btnPressed.clear(); this.dx = 0; this.dy = 0; this.wheel = 0; },
  // scripted input (tests): input.press('KeyW'), input.hold('KeyW', true)
  hold(code, on = true) { if (on) { this.keys.add(code); this.pressedSet.add(code); } else { this.keys.delete(code); this.releasedSet.add(code); } },
  tap(code) { this.pressedSet.add(code); },
  holdMouse(b, on = true) { if (on) { this.buttons.add(b); this.btnPressed.add(b); } else this.buttons.delete(b); },
  look(dx, dy) { this.dx += dx; this.dy += dy; },
};
