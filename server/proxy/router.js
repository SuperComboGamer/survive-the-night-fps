// Where the proxy sends each request: what the game servers say of themselves in Postgres (server/cluster.js,
// 011_cluster.sql) - the live servers, read every REFRESH_MS, and per game code the server it is on.
import { DEAD_S, eligible, load } from '../cluster.js';
import { PHASE } from '../../shared/constants.js';

const REFRESH_MS = 1000;
const WAIT_MS = 6000; // a game between two servers (a deploy) is waited for this long
const POLL_MS = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Router {
  // settings: the game's settings in the database (serversettings.js), for the total of games the lobby shows
  constructor({ db, settings = null, log = () => {} }) {
    this.db = db;
    this.settings = settings;
    this.log = log;
    this.servers = []; // live: { id, addr, port, deployment, started, draining, games, players, maxGames, info }
    this.byId = new Map();
    this.next = 0; // (round robin over the servers for everything that is not a game's)
    this.timer = null;
    this.failing = false;
  }

  async start() {
    await this.refresh();
    this.timer = setInterval(() => this.refresh().catch(() => {}), REFRESH_MS);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
  }

  async refresh() {
    try {
      const r = await this.db.query(
        `SELECT id, addr, port, deployment, extract(epoch FROM started_at) * 1000 AS started, draining, games, players, max_games, info
           FROM cluster_servers WHERE seen_at > now() - make_interval(secs => $1) ORDER BY id`,
        [DEAD_S]
      );
      this.servers = r.rows.map((s) => ({ ...s, maxGames: s.max_games }));
      this.byId = new Map(this.servers.map((s) => [s.id, s]));
      const seen = this.servers.map((s) => `${s.id} at ${s.addr}:${s.port}${s.draining ? ' (draining)' : ''}`).join(', ');
      if (seen !== this.seen) this.log(`router: ${this.servers.length} server(s)${seen ? `: ${seen}` : ''}`);
      this.seen = seen;
      if (this.failing) this.log('router: the database answers again');
      this.failing = false;
    } catch (err) {
      if (!this.failing) this.log(`router: cannot read the servers (${err.message}): routing by what it read last`);
      this.failing = true;
      throw err;
    }
  }

  // the servers new things go to (the newest deployment's, not going down); every live one if none of them is
  pool() {
    const e = eligible(this.servers);
    return e.length ? e : this.servers;
  }
  // the least busy of those: where a new game goes (the same one for two asking at once: ties go by id). made: a game is
  // being made there, counted at once (the server's own count comes with its next heartbeat)
  leastLoaded({ made = false } = {}) {
    let best = null;
    for (const s of this.pool()) if (!best || load(s) < load(best)) best = s;
    if (best && made) best.games++;
    return best;
  }
  // any of them, in turn: the page, the API, /social
  // any server, in turn. via: one asked for by id (x-stn-via, for checking a cluster from outside), when it is up
  any(via = null) {
    const asked = via && this.live(via);
    if (asked && !asked.draining) return asked;
    const p = this.pool();
    if (!p.length) return null;
    this.next = (this.next + 1) % p.length;
    return p[this.next];
  }
  live(id) {
    return this.byId.get(id) || null;
  }

  // The server game `code` is on, or null when no server has it (then the caller sends the request anywhere, to be told
  // so). A game being handed from a server going down to the next waits for the move, up to WAIT_MS.
  async gameServer(code) {
    code = String(code || '').toUpperCase();
    if (!/^[A-Z2-9]{6,10}$/.test(code)) return null;
    const until = Date.now() + WAIT_MS;
    for (;;) {
      const [game, saved] = await Promise.all([
        this.db.query('SELECT server_id FROM cluster_games WHERE code = $1', [code]),
        this.db.query(`SELECT meta->>'target' AS target FROM game_handoff WHERE code = $1`, [code]),
      ]);
      const home = game.rows[0] && this.live(game.rows[0].server_id);
      if (home && !home.draining) return home;
      if (saved.rows[0]) {
        // saved for the next server: the one it was saved for, or (that one gone) whoever is least busy, who claims it
        const t = this.live(saved.rows[0].target);
        return t && !t.draining ? t : this.leastLoaded();
      }
      if (!home) return null;
      // still on a server going down, which is about to save it
      if (Date.now() > until) return home;
      await sleep(POLL_MS);
      await this.refresh().catch(() => {});
    }
  }

  // Where a quick join goes: the server with the public game a quick join there would pick (the fullest that has a
  // seat, one that is ending last - as rooms.js Lobby.quick), or the least busy server, which makes one
  async quickServer() {
    const r = await this.db.query('SELECT server_id, info FROM cluster_games WHERE NOT invite_only');
    let best = null;
    let bestKey = -1;
    for (const { server_id, info } of r.rows) {
      const s = this.live(server_id);
      if (!s || s.draining || info.full) continue;
      const ending = info.phase === PHASE.GAMEOVER || info.phase === PHASE.VICTORY;
      const key = (ending ? 0 : 1000) + info.seats;
      if (key > bestKey) {
        best = s;
        bestKey = key;
      }
    }
    return best || this.leastLoaded({ made: true });
  }

  // GET /api/games over every server: { games, maxGames, canCreate, players, defaultPlayers, maxPlayers, list }
  async lobby() {
    const r = await this.db.query('SELECT server_id, info FROM cluster_games WHERE NOT invite_only');
    const list = r.rows.filter((g) => this.live(g.server_id)).map((g) => g.info);
    list.sort((a, b) => b.seats - a.seats || a.ageS - b.ageS);
    const up = this.servers.filter((s) => !s.draining);
    const any = this.pool()[0];
    const games = this.servers.reduce((n, s) => n + s.games, 0);
    const total = this.settings?.maxTotalGames ?? null;
    const room = up.reduce((n, s) => n + s.maxGames, 0);
    return {
      games,
      maxGames: total === null ? room : Math.min(room, total),
      canCreate: this.pool().some((s) => s.games < s.maxGames) && (total === null || games < total),
      players: this.servers.reduce((n, s) => n + s.players, 0),
      defaultPlayers: any?.info?.defaultPlayers,
      maxPlayers: any?.info?.maxPlayers,
      list,
    };
  }
}
