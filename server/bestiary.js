// The bestiary in a game (shared/bestiary.js has the book): which kinds of the dead each player has seen. Game builds
// one as this.bestiary. A player's record is held on them (p.bst) for as long as they play here: a guest's starts empty
// (their browser keeps the rest), an account's is read from the database once, as they join (the network thread:
// Room.record -> userbestiary.js, back as onBestiary), and nothing is looked for on their behalf until it has come.
//
// A few times a second each survivor's surroundings are looked at for the kinds they have not seen yet - only those,
// through the zombies' own spatial hash, with a handful of lines of sight at most. A kind seen for the first time goes
// onto the record, to the client (EVT.BESTIARY) and, for an account, to the network thread to be written, once.
import { EVT } from '../shared/defs.js';
import { BESTF, BESTIARY_ALL, SEEN_RANGE, bit, cleanSeen } from '../shared/bestiary.js';
import { eyeHeight } from '../shared/playersim.js';

const LOOK_EVERY = 5; // ticks between two looks round a survivor (4 a second at 20 Hz)
const LOOK_RAYS = 6; // lines of sight tried per survivor per look, at most

export class BestiaryTracker {
  // post: ({ user, mask }) => void, to the network thread: an account saw these kinds for the first time (none: no
  // accounts, and nothing to wait for)
  constructor(game, post) {
    this.g = game;
    this.post = typeof post === 'function' ? post : null;
  }

  // (a plain object: the handoff carries it over with the player, gamestate.js)
  //   seen    the kinds on their record (an account's from the database, and what they have seen here)
  //   loaded  the record is here to go by (a guest's at once; an account's once the network thread answers)
  //   all     the client is to be sent the whole record (it has just come, or a new client has)
  //   fresh   kinds seen for the first time that the client has not been told of yet
  of(p) {
    return p.bst || (p.bst = { seen: 0, loaded: !p.account || !this.post, all: true, fresh: 0 });
  }

  // Game.handleJoin, once they are in, and Game.resume: a new client, which is told the record again
  join(p) {
    this.of(p).all = true;
  }

  // the network thread's answer for the record with this token: the account's record from the database
  loaded(tok, mask) {
    for (const p of this.g.players.values()) {
      if (!p.rec || p.rec.tok !== tok || !p.account) continue;
      const st = this.of(p);
      st.seen |= cleanSeen(mask);
      st.loaded = true;
      st.all = true;
    }
  }

  // ---------------------------------------------------------------- every tick (Game.update), after the zombies moved
  tick() {
    const g = this.g;
    for (const p of g.players.values()) {
      if (p.away) continue; // (dropped: nothing is seen, and nothing would reach them)
      const st = this.of(p);
      if (!st.loaded) continue;
      if (p.alive && st.seen !== BESTIARY_ALL && (g.tick + p.id) % LOOK_EVERY === 0) this.look(p, st);
      if (st.all || st.fresh) this.tell(p, st);
    }
  }

  // the kinds not on their record that are in sight of them now
  look(p, st) {
    const zm = this.g.zm;
    const s = p.state;
    const ex = s.x;
    const ey = s.y + eyeHeight(s);
    const ez = s.z;
    const r2 = SEEN_RANGE * SEEN_RANGE;
    let found = 0;
    let rays = LOOK_RAYS;
    zm.forNear(ex, ez, SEEN_RANGE, (z) => {
      if (z.dead || rays <= 0) return;
      const b = bit(z.ztype);
      if ((st.seen | found) & b) return;
      const ty = z.y + z.def.headY; // (the head: what shows over a barricade or the edge of a porch)
      const dx = z.x - ex;
      const dy = ty - ey;
      const dz = z.z - ez;
      if (dx * dx + dy * dy + dz * dz > r2) return;
      rays--;
      if (zm.clearLine(ex, ey, ez, z.x, ty, z.z)) found |= b;
    });
    if (!found) return;
    st.seen |= found;
    st.fresh |= found;
    if (p.account && this.post) this.post({ user: p.account, mask: found });
  }

  // What the client has not heard yet goes out - not to a client whose socket is backed up: its snapshots are held
  // back, and the events in them would be lost (Game.sendSnapshots)
  tell(p, st) {
    if (p.session.conn.congested?.()) return;
    const account = p.account ? BESTF.ACCOUNT : 0;
    if (st.all) this.emit(p, BESTF.ALL | account, st.seen & ~st.fresh);
    if (st.fresh) this.emit(p, account, st.fresh);
    st.all = false;
    st.fresh = 0;
  }

  emit(p, flags, mask) {
    this.g.emit(
      (w) => {
        w.u8(EVT.BESTIARY);
        w.u8(flags);
        w.u16(mask);
      },
      { to: p.id },
    );
  }
}
