// What the admin panel (adminpanel.js, /admin) can ask of one game, run inside that game's worker (room-worker.js:
// { t: 'admin', id, op, ... } in, { t: 'admin', id, ok, ... } back). The network thread has checked who is asking and
// what they sent; everything is checked again here, as a chat command's arguments are, because this is the thread a
// bad value would hurt. It runs between two ticks, like a socket's message.
//
//   detail                         the game and its players, for the panel's game view
//   say { text }                   a line in every player's chat, from the server
//   reset                          a new run in the same game: see reset() below
//   kick { player, why }           that player out of the game (their socket closed with ENDED_CODE and the reason)
//   role { user, isAdmin }         an account's admin flag changed: its player here has it from now on
//   command { cmd, player?, ... }  one of COMMANDS: the admin chat commands that make sense from outside a game, run
//                                  as that command is in the game (Game.debugCommand), through one of its players
import { ZTYPE, ZOMBIE_DEFS, ITEM, ITEM_DEFS } from '../shared/defs.js';
import { PHASE } from '../shared/constants.js';

const TEXT_MAX = 200;
// what a line of text may be: no control characters, one line, not too long ('' when there is nothing left)
export const cleanText = (v, max = TEXT_MAX) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

// The zombie types and items the panel may name, by the key the game's own tables know them under
export const ZOMBIE_KEYS = Object.keys(ZTYPE).filter((k) => ZOMBIE_DEFS[ZTYPE[k]]);
export const ITEM_KEYS = Object.keys(ITEM).filter((k) => ITEM_DEFS[ITEM[k]]);
export const SPAWN_MAX = 20; // (as /spawn)
export const GIVE_MAX = 200;

// cmd -> { when: the phase it needs, player: it is done at / to one player (else through whoever has been in longest), args(m): the chat
// command's words, or throws }. Everything a chat command reads comes from here: never from the panel as text.
export const COMMANDS = {
  // the clock
  night: { about: 'Skip to nightfall (only by day)', when: PHASE.DAY, not: 'It is not day in that game.', args: () => ['night'] },
  day: { about: 'Skip to daybreak (only by night)', when: PHASE.NIGHT, not: 'It is not night in that game.', args: () => ['day'] },
  // the dead
  spawn: {
    about: 'Spawn zombies 12 m ahead of a player',
    player: true,
    args(m) {
      const type = typeof m.type === 'string' ? m.type.toUpperCase() : '';
      if (!ZOMBIE_KEYS.includes(type)) throw new Error('No such zombie type.');
      const n = Math.floor(Number(m.count));
      if (!(n >= 1 && n <= SPAWN_MAX)) throw new Error(`Spawn 1 to ${SPAWN_MAX} at a time.`);
      return ['spawn', String(ZTYPE[type]), String(n)]; // (by id: a name could fit two types)
    },
    label: (m) => `spawn ${m.count} x ${ZOMBIE_DEFS[ZTYPE[m.type.toUpperCase()]].name}`,
  },
  clear: { about: 'Every zombie in the game drops dead', args: () => ['clear', '100000'] },
  // help for a team
  give: {
    about: 'Put an item in a player’s backpack',
    player: true,
    args(m) {
      const item = typeof m.item === 'string' ? m.item.toUpperCase() : '';
      if (!ITEM_KEYS.includes(item)) throw new Error('No such item.');
      const n = Math.floor(Number(m.count));
      if (!(n >= 1 && n <= GIVE_MAX)) throw new Error(`Give 1 to ${GIVE_MAX} at a time.`);
      return ['give', String(ITEM[item]), String(n)];
    },
    label: (m) => `give ${m.count} x ${ITEM_DEFS[ITEM[m.item.toUpperCase()]].name}`,
  },
  airdrop: { about: 'Call in a supply drop', args: () => ['airdrop'] },
  unlock: { about: 'Unlock every schematic for the team', args: () => ['unlock'] },
  parts: { about: 'Install every car part', args: () => ['parts'] },
};

const round1 = (v) => Math.round(v * 10) / 10;

function detail(game) {
  let zombies = 0;
  for (const z of game.zombies) if (!z.dead) zombies++;
  const players = [];
  for (const p of game.players.values()) {
    players.push({
      id: p.id,
      name: p.name,
      account: p.friend || '', // the account's name ('' for a guest)
      guest: !p.account,
      admin: !!p.admin,
      held: p.away ? { leftS: Math.max(0, Math.round(p.away.grace - (game.time - p.away.since))), handoff: !!p.away.handoff } : null,
      slot: p.away ? -1 : (p.session?.conn?.slot ?? -1), // (which socket: the network thread's to look up, never shown)
      ping: Math.round(p.ping || 0),
      state: p.zombie ? 'turned' : !p.alive ? 'dead' : p.downed ? 'down' : 'alive',
      hp: Math.max(0, Math.round(p.hp || 0)),
      kills: p.kills | 0,
      level: game.levelOf(p),
    });
  }
  return {
    ok: true,
    game: {
      seed: game.seed >>> 0,
      act: game.act,
      phase: game.phase,
      day: game.day,
      timeLeft: Math.max(0, Math.round(game.timeLeft || 0)),
      zombies,
      entities: game.all.length,
      structures: game.structures.length,
      items: game.items.length,
      supplies: game.supplies.slice(),
      need: game.sup?.need ? game.sup.need.slice() : [],
      stepMode: !!game.stepMode,
      godMode: !!game.godMode,
      runS: Math.round(game.time),
    },
    players,
    tick: game.tickStats.status(performance.now()),
  };
}

// A new run in the same game. The game keeps its code, its name, its seats, its difficulty and everyone in it; the
// run they were on is over (its match ends as 'abandoned'): a new valley is dealt (the same one where SEED pins it),
// it is day 1 on the island again whichever map they were on, everything built, found and carried is gone, the dead
// are back among the living, and every player stands at the start with a day-1 kit. Their accounts' XP, perks and
// lifetime stats are untouched. The clients hear it as any new game (S2C.WORLD_RESET, NOTIFY.NEW_GAME).
function reset(game) {
  if (!game.players.size) return { ok: true, note: 'Nobody is in it: it is already waiting to deal a new run to whoever joins.' };
  const was = { day: game.day, phase: game.phase, act: game.act };
  game.checkpoint = null; // (a wipe on the mainland goes back to the bridge: this is a new run, not that)
  game.takeoffHold = 0;
  game.stepMode = false;
  game.startGame();
  game.systemChat('An admin restarted this game: a new run, from day 1.');
  return { ok: true, players: game.players.size, was, seed: game.seed >>> 0 };
}

function findPlayer(game, id) {
  const p = Number.isInteger(id) ? game.players.get(id) : null;
  if (!p) throw new Error('That player is not in the game any more.');
  return p;
}

// ctx: { drop(slot, why) } - room-worker.js: lets go of that socket's session at once and has the socket closed
export function adminOp(game, m, ctx) {
  switch (m.op) {
    case 'detail':
      return detail(game);
    case 'say': {
      const text = cleanText(m.text);
      if (!text) throw new Error('Nothing to say.');
      game.systemChat(`[Admin] ${text}`);
      return { ok: true, players: game.players.size };
    }
    case 'reset':
      game.track?.event('admin', null, { command: 'panel: reset' });
      return reset(game);
    case 'kick': {
      const p = findPlayer(game, m.player);
      const why = cleanText(m.why, 100);
      const name = p.name;
      game.track?.event('admin', p, { command: 'panel: kick' });
      const slot = p.away ? -1 : (p.session?.conn?.slot ?? -1);
      if (slot >= 0)
        ctx.drop(slot, why); // (their session goes as a player who left does: no place is held for them)
      else game.removePlayer(p); // (held for a rejoin: nothing to close)
      if (game.players.size) game.systemChat(`${name} was removed from the game by an admin.`);
      return { ok: true, name, held: slot < 0 };
    }
    case 'role': {
      let n = 0;
      for (const p of game.players.values()) {
        if (!p.account || p.account !== m.user) continue;
        p.admin = m.isAdmin === true || game.devAdmin;
        n++;
      }
      return { ok: true, players: n };
    }
    case 'command': {
      const c = Object.hasOwn(COMMANDS, m.cmd) ? COMMANDS[m.cmd] : null;
      if (!c) throw new Error('No such command.');
      if (game.phase !== PHASE.DAY && game.phase !== PHASE.NIGHT) throw new Error('That game is not in the middle of a run (it is waiting, crossing, or on its end screen).');
      if (c.when !== undefined && game.phase !== c.when) throw new Error(c.not);
      const args = c.args(m);
      // through a player, as a chat command is: the one named, else whoever has been in longest and is still connected
      let p = null;
      if (c.player) p = findPlayer(game, m.player);
      else for (const q of game.players.values()) if (!p || (p.away && !q.away)) p = q;
      if (!p) throw new Error('Nobody is in that game.');
      game.track?.event('admin', p, { command: `panel: ${args.join(' ')}`.slice(0, 60) });
      game.debugCommand(p, args);
      return { ok: true, ran: c.label ? c.label(m) : args[0], as: p.name };
    }
  }
  throw new Error('No such operation.');
}
