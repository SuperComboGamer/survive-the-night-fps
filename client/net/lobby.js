// The lobby: the games running on the server (server/rooms.js), making one, and invite links.
//
// A game is known by its code. An invite link is the page's address with ?game=CODE: opening one puts that game on
// the splash, and Join goes straight into it. While in a game the address bar carries its link, so a reload goes
// back into the same game and the address itself can be shared.

const CODE = /^[A-Z2-9]{6,10}$/;

// the code of the game this page was opened for, or ''
export function linkedCode() {
  try {
    const c = new URLSearchParams(location.search).get('game');
    const code = String(c || '').trim().toUpperCase();
    return CODE.test(code) ? code : '';
  } catch {
    return '';
  }
}

export function inviteLink(code) {
  return `${location.origin}${location.pathname}?game=${encodeURIComponent(code)}`;
}

// puts the game's link in the address bar ('' takes it out), without a reload or a history entry
export function showCodeInAddress(code) {
  try {
    const url = new URL(location.href);
    if (code) url.searchParams.set('game', code);
    else url.searchParams.delete('game');
    history.replaceState(history.state, '', url);
  } catch {}
}

async function call(path, init = {}, ms = 4000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(path, { cache: 'no-store', ...init, signal: ctl.signal });
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (!res.ok) {
      const err = new Error(body?.error || (res.status === 404 ? 'Not found' : 'The server said no'));
      err.status = res.status;
      throw err;
    }
    return body;
  } catch (err) {
    if (err.status) throw err;
    throw new Error('Could not reach the server');
  } finally {
    clearTimeout(to);
  }
}

// { list: [game], games, maxGames, canCreate, players, defaultPlayers, maxPlayers }
// game: { code, name, players, seats, max, full, phase, day, seed, inviteOnly, ready, ageS }
export const listGames = () => call('/api/games');

// one game by its code (invite-only ones too); rejects with err.status 404 when there is none
export const gameInfo = (code) => call(`/api/games/${encodeURIComponent(code)}`);

// makes a game: { name, host, inviteOnly, maxPlayers } -> its info, code included
export const createGame = (opts) => call('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) }, 8000);
