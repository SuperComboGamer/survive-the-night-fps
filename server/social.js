// Friends and direct messages, between accounts (auth.js).
//
// A friend is someone who accepted your request, or whose request you accepted: both ways round, or not at all.
// Friends see each other's presence - offline, online (the game open in a browser, signed in) or playing, and then
// which game, the code to join it by included: an invite-only game's code goes to its players' friends, and to
// nobody else. Only friends can message each other.
//
// A signed-in page keeps a socket open at /social (text frames, JSON) for what happens while it is open: a message
// for it, a request, a friend's presence changing. Everything there is to know is also in the HTTP API, which the
// page asks when it hears something changed:
//   { t: 'hello', user: { id, username }, unread }        on connecting
//   { t: 'dm', message }                                  a message to or from this account (another tab's too)
//   { t: 'friends', why, who }                            the friends list changed: why is 'request' (who asked
//                                                         you), 'accepted', 'declined', 'removed' or 'presence'
//   { t: 'read', friendId }                               this account read that conversation (in another tab)
import { HttpError } from './http.js';
import { Allowance } from './allowance.js';

const MAX_FRIENDS = 200;
const MAX_OUTGOING = 50;
const PAGE = 50;
const BODY_MAX = 500;
const PRESENCE_MS = 400; // presence changes of one account inside this are told once
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cleanBody = (v) =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
        .replace(/\s+$/g, '')
        .replace(/^\s+/g, '')
    : '';
const checkId = (v) => {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, 'Bad request');
  return v.toLowerCase();
};
const msgOut = (r) => ({ id: r.id, from: r.sender_id, to: r.recipient_id, body: r.body, at: r.created_at, read: !!r.read_at });

export class Social {
  // lobby: where everyone is playing (rooms.js Lobby: playingRoom, onPresence). cluster: the other servers behind the
  // proxy (cluster.js), when there are any - then a friend may be online or playing on another one, and what is pushed
  // to an account reaches its sockets there too
  constructor({ db, auth, lobby, cluster = null, log = () => {}, netMetrics = null }) {
    this.db = db;
    this.auth = auth;
    this.lobby = lobby;
    this.cluster = cluster;
    this.log = log;
    this.netMetrics = netMetrics;
    this.socks = new Map(); // user id -> Set of /social sockets
    this.friendCache = new Map(); // user id -> Set of friend ids, for the accounts online (dropped as they go)
    this.sends = new Allowance(20, 1.5); // per account: messages
    this.asks = new Allowance(10, 30); // per account: friend requests
    this.pending = new Map(); // user id -> timer: a presence change about to be told
    this.writes = new Map(); // user id -> the last of its presence rows being written (cluster.js)
    lobby.onPresence = (userId) => this.presence(userId);
    auth.onSignOut = (userId, hash) => this.signedOut(userId, hash);
    cluster?.on('push', (m) => this.heardPush(m));
    cluster?.on('signout', (m) => this.closeSession(m.user, m.hash));
  }

  // ---------------------------------------------------------------- presence
  // (a /social socket open on this server)
  online(userId) {
    return (this.socks.get(userId)?.size || 0) > 0;
  }

  // Map(id -> { status: 'playing' (and the game) | 'online' | 'offline', game }) for these accounts: on this server, or
  // on any other behind the proxy
  async statuses(ids) {
    const out = new Map();
    const rest = [];
    for (const id of ids) {
      const room = this.lobby.playingRoom(id);
      if (room) out.set(id, { status: 'playing', game: room.info() });
      else rest.push(id);
    }
    const far =
      this.cluster && rest.length
        ? await this.cluster.statusOf(rest).catch((err) => {
            this.log(`social: presence on the other servers not read (${err.message})`);
            return new Map();
          })
        : new Map();
    for (const id of rest) {
      const f = far.get(id);
      out.set(id, f?.status === 'playing' ? f : { status: this.online(id) || f?.status === 'online' ? 'online' : 'offline', game: null });
    }
    return out;
  }

  async friendIds(userId) {
    const hit = this.friendCache.get(userId);
    if (hit) return hit;
    const ids = new Set((await this.db.query('SELECT friend_id FROM friendships WHERE user_id = $1', [userId])).rows.map((r) => r.friend_id));
    if (this.online(userId) || this.lobby.playingRoom(userId)) this.friendCache.set(userId, ids);
    return ids;
  }

  // Their presence changed: the other servers know at once, and their friends who are online hear of it (once for a
  // burst of changes)
  presence(userId) {
    if (this.cluster) {
      // (in order, one after the other: a quick in-and-out must not be written out-and-in)
      const prev = this.writes.get(userId) || Promise.resolve();
      const next = prev.then(() => this.cluster.presence(userId, this.online(userId), this.lobby.playingRoom(userId)?.code));
      this.writes.set(userId, next);
      next.then(() => this.writes.get(userId) === next && this.writes.delete(userId));
    }
    if (this.pending.has(userId)) return;
    this.pending.set(
      userId,
      setTimeout(async () => {
        this.pending.delete(userId);
        try {
          await this.writes.get(userId);
          const st = (await this.statuses([userId])).get(userId);
          this.pushAll([...(await this.friendIds(userId))], { t: 'friends', why: 'presence', who: { id: userId }, status: st.status });
          if (!this.online(userId) && !this.lobby.playingRoom(userId)) {
            this.friendCache.delete(userId);
            await this.db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]);
          }
        } catch (err) {
          this.log(`social: presence of ${userId} not told (${err.message})`);
        }
      }, PRESENCE_MS)
    );
  }

  push(userId, msg) {
    this.pushAll([userId], msg);
  }
  // to these accounts' sockets, here and on the other servers
  pushAll(ids, msg) {
    for (const id of ids) this.pushHere(id, msg);
    if (!this.cluster) return;
    for (let i = 0; i < ids.length; i += 100) this.cluster.publish({ t: 'push', to: ids.slice(i, i + 100), msg });
  }
  pushHere(userId, msg) {
    const set = this.socks.get(userId);
    if (!set) return;
    const text = JSON.stringify(msg);
    for (const ws of set) {
      try {
        this.netMetrics?.wsOut('social', text);
        ws.send(text, false);
      } catch {}
    }
  }
  // a push from another server: what this one keeps of the friends lists changes with it
  heardPush({ to, msg }) {
    if (!Array.isArray(to) || !msg) return;
    for (const id of to) {
      if (msg.t === 'friends' && msg.who?.id) {
        if (msg.why === 'accepted') this.friendCache.get(id)?.add(msg.who.id);
        else if (msg.why === 'removed') this.friendCache.get(id)?.delete(msg.who.id);
      }
      this.pushHere(id, msg);
    }
  }

  // ---------------------------------------------------------------- the /social socket
  async socketOpened(ws) {
    const { user } = ws.getUserData();
    let set = this.socks.get(user.id);
    const first = !set;
    if (!set) this.socks.set(user.id, (set = new Set()));
    set.add(ws);
    if (first) this.presence(user.id);
    try {
      const unread = (await this.db.query('SELECT count(*)::int AS n FROM direct_messages WHERE recipient_id = $1 AND read_at IS NULL', [user.id])).rows[0].n;
      if (set.has(ws)) {
        const text = JSON.stringify({ t: 'hello', user: { id: user.id, username: user.name }, unread });
        this.netMetrics?.wsOut('social', text);
        ws.send(text, false);
      }
    } catch (err) {
      this.log(`social: hello failed (${err.message})`);
    }
  }

  socketClosed(ws) {
    const { user } = ws.getUserData();
    const set = this.socks.get(user.id);
    if (!set) return;
    set.delete(ws);
    if (set.size) return;
    this.socks.delete(user.id);
    this.presence(user.id);
  }

  signedOut(userId, hash) {
    this.closeSession(userId, hash);
    this.cluster?.publish({ t: 'signout', user: userId, hash });
  }
  // that browser's sockets here, and what this server remembers of its session
  closeSession(userId, hash) {
    this.auth.cache?.delete(hash);
    for (const ws of [...(this.socks.get(userId) || [])]) {
      if (ws.getUserData().user.hash !== hash) continue;
      try {
        ws.end(4001, 'Signed out');
      } catch {}
    }
  }

  // ---------------------------------------------------------------- friends
  // -> { friends: [{ id, username, since, lastSeen, status, game, unread }], incoming: [{ id, username, at }], outgoing }
  async list(me) {
    const [friends, incoming, outgoing, unread] = await Promise.all([
      this.db.query('SELECT u.id, u.username, u.last_seen_at, f.created_at FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = $1', [me.id]),
      this.db.query('SELECT u.id, u.username, r.created_at FROM friend_requests r JOIN users u ON u.id = r.from_id WHERE r.to_id = $1 ORDER BY r.created_at DESC', [me.id]),
      this.db.query('SELECT u.id, u.username, r.created_at FROM friend_requests r JOIN users u ON u.id = r.to_id WHERE r.from_id = $1 ORDER BY r.created_at DESC', [me.id]),
      this.db.query('SELECT sender_id, count(*)::int AS n FROM direct_messages WHERE recipient_id = $1 AND read_at IS NULL GROUP BY sender_id', [me.id]),
    ]);
    const unreadBy = new Map(unread.rows.map((r) => [r.sender_id, r.n]));
    const ids = new Set(friends.rows.map((r) => r.id));
    if (this.online(me.id) || this.lobby.playingRoom(me.id)) this.friendCache.set(me.id, ids);
    const st = await this.statuses([...ids]);
    return {
      friends: friends.rows.map((r) => ({ id: r.id, username: r.username, since: r.created_at, lastSeen: r.last_seen_at, unread: unreadBy.get(r.id) || 0, ...st.get(r.id) })),
      incoming: incoming.rows.map((r) => ({ id: r.id, username: r.username, at: r.created_at })),
      outgoing: outgoing.rows.map((r) => ({ id: r.id, username: r.username, at: r.created_at })),
    };
  }

  async areFriends(a, b) {
    const ids = this.friendCache.get(a);
    if (ids) return ids.has(b);
    return (await this.db.query('SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2', [a, b])).rowCount > 0;
  }

  // A request to the account with that name. -> { result: 'sent' | 'accepted' (they had asked you) | 'already' | 'pending', friend }
  async request(me, username) {
    const name = typeof username === 'string' ? username.trim().replace(/^@/, '') : '';
    if (!name) throw new HttpError(400, 'Type the name they play under.');
    const them = (await this.db.query('SELECT id, username FROM users WHERE lower(username) = lower($1)', [name])).rows[0];
    if (!them) throw new HttpError(404, `Nobody plays under the name ${name.slice(0, 16)}.`);
    if (them.id === me.id) throw new HttpError(400, 'That is you.');
    const friend = { id: them.id, username: them.username };
    if (await this.areFriends(me.id, them.id)) return { result: 'already', friend };
    const theirs = (await this.db.query('SELECT 1 FROM friend_requests WHERE from_id = $1 AND to_id = $2', [them.id, me.id])).rowCount;
    if (theirs) {
      await this.accept(me, them.id);
      return { result: 'accepted', friend };
    }
    const mine = (await this.db.query('SELECT 1 FROM friend_requests WHERE from_id = $1 AND to_id = $2', [me.id, them.id])).rowCount;
    if (mine) return { result: 'pending', friend };
    if (!this.asks.take(me.id)) throw new HttpError(429, 'You have sent a lot of friend requests just now. Wait a little.');
    const [nf, no] = await Promise.all([
      this.db.query('SELECT count(*)::int AS n FROM friendships WHERE user_id = $1', [me.id]),
      this.db.query('SELECT count(*)::int AS n FROM friend_requests WHERE from_id = $1', [me.id]),
    ]);
    if (nf.rows[0].n >= MAX_FRIENDS) throw new HttpError(409, `You have ${MAX_FRIENDS} friends: the most there can be.`);
    if (no.rows[0].n >= MAX_OUTGOING) throw new HttpError(409, 'You have a lot of requests nobody has answered yet. Cancel some first.');
    await this.db.query('INSERT INTO friend_requests (from_id, to_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me.id, them.id]);
    this.push(them.id, { t: 'friends', why: 'request', who: { id: me.id, username: me.name } });
    this.push(me.id, { t: 'friends', why: 'sent', who: friend });
    return { result: 'sent', friend };
  }

  async accept(me, fromId) {
    fromId = checkId(fromId);
    const done = await this.db.tx(async (t) => {
      const req = await t.query('DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2', [fromId, me.id]);
      if (!req.rowCount) return false;
      await t.query('DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2', [me.id, fromId]);
      await t.query('INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [me.id, fromId]);
      return true;
    });
    if (!done) throw new HttpError(404, 'That request is not there any more.');
    this.friendCache.get(me.id)?.add(fromId);
    this.friendCache.get(fromId)?.add(me.id);
    this.push(fromId, { t: 'friends', why: 'accepted', who: { id: me.id, username: me.name } });
    this.push(me.id, { t: 'friends', why: 'accepted', who: { id: fromId } });
    return { ok: true };
  }

  // turns down their request, or takes back mine
  async decline(me, otherId) {
    otherId = checkId(otherId);
    const r = await this.db.query('DELETE FROM friend_requests WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)', [otherId, me.id]);
    if (r.rowCount) {
      this.push(otherId, { t: 'friends', why: 'declined', who: { id: me.id } });
      this.push(me.id, { t: 'friends', why: 'declined', who: { id: otherId } });
    }
    return { ok: true };
  }

  async remove(me, friendId) {
    friendId = checkId(friendId);
    const r = await this.db.query('DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [me.id, friendId]);
    this.friendCache.get(me.id)?.delete(friendId);
    this.friendCache.get(friendId)?.delete(me.id);
    if (r.rowCount) {
      this.push(friendId, { t: 'friends', why: 'removed', who: { id: me.id } });
      this.push(me.id, { t: 'friends', why: 'removed', who: { id: friendId } });
    }
    return { ok: true };
  }

  // Where a friend is playing, for joining them: the game's info (its code included), or a 404 / 403
  async findFriend(me, friendId) {
    friendId = checkId(friendId);
    if (!(await this.areFriends(me.id, friendId))) throw new HttpError(403, 'You can only join your friends.');
    const st = (await this.statuses([friendId])).get(friendId);
    if (st.status !== 'playing') throw new HttpError(404, 'They are not in a game right now.');
    return st.game;
  }

  // ---------------------------------------------------------------- messages
  // The conversation with a friend, the latest PAGE messages before message `before` (none: the latest), oldest first
  async history(me, friendId, before) {
    friendId = checkId(friendId);
    if (!(await this.areFriends(me.id, friendId))) throw new HttpError(403, 'You can only message your friends.');
    const b = /^\d{1,18}$/.test(String(before || '')) ? String(before) : null;
    const r = await this.db.query(
      `SELECT * FROM direct_messages
        WHERE LEAST(sender_id, recipient_id) = LEAST($1::uuid, $2::uuid) AND GREATEST(sender_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
          AND ($3::bigint IS NULL OR id < $3::bigint)
        ORDER BY id DESC LIMIT ${PAGE}`,
      [me.id, friendId, b]
    );
    return { messages: r.rows.reverse().map(msgOut), more: r.rows.length === PAGE };
  }

  async send(me, to, body) {
    to = checkId(to);
    const text = cleanBody(body);
    if (!text) throw new HttpError(400, 'Say something first.');
    if (text.length > BODY_MAX) throw new HttpError(400, `A message is ${BODY_MAX} characters at most.`);
    if (!(await this.areFriends(me.id, to))) throw new HttpError(403, 'You can only message your friends.');
    if (!this.sends.take(me.id)) throw new HttpError(429, 'Slow down a little.');
    const row = (await this.db.query('INSERT INTO direct_messages (sender_id, recipient_id, body) VALUES ($1, $2, $3) RETURNING *', [me.id, to, text])).rows[0];
    const message = { ...msgOut(row), fromName: me.name };
    this.push(to, { t: 'dm', message });
    this.push(me.id, { t: 'dm', message });
    return { message };
  }

  async markRead(me, friendId) {
    friendId = checkId(friendId);
    const r = await this.db.query('UPDATE direct_messages SET read_at = now() WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL', [me.id, friendId]);
    if (r.rowCount) this.push(me.id, { t: 'read', friendId });
    return { ok: true };
  }
}
