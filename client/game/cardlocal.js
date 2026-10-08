// A match of Dead Hand played on this page alone: "Practice vs the computer" (game/cards.js) and the UI sandbox's
// table (sandbox/ui-test.js ?screen=cards). The same engine the server plays (shared/cardgame.js), the player as side 0
// and the computer (shared/cardai.js chooseMove) as side 1, with a moment's thought before each of its moves so they
// can be followed. Nothing of it reaches the server: no cards are won or lost, and nothing is kept.
//
// onUpdate(view, events): after every move, and whenever the clock does something (a timeout, the redraw running
// out), with the player's view (viewFor) and what they may see of what happened (eventsFor).
import { newMatch, applyMove, tick, viewFor, eventsFor } from '../../shared/cardgame.js';
import { chooseMove } from '../../shared/cardai.js';

const ME = 0;
const CPU = 1;
const THINK = [0.7, 1.5]; // seconds the computer takes over a move: at least, at most

// a small seeded random source for the computer's choices (apart from the match's own, which is in its state)
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class LocalMatch {
  // decks: [the player's, the computer's] ({ leader, cards }); level: 'easy' | 'normal'
  constructor({ seed = 1, decks, level = 'normal', onUpdate = null } = {}) {
    this.st = newMatch({ seed, decks });
    this.level = level === 'easy' ? 'easy' : 'normal';
    this.rand = mulberry(seed ^ 0x9e3779b9);
    this.onUpdate = onUpdate;
    this.think = this.thinkTime();
    this.moves = 0; // the player's moves taken (the sandbox plays a number of them)
  }

  thinkTime() {
    return THINK[0] + this.rand() * (THINK[1] - THINK[0]);
  }

  view() {
    return viewFor(this.st, ME);
  }

  get over() {
    return this.st.phase === 'over';
  }

  emit(evs) {
    if (evs.length) this.onUpdate?.(this.view(), eventsFor(evs, ME));
  }

  // the player's move -> { ok, error? }
  move(m) {
    const r = applyMove(this.st, ME, m);
    if (r.ok) {
      this.moves++;
      this.emit(r.events);
    }
    return r;
  }

  // Does the computer have something to do now?
  cpuToAct() {
    const st = this.st;
    if (st.phase === 'redraw') return !st.p[CPU].redrawDone;
    if (st.phase !== 'play') return false;
    if (st.pending) return st.pending.side === CPU;
    return st.turn === CPU && !st.passed[CPU];
  }

  // The computer's move, now (its own think time not waited for) -> whether it made one
  cpuMove() {
    if (!this.cpuToAct()) return false;
    let mv = null;
    try {
      mv = chooseMove(viewFor(this.st, CPU), { rand: this.rand, level: this.level });
    } catch (err) {
      console.error('cards: the computer could not choose', err);
    }
    let r = mv ? applyMove(this.st, CPU, mv) : { ok: false };
    // (a move the engine turns down: it passes, or keeps its hand)
    if (!r.ok) r = applyMove(this.st, CPU, this.st.phase === 'redraw' ? { t: 'keep' } : { t: 'pass' });
    if (!r.ok) r = applyMove(this.st, CPU, { t: 'forfeit' });
    this.emit(r.events || []);
    return true;
  }

  // every frame: the clock (stood still while the player's screen is shut: away), and the computer's turn
  tick(dt, away = false) {
    if (this.over) return;
    this.emit(tick(this.st, dt, [away, false]));
    if (this.cpuToAct()) {
      this.think -= dt;
      if (this.think <= 0) {
        this.think = this.thinkTime();
        this.cpuMove();
      }
    } else this.think = Math.max(this.think, THINK[0]);
  }

  // seconds left to the side to act, its turn then its bank
  clockLeft() {
    const st = this.st;
    const side = st.phase === 'redraw' ? -1 : st.pending ? st.pending.side : st.turn;
    return st.clock > 0 || side < 0 ? st.clock : st.bank[side];
  }
}

