// Back into the game after a deploy moved it to the next server (server/handoff.js: our socket was closed with
// MOVED_CODE, the game is in the store, our body waits for us there). No page, no socket: client/main.js hands in how
// to ask and how to join and does what this decides, and scripts/test-deploys.js runs it against real servers.
//
// Whether this page can go back in as it is, or has to be loaded again first, is decided by what it was loaded with
// (loadedFrom: the server writes it into the page, server/index.js) against what now runs the game (/api/version, asked
// with the game's code):
//   protocol  the messages on the wire. Another: the page has to be loaded again.
//   compat    a fingerprint of the code both ends run (shared/: the valley, the movement, the rules, the protocol).
//             Another: the page has to be loaded again, or it would build another valley, predict other moves.
//   build     the client itself (a hash of its page, which names its bundles by their content). Another, with the same
//             protocol and compat: the page goes back in as it is, and the new client is loaded the next time the
//             player leaves the game (update: true). A change that has to reach players at once touches shared/.
// A server from before compat (none in its answer) is held to the build, as the page used to be.
//
// When to stop asking: the game is over for good when the server says an update ended it (ENDED_MAP / ENDED_UPDATE,
// at once), or says it has no such game NO_GAME_TRIES times over at least NO_GAME_MS - the newest server may be asked
// while the game is still on the one before (a deploy on top of a deploy). Anything else (the old server still
// answering and turning us away, a socket that did not open) is tried again quickly: a deploy's gap is tens of ms.
import { REJECT_REASON } from '../../shared/protocol.js';
import { NO_GAME_TRIES, NO_GAME_MS, endedByUpdate } from './comeback.js';

export const MOVE_MS = 45_000;
export { NO_GAME_MS };
const FAST_MS = 5000; // tries this close together for this long, then once a second
const FAST_EVERY = 150;

// what the page has to do to play the game that the server's answer `v` describes: 'reload', 'update' (go in as it is,
// load the new client later) or '' (it is the same)
export function verdictFor(loadedFrom, v) {
  if (!v || !loadedFrom) return '';
  if (v.protocol !== loadedFrom.protocol) return 'reload';
  if (v.compat && loadedFrom.compat) return v.compat !== loadedFrom.compat ? 'reload' : v.build && loadedFrom.build && v.build !== loadedFrom.build ? 'update' : '';
  return v.build && loadedFrom.build && v.build !== loadedFrom.build ? 'reload' : '';
}

//   code        the game
//   loadedFrom  { protocol, build, compat } this page was loaded with
//   version(code)  -> the server's answer for that game ({ protocol, build, compat }), or null (not reached)
//   join()      one try: true once in the game, else the Error it ended with (err.reason: the REJECT's reason)
//   still()     false once there is nothing more to do (the player left meanwhile)
// -> { verdict: 'in place' | 'reload' | 'ended' | 'gave up' | 'left', update, message }
export async function moveBack({ code, loadedFrom, version, join, still = () => true, ms = MOVE_MS, now = () => performance.now(), sleep = (t) => new Promise((done) => setTimeout(done, t)) }) {
  const t0 = now();
  let noGame = 0;
  let firstNoGame = 0;
  let update = false;
  for (let tries = 0; now() - t0 < ms; tries++) {
    if (!still()) return { verdict: 'left', update };
    const v = await version(code).catch(() => null);
    const say = verdictFor(loadedFrom, v);
    if (say === 'reload') return { verdict: 'reload', update };
    if (say === 'update') update = true;
    if (v) {
      const r = await join();
      if (r === true) return { verdict: 'in place', update };
      if (r?.reason === REJECT_REASON.VERSION) return { verdict: 'reload', update };
      if (endedByUpdate(r?.reason)) return { verdict: 'ended', update, message: r.message };
      if (r?.reason === REJECT_REASON.NO_GAME) {
        if (!noGame++) firstNoGame = now();
        if (noGame >= NO_GAME_TRIES && now() - firstNoGame >= NO_GAME_MS) return { verdict: 'gave up', update, message: 'The server was updated, but your game could not be brought back.' };
      }
    }
    await sleep(now() - t0 < FAST_MS ? FAST_EVERY : 1000);
  }
  return { verdict: 'gave up', update, message: 'The server was updated, but your game could not be brought back.' };
}

// What this page was loaded with: the server writes it into the page it serves (<meta name="stn-build"
// content="build compat protocol">). Without it (the Vite dev server) the server is asked, as the page used to.
export function pageBuild(doc = globalThis.document) {
  const m = doc?.querySelector?.('meta[name="stn-build"]')?.getAttribute('content');
  if (!m) return null;
  const [build, compat, protocol] = m.split(' ');
  return { build, compat, protocol: +protocol };
}
