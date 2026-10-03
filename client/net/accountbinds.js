// A signed-in player's keybinds, kept on their account as well as in this browser (game/binds.js), so they follow
// them to any browser they sign in on (server/index.js /api/me/binds, the user_settings table).
//
// The rule is the newer copy wins. Both carry the time of their last change (updatedAt, the clock of the browser that
// made it):
//   - signing in (or a page opening signed in): the account's copy is asked for. If it is newer than this browser's,
//     it is taken; if this browser's is newer (rebound as a guest, or offline), it goes up to the account instead.
//   - a change while signed in goes up a moment later (DEBOUNCE: a player rebinding six keys sends one request).
//     The server keeps the newer of what it has and what it is sent, and answers with what it kept - so a browser
//     that was behind is put right by its own save.
//   - signing out leaves this browser's copy as it is.
// Without accounts on the server (no database), or not signed in, nothing is asked: the binds are this browser's.
import { call } from './lobby.js';
import { onAccountChange, accountState } from './account.js';
import { exportBinds, adoptBinds, bindsUpdatedAt, onBindsChange } from '../game/binds.js';

const DEBOUNCE = 1200; // ms after the last change

const st = {
  where: 'local', // 'local' this browser only | 'account' on the account too | 'saving' on its way | 'error' could not be saved there
  user: '', // the account they are synced with
};
const subs = new Set();
let timer = 0;
let quiet = false; // (taking the account's copy is a change of the binds that must not go straight back up)
let seq = 0; // (a sign-out or a new sign-in while a request is out: its answer is about somebody else)

function set(where) {
  if (st.where === where) return;
  st.where = where;
  for (const fn of subs) {
    try {
      fn(st);
    } catch (err) {
      console.error(err);
    }
  }
}

// fn({ where }) whenever where the binds are kept changes; returns the way to stop
export function onBindsSync(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export const bindsSync = () => st;

const signedIn = () => !!accountState().user;

function take(b, mine) {
  if (b && Number.isFinite(b.updatedAt) && b.updatedAt > bindsUpdatedAt() && mine === seq) {
    quiet = true;
    try {
      adoptBinds(b.binds, b.updatedAt);
    } finally {
      quiet = false;
    }
  }
}

async function push() {
  timer = 0;
  if (!signedIn()) return set('local');
  const mine = seq;
  set('saving');
  try {
    const b = await call('/api/me/binds', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exportBinds()) }, 8000);
    if (mine !== seq) return;
    take(b, mine);
    set('account');
  } catch {
    if (mine === seq) set(signedIn() ? 'error' : 'local');
  }
}

async function pull() {
  const mine = ++seq;
  try {
    const b = await call('/api/me/binds');
    if (mine !== seq || !signedIn()) return;
    if (b && Number.isFinite(b.updatedAt) && b.updatedAt > bindsUpdatedAt()) {
      take(b, mine);
      set('account');
    } else if (bindsUpdatedAt() > (b?.updatedAt || 0)) await push(); // this browser's are the newer: up they go
    else set('account'); // (the same, or neither was ever changed)
  } catch {
    if (mine === seq) set('error');
  }
}

let started = false;
export function startBindsSync() {
  if (started) return;
  started = true;
  let user = '';
  onAccountChange((a) => {
    const id = a.user?.id || '';
    if (id === user) return;
    user = st.user = id;
    clearTimeout(timer);
    timer = 0;
    if (id) pull();
    else {
      seq++;
      set('local');
    }
  });
  onBindsChange((why) => {
    if (quiet || why !== 'edit' || !signedIn()) return;
    clearTimeout(timer);
    set('saving');
    timer = setTimeout(push, DEBOUNCE);
  });
  // a change still waiting out its moment as the page goes: sent anyway (keepalive outlives the page)
  addEventListener('pagehide', () => {
    if (!timer || !signedIn()) return;
    clearTimeout(timer);
    timer = 0;
    try {
      fetch('/api/me/binds', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exportBinds()), keepalive: true }).catch(() => {});
    } catch {
      /* (too late to say anything) */
    }
  });
  if (accountState().user) {
    user = st.user = accountState().user.id;
    pull();
  }
}
