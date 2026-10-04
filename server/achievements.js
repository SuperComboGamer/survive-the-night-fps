// Achievements in a game: what each player does that counts towards one (shared/achievements.js has the list and
// the rules). Game builds one as this.ach; the game's code calls one-line hooks where things happen (game.js,
// combat.js, zombies.js, fixtures.js), as it does for the match analytics. Hooks only bump counts on the player
// (p.ach) or note a feat; nothing is scanned per tick but the once-a-second look at where each survivor is.
//
// What a player has earned goes out every few seconds, or at once for a feat:
//   a guest     to their browser, as EVT.ACHIEVE: the counts to add and the feats. The browser keeps the record
//               (client/net/achievements.js) and decides the counters; the server knows nothing of what it holds,
//               so each feat goes once per connection.
//   an account  to the network thread (post), which keeps the record in the database (userachievements.js) and
//               answers with what that unlocked (achieved): the player is told with EVT.ACHIEVE (ACHF.ACCOUNT) and
//               the game hears of it in the chat.
import { SERVER_TICK_RATE, ESCAPE_RADIUS } from '../shared/constants.js';
import { ITEM, ZTYPE, ZONE, CONT, KILLER, EVT } from '../shared/defs.js';
import { ACH_STATS, ACH_STAT_INDEX, ACH_BY_ID, ACHF, KILL_FEATS } from '../shared/achievements.js';
import { swimming } from '../shared/swim.js';
import { handcars } from '../shared/handcar.js';

const SEND_EVERY = 3; // seconds: counts are gathered this long before they go out (a feat goes at once)
const MOVE_MAX = 15; // m/s: further than this between two looks is a respawn or a teleport, not travel
const LOW_HP = 10; // health under this at sunrise: By a Thread
const SWIM_ACROSS = 60; // m from where the swim began to where it ended
const BLAST_KILLS = 5; // the dead killed by one grenade or pipe bomb
const LINE_END = 8; // points of the line (m) from an end of a handcar's stretch that count as reaching it
const DEEP_ROOM = 6; // m from the strongbox: the deepest room of the mine
const DODGE_NEAR = 15; // m: a Tank's charge that ends this close to the one it was after, and missed them
const WHEEL_SEATS = 8; // the fair's seats 0-7 are the Ferris wheel's gondolas (shared/fair.js)

const fresh = () => ({
  add: {}, // stat -> count not sent yet
  feats: new Set(), // feats not sent yet
  sent: new Set(), // feats already sent on this connection (a guest's browser is told each once)
  strangers: new Set(), // accounts revived that may or may not be friends (the network thread knows)
  asked: new Set(), // ...and the ones already asked about
  sentT: 0,
  m: 0, // metres covered, not yet whole
  x: NaN,
  z: NaN,
  places: new Set(), // the places visited this run (zone ids)
  night: null, // { fired } from nightfall, if they were a survivor then
  swim: null, // where a swim began
  drowning: false, // took water since their last breath of air
  cart: null, // { k, min, max }: the stretch of line covered on the handcar they ride
});

export class AchievementTracker {
  // post: (message) => void, to the network thread, for players signed in to an account (none: no accounts)
  constructor(game, post) {
    this.g = game;
    this.post = typeof post === 'function' ? post : null;
    this.runDeaths = 0; // survivors who died this run (Flawless)
    this.town = new Set(); // the containers of Hollow Creek searched this run...
    this.townBy = new Set(); // ...and who searched them
    this.world = null; // the world the spots below are for
    this.village = 0; // containers in Hollow Creek
    this.deep = null; // the strongbox, at the bottom of the mine
  }

  of(p) {
    return p.ach || (p.ach = fresh());
  }

  // the handoff (server/gamestate.js): the run's own record, the containers and players in it by id. A player's own
  // (p.ach) goes with the player; the spots in the valley are found again (places)
  save() {
    return { runDeaths: this.runDeaths, town: [...this.town].map((c) => c.id), townBy: [...this.townBy].map((p) => p.id) };
  }
  load(s) {
    const g = this.g;
    this.runDeaths = s.runDeaths;
    this.town = new Set(s.town.map((id) => g.ents[id]).filter(Boolean));
    this.townBy = new Set(s.townBy.map((id) => g.ents[id]).filter(Boolean));
  }

  // ---------------------------------------------------------------- plumbing
  bump(p, stat, n = 1) {
    if (!p || n <= 0) return;
    const st = this.of(p);
    st.add[stat] = (st.add[stat] || 0) + n;
  }

  feat(p, id) {
    if (!p || !ACH_BY_ID.has(id)) return;
    const st = this.of(p);
    if (st.sent.has(id)) return;
    st.sent.add(id);
    st.feats.add(id);
  }

  // What the player has earned since the last time goes out: to their browser, or for an account to the network thread
  send(p) {
    const st = this.of(p);
    st.sentT = this.g.time;
    const add = st.add;
    const feats = [...st.feats];
    st.add = {};
    st.feats.clear();
    const strangers = [...st.strangers];
    st.strangers.clear();
    if (p.account) {
      if (this.post) this.post({ user: p.account, add, feats, strangers });
      return;
    }
    const stats = ACH_STATS.filter((k) => add[k] > 0);
    if (!stats.length && !feats.length) return;
    this.g.emit(
      (w) => {
        w.u8(EVT.ACHIEVE);
        w.u8(0);
        w.u8(stats.length);
        for (const k of stats) {
          w.u8(ACH_STAT_INDEX[k]);
          w.varu(Math.min(0x7fffffff, Math.floor(add[k])));
        }
        w.u8(feats.length);
        for (const id of feats) w.u8(ACH_BY_ID.get(id).n);
      },
      { to: p.id },
    );
  }

  pending(st) {
    if (st.feats.size || st.strangers.size) return true;
    for (const k in st.add) if (st.add[k] > 0) return true;
    return false;
  }

  // The network thread has written an account's progress: these unlocked (ids). Told to the player, and to the game
  achieved(userId, ids) {
    const g = this.g;
    const list = ids.map((id) => ACH_BY_ID.get(id)).filter(Boolean);
    if (!list.length) return;
    for (const p of g.players.values()) {
      if (p.account !== userId) continue;
      g.emit(
        (w) => {
          w.u8(EVT.ACHIEVE);
          w.u8(ACHF.ACCOUNT);
          w.u8(0);
          w.u8(list.length);
          for (const a of list) w.u8(a.n);
        },
        { to: p.id },
      );
      g.systemChat(`${p.name} unlocked ${list.map((a) => a.name).join(', ')}.`);
      break;
    }
  }

  // ---------------------------------------------------------------- the run
  // the spots the place achievements are about, once for each world
  places() {
    const w = this.g.world;
    if (this.world === w) return;
    this.world = w;
    this.village = w.containers.filter((c) => c.zone === ZONE.VILLAGE).length;
    const box = w.containers.find((c) => c.ctype === CONT.STRONGBOX);
    this.deep = box ? { x: box.x, y: box.y, z: box.z } : null;
  }

  // Game.startGame, once the run is set up
  start() {
    this.runDeaths = 0;
    this.town.clear();
    this.townBy.clear();
    this.places();
    for (const p of this.g.players.values()) {
      const st = this.of(p);
      st.places.clear();
      st.night = null;
      st.x = NaN;
    }
  }

  // Game.handleJoin, once they are in
  join(p) {
    this.of(p);
    if (this.g.inviteOnly) this.feat(p, 'invited');
  }

  // Game.removePlayer: what they earned last goes out (their browser has gone: only an account still gets it)
  leave(p) {
    if (p.account && p.ach && this.pending(p.ach)) this.send(p);
  }

  // ---------------------------------------------------------------- once a second (Game.update calls it every tick)
  tick() {
    const g = this.g;
    if (g.tick % SERVER_TICK_RATE !== 0) return;
    this.places();
    const w = g.world;
    for (const p of g.players.values()) {
      const st = this.of(p);
      if (p.away) continue; // (dropped: what they earn waits until they are back, or would go to a closed socket)
      if (p.alive && !p.zombie) this.look(p, st, w);
      else {
        st.x = NaN;
        st.swim = null;
        st.cart = null;
      }
      if (st.feats.size || (this.pending(st) && g.time - st.sentT > SEND_EVERY - 0.5)) this.send(p);
    }
  }

  // where a survivor is, and what that counts for
  look(p, st, w) {
    const g = this.g;
    const s = p.state;
    const d = Math.hypot(s.x - st.x, s.z - st.z);
    if (d <= MOVE_MAX + 1) st.m += d;
    st.x = s.x;
    st.z = s.z;
    if (st.m >= 1) {
      const whole = Math.floor(st.m);
      st.m -= whole;
      this.bump(p, 'distance', whole);
    }
    // down the mine
    const under = !!w.mine && w.mine.under(s.x, s.y + 0.3, s.z);
    if (under) {
      this.feat(p, 'mine_enter');
      const b = this.deep;
      if (b && Math.hypot(s.x - b.x, s.z - b.z) < DEEP_ROOM && Math.abs(s.y - b.y) < 4) this.feat(p, 'mine_deep');
    } else {
      // every place in the valley (a drift of the mine runs under places it does not come up in)
      for (const z of w.zones) if (!st.places.has(z.id) && Math.hypot(s.x - z.x, s.z - z.z) < z.flat + 6) st.places.add(z.id);
      if (st.places.size >= w.zones.length) this.feat(p, 'landmarks');
    }
    // a swim, and the water that nearly had them
    const afloat = swimming(w, s);
    if (afloat && !st.swim) st.swim = { x: s.x, z: s.z };
    else if (!afloat && st.swim) {
      if (Math.hypot(s.x - st.swim.x, s.z - st.swim.z) >= SWIM_ACROSS) this.feat(p, 'swim_lake');
      st.swim = null;
    }
    if (st.drowning && !afloat && !p.downed) {
      st.drowning = false;
      this.feat(p, 'near_drown');
    }
    // a handcar, from one end of its line to the other
    if (s.cart) {
      const run = handcars(w)[s.cart - 1];
      if (!st.cart || st.cart.k !== s.cart) st.cart = { k: s.cart, min: s.cartS, max: s.cartS };
      st.cart.min = Math.min(st.cart.min, s.cartS);
      st.cart.max = Math.max(st.cart.max, s.cartS);
      if (run && st.cart.min <= run.lo + LINE_END && st.cart.max >= run.hi - LINE_END) this.feat(p, 'handcar_run');
    } else st.cart = null;
    // the Ferris wheel, turning
    if (s.ride >= 1 && s.ride <= WHEEL_SEATS && g.fair?.running) this.feat(p, 'ferris');
  }

  // ---------------------------------------------------------------- nights
  // Game.startNight: who is there to see this one through
  nightfall() {
    for (const p of this.g.players.values()) this.of(p).night = p.alive && !p.zombie ? { fired: false } : null;
  }

  // Game.startDay, before the dead come back: whoever saw the night through
  dawn() {
    for (const p of this.g.players.values()) {
      const st = this.of(p);
      const night = st.night;
      st.night = null;
      if (!p.alive || p.zombie) continue;
      this.bump(p, 'nights');
      if (night && !night.fired) this.feat(p, 'pacifist');
      if (!p.downed && p.hp < LOW_HP) this.feat(p, 'low_hp');
      if (!p.away) this.send(p); // (with the sunrise, not a few seconds after it)
    }
  }

  // Game.victory, before anything about the players changes
  victory() {
    const g = this.g;
    const car = g.world.car;
    for (const p of g.players.values()) {
      if (!p.alive || p.zombie) continue;
      if (Math.hypot(p.state.x - car.x, p.state.z - car.z) <= ESCAPE_RADIUS) this.bump(p, 'escapes');
      if (!this.runDeaths) this.feat(p, 'flawless');
      this.send(p);
    }
  }

  drove(p) {
    this.feat(p, 'driver');
  }

  // ---------------------------------------------------------------- combat
  // Combat.fire: a shot (the mounted gun's too)
  shot(p, weapon) {
    const st = this.of(p);
    if (st.night) st.night.fired = true;
    if (weapon === ITEM.FLARE_GUN) this.feat(p, 'flare');
  }

  // Combat.killZombie (a: the survivor credited with it, or null)
  kill(a, z, opts, sunKill) {
    if (!a) return;
    this.bump(a, 'kills');
    if (opts.headshot) this.bump(a, 'headshots');
    const kind = KILL_FEATS[opts.weapon];
    if (kind) this.feat(a, kind);
    if (z.boss && !sunKill && !z.onFire) this.feat(a, 'kill_boss');
    if (z.ztype === ZTYPE.TANK) this.feat(a, 'kill_tank');
    if (z.ward && !this.g.zombies.some((o) => o.ward && !o.dead)) this.feat(a, 'clinic_clear');
  }

  // Combat.explode: what one blast killed (owner: who set it off)
  blast(owner, weapon, kills) {
    if (owner && kills >= BLAST_KILLS && (weapon === ITEM.GRENADE || weapon === ITEM.PIPEBOMB)) this.feat(owner, 'grenade_5');
  }

  // Game.useItem / the throw: a consumable used, a throwable thrown
  used(p, item) {
    if (item === ITEM.FLARE) this.feat(p, 'flare');
  }

  // Game.killPlayer, before anything about them changes
  death(p, src) {
    const g = this.g;
    const killer = src.kind === KILLER.PLAYER ? g.players.get(src.id) : null;
    if (p.zombie) {
      // a turned player put down: the survivor's kill
      if (killer && !killer.zombie) {
        this.bump(killer, 'kills');
        if (src.headshot) this.bump(killer, 'headshots');
      }
      return;
    }
    this.runDeaths++;
    const st = this.of(p);
    st.night = null;
    st.drowning = false;
    if (src.fall) this.feat(p, 'fall_death');
    if (src.drown) this.feat(p, 'drowned');
    if (killer && killer.zombie) this.feat(killer, 'turncoat');
  }

  // Game.revive (by: the teammate, null for their own medkit)
  revive(p, by) {
    if (!by || by === p) return;
    this.bump(by, 'revives');
    // a guest has no friends; with two accounts only the network thread knows
    if (by.account && p.account) {
      const st = this.of(by);
      if (!st.asked.has(p.account)) {
        st.asked.add(p.account);
        st.strangers.add(p.account);
      }
    } else this.feat(by, 'stranger');
  }

  // Zombies.throwOff: a pinned survivor threw the leaper off
  threwOff(p) {
    this.feat(p, 'leaper_off');
  }

  // zombies.js: a Tank's charge at `targetId` ended without hitting anyone
  dodged(z, targetId) {
    const p = this.g.players.get(targetId);
    if (!p || !p.alive || p.zombie || p.downed) return;
    if (Math.hypot(p.state.x - z.x, p.state.z - z.z) < DODGE_NEAR) this.feat(p, 'tank_dodge');
  }

  // Game.updatePlayers: out of breath in deep water, and taking it in
  drowning(p) {
    this.of(p).drowning = true;
  }

  // ---------------------------------------------------------------- the rest
  crafted(p) {
    this.bump(p, 'crafted');
  }
  salvaged(p, n) {
    this.bump(p, 'salvaged', n);
  }
  felled(p) {
    this.bump(p, 'trees');
  }

  // Game.searchCache. Hollow Creek is the team's to strip (a container one of them has searched is empty until
  // dawn): once every one of its containers has been searched this run, whoever searched any of them has it
  searched(p, c) {
    if (c.zone !== ZONE.VILLAGE) return;
    this.places();
    this.town.add(c);
    this.townBy.add(p);
    if (!this.village || this.town.size < this.village) return;
    for (const q of this.townBy) if (this.g.players.get(q.id) === q) this.feat(q, 'town_loot');
  }

  carAlarm(p) {
    this.feat(p, 'car_alarm');
  }

  // fixtures.js: the chapel bell rung, the Relay Station's radio called a plane
  bell(p, night) {
    if (night) this.feat(p, 'dinner_bell');
  }
  radioCall(p) {
    this.feat(p, 'radio_call');
  }

  // the walkie-talkie: keyed, or chat said with it in hand
  onAir(p) {
    this.feat(p, 'walkie');
  }
}
