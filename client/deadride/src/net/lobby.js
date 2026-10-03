// The connection to the DEAD RIDE lobby on the server (server/lobby.js): JSON text frames for the lobby, binary frames
// for game traffic relayed between the players of a game ([dest, ...payload] out, [sender, ...payload] in).
export const TO_HOST = 0;
export const TO_ALL = 255;

export class LobbyClient {
  constructor() {
    this.ws = null;
    this.open = false;
    this.name = 'Survivor';
    this.you = 0; // this player's id in the lobby it is in
    this.lobby = null; // the lobby it is in (server's view: code, name, map, max, state, host, players)
    this.list = [];
    this.maps = [];
    this.max = 5;
    this.handlers = new Map(); // type -> Set of fns
    this.onBinary = null; // (sender, Uint8Array payload)
  }

  on(t, fn) {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set());
    this.handlers.get(t).add(fn);
    return () => this.handlers.get(t).delete(fn);
  }

  emit(t, m) {
    for (const fn of this.handlers.get(t) || []) {
      try {
        fn(m);
      } catch (e) {
        console.error('[lobby] handler', t, e);
      }
    }
  }

  connect(name) {
    this.name = name;
    if (this.ws && this.open) {
      this.send({ t: 'hello', name });
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/dr`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        this.open = true;
        this.send({ t: 'hello', name });
        resolve();
      };
      ws.onerror = () => {
        if (!this.open) reject(new Error('Could not reach the game server'));
      };
      ws.onclose = () => {
        const was = this.open;
        this.open = false;
        this.lobby = null;
        if (was) this.emit('closed', {});
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') {
          const b = new Uint8Array(e.data);
          if (b.length > 1) this.onBinary?.(b[0], b.subarray(1));
          return;
        }
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          this.maps = m.maps;
          this.max = m.max;
        } else if (m.t === 'lobbies') this.list = m.list;
        else if (m.t === 'joined') this.you = m.you;
        else if (m.t === 'lobby') this.lobby = m.lobby;
        else if (m.t === 'host' && this.lobby) this.lobby.host = m.pid;
        else if (m.t === 'kicked') this.lobby = null;
        this.emit(m.t, m);
      };
    });
  }

  send(o) {
    if (this.open) this.ws.send(JSON.stringify(o));
  }

  // game traffic: dest TO_HOST, TO_ALL or a player id; payload a Uint8Array (its first byte is overwritten: pass room for it)
  sendBinary(dest, buf) {
    if (!this.open) return;
    buf[0] = dest;
    this.ws.send(buf);
  }

  get isHost() {
    return !!this.lobby && this.lobby.host === this.you;
  }

  leave() {
    this.send({ t: 'leave' });
    this.lobby = null;
  }

  close() {
    this.ws?.close();
  }
}
