// Friends and direct messages, for a signed-in player (account.js; server/social.js). A friend is someone who
// accepted your request or whose request you accepted: both ways round, kept on the server. Friends see whether
// each other is offline, online (the game open somewhere, signed in) or playing - and then in which game, with the
// code to join it by, invite-only games included - and can message each other.
//
// What is known comes from the HTTP API (/api/friends, /api/messages); what happens while the page is open comes
// down the /social socket: a message, a request, a friend's presence changing. A change of the list there is only
// a nudge to ask for the list again (a burst of them asks once). The socket is open for as long as this page is
// signed in, and comes back on its own after a drop, waiting longer each time.
import { call, post } from './lobby.js';
import { onAccountChange, refreshAccount } from './account.js';

const st = {
  loaded: false, // the list has come at least once since signing in
  error: '', // why the last ask for it failed ('' = it did not)
  live: false, // the /social socket is open: presence and messages come as they happen
  friends: [], // [{ id, username, status: 'offline' | 'online' | 'playing', game, unread, lastSeen, since }]
  incoming: [], // [{ id, username, at }]: asking you
  outgoing: [], // [{ id, username, at }]: you asked them
};
const convs = new Map(); // friend id -> { messages: [{ id, from, to, body, at, read }] oldest first, more, loaded, loading, error, v }
const subs = new Set();
const hears = new Set();
let me = null; // { id, username }
let openId = ''; // the conversation on screen: whatever comes in on it is read as it comes
let helloUnread = 0; // the socket's count, until the list has come
let ws = null;
let wsTimer = 0;
let backoff = 1000;
let soonT = 0;
let listReq = null;
let listAgain = false;
const readT = new Map(); // friend id -> timer: a "read" about to go to the server

const sameId = (a, b) => String(a) === String(b);
const lower = (s) => String(s || '').toLowerCase();

function changed() {
  for (const fn of subs) {
    try {
      fn(st);
    } catch (err) {
      console.error(err);
    }
  }
}

function tell(ev) {
  for (const fn of hears) {
    try {
      fn(ev);
    } catch (err) {
      console.error(err);
    }
  }
}

// fn(state) whenever the lists, a presence, an unread count or a conversation changes; returns the way to stop
export function onSocialChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// fn(event) for what is worth telling the player about as it happens (returns the way to stop):
//   { t: 'dm', message, from: { id, username } }   a message from a friend (not one of yours)
//   { t: 'request', who: { id, username } }       someone asked to be your friend
//   { t: 'accepted', who: { id, username } }      someone said yes to your request
export function onSocialEvent(fn) {
  hears.add(fn);
  return () => hears.delete(fn);
}

export const socialState = () => st;
export const friend = (id) => st.friends.find((f) => sameId(f.id, id)) || null;
export const isFriendName = (name) => !!name && st.friends.some((f) => lower(f.username) === lower(name));
export const requestedName = (name) => !!name && st.outgoing.some((r) => lower(r.username) === lower(name));
export const askedByName = (name) => (name && st.incoming.find((r) => lower(r.username) === lower(name))) || null;
export const playingFriends = () => st.friends.filter((f) => f.status === 'playing' && f.game);
// messages from friends nobody has read yet
export const unreadCount = () => (st.loaded ? st.friends.reduce((n, f) => n + (f.unread | 0), 0) : helloUnread);

// ---------------------------------------------------------------- the list
// Asks for the list now (one ask at a time: asked again while one is out, it asks once more when that is back)
export function refreshFriends() {
  if (!me) return Promise.resolve(st);
  if (listReq) {
    listAgain = true;
    return listReq;
  }
  const who = me.id;
  const req = (listReq = call('/api/friends')
    .then(
      (b) => {
        if (me?.id !== who) return;
        st.friends = Array.isArray(b?.friends) ? b.friends : [];
        st.incoming = Array.isArray(b?.incoming) ? b.incoming : [];
        st.outgoing = Array.isArray(b?.outgoing) ? b.outgoing : [];
        st.loaded = true;
        st.error = '';
        // the conversation on screen is being read: what the list still counts there is read now
        const f = openId && friend(openId);
        if (f?.unread) {
          f.unread = 0;
          markRead(openId);
        }
        changed();
      },
      (err) => {
        if (me?.id !== who) return;
        st.error = err.message || 'Could not reach the server';
        changed();
        if (err.status === 401) refreshAccount(); // (the sign-in ran out: account.js finds out, and this stops)
      }
    )
    .finally(() => {
      if (listReq === req) listReq = null;
      if (listAgain) {
        listAgain = false;
        refreshFriends();
      }
    })
    .then(() => st));
  return req;
}

// ...a moment from now, once for a burst of nudges
function soon(ms = 250) {
  clearTimeout(soonT);
  soonT = setTimeout(refreshFriends, ms);
}

// { username } -> { result: 'sent' | 'accepted' (they had asked you) | 'pending' (asked already) | 'already' (friends), friend }.
// Rejects with the server's words (404: nobody by that name; 400: yourself)
export async function requestFriend(username) {
  const r = await post('/api/friends/request', { username: String(username || '').trim() });
  soon(0);
  return r;
}

export async function acceptFriend(id) {
  await post('/api/friends/accept', { id });
  st.incoming = st.incoming.filter((r) => !sameId(r.id, id));
  changed();
  soon(0);
}

// turns their request down, or takes yours back
export async function declineFriend(id) {
  await post('/api/friends/decline', { id });
  st.incoming = st.incoming.filter((r) => !sameId(r.id, id));
  st.outgoing = st.outgoing.filter((r) => !sameId(r.id, id));
  changed();
  soon(0);
}

export async function removeFriend(id) {
  await post('/api/friends/remove', { id });
  st.friends = st.friends.filter((f) => !sameId(f.id, id));
  convs.delete(String(id));
  changed();
  soon(0);
}

// where a friend is playing right now, to join them: the game's info, its code included (rejects: 404 when they are
// not in a game, 403 when they are not a friend)
export const friendGame = (id) => call(`/api/friends/${encodeURIComponent(id)}/game`);

// anyone's profile by the account name they play under: { username, since, xp, level, perks, stats } (rejects: 404
// for nobody by that name, 503 on a server without accounts)
export const fetchProfile = (username) => call(`/api/players/${encodeURIComponent(username)}`);

// ---------------------------------------------------------------- conversations
function conv(id) {
  const k = String(id);
  let c = convs.get(k);
  if (!c) convs.set(k, (c = { messages: [], more: false, loaded: false, loading: false, error: '', v: 0 }));
  return c;
}

// puts messages in a conversation that are not in it yet, oldest first
function merge(c, list) {
  const seen = new Set(c.messages.map((m) => String(m.id)));
  for (const m of list) {
    if (!m || seen.has(String(m.id))) continue;
    seen.add(String(m.id));
    c.messages.push({ id: m.id, from: m.from, to: m.to, body: String(m.body ?? ''), at: m.at, read: !!m.read });
  }
  c.messages.sort((a, b) => Number(a.id) - Number(b.id));
  c.v++;
}

// The conversation with a friend as it stands here: { messages, more (there are older ones), loaded, loading, error,
// v (goes up with every change) }
export const conversation = (id) => conv(id);

// Asks for the latest of it (and, when it was asked for before, adds what came since)
export async function loadConversation(id) {
  const c = conv(id);
  if (c.loading) return c;
  c.loading = true;
  c.error = '';
  c.v++;
  changed();
  try {
    const b = await call(`/api/messages/${encodeURIComponent(id)}`);
    const first = !c.loaded;
    merge(c, Array.isArray(b?.messages) ? b.messages : []);
    if (first) c.more = !!b?.more;
    c.loaded = true;
  } catch (err) {
    c.error = err.message || 'Could not load the conversation';
  } finally {
    c.loading = false;
    c.v++;
    changed();
  }
  return c;
}

// the page before the oldest it has
export async function loadOlder(id) {
  const c = conv(id);
  if (c.loading || !c.more || !c.messages.length) return c;
  c.loading = true;
  c.v++;
  changed();
  try {
    const b = await call(`/api/messages/${encodeURIComponent(id)}?before=${encodeURIComponent(c.messages[0].id)}`);
    merge(c, Array.isArray(b?.messages) ? b.messages : []);
    c.more = !!b?.more;
  } catch (err) {
    c.error = err.message || 'Could not load older messages';
  } finally {
    c.loading = false;
    c.v++;
    changed();
  }
  return c;
}

// -> the message as sent. Rejects with the server's words (403: not friends any more; 429: too fast)
export async function sendMessage(id, body) {
  const b = await post('/api/messages', { to: id, body });
  if (b?.message) merge(conv(id), [b.message]);
  changed();
  return b?.message;
}

// everything they sent is read (said to the server a moment later, once for a burst)
export function markRead(id) {
  const f = friend(id);
  if (f) f.unread = 0;
  const c = convs.get(String(id));
  if (c) for (const m of c.messages) if (sameId(m.from, id)) m.read = true;
  clearTimeout(readT.get(String(id)));
  readT.set(
    String(id),
    setTimeout(() => {
      readT.delete(String(id));
      if (me) post('/api/messages/read', { friendId: id }).catch(() => {});
    }, 200)
  );
}

// The conversation on screen ('' = none): what it already has unread, and whatever comes in on it, is read
export function setOpenConversation(id) {
  openId = id ? String(id) : '';
  if (openId && friend(openId)?.unread) {
    markRead(openId);
    changed();
  }
}

function gotMessage(m) {
  if (!m || !me) return;
  const mine = sameId(m.from, me.id);
  const other = String(mine ? m.to : m.from);
  const c = convs.get(other);
  if (c && (c.loaded || c.loading)) merge(c, [m]);
  if (!mine) {
    const f = friend(other);
    if (openId === other) markRead(other);
    else if (f) f.unread = (f.unread | 0) + 1;
    else soon(); // (a friend the list does not have yet)
    tell({ t: 'dm', message: m, from: { id: other, username: m.fromName || f?.username || 'A friend' } });
  }
  changed();
}

// ---------------------------------------------------------------- the /social socket
function heard(text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  switch (msg?.t) {
    case 'hello':
      helloUnread = msg.unread | 0;
      refreshFriends(); // (anything missed while it was down)
      break;
    case 'dm':
      gotMessage(msg.message);
      break;
    case 'friends': {
      const who = msg.who || {};
      if (msg.why === 'request' && who.username) tell({ t: 'request', who });
      else if (msg.why === 'accepted') {
        // (both sides hear it: it is news only to the one whose request it was)
        const asked = st.outgoing.find((r) => sameId(r.id, who.id));
        if (asked) tell({ t: 'accepted', who: { id: who.id, username: who.username || asked.username } });
      } else if (msg.why === 'presence') {
        // shown at once; the list says where they are playing a moment later
        const f = friend(who.id);
        if (f && msg.status && f.status !== msg.status) {
          f.status = msg.status;
          if (msg.status !== 'playing') f.game = null;
          changed();
        }
      }
      soon();
      break;
    }
    case 'read':
      if (msg.friendId) {
        markReadHere(msg.friendId);
        changed();
      }
      break;
  }
}

// read in another tab: only this page's idea of it changes
function markReadHere(id) {
  const f = friend(id);
  if (f) f.unread = 0;
  const c = convs.get(String(id));
  if (c) {
    for (const m of c.messages) if (sameId(m.from, id)) m.read = true;
    c.v++;
  }
}

function connect() {
  clearTimeout(wsTimer);
  if (ws || !me) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let opened = false;
  let s;
  try {
    s = ws = new WebSocket(`${proto}://${location.host}/social`);
  } catch {
    ws = null;
    return retry();
  }
  s.onopen = () => {
    if (ws !== s) return;
    opened = true;
    backoff = 1000;
    st.live = true;
    changed();
  };
  s.onmessage = (m) => ws === s && typeof m.data === 'string' && heard(m.data);
  s.onclose = (e) => {
    if (ws !== s) return;
    ws = null;
    if (st.live) {
      st.live = false;
      changed();
    }
    if (!me) return;
    // signed out (in another tab of this browser): account.js finds out, and everything here stops
    if (e.code === 4001) return void refreshAccount();
    // never got in, which a sign-in that has run out does too (refused with a 401): ask, and only try again while
    // still signed in
    if (!opened) refreshAccount().then(() => me && retry());
    else retry();
  };
  s.onerror = () => {};
}

function retry() {
  clearTimeout(wsTimer);
  wsTimer = setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 30000);
}

function disconnect() {
  clearTimeout(wsTimer);
  const s = ws;
  ws = null;
  st.live = false;
  if (s) {
    try {
      s.close(1000);
    } catch {}
  }
}

// signing in, out, or as someone else: everything known is someone else's
onAccountChange((a) => {
  const u = a.user;
  if ((u?.id || '') === (me?.id || '')) {
    if (u && me) me.username = u.username;
    return;
  }
  disconnect();
  clearTimeout(soonT);
  for (const t of readT.values()) clearTimeout(t);
  readT.clear();
  convs.clear();
  openId = '';
  helloUnread = 0;
  listReq = null;
  listAgain = false;
  Object.assign(st, { loaded: false, error: '', live: false, friends: [], incoming: [], outgoing: [] });
  me = u ? { id: u.id, username: u.username } : null;
  if (me) {
    backoff = 1000;
    connect();
    refreshFriends();
  }
  changed();
});
