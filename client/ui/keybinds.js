// Settings > Keybinds: every action and its two keys (game/binds.js), rebound by clicking a key and pressing the new
// one. Esc cancels, Backspace / Delete leaves it without a key, and a mouse button is a key like any other (the click
// that is pressed while it listens is the bind - so a click elsewhere is no way out: Esc is).
//
// A key another action already has is not taken from it silently. The prompt says which action it is on and offers:
//   Swap      that action gets the key this one had (when there was one, and it would not collide again there)
//   Use here  that action is left without the key
//   Cancel    nothing changes (or Esc)
// Enter picks the first of them. Afterwards the rows that changed flash, and the line under the title says what
// happened to them ("Ping: now on G"). A hands key and a build key may be the same (shared/binds.js sharesOk): no
// prompt for those.
import { BIND_GROUPS, ACTIONS, ACTION, isBindCode, mouseCode } from '../../shared/binds.js';
import { bindsOf, allBinds, keyName, setBind, planBind, resetBind, resetAllBinds, conflictsFor, isDefault, onBindsChange } from '../game/binds.js';
import { bindsSync, onBindsSync } from '../net/accountbinds.js';
import { accountState } from '../net/account.js';
import { el } from './dom.js';

const NOTE = 'Click a key to change it · Esc cancels · Backspace clears';
const SUPPRESS_MS = 700; // after a mouse button is taken: the rest of that click is swallowed too

const SYNC_TEXT = {
  local: 'Saved on this browser',
  account: 'Saved to your account',
  saving: 'Saving to your account…',
  error: "Saved on this browser · your account couldn't be reached",
};

export class KeybindsSection {
  constructor(panel, body) {
    this.panel = panel;
    this.cap = null; // listening: { action, slot } - or, with conflicts, waiting on the prompt: { ..., code, conflicts }
    this.rows = {};
    this.noteT = 0;
    this.swallowUntil = 0;

    const sec = (this.root = el('section', 'set-sec kb-sec', body));
    const head = el('div', 'kb-head', sec);
    el('h3', 'set-sec-title', head, 'Keybinds');
    this.status = el('span', 'kb-status', head, '');
    const all = el('button', 'btn btn-ghost kb-btn', head, 'Reset all');
    all.type = 'button';
    all.title = 'Every action back on its default keys';
    all.addEventListener('click', () => {
      this.cancel();
      resetAllBinds();
      this.say('Every key is back on its default');
      for (const id in this.rows) this.flash(id);
    });
    this.note = el('div', 'kb-note', sec, NOTE);

    for (const g of BIND_GROUPS) {
      el('h4', 'kb-group', sec, g);
      for (const a of ACTIONS.filter((x) => x.group === g)) this._row(sec, a);
    }

    // the prompt for a key that is taken, moved under whichever row asked
    this.prompt = el('div', 'kb-conflict');
    this.promptText = el('span', 'kb-conflict-t', this.prompt, '');
    const btns = el('span', 'kb-conflict-b', this.prompt);
    this.swapBtn = el('button', 'btn btn-ghost kb-btn', btns, 'Swap');
    this.takeBtn = el('button', 'btn btn-ghost kb-btn', btns, 'Use here');
    const no = el('button', 'btn btn-ghost kb-btn', btns, 'Cancel');
    for (const b of [this.swapBtn, this.takeBtn, no]) b.type = 'button';
    this.swapBtn.addEventListener('click', () => this.resolve('swap'));
    this.takeBtn.addEventListener('click', () => this.resolve('replace'));
    no.addEventListener('click', () => this.cancel());

    // Listening takes the next key or button before anything else on the page sees it - the game, the settings
    // panel's own Esc, the chat (window, capture phase: first of all)
    const opts = { capture: true };
    addEventListener('keydown', (e) => this._key(e), opts);
    addEventListener('keyup', (e) => this._swallowKey(e), opts);
    addEventListener('pointerdown', (e) => this._pointer(e), opts);
    for (const type of ['pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'contextmenu']) addEventListener(type, (e) => this._swallow(e), opts);

    onBindsChange(() => this.sync());
    onBindsSync(() => this._syncStatus());
    this.sync();
  }

  _row(parent, a) {
    const r = el('div', 'set-row kb-row', parent);
    el('label', 'set-label', r, a.label);
    const ctl = el('div', 'set-ctl kb-ctl', r);
    const keys = [0, 1].map((slot) => {
      const b = el('button', 'kb-key', ctl, '');
      b.type = 'button';
      b.addEventListener('click', () => this.listen(a.id, slot));
      return b;
    });
    const reset = el('button', 'btn btn-ghost kb-btn kb-reset', ctl, 'Reset');
    reset.type = 'button';
    reset.title = 'Back to its default keys';
    reset.addEventListener('click', () => {
      this.cancel();
      resetBind(a.id);
      this.flash(a.id);
    });
    this.rows[a.id] = { r, keys, reset };
  }

  // ---------------------------------------------------------------- listening
  listen(action, slot) {
    this.cancel();
    this.cap = { action, slot };
    this.sync();
    this.setNote('Press a key or a mouse button for ' + ACTION[action].label + ' · Esc cancels · Backspace clears', 'live');
  }

  cancel() {
    if (!this.cap) return;
    this.cap = null;
    this.prompt.remove();
    this.sync();
    this.setNote(NOTE);
  }

  get listening() {
    return !!this.cap && !this.cap.conflicts;
  }

  _key(e) {
    if (!this.cap || !this.panel.visible) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    this.heldKey = e.code; // (its keyup goes nowhere either)
    if (e.code === 'Escape') return this.cancel();
    if (this.cap.conflicts && e.code === 'Enter') return this.resolve(this.swapBtn.hidden ? 'replace' : 'swap');
    if (e.code === 'Backspace' || e.code === 'Delete') return this.apply(null, 'replace');
    if (!isBindCode(e.code)) return this.setNote(`${e.code.replace(/(Left|Right)$/, '') || 'That key'} can't be bound · pick another, or Esc`, 'bad');
    this.try(e.code);
  }

  _swallowKey(e) {
    if (e.code !== this.heldKey) return;
    this.heldKey = null;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  _pointer(e) {
    if (!this.listening || !this.panel.visible) return;
    const code = mouseCode(e.button);
    if (!code) return;
    e.preventDefault(); // (and with it the mousedown / mouseup that would follow)
    e.stopImmediatePropagation();
    this.swallowUntil = performance.now() + SUPPRESS_MS;
    this.try(code);
  }

  // the rest of the click whose button was just taken: its release, its click, a right button's menu, a side
  // button's going back a page
  _swallow(e) {
    if (performance.now() > this.swallowUntil) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click' || e.type === 'auxclick' || e.type === 'contextmenu') this.swallowUntil = Math.min(this.swallowUntil, performance.now() + 50);
  }

  try(code) {
    const { action, slot } = this.cap;
    const conflicts = conflictsFor(action, code);
    if (!conflicts.length) return this.apply(code, 'replace');
    // taken: say by what, and ask
    this.cap = { action, slot, code, conflicts };
    // a swap only when it would give the other action something: this slot's old key, and one that would not collide
    // for it in turn (E onto flashlight, say, would: E is also next structure)
    const gives = conflicts.length === 1 ? planBind(allBinds(), action, slot, code, 'swap').moved[0]?.code : null;
    const names = [...new Set(conflicts.map((c) => ACTION[c.action].label))];
    const swappable = !!gives;
    this.swapBtn.hidden = !swappable;
    this.promptText.textContent = '';
    el('span', 'kbd sm', this.promptText, keyName(code));
    el('span', '', this.promptText, ` is already on ${names.join(' and ')}. `);
    el('span', 'kb-conflict-h', this.promptText, swappable ? `Swap gives it ${keyName(gives)}; Use here leaves it without.` : names.length > 1 ? 'Use here takes it from both.' : 'Use here leaves it without.');
    this.rows[action].r.after(this.prompt);
    this.sync();
    this.setNote('Enter: ' + (swappable ? 'swap' : 'use here') + ' · Esc: cancel · or press another key', 'live');
  }

  resolve(mode) {
    if (!this.cap?.conflicts) return;
    this.apply(this.cap.code, mode);
  }

  apply(code, mode) {
    const { action, slot } = this.cap;
    const moved = setBind(action, slot, code, { mode });
    this.cap = null;
    this.prompt.remove();
    this.sync();
    this.flash(action);
    for (const m of moved) this.flash(m.action);
    if (moved.length) this.say(moved.map((m) => `${ACTION[m.action].label}: ${m.code ? 'now on ' + keyName(m.code) : 'no key now'}`).join(' · '));
    else this.setNote(NOTE);
  }

  // ---------------------------------------------------------------- drawing
  sync() {
    for (const a of ACTIONS) {
      const row = this.rows[a.id];
      const ks = bindsOf(a.id);
      row.keys.forEach((b, slot) => {
        const live = this.cap && this.cap.action === a.id && this.cap.slot === slot;
        b.classList.toggle('listening', !!live && !this.cap.conflicts);
        b.classList.toggle('asking', !!live && !!this.cap.conflicts);
        b.classList.toggle('empty', !ks[slot] && !live);
        b.textContent = live ? (this.cap.conflicts ? keyName(this.cap.code) + '?' : 'Press a key…') : ks[slot] ? keyName(ks[slot]) : '—';
        b.title = `${a.label}: ${ks[slot] ? keyName(ks[slot]) : 'no key'}${slot ? ' (second key)' : ''} · click to change`;
      });
      row.reset.classList.toggle('off', isDefault(a.id));
      row.reset.disabled = isDefault(a.id);
    }
    this._syncStatus();
  }

  _syncStatus() {
    const where = accountState().user ? bindsSync().where : 'local';
    this.status.textContent = SYNC_TEXT[where] || SYNC_TEXT.local;
    this.status.dataset.where = where;
  }

  setNote(text, cls = '') {
    clearTimeout(this.noteT);
    this.note.textContent = text;
    this.note.className = 'kb-note' + (cls ? ' ' + cls : '');
  }

  // a line about what just changed, for a few seconds
  say(text) {
    this.setNote(text, 'done');
    this.noteT = setTimeout(() => this.setNote(NOTE), 5000);
  }

  flash(action) {
    const r = this.rows[action]?.r;
    if (!r) return;
    r.classList.remove('kb-flash');
    void r.offsetWidth;
    r.classList.add('kb-flash');
  }
}
