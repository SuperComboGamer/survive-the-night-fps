// A Dead Hand socket for the splash/lobby. It uses the same card frames as an in-run game, but has no world socket.
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, writeCards, readCards } from '../../shared/protocol.js';
import { playerId } from './identity.js';

export class LobbyCardsConnection {
  constructor(handlers = {}) {
    this.h = handlers;
    this.ws = null;
    this.open = false;
    this.w = new Writer(512);
    this.r = new Reader(new ArrayBuffer(0));
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/cards`;
  }

  connect(name) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const ws = new WebSocket(this.url());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      const w = this.w.reset();
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str(name);
      w.str(playerId());
      ws.send(w.copy());
    };
    ws.onmessage = (m) => {
      const r = this.r.set(m.data);
      const type = r.u8();
      if (type !== S2C.CARDS) return;
      try {
        this.h.cards?.(readCards(r));
      } catch (err) {
        console.warn('[net] a lobby card message could not be read', err);
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.open = false;
      this.h.close?.();
    };
    ws.onerror = () => {};
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    this.open = false;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'leaving lobby cards');
  }

  cards(op, data = {}) {
    const ws = this.ws;
    if (!this.open || !ws || ws.readyState !== WebSocket.OPEN) return;
    const w = this.w.reset();
    w.u8(C2S.CARDS);
    writeCards(w, op, data);
    ws.send(w.bytes());
  }
}
