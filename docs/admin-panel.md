# The control room (`/admin`)

A page outside the game for the people who run it: the server, its games and their players, the settings kept in
the database, the accounts, and a record of everything done there. The page is `client/admin.html` +
`client/admin/` (its own Vite entry, like `/stats`); its API is `/api/admin/*` in `server/adminpanel.js`; what it asks
of a running game is in `server/gameadmin.js`. `scripts/test-admin.js` (in `npm test`) holds all of it.

## Who gets in

Admin is the `is_admin` flag on an account (migration 009). Nothing else makes an admin: no password, no
environment variable, no list of names in the code. `DEV_ADMIN=1` only switches on the chat commands inside games on
a test server; it does not open the panel.

Grant it from a shell with the database's URL, to the two accounts that run the game:

```sh
DATABASE_URL=postgres://... npm run admin -- SuperComboGamer on
DATABASE_URL=postgres://... npm run admin -- WebDevCody on
npm run admin -- <name-or-email> off      # takes it away
```

The first admin has to be made this way. After that an admin can grant or remove it on the Accounts tab. Either way
the account's sign-ins are ended, so it signs in again and has the new role.

A server without a database has no accounts, so no admins: `/admin` says so and every route answers 503.

## What it does

| Tab | Shows | Does |
|---|---|---|
| Overview | This server: games and players against the caps, the slowest tick, the network thread, memory, the database, uptime, the build, games that crashed or are falling behind. In a cluster, every server | Switch which server is managed (cluster) |
| Games | Every game, invite-only ones too: code, map, day and phase, difficulty, players and held places, zombies, age, tick time, CPU, memory | Open one |
| A game | Its players (account or guest, admin, alive / down / dead / turned / held, health, kills, level, ping, an address tag), its numbers | Message its players, run a command, remove a player, reset it, close it |
| Server | The settings in the database and the ones only a deploy changes | Make a game, message everyone, change a setting, stop / resume new games, close every game, restart |
| Accounts | Accounts by name: admin or not, the game they are in, how many browsers are signed in, last seen | Grant or remove admin, end sign-ins |
| Audit log | Every action: who, when, what, to what, done or refused | Nothing: rows are only ever added |

The page asks the server again every 3 seconds while it is in front.

## What each action does, exactly

- **Message a game / everyone.** A system line in the chat of each player, starting `[Admin]`. At most 200
  characters. In a cluster "everyone" is passed to the other servers as well.
- **Commands.** Skip to night, skip to day, spawn up to 20 of a zombie type 12 m ahead of a player, kill every zombie
  in the game, give a player up to 200 of an item, call a supply drop, unlock every schematic, install every car part.
  These are the admin chat commands (`Game.debugCommand`), run through one of the game's players: the players see the
  same `[debug]` line as when an admin types one, and the match record notes it. Only while a run is on (day or
  night). The commands that move or change the admin's own body (`/tp`, `/kill`, `/place`, ...), the filming tools
  (`/step`, `/cross hold`, `/takeoff`) and `/xp` are not offered: they need a body in the game or change a record for
  good.
- **Remove a player.** Their place is let go at once, as if they had pressed Leave (what they carried beyond their
  starting kit drops where they stood; no place is held), their socket is closed with code 4003 and the reason, and
  the others read "X was removed from the game by an admin." A held place (a player who dropped) is let go the same
  way. It is not a ban: they can join again.
- **Reset a game.** A new run in the same game. Kept: the code, the name, the seats, the difficulty, invite-only or
  public, and everyone in it, connected or held. Gone: the run (its match is recorded as `abandoned`), the valley (a
  new seed, unless `SEED` pins it), the day (day 1 on the island, whichever map they were on), everything built,
  found and carried, the bridge checkpoint, and the list of who died. Every player stands at the start with a day-1
  kit, the turned and the dead alive again. Accounts keep their XP, perks and lifetime stats. Clients hear it as any
  new game. An empty game has nothing to reset.
- **Close a game.** The match being played is ended as it stands and written (`interrupted`), the game's thread is
  stopped, every socket is closed with code 4003 and "An admin closed this game: reason", and the code stops
  working. Nothing of the game is kept.
- **Stop new games / resume.** While stopped, nobody can make a game on this server and a quick join with no game to
  go to is turned away; games already running carry on and can be joined. Kept in memory: a restart resumes them.
- **Close every game.** Close, for every game on this server. Needs `CLOSE ALL` typed.
- **Change a setting.** `max_total_games` (a whole number from 0 to 100000, or unset). Written to `server_settings`
  and in force on this server at once, on the others within 5 seconds.
- **Grant / remove admin.** Sets the flag, ends the account's sign-ins, and tells the games it is playing in. Nobody
  can remove their own flag, so the game always has an admin; two admins removing each other at the same moment
  cannot both succeed (one transaction, the admins' rows locked).
- **End sign-ins.** Deletes the account's sessions: every browser has to sign in again. A game it is in goes on.
- **Restart the server.** Off unless the host sets `ADMIN_RESTART=1`. It runs the same path as a deploy's SIGTERM:
  new sockets are turned away, every game with players is saved into the handoff store and its players see "Server
  updating", the matches and stats are written, and the process exits with code 75. It does not start anything.
  It relies on the host: something must start the server again after a non-zero exit (Railway's `ON_FAILURE` restart
  policy does, and each one counts against `restartPolicyMaxRetries`), on the same database or `HANDOFF_DIR`, and
  quickly: a client tries to get back for 45 seconds, a save is kept for `HANDOFF_MAX_AGE_SECONDS` (300), a player's
  place for 180. With no store (no Postgres and no `HANDOFF_DIR`) it is refused, since every game would end. Needs
  `RESTART` typed.

Reset, close, close every game and restart also need the target named again in the request body
(`confirm`), so a request aimed at one game cannot land on another.

## Not there

- **Bans.** Nothing in the game bans an account or an address today, and a guest has no identity to ban but an
  address. Removing a player and ending sign-ins are what there is.
- **A cluster-wide view of games.** With `CLUSTER=1` the panel manages one server at a time: the one it is served
  from, or the one picked on the Overview (the proxy sends `/api/admin/*` to the server named in `x-stn-via`). The
  servers table, the settings, the accounts and the audit log are shared; a message to everyone and an account's
  sign-out reach every server. Stopping new games is per server, and the proxy may still send a new game's request
  to a stopped server, which answers "busy".
- **Emails.** Accounts are found by name only, and no email is shown.

## Security

- Every route calls `AdminPanel.guard` first. It needs: an `Origin` that is this host (when the browser sends one),
  `Sec-Fetch-Site: same-origin` (when the browser sends it), the header `X-STN-Admin: 1`, a database, and a session
  cookie whose account has `is_admin`, read from the database on that request (not from the one-minute cache). A
  guest gets 401, anyone else 403, a server with no database 503.
- Cross-site requests: the session cookie is `HttpOnly; SameSite=Lax`, so another site's POST does not carry it; the
  Origin check refuses one that does; state-changing routes are POST or PUT and take JSON only, and need the custom
  header, both of which make a browser ask this server first (a CORS preflight nothing here answers). There is no
  separate CSRF token. `/admin` is served with `X-Frame-Options: DENY` and a Content-Security-Policy that allows
  scripts and requests from this origin only, so it cannot be framed and runs no outside script (the stats page's
  analytics script is not on it).
- Input: codes, ids, counts, names and text are checked on the network thread, and again in the game's thread. A game
  that does not answer within 3 s (10 s for a reset) is reported, not waited for. Text goes into the page as text.
- Limits: 300 requests in a row per address, then 5 a second; 60 changes in a row per admin, then one every 2 s.
- What an admin is sent: names, account ids, game codes (invite-only too), timings. Not emails, password hashes,
  session tokens or guests' browser ids. Addresses are never sent: players on one address share a 6-character tag
  made from a salt that changes at every start.
- The audit log (`admin_audit`, migration 014) gets a row for every action an admin attempted, done or refused, before
  the answer goes out. If the row cannot be written the action stands, the server log says so, and the panel shows it.

Threat model, in short: someone who is not an admin (a guest, a player, another site's page in an admin's browser)
must not be able to see or do anything here; an admin is trusted with everything on the page, and the audit log is
what holds them to account. Someone with the database can make themselves an admin; someone with an admin's
unlocked browser is that admin.
