// The player's bestiary in the browser (the book: shared/bestiary.js). The game they are in says what they have seen
// (EVT.BESTIARY): the whole record as they join (BESTF.ALL), then each kind as they first see it. Signed in, the record
// is the account's and the server keeps it: this holds the copy the game sent. A guest's is this browser's, in
// localStorage (KEY), and what the game says they saw is added to it. Which of the two a game keeps is what its events
// say (BESTF.ACCOUNT); until the first one comes, being signed in decides.
//
// Stored as JSON under 'stn.bestiary': { v: 1, seen: mask of ZTYPEs }
import { BESTF, cleanSeen, seenKinds } from '../../shared/bestiary.js';
import { accountState } from './account.js';

const KEY = 'stn.bestiary';

let unsaved = null; // the record storage would not take (private mode, full): it lasts as long as the page does

function loadGuest() {
  if (unsaved !== null) return unsaved;
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (o && typeof o === 'object' && o.v === 1) return cleanSeen(o.seen);
  } catch {
    /* no storage, or not JSON */
  }
  return 0;
}

function saveGuest(mask) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, seen: mask }));
    unsaved = null;
  } catch {
    unsaved = mask;
  }
}

const st = {
  account: null, // { user, mask }: the account's record as the game sent it
  mode: '', // 'account' / 'guest': whose record the game we are in keeps ('' until it says)
};
const changeSubs = new Set();
const seenSubs = new Set();
const emit = (subs, ...args) => {
  for (const fn of subs) {
    try {
      fn(...args);
    } catch (err) {
      console.error(err);
    }
  }
};

// fn() whenever the record changes; returns the way to stop
export function onBestiary(fn) {
  changeSubs.add(fn);
  return () => changeSubs.delete(fn);
}
// fn([entry]) when kinds are seen for the first time (the toast); returns the way to stop
export function onSeen(fn) {
  seenSubs.add(fn);
  return () => seenSubs.delete(fn);
}

// The record to show -> { mask, account, loading }
export function bestiaryView() {
  const user = accountState().user;
  const mode = st.mode || (user ? 'account' : 'guest');
  if (mode === 'guest') return { mask: loadGuest(), account: false, loading: false };
  if (st.account && (!user || st.account.user === user.id)) return { mask: st.account.mask, account: true, loading: false };
  return { mask: 0, account: true, loading: true };
}

// A game was joined (or rejoined): it says again whose record it keeps
export function joinedBestiary() {
  st.mode = '';
  emit(changeSubs);
}

// EVT.BESTIARY
export function bestiaryEvent(flags, mask) {
  mask = cleanSeen(mask);
  let fresh = 0;
  if (flags & BESTF.ACCOUNT) {
    st.mode = 'account';
    const user = accountState().user?.id || '';
    if (flags & BESTF.ALL) st.account = { user, mask };
    else {
      const had = st.account?.mask || 0;
      fresh = mask & ~had;
      st.account = { user, mask: had | mask };
    }
  } else {
    st.mode = 'guest';
    const had = loadGuest();
    if ((had | mask) !== had) saveGuest(had | mask);
    if (!(flags & BESTF.ALL)) fresh = mask & ~had;
  }
  emit(changeSubs);
  if (fresh) emit(seenSubs, seenKinds(fresh));
}
