// A player's level and perks through the API (server/index.js /api/progress...): what they have, spending a perk point
// on the tree, taking one back and starting over. The XP itself is earned in the games (Game.award) and kept with the
// rest of a player's record, in the database (dbstats.js) or the file (stats.js): both give this the same
// progressOf / setPerks.
//
// Who is asking is their account (the session cookie) or, for a guest, the browser's id from the request's body:
// the id is what proves who a guest is, so it is only ever posted, and goes no further than progressOf.
import { progressView, perkLock, perkDependents, levelOf, PERK_BY_ID, PERK_POINTS, LEVEL_CAP } from '../shared/progress.js';
import { HttpError } from './http.js';

// what perkLock's answer means to someone trying to take the perk
const REFUSED = {
  owned: () => 'You have that perk already.',
  level: (p) => `${p.name} opens at level ${p.level}.`,
  needs: (p) => (p.keystone ? `${p.name} needs a tier 3 perk first.` : `${p.name} needs ${p.req.map((r) => PERK_BY_ID[r].name).join(' and ')} first.`),
  keystone: () => 'You have a keystone already: one per survivor.',
  points: (p, level) => (level >= LEVEL_CAP ? `Every one of your ${PERK_POINTS} points is spent.` : 'You have no perk point to spend: earn the next level first.'),
};

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

  async write(p, perks, respecs) {
    if (!(await this.stats.setPerks(p, perks, respecs))) throw new HttpError(409, 'Your picks changed meanwhile: look again.');
    this.changed(p.key, perks);
    return { ...progressView(p.xp, perks), respecs };
  }

  // -> { xp, level, into, need, frac, perks, picks, points, pending, nextPick, respecs }
  async view(who) {
    const p = await this.get(who);
    return { ...progressView(p.xp, p.perks), respecs: p.respecs };
  }

  // A point on a perk of the tree they can take (its level reached, what it needs taken, a point to spend) -> what
  // view() says afterwards
  async pick(who, perk) {
    const p = await this.get(who);
    if (!Number.isInteger(perk) || !PERK_BY_ID[perk]) throw new HttpError(400, 'No such perk.');
    const level = levelOf(p.xp);
    const why = perkLock(p.perks, perk, level);
    if (why) throw new HttpError(409, REFUSED[why](PERK_BY_ID[perk], level));
    return this.write(p, [...p.perks, perk], p.respecs);
  }

  // The point on one perk back, to spend again: only a perk nothing else they have needs
  async unpick(who, perk) {
    const p = await this.get(who);
    if (!Number.isInteger(perk) || !PERK_BY_ID[perk]) throw new HttpError(400, 'No such perk.');
    if (!p.perks.includes(perk)) throw new HttpError(409, 'You do not have that perk.');
    const need = perkDependents(p.perks, perk);
    if (need.length) throw new HttpError(409, `${need.map((id) => PERK_BY_ID[id].name).join(' and ')} need${need.length === 1 ? 's' : ''} it: take ${need.length === 1 ? 'that' : 'those'} back first.`);
    return this.write(p, p.perks.filter((id) => id !== perk), p.respecs);
  }

  // Every point back, to be spent again. Free: a player who wants to try other perks should
  async respec(who) {
    const p = await this.get(who);
    if (!p.perks.length) return { ...progressView(p.xp, p.perks), respecs: p.respecs };
    return this.write(p, [], p.respecs + 1);
  }
}
