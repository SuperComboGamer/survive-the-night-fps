// Your level and perks, as the server keeps them (server/progress.js): signed in, the account's; else this browser's,
// by its id (identity.js), posted as a JOIN carries it. The XP itself is earned in the games; here it is only read,
// and the perks picked or started over.
//
// Every answer is the same view: { xp, level, into, need, frac, perks, picks, pending, nextPick, offer, respecs }
// (shared/progress.js progressView). The last one is kept, and whoever wants to know when it changes can listen.
import { playerId } from './identity.js';
import { post } from './lobby.js';

let last = null;
const subs = new Set();

function got(view) {
  last = view;
  for (const fn of subs) {
    try {
      fn(view);
    } catch (err) {
      console.error(err);
    }
  }
  return view;
}

// fn(view) on every answer; returns the way to stop
export function onProgress(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export const lastProgress = () => last;

export const fetchProgress = () => post('/api/progress', { guestId: playerId() }, 6000).then(got);
// perk: one of view.offer
export const pickPerk = (perk) => post('/api/progress/pick', { perk, guestId: playerId() }, 6000).then(got);
export const respecPerks = () => post('/api/progress/respec', { guestId: playerId() }, 6000).then(got);
