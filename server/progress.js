// A player's level and perks through the API (server/index.js /api/progress...): what they have, the three perks
// offered for their next pick, picking one and starting the picks over. The XP itself is earned in the games
// (Game.award) and kept with the rest of a player's record, in the database (dbstats.js) or the file (stats.js):
// both give this the same progressOf / setPerks.
//
// Who is asking is their account (the session cookie) or, for a guest, the browser's id from the request's body:
// the id is what proves who a guest is, so it is only ever posted, and goes no further than progressOf.
import { progressView, perkSalt, PERK_BY_ID } from '../shared/progress.js';
import { HttpError } from './http.js';

export class Progress {
  // stats: PlayerStats or DbStats. changed(key, perks): a player's picks are different now (Lobby.progressChanged
  // tells the games they are in)
  constructor({ stats, changed = () => {} }) {
    this.stats = stats;
    this.changed = changed;
  }

  async get(who) {
    const p = await this.stats.progressOf(who);
    if (!p) throw new HttpError(400, 'Nobody to look up: sign in, or play a game first.');
    return p;
  }

  // -> { xp, level, into, need, frac, perks, picks, pending, nextPick, offer, respecs }
  async view(who) {
    const p = await this.get(who);
    return { ...progressView(p.xp, p.perks, perkSalt(p.key, p.respecs)), respecs: p.respecs };
  }

  // One of the three perks on offer for their next pick -> what view() says afterwards
  async pick(who, perk) {
    const p = await this.get(who);
    if (!Number.isInteger(perk) || !PERK_BY_ID[perk]) throw new HttpError(400, 'No such perk.');
    const before = progressView(p.xp, p.perks, perkSalt(p.key, p.respecs));
    if (!before.pending) throw new HttpError(409, 'You have no perk to pick: earn the next level first.');
    if (!before.offer.includes(perk)) throw new HttpError(409, 'That perk is not one of the three on offer.');
    const perks = [...p.perks, perk];
    if (!(await this.stats.setPerks(p, perks, p.respecs))) throw new HttpError(409, 'Your picks changed meanwhile: look again.');
    this.changed(p.key, perks);
    return { ...progressView(p.xp, perks, perkSalt(p.key, p.respecs)), respecs: p.respecs };
  }

  // Every pick undone, to be made again from new offers. Free: a player who wants to try other perks should
  async respec(who) {
    const p = await this.get(who);
    if (!p.perks.length) return { ...progressView(p.xp, p.perks, perkSalt(p.key, p.respecs)), respecs: p.respecs };
    const respecs = p.respecs + 1;
    if (!(await this.stats.setPerks(p, [], respecs))) throw new HttpError(409, 'Your picks changed meanwhile: look again.');
    this.changed(p.key, []);
    return { ...progressView(p.xp, [], perkSalt(p.key, respecs)), respecs };
  }
}
