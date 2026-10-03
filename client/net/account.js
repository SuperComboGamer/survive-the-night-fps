// The account this browser is signed in to, if any (server/auth.js): registered with an email address, a name to
// play under and a password, signed in with the email or the name. The server keeps the sign-in in an HttpOnly
// cookie, so this page never sees it: it only asks the server who it is signed in as (/api/auth/me), and is told so
// by a register or a sign-in.
//
// A signed-in player plays under their account's name (the server sees to that), their stats are kept on the
// account, and they have friends (friends.js). Registering or signing in hands the server this browser's guest id
// (identity.js) as well, so whatever was earned here as a guest moves onto the account.
import { playerId } from './identity.js';
import { call, post } from './lobby.js';

const st = {
  ready: false, // the server has said, once, who this is
  accounts: true, // the server has accounts at all (false: no database behind it)
  offline: false, // the last time it was asked, it could not be reached
  user: null, // { id, username, email, createdAt }
};
const subs = new Set();
let asked = null;

function changed() {
  for (const fn of subs) {
    try {
      fn(st);
    } catch (err) {
      console.error(err);
    }
  }
}

function set(user, accounts = st.accounts) {
  const was = st.user?.id || '';
  const wasReady = st.ready;
  const wasAccounts = st.accounts;
  const wasName = st.user?.username || '';
  st.ready = true;
  st.offline = false;
  st.accounts = accounts;
  st.user = user && typeof user.id === 'string' ? user : null;
  if (was !== (st.user?.id || '') || !wasReady || wasAccounts !== accounts || wasName !== (st.user?.username || '')) changed();
}

// fn(state) whenever who is signed in changes (or the server first says); returns the way to stop
export function onAccountChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// { ready, accounts, offline, user }: read it, do not keep it (it is the one object, changed in place)
export const accountState = () => st;
export const signedInUser = () => st.user;

// Asks the server who this browser is signed in as. Never rejects: a server that cannot be reached leaves things as
// they were, with offline set.
export function refreshAccount() {
  if (asked) return asked;
  asked = call('/api/auth/me')
    .then((b) => set(b?.user || null, b?.accounts !== false))
    .catch(() => {
      const was = st.offline;
      st.offline = true;
      if (!was) changed();
    })
    .finally(() => (asked = null))
    .then(() => st);
  return asked;
}

// { email, username, password } -> the user, signed in. Rejects with the server's error (err.field: 'email',
// 'username' or 'password' when it is about one of them)
export async function register({ email, username, password }) {
  const b = await post('/api/auth/register', { email, username, password, guestId: playerId() }, 10000);
  set(b.user, true);
  return b.user;
}

// login: the email or the name
export async function login({ login, password }) {
  const b = await post('/api/auth/login', { login, password, guestId: playerId() }, 10000);
  set(b.user, true);
  return b.user;
}

export async function logout() {
  try {
    await post('/api/auth/logout', {});
  } finally {
    // (signed out here whatever the server said: at worst the cookie outlives this page's idea of it, and the next
    // refreshAccount says so)
    set(null);
  }
}

// your lifetime stats and your last matches: { stats: null | { kills, nights, wins, revives, games, deaths, downs,
// headshots, bossKills, bestDay, playSeconds, firstSeen, ranks }, recent: [match] }
export const myStats = () => call('/api/me/stats');
