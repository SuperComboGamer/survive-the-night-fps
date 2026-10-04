// The player's achievements in the browser (the list and its rules: shared/achievements.js).
//
// A guest's record is this browser's, in localStorage (KEY): the server sends what they earn in a game (EVT.ACHIEVE:
// counts to add, feats), and this adds it up, decides the counters and keeps it. The calendar days played on are
// counted here too, as a game is joined. Signed in to an account, the server keeps the record and says what unlocked
// (EVT.ACHIEVE with ACHF.ACCOUNT); this only shows it, and asks /api/achievements for the profile page.
//
// Signing in (or a page opening signed in) merges what this browser earned as a guest since the last merge into the
// account (/api/achievements/merge: the greater of each count, every unlock of either). The guest record stays here
// as it is, so signing out again carries on from it.
//
// Stored as JSON under 'stn.achievements' (read through sanitizeProgress: never trusted):
//   { v: 1, stats: { stat: n }, unlocked: { id: ms }, day, pending }
//   day      the last day a game was joined on as a guest, in days since 1970 by this browser's clock
//   pending  earned as a guest since it was last merged into an account
import { call, post } from './lobby.js';
import { accountState, onAccountChange } from './account.js';
import { ACH_BY_ID, ACH_BY_N, ACHF, ACHIEVEMENTS, sanitizeProgress, applyAchievements } from '../../shared/achievements.js';

const KEY = 'stn.achievements';
const DAY = 86400_000;

let unsaved = null; // the record storage would not take (private mode, full): it lasts as long as the page does

function load() {
  if (unsaved) return unsaved;
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY));
  } catch {
    /* no storage, or not JSON */
  }
  const o = raw && typeof raw === 'object' && raw.v === 1 ? raw : {};
  const rec = sanitizeProgress(o);
  rec.day = Number.isInteger(o.day) && o.day > 0 ? o.day : 0;
  rec.pending = o.pending === true;
  return rec;
}

function save(rec) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ...rec }));
    unsaved = null;
  } catch {
    unsaved = rec;
  }
}

const st = {
  account: null, // the signed-in account's record, as last asked for: { stats, unlocked: { id: ms } }
  accountFor: '', // ...whose
  loading: false,
  error: '',
};
const changeSubs = new Set();
const unlockSubs = new Set();
const emit = (subs, ...args) => {
  for (const fn of subs) {
    try {
      fn(...args);
    } catch (err) {
      console.error(err);
    }
  }
};

// fn() whenever a record changes (an unlock, a sign-in, the account's record arriving); returns the way to stop
export function onAchievements(fn) {
  changeSubs.add(fn);
  return () => changeSubs.delete(fn);
}
// fn([achievement]) when some unlock in front of the player (the banner); returns the way to stop
export function onUnlock(fn) {
  unlockSubs.add(fn);
  return () => unlockSubs.delete(fn);
}

// The record the profile page shows: the account's while signed in, else this browser's.
// -> { stats, unlocked: { id: ms }, account: bool, loading, error }
export function achievementsView() {
  const user = accountState().user;
  if (user && st.accountFor === user.id && st.account) return { ...st.account, account: true, loading: st.loading, error: '' };
  if (user) return { stats: {}, unlocked: {}, account: true, loading: st.loading || !st.error, error: st.error };
  const rec = load();
  return { stats: rec.stats, unlocked: rec.unlocked, account: false, loading: false, error: '' };
}

// the server's answer ({ stats, unlocked: [{ id, at }] }) as a record
function fromServer(b) {
  const unlocked = {};
  for (const u of Array.isArray(b?.unlocked) ? b.unlocked : []) if (ACH_BY_ID.has(u.id)) unlocked[u.id] = u.at > 0 ? u.at : 1;
  return sanitizeProgress({ stats: b?.stats || {}, unlocked });
}

// ---------------------------------------------------------------- in a game
// EVT.ACHIEVE. add: { stat: n }; ns: achievement numbers
export function achievementEvent(flags, add, ns) {
  const list = ns.map((n) => ACH_BY_N[n]).filter(Boolean);
  if (flags & ACHF.ACCOUNT) {
    // unlocked on the account, which keeps it: shown, and put in the copy we have of it (the counts come with the
    // next look at the profile page)
    const user = accountState().user;
    if (st.account && user && st.accountFor === user.id) for (const a of list) st.account.unlocked[a.id] ||= Date.now();
    if (list.length) emit(unlockSubs, list);
    emit(changeSubs);
    return;
  }
  const rec = load();
  const fresh = applyAchievements(
    rec,
    add,
    list.map((a) => a.id),
  );
  rec.pending = true;
  save(rec);
  if (fresh.length) emit(unlockSubs, fresh.map((id) => ACH_BY_ID.get(id)));
  emit(changeSubs);
}

// A game was joined, as a guest (account: false) or as an account (whose days the server counts): a guest's first
// game of the day is another day played on
export function joinedGame(account) {
  if (account) return;
  const today = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / DAY);
  const rec = load();
  if (rec.day >= today) return;
  rec.day = today;
  const fresh = applyAchievements(rec, { days: 1 });
  rec.pending = true;
  save(rec);
  if (fresh.length) emit(unlockSubs, fresh.map((id) => ACH_BY_ID.get(id)));
  emit(changeSubs);
}

// ---------------------------------------------------------------- the account
const hasAny = (rec) => Object.keys(rec.unlocked).length > 0 || Object.values(rec.stats).some((n) => n > 0);
let seq = 0;

// Asks the server for the signed-in account's record, merging this browser's guest record in first if it has
// anything new. Never rejects.
export async function refreshAchievements() {
  const user = accountState().user;
  const mine = ++seq;
  if (!user) {
    st.account = null;
    st.accountFor = '';
    st.loading = false;
    st.error = '';
    emit(changeSubs);
    return;
  }
  st.loading = true;
  st.error = '';
  if (st.accountFor !== user.id) st.account = null;
  emit(changeSubs);
  try {
    const rec = load();
    let body;
    if (rec.pending && hasAny(rec)) {
      body = await post('/api/achievements/merge', { stats: rec.stats, unlocked: rec.unlocked }, 8000);
      if (accountState().user?.id === user.id) {
        const now = load();
        now.pending = false;
        save(now);
      }
    } else body = await call('/api/achievements');
    if (mine !== seq || accountState().user?.id !== user.id) return;
    st.account = fromServer(body);
    st.accountFor = user.id;
  } catch (err) {
    if (mine !== seq) return;
    st.error = err.message || 'Could not load your achievements';
  }
  st.loading = false;
  emit(changeSubs);
}

// a friend's record (they must be on your friends list): { stats, unlocked: { id: ms } }
export async function friendAchievements(id) {
  return fromServer(await call(`/api/achievements/${encodeURIComponent(id)}`));
}

let started = false;
export function startAchievementsSync() {
  if (started) return;
  started = true;
  let user = '';
  onAccountChange((a) => {
    const id = a.user?.id || '';
    if (id === user) return;
    user = id;
    refreshAchievements();
  });
  if (accountState().user) {
    user = accountState().user.id;
    refreshAchievements();
  }
}

export const ACH_TOTAL = ACHIEVEMENTS.length;
