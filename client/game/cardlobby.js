// Dead Hand from the splash: reuses CardsClient's collection/deck/table handling over a /cards lobby socket.
import { CARDOP, CARDMSG } from '../../shared/protocol.js';
import { CardsClient } from './cards.js';
import { LobbyCardsConnection } from '../net/lobbycards.js';

export class LobbyCardsClient extends CardsClient {
  constructor({ ui, audio, name }) {
    let self = null;
    const g = {
      ui,
      audio,
      myId: 0,
      players: new Map(),
      name: (id) => self?.name(id) || 'Survivor',
      conn: { cards: (op, data) => self?.conn.cards(op, data) },
    };
    super(g);
    self = this;
    this.isLobby = true;
    this.getName = name;
    this.names = new Map();
    this.conn = new LobbyCardsConnection({ cards: (m) => this.onMessage(m), close: () => this.onClose() });
    this.s.tables = [];
  }

  reset() {
    super.reset();
    if (this.s) this.s.tables = [];
  }

  onClose() {
    this.s.tables = [];
    this.changed('tables');
  }

  ensureConnected() {
    this.conn.connect(this.getName());
  }

  open(view = 'lobby') {
    this.ensureConnected();
    this.screen.bind(this);
    this.screen.onClose = () => this.screen.setOpen(false);
    this.g.ui.setCardsOpen(true, view);
  }

  closeSocket() {
    this.conn.close();
  }

  name(id) {
    return this.names.get(id) || (id === this.myId ? this.getName() : `Player ${id}`);
  }

  onMessage(msg) {
    if (msg.op === CARDMSG.TABLES) {
      const d = msg.data || {};
      if (Number.isInteger(d.me) && d.me > 0) this.g.myId = d.me;
      this.names = new Map((Array.isArray(d.names) ? d.names : []).filter((r) => Array.isArray(r) && Number.isInteger(r[0])).map(([id, name]) => [id, String(name || '')]));
      this.s.tables = (Array.isArray(d.tables) ? d.tables : []).filter((t) => t && typeof t.id === 'string').map((t) => ({ id: t.id, host: t.host | 0, name: String(t.name || ''), slot: t.slot | 0, ageS: Math.max(0, t.ageS | 0) }));
      return this.changed('tables');
    }
    if (msg.op === CARDMSG.MATCH && msg.data?.oppName) this.names.set(msg.data.opp | 0, String(msg.data.oppName));
    if (msg.op === CARDMSG.MATCH_END && msg.data?.oppName) this.names.set(msg.data.opp | 0, String(msg.data.oppName));
    return super.onMessage(msg);
  }

  openTable(slot = this.lastSlot()) {
    this.rememberSlot(slot);
    this.send(CARDOP.TABLE_OPEN, { slot });
  }

  joinTable(id, slot = this.lastSlot()) {
    this.rememberSlot(slot);
    this.send(CARDOP.TABLE_JOIN, { id, slot });
  }

  leaveTable() {
    this.send(CARDOP.TABLE_LEAVE, {});
  }

  update(dt) {
    if (this.local) this.local.tick(dt, !this.screen.open);
    if (this.screen.open) this.screen.tick();
  }
}
