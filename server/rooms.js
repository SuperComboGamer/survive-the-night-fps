// Several games on one box: a room is one Game (its own world, rules and tick state). The main room always exists (it is
// the one the older single-game clients and /status mean); anyone can open more, of either mode, and others join them from
// the list. One process, one tick loop: every room is stepped in turn, and an empty room that was opened on request is
// closed after a minute.
import { Game } from './game.js';
import { MODE, validMode } from '../shared/modes.js';
import { PHASE } from '../shared/constants.js';

const MAX_ROOMS = +(process.env.MAX_ROOMS || 8);
const EMPTY_LIFE = 60; // seconds an opened room waits for its first player (and an emptied one stays) before it is closed

export class Rooms {
  constructor(baseOpts, perRoomPlayers) {
    this.base = baseOpts;
    this.maxPlayers = perRoomPlayers;
    this.rooms = new Map();
    this.seq = 0;
    this.main = this.add('main', 'Main', undefined, true);
  }

  add(id, name, mode, isMain = false) {
    const opts = { ...this.base, maxPlayers: this.maxPlayers, log: (...a) => console.log(`[${id}]`, ...a) };
    if (mode !== undefined) {
      opts.mode = mode;
      opts.lockMode = true; // an opened room plays the mode it was opened for, whoever joins it
    }
    const game = new Game(opts);
    const room = { id, name, game, main: isMain, emptySince: performance.now(), opened: Date.now() };
    this.rooms.set(id, room);
    return room;
  }

  // opens a room; null when there are too many already
  open(modeIn, nameIn) {
    if (this.rooms.size >= MAX_ROOMS) return null;
    const mode = validMode(modeIn);
    const id = `g${++this.seq}-${Math.random().toString(36).slice(2, 6)}`;
    const name = String(nameIn || '').replace(/[^\p{L}\p{N} _\-.']/gu, '').trim().slice(0, 24) || `Game ${this.seq}`;
    return this.add(id, name, mode);
  }

  get(id) {
    return this.rooms.get(id) || this.main;
  }

  list() {
    const out = [];
    for (const r of this.rooms.values()) {
      const g = r.game;
      out.push({ id: r.id, name: r.name, main: r.main, mode: g.mode, players: g.players.size, max: g.maxPlayers, phase: g.phase, day: g.day, seed: g.seed >>> 0, wait: g.phase === PHASE.WAITING });
    }
    return out;
  }

  update() {
    for (const r of this.rooms.values()) {
      try {
        r.game.update();
      } catch (err) {
        console.error(`[${r.id}] tick error`, err);
      }
    }
  }

  // closes the opened rooms nobody is in
  sweep(now = performance.now()) {
    for (const [id, r] of this.rooms) {
      if (r.game.players.size || r.game.sessions.size) {
        r.emptySince = now;
        continue;
      }
      if (!r.main && now - r.emptySince > EMPTY_LIFE * 1000) {
        this.rooms.delete(id);
        console.log(`[rooms] closed ${id} (${r.name}): empty`);
      }
    }
  }
}

export { MODE };
