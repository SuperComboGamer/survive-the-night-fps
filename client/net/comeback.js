// Going back into a game after the connection went: when to keep asking, when to stop, and what to say then.
// (No page, no socket: main.js hands in the join and shows what comes back, and scripts/test-handoff-world.js runs
// this against a real server.)
//
// A server holds a dropped player's place for a minute, and a deploy hands the game to the next server, so the same
// code is asked for again every few seconds. But a game can also be over for good, and then asking again only repeats
// the same refusal: the next server could not carry it over (it says so: REJECT_REASON.ENDED_MAP / ENDED_UPDATE, and
// that is final at once), or no server has it (NO_GAME: final once it has been said NO_GAME_TRIES times, as the game
// may still be on its way between two servers the first time; after a deploy, three answers over NO_GAME_MS).
import { REJECT_REASON } from '../../shared/protocol.js';

export const NO_GAME_TRIES = 3;
// ...and after a deploy, not before this long since the first: the game may still be on its way between two servers, a
// deploy on the heels of a deploy (client/net/moveback.js)
export const NO_GAME_MS = 20_000;
const MOVED_EVERY = 500; // a page loaded again for a deploy asks this often (the game is there in tens of ms)

// the game that went by the code was ended by a deploy: the server that says so will not have it later either
export const endedByUpdate = (reason) => reason === REJECT_REASON.ENDED_MAP || reason === REJECT_REASON.ENDED_UPDATE;

// What a REJECT says to the player. code: the game asked for ('' for a quick join)
export function rejectText(reason, code = '') {
  switch (reason) {
    case REJECT_REASON.FULL:
      return code ? 'That game is full.' : 'Every game is full right now. Try again in a minute.';
    case REJECT_REASON.NO_GAME:
      return 'That game has ended, or the link is wrong.';
    case REJECT_REASON.VERSION:
      return 'Version mismatch - refresh the page';
    case REJECT_REASON.ENDED_MAP:
      return 'An update to the game changed the map, so that game could not be carried over and has ended. Start or join a new one.';
    case REJECT_REASON.ENDED_UPDATE:
      return 'An update to the game ended that game: it could not be carried over to the new version. Start or join a new one.';
    default:
      return 'Rejected';
  }
}

// Asks for the game `code` until we are in it, it turns out to be over, or `ms` have passed.
//   join()      one try: resolves true once in the game, otherwise the Error that try ended with (err.reason: the
//               REJECT's reason, when it was turned away) or nothing (it could not be tried just now)
//   moved       this page was loaded again for a deploy's new build (main.js reloadInto)
//   waiting(s)  called before every try, with the seconds left
// -> '' when in the game, else what to tell the player, once: the game is over, or was not reached in time
export async function comeBack({ join, code, moved = false, ms = 60_000, every = 3000, waiting = () => {}, now = () => performance.now(), sleep = (t) => new Promise((done) => setTimeout(done, t)) }) {
  const until = now() + ms;
  let noGame = 0;
  let firstNoGame = 0;
  while (now() < until) {
    waiting(Math.ceil((until - now()) / 1000));
    const r = await join();
    if (r === true) return '';
    if (endedByUpdate(r?.reason)) return r.message;
    if (r?.reason === REJECT_REASON.NO_GAME) {
      if (!noGame++) firstNoGame = now();
      if (noGame >= NO_GAME_TRIES && (!moved || now() - firstNoGame >= NO_GAME_MS)) return moved ? 'The game was updated, but your game could not be brought back.' : `Game ${code} has ended: your place there is gone.`;
    }
    await sleep(moved ? Math.min(every, MOVED_EVERY) : every);
  }
  return 'Connection lost, and the game could not be reached in time: your place there is gone.';
}
