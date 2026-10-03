// Who this browser is to the server's leaderboard: a random id made up the first time the game is opened here
// and kept in localStorage under 'stn.player'. The server files this player's kills, nights, wins and revives
// under it (server/stats.js).
//
// It is the only thing that proves who the player is - whoever has it plays as them - so it goes to the server
// inside the JOIN and nowhere else: it is not shown, logged or put in a URL, and the server never sends it on.
// Clearing the browser's storage makes a new player of this one, and there is no way back to the old record.
const KEY = 'stn.player';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// a version 4 UUID. crypto.randomUUID is only there on a secure page (https, localhost): a game opened over a
// LAN address gets the same thing made from crypto.getRandomValues, which is there on any
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let id = ''; // as read or made: with storage refused (private mode, blocked) it lasts as long as the page does

export function playerId() {
  if (id) return id;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && UUID.test(stored)) return (id = stored);
  } catch {
    /* storage unavailable */
  }
  id = newId();
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable */
  }
  return id;
}

// The server's admin password, as this browser was last told it by `/admin <password>` in chat (game.js): kept in
// localStorage under 'stn.admin' and said to the server again in chat on every join, so whoever has it may run the
// admin commands there (the server checks it against its ADMIN_SECRET). `/admin` alone forgets it.
const ADMIN = 'stn.admin';

export function adminKey() {
  try {
    return localStorage.getItem(ADMIN) || '';
  } catch {
    return '';
  }
}

export function setAdminKey(key) {
  try {
    if (key) localStorage.setItem(ADMIN, key);
    else localStorage.removeItem(ADMIN);
  } catch {
    /* storage unavailable */
  }
}
