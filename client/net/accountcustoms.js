// A signed-in player's own survivors (the character creator), kept on their account as well as in this browser
// (client/ui/customs.js), so they follow them to any browser they sign in on - and outlive a browser clearing its
// storage (server/index.js /api/me/customs, the user_settings table).
//
// The two copies are merged survivor by survivor (shared/customs.js mergeCustoms: of each the copy changed last; one
// deleted stays deleted unless changed after), not "the newer whole copy wins" as the keybinds are: a survivor made on
// one computer and another made on a laptop both live on.
//   - signing in (or a page opening signed in): the account's copy is asked for and merged into this browser's; if
//     this browser had something the account had not, the merged copy goes up.
//   - a change while signed in goes up a moment later (DEBOUNCE); the server merges it into what it keeps and answers
//     with the merged copy, which is kept here.
//   - signing out leaves this browser's copy as it is.
// Without accounts on the server (no database), or not signed in, nothing is asked: the survivors are this browser's.
import { call } from './lobby.js';
import { onAccountChange, accountState } from './account.js';
import { exportCustoms, adoptCustoms, onCustomsChange } from '../ui/customs.js';
import { mergeCustoms, sameCustoms, tidyCustoms } from '../../shared/customs.js';

const DEBOUNCE = 1200; // ms after the last change
const PATH = '/api/me/customs';
// (lobby.js call gives up after this long, body and all: a page opening is busy for seconds building the valley, and
// an answer whose body was cut off by the default 4 s came back as nothing - taken for an account with no survivors)
const WAIT = 20000;
const RETRY = [3000, 10000]; // ms: a pull that had no answer is tried again after these

let timer = 0;
let quiet = false; // (taking the merged copy is a change of the list that must not go straight back up)
let seq = 0; // (a sign-out or a new sign-in while a request is out: its answer is about somebody else)
const signedIn = () => !!accountState().user;

// the account's copy merged into this browser's, kept here (only when it changes anything)
function take(theirs, mine) {
  if (mine !== seq || !theirs) return;
  const here = exportCustoms();
  const merged = mergeCustoms(here, theirs);
  if (sameCustoms(merged, here)) return;
  quiet = true;
  try {
    adoptCustoms(merged);
  } finally {
    quiet = false;
  }
}

async function push() {
  timer = 0;
  if (!signedIn()) return;
  const mine = seq;
  try {
    const r = await call(PATH, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customs: exportCustoms() }) }, WAIT);
    take(r?.customs, mine);
  } catch {
    /* (kept here; it goes up with the next change, or the next sign-in) */
  }
}

async function pull(tries = 0) {
  const mine = tries ? seq : ++seq;
  let r = null;
  try {
    r = await call(PATH, {}, WAIT);
  } catch {
    r = null;
  }
  if (mine !== seq || !signedIn()) return;
  // no answer (or none that could be read) is not an account without survivors: asked again in a while
  if (!r || typeof r !== 'object') {
    if (tries < RETRY.length) setTimeout(() => mine === seq && pull(tries + 1), RETRY[tries]);
    return;
  }
  if (r.accounts === false) return;
  const theirs = tidyCustoms(r.customs);
  take(theirs, mine);
  // (this browser had what the account had not: up it goes)
  if (!sameCustoms(mergeCustoms(exportCustoms(), theirs), theirs)) await push();
}

let started = false;
export function startCustomsSync() {
  if (started) return;
  started = true;
  let user = '';
  onAccountChange((a) => {
    const id = a.user?.id || '';
    if (id === user) return;
    user = id;
    clearTimeout(timer);
    timer = 0;
    if (id) pull();
    else seq++;
  });
  onCustomsChange((why) => {
    if (quiet || why !== 'edit' || !signedIn()) return;
    clearTimeout(timer);
    timer = setTimeout(push, DEBOUNCE);
  });
  // a change still waiting out its moment as the page goes: sent anyway (keepalive outlives the page)
  addEventListener('pagehide', () => {
    if (!timer || !signedIn()) return;
    clearTimeout(timer);
    timer = 0;
    try {
      fetch(PATH, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customs: exportCustoms() }), keepalive: true }).catch(() => {});
    } catch {
      /* (too late to say anything) */
    }
  });
  if (accountState().user) {
    user = accountState().user.id;
    pull();
  }
}
