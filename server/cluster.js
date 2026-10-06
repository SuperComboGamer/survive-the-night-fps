// Several game servers behind the proxy (server/proxy/): what each one tells the others, through Postgres.
//
// Off unless CLUSTER=1, and only with a Postgres database. A server on its own - a VM, a laptop, one Railway replica -
// runs as it always has, every game and every friend's presence in its own memory, and never touches any of this.
//
// Each server keeps a row of its own in cluster_servers (011_cluster.sql): where it can be reached, how busy it is,
// whether it is going down, refreshed every HEARTBEAT_MS; one not heard from for DEAD_S seconds is gone. Every game it
// runs is a row of cluster_games (code -> server, and the room's info for the lobby's list and a friend's presence),
// every account with a /social socket or a player here a row of cluster_presence. The proxy reads them to send each
// request to the server that has what it asks for. What has to reach the other servers at once - a message for a
// socket over there, a perk picked, a sign-out - is a NOTIFY on CHANNEL (publish / on).
//
// On a deploy the old server picks, for each game it hands over, the server of the new deployment it goes to
// (pickTarget): the save names it, the game's row points at it before its players are told to come back, and only it
// may claim the save (PgStore.claim) - so a player coming back finds the game where the proxy sends them.
import { networkInterfaces, hostname } from 'node:os';

const CHANNEL = 'stn_cluster';
export const HEARTBEAT_MS = 2000;
export const DEAD_S = 10; // without a heartbeat for this long a server is gone
const GONE_S = 60; // ...and after this long its rows are deleted
const STALE_S = 30; // a game row of ours not refreshed in this long is of a game that is not here
const NOTIFY_MAX = 7900; // NOTIFY's payload is at most 8000 bytes

// Where the proxy reaches this server: CLUSTER_ADDR, else Railway's private network (railnet0: its IPv6 address, the
// one every Railway environment routes), else the first IPv4 address of another interface, else this box (a proxy on
// the same machine)
export function clusterAddress() {
  if (process.env.CLUSTER_ADDR) return process.env.CLUSTER_ADDR;
  const ifs = networkInterfaces();
  const v4 = (list = []) => list.find((a) => a.family === 'IPv4' && !a.internal)?.address;
  const v6 = (list = []) => list.find((a) => a.family === 'IPv6' && !a.internal && !a.address.startsWith('fe80'))?.address;
  return v6(ifs.railnet0) || v4(ifs.railnet0) || v4(Object.values(ifs).flat()) || v6(Object.values(ifs).flat()) || '127.0.0.1';
}

// The servers that new games, quick joins and the rest go to: the live ones of the newest deployment that are not going
// down. (During a deploy both deployments are up for a while; the old one's are about to be told to stop.)
export function eligible(servers) {
  const up = servers.filter((s) => !s.draining);
  if (!up.length) return [];
  const newest = up.reduce((a, b) => (b.started > a.started ? b : a)).deployment;
  return up.filter((s) => s.deployment === newest);
}
// how busy a server is, for spreading the games out
export const load = (s) => s.players + 2 * s.games;

export class Cluster {
  // lobby: rooms.js Lobby. deployment: what this server came with (a commit), unless the env says
  constructor({ db, lobby, port, deployment = '', log = () => {} }) {
    this.db = db;
    this.lobby = lobby;
    this.log = log;
    this.port = port;
    this.id = process.env.CLUSTER_ID || process.env.RAILWAY_REPLICA_ID || `${hostname()}:${port}`;
    this.addr = clusterAddress();
    this.deployment = process.env.CLUSTER_DEPLOYMENT || process.env.RAILWAY_DEPLOYMENT_ID || deployment;
    this.build = ''; // the client build this server serves (start)
    this.started = Date.now();
    this.draining = false;
    this.servers = []; // the live servers as last read: { id, addr, port, deployment, started, draining, games, players }
    this.sent = new Map(); // server id -> games handed to it by this server while going down (pickTarget)
    this.handlers = new Map(); // message type -> fn(message)
    this.timer = null;
    this.unlisten = null;
    this.up = false;
  }

  // ---------------------------------------------------------------- this server's row
  async start({ build = '' } = {}) {
    this.build = build;
    // (what a process of ours before this one left behind: its games and players went with it)
    await this.db.query('DELETE FROM cluster_games WHERE server_id = $1', [this.id]);
    await this.db.query('DELETE FROM cluster_presence WHERE server_id = $1', [this.id]);
    await this.beat();
    this.unlisten = await this.db.listen(CHANNEL, (payload) => this.heard(payload));
    this.timer = setInterval(() => this.beat().catch((err) => this.log(`cluster: heartbeat failed (${err.message})`)), HEARTBEAT_MS);
    this.timer.unref();
    this.up = true;
    this.log(`cluster: ${this.id} at ${this.addr}:${this.port}, deployment ${this.deployment}`);
  }

  async beat() {
    const rooms = [...this.lobby.rooms.values()].filter((r) => !r.closed && !r.movingTo);
    const players = rooms.reduce((n, r) => n + Math.max(0, r.st.players), 0);
    const info = { defaultPlayers: this.lobby.maxPlayers, maxPlayers: this.lobby.roomMaxPlayers };
    await this.db.query(
      `INSERT INTO cluster_servers (id, addr, port, deployment, build, started_at, seen_at, draining, games, players, max_games, info)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), now(), $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET addr = EXCLUDED.addr, port = EXCLUDED.port, deployment = EXCLUDED.deployment, build = EXCLUDED.build,
         started_at = EXCLUDED.started_at, seen_at = now(), draining = EXCLUDED.draining, games = EXCLUDED.games,
         players = EXCLUDED.players, max_games = EXCLUDED.max_games, info = EXCLUDED.info`,
      [this.id, this.addr, this.port, this.deployment, this.build, this.started, this.draining, rooms.length, players, this.lobby.maxGames, JSON.stringify(info)]
    );
    if (rooms.length) {
      await this.db.query(
        `INSERT INTO cluster_games (code, server_id, invite_only, maker, info, updated_at)
         SELECT g.code, $1, g.invite_only, g.maker, g.info, now() FROM jsonb_to_recordset($2::jsonb) AS g(code text, invite_only boolean, maker text, info jsonb)
         ON CONFLICT (code) DO UPDATE SET server_id = EXCLUDED.server_id, invite_only = EXCLUDED.invite_only, maker = EXCLUDED.maker, info = EXCLUDED.info, updated_at = now()`,
        [this.id, JSON.stringify(rooms.map((r) => ({ code: r.code, invite_only: r.inviteOnly, maker: r.maker || null, info: r.info() })))]
      );
    }
    await this.db.query(`DELETE FROM cluster_games WHERE server_id = $1 AND updated_at < now() - make_interval(secs => $2)`, [this.id, STALE_S]);
    await this.readServers();
    // the servers long gone, and what named them
    await this.db.query(
      `WITH gone AS (DELETE FROM cluster_servers WHERE seen_at < now() - make_interval(secs => $1) RETURNING id),
            games AS (DELETE FROM cluster_games WHERE server_id IN (SELECT id FROM gone))
       DELETE FROM cluster_presence WHERE server_id IN (SELECT id FROM gone)`,
      [GONE_S]
    );
  }

  async readServers() {
    const r = await this.db.query(
      `SELECT id, addr, port, deployment, extract(epoch FROM started_at) * 1000 AS started, draining, games, players
         FROM cluster_servers WHERE seen_at > now() - make_interval(secs => $1)`,
      [DEAD_S]
    );
    this.servers = r.rows;
  }

  // Going down: nothing new is sent here from now on, and the servers to hand the games to are as fresh as can be
  async drain() {
    this.draining = true;
    if (!this.up) return;
    await this.beat();
  }

  // Gone: this server's rows go with it
  async stop() {
    clearInterval(this.timer);
    this.up = false;
    await this.unlisten?.().catch(() => {});
    await this.db.query('DELETE FROM cluster_presence WHERE server_id = $1', [this.id]);
    await this.db.query('DELETE FROM cluster_games WHERE server_id = $1', [this.id]);
    await this.db.query('DELETE FROM cluster_servers WHERE id = $1', [this.id]);
  }

  // ---------------------------------------------------------------- games
  // A game started here (made, or brought over from the last server): in the table before anyone is told its code
  roomUp(room) {
    return this.db
      .query(
        `INSERT INTO cluster_games (code, server_id, invite_only, maker, info, updated_at) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (code) DO UPDATE SET server_id = EXCLUDED.server_id, invite_only = EXCLUDED.invite_only, maker = EXCLUDED.maker, info = EXCLUDED.info, updated_at = now()`,
        [room.code, this.id, room.inviteOnly, room.maker || null, JSON.stringify(room.info())]
      )
      .catch((err) => this.log(`cluster: game ${room.code} not listed (${err.message})`));
  }
  // Before a game is made here: room for it over every server (max: the most games at once, null: no total), and its
  // maker (an account or a guest's address, '' for a quick join's) with no game going on any server. All of it under
  // one lock, so two servers making games at once cannot both take the last place. -> {} with the code taken (listed
  // as invite-only until roomUp lists it as it is), { mine: code } or { full: true }
  reserve({ code, maker = '', max = null }) {
    return this.db.tx(async (t) => {
      await t.query(`SELECT pg_advisory_xact_lock(hashtext('stn_cluster_games'))`);
      const live = `server_id IN (SELECT id FROM cluster_servers WHERE seen_at > now() - make_interval(secs => ${DEAD_S}))`;
      if (maker) {
        const mine = await t.query(`SELECT code FROM cluster_games WHERE maker = $1 AND ${live} LIMIT 1`, [maker]);
        if (mine.rows[0]) return { mine: mine.rows[0].code };
      }
      if (max !== null) {
        const n = (await t.query(`SELECT count(*)::int AS n FROM cluster_games WHERE ${live}`)).rows[0].n;
        if (n >= max) return { full: true };
      }
      await t.query(`INSERT INTO cluster_games (code, server_id, invite_only, maker, info, updated_at) VALUES ($1, $2, true, $3, '{}', now())`, [code, this.id, maker || null]);
      return {};
    });
  }
  // ...ended here (a game handed on is the next server's row by then)
  roomDown(room) {
    return this.db.query('DELETE FROM cluster_games WHERE code = $1 AND server_id = $2', [room.code, this.id]).catch(() => {});
  }
  // ...handed to that server: its players coming back are sent there
  moved(room, target) {
    return this.db.query(
      `INSERT INTO cluster_games (code, server_id, invite_only, maker, info, updated_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (code) DO UPDATE SET server_id = EXCLUDED.server_id, updated_at = now()`,
      [room.code, target, room.inviteOnly, room.maker || null, JSON.stringify(room.info())]
    );
  }

  // The server a game of ours goes to as this one goes down: the least busy of the newest deployment's, counting the
  // games already sent to each; null when there is none (then whoever asks first takes it, as with one server)
  pickTarget() {
    let best = null;
    let bestLoad = Infinity;
    for (const s of eligible(this.servers.filter((s) => s.id !== this.id))) {
      const l = load(s) + 2 * (this.sent.get(s.id) || 0);
      if (l < bestLoad) {
        best = s;
        bestLoad = l;
      }
    }
    if (best) this.sent.set(best.id, (this.sent.get(best.id) || 0) + 1);
    return best ? best.id : null;
  }

  // ---------------------------------------------------------------- presence
  // An account's sockets here: a /social one (online) and/or a player in game `code`; neither: nothing of it here
  presence(userId, online, code) {
    const q =
      online || code
        ? this.db.query(
            `INSERT INTO cluster_presence (user_id, server_id, online, code, at) VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (user_id, server_id) DO UPDATE SET online = EXCLUDED.online, code = EXCLUDED.code, at = now()`,
            [userId, this.id, !!online, code || null]
          )
        : this.db.query('DELETE FROM cluster_presence WHERE user_id = $1 AND server_id = $2', [userId, this.id]);
    return q.catch((err) => this.log(`cluster: presence of ${userId} not written (${err.message})`));
  }
  // Where these accounts are, on any live server -> Map(user id -> { status: 'playing' | 'online', game }); an account
  // not in it is offline
  async statusOf(ids) {
    const out = new Map();
    if (!ids.length) return out;
    const r = await this.db.query(
      `SELECT p.user_id, bool_or(p.online) AS online, (array_agg(g.info ORDER BY p.at DESC) FILTER (WHERE g.code IS NOT NULL))[1] AS game
         FROM cluster_presence p
         JOIN cluster_servers s ON s.id = p.server_id AND s.seen_at > now() - make_interval(secs => $2)
         LEFT JOIN cluster_games g ON g.code = p.code
        WHERE p.user_id = ANY($1::uuid[])
        GROUP BY p.user_id`,
      [ids, DEAD_S]
    );
    for (const row of r.rows) out.set(row.user_id, row.game ? { status: 'playing', game: row.game } : { status: row.online ? 'online' : 'offline', game: null });
    return out;
  }

  // ---------------------------------------------------------------- what the others hear at once
  on(type, fn) {
    this.handlers.set(type, fn);
  }
  publish(msg) {
    const payload = JSON.stringify({ ...msg, from: this.id });
    const bytes = Buffer.byteLength(payload);
    if (bytes > NOTIFY_MAX) return this.log(`cluster: a ${msg.t} too big to tell the other servers (${bytes} bytes)`);
    this.db.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]).catch((err) => this.log(`cluster: ${msg.t} not told (${err.message})`));
  }
  heard(payload) {
    let m;
    try {
      m = JSON.parse(payload);
    } catch {
      return;
    }
    if (m.from === this.id) return;
    try {
      this.handlers.get(m.t)?.(m);
    } catch (err) {
      this.log(`cluster: ${m.t} from ${m.from} failed (${err.message})`);
    }
  }
}
