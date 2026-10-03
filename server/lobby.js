// DEAD RIDE lobbies: the co-op game for 1-5 players hosted on this server. Players connect to /dr, see the open games,
// create one (map, name, size) or join one (from the list or by its code), mark themselves ready, and the host starts it.
// In play the server is the hub: text frames are lobby control (JSON), binary frames are game traffic that the server
// relays without reading - [dest u8, ...payload] in, [sender u8, ...payload] out, dest 0 = the host, 255 = everyone
// else, otherwise a player id. The host's browser runs the zombies and the rounds; when it leaves, the longest-standing
// player becomes the host and is told so (and the others are told who it is).
const MAX_LOBBIES = +(process.env.MAX_LOBBIES || 32);
const MAX_PER_LOBBY = 5;
const MAPS = ['shaft-nine', 'whiteout', 'last-ferry', 'after-hours'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RELAY_HOST = 0;
const RELAY_ALL = 255;

const clean = (text, max) =>
  String(text ?? '')
    .replace(/[^\p{L}\p{N} _\-.'!?]/gu, '')
    .trim()
    .slice(0, max);

export class Lobbies {
  constructor(log = (...a) => console.log('[lobby]', ...a)) {
    this.log = log;
    this.lobbies = new Map(); // code -> lobby
    this.clients = new Set();
    this.seq = 0;
  }

  // ---------------------------------------------------------------- connections
  open(conn) {
    // pid: unique per connection on this server, 1..250 within a lobby is what goes on the wire (lobby slot ids)
    const c = { conn, name: 'Survivor', lobby: null, pid: 0, ready: false, joinedAt: 0, msgT: 0, msgN: 0, bytesT: 0, bytesN: 0 };
    this.clients.add(c);
    return c;
  }

  close(c) {
    this.leave(c);
    this.clients.delete(c);
  }

  send(c, obj) {
    c.conn.sendText(JSON.stringify(obj));
  }

  // ---------------------------------------------------------------- text: lobby control
  text(c, raw) {
    // a little flood control: 40 control messages a second is plenty
    const now = Date.now();
    if (now - c.msgT > 1000) {
      c.msgT = now;
      c.msgN = 0;
    }
    if (++c.msgN > 40) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'hello':
        c.name = clean(m.name, 16) || 'Survivor';
        this.send(c, { t: 'welcome', maps: MAPS, max: MAX_PER_LOBBY });
        this.send(c, { t: 'lobbies', list: this.list() });
        break;
      case 'list':
        this.send(c, { t: 'lobbies', list: this.list() });
        break;
      case 'create':
        this.create(c, m);
        break;
      case 'join':
        this.join(c, String(m.code || '').toUpperCase());
        break;
      case 'quick': {
        // the fullest open game that still has room, or a new one
        let best = null;
        for (const l of this.lobbies.values()) {
          if (l.players.length >= l.max || l.private) continue;
          if (!best || l.players.length > best.players.length) best = l;
        }
        if (best) this.join(c, best.code);
        else this.create(c, { map: m.map, name: `${c.name}'s game` });
        break;
      }
      case 'leave':
        this.leave(c);
        this.send(c, { t: 'lobbies', list: this.list() });
        break;
      case 'ready':
        if (!c.lobby) break;
        c.ready = !!m.v;
        this.broadcastLobby(c.lobby);
        break;
      case 'settings': {
        const l = c.lobby;
        if (!l || l.host !== c || l.state !== 'lobby') break;
        if (MAPS.includes(m.map)) l.map = m.map;
        if (m.max) l.max = Math.max(Math.max(1, l.players.length), Math.min(MAX_PER_LOBBY, m.max | 0));
        if (m.name) l.name = clean(m.name, 24) || l.name;
        if (m.private !== undefined) l.private = !!m.private;
        this.broadcastLobby(l);
        this.pushList();
        break;
      }
      case 'start': {
        const l = c.lobby;
        if (!l || l.host !== c || l.state !== 'lobby') break;
        if (l.players.some((p) => p !== c && !p.ready)) return this.send(c, { t: 'error', msg: 'Not everyone is ready' });
        l.state = 'playing';
        l.seed = (Math.random() * 0xffffffff) >>> 0;
        l.started = Date.now();
        for (const p of l.players) this.send(p, { t: 'start', map: l.map, seed: l.seed, host: l.host.pid, you: p.pid, players: this.roster(l) });
        this.pushList();
        this.log(`${l.code} started ${l.map} with ${l.players.length}`);
        break;
      }
      case 'end': {
        // the host is back at the end screen: the game returns to its lobby (same players, same code)
        const l = c.lobby;
        if (!l || l.host !== c) break;
        l.state = 'lobby';
        for (const p of l.players) p.ready = false;
        this.broadcastLobby(l);
        this.pushList();
        break;
      }
      case 'kick': {
        const l = c.lobby;
        if (!l || l.host !== c) break;
        const p = l.players.find((x) => x.pid === m.pid && x !== c);
        if (p) {
          this.leave(p);
          this.send(p, { t: 'kicked' });
          this.send(p, { t: 'lobbies', list: this.list() });
        }
        break;
      }
      case 'chat': {
        const l = c.lobby;
        const text = String(m.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
        if (!l || !text) break;
        for (const p of l.players) this.send(p, { t: 'chat', pid: c.pid, name: c.name, text });
        break;
      }
    }
  }

  // ---------------------------------------------------------------- binary: game traffic relayed in a lobby
  binary(c, data) {
    const l = c.lobby;
    if (!l || l.state !== 'playing' || data.length < 2) return;
    // relay budget: 256 KB a second per sender is far above what the game needs and stops a runaway client
    const now = Date.now();
    if (now - c.bytesT > 1000) {
      c.bytesT = now;
      c.bytesN = 0;
    }
    c.bytesN += data.length;
    if (c.bytesN > 256 * 1024) return;
    const dest = data[0];
    const out = new Uint8Array(data.length);
    out.set(data);
    out[0] = c.pid; // (the first byte becomes who sent it)
    if (dest === RELAY_HOST) {
      if (l.host !== c) l.host.conn.sendBinary(out);
    } else if (dest === RELAY_ALL) {
      for (const p of l.players) if (p !== c) p.conn.sendBinary(out);
    } else {
      const p = l.players.find((x) => x.pid === dest);
      if (p && p !== c) p.conn.sendBinary(out);
    }
  }

  // ---------------------------------------------------------------- lobbies
  code() {
    for (;;) {
      let s = '';
      for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.lobbies.has(s)) return s;
    }
  }

  create(c, m) {
    if (this.lobbies.size >= MAX_LOBBIES) return this.send(c, { t: 'error', msg: 'The server is full of games: join one' });
    this.leave(c);
    const l = {
      code: this.code(),
      name: clean(m.name, 24) || `${c.name}'s game`,
      map: MAPS.includes(m.map) ? m.map : MAPS[0],
      max: Math.max(1, Math.min(MAX_PER_LOBBY, m.max | 0 || MAX_PER_LOBBY)),
      private: !!m.private,
      state: 'lobby',
      players: [],
      host: c,
      seed: 0,
      created: Date.now(),
    };
    this.lobbies.set(l.code, l);
    this.log(`${l.code} created by ${c.name} (${l.map})`);
    this.enter(c, l);
  }

  join(c, code) {
    const l = this.lobbies.get(code);
    if (!l) return this.send(c, { t: 'error', msg: 'No game with that code' });
    if (c.lobby === l) return;
    if (l.players.length >= l.max) return this.send(c, { t: 'error', msg: 'That game is full' });
    this.leave(c);
    this.enter(c, l);
  }

  // a player slot id the lobby is not using (1..250)
  slot(l) {
    for (let id = 1; id < 251; id++) if (!l.players.some((p) => p.pid === id)) return id;
    return 0;
  }

  enter(c, l) {
    c.lobby = l;
    c.pid = this.slot(l);
    c.ready = false;
    c.joinedAt = ++this.seq;
    l.players.push(c);
    this.send(c, { t: 'joined', code: l.code, you: c.pid });
    this.broadcastLobby(l);
    // into a game under way: the host sends this player the state of play
    if (l.state === 'playing') {
      this.send(c, { t: 'start', map: l.map, seed: l.seed, host: l.host.pid, you: c.pid, players: this.roster(l), late: true });
      for (const p of l.players) if (p !== c) this.send(p, { t: 'arrived', pid: c.pid, name: c.name });
    }
    this.pushList();
  }

  leave(c) {
    const l = c.lobby;
    if (!l) return;
    c.lobby = null;
    l.players = l.players.filter((p) => p !== c);
    if (!l.players.length) {
      this.lobbies.delete(l.code);
      this.log(`${l.code} closed`);
      this.pushList();
      return;
    }
    for (const p of l.players) this.send(p, { t: 'gone', pid: c.pid, name: c.name });
    if (l.host === c) {
      // the longest-standing player takes over
      l.host = l.players.reduce((a, b) => (a.joinedAt < b.joinedAt ? a : b));
      for (const p of l.players) this.send(p, { t: 'host', pid: l.host.pid });
      this.log(`${l.code} host is now ${l.host.name}`);
    }
    this.broadcastLobby(l);
    this.pushList();
  }

  roster(l) {
    return l.players.map((p) => ({ pid: p.pid, name: p.name, ready: p.ready, host: p === l.host }));
  }

  view(l) {
    return { code: l.code, name: l.name, map: l.map, max: l.max, private: l.private, state: l.state, host: l.host.pid, players: this.roster(l) };
  }

  broadcastLobby(l) {
    const v = this.view(l);
    for (const p of l.players) this.send(p, { t: 'lobby', lobby: v });
  }

  list() {
    const out = [];
    for (const l of this.lobbies.values()) {
      if (l.private) continue;
      out.push({ code: l.code, name: l.name, map: l.map, players: l.players.length, max: l.max, state: l.state, host: l.host.name });
    }
    return out;
  }

  // everyone browsing (in no lobby) sees the list change
  pushList() {
    const list = this.list();
    for (const c of this.clients) if (!c.lobby) this.send(c, { t: 'lobbies', list });
  }

  status() {
    let players = 0;
    for (const l of this.lobbies.values()) players += l.players.length;
    return { lobbies: this.lobbies.size, players, browsing: this.clients.size - players, games: this.list() }; // (games: the open ones, for the splash)
  }
}
